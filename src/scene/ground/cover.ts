import * as THREE from "three";
import { pointSegment, smoothstep } from "@/lib/geo";
import { sampleKeyframes } from "@/lib/lifecycle";
import type { StaticSample } from "@/lib/terrain";
import { histToT } from "@/lib/years";
import type { ExtraContext } from "../extras";
import { groundMoisture, periodWeights, siteGround, siteHeightRef, type SiteGround } from "./land";
import { OPEN_CELL, PRE_CELL, fieldsAt, hsh, vnz } from "./landPattern";

/**
 * Ground-cover field around the camera: a small window of cells (CPU) that reproduces the land-cover
 * logic of terrainMesh.ts (woodland floor, marsh, fields, trodden urban ground, foreshore) from the
 * terrain model, the zones and the road corridors at the current year. It is uploaded as three
 * half-float textures that the vertex shaders of the grass, reed and stone layers and the fragment
 * shader of the ground decal read.
 *
 *   A (linear):  r grass, g reed, b foreshore, a built-up (trodden) ground
 *   B (linear):  r height above uH0, g road weight, b/a road direction as (cos 2a, sin 2a) * weight
 *   C (nearest): r farmed-patch weight, g furrow angle, b marsh wetness, a woodland floor
 *
 * The arable patches and their furrow direction follow the same generic field layout as the baked land texture
 * (./landPattern.ts, ./land.ts), so the furrows round the camera run along the strips seen from above.
 */
export const COVER_N = 96;
export const COVER_CELL = 3;
export const COVER_SIZE = COVER_N * COVER_CELL;

/** A road (ruts, no grass) or a built structure strip (quay, wharf, stream bed: no ground cover at all). */
interface Strip {
  path: [number, number][];
  half: number;
  t0: number;
  t1: number;
  kind: "road" | "struct";
}

interface Cache {
  cx: number;
  cz: number;
  ox: number;
  oz: number;
  st: StaticSample[];
  /** Per cell: arable lot (hash) and furrow angle for the small-field and the open-field layouts, the open
   * field's great-field lot, and the static noise terms of the land shader (moisture, woodland edge). */
  hPre: Float32Array;
  aPre: Float32Array;
  hOpen: Float32Array;
  aOpen: Float32Array;
  gOpen: Float32Array;
  nM: Float32Array;
  nF: Float32Array;
  wood: Float32Array;
  zones: { zi: number; w: Float32Array }[];
  row: number;
}

interface Paint {
  cache: Cache;
  key: string;
  t: number;
  row: number;
  a: Float32Array;
  b: Float32Array;
  c: Float32Array;
  acts: number[];
  struct: Float32Array;
  stats: CoverStats;
  roadsDone: boolean;
}

export interface CoverStats {
  grass: number;
  reed: number;
  shore: number;
  urban: number;
  field: number;
}

export class CoverField {
  readonly uniforms = {
    uTexA: { value: null as THREE.DataTexture | null },
    uTexB: { value: null as THREE.DataTexture | null },
    uTexC: { value: null as THREE.DataTexture | null },
    uTexOrigin: { value: new THREE.Vector2(1e7, 1e7) },
    uTexSize: { value: COVER_SIZE },
    uH0: { value: 0 },
    uTime: { value: 0 },
  };
  stats: CoverStats = { grass: 0, reed: 0, shore: 0, urban: 0, field: 0 };
  ready = false;
  private texA: THREE.DataTexture;
  private texB: THREE.DataTexture;
  private texC: THREE.DataTexture;
  private live: Cache | null = null;
  private liveKey = "";
  private building: Paint | null = null;
  private pendingCache: Cache | null = null;
  readonly hasRiver: boolean;
  private strips: Strip[] = [];
  private ground: SiteGround;
  private hRef: number;

