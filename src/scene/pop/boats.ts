import * as THREE from "three";
import type { Dataset, Phase, VesselType } from "@/lib/types";
import { hash2, pointSegment } from "@/lib/geo";
import { phaseStatus } from "@/lib/lifecycle";
import type { TerrainModel } from "@/lib/terrain";
import { histToT } from "@/lib/years";
import { bridgeLayout, CHAPEL_PIER } from "../district";
import { buildVessel, readModel, type Sink, type VesselModel } from "../vessels/model";
import { fleetOf, frameOf, typesOf } from "../vessels/placement";
import { applyLookFog } from "../look/atmosphere";

/**
 * Moving river craft with wakes. ILLUSTRATIVE: routes, speeds and positions are invented. What is not invented is
 * WHICH craft move: each `boats` phase's fleet names, per vessel type from the site's vessels.json, how many of that
 * type are set moving (`moving`, scaled by quality), so the moving craft are the same period types as the moored
 * ones, appear and vanish with the phase, and use the same model. Rules:
 *  - craft that cannot pass a bridge (catalogue `passesBridge: false`: masted ships and barges) keep to the reach on
 *    their zone's side of any bridge standing that year ("below" = downstream);
 *  - small craft pass a bridge only through an opening: the arches of the stone bridge (from bridgeLayout) or the
 *    gaps between the trestles of a timber bridge, never through a pier;
 *  - in a year with no bridge, all traffic passes freely.
 * Never used where the site has no river. Staged moments (a fleet entry with `state`) are left to the builder.
 */

interface Entry {
  phase: Phase;
  mid: [number, number];
  type: VesselType;
  model: VesselModel;
  zone: string;
  n: number;
  built: boolean;
  /** Along-path position of the landmark's crossing (for "above"/"below"), as a world point, or null. */
  cross: [number, number] | null;
}
interface Reach {
  cx: Float32Array; cz: Float32Array; nx: Float32Array; nz: Float32Array; dp: Float32Array; dm: Float32Array;
  arc: Float32Array;
  valid: Uint8Array;
}
interface Bridge {
  phase: Phase;
  id: string;
  /** World points of the opening centres (water only). */
  openings: [number, number][];
  /** Arc length along the river centreline where it crosses. */
  arc: number;
  /** Piers and trestles (with their starlings) in plan: centre, unit vector along the bridge, half-sizes along / across it. */
  piers: { x: number; z: number; ux: number; uz: number; ha: number; hc: number }[];
}
interface Boat {
  entry: number;
  idx: number;
  len: number;
  th: number;
  cross: boolean;
  speed: number;
  dir: number;
  s0: number;
  q: number;
  key: string;
  lx: Float32Array | null; lz: Float32Array | null; lc: Float32Array | null; Ls: number;
  ax: number; az: number; bx: number; bz: number;
  tint: THREE.Color;
}
interface TypeMesh { mesh: THREE.InstancedMesh; n: number }

const STEP = 30;
const HALF = 800;
/** Lane points kept clear of a bridge line (the lane is replaced there by a straight run through one opening). */
const BRIDGE_GAP = 40;

/** Colours for the vertex-coloured instanced copies, by material name. */
const MAT_COLOURS: Record<string, number> = {
  timber: 0x6d5638, "timber-weathered": 0x55493d, oak: 0x6b5233, planks: 0x7a6248, dark: 0x2b2118, plaster: 0xd8ccb2,
  ragstone: 0x8e8a78, daub: 0xcdbd9c, tegula: 0x9c5a3c, gold: 0xb08d3c,
};
const colourOf = (mat: string): number => {
  if (mat.startsWith("flat:")) return new THREE.Color(mat.split(":")[1] || "#888888").getHex();
  return MAT_COLOURS[mat] ?? 0x6d5638;
};

