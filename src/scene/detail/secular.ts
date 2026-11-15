import * as THREE from "three";
import type { PhaseModel } from "@/lib/types";
import { rng } from "@/lib/geo";
import type { Builder } from "../geom";
import { tileOf } from "../materials";
import { BUILDERS, type BuildCtx, type KindBuilder } from "../builders";
import { cutAtInlets, waterfrontLine } from "../waterline";

/**
 * Secular landmarks: keeps, curtain walls and gatehouses, halls, courtyard houses
 * and palaces, forum-basilica, amphitheatre, playhouses, quays and waterfronts.
 *
 * Everything is modelled in the landmark's local frame (x = length, z = width,
 * y up, ground at 0, foundations below). Where a face is detailed we use a
 * "face frame": local +z is the outward normal and local x runs along the face.
 * Geometry is built from solids only, so the horizontal reveal clip and the
 * ruin tint of the landmark layer work unchanged.
 *
 * Evidence: the proportions of the White Tower, Westminster Hall, the Guildhall,
 * the Banqueting House and the playhouses are recorded; most other elevations
 * (Roman forum, palace ranges, gatehouses) are typological reconstructions and
 * are flagged as such in docs/SOURCES.md.
 */

const num = (v: unknown, d: number): number => (typeof v === "number" ? v : d);
const str = (v: unknown, d: string): string => (typeof v === "string" ? v : d);
const TAU = Math.PI * 2;

type B = Builder;
type Arch = "round" | "pointed";

// ---------------------------------------------------------------- shapes

/** Trace an arched outline starting at (cx - w/2, y0): a round or two-centred pointed head of total height h. */
function traceArch(p: THREE.Path, cx: number, y0: number, w: number, h: number, kind: Arch): void {
  const hw = w / 2;
  const head = kind === "pointed" ? hw * 1.45 : hw;
  const sp = y0 + Math.max(0.05, h - head);
  p.moveTo(cx - hw, y0);
  p.lineTo(cx - hw, sp);
  if (kind === "pointed") {
    p.quadraticCurveTo(cx - hw * 0.95, sp + hw * 0.9, cx, y0 + h);
    p.quadraticCurveTo(cx + hw * 0.95, sp + hw * 0.9, cx + hw, sp);
  } else {
    p.absarc(cx, sp, hw, Math.PI, 0, true);
  }
  p.lineTo(cx + hw, y0);
  p.closePath();
}

function archShape(w: number, h: number, kind: Arch): THREE.Shape {
  const s = new THREE.Shape();
  traceArch(s, 0, 0, w, h, kind);
  return s;
}

/** Round- or pointed-headed opening (glass or dark) in the current face frame. */
function arch(b: B, mat: string, w: number, h: number, x: number, y: number, z = 0.03, kind: Arch = "round", depth = 0.3): void {
  b.extrude(mat, archShape(w, h, kind), depth, x, y, z);
}

/** Rectangular window: glass, optionally with mullion and transom. */
function rectWin(b: B, w: number, h: number, x: number, y: number, z = 0.03, cross = true): void {
  b.box("glass", w, h, 0.22, x, y, z);
  if (cross) {
    b.box("timber", 0.09, h + 0.12, 0.26, x, y - 0.06, z);
    if (h > 1.3) b.box("timber", w + 0.12, 0.09, 0.26, x, y + h * 0.58, z);
  }
}

/** Extrude a profile given as (a, y) pairs, a = local z, along local x for `len` (centred on x). */
function prism(b: B, mat: string, pts: [number, number][], len: number, x = 0, z = 0, y = 0): void {
  const s = new THREE.Shape();
  pts.forEach(([a, yy], i) => (i ? s.lineTo(-a, yy) : s.moveTo(-a, yy)));
  s.closePath();
  b.extrude(mat, s, len, x, y, z, Math.PI / 2);
}

function uvScale(g: THREE.BufferGeometry, mat: string, sx: number, sy: number): void {
  const t = tileOf(mat);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * sx) / t, (uv.getY(i) * sy) / t);
}

/** Part of a vertical cylinder; default is the half facing +z. */
function halfCyl(b: B, mat: string, r: number, h: number, segs: number, x: number, y: number, z: number, rotY = 0, start = -Math.PI / 2, len = Math.PI): void {
  const g = new THREE.CylinderGeometry(r, r, h, segs, 1, false, start, len);
  uvScale(g, mat, r * len, h);
  b.add(mat, g, new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y + h / 2, z));
}

/** Cylinder lying along local x. */
function cylX(b: B, mat: string, r: number, len: number, x: number, y: number, z: number, segs = 12): void {
  const g = new THREE.CylinderGeometry(r, r, len, segs);
  g.rotateZ(Math.PI / 2);
  uvScale(g, mat, TAU * r, len);
  b.add(mat, g, new THREE.Matrix4().setPosition(x, y, z));
}

/** Run fn in the four face frames of a rectangle l (x) by w (z): +z faces outward. fn(len, faceIndex). */
function faces(b: B, l: number, w: number, fn: (len: number, k: number) => void): void {
  b.at(0, 0, w / 2, 0, () => fn(l, 0));
  b.at(0, 0, -w / 2, Math.PI, () => fn(l, 1));
  b.at(l / 2, 0, 0, Math.PI / 2, () => fn(w, 2));
  b.at(-l / 2, 0, 0, -Math.PI / 2, () => fn(w, 3));
}

/** Parapet with merlons along a face (current frame). */
function battlement(b: B, mat: string, len: number, y: number, z: number, o: { wall?: number; mer?: number; step?: number; t?: number; x?: number; merlons?: boolean } = {}): void {
  const t = o.t ?? 0.55, wall = o.wall ?? 0.9, mer = o.mer ?? 0.9, step = o.step ?? 2.6, x0 = o.x ?? 0;
  b.box(mat, len + t, wall, t, x0, y, z);
  if (o.merlons === false) return;
  const n = Math.max(1, Math.round(len / step));
  const s = len / n;
  for (let i = 0; i < n; i++) b.box(mat, s * 0.5, mer, t, x0 - len / 2 + (i + 0.5) * s, y + wall, z);
}

/** Merlons around a round or polygonal top. */
function ringMerlons(b: B, mat: string, r: number, y: number, n: number, x = 0, z = 0): void {
  b.cyl(mat, r + 0.2, r + 0.2, 0.9, Math.max(8, n), x, y, z);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    b.at(x + Math.cos(a) * (r - 0.1), y + 0.9, z + Math.sin(a) * (r - 0.1), Math.PI / 2 - a, () => b.box(mat, ((TAU * r) / n) * 0.5, 0.9, 0.55));
  }
}

// ---------------------------------------------------------------- original builders (for placeholders)

let originals: Record<string, KindBuilder> | null = null;
const orig = (kind: string): KindBuilder => originals![kind];

// ---------------------------------------------------------------- keep (White Tower)

