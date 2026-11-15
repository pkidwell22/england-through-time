import * as THREE from "three";
import type { Dataset } from "@/lib/types";
import type { TerrainModel } from "@/lib/terrain";
import { LOOK_A } from "./atmosphere";
import { MIST_COLOR, MIST_PARAMS } from "../mist";

/**
 * The tidal Thames: one water plane at the modelled high-water level (y = 0) with
 *  - colour from depth and turbidity: silty olive-brown, the bed showing through only in the shallows, darker
 *    over the channel; depth read from a top-down height map of the terrain re-rendered when the banks move;
 *    long streaks of more and less silt drawn out along the flow and drifting with it, so the river seen from
 *    above is not one flat band;
 *  - wind: gusts roughen the surface in drifting patches (cat's paws) between calmer slicks, which changes how
 *    much sky each part reflects;
 *  - a soft margin: the last few centimetres of water over the mud are mostly wet mud, glossy;
 *  - Fresnel (Schlick, n = 1.33) reflection of a planar mirror render of the scene, or of the sky photograph
 *    where there is none (low quality), distorted by the surface normal;
 *  - multi-scale normals advected along the river's flow (two-phase flow mapping, three scales);
 *  - sun glitter (GGX highlight under the cascaded and cloud shadows), soft shoreline, scum and foam lines;
 *  - aerial perspective and mist from ./atmosphere.ts.
 */

const VERT = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>
uniform mat4 uReflMatrix;
varying vec3 vWp;
varying vec4 vRefl;
varying vec3 vMistOff;
void main() {
	vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
	vec3 transformedNormal = normalMatrix * normal;
	vWp = worldPosition.xyz;
	vRefl = uReflMatrix * worldPosition;
	vec4 mvPosition = viewMatrix * worldPosition;
	vMistOff = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
	gl_Position = projectionMatrix * mvPosition;
	#include <shadowmap_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
uniform sampler2D tRefl, tBed, tFlow, tNormal, tSky;
uniform float uHasRefl, uTime, uSkyRot, uSkyScale, uDetail;
uniform vec4 uBedBox;   // xMin, zMin, 1/width, 1/depth
uniform vec4 uFlowBox;
uniform vec3 uSunDir, uSunColor, uSkyIrr, uBody, uBed, uSilt;
uniform vec4 mistParams; uniform vec3 mistColor;
varying vec3 vWp;
varying vec4 vRefl;
varying vec3 vMistOff;

vec3 skyColor( vec3 d ) {
	float a = atan( d.z, d.x ) + uSkyRot;
	vec2 uv = vec2( fract( a / 6.2831853 + 0.5 ), 0.5 + asin( clamp( d.y, -1.0, 1.0 ) ) / 3.14159265 );
	return texture2D( tSky, uv ).rgb * uSkyScale;
}
vec3 nrm( vec2 p ) { vec3 n = texture2D( tNormal, p ).xzy * 2.0 - 1.0; return n; }
// two-phase flow mapping: two copies of the normals advected along the flow, cross-faded so neither stretches
vec3 flowNormal( vec2 p, vec2 flow, float scale, float speed, float t ) {
	float ph0 = fract( t ), ph1 = fract( t + 0.5 );
	float w = abs( ph0 - 0.5 ) * 2.0;
	vec3 a = nrm( ( p - flow * ph0 * speed ) / scale );
	vec3 b = nrm( ( p - flow * ph1 * speed ) / scale + 0.37 );
	return mix( a, b, w );
}
float h12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float vnoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( h12( i ), h12( i + vec2( 1, 0 ) ), f.x ), mix( h12( i + vec2( 0, 1 ) ), h12( i + vec2( 1, 1 ) ), f.x ), f.y ); }

