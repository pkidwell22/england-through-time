/**
 * Reduce the raw Poly Haven glTF scans (public/assets/models/_src/<id>/) to compact browser LODs.
 *
 *   node scripts/optimize-models.mjs                 # all assets in data/models.json
 *   node scripts/optimize-models.mjs fern_02 rock_07 # some
 *   then: node scripts/bake-models.mjs [ids]         # renders leaf-cluster atlases + impostors (needs the dev server)
 *
 * Output per asset, public/assets/models/<id>/:
 *   model.json   variants -> lods -> parts (geometry ranges in geo.bin + material description)
 *   geo.bin      float32 positions, int8 normalised normals, float32 uvs, uint16/uint32 indices
 *   *.webp       textures at the category resolution (1024 or 512)
 * and public/assets/models/index.json (catalogue, triangle counts, sizes).
 *
 * Methods
 *   solid parts (bark, props, rocks): meshoptimizer edge-collapse simplification to the budget, area-weighted
 *     split between materials; tiny parts are dropped at the coarse LODs.
 *   tree foliage (geometric leaves/needles, often 0.3-2M triangles): replaced by leaf-cluster cards. Leaf
 *     triangles are binned into a grid sized so the occupied cells match the card count; one alpha-tested
 *     quad per cell, sized to the cell, facing out of the canopy. The card texture (4 cluster variants in
 *     a 2x2 atlas) is rendered from the real leaves by bake-models.mjs; inputs go to _bake/<id>/.
 *   plants: leaves simplified as geometry to <= 800 triangles, falling back to dropping whole leaves and
 *     scaling the survivors up to keep coverage.
 *   impostor (trees LOD2, plants LOD1): two crossed quads (4 triangles); colour + normal atlas baked later.
 *
 * Only reads files under public/assets/models/_src (fetched by scripts/fetch-models.py) and writes under
 * public/assets/models/. Uses meshoptimizer (installed with @types/three) and sharp (installed with next).
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { MeshoptSimplifier } from "meshoptimizer";

const OUT = "public/assets/models";
const SRC = `${OUT}/_src`;
const BAKE = `${OUT}/_bake`;
const manifest = JSON.parse(fs.readFileSync("data/models.json", "utf8"));
const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith("--")));

await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true;

// ---------------------------------------------------------------- small maths
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashStr = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
function compose(t, q, s) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function normalMatrix(m) {
  const [a, b, c, , d, e, f, , g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  // inverse-transpose of the upper 3x3, column-major
  return [A / det, B / det, C / det, -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det, (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det];
}
const len3 = (x, y, z) => Math.hypot(x, y, z) || 1;

// ---------------------------------------------------------------- glTF reading
const COMP = { 5120: [Int8Array, 1, 127], 5121: [Uint8Array, 1, 255], 5122: [Int16Array, 2, 32767], 5123: [Uint16Array, 2, 65535], 5125: [Uint32Array, 4, 0], 5126: [Float32Array, 4, 0] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function loadGltf(dir) {
  const file = fs.readdirSync(dir).find((f) => f.endsWith(".gltf"));
  const json = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  const buffers = json.buffers.map((b) => fs.readFileSync(path.join(dir, decodeURIComponent(b.uri))));
  function accessor(i, asFloat) {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    const [T, size, max] = COMP[a.componentType];
    const n = NCOMP[a.type];
    const buf = buffers[bv.buffer];
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || size * n;
    let raw;
    if (stride === size * n) raw = new T(buf.buffer.slice(buf.byteOffset + base, buf.byteOffset + base + a.count * n * size));
    else {
      raw = new T(a.count * n);
      const dv = new DataView(buf.buffer, buf.byteOffset);
      const get = { 1: T === Int8Array ? "getInt8" : "getUint8", 2: T === Int16Array ? "getInt16" : "getUint16", 4: T === Float32Array ? "getFloat32" : "getUint32" }[size];
      for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) raw[k * n + c] = dv[get](base + k * stride + c * size, true);
    }
    if (asFloat) {
      if (T === Float32Array) return raw;
      const f = new Float32Array(raw.length);
      for (let k = 0; k < raw.length; k++) f[k] = a.normalized ? Math.max(raw[k] / max, -1) : raw[k];
      return f;
    }
    return T === Uint32Array ? raw : Uint32Array.from(raw);
  }
  return { json, accessor, dir };
}

function uvTransform(mat) {
  const t = mat?.pbrMetallicRoughness?.baseColorTexture?.extensions?.KHR_texture_transform;
  if (!t) return null;
  const [ox, oy] = t.offset || [0, 0];
  const [sx, sy] = t.scale || [1, 1];
  const r = t.rotation || 0;
  const c = Math.cos(r), s = Math.sin(r);
  // glTF: T * R * S, R = [[c, s], [-s, c]] applied to column vector (u, v)
  return (u, v) => [ox + c * sx * u + s * sy * v, oy - s * sx * u + c * sy * v];
}

/** Collect triangle groups (one per material) for the whole scene or for each top-level node. */
function collect(g, variantCount) {
  const { json } = g;
  const tops = json.scenes[json.scene || 0].nodes.slice();
  let sets;
  if (variantCount && tops.length > 1) {
    tops.sort((a, b) => (json.nodes[a].name || "").localeCompare(json.nodes[b].name || ""));
    const pick = [];
    const n = Math.min(variantCount, tops.length);
    for (let k = 0; k < n; k++) pick.push(tops[Math.floor((k * tops.length) / n)]);
    sets = pick.map((t) => ({ name: json.nodes[t].name || `v${t}`, roots: [t], recentre: true }));
  } else sets = [{ name: "main", roots: tops, recentre: false }];

  return sets.map((set) => {
    const parts = new Map(); // material -> arrays
    const walk = (ni, parent) => {
      const n = json.nodes[ni];
      const local = n.matrix || compose(n.translation || [0, 0, 0], n.rotation || [0, 0, 0, 1], n.scale || [1, 1, 1]);
      let M = mul(parent, local);
      if (set.recentre && parent === IDENT) M = mul(compose([-(n.translation?.[0] || 0), 0, -(n.translation?.[2] || 0)], [0, 0, 0, 1], [1, 1, 1]), M);
      if (n.mesh !== undefined) {
        const N = normalMatrix(M);
        for (const p of json.meshes[n.mesh].primitives) {
          if ((p.mode ?? 4) !== 4) continue;
          const pos = g.accessor(p.attributes.POSITION, true);
          const vc = pos.length / 3;
          const nrm = p.attributes.NORMAL !== undefined ? g.accessor(p.attributes.NORMAL, true) : new Float32Array(vc * 3);
          const uv = p.attributes.TEXCOORD_0 !== undefined ? g.accessor(p.attributes.TEXCOORD_0, true) : new Float32Array(vc * 2);
          const idx = p.indices !== undefined ? g.accessor(p.indices, false) : Uint32Array.from({ length: vc }, (_, k) => k);
          const mat = json.materials?.[p.material] || {};
          const tf = uvTransform(mat);
          const P = new Float32Array(vc * 3), Nn = new Float32Array(vc * 3), U = new Float32Array(vc * 2);
          for (let k = 0; k < vc; k++) {
            const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
            P[k * 3] = M[0] * x + M[4] * y + M[8] * z + M[12];
            P[k * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
            P[k * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
            const a = nrm[k * 3], b = nrm[k * 3 + 1], c = nrm[k * 3 + 2];
            const nx = N[0] * a + N[3] * b + N[6] * c, ny = N[1] * a + N[4] * b + N[7] * c, nz = N[2] * a + N[5] * b + N[8] * c;
            const l = len3(nx, ny, nz);
            Nn[k * 3] = nx / l; Nn[k * 3 + 1] = ny / l; Nn[k * 3 + 2] = nz / l;
            // glTF UVs have v = 0 at the top of the image; three's TextureLoader (flipY) has it at the bottom
            if (tf) { const [u, v] = tf(uv[k * 2], uv[k * 2 + 1]); U[k * 2] = u; U[k * 2 + 1] = 1 - v; }
            else { U[k * 2] = uv[k * 2]; U[k * 2 + 1] = 1 - uv[k * 2 + 1]; }
          }
          const key = p.material ?? -1;
          if (!parts.has(key)) parts.set(key, []);
          parts.get(key).push({ P, N: Nn, U, I: idx });
        }
      }
      for (const c of n.children || []) walk(c, M);
    };
    for (const r of set.roots) walk(r, IDENT);
    const groups = [];
    for (const [mi, list] of parts) groups.push({ mat: mi, matDef: json.materials?.[mi] || {}, ...concat(list) });
    return { name: set.name, groups };
  });
}
function concat(list) {
  const vc = list.reduce((s, x) => s + x.P.length / 3, 0);
  const ic = list.reduce((s, x) => s + x.I.length, 0);
  const pos = new Float32Array(vc * 3), nrm = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const x of list) {
    pos.set(x.P, vo * 3); nrm.set(x.N, vo * 3); uv.set(x.U, vo * 2);
    for (let k = 0; k < x.I.length; k++) idx[io + k] = x.I[k] + vo;
    vo += x.P.length / 3; io += x.I.length;
  }
  return { pos, nrm, uv, idx };
}
const tris = (g) => g.idx.length / 3;
function area(g) {
  let a = 0;
  const p = g.pos, I = g.idx;
  for (let t = 0; t < I.length; t += 3) {
    const i = I[t] * 3, j = I[t + 1] * 3, k = I[t + 2] * 3;
    const ux = p[j] - p[i], uy = p[j + 1] - p[i + 1], uz = p[j + 2] - p[i + 2];
    const vx = p[k] - p[i], vy = p[k + 1] - p[i + 1], vz = p[k + 2] - p[i + 2];
    a += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return a;
}
function bounds(groups) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const g of groups) for (let k = 0; k < g.pos.length; k += 3) for (let c = 0; c < 3; c++) {
    mn[c] = Math.min(mn[c], g.pos[k + c]); mx[c] = Math.max(mx[c], g.pos[k + c]);
  }
  return { min: mn, max: mx };
}
function compact(g, idx) {
  const remap = new Int32Array(g.pos.length / 3).fill(-1);
  let n = 0;
  for (const i of idx) if (remap[i] < 0) remap[i] = n++;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < remap.length; i++) {
    const r = remap[i];
    if (r < 0) continue;
    pos.set(g.pos.subarray(i * 3, i * 3 + 3), r * 3); nrm.set(g.nrm.subarray(i * 3, i * 3 + 3), r * 3); uv.set(g.uv.subarray(i * 2, i * 2 + 2), r * 2);
  }
  return { ...g, pos, nrm, uv, idx: Uint32Array.from(idx, (i) => remap[i]) };
}

