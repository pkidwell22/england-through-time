import * as THREE from "three";
import type { PhaseModel } from "@/lib/types";
import { hashString, rng } from "@/lib/geo";
import { Builder } from "./geom";
import { BUILDERS, WORLD_SPACE_KINDS, type BuildCtx } from "./builders";
import { tileOf } from "./materials";

/**
 * Megalith kinds: `megaliths` (data-driven stone settings: sarsen uprights and lintels, trilithons,
 * bluestones, the Altar Stone, outliers) and `sightline` (an analytical solstice overlay).
 *
 * Every stone is an individually seeded, subdivided rounded box displaced into an irregular block
 * (taper, entasis, shear, planar facets, scoops, low-frequency undulation, domed/jagged tops). Shapes
 * are procedural stand-ins that respect each stone's recorded position, size and state; the surface
 * detail (pits, bedding, lichen) comes from the scanned materials, and the fine outline of any single
 * stone is invented, not surveyed.
 */

const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const sstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};
const softplus = (d: number, k: number) => (d > 8 * k ? d : k * Math.log(1 + Math.exp(d / k)));
const RAD = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

/** Seeded 3D value noise in [-1, 1]. */
class Noise {
  private perm = new Uint8Array(512);
  private val = new Float32Array(256);
  constructor(seed: number) {
    const r = rng(seed);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) this.val[i] = r() * 2 - 1;
  }
  private h(a: number, b: number, c: number): number {
    const P = this.perm;
    return this.val[P[P[P[a & 255] + (b & 255)] + (c & 255)]];
  }
  n(x: number, y: number, z: number): number {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = x - xi, fy = y - yi, fz = z - zi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    return l(
      l(l(this.h(xi, yi, zi), this.h(xi + 1, yi, zi), u), l(this.h(xi, yi + 1, zi), this.h(xi + 1, yi + 1, zi), u), v),
      l(l(this.h(xi, yi, zi + 1), this.h(xi + 1, yi, zi + 1), u), l(this.h(xi, yi + 1, zi + 1), this.h(xi + 1, yi + 1, zi + 1), u), v),
      w,
    );
  }
}

type StoneMat = "sarsen" | "bluestone" | "altar";
type TopStyle = "dome" | "flat" | "point" | "jag";

interface StoneOpts {
  seed: number;
  mat: StoneMat;
  fresh?: boolean;
  /** Full size across x (width) and z (thickness) in the stone's own frame; y runs y0..y1 with 0 = ground level. */
  w: number;
  t: number;
  y0: number;
  y1: number;
  dressed?: boolean;
  top: TopStyle;
  jagBottom?: boolean;
  bottomFace?: boolean;
  rd?: number;
  taperScale?: number;
  /** 0..1 amount of lichen on a sarsen. */
  lichen?: number;
  stepH?: number;
  stepV?: number;
  /** Uneven thickness (metres of undulation along the length), for lintels. */
  thickVar?: number;
  /** Local frame -> world, applied in place to each vertex. */
  xf: (v: THREE.Vector3) => void;
}

/** Axis coordinates from -h to h, densest in the rounded edge zones so the arrises resolve. */
function axisCoords(h: number, rd: number, step: number): number[] {
  const o = [0, 0.25, 0.65, 1].map((k) => k * rd);
  const lo = o.map((v) => -h + v);
  const hi = o.map((v) => h - v).reverse();
  const inner = h - rd;
  const n = Math.max(1, Math.round((2 * inner) / step));
  const mid: number[] = [];
  for (let k = 1; k < n; k++) mid.push(-inner + (2 * inner * k) / n);
  return [...lo, ...mid, ...hi];
}

