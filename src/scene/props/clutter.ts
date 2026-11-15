import * as THREE from "three";
import { tToHist } from "@/lib/years";
import type { ExtraContext, Extra } from "../extras";
import { ModelInstances, modelsForYear, tryLoadModel, type ModelAsset } from "../assets/models";
import { shared } from "../pop/shared";
import { PopWorld, type PropSite } from "../pop/world";

/**
 * ILLUSTRATIVE LAYER, NOT EVIDENCE. Sparse street clutter from the CC0 scanned prop library
 * (docs/ASSETS.md): buckets, crates, chests, pots, bowls and stools beside doors, in yards, on quays,
 * wharves and the bridge roadway, a few logs, timber stacks and brushwood by the waterfront. Where an
 * item stands is generated from the same lattice of houses and the same streets as the populace; none
 * of it is a record of any shop, cargo or household. Items appear only in years the library's own
 * plausibility range allows (no medieval goods in Roman streets; almost nothing before the Roman
 * period). There are no barrels: the library has no period-safe ones. Not drawn on battle stand-ins.
 */

interface Def {
  id: string;
  /** model scale (the scans are real size; a few are trimmed to street scale) */
  scale: [number, number];
  /** used by small sites (bridge roadway) */
  small?: boolean;
  /** logs and stacks are laid along the street */
  log?: boolean;
  stack?: boolean;
}
const DEFS: Def[] = [
  { id: "wooden_bucket_01", scale: [0.8, 1.0], small: true },
  { id: "wooden_bucket_02", scale: [0.85, 1.1], small: true },
  { id: "wooden_crate_01", scale: [0.85, 1.15] },
  { id: "treasure_chest", scale: [0.85, 1.05] },
  { id: "ceramic_pot", scale: [0.6, 0.85], small: true },
  { id: "wooden_bowl_01", scale: [0.9, 1.1], small: true },
  { id: "wooden_bowl_02", scale: [1, 1.2], small: true },
  { id: "wooden_stool_01", scale: [0.95, 1.05], small: true },
  { id: "wooden_stool_02", scale: [1.0, 1.25], small: true },
  { id: "dead_tree_trunk", scale: [0.55, 0.8], log: true, stack: true },
  { id: "dry_branches_medium_01", scale: [0.9, 1.3] },
  { id: "tree_stump_01", scale: [0.35, 0.5] },
  { id: "stone_fire_pit", scale: [0.6, 0.8] },
];
const BY_ID = new Map(DEFS.map((d) => [d.id, d]));

/** what each context may hold, with weights; plausibility by year is then checked against the library */
const CONTEXT: Record<PropSite["kind"], [string, number][]> = {
  door: [["wooden_bucket_01", 3], ["wooden_bucket_02", 2], ["wooden_stool_01", 2], ["wooden_stool_02", 2], ["wooden_bowl_01", 2], ["wooden_bowl_02", 1], ["ceramic_pot", 3], ["wooden_crate_01", 2], ["treasure_chest", 1], ["dry_branches_medium_01", 1.5]],
  yard: [["dead_tree_trunk", 3], ["tree_stump_01", 2], ["dry_branches_medium_01", 2], ["wooden_bucket_01", 1.5], ["wooden_stool_02", 1.5], ["stone_fire_pit", 1], ["wooden_bowl_01", 1]],
  quay: [["wooden_crate_01", 3], ["treasure_chest", 1.5], ["wooden_bucket_02", 2], ["ceramic_pot", 2], ["dead_tree_trunk", 2], ["wooden_bucket_01", 1]],
  wharf: [["dead_tree_trunk", 4], ["wooden_crate_01", 2], ["dry_branches_medium_01", 2], ["wooden_bucket_02", 1.5], ["treasure_chest", 1]],
  bridge: [["wooden_bucket_01", 3], ["ceramic_pot", 2], ["wooden_stool_02", 2], ["wooden_bowl_01", 1.5], ["wooden_bucket_02", 1]],
  forum: [["wooden_bucket_01", 2], ["wooden_bowl_01", 2], ["wooden_stool_02", 2]],
};

