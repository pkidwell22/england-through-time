import * as THREE from "three";
import type { Dataset } from "@/lib/types";
import { hash2, noise2 } from "@/lib/geo";
import { histToT } from "@/lib/years";
import type { StaticSample, TerrainModel } from "@/lib/terrain";
import type { FabricLayer } from "./fabric";
import { buildProceduralSource } from "./veg/procedural";
import { loadScannedSource } from "./veg/scanned";
import { Understorey, type Anchor } from "./veg/understorey";
import type { Species, TreeSource } from "./veg/types";
import { vegUniforms } from "./veg/impostor";
import { LEGACY_PLACEMENT } from "./placementMode";

/**
 * Trees and other vegetation. The engine imports `buildTrees` from here. The returned group sets
 * userData.count (number of tree instances) and userData.update = (t) => void.
 *
 * HONESTY (see docs/VEGETATION.md): the tree models are GENERIC stand-ins, not identified British species.
 *  - First build (and the fallback when the model files are missing, and always on Low quality): procedural card trees
 *    (veg/procedural.ts), loosely oak-, lime/elm-, alder-, willow- and hazel/thorn-like. Illustrative shapes.
 *  - After a short async load (Medium and High): CC0 Poly Haven scans (veg/scanned.ts) scaled from 2.6-5 m up to
 *    mature sizes. island_tree_01 and island_tree_02 (unnamed coastal broadleaves) = canopy "oak" and, with island_tree_02,
 *    "willow"; tree_small_02 (Burkea africana, an African savanna tree) = slender "lime/elm" and "alder"; island_tree_03
 *    (low windswept multi-trunk) = scrub, thicket and hedgerow. The names are roles, not identifications. Pines are not used.
 *  - Woodland understorey (veg/understorey.ts): scanned ferns, nettles, lesser celandine and deadwood, scattered
 *    near the camera under dated trees. Illustrative: plant species and positions are not evidenced.
 *  - Positions, per-tree dates, the filler (sub-canopy) trees that close the canopy, and all sizes are illustrative;
 *    only the woodland-cover trend in the site data is sourced, and that is itself marked illustrative.
 *
 * Placement and dated behaviour are those of the earlier trees (woodland cover keyframes against a per-spot threshold,
 * clearance by settlement zones, sparse hedgerow trees from the later prehistoric clearances). Added: "filler" trees
 * placed around each woodland tree that share its life window, so a closed wood has a closed crown and vanishes with
 * exactly the trees that make it.
 *
 * Each tree is assigned to a mesh-set variant for good and sits in a distance level (full / reduced / impostor) that is
 * refreshed when the camera has moved. Within every (variant, level) bucket trees stay sorted by end time, so update(t)
 * is a binary search per bucket.
 */

type Role = "main" | "filler";

interface Item {
  x: number; y: number; z: number;
  /** target height of the tree in metres */
  h: number;
  life: [number, number, number, number];
  tone: number;
  wet: boolean;
  hedge: boolean;
  sp: Species;
  /** Anchors woodland understorey (woodland and filler trees). */
  anc?: boolean;
  /** The terrain sample at the trunk (kept from placement). */
  st?: StaticSample;
}

/**
 * Pick the role by ground wetness, context and period (t = when the tree first stands, timeline value).
 * The mix follows the broad pollen picture for lowland southern England, and is illustrative, not evidenced per spot:
 * lime-rich mixed woodland with oak, hazel, elm and some ash before the clearances (elm much reduced after the elm
 * decline, c. 3800 BCE); oak, ash and hazel dominant in the managed woods of the later periods, lime rarer; hedgerow
 * trees mostly oak, ash and elm over hazel and thorn; alder and willow on wet ground. Pine and birch are not used:
 * neither fits this lowland ground in these periods (and no CC0 scan of either exists to stand in).
 */
function speciesFor(x: number, z: number, wet: boolean, hedge: boolean, role: Role, t: number): Species {
  const r = hash2(x * 1.7 + 4, z * 1.3 - 9);
  if (wet) return r < 0.55 ? "alder" : "willow";
  const early = t < histToT(-1200);
  const elm = t < histToT(-3800) ? 0.1 : 0.04;
  if (hedge) return r < 0.4 ? (r < 0.22 ? "hazel" : "scrub") : r < 0.7 ? "oak" : r < 0.85 ? "ash" : "elm";
  if (role === "filler") return r < 0.32 ? "hazel" : early ? (r < 0.62 ? "lime" : r < 0.85 ? "oak" : "ash") : r < 0.6 ? "oak" : r < 0.85 ? "ash" : "lime";
  if (early) return r < 0.1 ? "hazel" : r < 0.44 ? "lime" : r < 0.78 ? "oak" : r < 0.78 + elm ? "elm" : "ash";
  return r < 0.12 ? "hazel" : r < 0.55 ? "oak" : r < 0.78 ? "ash" : r < 0.88 ? "elm" : "lime";
}

