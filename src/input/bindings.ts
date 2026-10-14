/**
 * Keyboard / mouse bindings: which keys (`KeyboardEvent.code`, or `Mouse0`..`Mouse4`
 * for mouse buttons) do each action. Up to two keys an action; the defaults are
 * the game's old fixed keys, except crouch, which is C alone (Ctrl+W, a
 * crouch-walk with Ctrl, closes the browser tab, and pages can't stop it).
 * Saved in localStorage like the other settings; the settings panel edits
 * them, `KeyboardMouse` reads them, and the HUD's keycaps and hint texts show
 * them (`{k:action}` in the i18n strings).
 */
import { setKeyNames, t, type MessageKey } from '@/i18n';
import { loadJSON, saveJSON } from '@/core/storage';

export const ACTIONS = [
  'forward',
  'back',
  'left',
  'right',
  'sprint',
  'jump',
  'crouch',
  'fire',
  'ads',
  'reload',
  'interact',
  'medkit',
  'grenade',
  'melee',
  'build',
  'support',
  'breath',
  'view',
  'scoreboard',
  'inspect',
  'chat',
  'teamChat',
  'slot1',
  'slot2',
  'slot3',
  'slot4',
  'slot5',
  'slot6',
  'slot7',
  'slot8',
  'slot9',
] as const;
export type Action = (typeof ACTIONS)[number];

/** Keys an action has (0..2, primary first). */
export type Bindings = Record<Action, string[]>;

export const MAX_KEYS = 2;

export const DEFAULT_BINDINGS: Readonly<Record<Action, readonly string[]>> = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  sprint: ['ShiftLeft'],
  jump: ['Space'],
  crouch: ['KeyC'],
  fire: ['Mouse0'],
  ads: ['Mouse2'],
  reload: ['KeyR'],
  interact: ['KeyE'],
  medkit: ['KeyQ'],
  grenade: ['KeyG'],
  melee: ['KeyV'],
  build: ['KeyT'],
  support: ['KeyB'],
  breath: ['KeyX'],
  view: ['KeyC'],
  scoreboard: ['KeyZ'],
  inspect: ['Backquote'],
  chat: ['Enter'],
  teamChat: ['KeyY'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  slot4: ['Digit4'],
  slot5: ['Digit5'],
  slot6: ['Digit6'],
  slot7: ['Digit7'],
  slot8: ['Digit8'],
  slot9: ['Digit9'],
};

/**
 * Keys that can't be bound: Esc pauses (and cancels a binding), F3 / F4 are the
 * FPS panel and quality, Backspace / Delete clear a key while binding.
 */
export const RESERVED = new Set(['Escape', 'F3', 'F4', 'Backspace', 'Delete', 'MetaLeft', 'MetaRight', 'ContextMenu']);

/** Only in a vehicle: may share a key with actions only on foot (C: view there, crouch on foot). */
const VEHICLE_ONLY = new Set<Action>(['view']);
const FOOT_ONLY = new Set<Action>(['crouch', 'medkit', 'grenade', 'melee', 'build', 'breath', 'inspect', 'reload']);

const KEY = 'strikegy.keys.v1';

export function defaultBindings(): Bindings {
  const out = {} as Bindings;
  for (const a of ACTIONS) out[a] = [...DEFAULT_BINDINGS[a]];
  return out;
}

const CODE = /^(Mouse[0-4]|[A-Z][A-Za-z0-9]{1,24})$/;

/** Keeps known actions with plausible, unreserved, distinct codes; missing actions get their defaults. */
export function sanitizeBindings(raw: unknown): Bindings {
  const out = defaultBindings();
  if (!raw || typeof raw !== 'object') return out;
  for (const a of ACTIONS) {
    const v = (raw as Record<string, unknown>)[a];
    if (!Array.isArray(v)) continue;
    const keys: string[] = [];
    for (const c of v) if (typeof c === 'string' && CODE.test(c) && !RESERVED.has(c) && !keys.includes(c)) keys.push(c);
    out[a] = keys.slice(0, MAX_KEYS);
  }
  return out;
}

/** Only what differs from the defaults is stored, so later default changes reach players who never touched a key. */
function diff(b: Bindings): Partial<Bindings> {
  const out: Partial<Bindings> = {};
  for (const a of ACTIONS) if (b[a].join() !== DEFAULT_BINDINGS[a].join()) out[a] = b[a];
  return out;
}

