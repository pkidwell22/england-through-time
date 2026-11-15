import * as THREE from "three";
import type { PhaseModel } from "@/lib/types";
import { BUILDERS, type BuildCtx } from "./builders";
import type { Builder } from "./geom";
import { tileOf } from "./materials";
import { buildVessel, readModel, type Sink } from "./vessels/model";
import { placeFleet } from "./vessels/placement";

/**
 * Period vessel types (replaces the generic `boats` builder). A `boats` phase lists a `fleet` of vessel TYPE ids
 * from the site's vessels.json, with numbers and zones; each type is drawn by one parametric model built from its
 * catalogue parameters (src/scene/vessels/model.ts), and placed by the zone rules in src/scene/vessels/placement.ts.
 * The types carry their own dates and evidence; the numbers and positions are illustrative. See docs/VESSELS.md.
 */

/** Generic small clinker boat used only for an old-style `boats` phase that names no fleet (period-neutral, no masts). */
const FALLBACK = readModel({ hull: "double", build: "clinker", len: 5.2, beam: 1.5, depth: 0.6, sheer: 0.3, oars: 1, rudder: "none" });

function vesselsBuilder(b: Builder, m: PhaseModel, ctx: BuildCtx): void {
  if (ctx.hasWater === false) return;
  const sink: Sink = { add: (mat, g, mm) => b.add(mat, g, mm) };
  // craft lie off the frontage, never inside a dock inlet (whose water runs on into the reclaimed ground, between
  // its lined sides): the river's edges are found on the ground with the inlets left out
  const land = ctx.land;
  const g0 = ctx.ground;
  if (land) ctx = { ...ctx, ground: (x, z) => Math.max(g0(x, z), land(x, z)) };
  if (Array.isArray(m.fleet)) {
    for (const p of placeFleet(m, ctx)) {
      const base = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(p.heel, p.rot, 0, "YXZ")).setPosition(p.x, p.y, p.z);
      buildVessel(sink, p.model, p.state, base, tileOf);
    }
    return;
  }
  // legacy phase without a fleet: a few small boats along the path, no ships
  const n = typeof m.count === "number" ? Math.min(40, m.count) : 6;
  const fake: PhaseModel = { ...m, fleet: [{ type: "_", n, zone: "river" }] };
  Object.defineProperty(fake, "vesselTypes", { value: { _: { id: "_", name: "", from: -4000, to: 1625, evidence: "conjectural", confidence: "low", summary: "", sources: [], model: { ...FALLBACK } } }, enumerable: false });
  for (const p of placeFleet(fake, ctx)) {
    const base = new THREE.Matrix4().makeRotationY(p.rot).setPosition(p.x, p.y, p.z);
    buildVessel(sink, p.model, "moored", base, tileOf);
  }
}

/** Called once by the engine after the base builders are registered. */
export function registerVessels(): void {
  BUILDERS.boats = vesselsBuilder;
}
