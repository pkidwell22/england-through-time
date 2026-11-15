# LIDAR terrain for the detailed sites

Built 2026-11-14 by the LIDAR terrain workstream. This note covers the source and licence, how the grids were made,
what each site uses them for, and where modern ground differs from the historic surface.

## Source, licence and attribution

| | |
|---|---|
| Dataset | Environment Agency **LIDAR Composite DTM, 1 m**. This is a bare-earth digital terrain model: buildings and vegetation are filtered out and water surfaces are interpolated. The coverage id is `13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m`, EPSG:27700, values in m above Ordnance Datum Newlyn. |
| Route | Defra Data Services Platform WCS 2.0.1, `https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs`. One `GetCoverage` request per 1 km National Grid square, returned as a Deflate GeoTIFF. No account or click-through was needed. The newer `geoservices/datasets/13787b9a-…/wcs` endpoint serves the same coverage. |
| Licence | Open Government Licence v3.0 |
| **Attribution (must appear in the credits)** | `Contains Environment Agency information © Environment Agency and/or database right 2026. Licensed under the Open Government Licence v3.0.` |
| Mask outlines | OpenStreetMap through Overpass (`overpass-api.de`), ODbL 1.0: `Feature outlines © OpenStreetMap contributors (ODbL 1.0)`. The outlines are used only to build masks; no OSM data is drawn. |
| Datum shift | OSTN15 NTv2 grid (`https://cdn.proj.org/uk_os_OSTN15_NTv2_OSGBtoETRS.tif`, PROJ-data, open licence) |

The sidecars carry these strings too (`attribution`, `osmAttribution`).

Problems on the route, for the record:
- The WCS returns HTTP 429 when hit with four parallel requests. The fetcher now makes one request at a time, waits 1.5 s between requests and backs off 20–240 s after a 429. All 141 files then arrived.
- The system Python (LibreSSL) fails the TLS handshake with `overpass-api.de`, so all downloads go through `curl`.

Raw files are in `research/raw-lidar/` (312 MB, not shipped). There are 136 DTM tiles (stonehenge 56, barnet 30, brentford 20, london 30), 4 `osm.json` files and the OSTN15 grid. `research/raw-lidar/MANIFEST.tsv` lists the URL, file, bytes, dataset, licence and attribution for each file.

## Reproduce

```
research/venv/bin/pip install pyproj scipy shapely          # on top of numpy, pillow, rasterio
research/venv/bin/python scripts/lidar/fetch.py [site ...]   # tiles + OSM + OSTN15; skips files already present (~25 s per tile at the server's pace)
research/venv/bin/python -I scripts/lidar/build.py [site ...]          # ~40 s for all four; prints the spot-height check
research/venv/bin/python -I scripts/lidar/build.py --verify [site ...] # decode the PNGs with Pillow and sample them
npx vite-node --config vitest.config.ts scripts/lidar/analytic.ts london 10 1625 research/raw-lidar/analytic/london-1625.json
research/venv/bin/python -I scripts/lidar/compare.py london 1625        # LIDAR vs analytic (hills, valleys, statistics)
```

## Processing (`scripts/lidar/build.py`)

1. **Mosaic.** The 1 km tiles are joined into one 1 m array. No-data cells (none in these four windows) and any gaps are filled by coarse-to-fine membrane interpolation (`fill_holes`).
2. **Reprojection.** The site's own local frame is used exactly as in `src/lib/geo.ts`: x = (lon − lon0)·111 320·cos lat0 and z = −(lat − lat0)·111 250, in metres, with x east and z south. `scripts/lidar/lidarlib.py: LocalProjector` is a Python copy of it.
   - For every output node: local (x, z) → WGS84 lat/lon (inverse geo.ts) → BNG (E, N) with pyproj, pinned to the OSTN15 operation. The 1 m DTM is box-filtered to the cell size and then sampled bilinearly.
   - **Check:** the OSTN15 round trip error is 0.0000 m. The Helmert-only conversion used elsewhere in the project (`research/stonehenge/geo-work/osgb.py`) differs from OSTN15 by 0.7–1.8 m at the four origins.
   - **Check:** the Stonehenge henge ring in the DTM is centred on the site origin (centre of the sarsen circle, taken from OSM) to within the 2 m cell (`hillshade-stonehenge-raw.png`). The OSM River Avon line used by the Stonehenge team lies a median 0.12 m above the lowest DTM cell within 80 m (101 points), so the two sources agree in plan.
   - Note: geo.ts uses 111 320 m per degree (equatorial), which makes local east–west metres 0.2% shorter than ground metres at 51° N (6 m in 3 km). The grids follow geo.ts, so they agree with every lat/lon in the site data.
