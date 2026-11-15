import type { HistYear } from "./years";

/**
 * How we know a feature existed in the form shown.
 *  attested-*   : the feature's existence, place and date are supported by
 *                 standing fabric, excavation, documents or period images.
 *  reconstructed: existence is attested, but the form shown is a scholarly
 *                 or house reconstruction from partial evidence.
 *  conjectural  : plausible fill-in; not individually evidenced.
 */
export type Evidence =
  | "attested-standing"
  | "attested-excavated"
  | "attested-documentary"
  | "attested-pictorial"
  | "reconstructed"
  | "conjectural";

export type Confidence = "high" | "medium" | "low";

export interface Source {
  title: string;
  publisher: string;
  url: string;
}

/**
 * "handover": this phase is swapped instantly for the next (same structure, altered form).
 * "replaced"/"demolished": taken down over a few years. "burned": destroyed within about a year.
 * "ruin": collapses to a stump that lingers until `goneBy`. "decay": slow decline until `goneBy`.
 */
export type PhaseEnd = "handover" | "replaced" | "demolished" | "burned" | "ruin" | "decay";

export interface PhaseModel {
  kind: string;
  [param: string]: unknown;
}

export interface Phase {
  label: string;
  /** Construction starts. */
  from: HistYear;
  /** Construction complete (defaults to `from`). */
  built?: HistYear;
  /** End of the intact phase; null = still standing in 1625. */
  to: HistYear | null;
  /** What happens at `to`. Default "replaced". */
  end?: PhaseEnd;
  /** For end = "ruin"/"decay": year by which the remains have gone. null = remains persist. */
  goneBy?: HistYear | null;
  /**
   * True when this phase takes over a standing structure from the previous one (no construction animation).
   * With a `built` year later than `from` it is an extension: the added work rises from `from` to `built`
   * while the previous ("handover") phase stays standing until then (lifecycle.ts isExtension).
   */
  continues?: boolean;
  dateNote?: string;
  model: PhaseModel;
  /** Runtime only, set by linkExtensions() (never in the JSON): a handover phase held standing until its extension's `built` year. */
  readonly heldUntil?: HistYear;
}

export interface Landmark {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Clockwise from north, degrees; long axis of the model. */
  bearing?: number;
  /** Polyline features (walls, roads, streams, bridges) use a path instead of a point. */
  path?: [number, number][];
  /** "district" features belong to the detailed benchmark district. */
  tier: "overview" | "district";
  evidence: Evidence;
  confidence: Confidence;
  summary: string;
  uncertainty?: string;
  phases: Phase[];
  sources: string[];
}

export interface ZoneShapeEllipse {
  type: "ellipse";
  lat: number;
  lon: number;
  /** Semi-axes in metres (east-west, north-south before rotation). */
  rx: number;
  rz: number;
  bearing?: number;
}
export interface ZoneShapePolygon {
  type: "polygon";
  points: [number, number][]; // lat, lon
}
/** Reference to a named polygon in site.polygons. */
export interface ZoneShapeRef {
  type: "ref";
  polygon: string;
}
export type ZoneShape = ZoneShapeEllipse | ZoneShapePolygon | ZoneShapeRef;

/** A field of procedurally placed generic instances (houses, trees…) with a date-driven life. */
export interface Zone {
  id: string;
  label: string;
  style: string;
  shape: ZoneShape;
  /** Lattice spacing in metres; smaller = denser. */
  spacing: number;
  /** Fraction of lattice cells used at peak (0..1). */
  fill: number;
  /** Cells whose hash falls in [band, band + fill) are used. Lets zones that coexist in time share a lattice without colliding. Default 0. */
  band?: number;
  /** "district" zones use detailed models and only fill the benchmark district; "overview" zones skip it. */
  tier?: "overview" | "district";
  /** Instances appear between these years (centre first). */
  grow: [HistYear, HistYear];
  /** Instances disappear between these years; null = persist to the end. */
  decline: [HistYear, HistYear] | null;
  /** Visual treatment of the decline. */
  declineBy?: "fire" | "abandonment" | "clearance" | "rebuild";
  /** Street-grid bearing in degrees; omitted = scattered with random rotation. */
  gridBearing?: number;
  evidence: Evidence;
  confidence: Confidence;
  note: string;
  sources: string[];
}

export interface Era {
  id: string;
  name: string;
  from: HistYear;
  to: HistYear;
  presetYear: HistYear;
  blurb: string;
}

export interface TimelineEvent {
  year: HistYear;
  label: string;
  note?: string;
  sources?: string[];
}

export interface Keyframe {
  year: HistYear;
  value: number;
}

export interface CameraView {
  id: string;
  name: string;
  /** Camera position and target in local metres [x, y, z]. */
  position: [number, number, number];
  target: [number, number, number];
  scope: "overview" | "district";
}

