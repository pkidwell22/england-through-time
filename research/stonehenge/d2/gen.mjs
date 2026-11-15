#!/usr/bin/env node
// Generator for data/locations/stonehenge/landmarks.json and zones.json.
//   node research/stonehenge/d2/gen.mjs && node scripts/stonehenge/sync-stones.mjs
// Reads research/stonehenge/geo.json (coordinates, barrows, Avenue/cursus/Avon paths) and data/locations/stonehenge/site.json
// (origin, for the district test). Every date, size and caveat below is written by hand from monument.md, landscape.md, geo.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const geo = JSON.parse(fs.readFileSync(path.join(root, "research/stonehenge/geo.json"), "utf8"));
const siteFile = path.join(root, "data/locations/stonehenge/site.json");
const site = fs.existsSync(siteFile) ? JSON.parse(fs.readFileSync(siteFile, "utf8")) : { origin: geo.origin };
const ORIGIN = site.origin;
const F = geo.features;

// engine projector (src/lib/geo.ts)
const MLAT = 111250, MLON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const toXZ = (lat, lon) => [(lon - ORIGIN.lon) * MLON, -(lat - ORIGIN.lat) * MLAT];
const DISTRICT = { xMin: -400, xMax: 400, zMin: -350, zMax: 300 };
const tierOf = (lat, lon) => {
  const [x, z] = toXZ(lat, lon);
  return x >= DISTRICT.xMin && x <= DISTRICT.xMax && z >= DISTRICT.zMin && z <= DISTRICT.zMax ? "district" : "overview";
};

// the catalogue's fitted centre of the sarsen circle: all monument landmarks are anchored here
const C = { lat: 51.178868, lon: -1.8261962 };

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const ph = (label, from, to, model, o = {}) => {
  const p = { label, from };
  if (o.built !== undefined) p.built = o.built;
  p.to = to;
  if (o.end) p.end = o.end;
  if (o.goneBy !== undefined) p.goneBy = o.goneBy;
  if (o.continues) p.continues = true;
  if (o.dateNote) p.dateNote = o.dateNote;
  p.model = model;
  return p;
};
const landmarks = [];
const lm = (o) => {
  const out = { id: o.id, name: o.name, lat: r6(o.lat), lon: r6(o.lon) };
  if (o.bearing !== undefined) out.bearing = o.bearing;
  if (o.path) out.path = o.path.map(([a, b]) => [r6(a), r6(b)]);
  out.tier = o.tier ?? tierOf(o.lat, o.lon);
  out.evidence = o.evidence;
  out.confidence = o.confidence;
  out.summary = o.summary;
  out.uncertainty = o.uncertainty;
  out.phases = o.phases;
  out.sources = o.sources;
  landmarks.push(out);
};
const mid = (pts) => pts[Math.floor(pts.length / 2)];
const centroid = (pts) => [pts.reduce((a, b) => a + b[0], 0) / pts.length, pts.reduce((a, b) => a + b[1], 0) / pts.length];

const YEAR1 =
  "The handover at year 1 CE is a CONVENTION, not a dated event: losses and falls between the end of use (c. 1500 BCE) and the first drawings (c. 1573 CE) are undated. Roman-period disturbance is recorded at the site, and nothing else is known of when individual stones fell or were taken.";

// =====================================================================================================================
// THE MONUMENT (anchored at the catalogue's fitted centre, tier district)
// =====================================================================================================================
const MON = { lat: C.lat, lon: C.lon };

// ---- trilithons
lm({
  id: "trilithons", name: "Sarsen trilithon horseshoe", ...MON,
  evidence: "attested-standing", confidence: "medium",
  summary: "Five sarsen trilithons (ten uprights, five lintels) in a horseshoe about 13.7 m across, open to the north-east; the tallest, the Great Trilithon at the south-west, stood about 7 m above ground. Drawn from the stone catalogue: stone positions and sizes are surveyed from what stands today, the original complete form is reconstructed from them.",
  uncertainty: "Which stones stood, leaned, lay or had been taken by 1625 is not recorded; the 1625 state is reasoned backwards from Stukeley (1720s), Wood (1740) and Barclay (1895). One tradition (John Aubrey, c. 1665-93) ties the fall of the Great Trilithon to the Duke of Buckingham's digging in 1620; it is a report 45 years later, not a dated observation, and the 1625 phase shows stones 55 and 156 fallen on that basis. The middle trilithon heights are catalogue estimates. The fresh-dressed to weathered handover at 2400 BCE (about 120 years) is conjectural: no source dates the weathering of sarsen surfaces. " + YEAR1,
  phases: [
    ph("Trilithons raised (fresh-dressed)", -2580, -2400,
      { kind: "megaliths", catalogue: { sets: ["trilithons"], state: "built" }, surface: "fresh" },
      { built: -2520, end: "handover", dateNote: "Darvill et al. 2012 Stage 2 (2620-2480 BCE); EH chronology model for the trilithons 2585-2400 BCE (93%, from one antler in the socket of stones 53/54). Raising is animated 2580-2520; the single modelled date is 2540 BCE. Fresh-dressed (pale) until 2400 BCE, then weathered: that swap is conjectural." }),
    ph("Trilithons, weathered", -2400, 1,
      { kind: "megaliths", catalogue: { sets: ["trilithons"], state: "built" } },
      { continues: true, end: "handover", dateNote: "Complete and weathered from 2400 BCE. " + YEAR1 }),
    ph("Ruinous, as by the first drawings (c. 1573); when each stone fell or was taken is unknown", 1, null,
      { kind: "megaliths", catalogue: { sets: ["trilithons"], state: "1625" } },
      { continues: true, dateNote: "State reasoned for 1625 from the first drawings (de Heere c. 1573-75; the R.F. engraving of 1575 shows leaning stones) and the 1720s surveys. " + YEAR1 }),
  ],
  sources: ["sto-darvill-2012-remodelled", "sto-marshall-2012-eh-chronology", "sto-eh-stones", "sto-sos-stones", "sto-stukeley-1740", "sto-long-1876", "sto-barclay-1895", "sto-eh-sources"],
});

// ---- sarsen circle
lm({
  id: "sarsen-circle", name: "Sarsen circle and lintels", ...MON,
  evidence: "reconstructed", confidence: "medium",
  summary: "The outer ring of thirty sarsen uprights (about 4.1 m high, 2.1 m wide) carrying a continuous ring of thirty lintels about 4.9 m above ground; outer diameter about 29.6 m. Seventeen uprights and six lintels stand today. The complete ring shown in the built phases is a reconstruction.",
  uncertainty: "Whether the circle was ever complete is unresolved. Darvill (2012) counts uprights 13, 17, 18, 20 and 24 and 24 lintels as missing and favours historic robbing (the sockets of 13 and 20 are recorded); Ashbee (1998) argued it was never finished; drought parchmarks in 2013 between stones 16 and 21 (Banton et al. 2014) may be stoneholes where expected uprights should be, which would favour a complete circle. The built phases show the missing uprights 13, 17, 18, 20 and 24 and their lintels as HYPOTHETICAL stones. The 1625 phase shows the circle as catalogued (state reasoned from the 1720s surveys). The fresh-to-weathered handover at 2400 BCE is conjectural. " + YEAR1,
  phases: [
    ph("Sarsen circle raised (fresh-dressed)", -2560, -2400,
      { kind: "megaliths", catalogue: { sets: ["sarsen-circle", "sarsen-lintels"], state: "built" }, surface: "fresh" },
      { built: -2470, end: "handover", dateNote: "EH chronology: sarsen circle 2580-2475 BCE (95%, one antler in the socket of stone 1); Darvill et al. 2012 Stage 2 (2620-2480). Raising is animated 2560-2470; the single modelled date is 2530 BCE, inside that span. Order relative to the trilithons uncertain (trilithons probably first). Fresh-dressed until 2400 BCE then weathered: conjectural." }),
    ph("Sarsen circle, weathered", -2400, 1,
      { kind: "megaliths", catalogue: { sets: ["sarsen-circle", "sarsen-lintels"], state: "built" } },
      { continues: true, end: "handover", dateNote: "Complete (as reconstructed) and weathered from 2400 BCE. " + YEAR1 }),
    ph("Ruinous, as by the first drawings (c. 1573); when each stone fell or was taken is unknown", 1, null,
      { kind: "megaliths", catalogue: { sets: ["sarsen-circle", "sarsen-lintels"], state: "1625" } },
      { continues: true, dateNote: "State for 1625 reasoned from the 1720s surveys: uprights missing today are assumed missing in 1625. " + YEAR1 }),
  ],
  sources: ["sto-darvill-2012-remodelled", "sto-marshall-2012-eh-chronology", "sto-banton-2014-abstract", "sto-eh-stones", "sto-eh-description", "sto-sos-stones", "sto-sos-missing", "sto-stukeley-1740", "sto-barclay-1895", "sto-wiki-stonehenge"],
});

// ---- bluestones by stage
const SIZE_B = { w: [0.6, 1.1], t: [0.4, 0.7], h: [1.4, 2.3] };
const gapSkip = (count, gFrom, gTo) => {
  const s = [];
  for (let i = 0; i < count; i++) {
    const a = (360 / count) * i;
    if (a >= gFrom && a <= gTo) s.push(i);
  }
  return s;
};

lm({
  id: "aubrey-bluestones", name: "Bluestones in the Aubrey Holes (contested)", ...MON,
  evidence: "reconstructed", confidence: "low",
  summary: "On Parker Pearson's interpretation the 56 Aubrey Holes held bluestones from about 3000 BCE, so Stonehenge's first stones were a ring about 87 m across just inside the bank. Shown as 56 small standing bluestones.",
  uncertainty: "CONTESTED. The 2008 re-excavation of Aubrey Hole 7 revived Hawley's idea of stones in the holes, and Parker Pearson (2020-22) argues for stones from c. 3000 BCE; Darvill (2022) holds that they held timber posts or nothing. No stone survives in situ. The stone sizes, count in use and the date of removal (here the start of Stage 2, 2620 BCE) are modelled, not recorded. The Aubrey Holes are drawn as open pits by their own landmark regardless of this reading.",
  phases: [
    ph("Bluestones in the Aubrey Holes (interpretation)", -3000, -2620,
      { kind: "megaliths", rings: [{ type: "bluestone", r: 43.3, count: 56, ...SIZE_B, h: [1.2, 2.0], jitter: 0.15, state: "standing", seed: 11 }] },
      { built: -2990, end: "handover", dateNote: "Parker Pearson: stones from c. 3000 BCE (Darvill et al. 2012 Stage 1, 3000-2620 BCE). Removal modelled at the start of Stage 2 (2620 BCE); the date is not known." }),
  ],
  sources: ["sto-darvill-2012-remodelled", "sto-wiki-aubrey-holes"],
});

