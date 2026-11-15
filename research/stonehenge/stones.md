# Stonehenge stone-by-stone catalogue: method, sources, assumptions

Output: `data/locations/stonehenge/stones.json` (127 entries; Petrie numbering). Sources: `sources-stones.json` (every URL was fetched and read this session). Generator and checks: `stones-check/build_stones.py`, `stones-check/check_stones.py` (prints OK). Raw evidence kept in `stones-check/`: `osm-overpass-snapshot.json` (OpenStreetMap outlines), `stonesofstonehenge-posts.txt` (every per-stone post of the Stones of Stonehenge site), `fit_centre.py`, `osm_polar.py`.

## 1. Numbering (verified)

- Uprights 1-30 run clockwise from the axis; stone 1 is just east of it [sto-sos-about, sto-barclay-1895 "numbers turn sunways from east to west"].
- Lintel number = 100 + the number of the higher (western, clockwise) of the two uprights it spans: lintel 102 on 1-2, lintel 122 on 21-22, lintel 130 on 29-30, and lintel 101 on 30-1 [sto-barclay-1895: "piers 1 and 2 support the lintel 102"; sto-sos-about: "101 rather than 130"]. So the user's example "122 spans 21 and 22" is right.
- Trilithons 51-60 clockwise from the SE/E end (51-52, 53-54, 55-56 Great Trilithon at the SW, 57-58, 59-60 NW end); imposts 152, 154, 156, 158, 160 on 51-52 ... 59-60 [sto-sos-about, sto-barclay-1895]. Bluestone circle 31-49, bluestone horseshoe 61-72, Altar Stone 80, Station Stones 91-94, Slaughter Stone 95, Heel Stone 96, stonehole 97.

## 2. Frame and how positions were derived

**No published coordinate table was reachable.** Petrie 1880 (archive.org/Gutenberg full text not found), Cleal et al. 1995, Field et al. 2015 and the Historic England laser-scan report (HTTP 403) were not readable. The brief's suggested Wikimedia SVG "Stonehenge plan.svg" does not exist under that name (404); the Commons file found by search, `Stonehenge_plan_v2_notex_2.svg` (Astroskiandhike, CC BY-SA 4.0, 2018, "possible astronomical alignments"), was downloaded and read: it is a 340 pt schematic with no stone numbers, so it was NOT used for positions (listed as `sto-commons-plan-svg` for transparency).

What was used instead, in order of reliability:

1. **OpenStreetMap stone outlines** (Overpass query of ways tagged `natural=stone` within 80 m of the provisional origin, ODbL; outlines were traced from imagery by mappers). Only about 40 outlines exist and only a handful carry Petrie `ref` tags, so they were used for: Heel Stone 96, Slaughter Stone 95, Altar Stone 80, Station Stones 91 and 93, bluestones 32 and 150, and for the plaques marking Station Stones 92, 94 and stonehole 97 (92 and 97 are flagged "location approximated" in OSM). Bluestones 31 and 45-49 were assigned to unlabelled small outlines by position and size. Estimated error: about 0.7 m for OSM outlines, 1.5-3 m for the plaques.
2. **Fitted centre.** A least-squares fit of the 30-fold ring to the sarsen outlines (and checks against the bluestone ring, which came out at a uniform radius of 11.0 +/- 0.5 m, and the Station Stones, whose r and bearings are mutually opposite) puts the true centre of the sarsen circle at x = -0.43 m (west), z = +1.33 m (south) of the provisional site origin, i.e. **lat 51.178868, lon -1.8261962** (error about 0.7 m). The Heel Stone is then 77.5 m from the centre, matching the monument researcher's 77.4 m, and the Station Stone pairs are almost exactly opposite (92 at 160.7 and 94 at 341.4 degrees, 180.7 apart; 91 at 118.0 and 93 at 295.3, 177.3 apart, radii 37-48 m, mean about 43 m). **All az/r in stones.json are from this fitted centre.** The lead should move the megalith landmark anchor to this lat/lon (or apply the offset); otherwise everything shifts 1.4 m.
3. **Sarsen circle** (uprights and lintels): ideal Petrie geometry, 30 uprights on r = 15.2 m (inner diameter 29.6 m [Antiquity-era figure via Wikipedia: about 30 m]; centre of 1.1 m thick stones), uniform step of 11.963 degrees, stone 1 at axis + 6.5 degrees and stone 30 at axis - 6.6 degrees, so the 30/1 gap is about 0.3 m wider than the rest (Antiquity: that gap is 1.38 m, "larger than average", an entrance). Real stones deviate (three groups of ten, each preceded by a slightly wider gap, per Antiquity), so error is about +/-0.5 m. The OSM outlines of surviving uprights agree to within about 1 m.
4. **Trilithon horseshoe**: a quarter-ellipse (A = 8.0 m along the axis, B = 6.2 m across; outer width 2B + 1.3 = 13.7 m, matching the "45 ft across" in Wikipedia) continued as straight parallel arms to the NE; five trilithons 6.2 m apart along it; the two uprights of each 3.25 m apart centre to centre (the mortise spacing of lintel 156 is 128 in = 3.25 m [sto-sos-stones]); lower-numbered upright on the clockwise-earlier side. Checked against described relationships (below). Error +/-1 m, schematic.
5. **Bluestone horseshoe**: the same curve about 1.5 m inside (Stukeley: the lesser oval 2 cubits inside the greater), 12 stones 2.1 m apart. Checks from the sources: 66 is a stump under the southern corner of fallen 55b (model: 1.8 m from 55), 56 leans against 68 (model: 68 about 2.4 m NE of 56), 69 is close to 57, 71 is a stump at the edge of 59a (model: 1.9 m from 59), 61 is just in front of 51. Error +/-1 m.
6. **Bluestone circle**: r = 11.0 m. Anchored (OSM) for 31, 32, 46-49, 45, 150; placed from written relationships for 37-41 (37, 38, 39 lie near sarsen pier 14 whose fall damaged them [Barclay 1895]; 37 and 39 are nearer the centre than 38; 40/41 near sarsen 15); linearly interpolated for 33-36, 42-44 (+/-20 degrees, **schematic**). Stumps with letters (32c-e, 33e-f, 40c, 40g, 41d, 42c, 61a, 70a-b) are placed from the written offsets on the Stones of Stonehenge "Stumps" page (+/-2 m).
7. Axis azimuth 49.9 degrees is the lead's provisional value (the brief's sightline). I found no fetched numeric survey; see monument.md. The OSM Heel Stone is at 51.1 degrees from the fitted centre, consistent with "fractionally east of the axis".