/** The same parametric model as the moored craft, under way, as one vertex-coloured geometry. */
function underwayGeometry(model: VesselModel): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const sink: Sink = {
    add(mat, g, m) {
      let geo = g.index ? g.toNonIndexed() : g.clone();
      if (!geo.attributes.normal) geo.computeVertexNormals();
      geo = geo.applyMatrix4(m);
      const p = geo.getAttribute("position"), n = geo.getAttribute("normal");
      const c = new THREE.Color(colourOf(mat));
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        nor.push(n.getX(i), n.getY(i), n.getZ(i));
        col.push(c.r, c.g, c.b);
      }
      geo.dispose();
    },
  };
  buildVessel(sink, model, "underway", new THREE.Matrix4());
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Kelvin-style V wake: unit boat length, bow at +x. uv: x = distance behind the bow (0..1), y = across (-1..1). */
function wakeGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const seg = 12, armLen = 3.4, ang = 0.34;
  const strip = (p0: [number, number], dirx: number, dirz: number, w0: number, w1: number, len: number): void => {
    const base = pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      const cx = p0[0] + dirx * len * u, cz = p0[1] + dirz * len * u;
      const w = w0 + (w1 - w0) * u;
      const nx = -dirz, nz = dirx;
      pos.push(cx + nx * w, 0, cz + nz * w, cx - nx * w, 0, cz - nz * w);
      uv.push(u, 1, u, -1);
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  for (const s of [-1, 1]) strip([0.5, 0], -Math.cos(ang), s * Math.sin(ang), 0.1, 0.5, armLen);
  strip([-0.5, 0], -1, 0, 0.2, 0.42, 2.6);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class BoatLayer {
  readonly group = new THREE.Group();
  private entries: Entry[] = [];
  private boats: Boat[] = [];
  private reaches = new Map<number, Reach>();
  private meshes = new Map<string, TypeMesh>();
  private wake: THREE.InstancedMesh | null = null;
  private wakeA: THREE.InstancedBufferAttribute | null = null;
  private wakeMat: THREE.ShaderMaterial | null = null;
  private river: [number, number][] = [];
  private cum: number[] = [];
  private bridges: Bridge[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private col = new THREE.Color();
  count = 0;

  constructor(private ds: Dataset, private terrain: TerrainModel, private scale: number, wakes: boolean) {
    this.group.name = "river-craft";
    // diagnostics / placement audit: the layer is reachable from the scene graph
    this.group.userData.layer = this;
    if (!terrain.hasRiver) return;
    const cl = ds.site.river?.centreline ?? [];
    this.river = cl.map(([la, lo]) => terrain.proj.toLocal(la, lo));
    this.cum = [0];
    for (let i = 1; i < this.river.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(this.river[i][0] - this.river[i - 1][0], this.river[i][1] - this.river[i - 1][1]));
    this.collectBridges();
    let total = 0;
    for (const lm of ds.landmarks) {
      const pts = (lm.path ?? []).map(([la, lo]) => terrain.proj.toLocal(la, lo));
      const mid: [number, number] = pts.length >= 2 ? [(pts[0][0] + pts[pts.length - 1][0]) / 2, (pts[0][1] + pts[pts.length - 1][1]) / 2] : terrain.proj.toLocal(lm.lat, lm.lon);
      for (const phase of lm.phases) {
        if (phase.model.kind !== "boats") continue;
        const types = typesOf(phase.model);
        const f = frameOf(phase.model, { path: pts, project: (la, lo) => terrain.proj.toLocal(la, lo) });
        const cross: [number, number] | null = f && f.sc != null ? [f.ax + f.dx * f.sc, f.az + f.dz * f.sc] : null;
        for (const fe of fleetOf(phase.model)) {
          if (fe.state || !fe.moving) continue;
          const type = types[fe.type];
          if (!type) continue;
          const n = Math.min(24, Math.max(1, Math.round(fe.moving * this.scale)));
          if (total + n > 120) continue;
          total += n;
          this.entries.push({ phase, mid, type, model: readModel(type.model), zone: fe.zone, n, built: false, cross });
        }
      }
    }
    // one instanced mesh per vessel type, sized for the most of that type any phase sets moving
    const need = new Map<string, number>();
    for (const e of this.entries) need.set(e.type.id, Math.max(need.get(e.type.id) ?? 0, e.n * 2));
    for (const e of this.entries) {
      if (this.meshes.has(e.type.id)) continue;
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
      const mesh = new THREE.InstancedMesh(underwayGeometry(e.model), mat, Math.max(4, need.get(e.type.id) ?? 4));
      mesh.name = `craft:${e.type.id}`;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.userData.noPick = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes.set(e.type.id, { mesh, n: 0 });
      this.group.add(mesh);
    }
    if (wakes && this.entries.length) {
      const cap = Math.max(8, Math.min(240, total * 2));
      const g = wakeGeometry();
      const aW = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("aW", aW);
      this.wakeA = aW;
      this.wakeMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        uniforms: { uTime: { value: 0 } },
        vertexShader: `
          attribute vec2 aW; uniform float uTime;
          varying vec2 vUv; varying vec3 vWp; varying vec2 vW;
          void main() {
            vUv = uv; vW = aW;
            vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
            vWp = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: `
          uniform float uTime;
          varying vec2 vUv; varying vec3 vWp; varying vec2 vW;
          void main() {
            float across = 1.0 - smoothstep(0.45, 1.0, abs(vUv.y));
            float fade = max(0.0, 1.0 - vUv.x);
            float ripple = 0.72 + 0.28 * sin(vUv.x * 46.0 - uTime * 3.2 + vWp.x * 0.3);
            float foam = 0.5 + 0.5 * sin(vWp.x * 1.9 + uTime * 1.1) * sin(vWp.z * 2.3 - uTime * 0.8);
            float a = across * fade * ripple * (0.6 + 0.4 * foam) * vW.x * 1.1;
            if (a < 0.01) discard;
            gl_FragColor = vec4(vec3(0.86, 0.9, 0.92), a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      });
      // look hook: aerial perspective, mist and the light of the current sky (src/scene/look/atmosphere.ts)
      applyLookFog(this.wakeMat, { lit: true });
      this.wake = new THREE.InstancedMesh(g, this.wakeMat, cap);
      this.wake.frustumCulled = false;
      this.wake.count = 0;
      this.wake.renderOrder = 3;
      this.wake.userData.noPick = true;
      this.group.add(this.wake);
    }
  }

  get any(): boolean {
    return this.entries.length > 0;
  }

  /** Every bridge phase with the world positions of its openings (stone arches, or the gaps between timber trestles). */
  private collectBridges(): void {
    const t = this.terrain;
    for (const lm of this.ds.landmarks) {
      const pts = (lm.path ?? []).map(([la, lo]) => t.proj.toLocal(la, lo));
      if (pts.length < 2) continue;
      lm.phases.forEach((ph, i) => {
        const k = ph.model.kind;
        if (k !== "bridge" && k !== "stone-bridge") return;
        const [a, c] = [pts[0], pts[pts.length - 1]];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const dx = (c[0] - a[0]) / len, dz = (c[1] - a[1]) / len;
        const at = (d: number): [number, number] => [a[0] + dx * d, a[1] + dz * d];
        let cent: number[] = [];
        const piers: Bridge["piers"] = [];
        const width = typeof ph.model.width === "number" ? ph.model.width : 6;
        if (k === "stone-bridge") {
          const L = bridgeLayout(pts, typeof ph.model.arches === "number" ? ph.model.arches : 19);
          cent = L.openings.map((o) => (o.x0 + o.x1) / 2);
          // a pier and its starling (as district.ts builds it: 1.2-2.8 m beyond the pier into each arch, ~8-21 m up- and
          // downstream)
          L.piers.forEach((pr, j) => {
            const ext = (o: { x0: number; x1: number }) => Math.max(1.2, Math.min(2.8, 0.36 * (o.x1 - o.x0)));
            // (the chapel pier's starling is 0.6 m fuller each side)
            const chap = j === CHAPEL_PIER ? 0.6 : 0;
            const eL = ext(L.openings[j]) + chap, eR = ext(L.openings[j + 1]) + chap;
            const [px, pz] = at((pr.x0 - eL + pr.x1 + eR) / 2);
            piers.push({ x: px, z: pz, ux: dx, uz: dz, ha: (pr.x1 - pr.x0 + eL + eR) / 2, hc: 13 });
          });
        } else {
          // the timber builder sets a trestle at every (len / n) metres
          const span = typeof ph.model.span === "number" ? ph.model.span : 12;
          const n = Math.max(2, Math.round(len / span));
          for (let j = 0; j < n; j++) cent.push(((j + 0.5) * len) / n);
          for (let j = 0; j <= n; j++) {
            const [px, pz] = at((j * len) / n);
            piers.push({ x: px, z: pz, ux: dx, uz: dz, ha: 0.6, hc: width / 2 + 1.2 });
          }
        }
        const yp = t.yearParams(histToT(ph.built ?? ph.from) + 2);
        const openings = cent.map(at).filter(([x, z]) => t.heightFrom(t.staticSample(x, z), yp) < -0.8);
        if (!openings.length) return;
        const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
        this.bridges.push({ phase: ph, id: `${lm.id}#${i}`, openings, arc: this.arcOf(mx, mz), piers });
      });
    }
  }

  private arcOf(x: number, z: number): number {
    let best = Infinity, arc = 0;
    for (let i = 1; i < this.river.length; i++) {
      const ps = pointSegment(x, z, this.river[i - 1][0], this.river[i - 1][1], this.river[i][0], this.river[i][1]);
      if (ps.d < best) {
        best = ps.d;
        arc = this.cum[i - 1] + ps.f * (this.cum[i] - this.cum[i - 1]);
      }
    }
    return arc;
  }
  private at(arc: number): { x: number; z: number; tx: number; tz: number } {
    const n = this.river.length;
    const a = Math.max(0, Math.min(this.cum[n - 1], arc));
    let i = 1;
    while (i < n - 1 && this.cum[i] < a) i++;
    const f = (a - this.cum[i - 1]) / Math.max(1e-6, this.cum[i] - this.cum[i - 1]);
    const [ax, az] = this.river[i - 1], [bx, bz] = this.river[i];
    const d = Math.hypot(bx - ax, bz - az) || 1;
    return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, tx: (bx - ax) / d, tz: (bz - az) / d };
  }

  private buildReach(e: Entry): Reach | null {
    if (this.river.length < 2) return null;
    const terrain = this.terrain;
    const tA = histToT(e.phase.built ?? e.phase.from) + 2;
    const tB = e.phase.to != null ? histToT(e.phase.to) : histToT(this.ds.site.timeline.end);
    const ypA = terrain.yearParams(tA), ypB = terrain.yearParams(Math.max(tA, tB));
    const depth = Math.max(0.8, e.model.draft + 0.3);
    const wet = (x: number, z: number): boolean => {
      const s = terrain.staticSample(x, z);
      return terrain.heightFrom(s, ypA) < -depth && terrain.heightFrom(s, ypB) < -depth;
    };
    const s0 = this.arcOf(e.mid[0], e.mid[1]);
    const n = Math.floor((2 * HALF) / STEP);
    const R: Reach = { cx: new Float32Array(n), cz: new Float32Array(n), nx: new Float32Array(n), nz: new Float32Array(n), dp: new Float32Array(n), dm: new Float32Array(n), arc: new Float32Array(n), valid: new Uint8Array(n) };
    for (let k = 0; k < n; k++) {
      const arc = s0 - HALF + k * STEP;
      const c = this.at(arc);
      R.arc[k] = arc;
      R.cx[k] = c.x; R.cz[k] = c.z;
      R.nx[k] = -c.tz; R.nz[k] = c.tx;
      if (arc < 0 || arc > this.cum[this.cum.length - 1] || !wet(c.x, c.z)) continue;
      for (const sd of [1, -1]) {
        let d = 0;
        while (d < 700 && wet(c.x + R.nx[k] * sd * (d + 10), c.z + R.nz[k] * sd * (d + 10))) d += 10;
        if (sd > 0) R.dp[k] = d; else R.dm[k] = d;
      }
      R.valid[k] = R.dp[k] + R.dm[k] > Math.max(40, e.model.len * 3) ? 1 : 0;
    }
    return R;
  }

  private spawn(e: Entry, ei: number): void {
    const small = e.model.passesBridge && e.model.len < 12;
    for (let i = 0; i < e.n; i++) {
      const hs = (k: number): number => hash2(ei * 977 + i * 31 + k, i * 13 + k * 7 + ei);
      const cross = small && hs(2) < 0.3 && !e.zone.startsWith("north") && !e.zone.startsWith("south");
      const big = !e.model.passesBridge;
      const base = big ? 0.9 + hs(4) * 0.7 : e.model.len < 8 ? 1.7 + hs(4) * 1.1 : 1.1 + hs(4) * 0.8;
      // keep north/south zone craft towards their own bank
      const zq = e.zone.startsWith("north") ? -1 : e.zone.startsWith("south") ? 1 : hs(7) < 0.5 ? -1 : 1;
      this.boats.push({
        entry: ei, idx: i, len: e.model.len, th: (i + 0.5) / e.n, cross, speed: cross ? 1.5 : base, dir: hs(5) < 0.5 ? 1 : -1, s0: hs(6),
        q: zq * (0.12 + hs(8) * 0.55), key: "", lx: null, lz: null, lc: null, Ls: 0, ax: 0, az: 0, bx: 0, bz: 0,
        tint: new THREE.Color().setScalar(0.86 + hs(9) * 0.2),
      });
    }
  }

  /** Lay a boat's lane (or ferry crossing) for the bridges standing now. */
  private layLane(b: Boat, e: Entry, R: Reach, standing: Bridge[]): void {
    const n = R.arc.length;
    const near = (arc: number): boolean => standing.some((br) => Math.abs(arc - br.arc) < BRIDGE_GAP + (e.model.passesBridge ? 0 : 60));
    // the side of the crossing this zone belongs to, for craft that cannot pass a bridge
    let lo = 0, hi = n - 1;
    const below = e.zone === "pool" || e.zone === "below" || e.zone.endsWith("-below");
    const above = e.zone === "above" || e.zone.endsWith("-above");
    const crossArc = e.cross ? this.arcOf(e.cross[0], e.cross[1]) : null;
    if (crossArc != null && (below || above)) {
      for (let k = 0; k < n; k++) {
        if (below && R.arc[k] < crossArc + 50) lo = k + 1;
        if (above && R.arc[k] > crossArc - 50 && hi === n - 1) hi = k - 1;
      }
    }
    if (!e.model.passesBridge) {
      // a bridge standing this year splits the river: stay in the stretch that holds the boat's zone (or its middle)
      const ref = below && crossArc != null ? crossArc + 150 : above && crossArc != null ? crossArc - 150 : R.arc[Math.floor((lo + hi) / 2)];
      for (const br of standing) {
        if (br.arc < ref) for (let k = lo; k <= hi; k++) if (R.arc[k] < br.arc + BRIDGE_GAP + 60) lo = k + 1;
        if (br.arc > ref) for (let k = hi; k >= lo; k--) if (R.arc[k] > br.arc - BRIDGE_GAP - 60) hi = k - 1;
      }
    }
    // contiguous valid run containing the boat's own start
    const runs: [number, number][] = [];
    let a = -1;
    for (let k = lo; k <= hi + 1; k++) {
      const ok = k <= hi && (R.valid[k] || (e.model.passesBridge && near(R.arc[k])));
      if (ok && a < 0) a = k;
      if (!ok && a >= 0) { if (k - a >= 6) runs.push([a, k - 1]); a = -1; }
    }
    b.lx = b.lz = b.lc = null;
    b.Ls = 0;
    if (!runs.length) return;
    const run = runs[Math.floor(b.s0 * runs.length) % runs.length];
    if (b.cross) {
      const cands: number[] = [];
      for (let k = run[0] + 1; k < run[1]; k++) if (R.valid[k] && !standing.some((br) => Math.abs(R.arc[k] - br.arc) < 90)) cands.push(k);
      if (!cands.length) return;
      const k = cands[Math.floor(b.s0 * 7.3 * cands.length) % cands.length];
      b.ax = R.cx[k] - R.nx[k] * R.dm[k] * 0.72; b.az = R.cz[k] - R.nz[k] * R.dm[k] * 0.72;
      b.bx = R.cx[k] + R.nx[k] * R.dp[k] * 0.72; b.bz = R.cz[k] + R.nz[k] * R.dp[k] * 0.72;
      b.Ls = Math.hypot(b.bx - b.ax, b.bz - b.az);
      return;
    }
    const xs: number[] = [], zs: number[] = [];
    const bridgesIn = standing.filter((br) => br.arc > R.arc[run[0]] && br.arc < R.arc[run[1]]).sort((p, q) => p.arc - q.arc);
    /** Does the straight run through (ox, oz) along (tx, tz) pass clear of every pier of every bridge standing now? */
    const clearRun = (ox: number, oz: number, tx: number, tz: number): boolean => {
      for (let d = -BRIDGE_GAP * 0.8; d <= BRIDGE_GAP * 0.8; d += 1.5) {
        const x = ox + tx * d, z = oz + tz * d;
        for (const br of standing)
          for (const p of br.piers) {
            const rx = x - p.x, rz = z - p.z;
            const a = rx * p.ux + rz * p.uz, c = -rx * p.uz + rz * p.ux;
            if (Math.abs(a) < p.ha + e.model.beam / 2 + 0.1 && Math.abs(c) < p.hc + e.model.len / 2) return false;
          }
      }
      return true;
    };
    let bi = 0;
    for (let k = run[0]; k <= run[1]; k++) {
      while (bi < bridgesIn.length && bridgesIn[bi].arc <= R.arc[k]) {
        // a straight run through the opening nearest the lane's own line; bridges standing close together (an old
        // bridge kept while its successor is built beside it) are one crossing, passed through openings clear of both
        const br = bridgesIn[bi++];
        const group = [br];
        while (bi < bridgesIn.length && bridgesIn[bi].arc - br.arc < BRIDGE_GAP * 1.6) group.push(bridgesIn[bi++]);
        const c = this.at(br.arc);
        const nx = -c.tz, nz = c.tx;
        const want = b.q * 120;
        const opts = group.flatMap((g) => g.openings).map((o) => ({ o, d: Math.abs((o[0] - c.x) * nx + (o[1] - c.z) * nz - want) })).sort((p, q) => p.d - q.d);
        // shoot the arch square to the bridge (the run along the river would graze the starlings of an oblique bridge)
        const p0 = br.piers[0];
        let rx = p0 ? -p0.uz : c.tx, rz = p0 ? p0.ux : c.tz;
        if (rx * c.tx + rz * c.tz < 0) { rx = -rx; rz = -rz; }
        const pick = opts.find((q) => clearRun(q.o[0], q.o[1], rx, rz));
        if (!pick) return; // no clear opening for this craft: it is not set moving here
        const best = pick.o;
        for (const d of [-BRIDGE_GAP * 0.8, 0, BRIDGE_GAP * 0.8]) { xs.push(best[0] + rx * d); zs.push(best[1] + rz * d); }
      }
      if (near(R.arc[k]) || !R.valid[k]) continue;
      const o = b.q > 0 ? b.q * R.dp[k] : b.q * R.dm[k];
      xs.push(R.cx[k] + R.nx[k] * o);
      zs.push(R.cz[k] + R.nz[k] * o);
    }
    if (xs.length < 4) return;
    b.lx = new Float32Array(xs); b.lz = new Float32Array(zs); b.lc = new Float32Array(xs.length);
    for (let j = 1; j < xs.length; j++) b.lc[j] = b.lc[j - 1] + Math.hypot(xs[j] - xs[j - 1], zs[j] - zs[j - 1]);
    b.Ls = b.lc[xs.length - 1];
  }

  update(t: number, timeSec: number): void {
    if (!this.terrain.hasRiver || !this.entries.length) return;
    if (this.wakeMat) this.wakeMat.uniforms.uTime.value = timeSec;
    let any = false;
    const pres: number[] = [];
    this.entries.forEach((e, i) => {
      const st = phaseStatus(e.phase, t);
      const f = st.state === "intact" ? 1 : st.state === "construction" ? st.height : Math.max(0, (st.height - 0.3) / 0.7);
      pres.push(f);
      if (f > 0.01 && !e.built) {
        e.built = true;
        const R = this.buildReach(e);
        if (R) {
          this.reaches.set(i, R);
          this.spawn(e, i);
        }
      }
      if (f > 0.01) any = true;
    });
    this.group.visible = any;
    for (const tm of this.meshes.values()) tm.n = 0;
    let nw = 0;
    if (any) {
      const standing = this.bridges.filter((br) => phaseStatus(br.phase, t).height > 0.001);
      const key = standing.map((b) => b.id).join("|");
      for (const b of this.boats) {
        const f = pres[b.entry];
        let p = f > 0 ? Math.min(1, Math.max(0, (f - b.th * 0.999) / 0.1)) : 0;
        if (p <= 0.01) continue;
        const e = this.entries[b.entry];
        if (b.key !== key) {
          b.key = key;
          const R = this.reaches.get(b.entry);
          if (R) this.layLane(b, e, R, standing);
        }
        if (b.Ls <= 1) continue;
        let x: number, z: number, fx: number, fz: number, spd = 1;
        if (b.cross) {
          const cyc = b.s0 + (timeSec * b.speed) / (2 * b.Ls);
          const u = cyc - Math.floor(cyc);
          const tri = 0.5 - 0.5 * Math.cos(6.2831853 * u);
          x = b.ax + (b.bx - b.ax) * tri; z = b.az + (b.bz - b.az) * tri;
          const sgn = u < 0.5 ? 1 : -1;
          fx = ((b.bx - b.ax) / b.Ls) * sgn; fz = ((b.bz - b.az) / b.Ls) * sgn;
          spd = Math.abs(Math.sin(6.2831853 * u));
        } else {
          const lx = b.lx!, lz = b.lz!, lc = b.lc!;
          const Ls = b.Ls;
          let s = (b.s0 * Ls + b.dir * b.speed * timeSec) % Ls;
          if (s < 0) s += Ls;
          let lo = 1, hi = lc.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (lc[mid] < s) lo = mid + 1;
            else hi = mid;
          }
          const i = lo;
          const f2 = (s - lc[i - 1]) / Math.max(1e-6, lc[i] - lc[i - 1]);
          x = lx[i - 1] + (lx[i] - lx[i - 1]) * f2; z = lz[i - 1] + (lz[i] - lz[i - 1]) * f2;
          const dl = Math.hypot(lx[i] - lx[i - 1], lz[i] - lz[i - 1]) || 1;
          fx = ((lx[i] - lx[i - 1]) / dl) * b.dir; fz = ((lz[i] - lz[i - 1]) / dl) * b.dir;
          p *= Math.min(1, Math.min(s, Ls - s) / 45);
          if (p <= 0.01) continue;
        }
        const tm = this.meshes.get(e.type.id);
        if (!tm || tm.n >= tm.mesh.instanceMatrix.count) continue;
        const yaw = Math.atan2(-fz, fx);
        const bob = Math.sin(timeSec * 1.1 + b.idx * 1.7);
        const roll = e.model.len > 12 ? 0.008 : 0.025;
        this.e.set(bob * roll, yaw, Math.sin(timeSec * 0.8 + b.idx) * roll * 0.8, "YXZ");
        this.q.setFromEuler(this.e);
        this.p.set(x, bob * 0.04, z);
        const sc = p < 1 ? Math.max(0.05, p) : 1;
        this.s.set(sc, sc, sc);
        this.m.compose(this.p, this.q, this.s);
        tm.mesh.setMatrixAt(tm.n, this.m);
        tm.mesh.setColorAt(tm.n, this.col.copy(b.tint));
        tm.n++;
        if (this.wake && this.wakeA && nw < this.wakeA.count) {
          this.p.y = 0.07;
          this.s.set(b.len, 1, b.len);
          this.e.set(0, yaw, 0, "YXZ");
          this.q.setFromEuler(this.e);
          this.m.compose(this.p, this.q, this.s);
          this.wake.setMatrixAt(nw, this.m);
          this.wakeA.setXY(nw, p * spd * (b.len > 12 ? 0.9 : 0.8), 0);
          nw++;
        }
      }
    }
    let total = 0;
    for (const tm of this.meshes.values()) {
      tm.mesh.count = tm.n;
      tm.mesh.visible = tm.n > 0;
      total += tm.n;
      if (tm.n) {
        tm.mesh.instanceMatrix.needsUpdate = true;
        if (tm.mesh.instanceColor) tm.mesh.instanceColor.needsUpdate = true;
      }
    }
    if (this.wake && this.wakeA) {
      this.wake.count = nw;
      this.wake.instanceMatrix.needsUpdate = true;
      this.wakeA.needsUpdate = true;
    }
    this.count = total;
  }

  dispose(): void {
    for (const { mesh } of this.meshes.values()) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    if (this.wake) {
      this.wake.geometry.dispose();
      (this.wake.material as THREE.Material).dispose();
      this.wake.dispose();
    }
  }
}