3. **Resolution.** Grids are node-registered: pixel (i, j) sits at x = xMin + i·cell, z = zMin + j·cell, and row 0 is north. Each grid covers site.bounds plus 300 m.

| Site | Engine grid | Size (px) | Extra grids |
|---|---|---|---|
| stonehenge | natural surface, **4 m** (2 m natural lightly smoothed, then decimated) | 1751 × 1401, 1.5 MB | raw DTM **2 m** (3501 × 2801, 5.1 MB); residual **2 m** (0.2 MB); earthwork labels (0.06 MB) |
| barnet | natural surface, **5 m** | 721 × 921, 0.5 MB | raw 5 m |
| brentford | upland relief, **4 m**, trust mask in blue | 901 × 751, 0.3 MB | raw 4 m |
| london | upland relief, **5 m**, trust mask in blue | 1081 × 721, 0.4 MB | raw 5 m |

4. **Encoding.** The format is the national grid's 16-bit-in-RG: `elevation_m = (R·256 + G)·scale + offset`, 8-bit RGB PNG with no gamma or colour profile.
   - Elevation grids: **scale 0.02 m** (precision ±0.01 m, range 1310 m); `offset` = floor(minimum) − 5 m.
   - Residual: scale 0.01 m, offset −50 m.
   - B channel: the trust mask (0–255), or 255. No pixel was clipped.
   - Labels PNG: R·256 + G = earthwork `label`.
5. **Masked natural surface.**
   - Each modern feature or earthwork is buffered into a mask.
   - A first fill over the whole mask finds where the DTM actually departs from the surrounding ground: by more than 0.25 m for earthworks, 0.4 m for modern works at Stonehenge and 0.6 m at Barnet. Only those cells, closed and dilated by about 4 m, are replaced.
   - The fill is a smooth membrane interpolation from the surrounding ground, with light smoothing in a 2-cell band at the seam.
   - Large enclosures (cursus, hillfort, enclosure, Durrington Walls) are masked only along their banks and ditches, so the natural ground inside them survives. Examples are the dry valley under the Greater Cursus and the hilltop of Vespasian's Camp.
6. **Upland relief (river sites).**
   - The DTM is filled over modern works, open water and docks, then smoothed with a 25 m Gaussian.
   - **Trust** is 0 within the river half-width + 250 m of the centreline and rises to 1 at + 450 m. It is also 0 within 10–60 m of modern works, and on ground below 4–6.5 m OD (alluvium, reclaimed marsh, docks and their made ground).

## How the engine uses it

Sidecar `data/locations/<site>/terrain-lidar.json` (type `SiteLidar` in `src/lib/types.ts`) holds:
- the grid: `use`, `image`, `width`, `height`, `bounds`, `cellSize`, `scale`, `offset`, `mask`;
- datum and blending: `datum`, `localDatumOffset`, `edgeBlend`, `extend` (Stonehenge), `riverClearance` (river sites);
- provenance: `source`, `licence`, `attribution`, `notes`, `stats`;
- the masks: `modernFeatures` (name, kind, what, treatment, polygon in local metres, OSM ids);
- Stonehenge only: `earthworks` and `residual`.

