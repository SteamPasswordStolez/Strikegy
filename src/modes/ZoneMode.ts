import * as THREE from 'three';
import type { GameBus } from '@/core/events';
import type { NavWorld } from '@/ai/NavWorld';
import type { MapDef, SpawnPoint, Team } from '@/world/mapTypes';
import { ZoneRules, type ZoneRulesOptions, type ZoneState } from './zoneRules';
import { ConquestRules, DOMINATION, DominationRules, FrontlineRules, type MatchRules, type ModeKind } from './matchRules';

const DEG = Math.PI / 180;
/** Spawning at an owned zone that is being captured puts you this far out from its edge. */
const CONTESTED_SPAWN_OFFSET: [number, number] = [12, 22];

/**
 * Tickets per soldier on a side [제안] (owner, 2026-10-03: "very generous", in
 * Frontline and Conquest only). 12v12 bot matches lose about 5-7 soldiers a
 * side a minute (measured on Ardennes / Iron Gate), so a Frontline side has
 * well over what 25 minutes of fighting costs; the Conquest attackers start
 * with `conquestStart` and get `conquestRefill` more for each sector taken.
 */
export const TICKETS = { frontline: 30, conquestStart: 15, conquestRefill: 10 };

export interface ZoneModeOptions extends ZoneRulesOptions {
  /** The mode asked for (the map's default when missing or not offered by the map). */
  mode?: ModeKind;
  /** Soldiers a side: tickets scale with it. */
  teamSize?: Record<Team, number>;
  /** Tickets for every side that has them, instead of the per-soldier numbers (?tickets=). */
  tickets?: number;
  rand?: () => number;
}

/** Modes `map` offers: Zone always, Frontline / Conquest when it sets them up. */
export function modesOf(map: MapDef): ModeKind[] {
  const out: ModeKind[] = ['zone'];
  if (map.modes?.frontline) out.push('frontline');
  if (map.modes?.conquest) out.push('conquest');
  return out;
}

/** The mode a match on `map` plays: the one asked for if the map offers it, else its default. */
export function pickMode(map: MapDef, asked?: ModeKind): ModeKind {
  const offered = modesOf(map);
  if (asked && offered.includes(asked)) return asked;
  if (asked) console.warn(`[strikegy] ${map.meta.id} has no ${asked} mode; playing its default`);
  const d = map.modes?.default;
  return d && offered.includes(d) ? d : 'zone';
}

function createMatch(kind: ModeKind, map: MapDef, opts: ZoneModeOptions): MatchRules {
  const size = opts.teamSize ?? { blue: 12, red: 12 };
  const per = (n: number) => ({ blue: opts.tickets ?? Math.round(n * size.blue), red: opts.tickets ?? Math.round(n * size.red) });
  const m = map.modes;
  if (kind === 'frontline' && m?.frontline) {
    return new FrontlineRules({
      sectors: m.frontline.sectors,
      tickets: per(TICKETS.frontline),
      teamSize: (size.blue + size.red) / 2,
      attackTime: m.frontline.attackTime,
      matchTime: m.frontline.matchTime,
      rand: opts.rand,
    });
  }
  if (kind === 'conquest' && m?.conquest) {
    const a = m.conquest.attacker;
    return new ConquestRules({
      attacker: a,
      sectors: m.conquest.sectors,
      tickets: per(TICKETS.conquestStart)[a],
      refill: Math.round(TICKETS.conquestRefill * size[a]),
    });
  }
  return new DominationRules(m?.zone?.target ?? DOMINATION.target);
}

export interface SpawnOption {
  /** 'base' or a zone id. */
  id: string;
  underAttack: boolean;
}

export interface Objective {
  pos: THREE.Vector3;
  radius: number;
  /** Held by the asking team: guard it. */
  defend?: boolean;
  /** Held and quiet (not under attack): a guard post for spare squads. */
  guard?: boolean;
  /** Unit direction (xz) from the zone toward the enemy base: where attacks come from. */
  front?: THREE.Vector3;
  /** Held by the other side. */
  enemyHeld?: boolean;
}

interface Presence {
  readonly team: Team;
  readonly alive: boolean;
  readonly feet: THREE.Vector3;
}

/**
 * A zone match at runtime (any of the three modes): counts who stands in each
 * zone, advances capture, runs the mode's rules (`match`), and answers where
 * a team may respawn and which zones its bots should go for.
 */
