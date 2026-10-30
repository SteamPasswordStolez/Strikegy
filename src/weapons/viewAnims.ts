import * as THREE from 'three';

/**
 * Keyframed first-person motions (reload hands, inspect, melee). A track is a
 * list of keys at normalized times 0..1; values are eased between keys. Hand
 * keys are relative to a named anchor on the gun (the magazine, the charging
 * handle...), so one track fits every gun.
 */
export type Vec = readonly [number, number, number];

export interface Key<A extends string = never> {
  t: number;
  v: Vec;
  /** Anchor the value is relative to (hand tracks); omitted = the hand's rest spot. */
  at?: A;
}

const ease = (x: number) => x * x * (3 - 2 * x);

/** Samples a track at `t` into `out`; `anchor` resolves each key's anchor offset. */
export function sampleTrack<A extends string>(
  keys: readonly Key<A>[],
  t: number,
  out: THREE.Vector3,
  anchor?: (a: A) => THREE.Vector3,
): THREE.Vector3 {
  const value = (k: Key<A>, into: THREE.Vector3) => {
    into.set(k.v[0], k.v[1], k.v[2]);
    if (k.at && anchor) into.add(anchor(k.at));
    return into;
  };
  if (t <= keys[0]!.t) return value(keys[0]!, out);
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (t <= b.t) {
      const a = keys[i - 1]!;
      const f = b.t > a.t ? ease((t - a.t) / (b.t - a.t)) : 1;
      value(a, out);
      return out.lerp(value(b, tmp), f);
    }
  }
  return value(keys[keys.length - 1]!, out);
}
const tmp = new THREE.Vector3();

/** Whole-gun pose while reloading (blended in and out): offset and rotation. */
export const RELOAD_POSE = {
  mag: { pos: [-0.05, 0.035, 0.02] as Vec, rot: [0.16, 0.42, -0.58] as Vec },
  shell: { pos: [-0.05, 0.02, 0.03] as Vec, rot: [0.1, 0.3, -0.6] as Vec },
};

/** Hand anchors: the magazine grip, the charging handle / slide, the loading port, the bolt catch. */
export type HandAnchor = 'mag' | 'chamber' | 'port' | 'catch';

const O: Vec = [0, 0, 0];
/** The hand down at the pouches, out of view. */
const MAG_AWAY: Vec = [-0.07, -0.32, 0.12];

/**
 * A magazine reload, two ways (0..1 of the reload time; the sound cues stay
 * at 0.2 magazine out, 0.62 in, 0.86 bolt; owner, 2026-10-30: CoD-like):
 * - with rounds left: the support hand takes the magazine, pulls it down and
 *   away, swaps it at the pouch for a full one, brings it up, seats it with a
 *   push and a slap of the palm under it, and goes back to the handguard as
 *   the gun is tipped back level;
 * - empty: the hand thumbs the release and the empty magazine drops free
 *   (ViewModel lets it fall), the hand goes straight to the pouch, seats the
 *   new one, then slaps the bolt catch on the receiver's left side.
 */
export interface MagReload {
  hand: readonly Key<HandAnchor>[];
  handRot: readonly Key[];
  /** The magazine moves with the hand between these times. */
  held: readonly [number, number];
  /** The gun's own jolts (extra offset / rotation on top of the reload pose). */
  gunPos: readonly Key[];
  gunRot: readonly Key[];
}