Runtime:
- `src/lib/heightmap.ts`: decodes the PNG on the CPU through a canvas (`loadHeightmapImage`) or from bytes (`Heightmap.fromRGBA`, used by the tests). Provides bilinear `sample`, `sampleClamped`, `sampleMask`, `edgeWeight` and `distanceOutside`. Nothing in it is site-specific.
- `src/lib/data.ts`: `buildDataset` also reads the optional `terrain-lidar.json` into `site.lidar`. `loadDataset` awaits the new `prepareTerrain(ds)`, which decodes the image in the browser before the engine builds the terrain. Without a sidecar, with `use: "none"`, in Node, or on any decode error, nothing changes.
- `src/lib/terrain.ts`:
  - `"replace-analytic"`: height = grid − localDatumOffset. Only dated valleys (those with `fill`, such as the Stonehenge ditch and Avenue ditches) are still cut into it. Hills, undated valleys and micro-relief come from the analytic model, which is used outside the grid and blended in over `edgeBlend` (250 m) at the edge. With `extend` (Stonehenge, 1500 m), the grid's edge values continue outwards and fade to the analytic fallback instead.
  - `"upland-only"`: the grid is blended into the land formula with weight = edge fade × trust mask × smoothstep(150, 400 m back from the modelled bank). It never touches the river bed, foreshore or bank.
  - A site without a sidecar takes exactly the old code path. The no-river formula was only reordered: `max(MIN_LAND, h + micro)` is unchanged.

## Per-site assessment: modern ground versus historic surface

### Stonehenge: `use: "replace-analytic"`, natural surface

The LIDAR is excellent here. Every barrow, the henge, the Avenue, both cursuses and the Durrington Walls bank are plain in `hillshade-stonehenge-raw.png`. Those earthworks are themselves dated, so the engine grid is the **natural** surface with them removed. The relief therefore shows no barrow in 3000 BCE that was built in 1900 BCE.

**Earthworks removed: 219.** They come from OSM archaeology tags: 202 barrows (polygons, or 14 m circles round point barrows) and 17 named monuments. Each carries an `id`, `name`, `kind`, cemetery `group`, matched Stonehenge `landmark` id, `centre`, `polygon`, `maxUp`/`maxDown` (m) and `volumeUp`/`volumeDown` (m³).
- 101 are matched to landmark ids, including `stonehenge-ditch-bank`, `avenue`, `greater-cursus`, `lesser-cursus`, `durrington-walls-henge`, `woodhenge-henge`, `vespasians-camp`, `west-amesbury-henge`, `winterbourne-stoke-1`, the six cemetery `barrow-group`s and `scattered-barrows`.
- Durrington Walls appears in OSM only as a point. Its ring was masked as an annulus round the 466 × 490 m ellipse compiled in `research/stonehenge/geo-work/features.json`.
- Largest residuals:
  - Vespasian's Camp ramparts: +6.1 m.
  - Durrington Walls bank: +5.2 m, ditch −3.2 m, about 73 000 m³ above the natural surface.
  - Largest barrows: about +4–5 m.
  - Stonehenge ditch and bank: +0.6/−0.9 m.
  - Greater Cursus banks: +0.6/−0.9 m.

**Modern features removed (32 groups; `modernFeatures`):**
- Roads: the A303 with its cuttings, embankments and Countess and Longbarrow junctions; the A360, A345, A3028, B3085, B3086 and the Amesbury streets.
- The **old A344 line**, closed in 2013 and grassed over. It was traced by hand on the 2 m hillshade, where it still shows as a low terrace.
- Car parks, including the visitor centre bus and car parks, and the Amesbury and Ratfyn sewage works.
- The abandoned Amesbury and Military Camp Light Railway (1902).
- A block of **zig-zag First World War practice trenches** north-west of the Cursus. I identified these from their form; they are not in OSM.

The residual is stored only inside earthwork masks (0 elsewhere). Modern works are removed outright and are not in it. To add an earthwork back at its date, use natural + residual × [label = n].

