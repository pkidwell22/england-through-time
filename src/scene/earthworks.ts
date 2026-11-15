import * as THREE from "three";
import type { PhaseModel } from "@/lib/types";
import { rng } from "@/lib/geo";
import { Builder } from "./geom";
import { BUILDERS, CORRIDOR_KINDS, FLAT_KINDS, WORLD_SPACE_KINDS, type BuildCtx, type KindBuilder } from "./builders";
import { STYLES } from "./houses";
import { tileOf } from "./materials";

/**
 * Prehistoric earthwork and timber kinds, and the Neolithic house fabric styles.
 * Everything is authored in world space (all kinds are in WORLD_SPACE_KINDS) and sits on `ctx.ground`.
 * Earthworks are smooth lofted meshes (cosine cross-sections, rounded ends, slight irregularity) draped on the
 * terrain; ditches themselves are carved into the terrain by narrow `valleys` in site.json, and the models lay a
 * thin lining over the ditch footprint and build the banks on top of the ground.
 *
 * COMMON PARAMS (metres, all optional)
 *   surface  "chalk" | "weathering" | "turf"   default "turf".
 *            chalk = freshly dug white chalk rubble (`chalk`, rough rubble relief); weathering = chalk with patchy turf
 *            (`chalk`/`turf-sparse`/`turf`); turf = grassed over (`turf` with a few `turf-sparse` bald patches).
 *   path     [[lat, lon], ...] in the model, else `polygon` (a named site polygon, rings), else the landmark path.
 *
 * KINDS
 * henge  Ring ditch with bank(s), centred on the landmark anchor.
 *   r 55            ditch centreline radius (circle).        rx, rz, bearing  ellipse: rx = semi-axis along `bearing`
 *                   (degrees clockwise from north, default 90), rz = the other; r is the default for both.
 *   ditchW 5        ditch width (the lining covers ditchW + ~1 m).
 *   bank "inner" | "outer" | "none"  [inner]      bankW 6   bankH 1.8   bankGap 0.5 (berm between ditch edge and bank)
 *   counterscarp    {w, h} or true ({2.5, 0.5}) or false: small outer bank beyond the ditch (ignored when bank = "outer").
 *   gaps            [[azFrom, azTo], ...] entrances, azimuths clockwise from north FROM the centre; no ditch lining and no
 *                   bank there (bank ends are rounded).
 *   segments        N: the ditch was dug as a chain of N segments with short causeways between (lining only; the causeway
 *                   is a plug of surface material filling the carved ditch). 0 = continuous.
 *   lining true     drape the ditch footprint with the surface material.
 * pit-ring  Ring of pits / postholes (Aubrey Holes).
 *   r 43.3, count 56, pitR 0.5, from 0 / to 360 (azimuth arc; full circle spaces the pits 360/count apart, a partial arc
 *   puts the first at `from` and the last at `to`), skip [indices], jitter 0.1 (m), depth 0.9 (visual darkness only),
 *   filled false: false = open pit (white chalk rim, dark interior); true = just a disc of `turf-sparse` (a filled hole).
 *   The rim is chalk unless surface = "turf" (then turf-sparse).
 * timber-circle  Concentric rings of upright posts.
 *   rings [{ r | rx+rz, count, d, h, from?, to?, phase? (azimuth of the first post, default 0), hVar? 0.06, bearing? }],
 *   bearing 90 (the major axis of oval rings), material "timber-weathered", jitter 0.1. Posts are rough 6-8 sided logs with
 *   tapered tops, slight lean, sunk 0.5 m. `lintels` is deliberately NOT supported (conjectural).
 * palisade  Close-set posts along a path (or ring if closed).   h 3, d 0.35, gap 0.05, closed false, material.
 * banked-avenue  Two parallel banks with an external ditch lining each (Stonehenge Avenue, the cursuses).
 *   width 21 (between bank crests), bankW 4, bankH 0.8, ditchW 3, berm 0.4, closed false, smooth 40 (bend radius used
 *   to round corners), lining true.  closed:true wraps the banks round both ends into one banked enclosure (terminals).
 * barrow  Round barrow anchored at the landmark.   form "bowl"|"bell"|"disc"|"saucer"|"pond" [bowl], d 20 (mound diameter),
 *   h 1.8, ditch (default true; false for pond), ditchW 3, berm (gap mound-ditch; bell 4, disc 1.5, others 1),
 *   bankOuter true | {w,h} (outer bank beyond the ditch; default for disc and saucer {3, 0.6}).
 *   disc: flat platform of diameter d with a tiny central tump (d 3, h 0.4), ditch, outer bank.
 *   pond: hollow of diameter d inside a low bank (width 3, height h default 0.5); the carved ground is not lowered by
 *   the model, so the hollow reads by its raised rim.   `surface`.
 * barrow-group  A cemetery in one landmark: barrows [{ lat, lon | x, z (relative to the anchor), form, d, h, surface?, ... }]
 *   (each entry takes the barrow params above; group-level `surface`, `d`, `h` are the defaults).
 * long-barrow  Anchored at its centre, long axis along `bearing` (param, else the landmark bearing).   l 50, w 20 (wide end,
 *   at the forward end of the bearing), w2 12 (narrow end), h 2.5 (wide end; the narrow end is 65% of that),
 *   ditchW 5, berm 1 (two side ditches parallel to the long sides, open at the ends), surface.
 * rampart  Hillfort bank with an external ditch lining round a closed ring.   path | polygon | landmark path (the crest line),
 *   bankW 8, bankH 2.5, ditchW 6, berm 1, gaps [indices of ring segments (vertex i to i+1) left open], smooth 12.
 * turf  Drape a ring (path / polygon / landmark path) with `material` ("turf") lifted `lift` 0.04 m, edges <= `maxEdge` 6 m.
 *   tufts: density per m2 of small crossed-blade grass/weed tufts (cap 20 000 tufts; 0 = none). Also in FLAT_KINDS.
 *
 * FABRIC STYLES (STYLES, houses.ts): "neolithic-house" (Durrington Walls, c. 2500 BCE) and "neolithic-house-large".
 */

type P2 = [number, number];
const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const smooth01 = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const D2R = Math.PI / 180;

// ---------------------------------------------------------------------------------------------------------------
// noise
// ---------------------------------------------------------------------------------------------------------------
function hash2i(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in 0..1. */
function vnoise(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2i(ix, iz, seed), b = hash2i(ix + 1, iz, seed), c = hash2i(ix, iz + 1, seed), d = hash2i(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
/** Signed 1-D smooth noise in -1..1. */
const sn1 = (x: number, seed: number): number => vnoise(x, 0.37, seed) * 2 - 1;

// ---------------------------------------------------------------------------------------------------------------
// params
// ---------------------------------------------------------------------------------------------------------------
type Surface = "chalk" | "weathering" | "turf";
const surfaceOf = (m: Record<string, unknown>, def: Surface = "turf"): Surface => (m.surface === "chalk" || m.surface === "weathering" || m.surface === "turf" ? m.surface : def);

/** Which scanned material a surface triangle gets (by position, so patches are coherent). */
function picker(surface: Surface, seed: number): (x: number, z: number) => string {
  return (x, z) => {
    if (surface === "chalk") return "chalk";
    if (surface === "turf") return vnoise(x / 4, z / 4, seed + 3) > 0.88 ? TURF_SPARSE : TURF;
    const n = vnoise(x / 9, z / 9, seed + 7) * 0.65 + vnoise(x / 3.4, z / 3.4, seed + 11) * 0.35;
    // chalk showing through, a narrow ragged fringe of bald turf, then grass
    return n < 0.47 ? "chalk" : n < 0.5 ? TURF_SPARSE : TURF;
  };
}
/** Rubble relief amplitude (m) of a surface state. */
const roughOf = (s: Surface): number => (s === "chalk" ? 0.2 : s === "weathering" ? 0.12 : 0.04);

function pathOf(m: PhaseModel, ctx: BuildCtx): P2[] {
  if (Array.isArray(m.path) && m.path.length) return (m.path as [number, number][]).map(([la, lo]) => ctx.project(la, lo));
  if (typeof m.polygon === "string") {
    const p = ctx.polygon?.(m.polygon);
    if (p && p.length) return p;
  }
  return ctx.path;
}

// ---------------------------------------------------------------------------------------------------------------
// polylines
// ---------------------------------------------------------------------------------------------------------------
interface Poly {
  pts: P2[];
  /** cum[i] = arc length at pts[i]; for closed polys cum has n + 1 entries (the last = len). */
  cum: number[];
  len: number;
  closed: boolean;
}

function signedArea(p: P2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return a / 2;
}

/** Round the corners of a polyline with quadratic Béziers of (about) radius `rc`. */
function fillet(p: P2[], closed: boolean, rc: number): P2[] {
  const n = p.length;
  if (n < 3 || rc <= 0) return p;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const c = p[i];
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(c);
      continue;
    }
    const a = p[(i - 1 + n) % n], d = p[(i + 1) % n];
    const ux = a[0] - c[0], uz = a[1] - c[1], vx = d[0] - c[0], vz = d[1] - c[1];
    const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
    if (lu < 1e-6 || lv < 1e-6) continue;
    const turn = Math.PI - Math.acos(clamp((ux * vx + uz * vz) / (lu * lv), -1, 1));
    if (turn < 0.05) {
      out.push(c);
      continue;
    }
    const dd = Math.min(rc * Math.tan(turn / 2), lu * 0.5, lv * 0.5);
    const e1: P2 = [c[0] + (ux / lu) * dd, c[1] + (uz / lu) * dd];
    const e2: P2 = [c[0] + (vx / lv) * dd, c[1] + (vz / lv) * dd];
    const K = Math.max(3, Math.ceil(turn / 0.22));
    for (let k = 0; k <= K; k++) {
      const t = k / K, s = 1 - t;
      out.push([s * s * e1[0] + 2 * s * t * c[0] + t * t * e2[0], s * s * e1[1] + 2 * s * t * c[1] + t * t * e2[1]]);
    }
  }
  return out;
}

/** Closed polys are oriented so that the right-hand normal (tz, -tx) points outward. */
function mkPoly(raw: P2[], closed: boolean, rc = 0): Poly {
  let pts = raw.filter((p, i) => i === 0 || Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]) > 0.01);
  if (closed && pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.01) pts = pts.slice(0, -1);
  if (closed && signedArea(pts) < 0) pts = pts.slice().reverse();
  if (rc > 0) pts = fillet(pts, closed, rc);
  const cum = [0];
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) cum.push(cum[i] + Math.hypot(pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]));
  return { pts, cum, len: cum[cum.length - 1], closed };
}

