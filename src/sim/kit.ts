/**
 * A soldier's kit beyond the guns, as the game server steps it (and the
 * browser predicts it in a match there): taking the class gadget out (4) and
 * using it, build mode (T) and hammering at a build spot, zone supply
 * stations (E), and handing a mate a medkit or ammo (E).
 *
 * The world it acts on comes in `KitWorld`. A browser predicting its own
 * soldier passes no gadget world (the server fires and places things) and no
 * mates (the server hands things out); its fortifications are its copy of
 * the server's, kept in step by the server's tables.
 */
import * as THREE from 'three';
import { AMMO_GIVE_COOLDOWN, GIVE_RANGE, GRENADE_COUNT, MEDKIT } from '@/data/classes';
import { GADGETS, PANZERFAUST_TOSS, PLACE_REACH, type GadgetId } from '@/data/gadgets';
import type { InputState } from '@/input/InputState';
import { REFILL_POINTS, STATION, canRefill, type FortJob, type FortSlot, type Fortifications, type Station } from '@/modes/fortify';
import type { GadgetOwner, GadgetWorld } from '@/modes/gadgetWorld';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { Team } from '@/world/mapTypes';
import type { Soldier } from './Soldier';

export interface KitWorld {
  physics: PhysicsWorld;
  fort: Fortifications | null;
  /** Fires and places gadgets; null for a browser predicting (the server does it). */
  gadgets: GadgetWorld | null;
  zoneOwner(zone: string): Team | null;
  /** Someone stands where a structure would go (it can't finish then). */
  inTheWay(slot: FortSlot): boolean;
  owner(s: Soldier): GadgetOwner;
  /** Score (fractions are fine). */
  points(id: number, points: number): void;
  /** What the local view does about it (sounds); none on the server. */
  feedback?: KitFeedback;
}

export interface KitFeedback {
  gadgetUsed?(g: GadgetId, left: number): void;
  /** Took ammo or a medkit at a station. */
  stocked?(kind: Station['kind']): void;
  /** A station got a use back. */
  refilled?(): void;
  built?(slot: FortSlot): void;
}

/** What E would do here (the prompt), and the build spot aimed at in build mode. */
export interface FortView {
  target: FortSlot | null;
  station: Station | null;
  job: FortJob | null;
  /** Why not: 'fort.notOwned' / 'fort.emptyAmmo' / 'fort.emptyMedical'. */
  note: string | null;
}

/**
 * Gadget (4, touch button) and build mode (T) in and out of hand; reaching
 * for a weapon, a grenade or a swing puts either away. Then, with either out,
 * no aiming or reloading.
 */
export function kitToggles(s: Soldier, input: InputState, hasFort: boolean): void {
  // 4 (a match has three weapon slots) or the touch button: the class gadget.
  if (input.gadget || input.weaponSlot === 3) {
    input.weaponSlot = -1;
    if (s.gadgetOut) s.gadgetOut = false;
    else if (s.gadget && s.gadgetCount > 0) {
      s.gadgetOut = true;
      s.buildMode = false;
    }
  }
  if (input.buildMode && hasFort) {
    s.buildMode = !s.buildMode;
    if (s.buildMode) s.gadgetOut = false;
  }
  const reach = input.weaponSlot >= 0 || input.weaponCycle !== 0 || input.throwGrenade || input.melee;
  if (s.buildMode && reach) s.buildMode = false;
  if (s.gadgetOut && reach) s.gadgetOut = false;
}

/** The gadget in hand: a trigger pull fires the rocket / rifle grenade or puts the beacon / mine down. */
export function stepGadget(s: Soldier, input: InputState, dt: number, w: KitWorld): void {
  s.gadgetBusy = Math.max(0, s.gadgetBusy - dt);
  const g = s.gadget;
  if (!s.gadgetOut || !g) return;
  if (s.gadgetCount <= 0) {
    if (s.gadgetBusy <= 0) s.gadgetOut = false;
    return;
  }
  if (!input.firePressed || s.gadgetBusy > 0) return;
  const { eye, fwd, right, up } = s.weapons.aimBasis(s.player);
  if (g === 'panzerfaust' || g === 'riflesmoke') {
    const origin = eye.clone().addScaledVector(fwd, 0.8).addScaledVector(right, g === 'panzerfaust' ? 0.1 : 0.05).addScaledVector(up, -0.06);
    w.gadgets?.fire(g === 'panzerfaust' ? 'rocket' : 'riflesmoke', origin, fwd.clone(), w.owner(s));
  } else {
    const at = placeSpot(w.physics, s, eye, fwd);
    if (!at) return;
    if (g === 'beacon') w.gadgets?.placeBeacon(at, s.player.yaw, w.owner(s));
    else w.gadgets?.placeMine(at, s.player.yaw, w.owner(s));
  }
  s.gadgetCount--;
  // The panzerfaust reloads (next tube) unless that was the last; then only the spent tube goes.
  s.gadgetBusy = g === 'panzerfaust' && s.gadgetCount === 0 ? PANZERFAUST_TOSS : GADGETS[g].cycle;
  w.feedback?.gadgetUsed?.(g, s.gadgetCount);
}

