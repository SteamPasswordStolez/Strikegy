import * as THREE from 'three';
import type { QualityPreset } from '@/core/Settings';
import { PostFX } from './PostFX';
import { LAYER_BACKDROP, LAYER_FX } from './layers';
import { installGradeToneMapping } from './grade';
import { DynamicResolution } from './dynamicResolution';
import { loadJSON, saveJSON } from '@/core/storage';

installGradeToneMapping();

export interface QualityConfig {
  /** Upper bound on device pixel ratio before dynamic resolution. */
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  shadowExtent: number;
  /** Re-render the shadow map every N frames (static-heavy scenes don't need 60 Hz). */
  shadowInterval: number;
  textureSize: number;
  postfx: boolean;
  /** Hardware MSAA on the canvas (direct rendering only; the post chain uses FXAA). */
  msaa: boolean;
  ao: boolean;
  bloom: boolean;
  /** Point lights for muzzle flashes / explosions (each costs every lit pixel). */
  dynamicLights: number;
  /** Max rendered pixels (millions) before upscaling; Infinity = native. */
  pixelBudget: number;
  /** Detail of scenery outside the playable area. */
  backdropDetail: 'low' | 'high';
}

export const QUALITY: Record<QualityPreset, QualityConfig> = {
  low: {
    pixelRatioCap: 1,
    shadows: false,
    shadowMapSize: 1024,
    shadowExtent: 30,
    shadowInterval: 2,
    textureSize: 256,
    postfx: false,
    msaa: false,
    pixelBudget: 0.9,
    ao: false,
    bloom: false,
    dynamicLights: 0,
    backdropDetail: 'low',
  },
  medium: {
    pixelRatioCap: 1,
    shadows: true,
    shadowMapSize: 2048,
    shadowExtent: 35,
    shadowInterval: 2,
    textureSize: 512,
    // Without AO/bloom the post chain only added full-screen passes (~10 ms at
    // 1080p on integrated GPUs); direct rendering with MSAA looks the same.
    postfx: false,
    msaa: true,
    pixelBudget: 1.5,
    ao: false,
    bloom: false,
    dynamicLights: 0,
    backdropDetail: 'low',
  },
  high: {
    pixelRatioCap: 1.25,
    shadows: true,
    shadowMapSize: 3072,
    shadowExtent: 40,
    shadowInterval: 2,
    textureSize: 512,
    postfx: true,
    msaa: false,
    pixelBudget: Infinity,
    ao: true,
    bloom: true,
    dynamicLights: 1,
    backdropDetail: 'high',
  },
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
  private readonly vignette: HTMLDivElement;
  private frameIndex = 0;
  /**
   * Shadow maps are only re-rendered when requested (static world, fitted once)
   * or, in follow mode, every `shadowInterval` frames.
   */
  staticShadows = false;
  /** Optional GPU timing hook (F3 panel). */
  private section: (label: string, fn: () => void) => void = (_l, fn) => fn();
  private shadowDirty = true;
  private readonly drs = new DynamicResolution();

  constructor(
    container: HTMLElement,
    readonly preset: QualityPreset,
    fov: number,
  ) {
    this.quality = QUALITY[preset];
    this.gl = new THREE.WebGLRenderer({
      antialias: this.quality.msaa,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.gl.setPixelRatio(this.pixelRatio);
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.CustomToneMapping; // ACES + grade, see grade.ts
    this.gl.shadowMap.enabled = this.quality.shadows;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.shadowMap.autoUpdate = false;
    this.gl.autoClear = false;
    container.appendChild(this.gl.domElement);
    // Vignette as a composited overlay instead of a shader pass.
    this.vignette = document.createElement('div');
    this.vignette.className = 'vignette';
    container.appendChild(this.vignette);

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
      });
    } else {
      // Direct rendering draws effects with the world; the post chain splits them (see layers.ts).
      this.camera.layers.enable(LAYER_FX);
      this.camera.layers.enable(LAYER_BACKDROP);
    }

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  /** Current dynamic-resolution scale (1 = native up to the cap). */
  get renderScale(): number {
    return this.drs.scale;
  }

  private get scaleKey(): string {
    return `strikegy.renderScale.${this.preset}`;
  }

  private get pixelRatio(): number {
    return Math.min(window.devicePixelRatio, this.quality.pixelRatioCap) * this.renderScale;
  }

  get maxAnisotropy(): number {
    return this.gl.capabilities.getMaxAnisotropy();
  }

  get canvas(): HTMLCanvasElement {
    return this.gl.domElement;
  }

  private resize = (): void => {
    const base = Math.min(window.devicePixelRatio, this.quality.pixelRatioCap);
    const pixels = window.innerWidth * window.innerHeight * base * base;
    // Large screens start below native and upscale; dynamic resolution never exceeds it.
    this.drs.setMax(Math.floor(Math.sqrt((this.quality.pixelBudget * 1e6) / pixels) * 20) / 20);
    // Start where this preset settled last time instead of re-learning it.
    this.drs.restart(loadJSON<number>(this.scaleKey) ?? 1);
    this.applySize();
  };

  private applySize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setPixelRatio(this.pixelRatio);
    this.gl.setSize(w, h);
    this.postfx?.setSize(w, h, this.pixelRatio);
    this.camera.aspect = this.fpCamera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fpCamera.updateProjectionMatrix();
  }

  /** Installs a timing hook around each render section / post pass. */
  instrument(section: (label: string, fn: () => void) => void): void {
    this.section = section;
    this.postfx?.instrument(section);
  }

  /** Something that casts shadows moved: re-render the (static) shadow map soon. */
  requestShadowUpdate(): void {
    this.shadowDirty = true;
  }

  /** Feeds a frame into dynamic resolution; resizes when the scale changes. */
  adaptResolution(frameMs: number, dt: number): void {
    const next = this.drs.update(dt, frameMs);
    if (next === null) return;
    saveJSON(this.scaleKey, next);
    this.applySize();
  }

  /** Draws a frame; returns true if the shadow map was re-rendered in it. */
  render(): boolean {
    this.frameIndex++;
    let shadow = false;
    if (this.quality.shadows) {
      // The first frame must render shadows: materials sample the shadow map from the start.
      const due = this.frameIndex === 1 || this.frameIndex % this.quality.shadowInterval === 0;
      if (this.staticShadows ? this.shadowDirty && due : due) {
        this.gl.shadowMap.needsUpdate = true;
        this.shadowDirty = false;
        shadow = true;
      }
    }
    if (this.postfx) {
      this.postfx.render();
    } else {
      // World first, then scenery: walls fill depth so the forest behind them is rejected early.
      const cam = this.camera;
      const mask = cam.layers.mask;
      this.section('world', () => {
        this.gl.clear();
        cam.layers.disable(LAYER_BACKDROP);
        this.gl.render(this.scene, cam);
      });
      this.section('scenery', () => {
        cam.layers.set(LAYER_BACKDROP);
        this.gl.render(this.scene, cam);
      });
      cam.layers.mask = mask;
      this.section('viewmodel', () => {
        this.gl.clearDepth();
        this.gl.render(this.fpScene, this.fpCamera);
      });
    }
    return shadow;
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.postfx?.dispose();
    this.gl.dispose();
    this.gl.domElement.remove();
    this.vignette.remove();
  }
}
