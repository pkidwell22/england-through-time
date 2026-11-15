import * as THREE from "three";
import type { PhaseModel } from "@/lib/types";
import { rng } from "@/lib/geo";
import { Builder } from "./geom";
import { BUILDERS, WORLD_SPACE_KINDS, type BuildCtx } from "./builders";
import { house } from "./houses";
import { tileOf } from "./materials";

/**
 * Detailed models for the benchmark district (the London Bridge bridgehead).
 *
 * Evidence used: overall length (MOLA, c. 276-282 m), 19 stone arches plus the drawbridge opening,
 * the positions of the chapel (9th pier from the north), drawbridge gate (13th) and Great Stone Gate
 * (18th), arches averaging c. 7.3 m, structure 20-24 ft wide, a roadway of c. 3.8-5.6 m, houses
 * projecting on timber platforms carried on corbels and hammer-beams (research/tudor-jacobean.json).
 * Individual pier, arch and starling sizes, and every house, are generated: the pictorial views
 * (Wyngaerde c. 1544, Norden 1597/1600, Visscher 1616, Hollar 1647) agree only on the general
 * pattern, not on any one building, so nothing here claims to be a particular house.
 */

const num = (v: unknown, d: number): number => (typeof v === "number" ? v : d);

export interface BridgeLayout {
  ax: number;
  az: number;
  rot: number;
  length: number;
  /** Openings and piers along the bridge axis, metres from the north end. */
  openings: { x0: number; x1: number; draw: boolean }[];
  piers: { x0: number; x1: number }[];
}

/** Opening index (from the north) of the drawbridge: 7th from the Southwark end. */
export const DRAW_OPENING = 13;
/** Pier indices (from the north). */
export const CHAPEL_PIER = 8;
export const DRAW_GATE_PIER = 12;
export const STONE_GATE_PIER = 17;

export function bridgeLayout(path: [number, number][], arches = 19): BridgeLayout {
  const [a, c] = [path[0], path[path.length - 1]];
  const length = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const rot = -Math.atan2(c[1] - a[1], c[0] - a[0]);
  const nOpen = arches + 1; // 19 stone arches + the drawbridge opening
  const r = rng(1209);
  const ow: number[] = [];
  const pw: number[] = [];
  for (let i = 0; i < nOpen; i++) ow.push(i === DRAW_OPENING ? 8.5 : 5.2 + r() * 4.6);
  for (let i = 0; i < nOpen - 1; i++) pw.push(i === CHAPEL_PIER ? 10.5 : 5.2 + r() * 2.6);
  const abut = 3;
  const total = ow.reduce((s, v) => s + v, 0) + pw.reduce((s, v) => s + v, 0) + abut * 2;
  const k = length / total;
  const openings: BridgeLayout["openings"] = [];
  const piers: BridgeLayout["piers"] = [];
  let x = abut * k;
  for (let i = 0; i < nOpen; i++) {
    openings.push({ x0: x, x1: x + ow[i] * k, draw: i === DRAW_OPENING });
    x += ow[i] * k;
    if (i < nOpen - 1) {
      piers.push({ x0: x, x1: x + pw[i] * k });
      x += pw[i] * k;
    }
  }
  return { ax: a[0], az: a[1], rot, length, openings, piers };
}

// ---------------------------------------------------------------------------------------------
// shared dimensions and small geometry helpers
// ---------------------------------------------------------------------------------------------

const WIDTH = 6.1; // structure width
const ROAD = 4.0; // clear roadway between the house fronts (3.8-5.6 m recorded; 3.7-4.5 in the brief)
const SPRING = 2.2; // springing of the arches above the water (above the starling tops)
const STARLING_TOP = 1.6;

const STAIN = "flat:#26332c:0.42"; // tide-line staining / wet stone

/** Triplanar-UV a raw geometry (metres per tile of `mat`) and add it. */
function put(b: Builder, mat: string, g: THREE.BufferGeometry, local?: THREE.Matrix4): void {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.computeVertexNormals();
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const t = tileOf(mat);
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u: number, v: number;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / t;
    uv[i * 2 + 1] = v / t;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  b.add(mat, geo, local);
}

/** Square-section bar between two points. */
function bar(b: Builder, mat: string, a: [number, number, number], c: [number, number, number], t = 0.22, t2 = t): void {
  const A = new THREE.Vector3(...a), C = new THREE.Vector3(...c);
  const len = A.distanceTo(C);
  if (len < 0.01) return;
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), C.clone().sub(A).normalize());
  const m = new THREE.Matrix4().compose(A.clone().add(C).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  put(b, mat, new THREE.BoxGeometry(t, t2, len), m);
}

/** Vertical prism over a plan polygon (x, z), from y0 to y1. */
function prism(b: Builder, mat: string, pts: [number, number][], y0: number, y1: number): void {
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  put(b, mat, g);
}

/** Mounded fill over a plan polygon: edge at y, centre raised by `bump`. */
function mound(b: Builder, mat: string, pts: [number, number][], y: number, bump: number): void {
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  cx /= pts.length; cz /= pts.length;
  const pos: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length];
    pos.push(cx, y + bump, cz, a[0], y, a[1], c[0], y, c[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  put(b, mat, g);
}

/** Two-centred pointed arch from the left springing to the right, `h` rise (h >= ow/2). */
function archPts(ow: number, h: number, n: number, x0 = 0, sp = 0): [number, number][] {
  const R = (h * h + (ow * ow) / 4) / ow;
  const tm = Math.asin(Math.min(1, h / R));
  const left: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * tm;
    left.push([x0 + R - R * Math.cos(th), sp + R * Math.sin(th)]);
  }
  const right: [number, number][] = [];
  for (let i = n - 1; i >= 0; i--) right.push([x0 + ow - (left[i][0] - x0), left[i][1]]);
  return [...left, ...right];
}

/** Height of a pointed arch's intrados at distance u from its left springing. */
function archY(ow: number, h: number, sp: number, u: number): number {
  const R = (h * h + (ow * ow) / 4) / ow;
  const uu = Math.min(u, ow - u);
  const d = R - uu;
  return sp + Math.sqrt(Math.max(0, R * R - d * d));
}

/** Pointed-arch plate (window, doorway) in the local x-y plane at depth z, facing +z. */
function archPlate(b: Builder, mat: string, w: number, hRect: number, rise: number, x: number, y: number, z: number, rotY = 0): void {
  const pts: [number, number][] = [[0, 0], [w, 0], ...archPts(w, Math.max(rise, w / 2), 5, 0, hRect).reverse()];
  const s = new THREE.Shape(pts.map(([px, py]) => new THREE.Vector2(px - w / 2, py)));
  put(b, mat, new THREE.ShapeGeometry(s), new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z));
}

