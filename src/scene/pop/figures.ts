import * as THREE from "three";
import { tToHist } from "@/lib/years";
import type { LandmarkLayer } from "../landmarks";
import { loadFigureManifest, loadFigureSet, loadFigureShared, setForYear, type FigureManifest, type FigureSetAsset } from "./figureAssets";
import { FIG_MODE, figureDepthMaterial, figureMaterial, type FigureShared } from "./figureShader";
import type { MotionMesh } from "./motion";

/**
 * ILLUSTRATIVE LAYER. The populace's people drawn as instanced MakeHuman-based figures in period dress (see
 * docs/FIGURES.md). PopWorld (world.ts) decides, exactly as before, who stands or walks where and when, and pushes each
 * person into a pool here with the same arguments it gives the block figures; this layer only chooses a body of that
 * body type, an outfit of the period, the colours of the other garments, and a level of detail by distance.
 */

/** Same signature as MotionMesh: PopWorld pushes into either. */
export interface PopPool {
  readonly n: number;
  readonly full: boolean;
  reset(): void;
  commit(): void;
  push(
    x0: number, z0: number, dx: number, dz: number,
    L: number, phase: number, speed: number, lateral: number,
    h0: number, h1: number, h2: number, h3: number,
    r: number, g: number, b: number,
    scale: number, variant: number, presence: number, skin: number,
  ): void;
}

/** floats per instance: aBase 4, aMot 4, aH 4, aCol 3, aVar 4, aPal 4, aMode 4 */
const STRIDE = 27;
const ATTRS: [string, number, number][] = [["aBase", 0, 4], ["aMot", 4, 4], ["aH", 8, 4], ["aCol", 12, 3], ["aVar", 15, 4], ["aPal", 19, 4], ["aMode", 23, 4]];

const frac = (x: number): number => x - Math.floor(x);
/** number of levels the meshes of a set carry */
const bm0 = (m: Map<string, BodyMeshes>): number => m.values().next().value?.lods.length ?? 3;
const h1 = (a: number, k: number): number => frac(Math.sin(a * 12.9898 + k * 78.233) * 43758.5453);

/** Hair colours (linear): dark to fair; greys for the elderly. */
const HAIR = [[0.045, 0.032, 0.024], [0.09, 0.058, 0.036], [0.16, 0.11, 0.065], [0.3, 0.22, 0.12], [0.2, 0.085, 0.04], [0.025, 0.022, 0.02], [0.12, 0.08, 0.05]];
const GREY = [[0.32, 0.31, 0.29], [0.52, 0.51, 0.49], [0.22, 0.2, 0.18]];

function pack(r: number, g: number, b: number): number {
  const q = (v: number) => Math.round(Math.sqrt(Math.max(0, Math.min(1, v))) * 255);
  return q(r) * 65536 + q(g) * 256 + q(b);
}

interface BodyMeshes {
  idx: number;
  id: string;
  lods: THREE.Mesh[];
  geos: THREE.InstancedBufferGeometry[];
  arr: Float32Array[];
  attrs: THREE.InstancedBufferAttribute[][];
  n: number[];
}

interface Rec {
  data: Float32Array;
  body: Int16Array;
  n: number;
}

export interface FigureCaps {
  /** pool capacity per populace body type, and for seated figures (as the block meshes had) */
  people: number[];
  seated: number;
  quality: string;
}

class Pool implements PopPool {
  n = 0;
  constructor(private layer: FigureLayer, readonly type: number, readonly cap: number, readonly seated: boolean) {}
  get full(): boolean {
    return this.n >= this.cap;
  }
  reset(): void {
    if (this.type === 0 && !this.seated) this.layer.beginPeople();
    this.n = 0;
  }
  commit(): void {
    this.layer.dirty = true;
  }
  push(x0: number, z0: number, dx: number, dz: number, L: number, phase: number, speed: number, lateral: number, h0: number, hh1: number, hh2: number, hh3: number, r: number, g: number, b: number, scale: number, variant: number, presence: number, skin: number): void {
    if (this.n >= this.cap) return;
    this.n++;
    this.layer.addPerson(this.type, this.seated, x0, z0, dx, dz, L, phase, speed, lateral, h0, hh1, hh2, hh3, r, g, b, scale, variant, presence, skin);
  }
}

