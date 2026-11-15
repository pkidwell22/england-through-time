import * as THREE from "three";
import { lifeUniforms } from "../life";

/**
 * Per-house character for the instanced fabric, all on the GPU (no new textures):
 *
 * Shape (vertex shader; every part of a house moves with the same smooth field, so nothing separates):
 *  - overall height +-6 %, roof pitch -13..+19 % (aRoof.y = height above the eaves),
 *  - ridge sag (aRoof.x), growing with the house's age,
 *  - a gentle upward wander of wall tops, eaves and ridges (a few cm, never down, so an eave never uncovers a wall),
 *  - out of plumb: towards or away from the street; sideways only for free-standing houses (row houses keep
 *    their party walls), and a street house set a few cm back from its neighbour's line.
 * Wear (fragment shader, by material class):
 *  - walls: a limewash coat of its own per house (cream, ochre, grey), worn in patches; rising damp and splash
 *    with a ragged top; run-off streaks below rails, sills and eaves; general grime with age; soot at stack tops,
 *  - timber: silvering and damp at the foot,
 *  - roofs: repaired patches in other tones, moss and lichen (more on north-facing slopes and towards the eaves),
 *    soot round chimney tops and smoke vents streaking down the slope (aRoof.z),
 *  - openings: the room behind (interior mapping in the opening's own UVs: reveal, side walls, floor, back wall,
 *    darker with depth), also seen through leaded glass under its reflections.
 * Per instance: aFx.z = seed (0..1) + 2 x mode (0 street row, 1 free-standing, 2 rigid: churches, great houses,
 * Roman masonry: wear only). Age = years since the house was finished (aLife.y), against the timeline year.
 * `?houses=plain` turns all of it off (and the fabric then builds no alternates), for before/after comparisons.
 */

export const HOUSE_FX_OFF = typeof location !== "undefined" && /[?&]houses=plain/.test(location.search);
/** `?houses=noalt`: everything but the alternate designs (for measuring what they cost). */
export const HOUSE_NO_ALT = HOUSE_FX_OFF || (typeof location !== "undefined" && /[?&]houses=noalt/.test(location.search));
/**
 * Alternates drawn per street variant (`?houses=alt2` etc. for measurement). One by default: each alternate design
 * adds its own meshes (draw calls in every pass); with two the bridgehead view ran about 5 ms slower than with none,
 * with one about 1 ms. Which of a variant's alternates is used rotates with the variant, so both kinds appear.
 */
export const HOUSE_MAX_ALT = (() => {
  const m = typeof location !== "undefined" ? /[?&]houses=alt(\d)/.exec(location.search) : null;
  return m ? +m[1] : 1;
})();

/**
 * The fabric draws fewer materials than the builders name, to save draw calls: every dark opening (interiors seen
 * through shop fronts and doors, plain dark holes) is one "opening" material (the room behind is drawn by interior
 * mapping where the UVs carry the opening's size); beyond the near model, plank boards share the oak timber material.
 */
export function fabricMaterialName(name: string, lod: number): string {
  if (HOUSE_FX_OFF) return name; // ?houses=plain: the fabric as it was before this round
  if (name === "interior" || name === "dark") return "opening";
  if (lod >= 1 && name === "planks") return "oak";
  // beyond the near model a leaded light is a few pixels: drawn as the dark room behind it, without the glass
  if (lod >= 1 && name === "glass-leaded") return "opening";
  return name;
}

/** Flat fittings that sit on a wall and cast no shadow worth a draw call in every shadow cascade. */
/** `?houses=farbase`: alternates share the base design's distant model (fewer draw calls, but a house changes form at LOD_FAR). */
export const HOUSE_FAR_BASE = typeof location !== "undefined" && /[?&]houses=farbase/.test(location.search);

export const NO_SHADOW = new Set(HOUSE_FX_OFF ? [] : ["opening", "glass-leaded", "glass", "iron", "sign", "rubble"]);
export const houseFxUniform = { value: HOUSE_FX_OFF ? 0 : 1 };
// debug hook: window.__houseFx.value = 0 switches the shape and wear off live (for in-page timing comparisons)
if (typeof window !== "undefined") (window as unknown as { __houseFx?: { value: number } }).__houseFx = houseFxUniform;

