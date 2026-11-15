import * as THREE from "three";
import type { PhaseModel } from "@/lib/types";
import type { Builder } from "../geom";
import { BUILDERS, type BuildCtx, type KindBuilder } from "../builders";
import { tileOf } from "../materials";

/**
 * Churches and religious houses. Replaces the generic `church` and `friary` builders.
 *
 * Everything is derived from the model parameters in the data (l, w, h, wall, roof, aisles, transept,
 * tower, spire, round, crossingAt, pinnacles, fleche, cloister, placeholder). The data carries no
 * architectural style, so the style is inferred, cautiously:
 *   - a shingle roof, or a large Caen-stone church with no spire, no crossingAt and no pinnacles
 *     (the data's earliest phases of Old St Paul's and Edward's abbey), is drawn Romanesque:
 *     round-headed slits, flat pilaster buttresses, no battlements, no flying buttresses;
 *   - everything else gets a neutral pointed (lancet) treatment; flying buttresses appear only on
 *     large (h >= 18 m, l >= 90 m) aisled Gothic churches, never on friary churches.
 * `placeholder: true` models are handed to the original plain builders untouched.
 */

const num = (v: unknown, d: number): number => (typeof v === "number" ? v : d);
const str = (v: unknown, d: string): string => (typeof v === "string" ? v : d);

let ORIG: { church: KindBuilder; friary: KindBuilder } | null = null;

// ---------------------------------------------------------------------------------------------
// Window and portal geometry (recessed look: a moulded stone surround stands proud of the wall,
// the glazing/shutter sits flush with the wall face, mullions between)
// ---------------------------------------------------------------------------------------------

const V2 = THREE.Vector2;

interface Arch {
  pts: THREE.Vector2[];
  hs: number;
  k: number;
  w: number;
  pointed: boolean;
}

function archOutline(w: number, ht: number, pointed: boolean, y0 = 0): Arch {
  const headNat = pointed ? w * 0.866 : w / 2;
  const hs = Math.max(Math.min(ht * 0.4, 0.5), ht - headNat);
  const k = (ht - hs) / headNat;
  const pts = [new V2(-w / 2, y0), new V2(w / 2, y0), new V2(w / 2, y0 + hs)];
  if (pointed) {
    for (const a of [20, 40, 60]) {
      const r = (a * Math.PI) / 180;
      pts.push(new V2(-w / 2 + w * Math.cos(r), y0 + hs + k * w * Math.sin(r)));
    }
    for (const a of [40, 20, 0]) {
      const r = (a * Math.PI) / 180;
      pts.push(new V2(w / 2 - w * Math.cos(r), y0 + hs + k * w * Math.sin(r)));
    }
  } else {
    for (const a of [30, 60, 90, 120, 150, 180]) {
      const r = (a * Math.PI) / 180;
      pts.push(new V2((w / 2) * Math.cos(r), y0 + hs + k * (w / 2) * Math.sin(r)));
    }
  }
  return { pts, hs, k, w, pointed };
}

/** Height of the arch intersect at horizontal offset x (relative to the arch inner y0 = 0). */
function archY(a: Arch, x: number): number {
  const xs = Math.abs(x);
  return a.hs + a.k * (a.pointed ? Math.sqrt(Math.max(0, a.w * a.w - (xs + a.w / 2) ** 2)) : Math.sqrt(Math.max(0, (a.w / 2) ** 2 - xs * xs)));
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g.clone();
}
function uvFromPos(g: THREE.BufferGeometry, tile: number): THREE.BufferGeometry {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (p.getX(i) + p.getZ(i)) / tile;
    uv[i * 2 + 1] = p.getY(i) / tile;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}
const f2 = (v: number) => v.toFixed(2);

function frameGeo(mat: string, w: number, ht: number, t: number, depth: number, pointed: boolean): THREE.BufferGeometry {
  return cached(`f|${mat}|${f2(w)}|${f2(ht)}|${f2(t)}|${f2(depth)}|${pointed}`, () => {
    const outer = archOutline(w + 2 * t, ht + 2 * t, pointed);
    const inner = archOutline(w, ht, pointed, t);
    const shape = new THREE.Shape(outer.pts);
    shape.holes.push(new THREE.Path(inner.pts));
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
    return uvFromPos(g, tileOf(mat));
  });
}
function fillGeo(mat: string, w: number, ht: number, t: number, pointed: boolean): THREE.BufferGeometry {
  return cached(`i|${mat}|${f2(w)}|${f2(ht)}|${f2(t)}|${pointed}`, () => {
    const g = new THREE.ShapeGeometry(new THREE.Shape(archOutline(w, ht, pointed, t).pts), 1);
    return uvFromPos(g, tileOf(mat));
  });
}

const M_FWD = new THREE.Matrix4().makeTranslation(0, 0, 0.03);

interface WinOpt {
  w: number;
  ht: number;
  pointed: boolean;
  glazed: boolean;
  dress: string;
  lights?: number;
  /** adds a transom (large windows) */
  transom?: boolean;
  depth?: number;
}

