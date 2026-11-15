import * as THREE from "three";
import { lifeUniforms, patchLife } from "../life";

/**
 * Hemi-octahedral tree impostors and the dithered cross-fade between tree detail levels.
 *
 * IMPOSTOR. scripts/bake-octa.mjs renders each broadleaf scan (LOD0) from N x N directions over the upper hemisphere
 * (public/assets/models/<id>/octa_*.webp): colour, and an object-space normal plus a crown-occlusion term. At runtime one
 * quad per tree faces the camera; the three baked views nearest the view direction (in the tree's own frame, so the
 * instance's rotation, lean and stretch are honoured) are blended. The quad is lit by the scene's sun, sky and shadows
 * like any MeshStandardMaterial (so it gets the shared aerial perspective, cascades and cloud shadows), with the baked
 * normal, the crown occlusion as soft self-shadowing, and a little light through the leaves when the sun is behind the
 * tree. In the shadow pass the same quad faces the sun, so far trees cast crown-shaped shadows.
 *
 * CROSS-FADE. Each detail level carries a distance band (`fade`, in the same normalised distance the CPU uses to pick
 * levels: metres / size factor). Inside a band both levels are drawn and each fragment goes to one of them by a noise
 * fixed in world space (cells a few pixels across at that distance, the same cell size on both sides of a band), so the
 * change is a short dissolve of leaf-sized clumps that does not crawl when the camera moves, not a pop and not a
 * screen-door pattern. Outside its band a level's vertices collapse, so the CPU can hand out overlapping buckets.
 */

export interface OctaInfo {
  N: number;
  cell: number;
  center: [number, number, number];
  radius: number;
  height: number;
}

/** Shared by every vegetation material: the main camera (not the shadow or mirror camera). */
export const vegUniforms = {
  uLodCam: { value: new THREE.Vector3(0, 1e6, 0) },
};

/** Per detail level: (fade-in start, fade-in end, fade-out start, fade-out end), normalised distance. */
export type FadeUniform = { value: THREE.Vector4 };
export const makeFade = (): FadeUniform => ({ value: new THREE.Vector4(-2, -1, 1e8, 2e8) });

const FADE_VERT_PARS = /* glsl */ `
uniform vec3 uLodCam;
uniform vec4 uFade;
uniform float uSetH;
varying vec2 vFade;
varying vec3 vVegW;
varying float vVegCell;
`;
/** After `transformed` is final: the level's weight for this instance; collapse when it is not drawn at all. */
const FADE_VERT = /* glsl */ `
{
  vec3 cw = (modelMatrix * instanceMatrix[3]).xyz;
  vec3 dd = cw - uLodCam;
  float kk = clamp(uSetH * length(instanceMatrix[1].xyz) / 18.0, 0.4, 1.4);
  float dist = sqrt(dd.x * dd.x + dd.y * dd.y * 0.5 + dd.z * dd.z) / kk;
  vFade = vec2(smoothstep(uFade.x, uFade.y, dist), smoothstep(uFade.z, uFade.w, dist));
  if (vFade.x <= 0.0 || vFade.y >= 1.0) transformed *= 0.0;
  vVegW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  // dissolve cells: about 0.2 % of the band's real distance (two or three pixels), the same on both sides of a band
  vVegCell = max(0.03, (vFade.y > 0.0 ? uFade.z : uFade.x) * kk * 0.002);
}
`;
const FADE_FRAG_PARS = /* glsl */ `
varying vec2 vFade;
varying vec3 vVegW;
varying float vVegCell;
`;
const FADE_FRAG = /* glsl */ `
if (vFade.x < 1.0 || vFade.y > 0.0) {
  uvec3 q = uvec3(ivec3(floor(vVegW / vVegCell)) + 1048576);
  uint h = q.x * 73856093u ^ q.y * 19349663u ^ q.z * 83492791u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  float n = float((h >> 8u) & 0xffffu) / 65536.0;
  if (n >= vFade.x || n < vFade.y) discard;
}
`;