// ---------------------------------------------------------------- reduction
function simplifyTo(g, target, fallback = "cluster", guard = false) {
  if (tris(g) <= target) return g;
  if (target < 1) return null;
  const vc = g.pos.length / 3;
  const attr = new Float32Array(vc * 5);
  for (let k = 0; k < vc; k++) {
    attr[k * 5] = g.nrm[k * 3]; attr[k * 5 + 1] = g.nrm[k * 3 + 1]; attr[k * 5 + 2] = g.nrm[k * 3 + 2];
    attr[k * 5 + 3] = g.uv[k * 2]; attr[k * 5 + 4] = g.uv[k * 2 + 1];
  }
  const want = target * 3;
  let best = g.idx;
  // leaves/blades: never distort a card into a sliver; stop at a small error and drop whole pieces instead
  const errs = fallback === "drop" ? [0.004, 0.012, 0.025] : [0.01, 0.04, 0.12, 0.3, 1];
  for (const [err, flags] of errs.map((e) => [e, []])) {
    const [out] = MeshoptSimplifier.simplifyWithAttributes(g.idx, g.pos, 3, attr, 5, [0.4, 0.4, 0.4, 0.6, 0.6], null, want, err, flags);
    best = out;
    if (out.length <= want) break;
  }
  if (best.length > want && fallback !== "drop") {
    // attribute seams (UV islands, hard normals) block further collapses: weld by position and accept
    // some texture stretching along the old seams
    const weld = weldByPosition(g);
    const wi = Uint32Array.from(best, (i) => weld[i]);
    const [out] = MeshoptSimplifier.simplify(wi, g.pos, 3, want, 1, []);
    if (out.length < best.length) best = out;
  }
  let r = compact(g, best);
  if (tris(r) > target && fallback === "drop") {
    const d = dropComponents(r, target, 2.2);
    // whole-plant meshes (leaves fused to stems) cannot be thinned piece by piece: simplify harder instead
    r = tris(d) >= target * 0.5 ? d : simplifyTo(r, target, "cluster", guard);
  }
  else if (tris(r) > target) {
    // locked topology (split-vertex scans, touching staves): cluster to a few times the budget, which
    // rebuilds connectivity, then let meshoptimizer finish; cluster again only if it still stalls
    if (tris(r) > target * 6) r = clusterSimplify(r, target * 6);
    if (!guard) r = simplifyTo(r, target, fallback, true);
    if (tris(r) > target) r = clusterSimplify(r, target);
  }
  if (!guard && tris(r) > target) r = keepLargest(r, target);
  return r;
}

