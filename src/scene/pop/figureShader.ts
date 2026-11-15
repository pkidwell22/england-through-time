import * as THREE from "three";
import { motionUniforms } from "./motion";

/**
 * Crowd figures: instanced MakeHuman-based meshes skinned in the vertex shader from a baked animation texture
 * (see scripts/figures/ and docs/FIGURES.md). Each instance walks to and fro along a short straight piece exactly as
 * the old block figures did (same per-instance data and the same path formula as ./motion.ts), so placement, counts
 * and routes are unchanged; only the body and the way the limbs move differ.
 *
 *  - Skinning: 22 bones; the 3x4 skinning matrices of every body, frame and clip live in one float16 RGBA 3D texture
 *    (x = body * 66 + bone * 3 + row, y = frame, z = clip). Hardware filtering blends neighbouring frames (y) and
 *    neighbouring clips (z) in the same fetch: walking blends stand -> slow walk -> brisk walk by speed.
 *  - Gait: the walk phase advances with the distance walked plus v0 * time, so the stride is Sf * v / (v + v0)
 *    (shorter steps when slow) and the blend between the clips is chosen to give exactly that stride: a planted foot
 *    moves back with the ground and does not slide.
 *  - Outfits: every mesh carries all the garments of its period; a vertex is drawn only in the outfits its mask names
 *    (the others collapse to a point). Colours come per tint slot from the instance (the period palette).
 *  - The material is an ordinary MeshStandardMaterial patched with onBeforeCompile, so aerial perspective, cascaded
 *    sun shadows, cloud shadows and photo-mode vertex capture apply as to everything else.
 */

export const FIG_LAYERS = { stand: 0, slow: 1, brisk: 2, idle: 3, talk: 4, seated: 5, attention: 6 } as const;
/** instance modes (aMode.x) */
export const FIG_MODE = { auto: 0, idle: 1, talk: 2, seated: 3, attention: 4 } as const;

export interface FigureBodyParams {
  /** texel x offset of this body's matrices in the animation texture */
  x0: number;
  S1: number;
  S2: number;
  Sf: number;
  v0: number;
}

export interface FigureShared {
  anim: THREE.Data3DTexture;
  map: THREE.Texture;
  normalMap: THREE.Texture;
  dims: THREE.Vector4;
}

const VERT_PARS = /* glsl */ `
attribute vec4 aBase; attribute vec4 aMot; attribute vec4 aH; attribute vec3 aCol; attribute vec4 aVar;
attribute vec4 aPal; attribute vec4 aMode;
attribute vec4 _bones; attribute vec4 _weights; attribute vec4 _fig;
uniform float uTime;
uniform highp sampler3D uAnim;
uniform vec4 uAnimDim;   // width, height (frames), depth (clips), body texel offset
uniform vec4 uStride;    // S1, S2, Sf, v0
uniform float uNB;       // bones per vertex used at this level (0 = rest pose, 1, 2 or 4)
varying vec2 vRM;
varying float vFigFade;
vec3 figUnpack(float c) {
  float r = floor(c / 65536.0); float g = floor((c - r * 65536.0) / 256.0); float b = c - r * 65536.0 - g * 256.0;
  vec3 s = vec3(r, g, b) / 255.0;
  return s * s;  // stored as sqrt(linear) for precision in the darks
}
`;