const QRING = { type: "bluestone", ...SIZE_B, jitter: 0.2, state: "standing" };
lm({
  id: "bluestone-arcs", name: "Q and R bluestone double arc (Stage 2)", ...MON,
  evidence: "reconstructed", confidence: "low",
  summary: "A double ring of bluestones between the trilithons and the sarsen circle, set in the Q and R holes (paired 'dumbbell' sockets on the east, a single line on the south and west). Drawn as two parametric rings of 54 stones in all.",
  uncertainty: "The sockets are excavated (Atkinson, Darvill); the stones, their heights and the real pattern are not. Count 50-80 in the sources; 54 drawn. Atkinson thought the circle unfinished; Parker Pearson prefers a single arc on the S and W; Darvill prefers erosion of the evidence. The two rings are circular approximations of an irregular pattern. End date: Darvill places the dismantling at the start of Stage 4 (2280 BCE), after the central circle (Stage 3) was added; the lead's brief suggested 2480-2400 BCE: Darvill's account is followed here.",
  phases: [
    ph("Q and R bluestone double arc", -2620, -2280,
      { kind: "megaliths", rings: [
        { ...QRING, r: 10.9, count: 40, skip: gapSkip(40, 30, 70), seed: 21 },
        { ...QRING, r: 9.6, count: 18, from: 40, to: 200, seed: 22 },
      ] },
      { built: -2600, end: "replaced", dateNote: "Darvill et al. 2012 Stage 2 (2620-2480 BCE), dismantled in Stage 4 (from 2280 BCE) per the same account. Raising is animated 2620-2600: the time within Stage 2 is not known. 'replaced': taken down over a year at 2280 BCE (conjectural timing)." }),
  ],
  sources: ["sto-darvill-2012-remodelled", "sto-marshall-2012-eh-chronology"],
});

// oval of c. 25 stones: explicit ellipse (the megaliths rings param is circular only)
const AXIS = 49.9;
const ovalStones = (() => {
  const a = 5.6, b = 4.4, n = 25, B = (AXIS * Math.PI) / 180;
  const u = [Math.sin(B), -Math.cos(B)], v = [Math.cos(B), Math.sin(B)];
  const out = [];
  for (let i = 0; i < n; i++) {
    const th = (2 * Math.PI * i) / n;
    const x = a * Math.cos(th) * u[0] + b * Math.sin(th) * v[0];
    const z = a * Math.cos(th) * u[1] + b * Math.sin(th) * v[1];
    const k = (i * 37 % 11) / 10; // deterministic size variation
    out.push({ id: `oval-${i + 1}`, type: "bluestone", role: "upright", x: +x.toFixed(2), z: +z.toFixed(2), w: +(0.6 + 0.3 * k).toFixed(2), t: +(0.4 + 0.15 * ((i * 17) % 7) / 6).toFixed(2), h: +(1.7 + 0.7 * ((i * 29) % 13) / 12).toFixed(2), state: "standing" });
  }
  return out;
})();

lm({
  id: "bluestone-circle-and-oval", name: "Central bluestone circle (Stage 3) and bluestone oval (Stage 4)", ...MON,
  evidence: "conjectural", confidence: "low",
  summary: "Two bluestone settings inside the trilithons, one after the other: a small central circle in Stage 3 and the oval of about 25 stones in Stage 4, which later became the horseshoe. Both are parametric stand-ins.",
  uncertainty: "Stage 3: only an arc of five stoneholes is evidenced; that it was a full circle, its radius and its stones are conjectural (a ring of 18 is drawn). Stage 4: the oval of c. 24-25 stones is inferred from stoneholes; its exact shape, orientation (here the axis, 49.9 degrees) and stone sizes are modelled, and the 25 positions lie on an ellipse of 5.6 x 4.4 m semi-axes chosen to fit inside the trilithons. Dates: Stage 3 2480-2280 BCE, Stage 4 2280-2020 BCE (oval 2205-1920 BCE at 95%; modelled 2060 BCE). Nothing stands in this setting between 2280 and 2120 BCE in the model: that gap is a convention covering dismantling and rebuilding.",
  phases: [
    ph("Central bluestone circle (Stage 3; completion conjectural)", -2480, -2280,
      { kind: "megaliths", rings: [{ type: "bluestone", r: 4.6, count: 18, ...SIZE_B, jitter: 0.15, state: "standing", seed: 31 }] },
      { built: -2470, end: "replaced", dateNote: "Darvill et al. 2012 Stage 3 (2480-2280 BCE). Taken down at the start of Stage 4 (2280 BCE); exact years unknown." }),
    ph("Bluestone oval of c. 25 stones (Stage 4)", -2120, -2020,
      { kind: "megaliths", stones: ovalStones },
      { built: -2060, end: "handover", dateNote: "Modelled 2060 BCE (Darvill et al. 2012: oval 2205-1920 BCE at 95%, Stage 4 2280-2020). Hands over to the Stage 5 horseshoe at 2020 BCE; Darvill instead dates the reduction of the oval to a horseshoe to the Roman period." }),
  ],
  sources: ["sto-darvill-2012-remodelled", "sto-marshall-2012-eh-chronology"],
});

lm({
  id: "bluestone-circle", name: "Outer bluestone circle", ...MON,
  evidence: "reconstructed", confidence: "low",
  summary: "The bluestone circle between the trilithons and the sarsen circle, about 22 m across (radius 11 m), of 40-60 stones when complete (Stage 4). Nineteen stone positions are catalogued from the surviving stones and stumps; the complete ring is drawn as 60 parametric stones.",
  uncertainty: "The original count is 40-60 (Darvill et al.), 60 drawn. Only part of the ring survives (7 standing, others fallen, stumps or buried); the 1625 phase uses the catalogue, whose positions for stones 33-36 and 37-44 are schematic (+/-10 to 20 degrees) and whose buried entries are known only from records of their stumps. Which of them stood, fell or had been removed by 1625 is not recorded: the complete-to-ruinous swap at year 1 CE is a convention. Darvill thinks at least seven oval stones were removed in Roman times; no stone of this ring is individually dated. " + YEAR1,
  phases: [
    ph("Outer bluestone circle (complete, parametric)", -2220, 1,
      { kind: "megaliths", rings: [{ type: "bluestone", r: 11.0, count: 60, ...SIZE_B, jitter: 0.25, state: "standing", seed: 41 }] },
      { built: -2165, end: "handover", dateNote: "Darvill et al. 2012 Stage 4 (2280-2020 BCE); EH chronology: bluestone circle 2275-2030 BCE (95%). Modelled 2165 BCE. " + YEAR1 }),
    ph("Bluestone circle as catalogued for 1625 (partly fallen, stumps, buried)", 1, null,
      { kind: "megaliths", catalogue: { sets: ["bluestone-circle"], state: "1625" } },
      { continues: true, dateNote: "State reasoned from Stukeley, Barclay and the stones catalogue. " + YEAR1 }),
  ],
  sources: ["sto-darvill-2012-remodelled", "sto-marshall-2012-eh-chronology", "sto-sos-stones", "sto-stukeley-1740", "sto-barclay-1895"],
});

lm({
  id: "bluestone-horseshoe", name: "Bluestone horseshoe", ...MON,
  evidence: "reconstructed", confidence: "low",
  summary: "The bluestone horseshoe inside the trilithons, open to the north-east, of about 19 stones (Stage 5). Twelve positions are catalogued from surviving stones; the complete setting is drawn as 19 parametric stones.",
  uncertainty: "DATE DISPUTED: Atkinson dates the horseshoe to the end of the third millennium BCE (Stage 5, 2020-1520; the EH chronology gives 2205-1920 BCE at 95% for the oval/horseshoe); Darvill thinks the removal of at least seven stones at the north end of the oval to make a horseshoe was 'highly likely' Roman. The 19 stones are a count from the literature, drawn on a regular arc of radius 5.0 m; the catalogue's positions for the survivors (r 4.2-6.2 m) are the better evidence. " + YEAR1,
  phases: [
    ph("Bluestone horseshoe (complete, parametric)", -2020, 1,
      { kind: "megaliths", rings: [{ type: "bluestone", r: 5.0, count: 19, from: 80, to: 340, w: [0.5, 0.9], t: [0.4, 0.57], h: [1.8, 2.6], jitter: 0.15, state: "standing", seed: 51 }] },
      { built: -2020, end: "handover", dateNote: "Stage 5 (2020-1520 BCE) modelled at its start; the date is disputed (see uncertainty). " + YEAR1 }),
    ph("Bluestone horseshoe as catalogued for 1625", 1, null,
      { kind: "megaliths", catalogue: { sets: ["bluestone-horseshoe"], state: "1625" } },
      { continues: true, dateNote: "Six stones stand in the 1720s surveys; earlier state unknown. " + YEAR1 }),
  ],
  sources: ["sto-darvill-2012-remodelled", "sto-marshall-2012-eh-chronology", "sto-sos-stones", "sto-stukeley-1740", "sto-barclay-1895"],
});

// ---- altar, station, slaughter, heel
lm({
  id: "altar-stone", name: "Altar Stone", ...MON,
  evidence: "attested-standing", confidence: "low",
  summary: "A slab of green-grey sandstone about 4.9 x 1.0 x 0.5 m at the foot of the Great Trilithon. It is not from southern Britain: a 2024 study matched its chemistry and mineral ages most closely to the Old Red Sandstone of the Orcadian Basin in north-east Scotland, at least 750 km away; a 2026 study questions that match, and the exact source remains unresolved. Drawn lying flat at ground level.",
  uncertainty: "Its date of placing is tentative (Darvill: Stage 2, perhaps any time before the Great Trilithon fell on it); its original posture (flat or upright) is not established; its exact source is unresolved (Orcadian Basin, NE Scotland, in Clarke et al. 2024; reported to be questioned by Pirrie et al. 2026, which was not read directly). In 1625 it is shown broken (2-3 pieces, Stukeley 1723) beneath the fallen Great Trilithon: that depends on the unknown date of the fall (if the tradition of 1620 is wrong it lay whole). " + YEAR1,
  phases: [
    ph("Altar Stone in place", -2545, 1,
      { kind: "megaliths", catalogue: { sets: ["altar"], state: "built" } },
      { built: -2540, end: "handover", dateNote: "Modelled 2540 BCE with the trilithons (Darvill 2012: tentatively Stage 2, 2620-2480). " + YEAR1 }),
    ph("Altar Stone as catalogued for 1625 (broken under the fallen Great Trilithon)", 1, null,
      { kind: "megaliths", catalogue: { sets: ["altar"], state: "1625" } },
      { continues: true, dateNote: YEAR1 }),
  ],
  sources: ["sto-clarke2024-altar", "sto-scinews-altar-2026", "sto-wiki-altar-stone", "sto-eh-research", "sto-darvill-2012-remodelled", "sto-sos-stones", "sto-stukeley-1740", "sto-long-1876"],
});

lm({
  id: "station-stones", name: "Station Stones", ...MON,
  evidence: "reconstructed", confidence: "low",
  summary: "Four small sarsens (91-94) in a rectangle just inside the bank. Two (91, 93) survive; the other two positions are marked by modern plaques at the findspots of their barrows.",
  uncertainty: "The date is uncertain (the EH timeline puts them with the sarsens; Atkinson earlier). Stones 92 and 94 are placed from modern markers, +/-1.5-3 m, and stood in barrows; their forms are inferred from 91 and 93. 91 is shown fallen and 93 standing in 1625 (reasoned from 1771 and the 1720s). " + YEAR1,
  phases: [
    ph("Station Stones (four)", -2555, 1,
      { kind: "megaliths", catalogue: { sets: ["station"], state: "built" } },
      { built: -2550, end: "handover", dateNote: "Stage 2 (2620-2480 BCE), modelled 2550 BCE. " + YEAR1 }),
    ph("Station Stones as catalogued for 1625", 1, null,
      { kind: "megaliths", catalogue: { sets: ["station"], state: "1625" } },
      { continues: true, dateNote: YEAR1 }),
  ],
  sources: ["sto-wiki-station-stones", "sto-darvill-2012-remodelled", "sto-eh-history", "sto-sos-stones", "sto-osm-overpass"],
});