/** Stepped-merlon parapet around a rectangle (centred), base at y. */
function battlement(b: Builder, mat: string, lx: number, lz: number, y: number, wallH = 1.0, merlon = true): void {
  const th = 0.5;
  b.box(mat, lx, wallH, th, 0, y, lz / 2 - th / 2);
  b.box(mat, lx, wallH, th, 0, y, -lz / 2 + th / 2);
  b.box(mat, th, wallH, lz - th * 2, lx / 2 - th / 2, y, 0);
  b.box(mat, th, wallH, lz - th * 2, -lx / 2 + th / 2, y, 0);
  if (!merlon) return;
  const step = 1.7;
  for (let i = 0; i < Math.floor(lx / step); i++) {
    const x = -lx / 2 + (i + 0.5) * (lx / Math.floor(lx / step));
    for (const s of [1, -1]) b.box(mat, 0.8, 0.7, th, x, y + wallH, s * (lz / 2 - th / 2));
  }
  for (let i = 0; i < Math.floor(lz / step); i++) {
    const z = -lz / 2 + (i + 0.5) * (lz / Math.floor(lz / step));
    for (const s of [1, -1]) b.box(mat, th, 0.7, 0.8, s * (lx / 2 - th / 2), y + wallH, z);
  }
}

/** Per-opening arch dimensions, shared by the bridge and the things hung on it. */
function archOf(L: BridgeLayout, i: number, deck: number): { ow: number; sp: number; h: number } {
  const o = L.openings[i];
  const ow = o.x1 - o.x0;
  const r = rng(5100 + i * 13)();
  const sp = Math.min(SPRING, deck - 1.0 - ow * 0.5);
  const h = Math.min(deck - 1.0 - sp, ow * (0.5 + 0.16 * r));
  return { ow, sp, h };
}

/** Free height of the masonry face at bridge position x (metres above the water), or -Infinity on a pier. */
function faceTop(L: BridgeLayout, deck: number, x: number): number {
  for (let i = 0; i < L.openings.length; i++) {
    const o = L.openings[i];
    if (x > o.x0 && x < o.x1) {
      if (o.draw) return deck - 0.4;
      const a = archOf(L, i, deck);
      return archY(a.ow, a.h, a.sp, x - o.x0);
    }
  }
  return -Infinity;
}

// ---------------------------------------------------------------------------------------------
// the lots that carry houses: one plan shared by the bridge (parapets in the gaps) and the houses
// ---------------------------------------------------------------------------------------------

interface Lot {
  side: 1 | -1;
  x: number;
  w: number;
  d: number;
  dst: number;
  gable: boolean;
  wallI: number;
  roofI: number;
  chimney: boolean;
  privy: number;
  sign: number;
  cross: boolean;
  seed: number;
}

interface BridgePlan {
  lots: Lot[];
  /** Stretches without houses, per side (index 0: +1, index 1: -1), in bridge metres. */
  gaps: [number, number][][];
}

const planCache = new Map<string, BridgePlan>();