// Face table: fixed axis (0 x, 1 y, 2 z), side (0 low / 1 high), then the (u, v) axes in an order whose cross product points outward.
const FACES: { axis: number; side: number; u: number; v: number }[] = [
  { axis: 0, side: 1, u: 1, v: 2 }, // +x
  { axis: 0, side: 0, u: 2, v: 1 }, // -x
  { axis: 1, side: 1, u: 2, v: 0 }, // +y
  { axis: 1, side: 0, u: 0, v: 2 }, // -y
  { axis: 2, side: 1, u: 0, v: 1 }, // +z
  { axis: 2, side: 0, u: 1, v: 0 }, // -z
];
const FACE_N: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Build one irregular stone block and add it to the builder. Returns the triangle count. */
function emitStone(b: Builder, o: StoneOpts): number {
  const r = rng((o.seed >>> 0) || 1);
  const nz = new Noise(o.seed ^ 0x9e3779b1);
  const hx = o.w / 2, hz = o.t / 2, hy = (o.y1 - o.y0) / 2, cy = (o.y0 + o.y1) / 2;
  const dressed = !!o.dressed;
  const bluestone = o.mat === "bluestone";
  const minDim = Math.min(o.w, o.t, o.y1 - o.y0);
  const rd = clamp(o.rd ?? (bluestone ? 0.07 + r() * 0.08 : dressed ? 0.14 + r() * 0.12 : 0.18 + r() * 0.2), 0.02, minDim * 0.42);
  const sH = o.stepH ?? (bluestone ? 0.2 : 0.26);
  const sV = o.stepV ?? (bluestone ? 0.3 : 0.36);
  const X = axisCoords(hx, rd, sH), Y = axisCoords(hy, rd, sV), Z = axisCoords(hz, rd, sH);
  const NX = X.length, NY = Y.length, NZ = Z.length;
  const dims = [NX, NY, NZ];

  // Shape parameters (all per-stone, from the seed).
  const tp = (o.taperScale ?? 1) * (dressed ? 0.95 : 1);
  const bt = r() < 0.75 ? -(0.03 + r() * 0.1) : 0.02 + r() * 0.06;
  const tl = (bt + (r() - 0.5) * 0.06) * tp, tr = (bt + (r() - 0.5) * 0.06) * tp;
  const tf = (bt * 0.7 + (r() - 0.5) * 0.05) * tp, tb = (bt * 0.7 + (r() - 0.5) * 0.05) * tp;
  const entasis = (r() - 0.35) * 0.06 * tp;
  const wanderX = (0.08 + r() * 0.1) * tp, wanderZ = (0.05 + r() * 0.06) * tp, bulge = (0.05 + r() * 0.05) * tp;
  const shx = (r() - 0.5) * 0.34 * tp, shz = (r() - 0.5) * 0.22 * tp, twist = (r() - 0.5) * 0.1 * tp;
  const yRef = Math.max(o.y1, 0.5);
  const small = clamp(minDim / 1.2, 0.35, 1.3);
  const domeAmp = o.top === "flat" ? 0.05 + r() * 0.09 : o.top === "dome" ? (0.25 + r() * 0.4) * small : 0;
  const tiltX = (o.top === "flat" ? 0.12 : 0.2) * (r() - 0.5) * 2 * small;
  const tiltZ = (o.top === "flat" ? 0.05 : 0.14) * (r() - 0.5) * 2 * small;
  const topNoise = o.top === "flat" ? 0.03 : 0.1 * small;
  const topRange = Math.max(1.0, domeAmp * 2.6);
  const jagAmp = 0.4 * small + 0.1, jagRange = 0.75;
  const jp = Array.from({ length: 3 }, () => [(r() - 0.5) * 2.4, (r() - 0.5) * 2.4, (r() - 0.5) * 0.5] as const);
  const jq = Array.from({ length: 3 }, () => [(r() - 0.5) * 2.4, (r() - 0.5) * 2.4, (r() - 0.5) * 0.5] as const);
  const pointLen = Math.min(0.55 * o.y1, 0.9 + r() * 0.5);
  const nOff = [r() * 90, r() * 90, r() * 90, r() * 90, r() * 90, r() * 90];
  const eroA = (dressed ? 0.06 : 0.1) * (bluestone ? 0.4 : 1) * (0.7 + r() * 0.6);
  const chipA = (dressed ? 0.05 : 0.09) * (bluestone ? 0.4 : 1);

  // Planar facets: a few large flat cuts through the corners.
  const cuts: { nx: number; ny: number; nz: number; c: number; k: number }[] = [];
  const nCuts = dressed ? 1 + Math.floor(r() * 2) : bluestone ? 3 : 4;
  for (let i = 0; i < nCuts; i++) {
    const a = r() * Math.PI * 2;
    let nx = Math.cos(a), nzv = Math.sin(a), ny = -0.2 + r() * 0.9;
    const l = Math.hypot(nx, ny, nzv);
    nx /= l; ny /= l; nzv /= l;
    const depth = (0.08 + r() * 0.34) * clamp(minDim / 1.0, 0.4, 1.4) * (dressed ? 0.5 : 1);
    cuts.push({ nx, ny, nz: nzv, c: Math.abs(nx) * hx + Math.abs(ny) * hy + Math.abs(nzv) * hz - depth, k: 0.09 });
  }
  // Scoops (flake scars) and bulges on the faces.
  const scoops: { x: number; y: number; z: number; rad: number; depth: number }[] = [];
  const nScoops = dressed ? 3 : bluestone ? 3 : 7;
  for (let i = 0; i < nScoops; i++) {
    const pick = r();
    const sg = i % 3 === 2 ? -0.7 : 1; // every third one is a bulge
    const sc = { x: (r() * 2 - 1) * hx * 0.8, y: cy + (r() * 2 - 1) * hy * 0.8, z: (r() * 2 - 1) * hz * 0.8, rad: 0.5 + r() * 0.8, depth: (0.06 + r() * 0.12) * sg };
    if (pick < 0.15) sc.y = o.y1;
    else if (pick < 0.575) sc.z = (r() < 0.5 ? -1 : 1) * hz;
    else sc.x = (r() < 0.5 ? -1 : 1) * hx;
    scoops.push(sc);
  }
  const A1 = bluestone ? 0.05 : o.mat === "altar" ? 0.03 : 0.11;
  const A2 = A1 * 0.5;

  // Welded surface vertices (shared across faces so the arrises stay closed and the normals smooth).
  const vid = new Int32Array(NX * NY * NZ).fill(-1);
  const PW: number[] = [];
  const PL: number[] = [];
  const tmp = new THREE.Vector3();
  const getV = (i: number, j: number, k: number): number => {
    const key = i + NX * (j + NY * k);
    let id = vid[key];
    if (id >= 0) return id;
    id = PW.length / 3;
    vid[key] = id;
    const px = X[i], py = Y[j], pz = Z[k];
    const ix = hx - rd, iy = hy - rd, iz = hz - rd;
    const cxp = clamp(px, -ix, ix), cyp = clamp(py, -iy, iy), czp = clamp(pz, -iz, iz);
    let dx = px - cxp, dy = py - cyp, dz = pz - czp;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    let qx = cxp + dx * rd, qy = cyp + dy * rd + cy, qz = czp + dz * rd;
    // Arris erosion: rounds the edges more (and unevenly) where noise says so, plus occasional chips.
    const edge = 1 - sstep(0.62, 0.97, Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)));
    if (edge > 0) {
      const er = edge * (eroA * (0.3 + 0.7 * (0.5 + 0.5 * nz.n(qx * 1.2 + nOff[0], qy * 1.2 + nOff[1], qz * 1.2 + nOff[2]))) + chipA * sstep(0.35, 0.75, nz.n(qx * 2.4 + nOff[3], qy * 2.4 + nOff[4], qz * 2.4 + nOff[5])));
      qx -= dx * er; qy -= dy * er; qz -= dz * er;
    }
    let x = qx, y = qy, z = qz;
    // taper / entasis / shear / twist
    const u = clamp(y / yRef, 0, 1);
    const ent = entasis * Math.sin(Math.PI * u);
    x *= 1 + (x < 0 ? tl : tr) * u + ent;
    z *= 1 + (z < 0 ? tf : tb) * u + ent;
    x *= 1 + bulge * nz.n(qy * 0.9 + nOff[2], qz * 0.9 + (x < 0 ? 0 : 20), 0.5);
    z *= 1 + bulge * 0.8 * nz.n(qy * 0.9 + nOff[3], qx * 0.9 + (z < 0 ? 0 : 20), 2.5);
    x += shx * u * u + wanderX * nz.n(qy * 0.45 + nOff[4], 9.5, 0.5) * u;
    z += shz * u * u + wanderZ * nz.n(qy * 0.5 + nOff[5], 2.5, 7.5) * u;
    const ca = Math.cos(twist * u), sa = Math.sin(twist * u);
    const xr = x * ca - z * sa;
    z = x * sa + z * ca;
    x = xr;
    if (o.thickVar) {
      const w = clamp(0.5 + (y - cy) / (2 * hy), 0, 1);
      y += o.thickVar * (w * nz.n(x * 0.5 + nOff[0], 3.7, z * 0.9) + 0.3 * (1 - w) * nz.n(x * 0.7 + nOff[1], 8.2, z * 0.9));
    }
    // top and broken ends
    if (o.top === "dome" || o.top === "flat") {
      const wt = sstep(o.y1 - topRange, o.y1, y);
      const rr2 = Math.min(1.4, (x / hx) * (x / hx) + (z / hz) * (z / hz));
      y += -wt * domeAmp * rr2 + wt * (tiltX * (x / hx) + tiltZ * (z / hz)) + wt * topNoise * nz.n(x * 1.3 + nOff[0], 7.1, z * 1.3 + nOff[1]);
    } else if (o.top === "point") {
      const f = sstep(o.y1 - pointLen, o.y1, y);
      const s = 1 - 0.88 * Math.pow(f, 1.2);
      x *= s;
      z *= s;
    } else {
      // conchoidal / jagged fracture: a few intersecting fracture planes plus ripples
      const wt = sstep(o.y1 - jagRange, o.y1, y);
      const fr = Math.max(jp[0][0] * (x / hx) + jp[0][1] * (z / hz), jp[1][0] * (x / hx) + jp[1][1] * (z / hz) + 0.2, jp[2][0] * (x / hx) + jp[2][1] * (z / hz) - 0.2);
      const rip = 0.28 * nz.n(x * 2.2 + nOff[2], 3.3, z * 2.2 + nOff[3]) + 0.12 * nz.n(x * 5 + nOff[0], 1.1, z * 5 + nOff[1]);
      y -= wt * jagAmp * Math.max(0.0, 0.75 + 0.55 * fr + rip);
      x += wt * 0.05 * nz.n(x * 3 + nOff[4], y * 3, z * 3);
    }
    if (o.jagBottom) {
      const wb = sstep(o.y0 + jagRange, o.y0, y);
      const fr = Math.max(jq[0][0] * (x / hx) + jq[0][1] * (z / hz), jq[1][0] * (x / hx) + jq[1][1] * (z / hz) + 0.2, jq[2][0] * (x / hx) + jq[2][1] * (z / hz) - 0.2);
      const rip = 0.28 * nz.n(x * 2.2 + nOff[4], 5.5, z * 2.2 + nOff[5]) + 0.12 * nz.n(x * 5 + nOff[2], 2.1, z * 5 + nOff[3]);
      y += wb * jagAmp * Math.max(0.0, 0.75 + 0.55 * fr + rip);
    }
    // facets
    for (const c of cuts) {
      const d = x * c.nx + (y - cy) * c.ny + z * c.nz - c.c;
      if (d > -c.k * 6) {
        const s = softplus(d, c.k);
        x -= c.nx * s; y -= c.ny * s; z -= c.nz * s;
      }
    }
    // surface relief along the outward normal
    let fd = 1;
    if (dressed) {
      fd = dz < 0 ? 0.35 + 0.25 * (1 + dz) : 0.65 + 0.35 * dz;
      if (dy > 0.7) fd = 0.7;
    }
    let disp = (A1 * nz.n(qx / 1.3 + nOff[0], qy / 1.3 + nOff[1], qz / 1.3 + nOff[2]) + A2 * nz.n(qx / 0.55 + nOff[3], qy / 0.55 + nOff[4], qz / 0.55 + nOff[5]) + A2 * 0.35 * nz.n(qx / 0.22 + nOff[1], qy / 0.22 + nOff[2], qz / 0.22 + nOff[3])) * fd;
    for (const s of scoops) {
      const dd = Math.hypot(qx - s.x, qy - s.y, qz - s.z);
      if (dd < s.rad) disp -= s.depth * (1 - sstep(0, s.rad, dd)) * (dressed ? 0.5 : 1);
    }
    x += dx * disp; y += dy * disp; z += dz * disp;
    PL.push(x, y, z);
    tmp.set(x, y, z);
    o.xf(tmp);
    PW.push(tmp.x, tmp.y, tmp.z);
    return id;
  };

  // Quads per face
  const quads: number[] = []; // a, b, c, d, face
  for (let f = 0; f < 6; f++) {
    if (f === 3 && !o.bottomFace) continue;
    const F = FACES[f];
    const nu = dims[F.u], nv = dims[F.v];
    const fixed = F.side ? dims[F.axis] - 1 : 0;
    const vtx = (iu: number, iv: number) => {
      const ijk = [0, 0, 0];
      ijk[F.axis] = fixed;
      ijk[F.u] = iu;
      ijk[F.v] = iv;
      return getV(ijk[0], ijk[1], ijk[2]);
    };
    for (let iu = 0; iu < nu - 1; iu++)
      for (let iv = 0; iv < nv - 1; iv++) quads.push(vtx(iu, iv), vtx(iu + 1, iv), vtx(iu + 1, iv + 1), vtx(iu, iv + 1), f);
  }

  // Smooth normals on the welded mesh
  const nV = PW.length / 3;
  const NRM = new Float32Array(nV * 3);
  const addTri = (a: number, bb: number, c: number) => {
    const ax = PW[a * 3], ay = PW[a * 3 + 1], az = PW[a * 3 + 2];
    const e1x = PW[bb * 3] - ax, e1y = PW[bb * 3 + 1] - ay, e1z = PW[bb * 3 + 2] - az;
    const e2x = PW[c * 3] - ax, e2y = PW[c * 3 + 1] - ay, e2z = PW[c * 3 + 2] - az;
    const cx = e1y * e2z - e1z * e2y, cy2 = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    for (const v of [a, bb, c]) {
      NRM[v * 3] += cx; NRM[v * 3 + 1] += cy2; NRM[v * 3 + 2] += cz;
    }
  };
  for (let q = 0; q < quads.length; q += 5) {
    addTri(quads[q], quads[q + 1], quads[q + 2]);
    addTri(quads[q], quads[q + 2], quads[q + 3]);
  }
  for (let v = 0; v < nV; v++) {
    const l = Math.hypot(NRM[v * 3], NRM[v * 3 + 1], NRM[v * 3 + 2]) || 1;
    NRM[v * 3] /= l; NRM[v * 3 + 1] /= l; NRM[v * 3 + 2] /= l;
  }

  // Lichen: a smooth scalar field over the welded vertices (3D noise, favouring up-facing and south-west surfaces); triangles that
  // straddle the iso-line are clipped, so the patch edges follow the contour rather than the grid.
  const lr = rng(o.seed + 7777);
  const lichenAmt = o.mat === "sarsen" && !o.fresh ? clamp(o.lichen ?? lr() * lr() * 1.4, 0, 0.7) : 0;
  const LF = new Float32Array(nV);
  if (lichenAmt > 0.02) {
    const lo = [lr() * 50, lr() * 50, lr() * 50];
    const bias = (lichenAmt - 0.3) * 0.9;
    for (let v = 0; v < nV; v++) {
      const lx = PL[v * 3], ly = PL[v * 3 + 1], lz = PL[v * 3 + 2];
      const s = 0.6 * nz.n(lx * 1.0 + lo[0], ly * 1.0 + lo[1], lz * 1.0 + lo[2]) + 0.4 * nz.n(lx * 2.9 + lo[1], ly * 2.9 + lo[2], lz * 2.9 + lo[0]);
      const nyw = NRM[v * 3 + 1];
      let ori = 0;
      if (nyw > 0.35) ori = 0.35;
      else if (nyw > -0.5) {
        const az = Math.atan2(NRM[v * 3], -NRM[v * 3 + 2]);
        ori = 0.05 + 0.2 * (0.5 + 0.5 * Math.cos(az - 225 * RAD));
      } else ori = -0.3;
      LF[v] = s + ori + bias - 0.52;
    }
  } else LF.fill(-1);

  const baseMat = o.mat === "sarsen" ? (o.fresh ? "sarsen-fresh" : "sarsen") : o.mat;
  const tiles = new Map<string, number>();
  const tileFor = (m: string) => {
    let t = tiles.get(m);
    if (t === undefined) tiles.set(m, (t = tileOf(m)));
    return t;
  };
  const off: [number, number][] = [];
  for (let f = 0; f < 6; f++) off.push([lr() * 12, lr() * 12]);
  const buckets = new Map<string, { p: number[]; n: number[]; uv: number[] }>();
  let tris = 0;
  type Vx = number[]; // px py pz nx ny nz lx ly lz f
  const mk = (id: number): Vx => [PW[id * 3], PW[id * 3 + 1], PW[id * 3 + 2], NRM[id * 3], NRM[id * 3 + 1], NRM[id * 3 + 2], PL[id * 3], PL[id * 3 + 1], PL[id * 3 + 2], LF[id]];
  const lerpV = (a: Vx, c: Vx): Vx => {
    const t = a[9] / (a[9] - c[9]);
    const o2 = a.map((v, i) => v + (c[i] - v) * t);
    const l = Math.hypot(o2[3], o2[4], o2[5]) || 1;
    o2[3] /= l; o2[4] /= l; o2[5] /= l;
    o2[9] = 0;
    return o2;
  };
  const emitPoly = (mat: string, f: number, poly: Vx[]) => {
    let bk = buckets.get(mat);
    if (!bk) buckets.set(mat, (bk = { p: [], n: [], uv: [] }));
    const tile = tileFor(mat);
    for (let i = 1; i < poly.length - 1; i++) {
      for (const v of [poly[0], poly[i], poly[i + 1]]) {
        bk.p.push(v[0], v[1], v[2]);
        bk.n.push(v[3], v[4], v[5]);
        const [a, bq] = f < 2 ? [v[8], v[7]] : f < 4 ? [v[6], v[8]] : [v[6], v[7]];
        bk.uv.push(a / tile + off[f][0], bq / tile + off[f][1]);
      }
      tris++;
    }
  };
  const emitTri = (f: number, a: Vx, c1: Vx, c2: Vx) => {
    const P = [a, c1, c2];
    const nPos = P.filter((v) => v[9] >= 0).length;
    if (nPos === 0) return emitPoly(baseMat, f, P);
    if (nPos === 3) return emitPoly("sarsen-lichen", f, P);
    const pos: Vx[] = [], neg: Vx[] = [];
    for (let i = 0; i < 3; i++) {
      const A = P[i], B = P[(i + 1) % 3];
      (A[9] >= 0 ? pos : neg).push(A);
      if ((A[9] >= 0) !== (B[9] >= 0)) {
        const m = lerpV(A, B);
        pos.push(m);
        neg.push(m);
      }
    }
    emitPoly("sarsen-lichen", f, pos);
    emitPoly(baseMat, f, neg);
  };
  for (let q = 0; q < quads.length; q += 5) {
    const f = quads[q + 4];
    const V = [mk(quads[q]), mk(quads[q + 1]), mk(quads[q + 2]), mk(quads[q + 3])];
    emitTri(f, V[0], V[1], V[2]);
    emitTri(f, V[0], V[2], V[3]);
  }
  for (const [mat, bk] of buckets) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(bk.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(bk.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(bk.uv, 2));
    b.add(mat, g);
  }
  return tris;
}

