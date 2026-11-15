# Stonehenge geography and terrain: method, sources, errors

Outputs: `geo.json` (data), `sources-geo.json` (source ids `sto-*`), `geo-work/` (raw downloads and scripts).
Coordinates: WGS84 lat/lon; local x = east, z = SOUTH of the origin, using the engine's projector
(`makeProjector` in `src/lib/geo.ts`: 111 250 m per degree of latitude, 111 320 * cos(lat) per degree of longitude).
Every URL below was fetched and read. Nothing is cited from memory.

## 1. Origin (centre of the sarsen circle)

**lat 51.17886, lon -1.82621** (OSGB NGR about SU 12245 42195). Three independent routes agree within 3 m:

| Route | Result |
|---|---|
| Circle fitted to 15 OSM-mapped sarsen uprights (`natural=stone`, traced from imagery); radius 15.64 m, scatter 0.54 m | 51.178859, -1.826208 |
| English Heritage 2010 survey report header, NGR SU 12244219 (10 m resolution, cell centre +5/+5), OSGB36 to WGS84 by a 7-parameter Helmert (3-5 m) | 51.17886, -1.82621 |
| Gazetteer of Great Britain, SU 1224 4219 | 51.178887, -1.8262196 |
| Wikipedia | 51.17889, -1.82611 (about 7 m east, rounded to 1 arc-second) |

The brief's provisional 51.17888, -1.82619 is 3 m from the adopted value. **Uncertainty: about +/-2 m relative to the OSM-mapped stones, +/-5-10 m absolute.**
Checks: the Heel Stone (OSM centroid) lies 78.9 m from the origin at azimuth 51.0 deg (Wikipedia: 77.4 m); the Avenue's first leg leaves at azimuth 49.9 deg
(the solstice axis); the two OSM station stones 91 and 93 are symmetric about the origin to about 2 m.
No published survey gave the sarsen centre to better than 10 m in a source I could fetch (the EH report gives an 8-figure NGR only; the Historic England list entry 1010140 gives NGRs of its three scheduled areas, not the centre).

## 2. Features (OSM Overpass, cross-checked)

Overpass queries (5 bbox/id queries; scripts `geo-work/q*.ql`, raw JSON `geo-work/osm_*.json`, OSM base timestamp 2026-11-14). Cross-checks with Wikipedia or the Gazetteer:
Heel Stone (2 m), Cuckoo Stone (10 m), Bush Barrow (5 m), Woodhenge (about 5 m), Cursus length (2751 m vs 2.76 km), Avenue length (2695 m vs "nearly 3 km"), Avenue solstice bearing.

