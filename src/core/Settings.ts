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
  /** The battle briefing's voice (0..1, under the master volume). */
  voiceVolume: number;
  /** The briefing's spoken lines as text (owner, 2026-10-17: on by default). */
  subtitles: boolean;
  /** Render resolution as a share of the screen's (0.5..1; no automatic changes). */
  renderScale: number;
  /** Crouch while the key is held (keyboard), instead of a press toggling it. */
  crouchHold: boolean;
  /** A live battle behind the main menu (desktop; touch screens never run it). */
  menuScene: boolean;
  /**
   * Keyboard and mouse or touch controls: picked by the device (`auto`), or
   * forced when that guess is wrong (a touch-screen laptop, a tablet with a mouse).
   */
  inputMode: 'auto' | 'desktop' | 'touch';
  /** Music in the menus, loading and results (0..1, under the master volume). */
  musicVolume: number;
  /** Level ups and promotions near the top of the screen during a match. */
  progressNotices: 'all' | 'levels' | 'off';
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
  voiceVolume: 1,
  subtitles: true,
  renderScale: 0.9,
  crouchHold: false,
  menuScene: true,
  progressNotices: 'all',
  musicVolume: 0.5,
  inputMode: 'auto',
};

/** Korean for browsers set to Korean, English for everyone else (until the player picks one). */
export function browserLocale(languages: readonly string[] = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])): Locale {
  const first = languages.find((l) => !!l);
  return !first || first.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, locale: browserLocale(), ...(loadJSON<Partial<Settings>>(KEY) ?? {}) };
}

export function saveSettings(s: Settings): void {
  saveJSON(KEY, s);
}

/**
 * Touch controls or keyboard and mouse: the setting (조작 → 조작 방식) when it
 * is forced, else the device. A finger as the main pointer is touch; a mouse or
 * touchpad anywhere is keyboard and mouse even with a touch screen (touch-screen
 * laptops report touch points too: counting those put the phone controls and no
 * pointer lock on some PCs, owner 2026-10-24); touch points alone are touch.
 */
export function isTouchDevice(): boolean {
  const mode = loadJSON<Partial<Settings>>(KEY)?.inputMode;
  if (mode === 'touch') return true;
  if (mode === 'desktop') return false;
  return detectTouch();
}

/** What the device looks like, settings aside. */
export function detectTouch(): boolean {
  const media = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
  if (media('(pointer: coarse)')) return true;
  if (media('(any-pointer: fine)') || media('(any-hover: hover)')) return false;
  return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
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
