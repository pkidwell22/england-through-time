import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type * as THREE from "three";
import { buildDataset } from "@/lib/data";
import { hashString } from "@/lib/geo";
import { TerrainModel } from "@/lib/terrain";
import type { Dataset, Landmark } from "@/lib/types";
import { BUILDERS, MAX_TROOPS, WORLD_SPACE_KINDS, factionColor, type BuildCtx } from "@/scene/builders";
import { Builder } from "@/scene/geom";

const read = (id: string) => async (file: string) => {
  try {
    return JSON.parse(await readFile(fileURLToPath(new URL(`../fixtures/${id}/${file}.json`, import.meta.url)), "utf8"));
  } catch {
    return undefined;
  }
};

function build(ds: Dataset, tm: TerrainModel, lm: Landmark): Map<string, THREE.BufferGeometry> {
  const phase = lm.phases[0];
  const [x, z] = tm.proj.toLocal(lm.lat, lm.lon);
  const ctx: BuildCtx = {
    ground: (gx, gz) => tm.height(gx, gz, 1471), path: (lm.path ?? []).map(([la, lo]) => tm.proj.toLocal(la, lo)), x, z, tier: lm.tier,
    seed: hashString(lm.id), project: (la, lo) => tm.proj.toLocal(la, lo), hasWater: tm.hasRiver, bearing: lm.bearing ?? 90,
    polygon: (name) => ds.site.polygons[name]?.map(([la, lo]) => tm.proj.toLocal(la, lo)),
  };
  const b = new Builder();
  BUILDERS[phase.model.kind](b, phase.model, ctx);
  return b.merged();
}
const verts = (geos: Map<string, THREE.BufferGeometry>) => [...geos.values()].reduce((n, g) => n + g.attributes.position.count, 0);
const yRange = (geos: Map<string, THREE.BufferGeometry>): [number, number] => {
  let lo = Infinity, hi = -Infinity;
  for (const g of geos.values()) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      expect(Number.isFinite(p.getX(i)) && Number.isFinite(p.getY(i)) && Number.isFinite(p.getZ(i))).toBe(true);
      lo = Math.min(lo, p.getY(i));
      hi = Math.max(hi, p.getY(i));
    }
  }
  return [lo, hi];
};

