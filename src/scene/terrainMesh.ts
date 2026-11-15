import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Dataset } from "@/lib/types";
import { hash2, noise2, smoothstep } from "@/lib/geo";
import { sampleKeyframes } from "@/lib/lifecycle";
import type { StaticSample, TerrainModel } from "@/lib/terrain";
import { histToT } from "@/lib/years";
import type { FabricLayer } from "./fabric";
import { LandBake, groundMoisture, siteHeightRef } from "./ground/land";
import { lifeDepthMaterial, patchLife } from "./life";
import { meanLinearColor } from "./look/sky";
import { TERRAIN_ASSETS, scanTexture } from "./materials";

function axis(min: number, max: number, coarse: number, fineMin: number, fineMax: number, fine: number): number[] {
  const out: number[] = [];
  let v = min;
  while (v < max - 0.01) {
    out.push(v);
    v += v >= fineMin - 0.01 && v < fineMax ? fine : Math.min(coarse, Math.max(fine, v < fineMin ? fineMin - v : coarse));
  }
  out.push(max);
  // coarse apron far beyond the modelled area, out to about the far plane so the land meets the haze at the
  // horizon instead of ending against the sky
  for (const far of [300, 700, 1300, 2200, 3500, 5500, 8500, 13000, 19000, 27000]) {
    out.unshift(min - far);
    out.push(max + far);
  }
  return out;
}

/** Kinds whose ends are approaches: the ground is trodden round a bridge or ford foot. */
const CROSSING_KINDS = new Set(["bridge", "stone-bridge", "ford"]);

const GROUND_VERT_DECL = /* glsl */ `
uniform vec4 uSiteBox;
uniform float uCanopyLift;
attribute vec4 aSplat;
varying vec4 vSplat;
varying vec2 vWxz;
`;

const GROUND_FRAG_DECL = /* glsl */ `
uniform sampler2D tLand, tLandMid, tLandFar, tGrass, tDry, tForest, tMud, tDirt;
uniform vec4 uLandBox, uMidBox, uFarBox;
uniform vec3 uMean[ 5 ];
uniform vec2 uNear;
varying vec4 vSplat;
varying vec2 vWxz;
float gWet = 0.0;
float gBump = 0.0;
float gBumpOn = 0.0;
float gHash( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float gNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( gHash( i ), gHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( gHash( i + vec2( 0.0, 1.0 ) ), gHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
vec3 gPerturb( vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir ) {
	vec3 sx = normalize( dFdx( surfPos ) ), sy = normalize( dFdy( surfPos ) );
	vec3 r1 = cross( sy, surfNorm ), r2 = cross( surfNorm, sx );
	float det = dot( sx, r1 ) * faceDir;
	vec3 grad = sign( det ) * ( dHdxy.x * r1 + dHdxy.y * r2 );
	return normalize( abs( det ) * surfNorm - grad );
}
`;

/**
 * The far apron (more than ~12 km beyond the modelled area, about to the far plane) rises gently, to about 260 m,
 * in the drawn mesh only (the terrain model and everything placed on it are untouched): a low line of distant
 * downs, lost in the haze, so the land meets the horizon instead of stopping short of it against the sky. Lowland
 * England seen from the Thames has such a skyline (the Chilterns and North Downs lie 25-40 km off London).
 */
const HORIZON_VERT = /* glsl */ `
#include <begin_vertex>
vSplat = aSplat;
vWxz = position.xz;
{
	vec2 gOut = max( uSiteBox.xy - position.xz, position.xz - uSiteBox.zw );
	// an irregular skyline, not a ruled line: the rise varies along the horizon
	vec2 gC = position.xz / 6500.0, gI = floor( gC ), gF = gC - gI;
	gF = gF * gF * ( 3.0 - 2.0 * gF );
	#define G_SKYH( c ) fract( sin( dot( c, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 )
	float gSky = 0.55 + 0.9 * mix( mix( G_SKYH( gI ), G_SKYH( gI + vec2( 1.0, 0.0 ) ), gF.x ), mix( G_SKYH( gI + vec2( 0.0, 1.0 ) ), G_SKYH( gI + vec2( 1.0, 1.0 ) ), gF.x ), gF.y );
	float gFar = max( gOut.x, gOut.y );
	// the rise stays below the camera's own horizon line, so from low down it never stands up as a wall
	float gRise = min( 260.0 * gSky, max( 0.0, cameraPosition.y - 4.0 ) * 0.85 * gSky / 1.45 );
	transformed.y += gRise * smoothstep( 12000.0, 26000.0, gFar );
	// beyond the modelled area no trees are drawn: where the land texture shows canopy, the surface stands at
	// canopy height, so the drawn woodland does not end in a step at the site edge (not over the river)
	transformed.y += uCanopyLift * smoothstep( -20.0, 70.0, gFar ) * ( 1.0 - aSplat.y );
}
`;

