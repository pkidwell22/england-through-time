import type { PhaseModel, VesselType } from "@/lib/types";
import { rng } from "@/lib/geo";
import { readModel, type VesselModel, type VesselState } from "./model";

/**
 * Where a `boats` phase puts its craft. Positions are ILLUSTRATIVE (the placements are conjectural even where a type
 * is well evidenced); the rules are the evidential part:
 *  - the landmark `path` runs downstream (first point upstream, last downstream); "north" is the left bank looking
 *    downstream, "south" the right bank;
 *  - `crossing` ([lat, lon]) is the bridge (or the bridgehead where no bridge stood); "above" lies upstream of it,
 *    "below" downstream; nothing is moored within `clear` metres of it;
 *  - zones: "north" (moored off the north waterfront), "south", "river" (anywhere afloat), "pool" (mid-stream tiers
 *    below the crossing), "above", "below", "beach" / "beach-south" (drawn up on the foreshore); "north"/"south"/
 *    "river" take an "-above" or "-below" suffix.
 */

export interface FleetEntry {
  type: string;
  /** Craft drawn at rest by the landmark builder. */
  n: number;
  zone: string;
  /** Extra craft of this type set moving by the populace layer (scaled by quality). */
  moving?: number;
  /** "moored" (default; "beached" on a beach zone) or "rowing" (oars out, a staged moment). */
  state?: VesselState;
  /** Optional part of the path to use, as fractions of its length from the upstream end, e.g. [0.3, 1]. */
  span?: [number, number];
}

export interface PlaceCtx {
  ground(x: number, z: number): number;
  path: [number, number][];
  project(lat: number, lon: number): [number, number];
  seed: number;
  /** Optional diagnostics record (see BuildCtx.trace): every placed craft is reported here. */
  trace?: { kind: string; x: number; z: number; [key: string]: number | string }[];
}

export interface Placed {
  type: VesselType;
  model: VesselModel;
  state: VesselState;
  x: number; y: number; z: number;
  /** Builder-style rotation about +y: local +x (bow) points along (cos rot, -sin rot). */
  rot: number;
  heel: number;
}

export function fleetOf(m: PhaseModel): FleetEntry[] {
  if (!Array.isArray(m.fleet)) return [];
  return (m.fleet as Record<string, unknown>[])
    .filter((f) => f && typeof f.type === "string")
    .map((f) => ({
      type: f.type as string,
      n: typeof f.n === "number" ? Math.max(0, Math.round(f.n)) : 0,
      zone: typeof f.zone === "string" ? f.zone : "river",
      moving: typeof f.moving === "number" ? Math.max(0, Math.round(f.moving)) : 0,
      state: typeof f.state === "string" ? (f.state as VesselState) : undefined,
      span: Array.isArray(f.span) && typeof f.span[0] === "number" && typeof f.span[1] === "number" ? ([f.span[0], f.span[1]] as [number, number]) : undefined,
    }));
}

export function typesOf(m: PhaseModel): Record<string, VesselType> {
  const t = (m as Record<string, unknown>).vesselTypes;
  return t && typeof t === "object" ? (t as Record<string, VesselType>) : {};
}

/** Along-river frame of a landmark path. */
export interface Frame {
  ax: number; az: number; dx: number; dz: number; nx: number; nz: number; len: number;
  /** Along-path coordinate of the crossing, or null. */
  sc: number | null;
  clear: number;
}

export function frameOf(m: PhaseModel, ctx: Pick<PlaceCtx, "path" | "project">): Frame | null {
  const p = ctx.path;
  if (p.length < 2) return null;
  const [a, c] = [p[0], p[p.length - 1]];
  const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
  if (len < 1) return null;
  const dx = (c[0] - a[0]) / len, dz = (c[1] - a[1]) / len;
  // n points to the right bank (south for a west-to-east path)
  const nx = -dz, nz = dx;
  let sc: number | null = null;
  const cr = m.crossing;
  if (Array.isArray(cr) && typeof cr[0] === "number" && typeof cr[1] === "number") {
    const [cx, cz] = ctx.project(cr[0], cr[1]);
    sc = (cx - a[0]) * dx + (cz - a[1]) * dz;
  }
  return { ax: a[0], az: a[1], dx, dz, nx, nz, len, sc, clear: typeof m.clear === "number" ? m.clear : 45 };
}

/** The along-path interval a zone may use. */
export function zoneRange(zone: string, f: Frame, within?: number, span?: [number, number]): [number, number] {
  let lo = span ? Math.max(0, span[0]) * f.len : 0, hi = span ? Math.min(1, span[1]) * f.len : f.len;
  const sc = f.sc;
  const above = zone === "above" || zone.endsWith("-above");
  const below = zone === "below" || zone === "pool" || zone.endsWith("-below");
  if (sc != null) {
    if (above) { hi = Math.min(hi, sc - f.clear); if (within) lo = Math.max(lo, sc - f.clear - within); }
    if (below) { lo = Math.max(lo, sc + f.clear); if (within) hi = Math.min(hi, sc + f.clear + within); }
    if (zone === "pool") hi = Math.min(hi, sc + f.clear + (within ?? 420));
  }
  return [lo, hi];
}

