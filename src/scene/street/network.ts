import type { Projector } from "@/lib/geo";
import { histToT } from "@/lib/years";
import londonStreets from "@data/locations/london/streets.json";

/**
 * Street networks for benchmark districts, from data/locations/<site>/streets.json.
 * Optional: a site without a file (every site but London today) keeps the generated lattice.
 */

interface RawStreet {
  id: string; name: string; years: [number, number]; width: number; kind: string; frontage?: string;
  evidence: string; confidence?: string; source?: string; surface?: { from: number; to: number; material: string }[];
  points: [number, number][];
  /**
   * Dated ends: a street that was carried out as the waterfront was reclaimed (or the marsh embanked) stops, in each
   * stage's years, at `end` (a point on its line; [lat, lon]); `anchor` names the end of `points` that stays put.
   * Outside every stage the street is not there. Without `reach` the whole line stands for all of `years`.
   */
  reach?: { anchor: "first" | "last"; evidence: string; confidence?: string; note?: string; stages: { from: number; to: number; end: [number, number] }[] };
}
interface RawFile { streets: RawStreet[] }

const FILES: Record<string, RawFile> = { london: londonStreets as unknown as RawFile };

export interface Street {
  id: string;
  name: string;
  kind: string;
  /** Local points (x east, z south), metres. */
  pts: [number, number][];
  width: number;
  /** Timeline values (continuous years) during which the street exists. */
  t0: number;
  t1: number;
  frontage: "both" | "north" | "south" | "east" | "west" | "none";
  evidence: string;
  surface: { t0: number; t1: number; material: string }[];
  /** Placement priority: principal and market streets claim frontage before lanes and alleys. */
  rank: number;
}

const RANK: Record<string, number> = { market: 0, principal: 0, street: 1, lane: 2, alley: 3 };

export function streetNetwork(siteId: string, proj: Projector): Street[] | null {
  const f = FILES[siteId];
  if (!f || !Array.isArray(f.streets)) return null;
  return f.streets
    .filter((s) => Array.isArray(s.points) && s.points.length >= 2)
    .flatMap((s) => {
      const base: Street = {
        id: s.id, name: s.name, kind: s.kind,
        pts: s.points.map(([la, lo]) => proj.toLocal(la, lo)),
        width: s.width,
        t0: histToT(s.years[0]),
        t1: histToT(s.years[1]) + 1,
        frontage: (s.frontage ?? "both") as Street["frontage"],
        evidence: s.evidence,
        surface: (s.surface ?? []).map((q) => ({ t0: histToT(q.from), t1: histToT(q.to) + 1, material: q.material })),
        rank: RANK[s.kind] ?? 1,
      };
      if (!s.reach?.stages?.length) return [base];
      // one record per stage: the line from the anchored end to that stage's end, for the stage's years
      const line = s.reach.anchor === "last" ? [...base.pts].reverse() : base.pts;
      const out: Street[] = [];
      for (const st of s.reach.stages) {
        const t0 = Math.max(base.t0, histToT(st.from)), t1 = Math.min(base.t1, histToT(st.to) + 1);
        if (!(t1 > t0)) continue;
        const pts = cutAt(line, proj.toLocal(st.end[0], st.end[1]));
        if (pts.length < 2) continue;
        out.push({ ...base, pts: s.reach.anchor === "last" ? pts.reverse() : pts, t0, t1 });
      }
      return out;
    });
}

/** The polyline from its first point to the point on it nearest `p`. */
export function cutAt(line: [number, number][], p: [number, number]): [number, number][] {
  let best = Infinity, bi = 0, bt = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1], [bx, bz] = line[i];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / l2));
    const d = Math.hypot(p[0] - ax - t * dx, p[1] - az - t * dz);
    if (d < best) { best = d; bi = i; bt = t; }
  }
  const [ax, az] = line[bi - 1], [bx, bz] = line[bi];
  const out = line.slice(0, bi);
  const end: [number, number] = [ax + (bx - ax) * bt, az + (bz - az) * bt];
  if (Math.hypot(end[0] - out[out.length - 1][0], end[1] - out[out.length - 1][1]) > 0.05) out.push(end);
  return out;
}

/** Distance from (x, z) to a polyline. */
export function distToPolyline(x: number, z: number, pts: [number, number][]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
    if (d < best) best = d;
  }
  return best;
}
