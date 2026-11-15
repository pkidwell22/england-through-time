import * as THREE from "three";
import manifestJson from "@data/models.json";
import { lifeDepthMaterial, lifeUniforms, patchLife } from "../life";

/**
 * Scanned CC0 model library (Poly Haven), optimised into LODs by scripts/optimize-models.mjs and
 * scripts/bake-models.mjs. See docs/ASSETS.md.
 *
 * Everything here is optional at runtime: if /assets/models is missing (not fetched), the loaders reject
 * with ModelUnavailableError (or resolve null via tryLoadModel) and callers keep their procedural meshes.
 */

export type ModelCategory = "tree" | "shrub" | "groundcover" | "grass" | "deadwood" | "rock" | "prop" | "vessel";
export type PartKind = "opaque" | "cutout" | "impostor";

export interface ModelInfo {
  id: string;
  name: string;
  category: ModelCategory;
  /** Number of variants (separate plants/rocks from one scan set); 1 for single objects. */
  variants: number;
  /** Why this asset is (or is not quite) right for prehistoric-to-Jacobean southern Britain. */
  plausibility: string;
  /** Historical years (no year 0) in which it is plausible. */
  period: { from: number; to: number };
  confidence: "high" | "medium" | "low";
}

export interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** Alpha-tested depth material for cut-out parts (leaf cards, impostors, fronds); undefined for opaque parts. */
  depthMaterial?: THREE.Material;
  kind: PartKind;
  triangles: number;
}

export interface ModelLod {
  parts: ModelPart[];
  triangles: number;
  /** Suggested distance (m, at scale 1) beyond which the next LOD should be used; the last is a cull distance. */
  maxDistance: number;
}

export interface ModelAsset {
  id: string;
  name: string;
  category: ModelCategory;
  variant: number;
  variantName: string;
  /** Finest first. Trees: [mesh, mesh + cluster cards, crossed-billboard impostor]; plants: [mesh, impostor]; others: three meshes. */
  lods: ModelLod[];
  /** Real-world size in metres at scale 1 (axis-aligned bounds of LOD0). */
  height: number;
  width: number;
  depth: number;
  bounds: THREE.Box3;
  radius: number;
  plausibility: string;
  period: { from: number; to: number };
  confidence: "high" | "medium" | "low";
}

export class ModelUnavailableError extends Error {
  constructor(id: string, reason: string) {
    super(`model ${id} unavailable: ${reason}`);
    this.name = "ModelUnavailableError";
  }
}

// ------------------------------------------------------------------ manifest

interface ManifestAsset {
  id: string;
  name: string;
  category: string;
  variants?: number;
  plausibility: string;
  period: { from: number; to: number };
  confidence: string;
}
const manifest = manifestJson as unknown as { assets: ManifestAsset[] };

/** Base URL of the optimised files (public/assets/models). */
export let MODEL_BASE_URL = "/assets/models/";
export function setModelBaseUrl(url: string): void {
  MODEL_BASE_URL = url.endsWith("/") ? url : `${url}/`;
}

/** Catalogue from data/models.json (synchronous; says nothing about whether files were fetched). */
export function listModels(category?: ModelCategory | ModelCategory[]): ModelInfo[] {
  const cats = category === undefined ? null : new Set(Array.isArray(category) ? category : [category]);
  return manifest.assets
    .filter((a) => !cats || cats.has(a.category as ModelCategory))
    .map((a) => ({
      id: a.id,
      name: a.name,
      category: a.category as ModelCategory,
      variants: a.variants ?? 1,
      plausibility: a.plausibility,
      period: a.period,
      confidence: a.confidence as ModelInfo["confidence"],
    }));
}

/** Catalogue entries plausible in a historical year, optionally limited to categories / minimum confidence. */
export function modelsForYear(year: number, category?: ModelCategory | ModelCategory[], minConfidence: ModelInfo["confidence"] = "low"): ModelInfo[] {
  const rank = { low: 0, medium: 1, high: 2 };
  return listModels(category).filter((m) => year >= m.period.from && year <= m.period.to && rank[m.confidence] >= rank[minConfidence]);
}

let availability: Promise<Set<string>> | null = null;
/** Ids whose optimised files are actually present (reads index.json once). Empty set if the library is missing. */
export function availableModels(): Promise<Set<string>> {
  if (!availability) {
    availability = fetch(`${MODEL_BASE_URL}index.json`)
      .then((r) => (r.ok ? r.json() : { assets: [] }))
      .then((j: { assets?: { id: string; baked?: boolean }[] }) => new Set((j.assets ?? []).filter((a) => a.baked !== false).map((a) => a.id)))
      .catch(() => new Set<string>());
  }
  return availability;
}

