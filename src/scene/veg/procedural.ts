import * as THREE from "three";
import { lifeUniforms, patchLife } from "../life";
import { leafAtlas } from "./leafAtlas";
import type { Species, TreeLod, TreeMeshSet, TreeSource } from "./types";

/**
 * Procedural lowland-British trees, no assets. Each tree is one merged geometry: a tapering trunk, a few main
 * boughs, and a crown of alpha-tested leaf-cluster cards scattered through an irregular multi-lobe volume.
 * Card vertex normals point away from the crown centre (not along the card), so the sun and sky light the crown
 * as a rounded volume instead of as flat paper. Three detail levels per variant.
 */

interface Spec {
  species: Species;
  height: number;
  trunkH: number;
  trunkR: number;
  /** crown semi-axes (x, y, z) and centre height */
  crown: [number, number, number];
  cy: number;
  lobes: number;
  boughs: number;
  /** multi-stem: stems start at the ground and lean out to the crown */
  stems?: number;
  /** cards per LOD, card size (m) per LOD */
  cards: [number, number, number];
  size: [number, number, number];
  droop?: boolean;
  narrowLeaf?: boolean;
  leaf: number;
  bark: number;
  lean: number;
}

const RAW_SPECS: Spec[] = [
  // oak-like: short bole, wide irregular crown
  { species: "oak", height: 14, trunkH: 3.4, trunkR: 0.6, crown: [7.4, 4.6, 7.4], cy: 9.2, lobes: 5, boughs: 6, cards: [174, 39, 11], size: [3.4, 5.4, 7.4], leaf: 0x66823a, bark: 0x6e6254, lean: 0.5 },
  { species: "oak", height: 15, trunkH: 4.2, trunkR: 0.55, crown: [6.4, 5.2, 6.4], cy: 10.2, lobes: 6, boughs: 5, cards: [174, 39, 11], size: [3.4, 5.4, 7.4], leaf: 0x587a34, bark: 0x5e5347, lean: 0.8 },
  { species: "oak", height: 12.5, trunkH: 2.6, trunkR: 0.66, crown: [7.8, 4.0, 7.2], cy: 7.8, lobes: 5, boughs: 7, cards: [160, 36, 11], size: [3.4, 5.4, 7.4], leaf: 0x70863c, bark: 0x6a5e4e, lean: 0.4 },
  // lime / elm: tall, narrower, denser crown
  { species: "lime", height: 19, trunkH: 6.0, trunkR: 0.5, crown: [4.6, 6.8, 4.6], cy: 12.8, lobes: 5, boughs: 5, cards: [160, 36, 11], size: [3.2, 5.0, 7.0], leaf: 0x6f8e36, bark: 0x5b5146, lean: 0.3 },
  { species: "lime", height: 20, trunkH: 7.5, trunkR: 0.42, crown: [5.6, 6.0, 5.6], cy: 14.5, lobes: 6, boughs: 5, cards: [160, 36, 11], size: [3.2, 5.0, 7.0], leaf: 0x5f8030, bark: 0x4f453b, lean: 0.4 },
  // alder: compact, dark leaves, wet ground
  { species: "alder", height: 13, trunkH: 3.4, trunkR: 0.32, crown: [3.8, 4.6, 3.8], cy: 8.0, lobes: 4, boughs: 4, cards: [116, 31, 10], size: [2.8, 4.4, 6.0], leaf: 0x4a6330, bark: 0x3d352d, lean: 0.8 },
  { species: "alder", height: 11, trunkH: 2.4, trunkR: 0.3, crown: [4.2, 4.0, 4.2], cy: 7.0, lobes: 4, boughs: 5, cards: [116, 31, 10], size: [2.8, 4.4, 6.0], leaf: 0x55703a, bark: 0x40372e, lean: 1.0 },
  // willow: leaning bole, drooping silvery curtain
  { species: "willow", height: 12, trunkH: 2.4, trunkR: 0.5, crown: [5.8, 3.6, 5.8], cy: 8.0, lobes: 5, boughs: 6, cards: [130, 31, 10], size: [1.5, 3.0, 5.4], droop: true, narrowLeaf: true, leaf: 0x92a46a, bark: 0x58503f, lean: 1.4 },
  { species: "willow", height: 10.5, trunkH: 1.8, trunkR: 0.46, crown: [5.2, 3.2, 5.2], cy: 6.8, lobes: 4, boughs: 5, cards: [116, 29, 10], size: [1.5, 3.0, 5.2], droop: true, narrowLeaf: true, leaf: 0x8a9c62, bark: 0x5a5242, lean: 1.8 },
  // hazel / thorn: multi-stemmed scrub and hedgerow forms
  { species: "scrub", height: 5.5, trunkH: 0.4, trunkR: 0.1, crown: [2.5, 2.1, 2.5], cy: 3.3, lobes: 3, boughs: 0, stems: 5, cards: [67, 18, 7], size: [1.9, 3.0, 4.0], leaf: 0x6f8c3a, bark: 0x5e5240, lean: 0.4 },
  { species: "scrub", height: 5, trunkH: 0.5, trunkR: 0.13, crown: [2.9, 2.2, 2.9], cy: 3.0, lobes: 3, boughs: 0, stems: 4, cards: [70, 18, 7], size: [1.9, 3.0, 4.0], leaf: 0x56743a, bark: 0x3b322a, lean: 0.3 },
];