/** A low, irregular knob (tenon) in the stone's own material, its base sunk into the stone's top at the origin of `M`. */
function emitTenon(b: Builder, M: THREE.Matrix4, mat: StoneMat, fresh: boolean, seed: number, scale = 1): number {
  const r = rng(seed);
  return emitStone(b, {
    seed, mat, fresh, w: (0.62 + r() * 0.16) * scale, t: (0.56 + r() * 0.14) * scale, y0: -0.15, y1: 0.25, dressed: false, top: "dome",
    rd: 0.12, taperScale: 0.5, lichen: 0, stepH: 0.16, stepV: 0.12, xf: (v) => v.applyMatrix4(M),
  });
}

// ---------------------------------------------------------------------------------------------------------------------

interface Spec {
  id: string;
  type: string;
  role: string;
  x: number; // world
  z: number;
  az: number; // polar azimuth from the anchor, degrees
  r: number;
  w: number;
  t: number;
  h: number;
  faceAz: number;
  state: string;
  lean: number;
  leanToward: number;
  fallToward?: number;
  pieces: number;
  on: string[];
  curved: boolean;
  dressed: boolean;
  tenons: boolean;
  seed: number;
  pointed?: boolean;
  /** Computed: ground at the stone's centre. */
  g: number;
}

const stoneMat = (type: string): StoneMat => (type === "bluestone" ? "bluestone" : type === "altar" ? "altar" : "sarsen");