function keep(b: B, m: PhaseModel, ctx: BuildCtx): void {
  if (m.placeholder) return orig("keep")(b, m, ctx);
  const w = num(m.w, 30), d = num(m.d, 30), h = num(m.h, 25);
  const wall = str(m.wall, "ragstone");
  // battered plinth, then the body
  b.box(wall, w + 1.8, 2.4 + 4, d + 1.8, 0, -4, 0);
  b.box(wall, w + 0.9, 0.5, d + 0.9, 0, 2.4, 0);
  b.box(wall, w, h + 4, d, 0, -4, 0);
  faces(b, w, d, (len) => {
    const bays = Math.max(2, Math.round(len / 8.5));
    // flat pilaster buttresses between the bays
    for (let i = 1; i < bays; i++) b.box(wall, 2.3, h - 0.6, 0.8, -len / 2 + (i * len) / bays, 0, 0.4);
    // string course between the floors
    b.box(wall, len + 0.4, 0.4, 0.35, 0, h * 0.52, 0.17);
    for (let i = 0; i < bays; i++) {
      const x = -len / 2 + ((i + 0.5) * len) / bays;
      arch(b, "dark", 0.5, 1.9, x, 3.2, 0.02); // ground-floor loops
      arch(b, "glass", 1.0, 2.5, x, h * 0.31, 0.03);
      if (i % 2 === 0) arch(b, "glass", 1.5, 3.7, x, h * 0.64, 0.03);
      else arch(b, "glass", 0.9, 2.6, x, h * 0.66, 0.03);
    }
    // corbel table and parapet
    b.box(wall, len + 0.8, 0.45, 0.8, 0, h - 1.0, 0.2);
    battlement(b, wall, len, h - 0.55, -0.05, { wall: 1.0, mer: 0.95, step: 2.7, t: 0.6 });
  });
  b.box("lead", w - 1.4, 0.4, d - 1.4, 0, h - 1.4, 0);
  // chapel apse projecting from the south-east
  const ax = -w / 2 + w * 0.22, ar = Math.min(5.6, d * 0.17), ah = h * 0.74;
  b.cyl(wall, ar + 0.6, ar + 0.8, 2.4 + 4, 14, ax, -4, d / 2);
  b.cyl(wall, ar, ar, ah + 4, 14, ax, -4, d / 2);
  b.cone("lead", ar + 0.35, 5.4, 14, ax, ah, d / 2);
  for (const a of [Math.PI * 0.28, Math.PI * 0.5, Math.PI * 0.72]) {
    b.at(ax + Math.cos(a) * ar, 0, d / 2 + Math.sin(a) * ar, Math.atan2(Math.cos(a), Math.sin(a)), () => arch(b, "glass", 1.1, 3.2, 0, ah * 0.4, 0.03));
  }
  b.box(wall, 2.4, ah, 0.9, ax - ar * 0.55, 0, d / 2 + ar * 0.85, -0.5);
  // corner turrets: three square, one round stair turret (the north-east)
  const th = h + 5.5;
  const corners: [number, number][] = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  corners.forEach(([sx, sz], i) => {
    const x = (sx * w) / 2, z = (sz * d) / 2;
    if (i === 0) {
      b.cyl(wall, 3.7, 3.9, th + 4, 14, x, -4, z);
      ringMerlons(b, wall, 3.7, th, 9, x, z);
      b.cone("lead", 2.6, 2.6, 14, x, th + 0.9, z);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + 0.4;
        b.at(x + Math.cos(a) * 3.7, 0, z + Math.sin(a) * 3.7, Math.atan2(Math.cos(a), Math.sin(a)), () => arch(b, "dark", 0.4, 1.7, 0, h * 0.7, 0.02));
      }
    } else {
      b.box(wall, 6.6, th + 4, 6.6, x, -4, z);
      b.box(wall, 7.1, 0.45, 7.1, x, th - 1.0, z);
      b.at(x, th - 0.5, z, 0, () => {
        faces(b, 6.6, 6.6, (len) => battlement(b, wall, len, 0, -0.1, { wall: 0.7, mer: 0.9, step: 2.2, t: 0.55 }));
      });
      b.pyramid("lead", 5.0, 5.0, 2.6, x, th + 0.4, z);
      faces(b, 6.6, 6.6, () => {
        arch(b, "dark", 0.4, 1.7, 0, h * 0.7, 0.02);
        arch(b, "glass", 0.8, 2.2, 0, h * 0.4, 0.03);
      });
      // turrets read as bigger than the wall: flat pilasters up the corner
    }
    // weathervane
    b.box("gold", 0.12, 2.4, 0.12, x, th + 2.6, z);
    b.box("gold", 0.9, 0.5, 0.05, x + 0.35, th + 4.3, z);
  });
}

// ---------------------------------------------------------------- walls, towers, gates

function nearestOnPath(path: [number, number][], x: number, z: number): { x: number; z: number; ang: number } {
  let best = Infinity;
  let out = { x, z, ang: 0 };
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const dx = bx - ax, dz = bz - az;
    const f = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    const px = ax + dx * f, pz = az + dz * f;
    const dd = Math.hypot(px - x, pz - z);
    if (dd < best) {
      best = dd;
      out = { x: px, z: pz, ang: -Math.atan2(dz, dx) };
    }
  }
  return out;
}

/** Turf bank with timber breastwork (a Roman fort rampart). */
function rampart(b: B, m: PhaseModel, ctx: BuildCtx): void {
  const h = num(m.h, 3);
  const r = rng(ctx.seed);
  for (let i = 1; i < ctx.path.length; i++) {
    const [ax, az] = ctx.path[i - 1];
    const [bx, bz] = ctx.path[i];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 10));
    const rot = -Math.atan2(bz - az, bx - ax);
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n;
      const x = ax + (bx - ax) * f, z = az + (bz - az) * f;
      const g = Math.max(0.5, ctx.ground(x, z));
      const L = len / n + 0.5;
      b.at(x, g, z, rot, () => {
        const half = h * 1.9;
        // bank in cross-section: x' = across, extruded along the wall
        const s = new THREE.Shape();
        s.moveTo(-half, -1.5);
        s.lineTo(half, -1.5);
        s.lineTo(half * 0.32, h);
        s.lineTo(-half * 0.32, h);
        s.closePath();
        b.at(0, 0, 0, Math.PI / 2, () => b.extrude("turf", s, L));
        // timber breastwork and palisade
        b.box("timber", L, 0.9, 0.3, 0, h, half * 0.3);
        const np = Math.round(L / 0.9);
        for (let p = 0; p < np; p++) b.box("timber", 0.24, 1.9 + r() * 0.3, 0.24, -L / 2 + ((p + 0.5) * L) / np, h, -half * 0.3 + 0.1);
      });
    }
  }
}

function wallPath(b: B, m: PhaseModel, ctx: BuildCtx): void {
  const mat = str(m.wall, "ragstone");
  if (mat === "timber") return rampart(b, m, ctx);
  const h = num(m.h, 6), thick = num(m.thick, 2.4);
  const towers = num(m.towers, 0);
  const crenel = !!m.crenel, weathered = !!m.weathered;
  const roman = mat === "roman-rubble";
  const r = rng(ctx.seed);
  const plinthMat = roman ? "ragstone" : mat;
  const path = ctx.path;
  if (path.length < 2) return;
  // outward side: away from the centroid of the line
  let cx = 0, cz = 0;
  for (const [x, z] of path) { cx += x; cz += z; }
  cx /= path.length; cz /= path.length;

  const gates = ((m.gates as [number, number, string][] | undefined) ?? []).map(([lat, lon]) => {
    const [gx, gz] = ctx.project(lat, lon);
    const p = nearestOnPath(path, gx, gz);
    return { ...p, g: Math.max(0.5, ctx.ground(p.x, p.z)) };
  });
  const gateHalf = roman ? 10.4 : 11;
  const nearGate = (x: number, z: number, pad = 0) => gates.some((g) => Math.hypot(g.x - x, g.z - z) < gateHalf + pad);

  let sinceTower = towers / 2;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const rot = -Math.atan2(dz, dx);
    const mx0 = (ax + bx) / 2, mz0 = (az + bz) / 2;
    // local +z = (-dz, dx)/len; outward if it points away from the centroid
    const s = (-dz * (mx0 - cx) + dx * (mz0 - cz)) >= 0 ? 1 : -1;
    const near = gates.some((g) => Math.hypot(g.x - mx0, g.z - mz0) < len / 2 + 30);
    const n = Math.max(1, Math.round(len / (near ? 5 : 9)));
    for (let k = 0; k < n; k++) {
      const x0 = ax + (dx * k) / n, z0 = az + (dz * k) / n;
      const x1 = ax + (dx * (k + 1)) / n, z1 = az + (dz * (k + 1)) / n;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      if (nearGate(mx, mz)) continue;
      const L = len / n;
      const g = Math.max(0.5, (ctx.ground(x0, z0) + ctx.ground(x1, z1)) / 2);
      if (weathered) {
        // unmaintained: a ragged top, breaches, and a skirt of fallen rubble
        const pieces = Math.max(2, Math.round(L / 2.4));
        const pl = L / pieces;
        b.at(mx, g, mz, rot, () => {
          for (let p = 0; p < pieces; p++) {
            const x = -L / 2 + (p + 0.5) * pl;
            const roll = r();
            if (roll < 0.06) {
              b.box(mat, pl, 1.2, thick * 1.1, x, -0.2, 0, r() * 0.4);
              continue;
            }
            const f = 0.5 + r() * 0.5;
            const hh = h * f;
            b.box(mat, pl + 0.15, hh + 3, thick * (0.88 + r() * 0.16), x, -3, (r() - 0.5) * 0.25);
            b.box(plinthMat, pl + 0.15, 1.3 + 3, thick + 0.7, x, -3, 0);
            if (r() < 0.45) b.box(mat, pl * 0.5, 0.6 + r() * 0.8, thick * 0.55, x + (r() - 0.5) * pl * 0.4, hh, (r() - 0.5) * 0.4);
            if (r() < 0.4) b.box(mat, 0.9 + r(), 0.5 + r() * 0.5, 0.9 + r(), x, 0, s * (thick / 2 + 0.5 + r()), r());
          }
        });
      } else {
        b.at(mx, g, mz, rot, () => {
          const t = thick;
          b.box(mat, L + 0.5, h + 3, t, 0, -3, 0);
          b.box(plinthMat, L + 0.5, 1.3 + 3, t + 0.7, 0, -3, 0); // chamfered plinth
          // wall-walk and parapets: taller on the outer face
          b.box("gravel", L + 0.3, 0.12, t - 0.5, 0, h, 0);
          if (crenel) battlement(b, mat, L, h, s * (t / 2 - 0.27), { wall: 0.9, mer: 0.9, step: 3.4, t: 0.5 });
          else b.box(mat, L + 0.3, 1.3, 0.5, 0, h, s * (t / 2 - 0.27));
          b.box(mat, L + 0.3, 0.75, 0.45, 0, h, -s * (t / 2 - 0.25));
        });
      }
      if (towers > 0) {
        sinceTower += L;
        if (sinceTower >= towers && !nearGate(mx, mz, 14)) {
          sinceTower = 0;
          const R = thick * 1.9;
          const th = (weathered ? h * 0.8 : h) + 2.4;
          b.at(mx, g, mz, rot + (s < 0 ? Math.PI : 0), () => {
            // D-shaped bastion: a half drum on the outer face
            halfCyl(b, mat, R, th + 3, 12, 0, -3, thick / 2);
            halfCyl(b, plinthMat, R + 0.35, 1.3 + 3, 12, 0, -3, thick / 2);
            if (!weathered) {
              b.at(0, 0, thick / 2, 0, () => {
                halfCyl(b, "gravel", R - 0.2, 0.1, 12, 0, th, 0);
                for (let q = 0; q < 5; q++) {
                  const a = (q / 4) * Math.PI;
                  b.at(Math.cos(a) * (R - 0.15), th + 0.1, Math.sin(a) * (R - 0.15), Math.PI / 2 - a, () => b.box(mat, 1.3, 0.9, 0.55));
                }
                for (const a of [0.35, 0.5, 0.65]) {
                  b.at(Math.cos(a * Math.PI) * R, 0, Math.sin(a * Math.PI) * R, Math.PI / 2 - a * Math.PI, () => b.box("dark", 0.26, 1.6, 0.16, 0, th - 3.1, 0.04));
                }
              });
            } else if (r() < 0.6) b.box(mat, 1.2, 1.0, 1.4, R * 0.4, th, thick / 2 + R * 0.6, 0.3);
          });
        }
      }
    }
  }
  for (const gt of gates) gatehouse(b, mat, plinthMat, gt, h, thick, roman, weathered, path, cx, cz);
}