function posAt(poly: Poly, s: number): P2 {
  const n = poly.pts.length;
  if (poly.closed) s = ((s % poly.len) + poly.len) % poly.len;
  else s = clamp(s, 0, poly.len);
  let lo = 0, hi = poly.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (poly.cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const a = poly.pts[lo % n], b = poly.pts[(lo + 1) % n];
  const seg = poly.cum[lo + 1] - poly.cum[lo] || 1;
  const f = (s - poly.cum[lo]) / seg;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

interface Frame {
  x: number;
  z: number;
  tx: number;
  tz: number;
  /** Signed curvature (positive: the centre of curvature lies opposite the normal (tz, -tx)). */
  k: number;
}
function frameAt(poly: Poly, s: number): Frame {
  const d = Math.min(1.2, poly.len / 40);
  const p = posAt(poly, s), a = posAt(poly, s - d), b = posAt(poly, s + d);
  let tx = b[0] - a[0], tz = b[1] - a[1];
  const l = Math.hypot(tx, tz) || 1;
  tx /= l;
  tz /= l;
  const d2 = Math.min(2.5, poly.len / 30);
  const a2 = posAt(poly, s - d2), b2 = posAt(poly, s + d2);
  const t1x = p[0] - a2[0], t1z = p[1] - a2[1], t2x = b2[0] - p[0], t2z = b2[1] - p[1];
  const l1 = Math.hypot(t1x, t1z), l2 = Math.hypot(t2x, t2z);
  const k = l1 > 1e-6 && l2 > 1e-6 ? (t1x * t2z - t1z * t2x) / (l1 * l2) / d2 : 0;
  return { x: p[0], z: p[1], tx, tz, k };
}

interface Run {
  c: number;
  s0: number;
  s1: number;
  whole: boolean;
}
/** Split a closed poly into runs of equal class (sampled every ~ds along it). s1 may exceed len when a run wraps. */
function classRuns(poly: Poly, ds: number, cls: (x: number, z: number, s: number) => number): Run[] {
  const n = Math.max(8, Math.round(poly.len / ds));
  const dA = poly.len / n;
  const cs: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * dA;
    const q = posAt(poly, s);
    cs.push(cls(q[0], q[1], s));
  }
  if (cs.every((c) => c === cs[0])) return [{ c: cs[0], s0: 0, s1: poly.len, whole: true }];
  let k = 0;
  for (let i = 0; i < n; i++)
    if (cs[i] !== cs[(i - 1 + n) % n]) {
      k = i;
      break;
    }
  const runs: Run[] = [];
  let i = 0;
  while (i < n) {
    const c = cs[(k + i) % n];
    let j = i;
    while (j + 1 < n && cs[(k + j + 1) % n] === c) j++;
    runs.push({ c, s0: (k + i) * dA, s1: (k + j + 1) * dA, whole: false });
    i = j + 1;
  }
  return runs;
}

// ---------------------------------------------------------------------------------------------------------------
// grid meshes draped on the ground
// ---------------------------------------------------------------------------------------------------------------
/** Ground for something laid in a carved ditch: the terrain mesh is coarser than the carving, so lift over concavities. */
function groundMesh(ctx: BuildCtx, x: number, z: number): number {
  const g = ctx.ground(x, z);
  const e = 2;
  const d = e * 0.75;
  const c1 = (ctx.ground(x + e, z) + ctx.ground(x - e, z)) / 2 - g;
  const c2 = (ctx.ground(x, z + e) + ctx.ground(x, z - e)) / 2 - g;
  const c3 = (ctx.ground(x + d, z + d) + ctx.ground(x - d, z - d)) / 2 - g;
  const c4 = (ctx.ground(x + d, z - d) + ctx.ground(x - d, z + d)) / 2 - g;
  return g + Math.max(0, c1, c2, c3 * 1.3, c4 * 1.3) * 1.1;
}

/**
 * Tints. The scanned `chalk` reads grey under the site light: a translucent white coat (the `flat:` overlay path:
 * polygonOffset, no depth write) laid over the same triangles brings it to the white of freshly dug chalk without
 * losing the rubble texture. `turf` / `turf-sparse` carry a terrain-matched tint in data/assets.json.
 */
const COATS: Record<string, string> = { chalk: "flat:#fffdf4:0.16" };
const TURF = "turf";
const TURF_SPARSE = "turf-sparse";
/** Maps the documented material names onto the tinted scan entries. */
const tinted = (name: string): string => (name === "turf" ? TURF : name === "turf-sparse" ? TURF_SPARSE : name);

class Mesh {
  pos: number[] = [];
  idx: number[] = [];

  /** Rows run along a tangent t, columns along the right-hand normal (tz, -tx): then (i,j),(i+1,j),(i,j+1) faces up. */
  grid(nR: number, nC: number, closedR: boolean, f: (i: number, j: number) => [number, number, number]): void {
    const base = this.pos.length / 3;
    for (let i = 0; i < nR; i++)
      for (let j = 0; j < nC; j++) {
        const p = f(i, j);
        this.pos.push(p[0], p[1], p[2]);
      }
    const rows = closedR ? nR : nR - 1;
    for (let i = 0; i < rows; i++) {
      const i2 = (i + 1) % nR;
      for (let j = 0; j < nC - 1; j++) {
        const a = base + i * nC + j, b = base + i2 * nC + j, c = a + 1, d = b + 1;
        this.idx.push(a, b, c, b, d, c);
      }
    }
  }

  emit(b: Builder, pick: (x: number, z: number) => string): void {
    if (!this.idx.length) return;
    const n = this.pos.length / 3;
    const posA = new Float32Array(this.pos);
    const g0 = new THREE.BufferGeometry();
    g0.setAttribute("position", new THREE.BufferAttribute(posA, 3));
    g0.setIndex(this.idx);
    g0.computeVertexNormals();
    const nor = g0.getAttribute("normal") as THREE.BufferAttribute;
    const groups = new Map<string, number[]>();
    for (let t = 0; t < this.idx.length; t += 3) {
      const a = this.idx[t], c = this.idx[t + 1], d = this.idx[t + 2];
      const cx = (posA[a * 3] + posA[c * 3] + posA[d * 3]) / 3;
      const cz = (posA[a * 3 + 2] + posA[c * 3 + 2] + posA[d * 3 + 2]) / 3;
      const mat = pick(cx, cz);
      let l = groups.get(mat);
      if (!l) groups.set(mat, (l = []));
      l.push(a, c, d);
    }
    for (const [mat, ids] of groups) {
      const tile = mat.startsWith("flat:") ? 4 : tileOf(mat);
      const uv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        uv[i * 2] = posA[i * 3] / tile;
        uv[i * 2 + 1] = posA[i * 3 + 2] / tile;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(posA, 3));
      g.setAttribute("normal", nor);
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setIndex(ids);
      b.add(mat, g);
      // the scanned chalk reads grey under the site light: a thin translucent white coat (same triangles) brings it to
      // the white of freshly dug chalk without losing the rubble texture
      if (COATS[mat]) b.add(COATS[mat], g);
    }
    g0.dispose();
  }
}

