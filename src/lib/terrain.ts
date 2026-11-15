import type { Site, SiteTerrain } from "./types";

type SiteEyot = NonNullable<SiteTerrain["eyots"]>[number];
import { fbm, makeProjector, noise2, pointSegment, smoothstep, type Projector } from "./geo";
import { sampleKeyframes } from "./lifecycle";
import { histToT } from "./years";
import type { Heightmap } from "./heightmap";

/**
 * Analytic terrain model. Pure functions of (x, z, t) driven entirely by the
 * site data file, so it can be sampled by the renderer, by instance placement
 * and by tests.
 *
 * River sites (site.river present): heights are metres above the modelled
 * high-water level (y = 0), true scale; the banks, foreshore and marsh are
 * shaped around the centreline.
 *
 * Sites without a river: land everywhere. height = terrain.base + slope + hills
 * - valleys + small-scale relief, never below MIN_LAND, and no water is drawn.
 *
 * This is a schematic reconstruction of relief, not a survey DEM.
 */

/** Plain ground height (m) for a site without a river when terrain.base is not given. */
export const DEFAULT_BASE = 20;
/** Lowest ground a site without a river can have (m): valleys bottom out here rather than going "under water". */
export const MIN_LAND = 2;

export interface StaticSample {
  /** Signed distance to the river centreline: >0 left bank (north, in the City reach), <0 right bank. */
  dRiver: number;
  leftHalf: number;
  rightHalf: number;
  reclaimWeight: number;
  /** Year-independent upland relief on the left bank (terraces + hills). */
  upland: number;
  /** Per-valley gaussian weights. */
  valleyW: number[];
  eyot: number;
  /** Height (m above the water) of the highest `shoal` eyot at this spot, scaled by its fall-off (0 = none). */
  shoal: number;
  /** Fall-off weight (0..1) of that shoal: 1 at its crest. */
  shoalW: number;
  micro: number;
  marshNoise: number;
  /** 0 = City/Southwark sector, 1 = far-west lowland (Westminster / Lambeth). */
  west: number;
  /** Sites without a river: base height plus slope at this spot. */
  base: number;
  /** LIDAR grid height in the site datum (only when a terrain-lidar.json grid is in use and lidarW > 0). */
  lidar?: number;
  /** Weight (0..1) of the LIDAR grid at this spot: edge fade x trust mask (x river clearance for "upland-only"). */
  lidarW?: number;
  /** Index of the dated inlet (dock) this spot lies in, or -1; `inletW` its weight (1 inside, 0 outside). */
  inlet?: number;
  inletW?: number;
}

/** A dated inlet (dock) in local metres: head centre (x, z), unit vector (ux, uz) to the river, half-width, years open. */
export interface InletGeom {
  id: string;
  landmark?: string;
  x: number;
  z: number;
  ux: number;
  uz: number;
  half: number;
  length: number;
  t0: number;
  t1: number;
}

/** Bed of an open dock inlet (m, relative to high water): water stands in it at high tide. */
export const INLET_BED = -1.2;

export interface TerrainYearParams {
  setback: number;
  embank: number;
  valleyFill: number[];
  /** Per dated inlet: 1 while open, 0 otherwise (absent on a site without inlets). */
  inlets?: number[];
}

export class TerrainModel {
  readonly proj: Projector;
  private line: { x: number; z: number; l: number; r: number; w: number }[];
  private hills: { x: number; z: number; h: number; s: number }[];
  private eyots: { x: number; z: number; h: number; s: number }[];
  /** Eyots marked `shoal: true`: gravel shoals that may stand anywhere, mid-channel included. */
  private shoals: { x: number; z: number; h: number; s: number; ax: number; az: number; k: number }[];
  private valleys: { pts: [number, number][]; depth: number; sigma: number; box: [number, number, number, number] }[];
  /** True when the site has a river, so y = 0 is a water surface. */
  readonly hasRiver: boolean;
  private base: number;
  /** Unit vector (x, z) pointing uphill, times the gradient; zero when there is no slope. */
  private slope: [number, number] = [0, 0];
  private slopeReach: number;
  /** Optional LIDAR grid (site.lidar, decoded by prepareTerrain); null = analytic relief only. */
  private grid: Heightmap | null = null;
  private gridMode: "replace-analytic" | "upland-only" = "replace-analytic";
  private gridDatum = 0;
  private gridBlend = 250;
  private gridClear: [number, number] = [150, 400];
  /** "replace-analytic" with `extend`: beyond the grid its edge values continue, fading to the analytic model over this many metres. */
  private gridExtend = 0;
  /** Valleys with `fill` keyframes are dated features: still cut into a "replace-analytic" grid. */
  private valleyDated: boolean[] = [];
  /** Dated inlets (docks) kept open through the reclaimed frontage (site.river.inlets). */
  readonly inlets: InletGeom[] = [];

