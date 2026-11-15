// Generates eras.json, events.json, episodes.json for the Stonehenge site.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const P = fileURLToPath(new URL("../../../", import.meta.url));
const D = path.join(P, "data/locations/stonehenge");
let ground = {};
try { ground = JSON.parse(fs.readFileSync(path.join(P, "research/stonehenge/d1/ground.json"), "utf8")); } catch {}
const gy = (x, z) => ground[`${Math.round(x)},${Math.round(z)}`] ?? 40;
const r2 = (v) => Math.round(v * 100) / 100;
const pts = [];
const cam = (px, pz, ph, tx, tz, th) => {
  pts.push([px, pz], [tx, tz]);
  return { position: [r2(px), r2(gy(px, pz) + ph), r2(pz)], target: [r2(tx), r2(gy(tx, tz) + th), r2(tz)] };
};
const LAT0 = 51.178868, LON0 = -1.8261962, M_LAT = 111195, M_LON = 69750;
const ll = (x, z) => ({ lat: +(LAT0 - z / M_LAT).toFixed(6), lon: +(LON0 + x / M_LON).toFixed(6) });
const dir = (az) => [Math.sin((az * Math.PI) / 180), -Math.cos((az * Math.PI) / 180)];
const NE = dir(49.9);

// ------------------------------------------------------------------ eras
const eras = [
  { id: "earlier-neolithic", name: "Earlier Neolithic landscape", from: -4000, to: -3001, presetYear: -3500,
    blurb: "Before any stone is raised. Woodland is thinning into open chalk grassland. Robin Hood's Ball (just outside this map), long barrows and, by about 3500 BCE, the Greater Cursus mark the first lasting monuments; the Mesolithic pine posts near the later stones are older still and not shown. Dates are approximate and several rest on a single antler." },
  { id: "first-stonehenge", name: "First Stonehenge", from: -3000, to: -2621, presetYear: -2850,
    blurb: "Stage 1 in Darvill et al.'s chronology: a circular ditch and bank about 110 m across with a north-east and a smaller southern entrance, 56 Aubrey Holes (possibly holding the first bluestones, which is argued over) and many cremation burials. Timber structures are inferred from postholes. The model switches the ditch on about 3000 to 2900 BCE; the exact date is a range." },
  { id: "sarsens-durrington", name: "Sarsens and Durrington", from: -2620, to: -2281, presetYear: -2500,
    blurb: "Stages 2 and 3. The trilithons, the sarsen circle and the first bluestone settings go up, c. 2620 to 2480 BCE; the Heel Stone, Slaughter Stone and Station Stones belong here too, with uncertain order. At Durrington Walls a village stands for a decade or so and a great timber circle is replaced by the henge bank, then Woodhenge. The Avenue is laid out in this era. Whether the sarsen circle was ever completed is unresolved." },
  { id: "beaker-bronze-age", name: "Beaker and Early Bronze Age", from: -2280, to: -1501, presetYear: -1900,
    blurb: "Stages 4 and 5. The bluestones are rearranged into an oval and a circle; the Y and Z holes are dug; axe and dagger carvings are made on the sarsens. Beaker burials appear (the Amesbury Archer, c. 2340 to 2300 BCE, lies outside this map). Round barrow cemeteries multiply on the ridges, among them Normanton Down and Bush Barrow." },
  { id: "later-prehistory", name: "Later prehistory", from: -1500, to: 42, presetYear: -600,
    blurb: "Almost nothing is recorded at the stones themselves after the last stone settings (about 1500 BCE). Fields and enclosures spread; the land is largely cleared by 800 to 500 BCE; Vespasian's Camp hillfort is built, with a placeholder date of about 700 to 600 BCE. The model's stone states stay as left." },
  { id: "roman-medieval", name: "Roman to medieval", from: 43, to: 1499, presetYear: 979,
    blurb: "Roman coins and pottery at the stones (late 4th century), a 7th-century execution burial, Amesbury Abbey (founded c. 979, refounded as a priory in 1177) and the first written accounts of the stones (Henry of Huntingdon c. 1130, Geoffrey of Monmouth c. 1136). No dated event changes the stones; which stood or lay by 1625 is inferred from later drawings and plans." },
  { id: "tudor-jacobean", name: "Tudor and Jacobean rediscovery", from: 1500, to: 1625, presetYear: 1620,
    blurb: "The priory is dissolved c. 1540 and the first drawings of the stones appear (de Heere 1573 to 75), then Camden's Britannia (1586) and, in 1620, Inigo Jones's survey for James I and the Duke of Buckingham's dig. These are the earliest views that can anchor the state of the stones." },
];