const oddCols = (width: number, step: number, min: number): number => {
  const n = Math.max(min, Math.ceil(width / step) + 1);
  return n % 2 ? n : n + 1;
};

interface StripOpt {
  s0?: number;
  s1?: number;
  /** Centre offset across the strip (m, + = right-hand normal; outward on closed polys); may vary along. */
  c: number | ((s: number) => number);
  /** Half width (m). */
  hw: number | ((s: number) => number);
  nC: number;
  /** Height above the ground at cross position v in -1..1. */
  prof?: (v: number, s: number, x: number, z: number) => number;
  /** Semicircular end cap radius (m) of open strips (0 = square end). */
  cap?: number;
  ds: number;
  lift?: number;
  concave?: boolean;
}

function strip(M: Mesh, ctx: BuildCtx, poly: Poly, o: StripOpt): void {
  const lift = o.lift ?? 0.03;
  const cf = typeof o.c === "function" ? o.c : () => o.c as number;
  const hf = typeof o.hw === "function" ? o.hw : () => o.hw as number;
  const rows: { s: number; taper: number }[] = [];
  let closedR = false;
  if (poly.closed && o.s0 === undefined) {
    const n = Math.max(8, Math.round(poly.len / o.ds));
    for (let i = 0; i < n; i++) rows.push({ s: (i * poly.len) / n, taper: 1 });
    closedR = true;
  } else {
    const a = o.s0 ?? 0;
    let e = o.s1 ?? poly.len;
    if (e <= a) e += poly.len;
    const L = e - a;
    if (L < 0.3) return;
    const cr = Math.min(o.cap ?? 0, L / 2 - 0.01);
    const K = cr > 0.2 ? 6 : 0;
    const interior = Math.max(1, Math.round((L - 2 * cr) / o.ds));
    if (K > 0) {
      for (let k = 0; k <= K; k++) {
        const ph = (Math.PI / 2) * (k / K);
        rows.push({ s: a + cr * (1 - Math.cos(ph)), taper: Math.max(0.04, Math.sin(ph)) });
      }
      for (let i = 1; i < interior; i++) rows.push({ s: a + cr + (i * (L - 2 * cr)) / interior, taper: 1 });
      for (let k = K; k >= 0; k--) {
        const ph = (Math.PI / 2) * (k / K);
        rows.push({ s: e - cr * (1 - Math.cos(ph)), taper: Math.max(0.04, Math.sin(ph)) });
      }
    } else {
      for (let i = 0; i <= interior; i++) rows.push({ s: a + (i * L) / interior, taper: 1 });
    }
  }
  if (rows.length < 2) return;
  const fr = rows.map((r) => ({ ...frameAt(poly, r.s), s: r.s, taper: r.taper }));
  const nC = o.nC;
  M.grid(fr.length, nC, closedR, (i, j) => {
    const f = fr[i];
    const v = -1 + (2 * j) / (nC - 1);
    let u = cf(f.s) + v * hf(f.s) * f.taper;
    // inner side of a tight bend: do not fold over the centre of curvature
    if (f.k > 1e-4 && u < 0) u = Math.max(u, -0.85 / f.k);
    else if (f.k < -1e-4 && u > 0) u = Math.min(u, 0.85 / -f.k);
    const x = f.x + f.tz * u, z = f.z - f.tx * u;
    const g = o.concave ? groundMesh(ctx, x, z) : ctx.ground(x, z);
    const h = o.prof ? o.prof(v, f.s, x, z) * f.taper : 0;
    return [x, g + h + lift, z];
  });
}

interface PolarOpt {
  /** Radii of the rings (ascending). */
  stations: number[];
  nA: number;
  /** Outline irregularity: radius scale at angle th. */
  rs?: (th: number) => number;
  prof?: (r: number, th: number, x: number, z: number) => number;
  lift?: number;
  concave?: boolean;
}
function polar(M: Mesh, ctx: BuildCtx, cx: number, cz: number, o: PolarOpt): void {
  const lift = o.lift ?? 0.03;
  const st = o.stations;
  M.grid(o.nA, st.length, true, (i, j) => {
    const th = (2 * Math.PI * i) / o.nA;
    const r = st[j];
    const rr = r * (o.rs ? o.rs(th) : 1);
    const x = cx + Math.cos(th) * rr, z = cz + Math.sin(th) * rr;
    const g = o.concave ? groundMesh(ctx, x, z) : ctx.ground(x, z);
    return [x, g + (o.prof ? o.prof(r, th, x, z) : 0) + lift, z];
  });
}
const linSt = (r0: number, r1: number, step: number, min = 2): number[] => {
  const n = Math.max(min, Math.ceil((r1 - r0) / step));
  return Array.from({ length: n + 1 }, (_, i) => r0 + ((r1 - r0) * i) / n);
};

/** Bank cross-section: 1 at the crest, 0 at the edges, smooth. */
const cosine = (v: number): number => 0.5 + 0.5 * Math.cos(Math.PI * clamp(v, -1, 1));

/** Bank height function with slight irregularity along its length and rubble relief. */
function bankProf(H: number, seed: number, rough: number, shape = 1): (v: number, s: number, x: number, z: number) => number {
  return (v, s, x, z) => {
    const w = Math.pow(cosine(v), shape);
    const hs = 1 + 0.12 * sn1(s * 0.05, seed) + 0.06 * sn1(s * 0.21, seed + 5);
    let h = H * hs * w;
    if (rough > 0) {
      const e = Math.min(1, cosine(v) * 3);
      h += rough * (vnoise(x * 0.9, z * 0.9, seed) - 0.5 + 0.5 * (vnoise(x * 2.7, z * 2.7, seed + 1) - 0.5)) * e;
    }
    return Math.max(0, h);
  };
}

const azOf = (dx: number, dz: number): number => (((Math.atan2(dx, -dz) / D2R) % 360) + 360) % 360;
const inArc = (az: number, a: number, b: number): boolean => {
  a = ((a % 360) + 360) % 360;
  b = ((b % 360) + 360) % 360;
  return a <= b ? az >= a && az <= b : az >= a || az <= b;
};
const parseGaps = (v: unknown): [number, number][] =>
  Array.isArray(v) ? (v as unknown[]).filter((g): g is [number, number] => Array.isArray(g) && g.length >= 2 && typeof g[0] === "number" && typeof g[1] === "number") : [];

/** Point on an oval (rx along `bearing`, rz across) at azimuth `az` (clockwise from north) from the centre. */
function ovalPoint(rx: number, rz: number, bearing: number, az: number): P2 {
  const dx = Math.sin(az * D2R), dz = -Math.cos(az * D2R);
  const b = bearing * D2R;
  const a = dx * Math.sin(b) + dz * -Math.cos(b);
  const c = dx * Math.cos(b) + dz * Math.sin(b);
  const rho = 1 / Math.sqrt((a / rx) ** 2 + (c / rz) ** 2);
  return [dx * rho, dz * rho];
}
function ringPoly(cx: number, cz: number, rx: number, rz: number, bearing: number): Poly {
  const per = 2 * Math.PI * Math.sqrt((rx * rx + rz * rz) / 2);
  const n = clamp(Math.round(per / 1.4), 120, 1400);
  const pts: P2[] = [];
  for (let i = 0; i < n; i++) {
    const p = ovalPoint(rx, rz, bearing, (360 * i) / n);
    pts.push([cx + p[0], cz + p[1]]);
  }
  return mkPoly(pts, true);
}

