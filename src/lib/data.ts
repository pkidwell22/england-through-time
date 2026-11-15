import type { Dataset, Episode, Era, Landmark, LoadedSite, Site, SiteLidar, Source, TimelineEvent, VesselType, Zone } from "./types";
import { DEFAULT_BASE } from "./terrain";
import { loadHeightmapImage } from "./heightmap";
import { assertHistYear, histToT, tToHist } from "./years";
import { isExtension, linkExtensions } from "./lifecycle";

/**
 * Location registry. To add a place: create data/locations/<id>/ and add its id here.
 * Nothing in the renderer is specific to one place.
 *
 * Files per location (data/locations/<id>/):
 *   site.json       required
 *   landmarks.json  optional (default: none)
 *   zones.json      optional (default: none)
 *   eras.json       optional (default: one era spanning the site's timeline)
 *   events.json     optional (default: none)
 *   episodes.json   optional (default: none)
 *   sources.json    optional; merged over data/sources.json
 *   terrain-lidar.json optional LIDAR height grid (scripts/lidar/build.py); decoded by prepareTerrain()
 *   vessels.json    optional vessel-type catalogue used by `boats` phases with a `fleet` (docs/VESSELS.md)
 */
export const LOCATION_IDS = ["london", "brentford", "barnet", "stonehenge"];

/** Reads data/locations/<id>/<file>.json; resolves to undefined when the file does not exist. */
export type JsonReader = (file: string) => Promise<unknown | undefined>;

function bundledReader(id: string): JsonReader {
  return async (file) => {
    try {
      // A template import: the bundler includes whatever location files exist, each loaded on demand.
      return (await import(`@data/locations/${id}/${file}.json`)).default;
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      if (!/cannot find module|failed to (load|resolve)|does not exist|unknown variable dynamic import/i.test(msg)) console.warn(`${id}/${file}.json could not be read: ${msg}`);
      return undefined;
    }
  };
}

/** Fill every optional part of a site so the engine never has to guess. Does not alter a complete site. */
export function normaliseSite(raw: Site): LoadedSite {
  if (!raw || typeof raw !== "object") throw new Error("site.json is empty or not an object");
  for (const k of ["origin", "bounds", "timeline"] as const) if (!raw[k]) throw new Error(`site.json has no "${k}"`);
  const { start, end } = raw.timeline;
  assertHistYear(start, "site.timeline.start");
  assertHistYear(end, "site.timeline.end");
  if (histToT(end) <= histToT(start)) throw new Error(`site.timeline: end (${end}) must be later than start (${start})`);
  const scale = raw.timeline.scale && raw.timeline.scale.length >= 2 ? raw.timeline.scale : [{ year: start, u: 0 }, { year: end, u: 1 }];
  const b = raw.bounds;
  let views = raw.views;
  if (!views || !views.length) {
    const cx = (b.xMin + b.xMax) / 2, cz = (b.zMin + b.zMax) / 2;
    const span = Math.max(b.xMax - b.xMin, b.zMax - b.zMin);
    const y0 = raw.river ? 0 : raw.terrain?.base ?? DEFAULT_BASE;
    views = [{ id: "overview", name: "Whole site", position: [cx, y0 + span * 0.6, cz + span * 0.85], target: [cx, y0, cz], scope: "overview" }];
  }
  return {
    ...raw,
    timeline: { ...raw.timeline, scale },
    terrain: raw.terrain ?? {},
    polygons: raw.polygons ?? {},
    woodland: raw.woodland && raw.woodland.cover?.length ? raw.woodland : { cover: [{ year: start, value: 0 }] },
    views,
  };
}

/** The era list for a site that supplies none: one era covering its whole timeline. */
export function defaultEras(site: LoadedSite): Era[] {
  const { start, end, initialYear } = site.timeline;
  const mid = tToHist((histToT(start) + histToT(end)) / 2);
  return [{ id: "site", name: site.name, from: start, to: end, presetYear: initialYear ?? mid, blurb: site.scopeNote ?? "" }];
}

/** The year shown on arrival: site.timeline.initialYear, else the last era's preset year. */
export function initialYear(ds: Pick<Dataset, "site" | "eras">): number {
  return ds.site.timeline.initialYear ?? ds.eras[ds.eras.length - 1]?.presetYear ?? ds.site.timeline.end;
}

const list = <T,>(v: unknown): T[] | null => (Array.isArray(v) ? (v as T[]) : null);

