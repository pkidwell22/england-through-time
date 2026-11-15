import * as THREE from "three";
import { MIST_COLOR, MIST_PARAMS } from "../mist";

/**
 * Scene-wide atmosphere and sunlight terms, patched into three.js's shared shader chunks so that every
 * built-in material (and every material derived from one through onBeforeCompile: the life patch, the
 * terrain splat, the tree and wrap layers…) receives them without being edited:
 *
 *  - aerial perspective (replaces exponential fog): extinction integrated along the view ray through two
 *    exponential height layers (a kilometre-scale aerosol layer and a few-tens-of-metres valley/river haze),
 *    with per-channel extinction and in-scatter whose colour comes from the sky's own horizon, brighter and
 *    warmer towards the sun, plus a forward-scattering glow around a low sun;
 *  - the dated ground mist of ./mist.ts, unchanged, applied after it;
 *  - cloud shadows: a tiling cloud-density texture projected along the sun direction from a cloud deck,
 *    drifting with the wind, multiplied into the sun's direct light only;
 *  - cascaded sun shadows: when the scene has two or more shadow-casting directional lights they are taken
 *    to be cascades of one sun (see ./shadows.ts). Each fragment uses the finest cascade that contains it,
 *    blended across cascade borders, and the sun's light is applied once (light 0 carries its colour).
 *
 * All parameters live in one shared Float32Array (`LOOK_A`), referenced, not copied, by every material, so
 * one write updates the whole scene. With the array zeroed every term switches off and the output is
 * three.js's own fog and lighting.
 *
 * Custom ShaderMaterials (smoke, fire, wakes) opt in with `applyLookFog(material)`.
 */

/**
 * LOOK_A, ten vec4s:
 *  0 sun direction (world, towards the sun) xyz, w unused
 *  1 aerosol layer: density per metre at the base, base height, scale height, w = 1 to enable aerial perspective
 *  2 haze layer:    density per metre at the base, base height, scale height,
 *    w (with 3.w and 5.w) = in-scatter colour looking down (the mean sky radiance: haze seen from above is blue)
 *  3 in-scatter colour looking away from the sun (linear, scene units)
 *  4 in-scatter colour looking towards the sun, w = sharpness of the azimuthal lobe
 *  5 per-channel extinction multipliers, w unused
 *  6 forward-scattering sun glow colour, w = Henyey-Greenstein g
 *  7 clouds: 1 / tile size (m), coverage threshold, edge softness, shadow strength
 *  8 clouds: drift offset x, z (m), deck height (m), w = 1 to enable cloud shadows
 *  9 light falling on unlit effects (smoke, foam): rgb, w = tide-line height (m, 0 = none)
 */
export const LOOK_A = new Float32Array(40);
// read-only handle for tests and look development
if (typeof window !== "undefined") (window as unknown as { __ltLookA?: Float32Array }).__ltLookA = LOOK_A;

/**
 * Sky and ground irradiance (scene units, rgb + unused) for materials without image-based lighting (Lambert,
 * Phong: three.js applies the environment map's irradiance only to physical materials). Applied like a
 * hemisphere light. Zero = off. Kept apart from LOOK_A, whose size other renderers rely on.
 */
export const LOOK_HEMI = new Float32Array(8);

let cloudTex: THREE.DataTexture | null = null;