  constructor(private ctx: ExtraContext) {
    const { ds, terrain } = ctx;
    this.ground = siteGround(ds.site.id);
    this.hRef = siteHeightRef(ds, terrain);
    const tEnd = histToT(ds.site.timeline.end) + 1;
    for (const lm of ds.landmarks) {
      const path = (lm.path ?? []).map(([la, lo]) => terrain.proj.toLocal(la, lo));
      for (const phase of lm.phases) {
        const kind = phase.model.kind;
        const mm = phase.model as Record<string, unknown>;
        const own = Array.isArray(mm.path) ? (mm.path as [number, number][]).map(([la, lo]) => terrain.proj.toLocal(la, lo)) : path;
        if (own.length < 2) continue;
        const t0 = histToT(phase.from);
        const t1 = phase.to != null ? histToT(phase.to) + 4 : tEnd + 1;
        const tEndP = phase.goneBy != null ? histToT(phase.goneBy) : t1;
        const w = typeof mm.width === "number" ? mm.width : 5;
        if (kind === "road") this.strips.push({ path: own, half: w / 2, t0, t1: tEndP, kind: "road" });
        else if (kind === "quay" || kind === "waterfront") {
          // like the builders: walk from the path towards the river to the waterline; the structure stands inland of it
          const dir = kind === "waterfront" && typeof mm.side === "number" ? (mm.side as number) : 1;
          const back = kind === "quay" ? (w + 12) / 2 + 1 : 7;
          const yp = terrain.yearParams(histToT(phase.built ?? phase.from) + 3);
          const ground = (gx: number, gz: number) => terrain.heightFrom(terrain.staticSample(gx, gz), yp);
          const pts: [number, number][] = [];
          for (let i = 1; i < own.length; i++) {
            const [ax, az] = own[i - 1], [bx, bz] = own[i];
            const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 12));
            for (let k = i === 1 ? 0 : 1; k <= n; k++) {
              const x = ax + ((bx - ax) * k) / n;
              let z = az + ((bz - az) * k) / n;
              let guard = 0;
              if (ground(x, z) > 0.4) while (ground(x, z) > 0.4 && guard++ < 80) z += dir * 2;
              else while (ground(x, z) <= 0.4 && guard++ < 80) z -= dir * 2;
              pts.push([x, z - dir * back]);
            }
          }
          if (pts.length > 1) this.strips.push({ path: pts, half: back + 3, t0, t1: tEndP, kind: "struct" });
        }
        else if (kind === "stream") this.strips.push({ path: own, half: w / 2 + 0.5, t0, t1: tEndP, kind: "struct" });
      }
    }
    const mk = (nearest: boolean) => {
      const t = new THREE.DataTexture(new Uint16Array(COVER_N * COVER_N * 4), COVER_N, COVER_N, THREE.RGBAFormat, THREE.HalfFloatType);
      t.minFilter = t.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      return t;
    };
    this.texA = mk(false);
    this.texB = mk(false);
    this.texC = mk(true);
    this.uniforms.uTexA.value = this.texA;
    this.uniforms.uTexB.value = this.texB;
    this.uniforms.uTexC.value = this.texC;
    this.hasRiver = ctx.terrain.hasRiver;
    // read-only handle for look development
    if (typeof window !== "undefined") (window as unknown as { __ltCover?: CoverField }).__ltCover = this;
  }

  dispose(): void {
    this.texA.dispose();
    this.texB.dispose();
    this.texC.dispose();
  }

  private yearKey(t: number): string {
    const { terrain, ds, fabric } = this.ctx;
    const yp = terrain.yearParams(t);
    const cover = sampleKeyframes(ds.site.woodland.cover, t);
    const acts = fabric.zoneGeoms.map((zg) => fabric.activity(zg, t));
    const roads = this.strips.map((c) => (t >= c.t0 && t <= c.t1 ? 1 : 0)).join("");
    return [yp.setback.toFixed(0), yp.embank.toFixed(2), yp.valleyFill.map((v) => v.toFixed(2)).join(), (yp.inlets ?? []).join(""), cover.toFixed(2), acts.map((a) => a.toFixed(1)).join(""), roads].join("|");
  }

  /** Is the live window good for this centre? */
  covers(cx: number, cz: number, margin: number): boolean {
    return !!this.live && Math.abs(cx - this.live.cx) < COVER_SIZE / 2 - margin && Math.abs(cz - this.live.cz) < COVER_SIZE / 2 - margin;
  }

  /**
   * Advance the incremental rebuild. `budgetMs` bounds the CPU time spent this frame; the first build
   * (nothing live yet) may be run with a large budget so the ground appears at once.
   */
  update(t: number, cx: number, cz: number, budgetMs: number): void {
    const t0 = performance.now();
    const key = this.yearKey(t);
    if (!this.building) {
      if (!this.live || !this.covers(cx, cz, 70)) {
        // (re)centre: a new window snapped to a coarse grid so texel positions stay stable
        const snap = COVER_CELL * 8;
        const sx = Math.round(cx / snap) * snap, sz = Math.round(cz / snap) * snap;
        if (!this.pendingCache || this.pendingCache.cx !== sx || this.pendingCache.cz !== sz) this.pendingCache = this.newCache(sx, sz);
        const c = this.pendingCache;
        while (c.row < COVER_N && performance.now() - t0 < budgetMs) this.cacheRow(c);
        if (c.row >= COVER_N) {
          this.building = this.newPaint(c, key, t);
          this.pendingCache = null;
        }
      } else if (key !== this.liveKey) {
        this.building = this.newPaint(this.live, key, t);
      }
    }
    const p = this.building;
    if (p) {
      if (!p.roadsDone) this.paintRoads(p);
      while (p.row < COVER_N && performance.now() - t0 < budgetMs) this.paintRow(p);
      if (p.row >= COVER_N) this.publish(p);
    }
  }

  private newCache(cx: number, cz: number): Cache {
    const { terrain, fabric } = this.ctx;
    const n = COVER_N * COVER_N;
    const ox = cx - COVER_SIZE / 2, oz = cz - COVER_SIZE / 2;
    const c: Cache = {
      cx, cz, ox, oz, st: new Array<StaticSample>(n), hPre: new Float32Array(n), aPre: new Float32Array(n), hOpen: new Float32Array(n), aOpen: new Float32Array(n),
      gOpen: new Float32Array(n), nM: new Float32Array(n), nF: new Float32Array(n), wood: new Float32Array(n), zones: [], row: 0,
    };
    const pad = 30;
    fabric.zoneGeoms.forEach((zg, zi) => {
      if (zg.bbox[2] < ox - pad || zg.bbox[0] > ox + COVER_SIZE + pad || zg.bbox[3] < oz - pad || zg.bbox[1] > oz + COVER_SIZE + pad) return;
      c.zones.push({ zi, w: new Float32Array(n) });
    });
    void terrain;
    return c;
  }

  private cacheRow(c: Cache): void {
    const { terrain, fabric } = this.ctx;
    const j = c.row++;
    const z = c.oz + (j + 0.5) * COVER_CELL;
    for (let i = 0; i < COVER_N; i++) {
      const k = j * COVER_N + i;
      const x = c.ox + (i + 0.5) * COVER_CELL;
      c.st[k] = terrain.staticSample(x, z);
      c.wood[k] = terrain.woodlandThreshold(x, z);
      // the land shader's field layouts (same hashes and seeds as ./land.ts)
      const ba = this.ground.baseAng;
      const fp = fieldsAt(x, z, PRE_CELL, ba);
      c.hPre[k] = hsh(fp.idx, fp.idy, 31);
      c.aPre[k] = fp.ang;
      const fo = fieldsAt(x, z, OPEN_CELL, ba);
      c.hOpen[k] = hsh(fo.idx, fo.idy, 41);
      // strips run along the row (lp.x) or across it, by furlong
      c.aOpen[k] = fo.ang + (hsh(fo.idx, fo.idy, 42) >= 0.5 ? Math.PI / 2 : 0);
      c.gOpen[k] = hsh(fo.rx, fo.ry, 44);
      c.nM[k] = (vnz(x / 650, z / 650, 21) - 0.5) * 0.3 + (vnz(x / 170, z / 170, 22) - 0.5) * 0.18;
      c.nF[k] = (vnz(x / 43, z / 43, 23) - 0.5) * 0.45 + (vnz(x / 11, z / 11, 24) - 0.5) * 0.2;
      for (const zz of c.zones) {
        const zg = fabric.zoneGeoms[zz.zi];
        if (x < zg.bbox[0] - 30 || x > zg.bbox[2] + 30 || z < zg.bbox[1] - 30 || z > zg.bbox[3] + 30) continue;
        zz.w[k] = zg.weight(x, z);
      }
    }
  }

  private newPaint(cache: Cache, key: string, t: number): Paint {
    const n = COVER_N * COVER_N * 4;
    return {
      cache, key, t, row: 0, a: new Float32Array(n), b: new Float32Array(n), c: new Float32Array(n),
      acts: this.ctx.fabric.zoneGeoms.map((zg) => this.ctx.fabric.activity(zg, t)),
      struct: new Float32Array(COVER_N * COVER_N),
      stats: { grass: 0, reed: 0, shore: 0, urban: 0, field: 0 },
      roadsDone: false,
    };
  }

  /** Rasterise the active roads (B.gba: weight and double-angle direction) and structure strips (p.struct). */
  private paintRoads(p: Paint): void {
    p.roadsDone = true;
    const { cache: c, t } = p;
    for (const cor of this.strips) {
      if (t < cor.t0 || t > cor.t1) continue;
      const road = cor.kind === "road";
      const core = Math.max(1.2, cor.half);
      const reach = (road ? core * 1.4 : core) + COVER_CELL;
      for (let s = 1; s < cor.path.length; s++) {
        const [ax, az] = cor.path[s - 1], [bx, bz] = cor.path[s];
        const x0 = Math.min(ax, bx) - reach, x1 = Math.max(ax, bx) + reach, z0 = Math.min(az, bz) - reach, z1 = Math.max(az, bz) + reach;
        if (x1 < c.ox || x0 > c.ox + COVER_SIZE || z1 < c.oz || z0 > c.oz + COVER_SIZE) continue;
        const i0 = Math.max(0, Math.floor((x0 - c.ox) / COVER_CELL)), i1 = Math.min(COVER_N - 1, Math.ceil((x1 - c.ox) / COVER_CELL));
        const j0 = Math.max(0, Math.floor((z0 - c.oz) / COVER_CELL)), j1 = Math.min(COVER_N - 1, Math.ceil((z1 - c.oz) / COVER_CELL));
        const th = Math.atan2(bz - az, bx - ax);
        const c2 = Math.cos(2 * th), s2 = Math.sin(2 * th);
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const x = c.ox + (i + 0.5) * COVER_CELL, z = c.oz + (j + 0.5) * COVER_CELL;
            const d = pointSegment(x, z, ax, az, bx, bz).d;
            const k = j * COVER_N + i;
            if (!road) {
              const w = 1 - smoothstep(core * 0.8, core * 1.1, d);
              if (w > p.struct[k]) p.struct[k] = w;
              continue;
            }
            const w = 1 - smoothstep(core * 0.6, core * 1.4, d);
            const o = k * 4;
            if (w > p.b[o + 1]) {
              p.b[o + 1] = w;
              p.b[o + 2] = c2 * w;
              p.b[o + 3] = s2 * w;
            }
          }
      }
    }
  }

  private paintRow(p: Paint): void {
    const { terrain, ds } = this.ctx;
    const c = p.cache;
    const t = p.t;
    const yp = terrain.yearParams(t);
    const cover = sampleKeyframes(ds.site.woodland.cover, t);
    const pw = periodWeights(t, this.ground);
    const river = this.hasRiver;
    const j = p.row++;
    const st = p.stats;
    for (let i = 0; i < COVER_N; i++) {
      const k = j * COVER_N + i;
      const o = k * 4;
      const s = c.st[k];
      const h = terrain.heightFrom(s, yp);
      p.b[o] = h;
      const road = p.b[o + 1];
      const sw = 1 - p.struct[k];
      let urban = 0;
      for (const zz of c.zones) {
        const a = p.acts[zz.zi];
        if (a > 0.02) urban = Math.max(urban, zz.w[k] * a);
      }
      const uu = Math.min(1, urban * 1.15) * sw;
      let grass = 0, reed = 0, shore = 0, wetOut = 0, field = 0, wdOut = 0, ang = 0;
      if (!(river && h < -0.15)) {
        const right = river && s.dRiver < 0;
        const wet = right ? (1 - yp.embank * (1 - s.west * 0.85)) * (1 - smoothstep(1.6, 3.2, h)) : 0;
        const wd = smoothstep(c.wood[k] - 0.06, c.wood[k] + 0.06, cover) * (1 - wet * 0.6);
        const sF = wd * 0.9;
        // arable, as the land shader decides it: suitable ground (not wood, marsh, settlement or waterlogged), then
        // the field's own lot against the period's arable share
        const forest = smoothstep(0.32, 0.68, wd + c.nF[k]);
        const m = Math.min(1, Math.max(0, groundMoisture(s, h, yp, river, this.hRef) + c.nM[k]));
        const suit = (1 - forest) * (1 - smoothstep(0.05, 0.3, wet)) * (1 - smoothstep(0.08, 0.4, uu)) * (1 - smoothstep(0.6, 0.88, m)) * (river ? smoothstep(0.9, 1.6, h) : 1);
        const ap = Math.min(0.95, pw.arable);
        const arPre = c.hPre[k] < ap * suit ? 1 : 0;
        const arOpen = c.hOpen[k] < ap * suit * 1.2 && c.gOpen[k] >= 0.33 ? 1 : 0;
        const sY = pw.farm * (pw.pre * arPre + pw.open * arOpen) * (1 - forest) * (1 - uu);
        ang = pw.open > pw.pre ? c.aOpen[k] : c.aPre[k];
        wetOut = wet;
        wdOut = sF;
        field = sY > 0.3 ? sY : 0;
        // open grass: not woodland floor, not trodden ground, not mud
        const ramp = river ? wet * smoothstep(0.15, 0.5, h) + (1 - wet) * smoothstep(0.9, 1.7, h) : 1;
        grass = ramp * (1 - 0.5 * wet) * (1 - sF) * (1 - uu) * (1 - road) * (1 - 0.3 * sY);
        if (river) {
          const patchy = Math.min(1.2, 0.35 + (s.micro + 0.5) * 1.1 + (s.marshNoise - 0.4) * 0.8);
          reed = wet * smoothstep(-0.1, 0.3, h) * (1 - smoothstep(1.4, 2.3, h)) * patchy * (1 - uu) * (1 - sF * 0.6);
          // a thin fringe of sedge on soft tidal margins elsewhere
          reed += (1 - wet) * smoothstep(0.15, 0.4, h) * (1 - smoothstep(0.6, 1.0, h)) * 0.3 * (1 - uu) * Math.max(0, (s.micro + 0.5) * 1.6 - 0.6);
          shore = smoothstep(-0.25, 0.05, h) * (1 - smoothstep(0.9, 1.5, h)) * (1 - wet * 0.7) * (1 - uu * 0.5);
        }
        grass = Math.max(0, Math.min(1, grass));
        reed = Math.max(0, Math.min(1, reed));
      }
      p.a[o] = grass * sw;
      p.a[o + 1] = reed * sw;
      p.a[o + 2] = shore * sw;
      p.a[o + 3] = uu;
      p.c[o] = field * sw;
      p.c[o + 1] = ang;
      p.c[o + 2] = wetOut;
      p.c[o + 3] = wdOut;
      if (grass > st.grass) st.grass = grass;
      if (reed > st.reed) st.reed = reed;
      if (shore > st.shore) st.shore = shore;
      if (uu > st.urban) st.urban = uu;
      if (road > st.urban) st.urban = road;
      if (field > st.field) st.field = field;
    }
  }

  private publish(p: Paint): void {
    const H = THREE.DataUtils.toHalfFloat;
    const c = p.cache;
    const mid = (COVER_N >> 1) * COVER_N + (COVER_N >> 1);
    const h0 = Math.round(p.b[mid * 4]);
    const n = COVER_N * COVER_N;
    const da = this.texA.image.data as unknown as Uint16Array, db = this.texB.image.data as unknown as Uint16Array, dc = this.texC.image.data as unknown as Uint16Array;
    for (let k = 0; k < n * 4; k++) {
      da[k] = H(p.a[k]);
      dc[k] = H(p.c[k]);
      db[k] = H(k % 4 === 0 ? p.b[k] - h0 : p.b[k]);
    }
    this.texA.needsUpdate = true;
    this.texB.needsUpdate = true;
    this.texC.needsUpdate = true;
    this.uniforms.uTexOrigin.value.set(c.ox, c.oz);
    this.uniforms.uH0.value = h0;
    this.stats = p.stats;
    this.live = c;
    this.liveKey = p.key;
    this.building = null;
    this.ready = true;
  }
}