function gatehouse(b: B, mat: string, plinthMat: string, gt: { x: number; z: number; ang: number; g: number }, h: number, thick: number, roman: boolean, ruin: boolean, path: [number, number][], cx: number, cz: number): void {
  // face outwards: +z of the frame points away from the line's centroid
  const nx = Math.sin(gt.ang), nz = Math.cos(gt.ang);
  const out = nx * (gt.x - cx) + nz * (gt.z - cz) >= 0 ? 0 : Math.PI;
  void path;
  const pw = roman ? 3.3 : 4.3;
  const gw = roman ? 19 : 20;
  const gd = thick + (roman ? 3 : 7);
  const H = h + (roman ? 4 : 6.5) - (ruin ? h * 0.35 : 0);
  b.at(gt.x, gt.g, gt.z, gt.ang + out, () => {
    // front block with arched passages cut through it
    const s = new THREE.Shape();
    s.moveTo(-gw / 2, -3);
    s.lineTo(gw / 2, -3);
    s.lineTo(gw / 2, H);
    s.lineTo(-gw / 2, H);
    s.closePath();
    const kind: Arch = roman ? "round" : "pointed";
    const ph = roman ? 4.4 : 5.6;
    const holes: number[] = roman ? [-(pw / 2 + 0.9), pw / 2 + 0.9] : [0];
    for (const cxh of holes) {
      const hp = new THREE.Path();
      traceArch(hp, cxh, 0, pw, ph, kind);
      s.holes.push(hp);
    }
    b.extrude(mat, s, gd);
    b.box(plinthMat, gw + 0.8, 1.2 + 3, gd + 0.8, 0, -3, 0);
    if (!ruin) {
      // flanking towers on the outer face
      if (roman) {
        for (const sx of [1, -1]) {
          b.box(mat, 5.4, H + 1.8 + 3, 3.6, sx * (gw / 2 - 2.7), -3, gd / 2 + 1.4);
          b.box("dark", 0.3, 1.6, 0.2, sx * (gw / 2 - 2.7), H - 3.5, gd / 2 + 3.25);
        }
      } else {
        const rr = 3.9;
        for (const sx of [1, -1]) {
          const x = sx * (pw / 2 + rr + 0.4);
          halfCyl(b, mat, rr, H + 3 + 3, 12, x, -3, gd / 2 - 1.4);
          b.at(x, H + 2.4, gd / 2 - 1.4, 0, () => {
            halfCyl(b, "gravel", rr - 0.2, 0.1, 12, 0, 0, 0);
            for (let q = 0; q < 7; q++) {
              const a = (q / 6) * Math.PI;
              b.at(Math.cos(a) * (rr - 0.15), 0.1, Math.sin(a) * (rr - 0.15), Math.PI / 2 - a, () => b.box(mat, 1.4, 0.9, 0.55));
            }
          });
          for (const a of [0.3, 0.5, 0.7]) {
            b.at(x + Math.cos(a * Math.PI) * rr, 0, gd / 2 - 1.4 + Math.sin(a * Math.PI) * rr, Math.PI / 2 - a * Math.PI, () => b.box("dark", 0.28, 1.7, 0.16, 0, H - 3.2, 0.04));
          }
        }
      }
      // battlemented roof of the gate block
      b.at(0, H, 0, 0, () => {
        battlement(b, mat, gw, 0, gd / 2 - 0.3, { wall: 0.9, mer: 0.9, t: 0.55, step: 2.8 });
        battlement(b, mat, gw, 0, -gd / 2 + 0.3, { wall: 0.9, mer: 0.9, t: 0.55, step: 2.8 });
        b.box("gravel", gw - 1, 0.1, gd - 0.8, 0, 0, 0);
      });
    } else {
      b.box(mat, 2.4, 1.8, 2.6, gw * 0.3, H, 0.2, 0.4);
    }
  });
}

// ---------------------------------------------------------------- Roman forum-basilica

function forum(b: B, m: PhaseModel, ctx: BuildCtx): void {
  void ctx;
  const l = num(m.l, 100), w = num(m.w, 100), h = num(m.h, 8), depth = num(m.range, 12);
  const bas = (m.basilica as { w: number; h: number }) ?? { w: 30, h: 18 };
  const wall = "roman-rubble", roof = "tegula", col = "plaster";
  const hIn = h * 0.78;
  const small = l < 80;
  const zN = -w / 2 + bas.w;
  const zS = w / 2 - depth;

  const range = (len: number, xoff: number) => {
    b.box(wall, len, h + 3, 1.1, xoff, -3, -0.55);
    b.box("plaster", len, 0.5, 1.5, xoff, h - 0.4, -0.7);
    prism(b, roof, [[-depth - 0.8, hIn], [0.6, h + 0.2], [0.6, h + 0.55], [-depth - 0.8, hIn + 0.35]], len, xoff);
    // shops: arched doors to the street
    const nd = Math.max(1, Math.floor(len / 5.2));
    for (let i = 0; i < nd; i++) arch(b, "dark", 2.1, Math.min(3.4, h * 0.6), xoff - len / 2 + ((i + 0.5) * len) / nd, 0, 0.03, "round", 0.25);
    // colonnade toward the court
    const nc = Math.max(2, Math.round(len / 3.6));
    const cz = -depth + 0.5;
    for (let i = 0; i <= nc; i++) {
      const x = xoff - len / 2 + (i * len) / nc;
      b.cyl(col, 0.34, 0.4, hIn - 0.9, 8, x, 0.25, cz);
      b.box(col, 1.0, 0.25, 1.0, x, 0, cz);
      b.box(col, 0.95, 0.35, 0.95, x, hIn - 0.65, cz);
    }
    b.box(col, len + 0.6, 0.6, 1.1, xoff, hIn - 0.3, cz);
  };
  // south and flanking ranges (the north side is the basilica)
  b.at(0, 0, w / 2, 0, () => range(l, 0));
  b.at(l / 2, 0, 0, Math.PI / 2, () => range(zS - zN, -(zN + zS) / 2));
  b.at(-l / 2, 0, 0, -Math.PI / 2, () => range(zS - zN, (zN + zS) / 2));

  // basilica across the north side, apse at the east end
  const z = -w / 2 + bas.w / 2;
  const nave = bas.w * 0.5;
  const aw = (bas.w - nave) / 2;
  const ah = bas.h * 0.55;
  b.box("plaster", l, bas.h + 3, nave, 0, -3, z);
  b.gable(roof, "plaster", l, nave, nave * 0.24, 0, bas.h, z, 0, 0.5);
  b.cyl("plaster", nave / 2, nave / 2, bas.h + 3, 14, l / 2, -3, z);
  b.cone(roof, nave / 2 + 0.5, nave * 0.22, 14, l / 2, bas.h, z);
  for (const sgn of [1, -1]) {
    const zc = z + sgn * (nave / 2 + aw / 2);
    b.box("plaster", l, ah + 3, aw, 0, -3, zc);
    b.at(0, 0, z + sgn * (nave / 2 + aw), sgn > 0 ? 0 : Math.PI, () => {
      prism(b, roof, [[-aw - 0.2, ah + aw * 0.55], [0.5, ah], [0.5, ah + 0.35], [-aw - 0.2, ah + aw * 0.55 + 0.35]], l + 0.4);
      const spacing = small ? 4.2 : 5;
      const n = Math.max(2, Math.round(l / spacing));
      for (let i = 0; i < n; i++) arch(b, "glass", 1.4, ah * 0.55, -l / 2 + ((i + 0.5) * l) / n, ah * 0.28, 0.03);
      for (let i = 0; i <= n; i++) b.box("plaster", 0.8, ah, 0.3, -l / 2 + (i * l) / n, 0, 0.12);
    });
    b.at(0, 0, z + sgn * (nave / 2), sgn > 0 ? 0 : Math.PI, () => {
      const n = Math.max(2, Math.round(l / (small ? 4.2 : 5)));
      for (let i = 0; i < n; i++) arch(b, "glass", 1.5, (bas.h - ah) * 0.62, -l / 2 + ((i + 0.5) * l) / n, ah + (bas.h - ah) * 0.18, 0.03);
    });
  }
  // portico of tall columns on the court side of the basilica
  const pz = zN + 1.4;
  const nc = Math.max(4, Math.round(l / 5));
  const chh = bas.h * 0.62;
  for (let i = 0; i <= nc; i++) {
    const x = -l / 2 + (i * l) / nc;
    b.cyl(col, 0.55, 0.65, chh, 10, x, 0.3, pz);
    b.box(col, 1.5, 0.3, 1.5, x, 0, pz);
    b.box(col, 1.4, 0.55, 1.4, x, chh + 0.3, pz);
  }
  b.box(col, l + 1, 0.9, 1.7, 0, chh + 0.85, pz);
  b.box(roof, l + 1, 0.3, 3.6, 0, chh + 1.75, pz - 0.7);
  // gravelled court
  b.box("gravel", l - depth * 2, 0.3, zS - zN - 3, 0, 0, (zN + zS) / 2 + 1.5);
}