const hash = (a: number): number => {
  const s = Math.sin(a * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export function buildClutter(ctx: ExtraContext): Extra | null {
  // debug switch for before/after comparisons: ?props=0
  if (typeof location !== "undefined" && /[?&]props=0/.test(location.search)) return null;
  if (ctx.quality === "low") return null;
  const high = ctx.quality === "high";
  const R = high ? 40 : 28;
  const CAP = high ? 60 : 30;
  const MAXSITES = high ? 170 : 70;

  const world =
    shared.world ??
    new PopWorld(ctx, { people: 0, animals: 0, carts: 0, smoke: 0, radius: 0, density: 1, tilesPerStep: 1 }, 1);

  const root = new THREE.Group();
  root.name = "street-props";
  const insts = new Map<string, ModelInstances>();
  const assets = new Map<string, ModelAsset>();
  let dirty = true;
  let disposed = false;
  for (const d of DEFS) {
    void tryLoadModel(d.id, 0).then((a) => {
      if (!a || disposed) return;
      assets.set(d.id, a);
      const stackMult = d.stack ? 3 : 1;
      const mi = new ModelInstances(a, CAP * stackMult, { castShadow: false, distanceScale: high ? 0.4 : 0.3, minMove: 1.5 });
      insts.set(d.id, mi);
      root.add(mi.object);
      dirty = true;
    });
  }

  const sites: PropSite[] = [];
  const lastC = new THREE.Vector3(1e9, 0, 1e9);
  let lastT = NaN;
  let lastTime = -9;
  const dir = new THREE.Vector3();
  const focus = new THREE.Vector3();
  let loadedCount = 0;
  let tilesPending = false;
  const ALWAYS: [number, number, number, number] = [-1e9, -1e9 + 1, 1e9, 1e9 + 1];

  function rebuild(t: number, camera: THREE.Camera): void {
    const hist = tToHist(t);
    for (const mi of insts.values()) mi.clear();
    // before the Roman period: almost nothing
    const dens = hist < 43 ? 0.3 : 1;
    const plausible = new Set(modelsForYear(hist, "prop").concat(modelsForYear(hist, "deadwood")).map((m) => m.id));
    const cp = camera.position;
    sites.length = 0;
    tilesPending = world.sitesNear(t, cp.x, cp.z, R, sites);
    // when looking down from height the interesting ground is ahead: also sample around the focus point
    camera.getWorldDirection(dir);
    if (dir.y < -0.05 && cp.y < 120) {
      const d = THREE.MathUtils.clamp((cp.y - 1) / -dir.y, 5, 160);
      focus.copy(cp).addScaledVector(dir, d);
      if (Math.hypot(focus.x - cp.x, focus.z - cp.z) > R * 0.6) {
        tilesPending = world.sitesNear(t, focus.x, focus.z, R * 0.8, sites) || tilesPending;
      }
    }
    sites.sort((a, b) => (a.x - cp.x) ** 2 + (a.z - cp.z) ** 2 - ((b.x - cp.x) ** 2 + (b.z - cp.z) ** 2));
    const used = new Map<string, number>();
    const q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), m = new THREE.Matrix4();
    const Y = new THREE.Vector3(0, 1, 0);
    const place = (mi: ModelInstances, a: ModelAsset, x: number, y: number, z: number, rot: number, s: number, lift = 0): void => {
      p.set(x, y - a.bounds.min.y * s + lift + 0.01, z);
      q.setFromAxisAngle(Y, rot);
      sc.set(s, s, s);
      m.compose(p, q, sc);
      mi.add(m, ALWAYS);
    };
    let n = 0;
    const placed: { id: string; kind: string; x: number; y: number; z: number }[] = [];
    for (const S of sites) {
      if (n >= MAXSITES) break;
      if (hash(S.seed * 3.1) > dens) continue;
      const list = CONTEXT[S.kind];
      let tot = 0;
      for (const [, w] of list) tot += w;
      let r = hash(S.seed * 7.7) * tot, id = list[0][0];
      for (const [i, w] of list) {
        r -= w;
        if (r <= 0) { id = i; break; }
      }
      const def = BY_ID.get(id)!;
      if (!plausible.has(id)) continue;
      if (S.small && !def.small) continue;
      const mi = insts.get(id), a = assets.get(id);
      if (!mi || !a) continue;
      const cnt = used.get(id) ?? 0;
      if (cnt + (def.stack ? 3 : 1) > mi.capacity) continue;
      const s = def.scale[0] + (def.scale[1] - def.scale[0]) * hash(S.seed * 11.3);
      const rotRand = hash(S.seed * 5.9) * Math.PI * 2;
      if (def.log) {
        // laid along the street / the waterfront; three form a small stack at the wharf and yard
        const rot = Math.atan2(-S.fz, S.fx) + (hash(S.seed * 2.2) - 0.5) * 0.35;
        const px = -S.fz, pz = S.fx; // across the street
        const dia = (a.depth + a.height) * 0.5 * s;
        if (def.stack && (S.kind === "wharf" || S.kind === "quay" || S.kind === "yard") && hash(S.seed * 9.1) < 0.7) {
          place(mi, a, S.x - px * dia * 0.55, S.y, S.z - pz * dia * 0.55, rot, s);
          place(mi, a, S.x + px * dia * 0.55, S.y, S.z + pz * dia * 0.55, rot, s * 0.95);
          place(mi, a, S.x, S.y, S.z, rot + 0.04, s * 0.9, a.height * s * 0.8);
          used.set(id, cnt + 3);
        } else {
          place(mi, a, S.x, S.y, S.z, rot, s);
          used.set(id, cnt + 1);
        }
      } else {
        place(mi, a, S.x, S.y, S.z, rotRand, s);
        used.set(id, cnt + 1);
      }
      n++;
      if (placed.length < 80) placed.push({ id, kind: S.kind, x: S.x, y: S.y, z: S.z });
    }
    for (const mi of insts.values()) mi.update(camera);
    root.userData.count = n;
    root.userData.placed = placed;
  }

  return {
    object: root,
    update(t, timeSec, camera) {
      for (const mi of insts.values()) mi.update(camera);
      if (insts.size !== loadedCount) { loadedCount = insts.size; dirty = true; }
      const cp = camera.position;
      const moved = Math.hypot(cp.x - lastC.x, cp.z - lastC.z);
      const due = timeSec - lastTime > 0.35;
      if (!(dirty || (due && (moved > 8 || Math.abs(t - lastT) > 2 || tilesPending)))) return;
      if (!due && !dirty) return;
      if (insts.size === 0) return;
      dirty = false;
      lastTime = timeSec;
      lastC.copy(cp);
      lastT = t;
      rebuild(t, camera);
    },
    dispose() {
      disposed = true;
      for (const mi of insts.values()) mi.dispose();
    },
  };
}
