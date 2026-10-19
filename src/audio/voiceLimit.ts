/**
 * Which world sounds get a voice when a big fight asks for more than the
 * audio thread can mix (`AudioSystem` holds at most `max` panners).
 *
 * Every world sound has a priority (owner, 2026-10-19: in big fights one's
 * own fight went quiet while voices were held by far-off cannon and smoke):
 * - `near`: gunfire, blasts, cracks, incoming shells close by (one's own
 *   vehicle guns are at distance 0). Never dropped for a lower priority; only
 *   a louder near sound takes one's place.
 * - `normal`: the same things further off. Give way to near ones.
 * - `low`: impacts, other people's steps, bounces, smoke hiss, gear clicks.
 *   They never take the last `lowReserve` voices and only ever push out each other.
 * Within one priority a new sound has to be `stealRatio` times louder to cut
 * a playing one (a cut is heard; a quiet sound skipped under a fight is not).
 */
export const PRIO = { low: 0, normal: 1, near: 2 } as const;
export type Prio = (typeof PRIO)[keyof typeof PRIO];

export interface VoiceSlot {
  /** Rough loudness at the listener (weight / distance). */
  loud: number;
  prio: Prio;
}

export interface VoiceLimits {
  max: number;
  lowReserve: number;
  stealRatio: number;
}

/**
 * Room for a new sound of loudness `loud` and priority `prio` among the
 * `playing` voices: -1 = a voice is free, an index = the voice to cut for it,
 * null = the new sound is dropped.
 */
export function placeVoice(playing: readonly VoiceSlot[], loud: number, prio: Prio, lim: VoiceLimits): number | null {
  const cap = prio === PRIO.low ? lim.max - lim.lowReserve : lim.max;
  if (playing.length < cap) return -1;
  // The voice to give up: the lowest priority, then the quietest.
  let victim = -1;
  for (let i = 0; i < playing.length; i++) {
    const v = playing[i]!;
    if (prio === PRIO.low && v.prio !== PRIO.low) continue;
    const w = victim < 0 ? null : playing[victim]!;
    if (!w || v.prio < w.prio || (v.prio === w.prio && v.loud < w.loud)) victim = i;
  }
  if (victim < 0) return null;
  const v = playing[victim]!;
  if (v.prio < prio) return victim;
  if (v.prio > prio) return null;
  // Near sounds take a quieter near one's place outright; others only when clearly louder.
  return loud >= v.loud * (prio === PRIO.near ? 1 : lim.stealRatio) ? victim : null;
}