// ---------------------------------------------------------------- amphitheatre

function amphitheatre(b: B, m: PhaseModel): void {
  const l = num(m.l, 100), w = num(m.w, 85), h = num(m.h, 8);
  const wallMat = str(m.wall, "timber");
  const stone = wallMat !== "timber";
  const a = l / 2, c = w / 2;
  const bank = Math.min(l, w) * 0.24;
  const ax = a - bank, az = c - bank;
  const N = 52, tiers = 6;
  const ell = (u: number, ang: number): [number, number] => [Math.cos(ang) * (ax + (a - ax) * u), Math.sin(ang) * (az + (c - az) * u)];
  const gap = (am: number) => Math.abs(Math.sin(am)) < 0.1;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU, am = (a0 + a1) / 2;
    if (gap(am)) continue;
    // timber seating on the earth bank, rising towards the outer rim
    for (let t = 0; t < tiers; t++) {
      const u = (t + 0.5) / tiers;
      const [x0, z0] = ell(u, a0), [x1, z1] = ell(u, a1);
      const top = 1.6 + (h - 1.6) * ((t + 1) / tiers);
      b.slab(t % 2 ? "timber-weathered" : "timber", x0, z0, x1, z1, -2, top, bank / tiers + 0.25);
      // low risers for each bench
      if (t > 0) {
        const [rx0, rz0] = ell(t / tiers, a0), [rx1, rz1] = ell(t / tiers, a1);
        b.slab("timber", rx0, rz0, rx1, rz1, 0, top - 0.5, 0.18);
      }
    }
    // arena wall around the sand
    const [e0x, e0z] = ell(0, a0), [e1x, e1z] = ell(0, a1);
    b.slab(stone ? wallMat : "timber", e0x, e0z, e1x, e1z, -1.5, 3.1, 0.95);
    b.slab(stone ? "caen" : "timber-weathered", e0x, e0z, e1x, e1z, 3.1, 3.4, 1.25);
    // outer retaining bank of turf with a timber rail on the rim
    const [o0x, o0z] = ell(1.04, a0), [o1x, o1z] = ell(1.04, a1);
    b.slab("turf", o0x, o0z, o1x, o1z, -2, h * 0.55, 2.6);
    const [r0x, r0z] = ell(1.0, a0), [r1x, r1z] = ell(1.0, a1);
    b.slab("timber", r0x, r0z, r1x, r1z, h, h + 1.0, 0.14);
    if (i % 2 === 0) b.box("timber", 0.18, 1.4, 0.18, r0x, h - 0.4, r0z);
  }
  b.add("gravel", new THREE.CylinderGeometry(1, 1, 0.2, 40).scale(ax - 0.6, 1, az - 0.6), new THREE.Matrix4().setPosition(0, 0.1, 0));
  // entrance passages at both ends of the long axis, with flanking piers
  for (const sx of [1, -1]) {
    b.at(sx * (ax + (a - ax) * 0.5), 0, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2, () => {
      const run = a - ax + 2.2;
      for (const sz of [1, -1]) b.box(stone ? wallMat : "timber", 1.0, 4.6 + 2, run, sz * 2.7, -2, 0);
      b.box("timber", 6.4, 0.45, run, 0, 3.7, 0);
      b.box("timber", 5.4, 0.2, run - 1, 0, 0, 0);
      b.at(0, 0, run / 2, 0, () => arch(b, "dark", 4.2, 3.7, 0, 0, 0.02, "round", 0.3));
    });
  }
}

// ---------------------------------------------------------------- halls

type WinStyle = "round" | "pointed" | "rect";

function hall(b: B, m: PhaseModel, ctx: BuildCtx): void {
  if (m.placeholder) return orig("hall")(b, m, ctx);
  if (m.classical) return classicalHall(b, m);
  const l = num(m.l, 30), w = num(m.w, 10), h = num(m.h, 8);
  const wall = str(m.wall, "ragstone"), roof = str(m.roof, "tile");
  const rise = (w / 2) * num(m.pitch, 0.85);
  // window language follows the fabric: Roman and Norman fabric is round-headed, brick is Tudor-rectangular
  const style: WinStyle = wall === "brick" ? "rect" : roof === "shingle" || roof === "tegula" ? "round" : "pointed";
  const vaulted = !!m.vaulted;
  b.box(wall, l + 0.7, 1.2 + 3, w + 0.7, 0, -3, 0);
  b.box(wall, l, h + 3, w, 0, -3, 0);
  if (vaulted) {
    // barrel-vaulted bath hall
    const s = new THREE.Shape();
    s.moveTo(-w / 2 - 0.3, 0);
    s.absarc(0, 0, w / 2 + 0.3, Math.PI, 0, true);
    s.lineTo(w / 2 + 0.3, -0.5);
    s.lineTo(-w / 2 - 0.3, -0.5);
    s.closePath();
    b.at(0, h, 0, 0, () => b.at(0, 0, 0, Math.PI / 2, () => b.extrude(roof, s, l + 0.6)));
  } else if (wall === "brick") {
    b.hip(roof, l, w, rise, 0, h, 0, 0, 0.45);
  } else {
    b.gable(roof, wall, l, w, rise, 0, h, 0, 0, 0.4);
    b.box(roof === "lead" ? "lead" : roof, l + 0.6, 0.18, 0.5, 0, h + rise - 0.05, 0);
  }
  const bay = style === "round" ? 5.4 : style === "pointed" ? 6.4 : 4.2;
  const bays = Math.max(2, Math.round(l / bay));
  faces(b, l, w, (len, k) => {
    if (k < 2) {
      for (let i = 0; i <= bays; i++) {
        const x = -len / 2 + (i * len) / bays;
        if (style === "pointed") {
          b.box(wall, 1.2, h * 0.58, 1.0, x, 0, 0.5);
          b.box(wall, 0.9, h * 0.3, 0.6, x, h * 0.58, 0.3);
          b.box(wall, 0.9, h * 0.32, 0.4, x, h * 0.62, 0.2);
        } else {
          b.box(wall, 0.95, h - 0.4, 0.38, x, 0, 0.19);
        }
      }
      for (let i = 0; i < bays; i++) {
        const x = -len / 2 + ((i + 0.5) * len) / bays;
        if (style === "pointed") arch(b, "glass", 1.8, h * 0.52, x, h * 0.34, 0.03, "pointed");
        else if (style === "round") arch(b, "glass", 0.95, h * 0.32, x, h * 0.42, 0.03, "round");
        else {
          rectWin(b, 1.3, 1.7, x, h * 0.2, 0.03, len < 80);
          rectWin(b, 1.3, 1.7, x, h * 0.58, 0.03, len < 80);
        }
      }
      b.box(wall, len + 0.6, 0.4, 0.7, 0, h - 0.5, 0.2);
    } else {
      // end walls: the great window, flanked by stepped buttresses
      const cw = len * 0.4;
      if (style === "pointed") {
        arch(b, "glass", cw, h * 0.7, 0, h * 0.24, 0.03, "pointed");
        b.box(wall, cw + 1.2, 0.4, 0.3, 0, h * 0.24, 0.12);
      } else if (style === "round") {
        for (const sx of [-1, 0, 1]) arch(b, "glass", 1.0, h * 0.4, sx * len * 0.22, h * 0.36, 0.03, "round");
      } else {
        rectWin(b, 2.6, 2.2, 0, h * 0.4, 0.03, true);
      }
      b.box(wall, len + 0.6, 0.4, 0.7, 0, h - 0.5, 0.2);
      for (const sx of [1, -1]) b.box(wall, 1.1, h * 0.7, 0.9, sx * (len / 2 - 0.2), 0, 0.45);
    }
  });
  // round window high in the gable of the end wall
  if (!vaulted && style !== "rect") {
    for (const sx of [1, -1]) b.at(sx * (l / 2), 0, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2, () => arch(b, "glass", 0.8, 1.6, 0, h + rise * 0.28, 0.03, style === "pointed" ? "pointed" : "round"));
  }
  if (m.apse) {
    b.cyl(wall, w * 0.4, w * 0.4, h + 3, 12, -l / 2, -3, 0);
    b.cone(roof, w * 0.4 + 0.3, 2.2, 12, -l / 2, h, 0);
  }
  // a louvre on the ridge of a great hall
  if (style === "pointed" && l > 60) {
    b.box("timber", 3.4, 2.6, 3.4, 0, h + rise - 0.9, 0);
    b.pyramid("lead", 4.2, 4.2, 2.8, 0, h + rise + 1.7, 0);
    b.box("gold", 0.1, 1.5, 0.1, 0, h + rise + 4.4, 0);
  }
  if (m.endTowers) {
    for (const s of [1, -1]) {
      const tw = 4.6, th = h + rise * 0.55 + 3.2;
      const x = l / 2 + 0.6, z = s * (w / 2 + 1.1);
      b.box(wall, tw, th + 3, tw, x, -3, z);
      b.box(wall, tw + 0.4, 0.4, tw + 0.4, x, th - 0.9, z);
      b.at(x, th - 0.5, z, 0, () => faces(b, tw, tw, (len) => battlement(b, wall, len, 0, -0.05, { wall: 0.6, mer: 0.8, step: 2.0, t: 0.5 })));
      b.pyramid("lead", tw - 0.6, tw - 0.6, 2.4, x, th + 0.2, z);
      b.at(x, 0, z, 0, () => faces(b, tw, tw, () => {
        arch(b, "dark", 0.4, 1.8, 0, th * 0.35, 0.02);
        arch(b, "glass", 0.8, 2.2, 0, th * 0.62, 0.03, "pointed");
      }));
    }
  }
}

