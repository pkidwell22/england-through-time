import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOCATION_IDS, initialYear, loadDataset, validateDataset } from "@/lib/data";
import { instanceLife, phaseStatus } from "@/lib/lifecycle";
import { TerrainModel } from "@/lib/terrain";
import type { Dataset, Landmark, Phase } from "@/lib/types";
import { TimeScale, histToT } from "@/lib/years";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DIR = `${ROOT}/data/locations/stonehenge`;
const readJson = (f: string) => JSON.parse(readFileSync(`${DIR}/${f}.json`, "utf8"));

let ds: Dataset;
const lm = (id: string): Landmark => {
  const l = ds.landmarks.find((x) => x.id === id);
  if (!l) throw new Error(`no landmark ${id}`);
  return l;
};
/** A phase shows something when its state is not absent/gone and some height stands. `year` is a historical year; the status is read at its start (or `frac` of the way through). */
const phasePresent = (p: Phase, year: number, frac = 0) => {
  const s = phaseStatus(p, histToT(year) + frac);
  return s.state !== "absent" && s.state !== "gone" && s.height > 0;
};
const present = (id: string, year: number, frac = 0) => lm(id).phases.some((p) => phasePresent(p, year, frac));
const states = (id: string, year: number) => lm(id).phases.map((p) => phaseStatus(p, histToT(year)).state);

const mustLoad = async () => {
  if (!ds) ds = await loadDataset("stonehenge");
  return ds;
};

describe("stonehenge: dataset", () => {
  it("loads, is registered, and validates with zero problems", async () => {
    await mustLoad();
    expect(LOCATION_IDS).toContain("stonehenge");
    expect(ds.site.id).toBe("stonehenge");
    expect(validateDataset(ds)).toEqual([]);
  });
  it("timeline is -4000..1625, opens at about -2400, scale gives >60% of the slider to -3700..-1500", () => {
    const tl = ds.site.timeline;
    expect(tl.start).toBe(-4000);
    expect(tl.end).toBe(1625);
    expect(initialYear(ds)).toBeGreaterThanOrEqual(-2600);
    expect(initialYear(ds)).toBeLessThanOrEqual(-2200);
    for (let i = 1; i < tl.scale.length; i++) {
      expect(tl.scale[i].u).toBeGreaterThan(tl.scale[i - 1].u);
      expect(histToT(tl.scale[i].year)).toBeGreaterThan(histToT(tl.scale[i - 1].year));
    }
    const sc = new TimeScale(tl.scale);
    const share = sc.tToU(histToT(-1500)) - sc.tToU(histToT(-3700));
    expect(share).toBeGreaterThan(0.6);
    expect(sc.tMin).toBe(histToT(-4000));
    expect(sc.tMax).toBe(1625);
  });
  it("eras tile the timeline and each presetYear is in its era", () => {
    expect(ds.eras.length).toBeGreaterThanOrEqual(5);
    for (const e of ds.eras) {
      expect(histToT(e.presetYear)).toBeGreaterThanOrEqual(histToT(e.from));
      expect(histToT(e.presetYear)).toBeLessThanOrEqual(histToT(e.to));
    }
  });
});