describe("battlefield and countryside kinds", async () => {
  const ds = await buildDataset("ridge", read("ridge"), {});
  const tm = new TerrainModel(ds.site);
  const lm = (id: string) => ds.landmarks.find((l) => l.id === id)!;

  it("every new kind is registered and authored in world space", () => {
    for (const k of ["troops", "zone-marker", "tents", "camp", "hedge", "field-strips", "ford"]) {
      expect(BUILDERS[k], k).toBeTypeOf("function");
      expect(WORLD_SPACE_KINDS.has(k), k).toBe(true);
    }
  });
  it("every landmark in the fixture builds to finite geometry standing on the ground", () => {
    for (const l of ds.landmarks) {
      if (!WORLD_SPACE_KINDS.has(l.phases[0].model.kind)) continue;
      const geos = build(ds, tm, l);
      expect(verts(geos), l.id).toBeGreaterThan(0);
      const [lo, hi] = yRange(geos);
      // the fixture's ground lies between about 15 and 50 m; nothing may be left down at the water datum
      expect(lo, l.id).toBeGreaterThan(10);
      expect(hi, l.id).toBeLessThan(60);
    }
  });
  it("troops: foot figures are about 1.7 m, riders about 2.4 m, and the block is deterministic", () => {
    const flatSite = { ...ds.site, terrain: { base: 10 } };
    const flat = new TerrainModel(flatSite);
    const one = (model: Record<string, unknown>) => {
      const l = { ...lm("block-a"), phases: [{ ...lm("block-a").phases[0], model: { kind: "troops", ...model } }] };
      return build(ds, flat, l);
    };
    const g0 = flat.height(0, 0, 1471);
    const foot = yRange(one({ count: 1, cols: 1, facing: 0 }));
    expect(foot[1] - g0).toBeGreaterThan(1.5);
    expect(foot[1] - g0).toBeLessThan(1.95);
    const rider = yRange(one({ count: 1, cols: 1, facing: 0, mounted: true }));
    expect(rider[1] - g0).toBeGreaterThan(2.2);
    expect(rider[1] - g0).toBeLessThan(2.65);
    const a = one({ count: 40, cols: 10, faction: "a", facing: 30 }), b = one({ count: 40, cols: 10, faction: "a", facing: 30 });
    expect([...a.keys()]).toEqual([...b.keys()]);
    for (const [k, g] of a) expect(Array.from(g.attributes.position.array)).toEqual(Array.from(b.get(k)!.attributes.position.array));
    // more figures, more geometry; and the count is capped
    expect(verts(one({ count: 80, cols: 10 }))).toBeGreaterThan(verts(a));
    expect(verts(one({ count: 1e6, cols: 100 }))).toBe(verts(one({ count: MAX_TROOPS, cols: 100 })));
  });
  it("troops: a block fills cols x rows at the given spacing and faces its bearing", () => {
    const l = { ...lm("block-a"), phases: [{ ...lm("block-a").phases[0], model: { kind: "troops", count: 100, cols: 20, spacing: 2, facing: 0 } }] };
    const geos = build(ds, tm, l);
    let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (const g of geos.values()) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        xMin = Math.min(xMin, p.getX(i)); xMax = Math.max(xMax, p.getX(i)); zMin = Math.min(zMin, p.getZ(i)); zMax = Math.max(zMax, p.getZ(i));
      }
    }
    // facing north: 20 files across east-west (about 38 m), 5 ranks deep north-south (about 8 m)
    expect(xMax - xMin).toBeGreaterThan(36);
    expect(xMax - xMin).toBeLessThan(42);
    expect(zMax - zMin).toBeGreaterThan(7);
    expect(zMax - zMin).toBeLessThan(12);
  });
  it("factions are tints only: two fixed ones, a stable colour for any other name", () => {
    expect(factionColor("a")).not.toBe(factionColor("b"));
    expect(factionColor("lancaster")).toMatch(/^#[0-9a-f]{6}$/);
    expect(factionColor("lancaster")).toBe(factionColor("lancaster"));
    expect(factionColor("#123456")).toBe("#123456");
    const mats = [...build(ds, tm, lm("block-a")).keys()];
    expect(mats).toContain(`flat:${factionColor("a")}`);
  });
  it("zone-marker: a translucent fill in the given colour plus an outline, draped just above the ground", () => {
    const geos = build(ds, tm, lm("area"));
    const names = [...geos.keys()];
    expect(names).toContain("flat:#c0392b:0.25");
    expect(names.some((n) => n === "flat:#c0392b:0.75")).toBe(true);
    const fill = geos.get("flat:#c0392b:0.25")!.attributes.position;
    for (let i = 0; i < fill.count; i += 7) {
      const d = fill.getY(i) - tm.height(fill.getX(i), fill.getZ(i), 1471);
      expect(d).toBeGreaterThan(0.2);
      expect(d).toBeLessThan(0.7);
    }
  });
  it("field-strips stay inside their ring", () => {
    const ring = ds.site.polygons.common.map(([la, lo]) => tm.proj.toLocal(la, lo));
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    const p = [...build(ds, tm, lm("strips")).values()][0].attributes.position;
    expect(p.count).toBeGreaterThan(100);
    for (let i = 0; i < p.count; i++) {
      expect(p.getX(i)).toBeGreaterThan(Math.min(...xs) - 3);
      expect(p.getX(i)).toBeLessThan(Math.max(...xs) + 3);
      expect(p.getZ(i)).toBeGreaterThan(Math.min(...zs) - 3);
      expect(p.getZ(i)).toBeLessThan(Math.max(...zs) + 3);
    }
  });
  it("a timber bridge on a site without water sits on its banks, not at the water datum", () => {
    const l = { ...lm("lane"), phases: [{ ...lm("lane").phases[0], model: { kind: "bridge", width: 4, deck: 2, span: 6 } }], path: [[51.6572, -0.2], [51.6568, -0.2]] as [number, number][] };
    const [lo, hi] = yRange(build(ds, tm, l));
    const bank = tm.height(...tm.proj.toLocal(51.6572, -0.2), 1471);
    expect(hi).toBeGreaterThan(bank + 1.5);
    expect(hi).toBeLessThan(bank + 5);
    expect(lo).toBeGreaterThan(bank - 12);
  });
});
