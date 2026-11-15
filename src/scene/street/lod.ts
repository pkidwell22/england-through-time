import * as THREE from "three";
import { registerExtra, type Extra, type ExtraContext } from "../extras";
import { buildStreetSurfaces } from "./surface";

/**
 * The street layer's per-frame hook (an Extra, so engine.ts needs no change):
 *  - drives the fabric's distance-based level of detail (FabricLayer.setLod) whenever the camera has moved
 *    more than 3 m, so near houses use the rich model, the district the detail model, far ones the overview;
 *  - owns the street surfaces of the district network and shows each for its dated years.
 */
function factory(ctx: ExtraContext): Extra | null {
  const { fabric, terrain, landmarks, ds } = ctx;
  const group = new THREE.Group();
  group.name = "streets";
  const bounds = ds.site.district?.bounds;
  const surfaces = fabric.streets && bounds ? buildStreetSurfaces(fabric.streets, terrain, landmarks, bounds) : [];
  for (const s of surfaces) group.add(s.mesh);
  const last = new THREE.Vector3(Infinity, Infinity, Infinity);
  let lastT = NaN;
  return {
    object: group,
    update(t, _sec, camera) {
      if (t !== lastT) {
        lastT = t;
        for (const s of surfaces) s.mesh.visible = t >= s.t0 && t < s.t1;
      }
      const p = camera.position;
      if (p.distanceToSquared(last) > 9) {
        last.copy(p);
        fabric.setLod(p);
      }
    },
    dispose() {
      for (const s of surfaces) {
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
      }
    },
  };
}

export function registerStreetExtra(): void {
  registerExtra(factory);
}
