import * as THREE from "three";
import type { PhaseModel } from "@/lib/types";
import type { InletGeom } from "@/lib/terrain";
import { rng } from "@/lib/geo";
import { Builder } from "./geom";

/**
 * Landmark model generators, keyed by `model.kind` from the data files.
 * These are parametric stand-ins: they respect the documented footprint and
 * approximate height, but architectural detail is generic unless stated.
 */

export interface BuildCtx {
  /** Terrain height (world metres) at a world position, at the phase's representative year. */
  ground(x: number, z: number): number;
  /** World-space path for polyline features. */
  path: [number, number][];
  /** World position of the landmark anchor. */
  x: number;
  z: number;
  tier: "overview" | "district";
  seed: number;
  /** Convert lat/lon to world x/z. */
  project(lat: number, lon: number): [number, number];
  /** False on a site without a river: y = 0 is then not a water surface. Default (undefined) = there is water. */
  hasWater?: boolean;
  /** The landmark's bearing, degrees clockwise from north (default for kinds that take a direction). */
  bearing?: number;
  /** A named site polygon as a world-space ring. */
  polygon?(name: string): [number, number][] | undefined;
  /**
   * Optional record of where the builder put things that must meet the ground or the water (quay fronts,
   * revetment lines, bridge piers, craft): read by diagnostics and the placement audit, never by the renderer.
   */
  trace?: TraceItem[];
  /** Ground of the same year with the dated dock inlets left out: the bank line carried across a dock's mouth. */
  land?(x: number, z: number): number;
  /** Dock inlets open in the year this copy is built for (see TerrainModel.inlets). */
  inlets?: InletGeom[];
}

/** One placed part reported through BuildCtx.trace (world x, z; rot about +y as the builders use it). */
export interface TraceItem {
  kind: string;
  x: number;
  z: number;
  [key: string]: number | string;
}

export type KindBuilder = (b: Builder, m: PhaseModel, ctx: BuildCtx) => void;

const num = (v: unknown, d: number): number => (typeof v === "number" ? v : d);
const str = (v: unknown, d: string): string => (typeof v === "string" ? v : d);

/** Kinds whose geometry is authored directly in world coordinates (group stays at the origin). */
export const WORLD_SPACE_KINDS = new Set([
  "wall", "bridge", "road", "stream", "quay", "waterfront", "boats", "stone-bridge", "bridge-houses",
  "troops", "zone-marker", "tents", "camp", "hedge", "field-strips", "ford",
]);
/** Kinds laid flat on the ground: they clip from their own base and (where linear) keep houses off them. */
export const FLAT_KINDS = new Set(["road", "stream", "ford", "hedge", "zone-marker", "field-strips"]);
/** Flat kinds that generic houses should stay clear of. */
export const CORRIDOR_KINDS = new Set(["road", "stream", "wall", "ford", "hedge"]);

function windows(b: Builder, l: number, y: number, h: number, z: number, spacing: number, w = 1.4) {
  const n = Math.max(1, Math.floor(l / spacing));
  for (let i = 0; i < n; i++) {
    const x = -l / 2 + (i + 0.5) * (l / n);
    b.box("glass", w, h, 0.25, x, y, z);
  }
}

function crenels(b: Builder, mat: string, l: number, y: number, z: number, rotY = 0, x0 = 0) {
  const n = Math.max(1, Math.floor(l / 2.4));
  const step = l / n;
  for (let i = 0; i < n; i++) {
    const x = -l / 2 + (i + 0.5) * step;
    b.box(mat, step * 0.5, 0.9, 0.6, x0 + x * Math.cos(rotY), y, z - x * Math.sin(rotY), rotY);
  }
}

function church(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const l = num(m.l, 30), w = num(m.w, 12), h = num(m.h, 9);
  const wall = str(m.wall, "ragstone"), roof = str(m.roof, "tile");
  const aisles = !!m.aisles;
  const pitch = roof === "lead" ? 0.55 : 1.0;
  const rise = (w / 2) * pitch * (aisles ? 0.62 : 1);
  const round = num(m.round, 0);
  const naveW = aisles ? w * 0.5 : w;
  const x0 = round ? round * 0.5 : 0; // shift body east of a round nave
  // body
  b.box(wall, l, h + 3, naveW, x0, -3, 0);
  b.gable(roof, wall, l, naveW, rise, x0, h, 0);
  if (aisles) {
    const aw = (w - naveW) / 2;
    const ah = h * 0.55;
    for (const s of [1, -1]) {
      b.box(wall, l, ah + 3, aw, x0, -3, s * (naveW / 2 + aw / 2));
      // lean-to aisle roof
      b.box(roof, l + 0.4, 0.35, aw + 0.6, x0, ah, s * (naveW / 2 + aw / 2));
      windows(b, l, ah * 0.3, ah * 0.5, s * (w / 2 + 0.02), 6);
      windows(b, l, ah + (h - ah) * 0.25, (h - ah) * 0.6, s * (naveW / 2 + 0.02), 6, 1.6);
      // buttresses
      const nb = Math.floor(l / 6);
      for (let i = 0; i <= nb; i++) b.box(wall, 0.9, ah + 2, 1.2, x0 - l / 2 + (i * l) / nb, -3 + 1, s * (w / 2 + 0.5));
    }
  } else {
    for (const s of [1, -1]) windows(b, l, h * 0.35, h * 0.45, s * (w / 2 + 0.02), 5, 1.1);
  }
  // east window
  b.box("glass", 0.25, h * 0.55, naveW * 0.45, x0 + l / 2 + 0.02, h * 0.3, 0);
  const cx = x0 - l / 2 + l * num(m.crossingAt, 0.62);
  const tr = m.transept as { l: number; w: number } | undefined;
  if (tr) {
    b.box(wall, tr.w, h + 3, tr.l, cx, -3, 0);
    b.gable(roof, wall, tr.l, tr.w, rise, cx, h, 0, Math.PI / 2);
    for (const s of [1, -1]) b.box("glass", tr.w * 0.4, h * 0.5, 0.25, cx, h * 0.3, s * (tr.l / 2 + 0.02));
  }
  if (round) {
    b.cyl(wall, round / 2, round / 2, h + 3, 16, -l / 2 + x0 - round / 2 + 1, -3, 0);
    b.cone(roof, round / 2 + 0.4, round * 0.35, 16, -l / 2 + x0 - round / 2 + 1, h, 0);
  }
  const tw = m.tower as { w: number; h: number; at?: string; pinnacles?: boolean } | undefined;
  if (tw) {
    const tx = tw.at === "crossing" ? cx : x0 - l / 2 - tw.w / 2 + 0.5;
    b.box(wall, tw.w, tw.h + 3, tw.w, tx, -3, 0);
    for (const [dx, dz, r] of [[1, 0, 0], [-1, 0, 0], [0, 1, Math.PI / 2], [0, -1, Math.PI / 2]] as const) {
      // belfry openings
      b.box("dark", r ? tw.w * 0.2 : 0.2, Math.min(4, tw.h * 0.1), r ? 0.2 : tw.w * 0.2, tx + (dx * tw.w) / 2, tw.h * 0.82, (dz * tw.w) / 2);
    }
    crenels(b, wall, tw.w, tw.h, tw.w / 2 - 0.3, 0, tx);
    crenels(b, wall, tw.w, tw.h, -tw.w / 2 + 0.3, 0, tx);
    crenels(b, wall, tw.w, tw.h, tx - tw.w / 2 + 0.3 - tx, Math.PI / 2, tx - tw.w / 2 + 0.3);
    crenels(b, wall, tw.w, tw.h, 0, Math.PI / 2, tx + tw.w / 2 - 0.3);
    const sp = num(m.spire, 0);
    if (sp > 0) b.cone("lead", tw.w * 0.5, sp, 8, tx, tw.h, 0, Math.PI / 8);
    else b.pyramid(roof === "lead" ? "lead" : roof, tw.w * 0.9, tw.w * 0.9, tw.w * 0.25, tx, tw.h, 0);
    if (tw.pinnacles || sp > 0) for (const sx of [1, -1]) for (const sz of [1, -1]) b.cone(wall, 0.7, Math.max(3, tw.w * 0.5), 4, tx + sx * (tw.w / 2 - 0.5), tw.h, sz * (tw.w / 2 - 0.5));
  }
  if (m.pinnacles) {
    const n = Math.floor(l / 5);
    for (let i = 0; i <= n; i++) for (const s of [1, -1]) b.cone(wall, 0.6, 4, 4, x0 - l / 2 + (i * l) / n, h, s * (w / 2));
  }
  void ctx;
}

