# Barnet site: research notes

Data: `data/locations/barnet/` (site, eras, events, landmarks, zones, episodes, sources). Window 1400–1500.
Compiled 13 November 2026. Started from the Barnet entry in `research/events.json`; everything cited below was fetched again in this pass.

## What the site shows

A 3 × 4 km landscape from Chipping Barnet (south) through Hadley Green to Kitts End and Dancers Hill (north):
the ridge, the main road and its fork, the town, two churches, Old Fold manor, a few hedges, commons, and, for the
year 1471 only, two shaded "areas of possibility", six abstract troop blocks and a ground mist with a low eastern sun.

## Established (with the source that carries it)

- **Battlefield not located.** Foard, Partida and Wilson, *The Barnet Battlefield Project 2015–2018* (ADS PDF, read in
  full text): "we cannot accurately identify the battlefield". Sources put it half a mile to a mile north of the town.
  Hadley Green (registered 1995 after a National Army Museum report) is "problematic": the green is about 350 m wide,
  the road crosses it north–south, there is no hollow for Edward's line, and the putative chapel is far to the north.
  The terrain of Kicks End Common "most closely" fits the accounts; six deployments are considered. Metal-detecting
  (mostly Wrotham Park) found no clear battle scatter. Watson 2022 (London Archaeologist): best guess a 1 km circle
  centred on Kitts End. The Battlefields Trust page says the same and gives about 10,000–12,000 against about 15,000.
- **Roads.** The St Albans road (now Kitts End Road) was the great road in 1471: recorded c. 1220, on or near the
  present line in 1479, first surveyed by Ogilby 1675, then following the modern lane almost exactly. The Hatfield
  road left it where the Highstone now stands and in the late Middle Ages ran just outside the Chase boundary. So the
  fork is at Hadley Highstone, north of Hadley Green, not on the green itself.
- **Relief.** VCH Middlesex: Hadley on a pebble-gravel plateau over 400 ft; a flat ridge of 400–420 ft from Barnet to
  Potters Bar, watershed between the Mimmshall Brook and the Lea. VCH Herts: Barnet church on a ridge about 400 ft.
  A 250 m grid of EU-DEM heights (Open Topo Data) gives about 128–135 m on the plateau, 90–100 m on the west edge of
  the bounds, down to about 69 m in the south-east.
- **Enclosure.** The report finds early, piecemeal enclosure: about two thirds of the later Wrotham Park already in
  named closes by 1479; Old Fold a compact hedged estate when first mapped (1726) but "uncertain if these lands were
  already enclosed by 1471". It notes that no deed or secondary work mentions open field, furlong or strip here.
- **Commons.** Kitts (Kicks) End Heath and Bentley Heath named 1479; Kicks End Common open in 1471 and probably
  larger than at inclosure (1781). Hadley Green: 24 acres, never part of the Chase (VCH).
- **Enfield Chase boundary (Gannick Bank).** Hedge along it in the 1572 perambulation, "a great bank" in 1675, located
  by geophysics in Wrotham Park. The western fringe of the Chase was bare of coppices on a map of 1701.
- **Old Fold.** Frowyk family from soon after 1271 to 1527; manor house mentioned 1310; three sides of the moat survive
  beside the golf club house (VCH South Mimms: Manors).
- **Chipping Barnet.** Market 1199. Chapel of St John: bequest 1361; tower early 15th century; chancel c. 1450; nave
  arcades and clerestory by John Beauchamp (d. 1453); old plan nave about 60 ft × 16–19 ft; largely rebuilt 1875.
- **Monken Hadley church.** Hermitage "in the park of Hadley" c. 1136 (site unknown); listed as a parish church
  c. 1175; "rebuilt c. 1494" (date on tower), "presumably on the site of an older building whose nave may be preserved
  in the later plan"; brown flint with stone dressings (VCH); list entry: flint and ironstone. So a church stood there
  in 1471 but its form is unknown. The idea that the rebuild followed battle damage appears only on Wikipedia.
- **Battle chapel.** Great Chronicle of London c. 1512: dead buried on the plain, "a lytyll Chapell" built after;
  still in use 1519–20; a house by Stow's time. Identified since 1970 with the moated "Hermitage" on Kicks End Common;
  2017–19 geophysics and test pits confirmed the moat, found no chapel and no graves.