/**
 * Ground colour: one fetch of the baked land texture (./ground/land.ts), the near or the far one, gives the colour
 * seen from above; a little procedural grain (no fetch) carries it through the middle distance; only near the
 * camera are the photographed ground layers sampled, and only those with weight, each twice (a second copy turned
 * and scaled, blended by a slow noise, so no repeat shows). They add their detail relative to their own mean
 * colour, so they never shift the land-use colour.
 */
const GROUND_FRAG = (tile: number) => /* glsl */ `
{
	// the finest of the three land textures that covers this point, blended across each one's outer band
	vec2 lu = ( vWxz - uLandBox.xy ) * uLandBox.zw; lu.y = 1.0 - lu.y;
	vec2 mu = ( vWxz - uMidBox.xy ) * uMidBox.zw; mu.y = 1.0 - mu.y;
	vec2 fu = ( vWxz - uFarBox.xy ) * uFarBox.zw; fu.y = 1.0 - fu.y;
	vec2 ldx = dFdx( lu ), ldy = dFdy( lu ), mdx = dFdx( mu ), mdy = dFdy( mu ), fdx = dFdx( fu ), fdy = dFdy( fu );
	vec2 le = min( lu, 1.0 - lu ), me = min( mu, 1.0 - mu );
	float inN = smoothstep( 0.0, 0.035, min( le.x, le.y ) );
	float inM = smoothstep( 0.0, 0.06, min( me.x, me.y ) );
	vec4 L;
	if ( inN > 0.999 ) L = textureGrad( tLand, lu, ldx, ldy );
	else {
		if ( inM > 0.999 ) L = textureGrad( tLandMid, mu, mdx, mdy );
		else {
			L = textureGrad( tLandFar, fu, fdx, fdy );
			if ( inM > 0.001 ) L = mix( L, textureGrad( tLandMid, mu, mdx, mdy ), inM );
		}
		if ( inN > 0.001 ) L = mix( L, textureGrad( tLand, lu, ldx, ldy ), inN );
	}
	float dist = isOrthographic ? 0.0 : length( vViewPosition );
	float nearW = 1.0 - smoothstep( uNear.x, uNear.y, dist );
	// grain at a few metres, faded out once a pixel covers it
	float fw = length( fwidth( vWxz ) );
	float grain = 1.0;
	if ( fw < 7.0 ) {
		grain += ( gNoise( vWxz / 6.5 + 3.7 ) - 0.5 ) * 0.14 * ( 1.0 - smoothstep( 2.0, 7.0, fw ) );
		if ( fw < 1.8 ) grain += ( gNoise( vWxz / 1.7 ) - 0.5 ) * 0.16 * ( 1.0 - smoothstep( 0.5, 1.8, fw ) );
	}
	vec2 ua = vWxz / ${tile.toFixed(2)};
	vec2 ub = mat2( 0.7986, 0.6018, -0.6018, 0.7986 ) * vWxz / ${(tile * 1.37).toFixed(2)} + 0.37;
	vec2 uax = dFdx( ua ), uay = dFdy( ua ), ubx = dFdx( ub ), uby = dFdy( ub );
	vec3 det = vec3( 1.0 );
	float bh = 1.0;
	if ( nearW > 0.0 ) {
		float wf = vSplat.x, wm = vSplat.y, wd = vSplat.z, wy = vSplat.w;
		float wg = max( 0.0, 1.0 - wf - wm - wd - wy );
		float mb = smoothstep( 0.3, 0.7, gNoise( vWxz / 19.0 ) );
		#define GD_LAYER( t, i ) ( mix( textureGrad( t, ua, uax, uay ).rgb, textureGrad( t, ub, ubx, uby ).rgb, mb ) / uMean[ i ] )
		vec3 r = vec3( 0.0 );
		float tot = 0.0;
		if ( wg > 0.02 ) { r += GD_LAYER( tGrass, 0 ) * wg; tot += wg; }
		if ( wf > 0.02 ) { r += GD_LAYER( tForest, 1 ) * wf; tot += wf; }
		if ( wm > 0.02 ) { r += GD_LAYER( tMud, 2 ) * wm; tot += wm; }
		if ( wd > 0.02 ) { r += GD_LAYER( tDirt, 3 ) * wd; tot += wd; }
		if ( wy > 0.02 ) { r += GD_LAYER( tDry, 4 ) * wy; tot += wy; }
		r = tot > 0.0 ? clamp( r / tot, 0.0, 2.5 ) : vec3( 1.0 );
		det = mix( vec3( 1.0 ), r, nearW );
		bh = mix( 1.0, dot( r, vec3( 0.3333 ) ), nearW );
	}
	gBump = bh;
	gBumpOn = nearW;
	gWet = L.a;
	diffuseColor.rgb = L.rgb * det * grain;
}
`;

