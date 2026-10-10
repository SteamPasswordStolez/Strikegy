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
  /** Photographed sky (`public/assets/sky/<name>/`, made by `npm run assets`); the procedural `sky` stays the fallback. */
  photo?: 'clear' | 'overcast' | 'winter';
  /**
   * Light on flat ground from the sky (sun excluded), in the scene's units; the
   * photographed sky is scaled to give this much. Measured from the procedural
   * sky each profile was tuned with (2026-10-10), so the lighting stays as it was.
   */
  skyLight?: number;
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
    photo: 'clear',
    skyLight: 3.87,
    sun: { elevation: 38, azimuth: -35, color: 0xfff1de, intensity: 2.4 },
    fog: { color: 0xa9bccd, density: 0.0016 },
    hemi: { sky: 0xcfe0ff, ground: 0x6b5a45, intensity: 0.25 },
    envIntensity: 0.85,
    exposure: 0.46,
  },
  overcast: {
    sky: { turbidity: 10, rayleigh: 2.5, mieCoefficient: 0.01, mieDirectionalG: 0.7, cloudCoverage: 0.85, cloudDensity: 0.7 },
    // Tuned with Bilbao (2026-10-02): the old values washed everything out.
    photo: 'overcast',
    skyLight: 18.5,
    sun: { elevation: 50, azimuth: 120, color: 0xe4e8ee, intensity: 1.5 },
    fog: { color: 0x9aa3ab, density: 0.004 },
    hemi: { sky: 0xc0c8d0, ground: 0x4a463e, intensity: 0.45 },
    envIntensity: 0.7,
    exposure: 0.5,
  },
  // Low winter sun through thin high cloud; cold, hazy air.
  winter: {
    // Hazy (high turbidity + rayleigh) so the sky reads pale and the cloud gaps stay light.
    sky: { turbidity: 20, rayleigh: 3, mieCoefficient: 0.02, mieDirectionalG: 0.6, cloudCoverage: 0.85, cloudDensity: 0.8 },
    photo: 'winter',
    skyLight: 16.7,
    sun: { elevation: 30, azimuth: -150, color: 0xfff2e6, intensity: 1.4 },
    fog: { color: 0xbfc7d0, density: 0.0042 },
    hemi: { sky: 0xdfe8f4, ground: 0xb8bcc2, intensity: 0.45 },
    envIntensity: 0.95,
    exposure: 0.5,
  },
  // High, hot sun; pale dusty sky and warm haze.
  desert: {
    sky: { turbidity: 6, rayleigh: 1.4, mieCoefficient: 0.008, mieDirectionalG: 0.8, cloudCoverage: 0.12, cloudDensity: 0.25 },
    sun: { elevation: 55, azimuth: 40, color: 0xffdcaa, intensity: 2.2 },
    fog: { color: 0xd8c8ac, density: 0.0028 },
    // Warm bounce off the sand; the blue sky light is kept low or sand turns grey.
    hemi: { sky: 0xf0d8b0, ground: 0xb08858, intensity: 0.6 },
    envIntensity: 0.4,
    exposure: 0.4,
  },
  indoor: {
    background: 0x15171a,
    fog: { color: 0x15171a, density: 0.012 },
    hemi: { sky: 0xd8dde6, ground: 0x2a2622, intensity: 0.5 },
    envIntensity: 0.5,
    exposure: 1.0,
  },
};

/** A photographed sky as `scripts/hdri.mjs` writes it. */
export interface PhotoSky {
  texture: THREE.Texture;
  /** Lowest elevation in the picture (degrees). */
  bottom: number;
  /** The sun in the picture; `peak` is its brightness over the horizon's (a hidden sun is a few times, a clear one thousands). */
  sun: { elevation: number; azimuth: number; peak: number };
  /** Light on flat ground from the picture as stored (horizon = 1), sun's glow capped. */
  irradiance: number;
}

/** Loads the profile's photographed sky, or null (none for the profile, or it failed: the procedural sky stays). */
export async function loadPhotoSky(id: VisualProfileId, base: string): Promise<PhotoSky | null> {
  const name = PROFILES[id].photo;
  if (!name) return null;
  try {
    const dir = `${base}sky/${name}/`;
    const [texture, info] = await Promise.all([
      new THREE.TextureLoader().loadAsync(`${dir}sky.webp`),
      fetch(`${dir}sky.json`).then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<Omit<PhotoSky, 'texture'>>;
      }),
    ]);
    // Stored values, not colours: no colour-space decode, no mipmaps (the picture is
    // magnified on screen, and mip selection would break at the seam where u wraps).
    texture.colorSpace = THREE.NoColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    return { texture, bottom: info.bottom, sun: info.sun, irradiance: info.irradiance };
  } catch (err) {
    console.warn(`sky ${name}: ${String(err)}; using the procedural sky`);
    return null;
  }
}

