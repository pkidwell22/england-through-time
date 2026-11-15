import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOCATION_IDS, buildDataset, defaultEras, eraAt, initialYear, loadDataset, normaliseSite, validateDataset, type JsonReader } from "@/lib/data";
import { STAGED_KINDS, phaseStatus } from "@/lib/lifecycle";
import { MIN_LAND, TerrainModel } from "@/lib/terrain";
import type { Phase, Site, Source } from "@/lib/types";
import { TimeScale, histToT } from "@/lib/years";
import baseSources from "@data/sources.json";

/** Reads tests/fixtures/<id>/<file>.json; a missing file is `undefined`, as with the bundled reader. */
const fixture = (id: string): JsonReader => async (file) => {
  try {
    return JSON.parse(await readFile(fileURLToPath(new URL(`../fixtures/${id}/${file}.json`, import.meta.url)), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
};
const base = baseSources as unknown as Record<string, Source>;
const load = (id: string) => buildDataset(id, fixture(id), base);

describe("location loader", () => {
  it("registers London and the two battlefield sites", () => {
    expect(LOCATION_IDS).toEqual(expect.arrayContaining(["london", "brentford", "barnet"]));
  });
  it("still loads London through the bundled reader, complete and valid", async () => {
    const ds = await loadDataset("london");
    expect(ds.site.id).toBe("london");
    expect(ds.eras.length).toBeGreaterThan(2);
    expect(ds.landmarks.length).toBeGreaterThan(20);
    expect(ds.episodes.length).toBeGreaterThan(0);
    expect(validateDataset(ds)).toEqual([]);
    expect(initialYear(ds)).toBe(ds.eras[ds.eras.length - 1].presetYear);
  });
  it("rejects an unknown id with a message naming the known ones", async () => {
    await expect(loadDataset("atlantis")).rejects.toThrow(/Unknown location "atlantis".*london/);
  });
  it("reports a missing location folder clearly instead of crashing", async () => {
    await expect(load("no-such-folder")).rejects.toThrow(/No data for location "no-such-folder".*site\.json was not found/);
  });
  it("falls back to one era spanning the timeline, and empty events and episodes", async () => {
    const ds = await load("ridge");
    expect(ds.eras).toHaveLength(1);
    expect(ds.eras[0]).toMatchObject({ from: 1400, to: 1500, presetYear: 1471, name: "Fixture Ridge" });
    expect(ds.events).toEqual([]);
    expect(ds.episodes).toEqual([]);
    expect(ds.landmarks.length).toBe(10);
    expect(validateDataset(ds)).toEqual([]);
  });
  it("uses the site's own eras when it has them, and tolerates having no landmarks or zones", async () => {
    const ds = await load("crossing");
    expect(ds.eras.map((e) => e.id)).toEqual(["early", "late"]);
    expect(ds.landmarks).toEqual([]);
    expect(ds.zones).toEqual([]);
    expect(validateDataset(ds)).toEqual([]);
  });
  it("merges the site's sources over the shared list", async () => {
    const ds = await load("ridge");
    expect(ds.sources["fix-1"].title).toBe("Fixture source");
    expect(Object.keys(ds.sources).length).toBe(Object.keys(base).length + 1);
    expect((await load("crossing")).sources).toEqual(base);
  });
  it("fills the optional parts of a site: scale, views, polygons, woodland", async () => {
    const { site } = await load("crossing");
    expect(site.polygons).toEqual({});
    expect(site.woodland.cover.length).toBeGreaterThan(0);
    expect(site.views.length).toBe(1);
    expect(site.views[0].position.every(Number.isFinite)).toBe(true);
    const ridge = (await load("ridge")).site;
    expect(ridge.timeline.scale).toEqual([{ year: 1400, u: 0 }, { year: 1500, u: 1 }]);
    // the default view of a site without a river looks at its ground, not at y = 0
    expect(ridge.views[0].target[1]).toBe(30);
  });
  it("names the problem when site.json is unusable", () => {
    expect(() => normaliseSite({ id: "x" } as unknown as Site)).toThrow(/no "origin"/);
    expect(() => normaliseSite({ origin: {}, bounds: {}, timeline: { start: 1500, end: 1400 }, terrain: {} } as unknown as Site)).toThrow(/end \(1400\) must be later than start/);
  });
  it("the validator flags troop blocks not marked conjectural, pathless path kinds and bad scales", async () => {
    const ds = await load("ridge");
    ds.landmarks.find((l) => l.id === "block-a")!.evidence = "attested-documentary";
    ds.landmarks.find((l) => l.id === "hedge")!.path = undefined;
    ds.site.timeline.scale = [{ year: 1410, u: 0 }, { year: 1500, u: 1 }];
    const problems = validateDataset(ds).join("\n");
    expect(problems).toMatch(/block-a: troop blocks .* "conjectural"/);
    expect(problems).toMatch(/hedge: kind "hedge" needs a path/);
    expect(problems).toMatch(/scale starts at 1410/);
  });
});

describe("timeline windows", () => {
  it("a short window maps onto the whole slider and clamps to its own ends", async () => {
    const { site } = await load("ridge");
    const sc = new TimeScale(site.timeline.scale);
    expect(sc.tMin).toBe(1400);
    expect(sc.tMax).toBe(1500);
    expect(sc.tToU(1450)).toBeCloseTo(0.5, 10);
    expect(sc.uToT(1)).toBe(1500);
    expect(sc.clamp(histToT(-4000))).toBe(1400);
    expect(sc.clamp(1625)).toBe(1500);
  });
  it("a site's own non-linear scale is honoured", async () => {
    const { site } = await load("crossing");
    const sc = new TimeScale(site.timeline.scale);
    expect(sc.tToU(1000)).toBeCloseTo(0.3, 10);
    expect(sc.uToT(0.65)).toBeCloseTo(1050, 6);
  });
  it("the opening year is the site's initialYear, else the last era's preset, always inside the window", async () => {
    const ridge = await load("ridge");
    expect(initialYear(ridge)).toBe(1471);
    const crossing = await load("crossing");
    expect(initialYear(crossing)).toBe(1016);
    for (const ds of [ridge, crossing]) {
      const t = histToT(initialYear(ds));
      expect(t).toBeGreaterThanOrEqual(histToT(ds.site.timeline.start));
      expect(t).toBeLessThanOrEqual(histToT(ds.site.timeline.end));
    }
  });
  it("eraAt works with a single era and at both ends of the window", async () => {
    const ridge = await load("ridge");
    for (const t of [1400, 1471.5, 1500.99]) expect(eraAt(ridge.eras, t).id).toBe("site");
    const crossing = await load("crossing");
    expect(eraAt(crossing.eras, 900).id).toBe("early");
    expect(eraAt(crossing.eras, 1015.9).id).toBe("early");
    expect(eraAt(crossing.eras, 1016).id).toBe("late");
    expect(eraAt(crossing.eras, 1100.5).id).toBe("late");
  });
  it("the default era of a site with no initialYear presets to the middle of its window", () => {
    const site = normaliseSite({ id: "x", name: "X", subtitle: "", scopeNote: "", origin: { lat: 0, lon: 0 }, bounds: { xMin: 0, xMax: 1, zMin: 0, zMax: 1 }, timeline: { start: -100, end: 100 }, terrain: {} });
    const [era] = defaultEras(site);
    expect(era.from).toBe(-100);
    expect(era.to).toBe(100);
    expect(era.presetYear).not.toBe(0);
    expect(histToT(era.presetYear)).toBeGreaterThan(histToT(-100));
    expect(histToT(era.presetYear)).toBeLessThan(histToT(100));
  });
});

describe("terrain without a river", () => {
  it("is land everywhere: finite, never at or below the water datum, at every year", async () => {
    const { site } = await load("ridge");
    const tm = new TerrainModel(site);
    expect(tm.hasRiver).toBe(false);
    let min = Infinity, max = -Infinity;
    for (const t of [1400, 1471.5, 1500]) {
      const yp = tm.yearParams(t);
      expect(yp.setback).toBe(0);
      expect(yp.embank).toBe(0);
      // well beyond the bounds too: the mesh has a far apron
      for (let x = -9000; x <= 9000; x += 450)
        for (let z = -9000; z <= 9000; z += 450) {
          const s = tm.staticSample(x, z);
          const h = tm.heightFrom(s, yp);
          expect(Number.isFinite(h)).toBe(true);
          expect(s.dRiver).toBeGreaterThan(0);
          min = Math.min(min, h);
          max = Math.max(max, h);
        }
    }
    expect(min).toBeGreaterThanOrEqual(MIN_LAND);
    expect(max).toBeLessThan(80);
  });
  it("follows base, slope, hills and valleys", async () => {
    const { site } = await load("ridge");
    const tm = new TerrainModel(site);
    const h = (x: number, z: number) => tm.height(x, z, 1471);
    // slope bearing 0 = the ground rises to the north (negative z), 1 m in 100 m
    expect(h(500, -600) - h(500, 600)).toBeGreaterThan(8);
    expect(h(500, -600) - h(500, 600)).toBeLessThan(16);
    // the knoll stands above the ground at the same northing
    const [kx, kz] = tm.proj.toLocal(51.661, -0.199);
    expect(h(kx, kz) - h(kx + 700, kz)).toBeGreaterThan(5);
    // the dry valley is lower than the ground either side of it
    const [, vz] = tm.proj.toLocal(51.657, -0.2);
    expect(h(0, vz)).toBeLessThan(h(0, vz + 220) - 1);
    expect(h(0, vz)).toBeLessThan(h(0, vz - 220) - 1);
    // placement tests never treat this ground as wet
    expect(tm.dry(h(0, vz), 1.25)).toBe(true);
    expect(tm.dry(-5, 1.25)).toBe(true);
    expect(tm.floor(h(0, 0))).toBe(h(0, 0));
  });
  it("a deep valley bottoms out at MIN_LAND rather than going under water", () => {
    const site = normaliseSite({
      id: "x", name: "X", subtitle: "", scopeNote: "", origin: { lat: 51, lon: 0 }, bounds: { xMin: -500, xMax: 500, zMin: -500, zMax: 500 },
      timeline: { start: 1400, end: 1500 }, terrain: { base: 5, valleys: [{ name: "v", path: [[51, -0.01], [51, 0.01]], depth: 40, sigma: 80 }] },
    });
    const tm = new TerrainModel(site);
    expect(tm.height(0, 0, 1450)).toBe(MIN_LAND);
    expect(tm.height(0, 480, 1450)).toBeGreaterThan(3);
  });
});

describe("terrain with a river", () => {
  it("keeps water in the channel and land on the banks; widthScale narrows the channel", async () => {
    const { site } = await load("crossing");
    const tm = new TerrainModel(site);
    expect(tm.hasRiver).toBe(true);
    expect(tm.height(0, 0, 1000)).toBeLessThan(0);
    expect(tm.height(0, -300, 1000)).toBeGreaterThan(1.25);
    expect(tm.dry(tm.height(0, 0, 1000), 1.25)).toBe(false);
    expect(tm.floor(-2)).toBe(0);
    // half-width 100 m scaled by 0.5: 80 m from the centreline is land here, water at full width
    expect(tm.height(0, -80, 1000)).toBeGreaterThan(0.5);
    const wide = new TerrainModel({ ...site, river: { ...site.river!, widthScale: 1 } });
    expect(wide.height(0, -80, 1000)).toBeLessThan(0);
  });
  it("needs no setback or embankment keyframes", async () => {
    const { site } = await load("crossing");
    const yp = new TerrainModel(site).yearParams(1000);
    expect(yp).toEqual({ setback: 0, embank: 0, valleyFill: [] });
  });
});

describe("staged kinds (troops, camps, area markers)", () => {
  const phase = (kind: string, from: number, to: number | null): Phase => ({ label: "x", from, to, model: { kind } });
  it("are present and complete from the start of `from` to the start of `to`, with no building or teardown", () => {
    for (const kind of STAGED_KINDS) {
      // one year, written either way
      for (const p of [phase(kind, 1471, 1471), phase(kind, 1471, 1472)]) {
        expect(phaseStatus(p, 1470.999).height, kind).toBe(0);
        for (const t of [1471, 1471.3, 1471.5, 1471.999]) expect(phaseStatus(p, t), kind).toMatchObject({ state: "intact", height: 1 });
        expect(phaseStatus(p, 1472).height, kind).toBe(0);
      }
      expect(phaseStatus(phase(kind, 1016, 1020), 1019.9).state).toBe("intact");
      expect(phaseStatus(phase(kind, 1016, 1020), 1020).state).toBe("gone");
      expect(phaseStatus(phase(kind, 1016, null), 1500).state).toBe("intact");
    }
  });
  it("ordinary kinds keep their construction and teardown behaviour", () => {
    expect(phaseStatus(phase("church", 1471, 1480), 1471.5).state).toBe("construction");
    expect(phaseStatus(phase("church", 1471, 1480), 1480.5).state).toBe("teardown");
  });
});
