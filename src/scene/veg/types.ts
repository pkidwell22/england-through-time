import type * as THREE from "three";

/**
 * Where a species' meshes come from is not the placement code's business: the procedural card trees in
 * `procedural.ts` and the scanned-model adapter in `scanned.ts` both produce a `TreeSource`. Geometry carries
 * position, normal, uv and (optionally) colour; the instance attributes (matrix, aLife, instance colour) are
 * attached by `vegetation.ts`. Materials must already be life-window patched, and `depthMaterial` must respect the
 * same window (and alpha test).
 */
export interface TreePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  depthMaterial: THREE.Material;
  /** Whether instances of this part cast shadows (at this level). */
  castShadow: boolean;
  /** Foliage (takes the species leaf tint) rather than bark (takes only brightness variation). */
  leaf: boolean;
}

/** One detail level: one or more parts (bark, leaf cards ...) drawn for the same instances. */
export interface TreeLod {
  parts: TreePart[];
  /** Largest camera distance (m, for an instance of "standard" size) at which this level is used; the last level uses Infinity. */
  maxDist: number;
  /**
   * Cross-fade band shared with the GPU (veg/impostor.ts): (in start, in end, out start, out end) in the normalised
   * distance of vegetation.ts. Set by vegetation.ts. Levels without it switch hard at maxDist.
   */
  fade?: { value: THREE.Vector4 };
}

export interface TreeMeshSet {
  id: string;
  /** Nominal height in metres at instance scale 1. */
  height: number;
  /** Largest uniform scale the set is used at (a scan blown up too far shows its leaves too large). */
  maxScale: number;
  /** Extra vertical stretch (<1 squat, >1 taller and slimmer trunk than the scan). Default 1. */
  yStretch?: number;
  /** Near to far. */
  lods: TreeLod[];
}

/**
 * Tree roles. With the scanned models these are NOT identifications: each role maps onto one of four stand-in scans
 * (docs/VEGETATION.md) with its own size range, tint and wet/dry ground. The names say which British tree the role
 * stands for in the species mix.
 */
export type Species = "oak" | "lime" | "elm" | "ash" | "hazel" | "alder" | "willow" | "scrub";

/** A swappable source of tree meshes: the sets, and which sets stand in for which species. */
export interface TreeSource {
  name: string;
  sets: TreeMeshSet[];
  /** Set indices per species, picked by a per-tree hash. */
  variants: Record<Species, number[]>;
}