function ranges(b: Builder, l: number, w: number, h: number, depth: number, wall: string, roof: string, pitch = 0.8) {
  const rise = (depth / 2) * pitch;
  // long ranges (north & south), short ranges (east & west)
  for (const s of [1, -1]) {
    const z = s * (w / 2 - depth / 2);
    b.box(wall, l, h + 3, depth, 0, -3, z);
    b.gable(roof, wall, l, depth, rise, 0, h, z);
    windows(b, l, h * 0.55, h * 0.22, z + s * (depth / 2 + 0.02), 4.5, 1.1);
    if (h > 8) windows(b, l, h * 0.2, h * 0.2, z + s * (depth / 2 + 0.02), 4.5, 1.1);
    const x = s * (l / 2 - depth / 2);
    b.box(wall, depth, h + 3, w - depth * 2, x, -3, 0);
    b.gable(roof, null, w - depth * 2 + depth, depth, rise, x, h, 0, Math.PI / 2, 0.3);
  }
}

function courtyard(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const l = num(m.l, 50), w = num(m.w, 40), h = num(m.h, 9), depth = num(m.range, 8);
  const wall = str(m.wall, "ragstone"), roof = str(m.roof, "tile");
  ranges(b, l, w, h, depth, wall, roof, roof === "lead" ? 0.45 : 0.85);
  if (m.double) {
    b.box(wall, depth, h + 3, w - depth * 2, 0, -3, 0);
    b.gable(roof, null, w - depth, depth, (depth / 2) * 0.8, 0, h, 0, Math.PI / 2, 0.3);
  }
  const nt = num(m.towers, 0);
  if (nt) {
    const corners: [number, number][] = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (let i = 0; i < Math.min(4, nt); i++) {
      const [sx, sz] = corners[i];
      const tw = Math.max(5, depth * 0.7);
      b.box(wall, tw, h + 5 + 3, tw, (sx * l) / 2, -3, (sz * w) / 2);
      b.pyramid("lead", tw + 0.6, tw + 0.6, tw * 0.5, (sx * l) / 2, h + 5, (sz * w) / 2);
    }
  }
  const tw = m.tower as { w: number; h: number } | undefined;
  if (tw) {
    b.box(wall, tw.w, tw.h + 3, tw.w, 0, -3, w / 2 - depth / 2);
    b.cone("lead", tw.w * 0.6, tw.w * 1.2, 8, 0, tw.h, w / 2 - depth / 2);
  }
  if (m.greatHall) {
    b.box(wall, l * 0.55, h + 4 + 3, depth + 3, -l * 0.15, -3, w / 2 - depth / 2);
    b.gable(roof, wall, l * 0.55, depth + 3, (depth + 3) * 0.5, -l * 0.15, h + 4, w / 2 - depth / 2);
    b.cyl("glass", 2.4, 2.4, 0.3, 12, -l * 0.15 - l * 0.275 - 0.05, h + 1.5, w / 2 - depth / 2, 0);
  }
  if (m.arcade) {
    for (const s of [1, -1]) b.box("dark", l - depth * 2 - 2, h * 0.3, 0.3, 0, 0.3, s * (w / 2 - depth - 0.05));
  }
  void ctx;
}

function friary(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const l = num(m.l, 60), w = num(m.w, 20), h = num(m.h, 14), cl = num(m.cloister, 30);
  church(b, { ...m, kind: "church", aisles: true }, ctx);
  const fl = num(m.fleche, 0);
  if (fl) {
    b.box(str(m.wall, "ragstone"), 4, 4, 4, l * 0.12, h + w * 0.1, 0);
    b.cone("lead", 2.2, fl, 8, l * 0.12, h + w * 0.1 + 4, 0);
  }
  b.at(-l * 0.1, 0, w / 2 + cl / 2 + 1, 0, () => ranges(b, cl, cl, 6, 6.5, str(m.wall, "ragstone"), "tile", 0.8));
}

function keep(b: Builder, m: PhaseModel) {
  const w = num(m.w, 30), d = num(m.d, 30), h = num(m.h, 25);
  const wall = str(m.wall, "ragstone");
  b.box(wall, w, h + 4, d, 0, -4, 0);
  // pilaster buttresses
  for (let i = 1; i < 4; i++) for (const s of [1, -1]) {
    b.box(wall, 1.6, h, 0.5, -w / 2 + (i * w) / 4, 0, s * (d / 2 + 0.2));
    b.box(wall, 0.5, h, 1.6, s * (w / 2 + 0.2), 0, -d / 2 + (i * d) / 4);
  }
  for (const s of [1, -1]) {
    windows(b, w, h * 0.72, 2, s * (d / 2 + 0.03), 7, 0.9);
    windows(b, w, h * 0.45, 1.6, s * (d / 2 + 0.03), 7, 0.7);
    crenels(b, wall, w, h, s * (d / 2 - 0.3));
    crenels(b, wall, d, h, 0, Math.PI / 2, s * (w / 2 - 0.3));
  }
  if (m.turrets) {
    const corners: [number, number][] = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
    corners.forEach(([sx, sz], i) => {
      const th = h + 6;
      if (i === 2) {
        b.cyl(wall, 3.6, 3.6, th + 4, 14, (sx * w) / 2, -4, (sz * d) / 2);
        b.cone("lead", 3.9, 4, 14, (sx * w) / 2, th, (sz * d) / 2);
      } else {
        b.box(wall, 6, th + 4, 6, (sx * w) / 2, -4, (sz * d) / 2);
        b.pyramid("lead", 6.4, 6.4, 3.5, (sx * w) / 2, th, (sz * d) / 2);
      }
    });
  }
  b.box("lead", w - 3, 0.4, d - 3, 0, h - 1, 0);
}

