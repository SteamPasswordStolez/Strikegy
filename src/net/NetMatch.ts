/**
 * The browser's side of a match on the game server.
 *
 * - Its own soldier runs here first (prediction) with the inputs it sends;
 *   snapshots say where the server has it after the last input it stepped,
 *   and any difference from where this browser had it then is shifted in.
 * - Everyone else is drawn a little in the past (`INTERP_TICKS`), blended
 *   between the snapshots around that moment, with hitboxes there so this
 *   browser's rounds stop on them (the server judges the damage).
 * - The match's news and tables come as JSON and go to the game (`onEvents`,
 *   `onState`, `onRoster`).
 */
import * as THREE from 'three';
import { SoldierModel } from '@/ai/SoldierModel';
import type { AudioSystem } from '@/audio/AudioSystem';
import { CharacterHitboxes } from '@/combat/CharacterHitboxes';
import type { Damageable, HitboxRegistry } from '@/combat/Hitboxes';
import type { InputState } from '@/input/InputState';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import { MOVE } from '@/player/movement';
import type { Effects } from '@/render/Effects';
import type { Soldier } from '@/sim/Soldier';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';
import type { Team } from '@/world/mapTypes';
import type { ServerLink } from './ServerLink';
import type { MatchEvent, MatchSoldierInfo, MatchStart, ServerMsg } from './lobbyProtocol';
import { INTERP_TICKS, SF, THING, TICK_HZ, decodeSnapshot, encodeInputs, packInput, type NetInput, type Snapshot } from './matchProtocol';

export interface NetOptions {
  link: ServerLink;
  start: MatchStart;
}

/** What the game lends the match for drawing other soldiers. */
export interface NetView {
  scene: THREE.Scene;
  physics: PhysicsWorld;
  registry: HitboxRegistry;
  audio: AudioSystem;
  effects: Effects;
  camera: THREE.Camera;
}

interface Sample {
  tick: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  weapon: WeaponId;
  shots: number;
}

/** Samples kept per soldier (a second and a half at 20 Hz). */
const KEEP = 30;
/** A corpse stays this long after the soldier left the field (s). */
const CORPSE_SEC = 4;
/** Differences from the server's position smaller than this are left alone (m). */
const CORRECT_MIN = 0.02;