## 3. Sizes

- Sarsen uprights: above-ground heights from the Stones of Stonehenge posts (1: 3.96, 2: 4.27, 3: 4.16, 4: 4.27, 5: 4.27, 6: 4.19, 7: 3.96, 10: 3.96, 11: 2.74, 16: 4.27, 21: 3.96, 22: 3.81 estimated, 23: 3.81, 27-30: 3.96 m). Widths and thickness: typical 2.1 x 1.1 m (Wikipedia: 2.13 x 1.06 m; Antiquity: 1.9 m wide at 1.5 m height); stone 11 is 1.1 m wide and short; stone 21 is 1.5 m wide [sto-antiquity-keeping-time]. Not measured per stone.
- Sarsen lintels: typical 3.2 m long, 1.05 m radial, 0.8 m deep (Wikipedia).
- Trilithon uprights: heights 4.98, 5.08, 5.18, 5.18, 6.55 (56: to platform; 6.88 to tenon top), 5.18, 5.18, 5.03 m from the Stones of Stonehenge posts (55 assumed equal to 56 and 59 to 60). The brief's "6.7 m above ground" for 56 is Wikipedia's 22 ft; the scan-era figure is 6.55 m. Width/thickness derived from the above-ground weights (density 2.65 t/m3, taper 0.9, aspect 1.8:1) so they are about 1.6-2.1 x 0.9-1.15 m: slender, consistent with Stukeley's "finely taper'd" Great Trilithon uprights. Lintels 4.9 x 1.4 m, depth 0.7-1.0 m from weights (estimates).
- Bluestones: heights where the posts give them, widths from weights (density 3 t/m3 as Field et al., taper factor 0.55 assumed), otherwise typical 0.8 x 0.5 m.
- Altar Stone about 4.9 x 1.0 x 0.5 m, Heel Stone 4.57 m high above ground (Wikipedia 4.9 m), Slaughter Stone about 6.1 m long (OSM outline; Stukeley "above 20 foot"; Wikipedia 4.9 m visible).

## 4. How the 1625 state was reasoned

No 1625 record of any individual stone exists. Evidence chain (strongest first):