function hall(b: Builder, m: PhaseModel) {
  const l = num(m.l, 30), w = num(m.w, 10), h = num(m.h, 8);
  const wall = str(m.wall, "ragstone"), roof = str(m.roof, "tile");
  const rise = (w / 2) * num(m.pitch, 0.85);
  b.box(wall, l, h + 3, w, 0, -3, 0);
  if (m.classical) {
    b.box(wall, l + 0.8, 0.9, w + 0.8, 0, h, 0);
    b.box("lead", l - 1, 0.5, w - 1, 0, h + 0.9, 0);
    for (const s of [1, -1]) {
      windows(b, l, h * 0.18, h * 0.27, s * (w / 2 + 0.03), l / 7, 1.9);
      windows(b, l, h * 0.58, h * 0.25, s * (w / 2 + 0.03), l / 7, 1.9);
      const n = 8;
      for (let i = 0; i <= n; i++) b.box(wall, 0.7, h, 0.35, -l / 2 + (i * l) / n, 0, s * (w / 2 + 0.15));
      b.box(wall, l + 0.5, 0.5, 0.5, 0, h * 0.5, s * (w / 2 + 0.2));
    }
  } else {
    b.gable(roof, wall, l, w, rise, 0, h, 0);
    for (const s of [1, -1]) {
      windows(b, l, h * 0.35, h * 0.45, s * (w / 2 + 0.03), 6, 1.5);
      const nb = Math.max(2, Math.floor(l / 8));
      if (h > 9) for (let i = 0; i <= nb; i++) b.box(wall, 1, h * 0.85, 1.3, -l / 2 + (i * l) / nb, 0, s * (w / 2 + 0.5));
    }
    b.box("glass", 0.25, h * 0.6, w * 0.4, l / 2 + 0.03, h * 0.3, 0);
  }
  if (m.endTowers) for (const s of [1, -1]) {
    b.box(wall, 4.5, h + rise * 0.6 + 3, 4.5, l / 2 + 0.5, -3, s * (w / 2 + 1));
    b.pyramid("lead", 4.9, 4.9, 3, l / 2 + 0.5, h + rise * 0.6, s * (w / 2 + 1));
  }
  if (m.apse) {
    b.cyl(wall, w * 0.4, w * 0.4, h + 3, 10, -l / 2, -3, 0);
    b.cone(roof, w * 0.4 + 0.3, 2, 10, -l / 2, h, 0);
  }
}

function forum(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const l = num(m.l, 100), w = num(m.w, 100), h = num(m.h, 8), depth = num(m.range, 12);
  const bas = (m.basilica as { w: number; h: number }) ?? { w: 30, h: 18 };
  ranges(b, l, w, h, depth, "roman-rubble", "tegula", 0.45);
  // basilica across the north side (local -z)
  const z = -w / 2 + bas.w / 2;
  const nave = bas.w * 0.5;
  b.box("plaster", l, bas.h + 3, nave, 0, -3, z);
  b.gable("tegula", "plaster", l, nave, nave * 0.22, 0, bas.h, z);
  for (const s of [1, -1]) {
    b.box("plaster", l, bas.h * 0.55 + 3, bas.w * 0.25, 0, -3, z + s * (nave / 2 + bas.w * 0.125));
    b.box("tegula", l + 0.5, 0.4, bas.w * 0.25 + 0.6, 0, bas.h * 0.55, z + s * (nave / 2 + bas.w * 0.125));
    windows(b, l, bas.h * 0.66, bas.h * 0.2, z + s * (nave / 2 + 0.03), 5, 1.6);
  }
  // gravelled court
  b.box("gravel", l - depth * 2, 0.3, w - depth - bas.w, 0, 0, (bas.w - depth) / 2);
  void ctx;
}

function amphitheatre(b: Builder, m: PhaseModel) {
  const l = num(m.l, 100), w = num(m.w, 85), h = num(m.h, 8);
  const wall = str(m.wall, "timber");
  const n = 44;
  const tiers = 4;
  const bank = Math.min(l, w) * 0.24;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    // leave entrances on the long axis
    if (Math.abs(Math.sin(am)) < 0.09) continue;
    for (let t = 0; t < tiers; t++) {
      const f = 1 - (t / tiers) * (bank / (w / 2));
      const ax = (Math.cos(a0) * l * f) / 2, az = (Math.sin(a0) * w * f) / 2;
      const bx = (Math.cos(a1) * l * f) / 2, bz = (Math.sin(a1) * w * f) / 2;
      const top = h * (1 - t / tiers) + 0.6;
      const mat = t === tiers - 1 ? wall : "timber-weathered";
      b.slab(t === 0 ? "timber" : mat, ax, az, bx, bz, -2, top, bank / tiers + 0.6);
    }
  }
  b.cyl("gravel", 0.5, 0.5, 0.25, 28, 0, 0.05, 0);
  // scale the unit disc into the arena ellipse
  b.add("gravel", new THREE.CylinderGeometry(1, 1, 0.2, 32).scale((l / 2) * 0.55, 1, (w / 2) * 0.5), new THREE.Matrix4().setPosition(0, 0.15, 0));
}

function nearestOnPath(path: [number, number][], x: number, z: number): { x: number; z: number; ang: number } {
  let best = Infinity;
  let out = { x, z, ang: 0 };
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const dx = bx - ax, dz = bz - az;
    const f = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const px = ax + dx * f, pz = az + dz * f;
    const d = Math.hypot(px - x, pz - z);
    if (d < best) {
      best = d;
      out = { x: px, z: pz, ang: -Math.atan2(dz, dx) };
    }
  }
  return out;
}

function wallPath(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const h = num(m.h, 6), thick = num(m.thick, 2.4), mat = str(m.wall, "ragstone");
  const towers = num(m.towers, 0);
  const r = rng(ctx.seed);
  let sinceTower = towers / 2;
  for (let i = 1; i < ctx.path.length; i++) {
    const [ax, az] = ctx.path[i - 1];
    const [bx, bz] = ctx.path[i];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 10));
    const rot = -Math.atan2(bz - az, bx - ax);
    for (let k = 0; k < n; k++) {
      const x0 = ax + ((bx - ax) * k) / n, z0 = az + ((bz - az) * k) / n;
      const x1 = ax + ((bx - ax) * (k + 1)) / n, z1 = az + ((bz - az) * (k + 1)) / n;
      const g = Math.max(0.5, (ctx.ground(x0, z0) + ctx.ground(x1, z1)) / 2);
      const hh = m.weathered ? h * (0.55 + r() * 0.45) : h;
      b.slab(mat, x0, z0, x1, z1, g - 3, g + hh, thick);
      if (m.crenel) {
        const sl = len / n;
        const cn = Math.max(1, Math.floor(sl / 2.6));
        for (let c = 0; c < cn; c++) {
          const f = (c + 0.5) / cn;
          b.box(mat, (sl / cn) * 0.5, 0.9, 0.5, x0 + (x1 - x0) * f, g + hh, z0 + (z1 - z0) * f, rot);
        }
      }
      if (towers > 0) {
        sinceTower += len / n;
        if (sinceTower >= towers) {
          sinceTower = 0;
          b.cyl(mat, thick * 1.5, thick * 1.6, hh + 3 + 3, 10, x0, g - 3, z0);
          b.cone("lead", thick * 1.6, 2.5, 10, x0, g + hh + 3, z0);
        }
      }
    }
  }
  const gates = (m.gates as [number, number, string][] | undefined) ?? [];
  for (const [lat, lon] of gates) {
    const [gx, gz] = ctx.project(lat, lon);
    const p = nearestOnPath(ctx.path, gx, gz);
    const g = Math.max(0.5, ctx.ground(p.x, p.z));
    b.at(p.x, g, p.z, p.ang, () => {
      b.box(mat, 9, h + 4 + 3, 8, 0, -3, 0);
      b.box("dark", 3.6, 4.5, 8.3, 0, 0, 0);
      for (const s of [1, -1]) {
        b.box(mat, 5.5, h + 6 + 3, 9, s * 6.5, -3, 0);
        crenels(b, mat, 5.5, h + 6, 4.2, 0, s * 6.5);
        crenels(b, mat, 5.5, h + 6, -4.2, 0, s * 6.5);
      }
      crenels(b, mat, 9, h + 4, 3.7);
      crenels(b, mat, 9, h + 4, -3.7);
    });
  }
}