/** Shared between the colour material and the depth material: skinning + path placement. Defines `transformed`, `figN`. */
const VERT_BODY = /* glsl */ `
float mL = aMot.x;
float mMoving = step(0.5, mL);
float mU = 0.0, mTri = 0.0, mSpd = 0.0, mW = 0.0, mD = 0.0;
if (mMoving > 0.5) {
  float cyc = aMot.y + uTime * aMot.z / (2.0 * mL);
  float nn = floor(cyc); mU = cyc - nn;
  mTri = 0.5 - 0.5 * cos(6.2831853 * mU);
  mSpd = abs(sin(6.2831853 * mU));
  const float tt = 0.05;
  if (mU < 0.5) mW = (mU < tt) ? 0.5 * (1.0 - smoothstep(0.0, tt, mU)) : smoothstep(0.5 - tt, 0.5 + tt, mU);
  else mW = (mU > 1.0 - tt) ? 1.0 - 0.5 * smoothstep(1.0 - tt, 1.0, mU) : smoothstep(0.5 - tt, 0.5 + tt, mU);
  mD = 2.0 * mL * nn + mL * (mU < 0.5 ? mTri : 2.0 - mTri);
}
float mYaw = atan(aBase.z, aBase.w) + 3.14159265 * mW;
float mCy = cos(mYaw), mSy = sin(mYaw);
// ---- clip and frame
float fy, fz;
if (mMoving > 0.5) {
  float v = 1.5707963 * aMot.z * mSpd;
  float s = uStride.z * v / (v + uStride.w);
  float z = s <= uStride.x ? s / uStride.x : 1.0 + clamp((s - uStride.x) / (uStride.y - uStride.x), 0.0, 1.0);
  fz = z;
  fy = (mD + uStride.w * uTime) / uStride.z + aMode.w;
} else {
  float md = aMode.x;
  float period = md > 2.5 ? (md > 3.5 ? 6.0 : 10.0) : 8.0;
  fz = md > 3.5 ? 6.0 : (md > 2.5 ? 5.0 : (md > 1.5 ? 4.0 : 3.0));
  fy = uTime / period + aMode.w;
}
float tz = (fz + 0.5) / uAnimDim.z;
float ty = fract(fy) + 0.5 / uAnimDim.y;
vec3 sp = vec3(0.0); vec3 sn = vec3(0.0);
float wsum = 0.0;
for (int k = 0; k < 4; k++) {
  if (float(k) >= uNB) break;
  float w = _weights[k];
  if (w <= 0.0) continue;
  float tx = uAnimDim.w + _bones[k] * 3.0;
  vec4 r0 = texture(uAnim, vec3((tx + 0.5) / uAnimDim.x, ty, tz));
  vec4 r1 = texture(uAnim, vec3((tx + 1.5) / uAnimDim.x, ty, tz));
  vec4 r2 = texture(uAnim, vec3((tx + 2.5) / uAnimDim.x, ty, tz));
  vec4 p4 = vec4(position, 1.0);
  sp += w * vec3(dot(r0, p4), dot(r1, p4), dot(r2, p4));
  sn += w * vec3(dot(r0.xyz, normal), dot(r1.xyz, normal), dot(r2.xyz, normal));
  wsum += w;
}
if (wsum > 0.0) { sp /= wsum; sn = normalize(sn); }
else { sp = position; sn = normal; }  // static levels (distant formations): the rest pose
// outfit: collapse what this instance does not wear
float figMask = _fig.z + 256.0 * _fig.w;
float figBit = mod(floor(figMask / exp2(floor(aVar.y + 0.5))), 2.0);
// presence (the populace's fade with the zone's activity): the block figures were scaled by it; a person is drawn at
// full size from the same threshold (so the same people are drawn) and only the faintest dissolve in
float figShow = figBit * step(0.02, aVar.z);
vFigFade = smoothstep(0.02, 0.3, aVar.z);
sp *= aVar.x;
vec2 mDir = aBase.zw;
vec2 mPerp = vec2(mDir.y, -mDir.x);
vec2 mXZ = aBase.xy + mDir * (mTri * mL) + mPerp * aMot.w;
float mF = mTri;
float mY = mF < 0.3333 ? mix(aH.x, aH.y, mF * 3.0) : (mF < 0.6667 ? mix(aH.y, aH.z, mF * 3.0 - 1.0) : mix(aH.z, aH.w, mF * 3.0 - 2.0));
vec3 transformed = vec3(mXZ.x + sp.x * mCy + sp.z * mSy, mY + sp.y, mXZ.y - sp.x * mSy + sp.z * mCy);
if (figShow < 0.5) transformed = vec3(0.0, -1.0e4, 0.0);
vec3 figN = vec3(sn.x * mCy + sn.z * mSy, sn.y, -sn.x * mSy + sn.z * mCy);
`;

const FADE_FRAG = /* glsl */ `
varying float vFigFade;
void main() {
  if (vFigFade < 0.999 && fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) > vFigFade) discard;
`;

