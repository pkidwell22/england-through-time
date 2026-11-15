// Generates data/locations/stonehenge/site.json (keeps origin + bounds from the existing file).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const P = fileURLToPath(new URL("../../../", import.meta.url));
const siteFile = path.join(P, "data/locations/stonehenge/site.json");
const old = JSON.parse(fs.readFileSync(siteFile, "utf8"));
const geo = JSON.parse(fs.readFileSync(path.join(P, "research/stonehenge/geo.json"), "utf8"));
let ground = {};
try { ground = JSON.parse(fs.readFileSync(path.join(P, "research/stonehenge/d1/ground.json"), "utf8")); } catch {}

const LAT0 = 51.178868, LON0 = -1.8261962; // catalogue-fitted centre of the sarsen circle
const M_LAT = 111195, M_LON = 69750;
const ll = (x, z) => [+(LAT0 - z / M_LAT).toFixed(6), +(LON0 + x / M_LON).toFixed(6)]; // x east, z south
const xz = (lat, lon) => [(lon - LON0) * M_LON, -(lat - LAT0) * M_LAT];
const r2 = (v) => Math.round(v * 100) / 100;

// ---- terrain
const T = geo.terrain;
const hills = T.hills.map((h) => ({ name: h.name, lat: h.lat, lon: h.lon, height: h.height, sigma: h.sigma }));
const fitted = T.valleys.map((v) => ({ name: v.name, path: v.path, depth: v.depth, sigma: v.sigma }));
const DITCH_R = 53;
const ring = [];
for (let i = 0; i <= 72; i++) { const a = ((i % 72) / 72) * 2 * Math.PI; ring.push(ll(DITCH_R * Math.sin(a), -DITCH_R * Math.cos(a))); }
const ditch = {
  name: "Stonehenge ditch", path: ring, depth: 1.5, sigma: 2.0,
  fill: [{ year: -4000, value: 1 }, { year: -3001, value: 1 }, { year: -2995, value: 0 }, { year: -2400, value: 0.35 }, { year: -1500, value: 0.6 }, { year: 1625, value: 0.8 }],
};
// Avenue ditches: offset the Avenue centreline by +/-(23/2 + 2) m
const ave = geo.features.avenue.path.map(([la, lo]) => xz(la, lo));
const OFF = 23 / 2 + 2;
const side = (s) => ave.map((p, i) => {
  const a = ave[Math.max(0, i - 1)], b = ave[Math.min(ave.length - 1, i + 1)];
  let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
  return ll(p[0] + s * -dz * OFF, p[1] + s * dx * OFF);
});
const aveFill = [{ year: -4000, value: 1 }, { year: -2400, value: 1 }, { year: -2380, value: 0 }, { year: 1625, value: 0.7 }];
const aveDitches = [
  { name: "Avenue ditch (north side)", path: side(-1), depth: 0.6, sigma: 1.5, fill: aveFill },
  { name: "Avenue ditch (south side)", path: side(1), depth: 0.6, sigma: 1.5, fill: aveFill },
];

// ---- polygons
const round = (pts) => pts.map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]);
const ellipse = (cx, cz, rx, rz, n) => { const o = []; for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; o.push(ll(cx + rx * Math.cos(a), cz + rz * Math.sin(a))); } return o; };
const polygons = {
  "durrington-walls": round(geo.features["durrington-walls"].polygon),
  "vespasians-camp": round(geo.features["vespasians-camp"].polygon),
  "woodhenge": round(geo.features["woodhenge"].polygon),
  "greater-cursus": round(geo.features["cursus-greater"].polygon),
  "lesser-cursus": round(geo.features["cursus-lesser"].polygon),
  // houses of the Durrington village: just inside the east / south-east side of the henge, on the slope to the Avon (placement conjectural)
  "durrington-settlement": ellipse(2890, -1390, 60, 60, 14),
  // schematic envelope round the OSM town node, NOT a surveyed outline
  "amesbury-town": ellipse(3103, 730, 260, 190, 16),
  "amesbury-abbey-precinct": round(geo.features["amesbury-abbey-precinct"].polygon),
};