/**
 * Terrain surface. The grid is finer inside the benchmark district. Heights and
 * land-cover weights are recomputed when the year changes enough to matter
 * (river bank position, marsh embankment, woodland cover, built-up ground);
 * the land texture is then re-baked from them.
 */
export class TerrainMesh {
  readonly mesh: THREE.Mesh;
  readonly land: LandBake;
  private xs: number[];
  private zs: number[];
  private statics: StaticSample[] = [];
  private wood: Float32Array;
  private zoneMask: Float32Array[] = [];
  /** Per zone: how it reads on the ground (built-up, rough grazing, heath, wood-pasture, farmstead infield). */
  private zoneKind: ("urban" | "rough" | "heath" | "woodp" | "farmstead")[] = [];
  private crossings: { x: number; z: number; t0: number; t1: number }[] = [];
  private hRef = 0;
  /** Height of the apron surface beyond the site where it shows closed woodland (m, from the cover figure). */
  private canopyLift = { value: 0 };
  private lastKey = "";
  private fabric: FabricLayer | null = null;

  constructor(private ds: Dataset, private terrain: TerrainModel, quality: number) {
    const b = ds.site.bounds;
    // no benchmark district: an empty fine range, so the whole site uses the coarse grid
    const d = ds.site.district?.bounds ?? { xMin: Infinity, xMax: -Infinity, zMin: Infinity, zMax: -Infinity };
    const span = Math.max(b.xMax - b.xMin, b.zMax - b.zMin);
    // small sites are seen from closer, so they get a tighter grid for the same vertex budget
    const coarse = (quality < 1 ? 20 : 12) * (span < 2400 ? 0.5 : 1);
    const fine = quality < 1 ? 8 : quality > 1 ? 3 : 4;
    this.xs = axis(b.xMin, b.xMax, coarse, d.xMin - 40, d.xMax + 40, fine);
    this.zs = axis(b.zMin, b.zMax, coarse, d.zMin - 40, d.zMax + 40, fine);
    const nx = this.xs.length, nz = this.zs.length;
    const pos = new Float32Array(nx * nz * 3);
    const uv = new Float32Array(nx * nz * 2);
    this.wood = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const x = this.xs[i], z = this.zs[j];
        pos[k * 3] = x;
        pos[k * 3 + 2] = z;
        uv[k * 2] = x / 24;
        uv[k * 2 + 1] = z / 24;
        this.statics.push(terrain.staticSample(x, z));
        this.wood[k] = terrain.woodlandThreshold(x, z);
      }
    this.hRef = siteHeightRef(ds, terrain);
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, c = a + nx;
        idx[p++] = a; idx[p++] = c; idx[p++] = a + 1;
        idx[p++] = a + 1; idx[p++] = c; idx[p++] = c + 1;
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    // ground-cover weights for the near-camera photographed layers: forest floor, mud/foreshore, trodden earth,
    // dry/cropped ground (remainder = grass)
    g.setAttribute("aSplat", new THREE.BufferAttribute(new Float32Array(nx * nz * 4), 4));
    // land cover for the bake (./ground/land.ts): marsh wetness, built-up, rough grazing, ground moisture
    g.setAttribute("aLand", new THREE.BufferAttribute(new Float32Array(nx * nz * 4), 4));
    // farmstead infield, low (embankable) marshland, heath, wood-pasture
    g.setAttribute("aLand2", new THREE.BufferAttribute(new Float32Array(nx * nz * 4), 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.land = new LandBake(ds, terrain, g, quality, [this.xs[0], this.zs[0], this.xs[nx - 1], this.zs[nz - 1]]);
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    const T = TERRAIN_ASSETS as Record<string, string>;
    const tile = Number(TERRAIN_ASSETS.tile) || 9;
    const tex = { tGrass: scanTexture(T.grass, "diff"), tForest: scanTexture(T.forest, "diff"), tMud: scanTexture(T.mud, "diff"), tDirt: scanTexture(T.dirt, "diff"), tDry: scanTexture(T.dry, "diff") };
    // mean colour of each photographed layer (same order as uMean), measured once its image has loaded
    const means = [0, 1, 2, 3, 4].map(() => new THREE.Vector3(0.12, 0.12, 0.1));
    const layers = [tex.tGrass, tex.tForest, tex.tMud, tex.tDirt, tex.tDry];
    const measured = layers.map(() => false);
    const uniforms: Record<string, THREE.IUniform> = {
      ...this.land.uniforms,
      uMean: { value: means },
      uNear: { value: new THREE.Vector2(90, 260) },
      uSiteBox: { value: new THREE.Vector4(b.xMin, b.zMin, b.xMax, b.zMax) },
      uCanopyLift: this.canopyLift,
    };
    for (const [k, v] of Object.entries(tex)) uniforms[k] = { value: v };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = GROUND_VERT_DECL + shader.vertexShader.replace("#include <begin_vertex>", HORIZON_VERT);
      shader.fragmentShader = GROUND_FRAG_DECL + shader.fragmentShader
        .replace("#include <color_fragment>", GROUND_FRAG(tile))
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.28, gWet );")
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nvec2 gDH = vec2( dFdx( gBump ), dFdy( gBump ) ) * 0.35;\nif ( gBumpOn > 0.0 ) normal = gPerturb( - vViewPosition, normal, gDH, faceDirection );");
    };
    mat.customProgramCacheKey = () => "ground-land-v1";
    // the ground's textures, for look development and A/B timing (tests/ground-ab.mjs)
    mat.userData.ground = { tex, tile };
    this.mesh = new THREE.Mesh(g, mat);
    // drawn after the other solid things: its shader is the costliest in the scene, and the pixels that houses and
    // walls cover are then rejected by the depth test before it runs
    this.mesh.renderOrder = 0.5;
    this.mesh.receiveShadow = true;
    this.mesh.name = "terrain";
    // the land texture is (re)baked just before the terrain is next drawn
    this.mesh.onBeforeRender = (renderer) => {
      for (let i = 0; i < layers.length; i++) {
        if (measured[i]) continue;
        const img = layers[i].image as HTMLImageElement | undefined;
        if (!img || !img.complete || !img.width) continue;
        const c = meanLinearColor(img);
        measured[i] = true;
        if (c) means[i].set(Math.max(0.01, c.r), Math.max(0.01, c.g), Math.max(0.01, c.b));
      }
      if (this.land.needsBake) this.land.render(renderer);
    };
  }

  attachFabric(f: FabricLayer): void {
    this.fabric = f;
    this.zoneMask = f.zoneGeoms.map((zg) => {
      const m = new Float32Array(this.xs.length * this.zs.length);
      const nx = this.xs.length;
      for (let j = 0; j < this.zs.length; j++) {
        const z = this.zs[j];
        if (z < zg.bbox[1] - 30 || z > zg.bbox[3] + 30) continue;
        for (let i = 0; i < nx; i++) {
          const x = this.xs[i];
          if (x < zg.bbox[0] - 30 || x > zg.bbox[2] + 30) continue;
          m[j * nx + i] = zg.weight(x, z);
        }
      }
      return m;
    });
    // how each zone reads on the ground, from its style and (for scrub zones) its own label
    this.zoneKind = f.zoneGeoms.map((zg) => {
      const z = zg.zone;
      if (z.style === "roundhouse") return "farmstead";
      if (z.style !== "scrub") return "urban";
      if (/heath/i.test(z.label)) return "heath";
      if (/wood.?pasture/i.test(z.label)) return "woodp";
      return "rough";
    });
    // bridge and ford ends, for trodden approaches
    const tEnd = histToT(this.ds.site.timeline.end) + 1;
    this.crossings = [];
    for (const lm of this.ds.landmarks) {
      const lp = (lm.path ?? []).map(([la, lo]) => this.terrain.proj.toLocal(la, lo));
      for (const ph of lm.phases) {
        if (!CROSSING_KINDS.has(ph.model.kind)) continue;
        const mm = ph.model as Record<string, unknown>;
        const path = Array.isArray(mm.path) ? (mm.path as [number, number][]).map(([la, lo]) => this.terrain.proj.toLocal(la, lo)) : lp;
        if (path.length < 2) continue;
        const t0 = histToT(ph.from), t1 = ph.goneBy != null ? histToT(ph.goneBy) : ph.to != null ? histToT(ph.to) + 4 : tEnd + 1;
        for (const [x, z] of [path[0], path[path.length - 1]]) this.crossings.push({ x, z, t0, t1 });
      }
    }
    this.lastKey = "";
  }

  /** Life of a zone at time t (0..1), for every style (the fabric's own activity leaves out scrub and farmsteads). */
  private zoneLife(i: number, t: number): number {
    const zg = this.fabric!.zoneGeoms[i];
    const z = zg.zone;
    const g0 = histToT(zg.grow[0]), g1 = histToT(zg.grow[1]) + 1;
    let a = Math.min(1, Math.max(0, (t - g0) / Math.max(1, g1 - g0)));
    if (z.decline) {
      const d0 = histToT(z.decline[0]), d1 = histToT(z.decline[1]) + 1;
      a *= 1 - Math.min(1, Math.max(0, (t - d0) / Math.max(1, d1 - d0)));
    }
    return a;
  }

  update(t: number, force = false): boolean {
    const yp = this.terrain.yearParams(t);
    const cover = sampleKeyframes(this.ds.site.woodland.cover, t);
    const fab = this.fabric;
    const acts = fab ? fab.zoneGeoms.map((zg, i) => (this.zoneKind[i] === "urban" ? fab.activity(zg, t) : this.zoneLife(i, t))) : [];
    const key = [yp.setback.toFixed(0), yp.embank.toFixed(2), yp.valleyFill.map((v) => v.toFixed(2)).join(), (yp.inlets ?? []).join(""), cover.toFixed(2), acts.map((a) => a.toFixed(1)).join(""), Math.round(t / 25)].join("|");
    if (key === this.lastKey && !force) return false;
    this.lastKey = key;
    const g = this.mesh.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const spl = g.attributes.aSplat as THREE.BufferAttribute;
    const lnd = g.attributes.aLand as THREE.BufferAttribute;
    const ln2 = g.attributes.aLand2 as THREE.BufferAttribute;
    const farmed = smoothstep(histToT(-2500), histToT(-500), t);
    const n = this.statics.length;
    const b0 = this.ds.site.bounds;
    const river = this.terrain.hasRiver;
    const active: number[] = [];
    acts.forEach((a, i) => { if (a > 0.02) active.push(i); });
    let moistSum = 0, moistN = 0;
    for (let k = 0; k < n; k++) {
      const s = this.statics[k];
      const h = this.terrain.heightFrom(s, yp);
      pos.setY(k, h);
      const px = pos.getX(k), pz = pos.getZ(k);
      const moist = groundMoisture(s, h, yp, river, this.hRef);
      if ((k & 7) === 0 && (!river || h > 0.75) && px >= b0.xMin && px <= b0.xMax && pz >= b0.zMin && pz <= b0.zMax) { moistSum += moist; moistN++; }
      const outside = px < b0.xMin - 1 || px > b0.xMax + 1 || pz < b0.zMin - 1 || pz > b0.zMax + 1;
      if (outside) {
        // beyond the modelled area: woodland by the site's cover figure, no settlements or features implied
        const wd = h < 0 && river ? 0 : Math.min(1, cover * 1.1) * 0.8 * smoothstep(this.wood[k] - 0.1, this.wood[k] + 0.1, cover);
        spl.setXYZW(k, wd, river && h < 0 ? 1 : 0, 0, 0);
        lnd.setXYZW(k, 0, 0, 0, moist);
        ln2.setXYZW(k, 0, 0, 0, 0);
        continue;
      }
      const right = river && s.dRiver < 0;
      const wet = right ? (1 - yp.embank * (1 - s.west * 0.85)) * (1 - smoothstep(1.6, 3.2, h)) : 0;
      const lowMarsh = right ? 1 - smoothstep(2.2, 3.6, h) : 0;
      let sF = 0, sM = 0, sD = 0, sY = 0;
      let urban = 0, rough = 0, heath = 0, woodp = 0, farm = 0;
      if (river && h < -0.15) sM = 1;
      else if (river && h < 0.75) {
        sM = 1 - smoothstep(0.3, 0.75, h) * (wet > 0.4 ? 0.7 : 0.2);
        sD = wet > 0.4 ? 0 : 1 - sM;
      } else {
        // woodland floor where trees still stand
        const wd = smoothstep(this.wood[k] - 0.06, this.wood[k] + 0.06, cover) * (1 - wet * 0.6);
        sF = wd * 0.9;
        sY = (1 - sF) * farmed * 0.3;
        sM = wet * 0.45 * (1 - sF);
        for (const zi of active) {
          const w = this.zoneMask[zi][k] * acts[zi];
          if (w <= 0) continue;
          const kind = this.zoneKind[zi];
          if (kind === "urban") urban = Math.max(urban, w);
          else if (kind === "rough") rough = Math.max(rough, w);
          else if (kind === "heath") heath = Math.max(heath, w);
          else if (kind === "woodp") woodp = Math.max(woodp, w);
          else farm = Math.max(farm, w);
        }
        if (urban > 0) {
          const uu = Math.min(1, urban * 1.15);
          sD = uu; sF *= 1 - uu; sY *= 1 - uu; sM *= 1 - uu;
        }
        if (river) {
          const sh = wet < 0.4 ? 1 - smoothstep(0.75, 1.4, h) : 0;
          sD = Math.max(sD, sh * 0.8);
        }
      }
      const tot = Math.max(1, sF + sM + sD + sY);
      spl.setXYZW(k, sF / tot, sM / tot, sD / tot, sY / tot);
      lnd.setXYZW(k, wet, Math.min(1, urban * 1.15), Math.min(1, rough * 1.2), moist);
      ln2.setXYZW(k, farm, lowMarsh, Math.min(1, heath * 1.2), Math.min(1, woodp * 1.2));
    }
    pos.needsUpdate = true;
    spl.needsUpdate = true;
    lnd.needsUpdate = true;
    ln2.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
    // road verges: trodden where a road enters a settlement, and at bridge and ford ends
    const urbanZones = active.filter((zi) => this.zoneKind[zi] === "urban");
    const cross = this.crossings.filter((c) => t >= c.t0 && t <= c.t1);
    // trees stand about 12-16 m: lift the apron that far only where the woodland is near-closed
    this.canopyLift.value = 13 * smoothstep(0.55, 0.95, cover);
    this.land.update(t, cover, moistN ? moistSum / moistN : 0.5, (x, z) => {
      let w = 0;
      for (const zi of urbanZones) {
        const zg = fab!.zoneGeoms[zi];
        if (x < zg.bbox[0] - 30 || x > zg.bbox[2] + 30 || z < zg.bbox[1] - 30 || z > zg.bbox[3] + 30) continue;
        const zw = zg.weight(x, z) * acts[zi];
        w = Math.max(w, smoothstep(0, 0.12, zw) * (1 - 0.5 * smoothstep(0.5, 0.9, zw)));
      }
      for (const c of cross) w = Math.max(w, 1 - smoothstep(30, 160, Math.hypot(x - c.x, z - c.z)));
      return w;
    });
    return true;
  }
}

