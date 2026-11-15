/**
 * The years a detailed site can show, read from its site.json before the full site is loaded, and the rule for
 * which year a site opens at when entered from the national map:
 *   - inside the site's window: the map's year, unchanged;
 *   - outside it: the site's own initial year (timeline.initialYear, e.g. the battle year), else the nearer end.
 * The shell writes the landing year into the address bar, so reloads and shared links show what is displayed.
 */
import { formatHist, histToT, tToHist } from "@/lib/years";

export interface SiteWindow {
  id: string;
  name: string;
  start: number;
  end: number;
  initialYear?: number;
}

const valid = (y: unknown): y is number => typeof y === "number" && Number.isInteger(y) && y !== 0;
const cache = new Map<string, Promise<SiteWindow | null>>();

export function loadSiteWindow(id: string): Promise<SiteWindow | null> {
  if (!/^[a-z0-9-]+$/.test(id)) return Promise.resolve(null);
  let p = cache.get(id);
  if (!p) {
    p = import(`@data/locations/${id}/site.json`)
      .then((m) => {
        const s = (m.default ?? m) as { name?: string; timeline?: { start?: unknown; end?: unknown; initialYear?: unknown } };
        const tl = s.timeline ?? {};
        if (!valid(tl.start) || !valid(tl.end) || tl.end < tl.start) return null;
        return { id, name: String(s.name ?? id), start: tl.start, end: tl.end, initialYear: valid(tl.initialYear) ? tl.initialYear : undefined };
      })
      .catch(() => null);
    cache.set(id, p);
  }
  return p;
}

export interface Landing {
  /** Timeline value the site opens at. */
  t: number;
  /** True when the requested year lies inside the site's window (so it is carried over unchanged). */
  inside: boolean;
}

export function landingFor(win: Pick<SiteWindow, "start" | "end" | "initialYear">, t: number): Landing {
  if (!Number.isFinite(t)) return { t: histToT(win.initialYear ?? win.end), inside: false };
  const y = tToHist(t);
  if (y >= win.start && y <= win.end) return { t, inside: true };
  const fallback = win.initialYear != null && win.initialYear >= win.start && win.initialYear <= win.end ? win.initialYear : y < win.start ? win.start : win.end;
  return { t: histToT(fallback), inside: false };
}

/** "950–1100 CE" or "4000 BCE – 1625 CE". */
export function formatSpan(a: number, b: number): string {
  if (a > 0 && b > 0) return `${a}–${b} CE`;
  if (a < 0 && b < 0) return `${-a}–${-b} BCE`;
  return `${formatHist(a)} – ${formatHist(b)}`;
}
