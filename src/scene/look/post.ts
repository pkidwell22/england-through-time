import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";

/**
 * The camera: everything between the linear HDR scene and the screen.
 *
 *   beauty (linear HDR, MSAA and/or jittered for TAA, with depth)
 *     -> temporal anti-aliasing (reprojection from depth, neighbourhood clipping in YCoCg)
 *     -> ambient occlusion (GTAO, from the beauty depth) applied with less weight in bright, sunlit pixels
 *     -> bloom (13-tap downsample / tent upsample chain, energy-conserving mix: lens and veiling glare)
 *     -> sun shafts (radial blur of the visible sky towards a low sun)
 *     -> depth of field (thin-lens circle of confusion for the camera's real field of view; eye level only)
 *     -> exposure, white balance, saturation, filmic tone mapping (AgX by default), lift/gamma/gain,
 *        natural vignetting, film grain, dithering -> screen
 */

export type ToneMap = "agx" | "neutral" | "aces";

export interface PostTier {
  msaa: number;
  taa: boolean;
  /** Ambient-occlusion resolution scale (0 = off). */
  ao: number;
  aoSamples: number;
  bloomMips: number;
  shafts: boolean;
  dof: boolean;
}

export interface Grade {
  exposure: number;
  white: THREE.Color;
  saturation: number;
  lift: THREE.Vector3;
  gamma: THREE.Vector3;
  gain: THREE.Vector3;
  bloom: number;
  vignette: number;
  grain: number;
  aoStrength: number;
  tonemap: ToneMap;
  /** AgX look: power (mid-tone contrast) and saturation, applied in AgX's log space. */
  look: [number, number];
  /** Auto-exposure strength 0..1 (fraction of the way from the meter to the scene average). */
  autoExposure: number;
}

export interface FrameOpts {
  /** Sun direction (world, towards the sun) for the shafts; null = no shafts this frame. */
  sunDir: THREE.Vector3 | null;
  sunShafts: number;
  /** Depth of field: focus distance in metres, f-number; null = off. */
  dof: { focus: number; fstop: number } | null;
}

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

const HALTON = (i: number, b: number) => {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
};

function rt(w: number, h: number, opts: THREE.RenderTargetOptions = {}): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, ...opts,
  });
}

