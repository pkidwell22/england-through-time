import { hash2, rng } from "@/lib/geo";
import type { StreetStyle } from "../houses";
import { distToPolyline, type Street } from "./network";

/**
 * Plots along streets. Each street side is cut into 24 m lots (the same lots for every style, so zones that
 * share a street by `band` claim whole lots and never overlap); a lot is divided into house plots of the
 * style's widths, filled exactly so party walls touch. Each plot carries one house facing the street, its
 * ground-storey front on the street edge (jetties overhang the street), scaled along the frontage to fit.
 * Plots are claimed street by street in order of rank (principal and market streets first), and a plot is
 * dropped when it would overlap an earlier one or stand in another street, so junctions clear themselves
 * and the corner house of the more important street turns the corner with its free side wall.
 */

export const LOT = 24;

export interface Candidate {
  /** House origin (centre of the main block), local metres. */
  x: number;
  z: number;
  /** Rotation about y (house +z faces the street). */
  rot: number;
  /** Scale along the frontage. */
  sx: number;
  variant: number;
  /** Plot width (m). */
  w: number;
  /** Hash of the 24 m lot (shared by all styles) and of the plot. */
  lotHash: number;
  plotHash: number;
  street: Street;
  /** A rear tenement standing behind the street house across a yard. */
  rear?: boolean;
  /** Footprint corners (plot width x house depth incl. rear range). */
  rect: [number, number][];
}

type Quad = [number, number][];

function project(q: Quad, ax: number, az: number): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const [x, z] of q) {
    const v = x * ax + z * az;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

/** Separating-axis overlap test for two convex quads (with a small tolerance so touching walls pass). */
function overlaps(a: Quad, b: Quad): boolean {
  for (const q of [a, b])
    for (let i = 0; i < q.length; i++) {
      const [x0, z0] = q[i], [x1, z1] = q[(i + 1) % q.length];
      const ax = -(z1 - z0), az = x1 - x0;
      const l = Math.hypot(ax, az) || 1;
      const [a0, a1] = project(a, ax / l, az / l), [b0, b1] = project(b, ax / l, az / l);
      if (a1 <= b0 + 0.15 || b1 <= a0 + 0.15) return false;
    }
  return true;
}

class Grid {
  private cells = new Map<string, Quad[]>();
  private key(x: number, z: number) { return `${Math.floor(x / 30)},${Math.floor(z / 30)}`; }
  private keys(q: Quad): string[] {
    const xs = q.map((p) => p[0]), zs = q.map((p) => p[1]);
    const out: string[] = [];
    for (let i = Math.floor(Math.min(...xs) / 30); i <= Math.floor(Math.max(...xs) / 30); i++)
      for (let j = Math.floor(Math.min(...zs) / 30); j <= Math.floor(Math.max(...zs) / 30); j++) out.push(`${i},${j}`);
    return out;
  }
  hits(q: Quad): boolean {
    for (const k of this.keys(q)) for (const o of this.cells.get(k) ?? []) if (overlaps(q, o)) return true;
    return false;
  }
  add(q: Quad): void {
    for (const k of this.keys(q)) {
      let l = this.cells.get(k);
      if (!l) this.cells.set(k, (l = []));
      l.push(q);
    }
    void this.key;
  }
}

/** True when no sample of the footprint stands inside a street (own frontage edge excepted by tolerance). */
function clearOfStreets(rect: Quad, streets: Street[]): boolean {
  const samples: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = rect[i], [x1, z1] = rect[(i + 1) % 4];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 1.8));
    for (let k = 0; k < n; k++) samples.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
  }
  samples.push([(rect[0][0] + rect[2][0]) / 2, (rect[0][1] + rect[2][1]) / 2]);
  for (const s of streets) {
    const lim = s.width / 2 - 0.3;
    for (const [x, z] of samples) if (distToPolyline(x, z, s.pts) < lim) return false;
  }
  return true;
}

/**
 * Lay out plots for one style along the given streets. `accept` applies the zone's own rules (extent,
 * fill, dry ground, landmark footprints and road corridors); accepted plots are returned and block later ones.
 */