/**
 * The photographed sky on a box round the camera (drawn at the far plane like
 * three's Sky). The picture holds sqrt(v / (1 + v)) with the horizon at v = 1;
 * `scale` sets the horizon's brightness, `turn` (turns) swings the picture
 * round so its sun sits where the map's sun is, `clampTo` caps the sun's glow.
 */
function photoSkyMaterial(photo: PhotoSky, scale: THREE.Color, turn: number, clampTo: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'PhotoSky',
    uniforms: {
      map: { value: photo.texture },
      scale: { value: new THREE.Vector3(scale.r, scale.g, scale.b) },
      turn: { value: turn },
      bottom: { value: photo.bottom },
      clampTo: { value: clampTo },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 scale;
      uniform float turn;
      uniform float bottom;
      uniform float clampTo;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float u = atan(d.z, d.x) * 0.15915494 + 0.5 - turn;
        float el = degrees(asin(clamp(d.y, -1.0, 1.0)));
        vec3 c = texture2D(map, vec2(u, clamp((el - bottom) / (90.0 - bottom), 0.0, 1.0))).rgb;
        vec3 t = c * c;
        gl_FragColor = vec4(min(t / max(1.0 - t, 1e-3), vec3(clampTo)) * scale, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

/**
 * The sky draws after the opaque world (terrain is 1): at the far plane with the
 * depth test on, it then shades only the pixels where sky shows instead of the
 * whole screen under everything else.
 */
const SKY_ORDER = 2;

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
  private readonly photoSky: THREE.Mesh | null = null;
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
    photo: PhotoSky | null = null,
  ) {
    const p = PROFILES[id];
    gl.toneMappingExposure = p.exposure;
    scene.fog = new THREE.FogExp2(p.fog.color, p.fog.density);
    scene.add(new THREE.HemisphereLight(p.hemi.sky, p.hemi.ground, p.hemi.intensity));

    if (p.sun) {
      // A sun you can see in the photographed sky sets the light's height; the
      // map's own azimuth stays (the picture is turned to it).
      const elevation = photo && photo.sun.peak > 100 ? photo.sun.elevation : p.sun.elevation;
      const phi = THREE.MathUtils.degToRad(90 - elevation);
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

      // Lighting always comes from the procedural sky every profile was tuned with
      // (its bright horizon is what lights the walls); captured once, without the
      // sun disc to avoid a hot spot in reflections.
      const envScene = new THREE.Scene();
      const envSky = new Sky();
      envSky.material = sky.material.clone();
      envSky.material.uniforms.showSunDisc!.value = 0;
      envSky.scale.setScalar(50);
      envScene.add(envSky);
      env = pmrem.fromScene(envScene, 0.02).texture;
      envSky.material.dispose();

      if (photo && p.sun) {
        // What you see: the photographed sky (also cheaper to draw than the
        // procedural one's per-pixel scattering and clouds), turned so its sun
        // sits where the map's is.
        sky.material.dispose();
        sky.geometry.dispose();
        const k = (p.skyLight ?? 4) / photo.irradiance;
        const turn = (photo.sun.azimuth - p.sun.azimuth) / 360;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), photoSkyMaterial(photo, new THREE.Color(k, k, k), turn, 1e4));
        mesh.scale.setScalar(1000);
        mesh.frustumCulled = false;
        mesh.renderOrder = SKY_ORDER;
        scene.add(mesh);
        this.photoSky = mesh;
      } else {
        sky.renderOrder = SKY_ORDER;
        scene.add(sky);
        this.sky = sky;
      }
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

  /**
   * Keeps the shadow frustum around the viewer. Only static scenery casts
   * shadows (soldiers and vehicles use blobs / none), so the map only needs
   * redrawing when the frustum moves: it re-centres in steps of a quarter of
   * its reach (snapped to texels), not every frame. Returns true when it moved.
   */
  update(focus: THREE.Vector3, time: number): boolean {
    if (this.sky) this.sky.material.uniforms.time!.value = time;
    if (!this.sun || this.staticShadows) return false;
    const step = Math.max(this.texel, Math.round((this.opts.shadowExtent * 0.25) / this.texel) * this.texel);
    const fx = Math.round(focus.x / step) * step;
    const fz = Math.round(focus.z / step) * step;
    if (fx === this.sun.target.position.x && fz === this.sun.target.position.z) return false;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunDir.x * 200, this.sunDir.y * 200, fz + this.sunDir.z * 200);
    return true;
  }
}
