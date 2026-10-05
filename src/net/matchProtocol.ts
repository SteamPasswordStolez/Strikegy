/**
 * Match data between the browser and the game server, on the same WebSocket
 * as the lobby: binary frames for what flows every step (the player's inputs
 * up, snapshots of every soldier down), JSON (`ServerMsg` / `ClientMsg` in
 * lobbyProtocol) for what happens now and then (kills, captures, spawns, the
 * zone and score tables).
 *
 * Inputs are quantized here, and the browser steps its own soldier with the
 * quantized values (`quantizeInput`), so the server replays exactly what the
 * browser predicted.
 */
import type { InputState } from '@/input/InputState';
import { VEHICLES, type VehicleKind } from '@/vehicles/vehicleData';
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';

export const FRAME = { input: 1, snapshot: 2 } as const;

/** Server steps per second (the browser's fixed step is the same). */
export const TICK_HZ = 60;
/** A snapshot every this many steps (30 Hz; was 20 until UDP made late ones rare, 2026-10-05). */
export const SNAPSHOT_EVERY = 2;
/** Remote soldiers are drawn this many ticks in the past (67 ms: two snapshots to blend between, one may be lost). */
export const INTERP_TICKS = 4;
/**
 * Shots are judged against where targets were up to this long ago (s): a
 * round trip of ~200 ms plus the 100 ms others are drawn behind. Longer only
 * helps someone faking how far behind they are (shooting where people were).
 */
export const REWIND_MAX = 0.3;

const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
const VEHICLE_KINDS = Object.keys(VEHICLES) as VehicleKind[];
export const weaponIndex = (id: WeaponId): number => Math.max(0, WEAPON_IDS.indexOf(id));
export const weaponAt = (i: number): WeaponId => WEAPON_IDS[i] ?? WEAPON_IDS[0]!;

// ---------------------------------------------------------------------------
// Inputs (browser -> server)

/** Buttons of an input, one bit each, in this order. */
const BUTTONS = [
  'fire',
  'firePressed',
  'ads',
  'sprint',
  'crouch',
  'crouchToggle',
  'jump',
  'reload',
  'throwGrenade',
  'medkit',
  'interact',
  'interactPressed',
  'jumpHeld',
  'melee',
  'inspect',
  'holdBreath',
  'buildMode',
  'gadget',
  'support',
] as const satisfies readonly (keyof InputState)[];

/** One sim step of a soldier's controls, as sent. */
export interface NetInput {
  /** Counts up from 1 per step. */
  seq: number;
  /** The server tick the player saw the others at when this step ran (lag compensation). */
  view: number;
  buttons: number;
  moveX: number;
  moveY: number;
  weaponCycle: number;
  weaponSlot: number;
  yaw: number;
  pitch: number;
  /** Scope sway added to the aim (rad). */
  swayYaw: number;
  swayPitch: number;
}

const INPUT_BYTES = 28;
const TAU = Math.PI * 2;
const YAW_Q = 65536 / TAU;
const PITCH_Q = 32767 / (Math.PI / 2);
const SWAY_Q = 1e5;

const wrapYaw = (y: number): number => ((y % TAU) + TAU) % TAU;
const qYaw = (y: number): number => Math.round(wrapYaw(y) * YAW_Q) & 0xffff;
const qPitch = (p: number): number => Math.max(-32767, Math.min(32767, Math.round(p * PITCH_Q)));
const qSway = (s: number): number => Math.max(-32767, Math.min(32767, Math.round(s * SWAY_Q)));
const qAxis = (a: number): number => Math.max(-127, Math.min(127, Math.round(a * 127)));

/**
 * Packs a step's controls (and rounds them the way the wire does: the caller
 * steps with what this returns, so both ends see the same numbers).
 */
export function packInput(s: InputState, seq: number, view: number, yaw: number, pitch: number, swayYaw: number, swayPitch: number): NetInput {
  let buttons = 0;
  BUTTONS.forEach((k, i) => {
    if (s[k]) buttons |= 1 << i;
  });
  return {
    seq,
    view: Math.fround(view),
    buttons,
    moveX: qAxis(s.moveX) / 127,
    moveY: qAxis(s.moveY) / 127,
    weaponCycle: Math.max(-1, Math.min(1, s.weaponCycle)),
    weaponSlot: Math.max(-1, Math.min(9, s.weaponSlot)),
    yaw: qYaw(yaw) / YAW_Q,
    pitch: qPitch(pitch) / PITCH_Q,
    swayYaw: qSway(swayYaw) / SWAY_Q,
    swayPitch: qSway(swayPitch) / SWAY_Q,
  };
}

