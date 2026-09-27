/**
 * Decides when background sounds happen: wind strength and gusts, bird calls
 * and far-off fighting beyond the map. Pure logic (no Web Audio) so it can be
 * tested; `Ambience` turns its events into sound.
 */

/** Per-map ambience levels, each 0..1 (0 = off). */
export interface AmbienceLevels {
  wind: number;
  birds: number;
  /** Fighting beyond the map edge (distant shots, artillery). */
  battle: number;
}

export type AmbienceEvent =
  | { kind: 'bird'; species: number; azimuth: number; gain: number }
  | { kind: 'burst'; cls: 'ar' | 'lmg' | 'smg'; shots: number; interval: number; azimuth: number; gain: number }
  | { kind: 'single'; cls: 'sr' | 'dmr'; azimuth: number; gain: number }
  | { kind: 'artillery'; azimuth: number; gain: number };

export const AMBIENCE_BY_PROFILE: Record<string, AmbienceLevels> = {
  outdoor_day: { wind: 0.35, birds: 0.6, battle: 0.5 },
  overcast: { wind: 0.55, birds: 0.35, battle: 0.5 },
  indoor: { wind: 0, birds: 0, battle: 0 },
};

/** Levels for a map: its profile's defaults, no far-off battle on maps without zones (ranges), then the map's own overrides. */
export function ambienceFor(profile: string, hasZones: boolean, overrides?: Partial<AmbienceLevels>): AmbienceLevels {
  const base = AMBIENCE_BY_PROFILE[profile] ?? AMBIENCE_BY_PROFILE.outdoor_day!;
  return { ...base, ...(hasZones ? {} : { battle: 0 }), ...overrides };
}

/** Tension above this silences the birds (they "flee" a nearby fight). */
export const BIRD_TENSION_MAX = 0.25;
/** Seconds of calm after a fight before birds call again. */
export const BIRD_CALM_S = 12;
/** Time constant for tension to fade, seconds. */
const TENSION_DECAY_S = 6;

export class AmbienceDirector {
  /** 0..1, how much fighting is audible near the player right now. */
  tension = 0;
  /** Current wind strength 0..1 including gusts. */
  wind = 0;
  private gust = 0;
  private gustTarget = 0;
  private gustTimer = 0;
  private birdTimer: number;
  private battleTimer: number;
  private calmFor = BIRD_CALM_S;
  /** The far-off front's world direction; skirmishes cluster around it. */
  readonly front: number;

  constructor(
    public levels: AmbienceLevels,
    private readonly rng: () => number = Math.random,
  ) {
    this.front = rng() * Math.PI * 2;
    this.birdTimer = 2 + rng() * 4;
    this.battleTimer = 3 + rng() * 5;
    this.wind = levels.wind;
  }

  /** Raise tension by a nearby fight sound (clamped to 1). */
  excite(amount: number): void {
    this.tension = Math.min(1, this.tension + amount);
  }

  /** Advance by `dt` seconds; returns sounds to start now. */
  update(dt: number): AmbienceEvent[] {
    const r = this.rng;
    const out: AmbienceEvent[] = [];
    this.tension *= Math.exp(-dt / TENSION_DECAY_S);
    this.calmFor = this.tension > BIRD_TENSION_MAX ? 0 : this.calmFor + dt;

    // Wind: a slow random walk toward a new gust level every few seconds.
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTimer = 2.5 + r() * 6;
      this.gustTarget = r() < 0.3 ? 0.4 + r() * 0.6 : r() * 0.3;
    }
    this.gust += (this.gustTarget - this.gust) * Math.min(1, dt / 1.8);
    this.wind = this.levels.wind * (0.55 + 0.75 * this.gust);

    const birds = this.levels.birds;
    if (birds > 0) {
      this.birdTimer -= dt;
      if (this.birdTimer <= 0) {
        this.birdTimer = (1.5 + r() * 6) / (0.4 + birds);
        if (this.calmFor >= BIRD_CALM_S) {
          out.push({ kind: 'bird', species: Math.floor(r() * 4), azimuth: r() * Math.PI * 2, gain: birds * (0.3 + r() * 0.7) });
        }
      }
    }

    const battle = this.levels.battle;
    if (battle > 0) {
      this.battleTimer -= dt;
      if (this.battleTimer <= 0) {
        this.battleTimer = (2.5 + r() * 9) / (0.4 + battle);
        const azimuth = this.front + (r() - 0.5) * 2.2;
        const gain = battle * (0.35 + r() * 0.65);
        const pick = r();
        if (pick < 0.55) {
          const cls = r() < 0.5 ? 'ar' : r() < 0.6 ? 'lmg' : 'smg';
          out.push({ kind: 'burst', cls, shots: 3 + Math.floor(r() * (cls === 'lmg' ? 12 : 7)), interval: 60 / (cls === 'lmg' ? 600 : 720), azimuth, gain });
        } else if (pick < 0.85) {
          out.push({ kind: 'single', cls: r() < 0.5 ? 'sr' : 'dmr', azimuth, gain });
        } else {
          out.push({ kind: 'artillery', azimuth, gain });
        }
      }
    }
    return out;
  }
}
