import * as THREE from "three";
import type { Dataset, Landmark, Phase } from "@/lib/types";
import { hashString } from "@/lib/geo";
import { phaseStatus, type PhaseStatus } from "@/lib/lifecycle";
import type { TerrainModel } from "@/lib/terrain";
import { histToT } from "@/lib/years";
import { Builder } from "./geom";
import { BUILDERS, CORRIDOR_KINDS, FLAT_KINDS, WORLD_SPACE_KINDS, type BuildCtx, type TraceItem } from "./builders";
import { makeMaterial } from "./materials";
import { EVIDENCE_COLORS, EVIDENCE_INDEX } from "./life";
import { LEGACY_PLACEMENT } from "./placementMode";
import { bridgeRamp, RAMP_GRADE } from "./district";
import { streetNetwork } from "./street/network";
import { registerExtra } from "./extras";

/** A landmark material as landmarks wear it (both faces drawn, except glass and voids; standing water a little clear). */
function dressMaterial(name: string): THREE.MeshStandardMaterial {
  const m = makeMaterial(name);
  if (name === "water") {
    m.transparent = true;
    m.opacity = 0.9;
  }
  m.side = name === "glass" || name === "dark" ? THREE.FrontSide : THREE.DoubleSide;
  return m;
}

interface PhaseEntry {
  lm: Landmark;
  phase: Phase;
  index: number;
  group: THREE.Group;
  mats: { m: THREE.MeshStandardMaterial; base: THREE.Color }[];
  /** The phase's own materials by name (clipped while it is being built, tinted in ruin or on fire). */
  byName: Map<string, { m: THREE.MeshStandardMaterial; base: THREE.Color }>;
  plane: THREE.Plane;
  lowY: number;
  topY: number;
  status: PhaseStatus;
  /**
   * The copies of the phase: a phase whose ground moves during its life (the bank advancing in front of a quay, a valley
   * silting up under a road) is built once per span of years, each on the ground of its own span. They are children of
   * the phase's group; the group shows the phase, and of its copies only the one for the year shown.
   */
  copies: PhaseCopy[];
}

/** One copy of a phase, built on the ground of one span of years. */
export interface PhaseCopy {
  group: THREE.Group;
  /** Years this copy is shown (the first is open below, the last open above). */
  win: [number, number];
  /** The year whose ground it was built on. */
  tBuild: number;
  /** Parts the builder reported (quay fronts, revetments, piers, craft, approaches): diagnostics and the placement audit. */
  trace: TraceItem[];
  box: THREE.Box3;
  /** Geometry not built yet (a world-space copy is built when first shown, or in idle frames): builds it. */
  pending?: () => void;
}

/** A Builder that builds nothing: runs a kind builder only for what it reports through BuildCtx.trace. */
function nullBuilder(): Builder {
  const real = new Builder();
  return new Proxy(real, {
    get(target, prop) {
      if (prop === "at") return (_x: number, _y: number, _z: number, _r: number, fn: () => void) => fn();
      if (prop === "isEmpty") return () => false;
      const v = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof v === "function" ? () => undefined : v;
    },
  });
}

export interface ActiveLandmark {
  lm: Landmark;
  phase: Phase;
  phaseIndex: number;
  status: PhaseStatus;
  /** World-space label anchor. */
  anchor: THREE.Vector3;
  size: number;
}

/** A landmark's ground plan in world x, z, for the years it stands (fabric, trees and walkers keep out of it). */
export interface LandmarkSolid {
  id: string;
  kind: string;
  poly: [number, number][];
  bbox: [number, number, number, number];
  t0: number;
  t1: number;
  /** The interior of a closed curtain wall (a castle ward): nothing generic stands inside. */
  enclosure?: boolean;
}

// Builds the landmark copies still pending a few milliseconds per frame (an extra layer, so engine.ts needs no change).
registerExtra((ctx) => ({ object: new THREE.Group(), update: () => ctx.landmarks.pump(4) }));

const RUIN = new THREE.Color(0x4d4a40);
const FIRE = new THREE.Color(1.0, 0.3, 0.03);

/** Kinds staged for a moment (or a field system): drawn once, not rebuilt as the ground moves. */
const NO_SPANS = new Set(["troops", "zone-marker", "tents", "camp", "sightline", "hedge", "field-strips", "stone-bridge", "bridge-houses"]);

/** How far (m) the ground under one built copy of a phase may move before the next span of years gets its own copy. */
function spanTolerance(kind: string): number | null {
  if (NO_SPANS.has(kind) || kind.startsWith("bridge-") || kind === "nonsuch" || kind === "waterwheel") return null;
  if (kind === "road" || kind === "ford") return 0.2;
  if (kind === "stream") return 0.16;
  if (kind === "boats") return 1.0;
  if (kind === "quay" || kind === "waterfront" || kind === "dock") return 0.5;
  if (kind === "bridge") return 0.6;
  if (kind === "wall") return 2.0;
  return 1.2;
}

const bboxOf = (p: [number, number][]): [number, number, number, number] => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, z] of p) { a = Math.min(a, x); b = Math.min(b, z); c = Math.max(c, x); d = Math.max(d, z); }
  return [a, b, c, d];
};

