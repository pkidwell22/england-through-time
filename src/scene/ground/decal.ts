import * as THREE from "three";
import type { CoverField } from "./cover";

const NC = 80; // cells per side
const CELL = 2; // metres
const HALF = (NC * CELL) / 2;

const VERT_DECL = /* glsl */ `
uniform sampler2D uTexB;
uniform vec2 uTexOrigin, uOrigin;
uniform float uTexSize, uH0;
varying vec2 vWP;
`;

const FRAG_DECL = /* glsl */ `
uniform sampler2D uTexA, uTexB, uTexC;
uniform vec2 uTexOrigin, uCenter;
uniform float uTexSize, uH0, uTime, uRiver, uCamH, uQuality;
varying vec2 vWP;
float gPud;
float dh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float dn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(dh(i), dh(i + vec2(1.0, 0.0)), f.x), mix(dh(i + vec2(0.0, 1.0)), dh(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const FRAG_MAP = /* glsl */ `
{
  vec2 tuv = (vWP - uTexOrigin) / uTexSize;
  float inside = step(0.0, tuv.x) * step(tuv.x, 1.0) * step(0.0, tuv.y) * step(tuv.y, 1.0);
  vec4 A = texture2D(uTexA, tuv);
  vec4 B = texture2D(uTexB, tuv);
  vec4 C = texture2D(uTexC, tuv);
  float h = B.r + uH0;
  float road = B.g;
  float urb = max(A.a, road);
  float dCam = length(vWP - cameraPosition.xz);
  float fade = (1.0 - smoothstep(40.0, 75.0, length(vWP - uCenter))) * inside * (1.0 - smoothstep(28.0, 65.0, uCamH));
  vec3 col = vec3(0.0);
  float al = 0.0;
  #define OVER(c, a) { float aa_ = clamp(a, 0.0, 1.0) * (1.0 - al); col += (c) * aa_; al += aa_; }

  // 1. the wet band of the tidal foreshore, and the swash line
  float shoreM = uRiver * step(0.02, A.b);
  if (shoreM > 0.0) {
    float band = smoothstep(-0.12, 0.02, h) * (1.0 - smoothstep(0.3, 0.85, h)) * (1.0 - C.b * 0.5);
    band *= 0.7 + 0.3 * dn(vWP * 0.6);
    OVER(vec3(0.075, 0.066, 0.052), 0.42 * band);
    float hs = 0.15 + 0.07 * sin(uTime * 0.55 + vWP.x * 0.045 + vWP.y * 0.031);
    float foam = (1.0 - smoothstep(0.0, 0.03, abs(h - hs))) * step(0.0, h);
    foam *= 0.35 + 0.65 * dn(vWP * 2.2 + vec2(uTime * 0.15, 0.0));
    OVER(vec3(0.62, 0.64, 0.6), 0.22 * foam * smoothstep(0.45, 0.7, dn(vWP * 0.35)));
  }

  // 2. furrow lines and ridges on the farmed patches
  if (C.r > 0.0) {
    float ang = C.g;
    vec2 d = vec2(cos(ang), sin(ang));
    vec2 nrm = vec2(-d.y, d.x);
    float u = dot(vWP, nrm), along = dot(vWP, d);
    float fu = u / 1.3;
    float aa = 1.0 - smoothstep(0.1, 0.32, fwidth(fu));
    float v = abs(fract(fu) - 0.5);
    float line = (1.0 - smoothstep(0.1, 0.27, v)) * (0.7 + 0.3 * dn(vec2(along * 0.35, u * 0.3)));
    OVER(vec3(0.09, 0.07, 0.04), 0.75 * line * aa * C.r);
    float ridge = 0.5 + 0.5 * sin(u * 1.1 + dn(vWP * 0.05) * 3.0);
    OVER(mix(vec3(0.3, 0.24, 0.1), vec3(0.62, 0.53, 0.27), ridge), 0.2 * C.r);
    // tilled soil between the rows (the land texture carries the crop's colour as seen from above)
    OVER(vec3(0.1, 0.078, 0.052) * (0.85 + 0.3 * dn(vWP * 0.7)), 0.85 * C.r);
  }

  // 3. streets, yards and tracks: scuffed ground, wheel ruts, puddles, straw and refuse
  float rut = 0.0;
  if (urb > 0.02) {
    vec2 rd = vec2(B.b, B.a);
    float rl = length(rd);
    float th = rl > 0.02 ? 0.5 * atan(rd.y, rd.x) : 0.7;
    vec2 d = vec2(cos(th), sin(th));
    float u = dot(vWP, vec2(-d.y, d.x)), along = dot(vWP, d);
    float scuff = smoothstep(0.42, 0.75, dn(vWP * 0.4 + 3.1)) * 0.5 + 0.2;
    OVER(vec3(0.17, 0.135, 0.09), 0.16 * urb * scuff);
    float fu = u / 1.5;
    float aa = 1.0 - smoothstep(0.1, 0.32, fwidth(fu));
    float line = 1.0 - smoothstep(0.06, 0.17, abs(fract(fu) - 0.5));
    float brk = smoothstep(0.28, 0.62, dn(vec2(along * 0.06, u * 0.5)));
    rut = line * brk * aa * road;
    OVER(vec3(0.07, 0.055, 0.038), 0.72 * rut);
    float pn = dn(vWP * 0.5 + 7.3) * 0.65 + dn(vWP * 1.6) * 0.35;
    float pud = smoothstep(0.71, 0.77, pn + rut * 0.25) * urb;
    gPud = pud;
    OVER(vec3(0.05, 0.05, 0.048), 0.72 * pud);
    // straw and refuse
    vec2 cid = floor(vWP / 0.55);
    float hs = dh(cid);
    if (hs > 0.86 && dCam < 30.0) {
      float a2 = dh(cid + 11.0) * 6.2831;
      vec2 q = fract(vWP / 0.55) - 0.5;
      q = vec2(q.x * cos(a2) + q.y * sin(a2), -q.x * sin(a2) + q.y * cos(a2));
      float dash = (1.0 - smoothstep(0.016, 0.03, abs(q.y))) * (1.0 - smoothstep(0.14, 0.2, abs(q.x)));
      float tone = dh(cid + 5.0);
      vec3 sc = tone > 0.8 ? vec3(0.1, 0.08, 0.06) : mix(vec3(0.5, 0.4, 0.18), vec3(0.72, 0.6, 0.3), tone);
      OVER(sc, 0.85 * dash * urb * (1.0 - smoothstep(18.0, 30.0, dCam)) * (1.0 - pud));
    }
  }

  diffuseColor.rgb = col / max(al, 0.001);
  diffuseColor.a = al * fade;
  if (diffuseColor.a < 0.004) discard;
}
`;

export class GroundDecal {
  readonly mesh: THREE.Mesh;
  private u: Record<string, THREE.IUniform>;
  private material: THREE.MeshStandardMaterial;

  constructor(private cover: CoverField, hasRiver: boolean) {
    const nv = NC + 1;
    const pos = new Float32Array(nv * nv * 3);
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nv; i++) {
        const k = (j * nv + i) * 3;
        pos[k] = -HALF + i * CELL;
        pos[k + 2] = -HALF + j * CELL;
      }
    const idx = new Uint32Array(NC * NC * 6);
    let p = 0;
    for (let j = 0; j < NC; j++)
      for (let i = 0; i < NC; i++) {
        const a = j * nv + i, c = a + nv;
        idx[p++] = a; idx[p++] = c; idx[p++] = a + 1;
        idx[p++] = a + 1; idx[p++] = c; idx[p++] = c + 1;
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const nrm = new Float32Array(nv * nv * 3);
    for (let k = 0; k < nv * nv; k++) nrm[k * 3 + 1] = 1;
    g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.u = {
      uOrigin: { value: new THREE.Vector2() },
      uCenter: { value: new THREE.Vector2() },
      uRiver: { value: hasRiver ? 1 : 0 },
      uCamH: { value: 0 },
    };
    // Blended, but drawn with the opaque things just after the terrain (renderOrder 0.9) and before the tufts: a
    // transparent decal would be drawn after them and lay its colour over their buried bases (grey stumps)
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.95, metalness: 0, transparent: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.material = mat;
    mat.customProgramCacheKey = () => "ground-decal";
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.cover.uniforms, this.u);
      shader.vertexShader = VERT_DECL + shader.vertexShader
        .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0, 1.0, 0.0);")
        .replace(
          "#include <begin_vertex>",
          `vec2 gWp = uOrigin + position.xz;
           vec2 gUv = (gWp - uTexOrigin) / uTexSize;
           float gHh = texture2D(uTexB, gUv).r + uH0;
           vec3 transformed = vec3(gWp.x, gHh + 0.07, gWp.y);
           vWP = gWp;`,
        );
      shader.fragmentShader = FRAG_DECL + shader.fragmentShader
        .replace("#include <map_fragment>", FRAG_MAP)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.22, gPud);");
    };
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = "ground-decal";
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 0.9;
    const geo = g;
    this.mesh.onBeforeRender = (_r, _s, camera) => {
      geo.setDrawRange(0, camera.position.y < -0.05 ? 0 : Infinity);
    };
  }

  update(foot: THREE.Vector2, camH: number): boolean {
    (this.u.uOrigin.value as THREE.Vector2).set(Math.round(foot.x / CELL) * CELL, Math.round(foot.y / CELL) * CELL);
    (this.u.uCenter.value as THREE.Vector2).copy(foot);
    this.u.uCamH.value = camH;
    const s = this.cover.stats;
    const on = this.cover.ready && camH < 65 && (s.urban > 0.03 || s.field > 0.03 || s.shore > 0.03);
    this.mesh.visible = on;
    return on;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