/** Light through the leaves and crown occlusion, after the lights have been summed (MeshStandardMaterial). */
const LEAF_LIGHT = /* glsl */ `
#include <aomap_fragment>
reflectedLight.indirectDiffuse *= vegOcc;
reflectedLight.directDiffuse *= mix(0.55, 1.0, vegOcc);
// a crown is a mass of small, differently tilted leaves: far less sky sheen than one smooth surface (it read as a cyan
// cast on distant woods)
reflectedLight.indirectSpecular *= 0.35 * vegOcc;
#if NUM_DIR_LIGHTS > 0
{
  vec3 Ld = directionalLights[0].direction;
  vec3 Vv = normalize(vViewPosition);
  float back = clamp(dot(-Vv, Ld), 0.0, 1.0);
  float wrap = clamp(dot(-normal, Ld), 0.0, 1.0);
  reflectedLight.directDiffuse += directionalLights[0].color * diffuseColor.rgb * (0.08 * wrap + 0.22 * back * back * back * back) * vegOcc * vegTransl;
}
#endif
`;

interface FadeOpts {
  fade: FadeUniform;
  setHeight: number;
}

/** Add the cross-fade to a (life-patched) mesh material. `leaf` adds light through the leaves (cards only). */
export function patchFade<T extends THREE.Material>(mat: T, o: FadeOpts & { leaf?: boolean; key: string }): T {
  const prev = mat.onBeforeCompile;
  const setH = { value: o.setHeight };
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uLodCam = vegUniforms.uLodCam;
    shader.uniforms.uFade = o.fade;
    shader.uniforms.uSetH = setH;
    shader.vertexShader = FADE_VERT_PARS + shader.vertexShader.replace("#include <project_vertex>", FADE_VERT + "#include <project_vertex>");
    let fs = FADE_FRAG_PARS + shader.fragmentShader.replace("#include <clipping_planes_fragment>", FADE_FRAG + "#include <clipping_planes_fragment>");
    if (o.leaf) fs = "const float vegOcc = 0.85;\nconst float vegTransl = 1.0;\n" + fs.replace("#include <aomap_fragment>", LEAF_LIGHT);
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => `veg-fade-${o.key}${o.leaf ? "-leaf" : ""}`;
  return mat;
}