lm({
  id: "slaughter-stone", name: "Slaughter Stone", ...MON,
  evidence: "attested-standing", confidence: "medium",
  summary: "A fallen sarsen about 4.9 m long (6.1 m as catalogued when standing) in the north-east entrance, once standing there with companion stones D and E.",
  uncertainty: "Whether it stood upright originally is inferred from its stonehole and Darvill's reconstruction of an entrance facade; D and E (removed in Stage 3) are not drawn. When it fell is not recorded: it lay flat in the 1720s. The 'Slaughter' name is 17th-century folklore. " + YEAR1,
  phases: [
    ph("Slaughter Stone standing in the north-east entrance", -2475, 1,
      { kind: "megaliths", catalogue: { sets: ["slaughter"], state: "built" } },
      { built: -2470, end: "handover", dateNote: "Modelled 2470 BCE (stonehole E dated 2470-2275 BCE, Darvill 2012). " + YEAR1 }),
    ph("Slaughter Stone as catalogued for 1625 (fallen)", 1, null,
      { kind: "megaliths", catalogue: { sets: ["slaughter"], state: "1625" } },
      { continues: true, dateNote: YEAR1 }),
  ],
  sources: ["sto-darvill-2012-remodelled", "sto-eh-stones", "sto-wiki-stonehenge", "sto-sos-stones", "sto-osm-overpass"],
});

lm({
  id: "heel-stone", name: "Heel Stone (and stonehole 97)", ...MON,
  evidence: "attested-standing", confidence: "medium",
  summary: "An unshaped sarsen about 4.7 m high, 77.4 m from the centre on the solstice axis, with a second stonehole (97) beside it.",
  uncertainty: "It leans toward the circle today (the lean is not modelled); when it began to lean is unknown. Darvill gives two scenarios (96 added beside 97, or 97's stone moved to 96); the stone in 97 is inferred from the hole alone (marked hypothetical) and shown only in the built phase. The ditch round the Heel Stone was dug in late Stage 2 or early Stage 3 and is not drawn. " + YEAR1,
  phases: [
    ph("Heel Stone and its companion in hole 97", -2555, 1,
      { kind: "megaliths", catalogue: { sets: ["heel", "heel-companion"], state: "built" } },
      { built: -2550, end: "handover", dateNote: "Stage 2 (2620-2480 BCE), modelled 2550 BCE. " + YEAR1 }),
    ph("Heel Stone as catalogued for 1625", 1, null,
      { kind: "megaliths", catalogue: { sets: ["heel", "heel-companion"], state: "1625" } },
      { continues: true, dateNote: YEAR1 }),
  ],
  sources: ["sto-wiki-heel-stone", "sto-darvill-2012-remodelled", "sto-eh-stones", "sto-sos-stones", "sto-stukeley-1740", "sto-barclay-1895", "sto-osm-overpass"],
});

// ---- Aubrey Holes
lm({
  id: "aubrey-holes", name: "Aubrey Holes", ...MON,
  evidence: "attested-excavated", confidence: "medium",
  summary: "Fifty-six chalk pits in a ring about 87 m across (circumference 271.6 m), just inside the bank, each about 1.06 m wide and 0.76 m deep on average. Cremations were inserted in their upper fills.",
  uncertainty: "Count, ring and size are well attested; the function is not (stones, posts or neither: see the bluestone landmark). The holes may predate the ditch (the cremated woman beside hole 7 is 98% likely older). How long they stayed open and when they were filled are NOT known: the open phase to 2500 BCE and the filled dimples afterwards are a modelled convention. Only about 34 of the 56 were excavated.",
  phases: [
    ph("Aubrey Holes: open pits with chalk rims", -3000, -2500,
      { kind: "pit-ring", r: 43.3, count: 56, pitR: 0.53, jitter: 0.1, filled: false, surface: "chalk" },
      { built: -2990, end: "handover", dateNote: "Dug c. 3000 BCE (Darvill et al. 2012 Stage 1, 3000-2620 BCE; the holes may be earlier)." }),
    ph("Aubrey Holes: filled, visible as dimples", -2500, null,
      { kind: "pit-ring", r: 43.3, count: 56, pitR: 0.53, jitter: 0.1, filled: true, surface: "turf" },
      { continues: true, dateNote: "The date of filling is not known; 2500 BCE is a convention. They were refilled and later rediscovered by Aubrey (1666) as hollows; still visible as dimples in 1625 is a modelling choice." }),
  ],
  sources: ["sto-wiki-aubrey-holes", "sto-darvill-2012-remodelled", "sto-marshall-2012-eh-chronology"],
});

// ---- ditch and bank
const DITCH = { r: 53, ditchW: 5, bank: "inner", bankW: 6, bankH: 1.5, bankGap: 0.5, gaps: [[39.9, 59.9], [173, 187]] };
lm({
  id: "stonehenge-ditch-bank", name: "Stonehenge ditch and bank", ...MON,
  evidence: "attested-excavated", confidence: "medium",
  summary: "A circular bank with an external ditch, about 110 m across overall, with a wide entrance to the north-east on the solstice axis and a smaller one to the south. Ditch dug with antler picks; re-cut in Stage 3. Drawn with the ditch centreline at radius 53 m.",
  uncertainty: "The overall diameter (c. 110 m) is attested; the ditch and bank profile are NOT (width 5 m, bank 6 m wide and 1.5 m high are modelled; a hint of ditch 1.2-2.3 m deep and bank 5-6 m wide comes from a source I could not read). Entrance widths are not recorded (here 20 degrees NE, 14 degrees S, an unsourced visual choice; the S entrance azimuth is approximate). Whether the ditch was dug in segments is not stated in the sources read, so it is drawn continuous. The date of the re-cut (2350 BCE here) is only bracketed (after 2450-2230 BCE). The smaller outer bank (counterscarp) is inferred to be the re-cut spoil. Later erosion is not dated: the lowered bank from year 1 CE is a convention; by Stukeley's time bank and ditch were still visible.",
  phases: [
    ph("Ditch and bank dug: fresh chalk", -3000, -2900,
      { kind: "henge", ...DITCH, surface: "chalk" },
      { built: -2950, end: "handover", dateNote: "Darvill et al. 2012 Stage 1 (3000-2620): ditch construction completed 2990-2755 BCE (95%), probably 2955-2830 (68%); modelled 2900 BCE. Dug 3000-2950 in the animation." }),
    ph("Weathering", -2900, -2700,
      { kind: "henge", ...DITCH, surface: "weathering" },
      { continues: true, end: "handover", dateNote: "Weathering (chalk showing through patchy turf) is a modelled convention; no source dates the greening." }),
    ph("Grassed earthwork", -2700, -2350,
      { kind: "henge", ...DITCH, surface: "turf" },
      { continues: true, end: "handover", dateNote: "Grassed over by 2700 BCE (modelled)." }),
    ph("Ditch re-cut (Stage 3): fresh chalk, outer counterscarp bank", -2350, -2250,
      { kind: "henge", ...DITCH, counterscarp: { w: 3, h: 0.6 }, surface: "chalk" },
      { continues: true, end: "handover", dateNote: "Darvill et al. 2012 Stage 3 (2480-2280): ditch re-cut, terminus post quem 2450-2230 BCE; 2350 BCE is a modelled mid-point. Counterscarp bank inferred to be the spoil." }),
    ph("Weathering after the re-cut", -2250, -2100,
      { kind: "henge", ...DITCH, counterscarp: { w: 3, h: 0.6 }, surface: "weathering" },
      { continues: true, end: "handover", dateNote: "Modelled." }),
    ph("Grassed earthwork", -2100, 1,
      { kind: "henge", ...DITCH, counterscarp: { w: 3, h: 0.6 }, surface: "turf" },
      { continues: true, end: "handover", dateNote: "Grassed by 2100 BCE (modelled)." }),
    ph("Silted and slumped earthwork, as seen by the first drawings", 1, null,
      { kind: "henge", ...DITCH, bankW: 7, bankH: 0.9, counterscarp: { w: 3, h: 0.3 }, surface: "turf", lining: false },
      { continues: true, dateNote: "Erosion and silting are undated; the lowered, spread bank (0.9 m high, 7 m wide) from year 1 CE is a convention. The ditch was largely silted long before 1625 (EH). The outer bank was ploughed away later." }),
  ],
  sources: ["sto-darvill-2012-remodelled", "sto-eh-description", "sto-eh-history", "sto-marshall-2012-eh-chronology"],
});

// ---- solstice markers
for (const [id, name, az, which] of [
  ["solstice-sunrise-marker", "Midsummer sunrise marker (computed)", 49.2, "sunrise on the midsummer solstice"],
  ["solstice-sunset-marker", "Midwinter sunset marker (computed)", 230.0, "sunset on the midwinter solstice"],
]) {
  lm({
    id, name, ...MON,
    evidence: "reconstructed", confidence: "medium",
    summary: `A computed marker for the Events menu: the direction of ${which} seen from the centre of Stonehenge in 2500 BCE, azimuth ${az} degrees. It is an analytical overlay, not a structure and not lighting. The lead computed the azimuth for 2500 BCE, latitude 51.179, obliquity 23.97 degrees, with the horizon assumed at 0.6 degrees.`,
    uncertainty: "The azimuth depends on the unknown horizon elevation (0-1 degree shifts it by about 1 degree), refraction and the choice of limb; no source gives a survey azimuth of the axis. Which solstice the builders intended is debated (Ruggles favours midwinter; Parker Pearson allows midsummer). Present only in 2500 BCE.",
    phases: [
      ph(`Computed ${which} line, 2500 BCE`, -2500, -2499, { kind: "sightline", az, length: 1800, el: 0.4, sun: true },
        { dateNote: "Shown only in the year 2500 BCE (sightline is a staged kind: present from the start of `from` to the start of `to`). Azimuth computed for 2500 BCE, not measured." }),
    ],
    sources: ["sto-skyatnight-astronomy", "sto-wiki-archaeoastronomy", "sto-darvill-2012-remodelled"],
  });
}

// =====================================================================================================================
// THE LANDSCAPE
// =====================================================================================================================
const AGE = (landmark_from, tag) => landmark_from; // (placeholder to keep calls readable)