/** Writes an input's buttons and axes into `s` (the look angles are the caller's). */
export function applyInput(n: NetInput, s: InputState): void {
  BUTTONS.forEach((k, i) => {
    (s as unknown as Record<string, boolean>)[k] = (n.buttons & (1 << i)) !== 0;
  });
  s.moveX = n.moveX;
  s.moveY = n.moveY;
  s.weaponCycle = n.weaponCycle;
  s.weaponSlot = n.weaponSlot;
}

export function encodeInputs(list: readonly NetInput[]): Uint8Array {
  const n = Math.min(255, list.length);
  const buf = new ArrayBuffer(2 + n * INPUT_BYTES);
  const v = new DataView(buf);
  v.setUint8(0, FRAME.input);
  v.setUint8(1, n);
  let o = 2;
  for (let i = 0; i < n; i++) {
    const x = list[i]!;
    v.setUint32(o, x.seq);
    v.setFloat32(o + 4, x.view);
    v.setUint32(o + 8, x.buttons);
    v.setInt8(o + 12, qAxis(x.moveX));
    v.setInt8(o + 13, qAxis(x.moveY));
    v.setInt8(o + 14, x.weaponCycle);
    v.setInt8(o + 15, x.weaponSlot);
    v.setUint16(o + 16, qYaw(x.yaw));
    v.setInt16(o + 18, qPitch(x.pitch));
    v.setInt16(o + 20, qSway(x.swayYaw));
    v.setInt16(o + 22, qSway(x.swayPitch));
    // 24..27 spare
    o += INPUT_BYTES;
  }
  return new Uint8Array(buf);
}

/**
 * Where the browser has the vehicle its player drives (it drives it there;
 * the server checks the move and puts its copy there): sent after the
 * frame's inputs.
 */
export interface NetDrive {
  vehicle: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vy: number;
  vz: number;
  /** Aircraft throttle 0..1. */
  throttle: number;
}

const DRIVE_BYTES = 29;
const VEL_Q = 50;
const qVel = (x: number): number => Math.max(-32767, Math.min(32767, Math.round(x * VEL_Q)));
const qUnit = (x: number): number => Math.max(-32767, Math.min(32767, Math.round(x * 32767)));

/** One bot a browser runs for the server, as it has it now. */
export interface NetBotState {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  aimYaw: number;
  aimPitch: number;
  crouch: boolean;
}

/** What a bot a browser runs did that the server must do: a trigger pull, a throw, a revive, a medkit. */
export type NetBotEvent =
  | { k: 'shot'; id: number; dir: [number, number, number] }
  | { k: 'throw'; id: number; type: 'frag' | 'flash' | 'smoke'; origin: [number, number, number]; vel: [number, number, number] }
  | { k: 'revive'; id: number; target: number }
  | { k: 'medkit'; id: number };

/** The bots a browser runs: where they are and what they did, at view tick `view` (what it drew others at). */
export interface NetBots {
  view: number;
  states: NetBotState[];
  events: NetBotEvent[];
}

/** After an input frame's inputs: tagged sections. */
const TAIL = { drive: 1, bots: 2 } as const;
const BOT_BYTES = 21;
const GRENADE_KINDS = ['frag', 'flash', 'smoke'] as const;
const EVENT_BYTES = { shot: 6, throw: 19, revive: 2, medkit: 0 } as const;

