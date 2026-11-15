import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { normaliseSite } from "@/lib/data";
import { makeProjector } from "@/lib/geo";
import { INLET_BED, TerrainModel, type InletGeom } from "@/lib/terrain";
import type { Site } from "@/lib/types";
import { BUILDERS, type BuildCtx } from "@/scene/builders";
import { registerEcclesiastical } from "@/scene/detail/ecclesiastical";
import { Builder } from "@/scene/geom";
import { cutAt, streetNetwork } from "@/scene/street/network";
import { cutAtInlets, type XZ } from "@/scene/waterline";
import londonSite from "@data/locations/london/site.json";
import londonLandmarks from "@data/locations/london/landmarks.json";
import londonStreets from "@data/locations/london/streets.json";

/** Second-pass structural fixes (docs/AUDIT.md, "Structural fixes"): dock inlets, dated lane ends, church anchors. */

const riverSite = (inlets: unknown[]): Site =>
  normaliseSite({
    id: "t", name: "T", subtitle: "", scopeNote: "", origin: { lat: 51.5, lon: 0 },
    bounds: { xMin: -500, xMax: 500, zMin: -500, zMax: 500 }, timeline: { start: 900, end: 1625 }, terrain: {},
    river: {
      centreline: [[51.4995, -0.02, 100, 100, 1], [51.4995, 0.02, 100, 100, 1]],
      northBankSetback: [{ year: 900, value: 60 }, { year: 1500, value: 0 }],
      inlets,
    },
  } as unknown as Site);

describe("dock inlets (site.river.inlets)", () => {
  // a dock whose head stands on the bank of 900 (the bank is ~ 55 m north of the centreline then 60 m further)
  const proj = makeProjector(51.5, 0);
  const headZ = -55 - 60 - 2;
  const [hla, hlo] = proj.toLatLon(0, headZ);
  const site = riverSite([{ id: "d", name: "Dock", lat: hla, lon: hlo, bearing: 180, width: 30, from: 1000, to: null, evidence: "conjectural", confidence: "low", sources: ["x"] }]);
  const tm = new TerrainModel(site);

  it("keeps water in the dock once the frontage either side is reclaimed, from its opening year", () => {
    const inside = tm.staticSample(0, headZ + 30), beside = tm.staticSample(40, headZ + 30);
    const y1400 = tm.yearParams(1400), y950 = tm.yearParams(950);
    expect(tm.heightFrom(beside, y1400)).toBeGreaterThan(1);
    expect(tm.landHeightFrom(inside, y1400)).toBeGreaterThan(1);
    expect(tm.heightFrom(inside, y1400)).toBeLessThan(INLET_BED + 0.3);
    // before the dock opens (and on a site with no inlets) the ground is untouched
    expect(tm.heightFrom(inside, tm.yearParams(990))).toBeCloseTo(tm.landHeightFrom(inside, tm.yearParams(990)), 6);
    expect(tm.heightFrom(inside, y950)).toBeCloseTo(tm.landHeightFrom(inside, y950), 6);
    // behind its head the ground is not cut
    const behind = tm.staticSample(0, headZ - 6);
    expect(tm.heightFrom(behind, y1400)).toBeCloseTo(tm.landHeightFrom(behind, y1400), 6);
  });

  it("is dated: the opening year is a ground keyframe and appears in yearParams", () => {
    expect(tm.keyTimes()).toContain(1000);
    expect(tm.yearParams(999).inlets).toEqual([0]);
    expect(tm.yearParams(1001).inlets).toEqual([1]);
    expect(new TerrainModel(riverSite([])).yearParams(1001).inlets).toBeUndefined();
  });

  it("cuts a frontage at the dock and lines it with the water on the same hand", () => {
    const q: InletGeom = { id: "d", x: 0, z: 0, ux: 0, uz: 1, half: 10, length: 200, t0: 0, t1: Infinity };
    const pts: XZ[] = Array.from({ length: 21 }, (_, i) => [-70 + i * 7, 40]);
    const { segs, runs } = cutAtInlets(pts, [q]);
    const parts = segs.map((s) => s.part);
    expect(parts.filter((p) => p === "side")).toHaveLength(2);
    expect(parts.filter((p) => p === "head")).toHaveLength(1);
    expect(runs).toHaveLength(2);
    // no frontage across the dock's mouth
    for (const s of segs) if (s.part === "river") expect(Math.abs((s.a[0] + s.b[0]) / 2)).toBeGreaterThan(10);
    // water (the river, +z, for the frontage; the dock for its lining) lies on the right-hand normal (-dz, dx)
    for (const s of segs) {
      const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], l = Math.hypot(dx, dz);
      const mx = (s.a[0] + s.b[0]) / 2 + (-dz / l) * 2, mz = (s.a[1] + s.b[1]) / 2 + (dx / l) * 2;
      const wet = s.part === "river" ? mz > 40 : Math.abs(mx) < 10 && mz > 0;
      expect(wet, `${s.part} at ${mx.toFixed(1)}, ${mz.toFixed(1)}`).toBe(true);
    }
    // a dock that has not yet opened beyond the bank leaves the frontage whole
    expect(cutAtInlets(pts.map(([x]) => [x, 1] as XZ), [q]).segs.every((s) => s.part === "river")).toBe(true);
  });

  it("London: Queenhithe and Billingsgate are inlets tied to their dock landmarks", () => {
    const inl = (londonSite as unknown as Site).river!.inlets!;
    for (const id of ["queenhithe", "billingsgate"]) {
      const q = inl.find((x) => x.landmark === id)!;
      const lm = (londonLandmarks as { id: string; lat: number; lon: number; bearing?: number; phases: { model: Record<string, unknown> }[] }[]).find((l) => l.id === id)!;
      expect(q, id).toBeDefined();
      expect([lm.lat, lm.lon, lm.bearing]).toEqual([q.lat, q.lon, q.bearing]);
      expect(lm.phases[0].model.inlet).toBe(true);
      expect(q.sources.length).toBeGreaterThan(0);
      expect(q.uncertainty?.length).toBeGreaterThan(40);
    }
  });
});