/**
 * Optional per-site rendering options (site.json). A site with none of these
 * renders with the engine defaults, exactly as London does.
 *
 *  atmosphere.fog          FogExp2 density (default 0.00014).
 *  atmosphere.fogColor     CSS colour for the haze (default: sampled from the sky's horizon).
 *  atmosphere.sunElevation Degrees above the horizon (default: the photographed sky's own sun, about 31).
 *  atmosphere.sunAzimuth   Degrees clockwise from north that the sun stands at (default 232 = south-west).
 *  atmosphere.exposure     Tone-mapping exposure (default 0.72).
 *  atmosphere.mist         A dated low ground mist: present for historical years from..to inclusive.
 *                          `density` is the extra FogExp2 density felt at ground level (0.004 is roughly 250 m of
 *                          visibility). It thins as the camera rises above `height` metres (default 40), and a
 *                          pale translucent layer over the ground stands in for it when seen from above.
 *  water.color             CSS colour of the river/tidal water (default #55665a).
 */
export interface SiteAtmosphere {
  fog?: number;
  fogColor?: string;
  sunElevation?: number;
  sunAzimuth?: number;
  exposure?: number;
  mist?: { from: HistYear; to: HistYear; density: number; height?: number; color?: string };
}

export interface SiteRiver {
  /** Centreline points [lat, lon, leftHalfWidth, rightHalfWidth, reclaimWeight]. Flow direction = array order. Widths are those at the end of the timeline. */
  centreline: [number, number, number, number, number][];
  /** Multiplies every half-width (e.g. 0.5 for a narrower, non-tidal reach). Default 1. */
  widthScale?: number;
  /** Extra left-bank width (m) relative to the end of the timeline, by year. Default: none. */
  northBankSetback?: Keyframe[];
  /** 0 = open tidal marsh on the right bank, 1 = embanked firm ground. Default: 0 throughout. */
  southEmbankment?: Keyframe[];
  /**
   * Dated inlets (docks) kept open in the reclaimed frontage: from `lat`/`lon` (the centre of the dock head) water
   * runs riverward along `bearing` for `width` metres across, through whatever bank each year has, from `from` to
   * `to` (null = past the end of the timeline). Additive: the ground is only ever lowered to the dock bed.
   */
  inlets?: SiteInlet[];
  note?: string;
  sources?: string[];
}

export interface SiteInlet {
  id: string;
  name: string;
  /** The landmark (a `dock`) this inlet belongs to. */
  landmark?: string;
  lat: number;
  lon: number;
  /** Direction from the head to the river, degrees clockwise from north. */
  bearing: number;
  width: number;
  /** How far the inlet may run from its head (m); beyond the bank it is river anyway. Default 200. */
  length?: number;
  from: HistYear;
  to: HistYear | null;
  evidence: Evidence;
  confidence: Confidence;
  uncertainty?: string;
  sources: string[];
}

export interface SiteTerrain {
  hills?: { name: string; lat: number; lon: number; height: number; sigma: number }[];
  valleys?: { name: string; path: [number, number][]; depth: number; sigma: number; fill?: Keyframe[] }[];
  /** Gravel islands in the right-bank marsh (river sites only). */
  eyots?: { name: string; lat: number; lon: number; height: number; sigma: number }[];
  /**
   * Sites WITHOUT a river only: height of the plain ground in metres above the scene datum (default 20).
   * This is a local datum, not Ordnance Datum: keep it small so camera views stay simple.
   */
  base?: number;
  /**
   * Sites WITHOUT a river only: a uniform tilt. The ground RISES towards `bearing`
   * (degrees clockwise from north) by `gradient` metres per metre (0.02 = 1 in 50), measured from the site origin.
   */
  slope?: { bearing: number; gradient: number };
  note?: string;
  sources?: string[];
}

export interface Site {
  id: string;
  name: string;
  subtitle: string;
  scopeNote: string;
  origin: { lat: number; lon: number; note?: string };
  /** Local-metre bounds of the modelled terrain. */
  bounds: { xMin: number; xMax: number; zMin: number; zMax: number };
  /**
   * The site's own window of years. `scale` maps years to slider positions (u from 0 to 1, strictly
   * increasing); when omitted the slider is linear from start to end. `initialYear` is the year shown
   * on arrival (default: the last era's presetYear).
   */
  timeline: { start: HistYear; end: HistYear; scale?: { year: HistYear; u: number }[]; initialYear?: HistYear };
  /**
   * The tidal river. Omit for a site with no river (a ridge, a heath): the terrain is then land
   * everywhere, built from terrain.base, terrain.slope, hills and valleys, and no water is drawn.
   */
  river?: SiteRiver;
  terrain: SiteTerrain;
  /** Named polygons ([lat, lon] rings) that zones and landmarks can share. */
  polygons?: Record<string, [number, number][]>;
  /**
   * Fraction of the original woodland cover remaining, by year. Omitted = no woodland trees.
   * `hedgerowTrees: false` also removes the sparse, illustrative field-edge trees of the farmed landscape.
   */
  woodland?: { cover: Keyframe[]; hedgerowTrees?: boolean; note?: string; sources?: string[] };
  /** The detailed benchmark district. Omitted = the whole site is schematic. */
  district?: {
    name: string;
    /** Local-metre rectangle of the detailed benchmark district. */
    bounds: { xMin: number; xMax: number; zMin: number; zMax: number };
    note: string;
  };
  /** Camera presets; the first is the default view. Omitted = one view framing the whole site. */
  views?: CameraView[];
  atmosphere?: SiteAtmosphere;
  water?: { color?: string };
  /**
   * NOT written in site.json: filled by the loader from the optional sidecar data/locations/<id>/terrain-lidar.json
   * (and, in the browser, its decoded height image). Absent = the analytic relief alone, unchanged.
   */
  lidar?: SiteLidar;
}

