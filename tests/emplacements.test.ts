import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HitboxRegistry } from '@/combat/Hitboxes';
import { PhysicsWorld } from '@/physics/PhysicsWorld';
import { SurfaceRegistry } from '@/physics/surfaces';
import { Fortifications, isPost, planFortifications, type PlanProbe } from '@/modes/fortify';
import { FortModels } from '@/world/fortModels';
import { VehicleWorld } from '@/vehicles/VehicleWorld';
import type { DriveInput } from '@/vehicles/Vehicle';
import { POST_RESPAWN, PostKeeper } from '@/vehicles/posts';
import { VEHICLES } from '@/vehicles/vehicleData';
import { postsFor } from '@/sim/world';
import { layGun } from '@/vehicles/ship';

const DT = 1 / 60;
const flat: PlanProbe = {
  ground: (x, z) => (Math.abs(x) < 220 && Math.abs(z) < 220 ? { y: 0, level: true } : null),
  clear: () => true,
};
// Blue base west, red base east; a small zone near each base and a big one in the middle.
const bases = [
  [-160, 0],
  [160, 0],
] as [number, number][];
const zones = [
  { id: 'A', pos: [-70, 0, 0] as [number, number, number], radius: 16 },
  { id: 'B', pos: [0, 0, 0] as [number, number, number], radius: 26 },
  { id: 'C', pos: [70, 0, 0] as [number, number, number], radius: 16 },
];
const ALL = { hmg: true, guns: true, aa: true };
/** Which way a spot's front (-z, turned by its yaw) faces: +1 east, -1 west. */
const facingX = (yaw: number) => -Math.sin(yaw);

describe('fixed weapons: planning', () => {
  it('puts a machine-gun nest at every zone (one a side at big ones), field guns behind the zones nearest the bases, field and AA guns at the bases', () => {
    const plan = planFortifications(zones, [], [], flat, { bases, posts: ALL });
    const posts = (zone: string, kind: string) =>
      plan.slots.filter((s) => s.zone === zone && s.kind === kind);
    // Small zones: one nest, facing the far base (A faces east to red, C west to blue).
    expect(posts('A', 'hmgPost')).toHaveLength(1);
    expect(facingX(posts('A', 'hmgPost')[0]!.yaw)).toBeGreaterThan(0.8);
    expect(facingX(posts('C', 'hmgPost')[0]!.yaw)).toBeLessThan(-0.8);
    // The big middle zone: one facing each way.
    expect(
      posts('B', 'hmgPost')
        .map((s) => Math.sign(facingX(s.yaw)))
        .sort(),
    ).toEqual([-1, 1]);
    // A sandbag nest is planned on each machine gun (built in build mode).
    for (const s of plan.slots.filter((x) => x.kind === 'hmgPost'))
      expect(
        plan.slots.some((n) => n.kind === 'nest' && n.pos[0] === s.pos[0] && n.pos[2] === s.pos[2]),
      ).toBe(true);
    // Field guns behind the rear zones, facing the enemy, low sandbags in front.
    const gA = posts('A', 'gunPost');
    expect(gA).toHaveLength(1);
    expect(gA[0]!.pos[0]).toBeLessThan(-70);
    expect(facingX(gA[0]!.yaw)).toBeGreaterThan(0.8);
    expect(posts('C', 'gunPost')[0]!.pos[0]).toBeGreaterThan(70);
    expect(posts('B', 'gunPost')).toHaveLength(0);
    expect(posts('A', 'sandbagLow').some((s) => s.pos[0] > gA[0]!.pos[0] + 1.5)).toBe(true);
    // Each base: a field gun and an AA gun out toward the battle.
    for (const [team, [bx]] of [
      ['blue', bases[0]!],
      ['red', bases[1]!],
    ] as const) {
      for (const kind of ['gunPost', 'aaPost']) {
        const p = posts(`base:${team}`, kind);
        expect(p).toHaveLength(1);
        expect(Math.abs(p[0]!.pos[0] - bx)).toBeGreaterThanOrEqual(12);
        expect(Math.sign(facingX(p[0]!.yaw))).toBe(team === 'blue' ? 1 : -1);
      }
    }
    // The same on every run (the server's and the browsers' spot ids agree).
    expect(planFortifications(zones, [], [], flat, { bases, posts: ALL })).toEqual(plan);
  });

  it('plans them only where the match has vehicles, field guns only with armour, AA only with aircraft', () => {
    const count = (posts: Parameters<typeof planFortifications>[4]) =>
      planFortifications(zones, [], [], flat, posts)
        .slots.filter((s) => isPost(s.kind))
        .map((s) => s.kind);
    expect(count({ bases })).toEqual([]);
    expect(new Set(count({ bases, posts: { hmg: true, guns: false, aa: false } }))).toEqual(
      new Set(['hmgPost']),
    );
    const map = (vehicles?: 'light' | 'noJets' | 'fixed') =>
      ({ zones: [{}], world: { vehicles } }) as unknown as Parameters<typeof postsFor>[0];
    expect(postsFor(map(), true)).toEqual(ALL);
    expect(postsFor(map('noJets'), true)).toEqual({ hmg: true, guns: true, aa: false });
    expect(postsFor(map('light'), true)).toEqual({ hmg: true, guns: false, aa: false });
    expect(postsFor(map('fixed'), true)).toBeUndefined();
    expect(postsFor(map(), false)).toBeUndefined();
  });
});

