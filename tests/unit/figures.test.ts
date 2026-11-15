import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { setForYear, type FigureManifest } from "@/scene/pop/figureAssets";

/** Crowd figures built by scripts/build-figures.mjs into public/assets/figures (see docs/FIGURES.md). */

const OUT = path.resolve(__dirname, "../../public/assets/figures");
const present = fs.existsSync(path.join(OUT, "figures.json"));
const M = present ? (JSON.parse(fs.readFileSync(path.join(OUT, "figures.json"), "utf8")) as FigureManifest) : null;

/** Read the JSON chunk of a GLB. */
function glbJson(file: string): { meshes: { name: string; primitives: { attributes: Record<string, number> }[] }[]; extensionsRequired?: string[]; asset: { copyright?: string } } {
  const b = fs.readFileSync(file);
  expect(b.readUInt32LE(0)).toBe(0x46546c67);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString("utf8"));
}

describe.skipIf(!present)("figure assets", () => {
  it("cover every period and both staged battles", () => {
    expect(Object.keys(M!.sets).sort()).toEqual(["barnet1471", "brentford1016", "medieval", "prehistoric", "roman", "saxon", "tudor"]);
    expect(setForYear(M!, -2400)).toBe("prehistoric");
    expect(setForYear(M!, 150)).toBe("roman");
    expect(setForYear(M!, 900)).toBe("saxon");
    expect(setForYear(M!, 1300)).toBe("medieval");
    expect(setForYear(M!, 1616)).toBe("tudor");
    expect(setForYear(M!, 1066)).toBe("medieval");
  });

  it("have 8-14 bodies, men, women, children and elders of plausible stature", () => {
    const B = M!.bodies;
    expect(B.length).toBeGreaterThanOrEqual(8);
    expect(B.length).toBeLessThanOrEqual(14);
    for (const t of [0, 1, 2, 3, 4, 5]) expect(B.some((b) => b.type === t), `type ${t}`).toBe(true);
    for (const b of B) {
      if (b.child) expect(b.height).toBeLessThan(1.45);
      else if (b.sex === "m") expect(b.height).toBeGreaterThan(1.6), expect(b.height).toBeLessThan(1.86);
      else expect(b.height).toBeGreaterThan(1.45), expect(b.height).toBeLessThan(1.7);
      expect(b.S1).toBeLessThan(b.S2);
      expect(b.Sf).toBeGreaterThan(b.S2);
    }
  });

  it("keep the triangle budgets per level of detail (worst outfit)", () => {
    for (const [name, s] of Object.entries(M!.sets))
      for (const [id, b] of Object.entries(s.bodies)) {
        const worst = b.lods.map((l) => Math.max(...l.perOutfit));
        expect(worst[0], `${name} ${id} lod0`).toBeLessThanOrEqual(5800);
        expect(worst[0], `${name} ${id} lod0`).toBeGreaterThanOrEqual(2500);
        expect(worst[1], `${name} ${id} lod1`).toBeLessThanOrEqual(1500);
        expect(worst[1], `${name} ${id} lod1`).toBeGreaterThanOrEqual(700);
        expect(worst[2], `${name} ${id} lod2`).toBeLessThan(300);
        expect(worst[3], `${name} ${id} lod3`).toBeLessThan(130);
        expect(b.outfits.length).toBeLessThanOrEqual(16);
        expect(b.outfits.every((o) => o.w[0] >= 0 && o.w[1] >= 0)).toBe(true);
        expect(b.outfits.reduce((a, o) => a + o.w[0] + o.w[1], 0)).toBeGreaterThan(0);
      }
  });

  it("are small and complete on disk", () => {
    let total = 0;
    for (const f of fs.readdirSync(OUT)) total += fs.statSync(path.join(OUT, f)).size;
    expect(total / 1e6).toBeLessThan(15.5);
    const a = M!.anim;
    expect(fs.statSync(path.join(OUT, a.file)).size).toBe(a.width * a.height * a.depth * 4 * 2);
    for (const t of Object.values(M!.textures)) expect(fs.existsSync(path.join(OUT, t))).toBe(true);
  });

  it("GLBs hold every body's four levels with the crowd attributes", () => {
    for (const [name, s] of Object.entries(M!.sets)) {
      const j = glbJson(path.join(OUT, s.file));
      expect(j.extensionsRequired).toContain("KHR_mesh_quantization");
      expect(j.asset.copyright ?? "").toMatch(/CC0/);
      const names = new Set(j.meshes.map((m) => m.name));
      for (const [id, b] of Object.entries(s.bodies)) {
        expect(b.lods.length).toBe(4);
        for (const l of b.lods) expect(names.has(l.mesh), `${name} ${l.mesh}`).toBe(true);
      }
      for (const m of j.meshes) for (const k of ["POSITION", "NORMAL", "TEXCOORD_0", "_BONES", "_WEIGHTS", "_FIG"]) expect(m.primitives[0].attributes[k], `${m.name} ${k}`).toBeDefined();
    }
  });

  it("soldier sets exist only for adult men", () => {
    for (const s of ["barnet1471", "brentford1016"]) {
      const ids = Object.keys(M!.sets[s].bodies);
      expect(ids.length).toBeGreaterThan(2);
      for (const id of ids) {
        const b = M!.bodies.find((x) => x.id === id)!;
        expect(b.sex).toBe("m");
        expect(b.child).toBe(false);
      }
    }
  });
});