// ------------------------------------------------------------------ events
const E = (year, label, note, sources) => ({ year, label, note, sources });
const events = [
  E(-3800, "Coneybury Anomaly feasting pit (date unverified)", "An early Neolithic pit with pottery, bone and flints near the later Coneybury henge. The date of about 3800 BCE comes from the project brief and was not confirmed in any source read; treat as uncertain.", ["sto-wp-coneybury"]),
  E(-3600, "Robin Hood's Ball and first long barrows", "Approximate. Robin Hood's Ball (causewayed enclosure, outside this map) is dated 'centuries around 3500 BC' by English Heritage; Amesbury 42 long barrow gave 3640 to 3370 cal BCE. Most other long barrows are undated.", ["sto-wp-robinhood", "sto-ia47-am42", "sto-eh-history"]),
  E(-3500, "Greater Cursus built", "A red deer antler in the west terminal ditch gave 3630 to 3375 BCE; a 2009 paper found another antler about a millennium younger, so the date is debated. Whether the Cursus or the Amesbury 42 barrow is older is unknown.", ["sto-wp-cursus", "sto-antiq-thomas2009", "sto-ia47-am42"]),
  E(-3000, "Stonehenge Stage 1: ditch, bank, Aubrey Holes", "Darvill et al. 2012 Table 3 gives 3000 to 2620 BCE for Stage 1; the ditch itself is modelled at about 2955 to 2830 BCE (68%), and 2990 to 2755 BCE at 95%. The model switches it on in 3001 to 2995 BCE. The Aubrey Holes may predate the ditch.", ["sto-darvill-2012-remodelled", "sto-wiki-aubrey-holes"]),
  E(-2900, "Cremation burials at Stonehenge (c. 3000 to 2600 BCE)", "More than 150 people were probably buried as cremations in the Aubrey Holes and ditch; the span is a range, not an event. One cremated woman beside Aubrey Hole 7 probably predates the ditch.", ["sto-darvill-2012-remodelled", "sto-eh-research", "sto-wiki-aubrey-holes"]),
  E(-2620, "Stage 2 begins: trilithons, bluestone double circle", "Start of Darvill et al.'s Stage 2 (2620 to 2480 BCE). Order within the stage is not settled: trilithons first, then sarsen circle, or all in quick succession.", ["sto-darvill-2012-remodelled"]),
  E(-2560, "Sarsen circle raised (modelled c. 2560 to 2470 BCE)", "The English Heritage Bayesian model puts the sarsen circle at 2580 to 2475 BCE and the trilithons at 2585 to 2400 BCE (93%). The span shown is a modelling choice inside those ranges.", ["sto-marshall-2012-eh-chronology", "sto-darvill-2012-remodelled"]),
  E(-2515, "Durrington Walls village", "Eight houses excavated in 2006 about 5 m square, dated 2600 to 2500 BCE at first; later modelling gives an occupation of only about 10 to 12 years ending c. 2500 to 2460 BCE. The number of houses is unknown (a few dozen is shown, conjecturally).", ["sto-bristol-2007", "sto-archco-durrington"]),
  E(-2480, "Durrington timber ring replaced by the henge bank", "About 300 posts in a ring 440 to 450 m across were pulled and the sockets packed with chalk; the henge bank and ditch were completed c. 2480 to 2450 BCE. Also the start of Stonehenge Stage 3 (2480 to 2280 BCE).", ["sto-archco-durrington", "sto-wp-durrington", "sto-darvill-2012-remodelled"]),
  E(-2470, "Woodhenge ditch dug", "Ditch dated 2470 to 2000 BCE (a wide range). Six oval post rings; the post heights (up to about 7.5 m) are inferred.", ["sto-wp-woodhenge"]),
  E(-2400, "West Amesbury henge (Bluestonehenge): stones removed", "Stone sockets for up to about 27 stones, removed 2469 to 2286 BCE; the ditch and bank are c. 2400 BCE. That the stones were bluestones that went to Stonehenge is suspected, not proven.", ["sto-wp-bluestonehenge"]),
  E(-2340, "Beaker burials: Amesbury Archer and a Stonehenge ditch burial", "The Amesbury Archer (c. 2340 to 2300 BCE, grave outside this map) and a Beaker burial in the Stonehenge ditch (2340 to 2195 BCE) are of similar date.", ["sto-wp-archer", "sto-darvill-2012-remodelled"]),
  E(-2315, "The Avenue is built", "Darvill: 2430 to 2200 BCE; English Heritage: four antler picks date construction to 2345 to 2200 BCE. About 2.5 to 2.8 km long, its first 530 m or so straight on the solstice axis. -2315 is a recommended display date inside the ranges.", ["sto-darvill-2012-remodelled", "sto-eh-reconstructed", "sto-wp-avenue"]),
  E(-2165, "Bluestone circle and oval (Stage 4)", "Stage 4 is 2280 to 2020 BCE: circle modelled at about 2165, oval about 2060 BCE. Around 80 bluestones were used in all; 43 survive as stones or stumps.", ["sto-darvill-2012-remodelled", "sto-marshall-2012-eh-chronology"]),
  E(-1950, "Bush Barrow burial (c. 1950 BCE)", "A rich Early Bronze Age burial on Normanton Down with a gold lozenge plate. The date of about 1950 BCE is from Wikipedia; the other grave goods are not itemised in the research notes.", ["sto-wp-bushbarrow", "sto-wp-normanton"]),
  E(-1800, "Z holes dug (date uncertain)", "English Heritage's model gives 2020 to 1745 BCE; its web page says 1800 to 1500 BCE. The holes were filled with windblown sediment. Purpose unknown.", ["sto-marshall-2012-eh-chronology", "sto-eh-history"]),
  E(-1590, "Y holes dug; carvings on the sarsens", "Y holes 1630 to 1525 BCE (modelled). Axe and dagger carvings are dated 1750 to 1500 BCE. The last prehistoric structural change, with the stone settings ending 1630 to 1340 BCE.", ["sto-marshall-2012-eh-chronology", "sto-darvill-2012-remodelled"]),
  E(-1500, "Middle Bronze Age fields in the east", "A 2015 to 2016 survey found early fields and enclosures in the eastern part of the World Heritage Site. The sources say only 'Middle Bronze Age'; the date shown is the brief's.", ["sto-roberts2018"]),
  E(-700, "Vespasian's Camp hillfort (placeholder date)", "Iron Age hillfort of about 14 ha above the Avon. No construction date was retrieved; c. 700 to 600 BCE is a placeholder. The name comes from Camden and is not Roman.", ["sto-wp-vespasian", "sto-eh-history"]),
  E(375, "Roman coins and pottery at the stones (late 4th century)", "Late 4th-century coins and pottery were found at Stonehenge; Darvill thinks some bluestones were broken or removed in Roman times, his view not shared by all. A Roman building lay near the Cuckoo Stone.", ["sto-eh-history", "sto-wiki-stonehenge", "sto-wp-cuckoo", "sto-darvill-2012-remodelled"]),
  E(660, "Execution burial at Stonehenge (600 to 690 CE)", "A decapitated man aged 28 to 32 was buried inside the stones. One source disputes the range; 'second half of the 7th century' is the safer wording. Low confidence on the exact span.", ["sto-wiki-stonehenge", "sto-eh-history"]),
  E(979, "Amesbury Abbey founded", "A Benedictine house founded c. 979 by Queen Aelfthryth. Its buildings and site within Amesbury are not known from the sources read.", ["sto-wp-amesburyabbey"]),
  E(1086, "Domesday Book: Amblesberie, 111 households, eight mills", "Amesbury already a crossing of the London to Exeter road.", ["sto-wp-amesbury"]),
  E(1130, "Henry of Huntingdon names 'Stanenges' (c. 1130)", "One of England's four wonders in his Historia Anglorum, the stones 'raised up like gates'. The date is approximate.", ["sto-tudortreasures-accounts", "sto-eh-history"]),
  E(1136, "Geoffrey of Monmouth: Merlin and the Giants' Dance (c. 1136)", "In the Historia Regum Britanniae Merlin moves the stones from Mount Killaraus in Ireland. A legend, not evidence of construction.", ["sto-eh-history", "sto-tudortreasures-accounts", "sto-wiki-stonehenge"]),
  E(1177, "Amesbury refounded as a Fontevraud priory", "The abbey was replaced by a priory of the Order of Fontevraud. The medieval buildings are not located in the sources read.", ["sto-wp-amesburyabbey"]),
  E(1457, "Hardyng: stones 'somwat bowand' (c. 1457)", "Hardyng's Chronicle says the stones 'hang' and are somewhat bowed: the only medieval hint of leaning.", ["sto-tudortreasures-accounts"]),
  E(1540, "Amesbury Priory dissolved (1539 or 1540)", "Sources conflict: the project brief says 1539, the Wikipedia Amesbury article says c. 1540. The estate passed to Edward Seymour, Earl of Hertford.", ["sto-wp-amesbury", "sto-wp-amesburyabbey"]),
  E(1574, "Lucas de Heere watercolour (1573 to 75)", "The first view drawn on site. The date is a range; the accompanying text was not read.", ["sto-eh-sources", "sto-bakker-1979-deheere-abstract"]),
  E(1586, "Camden's Britannia describes Stonehenge (1586)", "Three circles within a trench, some stones 28 feet high with lintels on top. 1586 is the first edition; later editions followed.", ["sto-tudortreasures-accounts", "sto-webb-1655-stone-heng"]),
  E(1620, "Inigo Jones surveys for James I; Buckingham digs", "James I visited Wilton in 1620 and commissioned a survey (per Webb's 1655 publication); the same year the Duke of Buckingham made the first known excavation in the centre. Jones's plan is an idealised restoration, not a record.", ["sto-eh-sources", "sto-eh-research", "sto-webb-1655-stone-heng"]),
];

