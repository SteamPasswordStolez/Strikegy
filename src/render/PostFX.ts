import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { LAYER_FX, LAYER_WORLD } from './layers';

/** RenderPass that draws only the given camera layer. */
class LayerRenderPass extends RenderPass {
  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    private readonly layer: number,
  ) {
    super(scene, camera);
  }

  override render(...args: Parameters<RenderPass['render']>): void {
    const cam = this.camera as THREE.Camera;
    const prev = cam.layers.mask;
    cam.layers.set(this.layer);
    super.render(...args);
    cam.layers.mask = prev;
  }
}

/** GTAO computed at half resolution; the blend back onto the frame stays full-res. */
class HalfResGTAOPass extends GTAOPass {
  override setSize(width: number, height: number): void {
    super.setSize(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)));
  }
}

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
}

/**
 * Post-processing chain: world -> AO -> transparent FX -> first-person overlay ->
 * bloom -> tone mapping/sRGB -> grade -> FXAA. The viewmodel is drawn inside the
 * chain (after clearing depth) so it gets the same grade and anti-aliasing.
 */
export class PostFX {
  readonly composer: EffectComposer;
  private readonly fxaa: ShaderPass;

  constructor(
    gl: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    fpScene: THREE.Scene,
    fpCamera: THREE.PerspectiveCamera,
    opts: PostFXOptions,
  ) {
    const size = gl.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(size.x, size.y),
    });
    this.composer = new EffectComposer(gl, target);
    // Both ping-pong targets share one depth texture, so passes drawn after a
    // fullscreen pass (AO) still depth-test against the world.
    this.composer.renderTarget2.depthTexture = this.composer.renderTarget1.depthTexture;
    this.composer.addPass(new LayerRenderPass(scene, camera, LAYER_WORLD));

    if (opts.ao) {
      const ao = new HalfResGTAOPass(scene, camera, size.x / 2, size.y / 2);
      ao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.6, thickness: 1.2, scale: 1.1, samples: 12 });
      ao.updatePdMaterial({ samples: 8, rings: 2, radius: 6 });
      ao.blendIntensity = 0.85;
      this.composer.addPass(ao);
    }

    const fx = new LayerRenderPass(scene, camera, LAYER_FX);
    fx.clear = false;
    this.composer.addPass(fx);

    const fp = new RenderPass(fpScene, fpCamera);
    fp.clear = false;
    fp.clearDepth = true;
    this.composer.addPass(fp);

    if (opts.bloom) this.composer.addPass(new UnrealBloomPass(size.clone().multiplyScalar(0.5), 0.1, 0.4, 1.6));
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(GradeShader));
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.fxaa.material.uniforms.resolution!.value.set(1 / (w * pixelRatio), 1 / (h * pixelRatio));
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
