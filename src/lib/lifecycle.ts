import type { Keyframe, Phase } from "./types";
import { histToT } from "./years";

export type PhaseState = "absent" | "construction" | "intact" | "burning" | "teardown" | "ruin" | "gone";

export interface PhaseStatus {
  state: PhaseState;
  /** Fraction of the full height that is standing, 0..1. */
  height: number;
  /** 0 = fresh, 1 = fully weathered/ruinous tint. */
  decay: number;
  /** 0..1 fire glow. */
  fire: number;
}

const ABSENT: PhaseStatus = { state: "absent", height: 0, decay: 0, fire: 0 };
const GONE: PhaseStatus = { state: "gone", height: 0, decay: 1, fire: 0 };

/** Durations (years) of the visible end-of-life transitions. */
/** `to` is the year a structure was taken down or burned, so these are kept to about a year: the remains must not linger beside a dated successor. */
export const END_SPAN = { replaced: 1, demolished: 1, burned: 0.7, burnedRemains: 1.1, ruinSettle: 60, fadeOut: 40 };
/** Height fraction a ruin settles to. */
export const RUIN_HEIGHT = 0.3;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Kinds that stage a moment rather than a structure (an army drawn up, a camp, a "somewhere here" overlay).
 * They are not built or taken down: they are simply present and complete from the start of `from`
 * until the start of `to` (as for every kind, `to` is the first year they are gone). A single year may
 * be written either way: from 1471 to 1472, or from = to = 1471, both show them throughout 1471 only.
 */
export const STAGED_KINDS = new Set(["troops", "zone-marker", "tents", "camp", "sightline"]);
const INTACT: PhaseStatus = { state: "intact", height: 1, decay: 0, fire: 0 };

/**
 * An "extension" phase: `continues` (it takes over the standing structure, so the old fabric is not
 * rebuilt from the ground) together with a `built` year later than `from` (the added work, e.g. a nave
 * extended westwards over decades, is only finished then). Such a phase is drawn under construction from
 * `from` to the end of `built`, while its predecessor (which must end by "handover" when the extension
 * begins) stays standing until the same moment. See docs/MODEL-KINDS.md ("Extension phases").
 */
export function isExtension(p: Phase): boolean {
  return !!p.continues && p.built != null && histToT(p.built) > histToT(p.from);
}

/**
 * Give each "handover" phase that is followed by an extension phase a non-enumerable `heldUntil`
 * (the extension's `built` year), so phaseStatus(), which sees one phase at a time, keeps it standing
 * while the extension is built. The data is not changed. Called by the loaders; safe to call twice.
 */
export function linkExtensions(phases: Phase[]): void {
  phases.forEach((p, i) => {
    const next = phases[i + 1];
    const held = next && isExtension(next) && (p.end ?? "replaced") === "handover" && p.to === next.from ? next.built : undefined;
    Object.defineProperty(p, "heldUntil", { value: held, enumerable: false, configurable: true, writable: true });
  });
}

