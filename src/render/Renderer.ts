import * as THREE from 'three';
import type { QualityPreset } from '@/core/Settings';
import { PostFX } from './PostFX';
import { LAYER_FX } from './layers';

export interface QualityConfig {
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  shadowExtent: number;
  textureSize: number;
  postfx: boolean;
  ao: boolean;
  bloom: boolean;
  /** Hardware MSAA; only used when post-processing is off (SMAA handles it otherwise). */
  msaa: boolean;
}

export const QUALITY: Record<QualityPreset, QualityConfig> = {
  low: { pixelRatioCap: 1, shadows: false, shadowMapSize: 1024, shadowExtent: 30, textureSize: 256, postfx: false, ao: false, bloom: false, msaa: false },
  medium: { pixelRatioCap: 1.25, shadows: true, shadowMapSize: 2048, shadowExtent: 40, textureSize: 512, postfx: true, ao: false, bloom: true, msaa: false },
  high: { pixelRatioCap: 1.5, shadows: true, shadowMapSize: 4096, shadowExtent: 50, textureSize: 512, postfx: true, ao: true, bloom: true, msaa: false },
};

/**
 * Owns the WebGL renderer. The world scene is drawn first, then a separate
 * first-person scene (viewmodel) on top with a cleared depth buffer so
 * weapons never clip into walls.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly fpScene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Viewmodel camera: fixed FOV that does not change with ADS zoom. */
  readonly fpCamera: THREE.PerspectiveCamera;
  readonly quality: QualityConfig;
  private postfx: PostFX | null = null;

  constructor(container: HTMLElement, preset: QualityPreset, fov: number) {
    this.quality = QUALITY[preset];
    this.gl = new THREE.WebGLRenderer({
      antialias: this.quality.msaa,
      powerPreference: 'high-performance',
    });
    this.gl.setPixelRatio(this.pixelRatio);
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.shadowMap.enabled = this.quality.shadows;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.autoClear = false;
    container.appendChild(this.gl.domElement);

    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 1600);
    this.fpCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.scene.add(this.camera);

    // Viewmodel key light roughly matches the sun; ambient comes from the environment map.
    this.fpScene.add(new THREE.HemisphereLight(0xdfe8f5, 0x3a3228, 0.5));
    const key = new THREE.DirectionalLight(0xfff1de, 1.8);
    key.position.set(1.5, 2, 0.5);
    this.fpScene.add(key);

    if (this.quality.postfx) {
      this.postfx = new PostFX(this.gl, this.scene, this.camera, this.fpScene, this.fpCamera, {
        ao: this.quality.ao,
        bloom: this.quality.bloom,
        smaa: true,
      });
    } else {
      // Direct rendering draws effects with the world; the post chain splits them (see layers.ts).
      this.camera.layers.enable(LAYER_FX);
    }

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private get pixelRatio(): number {
    return Math.min(window.devicePixelRatio, this.quality.pixelRatioCap);
  }

  get maxAnisotropy(): number {
    return this.gl.capabilities.getMaxAnisotropy();
  }

  get canvas(): HTMLCanvasElement {
    return this.gl.domElement;
  }

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setSize(w, h);
    this.postfx?.setSize(w, h, this.pixelRatio);
    this.camera.aspect = this.fpCamera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fpCamera.updateProjectionMatrix();
  };

  render(): void {
    if (this.postfx) {
      this.postfx.render();
      return;
    }
    this.gl.clear();
    this.gl.render(this.scene, this.camera);
    this.gl.clearDepth();
    this.gl.render(this.fpScene, this.fpCamera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.postfx?.dispose();
    this.gl.dispose();
    this.gl.domElement.remove();
  }
}