function classicalHall(b: B, m: PhaseModel): void {
  // Inigo Jones's Banqueting House: rusticated basement, Ionic and Composite orders, balustrade.
  const l = num(m.l, 33), w = num(m.w, 16.8), h = num(m.h, 21.6);
  const wall = str(m.wall, "ashlar");
  const hB = h * 0.27, hO1 = h * 0.33, hO2 = h * 0.27;
  const y1 = hB + hO1, y2 = y1 + hO2;
  const rem = h - y2 - 1.3;
  b.box(wall, l + 0.8, 0.8 + 3, w + 0.8, 0, -3, 0);
  b.box(wall, l, h + 3, w, 0, -3, 0);
  b.gable("lead", null, l - 1.4, w - 1.4, (w / 2) * num(m.pitch, 0.15), 0, h - 0.6, 0, 0, 0);
  faces(b, l, w, (len, k) => {
    const n = k < 2 ? 7 : 3;
    const bw = len / n;
    // rusticated basement: banded courses, keyed windows
    for (let j = 1; j * 0.95 < hB; j++) b.box(wall, len + 0.1, 0.1, 0.14, 0, j * 0.95, 0.04);
    b.box(wall, len + 0.5, 0.35, 0.5, 0, hB - 0.1, 0.14); // string course
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + (i + 0.5) * bw;
      rectWin(b, 1.3, hB * 0.42, x, hB * 0.28, 0.03, false);
      b.box(wall, 0.5, 0.55, 0.3, x, hB * 0.28 + hB * 0.42 - 0.1, 0.1);
      // piano nobile window with alternating pediments
      const wy = hB + hO1 * 0.17, wh = hO1 * 0.62;
      rectWin(b, 1.55, wh, x, wy, 0.03, false);
      b.box(wall, 0.22, wh + 0.2, 0.28, x - 0.9, wy - 0.05, 0.06);
      b.box(wall, 0.22, wh + 0.2, 0.28, x + 0.9, wy - 0.05, 0.06);
      b.box(wall, 2.3, 0.3, 0.4, x, wy + wh + 0.05, 0.08);
      if (i % 2 === 0) {
        const tri = new THREE.Shape();
        tri.moveTo(-1.25, 0); tri.lineTo(1.25, 0); tri.lineTo(0, 0.75); tri.closePath();
        b.extrude(wall, tri, 0.4, x, wy + wh + 0.35, 0.08);
      } else b.box(wall, 2.0, 0.28, 0.4, x, wy + wh + 0.35, 0.08);
      // upper-order window
      const uy = y1 + hO2 * 0.2, uh = hO2 * 0.5;
      rectWin(b, 1.3, uh, x, uy, 0.03, false);
      b.box(wall, 1.8, 0.25, 0.3, x, uy + uh + 0.02, 0.08);
    }
    // orders: engaged columns on the centre bays (and the whole end fronts), pilasters elsewhere
    const colAt = (i: number) => (k < 2 ? i >= 2 && i <= 5 : true);
    for (let i = 0; i <= n; i++) {
      const x = -len / 2 + i * bw;
      const isCol = colAt(i) && i > 0 && i < n;
      for (const [yb, oh, mat2] of [[hB, hO1, wall], [y1, hO2, wall]] as [number, number, string][]) {
        const sh = oh - 1.0;
        if (isCol) {
          b.cyl(mat2, 0.4, 0.46, sh, 10, x, yb + 0.35, 0.3);
          b.box(mat2, 1.15, 0.35, 1.0, x, yb, 0.38);
          b.box(mat2, 1.05, 0.5, 0.9, x, yb + 0.35 + sh, 0.38);
        } else {
          b.box(mat2, 0.85, sh + 0.2, 0.22, x, yb + 0.35, 0.11);
          b.box(mat2, 1.1, 0.3, 0.3, x, yb + 0.35 + sh, 0.15);
        }
      }
    }
    // entablatures, frieze and cornice with modillions
    b.box(wall, len + 0.4, 0.5, 0.5, 0, y1 - 0.55, 0.2);
    b.box(wall, len + 0.4, 0.4, 0.6, 0, y1 - 0.05, 0.25);
    b.box(wall, len + 0.8, 0.45, 0.6, 0, y2 - 0.45, 0.25);
    b.box(wall, len + 1.5, 0.5, 1.15, 0, y2, 0.55);
    const nm = Math.round(len / 1.15);
    for (let i = 0; i < nm; i++) b.box(wall, 0.3, 0.3, 0.55, -len / 2 + ((i + 0.5) * len) / nm, y2 - 0.3, 0.45);
    // balustrade with piers above the columns
    const top = y2 + 0.5;
    b.box(wall, len + 1.3, 0.28, 0.55, 0, top, 0.45);
    const nb = Math.round(len / 0.62);
    for (let i = 0; i < nb; i++) b.box(wall, 0.2, rem - 0.5, 0.2, -len / 2 + ((i + 0.5) * len) / nb, top + 0.28, 0.45);
    b.box(wall, len + 1.3, 0.24, 0.6, 0, top + rem - 0.22, 0.45);
    for (let i = 0; i <= n; i += k < 2 ? 1 : 3) b.box(wall, 0.7, rem, 0.7, -len / 2 + i * bw, top, 0.45);
  });
}

// ---------------------------------------------------------------- courtyard houses and palaces

type Style = "brick" | "stone" | "ashlar";

interface RangeOpts {
  len: number;
  depth: number;
  h: number;
  wall: string;
  roof: string;
  style: Style;
  pitch: number;
  lite: boolean;
  chimneys: boolean;
  oriels: boolean;
  buttress: boolean;
  arcade: boolean;
  seed: number;
}