// ------------------------------------------------------------------ episodes
const stones = ll(0, 0);
const axisAt = (d) => [NE[0] * d, NE[1] * d];
const epCam = {};
{
  const t180 = axisAt(180);
  epCam.sunrise = cam(-2, 2, 4, t180[0], t180[1], 2);
  const p110 = axisAt(110), tb = axisAt(-6.5);
  epCam.sunset = cam(p110[0], p110[1], 5, tb[0], tb[1], 4);
  epCam.sarsens = cam(42, 42, 14, 0, 0, 3);
  epCam.durrington = cam(3120, -1080, 70, 2880, -1400, 0);
  epCam.bush = cam(-520, 840, 25, -596, 929, 2);
  epCam.abbey = cam(2650, 1000, 45, 2926, 776, 0);
  epCam.jones = cam(-46, 46, 6, 0, 0, 3);
  epCam.rhb = null;
}
const settle = ll(2890, -1390);
const episodes = [
  {
    id: "stonehenge-midsummer-sunrise-2500bce", name: "Midsummer sunrise along the axis, c. 2500 BCE", year: -2500, fraction: 0.47,
    dateNote: "Late June (about 21 June by the solar year) in the sarsen-circle era. The year is a representative one inside 2580 to 2400 BCE; the day is the solstice by astronomy, not a recorded date.",
    ...stones, inMap: true, view: epCam.sunrise,
    summary: "Looking from inside the circle north-east along the monument's axis, past the Heel Stone and down the first stretch of the Avenue, towards where the sun comes up on the longest day. The scene's one fixed sun is NOT moved: the white line and sun disc are an overlay marking the computed direction (azimuth about 48 to 49 degrees), not real lighting. For 2500 BCE, with the sun's upper edge just visible and standard refraction, the sunrise point is at azimuth 48.2 degrees on a flat horizon or 49.2 degrees if the horizon is raised 0.6 degrees. The Avenue's first straight stretch leaves the stones at about 49.9 degrees (from OpenStreetMap mapping), and the Heel Stone lies at about 51 degrees from the centre, so the sun rose slightly to the left of both. The true horizon height to the north-east was not taken from any source read.",
    attested: [
      "The monument's main axis runs north-east to south-west, shared by the trilithon horseshoe, the bluestone settings, the sarsen circle and the first stretch of the Avenue (Darvill et al. 2012).",
      "Midsummer sunrise is seen over and slightly to the left of the Heel Stone and falls within the Avenue (Sky at Night).",
      "The first straight stretch of the Avenue leaves the stones at azimuth about 49.9 degrees, measured from OpenStreetMap-mapped earthwork outlines (this project's geography research, not a survey azimuth).",
      "William Stukeley recognised the solstice axis in 1720.",
    ],
    tradition: [
      "That the builders meant midsummer sunrise: Ruggles favours midwinter as the more important; Hawkins's 1960s claims are generally treated as over-optimistic.",
      "That crowds gathered at the stones on this morning in 2500 BCE; the figures are not shown.",
    ],
    unknown: [
      "What, if anything, was done at the stones on midsummer morning, and whether the alignment was meant to be precise to a degree.",
      "The altitude of the true horizon north-east of the stones (woodland, relief): the computed range uses a flat 0 degree and a 0.6 degree horizon as an assumption.",
      "Today the same sunrise is about 1 degree larger in azimuth (49.2 degrees on a flat horizon) because the Earth's axial tilt has fallen from about 24.0 to 23.4 degrees.",
      "Computed with cos A = (sin d - sin phi sin h) / (cos phi cos h), latitude 51.179 degrees, obliquity 23.97 degrees (Laskar series, 2500 BCE), refraction 0.57 degrees, solar semi-diameter 0.27 degrees: my calculation, not a source.",
    ],
    evidence: "reconstructed", confidence: "medium",
    sources: ["sto-darvill-2012-remodelled", "sto-skyatnight-astronomy", "sto-wiki-archaeoastronomy", "sto-osm-overpass", "sto-wikipedia-heel-stone", "sto-ea-survey-2010"],
  },
  {
    id: "stonehenge-midwinter-sunset-2500bce", name: "Midwinter sunset through the Great Trilithon, c. 2500 BCE", year: -2500, fraction: 0.98,
    dateNote: "Late December (about 21 December by the solar year) in the sarsen-circle era; a representative year inside 2580 to 2400 BCE, the day fixed by astronomy.",
    ...stones, inMap: true, view: epCam.sunset,
    summary: "From the Avenue, 110 m north-east of the centre, looking south-west through the circle at the Great Trilithon on the day of the shortest sun. As in the sunrise episode the scene's single fixed sun is not moved: the line and disc are an overlay marking the computed sunset direction. For 2500 BCE, upper edge just visible with standard refraction, the sun set at azimuth 231.0 degrees on a flat horizon or 230.0 degrees if the horizon is raised 0.6 degrees, within about a degree of the reverse of the Avenue's first stretch (229.9 degrees). Ruggles favours midwinter as the more important of the two solstices, and Parker Pearson cites the midwinter feasting at Durrington Walls; that is interpretation. The horizon height to the south-west was not measured from any source read.",
    attested: [
      "From the far end of the Avenue the midwinter sunset can be seen through the central arches (Sky at Night).",
      "The Avenue's first straight stretch, the trilithon horseshoe and the circles share one axis, open to the north-east and facing the Great Trilithon in the south-west (Darvill et al. 2012).",
      "Durrington Walls pig-tooth evidence points to midwinter slaughter and feasting (cited by Parker Pearson in the Sky at Night account).",
    ],
    tradition: [
      "That the monument was built to frame the midwinter sunset (Ruggles's preferred reading; Darvill argues the trilithon layout points to a midwinter focus). Midsummer sunrise as the main intent is the older, popular view.",
      "That people gathered on this evening; none are drawn.",
    ],
    unknown: [
      "What ceremonies took place, and whether the alignment was precise to better than a degree.",
      "The altitude of the south-west horizon, so the exact azimuth range: 230.0 to 231.0 degrees assumes a 0 to 0.6 degree horizon, my assumption.",
      "Today the sunset is about 1 degree larger in azimuth (231.0 degrees flat horizon) than in 2500 BCE. Computed as in the sunrise episode; my calculation, not a source.",
    ],
    evidence: "reconstructed", confidence: "medium",
    sources: ["sto-darvill-2012-remodelled", "sto-skyatnight-astronomy", "sto-wiki-archaeoastronomy", "sto-osm-overpass", "sto-wp-durrington"],
  },
  {
    id: "stonehenge-raising-sarsens", name: "Raising the sarsens", year: -2500, fraction: 0.5,
    dateNote: "c. 2560 to 2470 BCE in the model; the sarsen circle is dated 2580 to 2475 BCE and the trilithons 2585 to 2400 BCE (93%) by the English Heritage Bayesian model. The day is arbitrary.",
    ...stones, inMap: true, view: epCam.sarsens,
    summary: "The great sarsen stones go up. The sarsen circle (30 uprights carrying a ring of 30 lintels) and the five trilithons are built over perhaps a century; the model shows the circle part-way through. The stones were dragged from the Marlborough Downs, about 25 km north, and shaped on site; the lintels were fitted with mortise-and-tenon and tongue-and-groove joints borrowed from carpentry. How they were moved and raised is not known: the stones rising smoothly from the ground is the site's way of showing 'under construction', not a method.",
    attested: [
      "A sarsen circle of 30 uprights and 30 lintels, outer diameter about 29.6 m, was designed (Darvill et al. 2012); the uprights are about 4.1 m high, the lintel tops about 4.9 m above ground.",
      "Five trilithons form a horseshoe about 13.7 m across, open to the north-east; the tallest stone (56) stands about 6.7 m above ground with about 2.4 m buried.",
      "Radiocarbon dating of an antler in the socket of stones 53 and 54 gives 2585 to 2400 BCE (93%).",
      "The sarsens come from the Marlborough Downs about 25 km north (English Heritage; Nash et al. 2020, from a search summary only).",
    ],
    tradition: [
      "Geoffrey of Monmouth's tale that Merlin brought the stones from Ireland (1136) is legend.",
    ],
    unknown: [
      "How the stones were transported and raised, how many people it took and how long it took.",
      "Whether the sarsen circle was ever completed: stones 13, 17, 18, 20 and 24 and 24 lintels are missing today. Ashbee argued it was never finished; Darvill thinks it was robbed; parchmarks from 2013 hint at a complete circle. Unresolved.",
      "The order of the trilithons, circle and bluestone settings within Stage 2.",
    ],
    evidence: "reconstructed", confidence: "medium",
    sources: ["sto-darvill-2012-remodelled", "sto-marshall-2012-eh-chronology", "sto-eh-stones", "sto-eh-research", "sto-wiki-stonehenge", "sto-banton-2014-abstract"],
  },
  {
    id: "durrington-midwinter-feast-2500bce", name: "Midwinter feasting at Durrington Walls, c. 2500 BCE", year: -2500, fraction: 0.98,
    dateNote: "Late December in a representative year of the village's decade or so of use (c. 2515 to 2480 BCE in the model). The village is dated 2600 to 2500 BCE (2007 release) and, by later modelling, to roughly 10 to 12 years ending 2500 to 2460 BCE.",
    ...settle, inMap: true, view: epCam.durrington,
    summary: "A village of small square houses with clay floors stands inside the great timber ring at Durrington Walls, about 2.8 km east of Stonehenge on the Avon. Pig teeth from the site point to animals slaughtered in the winter, and the Southern Circle there is oriented to the midwinter sunrise; the usual reading is that people came here for midwinter feasts and, after the village was abandoned, the timber ring was replaced by a henge bank. How many houses there were and how many people came is not known, and none are drawn.",
    attested: [
      "Eight houses about 5 m (16 ft) square, with clay floors, central hearths and box-bed and dresser outlines, were excavated in 2006.",
      "Occupation was brief, about 10 to 12 years, with chalk floors renewed at most nine times (Bayesian modelling).",
      "Pig-tooth evidence points to midwinter slaughter (cited by Parker Pearson in the Sky at Night account); the Southern Circle is oriented to midwinter sunrise (Wikipedia).",
      "Up to about 300 timber posts in a ring 440 to 450 m across stood under the later bank; they were pulled about 2480 BCE.",
    ],
    tradition: [
      "That Durrington's occupants were connected with building or using Stonehenge: widely suggested, not proven by the sources read.",
      "That feasting here was tied to a midwinter gathering at Stonehenge, 'up to 4,000 people' being an upper-end speculation.",
    ],
    unknown: [
      "The number of houses and people (a few dozen houses are drawn, conjecturally), and exactly where in the henge they stood.",
      "What the timber ring and the circles were for; whether the Avenue to the river was walked at this season.",
      "The height of the posts (5 m per the 2016 excavations, 7 m per Wikipedia: conflict).",
    ],
    evidence: "reconstructed", confidence: "medium",
    sources: ["sto-bristol-2007", "sto-archco-durrington", "sto-wp-durrington", "sto-skyatnight-astronomy", "sto-wiki-archaeoastronomy"],
  },
  {
    id: "bush-barrow-burial", name: "Bush Barrow burial, c. 1900 BCE", year: -1900, fraction: 0.5,
    dateNote: "Wikipedia gives c. 1950 BCE for the burial and the Wilsford G7 group 2000 to 1800 BCE; 1900 BCE is a display year inside the uncertainty.",
    ...ll(-596, 929), inMap: true, view: epCam.bush,
    summary: "Bush Barrow, on the Normanton Down ridge about 1.1 km south-south-west of Stonehenge, is a large round barrow about 49 m across and 3.3 m high, holds a rich Early Bronze Age burial with gold, dated about 1950 BCE. The gold lozenge plate measures about 184 by 156 mm. Round barrows of this period fill the ridges around the stones; here the scene is the barrow standing new on the skyline. Who was buried there is not known from the research notes.",
    attested: [
      "Bush Barrow lies on Normanton Down, 3.3 m high and 49 m overall (or 40 m wide by another count).",
      "It held an Early Bronze Age burial with a gold lozenge about 184 x 156 x 1 mm, dated about 1950 BCE.",
      "Normanton Down has about 40 round barrows (bowl, bell, disc and a saucer), of which at least 35 were surviving in 1957, with burials between about 2600 and 1600 BCE.",
    ],
    tradition: [
      "That the burial was a chieftain's or king's: 'chieftain' is a modern label.",
      "That the barrows were meant to be seen from the stones, or the reverse.",
    ],
    unknown: [
      "The buried person's name, status or relation to Stonehenge, and the exact date of the burial.",
      "The barrow's original form: its present shape is modern survey, and the model's 'new' mound is generic.",
      "The other grave goods are not itemised in the research notes for this project.",
    ],
    evidence: "attested-excavated", confidence: "medium",
    sources: ["sto-wp-bushbarrow", "sto-wikipedia-bush-barrow", "sto-wp-normanton", "sto-wikipedia-normanton-down", "sto-osm-overpass"],
  },
  {
    id: "amesbury-abbey-979", name: "Amesbury Abbey founded, 979", year: 979, fraction: 0.5,
    dateNote: "c. 979. The foundation date is approximate; the day is arbitrary.",
    ...ll(2881, 776), inMap: true, view: epCam.abbey,
    summary: "A Benedictine abbey is founded at Amesbury, in the Avon valley east of Stonehenge, by Queen Aelfthryth. It later becomes a Fontevraud priory (1177) and is dissolved about 1540. What it looked like in 979 and where exactly it stood within Amesbury are not known from the sources read; the precinct on the map is a conjectural rectangle by the church, and the buildings are placeholders.",
    attested: [
      "A Benedictine abbey was founded at Amesbury c. 979 by Queen Aelfthryth (Wikipedia).",
      "It was refounded as a Fontevraud priory in 1177 and dissolved c. 1540; the estate went to the Seymours.",
      "The parish church of St Mary and St Melor may be the surviving priory church (Wikipedia; unproven).",
    ],
    tradition: [],
    unknown: [
      "The site, size and form of the 10th-century buildings, and the precinct's boundary.",
      "Whether the Dissolution date is 1539 or 1540: sources conflict.",
    ],
    evidence: "attested-documentary", confidence: "medium",
    sources: ["sto-wp-amesburyabbey", "sto-wp-amesbury", "sto-wikipedia-amesbury-abbey", "sto-osm-overpass"],
  },
  {
    id: "inigo-jones-survey-1620", name: "Inigo Jones surveys Stonehenge for James I, 1620", year: 1620, fraction: 0.6,
    dateNote: "1620; the fraction 0.6 is an arbitrary display value, no month is known from the sources read. The survey and the Duke of Buckingham's digging are both given as 1620, though English Heritage also says 'the 1620s'.",
    ...stones, inMap: true, view: epCam.jones,
    summary: "King James I, visiting Wilton House in 1620, asks the architect Inigo Jones to survey the stones. Jones's plan (published by his pupil John Webb in 1655) shows an idealised, regular monument which he reads as a Roman temple. The same year the Duke of Buckingham has the centre dug, the first known excavation there. The view shows the stones as they are thought to have stood, with the great trilithon down and the south-west trilithon still standing; which stones stood or lay in 1625 is largely inferred. Jones's plan is a restoration, not a record.",
    attested: [
      "Jones surveyed Stonehenge for James I in the 1620s (English Heritage); Webb's 1655 publication reports the king's commission after his visit to Wilton in 1620.",
      "The Duke of Buckingham's digging in the centre is the first known excavation there (English Heritage).",
      "Stone 55 and the Great Trilithon had fallen before the first 17th-century plans (Darvill); the south-west trilithon (57 and 58 with lintel 158) stood until 1797.",
    ],
    tradition: [
      "Jones's claim that Stonehenge was a Roman temple: now rejected.",
    ],
    unknown: [
      "Which other stones were fallen, leaning or broken in 1625: no dated record; the model uses inference from later plans.",
      "How accurately Jones measured: his plan is an ideal geometry and cannot be used as a measured survey.",
    ],
    evidence: "attested-documentary", confidence: "medium",
    sources: ["sto-eh-sources", "sto-eh-research", "sto-webb-1655-stone-heng", "sto-darvill-2012-remodelled", "sto-wiki-stonehenge"],
  },
  {
    id: "robin-hoods-ball-3550bce", name: "Robin Hood's Ball causewayed enclosure, c. 3550 BCE", year: -3550, fraction: 0.5,
    dateNote: "'Centuries around 3500 BC' (English Heritage); Wikipedia: probably built c. 4000 BC, possibly used to c. 3000 BC. Low confidence.",
    ...{ lat: 51.2128, lon: -1.855 }, inMap: false,
    offMap: "Robin Hood's Ball lies about 3.8 km north and 2 km west of the stones, 1 km beyond the north edge of this map, so it cannot be shown here. It is an earlier Neolithic causewayed enclosure with two ditch circuits and low banks, never comprehensively excavated.",
    summary: "One of the first lasting monuments of the Stonehenge landscape, a causewayed enclosure on high ground north of the later Cursus, built when the ditches were fresh white chalk. Its size, internal features and end date are not known.",
    attested: [
      "A causewayed enclosure with two ditch circuits and low banks, with one causeway noted by Wikipedia.",
      "Dated to the centuries around 3500 BCE by English Heritage.",
    ],
    tradition: [],
    unknown: ["Its diameter, internal features and the date it went out of use."],
    evidence: "attested-excavated", confidence: "low",
    sources: ["sto-wp-robinhood", "sto-eh-history", "sto-wikipedia-robin-hoods-ball"],
  },
];
fs.writeFileSync(path.join(D, "eras.json"), JSON.stringify(eras, null, 1) + "\n");
fs.writeFileSync(path.join(D, "events.json"), JSON.stringify(events, null, 1) + "\n");
fs.writeFileSync(path.join(D, "episodes.json"), JSON.stringify(episodes, null, 1) + "\n");
fs.writeFileSync(path.join(P, "research/stonehenge/d1/points-data.json"), JSON.stringify(pts.map(([x, z]) => [Math.round(x), Math.round(z)])));
console.log("events", events.length, "episodes", episodes.length);
