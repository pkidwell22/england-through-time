import { describe, expect, it } from "vitest";
import { eraAt, validateDataset } from "@/lib/data";
import { phaseStatus } from "@/lib/lifecycle";
import type { Dataset, Landmark, Phase } from "@/lib/types";
import { histToT } from "@/lib/years";
import site from "@data/locations/london/site.json";
import eras from "@data/locations/london/eras.json";
import events from "@data/locations/london/events.json";
import landmarks from "@data/locations/london/landmarks.json";
import zones from "@data/locations/london/zones.json";
import baseSources from "@data/sources.json";
// the loader merges the optional per-site sources file over data/sources.json (see buildDataset)
import siteSources from "@data/locations/london/sources.json";

const sources = { ...baseSources, ...siteSources };
const ds = { site, eras, events, landmarks, zones, sources } as unknown as Dataset;
const lm = (id: string): Landmark => {
  const l = ds.landmarks.find((x) => x.id === id);
  if (!l) throw new Error(`no landmark ${id}`);
  return l;
};
/** Evaluate at mid-year. */
const mid = (y: number) => histToT(y) + 0.5;
const statuses = (l: Landmark, y: number, filter: (p: Phase) => boolean = () => true) =>
  l.phases.filter(filter).map((p) => ({ p, s: phaseStatus(p, mid(y)) }));
/** Nothing of the landmark is rendered. */
const absent = (id: string, y: number, f?: (p: Phase) => boolean) => statuses(lm(id), y, f).every((x) => x.s.height <= 0.001);
/** A complete, intact phase stands. */
const intact = (id: string, y: number, f?: (p: Phase) => boolean) => statuses(lm(id), y, f).some((x) => x.s.state === "intact");
/** Something is rendered (any state). */
const visible = (id: string, y: number, f?: (p: Phase) => boolean) => !absent(id, y, f);
const describeAt = (id: string, y: number) => statuses(lm(id), y).map((x) => `${x.p.label}: ${x.s.state} h=${x.s.height.toFixed(2)}`).join("; ");