/** An input frame, with the driven vehicle's place and the bots this browser runs after the inputs. */
export function encodeInputFrame(list: readonly NetInput[], drive: NetDrive | null, bots: NetBots | null = null): Uint8Array {
  const base = encodeInputs(list);
  if (!drive && !bots) return base;
  const states = bots ? bots.states.slice(0, 255) : [];
  const events = bots ? bots.events.slice(0, 255) : [];
  let size = base.byteLength + (drive ? 1 + DRIVE_BYTES : 0);
  if (bots) {
    size += 1 + 4 + 1 + states.length * BOT_BYTES + 1;
    for (const e of events) size += 3 + EVENT_BYTES[e.k];
  }
  const buf = new Uint8Array(size);
  buf.set(base);
  const v = new DataView(buf.buffer);
  let o = base.byteLength;
  if (drive) {
    v.setUint8(o++, TAIL.drive);
    v.setUint16(o, drive.vehicle & 0xffff);
    v.setFloat32(o + 2, drive.x);
    v.setFloat32(o + 6, drive.y);
    v.setFloat32(o + 10, drive.z);
    v.setInt16(o + 14, qUnit(drive.qx));
    v.setInt16(o + 16, qUnit(drive.qy));
    v.setInt16(o + 18, qUnit(drive.qz));
    v.setInt16(o + 20, qUnit(drive.qw));
    v.setInt16(o + 22, qVel(drive.vx));
    v.setInt16(o + 24, qVel(drive.vy));
    v.setInt16(o + 26, qVel(drive.vz));
    v.setUint8(o + 28, Math.max(0, Math.min(255, Math.round(drive.throttle * 255))));
    o += DRIVE_BYTES;
  }
  if (bots) {
    v.setUint8(o++, TAIL.bots);
    v.setFloat32(o, bots.view);
    o += 4;
    v.setUint8(o++, states.length);
    for (const b of states) {
      v.setUint16(o, b.id & 0xffff);
      v.setFloat32(o + 2, b.x);
      v.setFloat32(o + 6, b.y);
      v.setFloat32(o + 10, b.z);
      v.setUint16(o + 14, qYaw(b.yaw));
      v.setUint16(o + 16, qYaw(b.aimYaw));
      v.setInt16(o + 18, qPitch(b.aimPitch));
      v.setUint8(o + 20, b.crouch ? 1 : 0);
      o += BOT_BYTES;
    }
    v.setUint8(o++, events.length);
    for (const e of events) {
      v.setUint8(o, e.k === 'shot' ? 1 : e.k === 'throw' ? 2 : e.k === 'revive' ? 3 : 4);
      v.setUint16(o + 1, e.id & 0xffff);
      o += 3;
      if (e.k === 'shot') {
        for (const c of e.dir) {
          v.setInt16(o, qUnit(c));
          o += 2;
        }
      } else if (e.k === 'throw') {
        v.setUint8(o++, GRENADE_KINDS.indexOf(e.type));
        for (const c of e.origin) {
          v.setFloat32(o, c);
          o += 4;
        }
        for (const c of e.vel) {
          v.setInt16(o, qVel(c));
          o += 2;
        }
      } else if (e.k === 'revive') {
        v.setUint16(o, e.target & 0xffff);
        o += 2;
      }
    }
  }
  return buf;
}

