import * as THREE from 'three';
import type { GameBus } from '@/core/events';
import type { NavWorld } from '@/ai/NavWorld';
import type { MapDef, SpawnPoint, Team } from '@/world/mapTypes';
import { ZoneRules, type ZoneRulesOptions, type ZoneState } from './zoneRules';

const DEG = Math.PI / 180;
/** Spawning at an owned zone that is being captured puts you this far out from its edge. */
const CONTESTED_SPAWN_OFFSET: [number, number] = [12, 22];

export interface SpawnOption {
  /** 'base' or a zone id. */
  id: string;
  underAttack: boolean;
}

export interface Objective {
  pos: THREE.Vector3;
  radius: number;
}

interface Presence {
  readonly team: Team;
  readonly alive: boolean;
  readonly feet: THREE.Vector3;
}

/**
 * Zone mode at runtime: counts who stands in each zone, advances capture,
 * tracks tickets (deaths only), and answers where a team may respawn and
 * which zones its bots should go for.
 */
export class ZoneMode {
  readonly rules: ZoneRules;
  private readonly bases: Record<Team, SpawnPoint[]>;
  private readonly baseCenter: Record<Team, THREE.Vector3>;
  private readonly counts = new Map<ZoneState, { blue: number; red: number }>();

  constructor(
    map: MapDef,
    private readonly bus: GameBus,
    opts: ZoneRulesOptions = {},
  ) {
    this.rules = new ZoneRules(map.zones ?? [], opts);
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
    return this.rules.ended;
  }

  /** A member of `team` died. */
  onDeath(team: Team): void {
    if (this.rules.ended) return;
    this.rules.onDeath(team);
    if (this.rules.winner) this.bus.emit('match:ended', { winner: this.rules.winner });
  }

  step(dt: number, everyone: Iterable<Presence>): void {
    if (this.rules.ended) return;
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
  }

  zone(id: string): ZoneState | undefined {
    return this.rules.zones.find((z) => z.id === id);
  }

  /** The zone `p` stands in, if any. */
  zoneAt(p: THREE.Vector3): ZoneState | null {
    return this.rules.zones.find((z) => ZoneRules.inside(z, p)) ?? null;
  }

  /** Base first, then owned zones in id order. */
  spawnOptions(team: Team): SpawnOption[] {
    return [{ id: 'base', underAttack: false }, ...this.rules.owned(team).map((z) => ({ id: z.id, underAttack: ZoneRules.underAttack(z) }))];
  }

  /**
   * Where to spawn for a choice ('base' or an owned zone id). Falls back to the
   * base if the zone is no longer owned. Faces the nearest zone not yet owned.
   */
  spawnPoint(team: Team, choice: string, nav: NavWorld | null, rand = Math.random): { pos: THREE.Vector3; yaw: number } {
    const z = choice === 'base' ? undefined : this.zone(choice);
    let pos: THREE.Vector3;
    if (!z || z.owner !== team) {
      const list = this.bases[team];
      const sp = list[Math.floor(rand() * list.length)];
      pos = sp ? new THREE.Vector3(...sp.pos) : this.baseCenter[team].clone();
      if (nav) pos = nav.randomAround(pos, 3) ?? pos;
    } else if (ZoneRules.underAttack(z)) {
      // Back from the fight, toward our own base.
      const center = new THREE.Vector3(z.x, z.y, z.z);
      const away = this.baseCenter[team].clone().sub(center).setY(0).normalize();
      away.applyAxisAngle(new THREE.Vector3(0, 1, 0), (rand() - 0.5) * 70 * DEG);
      const d = z.radius + CONTESTED_SPAWN_OFFSET[0] + rand() * (CONTESTED_SPAWN_OFFSET[1] - CONTESTED_SPAWN_OFFSET[0]);
      pos = center.addScaledVector(away, d);
      if (nav) pos = nav.randomAround(pos, 4) ?? nav.closest(pos) ?? pos;
    } else {
      const center = new THREE.Vector3(z.x, z.y, z.z);
      pos = (nav && nav.randomAround(center, z.radius * 0.6)) || center;
    }
    return { pos, yaw: this.faceYaw(team, pos) };
  }

  /** Yaw (player convention, 0 = -Z) toward the nearest zone this team does not own, else the enemy base. */
  private faceYaw(team: Team, from: THREE.Vector3): number {
    let target: THREE.Vector3 | null = null;
    let best = Infinity;
    for (const z of this.rules.zones) {
      if (z.owner === team) continue;
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
   * then enemy zones; nearer to this team's base ranks higher.
   */
  objectives(team: Team): Objective[] {
    const base = this.baseCenter[team];
    const scored = this.rules.zones
      .map((z) => {
        const d = Math.hypot(z.x - base.x, z.z - base.z);
        let s: number;
        if (z.owner === team) s = ZoneRules.underAttack(z) ? 3 : z.pushing === null && z.control !== (team === 'blue' ? 1 : -1) ? 1 : -1;
        else if (z.owner === null) s = 2;
        else s = 1.6;
        return { z, s: s - d / 400 };
      })
      .filter((e) => e.s > -0.5)
      .sort((a, b) => b.s - a.s);
    return scored.map(({ z }) => ({ pos: new THREE.Vector3(z.x, z.y, z.z), radius: z.radius }));
  }
}
