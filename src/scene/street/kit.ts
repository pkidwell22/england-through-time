import * as THREE from "three";
import { Builder } from "../geom";
import { tileOf } from "../materials";
import { HOUSE_FX_OFF } from "./houseShader";

/**
 * Geometry kit for houses: boxes with real-scale UVs (wood grain along the member), framed walls with UVs in
 * bays and storeys, and facade fittings at two levels of detail: `rich` (near the camera: reveals, mullions,
 * shutters, hinges, mouldings) and plain (the district model: a few quads per opening).
 * Local frame for fittings: the wall plane is z = 0, outward +z, y up.
 */

export type Face = "px" | "nx" | "py" | "ny" | "pz" | "nz";
export const FACES: Face[] = ["px", "nx", "py", "ny", "pz", "nz"];
export const UP = new THREE.Vector3(0, 1, 0);
export const ALL_BUT_PZ: Face[] = ["px", "nx", "py", "ny", "nz"];
export const ONLY_PZ: Face[] = ["px", "nx", "py", "ny", "nz"];

/* ------------------------------------------------------------------ house shape field (fabric only) */

/**
 * While the fabric builds its instanced house models (`SHAPE.on`), every roof records its frame and every chimney
 * or smoke louvre its smoke source, and each house's parts get a per-vertex attribute `aRoof`:
 *   x = ridge-sag weight (0 at the eaves and the gable ends, 1 mid-ridge),
 *   y = height above the eaves of the roof the vertex belongs to (m, 0 below the eaves),
 *   z = soot weight (near a chimney top or a hall's smoke vent, fading down the roof).
 * The fabric's vertex shader scales these per instance (a sagging ridge, a steeper or flatter pitch), so houses
 * that share one model still differ, and all parts of one house move together. Off for everything else.
 */
export const SHAPE = { on: false, sinks: [] as ShapeSink[] };
export interface RoofRec { cx: number; cz: number; ax: number; az: number; half: number; hl: number; hs: number; halfSpan: number; y0: number; y1: number }
export interface ShapeSink { roofs: RoofRec[]; smoke: [number, number, number, number][] }

type BuilderInternals = { parts: Map<string, THREE.BufferGeometry[]>; stack: THREE.Matrix4[] };
const bi = (b: Builder) => b as unknown as BuilderInternals;

/** Record a roof (ridge along local x of `local`, wall plate at local y = 0, ridge at y = rise) into the open sink. */
export function recordRoof(b: Builder, local: THREE.Matrix4, l: number, w: number, rise: number, over: number, endOver: number): void {
  const sink = SHAPE.sinks[SHAPE.sinks.length - 1];
  if (!SHAPE.on || !sink) return;
  const st = bi(b).stack;
  const m = st[st.length - 1].clone().multiply(local);
  const o = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
  const a = new THREE.Vector3(1, 0, 0).transformDirection(m);
  sink.roofs.push({ cx: o.x, cz: o.z, ax: a.x, az: a.z, half: l / 2, hl: l / 2 + endOver, hs: w / 2 + over, halfSpan: w / 2, y0: o.y, y1: o.y + rise });
}

/** Record a smoke source (chimney top or smoke vent) at local (x, y, z) of the current frame, radius r. */
export function recordSmoke(b: Builder, x: number, y: number, z: number, r: number): void {
  const sink = SHAPE.sinks[SHAPE.sinks.length - 1];
  if (!SHAPE.on || !sink) return;
  const st = bi(b).stack;
  const p = new THREE.Vector3(x, y, z).applyMatrix4(st[st.length - 1]);
  sink.smoke.push([p.x, p.y, p.z, r]);
}

/** Number of parts per material so far (to find the parts added after this point). */
export function partSnapshot(b: Builder): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, l] of bi(b).parts) out.set(k, l.length);
  return out;
}

/** Parts added since a snapshot (all parts when `since` is null). */
export function partsSince(b: Builder, since: Map<string, number> | null): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const [k, l] of bi(b).parts) for (let i = since?.get(k) ?? 0; i < l.length; i++) out.push(l[i]);
  return out;
}