function bridgePlan(L: BridgeLayout): BridgePlan {
  const key = `${L.length.toFixed(2)}|${L.openings.length}`;
  const hit = planCache.get(key);
  if (hit) return hit;
  const blocked: [number, number][] = [];
  const draw = L.openings[DRAW_OPENING];
  blocked.push([draw.x0 - 0.8, draw.x1 + 0.8]);
  const pc = (i: number) => (L.piers[i].x0 + L.piers[i].x1) / 2;
  blocked.push([pc(DRAW_GATE_PIER) - 7.0, pc(DRAW_GATE_PIER) + 7.0]); // drawbridge gate, later Nonsuch House
  blocked.push([pc(STONE_GATE_PIER) - 4.6, pc(STONE_GATE_PIER) + 4.6]);
  // two open stretches (the "Square" and another gap) attested in views
  blocked.push([L.length * 0.3, L.length * 0.3 + 11]);
  blocked.push([L.length * 0.8, L.length * 0.8 + 8]);
  const chapel = L.piers[CHAPEL_PIER];
  const chapelSpan: [number, number] = [chapel.x0 - 1.0, chapel.x1 + 1.0];
  const hit1 = (x0: number, x1: number, side: number) => {
    for (const [a, c] of blocked) if (x1 > a && x0 < c) return c;
    if (side < 0 && x1 > chapelSpan[0] && x0 < chapelSpan[1]) return chapelSpan[1]; // chapel on the east side
    return 0;
  };
  const lots: Lot[] = [];
  const gaps: [number, number][][] = [[], []];
  for (const side of [1, -1] as const) {
    const r = rng(9100 + side * 17);
    let x = 7;
    let k = 0;
    while (x < L.length - 9) {
      const w = 3.4 + r() * 3.0;
      const skip = hit1(x, x + w, side);
      if (skip) {
        x = skip + 0.1;
        continue;
      }
      lots.push({
        side, x, w, d: 2.9 + r() * 1.0, dst: r() < 0.25 ? -1 : r() > 0.78 ? 1 : 0,
        gable: r() < 0.58, wallI: Math.floor(r() * 6), roofI: Math.floor(r() * 4), chimney: r() > 0.45,
        privy: r() < 0.5 ? (r() < 0.5 ? -1 : 1) : 0, sign: r() < 0.42 ? Math.floor(r() * 5) : -1, cross: false, seed: 4000 + k * 7 + (side > 0 ? 1 : 2),
      });
      x += w + (r() < 0.08 ? 1.2 : 0.05);
      k++;
    }
    // open stretches for parapets: the blocked intervals, the approaches, and the chapel on the east
    const g = gaps[side > 0 ? 0 : 1];
    g.push([0, 7], [L.length - 9, L.length]);
    for (const [a, c] of blocked) g.push([a, c]);
    if (side < 0) g.push(chapelSpan);
  }
  // cross-buildings only where a lot stands opposite
  const east = lots.filter((l) => l.side < 0);
  const rc = rng(7331);
  for (const l of lots) {
    if (l.side < 0) continue;
    const mate = east.find((e) => e.x < l.x + 0.6 && e.x + e.w > l.x + l.w - 0.6);
    l.cross = !!mate && rc() < 0.4;
  }
  const out = { lots, gaps };
  planCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// the stone bridge
// ---------------------------------------------------------------------------------------------

/** Plan wedge (a pier's pointed cutwater) rising to a sloping top. dir = +1 (west) or -1 (east). */
function wedge(b: Builder, mat: string, cx: number, pw: number, z0: number, dir: number, len: number, yb: number, yt0: number, yt1: number): void {
  const B1: [number, number] = [cx - pw / 2, z0], B2: [number, number] = [cx + pw / 2, z0];
  const A1: [number, number] = [cx - 0.3, z0 + dir * len], A2: [number, number] = [cx + 0.3, z0 + dir * len];
  const v = (p: [number, number], y: number) => [p[0], y, p[1]];
  const pos: number[] = [];
  const quad = (a: number[], c: number[], d: number[], e: number[]) => pos.push(...a, ...c, ...d, ...a, ...d, ...e);
  quad(v(B1, yb), v(A1, yb), v(A1, yt1), v(B1, yt0));
  quad(v(A1, yb), v(A2, yb), v(A2, yt1), v(A1, yt1));
  quad(v(A2, yb), v(B2, yb), v(B2, yt0), v(A2, yt1));
  quad(v(B1, yt0), v(A1, yt1), v(A2, yt1), v(B2, yt0));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  put(b, mat, g);
}

function stoneBridge(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const width = num(m.width, WIDTH), deck = num(m.deck, 8);
  const L = bridgeLayout(ctx.path, num(m.arches, 19));
  const plan = bridgePlan(L);
  const CH_EXT = 17.4; // the chapel pier is carried east as a stone podium
  // diagnostics: bridge-local (along, across) to world x, z
  const wpt = (u: number, v: number): [number, number] => [L.ax + u * Math.cos(L.rot) + v * Math.sin(L.rot), L.az - u * Math.sin(L.rot) + v * Math.cos(L.rot)];
  if (ctx.trace) {
    const last0 = L.openings[L.openings.length - 1].x1;
    const [n0x, n0z] = wpt(L.openings[0].x0 / 2 - 2, 0), [s0x, s0z] = wpt((L.length + last0) / 2 + 2, 0);
    ctx.trace.push({ kind: "abutment", x: n0x, z: n0z, rot: L.rot, along: L.openings[0].x0 + 4, across: width, end: 0 });
    ctx.trace.push({ kind: "abutment", x: s0x, z: s0z, rot: L.rot, along: L.length - last0 + 4, across: width, end: 1 });
    L.openings.forEach((o) => {
      const [ox, oz] = wpt((o.x0 + o.x1) / 2, 0);
      ctx.trace!.push({ kind: "opening", x: ox, z: oz, rot: L.rot, along: o.x1 - o.x0, across: width });
    });
  }
  b.at(L.ax, 0, L.az, L.rot, () => {
    // abutments
    b.box("ragstone", L.openings[0].x0 + 4, deck + 4, width, L.openings[0].x0 / 2 - 2, -4, 0);
    const last = L.openings[L.openings.length - 1].x1;
    b.box("ragstone", L.length - last + 4, deck + 4, width, (L.length + last) / 2 + 2, -4, 0);

    L.piers.forEach((p, i) => {
      const pw = p.x1 - p.x0;
      const cx = (p.x0 + p.x1) / 2;
      const chapel = i === CHAPEL_PIER;
      const rr = rng(2100 + i * 31);
      b.box("ragstone", pw, deck + 4, width, cx, -4, 0);
      // pointed cutwaters rising to the roadway with sloping tops (the recesses sheltered pedestrians)
      const len = 2.1 + pw * 0.3;
      for (const s of [1, -1]) {
        if (chapel && s < 0) continue;
        wedge(b, "ragstone", cx, pw, s * (width / 2), s, len, 0.3, deck - 0.1, deck - 2.4);
        wedge(b, STAIN, cx, pw + 0.06, s * (width / 2 - 0.02), s, len + 0.04, 0.2, 1.7, 1.7);
        b.box("ashlar", pw * 0.8, 0.28, 0.5, cx, deck - 0.45, s * (width / 2 + 0.2)); // string course at the springing of the recess
      }
      if (chapel) {
        b.box("ragstone", pw, deck + 4, CH_EXT - width / 2, cx, -4, -(width / 2 + CH_EXT) / 2);
        wedge(b, "ragstone", cx, pw, -CH_EXT, -1, 3.6, 0.3, deck - 0.1, deck - 2.4);
        wedge(b, STAIN, cx, pw + 0.06, -CH_EXT + 0.02, -1, 3.64, 0.2, 1.7, 1.7);
        b.box("ashlar", pw, 0.35, CH_EXT - width / 2, cx, deck - 0.5, -(width / 2 + CH_EXT) / 2);
      }
      // starling: an elm-pile and rubble island, longer upstream (west, +z), irregular in plan
      const extL = Math.max(1.2, Math.min(2.8, 0.36 * (L.openings[i].x1 - L.openings[i].x0)));
      const extR = Math.max(1.2, Math.min(2.8, 0.36 * (L.openings[i + 1].x1 - L.openings[i + 1].x0)));
      const hl = pw / 2 + extL + (chapel ? 0.6 : 0), hr = pw / 2 + extR + (chapel ? 0.6 : 0);
      const Lup = chapel ? 9 : 8.6 + rr() * 3, Ldn = chapel ? CH_EXT + 4.2 : 6.5 + rr() * 2;
      if (ctx.trace) {
        const [px, pz] = wpt(cx + (hr - hl) / 2, (Lup - Ldn) / 2);
        ctx.trace.push({ kind: "pier", x: px, z: pz, rot: L.rot, along: hl + hr, across: Lup + Ldn });
      }
      const j = () => (rr() - 0.5) * 0.9;
      const poly: [number, number][] = [
        [cx - hl + j(), 0.14 * Lup], [cx - hl * 0.7 + j(), 0.62 * Lup], [cx + (rr() - 0.5) * 0.8, Lup],
        [cx + hr * 0.7 + j(), 0.62 * Lup], [cx + hr + j(), 0.14 * Lup], [cx + hr + j(), -0.28 * Ldn],
        [cx + hr * 0.72 + j(), -0.7 * Ldn], [cx + (rr() - 0.5) * 0.8, -Ldn], [cx - hl * 0.72 + j(), -0.7 * Ldn], [cx - hl + j(), -0.28 * Ldn],
      ];
      prism(b, "timber-weathered", poly, -4, STARLING_TOP);
      const inset = poly.map(([x, z]) => [cx + (x - cx) * 0.93, z * 0.95] as [number, number]);
      mound(b, "ragstone", inset, STARLING_TOP + 0.03, 0.45);
      for (let k = 0; k < 5; k++) {
        const bx = cx + (rr() - 0.5) * (hl + hr) * 0.8, bz = (rr() - 0.5) * (Lup + Ldn) * 0.5 + (Lup - Ldn) * 0.25;
        b.box("ragstone", 0.5 + rr() * 0.6, 0.35 + rr() * 0.3, 0.5 + rr() * 0.6, bx, STARLING_TOP + 0.05, bz, rr() * 3);
      }
      // weed and silt at the tide line
      prism(b, STAIN, poly.map(([x, z]) => [cx + (x - cx) * 1.025, z * 1.012] as [number, number]), -0.6, 1.0);
      // pile heads standing proud of the fill, and a wale rail along the long sides
      poly.forEach(([x, z], k) => {
        const hgt = 0.5 + rr() * 0.9;
        b.box("timber", 0.28, hgt, 0.28, x, STARLING_TOP - 0.1, z, rr() * 1.2);
        const [nx, nz] = poly[(k + 1) % poly.length];
        if (Math.hypot(nx - x, nz - z) > 4.5) b.box("timber", 0.24, 0.3 + rr() * 0.7, 0.24, (x + nx) / 2, STARLING_TOP - 0.1, (z + nz) / 2, rr());
      });
    });

    // openings: spandrel wall with a pointed arch, dressed voussoir rings, soffit ribs
    L.openings.forEach((o, i) => {
      const ow = o.x1 - o.x0;
      const cx = (o.x0 + o.x1) / 2;
      if (o.draw) {
        // the drawbridge: a timber leaf on stringers and joists, with side rails and chain posts
        const leaf = deck - 0.45;
        b.box("timber", ow + 0.4, 0.28, width - 0.5, cx, leaf, 0);
        for (const s of [1, -1]) {
          b.box("timber-weathered", ow + 0.4, 0.5, 0.45, cx, leaf - 0.5, s * (width / 2 - 0.9));
          b.box("timber", ow, 0.12, 0.2, cx, deck + 0.8, s * (width / 2 - 0.35));
          for (let k = 0; k <= 5; k++) b.box("timber", 0.2, 1.05, 0.2, o.x0 + (k * ow) / 5 + 0.1, deck - 0.2, s * (width / 2 - 0.35));
        }
        for (let k = 0; k < 8; k++) b.box("timber-weathered", 0.3, 0.3, width - 0.2, o.x0 + 0.5 + (k * (ow - 1)) / 7, leaf - 0.3, 0);
        b.box("timber-weathered", 0.7, 0.6, width, o.x1 - 0.1, leaf - 0.2, 0); // hinge/sill balk against the Southwark pier
        return;
      }
      const { sp, h } = archOf(L, i, deck);
      const pts = archPts(ow, h, 7, 0, sp);
      const s = new THREE.Shape();
      s.moveTo(0, sp);
      s.lineTo(0, deck);
      s.lineTo(ow, deck);
      s.lineTo(ow, sp);
      for (let k = pts.length - 1; k >= 0; k--) s.lineTo(pts[k][0], pts[k][1]);
      const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false });
      g.translate(0, 0, -width / 2);
      put(b, "ragstone", g, new THREE.Matrix4().setPosition(o.x0, 0, 0));
      // voussoir rings on both faces
      const t = 0.5;
      const outer = archPts(ow + 2 * t, h + t, 7, -t, sp);
      const ring = new THREE.Shape();
      ring.moveTo(-t, sp);
      for (const [x, y] of outer) ring.lineTo(x, y);
      ring.lineTo(ow, sp);
      for (let k = pts.length - 1; k >= 0; k--) ring.lineTo(pts[k][0], pts[k][1]);
      const rg = new THREE.ShapeGeometry(ring);
      for (const zs of [1, -1]) put(b, "ashlar", rg.clone(), new THREE.Matrix4().setPosition(o.x0, 0, zs * (width / 2 + 0.04)));
      // soffit ribs
      const nRib = ow > 7.4 ? 3 : 2;
      const inner = archPts(ow - 0.7, Math.max((ow - 0.7) / 2, h - 0.35), 5, 0.35, sp);
      for (let q = 0; q < nRib; q++) {
        const zr = nRib === 2 ? (q - 0.5) * (width * 0.5) : (q - 1) * (width * 0.34);
        const rib = new THREE.Shape();
        const ip = archPts(ow, h, 5, 0, sp);
        rib.moveTo(ip[0][0], ip[0][1]);
        for (const [x, y] of ip) rib.lineTo(x, y);
        for (let k = inner.length - 1; k >= 0; k--) rib.lineTo(inner[k][0], inner[k][1]);
        const rgm = new THREE.ExtrudeGeometry(rib, { depth: 0.45, bevelEnabled: false });
        rgm.translate(0, 0, -0.225);
        put(b, "ashlar", rgm, new THREE.Matrix4().setPosition(o.x0, 0, zr));
      }
    });

    // string course along both faces, below the roadway
    b.box("ashlar", L.length, 0.3, width + 0.12, L.length / 2, deck - 0.5, 0);
    // roadway: narrow cobbled street, worn
    b.box("cobble", L.length, 0.25, width - 0.4, L.length / 2, deck, 0);
    // parapets only where no house stands
    plan.gaps.forEach((list, si) => {
      const s = si === 0 ? 1 : -1;
      const merged = [...list].sort((a, c) => a[0] - c[0]);
      const out: [number, number][] = [];
      for (const g of merged) {
        const lastG = out[out.length - 1];
        if (lastG && g[0] <= lastG[1] + 0.2) lastG[1] = Math.max(lastG[1], g[1]);
        else out.push([g[0], g[1]]);
      }
      for (const [a, c] of out) {
        const l = c - a;
        if (l < 1.5) continue;
        b.box("ragstone", l, 1.15, 0.5, a + l / 2, deck, s * (width / 2 - 0.25));
        b.box("ashlar", l + 0.05, 0.14, 0.62, a + l / 2, deck + 1.15, s * (width / 2 - 0.25));
      }
    });
  });
}