function timberBridge(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const width = num(m.width, 6), deck = num(m.deck, 5), span = num(m.span, 12);
  const [a, c] = [ctx.path[0], ctx.path[ctx.path.length - 1]];
  const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const rot = -Math.atan2(c[1] - a[1], c[0] - a[0]);
  const n = Math.max(2, Math.round(len / span));
  // `deck` is measured from the water (y = 0). Where there is no water, or with datum: "ground", it is measured from the higher bank.
  const datum = ctx.hasWater === false || m.datum === "ground" ? Math.max(ctx.ground(a[0], a[1]), ctx.ground(c[0], c[1])) : 0;
  b.at(a[0], datum, a[1], rot, () => {
    for (let i = 0; i < n; i++) {
      const x0 = (i * len) / n, x1 = ((i + 1) * len) / n;
      const wx = a[0] + ((c[0] - a[0]) * (x0 + x1)) / 2 / len, wz = a[1] + ((c[1] - a[1]) * (x0 + x1)) / 2 / len;
      const g = ctx.ground(wx, wz) - datum;
      // ramp down to the banks at each end
      const edge = Math.min(i, n - 1 - i);
      const y = edge < 3 ? Math.max(g + 0.4, deck * (0.45 + edge * 0.2)) : deck;
      b.box("timber", x1 - x0 + 0.2, 0.45, width, (x0 + x1) / 2, y - 0.45, 0);
      for (const s of [1, -1]) {
        b.box("timber", x1 - x0, 0.14, 0.14, (x0 + x1) / 2, y + 1.0, s * (width / 2 - 0.1));
        b.box("timber", 0.16, 1.05, 0.16, x0, y, s * (width / 2 - 0.1));
      }
      ctx.trace?.push({ kind: "deck", x: wx, z: wz, y: datum + y, len: x1 - x0, width, rot });
      // trestle
      if (g < y - 1) {
        ctx.trace?.push({ kind: "pier", x: a[0] + ((c[0] - a[0]) * x0) / len, z: a[1] + ((c[1] - a[1]) * x0) / len, rot, along: 0.6, across: width + 1.4 });
        const base = Math.min(g, 0) - 3;
        for (const s of [-1, 0, 1]) b.box("timber-weathered", 0.45, y - 0.45 - base, 0.45, x0, base, s * (width / 2 - 0.4));
        b.box("timber-weathered", 0.3, 0.3, width + 1.4, x0, Math.max(0.6, y * 0.45), 0);
        b.box("timber", 0.5, 0.5, width + 0.6, x0, y - 0.95, 0);
      }
    }
  });
}

function playhouse(b: Builder, m: PhaseModel) {
  const d = num(m.d, 28), h = num(m.h, 10), sides = num(m.sides, 20);
  const roof = str(m.roof, "thatch");
  const depth = 3.8;
  const rMid = d / 2 - depth / 2;
  const side = 2 * (d / 2) * Math.tan(Math.PI / sides);
  for (let i = 0; i < sides; i++) {
    const a = ((i + 0.5) / sides) * Math.PI * 2;
    b.at(Math.cos(a) * rMid, 0, Math.sin(a) * rMid, Math.PI / 2 - a, () => {
      b.box("frame", side * 0.98, h + 1, depth, 0, -1, 0);
      b.gable(roof, null, side * 1.02, depth, 1.9, 0, h, 0, 0, 0.35);
      b.box("dark", side * 0.7, h * 0.7, 0.2, 0, h * 0.2, -depth / 2 - 0.02);
    });
  }
  // stage and tiring-house roof ("heavens")
  b.box("timber", d * 0.35, 1.5, d * 0.22, 0, 0, -d * 0.18);
  b.box("frame", d * 0.34, h + 2, 3, 0, 0, -rMid + depth / 2 + 1.2);
  b.gable(roof, "frame", d * 0.36, d * 0.26, 3, 0, h + 0.6, -d * 0.2, 0, 0.5);
  b.box("timber", 0.18, 6, 0.18, 0, h + 3.4, -d * 0.2);
  b.box("plaster", 1.6, 1, 0.05, 0.9, h + 8.2, -d * 0.2);
  b.cyl("earth", d / 2 - depth, d / 2 - depth, 0.2, sides, 0, 0.02, 0);
}

function ribbon(b: Builder, mat: string, ctx: BuildCtx, width: number, lift: number, clampMin: number, path: [number, number][] = ctx.path, keep: "all" | "dry" | "wet" = "all") {
  const pos: number[] = [];
  const uv: number[] = [];
  let run = 0;
  const pts: [number, number][] = [];
  if (path.length < 2) return;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 8));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  const edge = (i: number): number[][] => {
    const p = pts[i];
    const q = pts[Math.min(pts.length - 1, i + 1)];
    const o = pts[Math.max(0, i - 1)];
    let dx = q[0] - o[0], dz = q[1] - o[1];
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    const nx = -dz, nz = dx;
    return [1, -1].map((s) => {
      const x = p[0] + (nx * s * width) / 2, z = p[1] + (nz * s * width) / 2;
      const g = ctx.ground(x, z);
      return [x, Math.max(clampMin, g) + lift, z, g];
    });
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const [l0, r0] = edge(i);
    const [l1, r1] = edge(i + 1);
    // a stream ends where it meets open water: no ribbon floating on the river
    if (keep === "dry" && ctx.hasWater !== false && Math.max(l0[3], r0[3], l1[3], r1[3]) < 0.1) continue;
    if (keep === "wet" && Math.min(l0[3], r0[3], l1[3], r1[3]) > 0.3) continue;
    l0.length = r0.length = l1.length = r1.length = 3;
    const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    pos.push(...l0, ...l1, ...r1, ...l0, ...r1, ...r0);
    const v0 = run / 5, v1 = (run + seg) / 5;
    uv.push(0, v0, 0, v1, width / 5, v1, 0, v0, width / 5, v1, width / 5, v0);
    run += seg;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  b.add(mat, g);
}

function dock(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const l = num(m.l, 40), w = num(m.w, 30);
  // timber-revetted hard with sheds and a treadwheel crane
  b.box("timber-weathered", l, 4.2, w, 0, -3, 0);
  for (let i = 0; i <= 8; i++) b.box("timber", 0.4, 5, 0.4, l / 2, -3.4, -w / 2 + (i * w) / 8);
  b.box("daub", 12, 3.5, 6, -l * 0.2, 1.2, -w * 0.25);
  b.gable("tile", "daub", 12, 6, 2.6, -l * 0.2, 4.7, -w * 0.25);
  b.box("timber", 3, 4, 3, l / 2 - 3, 1.2, w * 0.2);
  b.pyramid("shingle", 3.6, 3.6, 2, l / 2 - 3, 5.2, w * 0.2);
  b.box("timber", 6, 0.3, 0.3, l / 2 + 0.5, 6.2, w * 0.2);
  void ctx;
}