/**
 * data/locations/<id>/terrain-lidar.json, written by scripts/lidar/build.py (see research/lidar.md).
 * A LIDAR height grid in local metres; how the terrain model uses it is set by `use`:
 *  "replace-analytic": the grid (a "natural" surface with modern works removed) replaces base + hills + valleys;
 *                      only dated valleys (those with `fill`) are still cut into it. The analytic model is the
 *                      fallback outside the grid and is blended in over `edgeBlend` metres at its edge.
 *  "upland-only":      river sites: the grid is blended into the land only where its trust mask (blue channel) allows
 *                      and at least `riverClearance[0]`..`[1]` metres back from the modelled bank.
 *  "none":             the grid is delivered for reference only; the engine ignores it.
 * Heights in the grid are metres above Ordnance Datum; the engine subtracts `localDatumOffset` to reach the site's datum.
 */
export interface SiteLidar {
  use: "replace-analytic" | "upland-only" | "none";
  /** URL of the 16-bit-in-RG PNG (value = (R*256 + G) * scale + offset). */
  image: string;
  width: number;
  height: number;
  /** Local metres of the first and last grid nodes (node-registered). */
  bounds: { xMin: number; xMax: number; zMin: number; zMax: number };
  scale: number;
  offset: number;
  /** "blue": the blue channel is a 0..1 trust mask. */
  mask?: "blue" | null;
  localDatumOffset: number;
  /** Metres over which the grid fades into the analytic model at its edge [250]. */
  edgeBlend?: number;
  /**
   * "replace-analytic" only: instead of the edge fade, continue the grid's edge values outwards and fade to the
   * analytic model over this many metres beyond the grid (for a site whose analytic relief is only a flat base).
   */
  extend?: number;
  /** upland-only: no grid within [0] metres of the modelled bank, full weight beyond [1] [150, 400]. */
  riverClearance?: [number, number];
  cellSize?: number;
  datum?: string;
  source?: string;
  licence?: string;
  attribution?: string;
  notes?: string;
  /** The decoded grid, attached by prepareTerrain() in the browser; absent in tests and until loaded. */
  grid?: import("./heightmap").Heightmap;
  [extra: string]: unknown;
}

/** A Site after the loader has filled every optional collection (see normaliseSite in data.ts). */
export type LoadedSite = Site & {
  timeline: { start: HistYear; end: HistYear; scale: { year: HistYear; u: number }[]; initialYear?: HistYear };
  polygons: Record<string, [number, number][]>;
  woodland: { cover: Keyframe[]; hedgerowTrees?: boolean; note?: string; sources?: string[] };
  views: CameraView[];
};

/** A staged historical event the viewer can jump to. */
export interface Episode {
  id: string;
  name: string;
  year: HistYear;
  /** Position within the year, 0..1 (so a fire can be shown mid-burn). */
  fraction?: number;
  dateNote: string;
  lat: number;
  lon: number;
  inMap: boolean;
  offMap?: string;
  view?: { position: [number, number, number]; target: [number, number, number] };
  summary: string;
  attested: string[];
  tradition: string[];
  unknown: string[];
  evidence: Evidence;
  confidence: Confidence;
  sources: string[];
}

/**
 * One vessel TYPE from the optional data/locations/<id>/vessels.json (see docs/VESSELS.md). Its dates, evidence and
 * sources are about the type on this river; where a landmark places it (a `boats` phase's `fleet`) is separate and
 * usually conjectural. `model` holds the parameters of its parametric model (src/scene/vessels/).
 */
export interface VesselType {
  id: string;
  name: string;
  /** First and last year the type may be shown on this river. */
  from: HistYear;
  to: HistYear;
  dateNote?: string;
  evidence: Evidence;
  confidence: Confidence;
  summary: string;
  uncertainty?: string;
  sources: string[];
  model: { [param: string]: unknown };
}

export interface Dataset {
  episodes: Episode[];
  site: LoadedSite;
  eras: Era[];
  events: TimelineEvent[];
  landmarks: Landmark[];
  zones: Zone[];
  sources: Record<string, Source>;
  /** Vessel types (optional vessels.json); empty or absent on a site without one. */
  vessels?: VesselType[];
}