// helper: chalk -> weathering -> grass (-> optional later "ploughed-down" phase at year 1)
function earthPhases({ kind, params, from, built, chalkTo, weatherTo, plough, ploughParams, label, extra = {}, ploughNote }) {
  const ph1 = ph(`${label}: fresh chalk`, from, chalkTo, { kind, ...params, surface: "chalk" }, { built, end: "handover", dateNote: extra.dateNote });
  const ph2 = ph(`${label}: weathering`, chalkTo, weatherTo, { kind, ...params, surface: "weathering" }, { continues: true, end: "handover", dateNote: "Weathering (chalk showing through patchy turf) is a modelled convention." });
  if (!plough) return [ph1, ph2, ph(`${label}: grassed`, weatherTo, null, { kind, ...params, surface: "turf", lining: false }, { continues: true, dateNote: "Grassed by this date (modelled)." })];
  return [
    ph1, ph2,
    ph(`${label}: grassed`, weatherTo, 1, { kind, ...params, surface: "turf", lining: false }, { continues: true, end: "handover", dateNote: "Grassed by this date (modelled)." }),
    ph(`${label}: ploughed-down earthwork`, 1, null, { kind, ...params, ...ploughParams, surface: "turf", lining: false }, { continues: true, dateNote: ploughNote }),
  ];
}
const PLOUGH_NOTE = "Later ploughing and silting are undated; lowering at year 1 CE is a convention. In 1625 the earthwork was a low, partly ploughed-down bank; it was ploughed further after 1625.";

// ---- Greater and Lesser Cursus
const gcPath = F["cursus-greater"].path;
lm({
  id: "greater-cursus", name: "Greater Stonehenge Cursus", lat: F["cursus-greater"].lat, lon: F["cursus-greater"].lon, bearing: 84.6, path: gcPath,
  evidence: "attested-excavated", confidence: "medium",
  summary: "A great banked and ditched enclosure about 2.75 km long and about 100 m wide, running ENE (bearing 84.6 degrees) north of Stonehenge, closed at both ends. Earlier than the stones.",
  uncertainty: "Length (2751 m, from the OSM outline) and width (about 100 m, 75-133 m on the outline; Wikipedia up to 150 m at the west) are surveyed from earthwork traces; bank height and width are NOT recorded anywhere I could read (bank 5 m wide, 0.8 m high are modelled), nor whether the banks were inside or outside the ditches. Antler dates: 3630-3375 BCE (west terminal ditch) with a possibly older pick (Thomas et al. 2009); EH says c. 3500 BCE; re-cuts are reported c. 2500 and 2000-1500 BCE and are not drawn. Three possible entrances (N and two S) are not drawn. The route is the OSM outline's axis, simplified.",
  phases: earthPhases({
    kind: "banked-avenue", params: { width: 100, bankW: 5, bankH: 0.8, ditchW: 2.8, closed: true }, from: -3550, built: -3500, chalkTo: -3200, weatherTo: -2800, plough: true,
    ploughParams: { bankH: 0.35 }, label: "Greater Cursus", ploughNote: PLOUGH_NOTE,
    extra: { dateNote: "Antler from the west terminal ditch 3630-3375 BCE (Wikipedia); EH c. 3500 BCE. Built 3550-3500 in the animation; modelled 3500 BCE." },
  }),
  sources: ["sto-wp-cursus", "sto-antiq-thomas2009", "sto-eh-reconstructed", "sto-eh-history", "sto-wikipedia-cursus", "sto-osm-overpass"],
});

const lcPath = F["cursus-lesser"].path;
lm({
  id: "lesser-cursus", name: "Lesser Stonehenge Cursus", lat: F["cursus-lesser"].lat, lon: F["cursus-lesser"].lon, bearing: 74.7, path: lcPath,
  evidence: "attested-excavated", confidence: "low",
  summary: "A smaller banked and ditched enclosure about 420 m long and 40-60 m wide, running WSW-ENE about 750 m north-west of the west end of the Greater Cursus.",
  uncertainty: "Known only as a cropmark ploughed flat since the Second World War: size from the OSM outline (422 x 40 m; Wikipedia c. 400 x 60 m), bank and ditch sizes modelled (bank 4 m wide, 0.6 m high, width 45 m between crests). Date uncertain: English Heritage puts both cursuses at about 3500 BC (snails from their ditches); antler dated c. 3000 BCE has also been reported (Wikipedia only). Drawn from 3500 BCE following English Heritage; the year is a display date. Its state in 1625 is unknown.",
  phases: earthPhases({
    kind: "banked-avenue", params: { width: 45, bankW: 4, bankH: 0.6, ditchW: 2.5, closed: true }, from: -3550, built: -3500, chalkTo: -3200, weatherTo: -2800, plough: true,
    ploughParams: { bankH: 0.3 }, label: "Lesser Cursus", ploughNote: PLOUGH_NOTE,
    extra: { dateNote: "English Heritage: built about 3500 BC with the Greater Cursus; c. 3000 BCE antler dates also reported (Wikipedia). Display date 3500 BCE (corrected 2026-11-14 after fact review glm-stonehenge-002)." },
  }),
  sources: ["sto-eh-reconstructed", "sto-wp-cursus", "sto-eh-history", "sto-wikipedia-cursus", "sto-osm-overpass"],
});

// ---- long barrows
const LB_NOTE_FORM = "Mound size is surveyed at the surviving earthwork (the mound is lower today than when built); which end was wider is not known.";
function longBarrow(id, name, lat, lon, bearing, l, w, h, ditchW, opt) {
  lm({
    id, name, lat, lon, bearing,
    evidence: "attested-standing", confidence: opt.confidence ?? "medium",
    summary: opt.summary,
    uncertainty: opt.uncertainty + " " + LB_NOTE_FORM,
    phases: earthPhases({
      kind: "long-barrow", params: { l, w, w2: Math.round(w * 0.6), h, ditchW }, from: opt.from, built: opt.built, chalkTo: opt.built + 400, weatherTo: opt.built + 800, plough: false, label: "Long barrow",
      extra: { dateNote: opt.dateNote },
    }),
    sources: opt.sources,
  });
}
longBarrow("amesbury-42", "Amesbury 42 long barrow", F["amesbury-42"].lat, F["amesbury-42"].lon, 2, 62, 20, 2.0, 5, {
  summary: "A long barrow just beyond the east end of the Greater Cursus, aligned north-south, about 62 x 20 m with ditches 11 m wide (as surveyed), levelled by ploughing and now under a track.",
  uncertainty: "Radiocarbon 3640-3370 BCE; whether the cursus or the barrow is older is unknown (EH). Original height unknown (0.29 m survives; 2.0 m drawn); the OSM outline is longer (81 m).",
  from: -3600, built: -3500, dateNote: "Radiocarbon 3640-3370 BCE (OxA-20594); EH antler 3520-3350 BCE. Modelled 3500 BCE.",
  sources: ["sto-ia47-am42", "sto-eh-reconstructed", "sto-wp-cursus", "sto-osm-overpass"],
});
longBarrow("winterbourne-stoke-1", "Winterbourne Stoke 1 long barrow", F["winterbourne-stoke-1"].lat, F["winterbourne-stoke-1"].lon, 31, 84, 27, 3, 6, {
  confidence: "low",
  summary: "The Winterbourne Stoke Crossroads long barrow, 84 x 27 m and 3 m high, NE-SW, later the focus of a round-barrow cemetery.",
  uncertainty: "No radiocarbon date: the date here is a generic placeholder for 4th-millennium BCE long barrows. Ditches 12 m wide are recorded (6 m drawn per ditch).",
  from: -3700, built: -3600, dateNote: "No date: placeholder for the 4th millennium BCE (Internet Archaeology 47).",
  sources: ["sto-ia47-ws1", "sto-ia47-longbarrows", "sto-ia47-index", "sto-osm-overpass"],
});
const ND = F["normanton-down-long-barrow"];
longBarrow("normanton-down-long-barrow", "Normanton Down long barrow (OSM-mapped mound)", ND.lat, ND.lon, 11, 25, 12, 1.6, 4, {
  confidence: "low",
  summary: "A small long barrow on Normanton Down, mapped as a 19 x 9 m mound (bearing 11 degrees). Probably one of the two or three small long barrows EH and Internet Archaeology list here.",
  uncertainty: "Which of Wilsford 30, Amesbury 14 and Wilsford 13 this mapped mound is, is not established (it lies 450 m from the nearest of the two with published coordinates). The OSM outline shows only the surviving mound (19 x 9 m); drawn at 25 x 12 m, a modelled original. No date: placeholder.",
  from: -3700, built: -3600, dateNote: "No date: placeholder for the 4th millennium BCE.",
  sources: ["sto-ia47-longbarrows", "sto-eh-reconstructed", "sto-wp-normanton", "sto-osm-overpass"],
});
longBarrow("wilsford-30-long-barrow", "Wilsford 30 long barrow", 51.168671, -1.838186, 90, 43, 20, 2.3, 4, {
  confidence: "low",
  summary: "A long barrow on Normanton Down, 43 x 20 m and 2.3 m high, aligned west-east, with ditches about 4 m wide.",
  uncertainty: "No date: placeholder for the 4th millennium BCE. A Neolithic mortuary enclosure lies south of one of the Normanton Down long barrows (Wikipedia, not drawn).",
  from: -3700, built: -3600, dateNote: "No date: placeholder for the 4th millennium BCE.",
  sources: ["sto-ia47-wil30", "sto-ia47-longbarrows", "sto-eh-reconstructed", "sto-wp-normanton"],
});
longBarrow("amesbury-14-long-barrow", "Amesbury 14 long barrow", 51.174873, -1.836305, 345, 33, 18, 1.6, 8, {
  confidence: "low",
  summary: "A long barrow near Normanton Down, 33 x 18 m and 1.6 m high, aligned NNW-SSE.",
  uncertainty: "No date: placeholder for the 4th millennium BCE. The ditch width (8 m) is from the survey table; its orientation is given only as NNW-SSE (345 degrees drawn).",
  from: -3700, built: -3600, dateNote: "No date: placeholder for the 4th millennium BCE.",
  sources: ["sto-ia47-am14", "sto-ia47-longbarrows", "sto-eh-reconstructed"],
});
let nUnnamed = 0;
for (const b of geo.barrows.filter((b) => b.form === "long" && !["b008", "b074", "b120"].includes(b.id))) {
  nUnnamed++;
  longBarrow(`long-barrow-osm-${b.id}`, `Long barrow mapped in OSM (${b.id}; unnamed)`, b.lat, b.lon, b.bearing ?? 0, b.length ?? 40, b.width ?? 15, 2, 5, {
    confidence: "low",
    summary: "A long barrow mapped by OpenStreetMap contributors; its name and number in the county record are not given in the sources I read.",
    uncertainty: "Position, length and bearing are from a mapped outline (about 10 m); identification with a numbered barrow (e.g. Durrington 76, Amesbury 140, Wilsford 41) is NOT established. No date: placeholder for the 4th millennium BCE.",
    from: -3700, built: -3600, dateNote: "No date: placeholder for the 4th millennium BCE.",
    sources: ["sto-osm-overpass", "sto-ia47-longbarrows", "sto-ia47-index"],
  });
}