describe("dated lane ends (streets.json reach)", () => {
  type Raw = { id: string; years: [number, number]; points: [number, number][]; reach?: { anchor: string; evidence: string; confidence?: string; note?: string; stages: { from: number; to: number; end: [number, number] }[] } };
  const raw = (londonStreets as unknown as { streets: Raw[] }).streets;
  const proj = makeProjector((londonSite as unknown as Site).origin.lat, (londonSite as unknown as Site).origin.lon);

  it("stages are inside the street's years, in order, not overlapping, and end on its line", () => {
    for (const s of raw.filter((q) => q.reach)) {
      const r = s.reach!;
      expect(["first", "last"]).toContain(r.anchor);
      expect(r.evidence, s.id).toBeTruthy();
      expect(r.note?.length, s.id).toBeGreaterThan(40);
      let prev = -Infinity;
      const line = s.points.map(([la, lo]) => proj.toLocal(la, lo));
      for (const st of r.stages) {
        expect(st.from, s.id).toBeGreaterThanOrEqual(s.years[0]);
        expect(st.to, s.id).toBeLessThanOrEqual(s.years[1]);
        expect(st.from, s.id).toBeGreaterThan(prev);
        expect(st.to).toBeGreaterThanOrEqual(st.from);
        prev = st.to;
        const e = proj.toLocal(st.end[0], st.end[1]);
        const cut = cutAt(line, e);
        const last = cut[cut.length - 1];
        expect(Math.hypot(last[0] - e[0], last[1] - e[1]), s.id).toBeLessThan(1);
      }
    }
  });

  it("the network gives one record per stage, growing from the anchored end", () => {
    const net = streetNetwork("london", proj)!;
    const fish = net.filter((s) => s.id === "fish-street-hill").sort((a, b) => a.t0 - b.t0);
    expect(fish.length).toBeGreaterThan(2);
    // fish-street-hill is anchored at its last (northern) point and grows south towards the bridge
    const north = fish[0].pts[fish[0].pts.length - 1];
    for (let i = 1; i < fish.length; i++) {
      expect(fish[i].t0).toBeGreaterThanOrEqual(fish[i - 1].t1);
      expect(fish[i].pts[fish[i].pts.length - 1]).toEqual(north);
      const len = (p: [number, number][]) => p.slice(1).reduce((a, q, k) => a + Math.hypot(q[0] - p[k][0], q[1] - p[k][1]), 0);
      expect(len(fish[i].pts)).toBeGreaterThan(len(fish[i - 1].pts));
    }
    // a street without `reach` is one record for all its years
    expect(net.filter((s) => s.id === "eastcheap")).toHaveLength(1);
  });
});

describe("church phases pinned by one end (eastEnd / westEnd)", () => {
  registerEcclesiastical();
  const extentX = (model: Record<string, unknown>): [number, number] => {
    const b = new Builder();
    const ctx = { ground: () => 0, path: [], x: 0, z: 0, tier: "overview", seed: 1, project: () => [0, 0] } as unknown as BuildCtx;
    BUILDERS.church(b, { kind: "church", ...model }, ctx);
    const box = new THREE.Box3();
    for (const [, g] of b.merged()) { g.computeBoundingBox(); box.union(g.boundingBox!); }
    return [box.min.x, box.max.x];
  };
  it("a longer phase with the same east end grows westwards only", () => {
    const base = { w: 24, h: 31, wall: "caen", roof: "lead", aisles: true, transept: { l: 62, w: 24 }, crossingAt: 0.6 };
    const [w2, e2] = extentX({ ...base, l: 110, eastEnd: 60 });
    const [w3, e3] = extentX({ ...base, l: 124, eastEnd: 60, crossingAt: 0.645 });
    expect(Math.abs(e3 - e2)).toBeLessThan(0.5);
    expect(w2 - w3).toBeGreaterThan(12);
    const [wc] = extentX({ ...base, l: 110 });
    expect(wc).toBeLessThan(w2 - 4); // centred by default
  });
  it("London: Westminster Abbey's last phase ends where Henry VII's Chapel begins", () => {
    const L = londonLandmarks as { id: string; lat: number; lon: number; phases: { model: Record<string, unknown> }[] }[];
    const abbey = L.find((l) => l.id === "westminster-abbey")!, chapel = L.find((l) => l.id === "henry-vii-chapel")!;
    const p = makeProjector(abbey.lat, abbey.lon);
    const [cx] = p.toLocal(chapel.lat, chapel.lon);
    const chapelWest = cx - (chapel.phases[0].model.l as number) / 2;
    const m3 = abbey.phases[2].model;
    expect(m3.eastEnd as number).toBeLessThanOrEqual(chapelWest + 1);
    expect(abbey.phases[1].model.eastEnd).toBe(m3.eastEnd);
  });
});
