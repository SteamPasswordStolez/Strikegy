import { loadJSON, saveJSON } from './storage';
import type { Locale } from '@/i18n';

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

/**
 * The graphics items one by one (owner, 2026-11-01: "split the graphics options like other games"):
 * a preset sets them all, any of them can be set on its own (`Settings.gfx`, then the preset reads
 * 사용자 지정). Applied when a match loads (render/quality.ts turns them into the renderer's numbers).
 */
export interface GfxOptions {
  shadows: 'off' | 'low' | 'medium' | 'high' | 'ultra';
  textures: 'low' | 'medium' | 'high';
  filtering: 2 | 4 | 8 | 16;
  antialias: 'off' | 'fxaa' | 'msaa';
  ao: boolean;
  bloom: boolean;
  effects: 'low' | 'medium' | 'high' | 'ultra';
  terrain: 'low' | 'high';
  grass: boolean;
  trees: 'near' | 'normal' | 'far';
  scenery: 'low' | 'high';
}

export interface Settings {
  /** Multiplier on the base mouse sensitivity. */
  sensitivity: number;
  /** Multiplier applied on top of sensitivity while aiming down sights. */
  adsSensitivity: number;
  invertY: boolean;
  /** Horizontal-ish base FOV in degrees (vertical FOV used by three.js). */
  fov: number;
  quality: QualityPreset | 'auto';
  /** Graphics items set apart from the preset (empty: all as the preset says). */
  gfx: Partial<GfxOptions>;
  locale: Locale;
  /** The player chose the language (else it follows the region at every load). */
  localePicked?: boolean;
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
  /** From level 1000 (원수): the marshal's track in the menu instead of the usual one. */
  marshalMusic: boolean;
  /** Level ups and promotions near the top of the screen during a match. */
  progressNotices: 'all' | 'levels' | 'off';
  /** Kill effects (progression step 6): everyone's, one's own only, or none (an ordinary fall). */
  killFx: 'all' | 'mine' | 'off';
  /** The player's soldier: a man or a woman (owner, 2026-10-25; others see it in rooms). */
  soldierSex: 'm' | 'f';
  /** The view moving with steps, landings and slides (cameraMotion.ts): normal, low or off (motion sickness). */
  cameraBob: 'full' | 'low' | 'off';
  /** On going down or dying: the view turns to whoever did it for a moment (Battlefield-style, 2026-11). */
  killCam: boolean;
}

const KEY = 'strikegy.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  adsSensitivity: 0.8,
  invertY: false,
  fov: 78,
  quality: 'auto',
  gfx: {},
  locale: 'ko',
  showFps: false,
  masterVolume: 0.8,
  voiceVolume: 1,
  subtitles: true,
  renderScale: 0.9,
  crouchHold: false,
  menuScene: true,
  progressNotices: 'all',
  killFx: 'all',
  soldierSex: 'm',
  cameraBob: 'full',
  killCam: true,
  musicVolume: 0.5,
  marshalMusic: true,
  inputMode: 'auto',
};

/** The device's time zone, '' when the browser won't say. */
function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

/**
 * Korean in Korea, English everywhere else, until the player picks one (owner,
 * 2026-11-01). The region is the device's time zone: no address is looked up.
 * Without a time zone the browser's first language decides.
 */
export function regionLocale(timeZone = deviceTimeZone(), languages: readonly string[] = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])): Locale {
  if (timeZone) return timeZone === 'Asia/Seoul' || timeZone === 'ROK' ? 'ko' : 'en';
  const first = languages.find((l) => !!l);
  return !first || first.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export function loadSettings(): Settings {
  const saved = loadJSON<Partial<Settings>>(KEY) ?? {};
  const out = { ...DEFAULT_SETTINGS, ...saved };
  // Saving any setting also saves the language then in use: only one the player picked counts.
  if (!saved.localePicked) out.locale = regionLocale();
  return out;
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

export const QUALITY_ORDER: QualityPreset[] = ['low', 'medium', 'high', 'ultra'];

/** What each preset sets every graphics item to (Settings → 그래픽). */
export const PRESET_GFX: Record<QualityPreset, GfxOptions> = {
  low: { shadows: 'off', textures: 'low', filtering: 2, antialias: 'off', ao: false, bloom: false, effects: 'low', terrain: 'low', grass: false, trees: 'near', scenery: 'low' },
  // Without AO / bloom the post chain only added full-screen passes (~10 ms at 1080p on
  // integrated GPUs); direct rendering with MSAA looks the same.
  medium: { shadows: 'medium', textures: 'medium', filtering: 4, antialias: 'msaa', ao: false, bloom: false, effects: 'medium', terrain: 'high', grass: true, trees: 'normal', scenery: 'low' },
  high: { shadows: 'high', textures: 'medium', filtering: 8, antialias: 'fxaa', ao: true, bloom: true, effects: 'high', terrain: 'high', grass: true, trees: 'normal', scenery: 'high' },
  // Strong GPUs (owner, 2026-11-01: better quality where there is room): larger and sharper shadows,
  // a wider near shadow, full-size procedural surfaces, 16x filtering, more AO samples, two flash lights.
  ultra: { shadows: 'ultra', textures: 'high', filtering: 16, antialias: 'fxaa', ao: true, bloom: true, effects: 'ultra', terrain: 'high', grass: true, trees: 'far', scenery: 'high' },
};

/** The items a preset and the player's own picks come to. */
export function gfxFor(preset: QualityPreset, overrides: Partial<GfxOptions> = {}): GfxOptions {
  return { ...PRESET_GFX[preset], ...overrides };
}