/** Roman timber quay along the bank, with open-fronted warehouses behind. */
function quay(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const width = num(m.width, 10);
  const r = rng(ctx.seed);
  for (let i = 1; i < ctx.path.length; i++) {
    const [ax, az] = ctx.path[i - 1];
    const [bx, bz] = ctx.path[i];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 12));
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n;
      const x = ax + (bx - ax) * f;
      let z = az + (bz - az) * f;
      // walk south to the water's edge at this phase's representative year
      let guard = 0;
      while (ctx.ground(x, z) > 0.4 && guard++ < 80) z += 2;
      const rot = -Math.atan2(bz - az, bx - ax);
      ctx.trace?.push({ kind: "quay-front", x: x + 2.2 * Math.sin(rot), z: z + 2.2 * Math.cos(rot), rot, len: len / n, width, dir: 1 });
      b.at(x, 0, z, rot, () => {
        b.box("timber", len / n + 0.3, 5.2, width, 0, -3.4, -width / 2 + 2);
        for (let c = 0; c < 4; c++) b.box("timber-weathered", len / n + 0.5, 0.45, 0.5, 0, -0.4 + c * 0.55, 2.2);
        if (m.warehouses && r() > 0.12) {
          const d = 9 + r() * 3;
          b.box("daub", len / n - 0.6, 4, d, 0, 1.8, -width - d / 2 + 1);
          b.gable("tegula", "daub", len / n - 0.4, d, 2.2, 0, 5.8, -width - d / 2 + 1, 0, 0.5);
          b.box("dark", len / n - 3, 2.8, 0.25, 0, 1.8, -width + 1.05);
        }
      });
    }
  }
}

/**
 * Built-up river frontage: a revetment that follows the modelled bank, with
 * wharf surface, mooring posts, river stairs and the odd crane.
 */
function waterfront(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const mat = str(m.wall, "timber-weathered");
  const dir = num(m.side, 1); // +1: river lies to the south of the path (north bank); -1: to the north
  const top = num(m.top, 1.9);
  const r = rng(ctx.seed);
  const pts: [number, number][] = [];
  for (let i = 1; i < ctx.path.length; i++) {
    const [ax, az] = ctx.path[i - 1];
    const [bx, bz] = ctx.path[i];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 7));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n;
      let z = az + ((bz - az) * k) / n;
      let guard = 0;
      // find the waterline: walk towards the river, or back inland if we start in the water
      if (ctx.ground(x, z) > 0.3) while (ctx.ground(x, z) > 0.3 && guard++ < 150) z += dir * 1.5;
      else while (ctx.ground(x, z) <= 0.3 && guard++ < 150) z -= dir * 1.5;
      pts.push([x, z + dir * 2.5]);
    }
  }
  // smooth the line a little so the frontage reads as built, not as a contour
  for (let pass = 0; pass < 2; pass++) for (let i = 1; i < pts.length - 1; i++) pts[i][1] = (pts[i - 1][1] + pts[i][1] * 2 + pts[i + 1][1]) / 4;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    const rot = -Math.atan2(bz - az, bx - ax);
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    ctx.trace?.push({ kind: "revetment", x: mx, z: mz, rot, len, dir, top });
    b.slab(mat, ax, az, bx, bz, -3, top, 0.7);
    // wharf surface behind the revetment
    b.box("gravel", len + 0.4, 0.3, 9, mx - Math.sin(rot) * 4.6 * dir * -1, top - 0.3, mz - Math.cos(rot) * 4.6 * dir, rot);
    b.box(mat, len + 0.4, top + 2.4, 8.6, mx + Math.sin(rot) * 4.6 * dir, -3, mz - Math.cos(rot) * 4.6 * dir, rot);
    if (i % 2 === 0) b.box("timber", 0.35, top + 4, 0.35, ax, -3, az + dir * 0.5);
    const roll = r();
    if (roll < 0.05) {
      // river stairs
      for (let st = 0; st < 6; st++) b.box("ragstone", 2.6, 0.35, 0.8, mx, top - 0.35 * (st + 1), mz + dir * (0.6 + st * 0.8), rot);
    } else if (roll < 0.09 && m.cranes) {
      // treadwheel crane
      b.at(mx, top, mz - dir * 3, rot, () => {
        b.box("timber", 3.2, 4.2, 3.2, 0, 0, 0);
        b.pyramid("shingle", 3.8, 3.8, 2.2, 0, 4.2, 0);
        b.box("timber", 0.3, 0.3, 7, 0, 5.6, dir * 3);
        b.box("timber", 0.08, 4, 0.08, 0, 1.8, dir * 6.3);
      });
    }
  }
}

/** River craft scattered on the water between the path's end points. Positions are illustrative. */
function boats(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const n = num(m.count, 20), spread = num(m.spread, 90), big = num(m.ships, 0.2);
  const r = rng(ctx.seed);
  const [a, c] = [ctx.path[0], ctx.path[ctx.path.length - 1]];
  const along = -Math.atan2(c[1] - a[1], c[0] - a[0]);
  for (let i = 0; i < n * 3 && i < 400; i++) {
    const f = r();
    const px = a[0] + (c[0] - a[0]) * f + (r() - 0.5) * 30, pz = a[1] + (c[1] - a[1]) * f + (r() - 0.5) * 2 * spread;
    const isShip = r() < big;
    const long = m.style === "longship";
    const len = long ? 17 + r() * 6 : isShip ? 13 + r() * 9 : 5.5 + r() * 3;
    const rot = along + (r() < 0.7 ? (r() - 0.5) * 0.5 : r() * Math.PI);
    if (i >= n * 3) break;
    if (ctx.ground(px, pz) > -1.0) continue;
    if (i % 3 !== 0 && r() > 0.34) continue;
    const beam = len / (long ? 5.2 : isShip ? 3.4 : 4.6);
    b.at(px, 0, pz, rot, () => {
      const hull = new THREE.CylinderGeometry(1, 0.62, 1, 12, 1).scale(len / 2, isShip ? 1.9 : 0.75, beam / 2);
      b.add("timber", hull, new THREE.Matrix4().setPosition(0, isShip ? 0.35 : 0.1, 0));
      const well = new THREE.CylinderGeometry(1, 1, 0.1, 12, 1).scale(len / 2 - 0.35, 1, beam / 2 - 0.25);
      b.add("dark", well, new THREE.Matrix4().setPosition(0, isShip ? 1.31 : 0.48, 0));
      if (long) {
        // clinker longship: low hull, raised stem and stern, mast with the sail furled, shields along the rail
        b.box("timber", 0.3, 2.6, 0.3, len / 2 - 0.3, 0.6, 0);
        b.box("timber", 0.3, 2.2, 0.3, -len / 2 + 0.3, 0.6, 0);
        b.box("timber", 0.2, 8, 0.2, 0, 1.0, 0);
        b.box("timber", 0.14, 0.14, beam * 2.4, 0, 7.6, 0);
        b.box("plaster", 0.35, 0.6, beam * 2.1, 0, 7.1, 0);
        for (let k = -4; k <= 4; k++) for (const sd of [1, -1]) b.cyl(k % 2 ? "brick" : "plaster", 0.38, 0.38, 0.08, 8, k * (len / 11), 1.25, sd * (beam / 2 - 0.05));
      } else if (isShip) {
        b.box("timber", 0.22, 9.5, 0.22, len * 0.05, 1.2, 0);
        b.box("timber", 0.14, 0.14, beam * 2.2, len * 0.05, 8.6, 0);
        b.box("plaster", 0.3, 0.55, beam * 2.0, len * 0.05, 8.1, 0); // furled sail
        b.box("timber", len * 0.22, 1.1, beam * 0.8, -len * 0.33, 1.3, 0); // stern castle
      } else {
        for (let t = -1; t <= 1; t++) b.box("timber-weathered", 0.25, 0.08, beam * 0.8, t * len * 0.2, 0.5, 0);
        if (r() > 0.5) b.box("plaster", 0.35, 0.75, 0.35, -len * 0.25, 0.5, 0.15); // a waterman
      }
    });
  }
}


