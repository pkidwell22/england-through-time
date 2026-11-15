import * as THREE from "three";
import type { Dataset, Zone } from "@/lib/types";
import { hash2, noise2, pointInPolygon, pointSegment } from "@/lib/geo";
import { instanceLife } from "@/lib/lifecycle";
import type { TerrainModel } from "@/lib/terrain";
import { histToT, tToHist } from "@/lib/years";
import { Builder } from "./geom";
import { STREET_STYLES, STYLES, altVariant } from "./houses";
import { makeMaterial } from "./materials";
import { EVIDENCE_INDEX, patchLife } from "./life";
import type { LandmarkLayer } from "./landmarks";
import { distToPolyline, streetNetwork, type Street } from "./street/network";
import { placeAlongStreets } from "./street/plots";
import { registerStreetExtra } from "./street/lod";
import { LEGACY_PLACEMENT } from "./placementMode";
import { SHAPE, partsSince, shapeParts } from "./street/kit";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { HOUSE_FAR_BASE, HOUSE_MAX_ALT, HOUSE_NO_ALT, NO_SHADOW, fabricMaterialName, houseClassOf, houseDepthMaterial, patchHouse } from "./street/houseShader";

/** Styles drawn rigid (no lean, sag or height change, wear only): stone and brick buildings that are not ordinary houses. */
const RIGID_STYLES = new Set(["parish-church", "mansion", "roman-masonry", "scrub"]);

type P2 = [number, number];
const bboxOf = (p: P2[]): [number, number, number, number] => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, z] of p) { a = Math.min(a, x); b = Math.min(b, z); c = Math.max(c, x); d = Math.max(d, z); }
  return [a, b, c, d];
};
/** A convex outline pulled in towards its centre by about d metres (tolerance for party walls and eaves). */
const shrink = (p: P2[], d: number): P2[] => {
  const cx = p.reduce((a, q) => a + q[0], 0) / p.length, cz = p.reduce((a, q) => a + q[1], 0) / p.length;
  return p.map(([x, z]) => {
    const l = Math.hypot(x - cx, z - cz) || 1;
    const k = Math.max(0.05, (l - d * 1.41) / l);
    return [cx + (x - cx) * k, cz + (z - cz) * k] as P2;
  });
};
/** Points every `step` m round an outline, and its centre. */
const outline = (p: P2[], step: number): P2[] => {
  const out: P2[] = [];
  for (let i = 0; i < p.length; i++) {
    const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % p.length];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let k = 0; k < n; k++) out.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
  }
  out.push([p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length]);
  return out;
};

/** Years by which a `preexisting` zone's growth is moved before the start of the window. */
export const PREEXISTING_LEAD = 40;

/**
 * The years a zone grows over. A zone marked `"preexisting": true` stands complete when the window opens:
 * its growth (whenever that really was; the data need not say) is moved to well before the start, so no
 * building rises and no tree is cleared in the first years. Otherwise `grow` is used as written, which may
 * itself lie before the start.
 */
export function zoneGrow(zone: Zone, start: number): [number, number] {
  if (!(zone as Zone & { preexisting?: boolean }).preexisting) return zone.grow;
  const before = tToHist(Math.floor(histToT(start)) - PREEXISTING_LEAD);
  return [Math.min(zone.grow[0], before), Math.min(zone.grow[1], before)];
}

interface ZoneGeom {
  zone: Zone;
  contains: (x: number, z: number) => boolean;
  /** 1 in the core of the zone, falling to 0 at a soft edge. */
  weight: (x: number, z: number) => number;
  bbox: [number, number, number, number];
  cx: number;
  cz: number;
  radius: number;
  t0: number;
  t1: number;
  /** Effective growth years (see zoneGrow). */
  grow: [number, number];
}

interface Inst {
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  /** Extra scale along the frontage (street plots), default 1. */
  sx?: number;
  life: [number, number, number, number];
  burn: number;
  ev: number;
  zone: number;
  /** "O" overview lattice, "L" district lattice, "S" street plot (set when the instance is bucketed). */
  kind?: "O" | "L" | "S";
  variant?: number;
  /** Street plots: the plot's ground-storey footprint corners (world x, z). */
  rect?: [number, number][];
  /** Local bounding box of the model drawn for this instance: [minX, maxX, minY, maxY, minZ, maxZ] (unscaled). */
  box?: number[];
  /** One building may be drawn as several copies, one per span of years, each on its own ground: they share this id. */
  uid?: number;
  /** Fabric shader seed and mode (aFx.z, see street/houseShader.ts). */
  seed?: number;
  /** Street plots: alternate design drawn on the base variant's footprint (0 = the base design; see houses.ts). */
  alt?: number;
}

/** A placed generic building, as recorded by the fabric layer (diagnostics, populace, audit). */
export type PlacedHouse = Readonly<Inst>;

/** One level of detail of a district bucket: its meshes share these instance buffers. */
interface LodLevel {
  meshes: THREE.InstancedMesh[];
  matrices: THREE.InstancedBufferAttribute;
  life: THREE.InstancedBufferAttribute;
  fx: THREE.InstancedBufferAttribute;
  tints: THREE.InstancedBufferAttribute;
  ends: Float32Array;
  zones: Uint16Array;
  n: number;
}

/** A district bucket whose instances move between near / district / overview models with camera distance. */
interface Managed {
  list: Inst[];
  mats: Float32Array;
  tints: Float32Array;
  /** Level buffers by slot (see lodSlot): one near and one district level per alternate design, one shared overview level. */
  levels: (LodLevel | null)[];
  cur: Uint8Array;
  firstBirth: number;
}

/** Slot of a managed bucket's level buffers: each alternate design has its own near, district and distant model, so a house
 * keeps its form across the level-of-detail switches (`?houses=farbase` shares the base design's distant model instead). */
