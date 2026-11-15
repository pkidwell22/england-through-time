# Running record: decisions, sources, limitations

Project: an explorable 3D timelapse of **one place within England**, the London/Thames area,
from 4000 BCE to the death of James I in 1625. Separate from, and sharing no files with, the
existing Rome project in `~/Rome` (which was read once for orientation and not modified).

## Decisions

| # | Decision | Why |
|---|----------|-----|
| 1 | Geographic anchor: about 4.8 × 3 km around the City, Southwark, the Strand and Westminster. Origin = north end of medieval London Bridge. | The brief's default. Wide enough to show the shift from Londinium to Lundenwic and back, and Westminster as a separate centre. |
| 2 | Next.js 15 (app router) + plain Three.js 0.180, no React-Three-Fiber. | The scene is driven imperatively by one "year" value; a thin engine class is simpler to keep fast than a React scene graph. |
| 3 | All history lives in `data/` as JSON; `src/scene` only knows model *kinds* and parameters. | Dates, sources and assets can be replaced, and locations added (`src/lib/data.ts` registry), without touching the renderer. |
| 4 | Years: data uses signed historical years with no zero (−55 = 55 BCE). Internally a continuous astronomical value where 1 BCE = 0. | Makes the BCE/CE boundary continuous for playback while labels never show a year 0. |
| 5 | Non-linear slider (prehistory compressed to 14% of the track), with an exact typed-year input. | 4,000 years of slow change would otherwise leave the documented centuries a few pixels each. |
| 6 | Named landmarks = dated *phases* (construction, alteration, fire, ruin, demolition). Generic houses and trees = dated *zones* evaluated on the GPU per instance. | Continuous change rather than a slideshow, at no per-frame CPU cost. |
| 7 | Evidence classes (attested by standing fabric / excavation / documents / period views; reconstructed; conjectural) and confidence on every landmark and zone; shown in the info panel, on label colour, and as an optional tint. | The brief's requirement to separate evidence from plausible fill. |
| 8 | Benchmark district = the London Bridge bridgehead (570 × 680 m). | The only spot that matters in every era: prehistoric crossing point, Roman bridge and quays, Saxon bridge, medieval stone bridge, Tudor Nonsuch House. |
| 9 | True vertical scale; heights in metres above modelled high water. | Avoids exaggerating low hills relative to buildings. |
| 10 | Port 4310. | 3000 and other common ports were in use; nothing else was stopped. |
| 11 | Roman era preset moved from 130 to 150 CE. | 130 falls just after the Hadrianic fire; sources put the population peak nearer 150. |
| 12 | Demolished and burned structures clear within about a year of their recorded date. | Independent testing found remains lingering beside dated successors (the Drawbridge Gate under Nonsuch House, the first Globe beside the second). |
| 13 | Events are data entries with their own evidence fields, staged only where the site is on the map. | Keeps tradition and conjecture labelled, and avoids inventing battlefields that have not been modelled. |

## Realism iterations (fixed viewpoints, `docs/screenshots/`)

| Pass | Change | Result |
|------|--------|--------|
| v1 | First full-timeline render. | Functional; flat lighting, no visible shadows, tiling water, land ended as a slab. |
| v2 | Sun/ambient rebalanced so shadows read; planar-reflection water; terrain extended into haze; smooth foreshore; larger, correctly coloured trees; built waterfronts; soft settlement edges. | Reads as a landscape; reflections too mirror-like; outer ground streaked. |
| v3 | Redrawn timber-frame, tile and lead materials with per-building tint; cloud layer; plain outer ground; Southwark bridge foot filled in; more pointed arches. | Bridge district begins to look like the period views; water over-distorted. |
| v4 | Water ripple scale and distortion tuned; tints and haze toned down. | Current state. |

| v5 | Photorealism push: photo-scanned PBR materials (stone, brick, tile, thatch, timber, plaster, ground) and a photographed HDR sky from Poly Haven; timber-frame wall composited from scans; ground blended from scanned grass, forest floor, mud and earth; ambient occlusion from the scene depth; sun and shadows aligned to the sun in the sky photograph; multi-lobed trees and hedgerow trees; river craft; per-year culling of buildings that do not exist. | Lighting, sky, water and stonework now hold up at a glance; the low river view of the bridge is the strongest frame. |

**Verdict: still not photorealistic, though much closer.** What now reads as real: sky and
cloud reflections, image-based lighting, shadows and contact shading, scanned stone, brick and
roof surfaces. What still gives it away: buildings are boxes and prisms with flat textured
walls (no modelled windows, doors, eaves or sagging roofs); houses repeat; trees are smooth
lobes, not leaves; the ground is flat-shaded with no grass, ruts or puddles; there are no
people, animals, carts, smoke from chimneys or moving boats; the water has no wakes or
shoreline foam; and the schematic overview still uses a lattice street plan.

## Assets

All external assets are CC0 from Poly Haven (polyhaven.com), listed in `data/assets.json` and
fetched by `scripts/fetch-assets.py` into `public/assets/` (about 70 MB): 1k diffuse, normal
and roughness maps for 25 materials, and one 2k HDR sky (Kloofendal 48d Partly Cloudy, Pure
Sky). The sky was photographed in South Africa; it stands in for an English summer sky and is
not a historical or geographic source. If `public/assets` is missing the viewer falls back to
its built-in procedural surfaces and analytic sky.

