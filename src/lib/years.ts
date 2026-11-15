/**
 * Year arithmetic for a BCE/CE timeline with no year zero.
 *
 * Two representations are used:
 *  - "historical year" (HistYear): what the data files and labels use. A signed
 *    non-zero integer: -50 means 50 BCE, 50 means 50 CE. Zero is invalid.
 *  - "timeline value" (t): a continuous number used for interpolation and
 *    playback. It is the astronomical year numbering, where 1 BCE = 0,
 *    2 BCE = -1, 1 CE = 1. This makes the BCE/CE boundary continuous:
 *    the instant after the end of 1 BCE is the start of 1 CE.
 *
 * A timeline value t lies "in" the calendar year floor(t).
 */

export type HistYear = number;

export function assertHistYear(y: number, where = "year"): void {
  if (!Number.isInteger(y) || y === 0) {
    throw new Error(`${where}: ${y} is not a valid historical year (non-zero integer; there is no year 0)`);
  }
}

/** Historical year -> timeline value at the START of that year. */
export function histToT(y: HistYear): number {
  assertHistYear(y);
  return y < 0 ? y + 1 : y;
}

/** Timeline value -> the historical year it falls within. */
export function tToHist(t: number): HistYear {
  const a = Math.floor(t);
  return a <= 0 ? a - 1 : a;
}

export function formatHist(y: HistYear): string {
  assertHistYear(y);
  return y < 0 ? `${-y} BCE` : `${y} CE`;
}

export function formatT(t: number): string {
  return formatHist(tToHist(t));
}

/** Number of calendar years from historical year a to b (b - a, skipping the missing year zero). */
export function yearsBetween(a: HistYear, b: HistYear): number {
  return histToT(b) - histToT(a);
}

/**
 * Non-linear slider mapping. Prehistory covers millennia with little visible
 * change, so the slider gives later, denser periods more room. The mapping is
 * piecewise linear between anchors and strictly monotonic, so it is exactly
 * invertible and every year is reachable.
 */
export interface ScaleAnchor {
  year: HistYear;
  u: number; // slider position 0..1
}

export class TimeScale {
  private ts: number[];
  private us: number[];
  constructor(anchors: ScaleAnchor[]) {
    if (anchors.length < 2) throw new Error("TimeScale needs at least two anchors");
    this.ts = anchors.map((a) => histToT(a.year));
    this.us = anchors.map((a) => a.u);
    for (let i = 1; i < anchors.length; i++) {
      if (!(this.ts[i] > this.ts[i - 1]) || !(this.us[i] > this.us[i - 1])) {
        throw new Error("TimeScale anchors must be strictly increasing");
      }
    }
  }
  get tMin(): number {
    return this.ts[0];
  }
  get tMax(): number {
    return this.ts[this.ts.length - 1];
  }
  clamp(t: number): number {
    return Math.min(this.tMax, Math.max(this.tMin, t));
  }
  tToU(t: number): number {
    const c = this.clamp(t);
    for (let i = 1; i < this.ts.length; i++) {
      if (c <= this.ts[i]) {
        const f = (c - this.ts[i - 1]) / (this.ts[i] - this.ts[i - 1]);
        return this.us[i - 1] + f * (this.us[i] - this.us[i - 1]);
      }
    }
    return this.us[this.us.length - 1];
  }
  uToT(u: number): number {
    const c = Math.min(this.us[this.us.length - 1], Math.max(this.us[0], u));
    for (let i = 1; i < this.us.length; i++) {
      if (c <= this.us[i]) {
        const f = (c - this.us[i - 1]) / (this.us[i] - this.us[i - 1]);
        return this.ts[i - 1] + f * (this.ts[i] - this.ts[i - 1]);
      }
    }
    return this.tMax;
  }
}

/** Parse user text such as "55 BCE", "55bc", "-55", "1066", "1066 CE", "AD 43". */
export function parseYearInput(text: string): HistYear | null {
  const s = text.trim().toLowerCase().replace(/\./g, "");
  const m = s.match(/^(ad|ce)?\s*(-?\d{1,5})\s*(bce|bc|ce|ad)?$/);
  if (!m) return null;
  let n = parseInt(m[2], 10);
  if (!Number.isFinite(n) || n === 0) return null;
  const suffix = m[3];
  if (suffix === "bce" || suffix === "bc") n = -Math.abs(n);
  return n;
}