function parseStone(raw: Record<string, unknown>, ctx: BuildCtx, idx: number): Spec {
  const type = typeof raw.type === "string" ? raw.type : "sarsen";
  const role = typeof raw.role === "string" ? raw.role : type === "altar" ? "slab" : "upright";
  const id = raw.id != null ? String(raw.id) : `s${idx}`;
  let x: number, z: number;
  if (typeof raw.az === "number" && typeof raw.r === "number") {
    x = ctx.x + raw.r * Math.sin(raw.az * RAD);
    z = ctx.z - raw.r * Math.cos(raw.az * RAD);
  } else {
    x = ctx.x + num(raw.x, 0);
    z = ctx.z + num(raw.z, 0);
  }
  const dx = x - ctx.x, dz = z - ctx.z;
  const r = Math.hypot(dx, dz);
  const az = r > 1e-6 ? Math.atan2(dx, -dz) / RAD : 0;
  const isLintel = role === "lintel";
  const w = num(raw.w, type === "bluestone" ? 0.8 : isLintel ? 3.2 : type === "altar" ? 4.9 : 2.1);
  const t = num(raw.t, type === "bluestone" ? 0.5 : isLintel ? 1.0 : type === "altar" ? 1.0 : 1.1);
  const h = num(raw.h, type === "bluestone" ? 1.8 : isLintel ? 0.8 : type === "altar" ? 0.5 : 4.1);
  const faceAz = typeof raw.face === "number" ? raw.face : r > 0.5 ? az + 180 : role === "slab" ? (ctx.bearing ?? 0) + 90 : 0;
  return {
    id, type, role, x, z, az, r, w, t, h, faceAz,
    state: typeof raw.state === "string" ? raw.state : "standing",
    lean: num(raw.lean, 0),
    leanToward: num(raw.leanToward, az + 180),
    fallToward: typeof raw.fallToward === "number" ? raw.fallToward : undefined,
    pieces: Math.max(1, Math.round(num(raw.pieces, 1))),
    on: Array.isArray(raw.on) ? raw.on.map(String) : [],
    curved: raw.curved === true,
    dressed: raw.dressed === true,
    tenons: raw.tenons === true,
    seed: (hashString(id + type) + ctx.seed * 131 + idx * 17) >>> 0,
    g: ctx.ground(x, z),
  };
}

