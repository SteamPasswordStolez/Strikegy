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
 * - Vehicles are copies in the game's vehicle world, put where the server
 *   had them at the moment drawn (kinematic bodies, so the player bumps into
 *   them), except the one this browser's player drives: that one it drives
 *   itself and sends where it has it with the inputs.
 */
import * as THREE from 'three';
import { SoldierModel } from '@/ai/SoldierModel';
import type { AudioSystem } from '@/audio/AudioSystem';
import { CharacterHitboxes } from '@/combat/CharacterHitboxes';
import type { Damageable, HitboxRegistry } from '@/combat/Hitboxes';
import type { Combatant } from '@/ai/types';
import type { InputState } from '@/input/InputState';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import { MOVE } from '@/player/movement';
import type { Effects } from '@/render/Effects';
import { gadgetModel } from '@/modes/gadgetWorld';
import { LAYER_FX } from '@/render/layers';
import type { Soldier } from '@/sim/Soldier';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';
import type { Vehicle } from '@/vehicles/Vehicle';
import type { VehicleWorld } from '@/vehicles/VehicleWorld';
import type { Team } from '@/world/mapTypes';
import type { ServerLink } from './ServerLink';
import type { MatchEvent, MatchSoldierInfo, MatchStart, ServerMsg } from './lobbyProtocol';
import { INTERP_TICKS, SF, THING, TICK_HZ, VF, decodeSnapshot, encodeInputFrame, packInput, type NetBots, type NetInput, type NetVehicle, type Snapshot } from './matchProtocol';

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

const UP = new THREE.Vector3(0, 1, 0);
/** Ticks without a snapshot after which someone counts as gone from view (allies come in every one). */
const GAP = 12;
/** Samples kept per soldier (a second and a half at 20 Hz). */
const KEEP = 30;
/** A corpse stays this long after the soldier left the field (s). */
const CORPSE_SEC = 4;
/** Inputs each UDP frame carries (the newest and the few before it, in case those frames were lost). */
const REDUNDANT = 6;
/** Differences from the server's position smaller than this are left alone (m). */
const CORRECT_MIN = 0.02;

/** Someone else in the match, as this browser draws them. */
/** A name over a person's head: allies seen through walls, enemies only when in sight. */
function nameTag(name: string, ally: boolean): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 30px Bahnschrift, "Malgun Gothic", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(name, 128, 32, 248);
  g.fillStyle = ally ? '#7fb6ff' : '#ff7a6b';
  g.fillText(name, 128, 32, 248);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: !ally, depthWrite: false, sizeAttenuation: false, toneMapped: false }));
  s.scale.set(0.1, 0.025, 1);
  s.renderOrder = 10;
  s.layers.set(LAYER_FX);
  return s;
}

/** Name tags show within this distance (m). */
const TAG_RANGE = 120;