void main() {
	vec3 toCam = cameraPosition - vWp;
	float dist = length( toCam );
	vec3 V = toCam / dist;
	// depth of water over the bed (outside the measured area: deep)
	vec2 bu = ( vWp.xz - uBedBox.xy ) * uBedBox.zw;
	float inside = step( 0.0, bu.x ) * step( bu.x, 1.0 ) * step( 0.0, bu.y ) * step( bu.y, 1.0 );
	float bedY = inside > 0.5 ? texture2D( tBed, vec2( bu.x, 1.0 - bu.y ) ).r - 50.0 : -8.0;
	float depth = max( 0.0, vWp.y - bedY );
	if ( depth < 0.005 ) discard;
	vec2 fu = ( vWp.xz - uFlowBox.xy ) * uFlowBox.zw;
	vec4 fl = texture2D( tFlow, clamp( fu, 0.0, 1.0 ) );
	vec2 flow = fl.xy * 2.0 - 1.0;
	float fspeed = 0.35 + 0.65 * smoothstep( 0.3, 3.0, depth );
	vec2 fdir = length( flow ) > 1e-3 ? normalize( flow ) : vec2( 1.0, 0.0 );
	flow *= fspeed;
	float t = uTime;
	// turbidity: streaks drawn out along the flow (in the flow's own frame), drifting downstream
	vec2 fq = vec2( dot( vWp.xz, fdir ), dot( vWp.xz, vec2( -fdir.y, fdir.x ) ) );
	float silt = vnoise( vec2( fq.x / 520.0 - t * 0.0016, fq.y / 46.0 ) ) * 0.6 + vnoise( vec2( fq.x / 170.0 - t * 0.004, fq.y / 17.0 ) + 5.3 ) * 0.4;
	// wind gusts: drifting patches of rougher water
	float gust = vnoise( vWp.xz / 260.0 + vec2( t * 0.012, t * 0.007 ) ) * 0.65 + vnoise( vWp.xz / 75.0 - vec2( t * 0.03, 0.0 ) ) * 0.35;
	// normals: long swell, wind ripple, fine chop; fade the fine scales with distance (they would only alias)
	vec3 n1 = flowNormal( vWp.xz, flow, 34.0, 9.0, t * 0.035 );
	vec3 n2 = flowNormal( vWp.xz, flow, 7.5, 4.0, t * 0.09 + 0.3 );
	vec3 n3 = uDetail > 0.0 ? flowNormal( vWp.xz * vec2( 1.0, 1.3 ), flow, 1.9, 1.5, t * 0.21 + 0.6 ) : vec3( 0.0 );
	float far = smoothstep( 60.0, 900.0, dist );
	vec3 n = vec3( 0.0, 1.0, 0.0 );
	n.xz += n1.xz * 0.55 + n2.xz * 0.45 * ( 1.0 - far * 0.6 ) + n3.xz * 0.35 * uDetail * ( 1.0 - far );
	// shallow water near the bank is calmer
	n.xz *= ( 0.35 + 0.65 * smoothstep( 0.05, 1.2, depth ) ) * ( 0.55 + 0.9 * gust );
	n = normalize( n );
	// Fresnel for water (n = 1.33). Far away, the ripples are smaller than a pixel: the surface acts rough, so the
	// grazing reflectance stops short of a mirror's (roughness-aware Schlick) and the reflection averages a band of
	// sky above the horizon rather than the bright horizon line itself
	float rough = mix( 0.04, 0.32, smoothstep( 80.0, 700.0, dist ) ) * ( 0.7 + 0.6 * gust );
	float NoV = clamp( dot( n, V ), 0.0, 1.0 );
	float F = 0.02 + ( max( 1.0 - rough, 0.02 ) - 0.02 ) * pow( 1.0 - NoV, 5.0 );
	vec3 R = reflect( -V, n );
	R.y = abs( R.y );
	vec3 refl;
	if ( uHasRefl > 0.5 ) {
		vec2 ruv = vRefl.xy / vRefl.w + n.xz * ( 0.045 / ( 1.0 + dist * 0.004 ) );
		refl = texture2D( tRefl, clamp( ruv, 0.001, 0.999 ) ).rgb;
		// at grazing angles the facets turned away from the camera are hidden behind the crests; the ones that are
		// seen face the camera and reflect sky well above the horizon (about twice the slope of the chop), not the
		// bright horizon band a flat mirror shows: this is what keeps the reach beyond the bridge arches from
		// reading as white holes
		// The seen facets also differ among themselves, so they average a wide band of sky: half a point sample
		// above the horizon, half the sky's mean radiance (bright clouds no longer come back as white patches)
		float graze = smoothstep( 0.03, 0.22, rough ) * pow( 1.0 - NoV, 3.0 );
		vec3 broad = mix( skyColor( normalize( R + vec3( 0.0, 0.24, 0.0 ) ) ), uSkyIrr / PI, 0.6 );
		refl = mix( refl, broad, clamp( graze * 0.95, 0.0, 0.85 ) );
	} else refl = mix( skyColor( normalize( R + vec3( 0.0, rough * 0.75, 0.0 ) ) ), uSkyIrr / PI, smoothstep( 0.04, 0.3, rough ) * 0.6 );
	// direct sun: visibility from the cascaded shadows and the cloud shadows
	float sunVis = getShadowMask() * ltCloudShadow( vWp );
	float mu = max( uSunDir.y, 0.0 );
	vec3 E = uSkyIrr + uSunColor * mu * sunVis;
	// water body: scattering by silt, with the bed showing only through the shallowest water
	float bedSeen = exp( - depth * 3.2 );
	// shallow water carries more stirred-up silt (lighter, browner); the channel is darker and greener; the
	// drifting streaks vary both
	vec3 bodyC = mix( uSilt, uBody * 0.74, smoothstep( 0.4, 4.5, depth ) );
	// more silt: lighter and yellower; less: darker and greener
	bodyC *= mix( vec3( 0.74, 0.8, 0.86 ), vec3( 1.22, 1.16, 1.02 ), silt );
	vec3 body = mix( bodyC, uBed, bedSeen ) * E / PI;
	// sun glitter: GGX with the height-correlated Smith visibility term (without it, grazing views blow up)
	vec3 H = normalize( V + uSunDir );
	float NoH = max( dot( n, H ), 0.0 );
	float NoL = max( dot( n, uSunDir ), 0.0 );
	float ar = max( 0.06, rough );
	float a2 = ar * ar;
	float D = a2 / ( PI * pow( NoH * NoH * ( a2 - 1.0 ) + 1.0, 2.0 ) );
	float Vis = 0.5 / max( 1e-4, NoL * sqrt( NoV * NoV * ( 1.0 - a2 ) + a2 ) + NoV * sqrt( NoL * NoL * ( 1.0 - a2 ) + a2 ) );
	float FS = 0.02 + 0.98 * pow( 1.0 - max( dot( V, H ), 0.0 ), 5.0 );
	vec3 spec = uSunColor * sunVis * D * Vis * FS * NoL;
	vec3 col = body * ( 1.0 - F ) + refl * F + spec;
	// scum and foam where the water meets the bank, broken up and drifting with the flow
	float band = smoothstep( 0.0, 0.04, depth ) * ( 1.0 - smoothstep( 0.06, 0.35, depth ) );
	float foam = 0.0;
	if ( band > 0.0 ) {
		float foamN = vnoise( ( vWp.xz - flow * t * 0.8 ) * 0.9 ) * 0.6 + vnoise( ( vWp.xz - flow * t * 0.5 ) * 3.1 ) * 0.4;
		foam = band * smoothstep( 0.5, 0.85, foamN );
	}
	col = mix( col, vec3( 0.42, 0.4, 0.34 ) * E / PI, foam * 0.4 );
	// soft waterline: the thinnest film over the mud reads as wet mud with a sky sheen, then as water
	float film = 1.0 - smoothstep( 0.02, 0.3, depth );
	col = mix( col, uBed * 0.85 * E / PI * ( 1.0 - F * 2.0 ) + refl * F * 2.0, film * 0.6 );
	float alpha = smoothstep( 0.0, 0.3, depth );
	gl_FragColor = vec4( col, alpha );
	if ( ltA[ 1 ].w > 0.5 ) gl_FragColor.rgb = ltAerial( gl_FragColor.rgb, vMistOff );
	MIST_BLOCK
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
const BED_VERT = /* glsl */ `varying float vY; void main() { vec4 w = modelMatrix * vec4( position, 1.0 ); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }`;
const BED_FRAG = /* glsl */ `varying float vY; void main() { gl_FragColor = vec4( vY + 50.0, 0.0, 0.0, 1.0 ); }`;

function makeNormalTexture(): THREE.DataTexture {
  // tiling height field: a sum of periodic value-noise octaves, converted to normals
  const S = 512;
  const hgt = new Float32Array(S * S);
  const hash = (x: number, y: number, s: number) => {
    let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const vn = (x: number, y: number, p: number, s: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = x - xi, v = y - yi;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const h = (i: number, j: number) => hash(((i % p) + p) % p, ((j % p) + p) % p, s);
    return h(xi, yi) * (1 - su) * (1 - sv) + h(xi + 1, yi) * su * (1 - sv) + h(xi, yi + 1) * (1 - su) * sv + h(xi + 1, yi + 1) * su * sv;
  };
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let a = 1, f = 6, s = 0;
      for (let o = 0; o < 5; o++) {
        // ridged octaves read as wavelets rather than blobs
        const v = vn((x / S) * f, (y / S) * f, f, o + 3);
        s += a * (1 - Math.abs(v * 2 - 1));
        a *= 0.5;
        f *= 2;
      }
      hgt[y * S + x] = s;
    }
  const data = new Uint8Array(S * S * 4);
  const k = 3.2;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const hx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x + S - 1) % S)];
      const hy = hgt[((y + 1) % S) * S + x] - hgt[((y + S - 1) % S) * S + x];
      const n = new THREE.Vector3(-hx * k, -hy * k, 1).normalize();
      const i = (y * S + x) * 4;
      data[i] = (n.x * 0.5 + 0.5) * 255;
      data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export interface WaterLight {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color; // scene units, irradiance on a surface facing the sun
  skyIrr: THREE.Color; // scene units, on a horizontal surface
  sky: THREE.Texture | null; // equirect sky (for reflections without a mirror)
  skyRot: number;
  skyScale: number;
  /** Mean horizon radiance (scene units). */
  horizon: THREE.Color;
}