function roofAt(roofs: RoofRec[], x: number, y: number, z: number): [number, number] {
  let sag = 0, hgt = 0, best = -1;
  for (const R of roofs) {
    const dx = x - R.cx, dz = z - R.cz;
    const al = dx * R.ax + dz * R.az;
    const ac = -dx * R.az + dz * R.ax;
    if (Math.abs(al) > R.hl + 0.02 || Math.abs(ac) > R.hs + 0.05) continue;
    if (y < R.y0 - 0.3) continue;
    const ys = R.y0 + (R.y1 - R.y0) * (1 - Math.abs(ac) / R.halfSpan);
    if (y > ys + 0.6) continue;
    const h = Math.max(0, y - R.y0);
    const u = Math.min(1, Math.abs(al) / R.half);
    const s = (1 - u * u) * Math.min(1, h / Math.max(0.1, R.y1 - R.y0));
    if (R.y1 > best) { best = R.y1; sag = s; hgt = h; }
  }
  return [sag, hgt];
}

function sootAt(smoke: ShapeSink["smoke"], x: number, y: number, z: number): number {
  let s = 0;
  for (const [sx, sy, sz, r] of smoke) {
    const d = Math.hypot(x - sx, z - sz);
    if (d > r || y < sy - 4) continue;
    const k = (1 - d / r) * Math.min(1, Math.max(0, (y - (sy - 2.6)) / 2.6));
    s = Math.max(s, k);
  }
  return s;
}

/**
 * Give parts their `aRoof` attribute from the roofs and smoke sources of their own house. Parts flagged
 * `userData.rigid` (chimney stacks) move as one piece: the field is read once, at the roof surface under them.
 */
export function shapeParts(geos: THREE.BufferGeometry[], sink: ShapeSink): void {
  for (const g of geos) {
    if (g.getAttribute("aRoof")) continue;
    const p = g.attributes.position;
    const a = new Float32Array(p.count * 3);
    if (g.userData.rigid) {
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
      let top = bb.min.y;
      for (const R of sink.roofs) {
        const dx = cx - R.cx, dz = cz - R.cz;
        if (Math.abs(dx * R.ax + dz * R.az) <= R.hl && Math.abs(-dx * R.az + dz * R.ax) <= R.hs) {
          const ys = R.y0 + (R.y1 - R.y0) * (1 - Math.min(1, Math.abs(-dx * R.az + dz * R.ax) / R.halfSpan));
          top = Math.max(top, Math.min(ys, bb.max.y));
        }
      }
      const [sg, h] = roofAt(sink.roofs, cx, top, cz);
      for (let i = 0; i < p.count; i++) {
        a[i * 3] = sg;
        a[i * 3 + 1] = h;
        a[i * 3 + 2] = sootAt(sink.smoke, p.getX(i), p.getY(i), p.getZ(i));
      }
    } else {
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const [sg, h] = roofAt(sink.roofs, x, y, z);
        a[i * 3] = sg;
        a[i * 3 + 1] = h;
        a[i * 3 + 2] = sootAt(sink.smoke, x, y, z);
      }
    }
    g.setAttribute("aRoof", new THREE.BufferAttribute(a, 3));
  }
}

/** Run fn as one house: its parts get the shape field of its own roofs and smoke sources (no-op unless SHAPE.on). */
export function shapedHouse<T>(b: Builder, fn: () => T): T {
  if (!SHAPE.on) return fn();
  const snap = partSnapshot(b);
  SHAPE.sinks.push({ roofs: [], smoke: [] });
  const out = fn();
  const sink = SHAPE.sinks.pop()!;
  shapeParts(partsSince(b, snap), sink);
  return out;
}

/** Run fn and flag the parts it adds as rigid (they translate with the roof instead of bending with it). */
export function rigidParts(b: Builder, fn: () => void): void {
  if (!SHAPE.on) return fn();
  const snap = partSnapshot(b);
  fn();
  for (const g of partsSince(b, snap)) g.userData.rigid = true;
}