/** Hard cap: keep the largest triangles. */
function keepLargest(g, target) {
  const p = g.pos, I = g.idx;
  const ar = [];
  for (let t = 0; t < I.length; t += 3) {
    const i = I[t] * 3, j = I[t + 1] * 3, k = I[t + 2] * 3;
    const ux = p[j] - p[i], uy = p[j + 1] - p[i + 1], uz = p[j + 2] - p[i + 2];
    const vx = p[k] - p[i], vy = p[k + 1] - p[i + 1], vz = p[k + 2] - p[i + 2];
    ar.push([Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx), t]);
  }
  ar.sort((a, b) => b[0] - a[0]);
  const keep = ar.slice(0, target).map(([, t]) => t).sort((a, b) => a - b);
  const idx = [];
  for (const t of keep) idx.push(I[t], I[t + 1], I[t + 2]);
  return compact(g, idx);
}

/** Last resort for locked / non-manifold topology: vertex clustering on a grid, searched to fit the budget. */
function clusterSimplify(g, target) {
  const b = bounds([g]);
  const ext = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) || 1;
  const attempt = (cell) => {
    const rep = new Map();
    const vc = g.pos.length / 3;
    const cellOf = new Int32Array(vc);
    for (let k = 0; k < vc; k++) {
      const key = `${Math.floor(g.pos[k * 3] / cell)},${Math.floor(g.pos[k * 3 + 1] / cell)},${Math.floor(g.pos[k * 3 + 2] / cell)}`;
      let r = rep.get(key);
      if (r === undefined) { r = k; rep.set(key, k); }
      cellOf[k] = r;
    }
    const seen = new Set();
    const out = [];
    for (let t = 0; t < g.idx.length; t += 3) {
      const a = cellOf[g.idx[t]], bb = cellOf[g.idx[t + 1]], c = cellOf[g.idx[t + 2]];
      if (a === bb || bb === c || a === c) continue;
      const key = [a, bb, c].sort((x, y) => x - y).join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a, bb, c);
    }
    return out;
  };
  let lo = ext / 2000, hi = ext / 2;
  let best = attempt(hi);
  for (let it = 0; it < 18; it++) {
    const mid = Math.sqrt(lo * hi);
    const o = attempt(mid);
    if (o.length / 3 <= target) { best = o; hi = mid; } else lo = mid;
  }
  return compact(g, best);
}
function weldByPosition(g) {
  const vc = g.pos.length / 3;
  const weld = new Uint32Array(vc);
  const map = new Map();
  for (let k = 0; k < vc; k++) {
    const key = `${Math.round(g.pos[k * 3] * 1e5)},${Math.round(g.pos[k * 3 + 1] * 1e5)},${Math.round(g.pos[k * 3 + 2] * 1e5)}`;
    const w = map.get(key);
    if (w === undefined) { map.set(key, k); weld[k] = k; } else weld[k] = w;
  }
  return weld;
}