export type HouseClass = "wall" | "stone" | "wood" | "roof" | "thatch" | "opening" | "glass" | null;

export function houseClassOf(name: string): HouseClass {
  if (name.startsWith("fwall-") || name.startsWith("frame") || name === "daub" || name === "plaster" || name === "whitewash") return "wall";
  if (["rubble", "ragstone", "roman-rubble", "brick-tudor", "brick", "caen", "ashlar"].includes(name)) return "stone";
  if (["oak", "timber", "timber-weathered", "planks"].includes(name)) return "wood";
  if (["tile", "tile-old", "tegula", "shingle"].includes(name)) return "roof";
  if (name === "thatch" || name === "thatch-old") return "thatch";
  if (name === "opening") return "opening";
  if (name === "glass-leaded") return "glass";
  return null;
}

/** Shape field, shared by the colour and the shadow (depth) programs. */
const SHAPE_GLSL = `
{
  float hMode = floor(aFx.z * 0.5);
  float hS = aFx.z - hMode * 2.0;
  float hAge = clamp((uYear - aLife.y) / 70.0, 0.0, 1.0);
  #ifdef HOUSE_VARYINGS
  vHPos = transformed;
  vHNrm = objectNormal;
  vHA = vec4(hS, hAge, aRoof.z, aRoof.y);
  #endif
  if (uHouseFx > 0.5 && hMode < 1.5 && aFx.z > 0.0) {
    float h1 = fract(hS * 7.13 + 0.17), h2 = fract(hS * 13.71 + 0.31), h3 = fract(hS * 29.37 + 0.53);
    float h4 = fract(hS * 51.13 + 0.71), h5 = fract(hS * 83.97 + 0.11), h6 = fract(hS * 101.3 + 0.29);
    float settle = 0.35 + 0.65 * hAge;
    float yy = max(transformed.y, 0.0);
    transformed.y += yy * (h1 - 0.5) * 0.12;
    transformed.y += aRoof.y * (h2 - 0.4) * 0.32;
    transformed.y -= aRoof.x * (0.06 + h3 * 0.3) * settle;
    float wob = 0.5 + 0.5 * sin(transformed.x * 1.3 + transformed.z * 0.9 + hS * 40.0) * sin(transformed.x * 0.47 - transformed.z * 0.71 + hS * 17.0);
    transformed.y += wob * 0.035 * clamp((yy - 2.0) / 3.0, 0.0, 1.0);
    transformed.z += yy * (h4 - 0.42) * 0.016 * settle;
    transformed.x += yy * (h5 - 0.5) * 0.014 * hMode;
    transformed.z -= (1.0 - hMode) * h6 * 0.08;
  }
}
`;

const VERT_DECL = `
attribute vec3 aRoof;
uniform float uHouseFx;
#ifdef HOUSE_VARYINGS
varying vec3 vHPos;
varying vec3 vHNrm;
varying vec4 vHA;
#endif
#ifdef HOUSE_OPENUV
varying vec2 vOpenUv;
varying vec2 vOpenSize;
#endif
`;

/** Opening UVs (see street/kit.ts openingUv): position in the light 0..1 and the light's size; glass texture at its real scale. */
const OPENUV_GLSL = `
#ifdef HOUSE_OPENUV
  vec2 hK = floor((uv - 1000.0) * 0.25);
  bool hEnc = uv.x > 999.0;
  vOpenSize = hEnc ? hK * 0.02 : vec2(0.0);
  vOpenUv = hEnc ? uv - 1000.0 - hK * 4.0 : uv;
  vec2 hTexUv = hEnc ? vOpenUv * vOpenSize / HOUSE_GLASS_TILE : uv;
  #ifdef MAP_UV
  #undef MAP_UV
  #define MAP_UV hTexUv
  #endif
  #ifdef NORMALMAP_UV
  #undef NORMALMAP_UV
  #define NORMALMAP_UV hTexUv
  #endif
  #ifdef ROUGHNESSMAP_UV
  #undef ROUGHNESSMAP_UV
  #define ROUGHNESSMAP_UV hTexUv
  #endif
  #ifdef METALNESSMAP_UV
  #undef METALNESSMAP_UV
  #define METALNESSMAP_UV hTexUv
  #endif
#endif
#include <uv_vertex>
`;