- **Texts.** Arrivall (transcription fetched): "undre an hedge-syde", "more some what than an halfe myle", guns
  "alway ovarshote", "a greate myste", not "frount to frount", west and east ends overreaching, flight "towards Barnet,
  and so forthe to London", between four and five o'clock, three hours, 9,000 against 30,000. Warkworth (fetched):
  20,000 for Warwick, four to ten o'clock, the star and sun story, 4,000 dead.
- **Kitts End.** Existed by 1479; extent then unknown, possibly only the west side of the road; the large hamlet is
  17th–18th century (VCH: "large hamlet" by 1658).

## Could not establish

- Historic England's list entry (1000001) and battlefield report: HTTP 403 on both URLs. The registered boundary in
  the data is therefore my approximation from descriptions, not the official polygon.
- web.archive.org copies of the Richard III Society texts could not be fetched; a different transcription of the
  Arrivall was used. Wikipedia's Kitts End page returned 404.
- No source for: the 1471 extent of Barnet town, Hadley village or Kitts End; any building dimensions other than the
  old plan of Barnet chapel; the form of the 1471 Hadley church or of Old Fold manor house; the date the battle chapel
  was founded; where Dead Man's Bottom is (three maps disagree; the report doubts the battle link) — it is described
  in the episode text and not drawn.
- Von Wesel's newsletter, the Great Chronicle, Hall and Rastell were read only as quoted in the project report.
- "Hadley windmill" is a boundary mark in 1572; no 15th-century evidence, so it is not shown. Pinchbank (house first
  recorded 1310, tenant William Rutlond 1479, perhaps where Exeter was carried) cannot be placed closely; not shown.

## Coordinates and heights

- Origin 51.6610 N, 0.1990 W: middle of Hadley Green on the A1000. Bounds x −1500..1500, z −2400..1600 (z south).
- Positions from OpenStreetMap (Overpass): Barnet church 51.65317, −0.20092; Monken Hadley church 51.6616, −0.1939
  (also the list entry); Old Fold = golf club buildings, 51.6644, −0.2017 (±50 m); road fork 51.6665, −0.1990; Kitts
  End about 51.672, −0.202; putative chapel/moat = the pond immediately south of the Wrotham business park entrance
  road, 51.6719, −0.1961 (my identification of the report's description; ±100 m).
- Road and stream lines are modern OSM lines, thinned. The Hatfield road is known to have shifted east since 1471.
- Terrain: local datum = Ordnance Datum − 64 m. `base` 32.6 plus twelve Gaussian hills minus seven valleys, fitted by
  least squares to 221 EU-DEM points (250 m grid), then hand-adjusted (plateau lowered, a crest added at the fork).
  RMS misfit about 5 m, worst about 16 m; modelled range about 8–75 m local. EU-DEM includes trees and buildings.
  Engine formula assumed: height = base + hills − valleys (as in `src/lib/terrain.ts`).
- Sun: 14 April 1471 Julian = 23 April Gregorian; sunrise at this latitude is near azimuth 70°. `sunElevation` 6,
  `sunAzimuth` 75 are my calculation, not from a source. Mist density 0.005 (about 200 m visibility) is a choice.

## Every conjectural or invented element in the data

1. All six troop blocks: position, frontage, depth, count (2,250 figures; about one per ten or eleven men on the
   modern estimates of 10,000 and 15,000), the three-battle order, commanders' wings, and the 220 m offset.
2. Both zone outlines (the "registered" ring is not the official boundary; the Kitts End ring is drawn from prose).
3. The "hedge-side" hedge at the north of Hadley Green; the hedge at the north of Kicks End Common; the Old Fold
   hedge. The Gannick Bank line (existence attested, line set beside the modern road).
4. The battle chapel's site, date (1472–76 placeholders) and form.
5. Forms of both pre-rebuild churches, Old Fold house, and all heights and most plan sizes of every building.
6. Phase dates 1420 (Barnet tower) and 1490 (start of Hadley rebuild).
7. Extent, density and layout of Barnet town, Hadley village and Kitts End; Kitts End before 1479.
8. Scrub zones (heath, green, Chase wood-pasture) and the woodland cover figure (0.07, flat).
9. The lane to Hadley church; the 1471 line of the Hatfield road and of Wood Street.
10. Mist density and height, sun angle; terrain detail below about 250 m.

## Deliberately left out

Open-field strips (no evidence of open field here; the report points to early enclosure), tents or camp (Edward's men
lay in the open without fires; nothing describes Warwick's camp), guns (attested on both sides, positions unknown),
the Hadley Highstone (1740), Wrotham Park (18th century), Dead Man's Bottom as a marked place, a "Warwick fell here" point.
