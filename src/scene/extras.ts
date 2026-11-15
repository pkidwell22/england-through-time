import type * as THREE from "three";
import type { Dataset } from "@/lib/types";
import type { TerrainModel } from "@/lib/terrain";
import type { FabricLayer } from "./fabric";
import type { LandmarkLayer } from "./landmarks";

/**
 * Extension point for scene layers that are not landmarks or fabric: people,
 * animals, carts, chimney smoke, moving boats, grass… Each module registers a
 * factory here; the engine builds them with the content and calls update()
 * every frame. A factory may return null when it has nothing for this site.
 */
export interface ExtraContext {
  ds: Dataset;
  terrain: TerrainModel;
  fabric: FabricLayer;
  landmarks: LandmarkLayer;
  /** "low" | "medium" | "high" */
  quality: string;
}
export interface Extra {
  object: THREE.Object3D;
  /** t = timeline value (year, continuous); timeSec = wall clock; camera for LOD/billboards. */
  update(t: number, timeSec: number, camera: THREE.Camera): void;
  dispose?(): void;
}
export type ExtraFactory = (ctx: ExtraContext) => Extra | null;

export const EXTRA_FACTORIES: ExtraFactory[] = [];
export function registerExtra(f: ExtraFactory): void {
  if (!EXTRA_FACTORIES.includes(f)) EXTRA_FACTORIES.push(f);
}