export class ZoneMode {
  readonly rules: ZoneRules;
  readonly kind: ModeKind;
  readonly match: MatchRules;
  private readonly bases: Record<Team, SpawnPoint[]>;
  private readonly baseCenter: Record<Team, THREE.Vector3>;
  private readonly counts = new Map<ZoneState, { blue: number; red: number }>();

  constructor(
    map: MapDef,
    private readonly bus: GameBus,
    opts: ZoneModeOptions = {},
  ) {
    this.rules = new ZoneRules(map.zones ?? [], opts);
    this.kind = pickMode(map, opts.mode);
    this.match = createMatch(this.kind, map, opts);
    this.match.start(this.rules);
    // Who went down, for the Frontline attack timer.
    bus.on('combat:kill', (e) => {
      if (e.victimTeam) this.match.onDown(e.victimTeam);
    });
    const own = (team: Team) => map.spawns.filter((s) => s.team === team || (team === 'blue' && s.team === 'player'));
    this.bases = { blue: own('blue'), red: own('red') };
    const center = (list: SpawnPoint[]) =>
      list.reduce((a, s) => a.add(new THREE.Vector3(...s.pos)), new THREE.Vector3()).divideScalar(Math.max(1, list.length));
    this.baseCenter = { blue: center(this.bases.blue), red: center(this.bases.red) };
  }

  get zones(): readonly ZoneState[] {
    return this.rules.zones;
  }

  get ended(): boolean {
    return this.match.ended;
  }

  /** A member of `team` died. */
  onDeath(team: Team): void {
    if (this.match.ended) return;
    this.match.onDeath(team);
    if (this.match.winner) this.bus.emit('match:ended', { winner: this.match.winner });
  }

  step(dt: number, everyone: Iterable<Presence>): void {
    if (this.match.ended) return;
    const list = [...everyone].filter((p) => p.alive);
    const events = this.rules.update(dt, (z) => {
      let c = this.counts.get(z);
      if (!c) this.counts.set(z, (c = { blue: 0, red: 0 }));
      c.blue = c.red = 0;
      for (const p of list) if (ZoneRules.inside(z, p.feet)) c[p.team]++;
      return c;
    });
    for (const e of events) {
      if (e.type === 'captured') this.bus.emit('zone:captured', { zone: e.zone, team: e.team });
      else this.bus.emit('zone:neutralized', { zone: e.zone, team: e.team });
    }
    for (const e of this.match.step(dt, this.rules, events)) this.bus.emit('mode:event', e);
    if (this.match.winner) this.bus.emit('match:ended', { winner: this.match.winner });
  }

  /** Zone ids as the HUD lists them for `team`: its side of the map first (Zone mode: by id). */
  order(team: Team): string[] {
    const o = this.match.order(team);
    return o.length ? o : this.rules.zones.map((z) => z.id);
  }

  /** Base centre of `team` (spawn points' middle). */
  base(team: Team): THREE.Vector3 {
    return this.baseCenter[team];
  }

  zone(id: string): ZoneState | undefined {
    return this.rules.zones.find((z) => z.id === id);
  }

  /** The zone `p` stands in, if any. */
  zoneAt(p: THREE.Vector3): ZoneState | null {
    return this.rules.zones.find((z) => ZoneRules.inside(z, p)) ?? null;
  }

  /**
   * Base first, then owned zones in id order. With one sector open
   * (frontline / conquest) nobody spawns in it: the defenders come from the
   * sectors behind, the attackers from what they hold.
   */
  spawnOptions(team: Team): SpawnOption[] {
    const zones = this.rules.owned(team).filter((z) => this.kind === 'zone' || z.locked);
    return [{ id: 'base', underAttack: false }, ...zones.map((z) => ({ id: z.id, underAttack: ZoneRules.underAttack(z) }))];
  }