/** Depth material for a faded level: alpha-tested like the leaf cards (or opaque), life window, collapse outside the band. */
export function fadeDepthMaterial(map: THREE.Texture | null, alphaTest: number, o: FadeOpts): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest });
  const setH = { value: o.setHeight };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uYear = lifeUniforms.uYear;
    shader.uniforms.uLodCam = vegUniforms.uLodCam;
    shader.uniforms.uFade = o.fade;
    shader.uniforms.uSetH = setH;
    shader.vertexShader =
      "attribute vec4 aLife;\nuniform float uYear;\n" +
      FADE_VERT_PARS +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         float lifeS = smoothstep(aLife.x, aLife.y, uYear) * (1.0 - smoothstep(aLife.z, aLife.w, uYear));
         transformed.y *= lifeS;
         if (lifeS < 0.004) transformed *= 0.0;
         ${FADE_VERT}`,
      );
  };
  m.customProgramCacheKey = () => `veg-fade-depth${map ? "-a" : ""}`;
  return m;
}

// ------------------------------------------------------------------ octahedral impostor

const OCTA_VERT_PARS = /* glsl */ `
uniform vec4 uOcta;   // N, radius, push towards the viewer (fraction of radius), unused
uniform vec3 uOctaC;  // crown/bounds centre in model space
varying vec4 vOA;
varying vec4 vOB;
varying vec4 vOC;
varying vec3 vOW;
vec3 octaDecodeHemi(vec2 uv) {
  vec2 p = vec2(uv.x + uv.y, uv.x - uv.y) * 0.5;
  float y = 1.0 - abs(p.x) - abs(p.y);
  return normalize(vec3(p.x, max(y, 0.0), p.y));
}
vec2 octaEncodeHemi(vec3 d) {
  d.y = max(d.y, 0.0);
  d /= (abs(d.x) + abs(d.y) + abs(d.z));
  return vec2(d.x + d.z, d.x - d.z);
}
void octaBasis(vec3 d, out vec3 r, out vec3 u) {
  r = cross(vec3(0.0, 1.0, 0.0), d);
  float l = length(r);
  r = l < 1e-4 ? vec3(1.0, 0.0, 0.0) : r / l;
  u = cross(d, r);
}
vec4 octaFrame(vec2 f, vec3 p, float N, float R) {
  vec3 d = octaDecodeHemi((f + 0.5) / N * 2.0 - 1.0);
  vec3 r, u;
  octaBasis(d, r, u);
  // checked against the mesh levels with userData.forceLevel, from the ground and from above
  return vec4(f, vec2(dot(p, r), dot(p, u)) / (2.0 * R) + 0.5);
}
`;
/** Sets impPos (model-space quad corner), impDir (model-space direction to the viewer), the frame varyings. */
const OCTA_VERT = /* glsl */ `
vec3 impPos;
vec3 impDir;
mat3 impM3 = mat3(modelMatrix) * mat3(instanceMatrix);
{
  vec3 cW = (modelMatrix * instanceMatrix * vec4(uOctaC, 1.0)).xyz;
  bool ortho = projectionMatrix[2][3] == 0.0;
  vec3 toCam = ortho ? vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]) : cameraPosition - cW;
  vec3 dObj = normalize(inverse(impM3) * toCam);
  dObj = normalize(vec3(dObj.x, max(dObj.y, 0.0) + 1e-4, dObj.z));

  impDir = dObj;
  float N = uOcta.x, R = uOcta.y;
  vec3 qr, qu;
  octaBasis(dObj, qr, qu);
  vec3 pq = (qr * position.x + qu * position.y) * R;
  impPos = uOctaC + pq + dObj * R * uOcta.z;
  vec2 g = clamp((octaEncodeHemi(dObj) * 0.5 + 0.5) * N - 0.5, 0.0, N - 1.0);
  vec2 f = min(floor(g), vec2(N - 2.0));
  vec2 fr = g - f;
  vec2 fC = fr.x > fr.y ? f + vec2(1.0, 0.0) : f + vec2(0.0, 1.0);
  vec3 w = fr.x > fr.y ? vec3(1.0 - fr.x, fr.y, fr.x - fr.y) : vec3(1.0 - fr.y, fr.x, fr.y - fr.x);
  vec2 fa = f, fb = f + 1.0, fc = fC;
  // heaviest view first (the fragment shader tests its coverage alone where it dominates)
  if (w.y > w.x) { w.xy = w.yx; vec2 t = fa; fa = fb; fb = t; }
  if (w.z > w.x) { w.xz = w.zx; vec2 t = fa; fa = fc; fc = t; }
  // a tree a few pixels high gains nothing from blending: one view
  float px = R * length(impM3[1]) / max(1.0, length(toCam)) * projectionMatrix[1][1];
  if (!ortho && px < 0.02) w = vec3(1.0, 0.0, 0.0);
  vOW = w;
  vOA = octaFrame(fa, pq, N, R);
  vOB = octaFrame(fb, pq, N, R);
  vOC = octaFrame(fc, pq, N, R);
  #ifdef USE_MAP
  // not used by the live view (the fragment blends three frames); the photo mode's vertex capture reads vMapUv and
  // gets a camera-facing card textured with the nearest view
  vec4 dom = vOW.x >= vOW.y && vOW.x >= vOW.z ? vOA : (vOW.y >= vOW.z ? vOB : vOC);
  vMapUv = (dom.xy + clamp(dom.zw, 0.0, 1.0)) / N;
  #endif
}
`;
const OCTA_FRAG_PARS = /* glsl */ `
uniform sampler2D tOctaC;
uniform vec4 uOcta;
varying vec4 vOA;
varying vec4 vOB;
varying vec4 vOC;
varying vec3 vOW;
vec2 octaUV(vec4 fr) { return (fr.xy + clamp(fr.zw, 0.0, 1.0)) / uOcta.x; }
// colour weighted by coverage (bled colour of empty texels does not leak in), coverage kept through the mip chain so
// distant crowns do not thin out to specks
// Frame A is the heaviest (sorted in the vertex shader). Most of a quad is empty: A's coverage alone decides those
// pixels, and B and C are only read where they carry weight (explicit gradients, so the branches are safe).
vec4 octaColour(out vec2 ua, out vec2 ub, out vec2 uc) {
  ua = octaUV(vOA); ub = octaUV(vOB); uc = octaUV(vOC);
  vec2 gx = dFdx(ua), gy = dFdy(ua);
  vec2 ts = vec2(textureSize(tOctaC, 0));
  float mip = max(0.0, 0.5 * log2(max(dot(gx * ts, gx * ts), dot(gy * ts, gy * ts))));
  float boost = 1.0 + mip * 0.3;
  vec4 a = textureGrad(tOctaC, ua, gx, gy);
  if (vOW.x > 0.7 && a.a * boost < 0.2) return vec4(0.0);
  float wa = vOW.x * a.a, al = wa;
  vec3 rgb = a.rgb * wa;
  if (vOW.y > 0.01) { vec4 b = textureGrad(tOctaC, ub, gx, gy); rgb += b.rgb * vOW.y * b.a; al += vOW.y * b.a; }
  if (vOW.z > 0.01) { vec4 c = textureGrad(tOctaC, uc, gx, gy); rgb += c.rgb * vOW.z * c.a; al += vOW.z * c.a; }
  return vec4(rgb / max(al, 1e-4), al * boost);
}
// shadow pass: the heaviest view only
float octaCoverage() {
  vec2 ua = octaUV(vOA);
  vec2 gx = dFdx(ua), gy = dFdy(ua);
  vec2 ts = vec2(textureSize(tOctaC, 0));
  float mip = max(0.0, 0.5 * log2(max(dot(gx * ts, gx * ts), dot(gy * ts, gy * ts))));
  return textureGrad(tOctaC, ua, gx, gy).a * (1.0 + mip * 0.3);
}
`;

function quadGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

export interface OctaImpostor {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  depthMaterial: THREE.MeshDepthMaterial;
}

/**
 * Material and depth material for one baked tree. `fade` = the level's band; `setHeight` = the model's height at
 * scale 1 (for the size factor of the band, like the CPU).
 */
export function makeOctaImpostor(info: OctaInfo, colour: THREE.Texture, normal: THREE.Texture, o: FadeOpts): OctaImpostor {
  const uOcta = { value: new THREE.Vector4(info.N, info.radius, 0.1, 0) };
  const uOctaC = { value: new THREE.Vector3(...info.center) };
  const tOctaC = { value: colour };
  const tOctaN = { value: normal };
  const setH = { value: o.setHeight };
  // map and alphaTest are set for the photo mode's snapshot (see USE_MAP above); the live shader samples tOctaC itself
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, side: THREE.FrontSide, map: colour, alphaTest: 0.5 });
  mat.name = "veg-octa";
  patchLife(mat, { tint: false });
  const lifeHook = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    lifeHook.call(mat, shader, renderer);
    Object.assign(shader.uniforms, { uOcta, uOctaC, tOctaC, tOctaN, uSetH: setH, uFade: o.fade, uLodCam: vegUniforms.uLodCam });
    let vs = shader.vertexShader;
    vs = OCTA_VERT_PARS + FADE_VERT_PARS + "uniform vec4 ltA[ 10 ];\nvarying vec3 vOn0;\nvarying vec3 vOn1;\nvarying vec3 vOn2;\n" + vs;
    vs = vs.replace(
      "#include <beginnormal_vertex>",
      `${OCTA_VERT}
       { mat3 nv = mat3(viewMatrix) * transpose(inverse(impM3)); vOn0 = nv[0]; vOn1 = nv[1]; vOn2 = nv[2]; }
       vec3 objectNormal = impDir;
       #ifdef USE_TANGENT
       vec3 objectTangent = vec3(tangent.xyz);
       #endif`,
    );
    // the life patch put its body after the first <begin_vertex>: the quad corner goes in before it
    vs = vs.replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed = impPos;");
    vs = vs.replace("#include <project_vertex>", FADE_VERT + "#include <project_vertex>");
    // The quad that casts the tree's shadow faces the sun through the crown centre; this one faces the viewer. Looked up
    // where it stands, half of it would lie behind its own caster and the crown would show a hard shadowed half. The
    // shadow lookup is therefore made one crown radius towards the sun (ltA[0] = direction to the sun): the crown's
    // own shading comes from the baked normals and occlusion, while shadows of neighbours and buildings still fall on it.
    vs = vs.replace(
      "#include <shadowmap_vertex>",
      "worldPosition.xyz += ltA[ 0 ].xyz * uOcta.y * length(impM3[0]) * 1.1;\n#include <shadowmap_vertex>",
    );
    shader.vertexShader = vs;
    let fs = shader.fragmentShader;
    fs =
      OCTA_FRAG_PARS +
      FADE_FRAG_PARS +
      `uniform sampler2D tOctaN;
       varying vec3 vOn0;
       varying vec3 vOn1;
       varying vec3 vOn2;
       const float vegTransl = 1.0;
       vec3 octDecodeFull(vec2 p) {
         vec3 n = vec3(p.x, 1.0 - abs(p.x) - abs(p.y), p.y);
         if (n.y < 0.0) n.xz = (1.0 - abs(n.zx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.z >= 0.0 ? 1.0 : -1.0);
         return normalize(n);
       }
      ` +
      fs;
    fs = fs.replace("#include <clipping_planes_fragment>", FADE_FRAG + "#include <clipping_planes_fragment>");
    fs = fs.replace(
      "#include <map_fragment>",
      `vec2 oua, oub, ouc;
       vec4 octaC = octaColour(oua, oub, ouc);
       // the mesh levels shadow their own crown in the shadow map; the impostor's baked occlusion is softer, so it is
       // taken down a little to meet them across the fade
       diffuseColor.rgb *= octaC.rgb * 0.86;
       diffuseColor.a = octaC.a;`,
    );
    fs = fs.replace("#include <alphatest_fragment>", "if (diffuseColor.a < 0.5) discard;");
    fs = fs.replace(
      "#include <normal_fragment_maps>",
      `vec2 ngx = dFdx(oua), ngy = dFdy(oua);
       vec4 na = textureGrad(tOctaN, oua, ngx, ngy);
       float nwa = vOW.x * na.a, nws = nwa;
       vec3 nrm = na.rgb * nwa;
       if (vOW.y > 0.01) { vec4 nb = textureGrad(tOctaN, oub, ngx, ngy); nrm += nb.rgb * vOW.y * nb.a; nws += vOW.y * nb.a; }
       if (vOW.z > 0.01) { vec4 nc = textureGrad(tOctaN, ouc, ngx, ngy); nrm += nc.rgb * vOW.z * nc.a; nws += vOW.z * nc.a; }
       nrm /= max(nws, 1e-4);
       normal = normalize(mat3(vOn0, vOn1, vOn2) * octDecodeFull(nrm.xy * 2.0 - 1.0));
       float vegOcc = nrm.z;`,
    );
    fs = fs.replace("#include <aomap_fragment>", LEAF_LIGHT);
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => "veg-octa";

  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  // the caster stands through the crown centre (no push)
  const uOctaD = { value: new THREE.Vector4(info.N, info.radius, 0, 0) };
  depth.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uYear: lifeUniforms.uYear, uOcta: uOctaD, uOctaC, tOctaC, uSetH: setH, uFade: o.fade, uLodCam: vegUniforms.uLodCam });
    shader.vertexShader =
      "attribute vec4 aLife;\nuniform float uYear;\n" +
      OCTA_VERT_PARS +
      FADE_VERT_PARS +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `${OCTA_VERT}
         #include <begin_vertex>
         transformed = impPos;
         float lifeS = smoothstep(aLife.x, aLife.y, uYear) * (1.0 - smoothstep(aLife.z, aLife.w, uYear));
         transformed.y *= lifeS;
         if (lifeS < 0.004) transformed *= 0.0;
         ${FADE_VERT}`,
      );
    shader.fragmentShader =
      OCTA_FRAG_PARS +
      shader.fragmentShader.replace(
        "#include <alphatest_fragment>",
        `if (octaCoverage() < 0.5) discard;`,
      );
  };
  depth.customProgramCacheKey = () => "veg-octa-depth";
  return { geometry: quadGeometry(), material: mat, depthMaterial: depth };
}