/** A window on a wall whose outward normal is local +z; frame origin = bottom centre of the surround, wall face at z = 0. */
function win(b: Builder, o: WinOpt): void {
  const { w, ht, dress } = o;
  if (w < 0.3 || ht < 0.8) return;
  const t = Math.min(0.34, Math.max(0.16, w * 0.2));
  b.add(dress, frameGeo(dress, w, ht, t, o.depth ?? 0.36, o.pointed));
  const fill = o.glazed ? "glass" : "dark";
  b.add(fill, fillGeo(fill, w, ht, t, o.pointed), M_FWD);
  const n = o.lights ?? (w < 1.3 ? 1 : w < 2.5 ? 2 : w < 3.8 ? 3 : 4);
  const arch = archOutline(w, ht, o.pointed, 0);
  for (let i = 1; i < n; i++) {
    const x = -w / 2 + (w * i) / n;
    const top = t + archY(arch, x) - 0.04;
    const mullW = Math.max(0.12, w * 0.04);
    b.box(dress, mullW, Math.max(0.2, top - t), 0.2, x, t, 0.17);
  }
  if (o.transom && ht > 3.6) b.box(dress, w, 0.14, 0.2, 0, t + arch.hs * 0.62, 0.17);
  b.box(dress, w + 2 * t + 0.35, 0.18, 0.5, 0, -0.1, 0.26);
}

/** Moulded doorway with `orders` nested surrounds. */
function portal(b: Builder, dress: string, w: number, ht: number, pointed: boolean, orders = 2): void {
  for (let i = orders - 1; i >= 0; i--) {
    const ww = w + 0.75 * i, hh = ht + 0.55 * i;
    b.add(dress, frameGeo(dress, ww, hh, 0.36, 0.42 - 0.1 * i, pointed));
  }
  b.add("dark", fillGeo("dark", w, ht, 0.36, pointed), M_FWD);
  b.box(dress, w + 0.7, 0.2, 0.7, 0, 0, 0.35);
}

/** Run fn in a frame standing on a wall point with outward normal (nx, nz); local +z = outward, y is the window bottom. */
function onWall(b: Builder, x: number, y: number, z: number, nx: number, nz: number, fn: () => void): void {
  b.at(x, y, z, Math.atan2(nx, nz), fn);
}

function leanTo(b: Builder, mat: string, x0: number, len: number, zO: number, yO: number, zI: number, yI: number): void {
  const t = tileOf(mat);
  const hl = len / 2;
  const slope = Math.hypot(zO - zI, yO - yI);
  const A = [x0 - hl, yO, zO], B = [x0 + hl, yO, zO], C = [x0 + hl, yI, zI], D = [x0 - hl, yI, zI];
  const flip = zO < zI;
  const pos = flip ? [...A, ...C, ...B, ...A, ...D, ...C] : [...A, ...B, ...C, ...A, ...C, ...D];
  const uvp = flip
    ? [0, 0, len / t, slope / t, len / t, 0, 0, 0, 0, slope / t, len / t, slope / t]
    : [0, 0, len / t, 0, len / t, slope / t, 0, 0, len / t, slope / t, 0, slope / t];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvp, 2));
  g.computeVertexNormals();
  b.add(mat, g);
}

/** A box slab tilted about the local x axis (for flying buttresses). Runs from (z1, y1) to (z2, y2). */
function strut(b: Builder, mat: string, width: number, thick: number, x: number, z1: number, y1: number, z2: number, y2: number): void {
  const dz = z2 - z1, dy = y2 - y1;
  const len = Math.hypot(dz, dy);
  const g = new THREE.BoxGeometry(width, thick, len);
  const t = tileOf(mat);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (len / t), uv.getY(i) * (width / t));
  const alpha = Math.atan2(-dy, dz);
  b.add(mat, g, new THREE.Matrix4().makeRotationX(alpha).setPosition(x, (y1 + y2) / 2, (z1 + z2) / 2));
}

/** Pointed-roof pinnacle: shaft + spire. */
function pinnacle(b: Builder, mat: string, x: number, y: number, z: number, size = 1, sides = 4): void {
  b.box(mat, 0.8 * size, 1.4 * size, 0.8 * size, x, y, z);
  b.cyl(mat, 0.001, 0.62 * size, 2.6 * size, sides, x, y + 1.4 * size, z, sides === 4 ? Math.PI / 4 : 0, true);
}

// ---------------------------------------------------------------------------------------------
// Towers and spires
// ---------------------------------------------------------------------------------------------

interface TowerOpt {
  tx: number;
  W: number;
  th: number;
  wall: string;
  dress: string;
  roof: string;
  roman: boolean;
  pinnacles: boolean;
  spire: number;
  /** y of the roof ridge that abuts the tower (openings stay above it) */
  ridgeY: number;
  /** outward normal of the face that carries the west portal/window (west tower), if any */
  westDoor?: { w: number; ht: number } | null;
}

function crenel(b: Builder, mat: string, tx: number, y: number, hw: number, W: number): void {
  const n = Math.max(3, Math.round(W / 1.7));
  const step = (W - 0.6) / n;
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    // continuous low parapet
    b.box(mat, nx ? 0.5 : W + 0.3, 0.8, nx ? W + 0.3 : 0.5, tx + nx * (hw - 0.05), y, nz * (hw - 0.05));
    for (let i = 0; i < n; i++) {
      const o = -((W - 0.6) / 2) + (i + 0.5) * step;
      if (nx) b.box(mat, 0.5, 0.85, step * 0.55, tx + nx * (hw - 0.05), y + 0.8, o);
      else b.box(mat, step * 0.55, 0.85, 0.5, tx + o, y + 0.8, nz * (hw - 0.05));
    }
  }
}

