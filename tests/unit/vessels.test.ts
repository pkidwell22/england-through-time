import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildDataset, validateDataset, type JsonReader } from "@/lib/data";
import { hashString } from "@/lib/geo";
import { TerrainModel } from "@/lib/terrain";
import type { Dataset, Landmark, Phase, Source, VesselType } from "@/lib/types";
import { histToT } from "@/lib/years";
import baseSources from "@data/sources.json";
import { SAIL, buildVessel, readModel, type Sink } from "@/scene/vessels/model";
import { fleetOf, placeFleet } from "@/scene/vessels/placement";

/**
 * The vessel catalogue (data/locations/<site>/vessels.json) and the river-craft phases that place it.
 * The anachronism table below is driven by research/vessels.md: each row is a date the research establishes.
 */

const reader = (dir: string): JsonReader => async (file) => {
  try {
    return JSON.parse(await readFile(fileURLToPath(new URL(`../../data/locations/${dir}/${file}.json`, import.meta.url)), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
};
const base = baseSources as unknown as Record<string, Source>;
const load = (id: string): Promise<Dataset> => buildDataset(id, reader(id), base);

/** Every (year, type) shown by any boats phase with a fleet: from `from` until the start of `to`. */
function shownYears(ds: Dataset): { lm: Landmark; phase: Phase; type: VesselType; first: number; last: number }[] {
  const types = new Map((ds.vessels ?? []).map((v) => [v.id, v]));
  const end = histToT(ds.site.timeline.end);
  const out: { lm: Landmark; phase: Phase; type: VesselType; first: number; last: number }[] = [];
  for (const lm of ds.landmarks)
    for (const phase of lm.phases)
      for (const f of fleetOf(phase.model)) {
        const type = types.get(f.type);
        if (!type) continue;
        out.push({ lm, phase, type, first: histToT(phase.from), last: phase.to == null ? end : histToT(phase.to) - 1 });
      }
  return out;
}
const typesShownIn = (ds: Dataset, year: number): VesselType[] => {
  const t = histToT(year) + 0.5;
  return shownYears(ds).filter((s) => t >= s.first && t < s.last + 1).map((s) => s.type);
};

describe("vessel catalogue", async () => {
  const ds = await load("london");
  const vs = ds.vessels ?? [];

  it("loads with the dataset and validates", () => {
    expect(vs.length).toBeGreaterThanOrEqual(15);
    expect(validateDataset(ds)).toEqual([]);
  });
  it("every type has non-zero, ordered years inside the timeline, an evidence class and resolving sources", () => {
    const ids = new Set<string>();
    for (const v of vs) {
      expect(ids.has(v.id), `duplicate ${v.id}`).toBe(false);
      ids.add(v.id);
      expect(v.from, v.id).not.toBe(0);
      expect(v.to, v.id).not.toBe(0);
      expect(histToT(v.to), v.id).toBeGreaterThanOrEqual(histToT(v.from));
      expect(histToT(v.from)).toBeGreaterThanOrEqual(histToT(ds.site.timeline.start));
      expect(v.to).toBeLessThanOrEqual(1625);
      expect(["attested-standing", "attested-excavated", "attested-documentary", "attested-pictorial", "reconstructed", "conjectural"]).toContain(v.evidence);
      expect(v.sources.length, v.id).toBeGreaterThan(0);
      for (const s of v.sources) expect(ds.sources[s], `${v.id}: ${s}`).toBeTruthy();
      expect(v.summary.length).toBeGreaterThan(40);
    }
  });
  it("the per-site sources are all prefixed ves- and have urls", async () => {
    const own = JSON.parse(await readFile(fileURLToPath(new URL("../../data/locations/london/sources.json", import.meta.url)), "utf8")) as Record<string, Source>;
    for (const [k, s] of Object.entries(own)) {
      expect(k.startsWith("ves-"), k).toBe(true);
      expect(s.url).toMatch(/^https:\/\//);
    }
  });

  // ------------------------------------------------------------------ anachronism table (research/vessels.md)
  const T = (id: string): VesselType => {
    const v = vs.find((x) => x.id === id);
    if (!v) throw new Error(`no vessel type ${id}`);
    return v;
  };
  const m = (id: string) => readModel(T(id).model);
  it.each([
    ["cog", 1250, "the oldest depiction identified as a cog is the Lubeck seal of 1223; Hanse community at London later 13th c."],
    ["carrack", 1470, "carvel construction reaches England in the later 15th century"],
    ["merchant-ship", 1560, "Gresham ship, built of timber felled in or after 1574"],
    ["wherry", 1500, "watermen first recorded 1514"],
    ["tilt-boat", 1560, "tilt-boats on the long ferry from the mid 16th century"],
    ["state-barge", 1422, "earliest water procession 1422 (Brewers' records)"],
    ["hoy", 1490, "'hoye of Dorderycht', Paston letter 1495"],
    ["shout", 1300, "the shout is a 14th-15th c. river transporter"],
    ["keel-castled", 1200, "Ipswich seal 1200, earliest stern-post rudder"],
    ["longship-small", 850, "Danish fleets on the Thames from the 9th century"],
    ["saxon-trader", 600, "Lundenwic trade from about 600"],
  ] as [string, number, string][])("%s is never shown before %i (%s)", (id, year) => {
    expect(histToT(T(id).from)).toBeGreaterThanOrEqual(histToT(year));
    for (const s of shownYears(ds).filter((x) => x.type.id === id)) expect(s.first, `${s.lm.id} ${s.phase.label}`).toBeGreaterThanOrEqual(histToT(year));
  });
  it("no carvel-built type before 1470 except the Roman Mediterranean-built and small Roman craft", () => {
    for (const v of vs) {
      const md = readModel(v.model);
      if (md.build !== "carvel") continue;
      if (v.to <= 410) continue;
      expect(v.from, v.id).toBeGreaterThanOrEqual(v.id === "state-barge" ? 1422 : 1470);
    }
  });
  it("no stern rudder on any type that may be shown before 1200", () => {
    for (const v of vs) if (readModel(v.model).rudder === "stern") expect(v.from, v.id).toBeGreaterThanOrEqual(1200);
  });
  it("no side-rudder type after 1300 (seals show side rudders into the early 14th c.), and no longship after 1100", () => {
    for (const v of vs) {
      const r = readModel(v.model).rudder;
      if (r === "side" || r === "quarter-pair") expect(v.to, v.id).toBeLessThanOrEqual(1300);
    }
    expect(T("longship-small").to).toBeLessThanOrEqual(1100);
    expect(T("longship-large").to).toBeLessThanOrEqual(1100);
    expect(m("longship-small").rudder).toBe("side");
  });
  it("Roman types are gone after 410, and cogs after 1450", () => {
    for (const id of ["romano-celtic-barge", "roman-lighter", "roman-merchantman", "roman-skiff"]) expect(T(id).to).toBeLessThanOrEqual(410);
    expect(T("cog").to).toBeLessThanOrEqual(1450);
    for (const year of [450, 700, 1100, 1616]) for (const t of typesShownIn(ds, year)) expect(t.id.startsWith("roman"), `${t.id} in ${year}`).toBe(false);
  });
  it("no logboat is shown after the Roman conquest; nothing after 1625", () => {
    for (const year of [100, 900, 1300, 1600]) expect(typesShownIn(ds, year).map((t) => t.id)).not.toContain("logboat");
    for (const s of shownYears(ds)) expect(s.last).toBeLessThanOrEqual(histToT(1625));
  });
  it("castles only on types from 1200; carvel ships with high castles only 1470-1580", () => {
    for (const v of vs) {
      const md = readModel(v.model);
      if (md.castles.aft || md.castles.fore) expect(v.from, v.id).toBeGreaterThanOrEqual(1200);
    }
    expect(T("carrack").to).toBeLessThanOrEqual(1580);
  });

  // ------------------------------------------------------------------ phases
  it("every fleet only uses types valid for the phase's whole span (also checked by validateDataset)", () => {
    for (const s of shownYears(ds)) {
      expect(s.first, `${s.lm.id}/${s.type.id}`).toBeGreaterThanOrEqual(histToT(s.type.from));
      expect(s.last, `${s.lm.id}/${s.type.id}`).toBeLessThanOrEqual(histToT(s.type.to));
    }
  });
  it("the placements are labelled conjectural and say that the types carry their own evidence", () => {
    for (const lm of ds.landmarks) {
      if (!lm.phases.some((p) => fleetOf(p.model).length)) continue;
      expect(lm.evidence, lm.id).toBe("conjectural");
      expect(`${lm.summary} ${lm.uncertainty ?? ""}`, lm.id).toMatch(/illustrative|invented/i);
    }
  });
  it("the river shows almost nothing in prehistory and at the bridgehead in the 5th-9th centuries", () => {
    const count = (year: number, filter: (id: string) => boolean = () => true): number => {
      const t = histToT(year) + 0.5;
      let n = 0;
      for (const lm of ds.landmarks) for (const p of lm.phases) {
        if (t < histToT(p.from) || (p.to != null && t >= histToT(p.to))) continue;
        if (filter(lm.id)) for (const f of fleetOf(p.model)) n += f.n + (f.moving ?? 0);
      }
      return n;
    };
    expect(count(-4000)).toBe(0);
    expect(count(-2500)).toBe(0);
    expect(count(-2000)).toBeLessThanOrEqual(3);
    expect(count(-100)).toBeLessThanOrEqual(3);
    expect(count(600)).toBe(0);
    expect(count(800, (id) => id !== "lundenwic-beach-craft")).toBe(0);
    expect(count(1616)).toBeGreaterThan(80);
  });
  it("after 1500 (drawbridge no longer raised) every craft that cannot pass the bridge is placed below it", () => {
    for (const s of shownYears(ds)) {
      if (s.first < histToT(1500)) continue;
      for (const f of fleetOf(s.phase.model)) {
        if (f.type !== s.type.id || readModel(s.type.model).passesBridge) continue;
        if (f.zone.endsWith("-above")) {
          // only upriver craft (western barges) may lie above it
          expect(s.type.id, `${s.lm.id}: ${f.type} in ${f.zone}`).toBe("western-barge");
        } else expect(["pool", "below", "river-below", "north-below", "south-below"], `${s.lm.id}: ${f.type} in ${f.zone}`).toContain(f.zone);
      }
    }
  });
  it("the 1014 staging keeps its saga sources, stays conjectural and shows only longships of the period, for 1014 only", () => {
    const o = ds.landmarks.find((l) => l.id === "olafs-fleet")!;
    expect(o.evidence).toBe("conjectural");
    expect(o.sources).toContain("ev-heimskringla-saga-of-olaf-haraldson-chapter-on-t");
    expect(o.phases).toHaveLength(1);
    expect(o.phases[0].from).toBe(1014);
    expect(o.phases[0].to).toBe(1015);
    for (const f of fleetOf(o.phases[0].model)) expect(f.type.startsWith("longship")).toBe(true);
  });
  it("Brentford's fishing boats use its own catalogue and validate", async () => {
    const b = await buildDataset("brentford", reader("brentford"), base);
    expect(validateDataset(b)).toEqual([]);
    expect((b.vessels ?? []).map((v) => v.id)).toContain("clinker-skiff");
  });
});

describe("vessel models and placement", async () => {
  const ds = await load("london");
  const tm = new TerrainModel(ds.site);
  const count = (id: string, state: "moored" | "underway" | "rowing" = "moored"): number => {
    const v = ds.vessels!.find((x) => x.id === id)!;
    let tris = 0;
    const sink: Sink = { add: (_m, g) => { tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } };
    buildVessel(sink, readModel(v.model), state, new THREE.Matrix4());
    return tris;
  };
  it("ships stay within about 1,500 triangles, mid-sized craft 800 and small craft (under 9 m) 300", () => {
    for (const v of ds.vessels!) {
      const md = readModel(v.model);
      const budget = md.len >= 14 ? 1600 : md.len >= 9 ? 800 : 320;
      for (const st of ["moored", "underway", "rowing"] as const) expect(count(v.id, st), `${v.id} ${st}`).toBeLessThanOrEqual(budget);
    }
  });
  it("models are finite, sit in the water and carry the features their type describes", () => {
    for (const v of ds.vessels!) {
      const md = readModel(v.model);
      const mats = new Set<string>();
      let lo = Infinity;
      const sink: Sink = {
        add: (mat, g, mm) => {
          mats.add(mat);
          const p = g.clone().applyMatrix4(mm).attributes.position;
          for (let i = 0; i < p.count; i++) {
            expect(Number.isFinite(p.getY(i))).toBe(true);
            lo = Math.min(lo, p.getY(i));
          }
        },
      };
      buildVessel(sink, md, "underway", new THREE.Matrix4());
      expect(lo, v.id).toBeLessThan(0); // the hull reaches below the waterline
      if (md.masts.length && md.masts.some((s) => s.rig !== "brailed")) expect(mats.has(SAIL), `${v.id} sail`).toBe(true);
      if (md.tilt || md.masts.length) expect(mats.has(SAIL)).toBe(true);
    }
  });
  it("placement puts most of each fleet afloat (or on the shore for beach zones), clear of the bridge", () => {
    const tested = ["river-traffic-roman", "river-traffic-medieval", "lundenwic-beach-craft", "olafs-fleet", "river-craft-prehistoric"];
    for (const id of tested) {
      const lm = ds.landmarks.find((l) => l.id === id)!;
      lm.phases.forEach((phase, i) => {
        const year = phase.from + 3;
        const ctx = {
          ground: (x: number, z: number) => tm.height(x, z, year),
          path: (lm.path ?? []).map(([la, lo]) => tm.proj.toLocal(la, lo)),
          project: (la: number, lo: number) => tm.proj.toLocal(la, lo),
          seed: hashString(lm.id) + i,
        };
        const placed = placeFleet(phase.model, ctx);
        const wanted = fleetOf(phase.model).reduce((n, f) => n + f.n, 0);
        expect(placed.length, `${id} phase ${i} (${phase.label})`).toBeGreaterThanOrEqual(Math.floor(wanted * 0.75));
        for (const p of placed) {
          const g = ctx.ground(p.x, p.z);
          if (p.state === "beached") expect(g, `${id} beached`).toBeLessThan(1.5);
          else expect(g, `${id} ${p.type.id} afloat`).toBeLessThan(-0.3);
        }
      });
    }
  });
});

describe("moving craft and the bridges", async () => {
  const { BoatLayer } = await import("@/scene/pop/boats");
  const { bridgeLayout } = await import("@/scene/district");
  const ds = await load("london");
  const tm = new TerrainModel(ds.site);
  type LaneBoat = { entry: number; lx: Float32Array | null; lz: Float32Array | null; cross: boolean };
  type Internals = { boats: LaneBoat[]; entries: { type: VesselType; model: { passesBridge: boolean } }[] };
  const bridgePath = (id: string) => (ds.landmarks.find((l) => l.id === id)!.path ?? []).map(([la, lo]) => tm.proj.toLocal(la, lo));
  /** Where each lane crosses the bridge line: metres from the bridge's north end, or null if it does not cross. */
  const crossings = (lane: LaneBoat, path: [number, number][]): number[] => {
    const [a, c] = [path[0], path[path.length - 1]];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const dx = (c[0] - a[0]) / len, dz = (c[1] - a[1]) / len;
    const out: number[] = [];
    if (!lane.lx || !lane.lz) return out;
    const side = (x: number, z: number) => (x - a[0]) * dz - (z - a[1]) * dx;
    for (let i = 1; i < lane.lx.length; i++) {
      const s0 = side(lane.lx[i - 1], lane.lz[i - 1]), s1 = side(lane.lx[i], lane.lz[i]);
      if (s0 === 0 || Math.sign(s0) === Math.sign(s1)) continue;
      const f = s0 / (s0 - s1);
      const x = lane.lx[i - 1] + (lane.lx[i] - lane.lx[i - 1]) * f, z = lane.lz[i - 1] + (lane.lz[i] - lane.lz[i - 1]) * f;
      const along = (x - a[0]) * dx + (z - a[1]) * dz;
      if (along > -5 && along < len + 5) out.push(along);
    }
    return out;
  };
  const run = (year: number): Internals => {
    const layer = new BoatLayer(ds, tm, 1, false);
    layer.update(histToT(year) + 0.5, 10);
    return layer as unknown as Internals;
  };

  it("in 1616 small craft pass Old London Bridge only through its arches, and ships never pass it", () => {
    const path = bridgePath("old-london-bridge");
    const L = bridgeLayout(path, 19);
    const lb = run(1616);
    let through = 0;
    for (const b of lb.boats) {
      const xs = crossings(b, path);
      const e = lb.entries[b.entry];
      if (!e.model.passesBridge) expect(xs, `${e.type.id} crosses the bridge`).toEqual([]);
      for (const x of xs) {
        through++;
        expect(L.openings.some((o) => x > o.x0 + 0.3 && x < o.x1 - 0.3), `${e.type.id} at ${x.toFixed(1)} m is not in an arch`).toBe(true);
      }
    }
    expect(through).toBeGreaterThan(0);
  });
  it("in 1100 small craft pass the timber bridge between its trestles", () => {
    const path = bridgePath("saxon-bridge");
    const len = Math.hypot(path[1][0] - path[0][0], path[1][1] - path[0][1]);
    const n = Math.max(2, Math.round(len / 11));
    const lb = run(1100);
    for (const b of lb.boats)
      for (const x of crossings(b, path)) {
        const k = (x * n) / len;
        expect(Math.abs(k - Math.round(k)) * (len / n), `lane at ${x.toFixed(1)} m hits a trestle`).toBeGreaterThan(1.5);
      }
  });
  it("in 700, with no bridge standing, nothing moves at the bridgehead and the Lundenwic craft move freely", () => {
    const lb = run(700);
    expect(lb.entries.some((e) => e.type.id === "saxon-trader")).toBe(true);
    for (const b of lb.boats) if (lb.entries[b.entry].type.id.startsWith("roman")) expect(b.lx).toBeNull();
  });
});
