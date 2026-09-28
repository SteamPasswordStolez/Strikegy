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
  mag: { pos: [-0.06, 0.03, 0.03] as Vec, rot: [0.12, 0.35, -0.4] as Vec },
  shell: { pos: [-0.05, 0.02, 0.03] as Vec, rot: [0.1, 0.3, -0.6] as Vec },
};

/** Hand anchors: the magazine grip, the charging handle / slide, the loading port. */
export type HandAnchor = 'mag' | 'chamber' | 'port';

const O: Vec = [0, 0, 0];
/** The hand carries the magazine down and out of view, then back. */
const MAG_AWAY: Vec = [-0.06, -0.3, 0.1];

/**
 * Magazine reload (0..1 of the reload time): support hand to the magazine,
 * pulls it (cue at 0.2), takes it off screen, brings a fresh one, seats it
 * (cue at 0.62) with a slap, works the charging handle / slide (cue at 0.86)
 * and returns to the handguard.
 */
export const RELOAD_HAND: readonly Key<HandAnchor>[] = [
  { t: 0, v: O },
  { t: 0.1, v: [0, -0.01, 0.02], at: 'mag' },
  { t: 0.16, v: O, at: 'mag' },
  { t: 0.2, v: O, at: 'mag' },
  { t: 0.32, v: MAG_AWAY, at: 'mag' },
  { t: 0.46, v: MAG_AWAY, at: 'mag' },
  { t: 0.56, v: [0, -0.05, 0.01], at: 'mag' },
  { t: 0.62, v: O, at: 'mag' },
  { t: 0.66, v: [0, 0.014, 0], at: 'mag' },
  { t: 0.7, v: O, at: 'mag' },
  { t: 0.79, v: O, at: 'chamber' },
  { t: 0.85, v: [0, 0, 0.07], at: 'chamber' },
  { t: 0.89, v: [0, 0, 0.07], at: 'chamber' },
  { t: 1, v: O },
];
/** Hand twist (radians) along the reload. */
export const RELOAD_HAND_ROT: readonly Key[] = [
  { t: 0, v: O },
  { t: 0.12, v: [0.2, 0, 0.5] },
  { t: 0.62, v: [0.2, 0, 0.5] },
  { t: 0.72, v: [0, 0, 0.1] },
  { t: 0.8, v: [0, 0.3, -0.4] },
  { t: 0.9, v: [0, 0.3, -0.4] },
  { t: 1, v: O },
];
/** Magazine carried by the hand between these reload times. */
export const RELOAD_MAG_HELD: readonly [number, number] = [0.2, 0.62];
/** Gun jolts (seating the magazine, releasing the handle) as extra pitch. */
export const RELOAD_GUN_ROT: readonly Key[] = [
  { t: 0, v: O },
  { t: 0.6, v: O },
  { t: 0.63, v: [0.07, 0, -0.04] },
  { t: 0.7, v: O },
  { t: 0.84, v: O },
  { t: 0.87, v: [-0.05, 0.03, 0] },
  { t: 0.93, v: O },
  { t: 1, v: O },
];

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