export const RELOAD_TACTICAL: MagReload = {
  hand: [
    { t: 0, v: O },
    { t: 0.08, v: [-0.01, -0.03, 0.03], at: 'mag' },
    { t: 0.15, v: O, at: 'mag' },
    { t: 0.2, v: O, at: 'mag' },
    { t: 0.27, v: [0, -0.07, 0.015], at: 'mag' },
    { t: 0.36, v: MAG_AWAY, at: 'mag' },
    { t: 0.44, v: MAG_AWAY, at: 'mag' },
    { t: 0.53, v: [-0.01, -0.07, 0.01], at: 'mag' },
    { t: 0.58, v: [0, -0.016, 0], at: 'mag' },
    { t: 0.62, v: O, at: 'mag' },
    { t: 0.645, v: [0, 0.016, 0], at: 'mag' },
    { t: 0.68, v: [0, 0.004, 0], at: 'mag' },
    { t: 0.84, v: [0, -0.01, -0.01] },
    { t: 1, v: O },
  ],
  handRot: [
    { t: 0, v: O },
    { t: 0.12, v: [0.25, 0, 0.55] },
    { t: 0.3, v: [0.5, 0.1, 0.7] },
    { t: 0.44, v: [0.6, 0.15, 0.8] },
    { t: 0.56, v: [0.25, 0, 0.55] },
    { t: 0.64, v: [0.1, 0, 0.4] },
    { t: 0.82, v: [0, 0, 0.05] },
    { t: 1, v: O },
  ],
  held: [0.2, 0.62],
  gunPos: [
    { t: 0, v: O },
    { t: 0.19, v: O },
    { t: 0.23, v: [0, -0.008, 0] },
    { t: 0.3, v: O },
    { t: 0.6, v: O },
    { t: 0.625, v: [0, 0.012, -0.004] },
    { t: 0.65, v: [0, -0.004, 0] },
    { t: 0.72, v: O },
    { t: 0.84, v: O },
    { t: 0.88, v: [0, 0.004, 0.006] },
    { t: 1, v: O },
  ],
  gunRot: [
    { t: 0, v: O },
    { t: 0.19, v: O },
    { t: 0.24, v: [-0.03, 0, 0.02] },
    { t: 0.32, v: O },
    { t: 0.6, v: O },
    { t: 0.63, v: [0.07, 0, -0.05] },
    { t: 0.66, v: [-0.02, 0, 0.015] },
    { t: 0.72, v: O },
    { t: 0.84, v: O },
    // Tipped back level with a small shake as the hand returns.
    { t: 0.88, v: [0.03, -0.02, 0.04] },
    { t: 0.94, v: O },
    { t: 1, v: O },
  ],
};

export const RELOAD_EMPTY: MagReload = {
  hand: [
    { t: 0, v: O },
    { t: 0.08, v: [-0.01, -0.03, 0.03], at: 'mag' },
    { t: 0.15, v: [0, -0.004, 0], at: 'mag' },
    // Thumb on the release, the magazine falls; the hand is already on its way down.
    { t: 0.2, v: [0, -0.01, 0], at: 'mag' },
    { t: 0.34, v: MAG_AWAY, at: 'mag' },
    { t: 0.44, v: MAG_AWAY, at: 'mag' },
    { t: 0.53, v: [-0.01, -0.07, 0.01], at: 'mag' },
    { t: 0.58, v: [0, -0.016, 0], at: 'mag' },
    { t: 0.62, v: O, at: 'mag' },
    { t: 0.645, v: [0, 0.016, 0], at: 'mag' },
    { t: 0.68, v: [0, 0.004, 0], at: 'mag' },
    { t: 0.78, v: [-0.018, 0, 0.01], at: 'catch' },
    { t: 0.84, v: [-0.012, 0, 0], at: 'catch' },
    { t: 0.86, v: O, at: 'catch' },
    { t: 0.9, v: [-0.015, 0.004, 0], at: 'catch' },
    { t: 1, v: O },
  ],
  handRot: [
    { t: 0, v: O },
    { t: 0.12, v: [0.25, 0, 0.55] },
    { t: 0.3, v: [0.5, 0.1, 0.7] },
    { t: 0.44, v: [0.6, 0.15, 0.8] },
    { t: 0.56, v: [0.25, 0, 0.55] },
    { t: 0.66, v: [0.1, 0, 0.4] },
    // Palm against the receiver's side, fingers along it.
    { t: 0.78, v: [0.1, 0.25, 0.55] },
    { t: 0.9, v: [0.1, 0.25, 0.55] },
    { t: 1, v: O },
  ],
  held: [0.34, 0.62],
  gunPos: [
    { t: 0, v: O },
    { t: 0.19, v: O },
    { t: 0.22, v: [0, 0.004, 0] },
    { t: 0.28, v: O },
    { t: 0.6, v: O },
    { t: 0.625, v: [0, 0.012, -0.004] },
    { t: 0.65, v: [0, -0.004, 0] },
    { t: 0.72, v: O },
    { t: 0.855, v: O },
    { t: 0.875, v: [0.006, 0.003, 0.008] },
    { t: 0.93, v: O },
    { t: 1, v: O },
  ],
  gunRot: [
    { t: 0, v: O },
    { t: 0.6, v: O },
    { t: 0.63, v: [0.07, 0, -0.05] },
    { t: 0.66, v: [-0.02, 0, 0.015] },
    { t: 0.72, v: O },
    { t: 0.855, v: O },
    // The bolt slams home: the gun jumps.
    { t: 0.875, v: [-0.06, 0.04, -0.06] },
    { t: 0.92, v: [0.015, -0.01, 0.01] },
    { t: 0.97, v: O },
    { t: 1, v: O },
  ],
};

