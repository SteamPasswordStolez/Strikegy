import * as THREE from 'three';
import type { QualityPreset } from '@/core/Settings';

interface QualityConfig {
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  antialias: boolean;
}

export const QUALITY: Record<QualityPreset, QualityConfig> = {
  low: { pixelRatioCap: 1, shadows: false, shadowMapSize: 1024, antialias: false },
  medium: { pixelRatioCap: 1.25, shadows: true, shadowMapSize: 1024, antialias: true },
  high: { pixelRatioCap: 1.5, shadows: true, shadowMapSize: 2048, antialias: true },
};

/**
 * Owns the WebGL renderer and draws the world scene followed by a separate
 * first-person scene (viewmodel) on top, so weapons never clip into walls.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly fpScene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Viewmodel camera: fixed narrow FOV that does not change with ADS zoom. */
  readonly fpCamera: THREE.PerspectiveCamera;
  readonly quality: QualityConfig;

  constructor(
    container: HTMLElement,
    preset: QualityPreset,
    fov: number,
  ) {
    this.quality = QUALITY[preset];
    this.gl = new THREE.WebGLRenderer({
      antialias: this.quality.antialias,
      powerPreference: 'high-performance',
    });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatioCap));
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.shadowMap.enabled = this.quality.shadows;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.autoClear = false;
    container.appendChild(this.gl.domElement);

    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 1500);
    this.fpCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.scene.add(this.camera);

    // Viewmodel lighting is independent of the world so the gun reads clearly.
    this.fpScene.add(new THREE.HemisphereLight(0xdfe8f5, 0x3a3228, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(1, 2, 1);
    this.fpScene.add(key);

    this.resize();
    window.addEventListener('resize', this.resize);
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
    this.camera.aspect = this.fpCamera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fpCamera.updateProjectionMatrix();
  };

  render(): void {
    this.gl.clear();
    this.gl.render(this.scene, this.camera);
    this.gl.clearDepth();
    this.gl.render(this.fpScene, this.fpCamera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.gl.dispose();
    this.gl.domElement.remove();
  }
}
