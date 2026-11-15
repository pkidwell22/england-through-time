# National terrain: data, processing, verification

Built 2026-11-13. Outputs:

| File | What |
|---|---|
| `public/assets/national/height.png` | 2048 x 1466, 8-bit RGB, 3.7 MB. Elevation of land and sea floor, `(R*256+G)*0.1 - 300` m, B = 0 |
| `public/assets/national/height-preview.png` | 800 x 573 hill-shaded colour preview for humans |
| `data/national/terrain.json` | contract metadata, sea-level keyframes, notes |
| `data/national/sources-terrain.json` | `ter-` source ids |
| `scripts/national/fetch-terrain.py` | downloads the raw data |
| `scripts/national/build-height.py` | raw data to PNGs; `--verify` decodes and samples the PNG |

Window: 49.7-56.0 N, 6.5 W-2.3 E. One pixel = 0.004297 degrees in both directions, i.e. about 290 m east-west
(at 53 N) by 478 m north-south. Row 0 is the north edge, column 0 the west edge; values are pixel-centre samples.

## Downloads

All raw files are in `research/raw-terrain/` (148 MB in total; per-file URL, size and licence in
`research/raw-terrain/MANIFEST.tsv`). Nothing needed an account or a click-through.

| Data | URL | Licence | Size |
|---|---|---|---|
| GEBCO_2025 Grid, 15 arc-second, subset rows 33480-35087, columns 41592-43799 (49.5-56.2 N, 6.7 W-2.5 E), saved as `gebco/gebco_2025_subset.nc` | OPeNDAP: `https://dap.ceda.ac.uk/thredds/dodsC/bodc/gebco/global/gebco_2025/ice_surface_elevation/netcdf/GEBCO_2025.nc` | Public domain, free of charge, acknowledge "GEBCO Bathymetric Compilation Group 2025" (terms: https://www.gebco.net/data-products/gridded-bathymetry-data) | 2.6 MB |
| Copernicus DEM GLO-90, 61 one-degree tiles N49-N56 x W007-E002 (19 all-ocean tiles do not exist), `cop90/*.tif` | `https://copernicus-dem-90m.s3.amazonaws.com/<tile>/<tile>.tif` | Free licence for any use including derived products, attribution required: "produced using Copernicus WorldDEM-90 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved" | 142.9 MB |
| Sea-level index point database (Shennan, Bradley & Edwards 2018), `sealevel/HOLSEA2017_Britain_Ireland.xlsx` | https://data.mendeley.com/datasets/rfw98r8g83 (file fetched through the site's public API) | CC BY-NC 3.0. Used only to derive nine keyframes; the file is not shipped in `public/` | 0.46 MB |

Not used: the GEBCO 2023/2024 OPeNDAP paths on CEDA return 404 (2025 is what is served; GEBCO_2026 exists on
gebco.net but only through the download app). EMODnet bathymetry (about 115 m) and OS Terrain 50 would be finer
but are unnecessary at about 300 m per pixel.

The attribution line for Copernicus must appear wherever the site lists credits.

## Reproduce

```
python3 -m venv research/venv
research/venv/bin/pip install numpy pillow netCDF4 rasterio          # openpyxl only for the sea-level table
research/venv/bin/python scripts/national/fetch-terrain.py research/raw-terrain
research/venv/bin/python -I scripts/national/build-height.py research/raw-terrain   # about 7 seconds
research/venv/bin/python -I scripts/national/build-height.py --verify public/assets/national/height.png
```

`research/venv` (110 MB) and `research/raw-terrain` (148 MB) can be deleted; both are rebuilt by the commands above.

## Processing

1. GEBCO is bilinearly interpolated to the target grid. It supplies the sea floor everywhere.
2. Each Copernicus tile is area-averaged (`rasterio` `Resampling.average`) to the target grid, together with the
   fraction of each target cell that Copernicus has flattened to exactly 0.0 m (its sea mask).
3. Merge. A cell that is less than half sea in Copernicus is land: it takes the Copernicus mean of its land part.
   Every other cell takes GEBCO; where Copernicus covers the cell and calls it sea, the value is capped at -0.5 m
   so that the present coastline follows the finer dataset (GEBCO's interpolated nearshore values are sometimes
   slightly positive).
4. Encode `v = round((elevation + 300) / 0.1)`, clamp to 0..65535, `R = v >> 8`, `G = v & 255`, `B = 0`. Saved with
   Pillow as 8-bit RGB, no alpha, no colour profile or gamma chunk.

Result: range -299.4 m to +1036.2 m, nothing clamped; 46.8% of cells are Copernicus land.

## Verification

Output of `build-height.py --verify` (decoded from the PNG with Pillow alone, the same arithmetic the renderer uses):

| Place | lat, lon | Decoded | 3x3 max | Expected |
|---|---|---|---|---|
| Snowdon summit | 53.0685, -4.0763 | 900.9 m | 966.4 m | 1085 m peak, lower as a cell mean |
| Scafell Pike summit | 54.4542, -3.2115 | 909.5 m | 909.5 m | 978 m peak |
| Cross Fell | 54.7028, -2.4872 | 874.8 m | 884.0 m | 893 m |
| Central London (Charing Cross) | 51.5074, -0.1278 | 19.0 m | 35.2 m | 10-20 m (surface model, buildings) |
| Open peat fen east of Holme Fen | 52.5000, -0.1000 | -1.1 m | -0.9 m | -2 to +1 m |
| Somerset Levels (Westonzoyland) | 51.1100, -2.9000 | 3.7 m | 8.4 m | 3-6 m |
| Romney Marsh | 51.0000, 0.9000 | 1.5 m | 2.4 m | 0-4 m |
| Dogger Bank (south-west part) | 54.6000, 1.8000 | -21.8 m | -18.3 m | -15 to -30 m |
| North Sea off Norfolk | 53.0000, 2.0000 | -31.8 m | | -20 to -40 m |
| The Wash | 52.9500, 0.3000 | -16.1 m | | -5 to -25 m |
| Dover Strait | 51.0000, 1.4500 | -52.4 m | | -25 to -55 m |
| Celtic Sea (west edge) | 50.8000, -6.3000 | -94.0 m | | -70 to -100 m |
| St George's Channel | 52.0000, -5.8000 | -99.7 m | | -80 to -120 m |
| Beaufort's Dyke | 54.7500, -5.2500 | -268.9 m | | -200 to -300 m |
| Thanet plateau | 51.3500, 1.3800 | 49.4 m | | 30-55 m |
| Wantsum Channel floor (Sarre) | 51.3350, 1.2550 | 4.4 m | | 1-4 m |

Ben Nevis (56.80 N) is outside the window. The highest cell is 1036.2 m at 53.16 N, 3.97 W (Carnedd Llywelyn,
true height 1064 m). Peaks read 3-17% low because each cell is the mean of about 300 x 480 m; this is expected and
does not matter at national zoom. Other checks: B channel is 0 everywhere; no step is visible at the one-degree
tile seams (mean difference across seam columns and rows is the same as across neighbouring ones); the preview
image shows the expected shape of coast, sea-floor channels and uplands.

Land fraction of the grid as the sea is lowered: 46.5% at 0 m, 47.8% at -1.6 m, 48.4% at -3.2 m, 49.1% at -6 m.
So the coastline does move with sea level, but modestly: the big changes in this period were silting, peat and
erosion, which a present-day grid does not hold.

## Sea-level curve

Method: for every sub-region in the Shennan, Bradley & Edwards (2018) database I took the median "corrected RSL"
of the non-rejected points in 1000-year bins. Medians in metres relative to present mean sea level (n = number of points):

| Region | 6450-5450 BP | 5450-4450 | 4450-3450 | 3450-2450 | 2450-1450 | 1450-450 |
|---|---|---|---|---|---|---|
| Thames | -6.2 (22) | -5.7 (11) | -4.3 (29) | -4.6 (18) | -4.2 (3) | -3.0 (1) |
| Fens | -6.1 (29) | -4.0 (47) | -2.5 (47) | -1.7 (33) | -1.8 (26) | -1.5 (2) |
| Kent | -6.5 (11) | -4.8 (14) | -4.0 (23) | -3.1 (30) | -3.1 (24) | -5.2 (7) |
| Hampshire | -5.1 (5) | -3.5 (2) | -2.8 (3) | -1.4 (2) | -2.0 (1) | -0.7 (1) |
| Sussex | -6.5 (3) | -5.1 (2) | -3.6 (7) | -2.6 (9) | -2.2 (2) | |
| East Anglia | -7.5 (4) | -7.2 (7) | -5.2 (4) | -5.1 (6) | -2.5 (6) | -1.1 (1) |
| Bristol Channel | -6.1 (26) | -5.6 (4) | -4.2 (13) | -2.4 (10) | -3.1 (2) | |
| Devon | -8.2 (3) | -6.6 (6) | | -4.1 (1) | -2.2 (5) | -1.0 (8) |
| Cornwall | -7.9 (3) | -7.3 (2) | | | -1.7 (1) | -1.7 (1) |
| Humber (inner / outer) | -4.1 / -5.2 | -2.7 / -3.5 | -1.4 / | -0.4 / -2.0 | -1.4 / -2.1 | / -1.2 |
| Tees | -3.0 (9) | -1.9 (3) | -1.2 (4) | -1.1 (4) | | |
| Mid Wales | -3.6 (3) | -2.6 (2) | -1.6 (2) | -1.2 (3) | | -0.6 (2) |
| Mersey | -1.9 (4) | -1.7 (4) | -0.8 (1) | -0.9 (3) | | |
| Lancashire | -1.7 (9) | -0.9 (2) | +1.7 (1) | -0.8 (3) | -0.2 (3) | +0.6 (3) |
| Morecambe Bay | -0.7 (7) | +0.3 (5) | | +0.8 (1) | +1.6 (1) | |
| Cumbria | -0.3 (4) | +0.6 (1) | | +2.1 (2) | | |
| NE England (south) | +1.6 (7) | +1.7 (4) | +0.1 (7) | +0.5 (5) | +2.8 (1) | |
| North Solway | +4.2 (4) | +5.0 (4) | +4.4 (5) | +5.6 (1) | +0.2 (2) | |

4000 BCE is about 5950 BP, 43 CE about 1900 BP.

Chosen single curve (Thames / Fenland / south coast), metres relative to present mean sea level:

| Year | -4000 | -3000 | -2000 | -1000 | 43 | 410 | 1066 | 1300 | 1625 |
|---|---|---|---|---|---|---|---|---|---|
| RSL | -6.0 | -4.5 | -3.2 | -2.3 | -1.6 | -1.3 | -0.8 | -0.5 | -0.25 |

Reasoning and honesty:

- The -6 m start is the pooled median of Thames, Fens, Kent and Sussex at 5950 BP, with Hampshire a metre higher and
  East Anglia a metre and a half lower. Individual points span -3.5 to -11 m.
- From 4500 BP the regions diverge. I followed the Fens and Hampshire rather than the Thames and Kent, because the
  latter are dominated by intercalated peats that have compacted under later sediment (Shennan, Milne & Bradley 2009
  say 3-5 m of net lowering "are not unusual"). If the Thames medians are right at face value, the curve is 1.5-3 m
  too high between 1500 BCE and 500 CE. Confidence: medium before 1000 BCE, low to medium after.
- The Roman value of -1.6 m is equivalent to a mean rise of about 0.8 mm a year since, which sits inside the
  0.5-1.1 mm a year late Holocene subsidence that Shennan & Horton (2002) give for south-east England (figure seen
  only in search-result abstracts; the paper itself was not fetched and is not cited as a source).
- After 1000 CE the database has almost no points for these regions. The 1066, 1300 and 1625 values are a smooth
  run-out to zero (straight extrapolation of the Roman-to-present rate would give about -0.3 m at 1625). Nobody
  should read the last three numbers as measurements.
- Values are mean sea level. Coastlines as people experienced them were set by high water, 2-3.5 m higher.
- Elsewhere the curve is wrong in the ways listed in `terrain.json` notes: 2 m too high for Devon and Cornwall at
  4000 BCE, about right for the Bristol Channel and Lincolnshire, 1-3 m too low for the Humber, Tees and mid Wales,
  4-5 m too low for Lancashire and Cumbria, and of the wrong sign for Northumberland and the Solway, where the sea
  stood 1.5-5 m above today's level in the mid Holocene.

## What the renderer must know

1. Decode on the CPU to a float array first. Do not let the browser or GPU colour-manage or interpolate the PNG:
   load it with `colorSpaceConversion: "none"` / `THREE.NoColorSpace`, no premultiplied alpha, and never sample the
   raw texture with linear filtering or mipmaps (G wraps every 25.6 m).
2. `water = elevation < seaLevel(year)` is only a first approximation. It floods the southern Fens at every date
   including today, because that land has sunk below 0 m since drainage (it shows as pale blue patches south of the
   Wash in the preview); it never floods the Somerset Levels or the Wantsum Channel, which were wet for the whole period.
   Until masks exist, treat land cells below about +1 m that are not connected to open sea as marsh rather than sea,
   and consider drawing all land below about +4 m near the Wash, Somerset, the Humber head and Romney as wetland.
3. Because sea level in the curve never exceeds 0, nothing on today's land (other than the sub-zero fen) ever floods.
   All the historically important flooded places need masks, not a higher sea.
4. Land is a surface model: cities and forests stand 2-15 m proud. Do not read small bumps in lowlands as hills.
5. Pixels are not square on the ground (about 290 m by 478 m). Scale x by cos(latitude) or project properly.
6. The Copernicus attribution line (above) is a licence condition.

## Limitations

- Present-day surface only: no peat growth or wastage, alluviation, dune and shingle growth, cliff retreat, land
  reclamation or harbour works. See the notes in `terrain.json`.
- About 300 x 480 m cells; peaks low by up to 17%, narrow valleys and rivers smoothed, features under about 500 m lost.
- Two datums (EGM2008 for land, mean sea level for sea floor) and a surface model on land: +/-2 m near zero.
- GEBCO nearshore depths are partly interpolated; intertidal flats (Morecambe Bay, the Wash, Thames estuary) are
  the least reliable part of the grid, and they are exactly the cells that change with a few metres of sea level.
- Inland lakes carry their water surface, not their bed.
- One sea-level curve for a region with opposite-signed trends at its two ends.
- Literature on regional history is from Wikipedia articles (fetched), adequate for notes but not for mask outlines.

## Optional regional masks worth adding later (not built)

Each would be a small greyscale PNG on the same grid, or a polygon in `[lat, lon]`, with from/to years.

1. Fenland wetland before drainage: peat fen, silt fen and meres (Whittlesey Mere and others) around the Wash, with
   the islands cut out, plus the medieval Wash shoreline along the sea banks. Largest single correction on the map.
   Source to digitise: British Geological Survey superficial deposits (peat and tidal flat deposits, OGL).
2. Somerset Levels and Moors wetland, with the islands (Glastonbury, Brent Knoll, the Poldens) cut out, and the
   extent of the 1607 flood as an event overlay.
3. Wantsum Channel and the east Kent coast (Thanet as an island until the late Middle Ages; Stonar, Sandwich and
   Richborough on open water), together with Romney Marsh, the old Rother mouth and the pre-1287 shingle barrier.
4. Lost coast strips: Holderness (about 5 km since the Roman period, with Ravenser Odd and the old Spurn), and the
   Suffolk-Norfolk cliffs at Dunwich. A seaward offset of the present coast by a dated distance would be enough.
5. Humberhead Levels, Vale of York and Hull valley wetlands (including Hatfield Chase, drained from 1626), and the
   Lancashire mosses and Martin Mere.
6. A regional sea-level correction field: a low-resolution raster of the offset from the single curve by latitude and
   coast (from the table above), so that the Solway and Northumberland show a higher mid-Holocene sea and the
   south-west a lower one.

A trivial stand-in for 1, 2 and 5 can be derived from the grid itself (land cells below about +4 m within the named
bounding boxes), but real outlines need the geology data.
