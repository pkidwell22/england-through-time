import type { Confidence, Era, Evidence, Source, TimelineEvent } from "@/lib/types";
import type { HistYear } from "@/lib/years";

/**
 * Data contract for the national layer (England and Wales). Everything here is
 * loaded from data/national/*.json; the renderer in src/national knows nothing
 * about specific places. Years are signed historical years, never 0.
 */

/** data/national/site.json */
export interface NationalSite {
  id: string;
  name: string;
  subtitle: string;
  scopeNote: string;
  /** Geographic window of the map. */
  bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  timeline: { start: HistYear; end: HistYear; scale: { year: HistYear; u: number }[] };
  /** Fraction of land under woodland by year (national trend), with a note on reliability. */
  woodland: { cover: { year: HistYear; value: number }[]; note: string; sources: string[] };
}

/** data/national/terrain.json — describes public/assets/national/height.png */
export interface NationalTerrain {
  /** Equirectangular grid; row 0 = latMax, column 0 = lonMin. Land AND sea floor. */
  image: string;
  width: number;
  height: number;
  bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  /** elevation in metres = (R * 256 + G) * scale + offset  (B unused). */
  encoding: "rg16";
  scale: number;
  offset: number;
  /** Relative sea level in metres (0 = present) by year. */
  seaLevel: { year: HistYear; value: number }[];
  /** Optional regional corrections, e.g. fen/levels drainage or coastal erosion not captured by the height grid. */
  notes: string[];
  sources: string[];
  /**
   * Optional derived shading products (scripts/national/build-surface.py), all readings of present-day elevation:
   * relief = fine slopes and local relief; surface = openness, wetland, sun visibility, natural lakes;
   * water = distance to and size of water courses traced by flow accumulation. Paths default to /assets/national/.
   */
  surface?: { relief?: string; surface?: string; water?: string; lakes?: string[]; note?: string };
}

export type PlaceKind = "city" | "town" | "port" | "fort" | "hillfort" | "monument" | "monastery" | "cathedral" | "castle" | "palace" | "battle" | "mine" | "other";

/** data/national/places.json (and places-wales.json) */
export interface Place {
  id: string;
  name: string;
  /** Period names, e.g. { name: "Eboracum", from: 71, to: 410 }. */
  altNames?: { name: string; from: HistYear; to: HistYear | null }[];
  lat: number;
  lon: number;
  country: "england" | "wales";
  kind: PlaceKind;
  /** Dated phases. size 1 (hamlet/minor site) .. 5 (one of the largest places in Britain at the time). 0 = abandoned but site known. */
  phases: { from: HistYear; to: HistYear | null; label: string; size: 0 | 1 | 2 | 3 | 4 | 5; kind?: PlaceKind; note?: string }[];
  evidence: Evidence;
  confidence: Confidence;
  summary: string;
  uncertainty?: string;
  sources: string[];
  /** Id of a detailed site in data/locations/<id>/ that the user can descend into. */
  site?: string;
}

export type LineKind = "roman-road" | "road" | "frontier-wall" | "dyke" | "river-route" | "border";

/** data/national/lines.json */
export interface LineFeature {
  id: string;
  name: string;
  kind: LineKind;
  /** [lat, lon] vertices. */
  path: [number, number][];
  from: HistYear;
  to: HistYear | null;
  evidence: Evidence;
  confidence: Confidence;
  summary: string;
  uncertainty?: string;
  sources: string[];
}

/** data/national/polities.json — kingdoms, provinces, peoples. Borders were rarely lines; polygons are indicative. */
export interface Polity {
  id: string;
  name: string;
  kind: "people" | "province" | "kingdom" | "principality" | "earldom" | "march" | "realm";
  from: HistYear;
  to: HistYear | null;
  /** Where to put the label. */
  labelAt: [number, number];
  /** Optional indicative extent ([lat, lon] ring). Omit where the extent is not reasonably known. */
  polygon?: [number, number][];
  evidence: Evidence;
  confidence: Confidence;
  note: string;
  sources: string[];
}

export interface NationalDataset {
  site: NationalSite;
  terrain: NationalTerrain;
  eras: Era[];
  events: TimelineEvent[];
  places: Place[];
  lines: LineFeature[];
  polities: Polity[];
  sources: Record<string, Source>;
}