const FRAG_DECL = `
uniform float uHouseFx;
varying vec3 vHPos;
varying vec3 vHNrm;
varying vec4 vHA;
#ifdef HOUSE_OPENUV
varying vec2 vOpenUv;
varying vec2 vOpenSize;
#endif
float hHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hHash(i), hHash(i + vec2(1.0, 0.0)), u.x), mix(hHash(i + vec2(0.0, 1.0)), hHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
#ifdef HOUSE_OPENUV
// The room behind an opening, by interior mapping in the opening's own frame (u, v across the light, depth in metres):
// the reveal (the wall's thickness) near the front, then side walls, floor, ceiling and back wall, darker with depth.
vec3 hRoom(vec2 ouv, float seed) {
  vec3 P = -vViewPosition;
  vec3 dp1 = dFdx(P), dp2 = dFdy(P);
  vec2 du1 = dFdx(ouv), du2 = dFdy(ouv);
  float det = du1.x * du2.y - du2.x * du1.y;
  if (abs(det) < 1e-14) return vec3(0.02);
  vec3 Pu = (dp1 * du2.y - dp2 * du1.y) / det;
  vec3 Pv = (dp2 * du1.x - dp1 * du2.x) / det;
  vec3 N = normalize(cross(Pu, Pv));
  vec3 V = normalize(P);
  float c = -dot(V, N);
  if (c <= 0.02) return vec3(0.02);
  float a = dot(V, Pu) / dot(Pu, Pu);
  float b = dot(V, Pv) / dot(Pv, Pv);
  float D = 2.2 + 2.5 * seed;
  float tu = a > 0.0 ? (1.0 - ouv.x) / a : (a < 0.0 ? -ouv.x / a : 1e9);
  float tv = b > 0.0 ? (1.0 - ouv.y) / b : (b < 0.0 ? -ouv.y / b : 1e9);
  float tz = D / c;
  float t = min(min(tu, tv), tz);
  float depth = c * t;
  vec2 hit = ouv + vec2(a, b) * t;
  float k = exp(-depth * 0.85);
  vec3 col;
  if (depth < 0.17 && t < tz) {
    // reveal: limewashed jambs, a lighter sill, a shadowed head
    col = vec3(0.15, 0.135, 0.11) * (tv < tu ? (b < 0.0 ? 1.2 : 0.35) : 0.75);
  } else if (t == tz) {
    // back wall: dim, with a darker band of furniture low down and a little variation
    float f = smoothstep(0.42, 0.38, hit.y) * step(0.15 + 0.5 * seed, fract(hit.x * 1.7 + seed));
    col = vec3(0.03, 0.025, 0.02) * (0.7 + 0.6 * hHash(floor(hit * 3.0) + seed)) * (1.0 - 0.5 * f) * (0.5 + 0.5 * k);
  } else if (tv < tu) {
    col = b < 0.0 ? vec3(0.08, 0.06, 0.042) * (0.25 + 0.75 * k) : vec3(0.022, 0.018, 0.015) * (0.4 + 0.6 * k);
  } else {
    col = vec3(0.06, 0.05, 0.04) * (0.2 + 0.8 * k);
  }
  return col;
}
#endif
`;

