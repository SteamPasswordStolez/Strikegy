import * as THREE from 'three';
import type { VisualProfileId } from '@/world/mapTypes';

interface VisualProfile {
  sky: number;
  fog: { color: number; near: number; far: number };
  hemi: { sky: number; ground: number; intensity: number };
  sun?: { color: number; intensity: number; dir: [number, number, number] };
  exposure: number;
}

const PROFILES: Record<VisualProfileId, VisualProfile> = {
  outdoor_day: {
    sky: 0x9cc3e4,
    fog: { color: 0xb4cde0, near: 80, far: 420 },
    hemi: { sky: 0xcfe3ff, ground: 0x5a5040, intensity: 1.1 },
    sun: { color: 0xfff1dc, intensity: 2.6, dir: [0.45, 0.8, 0.3] },
    exposure: 1.0,
  },
  overcast: {
    sky: 0x8d949b,
    fog: { color: 0x8d949b, near: 40, far: 260 },
    hemi: { sky: 0xb8c0c8, ground: 0x4a463e, intensity: 1.6 },
    sun: { color: 0xdfe4ea, intensity: 0.9, dir: [0.2, 1, 0.1] },
    exposure: 1.05,
  },
  indoor: {
    sky: 0x1a1c1f,
    fog: { color: 0x1a1c1f, near: 30, far: 120 },
    hemi: { sky: 0xd8dde6, ground: 0x2a2622, intensity: 1.2 },
    exposure: 1.15,
  },
};

/** Applies sky, fog and global lights. Shadow frustum is sized to the map. */
export function applyVisualProfile(
  scene: THREE.Scene,
  gl: THREE.WebGLRenderer,
  id: VisualProfileId,
  mapSize: [number, number],
  shadowMapSize: number,
): void {
  const p = PROFILES[id];
  scene.background = new THREE.Color(p.sky);
  scene.fog = new THREE.Fog(p.fog.color, p.fog.near, p.fog.far);
  gl.toneMappingExposure = p.exposure;

  scene.add(new THREE.HemisphereLight(p.hemi.sky, p.hemi.ground, p.hemi.intensity));

  if (p.sun) {
    const sun = new THREE.DirectionalLight(p.sun.color, p.sun.intensity);
    const half = Math.max(mapSize[0], mapSize[1]) / 2;
    const [dx, dy, dz] = p.sun.dir;
    const dist = half * 2;
    sun.position.set(dx * dist, dy * dist, dz * dist);
    sun.castShadow = gl.shadowMap.enabled;
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -half;
    cam.right = cam.top = half;
    cam.near = 1;
    cam.far = dist * 2.5;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
  }
}