// ---- Stonehenge Avenue
const avPath = F.avenue.path.slice();
{
  // prepend a point on the solstice axis just outside the ditch, so the Avenue starts at the earthwork entrance (extrapolation)
  const B = (49.9 * Math.PI) / 180, R = 57;
  const lat = C.lat - (-R * Math.cos(B)) / MLAT, lon = C.lon + (R * Math.sin(B)) / MLON;
  avPath.unshift([lat, lon]);
}
const AV = { width: 12, bankW: 4, bankH: 0.8, ditchW: 3, berm: 0.4 };
lm({
  id: "avenue", name: "Stonehenge Avenue", lat: avPath[0][0], lon: avPath[0][1], bearing: 49.9, path: avPath,
  evidence: "attested-excavated", confidence: "medium",
  summary: "A processional way of two parallel banks with outside ditches, from the north-east entrance of Stonehenge along the solstice axis for about 530 m, then curving east across Stonehenge Bottom and King Barrow Ridge and down to the River Avon at West Amesbury, about 2.7 km in all. Built in Stage 3.",
  uncertainty: "Course: from the OSM tracing of the ditch-bounded polygons (good to about 5-10 m). The first 35 m (from the earthwork entrance to the start of the mapped polygons) and the last 190 m to the West Amesbury henge are straight EXTRAPOLATIONS. Width: corridor about 12 m between banks, ditches about 20 m apart (EH 2010; OSM polygons 23 m); bank size is modelled. Date: antler picks 2345-2200 BCE, Darvill 2430-2200 BCE; modelled 2315 BCE; built here 2400-2300. No earlier first stretch is attested in the sources read (Parker Pearson argues natural periglacial stripes under it were followed; this does not date a built Avenue). Banks were already low in 1625 (lowered from year 1 CE by convention); ploughing levelled much of it after Stukeley's time.",
  phases: earthPhases({
    kind: "banked-avenue", params: AV, from: -2400, built: -2300, chalkTo: -2200, weatherTo: -2050, plough: true,
    ploughParams: { bankH: 0.4 }, label: "Avenue", ploughNote: PLOUGH_NOTE,
    extra: { dateNote: "Darvill et al. 2012 Stage 3 (2480-2280); EH: antlers 2345-2200 BCE; modelled 2315 BCE, built within 2400-2300 BCE here." },
  }),
  sources: ["sto-eh-reconstructed", "sto-wp-avenue", "sto-wiki-stonehenge-avenue", "sto-darvill-2012-remodelled", "sto-eh-description", "sto-ea-survey-2010", "sto-osm-overpass"],
});

// ---- Durrington Walls
const DW = F["durrington-walls"];
const DWH = { rx: 213, rz: 227, bearing: 90, ditchW: 14, bank: "outer", bankW: 25, bankH: 3, bankGap: 0.5 };
const DWGAPS_EARLY = [[356.5, 3.5], [86.5, 93.5], [176.5, 183.5]];
lm({
  id: "durrington-walls-henge", name: "Durrington Walls henge", lat: DW.lat, lon: DW.lon, bearing: 90,
  evidence: "attested-excavated", confidence: "medium",
  summary: "The largest henge in Britain: a circular enclosure about 500 m across with a huge outer bank about 3 m high and a deep ditch, built c. 2480-2450 BCE over the line of an earlier ring of timber posts, beside the Neolithic village on the slope to the Avon.",
  uncertainty: "Position (centre +/-60 m) and outline are an ELLIPSE (466 x 490 m, Gazetteer of Great Britain), NOT a surveyed outline. Ditch about 5.5 m deep, 18 m wide at the top, 7 m at the base (Wikipedia; Current Archaeology gives other figures); modelled ditch 14 m wide, bank 25 m wide and 3 m high (up to 30 m wide in Wikipedia). Entrances: sources CONFLICT (N, S and E, with N and S blocked 2-3 centuries later, per Current Archaeology; Wikipedia lists NW and SE). The first reading is drawn, with entrances 14 m wide (unsourced). In 1625 the earthwork is shown ploughed down (bank 1.8 m): that change is undated and a convention.",
  phases: [
    ph("Henge dug: fresh chalk, three entrances", -2480, -2430, { kind: "henge", ...DWH, gaps: DWGAPS_EARLY, surface: "chalk" },
      { built: -2460, end: "handover", dateNote: "Completed c. 2480-2450 BCE along the old post-pit line (Current Archaeology / Bristol). Modelled 2460 BCE." }),
    ph("Henge weathering", -2430, -2250, { kind: "henge", ...DWH, gaps: DWGAPS_EARLY, surface: "weathering" },
      { continues: true, end: "handover", dateNote: "Weathering is a modelled convention." }),
    ph("Henge grassed, N and S entrances blocked (east entrance only)", -2250, 1, { kind: "henge", ...DWH, gaps: [[86.5, 93.5]], surface: "turf" },
      { continues: true, end: "handover", dateNote: "N and S entrances blocked two or three centuries later (c. 2250 BCE, modelled)." }),
    ph("Ploughed-down earthwork", 1, null, { kind: "henge", ...DWH, bankH: 1.8, gaps: [[86.5, 93.5]], surface: "turf" },
      { continues: true, dateNote: "Ploughing is undated; the lowered bank at year 1 CE is a convention." }),
  ],
  sources: ["sto-archco-durrington", "sto-wp-durrington", "sto-wikipedia-durrington", "sto-gazetteer-durrington", "sto-bristol-2007"],
});

lm({
  id: "durrington-timber-ring", name: "Durrington Walls timber ring (beneath the later bank)", lat: DW.lat, lon: DW.lon,
  evidence: "attested-excavated", confidence: "medium",
  summary: "A great ring of up to about 300 timber posts, roughly 5 m apart, 440-450 m across, enclosing the valley and village before the henge bank was raised along the same line.",
  uncertainty: "Post pits are found by radar and excavation; the post height (about 5 m, Current Archaeology; Wikipedia says 7 m and 1.5 m diameter) and whether the ring was a palisade or free-standing posts are inferred. It lasted at most about 50 years, then the posts were pulled and the sockets packed with chalk (the 2015 'standing stones' claim was refuted in 2016). Drawn as a circle of radius 222 m; the real line may be oval.",
  phases: [
    ph("Timber ring of about 300 posts", -2530, -2481, { kind: "timber-circle", rings: [{ r: 222, count: 300, d: 1.0, h: 5, hVar: 0.1 }], material: "timber" },
      { built: -2520, end: "replaced", dateNote: "Current Archaeology: the ring stood for at most about 50 years, its posts were removed and sockets filled before the henge bank (c. 2480-2450 BCE) covered them; when it went up is not directly dated. Display years 2530-2481 BCE so that it is gone when the henge begins (corrected after fact review glm-stonehenge-005)." }),
  ],
  sources: ["sto-archco-durrington", "sto-wp-durrington"],
});

lm({
  id: "durrington-southern-circle", name: "Durrington Walls Southern Circle (timber)", lat: F["durrington-southern-circle"].lat, lon: F["durrington-southern-circle"].lon, bearing: 135,
  evidence: "conjectural", confidence: "low",
  summary: "A circular setting of concentric rings of timber posts inside the henge, oriented to midwinter sunrise (south-east), beside the settlement.",
  uncertainty: "Position only +/-60-100 m (the Wikipedia text cannot be reconciled with the enclosure ellipse). Rings: the sources say four rings, later six; NO ring radii, post counts, sizes or heights are in anything read. The sizes drawn (six rings, outer ring 40 m across, posts 0.7 m thick and 5 m high) are borrowed by analogy from Woodhenge and are CONJECTURAL. Whether it was roofed is unknown. The end date is unknown; posts are shown rotting after 2400 BCE (a placeholder). It was not replaced by stone in anything read.",
  phases: [
    ph("Southern Circle of timber posts (illustrative)", -2520, -2400,
      { kind: "timber-circle", bearing: 135, material: "timber", rings: [
        { r: 6, count: 8, d: 0.6, h: 4 }, { r: 10, count: 14, d: 0.7, h: 4.5 }, { r: 14, count: 20, d: 0.7, h: 5 },
        { r: 17, count: 24, d: 0.7, h: 5 }, { r: 19, count: 28, d: 0.7, h: 5, hVar: 0.15 }, { r: 20, count: 32, d: 0.7, h: 4.5, hVar: 0.15 },
      ] },
      { built: -2500, end: "decay", goneBy: -2300, dateNote: "Wikipedia: c. 2600 BCE with four rings, two more c. 200 years later; Current Archaeology: expanded with c. 200 posts c. 2480-2450 BCE. The accounts conflict; built here 2520-2500 BCE to match the settlement. Decay 2400-2300 BCE is a placeholder." }),
  ],
  sources: ["sto-wp-durrington", "sto-archco-durrington", "sto-wp-woodhenge", "sto-gazetteer-durrington"],
});
lm({
  id: "durrington-northern-circle", name: "Durrington Walls Northern Circle (timber)", lat: F["durrington-southern-circle"].lat + 90 / MLAT, lon: F["durrington-southern-circle"].lon,
  evidence: "conjectural", confidence: "low",
  summary: "A smaller timber circle found by Wainwright in 1966 just north of the Southern Circle.",
  uncertainty: "Nothing is known of its rings, posts, date or end: the two rings of 9 and 12 m radius, 5 m posts and a position 90 m north of the Southern Circle are placeholders. Decay after 2400 BCE is a placeholder.",
  phases: [
    ph("Northern Circle of timber posts (illustrative)", -2500, -2400,
      { kind: "timber-circle", material: "timber", rings: [{ r: 9, count: 16, d: 0.6, h: 4 }, { r: 12, count: 22, d: 0.6, h: 4 }] },
      { built: -2500, end: "decay", goneBy: -2300, dateNote: "Undated; shown with the Southern Circle (placeholder)." }),
  ],
  sources: ["sto-wp-durrington"],
});

