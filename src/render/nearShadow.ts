import * as THREE from 'three';

/**
 * Near shadows (2026-10-31, owner: "why doesn't it look like BF / CoD?" —
 * soldiers and vehicles cast no shadows at all, and the one static shadow map
 * covers the whole map at 10-60 cm a texel). A second sun light with no light
 * of its own (black) carries a small shadow map round the camera, redrawn
 * every frame with everything in it, soldiers, vehicles and grenades too; the
 * real sun's shadow is multiplied by it. So the static map keeps the far
 * shadows and is only redrawn when the scenery changes, and up close shadows
 * are crisp (a few cm a texel) and move.
 *
 * The near map holds only what moves (soldiers, vehicles, grenades): the
 * static map already has the scenery, and redrawing the scenery round the
 * camera twice a frame was most of the cost (0.4 ms a view on a GTX 1660 Ti).
 *
 * The pairing is by order: the scene's first shadow-casting directional light
 * is the sun, the second the near light (Atmosphere adds them in that order;
 * three keeps the order of lights that cast shadows and have no map).
 */
export function installNearShadow(): void {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const line =
    'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
  if (!chunk.includes(line) || chunk.includes('NEAR_SUN_SHADOW')) return;
  THREE.ShaderChunk.lights_fragment_begin = chunk.replace(
    line,
    /* glsl */ `// NEAR_SUN_SHADOW: the sun (light 0) also takes the near map's shadow; light 1 is black, no lookup.
		#if ( UNROLLED_LOOP_INDEX == 0 ) && ( NUM_DIR_LIGHT_SHADOWS > 1 )
		if ( directLight.visible && receiveShadow ) {
			directLight.color *= getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] );
			directLight.color *= getShadow( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ].shadowMapSize, directionalLightShadows[ 1 ].shadowIntensity, directionalLightShadows[ 1 ].shadowBias, directionalLightShadows[ 1 ].shadowRadius, vDirectionalShadowCoord[ 1 ] );
		}
		#elif ( UNROLLED_LOOP_INDEX == 1 )
		directLight.visible = false;
		#else
		${line}
		#endif`,
  );
}

/**
 * Which casters each shadow pass sees. With a near map (high / medium), static
 * scenery casts only while the static map is redrawn (rare: at the start and
 * when fortifications change): between those, its `castShadow` stays off, so
 * the near map (redrawn every other frame) sees only what moves without any
 * per-frame walk over the scene (that walk cost ~0.27 ms CPU). Moving casters
 * stay out of a static redraw. Without a near map nothing is switched.
 */
export function drawShadowPass(scene: THREE.Object3D, staticRedraw: boolean, nearMap: boolean, draw: () => void): void {
  if (!staticRedraw) {
    draw();
    return;
  }
  const statics: THREE.Object3D[] = [];
  const moving: THREE.Object3D[] = [];
  scene.traverse((o) => {
    // Meshes, lines and points only: a light's castShadow is whether it has a shadow map at all.
    const r = o as THREE.Mesh & { isLine?: boolean; isPoints?: boolean };
    if (!r.isMesh && !r.isLine && !r.isPoints) return;
    if (o.userData.dynShadow) {
      if (o.castShadow) moving.push(o);
    } else if (o.castShadow || o.userData.staticCaster) statics.push(o);
  });
  for (const o of statics) {
    o.castShadow = true;
    o.userData.staticCaster = true;
  }
  for (const o of moving) o.castShadow = false;
  try {
    draw();
  } finally {
    for (const o of moving) o.castShadow = true;
    if (nearMap) for (const o of statics) o.castShadow = false;
  }
}

/** Marks a mesh (or every mesh under an object) as moving: it casts into the near shadow map only. */
export function castsMovingShadow(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.userData.dynShadow = true;
    }
  });
}
