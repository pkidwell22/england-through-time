import * as THREE from "three";
import { hash2, noise2 } from "@/lib/geo";
import type { TerrainModel } from "@/lib/terrain";
import { ModelInstances, loadModelVariants, type ModelAsset } from "../assets/models";

/**
 * Woodland understorey and deadwood around the camera, from the scanned plant library (docs/ASSETS.md):
 * ferns (fern_02), nettles (nettle_plant), lesser celandine (celandine_01), and
 * sparse logs, stumps, root plates and brushwood in old woodland. Woodland only: open ground is the grass layer of
 * groundDetail.ts. Plants stand under the dated trees of vegetation.ts: each takes the life window of the nearest tree
 * (so it vanishes when its wood is cleared) and none is placed where there is no tree. A window of cells follows the
 * camera and is rebuilt when the camera or the year has moved; cell contents are hashed from the cell index, so they do
 * not change as the camera moves. Species mix and positions are illustrative, not evidenced.
 */

export interface Anchor {
  x: number; y: number; z: number;
  life: [number, number, number, number];
  wet: boolean;
}

interface Kind {
  id: string;
  shadow: boolean;
  /** per variant: target height range (m), or fixed scale range when `fixed` */
  height?: [number, number];
  scale?: [number, number];
  maxScale: number;
  /** variants to use (default all) */
  only?: number[];
  assets: ModelAsset[];
  inst: ModelInstances[];
}

const CELL = 4.5;
const GRID = 24;

export class Understorey {
  readonly object = new THREE.Group();
  private ready = false;
  private readonly kinds: Record<"fern" | "nettle" | "herb" | "log" | "log2" | "stump" | "root" | "brush", Kind>;
  private readonly grid = new Map<number, Anchor[]>();
  private readonly center = new THREE.Vector3(1e9, 0, 1e9);
  private builtT = -1e9;
  private lastH = { x: 1e9, z: 1e9, h: 1e9 };
  private placed = 0;

  constructor(anchors: Anchor[], private terrain: TerrainModel, private yp0: ReturnType<TerrainModel["yearParams"]>, private quality: 1 | 2) {
    this.object.name = "understorey";
    this.object.visible = false;
    const mk = (id: string, shadow: boolean, o: Partial<Kind>): Kind => ({ id, shadow, maxScale: 8, assets: [], inst: [], ...o });
    this.kinds = {
      fern: mk("fern_02", false, { height: [0.55, 0.95], maxScale: 4 }),
      nettle: mk("nettle_plant", false, { height: [0.6, 1.0], maxScale: 9, only: [0, 1, 4, 5] }),
      herb: mk("celandine_01", false, { height: [0.25, 0.4], maxScale: 3 }),
      log: mk("dead_tree_trunk", true, { scale: [1.8, 2.6] }),
      log2: mk("dead_tree_trunk_02", true, { scale: [1.3, 1.8] }),
      stump: mk("tree_stump_01", true, { scale: [0.9, 1.4] }),
      root: mk("root_cluster_01", true, { scale: [1.0, 1.6] }),
      brush: mk("dry_branches_medium_01", false, { scale: [2, 3] }),
    };
    for (const a of anchors) {
      const key = Math.floor(a.x / GRID) * 100003 + Math.floor(a.z / GRID);
      let l = this.grid.get(key);
      if (!l) this.grid.set(key, (l = []));
      l.push(a);
    }
  }

  /** Load the plant models; resolves quietly with nothing drawn if any file is missing. */
  async load(): Promise<void> {
    const kinds = Object.values(this.kinds);
    const cap = this.quality === 2 ? 700 : 400;
    const loaded = await Promise.all(kinds.map((k) => loadModelVariants(k.id).catch(() => null)));
    if (loaded.some((l) => !l)) return;
    kinds.forEach((k, i) => {
      k.assets = loaded[i]!;
      k.inst = k.assets.map((a) => {
        const mi = new ModelInstances(a, k.height ? cap : Math.round(cap / 3), {
          life: true,
          castShadow: k.shadow,
          distanceScale: this.quality === 2 ? 1.15 : 0.8,
          minMove: 2,
        });
        this.object.add(mi.object);
        return mi;
      });
    });
    this.ready = true;
  }

