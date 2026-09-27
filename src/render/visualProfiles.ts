import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { VisualProfileId } from '@/world/mapTypes';

interface SkyParams {
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  cloudCoverage: number;
  cloudDensity: number;
}

interface VisualProfile {
  sky?: SkyParams;
  /** Solid background when there is no sky (indoor). */
  background?: number;
  /** Sun elevation / azimuth in degrees. */
  sun?: { elevation: number; azimuth: number; color: number; intensity: number };
  fog: { color: number; density: number };
  hemi: { sky: number; ground: number; intensity: number };
  envIntensity: number;
  exposure: number;
}

const PROFILES: Record<VisualProfileId, VisualProfile> = {
  outdoor_day: {
    sky: { turbidity: 2.5, rayleigh: 1.1, mieCoefficient: 0.004, mieDirectionalG: 0.8, cloudCoverage: 0.3, cloudDensity: 0.35 },
    sun: { elevation: 38, azimuth: -35, color: 0xfff1de, intensity: 2.4 },
    fog: { color: 0xa9bccd, density: 0.0016 },
    hemi: { sky: 0xcfe0ff, ground: 0x6b5a45, intensity: 0.25 },
    envIntensity: 0.85,
    exposure: 0.46,
  },
  overcast: {
    sky: { turbidity: 10, rayleigh: 2.5, mieCoefficient: 0.01, mieDirectionalG: 0.7, cloudCoverage: 0.85, cloudDensity: 0.7 },
    sun: { elevation: 50, azimuth: 120, color: 0xe4e8ee, intensity: 1.1 },
    fog: { color: 0x9aa3ab, density: 0.006 },
    hemi: { sky: 0xc0c8d0, ground: 0x4a463e, intensity: 0.6 },
    envIntensity: 1.1,
    exposure: 0.8,
  },
  // Low winter sun through thin high cloud; cold, hazy air.
  winter: {
    // Hazy (high turbidity + rayleigh) so the sky reads pale and the cloud gaps stay light.
    sky: { turbidity: 20, rayleigh: 3, mieCoefficient: 0.02, mieDirectionalG: 0.6, cloudCoverage: 0.85, cloudDensity: 0.8 },
    sun: { elevation: 30, azimuth: -150, color: 0xfff2e6, intensity: 1.4 },
    fog: { color: 0xbfc7d0, density: 0.0042 },
    hemi: { sky: 0xdfe8f4, ground: 0xb8bcc2, intensity: 0.45 },
    envIntensity: 0.95,
    exposure: 0.5,
  },
  indoor: {
    background: 0x15171a,
    fog: { color: 0x15171a, density: 0.012 },
    hemi: { sky: 0xd8dde6, ground: 0x2a2622, intensity: 0.5 },
    envIntensity: 0.5,
    exposure: 1.0,
  },
};

export interface AtmosphereOptions {
  shadows: boolean;
  shadowMapSize: number;
  /** Half-size of the sun's shadow frustum in meters (follows the camera). */
  shadowExtent: number;
}

/**
 * Sky, image-based lighting, fog and the sun. The environment map is
 * generated from the same sky so reflections and ambient light match it.
 */
export class Atmosphere {
  readonly sun: THREE.DirectionalLight | null = null;
  private readonly sky: Sky | null = null;
  private readonly sunDir = new THREE.Vector3();
  private texel: number;
  /** Shadow frustum fitted once to the whole map (see fitShadowsTo); no per-frame follow. */
  private staticShadows = false;

