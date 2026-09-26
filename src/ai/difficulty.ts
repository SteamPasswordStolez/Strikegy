export type Difficulty = 'easy' | 'normal' | 'hard';

export interface BotSkill {
  /** Seconds between an enemy becoming visible and the bot reacting to it (at close range, centered). */
  reaction: number;
  /** Aim error cone (degrees) right after acquiring a target; shrinks while tracking. */
  aimError: number;
  /** Aim error floor (degrees) after tracking the same target for a while. */
  aimErrorMin: number;
  /** Seconds of steady tracking to go from aimError to aimErrorMin. */
  settleTime: number;
  /** Max turn rate while aiming, degrees per second. */
  turnRate: number;
  /** Shots per burst at medium/long range before pausing (auto weapons). */
  burst: [min: number, max: number];
  /** Pause between bursts, seconds. */
  burstPause: [min: number, max: number];
  /** Field of view for spotting, degrees. */
  fov: number;
  /** Max spotting distance, meters. */
  sight: number;
}

export const SKILLS: Record<Difficulty, BotSkill> = {
  easy: {
    reaction: 0.75,
    aimError: 7,
    aimErrorMin: 2.6,
    settleTime: 2.2,
    turnRate: 200,
    burst: [2, 4],
    burstPause: [0.45, 0.8],
    fov: 100,
    sight: 55,
  },
  normal: {
    reaction: 0.45,
    aimError: 5,
    aimErrorMin: 1.5,
    settleTime: 1.5,
    turnRate: 320,
    burst: [3, 6],
    burstPause: [0.3, 0.55],
    fov: 115,
    sight: 70,
  },
  hard: {
    reaction: 0.26,
    aimError: 3.2,
    aimErrorMin: 0.8,
    settleTime: 1,
    turnRate: 480,
    burst: [4, 8],
    burstPause: [0.2, 0.4],
    fov: 125,
    sight: 85,
  },
};