/**
 * Woodland as instanced trees. Each tree stands while the site-wide woodland
 * cover (data: site.woodland.cover) exceeds its own threshold, and is felled
 * earlier where a settlement zone grows over it.
 */
export function buildTrees(ds: Dataset, terrain: TerrainModel, fabric: FabricLayer, density: number): THREE.Group {
  const root = new THREE.Group();
  root.name = "trees";
  const b = ds.site.bounds;
  const kf = ds.site.woodland.cover.map((k) => ({ t: histToT(k.year), v: k.value }));
  const tStart = histToT(ds.site.timeline.start);
  const yp0 = terrain.yearParams(tStart);
  const tEnd = histToT(ds.site.timeline.end) + 1;
  const spacing = 21 / Math.sqrt(density);
  const items: { x: number; y: number; z: number; s: number; life: [number, number, number, number]; tone: number; wet: boolean }[] = [];
  for (let z = b.zMin + 10; z < b.zMax - 10; z += spacing)
    for (let x = b.xMin + 10; x < b.xMax - 10; x += spacing) {
      const jx = x + (hash2(x, z) - 0.5) * spacing * 0.95;
      const jz = z + (hash2(z + 99, x - 7) - 0.5) * spacing * 0.95;
      const st = terrain.staticSample(jx, jz);
      const y = terrain.heightFrom(st, yp0);
      if (!terrain.dry(y, 0.75)) continue;
      const wet = st.dRiver < 0 && y < 1.7;
      if (wet && hash2(jx * 3, jz * 3) > 0.45) continue;
      const tau = terrain.woodlandThreshold(jx, jz);
      // clearance by settlement
      let cleared = Infinity;
      for (const zg of fabric.zoneGeoms) {
        if (zg.zone.style === "roundhouse" || zg.zone.style === "scrub") continue;
        if (zg.t0 < cleared && jx > zg.bbox[0] && jx < zg.bbox[2] && jz > zg.bbox[1] && jz < zg.bbox[3] && zg.contains(jx, jz)) cleared = zg.t0 + hash2(jx, jz + 5) * 25;
      }
      // intervals during which cover(t) > tau
      let alive = kf[0].v > tau;
      let start = -1e7;
      const push = (s: number, e: number) => {
        const end = Math.min(e, cleared);
        if (end <= s) return;
        const sc = (wet ? 0.5 : 0.8) + hash2(jx + 3, jz + 8) * 0.55;
        items.push({ x: jx, y, z: jz, s: sc, life: [s - 25, s, end, end + 3], tone: hash2(jx - 11, jz + 2), wet });
      };
      for (let i = 1; i < kf.length; i++) {
        const a = kf[i - 1], c = kf[i];
        if ((a.v > tau) !== (c.v > tau)) {
          const tc = a.t + ((tau - a.v) / (c.v - a.v)) * (c.t - a.t);
          if (alive) push(start, tc);
          else start = tc;
          alive = !alive;
        }
      }
      if (alive) push(start, 1e7);
    }

  // Hedgerow, garden and orchard trees of the farmed landscape: sparse, standing from the
  // later prehistoric clearances onward. Positions are illustrative (not evidenced).
  const tFarm = histToT(-900);
  for (let z = b.zMin + 30; ds.site.woodland.hedgerowTrees !== false && z < b.zMax - 30; z += 46)
    for (let x = b.xMin + 30; x < b.xMax - 30; x += 46) {
      const hsh = hash2(x * 0.7 + 11, z * 0.7 - 5);
      if (hsh > 0.55) continue;
      // bias positions onto the edges of the field patches so they read as hedgerows
      const along = hash2(x - 3, z + 9);
      const jx = x + (hsh < 0.27 ? (along - 0.5) * 40 : 0), jz = z + (hsh < 0.27 ? 0 : (along - 0.5) * 40);
      const st = terrain.staticSample(jx, jz);
      const y = terrain.heightFrom(st, yp0);
      const yLate = terrain.heightFrom(st, terrain.yearParams(Math.min(histToT(1400), tEnd)));
      if (!terrain.dry(y, 1.6) || !terrain.dry(yLate, 1.6)) continue;
      let cleared = Infinity;
      for (const zg of fabric.zoneGeoms) {
        if (zg.zone.style === "roundhouse" || zg.zone.style === "scrub") continue;
        if (zg.t0 < cleared && jx > zg.bbox[0] && jx < zg.bbox[2] && jz > zg.bbox[1] && jz < zg.bbox[3] && zg.weight(jx, jz) > 0.25) cleared = zg.t0 + along * 30;
      }
      const start = tFarm + hash2(jx, jz) * 900;
      if (cleared <= start) continue;
      items.push({ x: jx, y, z: jz, s: 0.55 + along * 0.5, life: [start, start + 40, cleared, cleared + 3], tone: hash2(jx - 11, jz + 2), wet: false });
    }
  items.sort((a, b) => b.life[3] - a.life[3]);
  const ends = Float32Array.from(items, (it) => it.life[3]);
  const meshes: THREE.InstancedMesh[] = [];
  // crown: several overlapping irregular lobes, darker underneath
  const lobes: THREE.BufferGeometry[] = [];
  const lobeDefs: [number, number, number, number][] = [[0, 9.6, 0, 6.0], [3.4, 7.8, 1.6, 4.6], [-3.0, 8.0, -2.2, 4.8]];
  for (const [lx, ly, lz, lr] of lobeDefs.slice(0, density >= 1 ? 3 : 2)) {
    const raw = new THREE.IcosahedronGeometry(1, 1);
    raw.deleteAttribute("normal");
    raw.deleteAttribute("uv");
    const g = mergeVertices(raw, 1e-4);
    const gp = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(gp.count * 3);
    for (let i = 0; i < gp.count; i++) {
      const nx = gp.getX(i), ny = gp.getY(i), nz = gp.getZ(i);
      const k = 0.78 + noise2(nx * 2.3 + lx, nz * 2.3 + ly) * 0.3 + noise2(nx * 6.1 + ny * 3.0, nz * 6.1 + lz) * 0.16;
      gp.setXYZ(i, lx + nx * lr * k * 1.15, ly + ny * lr * k * 0.82, lz + nz * lr * k * 1.15);
      const shade = 0.42 + 0.58 * Math.min(1, Math.max(0, ny * 0.6 + 0.55)) + (noise2(nx * 9.0, nz * 9.0 + ny * 5.0) - 0.5) * 0.25;
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = shade;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    lobes.push(g.toNonIndexed());
  }
  const crown = mergeGeometries(lobes, false)!;
  // the trunk runs 1.5 m into the ground so it never stands proud of the surface on a slope or where the
  // terrain mesh lies a little above the sampled height (the part above ground is unchanged)
  const trunk = new THREE.CylinderGeometry(0.4, 0.7 + (0.3 / 7) * 1.5, 8.5, 6).translate(0, 2.75, 0);
  const life = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 4), 4);
  const fx = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 3), 3);
  const mats = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 16), 16);
  const colors = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 3), 3);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  items.forEach((it, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.tone * 6.28);
    m4.compose(new THREE.Vector3(it.x, it.y - 0.2, it.z), q, new THREE.Vector3(it.s, it.s * (0.9 + it.tone * 0.3), it.s));
    m4.toArray(mats.array as Float32Array, i * 16);
    life.setXYZW(i, ...it.life);
    fx.setXYZ(i, 0, 0, 0);
    if (it.wet) c.setHSL(0.2 + it.tone * 0.03, 0.26, 0.2 + it.tone * 0.06);
    else c.setHSL(0.235 + it.tone * 0.06, 0.3 + it.tone * 0.12, 0.15 + it.tone * 0.08);
    c.convertSRGBToLinear();
    colors.setXYZ(i, c.r, c.g, c.b);
  });
  const depth = lifeDepthMaterial();
  const mk = (geo: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial, useColor: boolean) => {
    geo.setAttribute("aLife", life);
    geo.setAttribute("aFx", fx);
    const mesh = new THREE.InstancedMesh(geo, patchLife(mat, { tint: false }), items.length);
    mesh.instanceMatrix = mats;
    if (useColor) mesh.instanceColor = colors;
    mesh.customDepthMaterial = depth;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
    meshes.push(mesh);
  };
  mk(crown, new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: false, vertexColors: true }), true);
  mk(trunk, new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 }), false);
  root.userData.count = items.length;
  root.userData.update = (t: number) => {
    let lo = 0, hi = ends.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ends[mid] > t) lo = mid + 1;
      else hi = mid;
    }
    for (const m of meshes) {
      m.count = lo;
      m.visible = lo > 0;
    }
  };
  return root;
}