/** Height range in metres per role and context: canopy trees 14-28, understorey/hedgerow 5-12, hazel and scrub 3-8. */
function heightFor(sp: Species, hedge: boolean, role: Role, u: number): number {
  if (sp === "scrub") return (hedge ? 4 : role === "filler" ? 3.5 : 3) + u * 3;
  if (sp === "hazel") return (hedge ? 4.5 : 4) + u * 3.5;
  if (sp === "alder") return 10 + u * 5;
  if (sp === "willow") return 8 + u * 5;
  if (hedge) return (sp === "elm" ? 10 : sp === "oak" ? 8 : 7) + u * 5;
  if (role === "filler") return 10 + u * 5;
  if (sp === "oak") return 16 + u * 8;
  if (sp === "ash") return 16 + u * 8;
  if (sp === "elm") return 20 + u * 8;
  return 19 + u * 7;
}

/**
 * Per-role tint multipliers for the scans (they are yellowish) towards season-neutral British summer greens: oak a
 * deep olive, lime fresher and yellower, ash lighter and greyer, elm dark, alder dark and cool, willow grey-green.
 */
const SCAN_TINT: Record<Species, [number, number, number]> = {
  oak: [0.8, 0.88, 0.5],
  lime: [0.88, 0.97, 0.52],
  elm: [0.72, 0.84, 0.5],
  ash: [0.88, 0.95, 0.62],
  alder: [0.62, 0.78, 0.54],
  willow: [0.92, 0.97, 0.74],
  hazel: [0.84, 0.92, 0.52],
  scrub: [0.82, 0.88, 0.5],
};
const PROC_TINT: Record<Species, [number, number, number]> = {
  oak: [1, 1, 1], lime: [1, 1, 1], elm: [0.95, 0.97, 0.95], ash: [1.04, 1.03, 1.02], alder: [1, 1, 1], willow: [1, 1, 1], hazel: [1, 1, 1], scrub: [1, 1, 1],
};

