import * as THREE from 'three';

/**
 * Color grade folded into tone mapping (ACES + saturation, contrast, warm tint),
 * so it costs nothing extra: every material applies it in its own fragment
 * shader, and the post chain's OutputPass applies it once. A separate grade
 * pass was a full-screen read + write per frame, which integrated GPUs feel.
 *
 * Must run before the first shader compiles.
 */
export function installGradeToneMapping(): void {
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  const stub = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  if (!chunk.includes(stub)) return;
  THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(
    stub,
    /* glsl */ `vec3 CustomToneMapping( vec3 color ) {
	vec3 c = ACESFilmicToneMapping( color );
	// Grade in (approximate) display space, as it was tuned there.
	c = pow( max( c, 0.0 ), vec3( 1.0 / 2.2 ) );
	float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	c = mix( vec3( l ), c, 1.08 );
	c = ( c - 0.5 ) * 1.06 + 0.5;
	c *= vec3( 1.02, 1.0, 0.97 );
	return pow( clamp( c, 0.0, 1.0 ), vec3( 2.2 ) );
}`,
  );
}
