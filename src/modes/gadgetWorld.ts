import * as THREE from 'three';
import type { HitPart } from '@/core/events';
import type { Damageable, DamageSource, HitboxRegistry } from '@/combat/Hitboxes';
import { Layer, type PhysicsWorld, type RAPIER } from '@/physics/PhysicsWorld';
import type { Team } from '@/world/mapTypes';
import { BEACON, MINE, RIFLE_SMOKE, ROCKET } from '@/data/gadgets';

/** Who fired or placed something (the player or a bot). */
export interface GadgetOwner {
  id: number;
  name: string;
  team: Team;
  /** Squad key ('blue:2'): who may deploy on a beacon. */
  squad: string | null;
}

/** Someone a mine can go off under (the player and bots). */
export interface MineWalker {
  readonly id: number;
  readonly team: Team;
  readonly alive: boolean;
  readonly downed: boolean;
  readonly feet: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  /** Eye height: low when crouched (crouch-walking doesn't set mines off). */
  readonly eyeHeight: number;
}

export interface GadgetHooks {
  /** A tank / gun shell struck something (`target` when it hit someone or a vehicle) and goes off. */
  shell?(gun: string, point: THREE.Vector3, owner: GadgetOwner, target: Damageable | null, part: HitPart): void;
  /** A rocket or mine went off at `point`. */
  explode(kind: 'rocket' | 'mine', point: THREE.Vector3, owner: GadgetOwner): void;
  /** A rocket struck someone directly. */
  directHit(target: Damageable, part: HitPart, point: THREE.Vector3, owner: GadgetOwner): void;
  /** A rifle smoke grenade landed. */
  smoke(point: THREE.Vector3, owner: GadgetOwner): void;
  /** Something placed was destroyed (beacon shot, mine set off by gunfire). */
  destroyed?(kind: 'beacon' | 'mine', point: THREE.Vector3): void;
}

type ShotKind = 'rocket' | 'riflesmoke' | 'shell';

interface Shot {
  kind: ShotKind;
  owner: GadgetOwner;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  life: number;
  mesh: THREE.Object3D;
  /** Shells: the gun that fired it. */
  gun?: string;
  /** Missiles: where the target is now (null: lost it, flies straight). */
  homing?: () => THREE.Vector3 | null;
}

export interface Beacon {
  readonly id: number;
  readonly owner: GadgetOwner;
  readonly pos: THREE.Vector3;
  uses: number;
  health: number;
  mesh: THREE.Object3D;
  collider: RAPIER.Collider;
}

export interface Mine {
  readonly id: number;
  readonly owner: GadgetOwner;
  readonly pos: THREE.Vector3;
  /** Seconds until it goes off once tripped, or -1. */
  fuse: number;
  mesh: THREE.Object3D;
  collider: RAPIER.Collider;
  /** Teams that have seen it (their bots crouch past it). */
  readonly seenBy: Set<Team>;
}

/** What a projectile hits: world geometry and hitboxes. */
const SHOT_MASK = Layer.WORLD | Layer.HITBOX;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Class gadgets in the world: panzerfaust rockets and rifle smoke grenades in
 * flight (swept rays each step, so they never tunnel), and placed spawn
 * beacons and AP mines (shootable, with small models). Gameplay effects go
 * out through `hooks`.
 */