/** Where a beacon or mine goes: the ground looked at within reach, else just ahead of the feet. */
export function placeSpot(physics: PhysicsWorld, s: Soldier, eye: THREE.Vector3, fwd: THREE.Vector3): THREE.Vector3 | null {
  const hit = physics.raycast(eye, fwd, PLACE_REACH, Layer.WORLD);
  if (hit && hit.normal.y > 0.7) return new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
  const flat = new THREE.Vector3(fwd.x, 0, fwd.z);
  if (flat.lengthSq() < 1e-4) return null;
  flat.normalize();
  const probe = s.player.feet.clone().addScaledVector(flat, 1).setY(s.player.feet.y + 1);
  const down = physics.raycast(probe, new THREE.Vector3(0, -1, 0), 2.2, Layer.WORLD);
  return down && down.normal.y > 0.7 ? new THREE.Vector3(down.point.x, down.point.y, down.point.z) : null;
}

/** A station's goods would help: ammo (rounds, grenades, the gadget) or a medkit. */
export function needsStation(s: Soldier, kind: Station['kind']): boolean {
  if (kind === 'ammo') return s.weapons.needsAmmo || s.grenades.count < GRENADE_COUNT[s.grenades.selected] || (!!s.gadget && s.gadgetCount < GADGETS[s.gadget].count);
  return s.cls !== 'medic' && s.medkits === 0;
}

/** Ammo station: guns, grenades and the gadget full again. */
export function restockAmmo(s: Soldier): void {
  s.weapons.refillReserve();
  s.grenades.reset(s.grenades.selected);
  if (s.gadget) s.gadgetCount = GADGETS[s.gadget].count;
}

/**
 * Build mode with the trigger held on a spot: hammering. Otherwise at a zone
 * station: tap E to take ammo / a medkit (zone owners only), hold it to put a
 * use back (supports at ammo, medics at medical). `s.working` counts the
 * hands-on time (hands busy).
 */
export function stepFort(s: Soldier, input: InputState, dt: number, w: KitWorld): FortView {
  const fort = w.fort;
  const prev = s.working;
  s.working = -1;
  const view: FortView = { target: null, station: null, job: null, note: null };
  if (!fort) return view;
  if (s.buildMode) {
    const { eye, fwd } = s.weapons.aimBasis(s.player);
    view.target = fort.aimAt(eye, fwd);
    if (view.target && input.fire) {
      hammer(s, { type: 'build', slot: view.target }, dt, prev, w);
      return view;
    }
  }
  const station = fort.stationAt(s.player.feet);
  if (!station) return view;
  view.station = station;
  const owned = w.zoneOwner(station.zone) === s.team;
  const need = needsStation(s, station.kind);
  if (!owned) view.note = 'fort.notOwned';
  else if (need && station.uses > 0) view.job = { type: 'use', station };
  else if (canRefill(station.kind, s.cls) && station.uses < STATION.uses) view.job = { type: 'refill', station };
  else if (need) view.note = station.kind === 'ammo' ? 'fort.emptyAmmo' : 'fort.emptyMedical';
  const job = view.job;
  if (!job) return view;
  if (job.type === 'use') {
    if (!input.interactPressed || !fort.use(job.station)) return view;
    if (job.station.kind === 'ammo') restockAmmo(s);
    else s.medkits = MEDKIT.carried;
    w.feedback?.stocked?.(job.station.kind);
    return view;
  }
  if (input.interact) hammer(s, job, dt, prev, w);
  return view;
}

/** One step of hands-on work: building a spot or restocking a station. */
function hammer(s: Soldier, job: FortJob, dt: number, prev: number, w: KitWorld): void {
  const fort = w.fort!;
  s.working = Math.max(0, prev) + dt;
  s.weapons.state.cancelReload();
  if (job.type === 'use') return;
  if (job.type === 'refill') {
    if (fort.refill(job.station, dt)) {
      w.points(s.id, REFILL_POINTS);
      w.feedback?.refilled?.();
    }
    return;
  }
  const r = fort.work(job.slot, dt, s.cls, (slot) => w.inTheWay(slot));
  w.points(s.id, r.points);
  if (r.done) w.feedback?.built?.(job.slot);
}

/** Next time a giver may hand the same mate the same thing again (sim seconds), by 'giver>mate:kind'. */
export type GiveClock = Map<string, number>;

/**
 * E by a mate who needs it: a medic hands over a medkit, a support tops up
 * ammo (each with a cooldown per mate). Returns who got what, or null.
 */
export function stepGive(s: Soldier, input: InputState, mates: Iterable<Soldier>, now: number, clock: GiveClock): { mate: Soldier; kind: 'medkit' | 'ammo' } | null {
  if (!input.interactPressed || (s.cls !== 'medic' && s.cls !== 'support')) return null;
  let best: Soldier | null = null;
  let bestD = GIVE_RANGE;
  const kind = s.cls === 'medic' ? 'medkit' : 'ammo';
  for (const m of mates) {
    if (m === s || m.team !== s.team || !m.deployed || !m.alive || m.downed) continue;
    if (kind === 'medkit' ? m.cls === 'medic' || m.medkits > 0 : !m.weapons.needsAmmo) continue;
    if ((clock.get(`${s.id}>${m.id}:${kind}`) ?? 0) > now) continue;
    const d = m.player.feet.distanceTo(s.player.feet);
    if (d < bestD) {
      best = m;
      bestD = d;
    }
  }
  if (!best) return null;
  if (kind === 'medkit') best.medkits = MEDKIT.carried;
  else best.weapons.refillReserve();
  clock.set(`${s.id}>${best.id}:${kind}`, now + (kind === 'medkit' ? MEDKIT.giveCooldown : AMMO_GIVE_COOLDOWN));
  return { mate: best, kind };
}