**Not removed (limitations):**
- Earthworks absent from OSM: Celtic fields and lynchets, ploughed-out barrows, many small ring ditches.
- The ploughing that has flattened many barrows: the natural surface is "modern minus mapped earthworks", not the 3000 BCE ground.
- Plantation drainage and the narrower byways and military tracks: under 0.3 m, below what the masks target.
- Larkhill camp building platforms at the north edge.
- The henge interior: the raw DTM there is 0.6 m above the natural surface. The 70 m mask round the henge removes it; the reason for the raised interior (stone debris or later deposits) is not known.

**Datum:** local = OD − 62 m. This is what the final `site.json` now states, so stones are at 39.9 local and the Avon at about 1.6.

### Barnet: `use: "replace-analytic"`

The ridge, the plateau and the Monken Mead, Pymmes and Dollis valley heads are natural relief, and the DTM keeps them. Masked (`modernFeatures`, 13 groups):
- the **East Coast Main Line** cutting and embankments east of Hadley Wood (the tunnels are left alone);
- the **Northern line High Barnet branch** (1872) cutting and embankments with its station land;
- the M25 (the north edge of the window only);
- the A1081 St Albans Road works, Station Road and East Barnet Road cuttings;
- New Barnet reservoir, Gladsmuir Pond and the recreation-ground pond;
- levelled playing fields.

The masks replace 3.6% of the grid, removing up to +9.5 m of embankment and −13.1 m of cutting.

Not removed: golf-course shaping at Old Fold, garden terraces, and the street and building platforms of Chipping Barnet. These are mostly under 1 m.

Against the analytic fit (hand-fitted to EU-DEM, which includes trees and buildings), the LIDAR natural surface differs by RMS 5.8 m, mean −1.3 m, 5–95% range −10.3..+8.6 m. The worst difference is −23.7 m at x 910, z 90, where the east valley is much deeper and steeper than the gaussians allow. **Datum:** OD − 64 m, as in research/barnet.md.

### Brentford: `use: "upland-only"`

The river corridor is utterly changed: Brentford Dock and its lock, the canalised Brent (Grand Union Canal), the Thames Locks, the M4 and Great West Road, Kew Bridge approaches and several railways (`modernFeatures`, 34 groups). The DTM must not replace the river or bank model there.

- The upland grid is trusted on 40% of the window: the terraces north of the High Street towards Boston Manor and Gunnersbury, and the Kew / Old Deer Park side.
- On trusted ground inside the site, upland minus analytic is mean −0.7 m, RMS 4.5 m, 5–95% −8.0..+4.4 m.
- **Datum:** `localDatumOffset` 2.0 m OD is a compromise high-water level for the river datum. Roman high water at the City is published as no more than about +1.5 m OD (Taylor, London Archaeologist 16(1)), and present MHWS is roughly +3.5 to +4.5 m OD (I could not read the PLA standard-levels table).
- Old England (the origin) is 3.6 m OD in the raw DTM, which is 19th-century dock made ground. It is untrusted.
- The grid is enabled because the brief asks for `upland-only` here, and the engine applies it only on trusted ground at least 150–400 m back from the bank. To revert, set `"use": "none"` in the sidecar.

### London: `use: "none"` (grid and comparison only; London renders exactly as before)

- The upland relief (5 m) and trust mask (34% of the window) are delivered. The river corridor, Southwark, Lambeth, Westminster and the City waterfront are untrusted.
- 93 modern groups are masked: 38 railway, 36 road, 7 rail land, 6 canal, 2 dock and others.
- The raw DTM contains basement and station-box excavations down to −31 m OD, which shows how much the City surface has been dug and built up.

**Comparison with the analytic relief** (`compare.py`, `london-analytic-vs-lidar.png`):