/**
 * The first generation of these trees had crowns about 7 m across for a 14 m tree and read as open scrub. Mature
 * lowland trees are broader and fuller: every dimension grows, the crowns more sideways than up, and the card count
 * grows with the crown surface so the foliage stays as dense as it was.
 */
const GROW = 1.38;
const SPECS: Spec[] = RAW_SPECS.map((s) => ({
  ...s,
  height: s.height * GROW,
  trunkH: s.trunkH * GROW,
  trunkR: s.trunkR * GROW,
  crown: [s.crown[0] * GROW * 1.12, s.crown[1] * GROW, s.crown[2] * GROW * 1.12] as [number, number, number],
  cy: s.cy * GROW,
  cards: s.cards.map((c) => Math.round(c * GROW * GROW * 1.25)) as [number, number, number],
  size: s.size.map((c) => c * 1.12) as [number, number, number],
}));

/** Index ranges of SPECS by species, for variant picking. */
export const VARIANTS: Record<Species, number[]> = { oak: [0, 1, 2], lime: [3, 4], elm: [4, 3], ash: [3], alder: [5, 6], willow: [7, 8], hazel: [9, 10], scrub: [9, 10] };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, c: THREE.Color): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Tapering tube along a polyline. */
function tube(b: Builder, pts: THREE.Vector3[], radii: number[], sides: number, tint: THREE.Color, rand: () => number) {
  const rings: number[][] = [];
  const t = new THREE.Vector3(), a = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3(), n = new THREE.Vector3();
  const col = new THREE.Color();
  for (let i = 0; i < pts.length; i++) {
    t.copy(pts[Math.min(i + 1, pts.length - 1)]).sub(pts[Math.max(i - 1, 0)]).normalize();
    a.set(0, 0, 1).cross(t);
    if (a.lengthSq() < 0.01) a.set(1, 0, 0).cross(t);
    a.normalize();
    c.copy(t).cross(a).normalize();
    const ring: number[] = [];
    const v = 0.58 + (i / (pts.length - 1)) * 0.36;
    const shade = 0.7 + 0.3 * (i / (pts.length - 1)) + (rand() - 0.5) * 0.1;
    col.copy(tint).multiplyScalar(shade);
    for (let s = 0; s <= sides; s++) {
      const ang = (s / sides) * Math.PI * 2;
      n.copy(a).multiplyScalar(Math.cos(ang)).addScaledVector(c, Math.sin(ang));
      p.copy(pts[i]).addScaledVector(n, radii[i]);
      const uu = 0.1 + Math.abs(s / sides * 2 - 1) * 0.8;
      ring.push(b.vert(p, n, uu, v, col));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++)
    for (let s = 0; s < sides; s++) {
      const a0 = rings[i][s], a1 = rings[i][s + 1], b0 = rings[i + 1][s], b1 = rings[i + 1][s + 1];
      b.idx.push(a0, b0, a1, a1, b0, b1);
    }
}

function build(spec: Spec, seed: number, lod: 0 | 1 | 2): THREE.BufferGeometry {
  const b = new Builder();
  // the same random sequence for every level, so the levels agree on the skeleton
  const rand = rng(seed * 7919 + 13);
  const bark = new THREE.Color(spec.bark).multiplyScalar(4.4);
  const leafBase = new THREE.Color(spec.leaf);
  const [rx, ry, rz] = spec.crown;
  const cyc = spec.cy;
  const bottom = cyc - ry, top = cyc + ry;
  // lobes
  const lobes: { c: THREE.Vector3; r: number }[] = [];
  for (let i = 0; i < spec.lobes; i++) {
    const ang = (i / spec.lobes) * Math.PI * 2 + rand() * 1.2;
    const rad = i === 0 ? 0 : 0.45 + rand() * 0.35;
    lobes.push({
      c: new THREE.Vector3(Math.cos(ang) * rx * rad, cyc + (rand() - 0.4) * ry * (i === 0 ? 0.5 : 0.8), Math.sin(ang) * rz * rad),
      r: i === 0 ? 0.62 : 0.4 + rand() * 0.22,
    });
  }
  // trunk (runs 1.5 m below ground, flares at the foot), leaning a little
  const leanDir = rand() * Math.PI * 2;
  const bendAt = (h: number) => (h / Math.max(1, spec.trunkH)) ** 2 * spec.lean * 0.5;
  const trunkSegs = lod === 0 ? 4 : lod === 1 ? 2 : 1;
  const sides = lod === 0 ? 7 : lod === 1 ? 5 : 4;
  const stems = spec.stems ?? 1;
  for (let sIdx = 0; sIdx < stems; sIdx++) {
    const ang = stems > 1 ? (sIdx / stems) * Math.PI * 2 + rand() : leanDir;
    const out = stems > 1 ? 0.5 + rand() * 0.4 : 0;
    const topH = stems > 1 ? spec.crown[1] * 1.7 + rand() : spec.trunkH;
    const pts: THREE.Vector3[] = [], rad: number[] = [];
    const segs = stems > 1 ? Math.max(1, trunkSegs - 1) : trunkSegs;
    for (let i = 0; i <= segs; i++) {
      const f = i / segs;
      const h = -1.5 + f * (topH + 1.5);
      const off = stems > 1 ? Math.max(0, h) * out * 0.5 : bendAt(Math.max(0, h));
      pts.push(new THREE.Vector3(Math.cos(ang) * off, h, Math.sin(ang) * off));
      rad.push(spec.trunkR * (stems > 1 ? 1 - f * 0.55 : (1 + 0.45 * Math.max(0, 1 - (h + 1.5) / 2.5)) * (1 - f * 0.28)));
    }
    tube(b, pts, rad, sides, bark, rand);
    if (stems > 1) {
      // stem tip is a crown-lobe anchor
      lobes[sIdx % lobes.length].c.x = pts[pts.length - 1].x * 0.6;
      lobes[sIdx % lobes.length].c.z = pts[pts.length - 1].z * 0.6;
    }
  }
  // boughs from the top of the trunk up into the lobes
  if (lod < 2 && spec.boughs > 0) {
    const top0 = new THREE.Vector3(Math.cos(leanDir) * bendAt(spec.trunkH), spec.trunkH, Math.sin(leanDir) * bendAt(spec.trunkH));
    const nB = lod === 0 ? spec.boughs : Math.max(3, spec.boughs - 2);
    for (let i = 0; i < nB; i++) {
      const lobe = lobes[i % lobes.length];
      const end = lobe.c.clone().multiplyScalar(0.8);
      end.y = Math.min(cyc + ry * 0.3, end.y);
      const start = top0.clone();
      start.y -= rand() * Math.min(1.2, spec.trunkH * 0.3);
      const mid = start.clone().lerp(end, 0.5);
      mid.y += 0.4 + rand() * 0.6;
      mid.x += (rand() - 0.5) * 0.8;
      mid.z += (rand() - 0.5) * 0.8;
      const r0 = spec.trunkR * (0.46 - i * 0.02);
      tube(b, lod === 0 ? [start, mid, end] : [start, end], lod === 0 ? [r0, r0 * 0.62, r0 * 0.2] : [r0, r0 * 0.3], lod === 0 ? 5 : 4, bark, rand);
    }
  }
  // crown cards
  const nCards = spec.cards[lod];
  const size = spec.size[lod];
  const cell = spec.narrowLeaf ? 0.5 : 0;
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Vector3(), d = new THREE.Vector3(), out = new THREE.Vector3(), ax = new THREE.Vector3(), sd = new THREE.Vector3(), nn = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  for (let i = 0; i < nCards; i++) {
    const lobe = lobes[Math.floor(rand() * lobes.length) % lobes.length];
    // direction within the lobe, shell-biased so the crown is hollow-ish and the silhouette leafy
    d.set(rand() - 0.5, (rand() - 0.5) * 0.9, rand() - 0.5).normalize();
    const rf = 0.45 + 0.55 * Math.sqrt(rand());
    c.set(lobe.c.x + d.x * rx * lobe.r * rf, lobe.c.y + d.y * ry * lobe.r * 1.15 * rf, lobe.c.z + d.z * rz * lobe.r * rf);
    if (c.y < bottom) c.y = bottom + (bottom - c.y) * 0.3;
    // keep inside the overall ellipsoid
    const e = Math.hypot(c.x / rx, (c.y - cyc) / ry, c.z / rz);
    if (e > 1) { c.x /= e; c.z /= e; c.y = cyc + (c.y - cyc) / e; }
    if (spec.droop) c.y -= 0.8 * Math.hypot(c.x / rx, c.z / rz) * ry;
    out.set(c.x / rx, (c.y - cyc) / ry * 0.8 + 0.1, c.z / rz).normalize();
    // card basis: free yaw, tilted anywhere between horizontal and vertical (crossed clusters)
    const yaw = rand() * Math.PI * 2, tilt = (rand() - 0.5) * 1.5;
    if (spec.droop) {
      ax.set(Math.cos(yaw) * 0.25, -1, Math.sin(yaw) * 0.25).normalize();
    } else {
      ax.set(Math.cos(yaw) * Math.cos(tilt), Math.sin(tilt), Math.sin(yaw) * Math.cos(tilt)).normalize();
    }
    sd.crossVectors(ax, up);
    if (sd.lengthSq() < 0.02) sd.set(1, 0, 0);
    sd.normalize();
    nn.crossVectors(sd, ax).normalize();
    // spread the cluster along its axes, a little irregular
    const w = size * (0.8 + rand() * 0.4) * (spec.droop ? 0.4 : 1) * 0.5;
    const h = size * (0.8 + rand() * 0.4) * (spec.droop ? 1.0 : 1) * 0.5;
    const hy = THREE.MathUtils.clamp((c.y - bottom) / (top - bottom), 0, 1);
    const depth = THREE.MathUtils.clamp(e, 0.35, 1);
    const shade = (0.5 + 0.5 * hy) * (0.55 + 0.45 * depth) * (0.88 + rand() * 0.24);
    col.copy(leafBase).multiplyScalar(shade * 1.55);
    // slightly yellower sunlit tops
    col.r *= 0.9 + 0.2 * hy;
    const flip = rand() < 0.5;
    const rot = rand() * 0.8 - 0.4;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const base = b.pos.length / 3;
    for (let k = 0; k < 4; k++) {
      const su = k % 2 === 0 ? -1 : 1, sv = k < 2 ? -1 : 1;
      const px = su * w * cr, py = sv * h;
      p.copy(c).addScaledVector(sd, px).addScaledVector(ax, py);
      // normal: outward from the crown centre, perturbed per corner, plus a little of the card's own facing
      const jn = 0.22;
      nn.set(out.x + (rand() - 0.5) * jn, out.y + (rand() - 0.5) * jn, out.z + (rand() - 0.5) * jn).normalize();
      const uu = 0.04 + (su < 0 ? 0 : 0.92), vv = 0.04 + (sv < 0 ? 0 : 0.92);
      b.vert(p, nn, cell + (flip ? 0.5 - uu * 0.5 : uu * 0.5), vv * 0.5, col);
    }
    b.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  return b.geometry();
}

let shared: { mat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial } | null = null;

function materials() {
  if (shared) return shared;
  const map = leafAtlas();
  const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.42, roughness: 0.92, metalness: 0 });
  // Two-sided cards keep the same (outward-bent) vertex normal on both faces, so the crown lights as a volume.
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;", "float faceDirection = 1.0;");
  };
  patchLife(mat, { tint: false });
  mat.customProgramCacheKey = () => "life0-vegcards";
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.onBeforeCompile = (shader) => {
    shader.uniforms.uYear = lifeUniforms.uYear;
    shader.vertexShader =
      "attribute vec4 aLife;\nuniform float uYear;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         float lifeS = smoothstep(aLife.x, aLife.y, uYear) * (1.0 - smoothstep(aLife.z, aLife.w, uYear));
         transformed.y *= lifeS;
         if (lifeS < 0.004) transformed *= 0.0;`,
      );
  };
  depth.customProgramCacheKey = () => "vegDepth";
  shared = { mat, depth };
  return shared;
}

/** Near / mid / far switch distances (m): full cards, reduced cards, a handful of big cards. */
export const LOD_DIST: [number, number] = [170, 520];

/** The procedural trees as a source (one TreeMeshSet per variant), built once at start-up. */
export function buildProceduralSource(): TreeSource {
  const { mat, depth } = materials();
  const sets: TreeMeshSet[] = SPECS.map((spec, i) => {
    const lods: TreeLod[] = ([0, 1, 2] as const).map((l) => ({
      parts: [{ geometry: build(spec, i + 1, l), material: mat, depthMaterial: depth, castShadow: true, leaf: true }],
      maxDist: l === 0 ? LOD_DIST[0] : l === 1 ? LOD_DIST[1] : Infinity,
    }));
    return { id: `${spec.species}${i}`, height: spec.height, maxScale: 1.6, lods };
  });
  return { name: "procedural", sets, variants: VARIANTS };
}