export class GadgetWorld {
  readonly group = new THREE.Group();
  readonly beacons: Beacon[] = [];
  readonly mines: Mine[] = [];
  private readonly shots: Shot[] = [];
  private nextId = 1;
  private readonly seg = new THREE.Vector3();
  private readonly models = gadgetModels();

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly registry: HitboxRegistry,
    private readonly hooks: GadgetHooks,
  ) {
    this.group.name = 'gadgets';
  }

  /**
   * Fires a rocket or rifle grenade from `origin` along `dir` (unit). A rifle
   * grenade leaves above the aim line (a lob) unless `exact` (bots aim their arcs).
   */
  fire(kind: ShotKind, origin: THREE.Vector3, dir: THREE.Vector3, owner: GadgetOwner, exact = false): void {
    const spec = kind === 'rocket' ? ROCKET : RIFLE_SMOKE;
    const vel = dir.clone();
    if (kind === 'riflesmoke' && !exact) vel.addScaledVector(UP, RIFLE_SMOKE.loft).normalize();
    vel.multiplyScalar(spec.speed);
    const mesh = (kind === 'rocket' ? this.models.rocket : this.models.rifleGrenade).clone();
    mesh.position.copy(origin);
    this.group.add(mesh);
    this.shots.push({ kind, owner, pos: origin.clone(), vel, gravity: spec.gravity, life: spec.life, mesh });
  }

  /** A vehicle gun shell with its own velocity and drop (`gun`: which gun, for the hooks). */
  fireShell(origin: THREE.Vector3, vel: THREE.Vector3, gravity: number, owner: GadgetOwner, gun: string, homing?: () => THREE.Vector3 | null): void {
    const mesh = (homing ? this.models.rocket : this.models.shell).clone();
    if (homing) mesh.scale.setScalar(2.2);
    mesh.position.copy(origin);
    this.group.add(mesh);
    this.shots.push({ kind: 'shell', owner, pos: origin.clone(), vel: vel.clone(), gravity, life: homing ? 8 : 14, mesh, gun, homing });
  }

  /** Puts a beacon down (replacing the owner's earlier one). */
  placeBeacon(pos: THREE.Vector3, yaw: number, owner: GadgetOwner): Beacon {
    for (const b of this.beacons.filter((b) => b.owner.id === owner.id)) this.removeBeacon(b);
    const mesh = this.models.beacon.clone();
    mesh.position.copy(pos);
    mesh.rotation.y = yaw;
    this.group.add(mesh);
    const collider = this.physics.addStaticBox({ x: pos.x, y: pos.y + 0.2, z: pos.z }, { x: 0.14, y: 0.2, z: 0.14 }, undefined, Layer.HITBOX);
    const beacon: Beacon = { id: this.nextId++, owner, pos: pos.clone(), uses: BEACON.uses, health: BEACON.health, mesh, collider };
    this.registry.register(collider.handle, this.damageable(beacon, 'beacon'), 'body');
    this.beacons.push(beacon);
    return beacon;
  }

  /** Puts a mine down; an owner's oldest goes when they have too many. */
  placeMine(pos: THREE.Vector3, yaw: number, owner: GadgetOwner): Mine {
    const own = this.mines.filter((m) => m.owner.id === owner.id);
    if (own.length >= MINE.perOwner) this.removeMine(own[0]!);
    const mesh = this.models.mine.clone();
    mesh.position.copy(pos);
    mesh.rotation.y = yaw;
    this.group.add(mesh);
    const collider = this.physics.addStaticBox({ x: pos.x, y: pos.y + 0.04, z: pos.z }, { x: 0.12, y: 0.05, z: 0.12 }, undefined, Layer.HITBOX);
    const mine: Mine = { id: this.nextId++, owner, pos: pos.clone(), fuse: -1, mesh, collider, seenBy: new Set([owner.team]) };
    this.registry.register(collider.handle, this.damageable(mine, 'mine'), 'body');
    this.mines.push(mine);
    return mine;
  }

  /** Beacons a squad can deploy on. */
  beaconsFor(team: Team, squad: string | null): Beacon[] {
    return this.beacons.filter((b) => b.owner.team === team && b.uses > 0 && (squad === null || b.owner.squad === squad));
  }

  /** Someone deployed on the beacon. */
  useBeacon(b: Beacon): void {
    if (--b.uses <= 0) this.removeBeacon(b);
  }

  /** Enemy mines (of `team`) that `team` knows about within `r` of `p`. */
  knownMinesNear(p: THREE.Vector3, r: number, team: Team): Mine[] {
    return this.mines.filter((m) => m.owner.team !== team && m.seenBy.has(team) && m.pos.distanceToSquared(p) < r * r);
  }

  /** Enemy mines within `r` (whether seen or not), for spotting checks. */
  minesNear(p: THREE.Vector3, r: number, team: Team): Mine[] {
    return this.mines.filter((m) => m.owner.team !== team && m.pos.distanceToSquared(p) < r * r);
  }

  /** A blast: mines in it go off too, beacons break. */
  blast(point: THREE.Vector3, radius: number): void {
    for (const m of [...this.mines]) if (m.fuse < 0 && m.pos.distanceTo(point) < radius * 0.8) m.fuse = 0.12;
    for (const b of [...this.beacons]) if (b.pos.distanceTo(point) < radius) this.breakBeacon(b);
  }

  /** Sim step: shots fly, tripped mines go off. `walkers` are everyone who can trip a mine. */
  step(dt: number, walkers: Iterable<MineWalker>): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]!;
      s.life -= dt;
      s.vel.y -= s.gravity * dt;
      // Missiles turn toward their target (up to 2.4 rad/s).
      const goal = s.homing?.();
      if (goal) {
        const speed = s.vel.length();
        const want = goal.clone().sub(s.pos).normalize();
        const cur = s.vel.clone().normalize();
        const angle = cur.angleTo(want);
        const t = angle > 1e-4 ? Math.min(1, (2.4 * dt) / angle) : 1;
        s.vel.copy(cur.lerp(want, t).normalize().multiplyScalar(speed));
      }
      const d = this.seg.copy(s.vel).multiplyScalar(dt);
      const len = d.length();
      const hit = len > 0 ? this.physics.raycast(s.pos, d.divideScalar(len), len, SHOT_MASK) : null;
      if (hit || s.life <= 0) {
        const at = hit ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) : s.pos.clone();
        // Back off the surface so the blast isn't buried in it.
        if (hit) at.addScaledVector(s.vel.clone().normalize(), -0.12);
        this.removeShot(i);
        if (s.kind === 'riflesmoke') {
          this.hooks.smoke(at, s.owner);
          continue;
        }
        const target = hit ? this.registry.lookup(hit.collider.handle) : undefined;
        if (s.kind === 'shell') {
          this.hooks.shell?.(s.gun ?? '', at, s.owner, target && target.owner.alive ? target.owner : null, target?.part ?? 'body');
          continue;
        }
        if (target && target.owner.alive) this.hooks.directHit(target.owner, target.part, at, s.owner);
        this.hooks.explode('rocket', at, s.owner);
        this.blast(at, 4);
        continue;
      }
      s.pos.addScaledVector(s.vel, dt);
      s.mesh.position.copy(s.pos);
      s.mesh.quaternion.setFromUnitVectors(UP, this.seg.copy(s.vel).normalize());
    }
    const list = [...walkers];
    for (const m of [...this.mines]) {
      if (m.fuse < 0) {
        for (const w of list) {
          if (!w.alive || w.downed || w.team === m.owner.team) continue;
          const dx = w.feet.x - m.pos.x;
          const dz = w.feet.z - m.pos.z;
          if (dx * dx + dz * dz > MINE.radius * MINE.radius || Math.abs(w.feet.y - m.pos.y) > 1.2) continue;
          // Walking over it crouched doesn't press it.
          if (w.eyeHeight < 1.3) continue;
          m.fuse = MINE.delay;
          break;
        }
      }
      if (m.fuse >= 0) {
        m.fuse -= dt;
        if (m.fuse <= 0) {
          this.removeMine(m);
          this.hooks.explode('mine', m.pos.clone().setY(m.pos.y + 0.15), m.owner);
          this.blast(m.pos, 4);
        }
      }
    }
    // Beacon lights blink.
    const on = Math.floor(performance.now() / 600) % 2 === 0;
    for (const b of this.beacons) {
      const light = b.mesh.getObjectByName('light');
      if (light) light.visible = on;
    }
  }

  /** Everything off the field (match restart). */
  clear(): void {
    while (this.shots.length) this.removeShot(this.shots.length - 1);
    for (const b of [...this.beacons]) this.removeBeacon(b);
    for (const m of [...this.mines]) this.removeMine(m);
  }

  private damageable(thing: Beacon | Mine, kind: 'beacon' | 'mine'): Damageable {
    const alive = (): boolean => (kind === 'beacon' ? this.beacons.includes(thing as Beacon) : this.mines.includes(thing as Mine));
    return {
      id: -1000 - thing.id,
      name: kind,
      team: thing.owner.team,
      get alive() {
        return alive();
      },
      applyDamage: (amount: number, _part: HitPart, _source?: DamageSource): boolean => {
        if (kind === 'mine') {
          const m = thing as Mine;
          if (m.fuse < 0) m.fuse = 0.05;
          return true;
        }
        const b = thing as Beacon;
        b.health -= amount;
        if (b.health > 0) return false;
        this.breakBeacon(b);
        return true;
      },
    };
  }

  private breakBeacon(b: Beacon): void {
    if (!this.beacons.includes(b)) return;
    this.removeBeacon(b);
    this.hooks.destroyed?.('beacon', b.pos);
  }

  private removeShot(i: number): void {
    const s = this.shots[i]!;
    this.group.remove(s.mesh);
    this.shots.splice(i, 1);
  }

  private removeBeacon(b: Beacon): void {
    const i = this.beacons.indexOf(b);
    if (i < 0) return;
    this.beacons.splice(i, 1);
    this.group.remove(b.mesh);
    this.registry.unregister(b.collider.handle);
    this.physics.world.removeCollider(b.collider, false);
  }

  private removeMine(m: Mine): void {
    const i = this.mines.indexOf(m);
    if (i < 0) return;
    this.mines.splice(i, 1);
    this.group.remove(m.mesh);
    this.registry.unregister(m.collider.handle);
    this.physics.world.removeCollider(m.collider, false);
  }
}