/** One range in a frame whose +z faces outward; the building occupies z in [-depth, 0]. */
function range(b: B, o: RangeOpts): void {
  const { len, depth, h, wall } = o;
  const r = rng(o.seed);
  const rise = (depth / 2) * o.pitch;
  b.box(wall, len, h + 3, depth, 0, -3, -depth / 2);
  b.gable(o.roof, wall, len, depth, rise, 0, h, -depth / 2, 0, 0.4);
  const floors = h <= 6.5 ? 1 : h <= 11.5 ? 2 : 3;
  const fh = h / floors;
  const spacing = o.style === "stone" ? 4.8 : o.lite ? 4.6 : 3.7;
  const n = Math.max(1, Math.floor(len / spacing));
  const wh = Math.max(1.1, fh * 0.46);
  for (const side of [0, 1]) {
    // side 0: the outer face (z = 0); side 1: the court face (z = -depth, turned round)
    const place = () => {
      if (o.style !== "stone") for (let f = 1; f < floors; f++) b.box(o.style === "brick" ? "ashlar" : wall, len + 0.2, 0.22, 0.2, 0, f * fh - 0.1, 0.05);
      for (let i = 0; i < n; i++) {
        const x = -len / 2 + ((i + 0.5) * len) / n;
        for (let f = 0; f < floors; f++) {
          const y = f * fh + fh * 0.26;
          if (o.style === "stone") {
            if (f === 0) arch(b, "dark", 0.34, 1.3, x, y + 0.5, 0.03, "pointed", 0.2);
            else arch(b, "glass", 0.9, wh * 1.2, x, y, 0.03, "pointed", 0.22);
          } else {
            rectWin(b, 1.25, wh, x, y, 0.03, !o.lite);
            if (o.style === "ashlar") b.box("ashlar", 1.7, 0.22, 0.3, x, y + wh + 0.04, 0.06);
          }
        }
      }
      if (o.buttress) {
        const nb = Math.max(2, Math.round(len / 6));
        for (let i = 0; i <= nb; i++) b.box(wall, 0.9, h * 0.62, 0.75, -len / 2 + (i * len) / nb, 0, 0.35);
      }
    };
    if (side === 0) place();
    else b.at(0, 0, -depth, Math.PI, place);
  }
  if (o.oriels && o.len > 18) {
    b.at(0, 0, -depth, Math.PI, () => {
      const ox = (r() - 0.5) * len * 0.3;
      b.box(wall, 3.2, fh * 0.75, 1.1, ox, fh * (floors > 1 ? 1.05 : 0.2), 0.55);
      b.box("glass", 2.7, fh * 0.45, 0.12, ox, fh * (floors > 1 ? 1.2 : 0.35), 1.12);
      b.box("lead", 3.5, 0.2, 1.3, ox, fh * (floors > 1 ? 1.8 : 1.0) + 0.2, 0.55);
    });
  }
  if (o.chimneys) {
    const nc = Math.max(1, Math.round(len / 16));
    for (let i = 0; i < nc; i++) {
      const x = -len / 2 + ((i + 0.5) * len) / nc + (r() - 0.5) * 2;
      b.box("brick", 1.0, 2.8, 1.6, x, h + rise - 0.9, -depth / 2);
      b.box("ashlar", 1.2, 0.22, 1.8, x, h + rise + 1.9, -depth / 2);
      b.box("brick", 0.38, 0.8, 0.38, x - 0.26, h + rise + 2.12, -depth / 2);
      b.box("brick", 0.38, 0.8, 0.38, x + 0.26, h + rise + 2.12, -depth / 2);
    }
  }
  if (o.arcade) {
    // loggia on the court face: an arcaded wall with the dark bay behind it
    b.at(0, 0, -depth, Math.PI, () => {
      const hArc = Math.min(h * 0.45, 5.2);
      const s = new THREE.Shape();
      s.moveTo(-len / 2, 0); s.lineTo(len / 2, 0); s.lineTo(len / 2, hArc); s.lineTo(-len / 2, hArc); s.closePath();
      const na = Math.max(2, Math.floor(len / 3.3));
      const aw = (len / na) * 0.62;
      for (let i = 0; i < na; i++) {
        const hp = new THREE.Path();
        traceArch(hp, -len / 2 + ((i + 0.5) * len) / na, 0, aw, hArc * 0.82, "round");
        s.holes.push(hp);
      }
      b.box("dark", len, hArc, 0.1, 0, 0, 0.12);
      b.extrude(o.style === "brick" ? "ashlar" : wall, s, 1.1, 0, 0, 0.62);
      b.box("ashlar", len + 0.3, 0.4, 1.4, 0, hArc, 0.6);
    });
  }
}

function courtyard(b: B, m: PhaseModel, ctx: BuildCtx): void {
  if (m.placeholder) return orig("courtyard")(b, m, ctx);
  const l = num(m.l, 50), w = num(m.w, 40), h = num(m.h, 9), depth = num(m.range, 8);
  const wall = str(m.wall, "ragstone"), roof = str(m.roof, "tile");
  const style: Style = wall === "brick" ? "brick" : wall === "ashlar" || wall === "caen" ? "ashlar" : "stone";
  const pitch = roof === "lead" ? 0.45 : roof === "slate" ? 0.7 : 0.85;
  const perim = 2 * (l + w) + (m.double ? w : 0);
  const base: RangeOpts = {
    len: l, depth, h, wall, roof, style, pitch,
    lite: perim > 220,
    chimneys: style === "brick",
    oriels: style !== "stone" && perim < 360,
    buttress: style === "stone" && depth < 12,
    arcade: !!m.arcade,
    seed: ctx.seed,
  };
  const shortLen = w - depth * 2;
  b.at(0, 0, w / 2, 0, () => range(b, { ...base, len: l, seed: ctx.seed + 1 }));
  b.at(0, 0, -w / 2, Math.PI, () => range(b, { ...base, len: l, seed: ctx.seed + 2 }));
  b.at(l / 2, 0, 0, Math.PI / 2, () => range(b, { ...base, len: shortLen, seed: ctx.seed + 3, chimneys: base.chimneys }));
  b.at(-l / 2, 0, 0, -Math.PI / 2, () => range(b, { ...base, len: shortLen, seed: ctx.seed + 4 }));
  if (m.double) b.at(depth / 2, 0, 0, Math.PI / 2, () => range(b, { ...base, len: shortLen, seed: ctx.seed + 5, oriels: false }));
  // paved court
  b.box(style === "brick" ? "cobble" : "gravel", l - depth * 2, 0.12, w - depth * 2, 0, 0, 0);

  // corner towers: polygonal turrets, domed under lead, battlemented under tile
  const nt = Math.min(4, num(m.towers, 0));
  const corners: [number, number][] = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (let i = 0; i < nt; i++) {
    const [sx, sz] = corners[i];
    const tr = Math.max(2.9, depth * 0.45), th = h + 4.5;
    const x = (sx * l) / 2, z = (sz * w) / 2;
    const segs = style === "brick" ? 8 : 10;
    b.cyl(wall, tr, tr + 0.25, th + 3, segs, x, -3, z);
    b.cyl("ashlar", tr + 0.35, tr + 0.35, 0.3, segs, x, th - 1.2, z);
    if (roof === "lead") {
      b.cone("lead", tr + 0.4, tr * 1.1, segs, x, th, z);
      b.cone("lead", tr * 0.35, tr * 0.7, segs, x, th + tr * 1.05, z);
      b.box("gold", 0.1, 1.4, 0.1, x, th + tr * 1.7, z);
    } else {
      ringMerlons(b, wall, tr, th, 8, x, z);
      b.cone(roof, tr * 0.8, 1.8, segs, x, th + 0.9, z);
    }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + Math.PI / 4;
      b.at(x + Math.cos(a) * tr, 0, z + Math.sin(a) * tr, Math.atan2(Math.cos(a), Math.sin(a)), () => {
        if (style === "stone") arch(b, "dark", 0.35, 1.4, 0, h * 0.62, 0.03, "pointed", 0.2);
        else rectWin(b, 0.9, 1.5, 0, h * 0.55, 0.03, false);
      });
    }
  }

  const tw = m.tower as { w: number; h: number } | undefined;
  if (tw) {
    const tz = w / 2 - depth * 0.3;
    b.at(0, 0, tz, 0, () => tower(b, tw.w, tw.h, wall, !!m.arcade, style));
  }
  if (m.greatHall) {
    // great hall: taller, with buttresses, tall lights and a rose in the gable
    const gl = l * 0.55, gz = w / 2 - depth / 2 + 1.5, gx = -l * 0.15, gh = h + 4;
    b.box(wall, gl, gh + 3, depth + 3, gx, -3, gz);
    const rise = (depth + 3) * 0.5;
    b.gable(roof, wall, gl, depth + 3, rise, gx, gh, gz, 0, 0.4);
    b.at(gx, 0, gz + (depth + 3) / 2, 0, () => {
      const nb = Math.max(3, Math.round(gl / 6));
      for (let i = 0; i <= nb; i++) b.box(wall, 1.0, gh * 0.7, 0.9, -gl / 2 + (i * gl) / nb, 0, 0.45);
      for (let i = 0; i < nb; i++) arch(b, "glass", 1.7, gh * 0.55, -gl / 2 + ((i + 0.5) * gl) / nb, gh * 0.3, 0.03, "pointed");
    });
    b.box(wall, 0.9, gh * 0.75, 1.0, gx - gl / 2, 0, gz + (depth + 3) / 2 - 0.2);
    // rose window in the west gable
    const rr = Math.min(2.6, (depth + 3) * 0.3);
    const g = new THREE.CylinderGeometry(rr, rr, 0.3, 16).rotateZ(Math.PI / 2);
    b.add("glass", g, new THREE.Matrix4().setPosition(gx - gl / 2 - 0.12, gh + rise * 0.3, gz));
  }
}