interface TroopBlock {
  group: THREE.Object3D;
  spots: Float32Array;
  tint: THREE.Color;
  set: string;
  blocks: THREE.Mesh[];
}

export class FigureLayer {
  readonly object = new THREE.Group();
  readonly pools: Pool[];
  readonly seatedPool: Pool;
  dirty = false;
  private manifest: FigureManifest | null = null;
  private shared: FigureShared | null = null;
  private failed = false;
  private sets = new Map<string, FigureSetAsset>();
  private meshes = new Map<string, Map<string, BodyMeshes>>();
  private people: Rec = { data: new Float32Array(4096 * STRIDE), body: new Int16Array(4096), n: 0 };
  private troopRec: Rec = { data: new Float32Array(1024 * STRIDE), body: new Int16Array(1024), n: 0 };
  private troops: TroopBlock[] = [];
  private troopKey = "";
  private activeSet = "";
  private lastCam = new THREE.Vector3(1e9, 0, 0);
  private lastDir = new THREE.Vector3();
  private lastBucket = -1;
  private frustum = new THREE.Frustum();
  private pm = new THREE.Matrix4();
  private readonly lod: [number, number, number];
  private readonly castLods: number;
  private bodyIndex = new Map<string, number>();
  private byType: number[][] = [];
  private soldierBodies: number[] = [];
  private stool: MotionMesh | null;
  private stoolPushed = 0;
  /** diagnostics */
  stats = { people: 0, troops: 0, drawn: [0, 0, 0, 0], culled: 0, ms: 0 };

  constructor(private caps: FigureCaps, private landmarks: LandmarkLayer | null, stool: MotionMesh | null) {
    this.object.name = "figures";
    this.pools = caps.people.map((c, t) => new Pool(this, t, c, false));
    this.seatedPool = new Pool(this, 0, caps.seated, true);
    this.stool = stool;
    const q = caps.quality;
    this.lod = q === "low" ? [0, 22, 60] : q === "medium" ? [8, 34, 85] : [12, 48, 110];
    this.castLods = q === "low" ? 0 : q === "medium" ? 1 : 2;
    Promise.all([loadFigureManifest(), loadFigureShared()])
      .then(([m, s]) => {
        this.manifest = m;
        this.shared = s;
        m.bodies.forEach((b, i) => {
          this.bodyIndex.set(b.id, i);
          (this.byType[b.type] ??= []).push(i);
        });
        this.soldierBodies = ["man_a", "man_b", "man_c", "tall", "stout_m"].map((id) => this.bodyIndex.get(id)).filter((x): x is number => x != null);
        this.findTroops();
      })
      .catch((e) => {
        console.warn("figures unavailable, keeping block figures", e);
        this.failed = true;
      });
  }

  get unavailable(): boolean {
    return this.failed;
  }

  /** True when the garment set for year t is loaded and drawable (starts loading it otherwise). */
  ready(t: number): boolean {
    if (!this.manifest || !this.shared || this.failed) return false;
    const name = setForYear(this.manifest, tToHist(t));
    if (!this.meshes.has(name)) {
      this.request(name);
      return false;
    }
    if (name !== this.activeSet) {
      this.activeSet = name;
      this.dirty = true;
    }
    return true;
  }

  private loading = new Set<string>();
  private request(name: string): void {
    if (this.loading.has(name) || this.meshes.has(name)) return;
    this.loading.add(name);
    loadFigureSet(name)
      .then((s) => {
        this.sets.set(name, s);
        this.meshes.set(name, this.buildMeshes(s));
        this.loading.delete(name);
      })
      .catch((e) => {
        console.warn("figure set failed", name, e);
        this.loading.delete(name);
        if (!this.meshes.size) this.failed = true;
      });
  }