// ---------------------------------------------------------------------------
// Models (shared geometry, cloned per object).

let cachedModels: ReturnType<typeof buildModels> | null = null;

function gadgetModels(): ReturnType<typeof buildModels> {
  return (cachedModels ??= buildModels());
}

function buildModels(): { rocket: THREE.Group; rifleGrenade: THREE.Group; beacon: THREE.Group; mine: THREE.Group; shell: THREE.Group } {
  const olive = new THREE.MeshStandardMaterial({ color: 0x4a5236, roughness: 0.75, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222325, roughness: 0.6, metalness: 0.5 });
  const flame = new THREE.MeshBasicMaterial({ color: 0xffb35a, toneMapped: false });
  const lit = new THREE.MeshBasicMaterial({ color: 0x5aff7a, toneMapped: false });
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, y = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true;
    return m;
  };
  // Along +Y (turned to the flight direction): warhead on top, tail with fins, flame behind.
  const rocket = new THREE.Group();
  rocket.add(mesh(new THREE.SphereGeometry(0.075, 12, 8).scale(1, 1.5, 1), olive, 0.08));
  rocket.add(mesh(new THREE.ConeGeometry(0.035, 0.06, 10), dark, 0.2));
  rocket.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 8), dark, -0.14));
  for (let i = 0; i < 4; i++) {
    const fin = mesh(new THREE.BoxGeometry(0.004, 0.08, 0.05), dark, -0.28);
    fin.rotation.y = (i * Math.PI) / 2;
    rocket.add(fin);
  }
  rocket.add(mesh(new THREE.ConeGeometry(0.03, 0.18, 8).rotateX(Math.PI), flame, -0.42));
  // A shell with a bright tracer behind it (along +Y).
  const shell = new THREE.Group();
  shell.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), dark, 0));
  shell.add(mesh(new THREE.CylinderGeometry(0.02, 0.06, 1.6, 6), new THREE.MeshBasicMaterial({ color: 0xffd38a, toneMapped: false, transparent: true, opacity: 0.8 }), -1.0));
  const rifleGrenade = new THREE.Group();
  rifleGrenade.add(mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.12, 10), new THREE.MeshStandardMaterial({ color: 0x8a8f86, roughness: 0.6 }), 0.04));
  rifleGrenade.add(mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.16, 8), dark, -0.1));
  const beacon = new THREE.Group();
  beacon.add(mesh(new THREE.BoxGeometry(0.22, 0.26, 0.16), olive, 0.13));
  beacon.add(mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.5, 6), dark, 0.51));
  const light = mesh(new THREE.SphereGeometry(0.025, 8, 6), lit, 0.29);
  light.name = 'light';
  beacon.add(light);
  const mine = new THREE.Group();
  mine.add(mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.06, 16), olive, 0.03));
  mine.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12), dark, 0.07));
  return { rocket, rifleGrenade, beacon, mine, shell };
}
