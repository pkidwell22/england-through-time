import * as THREE from "three";
import { lifeUniforms } from "../life";
import { VertexCapture, capturable, hasCustomShader, type Captured } from "./capture";
import { TILE_RES, bakeTiles, planTiles, tileIndex, type TerrainTile } from "./terrainBake";

/**
 * SNAPSHOT BAKER. Turns the live scene, at the current year and camera, into a static, path-tracer-friendly copy of
 * what is actually there: plain meshes in world space, one per output material, with no instancing, no per-instance
 * life window, no clipping planes and no custom shaders.
 *
 *  - Instanced fabric, trees, understorey, props and figures: every instance that is alive at the current year is
 *    expanded. Positions come from the meshes' own vertex shaders (GPU capture, ./capture.ts), so a house half-way
 *    through its appear/vanish window is scaled exactly as the rasteriser scales it, a dead one collapses to nothing
 *    and is dropped, and draped ground cover or walking figures are where the live frame shows them.
 *  - Landmark phases: hidden phases are skipped (their group is invisible); a phase under construction or in ruin is
 *    cut at its clip plane, triangle by triangle, so the photograph shows it partly built exactly as the live view does.
 *  - Levels of detail: whatever the live frame currently uses (fabric LOD by distance, tree cards by distance).
 *  - Terrain: geometry as is; its shader-computed colour is baked into top-down albedo tiles (./terrainBake.ts),
 *    together with draped overlays (street surfaces, ground decals).
 *  - Custom-shader materials become MeshStandard/Physical materials with the same textures; alpha-tested leaf cards
 *    keep their alpha test. Water surfaces become a smooth dielectric; window glass a dark polished dielectric.
 *  - Left out: helpers, labels, the district outline, lines and points (fire, smoke), the live water planes (replaced),
 *    the cloud layer, translucent map-style overlays that are not draped on the ground, and anything sub-pixel.
 *
 * Region and budget: an instance or triangle is kept when it is within `maxDist` of the camera and inside a frustum a
 * little wider than the view, or within `nearAll` metres of the camera (so off-screen neighbours still cast shadows
 * and reflect), or when its shadow can fall into the view. Instances are then ranked by projected size and taken
 * until the triangle budget is spent; anything smaller than `minPx` pixels on screen is dropped first.
 */

export interface SnapshotOptions {
  triBudget: number;
  maxDist: number;
  nearAll: number;
  minPx: number;
  terrainTiles: number;
  /** Height of the image in pixels (for projected-size ranking). */
  heightPx: number;
  hasRiver: boolean;
  waterColor: THREE.Color;
  groundAt: (x: number, z: number) => number;
  onProgress?: (msg: string) => void;
}

export interface SnapshotStats {
  triangles: number;
  vertices: number;
  meshes: number;
  materials: number;
  sourceMeshes: number;
  instancesKept: number;
  instancesCulled: number;
  instancesOverBudget: number;
  trianglesClipped: number;
  terrainTriangles: number;
  terrainTiles: number;
  capturedVertices: number;
  capturePasses: number;
  excluded: Record<string, number>;
  bakeMs: number;
  geometryMB: number;
  /** Edge length (m) of each terrain albedo tile, smallest first. */
  tileSizes: number[];
}

export interface Snapshot {
  scene: THREE.Scene;
  stats: SnapshotStats;
  /** Terrain albedo tiles (diagnostics). */
  tiles: TerrainTile[];
  dispose(): void;
}

// ---------------------------------------------------------------- growable buffers