const FRAG_BODY = `
#include <color_fragment>
// beyond the district models (about 300 m) the wear is below a pixel's worth: skip it there
if (uHouseFx > 0.5 && dot(vViewPosition, vViewPosition) < 90000.0) {
  float hs = vHA.x, hage = vHA.y;
  vec3 hp = vHPos;
  vec3 hc = diffuseColor.rgb;
#if defined(HOUSE_WALL) || defined(HOUSE_STONE) || defined(HOUSE_WOOD)
  float hvert = 1.0 - abs(vHNrm.y);
  float halong = abs(vHNrm.z) > abs(vHNrm.x) ? hp.x : hp.z;
  float hnA = hNoise(vec2(halong * 0.55 + hs * 31.0, hp.y * 0.45));
  float hnB = hNoise(vec2(halong * 2.3 + hs * 7.0, hp.y * 1.9 + hs * 3.0));
  #ifdef HOUSE_WALL
  // bright texels are the limewashed panels, dark ones the timbers
  float hl = dot(hc, vec3(0.299, 0.587, 0.114));
  float hpanel = smoothstep(0.16, 0.4, hl);
  // each house its own coat: lime white, cream, ochre-washed or grey; patches where it has worn through to the
  // daub or been renewed, darker and browner the older the coat
  vec3 hwash = mix(vec3(1.02, 0.99, 0.93), vec3(1.0, 0.86, 0.64), fract(hs * 3.7) * fract(hs * 3.7));
  hwash = mix(hwash, vec3(0.86, 0.86, 0.84), step(0.8, fract(hs * 5.3)));
  hc = mix(hc, hc * hwash, hpanel);
  float hworn = smoothstep(0.38, 0.75, hnA * 0.7 + hnB * 0.3) * (0.5 + 0.5 * hage);
  hc = mix(hc, hc * vec3(0.74, 0.68, 0.58), hworn * hpanel);
  // small blotches and flaking low down and round the openings' height
  float hbl = smoothstep(0.62, 0.8, hNoise(vec2(halong * 3.1 + hs * 13.0, hp.y * 2.7)));
  hc = mix(hc, hc * vec3(0.8, 0.76, 0.68), hbl * hpanel * (0.5 + 0.5 * hage));
  hc *= mix(1.0, 1.07, smoothstep(0.75, 0.95, hNoise(vec2(halong * 0.3 + hs * 9.0, hp.y * 0.3))) * hpanel * (1.0 - hage));
  // timbers: some left to silver, some tarred or ochre-oiled
  vec3 htim = mix(vec3(1.08, 1.06, 1.04), vec3(0.72, 0.62, 0.52), fract(hs * 11.3));
  hc = mix(hc * htim, hc, hpanel);
  #endif
  #ifdef HOUSE_WOOD
  hc = mix(hc, vec3(dot(hc, vec3(0.33))) * vec3(1.02, 1.0, 0.96), 0.15 + 0.35 * hage * fract(hs * 9.7));
  #endif
  // street dirt: splash and rising damp up to a ragged line 0.5-1.4 m up, greenish-brown, darker at the foot
  float htop = 0.7 + 0.6 * fract(hs * 5.31) + 0.5 * hage + (hnB - 0.5) * 0.6;
  float hdamp = (1.0 - smoothstep(htop - 0.6, htop, hp.y)) * hvert;
  hc = mix(hc, hc * vec3(0.45, 0.42, 0.35), hdamp * (0.7 + 0.3 * hage));
  // a sharper tide line where the damp stops, and splash right at the foot
  hc *= 1.0 - 0.12 * hvert * smoothstep(0.12, 0.0, abs(hp.y - htop + 0.08)) * (0.4 + 0.6 * hage);
  hc *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.45, hp.y)) * hvert;
  // run-off streaks below rails, sills and the eaves
  float hst = hNoise(vec2(halong * 6.0 + hs * 19.0, hp.y * 0.15 + hs));
  hc *= 1.0 - smoothstep(0.5, 0.9, hst) * hvert * smoothstep(0.8, 2.5, hp.y) * (0.45 + 0.55 * hage) * 0.38;
  // general grime: older houses darker and greyer overall, some kept better than others
  float hdirt = (0.4 + 0.6 * hage) * (0.5 + fract(hs * 17.3));
  hc = mix(hc, vec3(dot(hc, vec3(0.33))) * vec3(1.0, 0.97, 0.9), 0.14 * hdirt);
  hc *= 1.0 - 0.12 * hdirt;
  hc *= 1.0 - 0.7 * smoothstep(0.15, 0.9, vHA.z);
#endif
#if defined(HOUSE_ROOF) || defined(HOUSE_THATCH)
  vec3 hwn = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
  float hnorth = clamp(-hwn.z * 1.6 + 0.35, 0.0, 1.0) * smoothstep(0.1, 0.4, hwn.y);
  vec2 hq = hp.xz;
  float hn1 = hNoise(hq * 0.75 + hs * 23.0);
  float hn2 = hNoise(hq * 2.9 + hs * 5.0);
  float hn3 = hNoise(hq * 8.0 + hs * 11.0);
  hc *= 0.82 + 0.34 * hNoise(hq * 1.4 + vec2(hs * 41.0, hp.y * 0.5));
  float heave = 1.0 - clamp(vHA.w / 3.5, 0.0, 1.0);
  float hmoss = smoothstep(0.5, 0.78, hn1 * 0.6 + hn2 * 0.4) * (0.2 + 0.8 * hnorth) * (0.15 + 0.85 * hage) * (0.45 + 0.55 * heave);
  #ifdef HOUSE_THATCH
  hc = mix(hc, vec3(0.13, 0.14, 0.07) * (0.8 + 0.4 * hn3), hmoss * 0.8);
  hc = mix(hc, vec3(dot(hc, vec3(0.33))) * vec3(0.95, 0.95, 0.92), 0.3 * hage);
  hc *= 1.0 - 0.6 * vHA.z * (0.5 + 0.5 * hn2);
  #else
  hc = mix(hc, vec3(0.13, 0.15, 0.07) * (0.8 + 0.4 * hn3), hmoss * 0.55);
  hc = mix(hc, hc * vec3(1.25, 1.2, 1.0), smoothstep(0.82, 0.95, hn3) * smoothstep(0.5, 0.75, hn2) * hage * 0.5);
  hc *= 1.0 - 0.6 * vHA.z * (0.5 + 0.5 * hn2);
  hc = mix(hc, vec3(dot(hc, vec3(0.33))), 0.16 * hage);
  #endif
#endif
#ifdef HOUSE_OPENING
  hc = vOpenSize.x > 0.0 ? hRoom(vOpenUv, fract(hs * 7.0 + vOpenSize.x * 3.1 + vOpenSize.y * 1.7)) : hc;
#endif
#ifdef HOUSE_GLASS
  // old glass is greenish and not very clear: the room shows through it, dimmed
  if (vOpenSize.x > 0.0) hc = hc * 0.35 + hRoom(vOpenUv, fract(hs * 7.0 + vOpenSize.x * 3.1 + vOpenSize.y * 1.7)) * vec3(0.5, 0.56, 0.5);
#endif
  diffuseColor.rgb = hc;
}
`;