const COLOR_BODY = /* glsl */ `
{
  float slot = _fig.x;
  float ao = _fig.y / 255.0;
  vec3 c;
  vec2 rm = vec2(0.88, 0.0);
  // skin: the populace's skin value, weighted towards the lighter end (see docs/FIGURES.md)
  if (slot < 0.5) { c = mix(vec3(0.40, 0.24, 0.17), vec3(0.16, 0.09, 0.065), pow(aVar.w, 2.2)); rm.x = 0.58; }
  else if (slot < 1.5) c = aCol;
  else if (slot < 2.5) c = figUnpack(aPal.x);
  else if (slot < 3.5) c = figUnpack(aPal.y);
  else if (slot < 4.5) c = figUnpack(aPal.z);
  else if (slot < 5.5) { c = vec3(0.47, 0.44, 0.36) * (0.8 + 0.25 * fract(aMode.w * 7.3)); rm.x = 0.82; }
  else if (slot < 6.5) { c = vec3(0.15, 0.085, 0.045) * (0.75 + 0.5 * fract(aMode.w * 3.7)); rm.x = 0.62; }
  else if (slot < 7.5) { c = figUnpack(aPal.w); rm.x = 0.72; }
  else if (slot < 8.5) { c = vec3(0.30, 0.30, 0.31); rm = vec2(0.42, 0.75); }
  else if (slot < 9.5) { c = vec3(0.46, 0.44, 0.41) * ao * ao; ao = 1.0; rm.x = 0.3; }
  else { c = vec3(0.40, 0.36, 0.29) * (0.85 + 0.3 * fract(aMode.w * 5.1)); }
  // dyed wool in daylight: a little less saturated and darker than the flat palette swatches
  if (slot > 0.5 && slot < 4.5) c = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 0.82) * 0.92;
  // the detail atlas has a mean of about 0.85: compensate here so palette colours keep their value
  vColor = c * (0.35 + 0.65 * ao) / 0.85;
  vRM = rm;
}
`;

export function figureMaterial(sh: FigureShared, body: FigureBodyParams, lod: number, key: string, still = false): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, map: sh.map, normalMap: sh.normalMap, side: THREE.DoubleSide });
  mat.normalScale.set(0.55, 0.55);
  mat.name = "figure";
  const stride = new THREE.Vector4(body.S1, body.S2, body.Sf, body.v0);
  const dims = new THREE.Vector4(sh.dims.x, sh.dims.y, sh.dims.z, body.x0);
  const nb = still ? 0 : lod === 0 ? 4 : lod === 1 ? 2 : 1;
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = motionUniforms.uTime;
    s.uniforms.uAnim = { value: sh.anim };
    s.uniforms.uAnimDim = { value: dims };
    s.uniforms.uStride = { value: stride };
    s.uniforms.uNB = { value: nb };
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_PARS)
      // skinning and placement run where three starts the normal (before begin_vertex), so both use them
      .replace("#include <beginnormal_vertex>", VERT_BODY + "\nvec3 objectNormal = figN;\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(1.0, 0.0, 0.0);\n#endif")
      .replace("#include <begin_vertex>", "")
      .replace("#include <color_vertex>", "#include <color_vertex>\n" + COLOR_BODY)
      // painted garments on the coarse levels use the body's UVs: read the cloth half of the atlas for them
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\nif (_fig.x > 0.5 && vMapUv.x < 0.5) vMapUv.x += 0.5;\n#endif\n#ifdef USE_NORMALMAP\nif (_fig.x > 0.5 && vNormalMapUv.x < 0.5) vNormalMapUv.x += 0.5;\n#endif");
    s.fragmentShader = s.fragmentShader
      .replace("void main() {", FADE_FRAG)
      .replace("#include <common>", "#include <common>\nvarying vec2 vRM;")
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = vRM.x;")
      .replace("#include <metalnessmap_fragment>", "float metalnessFactor = vRM.y;");
  };
  mat.customProgramCacheKey = () => `figure-${key}-${nb}`;
  return mat;
}

export function figureDepthMaterial(sh: FigureShared, body: FigureBodyParams, lod: number, key: string, still = false): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const stride = new THREE.Vector4(body.S1, body.S2, body.Sf, body.v0);
  const dims = new THREE.Vector4(sh.dims.x, sh.dims.y, sh.dims.z, body.x0);
  const nb = still ? 0 : lod === 0 ? 2 : 1;
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = motionUniforms.uTime;
    s.uniforms.uAnim = { value: sh.anim };
    s.uniforms.uAnimDim = { value: dims };
    s.uniforms.uStride = { value: stride };
    s.uniforms.uNB = { value: nb };
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_PARS.replace("varying vec2 vRM;", ""))
      .replace("#include <begin_vertex>", VERT_BODY);
    s.fragmentShader = s.fragmentShader.replace("void main() {", FADE_FRAG);
  };
  m.customProgramCacheKey = () => `figure-depth-${key}-${nb}`;
  return m;
}