/** Parametric ring of stones (Aubrey-hole bluestones, the Q/R double arc, …). */
function expandRing(raw: Record<string, unknown>, ctx: BuildCtx, ringIdx: number): Spec[] {
  const type = typeof raw.type === "string" ? raw.type : "bluestone";
  const R = num(raw.r, 11.6);
  const count = Math.max(1, Math.round(num(raw.count, 30)));
  const from = num(raw.from, 0), to = num(raw.to, 360);
  const span = to - from;
  const full = Math.abs(span) >= 359.9;
  const step = full ? span / count : count > 1 ? span / (count - 1) : 0;
  const range = (v: unknown, d: [number, number]): [number, number] =>
    Array.isArray(v) && v.length >= 2 ? [num(v[0], d[0]), num(v[1], d[1])] : typeof v === "number" ? [v, v] : d;
  const wR = range(raw.w, [0.6, 1.1]), tR = range(raw.t, [0.4, 0.7]), hR = range(raw.h, [1.4, 2.3]);
  const jitter = num(raw.jitter, 0.3);
  const skip = new Set<number>(Array.isArray(raw.skip) ? (raw.skip as unknown[]).map((v) => num(v, -1)) : []);
  const state = typeof raw.state === "string" ? raw.state : "standing";
  const seed = num(raw.seed, ringIdx + 1);
  const r = rng(seed * 7919 + 13);
  const out: Spec[] = [];
  for (let i = 0; i < count; i++) {
    const a = from + step * i;
    const rr = r(), rw = r(), rt = r(), rh = r(), j1 = r(), j2 = r(), fj = r(), pp = r();
    if (skip.has(i)) continue;
    const az = a + ((j2 * 2 - 1) * jitter) / R / RAD;
    const rad = R + (j1 * 2 - 1) * jitter;
    const x = ctx.x + rad * Math.sin(az * RAD), z = ctx.z - rad * Math.cos(az * RAD);
    out.push({
      id: `ring${ringIdx}-${i}`, type, role: "upright", x, z, az, r: rad,
      w: wR[0] + rw * (wR[1] - wR[0]), t: tR[0] + rt * (tR[1] - tR[0]), h: hR[0] + rh * (hR[1] - hR[0]),
      faceAz: az + 180 + (fj * 2 - 1) * 22, state, lean: 0, leanToward: az + 180, pieces: 1,
      on: [], curved: false, dressed: false, tenons: false,
      seed: (hashString(`ring${ringIdx}-${i}`) + seed * 977 + ctx.seed) >>> 0,
      pointed: type === "bluestone" && pp < 0.3 + rr * 0, g: ctx.ground(x, z),
    });
  }
  return out;
}

const TILE_ROT = (faceAz: number) => -faceAz * RAD;

function sinkFor(ctx: BuildCtx, s: Spec, ry: number, extra: number): { gmin: number; gmax: number } {
  let gmin = s.g, gmax = s.g;
  const c = Math.cos(ry), sn = Math.sin(ry);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
    const lx = (dx * s.w) / 2, lz = (dz * s.t) / 2;
    const g = ctx.ground(s.x + lx * c + lz * sn + extra * 0, s.z - lx * sn + lz * c);
    gmin = Math.min(gmin, g);
    gmax = Math.max(gmax, g);
  }
  return { gmin, gmax };
}

interface BuildStats {
  tris: number;
  stones: number;
}
export const megalithStats: BuildStats = { tris: 0, stones: 0 };

