import * as THREE from "three";

/**
 * One parametric vessel model, driven entirely by a catalogue entry's `model` (data/locations/<id>/vessels.json;
 * the parameters are listed in docs/VESSELS.md). Local frame: +x = bow, +y up, +z = starboard, y = 0 the waterline.
 * Everything is emitted through a Sink, so the same model feeds the static landmark builder (named materials) and
 * the instanced moving craft (vertex colours). Nothing here knows a date: what is drawn is what the type describes.
 */

/** Undyed linen or wool for sails and awnings. */
export const SAIL = "daub";

export interface Sink {
  add(mat: string, g: THREE.BufferGeometry, m: THREE.Matrix4): void;
}

/** moored/beached: sails furled, oars shipped; underway: sails set (sailing types) or oars out with crew; rowing: oars out, sail furled, crew. */
export type VesselState = "moored" | "beached" | "underway" | "rowing";

export interface MastSpec { at: number; h: number; rig: "square" | "lateen" | "brailed" | string; yard: number; top?: boolean }

/** Typed view of a catalogue `model`, with defaults filled in. */
export interface VesselModel {
  hull: "logboat" | "flat" | "round" | "double" | "cog";
  build: "logboat" | "romano-celtic" | "carvel" | "clinker" | "plain";
  len: number; beam: number; depth: number; sheer: number; bow: number; stern: number;
  transom: boolean; posts: number;
  masts: MastSpec[];
  rudder: "none" | "oar" | "side" | "stern" | "quarter-pair";
  castles: { fore?: [number, number]; aft?: [number, number] };
  foreOverhang: number; beakhead: number; gunports: number;
  oars: number; sweeps: boolean; seats: boolean;
  deck: boolean; tilt: boolean; cabin: [number, number] | null;
  cargo: string; hullMat: string; trim: string | null;
  passesBridge: boolean; draft: number; crew: number;
}

const num = (v: unknown, d: number): number => (typeof v === "number" && isFinite(v) ? v : d);
const str = (v: unknown, d: string): string => (typeof v === "string" ? v : d);
const pair = (v: unknown): [number, number] | undefined =>
  Array.isArray(v) && v.length >= 2 && typeof v[0] === "number" && typeof v[1] === "number" ? [v[0], v[1]] : undefined;

export function readModel(m: Record<string, unknown>): VesselModel {
  const len = Math.max(2, num(m.len, 6));
  const beam = Math.max(0.6, num(m.beam, len / 4));
  const depth = Math.max(0.3, num(m.depth, beam / 3));
  const c = (m.castles ?? {}) as Record<string, unknown>;
  const masts = Array.isArray(m.masts)
    ? (m.masts as Record<string, unknown>[]).map((s) => ({ at: num(s.at, 0.5), h: num(s.h, len * 0.6), rig: str(s.rig, "square"), yard: num(s.yard, beam * 1.5), top: !!s.top }))
    : [];
  const hull = str(m.hull, "double") as VesselModel["hull"];
  return {
    hull, build: str(m.build, "clinker") as VesselModel["build"],
    len, beam, depth, sheer: num(m.sheer, depth * 0.4), bow: num(m.bow, 0.5), stern: num(m.stern, 0.5),
    transom: !!m.transom, posts: num(m.posts, 0),
    masts, rudder: str(m.rudder, "none") as VesselModel["rudder"],
    castles: { fore: pair(c.fore), aft: pair(c.aft) },
    foreOverhang: num(m.foreOverhang, 0), beakhead: num(m.beakhead, 0), gunports: num(m.gunports, 0),
    oars: Math.max(0, Math.round(num(m.oars, 0))), sweeps: !!m.sweeps, seats: !!m.seats,
    deck: !!m.deck, tilt: !!m.tilt, cabin: pair(m.cabin) ?? null,
    cargo: str(m.cargo, "none"), hullMat: str(m.hullMat, "timber"), trim: typeof m.trim === "string" ? m.trim : null,
    passesBridge: m.passesBridge !== false, draft: num(m.draft, depth * 0.5), crew: Math.max(0, Math.round(num(m.crew, 1))),
  };
}