// ------------------------------------------------------------------ file format

interface PartJson {
  vertices: number;
  triangles: number;
  position: number;
  normal: number;
  uv: number;
  index: number;
  indexType: "u16" | "u32";
  material: {
    kind: PartKind;
    name: string;
    map?: string;
    normalMap?: string;
    armMap?: string;
    alphaTest?: number;
    doubleSided?: boolean;
    crownNormals?: boolean;
    color?: [number, number, number];
    roughness?: number;
    metalness?: number;
    /** armMap is a glTF ARM texture (R = occlusion); otherwise a plain roughness map. */
    arm?: boolean;
  };
}
interface ModelJson {
  id: string;
  name: string;
  category: ModelCategory;
  plausibility: string;
  period: { from: number; to: number };
  confidence: ModelInfo["confidence"];
  bin: string;
  baked: boolean;
  variants: {
    name: string;
    bounds: { min: [number, number, number]; max: [number, number, number] };
    size: { height: number; width: number; depth: number };
    radius: number;
    lods: { triangles: number; maxDistance: number; parts: PartJson[] }[];
  }[];
}

const fileCache = new Map<string, Promise<{ meta: ModelJson; bin: ArrayBuffer }>>();
function loadFiles(id: string) {
  let p = fileCache.get(id);
  if (!p) {
    p = (async () => {
      let meta: ModelJson;
      let bin: ArrayBuffer;
      try {
        const r = await fetch(`${MODEL_BASE_URL}${id}/model.json`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        meta = (await r.json()) as ModelJson;
        const b = await fetch(`${MODEL_BASE_URL}${id}/${meta.bin}`);
        if (!b.ok) throw new Error(`geometry HTTP ${b.status}`);
        bin = await b.arrayBuffer();
      } catch (e) {
        fileCache.delete(id);
        throw new ModelUnavailableError(id, (e as Error).message);
      }
      if (!meta.baked) throw new ModelUnavailableError(id, "impostor/leaf textures not baked (run scripts/bake-models.mjs)");
      return { meta, bin };
    })();
    fileCache.set(id, p);
  }
  return p;
}

const texLoader = new THREE.TextureLoader();
const texCache = new Map<string, Promise<THREE.Texture>>();
function loadTexture(id: string, name: string, srgb: boolean, clamp: boolean): Promise<THREE.Texture> {
  const key = `${id}/${name}|${srgb}|${clamp}`;
  let p = texCache.get(key);
  if (!p) {
    p = texLoader.loadAsync(`${MODEL_BASE_URL}${id}/${name}`).then((t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
      t.anisotropy = 4;
      return t;
    });
    p.catch(() => texCache.delete(key));
    texCache.set(key, p);
  }
  return p;
}

function partGeometry(bin: ArrayBuffer, p: PartJson): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(bin, p.position, p.vertices * 3), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Int8Array(bin, p.normal, p.vertices * 3), 3, true));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(bin, p.uv, p.vertices * 2), 2));
  const I = p.indexType === "u32" ? new Uint32Array(bin, p.index, p.triangles * 3) : new Uint16Array(bin, p.index, p.triangles * 3);
  g.setIndex(new THREE.BufferAttribute(I, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

async function partMaterial(id: string, m: PartJson["material"]): Promise<THREE.MeshStandardMaterial> {
  const cut = !!m.alphaTest;
  const mat = new THREE.MeshStandardMaterial({
    roughness: m.roughness ?? 1,
    metalness: m.metalness ?? 0,
    side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    alphaTest: m.alphaTest ?? 0,
  });
  mat.name = `${id}:${m.name}`;
  if (m.color) mat.color.setRGB(m.color[0], m.color[1], m.color[2]);
  const [map, nor, arm] = await Promise.all([
    m.map ? loadTexture(id, m.map, true, cut) : null,
    m.normalMap ? loadTexture(id, m.normalMap, false, cut) : null,
    m.armMap ? loadTexture(id, m.armMap, false, cut) : null,
  ]);
  if (map) mat.map = map;
  if (nor) mat.normalMap = nor;
  if (m.crownNormals) crownNormals(mat);
  if (arm) {
    // G = roughness (ARM or plain roughness map); R = ambient occlusion only in a true ARM map
    mat.roughnessMap = arm;
    if (m.arm) mat.aoMap = arm;
  }
  return mat;
}

/**
 * Leaf cards carry soft "crown" normals (pointing out of the tree crown). three.js flips the normal of back
 * faces on double-sided materials, which would darken every card seen from behind; this keeps them.
 * Keyed by a define so it never shares a shader program with ordinary double-sided materials.
 */
export function crownNormals<T extends THREE.Material>(mat: T): T {
  const m = mat as T & { defines?: Record<string, unknown> };
  m.defines = { ...(m.defines ?? {}), CROWN_NORMALS: "" };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      THREE.ShaderChunk.normal_fragment_begin.replace(
        "float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;",
        "#ifdef CROWN_NORMALS\nfloat faceDirection = 1.0;\n#else\nfloat faceDirection = gl_FrontFacing ? 1.0 : - 1.0;\n#endif",
      ),
    );
  };
  return mat;
}