/** Evaluate one phase of a landmark at timeline value t. */
export function phaseStatus(p: Phase, t: number): PhaseStatus {
  const t0 = histToT(p.from);
  if (STAGED_KINDS.has(p.model?.kind)) {
    if (t < t0) return ABSENT;
    if (p.to == null) return INTACT;
    const tGone = histToT(p.to) > t0 ? histToT(p.to) : t0 + 1;
    return t >= tGone ? GONE : INTACT;
  }
  const tBuilt = p.built != null ? histToT(p.built) + 1 : t0 + 1; // complete by the end of the `built` year
  if (t < t0) return ABSENT;
  if ((!p.continues || isExtension(p)) && t < tBuilt) {
    const f = clamp01((t - t0) / Math.max(0.001, tBuilt - t0));
    return { state: "construction", height: 0.04 + 0.96 * f, decay: 0, fire: 0 };
  }
  if (p.to == null) return { state: "intact", height: 1, decay: 0, fire: 0 };
  // a predecessor of an extension is handed over only when the extension is finished (end of its `built` year)
  const tEnd = (p.end ?? "replaced") === "handover" && p.heldUntil != null ? Math.max(histToT(p.to), histToT(p.heldUntil) + 1) : histToT(p.to);
  if (t < tEnd) return { state: "intact", height: 1, decay: 0, fire: 0 };

  const end = p.end ?? "replaced";
  const dt = t - tEnd;
  if (end === "handover") return GONE;
  if (end === "replaced" || end === "demolished") {
    const span = END_SPAN[end];
    if (dt >= span) return GONE;
    return { state: "teardown", height: 1 - dt / span, decay: 0.3, fire: 0 };
  }
  if (end === "burned") {
    if (dt >= END_SPAN.burned + END_SPAN.burnedRemains) return GONE;
    if (dt < END_SPAN.burned) {
      const f = dt / END_SPAN.burned;
      return { state: "burning", height: 1 - 0.75 * f, decay: f, fire: Math.sin(Math.PI * Math.min(1, f * 1.1)) };
    }
    return { state: "ruin", height: 0.25 * (1 - (dt - END_SPAN.burned) / END_SPAN.burnedRemains), decay: 1, fire: 0 };
  }
  // "ruin" (collapses to a stump that lingers) or "decay" (slow decline over the whole span)
  const tGone = p.goneBy != null ? histToT(p.goneBy) : Infinity;
  if (t >= tGone) return GONE;
  if (end === "decay") {
    const span = Math.max(1, (isFinite(tGone) ? tGone : tEnd + 200) - tEnd);
    const f = clamp01(dt / span);
    return { state: "ruin", height: 1 - (1 - RUIN_HEIGHT * 0.5) * f, decay: Math.min(1, f * 2), fire: 0 };
  }
  const settle = clamp01(dt / END_SPAN.ruinSettle);
  let h = 1 - (1 - RUIN_HEIGHT) * settle;
  if (isFinite(tGone)) {
    const fade = clamp01((tGone - t) / END_SPAN.fadeOut);
    h *= fade;
  }
  return { state: "ruin", height: h, decay: 0.4 + 0.6 * settle, fire: 0 };
}

/** Piecewise-linear interpolation of year-keyed values; clamped at both ends. */
export function sampleKeyframes(kf: Keyframe[], t: number): number {
  if (kf.length === 0) return 0;
  const first = histToT(kf[0].year);
  if (t <= first) return kf[0].value;
  for (let i = 1; i < kf.length; i++) {
    const b = histToT(kf[i].year);
    if (t <= b) {
      const a = histToT(kf[i - 1].year);
      const f = (t - a) / (b - a);
      return kf[i - 1].value + f * (kf[i].value - kf[i - 1].value);
    }
  }
  return kf[kf.length - 1].value;
}

/** Life window of a generic zone instance: [appear start, appear end, vanish start, vanish end] as timeline values. */
export function instanceLife(
  grow: [number, number],
  decline: [number, number] | null,
  order: number, // 0 = first to appear (centre), 1 = last
  rand: number, // 0..1
  declineBy: string | undefined,
): [number, number, number, number] {
  const g0 = histToT(grow[0]);
  const g1 = histToT(grow[1]) + 1;
  const birth = g0 + (g1 - g0) * clamp01(order * 0.75 + rand * 0.25);
  const riseSpan = 2 + rand * 4;
  if (!decline) return [birth, birth + riseSpan, 1e9, 1e9 + 1];
  const d0 = histToT(decline[0]);
  const d1 = histToT(decline[1]) + 1;
  // Edges go first when a place is abandoned; fire and clearance are near-simultaneous.
  const k = declineBy === "fire" ? rand : clamp01((1 - order) * 0.6 + rand * 0.4);
  const death = d0 + (d1 - d0) * k;
  const fallSpan = declineBy === "fire" ? 0.6 : declineBy === "abandonment" ? 25 : 4;
  return [birth, birth + riseSpan, Math.max(death, birth + riseSpan), Math.max(death, birth + riseSpan) + fallSpan];
}