/** Tiling cloud-density field (periodic value-noise fBm), shared by every material. */
export function cloudTexture(): THREE.DataTexture {
  if (cloudTex) return cloudTex;
  const S = 256;
  const data = new Uint8Array(S * S);
  const hash = (x: number, y: number, s: number) => {
    let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const noise = (x: number, y: number, p: number, s: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const h = (i: number, j: number) => hash(((i % p) + p) % p, ((j % p) + p) % p, s);
    return h(xi, yi) * (1 - u) * (1 - v) + h(xi + 1, yi) * u * (1 - v) + h(xi, yi + 1) * (1 - u) * v + h(xi + 1, yi + 1) * u * v;
  };
  const vals = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let a = 0.5, f = 4, sum = 0, norm = 0;
      for (let o = 0; o < 6; o++) {
        sum += a * noise((x / S) * f, (y / S) * f, f, o + 1);
        norm += a;
        a *= 0.5;
        f *= 2;
      }
      vals[y * S + x] = sum / norm;
    }
  // stretch to the full 0..1 range so a coverage fraction maps to a threshold by its quantile
  let lo = 1, hi = 0;
  for (const v of vals) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let i = 0; i < vals.length; i++) data[i] = Math.round(((vals[i] - lo) / (hi - lo)) * 255);
  const t = new THREE.DataTexture(data, S, S, THREE.RedFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  // three.js clones texture uniforms per material: hand back the one shared texture instead
  t.clone = (() => t) as unknown as typeof t.clone;
  const sorted = Array.from(data).sort((a, b) => a - b);
  t.userData.quantile = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))] / 255;
  cloudTex = t;
  return t;
}

/** Threshold of the cloud field above which a fraction `coverage` of the sky is cloud. */
export function cloudThreshold(coverage: number): number {
  const t = cloudTexture();
  return (t.userData.quantile as (q: number) => number)(1 - THREE.MathUtils.clamp(coverage, 0, 1));
}

const PARS = /* glsl */ `
#ifndef LT_ATMO_PARS
#define LT_ATMO_PARS
uniform vec4 ltA[ 10 ];
uniform vec4 ltHemi[ 2 ];
uniform sampler2D ltCloudTex;
float ltLayer( float L, float y0, float y1, vec3 p ) {
	// optical depth of an exponential layer (density p.x at height p.y, scale height p.z) along a ray of length L
	float a = max( ( y0 - p.y ) / p.z, -1.5 );
	float b = max( ( y1 - p.y ) / p.z, -1.5 );
	float k = abs( b - a ) > 1e-3 ? ( exp( - a ) - exp( - b ) ) / ( b - a ) : exp( - a );
	return p.x * L * k;
}
vec3 ltAerial( vec3 col, vec3 off ) {
	float d = length( off );
	if ( d < 1e-3 ) return col;
	vec3 dir = off / d;
	// heights along the light path: abs() makes the water's mirror image (camera below y = 0) see the same
	// air as the real camera above it
	float y0 = abs( cameraPosition.y );
	float y1 = abs( cameraPosition.y + off.y );
	// aerosol (kilometre-scale layer) and low haze: nearly grey extinction
	vec3 tauM = ( ltLayer( d, y0, y1, ltA[ 1 ].xyz ) + ltLayer( d, y0, y1, ltA[ 2 ].xyz ) ) * ltA[ 5 ].rgb;
	// molecular (Rayleigh) scattering: sea-level coefficients per metre, 8 km scale height. Physical constants,
	// not a look parameter: it is what turns distant land blue whatever the weather
	vec3 tauR = ltLayer( d, y0, y1, vec3( 1.0, 0.0, 8000.0 ) ) * vec3( 5.8e-6, 13.5e-6, 33.1e-6 );
	vec3 tau = tauM + tauR;
	vec3 T = exp( - tau );
	vec2 hz = dir.xz / max( 1e-4, length( dir.xz ) );
	vec2 sz = ltA[ 0 ].xz / max( 1e-4, length( ltA[ 0 ].xz ) );
	float lobe = pow( clamp( dot( hz, sz ) * 0.5 + 0.5, 0.0, 1.0 ), ltA[ 4 ].w );
	// looking down through a thin layer, the haze scatters sunlight sideways or backwards, where the aerosol
	// phase function is several times weaker than forwards: its radiance is well under the mean sky's
	vec3 downSky = vec3( ltA[ 2 ].w, ltA[ 3 ].w, ltA[ 5 ].w );
	vec3 down = downSky * 0.6;
	// Far land must converge to the photographed horizon band itself, or it stands brighter than the sky above it
	// like a wall. ./rig.ts stores the away-from-sun band lifted 35 % towards 1.1 / pi x sky irradiance
	// (= downSky x 1.1 / 0.95); undo that lift here (keep this in step with writeAtmosphere)
	vec3 awayBand = max( ( ltA[ 3 ].rgb - 0.35 * 1.1579 * downSky ) / 0.65, ltA[ 3 ].rgb * 0.5 );
	vec3 insM = mix( awayBand, ltA[ 4 ].rgb, lobe );
	insM = mix( insM, down, clamp( - dir.y * 1.4, 0.0, 0.65 ) );
	float g = ltA[ 6 ].w;
	float mu = dot( dir, ltA[ 0 ].xyz );
	float hg = ( 1.0 - g * g ) / pow( max( 1e-4, 1.0 + g * g - 2.0 * g * mu ), 1.5 ) * 0.0795775;
	// everything far enough away tends to the photographed horizon (or, looking down, to the mean sky); the blue
	// channel gets there first because the molecules take out more blue, which is the blue shift of distance.
	// Only the aerosol share of the in-scatter carries the forward glow round the sun.
	vec3 ins = insM + ltA[ 6 ].rgb * hg * ( tauM / max( tau, vec3( 1e-6 ) ) );
	return col * T + ins * ( 1.0 - T );
}
float ltCloudShadow( vec3 wp ) {
	if ( ltA[ 8 ].w < 0.5 ) return 1.0;
	vec2 p = wp.xz + ltA[ 0 ].xz / max( ltA[ 0 ].y, 0.08 ) * ( ltA[ 8 ].z - wp.y );
	float c = texture2D( ltCloudTex, ( p + ltA[ 8 ].xy ) * ltA[ 7 ].x ).r;
	float c2 = texture2D( ltCloudTex, ( p + ltA[ 8 ].xy * 1.3 ) * ltA[ 7 ].x * 3.7 + 0.31 ).r;
	// the finer octave frays the edges; the shadow deepens gradually inward (a cloud is thin at its margin),
	// so it reads as a soft-edged patch rather than a cut-out
	c = c * 0.72 + c2 * 0.28;
	float th = ltA[ 7 ].y, s = ltA[ 7 ].z;
	float k = smoothstep( th - s * 0.6, th + s * 1.8, c );
	return 1.0 - ltA[ 7 ].w * k * ( 0.55 + 0.45 * k );
}
#endif
`;

