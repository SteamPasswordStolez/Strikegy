import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** Down / up sample passes of the bloom (each half the size of the one before). */
const LEVELS = 4;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

/**
 * Bloom that only makes its texture (quarter size and below): bright parts
 * cut out softly over `threshold`, blurred by a chain of 4-tap down samples
 * and tent-filtered up samples (dual filter). `FinalPass` adds it while tone
 * mapping, so there is no full-size blend back onto the frame. Replaces
 * three's UnrealBloomPass (2026-10-10): ~1.9 ms at 1152x648 on an Iris Xe for
 * a glow at strength 0.1, a third of it the full-size additive copy.
 */
export class BloomPass extends Pass {
  private readonly targets: THREE.WebGLRenderTarget[] = [];
  private readonly quad = new FullScreenQuad();
  private readonly down: THREE.ShaderMaterial;
  private readonly up: THREE.ShaderMaterial;

  constructor(readonly threshold: number) {
    super();
    this.needsSwap = false;
    for (let i = 0; i < LEVELS; i++) {
      const t = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
      t.texture.generateMipmaps = false;
      this.targets.push(t);
    }
    this.down = new THREE.ShaderMaterial({
      uniforms: { tex: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 0 } },
      vertexShader,
      fragmentShader: /* glsl */ `
        uniform sampler2D tex;
        uniform vec2 texel;
        uniform float threshold;
        varying vec2 vUv;
        void main() {
          // Four bilinear taps = a 4x4 box of the source.
          vec3 c = texture2D(tex, vUv + texel * vec2(-1.0, -1.0)).rgb + texture2D(tex, vUv + texel * vec2(1.0, -1.0)).rgb
                 + texture2D(tex, vUv + texel * vec2(-1.0, 1.0)).rgb + texture2D(tex, vUv + texel * vec2(1.0, 1.0)).rgb;
          c *= 0.25;
          if (threshold > 0.0) {
            // What is brighter than the threshold (luminance, soft over half a unit), like three's.
            float l = dot(c, vec3(0.299, 0.587, 0.114));
            c *= smoothstep(threshold, threshold + 0.5, l);
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.up = new THREE.ShaderMaterial({
      uniforms: { tex: { value: null }, texel: { value: new THREE.Vector2() } },
      vertexShader,
      fragmentShader: /* glsl */ `
        uniform sampler2D tex;
        uniform vec2 texel;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tex, vUv + texel * vec2(-1.0, 0.0)).rgb + texture2D(tex, vUv + texel * vec2(1.0, 0.0)).rgb
                 + texture2D(tex, vUv + texel * vec2(0.0, -1.0)).rgb + texture2D(tex, vUv + texel * vec2(0.0, 1.0)).rgb;
          gl_FragColor = vec4(c * 0.25, 1.0);
        }`,
      // Added onto the level above (what it already holds stays: the sharper glow).
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
  }

  /** The finished glow (linear, to add before tone mapping). */
  get texture(): THREE.Texture {
    return this.targets[0]!.texture;
  }

  override setSize(width: number, height: number): void {
    let w = width;
    let h = height;
    for (const t of this.targets) {
      w = Math.max(1, Math.round(w / 2));
      h = Math.max(1, Math.round(h / 2));
      // The first level is a quarter of the frame (its down sample reads a 4x4 box).
      if (t === this.targets[0]) {
        w = Math.max(1, Math.round(w / 2));
        h = Math.max(1, Math.round(h / 2));
      }
      t.setSize(w, h);
    }
  }

  override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.quad.material = this.down;
    let src = read.texture;
    let srcW = read.width;
    let srcH = read.height;
    for (let i = 0; i < LEVELS; i++) {
      const t = this.targets[i]!;
      this.down.uniforms.tex!.value = src;
      // Taps sit on the corners of the source texel quad that covers this pixel.
      const step = i === 0 ? 1 : 0.5;
      this.down.uniforms.texel!.value.set(step / srcW, step / srcH);
      this.down.uniforms.threshold!.value = i === 0 ? this.threshold : 0;
      renderer.setRenderTarget(t);
      this.quad.render(renderer);
      src = t.texture;
      srcW = t.width;
      srcH = t.height;
    }
    this.quad.material = this.up;
    for (let i = LEVELS - 1; i > 0; i--) {
      const from = this.targets[i]!;
      this.up.uniforms.tex!.value = from.texture;
      this.up.uniforms.texel!.value.set(1 / from.width, 1 / from.height);
      renderer.setRenderTarget(this.targets[i - 1]!);
      this.quad.render(renderer);
    }
    renderer.autoClear = autoClear;
  }

  override dispose(): void {
    for (const t of this.targets) t.dispose();
    this.down.dispose();
    this.up.dispose();
    this.quad.dispose();
  }
}

/** Tone mapping + colour space (three's OutputPass) with the bloom added first. */
export class FinalPass extends OutputPass {
  constructor(bloom: BloomPass | null, strength: number) {
    super();
    if (!bloom) return;
    const m = this.material as THREE.RawShaderMaterial;
    m.uniforms.tBloom = { value: bloom.texture };
    m.uniforms.bloomStrength = { value: strength };
    m.fragmentShader = m.fragmentShader
      .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\nuniform sampler2D tBloom;\nuniform float bloomStrength;')
      .replace('gl_FragColor = texture2D( tDiffuse, vUv );', 'gl_FragColor = texture2D( tDiffuse, vUv );\ngl_FragColor.rgb += texture2D( tBloom, vUv ).rgb * bloomStrength;');
    if (!m.fragmentShader.includes('tBloom, vUv')) console.warn('FinalPass: OutputShader changed, bloom not added');
  }
}
