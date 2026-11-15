import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildDataset, prepareTerrain, type JsonReader } from "@/lib/data";
import { Heightmap, encodeRGBA, type GridBounds } from "@/lib/heightmap";
import { TerrainModel } from "@/lib/terrain";
import type { Site, SiteLidar } from "@/lib/types";
import { histToT } from "@/lib/years";

const reader = (dir: string): JsonReader => async (file) => {
  try {
    return JSON.parse(await readFile(fileURLToPath(new URL(`${dir}/${file}.json`, import.meta.url)), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
};

/** A grid sampling f(x, z) at its nodes. */
function gridOf(b: GridBounds, w: number, h: number, f: (x: number, z: number) => number, mask?: (x: number, z: number) => number): Heightmap {
  const data = new Float32Array(w * h);
  const m = mask ? new Float32Array(w * h) : null;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = b.xMin + (i * (b.xMax - b.xMin)) / (w - 1), z = b.zMin + (j * (b.zMax - b.zMin)) / (h - 1);
      data[j * w + i] = f(x, z);
      if (m && mask) m[j * w + i] = mask(x, z);
    }
  return new Heightmap(w, h, b, data, m);
}

const lidarOf = (grid: Heightmap, use: SiteLidar["use"], extra: Partial<SiteLidar> = {}): SiteLidar => ({
  use, image: "/none.png", width: grid.width, height: grid.height, bounds: grid.bounds, scale: 0.02, offset: 0, localDatumOffset: 0, grid, ...extra,
});

describe("heightmap encoding", () => {
  it("round-trips through the RG16 encoding to within half a step, with the mask in blue", () => {
    const vals = Float32Array.from([0, 12.345, 101.6, 250.019, 1300.02, -4.5]);
    const mask = Float32Array.from([0, 0.25, 0.5, 0.75, 1, 1]);
    const scale = 0.02, offset = -10;
    const px = encodeRGBA(vals, scale, offset, mask);
    const g = Heightmap.fromRGBA(px, 3, 2, { xMin: 0, xMax: 2, zMin: 0, zMax: 1 }, scale, offset, true);
    for (let i = 0; i < vals.length; i++) {
      expect(Math.abs(g.data[i] - vals[i])).toBeLessThanOrEqual(scale / 2 + 1e-6);
      expect(Math.abs(g.mask![i] - mask[i])).toBeLessThan(1 / 255 + 1e-6);
    }
    expect(px[3]).toBe(255);
  });
  it("decodes RGB (3-channel) data the way the Python builder writes it", () => {
    const g = Heightmap.fromRGBA([1, 2, 255, 0, 10, 128, 3, 0, 0, 0, 0, 0], 2, 2, { xMin: 0, xMax: 1, zMin: 0, zMax: 1 }, 0.5, 1, false, 3);
    expect(g.data[0]).toBeCloseTo((256 + 2) * 0.5 + 1);
    expect(g.data[1]).toBeCloseTo(10 * 0.5 + 1);
    expect(g.mask).toBeNull();
  });
  it("rejects inconsistent sizes", () => {
    expect(() => new Heightmap(2, 2, { xMin: 0, xMax: 1, zMin: 0, zMax: 1 }, new Float32Array(3))).toThrow();
    expect(() => Heightmap.fromRGBA(new Uint8Array(8), 2, 2, { xMin: 0, xMax: 1, zMin: 0, zMax: 1 }, 1, 0)).toThrow();
  });
});

describe("heightmap sampling", () => {
  const b = { xMin: -100, xMax: 100, zMin: -50, zMax: 150 };
  const plane = (x: number, z: number) => 50 + 0.1 * x - 0.03 * z;
  const g = gridOf(b, 21, 41, plane);

  it("is node-registered and reproduces a plane exactly by bilinear interpolation", () => {
    expect(g.dx).toBeCloseTo(10);
    expect(g.dz).toBeCloseTo(5);
    for (const [x, z] of [[-100, -50], [100, 150], [3.3, 7.7], [-99.9, 149.9], [55.5, -12.25]]) expect(g.sample(x, z)).toBeCloseTo(plane(x, z), 4);
  });
  it("interpolates bilinearly between nodes", () => {
    const sq = gridOf({ xMin: 0, xMax: 1, zMin: 0, zMax: 1 }, 2, 2, (x, z) => (x === 1 && z === 1 ? 4 : 0));
    expect(sq.sample(0.5, 0.5)).toBeCloseTo(1);
    expect(sq.sample(1, 0.5)).toBeCloseTo(2);
  });
  it("is NaN (and mask 0) outside the grid", () => {
    expect(g.sample(-100.01, 0)).toBeNaN();
    expect(g.sample(0, 150.5)).toBeNaN();
    expect(g.sampleMask(0, 151)).toBe(0);
    expect(g.sampleMask(0, 0)).toBe(1);
  });
  it("fades to zero at the edge", () => {
    expect(g.edgeWeight(-100, 0, 40)).toBe(0);
    expect(g.edgeWeight(-60, 0, 40)).toBe(1);
    expect(g.edgeWeight(-80, 0, 40)).toBeCloseTo(0.5);
    expect(g.edgeWeight(0, 0, 0)).toBe(1);
  });
  it("samples the trust mask bilinearly", () => {
    const m = gridOf(b, 21, 41, plane, (x) => (x < 0 ? 0 : 1));
    expect(m.sampleMask(-50, 0)).toBe(0);
    expect(m.sampleMask(50, 0)).toBe(1);
    expect(m.sampleMask(-5, 0)).toBeCloseTo(0.5);
  });
});

describe("terrain model with a LIDAR grid", () => {
  it("falls back to the analytic relief when there is no sidecar", async () => {
    const ds = await buildDataset("ridge", reader("../fixtures/ridge"), {});
    expect(ds.site.lidar).toBeUndefined();
    await prepareTerrain(ds); // node: nothing to decode, must not throw
    const a = new TerrainModel(ds.site);
    expect(a.height(0, 0, 0)).toBeGreaterThan(2);
  });

  it("'replace-analytic' uses the grid (less localDatumOffset) inside and the analytic model outside, blended at the edge", async () => {
    const ds = await buildDataset("ridge", reader("../fixtures/ridge"), {});
    const analytic = new TerrainModel(ds.site);
    const b = { xMin: -500, xMax: 500, zMin: -400, zMax: 400 };
    const grid = gridOf(b, 101, 81, (x, z) => 164 + 0.01 * x + 0.002 * z);
    const site: Site = { ...ds.site, lidar: lidarOf(grid, "replace-analytic", { localDatumOffset: 100, edgeBlend: 100 }) };
    const m = new TerrainModel(site);
    const t = histToT(1000);
    expect(m.height(0, 0, t)).toBeCloseTo(64, 3);
    expect(m.height(250, -150, t)).toBeCloseTo(64 + 2.5 - 0.3, 3);
    // outside the grid: exactly the analytic model
    expect(m.height(700, 600, t)).toBe(analytic.height(700, 600, t));
    // within the edge blend: between the two
    const e = m.height(-450, 0, t), ga = 64 - 4.5, an = analytic.height(-450, 0, t);
    expect(e).toBeGreaterThanOrEqual(Math.min(ga, an) - 1e-6);
    expect(e).toBeLessThanOrEqual(Math.max(ga, an) + 1e-6);
  });

  it("'replace-analytic' with `extend` continues the grid's edge outwards and fades to the analytic model far away", async () => {
    const ds = await buildDataset("ridge", reader("../fixtures/ridge"), {});
    const analytic = new TerrainModel(ds.site);
    const grid = gridOf({ xMin: -500, xMax: 500, zMin: -400, zMax: 400 }, 101, 81, (x) => 60 + 0.01 * x);
    const m = new TerrainModel({ ...ds.site, lidar: lidarOf(grid, "replace-analytic", { extend: 1000 }) });
    expect(m.height(-500, 0, 0)).toBeCloseTo(55, 3); // no fade at the edge itself
    expect(m.height(-510, 0, 0)).toBeCloseTo(55, 0); // just outside: still the edge value
    expect(m.height(-2000, 0, 0)).toBe(analytic.height(-2000, 0, 0)); // beyond the fade: analytic
    expect(grid.distanceOutside(-600, 500)).toBeCloseTo(Math.hypot(100, 100));
    expect(grid.sampleClamped(-900, 0)).toBeCloseTo(55, 4);
  });

  it("still cuts dated valleys (with `fill`) into a 'replace-analytic' grid, but not undated ones", async () => {
    const ds = await buildDataset("ridge", reader("../fixtures/ridge"), {});
    const b = { xMin: -800, xMax: 800, zMin: -800, zMax: 800 };
    const grid = gridOf(b, 81, 81, () => 50);
    const lidar = lidarOf(grid, "replace-analytic", { edgeBlend: 0 });
    const v = ds.site.terrain.valleys![0];
    const [x, z] = new TerrainModel(ds.site).proj.toLocal(v.path[0][0], (v.path[0][1] + v.path[1][1]) / 2);
    const undated = new TerrainModel({ ...ds.site, lidar });
    expect(undated.height(x, z, 0)).toBeCloseTo(50, 5);
    const dated = new TerrainModel({ ...ds.site, lidar, terrain: { ...ds.site.terrain, valleys: [{ ...v, fill: [{ year: -4000, value: 0 }, { year: 1000, value: 1 }] }] } });
    expect(dated.height(x, z, histToT(-4000))).toBeCloseTo(50 - v.depth, 1);
    expect(dated.height(x, z, histToT(1500))).toBeCloseTo(50, 5);
  });

  it("'upland-only' changes nothing near the river or where the mask is 0, and is ignored on a site without a river", async () => {
    const ds = await buildDataset("crossing", reader("../fixtures/crossing"), {});
    const analytic = new TerrainModel(ds.site);
    const b = { xMin: -600, xMax: 600, zMin: -600, zMax: 600 };
    const grid = gridOf(b, 61, 61, () => 30, (x) => (x > 0 ? 1 : 0));
    const m = new TerrainModel({ ...ds.site, lidar: lidarOf(grid, "upland-only", { edgeBlend: 0, riverClearance: [100, 200] }) });
    const t = histToT(1016);
    let changedNear = 0, changedMasked = 0, changedFar = 0;
    for (let x = -590; x <= 590; x += 20)
      for (let z = -590; z <= 590; z += 20) {
        const s = analytic.staticSample(x, z);
        const bank = s.dRiver >= 0 ? s.dRiver - s.leftHalf : -s.dRiver - s.rightHalf;
        const d = Math.abs(m.height(x, z, t) - analytic.height(x, z, t));
        if (bank < 100 && d > 1e-9) changedNear++;
        if (x < -10 && d > 1e-9) changedMasked++;
        if (bank > 250 && x > 10 && d > 1e-6) changedFar++;
      }
    expect(changedNear).toBe(0);
    expect(changedMasked).toBe(0);
    expect(changedFar).toBeGreaterThan(0);
    const ridge = await buildDataset("ridge", reader("../fixtures/ridge"), {});
    const r = new TerrainModel({ ...ridge.site, lidar: lidarOf(grid, "upland-only", { edgeBlend: 0 }) });
    expect(r.height(100, 0, t)).toBe(new TerrainModel(ridge.site).height(100, 0, t));
  });

  it("leaves London's heights unchanged: its sidecar says use 'none', so even a decoded grid is ignored", async () => {
    const ds = await buildDataset("london", reader("../../data/locations/london"), {});
    const plain = new TerrainModel({ ...ds.site, lidar: undefined });
    const l = ds.site.lidar;
    if (l) expect(l.use).toBe("none");
    const b = ds.site.bounds;
    const grid = gridOf({ xMin: b.xMin, xMax: b.xMax, zMin: b.zMin, zMax: b.zMax }, 49, 31, () => 99);
    const withGrid = new TerrainModel({ ...ds.site, lidar: { ...(l ?? lidarOf(grid, "none")), use: l?.use ?? "none", grid } });
    const pts: [number, number][] = [[0, 0], [-120, -380], [-1050, -430], [-330, -120], [600, -150], [-2500, 600], [-60, 200], [1200, 900], [-3000, -1400], [250, 50]];
    for (const year of [-4000, 50, 1066, 1625])
      for (const [x, z] of pts) expect(withGrid.height(x, z, histToT(year))).toBe(plain.height(x, z, histToT(year)));
  });
});