function tower(b: Builder, o: TowerOpt): void {
  const { tx, W, th, wall, dress, roman } = o;
  const hw = W / 2;
  const lead = o.roof === "lead";
  b.box(wall, W, th + 3, W, tx, -3, 0);
  for (const f of [0.3, 0.62]) b.box(dress, W + 0.5, 0.35, W + 0.5, tx, th * f, 0);
  b.box(dress, W + 0.6, 0.4, W + 0.6, tx, th - 1.3, 0);
  // corner buttresses (Gothic) or flat pilaster strips (Romanesque)
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    if (roman) {
      b.box(dress, 1.1, th * 0.9, 1.1, tx + sx * (hw - 0.4), 0, sz * (hw - 0.4));
    } else {
      const bh = th * 0.5;
      b.box(wall, 0.9, bh, 1.8, tx + sx * (hw + 0.3), 0, sz * (hw - 0.9));
      b.box(wall, 1.8, bh, 0.9, tx + sx * (hw - 0.9), 0, sz * (hw + 0.3));
      b.box(wall, 0.7, bh * 0.35, 1.4, tx + sx * (hw + 0.2), bh, sz * (hw - 0.7));
      b.box(wall, 1.4, bh * 0.35, 0.7, tx + sx * (hw - 0.7), bh, sz * (hw + 0.2));
    }
  }
  const faces: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // belfry openings between the upper string courses
  const avail = th - 1.3 - (th * 0.62 + 0.35) - 0.5;
  const bht = Math.min(Math.max(2.2, th * 0.2), 8, avail - 0.8);
  const bw = Math.min(Math.max(1.0, W * 0.2), 2.6);
  const bBase = Math.max(th * 0.62 + 0.35 + (avail - bht) / 2, o.ridgeY + 0.4);
  const showBelfry = bht >= 2 && bBase + bht < th - 1.5;
  // lower stage lancet
  const lw = Math.min(1.0, W * 0.1);
  const lht = th * 0.18;
  const lBase = th * 0.38;
  for (const [nx, nz] of faces) {
    const isWest = o.westDoor && nx === -1;
    if (showBelfry) {
      for (const off of roman ? [0] : [-1, 1]) {
        const px = nx ? 0 : off * W * 0.2, pz = nx ? off * W * 0.2 : 0;
        onWall(b, tx + nx * hw + px, bBase, nz * hw + pz, nx, nz, () => win(b, { w: roman ? bw * 1.3 : bw, ht: bht, pointed: !roman, glazed: false, dress, lights: roman ? 2 : 2, depth: 0.5 }));
      }
    }
    if (!isWest && lBase > o.ridgeY && lht > 1.4) onWall(b, tx + nx * hw, lBase, nz * hw, nx, nz, () => win(b, { w: lw, ht: lht, pointed: !roman, glazed: !roman, dress, lights: 1 }));
  }
  if (o.westDoor) {
    const d = o.westDoor;
    onWall(b, tx - hw, 0, 0, -1, 0, () => portal(b, dress, d.w, d.ht, !roman, 3));
    const wy = d.ht + 1.6;
    const wh = Math.min(th * 0.2, th * 0.38 - wy);
    if (wh > 1.8) onWall(b, tx - hw, wy, 0, -1, 0, () => win(b, { w: Math.min(W * 0.28, 2.6), ht: wh, pointed: !roman, glazed: !roman, dress }));
  }
  // top
  if (o.spire > 0) {
    for (const [nx, nz] of faces) b.box(wall, nx ? 0.5 : W + 0.3, 0.9, nx ? W + 0.3 : 0.5, tx + nx * (hw - 0.05), th, nz * (hw - 0.05));
    b.box(lead ? "lead" : o.roof, W - 0.3, 0.2, W - 0.3, tx, th, 0);
    spire(b, tx, th + 0.15, W, o.spire);
  } else if (roman) {
    b.pyramid(lead ? "lead" : o.roof, W + 0.8, W + 0.8, W * 0.5, tx, th, 0);
  } else {
    crenel(b, wall, tx, th, hw, W);
    b.box("lead", W - 0.4, 0.2, W - 0.4, tx, th, 0);
    if (!o.pinnacles) {
      // stair turret
      const r = Math.min(1.3, Math.max(0.8, W * 0.12));
      b.cyl(wall, r, r, th + 3.2 + 3, 8, tx + hw - r * 0.4, -3, hw - r * 0.4);
      b.cone("lead", r + 0.2, r * 2.2, 8, tx + hw - r * 0.4, th + 3.2, hw - r * 0.4);
    }
  }
  if (o.pinnacles || o.spire > 0) {
    const sz = Math.min(1.6, Math.max(0.9, W * 0.1));
    for (const sx of [1, -1]) for (const sz2 of [1, -1]) pinnacle(b, dress, tx + sx * (hw - 0.5), th + 0.85, sz2 * (hw - 0.5), sz);
  }
}

