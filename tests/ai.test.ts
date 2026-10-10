import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { aimErrorDeg, noticeTime, offAxisDeg, turnToward, wrapAngle, yawPitchOf } from '@/ai/aim';
import { chooseAction, scoreActions, type BrainInput } from '@/ai/brain';
import { Boundary, Terrain } from '@/world/terrain';
import { WaterMap } from '@/world/water';
import { NavWorld } from '@/ai/NavWorld';
import { PhysicsWorld } from '@/physics/PhysicsWorld';

const DEG = Math.PI / 180;

describe('aim helpers', () => {
  it('uses the player yaw convention (0 = -Z, +90° = -X)', () => {
    expect(yawPitchOf(0, 0, -1)[0]).toBeCloseTo(0);
    expect(yawPitchOf(-1, 0, 0)[0]).toBeCloseTo(Math.PI / 2);
    expect(yawPitchOf(0, 1, -1)[1]).toBeCloseTo(Math.PI / 4);
  });

  it('turns the short way around and never overshoots', () => {
    expect(Math.abs(wrapAngle(3 * Math.PI))).toBeCloseTo(Math.PI);
    const from = 170 * DEG;
    const to = -170 * DEG;
    const next = turnToward(from, to, 5 * DEG);
    expect(wrapAngle(next - from)).toBeCloseTo(5 * DEG); // through 180°, not back through 0
    expect(turnToward(0, 0.01, 1)).toBe(0.01);
  });

  it('settles aim error from the start value to the floor', () => {
    expect(aimErrorDeg(5, 1.5, 1.5, 0)).toBeCloseTo(5);
    expect(aimErrorDeg(5, 1.5, 1.5, 3)).toBeCloseTo(1.5);
    expect(aimErrorDeg(5, 1.5, 1.5, 0.75)).toBeLessThan(5);
  });

  it('notices close, centered, shooting enemies fastest', () => {
    const base = noticeTime(0.45, 5, 0, 57, false);
    expect(noticeTime(0.45, 60, 0, 57, false)).toBeGreaterThan(base);
    expect(noticeTime(0.45, 5, 50, 57, false)).toBeGreaterThan(base);
    expect(noticeTime(0.45, 5, 0, 57, true)).toBeLessThan(base);
    expect(offAxisDeg(0, 0, -10)).toBeCloseTo(0);
    expect(offAxisDeg(0, 10, 0)).toBeCloseTo(90);
  });
});

describe('utility brain', () => {
  const calm: BrainInput = {
    health: 1,
    hasTarget: false,
    lastSeenAge: Infinity,
    heardAge: Infinity,
    ammo: 1,
    reloading: false,
    sinceHurt: Infinity,
    coverKnown: false,
    inCover: false,
  };

  it('advances when nothing is happening and fights what it sees', () => {
    expect(chooseAction(calm, null)).toBe('advance');
    expect(chooseAction({ ...calm, hasTarget: true, lastSeenAge: 0 }, null)).toBe('engage');
  });

  it('breaks contact when badly hurt and cover is known', () => {
    const hurt = { ...calm, hasTarget: true, health: 0.25, sinceHurt: 0.3, coverKnown: true };
    expect(chooseAction(hurt, 'engage')).toBe('cover');
    // Without cover it keeps fighting.
    expect(chooseAction({ ...hurt, coverKnown: false }, 'engage')).toBe('engage');
  });

  it('chases recent sightings, investigates noises and reloads in quiet moments', () => {
    expect(chooseAction({ ...calm, lastSeenAge: 2 }, null)).toBe('hunt');
    expect(chooseAction({ ...calm, heardAge: 1 }, null)).toBe('investigate');
    expect(chooseAction({ ...calm, ammo: 0 }, null)).toBe('reload');
  });
  it('gets into cover when pinned down, even at full health', () => {
    const fight = { ...calm, hasTarget: true, lastSeenAge: 0, coverKnown: true, sinceHurt: 5 };
    expect(chooseAction(fight, 'engage')).toBe('engage');
    expect(chooseAction({ ...fight, suppression: 0.9 }, 'engage')).toBe('cover');
    // In cover with the shooter out of sight: stay down rather than chase.
    expect(
      chooseAction(
        { ...calm, inCover: true, lastSeenAge: 20, heardAge: 0.5, suppression: 0.8 },
        null,
      ),
    ).toBe('hold');
  });

  it('stops chasing when outnumbered and presses on when ahead', () => {
    const seen = { ...calm, lastSeenAge: 4 };
    const scores = (odds: number) => scoreActions({ ...seen, odds }).hunt;
    expect(scores(0.3)).toBeLessThan(scores(1));
    expect(scores(3)).toBeGreaterThan(scores(1));
    expect(chooseAction({ ...seen, odds: 0.25, inCover: true }, null)).toBe('hold');
  });
});