/**
 * Pistols, empty: the same drop and new magazine, then the hand goes back
 * round the grip and the thumb drops the slide (ViewModel holds the slide
 * back until the bolt cue).
 */
export const RELOAD_EMPTY_PISTOL: MagReload = {
  ...RELOAD_EMPTY,
  hand: [...RELOAD_EMPTY.hand.filter((k) => k.t <= 0.68), { t: 0.8, v: O }, { t: 1, v: O }],
  handRot: [...RELOAD_EMPTY.handRot.filter((k) => k.t <= 0.66), { t: 0.8, v: O }, { t: 1, v: O }],
};

/** The empty magazine's drop (reload time it is let go). */
export const MAG_DROP_T = 0.2;

/** One shell (0..1 of the insert time): fetch from below, push into the port. */
const SHELL_FETCH: Vec = [-0.05, -0.18, 0.12];
export const SHELL_HAND: readonly Key<HandAnchor>[] = [
  { t: 0, v: SHELL_FETCH, at: 'port' },
  { t: 0.3, v: SHELL_FETCH, at: 'port' },
  { t: 0.6, v: [0, -0.012, 0.035], at: 'port' },
  { t: 0.74, v: O, at: 'port' },
  { t: 0.84, v: O, at: 'port' },
  { t: 1, v: SHELL_FETCH, at: 'port' },
];
/** The shell shows in the hand until it is pushed in. */
export const SHELL_IN_HAND_UNTIL = 0.76;

/** Weapon inspection: turn the gun to show its left side, check the magazine, then the right side. */
export const INSPECT_POS: readonly Key[] = [
  { t: 0, v: O },
  { t: 0.14, v: [-0.07, 0.05, 0.06] },
  { t: 0.44, v: [-0.075, 0.055, 0.06] },
  { t: 0.56, v: [-0.01, 0.04, 0.03] },
  { t: 0.82, v: [-0.01, 0.045, 0.03] },
  { t: 1, v: O },
];
export const INSPECT_ROT: readonly Key[] = [
  { t: 0, v: O },
  { t: 0.14, v: [0.15, 0.85, 0.45] },
  { t: 0.44, v: [0.1, 0.92, 0.5] },
  { t: 0.56, v: [0.05, -0.75, -0.3] },
  { t: 0.82, v: [0.04, -0.8, -0.25] },
  { t: 1, v: O },
];
/** Magazine check during the inspection (mag-fed guns). */
export const INSPECT_HAND: readonly Key<HandAnchor>[] = [
  { t: 0, v: O },
  { t: 0.16, v: [0, -0.01, 0.02], at: 'mag' },
  { t: 0.22, v: O, at: 'mag' },
  { t: 0.29, v: [0, -0.06, 0.01], at: 'mag' },
  { t: 0.35, v: [0, -0.06, 0.01], at: 'mag' },
  { t: 0.41, v: O, at: 'mag' },
  { t: 0.5, v: O },
  { t: 1, v: O },
];
export const INSPECT_MAG_HELD: readonly [number, number] = [0.22, 0.41];
/** Magazine pulled / seated during the inspection (cue times). */
export const INSPECT_CUES = { magOut: 0.24, magIn: 0.4 } as const;