// ---------------------------------------------------------------------------
// Battlefield and countryside kinds. All are authored in world space, so every
// piece sits on the modelled ground. See docs/MODEL-KINDS.md for the params.
// ---------------------------------------------------------------------------

/** A path or ring given in the model (`path`: [lat, lon][]), a named site polygon (`polygon`), or else the landmark's own path. */
function pathOf(m: PhaseModel, ctx: BuildCtx): [number, number][] {
  if (Array.isArray(m.path) && m.path.length) return (m.path as [number, number][]).map(([la, lo]) => ctx.project(la, lo));
  if (typeof m.polygon === "string") {
    const p = ctx.polygon?.(m.polygon);
    if (p && p.length) return p;
  }
  return ctx.path;
}

const cssColor = (v: unknown, d: string): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s) || /^[a-z]+$/i.test(s) ? s : d;
};
const flat = (color: string, opacity = 1): string => (opacity < 1 ? `flat:${color}:${opacity.toFixed(2)}` : `flat:${color}`);
/** Ground height for something laid on the surface: never below the water where there is water. */
const surface = (ctx: BuildCtx, x: number, z: number): number => {
  const g = ctx.ground(x, z);
  return ctx.hasWater === false ? g : Math.max(0, g);
};

/**
 * Two muted, deliberately non-heraldic tints (a rust and a slate teal: neither side's livery), far enough
 * apart in hue and value to tell the lines apart at a distance. Any other faction name gets a stable hue of its own.
 */
const FACTION_COLORS: Record<string, string> = { a: "#b0532a", b: "#2f8796" };
export function factionColor(f: string): string {
  if (FACTION_COLORS[f]) return FACTION_COLORS[f];
  if (/^#[0-9a-f]{6}$/i.test(f)) return f;
  let h = 0;
  for (let i = 0; i < f.length; i++) h = (h * 31 + f.charCodeAt(i)) % 360;
  return "#" + new THREE.Color().setHSL(h / 360, 0.42, 0.34).getHexString();
}

/** Most figures drawn for one block; larger counts are clamped (each figure can stand for many people). */
export const MAX_TROOPS = 2500;

/** One part of a figure template: non-indexed geometry in the figure's own frame (+x forward), drawn in one material. */
interface FigurePart { mat: string; pos: Float32Array; nrm: Float32Array }

function figurePart(mat: string, g: THREE.BufferGeometry, x: number, y: number, z: number): FigurePart {
  const geo = (g.index ? g.toNonIndexed() : g).translate(x, y, z);
  geo.computeVertexNormals();
  return { mat, pos: geo.attributes.position.array as Float32Array, nrm: geo.attributes.normal.array as Float32Array };
}

/**
 * Stamp many copies of a figure template into one geometry per material: much faster than one
 * Builder solid per figure when a block has thousands of figures.
 */
function stampFigures(b: Builder, parts: FigurePart[], spots: { x: number; y: number; z: number; rot: number; tall: number }[]) {
  const byMat = new Map<string, FigurePart[]>();
  for (const p of parts) byMat.set(p.mat, [...(byMat.get(p.mat) ?? []), p]);
  for (const [mat, list] of byMat) {
    const per = list.reduce((n, p) => n + p.pos.length, 0);
    const pos = new Float32Array(per * spots.length);
    const nrm = new Float32Array(per * spots.length);
    let o = 0;
    for (const s of spots) {
      const c = Math.cos(s.rot), sn = Math.sin(s.rot);
      for (const p of list)
        for (let i = 0; i < p.pos.length; i += 3) {
          const px = p.pos[i], py = p.pos[i + 1] * s.tall, pz = p.pos[i + 2];
          pos[o] = s.x + c * px + sn * pz;
          pos[o + 1] = s.y + py;
          pos[o + 2] = s.z - sn * px + c * pz;
          const nx = p.nrm[i], nz = p.nrm[i + 2];
          nrm[o] = c * nx + sn * nz;
          nrm[o + 1] = p.nrm[i + 1];
          nrm[o + 2] = -sn * nx + c * nz;
          o += 3;
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    b.add(mat, g);
  }
}

/**
 * A formation block of abstract figures. Always a conjectural stand-in: the
 * figures have no faces, equipment or heraldry, and one figure need not mean one person.
 */
function troops(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const mounted = !!m.mounted;
  const count = Math.min(MAX_TROOPS, Math.max(1, Math.round(num(m.count, 100))));
  const cols = Math.max(1, Math.min(count, Math.round(num(m.cols, Math.ceil(Math.sqrt(count * 3))))));
  const spacing = Math.max(0.6, num(m.spacing, mounted ? 2.6 : 1.3));
  const depthSpacing = Math.max(0.6, num(m.rankSpacing, spacing * (mounted ? 1.5 : 1)));
  const facing = (num(m.facing, ctx.bearing ?? 0) * Math.PI) / 180;
  const fx = Math.sin(facing), fz = -Math.cos(facing); // forward
  const rx = Math.cos(facing), rz = Math.sin(facing); // to the right of the line
  const rot0 = Math.PI / 2 - facing;
  const tint = factionColor(str(m.faction, "a"));
  const shade = (toward: string, k: number) => flat("#" + new THREE.Color(tint).lerp(new THREE.Color(toward), k).getHexString());
  // heads are a darker shade of the tint (hoods, helmets, hair: nothing specific), so from above the block reads in one colour
  const body = flat(tint), head = shade("#2e2a26", 0.4), horse = flat("#4b3b2d");
  const rows = Math.ceil(count / cols);
  const r = rng(ctx.seed);
  const place = (u: number, v: number): [number, number, number] => {
    const x = ctx.x + rx * u - fx * v, z = ctx.z + rz * u - fz * v;
    return [x, surface(ctx, x, z), z];
  };
  // Figure templates: a tapered body with broad shoulders and a block head, a little bolder than life so a
  // close-packed block reads as a mass from a distance. Riders sit on a plain horse block.
  const parts: FigurePart[] = mounted
    ? [
        figurePart(horse, new THREE.BoxGeometry(1.9, 0.66, 0.56), 0, 1.18, 0),
        figurePart(horse, new THREE.BoxGeometry(0.2, 0.86, 0.48), 0.7, 0.43, 0),
        figurePart(horse, new THREE.BoxGeometry(0.2, 0.86, 0.48), -0.7, 0.43, 0),
        figurePart(horse, new THREE.BoxGeometry(0.36, 0.72, 0.3), 1.02, 1.6, 0),
        figurePart(body, new THREE.CylinderGeometry(0.22, 0.3, 0.78, 6, 1, true), -0.05, 1.84, 0),
        figurePart(body, new THREE.BoxGeometry(0.3, 0.2, 0.62), -0.05, 2.15, 0),
        figurePart(head, new THREE.BoxGeometry(0.28, 0.28, 0.28), -0.05, 2.39, 0),
      ]
    : [
        figurePart(body, new THREE.CylinderGeometry(0.22, 0.31, 1.5, 6, 1, true), 0, 0.75, 0),
        figurePart(body, new THREE.BoxGeometry(0.32, 0.22, 0.64), 0, 1.36, 0),
        figurePart(head, new THREE.BoxGeometry(0.28, 0.3, 0.28), 0, 1.62, 0),
      ];
  const spots: { x: number; y: number; z: number; rot: number; tall: number }[] = [];
  const jitter = spacing * 0.18;
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols), c = i % cols;
    const inRow = Math.min(cols, count - row * cols);
    const u = (c - (inRow - 1) / 2) * spacing + (r() - 0.5) * jitter;
    const v = (row - (rows - 1) / 2) * depthSpacing + (r() - 0.5) * jitter;
    const [x, y, z] = place(u, v);
    spots.push({ x, y: y - 0.05, z, rot: rot0 + (r() - 0.5) * 0.3, tall: 0.95 + r() * 0.1 });
  }
  stampFigures(b, parts, spots);
  // the populace's figure layer (pop/figures.ts) may draw people in these places instead of the blocks above
  const sp = new Float32Array(spots.length * 5);
  spots.forEach((s, i) => sp.set([s.x, s.y, s.z, s.rot, s.tall], i * 5));
  b.meta.troops = { spots: sp, tint, mounted, mats: mounted ? [body, head, horse] : [body, head] };

  // A trampled, shadowed strip of ground under the block, so its outline reads even where the figures are tiny.
  const halfW = ((Math.min(cols, count) - 1) * spacing) / 2 + spacing * 0.9;
  const halfD = ((rows - 1) * depthSpacing) / 2 + depthSpacing * 0.9;
  const corner = (su: number, sv: number): [number, number] => [ctx.x + rx * su * halfW - fx * sv * halfD, ctx.z + rz * su * halfW - fz * sv * halfD];
  drape(b, flat("#5e4e34", 0.5), [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], ctx, 0.3, 6);

  if (m.banner) {
    // plain cloths in a lighter shade of the block's tint, spread along the second rank; no devices are shown
    const n = Math.max(1, Math.min(10, Math.round(count / 200)));
    const width = (Math.min(cols, count) - 1) * spacing;
    const lift = mounted ? 0.9 : 0;
    const cloth = shade("#e8e0cc", 0.3);
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? 0 : -width / 2 + ((k + 0.5) * width) / n;
      const v = (Math.min(1, rows - 1) - (rows - 1) / 2) * depthSpacing + spacing * 0.5;
      const [x, y, z] = place(u, v);
      b.at(x, y, z, rot0, () => {
        b.box("timber", 0.09, 5.6 + lift, 0.09, 0, -0.2, 0);
        b.box(cloth, 0.05, 1.1, 1.6, 0, 4.2 + lift, 0.82);
      });
    }
  }
}