describe('WaterMap', () => {
  it('reports depth in the river and nothing on the banks', () => {
    const square = new Boundary([
      [-60, -60],
      [60, -60],
      [60, 60],
      [-60, 60],
    ]);
    const t = new Terrain(
      {
        rivers: [
          {
            pts: [
              [0, -80],
              [0, 80],
            ],
            width: 10,
            depth: 2,
            bank: 4,
            water: 0.6,
          },
        ],
      },
      square,
      [160, 160],
    );
    const w = new WaterMap(t);
    expect(w.any).toBe(true);
    expect(w.depthAt(0, -2, 0)).toBeCloseTo(0.6, 1);
    expect(w.depthAt(20, 0, 0)).toBe(0);
    expect(w.depthAt(0, 1, 0)).toBe(0);
  });
});

describe('NavWorld', () => {
  it("paths and steps like recast-navigation's own wrappers (reused buffers)", async () => {
    const physics = await PhysicsWorld.create();
    physics.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 40, y: 0.5, z: 40 });
    let seed = 3;
    const r = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 60; i++) {
      const a = r() * Math.PI;
      physics.addStaticBox(
        { x: (r() - 0.5) * 70, y: 1, z: (r() - 0.5) * 70 },
        { x: 0.5 + r() * 4, y: 1, z: 0.3 + r() },
        { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) },
      );
    }
    physics.step();
    const nav = (await NavWorld.build(physics))!;
    const q = (nav as unknown as { query: import('recast-navigation').NavMeshQuery }).query;
    const half = (nav as unknown as { halfExtents: { x: number; y: number; z: number } })
      .halfExtents;
    let paths = 0;
    for (let i = 0; i < 150; i++) {
      const from = { x: (r() - 0.5) * 76, y: 0, z: (r() - 0.5) * 76 };
      const to = { x: (r() - 0.5) * 76, y: 0, z: (r() - 0.5) * 76 };
      const want = q.computePath(from, to, { halfExtents: half, maxPathPolys: 1024 });
      const got: THREE.Vector3[] = [];
      const ok = nav.path(from, to, got);
      expect(ok).toBe(want.success && want.path.length > 0);
      if (!ok) continue;
      paths++;
      expect(got.length).toBe(want.path.length);
      got.forEach((p, k) => {
        expect(p.x).toBeCloseTo(want.path[k]!.x, 5);
        expect(p.y).toBeCloseTo(want.path[k]!.y, 5);
        expect(p.z).toBeCloseTo(want.path[k]!.z, 5);
      });
    }
    expect(paths).toBeGreaterThan(100);
    let moves = 0;
    for (let i = 0; i < 300; i++) {
      const from = { x: (r() - 0.5) * 76, y: 0, z: (r() - 0.5) * 76 };
      const to = { x: from.x + (r() - 0.5) * 3, y: 0, z: from.z + (r() - 0.5) * 3 };
      const c = q.findClosestPoint(from, { halfExtents: half });
      if (!c.success || !c.polyRef) continue;
      const res = q.moveAlongSurface(c.polyRef, c.point, to, { maxVisitedSize: 16 });
      const out = new THREE.Vector3();
      const ref = nav.move(c.polyRef, c.point, to, out);
      expect(ref).toBe(res.visited[res.visited.length - 1] ?? c.polyRef);
      const h = q.getPolyHeight(ref, res.resultPosition);
      expect(out.x).toBeCloseTo(res.resultPosition.x, 5);
      expect(out.z).toBeCloseTo(res.resultPosition.z, 5);
      expect(out.y).toBeCloseTo(h.success ? h.height : res.resultPosition.y, 5);
      moves++;
    }
    expect(moves).toBeGreaterThan(200);
    nav.dispose();
    physics.dispose();
  });

  it('paths around a wall through its gap', async () => {
    const physics = await PhysicsWorld.create();
    // 40 x 40 floor, a wall across z = 0 with a 4 m gap at x = 14..18.
    physics.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 20, y: 0.5, z: 20 });
    physics.addStaticBox({ x: -3, y: 1.5, z: 0 }, { x: 17, y: 1.5, z: 0.5 });
    physics.addStaticBox({ x: 19, y: 1.5, z: 0 }, { x: 1, y: 1.5, z: 0.5 });
    physics.step();
    const nav = await NavWorld.build(physics);
    expect(nav).not.toBeNull();
    const path: THREE.Vector3[] = [];
    expect(nav!.path({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -10 }, path)).toBe(true);
    // The route must pass through the gap (x around 14-18 near z = 0).
    const crossing =
      path.find((p, i) => i > 0 && Math.sign(p.z) !== Math.sign(path[i - 1]!.z)) ??
      path.find((p) => Math.abs(p.z) < 1);
    expect(crossing).toBeDefined();
    const len = path.reduce((a, p, i) => (i ? a + p.distanceTo(path[i - 1]!) : 0), 0);
    expect(len).toBeGreaterThan(30);
    expect(path.some((p) => p.x > 12)).toBe(true);
    // A straight walk through the wall is not walkable, along the floor it is.
    expect(nav!.walkable({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: -5 })).toBe(false);
    expect(nav!.walkable({ x: 0, y: 0, z: 5 }, { x: 5, y: 0, z: 10 })).toBe(true);
    const r = nav!.randomAround({ x: 0, y: 0, z: 10 }, 3)!;
    expect(Math.hypot(r.x, r.z - 10)).toBeLessThanOrEqual(3.01);
    nav!.dispose();
    physics.dispose();
  });

  it('never snaps onto patches no one can walk to, even after tiles are rebuilt', async () => {
    const physics = await PhysicsWorld.create();
    physics.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 20, y: 0.5, z: 20 });
    // A crate (its top is left out of the mesh) and a closed pen (a walkable island).
    physics.addStaticBox({ x: 8, y: 0.6, z: 8 }, { x: 1, y: 0.6, z: 1 });
    physics.addStaticBox({ x: -10, y: 1.5, z: -13.5 }, { x: 4, y: 1.5, z: 0.5 });
    physics.addStaticBox({ x: -10, y: 1.5, z: -6.5 }, { x: 4, y: 1.5, z: 0.5 });
    physics.addStaticBox({ x: -13.5, y: 1.5, z: -10 }, { x: 0.5, y: 1.5, z: 3 });
    physics.addStaticBox({ x: -6.5, y: 1.5, z: -10 }, { x: 0.5, y: 1.5, z: 3 });
    physics.step();
    const nav = (await NavWorld.build(physics))!;
    const check = (): void => {
      expect(nav.closest({ x: 8, y: 1.5, z: 8 })!.y).toBeLessThan(0.3);
      for (const p of [
        { x: -10, y: 0, z: -10 },
        { x: -10, y: 0, z: -8 },
      ]) {
        const at = nav.closest(p);
        if (at) expect(Math.max(Math.abs(at.x + 10), Math.abs(at.z + 10))).toBeGreaterThan(3);
      }
      expect(nav.randomAround({ x: -10, y: 0, z: -10 }, 2.5)).toBeNull();
      expect(nav.path({ x: 5, y: 0, z: 5 }, { x: -2, y: 0, z: -2 }, [])).toBe(true);
    };
    expect(nav.islandCount).toBeGreaterThan(0);
    check();
    // Something built against the pen rebuilds its tiles: the pen stays off.
    const o = nav.addBox({ x: -6, y: 0.5, z: -10 }, { x: 0.3, y: 0.5, z: 1 }, 0)!;
    nav.update(4096);
    check();
    nav.remove(o);
    nav.update(4096);
    check();
    nav.dispose();
    physics.dispose();
  });
});