class GrowF {
  a: Float32Array;
  n = 0;
  constructor(cap = 1024) {
    this.a = new Float32Array(cap);
  }
  ensure(k: number): void {
    if (this.n + k <= this.a.length) return;
    let c = this.a.length * 2;
    while (c < this.n + k) c *= 2;
    const b = new Float32Array(c);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
  trimmed(): Float32Array {
    return this.a.slice(0, this.n);
  }
}
class GrowU {
  a: Uint32Array;
  n = 0;
  constructor(cap = 1024) {
    this.a = new Uint32Array(cap);
  }
  push3(x: number, y: number, z: number): void {
    if (this.n + 3 > this.a.length) {
      const b = new Uint32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
  }
}

/** Output accumulator: one per path-tracing material. */
class Acc {
  P = new GrowF();
  N = new GrowF();
  U = new GrowF();
  C = new GrowF();
  I = new GrowU();
  verts = 0;
  colored = false;
  constructor(readonly material: THREE.Material) {}
  vert(px: number, py: number, pz: number, nx: number, ny: number, nz: number, u: number, v: number, r: number, g: number, b: number): number {
    this.P.ensure(3); this.N.ensure(3); this.U.ensure(2); this.C.ensure(4);
    const P = this.P, N = this.N, U = this.U, C = this.C;
    P.a[P.n++] = px; P.a[P.n++] = py; P.a[P.n++] = pz;
    N.a[N.n++] = nx; N.a[N.n++] = ny; N.a[N.n++] = nz;
    U.a[U.n++] = u; U.a[U.n++] = v;
    C.a[C.n++] = r; C.a[C.n++] = g; C.a[C.n++] = b; C.a[C.n++] = 1;
    if (!this.colored && (r < 0.995 || g < 0.995 || b < 0.995)) this.colored = true;
    return this.verts++;
  }
  get tris(): number {
    return this.I.n / 3;
  }
}

/** Vertex source in a common layout: stride-4 arrays indexed by absolute vertex id. */
interface Src {
  pos: Float32Array;
  nrm: Float32Array | null;
  col: Float32Array | null;
  uv: Float32Array | null;
}

// ---------------------------------------------------------------- material conversion

function identityTexture(t: THREE.Texture | null | undefined): THREE.Texture | null {
  if (!t) return null;
  const c = t.clone();
  c.offset.set(0, 0);
  c.repeat.set(1, 1);
  c.center.set(0, 0);
  c.rotation = 0;
  c.matrixAutoUpdate = true;
  c.updateMatrix();
  return c;
}

const sameMatrix = (a: THREE.Texture, b: THREE.Texture) => {
  a.updateMatrix();
  b.updateMatrix();
  return a.matrix.equals(b.matrix);
};

let waterNormals: THREE.Texture | null = null;

/** Tileable ripple normal map for the photo's water (a copy of the live view's generator, softer). */
function makeWaterNormals(strength = 5): THREE.DataTexture {
  const s = 256, period = 8;
  const hash = (x: number, y: number) => {
    const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const pn = (x: number, y: number, p: number) => {
    const fx = (x / s) * p, fy = (y / s) * p;
    const xi = Math.floor(fx), yi = Math.floor(fy);
    const u = fx - xi, v = fy - yi;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const h = (i: number, j: number) => hash((((i % p) + p) % p) + p * 3, ((j % p) + p) % p);
    return h(xi, yi) * (1 - su) * (1 - sv) + h(xi + 1, yi) * su * (1 - sv) + h(xi, yi + 1) * (1 - su) * sv + h(xi + 1, yi + 1) * su * sv;
  };
  const hgt = new Float32Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) hgt[y * s + x] = pn(x, y, period) * 0.55 + pn(x, y, period * 3) * 0.3 + pn(x, y, period * 8) * 0.15;
  const data = new Uint8Array(s * s * 4);
  const n = new THREE.Vector3();
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const hx = hgt[y * s + ((x + 1) % s)] - hgt[y * s + ((x + s - 1) % s)];
      const hy = hgt[((y + 1) % s) * s + x] - hgt[((y + s - 1) % s) * s + x];
      n.set(-hx * strength, -hy * strength, 1).normalize();
      const i = (y * s + x) * 4;
      data[i] = (n.x * 0.5 + 0.5) * 255;
      data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, s, s);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function waterMaterial(color: THREE.Color): THREE.MeshPhysicalMaterial {
  // Turbid river water reflects about 2 % of the light at normal incidence (Fresnel, n = 1.33) and scatters back a
  // few per cent more from the silt; towards grazing angles the Fresnel reflection rises to a mirror. In this path
  // tracer an opaque dielectric (specular + diffuse lobes chosen at random) leaves a speckle at grazing angles that
  // does not converge, so the water is a mirror-like conductor whose Schlick reflectance has the same angular curve:
  // F0 = Fresnel + body (the live water's silty olive), rising to 1 at grazing. What is lost is the body colour's
  // response to shadow (the water in a shadow is not darker than in sun, only its reflection is).
  const f0 = new THREE.Color(0.02, 0.02, 0.02).add(color.clone().multiplyScalar(0.5));
  return new THREE.MeshPhysicalMaterial({ name: "photo:water", color: f0, roughness: 0.1, metalness: 1, side: THREE.DoubleSide });
}

function glassMaterial(): THREE.MeshPhysicalMaterial {
  // Leaded window glass in front of a dark interior: a polished dielectric (ior 1.52) over a near-black body.
  return new THREE.MeshPhysicalMaterial({ name: "photo:glass", color: 0x0d1012, roughness: 0.06, metalness: 0, ior: 1.52, specularIntensity: 1, side: THREE.DoubleSide });
}

interface Converted {
  key: string;
  make: () => THREE.Material;
}

/** Map a live material to a path-tracing material (key = merge signature), or null when it is left out. */
function convert(src: THREE.Material, waterColor: THREE.Color, excluded: Record<string, number>, noShadow = false): Converted | null {
  const ex = (why: string) => {
    excluded[why] = (excluded[why] ?? 0) + 1;
    return null;
  };
  if (!capturable(src)) return ex("non-standard shader material");
  if (src.colorWrite === false || src.visible === false) return ex("invisible helper");
  const m = src as THREE.MeshStandardMaterial & Partial<THREE.MeshPhysicalMaterial>;
  const name = src.name ?? "";
  if (name === "water" || name.startsWith("water")) return { key: "water", make: () => waterMaterial(waterColor) };
  if (name === "glass") return { key: "glass", make: glassMaterial };
  if (src.transparent && src.opacity < 0.99 && !(src.alphaTest > 0)) return ex("translucent overlay");
  const map = m.map ?? null;
  let normalMap = (m as THREE.MeshStandardMaterial).normalMap ?? null;
  let roughnessMap = (m as THREE.MeshStandardMaterial).roughnessMap ?? null;
  let metalnessMap = (m as THREE.MeshStandardMaterial).metalnessMap ?? null;
  // captured texture coordinates already carry the map's own transform; other maps must share it to be kept
  const ref = map ?? normalMap ?? roughnessMap;
  if (ref) {
    if (normalMap && !sameMatrix(normalMap, ref)) normalMap = null;
    if (roughnessMap && !sameMatrix(roughnessMap, ref)) roughnessMap = null;
    if (metalnessMap && !sameMatrix(metalnessMap, ref)) metalnessMap = null;
  }
  const std = (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;
  const roughness = std ? m.roughness : 0.9;
  const metalness = std ? m.metalness : 0;
  // flat stand-in tints carry a little self-light (0.3 × colour) for legibility in the live view: not physical
  const emissive = m.emissive ? m.emissive.clone() : new THREE.Color(0, 0, 0);
  if (m.color && Math.abs(emissive.r - m.color.r * 0.3) < 1e-3 && Math.abs(emissive.g - m.color.g * 0.3) < 1e-3 && Math.abs(emissive.b - m.color.b * 0.3) < 1e-3) emissive.setRGB(0, 0, 0);
  const alphaTest = src.alphaTest > 0 ? src.alphaTest : 0;
  const color = m.color ? m.color.clone() : new THREE.Color(1, 1, 1);
  const transmission = m.transmission ?? 0;
  // Alpha-tested two-sided cards (leaves, grass) carry outward "crown" normals that the live view keeps on both
  // faces. The path tracer flips the normal of a back-face hit, which darkens every card seen from behind and turns
  // tree crowns into stacks of lit and unlit plates; so such cards become two single-sided copies, one per winding.
  const twoFace = alphaTest > 0 && src.side === THREE.DoubleSide;
  // Cut-out cards the live view keeps out of the shadow map (tree impostors: crossed quads and a crown-top plate)
  // cast no shadow here either; lit and shadowed physically they read as stacks of flat plates.
  const castShadow = !(noShadow && alphaTest > 0);
  const key = [
    src.type, color.getHexString(), map?.source.uuid, normalMap?.source.uuid, roughnessMap?.source.uuid, metalnessMap?.source.uuid,
    roughness.toFixed(3), metalness.toFixed(3), alphaTest.toFixed(3), src.side, emissive.getHexString(), m.emissiveIntensity ?? 1,
    m.flatShading ? 1 : 0, normalMap ? (m as THREE.MeshStandardMaterial).normalScale.x.toFixed(2) : "", map?.colorSpace, transmission, twoFace, castShadow,
  ].join("|");
  return {
    key,
    make: () => {
      const out = new THREE.MeshPhysicalMaterial({
        name: `photo:${name || src.type}`, color, roughness, metalness, map: identityTexture(map), normalMap: identityTexture(normalMap),
        roughnessMap: identityTexture(roughnessMap), metalnessMap: identityTexture(metalnessMap), alphaTest, side: twoFace ? THREE.FrontSide : src.side,
        emissive, emissiveIntensity: m.emissiveIntensity ?? 1, flatShading: !!m.flatShading, transmission,
      });
      if (normalMap) out.normalScale.copy((m as THREE.MeshStandardMaterial).normalScale);
      out.userData.twoFace = twoFace;
      (out as THREE.MeshPhysicalMaterial & { castShadow?: boolean }).castShadow = castShadow;
      // a map with alpha used for cut-outs (leaf cards) must keep cutting out in the path tracer
      if (src.transparent && map && !alphaTest) out.alphaTest = 0.5;
      return out;
    },
  };
}

// ---------------------------------------------------------------- geometry emission

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();

interface Emitter {
  acc: Acc;
  src: Src;
  stamp: Int32Array;
  remap: Int32Array;
  gen: number;
  planes: THREE.Plane[] | null;
  /** Fallback per-vertex colour when the source has none. */
  uvFn?: (x: number, z: number) => [number, number];
}

interface ClipV {
  p: [number, number, number];
  n: [number, number, number];
  u: [number, number];
  c: [number, number, number];
}

function emitVertex(e: Emitter, v: number, fn: THREE.Vector3 | null): number {
  if (e.stamp[v] === e.gen) return e.remap[v];
  const { pos, nrm, col, uv } = e.src;
  const o = v * 4;
  const x = pos[o], y = pos[o + 1], z = pos[o + 2];
  let nx: number, ny: number, nz: number;
  if (nrm && !fn) {
    nx = nrm[o]; ny = nrm[o + 1]; nz = nrm[o + 2];
  } else {
    nx = fn!.x; ny = fn!.y; nz = fn!.z;
  }
  let u = 0, w = 0;
  if (e.uvFn) [u, w] = e.uvFn(x, z);
  else if (uv) {
    u = uv[o]; w = uv[o + 1];
  }
  const r = col ? col[o] : 1, g = col ? col[o + 1] : 1, b = col ? col[o + 2] : 1;
  const k = e.acc.vert(x, y, z, nx, ny, nz, u, w, r, g, b);
  // vertices with face normals are not shared (each face needs its own normal)
  if (!fn) {
    e.stamp[v] = e.gen;
    e.remap[v] = k;
  }
  return k;
}

function clipVertex(e: Emitter, v: number, fn: THREE.Vector3 | null): ClipV {
  const { pos, nrm, col, uv } = e.src;
  const o = v * 4;
  let u: [number, number] = [0, 0];
  if (e.uvFn) u = e.uvFn(pos[o], pos[o + 2]);
  else if (uv) u = [uv[o], uv[o + 1]];
  return {
    p: [pos[o], pos[o + 1], pos[o + 2]],
    n: nrm && !fn ? [nrm[o], nrm[o + 1], nrm[o + 2]] : [fn!.x, fn!.y, fn!.z],
    u,
    c: col ? [col[o], col[o + 1], col[o + 2]] : [1, 1, 1],
  };
}

function lerpV(a: ClipV, b: ClipV, t: number): ClipV {
  const l = (x: number, y: number) => x + (y - x) * t;
  return {
    p: [l(a.p[0], b.p[0]), l(a.p[1], b.p[1]), l(a.p[2], b.p[2])],
    n: [l(a.n[0], b.n[0]), l(a.n[1], b.n[1]), l(a.n[2], b.n[2])],
    u: [l(a.u[0], b.u[0]), l(a.u[1], b.u[1])],
    c: [l(a.c[0], b.c[0]), l(a.c[1], b.c[1]), l(a.c[2], b.c[2])],
  };
}

/** Emit triangles [t0, t1) of a mesh (index or sequential), offset by vBase. Returns triangles clipped. */
function emitTris(
  e: Emitter, index: ArrayLike<number> | null, t0: number, t1: number, vBase: number, flat: boolean,
  cull: ((cx: number, cy: number, cz: number, r: number) => boolean) | null, triFilter?: (t: number) => boolean,
): number {
  const pos = e.src.pos;
  let clipped = 0;
  for (let t = t0; t < t1; t++) {
    if (triFilter && !triFilter(t)) continue;
    const ia = vBase + (index ? index[t * 3] : t * 3), ib = vBase + (index ? index[t * 3 + 1] : t * 3 + 1), ic = vBase + (index ? index[t * 3 + 2] : t * 3 + 2);
    _a.set(pos[ia * 4], pos[ia * 4 + 1], pos[ia * 4 + 2]);
    _b.set(pos[ib * 4], pos[ib * 4 + 1], pos[ib * 4 + 2]);
    _c.set(pos[ic * 4], pos[ic * 4 + 1], pos[ic * 4 + 2]);
    // degenerate: an instance collapsed by its life window, or a sliver
    _d.subVectors(_c, _a);
    _n.subVectors(_b, _a).cross(_d);
    const l2 = _n.lengthSq();
    if (!(l2 > 1e-12)) continue;
    if (cull) {
      const cx = (_a.x + _b.x + _c.x) / 3, cy = (_a.y + _b.y + _c.y) / 3, cz = (_a.z + _b.z + _c.z) / 3;
      const r = Math.sqrt(Math.max((_a.x - cx) ** 2 + (_a.y - cy) ** 2 + (_a.z - cz) ** 2, (_b.x - cx) ** 2 + (_b.y - cy) ** 2 + (_b.z - cz) ** 2, (_c.x - cx) ** 2 + (_c.y - cy) ** 2 + (_c.z - cz) ** 2));
      if (!cull(cx, cy, cz, r)) continue;
    }
    const fn = flat || !e.src.nrm ? _n.multiplyScalar(1 / Math.sqrt(l2)).clone() : null;
    let inside = true;
    if (e.planes) {
      let cut = false;
      for (const pl of e.planes) {
        const da = pl.distanceToPoint(_a), db = pl.distanceToPoint(_b), dc = pl.distanceToPoint(_c);
        if (da < 0 && db < 0 && dc < 0) {
          cut = true;
          break;
        }
        if (da < 0 || db < 0 || dc < 0) inside = false;
      }
      if (cut) {
        clipped++;
        continue;
      }
    }
    if (inside) {
      e.acc.I.push3(emitVertex(e, ia, fn), emitVertex(e, ib, fn), emitVertex(e, ic, fn));
      continue;
    }
    // Sutherland–Hodgman against each clip plane
    clipped++;
    let poly: ClipV[] = [clipVertex(e, ia, fn), clipVertex(e, ib, fn), clipVertex(e, ic, fn)];
    for (const pl of e.planes!) {
      const next: ClipV[] = [];
      const d = (v: ClipV) => pl.normal.x * v.p[0] + pl.normal.y * v.p[1] + pl.normal.z * v.p[2] + pl.constant;
      for (let i = 0; i < poly.length; i++) {
        const A = poly[i], B = poly[(i + 1) % poly.length];
        const dA = d(A), dB = d(B);
        if (dA >= 0) next.push(A);
        if ((dA >= 0) !== (dB >= 0)) next.push(lerpV(A, B, dA / (dA - dB)));
      }
      poly = next;
      if (poly.length < 3) break;
    }
    if (poly.length < 3) continue;
    const ids = poly.map((v) => e.acc.vert(v.p[0], v.p[1], v.p[2], v.n[0], v.n[1], v.n[2], v.u[0], v.u[1], v.c[0], v.c[1], v.c[2]));
    for (let i = 1; i + 1 < ids.length; i++) e.acc.I.push3(ids[0], ids[i], ids[i + 1]);
  }
  return clipped;
}

/** CPU source for a plain (non-instanced, unpatched) mesh: world-space positions/normals, transformed uvs. */
function cpuSource(mesh: THREE.Mesh, uvMatrix: THREE.Matrix3 | null): Src {
  const g = mesh.geometry;
  const P = g.attributes.position as THREE.BufferAttribute;
  const Nn = g.attributes.normal as THREE.BufferAttribute | undefined;
  const C = g.attributes.color as THREE.BufferAttribute | undefined;
  const U = g.attributes.uv as THREE.BufferAttribute | undefined;
  const mat = mesh.material as THREE.MeshStandardMaterial;
  const n = P.count;
  const pos = new Float32Array(n * 4);
  const nrm = Nn ? new Float32Array(n * 4) : null;
  const useCol = !!C && mat.vertexColors;
  const col = useCol ? new Float32Array(n * 4) : null;
  const uv = U ? new Float32Array(n * 4) : null;
  const mw = mesh.matrixWorld;
  const nm = new THREE.Matrix3().getNormalMatrix(mw);
  const v = new THREE.Vector3();
  const v2 = new THREE.Vector2();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(P, i).applyMatrix4(mw);
    pos[i * 4] = v.x; pos[i * 4 + 1] = v.y; pos[i * 4 + 2] = v.z; pos[i * 4 + 3] = 1;
    if (nrm && Nn) {
      v.fromBufferAttribute(Nn, i).applyMatrix3(nm).normalize();
      nrm[i * 4] = v.x; nrm[i * 4 + 1] = v.y; nrm[i * 4 + 2] = v.z;
    }
    if (col && C) {
      col[i * 4] = C.getX(i); col[i * 4 + 1] = C.getY(i); col[i * 4 + 2] = C.getZ(i);
    }
    if (uv && U) {
      v2.fromBufferAttribute(U, i);
      if (uvMatrix) v2.applyMatrix3(uvMatrix);
      uv[i * 4] = v2.x; uv[i * 4 + 1] = v2.y;
    }
  }
  return { pos, nrm, col, uv };
}

function triRange(g: THREE.BufferGeometry): [number, number] {
  const n = g.index ? g.index.count : g.attributes.position.count;
  const s = Math.max(0, g.drawRange.start);
  const e = Math.min(n, g.drawRange.start + g.drawRange.count);
  return [Math.floor(s / 3), Math.floor(e / 3)];
}

// ---------------------------------------------------------------- the bake

interface Chunk {
  mesh: THREE.Mesh;
  /** Index into the mesh's captured or selected instances, -1 for a whole mesh. */
  inst: number;
  tris: number;
  px: number;
}

const lifeS = (a: number, b: number, c: number, d: number, t: number) => {
  const ss = (e0: number, e1: number, x: number) => {
    const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1e-9)));
    return k * k * (3 - 2 * k);
  };
  return ss(a, b, t) * (1 - ss(c, d, t));
};