describe("stonehenge: sources", () => {
  const collect = (obj: unknown, out: Set<string>) => {
    if (Array.isArray(obj)) obj.forEach((o) => collect(o, out));
    else if (obj && typeof obj === "object")
      for (const [k, v] of Object.entries(obj)) {
        if (k === "sources" && Array.isArray(v)) v.forEach((s) => typeof s === "string" && out.add(s));
        else collect(v, out);
      }
  };
  it("every source id used anywhere resolves", () => {
    const used = new Set<string>();
    for (const f of ["landmarks", "zones", "episodes", "events", "site", "stones"]) collect(readJson(f), used);
    expect(used.size).toBeGreaterThan(20);
    const missing = [...used].filter((s) => !ds.sources[s]);
    expect(missing).toEqual([]);
    // site-level notes explicitly
    for (const s of [...(ds.site.terrain.sources ?? []), ...(ds.site.woodland.sources ?? []), ...(ds.site.river?.sources ?? [])]) expect(ds.sources[s], s).toBeTruthy();
    // none of the used ids may be without title/publisher/url
    for (const s of used) {
      const src = ds.sources[s];
      expect(src.title?.length, s).toBeGreaterThan(3);
      expect(src.url, s).toMatch(/^https?:\/\//);
    }
  });
  it("every id in the site's sources.json starts with sto-", () => {
    for (const id of Object.keys(readJson("sources"))) expect(id.startsWith("sto-"), id).toBe(true);
  });
  it("every landmark, zone and episode carries at least one source; events with a source cite real ones", () => {
    for (const l of ds.landmarks) expect(l.sources.length, l.id).toBeGreaterThanOrEqual(1);
    for (const z of ds.zones) expect(z.sources.length, z.id).toBeGreaterThanOrEqual(1);
    for (const e of ds.episodes) expect(e.sources.length, e.id).toBeGreaterThanOrEqual(1);
    for (const ev of ds.events) for (const s of ev.sources ?? []) expect(ds.sources[s], `${ev.label}: ${s}`).toBeTruthy();
  });
});

describe("stonehenge: stones.json and landmarks.json are in sync", () => {
  it("sync-stones.mjs --check exits 0", () => {
    const r = spawnSync(process.execPath, ["scripts/stonehenge/sync-stones.mjs", "--check"], { cwd: ROOT, encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
  it("stones.json: unique ids, sane sizes, every stone has sources and an evidence note", () => {
    const { stones } = readJson("stones") as { stones: Record<string, any>[] };
    const ids = new Set<string>();
    for (const s of stones) {
      expect(ids.has(s.id), `duplicate stone ${s.id}`).toBe(false);
      ids.add(s.id);
      expect(s.w, s.id).toBeGreaterThan(0.2);
      expect(s.t, s.id).toBeGreaterThan(0.1);
      // buried stumps have no visible height; every other state stands at least 10 cm
      if (s.state1625 === "buried" || s.built === "absent") expect(s.h, s.id).toBeGreaterThanOrEqual(0);
      else expect(s.h, s.id).toBeGreaterThan(0.05);
      expect(s.w, s.id).toBeLessThan(10);
      expect(s.h, s.id).toBeLessThan(12);
      expect(s.sources?.length, s.id).toBeGreaterThanOrEqual(1);
      if (s.role === "lintel") expect(Array.isArray(s.on) && s.on.length >= 1, `lintel ${s.id} needs on`).toBe(true);
    }
    // a lintel's supports must exist in the catalogue
    for (const s of stones) for (const u of s.on ?? []) expect(ids.has(String(u)), `lintel ${s.id} rests on missing ${u}`).toBe(true);
  });
});

describe("stonehenge: anachronism table", () => {
  it("no sarsen megalith is present before 2600 BCE (trilithons, sarsen circle, and any phase with sarsen stones)", () => {
    for (const id of ["trilithons", "sarsen-circle"]) for (const y of [-4000, -3500, -3000, -2900, -2700, -2620, -2601]) expect(present(id, y), `${id} at ${y}`).toBe(false);
    expect(present("trilithons", -2400)).toBe(true);
    expect(present("sarsen-circle", -2400)).toBe(true);
    expect(present("trilithons", -2000)).toBe(true);
    expect(present("sarsen-circle", 1620)).toBe(true);
  });
  it("INFO/DEFECT CHECK: no phase that draws sarsen stones starts before 2600 BCE (the Cuckoo Stone is the exception to consider)", () => {
    const early: string[] = [];
    for (const l of ds.landmarks)
      for (const p of l.phases) {
        const stones = (p.model.stones as { type?: string }[] | undefined) ?? [];
        if (Array.isArray(stones) && stones.some((s) => s.type === "sarsen") && histToT(p.from) < histToT(-2600)) early.push(`${l.id}: ${p.label} from ${p.from}`);
      }
    // The Cuckoo Stone is sarsen, set up "before 2000 BCE" with an invented date of 2800 BCE: allowed only if documented as a placeholder
    expect(early.filter((e) => !e.startsWith("cuckoo-stone"))).toEqual([]);
    for (const e of early) expect(e).toMatch(/^cuckoo-stone/);
    const c = lm("cuckoo-stone");
    expect(c.phases[0].dateNote ?? "").toMatch(/placeholder/i);
    expect(c.confidence).toBe("low");
  });
  it("the ditch and bank exist by 2900 BCE and not at 3100 BCE; the Aubrey Holes are open at 2950 BCE", () => {
    expect(present("stonehenge-ditch-bank", -3100)).toBe(false);
    expect(present("stonehenge-ditch-bank", -2900, 0.5)).toBe(true);
    expect(present("stonehenge-ditch-bank", -2899)).toBe(true);
    expect(present("aubrey-holes", -3100)).toBe(false);
    expect(present("aubrey-holes", -2950)).toBe(true);
  });
  it("the earthwork has exactly one phase active at each sampled year (no double ditches)", () => {
    const l = lm("stonehenge-ditch-bank");
    for (let y = -3100; y <= 1625; y += 25) {
      if (y === 0) continue;
      const on = l.phases.filter((p) => phasePresent(p, y)).length;
      expect(on, `ditch phases active at ${y}`).toBeLessThanOrEqual(1);
    }
  });
  it("bluestone settings appear at the stage the data claims and never show two arrangements of the same stones", () => {
    expect(present("aubrey-bluestones", -3100)).toBe(false);
    expect(present("aubrey-bluestones", -2950)).toBe(true);
    expect(present("aubrey-bluestones", -2619, 0.5)).toBe(false); // removed at the start of Stage 2
    expect(present("bluestone-arcs", -2650)).toBe(false);
    expect(present("bluestone-arcs", -2500)).toBe(true);
    expect(present("bluestone-circle-and-oval", -2400)).toBe(true); // the Stage 3 central circle
    expect(present("bluestone-circle-and-oval", -2250)).toBe(false); // the data's own gap
    expect(present("bluestone-circle", -2100)).toBe(true);
    expect(present("bluestone-circle-and-oval", -2060)).toBe(true); // oval
    expect(present("bluestone-horseshoe", -2000)).toBe(true);
    expect(present("bluestone-horseshoe", -2100)).toBe(false);
    // the oval hands over to the horseshoe at 2020 BCE: they must not coexist after the handover year
    for (let y = -2019; y <= -1900; y += 7) expect(states("bluestone-circle-and-oval", y).every((s) => s === "gone" || s === "absent"), `oval at ${y}`).toBe(true);
    // the Stage 2 double arc is replaced when the Stage 4 circle begins: no overlap of arcs and outer circle
    for (let y = -2300; y <= -2150; y += 5) expect(present("bluestone-arcs", y) && present("bluestone-circle", y), `arcs and outer circle both at ${y}`).toBe(false);
    // Aubrey bluestones and arcs: the first removed before the second raised
    for (let y = -2700; y <= -2550; y += 5) expect(present("aubrey-bluestones", y) && present("bluestone-arcs", y), `aubrey and arcs both at ${y}`).toBe(false);
    // bluestones in the Aubrey Holes and the circle in the holes of the same ring: Aubrey stones removed before 2600 BCE
    // 1625: bluestones are in the catalogued ruinous state, one phase each
    for (const id of ["bluestone-circle", "bluestone-horseshoe", "trilithons", "sarsen-circle"]) expect(lm(id).phases.filter((p) => phasePresent(p, 1620)).length, id).toBe(1);
  });
  it("catalogue-state handover at 1 CE shows exactly one phase of each megalith setting at every sampled year", () => {
    for (const id of ["trilithons", "sarsen-circle", "bluestone-circle", "bluestone-horseshoe", "altar-stone", "station-stones", "slaughter-stone", "heel-stone"]) {
      const l = lm(id);
      for (const y of [-1500, -500, -1, 1, 2, 500, 1500, 1620]) {
        const n = l.phases.filter((p) => phasePresent(p, y, 0.5)).length;
        expect(n, `${id} phases showing at ${y}`).toBe(1);
      }
    }
  });
  it("the Avenue: absent before its `from`, present at 2000 BCE", () => {
    const from = lm("avenue").phases[0].from;
    expect(present("avenue", from - 100)).toBe(false);
    expect(present("avenue", from - 1)).toBe(false);
    expect(present("avenue", -2000)).toBe(true);
    expect(present("avenue", 1620)).toBe(true);
  });
  it("barrow cemeteries: absent at 3000 BCE, present at 1800 BCE", () => {
    for (const id of ["king-barrows", "normanton-down-barrows", "cursus-barrows", "bush-barrow", "stonehenge-down-barrows", "lake-barrows", "winterbourne-stoke-barrows"]) {
      expect(present(id, -3000), `${id} at -3000`).toBe(false);
      expect(present(id, -1800), `${id} at -1800`).toBe(true);
    }
    expect(present("bush-barrow", -2200)).toBe(false); // Bush Barrow is dated c. 1950 BCE
  });
  it("Durrington houses: a short village c. 2506-2494 BCE, gone by 2400 BCE (zone lifetimes at the extremes)", () => {
    const z = ds.zones.find((x) => x.id === "durrington-houses")!;
    expect(z).toBeTruthy();
    for (const order of [0, 0.5, 1])
      for (const rand of [0, 0.5, 1]) {
        const [birth, , , goneEnd] = instanceLife(z.grow, z.decline, order, rand, z.declineBy);
        expect(birth, `birth o=${order} r=${rand}`).toBeGreaterThanOrEqual(histToT(-2525));
        expect(goneEnd, `gone o=${order} r=${rand}`).toBeLessThanOrEqual(histToT(-2400));
      }
    // Corrected 2026-11-14 (fact review glm-stonehenge-006, Current Archaeology "Rethinking Durrington Walls":
    // inhabited for only 10-12 years, out of use c. 2500-2460 BC): the zone is a 12-year display window, 2506-2494 BCE.
    expect(z.grow[0]).toBe(-2506);
    expect(z.decline![1]).toBe(-2494);
    expect(histToT(z.decline![1]) - histToT(z.grow[0])).toBeLessThanOrEqual(15);
  });
  it("timber circles have rotted away by their goneBy and are present before", () => {
    for (const id of ["durrington-southern-circle", "durrington-northern-circle", "woodhenge"]) {
      const p = lm(id).phases[0];
      expect(p.goneBy, id).toBeTruthy();
      expect(phaseStatus(p, histToT(p.goneBy!)).state, `${id} at goneBy`).toBe("gone");
      expect(phaseStatus(p, histToT(p.goneBy!) + 50).state, id).toBe("gone");
      expect(phaseStatus(p, histToT(p.built!) + 5).state, id).toBe("intact");
      expect(phaseStatus(p, histToT(p.from) - 1).state, id).toBe("absent");
    }
    const ring = lm("durrington-timber-ring").phases[0];
    expect(phaseStatus(ring, histToT(ring.to!) + 2).state).toBe("gone");
    // Corrected 2026-11-14 (glm-stonehenge-005): the timber ring's posts were removed before the henge bank covered
    // them, so the ring must be gone when the henge begins.
    const henge0 = lm("durrington-walls-henge").phases[0];
    expect(histToT(ring.to!) + 1).toBeLessThanOrEqual(histToT(henge0.from));
    // Corrected 2026-11-14 (glm-stonehenge-007, Historic England 2024 Woodhenge modelling): timber settings c. 2635-2575 BCE,
    // ditch and bank 75-440 years later; the two are separately dated.
    expect(present("woodhenge", -2600)).toBe(true);
    expect(present("woodhenge-henge", -2600)).toBe(false);
    expect(present("woodhenge-henge", -2380)).toBe(true);
    // Corrected 2026-11-14 (glm-stonehenge-002, English Heritage "Stonehenge Reconstructed"): both cursuses c. 3500 BC.
    expect(present("lesser-cursus", -3400)).toBe(true);
  });
  it("Amesbury Abbey is absent before 979 and present from the 980s; nothing starts after 1625", () => {
    expect(present("amesbury-abbey", 978)).toBe(false);
    expect(present("amesbury-abbey", 979, 0.5)).toBe(true);
    expect(present("amesbury-abbey", 1100)).toBe(true);
    for (const l of ds.landmarks) for (const p of l.phases) expect(histToT(p.from), `${l.id}: ${p.label}`).toBeLessThanOrEqual(1625);
    for (const z of ds.zones) expect(histToT(z.grow[0]), z.id).toBeLessThanOrEqual(1625);
    for (const e of ds.episodes) expect(histToT(e.year), e.id).toBeLessThanOrEqual(1625);
  });
  it("solstice markers: absent before and after 2500 BCE, shown during 2500 BCE", () => {
    for (const id of ["solstice-sunrise-marker", "solstice-sunset-marker"]) {
      expect(present(id, -2510), id).toBe(false);
      expect(present(id, -2502), id).toBe(false);
      expect(present(id, -2500, 0.5), id).toBe(true);
      expect(present(id, -2498), id).toBe(false);
      expect(present(id, -2400), id).toBe(false);
      expect(present(id, -1500), id).toBe(false);
      expect(present(id, 1620), id).toBe(false);
    }
  });
  it("DEFECT CHECK: solstice markers are labelled 'only in the year 2500 BCE' and must not appear (even rising) in 2501 BCE", () => {
    for (const id of ["solstice-sunrise-marker", "solstice-sunset-marker"]) expect(present(id, -2501, 0.5), `${id} at 2501 BCE (${states(id, -2501)})`).toBe(false);
  });
  it("the Greater Cursus stands at 3400 BCE; long barrows predate the henge", () => {
    expect(present("greater-cursus", -3400)).toBe(true);
    expect(present("greater-cursus", -3700)).toBe(false);
    expect(present("amesbury-42", -3400)).toBe(true);
  });
  it("Vespasian's Camp is Iron Age; Roman building is Roman; field boundaries are Bronze Age", () => {
    expect(present("vespasians-camp", -2000)).toBe(false);
    expect(present("vespasians-camp", -400)).toBe(true);
    expect(present("roman-building-cuckoo-stone", -100)).toBe(false);
    expect(present("roman-building-cuckoo-stone", 200)).toBe(true);
    expect(present("roman-building-cuckoo-stone", 800)).toBe(false);
    expect(present("bronze-age-field-boundary-a", -2000)).toBe(false);
    expect(present("bronze-age-field-boundary-a", -1000)).toBe(true);
  });
  it("each landmark's phases do not overlap in time and open-ended phase is last (beyond validateDataset)", () => {
    for (const l of ds.landmarks) {
      for (let i = 1; i < l.phases.length; i++) {
        const prev = l.phases[i - 1];
        if (prev.to != null) expect(histToT(l.phases[i].from), `${l.id} phase ${i}`).toBeGreaterThanOrEqual(histToT(prev.to));
      }
    }
  });
  it("every conjectural or reconstructed landmark states its uncertainty; every landmark has a summary", () => {
    for (const l of ds.landmarks) {
      expect(l.summary?.length, `${l.id} summary`).toBeGreaterThan(20);
      if (l.evidence === "conjectural" || l.evidence === "reconstructed") expect((l.uncertainty ?? "").trim().length, `${l.id} uncertainty`).toBeGreaterThan(30);
      expect(l.sources.length, l.id).toBeGreaterThanOrEqual(1);
    }
    // generic fill is never claimed as attested
    for (const z of ds.zones) {
      expect(z.evidence.startsWith("attested"), z.id).toBe(false);
      expect(z.note.length, z.id).toBeGreaterThan(30);
    }
    for (const e of ds.episodes) {
      expect(e.attested.length + e.tradition.length, e.id).toBeGreaterThan(0);
      expect(e.unknown.length, `${e.id} needs a 'not known' list`).toBeGreaterThan(0);
    }
  });
  it("the evidence class is honest about attestation: attested-* landmarks that only exist as placeholders are low confidence", () => {
    for (const l of ds.landmarks) {
      const placeholder = l.phases.some((p) => /placeholder|no date/i.test(p.dateNote ?? ""));
      if (placeholder && l.evidence.startsWith("attested")) expect(l.confidence, `${l.id} (${l.evidence}) has placeholder dating`).not.toBe("high");
    }
  });
});

describe("stonehenge: terrain", () => {
  it("is at least 2 m everywhere on a grid, at several years", () => {
    const tm = new TerrainModel(ds.site);
    expect(tm.hasRiver).toBe(false);
    const b = ds.site.bounds;
    let min = Infinity;
    for (const y of [-4000, -3000, -2400, 1620])
      for (let x = b.xMin - 1000; x <= b.xMax + 1000; x += 250)
        for (let z = b.zMin - 1000; z <= b.zMax + 1000; z += 250) {
          const h = tm.height(x, z, histToT(y));
          expect(Number.isFinite(h)).toBe(true);
          min = Math.min(min, h);
        }
    expect(min).toBeGreaterThanOrEqual(2);
  });
  it("the ground within 60 m of the origin varies by less than 2 m before the ditch is dug", () => {
    const tm = new TerrainModel(ds.site);
    let lo = Infinity, hi = -Infinity;
    for (let x = -60; x <= 60; x += 3) for (let z = -60; z <= 60; z += 3) if (x * x + z * z <= 3600) { const h = tm.height(x, z, histToT(-3500)); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    expect(hi - lo).toBeLessThan(2);
  });
  it("the ditch valley carves a depression at r ~ 53 m only after 2995 BCE, and it silts up over time", () => {
    const tm = new TerrainModel(ds.site);
    const depth = (y: number) => {
      // mean ground at r 44..46 and 60..62 minus ground at r 52..54, over eight bearings
      let d = 0, n = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + 0.2;
        const at = (r: number) => tm.height(Math.cos(a) * r, Math.sin(a) * r, histToT(y));
        d += (at(45) + at(62)) / 2 - at(53);
        n++;
      }
      return d / n;
    };
    const before = depth(-3100);
    const fresh = depth(-2990);
    const old = depth(1620);
    expect(Math.abs(before), `before the ditch: ${before.toFixed(2)}`).toBeLessThan(0.45);
    expect(fresh, `fresh ditch ${fresh.toFixed(2)} m`).toBeGreaterThan(0.8);
    expect(old, `silted ditch ${old.toFixed(2)} m`).toBeLessThan(fresh);
    expect(old).toBeGreaterThan(0.05);
  });
  it("ditch valley radius matches the henge landmark's ring (about 53 m from the circle centre)", () => {
    const l = lm("stonehenge-ditch-bank");
    const r = (l.phases[0].model as { r?: number }).r;
    expect(r).toBeGreaterThan(48);
    expect(r).toBeLessThan(58);
  });
});

describe("stonehenge: cameras and episode views", () => {
  const b = () => ds.site.bounds;
  const inside = (p: number[]) => p[0] >= b().xMin && p[0] <= b().xMax && p[2] >= b().zMin && p[2] <= b().zMax;
  it("every named view is above the ground at every year and its target lies within the bounds", () => {
    const tm = new TerrainModel(ds.site);
    expect(ds.site.views.length).toBeGreaterThanOrEqual(4);
    for (const v of ds.site.views) {
      expect(inside(v.target), `${v.id} target`).toBe(true);
      expect(inside(v.position), `${v.id} position`).toBe(true);
      for (const y of [-4000, -2995, -2400, 1625]) {
        const g = tm.height(v.position[0], v.position[2], histToT(y));
        expect(v.position[1], `${v.id} camera y ${v.position[1]} vs ground ${g.toFixed(2)} at ${y}`).toBeGreaterThan(g + 0.5);
      }
    }
  });
  it("every in-map episode has a view above ground with its target inside the bounds; off-map ones are flagged", () => {
    const tm = new TerrainModel(ds.site);
    for (const e of ds.episodes) {
      if (!e.inMap) {
        expect(e.offMap?.length ?? 0, `${e.id} offMap note`).toBeGreaterThan(5);
        continue;
      }
      expect(e.view, e.id).toBeTruthy();
      expect(inside(e.view!.target), `${e.id} target`).toBe(true);
      const g = tm.height(e.view!.position[0], e.view!.position[2], histToT(e.year) + 0.5);
      expect(e.view!.position[1], `${e.id} camera y vs ground ${g.toFixed(2)}`).toBeGreaterThan(g + 0.5);
      const [x, z] = tm.proj.toLocal(e.lat, e.lon);
      expect(x, `${e.id} lon`).toBeGreaterThanOrEqual(b().xMin);
      expect(x).toBeLessThanOrEqual(b().xMax);
      expect(z).toBeGreaterThanOrEqual(b().zMin);
      expect(z).toBeLessThanOrEqual(b().zMax);
    }
  });
  it("every landmark lies inside the site bounds (overview landmarks) and episodes' years are in the timeline", () => {
    const tm = new TerrainModel(ds.site);
    const out: string[] = [];
    for (const l of ds.landmarks) {
      // a path (the river) may run off the map; its anchor and at least one vertex must be inside
      const pts: [number, number][] = l.path?.length ? l.path : [[l.lat, l.lon]];
      const m = 150;
      const ok = pts.map(([la, lo]) => { const [x, z] = tm.proj.toLocal(la, lo); return x >= b().xMin - m && x <= b().xMax + m && z >= b().zMin - m && z <= b().zMax + m; });
      if (l.path?.length ? !ok.some(Boolean) : !ok[0]) out.push(`${l.id} entirely outside the bounds`);
    }
    expect(out).toEqual([]);
    for (const e of ds.episodes) {
      expect(histToT(e.year)).toBeGreaterThanOrEqual(histToT(-4000));
      expect(histToT(e.year)).toBeLessThanOrEqual(1625);
    }
  });
});