  private nearest(x: number, z: number, t: number): Anchor | null {
    const gx = Math.floor(x / GRID), gz = Math.floor(z / GRID);
    let best: Anchor | null = null, bd = 12 * 12;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const l = this.grid.get((gx + i) * 100003 + (gz + j));
        if (!l) continue;
        for (const a of l) {
          if (t < a.life[1] - 15 || t > a.life[2] + 4) continue;
          const d = (a.x - x) ** 2 + (a.z - z) ** 2;
          if (d < bd) { bd = d; best = a; }
        }
      }
    return best;
  }

  private place(k: Kind, vi: number, x: number, y: number, z: number, u: number, a: Anchor, r2: number): boolean {
    const asset = k.assets[k.only ? k.only[vi % k.only.length] : vi % k.assets.length];
    const inst = k.inst[k.assets.indexOf(asset)];
    if (!inst || inst.count >= inst.capacity) return false;
    let s: number;
    if (k.height) s = Math.min(((k.height[0] + (k.height[1] - k.height[0]) * u) / Math.max(0.02, asset.height)), k.maxScale);
    else s = k.scale![0] + (k.scale![1] - k.scale![0]) * u;
    const rot = r2 * 6.2832;
    inst.place(x, y - 0.03 * s, z, rot, s, a.life);
    this.placed++;
    return true;
  }

  private rebuild(cam: THREE.Vector3, t: number) {
    this.center.copy(cam);
    this.builtT = t;
    this.placed = 0;
    for (const k of Object.values(this.kinds)) for (const i of k.inst) i.clear();
    const R = this.quality === 2 ? 70 : 48;
    const gx0 = Math.floor((cam.x - R) / CELL), gx1 = Math.floor((cam.x + R) / CELL);
    const gz0 = Math.floor((cam.z - R) / CELL), gz1 = Math.floor((cam.z + R) / CELL);
    const { kinds, terrain } = this;
    // the ground of the year shown (the bank and the valleys move), not of the first year of the timeline
    const yp0 = terrain.yearParams(t);
    for (let gz = gz0; gz <= gz1; gz++)
      for (let gx = gx0; gx <= gx1; gx++) {
        const cx = (gx + 0.5) * CELL, cz = (gz + 0.5) * CELL;
        if ((cx - cam.x) ** 2 + (cz - cam.z) ** 2 > R * R) continue;
        const patch = noise2(cx * 0.028 + 3.1, cz * 0.028 - 7.7);
        const dens = 0.6 + patch * 2.2;
        const n = Math.floor(dens + hash2(gx * 7 + 13, gz * 5 - 3));
        for (let c = 0; c < n; c++) {
          const px = (gx + hash2(gx * 31 + c * 7, gz * 17 + 5)) * CELL;
          const pz = (gz + hash2(gx * 13 - 9, gz * 29 + c * 11)) * CELL;
          const a = this.nearest(px, pz, t);
          if (!a) continue;
          const st = terrain.staticSample(px, pz);
          const py = terrain.heightFrom(st, yp0);
          if (!terrain.dry(py, 0.6)) continue;
          const r = hash2(gx * 3 + c * 101, gz * 7 + 17);
          const u = hash2(gx * 5 + c * 53, gz * 3 - 29);
          const r2 = hash2(gx * 11 - c * 7, gz * 13 + 3);
          const vi = Math.floor(hash2(gx * 19 + 7, gz * 23 + c) * 8);
          if (a.wet) {
            if (r < 0.5) this.place(kinds.nettle, vi, px, py, pz, u, a, r2);
            continue;
          }
          if (r < 0.38) this.place(kinds.fern, vi, px, py, pz, u, a, r2);
          else if (r < 0.58) this.place(kinds.nettle, vi, px, py, pz, u, a, r2);
          else if (r < 0.9) this.place(kinds.herb, vi, px, py, pz, u, a, r2);
        }
        // deadwood: sparse, more in old woodland (the tree has stood a long time)
        const dw = hash2(gx * 41 + 5, gz * 37 - 11);
        if (dw < 0.05) {
          const px = (gx + hash2(gx * 3 + 1, gz * 5 + 2)) * CELL, pz = (gz + hash2(gx * 7 - 4, gz * 11 + 6)) * CELL;
          const a = this.nearest(px, pz, t);
          if (!a || a.wet) continue;
          const old = t - a.life[1] > 150;
          if (!old && dw > 0.012) continue;
          const st = terrain.staticSample(px, pz);
          const py = terrain.heightFrom(st, yp0);
          if (!terrain.dry(py, 0.6)) continue;
          const kr = hash2(gx * 17 + 3, gz * 19 - 8), u = hash2(gx * 2 + 9, gz * 3 + 1), r2 = hash2(gx - 4, gz + 21);
          const vi = Math.floor(hash2(gx * 5, gz * 7) * 4);
          const kind = kr < 0.28 ? kinds.log : kr < 0.42 ? kinds.log2 : kr < 0.7 ? kinds.stump : kr < 0.8 ? kinds.root : kinds.brush;
          this.place(kind, vi, px, py, pz, u, a, r2);
        }
      }
  }

  update(cam: THREE.Vector3, t: number): void {
    if (!this.ready) return;
    // too high above the ground to see plants: hide (no draw calls)
    if (Math.hypot(cam.x - this.lastH.x, cam.z - this.lastH.z) > 6 || this.lastH.h > 1e8) {
      const g = this.terrain.floor(this.terrain.heightFrom(this.terrain.staticSample(cam.x, cam.z), this.yp0));
      this.lastH = { x: cam.x, z: cam.z, h: Math.abs(cam.y) - g };
    }
    const near = this.lastH.h < 110;
    if (!near) {
      this.object.visible = false;
      this.center.set(1e9, 0, 1e9);
      return;
    }
    this.object.visible = true;
    if (Math.hypot(cam.x - this.center.x, cam.z - this.center.z) > 10 || Math.abs(t - this.builtT) > 6) this.rebuild(cam, t);
    for (const k of Object.values(this.kinds)) for (const i of k.inst) i.update(cam);
  }

  debug() {
    let tri = 0, inst = 0;
    for (const k of Object.values(this.kinds)) for (const i of k.inst) { tri += i.triangles(); inst += i.count; }
    return { ready: this.ready, visible: this.object.visible, plants: inst, triangles: tri };
  }
}