// ---------------------------------------------------------------------------------------------------------------
// henge
// ---------------------------------------------------------------------------------------------------------------
function henge(b: Builder, m: PhaseModel, ctx: BuildCtx): void {
  const surface = surfaceOf(m);
  const r = num(m.r, 55), rx = num(m.rx, r), rz = num(m.rz, r), bearing = num(m.bearing, 90);
  const ditchW = num(m.ditchW, 5), bankW = num(m.bankW, 6), bankH = num(m.bankH, 1.8), gap = num(m.bankGap, 0.5);
  const bankMode = m.bank === "outer" || m.bank === "none" ? m.bank : "inner";
  const gaps = parseGaps(m.gaps);
  const segs = Math.max(0, Math.round(num(m.segments, 0)));
  const rough = roughOf(surface);
  const seed = ctx.seed;
  const poly = ringPoly(ctx.x, ctx.z, rx, rz, bearing);
  const ds = clamp(poly.len / 500, 0.8, 2.5);
  const inGap = (x: number, z: number): boolean => gaps.length > 0 && gaps.some((g) => inArc(azOf(x - ctx.x, z - ctx.z), g[0], g[1]));
  const M = new Mesh();
  const lw = Math.min(0.8, Math.max(0.25, gap));
  const hwDitch = ditchW / 2 + lw;

  // ditch lining (and causeways between segments)
  if (m.lining !== false && ditchW > 0) {
    const segLen = segs > 0 ? poly.len / segs : 0;
    const cwH = segs > 0 ? clamp(segLen * 0.06, 1.5, 3) : 0;
    const cls = (x: number, z: number, s: number): number => {
      if (inGap(x, z)) return 0;
      if (segs > 0 && Math.abs(((s + segLen / 2) % segLen) - segLen / 2) < cwH) return 2;
      return 1;
    };
    const nC = oddCols(hwDitch * 2, 0.5, 7);
    for (const run of classRuns(poly, Math.min(ds, 1), cls)) {
      if (run.c === 0) continue;
      if (run.c === 1) {
        strip(M, ctx, poly, { s0: run.whole ? undefined : run.s0, s1: run.s1, c: 0, hw: hwDitch, nC, ds, lift: 0.05, concave: true });
      } else {
        // causeway: a plug of surface material filling the carved ditch up to the level of the ground beyond it
        const hwPlug = hwDitch + 2.2;
        const shelf = new Map<number, number>();
        const level = (s: number): number => {
          const key = Math.round(s * 4);
          let v = shelf.get(key);
          if (v === undefined) {
            const f = frameAt(poly, s);
            const gl = groundMesh(ctx, f.x + f.tz * hwPlug, f.z - f.tx * hwPlug);
            const gr = groundMesh(ctx, f.x - f.tz * hwPlug, f.z + f.tx * hwPlug);
            v = (gl + gr) / 2;
            shelf.set(key, v);
          }
          return v;
        };
        strip(M, ctx, poly, {
          s0: run.s0, s1: run.s1, c: 0, hw: hwPlug, nC: oddCols(hwPlug * 2, 0.6, 9), ds: 0.8, lift: 0.06,
          prof: (_v, s, x, z) => Math.max(0, level(s) - ctx.ground(x, z)) * smooth01(0, 1.0, Math.min(s - run.s0, run.s1 - s)),
        });
      }
    }
  }

  // banks
  const bank = (c0: number, w: number, h: number, sd: number, rf: number): void => {
    const nC = oddCols(w, 0.5, 9);
    for (const run of classRuns(poly, ds, (x, z) => (inGap(x, z) ? 0 : 1))) {
      if (run.c === 0) continue;
      strip(M, ctx, poly, {
        s0: run.whole ? undefined : run.s0, s1: run.s1,
        c: (s) => c0 + 0.25 * sn1(s * 0.04, sd + 9),
        hw: (s) => (w / 2) * (1 + 0.07 * sn1(s * 0.03, sd + 3)),
        nC, cap: w / 2, ds, lift: 0.03, prof: bankProf(h, sd, rf),
      });
    }
  };
  if (bankMode !== "none" && bankH > 0) bank((bankMode === "outer" ? 1 : -1) * (ditchW / 2 + gap + bankW / 2), bankW, bankH, seed, rough);
  const cs = m.counterscarp;
  if (cs && bankMode !== "outer") {
    const w = typeof cs === "object" ? num((cs as Record<string, unknown>).w, 2.5) : 2.5;
    const h = typeof cs === "object" ? num((cs as Record<string, unknown>).h, 0.5) : 0.5;
    bank(ditchW / 2 + 0.4 + w / 2, w, h, seed + 40, rough * 0.7);
  }
  M.emit(b, picker(surface, seed));
}

// ---------------------------------------------------------------------------------------------------------------
// pit-ring
// ---------------------------------------------------------------------------------------------------------------
function pitRing(b: Builder, m: PhaseModel, ctx: BuildCtx): void {
  const surface = surfaceOf(m);
  const r = num(m.r, 43.3), count = Math.max(1, Math.round(num(m.count, 56))), pitR = num(m.pitR, 0.5);
  const from = num(m.from, 0), to = num(m.to, 360), jit = num(m.jitter, 0.1), depth = num(m.depth, 0.9);
  const filled = m.filled === true;
  const skip = new Set(Array.isArray(m.skip) ? (m.skip as number[]) : []);
  const rnd = rng(ctx.seed + 31);
  const full = to - from >= 359.9;
  const rim = new Mesh(), floor = new Mesh();
  for (let i = 0; i < count; i++) {
    if (skip.has(i)) continue;
    const az = from + (count > 1 ? ((to - from) * i) / (full ? count : count - 1) : 0);
    const rr = r + (rnd() - 0.5) * 2 * jit;
    const a = (az + ((rnd() - 0.5) * jit * 2 * 180) / (Math.PI * r)) * D2R;
    const cx = ctx.x + Math.sin(a) * rr, cz = ctx.z - Math.cos(a) * rr;
    const pr = pitR * (0.88 + rnd() * 0.24);
    if (filled) {
      polar(floor, ctx, cx, cz, { stations: [0, pr * 0.6, pr * 1.15], nA: 12, lift: 0.045, concave: true });
    } else {
      // dark interior and a heap of white chalk round the lip
      polar(floor, ctx, cx, cz, { stations: [0, pr * 0.5, pr * 1.02], nA: 12, lift: 0.035, concave: true });
      polar(rim, ctx, cx, cz, {
        stations: [pr * 1.0, pr * 1.2, pr * 1.45, pr * 1.8], nA: 12, lift: 0.04, concave: true,
        prof: (rad) => 0.1 * smooth01(pr * 1.8, pr * 1.0, rad),
      });
    }
  }
  if (filled) floor.emit(b, () => TURF_SPARSE);
  else {
    const d = clamp(depth / 1.2, 0, 1);
    const col = new THREE.Color("#5a554b").lerp(new THREE.Color("#0e0c0a"), d).getHexString();
    floor.emit(b, () => `flat:#${col}`);
    rim.emit(b, surface === "turf" ? () => TURF_SPARSE : () => "chalk");
  }
}

// ---------------------------------------------------------------------------------------------------------------
// posts: timber-circle, palisade, house palisades
// ---------------------------------------------------------------------------------------------------------------
class Posts {
  pos: number[] = [];
  uv: number[] = [];
  private tile: number;
  constructor(private mat: string) {
    this.tile = tileOf(mat);
  }
  /**
   * A rough log from yBot (buried) to yTop, with a tapered top and optional lean (lx, lz = offset of the top).
   * `bow` > 0 adds a middle ring (slightly fatter, bowed sideways) so a post is not a perfect prism.
   */
  post(x: number, z: number, yBot: number, yTop: number, r: number, sides: number, rnd: () => number, lx: number, lz: number, flat: boolean, bow = 0): void {
    const rot = rnd() * Math.PI * 2;
    const uo = rnd() * 7;
    const H = yTop - yBot;
    type Ring = { y: number; px: number[]; pz: number[] };
    const rings: Ring[] = [];
    const mk = (f: number, rf: number, ox: number, oz: number): Ring => {
      const px: number[] = [], pz: number[] = [];
      for (let k = 0; k < sides; k++) {
        const a = rot + (2 * Math.PI * (k + (rnd() - 0.5) * 0.18)) / sides;
        const rr = r * rf * (0.9 + 0.2 * rnd());
        px.push(x + ox + Math.cos(a) * rr);
        pz.push(z + oz + Math.sin(a) * rr);
      }
      return { y: yBot + H * f, px, pz };
    };
    rings.push(mk(0, 1, 0, 0));
    if (bow > 0) {
      const ba = rnd() * Math.PI * 2;
      rings.push(mk(0.5 + (rnd() - 0.5) * 0.2, 1 + bow, lx * 0.5 + Math.cos(ba) * bow * r, lz * 0.5 + Math.sin(ba) * bow * r));
    }
    rings.push(mk(1, flat ? 0.96 : 0.86, lx, lz));
    const apex: [number, number, number] = flat
      ? [x + lx, yTop + 0.02, z + lz]
      : [x + lx + (rnd() - 0.5) * r * 0.7, yTop + r * (0.5 + 0.7 * rnd()), z + lz + (rnd() - 0.5) * r * 0.7];
    const circ = 2 * Math.PI * r;
    const T = this.tile;
    for (let ri = 0; ri < rings.length - 1; ri++) {
      const A = rings[ri], B = rings[ri + 1];
      for (let k = 0; k < sides; k++) {
        const k2 = (k + 1) % sides;
        const u0 = uo + ((k / sides) * circ) / T, u1 = uo + (((k + 1) / sides) * circ) / T;
        const b0: [number, number, number] = [A.px[k], A.y, A.pz[k]], b1: [number, number, number] = [A.px[k2], A.y, A.pz[k2]];
        const t0: [number, number, number] = [B.px[k], B.y, B.pz[k]], t1: [number, number, number] = [B.px[k2], B.y, B.pz[k2]];
        this.pos.push(...b0, ...t0, ...b1, ...b1, ...t0, ...t1);
        // texture grain (horizontal logs in the scan) runs up the post: u along the height, v round it
        const va = (A.y - yBot) / T, vb = (B.y - yBot) / T;
        this.uv.push(va, u0, vb, u0, va, u1, va, u1, vb, u0, vb, u1);
      }
    }
    const top = rings[rings.length - 1];
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      this.pos.push(top.px[k], top.y, top.pz[k], ...apex, top.px[k2], top.y, top.pz[k2]);
      const u0 = uo + ((k / sides) * circ) / T, u1 = uo + (((k + 1) / sides) * circ) / T;
      this.uv.push(H / T, u0, H / T + 0.05, (u0 + u1) / 2, H / T, u1);
    }
  }
  emit(b: Builder): void {
    if (!this.pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    b.add(this.mat, g);
  }
}

