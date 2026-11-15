import * as THREE from "three";
import { rng } from "@/lib/geo";
import type { CoverField, CoverStats } from "./cover";

export interface WrapLayerOpts {
  name: string;
  geometry: THREE.BufferGeometry;
  count: number;
  /** Side of the wrapping tile (m): instances repeat every `tile` metres around the layer centre. */
  tile: number;
  /** Distance from the centre over which instances shrink to nothing (m). */
  fade: [number, number];
  /** Camera height above ground over which the whole layer fades out (m). */
  camFade: [number, number];
  /** Which cover channel (A.rgb) drives density. */
  chan: [number, number, number];
  stat: keyof CoverStats;
  sizeW: [number, number];
  sizeH: [number, number];
  /** Random per-instance extra scale span for width (pow) so some are much bigger. */
  big?: number;
  wind?: number;
  windSpeed?: number;
  sink?: number;
  /** Shade with an up-pointing normal (grass) rather than the model's own. */
  up?: boolean;
  map?: THREE.Texture;
  colA: number;
  colB: number;
  /** Mix toward straw/stubble colour on farmed ground, and shrink height there. */
  field?: { color: number; shrink: number };
  /** Mix toward this colour on wet marsh ground. */
  wetColor?: number;
  seed: number;
  alphaTest?: number;
  roughness?: number;
  /** Centre follows the camera foot (0) or a point this much further along its view (1). */
  ahead?: number;
  /** Also draw in the mirrored (water reflection) pass. */
  inMirror?: boolean;
}

const VERT_DECL = /* glsl */ `
uniform sampler2D uTexA, uTexB, uTexC;
uniform vec2 uTexOrigin;
uniform float uTexSize, uH0, uTime;
uniform vec2 uCenter;
uniform float uTile, uCamH;
uniform vec2 uFade, uCamFade, uSizeW, uSizeH;
uniform vec3 uChan;
uniform float uWind, uWindSpeed, uSink, uBig, uShrink;
uniform vec3 uColA, uColB, uStraw, uWetCol;
uniform float uUseStraw, uUseWet, uUp;
attribute vec4 aOff;
attribute vec4 aVar;
varying vec3 vTint;
`;

const NORMAL_CHUNK = /* glsl */ `
vec2 gOff = aOff.xy * uTile;
vec2 gWp = gOff + uTile * floor((uCenter - gOff) / uTile + 0.5);
float gDc = length(gWp - uCenter);
// towards the layer's edge the tufts thin out one by one (each at its own distance) rather than all shrinking
// together, so the edge is not a ring that reads as a row across the view
float gEdge = 1.0 - smoothstep(uFade.x, uFade.y, gDc);
float gFade = step(aOff.w, gEdge) * mix(0.65, 1.0, gEdge) * (1.0 - smoothstep(uCamFade.x, uCamFade.y, uCamH));
vec2 gUv = (gWp - uTexOrigin) / uTexSize;
float gIn = step(0.0, gUv.x) * step(gUv.x, 1.0) * step(0.0, gUv.y) * step(gUv.y, 1.0);
vec4 gA = texture2D(uTexA, gUv);
vec4 gB = texture2D(uTexB, gUv);
vec4 gC = texture2D(uTexC, gUv);
float gDens = dot(gA.rgb, uChan);
float gKeep = smoothstep(aOff.z * 0.9, aOff.z * 0.9 + 0.12, gDens) * gIn * gFade;
if (uUseStraw > 0.5 && gC.r > 0.01) {
  // on farmed patches the tufts stand in rows along the ridges, aligned with the furrows of the decal
  vec2 gD = vec2(cos(gC.g), sin(gC.g));
  vec2 gN = vec2(-gD.y, gD.x);
  float gU = dot(gWp, gN);
  gWp += gN * (floor(gU / 1.3) * 1.3 + (aVar.w - 0.5) * 0.14 - gU);
}
float gYaw = aVar.y * 6.2831853;
float gCy = cos(gYaw), gSy = sin(gYaw);
vec3 objectNormal = uUp > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(normal.x * gCy + normal.z * gSy, normal.y, -normal.x * gSy + normal.z * gCy);
`;

const POS_CHUNK = /* glsl */ `
float gBig = 1.0 + uBig * pow(aVar.z, 4.0);
float gW = mix(uSizeW.x, uSizeW.y, aVar.x) * gBig * gKeep;
float gH = mix(uSizeH.x, uSizeH.y, aVar.x) * (0.8 + 0.4 * aVar.w) * gBig * gKeep * (1.0 - uShrink * gC.r);
vec3 gL = vec3(position.x * gW, position.y * gH, position.z * gW);
float gBend = position.y * position.y;
float gPh = uTime * uWindSpeed + gWp.x * 0.31 + gWp.y * 0.23 + aVar.z * 6.0;
vec2 gWind = vec2(sin(gPh) + 0.45 * sin(gPh * 2.3 + 1.0), 0.6 * cos(gPh * 0.83)) * uWind * gBend * gH;
vec3 gR = vec3(gL.x * gCy + gL.z * gSy, gL.y, -gL.x * gSy + gL.z * gCy);
vec3 transformed = vec3(gWp.x + gR.x + gWind.x, gB.r + uH0 + uSink + gR.y, gWp.y + gR.z + gWind.y);
{
  vec3 c = mix(uColA, uColB, aVar.w);
  c *= 0.82 + 0.36 * aVar.x;
  c = mix(c, uWetCol, uUseWet * gC.b);
  c = mix(c, uStraw, uUseStraw * min(1.0, gC.r * 1.3));
  vTint = c;
}
`;

