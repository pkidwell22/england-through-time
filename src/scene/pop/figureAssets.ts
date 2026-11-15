import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { FigureShared } from "./figureShader";

/**
 * Loading of the generated crowd figures (public/assets/figures, built by scripts/build-figures.mjs): the manifest,
 * the animation texture, the detail atlas and one GLB per garment set, each fetched once and kept for the session.
 * Every loader rejects cleanly if the files are missing; the populace then keeps the block figures.
 */

const BASE = "/assets/figures/";

export interface FigureBodyInfo {
  id: string;
  type: number;
  sex: "m" | "f";
  child: boolean;
  elder: boolean;
  height: number;
  k: number;
  S1: number;
  S2: number;
  Sf: number;
  v0: number;
}
export interface FigureOutfit {
  name: string;
  /** weight when the populace asks for a short garment (tunic) and for a long one (gown) */
  w: [number, number];
}
export interface FigureManifest {
  version: number;
  frames: number;
  layers: string[];
  bones: number;
  anim: { file: string; width: number; height: number; depth: number };
  textures: { map: string; normal: string };
  bodies: FigureBodyInfo[];
  sets: Record<string, { file: string; bodies: Record<string, { outfits: FigureOutfit[]; lods: { mesh: string; tris: number; verts: number; perOutfit: number[] }[] }> }>;
  periods: { set: string; from: number; to: number }[];
}
export interface FigureSetAsset {
  name: string;
  /** body id -> geometries by level of detail, and the outfits the meshes carry */
  bodies: Map<string, { lods: THREE.BufferGeometry[]; outfits: FigureOutfit[]; tris: number[]; perOutfit: number[][] }>;
}

let manifestP: Promise<FigureManifest> | null = null;
let sharedP: Promise<FigureShared> | null = null;
const setP = new Map<string, Promise<FigureSetAsset>>();

export function loadFigureManifest(): Promise<FigureManifest> {
  if (!manifestP)
    manifestP = fetch(BASE + "figures.json").then((r) => {
      if (!r.ok) throw new Error("figures.json " + r.status);
      return r.json() as Promise<FigureManifest>;
    });
  return manifestP;
}

function loadTexture(url: string, srgb: boolean): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.flipY = false; // glTF texture convention, as the UVs were written
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
        t.anisotropy = 4;
        t.needsUpdate = true;
        resolve(t);
      },
      undefined,
      () => reject(new Error("texture " + url)),
    );
  });
}

export function loadFigureShared(): Promise<FigureShared> {
  if (!sharedP)
    sharedP = loadFigureManifest().then(async (m) => {
      const [bin, map, normalMap] = await Promise.all([
        fetch(BASE + m.anim.file).then((r) => {
          if (!r.ok) throw new Error("anim " + r.status);
          return r.arrayBuffer();
        }),
        loadTexture(BASE + m.textures.map, true),
        loadTexture(BASE + m.textures.normal, false),
      ]);
      const { width, height, depth } = m.anim;
      const data = new Uint16Array(bin);
      if (data.length !== width * height * depth * 4) throw new Error("anim size");
      const anim = new THREE.Data3DTexture(data, width, height, depth);
      anim.format = THREE.RGBAFormat;
      anim.type = THREE.HalfFloatType;
      anim.minFilter = anim.magFilter = THREE.LinearFilter;
      anim.wrapS = THREE.ClampToEdgeWrapping;
      anim.wrapT = THREE.RepeatWrapping; // frames loop
      anim.wrapR = THREE.ClampToEdgeWrapping;
      anim.generateMipmaps = false;
      anim.unpackAlignment = 1;
      anim.needsUpdate = true;
      // three clones texture uniforms per material: hand back the one shared texture
      anim.clone = (() => anim) as unknown as typeof anim.clone;
      return { anim, map, normalMap, dims: new THREE.Vector4(width, height, depth, 0) };
    });
  return sharedP;
}

export function loadFigureSet(name: string): Promise<FigureSetAsset> {
  let p = setP.get(name);
  if (p) return p;
  p = loadFigureManifest().then(async (m) => {
    const entry = m.sets[name];
    if (!entry) throw new Error("no figure set " + name);
    const gltf = await new GLTFLoader().loadAsync(BASE + entry.file);
    const byName = new Map<string, THREE.Mesh>();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) byName.set(mesh.name || mesh.parent?.name || "", mesh);
    });
    const out: FigureSetAsset = { name, bodies: new Map() };
    for (const [id, b] of Object.entries(entry.bodies)) {
      const lods: THREE.BufferGeometry[] = [];
      for (const l of b.lods) {
        const mesh = byName.get(l.mesh);
        if (!mesh) throw new Error("figure mesh missing " + l.mesh);
        lods.push(dequantise(mesh));
      }
      out.bodies.set(id, { lods, outfits: b.outfits, tris: b.lods.map((l) => l.tris), perOutfit: b.lods.map((l) => l.perOutfit) });
    }
    return out;
  });
  setP.set(name, p);
  p.catch(() => setP.delete(name));
  return p;
}

/** Positions are int16 in the file with the node's translation and scale restoring metres: bake that in. */
function dequantise(mesh: THREE.Mesh): THREE.BufferGeometry {
  const g = mesh.geometry;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const m = mesh.matrixWorld;
  const out = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  const ng = new THREE.BufferGeometry();
  ng.setAttribute("position", new THREE.BufferAttribute(out, 3));
  for (const k of ["normal", "uv", "_bones", "_weights", "_fig"]) {
    const a = g.getAttribute(k);
    if (!a) throw new Error("figure attribute missing " + k);
    ng.setAttribute(k, a);
  }
  ng.setIndex(g.getIndex());
  ng.computeBoundingSphere();
  return ng;
}

/** The garment set for a historical year. */
export function setForYear(m: FigureManifest, hist: number): string {
  for (const p of m.periods) if (hist >= p.from && hist < p.to) return p.set;
  return m.periods[m.periods.length - 1].set;
}
