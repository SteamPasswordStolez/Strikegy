/**
 * Scope sway and holding your breath. Pure logic (no Three / DOM), stepped
 * in the fixed sim step so the shot follows the same sway the scope shows.
 *
 * Scoped rifles drift in a slow figure of eight. Holding X while scoped
 * steadies the aim for a few seconds; hold on past that and the sway creeps
 * back with a tremor while the view darkens from the edges, until it goes
 * black and the breath lets go by itself (no damage). After a long hold the
 * aim shakes harder while the lungs refill, and a new hold has to wait until
 * there is enough air again.
 */

/** Air is counted in seconds of holding. */
export const BREATH = {
  /** Full lungs. */
  air: 9,
  /** Seconds of a hold that stay steady; after that the view starts to darken. */
  steady: 5,
  /** Air back per second while breathing normally. */
  refill: 1.6,
  /** After the view went black: air needed before holding again. */
  recoverTo: 5,
  /** Sway left while steady (fraction). */
  steadySway: 0.08,
};

/** Sway amplitude (radians) per weapon class at full aim: snipers most, DMRs less. */
export const SWAY_AMP: Partial<Record<string, number>> = { sr: 0.0105, dmr: 0.0065 };

export interface BreathState {
  /** Seconds of air left (BREATH.air = full). */
  air: number;
  holding: boolean;
  /** Blacked out: can't hold again until the air is back to `recoverTo`. */
  locked: boolean;
  /** 0..1 darkening of the view. */
  dark: number;
  /** Smoothed sway multiplier. */
  mult: number;
  /** 0..1 tremor on top of the sway (straining, gasping). */
  tremor: number;
}

export function createBreath(): BreathState {
  return { air: BREATH.air, holding: false, locked: false, dark: 0, mult: 1, tremor: 0 };
}

export type BreathEvent = 'in' | 'out' | 'gasp' | null;

/**
 * One step. `want`: the hold key is down; `scoped`: aiming down a scope
 * (holding only works then). Returns a sound cue when the breath changes.
 */
export function stepBreath(s: BreathState, dt: number, want: boolean, scoped: boolean): BreathEvent {
  let ev: BreathEvent = null;
  if (s.locked && s.air >= BREATH.recoverTo) s.locked = false;
  const hold = want && scoped && !s.locked && s.air > 0;
  if (hold && !s.holding) ev = 'in';
  else if (!hold && s.holding) ev = s.air < BREATH.air - BREATH.steady ? 'gasp' : 'out';
  s.holding = hold;

  let dark = 0;
  let mult: number;
  let tremor: number;
  if (hold) {
    s.air = Math.max(0, s.air - dt);
    const strain = Math.max(0, (BREATH.air - BREATH.steady - s.air) / (BREATH.air - BREATH.steady));
    dark = strain;
    mult = BREATH.steadySway + strain * 1.3;
    tremor = strain;
    if (s.air <= 0) {
      // Blacked out: the breath goes by itself.
      s.holding = false;
      s.locked = true;
      s.dark = 1;
      ev = 'gasp';
    }
  } else {
    s.air = Math.min(BREATH.air, s.air + BREATH.refill * dt);
    // Out of breath: shakier until the lungs are about two thirds full again.
    const gasp = Math.max(0, (BREATH.air * 0.65 - s.air) / (BREATH.air * 0.65));
    mult = 1 + gasp * 1.6;
    tremor = gasp * 0.7;
  }
  // Darkness comes on with the strain and clears over a couple of seconds.
  s.dark = dark > s.dark ? dark : Math.max(dark, s.dark - dt * 0.55);
  const k = 1 - Math.exp(-(hold ? 7 : 3) * dt);
  s.mult += (mult - s.mult) * k;
  s.tremor += (tremor - s.tremor) * k;
  return ev;
}

/**
 * Sway offset (radians, added to pitch / yaw) at `time`. `amp` from
 * `SWAY_AMP`, `aim` = ADS blend, `stance` scales it (crouched steadier,
 * moving worse).
 */
export function scopeSway(s: BreathState, time: number, amp: number, aim: number, stance: number, out: { pitch: number; yaw: number }): void {
  const a = amp * aim * stance * s.mult;
  // Slow figure of eight plus a drift, so it never repeats exactly.
  let yaw = a * (Math.sin(time * 0.62) * 0.8 + Math.sin(time * 1.43 + 1.1) * 0.3);
  let pitch = a * (Math.sin(time * 1.24) * 0.55 + Math.sin(time * 0.41 + 2.3) * 0.4);
  const tr = amp * aim * s.tremor * 0.35;
  yaw += tr * (Math.sin(time * 9.1) * 0.6 + Math.sin(time * 13.7 + 0.5) * 0.4);
  pitch += tr * (Math.sin(time * 10.3 + 1.7) * 0.6 + Math.sin(time * 15.1) * 0.4);
  out.pitch = pitch;
  out.yaw = yaw;
}