function alphaDepth(map: THREE.Texture | null, alphaTest: number): THREE.MeshDepthMaterial {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest });
}

const assetCache = new Map<string, Promise<ModelAsset>>();

/**
 * Load one variant of a model with all its LODs. Rejects with ModelUnavailableError if the optimised
 * files are missing. Geometries, materials and textures are shared between callers: clone the material
 * (or use lifeMaterials) before changing it.
 */
export function loadModel(id: string, variant = 0): Promise<ModelAsset> {
  const key = `${id}#${variant}`;
  let p = assetCache.get(key);
  if (!p) {
    p = (async () => {
      const { meta, bin } = await loadFiles(id);
      const v = meta.variants[variant];
      if (!v) throw new ModelUnavailableError(id, `no variant ${variant} (has ${meta.variants.length})`);
      const lods: ModelLod[] = [];
      for (const l of v.lods) {
        const parts: ModelPart[] = [];
        for (const pj of l.parts) {
          const material = await partMaterial(id, pj.material);
          parts.push({
            geometry: partGeometry(bin, pj),
            material,
            depthMaterial: pj.material.alphaTest ? alphaDepth(material.map, pj.material.alphaTest) : undefined,
            kind: pj.material.kind,
            triangles: pj.triangles,
          });
        }
        lods.push({ parts, triangles: l.triangles, maxDistance: l.maxDistance });
      }
      return {
        id,
        name: meta.name,
        category: meta.category,
        variant,
        variantName: v.name,
        lods,
        height: v.size.height,
        width: v.size.width,
        depth: v.size.depth,
        bounds: new THREE.Box3(new THREE.Vector3(...v.bounds.min), new THREE.Vector3(...v.bounds.max)),
        radius: v.radius,
        plausibility: meta.plausibility,
        period: meta.period,
        confidence: meta.confidence,
      };
    })();
    p.catch(() => assetCache.delete(key));
    assetCache.set(key, p);
  }
  return p;
}

/** All variants of a model (e.g. the six grass tufts of grass_medium_01). */
export async function loadModelVariants(id: string): Promise<ModelAsset[]> {
  const { meta } = await loadFiles(id);
  return Promise.all(meta.variants.map((_, i) => loadModel(id, i)));
}