// ---- Woodhenge
const WH = F.woodhenge;
const whRings = (() => {
  const counts = [8, 16, 24, 30, 34, 56]; // sum 168 (the documented total); the split is a visual choice
  const out = [];
  for (let i = 0; i < 6; i++) {
    const f = 0.28 + (0.72 * i) / 5;
    out.push({ rx: +(21.5 * f).toFixed(2), rz: +(20 * f).toFixed(2), count: counts[i], d: 0.7, h: 5.5, hVar: 0.25 });
  }
  return out;
})();
lm({
  id: "woodhenge", name: "Woodhenge (six oval rings of timber posts)", lat: WH.lat, lon: WH.lon, bearing: 50,
  evidence: "attested-excavated", confidence: "medium",
  summary: "Six concentric oval rings of timber posts (168 post-holes; outer ring 43 x 40 m), inside a ditch and bank 110 m across overall, with a single north-east entrance, near Durrington Walls.",
  uncertainty: "The 168 post-holes and the outer ring size are excavated. The split of posts between rings, the ring spacing, the post sizes and especially the HEIGHTS (up to 7.5 m, inferred) are modelled; whether the posts stood free, were roofed or lintelled is unknown (lintels are deliberately not drawn). The long-axis bearing of the ovals is not stated in anything read: 50 degrees (towards the NE entrance) is a visual choice. When the posts decayed or were removed is unknown: shown rotting 2350-2150 BCE as a placeholder, although the ditch is dated 2470-2000 BCE and use is reported c. 1800 BCE. Modern concrete markers are not shown. Dating: Historic England 2024 puts the timber settings at 2635-2575 cal BC and the ditch and bank 75-440 years later; the old single date (ditch 2470-2000 BCE) is superseded.",
  phases: [
    ph("Woodhenge: six oval rings of timber posts (all rings drawn together)", -2635, -2500, { kind: "timber-circle", bearing: 50, material: "timber", rings: whRings },
      { built: -2610, end: "decay", goneBy: -2350, dateNote: "Historic England Research Report 94/2024 (as summarised): timber monument built 2635-2575 cal BC (95%), most likely 2635-2610; drawn 2635-2610 BCE. Ditch and bank are a separate, later landmark (interval 75-440 years). Decay 2500-2350 BCE is a placeholder; the rings may not all have decayed together (corrected after fact review glm-stonehenge-007)." }),
  ],
  sources: ["sto-he-woodhenge-2024-summary", "sto-wp-woodhenge", "sto-wikipedia-woodhenge", "sto-osm-overpass"],
});
const WHH = { r: 38, ditchW: 10, bank: "outer", bankW: 10, bankH: 1.0, gaps: [[40, 60]] };
lm({
  id: "woodhenge-henge", name: "Woodhenge ditch and bank", lat: WH.lat, lon: WH.lon, bearing: 50,
  evidence: "attested-excavated", confidence: "medium",
  summary: "The ditch (up to 12 m wide, 2.4 m deep) and bank (10 m wide, 1 m high) enclosing Woodhenge, 110 m across overall, with a north-east entrance.",
  uncertainty: "Overall diameter, widths and heights are from Wikipedia; whether the bank lay outside the ditch is assumed (outer, as for a henge); the ditch radius (38 m) is derived from 110 m overall. Entrance width (20 degrees) is a visual choice. Ploughing and levelling are mentioned but undated; the low grassed bank in 1625 is a modelling choice.",
  phases: earthPhases({
    kind: "henge", params: WHH, from: -2420, built: -2400, chalkTo: -2330, weatherTo: -2200, plough: false, label: "Woodhenge ditch and bank",
    extra: { dateNote: "Historic England 2024: ditch and bank 2495-2180 cal BC (93%), most likely 2465-2345; display date 2400 BCE (corrected after fact review glm-stonehenge-007)." },
  }),
  sources: ["sto-he-woodhenge-2024-summary", "sto-wp-woodhenge", "sto-wikipedia-woodhenge"],
});

// ---- Coneybury
const CB = F["coneybury-henge"];
lm({
  id: "coneybury-henge", name: "Coneybury henge", lat: CB.lat, lon: CB.lon, bearing: 90,
  evidence: "attested-excavated", confidence: "low",
  summary: "An oval ditched enclosure about 45 x 55 m south-east of Stonehenge, excavated in the 1980s; the ditch was about 4 m wide and 3 m deep. Levelled by ploughing.",
  uncertainty: "NO absolute date was found: the 2700 BCE start is a placeholder (pottery from the early Neolithic to the Middle Bronze Age). Whether it had a bank, inside or outside, is not documented (none drawn). Orientation of the oval is unknown (drawn long axis east-west). The levelling is thought to be medieval ridge-and-furrow ploughing: shown decaying 1200-1500 CE as a placeholder. The Coneybury Anomaly pit (early Neolithic, 12 m NW) is not drawn.",
  phases: [
    ph("Coneybury henge: fresh chalk", -2700, -2500, { kind: "henge", rx: 27.5, rz: 22.5, bearing: 90, ditchW: 4, bank: "none", surface: "chalk" },
      { built: -2690, end: "handover", dateNote: "Placeholder date; no absolute date retrieved." }),
    ph("Coneybury henge: weathering", -2500, -2200, { kind: "henge", rx: 27.5, rz: 22.5, bearing: 90, ditchW: 4, bank: "none", surface: "weathering" }, { continues: true, end: "handover", dateNote: "Weathering is a modelled convention." }),
    ph("Coneybury henge: grassed, silting ditch", -2200, 1200, { kind: "henge", rx: 27.5, rz: 22.5, bearing: 90, ditchW: 4, bank: "none", surface: "turf" },
      { continues: true, end: "decay", goneBy: 1500, dateNote: "Levelled by ploughing, plausibly medieval (Wikipedia); 1200-1500 CE is a placeholder." }),
  ],
  sources: ["sto-wp-coneybury", "sto-osm-overpass"],
});

// ---- West Amesbury (Bluestonehenge)
const WA = F.bluestonehenge;
lm({
  id: "west-amesbury-henge", name: "West Amesbury henge and 'Bluestonehenge'", lat: WA.lat, lon: WA.lon,
  evidence: "reconstructed", confidence: "low",
  summary: "On the Avon bank at the end of the Avenue: a circle of about 25 stones (probably bluestones, from the shape of the sockets), later removed, then a small henge (ditch about 25 m across, outer bank).",
  uncertainty: "Only stone sockets survive; their stones are inferred to be bluestones, ring about 10 m across, up to about 27 sockets (25 drawn). Erection date UNCERTAIN (Wikipedia 3400-2500 BCE from two arrowheads; 3000 BCE is a guess); the stones were removed 2469-2286 BCE (antler dates), perhaps to Stonehenge (unproven); the ditch and outer bank c. 2400 BCE. 'Ditch about 25 m wide' is taken as the ring's diameter. Position is approximate (OSM: 'approximate location from photos').",
  phases: [
    ph("Circle of about 25 stones (bluestones inferred)", -3000, -2400,
      { kind: "megaliths", rings: [{ type: "bluestone", r: 5.0, count: 25, ...SIZE_B, h: [1.2, 2.0], jitter: 0.2, state: "standing", seed: 61 }] },
      { built: -2990, end: "replaced", dateNote: "Erection date a guess (3000 BCE; Wikipedia range 3400-2500 BCE). Removal dated 2469-2286 BCE; 2400 BCE modelled." }),
    ph("Small henge: ditch and outer bank, fresh chalk", -2400, -2300, { kind: "henge", r: 12.5, ditchW: 4, bank: "outer", bankW: 4, bankH: 0.8, surface: "chalk" },
      { built: -2390, end: "handover", dateNote: "Ditch and outer bank c. 2400 BCE (Wikipedia)." }),
    ph("Small henge: weathering", -2300, -2100, { kind: "henge", r: 12.5, ditchW: 4, bank: "outer", bankW: 4, bankH: 0.8, surface: "weathering" }, { continues: true, end: "handover", dateNote: "Weathering is a modelled convention." }),
    ph("Small henge: grassed, faint bank", -2100, null, { kind: "henge", r: 12.5, ditchW: 4, bank: "outer", bankW: 4, bankH: 0.5, surface: "turf" },
      { continues: true, dateNote: "Still a faint bank by 1625 (modelling choice)." }),
  ],
  sources: ["sto-wp-bluestonehenge", "sto-wikipedia-bluestonehenge", "sto-wp-avenue", "sto-darvill-2012-remodelled"],
});

// ---- Cuckoo Stone
const CK = F["cuckoo-stone"];
lm({
  id: "cuckoo-stone", name: "Cuckoo Stone", lat: CK.lat, lon: CK.lon,
  evidence: "reconstructed", confidence: "low",
  summary: "A squat sarsen set up in a pit between Woodhenge and Durrington Walls, with cremations around it c. 2000 BCE. It lies fallen today.",
  uncertainty: "No dimensions are in the sources read: 1.8 x 1.2 m and 1.3 m high are INVENTED to suit 'squat'. It was erected before 2000 BCE (2800 BCE is a placeholder); a post first stood in the socket. When it fell is unknown, so it is drawn standing throughout; it may have fallen at any time before 1625.",
  phases: [
    ph("Cuckoo Stone standing", -2800, null,
      { kind: "megaliths", stones: [{ id: "cuckoo", type: "sarsen", role: "outlier", x: 0, z: 0, w: 1.8, t: 1.2, h: 1.3, state: "standing" }] },
      { built: -2790, dateNote: "Erected before 2000 BCE (Wikipedia); 2800 BCE is a placeholder." }),
  ],
  sources: ["sto-wp-cuckoo", "sto-wikipedia-cuckoo-stone", "sto-osm-overpass"],
});

// ---- barrows
const barrowByGroup = {};
for (const b of geo.barrows) {
  if (b.form === "long" || b.id === "b061") continue; // long barrows and Bush Barrow are separate landmarks
  const g = b.group.replace(" (nearby, unlisted in OSM relation)", "");
  (barrowByGroup[g] = barrowByGroup[g] || []).push(b);
}
const hashId = (s) => [...s].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 7);
const barrowSpec = (b, surface) => {
  const d = Math.max(8, Math.min(40, b.diameter ?? 20));
  return { lat: r6(b.lat), lon: r6(b.lon), form: "bowl", d, h: +Math.max(0.7, Math.min(2.4, d * 0.07)).toFixed(2), surface };
};
function cemetery(id, name, key, extra) {
  const list = barrowByGroup[key];
  const bucket = (b) => { const k = hashId(b.id) % 100; return k < 38 ? 0 : k < 74 ? 1 : 2; };
  const model = (upTo, surf) => ({
    kind: "barrow-group",
    barrows: list.filter((b) => bucket(b) <= upTo).map((b) => barrowSpec(b, bucket(b) === upTo && surf ? "chalk" : "turf")),
  });
  const [clat, clon] = centroid(list.map((b) => [b.lat, b.lon]));
  const note = "Barrow positions are from OpenStreetMap outlines; every FORM is generic (bowl) and the sizes are only the mapped outlines' equivalent circles (clamped to 8-40 m, heights assumed): OSM gives no bell, disc or saucer forms, and Wikipedia says Normanton Down has bells, many discs, a saucer and a pond without saying which. Which barrow was raised when within 2200-1500 BCE is not known: the three build phases assign each barrow to a period by a fixed pseudo-random rule, so the SEQUENCE shown is illustrative.";
  lm({
    id, name, lat: clat, lon: clon,
    evidence: "reconstructed", confidence: "low",
    summary: extra.summary + ` ${list.length} round barrows are drawn.`,
    uncertainty: extra.uncertainty + " " + note + " Tier is set by the group's centre.",
    phases: [
      ph(`${name}: first barrows (fresh chalk)`, -2200, -1950, model(0, true), { built: -2150, end: "handover", dateNote: extra.dateNote }),
      ph(`${name}: more barrows added`, -1950, -1750, model(1, true), { continues: true, end: "handover", dateNote: "Barrows added in this period are drawn in fresh chalk; the older ones are grassed." }),
      ph(`${name}: later barrows added`, -1750, -1550, model(2, true), { continues: true, end: "handover", dateNote: "As above." }),
      ph(`${name}: all grassed`, -1550, null, model(2, false), { continues: true, dateNote: "Grassed barrows stood to 1625; many were dug into by antiquarians in the 18th and 19th centuries (after 1625)." }),
    ],
    sources: extra.sources,
  });
}
cemetery("normanton-down-barrows", "Normanton Down barrows", "Normanton Down Barrows", {
  summary: "A cemetery of round barrows on the ridge south of Stonehenge, burials roughly 2600-1600 BCE; about 35 survived in 1957.",
  uncertainty: "Burials span roughly 2600-1600 BCE; Wilsford G7 is probably 2000-1800 BCE. Bush Barrow has its own landmark.",
  dateNote: "Burials roughly 2600-1600 BCE (Wikipedia); first barrows modelled from 2200 BCE (placeholder), later barrows to 1550.",
  sources: ["sto-wp-normanton", "sto-eh-reconstructed", "sto-osm-overpass"],
});
cemetery("king-barrows", "Old and New King Barrows (King Barrow Ridge)", "Old King Barrows", {
  summary: "Early Bronze Age round barrows along King Barrow Ridge, where the Avenue climbs the ridge (Old and New King Barrows together).",
  uncertainty: "Early Bronze Age only (EH); no dates or counts retrieved beyond the mapped outlines. Old and New King Barrows are merged into one landmark here.",
  dateNote: "Early Bronze Age (EH): first barrows modelled from 2200 BCE (placeholder).",
  sources: ["sto-eh-history", "sto-sarsen2018", "sto-osm-overpass"],
});
// merge New King Barrows into king-barrows (done after: see below)
cemetery("cursus-barrows", "Cursus barrows", "Cursus Barrows", {
  summary: "Round barrows along and around the Greater Cursus, including the one inside its west end and the Monarch of the Plain.",
  uncertainty: "Only the barrow inside the west end of the cursus is attested in the sources read; the mapped group is larger (OSM).",
  dateNote: "Early Bronze Age, after the cursus; first barrows modelled from 2200 BCE (placeholder).",
  sources: ["sto-wp-cursus", "sto-osm-overpass"],
});
cemetery("winterbourne-stoke-barrows", "Winterbourne Stoke Crossroads barrows", "Winterbourne Stoke Crossroads Barrows", {
  summary: "The round-barrow cemetery that grew up around the Winterbourne Stoke 1 long barrow at the crossroads west of Stonehenge.",
  uncertainty: "Counts in the literature (17, 19, 22) conflict and were not confirmed (the Historic England page could not be read); the mapped outlines give 18 round barrows here.",
  dateNote: "Early Bronze Age (general); first barrows modelled from 2200 BCE (placeholder).",
  sources: ["sto-ia47-ws1", "sto-osm-overpass"],
});
cemetery("stonehenge-down-barrows", "Stonehenge Down barrows", "Stonehenge Down Barrows", {
  summary: "A handful of round barrows on Stonehenge Down, south-west and north-west of the stones, some within the detailed district.",
  uncertainty: "Mapped outlines only (OSM); nothing else read about dating or form.",
  dateNote: "Early Bronze Age; first barrows modelled from 2200 BCE (placeholder).",
  sources: ["sto-osm-overpass", "sto-eh-history"],
});
cemetery("lake-barrows", "Lake barrows", "Lake Barrows", {
  summary: "The Lake group of round barrows on the downs south of Normanton Down, at the southern edge of the modelled area.",
  uncertainty: "Mapped outlines only (OSM); nothing else read about dating or form.",
  dateNote: "Early Bronze Age; first barrows modelled from 2200 BCE (placeholder).",
  sources: ["sto-osm-overpass", "sto-eh-history"],
});