/** Dispatch one stone into the builder. `topY` (world) overrides the top of a supporting upright. */
function buildUpright(b: Builder, ctx: BuildCtx, s: Spec, surface: string, topY: number | undefined, hasLintel: boolean): number {
  const r = rng(s.seed + 11);
  const mat = stoneMat(s.type);
  const fresh = surface === "fresh" && mat === "sarsen";
  const ry = TILE_ROT(s.faceAz);
  let h = s.h;
  let top: TopStyle = s.dressed || mat === "altar" ? "flat" : "dome";
  let state = s.state;
  let lean = state === "leaning" ? clamp(s.lean, 0, 70) * RAD : 0;
  if (state === "stump") {
    h = clamp(s.h > 0.8 ? 0.3 + r() * 0.5 : s.h, 0.2, 0.8);
    top = "jag";
  } else if (state === "buried") {
    h = 0.1 + r() * 0.15;
    top = "dome";
  } else if (topY !== undefined) {
    h = Math.max(0.5, topY - s.g);
    top = "flat";
  } else if (mat === "bluestone" && s.pointed) top = "point";
  if (state !== "leaning") lean = 0;
  const { gmin } = sinkFor(ctx, s, ry, 0);
  const sink = 0.5 + Math.max(0, s.g - gmin) + Math.sin(lean) * (Math.max(s.w, s.t) / 2 + 0.4);
  const q = new THREE.Quaternion();
  if (lean > 0) {
    const lt = s.leanToward * RAD;
    q.setFromUnitVectors(UP, new THREE.Vector3(Math.sin(lt) * Math.sin(lean), Math.cos(lean), -Math.cos(lt) * Math.sin(lean)).normalize());
  }
  const M = new THREE.Matrix4()
    .makeTranslation(s.x, s.g, s.z)
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
    .multiply(new THREE.Matrix4().makeRotationY(ry));
  const buried = state === "buried";
  let tris = emitStone(b, {
    seed: s.seed, mat, fresh, w: buried ? s.w * 0.8 : s.w, t: buried ? s.t * 0.8 : s.t, y0: -sink, y1: h, dressed: s.dressed && !buried, top,
    taperScale: buried ? 0 : 1, lichen: undefined, xf: (v) => v.applyMatrix4(M),
  });
  if (s.tenons && !hasLintel && state === "standing" && top !== "jag") {
    const n = s.w > 1.6 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const lx = n === 1 ? 0 : (i === 0 ? -1 : 1) * s.w * 0.24;
      const Mt = M.clone().multiply(new THREE.Matrix4().makeTranslation(lx, h - 0.02, 0));
      tris += emitTenon(b, Mt, mat, fresh, s.seed + 31 * i, s.w > 1.6 ? 1 : 1.1);
    }
  }
  return tris;
}

/** A stone lying on the ground (fallen or broken), its base at the socket (or `start`), length along azimuth `dirAz`. */
function buildLying(
  b: Builder, ctx: BuildCtx, s: Spec, surface: string, L: number, cross: [number, number], start: [number, number], dirAz: number,
  pieces: number, opts: { dressed?: boolean; bottomJag?: boolean; sunk?: number } = {},
): number {
  const r = rng(s.seed + 23);
  const mat = stoneMat(s.type);
  const fresh = surface === "fresh" && mat === "sarsen";
  const a = Math.max(cross[0], cross[1]), bt = Math.min(cross[0], cross[1]);
  const dir0 = new THREE.Vector2(Math.sin(dirAz * RAD), -Math.cos(dirAz * RAD));
  let tris = 0;
  // piece lengths
  const wts = Array.from({ length: pieces }, () => 0.75 + r() * 0.5);
  const gaps = pieces > 1 ? 0.1 + r() * 0.15 : 0;
  const total = wts.reduce((p, c) => p + c, 0);
  const usable = L - gaps * (pieces - 1);
  let at = 0;
  const lichen = r() * 0.5;
  for (let k = 0; k < pieces; k++) {
    const Lp = (wts[k] / total) * usable;
    const yaw = k === 0 ? 0 : (r() - 0.5) * 0.18;
    const dAz = dirAz + yaw / RAD + (k > 0 ? (r() - 0.5) * 5 : 0);
    const dir = new THREE.Vector2(Math.sin(dAz * RAD), -Math.cos(dAz * RAD));
    const sx = start[0] + dir0.x * at, sz = start[1] + dir0.y * at;
    const sunk = (opts.sunk ?? 0.2 + r() * 0.2) + (pieces > 1 ? (r() - 0.5) * 0.12 : 0);
    const ex = sx + dir.x * Lp, ez = sz + dir.y * Lp;
    const ys = ctx.ground(sx, sz) + bt / 2 - sunk, ye = ctx.ground(ex, ez) + bt / 2 - sunk;
    let deficit = 0;
    for (let i = 0; i <= 4; i++) {
      const f = i / 4;
      const gl = ctx.ground(sx + (ex - sx) * f, sz + (ez - sz) * f) + bt / 2 - sunk - 0.12;
      deficit = Math.max(deficit, gl - (ys + (ye - ys) * f));
    }
    const y0 = ys + deficit, y1 = ye + deficit;
    const pitch = Math.atan2(y1 - y0, Lp) + (pieces > 1 ? (r() - 0.5) * 0.08 : 0);
    const yd = new THREE.Vector3(dir.x * Math.cos(pitch), Math.sin(pitch), dir.y * Math.cos(pitch)).normalize();
    const roll = (r() - 0.5) * 0.5;
    let zd = UP.clone().sub(yd.clone().multiplyScalar(UP.dot(yd))).normalize();
    zd = zd.multiplyScalar(Math.cos(roll)).add(new THREE.Vector3().crossVectors(yd, zd).multiplyScalar(Math.sin(roll)));
    const xd = new THREE.Vector3().crossVectors(yd, zd).normalize();
    const M = new THREE.Matrix4().makeBasis(xd, yd, zd).setPosition(sx, y0, sz);
    const broken = pieces > 1;
    tris += emitStone(b, {
      seed: s.seed + 101 * k, mat, fresh, w: a, t: bt, y0: 0, y1: Lp, dressed: opts.dressed, top: broken || opts.bottomJag ? "jag" : "dome",
      jagBottom: k > 0 || opts.bottomJag, bottomFace: true, lichen, xf: (v) => v.applyMatrix4(M),
    });
    at += Lp + gaps;
  }
  return tris;
}