// ---------------------------------------------------------------------------------------------
// the ramps down to the streets at the bridgeheads
// ---------------------------------------------------------------------------------------------

/** Fall of a bridgehead ramp (1 in 10): the deck is about 5 m above the street at both ends. */
export const RAMP_GRADE = 0.1;

/**
 * The bridge's roadway carried down to the street at a bridgehead: an earth-filled ramp between ragstone retaining
 * walls, cobbled, with parapets while it stands well above the ground. The deck of the stone bridge (assumed 8 m above
 * high water, undocumented) is some 5 m above the street at both ends in every year; without this the road ended in a
 * wall. Drawn in a frame whose +x runs landward from the end of the deck (x = 0, roadway at `deck`) to x = `len`, where
 * the roadway has come down to the street at `yEnd`; parapets run for the first `parapet` metres.
 */
export function bridgeRamp(b: Builder, len: number, deck: number, yEnd: number, width: number, parapet: number): void {
  if (len < 0.5) return;
  const yAt = (x: number) => deck + ((yEnd - deck) * x) / len;
  const slab = (mat: string, pts: [number, number][], depth: number, zc: number) => {
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
    g.translate(0, 0, zc - depth / 2);
    put(b, mat, g);
  };
  const base = Math.min(deck, yEnd) - 3;
  // retaining walls and fill: one sloped-topped mass (its faces are the walls)
  slab("ragstone", [[-0.6, base], [len, base], [len, yEnd], [-0.6, deck]], width + 1, 0);
  slab("cobble", [[-0.6, deck], [len, yEnd], [len, yEnd + 0.25], [-0.6, deck + 0.25]], width - 0.4, 0);
  const pl = Math.min(len, parapet);
  if (pl > 1) for (const sd of [1, -1]) {
    slab("ragstone", [[-0.6, deck], [pl, yAt(pl)], [pl, yAt(pl) + 1.15], [-0.6, deck + 1.15]], 0.5, sd * (width / 2 - 0.25));
    slab("ashlar", [[-0.6, deck + 1.15], [pl, yAt(pl) + 1.15], [pl, yAt(pl) + 1.29], [-0.6, deck + 1.29]], 0.62, sd * (width / 2 - 0.25));
  }
}