/** Triangulate a ring and lay it over the ground as a mesh fine enough to follow the relief. */
function drape(b: Builder, mat: string, ring: [number, number][], ctx: BuildCtx, lift: number, maxEdge = 14) {
  let pts = ring;
  if (pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.01) pts = pts.slice(0, -1);
  if (pts.length < 3) return;
  const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
  let tris: [number, number][][] = THREE.ShapeUtils.triangulateShape(contour, []).map((t) => t.map((i) => pts[i]));
  if (!tris.length) return;
  const longest = () => tris.reduce((mx, t) => Math.max(mx, Math.hypot(t[0][0] - t[1][0], t[0][1] - t[1][1]), Math.hypot(t[1][0] - t[2][0], t[1][1] - t[2][1]), Math.hypot(t[2][0] - t[0][0], t[2][1] - t[0][1])), 0);
  // split every triangle into four until the edges are short enough to follow the ground (no T-junctions this way)
  while (longest() > maxEdge && tris.length * 4 <= 50000) {
    const next: [number, number][][] = [];
    for (const [p, q, s] of tris) {
      const pq: [number, number] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const qs: [number, number] = [(q[0] + s[0]) / 2, (q[1] + s[1]) / 2];
      const sp: [number, number] = [(s[0] + p[0]) / 2, (s[1] + p[1]) / 2];
      next.push([p, pq, sp], [pq, q, qs], [sp, qs, s], [pq, qs, sp]);
    }
    tris = next;
  }
  const pos: number[] = [];
  for (const t of tris) {
    // wind so the face looks up
    const cross = (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0]);
    for (const [x, z] of cross > 0 ? [t[0], t[2], t[1]] : t) pos.push(x, surface(ctx, x, z) + lift, z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  b.add(mat, g);
}

/** A flat translucent overlay with an outline: "somewhere in this area", never a surveyed boundary. */
function zoneMarker(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const ring = pathOf(m, ctx);
  if (ring.length < 3) return;
  const color = cssColor(m.color, "#e0b040");
  const opacity = Math.min(0.9, Math.max(0.05, num(m.opacity, 0.3)));
  drape(b, flat(color, opacity), ring, ctx, 0.35);
  const closed: [number, number][] = [...ring, ring[0]];
  ribbon(b, flat(color, Math.min(0.99, opacity + 0.5)), ctx, num(m.outline, 1.6), 0.5, ctx.hasWater === false ? -1e9 : 0, closed);
}

/** A few ridge tents and camp fires scattered round the anchor. Numbers and layout are illustrative. */
function camp(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const count = Math.min(200, Math.max(0, Math.round(num(m.count, 8))));
  const radius = Math.max(6, num(m.radius, 12 + Math.sqrt(count) * 7));
  const fires = Math.min(40, Math.max(0, Math.round(num(m.fires, 2))));
  const cloth = flat(cssColor(m.color, "#cdc2a6"));
  const r = rng(ctx.seed);
  const used: [number, number][] = [];
  const spot = (minGap: number): [number, number] | null => {
    for (let tries = 0; tries < 40; tries++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius;
      const x = ctx.x + Math.cos(a) * d, z = ctx.z + Math.sin(a) * d;
      if (used.every(([ux, uz]) => Math.hypot(ux - x, uz - z) >= minGap)) {
        used.push([x, z]);
        return [x, z];
      }
    }
    return null;
  };
  for (let i = 0; i < fires; i++) {
    const p = spot(7);
    if (!p) break;
    b.at(p[0], surface(ctx, p[0], p[1]), p[1], r() * Math.PI, () => {
      b.cyl(flat("#2b2724"), 0.95, 0.95, 0.06, 10, 0, 0.02, 0);
      b.box("timber", 1.1, 0.14, 0.14, 0, 0.08, 0, 0.5);
      b.box("timber", 1.1, 0.14, 0.14, 0, 0.08, 0, -0.6);
      b.cone(flat("#d8742a"), 0.24, 0.55, 6, 0, 0.14, 0);
    });
  }
  for (let i = 0; i < count; i++) {
    const p = spot(5.5);
    if (!p) break;
    const l = 3.0 + r() * 1.2;
    b.at(p[0], surface(ctx, p[0], p[1]), p[1], r() * Math.PI, () => {
      b.gable(cloth, cloth, l, 2.5, 1.9, 0, 0, 0, 0, 0.05);
      for (const s of [1, -1]) b.box("timber", 0.07, 2.05, 0.07, (s * l) / 2, 0, 0);
    });
  }
}

/** A hedge (optionally on a bank) following a path over the ground. */
function hedge(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const path = pathOf(m, ctx);
  const h = num(m.h, 2), width = num(m.width, 1.8);
  const bank = m.bank === true ? 0.8 : num(m.bank, 0);
  const gaps = Math.min(0.9, Math.max(0, num(m.gaps, 0.03)));
  const r = rng(ctx.seed);
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const n = Math.max(1, Math.round(len / 3));
    const rot = -Math.atan2(bz - az, bx - ax);
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n;
      const x = ax + (bx - ax) * f, z = az + (bz - az) * f;
      const g = surface(ctx, x, z);
      if (bank > 0) b.box("earth", len / n + 0.4, bank + 0.6, width + 2.2, x, g - 0.6, z, rot);
      if (h <= 0 || r() < gaps) continue;
      b.box("foliage", len / n + 0.5, h * (0.8 + r() * 0.4) + 0.4, width * (0.8 + r() * 0.4), x, g + bank - 0.4, z, rot);
    }
  }
}