/** Section profiles (half-section, from the keel up): [across 0..1 of the half-beam, up 0..1 of the side]. */
const SECTIONS: Record<VesselModel["hull"], [number, number][]> = {
  logboat: [[0, 0], [0.55, 0.04], [0.86, 0.3], [0.98, 0.7], [1, 1]],
  flat: [[0, 0], [0.82, 0], [0.95, 0.1], [1.0, 0.38], [1.03, 0.7], [1.05, 1]],
  round: [[0, 0], [0.32, 0.05], [0.68, 0.18], [0.93, 0.42], [1.0, 0.68], [0.97, 0.86], [0.92, 1]],
  double: [[0, 0], [0.28, 0.1], [0.6, 0.27], [0.84, 0.48], [0.97, 0.7], [1.04, 1]],
  cog: [[0, 0], [0.84, 0], [0.96, 0.1], [1.0, 0.32], [1.0, 0.62], [0.99, 1]],
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Hull lines: half-beam, gunwale and keel heights along the length (s = 0 stern .. 1 bow). */
export class Lines {
  readonly keel: number; // keel depth below the waterline (positive)
  readonly gun: number; // gunwale height amidships above the waterline
  constructor(readonly p: VesselModel) {
    const big = p.deck && p.len > 12;
    // freeboard: decked sea-going hulls stand higher out of the water than their hold depth alone suggests
    this.keel = Math.min(p.draft, p.depth * (big ? 0.5 : 0.62));
    this.gun = p.depth - this.keel;
  }
  /** Width fraction kept at the very ends (transoms, logboat ends, raked barge ends). */
  private endW(bow: boolean): number {
    const p = this.p;
    if (p.hull === "logboat") return bow ? 0.25 : 0.55;
    if (p.hull === "flat") return bow ? 0.3 : 0.38;
    if (!bow && p.transom) return 0.62;
    return 0;
  }
  half(s: number): number {
    const p = this.p;
    const bow = s > 0.5;
    const u = Math.abs(2 * s - 1);
    const f = bow ? p.bow : p.stern;
    const sh = Math.pow(Math.max(0, 1 - Math.pow(u, 1.5 + 5 * f)), 0.6);
    const e = this.endW(bow);
    return (p.beam / 2) * Math.max(sh, e * (0.7 + 0.3 * u));
  }
  top(s: number): number {
    const u = Math.abs(2 * s - 1);
    return this.gun + this.p.sheer * u * u * (s > 0.5 ? 1.15 : 1);
  }
  bot(s: number): number {
    const p = this.p;
    const u = Math.abs(2 * s - 1);
    const k = -this.keel;
    switch (p.hull) {
      case "double": return k + (this.keel + this.gun * 0.55) * Math.pow(u, 4);
      case "round": return k + this.keel * 1.05 * Math.pow(u, 5);
      case "flat": return k + (this.keel + 0.35 * this.gun) * smooth(0.72, 1, u);
      case "cog": return k + (this.keel + this.gun * 0.7) * clamp01((u - 0.78) / 0.22);
      default: return k + this.keel * 0.55 * Math.pow(u, 6);
    }
  }
  x(s: number): number {
    return (s - 0.5) * this.p.len;
  }
}

type V3 = [number, number, number];

/** Emits one vessel. `base` places it in the sink's frame. Returns the triangle count emitted. */
export function buildVessel(sink: Sink, raw: VesselModel, state: VesselState, base: THREE.Matrix4, tileOf: (m: string) => number = () => 2): number {
  const p = raw;
  const L = new Lines(p);
  let tris = 0;
  const put = (mat: string, g: THREE.BufferGeometry, local?: THREE.Matrix4): void => {
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    sink.add(mat, g, local ? base.clone().multiply(local) : base.clone());
  };
  const S = p.len / 20; // a size scale for fittings
  const sm = Math.max(0.6, Math.min(1.6, S));

  // ---------------------------------------------------------------- hull
  const N = p.len > 12 ? 16 : p.len > 9 ? 10 : 7;
  const prof = SECTIONS[p.hull] ?? SECTIONS.double;
  const R = prof.length;
  const clinker = p.build === "clinker";
  const lap = clinker ? Math.max(0.018, p.beam * 0.006) : 0;
  const firstLap = p.hull === "cog" || p.hull === "flat" ? 2 : 1; // flush bottoms on cogs and flat barges
  const station = (i: number): { s: number; x: number; hb: number; yt: number; yb: number } => {
    const s = i / N;
    return { s, x: L.x(s), hb: L.half(s), yt: L.top(s), yb: L.bot(s) };
  };
  const st = Array.from({ length: N + 1 }, (_, i) => station(i));
  const hullTile = tileOf(p.hullMat);
  const strip = (r0: number, r1: number, sd: number, lapped: boolean): void => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= N; i++) {
      const s = st[i];
      for (const [r, out] of [[r0, lapped ? lap : 0], [r1, 0]] as [number, number][]) {
        const [zn, yn] = prof[r];
        const z = sd * (zn * s.hb + (s.hb > 0.02 ? out : 0));
        const y = s.yb + yn * (s.yt - s.yb);
        pos.push(s.x, y, z);
        uv.push(s.x / hullTile, (y + Math.abs(z) * 0.5) / hullTile);
      }
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = a + 2, c = a + 3, d = a + 1;
      if (sd > 0) idx.push(a, b, c, a, c, d);
      else idx.push(a, c, b, a, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    put(p.hullMat, g);
  };
  for (const sd of [1, -1]) {
    if (clinker) {
      // the flush bottom as one strip, then one strip per strake, each lapping outside the one below
      if (firstLap > 0) for (let r = 0; r < firstLap; r++) strip(r, r + 1, sd, false);
      for (let r = firstLap; r < R - 1; r++) strip(r, r + 1, sd, r > firstLap - 1 && r > 0);
    } else {
      for (let r = 0; r < R - 1; r++) strip(r, r + 1, sd, false);
    }
  }
  // end caps where the hull keeps width (transom, logboat ends, raked barge ends)
  for (const i of [0, N]) {
    const s = st[i];
    if (s.hb < 0.05) continue;
    const pos: number[] = [];
    const ring: V3[] = [];
    for (let r = R - 1; r >= 0; r--) ring.push([s.x, s.yb + prof[r][1] * (s.yt - s.yb), prof[r][0] * s.hb]);
    for (let r = 0; r < R; r++) ring.push([s.x, s.yb + prof[r][1] * (s.yt - s.yb), -prof[r][0] * s.hb]);
    for (let k = 1; k < ring.length - 1; k++) {
      const a = ring[0], b = ring[k], c = ring[k + 1];
      if (i === 0) pos.push(...a, ...c, ...b); else pos.push(...a, ...b, ...c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    put(p.hullMat, g);
  }
  // gunwale cap rail (reads as the sheer line at a distance)
  {
    const pos: number[] = [];
    const w = Math.max(0.05, 0.035 * p.beam);
    for (const sd of [1, -1])
      for (let i = 0; i < N; i++) {
        const a = st[i], b = st[i + 1];
        const za = sd * a.hb * prof[R - 1][0], zb = sd * b.hb * prof[R - 1][0];
        const A: V3 = [a.x, a.yt + 0.04, za], B: V3 = [b.x, b.yt + 0.04, zb];
        const C: V3 = [b.x, b.yt + 0.04, zb - sd * w], D: V3 = [a.x, a.yt + 0.04, za - sd * w];
        if (sd > 0) pos.push(...A, ...C, ...B, ...A, ...D, ...C); else pos.push(...A, ...B, ...C, ...A, ...C, ...D);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    put("timber", g);
  }
  // floor (open boats) or deck (decked hulls)
  {
    const yFor = (s: { yb: number; yt: number }): number => (p.deck ? s.yt - Math.max(0.3, 0.12 * p.depth) : s.yb + 0.3 * (s.yt - s.yb));
    const wFor = (s: { hb: number }): number => (p.deck ? 0.97 : 0.62) * s.hb;
    const pos: number[] = [], uv: number[] = [];
    const t = tileOf(p.deck ? "planks" : "dark");
    for (let i = 0; i < N; i++) {
      const a = st[i], b = st[i + 1];
      const ya = yFor(a), yb = yFor(b), wa = wFor(a), wb = wFor(b);
      pos.push(a.x, ya, -wa, a.x, ya, wa, b.x, yb, wb, a.x, ya, -wa, b.x, yb, wb, b.x, yb, -wb);
      uv.push(a.x / t, -wa / t, a.x / t, wa / t, b.x / t, wb / t, a.x / t, -wa / t, b.x / t, wb / t, b.x / t, -wb / t);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    put(p.deck ? "planks" : "dark", g);
  }

  // ---------------------------------------------------------------- helpers
  const box = (mat: string, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rz = 0): void => {
    const g = new THREE.BoxGeometry(w, h, d);
    const t = tileOf(mat);
    const uvA = g.attributes.uv as THREE.BufferAttribute;
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const k = f * 4 + v; uvA.setXY(k, (uvA.getX(k) * dims[f][0]) / t, (uvA.getY(k) * dims[f][1]) / t); }
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, ry, rz, "YXZ")).setPosition(x, y + h / 2, z);
    put(mat, g, m);
  };
  const bar = (mat: string, a: V3, b: V3, t: number, sides = 4): void => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const l = A.distanceTo(B);
    if (l < 0.01) return;
    const g = sides === 4 ? new THREE.BoxGeometry(t, l, t) : new THREE.CylinderGeometry(t / 2, t / 2, l, sides, 1, true);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    put(mat, g, new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  };
  const sAt = (x: number): number => clamp01(x / p.len + 0.5);
  const deckY = (s: number): number => (p.deck ? L.top(s) - Math.max(0.3, 0.12 * p.depth) : L.bot(s) + 0.3 * (L.top(s) - L.bot(s)));

  // ---------------------------------------------------------------- posts (stem and stern rising above the sheer)
  if (p.posts > 0 && p.hull === "double") {
    for (const bow of [true, false]) {
      const sg = bow ? 1 : -1;
      const x0 = sg * p.len * 0.5, y0 = L.top(bow ? 1 : 0);
      const pts: V3[] = [[x0 - sg * 0.6, y0 - 0.5, 0], [x0, y0, 0], [x0 + sg * 0.25, y0 + p.posts * 0.6, 0], [x0 + sg * 0.05, y0 + p.posts, 0]];
      for (let k = 1; k < pts.length; k++) bar("timber-weathered", pts[k - 1], pts[k], 0.22 * sm);
    }
  }

  // ---------------------------------------------------------------- castles, beakhead, gunports, cabin, tilt
  /** A castle: a planked lower stage with a deck, and an open rail of posts above it (not a solid block). */
  const castle = (xc: number, l: number, h: number, w: number, y: number): void => {
    const solid = h * 0.68;
    box("oak", l, solid, w, xc, y, 0); // castle sides read lighter than the tarred hull (finish not attested)
    box("planks", l - 0.1, 0.08, w - 0.1, xc, y + solid, 0);
    const posts = Math.max(2, Math.round(l / 1.6));
    for (const sd of [1, -1]) for (let k = 0; k <= posts; k++) box("timber", 0.14, h - solid, 0.14, xc - l / 2 + (k * l) / posts, y + solid, sd * (w / 2 - 0.07));
    for (const sd of [1, -1]) box("timber", l + 0.1, 0.14, 0.18, xc, y + h - 0.14, sd * (w / 2 - 0.07));
    for (const sx of [1, -1]) box("timber", 0.18, 0.14, w, xc + sx * (l / 2 - 0.05), y + h - 0.14, 0);
  };
  const { fore, aft } = p.castles;
  if (aft) {
    const [l, h] = aft;
    const s = sAt(-p.len / 2 + l / 2 + 0.3);
    const w = 2 * Math.max(L.half(s), p.beam * 0.3) * 0.98;
    const y = L.top(s) - 0.15;
    castle(-p.len / 2 + l / 2 + 0.2, l, h, w, y);
    if (h > 3) castle(-p.len / 2 + l * 0.3, l * 0.55, h * 0.42, w * 0.88, y + h); // a second, higher tier (poop)
  }
  if (fore) {
    const [l, h] = fore;
    const xc = p.len / 2 - l / 2 - 0.4 + p.foreOverhang * 0.5;
    const s = sAt(xc);
    const w = 2 * Math.max(L.half(s), p.beam * 0.32) * 0.98;
    const y = L.top(Math.min(1, s)) - 0.2;
    castle(xc, l + p.foreOverhang, h, w, y);
  }
  if (p.beakhead > 0) {
    const y = L.top(1) - 0.9;
    box(p.hullMat, p.beakhead, 0.5, 0.9, p.len / 2 + p.beakhead / 2 - 0.2, y, 0, 0, 0.12);
    bar("timber", [p.len / 2, y + 1.4, 0], [p.len / 2 + p.beakhead * 2.2, y + 3.6, 0], 0.22 * sm, 6); // bowsprit
  }
  if (p.gunports > 0) {
    const yPort = L.gun - 0.75;
    for (let k = 0; k < p.gunports; k++) {
      const x = -p.len * 0.28 + (k * p.len * 0.56) / Math.max(1, p.gunports - 1);
      const hb = L.half(sAt(x)) * 0.995;
      for (const sd of [1, -1]) box("dark", 0.55, 0.5, 0.06, x, yPort, sd * hb);
    }
  }
  if (p.cabin) {
    const [l, h] = p.cabin;
    const x = -p.len / 2 + l / 2 + p.len * 0.08;
    const s = sAt(x);
    const w = L.half(s) * 1.6;
    const y = deckY(s);
    const trim = p.trim ?? p.hullMat;
    box(trim, l, h * 0.6, w, x, y, 0);
    const roof = new THREE.CylinderGeometry(w / 2, w / 2, l, 8, 1, true, 0, Math.PI);
    roof.rotateZ(Math.PI / 2); // axis along the hull, arc upwards
    put(trim, roof, new THREE.Matrix4().makeRotationY(0).setPosition(x, y + h * 0.6, 0));
    box("gold", l + 0.1, 0.12, w + 0.1, x, y + h * 0.6, 0);
    // painted strake along the sheer
    for (const sd of [1, -1]) box(trim, p.len * 0.8, 0.22, 0.05, 0, L.gun - 0.2, sd * (p.beam / 2) * 0.99);
  }
  if (p.tilt) {
    const x0 = -p.len * 0.42, x1 = p.len * 0.05;
    const s = sAt((x0 + x1) / 2);
    const r = L.half(s) * 0.95;
    const g = new THREE.CylinderGeometry(r, r, x1 - x0, 8, 1, true, 0, Math.PI);
    g.rotateZ(Math.PI / 2); // axis along the hull, arc upwards
    put(SAIL, g, new THREE.Matrix4().setPosition((x0 + x1) / 2, L.top(s) + 0.15, 0));
    for (const x of [x0, (x0 + x1) / 2, x1]) for (const sd of [1, -1]) box("timber", 0.06, 0.2, 0.06, x, L.top(sAt(x)), sd * r * 0.98);
  }

  // ---------------------------------------------------------------- thwarts, seats
  const open = !p.deck;
  if (open && p.hull !== "logboat") {
    const n = Math.max(1, Math.min(8, p.oars > 0 ? p.oars : Math.round(p.len / 3.5)));
    for (let k = 0; k < n; k++) {
      const x = -p.len * 0.3 + ((k + 0.5) * p.len * 0.6) / n;
      const s = sAt(x);
      box("timber", 0.22 * sm, 0.06, L.half(s) * 1.85, x, L.top(s) - 0.28, 0);
    }
    if (p.seats) box("timber", p.len * 0.14, 0.3, L.half(0.2) * 1.4, -p.len * 0.3, L.top(0.2) - 0.42, 0); // stern sheets for passengers
  } else if (p.hull === "logboat") {
    for (const x of [-p.len * 0.25, 0, p.len * 0.25]) box(p.hullMat, 0.12, (L.gun + L.keel) * 0.55, L.half(sAt(x)) * 1.7, x, -L.keel + 0.05, 0); // carved ribs
  }

  // ---------------------------------------------------------------- cargo
  if (p.cargo !== "none" && open) {
    const x0 = -p.len * 0.18, x1 = p.len * 0.12;
    const s = sAt((x0 + x1) / 2);
    const fl = deckY(s);
    const hw = L.half(s) * 0.5;
    if (p.cargo === "ragstone") {
      for (let k = 0; k < 9; k++) box("ragstone", 0.9 * sm, 0.55 * sm, 0.8 * sm, x0 + ((k % 3) + 0.5) * (x1 - x0) / 3, fl + Math.floor(k / 3) * 0.3, (((k * 7) % 3) - 1) * hw * 0.8, k * 0.7);
    } else if (p.cargo === "barrels") {
      for (let k = 0; k < 6; k++) put("oak", new THREE.CylinderGeometry(0.32, 0.32, 0.85, 7), new THREE.Matrix4().setPosition(x0 + ((k % 3) + 0.5) * (x1 - x0) / 3, fl + 0.42, (k < 3 ? -1 : 1) * hw * 0.55));
    } else if (p.cargo === "bales") {
      for (let k = 0; k < 5; k++) box("daub", 1.1, 0.6, 0.8, x0 + (k + 0.5) * (x1 - x0) / 5, fl, ((k % 2) - 0.5) * hw * 0.7, k * 0.3);
    } else if (p.cargo === "amphorae") {
      for (let k = 0; k < 8; k++) put("tegula", new THREE.CylinderGeometry(0.12, 0.2, 0.75, 6), new THREE.Matrix4().setPosition(x0 + ((k % 4) + 0.5) * (x1 - x0) / 4, fl + 0.37, (k < 4 ? -1 : 1) * hw * 0.5));
    }
  }

  // ---------------------------------------------------------------- masts, spars, sails, rigging
  const sailSet = state === "underway";
  for (const ms of p.masts) {
    const x = (ms.at - 0.5) * p.len;
    const s = sAt(x);
    const foot = L.bot(s) + 0.2;
    const topY = L.top(s) + ms.h;
    const r = Math.max(0.09, 0.012 * ms.h);
    put("timber", new THREE.CylinderGeometry(r * 0.65, r, topY - foot, 6, 1, true), new THREE.Matrix4().setPosition(x, (foot + topY) / 2, 0));
    // standing rigging: two shrouds a side and a forestay
    const hb = L.half(s);
    for (const sd of [1, -1]) for (const dx of [-0.4, -1.3]) bar("timber-weathered", [x, topY - 0.3, 0], [x + dx * sm, L.top(sAt(x + dx * sm)), sd * hb], 0.05, 4);
    const fs = Math.min(p.len / 2 + (p.beakhead ? p.beakhead : 0), x + ms.h * 0.9);
    bar("timber-weathered", [x, topY - 0.3, 0], [fs, L.top(sAt(Math.min(fs, p.len / 2))) + 0.2, 0], 0.05, 4);
    if (ms.top) {
      put("timber", new THREE.CylinderGeometry(0.9 * sm, 0.6 * sm, 0.6, 8), new THREE.Matrix4().setPosition(x, topY - 0.9, 0));
      put("timber", new THREE.CylinderGeometry(r * 0.4, r * 0.55, ms.h * 0.4, 5, 1, true), new THREE.Matrix4().setPosition(x, topY + ms.h * 0.18, 0));
      // topsail yard with its sail furled
      const ty = topY + ms.h * 0.3;
      bar("timber", [x, ty, -ms.yard * 0.33], [x, ty, ms.yard * 0.33], 0.16 * sm, 5);
      bar(SAIL, [x + 0.12, ty - 0.12, -ms.yard * 0.3], [x + 0.12, ty - 0.12, ms.yard * 0.3], 0.3 * sm, 6);
    }
    if (ms.rig === "square" && ms.yard > 0) {
      const yy = topY - (ms.top ? 1.6 : 0.6) - (sailSet ? 0 : 0.2);
      bar("timber", [x + 0.2, yy, -ms.yard / 2], [x + 0.2, yy, ms.yard / 2], Math.max(0.12, 0.016 * ms.yard), 6);
      if (sailSet) {
        const H = Math.min(ms.h * 0.72, yy - L.top(s) - 0.8);
        squareSail(put, x + 0.32, yy - 0.1, ms.yard * 0.94, H, H * 0.14);
      } else {
        bar(SAIL, [x + 0.38, yy - 0.18, -ms.yard * 0.46], [x + 0.38, yy - 0.18, ms.yard * 0.46], Math.max(0.28, 0.035 * ms.yard), 6);
      }
    } else if (ms.rig === "lateen" && ms.yard > 0) {
      // a long yard slung obliquely, its lower end forward
      const lo: V3 = [x + ms.yard * 0.38, L.top(s) + ms.h * 0.35, 0.25];
      const hi: V3 = [x - ms.yard * 0.62, topY + ms.h * 0.28, 0.25];
      bar("timber", lo, hi, Math.max(0.1, 0.013 * ms.yard), 6);
      if (sailSet) lateenSail(put, lo, hi, [x - ms.yard * 0.55, L.top(s) + 1.2, 0.3]);
      else bar(SAIL, [lo[0] - 0.4, lo[1] - 0.25, 0.4], [hi[0] + 0.6, hi[1] - 0.35, 0.4], Math.max(0.22, 0.03 * ms.yard), 6);
    } else if (ms.rig === "brailed") {
      bar(SAIL, [x - 0.35, L.top(s) + 1.0, 0], [x - 0.3, topY - 0.8, 0], 0.45 * sm, 6);
      bar("timber", [x, L.top(s) + 1.6, 0], [x - ms.h * 0.55, topY - 0.6, 0], 0.12 * sm, 5); // sprit (or gaff): form not verified
    }
  }

  // ---------------------------------------------------------------- steering
  const stern = -p.len / 2;
  const sternTop = L.top(0);
  if (p.rudder === "stern") {
    const ch = Math.max(0.4, 0.06 * p.len);
    const y0 = Math.max(L.bot(0.02), -L.keel) - 0.15;
    box(p.hullMat, ch, sternTop - y0 + 0.2, 0.14 * sm, stern - ch / 2 + (p.transom ? 0 : 0.1), y0, 0);
    bar("timber", [stern + 0.1, sternTop + 0.35, 0], [stern + Math.min(3, p.len * 0.14), sternTop + 0.35, 0], 0.1 * sm, 4); // tiller
  } else if (p.rudder === "side" || p.rudder === "quarter-pair") {
    const x = stern + p.len * 0.09;
    const sides = p.rudder === "side" ? [1] : [1, -1];
    for (const sd of sides) {
      const hb = L.half(sAt(x));
      const len = L.keel + L.top(sAt(x)) + 0.6;
      const ch = Math.max(0.3, 0.025 * p.len);
      // blade hung outside the starboard quarter, raked a little aft
      const g = new THREE.BoxGeometry(ch, len, 0.1 * sm);
      put(p.hullMat, g, new THREE.Matrix4().makeRotationZ(0.18).setPosition(x - 0.15, L.top(sAt(x)) + 0.4 - len / 2, sd * (hb + 0.12)));
      bar("timber", [x, L.top(sAt(x)) + 0.6, sd * (hb + 0.1)], [x + 0.2, L.top(sAt(x)) + 0.65, sd * (hb - 1.2 * sm)], 0.09 * sm, 4); // tiller athwartships
    }
  } else if (p.rudder === "oar") {
    const x = stern + p.len * 0.08;
    const hb = L.half(sAt(x));
    const a: V3 = [x + 1.2 * sm, L.top(sAt(x)) + 1.0, hb * 0.6];
    const b: V3 = [stern - 1.2 * sm, -L.keel * 0.8, hb + 0.6];
    bar("timber", a, b, 0.14 * sm, 5);
    box(p.hullMat, 1.4 * sm, 0.5 * sm, 0.08, b[0] + 0.5, b[1] - 0.2, b[2], 0, 0.5);
  }

  // ---------------------------------------------------------------- oars and crew
  const oarsOut = state === "underway" || state === "rowing";
  const sailing = sailSet && p.masts.length > 0 && p.masts.some((m) => m.rig !== "none");
  if (oarsOut && !sailing && (p.oars > 0 || p.sweeps)) {
    const n = p.sweeps ? 1 : p.oars;
    const olen = Math.max(2.6, p.beam * 0.55 + 2.0) * (p.sweeps ? 1.8 : 1);
    for (let k = 0; k < n; k++) {
      const x = n === 1 ? (p.sweeps ? p.len * 0.25 : -p.len * 0.05) : -p.len * 0.32 + ((k + 0.5) * p.len * 0.64) / n;
      const s = sAt(x);
      const hb = L.half(s);
      for (const sd of [1, -1]) {
        const a: V3 = [x + 0.5, L.top(s) + 0.25, -sd * hb * 0.5];
        const b: V3 = [x - 0.9, -0.15, sd * (hb + olen * 0.8)];
        if (n > 6) bar("timber", a, b, 0.08, 3); // many oars: thin prisms, no blades
        else {
          bar("timber", a, b, 0.07, 4);
          box("timber", 0.55, 0.04, 0.16, b[0], b[1], b[2], 0, 0);
        }
      }
    }
  }
  if (oarsOut) {
    const crew = Math.min(p.crew, state === "rowing" ? Math.min(16, Math.max(2, p.oars * 2)) : p.oars > 0 ? Math.min(4, p.oars * 2) : 2);
    for (let k = 0; k < crew; k++) {
      let x: number, z: number;
      if (p.oars > 0 && state === "rowing") {
        const per = Math.max(1, p.oars);
        const i = Math.min(per - 1, Math.floor((Math.floor(k / 2) * per) / Math.ceil(crew / 2)));
        x = -p.len * 0.32 + ((i + 0.5) * p.len * 0.64) / per;
        z = (k % 2 ? -1 : 1) * L.half(sAt(x)) * 0.45;
      } else {
        x = k === 0 ? -p.len * 0.05 : -p.len * 0.32 + k * 0.6;
        z = k === 0 ? 0 : 0.25;
      }
      const s = sAt(x);
      const fy = deckY(s);
      box("flat:#4a3d30", 0.36, 0.62, 0.3, x, fy, z);
      put("flat:#9a7a62", new THREE.OctahedronGeometry(0.13, 0), new THREE.Matrix4().setPosition(x, fy + 0.76, z));
    }
  }
  return Math.round(tris);
}

/** A square sail hanging from its yard, cut in vertical cloths (seams read as facets) and bellied forward. */
function squareSail(put: (mat: string, g: THREE.BufferGeometry, m?: THREE.Matrix4) => void, x: number, y: number, W: number, H: number, belly: number): void {
  const cols = 5, rows = 3;
  const pt = (i: number, j: number): V3 => {
    const u = i / cols, v = j / rows;
    const bul = Math.sin(Math.PI * u) * Math.sin(Math.PI * (0.15 + 0.75 * v));
    return [x + belly * bul, y - v * H, (u - 0.5) * W * (1 - 0.06 * v)];
  };
  const pos: number[] = [];
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  put(SAIL, g);
}

/** A triangular lateen sail between the yard and a clew aft, bellied a little to leeward. */
function lateenSail(put: (mat: string, g: THREE.BufferGeometry, m?: THREE.Matrix4) => void, lo: V3, hi: V3, clew: V3): void {
  const pos: number[] = [];
  const n = 3;
  const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (let k = 0; k < n; k++) {
    const a = lerp(lo, hi, k / n), b = lerp(lo, hi, (k + 1) / n);
    const c: V3 = [clew[0], clew[1], clew[2] + 0.5 * Math.sin((Math.PI * (k + 0.5)) / n)];
    pos.push(...a, ...b, ...c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  put(SAIL, g);
}