const TAA_FRAG = /* glsl */ `
uniform sampler2D tCur, tDepth, tHist;
uniform mat4 uInvVP, uPrevVP;
uniform vec2 uTexel;
uniform float uReset;
varying vec2 vUv;
vec3 toY( vec3 c ) { return vec3( 0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b ); }
vec3 fromY( vec3 y ) { return vec3( y.x + y.y - y.z, y.x + y.z, y.x - y.y - y.z ); }
// compress HDR before filtering so a few very bright pixels do not dominate (Karis)
vec3 tm( vec3 c ) { return c / ( 1.0 + max( c.r, max( c.g, c.b ) ) ); }
vec3 itm( vec3 c ) { return c / max( 1e-4, 1.0 - max( c.r, max( c.g, c.b ) ) ); }
vec3 sampleHist( vec2 uv ) {
	// 5-tap Catmull-Rom: sharper than bilinear, so repeated reprojection does not blur the image
	vec2 sp = uv / uTexel; vec2 tc = floor( sp - 0.5 ) + 0.5; vec2 f = sp - tc;
	vec2 w0 = f * ( -0.5 + f * ( 1.0 - 0.5 * f ) ), w1 = 1.0 + f * f * ( -2.5 + 1.5 * f ), w2 = f * ( 0.5 + f * ( 2.0 - 1.5 * f ) ), w3 = f * f * ( -0.5 + 0.5 * f );
	vec2 w12 = w1 + w2; vec2 tc0 = ( tc - 1.0 ) * uTexel, tc3 = ( tc + 2.0 ) * uTexel, tc12 = ( tc + w2 / w12 ) * uTexel;
	vec3 r = texture2D( tHist, vec2( tc12.x, tc0.y ) ).rgb * ( w12.x * w0.y )
		+ texture2D( tHist, vec2( tc0.x, tc12.y ) ).rgb * ( w0.x * w12.y )
		+ texture2D( tHist, tc12 ).rgb * ( w12.x * w12.y )
		+ texture2D( tHist, vec2( tc3.x, tc12.y ) ).rgb * ( w3.x * w12.y )
		+ texture2D( tHist, vec2( tc12.x, tc3.y ) ).rgb * ( w12.x * w3.y );
	float ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
	return max( r / ws, 0.0 );
}
void main() {
	vec3 c = tm( texture2D( tCur, vUv ).rgb );
	if ( uReset > 0.5 ) { gl_FragColor = vec4( itm( c ), 1.0 ); return; }
	// neighbourhood statistics and the nearest depth (so edges reproject with the foreground)
	vec3 m1 = vec3( 0.0 ), m2 = vec3( 0.0 );
	float dMin = 1.0;
	for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
		vec2 o = vec2( float( x ), float( y ) ) * uTexel;
		vec3 s = toY( tm( texture2D( tCur, vUv + o ).rgb ) );
		m1 += s; m2 += s * s;
		dMin = min( dMin, texture2D( tDepth, vUv + o ).x );
	}
	m1 /= 9.0; m2 /= 9.0;
	vec3 sig = sqrt( max( m2 - m1 * m1, 0.0 ) );
	vec4 wp = uInvVP * vec4( vUv * 2.0 - 1.0, dMin * 2.0 - 1.0, 1.0 );
	wp /= wp.w;
	vec4 pc = uPrevVP * wp;
	vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
	vec2 motion = ( vUv - puv ) / uTexel;
	bool off = any( lessThan( puv, vec2( 0.0 ) ) ) || any( greaterThan( puv, vec2( 1.0 ) ) );
	vec3 h = toY( tm( sampleHist( puv ) ) );
	// variance clipping (tighter while the camera moves), intersected with the min/max box: tight enough that
	// people and boats moving over a static background leave no trail (there are no motion vectors)
	float g = mix( 1.0, 0.75, clamp( length( motion ) / 8.0, 0.0, 1.0 ) );
	vec3 lo = m1 - g * sig, hi = m1 + g * sig;
	vec3 cy = toY( c );
	lo = min( lo, cy ); hi = max( hi, cy );
	vec3 p = h - m1; vec3 e = ( hi - lo ) * 0.5 + 1e-5;
	vec3 u = abs( p / e ); float mx = max( u.x, max( u.y, u.z ) );
	if ( mx > 1.0 ) h = m1 + p / mx;
	// how far the history had to be pulled in says how stale it is: blend faster then
	float a = off ? 1.0 : mix( 0.1, 0.3, clamp( length( motion ) / 12.0, 0.0, 1.0 ) );
	a = mix( a, 0.5, clamp( ( mx - 1.0 ) * 2.0, 0.0, 1.0 ) );
	vec3 r = mix( h, cy, a );
	gl_FragColor = vec4( itm( fromY( r ) ), 1.0 );
}`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uKaris;
varying vec2 vUv;
vec3 s( vec2 o ) { return texture2D( tSrc, vUv + o * uTexel ).rgb; }
float kw( vec3 c ) { return 1.0 / ( 1.0 + dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) ); }
void main() {
	vec3 a = s( vec2( -2, 2 ) ), b = s( vec2( 0, 2 ) ), c = s( vec2( 2, 2 ) );
	vec3 d = s( vec2( -2, 0 ) ), e = s( vec2( 0, 0 ) ), f = s( vec2( 2, 0 ) );
	vec3 g = s( vec2( -2, -2 ) ), h = s( vec2( 0, -2 ) ), i = s( vec2( 2, -2 ) );
	vec3 j = s( vec2( -1, 1 ) ), k = s( vec2( 1, 1 ) ), l = s( vec2( -1, -1 ) ), m = s( vec2( 1, -1 ) );
	vec3 r;
	if ( uKaris > 0.5 ) {
		// partial Karis averages on the first level: no single firefly can make a bloom blob
		vec3 g0 = ( a + b + d + e ) * 0.25, g1 = ( b + c + e + f ) * 0.25, g2 = ( d + e + g + h ) * 0.25, g3 = ( e + f + h + i ) * 0.25, g4 = ( j + k + l + m ) * 0.25;
		float w0 = kw( g0 ) * 0.125, w1 = kw( g1 ) * 0.125, w2 = kw( g2 ) * 0.125, w3 = kw( g3 ) * 0.125, w4 = kw( g4 ) * 0.5;
		r = ( g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4 ) / ( w0 + w1 + w2 + w3 + w4 );
	} else {
		r = e * 0.125 + ( a + c + g + i ) * 0.03125 + ( b + d + f + h ) * 0.0625 + ( j + k + l + m ) * 0.125;
	}
	gl_FragColor = vec4( max( r, 0.0 ), 1.0 );
}`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tLow, tHigh; uniform vec2 uTexel; uniform float uRadius;
varying vec2 vUv;
void main() {
	vec2 o = uTexel * uRadius;
	vec3 r = texture2D( tLow, vUv ).rgb * 4.0
		+ ( texture2D( tLow, vUv + vec2( o.x, 0.0 ) ).rgb + texture2D( tLow, vUv - vec2( o.x, 0.0 ) ).rgb + texture2D( tLow, vUv + vec2( 0.0, o.y ) ).rgb + texture2D( tLow, vUv - vec2( 0.0, o.y ) ).rgb ) * 2.0
		+ texture2D( tLow, vUv + o ).rgb + texture2D( tLow, vUv - o ).rgb + texture2D( tLow, vUv + vec2( o.x, -o.y ) ).rgb + texture2D( tLow, vUv + vec2( -o.x, o.y ) ).rgb;
	gl_FragColor = vec4( texture2D( tHigh, vUv ).rgb + r / 16.0, 1.0 );
}`;