| Feature | Analytic (site datum) | LIDAR modern surface | Finding |
|---|---|---|---|
| Cornhill crest | crest 17.4 m local at x 170, z −620 (hill centre x 104, z −467) | **17.9 m OD** (15.9 local) at x 80, z −440. The OS figure is 17.7 m (Wikipedia), so this verifies. | Hill centre is right (36 m). The analytic crest sits 190 m too far north because the terrace term keeps rising inland. Relief above the 0.7–1.1 km ring: LIDAR 3.9 m vs analytic 2.8 m. |
| Ludgate Hill crest | 16.8 local at x −810, z −620 | 17.6 m OD (15.6 local) at x −790, z −680 | Position good (crest 63 m apart; hill centre 165 m SSW of the LIDAR crest). Relief 3.9 vs 4.2 m: good. |
| Tower Hill | +2 m gaussian at x 693, z −56 | no separate crest; ground 11.4 m OD at the hill centre, falling east from Cornhill | Reduce to ≤ 1 m or drop. It reads as the end of the Cornhill spur, not a hill. |
| Walbrook | depth 6 m, σ 70, fill 0.85 by 1600 (0.9 m left) | still **3.5 m** deep today (0.4–8 m at 8 stations); floor on average 69 m off the analytic line | The 1600 fill (0.85) is more than the modern infill: the modern surface, after 400 more years of build-up, still keeps about 60% of the 6 m. Recommend a 1600 fill ≤ 0.4–0.5, and redrawing the line from the LIDAR floor between x −300 and −100. |
| Fleet | depth 8 m, σ 85, no fill | 6.8 m deep today (up to 9.6 m in the middle reach); floor within 10–45 m of the line in the middle reach | Depth and line are good. The natural valley was probably deeper (alluvium and fill). |
| Overall (trusted ground) | | LIDAR − analytic: mean +4.5 m, RMS 9.0 m, 5–95% −4.6..+17.2 m | Mostly north of z −500, where the real ground keeps rising to 20–28 m OD (Clerkenwell, Islington). The analytic terrace stops climbing 1.4 km from the river. |

**Absolute level: the important caveat.** The analytic Cornhill crest (17.4 m above modelled high water, ≈ 19 m OD at a +2 m high water) matches the *modern* surface. The natural brickearth on Cornhill is reported at about 12 m OD (LAMAS vol. 53, seen only as a search snippet), roughly 5 m of made ground lower. With Roman high water at about +1.5 m OD (Taylor), natural Cornhill stood about 10–11 m above high water, not 17.

**Recommendation for the London owner** (not applied):
- Lower the City terraces and hills by about 4–6 m (for example the 8.5 m terrace term, or hill heights), so that Cornhill and Ludgate crests sit about 10–11 m above modelled high water.
- Keep the hill positions and the Fleet; reduce Tower Hill; relax the Walbrook fill as above.
- Confirm the natural levels from MOLA / BGS deposit models first: my figures for the natural surface come from snippets I could not open.

## Spot-height verification

Values are decoded from the shipped PNGs with Pillow (`build.py --verify`; full output in `research/raw-lidar/build.log`).