  private buildMeshes(s: FigureSetAsset): Map<string, BodyMeshes> {
    const out = new Map<string, BodyMeshes>();
    const sh = this.shared!;
    for (const [id, b] of s.bodies) {
      const bi = this.bodyIndex.get(id)!;
      const info = this.manifest!.bodies[bi];
      const params = { x0: bi * this.manifest!.bones * 3, S1: info.S1, S2: info.S2, Sf: info.Sf, v0: info.v0 };
      const bm: BodyMeshes = { idx: bi, id, lods: [], geos: [], arr: [], attrs: [], n: b.lods.map(() => 0) };
      b.lods.forEach((base, li) => {
        const g = new THREE.InstancedBufferGeometry();
        for (const k of ["position", "normal", "uv", "_bones", "_weights", "_fig"]) g.setAttribute(k, base.getAttribute(k));
        g.setIndex(base.getIndex());
        g.instanceCount = 0;
        const cap = 64;
        const arr = new Float32Array(cap * STRIDE);
        const ib = new THREE.InstancedInterleavedBuffer(arr, STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
        const attrs = ATTRS.map(([name, off, size]) => {
          const a = new THREE.InterleavedBufferAttribute(ib, size, off) as unknown as THREE.InstancedBufferAttribute;
          g.setAttribute(name, a as unknown as THREE.BufferAttribute);
          return a;
        });
        // distant formations stand still: their coarse levels skip the skinning
        const still = s.name.endsWith("1471") || s.name.endsWith("1016") ? li >= 2 : false;
        const mat = figureMaterial(sh, params, li, `l${li}${still ? "s" : ""}`, still);
        const mesh = new THREE.Mesh(g, mat);
        mesh.name = `figure-${s.name}-${id}-${li}`;
        mesh.frustumCulled = false;
        mesh.castShadow = li < this.castLods;
        mesh.receiveShadow = true;
        mesh.customDepthMaterial = figureDepthMaterial(sh, params, li, `l${li}${still ? "s" : ""}`, still);
        mesh.userData.noPick = true;
        mesh.visible = false;
        mesh.layers.set(4);
        this.object.add(mesh);
        bm.lods.push(mesh);
        bm.geos.push(g);
        bm.arr.push(arr);
        bm.attrs.push(attrs);
      });
      out.set(id, bm);
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------- people
  beginPeople(): void {
    this.people.n = 0;
    this.stoolPushed = 0;
    this.stool?.reset();
  }

  private grow(rec: Rec): void {
    if (rec.n < rec.body.length) return;
    const nd = new Float32Array(rec.data.length * 2);
    nd.set(rec.data);
    const nb = new Int16Array(rec.body.length * 2);
    nb.set(rec.body);
    rec.data = nd;
    rec.body = nb;
  }

  addPerson(type: number, seated: boolean, x0: number, z0: number, dx: number, dz: number, L: number, phase: number, speed: number, lateral: number,
    h0: number, hh1: number, hh2: number, hh3: number, r: number, g: number, b: number, scale: number, variant: number, presence: number, skin: number): void {
    const m = this.manifest;
    if (!m) return;
    const set = this.sets.get(this.activeSet);
    if (!set) return;
    const seed = phase * 0.9137 + x0 * 0.0131 + z0 * 0.0173;
    let cands = seated ? [...(this.byType[0] ?? []), ...(this.byType[1] ?? []), ...(this.byType[5] ?? [])] : this.byType[type] ?? this.byType[0];
    if (!cands || !cands.length) return;
    const bi = cands[Math.floor(h1(seed, 1) * cands.length) % cands.length];
    const info = m.bodies[bi];
    const bset = set.bodies.get(info.id);
    if (!bset) return;
    // outfit: weighted by the populace's tunic/gown hint (women always take their gowns' weights)
    const gown = variant > 0.5 ? 1 : 0;
    const ws = bset.outfits.map((o) => o.w[gown]);
    const sum = ws.reduce((a, v) => a + v, 0) || 1;
    let u = h1(seed, 2) * sum, oi = 0;
    for (; oi < ws.length - 1; oi++) {
      u -= ws[oi];
      if (u < 0) break;
    }
    const mode = seated ? FIG_MODE.seated : L >= 0.5 ? FIG_MODE.auto : h1(seed, 3) < 0.45 ? FIG_MODE.talk : FIG_MODE.idle;
    this.write(this.people, bi, x0, z0, dx, dz, L, phase, speed, lateral, h0, hh1, hh2, hh3, r, g, b, scale, oi, presence, skin, mode, seed, info.elder, info.child);
    if (seated && this.stool && !this.stool.full) {
      this.stool.push(x0, z0, dx, dz, 0, phase, 0, 0, h0, h0, h0, h0, 1, 1, 1, 1, 0, presence, 0);
      this.stoolPushed++;
    }
  }

  private write(rec: Rec, bi: number, x0: number, z0: number, dx: number, dz: number, L: number, phase: number, speed: number, lateral: number,
    h0: number, hh1: number, hh2: number, hh3: number, r: number, g: number, b: number, scale: number, outfit: number, presence: number, skin: number,
    mode: number, seed: number, elder: boolean, child: boolean): void {
    this.grow(rec);
    const i = rec.n++;
    rec.body[i] = bi;
    const d = rec.data;
    const o = i * STRIDE;
    d[o] = x0; d[o + 1] = z0; d[o + 2] = dx; d[o + 3] = dz;
    d[o + 4] = L; d[o + 5] = phase; d[o + 6] = speed; d[o + 7] = lateral;
    d[o + 8] = h0; d[o + 9] = hh1; d[o + 10] = hh2; d[o + 11] = hh3;
    d[o + 12] = r; d[o + 13] = g; d[o + 14] = b;
    d[o + 15] = scale; d[o + 16] = outfit; d[o + 17] = presence; d[o + 18] = skin;
    // other garments from the same muted palette, a little darker; headwear often dark
    const pal = CLOTH_LIN;
    const pick = (k: number, dim: number): number => {
      const c = pal[Math.floor(h1(seed, k) * pal.length) % pal.length];
      const j = dim * (0.85 + 0.25 * h1(seed, k + 50));
      return pack(c[0] * j, c[1] * j, c[2] * j);
    };
    d[o + 19] = pick(11, 0.78);
    d[o + 20] = pick(12, 0.9);
    d[o + 21] = h1(seed, 13) < 0.45 ? pack(0.035, 0.032, 0.03) : pick(14, 0.75);
    const hc = elder && h1(seed, 15) < 0.8 ? GREY[Math.floor(h1(seed, 16) * GREY.length)] : HAIR[Math.floor(h1(seed, 17) * (child ? 5 : HAIR.length)) % HAIR.length];
    d[o + 22] = pack(hc[0], hc[1], hc[2]);
    d[o + 23] = mode;
    d[o + 24] = 0;
    d[o + 25] = 0;
    d[o + 26] = h1(seed, 18);
  }

  // ------------------------------------------------------------------------------------------- troops
  private findTroops(): void {
    this.troops = [];
    if (!this.landmarks) return;
    this.landmarks.root.traverse((o) => {
      const tr = o.userData?.troops as { spots: Float32Array; tint: string; year: number; mounted: boolean; mats: string[] } | undefined;
      if (!tr || tr.mounted) return;
      const blocks: THREE.Mesh[] = [];
      o.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (mesh.isMesh && tr.mats.includes(mesh.userData.mat as string)) blocks.push(mesh);
      });
      this.troops.push({ group: o, spots: tr.spots, tint: new THREE.Color(tr.tint), set: tr.year >= 1300 ? "barnet1471" : "brentford1016", blocks });
    });
  }

  private visibleChain(o: THREE.Object3D): boolean {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  /** Build the troop records for the visible formations (when the set of visible formations changes). */
  private updateTroops(): boolean {
    let key = "";
    const vis: TroopBlock[] = [];
    for (const tb of this.troops) {
      if (this.visibleChain(tb.group) && this.meshes.has(tb.set)) {
        vis.push(tb);
        key += tb.group.id + ",";
      } else if (this.visibleChain(tb.group)) this.request(tb.set);
    }
    if (key === this.troopKey) return false;
    this.troopKey = key;
    const rec = this.troopRec;
    rec.n = 0;
    for (const tb of vis) {
      // the figures replace the formation's block figures (the trampled ground and banners stay)
      for (const b of tb.blocks) b.visible = false;
      const set = this.sets.get(tb.set)!;
      const s = tb.spots;
      for (let i = 0; i < s.length; i += 5) {
        const seed = s[i] * 0.0731 + s[i + 2] * 0.0517 + i * 0.001;
        const bi = this.soldierBodies[Math.floor(h1(seed, 1) * this.soldierBodies.length) % this.soldierBodies.length];
        const bset = set.bodies.get(this.manifest!.bodies[bi].id);
        if (!bset) continue;
        const ws = bset.outfits.map((o) => o.w[0]);
        const sum = ws.reduce((a, v) => a + v, 0) || 1;
        let u = h1(seed, 2) * sum, oi = 0;
        for (; oi < ws.length - 1; oi++) {
          u -= ws[oi];
          if (u < 0) break;
        }
        const j = 0.82 + 0.3 * h1(seed, 4);
        const t = tb.tint;
        const rot = s[i + 3];
        const y = s[i + 1] + 0.05;
        this.write(rec, bi, s[i], s[i + 2], Math.cos(rot), -Math.sin(rot), 0, h1(seed, 5), 0, 0, y, y, y, y,
          t.r * j, t.g * j, t.b * j, s[i + 4] * (0.96 + 0.06 * h1(seed, 6)), oi, 1, 0.1 + 0.5 * h1(seed, 7), FIG_MODE.attention, seed, false, false);
        // soldiers' other garments: hose and hoods from the palette as for everyone
      }
    }
    // tint slot 1 (the jack or tunic) is the formation's colour: written above as the main colour
    return true;
  }

  // ------------------------------------------------------------------------------------------- per frame
  /** Choose a level of detail per figure (and drop those well outside the view); upload the instance buffers. */
  /** wall clock of the last update (the same clock the shader animates with) */
  time = 0;

  update(camera: THREE.Camera, timeSec: number, active: boolean): void {
    const t0 = performance.now();
    this.time = timeSec;
    const set = active ? this.meshes.get(this.activeSet) : null;
    const troopsChanged = this.manifest ? this.updateTroops() : false;
    const cp = camera.position;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const moved = cp.distanceTo(this.lastCam) > 1.0 || dir.dot(this.lastDir) < 0.9986;
    // at most ten times a second while the camera moves (a big formation costs about a millisecond to sort)
    if (!this.dirty && !troopsChanged && (moved ? timeSec - this.lastBucket < 0.1 : timeSec - this.lastBucket < 0.8)) return;
    this.dirty = false;
    this.lastCam.copy(cp);
    this.lastDir.copy(dir);
    this.lastBucket = timeSec;
    for (const m of this.meshes.values()) for (const bm of m.values()) bm.n.fill(0);
    this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    const sphere = new THREE.Sphere(new THREE.Vector3(), 4);
    let culled = 0;
    const emit = (rec: Rec, target: Map<string, BodyMeshes> | undefined) => {
      if (!target) return;
      const d = rec.data;
      for (let i = 0; i < rec.n; i++) {
        const o = i * STRIDE;
        let x = d[o], z = d[o + 1];
        const L = d[o + 4];
        let y = d[o + 8];
        if (L >= 0.5) {
          const cyc = d[o + 5] + (timeSec * d[o + 6]) / (2 * L);
          const tri = 0.5 - 0.5 * Math.cos(2 * Math.PI * (cyc - Math.floor(cyc)));
          x += d[o + 2] * tri * L + d[o + 3] * d[o + 7];
          z += d[o + 3] * tri * L - d[o + 2] * d[o + 7];
          y = (d[o + 8] + d[o + 11]) / 2;
        }
        sphere.center.set(x, y + 0.9, z);
        if (!this.frustum.intersectsSphere(sphere)) {
          culled++;
          continue;
        }
        const dist = Math.hypot(x - cp.x, y + 1 - cp.y, z - cp.z);
        let li = dist < this.lod[0] ? 0 : dist < this.lod[1] ? 1 : dist < this.lod[2] ? 2 : 3;
        if (li >= bm0(target)) li = bm0(target) - 1;
        const bm = target.get(this.manifest!.bodies[rec.body[i]].id);
        if (!bm) continue;
        const k = bm.n[li]++;
        let arr = bm.arr[li];
        if ((k + 1) * STRIDE > arr.length) arr = this.growMesh(bm, li);
        arr.set(d.subarray(o, o + STRIDE), k * STRIDE);
      }
    };
    if (set) emit(this.people, set);
    if (this.troopRec.n) {
      // troops of one formation set all use that set's meshes
      const names = new Set(this.troops.filter((tb) => this.visibleChain(tb.group)).map((tb) => tb.set));
      for (const nm of names) emit(this.troopRec, this.meshes.get(nm));
    }
    const drawn = [0, 0, 0, 0];
    for (const m of this.meshes.values()) {
      for (const bm of m.values()) {
        for (let li = 0; li < bm.lods.length; li++) {
          const g = bm.geos[li];
          const n = bm.n[li];
          g.instanceCount = n;
          bm.lods[li].visible = n > 0;
          if (n > 0) {
            const ib = (bm.attrs[li][0] as unknown as THREE.InterleavedBufferAttribute).data as THREE.InstancedInterleavedBuffer;
            ib.updateRanges.length = 0;
            ib.addUpdateRange(0, n * STRIDE);
            ib.needsUpdate = true;
            drawn[li] += n;
          }
        }
      }
    }
    if (this.stool) this.stool.commit();
    this.stats = { people: set ? this.people.n : 0, troops: this.troopRec.n, drawn, culled, ms: +(performance.now() - t0).toFixed(2) };
  }

  private growMesh(bm: BodyMeshes, li: number): Float32Array {
    const old = bm.arr[li];
    const arr = new Float32Array(old.length * 2);
    arr.set(old);
    const g = bm.geos[li];
    const ib = new THREE.InstancedInterleavedBuffer(arr, STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    bm.attrs[li] = ATTRS.map(([name, off, size]) => {
      const a = new THREE.InterleavedBufferAttribute(ib, size, off);
      g.setAttribute(name, a as unknown as THREE.BufferAttribute);
      return a as unknown as THREE.InstancedBufferAttribute;
    });
    bm.arr[li] = arr;
    return arr;
  }

  /** Show the block figures of the formations again (figures turned off or failed). */
  restoreBlocks(): void {
    for (const tb of this.troops) for (const b of tb.blocks) b.visible = true;
    this.troopKey = "";
    this.troopRec.n = 0;
  }

  hide(): void {
    for (const m of this.meshes.values()) for (const bm of m.values()) for (const l of bm.lods) l.visible = false;
  }

  dispose(): void {
    for (const m of this.meshes.values())
      for (const bm of m.values()) {
        bm.geos.forEach((g) => g.dispose());
        bm.lods.forEach((l) => {
          (l.material as THREE.Material).dispose();
          l.customDepthMaterial?.dispose();
        });
      }
  }
}

/** The populace's cloth palette in linear values (set by world.ts). */
export const CLOTH_LIN: [number, number, number][] = [];
