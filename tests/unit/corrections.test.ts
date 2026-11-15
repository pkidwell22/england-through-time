// Guards for the 2026-11-14 corrections workstream (docs/CORRECTIONS.md).
import { describe, expect, it } from "vitest";
import { LOCATION_IDS, loadDataset, validateDataset } from "@/lib/data";
import { isExtension, linkExtensions, phaseStatus } from "@/lib/lifecycle";
import type { Phase } from "@/lib/types";
import { histToT } from "@/lib/years";
import { loadNational, validateNational } from "@/national/data";
import polities from "@data/national/polities.json";
import places from "@data/national/places.json";
import placesWales from "@data/national/places-wales.json";
import londonSite from "@data/locations/london/site.json";

const ph = (o: Partial<Phase>): Phase => ({ label: "x", from: 100, to: null, model: { kind: "hall" }, ...o });
const at = (p: Phase, year: number) => phaseStatus(p, histToT(year) + 0.5);

describe("extension phases (continues + later built)", () => {
  const pair = () => {
    const old = ph({ from: 100, built: 110, to: 200, end: "handover" });
    const ext = ph({ from: 200, built: 300, continues: true, to: null });
    linkExtensions([old, ext]);
    return { old, ext };
  };
  it("recognises only continuing phases whose built is later than from", () => {
    expect(isExtension(ph({ continues: true, built: 150 }))).toBe(true);
    expect(isExtension(ph({ continues: true }))).toBe(false);
    expect(isExtension(ph({ continues: true, built: 100 }))).toBe(false);
    expect(isExtension(ph({ built: 150 }))).toBe(false);
  });
  it("keeps the predecessor standing while the extension rises", () => {
    const { old, ext } = pair();
    expect(at(old, 250)).toMatchObject({ state: "intact", height: 1 });
    const s = at(ext, 250);
    expect(s.state).toBe("construction");
    expect(s.height).toBeGreaterThan(0.4);
    expect(s.height).toBeLessThan(0.6);
  });
  it("hands over at the end of the built year, with no gap", () => {
    const { old, ext } = pair();
    expect(at(old, 300).state).toBe("intact");
    expect(at(ext, 300).state).toBe("construction");
    expect(phaseStatus(old, histToT(300) + 1).state).toBe("gone");
    expect(phaseStatus(ext, histToT(300) + 1)).toMatchObject({ state: "intact", height: 1 });
  });
  it("does not hold a predecessor that is replaced rather than handed over", () => {
    const old = ph({ from: 100, built: 110, to: 200, end: "replaced" });
    linkExtensions([old, ph({ from: 200, built: 300, continues: true })]);
    expect(at(old, 250).state).toBe("gone");
  });
  it("leaves the data enumerable fields unchanged", () => {
    const { old } = pair();
    expect(Object.keys(old)).not.toContain("heldUntil");
    expect(JSON.stringify(old)).not.toContain("heldUntil");
  });
});

describe("corrected London data", () => {
  it("Westminster Abbey: Henry III's church stands while the nave is built 1376-1517", async () => {
    const ds = await loadDataset("london");
    const ab = ds.landmarks.find((l) => l.id === "westminster-abbey")!;
    const s = (y: number) => ab.phases.map((p) => at(p, y).state);
    expect(s(1400)).toEqual(["gone", "intact", "construction"]);
    expect(s(1450)).toEqual(["gone", "intact", "construction"]);
    expect(s(1520)).toEqual(["gone", "gone", "intact"]);
  });
  it("Great Stone Gate: traitors' heads only from 1577", async () => {
    const ds = await loadDataset("london");
    const g = ds.landmarks.find((l) => l.id === "bridge-stone-gate")!;
    const withHeads = (y: number) => g.phases.some((p) => p.model.heads != null && at(p, y).height > 0.001);
    expect(withHeads(1570)).toBe(false);
    expect(withHeads(1576)).toBe(false);
    expect(withHeads(1580)).toBe(true);
    expect(g.phases.some((p) => at(p, 1570).height > 0.99)).toBe(true); // the gate itself still stands
  });
  it("no London landmark phase continues without honouring a documented multi-year campaign", async () => {
    const ds = await loadDataset("london");
    for (const id of ["westminster-abbey", "westminster-hall", "greyfriars", "st-pauls"]) {
      const lm = ds.landmarks.find((l) => l.id === id)!;
      expect(lm.phases.some(isExtension), id).toBe(true);
    }
  });
  it("terrain: Tower Hill at most 1 m, Walbrook filled at most halfway by 1600", () => {
    const t = londonSite.terrain as { hills: { name: string; height: number }[]; valleys: { name: string; fill?: { year: number; value: number }[] }[] };
    expect(t.hills.find((h) => h.name === "Tower Hill")?.height ?? 0).toBeLessThanOrEqual(1);
    const wb = t.valleys.find((v) => v.name === "Walbrook")!;
    for (const k of wb.fill!) expect(k.value).toBeLessThanOrEqual(0.5);
  });
  it("every site still validates with zero problems", async () => {
    for (const id of LOCATION_IDS) expect(validateDataset(await loadDataset(id)), id).toEqual([]);
  });
});

describe("corrected national data", () => {
  it("no British people ends at the Roman conquest of 43", () => {
    const peoples = (polities as { kind: string; to: number | null; id: string }[]).filter((p) => p.kind === "people");
    expect(peoples.length).toBeGreaterThan(10);
    for (const p of peoples) expect(p.to, p.id).not.toBe(43);
  });
  it("no house dissolved 1536-40 becomes a bare 'Ruin' in the dissolution year", () => {
    for (const pl of [...places, ...placesWales] as { id: string; phases: { from: number; label: string }[] }[])
      for (const p of pl.phases) if (p.from >= 1536 && p.from <= 1541) expect(/^(roofless )?ruin$/i.test(p.label.trim()), pl.id).toBe(false);
  });
  it("Cuthbert's death is not placed on Lindisfarne", () => {
    const l = (places as { id: string; summary: string }[]).find((p) => p.id === "lindisfarne")!;
    expect(l.summary).not.toMatch(/died here/);
    expect(l.summary).toMatch(/Farne/);
  });
  it("the national dataset validates with zero problems", async () => {
    expect(validateNational(await loadNational())).toEqual([]);
  });
});
