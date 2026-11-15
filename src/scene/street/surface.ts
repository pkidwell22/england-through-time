import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { TerrainModel } from "@/lib/terrain";
import type { LandmarkLayer } from "../landmarks";
import { makeMaterial, tileOf } from "../materials";
import type { Street } from "./network";
import { LEGACY_PLACEMENT } from "../placementMode";

/**
 * Street surfaces of the district network, draped on the terrain: cobbles, gravel or trodden earth according
 * to each street's dated `surface` periods in streets.json, with a central kennel (gutter) on medieval and
 * later streets. The surface dips slightly to the kennel and fades out at its edges (it runs under the house
 * plinths, so the fade only shows in gaps). Each period is its own mesh, shown only during its years.
 * Ruts and puddles near the camera belong to the ground layer (src/scene/ground), not here.
 */

const MAT: Record<string, string> = { cobble: "street-cobble", gravel: "street-gravel", earth: "street-earth" };

export interface SurfaceMesh { mesh: THREE.Mesh; t0: number; t1: number }

function material(name: string, lift: number): THREE.MeshStandardMaterial {
  const m = makeMaterial(name);
  m.transparent = true;
  m.vertexColors = true;
  m.depthWrite = false;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2 - lift;
  m.polygonOffsetUnits = -4 - lift * 2;
  return m;
}

