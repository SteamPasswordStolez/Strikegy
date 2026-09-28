import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { createInputState } from '@/input/InputState';
import { HitboxRegistry, type Damageable } from '@/combat/Hitboxes';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import type { SurfaceRegistry } from '@/physics/surfaces';
import type { Player } from '@/player/Player';
import { INSPECT_TIME, MELEE_DAMAGE, MELEE_HIT, MELEE_TIME, WeaponController } from '@/weapons/WeaponController';
import { RELOAD_HAND, RELOAD_MAG_HELD, SHELL_HAND, sampleTrack, type HandAnchor } from '@/weapons/viewAnims';

describe('view motion tracks', () => {
  const anchors: Record<HandAnchor, THREE.Vector3> = {
    mag: new THREE.Vector3(0.01, -0.08, 0.05),
    chamber: new THREE.Vector3(-0.01, 0.1, 0.2),
    port: new THREE.Vector3(0, -0.02, 0.1),
  };
  const at = (a: HandAnchor) => anchors[a];
  const v = new THREE.Vector3();

  it('eases between keys and clamps outside them', () => {
    const keys = [
      { t: 0, v: [0, 0, 0] as const },
      { t: 1, v: [1, 2, 0] as const },
    ];
    expect(sampleTrack(keys, -1, v).toArray()).toEqual([0, 0, 0]);
    expect(sampleTrack(keys, 0.5, v).x).toBeCloseTo(0.5);
    expect(sampleTrack(keys, 0.25, v).x).toBeLessThan(0.25); // eased, not linear
    expect(sampleTrack(keys, 2, v).toArray()).toEqual([1, 2, 0]);
  });

  it('the reload hand leaves the handguard, holds the magazine at the cue points and comes back', () => {
    expect(sampleTrack(RELOAD_HAND, 0, v, at).length()).toBe(0);
    expect(sampleTrack(RELOAD_HAND, 1, v, at).length()).toBe(0);
    // On the magazine when it is released and when it is seated.
    for (const p of RELOAD_MAG_HELD) expect(sampleTrack(RELOAD_HAND, p, v, at).distanceTo(anchors.mag)).toBeLessThan(1e-6);
    // Away with the old magazine in between.
    expect(sampleTrack(RELOAD_HAND, 0.4, v, at).y).toBeLessThan(anchors.mag.y - 0.2);
    // Works the charging handle near the chamber cue.
    expect(sampleTrack(RELOAD_HAND, 0.86, v, at).distanceTo(anchors.chamber)).toBeLessThan(0.08);
  });

  it('a shell is pushed into the port once per insert and the loop joins up', () => {
    const start = sampleTrack(SHELL_HAND, 0, new THREE.Vector3(), at);
    const end = sampleTrack(SHELL_HAND, 1, new THREE.Vector3(), at);
    expect(start.distanceTo(end)).toBeLessThan(1e-9);
    expect(sampleTrack(SHELL_HAND, 0.8, v, at).distanceTo(anchors.port)).toBeLessThan(1e-6);
  });
});

/** A weapon controller with fake physics: every ray hits `hitHandle` at 1.2 m (or nothing). */
function setup(hitHandle: number | null) {
  const bus = new EventBus<GameEvents>();
  const registry = new HitboxRegistry();
  const physics = {
    raycast: (_o: THREE.Vector3, _d: THREE.Vector3, max: number) =>
      hitHandle !== null && max >= 1.2 ? { point: { x: 0, y: 1.6, z: -1.2 }, normal: { x: 0, y: 0, z: 1 }, distance: 1.2, collider: { handle: hitHandle } } : null,
  } as unknown as PhysicsWorld;
  const surfaces = { get: () => 'concrete' } as unknown as SurfaceRegistry;
  const player = {
    feet: new THREE.Vector3(),
    eyeHeight: 1.6,
    yaw: 0,
    pitch: 0,
    sprinting: false,
    grounded: true,
    crouching: false,
    horizontalSpeed: () => 0,
  } as unknown as Player;
  const w = new WeaponController(['ar1', 'pistol1'], physics, registry, surfaces, bus);
  w.drawTimer = 0;
  const events: string[] = [];
  bus.on('weapon:melee', (e) => events.push(`melee:${e.hit}`));
  bus.on('combat:hit', (e) => events.push(`hit:${e.damage}`));
  bus.on('combat:kill', () => events.push('kill'));
  return { w, registry, player, events };
}

function run(w: WeaponController, player: Player, seconds: number, set: (i: ReturnType<typeof createInputState>) => void = () => {}) {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    const input = createInputState();
    set(input);
    w.step(dt, input, player, false);
  }
}

describe('melee', () => {
  it('lands once at the strike point, hurts an enemy and blocks firing meanwhile', () => {
    const { w, registry, player, events } = setup(7);
    let hp = 100;
    const enemy: Damageable = {
      id: 5,
      name: 'Bot',
      team: 'red',
      get alive() {
        return hp > 0;
      },
      applyDamage(n) {
        hp -= n;
        return hp <= 0;
      },
    };
    registry.register(7, enemy, 'body');
    run(w, player, 1 / 60, (i) => (i.melee = true));
    expect(w.meleeTime).toBeGreaterThanOrEqual(0);
    const ammo = w.state.ammo;
    run(w, player, MELEE_HIT + 0.05, (i) => (i.fire = true));
    expect(w.state.ammo).toBe(ammo);
    expect(events).toEqual([`hit:${MELEE_DAMAGE.body}`, 'melee:body']);
    run(w, player, MELEE_TIME);
    expect(w.meleeTime).toBe(-1);
    // Two blows kill.
    run(w, player, 1 / 60, (i) => (i.melee = true));
    run(w, player, MELEE_TIME);
    expect(events).toContain('kill');
  });

  it('strikes walls, whiffs in the open, and cancels a reload', () => {
    const wall = setup(99);
    run(wall.w, wall.player, 1 / 60, (i) => (i.melee = true));
    run(wall.w, wall.player, MELEE_TIME);
    expect(wall.events).toEqual(['melee:world']);

    const air = setup(null);
    air.w.state.ammo = 10;
    run(air.w, air.player, 1 / 60, (i) => (i.reload = true));
    expect(air.w.state.reloading).toBe(true);
    run(air.w, air.player, 1 / 60, (i) => (i.melee = true));
    expect(air.w.state.reloading).toBe(false);
    run(air.w, air.player, MELEE_TIME);
    expect(air.events).toEqual(['melee:none']);
  });
});

describe('inspect', () => {
  it('plays through when idle and stops on firing, aiming or switching', () => {
    const { w, player } = setup(null);
    run(w, player, 1 / 60, (i) => (i.inspect = true));
    expect(w.inspectProgress).toBe(0);
    run(w, player, INSPECT_TIME / 2);
    expect(w.inspectProgress).toBeGreaterThan(0.4);
    run(w, player, INSPECT_TIME);
    expect(w.inspectProgress).toBe(-1);

    for (const stop of [(i: ReturnType<typeof createInputState>) => (i.ads = true), (i: ReturnType<typeof createInputState>) => (i.weaponSlot = 1)]) {
      run(w, player, 1 / 60, (i) => (i.inspect = true));
      run(w, player, 0.5);
      expect(w.inspectProgress).toBeGreaterThan(0);
      run(w, player, 1 / 60, stop);
      expect(w.inspectProgress).toBe(-1);
      w.drawTimer = 0;
    }
  });
});
