import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { BloomPass, FinalPass } from './bloom';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { LAYER_BACKDROP, LAYER_FX, LAYER_WORLD } from './layers';

/** RenderPass that draws only the given camera layers. */
class LayerRenderPass extends RenderPass {
  private readonly mask: number;

  constructor(scene: THREE.Scene, camera: THREE.Camera, layers: number[]) {
    super(scene, camera);
    this.mask = layers.reduce((m, l) => m | (1 << l), 0);
  }

  override render(...args: Parameters<RenderPass['render']>): void {
    const cam = this.camera as THREE.Camera;
    const prev = cam.layers.mask;
    cam.layers.mask = this.mask;
    super.render(...args);
    cam.layers.mask = prev;
  }
}

/**
 * GTAO computed at half resolution; the blend onto the frame stays full-res and
 * goes straight onto the frame (three's pass first copies the whole frame to
 * the other buffer, then blends there: ~0.7 ms at 1152x648 on an Iris Xe).
 */
class HalfResGTAOPass extends GTAOPass {
  constructor(...args: ConstructorParameters<typeof GTAOPass>) {
    super(...args);
    this.needsSwap = false;
  }

  override setSize(width: number, height: number): void {
    super.setSize(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)));
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    const output = this.output;
    this.output = GTAOPass.OUTPUT.Off;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    this.output = output;
    this.blendMaterial.uniforms.intensity!.value = this.blendIntensity;
    this.blendMaterial.uniforms.tDiffuse!.value = this.pdRenderTarget.texture;
    (this as unknown as { _renderPass(r: THREE.WebGLRenderer, m: THREE.Material, t: THREE.WebGLRenderTarget | null): void })._renderPass(renderer, this.blendMaterial, readBuffer);
  }
}

export interface PostFXOptions {
  ao: boolean;
  bloom: boolean;
}

/**
 * Post-processing chain: world -> AO -> transparent FX -> first-person overlay ->
 * bloom -> tone mapping + grade (grade.ts) -> FXAA. The viewmodel is drawn inside the
 * chain (after clearing depth) so it gets the same anti-aliasing.
 */
export class PostFX {
  readonly composer: EffectComposer;
  private readonly fxaa: ShaderPass;
  private readonly labels = new Map<Pass, string>();

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
    this.add('world', new LayerRenderPass(scene, camera, [LAYER_WORLD]));
    // Scenery after the world: walls and buildings already fill the depth buffer,
    // so most of the forest behind them is rejected before shading.
    const backdrop = new LayerRenderPass(scene, camera, [LAYER_BACKDROP]);
    backdrop.clear = false;
    this.add('scenery', backdrop);

    if (opts.ao) {
      const ao = new HalfResGTAOPass(scene, camera, size.x / 2, size.y / 2);
      // Read the world pass's depth (normals rebuilt from it) instead of drawing
      // the whole scene again at half size for a depth / normal buffer.
      ao.setGBuffer(target.depthTexture!, undefined);
      ao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.6, thickness: 1.2, scale: 1.1, samples: 8 });
      ao.updatePdMaterial({ samples: 5, rings: 2, radius: 6 });
      ao.blendIntensity = 0.85;
      this.add('ao', ao);
    }

    const fx = new LayerRenderPass(scene, camera, [LAYER_FX]);
    fx.clear = false;
    this.add('fx', fx);

    const fp = new RenderPass(fpScene, fpCamera);
    fp.clear = false;
    fp.clearDepth = true;
    this.add('viewmodel', fp);

    // Glow over 1.6 (sun, flashes, fire), added while tone mapping.
    const bloom = opts.bloom ? new BloomPass(1.6) : null;
    if (bloom) this.add('bloom', bloom);
    this.add('tonemap', new FinalPass(bloom, 0.075));
    this.fxaa = new ShaderPass(FXAAShader);
    this.add('fxaa', this.fxaa);
  }

  private add(label: string, pass: Pass): void {
    this.labels.set(pass, label);
    this.composer.addPass(pass);
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.fxaa.material.uniforms.resolution!.value.set(1 / (w * pixelRatio), 1 / (h * pixelRatio));
  }

  render(): void {
    this.composer.render();
  }

  /** Wraps every pass so the F3 panel can time it on the GPU. */
  instrument(section: (label: string, fn: () => void) => void): void {
    for (const p of this.composer.passes) {
      const label = this.labels.get(p) ?? 'pass';
      const orig = p.render.bind(p);
      p.render = (...args: Parameters<typeof orig>) => section(label, () => orig(...args));
    }
  }

  dispose(): void {
    this.composer.dispose();
  }
}
