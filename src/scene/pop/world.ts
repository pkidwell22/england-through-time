import * as THREE from "three";
import type { Dataset, Phase } from "@/lib/types";
import { hash2, pointSegment } from "@/lib/geo";
import { instanceLife, phaseStatus, type PhaseStatus } from "@/lib/lifecycle";
import type { StaticSample, TerrainModel } from "@/lib/terrain";
import { cutAtInlets, waterfrontLine } from "../waterline";
import { histToT, tToHist } from "@/lib/years";
import type { ExtraContext } from "../extras";
import type { FabricLayer, PlacedHouse } from "../fabric";
import { STYLES } from "../houses";
import type { LandmarkLayer } from "../landmarks";
import type { MotionMesh } from "./motion";

/**
 * Where and when the illustrative populace stands and walks. Nothing here is a claim about real
 * people: the walkers' paths are the streets of the generic fabric lattice, the dated roads, the
 * bridge roadway, the quays and wharves and the open plaza of the forum, and their numbers follow
 * the same dated zone activity that raises the houses.
 */

const TS = 192;
const PIECE = 44;
const sstep = (a: number, b: number, v: number): number => {
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
};
const mod = (a: number, n: number): number => ((a % n) + n) % n;
const pointInPoly = (x: number, z: number, p: [number, number][]): boolean => {
  let ins = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
};
/** A house as the fabric placed it, with its ground plan (slightly pulled in) for the walking-surface checks. */
interface HouseRec {
  h: PlacedHouse;
  poly: [number, number][];
  bb: [number, number, number, number];
  life: readonly [number, number, number, number];
  /** distance from the house origin to its front wall (local +z) */
  front: number;
}

interface Piece {
  id: number;
  cx: number;
  cz: number;
  x0: number;
  z0: number;
  dx: number;
  dz: number;
  L: number;
  /** ground samples (1 or 4); null when the height is fixed (deck, quay) */
  s: StaticSample[] | null;
  hs: Float32Array;
  yT: number;
  /** people slots at full presence */
  ns: number;
  lat: number;
  floor: number;
  zis: number[];
  zw: number[];
  ph: number;
  pk: number;
  life: [number, number, number, number] | null;
  th0: number;
  /** -1 none, else index into ANIMAL_KINDS: 0 cattle, 1 sheep, 2 horse, 3 pig, 4 dog, 5 hen, 6 pack-horse */
  ani: number;
  aniT: number;
  cartT: number;
  /** a single standing figure/animal group (L = 0) */
  idle: boolean;
  /** index of a battle stand-in that excludes figures here, or -1 */
  ex: number;
  /** a small standing group (2 or 3) at an idle point; 0 otherwise */
  grp: number;
  /** what the piece is: road, bridge, quay, waterfront, forum, or "" (lattice street, doorway figure) */
  kind: string;
  /** a single figure seated at a doorway */
  seat: boolean;
  /** years the piece exists (a span of a landmark built for its own ground, a dated street); null = always */
  win: [number, number] | null;
  /** years in which a house or a landmark stands on the piece: nobody walks there then */
  blocks: [number, number][] | null;
}

export interface House {
  x: number;
  y: number;
  z: number;
  life: [number, number, number, number];
  smoke: 0 | 1;
  roof: number;
  seed: number;
  ex: number;
}

/** a house door on the lattice: where street clutter may stand */
export interface Door {
  x: number;
  z: number;
  rot: number;
  fp: number;
  life: [number, number, number, number];
  seed: number;
  ex: number;
  style: string;
  lattice: boolean;
}
/** a place near the camera where a prop could stand (see props/clutter.ts) */
export interface PropSite {
  x: number;
  y: number;
  z: number;
  /** unit facing / along-the-street direction */
  fx: number;
  fz: number;
  kind: "door" | "yard" | "quay" | "wharf" | "bridge" | "forum";
  seed: number;
  /** only small items (the roadway is narrow) */
  small: boolean;
}

interface Tile {
  pieces: Piece[];
  houses: House[];
  doors: Door[];
}

interface ZInfo {
  zi: number;
  zone: Dataset["zones"][number];
  zg: FabricLayer["zoneGeoms"][number];
  cos: number;
  sin: number;
  th: number;
  grid: boolean;
  yp: ReturnType<TerrainModel["yearParams"]>;
  people: boolean;
  livestock: boolean;
  smoke: -1 | 0 | 1;
  roof: number;
}

export interface Caps {
  people: number;
  animals: number;
  carts: number;
  smoke: number;
  radius: number;
  /** 0..1 scale on how many people/animals a piece may carry */
  density: number;
  /** cap on tiles generated per update */
  tilesPerStep: number;
}

export interface Meshes {
  /** one mesh per body type */
  people: MotionMesh[];
  seated: MotionMesh;
  /** indexed like ANIMAL_KINDS */
  ani: MotionMesh[];
  cart: MotionMesh;
}

export interface SmokeSink {
  begin(): void;
  add(x: number, y: number, z: number, type: number, seed: number, strength: number): boolean;
  commit(): void;
}

/** earthy, undyed-to-muted dyes: a palette, not a costume claim */
const CLOTH = ["#8a7a60", "#6b5a43", "#9a5a3c", "#b08a3a", "#5f6b45", "#56606b", "#7a3b34", "#a89c86", "#4d4339", "#7d6f58", "#6a5d4a"].map((c) => new THREE.Color(c));
const CATTLE = ["#5a3b28", "#7a5a3c", "#2b2420", "#c8bfae", "#8a6a4a", "#4a3223"].map((c) => new THREE.Color(c));
const PIG = ["#d9b4a0", "#c49a86", "#8a6a58", "#3b2e28", "#e0c4b0"].map((c) => new THREE.Color(c));
const DOG = ["#6a4a2e", "#2b2420", "#a88a5e", "#8a8a84", "#c8b890"].map((c) => new THREE.Color(c));
const HEN = ["#8a5a34", "#d8cdb8", "#4a3a2c", "#a8743c", "#c8a070"].map((c) => new THREE.Color(c));
/** animals met per slot, spacing between them (m), and the walking pace multiplier */
const ANI_N = [2, 4, 1, 2, 1, 3, 2];
const ANI_SP = [1.1, 0.6, 0, 0.7, 0, 0.35, 0];
const ANI_SC = [0.95, 0.95, 1, 1, 1, 1, 1];
const bodyOf = (u: number): number => (u < 0.3 ? 0 : u < 0.56 ? 1 : u < 0.68 ? 2 : u < 0.8 ? 3 : u < 0.9 ? 4 : 5);
const BODY_PACE = [1, 0.95, 1.08, 0.88, 0.85, 0.62];
const SHEEP = ["#d8d2c2", "#c4bba8", "#a39a88", "#3b342c", "#cfc7b4"].map((c) => new THREE.Color(c));
const HORSE = ["#5b3a24", "#3c2a1e", "#8a6a48", "#9a9a96", "#2a2420", "#6e4a2c"].map((c) => new THREE.Color(c));

const ANI_PAL: THREE.Color[][] = [CATTLE, SHEEP, HORSE, PIG, DOG, HEN, HORSE];
const hh = (id: number, i: number, k: number): number => hash2(id * 131 + i * 17 + k * 101 + 7, id * 7 + k * 13 + i);

/** Species the settlement could not yet have in Britain are hidden before their arrival (hens: Iron Age; horses: Bronze Age). */
function yearOk(kind: number, hist: number): boolean {
  if (kind === 5) return hist >= -300;
  if (kind === 2 || kind === 6) return hist >= -1500;
  return true;
}