  constructor(
    scene: THREE.Scene,
    fpScene: THREE.Scene,
    gl: THREE.WebGLRenderer,
    id: VisualProfileId,
    private readonly opts: AtmosphereOptions,
  ) {
    const p = PROFILES[id];
    gl.toneMappingExposure = p.exposure;
    scene.fog = new THREE.FogExp2(p.fog.color, p.fog.density);
    scene.add(new THREE.HemisphereLight(p.hemi.sky, p.hemi.ground, p.hemi.intensity));

    if (p.sun) {
      const phi = THREE.MathUtils.degToRad(90 - p.sun.elevation);
      const theta = THREE.MathUtils.degToRad(p.sun.azimuth);
      this.sunDir.setFromSphericalCoords(1, phi, theta);
    }

    const pmrem = new THREE.PMREMGenerator(gl);
    let env: THREE.Texture;
    if (p.sky) {
      const sky = new Sky();
      sky.scale.setScalar(1000);
      const u = sky.material.uniforms;
      u.turbidity!.value = p.sky.turbidity;
      u.rayleigh!.value = p.sky.rayleigh;
      u.mieCoefficient!.value = p.sky.mieCoefficient;
      u.mieDirectionalG!.value = p.sky.mieDirectionalG;
      u.cloudCoverage!.value = p.sky.cloudCoverage;
      u.cloudDensity!.value = p.sky.cloudDensity;
      u.sunPosition!.value.copy(this.sunDir);
      scene.add(sky);
      this.sky = sky;

      // Environment is captured without the sun disc to avoid a hot spot in reflections.
      const envScene = new THREE.Scene();
      const envSky = new Sky();
      envSky.material = sky.material.clone();
      envSky.material.uniforms.showSunDisc!.value = 0;
      envSky.scale.setScalar(50);
      envScene.add(envSky);
      env = pmrem.fromScene(envScene, 0.02).texture;
      envSky.material.dispose();
    } else {
      scene.background = new THREE.Color(p.background ?? 0);
      env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    }
    pmrem.dispose();
    scene.environment = env;
    scene.environmentIntensity = p.envIntensity;
    fpScene.environment = env;
    // Viewmodel sits close to the lens; keep sky reflections subdued so metal reads as dark steel.
    fpScene.environmentIntensity = Math.min(0.2, p.envIntensity);

    this.texel = (opts.shadowExtent * 2) / opts.shadowMapSize;
    if (p.sun) {
      const sun = new THREE.DirectionalLight(p.sun.color, p.sun.intensity);
      sun.castShadow = opts.shadows;
      sun.shadow.mapSize.set(opts.shadowMapSize, opts.shadowMapSize);
      const cam = sun.shadow.camera;
      cam.left = cam.bottom = -opts.shadowExtent;
      cam.right = cam.top = opts.shadowExtent;
      cam.near = 1;
      cam.far = 400;
      sun.shadow.bias = -0.0003;
      sun.shadow.normalBias = 0.035;
      sun.shadow.radius = 2;
      scene.add(sun, sun.target);
      this.sun = sun;
    }
  }

  /**
   * Fixes the shadow frustum over a world-space box (the playable map), fitted
   * tightly in the sun's view space. The shadow map then only needs re-rendering
   * when something that casts shadows moves. `maxSize` caps the longer side.
   */
  fitShadowsTo(box: THREE.Box3, maxSize: number): void {
    const sun = this.sun;
    if (!sun) return;
    const center = box.getCenter(new THREE.Vector3());
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(this.sunDir, 200);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    const view = new THREE.Matrix4().lookAt(sun.position, center, THREE.Object3D.DEFAULT_UP);
    view.setPosition(sun.position).invert();
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
    const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(view);
      lo.min(p);
      hi.max(p);
    }
    const w = hi.x - lo.x;
    const h = hi.y - lo.y;
    const scale = maxSize / Math.max(w, h);
    const cam = sun.shadow.camera;
    cam.left = lo.x;
    cam.right = hi.x;
    cam.bottom = lo.y;
    cam.top = hi.y;
    cam.near = Math.max(0.5, -hi.z - 5);
    cam.far = -lo.z + 5;
    cam.updateProjectionMatrix();
    sun.shadow.mapSize.set(Math.ceil(w * scale), Math.ceil(h * scale));
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    this.texel = 1 / scale;
    // Bias scales with texel size so larger texels do not start to acne.
    sun.shadow.normalBias = Math.max(0.035, this.texel * 0.9);
    this.staticShadows = true;
  }

  /** Keeps the shadow frustum centered on the viewer, snapped to texels to avoid shimmering. */
  update(focus: THREE.Vector3, time: number): void {
    if (this.sky) this.sky.material.uniforms.time!.value = time;
    if (!this.sun || this.staticShadows) return;
    const t = this.texel;
    const fx = Math.round(focus.x / t) * t;
    const fz = Math.round(focus.z / t) * t;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunDir.x * 200, this.sunDir.y * 200, fz + this.sunDir.z * 200);
  }
}