/** Ridge-and-furrow striping inside a ring: thin darker lines for the furrows. The spacing is generic, not surveyed. */
function fieldStrips(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const ring = pathOf(m, ctx);
  if (ring.length < 3) return;
  const pitch = Math.max(3, num(m.pitch, 9));
  const th = (num(m.bearing, ctx.bearing ?? 0) * Math.PI) / 180;
  const dx = Math.sin(th), dz = -Math.cos(th); // along the strips
  const nx = Math.cos(th), nz = Math.sin(th); // across them
  const mat = flat(cssColor(m.color, "#5a5230"), Math.min(0.95, Math.max(0.1, num(m.opacity, 0.5))));
  let sMin = Infinity, sMax = -Infinity, oMin = Infinity, oMax = -Infinity;
  for (const [x, z] of ring) {
    const s = x * dx + z * dz, o = x * nx + z * nz;
    sMin = Math.min(sMin, s); sMax = Math.max(sMax, s); oMin = Math.min(oMin, o); oMax = Math.max(oMax, o);
  }
  const lines = Math.floor((oMax - oMin) / pitch);
  const step = Math.max(6, ((sMax - sMin) * Math.max(1, lines)) / 9000);
  const half = pitch * 0.17;
  const pos: number[] = [];
  const inside = (x: number, z: number) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const vert = (s: number, o: number) => {
    const x = s * dx + o * nx, z = s * dz + o * nz;
    return [x, surface(ctx, x, z) + 0.22, z];
  };
  for (let li = 0; li <= lines; li++) {
    const o = oMin + (li + 0.5) * pitch;
    for (let s = sMin; s < sMax; s += step) {
      const s1 = Math.min(sMax, s + step);
      const mx = ((s + s1) / 2) * dx + o * nx, mz = ((s + s1) / 2) * dz + o * nz;
      if (!inside(mx, mz) || !inside(s * dx + o * nx, s * dz + o * nz) || !inside(s1 * dx + o * nx, s1 * dz + o * nz)) continue;
      const a0 = vert(s, o - half), a1 = vert(s1, o - half), b1 = vert(s1, o + half), b0 = vert(s, o + half);
      pos.push(...a0, ...a1, ...b1, ...a0, ...b1, ...b0);
    }
  }
  if (!pos.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // make every face look up whatever the strip direction
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  if (nrm.getY(0) < 0) {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i += 3) {
      const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
      p.setXYZ(i + 2, x, y, z);
    }
    g.computeVertexNormals();
  }
  b.add(mat, g);
}

/**
 * A shallow crossing. Over open water it is drawn as a band of paler, shallower water with broken gravel
 * bars along the wading line and white riffles where the stream runs over them, not as a solid causeway;
 * on land (or across a `stream` ribbon) the gravel bars lie on top of the ground.
 */
function ford(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const path = pathOf(m, ctx);
  if (path.length < 2) return;
  const width = num(m.width, 8);
  const wet = ctx.hasWater !== false;
  const r = rng(ctx.seed);
  const isWet = (x: number, z: number) => wet && ctx.ground(x, z) < 0.15;
  // shallows: a broad band of paler water either side of the line (only where there is water)
  if (wet) {
    ribbon(b, flat("#6f7254", 0.28), ctx, width * 3.6, 0.03, 0.0, path, "wet");
    ribbon(b, flat("#7b7656", 0.32), ctx, width * 1.9, 0.045, 0.0, path, "wet");
  }
  // on land (and across a stream ribbon) the crossing is a plain trodden gravel track
  ribbon(b, "gravel", ctx, width * 0.8, 0.16, wet ? 0 : -1e9, path, wet ? "dry" : "all");
  const bar = "gravel", wetBar = flat("#696254"), riffle = flat("#e4ebe6", 0.6);
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len; // along the crossing
    const nx = -uz, nz = ux; // across it (along the stream)
    const rot = -Math.atan2(bz - az, bx - ax);
    for (let d = 0; d < len; ) {
      const step = 2.2 + r() * 3.2;
      const cx = ax + ux * (d + step / 2), cz = az + uz * (d + step / 2);
      const water = isWet(cx, cz);
      if (water) {
        // gravel bars just breaking the surface: broken lengths of varying width, mostly wet and dark, a gap now and then
        if (r() > 0.22) {
          const off = (r() - 0.5) * width * 0.3;
          const w = width * (0.4 + r() * 0.45);
          b.box(r() < 0.6 ? wetBar : bar, step * (0.6 + r() * 0.35), 0.06, w, cx + nx * off, 0.02 + r() * 0.05, cz + nz * off, rot + (r() - 0.5) * 0.15);
        }
        // riffles where the stream runs over the bar, roughly parallel to it, on both sides
        for (const side of [1, -1]) {
          if (r() < 0.2) continue;
          const o = side * (width * (0.45 + r() * 0.7));
          b.box(riffle, step * (0.5 + r() * 0.7), 0.03, 0.4 + r() * 0.6, cx + nx * o, 0.06, cz + nz * o, rot + (r() - 0.5) * 0.3);
        }
      }
      d += step;
    }
  }
  if (m.stakes) {
    for (let i = 1; i < path.length; i++) {
      const [ax, az] = path[i - 1];
      const [bx, bz] = path[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const ox = (-(bz - az) / len) * (width / 2 + 1.2), oz = ((bx - ax) / len) * (width / 2 + 1.2);
      for (let d = 1.5; d < len; d += 3) {
        const x = ax + ((bx - ax) * d) / len + ox + (r() - 0.5), z = az + ((bz - az) * d) / len + oz + (r() - 0.5);
        const g = ctx.ground(x, z);
        if (wet && g > 0.3) continue;
        b.box("timber-weathered", 0.2, 1.9 + r() * 0.5, 0.2, x, Math.min(surface(ctx, x, z), g + 1) - 1.1, z, r());
      }
    }
  }
}

export const BUILDERS: Record<string, KindBuilder> = {
  troops,
  "zone-marker": zoneMarker,
  tents: camp,
  camp,
  hedge,
  "field-strips": fieldStrips,
  ford,
  boats,
  waterfront,
  church,
  friary,
  courtyard,
  keep: (b, m) => keep(b, m),
  hall: (b, m) => hall(b, m),
  forum,
  amphitheatre: (b, m) => amphitheatre(b, m),
  wall: wallPath,
  bridge: timberBridge,
  playhouse: (b, m) => playhouse(b, m),
  // each road sits at a slightly different height, so where two meet (a fork, a junction) they do not z-fight
  road: (b, m, ctx) => ribbon(b, "gravel", ctx, num(m.width, 8), 0.12 + (Math.abs(ctx.seed) % 5) * 0.015, 0.4),
  stream: (b, m, ctx) => ribbon(b, "water", ctx, num(m.width, 6), 0.1, 0.15, ctx.path, "dry"),
  dock,
  quay,
};
