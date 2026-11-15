import * as THREE from "three";
import { MODEL_BASE_URL, tryLoadModel, lifeMaterials, type ModelAsset } from "../assets/models";
import { fadeDepthMaterial, makeFade, makeOctaImpostor, patchFade, type OctaInfo } from "./impostor";
import type { Species, TreeLod, TreeMeshSet, TreeSource } from "./types";

/**
 * Tree source built from the CC0 Poly Haven scans in public/assets/models (see docs/ASSETS.md, docs/VEGETATION.md).
 *
 * HONESTY: none of these is a named British species. `island_tree_01/02/03` are unnamed coastal broadleaves and
 * `tree_small_02` is Burkea africana. They stand in for "a broadleaf tree" and are scaled up from 2.6-5 m to
 * the sizes lowland trees reach; the species names in vegetation.ts (oak, lime ...) only say which role a model plays.
 *
 * Levels: LOD0 (scan, ~12k triangles), LOD1 (~2.5k), then a hemi-octahedral impostor (veg/impostor.ts, baked by
 * scripts/bake-octa.mjs). Neighbouring levels cross-fade over a band (`fade` uniforms, filled in by vegetation.ts).
 * If the octahedral bake is missing, the old crossed-billboard impostor of the model library is used, without fades.
 */

/** Model ids, in set order. */
const IDS = ["island_tree_01", "island_tree_02", "island_tree_03", "tree_small_02"] as const;

/** Largest scale each model is used at: beyond this its (true-size) leaves would read as dinner plates. */
const MAX_SCALE = [4.9, 5.0, 3.6, 4.7];

const texLoader = new THREE.TextureLoader();
async function loadOcta(id: string): Promise<{ info: OctaInfo; colour: THREE.Texture; normal: THREE.Texture } | null> {
  try {
    const r = await fetch(`${MODEL_BASE_URL}${id}/octa.json`);
    if (!r.ok) return null;
    const info = (await r.json()) as OctaInfo;
    const [colour, normal] = await Promise.all(["octa_c.webp", "octa_n.webp"].map((f) => texLoader.loadAsync(`${MODEL_BASE_URL}${id}/${f}`)));
    colour.colorSpace = THREE.SRGBColorSpace;
    normal.colorSpace = THREE.NoColorSpace;
    for (const t of [colour, normal]) {
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = 4;
    }
    return { info, colour, normal };
  } catch {
    return null;
  }
}

export async function loadScannedSource(dist: [number, number]): Promise<TreeSource | null> {
  const [assets, octas] = await Promise.all([Promise.all(IDS.map((id) => tryLoadModel(id, 0))), Promise.all(IDS.map((id) => loadOcta(id)))]);
  if (assets.some((a) => !a)) return null;
  // `?treeimp=cards` keeps the old crossed-card impostors (for comparisons)
  const cards = typeof location !== "undefined" && new URLSearchParams(location.search).get("treeimp") === "cards";
  const useOcta = !cards && octas.every((o) => o);
  const sets: TreeMeshSet[] = (assets as ModelAsset[]).map((a, i) => {
    const la = lifeMaterials(a);
    const yStretch = i === 2 ? 1 : 1.22;
    const setHeight = a.height * yStretch;
    if (useOcta) {
      const o = octas[i]!;
      const fades = [makeFade(), makeFade(), makeFade()];
      // own material clones: the fade patch must not reach other users of the model library's life materials
      const lods: TreeLod[] = la.lods.slice(0, 2).map((l, li) => ({
        parts: l.parts.map((p) => {
          const leaf = p.kind !== "opaque";
          const material = patchFade(cloneLife(p.material), { fade: fades[li], setHeight, leaf, key: `${li}` });
          return {
            geometry: p.geometry,
            material,
            depthMaterial: fadeDepthMaterial(leaf ? p.material.map : null, leaf ? p.material.alphaTest : 0, { fade: fades[li], setHeight }),
            castShadow: true,
            leaf,
          };
        }),
        maxDist: li === 0 ? dist[0] : dist[1],
        fade: fades[li],
      }));
      const imp = makeOctaImpostor(o.info, o.colour, o.normal, { fade: fades[2], setHeight });
      lods.push({ parts: [{ geometry: imp.geometry, material: imp.material, depthMaterial: imp.depthMaterial, castShadow: true, leaf: true }], maxDist: Infinity, fade: fades[2] });
      return { id: a.id, height: a.height, maxScale: MAX_SCALE[i], yStretch, lods };
    }
    // ---- fallback: the model library's crossed-billboard impostor ----
    // Mip-mapped alpha-tested impostors thin out with distance (the crown shrinks to a few specks, so a closed wood reads
    // as open). A lower threshold on the (life-patched, cached, vegetation-only) impostor materials keeps the crowns whole.
    const imp = la.lods[la.lods.length - 1];
    for (const p of imp.parts) {
      p.material.alphaTest = 0.2;
      const dm = p.depthMaterial as THREE.MeshDepthMaterial | undefined;
      if (dm) dm.alphaTest = 0.2;
    }
    const lods: TreeLod[] = la.lods.map((l, li) => ({
      parts: l.parts.map((p) => ({
        geometry: p.geometry,
        material: p.material,
        depthMaterial: p.depthMaterial!,
        castShadow: p.kind !== "impostor",
        leaf: p.kind !== "opaque",
      })),
      maxDist: li === 0 ? dist[0] : li === 1 ? dist[1] : Infinity,
    }));
    // Seen from above, two crossed vertical impostor quads are a pair of slivers and the ground shows through a "closed" wood.
    // A horizontal plate at crown height, textured from the crown interior of the impostor image, gives the canopy a top.
    if (i !== 2) {
      const far = lods[lods.length - 1];
      const w = Math.max(a.width, a.depth) * 0.42, y = a.height * 0.68;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([-w, y, -w, w, y, -w, w, y, w, -w, y, w], 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute([0.1, 0.4, 0.4, 0.4, 0.4, 0.75, 0.1, 0.75], 2));
      g.setIndex([0, 2, 1, 0, 3, 2]);
      const src = far.parts[0];
      far.parts.push({ geometry: g, material: src.material, depthMaterial: src.depthMaterial, castShadow: false, leaf: true });
    }
    return { id: a.id, height: a.height, maxScale: MAX_SCALE[i], yStretch, lods };
  });
  return {
    name: useOcta ? "scanned+octa" : "scanned",
    sets,
    // Roles (not identifications): broad spreading crowns (01, 02) for oak-like canopy trees; the tall narrow-trunked
    // slender one (small_02) for lime, ash and elm-like trees and alder; the low windswept multi-stem one (03) for hazel,
    // thorn scrub and hedgerow shrubs; the broad low one (02) as willow.
    variants: { oak: [0, 1, 1], lime: [3, 0], elm: [3, 0], ash: [3], alder: [3], willow: [1], hazel: [2], scrub: [2] },
  };
}

/** A life-patched material clone that keeps the crown-normal define and hook (clone() drops onBeforeCompile). */
function cloneLife(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const c = m.clone();
  c.onBeforeCompile = m.onBeforeCompile;
  return c;
}