// Bush Barrow
const BB = F["bush-barrow"];
lm({
  id: "bush-barrow", name: "Bush Barrow", lat: BB.lat, lon: BB.lon,
  evidence: "attested-excavated", confidence: "medium",
  summary: "The richest Early Bronze Age burial near Stonehenge (gold lozenge, daggers), c. 1950 BCE, 3.3 m high and 49 m across overall, excavated by Cunnington in 1808 (after the period shown).",
  uncertainty: "Date c. 1950 BCE (Wessex culture). Position identified by coordinates within 5 m of a mapped outline. Form shown as a bowl barrow 40 m across with a 2.5 m ditch: the sources give overall diameter (49 m, or 40 m wide) and height only, not the form.",
  phases: [
    ph("Bush Barrow raised: fresh chalk", -1960, -1900, { kind: "barrow", form: "bowl", d: 40, h: 3.3, ditchW: 2.5, berm: 1, surface: "chalk" },
      { built: -1950, end: "handover", dateNote: "c. 1950 BCE (Wikipedia, Bush Barrow)." }),
    ph("Bush Barrow grassed", -1900, null, { kind: "barrow", form: "bowl", d: 40, h: 3.3, ditchW: 2.5, berm: 1, surface: "turf" },
      { continues: true, dateNote: "Grassed by 1900 BCE (modelled); it was undisturbed until 1808." }),
  ],
  sources: ["sto-wp-bushbarrow", "sto-wp-normanton", "sto-osm-overpass"],
});

// scattered round barrows not in a named group
{
  const list = geo.barrows.filter((b) => b.form !== "long" && (b.group === "Other" || b.group.startsWith("Wilsford")) );
  const [clat, clon] = centroid(list.map((b) => [b.lat, b.lon]));
  const m = (surf) => ({ kind: "barrow-group", barrows: list.map((b) => barrowSpec(b, surf)) });
  lm({
    id: "scattered-barrows", name: "Scattered round barrows (incl. Coneybury Barrow)", lat: clat, lon: clon,
    evidence: "reconstructed", confidence: "low",
    summary: `${list.length} isolated round barrows mapped across the landscape that belong to no named group (including the Coneybury Barrow and the Wilsford outlier).`,
    uncertainty: "Mapped outlines only (OSM): positions are good to about 10 m, forms are generic bowls with assumed heights, and no dates exist. The landmark's anchor is the centroid of widely scattered points. All shown from 2200 BCE as a single early Bronze Age placeholder.",
    phases: [
      ph("Scattered barrows: fresh chalk", -2200, -1900, m("chalk"), { built: -2150, end: "handover", dateNote: "Early Bronze Age placeholder." }),
      ph("Scattered barrows: grassed", -1900, null, m("turf"), { continues: true, dateNote: "Grassed by 1900 BCE (modelled)." }),
    ],
    sources: ["sto-osm-overpass", "sto-eh-history"],
  });
}

// ---- Vespasian's Camp
const VC = F["vespasians-camp"];
const vcRing = VC.polygon;
const [vcLat, vcLon] = centroid(vcRing);
const VCP = { bankW: 25, bankH: 4, ditchW: 10, berm: 1 };
lm({
  id: "vespasians-camp", name: "Vespasian's Camp hillfort", lat: vcLat, lon: vcLon, path: vcRing,
  evidence: "attested-standing", confidence: "low",
  summary: "An Iron Age hillfort of about 14 ha on a spur above the Avon, 730 m north-south, with a bank up to 40 m wide and 6 m above the ditch floor, a ditch 10 m wide and an outer counterscarp bank (defences 68 m wide in all).",
  uncertainty: "The CONSTRUCTION DATE IS A PLACEHOLDER: nothing retrieved says more than 'Iron Age' (700-600 BCE shown). The ring is the OSM outline of the rampart, re-sampled to 24 points; no entrance gap is drawn (none known). Bank 25 m wide and 4 m high above ground are modelled from the dimensions quoted (6 m above the ditch floor); the counterscarp is not drawn. The name is Camden's (16th century), not Roman. A medieval road over the hilltop and the 18th-century landscaping are not drawn.",
  phases: [
    ph("Hillfort rampart: fresh chalk", -700, -550, { kind: "rampart", ...VCP, surface: "chalk" },
      { built: -600, end: "handover", dateNote: "Placeholder date: Iron Age, 700-600 BCE." }),
    ph("Hillfort rampart: weathering", -550, -400, { kind: "rampart", ...VCP, surface: "weathering" }, { continues: true, end: "handover", dateNote: "Weathering is a modelled convention." }),
    ph("Hillfort rampart: grassed", -400, null, { kind: "rampart", ...VCP, surface: "turf" }, { continues: true, dateNote: "Grassed by 400 BCE (modelled)." }),
  ],
  sources: ["sto-wp-vespasian", "sto-wikipedia-vespasians-camp", "sto-osm-overpass"],
});

// ---- Amesbury Abbey and the parish church
const AB = F["amesbury-abbey-precinct"];
lm({
  id: "amesbury-abbey", name: "Amesbury Abbey (nunnery, then Fontevraud priory)", lat: 51.171886, lon: -1.784927 - 0.0,
  evidence: "conjectural", confidence: "low",
  summary: "A Benedictine nunnery said to be founded c. 979 by Queen Aelfthryth; dissolved by Henry II in 1177 and refounded as a Fontevraud priory; dissolved at the Dissolution (1539 or 1540) and demolished, the estate going to Edward Seymour, Earl of Hertford.",
  uncertainty: "Dates: foundation c. 979, 1177 refoundation (Wikipedia); the Dissolution is given as 1540 (Amesbury article) while the brief says 1539: 1540 is used. The BUILDINGS are unknown: no plan, no precinct boundary (the geography notes give only a placeholder rectangle), and no source for the conventual church's form or position. The church here is a generic stand-in, placed beside the parish church (about 45 m west of it): the parish church St Mary and St Melor may itself be the surviving priory church (Wikipedia). The 979 church and the 1177 priory church are drawn identically because nothing says the fabric changed. The date of demolition after the Dissolution is unknown; shown decaying until 1580 as a placeholder.",
  phases: [
    ph("Benedictine nunnery church (form unknown)", 979, 1177, { kind: "church", l: 32, w: 11, h: 8, aisles: false, roof: "thatch", wall: "ragstone" },
      { built: 990, end: "handover", dateNote: "Founded c. 979 (Wikipedia); the building date of the church is a placeholder." }),
    ph("Fontevraud priory church, new building 1177-1186 (form unknown)", 1177, 1540, { kind: "church", l: 32, w: 11, h: 8, aisles: false, roof: "thatch", wall: "ragstone" },
      { built: 1186, end: "decay", goneBy: 1580, dateNote: "Refounded 1177 as a Fontevraud priory; Henry II then built a new house and church, ready when the nuns moved in on 30 November 1186 (VCH Wilts vol 3). Dissolved c. 1539-1540 (sources differ). Demolition undated; gone by 1580 is a placeholder (corrected after fact review glm-stonehenge-004)." }),
  ],
  sources: ["sto-vch-wilts3-amesbury-priory", "sto-wp-amesburyabbey", "sto-wikipedia-amesbury-abbey", "sto-wp-amesbury"],
});
lm({
  id: "st-mary-and-st-melor", name: "Parish church of St Mary and St Melor, Amesbury", lat: 51.171886, lon: -1.784282,
  evidence: "attested-standing", confidence: "low",
  summary: "The Grade I parish church of Amesbury, which may be the surviving priory church. It survived the demolition of the priory.",
  uncertainty: "The sources read give no date for the building and no plan: shown from 1177 as a placeholder and drawn as a generic aisled church with a west tower (the real form and any 1625 alterations are not modelled). Whether it is the priory church or an earlier parish church is unresolved.",
  phases: [
    ph("Parish church (generic form)", 1177, null, { kind: "church", l: 36, w: 14, h: 9, aisles: true, roof: "tile", wall: "ragstone", tower: { w: 6, h: 18 } },
      { built: 1200, dateNote: "Placeholder: the date of the fabric is not in the sources read." }),
  ],
  sources: ["sto-wp-amesburyabbey", "sto-wp-amesbury", "sto-osm-overpass"],
});
lm({
  id: "amesbury-house", name: "Amesbury Abbey house (Seymour, 16th century)", lat: 51.174502, lon: -1.785392,
  evidence: "conjectural", confidence: "low",
  summary: "After the Dissolution the Crown granted the estate to Edward Seymour, Earl of Hertford, whose family held it until 1675. A Seymour house stood here in the 16th century.",
  uncertainty: "NO description, plan or date of any 16th-century house is in the sources read. The 1661 and 1834-40 mansions are later than the timeline. The position is the OSM point for the present Amesbury Abbey house, the form is a generic hall, and the 1560 date is a placeholder.",
  phases: [
    ph("Seymour house (generic hall, form unknown)", 1550, null, { kind: "hall", l: 36, w: 14, h: 9, wall: "brick", roof: "tile" },
      { built: 1560, dateNote: "Granted to Seymour in the 1540s; house date a placeholder." }),
  ],
  sources: ["sto-wp-amesbury", "sto-wp-amesburyabbey", "sto-wikipedia-amesbury-abbey"],
});