/** Someone else in the match, as this browser draws them. */
class Remote {
  readonly samples: Sample[] = [];
  model: SoldierModel | null = null;
  private weapon: WeaponId | null = null;
  readonly boxes: CharacterHitboxes;
  private readonly target: Damageable;
  private readonly pos = new THREE.Vector3();
  private readonly prevPos = new THREE.Vector3();
  private crouch = 0;
  private downFor = -1;
  private goneFor = -1;
  private shotsSeen = -1;
  private wasAlive = false;
  /** On the field in the moment drawn. */
  visible = false;
  alive = false;
  private readonly muzzle = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    readonly id: number,
    public team: Team,
    public name: string,
    private readonly view: NetView,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.target = {
      id,
      get name() {
        return self.name;
      },
      get team() {
        return self.team;
      },
      get alive() {
        return self.alive;
      },
      // The server judges damage; here the round just stops.
      applyDamage: () => false,
    };
    this.boxes = new CharacterHitboxes(view.physics, view.registry, this.target);
    this.boxes.setEnabled(false);
  }

  get feet(): THREE.Vector3 {
    return this.pos;
  }

  /** Down and waiting for a revive, in the moment drawn. */
  get downed(): boolean {
    return this.downFor >= 0;
  }

  add(s: Sample): void {
    const list = this.samples;
    if (list.length && list[list.length - 1]!.tick >= s.tick) return;
    list.push(s);
    if (list.length > KEEP) list.shift();
  }

  /** Draws the soldier as it was at `tick` (fractional). */
  render(tick: number, dt: number): void {
    const list = this.samples;
    if (!list.length) return;
    let a = list[0]!;
    let b = a;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.tick <= tick) {
        a = list[i]!;
        b = list[i + 1] ?? a;
        break;
      }
    }
    const span = b.tick - a.tick;
    const f = span > 0 ? Math.min(1, Math.max(0, (tick - a.tick) / span)) : 0;
    this.prevPos.copy(this.pos);
    this.pos.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
    const dy = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
    const yaw = a.yaw + dy * f;
    const pitch = a.pitch + (b.pitch - a.pitch) * f;
    const flags = f < 0.5 ? a.flags : b.flags;
    const deployed = (flags & SF.deployed) !== 0;
    const downed = (flags & SF.downed) !== 0;
    this.alive = deployed && (flags & SF.alive) !== 0 && !downed;
    const speed = span > 0 ? Math.hypot(b.x - a.x, b.z - a.z) / (span / TICK_HZ) : 0;
    const k = 1 - Math.exp(-10 * dt);
    this.crouch += (((flags & SF.crouch) !== 0 ? 1 : 0) - this.crouch) * k;

    // Down: lying there, the clock running (the fall); gone from the field: the corpse stays a while.
    const wasDown = this.downFor >= 0;
    if (downed) this.downFor = wasDown ? this.downFor + dt : 0;
    else this.downFor = -1;
    if (deployed) {
      this.goneFor = -1;
      this.wasAlive = true;
    } else if (this.wasAlive) {
      this.goneFor = 0;
      this.wasAlive = false;
    } else if (this.goneFor >= 0) {
      this.goneFor += dt;
      if (this.goneFor > CORPSE_SEC) this.goneFor = -1;
    }
    this.visible = deployed || this.goneFor >= 0;
    if (downed && !wasDown) this.model?.onDeath();

    // Hitboxes where this browser sees the soldier.
    this.boxes.setEnabled(this.alive);
    if (this.alive) this.boxes.sync(this.pos, yaw, (flags & SF.crouch) !== 0 ? MOVE.crouchHeight : MOVE.standHeight);

    const weapon = (f < 0.5 ? a : b).weapon;
    if (!this.visible) {
      this.model?.root.removeFromParent();
      return;
    }
    if (!this.model || weapon !== this.weapon) {
      this.model?.dispose();
      this.model = new SoldierModel(this.team, WEAPONS[weapon]);
      this.weapon = weapon;
      this.view.scene.add(this.model.root);
    } else if (!this.model.root.parent) this.view.scene.add(this.model.root);
    const dead = !this.alive;
    this.model.update(this.pos, {
      speed: this.alive ? speed : 0,
      crouch: this.crouch,
      yaw,
      aimPitch: pitch,
      deadFor: dead ? (this.downFor >= 0 ? this.downFor : 10) : -1,
      dt,
    });

    // Rounds fired by the moment drawn: flashes, sound and a tracer to where the aim meets the world.
    const shots = a.shots;
    if (this.shotsSeen < 0) this.shotsSeen = shots;
    const fresh = (shots - this.shotsSeen) & 0xff;
    this.shotsSeen = shots;
    if (fresh > 0 && fresh < 20 && this.alive) this.fired(Math.min(3, fresh), weapon, yaw, pitch);
  }

  private fired(n: number, weapon: WeaponId, yaw: number, pitch: number): void {
    const def = WEAPONS[weapon];
    const v = this.view;
    this.model!.muzzleWorld(this.muzzle);
    this.euler.set(pitch, yaw, 0);
    this.fwd.set(0, 0, -1).applyEuler(this.euler);
    const eye = this.pos.clone();
    eye.y += (this.crouch > 0.5 ? MOVE.crouchHeight : MOVE.standHeight) - MOVE.eyeInset;
    for (let i = 0; i < n; i++) {
      const hit = v.physics.raycast(eye, this.fwd, def.range * 1.5, Layer.WORLD);
      const to = hit ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) : eye.clone().addScaledVector(this.fwd, def.range);
      v.effects.spawnShots([{ from: eye.clone(), to }], this.muzzle);
    }
    v.effects.muzzleFlash(this.muzzle, this.fwd);
    v.audio.remoteGunshot(def.class, this.muzzle, this.muzzle.distanceTo(v.camera.position));
  }

  dispose(): void {
    this.model?.dispose();
    this.boxes.dispose();
  }
}

/** A grenade (or the like) in the air as the server last saw it: drawn between its samples. */
interface Thing {
  kind: number;
  samples: { tick: number; x: number; y: number; z: number }[];
  mesh: THREE.Mesh;
  /** Last snapshot tick it was in. */
  seen: number;
}

const THING_COLOR: Record<number, number> = { [THING.frag]: 0x3f4a33, [THING.flash]: 0x5b5f66, [THING.smoke]: 0x6b6f5a };
const thingGeometry = new THREE.CapsuleGeometry(0.036, 0.045, 4, 10);
const thingMaterials = new Map<number, THREE.Material>();