export class PopWorld {
  private terrain: TerrainModel;
  private fabric: FabricLayer;
  private landmarks: LandmarkLayer;
  private ds: Dataset;
  private Z: ZInfo[] = [];
  private tiles = new Map<number, Tile>();
  private statics = new Map<number, Piece[]>();
  private keys = new Map<string, Piece>();
  private phases: { phase: Phase; id: string }[] = [];
  private troops: { x: number; z: number; t0: number; t1: number }[] = [];
  private district: { xMin: number; xMax: number; zMin: number; zMax: number } | null;
  private nextId = 1;
  /** villages and hamlets (few fabric instances) get a small share of a city's street life */
  private k: number;
  private lastT = NaN;
  private lastTime = -1;
  private lastFocus = new THREE.Vector3(1e9, 0, 1e9);
  private pending = true;
  private zact: Float32Array;
  private phf: Float32Array;
  private dir = new THREE.Vector3();
  private focus = new THREE.Vector3();
  /** The fabric's placed houses by populace tile, and by 16 m cell (for walking-surface checks). */
  private houseTiles = new Map<number, HouseRec[]>();
  private houseCells = new Map<number, HouseRec[]>();
  stats = { people: 0, animals: 0, carts: 0, smoke: 0, tiles: 0, pieces: 0, ms: 0 };

  constructor(ctx: ExtraContext, private caps: Caps, private density: number) {
    this.ds = ctx.ds;
    this.terrain = ctx.terrain;
    this.fabric = ctx.fabric;
    this.landmarks = ctx.landmarks;
    this.district = ctx.ds.site.district?.bounds ?? null;
    this.k = Math.min(1, Math.max(0.2, Math.sqrt(ctx.fabric.instanceCount / 6000)));
    const terrain = this.terrain;
    // zones
    this.fabric.zoneGeoms.forEach((zg, zi) => {
      const zone = zg.zone;
      const style = zone.style;
      const tMid = zone.decline ? (histToT(zg.grow[1]) + histToT(zone.decline[0])) / 2 : histToT(zg.grow[1]);
      const gb = zone.gridBearing;
      const th = gb == null ? 0 : Math.PI / 2 - (gb * Math.PI) / 180;
      const people = !!STYLES[style] && style !== "scrub" && style !== "parish-church";
      let roof = 7;
      let smoke: ZInfo["smoke"] = -1;
      if (people) {
        const R: Record<string, number> = { roundhouse: 5.4, "roman-timber": 4.8, "roman-masonry": 6.4, saxon: 5, medieval: 8.6, tudor: 10.8, mansion: 11.5 };
        roof = R[style] ?? 8;
        // louvre / ridge smoke from open-hearth roofs; a thin chimney column once the style is a chimneyed one
        smoke = style === "tudor" || style === "mansion" ? 1 : 0;
      }
      this.Z.push({
        zi, zone, zg, cos: Math.cos(th), sin: Math.sin(th), th, grid: gb != null && zone.spacing < 40, yp: terrain.yearParams(tMid),
        people, livestock: style === "roundhouse" || style === "saxon", smoke, roof,
      });
    });
    this.zact = new Float32Array(this.Z.length);
    // the houses the fabric actually placed: doors, hearth smoke and figures belong to these, nowhere else
    for (const h of this.fabric.houses) {
      const box = h.box ?? [-4, 4, -1, 6, -4, 4];
      let poly: [number, number][];
      if (h.rect) poly = h.rect.map(([x, z]) => [x, z] as [number, number]);
      else {
        const k = h.scale, kx = h.scale * (h.sx ?? 1), c = Math.cos(h.rot), sn = Math.sin(h.rot);
        poly = [[box[0] * kx, box[4] * k], [box[1] * kx, box[4] * k], [box[1] * kx, box[5] * k], [box[0] * kx, box[5] * k]].map(([lx, lz]) => [h.x + lx * c + lz * sn, h.z - lx * sn + lz * c] as [number, number]);
      }
      // walkers may brush a wall (eaves, jetties): test against the plan pulled in a little
      const cx = poly.reduce((a, q) => a + q[0], 0) / 4, cz = poly.reduce((a, q) => a + q[1], 0) / 4;
      poly = poly.map(([x, z]) => { const l = Math.hypot(x - cx, z - cz) || 1; const f = Math.max(0.05, (l - 0.45) / l); return [cx + (x - cx) * f, cz + (z - cz) * f] as [number, number]; });
      const rec: HouseRec = { h, poly, bb: [Math.min(...poly.map((q) => q[0])), Math.min(...poly.map((q) => q[1])), Math.max(...poly.map((q) => q[0])), Math.max(...poly.map((q) => q[1]))], life: h.life, front: box[5] * h.scale };
      const tk = this.tileKey(Math.floor(h.x / TS), Math.floor(h.z / TS));
      let l = this.houseTiles.get(tk);
      if (!l) this.houseTiles.set(tk, (l = []));
      l.push(rec);
      for (let i = Math.floor(rec.bb[0] / 16); i <= Math.floor(rec.bb[2] / 16); i++)
        for (let j = Math.floor(rec.bb[1] / 16); j <= Math.floor(rec.bb[3] / 16); j++) {
          const k = i * 65536 + j;
          let c = this.houseCells.get(k);
          if (!c) this.houseCells.set(k, (c = []));
          c.push(rec);
        }
    }
    // battle stand-ins keep clear of ambient figures
    for (const lm of this.ds.landmarks) {
      for (const p of lm.phases) {
        if (p.model.kind !== "troops") continue;
        const [x, z] = terrain.proj.toLocal(lm.lat, lm.lon);
        const t0 = histToT(p.from);
        const t1 = p.to != null ? Math.max(histToT(p.to), t0 + 1) : 1e9;
        this.troops.push({ x, z, t0, t1 });
      }
    }
    this.buildStatics();
    this.phf = new Float32Array(this.phases.length);
  }

  // ------------------------------------------------------------------------------- helpers
  private inDistrict(x: number, z: number): boolean {
    const d = this.district;
    return !!d && x > d.xMin && x < d.xMax && z > d.zMin && z < d.zMax;
  }
  private tileKey(tx: number, tz: number): number {
    return (tx + 4096) * 8192 + (tz + 4096);
  }
  private troopIndex(x: number, z: number): number {
    for (let i = 0; i < this.troops.length; i++) if ((x - this.troops[i].x) ** 2 + (z - this.troops[i].z) ** 2 < 230 * 230) return i;
    return -1;
  }
  private zonesAt(x: number, z: number, into: number[], w: number[]): void {
    for (const Z of this.Z) {
      if (!Z.people) continue;
      const b = Z.zg.bbox;
      if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
      if (!Z.zg.contains(x, z)) continue;
      into.push(Z.zi);
      w.push(0.35 + 0.65 * Z.zg.weight(x, z));
    }
  }
  private sample(x: number, z: number): StaticSample {
    return this.terrain.staticSample(x, z);
  }
  private newPiece(x0: number, z0: number, x1: number, z1: number): Piece {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const id = this.nextId++;
    return {
      id, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, x0, z0, dx: L > 1e-6 ? (x1 - x0) / L : 1, dz: L > 1e-6 ? (z1 - z0) / L : 0, L,
      s: null, hs: new Float32Array(4), yT: -1e9, ns: 1, lat: 0, floor: 0, zis: [], zw: [], ph: -1, pk: 1, life: null, th0: 0.5,
      ani: -1, aniT: 2, cartT: 2, idle: false, ex: -1, grp: 0, seat: false, kind: "", win: null, blocks: null,
    };
  }