class Remote {
  readonly samples: Sample[] = [];
  /** A person (not a bot): gets a name tag. */
  human = false;
  /** On this browser's side. */
  ally = false;
  private tag: THREE.Sprite | null = null;
  private tagText = '';
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
  /** In a vehicle in the moment drawn (not drawn: the vehicle is). */
  riding = false;
  /** A bot this browser runs itself (drawn and hit there): this copy only keeps its place for the map. */
  hidden = false;
  /** When it last fired (s, performance clock), and how it moves in the moment drawn (m/s). */
  firedAt = -Infinity;
  readonly vel = new THREE.Vector3();
  private crouched = false;
  /** As the bots this browser runs see it. */
  readonly combatant: Combatant;
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
    const now = () => performance.now() / 1000;
    this.combatant = {
      id,
      get name() {
        return self.name;
      },
      get team() {
        return self.team;
      },
      // In a vehicle: not something a rifle can take on (the server's bots handle those).
      get alive() {
        return self.alive && !self.riding;
      },
      get downed() {
        return self.downed;
      },
      get feet() {
        return self.pos;
      },
      get velocity() {
        return self.vel;
      },
      get eyeHeight() {
        return (self.crouched ? MOVE.crouchHeight : MOVE.standHeight) - MOVE.eyeInset;
      },
      get firingUntil() {
        return now() - self.firedAt < 0.6 ? Infinity : -Infinity;
      },
      get yaw() {
        return self.yaw;
      },
      inCombat: () => now() - self.firedAt < 3,
    };
  }

  get feet(): THREE.Vector3 {
    return this.pos;
  }

  /** Down and waiting for a revive, in the moment drawn. */
  get downed(): boolean {
    return this.downFor >= 0;
  }

  /** Facing in the moment drawn. */
  yaw = 0;

  /** The newest flags (what the soldier could use from a mate). */
  get flags(): number {
    return this.samples[this.samples.length - 1]?.flags ?? 0;
  }

  add(s: Sample): void {
    const list = this.samples;
    if (list.length && list[list.length - 1]!.tick >= s.tick) return;
    // Back after a gap (an enemy out of sight is left out of the snapshots): start afresh here, no slide from where it was.
    if (list.length && s.tick - list[list.length - 1]!.tick > GAP) {
      list.length = 0;
      this.shotsSeen = -1;
    }
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
    // No longer in the snapshots (out of sight): not drawn, not hittable here, not on the map.
    if (tick - list[list.length - 1]!.tick > GAP) {
      this.visible = this.alive = false;
      this.boxes.setEnabled(false);
      this.model?.root.removeFromParent();
      this.tag?.removeFromParent();
      return;
    }
    const span = b.tick - a.tick;
    const f = span > 0 ? Math.min(1, Math.max(0, (tick - a.tick) / span)) : 0;
    this.prevPos.copy(this.pos);
    this.pos.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
    const dy = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
    const yaw = a.yaw + dy * f;
    this.yaw = yaw;
    const pitch = a.pitch + (b.pitch - a.pitch) * f;
    const flags = f < 0.5 ? a.flags : b.flags;
    const deployed = (flags & SF.deployed) !== 0;
    const downed = (flags & SF.downed) !== 0;
    this.alive = deployed && (flags & SF.alive) !== 0 && !downed;
    this.riding = (flags & SF.riding) !== 0;
    this.crouched = (flags & SF.crouch) !== 0;
    if (dt > 0) this.vel.subVectors(this.pos, this.prevPos).divideScalar(dt);
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
    if (this.hidden) {
      this.boxes.setEnabled(false);
      this.model?.root.removeFromParent();
      this.tag?.removeFromParent();
      this.shotsSeen = -1;
      return;
    }

    // Hitboxes where this browser sees the soldier.
    this.boxes.setEnabled(this.alive && !this.riding);
    if (this.alive && !this.riding) this.boxes.sync(this.pos, yaw, (flags & SF.crouch) !== 0 ? MOVE.crouchHeight : MOVE.standHeight);

    const weapon = (f < 0.5 ? a : b).weapon;
    if (!this.visible || this.riding) {
      this.model?.root.removeFromParent();
      this.tag?.removeFromParent();
      return;
    }
    if (!this.model || weapon !== this.weapon) {
      this.model?.dispose();
      this.model = new SoldierModel(this.team, WEAPONS[weapon]);
      this.weapon = weapon;
      this.view.scene.add(this.model.root);
    } else if (!this.model.root.parent) this.view.scene.add(this.model.root);
    const dead = !this.alive;
    this.updateTag();
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
    if (fresh > 0 && fresh < 20 && this.alive) {
      this.firedAt = performance.now() / 1000;
      this.fired(Math.min(3, fresh), weapon, yaw, pitch);
    }
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

  /** The name over a person's head while up (and within range). */
  private updateTag(): void {
    const show = this.human && this.alive && this.pos.distanceTo(this.view.camera.position) < TAG_RANGE;
    if (!show) {
      this.tag?.removeFromParent();
      return;
    }
    if (!this.tag || this.tagText !== this.name) {
      this.tag?.removeFromParent();
      this.tag?.material.map?.dispose();
      this.tag?.material.dispose();
      this.tag = nameTag(this.name, this.ally);
      this.tagText = this.name;
    }
    this.tag.position.set(this.pos.x, this.pos.y + 2.15 - this.crouch * 0.6, this.pos.z);
    if (!this.tag.parent) this.view.scene.add(this.tag);
  }

  dispose(): void {
    this.model?.dispose();
    this.boxes.dispose();
    this.tag?.removeFromParent();
    this.tag?.material.map?.dispose();
    this.tag?.material.dispose();
  }
}

/** A vehicle as the server had it at a tick. */
interface VehicleSample {
  tick: number;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  seats: NetVehicle['seats'];
}