/** What follows an input frame's inputs (the driven vehicle, the bots this browser runs); null when malformed. */
export function decodeTail(data: Uint8Array): { drive: NetDrive | null; bots: NetBots | null } | null {
  if (data.byteLength < 2) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 2 + v.getUint8(1) * INPUT_BYTES;
  const end = data.byteLength;
  if (o > end) return null;
  let drive: NetDrive | null = null;
  let bots: NetBots | null = null;
  while (o < end) {
    const tag = v.getUint8(o++);
    if (tag === TAIL.drive && !drive) {
      if (o + DRIVE_BYTES > end) return null;
      const x = v.getFloat32(o + 2);
      const y = v.getFloat32(o + 6);
      const z = v.getFloat32(o + 10);
      let qx = v.getInt16(o + 14) / 32767;
      let qy = v.getInt16(o + 16) / 32767;
      let qz = v.getInt16(o + 18) / 32767;
      let qw = v.getInt16(o + 20) / 32767;
      const len = Math.hypot(qx, qy, qz, qw);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || len < 0.5) return null;
      qx /= len;
      qy /= len;
      qz /= len;
      qw /= len;
      drive = { vehicle: v.getUint16(o), x, y, z, qx, qy, qz, qw, vx: v.getInt16(o + 22) / VEL_Q, vy: v.getInt16(o + 24) / VEL_Q, vz: v.getInt16(o + 26) / VEL_Q, throttle: v.getUint8(o + 28) / 255 };
      o += DRIVE_BYTES;
    } else if (tag === TAIL.bots && !bots) {
      if (o + 5 > end) return null;
      const view = v.getFloat32(o);
      const n = v.getUint8(o + 4);
      o += 5;
      if (o + n * BOT_BYTES + 1 > end || !Number.isFinite(view)) return null;
      bots = { view, states: [], events: [] };
      for (let i = 0; i < n; i++) {
        const x = v.getFloat32(o + 2);
        const y = v.getFloat32(o + 6);
        const z = v.getFloat32(o + 10);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
        bots.states.push({ id: v.getUint16(o), x, y, z, yaw: v.getUint16(o + 14) / YAW_Q, aimYaw: v.getUint16(o + 16) / YAW_Q, aimPitch: v.getInt16(o + 18) / PITCH_Q, crouch: (v.getUint8(o + 20) & 1) !== 0 });
        o += BOT_BYTES;
      }
      const m = v.getUint8(o++);
      for (let i = 0; i < m; i++) {
        if (o + 3 > end) return null;
        const kind = v.getUint8(o);
        const id = v.getUint16(o + 1);
        o += 3;
        if (kind === 1) {
          if (o + 6 > end) return null;
          bots.events.push({ k: 'shot', id, dir: [v.getInt16(o) / 32767, v.getInt16(o + 2) / 32767, v.getInt16(o + 4) / 32767] });
          o += 6;
        } else if (kind === 2) {
          if (o + 19 > end) return null;
          const type = GRENADE_KINDS[v.getUint8(o)];
          const origin: [number, number, number] = [v.getFloat32(o + 1), v.getFloat32(o + 5), v.getFloat32(o + 9)];
          if (!type || !origin.every(Number.isFinite)) return null;
          bots.events.push({ k: 'throw', id, type, origin, vel: [v.getInt16(o + 13) / VEL_Q, v.getInt16(o + 15) / VEL_Q, v.getInt16(o + 17) / VEL_Q] });
          o += 19;
        } else if (kind === 3) {
          if (o + 2 > end) return null;
          bots.events.push({ k: 'revive', id, target: v.getUint16(o) });
          o += 2;
        } else if (kind === 4) bots.events.push({ k: 'medkit', id });
        else return null;
      }
    } else return null;
  }
  return { drive, bots };
}