// ---- views
const V = (id, name, pos, tgt, scope) => ({ id, name, pos, tgt, scope });
const dirNE = [Math.sin((49.9 * Math.PI) / 180), -Math.cos((49.9 * Math.PI) / 180)];
const defs = [
  V("landscape", "Whole landscape", [-1500, 1100, 1900, "abs"], [700, -500, 0], "overview"), // lead v2: lower camera, thinner fog
  V("avenue", "From the Avenue", [dirNE[0] * 120, dirNE[1] * 120, 8], [0, 0, 3], "district"),
  V("inside", "Inside the circle", [-2, 2, 4], [dirNE[0] * 180, dirNE[1] * 180, 2], "district"),
  V("durrington", "Durrington Walls and Woodhenge", [2450, -800, 250], [2800, -1300, 0], "overview"),
  V("barrows", "Normanton Down barrows", [-900, 1300, 130], [-450, 700, 0], "overview"),
  V("low", "Stone height, south-west", [-26.8, 22.5, 3], [0, 0, 2], "district"),
];
const gy = (x, z) => ground[`${Math.round(x)},${Math.round(z)}`] ?? 40;
const views = defs.map((d) => {
  const [px, pz, ph, pm] = d.pos, [tx, tz, th] = d.tgt;
  const py = pm === "abs" ? ph : gy(px, pz) + ph;
  return { id: d.id, name: d.name, position: [r2(px), r2(py), r2(pz)], target: [r2(tx), r2(gy(tx, tz) + th), r2(tz)], scope: d.scope };
});

