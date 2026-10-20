import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AudioSystem } from '@/audio/AudioSystem';

class Param {
  value = 1;
  setValueAtTime(v: number) {
    this.value = v;
  }
  setTargetAtTime(v: number) {
    this.value = v;
  }
  exponentialRampToValueAtTime(v: number) {
    this.value = v;
  }
}

class Node {
  readonly gain = new Param();
  readonly frequency = new Param();
  readonly Q = new Param();
  readonly positionX = new Param();
  readonly positionY = new Param();
  readonly positionZ = new Param();
  readonly connections = new Set<Node>();
  connect(dest: Node) {
    this.connections.add(dest);
    return dest;
  }
  disconnect() {
    this.connections.clear();
  }
}

class Source extends Node {
  readonly playbackRate = new Param();
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  end = Infinity;
  started = false;
  stopped = false;
  constructor(private readonly ctx: Context) {
    super();
  }
  start(t: number) {
    this.started = true;
    if (this.buffer)
      this.end = Math.min(this.end, t + this.buffer.duration / this.playbackRate.value);
  }
  stop(t = this.ctx.currentTime) {
    this.stopped = true;
    this.end = t;
  }
  finish() {
    this.end = this.ctx.currentTime;
    this.onended?.();
  }
}

class Context {
  currentTime = 1;
  state = 'running';
  readonly sources: Source[] = [];
  readonly panners: Node[] = [];
  createGain() {
    return new Node();
  }
  createBiquadFilter() {
    return new Node();
  }
  createPanner() {
    const p = new Node();
    this.panners.push(p);
    return p;
  }
  createBufferSource() {
    const s = new Source(this);
    this.sources.push(s);
    return s;
  }
  createOscillator() {
    return this.createBufferSource();
  }
  get active() {
    return this.sources.filter((s) => s.started && s.end > this.currentTime);
  }
  advance(seconds: number) {
    this.currentTime += seconds;
    for (const s of this.sources) if (s.started && s.end <= this.currentTime) s.finish();
  }
}

function make() {
  const ctx = new Context();
  const audio = new AudioSystem(1);
  const internals = audio as unknown as {
    ctx: unknown;
    world: unknown;
    reverb: unknown;
    noise: unknown;
    samples: Map<string, unknown[]>;
  };
  internals.ctx = ctx;
  internals.world = new Node();
  internals.reverb = new Node();
  internals.noise = { duration: 1 };
  for (const id of ['gun_ar', 'gunfar_ar', 'cannon_far'])
    internals.samples.set(id, [{ duration: 4 }]);
  return { audio, ctx };
}

describe('audio under a crowded fight', () => {
  it('coalesces simultaneous distant shots sharing a direction, before creating sources', () => {
    const { audio, ctx } = make();
    const pos = new THREE.Vector3(100, 0, 0);
    for (let i = 0; i < 1000; i++) audio.remoteGunshot('ar', pos, 100, i);
    expect(ctx.panners).toHaveLength(1);
    expect(ctx.sources.length).toBeLessThanOrEqual(20);
    ctx.advance(0.1);
    const before = ctx.sources.length;
    audio.remoteGunshot('ar', pos, 100, 1001);
    expect(ctx.sources.length).toBeGreaterThan(before);
  });

  it('bounds the actual playing sources even when all shots share one near voice; own gun and feedback still play', () => {
    const { audio, ctx } = make();
    const pos = new THREE.Vector3(10, 0, 0);
    for (let i = 0; i < 1000; i++) audio.remoteGunshot('ar', pos, 10, 1);
    expect(ctx.panners).toHaveLength(1);
    expect(ctx.active.length).toBeLessThanOrEqual(96);
    const before = ctx.sources.length;
    audio.gunshot('ar', false);
    audio.hit(false, false);
    expect(ctx.sources.length).toBeGreaterThan(before);
  });

  it('replacing voices stops their sources, including cannon sounds scheduled for later', () => {
    const { audio, ctx } = make();
    audio.bigGun(new THREE.Vector3(1500, 0, 0), 1500);
    const delayed = [...ctx.sources];
    expect(delayed.length).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) audio.remoteGunshot('ar', new THREE.Vector3(10, 0, 0), 10, i);
    expect(delayed.every((s) => s.stopped)).toBe(true);
    expect(ctx.active.length).toBeLessThanOrEqual(96);
    expect(ctx.panners.filter((p) => p.connections.size > 0).length).toBeLessThanOrEqual(32);
  });

  it('keeps close gunfire when distant sources fill the mixer', () => {
    const { audio, ctx } = make();
    const far = new THREE.Vector3(50, 0, 0);
    for (let burst = 0; burst < 4; burst++) {
      for (let i = 0; i < 32; i++) audio.remoteGunshot('ar', far, 50, i);
      ctx.advance(0.06);
    }
    audio.remoteGunshot('ar', new THREE.Vector3(5, 0, 0), 5, 1000);
    const close = ctx.sources.at(-1)!;
    for (let i = 0; i < 100; i++) audio.remoteGunshot('ar', far, 50, i);
    expect(ctx.active).toContain(close);
    expect(ctx.active.length).toBeLessThanOrEqual(96);
  });

  it('releases finished source chains and panners, and can play the same shooter again', () => {
    const { audio, ctx } = make();
    const pos = new THREE.Vector3(10, 0, 0);
    audio.remoteGunshot('ar', pos, 10, 1);
    ctx.advance(6);
    expect(ctx.active).toHaveLength(0);
    expect(ctx.sources.every((s) => s.connections.size === 0)).toBe(true);
    expect(ctx.panners.every((p) => p.connections.size === 0)).toBe(true);
    audio.remoteGunshot('ar', pos, 10, 1);
    expect(ctx.active).toHaveLength(1);
  });
});
