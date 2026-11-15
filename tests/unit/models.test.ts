import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import fs from "node:fs";
import path from "node:path";
import manifest from "@data/models.json";
import { listModels, loadModel, lifeMaterials, ModelInstances, modelsForYear, tryLoadModel } from "@/scene/assets/models";

/** Scanned model library (data/models.json -> public/assets/models). File checks run only once fetched. */

interface Budget { lod0: number; lod1: number; lod2?: number; texture?: number }
interface Asset { id: string; name: string; category: string; variants?: number; plausibility: string; period: { from: number; to: number }; confidence: string; budget?: Partial<Budget> }
const M = manifest as unknown as { licence: string; sourceHosts: string[]; budgets: Record<string, Budget>; assets: Asset[]; excluded: { id: string; reason: string }[] };

const OUT = path.resolve(__dirname, "../../public/assets/models");
const fetched = fs.existsSync(path.join(OUT, "index.json"));

describe("models manifest", () => {
  it("has unique ids and known categories with budgets", () => {
    const ids = M.assets.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of M.assets) {
      expect(M.budgets[a.category], `${a.id} category ${a.category}`).toBeDefined();
      expect(a.name.length).toBeGreaterThan(2);
    }
  });

  it("records plausibility, period and confidence for every asset", () => {
    for (const a of M.assets) {
      expect(a.plausibility.length, a.id).toBeGreaterThan(30);
      expect(a.period.from).toBeLessThanOrEqual(a.period.to);
      expect(a.period.from).toBeGreaterThanOrEqual(-4000);
      expect(a.period.to).toBeLessThanOrEqual(1625);
      expect(a.period.from).not.toBe(0);
      expect(["high", "medium", "low"]).toContain(a.confidence);
    }
  });

  it("is CC0 from Poly Haven only, and excluded assets are not used", () => {
    expect(M.licence).toMatch(/CC0/);
    expect(M.sourceHosts.sort()).toEqual(["api.polyhaven.com", "dl.polyhaven.org"]);
    const used = new Set(M.assets.map((a) => a.id));
    for (const e of M.excluded) {
      expect(used.has(e.id), e.id).toBe(false);
      expect(e.reason.length).toBeGreaterThan(10);
    }
  });

  it("tree budgets match the brief (LOD0 <= 12k, LOD1 <= 2.5k, LOD2 <= 8), plants <= 800, props <= 1.5k", () => {
    expect(M.budgets.tree).toMatchObject({ lod0: 12000, lod1: 2500, lod2: 8 });
    for (const c of ["shrub", "groundcover", "grass"]) expect(M.budgets[c].lod0).toBeLessThanOrEqual(800);
    expect(M.budgets.prop.lod0).toBeLessThanOrEqual(1500);
  });

  it("runtime catalogue mirrors the manifest and filters by year", () => {
    expect(listModels().length).toBe(M.assets.length);
    expect(listModels("tree").every((m) => m.category === "tree")).toBe(true);
    const at1066 = modelsForYear(1066, "prop").map((m) => m.id);
    expect(at1066).toContain("kite_shield");
    expect(modelsForYear(1610, "prop").map((m) => m.id)).not.toContain("kite_shield");
    expect(modelsForYear(-2000, "vessel")).toEqual([]);
  });
});