export class RiverWater {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private reflRT: THREE.WebGLRenderTarget | null = null;
  private reflScale = 0;
  private reflEvery = 1;
  /** False while the camera is too high for the mirror image to show (see renderReflection). */
  private reflOn = true;
  private frame = 0;
  private bedRT: THREE.WebGLRenderTarget;
  private bedCam: THREE.OrthographicCamera;
  private bedMat = new THREE.ShaderMaterial({ vertexShader: BED_VERT, fragmentShader: BED_FRAG, side: THREE.DoubleSide });
  private virtualCam = new THREE.PerspectiveCamera();
  private reflMatrix = new THREE.Matrix4();
  readonly reflLayers = new THREE.Layers();
  private flowTex: THREE.DataTexture;

  constructor(private ds: Dataset, terrain: TerrainModel) {
    const b = ds.site.bounds;
    const cx = (b.xMin + b.xMax) / 2, cz = (b.zMin + b.zMax) / 2;
    // the bed map covers the modelled area with a margin; beyond it the river is simply deep
    const m = 900;
    const bx0 = b.xMin - m, bx1 = b.xMax + m, bz0 = b.zMin - m, bz1 = b.zMax + m;
    const span = Math.max(bx1 - bx0, bz1 - bz0);
    const res = span > 4000 ? 2048 : 1024;
    this.bedRT = new THREE.WebGLRenderTarget(res, Math.round((res * (bz1 - bz0)) / (bx1 - bx0)), {
      type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.bedCam = new THREE.OrthographicCamera(bx0 - cx, bx1 - cx, -(bz0 - cz), -(bz1 - cz), 1, 2000);
    this.bedCam.position.set(cx, 800, cz);
    this.bedCam.up.set(0, 0, -1);
    this.bedCam.lookAt(cx, 0, cz);
    this.bedCam.updateMatrixWorld();
    this.flowTex = this.makeFlow(terrain, bx0, bz0, bx1, bz1);
    const uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.lights,
      {
        tRefl: { value: null }, tBed: { value: null }, tFlow: { value: this.flowTex }, tNormal: { value: makeNormalTexture() }, tSky: { value: null },
        uHasRefl: { value: 0 }, uTime: { value: 0 }, uSkyRot: { value: 0 }, uSkyScale: { value: 1 }, uDetail: { value: 1 },
        uBedBox: { value: new THREE.Vector4(bx0, bz0, 1 / (bx1 - bx0), 1 / (bz1 - bz0)) },
        uFlowBox: { value: new THREE.Vector4(bx0, bz0, 1 / (bx1 - bx0), 1 / (bz1 - bz0)) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(4, 4, 4) }, uSkyIrr: { value: new THREE.Color(1, 1, 1) },
        uBody: { value: new THREE.Color(0.09, 0.082, 0.042) }, uBed: { value: new THREE.Color(0.075, 0.062, 0.045) },
        uSilt: { value: new THREE.Color(0.115, 0.1, 0.058) },
        uReflMatrix: { value: this.reflMatrix },
      },
    ]);
    // merge clones values: anything updated in place or rendered into must be put back by reference
    uniforms.ltA = { value: LOOK_A };
    uniforms.tBed = { value: this.bedRT.texture };
    uniforms.uReflMatrix = { value: this.reflMatrix };
    this.material = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader: FRAG.replace("MIST_BLOCK", MIST_GLSL), lights: true, transparent: true, depthWrite: true, fog: false,
    });
    this.material.uniforms.mistParams = { value: MIST_PARAMS };
    this.material.uniforms.mistColor = { value: MIST_COLOR };
    const site = ds.site.water?.color;
    if (site) {
      // a site colour sets the body hue (the default is the silty tidal Thames)
      const c = new THREE.Color(site);
      (this.material.uniforms.uBody.value as THREE.Color).copy(c).multiplyScalar(0.55);
      (this.material.uniforms.uSilt.value as THREE.Color).copy(c).multiplyScalar(0.75);
    }
    const g = new THREE.PlaneGeometry(40000, 40000, 1, 1).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.position.set(cx, 0, cz);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.name = "river-water";
    this.reflLayers.set(0);
  }

  /** Mirror resolution as a fraction of the screen (0 = sky reflection only) and update interval in frames. */
  setReflection(scale: number, every: number, detail: number): void {
    this.reflScale = scale;
    this.reflEvery = Math.max(1, every);
    this.material.uniforms.uDetail.value = detail;
    if (!scale) {
      this.reflRT?.dispose();
      this.reflRT = null;
    }
    this.material.uniforms.uHasRefl.value = scale > 0 ? 1 : 0;
  }

  setLight(l: WaterLight): void {
    const u = this.material.uniforms;
    u.uSunDir.value.copy(l.sunDir);
    u.uSunColor.value.copy(l.sunColor);
    u.uSkyIrr.value.copy(l.skyIrr);
    u.tSky.value = l.sky;
    u.uSkyRot.value = l.skyRot;
    u.uSkyScale.value = l.skyScale;
  }

  /** Re-measure the river bed (call when the terrain mesh changes, e.g. the banks move with the year). */
  updateBed(renderer: THREE.WebGLRenderer, terrainMesh: THREE.Mesh): void {
    const prevMat = terrainMesh.material;
    const prevRT = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    terrainMesh.material = this.bedMat;
    renderer.setRenderTarget(this.bedRT);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    const parent = terrainMesh.parent;
    const tmp = new THREE.Scene();
    tmp.add(terrainMesh);
    renderer.render(tmp, this.bedCam);
    tmp.remove(terrainMesh);
    if (parent) parent.add(terrainMesh);
    terrainMesh.material = prevMat;
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.shadowMap.autoUpdate = prevShadow;
  }

  /** Render the mirror image (before the main pass). */
  renderReflection(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, w: number, h: number): void {
    if (!this.reflScale || !this.mesh.visible) return;
    // From high above, the river is seen steeply: water reflects only a few per cent there, and beyond about
    // 700 m the shader already swaps the mirror for a band of sky. So above ~350 m the mirror pass (a second
    // draw of the whole scene) is skipped and the water reflects the sky alone. Two thresholds, so it cannot flicker.
    const camY = camera.position.y;
    if (this.reflOn ? camY > 380 : camY < 320) {
      this.reflOn = !this.reflOn;
      this.frame = 0;
    }
    this.material.uniforms.uHasRefl.value = this.reflOn ? 1 : 0;
    if (!this.reflOn) return;
    const rw = Math.max(64, Math.round(w * this.reflScale)), rh = Math.max(64, Math.round(h * this.reflScale));
    if (!this.reflRT || this.reflRT.width !== rw || this.reflRT.height !== rh) {
      this.reflRT?.dispose();
      this.reflRT = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType, samples: 0 });
      this.material.uniforms.tRefl.value = this.reflRT.texture;
      this.frame = 0;
    }
    if (this.frame++ % this.reflEvery !== 0) return;
    // mirror the camera in the plane y = 0 (as three's Reflector does), with an oblique near plane at the water
    const vc = this.virtualCam;
    camera.updateMatrixWorld();
    const cp = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
    vc.position.set(cp.x, -cp.y, cp.z);
    vc.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    vc.up.y = -vc.up.y;
    vc.lookAt(cp.x + dir.x, -(cp.y + dir.y), cp.z + dir.z);
    vc.far = camera.far;
    vc.near = camera.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    this.reflMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0).applyMatrix4(vc.matrixWorldInverse);
    const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = vc.projectionMatrix.elements;
    const q = new THREE.Vector4((Math.sign(clip.x) + pm[8]) / pm[0], (Math.sign(clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1; pm[14] = clip.w;
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();
    vc.layers.mask = this.reflLayers.mask;
    const prevRT = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    // hide the water surface itself while drawing its mirror image
    const mat = this.mesh.material;
    this.mesh.material = HIDDEN;
    renderer.setRenderTarget(this.reflRT);
    renderer.clear();
    renderer.render(scene, vc);
    this.mesh.material = mat;
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.setRenderTarget(prevRT);
  }

  update(timeSec: number): void {
    this.material.uniforms.uTime.value = timeSec;
  }

  private makeFlow(terrain: TerrainModel, x0: number, z0: number, x1: number, z1: number): THREE.DataTexture {
    const S = 128;
    const data = new Uint8Array(S * S * 4);
    const line = (this.ds.site.river?.centreline ?? []).map(([la, lo]) => terrain.proj.toLocal(la, lo));
    for (let j = 0; j < S; j++)
      for (let i = 0; i < S; i++) {
        const x = x0 + ((i + 0.5) / S) * (x1 - x0), z = z0 + ((j + 0.5) / S) * (z1 - z0);
        let best = Infinity, fx = 1, fz = 0;
        for (let k = 0; k + 1 < line.length; k++) {
          const [ax, az] = line[k], [bx, bz] = line[k + 1];
          const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
          if (d < best) { best = d; const l = Math.sqrt(l2); fx = dx / l; fz = dz / l; }
        }
        const p = (j * S + i) * 4;
        // ebb (downstream) flow; texture v runs with world z
        data[p] = (fx * 0.5 + 0.5) * 255;
        data[p + 1] = (fz * 0.5 + 0.5) * 255;
        data[p + 2] = 0;
        data[p + 3] = 255;
      }
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  dispose(): void {
    this.reflRT?.dispose();
    this.bedRT.dispose();
    this.flowTex.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}

const MIST_GLSL = /* glsl */ `
	if ( mistParams.x > 0.0 ) {
		float mistL = length( vMistOff );
		float mistY0 = cameraPosition.y - mistParams.y;
		float mistY1 = mistY0 + vMistOff.y;
		float mistLo = min( mistY0, mistY1 );
		float mistHi = max( mistY0, mistY1 );
		float mistH = mistParams.z;
		float mistBelow = mistHi - mistLo < 0.05 ? step( mistLo, 0.0 ) : clamp( - mistLo / ( mistHi - mistLo ), 0.0, 1.0 );
		float mistA = max( mistLo, 0.0 );
		float mistDa = mistHi - mistA;
		float mistAbove = mistDa > 0.05 ? mistH / mistDa * ( exp( - mistA / mistH ) - exp( - mistHi / mistH ) ) : exp( - mistA / mistH );
		float mistTau = mistL * ( mistBelow + ( 1.0 - mistBelow ) * mistAbove );
		vec2 mistXZ = cameraPosition.xz + vMistOff.xz;
		mistTau *= 0.45 + 1.1 * texture2D( ltCloudTex, ( mistXZ + ltA[ 8 ].xy * 0.08 ) / 1300.0 + 0.53 ).r;
		gl_FragColor.rgb = mix( gl_FragColor.rgb, mistColor, ( 1.0 - exp( - mistParams.x * mistTau ) ) * mistParams.w );
	}`;
