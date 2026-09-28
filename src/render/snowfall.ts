import * as THREE from 'three';
import { makeRng } from './noise';
import { LAYER_FX } from './layers';

/** Size of the box of flakes that travels with the camera (m). */
const BOX = new THREE.Vector3(56, 24, 56);

/**
 * Falling snow around the camera. Flakes live in a box that wraps around the
 * camera position, so a few thousand points look like snow everywhere; all
 * motion (fall, drift, sway) happens in the vertex shader: no per-frame CPU.
 */
export class Snowfall {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  constructor(count: number) {
    const rng = makeRng(17);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rng();
      pos[i * 3 + 1] = rng();
      pos[i * 3 + 2] = rng();
      seed[i] = rng();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uBox: { value: BOX.clone() },
        uWind: { value: new THREE.Vector2(0.6, 0.25) },
        uScale: { value: 300 },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform vec3 uCam;
        uniform vec3 uBox;
        uniform vec2 uWind;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          // Each flake falls at its own pace (0.7..1.4 m/s) and sways a little.
          float fall = 0.7 + aSeed * 0.7;
          vec3 p = position * uBox;
          p.y -= uTime * fall;
          p.xz += uWind * uTime * (0.6 + aSeed * 0.8);
          p.x += sin(uTime * (0.8 + aSeed) + aSeed * 40.0) * 0.35;
          p.z += cos(uTime * (0.7 + aSeed * 0.9) + aSeed * 23.0) * 0.35;
          // Wrap into a box centred on the camera.
          vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
          vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          gl_PointSize = clamp(uScale * (0.06 + aSeed * 0.05) / max(dist, 0.5), 1.5, 9.0);
          // Fade near the box edges (no popping) and right at the lens.
          vec3 edge = abs(rel) / (uBox * 0.5);
          vAlpha = (1.0 - smoothstep(0.75, 1.0, max(edge.x, max(edge.y, edge.z)))) * smoothstep(0.3, 1.2, dist);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.15, length(c)) * vAlpha * 0.85;
          if (a < 0.02) discard;
          gl_FragColor = vec4(0.95, 0.97, 1.0, a);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.layers.set(LAYER_FX);
    this.points.name = 'snowfall';
  }

  /** `pixelHeight` is the canvas height in pixels (flake size scales with it). */
  update(camera: THREE.Vector3, time: number, pixelHeight: number): void {
    const u = this.material.uniforms;
    u.uTime!.value = time;
    u.uCam!.value.copy(camera);
    u.uScale!.value = pixelHeight * 0.45;
  }
}