const MIST_BLOCK = /* glsl */ `
	if ( mistParams.x > 0.0 ) {
		// optical depth along the ray through a layer: constant below the base, exp(-h / H) above it
		float mistL = length( vMistOff );
		float mistY0 = cameraPosition.y - mistParams.y;
		float mistY1 = mistY0 + vMistOff.y;
		float mistLo = min( mistY0, mistY1 );
		float mistHi = max( mistY0, mistY1 );
		float mistH = mistParams.z;
		float mistBelow = mistHi - mistLo < 0.05 ? step( mistLo, 0.0 ) : clamp( - mistLo / ( mistHi - mistLo ), 0.0, 1.0 );
		float mistA = max( mistLo, 0.0 );
		float mistDa = mistHi - mistA;
		float mistAbove = mistDa > 0.05
			? mistH / mistDa * ( exp( - mistA / mistH ) - exp( - mistHi / mistH ) )
			: exp( - mistA / mistH );
		float mistTau = mistL * ( mistBelow + ( 1.0 - mistBelow ) * mistAbove );
		// the layer is patchy: thicker in some places than others (drifting slowly with the cloud field's wind),
		// so seen from above it is not one even sheet
		vec2 mistXZ = cameraPosition.xz + vMistOff.xz;
		float mistPatch = texture2D( ltCloudTex, ( mistXZ + ltA[ 8 ].xy * 0.08 ) / 1300.0 + 0.53 ).r;
		mistTau *= 0.45 + 1.1 * mistPatch;
		float mistF = 1.0 - exp( - mistParams.x * mistTau );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, mistColor, mistF * mistParams.w );
	}`;

