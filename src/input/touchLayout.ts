/**
 * Player-arranged touch buttons: where each button sits (centre, as fractions
 * of the screen so it survives rotation and other phones) and how big it is.
 * Buttons without an entry keep their default place from the CSS.
 */

/** Buttons the player can move and resize. */
export const LAYOUT_BUTTONS = ['fire', 'fire2', 'ads', 'jump', 'reload', 'crouch', 'grenade', 'switch', 'melee', 'medkit', 'build', 'gadget', 'breath', 'interact'] as const;
export type LayoutButton = (typeof LAYOUT_BUTTONS)[number];

export interface ButtonPlace {
  /** Centre, 0..1 across the screen. */
  x: number;
  /** Centre, 0..1 down the screen. */
  y: number;
  /** Size multiplier. */
  s: number;
}

export type TouchLayout = Partial<Record<LayoutButton, ButtonPlace>>;

export const SIZE_MIN = 0.6;
export const SIZE_MAX = 1.6;
const KEY = 'strikegy.touchLayout.v1';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Keeps only known buttons with sane numbers (centres on screen, sizes in range). */
export function sanitizeLayout(raw: unknown): TouchLayout {
  const out: TouchLayout = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const id of LAYOUT_BUTTONS) {
    const p = (raw as Record<string, unknown>)[id];
    if (!p || typeof p !== 'object') continue;
    const { x, y, s } = p as Record<string, unknown>;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    out[id] = {
      x: clamp(x, 0.02, 0.98),
      y: clamp(y, 0.02, 0.98),
      s: typeof s === 'number' && Number.isFinite(s) ? clamp(s, SIZE_MIN, SIZE_MAX) : 1,
    };
  }
  return out;
}

export function loadLayout(): TouchLayout {
  try {
    const text = localStorage.getItem(KEY);
    return text ? sanitizeLayout(JSON.parse(text)) : {};
  } catch {
    return {};
  }
}

export function saveLayout(layout: TouchLayout): void {
  try {
    if (Object.keys(layout).length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // Private mode or storage blocked: the layout lasts for this visit only.
  }
}