  /**
   * The years in which something solid stands on a piece's walking surface: a house of the fabric (as placed, with
   * its own life) or a landmark's ground plan. Fixed decks (bridge, quay, wharf) are only checked against houses.
   */
  private blockPiece(P: Piece, own: string | null): void {
    const pts: [number, number][] = [];
    if (P.idle || P.L < 1) pts.push([P.x0, P.z0]);
    else {
      const n = Math.max(1, Math.ceil(P.L / 5));
      for (let k = 0; k <= n; k++) for (const lat of P.lat > 0.5 ? [-P.lat * 0.9, 0, P.lat * 0.9] : [0]) pts.push([P.x0 + P.dx * P.L * (k / n) + P.dz * lat, P.z0 + P.dz * P.L * (k / n) - P.dx * lat]);
    }
    const out: [number, number][] = [];
    for (const [x, z] of pts) {
      for (const h of this.houseAt(x, z)) out.push([h.life[0], h.life[3]]);
      if (P.kind === "bridge") continue;
      for (const sd of this.landmarks.solids) {
        if (own && sd.id.startsWith(own + "#")) continue;
        if (x < sd.bbox[0] || x > sd.bbox[2] || z < sd.bbox[1] || z > sd.bbox[3]) continue;
        if (pointInPoly(x, z, sd.poly)) out.push([sd.t0, sd.t1]);
      }
    }
    if (!out.length) return;
    out.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const w of out) {
      const l = merged[merged.length - 1];
      if (l && w[0] <= l[1]) l[1] = Math.max(l[1], w[1]);
      else merged.push([w[0], w[1]]);
    }
    P.blocks = merged;
  }

  /** Is (x, z) clear of every house standing at t and (unless on a bridge deck) every landmark plan but its own? */
  private free(x: number, z: number, t: number, own: string | null, deck: boolean): boolean {
    for (const h of this.houseAt(x, z)) if (t > h.life[0] - 0.5 && t < h.life[3] + 0.5) return false;
    if (deck) return true;
    for (const sd of this.landmarks.solids) {
      if (t < sd.t0 || t >= sd.t1 || (own && sd.id.startsWith(own + "#"))) continue;
      if (x < sd.bbox[0] || x > sd.bbox[2] || z < sd.bbox[1] || z > sd.bbox[3]) continue;
      if (pointInPoly(x, z, sd.poly)) return false;
    }
    return true;
  }

  /** Placed houses (any year) whose ground plan contains (x, z). */
  private houseAt(x: number, z: number): HouseRec[] {
    const out: HouseRec[] = [];
    for (const h of this.houseCells.get(this.cellKey(x, z)) ?? []) if (x >= h.bb[0] && x <= h.bb[2] && z >= h.bb[1] && z <= h.bb[3] && pointInPoly(x, z, h.poly)) out.push(h);
    return out;
  }
  private cellKey(x: number, z: number): number {
    return Math.floor(x / 16) * 65536 + Math.floor(z / 16);
  }
  /** livestock and carts on a path piece, sparse */
  private livestock(P: Piece, cartOk = true): void {
    const a = hh(P.id, 0, 91), b = hh(P.id, 1, 92), c = hh(P.id, 2, 93);
    if (a < 0.1 && cartOk && P.L >= 28) P.cartT = 0.4 + 0.55 * b;
    else if (a < 0.4) {
      const d = hh(P.id, 3, 94);
      P.ani = c < 0.2 ? 0 : c < 0.38 ? 1 : c < 0.52 ? (P.ph >= 0 && P.L >= 28 && d < 0.55 ? 6 : 2) : c < 0.68 ? 3 : c < 0.86 ? 4 : 5;
      P.aniT = 0.15 + 0.6 * b;
    }
  }

  // ------------------------------------------------------------------------------- statics
  /** While building the statics: the span of years and the landmark the next pieces belong to. */
  private curWin: [number, number] | null = null;
  private curOwn: string | null = null;
  private addStatic(P: Piece): void {
    if (this.curWin && !P.win) P.win = this.curWin;
    this.blockPiece(P, this.curOwn);
    const k = this.tileKey(Math.floor(P.cx / TS), Math.floor(P.cz / TS));
    let l = this.statics.get(k);
    if (!l) this.statics.set(k, (l = []));
    P.ex = this.troopIndex(P.cx, P.cz);
    l.push(P);
  }

  private buildStatics(): void {
    const terrain = this.terrain;
    const proj = terrain.proj;
    const num = (v: unknown, d: number): number => (typeof v === "number" && isFinite(v) ? v : d);
    const walkPieces = (pts: [number, number][], maxLen: number, fn: (a: [number, number], b: [number, number]) => void): void => {
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.ceil(len / maxLen));
        for (let k = 0; k < n; k++) fn([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n], [ax + ((bx - ax) * (k + 1)) / n, az + ((bz - az) * (k + 1)) / n]);
      }
    };
    for (const lm of this.ds.landmarks) {
      const [lx, lz] = proj.toLocal(lm.lat, lm.lon);
      const path = (lm.path ?? []).map(([la, lo]) => proj.toLocal(la, lo)) as [number, number][];
      lm.phases.forEach((phase, index) => {
        const kind = phase.model.kind;
        const mm = phase.model as Record<string, unknown>;
        const tRep = histToT(phase.built ?? phase.from) + 3;
        // a landmark rebuilt for successive spans of years (its ground moved) has walkers on each copy in turn
        const spans = this.landmarks.spans.get(`${lm.id}#${index}`) ?? [{ win: [-Infinity, Infinity] as [number, number], tBuild: tRep }];
        let phI = -1;
        const phIdx = (): number => {
          if (phI < 0) {
            this.phases.push({ phase, id: lm.id });
            phI = this.phases.length - 1;
          }
          return phI;
        };
        this.curOwn = lm.id;
        spans.forEach((span, si) => {
        this.curWin = spans.length > 1 ? span.win : null;
        const yp = terrain.yearParams(span.tBuild);
        const ground = (x: number, z: number): number => terrain.heightFrom(terrain.staticSample(x, z), yp);
        if (kind === "road") {
          // a road's walkers take the ground of each year themselves: one set for all spans
          if (si > 0) return;
          this.curWin = null;
          const own = Array.isArray(mm.path) ? (mm.path as [number, number][]).map(([la, lo]) => proj.toLocal(la, lo)) : path;
          if (own.length < 2) return;
          const width = num(mm.width, 6);
          const ph = phIdx();
          walkPieces(own, PIECE, (a, b) => {
            const P = this.newPiece(a[0], a[1], b[0], b[1]);
            if (P.L < 6) return;
            P.s = [0, 1 / 3, 2 / 3, 1].map((f) => this.sample(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f));
            P.ns = Math.max(2, Math.round(P.L / 11));
            P.lat = Math.max(1, width / 2 - 1.3);
            P.floor = 0.1;
            P.ph = ph;
            this.zonesAt(P.cx, P.cz, P.zis, P.zw);
            this.livestock(P);
            this.addStatic(P);
          });
        } else if (kind === "bridge" || kind === "stone-bridge") {
          if (path.length < 2) return;
          const stone = kind === "stone-bridge";
          const a = path[0], c = path[path.length - 1];
          const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
          const width = num(mm.width, 6), deck = num(mm.deck, stone ? 8 : 5), span = num(mm.span, 12);
          const datum = !stone && (!terrain.hasRiver || mm.datum === "ground") ? Math.max(ground(a[0], a[1]), ground(c[0], c[1])) : 0;
          const nseg = Math.max(2, Math.round(len / span));
          const yAt = (f: number): number => {
            if (stone) return deck + 0.27;
            const i = Math.min(nseg - 1, Math.floor(f * nseg));
            const edge = Math.min(i, nseg - 1 - i);
            const g = ground(a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f) - datum;
            return datum + (edge < 3 ? Math.max(g + 0.4, deck * (0.45 + edge * 0.2)) : deck) + 0.02;
          };
          const ph = phIdx();
          const n = Math.max(1, Math.ceil(len / PIECE));
          const ea: number[] = [], ew: number[] = [];
          this.zonesAt(a[0], a[1], ea, ew);
          this.zonesAt(c[0], c[1], ea, ew);
          for (let k = 0; k < n; k++) {
            const f0 = k / n, f1 = (k + 1) / n;
            const P = this.newPiece(a[0] + (c[0] - a[0]) * f0, a[1] + (c[1] - a[1]) * f0, a[0] + (c[0] - a[0]) * f1, a[1] + (c[1] - a[1]) * f1);
            [0, 1 / 3, 2 / 3, 1].forEach((q, j) => (P.hs[j] = yAt(f0 + (f1 - f0) * q)));
            P.yT = 1e9;
            P.ns = Math.max(2, Math.round(P.L / 7));
            P.kind = "bridge";
            P.lat = stone ? 1.15 : Math.max(0.8, width / 2 - 1);
            P.floor = 0.3;
            P.pk = stone ? 1 : 0.6;
            P.ph = ph;
            P.zis = ea.slice();
            P.zw = ew.slice();
            this.livestock(P);
            this.addStatic(P);
          }
        } else if (kind === "quay") {
          if (path.length < 2) return;
          const width = num(mm.width, 10);
          const ph = phIdx();
          for (let i = 1; i < path.length; i++) {
            const [ax, az] = path[i - 1], [bx, bz] = path[i];
            const len = Math.hypot(bx - ax, bz - az);
            const n = Math.max(1, Math.round(len / 12));
            const rot = -Math.atan2(bz - az, bx - ax);
            const cz = -width / 2 + 2;
            const pts: [number, number][] = [];
            for (let k = 0; k < n; k++) {
              const f = (k + 0.5) / n;
              const x = ax + (bx - ax) * f;
              let z = az + (bz - az) * f;
              let guard = 0;
              while (ground(x, z) > 0.4 && guard++ < 80) z += 2;
              pts.push([x + cz * Math.sin(rot), z + cz * Math.cos(rot)]);
            }
            for (let k = 0; k + 1 < pts.length; k += 3) {
              const e = Math.min(pts.length - 1, k + 3);
              if (e <= k) break;
              const P = this.newPiece(pts[k][0], pts[k][1], pts[e][0], pts[e][1]);
              if (P.L < 8) continue;
              P.hs.fill(1.82);
              P.yT = 1e9;
              P.ns = Math.max(2, Math.round(P.L / 6));
              P.kind = "quay";
              P.lat = Math.max(1, width / 2 - 1.6);
              P.floor = 0.3;
              P.ph = ph;
              this.zonesAt(P.cx, P.cz, P.zis, P.zw);
              this.livestock(P, false);
              this.addStatic(P);
            }
          }
        } else if (kind === "waterfront") {
          if (path.length < 2) return;
          const dir = num(mm.side, 1), top = num(mm.top, 1.9);
          // the same line the waterfront builder walls (waterline.ts): the wharf runs either side of an open dock
          const land = (x: number, z: number): number => terrain.landHeightFrom(terrain.staticSample(x, z), yp);
          const { runs } = cutAtInlets(waterfrontLine(path, dir, land), terrain.inletsOpen(yp));
          const ph = phIdx();
          for (const pts of runs) for (let k = 0; k + 1 < pts.length; k += 6) {
            const e = Math.min(pts.length - 1, k + 6);
            if (e <= k) break;
            const P = this.newPiece(pts[k][0], pts[k][1] - dir * 4.7, pts[e][0], pts[e][1] - dir * 4.7);
            if (P.L < 10) continue;
            P.hs.fill(top + 0.03);
            P.yT = 1e9;
            P.ns = Math.max(2, Math.round(P.L / 9));
            P.lat = 2.4;
            P.kind = "waterfront";
            P.floor = 0.22;
            P.pk = 0.85;
            P.ph = ph;
            this.zonesAt(P.cx, P.cz, P.zis, P.zw);
            this.livestock(P, false);
            this.addStatic(P);
          }
        } else if (kind === "forum") {
          const l = num(mm.l, 100), w = num(mm.w, 100), range = num(mm.range, 12);
          const bas = (mm.basilica as { w: number }) ?? { w: 30 };
          const th = Math.PI / 2 - ((lm.bearing ?? 90) * Math.PI) / 180;
          const c = Math.cos(th), s = Math.sin(th);
          const toW = (u: number, v: number): [number, number] => [lx + u * c + v * s, lz - u * s + v * c];
          const u0 = -l / 2 + range + 3, u1 = l / 2 - range - 3;
          const v0 = -w / 2 + bas.w + 3, v1 = w / 2 - range - 3;
          if (u1 - u0 < 16 || v1 - v0 < 10) return;
          const y = (terrain.hasRiver ? Math.max(0.6, ground(lx, lz)) : ground(lx, lz)) + 0.08;
          const ph = phIdx();
          const rows = Math.max(2, Math.min(5, Math.floor((v1 - v0) / 12)));
          for (let r = 0; r < rows; r++) {
            const v = v0 + ((r + 0.5) / rows) * (v1 - v0);
            const a = toW(u0, v), b = toW(u1, v);
            const P = this.newPiece(a[0], a[1], b[0], b[1]);
            P.hs.fill(y);
            P.yT = 1e9;
            P.ns = Math.max(2, Math.round(P.L / 9));
            P.lat = 3;
            P.kind = "forum";
            P.floor = 0.5;
            P.ph = ph;
            this.zonesAt(P.cx, P.cz, P.zis, P.zw);
            this.livestock(P, false);
            this.addStatic(P);
          }
          // knots of people standing and talking
          for (let i = 0; i < 9; i++) {
            const a = toW(u0 + hh(lm.id.length, i, 1) * (u1 - u0), v0 + hh(lm.id.length, i, 2) * (v1 - v0));
            const ang = hh(lm.id.length, i, 3) * Math.PI * 2;
            const P = this.newPiece(a[0], a[1], a[0] + Math.cos(ang), a[1] + Math.sin(ang));
            P.L = 0;
            P.idle = true;
            P.hs.fill(y);
            P.yT = 1e9;
            P.ns = 1;
            P.th0 = 0.1 + 0.6 * hh(P.id, 0, 5);
            P.floor = 0.5;
            P.ph = ph;
            this.zonesAt(P.cx, P.cz, P.zis, P.zw);
            this.addStatic(P);
          }
        }
        });
      });
    }
    this.curWin = null;
    this.curOwn = null;
    // the district's dated street network (streets.json): its walkers, for the years each street exists
    for (const st of this.fabric.streets ?? []) {
      walkPieces(st.pts, PIECE, (a, b) => {
        const P = this.newPiece(a[0], a[1], b[0], b[1]);
        if (P.L < 6) return;
        P.s = [0, 1 / 3, 2 / 3, 1].map((f) => this.sample(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f));
        P.ns = Math.max(2, Math.round(P.L / (st.rank === 0 ? 6 : st.rank === 1 ? 8 : 12)));
        P.lat = Math.max(0.5, st.width / 2 - 1.1);
        P.win = [st.t0, st.t1];
        this.zonesAt(P.cx, P.cz, P.zis, P.zw);
        if (st.rank <= 1) this.livestock(P, st.width >= 6);
        this.addStatic(P);
      });
    }
  }

  // ------------------------------------------------------------------------------- lattice tiles
  private genTile(tx: number, tz: number): Tile {
    const tile: Tile = { pieces: [], houses: [], doors: [] };
    const x0 = tx * TS, z0 = tz * TS, x1 = x0 + TS, z1 = z0 + TS;
    const terrain = this.terrain;
    const fps = this.landmarks.footprints, cors = this.landmarks.corridors;
    const dets = this.district ? [false, true] : [false];
    // ---- houses as the fabric placed them: chimney/hearth smoke and the odd figure at a door
    for (const rec of this.houseTiles.get(this.tileKey(tx, tz)) ?? []) {
      const hh0 = rec.h;
      const Z = this.Z[hh0.zone];
      if (!Z || !Z.people) continue;
      const { x, z, rot } = hh0;
      const life = hh0.life as [number, number, number, number];
      const fp = Math.max(4, rec.front * 2);
      const qx = Math.round(x * 3), qz = Math.round(z * 3);
      const hs = hash2(qx * 11 + 3, qz * 19 + 1), h3 = hash2(qx * 3 + 77, qz * 5 + 41);
      const ex = this.troopIndex(x, z);
      tile.doors.push({ x, z, rot, fp, life, seed: hs, ex, style: Z.zone.style, lattice: Z.grid || !!hh0.rect });
      const top = (hh0.box ? hh0.box[3] : Z.roof) * hh0.scale;
      if (Z.smoke >= 0 && hs < 0.62) tile.houses.push({ x, y: hh0.y, z, life, smoke: Z.smoke as 0 | 1, roof: Math.min(top, Z.roof * (0.88 + 0.24 * h3)) + (Z.smoke === 1 ? 1.2 : 0.2), seed: hs, ex });
      // a figure at the door
      const hp = hash2(qx * 5 + 17, qz * 3 + 29);
      if (hp < (Z.grid ? 0.17 : 0.2)) {
        const d = rec.front + 1.8, side = (hs - 0.5) * 3;
        const px = x + Math.sin(rot) * d + Math.cos(rot) * side, pz = z + Math.cos(rot) * d - Math.sin(rot) * side;
        const ps = terrain.staticSample(px, pz);
        if (terrain.dry(terrain.heightFrom(ps, Z.yp), 1.25)) {
          const P = this.newPiece(px, pz, px + Math.sin(rot), pz + Math.cos(rot));
          P.L = 0;
          P.idle = true;
          P.s = [ps];
          P.life = life;
          P.th0 = 0.1 + 0.6 * hash2(qx + 9, qz + 4);
          P.ex = ex;
          const hk = hash2(qx * 9 + 1, qz * 4 + 7);
          if (hk < 0.22) P.seat = true;
          else if (hk < 0.46) { P.grp = hs > 0.6 ? 3 : 2; P.ns = P.grp; }
          this.blockPiece(P, null);
          tile.pieces.push(P);
        }
      }
      // stock near a farmstead or a hall-and-yard house
      if (Z.livestock && hash2(qx * 13 + 2, qz * 7 + 8) < 0.45) {
        const ang = hash2(qx + 21, qz + 6) * Math.PI * 2, r = fp * 0.5 + 8 + hash2(qx + 33, qz + 2) * 9;
        const px = x + Math.cos(ang) * r, pz = z + Math.sin(ang) * r;
        const ps = terrain.staticSample(px, pz);
        if (terrain.dry(terrain.heightFrom(ps, Z.yp), 1.25)) {
          const P = this.newPiece(px, pz, px + Math.cos(ang + 1.3), pz + Math.sin(ang + 1.3));
          P.L = 0;
          P.idle = true;
          P.ns = 0;
          P.s = [ps];
          P.life = life;
          { const q = hash2(qx + 5, qz + 15); P.ani = q < 0.4 ? 0 : q < 0.7 ? 1 : q < 0.82 ? 3 : q < 0.92 ? 4 : 5; }
          P.aniT = 0.05;
          P.ex = ex;
          this.blockPiece(P, null);
          tile.pieces.push(P);
        }
      }
    }
    for (const Z of this.Z) {
      if (!Z.people) continue;
      const zg = Z.zg, zone = Z.zone;
      const b = zg.bbox;
      if (b[0] > x1 + 30 || b[2] < x0 - 30 || b[1] > z1 + 30 || b[3] < z0 - 30) continue;
      const style = STYLES[zone.style];
      const gb = zone.gridBearing;
      const band = zone.band ?? 0;
      const { cos, sin } = Z;
      for (const detail of dets) {
        const sp = detail && zone.spacing < 40 ? zone.spacing * 0.66 : zone.spacing;
        const fillK = detail ? 1 : this.density;
        const us: number[] = [], vs: number[] = [];
        for (const [cx, cz] of [[x0 - 20, z0 - 20], [x1 + 20, z0 - 20], [x0 - 20, z1 + 20], [x1 + 20, z1 + 20]]) {
          us.push(cx * cos - cz * sin);
          vs.push(cx * sin + cz * cos);
        }
        const iu0 = Math.floor(Math.min(...us) / sp) - 1, iu1 = Math.ceil(Math.max(...us) / sp) + 1;
        const iv0 = Math.floor(Math.min(...vs) / sp) - 1, iv1 = Math.ceil(Math.max(...vs) / sp) + 1;
        // ---- streets: the open lattice rows and columns of a gridded zone (in the district a zone on the street
        // network walks those streets instead: see buildStatics)
        if (Z.grid && !(detail && this.fabric.streetZones.has(Z.zi))) {
          for (const orient of [0, 1]) {
            const i0 = orient === 0 ? iu0 : iv0, i1 = orient === 0 ? iu1 : iv1;
            const along = orient === 0 ? vs : us;
            const k0 = Math.floor(Math.min(...along) / PIECE) - 1, k1 = Math.ceil(Math.max(...along) / PIECE) + 1;
            for (let idx = i0; idx <= i1; idx++) {
              if (orient === 0 ? mod(idx, 7) !== 3 : mod(idx, 5) !== 2) continue;
              for (let k = k0; k <= k1; k++) {
                const pt = (s: number): [number, number] => {
                  const u = orient === 0 ? idx * sp : s, v = orient === 0 ? s : idx * sp;
                  return [u * cos + v * sin, -u * sin + v * cos];
                };
                const m = pt((k + 0.5) * PIECE);
                if (m[0] < x0 || m[0] >= x1 || m[1] < z0 || m[1] >= z1) continue;
                const key = `${sp}|${gb}|${orient}|${idx}|${k}`;
                const have = this.keys.get(key);
                if (have) {
                  if (zg.contains(m[0], m[1]) && !have.zis.includes(Z.zi)) {
                    have.zis.push(Z.zi);
                    have.zw.push(0.35 + 0.65 * zg.weight(m[0], m[1]));
                  }
                  continue;
                }
                if (this.inDistrict(m[0], m[1]) !== detail) continue;
                const a = pt(k * PIECE), e = pt((k + 1) * PIECE);
                const q = [0, 1 / 3, 2 / 3, 1].map((f): [number, number] => [a[0] + (e[0] - a[0]) * f, a[1] + (e[1] - a[1]) * f]);
                if (!q.every((p) => zg.contains(p[0], p[1])) || zg.weight(m[0], m[1]) < 0.2) continue;
                const smps = q.map((p) => terrain.staticSample(p[0], p[1]));
                if (!smps.every((s) => terrain.dry(terrain.heightFrom(s, Z.yp), 1.1))) continue;
                let blocked = false;
                for (const f of fps) {
                  if (!(f.t1 > zg.t0 && f.t0 < zg.t1)) continue;
                  if (q.some((p) => (p[0] - f.x) ** 2 + (p[1] - f.z) ** 2 < f.r * f.r)) { blocked = true; break; }
                }
                if (!blocked)
                  for (const c of cors) {
                    if (!(c.t1 > zg.t0 && c.t0 < zg.t1)) continue;
                    for (let i = 1; i < c.path.length && !blocked; i++)
                      for (const p of q) if (pointSegment(p[0], p[1], c.path[i - 1][0], c.path[i - 1][1], c.path[i][0], c.path[i][1]).d < c.half) { blocked = true; break; }
                    if (blocked) break;
                  }
                if (blocked) continue;
                const P = this.newPiece(a[0], a[1], e[0], e[1]);
                P.s = smps;
                P.ns = 7;
                P.lat = 6.5;
                this.zonesAt(m[0], m[1], P.zis, P.zw);
                P.ex = this.troopIndex(m[0], m[1]);
                this.livestock(P);
                this.blockPiece(P, null);
                this.keys.set(key, P);
                tile.pieces.push(P);
              }
            }
          }
        }
      }
    }
    return tile;
  }

  // ------------------------------------------------------------------------------- prop sites
  private prepare(t: number): void {
    this.zoneActivity(t);
    for (let i = 0; i < this.phases.length; i++) {
      const st: PhaseStatus = phaseStatus(this.phases[i].phase, t);
      this.phf[i] = st.state === "intact" ? 1 : st.state === "construction" ? st.height : Math.max(0, Math.min(1, (st.height - 0.3) / 0.7));
    }
  }

  /**
   * Candidate places for street clutter within R of (cx, cz) at timeline value t: beside house doors, in
   * yards, along quays, wharves, the bridge roadway and the forum edge. Deterministic, sparse, on the
   * ground at that year (or the fixed deck / quay height). Generates a couple of missing tiles per call.
   */
  sitesNear(t: number, cx: number, cz: number, R: number, out: PropSite[]): boolean {
    this.prepare(t);
    const yp = this.terrain.yearParams(t);
    const river = this.terrain.hasRiver;
    const tx0 = Math.floor((cx - R) / TS), tx1 = Math.floor((cx + R) / TS), tz0 = Math.floor((cz - R) / TS), tz1 = Math.floor((cz + R) / TS);
    let made = 0, pendingTiles = false;
    const R2 = R * R;
    const dry = (y: number): boolean => !river || y >= 0.55;
    for (let tx = tx0; tx <= tx1; tx++)
      for (let tz = tz0; tz <= tz1; tz++) {
        const key = this.tileKey(tx, tz);
        let tile = this.tiles.get(key);
        if (!tile) {
          if (made >= 2) { pendingTiles = true; continue; }
          tile = this.genTile(tx, tz);
          this.tiles.set(key, tile);
          made++;
        }
        for (const D of tile.doors ?? []) {
          if ((D.x - cx) ** 2 + (D.z - cz) ** 2 > R2) continue;
          const l = D.life;
          if (t < l[1] - 3 || t > l[2] + 3) continue;
          if (D.ex >= 0) {
            const tr = this.troops[D.ex];
            if (t >= tr.t0 - 0.02 && t < tr.t1 + 0.02) continue;
          }
          const s = D.seed;
          const sn = Math.sin(D.rot), cs = Math.cos(D.rot);
          const rural = !D.lattice;
          // beside the door (one or two items), and in the yard of the looser, non-gridded houses
          const nDoor = s < 0.28 ? 2 : s < 0.62 ? 1 : 0;
          for (let k = 0; k < nDoor; k++) {
            const d = D.fp * 0.5 + 0.9 + 0.5 * hash2(D.seed * 977 + k, 3);
            const side = (k === 0 ? 1 : -1) * (0.9 + 1.6 * hash2(D.seed * 313 + k, 5)) * (hash2(D.seed * 71, 9) < 0.5 ? 1 : -1);
            const px = D.x + sn * d + cs * side, pz = D.z + cs * d - sn * side;
            const y = this.terrain.heightFrom(this.terrain.staticSample(px, pz), yp);
            if (!dry(y)) continue;
            if (!this.free(px, pz, t, null, false)) continue;
            out.push({ x: px, y, z: pz, fx: sn, fz: cs, kind: "door", seed: hash2(D.seed * 1511 + k * 17, 11), small: false });
          }
          if (rural || s > 0.8) {
            const nYard = rural ? (s < 0.5 ? 2 : 1) : 1;
            for (let k = 0; k < nYard; k++) {
              const a = hash2(D.seed * 421 + k, 13) * Math.PI * 2, r = D.fp * 0.5 + 2.5 + hash2(D.seed * 91 + k, 15) * 4;
              const px = D.x + Math.cos(a) * r, pz = D.z + Math.sin(a) * r;
              const y = this.terrain.heightFrom(this.terrain.staticSample(px, pz), yp);
              if (!dry(y)) continue;
              if (!this.free(px, pz, t, null, false)) continue;
              out.push({ x: px, y, z: pz, fx: Math.cos(a), fz: Math.sin(a), kind: "yard", seed: hash2(D.seed * 1913 + k * 29, 17), small: false });
            }
          }
        }
        const stat = this.statics.get(key);
        if (stat)
          for (const P of stat) {
            if (!P.kind || P.kind === "road" || P.idle) continue;
            if ((P.cx - cx) ** 2 + (P.cz - cz) ** 2 > (R + P.L) ** 2) continue;
            if (this.presence(P, t) < 0.45) continue;
            const slots = Math.max(1, Math.round(P.L / (P.kind === "bridge" ? 11 : P.kind === "forum" ? 16 : 10)));
            for (let k = 0; k < slots; k++) {
              const hk = hash2(P.id * 53 + k * 7, 21);
              if (hk > (P.kind === "bridge" ? 0.4 : P.kind === "forum" ? 0.3 : 0.55)) continue;
              const f = (k + 0.15 + 0.7 * hash2(P.id * 17 + k, 23)) / slots;
              const sd = P.L * f;
              const sg = hash2(P.id * 29 + k, 25) < 0.5 ? 1 : -1;
              const lat = P.kind === "bridge" ? sg * (P.pk === 1 ? 1.75 : P.lat + 0.5) : P.kind === "forum" ? (hash2(P.id + k, 27) - 0.5) * 2 * P.lat : sg * P.lat * (0.7 + 0.3 * hash2(P.id * 5 + k, 31));
              const x = P.x0 + P.dx * sd + P.dz * lat, z = P.z0 + P.dz * sd - P.dx * lat;
              if ((x - cx) ** 2 + (z - cz) ** 2 > R2) continue;
              const q = f * 3;
              const y = q < 1 ? P.hs[0] + (P.hs[1] - P.hs[0]) * q : q < 2 ? P.hs[1] + (P.hs[2] - P.hs[1]) * (q - 1) : P.hs[2] + (P.hs[3] - P.hs[2]) * (q - 2);
              if (!this.free(x, z, t, P.ph >= 0 ? this.phases[P.ph].id : null, P.kind === "bridge")) continue;
              out.push({ x, y, z, fx: P.dx, fz: P.dz, kind: P.kind === "bridge" ? "bridge" : P.kind === "forum" ? "forum" : P.kind === "quay" ? "quay" : "wharf", seed: hash2(P.id * 1999 + k * 37, 33), small: P.kind === "bridge" });
            }
          }
      }
    return pendingTiles;
  }

  // ------------------------------------------------------------------------------- selection
  private zoneActivity(t: number): void {
    for (const Z of this.Z) {
      if (!Z.people) { this.zact[Z.zi] = 0; continue; }
      const zone = Z.zone, zg = Z.zg;
      const g0 = histToT(zg.grow[0]), g1 = histToT(zg.grow[1]) + 1;
      let a = Math.min(1, Math.max(0, (t - g0) / Math.max(1, g1 - g0)));
      if (zone.decline) {
        const d0 = histToT(zone.decline[0]), d1 = histToT(zone.decline[1]) + 1;
        a *= 1 - Math.min(1, Math.max(0, (t - d0) / Math.max(1, d1 - d0)));
      }
      this.zact[Z.zi] = a * Math.min(1, zone.fill * 1.4);
    }
  }

  private presence(P: Piece, t: number): number {
    if (P.win && (t < P.win[0] || t >= P.win[1])) return 0;
    if (P.blocks) for (const [a, b] of P.blocks) if (t >= a - 0.5 && t < b + 0.5) return 0;
    let p: number;
    if (P.life) {
      const l = P.life;
      p = sstep(l[0], l[1], t) * (1 - sstep(l[2], l[3], t));
    } else {
      p = P.floor;
      for (let k = 0; k < P.zis.length; k++) {
        const a = this.zact[P.zis[k]] * P.zw[k];
        if (a > p) p = a;
      }
    }
    if (P.ph >= 0) p *= this.phf[P.ph];
    if (P.ex >= 0) {
      const tr = this.troops[P.ex];
      if (t >= tr.t0 - 0.02 && t < tr.t1 + 0.02) return 0;
    }
    return p * P.pk;
  }

  update(t: number, timeSec: number, camera: THREE.Camera, m: Meshes, smoke: SmokeSink | null): void {
    // tolerate a stale mesh set (hot reload between populace.ts and this file): nothing to draw into
    if (!Array.isArray(m.people) || !Array.isArray(m.ani) || !m.seated) return;
    const first = Number.isNaN(this.lastT);
    camera.getWorldDirection(this.dir);
    const cp = camera.position;
    let d = 400;
    if (this.dir.y < -0.03) d = THREE.MathUtils.clamp((cp.y - 3) / -this.dir.y, 25, 900);
    this.focus.copy(cp).addScaledVector(this.dir, d);
    const moved = Math.hypot(this.focus.x - this.lastFocus.x, this.focus.z - this.lastFocus.z);
    const dt = Math.abs(t - this.lastT);
    const due = timeSec - this.lastTime >= (this.pending ? 0.12 : 0.25);
    if (!first && !(due && (this.pending || moved > 8 || dt > 0.004 || timeSec - this.lastTime > 2))) return;
    const t0 = performance.now();
    this.lastT = t;
    this.lastTime = timeSec;
    this.lastFocus.copy(this.focus);

    const R = this.caps.radius, Rc = Math.min(200, R * 0.6);
    const fx = this.focus.x, fz = this.focus.z;
    // tiles in range: generate a few more each step, nearest first
    const tx0 = Math.floor((Math.min(fx, cp.x) - R) / TS), tx1 = Math.floor((Math.max(fx, cp.x) + R) / TS);
    const tz0 = Math.floor((Math.min(fz, cp.z) - R) / TS), tz1 = Math.floor((Math.max(fz, cp.z) + R) / TS);
    const keys: { key: number; tx: number; tz: number; d: number }[] = [];
    for (let tx = tx0; tx <= tx1; tx++)
      for (let tz = tz0; tz <= tz1; tz++) {
        const cx = (tx + 0.5) * TS, cz = (tz + 0.5) * TS;
        const df = Math.hypot(cx - fx, cz - fz) - TS * 0.75, dc = Math.hypot(cx - cp.x, cz - cp.z) - TS * 0.75;
        if (df > R && dc > Rc) continue;
        keys.push({ key: this.tileKey(tx, tz), tx, tz, d: Math.min(df, dc) });
      }
    keys.sort((a, b) => a.d - b.d);
    let made = 0;
    this.pending = false;
    for (const k of keys) {
      if (this.tiles.has(k.key)) continue;
      if (made >= this.caps.tilesPerStep) { this.pending = true; break; }
      this.tiles.set(k.key, this.genTile(k.tx, k.tz));
      made++;
    }
    const inRange = keys.map((k) => ({ tile: this.tiles.get(k.key), stat: this.statics.get(k.key) }));

    this.zoneActivity(t);
    for (let i = 0; i < this.phases.length; i++) {
      const st: PhaseStatus = phaseStatus(this.phases[i].phase, t);
      this.phf[i] = st.state === "intact" ? 1 : st.state === "construction" ? st.height : Math.max(0, Math.min(1, (st.height - 0.3) / 0.7));
    }
    const yp = this.terrain.yearParams(t);
    const river = this.terrain.hasRiver;

    // gather pieces and sort by distance to the nearer of focus / camera
    const cand: { P: Piece; d: number }[] = [];
    const houses: { H: House; d: number }[] = [];
    const take = (P: Piece): void => {
      const df = Math.hypot(P.cx - fx, P.cz - fz), dc = Math.hypot(P.cx - cp.x, P.cz - cp.z);
      if (df > R && dc > Rc) return;
      cand.push({ P, d: Math.min(df, dc * 1.4) });
    };
    for (const r of inRange) {
      if (r.stat) for (const P of r.stat) take(P);
      if (r.tile) {
        for (const P of r.tile.pieces) take(P);
        if (smoke) for (const H of r.tile.houses) {
          const df = Math.hypot(H.x - fx, H.z - fz), dc = Math.hypot(H.x - cp.x, H.z - cp.z);
          if (df < R * 1.2 || dc < Rc) houses.push({ H, d: Math.min(df, dc * 1.4) });
        }
      }
    }
    cand.sort((a, b) => a.d - b.d);
    for (const x of m.people) x.reset();
    m.seated.reset(); for (const x of m.ani) x.reset(); m.cart.reset();
    const hist = tToHist(t);
    const dens = this.caps.density * this.k;
    for (const { P } of cand) {
      if (m.people.every((x) => x.full) && m.ani.every((x) => x.full) && m.cart.full) break;
      let p = this.presence(P, t);
      if (p <= 0.004) continue;
      // heights at this year (decks and quays are fixed)
      if (P.s) {
        if (Math.abs(t - P.yT) > 2) {
          P.yT = t;
          if (P.s.length === 1) P.hs.fill(this.terrain.heightFrom(P.s[0], yp));
          else for (let i = 0; i < 4; i++) P.hs[i] = this.terrain.heightFrom(P.s[i], yp);
        }
        if (river && Math.min(P.hs[0], P.hs[1], P.hs[2], P.hs[3]) < 0.45) continue;
      }
      p = Math.min(1, p);
      const hs = P.hs;
      const y0 = hs[0] + 0.03, y1 = hs[1] + 0.03, y2 = hs[2] + 0.03, y3 = hs[3] + 0.03;
      // people
      if (P.seat) {
        const pres = sstep(P.th0 / dens, P.th0 / dens + 0.12, p);
        if (pres > 0.02) {
          const c = CLOTH[Math.floor(hh(P.id, 0, 5) * CLOTH.length)];
          const j = 0.85 + 0.3 * hh(P.id, 0, 6);
          m.seated.push(P.x0, P.z0, P.dx, P.dz, 0, hh(P.id, 0, 3), 0, 0, y0, y0, y0, y0, c.r * j, c.g * j, c.b * j, 0.95 + 0.1 * hh(P.id, 0, 8), 0, pres, hh(P.id, 0, 9));
        }
      } else if (P.idle && P.grp >= 2) {
        const base = hh(P.id, 0, 41) * 6.28;
        for (let i = 0; i < P.grp; i++) {
          const th = P.th0 + i * 0.03;
          const pres = sstep(th / dens, th / dens + 0.12, p);
          if (pres < 0.02) continue;
          const bt = bodyOf(hh(P.id, i, 12));
          if (bt === 4 && P.grp === 2 && i === 0) continue;
          const a = base + (i * 6.2832) / P.grp;
          const c = CLOTH[Math.floor(hh(P.id, i, 5) * CLOTH.length)];
          const j = 0.85 + 0.3 * hh(P.id, i, 6);
          const gown = bt === 1 ? 1 : hh(P.id, i, 7) < 0.42 ? 1 : 0;
          m.people[bt].push(P.x0 + Math.cos(a) * 0.55, P.z0 + Math.sin(a) * 0.55, -Math.cos(a) + (hh(P.id, i, 13) - 0.5) * 0.3, -Math.sin(a), 0, hh(P.id, i, 3), 0, 0, y0, y0, y0, y0, c.r * j, c.g * j, c.b * j, 0.94 + 0.12 * hh(P.id, i, 8), gown, pres, hh(P.id, i, 9));
        }
      } else if (!P.idle || P.ns > 0) {
        for (let i = 0; i < P.ns; i++) {
          const th = P.ns === 1 && P.life ? P.th0 : (i + 0.15 + 0.7 * hh(P.id, i, 1)) / P.ns;
          const pres = sstep(th / dens, th / dens + 0.12, p);
          if (pres < 0.02) continue;
          const moving = !P.idle && P.L >= 14 && hh(P.id, i, 2) < 0.86;
          const bt = bodyOf(hh(P.id, i, 12));
          const c = CLOTH[Math.floor(hh(P.id, i, 5) * CLOTH.length)];
          const j = 0.85 + 0.3 * hh(P.id, i, 6);
          const gown = bt === 1 ? 1 : hh(P.id, i, 7) < 0.42 ? 1 : 0;
          const sc = 0.94 + 0.12 * hh(P.id, i, 8);
          const skin = hh(P.id, i, 9);
          const mesh = m.people[bt];
          if (moving) {
            mesh.push(P.x0, P.z0, P.dx, P.dz, P.L, hh(P.id, i, 3), (0.55 + 0.55 * hh(P.id, i, 4)) * BODY_PACE[bt], (hh(P.id, i, 10) - 0.5) * 2 * P.lat, y0, y1, y2, y3, c.r * j, c.g * j, c.b * j, sc, gown, pres, skin);
          } else {
            // standing: at a point along the piece, facing any way (or the way the piece faces)
            const s = P.idle ? 0 : hh(P.id, i, 3) * P.L;
            const f = P.L > 0 ? s / P.L : 0;
            const y = f < 0.34 ? y0 + (y1 - y0) * f * 3 : f < 0.67 ? y1 + (y2 - y1) * (f * 3 - 1) : y2 + (y3 - y2) * (f * 3 - 2);
            const lat = P.idle ? 0 : (hh(P.id, i, 10) - 0.5) * 2 * P.lat;
            const ang = P.idle ? Math.atan2(P.dx, P.dz) + (hh(P.id, i, 11) - 0.5) * 0.6 : hh(P.id, i, 11) * Math.PI * 2;
            mesh.push(P.x0 + P.dx * s + P.dz * lat, P.z0 + P.dz * s - P.dx * lat, Math.sin(ang), Math.cos(ang), 0, hh(P.id, i, 3), 0, 0, y, y, y, y, c.r * j, c.g * j, c.b * j, sc, gown, pres, skin);
          }
        }
      }
      // livestock
      if (P.ani >= 0 && yearOk(P.ani, hist)) {
        const pres = sstep(P.aniT / dens, P.aniT / dens + 0.12, p);
        if (pres > 0.02) {
          const k = P.ani;
          const n = ANI_N[k];
          const mesh = m.ani[k];
          const pal = ANI_PAL[k];
          const moving = !P.idle && P.L >= 14 && hh(P.id, 0, 20) < 0.7;
          const ph0 = hh(P.id, 0, 21);
          for (let i = 0; i < n; i++) {
            const c = pal[Math.floor(hh(P.id, i + (k === 1 ? 0 : 3), 22) * pal.length)];
            const j = 0.9 + 0.2 * hh(P.id, i, 23);
            const sc = ANI_SC[k] * (0.92 + 0.16 * hh(P.id, i, 24));
            if (moving) {
              const along = k === 6 ? 2.6 : 0.5;
              const lat0 = k === 6 || k === 2 || k === 4 ? 0 : (i - (n - 1) / 2) * ANI_SP[k];
              mesh.push(P.x0, P.z0, P.dx, P.dz, P.L, ph0 - (i * along) / (2 * P.L), (k === 5 ? 0.35 : k === 4 ? 1.1 : 0.55) + 0.1 * hh(P.id, 0, 25), lat0 + (hh(P.id, 0, 26) - 0.5) * P.lat, y0, y1, y2, y3, c.r * j, c.g * j, c.b * j, sc, 0, pres, 0);
            } else {
              const s = P.idle ? 0 : hh(P.id, 0, 27) * P.L;
              const f = P.L > 0 ? s / P.L : 0;
              const y = (f < 0.34 ? y0 + (y1 - y0) * f * 3 : f < 0.67 ? y1 + (y2 - y1) * (f * 3 - 1) : y2 + (y3 - y2) * (f * 3 - 2));
              const a = hh(P.id, 0, 28) * 6.28 + i * 0.5;
              const sp = k === 5 ? 0.6 : 1.4;
              const ox = Math.cos(a + i * 2) * i * sp, oz = Math.sin(a + i * 2) * i * sp;
              const lat = P.idle ? 0 : (hh(P.id, 0, 26) - 0.5) * P.lat;
              mesh.push(P.x0 + P.dx * s + P.dz * lat + ox, P.z0 + P.dz * s - P.dx * lat + oz, Math.sin(a), Math.cos(a), 0, 0, 0, 0, y, y, y, y, c.r * j, c.g * j, c.b * j, sc, 1, pres, 0);
            }
          }
        }
      }
      if (P.cartT <= 1 && !P.idle && hist >= -1500) {
        const pres = sstep(P.cartT / dens, P.cartT / dens + 0.12, p);
        if (pres > 0.02) {
          const c = HORSE[Math.floor(hh(P.id, 0, 30) * HORSE.length)];
          m.cart.push(P.x0, P.z0, P.dx, P.dz, P.L, hh(P.id, 0, 31), 0.6, (hh(P.id, 0, 32) - 0.5) * Math.min(2, P.lat), y0, y1, y2, y3, c.r, c.g, c.b, 1, 0, pres, 0);
        }
      }
    }
    for (const x of m.people) x.commit();
    m.seated.commit(); for (const x of m.ani) x.commit(); m.cart.commit();

    let ns = 0;
    if (smoke) {
      smoke.begin();
      houses.sort((a, b) => a.d - b.d);
      for (const { H } of houses) {
        if (H.ex >= 0) {
          const tr = this.troops[H.ex];
          if (t >= tr.t0 - 0.02 && t < tr.t1 + 0.02) continue;
        }
        const l = H.life;
        const p = sstep(l[1] - 1, l[1] + 1, t) * (1 - sstep(l[2] - 0.5, l[2] + 0.3, t));
        if (p < 0.05) continue;
        if (!smoke.add(H.x, H.y + H.roof, H.z, H.smoke, H.seed, p * (0.45 + 0.55 * ((H.seed * 7.31) % 1)))) break;
        ns++;
      }
      smoke.commit();
    }
    this.stats = { people: m.people.reduce((q, x) => q + x.n, 0) + m.seated.n, animals: m.ani.reduce((q, x) => q + x.n, 0), carts: m.cart.n, smoke: ns, tiles: this.tiles.size, pieces: cand.length, ms: performance.now() - t0 };
  }
}