## Events

`data/locations/london/episodes.json` holds staged events reachable from the Events menu
(or `?event=<id>`). Each records what is well evidenced, what is tradition, and what any
staging has to invent.

| Event | Year | On this map? | Staging |
|-------|------|--------------|---------|
| Boudica's sack of Londinium | 60/61 | Yes | The dated fire zones burn, with flame and smoke plumes placed inside the excavated burnt area. No figures or armies are shown. |
| Battle of London Bridge | 1014 (saga date) | Yes | Longships below the timber bridge. The bridge is **not** shown collapsing, because the contemporary chronicle does not record it. Marked conjecture. |
| Battle of Brentford | 1016 | No, about 15 km west | Information panel and a view towards the site only. |
| Battle of Barnet | 1471 | No, about 17 km north | Information panel and a view towards the site only. |

Left out at the owner's direction: Brentford and Turnham Green (1642) fall after the
timeline ends in 1625; Cable Street (1936) was withdrawn.

## Sources

Three research passes (prehistoric/Roman, Saxon/medieval, Tudor/Jacobean) recorded 130 fetched
sources in `data/sources.json`; `docs/SOURCES.md` lists them by landmark with dates, evidence
class and confidence, plus reliability notes on the period views of London Bridge. Raw research
output is kept in `research/`.

Access caveat: Historic England, Historic Royal Palaces, British History Online, the British
Museum, UK Parliament and several others refused automated fetching, so some standard references
could not be checked directly. Where a figure was seen only in a search summary or secondary
account, the entry says so.

## Limitations (what is provisional)

**Whole scene**
- Terrain is an analytic approximation (two low hills, Walbrook and Fleet valleys, marshy south
  bank), not a survey or borehole model. Prehistoric channel and island shapes are illustrative.
- The river's 1625 bank line is approximated from the modern river. The Roman waterfront advance
  (about 35 m) is sourced; the medieval share of reclamation is a modelling assumption.
- Woodland cover percentages are an illustrative trend, not measurements.
- Coordinates of lost buildings are estimates from modern landmarks (typically ±20–50 m).
- Building heights are almost never documented; all are estimates.

**Schematic overview (everything outside the district rectangle)**
- Streets follow a regular lattice, not the real street plan. Each house model stands for
  several real buildings. Parish churches are evenly spread placeholders (the count is attested).
- Landmarks are parametric stand-ins with the documented footprint and approximate height.
  Palaces (Whitehall, Savoy, Bridewell) are generic courtyards. Wall bastions are evenly spaced.
- Fires other than 60/61, the 120s and named building fires are timeline events only; the fabric
  does not burn in 1087, 1135 or 1212. The Black Death is an event with no visual change.
- Not modelled: Tower moat, Moorfields, the Blackfriars wall extension, bridge corn mills,
  White Tower turret caps, Queenhithe's early beach market, fields, hedges, orchards.

**Benchmark district**
- London Bridge follows the recorded length (about 276 m), 19 arches plus drawbridge, and the
  positions of chapel, drawbridge, gates and Nonsuch House. Individual pier and arch sizes, deck
  height and every house are generated. Period views disagree in detail.
- St Magnus, St Olave, Fishmongers' Hall and Winchester Palace are generic forms on the right sites.
- Roman quays are one generalised line; the Roman and Saxon bridges are generic timber trestles.
- Walk mode follows the ground, not the bridge deck (use Q/E to rise to deck level).
- River craft are static, generic hulls in illustrative positions. Hedgerow and garden trees are illustrative.
- Lambeth Palace and Bermondsey Abbey have no fetched source and are flagged low confidence.

## Testing and performance (final run)

- Unit tests: 104 passed (`npm test`): year arithmetic and the BCE/CE boundary, every lifecycle
  ending, dataset validation, and a table of anachronism checks against the data.
- Browser tests: 155 passed (`npm run test:e2e`, headless Chrome): load, timeline endpoints,
  BCE/CE readout with no year 0, six era presets, play/pause/reverse/speed/stop-at-ends, camera
  unchanged across every way of changing the year, reset view, orbit/walk, landmark lifecycles in
  the live scene, picking and the info panel, scope badge, quality switching, invalid input.
- Defects the independent tester found and that were fixed: a crash on an invalid year value,
  a missing favicon, and demolished or burnt buildings lingering beside their dated successors.
- Production build (`next build`) compiles and was smoke-tested on a spare port.

Apple M3 Max, headless Chrome (ANGLE/Metal), 1500 × 900. "ms" is an unthrottled render of one
frame including reflection, shadows and occlusion; treat as relative.

| Quality | Overview 1616 | City 1616 | Bridge 1616 | Overview 4000 BCE (full forest) |
|---------|---------------|-----------|-------------|---------------------------------|
| Low | 6.8 ms | 6.8 ms | 6.4 ms | 6.0 ms |
| Medium | 25 ms (54 fps) | 24 ms (55 fps) | 18 ms (60 fps) | 19 ms (56 fps) |
| High | 25 ms (45 fps) | 25 ms (51 fps) | 20 ms (60 fps) | 28 ms (38 fps) |

On a Retina display at full pixel density, High drops to 20–35 fps (worst in the forested
prehistoric overview, 19 M triangles); Medium holds 43–59 fps. Not tested: other browsers,
other machines, touch input.
