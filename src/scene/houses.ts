import * as THREE from "three";
import { rng } from "@/lib/geo";
import { Builder } from "./geom";
import { HOUSE_FX_OFF } from "./street/houseShader";
import { tileOf } from "./materials";
import {
  ALL_BUT_PZ, SHAPE, bar, cellarAt, doorAt, gableRoof, on, openingUv, penticeAt, quad, recordRoof, recordSmoke, rigidParts, shapedHouse, signAt, solid,
  storeyWalls, windowAt, type WinKind,
} from "./street/kit";

/** Gabled roof for the simpler models (overview houses, Roman and Saxon buildings): slopes cut into strips along the ridge. */
function gab(b: Builder, roof: string, wall: string | null, l: number, w: number, rise: number, x: number, y: number, z: number, rotY: number, over: number, segLen = 3.2, full = false): void {
  gableRoof(b, roof, wall, l, w, rise, x, y, z, rotY, over, 3, [true, true], over, segLen, full);
}

/** Ridge cover along local x: a shallow tent of tiles or boards in strips, so it follows a sagging ridge. */
function ridgeStrip(b: Builder, mat: string, len: number, x: number, y: number, z: number, rotY: number, segLen = 1.6, hw = 0.17): void {
  const n = HOUSE_FX_OFF ? 1 : Math.max(1, Math.min(8, Math.round(len / segLen)));
  const t = tileOf(mat);
  const pos: number[] = [], uv: number[] = [];
  const prof: [number, number][] = [[-hw, -0.07], [0, 0.1], [hw, -0.07]];
  for (let i = 0; i < n; i++) {
    const x0 = -len / 2 + (i * len) / n, x1 = -len / 2 + ((i + 1) * len) / n;
    for (let k = 0; k < 2; k++) {
      const [z0, y0] = prof[k], [z1, y1] = prof[k + 1];
      const A = [x0, y0, z0], B = [x1, y0, z0], C = [x1, y1, z1], D = [x0, y1, z1];
      // wound so the outside faces up and out
      pos.push(...A, ...D, ...C, ...A, ...C, ...B);
      const v0 = k * 0.2, v1 = v0 + 0.2;
      uv.push(x0 / t, v0, x0 / t, v1, x1 / t, v1, x0 / t, v0, x1 / t, v1, x1 / t, v0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  b.add(mat, g, new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z));
}

/**
 * Generic building models for the procedurally placed urban fabric.
 * None of these represents a specific excavated or recorded building.
 *
 * Every style has two levels of detail. `detail` (the benchmark district) is a modelled
 * building: projecting window frames, doors, eaves, jetties with brackets, exposed framing.
 * The overview version is a few boxes and a roof, with a better silhouette than a plain prism.
 * Features are only used where the period allows: no chimneys on Roman, Saxon or early
 * medieval houses (smoke louvres and plain ridges there), glazing only on later houses.
 */

/* ------------------------------------------------------------------ helpers (geometry kit in street/kit.ts) */

/**
 * A window on the wall plane z = 0 of the current frame, sill at y.
 * "glass": leaded casement with mullions. "open": unglazed opening with timber bars (and shutters).
 * The frame stands proud of the wall, so it casts a shadow line and reads from an angle.
 */
function win(b: Builder, x: number, y: number, w: number, h: number, kind: "glass" | "open", frame = "timber", lite = false): void {
  const light = kind === "glass" ? "glass" : SHAPE.on ? "opening" : "dark";
  const ouv = kind === "glass" ? undefined : openingUv(w, h);
  b.at(x, 0, 0, 0, () => {
    if (lite) {
      quad(b, frame, w + 0.2, h + 0.2, 0, y - 0.1, 0.07);
      quad(b, light, w, h, 0, y, 0.085, 0, ouv);
      return;
    }
    quad(b, frame, w + 0.2, h + 0.2, 0, y - 0.1, 0.07);
    quad(b, light, w, h, 0, y, 0.085, 0, ouv);
    if (w > 0.8) quad(b, "timber", 0.05, h, 0, y, 0.1);
    if (kind === "glass" && h > 0.8 && w > 1.25) quad(b, "timber", w, 0.045, 0, y + h * 0.6, 0.1);
    solid(b, frame, w + 0.3, 0.06, 0.17, 0, y - 0.16, 0.085, 0, ["ny", "nz", "px", "nx", "py"]);
  });
}

/** Plank door in a timber surround on the wall plane; low stone step. */
function door(b: Builder, x: number, w: number, h: number, base: number, step = true): void {
  b.at(x, 0, 0, 0, () => {
    quad(b, "timber", w + 0.28, h + 0.14, 0, base, 0.09);
    quad(b, "dark", w, h, 0, base, 0.095);
    quad(b, "timber", w * 0.92, h * 0.97, 0, base, 0.11);
    if (step) solid(b, "ragstone", w + 0.5, base + 0.1, 0.5, 0, -0.1, 0.3, 0, ["ny", "nz"]);
  });
}

/** Ridge row of tiles or a thatch roll along the ridge. */
function ridgeCap(b: Builder, mat: string, len: number, x: number, y: number, z: number, rotY: number): void {
  ridgeStrip(b, mat, len, x, y + 0.02, z, rotY, 2.4);
}

/** A single-pitch roof (lean-to): high edge at z = z0 (the wall), falling to y1 at z = z0 - run (local -z). */
function leanRoof(b: Builder, mat: string, w: number, run: number, y0: number, y1: number, x: number, z0: number): void {
  const t = tileOf(mat);
  const hw = w / 2;
  const slope = Math.hypot(run, y0 - y1);
  const pos = [-hw, y0, z0, hw, y0, z0, hw, y1, z0 - run, -hw, y0, z0, hw, y1, z0 - run, -hw, y1, z0 - run];
  const uv = [0, 0, w / t, 0, w / t, slope / t, 0, 0, w / t, slope / t, 0, slope / t];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  b.add(mat, g, new THREE.Matrix4().setPosition(x, 0, 0));
}

/**
 * Thatched roof: a smooth lofted prism with a thick, rounded eave lip and a slightly uneven ridge.
 * Ridge along local x, wall tops at y = 0. `hip` 0 = gabled, 1 = hipped, 2 = half-hipped.
 * Gabled ends are closed with `endMat` (the gable wall) set inside a rim of thatch.
 */
function thatchRoof(
  b: Builder, mat: string, endMat: string | null, l: number, w: number, rise: number,
  x: number, y: number, z: number, rotY: number, seed: number, hip = 0, over = 0.45, endOver = 0.3,
): void {
  const r = rng(seed);
  const hw = w / 2 + over;
  const hl = l / 2 + endOver;
  const slope = rise / (w / 2);
  const drop = over * slope;
  const yl = (zz: number) => rise * (1 - Math.abs(zz) / (w / 2));
  const prof: [number, number][] = [];
  for (const f of [1, 0.55, 0.2]) prof.push([-f * hw, yl(f * hw) + (f > 0.99 ? -0.08 : 0.07)]);
  prof.push([0, rise + 0.1]);
  for (const f of [0.2, 0.55, 1]) prof.push([f * hw, yl(f * hw) + (f > 0.99 ? -0.08 : 0.07)]);
  const nTop = prof.length;
  prof.push([hw + 0.03, -drop - 0.24], [hw - 0.05, -drop - 0.4], [-hw + 0.05, -drop - 0.4], [-hw - 0.03, -drop - 0.24]);
  const M = prof.length;
  const k = hip === 1 ? 1 : hip === 2 ? 2.4 : 0;
  const xsSet = new Set<number>([-hl, hl, 0, -hl / 2, hl / 2]);
  if (k) {
    for (let i = 0; i < nTop; i++) {
      const xi = Math.max(0, hl - (prof[i][1] + drop) / (slope * k));
      xsSet.add(+xi.toFixed(3));
      xsSet.add(+(-xi).toFixed(3));
    }
  }
  const xs = [...xsSet].sort((a, c) => a - c).filter((v, i, a) => i === 0 || v - a[i - 1] > 0.06);
  const ph = [r() * 6, r() * 6, r() * 6];
  const wave = (xv: number) => Math.sin(xv * 0.8 + ph[0]) * 0.6 + Math.sin(xv * 2.1 + ph[1]) * 0.4;
  const eaveWave = (xv: number) => Math.sin(xv * 1.3 + ph[2]);
  const pos: number[] = [];
  const uvs: number[] = [];
  const arc: number[] = [0];
  for (let i = 1; i < M; i++) arc.push(arc[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
  const t = tileOf(mat);
  for (const xv of xs) {
    for (let i = 0; i < M; i++) {
      let yv = prof[i][1];
      if (i < nTop) {
        const ridgeness = Math.max(0, prof[i][1] / rise);
        yv += wave(xv) * 0.07 * ridgeness + eaveWave(xv) * 0.035 * (1 - ridgeness);
        if (k) yv = Math.min(yv, slope * k * (hl - Math.abs(xv)) - drop);
      }
      pos.push(xv, yv, prof[i][0]);
      uvs.push(xv / t, arc[i] / t);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < xs.length - 1; j++)
    for (let i = 0; i < M; i++) {
      const ni = (i + 1) % M;
      const a = j * M + i, c = j * M + ni, d = (j + 1) * M + i, e = (j + 1) * M + ni;
      idx.push(a, c, d, c, e, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const local = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
  b.add(mat, g, local);
  recordRoof(b, local, l, w, rise, over, endOver);
  // end faces: closed fan of the profile
  const caps: number[] = [];
  const capUv: number[] = [];
  for (const j of [0, xs.length - 1]) {
    const o = j * M * 3;
    for (let i = 1; i < M - 1; i++) {
      for (const q of [0, i, i + 1]) {
        caps.push(pos[o + q * 3], pos[o + q * 3 + 1], pos[o + q * 3 + 2]);
        capUv.push(pos[o + q * 3 + 2] / t, pos[o + q * 3 + 1] / t);
      }
    }
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute("position", new THREE.Float32BufferAttribute(caps, 3));
  cg.setAttribute("uv", new THREE.Float32BufferAttribute(capUv, 2));
  cg.computeVertexNormals();
  b.add(mat, cg, local);
  if (!k && endMat) {
    const te = tileOf(endMat);
    const p2: number[] = [];
    const u2: number[] = [];
    for (const s of [1, -1]) {
      const ex = s * (hl + 0.02);
      const tri = s > 0 ? [[ex, 0, w / 2], [ex, 0, -w / 2], [ex, rise, 0]] : [[ex, 0, -w / 2], [ex, 0, w / 2], [ex, rise, 0]];
      for (const v of tri) {
        p2.push(v[0], v[1], v[2]);
        u2.push((v[2] + w / 2) / te, v[1] / te);
      }
    }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute("position", new THREE.Float32BufferAttribute(p2, 3));
    g2.setAttribute("uv", new THREE.Float32BufferAttribute(u2, 2));
    g2.computeVertexNormals();
    b.add(endMat, g2, local);
  }
}

/** A conical thatch with a thick rounded eave (lathe), apex at y + h. */
function thatchCone(b: Builder, mat: string, rad: number, h: number, x: number, y: number, z: number, sides: number): void {
  const pts = [
    new THREE.Vector2(rad - 0.08, -0.55), new THREE.Vector2(rad + 0.06, -0.38), new THREE.Vector2(rad + 0.04, -0.12),
    new THREE.Vector2(rad * 0.68, h * 0.4), new THREE.Vector2(rad * 0.34, h * 0.74), new THREE.Vector2(0.28, h * 0.96),
    new THREE.Vector2(0.02, h + 0.14),
  ];
  const g = new THREE.LatheGeometry(pts, sides);
  const t = tileOf(mat);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const circ = 2 * Math.PI * rad;
  const len = Math.hypot(rad, h) + 0.9;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * circ) / t, (uv.getY(i) * len) / t);
  b.add(mat, g, new THREE.Matrix4().setPosition(x, y, z));
}

/** Brick stack with corbelled cap and `shafts` chimney pots, standing on y0, rising to y1. Brick houses only. */
function stack(b: Builder, x: number, y0: number, y1: number, z: number, bw: number, bd: number, shafts: number, shaftH = 0.85): void {
  rigidParts(b, () => {
    solid(b, "brick-tudor", bw, y1 - y0, bd, x, y0, z, 0, ["ny", "py"]);
    solid(b, "brick-tudor", bw + 0.16, 0.14, bd + 0.16, x, y1 - 0.14, z, 0, ["ny", "py"]);
    const sw = shafts === 1 ? bw * 0.62 : bw * (shafts > 2 ? 0.26 : 0.36);
    const pitchX = shafts > 2 ? bw * 0.33 : bw * 0.46;
    for (let i = 0; i < shafts; i++) {
      const sx = x + (shafts === 1 ? 0 : (i - (shafts - 1) / 2) * pitchX);
      solid(b, "brick-tudor", sw, shaftH, bd * 0.6, sx, y1, z, 0, ["ny"]);
      // a thin oversailing course at the top of each shaft
      solid(b, "brick-tudor", sw + 0.08, 0.08, bd * 0.6 + 0.08, sx, y1 + shaftH - 0.08, z, 0, ["ny"]);
    }
  });
  recordSmoke(b, x, y1 + shaftH, z, 2.4);
}

/** A boarded smoke louvre on the ridge of a chimneyless hall (open hearth below), with its own small roof. */
function louvre(b: Builder, x: number, y: number, z: number, rotY: number, roof: string): void {
  const sink = SHAPE.sinks[SHAPE.sinks.length - 1];
  const nRoofs = sink?.roofs.length ?? 0;
  rigidParts(b, () => {
    b.at(x, y, z, rotY, () => {
      solid(b, "timber-weathered", 0.9, 0.75, 0.75, 0, -0.25, 0, 0, ["ny"]);
      for (const s of [-1, 1]) on(b, 0, s * 0.38, s > 0 ? 0 : Math.PI, () => { for (let i = 0; i < 3; i++) quad(b, "dark", 0.7, 0.07, 0, 0.05 + i * 0.15, 0.005); });
      gableRoof(b, roof, "timber-weathered", 1.1, 0.75, 0.45, 0, 0.5, 0, 0, 0.14, 1, [true, true], 0.1, 4, false);
    });
  });
  if (sink) sink.roofs.length = nRoofs; // the louvre's own little roof is not a roof of the house
  recordSmoke(b, x, y + 0.8, z, 3.2);
}

/* ------------------------------------------------------------------ the timber-framed town house */

export interface HouseOpts {
  /** Frontage along local x, depth along local z, metres. */
  w: number;
  d: number;
  storeys: number;
  storeyH?: number;
  wall: string;
  roof: string;
  /** Roof rise as a fraction of half the span. */
  pitch: number;
  /** Jetty overhang per storey (m). */
  jetty?: number;
  /** Gable faces the street (+z) instead of the eaves. */
  gableFront?: boolean;
  chimney?: boolean;
  detail?: boolean;
  seed: number;
  /** Two gables side by side across the front. */
  gables?: number;
  /** Half-hipped thatch ends. */
  hip?: boolean;
  dormers?: number;
  /** Projecting oriel bays on the first upper storey. */
  oriels?: number;
  /** Shop front with stall board on the ground floor. */
  shop?: boolean;
  rear?: "lean" | "range";
  /** Leaded glass (later houses) instead of open shuttered openings. */
  glazed?: boolean;
  /** Which side walls stand free: [left, right]. */
  sides?: [boolean, boolean];
  /** Door on the left (-1) or right (+1). */
  doorSide?: number;
  stacks?: number;
  /** Near-camera model (implies detail): reveals, mullions, shutters, hinges, mouldings, signs. */
  rich?: boolean;
  /** Upper storeys also jetty out sideways (free-standing houses; default true). Row houses: false. */
  sideJetty?: boolean;
  /** Roof overhang at the gable ends of an eaves-front roof (defaults to the eaves overhang). */
  endOver?: number;
  /** Hanging sign with emblem cell 0..7 (rich model only). */
  sign?: number;
  /** Cellar flaps in front of the house (rich model only). */
  cellar?: boolean;
  /** Pent roof across the ground storey (rich model only). */
  pentice?: boolean;
  /** Framing pattern for timber-framed walls (see street/frameTex.ts); defaults by wall name. */
  design?: string;
  /** Chimneyless tiled hall: a smoke louvre on the ridge. */
  louvre?: boolean;
  /** Chimney shafts per stack (default 2), stack height above the ridge (m, default 1.05), set-back of a gable-front stack (fraction of depth). */
  shafts?: number;
  stackH?: number;
  stackBack?: number;
}

/** Framing pattern per timber-frame wall name, so neighbouring houses differ. */
const DESIGN_OF: Record<string, string> = { frame: "square", "frame-ochre": "close", "frame-grey": "small", "frame-rose": "rail", "frame-dark": "brace" };

interface WallKit { infill: string; ground: string; framed: boolean; brick: boolean }
function wallKit(name: string, design?: string): WallKit {
  if (name.startsWith("frame")) {
    const d = design ?? DESIGN_OF[name] ?? "square";
    // ground storeys of close-studded houses usually carry a middle rail
    return { infill: `fwall-${d}`, ground: `fwall-${d === "close" ? "rail" : d}`, framed: true, brick: false };
  }
  if (name === "brick") return { infill: "brick-tudor", ground: "brick-tudor", framed: false, brick: true };
  return { infill: name, ground: name, framed: false, brick: name === "ragstone" || name === "caen" };
}

/** Overview version: a few boxes and a roof with overhang, jetty step, chimney. Under about 120 triangles. */
function houseLow(b: Builder, o: HouseOpts): number {
  const sh = o.storeyH ?? 2.7;
  const jet = o.jetty ?? 0;
  let y = 0;
  let w = o.w;
  let d = o.d;
  const r = rng(o.seed);
  // storeys below the top one share a single box; only the jettied top storey steps out
  const lowN = Math.max(1, o.storeys - 1);
  solid(b, o.wall, w, sh * lowN + 1.4, d, 0, -1.4, 0, 0, ["ny", "py"]);
  y = sh * lowN;
  if (o.storeys > 1) {
    if (o.sideJetty !== false) w += jet * 0.3 * (o.storeys - 1);
    d += jet * (o.storeys - 1);
    solid(b, o.wall, w, sh, d, 0, y, (jet * (o.storeys - 1)) / 2, 0, ["py"]);
    y += sh;
  }
  const zOff = ((o.storeys - 1) * jet) / 2;
  const thatch = o.roof.startsWith("thatch");
  if (o.gableFront) {
    const rise = (w / 2) * o.pitch;
    if (o.gables === 2) {
      for (const sx of [-1, 1]) gab(b, o.roof, o.wall, d, w / 2, rise * 0.5, (sx * w) / 4, y, zOff, Math.PI / 2, 0.35, 5);
      y += rise / 2;
    } else {
      gab(b, o.roof, o.wall, d, w, rise, 0, y, zOff, Math.PI / 2, thatch ? 0.5 : 0.35, 5);
      y += rise;
    }
  } else {
    const rise = (d / 2) * o.pitch;
    gab(b, o.roof, o.wall, w, d, rise, 0, y, zOff, 0, thatch ? 0.5 : 0.35, 5);
    y += rise;
  }
  if (o.chimney) {
    const cx = (r() - 0.5) * w * 0.5;
    rigidParts(b, () => solid(b, "brick-tudor", 0.9, y + 1.0 - sh * 0.6 - 0.5, 0.9, cx, sh * 0.6 + 0.5, -d * 0.2, 0, ["ny", "py"]));
    recordSmoke(b, cx, y + 1.0, -d * 0.2, 2.4);
  } else recordSmoke(b, 0, y + 0.3, zOff, 3); // open hearth: smoke out through a vent near the ridge
  return y;
}

/** Wall plane z = 0 of the current frame: plates, posts, bressummer, windows, door/shop. */
interface Fa {
  w: number; y0: number; y1: number;
  first: boolean; last: boolean; jet: boolean;
  framed: boolean; glass: boolean; rich: boolean;
  roofMat: string; wins: number; door?: number; shop?: number; oriel?: number; lite?: boolean;
}
function facade(b: Builder, f: Fa, r: () => number): void {
  const h = f.y1 - f.y0;
  const w = f.w;
  if (f.lite) {
    // back and side walls: corner posts and a few plain openings
    if (f.framed) for (const s of [-1, 1]) solid(b, "oak", 0.2, h, 0.05, s * (w / 2 - 0.1), f.y0, 0.025, 0, ALL_BUT_PZ);
    const sl = f.y0 + (f.first ? 0.95 : 0.8);
    const ww2 = Math.min(1.1, Math.max(0.6, w * 0.15));
    const nl = Math.max(1, Math.min(f.wins, Math.floor((w - 0.8) / 2.2)));
    const lh = Math.min(0.95, h - (sl - f.y0) - 0.45);
    for (let i = 0; i < nl; i++) {
      const cx = -w / 2 + ((i + 0.5) * w) / nl;
      quad(b, "oak", ww2 + 0.16, lh + 0.16, cx, sl - 0.08, 0.05);
      quad(b, f.glass ? "glass-leaded" : "planks", ww2, lh, cx, sl, 0.06, 0, f.glass ? openingUv(ww2, lh) : undefined); // unglazed: shutters closed
    }
    if (f.door !== undefined) doorAt(b, f.door, 0.9, 1.95, f.y0 + 0.02, false, false, r);
    return;
  }
  const rich = f.rich;
  // bressummer under a jettied storey (moulded on the rich model), else a plain girding beam
  if (!f.first) {
    if (rich && f.jet) {
      solid(b, "oak", w + 0.06, 0.24, 0.16, 0, f.y0 - 0.02, 0.07, 0, ["nz", "px", "nx", "py"]);
      solid(b, "oak", w + 0.08, 0.05, 0.06, 0, f.y0 + 0.18, 0.17, 0, ["nz", "px", "nx"]);
      solid(b, "oak", w + 0.08, 0.04, 0.05, 0, f.y0 - 0.04, 0.16, 0, ["nz", "px", "nx", "py"]);
    } else solid(b, "oak", w + 0.06, f.jet ? 0.24 : 0.18, 0.1, 0, f.y0 - (f.jet ? 0.02 : 0), 0.05, 0, ["nz", "px", "nx", "py"]);
  }
  // corner posts stand proud of the panels
  if (f.framed) for (const s of [-1, 1]) solid(b, "oak", 0.22, h - (f.first ? 0 : 0.22), 0.07, s * (w / 2 - 0.11), f.y0 + (f.first ? 0 : 0.22), 0.035, 0, ALL_BUT_PZ);
  const kind: WinKind = f.glass ? "glass" : "open";
  const sill = f.y0 + (f.first ? 0.95 : 0.8);
  const wh = Math.min(1.1, h - (sill - f.y0) - 0.42);
  let x0 = -w / 2 + 0.35;
  let x1 = w / 2 - 0.35;
  if (f.first && f.door !== undefined) {
    doorAt(b, f.door, 0.92, 2.0, f.y0 + 0.02, true, rich, r);
    if (f.door < 0) x0 = f.door + 0.85; else x1 = f.door - 0.85;
  }
  if (f.first && f.shop) {
    const sw = Math.min(f.shop, x1 - x0);
    const cx = f.door !== undefined && f.door < 0 ? x1 - sw / 2 : x0 + sw / 2;
    // shop front: a wide opening under a heavy head beam; the lower shutter lets down onto legs as a stall
    // board, the upper one is propped up as a hood
    quad(b, "interior", sw, 1.55, cx, f.y0 + 0.78, rich ? 0.02 : 0.06, 0, openingUv(sw, 1.55));
    for (const s of [-1, 1]) solid(b, "oak", 0.18, 2.35, 0.16, cx + (s * (sw + 0.18)) / 2, f.y0, 0.08, 0, ALL_BUT_PZ);
    solid(b, "oak", sw + 0.4, 0.22, 0.18, cx, f.y0 + 2.33, 0.09, 0, ["ny", "nz", "px", "nx"]);
    if (rich) {
      solid(b, "planks", sw, 0.78, 0.05, cx, f.y0, 0.04, 0, ["ny", "nz"]); // fixed stall riser under the opening
      solid(b, "planks", sw - 0.04, 0.05, 0.72, cx, f.y0 + 0.78, 0.42, 0, ["nz"]);
      for (const s of [-1, 1]) solid(b, "oak", 0.06, 0.78, 0.06, cx + s * (sw / 2 - 0.2), f.y0, 0.72, 0, ["ny"]);
      bar(b, "planks", [cx, f.y0 + 2.3, 0.1], [cx, f.y0 + 2.62, 0.86], 0.04, sw - 0.04, ["ny"]);
      for (const s of [-1, 1]) bar(b, "iron", [cx + s * (sw / 2 - 0.15), f.y0 + 1.9, 0.08], [cx + s * (sw / 2 - 0.15), f.y0 + 2.58, 0.8], 0.025, 0.025, []);
      // a few goods on the board: baskets and a covered tub
      const ng = 1 + Math.floor(r() * 2);
      for (let i = 0; i < ng; i++) b.cyl("thatch-old", 0.24 + r() * 0.06, 0.17, 0.1 + r() * 0.05, 8, cx - sw / 2 + 0.45 + i * 0.7 + r() * 0.3, f.y0 + 0.83, 0.42 + r() * 0.15, 0, true);
    } else {
      solid(b, "oak", sw, 0.06, 0.7, cx, f.y0 + 0.95, 0.4, 0, ["ny", "nz", "px", "nx"]);
      quad(b, "planks", sw, 0.8, cx, f.y0, 0.1);
      bar(b, "planks", [cx, f.y0 + 2.2, 0.1], [cx, f.y0 + 2.5, 0.9], 0.05, sw, ["ny"]);
    }
    if (f.door !== undefined) {
      if (f.door < 0) x1 = cx - sw / 2 - 0.25; else x0 = cx + sw / 2 + 0.25;
    } else return;
  }
  const avail = x1 - x0;
  if (avail < 0.9) return;
  const n = Math.max(1, Math.min(f.wins, Math.floor(avail / 1.35)));
  for (let i = 0; i < n; i++) {
    const cx = x0 + ((i + 0.5) * avail) / n;
    const ww = Math.max(0.62, Math.min(1.5, (avail / n) * 0.55)) * (0.92 + r() * 0.16);
    if (f.oriel !== undefined && Math.abs(cx - f.oriel) < avail / n / 2 + 0.01) {
      // oriel bay on brackets
      const ow = Math.min(avail / n - 0.3, 2.0);
      const oh = wh + 0.35;
      const od = 0.6;
      solid(b, "oak", ow, 0.16, od, cx, sill - 0.3, od / 2, 0, ["nz"]);
      for (const s of [-1, 1]) solid(b, "oak", 0.12, oh - 0.15, 0.12, cx + s * (ow / 2 - 0.06), sill - 0.14, od - 0.06, 0, ["nz", "ny"]);
      quad(b, f.glass ? "glass-leaded" : "dark", ow - 0.24, oh - 0.32, cx, sill, od - 0.01);
      for (const s of [-1, 1]) solid(b, f.glass ? "glass-leaded" : "dark", 0.01, oh - 0.32, od - 0.12, cx + s * (ow / 2 - 0.01), sill, od / 2 - 0.03, 0, ["ny", "py", "pz", "nz", s > 0 ? "nx" : "px"]);
      if (rich) for (let k = 1; k < 4; k++) solid(b, "oak", 0.06, oh - 0.32, 0.06, cx - (ow - 0.24) / 2 + (k * (ow - 0.24)) / 4, sill, od - 0.01, 0, ["nz", "ny", "py"]);
      solid(b, f.roofMat, ow + 0.3, 0.08, od + 0.25, cx, sill - 0.15 + oh, (od + 0.25) / 2, 0, ["ny"]);
      for (const s of [-1, 1]) bar(b, "oak", [cx + s * (ow / 2 - 0.15), sill - 0.95, 0.02], [cx + s * (ow / 2 - 0.15), sill - 0.3, od - 0.08], 0.1, 0.1, []);
      continue;
    }
    windowAt(b, cx, sill, ww, wh, kind, rich, r);
  }
}

/** Half-round ridge tiles (rich model) or a plain ridge board, along local x. */
function ridgeRoll(b: Builder, mat: string, len: number, x: number, y: number, z: number, rotY: number, rich: boolean, segL = 1.6): void {
  if (!rich) {
    ridgeStrip(b, mat, len, x, y, z, rotY, segL);
    return;
  }
  const g = new THREE.CylinderGeometry(0.15, 0.15, len, 5, HOUSE_FX_OFF ? 1 : Math.max(1, Math.min(8, Math.round(len / segL))), true, Math.PI / 2, Math.PI);
  g.rotateZ(Math.PI / 2);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const t = tileOf(mat);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getY(i) * len) / t, (uv.getX(i) * 0.47) / t);
  b.add(mat, g, new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y - 0.04, z));
}

/** The detailed house: base at y = 0 (a stone plinth reaches 1.3 m below), centred on the origin, street side +z. */
export function house(b: Builder, o: HouseOpts): number {
  return shapedHouse(b, () => houseParts(b, o));
}

function houseParts(b: Builder, o: HouseOpts): number {
  if (!o.detail && !o.rich) return houseLow(b, o);
  const rich = !!o.rich;
  const r = rng(o.seed);
  const kit = wallKit(o.wall, o.design);
  const sh = o.storeyH ?? 2.7;
  const jet = o.jetty ?? 0;
  const n = o.storeys;
  const PL = 0.3;
  // glazing: leaded glass only on the larger later houses (stack and three storeys) unless the caller says
  const glass = o.glazed ?? (!!o.chimney && n >= 3);
  const thatch = o.roof.startsWith("thatch");
  const sides = o.sides ?? [true, true];
  const sideJ = o.sideJetty !== false;
  const doorX = (o.doorSide ?? (r() < 0.5 ? -1 : 1)) * (o.w / 2 - 0.95);
  interface Lv { y0: number; y1: number; w: number; zf: number; zb: number; zc: number; d: number }
  const lv: Lv[] = [];
  let y = PL;
  for (let s = 0; s < n; s++) {
    const h = sh * (s === 0 ? 1.05 : s === n - 1 && n > 2 ? 0.9 : 0.97);
    const zf = o.d / 2 + s * jet;
    const zb = -o.d / 2;
    lv.push({ y0: y, y1: y + h, w: o.w + (sideJ ? s * jet * 0.3 : 0), zf, zb, zc: (zf + zb) / 2, d: zf - zb });
    y += h;
  }
  const top = lv[n - 1];
  // plinth (rubble footing showing above the street) and, on framed houses, the oak sill beam on it
  solid(b, "rubble", o.w + 0.1, PL + 1.3, o.d + 0.1, 0, -1.3, 0, 0, ["ny"]);
  if (kit.framed) solid(b, "oak", o.w + 0.04, 0.2, 0.2, 0, PL - 0.04, o.d / 2 - 0.06, 0, ["ny", "nz"]);
  lv.forEach((L, s) => {
    storeyWalls(b, s === 0 ? kit.ground : kit.infill, L.w, L.y1 - L.y0, L.d, 0, L.y0, L.zc);
    if (s > 0 && jet > 0) {
      // underside of the jetty: boarded floor between the joist ends
      const prev = lv[s - 1];
      solid(b, "planks", L.w, 0.03, L.zf - prev.zf, 0, L.y0 - 0.03, (prev.zf + L.zf) / 2, 0, ["py", "pz", "nz", "px", "nx"]);
    }
  });
  // elevations
  lv.forEach((L, s) => {
    const fa: Fa = {
      w: L.w, y0: L.y0, y1: L.y1, first: s === 0, last: s === n - 1, jet: jet > 0 && s > 0, framed: kit.framed,
      glass: glass && !(s === 0 && o.shop), rich, roofMat: thatch ? "tile" : o.roof,
      wins: Math.max(1, Math.round(L.w / 2.3)),
      door: s === 0 ? doorX : undefined, shop: s === 0 && o.shop ? Math.max(2.2, L.w - 2.3) : undefined,
      oriel: s === 1 && (o.oriels ?? 0) > 0 ? (doorX > 0 ? -1 : 1) * (L.w / 2 - 1.4) : undefined,
    };
    on(b, 0, L.zf, 0, () => facade(b, fa, r));
    on(b, 0, L.zb, Math.PI, () => facade(b, { ...fa, glass, rich: false, door: s === 0 ? -doorX * 0.6 : undefined, shop: undefined, oriel: undefined, wins: Math.max(1, fa.wins - 1), lite: true }, r));
    for (const sd of [-1, 1]) {
      if (!sides[sd < 0 ? 0 : 1]) continue;
      on(b, (sd * L.w) / 2, L.zc, (sd * Math.PI) / 2, () =>
        facade(b, { ...fa, glass, rich: false, w: L.d, door: undefined, shop: undefined, oriel: undefined, wins: 1, lite: true }, r));
    }
    // jetty: bressummer carried on the joist ends, with curved brackets at the posts
    if (jet > 0 && s > 0) {
      const prev = lv[s - 1];
      for (const px of [-L.w / 2 + 0.12, L.w / 2 - 0.12, ...(L.w > 5.5 ? [0] : [])]) {
        bar(b, "oak", [px, L.y0 - 0.85, prev.zf + 0.04], [px, L.y0 - 0.45, prev.zf + 0.18], 0.13, 0.15, []);
        bar(b, "oak", [px, L.y0 - 0.48, prev.zf + 0.15], [px, L.y0 - 0.02, L.zf - 0.06], 0.13, 0.15, []);
      }
      if (rich) {
        const nj = Math.max(3, Math.round(L.w / 0.55));
        for (let i = 0; i < nj; i++) solid(b, "oak", 0.08, 0.09, L.zf - prev.zf + 0.02, -L.w / 2 + ((i + 0.5) * L.w) / nj, L.y0 - 0.12, (prev.zf + L.zf) / 2, 0, ["py", "nz"]);
      }
    }
  });
  // roof
  const wT = top.w;
  const dT = top.d;
  const tileMat = o.roof;
  const gf = !!o.gableFront;
  const gcount = gf ? o.gables ?? 1 : 1;
  const roofSpan = gf ? wT / gcount : dT;
  const rise = (roofSpan / 2) * o.pitch;
  const oh = thatch ? 0.5 : 0.42;
  const topH = top.y1 - top.y0;
  const endOver = o.endOver ?? oh;
  // roof strips along the ridge (so it can sag): finer on the near model
  const segL = rich ? 1.5 : 3.0;
  for (let g = 0; g < gcount; g++) {
    const gx = gf ? (g - (gcount - 1) / 2) * roofSpan : 0;
    if (thatch) {
      if (gf) thatchRoof(b, tileMat, kit.infill, dT, roofSpan, rise, gx, top.y1, top.zc, Math.PI / 2, o.seed + g, o.hip ? 2 : 0, oh, 0.25);
      else thatchRoof(b, tileMat, kit.infill, wT, dT, rise, 0, top.y1, top.zc, 0, o.seed, o.hip ? 2 : 0, oh, Math.min(0.3, endOver));
    } else if (gf) {
      gableRoof(b, tileMat, kit.infill, dT, roofSpan, rise, gx, top.y1, top.zc, Math.PI / 2, oh, topH, [true, true], oh, segL, rich);
      ridgeRoll(b, tileMat, dT + oh * 2, gx, top.y1 + rise, top.zc, Math.PI / 2, rich, segL);
    } else {
      gableRoof(b, tileMat, kit.infill, wT, dT, rise, 0, top.y1, top.zc, 0, oh, topH, [true, true], endOver, segL, rich);
      ridgeRoll(b, tileMat, wT + endOver * 2, 0, top.y1 + rise, top.zc, 0, rich, segL);
      if (rich) {
        // rafter feet under the street eaves
        const drop = (oh * rise) / (dT / 2);
        const nr = Math.max(4, Math.round(wT / 0.45));
        for (let i = 0; i < nr; i++) {
          const rx = -wT / 2 + ((i + 0.5) * wT) / nr;
          bar(b, "oak", [rx, top.y1 + 0.02, top.zf - 0.05], [rx, top.y1 - drop - 0.1, top.zf + oh - 0.04], 0.1, 0.08, []);
        }
        solid(b, "oak", wT + endOver * 2, 0.06, 0.16, 0, top.y1 - 0.08, top.zf + 0.02, 0, ["nz"]);
      }
    }
  }
  const ridgeY = top.y1 + rise;
  if (gf) {
    // front gable ends: bargeboards and a finial, a small window when there is room
    for (let g = 0; g < gcount; g++) {
      const gx = (g - (gcount - 1) / 2) * roofSpan;
      if (!thatch) {
        const zb = top.zf + oh;
        const dr = (oh * rise) / (roofSpan / 2);
        for (const s of [-1, 1]) bar(b, "oak", [gx + s * (roofSpan / 2 + oh), top.y1 - dr - 0.05, zb], [gx, top.y1 + rise + 0.06, zb], 0.24, 0.05, ["ny", "nz"]);
        if (rich) solid(b, "oak", 0.12, 0.9, 0.12, gx, top.y1 + rise - 0.35, zb + 0.03, 0, ["ny"]);
      }
      on(b, gx, top.zf, 0, () => {
        if (rise > 1.3 && roofSpan > 3.2) windowAt(b, 0, top.y1 + 0.45, Math.min(0.85, roofSpan * 0.2), 0.7, glass ? "glass" : "open", rich, r);
      });
    }
  }
  // dormers on eaves-front houses
  if (!gf && (o.dormers ?? 0) > 0 && !thatch) {
    const nd = o.dormers ?? 0;
    for (let i = 0; i < nd; i++) {
      const dx = nd === 1 ? (r() - 0.5) * wT * 0.4 : (i - (nd - 1) / 2) * wT * 0.55;
      const fz = top.zc + (dT / 2) * 0.42;
      const base = top.y1 + rise * (1 - 0.42) - 0.2;
      const dw = 1.3, dh = 1.2, dd = 1.1;
      storeyWalls(b, kit.infill, dw, dh, dd, dx, base, fz - dd / 2 + 0.05, ["nz"]);
      gableRoof(b, tileMat, kit.infill, dd + 0.2, dw, 0.6, dx, base + dh, fz - dd / 2 + 0.05, Math.PI / 2, 0.22, dh, [false, true], 0.22, 4, rich);
      on(b, dx, fz + 0.05, 0, () => {
        windowAt(b, 0, base + 0.25, 0.7, 0.75, glass ? "glass" : "open", rich, r);
        for (const s of [-1, 1]) solid(b, "oak", 0.12, dh, 0.1, s * (dw / 2 - 0.02), base, 0, 0, ["ny", "py"]);
      });
    }
  }
  // brick stacks: Tudor and later only (the caller sets chimney)
  if (o.chimney) {
    const ns = o.stacks ?? 1;
    // stacks differ house to house: one to three shafts, taller or squatter, placed on the ridge or set back
    const shafts = o.shafts ?? 2;
    const tall = o.stackH ?? 1.05;
    for (let i = 0; i < ns; i++) {
      const sgn = ns === 1 ? (r() < 0.5 ? -1 : 1) : i === 0 ? -1 : 1;
      if (gf) {
        const gx = gcount > 1 ? ((sgn < 0 ? 0 : gcount - 1) - (gcount - 1) / 2) * roofSpan : 0;
        const back = o.stackBack ?? 0.2;
        // a stack set back down the roof must still clear the ridge: it rises from the slope to above the ridge
        stack(b, gx, top.y1 + rise * 0.3, ridgeY + tall, top.zc - dT * back, 0.75 + (shafts > 2 ? 0.3 : 0), 1.0, shafts, 0.7 + tall * 0.15);
      } else {
        stack(b, sgn * (wT / 2 - 0.85), top.y1 + rise * 0.3, ridgeY + tall, top.zc, 1.1 + (shafts > 2 ? 0.25 : 0), 0.75, shafts, 0.7 + tall * 0.15);
      }
    }
  } else if (o.louvre && !thatch) {
    // open hall: a boarded smoke louvre on the ridge
    if (gf) louvre(b, gcount > 1 ? -roofSpan / 2 : 0, ridgeY - 0.05, top.zc - dT * 0.15, Math.PI / 2, thatch ? "shingle" : tileMat);
    else louvre(b, wT * 0.12, ridgeY - 0.05, top.zc, 0, thatch ? "shingle" : tileMat);
  } else recordSmoke(b, 0, ridgeY + 0.3, top.zc, 3); // smoke from an open hearth finds its way out under the ridge
  // street furniture on the near model: sign, cellar flaps, pentice
  if (rich) {
    on(b, 0, lv[0].zf, 0, () => {
      if (o.sign !== undefined && o.sign >= 0 && n > 1) signAt(b, -Math.sign(doorX || 1) * (o.w / 2 - 0.5), lv[1].y0 + 0.35, o.sign % 8);
      if (o.cellar) cellarAt(b, doorX > 0 ? -o.w / 2 + 1.1 : o.w / 2 - 1.1);
      if (o.pentice && n > 1) penticeAt(b, o.w - 0.1, lv[0].y1 - 0.3, jet + 0.75, thatch ? "tile" : o.roof);
    });
  }
  // rear additions
  if (o.rear === "lean") {
    const lw = o.w * 0.78;
    const ly = PL + sh * 0.95;
    solid(b, "rubble", lw + 0.1, PL + 1.3, 2.3, -o.w * 0.05, -1.3, -o.d / 2 - 1.15, 0, ["ny"]);
    solid(b, kit.framed ? "daub" : kit.infill, lw, ly - 0.35 - PL, 2.2, -o.w * 0.05, PL, -o.d / 2 - 1.1, 0, ["ny", "py", "pz"]);
    leanRoof(b, thatch ? "thatch-old" : tileMat, lw + 0.6, 2.7, ly + 0.3, ly - 0.45, -o.w * 0.05, -o.d / 2);
    on(b, -o.w * 0.05, -o.d / 2 - 2.2, Math.PI, () => {
      quad(b, "dark", 0.7, 0.6, -lw * 0.2, PL + 0.9, 0.03);
      doorAt(b, lw * 0.25, 0.85, 1.85, PL + 0.02, false, false, r);
    });
  } else if (o.rear === "range") {
    const rw = o.w * 0.6;
    const rd = 4.6;
    const rh = sh * 1.05 + 0.5;
    const rx = o.w * 0.12;
    const rz = -o.d / 2 - rd / 2;
    solid(b, "rubble", rw + 0.1, PL + 1.3, rd + 0.05, rx, -1.3, rz, 0, ["ny"]);
    storeyWalls(b, kit.infill, rw, rh, rd, rx, PL, rz, ["pz"]);
    if (thatch) thatchRoof(b, "thatch-old", kit.infill, rd, rw, (rw / 2) * 1.1, rx, PL + rh, rz, Math.PI / 2, o.seed + 9, 0, 0.4, 0.3);
    else gableRoof(b, tileMat, kit.infill, rd, rw, (rw / 2) * 0.95, rx, PL + rh, rz, Math.PI / 2, 0.35, rh, [true, false], 0.35, segL * 1.5, rich);
    on(b, rx, rz - rd / 2, Math.PI, () => quad(b, "dark", 0.8, 0.7, 0, PL + 1.0, 0.03));
    on(b, rx + rw / 2, rz, Math.PI / 2, () => {
      doorAt(b, 0.5, 0.85, 1.85, PL + 0.02, false, false, r);
      quad(b, "dark", 0.7, 0.65, -1.2, PL + 1.0, 0.03);
    });
  }
  return ridgeY;
}

/* ------------------------------------------------------------------ style tables */

export interface StyleVariant {
  build: (b: Builder, seed: number, detail: boolean) => void;
}

type Spec = Omit<HouseOpts, "detail" | "seed" | "pitch"> & { x?: number; pitch?: number };

/** Place a row of houses; the outermost expose their side walls. */
function row(b: Builder, specs: Spec[], detail: boolean, seed: number): void {
  // one roof material per instance keeps the number of draw calls down
  specs = specs.map((sp) => ({ ...sp, roof: sp.roof.startsWith("thatch") ? sp.roof : specs[0].roof }));
  specs.forEach((sp, i) => {
    const x = sp.x ?? 0;
    b.at(x, 0, 0, 0, () =>
      house(b, { pitch: 1.1, ...sp, sides: sp.sides ?? [i === 0, i === specs.length - 1], detail, seed: seed + i * 11 }),
    );
  });
}

/** Debug hook: triangle count per style|variant|lod, readable as window.__houseTris. */
function measured(name: string, fn: (b: Builder, v: number, detail: boolean) => void): (b: Builder, v: number, detail: boolean) => void {
  return (b, v, detail) => {
    fn(b, v, detail);
    try {
      let tris = 0;
      const parts = (b as unknown as { parts: Map<string, THREE.BufferGeometry[]> }).parts;
      const byMat: Record<string, number> = {};
      for (const [m, list] of parts) for (const g of list) { tris += g.attributes.position.count / 3; byMat[m] = (byMat[m] ?? 0) + g.attributes.position.count / 3; }
      const w = globalThis as unknown as { __houseTris?: Record<string, number>; __houseMats?: Record<string, Record<string, number>> };
      (w.__houseTris ??= {})[`${name}|${v}|${detail ? "detail" : "overview"}`] = tris;
      (w.__houseMats ??= {})[`${name}|${v}|${detail ? "detail" : "overview"}`] = byMat;
    } catch {
      /* measurement only */
    }
  };
}

/* ----- roundhouse (Iron Age): wattle and daub drum, conical thatch to the ground-ish, no chimney */
function roundhouse(b: Builder, v: number, detail: boolean): void {
  const rad = 3.3 + v * 0.7;
  const wh = 1.6 + (v % 2) * 0.25;
  if (!detail) {
    b.cyl("daub", rad, rad, wh + 1, 8, 0, -0.9, 0, 0, true);
    b.cone("thatch-old", rad + 0.8, rad * 1.1, 8, 0, wh - 0.2, 0);
    recordSmoke(b, 0, wh - 0.2 + rad * 1.1, 0, rad);
    return;
  }
  const r = rng(v * 13 + 5);
  b.cyl("daub", rad, rad + 0.04, wh + 1.2, 14, 0, -1.2, 0, 0, true);
  b.cyl("timber", rad + 0.03, rad + 0.03, 0.18, 14, 0, wh - 0.2, 0, 0, true); // wall plate ring (not full: reads as wall-head lashing)
  thatchCone(b, v % 2 ? "thatch" : "thatch-old", rad + 0.85, rad * (1.05 + (v % 3) * 0.08), 0, wh, 0, 16);
  recordSmoke(b, 0, wh + rad * (1.05 + (v % 3) * 0.08), 0, rad); // smoke seeps out through the thatch near the apex
  // doorway with posts and lintel, small thatched hood
  on(b, 0, rad, 0, () => {
    quad(b, "dark", 0.95, 1.5, 0, 0, 0.04);
    for (const s of [-1, 1]) solid(b, "timber", 0.2, 1.8, 0.2, s * 0.58, 0, 0.12, 0, ["ny"]);
    solid(b, "timber", 1.4, 0.2, 0.22, 0, 1.55, 0.12, 0, ["ny"]);
    if (v >= 2) {
      for (const s of [-1, 1]) solid(b, "timber", 0.14, 1.9, 0.14, s * 0.85, 0, 1.1, 0, ["ny"]);
      thatchRoof(b, "thatch-old", null, 1.8, 1.9, 0.5, 0, 1.9, 0.7, Math.PI / 2, v, 1, 0.25, 0.2);
    }
  });
  // low raised granary hut on some farmsteads
  if (v === 3) {
    on(b, rad + 2.6, -1.2, 0.3, () => {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid(b, "timber", 0.2, 0.7, 0.2, sx * 0.8, 0, sz * 0.8, 0, ["ny"]);
      solid(b, "timber", 2.0, 1.2, 2.0, 0, 0.7, 0, 0, ["ny"]);
      thatchRoof(b, "thatch-old", "timber", 2.0, 2.0, 1.1, 0, 1.9, 0, 0, 77, 0, 0.35, 0.3);
    });
  }
  void r;
}

/* ----- Roman timber strip building: narrow end to the street, shop front, tile or thatch */
const ROMAN_STRIP = [
  { w: 5.4, d: 15, st: 1, roof: "thatch", wall: "daub", pitch: 0.7, side: false },
  { w: 6.0, d: 18, st: 1, roof: "tegula", wall: "plaster", pitch: 0.5, side: false },
  { w: 5.2, d: 13.5, st: 2, roof: "tegula", wall: "daub", pitch: 0.5, side: false },
  { w: 6.8, d: 16, st: 1, roof: "shingle", wall: "timber", pitch: 0.55, side: false },
  { w: 5.8, d: 20, st: 2, roof: "tegula", wall: "plaster", pitch: 0.48, side: false },
  { w: 4.6, d: 12.5, st: 1, roof: "thatch", wall: "daub", pitch: 0.75, side: false },
  { w: 13.5, d: 7.5, st: 1, roof: "tegula", wall: "daub", pitch: 0.45, side: true }, // side-on range along the street
];
function romanTimber(b: Builder, v: number, detail: boolean): void {
  const P = ROMAN_STRIP[v % ROMAN_STRIP.length];
  const sh = 3.0;
  const H = P.st * sh + (P.st > 1 ? 0.4 : 0);
  if (!detail) {
    b.box(P.wall, P.w, H + 1.4, P.d, 0, -1.4, 0);
    if (P.side) gab(b, P.roof, P.wall, P.w, P.d, (P.d / 2) * P.pitch, 0, H, 0, 0, 0.4, 5, false);
    else gab(b, P.roof, P.wall, P.d, P.w, (P.w / 2) * P.pitch, 0, H, 0, Math.PI / 2, 0.4, 5, false);
    return;
  }
  const r = rng(v * 31 + 7);
  const thatch = P.roof.startsWith("thatch");
  const kit = P.wall === "timber" ? { infill: "timber" } : { infill: P.wall };
  const PL = 0.25;
  const w = P.w, d = P.d;
  solid(b, "roman-rubble", w + 0.14, PL + 1.3, d + 0.14, 0, -1.3, 0, 0, ["ny"]);
  solid(b, kit.infill, w, H - PL, d, 0, PL, 0, 0, ["ny", "py"]);
  // timber frame showing as sill, posts and plate (wattle and daub between)
  const frameFace = (fw: number, y0: number, h: number, posts: number) => {
    solid(b, "timber", fw + 0.08, 0.14, 0.1, 0, y0, 0.05, 0, ["nz", "px", "nx", "ny"]);
    solid(b, "timber", fw + 0.08, 0.16, 0.1, 0, y0 + h - 0.16, 0.05, 0, ["nz", "px", "nx"]);
    for (let i = 0; i <= posts; i++) solid(b, "timber", 0.15, h - 0.3, 0.09, -fw / 2 + (i * fw) / posts, y0 + 0.14, 0.045, 0, ["ny", "py", "nz"]);
  };
  const wallH = (H - PL);
  const front = P.side ? d / 2 : d / 2; // street end (+z) for strips; long side for the range
  if (!P.side) {
    // street gable: wide shop opening below, awning over, shuttered openings above
    on(b, 0, d / 2, 0, () => {
      frameFace(w, PL, P.st > 1 ? sh - 0.2 : wallH, Math.max(2, Math.round(w / 1.5)));
      const ow = w - 1.7;
      quad(b, "dark", ow, 2.0, -0.2, PL + 0.1, 0.06);
      for (const s of [-1, 1]) solid(b, "timber", 0.2, 2.4, 0.16, -0.2 + (s * ow) / 2, PL, 0.08, 0, ["ny", "py", "nz"]);
      solid(b, "timber", ow + 0.4, 0.22, 0.18, -0.2, PL + 2.2, 0.09, 0, ["ny", "nz"]);
      solid(b, "ashlar", ow, 0.8, 0.5, -0.2, PL, 0.3, 0, ["ny"]); // counter
      door(b, w / 2 - 0.65, 0.85, 2.0, PL + 0.02, true);
      bar(b, "tegula", [-w / 2 - 0.1, PL + 2.9, 0.05], [-w / 2 - 0.1, PL + 2.35, 1.4], 0.06, 0.06, ["ny"]);
      if (P.st > 1) {
        frameFace(w, PL + sh + 0.2, sh - 0.2, Math.max(2, Math.round(w / 1.5)));
        for (const s of [-1, 1]) win(b, s * w * 0.22, PL + sh + 0.9, 0.7, 0.9, "open");
      } else if (v === 0 || v === 5) {
        win(b, w * 0.3, PL + 1.2, 0.5, 0.45, "open");
      }
    });
    // an awning on posts is plausible for a shop; model it as a short pent of tile
    if (P.st === 1) {
      for (const s of [-1, 1]) solid(b, "timber", 0.14, 2.3, 0.14, s * (w / 2 - 0.2), 0, d / 2 + 1.55, 0, ["ny"]);
      leanRoof(b, thatch ? "thatch" : P.roof, w + 0.2, 1.7, PL + 2.9, PL + 2.4, 0, d / 2 + 1.65);
    }
    // back and sides: a door and openings
    on(b, 0, -d / 2, Math.PI, () => {
      frameFace(w, PL, wallH - 0.4, 3);
      door(b, -w * 0.15, 0.9, 1.9, PL + 0.02);
      win(b, w * 0.25, PL + 1.2, 0.6, 0.55, "open");
    });
    for (const sd of [-1, 1])
      on(b, (sd * w) / 2, 0, (sd * Math.PI) / 2, () => {
        solid(b, "timber", d, 0.14, 0.1, 0, PL, 0.05, 0, ["nz", "px", "nx", "ny"]);
        solid(b, "timber", d, 0.16, 0.1, 0, H - 0.16, 0.05, 0, ["nz", "px", "nx"]);
        for (let i = 0; i <= 4; i++) solid(b, "timber", 0.16, wallH - 0.3, 0.09, -d / 2 + (i * d) / 4, PL + 0.14, 0.045, 0, ["ny", "py", "nz"]);
        win(b, -d * 0.2 + sd * r() * 1.5, PL + 1.3, 0.55, 0.5, "open");
        if (d > 15) win(b, d * 0.25, PL + 1.3, 0.55, 0.5, "open");
      });
    // roof, gable to the street
    const rise = (w / 2) * P.pitch;
    if (thatch) thatchRoof(b, P.roof, kit.infill, d, w, rise, 0, H, 0, Math.PI / 2, v + 3, 0, 0.45, 0.35);
    else {
      gab(b, P.roof, kit.infill, d, w, rise, 0, H, 0, Math.PI / 2, 0.4, 2.6, false);
      ridgeCap(b, P.roof, d + 0.8, 0, H + rise, 0, Math.PI / 2);
      const dr = (0.4 * rise) / (w / 2);
      for (const sz of [-1, 1]) for (const s of [-1, 1]) bar(b, "timber", [s * (w / 2 + 0.4), H - dr, sz * (d / 2 + 0.4)], [0, H + rise, sz * (d / 2 + 0.4)], 0.1, 0.03, ["ny", "nz"]);
    }
    // rear workshop lean-to on the longer plots
    if (v === 1 || v === 4) {
      const lw = w * 0.9;
      leanRoof(b, P.roof, lw + 0.5, 3.2, PL + 2.8, PL + 2.0, 0, -d / 2);
      solid(b, "daub", lw, 2.0, 3.0, 0, PL, -d / 2 - 1.5, 0, ["ny", "py", "pz"]);
    }
  } else {
    // side-on range: shop front along the street, eaves to the street, door at one end
    on(b, 0, d / 2, 0, () => {
      frameFace(w, PL, wallH, 8);
      for (let i = 0; i < 3; i++) {
        const cx = -w / 2 + 2.0 + i * 4.0;
        quad(b, "dark", 2.4, 1.7, cx, PL + 0.5, 0.06);
        solid(b, "timber", 2.7, 0.2, 0.16, cx, PL + 2.2, 0.08, 0, ["ny", "nz"]);
        solid(b, "ashlar", 2.4, 0.6, 0.45, cx, PL, 0.27, 0, ["ny"]);
      }
      door(b, w / 2 - 1.1, 1.0, 2.1, PL + 0.02);
    });
    on(b, 0, -d / 2, Math.PI, () => {
      frameFace(w, PL, wallH, 8);
      for (let i = 0; i < 3; i++) win(b, -w / 2 + 2.2 + i * 4.5, PL + 1.2, 0.6, 0.55, "open");
    });
    const rise = (d / 2) * P.pitch;
    gab(b, P.roof, kit.infill, w, d, rise, 0, H, 0, 0, 0.45, 2.6, false);
    ridgeCap(b, P.roof, w + 0.9, 0, H + rise, 0, 0);
  }
  void front;
}

/* ----- Roman masonry houses and warehouses: plastered rubble walls, tile roofs, columned portico */
function romanMasonry(b: Builder, v: number, detail: boolean): void {
  const kinds = [
    { w: 17, d: 9, h: 5.2, wings: true, portico: true },
    { w: 20, d: 9, h: 5.6, wings: true, portico: false },
    { w: 12, d: 10, h: 7.2, wings: false, portico: true },
    { w: 22, d: 9.5, h: 5.0, wings: false, portico: false },
  ];
  const K = kinds[v % kinds.length];
  const { w, d, h } = K;
  if (!detail) {
    b.box("plaster", w, h + 1.4, d, 0, -1.4, -3);
    b.gable("tegula", "plaster", w, d, d * 0.22, 0, h, -3, 0, 0.5);
    if (K.wings) for (const s of [1, -1]) {
      b.box("plaster", 6, 4 + 1.4, 9, s * (w / 2 - 3), -1.4, 5.5);
      b.gable("tegula", "plaster", 9, 6, 1.3, s * (w / 2 - 3), 4, 5.5, Math.PI / 2, 0.4);
    }
    return;
  }
  const PL = 0.35;
  const mainZ = -3;
  // main range
  solid(b, "roman-rubble", w + 0.2, PL + 1.3, d + 0.2, 0, -1.3, mainZ, 0, ["ny"]);
  solid(b, "plaster", w, h - PL, d, 0, PL, mainZ, 0, ["ny", "py"]);
  const rise = d * 0.22;
  b.gable("tegula", "plaster", w, d, rise, 0, h, mainZ, 0, 0.5);
  ridgeCap(b, "tegula", w + 1, 0, h + rise, mainZ, 0);
  // dado band and cornice
  solid(b, "ashlar", w + 0.1, 0.22, 0.12, 0, h - 0.3, mainZ + d / 2 + 0.06, 0, ["ny", "nz", "px", "nx"]);
  const nWin = Math.max(3, Math.round(w / 4));
  on(b, 0, mainZ + d / 2, 0, () => {
    for (let i = 0; i < nWin; i++) {
      const cx = -w / 2 + ((i + 0.5) * w) / nWin;
      if (K.wings && Math.abs(cx) > w / 2 - 6.2) continue;
      if (i === Math.floor(nWin / 2) && !K.portico) { door(b, cx, 1.3, 2.4, PL, true); continue; }
      win(b, cx, 2.3, 0.7, 1.2, "open", "caen");
    }
  });
  if (K.portico) {
    // colonnade on the courtyard side
    const pw = K.wings ? w - 12 : w - 2;
    const n = Math.max(3, Math.round(pw / 2.6));
    for (let i = 0; i <= n; i++) {
      const cx = -pw / 2 + (i * pw) / n;
      b.cyl("caen", 0.3, 0.34, 3.6, 8, cx, 0, mainZ + d / 2 + 1.6, 0, true);
      solid(b, "caen", 0.8, 0.22, 0.8, cx, 3.6, mainZ + d / 2 + 1.6, 0, ["ny"]);
    }
    solid(b, "ashlar", pw + 1.0, 0.45, 0.7, 0, 3.8, mainZ + d / 2 + 1.6, 0, ["ny"]);
    leanRoof(b, "tegula", pw + 1.4, 1.9, 4.9, 4.0, 0, mainZ + d / 2 - 0.1);
    leanRoof(b, "tegula", pw + 1.4, 1.9, 4.9, 4.0, 0, mainZ + d / 2 + 1.9);
  }
  if (K.wings) {
    for (const s of [1, -1]) {
      const wx = s * (w / 2 - 3);
      solid(b, "roman-rubble", 6.2, PL + 1.3, 9.2, wx, -1.3, 5.5, 0, ["ny"]);
      solid(b, "plaster", 6, 4 - PL, 9, wx, PL, 5.5, 0, ["ny", "py"]);
      b.gable("tegula", "plaster", 9, 6, 1.5, wx, 4, 5.5, Math.PI / 2, 0.4);
      ridgeCap(b, "tegula", 9.8, wx, 5.5, 5.5, Math.PI / 2);
      on(b, wx, 10, 0, () => {
        door(b, 0, 1.2, 2.3, PL, true);
        win(b, -2.0, 1.8, 0.6, 0.9, "open", "caen");
        win(b, 2.0, 1.8, 0.6, 0.9, "open", "caen");
      });
      on(b, wx + s * 3, 5.5, s * Math.PI / 2, () => {
        win(b, -2.2, 1.8, 0.6, 0.9, "open", "caen");
        win(b, 2.2, 1.8, 0.6, 0.9, "open", "caen");
      });
    }
    solid(b, "roman-rubble", w, 1.3, 0.5, 0, -0.2, 10.0, 0, ["ny"]);
  } else if (v === 3) {
    // warehouse: buttresses, high slit openings and wide loading doors
    for (let i = 0; i <= 6; i++) solid(b, "ashlar", 0.6, 4.5, 0.5, -w / 2 + (i * w) / 6, 0, mainZ + d / 2 + 0.25, 0, ["ny"]);
    on(b, 0, mainZ + d / 2, 0, () => {
      for (let i = 0; i < 2; i++) { solid(b, "timber", 2.7, 3.2, 0.14, -w * 0.18 + i * w * 0.36, 0, 0.07, 0, ["ny", "nz"]); quad(b, "dark", 2.3, 2.9, -w * 0.18 + i * w * 0.36, 0, 0.15); }
    });
  } else {
    // two-storey masonry block with a loggia on the upper floor
    on(b, 0, mainZ + d / 2, 0, () => { for (let i = 0; i < 3; i++) win(b, -3 + i * 3, 5.1, 0.7, 1.1, "open", "caen"); });
  }
}

/* ----- Saxon timber halls and sunken-featured buildings: no windows, no chimneys, smoke through the thatch */
function saxon(b: Builder, v: number, detail: boolean): void {
  const kinds = [
    { w: 11.5, d: 5.6, wall: "timber", roof: "thatch", hip: 0, h: 2.1, pitch: 1.3 },
    { w: 10, d: 5.2, wall: "daub", roof: "thatch-old", hip: 2, h: 2.0, pitch: 1.2 },
    { w: 14.5, d: 6.2, wall: "timber", roof: "thatch-old", hip: 0, h: 2.2, pitch: 1.15 },
    { w: 3.8, d: 3.0, wall: "timber", roof: "thatch", hip: 0, h: 0.5, pitch: 1.7 }, // sunken-featured building
    { w: 7.2, d: 4.6, wall: "daub", roof: "thatch", hip: 2, h: 1.9, pitch: 1.25 },
    { w: 9.5, d: 5.5, wall: "timber", roof: "shingle", hip: 0, h: 2.2, pitch: 0.75 },
    { w: 12.5, d: 6.4, wall: "daub", roof: "thatch-old", hip: 2, h: 2.2, pitch: 1.2 },
  ];
  const K = kinds[v % kinds.length];
  const { w, d, h } = K;
  const sunken = v % kinds.length === 3;
  if (!detail) {
    b.box(K.wall, w, h + 1.4, d, 0, -1.4, 0);
    if (K.roof === "shingle") gab(b, K.roof, K.wall, w, d, (d / 2) * K.pitch, 0, h, 0, 0, 0.4, 5, false);
    else gab(b, K.roof, K.wall, w, d, (d / 2) * K.pitch, 0, h, 0, 0, 0.55, 5, false);
    if (v === 0 || v === 6) b.box("timber", 3.6, 2.2 + 1.2, 3.0, w / 2 + 2.6, -1.2, 1.2);
    return;
  }
  const rise = (d / 2) * K.pitch;
  const r = rng(v * 17 + 3);
  if (sunken) {
    // a small pit-house: roof reaches almost to the ground on a ridge carried by two end posts
    solid(b, "earth", w + 1.2, 0.35, d + 1.0, 0, -0.1, 0, 0, ["ny"]);
    solid(b, K.wall, w, 1.2, d, 0, -0.5, 0, 0, ["ny", "py"]);
    thatchRoof(b, K.roof, K.wall, w, d, rise + 0.3, 0, 0.6, 0, 0, v, 0, 0.35, 0.3);
    on(b, 0, d / 2, 0, () => {
      quad(b, "dark", 0.7, 0.9, 0, 0.1, 0.04);
      for (const s of [-1, 1]) solid(b, "timber", 0.12, 1.1, 0.1, s * 0.45, 0.05, 0.08, 0, ["ny"]);
    });
    // smoke-hole in the gable apex
    on(b, 0, d / 2 + 0.3, 0, () => quad(b, "dark", 0.3, 0.3, 0, rise + 0.45, 0.02));
    return;
  }
  // hall: post-built plank or wattle and daub walls on a stone-footed sill
  const PL = 0.2;
  solid(b, "ragstone", w + 0.1, PL + 1.2, d + 0.1, 0, -1.2, 0, 0, ["ny"]);
  solid(b, K.wall, w, h - PL, d, 0, PL, 0, 0, ["ny", "py"]);
  // external corner and wall posts in the long walls
  const np = Math.max(3, Math.round(w / 2.1));
  for (const sz of [-1, 1])
    for (let i = 0; i <= np; i++) solid(b, "timber", 0.2, h - PL, 0.14, -w / 2 + (i * w) / np, PL, sz * (d / 2 + 0.03), 0, ["ny", "py"]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid(b, "timber", 0.24, h - PL + 0.2, 0.24, sx * (w / 2), PL, sz * (d / 2), 0, ["ny"]);
  if (K.roof === "shingle") {
    gab(b, K.roof, K.wall, w, d, rise, 0, h, 0, 0, 0.4, 2.6, false);
    ridgeCap(b, "timber", w + 0.8, 0, h + rise, 0, 0);
  } else {
    thatchRoof(b, K.roof, K.wall, w, d, rise, 0, h, 0, 0, v + 2, K.hip, 0.5, 0.35);
    recordSmoke(b, 0, h + rise + 0.2, 0, 3.2); // open hearth: smoke through the thatch and the gable vents
  }
  // doors in the long walls, opposite one another and not quite aligned; no windows
  const dx = (v % 2 ? -1 : 1) * (w * 0.18 + r() * 0.8);
  on(b, dx, d / 2 + 0.03, 0, () => door(b, 0, 1.0, 1.85, PL, true));
  on(b, -dx * 0.8, -d / 2 - 0.03, Math.PI, () => door(b, 0, 1.0, 1.85, PL, false));
  // smoke vent high in the gable (gabled halls)
  if (!K.hip && K.roof !== "shingle") for (const s of [-1, 1]) on(b, s * (w / 2 + 0.4), 0, s * Math.PI / 2, () => quad(b, "dark", 0.4, 0.5, 0, h + rise * 0.55, 0.0));
  // annex or outbuilding
  if (v === 0 || v === 6) {
    const ax = w / 2 + 2.9;
    solid(b, "ragstone", 3.7, PL + 1.2, 3.0, ax, -1.2, 1.2, 0, ["ny"]);
    solid(b, "timber", 3.5, 1.9 - PL, 2.8, ax, PL, 1.2, 0, ["ny", "py"]);
    thatchRoof(b, "thatch-old", "timber", 3.5, 2.8, 1.7, ax, 1.9, 1.2, 0, v + 20, 1, 0.4, 0.3);
    on(b, ax, 2.62, 0, () => door(b, -0.3, 0.8, 1.5, PL, false));
  }
  if (v === 2) {
    // byre end: lower lean-to along the back wall
    solid(b, "timber", w * 0.5, 1.6, 1.9, -w * 0.1, PL, -d / 2 - 0.95, 0, ["ny", "py", "pz"]);
    leanRoof(b, "thatch-old", w * 0.5 + 0.8, 2.4, 2.4, 1.2, -w * 0.1, -d / 2 + 0.2);
  }
}

/* ----- medieval town and suburb houses: jettied, open shuttered windows, tile or thatch, no chimneys */
const MEDIEVAL: Spec[][] = [
  // 0: pair of gable-front houses
  [
    { x: -3.2, w: 5.8, d: 9, storeys: 2, wall: "frame", roof: "tile-old", jetty: 0.42, gableFront: true, glazed: false, shop: true, pitch: 1.15 },
    { x: 3.2, w: 6.2, d: 9, storeys: 3, wall: "frame-ochre", roof: "tile-old", jetty: 0.42, gableFront: true, glazed: false, pitch: 1.15 },
  ],
  // 1: hall house: open hall under thatch with a jettied cross-wing
  [
    { x: -2.7, w: 8.2, d: 9.5, storeys: 1, storeyH: 4.2, wall: "daub", roof: "thatch-old", gableFront: false, hip: true, glazed: false, pitch: 1.2, sides: [true, false], rear: "lean" },
    { x: 4.2, w: 4.8, d: 9.5, storeys: 2, wall: "frame-ochre", roof: "tile-old", jetty: 0.5, gableFront: true, glazed: false, pitch: 1.1, sides: [false, true] },
  ],
  // 2: pair of eaves-front houses, shop below
  [
    { x: -3.4, w: 6.2, d: 8, storeys: 2, wall: "frame-grey", roof: "tile-old", jetty: 0.35, gableFront: false, glazed: false, shop: true, pitch: 0.95 },
    { x: 3.2, w: 6.0, d: 8, storeys: 2, wall: "frame", roof: "tile-old", jetty: 0.35, gableFront: false, glazed: false, pitch: 0.95, rear: "lean" },
  ],
  // 3: tall late-medieval merchant house, gable to street, wide
  [
    { w: 8.6, d: 10, storeys: 3, wall: "frame-ochre", roof: "tile-old", jetty: 0.45, gableFront: true, glazed: false, shop: true, pitch: 1.1, rear: "range" },
  ],
  // 4: pair of narrow thatched suburb houses with rear lean-tos
  [
    { x: -3.0, w: 4.8, d: 8, storeys: 2, wall: "daub", roof: "thatch-old", jetty: 0.3, gableFront: true, glazed: false, pitch: 1.2, rear: "lean" },
    { x: 2.9, w: 5.2, d: 8, storeys: 2, wall: "frame-dark", roof: "thatch-old", jetty: 0.3, gableFront: true, glazed: false, pitch: 1.2 },
  ],
  // 5: house with yard range behind
  [
    { x: -0.5, w: 7.4, d: 8.5, storeys: 2, wall: "frame-rose", roof: "tile-old", jetty: 0.4, gableFront: false, glazed: false, pitch: 1.0, rear: "range" },
  ],
  // 6: pair, three and two storeys, whitewashed
  [
    { x: -3.2, w: 5.4, d: 9, storeys: 3, wall: "frame-grey", roof: "tile-old", jetty: 0.4, gableFront: true, glazed: false, pitch: 1.2 },
    { x: 3.0, w: 5.8, d: 9, storeys: 2, wall: "plaster", roof: "tile-old", jetty: 0.4, gableFront: true, glazed: false, shop: true, pitch: 1.2 },
  ],
  // 7: wide thatched hall-house with lean-to
  [
    { w: 9.8, d: 6.8, storeys: 2, wall: "frame-dark", roof: "thatch-old", jetty: 0.3, gableFront: false, hip: true, glazed: false, pitch: 1.15, rear: "lean" },
  ],
];

/* ----- Tudor and Jacobean town houses: three to four storeys, jetties, oriels, brick stacks, leaded glass */
const TUDOR: Spec[][] = [
  // 0: pair of jettied gable-front houses
  [
    { x: -3.2, w: 5.8, d: 9.5, storeys: 3, wall: "frame", roof: "tile", jetty: 0.5, gableFront: true, chimney: true, shop: true, pitch: 1.1 },
    { x: 3.2, w: 6.2, d: 9.5, storeys: 3, wall: "frame-ochre", roof: "tile-old", jetty: 0.5, gableFront: true, chimney: true, oriels: 1, pitch: 1.1 },
  ],
  // 1: wide four-storey double-gabled house
  [
    { w: 11.2, d: 10.5, storeys: 4, wall: "frame-grey", roof: "tile", jetty: 0.55, gableFront: true, gables: 2, chimney: true, stacks: 2, oriels: 1, shop: true, pitch: 1.0, rear: "range" },
  ],
  // 2: pair, eaves to street, dormers
  [
    { x: -3.4, w: 6.4, d: 9, storeys: 3, wall: "frame-rose", roof: "tile", jetty: 0.45, gableFront: false, chimney: true, dormers: 1, shop: true, pitch: 0.9 },
    { x: 3.1, w: 6.0, d: 9, storeys: 3, wall: "frame", roof: "tile-old", jetty: 0.45, gableFront: false, chimney: true, dormers: 2, oriels: 1, pitch: 0.9 },
  ],
  // 3: red brick Jacobean house, no jetty, stone string courses
  [
    { x: -0.5, w: 8.2, d: 9.5, storeys: 3, wall: "brick", roof: "tile", jetty: 0, gableFront: true, chimney: true, stacks: 2, pitch: 0.95, glazed: true, rear: "lean" },
  ],
  // 4: pair, one four storeys
  [
    { x: -3.2, w: 5.4, d: 9, storeys: 4, wall: "frame-ochre", roof: "tile-old", jetty: 0.5, gableFront: true, chimney: true, oriels: 1, pitch: 1.1 },
    { x: 3.0, w: 5.8, d: 9, storeys: 3, wall: "frame-dark", roof: "tile", jetty: 0.5, gableFront: true, chimney: true, shop: true, pitch: 1.1 },
  ],
  // 5: single three-storey with rear range
  [
    { w: 8.2, d: 10, storeys: 3, wall: "frame-ochre", roof: "tile-old", jetty: 0.5, gableFront: true, chimney: true, pitch: 1.05, rear: "range", oriels: 1 },
  ],
  // 6: pair, two storeys and attic, narrower
  [
    { x: -2.9, w: 5.0, d: 8.5, storeys: 3, wall: "frame-grey", roof: "tile", jetty: 0.4, gableFront: false, chimney: true, dormers: 1, pitch: 0.95 },
    { x: 2.9, w: 5.4, d: 8.5, storeys: 2, wall: "frame-rose", roof: "tile-old", jetty: 0.4, gableFront: false, chimney: true, dormers: 1, shop: true, pitch: 0.95 },
  ],
  // 7: shop house, central stack, long rear lean-to
  [
    { w: 8.8, d: 9.5, storeys: 3, wall: "frame", roof: "tile", jetty: 0.55, gableFront: true, chimney: true, shop: true, pitch: 1.1, rear: "lean", oriels: 1 },
  ],
];

/* ----- parish churches */
function parishChurch(b: Builder, v: number, detail: boolean): void {
  const k = [
    { l: 19, w: 8, tower: 5.2, th: 14, spire: false, round: true, aisle: false, buttress: false },
    { l: 23, w: 9, tower: 5.6, th: 19, spire: false, round: false, aisle: true, buttress: true },
    { l: 21, w: 8.5, tower: 5.0, th: 17, spire: true, round: false, aisle: false, buttress: true },
    { l: 25, w: 9.5, tower: 6.0, th: 21, spire: false, round: false, aisle: true, buttress: true },
  ][v % 4];
  const { l, w } = k;
  const naveH = 7;
  const tx = -l / 2 - k.tower / 2 + 0.2;
  if (!detail) {
    b.box("ragstone", l, naveH + 1.6, w, 0, -1.6, 0);
    b.gable(v === 0 ? "tile-old" : "lead", "ragstone", l, w, v === 0 ? w * 0.5 : w * 0.3, 0, naveH, 0);
    b.box("ragstone", 6.5, 5 + 1.6, 6.0, l / 2 + 2.4, -1.6, 0); // chancel
    b.gable(v === 0 ? "tile-old" : "lead", "ragstone", 6.5, 6.0, 2.2, l / 2 + 2.4, 5, 0);
    b.box("ragstone", k.tower, k.th + 1.6, k.tower, tx, -1.6, 0);
    if (k.spire) b.cone("lead", k.tower * 0.62, 10, 8, tx, k.th, 0);
    else b.pyramid("lead", k.tower, k.tower, 1.8, tx, k.th, 0);
    return;
  }
  const PL = 0.4;
  const roofMat = v === 0 ? "tile-old" : "lead";
  const winKind = (cx: number, y: number, ww: number, wh: number, z: number, rot: number) =>
    on(b, cx, z, rot, () => {
      const hh = wh * 0.62;
      const shape = new THREE.Shape();
      const pt = (hw: number) => {
        shape.moveTo(-hw, 0); shape.lineTo(hw, 0); shape.lineTo(hw, hh);
        if (k.round) { shape.lineTo(hw * 0.7, hh + hw * 0.7); shape.lineTo(0, hh + hw); shape.lineTo(-hw * 0.7, hh + hw * 0.7); }
        else shape.lineTo(0, wh);
        shape.lineTo(-hw, hh);
        shape.closePath();
      };
      pt(ww / 2 + 0.16);
      b.extrude("caen", shape, 0.1, 0, y - 0.05, 0.03);
      const s2 = new THREE.Shape();
      const hw = ww / 2;
      s2.moveTo(-hw, 0); s2.lineTo(hw, 0); s2.lineTo(hw, hh);
      if (k.round) { s2.lineTo(hw * 0.7, hh + hw * 0.7); s2.lineTo(0, hh + hw); s2.lineTo(-hw * 0.7, hh + hw * 0.7); } else s2.lineTo(0, wh - 0.1);
      s2.lineTo(-hw, hh);
      s2.closePath();
      b.extrude("glass", s2, 0.1, 0, y, 0.07);
    });
  // nave
  solid(b, "ragstone", l + 0.3, PL + 1.5, w + 0.3, 0, -1.5, 0, 0, ["ny"]);
  solid(b, "ragstone", l, naveH - PL, w, 0, PL, 0, 0, ["ny", "py"]);
  b.gable(roofMat, "ragstone", l, w, v === 0 ? w * 0.5 : w * 0.3, 0, naveH, 0, 0, 0.5);
  // chancel, narrower and lower
  const cw = w - 2.0, cl = 6.5, cx = l / 2 + cl / 2 - 0.2;
  solid(b, "ragstone", cl + 0.3, PL + 1.5, cw + 0.3, cx, -1.5, 0, 0, ["ny"]);
  solid(b, "ragstone", cl, 5 - PL, cw, cx, PL, 0, 0, ["ny", "py"]);
  b.gable(roofMat, "ragstone", cl, cw, v === 0 ? cw * 0.5 : cw * 0.3, cx, 5, 0, 0, 0.4);
  // aisle as a lean-to along the north side
  if (k.aisle) {
    solid(b, "ragstone", l - 3, 4.2 - PL, 3.2, -0.5, PL, -w / 2 - 1.4, 0, ["ny", "py", "pz"]);
    leanRoof(b, "lead", l - 2.6, 4.0, 4.9, 3.9, -0.5, -w / 2 + 0.1);
    for (let i = 0; i < 3; i++) winKind(-l / 2 + 4 + i * 6, 1.4, 0.8, 2.0, -w / 2 - 3.0, Math.PI);
  }
  // tower
  const tt = k.tower;
  solid(b, "ragstone", tt + 0.3, PL + 1.5, tt + 0.3, tx, -1.5, 0, 0, ["ny"]);
  solid(b, "ragstone", tt, k.th - PL, tt, tx, PL, 0, 0, ["ny", "py"]);
  if (k.spire) {
    b.cone("lead", tt * 0.66, 11, 8, tx, k.th, 0, Math.PI / 8);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid(b, "ragstone", 0.5, 1.6, 0.5, tx + sx * (tt / 2 - 0.25), k.th - 0.4, sz * (tt / 2 - 0.25), 0, ["ny"]);
  } else {
    // parapet with crenellations (later towers), plain pyramid cap on the early tower
    if (v === 0) b.pyramid("tile-old", tt + 0.5, tt + 0.5, 3.2, tx, k.th, 0);
    else {
      for (const [sx, sz, rw, rd] of [[0, 1, tt, 0.4], [0, -1, tt, 0.4], [1, 0, 0.4, tt], [-1, 0, 0.4, tt]] as [number, number, number, number][])
        solid(b, "ragstone", rw, 0.9, rd, tx + sx * (tt / 2 - 0.2), k.th, sz * (tt / 2 - 0.2), 0, ["ny"]);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid(b, "ragstone", 0.8, 1.6, 0.8, tx + sx * (tt / 2 - 0.4), k.th, sz * (tt / 2 - 0.4), 0, ["ny"]);
      solid(b, "lead", tt - 0.8, 0.3, tt - 0.8, tx, k.th - 0.1, 0, 0, ["ny"]);
    }
  }
  // belfry openings and west door
  for (const [sx, sz, rot] of [[0, 1, 0], [0, -1, Math.PI]] as [number, number, number][])
    on(b, tx, sz * tt / 2, rot, () => {
      solid(b, "dark", 0.8, 1.8, 0.2, 0, k.th - 3.4, 0.05, 0, ["ny", "nz"]);
      solid(b, "caen", 1.1, 0.16, 0.26, 0, k.th - 1.6, 0.08, 0, ["ny", "nz"]);
    });
  on(b, tx - tt / 2, 0, -Math.PI / 2, () => {
    solid(b, "caen", 1.9, 3.0, 0.3, 0, PL, 0.1, 0, ["ny", "nz"]);
    solid(b, "timber", 1.3, 2.4, 0.12, 0, PL, 0.24, 0, ["ny", "nz"]);
  });
  // windows along the nave and chancel, buttresses between
  const bays = 4 + (l > 22 ? 1 : 0);
  for (const sd of [1, -1]) {
    const z = sd * (w / 2 + 0.02);
    for (let i = 0; i < bays; i++) {
      const wx = -l / 2 + ((i + 0.5) * l) / bays;
      if (!(k.aisle && sd < 0)) winKind(wx, 2.3, 0.9, 3.4, z, sd > 0 ? 0 : Math.PI);
      if (k.buttress) solid(b, "ragstone", 0.6, 4.6, 0.7 + 0.2, -l / 2 + (i * l) / bays, 0, sd * (w / 2 + 0.3), 0, ["ny"]);
    }
    winKind(cx, 1.8, 0.8, 2.6, sd * (cw / 2 + 0.02), sd > 0 ? 0 : Math.PI);
  }
  on(b, l / 2 + cl - 0.2, 0, Math.PI / 2, () => winKind(0, 1.8, 1.2, 3.0, 0.02, 0));
  // south porch
  if (v !== 0) {
    solid(b, "ragstone", 3.2, 3.2, 2.4, -l * 0.1, 0, w / 2 + 1.1, 0, ["ny"]);
    b.gable("lead", "ragstone", 2.4, 3.4, 1.4, -l * 0.1, 3.2, w / 2 + 1.1, Math.PI / 2, 0.2);
    on(b, -l * 0.1, w / 2 + 2.3, 0, () => solid(b, "dark", 1.4, 2.2, 0.1, 0, 0, 0.03, 0, ["ny", "nz"]));
  } else {
    on(b, -l * 0.1, w / 2, 0, () => { solid(b, "caen", 1.5, 2.6, 0.3, 0, PL, 0.1, 0, ["ny", "nz"]); solid(b, "timber", 1.0, 2.1, 0.12, 0, PL, 0.24, 0, ["ny", "nz"]); });
  }
}

/* ----- great houses outside the city: courtyard with hall, wings, gatehouse; brick and stacks only when late */
function mansion(b: Builder, v: number, detail: boolean): void {
  const brick = v % 2 === 1;
  const wall = brick ? "brick" : "ragstone";
  const roof = brick ? "tile" : "tile-old";
  if (!detail) {
    b.box(wall, 34, 9 + 2, 10, 0, -2, -12);
    b.gable(roof, wall, 34, 10, 4.5, 0, 9, -12);
    for (const s of [1, -1]) {
      b.box(wall, 9, 8 + 2, 26, s * 16, -2, 4);
      b.gable(roof, wall, 26, 9, 4, s * 16, 8, 4, Math.PI / 2);
    }
    b.box(wall, 7, 13 + 2, 7, 0, -2, 17);
    b.pyramid("lead", 7.5, 7.5, 3, 0, 13, 17);
    return;
  }
  const PL = 0.4;
  const stacksOn = brick;
  // hall range
  solid(b, "ragstone", 34.4, PL + 2, 10.4, 0, -2, -12, 0, ["ny"]);
  solid(b, wall, 34, 9 - PL, 10, 0, PL, -12, 0, ["ny", "py"]);
  b.gable(roof, wall, 34, 10, 4.5, 0, 9, -12, 0, 0.6);
  ridgeCap(b, roof, 35, 0, 13.5, -12, 0);
  on(b, 0, -7, 0, () => {
    door(b, 0, 1.6, 2.8, PL, true);
    for (let i = -3; i <= 3; i++) if (i !== 0) win(b, i * 4.2 + (i > 0 ? 0.6 : -0.6), 2.4, 1.1, 1.7, brick ? "glass" : "open", "caen");
    for (let i = -3; i <= 3; i++) win(b, i * 4.6, 5.8, 1.0, 1.4, brick ? "glass" : "open", "caen");
  });
  for (const s of [1, -1]) {
    solid(b, "ragstone", 9.4, PL + 2, 26.4, s * 16, -2, 4, 0, ["ny"]);
    solid(b, wall, 9, 8 - PL, 26, s * 16, PL, 4, 0, ["ny", "py"]);
    b.gable(roof, wall, 26, 9, brick ? 4.6 : 4, s * 16, 8, 4, Math.PI / 2, 0.5);
    ridgeCap(b, roof, 27, s * 16, brick ? 12.6 : 12, 4, Math.PI / 2);
    on(b, s * 16 - s * 4.5, 4, -s * Math.PI / 2, () => {
      for (let i = -2; i <= 2; i++) win(b, i * 4.6, 2.3, 1.0, 1.6, brick ? "glass" : "open", "caen");
      for (let i = -2; i <= 2; i++) win(b, i * 4.6, 5.3, 1.0, 1.4, brick ? "glass" : "open", "caen");
    });
    on(b, s * 16, 17, 0, () => { door(b, 0, 1.4, 2.5, PL, true); win(b, -2.4, 2.3, 1.0, 1.5, brick ? "glass" : "open", "caen"); win(b, 2.4, 2.3, 1.0, 1.5, brick ? "glass" : "open", "caen"); });
    if (stacksOn) stack(b, s * 16 + s * 2.0, 10.2, 14.0, -2, 1.5, 1.0, 3);
  }
  // gatehouse tower with battlements
  solid(b, "ragstone", 7.4, PL + 2, 7.4, 0, -2, 17, 0, ["ny"]);
  solid(b, wall, 7, 13 - PL, 7, 0, PL, 17, 0, ["ny", "py"]);
  on(b, 0, 20.5, 0, () => {
    solid(b, "dark", 3.0, 3.8, 0.4, 0, PL, 0.1, 0, ["ny", "nz"]);
    solid(b, "caen", 3.6, 0.5, 0.5, 0, PL + 3.7, 0.12, 0, ["ny", "nz"]);
    win(b, 0, 6.6, 1.4, 1.8, brick ? "glass" : "open", "caen");
  });
  if (brick) {
    b.pyramid("lead", 7.8, 7.8, 3.2, 0, 13, 17);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid(b, "brick", 1.2, 4.2, 1.2, sx * 3.2, 13, 17 + sz * 3.2, 0, ["ny"]);
  } else {
    for (const [sx, sz, rw, rd] of [[0, 1, 7, 0.5], [0, -1, 7, 0.5], [1, 0, 0.5, 7], [-1, 0, 0.5, 7]] as [number, number, number, number][])
      solid(b, "ragstone", rw, 1.0, rd, sx * 3.25, 13, 17 + sz * 3.25, 0, ["ny"]);
    for (let i = -1; i <= 1; i += 1) for (const sd of [-1, 1]) { solid(b, "ragstone", 0.7, 0.7, 0.55, i * 2.4, 14, 17 + sd * 3.25, 0, ["ny"]); solid(b, "ragstone", 0.55, 0.7, 0.7, sd * 3.25, 14, 17 + i * 2.4, 0, ["ny"]); }
    solid(b, "lead", 6.4, 0.3, 6.4, 0, 13, 17, 0, ["ny"]);
  }
  // low screen wall with arch opening across the court
  solid(b, wall, 32, 3, 0.6, 0, -0.5, 17 + 3.4, 0, ["ny"]);
}

/* ----- scrub: dark-earth regrowth, bramble and thorn, a fallen wall stump on some */
function scrub(b: Builder, v: number, detail: boolean): void {
  const r = rng(v * 11 + 5);
  const g = new THREE.IcosahedronGeometry(1, detail ? 1 : 0);
  const count = (detail ? 5 : 4) + (v % 3);
  for (let i = 0; i < count; i++) {
    const s = 1.2 + r() * 2.0;
    b.add("foliage", g.clone().scale(s * 1.4, s * (0.7 + r() * 0.5), s * 1.3), new THREE.Matrix4().makeRotationY(r() * 3).setPosition((r() - 0.5) * 9, s * 0.45, (r() - 0.5) * 9));
  }
  if (v % 4 === 1) solid(b, "roman-rubble", 5, 1.6 + 0.4, 0.8, 1, -0.4, 2, 0.4, ["ny"]);
  if (v % 4 === 2 && detail) {
    // rotted posts and a collapsed plank
    for (let i = 0; i < 4; i++) solid(b, "timber", 0.18, 0.5 + r() * 0.9, 0.18, -2 + i * 1.1, -0.1, 0.5 + r(), 0, ["ny"]);
    solid(b, "timber", 2.2, 0.1, 0.3, 0.5, 0.05, -1.4, 0.5, ["ny"]);
  }
  if (v % 4 === 3) b.add("earth", new THREE.IcosahedronGeometry(1, 0).scale(3.4, 0.5, 3.0), new THREE.Matrix4().setPosition(0, 0.1, 0));
}

/** One generator per fabric style named in zones.json. `detail` = benchmark-district quality. */
export const STYLES: Record<string, { variants: number; footprint: number; build: (b: Builder, v: number, detail: boolean) => void }> = {
  roundhouse: { variants: 4, footprint: 10, build: measured("roundhouse", roundhouse) },
  "roman-timber": { variants: ROMAN_STRIP.length, footprint: 15, build: measured("roman-timber", romanTimber) },
  "roman-masonry": { variants: 4, footprint: 20, build: measured("roman-masonry", romanMasonry) },
  saxon: { variants: 7, footprint: 12, build: measured("saxon", saxon) },
  medieval: {
    variants: MEDIEVAL.length, footprint: 13,
    build: measured("medieval", (b, v, detail) => row(b, MEDIEVAL[v % MEDIEVAL.length], detail, v * 17 + 3)),
  },
  tudor: {
    variants: TUDOR.length, footprint: 13,
    build: measured("tudor", (b, v, detail) => row(b, TUDOR[v % TUDOR.length], detail, v * 23 + 5)),
  },
  "parish-church": { variants: 4, footprint: 26, build: measured("parish-church", parishChurch) },
  mansion: { variants: 4, footprint: 55, build: measured("mansion", mansion) },
  scrub: { variants: 4, footprint: 10, build: measured("scrub", scrub) },
};

/* ------------------------------------------------------------------ single houses for street frontages */

/**
 * Street-frontage variants for the benchmark district, where houses stand in continuous rows along the
 * streets of data/locations/<site>/streets.json (see street/plots.ts). Each is ONE house, centred on the
 * origin with its street front (ground storey) at z = +front; the placer scales it along x to fill its
 * plot exactly so party walls touch. Three levels of detail: 0 = near (rich), 1 = district, 2 = overview.
 * Generic designs: none represents a recorded building.
 */
export interface StreetVariant { w: number; front: number; back: number; /** Relative frequency (default 1). */ weight?: number; /** No shop, sign or cellar: may stand as a rear tenement. */ plain?: boolean }
export interface StreetStyle {
  variants: StreetVariant[];
  /** Plot widths drawn for this style: [min, max] (m). */
  plot: [number, number];
  /** Whole 24 m lots (large buildings) instead of narrow plots. */
  lot?: boolean;
  /** Whether level 0 differs from level 1. */
  rich: boolean;
  /** Alternate designs per variant on the same footprint (build them as altVariant(v, 1..n)). */
  alts?: number[];
  build: (b: Builder, v: number, lod: 0 | 1 | 2) => void;
}

type RowSpec = Spec & { sign?: number; cellar?: boolean; pentice?: boolean; weight?: number };

const MEDIEVAL_ROW: RowSpec[] = [
  { w: 5.2, d: 9, storeys: 2, wall: "frame", roof: "tile-old", jetty: 0.42, gableFront: true, glazed: false, shop: true, pitch: 1.15, sign: 0, pentice: true },
  { w: 6.0, d: 9, storeys: 3, wall: "frame-ochre", roof: "tile-old", jetty: 0.42, gableFront: true, glazed: false, pitch: 1.15, cellar: true },
  { w: 5.6, d: 8, storeys: 2, wall: "frame-grey", roof: "tile-old", jetty: 0.35, gableFront: false, glazed: false, shop: true, pitch: 0.95, sign: 1 },
  { w: 7.4, d: 10, storeys: 3, wall: "frame-ochre", roof: "tile-old", jetty: 0.45, gableFront: true, glazed: false, shop: true, pitch: 1.1, rear: "range", sign: 6 },
  { w: 4.6, d: 8, storeys: 2, wall: "daub", roof: "thatch-old", jetty: 0.3, gableFront: true, glazed: false, pitch: 1.2, rear: "lean" },
  { w: 6.6, d: 8.5, storeys: 2, wall: "frame-rose", roof: "tile-old", jetty: 0.4, gableFront: false, glazed: false, pitch: 1.0, rear: "range", cellar: true },
  { w: 5.4, d: 9, storeys: 3, wall: "frame-grey", roof: "tile-old", jetty: 0.4, gableFront: true, glazed: false, pitch: 1.2, shop: true, sign: 4 },
  { w: 8.2, d: 7.5, storeys: 2, wall: "frame-dark", roof: "thatch-old", jetty: 0.3, gableFront: false, glazed: false, pitch: 1.15, rear: "lean" },
  { w: 4.8, d: 8.5, storeys: 2, wall: "plaster", roof: "tile-old", jetty: 0.35, gableFront: true, glazed: false, pitch: 1.2, shop: true },
];

const TUDOR_ROW: RowSpec[] = [
  { w: 5.6, d: 9.5, storeys: 3, wall: "frame", roof: "tile", jetty: 0.5, gableFront: true, chimney: true, shop: true, pitch: 1.1, sign: 2, cellar: true },
  { w: 6.2, d: 9.5, storeys: 3, wall: "frame-ochre", roof: "tile-old", jetty: 0.5, gableFront: true, chimney: true, oriels: 1, pitch: 1.1 },
  { w: 6.4, d: 9, storeys: 3, wall: "frame-rose", roof: "tile", jetty: 0.45, gableFront: false, chimney: true, dormers: 1, shop: true, pitch: 0.9, sign: 3, pentice: true },
  { w: 6.0, d: 9, storeys: 3, wall: "frame", roof: "tile-old", jetty: 0.45, gableFront: false, chimney: true, dormers: 2, oriels: 1, pitch: 0.9 },
  { w: 7.8, d: 9.5, storeys: 3, wall: "brick", roof: "tile", jetty: 0, gableFront: true, chimney: true, stacks: 2, pitch: 0.95, glazed: true, rear: "lean", weight: 0.15 },
  { w: 5.2, d: 9, storeys: 4, wall: "frame-ochre", roof: "tile-old", jetty: 0.5, gableFront: true, chimney: true, oriels: 1, pitch: 1.1, sign: 5 },
  { w: 5.6, d: 9, storeys: 3, wall: "frame-dark", roof: "tile", jetty: 0.5, gableFront: true, chimney: true, shop: true, pitch: 1.1, glazed: false, sign: 7 },
  { w: 4.8, d: 8.5, storeys: 3, wall: "frame-grey", roof: "tile", jetty: 0.4, gableFront: false, chimney: true, dormers: 1, pitch: 0.95, cellar: true },
  { w: 8.4, d: 9.5, storeys: 3, wall: "frame", roof: "tile", jetty: 0.55, gableFront: true, chimney: true, shop: true, pitch: 1.1, rear: "lean", oriels: 1, sign: 0 },
  { w: 4.6, d: 8.5, storeys: 2, wall: "frame-rose", roof: "tile-old", jetty: 0.4, gableFront: true, glazed: false, pitch: 1.15, shop: true, pentice: true },
];

/**
 * Alternates per street variant: the same plot and footprint (w, d, rear range: placement does not change), built
 * differently above the plinth: another storey or one fewer, eaves or gable to the street, a steeper or flatter
 * roof, deeper jetties, another framing pattern, chimney shafts. The fabric picks one per plot, so a run of plots of
 * one width no longer repeats one house. Alternates never add a shop, sign or cellar (plain variants stay plain:
 * they may stand as rear tenements). Period rules hold: no chimneys before the Tudor rows, louvres only on tiled
 * chimneyless halls, glazing by the house rule (stack and three storeys) unless the base variant says.
 */
type Alt = Partial<Omit<RowSpec, "w" | "d" | "rear" | "shop" | "sign" | "cellar" | "weight">>;
const MEDIEVAL_ALTS: Alt[][] = [
  [{ storeys: 3, storeyH: 2.55, pitch: 1.25, design: "close", louvre: true }, { gableFront: false, pitch: 1.0, storeyH: 2.85, jetty: 0.5 }],
  [{ storeys: 2, storeyH: 2.95, pitch: 1.3, louvre: true }, { pitch: 0.95, jetty: 0.55, design: "small" }],
  [{ gableFront: true, pitch: 1.2, louvre: true }, { storeys: 3, storeyH: 2.55, design: "brace" }],
  [{ storeys: 2, storeyH: 3.0, gables: 2, pitch: 1.2 }, { gableFront: false, pitch: 0.9, louvre: true, design: "square" }],
  [{ storeys: 1, storeyH: 3.4, gableFront: false, hip: true, pitch: 1.3 }, { pitch: 1.4, jetty: 0 }],
  [{ gableFront: true, pitch: 1.15, louvre: true }, { storeys: 3, storeyH: 2.5, jetty: 0.5 }],
  [{ storeys: 2, storeyH: 2.9, louvre: true, design: "rail" }, { pitch: 1.0, jetty: 0.5 }],
  [{ storeys: 1, storeyH: 3.8, hip: true, pitch: 1.3 }, { gableFront: true, gables: 2, pitch: 1.3 }],
  [{ storeys: 3, storeyH: 2.5, pitch: 1.3 }, { gableFront: false, pitch: 1.0, wall: "frame-ochre" }],
];
const TUDOR_ALTS: Alt[][] = [
  [{ storeys: 4, storeyH: 2.55, shafts: 1, stackH: 1.4, design: "close" }, { gableFront: false, dormers: 1, pitch: 0.9, shafts: 3 }],
  [{ storeys: 4, storeyH: 2.5, jetty: 0.55, shafts: 3, stackBack: 0.35 }, { pitch: 1.3, storeyH: 2.85, shafts: 1, stackH: 1.5 }],
  [{ gableFront: true, pitch: 1.15, shafts: 1 }, { storeys: 4, storeyH: 2.5, dormers: 2, stackH: 1.4 }],
  [{ gableFront: true, pitch: 1.2, shafts: 3, stackBack: 0.1 }, { storeys: 2, storeyH: 3.0, pitch: 1.0 }],
  [{ gableFront: false, pitch: 0.9, dormers: 2, shafts: 3 }, { storeys: 4, storeyH: 2.6 }],
  [{ storeys: 3, storeyH: 2.9, pitch: 1.25, shafts: 1 }, { jetty: 0.6, design: "brace", stackH: 1.5 }],
  [{ storeys: 4, storeyH: 2.5, shafts: 1 }, { gableFront: false, dormers: 1, pitch: 0.95 }],
  [{ gableFront: true, pitch: 1.25, shafts: 1, stackH: 1.4 }, { storeys: 4, storeyH: 2.45, jetty: 0.5 }],
  [{ gables: 2, pitch: 1.15, stacks: 2, shafts: 1 }, { storeys: 4, storeyH: 2.55, shafts: 3 }],
  [{ storeys: 3, storeyH: 2.55, chimney: true, shafts: 1 }, { pitch: 1.35, louvre: true }],
];

/** Street variant number for base variant v and alternate a (0 = the base design). */
export const altVariant = (v: number, a: number) => v + 1000 * a;

function rowStyle(specs: RowSpec[], seed: number, alts: Alt[][] = []): StreetStyle {
  return {
    variants: specs.map((s) => ({ w: s.w, front: s.d / 2, back: s.d / 2 + (s.rear === "range" ? 4.6 : s.rear === "lean" ? 2.3 : 0), weight: s.weight, plain: !s.shop && s.sign === undefined && !s.cellar })),
    alts: specs.map((_, i) => alts[i]?.length ?? 0),
    plot: [4.3, 8.6],
    rich: true,
    build: (b, v, lod) => {
      const base = v % 1000, a = Math.floor(v / 1000);
      const s: RowSpec = { ...specs[base % specs.length], ...(a > 0 ? alts[base % specs.length]?.[a - 1] : undefined) };
      house(b, {
        pitch: 1.1, ...s, sides: [true, true], sideJetty: false, endOver: s.gableFront ? undefined : 0.04,
        detail: lod <= 1, rich: lod === 0, seed: seed + base * 11 + a * 5,
      });
    },
  };
}

function measuredStreet(name: string, st: StreetStyle): StreetStyle {
  const inner = measured(`street:${name}`, (b, v, detail) => st.build(b, v, detail ? 1 : 2));
  return {
    ...st,
    build: (b, v, lod) => {
      if (lod === 0) measured(`street:${name}:near`, (bb, vv) => st.build(bb, vv, 0))(b, v, true);
      else inner(b, v, lod === 1);
    },
  };
}

export const STREET_STYLES: Record<string, StreetStyle> = {
  medieval: measuredStreet("medieval", rowStyle(MEDIEVAL_ROW, 401, MEDIEVAL_ALTS)),
  tudor: measuredStreet("tudor", rowStyle(TUDOR_ROW, 503, TUDOR_ALTS)),
  "roman-timber": measuredStreet("roman-timber", {
    variants: ROMAN_STRIP.map((P) => ({ w: P.w, front: P.d / 2, back: P.d / 2 + 3 })),
    plot: [4.4, 7.2], rich: false,
    build: (b, v, lod) => romanTimber(b, v, lod <= 1),
  }),
  saxon: measuredStreet("saxon", {
    variants: [0, 1, 2, 3, 4, 5, 6].map((v) => {
      const k = [[11.5, 5.6], [10, 5.2], [14.5, 6.2], [3.8, 3.0], [7.2, 4.6], [9.5, 5.5], [12.5, 6.4]][v];
      return { w: k[0] + (v === 0 || v === 6 ? 4.8 : 0), front: k[1] / 2, back: k[1] / 2 + 2 };
    }),
    plot: [6, 17], rich: false,
    build: (b, v, lod) => saxon(b, v, lod <= 1),
  }),
  "roman-masonry": measuredStreet("roman-masonry", {
    variants: [{ w: 17, front: 10.4, back: 7.6 }, { w: 20, front: 10.4, back: 7.6 }, { w: 12, front: 3.9, back: 7.6 }, { w: 22, front: 2.1, back: 7.6 }],
    plot: [12, 24], lot: true, rich: false,
    build: (b, v, lod) => romanMasonry(b, v, lod <= 1),
  }),
};
