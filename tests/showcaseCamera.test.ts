import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ShowcaseCamera, type ShowcaseScene } from '@/render/showcaseCamera';

function scene(over: Partial<ShowcaseScene> = {}): { s: ShowcaseScene; actors: { id: number; pos: THREE.Vector3; yaw: number; fighting: boolean }[] } {
  const actors = [
    { id: 1, pos: new THREE.Vector3(10, 0, 0), yaw: 0, fighting: true },
    { id: 2, pos: new THREE.Vector3(-40, 0, 30), yaw: 1, fighting: false },
  ];
  return {
    actors,
    s: { zones: [{ x: 0, y: 0, z: 0, radius: 30 }], actors: () => actors, ground: () => 0, clear: () => true, ...over },
  };
}

describe('menu battle camera', () => {
  it('opens on a wide orbit high over a zone, then cuts to trailing a fighter', () => {
    const { s } = scene();
    const cam = new THREE.PerspectiveCamera();
    const c = new ShowcaseCamera(s);
    c.update(0.1, cam);
    const d = Math.hypot(cam.position.x, cam.position.z);
    expect(d).toBeGreaterThan(30);
    expect(cam.position.y).toBeGreaterThan(10);
    // Run past the orbit: the next shot trails the soldier in a fight, close and low.
    for (let i = 0; i < 160; i++) c.update(0.1, cam);
    expect(cam.position.distanceTo(new THREE.Vector3(10, 0, 0))).toBeLessThan(9);
    expect(cam.position.y).toBeLessThan(4);
  });

  it('cuts away when the trailed soldier falls', () => {
    const { s, actors } = scene();
    const cam = new THREE.PerspectiveCamera();
    const c = new ShowcaseCamera(s);
    for (let i = 0; i < 160; i++) c.update(0.1, cam);
    actors.splice(0, 1);
    c.update(0.1, cam);
    expect(cam.position.y).toBeGreaterThan(10);
  });

  it('never stands where it cannot see its subject', () => {
    // Walls everywhere except straight above: it falls back to looking down from high up.
    const { s } = scene({ clear: () => false });
    const cam = new THREE.PerspectiveCamera();
    const c = new ShowcaseCamera(s);
    c.update(0.1, cam);
    expect(cam.position.y).toBeGreaterThanOrEqual(45);
  });
});
