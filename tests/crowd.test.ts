import fs from 'node:fs';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadCore } from '@/wasm/core';
import { CROWD_AIR, CROWD_BOT, CROWD_HAS_GOAL, Crowd, type CrowdTuning } from '@/ai/crowd';
import { offAxisDeg } from '@/ai/aim';
import type { Combatant } from '@/ai/types';

// The wasm kernels against the TypeScript they replaced (kept here as the reference).

const TUNING: CrowdTuning = {
  cell: 2,
  sepRadius: 0.95,
  sepStanding: 0.7,
  sepSpeed: 1.9,
  moving: 0.3,
  avoidAhead: 2,
  avoidWidth: 0.85,
  spotTaken: 0.75,
};

interface Body extends Combatant {
  hasGoal: boolean;
  air: boolean;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A crowd packed into `size` m (to get lots of neighbours), the last one the player. */
function scene(seed: number, n: number, size: number): Body[] {
  const r = rng(seed);
  const out: Body[] = [];
  for (let i = 0; i < n; i++) {
    const moving = r() < 0.6;
    out.push({
      id: i < n - 1 ? 100 + i : 0,
      name: '',
      team: r() < 0.5 ? 'blue' : 'red',
      alive: r() < 0.9,
      downed: r() < 0.08,
      feet: new THREE.Vector3(
        (r() - 0.5) * size,
        (r() - 0.5) * (r() < 0.1 ? 8 : 0.6),
        (r() - 0.5) * size,
      ),
      velocity: moving
        ? new THREE.Vector3((r() - 0.5) * 8, 0, (r() - 0.5) * 8)
        : new THREE.Vector3(),
      eyeHeight: 1.6,
      firingUntil: 0,
      yaw: 0,
      inCombat: () => false,
      hasGoal: r() < 0.5,
      air: r() < 0.05,
    });
  }
  return out;
}

function load(crowd: Crowd, bodies: Body[]): void {
  crowd.setCount(bodies.length);
  crowd.setHumans([bodies.length - 1]);
  bodies.forEach((b, i) =>
    crowd.put(
      i,
      b,
      (i < bodies.length - 1 ? CROWD_BOT : 0) |
        (b.hasGoal ? CROWD_HAS_GOAL : 0) |
        (b.air ? CROWD_AIR : 0),
    ),
  );
  crowd.buildGrid();
}

// --- reference: BotManager.separation / repel before the port ---------------

function refSeparation(
  bodies: Body[],
  self: number,
  wx: number,
  wz: number,
  speed: number,
): THREE.Vector3 {
  const bot = bodies[self]!;
  const out = new THREE.Vector3();
  let steer = 0;
  const repel = (o: Body, scale: number): void => {
    if (!o.alive || Math.abs(o.feet.y - bot.feet.y) > 1.5) return;
    const dx = bot.feet.x - o.feet.x;
    const dz = bot.feet.z - o.feet.z;
    const d = Math.hypot(dx, dz);
    const moving = speed > 0.1;
    const oSpeed = Math.hypot(o.velocity.x, o.velocity.z);
    const oMoving = !o.downed && oSpeed > TUNING.moving;
    const radius = (moving || oMoving ? TUNING.sepRadius : TUNING.sepStanding) * scale;
    if (d < radius) {
      const share = moving ? (oMoving ? 1 : 1.4) : oMoving ? 0.35 : 1;
      const k = (1 - d / radius) * TUNING.sepSpeed * share;
      if (d < 1e-3) out.x += (bot.id > o.id ? 1 : -1) * k;
      else {
        out.x += (dx / d) * k;
        out.z += (dz / d) * k;
      }
    }
    if (!moving) return;
    const ahead = -dx * wx - dz * wz;
    if (ahead < 0.05 || ahead > TUNING.avoidAhead) return;
    const lat = dx * wz - dz * wx;
    if (Math.abs(lat) > TUNING.avoidWidth * scale) return;
    const headOn = oMoving && o.velocity.x * wx + o.velocity.z * wz < -0.3 * oSpeed;
    const side = headOn || Math.abs(lat) < 0.05 ? 1 : -Math.sign(lat);
    steer +=
      side *
      (1 - ahead / TUNING.avoidAhead) *
      (1 - (Math.abs(lat) / (TUNING.avoidWidth * scale)) * 0.5);
  };
  // The old grid: every living bot within the 3x3 cells around this one.
  const cell = (v: number): number => Math.floor(v / TUNING.cell);
  const cx = cell(bot.feet.x);
  const cz = cell(bot.feet.z);
  for (let i = 0; i < bodies.length - 1; i++) {
    const o = bodies[i]!;
    if (
      i === self ||
      !o.alive ||
      Math.abs(cell(o.feet.x) - cx) > 1 ||
      Math.abs(cell(o.feet.z) - cz) > 1
    )
      continue;
    repel(o, 1);
  }
  repel(bodies[bodies.length - 1]!, 1.2);
  if (steer !== 0) {
    const k = THREE.MathUtils.clamp(steer, -1, 1) * speed * 0.9;
    out.x += -wz * k;
    out.z += wx * k;
  }
  return out;
}

function refSpotTaken(bodies: Body[], self: number, p: THREE.Vector3): boolean {
  for (let i = 0; i < bodies.length - 1; i++) {
    const o = bodies[i]!;
    if (
      i !== self &&
      o.alive &&
      !o.hasGoal &&
      Math.abs(o.feet.y - p.y) < 1.5 &&
      Math.hypot(o.feet.x - p.x, o.feet.z - p.z) < TUNING.spotTaken
    )
      return true;
  }
  return false;
}

// --- reference: the old first pass of Bot.perceive ---------------------------

function refView(
  bodies: Body[],
  self: number,
  sight: number,
  riding: boolean,
  halfFov: number,
  yaw: number,
  pitch: number,
): number[] {
  const me = bodies[self]!;
  const out: number[] = [];
  bodies.forEach((e, i) => {
    if (e.team === me.team || !e.alive) return;
    const dx = e.feet.x - me.feet.x;
    const dy = e.feet.y - me.feet.y;
    const dz = e.feet.z - me.feet.z;
    const flat = Math.hypot(dx, dz);
    const dist = Math.hypot(flat, dy);
    const s = riding && e.air ? sight * 3 : sight;
    const off = offAxisDeg(yaw, dx, dz);
    const offUp = Math.abs(Math.atan2(dy, flat) - pitch) / (Math.PI / 180);
    if (dist < s && ((off < halfFov && (offUp < 50 || riding)) || dist < 1.5)) out.push(i);
  });
  return out;
}

describe('wasm crowd kernels', () => {
  let crowd: Crowd;
  beforeAll(async () => {
    crowd = new Crowd(await loadCore(fs.readFileSync('src/wasm/core.wasm')), TUNING);
  });

  it('separation matches the TypeScript version', () => {
    const v = new THREE.Vector3();
    let checked = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const bodies = scene(seed, 120, 14);
      load(crowd, bodies);
      const r = rng(seed * 7);
      for (let i = 0; i < bodies.length - 1; i++) {
        if (!bodies[i]!.alive) continue;
        const a = r() * Math.PI * 2;
        const speed = r() < 0.3 ? 0 : r() * 5;
        const want = refSeparation(bodies, i, Math.sin(a), Math.cos(a), speed);
        crowd.separation(i, Math.sin(a), Math.cos(a), speed, v);
        expect(v.x).toBeCloseTo(want.x, 3);
        expect(v.z).toBeCloseTo(want.z, 3);
        if (want.lengthSq() > 0) checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('spot taken matches', () => {
    const bodies = scene(3, 200, 30);
    load(crowd, bodies);
    const r = rng(99);
    let taken = 0;
    for (let k = 0; k < 2000; k++) {
      const self = Math.floor(r() * (bodies.length - 1));
      const p = new THREE.Vector3((r() - 0.5) * 30, (r() - 0.5) * 0.6, (r() - 0.5) * 30);
      const want = refSpotTaken(bodies, self, p);
      expect(crowd.spotTaken(self, p)).toBe(want);
      if (want) taken++;
    }
    expect(taken).toBeGreaterThan(50);
  });

  it('view matches the old first pass of perception', () => {
    let hits = 0;
    let edge = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const bodies = scene(seed, 301, 300);
      load(crowd, bodies);
      const r = rng(seed * 13);
      for (let self = 0; self < bodies.length - 1; self += 3) {
        const riding = r() < 0.2;
        const yaw = (r() - 0.5) * 4 * Math.PI;
        const pitch = (r() - 0.5) * 0.6;
        const half = 50 + r() * 15;
        const want = refView(bodies, self, 120, riding, half, yaw, pitch);
        const n = crowd.view(self, 120, riding ? 360 : 120, half, riding ? null : 50, yaw, pitch);
        const got = [...crowd.hits.subarray(0, n)];
        if (got.join() !== want.join()) {
          // Only float rounding right on a boundary may differ.
          edge += Math.abs(got.length - want.length);
          expect(Math.abs(got.length - want.length)).toBeLessThanOrEqual(1);
        }
        for (let h = 0; h < n; h++) {
          const e = bodies[got[h]!]!;
          expect(crowd.hitDist[h]).toBeCloseTo(e.feet.distanceTo(bodies[self]!.feet), 3);
        }
        hits += want.length;
      }
    }
    expect(hits).toBeGreaterThan(1000);
    expect(edge).toBeLessThan(3);
  });
});
