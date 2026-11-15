import * as THREE from "three";
import type { Dataset } from "@/lib/types";
import type { StaticSample, TerrainModel, TerrainYearParams } from "@/lib/terrain";
import { histToT } from "@/lib/years";
import { LAND_GLSL } from "./landPattern";

/**
 * Baked land-use texture: the ground's colour as seen from above, rendered on the GPU into two top-down textures
 * whenever the year's ground changes (the terrain mesh flags it; the bake runs in the mesh's onBeforeRender, as
 * three's Reflector renders its mirror):
 *
 *  - near: the modelled area plus a margin, about 1.2 m a texel at High (2.4 m below);
 *  - mid:  4 km round the modelled area, about 6 m a texel, for the country just beyond it;
 *  - far:  the whole terrain apron to the far plane, about 30 m a texel, so the distance has the same character
 *          (woods, fields, meadows) instead of one averaged colour.
 *
 * The bake draws the terrain mesh itself with a land-use shader that reads the per-vertex land-cover weights the
 * terrain computes from the site data (woodland, marsh and wetness, foreshore, built-up zones, scrub/heath/
 * wood-pasture zones, late-prehistoric farmstead zones, ground moisture) and adds generic structure: field systems
 * by period (./landPattern.ts), marsh creeks and pools, drainage ditches on embanked marsh, trodden ground round
 * settlements. Then, on top, what the data places exactly: dated roads with their trodden verges (wider where they
 * enter a settlement or reach a bridge) and the site's own arable strips (`field-strips` landmarks).
 *
 * Output: rgb = linear albedo; a = surface water (0 dry, ~0.5 wet mud, 1 open water), which the ground shader turns
 * into gloss. The live ground shader samples this once per pixel and adds photographed detail only near the camera.
 */

export interface SiteGround {
  /** Chalk downland palette (paler, greyer grass, chalk showing on slopes). */
  chalk: number;
  /** Multiplies the period's arable share (pasture-dominated clayland, sheep-walk downland). */
  arable: number;
  /** Weight of the open-field (strip) layout from c. 1000 CE; 0 where the data gives no reason to show it. */
  openField: number;
  /** Regional orientation of field rows (radians). */
  baseAng: number;
}

/**
 * Per-site ground character: general geology and farming regime, not mapped layouts.
 *  - London and Brentford: Thames gravel terraces over London Clay, alluvium and marsh by the river; Middlesex
 *    and north Surrey had open fields on the terraces.
 *  - Barnet: London Clay with a pebble-gravel cap; the site notes record open pasture with scattered trees and
 *    closes, not open-field arable, so pasture dominates and no strip layout is drawn.
 *  - Stonehenge: chalk downland, thin soils; mostly sheep-walk with arable in the lower ground.
 */
export function siteGround(id: string): SiteGround {
  switch (id) {
    case "barnet": return { chalk: 0, arable: 0.35, openField: 0, baseAng: 0.35 };
    case "stonehenge": return { chalk: 1, arable: 0.45, openField: 0.6, baseAng: -0.2 };
    case "brentford": return { chalk: 0, arable: 0.9, openField: 1, baseAng: 0.55 };
    default: return { chalk: 0, arable: 1, openField: 1, baseAng: 0.22 };
  }
}

/**
 * Share of farmed land under the plough, by year (timeline value). An illustrative trend for lowland southern
 * England, not a measurement: Bronze/Iron Age expansion, a Roman high, post-Roman retreat to pasture, the
 * medieval peak, contraction after the Black Death, partial recovery.
 */
const ARABLE: [number, number][] = [[-1500, 0.26], [-100, 0.38], [200, 0.42], [450, 0.24], [850, 0.32], [1100, 0.45], [1340, 0.5], [1450, 0.36], [1600, 0.42]];

