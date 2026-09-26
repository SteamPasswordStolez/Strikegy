import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

/** Final display-space grade: saturation, contrast, warm tint and vignette. */
const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.06 },
    uTint: { value: new THREE.Vector3(1.02, 1.0, 0.97) },
    uVignette: { value: 0.32 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uContrast;
    uniform vec3 uTint;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      col *= uTint;
      float d = length((vUv - 0.5) * vec2(1.0, 0.85));
      col *= 1.0 - uVignette * smoothstep(0.35, 0.85, d);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

export interface PostFXOptions {
  ao: boolean;
  bloom: boolean;
  smaa: boolean;
}

/**
 * Post-processing chain: world -> AO -> first-person overlay -> bloom ->
 * tone mapping/sRGB -> grade -> SMAA. The viewmodel is drawn inside the chain
 * (after clearing depth) so it gets the same bloom, grade and anti-aliasing.
 */
export class PostFX {
  readonly composer: EffectComposer;

  constructor(
    gl: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    fpScene: THREE.Scene,
    fpCamera: THREE.PerspectiveCamera,
    opts: PostFXOptions,
  ) {
    const size = gl.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(gl, target);
    this.composer.addPass(new RenderPass(scene, camera));

    if (opts.ao) {
      const ao = new GTAOPass(scene, camera, size.x, size.y);
      ao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.6, thickness: 1.2, scale: 1.1 });
      ao.blendIntensity = 0.85;
      this.composer.addPass(ao);
    }

    const fp = new RenderPass(fpScene, fpCamera);
    fp.clear = false;
    fp.clearDepth = true;
    this.composer.addPass(fp);

    if (opts.bloom) {
      this.composer.addPass(new UnrealBloomPass(size, 0.1, 0.4, 1.6));
    }
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(GradeShader));
    if (opts.smaa) this.composer.addPass(new SMAAPass());
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