/** Like loadModel but resolves null instead of rejecting, so callers can keep their procedural fallback. */
export async function tryLoadModel(id: string, variant = 0): Promise<ModelAsset | null> {
  try {
    return await loadModel(id, variant);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ life window

/**
 * Depth material for alpha-tested parts that also carries the life-window vertex patch (same maths as
 * life.ts lifeDepthMaterial), so shadows of leaf cards grow and vanish with the instance.
 */
export function lifeAlphaDepthMaterial(map: THREE.Texture | null, alphaTest: number): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uYear = lifeUniforms.uYear;
    shader.vertexShader =
      "attribute vec4 aLife;\nuniform float uYear;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         float lifeS = smoothstep(aLife.x, aLife.y, uYear) * (1.0 - smoothstep(aLife.z, aLife.w, uYear));
         transformed.y *= lifeS;
         if (lifeS < 0.004) transformed *= 0.0;`,
      );
  };
  m.customProgramCacheKey = () => "lifeAlphaDepth";
  return m;
}

const lifeCache = new WeakMap<ModelAsset, ModelAsset>();
let sharedLifeDepth: THREE.MeshDepthMaterial | null = null;

/**
 * Copy of the asset whose materials are life-patched clones (patchLife from life.ts) with matching depth
 * materials (alpha-tested where the part is cut out). Geometry is shared. Instanced meshes using these
 * need per-instance `aLife` (vec4, timeline values as lifeUniforms.uYear, i.e. histToT) and `aFx` (vec3).
 */
export function lifeMaterials(asset: ModelAsset): ModelAsset {
  const hit = lifeCache.get(asset);
  if (hit) return hit;
  sharedLifeDepth ??= lifeDepthMaterial();
  const lods = asset.lods.map((l) => ({
    ...l,
    parts: l.parts.map((p) => {
      // clone() drops onBeforeCompile: re-apply the crown-normal hook before the life patch (which chains it)
      const c = p.material.clone();
      const defs = (c as THREE.MeshStandardMaterial & { defines?: Record<string, unknown> }).defines;
      const material = patchLife(defs && "CROWN_NORMALS" in defs ? crownNormals(c) : c);
      return {
        ...p,
        material,
        depthMaterial: p.material.alphaTest > 0 ? lifeAlphaDepthMaterial(material.map, p.material.alphaTest) : sharedLifeDepth!,
      };
    }),
  }));
  const out = { ...asset, lods };
  lifeCache.set(asset, out);
  return out;
}

// ------------------------------------------------------------------ instancing with LOD switching

export interface InstanceOptions {
  /** Add aLife/aFx attributes and use life-patched materials (default true). */
  life?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Impostor LODs cast shadows too (default false: flat cards make thin shadows). */
  impostorShadows?: boolean;
  /** Multiplies every LOD switch distance (e.g. 0.6 on low quality). */
  distanceScale?: number;
  /** Re-bucket only when the camera moved this far (m) since the last update (default 2). */
  minMove?: number;
}

interface LodBucket {
  meshes: THREE.InstancedMesh[];
  matrices: THREE.InstancedBufferAttribute;
  life: THREE.InstancedBufferAttribute | null;
  fx: THREE.InstancedBufferAttribute | null;
  count: number;
}

/**
 * Instanced placement of one model variant with per-instance LOD selection on the CPU (distance from the
 * camera, scaled by the instance's scale) and the life window on the GPU. Add `object` to the scene once,
 * call add() for each placement, then update(camera) every frame (cheap unless the camera moved).
 */
export class ModelInstances {
  readonly object = new THREE.Group();
  readonly asset: ModelAsset;
  private readonly buckets: LodBucket[] = [];
  private readonly mats: number[] = [];
  private readonly lifeVals: number[] = [];
  private readonly fxVals: number[] = [];
  private readonly scales: number[] = [];
  private readonly last = new THREE.Vector3(Infinity, Infinity, Infinity);
  private dirty = true;
  private readonly opts: Required<InstanceOptions>;

  constructor(asset: ModelAsset, readonly capacity: number, options: InstanceOptions = {}) {
    this.opts = { life: true, castShadow: true, receiveShadow: true, impostorShadows: false, distanceScale: 1, minMove: 2, ...options };
    this.asset = this.opts.life ? lifeMaterials(asset) : asset;
    this.object.name = `models:${asset.id}#${asset.variant}`;
    for (const lod of this.asset.lods) {
      const matrices = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
      matrices.setUsage(THREE.DynamicDrawUsage);
      const life = this.opts.life ? new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage) : null;
      const fx = this.opts.life ? new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage) : null;
      const meshes = lod.parts.map((p) => {
        const g = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(p.geometry.attributes)) g.setAttribute(name, attr);
        g.setIndex(p.geometry.index);
        if (life && fx) {
          g.setAttribute("aLife", life);
          g.setAttribute("aFx", fx);
        }
        const mesh = new THREE.InstancedMesh(g, p.material, capacity);
        mesh.instanceMatrix = matrices;
        mesh.count = 0;
        mesh.frustumCulled = false;
        const shadow = p.kind !== "impostor" || this.opts.impostorShadows;
        mesh.castShadow = this.opts.castShadow && shadow;
        mesh.receiveShadow = this.opts.receiveShadow;
        if (p.depthMaterial) mesh.customDepthMaterial = p.depthMaterial;
        this.object.add(mesh);
        return mesh;
      });
      this.buckets.push({ meshes, matrices, life, fx, count: 0 });
    }
  }

  get count(): number {
    return this.scales.length;
  }

  /**
   * Add an instance. `life` = (appear start, appear end, vanish start, vanish end) in timeline values
   * (histToT years); omit for "always". `fx` = (burns 0|1, evidence index, unused).
   */
  add(matrix: THREE.Matrix4, life: [number, number, number, number] = [-1e9, -1e9 + 1, 1e9, 1e9 + 1], fx: [number, number, number] = [0, 0, 0]): number {
    if (this.scales.length >= this.capacity) throw new Error(`ModelInstances(${this.asset.id}) capacity ${this.capacity} exceeded`);
    const e = matrix.elements;
    this.mats.push(...e);
    this.lifeVals.push(...life);
    this.fxVals.push(...fx);
    this.scales.push(Math.cbrt(Math.abs(matrix.determinant())) || 1);
    this.dirty = true;
    return this.scales.length - 1;
  }

  /** Convenience: position, rotation about Y (radians), uniform scale. */
  place(x: number, y: number, z: number, rotY = 0, scale = 1, life?: [number, number, number, number], fx?: [number, number, number]): number {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(scale, scale, scale));
    return this.add(m, life, fx);
  }

  clear(): void {
    this.mats.length = this.lifeVals.length = this.fxVals.length = this.scales.length = 0;
    this.dirty = true;
  }

  /** Re-bucket instances into LODs by distance to the camera. Instances past the last LOD's distance are culled. */
  update(camera: THREE.Camera | THREE.Vector3): void {
    const cam = camera instanceof THREE.Vector3 ? camera : camera.getWorldPosition(_v);
    if (!this.dirty && cam.distanceToSquared(this.last) < this.opts.minMove * this.opts.minMove) return;
    this.last.copy(cam);
    this.dirty = false;
    const lods = this.asset.lods;
    const d2 = lods.map((l) => (l.maxDistance * this.opts.distanceScale) ** 2);
    for (const b of this.buckets) b.count = 0;
    const n = this.scales.length;
    const M = this.mats;
    for (let i = 0; i < n; i++) {
      const dx = M[i * 16 + 12] - cam.x, dy = M[i * 16 + 13] - cam.y, dz = M[i * 16 + 14] - cam.z;
      const s = this.scales[i];
      const dd = (dx * dx + dy * dy + dz * dz) / (s * s);
      let li = 0;
      while (li < lods.length && dd > d2[li]) li++;
      if (li >= lods.length) continue;
      const b = this.buckets[li];
      const k = b.count++;
      const ma = b.matrices.array as Float32Array;
      for (let c = 0; c < 16; c++) ma[k * 16 + c] = M[i * 16 + c];
      if (b.life && b.fx) {
        const la = b.life.array as Float32Array, fa = b.fx.array as Float32Array;
        for (let c = 0; c < 4; c++) la[k * 4 + c] = this.lifeVals[i * 4 + c];
        for (let c = 0; c < 3; c++) fa[k * 3 + c] = this.fxVals[i * 3 + c];
      }
    }
    for (const b of this.buckets) {
      b.matrices.needsUpdate = true;
      if (b.life) b.life.needsUpdate = true;
      if (b.fx) b.fx.needsUpdate = true;
      for (const m of b.meshes) m.count = b.count;
    }
  }

  /** Instances currently drawn per LOD (after the last update). */
  lodCounts(): number[] {
    return this.buckets.map((b) => b.count);
  }

  /** Triangles drawn (after the last update). */
  triangles(): number {
    return this.buckets.reduce((s, b, i) => s + b.count * this.asset.lods[i].triangles, 0);
  }

  dispose(): void {
    for (const b of this.buckets) for (const m of b.meshes) {
      m.geometry.dispose();
      m.removeFromParent();
    }
  }
}
const _v = new THREE.Vector3();

/** Simple non-instanced THREE.LOD for one-off placements (a single ship, a door). */
export function makeLodObject(asset: ModelAsset, options: { castShadow?: boolean; receiveShadow?: boolean } = {}): THREE.LOD {
  const lod = new THREE.LOD();
  let from = 0;
  for (const l of asset.lods) {
    const g = new THREE.Group();
    for (const p of l.parts) {
      const m = new THREE.Mesh(p.geometry, p.material);
      m.castShadow = (options.castShadow ?? true) && p.kind !== "impostor";
      m.receiveShadow = options.receiveShadow ?? true;
      if (p.depthMaterial) m.customDepthMaterial = p.depthMaterial;
      g.add(m);
    }
    lod.addLevel(g, from);
    from = l.maxDistance;
  }
  return lod;
}