export function buildTrees(ds: Dataset, terrain: TerrainModel, fabric: FabricLayer, density: number): THREE.Group {
  const root = new THREE.Group();
  root.name = "trees";
  const quality: 0 | 1 | 2 = density >= 0.95 ? 2 : density >= 0.6 ? 1 : 0;
  const b = ds.site.bounds;
  const kf = ds.site.woodland.cover.map((k) => ({ t: histToT(k.year), v: k.value }));
  const tStart = histToT(ds.site.timeline.start);
  const yp0 = terrain.yearParams(tStart);
  const tEnd = histToT(ds.site.timeline.end) + 1;
  const spacing = 21 / Math.sqrt(density);
  const fillers = quality === 2 ? 2 : quality === 1 ? 1 : 0;
  const items: Item[] = [];
  const anchors: Anchor[] = [];

  /**
   * Time at which a spot is cleared by settlement (Infinity if never). A spot counts as the settlement's if it lies
   * inside the zone or within EDGE metres of it: the trodden ground the terrain paints round a zone reaches a grid cell
   * (up to 12 m) beyond its outline, and a crown standing just beyond that still overhangs it. Clearance follows the
   * zone's start within 25 years, but by the end of a short-lived settlement's growth (Durrington Walls' village grew
   * over six years and stood about a dozen), so its trees are gone while it stands.
   */
  const EDGE = 20;
  const ring = Array.from({ length: 16 }, (_, k) => {
    const r = k < 8 ? EDGE : EDGE / 2, a = (k * Math.PI) / 4 + (k < 8 ? 0 : Math.PI / 8);
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
  const clearedAt = (jx: number, jz: number): number => {
    let cleared = Infinity;
    for (const zg of fabric.zoneGeoms) {
      if (zg.zone.style === "roundhouse" || zg.zone.style === "scrub") continue;
      if (!(zg.t0 < cleared && jx > zg.bbox[0] - EDGE && jx < zg.bbox[2] + EDGE && jz > zg.bbox[1] - EDGE && jz < zg.bbox[3] + EDGE)) continue;
      if (zg.contains(jx, jz) || ring.some(([dx, dz]) => zg.contains(jx + dx, jz + dz))) {
        // felled (including the 3-year fade) by the time the settlement has grown, and at most 25 years after it starts
        const lag = Math.min(25, Math.max(0.5, histToT(zg.grow[1]) - zg.t0 - 3));
        cleared = zg.t0 + hash2(jx, jz + 5) * lag;
      }
    }
    return cleared;
  };

  for (let z = b.zMin + 10; z < b.zMax - 10; z += spacing)
    for (let x = b.xMin + 10; x < b.xMax - 10; x += spacing) {
      const jx = x + (hash2(x, z) - 0.5) * spacing * 0.95;
      const jz = z + (hash2(z + 99, x - 7) - 0.5) * spacing * 0.95;
      const st = terrain.staticSample(jx, jz);
      const y = terrain.heightFrom(st, yp0);
      if (!terrain.dry(y, 0.75)) continue;
      const wet = st.dRiver < 0 && y < 1.7;
      if (wet && hash2(jx * 3, jz * 3) > 0.45) continue;
      const tau = terrain.woodlandThreshold(jx, jz);
      const cleared = clearedAt(jx, jz);
      // intervals during which cover(t) > tau
      let alive = kf[0].v > tau;
      let start = -1e7;
      const push = (s: number, e: number) => {
        const end = Math.min(e, cleared);
        if (end <= s) return;
        const sp = speciesFor(jx, jz, wet, false, "main", Math.max(s, tStart));
        const tone = hash2(jx - 11, jz + 2);
        const life: [number, number, number, number] = [s - 25, s, end, end + 3];
        items.push({ x: jx, y, z: jz, h: heightFor(sp, false, "main", hash2(jx + 3, jz + 8)), life, tone, wet, hedge: false, sp, anc: true, st });
        anchors.push({ x: jx, y, z: jz, life, wet });
        if (wet) return;
        // Filler trees close the canopy: they stand around this tree, share its life window (so they vanish with it) and
        // are one size class below it.
        for (let k = 0; k < fillers; k++) {
          const ang = hash2(jx * 7 + k * 131, jz * 5 - k * 17) * 6.2832;
          const rad = spacing * (0.38 + 0.3 * hash2(jx * 3 - k * 71, jz * 11 + k * 29));
          const fx = jx + Math.cos(ang) * rad, fz = jz + Math.sin(ang) * rad;
          if (fx < b.xMin + 5 || fx > b.xMax - 5 || fz < b.zMin + 5 || fz > b.zMax - 5) continue;
          const fst = terrain.staticSample(fx, fz);
          const fy = terrain.heightFrom(fst, yp0);
          if (!terrain.dry(fy, 0.75) || (fst.dRiver < 0 && fy < 1.7)) continue;
          const fend = Math.min(end, clearedAt(fx, fz));
          if (fend <= s) continue;
          const fsp = speciesFor(fx, fz, false, false, "filler", Math.max(s, tStart));
          const fl: [number, number, number, number] = [s - 25, s, fend, fend + 3];
          items.push({ x: fx, y: fy, z: fz, h: heightFor(fsp, false, "filler", hash2(fx + 3, fz + 8)), life: fl, tone: hash2(fx - 11, fz + 2), wet: false, hedge: false, sp: fsp, anc: true, st: fst });
          anchors.push({ x: fx, y: fy, z: fz, life: fl, wet: false });
        }
      };
      for (let i = 1; i < kf.length; i++) {
        const a = kf[i - 1], c = kf[i];
        if ((a.v > tau) !== (c.v > tau)) {
          const tc = a.t + ((tau - a.v) / (c.v - a.v)) * (c.t - a.t);
          if (alive) push(start, tc);
          else start = tc;
          alive = !alive;
        }
      }
      if (alive) push(start, 1e7);
    }

  // Hedgerow, garden and orchard trees of the farmed landscape: sparse, standing from the
  // later prehistoric clearances onward. Positions are illustrative (not evidenced).
  const tFarm = histToT(-900);
  for (let z = b.zMin + 30; ds.site.woodland.hedgerowTrees !== false && z < b.zMax - 30; z += 46)
    for (let x = b.xMin + 30; x < b.xMax - 30; x += 46) {
      const hsh = hash2(x * 0.7 + 11, z * 0.7 - 5);
      if (hsh > 0.55) continue;
      // bias positions onto the edges of the field patches so they read as hedgerows
      const along = hash2(x - 3, z + 9);
      const jx = x + (hsh < 0.27 ? (along - 0.5) * 40 : 0), jz = z + (hsh < 0.27 ? 0 : (along - 0.5) * 40);
      const st = terrain.staticSample(jx, jz);
      const y = terrain.heightFrom(st, yp0);
      const yLate = terrain.heightFrom(st, terrain.yearParams(Math.min(histToT(1400), tEnd)));
      if (!terrain.dry(y, 1.6) || !terrain.dry(yLate, 1.6)) continue;
      let cleared = Infinity;
      for (const zg of fabric.zoneGeoms) {
        if (zg.zone.style === "roundhouse" || zg.zone.style === "scrub") continue;
        if (zg.t0 < cleared && jx > zg.bbox[0] && jx < zg.bbox[2] && jz > zg.bbox[1] && jz < zg.bbox[3] && zg.weight(jx, jz) > 0.25) cleared = zg.t0 + along * 30;
      }
      const start = tFarm + hash2(jx, jz) * 900;
      if (cleared <= start) continue;
      const sp = speciesFor(jx, jz, false, true, "main", start);
      items.push({ x: jx, y, z: jz, h: heightFor(sp, true, "main", along), life: [start, start + 40, cleared, cleared + 3], tone: hash2(jx - 11, jz + 2), wet: false, hedge: true, sp, st });
    }
  // Keep every tree to the ground of its own years: felled before a house, a road, a street, a wall or a landmark
  // takes its spot (and not back while it stands), gone when the water reaches it, and set on the ground of each
  // span of its years where that ground moves (bank advance, valley fill).
  if (!LEGACY_PLACEMENT) {
    const settled: Item[] = [];
    const lms = fabric.landmarks;
    const HC = 16;
    const cells = new Map<number, { poly: [number, number][]; bb: number[]; life: readonly number[] }[]>();
    for (const h of fabric.houses) {
      const b = h.box ?? [-4, 4, -1, 6, -4, 4];
      const k = h.scale, kx = h.scale * (h.sx ?? 1), c = Math.cos(h.rot), sn = Math.sin(h.rot);
      const poly: [number, number][] = h.rect ? h.rect.map(([x, z]) => [x, z] as [number, number]) : [[b[0] * kx, b[4] * k], [b[1] * kx, b[4] * k], [b[1] * kx, b[5] * k], [b[0] * kx, b[5] * k]].map(([lx, lz]) => [h.x + lx * c + lz * sn, h.z - lx * sn + lz * c] as [number, number]);
      const bb = [Math.min(...poly.map((q) => q[0])) - 1.5, Math.min(...poly.map((q) => q[1])) - 1.5, Math.max(...poly.map((q) => q[0])) + 1.5, Math.max(...poly.map((q) => q[1])) + 1.5];
      const rec = { poly, bb, life: h.life };
      for (let i = Math.floor(bb[0] / HC); i <= Math.floor(bb[2] / HC); i++)
        for (let j = Math.floor(bb[1] / HC); j <= Math.floor(bb[3] / HC); j++) {
          const key = i * 65536 + j;
          let l = cells.get(key);
          if (!l) cells.set(key, (l = []));
          l.push(rec);
        }
    }
    const inPoly = (x: number, z: number, p: [number, number][]) => {
      let ins = false;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, zi] = p[i], [xj, zj] = p[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
      }
      return ins;
    };
    const segD = (x: number, z: number, p: [number, number][]) => {
      let d = Infinity;
      for (let i = 1; i < p.length; i++) {
        const [ax, az] = p[i - 1], [bx, bz] = p[i];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const f = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        d = Math.min(d, Math.hypot(x - ax - f * dx, z - az - f * dz));
      }
      return d;
    };
    const near = (x: number, z: number, p: [number, number][], r: number) => {
      if (inPoly(x, z, p)) return true;
      for (let i = 0; i < p.length; i++) {
        const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length];
        if (segD(x, z, [[ax, az], [bx, bz]]) < r) return true;
      }
      return false;
    };
    const pbb = (p: [number, number][], d: number) => [Math.min(...p.map((q) => q[0])) - d, Math.min(...p.map((q) => q[1])) - d, Math.max(...p.map((q) => q[0])) + d, Math.max(...p.map((q) => q[1])) + d];
    const corBB = lms.corridors.map((c) => pbb(c.path, c.half));
    const whfBB = lms.wharves.map((w) => pbb(w.path, w.half));
    const strBB = (fabric.streets ?? []).map((st) => pbb(st.pts, st.width / 2 + 1));
    const inBB = (x: number, z: number, b: number[]) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3];
    const windowsAt = (x: number, z: number): [number, number][] => {
      const w: [number, number][] = [];
      for (const h of cells.get(Math.floor(x / HC) * 65536 + Math.floor(z / HC)) ?? [])
        if (x >= h.bb[0] && x <= h.bb[2] && z >= h.bb[1] && z <= h.bb[3] && near(x, z, h.poly, 1.2)) w.push([h.life[0] - 3, h.life[3]]);
      for (const sd of lms.solids)
        if (x >= sd.bbox[0] - 2 && x <= sd.bbox[2] + 2 && z >= sd.bbox[1] - 2 && z <= sd.bbox[3] + 2 && (sd.enclosure ? inPoly(x, z, sd.poly) : near(x, z, sd.poly, 1.5))) w.push([sd.t0 - 3, sd.t1]);
      // corridors carry a 5 m margin beyond the road, wall or stream itself
      lms.wharves.forEach((wf, i) => { if (inBB(x, z, whfBB[i]) && segD(x, z, wf.path) < wf.half + 1) w.push([wf.t0 - 3, wf.t1]); });
      lms.corridors.forEach((c, i) => { if (inBB(x, z, corBB[i]) && segD(x, z, c.path) < c.half - 5 + 1.5) w.push([c.t0 - 3, c.t1]); });
      (fabric.streets ?? []).forEach((st, i) => { if (inBB(x, z, strBB[i]) && segD(x, z, st.pts) < st.width / 2 + 1) w.push([st.t0 - 3, st.t1]); });
      return w.sort((a, b) => a[0] - b[0]);
    };
    const keyT = terrain.keyTimes();
    const keyP = keyT.map((t) => terrain.yearParams(t));
    for (const it of items) {
      let [a0, a1, d0, d1] = it.life;
      // 1. what stands on the spot in the tree's years
      let dropped = false;
      for (const [w0, w1] of windowsAt(it.x, it.z)) {
        if (w1 <= a0 || w0 >= d1) continue;
        if (w0 <= a1) {
          // the spot is taken when the tree would grow: it grows after (if ever), as woodland or hedgerow regrowth
          if (w1 + 30 >= d0) { dropped = true; break; }
          a0 = w1 + 5;
          a1 = a0 + 25;
        } else {
          d1 = Math.min(d1, w0);
          d0 = Math.min(d0, d1 - 3);
          if (d0 <= a1) { dropped = true; break; }
        }
      }
      if (dropped) continue;
      // the ground at the keyframes of the years it stands (the ground changes course only there)
      const st = it.st ?? terrain.staticSample(it.x, it.z);
      const lo = Math.max(a0, tStart), hi = Math.min(d1, tEnd);
      let mn = Infinity, mx = -Infinity;
      if (hi > lo) {
        const probe = (p: ReturnType<TerrainModel["yearParams"]>) => {
          const g = terrain.heightFrom(st, p);
          if (g < mn) mn = g;
          if (g > mx) mx = g;
        };
        probe(terrain.yearParams(lo));
        probe(terrain.yearParams(hi));
        keyT.forEach((q, i) => { if (q > lo && q < hi) probe(keyP[i]); });
      }
      // 2. the water reaching it
      if (terrain.hasRiver && mn < 0.6) {
        const wet = terrain.firstBelow([st], Math.max(a1, tStart), Math.min(d1, tEnd), 0.2);
        if (wet != null) {
          if (wet - 3 <= a1) continue;
          d1 = Math.min(d1, wet);
          d0 = Math.min(d0, d1 - 3);
        }
      }
      // 3. the ground moving under it
      const moves = hi > lo && mx - mn > 0.8;
      if (!moves) {
        // on the ground of its own years (not of the first year of the timeline)
        const y = hi > lo ? (mn + mx) / 2 : it.y;
        settled.push({ ...it, y, life: [a0, a1, d0, d1] });
        continue;
      }
      const spans = terrain.groundSpans([st], lo, hi, 0.8);
      spans.forEach(([p, q], i) => {
        const last = i === spans.length - 1;
        const life: [number, number, number, number] = [i === 0 ? a0 : p, i === 0 ? a1 : p + 0.02, last ? d0 : q, last ? d1 : q + 0.02];
        if (life[2] <= life[1]) life[2] = life[1] + 0.01;
        if (life[3] <= life[2]) life[3] = life[2] + 0.02;
        const y = terrain.heightFrom(st, terrain.yearParams((p + q) / 2));
        settled.push({ ...it, y, life });
      });
    }
    items.length = 0;
    for (const it of settled) items.push(it);
    anchors.length = 0;
    for (const it of items) if (it.anc) anchors.push({ x: it.x, y: it.y, z: it.z, life: it.life, wet: it.wet });
  }
  items.sort((a, b) => b.life[3] - a.life[3]);
  const N = items.length;

  // ---- static per-tree data (global order = sorted by end time, descending); the mesh source decides scale and tint ----
  const mats = new Float32Array(N * 16);
  const lifeA = new Float32Array(N * 4);
  const colA = new Float32Array(N * 3);
  const colB = new Float32Array(N * 3);
  const lodK = new Float32Array(N);
  const varOf = new Uint8Array(N);
  const rotA = new Float32Array(N);
  items.forEach((it, i) => {
    rotA[i] = (it.tone * 6.28 * 7.13) % 6.28;
    lifeA.set(it.life, i * 4);
  });
  // the crowns of thinner (Low/Medium) placements are made a little broader so the canopy still closes
  const crownBoost = Math.pow(density, -0.25);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qLean = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0), leanAxis = new THREE.Vector3();

  // ---- buckets: one set of InstancedMeshes per (variant, level), one mesh per part ----
  interface Bucket {
    meshes: THREE.InstancedMesh[];
    mat: THREE.InstancedBufferAttribute;
    life: THREE.InstancedBufferAttribute;
    col: THREE.InstancedBufferAttribute;
    colBark: THREE.InstancedBufferAttribute;
    ends: Float32Array;
    n: number;
    cap: number;
  }
  let source: TreeSource = buildProceduralSource();
  let sets = source.sets;
  let members: number[][] = [];
  let buckets: Bucket[][] = [];
  let scanned = false;
  const zeroFx = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, N) * 3), 3);
  // level distances scale with quality (applied through the set's own maxDist) and with the tree's size
  const distK = quality === 2 ? 1 : quality === 1 ? 0.7 : 0.5;

  const assign = (src: TreeSource, tint: Record<Species, [number, number, number]>) => {
    for (const row of buckets)
      for (const bk of row)
        for (const m of bk.meshes) {
          root.remove(m);
          m.geometry.dispose();
        }
    source = src;
    sets = src.sets;
    members = sets.map(() => []);
    for (let i = 0; i < N; i++) {
      const it = items[i];
      const vs = src.variants[it.sp];
      const vi = vs[Math.floor(hash2(it.x * 0.37 + 2, it.z * 0.53 + 7) * vs.length) % vs.length];
      varOf[i] = vi;
      members[vi].push(i);
      const set = sets[vi];
      const ys = set.yStretch ?? 1;
      const sc = Math.min((it.h * crownBoost) / (set.height * ys), set.maxScale);
      // individual form: a slight lean (more on wet ground and at wood edges), crowns a little wider one way than the other
      const h1 = hash2(it.x * 0.71 - 3, it.z * 0.29 + 5), h2 = hash2(it.x * 0.13 + 8, it.z * 0.83 - 1);
      const lean = (it.wet ? 0.1 : it.hedge ? 0.06 : 0.04) * h1;
      leanAxis.set(Math.cos(h2 * 6.28), 0, Math.sin(h2 * 6.28));
      qLean.setFromAxisAngle(leanAxis, lean);
      q.setFromAxisAngle(yAxis, rotA[i]).premultiply(qLean);
      pos.set(it.x, it.y - 0.1, it.z);
      const sy = sc * ys * (0.92 + it.tone * 0.16);
      scl.set(sc * (0.9 + 0.2 * h2), sy, sc * (1.1 - 0.2 * h1));
      m4.compose(pos, q, scl).toArray(mats, i * 16);
      // size factor of the level distances; veg/impostor.ts computes the same from the matrix on the GPU
      lodK[i] = THREE.MathUtils.clamp((set.height * sy) / 18, 0.4, 1.4);
      const br = 0.88 + hash2(it.x + 1, it.z - 3) * 0.26, hu = hash2(it.x - 5, it.z + 4) - 0.5;
      // stands vary as well as single trees: a slow drift of brightness and hue over a few hundred metres
      const stand = noise2(it.x / 260 + 7.3, it.z / 260 - 2.1) - 0.5, standHue = noise2(it.x / 410 - 4.4, it.z / 410 + 9.7) - 0.5;
      const sb = br * (1 + stand * 0.22), sh = hu * 0.8 + standHue * 0.7;
      const t = tint[it.sp];
      colA[i * 3] = sb * (1 + sh * 0.22) * t[0];
      colA[i * 3 + 1] = sb * t[1];
      colA[i * 3 + 2] = sb * (1 - sh * 0.3) * t[2];
      colB[i * 3] = br; colB[i * 3 + 1] = br * 0.97; colB[i * 3 + 2] = br * 0.93;
    }
    buckets = sets.map((set, v) =>
      set.lods.map((lod, li) => {
        // near levels hold few instances; if one overflows, the surplus drops to the next level
        const cap = Math.max(1, li === 0 ? Math.min(members[v].length, 2500) : li === 1 ? Math.min(members[v].length, 20000) : members[v].length);
        const mat = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16).setUsage(THREE.DynamicDrawUsage);
        const life = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
        const col = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
        const colBark = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
        const meshes = lod.parts.map((part) => {
          const g = new THREE.BufferGeometry();
          for (const [name, attr] of Object.entries(part.geometry.attributes)) g.setAttribute(name, attr);
          g.setIndex(part.geometry.index);
          g.setAttribute("aLife", life);
          g.setAttribute("aFx", zeroFx);
          g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
          const mesh = new THREE.InstancedMesh(g, part.material, cap);
          mesh.instanceMatrix = mat;
          mesh.instanceColor = part.leaf ? col : colBark;
          mesh.customDepthMaterial = part.depthMaterial as THREE.MeshDepthMaterial;
          mesh.castShadow = part.castShadow;
          mesh.receiveShadow = true;
          mesh.frustumCulled = false;
          mesh.count = 0;
          root.add(mesh);
          return mesh;
        });
        return { meshes, mat, life, col, colBark, ends: new Float32Array(cap), n: 0, cap };
      }),
    );
  };
  assign(source, PROC_TINT);

  let tNow = histToT(ds.site.timeline.start);
  const applyCounts = () => {
    for (const row of buckets)
      for (const bk of row) {
        let lo = 0, hi = bk.n;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (bk.ends[mid] > tNow) lo = mid + 1;
          else hi = mid;
        }
        for (const m of bk.meshes) m.count = lo;
      }
  };

  // the old crossed-billboard impostors (fallback only) are rendered unlit and come out darker than the mesh levels
  let farBoost = 1;
  const lastCam = new THREE.Vector3(1e9, 1e9, 1e9);
  let lastRefresh = -1e9;
  /**
   * Camera moves (m) that trigger a full re-bucketing of every level, and a cheap one of the mesh levels only (from the
   * short list of trees the full one found near the camera). Buckets overlap by more than the move, so the GPU fade
   * bands are always covered; the small near step keeps the overlap of the heavy mesh levels small.
   */
  const refreshStep = (ay: number) => Math.max(12, ay * 0.05);
  const NEAR_STEP = 3;
  const nearMargin = NEAR_STEP * 1.2 + 2;
  const nearCand: number[][] = [];
  const lastNear = new THREE.Vector3(1e9, 1e9, 1e9);
  let lastNearT = -1e9;
  const upload = (bk: Bucket) => {
    for (const [a, sz] of [[bk.mat, 16], [bk.life, 4], [bk.col, 3], [bk.colBark, 3]] as [THREE.InstancedBufferAttribute, number][]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, bk.n) * sz);
      a.needsUpdate = true;
    }
  };
  /**
   * Width of the cross-fade band after level l, as a fraction of its switch distance: short between the two mesh levels
   * (the same model with fewer leaf cards, and the heaviest overlap), wide between mesh and impostor.
   */
  const fadeW = (l: number, nl: number) => (l >= nl - 2 ? 0.15 : 0.05);
  const put = (bk: Bucket, i: number, boost: number) => {
    const o = bk.n++;
    const i16 = i * 16;
    const ma = bk.mat.array as Float32Array, la = bk.life.array as Float32Array, ca = bk.col.array as Float32Array, cb = bk.colBark.array as Float32Array;
    const a = o * 16;
    for (let c = 0; c < 16; c++) ma[a + c] = mats[i16 + c];
    const i4 = i * 4, o4 = o * 4;
    la[o4] = lifeA[i4]; la[o4 + 1] = lifeA[i4 + 1]; la[o4 + 2] = lifeA[i4 + 2]; la[o4 + 3] = lifeA[i4 + 3];
    const i3 = i * 3, o3 = o * 3;
    ca[o3] = colA[i3] * boost; ca[o3 + 1] = colA[i3 + 1] * boost; ca[o3 + 2] = colA[i3 + 2] * boost;
    cb[o3] = colB[i3]; cb[o3 + 1] = colB[i3 + 1]; cb[o3 + 2] = colB[i3 + 2];
    bk.ends[o] = lifeA[i4 + 3];
  };
  /** Diagnostics: draw every tree at one level (null = normal selection). */
  let forced: number | null = null;
  const savedFades = new Map<THREE.Vector4, THREE.Vector4>();
  /** Mesh levels of the cross-faded sets, from the candidates of the last full refresh (kept in global order). */
  const refreshNear = (cx: number, cy: number, cz: number) => {
    lastNear.set(cx, cy, cz);
    lastNearT = performance.now();
    if (forced != null) return applyCounts();
    for (let v = 0; v < sets.length; v++) {
      const lods = sets[v].lods;
      if (!lods.every((l) => l.fade) || !nearCand[v]) continue;
      const nl = lods.length;
      const D = lods.map((l) => l.maxDist * distK);
      const row = buckets[v];
      for (let l = 0; l < nl - 1; l++) row[l].n = 0;
      for (const i of nearCand[v]) {
        const i16 = i * 16;
        const dx = mats[i16 + 12] - cx, dy = mats[i16 + 13] - cy, dz = mats[i16 + 14] - cz;
        const k = lodK[i];
        const dn = Math.sqrt(dx * dx + dy * dy * 0.5 + dz * dz) / k, m = nearMargin / k;
        for (let l = 0; l < nl - 1; l++) {
          if (l > 0 && dn < D[l - 1] - m) break;
          if (dn > D[l] * (1 + fadeW(l, nl)) + m) continue;
          if (row[l].n < row[l].cap) put(row[l], i, 1);
        }
      }
      for (let l = 0; l < nl - 1; l++) upload(row[l]);
    }
    applyCounts();
  };
  const refresh = (cx: number, cy: number, cz: number) => {
    lastCam.set(cx, cy, cz);
    lastRefresh = performance.now();
    const margin = refreshStep(cy) * 1.2 + 2;
    for (let v = 0; v < sets.length; v++) {
      const lods = sets[v].lods;
      const nl = lods.length;
      const D = lods.map((l) => (Number.isFinite(l.maxDist) ? l.maxDist * distK : Infinity));
      const d2 = D.map((d) => d * d);
      const faded = lods.every((l) => l.fade);
      const row = buckets[v];
      for (const bk of row) bk.n = 0;
      const cand: number[] = (nearCand[v] = []);
      for (const i of members[v]) {
        const i16 = i * 16;
        const dx = mats[i16 + 12] - cx, dy = mats[i16 + 13] - cy, dz = mats[i16 + 14] - cz;
        const k = lodK[i];
        const d = (dx * dx + dy * dy * 0.5 + dz * dz) / (k * k);
        if (forced != null) {
          // within 400 m only (the mesh buckets are capped); everything further stays an impostor
          const bk = row[d * k * k < 160000 ? Math.min(forced, nl - 1) : nl - 1];
          if (bk.n < bk.cap) put(bk, i, 1);
          continue;
        }
        if (faded) {
          // the impostor level takes every tree beyond its band's start (widened by the move allowed before the next
          // full refresh); trees that may come within reach of the mesh levels go on the near list (refreshNear)
          const dn = Math.sqrt(d), m = margin / k;
          if (dn >= D[nl - 2] - m) put(row[nl - 1], i, 1);
          if (dn <= D[nl - 2] * (1 + fadeW(nl - 2, nl)) + m + nearMargin / k) cand.push(i);
          continue;
        }
        let l = 0;
        while (l < nl - 1 && d > d2[l]) l++;
        let bk = row[l];
        while (bk.n >= bk.cap && l < nl - 1) bk = row[++l];
        if (bk.n >= bk.cap) continue;
        put(bk, i, l === nl - 1 ? farBoost : 1);
      }
      for (const bk of row) upload(bk);
    }
    refreshNear(cx, cy, cz);
  };

  // ---- understorey (Medium and High): scanned ferns, nettles, shrubs and deadwood near the camera ----
  const understorey = quality >= 1 ? new Understorey(anchors, terrain, yp0, quality === 2 ? 2 : 1) : null;
  if (understorey) root.add(understorey.object);

  // ---- swap in the scanned trees once they have loaded (never blocks; failure keeps the procedural trees) ----
  let attached = false;
  if (quality >= 1) {
    const dist: [number, number] = quality === 2 ? [44, 150] : [30, 120];
    loadScannedSource(dist)
      .then((src) => {
        if (!src || (attached && !root.parent)) return;
        scanned = true;
        farBoost = src.sets.every((st) => st.lods.every((l) => l.fade)) ? 1 : 1.3;
        // fade bands: level l fades out over [D_l, D_l (1 + w)] while level l + 1 fades in over the same band
        for (const st of src.sets)
          st.lods.forEach((l, li) => {
            if (!l.fade) return;
            const prev = li > 0 ? st.lods[li - 1].maxDist * distK : -2;
            const own = Number.isFinite(l.maxDist) ? l.maxDist * distK : 1e8;
            const nl = st.lods.length;
            l.fade.value.set(prev, li > 0 ? prev * (1 + fadeW(li - 1, nl)) : -1, own, Number.isFinite(l.maxDist) ? own * (1 + fadeW(li, nl)) : 2e8);
          });
        assign(src, SCAN_TINT);
        lastRefresh = -1e9;
        lastCam.set(1e9, 1e9, 1e9);
      })
      .catch(() => { /* keep procedural */ });
    understorey?.load().catch(() => { /* no understorey */ });
  }

  // The camera is learnt during rendering: a degenerate, invisible mesh drawn first in the main pass hands its camera
  // over. Shadow passes and the orthographic light camera are ignored; the mirrored water camera has the same |y|.
  const probe = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(9), 3)),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  );
  probe.frustumCulled = false;
  probe.renderOrder = -1e9;
  probe.onBeforeRender = (_r, _s, camera) => {
    if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return;
    attached = true;
    const p = camera.position;
    const ay = Math.abs(p.y);
    // the GPU side of the level cross-fade measures from here (|y|, like the CPU, so the mirror pass agrees)
    vegUniforms.uLodCam.value.set(p.x, ay, p.z);
    const moved = Math.hypot(p.x - lastCam.x, (ay - lastCam.y) * 0.7, p.z - lastCam.z);
    // refresh on a move of a few metres (more when high up), but not more than ~4 times a second
    const now = performance.now();
    if (moved > refreshStep(ay) && now - lastRefresh > 250) refresh(p.x, ay, p.z);
    else if (Math.hypot(p.x - lastNear.x, (ay - lastNear.y) * 0.7, p.z - lastNear.z) > NEAR_STEP && now - lastNearT > 100) refreshNear(p.x, ay, p.z);
    understorey?.update(p, tNow);
  };
  root.add(probe);

  root.userData.count = N;
  // diagnostics / placement audit: every tree's position, height and life window (read-only)
  root.userData.items = items;
  root.userData.update = (t: number) => {
    tNow = t;
    applyCounts();
  };
  /** Diagnostics: source in use, instance and triangle counts as drawn after the last refresh. */
  root.userData.forceLevel = (l: number | null) => {
    forced = l;
    for (const st of sets)
      for (const lod of st.lods) {
        if (!lod.fade) continue;
        const f = lod.fade.value;
        if (!savedFades.has(f)) savedFades.set(f, f.clone());
        if (l == null) f.copy(savedFades.get(f)!);
        else f.set(-2, -1, 1e8, 2e8);
      }
    lastRefresh = -1e9;
    lastCam.set(1e9, 1e9, 1e9);
  };
  root.userData.debug = () => {
    let tri = 0;
    const perLevel: number[] = [];
    buckets.forEach((row, v) =>
      row.forEach((bk, l) => {
        let t3 = 0;
        for (const m of bk.meshes) t3 += m.count * (m.geometry.index ? m.geometry.index.count / 3 : 0);
        tri += t3;
        perLevel[l] = (perLevel[l] ?? 0) + (bk.meshes[0]?.count ?? 0);
        void v;
      }),
    );
    return { source: source.name, scanned, instances: N, perLevel, triangles: Math.round(tri), understorey: understorey?.debug() ?? null };
  };
  return root;
}