// ---- River Avon
const avon = geo.avon;
const avonPath = avon.path;
const avonMid = mid(avonPath);
lm({
  id: "river-avon", name: "River Avon", lat: avonMid[0], lon: avonMid[1], path: avonPath,
  evidence: "reconstructed", confidence: "medium",
  summary: "The Hampshire (Wiltshire) Avon flowing south from Bulford past Durrington and Amesbury, round Vespasian's Camp and West Amesbury, about 10 km of the river within the modelled area. The Avenue ends on its bank at West Amesbury.",
  uncertainty: "The course is the MODERN centreline (OSM) with side channels and water meadows omitted; the prehistoric and medieval channel will have meandered differently, and the course was changed by water-meadow works. Width 10 m is an estimate, not tagged in OSM. Alder-hazel carr and sedge fringed the floodplain in the Neolithic and Bronze Age, and channel sedimentation rose with clearance c. 800-500 BCE (not modelled).",
  phases: [
    ph("River Avon (modern course)", -4000, null, { kind: "stream", width: 10 },
      { continues: true, dateNote: "Always present; the course shown is modern." }),
  ],
  sources: ["sto-wp-avon", "sto-french2012", "sto-osm-overpass"],
});

// ---- Roman building near the Cuckoo Stone
lm({
  id: "roman-building-cuckoo-stone", name: "Roman building near the Cuckoo Stone", lat: CK.lat - 40 / MLAT * 0.7, lon: CK.lon - 40 / MLON * 0.7,
  evidence: "conjectural", confidence: "low",
  summary: "Excavation south-west of the Cuckoo Stone found a small rectangular Roman building with coins, thought a probable shrine.",
  uncertainty: "Only existence and rough position (south-west of the stone) are attested. Size (12 x 7 m), form, roof and the dates (100-410 CE) are PLACEHOLDERS; it is drawn as a generic hall. Other Roman-period activity (coins and pottery at the stones, a settlement near the Avon, arable colluviation) is not drawn.",
  phases: [
    ph("Small Roman building (generic form)", 100, 410, { kind: "hall", l: 12, w: 7, h: 4, wall: "roman-rubble", roof: "tile" },
      { built: 110, end: "decay", goneBy: 600, dateNote: "Roman Britain 43-410 CE; building dates not known." }),
  ],
  sources: ["sto-wp-cuckoo", "sto-wp-amesbury"],
});

// ---- Bronze Age field systems (illustrative lynchet banks, sample area east of King Barrow Ridge)
{
  // sample block of two long boundaries and two cross boundaries, in local metres, converted to lat/lon
  const proj = (x, z) => [ORIGIN.lat - z / MLAT, ORIGIN.lon + x / MLON];
  const rotate = (x, z, a) => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
  const cx = 1700, cz = 330, ang = (-8 * Math.PI) / 180;
  const line = (x0, z0, x1, z1) => [[x0, z0], [x1, z1]].map(([x, z]) => { const [rx, rz] = rotate(x, z, ang); return proj(cx + rx, cz + rz); });
  const segs = [
    ["a", "northern long boundary", line(-250, -110, 250, -110)],
    ["b", "middle long boundary", line(-250, 0, 250, 0)],
    ["c", "southern long boundary", line(-250, 110, 250, 110)],
    ["d", "cross boundary", line(-30, -110, -30, 110)],
    ["e", "cross boundary", line(120, -110, 120, 110)],
  ];
  for (const [k, nm, p] of segs) {
    const [la, lo] = mid(p);
    lm({
      id: `bronze-age-field-boundary-${k}`, name: `Middle Bronze Age field boundary (${nm}, illustrative)`, lat: (p[0][0] + p[1][0]) / 2, lon: (p[0][1] + p[1][1]) / 2, path: p,
      evidence: "conjectural", confidence: "low",
      summary: "One of five low lynchet banks (an illustrative sample block of fields) standing for the Middle Bronze Age field systems found by survey in the eastern World Heritage Site.",
      uncertainty: "Survey 2015-16 found early fields or enclosures in the eastern WHS, replaced by a major ditch system; sources give only 'Middle Bronze Age'. The LAYOUT here (a block of about 500 x 220 m east of King Barrow Ridge, with this orientation) is invented to illustrate the type: extents, forms (co-axial or not), banks and crops are unknown. Only a low bank is drawn. It persists as a faint lynchet to 1625 (modelling choice; fields may continue into the Iron Age).",
      phases: [
        ph("Lynchet bank (illustrative)", -1500, null, { kind: "hedge", h: 0, width: 2.5, bank: 0.5, gaps: 0.15 },
          { built: -1300, dateNote: "Middle Bronze Age: the 1500-1300 BCE span is a placeholder; fields may continue into the Iron Age (Roberts 2018)." }),
      ],
      sources: ["sto-roberts2018", "sto-sarsen2018"],
    });
  }
}

// merge New King Barrows into king-barrows (re-generate that landmark with both groups)
{
  const i = landmarks.findIndex((l) => l.id === "king-barrows");
  landmarks.splice(i, 1);
  barrowByGroup["Old King Barrows"] = [...barrowByGroup["Old King Barrows"], ...barrowByGroup["New King Barrows"]];
  const before = landmarks.length;
  cemetery("king-barrows", "Old and New King Barrows (King Barrow Ridge)", "Old King Barrows", {
    summary: "Early Bronze Age round barrows along King Barrow Ridge, where the Avenue climbs the ridge (Old and New King Barrows together).",
    uncertainty: "Early Bronze Age only (EH); no dates or counts retrieved beyond the mapped outlines. Old and New King Barrows are merged into one landmark here.",
    dateNote: "Early Bronze Age (EH): first barrows modelled from 2200 BCE (placeholder).",
    sources: ["sto-eh-history", "sto-sarsen2018", "sto-osm-overpass"],
  });
  // keep id order stable: move the new entry to where the old one was
  const n = landmarks.pop();
  landmarks.splice(i, 0, n);
  void before;
}

// =====================================================================================================================
// ZONES
// =====================================================================================================================
const zones = [];
zones.push({
  id: "durrington-houses", label: "Durrington Walls houses (Neolithic village)", style: "neolithic-house",
  shape: { type: "ref", polygon: "durrington-settlement" },
  spacing: 12, fill: 0.8, tier: "overview", grow: [-2506, -2500], decline: [-2500, -2494], declineBy: "abandonment",
  evidence: "conjectural", confidence: "low",
  note: "Eight houses about 5 m square, with clay or chalk floors, central hearths and box-bed and dresser outlines, were excavated inside the later henge on its east side, towards the Avon (2006); modelling puts the village at only about 10-12 years' occupation ending c. 2500-2460 BCE (the 2007 release gave 2600-2500 BCE). The TOTAL NUMBER of houses is not known: 'up to 1000 houses' (Wikipedia) is an upper speculation, 'hundreds of people' the excavators' phrase. About 60 houses (a count chosen to give 'a few dozen') are drawn on a lattice inside the site polygon 'durrington-settlement' (about 1.1 ha on the east side of the enclosure, an approximation); positions are not surveyed. The village was abandoned about when the henge was dug (the ring of posts and the henge bank follow). The model uses a 12-year display window (2506-2494 BCE), a visual convention for the reported 10-12 years, not a measured span (corrected after fact review glm-stonehenge-006).",
  sources: ["sto-bristol-2007", "sto-archco-durrington", "sto-wp-durrington"],
});
zones.push({
  id: "amesbury-town-medieval", label: "Amesbury town (medieval)", style: "medieval",
  shape: { type: "ref", polygon: "amesbury-town" },
  spacing: 24, fill: 0.25, tier: "overview", grow: [980, 1150], decline: [1480, 1560], declineBy: "rebuild",
  evidence: "conjectural", confidence: "low",
  note: "Amesbury was a crossing of the London to Exeter road with 111 households and eight mills at Domesday (1086); a Saxon settlement from the 7th century. Houses are generic, on a lattice, inside the site polygon 'amesbury-town' (an approximation round the OSM town point); the town's real extent and layout in any century are not known. The medieval houses are replaced in place by the tudor style from about 1480-1560 (a visual change of style, not a recorded rebuilding).",
  sources: ["sto-wp-amesbury", "sto-osm-overpass"],
});
zones.push({
  id: "amesbury-town-tudor", label: "Amesbury town (Tudor)", style: "tudor",
  shape: { type: "ref", polygon: "amesbury-town" },
  spacing: 24, fill: 0.25, tier: "overview", grow: [1480, 1560], decline: null,
  evidence: "conjectural", confidence: "low",
  note: "The same lattice as the medieval town, in the taller Tudor style, standing until 1625. A generic stand-in: no source read describes Amesbury's buildings in the 16th and early 17th centuries.",
  sources: ["sto-wp-amesbury"],
});

zones.push({
  id: "open-downland-tree-mask", label: "Open downland round the monument (keeps generated trees off)", style: "neolithic-house",
  shape: { type: "ellipse", lat: 51.17887, lon: -1.8255, rx: 700, rz: 520, bearing: 60 },
  spacing: 40, fill: 0, tier: "overview", grow: [-3300, -3300], decline: null,
  evidence: "reconstructed", confidence: "medium",
  note: "Not a settlement: fill 0, so nothing is drawn. The engine fells its generated woodland trees where a zone grows, so this zone keeps scattered illustrative trees off the stones and the first stretch of the Avenue from c. 3300 BCE. Molluscan and soil evidence from the Cursus and the monument indicates open chalk grassland round Stonehenge by the late 4th millennium BCE (see site.woodland.note); exactly how far the open ground extended at each date is not known.",
  sources: ["sto-french2012", "sto-eh-reconstructed"],
});

// =====================================================================================================================
fs.writeFileSync(path.join(root, "data/locations/stonehenge/landmarks.json"), JSON.stringify(landmarks, null, 1) + "\n");
fs.writeFileSync(path.join(root, "data/locations/stonehenge/zones.json"), JSON.stringify(zones, null, 1) + "\n");
console.log(`gen: ${landmarks.length} landmarks, ${zones.length} zones (${nUnnamed} unnamed OSM long barrows)`);