/** A vehicle this browser draws from the server's snapshots. */
interface VehicleTrack {
  v: Vehicle;
  samples: VehicleSample[];
  /** Last snapshot tick it was in. */
  seen: number;
  /** Rounds seen fired per seat. */
  shots: number[];
}

/** A grenade (or the like) in the air as the server last saw it: drawn between its samples. */
interface Thing {
  kind: number;
  samples: { tick: number; x: number; y: number; z: number }[];
  mesh: THREE.Object3D;
  /** Last snapshot tick it was in. */
  seen: number;
}

const THING_COLOR: Record<number, number> = { [THING.frag]: 0x3f4a33, [THING.flash]: 0x5b5f66, [THING.smoke]: 0x6b6f5a };
const thingGeometry = new THREE.CapsuleGeometry(0.036, 0.045, 4, 10);
const thingMaterials = new Map<number, THREE.Material>();

/** The model for a kind of thing: grenades as small capsules, gadgets as their own models. */
function thingMesh(kind: number): THREE.Object3D {
  const gadget = { [THING.rocket]: 'rocket', [THING.riflesmoke]: 'rifleGrenade', [THING.shell]: 'shell', [THING.beacon]: 'beacon', [THING.mine]: 'mine' } as const;
  const g = gadget[kind as keyof typeof gadget];
  if (g) return gadgetModel(g);
  let mat = thingMaterials.get(kind);
  if (!mat) thingMaterials.set(kind, (mat = new THREE.MeshStandardMaterial({ color: THING_COLOR[kind] ?? 0x555555, roughness: 0.6, metalness: 0.3 })));
  return new THREE.Mesh(thingGeometry, mat);
}

export class NetMatch {
  readonly roster = new Map<number, MatchSoldierInfo>();
  private readonly things = new Map<number, Thing>();
  private readonly dir = new THREE.Vector3();
  /** Explosions waiting for the moment drawn to reach them. */
  private readonly booms: Extract<MatchEvent, { k: 'boom' }>[] = [];
  /** A grenade went off where (and when) this browser draws things. */
  onBoom: (e: Extract<MatchEvent, { k: 'boom' }>) => void = () => {};
  private readonly remotes = new Map<number, Remote>();
  /** The game's vehicle world (zone matches): copies of the server's vehicles go in there. */
  vehicles: VehicleWorld | null = null;
  /** The vehicle this browser's player drives (this browser moves it), or null. */
  drive: Vehicle | null = null;
  /** A vehicle came into view (the game may be waiting to get in it). */
  onVehicle: (v: Vehicle) => void = () => {};
  /** Bots this browser runs for the server (drawn and hit by its own copies). */
  readonly owned = new Set<number>();
  /** What those bots are doing, for the next input frame (null: none). */
  botFrame: (() => NetBots | null) | null = null;
  /** The server's word on one of those bots (it judges health, going down and dying). */
  onOwned: (id: number, flags: number, health: number) => void = () => {};
  private readonly tracks = new Map<number, VehicleTrack>();
  private readonly vq = new THREE.Quaternion();
  private readonly vp = new THREE.Vector3();
  /** Server tick = this + now (ms) * TICK_HZ / 1000, smoothed from snapshot arrivals. */
  private offset: number | null = null;
  private seq = 0;
  private readonly outbox: NetInput[] = [];
  /** Inputs sent that the server hasn't stepped yet: over UDP the last few go again with every frame (a lost frame costs nothing). */
  private readonly unacked: NetInput[] = [];
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
    link.startUdp();
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
  /** Someone else as this browser draws them, if snapshots have brought them. */
  remote(id: number): { readonly alive: boolean; readonly downed: boolean; readonly feet: THREE.Vector3; readonly yaw: number } | undefined {
    return this.remotes.get(id);
  }

  *others(): Iterable<{ id: number; team: Team; name: string; alive: boolean; downed: boolean; feet: THREE.Vector3; flags: number }> {
    for (const r of this.remotes.values()) if (r.visible) yield { id: r.id, team: r.team, name: r.name, alive: r.alive, downed: r.downed, feet: r.feet, flags: r.flags };
  }

  nameOf(id: number): string {
    return this.roster.get(id)?.name ?? '?';
  }

  /** Loaded and drawing: snapshots may come (`hostBots`: this browser can run some of the bots). */
  ready(hostBots = false): void {
    this.link.send({ t: 'ready', hostBots });
  }

