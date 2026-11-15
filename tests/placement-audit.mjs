// Placement and consistency audit: is everything in the right place for the year being shown?
//
//   node tests/placement-audit.mjs                 # all sites (london, brentford, barnet)
//   AUDIT_SITES=london node tests/placement-audit.mjs
//   AUDIT_STEP=50 node tests/placement-audit.mjs   # coarser year sweep (default 25 for London, 5 elsewhere)
//   AUDIT_QUERY=placement=legacy node tests/placement-audit.mjs   # extra URL parameters (here: the old placement rules)
//   AUDIT_POP=0 ...                                 # skip the populace and moving-craft checks
//
// Loads each site headless (dev server at LTT_URL, default http://127.0.0.1:4310), stops drawing, and for a sweep of
// years (every AUDIT_STEP years, era presets, event years +-1, the years either side of every terrain, zone, street and
// landmark-phase keyframe) checks the placed scene against the terrain and the data of THAT year. Years whose live set
// is unchanged from the previous checked year are skipped. Categories (see docs/AUDIT.md):
//   a  houses on ground that is wet / foreshore in a year they stand
//   b  houses, landmarks, roads and walls floating above or sunk into the ground of a year they stand
//   c  houses overlapping landmarks, walls, precincts, roads, streets, bridges or each other
//   d  waterfront structures (revetments, quays, bridge abutments, street surfaces) not at the waterline of the year
//   e  river craft on land, in piers, or outside their type's dates (moored and moving)
//   f  people, animals and carts in water, in buildings or in landmarks; smoke with no house; props in buildings / water
//   g  trees in water, streets, buildings, landmarks and walls; floating or sunk trees
//   h  temporal leftovers: landmarks before their date, two phases standing at once, houses outside their zone's years
//   i  labels anchored underground or away from their object
// Writes tests/placement-audit-results.json; exits 1 when a HARD category (a, c-street, c-landmark, e, h) is non-zero.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const SITES = (process.env.AUDIT_SITES ?? "london,brentford,barnet").split(",").filter(Boolean);
const OUT = process.env.AUDIT_OUT ?? path.join(HERE, "placement-audit-results.json");
export const HARD = ["a.wet", "c.street", "c.landmark", "c.road", "c.precinct", "d.deckStep", "e.craftOnLand", "e.craftInStructure", "e.craftOutOfDate", "e.movingOnLand", "e.movingInPier", "h.beforeDate", "h.phaseOverlap", "h.zoneLeftover", "h.buildingOverlap", "h.bridgeCrossing"];