const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	if ( ltA[ 1 ].w > 0.5 ) {
		gl_FragColor.rgb = ltAerial( gl_FragColor.rgb, vMistOff );
	} else {
		#ifdef FOG_EXP2
			float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
		#else
			float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
		#endif
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
	}
${MIST_BLOCK}
#endif
`;

// world position, and the tide line: surfaces just above high water (y = 0) are wet, darker and glossier
const WET = /* glsl */ `
vec3 ltWp = cameraPosition + ( vec4( geometryPosition, 0.0 ) * viewMatrix ).xyz;
if ( ltA[ 9 ].w > 0.0 ) {
	float ltWet = ( 1.0 - smoothstep( 0.0, ltA[ 9 ].w, ltWp.y ) ) * step( -4.0, ltWp.y );
	material.diffuseColor *= 1.0 - 0.42 * ltWet;
	#ifdef STANDARD
	material.roughness = mix( material.roughness, 0.32, ltWet );
	#endif
}
`;

// sky/ground fill for materials that get no image-based light (see LOOK_HEMI)
const HEMI = /* glsl */ `
	#ifndef STANDARD
	{
		vec3 ltUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
		irradiance += mix( ltHemi[ 1 ].rgb, ltHemi[ 0 ].rgb, 0.5 * dot( geometryNormal, ltUp ) + 0.5 );
	}
	#endif
`;

const DIR_LIGHTS = /* glsl */ `
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )

	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	float ltSunVis = ltCloudShadow( ltWp );

	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1

		// cascades of one sun: the finest cascade containing the fragment, blended across borders
		float ltShadow = 0.0;
		float ltRemain = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			ltCascade( vDirectionalShadowCoord[ i ], directionalShadowMap[ i ], directionalLightShadows[ i ], ltShadow, ltRemain );
		}
		#pragma unroll_loop_end
		ltShadow += ltRemain;
		directionalLight = directionalLights[ 0 ];
		getDirectionalLightInfo( directionalLight, directLight );
		directLight.color *= ( ( directLight.visible && receiveShadow ) ? ltShadow : 1.0 ) * ltSunVis;
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

	#else

		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {

			directionalLight = directionalLights[ i ];

			getDirectionalLightInfo( directionalLight, directLight );
			directLight.color *= ltSunVis;

			#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
			directionalLightShadow = directionalLightShadows[ i ];
			directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
			#endif

			RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

		}
		#pragma unroll_loop_end

	#endif

