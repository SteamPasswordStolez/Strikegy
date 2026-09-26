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

export function resolveQuality(q: Settings['quality']): QualityPreset {
  if (q !== 'auto') return q;
  return isTouchDevice() ? 'low' : 'high';
}