export function placeAlongStreets(streets: Street[], style: StreetStyle, accept: (c: Candidate) => boolean): Candidate[] {
  const out: Candidate[] = [];
  const grid = new Grid();
  const order = streets.map((s, i) => ({ s, i })).sort((a, b) => a.s.rank - b.s.rank || b.s.width - a.s.width);
  const avgW = (style.plot[0] + style.plot[1]) / 2;
  for (const { s: st, i: si } of order) {
    if (st.frontage === "none") continue;
    const hw = st.width / 2;
    for (let k = 1; k < st.pts.length; k++) {
      const [ax, az] = st.pts[k - 1], [bx, bz] = st.pts[k];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < style.plot[0]) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      for (const side of [1, -1]) {
        const nx = side * -tz, nz = side * tx; // unit normal from the street towards the plots
        if (st.frontage === "north" && nz >= -0.2) continue;
        if (st.frontage === "south" && nz <= 0.2) continue;
        if (st.frontage === "east" && nx <= 0.2) continue;
        if (st.frontage === "west" && nx >= -0.2) continue;
        const nLots = Math.ceil(L / LOT);
        for (let li = 0; li < nLots; li++) {
          const l0 = li * LOT;
          const ll = Math.min(LOT, L - l0);
          if (ll < style.plot[0]) continue;
          const lotHash = hash2(si * 131 + k * 17 + (side > 0 ? 7 : 3), li * 29 + 5);
          const r = rng(Math.floor(lotHash * 1e6) + 17);
          let widths: number[];
          if (style.lot) widths = [ll];
          else {
            let n = Math.max(1, Math.round(ll / avgW));
            while (n > 1 && ll / n < style.plot[0]) n--;
            const wts = Array.from({ length: n }, () => 0.75 + r() * 0.5);
            const sum = wts.reduce((a, v) => a + v, 0);
            widths = wts.map((v) => (v / sum) * ll);
          }
          let s0 = l0;
          widths.forEach((pw, j) => {
            const sc = s0 + pw / 2;
            s0 += pw;
            const plotHash = hash2(si * 37 + k * 11 + j * 5 + (side > 0 ? 1 : 2), li * 13 + 3);
            // choose the variant: one within 15 % of the plot width, else the nearest
            let variant = -1;
            let sx = 1;
            if (style.lot) {
              let best = -1;
              style.variants.forEach((v, vi) => { if (v.w <= pw + 0.5 && (best < 0 || v.w > style.variants[best].w || (v.w === style.variants[best].w && plotHash > 0.5))) best = vi; });
              variant = best;
            } else {
              const near = style.variants.map((v, vi) => ({ vi, q: pw / v.w })).filter((c) => Math.abs(c.q - 1) <= 0.15);
              if (near.length) {
                const tot = near.reduce((a, c) => a + (style.variants[c.vi].weight ?? 1), 0);
                let acc = plotHash * tot;
                variant = near[near.length - 1].vi;
                for (const c of near) { acc -= style.variants[c.vi].weight ?? 1; if (acc < 0) { variant = c.vi; break; } }
              }
              else {
                let bq = Infinity;
                style.variants.forEach((v, vi) => { const q = Math.abs(Math.log(pw / v.w)); if (q < bq) { bq = q; variant = vi; } });
              }
              if (variant >= 0) sx = pw / style.variants[variant].w;
              if (sx < 0.8 || sx > 1.25) variant = -1;
            }
            if (variant < 0) return;
            const V = style.variants[variant];
            const ex = ax + tx * sc + nx * hw, ez = az + tz * sc + nz * hw; // street-edge point at the plot centre
            const ox = ex + nx * V.front, oz = ez + nz * V.front;
            const hwid = (style.lot ? V.w : pw) / 2 - 0.05;
            const deep = V.front + V.back;
            const rect: Quad = [
              [ex - tx * hwid, ez - tz * hwid], [ex + tx * hwid, ez + tz * hwid],
              [ex + tx * hwid + nx * deep, ez + tz * hwid + nz * deep], [ex - tx * hwid + nx * deep, ez - tz * hwid + nz * deep],
            ];
            const c: Candidate = { x: ox, z: oz, rot: Math.atan2(-nx, -nz), sx: style.lot ? 1 : sx, variant, w: pw, lotHash, plotHash, street: st, rect };
            if (!accept(c)) return;
            if (grid.hits(rect)) return;
            if (!clearOfStreets(rect, streets)) return;
            grid.add(rect);
            out.push(c);
          });
        }
      }
    }
  }
  // rear tenements: behind many street houses, across a small yard, a second house reached by an alley
  // (London plots were built up deep; the period views show the block interiors full of roofs)
  if (!style.lot) {
    const plain = style.variants.map((v, vi) => ({ v, vi })).filter((q) => q.v.plain);
    const pool = plain.length ? plain : style.variants.map((v, vi) => ({ v, vi }));
    for (const c of [...out]) {
      const h = hash2(Math.round(c.x * 7), Math.round(c.z * 7));
      if (h > 0.62) continue;
      const nx = -Math.sin(c.rot), nz = -Math.cos(c.rot);
      const tx = nz, tz = -nx;
      const V = style.variants[c.variant];
      const pick = pool[Math.floor(hash2(Math.round(c.z * 5), Math.round(c.x * 3)) * pool.length) % pool.length];
      const V2 = pick.v;
      const sx = Math.min(1.1, Math.max(0.8, (c.w * 0.9) / V2.w));
      const hwid = (V2.w * sx) / 2 - 0.05;
      const yard = 3 + h * 6;
      const bx = c.x + nx * (V.back + yard), bz = c.z + nz * (V.back + yard); // front face of the rear house
      const ox = bx + nx * V2.front, oz = bz + nz * V2.front;
      const deep = V2.front + V2.back;
      const rect: Quad = [
        [bx - tx * hwid, bz - tz * hwid], [bx + tx * hwid, bz + tz * hwid],
        [bx + tx * hwid + nx * deep, bz + tz * hwid + nz * deep], [bx - tx * hwid + nx * deep, bz - tz * hwid + nz * deep],
      ];
      const c2: Candidate = { ...c, x: ox, z: oz, sx, variant: pick.vi, w: V2.w * sx, plotHash: hash2(Math.round(ox * 3), Math.round(oz * 3)), rear: true, rect };
      if (!accept(c2) || grid.hits(rect) || !clearOfStreets(rect, streets)) continue;
      grid.add(rect);
      out.push(c2);
    }
  }
  return out;
}