/** Assemble a dataset from a reader. Exported so tests can load fixtures from disk. */
export async function buildDataset(id: string, read: JsonReader, baseSources: Record<string, Source>): Promise<Dataset> {
  const [site, eras, events, landmarks, zones, episodes, sources, lidar, vessels] = await Promise.all(
    ["site", "eras", "events", "landmarks", "zones", "episodes", "sources", "terrain-lidar", "vessels"].map((f) => read(f)),
  );
  if (site === undefined) throw new Error(`No data for location "${id}": data/locations/${id}/site.json was not found.`);
  let loaded: LoadedSite;
  try {
    loaded = normaliseSite(site as Site);
  } catch (e) {
    throw new Error(`Location "${id}": ${(e as Error).message}`);
  }
  const lm = lidar as SiteLidar | undefined;
  // the optional LIDAR sidecar: metadata only here; the grid itself is decoded by prepareTerrain()
  if (lm && typeof lm === "object" && typeof lm.image === "string" && lm.bounds && lm.use) loaded = { ...loaded, lidar: { ...lm, grid: undefined } };
  const eraList = list<Era>(eras);
  // lists a data file may leave out are made empty here, so nothing downstream has to check
  const withSources = <T extends { sources?: string[] }>(items: T[] | null): T[] => {
    for (const it of items ?? []) if (!Array.isArray(it.sources)) it.sources = [];
    return items ?? [];
  };
  const eps = withSources(list<Episode>(episodes));
  for (const ep of eps) for (const k of ["attested", "tradition", "unknown"] as const) if (!Array.isArray(ep[k])) ep[k] = [];
  const lms = withSources(list<Landmark>(landmarks)).filter((l) => l && Array.isArray(l.phases));
  const vts = withSources(list<VesselType>(vessels)).filter((v) => v && typeof v.id === "string" && v.model && typeof v.model === "object");
  attachVesselTypes(lms, vts);
  for (const l of lms) linkExtensions(l.phases);
  return {
    site: loaded,
    eras: eraList && eraList.length ? eraList : defaultEras(loaded),
    events: list<TimelineEvent>(events) ?? [],
    landmarks: lms,
    zones: withSources(list<Zone>(zones)),
    episodes: eps,
    sources: { ...baseSources, ...((sources as Record<string, Source> | undefined) ?? {}) },
    vessels: vts,
  };
}

/**
 * Give every phase model that lists a `fleet` (vessel type ids) the site's vessel types, as a non-enumerable
 * `vesselTypes` map, so a model builder (which sees only the phase model) can draw them. The data is not changed.
 */
export function attachVesselTypes(landmarks: Landmark[], vessels: VesselType[]): void {
  const byId: Record<string, VesselType> = {};
  for (const v of vessels) byId[v.id] = v;
  for (const lm of landmarks)
    for (const p of lm.phases)
      if (p.model && Array.isArray(p.model.fleet)) Object.defineProperty(p.model, "vesselTypes", { value: byId, enumerable: false, configurable: true, writable: true });
}

export async function loadDataset(id: string): Promise<Dataset> {
  if (!LOCATION_IDS.includes(id)) throw new Error(`Unknown location "${id}". Known locations: ${LOCATION_IDS.join(", ")}.`);
  const base = (await import("@data/sources.json")).default as unknown as Record<string, Source>;
  const ds = await buildDataset(id, bundledReader(id), base);
  await prepareTerrain(ds);
  const problems = validateDataset(ds);
  if (problems.length) console.warn(`Dataset "${id}" has ${problems.length} problem(s):\n` + problems.join("\n"));
  return ds;
}

/**
 * Decode the site's LIDAR height image (if its sidecar asks for it to be used) before the engine builds the
 * terrain, which samples heights synchronously. Browser only; on any failure the site keeps its analytic relief.
 */
export async function prepareTerrain(ds: Dataset): Promise<void> {
  const l = ds.site.lidar;
  if (!l || l.use === "none" || l.grid || typeof document === "undefined" || typeof createImageBitmap === "undefined") return;
  try {
    l.grid = await loadHeightmapImage(l.image, l.width, l.height, l.bounds, l.scale, l.offset, l.mask === "blue");
  } catch (e) {
    console.warn(`${ds.site.id}: LIDAR terrain not used (${(e as Error).message}); keeping the analytic relief`);
  }
}

/** Landmark kinds drawn along the landmark's `path` (or a `path` in the model). */
const PATH_KINDS = new Set(["wall", "bridge", "road", "stream", "quay", "waterfront", "boats", "hedge", "ford", "stone-bridge"]);
/** Kinds drawn inside a ring: the landmark's `path`, a `path` in the model, or a named site polygon. */
const RING_KINDS = new Set(["zone-marker", "field-strips"]);

