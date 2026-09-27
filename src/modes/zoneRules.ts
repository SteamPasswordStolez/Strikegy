import type { Team, ZoneDef } from '@/world/mapTypes';

/**
 * Zone mode rules (pure logic, no rendering).
 *
 * - Each team starts with a ticket pool; every death costs one ticket and the
 *   team that runs out loses. Holding zones does not drain tickets: owning a
 *   zone lets the team respawn there.
 * - Zones start neutral. Capturing is two-step like p1: an enemy zone is first
 *   neutralized, then taken. Speed scales with the head-count advantage inside
 *   the zone; a full step takes `stepSec` seconds when only one team is present.
 */

export interface ZoneState {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  /** Current owner, or null when neutral. */
  owner: Team | null;
  /** -1 (red) .. 0 (neutral) .. 1 (blue). */
  control: number;
  /** Team whose presence is currently moving `control` (null if nobody / tied). */
  pushing: Team | null;
  /** Both teams inside with equal numbers. */
  contested: boolean;
  blue: number;
  red: number;
}

export interface ZoneEvent {
  type: 'captured' | 'neutralized';
  zone: string;
  /** Team that captured it, or the team that lost it when neutralized. */
  team: Team;
}

export interface ZoneRulesOptions {
  tickets?: number;
  stepSec?: number;
}

export const ZONE_DEFAULTS = { tickets: 200, stepSec: 8 };

const SIGN: Record<Team, number> = { blue: 1, red: -1 };

export class ZoneRules {
  readonly zones: ZoneState[];
  readonly tickets: Record<Team, number>;
  readonly startTickets: number;
  winner: Team | null = null;
  private readonly stepSec: number;

  constructor(defs: readonly ZoneDef[], opts: ZoneRulesOptions = {}) {
    this.startTickets = opts.tickets ?? ZONE_DEFAULTS.tickets;
    this.stepSec = opts.stepSec ?? ZONE_DEFAULTS.stepSec;
    this.tickets = { blue: this.startTickets, red: this.startTickets };
    this.zones = [...defs]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((d) => ({
        id: d.id,
        x: d.pos[0],
        y: d.pos[1],
        z: d.pos[2],
        radius: d.radius,
        owner: null,
        control: 0,
        pushing: null,
        contested: false,
        blue: 0,
        red: 0,
      }));
  }

  get ended(): boolean {
    return this.winner !== null;
  }

  /** A member of `team` died. */
  onDeath(team: Team): void {
    if (this.ended) return;
    this.tickets[team] = Math.max(0, this.tickets[team] - 1);
    if (this.tickets[team] === 0) this.winner = team === 'blue' ? 'red' : 'blue';
  }

  /** Is `p` (feet position) inside the zone's capture area? */
  static inside(zone: ZoneState, p: { x: number; y: number; z: number }): boolean {
    const dx = p.x - zone.x;
    const dz = p.z - zone.z;
    return dx * dx + dz * dz <= zone.radius * zone.radius && Math.abs(p.y - zone.y) < 8;
  }

  /**
   * Advances capture. `counts(zone)` returns how many live members of each
   * team stand in the zone. Returns ownership changes that happened.
   */
  update(dt: number, counts: (zone: ZoneState) => { blue: number; red: number }): ZoneEvent[] {
    const events: ZoneEvent[] = [];
    if (this.ended) return events;
    for (const z of this.zones) {
      const { blue, red } = counts(z);
      z.blue = blue;
      z.red = red;
      z.contested = blue > 0 && blue === red;
      z.pushing = null;
      if (blue === red) continue;
      const adv: Team = blue > red ? 'blue' : 'red';
      // Where this team is taking the zone: neutral first if an enemy owns it.
      const target = z.owner === null || z.owner === adv ? SIGN[adv] : 0;
      if (z.control === target) continue;
      const ratio = Math.abs(blue - red) / (blue + red);
      const step = (ratio / this.stepSec) * dt;
      z.pushing = adv;
      z.control = target > z.control ? Math.min(target, z.control + step) : Math.max(target, z.control - step);
      if (z.control !== target) continue;
      if (target === 0 && z.owner !== null) {
        events.push({ type: 'neutralized', zone: z.id, team: z.owner });
        z.owner = null;
      } else if (target !== 0 && z.owner === null) {
        z.owner = adv;
        events.push({ type: 'captured', zone: z.id, team: adv });
      }
    }
    return events;
  }

  /** Owned zone that an enemy is currently taking away. */
  static underAttack(zone: ZoneState): boolean {
    return zone.owner !== null && zone.pushing !== null && zone.pushing !== zone.owner;
  }

  /**
   * Progress of the current stage, 0..1: how far toward neutral an owned zone
   * has been pushed, or how far toward an owner a neutral zone has come.
   */
  static progress(zone: ZoneState): number {
    return zone.owner === null ? Math.abs(zone.control) : 1 - Math.abs(zone.control);
  }

  owned(team: Team): ZoneState[] {
    return this.zones.filter((z) => z.owner === team);
  }
}
