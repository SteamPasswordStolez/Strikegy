/**
 * Utility-based action selection. Each action gets a score from the bot's
 * situation; the highest wins, with a small bonus for the current action so
 * bots do not flip between two close choices every tick.
 */
export type BotAction = 'engage' | 'cover' | 'reload' | 'hunt' | 'investigate' | 'advance';

export interface BrainInput {
  /** 0..1 */
  health: number;
  /** An enemy is visible and noticed right now. */
  hasTarget: boolean;
  /** Seconds since an enemy was last seen (Infinity if never). */
  lastSeenAge: number;
  /** Seconds since gunfire/footsteps were heard (Infinity if never). */
  heardAge: number;
  /** Rounds in the magazine / magazine size. */
  ammo: number;
  reloading: boolean;
  /** Seconds since this bot last took damage. */
  sinceHurt: number;
  /** A cover spot was found against the current threat. */
  coverKnown: boolean;
  /** The bot is standing at that cover spot. */
  inCover: boolean;
}

export function scoreActions(i: BrainInput): Record<BotAction, number> {
  const hurt = 1 - i.health;
  const pressured = i.sinceHurt < 2.5 || i.hasTarget;
  const empty = i.ammo <= 0;
  return {
    // Fight whatever is visible; less keen with an empty magazine.
    engage: i.hasTarget ? (empty ? 0.3 : 0.75) : 0,
    // Break contact when hurt or out of ammo in a fight; only if cover is known.
    cover: i.coverKnown && pressured && !i.inCover ? hurt * 1.1 + (empty || i.reloading ? 0.45 : 0) + (i.sinceHurt < 1 ? 0.15 : 0) : 0,
    // Top up between fights; forced when empty and nowhere to hide.
    reload: !i.reloading && i.ammo < 1 ? (empty ? (i.hasTarget ? 0.6 : 0.95) : i.hasTarget ? 0 : (1 - i.ammo) * 0.8) : 0,
    // Chase the last known position of a recently seen enemy.
    hunt: !i.hasTarget && i.lastSeenAge < 10 ? 0.35 + 0.3 * (1 - i.lastSeenAge / 10) : 0,
    // Check out noises.
    investigate: !i.hasTarget && i.heardAge < 6 ? 0.3 + 0.15 * (1 - i.heardAge / 6) : 0,
    // Default: move with the squad toward the objective.
    advance: 0.25,
  };
}

export function chooseAction(i: BrainInput, current: BotAction | null, stickiness = 0.08): BotAction {
  const scores = scoreActions(i);
  let best: BotAction = 'advance';
  let bestScore = -Infinity;
  for (const [action, score] of Object.entries(scores) as [BotAction, number][]) {
    const s = score + (action === current && score > 0 ? stickiness : 0);
    if (s > bestScore) {
      best = action;
      bestScore = s;
    }
  }
  return best;
}
