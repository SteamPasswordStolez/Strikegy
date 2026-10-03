import * as THREE from 'three';
import type { HitPart } from '@/core/events';
import type { DamageKind, DamageSource, Damageable, HitboxRegistry } from '@/combat/Hitboxes';
import { Layer, RAPIER, groups, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { Team } from '@/world/mapTypes';
import { RECON, SUPPLY, SUPPORT, barrageOffsets, type SupportId } from '@/data/support';
import type { GadgetOwner } from './gadgetWorld';

export interface SupportHooks {
  /** A mortar / artillery shell came down at `point`. */
  shell(kind: 'mortar' | 'artillery', point: THREE.Vector3, owner: GadgetOwner): void;
  /** A smoke shell landed. */
  smoke(point: THREE.Vector3): void;
  /** A shell is about a second out: the whistle. */
  incoming(point: THREE.Vector3): void;
  /** Recon plane sweep: mark `team`'s enemies within `radius` of `center`. */
  reveal(team: Team, center: THREE.Vector3, radius: number): void;
  /** Supply crate on the ground: resupply someone of `team` within `reach` who needs it; true if someone took one. */
  resupply(team: Team, pos: THREE.Vector3, reach: number): boolean;
  /** Crate touched down. */
  landed?(pos: THREE.Vector3): void;
  /** Rocket tank: bring one out for the caller; false when there's nowhere to put it. */
  vehicle?(owner: GadgetOwner, near: THREE.Vector3): boolean;
  /** A recon plane was shot down at `pos` (by `by`). */
  planeDown?(pos: THREE.Vector3, team: Team, by: DamageSource | null): void;
}

/**
 * Recon planes can be shot down (owner, 2026-10-02: players took them for
 * enemy jets and emptied guns into them for nothing): this much damage
 * (people's damage units; rifle rounds count half), then a burning dive.
 */
export const RECON_PLANE = { health: 260, bulletMult: 0.5, fall: 3.5, half: [5.5, 0.8, 3.6] as const };
/** Ids for the planes' hitboxes, clear of combatants (0-~400) and vehicles (50000+). */
let nextPlaneId = 60000;

interface Shell {
  kind: 'smoke' | 'mortar' | 'artillery';
  at: number;
  point: THREE.Vector3;
  owner: GadgetOwner;
  warned: boolean;
}

interface Sweep {
  team: Team;
  center: THREE.Vector3;
  until: number;
  next: number;
  plane: THREE.Object3D;
  angle: number;
  /** Its hitbox (a kinematic box following the plane) and what it can still take. */
  hit: Damageable & { health: number; down: number };
  body: RAPIER.RigidBody | null;
}

/** An aircraft in the sky for the IFF markers: where, whose. */
export interface PlaneInfo {
  pos: THREE.Vector3;
  team: Team;
}

interface Crate {
  team: Team;
  pos: THREE.Vector3;
  landed: boolean;
  uses: number;
  until: number;
  mesh: THREE.Group;
  chute: THREE.Object3D;
}

/** A pending blast the bots should get away from. */
export interface Danger {
  point: THREE.Vector3;
  radius: number;
  /** Seconds until it lands. */
  in: number;
}

const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Call-ins in the world: barrages on their way (smoke, mortar, artillery),
 * recon planes circling and marking enemies, supply crates drifting down and
 * then handing out ammo and medkits. Also keeps the team cooldowns and what
 * each squad has spent.
 */
export class SupportWorld {
  readonly group = new THREE.Group();
  private time = 0;
  private shells: Shell[] = [];
  private sweeps: Sweep[] = [];
  private crates: Crate[] = [];
  private markers: { mesh: THREE.Mesh; until: number }[] = [];
  /** Team -> kind -> sim time it can be called again. */
  private readonly readyAt = new Map<string, number>();
  /** Squad key -> RP spent. */
  private readonly spentBy = new Map<string, number>();

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly hooks: SupportHooks,
    private readonly rand: () => number = Math.random,
    /** Recon planes register their hitbox here (none: they can't be hit). */
    private readonly registry: HitboxRegistry | null = null,
  ) {}

  /** Recon planes still flying (for the IFF markers and air-to-air aim). */
  planes(out: PlaneInfo[] = []): PlaneInfo[] {
    out.length = 0;
    for (const w of this.sweeps) if (w.hit.down < 0) out.push({ pos: w.plane.position, team: w.team });
    return out;
  }

  spent(squad: string): number {
    return this.spentBy.get(squad) ?? 0;
  }

  /** Seconds until `team` can call `kind` again (0 = ready). */
  cooldown(team: Team, kind: SupportId): number {
    return Math.max(0, (this.readyAt.get(`${team}:${kind}`) ?? 0) - this.time);
  }

  /**
   * Calls `kind` onto `point` for the owner's squad, paying from its RP
   * (`rp` = what the squad has). False when it can't (cooldown, too little RP).
   * `marker`: show a beam on the spot (the player's side).
   */
  request(kind: SupportId, point: THREE.Vector3, owner: GadgetOwner, rp: number, marker: boolean): boolean {
    const spec = SUPPORT[kind];
    if (!owner.squad || rp < spec.cost || this.cooldown(owner.team, kind) > 0) return false;
    if (kind === 'rocketTank' && !this.hooks.vehicle?.(owner, point)) return false;
    this.readyAt.set(`${owner.team}:${kind}`, this.time + spec.cooldown);
    this.spentBy.set(owner.squad, this.spent(owner.squad) + spec.cost);
    if (kind === 'smoke' || kind === 'mortar' || kind === 'artillery') {
      barrageOffsets(spec, this.rand).forEach((o, i) => {
        const p = this.ground(point.x + o.x, point.z + o.z, point.y);
        this.shells.push({ kind, at: this.time + spec.delay + i * spec.interval * (0.8 + this.rand() * 0.4), point: p, owner, warned: false });
      });
    } else if (kind === 'recon') {
      const plane = this.buildPlane(owner.team);
      this.group.add(plane);
      this.sweeps.push(this.sweep(owner.team, point, plane, this.time + spec.delay));
    } else if (kind === 'supply') {
      const mesh = this.buildCrate();
      const land = this.ground(point.x, point.z, point.y);
      mesh.position.set(land.x, land.y + SUPPLY.height, land.z);
      this.group.add(mesh);
      this.crates.push({ team: owner.team, pos: land, landed: false, uses: SUPPLY.uses, until: Infinity, mesh, chute: mesh.getObjectByName('chute')! });
    }
    if (marker && kind !== 'supply' && kind !== 'rocketTank') this.addMarker(point, kind === 'recon' ? 0x7fd0ff : kind === 'smoke' ? 0xd8d8d8 : 0xff5a3c, spec.delay + spec.shells * spec.interval);
    return true;
  }

  /** Shells due within the next couple of seconds (bots run from these). */
  dangers(out: Danger[] = []): Danger[] {
    out.length = 0;
    for (const s of this.shells) {
      if (s.kind === 'smoke') continue;
      const dt = s.at - this.time;
      if (dt < 2.5) out.push({ point: s.point, radius: s.kind === 'artillery' ? 12 : 9, in: dt });
    }
    return out;
  }

  /** Supply crates on the ground (bots walk over to them). */
  cratesOf(team: Team): THREE.Vector3[] {
    return this.crates.filter((c) => c.team === team && c.landed && c.uses > 0).map((c) => c.pos);
  }

  step(dt: number): void {
    this.time += dt;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i]!;
      if (!s.warned && s.kind !== 'smoke' && s.at - this.time < 1.1) {
        s.warned = true;
        this.hooks.incoming(s.point);
      }
      if (this.time < s.at) continue;
      this.shells.splice(i, 1);
      if (s.kind === 'smoke') this.hooks.smoke(s.point);
      else this.hooks.shell(s.kind, s.point, s.owner);
    }
    for (let i = this.sweeps.length - 1; i >= 0; i--) {
      const w = this.sweeps[i]!;
      const p = w.plane;
      if (w.hit.down >= 0) {
        // Shot down: a burning dive, then gone.
        w.hit.down += dt;
        p.position.y -= dt * (20 + w.hit.down * 25);
        p.rotation.z += dt * 2.2;
        p.rotation.x = Math.min(0.9, p.rotation.x + dt * 0.5);
        if (w.hit.down > RECON_PLANE.fall) {
          this.dropSweep(w);
          this.sweeps.splice(i, 1);
        }
        continue;
      }
      // The plane circles the spot (in from afar during the delay).
      w.angle += dt * 0.45;
      const r = 130;
      p.position.set(w.center.x + Math.cos(w.angle) * r, w.center.y + 140, w.center.z + Math.sin(w.angle) * r);
      p.rotation.set(0, -w.angle, -0.35);
      if (w.body) {
        p.updateMatrix();
        w.body.setNextKinematicTranslation(p.position);
        w.body.setNextKinematicRotation(p.quaternion);
      }
      if (this.time >= w.next && this.time < w.until) {
        w.next = this.time + RECON.sweep;
        this.hooks.reveal(w.team, w.center, SUPPORT.recon.spread);
      }
      if (this.time >= w.until) {
        this.dropSweep(w);
        this.sweeps.splice(i, 1);
      }
    }
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i]!;
      if (!c.landed) {
        c.mesh.position.y -= SUPPLY.fallSpeed * dt;
        c.mesh.rotation.y += dt * 0.3;
        if (c.mesh.position.y <= c.pos.y) {
          c.mesh.position.y = c.pos.y;
          c.landed = true;
          c.until = this.time + SUPPLY.life;
          c.chute.visible = false;
          this.hooks.landed?.(c.pos);
        }
        continue;
      }
      if (c.uses > 0 && this.hooks.resupply(c.team, c.pos, SUPPLY.reach)) c.uses--;
      if (c.uses <= 0 || this.time > c.until) {
        this.group.remove(c.mesh);
        this.crates.splice(i, 1);
      }
    }
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i]!;
      if (this.time > m.until) {
        this.group.remove(m.mesh);
        this.markers.splice(i, 1);
      }
    }
  }

  clear(): void {
    this.shells = [];
    for (const w of this.sweeps) this.dropSweep(w);
    for (const c of this.crates) this.group.remove(c.mesh);
    for (const m of this.markers) this.group.remove(m.mesh);
    this.sweeps = [];
    this.crates = [];
    this.markers = [];
  }

  /** Ground (or roof) under x, z: the first thing a shell falling from above hits. */
  private ground(x: number, z: number, fallbackY: number): THREE.Vector3 {
    const hit = this.physics.raycast({ x, y: fallbackY + 120, z }, DOWN, 300, Layer.WORLD);
    return new THREE.Vector3(x, hit ? hit.point.y : fallbackY, z);
  }

  private addMarker(point: THREE.Vector3, color: number, life: number): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 120, 8, 1, true), mat);
    mesh.position.set(point.x, point.y + 60, point.z);
    this.group.add(mesh);
    this.markers.push({ mesh, until: this.time + life });
  }

  /** A circling recon plane with a hitbox that follows it. */
  private sweep(team: Team, point: THREE.Vector3, plane: THREE.Object3D, from: number): Sweep {
    const hit: Sweep['hit'] = {
      id: nextPlaneId++,
      name: 'recon',
      team,
      health: RECON_PLANE.health,
      down: -1,
      get alive() {
        return this.down < 0;
      },
      applyDamage: (amount: number, _part: HitPart, source?: DamageSource, kind: DamageKind = 'bullet'): boolean => {
        if (hit.down >= 0) return false;
        hit.health -= amount * (kind === 'bullet' ? RECON_PLANE.bulletMult : 1);
        if (hit.health <= 0) {
          hit.down = 0;
          this.hooks.planeDown?.(plane.position.clone(), team, source ?? null);
          if (body) this.removeBody(body);
          sw.body = null;
        }
        // Not a combatant: no kill to report.
        return false;
      },
    };
    let body: RAPIER.RigidBody | null = null;
    if (this.registry) {
      body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(point.x, point.y + 140, point.z));
      const c = this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(...RECON_PLANE.half).setCollisionGroups(groups(Layer.HITBOX, Layer.HITBOX)), body);
      this.registry.register(c.handle, hit, 'body');
    }
    const sw: Sweep = { team, center: point.clone(), until: from + RECON.duration, next: from, plane, angle: this.rand() * Math.PI * 2, hit, body };
    return sw;
  }

  private removeBody(body: RAPIER.RigidBody): void {
    for (let i = 0; i < body.numColliders(); i++) this.registry?.unregister(body.collider(i).handle);
    this.physics.world.removeRigidBody(body);
  }

  private dropSweep(w: Sweep): void {
    this.group.remove(w.plane);
    if (w.body) this.removeBody(w.body);
    w.body = null;
  }

  /** A small high-wing spotter plane in its side's colours (blue-grey or rust red), a white stripe round the fuselage. */
  private buildPlane(team: Team): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: team === 'blue' ? 0x50687f : 0x86493b, roughness: 0.7 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.6 });
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.25, 7, 10).rotateZ(Math.PI / 2), body);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 11), body);
    wing.position.set(0.6, 0.55, 0);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 3.4), body);
    tail.position.set(-3.2, 0.1, 0);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.08), body);
    fin.position.set(-3.2, 0.6, 0);
    const prop = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2, 0.12), dark);
    prop.position.set(3.55, 0, 0);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.42, 0.5, 10).rotateZ(Math.PI / 2), stripe);
    band.position.set(-1.2, 0, 0);
    g.add(fus, wing, tail, fin, prop, band);
    // Built nose along +x: turn so it flies along the circle (tangent).
    const holder = new THREE.Group();
    g.rotation.y = -Math.PI / 2;
    holder.add(g);
    return holder;
  }

  /** Supply crate under a parachute. */
  private buildCrate(): THREE.Group {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x5f6b45, roughness: 0.8 });
    const band = new THREE.MeshStandardMaterial({ color: 0x2c2e30, roughness: 0.6, metalness: 0.4 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.8), wood);
    box.position.y = 0.35;
    const strap = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.72, 0.1), band);
    strap.position.y = 0.35;
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.18), new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.7 }));
    cross.position.set(0, 0.5, 0.41);
    g.add(box, strap, cross);
    const chute = new THREE.Group();
    chute.name = 'chute';
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.4),
      new THREE.MeshStandardMaterial({ color: 0xb9b08c, roughness: 0.9, side: THREE.DoubleSide }),
    );
    canopy.position.y = 4.2;
    chute.add(canopy);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 4.3, 3), band);
      line.position.set(Math.cos(a) * 1.0, 2.6, Math.sin(a) * 1.0);
      line.rotation.set(Math.sin(a) * -0.42, 0, Math.cos(a) * 0.42);
      chute.add(line);
    }
    g.add(chute);
    return g;
  }
}
