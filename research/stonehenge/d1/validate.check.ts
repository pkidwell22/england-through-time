import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { buildDataset, validateDataset } from "@/lib/data";
import { TerrainModel } from "@/lib/terrain";
import { sampleKeyframes } from "@/lib/lifecycle";
import { histToT } from "@/lib/years";

const D = fileURLToPath(new URL("../../../data/locations/stonehenge/", import.meta.url));
const read = async (f: string) => { try { return JSON.parse(fs.readFileSync(D + f + ".json", "utf8")); } catch { return undefined; } };
const base = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../../../data/sources.json", import.meta.url)), "utf8"));

describe("stonehenge dataset (site, eras, events, episodes, sources)", async () => {
  const ds = await buildDataset("stonehenge", read, base);
  it("validateDataset reports no problems", () => {
    const probs = validateDataset(ds);
    console.log("landmarks:", ds.landmarks.length, "zones:", ds.zones.length, "problems:", probs);
    expect(probs).toEqual([]);
  });
  it("own source ids resolve", () => {
    const own = JSON.parse(fs.readFileSync(D + "sources.json", "utf8"));
    const miss: string[] = [];
    const chk = (where: string, ids?: string[]) => { for (const s of ids ?? []) if (!own[s]) miss.push(`${where}:${s}`); };
    for (const e of ds.events) chk(`event ${e.year}`, e.sources);
    for (const e of ds.episodes) chk(`episode ${e.id}`, e.sources);
    chk("terrain", ds.site.terrain.sources); chk("woodland", ds.site.woodland.sources);
    expect(miss).toEqual([]);
    for (const [k, v] of Object.entries(own) as any) { expect(k.startsWith("sto-")).toBe(true); expect(v.url).toMatch(/^https?:/); expect(v.title).toBeTruthy(); }
  });
  it("cameras are above ground and 12 m from target", () => {
    const tm = new TerrainModel(ds.site);
    const g = (x: number, z: number, t: number) => tm.floor(tm.heightFrom(tm.staticSample(x, z), tm.yearParams(t)));
    const out: string[] = [];
    const chk = (name: string, v: { position: number[]; target: number[] }, t: number) => {
      const gp = g(v.position[0], v.position[2], t);
      const d = Math.hypot(v.position[0] - v.target[0], v.position[1] - v.target[1], v.position[2] - v.target[2]);
      out.push(`${name}: cam ${v.position[1].toFixed(1)} vs analytic ground ${gp.toFixed(1)} (clear ${(v.position[1] - gp).toFixed(1)}), dist ${d.toFixed(0)}`);
      expect(v.position[1] - gp).toBeGreaterThanOrEqual(3);
      expect(d).toBeGreaterThanOrEqual(12);
    };
    for (const v of ds.site.views) chk("view " + v.id, v, histToT(-2400));
    for (const e of ds.episodes) if (e.view) chk("episode " + e.id, e.view, histToT(e.year));
    console.log(out.join("\n"));
  });
  it("eras, scale, valleys", () => {
    expect(ds.site.terrain.valleys!.length).toBeLessThanOrEqual(12);
    const sc = ds.site.timeline.scale;
    for (let i = 1; i < sc.length; i++) expect(sc[i].u).toBeGreaterThan(sc[i - 1].u);
    const d = ds.site.terrain.valleys!.find((v) => v.name === "Stonehenge ditch")!;
    expect(sampleKeyframes(d.fill!, histToT(-3100))).toBe(1);
    expect(sampleKeyframes(d.fill!, histToT(-2995))).toBe(0);
    expect(ds.events.length).toBeGreaterThanOrEqual(20);
    expect(ds.events.length).toBeLessThanOrEqual(35);
    // origin and bounds untouched
    expect(ds.site.bounds).toEqual({ xMin: -2700, xMax: 3700, zMin: -2800, zMax: 2200 });
    expect(ds.site.origin.lat).toBe(51.17888); expect(ds.site.origin.lon).toBe(-1.82619);
  });
});