  /** Everyone else on the field as bots see them (not the bots this browser runs). */
  *combatants(): Iterable<Combatant> {
    for (const r of this.remotes.values()) if (r.visible && !r.hidden) yield r.combatant;
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

  /** Sends this frame's inputs in one frame (with where the vehicle this player drives is). */
  flush(): void {
    if (!this.outbox.length) return;
    const d = this.drive;
    const drive = d && !d.wrecked ? { vehicle: d.id, x: d.pos.x, y: d.pos.y, z: d.pos.z, qx: d.quat.x, qy: d.quat.y, qz: d.quat.z, qw: d.quat.w, vx: d.velocity.x, vy: d.velocity.y, vz: d.velocity.z, throttle: d.flight?.throttle ?? 0 } : null;
    const bots = this.botFrame?.() ?? null;
    this.unacked.push(...this.outbox);
    if (this.unacked.length > REDUNDANT * 4) this.unacked.splice(0, this.unacked.length - REDUNDANT * 4);
    // What bots did must arrive (the WebSocket); the rest may go over UDP, with the last few inputs again.
    const reliable = !this.link.udp || (bots?.events.length ?? 0) > 0;
    this.link.sendBinary(encodeInputFrame(this.link.udp ? this.unacked.slice(-REDUNDANT) : this.outbox, drive, bots), reliable);
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
      } else {
        r.name = info.name;
        r.human = !info.bot;
      }
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
        r.human = !!info && !info.bot;
        r.ally = r.team === this.myTeam;
        this.remotes.set(s.id, r);
      }
      r.add({ tick: snap.tick, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, flags: s.flags, weapon: s.weapon, shots: s.shots });
      r.hidden = this.owned.has(s.id);
      if (r.hidden) this.onOwned(s.id, s.flags, s.health);
    }
    for (const t of snap.things) {
      let th = this.things.get(t.id);
      if (!th || th.kind !== t.kind) {
        if (th) th.mesh.removeFromParent();
        th = { kind: t.kind, samples: [], mesh: thingMesh(t.kind), seen: snap.tick };
        this.things.set(t.id, th);
      }
      th.seen = snap.tick;
      th.samples.push({ tick: snap.tick, x: t.x, y: t.y, z: t.z });
      if (th.samples.length > 12) th.samples.shift();
    }
    this.takeVehicles(snap.tick, snap.vehicles);
    const mine = snap.soldiers.find((s) => s.id === this.myId);
    if (snap.self) {
      const ack = snap.self.ack;
      let n = 0;
      while (n < this.unacked.length && this.unacked[n]!.seq <= ack) n++;
      if (n) this.unacked.splice(0, n);
    }
    if (snap.self && mine) this.correct(snap.self, mine.flags);
    this.lastSelf = snap.self;
  }

  // ---------------------------------------------------------------------------
  // Vehicles

  private takeVehicles(tick: number, list: readonly NetVehicle[]): void {
    const vw = this.vehicles;
    if (!vw) return;
    for (const n of list) {
      let tr = this.tracks.get(n.id);
      const pos = new THREE.Vector3(n.x, n.y, n.z);
      const quat = new THREE.Quaternion(n.qx, n.qy, n.qz, n.qw).normalize();
      if (!tr || !vw.get(tr.v.id)) {
        const home = n.flags & VF.homeBlue ? 'blue' : n.flags & VF.homeRed ? 'red' : null;
        const yaw = new THREE.Euler().setFromQuaternion(quat, 'YXZ').y;
        const v = vw.spawn(n.kind, pos, yaw, home, n.id);
        v.setRemote(true);
        v.snap(pos, quat);
        if (v.flight) v.flightFromQuat();
        tr = { v, samples: [], seen: tick, shots: n.seats.map((s) => s.shots) };
        this.tracks.set(n.id, tr);
        this.onVehicle(v);
      }
      const v = tr.v;
      tr.seen = tick;
      tr.samples.push({ tick, pos, quat, seats: n.seats });
      if (tr.samples.length > 12) tr.samples.shift();
      v.health = n.health * v.spec.health;
      v.driverOnly = n.driverOnly < 0 ? null : n.driverOnly;
      if (n.flags & VF.wrecked && !v.wrecked) vw.burnOut(v);
      // Who sits where (this browser's own seat too: the game moves its player in and out on the server's word).
      n.seats.forEach((s, i) => {
        v.seats[i] = s.id < 0 ? null : { id: s.id, team: s.id === this.myId ? this.myTeam : (this.roster.get(s.id)?.team ?? v.home ?? 'red') };
      });
    }
  }

  /**
   * Puts every vehicle but the one this player drives where the server had
   * it at the moment drawn, turns their guns and draws the rounds they fired
   * (call before the vehicles are drawn). Vehicles gone from the snapshots go.
   */
  placeVehicles(): void {
    const vw = this.vehicles;
    if (!vw) return;
    const tick = this.viewTick();
    for (const [id, tr] of this.tracks) {
      const v = tr.v;
      const list = tr.samples;
      const last = list[list.length - 1]!;
      if (!vw.get(v.id) || (tr.seen < this.serverTick() - 12 && last.tick < tick)) {
        if (vw.get(v.id) && v !== this.drive) vw.remove(v);
        this.tracks.delete(id);
        continue;
      }
      if (v === this.drive) continue;
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
      this.vp.lerpVectors(a.pos, b.pos, f);
      this.vq.slerpQuaternions(a.quat, b.quat, f);
      if (span > 0) v.velocity.subVectors(b.pos, a.pos).multiplyScalar(TICK_HZ / span);
      v.snap(this.vp, this.vq);
      if (v.flight) v.flightFromQuat();
      const seats = (f < 0.5 ? a : b).seats;
      seats.forEach((s, i) => {
        const m = v.mounts[i];
        if (!m || s.id === this.myId) return;
        m.yaw = s.yaw;
        m.pitch = s.pitch;
        if (v.altMounts[i]) {
          v.altMounts[i]!.yaw = s.yaw;
          v.altMounts[i]!.pitch = s.pitch;
        }
      });
      // Rounds fired by the moment drawn (this player's own are drawn when fired).
      a.seats.forEach((s, i) => {
        const fresh = (s.shots - (tr.shots[i] ?? s.shots)) & 0xff;
        tr.shots[i] = s.shots;
        if (fresh > 0 && fresh < 30 && s.id !== this.myId && s.id >= 0) this.mountFired(v, i, Math.min(3, fresh));
      });
    }
  }

  /** A seat gun firing as drawn here: flash, sound and (for the MGs and cannon) a tracer to where it points. */
  mountFired(v: Vehicle, seat: number, n: number): void {
    const m = v.mounts[seat];
    if (!m) return;
    const view = this.view;
    v.syncModel(1);
    const muzzle = v.muzzleOf(seat, new THREE.Vector3());
    const node = v.model.mounts[seat];
    const dir = new THREE.Vector3();
    if (v.flight && v.spec.seats[seat]!.role === 'driver') dir.set(0, 0, -1).applyQuaternion(v.quat);
    else if (node) dir.subVectors(muzzle, node.gun.getWorldPosition(this.vp));
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1).applyQuaternion(v.quat);
    dir.normalize();
    const dist = muzzle.distanceTo(view.camera.position);
    view.effects.muzzleFlash(muzzle, dir);
    if (m.gun.shell) {
      if (m.id === 'rockets') view.audio.gadget('rocket', muzzle);
      else view.audio.explosion(muzzle, Math.max(30, dist));
      return;
    }
    for (let i = 0; i < n; i++) {
      const hit = view.physics.raycast(muzzle, dir, m.gun.range, Layer.WORLD, undefined, v.body);
      const to = hit ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) : muzzle.clone().addScaledVector(dir, m.gun.range);
      view.effects.spawnShots([{ from: muzzle.clone(), to }], muzzle);
    }
    view.audio.remoteGunshot(m.gun.blast > 0 ? 'sr' : 'lmg', muzzle, dist);
  }

  /** The server's word on where this browser's soldier was after input `ack`. */
  private correct(self: NonNullable<Snapshot['self']>, flags: number): void {
    const me = this.me;
    const p = me.player;
    if (!(flags & SF.deployed) || !(flags & SF.alive) || !me.deployed || !p.alive) return;
    // In a vehicle the vehicle carries the soldier (and the server's copy is a step behind).
    if (flags & SF.riding) {
      if (self.health > 0) p.health.value = self.health;
      this.predicted.clear();
      return;
    }
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
      if (th.kind <= THING.smoke) th.mesh.rotation.x += dt * 9;
      else if (th.kind <= THING.shell && b !== a) th.mesh.quaternion.setFromUnitVectors(UP, this.dir.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize());
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
    this.tracks.clear();
  }
}