  constructor(readonly site: Site) {
    this.proj = makeProjector(site.origin.lat, site.origin.lon);
    const terrain = site.terrain ?? {};
    const centre = site.river?.centreline ?? [];
    this.hasRiver = centre.length >= 2;
    const ws = site.river?.widthScale ?? 1;
    this.line = (this.hasRiver ? centre : []).map(([lat, lon, l, r, w]) => {
      const [x, z] = this.proj.toLocal(lat, lon);
      return { x, z, l: l * ws, r: r * ws, w: w ?? 0 };
    });
    if (this.hasRiver) {
      // Continue the river well beyond the modelled area so the land does not end at an edge.
      const ext = (a: (typeof this.line)[number], b: (typeof this.line)[number]) => {
        const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        return { ...b, x: b.x + ((b.x - a.x) / d) * 14000, z: b.z + ((b.z - a.z) / d) * 14000 };
      };
      this.line.unshift(ext(this.line[1], this.line[0]));
      this.line.push(ext(this.line[this.line.length - 2], this.line[this.line.length - 1]));
    }
    this.base = terrain.base ?? DEFAULT_BASE;
    const b = site.bounds;
    // The tilt is held constant beyond the modelled area so the far apron neither climbs nor sinks without limit.
    this.slopeReach = Math.hypot(b.xMax - b.xMin, b.zMax - b.zMin) * 0.6;
    if (terrain.slope && Number.isFinite(terrain.slope.gradient) && Number.isFinite(terrain.slope.bearing)) {
      const a = (terrain.slope.bearing * Math.PI) / 180;
      this.slope = [Math.sin(a) * terrain.slope.gradient, -Math.cos(a) * terrain.slope.gradient];
    }
    this.hills = (terrain.hills ?? []).map((h) => {
      const [x, z] = this.proj.toLocal(h.lat, h.lon);
      return { x, z, h: h.height, s: h.sigma };
    });
    // An eyot is either a right-bank marsh island (the original behaviour, used by London) or, with
    // `shoal: true`, a gravel shoal that applies anywhere: in mid-channel, on the foreshore or on either bank.
    type EyotIn = SiteEyot & { shoal?: boolean; stretch?: number; bearing?: number };
    const eyots = (terrain.eyots ?? []) as EyotIn[];
    this.eyots = eyots.filter((e) => !e.shoal).map((h) => {
      const [x, z] = this.proj.toLocal(h.lat, h.lon);
      return { x, z, h: h.height, s: h.sigma };
    });
    this.shoals = eyots.filter((e) => e.shoal).map((h) => {
      const [x, z] = this.proj.toLocal(h.lat, h.lon);
      const a = ((h.bearing ?? 90) * Math.PI) / 180;
      return { x, z, h: h.height, s: h.sigma, ax: Math.sin(a), az: -Math.cos(a), k: Math.max(1, h.stretch ?? 1) };
    });
    this.valleys = (terrain.valleys ?? []).map((v) => {
      const pts = v.path.map(([lat, lon]) => this.proj.toLocal(lat, lon));
      const xs = pts.map((q) => q[0]), zs = pts.map((q) => q[1]);
      return { pts, depth: v.depth, sigma: v.sigma, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] as [number, number, number, number] };
    });
    this.valleyDated = (terrain.valleys ?? []).map((v) => Array.isArray(v.fill) && v.fill.length > 0);
    if (this.hasRiver)
      for (const q of site.river?.inlets ?? []) {
        const [x, z] = this.proj.toLocal(q.lat, q.lon);
        const a = (q.bearing * Math.PI) / 180;
        this.inlets.push({
          id: q.id, landmark: q.landmark, x, z, ux: Math.sin(a), uz: -Math.cos(a), half: q.width / 2, length: q.length ?? 200,
          t0: histToT(q.from), t1: q.to == null ? Infinity : histToT(q.to) + 1,
        });
      }
    const l = site.lidar;
    if (l?.grid && (l.use === "replace-analytic" || (l.use === "upland-only" && this.hasRiver))) {
      this.grid = l.grid;
      this.gridMode = l.use;
      this.gridDatum = Number.isFinite(l.localDatumOffset) ? l.localDatumOffset : 0;
      this.gridBlend = l.edgeBlend ?? 250;
      if (l.riverClearance) this.gridClear = l.riverClearance;
      if (l.use === "replace-analytic" && l.extend && l.extend > 0) this.gridExtend = l.extend;
    }
  }

  yearParams(t: number): TerrainYearParams {
    const p: TerrainYearParams = {
      setback: sampleKeyframes(this.site.river?.northBankSetback ?? [], t),
      embank: sampleKeyframes(this.site.river?.southEmbankment ?? [], t),
      valleyFill: (this.site.terrain?.valleys ?? []).map((v) => (v.fill ? sampleKeyframes(v.fill, t) : 0)),
    };
    if (this.inlets.length) p.inlets = this.inlets.map((q) => (t >= q.t0 && t < q.t1 ? 1 : 0));
    return p;
  }

  /** The inlets open in a year (from its yearParams). */
  inletsOpen(p: TerrainYearParams): InletGeom[] {
    return this.inlets.filter((_, i) => (p.inlets?.[i] ?? 0) > 0);
  }

  staticSample(x: number, z: number): StaticSample {
    // With no river every point is far out on the "left bank", so nothing downstream treats it as wet.
    let best = this.hasRiver ? Infinity : 1e6;
    let side = 1;
    let l = 0;
    let r = 0;
    let w = 0;
    for (let i = 1; i < this.line.length; i++) {
      const a = this.line[i - 1];
      const b = this.line[i];
      const ps = pointSegment(x, z, a.x, a.z, b.x, b.z);
      if (ps.d < best) {
        best = ps.d;
        side = ps.side;
        l = a.l + (b.l - a.l) * ps.f;
        r = a.r + (b.r - a.r) * ps.f;
        w = a.w + (b.w - a.w) * ps.f;
      }
    }
    let hills = 0;
    for (const h of this.hills) {
      const d2 = (x - h.x) ** 2 + (z - h.z) ** 2;
      const s2 = 2 * h.s * h.s;
      if (d2 > 32 * s2) continue; // under 1e-13 of the hill's height
      hills += h.h * Math.exp(-d2 / s2);
    }
    let eyot = 0;
    for (const e of this.eyots) {
      const d2 = (x - e.x) ** 2 + (z - e.z) ** 2;
      eyot = Math.max(eyot, e.h * Math.exp(-d2 / (2 * e.s * e.s)));
    }
    let shoal = 0;
    let shoalW = 0;
    for (const e of this.shoals) {
      const dx = x - e.x, dz = z - e.z;
      const along = (dx * e.ax + dz * e.az) / e.k;
      const across = dx * e.az - dz * e.ax;
      const w = Math.exp(-(along * along + across * across) / (2 * e.s * e.s));
      if (w > shoalW) {
        shoalW = w;
        shoal = e.h;
      }
    }
    // Hot path (millions of calls while earthworks and houses are placed): no allocation per segment, and a
    // segment whose bounding box is already farther than the best distance is skipped (exact).
    const valleyW = this.valleys.map((v) => {
      // beyond 8 sigma of the whole path the weight is under 1e-13 of the depth
      const bx = x < v.box[0] ? v.box[0] - x : x > v.box[2] ? x - v.box[2] : 0;
      const bz = z < v.box[1] ? v.box[1] - z : z > v.box[3] ? z - v.box[3] : 0;
      const far = 8 * v.sigma;
      if (bx * bx + bz * bz > far * far) return 0;
      let d2 = Infinity;
      const pts = v.pts;
      for (let i = 1; i < pts.length; i++) {
        const ax = pts[i - 1][0], az = pts[i - 1][1], cx = pts[i][0], cz = pts[i][1];
        const ex = x < ax && x < cx ? Math.min(ax, cx) - x : x > ax && x > cx ? x - Math.max(ax, cx) : 0;
        const ez = z < az && z < cz ? Math.min(az, cz) - z : z > az && z > cz ? z - Math.max(az, cz) : 0;
        if (ex * ex + ez * ez >= d2) continue;
        const dx = cx - ax, dz = cz - az;
        let f = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9);
        f = f < 0 ? 0 : f > 1 ? 1 : f;
        const qx = x - (ax + dx * f), qz = z - (az + dz * f);
        const q2 = qx * qx + qz * qz;
        if (q2 < d2) d2 = q2;
      }
      return v.depth * Math.exp(-d2 / (2 * v.sigma * v.sigma));
    });
    const west = this.hasRiver ? smoothstep(-1900, -2500, x) : 0;
    let base = 0;
    if (!this.hasRiver) {
      const along = (x * this.slope[0] + z * this.slope[1]) / (Math.hypot(this.slope[0], this.slope[1]) || 1);
      const reach = Math.max(-this.slopeReach, Math.min(this.slopeReach, along));
      base = this.base + reach * Math.hypot(this.slope[0], this.slope[1]);
    }
    let lidar: number | undefined;
    let lidarW: number | undefined;
    const g = this.grid;
    if (g && this.gridExtend > 0) {
      // the grid's edge carries on outwards (no ramp to a flat analytic base at the edge), fading out far away
      const w = g.sampleMaskClamped(x, z) * (1 - smoothstep(0, this.gridExtend, g.distanceOutside(x, z)));
      if (w > 0.001) {
        lidar = g.sampleClamped(x, z) - this.gridDatum;
        lidarW = w;
      }
    } else if (g && g.contains(x, z)) {
      let w = g.edgeWeight(x, z, this.gridBlend) * g.sampleMask(x, z);
      // "upland-only": never near the modelled river; distance back from the bank (ignoring year-dependent setback)
      if (this.gridMode === "upland-only") w *= smoothstep(this.gridClear[0], this.gridClear[1], side >= 0 ? best - l : best - r);
      if (w > 0.001) {
        lidar = g.sample(x, z) - this.gridDatum;
        lidarW = w;
      }
    }
    let inlet = -1, inletW = 0;
    for (let i = 0; i < this.inlets.length; i++) {
      const q = this.inlets[i];
      const dx = x - q.x, dz = z - q.z;
      const along = dx * q.ux + dz * q.uz;
      if (along < -1 || along > q.length) continue;
      const across = Math.abs(-dx * q.uz + dz * q.ux);
      if (across > q.half + 0.5) continue;
      // a revetted cut: full depth from just inside the head and the sides
      const w = smoothstep(-0.5, 1.0, along) * (1 - smoothstep(q.half - 1.0, q.half + 0.5, across)) * (1 - smoothstep(q.length - 10, q.length, along));
      if (w > inletW) { inletW = w; inlet = i; }
    }
    return {
      dRiver: best * side,
      leftHalf: l,
      rightHalf: r,
      reclaimWeight: w,
      upland: hills,
      valleyW,
      eyot,
      shoal,
      shoalW,
      micro: fbm(x / 90, z / 90, 4) - 0.5,
      marshNoise: fbm(x / 140 + 31.7, z / 140 - 12.3, 4),
      west,
      base,
      lidar,
      lidarW,
      inlet,
      inletW,
    };
  }

  /** Height from a precomputed static sample (fast path for the mesh). */
  heightFrom(s: StaticSample, p: TerrainYearParams): number {
    const h = this.landHeightFrom(s, p);
    // an open dock inlet: the frontage either side is reclaimed, the dock is kept as water down to its bed
    if (s.inletW && s.inlet != null && s.inlet >= 0 && (p.inlets?.[s.inlet] ?? 0) > 0) {
      const bed = INLET_BED + s.micro * 0.2;
      if (h > bed) return h - (h - bed) * s.inletW;
    }
    return h;
  }

  /** Height without the dated inlets: the bank either side of a dock carried across it (where a frontage's line runs). */
  landHeightFrom(s: StaticSample, p: TerrainYearParams): number {
    const h = this.baseHeight(s, p);
    if (s.shoalW < 0.005) return h;
    // a shoal raises whatever is there (river bed, foreshore or bank) towards its crest, never lowers it
    const crest = s.shoal + s.micro * 0.25;
    return Math.max(h, h + (crest - h) * smoothstep(0.12, 0.72, s.shoalW));
  }

  private baseHeight(s: StaticSample, p: TerrainYearParams): number {
    if (!this.hasRiver) {
      let h = s.base + s.upland;
      for (let i = 0; i < s.valleyW.length; i++) h -= s.valleyW[i] * (1 - (p.valleyFill[i] ?? 0));
      h += s.micro * 1.2;
      if (s.lidarW && s.lidar !== undefined) {
        // LIDAR "natural" surface replaces the analytic relief; dated valleys (ditches that silt up) are still cut into it
        let gh = s.lidar;
        for (let i = 0; i < s.valleyW.length; i++) if (this.valleyDated[i]) gh -= s.valleyW[i] * (1 - (p.valleyFill[i] ?? 0));
        h = h * (1 - s.lidarW) + gh * s.lidarW;
      }
      return Math.max(MIN_LAND, h);
    }
    const left = s.dRiver >= 0;
    const dn = left ? s.dRiver - (s.leftHalf + p.setback * s.reclaimWeight) : -s.dRiver - s.rightHalf;
    // river bed
    if (dn < -30) return -1.6 - 2.2 * smoothstep(30, 100, -dn) + s.micro * 0.3;
    // foreshore: a smooth ramp through the waterline (y = 0 at about dn = -4)
    const shore = -1.6 + ((dn + 30) / 42) * 2.6;
    const d = Math.max(0, dn);
    let land: number;
    if (left) {
      // Left bank: the gravel terraces of the City, the Strand and (lower) Westminster.
      const lowland = 1 - 0.62 * s.west;
      land = 1.6 + 8.5 * lowland * smoothstep(0, 260, d) + 0.0035 * Math.min(d, 1400) * lowland + s.upland * smoothstep(0, 220, d);
      for (let i = 0; i < s.valleyW.length; i++) land -= s.valleyW[i] * (1 - p.valleyFill[i]) * smoothstep(0, 60, d + 40);
      land += s.micro * 1.2;
      land = Math.max(land, 1.0 + 0.6 * smoothstep(0, 25, d));
    } else {
      // Right bank: low floodplain. Tidal marsh with channels and gravel eyots until embanked.
      // Embankment only takes effect in the Southwark sector; Lambeth Marsh stays marsh past 1625.
      const embank = p.embank * (1 - s.west * 0.85);
      const channel = smoothstep(0.5, 0.42, s.marshNoise) * (1 - smoothstep(900, 1500, d));
      const marsh = 0.55 + s.micro * 0.5 - 1.6 * channel + Math.max(0, s.eyot - 0.3);
      const firm = 1.9 + 0.0012 * Math.min(d, 1200) + s.micro * 0.6 + s.eyot * 0.4;
      const rise = smoothstep(700, 1500, d); // floodplain edge rises gently to the south
      const natural = marsh * (1 - rise) + (firm + 2) * rise;
      land = natural * (1 - embank) + firm * embank;
    }
    // "upland-only" LIDAR relief, blended in only on trusted ground well back from the river
    if (s.lidarW && s.lidar !== undefined) land = land * (1 - s.lidarW) + s.lidar * s.lidarW;
    if (dn >= 12) return land;
    const t = smoothstep(-2, 12, dn);
    return shore * (1 - t) + land * t;
  }

  height(x: number, z: number, t: number): number {
    return this.heightFrom(this.staticSample(x, z), this.yearParams(t));
  }

  /**
   * Is ground at height y clear of the water by `margin` metres? Always true on a site
   * without a river. Placement code uses this instead of comparing heights with 0.
   */
  dry(y: number, margin = 0): boolean {
    return !this.hasRiver || y >= margin;
  }

  /** Height the camera and walkers may not go below: the water surface, or the ground itself where there is no water. */
  floor(y: number): number {
    return this.hasRiver ? Math.max(0, y) : y;
  }

  /** Fraction (0..1) of original woodland surviving at this spot. Deterministic per location. */
  woodlandThreshold(x: number, z: number): number {
    return noise2(x / 23.1 + 5.5, z / 23.1 - 8.2) * 0.6 + noise2(x / 260, z / 260) * 0.4;
  }

  // ------------------------------------------------------------------------------------------------
  // The ground over a span of years. Everything placed once (a house, a landmark, a road ribbon, a
  // quay, a tree) must suit the ground of every year it is shown, not only of one representative year.
  // ------------------------------------------------------------------------------------------------

  private keyT: number[] | null = null;
  private ypMemo = new Map<number, TerrainYearParams>();
  /** yearParams, remembered for the times the span helpers sample (a shared grid, so the same times recur). */
  private ypAt(t: number): TerrainYearParams {
    let p = this.ypMemo.get(t);
    if (!p) {
      p = this.yearParams(t);
      if (this.ypMemo.size > 20000) this.ypMemo.clear();
      this.ypMemo.set(t, p);
    }
    return p;
  }

  /** Timeline values of every keyframe of the year-dependent ground (bank setback, embankment, valley fills), sorted. */
  keyTimes(): number[] {
    if (!this.keyT) {
      const r = this.site.river;
      const ks = [...(r?.northBankSetback ?? []), ...(r?.southEmbankment ?? []), ...(this.site.terrain?.valleys ?? []).flatMap((v) => v.fill ?? [])];
      const inl = this.inlets.flatMap((q) => [q.t0, q.t1]).filter((v) => isFinite(v));
      this.keyT = [...new Set([...ks.map((k) => histToT(k.year)), ...inl])].sort((a, b) => a - b);
    }
    return this.keyT;
  }

  /**
   * Times covering [t0, t1]: both ends, every keyframe between, and, while the ground is changing (between the first
   * and last keyframe), every multiple of `step` years (a shared grid, so the same times recur for every caller).
   */
  sampleTimes(t0: number, t1: number, step = 20): number[] {
    const k = this.keyTimes();
    const out = [t0];
    if (!(t1 > t0)) return out;
    const kMin = k.length ? k[0] : Infinity, kMax = k.length ? k[k.length - 1] : -Infinity;
    for (const q of k) if (q > t0 && q < t1) out.push(q);
    const a = Math.max(t0, kMin), b = Math.min(t1, kMax);
    for (let t = Math.ceil(a / step) * step; t < b; t += step) if (t > t0) out.push(t);
    out.push(t1);
    out.sort((p, q) => p - q);
    return out.filter((v, i) => i === 0 || v > out[i - 1]);
  }

  /** Lowest and highest ground at each sample over [t0, t1]. */
  groundRange(samples: StaticSample[], t0: number, t1: number): { min: number[]; max: number[] } {
    const min = samples.map(() => Infinity), max = samples.map(() => -Infinity);
    for (const t of this.sampleTimes(t0, t1)) {
      const p = this.ypAt(t);
      samples.forEach((s, j) => {
        const h = this.heightFrom(s, p);
        if (h < min[j]) min[j] = h;
        if (h > max[j]) max[j] = h;
      });
    }
    return { min, max };
  }

  /** First time in [t0, t1] at which any sample's ground is below `level` (null if never). Resolved to about a year. */
  firstBelow(samples: StaticSample[], t0: number, t1: number, level: number): number | null {
    const below = (t: number) => {
      const p = this.ypAt(t);
      return samples.some((s) => this.heightFrom(s, p) < level);
    };
    const ts = this.sampleTimes(t0, t1, 10);
    if (below(ts[0])) return ts[0];
    for (let i = 1; i < ts.length; i++) {
      if (!below(ts[i])) continue;
      let a = ts[i - 1], b = ts[i];
      while (b - a > 1) {
        const m = (a + b) / 2;
        if (below(m)) b = m;
        else a = m;
      }
      return b;
    }
    return null;
  }

  /**
   * Split [t0, t1] into consecutive spans over which the ground at every sample stays within `tol` metres of one
   * level. Something set once per span on the ground of the span's middle year then neither floats nor sinks by
   * more than about tol / 2 in any year of that span. Returns [start, end] pairs that cover [t0, t1] exactly;
   * a single pair when the ground does not move that much.
   */
  groundSpans(samples: StaticSample[], t0: number, t1: number, tol: number): [number, number][] {
    if (!(t1 > t0) || !samples.length || !isFinite(t0) || !isFinite(t1)) return [[t0, t1]];
    const at = (t: number) => {
      const p = this.ypAt(t);
      return samples.map((s) => this.heightFrom(s, p));
    };
    const ts = this.sampleTimes(t0, t1);
    const out: [number, number][] = [];
    let start = t0;
    let lo = at(t0), hi = lo.slice();
    const fits = (h: number[]) => h.every((v, j) => Math.max(hi[j], v) - Math.min(lo[j], v) <= tol);
    let prevT = t0;
    let i = 1;
    while (i < ts.length) {
      const h = at(ts[i]);
      if (fits(h)) {
        h.forEach((v, j) => { lo[j] = Math.min(lo[j], v); hi[j] = Math.max(hi[j], v); });
        prevT = ts[i];
        i++;
        continue;
      }
      // the ground leaves the band between prevT and ts[i]: find where, to about a year
      let a = prevT, b = ts[i];
      while (b - a > 1) {
        const m = (a + b) / 2;
        if (fits(at(m))) a = m;
        else b = m;
      }
      const cut = Math.min(t1, Math.max(start + 0.5, a));
      if (cut >= t1) break;
      out.push([start, cut]);
      start = cut;
      lo = at(cut);
      hi = lo.slice();
      prevT = cut;
      // re-test ts[i] against the new band (unless the cut already passed it)
      if (cut >= ts[i]) i++;
    }
    out.push([start, t1]);
    return out;
  }
}