// ---------------------------------------------------------------------------------------------
// houses on the bridge
// ---------------------------------------------------------------------------------------------

const SIGN_COLOURS = ["flat:#8a2f25", "flat:#2f4b66", "flat:#a47a2b", "flat:#3f5b38", "flat:#d8cba6"];

function bridgeHouses(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const deck = num(m.deck, 8), storeys = num(m.storeys, 3);
  const tudor = m.style === "tudor";
  const L = bridgeLayout(ctx.path);
  const plan = bridgePlan(L);
  const walls = tudor ? ["frame", "frame-ochre", "frame-grey", "frame-rose", "frame-dark", "frame"] : ["daub", "frame-grey", "plaster", "daub", "frame-dark", "daub"];
  const roofs = tudor ? ["tile", "tile-old", "tile", "slate"] : ["tile-old", "shingle", "tile", "shingle"];
  const jet = tudor ? 0.42 : 0.3;
  b.at(L.ax, 0, L.az, L.rot, () => {
    for (const lot of plan.lots) {
      const { side, w, d } = lot;
      const st = Math.max(2, storeys + lot.dst);
      const zc = side * (ROAD / 2 + d / 2);
      const x = lot.x + w / 2;
      const over = ROAD / 2 + d - WIDTH / 2; // projection beyond the bridge face
      b.at(x, deck + 0.25, zc, side > 0 ? Math.PI : 0, () => {
        // local +z faces the roadway, -z the river
        house(b, {
          w: w - 0.15, d, storeys: st, wall: walls[lot.wallI], roof: roofs[lot.roofI],
          pitch: 1.1, jetty: jet, gableFront: lot.gable, chimney: tudor && lot.chimney, detail: true, seed: ctx.seed + lot.seed,
        });
        // timber platform: cantilevered balks with raking struts to the masonry face
        const faceZ = d / 2 - (WIDTH / 2 - ROAD / 2); // local z of the bridge face under the river wall
        for (const sx of [-1, 1]) {
          const lx = sx * w * 0.3;
          const bx = side > 0 ? x - lx : x + lx; // bridge-axis position (the frame is mirrored for the west side)
          bar(b, "timber", [lx, -1.75, -d / 2 - 0.15], [lx, -1.75, faceZ], 0.3, 0.32);
          const ft = faceTop(L, deck, bx) - (deck + 0.25);
          const ay = Math.max(-4.4, ft + 0.15);
          if (ay < -2.5) bar(b, "timber-weathered", [lx, ay, faceZ], [lx, -1.75, -d / 2 + 0.45], 0.22);
        }
        b.box("timber-weathered", w - 0.3, 0.14, Math.min(over + 0.3, d), 0, -1.55, -d / 2 + Math.min(over + 0.3, d) / 2 - 0.05);
        // privy on brackets over the water
        if (lot.privy) {
          const px = lot.privy * w * 0.2;
          b.box("timber", 1.1, 2.0, 0.95, px, 2.7, -d / 2 - 0.47);
          b.box("tile-old", 1.4, 0.14, 1.25, px, 4.7, -d / 2 - 0.5);
          bar(b, "timber", [px - 0.4, 2.6, -d / 2 - 0.9], [px - 0.4, 2.0, -d / 2 + 0.05], 0.14);
          bar(b, "timber", [px + 0.4, 2.6, -d / 2 - 0.9], [px + 0.4, 2.0, -d / 2 + 0.05], 0.14);
        }
        // hanging sign on an iron bracket over the street
        if (lot.sign >= 0) {
          const sx = (lot.privy >= 0 ? 1 : -1) * w * 0.32;
          b.box("dark", 0.05, 0.05, 1.05, sx, 2.3, d / 2 + 0.5);
          b.box(SIGN_COLOURS[lot.sign], 0.06, 0.55, 0.62, sx, 1.65, d / 2 + 0.62);
        }
      });
      // buildings across the roadway (Tudor): an upper chamber over a timber-framed passage
      if (tudor && lot.cross && side > 0) {
        const cw = w - 0.5;
        const cy = deck + 0.25 + 3.1;
        const span = ROAD + 2 * (jet * 2 + 0.4);
        b.box(walls[lot.wallI], cw, 2.7 * (st - 1), span, x, cy, 0);
        b.box("timber", cw + 0.1, 0.38, ROAD + 0.4, x, cy - 0.3, 0);
        for (const s of [1, -1]) bar(b, "timber", [x - cw * 0.3, cy - 0.3, s * (ROAD / 2 + 0.2)], [x - cw * 0.3, cy - 1.0, s * (ROAD / 2 - 0.1)], 0.2);
        b.gable(roofs[lot.roofI], walls[lot.wallI], cw, 1.4, 0.7, x, cy + 2.7 * (st - 1), 0, Math.PI / 2, 0.1);
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------
// fittings standing on a pier
// ---------------------------------------------------------------------------------------------

function onPier(b: Builder, ctx: BuildCtx, pier: number, deck: number, fn: (pw: number, L: BridgeLayout) => void, refPath: [number, number][]) {
  const L = bridgeLayout(refPath);
  const p = L.piers[pier];
  b.at(L.ax, 0, L.az, L.rot, () => b.at((p.x0 + p.x1) / 2, deck + 0.25, 0, 0, () => fn(p.x1 - p.x0, L)));
  void ctx;
}

const CHAPEL_L = 15.8;
const CHAPEL_Z0 = 2.6;

function bridgeChapel(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const h = num(m.h, 14);
  const style = String(m.style ?? "early");
  onPier(b, ctx, CHAPEL_PIER, 8, (pw) => {
    // The chapel stood on the east (downstream) side of an enlarged pier; local -z here.
    const l = CHAPEL_L, w = Math.max(7.6, pw - 2.0);
    // undercroft windows in the stone podium, above the starling
    for (const s of [1, -1]) for (let k = 0; k < 3; k++) {
      const z = -4.3 - k * 4.2;
      b.at(s * (pw / 2 + 0.04), 0, z, s > 0 ? Math.PI / 2 : -Math.PI / 2, () => archPlate(b, "dark", 1.0, 1.4, 1.9, 0, -5.9, 0));
    }
    b.at(0, 0, -17.4 - 0.1, Math.PI, () => archPlate(b, "dark", 1.6, 2.0, 2.6, 0, -6.1, 0)); // water-gate at the east end
    const ox = 0;
    b.at(ox, 0, -CHAPEL_Z0 - l / 2, Math.PI / 2, () => {
      const stone = "caen";
      const rise = style === "early" ? w * 0.62 : style === "perpendicular" ? w * 0.3 : w * 0.5;
      const eaves = h - rise;
      if (style === "house") {
        // the chapel after 1549: stone ground storey kept, timber-framed storeys added, gabled tiled roof
        const sh = 2.8, base = 4.6;
        b.box(stone, l, base, w, 0, 0, 0);
        const up = Math.max(2, Math.round((eaves - base) / sh));
        for (let s = 0; s < up; s++) b.box("frame", l + s * 0.3, sh, w + s * 0.35, 0, base + s * sh, 0);
        const topY = base + up * sh;
        for (const sz of [1, -1]) for (let i = 0; i < 5; i++) {
          const x = -l / 2 + (i + 0.5) * (l / 5);
          b.box("glass", 1.2, 1.5, 0.12, x, 1.7, sz * (w / 2 + 0.04));
          b.box("timber", 1.4, 0.18, 0.2, x, 1.5, sz * (w / 2 + 0.06));
        }
        b.box("dark", 1.1, 2.1, 0.14, -l * 0.28, 0, w / 2 + 0.04);
        b.box("timber", 3.4, 0.14, 0.6, l * 0.1, 1.0, w / 2 + 0.3); // a shop board
        for (let k = 0; k < 3; k++) {
          const x = -l / 3 + k * (l / 3);
          b.gable("tile", "frame", w + 0.4, l / 3 - 0.2, (l / 6) * 0.95, x, topY, 0, Math.PI / 2, 0.3);
        }
        b.box("brick", 1, 6.2, 1, l * 0.22, topY - 0.5, -w * 0.2);
        b.box("brick", 1, 5.4, 1, -l * 0.3, topY - 0.5, w * 0.2);
        return;
      }
      b.box(stone, l, eaves, w, 0, 0, 0);
      b.gable("lead", stone, l, w, rise, 0, eaves, 0, 0, style === "perpendicular" ? 0.05 : 0.35);
      const bays = 5;
      for (const sz of [1, -1]) for (let i = 0; i < bays; i++) {
        const x = -l / 2 + (i + 0.5) * (l / bays);
        const zf = sz * (w / 2 + 0.04);
        if (style === "early") {
          // paired lancets, plain buttresses
          for (const dx of [-0.55, 0.55]) b.at(x + dx, 0, zf, sz > 0 ? 0 : Math.PI, () => archPlate(b, "glass", 0.55, eaves * 0.28, 1.5, 0, eaves * 0.4, 0));
        } else {
          // large traceried windows between buttresses
          b.at(x, 0, zf, sz > 0 ? 0 : Math.PI, () => {
            archPlate(b, "glass", 1.8, eaves * 0.38, 1.8, 0, eaves * 0.3, 0);
            for (const dx of [-0.3, 0.3]) b.box("caen", 0.1, eaves * 0.38 + 1.2, 0.12, dx, eaves * 0.3, 0.02);
            b.box("caen", 1.9, 0.12, 0.12, 0, eaves * 0.3 + eaves * 0.2, 0.02);
          });
        }
        const bx = -l / 2 + i * (l / bays);
        b.box(stone, 0.8, eaves + 0.3, 0.9, bx, 0, sz * (w / 2 + 0.4));
        if (style === "perpendicular") b.cone(stone, 0.55, 2.6, 4, bx, eaves + 0.3, sz * (w / 2 + 0.4));
      }
      b.box(stone, 0.8, eaves + 0.3, 0.9, l / 2, 0, w / 2 + 0.4);
      // east end: the great window (or lancets); west end: the doorway towards the roadway
      b.at(l / 2 + 0.04, 0, 0, Math.PI / 2, () => {
        if (style === "early") for (const dx of [-1.8, 0, 1.8]) archPlate(b, "glass", 0.7, eaves * 0.3, 1.8, dx, eaves * 0.35, 0);
        else {
          archPlate(b, "glass", 4.4, eaves * 0.4, 2.8, 0, eaves * 0.3, 0);
          for (const dx of [-1.4, -0.7, 0, 0.7, 1.4]) b.box("caen", 0.09, eaves * 0.4 + 1.5, 0.12, dx, eaves * 0.3, 0.02);
        }
      });
      b.at(-l / 2 - 0.04, 0, 0, -Math.PI / 2, () => archPlate(b, "dark", 1.4, 2.4, 2.4, 0, 0, 0));
      if (style === "perpendicular") {
        battlement(b, stone, l + 0.3, w + 0.3, eaves, 0.9);
      } else {
        // a small bellcote on the west gable
        b.box(stone, 0.9, 1.8, 0.7, -l / 2 + 0.6, eaves + rise - 0.2, 0);
        b.cone("lead", 0.7, 1.0, 4, -l / 2 + 0.6, eaves + rise + 1.6, 0);
      }
    });
  }, ctx.path);
}

// ---------------------------------------------------------------------------------------------
// gate towers
// ---------------------------------------------------------------------------------------------

function bridgeGate(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const h = num(m.h, 16), w = num(m.w, 11);
  const pier = num(m.pier, STONE_GATE_PIER);
  const drawGate = pier === DRAW_GATE_PIER;
  onPier(b, ctx, pier, 8, (_pw, L) => {
    const d = 7;
    // corbelled stages carrying the width beyond the bridge face
    for (let i = 0; i < 4; i++) b.box("ragstone", d - 0.3, 0.8, w - ((w - WIDTH) * i) / 4.3, 0, -0.8 * (i + 1), 0);
    b.box("ragstone", d, h, w, 0, 0, 0);
    // passage through the tower, a pointed arch at both ends with a dressed ring, and a portcullis
    for (const sx of [1, -1]) {
      b.at(sx * (d / 2 + 0.04), 0, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2, () => {
        archPlate(b, "dark", 3.8, 2.6, 4.4, 0, 0, 0);
        const outer = archPts(4.8, 2.7, 5, -2.4, 2.6);
        const sh = new THREE.Shape();
        sh.moveTo(-2.4, 0);
        for (const [x, y] of outer) sh.lineTo(x, y);
        sh.lineTo(2.4, 0);
        sh.lineTo(1.9, 0);
        const inn = archPts(3.8, 2.2, 5, -1.9, 2.6);
        for (let k = inn.length - 1; k >= 0; k--) sh.lineTo(inn[k][0], inn[k][1]);
        sh.lineTo(-1.9, 0);
        put(b, "ashlar", new THREE.ShapeGeometry(sh), new THREE.Matrix4().setPosition(0, 0, 0.02));
        if (sx > 0) {
          for (let k = 0; k < 6; k++) b.box("timber", 0.12, 4.6, 0.12, -1.4 + k * 0.56, 0.1, 0.14);
          for (let k = 0; k < 3; k++) b.box("timber", 3.4, 0.12, 0.12, 0, 1.0 + k * 1.4, 0.14);
        }
      });
    }
    // string courses, a corbelled parapet, and a leaded roof platform
    b.box("ashlar", d + 0.3, 0.35, w + 0.3, 0, h * 0.42, 0);
    b.box("ashlar", d + 0.3, 0.35, w + 0.3, 0, h * 0.78, 0);
    for (let i = 0; i < 8; i++) for (const s of [1, -1]) b.box("ragstone", 0.5, 0.6, 0.55, -d / 2 + 0.5 + i * ((d - 1) / 7), h - 0.7, s * (w / 2 + 0.28));
    b.box("ragstone", d + 0.5, 0.45, w + 0.7, 0, h - 0.45, 0);
    battlement(b, "ragstone", d + 0.5, w + 0.7, h, 1.0);
    b.box("lead", d - 0.6, 0.15, w - 0.6, 0, h - 0.05, 0);
    // slit windows and one glazed window
    for (const sz of [1, -1]) for (let k = 0; k < 3; k++) {
      b.box("dark", 0.14, 1.3, 0.2, -d / 2 + 1.2 + k * ((d - 2.4) / 2), h * 0.55, sz * (w / 2 + 0.03));
      b.box("dark", 0.14, 1.3, 0.2, -d / 2 + 1.2 + k * ((d - 2.4) / 2), h * 0.25, sz * (w / 2 + 0.03));
    }
    b.box("glass", 0.12, 1.6, 1.2, d / 2 + 0.03, h * 0.6, 1.8);
    b.box("glass", 0.12, 1.6, 1.2, d / 2 + 0.03, h * 0.6, -1.8);
    // slender round turrets with conical caps
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const tx = (sx * d) / 2, tz = (sz * w) / 2;
      b.cyl("ragstone", 1.55, 1.7, h + 3.4, 10, tx, -0.6, tz);
      b.cyl("ashlar", 1.75, 1.75, 0.35, 10, tx, h - 0.2, tz);
      b.cone("slate", 1.9, 3.4, 10, tx, h + 2.8, tz);
      b.box("dark", 0.14, 1.1, 0.14, tx + sx * 1.5, h * 0.5, tz);
    }
    if (drawGate) {
      // winding gear: a beam and the two chains running out to the leaf
      const ow = L.openings[DRAW_OPENING].x1 - L.openings[DRAW_OPENING].x0;
      b.box("timber", 0.4, 0.4, w - 3, d / 2 + 0.4, h - 3, 0);
      for (const s of [1, -1]) bar(b, "dark", [d / 2 + 0.4, h - 2.8, s * 1.7], [d / 2 + ow - 0.6, 0.1, s * 1.7], 0.1);
    }
    if (typeof m.heads === "number") {
      // traitors' heads on poles (kept from the data: the year in `heads` is when they moved here)
      const r = rng(m.heads);
      for (let i = 0; i < 9; i++) {
        const z = -w / 2 + 1 + r() * (w - 2);
        const ph = 2.4 + r() * 1.8;
        const hx = d / 2 - 0.3 - r() * 0.5;
        b.box("timber", 0.08, ph, 0.08, hx, h + 0.4, z);
        b.add("dark", new THREE.SphereGeometry(0.17, 5, 4), new THREE.Matrix4().setPosition(hx, h + 0.4 + ph, z));
      }
    }
  }, ctx.path);
}

// ---------------------------------------------------------------------------------------------
// Nonsuch House
// ---------------------------------------------------------------------------------------------

function nonsuch(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const h = num(m.h, 17), lx = num(m.w, 15), dz = num(m.d, 7.6); // length along the bridge, depth across it
  onPier(b, ctx, DRAW_GATE_PIER, 8, (pw) => {
    const eaves = h * 0.8;
    const stories = 4;
    const sh = eaves / stories;
    const jet = 0.3;
    const panel = ["flat:#6b2f26", "flat:#2d4a57"];
    // the roadway runs through the house; the Southwark end overhangs the drawbridge opening on corbels
    for (let j = 0; j < 3; j++) {
      const ext = (lx / 2 - pw / 2) * ((3 - j) / 3) + 0.4; // widest at the top: a corbel table carrying the overhang
      b.box("ragstone", ext, 0.9, dz + 0.6, pw / 2 - 0.2 + ext / 2, -1.8 - 0.9 * (j + 1), 0);
    }
    for (let k = 0; k < 5; k++) b.box("timber", 0.45, 0.4, dz + 1.0, pw / 2 + 0.4 + k * ((lx / 2 - pw / 2) / 4.4), -2.2, 0);
    for (let s = 0; s < stories; s++) {
      const dj = dz + s * jet * 2, y = s * sh;
      b.box("plaster", lx + s * 0.1, sh + (s === 0 ? 1.8 : 0), dj, 0, y - (s === 0 ? 1.8 : 0), 0);
      for (const sz of [1, -1]) {
        const zf = sz * (dj / 2 + 0.05);
        // framing, carved posts and the bressummer
        b.box("timber", lx + 0.4 + s * 0.1, 0.34, 0.3, 0, y + sh - 0.17, sz * (dj / 2 + 0.1));
        for (let k = 0; k <= 5; k++) b.box("timber", 0.22, sh - 0.2, 0.14, -lx / 2 + 1.7 + (k * (lx - 3.4)) / 5, y + 0.05, zf);
        for (let k = 0; k < 5; k++) {
          const wx = -lx / 2 + 1.7 + ((k + 0.5) * (lx - 3.4)) / 5;
          const gh = s === 0 ? 1.2 : 1.7;
          b.box("timber", 2.0, gh + 0.2, 0.08, wx, y + 0.9, zf + sz * 0.01);
          b.box("glass", 1.8, gh, 0.1, wx, y + 1.0, zf + sz * 0.05);
          b.box("timber", 0.08, gh, 0.12, wx, y + 1.0, zf + sz * 0.08);
          b.box("timber", 1.8, 0.07, 0.12, wx, y + 1.0 + gh * 0.55, zf + sz * 0.08);
          if (s > 0) b.box(panel[(k + s) % 2], 1.7, 0.55, 0.05, wx, y + 0.28, zf + sz * 0.03);
        }
        // a projecting glazed bay up the middle of each river face
        if (s >= 1) {
          b.box("timber", 3.4, sh - 0.5, 0.75, 0, y + 0.1, sz * (dj / 2 + 0.4));
          b.box("glass", 3.0, sh - 1.4, 0.1, 0, y + 0.6, sz * (dj / 2 + 0.79));
          for (const ex of [1.7, -1.7]) b.box("glass", 0.1, sh - 1.4, 0.55, ex, y + 0.6, sz * (dj / 2 + 0.4));
          for (let k = -1; k <= 1; k++) b.box("timber", 0.09, sh - 1.3, 0.12, k * 1.0, y + 0.6, sz * (dj / 2 + 0.83));
        }
      }
      // end walls: windows over the carriage arch
      for (const sx of [1, -1]) {
        const xf = sx * (lx / 2 + 0.05);
        if (s > 0) for (const wz of [-1.5, 1.5]) {
          b.box("timber", 0.08, 1.9, 1.5, xf, y + 0.9, wz);
          b.box("glass", 0.1, 1.7, 1.3, xf + sx * 0.04, y + 1.0, wz);
        }
      }
    }
    for (const sx of [1, -1]) b.at(sx * (lx / 2 + 0.05), 0, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2, () => archPlate(b, "dark", 3.6, 2.6, 4.2, 0, 0, 0));
    // roof: three gables to each river face, lead
    const nb = 3;
    for (let k = 0; k < nb; k++) {
      const x = -lx / 2 + (k + 0.5) * (lx / nb);
      b.gable("lead", "plaster", dz + (stories - 1) * jet * 2 + 0.2, lx / nb - 0.05, 2.9, x, eaves, 0, Math.PI / 2, 0.3);
      for (const sz of [1, -1]) {
        b.box("timber", 0.9, 0.9, 0.1, x, eaves + 0.5, sz * ((dz + (stories - 1) * jet * 2) / 2 + 0.25));
        b.box("glass", 0.7, 0.7, 0.1, x, eaves + 0.6, sz * ((dz + (stories - 1) * jet * 2) / 2 + 0.31));
      }
    }
    // corner turrets with gilded onion domes and vanes
    const dome: THREE.Vector2[] = [[1.45, 0], [1.75, 0.55], [1.8, 1.0], [1.5, 1.55], [0.9, 2.1], [0.4, 2.6], [0.18, 3.1], [0.04, 3.6]].map(([r, y]) => new THREE.Vector2(r, y));
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const tx = sx * (lx / 2 - 0.2), tz = sz * (dz / 2 + 0.3);
      b.cyl("plaster", 1.4, 1.45, h + 0.6, 8, tx, -1.8, tz);
      for (let s = 1; s <= stories; s++) b.cyl("timber", 1.5, 1.5, 0.28, 8, tx, s * sh - 0.2, tz);
      for (let s = 0; s < stories; s++) for (const a of [0.4, -0.4]) {
        const ang = Math.atan2(sz, sx) + a;
        b.box("glass", 0.5, 1.2, 0.1, tx + Math.cos(ang) * 1.42, s * sh + 0.9, tz + Math.sin(ang) * 1.42, -ang + Math.PI / 2);
      }
      b.cyl("gold", 1.52, 1.52, 0.18, 8, tx, h + 0.4, tz);
      put(b, "lead", new THREE.LatheGeometry(dome, 12), new THREE.Matrix4().setPosition(tx, h + 0.55, tz));
      b.add("gold", new THREE.SphereGeometry(0.2, 6, 5), new THREE.Matrix4().setPosition(tx, h + 4.15, tz));
      b.box("gold", 0.06, 1.6, 0.06, tx, h + 4.2, tz);
      b.box("gold", 0.7, 0.45, 0.04, tx + 0.35, h + 5.4, tz);
    }
  }, ctx.path);
}

// ---------------------------------------------------------------------------------------------
// the tide mills (waterworks)
// ---------------------------------------------------------------------------------------------

function waterwheel(b: Builder, m: PhaseModel, ctx: BuildCtx) {
  const d = num(m.d, 6);
  const L = bridgeLayout(ctx.path);
  const deck = 8;
  const R = d / 2;
  b.at(L.ax, 0, L.az, L.rot, () => {
    for (const oi of [0, 1]) {
      const o = L.openings[oi];
      const ow = o.x1 - o.x0;
      const cx = (o.x0 + o.x1) / 2;
      const a = archOf(L, oi, deck);
      const gap = 0.28 * ow;
      const wp = Math.max(1.3, gap - 0.5); // paddle width between the starlings
      const cy = Math.min(2.6, a.sp + a.h - R - 0.35);
      // an undershot wheel set in the narrowed waterway: axle across the flow (along x), tide-driven
      const rim = new THREE.RingGeometry(R - 0.28, R, 14);
      rim.rotateY(Math.PI / 2);
      for (const sx of [-1, 1]) put(b, "timber-weathered", rim.clone(), new THREE.Matrix4().setPosition(cx + (sx * wp) / 2, cy, 0));
      for (let k = 0; k < 12; k++) {
        const ang = (k / 12) * Math.PI * 2;
        const mm = new THREE.Matrix4().makeRotationX(ang).setPosition(cx, cy + Math.sin(ang) * (R - 0.15), Math.cos(ang) * (R - 0.15));
        put(b, "timber", new THREE.BoxGeometry(wp, 0.1, 0.8), mm);
      }
      for (let k = 0; k < 4; k++) for (const sx of [-1, 1]) {
        const g = new THREE.BoxGeometry(0.14, 2 * R - 0.4, 0.14);
        g.rotateX((k / 4) * Math.PI);
        put(b, "timber", g, new THREE.Matrix4().setPosition(cx + (sx * wp) / 2, cy, 0));
      }
      const ax = gap / 2 + 0.7;
      b.box("timber", 2 * ax, 0.32, 0.32, cx, cy - 0.16, 0);
      for (const sx of [-1, 1]) for (const sz of [-0.5, 0.5]) b.box("timber", 0.4, cy - STARLING_TOP + 0.9, 0.4, cx + sx * (ax - 0.2), STARLING_TOP - 0.1, sz);
      b.box("timber", 2 * ax + 0.6, 0.3, 1.5, cx, cy + 0.6, 0);
    }
    // gear house on piles over the starling of the first pier, upstream of the bridge
    const p0 = L.piers[0];
    const px = (p0.x0 + p0.x1) / 2;
    b.box("timber", 6.2, 0.35, 5.6, px, STARLING_TOP + 0.5, 6.0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box("timber", 0.3, 0.6, 0.3, px + sx * 2.8, STARLING_TOP, 6.0 + sz * 2.5);
    b.box("timber-weathered", 5.2, 3.4, 4.4, px, STARLING_TOP + 0.85, 6.0);
    b.gable("tile-old", "timber-weathered", 5.2, 4.4, 2.0, px, STARLING_TOP + 4.25, 6.0);
    b.box("dark", 0.9, 1.9, 0.1, px - 1.0, STARLING_TOP + 0.85, 3.75);
  });
}

export function registerDistrictBuilders(): void {
  BUILDERS["stone-bridge"] = stoneBridge;
  BUILDERS["bridge-houses"] = bridgeHouses;
  BUILDERS["bridge-chapel"] = bridgeChapel;
  BUILDERS["bridge-gate"] = bridgeGate;
  BUILDERS["nonsuch"] = nonsuch;
  BUILDERS["waterwheel"] = waterwheel;
  for (const k of ["bridge-chapel", "bridge-gate", "nonsuch", "waterwheel"]) WORLD_SPACE_KINDS.add(k);
}