/** A melee motion: whole-gun offset and rotation tracks over the swing (0..1). */
export interface MeleeMove {
  name: string;
  pos: readonly Key[];
  rot: readonly Key[];
}

/** Every swing lands at this point of the track (the hit is resolved at MELEE_HIT / MELEE_TIME). */
export const MELEE_STRIKE_T = 0.38;

const move = (name: string, windup: [Vec, Vec], strike: [Vec, Vec], follow: [Vec, Vec]): MeleeMove => ({
  name,
  pos: [
    { t: 0, v: O },
    { t: 0.25, v: windup[0] },
    { t: MELEE_STRIKE_T, v: strike[0] },
    { t: 0.5, v: follow[0] },
    { t: 1, v: O },
  ],
  rot: [
    { t: 0, v: O },
    { t: 0.25, v: windup[1] },
    { t: MELEE_STRIKE_T, v: strike[1] },
    { t: 0.5, v: follow[1] },
    { t: 1, v: O },
  ],
});

/** Long guns: one is picked at random for each swing (never the same twice in a row). */
export const MELEE_LONG: readonly MeleeMove[] = [
  // Horizontal buttstroke: wind up to the right, swing the gun across.
  move('buttstroke', [[0.05, -0.03, 0.1], [0.15, -0.45, -0.35]], [[-0.12, 0.04, -0.26], [0, 0.55, 1.0]], [[-0.1, 0.03, -0.2], [0, 0.5, 0.9]]),
  // Muzzle thrust: pull the gun back to the chest, drive it straight forward.
  move('thrust', [[-0.03, 0.02, 0.12], [0.08, 0.1, 0.25]], [[-0.07, 0.03, -0.3], [-0.04, 0.12, 0.1]], [[-0.06, 0.02, -0.26], [-0.02, 0.1, 0.08]]),
  // Overhead chop: raise the gun, bring it down hard.
  move('chop', [[-0.02, 0.12, 0.06], [0.55, 0.15, 0.3]], [[-0.06, -0.06, -0.22], [-0.45, 0.2, 0.5]], [[-0.05, -0.07, -0.18], [-0.5, 0.2, 0.45]]),
  // Butt jab: turn the gun so the stock leads, punch it forward.
  move('buttJab', [[0.06, 0.0, 0.08], [0.1, -0.35, -0.6]], [[-0.1, 0.06, -0.2], [0.2, 0.9, 1.3]], [[-0.09, 0.05, -0.16], [0.18, 0.85, 1.2]]),
];

/** Pistols: a downward whip, a backhand, a grip punch. */
export const MELEE_PISTOL: readonly MeleeMove[] = [
  move('whip', [[0.02, 0.06, 0.08], [0.7, -0.2, -0.3]], [[-0.04, -0.05, -0.22], [-0.6, 0.2, 0.6]], [[-0.03, -0.04, -0.18], [-0.5, 0.15, 0.5]]),
  move('backhand', [[-0.08, 0.03, 0.06], [0.2, 0.6, 0.8]], [[0.06, 0.0, -0.2], [-0.1, -0.5, -0.7]], [[0.05, -0.01, -0.16], [-0.1, -0.45, -0.6]]),
  move('gripPunch', [[0.01, -0.01, 0.1], [-0.25, 0.1, 0.2]], [[-0.03, -0.03, -0.24], [-0.5, 0.15, 0.3]], [[-0.03, -0.03, -0.2], [-0.45, 0.12, 0.25]]),
];

/** Picks the next swing from a set, avoiding a repeat of the last one. */
export function pickMelee(set: readonly MeleeMove[], last: number, rand: () => number = Math.random): number {
  if (set.length < 2) return 0;
  const i = Math.floor(rand() * (set.length - 1));
  return i >= last ? i + 1 : i;
}