/** Lateral extent of open water (depth > `depth`) across the river at along-coordinate s: [left edge, right edge] in metres along n. */
export function waterAcross(f: Frame, ctx: Pick<PlaceCtx, "ground">, s: number, depth: number): [number, number] | null {
  const px = f.ax + f.dx * s, pz = f.az + f.dz * s;
  const wet = (t: number): boolean => ctx.ground(px + f.nx * t, pz + f.nz * t) < -depth;
  let t0 = NaN;
  for (let k = 0; k <= 160; k++) {
    for (const sg of [1, -1]) {
      const t = sg * k * 4;
      if (wet(t)) { t0 = t; break; }
    }
    if (!isNaN(t0)) break;
  }
  if (isNaN(t0)) return null;
  let l = t0, r = t0;
  while (l > -900 && wet(l - 3)) l -= 3;
  while (r < 900 && wet(r + 3)) r += 3;
  return [l, r];
}

/** First dry-to-wet transition (ground falling through 0) walking from the river centre towards a bank. */
function shoreline(f: Frame, ctx: Pick<PlaceCtx, "ground">, s: number, side: -1 | 1): number | null {
  const w = waterAcross(f, ctx, s, 0.5);
  if (!w) return null;
  const px = f.ax + f.dx * s, pz = f.az + f.dz * s;
  let t = side < 0 ? w[0] : w[1];
  for (let k = 0; k < 120; k++) {
    const g = ctx.ground(px + f.nx * t, pz + f.nz * t);
    if (g > 0.15) return t;
    t += side * 1;
  }
  return null;
}

/** Place every resting craft of a phase's fleet. Deterministic for a given seed. */
export function placeFleet(m: PhaseModel, ctx: PlaceCtx): Placed[] {
  const f = frameOf(m, ctx);
  const types = typesOf(m);
  if (!f) return [];
  const within = typeof m.within === "number" ? m.within : undefined;
  const out: Placed[] = [];
  const taken: { x: number; z: number; r: number }[] = [];
  fleetOf(m).forEach((fe, ei) => {
    const type = types[fe.type];
    if (!type || fe.n <= 0) return;
    const model = readModel(type.model);
    const r = rng(ctx.seed * 31 + ei * 7919 + 17);
    const [lo, hi] = zoneRange(fe.zone, f, within, fe.span);
    if (hi - lo < 5) return;
    const beach = fe.zone.startsWith("beach");
    const state: VesselState = fe.state ?? (beach ? "beached" : "moored");
    // craft moored in one zone mostly lie the same way (they swing together with the tide)
    const flip = r() < 0.5 ? 1 : -1;
    for (let i = 0; i < fe.n; i++) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const s = lo + (hi - lo) * r();
        if (f.sc != null && Math.abs(s - f.sc) < f.clear + model.len * 0.5) continue;
        let t: number, heading: number, y = 0, heel = 0;
        // local river direction from the open water a little up- and downstream
        const wa = waterAcross(f, ctx, s - 20, model.draft + 0.3), wb = waterAcross(f, ctx, s + 20, model.draft + 0.3);
        const ca = wa ? (wa[0] + wa[1]) / 2 : 0, cb = wb ? (wb[0] + wb[1]) / 2 : 0;
        const along = Math.atan2(cb - ca, 40); // angle of the channel relative to the path axis, towards n
        if (beach) {
          const side = fe.zone === "beach-south" ? 1 : -1;
          const sl = shoreline(f, ctx, s, side as -1 | 1);
          if (sl == null) continue;
          t = sl - side * model.len * 0.15;
          // drawn up bows-first, roughly square to the shore
          heading = side < 0 ? -Math.PI / 2 : Math.PI / 2;
          heading += (r() - 0.5) * 0.5;
          heel = (r() - 0.5) * 0.18;
        } else {
          const z = fe.zone;
          // craft at the waterfront lie close in (Thames ships took the ground at the quays at low water); others need depth
          const atBank = z.startsWith("north") || z.startsWith("south");
          const w = waterAcross(f, ctx, s, atBank ? 0.5 : model.draft + 0.3);
          if (!w) continue;
          const width = w[1] - w[0];
          const half = model.beam / 2 + 1.0;
          if (width < model.beam + 6) continue;
          if (z.startsWith("north")) t = w[0] + half + r() * Math.min(10, width * 0.08);
          else if (z.startsWith("south")) t = w[1] - half - r() * Math.min(10, width * 0.08);
          else if (z === "pool") t = w[0] + width * (0.22 + 0.4 * r());
          else t = w[0] + width * (0.12 + 0.76 * r());
          heading = (r() < 0.85 ? (flip > 0 ? 0 : Math.PI) : r() * Math.PI * 2) + along + (r() - 0.5) * 0.15;
          if (state === "rowing") heading = Math.PI + along + (r() - 0.5) * 0.25; // heading upstream
        }
        const x = f.ax + f.dx * s + f.nx * t, zz = f.az + f.dz * s + f.nz * t;
        const rad = model.len * 0.5;
        if (taken.some((o) => Math.hypot(o.x - x, o.z - zz) < (o.r + rad) * 0.62)) continue;
        if (beach) y = Math.max(-0.2, ctx.ground(x, zz)) + model.draft * 0.35;
        // heading is measured in the path frame (0 = downstream along d, +pi/2 = towards n); convert to a world rotation
        const hx = f.dx * Math.cos(heading) + f.nx * Math.sin(heading);
        const hz = f.dz * Math.cos(heading) + f.nz * Math.sin(heading);
        out.push({ type, model, state, x, y, z: zz, rot: -Math.atan2(hz, hx), heel });
        ctx.trace?.push({ kind: "craft", x, z: zz, y, rot: -Math.atan2(hz, hx), len: model.len, beam: model.beam, draft: model.draft, state, zone: fe.zone, type: type.id, from: type.from, to: type.to });
        taken.push({ x, z: zz, r: rad });
        break;
      }
    }
  });
  return out;
}
