import type { Era, Source, TimelineEvent } from "@/lib/types";
import { histToT } from "@/lib/years";
import type { LineFeature, NationalDataset, NationalSite, NationalTerrain, Place, Polity } from "./types";

/**
 * Loader for the national layer.
 *
 * Every file under data/national/ is imported on its own, through a
 * directory-wide dynamic import, so a file that is missing or not valid JSON
 * only makes that one import reject. The loader then falls back to the
 * placeholder of the same name in src/national/stub/. Nothing here needs
 * changing when the real files arrive: they are picked up on the next load.
 */

export interface LoadReport {
  /** Files served from src/national/stub because data/national/<file> was missing or unreadable. */
  stubbed: string[];
  /** Human-readable problems found by validateNational(). */
  problems: string[];
}

let lastReport: LoadReport = { stubbed: [], problems: [] };
/** What the most recent loadNational() had to substitute, and what it complained about. */
export function nationalLoadReport(): LoadReport {
  return lastReport;
}

const unwrap = <T>(m: unknown): T => ((m as { default?: T }).default ?? m) as T;

async function real<T>(name: string): Promise<T> {
  return unwrap<T>(await import(`@data/national/${name}.json`));
}
async function stub<T>(name: string): Promise<T> {
  return unwrap<T>(await import(`./stub/${name}.json`));
}

/** One data file: the real one if it loads and passes `ok`, else the placeholder (or `empty` for optional files). */
async function file<T>(name: string, ok: (v: T) => boolean, stubbed: string[], opts: { stubName?: string | null; empty?: T } = {}): Promise<T> {
  try {
    const v = await real<T>(name);
    if (ok(v)) return v;
    console.warn(`national data: data/national/${name}.json has an unexpected shape; using the placeholder`);
  } catch {
    /* missing or half-written: fall through */
  }
  stubbed.push(`${name}.json`);
  if (opts.stubName === null) return opts.empty as T;
  try {
    return await stub<T>(opts.stubName ?? name);
  } catch {
    return opts.empty as T;
  }
}

const isArr = (v: unknown) => Array.isArray(v);
const isObj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);

export async function loadNational(): Promise<NationalDataset> {
  const stubbed: string[] = [];
  const [site, terrain, eras, events, placesE, placesW, lines, politiesE, politiesW, base, sE, sW, sT] = await Promise.all([
    file<NationalSite>("site", (v) => isObj(v) && isObj(v.bounds) && isObj(v.timeline) && isArr(v.timeline.scale) && isObj(v.woodland), stubbed),
    file<NationalTerrain>("terrain", (v) => isObj(v) && isObj(v.bounds) && typeof v.image === "string" && isArr(v.seaLevel), stubbed),
    file<Era[]>("eras", (v) => isArr(v) && v.length > 0, stubbed),
    file<TimelineEvent[]>("events", isArr, stubbed),
    file<Place[]>("places", isArr, stubbed),
    file<Place[]>("places-wales", isArr, stubbed),
    file<LineFeature[]>("lines", isArr, stubbed),
    file<Polity[]>("polities", isArr, stubbed),
    file<Polity[]>("polities-wales", isArr, stubbed),
    import("@data/sources.json").then((m) => unwrap<Record<string, Source>>(m)).catch(() => ({}) as Record<string, Source>),
    file<Record<string, Source>>("sources-england", isObj, stubbed, { stubName: null, empty: {} }),
    file<Record<string, Source>>("sources-wales", isObj, stubbed, { stubName: null, empty: {} }),
    file<Record<string, Source>>("sources-terrain", isObj, stubbed, { stubName: null, empty: {} }),
  ]);

  // A placeholder list must not be mixed into real data from the other half of the country
  // (the same place could then appear twice), so an unavailable half is simply left out
  // whenever its counterpart is real.
  const pair = <T>(a: T[], aName: string, b: T[], bName: string): T[] => {
    const aStub = stubbed.includes(aName), bStub = stubbed.includes(bName);
    if (aStub !== bStub) return aStub ? b : a;
    return [...a, ...b];
  };
  const ds: NationalDataset = {
    site,
    terrain,
    eras,
    events,
    places: dedupe(pair(placesE, "places.json", placesW, "places-wales.json"), "place"),
    lines,
    polities: dedupe(pair(politiesE, "polities.json", politiesW, "polities-wales.json"), "polity"),
    sources: { ...base, ...sT, ...sE, ...sW },
  };
  const problems = validateNational(ds);
  lastReport = { stubbed, problems };
  if (stubbed.length) console.info(`national data: placeholder or empty stand-ins used for ${stubbed.join(", ")}`);
  if (problems.length) console.warn(`National dataset has ${problems.length} problem(s):\n` + problems.slice(0, 80).join("\n"));
  return ds;
}