const site = {
  id: "stonehenge",
  name: "Stonehenge and its landscape",
  subtitle: "From the first earthworks to the Jacobean antiquaries, 4000 BCE to 1625 CE",
  scopeNote:
    "A 6.4 by 5 km piece of the Stonehenge World Heritage landscape, from 4000 BCE to 1625 CE, with the sarsen circle at the origin. Two levels of detail: the whole landscape is a schematic overview (barrows, cursus, henges, hillfort and town are placed from mapped outlines and published dates, but their form is generic), while the 'district' round the stones (about 800 by 650 m) has stone-by-stone megaliths from a catalogue, the ditch and bank, the Aubrey Holes, the first stretch of the Avenue and the Heel Stone. No feature is shown before its date, and where a date is a range or a model the landmark says so. The state of the stones before the first drawings (de Heere, 1570s) is mostly undated: which stones stood, leant or lay in 1625 is inferred, not recorded. Height comes from a modern LIDAR surface with modern works removed, with the ditch and Avenue ditches cut back in on their dates. Ground cover, trees and house positions are reconstruction. The solstice episodes mark the sunrise and sunset directions with overlay lines and discs; the scene's one fixed sun is not moved to the solstice. Amesbury's outline and the Durrington settlement area are schematic envelopes, not surveyed boundaries.",
  origin: old.origin,
  bounds: old.bounds,
  timeline: {
    start: -4000, end: 1625, initialYear: -2400,
    scale: [
      { year: -4000, u: 0 }, { year: -3700, u: 0.05 }, { year: -3000, u: 0.24 }, { year: -2500, u: 0.5 }, { year: -2000, u: 0.7 },
      { year: -1500, u: 0.84 }, { year: 1, u: 0.91 }, { year: 1000, u: 0.955 }, { year: 1625, u: 1 },
    ],
  },
  terrain: {
    base: r2(T.base - 2),
    slope: T.slope,
    hills,
    valleys: [...fitted, ditch, ...aveDitches],
    note:
      "Heights are metres above a local datum of Ordnance Datum minus 62 m (stones about 39.5, the Avon floor about 0 to 2: the engine clamps land at 2 m). Analytic fallback: a least-squares fit of the engine's own terrain formula (base + tilt + 12 gaussian hills - 6 valleys) to 1,302 EU-DEM 25 m samples, with the 2 m of datum difference removed from the base (hills and valleys are relative). Error against the DEM: RMS 4.5 m over the whole area (3.1 m, max 6.9 m, within 500 m of the stones); the two DEMs themselves disagree by RMS 2.6 m. It is a broad-shape model, not a survey. Where terrain-lidar.json is present the Environment Agency 1 m bare-earth LIDAR (datum offset 62) replaces this relief and only the dated ditches below are cut into it. The Stonehenge ditch is a closed 72-point ring of radius 53 m (a ditch centreline taken from the monument's c. 110 m overall diameter; the ditch width and profile are not recorded in the sources read), 1.5 m deep, dug about 3000 to 2900 BCE (the model switches it on in 3001 to 2995 BCE). Its silting (0.35 filled by 2400 BCE, 0.6 by 1500 BCE, 0.8 by 1625 CE) is MODELLED, not measured: the real ditch was also re-cut (Stage 3) and its later fill is not dated here. The two Avenue ditches (23 m apart, from the OpenStreetMap-mapped centreline) are dug 2400 to 2380 BCE in the model and 70% silted by 1625: the Avenue's date is 2430 to 2200 BCE (Darvill 2012) or 2345 to 2200 BCE (English Heritage antler dates), and the ditches were later ploughed nearly flat, so the depth shown is a gentle stand-in for ditches about 2 m deep when new.",
    sources: ["sto-eudem-elevation", "sto-open-meteo-elevation", "sto-osm-overpass", "sto-ea-lidar-dtm", "sto-ea-survey-2010", "sto-darvill-2012-remodelled", "sto-eh-reconstructed"],
  },
  polygons,
  woodland: {
    cover: [
      { year: -4000, value: 0.35 }, { year: -3500, value: 0.2 }, { year: -3000, value: 0.15 }, { year: -2500, value: 0.12 }, { year: -2000, value: 0.1 },
      { year: -1500, value: 0.08 }, { year: -1000, value: 0.05 }, { year: -500, value: 0.03 }, { year: 1, value: 0.03 }, { year: 500, value: 0.06 },
      { year: 1000, value: 0.04 }, { year: 1625, value: 0.04 },
    ],
    hedgerowTrees: false,
    note:
      "ESTIMATE, not measured. The values are my estimate of the fraction of the ground within about 3 km under woodland or scrub (the engine uses it as the share of possible tree sites that stand), from qualitative statements only: partly open woodland with clearings around 4000 BCE (Blick Mead pollen and DNA), open chalk grassland by 3500 BCE (snail evidence at the Cursus), stable grassland on thin soils about 3000 BCE, patches of woodland near Durrington Walls and alder-hazel carr on the Avon floodplain in the 3rd millennium, and clearance by about 800 to 500 BCE. The rise to 0.06 around 500 CE (post-Roman scrub) is speculative and unsourced; 1000 and 1625 are estimates. Where the trees stand is generated, not mapped. There are no hedgerow trees: the downland was open until enclosure.",
    sources: ["sto-soton-blickmead2022", "sto-french2012", "sto-eh-reconstructed", "sto-roberts2018"],
  },
  district: {
    name: "The stones",
    bounds: { xMin: -400, xMax: 400, zMin: -350, zMax: 300 },
    note:
      "Detailed round the monument: stone-by-stone megaliths from the stone catalogue (sarsen circle and lintels, trilithons, bluestone settings, Altar Stone, Station Stones, Slaughter Stone, Heel Stone), the ditch and bank, the Aubrey Holes and the first straight stretch of the Avenue. Positions and sizes come from surveyed plans and the catalogue; the form of timber structures, the original height of the bank and the state of each stone in 1625 are inferred. Everything outside this box, including the barrows, the Cursus, Durrington Walls and Amesbury, is schematic.",
  },
  views,
  atmosphere: { fog: 0.00007 },
};
const pts=[]; for (const d of defs){pts.push([d.pos[0],d.pos[1]],[d.tgt[0],d.tgt[1]]);}
fs.writeFileSync(path.join(P,"research/stonehenge/d1/points-site.json"), JSON.stringify(pts.map(([x,z])=>[Math.round(x),Math.round(z)])));
fs.writeFileSync(siteFile, JSON.stringify(site, null, 1) + "\n");
console.log("site.json written; valleys:", site.terrain.valleys.length, "views:", views.map((v) => `${v.id} ${v.position}`).join(" | "));