const lodSlot = (alt: number, lod: number) => (alt === 0 ? lod : 3 * alt + lod);

/** Distances (m) at which district houses switch from the near model to the district model, and to the overview model. */
export const LOD_NEAR = 70;
export const LOD_FAR = 300;

/**
 * The generic urban fabric: thousands of instanced buildings whose appearance
 * and disappearance follow the dated zones in the data file. Outside the benchmark district positions are
 * generated on a lattice; inside it, where the site has a street network (data/locations/<site>/streets.json),
 * houses stand in continuous rows on plots along those streets. Neither is a record of real plots.
 */
export class FabricLayer {
  readonly root = new THREE.Group();
  readonly zoneGeoms: ZoneGeom[] = [];
  /** Street network of the benchmark district (null when the site has none). */
  readonly streets: Street[] | null;
  private zoneOfMesh = new Map<THREE.InstancedMesh, Uint16Array>();
  /** Per mesh: instance end-times sorted latest first, so the live ones are always a prefix. */
  private culls: { mesh: THREE.InstancedMesh; ends: Float32Array; firstBirth: number }[] = [];
  private managed: Managed[] = [];
  private lastT = 0;
  instanceCount = 0;
  /** Instances placed on street plots in the district (diagnostics). */
  streetInstances = 0;
  /** Every placed building with its position, life window and model footprint (the single record of where houses stand). */
  readonly houses: PlacedHouse[] = [];
  /** Zones whose district houses stand on the street network (streets.json) rather than on the lattice. */
  readonly streetZones = new Set<number>();