/** Returns a list of human-readable problems; empty when the dataset is consistent. */
export function validateDataset(ds: Dataset): string[] {
  const out: string[] = [];
  const year = (y: unknown, where: string) => {
    try {
      assertHistYear(y as number, where);
      return true;
    } catch (e) {
      out.push((e as Error).message);
      return false;
    }
  };
  const start = ds.site.timeline.start;
  const end = ds.site.timeline.end;
  year(start, "site.timeline.start");
  year(end, "site.timeline.end");
  const sc = ds.site.timeline.scale;
  if (sc.length < 2) out.push("site.timeline.scale needs at least two anchors");
  else {
    if (sc[0].year !== start) out.push(`site.timeline.scale starts at ${sc[0].year}, not at the timeline start ${start}`);
    if (sc[sc.length - 1].year !== end) out.push(`site.timeline.scale ends at ${sc[sc.length - 1].year}, not at the timeline end ${end}`);
    for (let i = 1; i < sc.length; i++) if (!(sc[i].u > sc[i - 1].u) || !(sc[i].year > sc[i - 1].year)) out.push(`site.timeline.scale anchor ${i} is not after the previous one`);
  }
  const iy = ds.site.timeline.initialYear;
  if (iy != null && year(iy, "site.timeline.initialYear") && (histToT(iy) < histToT(start) || histToT(iy) > histToT(end))) out.push("site.timeline.initialYear is outside the timeline");
  if (ds.site.river && ds.site.river.centreline.length < 2) out.push("site.river.centreline needs at least two points (omit `river` for a site without one)");
  for (const q of ds.site.river?.inlets ?? []) {
    const w = `site.river.inlets ${q.id}`;
    if (year(q.from, `${w}.from`) && q.to != null && year(q.to, `${w}.to`) && histToT(q.to) < histToT(q.from)) out.push(`${w}: closes before it opens`);
    if (!(q.width > 0)) out.push(`${w}: needs a positive width`);
    if (q.landmark && !ds.landmarks.some((l) => l.id === q.landmark)) out.push(`${w}: unknown landmark "${q.landmark}"`);
    if (typeof q.lat !== "number" || typeof q.lon !== "number" || typeof q.bearing !== "number") out.push(`${w}: needs numeric lat, lon and bearing`);
    if (!q.evidence || !q.confidence) out.push(`${w}: needs evidence and confidence`);
    if (!Array.isArray(q.sources) || !q.sources.length) out.push(`${w}: needs sources`);
    else for (const s of q.sources) if (!ds.sources[s]) out.push(`${w}: unknown source "${s}"`);
  }
  const mist = ds.site.atmosphere?.mist;
  if (mist) {
    year(mist.from, "site.atmosphere.mist.from");
    year(mist.to, "site.atmosphere.mist.to");
  }

  const ids = new Set<string>();
  for (const lm of ds.landmarks) {
    if (ids.has(lm.id)) out.push(`landmark ${lm.id}: duplicate id`);
    ids.add(lm.id);
    if (!lm.phases.length) out.push(`landmark ${lm.id}: no phases`);
    if (typeof lm.lat !== "number" || typeof lm.lon !== "number") out.push(`landmark ${lm.id}: needs numeric lat and lon`);
    for (const p of lm.phases) {
      const k = p.model?.kind;
      const own = Array.isArray(p.model?.path) ? (p.model.path as unknown[]).length : 0;
      const pts = Math.max(own, lm.path?.length ?? 0);
      if (PATH_KINDS.has(k) && pts < 2) out.push(`landmark ${lm.id}: kind "${k}" needs a path of at least two points`);
      if (RING_KINDS.has(k)) {
        const named = typeof p.model.polygon === "string" ? p.model.polygon : null;
        if (named && !ds.site.polygons[named]) out.push(`landmark ${lm.id}: unknown polygon "${named}"`);
        else if (!named && pts < 3) out.push(`landmark ${lm.id}: kind "${k}" needs a ring of at least three points`);
      }
      if (k === "troops" && lm.evidence !== "conjectural") out.push(`landmark ${lm.id}: troop blocks are stand-ins and must be marked "conjectural"`);
    }
    let prevEnd = -Infinity;
    lm.phases.forEach((p, i) => {
      const w = `landmark ${lm.id} phase ${i}`;
      if (!year(p.from, `${w}.from`)) return;
      if (p.built != null && year(p.built, `${w}.built`) && histToT(p.built) < histToT(p.from)) out.push(`${w}: built before from`);
      if (p.to != null && year(p.to, `${w}.to`)) {
        if (histToT(p.to) < histToT(p.built ?? p.from)) out.push(`${w}: ends before it is built`);
      }
      if (p.goneBy != null && year(p.goneBy, `${w}.goneBy`) && p.to != null && histToT(p.goneBy) < histToT(p.to)) out.push(`${w}: goneBy before to`);
      if (histToT(p.from) < prevEnd) out.push(`${w}: starts before the previous phase ends`);
      if (p.continues && i === 0 && histToT(p.from) > histToT(start)) out.push(`${w}: "continues" on a first phase that starts after the timeline start`);
      if (p.continues && i > 0 && lm.phases[i - 1].to !== p.from) out.push(`${w}: "continues" but does not start when the previous phase ends`);
      if (isExtension(p) && (i === 0 || (lm.phases[i - 1].end ?? "replaced") !== "handover")) out.push(`${w}: extension ("continues" with a later "built") needs a previous phase that ends by "handover"`);
      if (p.to == null && i < lm.phases.length - 1) out.push(`${w}: open-ended phase is not last`);
      prevEnd = p.to != null ? histToT(p.to) : Infinity;
      if (histToT(p.from) > histToT(end)) out.push(`${w}: starts after the timeline ends (${end})`);
    });
    for (const s of lm.sources) if (!ds.sources[s]) out.push(`landmark ${lm.id}: unknown source "${s}"`);
  }
  // vessel types, and the fleets that place them: a type may only be shown within its own dated range
  const vtypes = new Map((ds.vessels ?? []).map((v) => [v.id, v]));
  for (const v of ds.vessels ?? []) {
    const w = `vessel type ${v.id}`;
    if (year(v.from, `${w}.from`) && year(v.to, `${w}.to`) && histToT(v.to) < histToT(v.from)) out.push(`${w}: ends before it begins`);
    for (const s of v.sources) if (!ds.sources[s]) out.push(`${w}: unknown source "${s}"`);
  }
  // (a dataset assembled by hand without `vessels` skips the fleet check; the loader always fills it)
  if (ds.vessels) for (const lm of ds.landmarks)
    lm.phases.forEach((p, i) => {
      if (!Array.isArray(p.model?.fleet)) return;
      // shown from `from` until the start of `to` (or of `goneBy` for a phase that lingers); open-ended = to the timeline end
      const last = p.to == null ? histToT(end) : (p.goneBy != null ? histToT(p.goneBy) : histToT(p.to)) - 1;
      for (const f of p.model.fleet as { type?: unknown }[]) {
        const v = typeof f?.type === "string" ? vtypes.get(f.type) : undefined;
        if (!v) { out.push(`landmark ${lm.id} phase ${i}: unknown vessel type "${String(f?.type)}"`); continue; }
        if (histToT(p.from) < histToT(v.from) || last > histToT(v.to)) out.push(`landmark ${lm.id} phase ${i}: vessel type "${v.id}" (${v.from} to ${v.to}) shown outside its dates`);
      }
    });
  for (const z of ds.zones) {
    const w = `zone ${z.id}`;
    year(z.grow[0], `${w}.grow[0]`);
    year(z.grow[1], `${w}.grow[1]`);
    if (z.decline) {
      year(z.decline[0], `${w}.decline[0]`);
      year(z.decline[1], `${w}.decline[1]`);
      if (histToT(z.decline[0]) < histToT(z.grow[0])) out.push(`${w}: declines before it grows`);
    }
    if (z.shape.type === "ref" && !ds.site.polygons[z.shape.polygon]) out.push(`${w}: unknown polygon "${z.shape.polygon}"`);
    for (const s of z.sources) if (!ds.sources[s]) out.push(`${w}: unknown source "${s}"`);
  }
  ds.eras.forEach((e, i) => {
    year(e.from, `era ${e.id}.from`);
    year(e.to, `era ${e.id}.to`);
    year(e.presetYear, `era ${e.id}.presetYear`);
    if (histToT(e.presetYear) < histToT(e.from) || histToT(e.presetYear) > histToT(e.to)) out.push(`era ${e.id}: preset outside era`);
    if (i > 0 && histToT(e.from) !== histToT(ds.eras[i - 1].to) + 1) out.push(`era ${e.id}: does not follow the previous era without a gap`);
  });
  if (ds.eras.length) {
    if (ds.eras[0].from !== start) out.push("first era does not start at the timeline start");
    if (ds.eras[ds.eras.length - 1].to !== end) out.push("last era does not end at the timeline end");
  }
  for (const ev of ds.events) year(ev.year, `event "${ev.label}"`);
  for (const ep of ds.episodes ?? []) {
    year(ep.year, `episode ${ep.id}`);
    if (ep.inMap && !ep.view) out.push(`episode ${ep.id}: in-map episode needs a view`);
    for (const s of ep.sources) if (!ds.sources[s]) out.push(`episode ${ep.id}: unknown source "${s}"`);
  }
  return out;
}

/** The era containing t. Before the first era this is the first; after the last, the last. Needs at least one era (the loader guarantees it). */
export function eraAt(eras: Era[], t: number): Era {
  for (const e of eras) if (t < histToT(e.to) + 1) return e;
  return eras[eras.length - 1];
}
