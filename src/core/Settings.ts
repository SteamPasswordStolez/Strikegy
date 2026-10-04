import { loadJSON, saveJSON } from './storage';
import type { Locale } from '@/i18n';

export type QualityPreset = 'low' | 'medium' | 'high';

export interface Settings {
  /** Multiplier on the base mouse sensitivity. */
  sensitivity: number;
  /** Multiplier applied on top of sensitivity while aiming down sights. */
  adsSensitivity: number;
  invertY: boolean;
  /** Horizontal-ish base FOV in degrees (vertical FOV used by three.js). */
  fov: number;
  quality: QualityPreset | 'auto';
  locale: Locale;
  showFps: boolean;
  masterVolume: number;
  /** Render resolution as a share of the screen's (0.5..1; no automatic changes). */
  renderScale: number;
}

const KEY = 'strikegy.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  adsSensitivity: 0.8,
  invertY: false,
  fov: 78,
  quality: 'auto',
  locale: 'ko',
  showFps: false,
  masterVolume: 0.8,
  renderScale: 0.9,
};

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...(loadJSON<Partial<Settings>>(KEY) ?? {}) };
}

export function saveSettings(s: Settings): void {
  saveJSON(KEY, s);
}

export function isTouchDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

/** Unmasked GPU name via a throwaway WebGL context ('' if unavailable). */
export function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

/** Integrated / low-power GPUs that should start at medium quality. */
const INTEGRATED_GPU = /intel|uhd|iris|radeon\(tm\) graphics|vega \d+ graphics|mali|adreno|powervr|swiftshader|llvmpipe/i;

export function resolveQuality(q: Settings['quality']): QualityPreset {
  if (q !== 'auto') return q;
  if (isTouchDevice()) return 'low';
  return INTEGRATED_GPU.test(gpuName()) ? 'medium' : 'high';
}

export const QUALITY_ORDER: QualityPreset[] = ['low', 'medium', 'high'];