function buildSlab(b: Builder, ctx: BuildCtx, s: Spec, surface: string): number {
  const r = rng(s.seed + 5);
  const mat = stoneMat(s.type);
  const ry = TILE_ROT(s.faceAz);
  const pieces = s.state === "broken" ? Math.max(2, s.pieces) : 1;
  const L = s.w, D = s.t, T = s.h;
  if (s.state === "standing" && pieces === 1) {
    const { gmin, gmax } = sinkFor(ctx, s, ry, 0);
    const M = new THREE.Matrix4().makeTranslation(s.x, s.g, s.z).multiply(new THREE.Matrix4().makeRotationY(ry));
    const top = Math.max(gmax + 0.12, s.g + T - 0.12);
    return emitStone(b, {
      seed: s.seed, mat, fresh: false, w: L, t: D, y0: gmin - s.g - 0.3, y1: top - s.g, dressed: false, top: "flat", taperScale: 0.3,
      rd: 0.14, bottomFace: false, xf: (v) => v.applyMatrix4(M),
    });
  }
  // fallen / broken slab: pieces along its length, lying flat, slightly tilted
  let tris = 0;
  const cx = Math.cos(ry), sx = Math.sin(ry);
  const alongX = cx, alongZ = -sx; // local x direction in world
  const gap = pieces > 1 ? 0.12 + r() * 0.18 : 0;
  const usable = L - gap * (pieces - 1);
  const wts = Array.from({ length: pieces }, () => 0.7 + r() * 0.6);
  const tot = wts.reduce((p, c) => p + c, 0);
  let at = -L / 2;
  const tiltBase = s.lean * RAD * (s.state === "fallen" ? 1 : 0);
  for (let k = 0; k < pieces; k++) {
    const Lp = (wts[k] / tot) * usable;
    const mx = s.x + alongX * (at + Lp / 2), mz = s.z + alongZ * (at + Lp / 2);
    const g = ctx.ground(mx, mz);
    let gmax = g;
    for (const f of [-0.5, 0.5]) gmax = Math.max(gmax, ctx.ground(mx + alongX * Lp * f, mz + alongZ * Lp * f));
    const yaw = ry + (r() - 0.5) * 0.14;
    const tilt = tiltBase + (r() - 0.5) * 0.1;
    const roll = (r() - 0.5) * 0.07;
    const M = new THREE.Matrix4()
      .makeTranslation(mx, gmax - 0.1 - T * 0.5 + T * 0.5, mz)
      .multiply(new THREE.Matrix4().makeRotationY(yaw))
      .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(roll, 0, tilt)));
    tris += emitStone(b, {
      seed: s.seed + 53 * k, mat, w: Lp, t: D, y0: -0.3, y1: T, dressed: false, top: pieces > 1 ? "jag" : "flat", taperScale: 0.3, rd: 0.13,
      bottomFace: true, jagBottom: false, xf: (v) => v.applyMatrix4(M),
    });
    at += Lp + gap;
  }
  void surface;
  return tris;
}

function buildCurvedLintel(b: Builder, ctx: BuildCtx, s: Spec, sup: Spec[], underside: number, surface: string): number {
  const r = rng(s.seed + 3);
  const mat = stoneMat(s.type);
  const fresh = surface === "fresh" && mat === "sarsen";
  const Rm = sup.reduce((p, c) => p + c.r, 0) / sup.length;
  // midpoint azimuth of the supporting uprights (unit-vector mean avoids wrap problems)
  let mx = 0, mz = 0;
  for (const u of sup) {
    mx += Math.sin(u.az * RAD);
    mz += Math.cos(u.az * RAD);
  }
  const alpha = Math.atan2(mx, mz);
  const L = Math.max(0.5, s.w - 0.03);
  const T = s.t, H = s.h;
  const ox = ctx.x, oz = ctx.z;
  const jitterY = (r() - 0.5) * 0.02;
  return emitStone(b, {
    seed: s.seed, mat, fresh, w: L, t: T, y0: 0, y1: H, dressed: true, top: "flat", taperScale: 0.1, rd: 0.13 + r() * 0.09, bottomFace: true, thickVar: 0.05,
    lichen: 0.2 + r() * 0.35, stepH: 0.26, stepV: 0.22,
    xf: (v) => {
      // local x runs counter-clockwise (keeps the frame right-handed), z is radial outward
      const a = alpha - v.x / Rm;
      const rad = Rm + v.z;
      const y = underside + v.y + jitterY;
      v.set(ox + rad * Math.sin(a), y, oz - rad * Math.cos(a));
    },
  });
}

function buildStraightLintel(b: Builder, ctx: BuildCtx, s: Spec, sup: Spec[], underside: number, surface: string): number {
  const r = rng(s.seed + 3);
  const mat = stoneMat(s.type);
  const fresh = surface === "fresh" && mat === "sarsen";
  let cx = 0, cz = 0;
  for (const u of sup) {
    cx += u.x;
    cz += u.z;
  }
  cx /= sup.length;
  cz /= sup.length;
  let dx = 1, dz = 0;
  if (sup.length >= 2) {
    dx = sup[sup.length - 1].x - sup[0].x;
    dz = sup[sup.length - 1].z - sup[0].z;
  } else dx = Math.cos(-TILE_ROT(s.faceAz));
  const l = Math.hypot(dx, dz) || 1;
  const ry = Math.atan2(-dz / l, dx / l) + (r() - 0.5) * 0.02;
  const M = new THREE.Matrix4().makeTranslation(cx, underside, cz).multiply(new THREE.Matrix4().makeRotationY(ry));
  return emitStone(b, {
    seed: s.seed, mat, fresh, w: s.w, t: s.t, y0: 0, y1: s.h, dressed: true, top: "flat", taperScale: 0.1, rd: 0.14 + r() * 0.08, bottomFace: true, thickVar: 0.05,
    lichen: 0.2 + r() * 0.35, stepH: 0.28, stepV: 0.22, xf: (v) => v.applyMatrix4(M),
  });
}