* **Heel Stone**: x 61.3, z -49.6; 78.9 m, azimuth 51.0 deg.
* **Avenue**: 18-point centreline (`pathXZ`), 2695 m, about 23 m wide (ditches ~20 m apart, EH 2010). Built as the mid-line of the two ditch-bounded Avenue polygons in OSM (stones, straight NE stretch to the **elbow at x 456, z -388**, then east across Stonehenge Bottom and over King Barrow Ridge to x 1650, z -60), joined to the OSM footway "The Avenue" south-east to West Amesbury. The last ~190 m to Bluestonehenge (1985, 800) is a straight extrapolation (OSM footway stops at 1908, 638). The 5 m-scale shape is only as good as OSM's tracing.
* **Greater Cursus**: west end (-1287, -725), east end (1452, -987), 2751 m, bearing 84.6 deg (ENE), width median 108 m (75 m at the ends to 133 m at the widest, from the OSM outline; Wikipedia ~100 m, up to ~150 m at the west). 12-point axis plus the OSM outline polygon. **Lesser Cursus**: centre (-1790, -1277), 422 x 40 m (OSM outline; Wikipedia ~400 x 60 m), bearing 75 deg; outline from OSM (Bing).
* **Durrington Walls**: centre (2760, -1540) from the Gazetteer SU 1500 4376 and Wikipedia (the OSM node is 190 m off); 16-point ring is an **ellipse** 466 m E-W x 490 m N-S (Gazetteer 510 x 535 yd), **not a surveyed outline** (centre +/-60 m, outline +/-40 m). **Southern Circle** (2880, -1330): **low confidence, +/-60-100 m**; Wikipedia says it is 70 m north of Woodhenge, which cannot be reconciled with the enclosure ellipse; unresolved, needs a plan from the Riverside Project volume.
* **Woodhenge** (2821, -1172): OSM polygon (54 m, post rings) plus 110 m overall (Wikipedia). **Coneybury Henge** (1181, 597), diameter ~56 m, **Bluestonehenge / West Amesbury henge** (1982, 815), ~35 m (OSM marks this one "approximate location"), **Cuckoo Stone** (2413, -1144).
* **Robin Hood's Ball**: (-2004, -3766): **outside** the bounds (about 1 km beyond the north edge).
* **Vespasian's Camp**: 24-point ring (OSM outline of 14 vertices re-sampled at equal arc length; corners slightly rounded), 730 m N-S; the Avon wraps its east and south sides (OSM).
* **Amesbury**: town centre (3103, 730); church of St Mary and St Melor (2926, 776); OSM "Amesbury Abbey" building (the house) (2849, 485). **Priory precinct: no source gives it.** `amesbury-abbey-precinct` is a 220 x 130 m placeholder rectangle marked conjectural, low confidence.
* **Long barrows**: Amesbury 42 (1498, -976), 81 x 20 m, bearing 2 deg (N-S); Winterbourne Stoke 1 (-2246, 686), 77 x 26 m, bearing 31 deg; Normanton Down long barrow (-364, 907), 19 x 9 m, bearing 11 deg (OSM outline probably shows only the surviving mound); three unnamed OSM long-barrow nodes (-1833, 1010), (2029, 1956), (2757, -1084) and one outlined in the Lake group (-1445, 2030). Length/bearing come from the minimum-area rectangle of the OSM outline; these are mapped outlines, not survey measurements.
* **Barrows**: 127 entries in `barrows[]`: Normanton Down 26 listed + 9 near it (35 = Grinsell's count quoted on Wikipedia), Winterbourne Stoke crossroads 18+2, Lake 17, Cursus barrows 15 (incl. "Monarch of the Plain"), Old King Barrows 9+2, New King Barrows 7+1, Stonehenge Down 8+2, plus 10 ungrouped. **Bush Barrow** is identified by position (Wikipedia 51.17051, -1.83482 lies within 5 m of one OSM polygon; 49 m, 3.3 m high). **`form` is "unknown" for every round barrow**: OSM has no bowl/bell/disc tags and mapping outlines are symbolic (many are identical 22 m or 42 m templates), so `diameter` is only the OSM polygon's equivalent circle. Wikipedia says Normanton Down has several bell barrows, many discs, one saucer and one pond barrow, but not which is which; I did not fetch a list that does.
* **River Avon**: 101-point centreline (10.2 km; OSM `waterway=river` ways in flow order from Bulford past Durrington, Amesbury, round Vespasian's Camp and West Amesbury). OSM has strong meanders and side channels; side channels omitted. **Width 10 m is an estimate**, not tagged in OSM (flagged in the file).
* Not located: precinct boundary of Amesbury Abbey (placeholder only); a reliable Southern Circle position; barrow forms; long axis bearing of Woodhenge's rings (not stated in what I read).

## 3. Terrain fit

* **DEM**: EU-DEM 25 m via OpenTopoData (primary) over a 200 m grid (x -2800..3600, z -2900..2300) plus a 50 m grid over x,z -500..500: 1302 distinct points. Open-Meteo (Copernicus 90 m) for the same points as a cross-check: the two DEMs differ by RMS 2.6 m (max 16.9, mean +1.0).
* **Datum**: local height = m above OD - **60**. DEM at the stones = 101.4 m OD, giving 41.4 local. Lowest ground (the Avon, ~62 m OD) is ~2 m local, right at the engine's `MIN_LAND` clamp. If the river bed flattens too visibly, use offset 55 (stones ~46.5).
* **Method**: exact `terrain.ts` formula (base + slope + gaussian hills - gaussian valleys by distance to polyline; the engine's +/-0.6 m micro is unfittable and ignored), Levenberg-Marquardt in numpy with parameter bounds (`geo-work/fit.py`, `fitlib.py`). 12 hills, 6 valleys (limits 12/8). Valley polylines are fixed (hand-set from the DEM minima; the Avon from OSM) and their depth/sigma fitted; hill positions are free but boxed around the named feature so names stay honest.
* **Smoothness under the stones**: samples within 150 m get weight 6, and 60 m-radius pseudo-samples (value 41.3) get weight 25. Result: ground within a 50 m radius of the centre varies by **0.9 m**; ground at the stones = **41.6** local (DEM 41.4). Without this the DEM itself varies ~2 m there. The cost is a larger error within 500 m (RMS 3.1 m instead of 2.0 m).
* **Fit result**: `base` 41.71, slope 0.0017 m/m uphill toward 168 deg (negligible; relief is in the hills/valleys).
  * In bounds (1186 samples): **RMS 4.47 m, max 22.8 m**; 3.6% of samples are >10 m off (mostly the NW and SE corners, Larkhill, and the steep Avon scarp at Vespasian's Camp, where a gaussian cannot make a 25 m step in 100 m).
  * Within 500 m of the stones (317 samples): **RMS 3.06 m, max 6.9 m**.
  * Including the 100 m margin ring (1302 samples): RMS 5.27, max 28.5.
  * Model min 2.0 (clamp) at only 1 of 3213 100 m grid points; 18 are below 4 m.
* **What reads right** (fitted model, m OD): Stonehenge 101.6; Stonehenge Bottom 86 at the Avenue crossing (x 500, z -390) against King Barrow Ridge 107-109 (Old/New King Barrows area) and the Avon valley 66-68 at West Amesbury/Amesbury church; Normanton Down ridge ~105 at Bush Barrow; Larkhill rise >130 m OD to the north; Vespasian's Camp spur ~91 m OD above the river.
* **Caveats**: the DEMs are modern surface models (woods, roads, A303/A344 cuttings, buildings, the visitor centre); prehistoric relief was essentially the same at this scale but local detail (the 2 m bank/ditch at the stones, the Avenue's banks) is not in either DEM. The fitted `hills` are broad, not individual ridges: King Barrow Ridge is two gaussians. Hill names for the broad uplands (e.g. "High ground north-west of Durrington Walls") are descriptive, not attested place names.

## 4. Bounds recommendation

Keep about 6 x 5 km but extend **x to 3700**: bounds x -2700..3700, z -2800..2200 (6.4 x 5.0 km). The Avon's eastern meander reaches x 3620, and Durrington village sits at x 3591. With x max 3500 the Avon valley is clipped and the terrain is ~12 m off there. Outside even that: Robin Hood's Ball (z -3766), the long barrow at (543, -3143), most of the Wilsford barrow group (z > 2200), Bulford, and the summit of the Larkhill rise.

## 5. Limits of this work

OSM is crowd-sourced (stone positions and outlines were traced from imagery; positions are good to ~1-3 m for the stones and ~10 m for earthwork outlines); the Durrington Walls outline, the Southern Circle and the abbey precinct are approximations stated as such; all DEM numbers are surface-model values on a 25 m posting.