/** Union-find connected components over position-welded vertices; returns a component id per triangle. */
function components(g) {
  const vc = g.pos.length / 3;
  const weld = new Int32Array(vc);
  const map = new Map();
  for (let k = 0; k < vc; k++) {
    const key = `${Math.round(g.pos[k * 3] * 1e4)},${Math.round(g.pos[k * 3 + 1] * 1e4)},${Math.round(g.pos[k * 3 + 2] * 1e4)}`;
    let w = map.get(key);
    if (w === undefined) { w = map.size; map.set(key, w); }
    weld[k] = w;
  }
  const parent = Int32Array.from({ length: map.size }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const I = g.idx;
  for (let t = 0; t < I.length; t += 3) {
    const a = find(weld[I[t]]), b = find(weld[I[t + 1]]), c = find(weld[I[t + 2]]);
    parent[b] = a; parent[find(c)] = a;
  }
  const comp = new Int32Array(I.length / 3);
  for (let t = 0; t < comp.length; t++) comp[t] = find(weld[I[t * 3]]);
  return comp;
}

/** Keep a random subset of connected pieces (leaves, blades) and scale survivors about their centre. */
function dropComponents(g, target, maxScale = 2.2, seed = 1, largestFirst = false) {
  const comp = components(g);
  const byComp = new Map();
  for (let t = 0; t < comp.length; t++) {
    let e = byComp.get(comp[t]);
    if (!e) { e = []; byComp.set(comp[t], e); }
    e.push(t);
  }
  const list = [...byComp.values()];
  const r = rng(seed);
  if (largestFirst) list.sort((a, b) => b.length - a.length);
  else for (let k = list.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [list[k], list[j]] = [list[j], list[k]]; }
  const keep = [];
  let n = 0;
  for (const c of list) { if (n + c.length > target) continue; keep.push(c); n += c.length; }
  const total = tris(g);
  const s = Math.min(maxScale, Math.sqrt(total / Math.max(1, n)));
  const pos = g.pos.slice();
  const moved = new Uint8Array(g.pos.length / 3);
  const idx = [];
  for (const c of keep) {
    const vs = new Set();
    for (const t of c) for (let q = 0; q < 3; q++) vs.add(g.idx[t * 3 + q]);
    let cx = 0, cy = 0, cz = 0;
    for (const v of vs) { cx += g.pos[v * 3]; cy += g.pos[v * 3 + 1]; cz += g.pos[v * 3 + 2]; }
    cx /= vs.size; cy /= vs.size; cz /= vs.size;
    // scale about the lowest point for upright pieces so they stay rooted
    let lowY = Infinity;
    for (const v of vs) lowY = Math.min(lowY, g.pos[v * 3 + 1]);
    const py = Math.max(lowY, 0) === lowY ? lowY : cy;
    for (const v of vs) {
      if (moved[v]) continue;
      moved[v] = 1;
      pos[v * 3] = cx + (g.pos[v * 3] - cx) * s;
      pos[v * 3 + 1] = py + (g.pos[v * 3 + 1] - py) * s;
      pos[v * 3 + 2] = cz + (g.pos[v * 3 + 2] - cz) * s;
    }
    for (const t of c) idx.push(g.idx[t * 3], g.idx[t * 3 + 1], g.idx[t * 3 + 2]);
  }
  return compact({ ...g, pos }, idx);
}

/** Split a triangle budget between parts by surface area (sqrt-damped so small trims survive). */
function splitBudget(groups, budget, minTris) {
  const w = groups.map((g) => Math.sqrt(area(g)) + 1e-6);
  const W = w.reduce((a, b) => a + b, 0);
  let alloc = groups.map((g, i) => Math.min(tris(g), Math.floor((budget * w[i]) / W)));
  // hand leftover budget to parts that were capped below their share
  for (let pass = 0; pass < 4; pass++) {
    const left = budget - alloc.reduce((a, b) => a + b, 0);
    const open = groups.map((g, i) => (alloc[i] < tris(g) ? i : -1)).filter((i) => i >= 0);
    if (left <= 0 || !open.length) break;
    const ow = open.reduce((s, i) => s + w[i], 0);
    for (const i of open) alloc[i] = Math.min(tris(groups[i]), alloc[i] + Math.floor((left * w[i]) / ow));
  }
  alloc = alloc.map((a) => (a < minTris ? 0 : a));
  if (!alloc.some((a) => a > 0) && groups.length) {
    // nothing survives the per-part minimum: the biggest part takes the whole budget
    let big = 0;
    groups.forEach((g, i) => { if (w[i] > w[big]) big = i; });
    alloc[big] = Math.min(tris(groups[big]), budget);
  }
  return alloc;
}

// ---------------------------------------------------------------- tree foliage cards
function leafTriangles(foliage) {
  const pts = [];
  for (const g of foliage) {
    const p = g.pos, I = g.idx;
    for (let t = 0; t < I.length; t += 3) {
      const i = I[t] * 3, j = I[t + 1] * 3, k = I[t + 2] * 3;
      const ux = p[j] - p[i], uy = p[j + 1] - p[i + 1], uz = p[j + 2] - p[i + 2];
      const vx = p[k] - p[i], vy = p[k + 1] - p[i + 1], vz = p[k + 2] - p[i + 2];
      const a = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      pts.push((p[i] + p[j] + p[k]) / 3, (p[i + 1] + p[j + 1] + p[k + 1]) / 3, (p[i + 2] + p[j + 2] + p[k + 2]) / 3, a);
    }
  }
  return Float64Array.from(pts);
}
function binCells(pts, h) {
  const cells = new Map();
  for (let k = 0; k < pts.length; k += 4) {
    const key = `${Math.floor(pts[k] / h)},${Math.floor(pts[k + 1] / h)},${Math.floor(pts[k + 2] / h)}`;
    let c = cells.get(key);
    if (!c) { c = [0, 0, 0, 0]; cells.set(key, c); }
    const a = pts[k + 3] + 1e-9;
    c[0] += pts[k] * a; c[1] += pts[k + 1] * a; c[2] += pts[k + 2] * a; c[3] += a;
  }
  return cells;
}
function makeCards(pts, nCards, centre, seed, sizeFactor) {
  let lo = 0.005, hi = 20;
  for (let it = 0; it < 22; it++) {
    const h = Math.sqrt(lo * hi);
    if (binCells(pts, h).size > nCards) lo = h; else hi = h;
  }
  const h = hi;
  const cells = [...binCells(pts, h).values()].map((c) => ({ x: c[0] / c[3], y: c[1] / c[3], z: c[2] / c[3], a: c[3] }));
  const areas = cells.map((c) => c.a).sort((a, b) => a - b);
  const med = areas[Math.floor(areas.length / 2)] || 1;
  const r = rng(seed);
  const cards = cells.map((c) => {
    let nx = c.x - centre[0], ny = (c.y - centre[1]) * 0.8, nz = c.z - centre[2];
    let l = len3(nx, ny, nz);
    nx = nx / l + (r() - 0.5) * 0.9; ny = ny / l + (r() - 0.5) * 0.9; nz = nz / l + (r() - 0.5) * 0.9;
    l = len3(nx, ny, nz);
    const size = h * sizeFactor * Math.min(1.15, Math.max(0.55, Math.sqrt(c.a / med)));
    return { c: [c.x, c.y, c.z], n: [nx / l, ny / l, nz / l], s: size, rot: r() * Math.PI * 2, v: Math.floor(r() * 4), dens: c.a };
  });
  return { h, cards };
}
function basis(n, rot) {
  let tx = -n[2], ty = 0, tz = n[0]; // up x n
  let l = Math.hypot(tx, tz);
  if (l < 1e-4) { tx = 1; tz = 0; l = 1; }
  tx /= l; tz /= l;
  const bx = n[1] * tz - n[2] * ty, by = n[2] * tx - n[0] * tz, bz = n[0] * ty - n[1] * tx;
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[tx * c + bx * s, ty * c + by * s, tz * c + bz * s], [-tx * s + bx * c, -ty * s + by * c, -tz * s + bz * c]];
}
function cardsGeometry(cards, centre) {
  const n = cards.length;
  const pos = new Float32Array(n * 12), nrm = new Float32Array(n * 12), uv = new Float32Array(n * 8), idx = new Uint32Array(n * 6);
  cards.forEach((cd, i) => {
    const [t, b] = basis(cd.n, cd.rot);
    const hs = cd.s / 2;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const u0 = (cd.v % 2) * 0.5, v0 = Math.floor(cd.v / 2) * 0.5;
    corners.forEach(([a, bb], q) => {
      const x = cd.c[0] + (t[0] * a + b[0] * bb) * hs, y = cd.c[1] + (t[1] * a + b[1] * bb) * hs, z = cd.c[2] + (t[2] * a + b[2] * bb) * hs;
      pos.set([x, y, z], (i * 4 + q) * 3);
      // soft canopy normals: mostly "out of the crown", a little of the card's own facing
      let ox = x - centre[0], oy = (y - centre[1]) * 0.7 + 0.3 * Math.abs(y - centre[1]), oz = z - centre[2];
      const ol = len3(ox, oy, oz);
      let nx = (ox / ol) * 0.75 + cd.n[0] * 0.25, ny = (oy / ol) * 0.75 + cd.n[1] * 0.25 + 0.15, nz = (oz / ol) * 0.75 + cd.n[2] * 0.25;
      const nl = len3(nx, ny, nz);
      nrm.set([nx / nl, ny / nl, nz / nl], (i * 4 + q) * 3);
      uv.set([u0 + ((a + 1) / 2) * 0.5, v0 + ((bb + 1) / 2) * 0.5], (i * 4 + q) * 2);
    });
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  return { pos, nrm, uv, idx };
}
/** Leaf triangles around 4 sample cards, in each card's local frame (x along t, y along b, z along n). */
function bakeSamples(foliage, cardsRes, seed) {
  const r = rng(seed);
  const cards = cardsRes.cards.slice().sort((a, b) => b.dens - a.dens).slice(0, Math.max(8, Math.floor(cardsRes.cards.length * 0.4)));
  const picks = [];
  for (let k = 0; k < 4; k++) picks.push(cards[Math.floor(r() * cards.length)]);
  return picks.map((cd) => {
    const [t, b] = basis(cd.n, 0);
    const hs = cd.s / 2;
    const P = [], U = [];
    for (const g of foliage) {
      const p = g.pos, I = g.idx;
      for (let q = 0; q < I.length; q += 3) {
        const i = I[q] * 3, j = I[q + 1] * 3, k = I[q + 2] * 3;
        const cx = (p[i] + p[j] + p[k]) / 3 - cd.c[0], cy = (p[i + 1] + p[j + 1] + p[k + 1]) / 3 - cd.c[1], cz = (p[i + 2] + p[j + 2] + p[k + 2]) / 3 - cd.c[2];
        const lx = cx * t[0] + cy * t[1] + cz * t[2], ly = cx * b[0] + cy * b[1] + cz * b[2], lz = cx * cd.n[0] + cy * cd.n[1] + cz * cd.n[2];
        if (Math.abs(lx) > hs * 1.05 || Math.abs(ly) > hs * 1.05 || Math.abs(lz) > hs * 1.6) continue;
        for (const v of [I[q], I[q + 1], I[q + 2]]) {
          const dx = p[v * 3] - cd.c[0], dy = p[v * 3 + 1] - cd.c[1], dz = p[v * 3 + 2] - cd.c[2];
          P.push(dx * t[0] + dy * t[1] + dz * t[2], dx * b[0] + dy * b[1] + dz * b[2], dx * cd.n[0] + dy * cd.n[1] + dz * cd.n[2]);
          U.push(g.uv[v * 2], g.uv[v * 2 + 1]);
        }
      }
    }
    return { s: cd.s, P: Float32Array.from(P), U: Float32Array.from(U) };
  });
}

// ---------------------------------------------------------------- impostor quads
function impostorGeometry(b) {
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  const R = Math.max(b.max[0] - cx, cx - b.min[0], b.max[2] - cz, cz - b.min[2]);
  const H = b.max[1] - b.min[1];
  const L = Math.max(2 * R, H);
  const y0 = b.min[1], y1 = b.min[1] + L;
  const hx = L / 2;
  // quad A in the XY plane (front view), quad B in the ZY plane (side view, screen-right = -Z)
  const pos = Float32Array.from([
    cx - hx, y0, cz, cx + hx, y0, cz, cx + hx, y1, cz, cx - hx, y1, cz,
    cx, y0, cz + hx, cx, y0, cz - hx, cx, y1, cz - hx, cx, y1, cz + hx,
  ]);
  const nrm = Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
  const uv = Float32Array.from([0, 0, 0.5, 0, 0.5, 1, 0, 1, 0.5, 0, 1, 0, 1, 1, 0.5, 1]);
  const idx = Uint32Array.from([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return { geo: { pos, nrm, uv, idx }, view: { cx, cz, y0, L } };
}

// ---------------------------------------------------------------- output
class BinWriter {
  constructor() { this.chunks = []; this.size = 0; }
  push(typed) {
    const pad = (4 - (this.size % 4)) % 4;
    if (pad) { this.chunks.push(Buffer.alloc(pad)); this.size += pad; }
    const off = this.size;
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    this.chunks.push(Buffer.from(buf));
    this.size += buf.length;
    return off;
  }
  buffer() { return Buffer.concat(this.chunks); }
}
function writePart(bin, g) {
  const vc = g.pos.length / 3;
  const n8 = new Int8Array(vc * 3);
  for (let k = 0; k < vc * 3; k++) n8[k] = Math.round(Math.max(-1, Math.min(1, g.nrm[k])) * 127);
  const big = vc > 65535;
  return {
    vertices: vc,
    triangles: tris(g),
    position: bin.push(g.pos),
    normal: bin.push(n8),
    uv: bin.push(g.uv),
    index: bin.push(big ? g.idx : Uint16Array.from(g.idx)),
    indexType: big ? "u32" : "u16",
  };
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

async function writeTextures(g, outDir, mat, res, used) {
  const json = g.json;
  const pb = mat.pbrMetallicRoughness || {};
  const img = (texInfo) => (texInfo ? path.join(g.dir, decodeURIComponent(json.images[json.textures[texInfo.index].source].uri)) : null);
  const base = slug(mat.name || "mat");
  const out = {};
  const jobs = [
    ["map", img(pb.baseColorTexture), `${base}_c.webp`, 82],
    ["normalMap", img(mat.normalTexture), `${base}_n.webp`, 88],
    ["armMap", img(pb.metallicRoughnessTexture), `${base}_r.webp`, 80],
  ];
  const alpha = (mat.alphaMode || "OPAQUE") !== "OPAQUE" ? alphaMap(g.dir, mat.name || "") : alphaMap(g.dir, mat.name || "", false);
  for (const [key, src, name, q] of jobs) {
    if (!src || !fs.existsSync(src)) continue;
    out[key] = name;
    if (used.has(name)) continue;
    used.add(name);
    let img = sharp(src).resize(res, res, { fit: "fill" });
    if (key === "map" && alpha) {
      const a = await sharp(alpha).resize(res, res, { fit: "fill" }).greyscale().extractChannel(0).raw().toBuffer();
      img = sharp(await img.removeAlpha().raw().toBuffer(), { raw: { width: res, height: res, channels: 3 } }).joinChannel(a, { raw: { width: res, height: res, channels: 1 } });
    }
    await img.webp({ quality: q, alphaQuality: 90 }).toFile(path.join(outDir, name));
  }
  if (alpha) out.alphaTest = 0.5;
  const f = pb.baseColorFactor;
  if (f && (f[0] !== 1 || f[1] !== 1 || f[2] !== 1)) out.color = f.slice(0, 3);
  // Poly Haven assets are dielectrics; some ship a greyscale roughness map in the metallic-roughness slot,
  // which would read as metal through the blue channel. Only a true ARM map also carries occlusion.
  out.metalness = 0;
  out.arm = !!(jobs[2][1] && /_arm_/.test(jobs[2][1]));
  out.roughness = pb.roughnessFactor ?? 1;
  return out;
}

/** Poly Haven ships the opacity map of cut-out cards outside the glTF (fetched by fetch-models.py). */
export function alphaMap(dir, matName, allowFallback = true) {
  const tdir = path.join(dir, "textures");
  if (!fs.existsSync(tdir)) return null;
  const files = fs.readdirSync(tdir).filter((f) => /_alpha_\d+k\.png$/.test(f));
  const exact = files.find((f) => f.startsWith(`${matName}_alpha_`));
  if (exact) return path.join(tdir, exact);
  return allowFallback && files.length === 1 ? path.join(tdir, files[0]) : null;
}
/** Cut-out material: glTF alpha mode, or an opacity map published for it (Poly Haven omits some). */
const isCutout = (dir, mat) => (mat.alphaMode || "OPAQUE") !== "OPAQUE" || !!alphaMap(dir, mat.name || "", false);

const LOD_DIST = {
  tree: (r) => [Math.max(35, 4 * r), Math.max(130, 16 * r), 4000],
  shrub: (r) => [Math.max(18, 30 * r), Math.max(60, 90 * r)],
  groundcover: (r) => [Math.max(10, 30 * r), Math.max(35, 80 * r)],
  grass: (r) => [Math.max(12, 30 * r), Math.max(40, 80 * r)],
  deadwood: (r) => [Math.max(20, 10 * r), Math.max(60, 35 * r), Math.max(250, 120 * r)],
  rock: (r) => [Math.max(20, 10 * r), Math.max(60, 35 * r), Math.max(300, 150 * r)],
  prop: (r) => [Math.max(12, 15 * r), Math.max(40, 45 * r), Math.max(150, 150 * r)],
  vessel: (r) => [Math.max(80, 4 * r), Math.max(300, 14 * r), 3000],
};

// ---------------------------------------------------------------- per asset
async function processAsset(a) {
  const srcDir = `${SRC}/${a.id}`;
  if (!fs.existsSync(srcDir)) { console.log(`skip ${a.id}: not fetched`); return null; }
  const t0 = Date.now();
  const budget = { ...manifest.budgets[a.category], ...(a.budget || {}) };
  const res = budget.texture || 1024;
  const outDir = `${OUT}/${a.id}`;
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const g = loadGltf(srcDir);
  const variants = collect(g, a.variants || 0);
  const bin = new BinWriter();
  const usedTex = new Set();
  const matCache = new Map();
  const getMat = async (mi, matDef, kind) => {
    const k = `${mi}|${kind}`;
    if (!matCache.has(k)) {
      const m = await writeTextures(g, outDir, matDef, res, usedTex);
      matCache.set(k, { kind: m.alphaTest ? "cutout" : kind, name: matDef.name || `mat${mi}`, doubleSided: matDef.doubleSided !== false, ...m });
    }
    return matCache.get(k);
  };
  const isTree = a.category === "tree";
  const isPlant = ["shrub", "groundcover", "grass"].includes(a.category);
  const bake = { id: a.id, leaf: null, impostors: [] };
  const outVariants = [];
  for (const [vi, v] of variants.entries()) {
    const b = bounds(v.groups);
    const radius = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
    const lods = [];
    const foliage = isTree ? v.groups.filter((x) => isCutout(g.dir, x.matDef)) : [];
    const solids = v.groups.filter((x) => !foliage.includes(x));
    const levelBudgets = [budget.lod0, budget.lod1, budget.lod2].filter((x) => x !== undefined);
    for (const [li, lb] of levelBudgets.entries()) {
      const parts = [];
      const impostorLevel = (isTree && li === 2) || (isPlant && li === 1);
      if (impostorLevel) {
        const imp = impostorGeometry(b);
        parts.push({ ...writePart(bin, imp.geo), material: { kind: "impostor", name: "impostor", map: `imp${vi}_c.webp`, normalMap: `imp${vi}_n.webp`, alphaTest: 0.5, doubleSided: true, roughness: 0.9, metalness: 0 } });
        bake.impostors.push({ variant: vi, ...imp.view, size: isTree ? 1024 : 512 });
      } else if (isTree) {
        const leafShare = foliage.length ? 0.66 : 0;
        const solidBudget = Math.floor(lb * (1 - leafShare));
        const alloc = splitBudget(solids, solidBudget, li === 0 ? 24 : 40);
        let used = 0;
        for (const [k, s] of solids.entries()) {
          if (!alloc[k]) continue;
          const r = simplifyTo(s, alloc[k]);
          if (!r || !tris(r)) continue;
          used += tris(r);
          parts.push({ ...writePart(bin, r), material: await getMat(s.mat, s.matDef, "opaque") });
        }
        if (foliage.length) {
          const nCards = Math.floor((lb - used) / 2);
          const pts = leafTriangles(foliage);
          const canopy = bounds(foliage);
          const centre = canopy.min.map((m, c) => (m + canopy.max[c]) / 2);
          // LOD0 cards are small and many: oversize them more so the crown stays closed
          const cr = makeCards(pts, nCards, centre, hashStr(a.id) + li * 101 + vi, li === 0 ? 2.3 : 1.8);
          // trim to budget (grid count can overshoot slightly)
          const cards = cr.cards.slice(0, nCards);
          const geo = cardsGeometry(cards, centre);
          parts.push({ ...writePart(bin, geo), material: { kind: "cutout", name: `leaf${li}`, map: `leaf${li}_c.webp`, alphaTest: 0.45, doubleSided: true, crownNormals: true, roughness: 0.85, metalness: 0, cardSize: +cr.h.toFixed(3) } });
          if (vi === 0) {
            bake.leaf = bake.leaf || { atlases: [] };
            bake.leaf.atlases.push({ name: `leaf${li}`, samples: bakeSamples(foliage, { cards }, hashStr(a.id) + li) });
          }
        }
      } else {
        const minTris = li === 0 ? 1 : li === 1 ? 12 : 8;
        const alloc = splitBudget(v.groups, lb, minTris);
        for (const [k, s] of v.groups.entries()) {
          if (!alloc[k]) continue;
          let r;
          if (isPlant) {
            // leaves: geometric simplification first; if it stalls, drop whole leaves/blades and enlarge the rest
            r = simplifyTo(s, Math.max(alloc[k], 1), "drop");
          } else r = simplifyTo(s, alloc[k]);
          if (!r || !tris(r)) continue;
          parts.push({ ...writePart(bin, r), material: await getMat(s.mat, s.matDef, "opaque") });
        }
      }
      lods.push({ triangles: parts.reduce((s, p) => s + p.triangles, 0), parts });
    }
    const dist = LOD_DIST[a.category](radius);
    lods.forEach((l, i) => (l.maxDistance = Math.round(dist[i] ?? dist[dist.length - 1])));
    outVariants.push({
      name: v.name,
      bounds: { min: b.min.map((x) => +x.toFixed(3)), max: b.max.map((x) => +x.toFixed(3)) },
      size: { height: +(b.max[1] - b.min[1]).toFixed(3), width: +(b.max[0] - b.min[0]).toFixed(3), depth: +(b.max[2] - b.min[2]).toFixed(3) },
      radius: +radius.toFixed(3),
      lods,
    });
  }
  // leaf source texture for the bake step
  if (bake.leaf) {
    const leafMat = variants[0].groups.find((x) => isCutout(g.dir, x.matDef)).matDef;
    const src = path.join(g.dir, decodeURIComponent(g.json.images[g.json.textures[leafMat.pbrMetallicRoughness.baseColorTexture.index].source].uri));
    const bdir = `${BAKE}/${a.id}`;
    fs.mkdirSync(bdir, { recursive: true });
    const am = alphaMap(g.dir, leafMat.name || "");
    let img = sharp(src).resize(1024, 1024, { fit: "fill" });
    if (am) {
      const al = await sharp(am).resize(1024, 1024, { fit: "fill" }).greyscale().extractChannel(0).raw().toBuffer();
      img = sharp(await img.removeAlpha().raw().toBuffer(), { raw: { width: 1024, height: 1024, channels: 3 } }).joinChannel(al, { raw: { width: 1024, height: 1024, channels: 1 } });
    }
    await img.webp({ quality: 92, alphaQuality: 95 }).toFile(`${bdir}/leafsrc.webp`);
    const bb = new BinWriter();
    for (const at of bake.leaf.atlases) at.samples = at.samples.map((s) => ({ s: s.s, count: s.P.length / 3, P: bb.push(s.P), U: bb.push(s.U) }));
    fs.writeFileSync(`${bdir}/leaf.bin`, bb.buffer());
    bake.leaf.texture = "leafsrc.webp";
  }
  const geo = bin.buffer();
  fs.writeFileSync(`${outDir}/geo.bin`, geo);
  const model = {
    id: a.id,
    name: a.name,
    category: a.category,
    licence: "CC0 1.0",
    source: `https://polyhaven.com/a/${a.id}`,
    plausibility: a.plausibility,
    period: a.period,
    confidence: a.confidence,
    budget,
    bin: "geo.bin",
    variants: outVariants,
    bake,
    baked: false,
  };
  fs.writeFileSync(`${outDir}/model.json`, JSON.stringify(model));
  const tri = outVariants.map((v) => v.lods.map((l) => l.triangles));
  console.log(`${a.id.padEnd(26)} ${outVariants.length}v  lods ${JSON.stringify(tri[0])}${tri.length > 1 ? " .." + JSON.stringify(tri[tri.length - 1]) : ""}  geo ${(geo.length / 1024).toFixed(0)} KB  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return model;
}

export function dirBytes(d) {
  let t = 0;
  for (const f of fs.readdirSync(d, { withFileTypes: true })) t += f.isDirectory() ? dirBytes(path.join(d, f.name)) : fs.statSync(path.join(d, f.name)).size;
  return t;
}
export function writeIndex() {
  const entries = [];
  for (const a of manifest.assets) {
    const p = `${OUT}/${a.id}/model.json`;
    if (!fs.existsSync(p)) continue;
    const m = JSON.parse(fs.readFileSync(p, "utf8"));
    const files = fs.readdirSync(`${OUT}/${a.id}`).sort();
    entries.push({
      id: a.id, name: a.name, category: a.category, variants: m.variants.length,
      triangles: m.variants[0].lods.map((_, i) => Math.max(...m.variants.map((v) => v.lods[i]?.triangles ?? 0))),
      size: m.variants[0].size, baked: m.baked, period: a.period, confidence: a.confidence,
      files, bytes: dirBytes(`${OUT}/${a.id}`),
    });
  }
  fs.writeFileSync(`${OUT}/index.json`, JSON.stringify({ licence: manifest.licence, generated: new Date().toISOString(), assets: entries }, null, 1));
  return entries;
}

if (process.argv[1] && process.argv[1].endsWith("optimize-models.mjs")) {
  for (const a of manifest.assets) {
    if (only.size && !only.has(a.id)) continue;
    await processAsset(a);
  }
  const e = writeIndex();
  console.log(`index: ${e.length} assets, ${(e.reduce((s, x) => s + x.bytes, 0) / 1e6).toFixed(1)} MB optimised`);
}