export class NetMatch {
  readonly roster = new Map<number, MatchSoldierInfo>();
  private readonly things = new Map<number, Thing>();
  /** Explosions waiting for the moment drawn to reach them. */
  private readonly booms: Extract<MatchEvent, { k: 'boom' }>[] = [];
  /** A grenade went off where (and when) this browser draws things. */
  onBoom: (e: Extract<MatchEvent, { k: 'boom' }>) => void = () => {};
  private readonly remotes = new Map<number, Remote>();
  /** Server tick = this + now (ms) * TICK_HZ / 1000, smoothed from snapshot arrivals. */
  private offset: number | null = null;
  private seq = 0;
  private readonly outbox: NetInput[] = [];
  /** Where this browser had its soldier after each input it stepped, by seq. */
  private readonly predicted = new Map<number, { x: number; y: number; z: number }>();
  private readonly offs: (() => void)[] = [];
  /** Snapshots received (for the F3 panel), and the last one's own part. */
  snapshots = 0;
  lastSelf: Snapshot['self'] = null;
  /** The size of the last correction (m), for the perf panel. */
  lastCorrection = 0;

  onEvents: (ev: MatchEvent[]) => void = () => {};
  onState: (msg: Extract<ServerMsg, { t: 'mstate' }>) => void = () => {};
  onRoster: () => void = () => {};
  onClosed: () => void = () => {};
  /** The room went back to waiting (the owner ended the match, or it's over). */
  onRoomBack: () => void = () => {};

  constructor(
    readonly link: ServerLink,
    readonly start: MatchStart,
    private readonly me: Soldier,
    private readonly view: NetView,
  ) {
    this.setRoster(start.roster);
    this.offs.push(
      link.onBinary((d) => this.onFrame(d)),
      link.on('ev', (m) => {
        // Explosions wait for their moment; the rest is news now.
        const now: MatchEvent[] = [];
        for (const e of m.ev) (e.k === 'boom' ? this.booms : now).push(e as never);
        if (now.length) this.onEvents(now);
      }),
      link.on('mstate', (m) => this.onState(m)),
      link.on('roster', (m) => this.setRoster(m.roster)),
      link.on('close', () => this.onClosed()),
      link.on('room', (m) => {
        if (m.room.state === 'lobby') this.onRoomBack();
      }),
    );
  }

  get myId(): number {
    return this.start.me;
  }

  get myTeam(): Team {
    return this.start.team;
  }

  /** Everyone else this browser draws (minimap, deploy screen). */
  *others(): Iterable<{ id: number; team: Team; name: string; alive: boolean; downed: boolean; feet: THREE.Vector3 }> {
    for (const r of this.remotes.values()) if (r.visible) yield { id: r.id, team: r.team, name: r.name, alive: r.alive, downed: r.downed, feet: r.feet };
  }

  nameOf(id: number): string {
    return this.roster.get(id)?.name ?? '?';
  }

  /** Loaded and drawing: snapshots may come. */
  ready(): void {
    this.link.send({ t: 'ready' });
  }

  deploy(key: string, kit: unknown): void {
    this.link.send({ t: 'deploy', key, kit });
  }

  // ---------------------------------------------------------------------------
  // Clock

  /** The server's tick now, as well as this browser can tell (fractional). */
  serverTick(now = performance.now()): number {
    return this.offset === null ? this.start.tick : this.offset + (now * TICK_HZ) / 1000;
  }

  /** The tick other soldiers are drawn at. */
  viewTick(now = performance.now()): number {
    return this.serverTick(now) - INTERP_TICKS;
  }

  // ---------------------------------------------------------------------------
  // Inputs

  /**
   * Packs this step's controls for the server and writes the rounded values
   * back into `input` (and returns the look and sway to step with), so this
   * browser steps exactly what the server will.
   */
  pack(input: InputState, yaw: number, pitch: number, swayYaw: number, swayPitch: number): NetInput {
    const n = packInput(input, ++this.seq, this.viewTick(), yaw, pitch, swayYaw, swayPitch);
    input.moveX = n.moveX;
    input.moveY = n.moveY;
    input.weaponCycle = n.weaponCycle;
    input.weaponSlot = n.weaponSlot;
    this.outbox.push(n);
    return n;
  }

  /** Where the soldier ended up after input `seq` here. */
  stepped(seq: number, feet: THREE.Vector3): void {
    this.predicted.set(seq, { x: feet.x, y: feet.y, z: feet.z });
    // Old ones the server never acked (off the field meanwhile) don't pile up.
    if (this.predicted.size > 600) {
      const cut = seq - 300;
      for (const k of this.predicted.keys()) if (k < cut) this.predicted.delete(k);
    }
  }

  /** A new life: where the soldier was before means nothing now. */
  respawned(): void {
    this.predicted.clear();
  }

  /** Sends this frame's inputs in one frame. */
  flush(): void {
    if (!this.outbox.length) return;
    this.link.sendBinary(encodeInputs(this.outbox));
    this.outbox.length = 0;
  }

  // ---------------------------------------------------------------------------