async function field() {
  const physics = await PhysicsWorld.create();
  physics.timestep = DT;
  physics.addStaticBox({ x: 0, y: -1, z: 0 }, { x: 400, y: 1, z: 400 });
  const hooks = {
    destroyed: () => {},
    roadkill: () => {},
    removed: (v: import('@/vehicles/Vehicle').Vehicle) => keeper?.removed(v),
  };
  const vw = new VehicleWorld(physics, new HitboxRegistry(), hooks, [], [], 24);
  let keeper: PostKeeper | null = null;
  const inputs = new Map<number, DriveInput>();
  const step = (seconds: number) => {
    for (let t = 0; t < seconds; t += DT) {
      vw.step(DT, inputs, []);
      keeper?.step(DT);
      physics.step();
      vw.afterStep();
    }
  };
  return { physics, vw, step, setKeeper: (k: PostKeeper) => (keeper = k) };
}

describe('fixed weapons: in the world', () => {
  it("never move, are anyone's, shrug off bullets and go down to a rocket or two", async () => {
    const { vw, step } = await field();
    const v = vw.spawn('hmg', new THREE.Vector3(5, 0, 5), 0.4, null);
    expect(VEHICLES.hmg.seats[0]!.role).toBe('gunner');
    expect(v.mounts[0]!.id).toBe('hmgpost');
    step(1);
    expect(v.pos.distanceTo(new THREE.Vector3(5, 0, 5))).toBeLessThan(1e-4);
    v.drive(DT, { throttle: 1, steer: 1, brake: false });
    step(1);
    expect(v.pos.distanceTo(new THREE.Vector3(5, 0, 5))).toBeLessThan(1e-4);
    v.applyDamage(100, 'body', undefined, 'bullet');
    expect(v.health).toBeGreaterThan(VEHICLES.hmg.health - 10);
    v.applyDamage(250, 'body', undefined, 'at');
    v.applyDamage(250, 'body', undefined, 'at');
    expect(v.health).toBeLessThanOrEqual(0);
  });

  it('a field gun lays itself onto a point 600 m off and its shell comes down there', async () => {
    const { vw } = await field();
    const v = vw.spawn('fieldgun', new THREE.Vector3(0, 0, 0), 0, null);
    const target = new THREE.Vector3(-150, 0, -580);
    let laid = false;
    for (let i = 0; i < 60 * 8 && !laid; i++) laid = layGun(v, 0, target, DT).laid;
    expect(laid).toBe(true);
    // Fly a shell along the laid barrel (the gun's speed and drop) down to the ground.
    const m = v.mounts[0]!;
    const aim = v.mountAim(0)!;
    const shell = m.gun.shell!;
    const p = v.seatEye(0, new THREE.Vector3());
    const vel = new THREE.Vector3(
      -Math.sin(aim.yaw) * Math.cos(aim.pitch),
      Math.sin(aim.pitch),
      -Math.cos(aim.yaw) * Math.cos(aim.pitch),
    ).multiplyScalar(shell.speed);
    for (let i = 0; i < 60 * 20 && p.y > 0; i++) {
      vel.y -= shell.gravity * DT;
      p.addScaledVector(vel, DT);
    }
    expect(Math.hypot(p.x - target.x, p.z - target.z)).toBeLessThan(12);
  });

  it('all up at the start; a wreck cleared away leaves a blueprint, built back it is a new gun', async () => {
    const { physics, vw, step, setKeeper } = await field();
    const plan = planFortifications(zones, [], [], flat, { bases, posts: ALL });
    const fort = new Fortifications(
      plan,
      new FortModels(null),
      physics,
      new SurfaceRegistry(),
      null,
    );
    const keeper = new PostKeeper(vw, plan.slots, fort);
    setKeeper(keeper);
    keeper.start();
    const postSlots = fort.slots.filter((s) => isPost(s.kind));
    expect(postSlots.length).toBeGreaterThan(5);
    expect(postSlots.every((s) => s.built)).toBe(true);
    expect(vw.vehicles.filter((v) => v.spec.fixed)).toHaveLength(postSlots.length);
    // Wreck one: it burns, is cleared away, and its spot is a blueprint again.
    const spot = keeper.spots[0]!;
    const v = vw.get(spot.vehicle!)!;
    v.health = 0;
    step(14);
    expect(vw.get(v.id)).toBeUndefined();
    expect(spot.slot!.built).toBe(false);
    // Nothing comes back by itself where there is building...
    step(POST_RESPAWN + 2);
    expect(spot.vehicle).toBeNull();
    // ...it is built back.
    const r = fort.work(spot.slot!, 60, 'support', () => false);
    expect(r.done).toBe(true);
    expect(spot.vehicle).not.toBeNull();
    expect(vw.get(spot.vehicle!)!.pos.distanceTo(spot.pos)).toBeLessThan(1e-3);
    // Blasts on built spots leave the fixed weapons to their own health.
    expect(fort.blast(spot.pos, 10, () => 9999)).not.toContain(spot.slot);
  });

  it('without building (simplified controls) a wrecked one comes back on its own', async () => {
    const { vw, step, setKeeper } = await field();
    const plan = planFortifications(zones, [], [], flat, { bases, posts: ALL });
    const keeper = new PostKeeper(vw, plan.slots, null);
    setKeeper(keeper);
    keeper.start();
    const spot = keeper.spots[0]!;
    vw.get(spot.vehicle!)!.health = 0;
    step(14);
    expect(spot.vehicle).toBeNull();
    step(POST_RESPAWN);
    expect(spot.vehicle).not.toBeNull();
  });
});