describe.skipIf(!fetched)("optimised model files", () => {
  const index = fetched ? JSON.parse(fs.readFileSync(path.join(OUT, "index.json"), "utf8")) : { assets: [] };
  const sources = fs.existsSync(path.join(OUT, "sources.json")) ? JSON.parse(fs.readFileSync(path.join(OUT, "sources.json"), "utf8")) : {};

  it("every manifest asset has been optimised and baked", () => {
    const have = new Map<string, { baked: boolean }>(index.assets.map((a: { id: string; baked: boolean }) => [a.id, a]));
    for (const a of M.assets) {
      expect(have.has(a.id), `${a.id} missing from index.json`).toBe(true);
      expect(have.get(a.id)!.baked, `${a.id} not baked`).toBe(true);
    }
  });

  it("every source file is recorded once with a Poly Haven URL, CC0 licence and size", () => {
    for (const a of M.assets) {
      const s = sources[a.id];
      expect(s, `${a.id} not in sources.json`).toBeDefined();
      expect(s.licence).toBe("CC0 1.0");
      const paths = s.files.map((f: { path: string }) => f.path);
      expect(new Set(paths).size).toBe(paths.length);
      for (const f of s.files) {
        expect(new URL(f.url).hostname).toMatch(/^(dl|api)\.polyhaven\.org$|^api\.polyhaven\.com$/);
        expect(f.size).toBeGreaterThan(0);
        const p = path.join(OUT, f.path);
        if (fs.existsSync(p)) expect(fs.statSync(p).size, f.path).toBe(f.size);
      }
    }
  });

  for (const a of M.assets) {
    it(`${a.id}: files exist, geometry ranges are valid, LODs respect the budget`, () => {
      const dir = path.join(OUT, a.id);
      const m = JSON.parse(fs.readFileSync(path.join(dir, "model.json"), "utf8"));
      const binSize = fs.statSync(path.join(dir, m.bin)).size;
      const budget = { ...M.budgets[a.category], ...(a.budget ?? {}) } as Budget;
      const limits = [budget.lod0, budget.lod1, budget.lod2];
      expect(m.variants.length).toBe(Math.max(1, Math.min(a.variants ?? 1, m.variants.length)));
      for (const v of m.variants) {
        expect(v.size.height).toBeGreaterThan(0);
        expect(v.lods.length).toBeGreaterThanOrEqual(2);
        v.lods.forEach((l: { triangles: number; maxDistance: number; parts: { triangles: number; vertices: number; position: number; normal: number; uv: number; index: number; indexType: string; material: Record<string, string> }[] }, i: number) => {
          expect(l.triangles).toBeGreaterThan(0);
          if (limits[i] !== undefined) expect(l.triangles, `${a.id} lod${i}`).toBeLessThanOrEqual(limits[i]!);
          expect(l.parts.reduce((s, p) => s + p.triangles, 0)).toBe(l.triangles);
          if (i > 0) expect(l.maxDistance).toBeGreaterThan(v.lods[i - 1].maxDistance);
          for (const p of l.parts) {
            expect(p.position % 4).toBe(0);
            expect(p.uv % 4).toBe(0);
            expect(p.position + p.vertices * 12).toBeLessThanOrEqual(binSize);
            expect(p.normal + p.vertices * 3).toBeLessThanOrEqual(binSize);
            expect(p.uv + p.vertices * 8).toBeLessThanOrEqual(binSize);
            expect(p.index + p.triangles * 3 * (p.indexType === "u32" ? 4 : 2)).toBeLessThanOrEqual(binSize);
            for (const k of ["map", "normalMap", "armMap"]) {
              if (p.material[k]) expect(fs.existsSync(path.join(dir, p.material[k])), `${a.id}/${p.material[k]}`).toBe(true);
            }
          }
        });
      }
    });
  }
});

describe.skipIf(!fetched)("runtime loader (fetch + textures stubbed from disk)", () => {
  const serve = (url: string) => {
    const p = path.join(OUT, url.replace(/^\/assets\/models\//, ""));
    if (!fs.existsSync(p)) return new Response("missing", { status: 404 });
    const b = fs.readFileSync(p);
    return new Response(b.buffer.slice(b.byteOffset, b.byteOffset + b.length) as ArrayBuffer, { status: 200 });
  };

  it("loads a tree with LODs, life materials and LOD bucketing; rejects cleanly when missing", async () => {
    vi.stubGlobal("fetch", async (u: string) => serve(String(u)));
    const spy = vi.spyOn(THREE.TextureLoader.prototype, "loadAsync").mockImplementation(async () => new THREE.Texture());
    try {
      const tree = await loadModel("island_tree_02");
      expect(tree.lods.length).toBe(3);
      expect(tree.lods[0].triangles).toBeLessThanOrEqual(12000);
      expect(tree.lods[2].parts[0].kind).toBe("impostor");
      expect(tree.height).toBeGreaterThan(2);
      const cut = tree.lods[0].parts.find((p) => p.kind === "cutout")!;
      expect(cut.material.alphaTest).toBeGreaterThan(0);
      expect(cut.depthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial);
      expect(cut.geometry.index!.count / 3).toBe(cut.triangles);

      const life = lifeMaterials(tree);
      expect(life.lods[0].parts[0].material).not.toBe(tree.lods[0].parts[0].material);
      expect(typeof life.lods[0].parts[0].material.onBeforeCompile).toBe("function");

      const inst = new ModelInstances(tree, 10);
      inst.place(0, 0, 10);
      inst.place(0, 0, tree.lods[0].maxDistance + 5);
      inst.place(0, 0, tree.lods[1].maxDistance + 5);
      inst.place(0, 0, tree.lods[2].maxDistance + 5);
      inst.update(new THREE.Vector3(0, 0, 0));
      expect(inst.lodCounts()).toEqual([1, 1, 1]);
      const mesh = inst.object.children[0] as THREE.InstancedMesh;
      expect(mesh.geometry.getAttribute("aLife")).toBeDefined();
      expect(mesh.geometry.getAttribute("aFx")).toBeDefined();

      await expect(loadModel("no_such_model")).rejects.toThrow(/unavailable/);
      expect(await tryLoadModel("no_such_model")).toBeNull();
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