/** Points every `step` m along a polyline. */
function resample(path: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1], [bx, bz] = path[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

/** Builds every landmark phase from the data and shows/hides/clips them according to the year. */
export class LandmarkLayer {
  readonly root = new THREE.Group();
  private entries: PhaseEntry[] = [];
  private byLandmark = new Map<string, PhaseEntry[]>();
  private evidence = 0;
  readonly footprints: { x: number; z: number; r: number; t0: number; t1: number }[] = [];
  readonly corridors: { path: [number, number][]; half: number; t0: number; t1: number }[] = [];
  /** Ground plans of standing landmarks and the interiors of castle wards, with their years. */
  readonly solids: LandmarkSolid[] = [];
  /**
   * The working strip behind each copy of a quay or waterfront (deck, wharf, warehouses), as a centreline and half-width,
   * for the years that copy stands: generic houses and trees keep off it.
   */
  readonly wharves: { path: [number, number][]; half: number; t0: number; t1: number }[] = [];
  /** Copies whose geometry is still to be built (see PhaseCopy.pending). */
  private pendingCopies: PhaseCopy[] = [];
  /** The spans of years each phase was built for (`${id}#${index}` -> [start, end] and the year whose ground was used). */
  readonly spans = new Map<string, { win: [number, number]; tBuild: number }[]>();

  constructor(private ds: Dataset, private terrain: TerrainModel) {
    this.root.name = "landmarks";
    const tEnd = histToT(ds.site.timeline.end) + 1;
    const sampleCache = new Map<string, ReturnType<TerrainModel["staticSample"]>[]>();
    // the copies of a phase ask the ground at the same points again and again: remember the static part (exact points)
    // (keyed by number, x then z: building a string key per lookup cost more than the lookup saved)
    const pointCache = new Map<number, Map<number, ReturnType<TerrainModel["staticSample"]>>>();
    let cached = 0;
    const sampleAt = (gx: number, gz: number) => {
      let col = pointCache.get(gx);
      let sm = col?.get(gz);
      if (!sm) {
        sm = terrain.staticSample(gx, gz);
        if (cached < 250000) {
          if (!col) pointCache.set(gx, (col = new Map()));
          col.set(gz, sm);
          cached++;
        }
      }
      return sm;
    };
    for (const lm of ds.landmarks) {
      const [x, z] = terrain.proj.toLocal(lm.lat, lm.lon);
      const path = (lm.path ?? []).map(([la, lo]) => terrain.proj.toLocal(la, lo));
      lm.phases.forEach((phase, index) => {
        const build = BUILDERS[phase.model.kind];
        if (!build) {
          console.warn(`No builder for kind "${phase.model.kind}" (${lm.id})`);
          return;
        }
        const kind = phase.model.kind;
        const mm = phase.model as Record<string, unknown>;
        // Fittings of a stone bridge (houses, chapel, gates…) are laid out along that bridge's path, not their own.
        const onBridge = kind.startsWith("bridge-") || kind === "nonsuch" || kind === "waterwheel";
        const refPath = onBridge ? this.bridgePath(typeof phase.model.on === "string" ? phase.model.on : undefined) ?? path : path;
        if (onBridge && refPath.length < 2) {
          console.warn(`"${kind}" (${lm.id}) needs a stone bridge to stand on: none found`);
          return;
        }
        const worldSpace = WORLD_SPACE_KINDS.has(kind);
        const ownPath = Array.isArray(mm.path) ? (mm.path as [number, number][]).map(([la, lo]) => terrain.proj.toLocal(la, lo)) : refPath;

        // The copies of one phase share their materials and clipping plane (only one copy is shown at a time), and a
        // model set in its own frame (a building) shares its geometry too: only its height on the ground differs.
        const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
        const matCache = new Map<string, PhaseEntry["mats"][number]>();
        let template: { group: THREE.Group; trace: TraceItem[]; mats: PhaseEntry["mats"]; plane: THREE.Plane } | null = null;
        /** Build the phase on the ground of year tGround; null if the builder produced nothing. */
        const make = (tGround: number, span?: [number, number], dry = false): { group: THREE.Group; trace: TraceItem[]; mats: PhaseEntry["mats"]; plane: THREE.Plane } | null => {
          const yp = terrain.yearParams(tGround);
          // craft are laid out on the driest ground of their span (the bank at its furthest), so they float all through it
          const ypA = span && kind === "boats" ? terrain.yearParams(span[0]) : null, ypB = span && kind === "boats" ? terrain.yearParams(span[1]) : null;
          const ground = ypA && ypB
            ? (gx: number, gz: number) => { const s = sampleAt(gx, gz); return Math.max(terrain.heightFrom(s, ypA), terrain.heightFrom(s, ypB), terrain.heightFrom(s, yp)); }
            : (gx: number, gz: number) => terrain.heightFrom(sampleAt(gx, gz), yp);
          if (template && !worldSpace) {
            const group = template.group.clone();
            group.position.y = terrain.hasRiver ? Math.max(0.6, ground(x, z)) : ground(x, z);
            level(group, ground);
            group.updateMatrixWorld(true);
            return { group, trace: template.trace, mats: template.mats, plane };
          }
          const ctx: BuildCtx = {
            ground, path: refPath, x, z, tier: lm.tier, seed: hashString(lm.id) + index,
            project: (la, lo) => terrain.proj.toLocal(la, lo),
            hasWater: terrain.hasRiver,
            bearing: lm.bearing ?? 90,
            polygon: (name) => ds.site.polygons[name]?.map(([la, lo]) => terrain.proj.toLocal(la, lo)),
            trace: [],
            land: (gx: number, gz: number) => terrain.landHeightFrom(sampleAt(gx, gz), yp),
            inlets: terrain.inletsOpen(yp),
          };
          const b = dry ? nullBuilder() : new Builder();
          try {
            build(b, phase.model, ctx);
            if (dry) return { group: new THREE.Group(), trace: ctx.trace ?? [], mats: [], plane };
          } catch (e) {
            // one malformed entry must not take the whole scene down
            console.warn(`Could not build "${kind}" (${lm.id}): ${(e as Error).message}`);
            return null;
          }
          if (b.isEmpty()) return null;
          const group = new THREE.Group();
          group.name = `${lm.id}#${index}`;
          if (!worldSpace) {
            group.position.set(x, terrain.hasRiver ? Math.max(0.6, ground(x, z)) : ground(x, z), z);
            group.rotation.y = Math.PI / 2 - ((lm.bearing ?? 90) * Math.PI) / 180;
          }
          const mats: PhaseEntry["mats"] = [];
          for (const [name, geo] of b.merged()) {
            let mc = matCache.get(name);
            if (!mc) {
              const m = dressMaterial(name);
              m.clippingPlanes = [plane];
              m.clipShadows = true;
              matCache.set(name, (mc = { m, base: m.color.clone() }));
            }
            const m = mc.m;
            const mesh = new THREE.Mesh(geo, m);
            mesh.castShadow = name !== "water" && name !== "gravel" && !m.transparent;
            if (name.startsWith("flat:") && m.transparent) mesh.renderOrder = 2;
            if (kind === "boats") mesh.userData.noPick = true;
            mesh.receiveShadow = true;
            mesh.userData.landmarkId = lm.id;
            mesh.userData.mat = name;
            group.add(mesh);
            if (!mats.includes(mc)) mats.push(mc);
          }
          if (!worldSpace) level(group, ground);
          group.updateMatrixWorld(true);
          const out = { group, trace: ctx.trace ?? [], mats, plane };
          if (!worldSpace) template = out;
          return out;
        };
        /** Set a model built in its own frame on its whole plan, not just its centre: no corner buried by more than 0.8 m and
         *  no gap under its base; too steep for both, never a gap (a building terraced into a slope reads true, one hanging
         *  over it does not). */
        const level = (group: THREE.Group, ground: (gx: number, gz: number) => number) => {
          if (onBridge || LEGACY_PLACEMENT) return;
          if (kind === "dock") {
            // a dock's hard is level with the ground about it (a yard in the frontage once the bank has advanced past
            // it), never a platform standing on the reclaimed ground
            // (an inlet dock stands at the head of its inlet: take the ground just behind the head, not the water)
            const back = mm.inlet ? 5 : 0, br = ((lm.bearing ?? 90) * Math.PI) / 180;
            group.position.y = Math.max(terrain.hasRiver ? 0.6 : -Infinity, ground(x - Math.sin(br) * back, z + Math.cos(br) * back) - 1.3);
            return;
          }
          const lb = new THREE.Box3();
          group.traverse((o) => {
            const g = (o as THREE.Mesh).geometry;
            if (!g) return;
            if (!g.boundingBox) g.computeBoundingBox();
            if (g.boundingBox) lb.union(g.boundingBox);
          });
          if (lb.isEmpty()) return;
          const c = Math.cos(group.rotation.y), sn = Math.sin(group.rotation.y);
          const hs = [[lb.min.x, lb.min.z], [lb.max.x, lb.min.z], [lb.max.x, lb.max.z], [lb.min.x, lb.max.z]].map(([lx, lz]) => ground(x + lx * c + lz * sn, z - lx * sn + lz * c));
          const yNoGap = Math.min(...hs) - lb.min.y + 0.05, yNoSink = Math.max(...hs) - 0.8;
          const y = Math.min(yNoGap, Math.max(yNoSink, group.position.y));
          group.position.y = terrain.hasRiver ? Math.max(0.6, y) : y;
        };

        // the years this phase can be seen (construction to the last of its remains)
        const t0 = histToT(phase.from);
        const tGoneBy = phase.goneBy != null ? histToT(phase.goneBy) : null;
        const end = phase.end ?? "replaced";
        const held = (phase as Phase & { heldUntil?: number }).heldUntil;
        let tLast = phase.to == null ? tEnd : end === "ruin" || end === "decay" ? tGoneBy ?? tEnd : histToT(phase.to) + 3;
        if (held != null) tLast = Math.max(tLast, histToT(held) + 1);
        tLast = Math.min(tLast, tEnd);
        const tRep = histToT(phase.built ?? phase.from) + 3;

        const tProbe = Math.min(tRep, Math.max(t0, tLast - 0.5));
        // a model in its own frame is built once now (its plan decides where to watch the ground); a world-space phase is
        // watched along its path, and built in full here only if it stands as a single copy
        let probe = worldSpace ? null : make(tProbe);
        if (!worldSpace && !probe) return;
        // ground samples whose movement decides whether (and when) to rebuild
        const tol = LEGACY_PLACEMENT ? null : spanTolerance(kind);
        let samples: [number, number][] = [];
        if (tol != null && tLast > t0 + 1) {
          if (!worldSpace) {
            const lb = new THREE.Box3();
            probe!.group.traverse((o) => {
              const g = (o as THREE.Mesh).geometry;
              if (!g) return;
              if (!g.boundingBox) g.computeBoundingBox();
              if (g.boundingBox) lb.union(g.boundingBox);
            });
            const c = Math.cos(probe!.group.rotation.y), sn = Math.sin(probe!.group.rotation.y);
            samples = [[x, z]];
            if (!lb.isEmpty()) for (const [lx, lz] of [[lb.min.x, lb.min.z], [lb.max.x, lb.min.z], [lb.max.x, lb.max.z], [lb.min.x, lb.max.z]]) samples.push([x + lx * c + lz * sn, z - lx * sn + lz * c]);
          } else if (kind === "quay" || kind === "waterfront") {
            // the builders walk from the path to the waterline: watch a strip running out towards the river
            const dir = kind === "waterfront" && typeof mm.side === "number" ? (mm.side as number) : 1;
            for (const [px, pz] of resample(ownPath, 21)) for (let k = -12; k <= 72; k += 12) samples.push([px, pz + dir * k]);
          } else if (kind === "boats") {
            // the craft lie across the whole channel: watch both banks along the reach
            const rp = resample(ownPath, 60);
            for (let i = 0; i < rp.length; i++) {
              const [px, pz] = rp[i];
              const [qx, qz] = rp[Math.min(rp.length - 1, i + 1)], [ox, oz] = rp[Math.max(0, i - 1)];
              const l = Math.hypot(qx - ox, qz - oz) || 1;
              const nx = -(qz - oz) / l, nz = (qx - ox) / l;
              for (let k = -260; k <= 260; k += 20) samples.push([px + nx * k, pz + nz * k]);
            }
          } else samples = resample(ownPath, 10);
        }
        // phases of one landmark on one path (river traffic, waterfront rebuilds) share their ground samples
        const sKey = worldSpace ? `${lm.id}|${kind}|${samples.length}|${samples[0]?.join(",")}` : "";
        const st = (sKey && sampleCache.get(sKey)) || samples.map(([sx, sz]) => terrain.staticSample(sx, sz));
        if (sKey) sampleCache.set(sKey, st);
        const ranges = tol != null && st.length ? terrain.groundSpans(st, t0, tLast, tol) : [[t0, tLast] as [number, number]];
        if (worldSpace) probe = ranges.length > 1 ? make(tProbe, undefined, true) : make(tProbe);
        if (!probe) return;
        const first = probe;
        // a box for copies not built yet: the probe's, or (no geometry built) the path's extent
        const roughBox = new THREE.Box3().setFromObject(first.group);
        if (roughBox.isEmpty()) {
          const pb = ownPath.length ? bboxOf(ownPath) : [x - 20, z - 20, x + 20, z + 20];
          roughBox.set(new THREE.Vector3(pb[0], -4, pb[1]), new THREE.Vector3(pb[2], 12, pb[3]));
        }
        const spanList: { win: [number, number]; tBuild: number }[] = [];
        const holder = new THREE.Group();
        holder.name = `${lm.id}#${index}`;
        const copies: PhaseCopy[] = [];
        const mats: PhaseEntry["mats"] = [];
        ranges.forEach(([a, c], i) => {
          const win: [number, number] = [i === 0 ? -Infinity : a, i === ranges.length - 1 ? Infinity : c];
          // a single span keeps the representative year (construction finished); otherwise each span its own middle year
          const tBuild = ranges.length === 1 ? Math.min(tRep, Math.max(t0, tLast - 0.5)) : (a + c) / 2;
          const sp: [number, number] = [a, Math.min(c, tEnd)];
          if (ranges.length > 1 && worldSpace) {
            // a world-space copy is rebuilt from scratch: report its parts now (a builder run that builds nothing), build
            // its geometry when it is first shown or in an idle frame (LandmarkLayer.pump)
            const dryRun = make(tBuild, sp, true);
            if (!dryRun) return;
            spanList.push({ win, tBuild });
            const group = new THREE.Group();
            group.name = `${lm.id}#${index}@${Math.round(tBuild)}`;
            group.visible = false;
            holder.add(group);
            const copy: PhaseCopy = { group, win, tBuild, trace: dryRun.trace, box: roughBox.clone() };
            group.userData.box = copy.box;
            copy.pending = () => {
              copy.pending = undefined;
              const built = make(tBuild, sp);
              if (!built) return;
              for (const ch of [...built.group.children]) group.add(ch);
              group.updateMatrixWorld(true);
              copy.box = new THREE.Box3().setFromObject(group);
              group.userData.box = copy.box;
              copy.trace = built.trace;
              for (const mc of matCache.values()) if (!mats.includes(mc)) mats.push(mc);
            };
            copies.push(copy);
            this.pendingCopies.push(copy);
            return;
          }
          const built = ranges.length === 1 ? first : make(tBuild, sp);
          if (!built) return;
          spanList.push({ win, tBuild });
          const group = built.group;
          if (ranges.length > 1) group.name = `${lm.id}#${index}@${Math.round(tBuild)}`;
          const box = new THREE.Box3().setFromObject(group);
          group.userData.box = box;
          group.visible = i === 0;
          holder.add(group);
          copies.push({ group, win, tBuild, trace: built.trace, box });
          for (const m of built.mats) if (!mats.includes(m)) mats.push(m);
        });
        // (lazily built copies take their materials from the phase's cache, which the probe build filled)
        for (const mc of matCache.values()) if (!mats.includes(mc)) mats.push(mc);
        if (copies.length) {
          const box = new THREE.Box3();
          for (const c of copies) box.union(c.box);
          const flat = FLAT_KINDS.has(kind);
          const lowY = flat ? box.min.y - 0.5 : Math.max(box.min.y, Math.min(...copies.map((c) => c.group.position.y)) - 0.5, -0.5);
          const entry: PhaseEntry = { lm, phase, index, group: holder, mats, byName: matCache, plane, lowY, topY: box.max.y + 0.2, status: phaseStatus(phase, -1e9), copies };
          holder.visible = false;
          holder.userData.box = box;
          this.root.add(holder);
          this.entries.push(entry);
          if (!this.byLandmark.has(lm.id)) this.byLandmark.set(lm.id, []);
          this.byLandmark.get(lm.id)!.push(entry);
        }
        if (ranges.length > 1 && worldSpace) {
          // the probe copy was only measured, never shown (its materials are shared with the copies)
          first.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
        }
        // the wharf strip of each copy, for that copy's years
        if (kind === "quay" || kind === "waterfront") {
          const tGone0 = tGoneBy ?? (phase.to != null ? histToT(phase.to) + 4 : tEnd + 1);
          copies.forEach((e) => {
            const pts: [number, number][] = [];
            let half = 5;
            for (const q of e.trace) {
              const rot = Number(q.rot);
              if (q.kind === "revetment") {
                const n = q.dir as number;
                pts.push([q.x - Math.sin(rot) * n * 4.6, q.z - Math.cos(rot) * n * 4.6]);
                half = 4.9;
              } else if (q.kind === "quay-front") {
                const back = (q.width as number) + 12;
                pts.push([q.x - Math.sin(rot) * back / 2, q.z - Math.cos(rot) * back / 2]);
                half = back / 2 + 0.3;
              }
            }
            if (pts.length >= 2) this.wharves.push({ path: pts, half, t0: Math.max(e.win[0], t0 - 2), t1: Math.min(e.win[1], tGone0) });
          });
        }
        if (!spanList.length) return;
        this.spans.set(`${lm.id}#${index}`, spanList);
        if (kind === "stone-bridge" && terrain.hasRiver && !LEGACY_PLACEMENT) this.bridgeApproaches(holder, copies, ownPath, mm, t0, tLast, plane, matCache);

        // Tell the fabric layer (and trees, walkers) where not to put generic things.
        const t1 = phase.to != null ? histToT(phase.to) + 4 : tEnd + 1;
        const tGone = tGoneBy ?? t1;
        if (CORRIDOR_KINDS.has(kind)) {
          this.corridors.push({ path: ownPath, half: (typeof mm.width === "number" ? mm.width : 5) / 2 + 5, t0, t1: tGone });
          const closed = ownPath.length > 3 && Math.hypot(ownPath[0][0] - ownPath[ownPath.length - 1][0], ownPath[0][1] - ownPath[ownPath.length - 1][1]) < 3;
          // a closed curtain wall of castle height encloses a ward: no generic houses or trees inside
          if (kind === "wall" && closed && (typeof mm.h === "number" ? mm.h : 6) >= 7)
            this.solids.push({ id: `${lm.id}#${index}`, kind, poly: ownPath, bbox: bboxOf(ownPath), t0: t0 - 2, t1: tGone, enclosure: true });
        } else if (kind === "bridge" || kind === "stone-bridge") {
          // the roadway and its approaches (corridor widths carry a 5 m margin, as for roads)
          const [a, c] = [ownPath[0], ownPath[ownPath.length - 1]];
          const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
          const dx = (c[0] - a[0]) / L, dz = (c[1] - a[1]) / L;
          this.corridors.push({ path: [[a[0] - dx * 15, a[1] - dz * 15], [c[0] + dx * 15, c[1] + dz * 15]], half: (typeof mm.width === "number" ? mm.width : 6) / 2 + 5, t0: t0 - 2, t1: tGone });
        } else if (onBridge && refPath.length >= 2) {
          // a bridge fitting (built in world space along its bridge): its plan in the bridge's own frame
          const [a, c] = [refPath[0], refPath[refPath.length - 1]];
          const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
          const ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L;
          let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
          first.group.traverse((o) => {
            const pa = (o as THREE.Mesh).geometry?.attributes?.position;
            if (!pa) return;
            for (let i = 0; i < pa.count; i += 3) {
              const dx = pa.getX(i) + first.group.position.x - a[0], dz = pa.getZ(i) + first.group.position.z - a[1];
              const u = dx * ux + dz * uz, v = -dx * uz + dz * ux;
              if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
            }
          });
          if (isFinite(u0)) {
            const poly = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [a[0] + u * ux - v * uz, a[1] + u * uz + v * ux] as [number, number]);
            this.solids.push({ id: `${lm.id}#${index}`, kind, poly, bbox: bboxOf(poly), t0: t0 - 2, t1: tGone });
          }
        } else if (worldSpace) {
          // an earthwork built in world space reports its ground plan (circle, ring, strip): keep generic things off it
          let pi = 0;
          for (const q of first.trace) {
            if (q.kind !== "plan") continue;
            let poly: [number, number][] | null = null;
            const qx = Number(q.x), qz = Number(q.z);
            if (q.shape === "circle" || q.shape === "ring") {
              const r = Number(q.shape === "circle" ? q.r : q.r1);
              if (r > 0) poly = Array.from({ length: 16 }, (_, i) => [qx + Math.cos((i / 16) * Math.PI * 2) * r, qz + Math.sin((i / 16) * Math.PI * 2) * r] as [number, number]);
            } else if (q.shape === "strip") {
              const rot = Number(q.rot), hl = Number(q.len) / 2, hw = Number(q.width) / 2;
              const ux = Math.cos(rot), uz = -Math.sin(rot), vx = Math.sin(rot), vz = Math.cos(rot);
              if (hl > 0 && hw > 0) poly = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([u, v]) => [qx + u * ux + v * vx, qz + u * uz + v * vz] as [number, number]);
            }
            if (poly && poly.every((c) => isFinite(c[0]) && isFinite(c[1])))
              this.solids.push({ id: `${lm.id}#${index}:plan${pi++}`, kind, poly, bbox: bboxOf(poly), t0: t0 - 2, t1: tGone });
          }
        } else {
          const l = typeof mm.l === "number" ? mm.l : typeof mm.d === "number" ? mm.d : typeof mm.w === "number" ? mm.w : 20;
          const w = typeof mm.w === "number" ? mm.w : l;
          const extra = kind === "friary" ? (typeof mm.cloister === "number" ? mm.cloister : 0) : 0;
          // centred on the model's own plan (a church pinned by one end, `eastEnd` / `westEnd`, is off its point)
          let fx = x, fz = z;
          const sh = typeof mm.eastEnd === "number" ? (mm.eastEnd as number) - l / 2 : typeof mm.westEnd === "number" ? (mm.westEnd as number) + l / 2 : 0;
          if (sh) {
            const br = ((lm.bearing ?? 90) * Math.PI) / 180;
            fx += Math.sin(br) * sh;
            fz -= Math.cos(br) * sh;
          }
          this.footprints.push({ x: fx, z: fz, r: Math.hypot(l, w + extra * 2) / 2 + 6, t0: t0 - 2, t1: tGone });
          if (!FLAT_KINDS.has(kind)) {
            // the plan drawn: the model's own extent, turned with it
            const lb = new THREE.Box3();
            first.group.traverse((o) => {
              const g = (o as THREE.Mesh).geometry;
              if (!g) return;
              if (!g.boundingBox) g.computeBoundingBox();
              if (g.boundingBox) lb.union(g.boundingBox);
            });
            if (!lb.isEmpty()) {
              const c = Math.cos(first.group.rotation.y), sn = Math.sin(first.group.rotation.y);
              const poly = [[lb.min.x, lb.min.z], [lb.max.x, lb.min.z], [lb.max.x, lb.max.z], [lb.min.x, lb.max.z]].map(([lx, lz]) => [x + lx * c + lz * sn, z - lx * sn + lz * c] as [number, number]);
              this.solids.push({ id: `${lm.id}#${index}`, kind, poly, bbox: bboxOf(poly), t0: t0 - 2, t1: tGone });
            }
          }
        }
      });
    }
  }

  /**
   * A stone bridge is built once, on a fixed line, but the bank it meets moves (the City's waterfront stood some 50 m
   * further north when Old London Bridge was begun). Where an end of the bridge stands out in the water in some years,
   * a masonry approach (abutment carried on as a causeway, with its parapets) joins it to the bank of those years: one
   * copy per span of years over which the bank there moves less than a few metres.
   */
  private bridgeApproaches(holder: THREE.Group, copies: PhaseCopy[], path: [number, number][], mm: Record<string, unknown>, t0: number, t1: number, plane: THREE.Plane, matCache: Map<string, PhaseEntry["mats"][number]>): void {
    const terrain = this.terrain;
    if (path.length < 2) return;
    const [a, c] = [path[0], path[path.length - 1]];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    const ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L;
    const deck = typeof mm.deck === "number" ? mm.deck : 8, width = typeof mm.width === "number" ? mm.width : 6.1;
    const ends: { p: [number, number]; out: number }[] = [{ p: a, out: -1 }, { p: c, out: 1 }];
    // the street that meets each end (streets.json): the ramp down from the deck turns along it
    const streets = streetNetwork(this.ds.site.id, terrain.proj) ?? [];
    const alongStreet = (pts: [number, number][], from: [number, number], dist: number): [number, number] => {
      const o = Math.hypot(pts[0][0] - from[0], pts[0][1] - from[1]) <= Math.hypot(pts[pts.length - 1][0] - from[0], pts[pts.length - 1][1] - from[1]) ? pts : [...pts].reverse();
      let left = dist;
      for (let k = 1; k < o.length; k++) {
        const l = Math.hypot(o[k][0] - o[k - 1][0], o[k][1] - o[k - 1][1]);
        if (left <= l) return [o[k - 1][0] + ((o[k][0] - o[k - 1][0]) * left) / l, o[k - 1][1] + ((o[k][1] - o[k - 1][1]) * left) / l];
        left -= l;
      }
      return o[o.length - 1];
    };
    const samples = ends.flatMap((e) => Array.from({ length: 31 }, (_, k) => terrain.staticSample(e.p[0] + ux * e.out * k * 4, e.p[1] + uz * e.out * k * 4)));
    // (and along the streets that meet the ends, where the ramps run)
    for (const st of streets)
      for (const e of ends)
        if ([st.pts[0], st.pts[st.pts.length - 1]].some((p) => Math.hypot(p[0] - e.p[0], p[1] - e.p[1]) < 12))
          for (let k = 1; k <= 20; k++) samples.push(terrain.staticSample(...alongStreet(st.pts, e.p, k * 4)));
    const spans = terrain.groundSpans(samples, t0, t1, 0.4);
    const mat = (name: string) => {
      let mc = matCache.get(name);
      if (!mc) {
        const m = makeMaterial(name);
        m.clippingPlanes = [plane];
        m.clipShadows = true;
        m.side = THREE.DoubleSide;
        matCache.set(name, (mc = { m, base: m.color.clone() }));
      }
      return mc;
    };
    spans.forEach(([s0, s1], i) => {
      const yp = terrain.yearParams((s0 + s1) / 2);
      const ypA = terrain.yearParams(s0);
      const ypB = terrain.yearParams(Math.min(s1, t1));
      const b = new Builder();
      const trace: TraceItem[] = [];
      for (const [ei, e] of ends.entries()) {
        // how far out from the bank this end stands: walk landward until the ground is firm at the span's start
        // (the bank only advances, so the start is when the gap is widest)
        let d = 0;
        while (d < 120 && Math.min(terrain.heightFrom(terrain.staticSample(e.p[0] + ux * e.out * d, e.p[1] + uz * e.out * d), ypA), terrain.heightFrom(terrain.staticSample(e.p[0] + ux * e.out * d, e.p[1] + uz * e.out * d), yp)) < 1.0) d += 2;
        // the roadway runs on at deck height to the end of the abutment (4 m past the line's end) or of the approach
        const deckEnd = d < 3 ? 4 : d + 1;
        {
          // ...and from there down a ramp to the street, along the street that meets this end if there is one
          const p0: [number, number] = [e.p[0] + ux * e.out * deckEnd, e.p[1] + uz * e.out * deckEnd];
          let rx = ux * e.out, rz = uz * e.out;
          const tm = (s0 + s1) / 2;
          // (a street carried out with the reclaimed bank may end short of the bridge's line: meet it where it ends)
          const near = (q: (typeof streets)[number]) => Math.min(...[q.pts[0], q.pts[q.pts.length - 1]].flatMap((p) => [Math.hypot(p[0] - e.p[0], p[1] - e.p[1]), Math.hypot(p[0] - p0[0], p[1] - p0[1])]));
          const st = streets.filter((q) => q.t0 <= tm && tm < q.t1 && near(q) < 12).sort((p, q) => near(p) - near(q))[0];
          if (st) {
            const q = alongStreet(st.pts, p0, 30);
            const l = Math.hypot(q[0] - p0[0], q[1] - p0[1]);
            if (l > 5) { rx = (q[0] - p0[0]) / l; rz = (q[1] - p0[1]) / l; }
          }
          const gnd = (sd: number) => {
            const sm = terrain.staticSample(p0[0] + rx * sd, p0[1] + rz * sd);
            return Math.max(terrain.heightFrom(sm, ypA), terrain.heightFrom(sm, yp), terrain.heightFrom(sm, ypB));
          };
          let rl = 0, parapet = 0;
          for (; rl < 150; rl += 0.5) {
            const top = deck - RAMP_GRADE * rl, g = gnd(rl);
            if (top - g > 1.0) parapet = rl;
            if (top <= g + 0.05) break;
          }
          const yEnd = deck - RAMP_GRADE * rl;
          if (rl > 0.5) {
            b.at(p0[0], 0, p0[1], -Math.atan2(rz, rx), () => bridgeRamp(b, rl, deck, yEnd, width, parapet + 0.5));
            this.corridors.push({ path: [p0, [p0[0] + rx * rl, p0[1] + rz * rl]], half: width / 2 + 1, t0: i === 0 ? s0 - 2 : s0, t1: s1 });
          }
          trace.push({ kind: "ramp", x: p0[0] + rx * rl, z: p0[1] + rz * rl, y: yEnd + 0.25, end: ei, len: rl, x0: p0[0], z0: p0[1] });
        }
        if (d < 3) continue;
        const len = d + 2;
        const mx = e.p[0] + ux * e.out * (len / 2 - 1), mz = e.p[1] + uz * e.out * (len / 2 - 1);
        trace.push({ kind: "approach", x: e.p[0] + ux * e.out * (len - 1), z: e.p[1] + uz * e.out * (len - 1), end: ei, len });
        const rot = -Math.atan2(uz, ux);
        b.at(mx, 0, mz, rot, () => {
          b.box("ragstone", len, deck + 4, width + 1, 0, -4, 0);
          b.box("cobble", len, 0.25, width - 0.4, 0, deck, 0);
          for (const sd of [1, -1]) {
            b.box("ragstone", len, 1.15, 0.5, 0, deck, sd * (width / 2 - 0.25));
            b.box("ashlar", len + 0.05, 0.14, 0.62, 0, deck + 1.15, sd * (width / 2 - 0.25));
          }
        });
      }
      if (b.isEmpty()) return;
      const group = new THREE.Group();
      group.name = `${holder.name}:approach`;
      for (const [name, geo] of b.merged()) {
        const mesh = new THREE.Mesh(geo, mat(name).m);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.landmarkId = holder.name.split("#")[0];
        mesh.userData.mat = name;
        group.add(mesh);
      }
      group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(group);
      group.userData.box = box;
      group.visible = false;
      holder.add(group);
      copies.push({ group, win: [i === 0 ? -Infinity : s0, i === spans.length - 1 ? Infinity : s1], tBuild: (s0 + s1) / 2, trace, box });
    });
  }

  /** Path of the stone bridge that bridge fittings stand on: the landmark named by `on`, else the site's first stone bridge. */
  private bridgePath(on?: string): [number, number][] | null {
    const lm = on ? this.ds.landmarks.find((l) => l.id === on) : this.ds.landmarks.find((l) => l.phases.some((p) => p.model.kind === "stone-bridge"));
    if (!lm?.path || lm.path.length < 2) return null;
    return lm.path.map(([la, lo]) => this.terrain.proj.toLocal(la, lo));
  }

  /** Build pending copies for up to `budgetMs` (called every frame by a small extra layer, so they are ready before they are needed). */
  pump(budgetMs: number): void {
    if (!this.pendingCopies.length) return;
    const t0 = performance.now();
    while (this.pendingCopies.length && performance.now() - t0 < budgetMs) this.pendingCopies.shift()!.pending?.();
  }

  /** Build every pending copy now (diagnostics, the placement audit). */
  buildAll(): void {
    this.pump(Infinity);
  }

  setEvidenceOverlay(v: number): void {
    this.evidence = v;
  }

  private lastT = 0;
  private shared = new Map<string, THREE.MeshStandardMaterial>();
  private sharedMaterial(name: string): THREE.MeshStandardMaterial {
    let m = this.shared.get(name);
    if (!m) this.shared.set(name, (m = dressMaterial(name)));
    return m;
  }

  update(t: number): void {
    this.lastT = t;
    const c = new THREE.Color();
    for (const e of this.entries) {
      const s = phaseStatus(e.phase, t);
      e.status = s;
      const vis = s.height > 0.001;
      e.group.visible = vis;
      if (!vis) continue;
      if (e.copies.length > 1)
        for (const c of e.copies) {
          const on = t >= c.win[0] && t < c.win[1];
          if (on && c.pending) c.pending();
          c.group.visible = on;
        }
      e.plane.constant = s.height >= 0.999 ? 1e6 : e.lowY + (e.topY - e.lowY) * s.height;
      const ev = EVIDENCE_COLORS[EVIDENCE_INDEX[e.lm.evidence] ?? 1];
      for (const { m, base } of e.mats) {
        c.copy(base);
        if (s.decay > 0) c.lerp(RUIN, s.decay * 0.55);
        if (this.evidence > 0) {
          const lum = 0.35 + 0.65 * (c.r + c.g + c.b) / 3;
          c.lerp(new THREE.Color(ev).multiplyScalar(lum), this.evidence * 0.8);
        }
        m.color.copy(c);
        if (s.fire > 0) m.emissive.copy(FIRE).multiplyScalar(s.fire * 1.2);
        else if (m.emissive.r > 0) m.emissive.setScalar(0);
      }
      // A phase that stands complete, sound and untinted looks the same in every landmark's copy of a material, so
      // all such phases wear one shared set: the renderer then changes material a few dozen times a frame, not
      // once per landmark, and the shared set carries no clipping plane. A phase being built, in ruin, on fire or
      // under the evidence overlay wears its own.
      const plain = s.height >= 0.999 && !(s.decay > 0) && !(s.fire > 0) && this.evidence <= 0;
      e.group.traverse((o) => {
        const name = o.userData.mat as string | undefined;
        if (!name || name.startsWith("flat:")) return;
        const own = e.byName.get(name);
        if (!own) return;
        (o as THREE.Mesh).material = plain ? this.sharedMaterial(name) : own.m;
      });
    }
    this.hideSuperseded();
  }

  /** Remains of an earlier phase are cleared as soon as its successor on the same site has begun. */
  private hideSuperseded(): void {
    for (const [, list] of this.byLandmark) {
      // (several copies of one phase, built for successive spans of years, are not successors of each other)
      let laterStarted = -1;
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (laterStarted > e.index && (e.status.state === "ruin" || e.status.state === "teardown")) e.group.visible = false;
        if (e.status.state !== "absent") laterStarted = Math.max(laterStarted, e.index);
      }
    }
  }

  /** The phase of each landmark that is currently visible (if any). */
  active(): ActiveLandmark[] {
    const out: ActiveLandmark[] = [];
    for (const [, list] of this.byLandmark) {
      let best: PhaseEntry | null = null;
      for (const e of list) if (e.group.visible && (!best || e.status.height >= best.status.height)) best = e;
      if (!best) continue;
      // the box of the copy shown (a bridge's approaches are never the labelled part)
      const shown = best.copies.find((c) => c.group.visible && !c.group.name.endsWith(":approach")) ?? best.copies[0];
      const box = (shown?.box ?? best.group.userData.box) as THREE.Box3;
      const anchor = new THREE.Vector3((box.min.x + box.max.x) / 2, best.lowY + (best.topY - best.lowY) * best.status.height + 4, (box.min.z + box.max.z) / 2);
      // a linear landmark (a wall circuit, a quay, a road) is labelled on itself, not at the middle of its bounding box
      const lp = best.lm.path;
      if (WORLD_SPACE_KINDS.has(best.phase.model.kind) && lp && lp.length >= 2 && !LEGACY_PLACEMENT) {
        const pts = lp.map(([la, lo]) => this.terrain.proj.toLocal(la, lo));
        let bx = pts[0][0], bz = pts[0][1], bd = Infinity;
        for (let i = 1; i < pts.length; i++) {
          const [ax, az] = pts[i - 1], [cx, cz] = pts[i];
          const dx = cx - ax, dz = cz - az, l2 = dx * dx + dz * dz || 1;
          const f = Math.max(0, Math.min(1, ((anchor.x - ax) * dx + (anchor.z - az) * dz) / l2));
          const px = ax + dx * f, pz = az + dz * f, d = Math.hypot(px - anchor.x, pz - anchor.z);
          if (d < bd) { bd = d; bx = px; bz = pz; }
        }
        if (bd > 20) {
          const g = this.terrain.floor(this.terrain.height(bx, bz, this.lastT));
          const rise = Math.max(2, Math.min(30, best.topY - best.lowY - 3));
          anchor.set(bx, g + rise * best.status.height + 4, bz);
        }
      }
      // never under the surface (a ditch or a low earthwork on rising ground)
      const gy = this.terrain.floor(this.terrain.height(anchor.x, anchor.z, this.lastT));
      if (isFinite(gy) && anchor.y < gy + 4) anchor.y = gy + 4;
      out.push({ lm: best.lm, phase: best.phase, phaseIndex: best.index, status: best.status, anchor, size: box.getSize(new THREE.Vector3()).length() });
    }
    return out;
  }

  statusOf(id: string, t: number): { phaseIndex: number; label: string; state: string; height: number }[] {
    const lm = this.ds.landmarks.find((l) => l.id === id);
    if (!lm) return [];
    return lm.phases.map((p, i) => {
      const s = phaseStatus(p, t);
      return { phaseIndex: i, label: p.label, state: s.state, height: s.height };
    });
  }

  pickables(): THREE.Object3D[] {
    return this.entries.filter((e) => e.group.visible).map((e) => e.group);
  }

  focusBox(id: string): THREE.Box3 | null {
    const list = this.byLandmark.get(id);
    if (!list) return null;
    const vis = list.find((e) => e.group.visible) ?? list[list.length - 1];
    return (vis.group.userData.box as THREE.Box3) ?? null;
  }
}