/**
 * UV rectangle for an opening's light in the fabric: u, v run 0..1 across the light, offset by 1000 + 4 x its size
 * in 2 cm steps, so the fabric shader can recover both the position in the opening (for the room behind it) and
 * the light's size (for the glass texture at its real scale). Plain metre UVs (no rectangle) elsewhere.
 */
export function openingUv(w: number, h: number): [number, number, number, number] | undefined {
  if (!SHAPE.on) return undefined;
  const kx = 1000 + 4 * Math.max(1, Math.round(w / 0.02)), ky = 1000 + 4 * Math.max(1, Math.round(h / 0.02));
  return [kx, ky, kx + 1, ky + 1];
}

/** Materials whose texture grain should run along the longer side of every face. */
const GRAIN = new Set(["oak", "timber", "timber-weathered", "planks"]);

/** Box geometry without the faces named in `skip`, UVs at real scale. */
export function boxGeo(mat: string, w: number, h: number, d: number, skip: Face[]): THREE.BufferGeometry {
  const src = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const sp = src.attributes.position, su = src.attributes.uv, sn = src.attributes.normal;
  const t = tileOf(mat);
  const grain = GRAIN.has(mat);
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (let f = 0; f < 6; f++) {
    if (skip.includes(FACES[f])) continue;
    const swap = grain && dims[f][0] > dims[f][1];
    for (let v = 0; v < 6; v++) {
      const i = f * 6 + v;
      pos.push(sp.getX(i), sp.getY(i), sp.getZ(i));
      nor.push(sn.getX(i), sn.getY(i), sn.getZ(i));
      if (swap) uv.push((su.getY(i) * dims[f][1]) / t, (su.getX(i) * dims[f][0]) / t);
      else uv.push((su.getX(i) * dims[f][0]) / t, (su.getY(i) * dims[f][1]) / t);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  src.dispose();
  return g;
}

/** Box centred on (x, z) with its base at y; hidden faces left out (bottom by default). */
export function solid(b: Builder, mat: string, w: number, h: number, d: number, x = 0, y = 0, z = 0, rotY = 0, skip: Face[] = ["ny"]): void {
  if (w <= 0 || h <= 0 || d <= 0) return;
  b.add(mat, boxGeo(mat, w, h, d, skip), new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y + h / 2, z));
}

/** A rectangular bar between two points: length along the line, `t` thick, `d` deep. */
export function bar(b: Builder, mat: string, a: [number, number, number], c: [number, number, number], t: number, d: number, skip: Face[] = ["ny"]): void {
  const dir = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const len = dir.length();
  if (len < 0.01) return;
  dir.normalize();
  const zA = new THREE.Vector3().crossVectors(dir, UP);
  if (zA.lengthSq() < 1e-6) zA.set(0, 0, 1);
  zA.normalize();
  const yA = new THREE.Vector3().crossVectors(zA, dir);
  const m = new THREE.Matrix4().makeBasis(dir, yA, zA).setPosition((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
  b.add(mat, boxGeo(mat, len, t, d, [...skip, "px", "nx"]), m);
}

/** A flat panel facing +z with its base at y (2 triangles). Optional explicit UV rectangle. */
export function quad(b: Builder, mat: string, w: number, h: number, x: number, y: number, z: number, rotY = 0, uvRect?: [number, number, number, number]): void {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  if (uvRect) {
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uvRect[0] + uv.getX(i) * (uvRect[2] - uvRect[0]), uvRect[1] + uv.getY(i) * (uvRect[3] - uvRect[1]));
  } else {
    const t = tileOf(mat);
    const swap = GRAIN.has(mat) && w > h;
    for (let i = 0; i < uv.count; i++) {
      const u = (uv.getX(i) * w) / t, v = (uv.getY(i) * h) / t;
      if (swap) uv.setXY(i, (uv.getY(i) * h) / t, (uv.getX(i) * w) / t);
      else uv.setXY(i, u, v);
    }
  }
  b.add(mat, g, new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y + h / 2, z));
}

/** Local frame helper: draws with +z as the wall's outward direction, at (x, z) rotated by rot. */
export function on(b: Builder, x: number, z: number, rot: number, fn: () => void): void {
  b.at(x, 0, z, rot, fn);
}

/** Number of framing bays for a wall of length len (bays of about 2.9 m). */
export function bays(len: number): number {
  return Math.max(1, Math.round(len / 2.9));
}

/**
 * Walls of one storey as four faces (no top or bottom) with UVs in bays (u) and storeys (v), for the
 * "fwall-*" timber-frame materials; any other material gets real-scale UVs.
 */
export function storeyWalls(b: Builder, mat: string, w: number, h: number, d: number, x: number, y0: number, z: number, skip: Face[] = []): void {
  if (!mat.startsWith("fwall-")) {
    solid(b, mat, w, h, d, x, y0, z, 0, ["ny", "py", ...skip]);
    return;
  }
  const pos: number[] = [], uv: number[] = [];
  const face = (ax: number, az: number, bx: number, bz: number, len: number) => {
    const nb = bays(len);
    // a -> b along the face, seen from outside (counter-clockwise)
    pos.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, 0, az, bx, h, bz, ax, h, az);
    uv.push(0, 0, nb, 0, nb, 1, 0, 0, nb, 1, 0, 1);
  };
  const hw = w / 2, hd = d / 2;
  if (!skip.includes("pz")) face(-hw, hd, hw, hd, w);
  if (!skip.includes("nz")) face(hw, -hd, -hw, -hd, w);
  if (!skip.includes("px")) face(hw, hd, hw, -hd, d);
  if (!skip.includes("nx")) face(-hw, -hd, -hw, hd, d);
  if (!pos.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  b.add(mat, g, new THREE.Matrix4().setPosition(x, y0, z));
}

/**
 * Gabled roof, ridge along local x; slopes in `roofMat` with real-scale UVs, the end triangles in `wallMat`
 * with UVs in bays and storeys for framed walls (so gables keep the storey scale) or real scale otherwise.
 * `ends` picks which gable triangles to draw: +x, -x. `endOver` is the overhang at the gable ends.
 */
export function gableRoof(
  b: Builder, roofMat: string, wallMat: string | null, l: number, w: number, rise: number,
  x: number, y: number, z: number, rotY: number, over: number, storeyH: number, ends: [boolean, boolean] = [true, true], endOver = over,
  /** Segment length along the ridge (m): the slopes are cut into strips so a ridge can sag and an eave wander. */
  segLen = 1.6,
  /** false: no eaves edge strips (distant models). */
  full = true,
): void {
  const hl = l / 2 + endOver;
  const hw = w / 2 + over;
  const drop = (over * rise) / (w / 2);
  const slope = Math.hypot(hw, rise + drop);
  const t = tileOf(roofMat);
  const pos: number[] = [], uv: number[] = [];
  // ?houses=plain: one strip, as before the realism round (for like-for-like comparisons)
  const nSeg = HOUSE_FX_OFF ? 1 : Math.max(1, Math.min(8, Math.round((2 * hl) / segLen)));
  // a strip quad a-b-c-d split into nSeg pieces along x (a->b and d->c run along the ridge)
  const q = (a: number[], bb: number[], c: number[], d: number[], uw: number, vh: number) => {
    for (let i = 0; i < nSeg; i++) {
      const f0 = i / nSeg, f1 = (i + 1) / nSeg;
      const L = (p: number[], r: number[], f: number) => [p[0] + (r[0] - p[0]) * f, p[1] + (r[1] - p[1]) * f, p[2] + (r[2] - p[2]) * f];
      const a0 = L(a, bb, f0), b0 = L(a, bb, f1), c0 = L(d, c, f1), d0 = L(d, c, f0);
      pos.push(...a0, ...b0, ...c0, ...a0, ...c0, ...d0);
      uv.push(uw * f0, 0, uw * f1, 0, uw * f1, vh, uw * f0, 0, uw * f1, vh, uw * f0, vh);
    }
  };
  q([-hl, -drop, hw], [hl, -drop, hw], [hl, rise, 0], [-hl, rise, 0], (2 * hl) / t, slope / t);
  q([hl, -drop, -hw], [-hl, -drop, -hw], [-hl, rise, 0], [hl, rise, 0], (2 * hl) / t, slope / t);
  // underside (soffit) 6 cm below the covering, so the eaves have a visible thickness
  const th = 0.09;
  q([hl, -drop - th, hw], [-hl, -drop - th, hw], [-hl, rise - 0.2, 0], [hl, rise - 0.2, 0], (2 * hl) / t, slope / t);
  q([-hl, -drop - th, -hw], [hl, -drop - th, -hw], [hl, rise - 0.2, 0], [-hl, rise - 0.2, 0], (2 * hl) / t, slope / t);
  // eaves edge (the thickness of battens and tiles seen end-on)
  if (full) {
    q([-hl, -drop - th, hw], [hl, -drop - th, hw], [hl, -drop, hw], [-hl, -drop, hw], (2 * hl) / t, th / t);
    q([hl, -drop - th, -hw], [-hl, -drop - th, -hw], [-hl, -drop, -hw], [hl, -drop, -hw], (2 * hl) / t, th / t);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const local = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
  b.add(roofMat, g, local);
  recordRoof(b, local, l, w, rise, over, endOver);
  if (!wallMat) return;
  const framed = wallMat.startsWith("fwall-");
  const tw = tileOf(wallMat);
  const nb = bays(w);
  const p2: number[] = [], u2: number[] = [];
  [1, -1].forEach((s, i) => {
    if (!ends[i]) return;
    const ex = (s * l) / 2;
    const tri = s > 0 ? [[ex, 0, w / 2], [ex, 0, -w / 2], [ex, rise, 0]] : [[ex, 0, -w / 2], [ex, 0, w / 2], [ex, rise, 0]];
    for (const v of tri) {
      p2.push(v[0], v[1], v[2]);
      if (framed) u2.push(((s > 0 ? w / 2 - v[2] : v[2] + w / 2) / w) * nb, v[1] / storeyH);
      else u2.push((v[2] + w / 2) / tw, v[1] / tw);
    }
  });
  if (!p2.length) return;
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute("position", new THREE.Float32BufferAttribute(p2, 3));
  g2.setAttribute("uv", new THREE.Float32BufferAttribute(u2, 2));
  g2.computeVertexNormals();
  b.add(wallMat, g2, local);
}

/* ------------------------------------------------------------------ openings */

export type WinKind = "glass" | "open";

/**
 * A window on the wall plane, sill at y. Plain: a proud frame, the light, one mullion.
 * Rich: a frame box standing 16 cm proud so the light sits in a real reveal, moulded mullions at about
 * 0.4 m, a transom on tall lights, a projecting sill; glazed lights take leaded glass, unglazed ones a dark
 * opening with diagonal-set (diamond) mullions and plank shutters, one leaf often open.
 */
export function windowAt(b: Builder, x: number, y: number, w: number, h: number, kind: WinKind, rich: boolean, r: () => number, frame = "oak"): void {
  b.at(x, 0, 0, 0, () => {
    // in the fabric, unglazed openings show a room behind them (the "opening" material) and glass the same room
    const lightMat = kind === "glass" ? "glass-leaded" : SHAPE.on ? "opening" : "dark";
    const ouv = openingUv(w, h);
    if (!rich) {
      quad(b, frame, w + 0.2, h + 0.2, 0, y - 0.1, 0.06);
      quad(b, lightMat, w, h, 0, y, 0.075, 0, ouv);
      if (w > 0.8) quad(b, frame, 0.06, h, 0, y, 0.085);
      solid(b, frame, w + 0.3, 0.07, 0.16, 0, y - 0.15, 0.08, 0, ["ny", "nz", "px", "nx"]);
      return;
    }
    const D = 0.14, F = 0.075; // frame depth (proud of the wall) and face width
    // frame: head, sill, two jambs (outer + inner faces only)
    solid(b, frame, w + 2 * F, F, D, 0, y + h, D / 2, 0, ["nz"]);
    solid(b, frame, F, h, D, -w / 2 - F / 2, y, D / 2, 0, ["nz", "ny", "py"]);
    solid(b, frame, F, h, D, w / 2 + F / 2, y, D / 2, 0, ["nz", "ny", "py"]);
    // sill: deeper, projecting, slightly sloped by a drip block below
    solid(b, frame, w + 2 * F + 0.12, 0.09, D + 0.08, 0, y - 0.09, (D + 0.08) / 2, 0, ["nz"]);
    solid(b, frame, w + 2 * F, 0.05, 0.05, 0, y - 0.14, D + 0.02, 0, ["nz", "py"]);
    const nm = Math.max(0, Math.round(w / 0.42) - 1);
    if (kind === "glass") {
      quad(b, lightMat, w, h, 0, y, 0.04, 0, ouv);
      for (let i = 1; i <= nm; i++) solid(b, frame, 0.042, h, 0.07, -w / 2 + (i * w) / (nm + 1), y, 0.075, 0, ["nz", "ny", "py"]);
      if (h > 0.95) solid(b, frame, w, 0.045, 0.07, 0, y + h * 0.64, 0.075, 0, ["nz", "px", "nx"]);
    } else {
      quad(b, lightMat, w, h, 0, y, 0.02, 0, ouv);
      // diamond mullions (square bars set diagonally) in the opening
      const nd = Math.max(1, Math.round(w / 0.16) - 1);
      for (let i = 1; i <= nd; i++) {
        const mx = -w / 2 + (i * w) / (nd + 1);
        b.at(mx, 0, 0.08, Math.PI / 4, () => solid(b, frame, 0.05, h, 0.05, 0, y, 0, 0, ["ny", "py"]));
      }
      // plank shutters hinged on the jambs: one leaf open against the wall, the other closed or ajar
      const lw = w / 2;
      for (const s of [-1, 1]) {
        const open = s < 0 ? r() < 0.75 : r() < 0.35;
        const ang = open ? s * (Math.PI * 0.92) : s * 0.12;
        b.at(s * (w / 2 + F), 0, D + 0.02, -ang, () => solid(b, "planks", lw, h + 0.04, 0.035, -s * lw / 2, y - 0.02, 0.018, 0, ["ny"]));
      }
    }
  });
}

/**
 * A plank door in an oak frame, sill at `base`. Rich: frame standing proud with the leaf set back,
 * three wrought-iron strap hinges, a ring handle, a stone threshold step. Plain: frame, leaf, step.
 */
export function doorAt(b: Builder, x: number, w: number, h: number, base: number, step: boolean, rich: boolean, r: () => number): void {
  b.at(x, 0, 0, 0, () => {
    if (!rich) {
      quad(b, "oak", w + 0.28, h + 0.14, 0, base, 0.06);
      quad(b, "planks", w, h, 0, base, 0.075);
      if (step) solid(b, "rubble", w + 0.5, base + 0.12, 0.45, 0, -0.12, 0.25, 0, ["ny", "nz"]);
      return;
    }
    const D = 0.18, F = 0.14;
    solid(b, "oak", w + 2 * F, 0.18, D, 0, base + h, D / 2, 0, ["nz"]);
    for (const s of [-1, 1]) solid(b, "oak", F, h, D, s * (w / 2 + F / 2), base, D / 2, 0, ["nz", "ny", "py"]);
    // the leaf, set back 10 cm in the frame (dark gap behind it reads as the reveal)
    quad(b, "interior", w, h, 0, base, 0.01, 0, openingUv(w, h));
    const ajar = r() < 0.25;
    b.at(-w / 2, 0, 0.06, ajar ? 0.5 : 0, () => {
      solid(b, "planks", w, h - 0.02, 0.05, w / 2, base + 0.01, 0.025, 0, ["ny"]);
      for (const hy of [0.25, h * 0.5, h - 0.3]) solid(b, "iron", w * 0.72, 0.045, 0.012, w * 0.36, base + hy, 0.056, 0, ["ny", "nz"]);
      solid(b, "iron", 0.07, 0.07, 0.03, w * 0.82, base + h * 0.48, 0.065, 0, ["nz"]);
    });
    if (step) {
      solid(b, "rubble", w + 0.6, base + 0.1, 0.55, 0, -0.1, 0.27, 0, ["ny", "nz"]);
      solid(b, "ashlar", w + 0.3, 0.06, 0.3, 0, base, 0.15, 0, ["ny", "nz"]);
    }
  });
}

/** A hanging sign on a wrought-iron bracket, projecting from the wall at height y; emblem cell 0..7. */
export function signAt(b: Builder, x: number, y: number, cell: number): void {
  const out = 1.35;
  bar(b, "iron", [x, y, 0.02], [x, y, out], 0.05, 0.05, []);
  bar(b, "iron", [x, y - 0.55, 0.02], [x, y - 0.02, out * 0.7], 0.035, 0.035, []);
  for (const dz of [out * 0.45, out * 0.95]) solid(b, "iron", 0.02, 0.12, 0.02, x, y - 0.12, dz, 0, []);
  // the board, painted both sides (the atlas cell on +x and -x faces)
  const cu = (cell % 4) / 4, cv = 1 - (Math.floor(cell / 4) + 1) / 2;
  const bw = 0.74, bh = 0.56, bt = 0.05;
  b.at(x, 0, out * 0.7, Math.PI / 2, () => {
    quad(b, "sign", bw, bh, 0, y - 0.14 - bh, bt / 2, 0, [cu, cv, cu + 0.25, cv + 0.5]);
    quad(b, "sign", bw, bh, 0, y - 0.14 - bh, -bt / 2, Math.PI, [cu, cv, cu + 0.25, cv + 0.5]);
    solid(b, "oak", bw + 0.04, 0.04, bt + 0.01, 0, y - 0.14, 0, 0, ["pz", "nz"]);
    solid(b, "oak", bw + 0.04, 0.04, bt + 0.01, 0, y - 0.18 - bh, 0, 0, ["pz", "nz"]);
  });
}

/** Cellar flaps in the street in front of the wall: two plank leaves on a low stone kerb, at x. */
export function cellarAt(b: Builder, x: number, w = 1.2): void {
  solid(b, "rubble", w + 0.25, 0.32, 1.05, x, -0.2, 0.55, 0, ["ny"]);
  for (const s of [-1, 1]) b.at(x + (s * w) / 4, 0.12, 0.55, 0, () => bar(b, "planks", [0, 0.02, 0.48], [0, 0.18, -0.48], 0.04, w / 2 - 0.02, ["ny"]));
  solid(b, "iron", 0.04, 0.03, 0.9, x, 0.22, 0.55, 0, ["ny"]);
}

/** A pentice (pent roof) across the front at height y, projecting `out`, on brackets. */
export function penticeAt(b: Builder, w: number, y: number, out: number, roof: string): void {
  const t = tileOf(roof);
  const hw = w / 2;
  const y1 = y - out * 0.5;
  const pos = [-hw, y, 0, hw, y, 0, hw, y1, out, -hw, y, 0, hw, y1, out, -hw, y1, out];
  const slope = Math.hypot(out, y - y1);
  const uv = [0, slope / t, w / t, slope / t, w / t, 0, 0, slope / t, w / t, 0, 0, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  b.add(roof, g);
  solid(b, roof, w, 0.05, 0.05, 0, y1 - 0.05, out, 0, ["ny"]);
  const nbk = Math.max(2, Math.round(w / 2.2));
  for (let i = 0; i <= nbk; i++) {
    const bx = -hw + 0.1 + (i * (w - 0.2)) / nbk;
    bar(b, "oak", [bx, y - 0.65, 0.02], [bx, y1 - 0.02, out - 0.12], 0.08, 0.08, []);
  }
}