function timberCircle(b: Builder, m: PhaseModel, ctx: BuildCtx): void {
  const mat = typeof m.material === "string" ? m.material : "timber-weathered";
  const rings = Array.isArray(m.rings) ? (m.rings as Record<string, unknown>[]) : [];
  const bearing = num(m.bearing, 90), jit = num(m.jitter, 0.1);
  const rnd = rng(ctx.seed + 57);
  const P = new Posts(mat);
  for (const ring of rings) {
    const r = num(ring.r, 10);
    const rx = num(ring.rx, r), rz = num(ring.rz, r);
    const count = Math.max(1, Math.round(num(ring.count, 24)));
    const d = num(ring.d, 0.5), h = num(ring.h, 3), hVar = num(ring.hVar, 0.06);
    const from = num(ring.from, 0), to = num(ring.to, 360), phase = num(ring.phase, 0);
    const full = to - from >= 359.9;
    const ringBearing = num(ring.bearing, bearing);
    for (let i = 0; i < count; i++) {
      const az = phase + from + (count > 1 ? ((to - from) * i) / (full ? count : count - 1) : 0);
      const p = ovalPoint(rx, rz, ringBearing, az);
      const x = ctx.x + p[0] + (rnd() - 0.5) * 2 * jit, z = ctx.z + p[1] + (rnd() - 0.5) * 2 * jit;
      const g = ctx.ground(x, z);
      const hh = h * (1 + (rnd() - 0.5) * 2 * hVar);
      const lean = (rnd() - 0.5) * 0.045;
      const la = rnd() * Math.PI * 2;
      const rad = (d / 2) * (0.88 + rnd() * 0.24);
      const sides = rnd() < 0.5 ? 6 : 8;
      const flat = rnd() < 0.25;
      P.post(x, z, g - 0.5, g + hh, rad, sides, rnd, Math.cos(la) * lean * hh, Math.sin(la) * lean * hh, flat, 0.06);
    }
  }
  P.emit(b);
}

function palisade(b: Builder, m: PhaseModel, ctx: BuildCtx): void {
  const mat = typeof m.material === "string" ? m.material : "timber-weathered";
  const h = num(m.h, 3), d = num(m.d, 0.35), gap = num(m.gap, 0.05), closed = m.closed === true;
  const raw = pathOf(m, ctx);
  if (raw.length < 2) return;
  const poly = mkPoly(raw, closed, 0);
  const step = Math.max(0.1, d + gap);
  const n = Math.max(1, Math.min(12000, Math.floor(poly.len / step)));
  const rnd = rng(ctx.seed + 11);
  const P = new Posts(mat);
  const sides = n > 5000 ? 5 : 6;
  for (let i = 0; i < (closed ? n : n + 1); i++) {
    const q = posAt(poly, (i * poly.len) / n);
    const x = q[0] + (rnd() - 0.5) * 0.04, z = q[1] + (rnd() - 0.5) * 0.04;
    const g = ctx.ground(x, z);
    const hh = h * (0.93 + rnd() * 0.14);
    const lean = (rnd() - 0.5) * 0.03;
    P.post(x, z, g - 0.4, g + hh, (d / 2) * (0.9 + rnd() * 0.2), sides, rnd, lean * hh, 0, rnd() < 0.5);
  }
  P.emit(b);
}