export function buildStreetSurfaces(streets: Street[], terrain: TerrainModel, landmarks: LandmarkLayer, bounds: { xMin: number; xMax: number; zMin: number; zMax: number }): SurfaceMesh[] {
  const out: SurfaceMesh[] = [];
  const matCache = new Map<string, THREE.MeshStandardMaterial>();
  const getMat = (name: string, lift: number) => {
    const k = `${name}|${lift}`;
    let m = matCache.get(k);
    if (!m) matCache.set(k, (m = material(name, lift)));
    return m;
  };
  // one mesh per material and dated period: streets sharing both are merged (few draw calls)
  const groups = new Map<string, { name: string; lf: number; t0: number; t1: number; geos: THREE.BufferGeometry[] }>();
  const M = 0;
  const inside = (x: number, z: number) => x > bounds.xMin - M && x < bounds.xMax + M && z > bounds.zMin - M && z < bounds.zMax + M;
  // The ground under the streets moves (the bank advances, reclaimed ground rises): each dated surface period is
  // split into spans of years over which the ground under every street of that period stays within 0.12 m, and
  // draped afresh for each span, so it is never buried and never left over water. The spans are shared by all
  // streets of a period, so the meshes still merge.
  const periodSpans = new Map<string, [number, number][]>();
  // every span re-drapes the same points: keep their static terrain samples
  const statCache = new Map<string, ReturnType<TerrainModel["staticSample"]>>();
  const statAt = (x: number, z: number) => {
    const k = `${x},${z}`;
    let sm = statCache.get(k);
    if (!sm) statCache.set(k, (sm = terrain.staticSample(x, z)));
    return sm;
  };
  const spansOf = (t0: number, t1: number): [number, number][] => {
    const key = `${t0}|${t1}`;
    let sp = periodSpans.get(key);
    if (sp) return sp;
    const pts: [number, number][] = [];
    for (const st of streets) {
      if (!st.surface.some((q) => Math.max(q.t0, st.t0) < t1 && Math.min(q.t1, st.t1) > t0)) continue;
      for (let i = 1; i < st.pts.length; i++) {
        const [ax, az] = st.pts[i - 1], [bx, bz] = st.pts[i];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 6));
        for (let k = 0; k <= n; k++) {
          const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
          if (inside(x, z)) pts.push([x, z]);
        }
      }
    }
    sp = pts.length && !LEGACY_PLACEMENT ? terrain.groundSpans(pts.map(([x, z]) => terrain.staticSample(x, z)), t0, t1, 0.12) : [[t0, t1]];
    periodSpans.set(key, sp);
    return sp;
  };
  for (const st of streets) {
    for (const per of st.surface) {
      const p0 = Math.max(per.t0, st.t0), p1 = Math.min(per.t1, st.t1);
      if (p1 <= p0) continue;
      for (const [t0, t1] of spansOf(p0, p1)) {
      const matName = MAT[per.material] ?? "street-earth";
      const yp = terrain.yearParams((t0 + t1) / 2);
      const ypA = terrain.yearParams(t0), ypB = terrain.yearParams(t1);
      const hw = st.width / 2;
      const lift = 3 - Math.min(3, st.rank); // principal streets draw over lanes at junctions
      const kennel = per.material !== "gravel" || st.rank > 0 || t0 > 900;
      // cross-section: offsets across the street, alpha and height above the ground
      const xs = [-hw - 0.7, -hw + 0.2, -hw * 0.45, 0, hw * 0.45, hw - 0.2, hw + 0.7];
      const al = [0, 1, 1, 1, 1, 1, 0];
      const dy = xs.map((x) => 0.07 + (kennel ? Math.min(1, Math.abs(x) / Math.max(1, hw)) * 0.05 : 0.02));
      const ks = [-0.45, -0.18, 0, 0.18, 0.45];
      const ka = [0, 1, 1, 1, 0];
      const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
      const kpos: number[] = [], kuv: number[] = [], kcol: number[] = [], kidx: number[] = [];
      const tile = tileOf(matName), ktile = tileOf("kennel");
      let along = 0;
      const pts = st.pts;
      // resample the polyline every 2 m with mitred normals
      const samples: { x: number; z: number; nx: number; nz: number; s: number }[] = [];
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
        const L = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.ceil(L / 2));
        for (let k = i === 1 ? 0 : 1; k <= n; k++) {
          const f = k / n;
          samples.push({ x: ax + (bx - ax) * f, z: az + (bz - az) * f, nx: -(bz - az) / L, nz: (bx - ax) / L, s: along + L * f });
        }
        along += L;
      }
      // smooth normals at the joints
      for (let i = 1; i < samples.length - 1; i++) {
        const a = samples[i - 1], c = samples[i + 1];
        const tx = c.x - a.x, tz = c.z - a.z, l = Math.hypot(tx, tz) || 1;
        samples[i].nx = -tz / l;
        samples[i].nz = tx / l;
      }
      const keep = samples.map((p) => {
        if (!inside(p.x, p.z)) return false;
        for (const f of landmarks.footprints) {
          if (!(f.t1 > t0 && f.t0 < t1)) continue;
          const core = Math.max(0, (f.r - 6) * 0.8);
          if ((p.x - f.x) ** 2 + (p.z - f.z) ** 2 < core * core) return false;
        }
        // dry for the whole span (the bank only advances, so both ends suffice, bar a neglected embankment)
        const sm = statAt(p.x, p.z);
        return terrain.dry(terrain.heightFrom(sm, yp), 0.4) && terrain.dry(terrain.heightFrom(sm, ypA), 0.4) && terrain.dry(terrain.heightFrom(sm, ypB), 0.4);
      });
      let prevRow = -1, prevK = -1;
      samples.forEach((p, i) => {
        if (!keep[i]) { prevRow = -1; prevK = -1; return; }
        const row = pos.length / 3;
        xs.forEach((o, j) => {
          const x = p.x + p.nx * o, z = p.z + p.nz * o;
          const y = terrain.heightFrom(statAt(x, z), yp) + dy[j];
          pos.push(x, y, z);
          uv.push((o + hw) / tile, p.s / tile);
          col.push(1, 1, 1, al[j]);
        });
        if (prevRow >= 0)
          for (let j = 0; j < xs.length - 1; j++) {
            const a = prevRow + j, b = prevRow + j + 1, c = row + j, d = row + j + 1;
            idx.push(a, b, c, b, d, c);
          }
        prevRow = row;
        if (kennel) {
          const krow = kpos.length / 3;
          ks.forEach((o, j) => {
            const x = p.x + p.nx * o, z = p.z + p.nz * o;
            const y = terrain.heightFrom(statAt(x, z), yp) + 0.075;
            kpos.push(x, y, z);
            kuv.push(o / ktile, p.s / ktile);
            kcol.push(1, 1, 1, ka[j]);
          });
          if (prevK >= 0)
            for (let j = 0; j < ks.length - 1; j++) {
              const a = prevK + j, b = prevK + j + 1, c = krow + j, d = krow + j + 1;
              kidx.push(a, b, c, b, d, c);
            }
          prevK = krow;
        }
      });
      const mk = (P: number[], U: number[], C: number[], I: number[], name: string, lf: number) => {
        if (!I.length) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
        g.setAttribute("color", new THREE.Float32BufferAttribute(C, 4));
        g.setIndex(I);
        g.computeVertexNormals();
        const key = `${name}|${lf}|${t0}|${t1}`;
        let grp = groups.get(key);
        if (!grp) groups.set(key, (grp = { name, lf, t0, t1, geos: [] }));
        grp.geos.push(g);
      };
      mk(pos, uv, col, idx, matName, lift);
      if (kennel) mk(kpos, kuv, kcol, kidx, "kennel", lift + 1);
      }
    }
  }
  for (const grp of groups.values()) {
    const g = mergeGeometries(grp.geos, false);
    for (const q of grp.geos) q.dispose();
    if (!g) continue;
    const mesh = new THREE.Mesh(g, getMat(grp.name, grp.lf));
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.name = `streets:${grp.name}`;
    mesh.visible = false;
    mesh.userData.t0 = grp.t0;
    mesh.userData.t1 = grp.t1;
    out.push({ mesh, t0: grp.t0, t1: grp.t1 });
  }
  return out;
}