describe("dataset validity", () => {
  it("validateDataset reports no problems", () => {
    expect(validateDataset(ds)).toEqual([]);
  });
  it("every landmark and zone source id resolves, with usable urls", () => {
    const missing: string[] = [];
    for (const l of ds.landmarks) for (const s of l.sources) if (!ds.sources[s]) missing.push(`${l.id}:${s}`);
    for (const z of ds.zones) for (const s of z.sources) if (!ds.sources[s]) missing.push(`${z.id}:${s}`);
    for (const e of ds.events) for (const s of e.sources ?? []) if (!ds.sources[s]) missing.push(`event ${e.year}:${s}`);
    for (const s of [...(ds.site.river?.sources ?? []), ...(ds.site.terrain.sources ?? []), ...(ds.site.woodland.sources ?? [])]) if (!ds.sources[s]) missing.push(`site:${s}`);
    expect(missing).toEqual([]);
    for (const [id, s] of Object.entries(ds.sources)) {
      expect(s.title, id).toBeTruthy();
      expect(s.url, id).toMatch(/^https?:\/\//);
    }
  });
  // Known gap, recorded in docs/RECORD.md: these two were not covered by the research passes.
  const KNOWN_UNSOURCED = ["lambeth-palace", "bermondsey-abbey"];
  it("every landmark cites at least one source unless conjectural or a recorded gap", () => {
    expect(ds.landmarks.filter((l) => l.sources.length === 0 && l.evidence !== "conjectural" && !KNOWN_UNSOURCED.includes(l.id)).map((l) => l.id)).toEqual([]);
  });
  it("every zone cites at least one source unless conjectural", () => {
    expect(ds.zones.filter((z) => z.sources.length === 0 && z.evidence !== "conjectural").map((z) => z.id)).toEqual([]);
  });
  it("nothing has a phase, zone or event outside 4000 BCE - 1625 CE", () => {
    const bad: string[] = [];
    for (const l of ds.landmarks) for (const p of l.phases) {
      for (const y of [p.from, p.built, p.to, p.goneBy]) if (y != null && (y > 1625 || y < -4000)) bad.push(`${l.id} ${p.label} ${y}`);
    }
    for (const z of ds.zones) for (const y of [...z.grow, ...(z.decline ?? [])]) if (y > 1625 || y < -4000) bad.push(`zone ${z.id} ${y}`);
    for (const e of ds.events) if (e.year > 1625 || e.year < -4000) bad.push(`event ${e.year}`);
    expect(bad).toEqual([]);
  });
  it("eras are contiguous and eraAt maps boundaries correctly", () => {
    expect(eraAt(ds.eras, histToT(-1)).id).toBe("prehistoric");
    expect(eraAt(ds.eras, histToT(42) + 0.99).id).toBe("prehistoric");
    expect(eraAt(ds.eras, histToT(43)).id).toBe("roman");
    expect(eraAt(ds.eras, histToT(1066)).id).toBe("medieval");
    expect(eraAt(ds.eras, histToT(1603)).id).toBe("jacobean");
    expect(eraAt(ds.eras, histToT(1625)).id).toBe("jacobean");
  });
  it("landmark coordinates fall inside the modelled area (rough lat/lon box)", () => {
    const bad = ds.landmarks.filter((l) => !l.path && (l.lat < 51.48 || l.lat > 51.54 || l.lon < -0.16 || l.lon > -0.05)).map((l) => l.id);
    expect(bad).toEqual([]);
  });
});

describe("anachronism table", () => {
  const cases: [string, () => boolean, () => string][] = [
    ["Second forum absent at 40 CE", () => absent("forum", 40) && absent("forum-first", 40), () => describeAt("forum", 40)],
    ["City wall absent at 150", () => absent("city-wall", 150), () => describeAt("city-wall", 150)],
    ["City wall present at 300", () => intact("city-wall", 300), () => describeAt("city-wall", 300)],
    ["City wall present at 1600", () => intact("city-wall", 1600), () => describeAt("city-wall", 1600)],
    ["St Paul's present at 700", () => intact("st-pauls", 700), () => describeAt("st-pauls", 700)],
    ["St Paul's absent at 600", () => absent("st-pauls", 600), () => describeAt("st-pauls", 600)],
    ["St Paul's spire present at 1500", () => intact("st-pauls", 1500, (p) => "spire" in p.model), () => describeAt("st-pauls", 1500)],
    ["St Paul's spire not present at 1562", () => absent("st-pauls", 1562, (p) => "spire" in p.model), () => describeAt("st-pauls", 1562)],
    ["St Paul's spire not present at 1600/1625", () => absent("st-pauls", 1600, (p) => "spire" in p.model) && absent("st-pauls", 1625, (p) => "spire" in p.model), () => describeAt("st-pauls", 1600)],
    ["St Paul's (spireless) still standing 1562", () => intact("st-pauls", 1562, (p) => !("spire" in p.model)), () => describeAt("st-pauls", 1562)],
    ["White Tower absent at 1066", () => absent("white-tower", 1066), () => describeAt("white-tower", 1066)],
    ["White Tower present at 1101", () => intact("white-tower", 1101), () => describeAt("white-tower", 1101)],
    ["Old London Bridge (stone) absent at 1150", () => absent("old-london-bridge", 1150), () => describeAt("old-london-bridge", 1150)],
    ["Old London Bridge complete at 1210", () => intact("old-london-bridge", 1210), () => describeAt("old-london-bridge", 1210)],
    ["Old London Bridge still intact 1625", () => intact("old-london-bridge", 1625), () => describeAt("old-london-bridge", 1625)],
    ["Nonsuch House absent at 1576", () => absent("nonsuch-house", 1576), () => describeAt("nonsuch-house", 1576)],
    ["Nonsuch House present at 1580", () => intact("nonsuch-house", 1580), () => describeAt("nonsuch-house", 1580)],
    ["Drawbridge Gate gone at 1578 (demolished 1577; Nonsuch House rises on its site)", () => absent("bridge-drawbridge-gate", 1578), () => describeAt("bridge-drawbridge-gate", 1578)],
    ["Drawbridge Gate gone at 1580 (Nonsuch House finished 1579 on same site)", () => absent("bridge-drawbridge-gate", 1580), () => describeAt("bridge-drawbridge-gate", 1580)],
    ["Drawbridge Gate gone at 1584", () => absent("bridge-drawbridge-gate", 1584), () => describeAt("bridge-drawbridge-gate", 1584)],
    ["Globe absent at 1598", () => absent("globe", 1598), () => describeAt("globe", 1598)],
    ["Globe present at 1600", () => intact("globe", 1600), () => describeAt("globe", 1600)],
    ["Globe burned/absent (not intact) mid-1613", () => !intact("globe", 1613), () => describeAt("globe", 1613)],
    ["Globe present at 1615", () => intact("globe", 1615), () => describeAt("globe", 1615)],
    ["First Globe's ruin not co-rendered with the second Globe at 1615", () => absent("globe", 1615, (p) => p.to === 1613), () => describeAt("globe", 1615)],
    ["Rose present at 1590", () => intact("rose", 1590), () => describeAt("rose", 1590)],
    ["Rose absent at 1586", () => absent("rose", 1586), () => describeAt("rose", 1586)],
    ["Rose gone by 1606", () => absent("rose", 1606), () => describeAt("rose", 1606)],
    ["Rose gone by 1612", () => absent("rose", 1612), () => describeAt("rose", 1612)],
    ["Royal Exchange absent at 1565", () => absent("royal-exchange", 1565), () => describeAt("royal-exchange", 1565)],
    ["Royal Exchange present at 1572", () => intact("royal-exchange", 1572), () => describeAt("royal-exchange", 1572)],
    ["Banqueting House (Jones) absent at 1618", () => absent("banqueting-house", 1618, (p) => /jones/i.test(p.label)), () => describeAt("banqueting-house", 1618)],
    ["Banqueting House (Jones) present at 1623", () => intact("banqueting-house", 1623, (p) => /jones/i.test(p.label)), () => describeAt("banqueting-house", 1623)],
    ["Old banqueting house ruin not co-rendered with Jones's building at 1623", () => absent("banqueting-house", 1623, (p) => !/jones/i.test(p.label)), () => describeAt("banqueting-house", 1623)],
    ["Savoy Palace intact at 1380", () => intact("savoy", 1380), () => describeAt("savoy", 1380)],
    ["Savoy Palace not intact at 1382", () => !intact("savoy", 1382), () => describeAt("savoy", 1382)],
    ["Blackfriars friary church phase over by 1540", () => absent("blackfriars", 1540, (p) => p.model.kind === "friary"), () => describeAt("blackfriars", 1540)],
    ["Roman bridge absent at 43 CE", () => absent("roman-bridge", 43), () => describeAt("roman-bridge", 43)],
    ["Roman bridge absent at 1 BCE and 4000 BCE", () => absent("roman-bridge", -1) && absent("roman-bridge", -4000), () => describeAt("roman-bridge", -1)],
    ["Amphitheatre gone by 600", () => absent("amphitheatre", 600), () => describeAt("amphitheatre", 600)],
    ["Amphitheatre present at 150", () => intact("amphitheatre", 150), () => describeAt("amphitheatre", 150)],
    ["Timber bridge and stone bridge do not both stand complete (1205)", () => !(intact("saxon-bridge", 1205) && intact("old-london-bridge", 1205)), () => describeAt("saxon-bridge", 1205)],
    ["Westminster Hall absent 1090, present 1100", () => absent("westminster-hall", 1090) && intact("westminster-hall", 1100), () => describeAt("westminster-hall", 1100)],
    ["Swan absent 1593, present 1596", () => absent("swan", 1593) && intact("swan", 1596), () => describeAt("swan", 1596)],
  ];
  it.each(cases)("%s", (_name, check, detail) => {
    expect(check(), detail()).toBe(true);
  });

  it("nothing has a phase starting after 1625", () => {
    const late = ds.landmarks.flatMap((l) => l.phases.filter((p) => p.from > 1625 || (p.built ?? 0) > 1625).map((p) => `${l.id}: ${p.label} ${p.from}`));
    expect(late).toEqual([]);
  });
  it("Westminster Abbey has no west towers (Hawksmoor's are 1722-45)", () => {
    for (const p of lm("westminster-abbey").phases) {
      const m = p.model as Record<string, unknown>;
      const keys = JSON.stringify(m).toLowerCase();
      expect(keys.includes("westtower"), p.label).toBe(false);
      expect(m.endTowers, p.label).toBeUndefined();
      const tower = m.tower as { at?: string } | undefined;
      if (tower) expect(tower.at, p.label).not.toBe("west");
    }
  });
  it("only pre-1561 St Paul's phases carry a spire", () => {
    for (const p of lm("st-pauls").phases) if ("spire" in p.model) expect(p.to != null && p.to <= 1561, p.label).toBe(true);
  });
  it("no two phases of one landmark are both fully intact at the same time", () => {
    const clashes: string[] = [];
    for (const l of ds.landmarks) for (let y = -4000; y <= 1625; y++) {
      if (y === 0) continue;
      const n = l.phases.filter((p) => phaseStatus(p, mid(y)).state === "intact").length;
      if (n > 1) { clashes.push(`${l.id}@${y}`); break; }
    }
    expect(clashes).toEqual([]);
  });
});