function dedupe<T extends { id: string }>(list: T[], what: string): T[] {
  const seen = new Set<string>();
  return list.filter((x) => {
    if (!x || typeof x.id !== "string") return false;
    if (seen.has(x.id)) {
      console.warn(`national data: duplicate ${what} id "${x.id}" dropped`);
      return false;
    }
    seen.add(x.id);
    return true;
  });
}

/** True for a usable historical year (signed, non-zero integer). */
export function validYear(y: unknown): y is number {
  return typeof y === "number" && Number.isInteger(y) && y !== 0;
}
/** histToT that never throws: bad years become NaN (and are reported by validateNational). */
export function safeT(y: unknown): number {
  return validYear(y) ? histToT(y) : NaN;
}

const EVIDENCE = new Set(["attested-standing", "attested-excavated", "attested-documentary", "attested-pictorial", "reconstructed", "conjectural"]);
const CONFIDENCE = new Set(["high", "medium", "low"]);

/** Returns a list of human-readable problems; empty when the dataset is consistent. Never throws. */
export function validateNational(ds: NationalDataset): string[] {
  const out: string[] = [];
  try {
    const year = (y: unknown, where: string): boolean => {
      if (validYear(y)) return true;
      out.push(`${where}: ${JSON.stringify(y)} is not a valid historical year (signed non-zero integer)`);
      return false;
    };
    const b = ds.site.bounds;
    const start = ds.site.timeline.start, end = ds.site.timeline.end;
    year(start, "site.timeline.start");
    year(end, "site.timeline.end");
    const t0 = safeT(start), t1 = safeT(end);
    const inTime = (y: number, where: string) => {
      const t = histToT(y);
      if (t < t0 || t > t1 + 1) out.push(`${where}: ${y} is outside the timeline`);
    };
    const coord = (lat: unknown, lon: unknown, where: string) => {
      if (typeof lat !== "number" || typeof lon !== "number" || !isFinite(lat) || !isFinite(lon)) out.push(`${where}: coordinates are not numbers`);
      else if (lat < b.latMin || lat > b.latMax || lon < b.lonMin || lon > b.lonMax) out.push(`${where}: [${lat}, ${lon}] is outside the map bounds`);
    };
    const common = (o: { evidence?: string; confidence?: string; sources?: string[] }, where: string) => {
      if (!EVIDENCE.has(o.evidence ?? "")) out.push(`${where}: unknown evidence class "${o.evidence}"`);
      if (!CONFIDENCE.has(o.confidence ?? "")) out.push(`${where}: unknown confidence "${o.confidence}"`);
      if (!Array.isArray(o.sources)) out.push(`${where}: sources is not a list`);
      else for (const s of o.sources) if (!ds.sources[s]) out.push(`${where}: unknown source "${s}"`);
    };
    const span = (from: unknown, to: unknown, where: string) => {
      if (!year(from, `${where}.from`)) return;
      inTime(from as number, `${where}.from`);
      if (to != null && year(to, `${where}.to`) && histToT(to as number) < histToT(from as number)) out.push(`${where}: ends before it starts`);
    };

    ds.site.timeline.scale.forEach((a, i) => year(a.year, `site.timeline.scale[${i}]`));
    ds.site.woodland.cover.forEach((k, i) => {
      year(k.year, `site.woodland.cover[${i}]`);
      if (!(k.value >= 0 && k.value <= 1)) out.push(`site.woodland.cover[${i}]: value ${k.value} is not a fraction`);
      if (i > 0 && safeT(k.year) <= safeT(ds.site.woodland.cover[i - 1].year)) out.push(`site.woodland.cover[${i}]: years not increasing`);
    });
    for (const s of ds.site.woodland.sources ?? []) if (!ds.sources[s]) out.push(`site.woodland: unknown source "${s}"`);

    const tb = ds.terrain.bounds;
    if (!(tb.latMax > tb.latMin && tb.lonMax > tb.lonMin)) out.push("terrain.bounds: empty or inverted");
    if (tb.latMin > b.latMin + 1e-6 || tb.latMax < b.latMax - 1e-6 || tb.lonMin > b.lonMin + 1e-6 || tb.lonMax < b.lonMax - 1e-6) out.push("terrain.bounds do not cover site.bounds");
    if (ds.terrain.encoding !== "rg16") out.push(`terrain.encoding "${ds.terrain.encoding}" is not supported (expected rg16)`);
    ds.terrain.seaLevel.forEach((k, i) => {
      year(k.year, `terrain.seaLevel[${i}]`);
      if (i > 0 && safeT(k.year) <= safeT(ds.terrain.seaLevel[i - 1].year)) out.push(`terrain.seaLevel[${i}]: years not increasing`);
    });
    for (const s of ds.terrain.sources ?? []) if (!ds.sources[s]) out.push(`terrain: unknown source "${s}"`);

    ds.eras.forEach((e, i) => {
      const ok = year(e.from, `era ${e.id}.from`) && year(e.to, `era ${e.id}.to`) && year(e.presetYear, `era ${e.id}.presetYear`);
      if (!ok) return;
      if (histToT(e.presetYear) < histToT(e.from) || histToT(e.presetYear) > histToT(e.to)) out.push(`era ${e.id}: preset outside era`);
      if (i > 0 && validYear(ds.eras[i - 1].to) && histToT(e.from) !== histToT(ds.eras[i - 1].to) + 1) out.push(`era ${e.id}: does not follow the previous era without a gap`);
    });
    if (ds.eras.length) {
      if (ds.eras[0].from !== start) out.push("first era does not start at the timeline start");
      if (ds.eras[ds.eras.length - 1].to !== end) out.push("last era does not end at the timeline end");
    }
    for (const ev of ds.events) {
      if (year(ev.year, `event "${ev.label}"`)) inTime(ev.year, `event "${ev.label}"`);
      for (const s of ev.sources ?? []) if (!ds.sources[s]) out.push(`event "${ev.label}": unknown source "${s}"`);
    }

    for (const p of ds.places) {
      const w = `place ${p.id}`;
      coord(p.lat, p.lon, w);
      common(p, w);
      if (!Array.isArray(p.phases) || !p.phases.length) {
        out.push(`${w}: no phases`);
        continue;
      }
      let prevEnd = -Infinity;
      p.phases.forEach((ph, i) => {
        const pw = `${w} phase ${i}`;
        span(ph.from, ph.to, pw);
        if (!(Number.isInteger(ph.size) && ph.size >= 0 && ph.size <= 5)) out.push(`${pw}: size ${ph.size} is not 0..5`);
        const f = safeT(ph.from);
        if (f < prevEnd) out.push(`${pw}: overlaps the previous phase`);
        if (ph.to == null && i < p.phases.length - 1) out.push(`${pw}: open-ended phase is not last`);
        prevEnd = ph.to == null ? Infinity : Math.max(prevEnd, safeT(ph.to));
      });
      for (const a of p.altNames ?? []) span(a.from, a.to, `${w} altName "${a.name}"`);
    }
    for (const l of ds.lines) {
      const w = `line ${l.id}`;
      common(l, w);
      span(l.from, l.to, w);
      if (!Array.isArray(l.path) || l.path.length < 2) out.push(`${w}: path needs at least two vertices`);
      else l.path.forEach((v, i) => coord(v?.[0], v?.[1], `${w} vertex ${i}`));
    }
    for (const p of ds.polities) {
      const w = `polity ${p.id}`;
      common(p, w);
      span(p.from, p.to, w);
      coord(p.labelAt?.[0], p.labelAt?.[1], `${w} labelAt`);
      if (p.polygon) {
        if (p.polygon.length < 3) out.push(`${w}: polygon needs at least three vertices`);
        p.polygon.forEach((v, i) => coord(v?.[0], v?.[1], `${w} polygon vertex ${i}`));
      }
    }
  } catch (e) {
    out.push(`validation stopped early: ${(e as Error).message}`);
  }
  return out;
}