/** Timber-and-lead octagonal spire with four broaches, collars, and a gilded ball and cross. */
function spire(b: Builder, tx: number, y: number, W: number, H: number): void {
  const a = W / 2 - 0.35; // apothem of the octagon
  const R = a / Math.cos(Math.PI / 8);
  b.cone("lead", R, H, 8, tx, y, 0, Math.PI / 8);
  for (const f of [0.38, 0.66]) {
    const r = R * (1 - f) + 0.28;
    b.cyl("timber-weathered", r, r, 0.4, 8, tx, y + f * H, 0, Math.PI / 8);
  }
  // broaches
  const fb = 0.2;
  const pos: number[] = [];
  const k = Math.tan(Math.PI / 8);
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const C = [tx + sx * (W / 2 - 0.2), y, sz * (W / 2 - 0.2)];
    const V1 = [tx + sx * a, y, sz * a * k];
    const V2 = [tx + sx * a * k, y, sz * a];
    const P = [tx + sx * a * 0.7071 * (1 - fb), y + fb * H, sz * a * 0.7071 * (1 - fb)];
    for (const [p, q] of [[V1, C], [C, V2]] as const) {
      // order so the face normal points away from the spire axis
      const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], e2 = [P[0] - p[0], P[1] - p[1], P[2] - p[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const out = n[0] * sx + n[2] * sz;
      pos.push(...(out > 0 ? [...p, ...q, ...P] : [...p, ...P, ...q]));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const uv: number[] = [];
  for (let i = 0; i < pos.length / 3; i++) uv.push(pos[i * 3] / 4, pos[i * 3 + 1] / 4);
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  b.add("lead", g);
  // finial
  b.cyl("gold", 0.55, 0.55, 0.9, 8, tx, y + H - 0.3, 0);
  b.box("gold", 0.2, 2.4, 0.2, tx, y + H + 0.55, 0);
  b.box("gold", 1.3, 0.2, 0.2, tx, y + H + 1.9, 0);
}

/** Small timber lantern and slender lead spirelet on the ridge (friars' fleche). */
function fleche(b: Builder, x: number, y: number, H: number, size: number): void {
  const r = size / 2;
  b.cyl("timber-weathered", r, r * 1.05, 3.4, 8, x, y, 0, Math.PI / 8);
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) b.box("dark", nx ? 0.1 : 0.7, 1.5, nx ? 0.7 : 0.1, x + nx * r * 0.93, y + 1.0, nz * r * 0.93);
  b.cyl("lead", r * 1.15, r * 1.15, 0.35, 8, x, y + 3.4, 0, Math.PI / 8);
  b.cone("lead", r * 1.0, H, 8, x, y + 3.75, 0, Math.PI / 8);
  b.box("gold", 0.14, 1.4, 0.14, x, y + 3.75 + H - 0.2, 0);
  b.box("gold", 0.8, 0.14, 0.14, x, y + 3.75 + H + 0.6, 0);
}

// ---------------------------------------------------------------------------------------------
// Church body
// ---------------------------------------------------------------------------------------------

interface BodyOpt {
  friary: boolean;
}

function churchBody(b: Builder, m: PhaseModel, opt: BodyOpt): { rise: number; x0: number; naveW: number } {
  const l = num(m.l, 30), w = num(m.w, 12), h = num(m.h, 9);
  const wall = str(m.wall, "ragstone"), roof = str(m.roof, "tile");
  const aisles = !!m.aisles;
  const lead = roof === "lead";
  const dress = wall === "caen" ? "caen" : "ashlar";
  const round = num(m.round, 0);
  const tw = m.tower as { w: number; h: number; at?: string; pinnacles?: boolean } | undefined;
  const sp = num(m.spire, 0);
  const tr = m.transept as { l: number; w: number } | undefined;
  const hasCross = typeof m.crossingAt === "number";
  const pinn = !!m.pinnacles;
  const roman = roof === "shingle" || (wall === "caen" && !hasCross && sp === 0 && !pinn && !round && aisles);
  const pointed = !roman;
  const glazed = !roman;
  const naveW = aisles ? w * 0.5 : w;
  const aw = (w - naveW) / 2;
  const ah = aisles ? h * 0.55 : h;
  const pf = pinn ? 0.3 : lead ? 0.7 : roof === "shingle" ? 1.15 : 1.0;
  const rise = (naveW / 2) * pf;
  const ahTop = aisles ? Math.min(ah + aw * (lead ? 0.3 : 0.65), h - 3) : h;
  // The body is centred on the landmark point unless a phase pins one end (`eastEnd` / `westEnd`: metres along the
  // bearing from the point, + towards the bearing): phases of one church then share that end, so a longer phase
  // grows the way the church did (a nave rebuilt westwards, a choir extended east) instead of at both ends.
  const x0 = typeof m.eastEnd === "number" ? m.eastEnd - l / 2 : typeof m.westEnd === "number" ? m.westEnd + l / 2 : round ? round * 0.5 : 0;
  const xW = x0 - l / 2, xE = x0 + l / 2;
  const cx = xW + l * num(m.crossingAt, 0.62);
  const flying = !opt.friary && pointed && aisles && h >= 18 && l >= 90 && (sp > 0 || hasCross || !tw);
  const parapet = (lead || pinn) && !roman;
  const ov = parapet ? 0.05 : 0.5;
  const roofMat = lead ? "lead" : roof;
  const bl = h >= 20 ? 7 : h >= 14 ? 6 : 4.8;
  const nb = Math.max(2, Math.round(l / bl));
  const step = l / nb;
  const xz = Math.max(tr ? tr.w / 2 : 0, tw && tw.at === "crossing" ? tw.w / 2 : 0);
  const inCrossing = (x: number, pad = 0.5) => xz > 0 && Math.abs(x - cx) < xz + pad;
  const westTower = !!tw && tw.at !== "crossing";
  const sides = [1, -1];

  // --- masses and roofs
  b.box(wall, l, h + 3, naveW, x0, -3, 0);
  b.gable(roof, wall, l, naveW, rise, x0, h, 0, 0, ov);
  b.box(roofMat, l + 0.1, 0.25, 0.4, x0, h + rise - 0.12, 0);
  if (aisles) for (const s of sides) {
    b.box(wall, l, ah + 3, aw, x0, -3, s * (naveW / 2 + aw / 2));
    if (parapet) leanTo(b, roofMat, x0, l, s * (w / 2 - 0.15), ah + 0.1, s * (naveW / 2), ahTop);
    else {
      const sl = (ahTop - ah) / aw;
      leanTo(b, roofMat, x0, l + 0.8, s * (w / 2 + 0.45), ah - 0.45 * sl, s * (naveW / 2), ahTop);
    }
  }
  if (parapet) {
    for (const s of sides) {
      b.box(wall, l, 0.75, 0.45, x0, h, s * (naveW / 2 - 0.05));
      if (aisles) b.box(wall, l, 0.75, 0.45, x0, ah, s * (w / 2 - 0.15));
    }
  }
  // string courses
  for (const s of sides) {
    if (aisles) b.box(dress, l, 0.28, 0.3, x0, ah - 0.35, s * (w / 2 + 0.1));
    b.box(dress, l, 0.28, 0.3, x0, h - 0.35, s * (naveW / 2 + 0.1));
  }

  // --- bays
  const pAisle = roman ? 0.4 : aisles ? Math.min(2.2, Math.max(1.0, aw * 0.28)) : Math.min(1.5, Math.max(0.9, w * 0.08));
  const bw = roman ? 1.5 : Math.min(1.3, step * 0.2);
  const outerTop = aisles ? ah + (flying ? 2.4 : 0.2) : h - 0.5;
  for (const s of sides) {
    const zWall = (aisles ? w : naveW) / 2;
    // buttresses at bay boundaries
    for (let i = 0; i <= nb; i++) {
      const xb = xW + i * step;
      if (xz > 0 && Math.abs(xb - cx) < xz - 0.01) continue;
      const end = i === 0 || i === nb;
      if (roman) {
        b.box(dress, bw, outerTop, pAisle, xb, 0, s * (zWall + pAisle / 2 - 0.05));
        if (aisles) b.box(dress, bw, h - ahTop + 1, 0.3, xb, ahTop, s * (naveW / 2 + 0.1));
        continue;
      }
      const p = pAisle;
      b.box(wall, bw, outerTop * 0.55, p, xb, 0, s * (zWall + p / 2 - 0.05));
      b.box(wall, bw * 0.82, outerTop - 0.4, p * 0.62, xb, outerTop * 0.55, s * (zWall + p * 0.31 - 0.05));
      b.box(dress, bw * 0.9, 0.25, p * 0.7, xb, outerTop * 0.55 - 0.05, s * (zWall + p * 0.35));
      if (pinn) {
        pinnacle(b, dress, xb, outerTop - 0.4, s * (zWall + p * 0.45), 1.2, 8);
      } else if (flying) {
        pinnacle(b, dress, xb, outerTop - 0.4, s * (zWall + p * 0.4), 1.15);
      } else {
        b.pyramid(dress, bw * 0.9, p * 0.7, 0.8, xb, outerTop - 0.3, s * (zWall + p * 0.35));
      }
      if (end) {
        // return buttress on the end wall
        const ex = i === 0 ? -1 : 1;
        b.box(wall, p, outerTop * 0.8, bw, xb + ex * (p / 2 - 0.05), 0, s * (zWall - bw / 2 + 0.05));
      }
      if (flying && !end) {
        const zIn = naveW / 2 + 1.0;
        const yTop = h - 3.2;
        b.box(wall, bw * 0.85, h + 2.2 - (ahTop - 0.5), 1.2, xb, ahTop - 0.5, s * (naveW / 2 + 0.55));
        pinnacle(b, dress, xb, h + 1.6, s * (naveW / 2 + 0.55), 1.2);
        strut(b, dress, bw * 0.7, 0.55, xb, s * (zWall + p * 0.5), outerTop - 0.2, s * zIn, yTop);
        strut(b, wall, bw * 0.55, 0.4, xb, s * (zWall + p * 0.5), outerTop - 1.6, s * zIn, yTop - 1.2);
      }
    }
    // windows
    for (let i = 0; i < nb; i++) {
      const xc = xW + (i + 0.5) * step;
      if (inCrossing(xc, 1)) continue;
      if (westTower && i === 0 && tw && tw.w > aw * 3 && !aisles) continue;
      const ww = roman ? Math.min(0.9, step * 0.16) : Math.min(step * 0.34, 2.8);
      const lights = roman ? 1 : undefined;
      if (aisles) {
        const wh = ah * 0.55;
        onWall(b, xc, ah * 0.26, s * (w / 2), 0, s, () => win(b, { w: ww, ht: wh, pointed, glazed, dress, lights }));
        const cs = ahTop + 0.8, cht = h - 1.4 - cs;
        if (cht >= 1.6) onWall(b, xc, cs, s * (naveW / 2), 0, s, () => win(b, { w: ww * 0.9, ht: cht, pointed, glazed, dress, lights }));
      } else {
        const wy = h * (pinn ? 0.2 : 0.3);
        const wh = pinn ? h * 0.66 : h * 0.5;
        const wwid = pinn ? Math.min(step * 0.5, 3.6) : ww;
        onWall(b, xc, wy, s * (naveW / 2), 0, s, () => win(b, { w: wwid, ht: wh, pointed, glazed, dress, lights, transom: pinn || h >= 14 }));
      }
    }
  }

  // --- east end
  {
    const ew = Math.min(naveW * 0.5, 7), eh = h * 0.62;
    onWall(b, xE, h * 0.24, 0, 1, 0, () => win(b, { w: ew, ht: eh, pointed, glazed, dress, transom: true, depth: 0.45 }));
    for (const s of sides) {
      b.box(wall, 1.0, h + 0.4, 1.0, xE - 0.1, 0, s * (naveW / 2 + (aisles ? aw : 0) - 0.4));
    }
    if (aisles) for (const s of sides) onWall(b, xE, ah * 0.26, s * (naveW / 2 + aw / 2), 1, 0, () => win(b, { w: Math.min(aw * 0.45, 1.6), ht: ah * 0.55, pointed, glazed, dress, lights: 1 }));
  }

  // --- west front (a west tower carries the portal itself)
  if (!westTower && !round) {
    const pw = Math.min(3.4, Math.max(1.5, naveW * 0.22));
    onWall(b, xW, 0, 0, -1, 0, () => portal(b, dress, pw, pw * 1.9, pointed, roman ? 3 : 2));
    const sill = pw * 1.9 + 1.5 + (pointed ? 0.4 : 0);
    const wh = h * 0.96 - sill;
    if (wh >= 2.4) onWall(b, xW, sill, 0, -1, 0, () => win(b, { w: Math.min(naveW * 0.5, 6), ht: wh, pointed, glazed, dress, transom: true, depth: 0.45 }));
    if (aisles) for (const s of sides) {
      onWall(b, xW, 0, s * (naveW / 2 + aw / 2), -1, 0, () => portal(b, dress, Math.min(aw * 0.35, 1.5), Math.min(aw * 0.35, 1.5) * 1.9, pointed, 1));
      onWall(b, xW, ah * 0.5, s * (naveW / 2 + aw / 2), -1, 0, () => win(b, { w: Math.min(aw * 0.35, 1.5), ht: ah * 0.32, pointed, glazed, dress, lights: 1 }));
    }
    for (const s of sides) {
      const zc = (aisles ? w : naveW) / 2;
      b.box(wall, pAisle, (aisles ? ah : h) * 0.85, bw, xW - pAisle / 2 + 0.05, 0, s * (zc - bw / 2 + 0.05));
    }
  }

  // --- transept
  if (tr) {
    const tl = tr.l, twd = tr.w;
    const trRise = rise;
    b.box(wall, twd, h + 3, tl, cx, -3, 0);
    b.gable(roof, wall, tl, twd, trRise, cx, h, 0, Math.PI / 2, ov);
    b.box(roofMat, 0.4, 0.25, tl + 0.1, cx, h + trRise - 0.12, 0);
    for (const s of sides) {
      const zEnd = s * tl / 2;
      const aw2 = Math.min(twd * 0.4, 6);
      onWall(b, cx, h * 0.22, zEnd, 0, s, () => win(b, { w: aw2, ht: h * 0.6, pointed, glazed, dress, transom: true, depth: 0.45 }));
      for (const sx of sides) {
        b.box(wall, 1.5, h + 0.6, 1.5, cx + sx * (twd / 2 - 0.3), 0, zEnd - s * 0.3);
        if (!roman && !(m.transept && twd < 8)) pinnacle(b, dress, cx + sx * (twd / 2 - 0.3), h + 0.6, zEnd - s * 0.3, 1.2);
      }
      // side walls of the arm
      const run = tl / 2 - (aisles ? w : naveW) / 2;
      const nbt = Math.floor(run / 5.5);
      if (nbt >= 1) for (const sx of sides) {
        for (let j = 0; j < nbt; j++) {
          const zc = s * ((aisles ? w : naveW) / 2 + (j + 0.5) * (run / nbt));
          onWall(b, cx + sx * (twd / 2), h * 0.26, zc, sx, 0, () => win(b, { w: roman ? 0.9 : Math.min(2.0, run / nbt * 0.35), ht: h * 0.5, pointed, glazed, dress, lights: roman ? 1 : undefined }));
          if (!roman) b.box(wall, 0.8, h - 1.0, 1.1, cx + sx * (twd / 2 + 0.45), 0, s * ((aisles ? w : naveW) / 2 + j * (run / nbt)) );
        }
      }
      if (parapet) for (const sx of sides) b.box(wall, 0.45, 0.75, tl / 2 - naveW / 2, cx + sx * (twd / 2 - 0.1), h, s * (tl / 4 + naveW / 4));
    }
    // south-door portal
    onWall(b, cx, 0, tl / 2, 0, 1, () => portal(b, dress, Math.min(2.8, twd * 0.14), Math.min(2.8, twd * 0.14) * 1.9, pointed, roman ? 3 : 2));
  }

  // --- round nave (Temple Church)
  if (round) {
    const R = round / 2;
    const xr = x0 - l / 2 - R + 1;
    const ahr = h * 0.62;
    const r2 = R * 0.58;
    const hr = h + 0.5;
    b.cyl(wall, R, R, ahr + 3, 16, xr, -3, 0);
    b.cyl(wall, r2, r2, hr - ahr + 0.2, 12, xr, ahr - 0.2, 0);
    const slope = (R - r2) * 0.32;
    b.cyl(roofMat, r2 + 0.1, R + 0.3, slope + 0.15, 16, xr, ahr - 0.1, 0, 0, true);
    b.cone(roofMat, r2 + 0.5, r2 * 1.15, 12, xr, hr, 0);
    b.cyl(dress, R + 0.15, R + 0.15, 0.3, 16, xr, ahr - 0.45, 0);
    b.cyl(dress, r2 + 0.15, r2 + 0.15, 0.3, 12, xr, hr - 0.5, 0);
    const apR = R * Math.cos(Math.PI / 16);
    for (let i = 0; i < 16; i++) {
      const ang = ((i + 0.5) * 2 * Math.PI) / 16;
      const nx = Math.sin(ang), nz = Math.cos(ang);
      // pilaster on every vertex, window on every second face
      const va = (i * 2 * Math.PI) / 16;
      b.box(wall, 0.7, ahr * 0.95, 0.6, xr + Math.sin(va) * (R + 0.15), 0, Math.cos(va) * (R + 0.15), va);
      if (i % 2 === 1 || i % 4 === 0) {
        if (Math.abs(nx + 1) < 0.5 && Math.abs(nz) < 0.5) continue;
        onWall(b, xr + nx * apR, ahr * 0.24, nz * apR, nx, nz, () => win(b, { w: 0.9, ht: ahr * 0.5, pointed, glazed, dress, lights: 1 }));
      }
    }
    const apD = r2 * Math.cos(Math.PI / 12);
    for (let i = 0; i < 12; i += 1) {
      const ang = ((i + 0.5) * 2 * Math.PI) / 12;
      const nx = Math.sin(ang), nz = Math.cos(ang);
      onWall(b, xr + nx * apD, ahr + 0.6, nz * apD, nx, nz, () => win(b, { w: 0.85, ht: hr - ahr - 1.4, pointed, glazed, dress, lights: 1 }));
    }
    // west porch with round-arched doorway
    b.box(wall, 3.4, ahr + 0.2, 4.2, xr - R - 0.8, 0, 0);
    b.gable(roofMat, wall, 3.4, 4.2, 1.8, xr - R - 0.8, ahr + 0.2, 0, Math.PI / 2, 0.15);
    onWall(b, xr - R - 2.5, 0, 0, -1, 0, () => portal(b, dress, 1.6, 2.9, false, 3));
  }

  // --- towers
  if (tw) {
    const tx = tw.at === "crossing" ? cx : x0 - l / 2 - tw.w / 2 + 0.5;
    const pw = Math.min(3, Math.max(1.4, tw.w * 0.3));
    tower(b, {
      tx, W: tw.w, th: tw.h, wall, dress, roof, roman,
      pinnacles: !!tw.pinnacles, spire: sp,
      ridgeY: tw.at === "crossing" ? h + rise : 0,
      westDoor: tw.at === "crossing" ? null : { w: pw, ht: pw * 1.9 },
    });
  }
  const fl = num(m.fleche, 0);
  if (fl > 0 && !tw) fleche(b, xW + l * num(m.crossingAt, 0.62), h + rise - 0.1, fl, Math.max(3.6, Math.min(5, w * 0.18)));
  return { rise, x0, naveW };
}

function church(b: Builder, m: PhaseModel, ctx: BuildCtx): void {
  if (m.placeholder) return ORIG!.church(b, m, ctx);
  churchBody(b, m, { friary: false });
}

// ---------------------------------------------------------------------------------------------
// Friary / priory: church + cloister garth with ranges and a chapter-house projection
// ---------------------------------------------------------------------------------------------

function sqWin(b: Builder, dress: string, w: number, ht: number, x: number, y: number, z: number, s: number): void {
  b.box(dress, w + 0.35, ht + 0.35, 0.12, x, y - 0.18, z + s * 0.01);
  b.box("dark", w, ht, 0.14, x, y, z + s * 0.04);
  b.box(dress, 0.12, ht, 0.18, x, y, z + s * 0.06);
}

function rangeBlock(b: Builder, wall: string, dress: string, x: number, z: number, len: number, dep: number, hgt: number, rot: number, rows: number, tall = false): void {
  b.at(x, 0, z, rot, () => {
    b.box(wall, len, hgt + 3, dep, 0, -3, 0);
    b.gable("tile", wall, len, dep, (dep / 2) * 0.85, 0, hgt, 0, 0, 0.35);
    const n = Math.max(1, Math.floor(len / 3.2));
    for (const s of [1, -1]) for (let i = 0; i < n; i++) {
      const xi = -len / 2 + (i + 0.5) * (len / n);
      if (tall) {
        onWall(b, xi, hgt * 0.3, s * dep / 2, 0, s, () => win(b, { w: 1.1, ht: hgt * 0.5, pointed: true, glazed: true, dress, lights: 1, depth: 0.3 }));
      } else for (let r = 0; r < rows; r++) sqWin(b, dress, 0.75, 1.1, xi, hgt * (rows === 1 ? 0.45 : 0.2 + r * 0.42), s * dep / 2, s);
    }
  });
}

function friary(b: Builder, m: PhaseModel, ctx: BuildCtx): void {
  if (m.placeholder) return ORIG!.friary(b, m, ctx);
  const l = num(m.l, 60), w = num(m.w, 20), cl = num(m.cloister, 30);
  const wall = str(m.wall, "ragstone");
  const dress = wall === "caen" ? "caen" : "ashlar";
  const { x0 } = churchBody(b, { ...m, aisles: true }, { friary: true });
  if (cl < 8) return;
  const dep = Math.min(7, Math.max(5, cl * 0.22));
  const alley = 2.3;
  const ccx = x0 - l * 0.1, z0 = w / 2 + 0.4;
  const ccz = z0 + cl / 2;
  // east range: dormitory over undercroft, with the chapter house projecting east
  const xe = ccx + cl / 2 - dep / 2;
  rangeBlock(b, wall, dress, xe, ccz, cl, dep, 8.6, Math.PI / 2, 2);
  b.at(ccx + cl / 2 + 3.4, 0, z0 + 7, 0, () => {
    b.box(wall, 7.2, 9.4, 8, 0, -3, 0);
    b.gable("tile", wall, 7.2, 8, 3.6, 0, 6.4, 0, 0, 0.3);
    onWall(b, 3.6, 1.4, 0, 1, 0, () => win(b, { w: 3.6, ht: 4.2, pointed: true, glazed: true, dress, transom: true, depth: 0.4 }));
    for (const s of [1, -1]) onWall(b, 0, 1.6, s * 4, 0, s, () => win(b, { w: 1.0, ht: 3.2, pointed: true, glazed: true, dress, lights: 1 }));
    for (const s of [1, -1]) b.box(wall, 1.0, 6.8, 1.0, 3.5, 0, s * 4 - s * 0.3);
  });
  // west range (cellarer) and south range (refectory)
  rangeBlock(b, wall, dress, ccx - cl / 2 + dep / 2, ccz, cl, dep, 6.6, Math.PI / 2, 1);
  const sl = cl - 2 * dep;
  if (sl > 4) rangeBlock(b, wall, dress, ccx, z0 + cl - dep / 2, sl, dep, 7.8, 0, 1, true);
  // alleys: low arcade, posts and a pentice roof against each range and the church
  const gx0 = ccx - cl / 2 + dep + alley, gx1 = ccx + cl / 2 - dep - alley;
  const gz0 = z0 + alley, gz1 = z0 + cl - dep - alley;
  const gl = gx1 - gx0, gd = gz1 - gz0;
  if (gl > 3 && gd > 3) {
    b.box("foliage", gl, 2.05, gd, (gx0 + gx1) / 2, -2, (gz0 + gz1) / 2);
    b.box("gravel", gl, 2.1, 1.0, (gx0 + gx1) / 2, -2, (gz0 + gz1) / 2);
    b.box("gravel", 1.0, 2.1, gd, (gx0 + gx1) / 2, -2, (gz0 + gz1) / 2);
    b.cyl(dress, 0.8, 0.9, 0.95, 8, (gx0 + gx1) / 2, 0, (gz0 + gz1) / 2);
    const edges: [number, number, number, number, number, number][] = [
      [gx0, gz0, gx1, gz0, 0, -1], [gx0, gz1, gx1, gz1, 0, 1], [gx0, gz0, gx0, gz1, -1, 0], [gx1, gz0, gx1, gz1, 1, 0],
    ];
    for (const [ax, az, bx, bz, nx, nz] of edges) {
      const len = Math.hypot(bx - ax, bz - az);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      b.at(mx, 0, mz, Math.atan2(nx, nz) + Math.PI, () => {
        b.box(wall, len, 0.8, 0.35, 0, 0, 0);
        const np = Math.max(2, Math.floor(len / 2.2));
        for (let i = 0; i <= np; i++) b.box(dress, 0.3, 2.3, 0.3, -len / 2 + (i * len) / np, 0, 0);
        // pentice roof falling to the garth
        leanTo(b, "tile", 0, len + 0.6, 0.25, 2.5, -alley - 0.1, 3.5);
      });
    }
  }
}

export function registerEcclesiastical(): void {
  if (!ORIG) ORIG = { church: BUILDERS.church, friary: BUILDERS.friary };
  BUILDERS.church = church;
  BUILDERS.friary = friary;
}