  private setRoster(list: readonly MatchSoldierInfo[]): void {
    this.roster.clear();
    for (const s of list) this.roster.set(s.id, s);
    for (const [id, r] of this.remotes) {
      const info = this.roster.get(id);
      if (!info) {
        r.dispose();
        this.remotes.delete(id);
      } else r.name = info.name;
    }
    this.onRoster();
  }

  private onFrame(data: Uint8Array): void {
    const snap = decodeSnapshot(data);
    if (!snap) return;
    this.snapshots++;
    // Clock: follow arrivals quickly when they come early, slowly when late (jitter).
    const sample = snap.tick - (performance.now() * TICK_HZ) / 1000;
    if (this.offset === null || Math.abs(sample - this.offset) > 30) this.offset = sample;
    else this.offset += (sample - this.offset) * (sample > this.offset ? 0.3 : 0.02);
    for (const s of snap.soldiers) {
      if (s.id === this.myId) continue;
      let r = this.remotes.get(s.id);
      if (!r) {
        const info = this.roster.get(s.id);
        r = new Remote(s.id, info?.team ?? 'red', info?.name ?? '?', this.view);
        this.remotes.set(s.id, r);
      }
      r.add({ tick: snap.tick, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, flags: s.flags, weapon: s.weapon, shots: s.shots });
    }
    for (const t of snap.things) {
      let th = this.things.get(t.id);
      if (!th || th.kind !== t.kind) {
        if (th) th.mesh.removeFromParent();
        let mat = thingMaterials.get(t.kind);
        if (!mat) thingMaterials.set(t.kind, (mat = new THREE.MeshStandardMaterial({ color: THING_COLOR[t.kind] ?? 0x555555, roughness: 0.6, metalness: 0.3 })));
        th = { kind: t.kind, samples: [], mesh: new THREE.Mesh(thingGeometry, mat), seen: snap.tick };
        this.things.set(t.id, th);
      }
      th.seen = snap.tick;
      th.samples.push({ tick: snap.tick, x: t.x, y: t.y, z: t.z });
      if (th.samples.length > 12) th.samples.shift();
    }
    const mine = snap.soldiers.find((s) => s.id === this.myId);
    if (snap.self && mine) this.correct(snap.self, mine.flags);
    this.lastSelf = snap.self;
  }

  /** The server's word on where this browser's soldier was after input `ack`. */
  private correct(self: NonNullable<Snapshot['self']>, flags: number): void {
    const me = this.me;
    const p = me.player;
    if (!(flags & SF.deployed) || !(flags & SF.alive) || !me.deployed || !p.alive) return;
    if (!(flags & SF.downed) && self.health > 0) p.health.value = self.health;
    const then = this.predicted.get(self.ack);
    for (const k of this.predicted.keys()) if (k <= self.ack) this.predicted.delete(k);
    if (!then) return;
    const dx = self.x - then.x;
    const dy = self.y - then.y;
    const dz = self.z - then.z;
    const err = Math.hypot(dx, dy, dz);
    this.lastCorrection = err;
    if (err < CORRECT_MIN) return;
    p.nudge(dx, dy, dz);
    for (const v of this.predicted.values()) {
      v.x += dx;
      v.y += dy;
      v.z += dz;
    }
    // Far off (a shove, a wall the server had): take its motion too.
    if (err > 0.5) p.velocity.set(self.vx, self.vy, self.vz);
  }

  /** Draws everyone else, grenades in the air and explosions due, for this frame. */
  render(dt: number): void {
    const tick = this.viewTick();
    for (const r of this.remotes.values()) r.render(tick, dt);
    for (const [id, th] of this.things) {
      const list = th.samples;
      // Gone from the snapshots and past the moment drawn: it went off (or vanished).
      if (th.seen < tick - 1 && list[list.length - 1]!.tick < tick) {
        th.mesh.removeFromParent();
        this.things.delete(id);
        continue;
      }
      if (list[0]!.tick > tick) {
        th.mesh.removeFromParent();
        continue;
      }
      let a = list[0]!;
      let b = a;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i]!.tick <= tick) {
          a = list[i]!;
          b = list[i + 1] ?? a;
          break;
        }
      }
      const f = b.tick > a.tick ? Math.min(1, (tick - a.tick) / (b.tick - a.tick)) : 0;
      th.mesh.position.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
      th.mesh.rotation.x += dt * 9;
      if (!th.mesh.parent) this.view.scene.add(th.mesh);
    }
    while (this.booms.length && this.booms[0]!.tick <= tick) this.onBoom(this.booms.shift()!);
  }

  dispose(): void {
    for (const off of this.offs) off();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    for (const th of this.things.values()) th.mesh.removeFromParent();
    this.things.clear();
  }
}