/** Inputs from a frame; null when the frame is malformed. */
export function decodeInputs(data: Uint8Array): NetInput[] | null {
  if (data.byteLength < 2) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (v.getUint8(0) !== FRAME.input) return null;
  const n = v.getUint8(1);
  if (data.byteLength < 2 + n * INPUT_BYTES || (data.byteLength > 2 + n * INPUT_BYTES && !decodeTail(data))) return null;
  const out: NetInput[] = [];
  let o = 2;
  for (let i = 0; i < n; i++) {
    const view = v.getFloat32(o + 4);
    out.push({
      seq: v.getUint32(o),
      view: Number.isFinite(view) ? view : 0,
      buttons: v.getUint32(o + 8),
      moveX: Math.max(-1, v.getInt8(o + 12) / 127),
      moveY: Math.max(-1, v.getInt8(o + 13) / 127),
      weaponCycle: Math.max(-1, Math.min(1, v.getInt8(o + 14))),
      weaponSlot: Math.max(-1, Math.min(9, v.getInt8(o + 15))),
      yaw: v.getUint16(o + 16) / YAW_Q,
      pitch: v.getInt16(o + 18) / PITCH_Q,
      swayYaw: v.getInt16(o + 20) / SWAY_Q,
      swayPitch: v.getInt16(o + 22) / SWAY_Q,
    });
    o += INPUT_BYTES;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Snapshots (server -> browser)

/** Soldier state bits in a snapshot. */
export const SF = {
  deployed: 1,
  alive: 2,
  downed: 4,
  crouch: 8,
  ads: 16,
  sprint: 32,
  grounded: 64,
  reloading: 128,
  /** Out of medkits (a medic could hand one over) / short of ammo (a support could). */
  needMedkit: 256,
  needAmmo: 512,
  /** In a vehicle (drawn there, if at all). */
  riding: 1024,
  /** Under a parachute. */
  chute: 2048,
} as const;

/** One soldier as everyone sees it. */
export interface NetSoldier {
  id: number;
  flags: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  weapon: WeaponId;
  health: number;
  /** Rounds fired, counting up (wraps at 256): new ones are muzzle flashes and shots heard. */
  shots: number;
}

/** The receiving player's own soldier, exactly (prediction is checked against it). */
export interface NetSelf {
  /** Last input seq the server has stepped (0: none yet). */
  ack: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  health: number;
  /** Rounds in the magazine of the weapon in hand, and in reserve (-1: endless). */
  ammo: number;
  reserve: number;
}

/** Kinds of moving things other than soldiers in a snapshot. */
export const THING = { frag: 1, flash: 2, smoke: 3, rocket: 4, riflesmoke: 5, shell: 6, beacon: 7, mine: 8, reconBlue: 9, reconRed: 10, crate: 11 } as const;

/** A moving thing (a grenade in the air; rockets and the like later). */
export interface NetThing {
  id: number;
  kind: number;
  x: number;
  y: number;
  z: number;
}

/** Vehicle state bits in a snapshot. */
export const VF = { wrecked: 1, homeBlue: 2, homeRed: 4 } as const;

/** One vehicle as everyone sees it. */
export interface NetVehicle {
  id: number;
  kind: VehicleKind;
  flags: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** Health as a fraction of full, 0..1. */
  health: number;
  /** Only this soldier may drive it (a called-in rocket tank), or -1. */
  driverOnly: number;
  /** Per seat: who sits there (-1: nobody), the gun's yaw / pitch on the hull and its rounds fired (wraps at 256). */
  seats: { id: number; yaw: number; pitch: number; shots: number }[];
}

export interface Snapshot {
  tick: number;
  self: NetSelf | null;
  soldiers: NetSoldier[];
  things: NetThing[];
  vehicles: NetVehicle[];
}

const VEHICLE_BYTES = 21;
const SEAT_BYTES = 5;
const qAngle = (a: number): number => Math.max(-127, Math.min(127, Math.round((Math.atan2(Math.sin(a), Math.cos(a)) / Math.PI) * 127)));

/** The vehicles of a tick (shared by every receiver). */
export function encodeVehicles(list: readonly NetVehicle[]): Uint8Array {
  const n = Math.min(255, list.length);
  let size = 1;
  for (let i = 0; i < n; i++) size += VEHICLE_BYTES + VEHICLES[list[i]!.kind].seats.length * SEAT_BYTES;
  const buf = new Uint8Array(size);
  const v = new DataView(buf.buffer);
  v.setUint8(0, n);
  let o = 1;
  for (let i = 0; i < n; i++) {
    const x = list[i]!;
    v.setUint16(o, x.id & 0xffff);
    v.setUint8(o + 2, Math.max(0, VEHICLE_KINDS.indexOf(x.kind)));
    v.setUint8(o + 3, x.flags);
    v.setUint16(o + 4, qX(x.x));
    v.setUint16(o + 6, qY(x.y));
    v.setUint16(o + 8, qX(x.z));
    v.setInt16(o + 10, qUnit(x.qx));
    v.setInt16(o + 12, qUnit(x.qy));
    v.setInt16(o + 14, qUnit(x.qz));
    v.setInt16(o + 16, qUnit(x.qw));
    v.setUint8(o + 18, Math.max(0, Math.min(255, Math.round(x.health * 255))));
    v.setUint16(o + 19, x.driverOnly < 0 ? 0xffff : x.driverOnly & 0xffff);
    o += VEHICLE_BYTES;
    const seats = VEHICLES[x.kind].seats.length;
    for (let s = 0; s < seats; s++) {
      const st = x.seats[s];
      v.setUint16(o, !st || st.id < 0 ? 0xffff : st.id & 0xffff);
      v.setInt8(o + 2, qAngle(st?.yaw ?? 0));
      v.setInt8(o + 3, Math.max(-127, Math.min(127, Math.round(((st?.pitch ?? 0) / (Math.PI / 2)) * 127))));
      v.setUint8(o + 4, (st?.shots ?? 0) & 0xff);
      o += SEAT_BYTES;
    }
  }
  return buf;
}

function decodeVehicles(v: DataView, o: number): { list: NetVehicle[]; end: number } | null {
  if (v.byteLength < o + 1) return null;
  const n = v.getUint8(o);
  o += 1;
  const list: NetVehicle[] = [];
  for (let i = 0; i < n; i++) {
    if (v.byteLength < o + VEHICLE_BYTES) return null;
    const kind = VEHICLE_KINDS[v.getUint8(o + 2)];
    if (!kind) return null;
    const seats = VEHICLES[kind].seats.length;
    if (v.byteLength < o + VEHICLE_BYTES + seats * SEAT_BYTES) return null;
    const only = v.getUint16(o + 19);
    const x: NetVehicle = {
      id: v.getUint16(o),
      kind,
      flags: v.getUint8(o + 3),
      x: v.getUint16(o + 4) / XZ_Q - 1024,
      y: v.getUint16(o + 6) / Y_Q - 256,
      z: v.getUint16(o + 8) / XZ_Q - 1024,
      qx: v.getInt16(o + 10) / 32767,
      qy: v.getInt16(o + 12) / 32767,
      qz: v.getInt16(o + 14) / 32767,
      qw: v.getInt16(o + 16) / 32767,
      health: v.getUint8(o + 18) / 255,
      driverOnly: only === 0xffff ? -1 : only,
      seats: [],
    };
    o += VEHICLE_BYTES;
    for (let s = 0; s < seats; s++) {
      const id = v.getUint16(o);
      x.seats.push({ id: id === 0xffff ? -1 : id, yaw: (v.getInt8(o + 2) / 127) * Math.PI, pitch: (v.getInt8(o + 3) / 127) * (Math.PI / 2), shots: v.getUint8(o + 4) });
      o += SEAT_BYTES;
    }
    list.push(x);
  }
  return { list, end: o };
}

const THING_BYTES = 9;

/** The moving things of a tick (shared by every receiver, like the soldiers). */
export function encodeThings(list: readonly NetThing[]): Uint8Array {
  const n = Math.min(65535, list.length);
  const buf = new Uint8Array(2 + n * THING_BYTES);
  const v = new DataView(buf.buffer);
  v.setUint16(0, n);
  let o = 2;
  for (let i = 0; i < n; i++) {
    const t = list[i]!;
    v.setUint16(o, t.id);
    v.setUint8(o + 2, t.kind);
    v.setUint16(o + 3, qX(t.x));
    v.setUint16(o + 5, qY(t.y));
    v.setUint16(o + 7, qX(t.z));
    o += THING_BYTES;
  }
  return buf;
}

const SOLDIER_BYTES = 16;
const SELF_BYTES = 32;
/** Positions as u16 over ±1024 m (x, z) and -256..768 m (y). */
const XZ_Q = 65535 / 2048;
const Y_Q = 65535 / 1024;
const qX = (x: number): number => Math.max(0, Math.min(65535, Math.round((x + 1024) * XZ_Q)));
const qY = (y: number): number => Math.max(0, Math.min(65535, Math.round((y + 256) * Y_Q)));

/**
 * The part of a snapshot every receiver shares (encoded once a tick, then
 * each receiver's own header goes in front: `snapshotFor`).
 */
export function encodeSoldiers(list: readonly NetSoldier[]): Uint8Array {
  const n = Math.min(65535, list.length);
  const buf = new Uint8Array(2 + n * SOLDIER_BYTES);
  const v = new DataView(buf.buffer);
  v.setUint16(0, n);
  let o = 2;
  for (let i = 0; i < n; i++) {
    const s = list[i]!;
    v.setUint16(o, s.id);
    v.setUint16(o + 2, s.flags);
    v.setUint16(o + 4, qX(s.x));
    v.setUint16(o + 6, qY(s.y));
    v.setUint16(o + 8, qX(s.z));
    v.setUint16(o + 10, qYaw(s.yaw));
    v.setInt8(o + 12, Math.max(-127, Math.min(127, Math.round((s.pitch / (Math.PI / 2)) * 127))));
    v.setUint8(o + 13, weaponIndex(s.weapon));
    v.setUint8(o + 14, Math.max(0, Math.min(255, Math.round(s.health))));
    v.setUint8(o + 15, s.shots & 0xff);
    o += SOLDIER_BYTES;
  }
  return buf;
}

/** A whole snapshot frame for one receiver. */
export function snapshotFor(tick: number, self: NetSelf | null, soldiers: Uint8Array, things: Uint8Array = EMPTY_THINGS, vehicles: Uint8Array = EMPTY_VEHICLES): Uint8Array {
  const head = 6 + (self ? SELF_BYTES : 0);
  const buf = new Uint8Array(head + soldiers.byteLength + things.byteLength + vehicles.byteLength);
  const v = new DataView(buf.buffer);
  v.setUint8(0, FRAME.snapshot);
  v.setUint32(1, tick);
  v.setUint8(5, self ? 1 : 0);
  if (self) {
    v.setUint32(6, self.ack);
    v.setFloat32(10, self.x);
    v.setFloat32(14, self.y);
    v.setFloat32(18, self.z);
    v.setFloat32(22, self.vx);
    v.setFloat32(26, self.vy);
    v.setFloat32(30, self.vz);
    v.setUint8(34, Math.max(0, Math.min(255, Math.round(self.health))));
    v.setUint8(35, Math.max(0, Math.min(255, self.ammo)));
    v.setUint16(36, self.reserve < 0 ? 0xffff : Math.min(0xfffe, self.reserve));
  }
  buf.set(soldiers, head);
  buf.set(things, head + soldiers.byteLength);
  buf.set(vehicles, head + soldiers.byteLength + things.byteLength);
  return buf;
}

const EMPTY_THINGS = new Uint8Array(2);
const EMPTY_VEHICLES = new Uint8Array(1);

export function decodeSnapshot(data: Uint8Array): Snapshot | null {
  if (data.byteLength < 8) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (v.getUint8(0) !== FRAME.snapshot) return null;
  const tick = v.getUint32(1);
  let o = 6;
  let self: NetSelf | null = null;
  if (v.getUint8(5)) {
    if (data.byteLength < o + SELF_BYTES + 2) return null;
    const reserve = v.getUint16(36);
    self = {
      ack: v.getUint32(6),
      x: v.getFloat32(10),
      y: v.getFloat32(14),
      z: v.getFloat32(18),
      vx: v.getFloat32(22),
      vy: v.getFloat32(26),
      vz: v.getFloat32(30),
      health: v.getUint8(34),
      ammo: v.getUint8(35),
      reserve: reserve === 0xffff ? -1 : reserve,
    };
    o += SELF_BYTES;
  }
  const n = v.getUint16(o);
  o += 2;
  if (data.byteLength < o + n * SOLDIER_BYTES + 2) return null;
  const soldiers: NetSoldier[] = [];
  for (let i = 0; i < n; i++) {
    soldiers.push({
      id: v.getUint16(o),
      flags: v.getUint16(o + 2),
      x: v.getUint16(o + 4) / XZ_Q - 1024,
      y: v.getUint16(o + 6) / Y_Q - 256,
      z: v.getUint16(o + 8) / XZ_Q - 1024,
      yaw: v.getUint16(o + 10) / YAW_Q,
      pitch: (v.getInt8(o + 12) / 127) * (Math.PI / 2),
      weapon: weaponAt(v.getUint8(o + 13)),
      health: v.getUint8(o + 14),
      shots: v.getUint8(o + 15),
    });
    o += SOLDIER_BYTES;
  }
  const m = v.getUint16(o);
  o += 2;
  if (data.byteLength < o + m * THING_BYTES) return null;
  const things: NetThing[] = [];
  for (let i = 0; i < m; i++) {
    things.push({ id: v.getUint16(o), kind: v.getUint8(o + 2), x: v.getUint16(o + 3) / XZ_Q - 1024, y: v.getUint16(o + 5) / Y_Q - 256, z: v.getUint16(o + 7) / XZ_Q - 1024 });
    o += THING_BYTES;
  }
  const veh = decodeVehicles(v, o);
  if (!veh || veh.end !== data.byteLength) return null;
  return { tick, self, soldiers, things, vehicles: veh.list };
}

/** The frame kind of a binary message (0: unknown). */
export function frameKind(data: Uint8Array): number {
  return data.byteLength ? data[0]! : 0;
}