/** Runs inside the page. Self-contained: no closures over Node variables. */
async function auditInPage(opts) {
  const E = window.__ltt, ds = window.__lttData, T = E.terrain;
  const F = E.fabric, LM = E.landmarks;
  const t0wall = performance.now();
  E.pause();
  E.setRenderOverride(() => true);
  LM.buildAll?.(); // copies of phases built lazily (see landmarks.ts): build them all before measuring
  const toT = (y) => (y < 0 ? y + 1 : y);
  const tStart = toT(ds.site.timeline.start), tEnd = toT(ds.site.timeline.end) + 1;
  const ss = (a, b, v) => { if (b <= a) return v >= b ? 1 : 0; const x = Math.min(1, Math.max(0, (v - a) / (b - a))); return x * x * (3 - 2 * x); };
  const lifeS = (l, t) => ss(l[0], l[1], t) * (1 - ss(l[2], l[3], t));
  const proj = (la, lo) => T.proj.toLocal(la, lo);
  const river = T.hasRiver;

  // ------------------------------------------------------------------ geometry helpers
  const obb = (cx, cz, rot, x0, x1, z0, z1, shrink = 0) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    const sx = Math.min(shrink, (x1 - x0) / 2 - 0.05), sz = Math.min(shrink, (z1 - z0) / 2 - 0.05);
    return [[x0 + sx, z0 + sz], [x1 - sx, z0 + sz], [x1 - sx, z1 - sz], [x0 + sx, z1 - sz]].map(([lx, lz]) => [cx + lx * c + lz * s, cz - lx * s + lz * c]);
  };
  const shrinkPoly = (p, d) => {
    const cx = p.reduce((a, q) => a + q[0], 0) / p.length, cz = p.reduce((a, q) => a + q[1], 0) / p.length;
    return p.map(([x, z]) => { const l = Math.hypot(x - cx, z - cz) || 1; const k = Math.max(0.05, (l - d * 1.41) / l); return [cx + (x - cx) * k, cz + (z - cz) * k]; });
  };
  const bboxOf = (p) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, z] of p) { if (x < a) a = x; if (z < b) b = z; if (x > c) c = x; if (z > d) d = z; } return [a, b, c, d]; };
  const satDepth = (a, b) => {
    let best = Infinity;
    for (const q of [a, b])
      for (let i = 0; i < q.length; i++) {
        const [x0, z0] = q[i], [x1, z1] = q[(i + 1) % q.length];
        let ax = -(z1 - z0), az = x1 - x0;
        const l = Math.hypot(ax, az) || 1; ax /= l; az /= l;
        let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
        for (const [x, z] of a) { const v = x * ax + z * az; if (v < amin) amin = v; if (v > amax) amax = v; }
        for (const [x, z] of b) { const v = x * ax + z * az; if (v < bmin) bmin = v; if (v > bmax) bmax = v; }
        const o = Math.min(amax, bmax) - Math.max(amin, bmin);
        if (o <= 0) return 0;
        if (o < best) best = o;
      }
    return best;
  };
  const inConvex = (p, x, z) => {
    let sign = 0;
    for (let i = 0; i < p.length; i++) {
      const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % p.length];
      const c = (x1 - x0) * (z - z0) - (z1 - z0) * (x - x0);
      if (c !== 0) { if (sign === 0) sign = Math.sign(c); else if (Math.sign(c) !== sign) return false; }
    }
    return true;
  };
  const inPoly = (p, x, z) => {
    let ins = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, zi] = p[i], [xj, zj] = p[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
    }
    return ins;
  };
  const segD = (x, z, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const f = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    return Math.hypot(x - ax - f * dx, z - az - f * dz);
  };
  const polyD = (pts, x, z) => { let d = Infinity; for (let i = 1; i < pts.length; i++) d = Math.min(d, segD(x, z, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])); return d; };
  /** Points along the outline (every ~2 m) and the centre of a polygon. */
  const outline = (p, step = 2) => {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % p.length];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
      for (let k = 0; k < n; k++) out.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
    }
    out.push([p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length]);
    return out;
  };
  class Hash {
    constructor(cell) { this.cell = cell; this.m = new Map(); }
    add(bb, v) { const c = this.cell; for (let i = Math.floor(bb[0] / c); i <= Math.floor(bb[2] / c); i++) for (let j = Math.floor(bb[1] / c); j <= Math.floor(bb[3] / c); j++) { const k = i * 100003 + j; let l = this.m.get(k); if (!l) this.m.set(k, (l = [])); l.push(v); } }
    near(x, z) { const c = this.cell; return this.m.get(Math.floor(x / c) * 100003 + Math.floor(z / c)) ?? []; }
    query(bb) { const c = this.cell, out = new Set(); for (let i = Math.floor(bb[0] / c); i <= Math.floor(bb[2] / c); i++) for (let j = Math.floor(bb[1] / c); j <= Math.floor(bb[3] / c); j++) for (const v of this.m.get(i * 100003 + j) ?? []) out.add(v); return out; }
  }
  const sampleCache = new Map();
  const S = (x, z) => { const k = Math.round(x * 4) * 1e7 + Math.round(z * 4); let s = sampleCache.get(k); if (!s) { s = T.staticSample(x, z); if (sampleCache.size < 2e6) sampleCache.set(k, s); } return s; };
  let YP = null;
  const H = (x, z) => T.heightFrom(S(x, z), YP);
  const Hs = (s) => T.heightFrom(s, YP);

  // ------------------------------------------------------------------ results
  const cats = new Map();
  const perYear = [];
  let yearCounts = null;
  const hit = (cat, key, t, x, z, info = "", sev = 1) => {
    yearCounts[cat] = (yearCounts[cat] ?? 0) + 1;
    let c = cats.get(cat);
    if (!c) cats.set(cat, (c = new Map()));
    let o = c.get(key);
    if (!o) c.set(key, (o = { key, first: t, last: t, years: 0, x: +x.toFixed(1), z: +z.toFixed(1), info, sev }));
    o.last = t; o.years++;
    if (sev > o.sev) { o.sev = sev; o.info = info; o.x = +x.toFixed(1); o.z = +z.toFixed(1); o.worstT = t; }
    if (o.worstT == null) o.worstT = t;
  };

  // ------------------------------------------------------------------ houses
  const houses = (F.houses ?? []).map((it, i) => {
    let poly;
    if (it.kind === "S" && it.rect) poly = it.rect.map((p) => [p[0], p[1]]);
    else {
      const b = it.box ?? [-4, 4, -1, 6, -4, 4];
      const k = it.scale, kx = it.scale * (it.sx ?? 1);
      poly = obb(it.x, it.z, it.rot, b[0] * kx, b[1] * kx, b[4] * k, b[5] * k);
    }
    const zg = F.zoneGeoms[it.zone];
    const zone = zg.zone;
    const minY = (it.box ? it.box[2] : -1) * it.scale;
    const samples = [[it.x, it.z], ...poly].map(([x, z]) => S(x, z));
    let tz1 = Infinity;
    if (zone.decline) tz1 = toT(zone.decline[1]) + 1 + (zone.declineBy === "abandonment" ? 25 : 4) + 2;
    return { i, it, poly, tight: shrinkPoly(poly, 0.35), bb: bboxOf(poly), samples, minY, style: zone.style, zoneId: zone.id, tz0: zg.t0 - 0.5, tz1 };
  });

  // ------------------------------------------------------------------ landmarks
  const WS = new Set(["wall", "bridge", "road", "stream", "quay", "waterfront", "boats", "stone-bridge", "bridge-houses", "troops", "zone-marker", "tents", "camp", "hedge", "field-strips", "ford"]);
  const FLAT = new Set(["road", "stream", "ford", "hedge", "zone-marker", "field-strips"]);
  const ONBRIDGE = (k) => k.startsWith("bridge-") || k === "nonsuch" || k === "waterwheel";
  // one record per drawn copy of a phase (a phase whose ground moves is built once per span of years; see landmarks.ts)
  const copies = LM.entries.flatMap((e) => (e.copies ?? [{ group: e.group, trace: e.trace ?? [], tBuild: undefined }]).map((c) => ({ e, c })));
  const entries = copies.map(({ e, c }, ei) => {
    const G = c.group;
    const kind = e.phase.model.kind, mm = e.phase.model;
    // world-space kinds: the known set, and any other kind drawn in world space (its group left at the origin, unturned;
    // sites register their own, e.g. Stonehenge's earthworks), bridge fittings aside (handled below)
    const ws = WS.has(kind) || (!ONBRIDGE(kind) && c.group.position.lengthSq() < 1e-6 && c.group.rotation.y === 0 && !!c.group.children.length);
    const lpath = (e.lm.path ?? []).map(([la, lo]) => proj(la, lo));
    const own = Array.isArray(mm.path) ? mm.path.map(([la, lo]) => proj(la, lo)) : lpath;
    const out = { e, c, G, tBuild: c.tBuild, ei, kind, ws, id: `${e.lm.id}#${e.index}`, lmId: e.lm.id, path: own, tRep: toT(e.phase.built ?? e.phase.from) + 3, poly: null, tight: null, bb: null, box: null };
    if (!ws) {
      const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      G.traverse((o) => {
        if (!o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const g = o.geometry.boundingBox;
        bb.min = [Math.min(bb.min[0], g.min.x), Math.min(bb.min[1], g.min.y), Math.min(bb.min[2], g.min.z)];
        bb.max = [Math.max(bb.max[0], g.max.x), Math.max(bb.max[1], g.max.y), Math.max(bb.max[2], g.max.z)];
      });
      const sb = ds.landmarks.find((l) => l.phases.some((q) => q.model.kind === "stone-bridge") && l.path?.length >= 2);
      if (ONBRIDGE(kind) && sb && G.position.lengthSq() < 1e-6) {
        // bridge fittings are drawn in world space along their bridge: their plan in the bridge's frame
        const bp = sb.path.map(([la, lo]) => proj(la, lo));
        const [a, c] = [bp[0], bp[bp.length - 1]];
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]), ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L;
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        G.traverse((o) => { const pa = o.geometry?.attributes?.position; if (!pa) return; for (let i = 0; i < pa.count; i += 3) { const dx = pa.getX(i) - a[0], dz = pa.getZ(i) - a[1]; const u = dx * ux + dz * uz, v = -dx * uz + dz * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); } });
        const rot = Math.atan2(-uz, ux);
        const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
        const cx = a[0] + cu * ux - cv * uz, cz = a[1] + cu * uz + cv * ux;
        out.poly = obb(cx, cz, rot, -(u1 - u0) / 2, (u1 - u0) / 2, -(v1 - v0) / 2, (v1 - v0) / 2);
        out.tight = obb(cx, cz, rot, -(u1 - u0) / 2, (u1 - u0) / 2, -(v1 - v0) / 2, (v1 - v0) / 2, 0.75);
        out.bb = bboxOf(out.poly);
      } else if (isFinite(bb.min[0])) {
        out.box = bb;
        out.poly = obb(G.position.x, G.position.z, G.rotation.y, bb.min[0], bb.max[0], bb.min[2], bb.max[2]);
        out.tight = obb(G.position.x, G.position.z, G.rotation.y, bb.min[0], bb.max[0], bb.min[2], bb.max[2], 0.75);
        out.bb = bboxOf(out.poly);
        out.posY = G.position.y;
        out.cornerS = [[G.position.x, G.position.z], ...obb(G.position.x, G.position.z, G.rotation.y, bb.min[0], bb.max[0], bb.min[2], bb.max[2], 1)].map(([x, z]) => S(x, z));
      }
    }
    if (kind === "wall") {
      out.half = (typeof mm.thick === "number" ? mm.thick : 2.4) / 2;
      const p = own;
      out.closed = p.length > 3 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 3;
      out.precinct = out.closed && (typeof mm.h === "number" ? mm.h : 6) >= 7;
    }
    if (kind === "road") out.half = (typeof mm.width === "number" ? mm.width : 8) / 2;
    if (kind === "bridge" || kind === "stone-bridge") out.half = (typeof mm.width === "number" ? mm.width : 6) / 2;
    if (kind === "road" || kind === "stream" || kind === "ford") {
      // sample the drawn ribbon's vertices (world space)
      const v = [];
      G.traverse((o) => { const p = o.geometry?.attributes?.position; if (!p) return; const st = Math.max(1, Math.floor(p.count / 400)); for (let i = 0; i < p.count; i += st) v.push([p.getX(i), p.getY(i), p.getZ(i)]); });
      out.verts = v.map(([x, y, z]) => ({ x, y, z, s: S(x, z) }));
    }
    out.structs = [];
    for (const tr of c.trace ?? []) {
      if (tr.kind === "pier" || tr.kind === "abutment") out.structs.push({ tr, poly: obb(tr.x, tr.z, tr.rot, -tr.along / 2, tr.along / 2, -tr.across / 2, tr.across / 2) });
      if (tr.kind === "quay-front") out.structs.push({ tr, poly: obb(tr.x, tr.z, tr.rot, -tr.len / 2, tr.len / 2, -tr.width - 0.2, 0) });
      if (tr.kind === "revetment") out.structs.push({ tr, poly: obb(tr.x, tr.z, tr.rot, -tr.len / 2 - 0.2, tr.len / 2 + 0.2, tr.dir > 0 ? -9.2 : 0.35, tr.dir > 0 ? -0.35 : 9.2) });
    }
    return out;
  });
  const precincts = entries.filter((x) => x.precinct);
  // the bridge path a craft or a house must keep off, per bridge entry
  const streets = (F.streets ?? []);

  // ------------------------------------------------------------------ trees, populace, craft
  const findExtra = (name) => (E.extras ?? []).find((x) => x.object?.name === name)?.object;
  const veg = E.trees?.userData?.items ?? [];
  const trees = veg.map((it, i) => ({ i, it, s: S(it.x, it.z) }));
  const popGroup = findExtra("populace");
  const world = popGroup?.userData?.populace ?? null;
  let boatLayer = null;
  popGroup?.traverse((o) => { if (o.name === "river-craft") boatLayer = o.userData.layer ?? null; });
  const streetGroup = findExtra("streets");
  const surfaces = [];
  streetGroup?.children.forEach((m) => {
    const p = m.geometry?.attributes?.position;
    const c = m.geometry?.attributes?.color;
    if (!p) return;
    const st = Math.max(1, Math.floor(p.count / 3000));
    const v = [];
    for (let i = 0; i < p.count; i += st) if (!c || c.getW(i) > 0.5) v.push({ x: p.getX(i), y: p.getY(i), z: p.getZ(i), s: S(p.getX(i), p.getZ(i)) });
    surfaces.push({ m, v });
  });
  const tiles = [];
  if (world && opts.pop) {
    const TS = 192, b = ds.site.bounds;
    const zb = F.zoneGeoms.map((zg) => zg.bbox);
    for (let tx = Math.floor(b.xMin / TS); tx <= Math.floor(b.xMax / TS); tx++)
      for (let tz = Math.floor(b.zMin / TS); tz <= Math.floor(b.zMax / TS); tz++) {
        const x0 = tx * TS, z0 = tz * TS;
        if (!zb.some((q) => q[0] < x0 + TS + 30 && q[2] > x0 - 30 && q[1] < z0 + TS + 30 && q[3] > z0 - 30)) continue;
        tiles.push(world.genTile(tx, tz));
      }
  }
  const statics = world ? [...world.statics.values()].flat() : [];

  // ------------------------------------------------------------------ years
  const years = new Set();
  const addY = (y) => { if (typeof y !== "number" || !isFinite(y)) return; const t = toT(Math.round(y)) + 0.5; if (t >= tStart && t < tEnd) years.add(t); };
  const step = opts.step;
  for (let y = ds.site.timeline.start; y <= ds.site.timeline.end; y += step) addY(y === 0 ? 1 : y);
  for (const e of ds.eras ?? []) addY(e.presetYear);
  for (const ev of ds.events ?? []) for (const d of [-1, 0, 1]) addY(ev.year + d);
  const kfs = [...(ds.site.river?.northBankSetback ?? []), ...(ds.site.river?.southEmbankment ?? []), ...(ds.site.terrain?.valleys ?? []).flatMap((v) => v.fill ?? [])];
  for (const k of kfs) for (const d of [-1, 1]) addY(k.year + d);
  for (const z of ds.zones) for (const y of [...(z.grow ?? []), ...(z.decline ?? [])]) for (const d of [-1, 1]) addY(y + d);
  for (const lm of ds.landmarks) for (const p of lm.phases) for (const y of [p.from, p.to, p.built]) if (y != null) for (const d of [-1, 1]) addY(y + d);
  const yearList = [...years].sort((a, b) => a - b);

  // ------------------------------------------------------------------ the sweep
  let prevSig = "";
  let checked = 0, skipped = 0;
  const tHist = (t) => { const y = Math.floor(t); return y <= 0 ? y - 1 : y; };
  for (const t of yearList) {
    E.setT(t);
    YP = T.yearParams(t);
    // live sets
    const live = [];
    let sum = 0;
    for (const h of houses) if (lifeS(h.it.life, t) > 0.05) { live.push(h); sum = (sum + h.i * 7919) % 1e9; }
    const vis = entries.filter((x) => x.e.group.visible && x.G.visible);
    const liveTrees = trees.filter((x) => lifeS(x.it.life, t) > 0.05);
    const liveStreets = streets.filter((s) => s.t0 <= t && t < s.t1);
    const sig = [live.length, sum, vis.map((x) => x.ei + ":" + x.e.status.state).join(","), YP.setback.toFixed(1), YP.embank.toFixed(2), YP.valleyFill.map((v) => v.toFixed(2)).join(","), (YP.inlets ?? []).join(""), liveTrees.length, liveStreets.length].join("|");
    if (sig === prevSig) { skipped++; continue; }
    prevSig = sig;
    checked++;
    yearCounts = {};
    const H5 = new Hash(16);
    for (const h of live) H5.add(h.bb, h);
    const visSolid = vis.filter((x) => x.poly && !FLAT.has(x.kind) && x.kind !== "boats");
    const LH = new Hash(40);
    for (const x of visSolid) LH.add(x.bb, x);
    const walls = vis.filter((x) => x.kind === "wall");
    const roads = vis.filter((x) => x.kind === "road");
    const bridges = vis.filter((x) => x.kind === "bridge" || x.kind === "stone-bridge");
    const structs = vis.flatMap((x) => x.structs.map((s) => ({ ...s, x })));
    const SH = new Hash(30);
    for (const s of structs) SH.add(bboxOf(s.poly), s);
    const inHouse = (x, z, shrink = true) => { for (const h of H5.near(x, z)) if (x >= h.bb[0] && x <= h.bb[2] && z >= h.bb[1] && z <= h.bb[3] && inConvex(shrink ? h.tight : h.poly, x, z)) return h; return null; };
    const inLandmark = (x, z, skip) => { for (const l of LH.near(x, z)) if ((!skip || !skip(l)) && x >= l.bb[0] && x <= l.bb[2] && z >= l.bb[1] && z <= l.bb[3] && inConvex(l.tight, x, z)) return l; return null; };
    const inStruct = (x, z, pad = 0) => { for (const s of SH.near(x, z)) if (inConvex(pad ? shrinkPoly(s.poly, -pad) : s.poly, x, z)) return s; return null; };

    // ---- a, b, c, h: houses
    for (const h of live) {
      const it = h.it;
      const hs = h.samples.map(Hs);
      const minH = Math.min(...hs);
      if (river && minH < 0.3) hit("a.wet", `house${h.i}`, t, it.x, it.z, `${h.zoneId} ${it.kind} min ground ${minH.toFixed(2)} m`, 0.3 - minH);
      const maxH = Math.max(...hs);
      if (maxH - it.y > 1.0) hit("b.houseSunk", `house${h.i}`, t, it.x, it.z, `${h.zoneId} ground ${(maxH - it.y).toFixed(2)} m above base`, maxH - it.y);
      if (it.y + h.minY > minH + 0.15) hit("b.houseFloat", `house${h.i}`, t, it.x, it.z, `${h.zoneId} gap ${(it.y + h.minY - minH).toFixed(2)} m under model`, it.y + h.minY - minH);
      if (t < h.tz0 || t > h.tz1) hit("h.zoneLeftover", `house${h.i}`, t, it.x, it.z, `${h.zoneId} alive outside zone years`);
      // landmarks
      for (const l of LH.query(h.bb)) {
        if (ONBRIDGE(l.kind)) continue;
        const d = satDepth(h.tight, l.tight);
        if (d > 0.3) hit("c.landmark", `house${h.i}|${l.lmId}`, t, it.x, it.z, `${h.zoneId} in ${l.id} (${l.kind}) by ${d.toFixed(1)} m`, d);
      }
      const pts = outline(h.tight, 2);
      for (const w of walls) {
        if (w.bb == null) w.bb = bboxOf(w.path);
        if (h.bb[2] < w.bb[0] - 10 || h.bb[0] > w.bb[2] + 10 || h.bb[3] < w.bb[1] - 10 || h.bb[1] > w.bb[3] + 10) continue;
        let dmin = Infinity;
        for (const [x, z] of pts) dmin = Math.min(dmin, polyD(w.path, x, z));
        if (dmin < w.half - 0.2) hit("c.wall", `house${h.i}|${w.lmId}`, t, it.x, it.z, `${h.zoneId} crosses ${w.id}`, w.half - dmin);
      }
      for (const p of precincts) if (p.e.group.visible && p.G.visible && inPoly(p.path, it.x, it.z)) hit("c.precinct", `house${h.i}|${p.lmId}`, t, it.x, it.z, `${h.zoneId} inside ${p.id}`);
      for (const r of roads) {
        if (r.bb == null) r.bb = bboxOf(r.path);
        if (h.bb[2] < r.bb[0] - 20 || h.bb[0] > r.bb[2] + 20 || h.bb[3] < r.bb[1] - 20 || h.bb[1] > r.bb[3] + 20) continue;
        let dmin = Infinity;
        for (const [x, z] of pts) dmin = Math.min(dmin, polyD(r.path, x, z));
        if (dmin < r.half - 0.6) hit("c.road", `house${h.i}|${r.lmId}`, t, it.x, it.z, `${h.zoneId} on ${r.id} by ${(r.half - dmin).toFixed(1)} m`, r.half - dmin);
      }
      for (const s of liveStreets) {
        let dmin = Infinity;
        for (const [x, z] of pts) dmin = Math.min(dmin, polyD(s.pts, x, z));
        if (dmin < s.width / 2 - 0.45) hit("c.street", `house${h.i}|${s.id}`, t, it.x, it.z, `${h.zoneId} ${it.kind} in street ${s.id} by ${(s.width / 2 - dmin).toFixed(1)} m`, s.width / 2 - dmin);
      }
      for (const br of bridges) {
        const [a, c] = [br.path[0], br.path[br.path.length - 1]];
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]), dx = (c[0] - a[0]) / L, dz = (c[1] - a[1]) / L;
        const ext = [[a[0] - dx * 15, a[1] - dz * 15], [c[0] + dx * 15, c[1] + dz * 15]];
        let dmin = Infinity;
        for (const [x, z] of pts) dmin = Math.min(dmin, segD(x, z, ext[0][0], ext[0][1], ext[1][0], ext[1][1]));
        if (dmin < br.half + 0.3) hit("c.bridge", `house${h.i}|${br.lmId}`, t, it.x, it.z, `${h.zoneId} on ${br.id} or its approach`, br.half + 0.3 - dmin);
      }
      // waterfront structures: a wharf, quay deck, pier or abutment under a house
      for (const s of SH.query(h.bb)) {
        const d = satDepth(h.tight, s.poly);
        if (d > 0.5) { hit("c.waterfront", `house${h.i}|${s.x.lmId}`, t, it.x, it.z, `${h.zoneId} on a ${s.tr.kind} of ${s.x.id} by ${d.toFixed(1)} m`, d); break; }
      }
      // other houses (each pair once)
      for (const o of H5.query(h.bb)) {
        if (o.i <= h.i || (h.it.uid != null && o.it.uid === h.it.uid)) continue;
        if (o.bb[0] > h.bb[2] || o.bb[2] < h.bb[0] || o.bb[1] > h.bb[3] || o.bb[3] < h.bb[1]) continue;
        const d = satDepth(h.tight, o.tight);
        if (d > 0.6) hit("c.house", `house${h.i}|house${o.i}`, t, it.x, it.z, `${h.zoneId} ${it.kind} / ${o.zoneId} ${o.it.kind} overlap ${d.toFixed(1)} m`, d);
      }
    }

    // ---- b, d, h, i: landmarks
    for (const x of vis) {
      const e = x.e, st = e.status;
      if (t < toT(e.phase.from) - 0.01) hit("h.beforeDate", x.id, t, x.G.position.x, x.G.position.z, `${x.kind} visible before ${e.phase.from}`);
      if (x.cornerS && st.height > 0.5 && !ONBRIDGE(x.kind)) {
        const hs = x.cornerS.map(Hs);
        const minH = Math.min(...hs), cH = hs[0];
        // (a dock's hard is set level with the ground about it on purpose: its base is meant to be below)
        if (cH - x.posY > 1.2 && x.kind !== "dock") hit("b.landmarkSunk", x.id, t, x.G.position.x, x.G.position.z, `${x.kind} ground ${(cH - x.posY).toFixed(2)} m above its base`, cH - x.posY);
        if (x.posY + x.box.min[1] > minH + 0.2) hit("b.landmarkFloat", x.id, t, x.G.position.x, x.G.position.z, `${x.kind} gap ${(x.posY + x.box.min[1] - minH).toFixed(2)} m under model`, x.posY + x.box.min[1] - minH);
      }
      if (x.verts && st.height > 0.5) {
        let buried = 0, floating = 0, bx = 0, bz = 0, worst = 0;
        for (const v of x.verts) {
          const g = Hs(v.s);
          if (g > v.y + 0.05) { buried++; if (g - v.y > worst) { worst = g - v.y; bx = v.x; bz = v.z; } }
          else if (v.y - g > 0.6 && (!river || g > -0.2)) floating++;
        }
        if (buried > x.verts.length * 0.02) hit("b.flatBuried", x.id, t, bx, bz, `${x.kind}: ${buried}/${x.verts.length} vertices under the ground (worst ${worst.toFixed(2)} m)`, buried / x.verts.length);
        if (floating > x.verts.length * 0.05) hit("b.flatFloat", x.id, t, x.verts[0].x, x.verts[0].z, `${x.kind}: ${floating}/${x.verts.length} vertices >0.6 m above the ground`, floating / x.verts.length);
        if (river && x.kind === "road") {
          let wet = 0, wx = 0, wz = 0;
          for (const v of x.verts) if (Hs(v.s) < -0.1) { wet++; wx = v.x; wz = v.z; }
          if (wet > 2) hit("d.roadInRiver", x.id, t, wx, wz, `road: ${wet} vertices over water`, wet);
        }
      }
      if (x.kind === "wall" && st.height > 0.5) {
        // walls are cut at the ground of their representative year: compare with this year's ground
        const ypR = T.yearParams(x.tBuild ?? x.tRep);
        let worst = 0, wx = 0, wz = 0;
        for (let i = 1; i < x.path.length; i++) {
          const [ax, az] = x.path[i - 1], [bx, bz] = x.path[i];
          const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 10));
          for (let k = 0; k <= n; k++) {
            const px = ax + ((bx - ax) * k) / n, pz = az + ((bz - az) * k) / n;
            const s = S(px, pz);
            const d = Math.abs(Math.max(0.5, T.heightFrom(s, YP)) - Math.max(0.5, T.heightFrom(s, ypR)));
            if (d > worst) { worst = d; wx = px; wz = pz; }
          }
        }
        if (worst > 2.4) hit("b.wallGround", x.id, t, wx, wz, `wall base set at its ${Math.round(x.tBuild ?? x.tRep)} ground: ${worst.toFixed(1)} m off`, worst);
      }
      if (river) for (const s of x.structs) {
        const tr = s.tr;
        if (tr.kind === "revetment" || tr.kind === "quay-front") {
          // n: unit normal pointing to the river
          let nx, nz;
          const q = tr.kind === "revetment" ? tr.dir : 1;
          nx = Math.sin(tr.rot) * q; nz = Math.cos(tr.rot) * q;
          const back = tr.kind === "revetment" ? 12 : tr.width + 4;
          const front = H(tr.x + nx * 4, tr.z + nz * 4);
          const behind = H(tr.x - nx * back, tr.z - nz * back);
          if (front > 0.8) hit("d.stranded", `${x.id}|${tr.kind}`, t, tr.x, tr.z, `${tr.kind} with dry ground (${front.toFixed(2)} m) 4 m riverward`, front);
          if (behind < 0) hit("d.inRiver", `${x.id}|${tr.kind}`, t, tr.x, tr.z, `${tr.kind} with water (${behind.toFixed(2)} m) ${back} m behind it`, -behind);
          // facing: the drop towards the river should be along n
          const gx = H(tr.x + 6, tr.z) - H(tr.x - 6, tr.z), gz = H(tr.x, tr.z + 6) - H(tr.x, tr.z - 6);
          const gl = Math.hypot(gx, gz);
          // (a dock's lining faces the dock, across the slope down to the river: d.stranded / d.inRiver test it)
          if (gl > 0.25 && !(tr.part === "side" || tr.part === "head") && (-gx * nx - gz * nz) / gl < 0.3) hit("d.facing", `${x.id}|${tr.kind}`, t, tr.x, tr.z, `${tr.kind} faces away from the slope to the water`, 1);
        }
        if (tr.kind === "approach") {
          const g = H(tr.x, tr.z);
          if (g < 0.4) hit("d.abutmentInWater", `${x.id}|approach${tr.end}`, t, tr.x, tr.z, `bridge approach ${tr.end} ends at ${g.toFixed(2)} m`, 0.4 - g);
        }
        if (tr.kind === "abutment" && !vis.some((q) => q.lmId === x.lmId && (q.c.trace ?? []).some((r) => r.kind === "approach" && r.end === tr.end))) {
          const sgn = tr.end === 0 ? -1 : 1;
          const ux = Math.cos(tr.rot), uz = -Math.sin(tr.rot);
          const lx = tr.x + ux * sgn * (tr.along / 2 + 2), lz = tr.z + uz * sgn * (tr.along / 2 + 2);
          const g = H(lx, lz);
          if (g < 0.4) hit("d.abutmentInWater", `${x.id}|end${tr.end}`, t, lx, lz, `bridge end ${tr.end} meets ground at ${g.toFixed(2)} m`, 0.4 - g);
        }
        if (tr.kind === "opening") {
          const g = H(tr.x, tr.z);
          if (g > 0.6) hit("d.openingDry", `${x.id}|${tr.x.toFixed(0)}`, t, tr.x, tr.z, `bridge opening over dry ground (${g.toFixed(2)} m)`, g);
        }
      }
      if (river && (x.kind === "bridge") && x.path.length >= 2) {
        for (const [px, pz] of [x.path[0], x.path[x.path.length - 1]]) {
          const g = H(px, pz);
          if (g < 0.2) hit("d.abutmentInWater", `${x.id}|${px.toFixed(0)}`, t, px, pz, `timber bridge end at ${g.toFixed(2)} m`, 0.2 - g);
        }
      }
      // ---- e: craft drawn at rest
      if (x.kind === "boats" && river) {
        (x.c.trace ?? []).forEach((c, ci) => {
          if (c.kind !== "craft") return;
          const ux = Math.cos(c.rot), uz = -Math.sin(c.rot);
          const pts = [[c.x, c.z], [c.x + ux * c.len * 0.42, c.z + uz * c.len * 0.42], [c.x - ux * c.len * 0.42, c.z - uz * c.len * 0.42]];
          const g = pts.map(([px, pz]) => H(px, pz));
          const key = `${x.id}|craft${ci}`;
          if (c.state === "beached") {
            if (g[0] > 1.3) hit("e.craftOnLand", key, t, c.x, c.z, `beached ${c.type} ${g[0].toFixed(2)} m up the bank`, g[0]);
            else if (g[0] < -1.2) hit("e.craftOnLand", key, t, c.x, c.z, `beached ${c.type} afloat in ${(-g[0]).toFixed(2)} m of water`, -g[0]);
          } else if (g[0] > -0.15 || Math.max(g[1], g[2]) > 0.35) hit("e.craftOnLand", key, t, c.x, c.z, `${c.state} ${c.type} (${c.zone}) on ground ${Math.max(...g).toFixed(2)} m`, Math.max(...g) + 0.2);
          for (const [px, pz] of pts) { const s = inStruct(px, pz, c.beam / 2); if (s && s.x !== x) { hit("e.craftInStructure", key, t, c.x, c.z, `${c.type} inside ${s.tr.kind} of ${s.x.id}`); break; } }
          if (t < toT(c.from) || t >= toT(c.to) + 1) hit("e.craftOutOfDate", key, t, c.x, c.z, `${c.type} (${c.from}-${c.to})`);
        });
      }
    }
    // two phases of one landmark standing at once
    const byLm = new Map();
    for (const x of vis) if (x.e.status.height > 0.3) { const l = byLm.get(x.lmId) ?? []; l.push(x); byLm.set(x.lmId, l); }
    for (const [id, l] of byLm) if (new Set(l.map((x) => x.e.index)).size > 1) {
      const ph = l.map((x) => x.e.phase);
      const ext = l.some((x) => x.e.phase.continues);
      if (!ext) hit("h.phaseOverlap", id, t, l[0].G.position.x, l[0].G.position.z, `phases ${[...new Set(l.map((x) => x.e.index))].join("+")} standing together (${ph.map((p) => `${p.from}-${p.to ?? ""}`).join(", ")})`);
    }
    // different landmarks on the same ground. One built round another (the second forum round the first: every corner
    // of the smaller inside the larger) is reported softly (h.landmarkOverlap); two buildings running into each other
    // (Westminster Abbey's nave into Henry VII's Chapel) are hard (h.buildingOverlap)
    for (let i = 0; i < visSolid.length; i++)
      for (let j = i + 1; j < visSolid.length; j++) {
        const a = visSolid[i], b = visSolid[j];
        if (a.lmId === b.lmId || ONBRIDGE(a.kind) || ONBRIDGE(b.kind)) continue;
        if (a.bb[0] > b.bb[2] || a.bb[2] < b.bb[0] || a.bb[1] > b.bb[3] || a.bb[3] < b.bb[1]) continue;
        const d = satDepth(a.tight, b.tight);
        if (d <= 4) continue;
        const round = a.poly.every(([px, pz]) => inConvex(b.poly, px, pz)) || b.poly.every(([px, pz]) => inConvex(a.poly, px, pz));
        hit(round ? "h.landmarkOverlap" : "h.buildingOverlap", `${a.lmId}|${b.lmId}`, t, a.G.position.x, a.G.position.z, `${a.id} (${a.kind}) and ${b.id} (${b.kind}) overlap ${d.toFixed(1)} m${round ? " (one built round the other)" : ""}`, d);
      }
    // two bridges standing at once on one line, or one through the other's piers and starlings (hard)
    const pierPolys = (x) => vis.filter((q) => q.lmId === x.lmId).flatMap((q) => q.structs.filter((s) => s.tr.kind === "pier" || s.tr.kind === "abutment").map((s) => s.poly));
    for (let i = 0; i < bridges.length; i++)
      for (let j = i + 1; j < bridges.length; j++) {
        const a = bridges[i], b = bridges[j];
        if (a.lmId === b.lmId) continue;
        const dm = Math.min(...b.path.map(([px, pz]) => polyD(a.path, px, pz)), ...a.path.map(([px, pz]) => polyD(b.path, px, pz)));
        let why = dm < a.half + b.half ? `two bridges on one line: ${a.id} and ${b.id} (${dm.toFixed(1)} m apart)` : "";
        if (!why)
          for (const [p, q] of [[a, b], [b, a]]) {
            const piers = pierPolys(q);
            if (!piers.length) continue;
            const [s0, s1] = [p.path[0], p.path[p.path.length - 1]];
            const n = Math.ceil(Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) / 2);
            for (let k = 0; k <= n && !why; k++) {
              const px = s0[0] + ((s1[0] - s0[0]) * k) / n, pz = s0[1] + ((s1[1] - s0[1]) * k) / n;
              for (const poly of piers) if (inConvex(shrinkPoly(poly, -(p.half + 0.5)), px, pz)) { why = `${p.id} runs through a pier or starling of ${q.id}`; break; }
            }
            if (why) break;
          }
        if (why) hit("h.bridgeCrossing", `${a.lmId}|${b.lmId}`, t, a.path[0][0], a.path[0][1], why, 5);
      }
    // an extension phase of a church that grows at both ends while the old church stands (soft: where the direction is
    // documented the phase pins one end, eastEnd / westEnd; where it is not, it is reported here)
    for (const [id, l] of byLm) {
      const byIdx = new Map(entries.filter((q) => q.lmId === id && q.box && (q.kind === "church" || q.kind === "friary")).map((q) => [q.e.index, q]));
      for (const [k, q] of byIdx) {
        const pr = byIdx.get(k - 1);
        if (!pr || !q.e.phase.continues || !l.includes(q)) continue;
        const dW = Math.abs(q.box.min[0] - pr.box.min[0]), dE = Math.abs(q.box.max[0] - pr.box.max[0]);
        if (dW > 2 && dE > 2) hit("h.extensionBothEnds", `${id}#${k}`, t, q.G.position.x, q.G.position.z, `${q.id} grows ${dW.toFixed(0)} m at one end and ${dE.toFixed(0)} m at the other from ${pr.id}`, Math.min(dW, dE));
      }
    }
    // the stone bridge's roadway meets the street at both ends (via its approaches and ramps) in every year it stands
    if (river) for (const x of vis) {
      if (x.kind !== "stone-bridge" || x.e.status.height < 0.95 || !(x.c.trace ?? []).some((r) => r.kind === "abutment")) continue;
      const deck = typeof x.e.phase.model.deck === "number" ? x.e.phase.model.deck : 8;
      const ramps = vis.filter((q) => q.lmId === x.lmId).flatMap((q) => (q.c.trace ?? []).filter((r) => r.kind === "ramp"));
      for (const tr of x.c.trace ?? []) {
        if (tr.kind !== "abutment") continue;
        const r = ramps.find((q) => q.end === tr.end);
        let gx, gz, top;
        if (r) { gx = r.x; gz = r.z; top = r.y; }
        else {
          const sgn = tr.end === 0 ? -1 : 1, ux = Math.cos(tr.rot), uz = -Math.sin(tr.rot);
          gx = tr.x + ux * sgn * (tr.along / 2); gz = tr.z + uz * sgn * (tr.along / 2); top = deck + 0.25;
        }
        const g = H(gx, gz);
        if (Math.abs(top - g) > 0.6) hit("d.deckStep", `${x.lmId}|end${tr.end}`, t, gx, gz, `roadway ${r ? "ramp" : "deck"} at end ${tr.end} is ${(top - g).toFixed(2)} m ${top > g ? "above" : "below"} the street`, Math.abs(top - g));
      }
    }
    // ---- i: labels
    for (const a of LM.active()) {
      if (["road", "stream", "boats", "waterfront", "hedge", "field-strips"].includes(a.phase.model.kind) || a.status.height <= 0.05) continue;
      const g = T.floor(H(a.anchor.x, a.anchor.z));
      if (a.anchor.y < g + 0.5) hit("i.labelUnderground", `${a.lm.id}#${a.phaseIndex}`, t, a.anchor.x, a.anchor.z, `label ${(g - a.anchor.y).toFixed(1)} m under the surface`);
      const x = entries.find((q) => q.lmId === a.lm.id && q.e.index === a.phaseIndex && q.e.group.visible && q.G.visible);
      if (!x) { hit("i.labelInvisible", `${a.lm.id}#${a.phaseIndex}`, t, a.anchor.x, a.anchor.z, "label for a hidden phase"); continue; }
      if (x.ws && x.path.length >= 2) {
        const d = polyD(x.path, a.anchor.x, a.anchor.z);
        if (d > 25) hit("i.labelOffObject", x.id, t, a.anchor.x, a.anchor.z, `${x.kind} label ${d.toFixed(0)} m from its object`, d);
      }
    }
    // ---- d: street surfaces
    if (river) for (const sf of surfaces) {
      const u = sf.m.userData;
      if (u.t0 != null ? !(u.t0 <= t && t < u.t1) : !sf.m.visible) continue;
      let wet = 0, buried = 0, wx = 0, wz = 0;
      for (const v of sf.v) { const g = Hs(v.s); if (g < 0.1) { wet++; wx = v.x; wz = v.z; } else if (g > v.y + 0.04) buried++; }
      if (wet > 0) hit("d.streetSurfaceWet", sf.m.name + "|" + sf.m.id, t, wx, wz, `${sf.m.name}: ${wet} vertices over water / foreshore`, wet);
      if (buried > sf.v.length * 0.03) hit("b.streetSurfaceBuried", sf.m.name + "|" + sf.m.id, t, sf.v[0].x, sf.v[0].z, `${sf.m.name}: ${buried}/${sf.v.length} vertices under the ground`, buried / sf.v.length);
    }
    if (river) for (const s of liveStreets) {
      let wet = 0, wx = 0, wz = 0;
      for (let i = 1; i < s.pts.length; i++) {
        const [ax, az] = s.pts[i - 1], [bx, bz] = s.pts[i];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4));
        for (let k = 0; k <= n; k++) { const px = ax + ((bx - ax) * k) / n, pz = az + ((bz - az) * k) / n; if (H(px, pz) < 0.3) { wet++; wx = px; wz = pz; } }
      }
      if (wet > 0) hit("d.streetIntoRiver", s.id, t, wx, wz, `${s.id}: ${wet} points (every 4 m) on wet ground`, wet);
    }

    // ---- e: moving craft
    if (boatLayer && river && opts.pop) {
      const typeModel = new Map(boatLayer.entries.map((e) => [e.type.id, e.model]));
      const piers = structs.filter((s) => s.tr.kind === "pier" || s.tr.kind === "abutment");
      for (const ts of [3, 47, 101, 173, 263, 389]) {
        boatLayer.update(t, ts);
        for (const [id, tm] of boatLayer.meshes) {
          const m = typeModel.get(id);
          if (!m) continue;
          const a = tm.mesh.instanceMatrix.array;
          for (let i = 0; i < tm.mesh.count; i++) {
            const o = i * 16;
            const sx = Math.hypot(a[o], a[o + 1], a[o + 2]) || 1;
            if (sx < 0.5) continue; // appearing / leaving
            const fx = a[o] / sx, fz = a[o + 2] / sx;
            const x = a[o + 12], z = a[o + 14];
            const g = [H(x, z), H(x + fx * m.len * 0.42, z + fz * m.len * 0.42), H(x - fx * m.len * 0.42, z - fz * m.len * 0.42)];
            const key = `moving:${id}:${Math.round(x / 40)}:${Math.round(z / 40)}`;
            const ty = boatLayer.entries.find((q) => q.type.id === id)?.type;
            if (ty && (t < toT(ty.from) || t >= toT(ty.to) + 1)) hit("e.craftOutOfDate", `moving:${id}`, t, x, z, `${id} under way outside its dates (${ty.from}-${ty.to})`);
            if (g[0] > -0.15 || Math.max(g[1], g[2]) > 0.3) hit("e.movingOnLand", key, t, x, z, `${id} under way on ground ${Math.max(...g).toFixed(2)} m`, Math.max(...g) + 0.2);
            for (const s of piers) {
              const bb = bboxOf(s.poly);
              if (x < bb[0] - m.len || x > bb[2] + m.len || z < bb[1] - m.len || z > bb[3] + m.len) continue;
              const hull = obb(x, z, Math.atan2(-fz, fx), -m.len / 2, m.len / 2, -m.beam / 2, m.beam / 2);
              if (satDepth(hull, s.poly) > 0.2) { hit("e.movingInPier", key, t, x, z, `${id} through a ${s.tr.kind} of ${s.x.id}`); break; }
            }
          }
        }
      }
    }

    // ---- f: populace (pieces of the walking world), smoke, props
    if (world && opts.pop) {
      world.prepare(t);
      const phIds = world.phases;
      const piecePts = (P) => {
        if (P.idle || P.L < 1) return [[P.x0, P.z0, P.hs[0]]];
        const out = [];
        const n = Math.max(1, Math.ceil(P.L / 5));
        for (let k = 0; k <= n; k++) {
          const f = k / n, q = f * 3;
          const y = q < 1 ? P.hs[0] + (P.hs[1] - P.hs[0]) * q : q < 2 ? P.hs[1] + (P.hs[2] - P.hs[1]) * (q - 1) : P.hs[2] + (P.hs[3] - P.hs[2]) * Math.min(1, q - 2);
          for (const lat of P.lat > 0.5 ? [-P.lat * 0.9, 0, P.lat * 0.9] : [0]) out.push([P.x0 + P.dx * P.L * f + P.dz * lat, P.z0 + P.dz * P.L * f - P.dx * lat, y]);
        }
        return out;
      };
      const checkPiece = (P) => {
        const p = world.presence(P, t);
        if (p <= 0.05) return;
        if (P.s) {
          if (P.s.length === 1) P.hs.fill(Hs(P.s[0])); else for (let i = 0; i < 4; i++) P.hs[i] = Hs(P.s[i]);
          if (river && Math.min(P.hs[0], P.hs[1], P.hs[2], P.hs[3]) < 0.45) return; // the runtime skips it
        }
        const own = P.ph >= 0 ? phIds[P.ph]?.id : null;
        const what = P.kind || (P.idle ? (P.seat ? "seated" : P.ns === 0 ? "animals" : "door figure") : "street");
        let inB = 0, inL = null, wet = 0, ex = 0, ez = 0;
        for (const [x, z] of piecePts(P)) {
          if (inHouse(x, z)) { inB++; ex = x; ez = z; }
          const l = inLandmark(x, z, (q) => q.lmId === own || (P.kind === "bridge" && (ONBRIDGE(q.kind) || q.kind === "stone-bridge")));
          if (l) { inL = l; ex = x; ez = z; }
          if (river && (P.kind === "quay" || P.kind === "waterfront" || P.kind === "bridge")) {
            if (P.kind !== "bridge" && H(x, z) < 0.3 && !inStruct(x, z, 0.5)) { wet++; ex = x; ez = z; }
          }
        }
        if (inB) hit("f.walkerInBuilding", `piece${P.id}`, t, ex, ez, `${what} piece: ${inB} points inside houses`, inB);
        if (inL) hit("f.walkerInLandmark", `piece${P.id}|${inL.lmId}`, t, ex, ez, `${what} piece inside ${inL.id} (${inL.kind})`);
        if (wet) hit("f.walkerInWater", `piece${P.id}`, t, ex, ez, `${what} piece: ${wet} points over water with no structure`, wet);
      };
      for (const tile of tiles) for (const P of tile.pieces) checkPiece(P);
      for (const P of statics) checkPiece(P);
      const CH = new Hash(8);
      for (const h of live) CH.add([h.it.x - 1.5, h.it.z - 1.5, h.it.x + 1.5, h.it.z + 1.5], h);
      for (const tile of tiles)
        for (const Hh of tile.houses) {
          const l = Hh.life;
          const p = ss(l[1] - 1, l[1] + 1, t) * (1 - ss(l[2] - 0.5, l[2] + 0.3, t));
          if (p < 0.05) continue;
          let ok = false;
          for (const h of CH.near(Hh.x, Hh.z)) if (Math.hypot(h.it.x - Hh.x, h.it.z - Hh.z) < 1.5) { ok = true; break; }
          if (!ok) ok = !!inHouse(Hh.x, Hh.z, false);
          if (!ok) hit("f.smokeNoHouse", `smoke${Math.round(Hh.x)}:${Math.round(Hh.z)}`, t, Hh.x, Hh.z, "smoke column with no house under it");
        }
      // props near a few centres: the district bridgeheads and a city / suburb spot
      const sites = [];
      const centres = [[0, 0], [-120, 60], [-60, 300], [-700, -200], [-1800, -200], [400, -250]];
      for (const [cx, cz] of centres) for (let k = 0; k < 40 && world.sitesNear(t, cx, cz, 160, sites); k++) sites.length = 0;
      sites.length = 0;
      for (const [cx, cz] of centres) world.sitesNear(t, cx, cz, 160, sites);
      for (const s of sites) {
        const key = `prop${Math.round(s.x * 2)}:${Math.round(s.z * 2)}`;
        if (inHouse(s.x, s.z)) hit("f.propInBuilding", key, t, s.x, s.z, `${s.kind} prop inside a house`);
        const l = inLandmark(s.x, s.z, (q) => s.kind === "bridge" && (ONBRIDGE(q.kind) || q.kind === "stone-bridge") || (s.kind === "forum" && q.kind === "forum"));
        if (l) hit("f.propInLandmark", key, t, s.x, s.z, `${s.kind} prop inside ${l.id}`);
        if (river && s.kind !== "bridge" && H(s.x, s.z) < 0.3 && !inStruct(s.x, s.z, 0.5)) hit("f.propInWater", key, t, s.x, s.z, `${s.kind} prop over water`);
      }
    }

    // ---- g: trees
    for (const tr of liveTrees) {
      const it = tr.it;
      const g = Hs(tr.s);
      const key = `tree${tr.i}`;
      if (river && g < 0.05) hit("g.treeInWater", key, t, it.x, it.z, `${it.sp} in ${(-g).toFixed(2)} m of water`, 0.05 - g);
      if (Math.abs(g - it.y) > 1.0) hit(g > it.y ? "g.treeSunk" : "g.treeFloat", key, t, it.x, it.z, `${it.sp} base ${(it.y - g).toFixed(2)} m from the ground`, Math.abs(g - it.y));
      if (inHouse(it.x, it.z)) hit("g.treeInBuilding", key, t, it.x, it.z, `${it.sp} inside a house`);
      const l = inLandmark(it.x, it.z);
      if (l) hit("g.treeInLandmark", `${key}|${l.lmId}`, t, it.x, it.z, `${it.sp} inside ${l.id} (${l.kind})`);
      for (const w of walls) if (polyD(w.path, it.x, it.z) < w.half + 0.4) { hit("g.treeInWall", `${key}|${w.lmId}`, t, it.x, it.z, `${it.sp} in ${w.id}`); break; }
      for (const r of roads) if (polyD(r.path, it.x, it.z) < r.half - 0.3) { hit("g.treeInStreet", `${key}|${r.lmId}`, t, it.x, it.z, `${it.sp} on ${r.id}`); break; }
      for (const s of liveStreets) if (polyD(s.pts, it.x, it.z) < s.width / 2) { hit("g.treeInStreet", `${key}|${s.id}`, t, it.x, it.z, `${it.sp} in street ${s.id}`); break; }
    }
    perYear.push({ t, year: tHist(t), live: live.length, landmarks: vis.length, trees: liveTrees.length, counts: yearCounts });
  }
  E.setRenderOverride(null);
  const categories = {};
  for (const [cat, m] of cats) {
    const list = [...m.values()].sort((a, b) => b.sev - a.sev);
    categories[cat] = { distinct: list.length, objectYears: list.reduce((a, o) => a + o.years, 0), worst: list.slice(0, 40) };
  }
  return { site: ds.site.id, houses: houses.length, entries: entries.length, trees: trees.length, tiles: tiles.length, years: yearList.length, checked, skipped, ms: Math.round(performance.now() - t0wall), categories, perYear };
}

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const results = { when: new Date().toISOString(), base: BASE, hard: HARD, sites: {} };
let hardTotal = 0;
for (const site of SITES) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  page.on("pageerror", (e) => console.error(`[${site}] PAGE ERROR`, e.message));
  const step = Number(process.env.AUDIT_STEP ?? (site === "london" ? 25 : 5));
  const t0 = Date.now();
  let r;
  try {
    await page.goto(`${BASE}/?site=${site}&quality=high&ui=0&labels=0${process.env.AUDIT_QUERY ? "&" + process.env.AUDIT_QUERY : ""}`, { timeout: 120000 });
    await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 180000 });
    var loadMs = Date.now() - t0;
    await page.waitForTimeout(1500);
    r = await page.evaluate(auditInPage, { step, pop: process.env.AUDIT_POP !== "0" });
  } catch (e) {
    console.error(`[${site}] audit failed: ${e.message.split("\n")[0]}`);
    results.sites[site] = { error: e.message.split("\n")[0] };
    hardTotal += 1;
    await page.close();
    continue;
  }
  await page.close();
  r.loadMs = loadMs;
  results.sites[site] = r;
  console.log(`\n== ${site} (loaded in ${(loadMs / 1000).toFixed(1)} s): ${r.houses} houses, ${r.entries} landmark copies, ${r.trees} trees, ${r.tiles} populace tiles; ${r.checked} years checked (${r.skipped} unchanged skipped) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const rows = Object.entries(r.categories).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [cat, c] of rows) {
    const hard = HARD.includes(cat);
    if (hard) hardTotal += c.distinct;
    const w = c.worst[0];
    console.log(`  ${hard ? "HARD" : "soft"} ${cat.padEnd(24)} ${String(c.distinct).padStart(6)} objects ${String(c.objectYears).padStart(7)} object-years   e.g. ${w ? `${w.info} @(${w.x}, ${w.z}) ${w.worstT ?? w.first}` : ""}`);
  }
  if (!rows.length) console.log("  no defects found");
}
await browser.close();
results.hardTotal = hardTotal;
fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
console.log(`\nwrote ${path.relative(process.cwd(), OUT)}; hard defects: ${hardTotal}`);
process.exit(hardTotal > 0 ? 1 : 0);