function keyed(k: [number, number][], t: number): number {
  if (t <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (t <= k[i][0]) {
    const a = k[i - 1], b = k[i];
    return a[1] + ((t - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
  }
  return k[k.length - 1][1];
}
const ss = (a: number, b: number, v: number) => {
  const x = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/** The year's period weights for the land shader (also used by the ground cover). */
export function periodWeights(t: number, g: SiteGround): { farm: number; pre: number; open: number; arable: number } {
  return {
    farm: ss(histToT(-2500), histToT(-500), t),
    pre: ss(histToT(-1700), histToT(-1100), t) * (1 - ss(950, 1150, t)),
    open: ss(950, 1150, t) * g.openField,
    arable: keyed(ARABLE, t) * g.arable,
  };
}

/** Typical ground level of a site without a river (its moisture is relative to it: hollows wet, crests dry). */
export function siteHeightRef(ds: Dataset, terrain: TerrainModel): number {
  if (terrain.hasRiver) return 0;
  const b = ds.site.bounds;
  const yp = terrain.yearParams(histToT(ds.site.timeline.start));
  const hs: number[] = [];
  for (let i = 0; i <= 14; i++)
    for (let j = 0; j <= 14; j++) hs.push(terrain.heightFrom(terrain.staticSample(b.xMin + ((b.xMax - b.xMin) * i) / 14, b.zMin + ((b.zMax - b.zMin) * j) / 14), yp));
  hs.sort((a, c) => a - c);
  return hs[Math.floor(hs.length / 2)];
}

/**
 * Ground moisture 0..1 from the terrain: wet low ground by the water and in valleys (as filled that year), dry
 * gravel terraces and crests. Drives the grass colour and where arable can be.
 */
export function groundMoisture(s: StaticSample, h: number, yp: TerrainYearParams, river: boolean, hRef: number): number {
  let valley = 0;
  for (let i = 0; i < s.valleyW.length; i++) valley += s.valleyW[i] * (1 - (yp.valleyFill[i] ?? 0));
  valley = Math.min(1, valley / 3);
  let m: number;
  if (river) {
    const flood = 1 - ss(1.2, 6, h);
    const terrace = s.dRiver >= 0 ? ss(4, 14, h) : ss(5, 12, h) * 0.6;
    m = 0.42 + 0.5 * flood + 0.6 * valley - 0.38 * terrace;
  } else {
    const rel = h - hRef;
    m = 0.48 + 0.6 * valley - 0.32 * ss(-6, 22, rel) + 0.2 * (1 - ss(-22, -4, rel));
  }
  return Math.min(1, Math.max(0, m));
}

const BAKE_VERT = /* glsl */ `
attribute vec4 aSplat, aLand, aLand2;
varying vec2 vP;
varying float vH, vNy;
varying vec4 vSplat, vLand, vLand2;
void main() {
	vec4 w = modelMatrix * vec4( position, 1.0 );
	vP = w.xz; vH = w.y; vNy = normal.y;
	vSplat = aSplat; vLand = aLand; vLand2 = aLand2;
	gl_Position = projectionMatrix * viewMatrix * w;
}`;

const COMMON = /* glsl */ `
#define SRGB( r, g, b ) pow( vec3( r, g, b ) / 255.0, vec3( 2.2 ) )
uniform float uTexel;
// coverage of a line of half-width hw at distance d, box-filtered over one texel
float lineCov( float d, float hw ) { return clamp( ( hw - d ) / uTexel + 0.5, 0.0, 1.0 ) * min( 1.0, 2.0 * hw / uTexel ); }
// distance (m) to the iso-line f = level of a smooth field
float isoDist( float f, float level ) { return abs( f - level ) / max( fwidth( f ), 1e-6 ) * uTexel; }
`;

const BAKE_FRAG = /* glsl */ `
${LAND_GLSL}
${COMMON}
uniform float uFarm, uPre, uOpen, uArable, uChalk, uRiver;
uniform vec4 uSite; // modelled area: xMin, zMin, xMax, zMax
uniform float uCover; // the site's woodland-cover figure this year
uniform float uMoistOut; // mean ground moisture inside the modelled area, continued beyond it
varying vec2 vP;
varying float vH, vNy;
varying vec4 vSplat, vLand, vLand2;

void main() {
	vec2 p = vP;
	float n1 = vnz( p / 650.0, 21.0 ), n2 = vnz( p / 170.0, 22.0 ), n3 = vnz( p / 43.0, 23.0 ), n4 = vnz( p / 11.0, 24.0 ), n5 = vnz( p / 3.7, 25.0 );
	// beyond the modelled area the mesh is a coarse apron (vertices 0.3-8 km apart), so its per-vertex weights would
	// show as large squares: there woodland and moisture are made here, from the woodland figure and noise
	vec2 outD = max( uSite.xy - p, p - uSite.zw );
	// the blend straddles the boundary: the drawn trees run to its edge, so canopy must start at once outside it
	float beyond = smoothstep( -40.0, 50.0, max( outD.x, outD.y ) );
	// (value noise is turned and summed over octaves wherever it shows at large scale: a single axis-aligned octave
	// at high contrast reads as a checkerboard)
	vec2 pr1 = mat2( 0.8, 0.6, -0.6, 0.8 ) * p, pr2 = mat2( 0.28, -0.96, 0.96, 0.28 ) * p;
	float woodThr = 0.45 * vnz( pr1 / 420.0, 81.0 ) + 0.35 * vnz( pr2 / 1300.0, 82.0 ) + 0.2 * vnz( pr2 / 150.0, 86.0 );
	float procForest = smoothstep( woodThr - 0.08, woodThr + 0.08, uCover ) * ( 1.0 - uRiver * step( 0.5, vSplat.y ) );
	// land-cover weights from the vertices, their edges broken up so they do not follow the mesh triangles
	float forestV = mix( clamp( vSplat.x / 0.9, 0.0, 1.0 ), procForest, beyond );
	float forest = smoothstep( 0.32, 0.68, forestV + ( n3 - 0.5 ) * 0.45 + ( n4 - 0.5 ) * 0.2 );
	float mud = vSplat.y, dirt = vSplat.z;
	float wet = clamp( vLand.x + ( n3 - 0.5 ) * 0.35 * step( 0.01, vLand.x ), 0.0, 1.0 );
	float urban = vLand.y, rough = vLand.z;
	float farmstead = vLand2.x, lowMarsh = vLand2.y, heath = vLand2.z, woodp = vLand2.w;
	float slope = 1.0 - vNy;
	float shoreMud = uRiver * mud * ( 1.0 - smoothstep( 0.55, 0.85, vH ) );

	// ---- grass by ground moisture: wetter and lusher in the valleys and by the river, parched on the terraces
	// moisture fades over 1.5 km to the site's own mean, so the boundary leaves no step in the grass tone
	float beyondM = smoothstep( 0.0, 1500.0, max( outD.x, outD.y ) );
	float m = clamp( mix( vLand.w, uMoistOut, beyondM ) + ( n1 - 0.5 ) * mix( 0.3, 0.45, beyondM ) + ( n2 - 0.5 ) * 0.18 - smoothstep( 0.02, 0.12, slope ) * 0.25 * ( 1.0 - beyondM ), 0.0, 1.0 );
	vec3 gDry = mix( SRGB( 134, 136, 84 ), SRGB( 164, 164, 120 ), uChalk );
	vec3 gMid = mix( SRGB( 110, 124, 64 ), SRGB( 132, 140, 88 ), uChalk );
	vec3 gLush = mix( SRGB( 82, 104, 52 ), SRGB( 100, 120, 62 ), uChalk );
	vec3 grass = m < 0.5 ? mix( gDry, gMid, m * 2.0 ) : mix( gMid, gLush, m * 2.0 - 1.0 );
	grass *= 0.86 + 0.2 * n3 + 0.12 * ( n4 - 0.5 ) + 0.07 * ( n5 - 0.5 );
	// grazing: shorter, paler patches; tussocks darker
	grass = mix( grass, grass * vec3( 1.06, 1.03, 0.9 ), smoothstep( 0.55, 0.8, n4 ) * 0.7 );
	// bare chalk where the turf is thin on the steeper slopes
	grass = mix( grass, SRGB( 196, 192, 176 ), uChalk * smoothstep( 0.04, 0.14, slope ) * smoothstep( 0.55, 0.8, n4 * 0.6 + n5 * 0.4 ) * 0.6 );
	vec3 col = grass;
	float wetA = 0.0;

	float uc = smoothstep( 0.35, 0.75, urban + ( n4 - 0.5 ) * 0.3 );
	float notFarm = max( max( rough, heath ), woodp );
	float suit = uFarm * ( 1.0 - forest ) * ( 1.0 - smoothstep( 0.05, 0.3, wet ) ) * ( 1.0 - smoothstep( 0.08, 0.4, urban ) ) * ( 1.0 - notFarm )
		* ( 1.0 - smoothstep( 0.6, 0.88, m ) ) * ( 1.0 - 0.7 * smoothstep( 0.04, 0.12, slope ) ) * ( 1.0 - shoreMud );
	if ( uRiver > 0.5 ) suit *= smoothstep( 0.9, 1.6, vH );
	// the infields of the late-prehistoric farmsteads are the most intensively cropped
	float arableP = clamp( uArable * ( 1.0 + 0.8 * farmstead ), 0.0, 0.95 );
	float fieldMask = uFarm * ( 1.0 - forest ) * ( 1.0 - smoothstep( 0.1, 0.4, wet ) ) * ( 1.0 - smoothstep( 0.15, 0.55, urban ) ) * ( 1.0 - notFarm ) * ( 1.0 - shoreMud );

	// ---- small fields with banks (Bronze Age to early medieval)
	if ( uPre > 0.01 && fieldMask > 0.01 ) {
		Fld F = fieldsAt( p, vec2( 95.0, 60.0 ) );
		float ar = step( hsh( F.id, 31.0 ), arableP * suit / max( uFarm, 0.01 ) );
		float kind = hsh( F.id, 32.0 );
		vec3 crop = kind < 0.45 ? SRGB( 160, 146, 92 ) : kind < 0.75 ? SRGB( 120, 102, 76 ) : SRGB( 126, 134, 74 );
		crop *= 0.9 + 0.2 * hsh( F.id, 33.0 ) + 0.1 * ( n5 - 0.5 );
		// small fields under mixed husbandry: crops still green-gold, so the patchwork is gentle
		crop = mix( crop, grass, 0.4 );
		vec3 fc = mix( grass * ( 0.9 + 0.16 * hsh( F.id, 34.0 ) ), crop, ar );
		// low banks and lynchets with rougher grass; no hedges are drawn (the data records none)
		float bank = lineCov( min( F.ed.x, F.ed.y ), 1.3 );
		fc = mix( fc, SRGB( 96, 108, 60 ), bank * 0.75 );
		col = mix( col, fc, uPre * fieldMask );
	}

	// ---- open fields: furlongs of strips with headlands (from c. 1000)
	if ( uOpen > 0.01 && fieldMask > 0.01 ) {
		Fld F = fieldsAt( p, vec2( 230.0, 170.0 ) );
		float ar = step( hsh( F.id, 41.0 ), arableP * suit / max( uFarm, 0.01 ) * 1.1 );
		float o = step( 0.5, hsh( F.id, 42.0 ) );
		float along = mix( F.f.y, F.f.x, o );
		float len = mix( F.sz.y, F.sz.x, o );
		float u = mix( F.lp.y, F.lp.x, o );
		float sw = 7.0 + 9.0 * hsh( F.id, 43.0 );
		u += sw * 0.9 * sin( ( along - 0.5 ) * 3.14159 );
		float si = floor( u / sw );
		float sf = u / sw - si;
		float sAA = smoothstep( 1.5 * uTexel, 3.0 * uTexel, sw );
		float gf = hsh( F.rid, 44.0 );
		// each strip its own holder's crop: the winter field mostly wheat and rye (ripening, green-gold), the spring
		// field barley, oats, peas and beans; unresolvable strips (far texture) take the field's mean colour
		float cs = hsh( vec2( si, F.id.x * 7.0 + F.id.y ), 45.0 );
		vec3 winter = cs < 0.5 ? mix( SRGB( 128, 138, 76 ), SRGB( 166, 156, 100 ), cs * 2.0 ) : cs < 0.85 ? SRGB( 148, 148, 98 ) : SRGB( 96, 112, 56 );
		vec3 spring = cs < 0.35 ? SRGB( 168, 162, 112 ) : cs < 0.62 ? SRGB( 136, 142, 90 ) : cs < 0.9 ? SRGB( 94, 110, 56 ) : SRGB( 120, 106, 80 );
		vec3 crop = mix( gf < 0.66 ? SRGB( 140, 142, 88 ) : SRGB( 132, 136, 86 ), gf < 0.66 ? winter : spring, sAA );
		crop *= 0.93 + 0.12 * mix( 0.5, hsh( vec2( si, F.id.y ), 46.0 ), sAA ) + 0.08 * ( n5 - 0.5 );
		float sh = mix( 0.5, cs, sAA );
		// one great field in three lies fallow, grazed
		vec3 strip = gf < 0.33 ? grass * ( 0.9 + 0.14 * sh ) : crop;
		// ridge and furrow: the crown a little lighter, a darker, greener furrow between strips
		strip *= mix( 1.0, 0.94 + 0.1 * sin( sf * 3.14159 ), sAA );
		strip = mix( strip, SRGB( 94, 106, 60 ), lineCov( min( sf, 1.0 - sf ) * sw, 0.7 ) * sAA * 0.6 );
		float endD = min( along, 1.0 - along ) * len;
		strip = mix( strip, grass * vec3( 0.97, 0.98, 0.9 ), 1.0 - smoothstep( 5.5, 8.0, endD ) );
		// meadow and pasture furlongs: mown or grazed as a whole, each its own shade
		float ph = hsh( F.id, 47.0 );
		vec3 past = grass * ( 0.84 + 0.28 * ph ) * mix( vec3( 1.0 ), vec3( 1.06, 1.02, 0.86 ), step( 0.6, hsh( F.id, 49.0 ) ) );
		past = mix( past, past * vec3( 1.12, 1.08, 0.86 ), step( hsh( F.id, 48.0 ), 0.25 ) * smoothstep( 0.5, 0.8, m ) );
		// ridge and furrow outlasts the plough: pasture furlongs keep faint strips
		past *= 1.0 + ( hsh( vec2( si, F.id.x * 3.0 + F.id.y ), 50.0 ) - 0.5 ) * 0.08 * sAA;
		vec3 fc = mix( past, strip, ar );
		fc = mix( fc, SRGB( 100, 112, 62 ), lineCov( min( F.ed.x, F.ed.y ), 1.1 ) * 0.55 );
		col = mix( col, fc, uOpen * fieldMask );
	}

	// ---- farmland with no field layout drawn (after c. 1100 where the data gives no reason for open-field strips):
	// parcels differ only in tone (grazed, mown, rougher), with no boundary lines, so nothing is said about where
	// hedges or closes stood
	float closes = uFarm * ( 1.0 - uPre ) * ( 1.0 - uOpen ) * fieldMask;
	if ( closes > 0.01 ) {
		Fld F = fieldsAt( p + 1700.0, vec2( 170.0, 120.0 ) );
		float ph = hsh( F.id, 57.0 );
		vec3 pc = grass * ( 0.86 + 0.24 * ph ) * mix( vec3( 1.0 ), vec3( 1.08, 1.04, 0.84 ), step( 0.72, hsh( F.id, 58.0 ) ) );
		col = mix( col, pc, closes * 0.8 );
	}

	// ---- woodland floor, and a scrubby margin where woodland thins out
	float margin = smoothstep( 0.12, 0.45, forestV ) * ( 1.0 - forest );
	col = mix( col, SRGB( 72, 88, 46 ) * ( 0.85 + 0.3 * n4 ), margin * 0.7 );
	// inside the modelled area the trees are drawn and this is the floor between them; beyond it no trees are
	// drawn, so woodland shows as canopy seen from above
	// canopy, matched to the drawn trees seen from above (their crowns are dark, with shadowed gaps): stands differ
	// in tone over a few hundred metres, crowns mottle it where the texture can carry it
	float crowns = vnz( p / 9.0, 83.0 ) * ( 1.0 - smoothstep( 4.0, 12.0, uTexel ) );
	float stand = 0.5 * vnz( pr1 / 260.0, 84.0 ) + 0.3 * vnz( pr2 / 110.0, 85.0 ) + 0.2 * vnz( pr1 / 47.0, 87.0 );
	vec3 canopy = mix( SRGB( 33, 42, 22 ), SRGB( 44, 53, 27 ), smoothstep( 0.3, 0.7, stand ) ) * ( 0.94 + 0.3 * ( crowns - 0.5 ) );
	col = mix( col, mix( SRGB( 60, 60, 40 ) * ( 0.85 + 0.3 * n4 ), canopy, beyond ), forest );

	// ---- rough grazing and scrub
	vec3 roughC = mix( grass * vec3( 1.04, 0.98, 0.86 ), SRGB( 70, 82, 44 ), smoothstep( 0.55, 0.75, n4 * 0.6 + n5 * 0.4 ) );
	col = mix( col, roughC, rough );
	// heath: heather, gorse, sandy tracks
	vec3 heathC = mix( SRGB( 106, 92, 76 ), SRGB( 122, 108, 84 ), n3 ) * ( 0.9 + 0.2 * n5 );
	heathC = mix( heathC, SRGB( 58, 70, 36 ), smoothstep( 0.62, 0.72, n4 * 0.6 + n5 * 0.4 ) );
	heathC = mix( heathC, SRGB( 170, 152, 116 ), lineCov( isoDist( vnz( p / 60.0, 51.0 ) * 0.7 + n3 * 0.3, 0.5 ), 0.9 ) );
	col = mix( col, heathC, heath );
	// wood-pasture: grazed grass with thorn and holly clumps
	vec3 wpC = mix( grass * 0.95, SRGB( 52, 62, 34 ), smoothstep( 0.66, 0.74, vnz( p / 18.0, 52.0 ) * 0.7 + n4 * 0.3 ) );
	col = mix( col, wpC, woodp );

	// ---- natural marsh: reed and sedge, creeks and pools
	if ( wet > 0.01 ) {
		float f = vnz( p / 95.0, 61.0 ) * 0.55 + vnz( p / 33.0, 62.0 ) * 0.3 + vnz( p / 12.0, 63.0 ) * 0.15;
		float creek = lineCov( isoDist( f, 0.5 ), 0.8 + 2.2 * smoothstep( 0.4, 1.0, wet ) );
		float pl = vnz( p / 55.0, 64.0 ) * 0.65 + vnz( p / 17.0, 65.0 ) * 0.35;
		float pool = clamp( ( pl - 0.7 ) / max( fwidth( pl ), 1e-5 ) + 0.5, 0.0, 1.0 ) * smoothstep( 0.35, 0.8, wet );
		vec3 reed = mix( SRGB( 126, 120, 74 ), SRGB( 90, 104, 58 ), smoothstep( 0.3, 0.7, n3 ) ) * ( 0.88 + 0.24 * n5 );
		float water = max( creek, pool );
		vec3 mc = mix( reed, SRGB( 50, 56, 50 ), water );
		float wk = smoothstep( 0.12, 0.5, wet );
		col = mix( col, mc, wk );
		wetA = max( wetA, wk * ( water + 0.25 * ( 1.0 - water ) ) );
	}
	// ---- embanked (drained) marsh: lush pasture cut by drainage ditches
	if ( lowMarsh > 0.05 ) {
		Fld D = fieldsAt( p + 500.0, vec2( 150.0, 75.0 ) );
		float dr = lowMarsh * ( 1.0 - smoothstep( 0.1, 0.4, wet ) ) * ( 1.0 - uc ) * uFarm;
		// long ditches along the rows, some cross ditches; each close its own shade
		float ditch = max( lineCov( D.ed.y, 0.75 ), lineCov( D.ed.x, 0.6 ) * step( hsh( D.id, 55.0 ), 0.45 ) ) * dr;
		col *= mix( 1.0, 0.88 + 0.22 * hsh( D.id, 56.0 ), dr );
		col = mix( col, SRGB( 64, 80, 54 ), ditch * 0.75 );
		wetA = max( wetA, ditch * 0.8 );
	}
	// ---- foreshore mud with gravel patches; trodden earth on the low banks
	if ( shoreMud > 0.01 ) {
		float r = vnz( p / 7.0, 71.0 ) * 0.5 + vnz( p / 23.0, 72.0 ) * 0.5;
		vec3 mudC = mix( SRGB( 82, 74, 60 ), SRGB( 106, 96, 78 ), r );
		mudC = mix( mudC, SRGB( 132, 122, 102 ), smoothstep( 0.62, 0.74, vnz( p / 15.0, 73.0 ) ) * smoothstep( 0.2, 0.7, vH ) );
		col = mix( col, mudC, shoreMud );
		wetA = max( wetA, shoreMud * ( 0.6 - 0.4 * smoothstep( 0.1, 0.7, vH ) ) );
	}
	col = mix( col, SRGB( 116, 104, 82 ) * ( 0.9 + 0.2 * n4 ), dirt * ( 1.0 - uc ) * 0.6 * uRiver );

	// ---- settlements: trodden ground at the edge, yards and lanes inside
	float fringe = smoothstep( 0.02, 0.2, urban ) * ( 1.0 - uc );
	vec3 worn = mix( grass, SRGB( 136, 122, 92 ), 0.55 );
	col = mix( col, worn, fringe * smoothstep( 0.35, 0.75, n3 * 0.5 + n4 * 0.5 ) * 0.5 );
	vec3 yard = mix( SRGB( 118, 104, 84 ), SRGB( 92, 84, 66 ), n4 ) * ( 0.9 + 0.2 * n5 );
	col = mix( col, yard, uc );

	gl_FragColor = vec4( col, clamp( wetA, 0.0, 1.0 ) );
}`;

// Roads (dated, from the landmarks): trodden earth, braided wheel tracks and worn verges, wider at a settlement
// edge or a bridge.
const ROAD_VERT = /* glsl */ `
attribute vec4 aRoad;  // across (-1..1), core half-width (m), outer half-width (m), wear
attribute vec2 aLife;  // timeline from / to
uniform float uT;
varying vec4 vRoad;
varying vec2 vP;
void main() {
	vRoad = aRoad;
	vP = position.xz;
	float on = step( aLife.x, uT ) * step( uT, aLife.y );
	gl_Position = projectionMatrix * viewMatrix * vec4( position.x, 0.0, position.z, 1.0 ) * on;
}`;
const ROAD_FRAG = /* glsl */ `
${LAND_GLSL}
${COMMON}
varying vec4 vRoad;
varying vec2 vP;
void main() {
	float d = abs( vRoad.x ) * vRoad.z;
	float core = vRoad.y, wear = vRoad.w;
	float n = vnz( vP / 9.0, 81.0 ), n2 = vnz( vP / 31.0, 82.0 );
	// worn verge, ragged at its edge, wider where the road is busiest
	float reach = core + ( vRoad.z - core ) * ( 0.3 + 0.7 * wear );
	float verge = 1.0 - smoothstep( core, reach * ( 0.75 + 0.3 * n2 ), d );
	// braided tracks beside the made road
	float tr = lineCov( abs( fract( d / ( 2.6 + 1.2 * n2 ) + n * 0.6 ) - 0.5 ) * ( 2.6 + 1.2 * n2 ), 0.45 ) * ( 1.0 - smoothstep( core * 0.8, reach * 0.8, d ) );
	vec3 earth = mix( SRGB( 122, 108, 84 ), SRGB( 98, 88, 70 ), n );
	vec3 c = mix( SRGB( 128, 122, 88 ), earth, max( smoothstep( core * 1.5, core * 0.9, d ), tr * 0.8 ) );
	float a = max( verge * ( 0.35 + 0.4 * wear ) * ( 0.7 + 0.3 * n ), step( d, core ) * 0.9 );
	a = max( a, tr * 0.75 * ( 1.0 - step( d, core ) ) );
	gl_FragColor = vec4( c * a, a );
}`;

// Arable strips the site data places (`field-strips`): crop tones strip by strip along the given bearing.
const STRIP_FRAG = /* glsl */ `
${LAND_GLSL}
${COMMON}
uniform vec2 uAcross;
uniform float uPitch, uSeed;
varying vec2 vP;
void main() {
	float u = dot( vP, uAcross ) / ( uPitch * 2.0 );
	float si = floor( u );
	float sh = hsh( vec2( si, uSeed ), 91.0 );
	vec3 c = sh < 0.6 ? mix( SRGB( 182, 164, 100 ), SRGB( 160, 154, 94 ), sh / 0.6 ) : mix( SRGB( 116, 128, 66 ), SRGB( 140, 142, 80 ), ( sh - 0.6 ) / 0.4 );
	c *= 0.92 + 0.12 * vnz( vP / 4.0, 92.0 );
	gl_FragColor = vec4( c * 0.85, 0.85 );
}`;
const STRIP_VERT = /* glsl */ `
varying vec2 vP;
void main() { vP = position.xz; gl_Position = projectionMatrix * viewMatrix * vec4( position.x, 0.0, position.z, 1.0 ); }`;

interface Target {
  rt: THREE.WebGLRenderTarget;
  cam: THREE.OrthographicCamera;
  box: THREE.Vector4; // x0, z0, 1/w, 1/d
  texel: number;
}

export class LandBake {
  /** Uniforms the live ground shader reads. */
  readonly uniforms = {
    tLand: { value: null as THREE.Texture | null },
    tLandFar: { value: null as THREE.Texture | null },
    tLandMid: { value: null as THREE.Texture | null },
    uLandBox: { value: new THREE.Vector4() },
    uMidBox: { value: new THREE.Vector4() },
    uFarBox: { value: new THREE.Vector4() },
  };
  private near: Target;
  private mid: Target;
  private far: Target;
  private scene = new THREE.Scene();
  private proxy: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private roadMat: THREE.ShaderMaterial;
  private roads: THREE.Mesh | null = null;
  private roadWear: { attr: THREE.BufferAttribute; pts: { x: number; z: number; i: number }[] } | null = null;
  private stripMeshes: THREE.Mesh[] = [];
  private dirty = true;
  private farKey = "";
  private farDirty = true;
  readonly ground: SiteGround;

  constructor(private ds: Dataset, private terrain: TerrainModel, geometry: THREE.BufferGeometry, quality: number, apron: [number, number, number, number]) {
    this.ground = siteGround(ds.site.id);
    const b = ds.site.bounds;
    const margin = 260;
    const mk = (x0: number, z0: number, x1: number, z1: number, maxRes: number): Target => {
      const w = x1 - x0, d = z1 - z0;
      const rw = w >= d ? maxRes : Math.round((maxRes * w) / d), rh = d > w ? maxRes : Math.round((maxRes * d) / w);
      const rt = new THREE.WebGLRenderTarget(rw, rh, {
        type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, depthBuffer: false, generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      });
      rt.texture.anisotropy = 8;
      rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const cam = new THREE.OrthographicCamera(x0 - cx, x1 - cx, -(z0 - cz), -(z1 - cz), 1, 6000);
      cam.position.set(cx, 3000, cz);
      cam.up.set(0, 0, -1);
      cam.lookAt(cx, 0, cz);
      cam.updateMatrixWorld();
      return { rt, cam, box: new THREE.Vector4(x0, z0, 1 / w, 1 / d), texel: Math.max(w / rw, d / rh) };
    };
    this.near = mk(b.xMin - margin, b.zMin - margin, b.xMax + margin, b.zMax + margin, quality >= 2 ? 4096 : 2048);
    this.mid = mk(b.xMin - 4000, b.zMin - 4000, b.xMax + 4000, b.zMax + 4000, 2048);
    this.far = mk(apron[0], apron[1], apron[2], apron[3], 2048);
    this.uniforms.tLand.value = this.near.rt.texture;
    this.uniforms.tLandMid.value = this.mid.rt.texture;
    this.uniforms.uMidBox.value.copy(this.mid.box);
    this.uniforms.tLandFar.value = this.far.rt.texture;
    this.uniforms.uLandBox.value.copy(this.near.box);
    this.uniforms.uFarBox.value.copy(this.far.box);

    this.mat = new THREE.ShaderMaterial({
      vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
      uniforms: {
        uFarm: { value: 0 }, uPre: { value: 0 }, uOpen: { value: 0 }, uArable: { value: 0 }, uChalk: { value: this.ground.chalk },
        uRiver: { value: terrain.hasRiver ? 1 : 0 }, uTexel: { value: 1 }, uBaseAng: { value: this.ground.baseAng },
        uSite: { value: new THREE.Vector4(b.xMin, b.zMin, b.xMax, b.zMax) }, uCover: { value: 0 }, uMoistOut: { value: 0.5 },
      },
    });
    this.proxy = new THREE.Mesh(geometry, this.mat);
    this.proxy.frustumCulled = false;
    this.proxy.renderOrder = 0;
    this.scene.add(this.proxy);
    this.roadMat = new THREE.ShaderMaterial({
      vertexShader: ROAD_VERT, fragmentShader: ROAD_FRAG, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      uniforms: { uT: { value: 0 }, uTexel: { value: 1 }, uBaseAng: { value: 0 } },
    });
    this.buildRoads();
    this.buildStrips();
  }

  /** Dated road ribbons (rebuilt once; each carries its years and a wear factor refreshed with the year). */
  private buildRoads(): void {
    const { ds, terrain } = this;
    const pos: number[] = [], road: number[] = [], life: number[] = [], idx: number[] = [];
    const pts: { x: number; z: number; i: number }[] = [];
    const tEnd = histToT(ds.site.timeline.end) + 1;
    for (const lm of ds.landmarks) {
      const lpath = (lm.path ?? []).map(([la, lo]) => terrain.proj.toLocal(la, lo));
      for (const ph of lm.phases) {
        if (ph.model.kind !== "road") continue;
        const mm = ph.model as Record<string, unknown>;
        const path = Array.isArray(mm.path) ? (mm.path as [number, number][]).map(([la, lo]) => terrain.proj.toLocal(la, lo)) : lpath;
        if (path.length < 2) continue;
        const w = typeof mm.width === "number" ? mm.width : 5;
        const core = w / 2;
        const t0 = histToT(ph.from), t1 = ph.goneBy != null ? histToT(ph.goneBy) : ph.to != null ? histToT(ph.to) + 4 : tEnd + 1;
        // resample to about 15 m so the wear can vary along the road
        const dense: [number, number][] = [];
        for (let i = 1; i < path.length; i++) {
          const [ax, az] = path[i - 1], [bx, bz] = path[i];
          const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 15));
          for (let k = i === 1 ? 0 : 1; k <= n; k++) dense.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
        }
        const base = pos.length / 3;
        for (let i = 0; i < dense.length; i++) {
          const [x, z] = dense[i];
          const [px, pz] = dense[Math.max(0, i - 1)], [nx, nz] = dense[Math.min(dense.length - 1, i + 1)];
          const dx = nx - px, dz = nz - pz, l = Math.hypot(dx, dz) || 1;
          const ox = -dz / l, oz = dx / l;
          // the ribbon is drawn at its widest (wear 1); the shader narrows the verge where the wear is less
          const outer = core * 2.2 + 14;
          for (const s of [-1, 1]) {
            pos.push(x + ox * outer * s, 0, z + oz * outer * s);
            road.push(s, core, outer, 0);
            life.push(t0, t1);
            pts.push({ x, z, i: pos.length / 3 - 1 });
          }
          if (i > 0) {
            const a = base + (i - 1) * 2;
            idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          }
        }
      }
    }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const ra = new THREE.Float32BufferAttribute(road, 4);
    g.setAttribute("aRoad", ra);
    g.setAttribute("aLife", new THREE.Float32BufferAttribute(life, 2));
    g.setIndex(idx);
    this.roads = new THREE.Mesh(g, this.roadMat);
    this.roads.frustumCulled = false;
    this.roads.renderOrder = 2;
    this.scene.add(this.roads);
    this.roadWear = { attr: ra, pts };
  }

  /** The site's own arable strips (field-strips landmarks), drawn over the generic layout. */
  private buildStrips(): void {
    const { ds, terrain } = this;
    const polys = (ds.site.polygons ?? {}) as Record<string, { points?: [number, number][] } | [number, number][]>;
    for (const lm of ds.landmarks) {
      const lpath = (lm.path ?? []).map(([la, lo]) => terrain.proj.toLocal(la, lo));
      for (const ph of lm.phases) {
        if (ph.model.kind !== "field-strips") continue;
        const mm = ph.model as Record<string, unknown>;
        let ring = lpath;
        if (Array.isArray(mm.path)) ring = (mm.path as [number, number][]).map(([la, lo]) => terrain.proj.toLocal(la, lo));
        else if (typeof mm.polygon === "string") {
          const pp = polys[mm.polygon];
          const pts = Array.isArray(pp) ? pp : pp?.points;
          if (pts) ring = pts.map(([la, lo]) => terrain.proj.toLocal(la, lo));
        }
        if (ring.length < 3) continue;
        const shape = ring.map(([x, z]) => new THREE.Vector2(x, z));
        const tris = THREE.ShapeUtils.triangulateShape(shape, []);
        const pos: number[] = [];
        for (const [a, b, c] of tris) for (const k of [a, b, c]) pos.push(shape[k].x, 0, shape[k].y);
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        const th = ((typeof mm.bearing === "number" ? mm.bearing : 0) * Math.PI) / 180;
        const pitch = Math.max(3, typeof mm.pitch === "number" ? mm.pitch : 9);
        const mat = new THREE.ShaderMaterial({
          vertexShader: STRIP_VERT, fragmentShader: STRIP_FRAG, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
          blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
          blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
          uniforms: { uAcross: { value: new THREE.Vector2(Math.cos(th), Math.sin(th)) }, uPitch: { value: pitch }, uSeed: { value: this.stripMeshes.length * 17 + 3 }, uTexel: { value: 1 }, uBaseAng: { value: 0 } },
        });
        const m = new THREE.Mesh(g, mat);
        m.frustumCulled = false;
        m.renderOrder = 1;
        m.userData.life = [histToT(ph.from), ph.to != null ? histToT(ph.to) + 4 : Infinity];
        this.stripMeshes.push(m);
        this.scene.add(m);
      }
    }
  }

  /**
   * New year: period weights, road wear. `wearAt(x, z)` gives how trodden the ground beside a road is (0..1) from
   * the settlements and bridges standing that year.
   */
  update(t: number, cover: number, moistMean: number, wearAt: (x: number, z: number) => number): void {
    const pw = periodWeights(t, this.ground);
    const u = this.mat.uniforms;
    u.uCover.value = cover;
    u.uMoistOut.value = moistMean;
    u.uFarm.value = pw.farm;
    u.uPre.value = pw.pre;
    u.uOpen.value = pw.open;
    u.uArable.value = pw.arable;
    this.roadMat.uniforms.uT.value = t;
    if (this.roadWear) {
      const { attr, pts } = this.roadWear;
      for (const p of pts) attr.setW(p.i, wearAt(p.x, p.z));
      attr.needsUpdate = true;
    }
    for (const m of this.stripMeshes) {
      const [a, b] = m.userData.life as [number, number];
      m.visible = t >= a && t <= b;
    }
    // the far texture only needs redoing when its broad character changes
    const fk = [pw.farm, pw.pre, pw.open, pw.arable, cover, moistMean].map((v) => v.toFixed(2)).join();
    if (fk !== this.farKey) {
      this.farKey = fk;
      this.farDirty = true;
    }
    this.dirty = true;
  }

  get needsBake(): boolean {
    return this.dirty;
  }

  /** Render the textures (called from the terrain mesh's onBeforeRender, when flagged). */
  render(renderer: THREE.WebGLRenderer): void {
    if (!this.dirty) return;
    this.dirty = false;
    const prevRT = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x444433, 1);
    const draw = (tg: Target, details: boolean) => {
      this.mat.uniforms.uTexel.value = tg.texel;
      this.roadMat.uniforms.uTexel.value = tg.texel;
      if (this.roads) this.roads.visible = details;
      for (const m of this.stripMeshes) {
        (m.material as THREE.ShaderMaterial).uniforms.uTexel.value = tg.texel;
        if (!details) m.visible = false;
      }
      renderer.setRenderTarget(tg.rt);
      renderer.clear(true, false, false);
      renderer.render(this.scene, tg.cam);
    };
    try {
      draw(this.near, true);
      if (this.farDirty) {
        this.farDirty = false;
        const vis = this.stripMeshes.map((m) => m.visible);
        draw(this.mid, false);
        draw(this.far, false);
        this.stripMeshes.forEach((m, i) => (m.visible = vis[i]));
      }
    } finally {
      renderer.setRenderTarget(prevRT);
      renderer.setClearColor(prevClear, prevAlpha);
      renderer.shadowMap.autoUpdate = prevShadow;
    }
  }

  dispose(): void {
    this.near.rt.dispose();
    this.mid.rt.dispose();
    this.far.rt.dispose();
    this.mat.dispose();
    this.roadMat.dispose();
    this.roads?.geometry.dispose();
    for (const m of this.stripMeshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