function tower(b: B, tw: number, th: number, wall: string, bell: boolean, style: Style): void {
  b.box(wall, tw + 0.6, 1.2 + 3, tw + 0.6, 0, -3, 0);
  if (bell) {
    // bell tower in stages: plain shaft, stringcourses, belfry with arched louvres, lead cap, lantern and vane
    const s1 = th * 0.62, s2 = th * 0.86;
    b.box(wall, tw, s1 + 3, tw, 0, -3, 0);
    for (const y of [s1 * 0.35, s1 * 0.7, s1]) b.box("ashlar", tw + 0.5, 0.35, tw + 0.5, 0, y - 0.1, 0);
    b.box(wall, tw - 0.4, s2 - s1, tw - 0.4, 0, s1, 0);
    faces(b, tw - 0.4, tw - 0.4, () => {
      arch(b, "dark", 1.3, (s2 - s1) * 0.65, 0, s1 + (s2 - s1) * 0.18, 0.04);
      arch(b, "dark", 0.7, 2.2, 0, s1 * 0.45, 0.04);
    });
    b.box("ashlar", tw + 0.6, 0.45, tw + 0.6, 0, s2 - 0.1, 0);
    b.box("ashlar", tw + 0.3, 0.7, tw + 0.3, 0, s2 + 0.35, 0);
    b.pyramid("lead", tw + 0.2, tw + 0.2, th * 0.12, 0, s2 + 1.05, 0);
    b.cyl("lead", 0.7, 0.9, 1.6, 8, 0, s2 + 1.05 + th * 0.1, 0);
    b.cone("lead", 1.0, 1.6, 8, 0, s2 + 2.65 + th * 0.1, 0);
    b.box("gold", 0.08, 2.2, 0.08, 0, s2 + 4.2 + th * 0.1, 0);
    b.box("gold", 1.2, 0.5, 0.1, 0, s2 + 6.0 + th * 0.1, 0); // the grasshopper vane
    void style;
  } else {
    // battlemented gatehouse tower with a pointed passage on the outer face
    b.box(wall, tw, th + 3, tw, 0, -3, 0);
    b.at(0, 0, 0, 0, () => {
      faces(b, tw, tw, () => {
        arch(b, "dark", Math.min(2.6, tw * 0.4), Math.min(4.2, th * 0.3), 0, 0, 0.04, "pointed", 0.3);
        arch(b, "glass", 0.9, 2.2, 0, th * 0.55, 0.04, "pointed");
        arch(b, "glass", 0.9, 2.2, 0, th * 0.78, 0.04, "pointed");
      });
    });
    b.box(wall, tw + 0.8, 0.45, tw + 0.8, 0, th - 1.0, 0);
    b.at(0, th - 0.5, 0, 0, () => faces(b, tw, tw, (len) => battlement(b, wall, len, 0, -0.05, { wall: 0.8, mer: 0.9, step: 2.3, t: 0.55 })));
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      b.cyl(wall, 0.9, 1.0, 3.6, 8, (sx * tw) / 2, th - 0.5, (sz * tw) / 2);
      b.cone("lead", 1.2, 1.5, 8, (sx * tw) / 2, th + 3.1, (sz * tw) / 2);
    }
    b.box("lead", tw - 1, 0.2, tw - 1, 0, th - 0.5, 0);
  }
}

// ---------------------------------------------------------------- playhouses

function playhouse(b: B, m: PhaseModel): void {
  const d = num(m.d, 28), h = num(m.h, 10), sides = num(m.sides, 20);
  const roof = str(m.roof, "thatch");
  const depth = 3.9;
  const R = d / 2;
  const rMid = R - depth / 2;
  const side = 2 * R * Math.tan(Math.PI / sides);
  // pick the bay for the entrance: closest to the +z side of the plot
  let entrance = 0, best = Infinity;
  for (let i = 0; i < sides; i++) {
    const a = ((i + 0.5) / sides) * TAU;
    const dist = Math.abs(Math.sin(a) - 1);
    if (dist < best) { best = dist; entrance = i; }
  }
  for (let i = 0; i < sides; i++) {
    const a = ((i + 0.5) / sides) * TAU;
    b.at(Math.cos(a) * rMid, 0, Math.sin(a) * rMid, Math.PI / 2 - a, () => {
      const sw = side * 0.985;
      // timber-framed bay: plaster between oak framing, jettied galleries
      b.box("frame", sw, h + 1, depth, 0, -1, 0);
      for (const f of [0.34, 0.67]) b.box("timber", sw + 0.06, 0.22, 0.32, 0, h * f, depth / 2 + 0.02);
      b.box("timber", 0.24, h + 0.4, 0.34, -sw / 2 + 0.1, 0, depth / 2 + 0.02);
      b.box("timber", sw + 0.06, 0.3, 0.4, 0, h - 0.25, depth / 2 + 0.04);
      if (i !== entrance) {
        rectWin(b, 0.7, 0.9, -sw * 0.15, h * 0.4 + 0.1, depth / 2 + 0.03, false);
        rectWin(b, 0.7, 0.9, sw * 0.15, h * 0.4 + 0.1, depth / 2 + 0.03, false);
        if (i % 2 === 0) rectWin(b, 0.7, 0.9, 0, h * 0.72, depth / 2 + 0.03, false);
      }
      // roof of the ring: eaves outside, higher on the yard side
      b.at(0, 0, 0, 0, () => prism(b, roof, [[depth / 2 + 0.55, h - 0.35], [-depth / 2 - 0.1, h + 2.4], [-depth / 2 - 0.1, h + 2.8], [depth / 2 + 0.55, h + 0.1]], sw * 1.04));
      // inner galleries seen over the yard side
      b.box("frame", sw * 0.99, 2.4, 0.35, 0, h, -depth / 2 + 0.15);
      for (const f of [0.28, 0.58, 0.88]) b.box("timber", sw * 0.99, 0.2, 0.3, 0, h * f, -depth / 2 - 0.15);
      b.box("timber", 0.2, h * 0.88, 0.25, -sw / 2 + 0.2, 0, -depth / 2 - 0.15);
      if (i === entrance) {
        b.box("frame", 3.4, h * 0.62, 2.0, 0, 0, depth / 2 + 1.0);
        b.gable(roof, "frame", 3.4, 2.2, 1.3, 0, h * 0.62, depth / 2 + 1.0, 0, 0.3);
        b.box("dark", 1.4, h * 0.45, 0.12, 0, 0, depth / 2 + 2.03);
      }
    });
  }
  // stage, tiring-house wall, stage cover ("heavens"), hut and flag
  const tz = -(R - depth);
  const sw = d * 0.42, sd = d * 0.26;
  const sz = tz + sd / 2;
  b.box("timber", sw, 1.5, sd, 0, 0, sz);
  b.box("timber-weathered", sw + 0.2, 0.2, 0.2, 0, 1.5, sz + sd / 2);
  b.box("frame", sw + 1.5, h + 2.6, 2.4, 0, 0, tz - 0.4);
  for (const sx of [1, -1]) b.box("timber", 0.4, h + 1.2, 0.4, sx * (sw / 2 - 0.4), 0, sz + sd / 2 - 0.5);
  b.gable(roof, "frame", sw + 1.4, sd + 0.8, 2.2, 0, h + 0.9, sz - 0.05, 0, 0.3);
  b.box("frame", 3.8, 3.0, 3.4, 0, h + 3.1, tz + 0.8);
  b.gable(roof, "frame", 3.8, 3.4, 1.5, 0, h + 6.1, tz + 0.8, 0, 0.3);
  b.box("timber", 0.14, 5.5, 0.14, 0, h + 6.3, tz + 0.8);
  b.box("plaster", 2.2, 1.2, 0.05, 1.2, h + 10.1, tz + 0.8);
  b.cyl("earth", R - depth, R - depth, 0.2, sides, 0, 0.02, 0);
}

// ---------------------------------------------------------------- docks, quays, waterfronts

function barrels(b: B, x: number, z: number, n: number): void {
  for (let i = 0; i < n; i++) b.cyl("timber", 0.42, 0.42, 0.9, 8, x + (i % 3) * 0.95, 0, z + Math.floor(i / 3) * 0.95);
}

function dock(b: B, m: PhaseModel, ctx: BuildCtx): void {
  void ctx;
  const l = num(m.l, 40), w = num(m.w, 30);
  if (m.inlet) {
    // An inlet dock (site.river.inlets): the water is the terrain's, its sides and head are lined by the waterfront
    // as the frontage either side is reclaimed. Drawn here, behind the head (local -x; +x runs to the river): the
    // hard where goods were landed, two sheds and a swing-beam hoist over the water.
    const hl = Math.min(10, l * 0.2);
    b.box("timber-weathered", hl, 6.7, w, -hl / 2 - 0.6, -5.5, 0);
    b.box("gravel", hl - 0.6, 0.12, w - 0.6, -hl / 2 - 0.6, 1.2, 0);
    for (const [x, z] of [[-hl - 4.5, -w * 0.25], [-hl - 4.5, w * 0.27]] as [number, number][]) {
      b.box("daub", 6, 3.5, 12, x, 1.2, z);
      for (let i = 0; i <= 4; i++) b.box("timber", 0.28, 3.6, 0.28, x + 3.05, 1.2, z - 6 + i * 3);
      b.box("dark", 0.2, 2.6, 2.8, x + 3.04, 1.2, z);
      b.gable("thatch", "daub", 12, 6, 2.6, x, 4.7, z, Math.PI / 2, 0.5);
    }
    b.box("timber", 0.5, 6, 0.5, -1.6, 1.2, w * 0.2);
    b.box("timber", 6.5, 0.3, 0.3, 1.0, 6.6, w * 0.2);
    b.box("timber", 0.06, 3.8, 0.06, 3.9, 2.8, w * 0.2);
    barrels(b, -hl + 1, -w * 0.05, 6);
    return;
  }
  // timber-revetted hard, planked over, with sheds and a swing-beam hoist
  b.box("timber-weathered", l, 4.2, w, 0, -3, 0);
  b.box("gravel", l - 0.6, 0.12, w - 0.6, 0, 1.2, 0);
  const np = Math.round(w / 1.2);
  for (let i = 0; i <= np; i++) b.box("timber", 0.38, 5.2, 0.38, l / 2, -3.4, -w / 2 + (i * w) / np);
  b.box("timber", 0.32, 0.32, w + 0.4, l / 2, 1.0, 0);
  b.box("timber", 0.22, 0.4, w, l / 2 + 0.2, -0.3, 0);
  for (let i = 0; i < 4; i++) b.box("timber", 0.26, 0.26, 0.26, l / 2 - 0.4, 1.3, -w / 2 + ((i + 0.5) * w) / 4);
  // two sheds: framed in timber and daub, thatched
  for (const [x, z] of [[-l * 0.2, -w * 0.25], [-l * 0.15, w * 0.27]] as [number, number][]) {
    b.box("daub", 12, 3.5, 6, x, 1.2, z);
    for (let i = 0; i <= 4; i++) b.box("timber", 0.28, 3.6, 0.28, x - 6 + i * 3, 1.2, z + 3.05);
    b.box("dark", 2.8, 2.6, 0.2, x, 1.2, z + 3.04);
    b.gable("thatch", "daub", 12, 6, 2.6, x, 4.7, z, 0, 0.5);
  }
  // hoist: post, jib and tackle
  b.box("timber", 0.5, 6, 0.5, l / 2 - 3, 1.2, w * 0.2);
  b.box("timber", 0.3, 0.3, 6.5, l / 2 - 1, 6.6, w * 0.2 + 0.0, Math.PI / 2);
  b.box("timber", 0.06, 3.8, 0.06, l / 2 + 2.2, 2.8, w * 0.2);
  b.box("timber", 0.2, 3, 0.2, l / 2 - 2, 3.6, w * 0.2, 0);
  barrels(b, l * 0.05, w * 0.05, 6);
}