// ---------------------------------------------------------------------------------------------------------------
// banked-avenue
// ---------------------------------------------------------------------------------------------------------------
function bankedAvenue(b: Builder, m: PhaseModel, ctx: BuildCtx): void {
  const surface = surfaceOf(m);
  const width = num(m.width, 21), bankW = num(m.bankW, 4), bankH = num(m.bankH, 0.8), ditchW = num(m.ditchW, 3), berm = num(m.berm, 0.4);
  const closed = m.closed === true;
  const rough = roughOf(surface);
  const seed = ctx.seed;
  const raw = pathOf(m, ctx);
  if (raw.length < 2) return;
  const M = new Mesh();
  const lining = m.lining !== false;
  const cDitch = bankW / 2 + berm + ditchW / 2;
  const hwDitch = ditchW / 2 + Math.min(0.8, Math.max(0.25, berm));
  const bank = (poly: Poly, c0: number, sd: number, ds: number): void => {
    strip(M, ctx, poly, {
      c: (s) => c0 + 0.12 * sn1(s * 0.05, sd + 2), hw: (s) => (bankW / 2) * (1 + 0.06 * sn1(s * 0.04, sd + 3)),
      nC: oddCols(bankW, 0.5, 7), cap: closed ? 0 : bankW / 2, ds, lift: 0.03, prof: bankProf(bankH, sd, rough),
    });
  };
  const ditch = (poly: Poly, c0: number, ds: number): void => {
    if (lining) strip(M, ctx, poly, { c: c0, hw: hwDitch, nC: oddCols(hwDitch * 2, 0.5, 7), ds, lift: 0.05, concave: true });
  };
  const centre = mkPoly(raw, false, num(m.smooth, 40));
  if (!closed) {
    const ds = clamp(centre.len / 1600, 1.4, 4);
    bank(centre, width / 2, seed, ds);
    bank(centre, -width / 2, seed + 17, ds);
    ditch(centre, width / 2 + cDitch, ds);
    ditch(centre, -(width / 2 + cDitch), ds);
  } else {
    // one banked enclosure: both long banks wrapped round the two terminals
    const n = centre.pts.length;
    const left: P2[] = [], right: P2[] = [];
    for (let i = 0; i < n; i++) {
      const a = centre.pts[Math.max(0, i - 1)], c = centre.pts[i], d = centre.pts[Math.min(n - 1, i + 1)];
      let tx = d[0] - a[0], tz = d[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      left.push([c[0] + tz * (width / 2), c[1] - tx * (width / 2)]);
      right.push([c[0] - tz * (width / 2), c[1] + tx * (width / 2)]);
    }
    const loop = mkPoly([...left, ...right.reverse()], true, Math.max(bankW * 1.6, 4));
    const ds = clamp(loop.len / 2400, 1.4, 4);
    bank(loop, 0, seed, ds);
    ditch(loop, cDitch, ds);
  }
  M.emit(b, picker(surface, seed));
}

// ---------------------------------------------------------------------------------------------------------------
// barrows
// ---------------------------------------------------------------------------------------------------------------
type Form = "bowl" | "bell" | "disc" | "saucer" | "pond";
interface BarrowSpec {
  form: Form;
  d: number;
  h: number;
  ditch: boolean;
  ditchW: number;
  berm: number;
  bank: { w: number; h: number } | null;
  surface: Surface;
}

function barrowSpec(p: Record<string, unknown>, base: Partial<BarrowSpec> = {}): BarrowSpec {
  const f = p.form;
  const form: Form = f === "bell" || f === "disc" || f === "saucer" || f === "pond" || f === "bowl" ? f : "bowl";
  const bo = p.bankOuter;
  let bank: { w: number; h: number } | null = null;
  if (bo && typeof bo === "object") bank = { w: num((bo as Record<string, unknown>).w, 3), h: num((bo as Record<string, unknown>).h, 0.6) };
  else if (bo === true || (bo === undefined && (form === "disc" || form === "saucer"))) bank = { w: 3, h: 0.6 };
  return {
    form,
    d: num(p.d, base.d ?? 20),
    h: num(p.h, base.h ?? (form === "pond" ? 0.5 : form === "disc" ? 0.12 : form === "saucer" ? 0.8 : 1.8)),
    ditch: typeof p.ditch === "boolean" ? p.ditch : form !== "pond",
    ditchW: num(p.ditchW, 3),
    berm: num(p.berm, form === "bell" ? 4 : form === "disc" ? 1.5 : 1),
    bank,
    surface: surfaceOf(p, base.surface ?? "turf"),
  };
}

function drawBarrow(b: Builder, ctx: BuildCtx, cx: number, cz: number, p: BarrowSpec, seed: number): void {
  // ground plan for diagnostics and keep-out (see planTrace)
  ctx.trace?.push({ kind: "plan", shape: "circle", x: cx, z: cz, r: p.d / 2 + p.berm + (p.ditch ? p.ditchW : 0) + (p.bank ? p.bank.w : 0) });
  const M = new Mesh(), floor = new Mesh();
  const a = p.d / 2;
  const rough = roughOf(p.surface);
  const rs = (th: number): number => 1 + 0.045 * (vnoise(Math.cos(th) * 1.4 + 5 + (seed % 17), Math.sin(th) * 1.4 + 9, seed) * 2 - 1);
  const nA = clamp(Math.round((2 * Math.PI * (a + p.berm + p.ditchW)) / 1.3), 28, 140);
  const rel = (rad: number, x: number, z: number): number =>
    rough * (vnoise(x * 1.1, z * 1.1, seed + 2) - 0.5 + 0.5 * (vnoise(x * 3, z * 3, seed + 3) - 0.5)) * clamp((a - rad) / (a * 0.2 + 0.01), 0, 1);
  let moundProf: (r: number, th: number, x: number, z: number) => number = () => 0;
  let stations = linSt(0, a, 0.9, 6);
  switch (p.form) {
    case "bell": moundProf = (r, _t, x, z) => p.h * Math.pow(Math.max(0, 1 - Math.pow(r / a, 2.2)), 0.7) + rel(r, x, z); break;
    case "saucer": moundProf = (r, _t, x, z) => p.h * Math.pow(Math.max(0, 1 - Math.pow(r / a, 4)), 0.7) + rel(r, x, z); break;
    case "disc":
      stations = a > 2.6 ? [0, 0.4, 0.8, 1.2, 1.5, ...linSt(2.2, a, 1.6, 2)] : linSt(0, a, 0.5, 3);
      moundProf = (r, _t, x, z) => p.h * (1 - Math.pow(r / a, 8)) + (r < 1.5 ? 0.4 * (1 - (r / 1.5) ** 2) : 0) + rel(r, x, z) * 0.5;
      break;
    case "pond": break;
    default: {
      // spherical cap
      const Rs = (a * a + p.h * p.h) / (2 * p.h);
      moundProf = (r, _t, x, z) => Math.sqrt(Math.max(0, Rs * Rs - r * r)) - (Rs - p.h) + rel(r, x, z);
    }
  }
  let rEnd = a;
  if (p.form === "pond") {
    polar(floor, ctx, cx, cz, { stations: linSt(0, a, 1.5, 3), nA, lift: 0.04, rs });
    const bw = p.bank ? p.bank.w : 3, bh = p.bank ? p.bank.h : p.h;
    const rimProf = (r: number, x: number, z: number): number => {
      const c = cosine(((r - a) / bw) * 2 - 1);
      return bh * c * (1 + 0.1 * (vnoise(x * 0.4, z * 0.4, seed) - 0.5)) + rough * 0.5 * (vnoise(x * 2, z * 2, seed + 4) - 0.5) * c;
    };
    polar(M, ctx, cx, cz, { stations: linSt(a, a + bw, 0.5, 6), nA, rs, lift: 0.03, prof: (r, _t, x, z) => rimProf(r, x, z) });
    rEnd = a + bw;
  } else {
    polar(M, ctx, cx, cz, { stations, nA, rs, prof: moundProf, lift: 0.03 });
    if (p.ditch) {
      const r0 = Math.max(a * 1.05, a + p.berm - 0.3), r1 = a + p.berm + p.ditchW + 0.6;
      polar(M, ctx, cx, cz, { stations: linSt(r0, r1, 0.5, 5), nA, lift: 0.05, concave: true });
      rEnd = r1;
    }
    if (p.bank) {
      const r0 = rEnd + 0.1, w = p.bank.w, bh = p.bank.h;
      polar(M, ctx, cx, cz, {
        stations: linSt(r0, r0 + w, 0.5, 6), nA, lift: 0.03,
        prof: (r, _t, x, z) => bh * cosine(((r - r0) / w) * 2 - 1) * (1 + 0.12 * (vnoise(x * 0.3, z * 0.3, seed + 6) - 0.5)),
      });
    }
  }
  M.emit(b, picker(p.surface, seed));
  floor.emit(b, p.surface === "turf" ? () => TURF_SPARSE : picker(p.surface, seed + 5));
}

function barrow(b: Builder, m: PhaseModel, ctx: BuildCtx): void {
  drawBarrow(b, ctx, ctx.x, ctx.z, barrowSpec(m), ctx.seed);
}

function barrowGroup(b: Builder, m: PhaseModel, ctx: BuildCtx): void {
  const list = Array.isArray(m.barrows) ? (m.barrows as Record<string, unknown>[]) : [];
  const groupSurface = surfaceOf(m);
  list.forEach((e, i) => {
    let x: number, z: number;
    if (typeof e.lat === "number" && typeof e.lon === "number") [x, z] = ctx.project(e.lat, e.lon);
    else {
      x = ctx.x + num(e.x, 0);
      z = ctx.z + num(e.z, 0);
    }
    drawBarrow(b, ctx, x, z, barrowSpec(e, { surface: groupSurface, d: num(m.d, 20), h: typeof m.h === "number" ? m.h : undefined }), ctx.seed + i * 13);
  });
}

function longBarrow(b: Builder, m: PhaseModel, ctx: BuildCtx): void {
  const surface = surfaceOf(m);
  const l = num(m.l, 50), w = num(m.w, 20), w2 = num(m.w2, 12), h = num(m.h, 2.5);
  const ditchW = num(m.ditchW, 5), berm = num(m.berm, 1);
  const bearing = num(m.bearing, ctx.bearing ?? 90) * D2R;
  const tx = Math.sin(bearing), tz = -Math.cos(bearing);
  const poly = mkPoly([[ctx.x - (tx * l) / 2, ctx.z - (tz * l) / 2], [ctx.x + (tx * l) / 2, ctx.z + (tz * l) / 2]], false);
  const rough = roughOf(surface), seed = ctx.seed;
  const M = new Mesh();
  const half = (s: number): number => (w2 + (w - w2) * (s / l)) / 2;
  const cap = Math.min(w2 * 0.7, l * 0.3);
  strip(M, ctx, poly, {
    c: 0, hw: (s) => half(s) * (1 + 0.05 * sn1(s * 0.1, seed)), nC: oddCols(w, 0.7, 11), cap, ds: 1.2, lift: 0.03,
    prof: (v, s, x, z) => {
      const sh = 0.65 + 0.35 * (s / l);
      return Math.max(0, h * sh * Math.pow(cosine(v), 0.75) * (1 + 0.05 * sn1(s * 0.15, seed + 1)) + rough * (vnoise(x, z, seed) - 0.5) * Math.min(1, cosine(v) * 3));
    },
  });
  if (ditchW > 0) {
    const hw = ditchW / 2 + 0.4;
    for (const side of [1, -1])
      strip(M, ctx, poly, {
        s0: cap * 0.6, s1: l - cap * 0.6, c: (s) => side * (half(s) + berm + ditchW / 2), hw, nC: oddCols(hw * 2, 0.5, 7), ds: 1.5, lift: 0.05, concave: true,
      });
  }
  M.emit(b, picker(surface, seed));
}

// ---------------------------------------------------------------------------------------------------------------
// rampart
// ---------------------------------------------------------------------------------------------------------------
function rampart(b: Builder, m: PhaseModel, ctx: BuildCtx): void {
  const surface = surfaceOf(m);
  const bankW = num(m.bankW, 8), bankH = num(m.bankH, 2.5), ditchW = num(m.ditchW, 6), berm = num(m.berm, 1);
  const raw = pathOf(m, ctx);
  if (raw.length < 3) return;
  let ring = raw;
  if (ring.length > 3 && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < 0.01) ring = ring.slice(0, -1);
  const gapIdx = new Set(Array.isArray(m.gaps) ? (m.gaps as number[]) : []);
  const poly = mkPoly(ring, true, num(m.smooth, 12));
  const ds = clamp(poly.len / 1800, 1.2, 4);
  const rough = roughOf(surface), seed = ctx.seed;
  const nearest = (x: number, z: number): number => {
    let best = 0, bd = Infinity;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i], c = ring[(i + 1) % n];
      const dx = c[0] - a[0], dz = c[1] - a[1];
      const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };
  const M = new Mesh();
  const cDitch = bankW / 2 + berm + ditchW / 2;
  const hwDitch = ditchW / 2 + Math.min(0.8, Math.max(0.25, berm));
  // mkPoly may have reversed the ring: segment indices refer to the ring as given, found by nearest-segment lookup
  for (const run of classRuns(poly, ds, (x, z) => (gapIdx.has(nearest(x, z)) ? 0 : 1))) {
    if (run.c === 0) continue;
    const s0 = run.whole ? undefined : run.s0;
    strip(M, ctx, poly, {
      s0, s1: run.s1, c: (s) => 0.2 * sn1(s * 0.05, seed + 2), hw: (s) => (bankW / 2) * (1 + 0.06 * sn1(s * 0.04, seed + 3)),
      nC: oddCols(bankW, 0.6, 9), cap: bankW / 2, ds, lift: 0.03, prof: bankProf(bankH, seed, rough),
    });
    strip(M, ctx, poly, { s0, s1: run.s1, c: cDitch, hw: hwDitch, nC: oddCols(hwDitch * 2, 0.6, 7), ds, lift: 0.05, concave: true });
  }
  M.emit(b, picker(surface, seed));
}