1. **Stukeley's survey, 1719-24 (published 1740)** gives counts that equal today's: of the 30 outer uprights 17 standing (11 continuous by the entrance carrying 5 lintels), 1 leaning on an inner-circle stone at the SW back, 6 lying, so 24 of 30 positions visible; 6 piers missing; one further lintel in place, 2 lintels lying, 22 carried off. Trilithons: first two on the left of the entrance entire; the Great Trilithon's lintel fallen on the altar, its south upright broken in two on the altar, the other leaning on a stone of the inner oval; the next trilithon entire but for part of an impost end; the last trilithon: outer upright standing, the other upright and the impost fallen forwards and each broken in three. Inner oval: only 6 stones upright, stumps of two on the south side by the altar, one lying behind the altar, one or two thrown down, a stump beside the standing upright. The Slaughter Stone lies flat; the Heel Stone stands; of the two stones on the bank one stands and one leans a little. This matches today's 17 standing sarsens, 6 lintels in place, 2 fallen lintels, 6 standing horseshoe bluestones.
2. **Dated later events** (all consistent with "standing in 1625"): trilithon 57-58 with lintel 158 fell 3 Jan 1797 (Maton; Barclay; Stones of Stonehenge: re-erected 1958); stone 22 with lintel 122 fell 31 Dec 1900 (Britannica 1911; Stones of Stonehenge: re-erected in the 1950s with 21); stone 56 leaning until raised 19 Sep 1901 (Britannica 1911); stones 6 and 7 leaning, straightened from 1919 (English Heritage; Britannica 1911 "slewed round"); stone 23 fell in 1963 and was re-erected (Wikipedia); 57/58 recorded fallen in 1919.
3. **The earlier fall of 59/160**: Barclay 1895 says the date is unknown but a British Museum drawing (de Heere, c.1573-75) shows it before 1574. I did not see the drawing; this is a secondary report. Assumed fallen in 1625 (and Stukeley agrees).
4. **The Great Trilithon (55, 156, 56, Altar Stone 80) is the one big conflict.** Aubrey (c.1665-93, quoted in Long 1876) says the under-digging for the Duke of Buckingham in 1620, during James I's visit, caused "the falling downe, or recumbency of the great stone", and Long, Barclay and Hoare repeat "1620". A tradition recorded 45+ years later is not a dated observation of the fall. I set the state in 1625 to **fallen (55, 156), leaning (56), altar broken (80)**, each with `alt1625` giving the alternative. If the lead prefers "unknown means standing", flip these three and the altar. Stevens 1916 even states the "large Trilithon group fell in A.D. 1620", which is that same tradition.
5. **Things assumed from today's state or the 1720s state** and not individually evidenced for 1625: the identity of the six lying sarsens (8, 9, 12, 19, 25, 26 plus fragment 15; Stukeley counted six lying), the missing uprights and lintels (a stone missing today is assumed missing in 1625 unless a source says it was removed later; none does, but Inigo Jones complained c.1620 of the destruction of the smaller stones, which concerns bluestone-type stones), the whole bluestone circle, bluestone stumps, and the fall directions (assumed inward unless a source says otherwise).
6. **Stone 14** is leaning in the 1720s (the SW upright leaning on an inner-circle stone), fell later onto bluestones 37-39 (Barclay), and Burl (via Stones of Stonehenge) identifies it with Aubrey's fallen "Friar's Heel"; these conflict, so its 1625 state (set to leaning) is low confidence.

