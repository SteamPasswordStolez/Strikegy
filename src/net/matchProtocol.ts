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
import { WEAPONS, type WeaponId } from '@/weapons/weaponData';

export const FRAME = { input: 1, snapshot: 2 } as const;

/** Server steps per second (the browser's fixed step is the same). */
export const TICK_HZ = 60;
/** A snapshot every this many steps (20 Hz). */
export const SNAPSHOT_EVERY = 3;
/** Remote soldiers are drawn this many ticks in the past (100 ms: two snapshots to blend between). */
export const INTERP_TICKS = 6;
/** Shots are judged against where targets were up to this long ago (s). */
export const REWIND_MAX = 0.3;

const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
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

/** Inputs from a frame; null when the frame is malformed. */
export function decodeInputs(data: Uint8Array): NetInput[] | null {
  if (data.byteLength < 2) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (v.getUint8(0) !== FRAME.input) return null;
  const n = v.getUint8(1);
  if (data.byteLength !== 2 + n * INPUT_BYTES) return null;
  const out: NetInput[] = [];
  let o = 2;
  for (let i = 0; i < n; i++) {
    const view = v.getFloat32(o + 4);
    out.push({
      seq: v.getUint32(o),
      view: Number.isFinite(view) ? view : 0,
      buttons: v.getUint32(o + 8),
      moveX: v.getInt8(o + 12) / 127,
      moveY: v.getInt8(o + 13) / 127,
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
export const THING = { frag: 1, flash: 2, smoke: 3, rocket: 4, riflesmoke: 5, shell: 6, beacon: 7, mine: 8 } as const;

/** A moving thing (a grenade in the air; rockets and the like later). */
export interface NetThing {
  id: number;
  kind: number;
  x: number;
  y: number;
  z: number;
}

export interface Snapshot {
  tick: number;
  self: NetSelf | null;
  soldiers: NetSoldier[];
  things: NetThing[];
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
export function snapshotFor(tick: number, self: NetSelf | null, soldiers: Uint8Array, things: Uint8Array = EMPTY_THINGS): Uint8Array {
  const head = 6 + (self ? SELF_BYTES : 0);
  const buf = new Uint8Array(head + soldiers.byteLength + things.byteLength);
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
  return buf;
}

const EMPTY_THINGS = new Uint8Array(2);

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
  if (data.byteLength !== o + m * THING_BYTES) return null;
  const things: NetThing[] = [];
  for (let i = 0; i < m; i++) {
    things.push({ id: v.getUint16(o), kind: v.getUint8(o + 2), x: v.getUint16(o + 3) / XZ_Q - 1024, y: v.getUint16(o + 5) / Y_Q - 256, z: v.getUint16(o + 7) / XZ_Q - 1024 });
    o += THING_BYTES;
  }
  return { tick, self, soldiers, things };
}

/** The frame kind of a binary message (0: unknown). */
export function frameKind(data: Uint8Array): number {
  return data.byteLength ? data[0]! : 0;
}