// ---------------------------------------------------------------------------------------------------------------
// turf
// ---------------------------------------------------------------------------------------------------------------
function pointInPoly(x: number, z: number, p: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i][1] > z !== p[j][1] > z && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
  }
  return inside;
}

function turf(b: Builder, m: PhaseModel, ctx: BuildCtx): void {
  const mat = tinted(typeof m.material === "string" ? m.material : "turf");
  const lift = num(m.lift, 0.04);
  const maxEdge = num(m.maxEdge, 6);
  let pts = pathOf(m, ctx);
  if (pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.01) pts = pts.slice(0, -1);
  if (pts.length < 3) return;
  const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
  let tris: P2[][] = THREE.ShapeUtils.triangulateShape(contour, []).map((t) => t.map((i) => pts[i]));
  if (!tris.length) return;
  const longest = (): number =>
    tris.reduce((mx, t) => Math.max(mx, Math.hypot(t[0][0] - t[1][0], t[0][1] - t[1][1]), Math.hypot(t[1][0] - t[2][0], t[1][1] - t[2][1]), Math.hypot(t[2][0] - t[0][0], t[2][1] - t[0][1])), 0);
  while (longest() > maxEdge && tris.length * 4 <= 60000) {
    const next: P2[][] = [];
    for (const [p, q, s] of tris) {
      const pq: P2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], qs: P2 = [(q[0] + s[0]) / 2, (q[1] + s[1]) / 2], sp: P2 = [(s[0] + p[0]) / 2, (s[1] + p[1]) / 2];
      next.push([p, pq, sp], [pq, q, qs], [sp, qs, s], [pq, qs, sp]);
    }
    tris = next;
  }
  const tile = tileOf(mat);
  const pos: number[] = [], uv: number[] = [];
  for (const t of tris) {
    const cross = (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0]);
    for (const [x, z] of cross > 0 ? [t[0], t[2], t[1]] : t) {
      pos.push(x, ctx.ground(x, z) + lift, z);
      uv.push(x / tile, z / tile);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  b.add(mat, g);
  if (COATS[mat]) b.add(COATS[mat], g);

  // small crossed-blade tufts (cheap, bounded)
  const dens = num(m.tufts, 0);
  if (dens <= 0) return;
  const area = Math.abs(signedArea(pts));
  const count = Math.min(20000, Math.round(area * dens));
  if (count <= 0) return;
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const rnd = rng(ctx.seed + 77);
  const cols = ["flat:#5a8636", "flat:#6a9440", "flat:#7c9d4a", "flat:#92a557"];
  const batches = cols.map(() => ({ pos: [] as number[], nor: [] as number[] }));
  let placed = 0, tries = 0;
  while (placed < count && tries < count * 30) {
    tries++;
    const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
    if (!pointInPoly(x, z, pts)) continue;
    placed++;
    const y = ctx.ground(x, z) + lift - 0.01;
    const bt = batches[Math.min(cols.length - 1, Math.floor(Math.pow(rnd(), 1.6) * cols.length))];
    const hgt = 0.1 + rnd() * 0.2, bw = 0.035 + rnd() * 0.03, ph = rnd() * Math.PI;
    for (let k = 0; k < 3; k++) {
      const a = ph + (k * Math.PI) / 3;
      const dx = Math.cos(a), dz = Math.sin(a);
      const lean = (rnd() - 0.5) * hgt * 0.9, la = rnd() * Math.PI * 2;
      bt.pos.push(x - dx * bw, y, z - dz * bw, x + dx * bw, y, z + dz * bw, x + Math.cos(la) * lean, y + hgt, z + Math.sin(la) * lean);
      for (let v = 0; v < 3; v++) bt.nor.push(0, 1, 0);
    }
  }
  batches.forEach((bt, i) => {
    if (!bt.pos.length) return;
    const gg = new THREE.BufferGeometry();
    gg.setAttribute("position", new THREE.Float32BufferAttribute(bt.pos, 3));
    gg.setAttribute("normal", new THREE.Float32BufferAttribute(bt.nor, 3));
    b.add(cols[i], gg);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Neolithic houses (fabric styles)
// ---------------------------------------------------------------------------------------------------------------
/** Rounded-square outline (half side hw, corner radius cr) from the left jamb of a door gap on the +z side, round the long way to the right jamb. */
function houseOutline(hw: number, cr: number, door: number): P2[] {
  const pts: P2[] = [[-door / 2, hw]];
  const arc = (cx: number, cz: number, a0: number, a1: number): void => {
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + Math.cos(a) * cr, cz + Math.sin(a) * cr]);
    }
  };
  arc(-hw + cr, hw - cr, Math.PI / 2, Math.PI);
  arc(-hw + cr, -hw + cr, Math.PI, Math.PI * 1.5);
  arc(hw - cr, -hw + cr, Math.PI * 1.5, Math.PI * 2);
  arc(hw - cr, hw - cr, 0, Math.PI / 2);
  pts.push([door / 2, hw]);
  return pts;
}

/** Vertical prism over a shape given as (x, -z) points, from y0 to y1, with metre UVs. */
function prism(b: Builder, mat: string, pts: P2[], y0: number, y1: number): void {
  const shape = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(-Math.PI / 2); // shape (sx, sy) -> world (x, -z); extrusion along +y
  g.translate(0, y0, 0);
  const t = tileOf(mat);
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  const np = ng.attributes.position as THREE.BufferAttribute;
  const nn = ng.attributes.normal as THREE.BufferAttribute;
  const uv = new Float32Array(np.count * 2);
  for (let i = 0; i < np.count; i++) {
    if (Math.abs(nn.getY(i)) < 0.5) {
      uv[i * 2] = (Math.abs(nn.getX(i)) > Math.abs(nn.getZ(i)) ? np.getZ(i) : np.getX(i)) / t;
      uv[i * 2 + 1] = np.getY(i) / t;
    } else {
      uv[i * 2] = np.getX(i) / t;
      uv[i * 2 + 1] = np.getZ(i) / t;
    }
  }
  ng.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  b.add(mat, ng);
}

/** Superellipse point (k = 2 circle, large k = square). */
function squircle(R: number, k: number, ang: number): P2 {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [R * Math.sign(c) * Math.pow(Math.abs(c), 2 / k), R * Math.sign(s) * Math.pow(Math.abs(s), 2 / k)];
}