/** Glass in the fabric is a dielectric: dark at a glance, reflecting at a slant (Fresnel), not a tinted mirror. */
const GLASS_METAL = `
#include <metalnessmap_fragment>
#ifdef HOUSE_GLASS
if (uHouseFx > 0.5) metalnessFactor = 0.0;
#endif
`;

/** Add the house shape and wear to a life-patched fabric material (call after patchLife). */
export function patchHouse<T extends THREE.Material>(mat: T, cls: HouseClass): T {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  const openUv = cls === "opening" || cls === "glass";
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uHouseFx = houseFxUniform;
    shader.uniforms.uYear = lifeUniforms.uYear;
    const defs = `#define HOUSE_VARYINGS\n${openUv ? "#define HOUSE_OPENUV\n#define HOUSE_GLASS_TILE 0.6\n" : ""}${cls ? `#define HOUSE_${cls.toUpperCase()}\n` : ""}`;
    shader.vertexShader = defs + VERT_DECL + shader.vertexShader
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + SHAPE_GLSL)
      .replace("#include <uv_vertex>", OPENUV_GLSL);
    // the helpers use the template's own varyings (vViewPosition), so they go just before main()
    shader.fragmentShader = defs + shader.fragmentShader
      .replace("void main() {", FRAG_DECL + "\nvoid main() {")
      .replace("#include <color_fragment>", FRAG_BODY)
      .replace("#include <metalnessmap_fragment>", GLASS_METAL);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|house:${cls ?? "none"}`;
  return mat;
}

/** Shadow (depth) material for the fabric: the life window and the same shape field. */
export function houseDepthMaterial(): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uYear = lifeUniforms.uYear;
    shader.uniforms.uHouseFx = houseFxUniform;
    shader.vertexShader =
      "attribute vec4 aLife;\nattribute vec3 aFx;\nuniform float uYear;\n" + VERT_DECL +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         ${SHAPE_GLSL}
         float lifeS = smoothstep(aLife.x, aLife.y, uYear) * (1.0 - smoothstep(aLife.z, aLife.w, uYear));
         transformed.y *= lifeS;
         if (lifeS < 0.004) transformed *= 0.0;`,
      );
  };
  m.customProgramCacheKey = () => "lifeDepthHouse";
  return m;
}