/** Roman timber quay along the bank, with warehouses behind. */
function quay(b: B, m: PhaseModel, ctx: BuildCtx): void {
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
      let guard = 0;
      while (ctx.ground(x, z) > 0.4 && guard++ < 80) z += 2;
      const rot = -Math.atan2(bz - az, bx - ax);
      const L = len / n;
      ctx.trace?.push({ kind: "quay-front", x: x + 2.4 * Math.sin(rot), z: z + 2.4 * Math.cos(rot), rot, len: L, width, dir: 1 });
      b.at(x, 0, z, rot, () => {
        // box-framed revetment: planked front, tie-beams, piles, planked deck
        b.box("timber", L + 0.3, 5.2, width, 0, -3.4, -width / 2 + 2);
        for (let c = 0; c < 4; c++) b.box("timber-weathered", L + 0.5, 0.42, 0.5, 0, -0.5 + c * 0.55, 2.25);
        const np = Math.round(L / 1.1);
        for (let p = 0; p < np; p++) b.box("timber", 0.3, 2.9, 0.3, -L / 2 + ((p + 0.5) * L) / np, -1.2, 2.55);
        b.box("timber", L + 0.3, 0.1, width - 0.6, 0, 1.78, -width / 2 + 2);
        if (r() < 0.25) b.box("timber", 0.32, 0.8, 0.32, (r() - 0.5) * L, 1.8, 2.0);
        if (r() < 0.12) for (let st = 0; st < 5; st++) b.box("timber", 2.2, 0.3, 0.7, 0, 1.6 - st * 0.4, 2.9 + st * 0.7);
        if (m.warehouses && r() > 0.12) {
          const dd = 9 + r() * 3;
          const zc = -width - dd / 2 + 1;
          b.box("plaster", L - 0.6, 4, dd, 0, 1.8, zc);
          const nb = Math.max(2, Math.round((L - 0.6) / 3));
          for (let q = 0; q <= nb; q++) b.box("timber", 0.3, 4, 0.34, -(L - 0.6) / 2 + (q * (L - 0.6)) / nb, 1.8, zc + dd / 2 + 0.02);
          b.at(0, 0, zc + dd / 2, 0, () => arch(b, "dark", 3.2, 3.2, 0, 1.8, 0.03, "round", 0.25));
          b.gable("tegula", "plaster", L - 0.4, dd, 2.4, 0, 5.8, zc, 0, 0.6);
          if (r() < 0.5) for (let q = 0; q < 3; q++) b.cone("earth", 0.35, 1.0, 8, -L * 0.3 + q * 0.7, 1.8, zc + dd / 2 + 1.2);
        }
      });
    }
  }
}

function waterfront(b: B, m: PhaseModel, ctx: BuildCtx): void {
  const mat = str(m.wall, "timber-weathered");
  const stone = mat === "ragstone" || mat === "ashlar" || mat === "caen";
  const dir = num(m.side, 1);
  const top0 = num(m.top, 1.9);
  const r = rng(ctx.seed);
  // the frontage follows the bank either side of a dock; open docks are lined instead of walled off (waterline.ts)
  const { segs } = cutAtInlets(waterfrontLine(ctx.path, dir, ctx.land ?? ctx.ground), ctx.inlets);
  for (let i = 1; i <= segs.length; i++) {
    const sg = segs[i - 1];
    const [ax, az] = sg.a;
    const [bx, bz] = sg.b;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.3) continue;
    const rot = -Math.atan2(bz - az, bx - ax);
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    // a dock's lining stands as high as the reclaimed ground behind it (that ground rises as the bank moves out)
    let top = top0;
    if (sg.part !== "river") {
      const nx = (-(bz - az) / len) * dir, nz = ((bx - ax) / len) * dir; // towards the water
      top = Math.min(top0 + 2.5, Math.max(top0, ctx.ground(mx - nx * 5, mz - nz * 5)));
    }
    // river lies towards local +z when dir = 1 (the frame is rotated by `rot`)
    const roll = r();
    ctx.trace?.push({ kind: "revetment", x: mx, z: mz, rot, len, dir, top, part: sg.part });
    b.at(mx, 0, mz, rot, () => {
      const q = dir; // q * z = towards the river
      b.box(mat, len + 0.4, top + 3, 0.7, 0, -3, 0); // revetment
      if (stone) b.box("ashlar", len + 0.4, 0.3, 1.0, 0, top, 0); // coping
      else {
        b.box("timber", len + 0.4, 0.3, 0.5, 0, top - 0.1, 0); // capping rail
        b.box("timber-weathered", len + 0.3, 0.2, 0.2, 0, top * 0.5 - 0.1, q * 0.42);
        if (i % 2 === 0) b.box("timber", 0.36, top + 4, 0.36, -len / 2, -3, q * 0.55);
      }
      b.box("gravel", len + 0.4, 0.3, 9, 0, top - 0.3, -q * 4.6); // wharf
      b.box(mat, len + 0.4, top + 2.4, 8.6, 0, -3, -q * 4.6);
      if (i % 3 === 0) {
        b.cyl("timber", 0.22, 0.26, 0.9, 8, len * 0.3, top, -q * 0.5);
        b.cyl("timber", 0.22, 0.26, 0.9, 8, -len * 0.3, top, -q * 1.1);
      }
      if (sg.part === "head" || roll < 0.05) {
        // river stairs with cheek walls (always one at a dock's head)
        for (let st = 0; st < 7; st++) b.box("ragstone", 2.6, 0.35, 0.8, 0, top - 0.35 * (st + 1), q * (0.7 + st * 0.8));
        for (const sx of [1, -1]) b.box("ragstone", 0.5, top + 2.4, 6, sx * 1.55, -2.4, q * 3.2);
        for (const sx of [1, -1]) b.box("timber", 0.12, 1.1, 0.12, sx * 1.1, top, q * 0.4);
      } else if ((roll < 0.09 || (sg.part === "side" && roll < 0.3)) && m.cranes) {
        // treadwheel crane: framed housing, wheel, jib over the water
        b.at(0, top, -q * 3, 0, () => {
          b.box("timber", 3.2, 4.2, 3.2, 0, 0, 0);
          for (const sx of [1, -1]) for (const sz of [1, -1]) b.box("timber-weathered", 0.22, 4.2, 0.22, sx * 1.6, 0, sz * 1.6);
          b.gable("shingle", "timber", 3.2, 3.2, 1.6, 0, 4.2, 0, 0, 0.4);
          cylX(b, "timber", 2.3, 0.5, 2.2, 2.4, 0, 14);
          cylX(b, "timber", 2.3, 0.5, -2.2, 2.4, 0, 14);
          b.box("timber", 0.3, 0.3, 7.5, 0, 5.4, q * 3.4);
          b.box("timber", 0.3, 2.5, 0.3, 0, 4.2, q * 1.6, 0);
          b.box("timber", 0.06, 4, 0.06, 0, 1.4, q * 6.9);
        });
      }
    });
  }
}

// ---------------------------------------------------------------- registration

export function registerSecular(): void {
  if (!originals) {
    originals = {};
    for (const k of ["keep", "hall", "courtyard"]) originals[k] = BUILDERS[k];
  }
  BUILDERS.keep = keep;
  BUILDERS.hall = hall;
  BUILDERS.courtyard = courtyard;
  BUILDERS.forum = forum;
  BUILDERS.amphitheatre = amphitheatre;
  BUILDERS.wall = wallPath;
  BUILDERS.playhouse = (b, m) => playhouse(b, m);
  BUILDERS.dock = dock;
  BUILDERS.quay = quay;
  BUILDERS.waterfront = waterfront;
}