export function loadBindings(): Bindings {
  return sanitizeBindings(loadJSON(KEY));
}

export function saveBindings(b: Bindings): void {
  const d = diff(b);
  if (Object.keys(d).length) saveJSON(KEY, d);
  else
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable */
    }
}

/** Two actions can share a key when they never apply at once (in a vehicle / on foot). */
export function canShare(a: Action, b: Action): boolean {
  return (VEHICLE_ONLY.has(a) && FOOT_ONLY.has(b)) || (VEHICLE_ONLY.has(b) && FOOT_ONLY.has(a));
}

/** Every key bound to more than one action that can't share it: code -> those actions. */
export function conflicts(b: Bindings): Map<string, Action[]> {
  const by = new Map<string, Action[]>();
  for (const a of ACTIONS) for (const c of b[a]) by.set(c, [...(by.get(c) ?? []), a]);
  const out = new Map<string, Action[]>();
  for (const [code, acts] of by) {
    const clash = acts.filter((a) => acts.some((o) => o !== a && !canShare(a, o)));
    if (clash.length > 1) out.set(code, clash);
  }
  return out;
}

/** Sets key `slot` (0 primary, 1 secondary) of an action; null clears it. A key the action already has swaps places. */
export function bind(b: Bindings, action: Action, slot: number, code: string | null): void {
  const keys = [...b[action]];
  if (code === null) keys.splice(slot, 1);
  else {
    const at = keys.indexOf(code);
    if (at < 0) {
      if (slot < keys.length) keys[slot] = code;
      else keys.push(code);
    } else if (at !== slot && slot < keys.length) {
      keys[at] = keys[slot]!;
      keys[slot] = code;
    }
  }
  b[action] = keys.slice(0, MAX_KEYS);
}

// ---------------------------------------------------------------------------
// The live table (one per page) and who listens to it

let live: Bindings | null = null;
const listeners = new Set<() => void>();
let version = 0;

/** Goes up on every change (for views that cache what they drew). */
export function bindingsVersion(): number {
  return version;
}

export function bindings(): Bindings {
  return (live ??= loadBindings());
}

/** After the table was edited in place: saves it and tells the listeners. */
export function commitBindings(): void {
  saveBindings(bindings());
  version++;
  for (const fn of listeners) fn();
}

export function resetBindings(): void {
  live = defaultBindings();
  commitBindings();
}

export function onBindingsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------------------
// Names on keycaps

const NAMES: Record<string, string> = {
  Space: 'Space',
  ShiftLeft: 'Shift',
  ShiftRight: 'RShift',
  ControlLeft: 'Ctrl',
  ControlRight: 'RCtrl',
  AltLeft: 'Alt',
  AltRight: 'RAlt',
  Backquote: '~',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  CapsLock: 'Caps',
  Enter: 'Enter',
  Tab: 'Tab',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Insert: 'Ins',
  Home: 'Home',
  End: 'End',
  IntlBackslash: '\\',
  Lang1: '한/영',
  Lang2: '한자',
  NumpadEnter: 'NumEnter',
};

/** A key's name on a keycap ('KeyR' -> 'R', 'Mouse2' -> 'RMB' / '우클릭'); never with a space (`renderHint` splits there). */
export function keyName(code: string): string {
  const mouse = /^Mouse([0-4])$/.exec(code);
  if (mouse) return t(`key.mouse${mouse[1]}` as MessageKey);
  const named = NAMES[code];
  if (named) return named;
  const m = /^(?:Key|Digit)(.)$/.exec(code) ?? /^Numpad(.+)$/.exec(code);
  if (m) return code.startsWith('Numpad') ? `Num${m[1] === 'Decimal' ? '.' : m[1]}` : m[1]!;
  return code;
}

/** An action's primary key name ('' when unbound). */
export function actionKey(action: Action): string {
  const c = bindings()[action][0];
  return c ? keyName(c) : '';
}

/** The i18n strings write keys as `{k:action}`; unbound shows as a dash. */
setKeyNames((action) => (ACTIONS.includes(action as Action) ? actionKey(action as Action) || '—' : action));