| Place | Grid value | Expected / source |
|---|---|---|
| Stonehenge, centre of the sarsen circle | **101.92 m OD** natural, 102.50 raw (39.9 local) | 101–102 m OD (brief) |
| Heel Stone | 101.11 m OD | slightly lower; ground falls NE |
| King Barrow Ridge between the New King Barrows | 108.46 m OD; barrow tops to 115.8 | ridge about 105–110 m (no figure read) |
| Stonehenge Bottom, lowest point by the A303 | **79.82 m OD** | "about 80 m aOD at the base of Stonehenge Bottom" (A303 ground-investigation report, search snippet only) |
| Coneybury Hill summit | 113.6 m OD | "about 110 m aOD" (same snippet) |
| River Avon below West Amesbury (lowest cell) | 63.6 m OD (1.6 local) | lowest ground in the site |
| Hadley Green (Barnet origin) | **131.06 m OD** (67.1 local) | 128–130 m OD (brief) |
| Chipping Barnet church | 129.18 m OD | town centre about 130 m / 427 ft (Wikipedia) |
| Monken Hadley church | 129.34 m OD | plateau edge |
| Cornhill (St Michael) | **17.56 m OD**; crest 17.9 | 17.7 m (58 ft) OS figure via Wikipedia |
| Ludgate Hill (St Paul's) | 16.83 m OD | natural brickearth c. 11.1–11.7 m OD (LAMAS 22, snippet), so about 5–6 m of made ground |
| Brentford, Boston Manor terrace | 17.9 m OD | land "rising gently from the Thames" to about 23 m (research/brentford.md) |

Hadley Green comes out about 1 m above the brief's 128–130 m. It is a broad flat green, and the DTM is unambiguous there: 131.1 m natural, 131.1 m raw.

## Checks in the running app

- Screenshots were taken with `tests/dbg.mjs` at quality=high.
- **Stonehenge:** `site.lidar.grid` decodes. The Stonehenge team's final views already sit on the grid: view targets equal the grid height, and cameras are 3 m to 2 km above the ground. The heights are:

  | Point | Local height |
  |---|---|
  | (0, 0), the stones | 39.92 |
  | Stonehenge Bottom | 17.82 |
  | x 3900, beyond the grid | 13.76 |
  | x 6500 | 39.4 (back to the analytic fallback) |
- **Barnet:** `benchmark(20)` gives 9–29 ms per frame with the grid and 7.6–11.6 ms without. The machine load average was 27–38, so this is noise; the grid adds no per-frame work. It is decoded once (about 0.7 M pixels).
- **Mesh error:** the terrain mesh interpolates at 12 m (3 m in the Stonehenge district), so objects placed by `TerrainModel.height` can differ from the drawn surface. The 99th percentile is 0.3 m and the worst case 1.1 m (Barnet) or 2.0 m (Stonehenge, on the steepest slopes outside the district). Inside the Stonehenge district the 99th percentile is 0.02 m and the worst 0.4 m. Trees already sink 1.5 m into the ground, so nothing visibly floats in the screenshots.
- **Barnet camera views** were set on the analytic ground, which was a few metres higher. With the LIDAR, view targets are above the ground by:

  | View | Target above ground |
  |---|---|
  | hadley-green | 7.9 m |
  | warwick-side | 4.9 m |
  | road-fork | 4.2 m |
  | low-green | 6.5 m |
  | south | 1.8 m |

  The low-green camera is 5.4 m above the ground. Nothing is under the ground, but the targets float. Suggested fix: subtract 4–7 m from those target y values.
- **Brentford:** every view camera is still well above the ground (the lowest is the ford-middlesex view, 60 m over 6.4 m ground). The water-level views are untouched because the grid is kept away from the river.
- **London:** `use: "none"`, so no grid is decoded and the unit test checks that the heights are identical.

Screenshots in `docs/screenshots/lidar/`:
- `*-before.png` / `*-after.png` for stonehenge-landscape, barnet, barnet-hadley-green, barnet-road-fork, barnet-south-1300 and brentford-overview;
- `stonehenge-avenue-after.png` (the stones and henge bank standing on the natural surface);
- `london-city-unchanged.png`;
- the `*-analytic-vs-lidar.png` relief comparisons;
- `hillshade-*.png` showing raw, natural and residual with masks.

The Barnet views are dominated by the 1471 battle mist, so the hillshade comparisons show the change more clearly.

## Limitations

- The DTM is a 21st-century surface. Even the natural and upland grids are the modern ground minus mapped intrusions. Ploughing, colluvium in dry valleys, soil creep and centuries of made ground are not undone.
- Masks are only as complete as OpenStreetMap plus the hand-added features listed above. Unmapped intrusions remain.
- The river-site datum (2.0 m OD) is a single compromise for a model that has one high-water level for 5600 years.
- The London natural-level figures (made-ground thickness) come from search snippets and need checking against MOLA / BGS sources before London's hills are changed.
- The bare-earth filter can leave low objects (the henge interior is +0.6 m) and interpolates across water. Water levels in the DTM are survey-day levels.
- Durrington Walls and the WWI trench and A344 masks were drawn by hand (geometry noted above). Their extents are good to about 10–20 m.
