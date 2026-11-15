/**
 * Sample a site's ANALYTIC terrain (no LIDAR) on a regular grid, for comparison with the LIDAR grids.
 *   npx vite-node --config vitest.config.ts scripts/lidar/analytic.ts <site> <cell> <year> <out.json>
 * Writes { site, year, cell, xMin, zMin, width, height, heights[] } (row-major, row 0 = zMin), heights in the site datum.
 */
import { readFile, writeFile } from "node:fs/promises";
import { normaliseSite } from "@/lib/data";
import { TerrainModel } from "@/lib/terrain";
import type { Site } from "@/lib/types";
import { histToT } from "@/lib/years";

const [site, cellS, yearS, out] = process.argv.slice(2);
const raw = JSON.parse(await readFile(new URL(`../../data/locations/${site}/site.json`, import.meta.url), "utf8")) as Site;
const s = normaliseSite(raw);
const m = new TerrainModel({ ...s, lidar: undefined });
const cell = Number(cellS);
const t = histToT(Number(yearS));
const b = s.bounds;
const width = Math.round((b.xMax - b.xMin) / cell) + 1, height = Math.round((b.zMax - b.zMin) / cell) + 1;
const heights: number[] = [];
const yp = m.yearParams(t);
for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) heights.push(Math.round(m.heightFrom(m.staticSample(b.xMin + i * cell, b.zMin + j * cell), yp) * 100) / 100);
const hills = (s.terrain.hills ?? []).map((h) => ({ name: h.name, xz: m.proj.toLocal(h.lat, h.lon), height: h.height, sigma: h.sigma }));
const valleys = (s.terrain.valleys ?? []).map((v) => ({ name: v.name, path: v.path.map(([la, lo]) => m.proj.toLocal(la, lo)), depth: v.depth, sigma: v.sigma }));
await writeFile(out, JSON.stringify({ site, year: Number(yearS), cell, xMin: b.xMin, zMin: b.zMin, width, height, heights, hills, valleys }));
console.log(`wrote ${out}: ${width} x ${height}`);