  constructor(private ds: Dataset, private terrain: TerrainModel, readonly landmarks: LandmarkLayer, density: number) {
    this.root.name = "fabric";
    const proj = terrain.proj;
    const dist = ds.site.district?.bounds;
    const inDistrict = (x: number, z: number) => !!dist && x > dist.xMin && x < dist.xMax && z > dist.zMin && z < dist.zMax;
    const tEnd = histToT(ds.site.timeline.end) + 1;
    this.streets = dist ? streetNetwork(ds.site.id, proj) : null;

    for (const zone of ds.zones) {
      let contains: ZoneGeom["contains"];
      let weight: ZoneGeom["weight"];
      let bbox: ZoneGeom["bbox"];
      let cx = 0, cz = 0, radius = 1;
      if (zone.shape.type === "ellipse") {
        const s = zone.shape;
        [cx, cz] = proj.toLocal(s.lat, s.lon);
        const th = Math.PI / 2 - ((s.bearing ?? 90) * Math.PI) / 180;
        const cos = Math.cos(th), sin = Math.sin(th);
        contains = (x, z) => {
          const dx = x - cx, dz = z - cz;
          const u = dx * cos - dz * sin, v = dx * sin + dz * cos;
          return (u * u) / (s.rx * s.rx) + (v * v) / (s.rz * s.rz) <= 1;
        };
        weight = (x, z) => {
          const dx = x - cx, dz = z - cz;
          const u = dx * cos - dz * sin, v = dx * sin + dz * cos;
          const q = Math.sqrt((u * u) / (s.rx * s.rx) + (v * v) / (s.rz * s.rz)) + (noise2(x / 60, z / 60) - 0.5) * 0.35;
          return q >= 1 ? 0 : 1 - Math.max(0, (q - 0.5) / 0.5) ** 1.5;
        };
        radius = Math.max(s.rx, s.rz);
        bbox = [cx - radius, cz - radius, cx + radius, cz + radius];
      } else {
        const pts = ((zone.shape.type === "ref" ? ds.site.polygons[zone.shape.polygon] : zone.shape.points) ?? []).map(([la, lo]) => proj.toLocal(la, lo));
        contains = (x, z) => pointInPolygon(x, z, pts);
        weight = (x, z) => (pointInPolygon(x, z, pts) ? 1 : 0);
        const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
        bbox = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
        cx = (bbox[0] + bbox[2]) / 2;
        cz = (bbox[1] + bbox[3]) / 2;
        radius = Math.hypot(bbox[2] - bbox[0], bbox[3] - bbox[1]) / 2;
      }
      const grow = zoneGrow(zone, ds.site.timeline.start);
      this.zoneGeoms.push({ zone, contains, weight, bbox, cx, cz, radius, t0: histToT(grow[0]), t1: zone.decline ? histToT(zone.decline[1]) + 1 : tEnd, grow });
    }

    const tLast = histToT(ds.site.timeline.end) + 1;
    const tMidOf = (zg: ZoneGeom) => (zg.zone.decline ? (histToT(zg.grow[1]) + histToT(zg.zone.decline[0])) / 2 : histToT(zg.grow[1]));
    // streets each zone uses in the district: those standing at the middle of the zone's life
    const zoneStreets = this.zoneGeoms.map((zg) => {
      if (!this.streets || !dist || !STREET_STYLES[zg.zone.style]) return null;
      if (zg.bbox[2] < dist.xMin || zg.bbox[0] > dist.xMax || zg.bbox[3] < dist.zMin || zg.bbox[1] > dist.zMax) return null;
      const tm = tMidOf(zg);
      const s = this.streets.filter((q) => q.t0 <= tm && tm < q.t1);
      return s.length ? s : null;
    });
    zoneStreets.forEach((s, zi) => { if (s) this.streetZones.add(zi); });

    const corridorClear = (x: number, z: number, margin: number, t0: number, t1: number) => {
      for (const c of landmarks.corridors) {
        if (!(c.t1 > t0 && c.t0 < t1)) continue;
        for (let i = 1; i < c.path.length; i++) {
          const ps = pointSegment(x, z, c.path[i - 1][0], c.path[i - 1][1], c.path[i][0], c.path[i][1]);
          if (ps.d < c.half + margin) return false;
        }
      }
      return true;
    };

    // ---- models: built once per style / kind / variant; their extent gives every house its ground plan
    const models = new Map<string, { levels: (Map<string, THREE.BufferGeometry> | null)[]; box: number[] }>();
    const modelOf = (key: string) => {
      let m = models.get(key);
      if (m) return m;
      const [styleName, kind, vs] = key.split("|");
      const variant = parseInt(vs, 10);
      const street = kind === "S";
      const builds: (((b: Builder) => void) | null)[] =
        kind === "O" ? [null, null, (b) => STYLES[styleName].build(b, variant, false)]
        : street ? [STREET_STYLES[styleName].rich ? (b) => STREET_STYLES[styleName].build(b, variant, 0) : null, (b) => STREET_STYLES[styleName].build(b, variant, 1), (b) => STREET_STYLES[styleName].build(b, variant, 2)]
        : [null, (b) => STYLES[styleName].build(b, variant, true), (b) => STYLES[styleName].build(b, variant, false)];
      const levels = builds.map((f) => {
        if (!f) return null;
        const b = new Builder();
        // the shape field (aRoof) for the fabric shader: houses record their own roofs and smoke (see street/kit.ts);
        // whatever is left (Roman, Saxon and prehistoric buildings, churches) takes the model's roofs as one building
        SHAPE.on = true;
        SHAPE.sinks.push({ roofs: [], smoke: [] });
        try {
          f(b);
          shapeParts(partsSince(b, null), SHAPE.sinks[SHAPE.sinks.length - 1]);
        } finally {
          SHAPE.sinks.pop();
          SHAPE.on = false;
        }
        // fewer materials, fewer draw calls (see fabricMaterialName)
        const lod = builds.indexOf(f);
        const byName = new Map<string, THREE.BufferGeometry[]>();
        for (const [name, geo] of b.merged()) {
          const n = fabricMaterialName(name, lod);
          const l = byName.get(n);
          if (l) l.push(geo);
          else byName.set(n, [geo]);
        }
        const out = new Map<string, THREE.BufferGeometry>();
        for (const [n, list] of byName) out.set(n, list.length === 1 ? list[0] : mergeGeometries(list, false)!);
        return out;
      });
      const bb = new THREE.Box3();
      for (const [, geo] of levels[kind === "O" ? 2 : 1] ?? []) {
        geo.computeBoundingBox();
        if (geo.boundingBox) bb.union(geo.boundingBox);
      }
      const box = bb.isEmpty() ? [-4, 4, -1, 6, -4, 4] : [bb.min.x, bb.max.x, bb.min.y, bb.max.y, bb.min.z, bb.max.z];
      models.set(key, (m = { levels, box }));
      return m;
    };

    // ---- settling a house on the ground of its own life span
    // A house is placed once but stands for decades or centuries while the bank advances, the marsh is embanked,
    // valleys silt up and streets, roads and landmarks come and go. Every house must suit every year it is shown:
    //  1. dry: centre and corners clear of the water and the foreshore when it appears, and for as long as it stands;
    //  2. clear: off the streets, roads, walls, bridges and landmark plans standing in its years (it waits for them
    //     to go, or is taken down before they come);
    //  3. alone: two houses never share ground at the same time (the later one waits for the earlier to go);
    //  4. level: set on the ground of each span of its years, so it neither floats nor sinks as the ground moves.
    type Life = [number, number, number, number];
    interface Cand { key: string; zi: number; inst: Inst; poly: [number, number][]; tight: [number, number][]; bb: [number, number, number, number]; samples: ReturnType<TerrainModel["staticSample"]>[]; minY: number; big: boolean }
    const cands: Cand[] = [];
    const DRY_CENTRE = 1.6, DRY_CORNER = 0.5;
    const dryAt = (c: Cand, t: number) => {
      if (!terrain.hasRiver) return true;
      const p = terrain.yearParams(t);
      return c.samples.every((s, j) => terrain.heightFrom(s, p) >= (j === 0 ? DRY_CENTRE : DRY_CORNER));
    };
    // Linear things a house must keep off, as segments in a 24 m grid: roads, walls, streams and bridge approaches
    // (corridor widths carry a 5 m margin beyond the thing itself), the wharf or quay deck of each waterfront copy, and
    // the dated streets. Each segment knows its owner (for one window per owner) and the distance that blocks.
    interface Seg { ax: number; az: number; bx: number; bz: number; lim: number; t0: number; t1: number; owner: number }
    const SEGC = 24;
    const segCells = new Map<number, Seg[]>();
    let owners = 0;
    const addPath = (path: [number, number][], lim: number, t0: number, t1: number) => {
      const owner = owners++;
      for (let i = 1; i < path.length; i++) {
        const [ax, az] = path[i - 1], [bx, bz] = path[i];
        const sg: Seg = { ax, az, bx, bz, lim, t0, t1, owner };
        for (let gx = Math.floor((Math.min(ax, bx) - lim) / SEGC); gx <= Math.floor((Math.max(ax, bx) + lim) / SEGC); gx++)
          for (let gz = Math.floor((Math.min(az, bz) - lim) / SEGC); gz <= Math.floor((Math.max(az, bz) + lim) / SEGC); gz++) {
            const k = gx * 65536 + gz;
            let l = segCells.get(k);
            if (!l) segCells.set(k, (l = []));
            l.push(sg);
          }
      }
    };
    for (const cr of landmarks.corridors) addPath(cr.path, cr.half - 5 + 0.3, cr.t0, cr.t1);
    for (const w of landmarks.wharves) addPath(w.path, w.half, w.t0, w.t1);
    for (const st of this.streets ?? []) addPath(st.pts, st.width / 2 - 0.3, st.t0, st.t1);
    /** Ground windows (timeline) when the plot is not free. */
    const blockedWindows = (c: Cand): [number, number][] => {
      const out: [number, number][] = [];
      const life = c.inst.life;
      for (const sd of landmarks.solids) {
        if (sd.t1 <= life[0] || sd.t0 >= life[3]) continue;
        if (sd.bbox[2] < c.bb[0] || sd.bbox[0] > c.bb[2] || sd.bbox[3] < c.bb[1] || sd.bbox[1] > c.bb[3]) continue;
        if (sd.enclosure ? pointInPolygon(c.inst.x, c.inst.z, sd.poly) || c.poly.some(([x, z]) => pointInPolygon(x, z, sd.poly)) : satDepth(c.tight, sd.poly) > 0.15) out.push([sd.t0, sd.t1]);
      }
      const done = new Set<number>();
      for (const [x, z] of outline(c.tight, 1.8)) {
        for (const sg of segCells.get(Math.floor(x / SEGC) * 65536 + Math.floor(z / SEGC)) ?? []) {
          if (done.has(sg.owner) || sg.t1 <= life[0] || sg.t0 >= life[3]) continue;
          if (pointSegment(x, z, sg.ax, sg.az, sg.bx, sg.bz).d < sg.lim) {
            done.add(sg.owner);
            out.push([sg.t0, sg.t1]);
          }
        }
      }
      return out.sort((a, b) => a[0] - b[0]);
    };
    /** Fit a life window around blocked windows: wait for one that blocks the start, end before one that comes later. */
    const fitLife = (life: Life, wins: [number, number][]): Life | null => {
      let [b, b1, d, d1] = life;
      const rise = b1 - b, fall = d1 - d;
      for (let guard = 0; guard < 8; guard++) {
        let moved = false;
        for (const [w0, w1] of wins) {
          if (w1 <= b || w0 >= d1) continue;
          if (w0 <= b1) {
            // blocked at its start: wait until the ground is free
            b = w1 + 0.5;
            b1 = b + rise;
            moved = true;
          } else {
            // something takes the plot later: the house is gone by then
            d1 = Math.min(d1, w0);
            d = Math.min(d, d1 - fall);
          }
          if (b1 >= d) return null;
        }
        if (!moved) break;
      }
      return [b, b1, d, d1];
    };
    const settle = (c: Cand): boolean => {
      let life = c.inst.life.slice() as Life;
      if (LEGACY_PLACEMENT) {
        // before/after comparisons: the centre alone tested for dry ground in 15-year steps, nothing else
        const st = c.samples[0];
        let t = life[0];
        const at = (q: number) => terrain.heightFrom(st, terrain.yearParams(q));
        while (!terrain.dry(at(t), 1.6) && t < Math.min(life[2], tLast)) t = Math.min(life[2], tLast, t + 15);
        if (!terrain.dry(at(t), 1.6)) return false;
        if (t > life[0]) {
          if (t + life[1] - life[0] >= life[2]) return false;
          life = [t, t + life[1] - life[0], life[2], life[3]];
        }
        c.inst.life = life;
        c.inst.y = at(t);
        return true;
      }
      // 1. dry when it appears ...
      const until = Math.min(life[2], tLast);
      if (!dryAt(c, life[0])) {
        const ts = terrain.sampleTimes(life[0], until, 10);
        let ok = -1;
        for (let i = 1; i < ts.length; i++) if (dryAt(c, ts[i])) { ok = i; break; }
        if (ok < 0) return false;
        let a = ts[ok - 1], bT = ts[ok];
        while (bT - a > 1) { const m = (a + bT) / 2; if (dryAt(c, m)) bT = m; else a = m; }
        const rise = life[1] - life[0];
        if (bT + rise >= life[2]) return false;
        life = [bT, bT + rise, life[2], life[3]];
      }
      // ... and for as long as it stands (the marsh can come back when an embankment is neglected)
      if (terrain.hasRiver) {
        const wet = terrain.firstBelow(c.samples.slice(1), life[1], Math.min(life[3], tLast), DRY_CORNER * 0.6);
        if (wet != null) {
          const fall = life[3] - life[2];
          if (wet - fall <= life[1]) return false;
          life = [life[0], life[1], Math.min(life[2], wet - fall), Math.min(life[3], wet)];
        }
      }
      // 2. clear of whatever else stands on the plot in its years
      const fit = fitLife(life, blockedWindows({ ...c, inst: { ...c.inst, life } }));
      if (!fit) return false;
      c.inst.life = fit;
      return true;
    };
    const DEPTH = 0.5;
    const satDepth = (a: [number, number][], b: [number, number][]): number => {
      let best = Infinity;
      for (const q of [a, b])
        for (let i = 0; i < q.length; i++) {
          const [x0, z0] = q[i], [x1, z1] = q[(i + 1) % q.length];
          let ax = -(z1 - z0), az = x1 - x0;
          const l = Math.hypot(ax, az) || 1;
          ax /= l; az /= l;
          let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
          for (const [x, z] of a) { const v = x * ax + z * az; if (v < amin) amin = v; if (v > amax) amax = v; }
          for (const [x, z] of b) { const v = x * ax + z * az; if (v < bmin) bmin = v; if (v > bmax) bmax = v; }
          const o = Math.min(amax, bmax) - Math.max(amin, bmin);
          if (o <= 0) return 0;
          if (o < best) best = o;
        }
      return best;
    };
    const push = (key: string, zi: number, inst: Inst) => {
      const m = modelOf(key);
      const b = m.box;
      let poly: [number, number][];
      if (inst.rect) poly = inst.rect.map(([x, z]) => [x, z] as [number, number]);
      else {
        const k = inst.scale, kx = inst.scale * (inst.sx ?? 1);
        const c = Math.cos(inst.rot), sn = Math.sin(inst.rot);
        poly = [[b[0] * kx, b[4] * k], [b[1] * kx, b[4] * k], [b[1] * kx, b[5] * k], [b[0] * kx, b[5] * k]].map(([lx, lz]) => [inst.x + lx * c + lz * sn, inst.z - lx * sn + lz * c] as [number, number]);
      }
      const tight = shrink(poly, 0.35);
      const c: Cand = {
        key, zi, inst, poly, tight, bb: bboxOf(poly), minY: b[2] * inst.scale,
        samples: [[inst.x, inst.z] as [number, number], ...poly].map(([x, z]) => terrain.staticSample(x, z)),
        big: STYLES[key.split("|")[0]]?.footprint >= 20,
      };
      if (settle(c)) cands.push(c);
    };
    /** Large lattice buildings in the district (churches, great houses) that street plots must avoid. */
    const blockers: { x: number; z: number; r: number; t0: number; t1: number }[] = [];
    this.zoneGeoms.forEach((zg, zi) => {
      const { zone } = zg;
      const style = STYLES[zone.style];
      if (!style) {
        console.warn(`No fabric style "${zone.style}"`);
        return;
      }
      const yp = terrain.yearParams(tMidOf(zg));
      const gb = zone.gridBearing;
      const th = gb == null ? 0 : Math.PI / 2 - (gb * Math.PI) / 180;
      const cos = Math.cos(th), sin = Math.sin(th);
      const band = zone.band ?? 0;
      for (const detail of [false, true]) {
        // inside the district a zone on the street network is placed along the streets below instead
        if (detail && zoneStreets[zi]) continue;
        // The benchmark district uses a tighter lattice of individually modelled houses.
        const sp = detail && zone.spacing < 40 ? zone.spacing * 0.66 : zone.spacing;
        const fillK = detail ? 1 : density;
        const n = Math.ceil(zg.radius / sp) + 1;
        // lattice in the zone's street-grid frame, anchored at the world origin so zones sharing a grid line up
        const ou = Math.round((zg.cx * cos - zg.cz * sin) / sp), ov = Math.round((zg.cx * sin + zg.cz * cos) / sp);
        for (let iu = ou - n; iu <= ou + n; iu++)
          for (let iv = ov - n; iv <= ov + n; iv++) {
            const h = hash2(iu * 7 + (detail ? 991 : 0), iv * 13 + Math.round(sp));
            if (h < band || h >= band + zone.fill * fillK) continue;
            let ragged = 1;
            // every 5th lattice row and 7th column is left open as a street
            if (gb != null && zone.spacing < 40 && (((iu % 7) + 7) % 7 === 3 || ((iv % 5) + 5) % 5 === 2)) continue;
            const h2 = hash2(iu * 31 + 5, iv * 17 + 9);
            const h3 = hash2(iu * 3 + 77, iv * 5 + 41);
            const ju = gb == null ? (h2 - 0.5) * sp * 0.8 : (h2 - 0.5) * sp * 0.12;
            const jv = gb == null ? (h3 - 0.5) * sp * 0.8 : (h3 - 0.5) * sp * 0.12;
            const u = iu * sp + ju, v = iv * sp + jv;
            const x = u * cos + v * sin, z = -u * sin + v * cos;
            if (!zg.contains(x, z)) continue;
            ragged = zg.weight(x, z);
            if (h - band >= zone.fill * fillK * (0.12 + 0.88 * ragged)) continue;
            if (inDistrict(x, z) !== detail) continue;
            const y = terrain.heightFrom(terrain.staticSample(x, z), yp);
            if (!terrain.dry(y, 1.25)) continue;
            let blocked = false;
            for (const f of landmarks.footprints) {
              if (f.t1 > zg.t0 && f.t0 < zg.t1 && (x - f.x) ** 2 + (z - f.z) ** 2 < (f.r + style.footprint * 0.4) ** 2) { blocked = true; break; }
            }
            if (!blocked && !corridorClear(x, z, style.footprint * 0.45, zg.t0, zg.t1)) blocked = true;
            if (blocked) continue;
            const order = Math.min(1, Math.hypot(x - zg.cx, z - zg.cz) / zg.radius);
            const variant = Math.floor(h3 * style.variants) % style.variants;
            const quarter = gb == null ? h2 * Math.PI * 2 : th + Math.floor(h2 * 4) * (Math.PI / 2) + (h3 - 0.5) * 0.08;
            if (detail && style.footprint >= 20) blockers.push({ x, z, r: style.footprint * 0.5, t0: zg.t0, t1: zg.t1 });
            push(`${zone.style}|${detail ? "L" : "O"}|${variant}`, zi, {
              x, y, z, rot: quarter, scale: detail ? 0.95 + h2 * 0.1 : 0.9 + h2 * 0.28,
              life: instanceLife(zg.grow, zone.decline, order, hash2(iu + 1000, iv - 1000), zone.declineBy),
              burn: zone.declineBy === "fire" ? 1 : 0, ev: EVIDENCE_INDEX[zone.evidence] ?? 1, zone: zi,
            });
          }
      }
    });

    // ---- district houses on street plots
    this.zoneGeoms.forEach((zg, zi) => {
      const streets = zoneStreets[zi];
      if (!streets) return;
      const { zone } = zg;
      const st = STREET_STYLES[zone.style];
      const lattice = STYLES[zone.style];
      const yp = terrain.yearParams(tMidOf(zg));
      const band = zone.band;
      const placed = placeAlongStreets(streets, st, (c) => {
        if (!c.rect.every(([x, z]) => inDistrict(x, z))) return false;
        if (!zg.contains(c.x, c.z)) return false;
        const ragged = zg.weight(c.x, c.z);
        if (band != null) {
          // zones sharing a street by band claim whole 24 m lots
          if (c.lotHash < band || c.lotHash >= band + zone.fill) return false;
          if (c.plotHash > 0.12 + 0.88 * ragged + 0.05) return false;
        } else if (c.plotHash >= zone.fill * (0.12 + 0.88 * ragged)) return false;
        const y = terrain.heightFrom(terrain.staticSample(c.x, c.z), yp);
        if (!terrain.dry(y, 1.25)) return false;
        for (const f of landmarks.footprints) {
          if (f.t1 > zg.t0 && f.t0 < zg.t1 && (c.x - f.x) ** 2 + (c.z - f.z) ** 2 < (f.r + lattice.footprint * 0.4) ** 2) return false;
        }
        for (const bk of blockers) if (bk.t1 > zg.t0 && bk.t0 < zg.t1 && (c.x - bk.x) ** 2 + (c.z - bk.z) ** 2 < (bk.r + 4) ** 2) return false;
        // road corridors: the house must keep off the road itself (the corridor less its 5 m margin, plus 0.5 m)
        for (const [px, pz] of [...c.rect, [c.x, c.z] as [number, number]]) if (!corridorClear(px, pz, -4.5, zg.t0, zg.t1)) return false;
        return true;
      });
      for (const c of placed) {
        const order = Math.min(1, Math.hypot(c.x - zg.cx, c.z - zg.cz) / zg.radius);
        // an alternate design on the same footprint (placement is the base variant's): neighbours rarely repeat
        const have = HOUSE_NO_ALT ? 0 : st.alts?.[c.variant] ?? 0;
        const nAlt = Math.min(HOUSE_MAX_ALT, have);
        const pickA = nAlt ? Math.floor(hash2(Math.round(c.x * 13) + 7, Math.round(c.z * 11) - 3) * (nAlt + 1)) % (nAlt + 1) : 0;
        // with fewer alternates in use than designed, which ones rotates with the variant
        const alt = pickA === 0 ? 0 : 1 + ((pickA - 1 + c.variant) % have);
        push(`${zone.style}|S|${c.variant}`, zi, {
          x: c.x, y: 0, z: c.z, rot: c.rot, scale: 1, sx: c.sx * 0.996, rect: c.rect, alt,
          life: instanceLife(zg.grow, zone.decline, order, c.plotHash, zone.declineBy),
          burn: zone.declineBy === "fire" ? 1 : 0, ev: EVIDENCE_INDEX[zone.evidence] ?? 1, zone: zi,
        });
      }
    });

    // ---- 3. alone: resolve houses sharing ground at the same time (earliest first; big buildings first on a tie)
    cands.sort((a, b) => a.inst.life[0] - b.inst.life[0] || Number(b.big) - Number(a.big));
    const taken = new Map<number, Cand[]>();
    const CELL = 24;
    const cellsOf = (bb: [number, number, number, number]) => {
      const out: number[] = [];
      for (let i = Math.floor(bb[0] / CELL); i <= Math.floor(bb[2] / CELL); i++) for (let j = Math.floor(bb[1] / CELL); j <= Math.floor(bb[3] / CELL); j++) out.push(i * 65536 + j);
      return out;
    };
    const kept: Cand[] = [];
    for (const c of cands) {
      if (LEGACY_PLACEMENT) { kept.push(c); continue; }
      const cells = cellsOf(c.bb);
      let ok = true;
      for (let guard = 0; guard < 6; guard++) {
        const L = c.inst.life;
        let wait = -Infinity;
        for (const k of cells)
          for (const o of taken.get(k) ?? []) {
            const M = o.inst.life;
            if (M[3] <= L[0] || M[0] >= L[3]) continue;
            if (o.bb[0] > c.bb[2] || o.bb[2] < c.bb[0] || o.bb[1] > c.bb[3] || o.bb[3] < c.bb[1]) continue;
            if (satDepth(c.tight, o.tight) > DEPTH) wait = Math.max(wait, M[3]);
          }
        if (wait === -Infinity) break;
        const rise = L[1] - L[0];
        if (wait + rise + 1 >= L[2]) { ok = false; break; }
        const moved = fitLife([wait + 0.2, wait + 0.2 + rise, L[2], L[3]], blockedWindows(c));
        if (!moved || !dryAt(c, moved[0])) { ok = false; break; }
        c.inst.life = moved;
        if (guard === 5) ok = false;
      }
      if (!ok) continue;
      for (const k of cells) {
        let l = taken.get(k);
        if (!l) taken.set(k, (l = []));
        l.push(c);
      }
      kept.push(c);
    }

    // ---- 4. level: one copy per span of years over which the ground under it stays within a metre
    const buckets = new Map<string, Inst[]>();
    const bucket = (key: string, inst: Inst) => {
      let list = buckets.get(key);
      if (!list) buckets.set(key, (list = []));
      list.push(inst);
    };
    kept.forEach((c, uid) => {
      const L = c.inst.life;
      if (LEGACY_PLACEMENT) { bucket(c.key, { ...c.inst, uid }); return; }
      // a model with a deep base (plinth, cellar) tolerates more movement than one set straight on the ground, a plot
      // on a slope less (the slope already uses part of what the base can hide)
      const p0 = terrain.yearParams(Math.max(L[0], -1e6));
      const h0 = c.samples.map((s) => terrain.heightFrom(s, p0));
      const slope = Math.max(...h0) - Math.min(...h0);
      const tol = Math.max(0.3, Math.min(1.0, 0.8 - c.minY - slope - 0.1));
      const spans = terrain.groundSpans(c.samples, L[0], Math.min(L[3], tLast), tol);
      spans.forEach(([a, b], i) => {
        const last = i === spans.length - 1;
        const life: Life = i === 0 && last ? L : [i === 0 ? L[0] : a, i === 0 ? L[1] : a + 0.02, last ? L[2] : b, last ? L[3] : b + 0.02];
        if (i === 0 && !last && life[2] <= life[1]) { life[2] = life[1] + 0.01; life[3] = life[2] + 0.02; }
        // over the whole span: no corner buried by more than 0.8 m, and no gap under the model's base; if the plot is
        // too steep for both, no gap (a house cut into a slope reads true; one hanging over it does not)
        const r = terrain.groundRange(c.samples, Math.max(a, life[0]), Math.min(b, tLast));
        const lo = Math.min(...r.min), hi = Math.max(...r.max);
        const yNoGap = lo - c.minY + 0.05, yNoSink = hi - 0.8;
        const mid = terrain.heightFrom(c.samples[0], terrain.yearParams((a + Math.min(b, tLast)) / 2));
        let y = Math.min(yNoGap, Math.max(yNoSink, mid));
        if (terrain.hasRiver) y = Math.max(y, 0.6);
        bucket(c.key, { ...c.inst, y, life, uid });
      });
      if (c.key.split("|")[1] === "S") this.streetInstances++;
    });

    const depth = houseDepthMaterial();
    const mat4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const matCache = new Map<string, THREE.MeshStandardMaterial>();
    const material = (matName: string) => {
      let m = matCache.get(matName);
      if (!m) {
        m = patchHouse(patchLife(makeMaterial(matName)), houseClassOf(matName));
        m.side = THREE.DoubleSide;
        matCache.set(matName, m);
      }
      return m;
    };
    const makeMesh = (geo: THREE.BufferGeometry, matName: string, count: number, matrices: THREE.InstancedBufferAttribute, tints: THREE.InstancedBufferAttribute) => {
      const mesh = new THREE.InstancedMesh(geo, material(matName), count);
      mesh.instanceMatrix = matrices;
      mesh.instanceColor = tints;
      mesh.customDepthMaterial = depth;
      mesh.castShadow = !NO_SHADOW.has(matName);
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.userData.fabric = true;
      return mesh;
    };
    for (const [key, list] of buckets) {
      const [styleName, kind, variantStr] = key.split("|");
      const variant = parseInt(variantStr, 10);
      list.sort((a, b) => b.life[3] - a.life[3]);
      const N = list.length;
      const ends = Float32Array.from(list, (it) => it.life[3]);
      const firstBirth = list.reduce((m, it) => Math.min(m, it.life[0]), Infinity);
      const matrices = new Float32Array(N * 16);
      const lifeA = new Float32Array(N * 4);
      const fxA = new Float32Array(N * 3);
      const tintA = new Float32Array(N * 3);
      const zones = new Uint16Array(N);
      const tc = new THREE.Color();
      const mode = RIGID_STYLES.has(styleName) ? 2 : kind === "S" ? 0 : 1;
      list.forEach((it, i) => {
        // per-house seed for the fabric shader (shape and wear): the same house keeps it in every copy and level of detail
        it.seed = 0.01 + 0.98 * hash2(Math.round(it.x * 5) + 101, Math.round(it.z * 5) - 77) + 2 * mode;
        q.setFromAxisAngle(up, it.rot);
        mat4.compose(pos.set(it.x, it.y, it.z), q, scl.set(it.scale * (it.sx ?? 1), it.scale, it.scale));
        mat4.toArray(matrices, i * 16);
        lifeA.set(it.life, i * 4);
        fxA.set([it.burn, it.ev, it.seed], i * 3);
        zones[i] = it.zone;
        const hh = hash2(Math.round(it.x * 3), Math.round(it.z * 3));
        const hw = hash2(Math.round(it.z * 7), Math.round(it.x * 5));
        tc.setRGB(0.74 + hh * 0.3, 0.72 + hh * 0.3 - hw * 0.05, 0.7 + hh * 0.28 - hw * 0.12);
        tintA.set([tc.r, tc.g, tc.b], i * 3);
      });
      this.instanceCount += N;
      const model = modelOf(key);
      for (const it of list) {
        it.kind = kind as Inst["kind"];
        it.variant = variant;
        it.box = model.box;
        this.houses.push(it);
      }
      if (kind === "O") {
        // overview fabric: one model, no LOD switching
        const merged = model.levels[2]!;
        const life = new THREE.InstancedBufferAttribute(lifeA, 4);
        const fx = new THREE.InstancedBufferAttribute(fxA, 3);
        const mats = new THREE.InstancedBufferAttribute(matrices, 16);
        const tints = new THREE.InstancedBufferAttribute(tintA, 3);
        for (const [matName, geo] of merged) {
          geo.setAttribute("aLife", life);
          geo.setAttribute("aFx", fx);
          const mesh = makeMesh(geo, matName, N, mats, tints);
          this.zoneOfMesh.set(mesh, zones);
          this.culls.push({ mesh, ends, firstBirth });
          this.root.add(mesh);
        }
        continue;
      }
      // district buckets: three models chosen by distance to the camera (see setLod); street plots may carry alternates
      const makeLevel = (merged: Map<string, THREE.BufferGeometry> | null): LodLevel | null => {
        if (!merged) return null;
        const L: LodLevel = {
          meshes: [],
          matrices: new THREE.InstancedBufferAttribute(new Float32Array(N * 16), 16),
          life: new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4),
          fx: new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3),
          tints: new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3),
          ends: new Float32Array(N),
          zones: new Uint16Array(N),
          n: 0,
        };
        for (const att of [L.matrices, L.life, L.fx, L.tints]) att.setUsage(THREE.DynamicDrawUsage);
        for (const [matName, geo] of merged) {
          geo.setAttribute("aLife", L.life);
          geo.setAttribute("aFx", L.fx);
          const mesh = makeMesh(geo, matName, N, L.matrices, L.tints);
          mesh.count = 0;
          mesh.visible = false;
          this.zoneOfMesh.set(mesh, L.zones);
          L.meshes.push(mesh);
          this.root.add(mesh);
        }
        return L;
      };
      const alts = new Set(list.map((it) => it.alt ?? 0));
      const levels: Managed["levels"] = [];
      for (const a of alts) {
        const md = a === 0 ? model : modelOf(`${styleName}|S|${altVariant(variant, a)}`);
        for (const lvl of [0, 1, 2]) levels[lodSlot(a, lvl)] = lvl === 2 && a > 0 && HOUSE_FAR_BASE ? null : makeLevel(md.levels[lvl]);
      }
      for (let i = 0; i < levels.length; i++) levels[i] ??= null;
      const m: Managed = { list, mats: matrices, tints: tintA, levels, cur: new Uint8Array(N).fill(1), firstBirth };
      this.managed.push(m);
      this.assign(m);
    }
    registerStreetExtra();
  }

  /** Copy each instance of a managed bucket into the buffers of its current level of detail. */
  private assign(m: Managed): void {
    for (const L of m.levels) if (L) L.n = 0;
    m.list.forEach((it, i) => {
      const a = it.alt ?? 0;
      const lod = m.cur[i];
      const L = (m.levels[lodSlot(a, lod)] ?? (lod === 2 ? m.levels[2] : m.levels[lodSlot(a, 1)]))!;
      const k = L.n++;
      (L.matrices.array as Float32Array).set(m.mats.subarray(i * 16, i * 16 + 16), k * 16);
      (L.life.array as Float32Array).set(it.life, k * 4);
      (L.fx.array as Float32Array).set([it.burn, it.ev, it.seed ?? 0], k * 3);
      (L.tints.array as Float32Array).set(m.tints.subarray(i * 3, i * 3 + 3), k * 3);
      L.ends[k] = it.life[3];
      L.zones[k] = it.zone;
    });
    for (const L of m.levels) {
      if (!L) continue;
      for (const att of [L.matrices, L.life, L.fx, L.tints]) {
        att.clearUpdateRanges();
        att.addUpdateRange(0, L.n * att.itemSize);
        att.needsUpdate = true;
      }
      for (const mesh of L.meshes) mesh.boundingSphere = null;
    }
  }

  /**
   * Choose each district instance's model by its distance to the camera: the near model within LOD_NEAR,
   * the district model to LOD_FAR, the overview model beyond (with 8 % hysteresis). Called by the street
   * extra (street/lod.ts) when the camera has moved. Returns true when anything changed.
   */
  setLod(cam: THREE.Vector3, near = LOD_NEAR, far = LOD_FAR): boolean {
    let any = false;
    for (const m of this.managed) {
      let changed = false;
      const mats = m.mats;
      for (let i = 0; i < m.list.length; i++) {
        const dx = mats[i * 16 + 12] - cam.x, dy = mats[i * 16 + 13] + 5 - cam.y, dz = mats[i * 16 + 14] - cam.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const prev = m.cur[i];
        let L = prev;
        if (d < near * 0.92) L = 0;
        else if (L === 0 && d > near * 1.08) L = 1;
        if (d > far * 1.08) L = 2;
        else if (L === 2 && d < far * 0.92) L = 1;
        if (L === 0 && !m.levels[lodSlot(m.list[i].alt ?? 0, 0)]) L = 1;
        if (L !== prev) {
          m.cur[i] = L;
          changed = true;
        }
      }
      if (changed) {
        this.assign(m);
        any = true;
      }
    }
    if (any) this.update(this.lastT);
    return any;
  }

  /** Skip instances that no longer exist (and whole meshes not yet begun) at time t. */
  update(t: number): void {
    this.lastT = t;
    const live = (ends: Float32Array, n: number) => {
      let lo = 0, hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ends[mid] > t) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    for (const c of this.culls) {
      const lo = live(c.ends, c.ends.length);
      c.mesh.count = lo;
      c.mesh.visible = lo > 0 && t >= c.firstBirth;
    }
    for (const m of this.managed)
      for (const L of m.levels) {
        if (!L) continue;
        const lo = live(L.ends, L.n);
        for (const mesh of L.meshes) {
          mesh.count = lo;
          mesh.visible = lo > 0 && t >= m.firstBirth;
        }
      }
  }

  /** Urban ground cover (0..1) per zone at time t, used to tint the terrain. */
  activity(zg: ZoneGeom, t: number): number {
    const z = zg.zone;
    const g0 = histToT(zg.grow[0]), g1 = histToT(zg.grow[1]) + 1;
    let a = Math.min(1, Math.max(0, (t - g0) / Math.max(1, g1 - g0)));
    if (z.decline) {
      const d0 = histToT(z.decline[0]), d1 = histToT(z.decline[1]) + 1;
      a *= 1 - Math.min(1, Math.max(0, (t - d0) / Math.max(1, d1 - d0)));
    }
    if (z.style === "scrub" || z.style === "roundhouse") return 0;
    return a * Math.min(1, z.fill * 1.4);
  }

  zoneForHit(mesh: THREE.Object3D, instanceId: number | undefined): Zone | null {
    const zones = this.zoneOfMesh.get(mesh as THREE.InstancedMesh);
    if (!zones || instanceId == null) return null;
    return this.ds.zones[zones[instanceId]] ?? null;
  }

  /** Distance to the nearest district street at (x, z), or Infinity (used by the street surface layer). */
  streetDistance(x: number, z: number, t: number): number {
    if (!this.streets) return Infinity;
    let best = Infinity;
    for (const s of this.streets) if (s.t0 <= t && t < s.t1) best = Math.min(best, distToPolyline(x, z, s.pts) - s.width / 2);
    return best;
  }
}