### What was NOT found
Numeric survey azimuth; per-stone widths/thickness; Petrie's own 1880 numbers; Wood's plan (his plan numbers are his own; the OCR text gave 18 erect or leaning stones in the outer circle (his rows 1-18), 41 erect or leaning stones in all, flat stones 42-74; consistent with Stukeley's 17 + 1 leaning); lintel dimensions per lintel; per-stone Slaughter and Station Stone sizes; the original posture of the Altar Stone (the entry says `built: "lying"`, which is the documented state, not a claim about the original).

## 5. Assumptions list (all marked in the JSON)

- `hypothetical: true` (30 entries): sarsen uprights 13, 17, 18, 20, 24 (stoneholes/parchmarks for some, not individually established); 22 missing lintels (103, 104, 106, 108-119, 121, 123-126, 128, 129); Station Stones 92 and 94; stonehole 97's companion stone.
- Assumed "as in the 1720s; date of fall unknown": uprights 8, 9, 12, 14 (leaning), 15, 19, 25, 26; lintels 120, 127; trilithon fallen stones 59, 160; Slaughter Stone 95; Station Stone 91 (leaning, as in 1771) and 93; all bluestones; Heel Stone (standing).
- Assumed "standing since built": every upright and lintel standing today or until 1797/1900/1963.
- Placeholders: lean angles (6 and 7: 5 degrees, 14: 20, 56: 20, 91: 15 degrees) and which of 6/7 leans in or out (arbitrary: 6 in, 7 out).
- Sizes typical where not stated; bluestone circle positions 33-36, 42-44 schematic.

## 6. Per-stone table

`built` is the state when the setting was complete; the 1625 state column carries lean/fall data; "today" is the 2020s condition. Positions are metres/degrees from the fitted centre.

| id | set | role | az | r | w x t x h | built | 1625 state | today | hypothetical | position quality |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | sarsen-circle | upright | 56.4 | 15.2 | 2.1 x 1.1 x 3.96 | standing | standing | standing |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 2 | sarsen-circle | upright | 68.4 | 15.2 | 2.1 x 1.1 x 4.27 | standing | standing | standing |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 3 | sarsen-circle | upright | 80.3 | 15.2 | 2.1 x 1.1 x 4.16 | standing | standing | standing |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 4 | sarsen-circle | upright | 92.3 | 15.2 | 2.1 x 1.1 x 4.27 | standing | standing | standing |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 5 | sarsen-circle | upright | 104.3 | 15.2 | 2.1 x 1.1 x 4.27 | standing | standing | standing |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 6 | sarsen-circle | upright | 116.2 | 15.2 | 2.1 x 1.1 x 4.19 | standing | leaning (lean 5 toward 296.2) | standing (straightened 1919-20) |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 7 | sarsen-circle | upright | 128.2 | 15.2 | 2.1 x 1.1 x 3.96 | standing | leaning (lean 5 toward 128.2) | standing (straightened 1919-20) |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 8 | sarsen-circle | upright | 140.1 | 15.2 | 2.1 x 1.1 x 4.1 | standing | broken (toward 320.1, 1 pcs) | broken |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 9 | sarsen-circle | upright | 152.1 | 15.2 | 2.1 x 1.1 x 4.1 | standing | broken (toward 332.1, 2 pcs) | broken |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 10 | sarsen-circle | upright | 164.1 | 15.2 | 2.1 x 1.1 x 3.96 | standing | standing | standing |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 11 | sarsen-circle | upright | 176.0 | 15.2 | 1.1 x 0.7 x 2.74 | standing | standing | standing |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 12 | sarsen-circle | upright | 188.0 | 15.2 | 2.1 x 1.1 x 4.1 | standing | fallen (toward 8.0, 1 pcs) | fallen |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 13 | sarsen-circle | upright | 200.0 | 15.2 | 2.1 x 1.1 x 4.1 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 14 | sarsen-circle | upright | 211.9 | 15.2 | 2.1 x 1.1 x 4.1 | standing | leaning (lean 20 toward 31.9) (toward 31.9) | fallen |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 15 | sarsen-circle | upright | 223.9 | 15.2 | 2.1 x 1.1 x 4.1 | standing | broken (toward 43.9, 1 pcs) | broken |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 16 | sarsen-circle | upright | 235.8 | 15.2 | 2.1 x 1.1 x 4.27 | standing | standing | standing |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 17 | sarsen-circle | upright | 247.8 | 15.2 | 2.1 x 1.1 x 4.1 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 18 | sarsen-circle | upright | 259.8 | 15.2 | 2.1 x 1.1 x 4.1 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 19 | sarsen-circle | upright | 271.7 | 15.2 | 2.1 x 1.1 x 4.1 | standing | broken (toward 91.7, 1 pcs) | broken |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 20 | sarsen-circle | upright | 283.7 | 15.2 | 2.1 x 1.1 x 4.1 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 21 | sarsen-circle | upright | 295.7 | 15.2 | 1.5 x 0.9 x 3.96 | standing | standing | standing |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 22 | sarsen-circle | upright | 307.6 | 15.2 | 2.1 x 1.1 x 3.81 | standing | standing | standing (re-erected 1950s) |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 23 | sarsen-circle | upright | 319.6 | 15.2 | 2.1 x 1.1 x 3.81 | standing | standing | standing (re-erected after the 1963 fall) |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 24 | sarsen-circle | upright | 331.6 | 15.2 | 2.1 x 1.1 x 4.1 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 25 | sarsen-circle | upright | 343.5 | 15.2 | 2.1 x 1.1 x 4.1 | standing | fallen (toward 163.5, 1 pcs) | fallen |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 26 | sarsen-circle | upright | 355.5 | 15.2 | 2.1 x 1.1 x 4.1 | standing | broken (toward 175.5, 1 pcs) | broken |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 27 | sarsen-circle | upright | 7.4 | 15.2 | 2.1 x 1.1 x 3.96 | standing | standing | standing |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 28 | sarsen-circle | upright | 19.4 | 15.2 | 2.1 x 1.1 x 3.96 | standing | standing | standing |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 29 | sarsen-circle | upright | 31.4 | 15.2 | 2.1 x 1.1 x 3.96 | standing | standing | standing |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 30 | sarsen-circle | upright | 43.3 | 15.2 | 2.1 x 1.1 x 3.96 | standing | standing | standing |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 31 | bluestone-circle | upright | 59 | 11.0 | 1.03 x 0.64 x 1.88 | standing | standing | standing |  | OSM outline, +/-0.7 m |
| 32 | bluestone-circle | upright | 86.1 | 10.8 | 0.8 x 0.5 x 1.5 | standing | fallen (toward 266.1) | fallen |  | OSM outline, +/-0.7 m |
| 32c | bluestone-circle | upright | 107.0 | 10.7 | 0.5 x 0.4 x 0.0 | standing | buried | buried |  | from a written offset (arc immediately north of 33 (~1.0 m)), +/-2 m |
| 32d | bluestone-circle | upright | 101.9 | 10.7 | 0.5 x 0.4 x 0.0 | standing | buried | buried |  | from a written offset (arc immediately north of 33 (~1.9 m)), +/-2 m |
| 32e | bluestone-circle | upright | 96.9 | 11.0 | 0.5 x 0.4 x 0.0 | standing | buried | buried |  | from a written offset (arc immediately north of 33 (~2.8 m)), +/-2 m |
| 33 | bluestone-circle | upright | 112 | 11.0 | 0.54 x 0.34 x 1.68 | standing | standing | standing |  | interpolated between anchors, schematic, +/-20 deg |
| 33e | bluestone-circle | upright | 144.2 | 10.3 | 0.5 x 0.4 x 0.0 | standing | buried | buried |  | from a written offset (about 6 m SW of 33), +/-2 m |
| 33f | bluestone-circle | upright | 143.4 | 11.2 | 0.5 x 0.4 x 0.0 | standing | buried | buried |  | from a written offset (about 6 m SW of 33, beside 33e), +/-2 m |
| 34 | bluestone-circle | upright | 138 | 11.0 | 0.57 x 0.36 x 0.97 | standing | standing | standing |  | interpolated between anchors, schematic, +/-20 deg |
| 35 | bluestone-circle | upright | 160 | 11.0 | 0.8 x 0.5 x 0.3 | standing | broken (toward 340.0, 2 pcs) | broken |  | interpolated between anchors, schematic, +/-20 deg |
| 36 | bluestone-circle | slab | 182 | 11.0 | 0.8 x 0.5 x 0.0 | standing | buried | buried |  | interpolated between anchors, schematic, +/-20 deg |
| 37 | bluestone-circle | upright | 199 | 10.4 | 0.79 x 0.49 x 1.27 | standing | standing | standing |  | from Petrie/Barclay relationships (near sarsen 14/15), +/-10 deg |
| 38 | bluestone-circle | upright | 209 | 11.0 | 0.8 x 0.5 x 0.3 | standing | stump | stump |  | from Petrie/Barclay relationships (near sarsen 14/15), +/-10 deg |
| 39 | bluestone-circle | upright | 219 | 10.4 | 0.8 x 0.5 x 0.3 | standing | stump | stump |  | from Petrie/Barclay relationships (near sarsen 14/15), +/-10 deg |
| 40 | bluestone-circle | upright | 228 | 11.0 | 0.8 x 0.5 x 0.3 | standing | stump | stump |  | from Petrie/Barclay relationships (near sarsen 14/15), +/-10 deg |
| 40c | bluestone-circle | upright | 247.4 | 11.9 | 0.5 x 0.4 x 0.0 | standing | buried | buried |  | from a written offset (about 4 m NW of 40), +/-2 m |
| 40g | bluestone-circle | upright | 231.1 | 10.7 | 0.5 x 0.4 x 0.0 | standing | buried | buried |  | from a written offset (about 1.5 m SE of 41; marked at ground level by a lead cover), +/-2 m; nudged <=1.5 m to keep clear of neighbour 40 |
| 41 | bluestone-circle | upright | 238 | 11.0 | 0.8 x 0.5 x 1.5 | standing | fallen (toward 58.0) | fallen |  | from Petrie/Barclay relationships (near sarsen 14/15), +/-10 deg |
| 41d | bluestone-circle | upright | 275.3 | 6.8 | 0.5 x 0.4 x 0.0 | standing | buried | buried |  | from a written offset (about 6 m NNE of 41), +/-2 m; nudged <=1.5 m to keep clear of neighbour 57 |
| 42 | bluestone-circle | upright | 256 | 11.0 | 0.8 x 0.5 x 0.3 | standing | stump | stump |  | interpolated between anchors, schematic, +/-20 deg |
| 42c | bluestone-circle | upright | 264.0 | 10.9 | 0.5 x 0.4 x 0.0 | standing | buried | buried |  | midway between 42 and 43 (both interpolated), +/-3 m |
| 43 | bluestone-circle | upright | 272 | 11.0 | 0.8 x 0.5 x 0.3 | standing | stump | stump |  | interpolated between anchors, schematic, +/-20 deg |
| 44 | bluestone-circle | upright | 300 | 11.0 | 0.8 x 0.5 x 0.3 | standing | stump | stump |  | interpolated between anchors, schematic, +/-20 deg |
| 45 | bluestone-circle | upright | 340 | 11.6 | 0.8 x 0.5 x 0.3 | standing | stump | stump |  | OSM outline, +/-0.7 m |
| 46 | bluestone-circle | upright | 20 | 11.1 | 0.59 x 0.37 x 0.96 | standing | standing | standing |  | OSM outline, +/-0.7 m |
| 47 | bluestone-circle | upright | 28 | 11.2 | 0.92 x 0.57 x 1.45 | standing | standing | standing |  | OSM outline, +/-0.7 m |
| 48 | bluestone-circle | upright | 37 | 10.3 | 0.8 x 0.5 x 0.3 | standing | stump | stump |  | OSM outline, +/-0.7 m |
| 49 | bluestone-circle | upright | 45 | 10.9 | 0.75 x 0.47 x 1.9 | standing | standing | standing |  | OSM outline, +/-0.7 m |
| 51 | trilithons | upright | 111.7 | 7.04 | 1.89 x 1.05 x 4.98 | standing | standing | standing |  | horseshoe curve model, +/-1 m |
| 52 | trilithons | upright | 139.2 | 6.2 | 2.03 x 1.13 x 5.08 | standing | standing | standing |  | horseshoe curve model, +/-1 m |
| 53 | trilithons | upright | 166.4 | 6.46 | 1.63 x 0.9 x 5.18 | standing | standing | standing |  | horseshoe curve model, +/-1 m |
| 54 | trilithons | upright | 193.8 | 7.05 | 2.07 x 1.15 x 5.18 | standing | standing | standing |  | horseshoe curve model, +/-1 m |
| 55 | trilithons | upright | 217.7 | 7.67 | 1.63 x 0.91 x 6.55 | standing | broken (toward 49.9, 2 pcs) | fallen |  | horseshoe curve model, +/-1 m |
| 56 | trilithons | upright | 242.1 | 7.67 | 1.63 x 0.91 x 6.55 | standing | leaning (lean 20 toward 59.9) | standing (straightened 1901) |  | horseshoe curve model, +/-1 m |
| 57 | trilithons | upright | 266.0 | 7.05 | 2.02 x 1.12 x 5.18 | standing | standing | standing (re-erected 1958) |  | horseshoe curve model, +/-1 m |
| 58 | trilithons | upright | 293.4 | 6.46 | 1.87 x 1.04 x 5.18 | standing | standing | standing (re-erected 1958) |  | horseshoe curve model, +/-1 m |
| 59 | trilithons | upright | 320.6 | 6.2 | 1.81 x 1.01 x 5.03 | standing | broken (toward 139.9, 3 pcs) | fallen |  | horseshoe curve model, +/-1 m |
| 60 | trilithons | upright | 348.1 | 7.04 | 1.8 x 1.0 x 5.03 | standing | standing | standing |  | horseshoe curve model, +/-1 m |
| 61 | bluestone-horseshoe | upright | 105.7 | 5.68 | 0.73 x 0.46 x 1.75 | standing | standing | standing |  | curve model, 12 stones evenly spaced 2.1 m apart along an oval 1.5 m inside the trilithons; checked against the relationships in the sources (66 under 55b, 68 against 56, 69 by 57, 71 by 59a), +/-1 m |
| 61a | bluestone-horseshoe | upright | 90.1 | 4.2 | 0.5 x 0.4 x 0.1 | standing | stump | stump |  | about 2 m to the "right" of 61 (direction ambiguous), +/-2 m |
| 62 | bluestone-horseshoe | upright | 126.8 | 4.83 | 0.77 x 0.48 x 2.03 | standing | standing | standing |  | curve model, 12 stones evenly spaced 2.1 m apart along an oval 1.5 m inside the trilithons; checked against the relationships in the sources (66 under 55b, 68 against 56, 69 by 57, 71 by 59a), +/-1 m |
| 63 | bluestone-horseshoe | upright | 152.2 | 4.68 | 0.74 x 0.46 x 2.11 | standing | standing | standing |  | curve model, 12 stones evenly spaced 2.1 m apart along an oval 1.5 m inside the trilithons; checked against the relationships in the sources (66 under 55b, 68 against 56, 69 by 57, 71 by 59a), +/-1 m |
| 64 | bluestone-horseshoe | upright | 177.0 | 4.97 | 0.8 x 0.5 x 0.2 | standing | stump | stump |  | curve model, 12 stones evenly spaced 2.1 m apart along an oval 1.5 m inside the trilithons; checked against the relationships in the sources (66 under 55b, 68 against 56, 69 by 57, 71 by 59a), +/-1 m |
| 65 | bluestone-horseshoe | upright | 199.4 | 5.49 | 0.8 x 0.5 x 1.8 | standing | fallen (toward 184.3) | fallen |  | curve model, 12 stones evenly spaced 2.1 m apart along an oval 1.5 m inside the trilithons; checked against the relationships in the sources (66 under 55b, 68 against 56, 69 by 57, 71 by 59a), +/-1 m |
| 66 | bluestone-horseshoe | upright | 219.9 | 5.93 | 0.8 x 0.5 x 0.2 | standing | stump | stump |  | curve model, 12 stones evenly spaced 2.1 m apart along an oval 1.5 m inside the trilithons; checked against the relationships in the sources (66 under 55b, 68 against 56, 69 by 57, 71 by 59a), +/-1 m |
| 67 | bluestone-horseshoe | upright | 239.9 | 5.93 | 0.8 x 0.5 x 1.8 | standing | fallen (toward 247.2) | fallen |  | curve model, 12 stones evenly spaced 2.1 m apart along an oval 1.5 m inside the trilithons; checked against the relationships in the sources (66 under 55b, 68 against 56, 69 by 57, 71 by 59a), +/-1 m |
| 68 | bluestone-horseshoe | upright | 260.4 | 5.49 | 0.91 x 0.57 x 2.49 | standing | standing | standing |  | curve model, 12 stones evenly spaced 2.1 m apart along an oval 1.5 m inside the trilithons; checked against the relationships in the sources (66 under 55b, 68 against 56, 69 by 57, 71 by 59a), +/-1 m |
| 69 | bluestone-horseshoe | upright | 282.8 | 4.97 | 0.9 x 0.56 x 2.59 | standing | standing | standing |  | curve model, 12 stones evenly spaced 2.1 m apart along an oval 1.5 m inside the trilithons; checked against the relationships in the sources (66 under 55b, 68 against 56, 69 by 57, 71 by 59a), +/-1 m |
| 70 | bluestone-horseshoe | upright | 307.6 | 4.68 | 0.71 x 0.45 x 2.34 | standing | standing | standing |  | curve model, 12 stones evenly spaced 2.1 m apart along an oval 1.5 m inside the trilithons; checked against the relationships in the sources (66 under 55b, 68 against 56, 69 by 57, 71 by 59a), +/-1 m |
| 70a | bluestone-horseshoe | upright | 324.0 | 5.2 | 0.5 x 0.4 x 0.0 | standing | buried | buried |  | 1.5 m NNE of 70, +/-1.5 m; nudged <=1.5 m to keep clear of neighbour 59 |
| 70b | bluestone-horseshoe | upright | 335.5 | 6.2 | 0.5 x 0.4 x 0.0 | standing | buried | buried |  | 3.0 m NNE of 70, +/-1.5 m |
| 71 | bluestone-horseshoe | upright | 333.0 | 4.83 | 0.8 x 0.5 x 0.2 | standing | stump | stump |  | curve model, 12 stones evenly spaced 2.1 m apart along an oval 1.5 m inside the trilithons; checked against the relationships in the sources (66 under 55b, 68 against 56, 69 by 57, 71 by 59a), +/-1 m |
| 72 | bluestone-horseshoe | upright | 354.1 | 5.68 | 0.8 x 0.5 x 1.8 | standing | fallen (toward 319.9) | fallen |  | curve model, 12 stones evenly spaced 2.1 m apart along an oval 1.5 m inside the trilithons; checked against the relationships in the sources (66 under 55b, 68 against 56, 69 by 57, 71 by 59a), +/-1 m |
| 80 | altar | slab | 238.4 | 3.6 | 4.9 x 1.0 x 0.5 | lying | broken | broken |  | OSM outline of the visible part (centroid), +/-0.7 m; length axis set to bearing 130 (80 deg to the axis) from Stones of Stonehenge |
| 91 | station | outlier | 118.0 | 45.0 | 1.3 x 0.9 x 1.3 | standing | leaning (lean 15 toward 118.0) | fallen |  | OSM outline, +/-0.7 m |
| 92 | station | outlier | 160.7 | 48.0 | 1.2 x 0.8 x 1.3 | standing | missing | missing | yes | modern marker/OSM plaque, flagged "location approximated", +/-3 m |
| 93 | station | outlier | 295.3 | 42.7 | 1.1 x 0.8 x 1.22 | standing | standing | standing |  | OSM outline, +/-0.7 m |
| 94 | station | outlier | 341.4 | 37.3 | 1.2 x 0.8 x 1.3 | standing | missing | missing | yes | modern marker/OSM plaque, +/-1.5 m |
| 95 | slaughter | outlier | 52.1 | 43.7 | 2.1 x 1.1 x 6.1 | standing | fallen (toward 229.9, 1 pcs) | fallen |  | OSM outline centroid, +/-0.7 m; orientation along the axis |
| 96 | heel | outlier | 51.1 | 77.5 | 2.7 x 2.1 x 4.6 | standing | standing | standing |  | OSM outline centroid, +/-0.7 m (distance 77.5 m agrees with 77.4 m in the monument notes) |
| 97 | heel-companion | outlier | 48.2 | 79.2 | 1.8 x 1.2 x 3.0 | standing | missing | missing | yes | OSM plaque "Stone Hole 97", flagged approximated, +/-3 m |
| 101 | sarsen-lintels | lintel | 49.9 | 15.2 | 3.2 x 1.05 x 0.8 | standing | standing | standing |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 102 | sarsen-lintels | lintel | 62.4 | 15.2 | 3.2 x 1.05 x 0.8 | standing | standing | standing |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 103 | sarsen-lintels | lintel | 74.3 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 104 | sarsen-lintels | lintel | 86.3 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 105 | sarsen-lintels | lintel | 98.3 | 15.2 | 3.2 x 1.05 x 0.8 | standing | standing | standing |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 106 | sarsen-lintels | lintel | 110.2 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 107 | sarsen-lintels | lintel | 122.2 | 15.2 | 3.2 x 1.05 x 0.8 | standing | standing | standing |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 108 | sarsen-lintels | lintel | 134.2 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 109 | sarsen-lintels | lintel | 146.1 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 110 | sarsen-lintels | lintel | 158.1 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 111 | sarsen-lintels | lintel | 170.1 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 112 | sarsen-lintels | lintel | 182.0 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 113 | sarsen-lintels | lintel | 194.0 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 114 | sarsen-lintels | lintel | 205.9 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 115 | sarsen-lintels | lintel | 217.9 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 116 | sarsen-lintels | lintel | 229.9 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 117 | sarsen-lintels | lintel | 241.8 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 118 | sarsen-lintels | lintel | 253.8 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 119 | sarsen-lintels | lintel | 265.8 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 120 | sarsen-lintels | lintel | 277.7 | 15.2 | 3.2 x 1.05 x 0.8 | standing | broken (toward 97.7, 1 pcs) | broken |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 121 | sarsen-lintels | lintel | 289.7 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 122 | sarsen-lintels | lintel | 301.6 | 15.2 | 3.2 x 1.05 x 0.8 | standing | standing | standing (re-erected 1950s) |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 123 | sarsen-lintels | lintel | 313.6 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 124 | sarsen-lintels | lintel | 325.6 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 125 | sarsen-lintels | lintel | 337.5 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 126 | sarsen-lintels | lintel | 349.5 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 127 | sarsen-lintels | lintel | 1.5 | 15.2 | 3.2 x 1.05 x 0.8 | standing | broken (toward 181.5, 1 pcs) | broken |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 128 | sarsen-lintels | lintel | 13.4 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 129 | sarsen-lintels | lintel | 25.4 | 15.2 | 3.2 x 1.05 x 0.8 | standing | missing | missing | yes | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 130 | sarsen-lintels | lintel | 37.4 | 15.2 | 3.2 x 1.05 x 0.8 | standing | standing | standing |  | ideal ring geometry (Petrie 30-fold), +/-0.5 m |
| 150 | bluestone-circle | slab | 79.6 | 11.4 | 1.0 x 0.6 x 0.5 | standing | fallen (toward 259.6, 1 pcs) | fallen |  | OSM outline tagged ref=150, +/-0.7 m (size of the outline is only the visible part) |
| 152 | trilithons | lintel | 124.5 | 6.43 | 4.9 x 1.4 x 0.7 | standing | standing | standing |  | horseshoe curve model, +/-1 m |
| 154 | trilithons | lintel | 180.7 | 6.56 | 4.9 x 1.4 x 1.0 | standing | standing | standing |  | horseshoe curve model, +/-1 m |
| 156 | trilithons | lintel | 229.9 | 7.5 | 4.9 x 1.4 x 0.9 | standing | fallen (toward 49.9, 1 pcs) | fallen |  | horseshoe curve model, +/-1 m |
| 158 | trilithons | lintel | 279.1 | 6.56 | 4.9 x 1.4 x 0.9 | standing | standing | standing (re-erected 1958) |  | horseshoe curve model, +/-1 m |
| 160 | trilithons | lintel | 335.3 | 6.43 | 4.9 x 1.4 x 0.8 | standing | broken (toward 139.9, 3 pcs) | fallen |  | horseshoe curve model, +/-1 m |