const SHAFT_MASK_FRAG = /* glsl */ `
uniform sampler2D tColor, tDepth; uniform vec2 uSun; uniform float uAspect;
varying vec2 vUv;
void main() {
	float sky = step( 0.99999, texture2D( tDepth, vUv ).x );
	vec3 c = min( texture2D( tColor, vUv ).rgb, vec3( 6.0 ) );
	vec2 d = ( vUv - uSun ) * vec2( uAspect, 1.0 );
	float fall = exp( - dot( d, d ) * 5.0 );
	gl_FragColor = vec4( c * sky * fall, 1.0 );
}`;

const SHAFT_BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uSun; uniform float uStep;
varying vec2 vUv;
void main() {
	vec2 d = ( uSun - vUv ) * uStep / 10.0;
	vec2 p = vUv;
	vec3 r = vec3( 0.0 ); float w = 1.0, ws = 0.0;
	for ( int i = 0; i < 10; i ++ ) { r += texture2D( tSrc, p ).rgb * w; ws += w; w *= 0.93; p += d; }
	gl_FragColor = vec4( r / ws, 1.0 );
}`;

const DOF_FRAG = /* glsl */ `
uniform sampler2D tColor, tDepth; uniform vec2 uTexel; uniform vec4 uLens; // focus (m), aperture*focal/(sensor) in px*m, near, far
varying vec2 vUv;
float viewZ( float d ) { float n = uLens.z, f = uLens.w; return 2.0 * n * f / ( f + n - ( d * 2.0 - 1.0 ) * ( f - n ) ); }
float coc( float d ) { float z = viewZ( d ); return clamp( uLens.y * abs( z - uLens.x ) / ( z * max( uLens.x, 0.1 ) ), 0.0, 14.0 ); }
void main() {
	float c0 = coc( texture2D( tDepth, vUv ).x );
	vec3 acc = vec3( 0.0 ); float ws = 0.0;
	// golden-angle disc; a sample spreads onto this pixel only as far as its own blur reaches
	for ( int i = 0; i < 28; i ++ ) {
		float fi = float( i ) + 0.5;
		float r = sqrt( fi / 28.0 ) * 14.0;
		float a = fi * 2.39996;
		vec2 o = vec2( cos( a ), sin( a ) ) * r;
		vec2 uv = vUv + o * uTexel;
		float cs = coc( texture2D( tDepth, uv ).x );
		float w = smoothstep( r - 1.0, r + 0.5, min( cs, c0 + 2.0 ) ) + ( i == 0 ? 1.0 : 0.0 );
		acc += texture2D( tColor, uv ).rgb * w; ws += w;
	}
	gl_FragColor = vec4( acc / max( ws, 1e-4 ), c0 );
}`;

const EXPO_FRAG = /* glsl */ `
uniform sampler2D tSrc, tPrev; uniform float uDt, uReset, uE0, uStrength, uRange;
varying vec2 vUv;
void main() {
	// centre- and bottom-weighted average log luminance, as a camera's matrix meter: the sky counts for less
	float s = 0.0, ws = 0.0;
	for ( int y = 0; y < 9; y ++ ) for ( int x = 0; x < 16; x ++ ) {
		vec2 uv = ( vec2( float( x ), float( y ) ) + 0.5 ) / vec2( 16.0, 9.0 );
		float l = dot( texture2D( tSrc, uv ).rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
		l = clamp( l * uE0, 1e-4, 1.5 );
		vec2 c = uv - vec2( 0.5, 0.45 );
		float w = mix( 1.4, 0.5, uv.y ) * ( 1.0 - 0.6 * dot( c, c ) );
		s += log( l ) * w; ws += w;
	}
	float avg = exp( s / ws );
	float target = clamp( log( 0.18 / avg ) * uStrength, - uRange, uRange );
	float prev = texture2D( tPrev, vec2( 0.5 ) ).r;
	float v = uReset > 0.5 ? target : mix( prev, target, 1.0 - exp( - uDt * 1.6 ) );
	gl_FragColor = vec4( v, 0.0, 0.0, 1.0 );
}`;

const FINAL_FRAG = /* glsl */ `
#include <common>
TONEMAP_PARS
uniform sampler2D tColor, tAO, tBloom, tShafts, tDof, tDepth, tAdapt;
uniform float uHasAdapt;
uniform vec2 uNearFar;
uniform float uHasAO, uHasBloom, uHasShafts, uHasDof;
uniform float uExposure, uAOStrength, uBloom, uShafts, uSat, uVignette, uGrain, uTime;
uniform vec3 uWhite, uLift, uGamma, uGain;
uniform vec2 uRes;
uniform int uTone;
varying vec2 vUv;
uniform vec2 uLook; // AgX look in log space: power (contrast), saturation
float h12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
// three.js's AgX (Filament / Blender), with Blender's look stage put back: a little more mid-tone contrast
// and saturation than the bare base transform, which is deliberately flat
vec3 agxLook( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3( vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ), vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ), vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 ) );
	const mat3 AgXOutsetMatrix = mat3( vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ), vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ), vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 ) );
	const float AgxMinEv = - 12.47393;
	const float AgxMaxEv = 4.026069;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );
	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = pow( max( color, 0.0 ), vec3( uLook.x ) );
	float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
	color = luma + uLook.y * ( color - luma );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	return clamp( color, 0.0, 1.0 );
}
vec3 oetf( vec3 c ) { return mix( c * 12.92, 1.055 * pow( c, vec3( 0.41666 ) ) - 0.055, step( 0.0031308, c ) ); }
void main() {
	vec3 c = texture2D( tColor, vUv ).rgb;
	if ( uHasDof > 0.5 ) {
		vec4 b = texture2D( tDof, vUv );
		c = mix( c, b.rgb, smoothstep( 0.6, 2.5, b.a ) );
	}
	float l0 = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) * uExposure;
	if ( uHasAO > 0.5 ) {
		// occlusion darkens ambient light; a sunlit (bright) pixel is mostly direct light, so it is darkened less
		// screen-space occlusion is only trusted near the camera: far away its samples span whole buildings and fields
		float d = texture2D( tDepth, vUv ).x;
		float n = uNearFar.x, fr = uNearFar.y;
		float z = 2.0 * n * fr / ( fr + n - ( d * 2.0 - 1.0 ) * ( fr - n ) );
		float ao = texture2D( tAO, vUv ).r;
		c *= mix( 1.0, ao, uAOStrength * ( 1.0 - 0.55 * smoothstep( 0.25, 1.6, l0 ) ) * ( 1.0 - smoothstep( 120.0, 450.0, z ) ) );
	}
	if ( uHasBloom > 0.5 ) c = mix( c, texture2D( tBloom, vUv ).rgb, uBloom );
	if ( uHasShafts > 0.5 ) c += texture2D( tShafts, vUv ).rgb * uShafts;
	c *= uExposure * ( uHasAdapt > 0.5 ? exp( texture2D( tAdapt, vec2( 0.5 ) ).r ) : 1.0 ) * uWhite;
	float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	c = max( mix( vec3( l ), c, uSat ), 0.0 );
	if ( uTone == 1 ) c = NeutralToneMapping( c );
	else if ( uTone == 2 ) c = ACESFilmicToneMapping( c );
	else c = agxLook( c );
	c = oetf( clamp( c, 0.0, 1.0 ) );
	c = pow( max( c * uGain + uLift * ( 1.0 - c ), 0.0 ), 1.0 / uGamma );
	// natural (cos^4-like) vignetting
	vec2 p = ( vUv - 0.5 ) * vec2( uRes.x / uRes.y, 1.0 );
	c *= 1.0 - uVignette * smoothstep( 0.2, 1.1, dot( p, p ) * 1.6 );
	// grain: strongest in the mid-tones, as in film
	float gl = dot( c, vec3( 0.333 ) );
	float n = h12( vUv * uRes + fract( uTime ) * 917.0 ) + h12( vUv * uRes * 0.5 + fract( uTime * 1.37 ) * 513.0 ) - 1.0;
	c += n * uGrain * ( 0.35 + 2.6 * gl * ( 1.0 - gl ) );
	c += ( h12( vUv * uRes + 0.5 ) - 0.5 ) / 255.0;
	gl_FragColor = vec4( c, 1.0 );
}`;

export class LookPost {
  private tier: PostTier | null = null;
  private w = 1;
  private h = 1;
  beauty: THREE.WebGLRenderTarget | null = null;
  private hist: THREE.WebGLRenderTarget[] = [];
  private histI = 0;
  private reset = true;
  private frame = 0;
  private prevVP = new THREE.Matrix4();
  private gtao: GTAOPass | null = null;
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private shaftRT: THREE.WebGLRenderTarget[] = [];
  private dofRT: THREE.WebGLRenderTarget | null = null;
  private quad = new FullScreenQuad();
  private taaMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: TAA_FRAG, depthTest: false, depthWrite: false,
    uniforms: { tCur: { value: null }, tDepth: { value: null }, tHist: { value: null }, uInvVP: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() }, uReset: { value: 1 } },
  });
  private downMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: DOWN_FRAG, depthTest: false, depthWrite: false, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 } } });
  private upMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: UP_FRAG, depthTest: false, depthWrite: false, uniforms: { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } } });
  private shaftMaskMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: SHAFT_MASK_FRAG, depthTest: false, depthWrite: false, uniforms: { tColor: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 } } });
  private shaftBlurMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: SHAFT_BLUR_FRAG, depthTest: false, depthWrite: false, uniforms: { tSrc: { value: null }, uSun: { value: new THREE.Vector2() }, uStep: { value: 1 } } });
  private dofMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: DOF_FRAG, depthTest: false, depthWrite: false, uniforms: { tColor: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uLens: { value: new THREE.Vector4() } } });
  private finalMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FINAL_FRAG.replace("TONEMAP_PARS", THREE.ShaderChunk.tonemapping_pars_fragment.replace("uniform float toneMappingExposure;", "#define toneMappingExposure 1.0")), depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: {
      tColor: { value: null }, tAdapt: { value: null }, uHasAdapt: { value: 0 }, tAO: { value: null }, tDepth: { value: null }, uNearFar: { value: new THREE.Vector2(1, 1000) }, tBloom: { value: null }, tShafts: { value: null }, tDof: { value: null },
      uHasAO: { value: 0 }, uHasBloom: { value: 0 }, uHasShafts: { value: 0 }, uHasDof: { value: 0 },
      uExposure: { value: 1 }, uAOStrength: { value: 1 }, uBloom: { value: 0.04 }, uShafts: { value: 0 }, uSat: { value: 1 }, uVignette: { value: 0 }, uGrain: { value: 0 }, uTime: { value: 0 },
      uWhite: { value: new THREE.Color(1, 1, 1) }, uLift: { value: new THREE.Vector3() }, uGamma: { value: new THREE.Vector3(1, 1, 1) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
      uRes: { value: new THREE.Vector2(1, 1) }, uTone: { value: 0 }, uLook: { value: new THREE.Vector2(1.12, 1.1) },
    },
  });
  private expoMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: EXPO_FRAG, depthTest: false, depthWrite: false,
    uniforms: { tSrc: { value: null }, tPrev: { value: null }, uDt: { value: 0 }, uReset: { value: 1 }, uE0: { value: 1 }, uStrength: { value: 0.3 }, uRange: { value: 1.0 } },
  });
  private adapt = [rt(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }), rt(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter })];
  private adaptI = 0;
  private adaptReset = true;
  private lastTime = -1;
  private saveProj = new THREE.Matrix4();
  private saveProjInv = new THREE.Matrix4();
  private vp = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();

  constructor(private renderer: THREE.WebGLRenderer) {}

  get active(): boolean {
    return !!this.tier && !!this.beauty;
  }

  /** (Re)allocate for a tier and drawing-buffer size; null = no post-processing (low quality). */
  configure(tier: PostTier | null, w: number, h: number, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.disposeTargets();
    this.tier = tier;
    this.w = w;
    this.h = h;
    this.reset = true;
    if (!tier) return;
    this.beauty = rt(w, h, { samples: tier.msaa, depthBuffer: true, depthTexture: new THREE.DepthTexture(w, h, THREE.FloatType) });
    if (tier.taa) this.hist = [rt(w, h), rt(w, h)];
    if (tier.ao > 0) {
      const aw = Math.round(w * tier.ao), ah = Math.round(h * tier.ao);
      if (!this.gtao) {
        this.gtao = new GTAOPass(scene, camera, aw, ah);
        this.gtao.output = GTAOPass.OUTPUT.Off;
      }
      this.gtao.updateGtaoMaterial({ radius: 2.6, distanceExponent: 1.6, thickness: 1.6, scale: 1.0, samples: tier.aoSamples, screenSpaceRadius: false });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.gtao.setSize(aw, ah);
      this.gtao.setGBuffer(this.beauty.depthTexture!);
    }
    let bw = Math.ceil(w / 2), bh = Math.ceil(h / 2);
    for (let i = 0; i < tier.bloomMips; i++) {
      this.down.push(rt(bw, bh));
      if (i < tier.bloomMips - 1) this.up.push(rt(bw, bh));
      bw = Math.ceil(bw / 2);
      bh = Math.ceil(bh / 2);
    }
    if (tier.shafts) this.shaftRT = [rt(Math.ceil(w / 4), Math.ceil(h / 4)), rt(Math.ceil(w / 4), Math.ceil(h / 4))];
    if (tier.dof) this.dofRT = rt(Math.ceil(w / 2), Math.ceil(h / 2));
  }

  resetHistory(): void {
    this.reset = true;
  }
  /** Snap the auto-exposure to the new scene (after a change of sky or site), instead of adapting. */
  resetExposure(): void {
    this.adaptReset = true;
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  /** Render the beauty pass. `draw` renders the scene (into the currently bound target). */
  renderBeauty(camera: THREE.PerspectiveCamera, draw: () => void): void {
    const tier = this.tier!;
    const r = this.renderer;
    camera.updateMatrixWorld();
    this.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (tier.taa) {
      // sub-pixel jitter (Halton 2,3), restored right after the draw
      this.frame = (this.frame + 1) % 16;
      const jx = HALTON(this.frame + 1, 2) - 0.5, jy = HALTON(this.frame + 1, 3) - 0.5;
      this.saveProj.copy(camera.projectionMatrix);
      this.saveProjInv.copy(camera.projectionMatrixInverse);
      camera.projectionMatrix.elements[8] += (2 * jx) / this.w;
      camera.projectionMatrix.elements[9] += (2 * jy) / this.h;
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    }
    r.setRenderTarget(this.beauty);
    draw();
    if (tier.taa) {
      camera.projectionMatrix.copy(this.saveProj);
      camera.projectionMatrixInverse.copy(this.saveProjInv);
    }
  }

  /** Everything after the beauty pass, ending on the screen. */
  finish(camera: THREE.PerspectiveCamera, g: Grade, o: FrameOpts, timeSec: number): void {
    const tier = this.tier!;
    const beauty = this.beauty!;
    let color: THREE.Texture = beauty.texture;
    if (tier.taa) {
      const u = this.taaMat.uniforms;
      const prev = this.hist[this.histI], next = this.hist[1 - this.histI];
      u.tCur.value = beauty.texture;
      u.tDepth.value = beauty.depthTexture;
      u.tHist.value = prev.texture;
      u.uInvVP.value.copy(this.vp).invert();
      u.uPrevVP.value.copy(this.reset ? this.vp : this.prevVP);
      u.uTexel.value.set(1 / this.w, 1 / this.h);
      u.uReset.value = this.reset ? 1 : 0;
      this.pass(this.taaMat, next);
      this.histI = 1 - this.histI;
      color = next.texture;
    }
    this.prevVP.copy(this.vp);
    this.reset = false;
    const f = this.finalMat.uniforms;
    if (this.gtao && tier.ao > 0) {
      this.gtao.render(this.renderer, null as unknown as THREE.WebGLRenderTarget, beauty, 0, false);
      f.tAO.value = this.gtao.pdRenderTarget.texture;
      f.tDepth.value = beauty.depthTexture;
      f.uNearFar.value.set(camera.near, camera.far);
      f.uHasAO.value = 1;
    } else f.uHasAO.value = 0;
    // bloom
    if (this.down.length && g.bloom > 0) {
      let src: THREE.Texture = color, sw = this.w, sh = this.h;
      for (let i = 0; i < this.down.length; i++) {
        this.downMat.uniforms.tSrc.value = src;
        this.downMat.uniforms.uTexel.value.set(1 / sw, 1 / sh);
        this.downMat.uniforms.uKaris.value = i === 0 ? 1 : 0;
        this.pass(this.downMat, this.down[i]);
        src = this.down[i].texture;
        sw = this.down[i].width;
        sh = this.down[i].height;
      }
      let low: THREE.Texture = this.down[this.down.length - 1].texture;
      for (let i = this.up.length - 1; i >= 0; i--) {
        const lw = i + 1 < this.down.length ? this.down[i + 1].width : this.down[i].width;
        const lh = i + 1 < this.down.length ? this.down[i + 1].height : this.down[i].height;
        this.upMat.uniforms.tLow.value = low;
        this.upMat.uniforms.tHigh.value = this.down[i].texture;
        this.upMat.uniforms.uTexel.value.set(1 / lw, 1 / lh);
        this.pass(this.upMat, this.up[i]);
        low = this.up[i].texture;
      }
      // auto-exposure: partial correction of the metered exposure towards the scene's own average, adapting
      // over about a second (a camera's matrix meter, not an eye: it never fully normalises the scene)
      const e = this.expoMat.uniforms;
      e.tSrc.value = this.down[this.down.length - 1].texture;
      e.tPrev.value = this.adapt[this.adaptI].texture;
      e.uDt.value = this.lastTime < 0 ? 0 : Math.min(0.25, Math.max(0, timeSec - this.lastTime));
      e.uReset.value = this.adaptReset ? 1 : 0;
      e.uE0.value = g.exposure;
      e.uStrength.value = g.autoExposure;
      this.pass(this.expoMat, this.adapt[1 - this.adaptI]);
      this.adaptI = 1 - this.adaptI;
      this.adaptReset = false;
      f.tAdapt.value = this.adapt[this.adaptI].texture;
      f.uHasAdapt.value = g.autoExposure > 0 ? 1 : 0;
      f.tBloom.value = low;
      f.uHasBloom.value = 1;
      // the chain sums every level: normalise so the mix is energy-conserving
      f.uBloom.value = g.bloom / this.down.length;
    } else {
      f.uHasBloom.value = 0;
      f.uHasAdapt.value = 0;
    }
    this.lastTime = timeSec;
    // sun shafts
    f.uHasShafts.value = 0;
    if (this.shaftRT.length && o.sunDir && o.sunShafts > 0) {
      const p = this.tmpV.copy(camera.position).addScaledVector(o.sunDir, 10000).project(camera);
      const fwd = camera.getWorldDirection(new THREE.Vector3()).dot(o.sunDir);
      const onScreen = fwd > 0.2 && Math.abs(p.x) < 1.6 && Math.abs(p.y) < 1.6;
      if (onScreen) {
        const sun = new THREE.Vector2(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
        const fade = THREE.MathUtils.smoothstep(fwd, 0.2, 0.6) * (1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(p.x), Math.abs(p.y)), 1.0, 1.6));
        const m = this.shaftMaskMat.uniforms;
        m.tColor.value = color;
        m.tDepth.value = beauty.depthTexture;
        m.uSun.value.copy(sun);
        m.uAspect.value = this.w / this.h;
        this.pass(this.shaftMaskMat, this.shaftRT[0]);
        const b = this.shaftBlurMat.uniforms;
        b.uSun.value.copy(sun);
        let a = 0;
        for (const step of [0.6, 0.25, 0.08]) {
          b.tSrc.value = this.shaftRT[a].texture;
          b.uStep.value = step;
          this.pass(this.shaftBlurMat, this.shaftRT[1 - a]);
          a = 1 - a;
        }
        f.tShafts.value = this.shaftRT[a].texture;
        f.uHasShafts.value = 1;
        f.uShafts.value = o.sunShafts * fade;
      }
    }
    // depth of field
    f.uHasDof.value = 0;
    if (this.dofRT && o.dof) {
      const d = this.dofMat.uniforms;
      d.tColor.value = color;
      d.tDepth.value = beauty.depthTexture;
      d.uTexel.value.set(2 / this.w, 2 / this.h);
      // thin lens: blur diameter (px) = A f |z - s| / (z (s - f)) / sensor height * image height, with the focal
      // length of a full-frame camera of this vertical field of view
      const sensor = 0.024;
      const focal = sensor / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const A = focal / o.dof.fstop;
      const k = ((A * focal) / sensor) * this.h * 0.5; // half-res pixels
      d.uLens.value.set(o.dof.focus, k / Math.max(1e-3, 1 - focal / Math.max(o.dof.focus, 0.2)), camera.near, camera.far);
      this.pass(this.dofMat, this.dofRT);
      f.tDof.value = this.dofRT.texture;
      f.uHasDof.value = 1;
    }
    f.tColor.value = color;
    f.uExposure.value = g.exposure;
    f.uAOStrength.value = g.aoStrength;
    f.uSat.value = g.saturation;
    f.uVignette.value = g.vignette;
    f.uGrain.value = g.grain;
    f.uTime.value = timeSec;
    (f.uWhite.value as THREE.Color).copy(g.white);
    (f.uLift.value as THREE.Vector3).copy(g.lift);
    (f.uGamma.value as THREE.Vector3).copy(g.gamma);
    (f.uGain.value as THREE.Vector3).copy(g.gain);
    f.uRes.value.set(this.w, this.h);
    f.uLook.value.set(g.look[0], g.look[1]);
    f.uTone.value = g.tonemap === "neutral" ? 1 : g.tonemap === "aces" ? 2 : 0;
    this.pass(this.finalMat, null);
  }

  private disposeTargets(): void {
    this.beauty?.depthTexture?.dispose();
    this.beauty?.dispose();
    this.beauty = null;
    for (const t of [...this.hist, ...this.down, ...this.up, ...this.shaftRT]) t.dispose();
    this.hist = [];
    this.down = [];
    this.up = [];
    this.shaftRT = [];
    this.dofRT?.dispose();
    this.dofRT = null;
  }

  dispose(): void {
    this.disposeTargets();
    this.tier = null;
    this.gtao?.dispose();
    this.gtao = null;
    this.quad.dispose();
    for (const t of this.adapt) t.dispose();
    for (const m of [this.expoMat, this.taaMat, this.downMat, this.upMat, this.shaftMaskMat, this.shaftBlurMat, this.dofMat, this.finalMat]) m.dispose();
  }
}