export async function bakeSnapshot(live: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera }, opt: SnapshotOptions): Promise<Snapshot> {
  const t0 = performance.now();
  const { renderer, scene, camera } = live;
  const progress = async (msg: string) => {
    opt.onProgress?.(msg);
    await new Promise((r) => setTimeout(r, 0));
  };
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  const camPos = camera.position.clone();
  const year = lifeUniforms.uYear.value;
  const excluded: Record<string, number> = {};
  const ex = (why: string) => (excluded[why] = (excluded[why] ?? 0) + 1);

  // region: a frustum wider than the view, a sphere around the camera, and the sun's shadow direction
  const wide = camera.clone();
  wide.fov = Math.min(150, camera.fov * 1.35);
  wide.near = 0.1;
  wide.far = opt.maxDist;
  wide.updateProjectionMatrix();
  wide.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(wide.projectionMatrix, wide.matrixWorldInverse));
  // the ground is kept out to the horizon (it is cheap): same frustum without the distance cap
  wide.far = 1e6;
  wide.updateProjectionMatrix();
  const frustumFar = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(wide.projectionMatrix, wide.matrixWorldInverse));
  const sunDir = new THREE.Vector3(0.5, 0.6, -0.5).normalize();
  scene.traverse((o) => {
    const l = o as THREE.DirectionalLight;
    if (l.isDirectionalLight && l.visible) sunDir.copy(l.position).sub(l.target.position).normalize();
  });
  const sphere = new THREE.Sphere();
  const focalPx = opt.heightPx / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const vis = (x: number, y: number, z: number, r: number): boolean => {
    const d = Math.hypot(x - camPos.x, y - camPos.y, z - camPos.z);
    if (d - r > opt.maxDist) return false;
    if (d < opt.nearAll + r) return true;
    sphere.center.set(x, y, z);
    sphere.radius = r;
    if (frustum.intersectsSphere(sphere)) return true;
    if (sunDir.y > 0.05) {
      // the object's shadow runs from it away from the sun, down to the ground
      const L = Math.min((2 * r + 4) / sunDir.y, 600);
      sphere.center.set(x - (sunDir.x * L) / 2, y - (sunDir.y * L) / 2, z - (sunDir.z * L) / 2);
      sphere.radius = r + L / 2;
      if (frustum.intersectsSphere(sphere)) return true;
    }
    return false;
  };
  const projPx = (x: number, y: number, z: number, r: number) => (r / Math.max(0.1, Math.hypot(x - camPos.x, y - camPos.y, z - camPos.z))) * focalPx;

  // ---- 1. collect what is drawn
  const terrain: THREE.Mesh[] = [];
  const drape: THREE.Mesh[] = [];
  // Far trees are impostors: crossed vertical cards plus a horizontal "crown top" card that fills the canopy when seen
  // from above. Seen obliquely and lit physically, that card reads as a flat plate; it is kept only for steep views.
  const camDir = camera.getWorldDirection(new THREE.Vector3());
  const crownTop = (m: THREE.Mesh) => {
    const g = m.geometry, n = g.attributes.normal;
    if (g.attributes.position.count !== 4 || !n || !((m.material as THREE.Material).alphaTest > 0)) return false;
    for (let i = 0; i < 4; i++) if (n.getY(i) < 0.99) return false;
    return true;
  };
  const meshes: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const mat = m.material as THREE.Material;
      if (Array.isArray(m.material)) ex("multi-material mesh");
      else if (m.name === "terrain") terrain.push(m);
      else if (!capturable(mat)) ex("non-standard shader material");
      else if (mat.colorWrite === false) ex("invisible helper");
      else if (mat.transparent && mat.polygonOffset && mat.name !== "water") drape.push(m);
      else if ((m.geometry as THREE.PlaneGeometry).parameters && (m.geometry as THREE.PlaneGeometry).parameters.width > 3000) ex("live water plane (replaced)");
      else if (camDir.y > -0.6 && crownTop(m)) ex("impostor crown-top cards (oblique view)");
      else meshes.push(m);
    } else if ((o as THREE.Points).isPoints) ex("points (fire, smoke)");
    else if ((o as THREE.Line).isLine) ex("lines (outline)");
    for (const c of o.children) walk(c);
  };
  walk(scene);

  // ---- 2. classify meshes, select instances, capture
  await progress("Reading the live scene…");
  const cap = new VertexCapture(renderer, camera);
  const accs = new Map<string, Acc>();
  const convCache = new Map<string, Converted | null>();
  const conv = (m: THREE.Material, noShadow = false) => {
    const k = m.uuid + (noShadow ? "|ns" : "");
    if (!convCache.has(k)) convCache.set(k, convert(m, opt.waterColor, excluded, noShadow));
    return convCache.get(k)!;
  };
  const accFor = (c: Converted) => {
    let a = accs.get(c.key);
    if (!a) accs.set(c.key, (a = new Acc(c.make())));
    return a;
  };
  const chunks: Chunk[] = [];
  const captured = new Map<THREE.Mesh, Captured>();
  const selected = new Map<THREE.Mesh, number[]>();
  const cpuMeshes = new Map<THREE.Mesh, Src>();
  let instCulled = 0;
  const v3 = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  let capCount = 0;
  for (const mesh of meshes) {
    const mat = mesh.material as THREE.Material;
    const c = conv(mat, !mesh.castShadow);
    if (!c) continue;
    const g = mesh.geometry;
    const [ta, tb] = triRange(g);
    const trisPer = tb - ta;
    if (trisPer <= 0) continue;
    const im = mesh as THREE.InstancedMesh;
    const isIM = im.isInstancedMesh === true;
    const isIBG = (g as THREE.InstancedBufferGeometry).isInstancedBufferGeometry === true;
    const custom = hasCustomShader(mat);
    if (!isIM && !isIBG && !custom) {
      // plain mesh: exact on the CPU, culled per triangle at emission
      if (!g.boundingSphere) g.computeBoundingSphere();
      const bs = g.boundingSphere!.clone().applyMatrix4(mesh.matrixWorld);
      if (!vis(bs.center.x, bs.center.y, bs.center.z, bs.radius)) {
        instCulled++;
        continue;
      }
      chunks.push({ mesh, inst: -1, tris: trisPer, px: Math.max(4, projPx(bs.center.x, bs.center.y, bs.center.z, bs.radius)) });
      continue;
    }
    const life = g.getAttribute("aLife") as THREE.InstancedBufferAttribute | undefined;
    if (isIM && (life || !custom)) {
      // static instances: chosen on the CPU from their matrices and life windows, captured afterwards
      if (!g.boundingSphere) g.computeBoundingSphere();
      const bs = g.boundingSphere!;
      const list: number[] = [];
      for (let i = 0; i < im.count; i++) {
        if (life && lifeS(life.getX(i), life.getY(i), life.getZ(i), life.getW(i), year) < 0.004) continue;
        im.getMatrixAt(i, m4);
        m4.premultiply(mesh.matrixWorld);
        v3.copy(bs.center).applyMatrix4(m4);
        const r = bs.radius * m4.getMaxScaleOnAxis();
        if (!vis(v3.x, v3.y, v3.z, r)) {
          instCulled++;
          continue;
        }
        const px = projPx(v3.x, v3.y, v3.z, r);
        if (px < opt.minPx) {
          instCulled++;
          continue;
        }
        chunks.push({ mesh, inst: list.length, tris: trisPer, px });
        list.push(i);
      }
      if (list.length) selected.set(mesh, list);
      continue;
    }
    // everything else (figures, draped cover, patched plain meshes): capture all, then judge each instance where it really is
    const V = g.attributes.position.count;
    let instCap = Infinity;
    for (const at of Object.values(g.attributes)) if ((at as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) instCap = Math.min(instCap, at.count);
    const ic = (g as THREE.InstancedBufferGeometry).instanceCount;
    const n = isIM ? im.count : isIBG ? Math.min(ic > 0 && Number.isFinite(ic) ? ic : Infinity, instCap) : 1;
    if (!Number.isFinite(n) || V * n > 6e6) {
      ex("oversized dynamic mesh");
      continue;
    }
    if (++capCount % 20 === 0) await progress("Capturing animated and patched meshes…");
    const got = cap.capture(mesh, null, { normal: true, color: true, uv: true });
    captured.set(mesh, got);
    for (let k = 0; k < got.instances; k++) {
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      const p = got.pos;
      for (let v = k * V; v < (k + 1) * V; v++) {
        const x = p[v * 4], y = p[v * 4 + 1], z = p[v * 4 + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      const r = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2;
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
      if (!(r > 1e-4) || !vis(cx, cy, cz, r)) {
        instCulled++;
        continue;
      }
      const px = n === 1 ? Math.max(4, projPx(cx, cy, cz, r)) : projPx(cx, cy, cz, r);
      if (px < opt.minPx) {
        instCulled++;
        continue;
      }
      chunks.push({ mesh, inst: k, tris: trisPer, px });
    }
  }

  // ---- 3. budget: largest on screen first
  chunks.sort((a, b) => b.px - a.px);
  let budget = opt.triBudget;
  let overBudget = 0;
  const keep = new Set<Chunk>();
  for (const ch of chunks) {
    // whole meshes are culled per triangle later: count an estimate of what survives (half of a big mesh)
    const cost = ch.inst < 0 && ch.tris > 20000 ? ch.tris * 0.5 : ch.tris;
    if (cost > budget) {
      overBudget++;
      continue;
    }
    budget -= cost;
    keep.add(ch);
  }

  // ---- 4. capture the selected static instances
  await progress("Expanding instanced buildings, trees and props…");
  const selCaptured = new Map<THREE.Mesh, { got: Captured; local: Map<number, number> }>();
  const selKeep = new Map<THREE.Mesh, number[]>();
  for (const ch of keep) {
    if (ch.inst < 0 || captured.has(ch.mesh)) continue;
    const list = selected.get(ch.mesh)!;
    let s = selKeep.get(ch.mesh);
    if (!s) selKeep.set(ch.mesh, (s = []));
    s.push(list[ch.inst]);
  }
  let k = 0;
  for (const [mesh, ids] of selKeep) {
    ids.sort((a, b) => a - b);
    if (++k % 15 === 0) await progress(`Expanding instances (${k}/${selKeep.size} meshes)…`);
    const got = cap.capture(mesh, Uint32Array.from(ids), { normal: true, color: true, uv: true });
    const local = new Map<number, number>();
    ids.forEach((id, j) => local.set(id, j));
    selCaptured.set(mesh, { got, local });
  }
  const capPasses = cap.passes, capVerts = cap.vertices;
  cap.dispose();

  // ---- 5. emit geometry
  await progress("Assembling static geometry…");
  let clipped = 0;
  let instKept = 0;
  const stampFor = new Map<number, { stamp: Int32Array; remap: Int32Array }>();
  let gen = 1;
  const scratch = (n: number) => {
    let s = stampFor.get(n);
    if (!s) {
      s = { stamp: new Int32Array(n), remap: new Int32Array(n) };
      stampFor.clear();
      stampFor.set(n, s);
    }
    return s;
  };
  const cullTri = (cx: number, cy: number, cz: number, r: number) => vis(cx, cy, cz, r);
  for (const ch of keep) {
    const mesh = ch.mesh;
    const mat = mesh.material as THREE.Material;
    const c = conv(mat, !mesh.castShadow)!;
    const acc = accFor(c);
    const g = mesh.geometry;
    const [ta, tb] = triRange(g);
    const planes = mat.clippingPlanes?.filter((p) => Math.abs(p.constant) < 1e5) ?? null;
    const flat = !!(mat as THREE.MeshStandardMaterial).flatShading;
    const index = g.index ? (g.index.array as ArrayLike<number>) : null;
    let src: Src;
    let vBase = 0;
    if (ch.inst < 0) {
      if (captured.has(mesh)) src = captured.get(mesh)!;
      else {
        let s = cpuMeshes.get(mesh);
        if (!s) {
          const map = (mat as THREE.MeshStandardMaterial).map ?? (mat as THREE.MeshStandardMaterial).normalMap ?? null;
          let uvm: THREE.Matrix3 | null = null;
          if (map) {
            map.updateMatrix();
            uvm = map.matrix.clone();
          }
          s = cpuSource(mesh, uvm);
          cpuMeshes.set(mesh, s);
        }
        src = s;
      }
    } else if (captured.has(mesh)) {
      src = captured.get(mesh)!;
      vBase = ch.inst * g.attributes.position.count;
    } else {
      const sc = selCaptured.get(mesh)!;
      src = sc.got;
      const id = selected.get(mesh)![ch.inst];
      vBase = sc.local.get(id)! * g.attributes.position.count;
    }
    const total = src.pos.length / 4;
    const { stamp, remap } = scratch(Math.max(total, 1 << 16));
    const e: Emitter = { acc, src, stamp, remap, gen: gen++, planes: planes && planes.length ? planes : null };
    clipped += emitTris(e, index, ta, tb, vBase, flat, ch.inst < 0 && ch.tris > 64 ? cullTri : null);
    instKept++;
  }
  cpuMeshes.clear();
  captured.clear();
  selCaptured.clear();

  // ---- 6. terrain: geometry + albedo tiles
  await progress("Baking the ground colour…");
  let terrainTris = 0;
  let tiles: TerrainTile[] = [];
  if (terrain.length) {
    const pixAngle = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / opt.heightPx;
    // the tile tree's root covers the whole terrain around the camera
    let reach = opt.maxDist;
    for (const tm of terrain) {
      tm.geometry.computeBoundingBox();
      const bb = tm.geometry.boundingBox!.clone().applyMatrix4(tm.matrixWorld);
      for (const x of [bb.min.x, bb.max.x]) for (const z of [bb.min.z, bb.max.z]) reach = Math.max(reach, Math.abs(x - camPos.x) + 1, Math.abs(z - camPos.z) + 1);
    }
    const rects = planTiles(camera, frustumFar, reach * 2, opt.terrainTiles, pixAngle, opt.groundAt);
    tiles = bakeTiles(renderer, [...terrain, ...drape], rects);
    const tileAcc = tiles.map((t) => new Acc(new THREE.MeshPhysicalMaterial({ name: "photo:terrain", map: t.rt.texture, roughness: 1, metalness: 0, side: THREE.FrontSide })));
    // Water: every terrain cell that dips below the high-water datum gets a flat copy at y = 0, so the waterline is
    // where the ground crosses the datum, as in the live view; ground lying wholly deeper than DEEP is dropped (hidden
    // under the opaque water). The surface is made of terrain-sized triangles rather than one huge plane.
    const DEEP = -1.0;
    const waterAcc = opt.hasRiver ? new Acc(waterMaterial(opt.waterColor)) : null;

    for (const tm of terrain) {
      const g = tm.geometry;
      const src = cpuSource(tm, null);
      const index = g.index ? (g.index.array as ArrayLike<number>) : null;
      const [ta, tb] = triRange(g);
      // bucket the triangles by tile (centroid), dropping river bed under opaque water and what is out of view
      const tileOf = new Int16Array(tb - ta).fill(-1);
      const deep = new Uint8Array(tb - ta);
      const P = src.pos;
      for (let t = ta; t < tb; t++) {
        const a = index ? index[t * 3] : t * 3, b = index ? index[t * 3 + 1] : t * 3 + 1, c = index ? index[t * 3 + 2] : t * 3 + 2;
        const ya = P[a * 4 + 1], yb = P[b * 4 + 1], yc = P[c * 4 + 1];
        const minY = Math.min(ya, yb, yc), maxY = Math.max(ya, yb, yc);
        const wet = opt.hasRiver && minY < 0 ? (minY < DEEP ? 1 : 2) : 0;
        const cx = (P[a * 4] + P[b * 4] + P[c * 4]) / 3, cy = (ya + yb + yc) / 3, cz = (P[a * 4 + 2] + P[b * 4 + 2] + P[c * 4 + 2]) / 3;
        const r = Math.hypot(P[a * 4] - cx, ya - cy, P[a * 4 + 2] - cz) * 1.2;
        const d = Math.hypot(cx - camPos.x, cy - camPos.y, cz - camPos.z);
        if (d > opt.nearAll + r) {
          sphere.center.set(cx, cy, cz);
          sphere.radius = r;
          if (!frustumFar.intersectsSphere(sphere)) continue;
        }
        deep[t - ta] = wet;
        if (!(wet === 1 && maxY < DEEP)) tileOf[t - ta] = tileIndex(tiles, cx, cz);
      }
      tiles.forEach((tile, ti) => {
        const acc = tileAcc[ti];
        const { stamp, remap } = scratch(Math.max(src.pos.length / 4, 1 << 16));
        const e: Emitter = {
          acc, src, stamp, remap, gen: gen++, planes: null,
          uvFn: (x, z) => [(x - tile.x0) / tile.s, (tile.z0 + tile.s - z) / tile.s],
        };
        emitTris(e, index, ta, tb, 0, false, null, (t) => tileOf[t - ta] === ti);
      });
      if (waterAcc) {
        const wpos = src.pos.slice();
        for (let i = 1; i < wpos.length; i += 4) wpos[i] = 0;
        const { stamp, remap } = scratch(Math.max(wpos.length / 4, 1 << 16));
        emitTris({ acc: waterAcc, src: { pos: wpos, nrm: null, col: null, uv: null }, stamp, remap, gen: gen++, planes: null }, index, ta, tb, 0, false, null, (t) => deep[t - ta] > 0);
      }
    }
    for (const [k, a] of [["water-surface", waterAcc]] as const) {
      if (!a) continue;
      if (a.tris > 0) accs.set(k, a);
      else a.material.dispose();
    }
    tileAcc.forEach((a, i) => {
      if (a.tris > 0) {
        terrainTris += a.tris;
        accs.set(`terrain:${i}`, a);
      } else a.material.dispose();
    });
  }

  // ---- 8. build the meshes
  await progress("Building meshes…");
  const out = new THREE.Scene();
  let tris = 0, verts = 0, bytes = 0;
  for (const [, a] of accs) {
    if (a.tris === 0) {
      a.material.dispose();
      continue;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(a.P.trimmed(), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(a.N.trimmed(), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(a.U.trimmed(), 2));
    g.setAttribute("color", new THREE.BufferAttribute(a.C.trimmed(), 4));
    const mat = a.material as THREE.MeshPhysicalMaterial;
    if (mat.userData.twoFace) {
      const n = a.I.n;
      const idx = new Uint32Array(n * 2);
      idx.set(a.I.a.subarray(0, n));
      for (let i = 0; i < n; i += 3) {
        idx[n + i] = a.I.a[i];
        idx[n + i + 1] = a.I.a[i + 2];
        idx[n + i + 2] = a.I.a[i + 1];
      }
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    } else g.setIndex(new THREE.BufferAttribute(a.I.a.slice(0, a.I.n), 1));
    if (mat.normalMap) g.computeTangents();
    else g.setAttribute("tangent", new THREE.BufferAttribute(new Float32Array(a.verts * 4), 4));
    mat.vertexColors = a.colored;
    const mesh = new THREE.Mesh(g, mat);
    mesh.matrixAutoUpdate = false;
    out.add(mesh);
    tris += a.tris * (mat.userData.twoFace ? 2 : 1);
    verts += a.verts;
    bytes += a.verts * (3 + 3 + 2 + 4 + 4) * 4 + a.I.n * 4;
  }
  const materials = new Set(out.children.map((m) => (m as THREE.Mesh).material)).size;
  const stats: SnapshotStats = {
    triangles: tris, vertices: verts, meshes: out.children.length, materials, sourceMeshes: meshes.length + terrain.length,
    instancesKept: instKept, instancesCulled: instCulled, instancesOverBudget: overBudget, trianglesClipped: clipped,
    terrainTriangles: terrainTris, terrainTiles: tiles.length, capturedVertices: capVerts, capturePasses: capPasses,
    excluded, bakeMs: Math.round(performance.now() - t0), geometryMB: +(bytes / 1048576).toFixed(1),
    tileSizes: tiles.map((t) => Math.round(t.s)).sort((a, b) => a - b),
  };
  const built = [...out.children];
  return {
    scene: out,
    stats,
    tiles,
    dispose() {
      for (const c of built) {
        const m = c as THREE.Mesh;
        m.geometry.dispose();
        const mat = m.material as THREE.MeshPhysicalMaterial;
        for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap"] as const) {
          const t = mat[key];
          // identity clones share their image (and GPU texture) with the live textures; three.js counts users per
          // image, so disposing a clone releases only the clone's use. Tiles and the shared water normals are kept here.
          if (t && !tiles.some((tt) => tt.rt.texture === t) && t !== waterNormals) t.dispose();
        }
        mat.dispose();
      }
      built.length = 0;
      out.clear();
      for (const t of tiles) t.rt.dispose();
      tiles = [];
    },
  };
}

export const TERRAIN_TILE_RES = TILE_RES;