describe('fixed weapons: on the game server', () => {
  it('a zone match brings them all up, their spots built; a simplified one keeps them without building', async () => {
    const { readFileSync } = await import('node:fs');
    const { parseMap } = await import('@/world/validateMap');
    const { MatchSim } = await import('@/sim/MatchSim');
    const lyon = () => parseMap(JSON.parse(readFileSync('public/maps/lyon.json', 'utf8')));
    const sim = await MatchSim.create(lyon());
    const fixed = sim.vehicles!.world.vehicles.filter((v) => v.spec.fixed);
    const slots = sim.fort!.slots.filter((s) => isPost(s.kind));
    expect(fixed.length).toBeGreaterThan(8);
    expect(fixed.length).toBe(slots.length);
    expect(slots.every((s) => s.built)).toBe(true);
    expect(new Set(fixed.map((v) => v.kind))).toEqual(new Set(['hmg', 'fieldgun', 'aagun']));
    // Every one standing on the ground where it was planned, nobody's.
    for (const v of fixed) {
      expect(v.home).toBeNull();
      expect(Math.abs(v.pos.y - sim.world.terrain.heightAt(v.pos.x, v.pos.z))).toBeLessThan(0.6);
    }
    const simple = await MatchSim.create(lyon(), { simple: true });
    expect(simple.fort).toBeNull();
    expect(simple.vehicles!.world.vehicles.filter((v) => v.spec.fixed)).toHaveLength(fixed.length);
  }, 120000);
});