/** Steep thatched pyramidal roof on a rounded-square plan. CONJECTURAL: no roof form is known. */
function thatchRoof(b: Builder, mat: string, R: number, y0: number, rise: number, lip = 0.28): void {
  const N = 32;
  const rings = [
    { r: 1, y: y0 - lip },
    { r: 1, y: y0 },
    { r: 0.78, y: y0 + rise * 0.27 },
    { r: 0.55, y: y0 + rise * 0.55 },
    { r: 0.3, y: y0 + rise * 0.8 },
    { r: 0.1, y: y0 + rise * 0.96 },
    { r: 0.0, y: y0 + rise },
  ];
  const tile = tileOf(mat);
  const pos: number[] = [], uv: number[] = [];
  const pt = (ri: number, i: number): [number, number, number] => {
    const [x, z] = squircle(R * rings[ri].r, 5, (2 * Math.PI * (i % N)) / N);
    return [x, rings[ri].y, z];
  };
  const slant = Math.hypot(R, rise);
  for (let ri = 0; ri < rings.length - 1; ri++)
    for (let i = 0; i < N; i++) {
      const a = pt(ri, i), c = pt(ri, i + 1), d = pt(ri + 1, i), e = pt(ri + 1, i + 1);
      const u0 = ((i / N) * 8 * R) / tile, u1 = (((i + 1) / N) * 8 * R) / tile;
      // the scan has its bound spars along one edge: put them at the ridge (v = 0 at the apex: textures are loaded unflipped)
      const dist = (i: number): number => slant * rings[i].r + (i === 0 ? lip : 0);
      const vs = 0.97 / (slant + lip) * 1; const v0 = dist(ri) * vs, v1 = dist(ri + 1) * vs;
      // ring angle increases from +x towards +z, so (a, d, c) faces outward
      pos.push(...a, ...d, ...c, ...c, ...d, ...e);
      uv.push(u0, v0, u0, v1, u1, v0, u1, v0, u0, v1, u1, v1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  b.add(mat, g);
}

function neolithicHouse(b: Builder, size: number, doorTurn: number, pitch: number, detail: boolean, seed: number, large: boolean): void {
  const hw = size / 2;
  const cr = Math.min(0.9, size * 0.18);
  const door = large ? 1.2 : 0.95;
  const wallH = large ? 1.8 : 1.55;
  const t = 0.28;
  b.at(0, 0, 0, doorTurn, () => {
    // raised chalk-plaster floor, visible through and in front of the doorway
    prism(b, "chalk", Array.from({ length: 48 }, (_, i) => squircle(hw + 0.2, 7, (2 * Math.PI * i) / 48)), -0.5, 0.11);
    b.box("chalk", door + 0.5, 0.09, 1.1, 0, 0, hw + 0.55);
    // wall of stakes with wattle and daub, doorway on +z
    const outer = houseOutline(hw, cr, door);
    const inner = houseOutline(hw - t, Math.max(0.2, cr - t), door).reverse();
    prism(b, "daub", [...outer, ...inner], -0.5, wallH);
    b.box("timber-weathered", door + 0.5, 0.18, t + 0.12, 0, wallH - 0.22, hw - t / 2);
    for (const s of [-1, 1]) b.box("timber-weathered", 0.14, wallH - 0.1, 0.2, s * (door / 2 + 0.05), 0, hw - t / 2);
    // CONJECTURAL roof: nothing of the superstructure survives; a steep thatched pyramidal / hipped form is assumed
    const R = hw + (large ? 0.85 : 0.7);
    thatchRoof(b, "thatch-old", R, wallH - 0.05, R * pitch);
    if (detail) {
      // stake ends showing through the daub, spaced along the outside of the wall
      const rnd = rng(seed);
      let carry = 0;
      for (let i = 1; i < outer.length; i++) {
        const a = outer[i - 1], c = outer[i];
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        for (let s = carry; s < L; s += 0.5) {
          const f = s / L;
          const x = a[0] + (c[0] - a[0]) * f, z = a[1] + (c[1] - a[1]) * f;
          b.cyl("timber-weathered", 0.032, 0.04, wallH + 0.15 + rnd() * 0.2, 5, x, -0.1, z);
          carry = s + 0.5 - L;
        }
      }
    }
    if (large) {
      // the surrounding palisade ring of the larger houses (gate on the door side)
      const rnd = rng(seed + 3);
      const P = new Posts("timber-weathered");
      const pr = hw * 1.45 + 2.2;
      const n = Math.round((2 * Math.PI * pr) / 0.42);
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n;
        if (Math.abs(a - Math.PI / 2) < 0.2) continue;
        P.post(Math.cos(a) * pr, Math.sin(a) * pr, -0.45, 2.1 * (0.93 + rnd() * 0.14), 0.16, 5, rnd, 0, 0, rnd() < 0.5);
      }
      P.emit(b);
    }
  });
}

/**
 * Ground plans reported through BuildCtx.trace as `{ kind: "plan", shape: "circle" | "ring" | "strip", ... }` (world x, z,
 * metres): circle = x, z, r; ring = x, z, r0, r1 (an annulus: bank + ditch); strip = x, z (mid), len, width, rot (radians
 * about +y, as the builders use it). Read by diagnostics (the placement audit); the renderer ignores them. Barrows report
 * their own circles from drawBarrow. Banked avenues, ramparts and palisades are CORRIDOR_KINDS and need no plan.
 */
function planTrace(kind: string, m: PhaseModel, ctx: BuildCtx): void {
  const t = ctx.trace;
  if (!t) return;
  if (kind === "henge") {
    const r = num(m.r, 55), rx = num(m.rx, r), rz = num(m.rz, r);
    const ditchW = num(m.ditchW, 5), bankW = num(m.bankW, 6), gap = num(m.bankGap, 0.5);
    const outer = m.bank === "outer", inner = m.bank !== "outer" && m.bank !== "none";
    const cs = m.counterscarp && typeof m.counterscarp === "object" ? num((m.counterscarp as Record<string, unknown>).w, 2.5) : m.counterscarp === true ? 2.5 : 0;
    t.push({ kind: "plan", shape: "ring", x: ctx.x, z: ctx.z, r0: Math.min(rx, rz) - ditchW / 2 - (inner ? gap + bankW : 0), r1: Math.max(rx, rz) + ditchW / 2 + (outer ? gap + bankW : cs) });
  } else if (kind === "timber-circle") {
    const rings = Array.isArray(m.rings) ? (m.rings as Record<string, unknown>[]) : [];
    let R = 0;
    for (const ring of rings) R = Math.max(R, num(ring.rx, num(ring.r, 10)), num(ring.rz, num(ring.r, 10)));
    if (R > 0) t.push({ kind: "plan", shape: "circle", x: ctx.x, z: ctx.z, r: R + 1 });
  } else if (kind === "pit-ring") {
    const r = num(m.r, 43.3), pr = num(m.pitR, 0.5);
    t.push({ kind: "plan", shape: "ring", x: ctx.x, z: ctx.z, r0: r - pr - 0.5, r1: r + pr + 0.5 });
  } else if (kind === "long-barrow") {
    const l = num(m.l, 50), w = num(m.w, 20), ditchW = num(m.ditchW, 5), berm = num(m.berm, 1);
    const bearing = num(m.bearing, ctx.bearing ?? 90) * D2R;
    t.push({ kind: "plan", shape: "strip", x: ctx.x, z: ctx.z, len: l, width: w + 2 * (berm + ditchW), rot: Math.PI / 2 - bearing });
  }
}

function registerStyles(): void {
  STYLES["neolithic-house"] = {
    variants: 3,
    footprint: 10,
    build(b, v, detail) {
      const size = [4.5, 5.0, 5.5][v % 3];
      const pitch = [1.1, 0.95, 1.25][v % 3];
      neolithicHouse(b, size, [0, Math.PI / 2, Math.PI][v % 3], pitch, detail, v + 7, false);
    },
  };
  STYLES["neolithic-house-large"] = {
    variants: 2,
    footprint: 18,
    build(b, v, detail) {
      neolithicHouse(b, 5.5 + v * 0.6, v ? Math.PI : 0, 1.0 + v * 0.15, detail, v + 21, true);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------------------------------------------
let registered = false;
export function registerEarthworkBuilders(): void {
  if (registered) return;
  registered = true;
  const kinds: Record<string, KindBuilder> = {
    henge,
    "pit-ring": pitRing,
    "timber-circle": timberCircle,
    palisade,
    "banked-avenue": bankedAvenue,
    barrow,
    "barrow-group": barrowGroup,
    "long-barrow": longBarrow,
    rampart,
    turf,
  };
  for (const [k, fn] of Object.entries(kinds)) {
    BUILDERS[k] = (b, m, ctx) => {
      fn(b, m, ctx);
      planTrace(k, m, ctx);
    };
    WORLD_SPACE_KINDS.add(k);
  }
  FLAT_KINDS.add("turf");
  for (const k of ["banked-avenue", "rampart", "palisade"]) CORRIDOR_KINDS.add(k);
  registerStyles();
}
