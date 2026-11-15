import type { InletGeom } from "@/lib/terrain";

/**
 * The line of a built waterfront (revetments and the wharf behind them), shared by the waterfront builder and the
 * walkers on its wharf so the two always agree.
 *
 * The line follows the bank of the year (`land`: the ground with the dock inlets left out, so the frontage either
 * side of a dock is one line), then is cut where it crosses an open dock inlet: the river revetment stops at the
 * dock's sides, and the dock is lined instead (one side from the mouth to the head, the head, the other side back to
 * the mouth). Every part keeps the water on the same hand as the river frontage, so `dir` still says which way the
 * water lies for each of them.
 */

export type XZ = [number, number];

/** Points every ~7 m along `path`, each walked to the waterline of `land` (+z towards the water when dir = 1), smoothed. */
export function waterfrontLine(path: XZ[], dir: number, land: (x: number, z: number) => number): XZ[] {
  const pts: XZ[] = [];
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 7));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n;
      let z = az + ((bz - az) * k) / n;
      let guard = 0;
      if (land(x, z) > 0.3) while (land(x, z) > 0.3 && guard++ < 150) z += dir * 1.5;
      else while (land(x, z) <= 0.3 && guard++ < 150) z -= dir * 1.5;
      pts.push([x, z + dir * 2.5]);
    }
  }
  for (let pass = 0; pass < 2; pass++) for (let i = 1; i < pts.length - 1; i++) pts[i][1] = (pts[i - 1][1] + pts[i][1] * 2 + pts[i + 1][1]) / 4;
  return pts;
}

export interface FrontSeg {
  a: XZ;
  b: XZ;
  /** "river": the frontage; "side" / "head": the lining of a dock inlet (id in `inlet`). */
  part: "river" | "side" | "head";
  inlet?: string;
}

/** Shortest open dock the frontage is cut for (m from the head to the frontage line). */
const MIN_DOCK = 3;

/**
 * Cut the frontage line at open dock inlets and line the docks. Returns the parts in order along the line, and the
 * runs of river frontage between docks (each a polyline).
 */
export function cutAtInlets(pts: XZ[], inlets: InletGeom[] = []): { segs: FrontSeg[]; runs: XZ[][] } {
  const at = (s: number): XZ => {
    const i = Math.min(pts.length - 2, Math.floor(s));
    const t = s - i;
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
  };
  type Cut = { s0: number; s1: number; walls: FrontSeg[] };
  const cuts: Cut[] = [];
  for (const q of inlets) {
    const ex = -q.uz, ez = q.ux; // across the inlet
    const along = (p: XZ) => (p[0] - q.x) * q.ux + (p[1] - q.z) * q.uz;
    const across = (p: XZ) => (p[0] - q.x) * ex + (p[1] - q.z) * ez;
    const cross = (c: number): { s: number; m: number } | null => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const a0 = across(pts[i]) - c, a1 = across(pts[i + 1]) - c;
        if (a0 === a1 || a0 * a1 > 0) continue;
        const s = i + a0 / (a0 - a1);
        const m = along(at(s));
        if (m >= MIN_DOCK && m <= q.length) return { s, m };
      }
      return null;
    };
    const p = cross(q.half), n = cross(-q.half);
    if (!p || !n) continue;
    const [first, firstC, second, secondC] = p.s < n.s ? [p, q.half, n, -q.half] : [n, -q.half, p, q.half];
    const corner = (c: number, m: number): XZ => [q.x + q.ux * m + ex * c, q.z + q.uz * m + ez * c];
    const walls: FrontSeg[] = [
      { a: corner(firstC, first.m), b: corner(firstC, 0), part: "side", inlet: q.id },
      { a: corner(firstC, 0), b: corner(secondC, 0), part: "head", inlet: q.id },
      { a: corner(secondC, 0), b: corner(secondC, second.m), part: "side", inlet: q.id },
    ];
    cuts.push({ s0: first.s, s1: second.s, walls });
  }
  cuts.sort((a, b) => a.s0 - b.s0);
  const segs: FrontSeg[] = [];
  const runs: XZ[][] = [];
  let run: XZ[] = [];
  let s = 0;
  const river = (s0: number, s1: number) => {
    // the frontage from s0 to s1, split at the original points; a stub left at a dock's corner (under 3 m) is
    // folded into its neighbour, so no short piece of frontage stands across the dock's edge
    const part: FrontSeg[] = [];
    let cur = s0;
    while (cur < s1 - 1e-6) {
      const next = Math.min(s1, Math.floor(cur) + 1);
      const a = at(cur), b = at(next);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.3) part.push({ a, b, part: "river" });
      cur = next;
    }
    const len = (q: FrontSeg) => Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]);
    if (part.length > 1 && len(part[0]) < 3) { part[1].a = part[0].a; part.shift(); }
    if (part.length > 1 && len(part[part.length - 1]) < 3) { part[part.length - 2].b = part[part.length - 1].b; part.pop(); }
    for (const q of part) {
      segs.push(q);
      if (!run.length) run.push(q.a);
      run.push(q.b);
    }
  };
  // the wharf behind the frontage stops short of a dock's side (walkers on it keep off the dock's edge)
  const trim = (r: XZ[], atStart: boolean, d: number): XZ[] => {
    const o = atStart ? r : [...r].reverse();
    let left = d;
    while (o.length > 1) {
      const l = Math.hypot(o[1][0] - o[0][0], o[1][1] - o[0][1]);
      if (l > left) { o[0] = [o[0][0] + ((o[1][0] - o[0][0]) * left) / l, o[0][1] + ((o[1][1] - o[0][1]) * left) / l]; break; }
      left -= l;
      o.shift();
    }
    return atStart ? o : o.reverse();
  };
  let afterDock = false;
  const close = (beforeDock: boolean) => {
    let r = run;
    if (afterDock) r = trim(r, true, DOCK_CLEAR);
    if (beforeDock) r = trim(r, false, DOCK_CLEAR);
    if (r.length > 1 && Math.hypot(r[r.length - 1][0] - r[0][0], r[r.length - 1][1] - r[0][1]) > 1) runs.push(r);
    run = [];
  };
  for (const c of cuts) {
    if (c.s0 < s) continue; // overlapping docks: keep the first
    river(s, c.s0);
    close(true);
    afterDock = true;
    segs.push(...c.walls);
    s = c.s1;
  }
  river(s, pts.length - 1);
  close(false);
  return { segs, runs };
}

/** How far the wharf's walkers keep from a dock's side (m along the frontage). */
const DOCK_CLEAR = 4;