#endif
`;

const CASCADE_FN = /* glsl */ `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1
void ltCascade( vec4 sc4, sampler2D map, DirectionalLightShadow s, inout float shadow, inout float remain ) {
	vec3 sc = sc4.xyz / sc4.w;
	vec2 e = min( sc.xy, 1.0 - sc.xy );
	float inside = smoothstep( 0.0, 0.07, min( e.x, e.y ) ) * step( sc.z, 1.0 ) * step( 0.0, sc.z );
	float w = inside * remain;
	if ( w > 0.001 ) shadow += w * getShadow( map, s.shadowMapSize, s.shadowIntensity, s.shadowBias, s.shadowRadius, sc4 );
	remain -= w;
}
#endif
`;

const W = globalThis as unknown as { __ltOrigChunks?: Record<string, string> };

/** Patch the shared chunks (idempotent; re-applied from the pristine chunks after a hot reload). */
export function installLookShaders(): void {
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  const names = ["fog_pars_vertex", "fog_vertex", "fog_pars_fragment", "fog_fragment", "lights_pars_begin", "lights_fragment_begin", "shadowmap_pars_fragment"];
  if (!W.__ltOrigChunks) {
    W.__ltOrigChunks = {};
    for (const n of names) W.__ltOrigChunks[n] = C[n];
  }
  const O = W.__ltOrigChunks;
  const extra = { ltA: { value: LOOK_A }, ltHemi: { value: LOOK_HEMI }, ltCloudTex: { value: cloudTexture() }, mistParams: { value: MIST_PARAMS }, mistColor: { value: MIST_COLOR } };
  Object.assign(THREE.UniformsLib.fog, extra);
  Object.assign(THREE.UniformsLib.lights, { ltA: extra.ltA, ltHemi: extra.ltHemi, ltCloudTex: extra.ltCloudTex });
  for (const lib of Object.values(THREE.ShaderLib) as { uniforms: Record<string, THREE.IUniform> }[]) {
    if (lib.uniforms && ("fogDensity" in lib.uniforms || "directionalLights" in lib.uniforms)) Object.assign(lib.uniforms, extra);
  }
  C.fog_pars_vertex = O.fog_pars_vertex.replace("varying float vFogDepth;", "varying float vFogDepth;\n\tvarying vec3 vMistOff;");
  C.fog_vertex = O.fog_vertex.replace("vFogDepth = - mvPosition.z;", "vFogDepth = - mvPosition.z;\n\tvMistOff = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;");
  C.fog_pars_fragment =
    PARS + O.fog_pars_fragment.replace("varying float vFogDepth;", "varying float vFogDepth;\n\tvarying vec3 vMistOff;\n\tuniform vec4 mistParams;\n\tuniform vec3 mistColor;");
  C.fog_fragment = FOG_FRAGMENT;
  C.lights_pars_begin = PARS + O.lights_pars_begin;
  C.shadowmap_pars_fragment = O.shadowmap_pars_fragment + CASCADE_FN;
  const lf = O.lights_fragment_begin;
  const a = lf.indexOf("#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )");
  const b = lf.indexOf("#if ( NUM_RECT_AREA_LIGHTS > 0 )");
  if (a < 0 || b < a) {
    console.warn("look: unexpected lights_fragment_begin; cascades and cloud shadows are off");
    C.lights_fragment_begin = lf;
  } else {
    const head = lf.slice(0, a);
    const vd = "vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );";
    const tail = lf.slice(b).replace("#if ( NUM_HEMI_LIGHTS > 0 )", HEMI + "\n\t#if ( NUM_HEMI_LIGHTS > 0 )");
    C.lights_fragment_begin = head.replace(vd, vd + WET) + DIR_LIGHTS + "\n" + tail;
  }
}

/**
 * Opt a custom ShaderMaterial into the aerial perspective and mist (and, with `lit`, into the light that falls
 * on unlit effects). The material's fragment shader must end with `#include <tonemapping_fragment>`, as
 * three.js's own and this project's effect shaders do; its vertex shader must set gl_Position.
 */
export function applyLookFog<T extends THREE.ShaderMaterial>(mat: T, opts: { lit?: boolean } = {}): T {
  const prev = mat.onBeforeCompile;
  const lit = !!opts.lit;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.ltA = { value: LOOK_A };
    shader.uniforms.ltHemi = { value: LOOK_HEMI };
    shader.uniforms.ltCloudTex = { value: cloudTexture() };
    shader.uniforms.mistParams = { value: MIST_PARAMS };
    shader.uniforms.mistColor = { value: MIST_COLOR };
    const vs = shader.vertexShader;
    const end = vs.lastIndexOf("}");
    shader.vertexShader =
      "varying vec3 vMistOff;\n" +
      vs.slice(0, end) +
      "\t{ vec4 ltV = inverse( projectionMatrix ) * gl_Position; vMistOff = transpose( mat3( viewMatrix ) ) * ( ltV.xyz / ltV.w ); }\n" +
      vs.slice(end);
    shader.fragmentShader =
      PARS +
      "varying vec3 vMistOff;\nuniform vec4 mistParams;\nuniform vec3 mistColor;\n" +
      shader.fragmentShader.replace(
        "#include <tonemapping_fragment>",
        (lit ? "gl_FragColor.rgb *= ltA[ 9 ].rgb;\n" : "") + "if ( ltA[ 1 ].w > 0.5 ) gl_FragColor.rgb = ltAerial( gl_FragColor.rgb, vMistOff );\n" + MIST_BLOCK + "\n#include <tonemapping_fragment>",
      );
  };
  return mat;
}