function megaliths(b: Builder, m: PhaseModel, ctx: BuildCtx): void {
  const surface = typeof m.surface === "string" ? m.surface : "weathered";
  const specs: Spec[] = [];
  if (Array.isArray(m.stones)) (m.stones as Record<string, unknown>[]).forEach((s, i) => specs.push(parseStone(s, ctx, i)));
  if (Array.isArray(m.rings)) (m.rings as Record<string, unknown>[]).forEach((rg, i) => specs.push(...expandRing(rg, ctx, i)));
  const byId = new Map(specs.map((s) => [s.id, s]));
  const anchorG = ctx.ground(ctx.x, ctx.z);
  // ground plans for diagnostics and keep-out (the renderer ignores them): one circle per stone on the ground; a lying
  // stone's circle is centred halfway along its length
  for (const s of specs) {
    if (s.role === "lintel" && s.state !== "fallen" && s.state !== "broken") continue;
    const lying = s.state === "fallen" || s.state === "broken" || s.role === "slab";
    const off = lying && s.fallToward != null ? s.h / 2 : 0;
    const fa = ((s.fallToward ?? 0) * Math.PI) / 180;
    ctx.trace?.push({ kind: "plan", shape: "circle", x: s.x + Math.sin(fa) * off, z: s.z - Math.cos(fa) * off, r: (lying ? Math.max(s.w, s.h) : Math.max(s.w, s.t)) / 2 + 0.4 });
  }

  // Lintel levels: one shared underside for the curved ring, individual for straight lintels.
  const standingOn = (s: Spec) => s.on.map((id) => byId.get(id)).filter((u): u is Spec => !!u && (u.state === "standing" || u.state === "leaning") && u.role !== "lintel");
  const lintels = specs.filter((s) => s.role === "lintel");
  const ringLintels = lintels.filter((s) => s.curved && s.state === "standing");
  const ringSup = new Set<Spec>();
  for (const l of ringLintels) for (const u of standingOn(l)) ringSup.add(u);
  let ringLevel: number | undefined;
  if (ringSup.size) {
    const lt = m.levelTop;
    ringLevel = typeof lt === "number" ? anchorG + lt : [...ringSup].reduce((p, u) => p + u.g + u.h, 0) / ringSup.size;
  }
  const levelOf = new Map<Spec, number>();
  const upLevels = new Map<Spec, number[]>();
  for (const l of lintels) {
    if (l.state !== "standing") continue;
    const sup = standingOn(l);
    let lvl: number;
    if (l.curved && ringLevel !== undefined && sup.length) lvl = ringLevel;
    else if (sup.length) lvl = sup.reduce((p, u) => p + u.g + u.h, 0) / sup.length;
    else lvl = (typeof m.levelTop === "number" ? anchorG + m.levelTop : l.g + 4.1);
    levelOf.set(l, lvl);
    for (const u of sup) {
      const a = upLevels.get(u) ?? [];
      a.push(lvl);
      upLevels.set(u, a);
    }
  }

  let tris = 0;
  for (const s of specs) {
    let t = 0;
    if (s.role === "lintel") {
      if (s.state === "standing" || s.state === "leaning") {
        const sup = standingOn(s);
        const lvl = levelOf.get(s);
        if (lvl !== undefined && sup.length) {
          t = s.curved ? buildCurvedLintel(b, ctx, s, sup, lvl, surface) : buildStraightLintel(b, ctx, s, sup, lvl, surface);
        } else {
          // nothing known to rest on: lies where the data puts it
          const dirAz = s.fallToward ?? s.az + 90;
          const dir = new THREE.Vector2(Math.sin(dirAz * RAD), -Math.cos(dirAz * RAD));
          t = buildLying(b, ctx, s, surface, s.w, [s.t, s.h], [s.x - (dir.x * s.w) / 2, s.z - (dir.y * s.w) / 2], dirAz, 1, { dressed: true, bottomJag: false, sunk: 0.1 });
        }
      } else {
        let cx = s.x, cz = s.z;
        const sup = s.on.map((id) => byId.get(id)).filter((u): u is Spec => !!u);
        if (!Number.isFinite(cx) || (cx === ctx.x && cz === ctx.z && sup.length)) {
          cx = sup.reduce((p, u) => p + u.x, 0) / sup.length;
          cz = sup.reduce((p, u) => p + u.z, 0) / sup.length;
        }
        const dirAz = s.fallToward ?? s.az + 90;
        const dir = new THREE.Vector2(Math.sin(dirAz * RAD), -Math.cos(dirAz * RAD));
        t = buildLying(b, ctx, s, surface, s.w, [s.t, s.h], [cx - (dir.x * s.w) / 2, cz - (dir.y * s.w) / 2], dirAz, s.state === "broken" ? Math.max(2, s.pieces) : 1, { dressed: true, sunk: 0.1 });
      }
    } else if (s.role === "slab") {
      t = buildSlab(b, ctx, s, surface);
    } else if (s.state === "fallen" || s.state === "broken") {
      const dirAz = s.fallToward ?? s.az;
      t = buildLying(b, ctx, s, surface, s.h, [s.w, s.t], [s.x, s.z], dirAz, s.state === "broken" ? Math.max(2, s.pieces) : 1, { dressed: s.dressed });
    } else {
      const lv = upLevels.get(s);
      const topY = lv && lv.length && (s.state === "standing" || s.state === "leaning") ? lv.reduce((p, c) => p + c, 0) / lv.length : undefined;
      t = buildUpright(b, ctx, s, surface, topY, !!lv);
    }
    tris += t;
  }
  megalithStats.tris = tris;
  megalithStats.stones = specs.length;
}

/**
 * A thin line on the ground from the anchor along azimuth `az`, plus (optionally) a sun disc standing at its far end at
 * elevation `el` above the horizon as seen from the anchor at eye height. The engine has a single fixed sun per site, so this
 * disc is a MARKER of where the sun rises or sets on that day, not a light source: it does not light or shadow the scene.
 */
function sightline(b: Builder, m: PhaseModel, ctx: BuildCtx): void {
  const az = num(m.az, ctx.bearing ?? 0) * RAD;
  const length = Math.max(10, num(m.length, 1000));
  const dx = Math.sin(az), dz = -Math.cos(az);
  const px = -dz, pz = dx; // perpendicular
  const half = 0.3;
  const step = 3;
  const n = Math.max(2, Math.ceil(length / step));
  const pos: number[] = [], nrm: number[] = [];
  const pt = (d: number, side: number): [number, number, number] => {
    const x = ctx.x + dx * d + px * half * side, z = ctx.z + dz * d + pz * half * side;
    return [x, ctx.ground(x, z) + 0.08, z];
  };
  let prev = [pt(0, -1), pt(0, 1)];
  for (let i = 1; i <= n; i++) {
    const d = (length * i) / n;
    const cur = [pt(d, -1), pt(d, 1)];
    // counter-clockwise seen from above (+y)
    pos.push(...prev[0], ...cur[0], ...cur[1], ...prev[0], ...cur[1], ...prev[1]);
    for (let k = 0; k < 6; k++) nrm.push(0, 1, 0);
    prev = cur;
  }
  const mk = (p: number[], nn: number[], uv?: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nn, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv ?? new Array((p.length / 3) * 2).fill(0), 2));
    return g;
  };
  b.add("flat:#ffd27a:0.55", mk(pos, nrm));
  if (m.sun) {
    const el = num(m.el, 0.5) * RAD;
    const eyeY = ctx.ground(ctx.x, ctx.z) + 1.7;
    const R = length * 0.012;
    const cx = ctx.x + dx * length, cz = ctx.z + dz * length;
    const cyy = eyeY + Math.tan(el) * length;
    const g = new THREE.CircleGeometry(R, 40);
    // CircleGeometry faces +z: turn it to face back toward the anchor
    const M = new THREE.Matrix4().makeRotationY(Math.atan2(-dx, -dz)).setPosition(cx, cyy, cz);
    g.applyMatrix4(M);
    b.add("flat:#fff2c0", g);
  }
}

export function registerMegalithBuilders(): void {
  BUILDERS["megaliths"] = megaliths;
  BUILDERS["sightline"] = sightline;
  WORLD_SPACE_KINDS.add("megaliths");
  WORLD_SPACE_KINDS.add("sightline");
}