export class WrapLayer {
  readonly mesh: THREE.Mesh;
  private u: Record<string, THREE.IUniform>;
  private material: THREE.MeshLambertMaterial;

  constructor(private o: WrapLayerOpts, private cover: CoverField) {
    const g = new THREE.InstancedBufferGeometry();
    const src = o.geometry;
    g.setAttribute("position", src.getAttribute("position"));
    g.setAttribute("normal", src.getAttribute("normal"));
    if (src.getAttribute("uv")) g.setAttribute("uv", src.getAttribute("uv"));
    if (src.index) g.setIndex(src.index);
    const r = rng(o.seed);
    const off = new Float32Array(o.count * 4), vr = new Float32Array(o.count * 4);
    for (let i = 0; i < o.count; i++) {
      off[i * 4] = r();
      off[i * 4 + 1] = r();
      off[i * 4 + 2] = r();
      for (let k = 0; k < 4; k++) vr[i * 4 + k] = r();
      off[i * 4 + 3] = r(); // fade-out order
    }
    g.setAttribute("aOff", new THREE.InstancedBufferAttribute(off, 4));
    g.setAttribute("aVar", new THREE.InstancedBufferAttribute(vr, 4));
    g.instanceCount = o.count;
    const c = (hex: number) => new THREE.Color(hex).convertSRGBToLinear();
    const v3 = (hex: number) => { const k = c(hex); return new THREE.Vector3(k.r, k.g, k.b); };
    this.u = {
      uCenter: { value: new THREE.Vector2() },
      uTile: { value: o.tile },
      uCamH: { value: 0 },
      uFade: { value: new THREE.Vector2(o.fade[0], o.fade[1]) },
      uCamFade: { value: new THREE.Vector2(o.camFade[0], o.camFade[1]) },
      uSizeW: { value: new THREE.Vector2(o.sizeW[0], o.sizeW[1]) },
      uSizeH: { value: new THREE.Vector2(o.sizeH[0], o.sizeH[1]) },
      uChan: { value: new THREE.Vector3(...o.chan) },
      uWind: { value: o.wind ?? 0 },
      uWindSpeed: { value: o.windSpeed ?? 1.4 },
      uSink: { value: o.sink ?? 0 },
      uBig: { value: o.big ?? 0 },
      uShrink: { value: o.field?.shrink ?? 0 },
      uColA: { value: v3(o.colA) },
      uColB: { value: v3(o.colB) },
      uStraw: { value: v3(o.field?.color ?? 0xffffff) },
      uWetCol: { value: v3(o.wetColor ?? 0xffffff) },
      uUseStraw: { value: o.field ? 1 : 0 },
      uUseWet: { value: o.wetColor != null ? 1 : 0 },
      uUp: { value: o.up ? 1 : 0 },
    };
    const mat = new THREE.MeshLambertMaterial({ ...(o.map ? { map: o.map } : {}), color: 0xffffff, alphaTest: o.map ? o.alphaTest ?? 0.45 : 0, side: o.map ? THREE.DoubleSide : THREE.FrontSide });
    this.material = mat;
    const shared = cover.uniforms;
    const key = `ground-${o.name}`;
    mat.customProgramCacheKey = () => key;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared, this.u);
      shader.vertexShader = VERT_DECL + shader.vertexShader
        .replace("#include <beginnormal_vertex>", NORMAL_CHUNK)
        .replace("#include <begin_vertex>", POS_CHUNK);
      shader.fragmentShader = "varying vec3 vTint;\nuniform float uUp;\n" + shader.fragmentShader
        .replace("#include <map_fragment>", "#include <map_fragment>\n diffuseColor.rgb *= vTint;")
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n if (uUp > 0.5) normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);");
    };
    void o.roughness;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = `ground-${o.name}`;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = !o.up;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 1;
    if (!o.inMirror) {
      // the planar-reflection pass looks up from under the water: skip this layer there (cheap draw of nothing)
      const geo = g;
      this.mesh.onBeforeRender = (_r, _s, camera) => {
        geo.instanceCount = camera.position.y < -0.05 ? 0 : o.count;
      };
    }
  }

  /** Returns whether the layer is worth drawing this frame. */
  update(foot: THREE.Vector2, ahead: THREE.Vector2, camH: number): boolean {
    const c = this.o.ahead ? ahead : foot;
    (this.u.uCenter.value as THREE.Vector2).copy(c);
    this.u.uCamH.value = camH;
    const on = this.cover.ready && this.cover.stats[this.o.stat] > 0.03 && camH < this.o.camFade[1];
    this.mesh.visible = on;
    return on;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