  /**
   * Where to spawn for a choice ('base' or an owned zone id). Falls back to the
   * base if the zone is no longer owned. Faces the nearest zone not yet owned.
   */
  spawnPoint(team: Team, choice: string, nav: NavWorld | null, rand = Math.random): { pos: THREE.Vector3; yaw: number } {
    const z = choice === 'base' ? undefined : this.zone(choice);
    let pos: THREE.Vector3;
    if (!z || z.owner !== team || (this.kind !== 'zone' && !z.locked)) {
      const list = this.bases[team];
      const sp = list[Math.floor(rand() * list.length)];
      pos = sp ? new THREE.Vector3(...sp.pos) : this.baseCenter[team].clone();
      if (nav) pos = nav.randomAround(pos, 3) ?? pos;
    } else if (ZoneRules.underAttack(z)) {
      // Back from the fight, toward our own base. The spot can land inside a
      // building (no floor there at the zone's height): then another angle, and
      // failing that the zone itself, never the spot as it is.
      const center = new THREE.Vector3(z.x, z.y, z.z);
      const toBase = this.baseCenter[team].clone().sub(center).setY(0).normalize();
      const d = z.radius + CONTESTED_SPAWN_OFFSET[0] + rand() * (CONTESTED_SPAWN_OFFSET[1] - CONTESTED_SPAWN_OFFSET[0]);
      let found: THREE.Vector3 | null = null;
      for (let i = 0; i < 6 && !found; i++) {
        const away = toBase.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (rand() - 0.5) * (70 + i * 20) * DEG);
        const at = center.clone().addScaledVector(away, d);
        found = nav ? (nav.randomAround(at, 4) ?? nav.closest(at)) : at;
      }
      pos = found ?? (nav && groundAround(nav, center, z.radius * 0.6)) ?? center;
    } else {
      const center = new THREE.Vector3(z.x, z.y, z.z);
      pos = (nav && groundAround(nav, center, z.radius * 0.6)) || center;
    }
    return { pos, yaw: this.faceYaw(team, pos) };
  }

  /** Yaw (player convention, 0 = -Z) toward the nearest zone this team does not own, else the enemy base. */
  private faceYaw(team: Team, from: THREE.Vector3): number {
    let target: THREE.Vector3 | null = null;
    let best = Infinity;
    const open = this.rules.zones.some((z) => !z.locked && z.owner !== team);
    for (const z of this.rules.zones) {
      if (z.owner === team || (open && z.locked)) continue;
      const d = Math.hypot(z.x - from.x, z.z - from.z);
      if (d > 3 && d < best) {
        best = d;
        target = new THREE.Vector3(z.x, z.y, z.z);
      }
    }
    target ??= this.baseCenter[team === 'blue' ? 'red' : 'blue'];
    return Math.atan2(-(target.x - from.x), -(target.z - from.z));
  }

  /**
   * Zones worth going for, best first: owned zones under attack, then neutral,
   * then enemy zones; nearer to this team's base ranks higher. Locked zones
   * (frontline / conquest: everything but the sector fought over) are not.
   */
  objectives(team: Team): Objective[] {
    const base = this.baseCenter[team];
    // With one sector in play, its zones (also while it waits to open).
    const focus = this.match.focus();
    const scored = this.rules.zones
      .filter((z) => (focus ? focus.includes(z.id) : !z.locked))
      .map((z) => {
        const d = Math.hypot(z.x - base.x, z.z - base.z);
        let s: number;
        // Owned and quiet: a low-priority guard post (squads left over after the other goals).
        if (z.owner === team) s = ZoneRules.underAttack(z) ? 3 : z.pushing === null && z.control !== (team === 'blue' ? 1 : -1) ? 1 : 0.2;
        else if (z.owner === null) s = 2;
        else s = 1.6;
        return { z, s: s - d / 400 };
      })
      // Zone mode drops far-off quiet held zones; with one sector open, every open zone counts.
      .filter((e) => e.s > -0.5 || this.kind !== 'zone')
      .sort((a, b) => b.s - a.s);
    const enemy = this.baseCenter[team === 'blue' ? 'red' : 'blue'];
    return scored.map(({ z }) => ({
      pos: new THREE.Vector3(z.x, z.y, z.z),
      radius: z.radius,
      defend: z.owner === team,
      guard: z.owner === team && !ZoneRules.underAttack(z),
      enemyHeld: z.owner !== null && z.owner !== team,
      front: new THREE.Vector3(enemy.x - z.x, 0, enemy.z - z.z).normalize(),
    }));
  }
}

/**
 * A random walkable point within `r` of `at` at about its height: the navmesh
 * reaches the upper floors of buildings in a zone, and nobody should spawn on
 * the fourth floor of the hospital. Falls back to any point if none is low.
 */
function groundAround(nav: NavWorld, at: THREE.Vector3, r: number): THREE.Vector3 | null {
  let any: THREE.Vector3 | null = null;
  for (let i = 0; i < 6; i++) {
    const p = nav.randomAround(at, r);
    if (!p) break;
    if (Math.abs(p.y - at.y) < 2.5) return p;
    any ??= p;
  }
  return any;
}
