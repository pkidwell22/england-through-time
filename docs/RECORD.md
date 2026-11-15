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
| 14 | Stonehenge site: stones are data (stones.json, synced into landmarks by scripts/stonehenge/sync-stones.mjs); stone states before the first drawings are undated, so the built→1625 handover is at year 1 by convention; solstice episodes use computed sightline markers (a staged kind), not lighting. | Honest about undated losses; correctable without code. See docs/STONEHENGE.md. |
| 15 | Everything generic (houses, trees, figures, craft, street surfaces) is checked against every year it stands, not one representative year; `tests/placement-audit.mjs` fails on any hard defect. | Houses stood in the river, in streets and on wharves as the ground and bank changed under them. See docs/AUDIT.md. |
| 16 | A church phase can be pinned by one end (`eastEnd` / `westEnd`); inlet docks are dated terrain inlets; the timber London Bridge runs parallel about 33 m downstream of the stone one. | The 33 m is not documented: it is the smallest offset that clears the stone bridge's starlings. Low confidence, stated in the data. |
| 17 | National data: `phase.to` is inclusive everywhere (next phase starts the following year); alternative names in different languages may overlap in time. | Wales had been written the other way; Latin, Welsh and English names were in use together. |

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


## Since v6 (state on 2026-11-14)

The sections above describe the first London-only version and are kept as written. What has
been added since, with the note that covers each:

- National map of England and Wales with drill-in sites (docs/NATIONAL-PLAN.md); sites for
  Brentford (1016), Barnet (1471) and Stonehenge (docs/STONEHENGE.md).
- Close-range streets and facades (docs/STREETS.md), period vessels (docs/VESSELS.md), scanned
  trees and ground cover (docs/VEGETATION.md), figures, props, smoke.
- Live-view look: measured light units, AgX tone mapping, cascaded shadows, cloud shadows, aerial
  perspective, new river shader, light presets, a Cinematic tier (docs/LOOK.md).
- Path-traced photo mode for stills (docs/PHOTO-MODE.md). Saved images are captioned
  "Reconstruction, not a photograph".
- SQLite mirror of every fact (docs/DATABASE.md) and external fact reviews by GPT-6 Astra,
  DeepSeek and GLM, with the adjudicated corrections in docs/CORRECTIONS.md.
- Placement audit and structural fixes (docs/AUDIT.md).

**Credits (licence conditions).** Contains Environment Agency information © Environment Agency
and/or database right 2026. Licensed under the Open Government Licence v3.0. Feature outlines
© OpenStreetMap contributors (ODbL 1.0), used only to build terrain masks. Materials, skies and
models are CC0 from Poly Haven. National terrain: Copernicus DEM GLO-90 and the GEBCO_2025 Grid.

**Not photorealistic.** Neither the live view nor photo mode would pass for a photograph. The
light is now credible; the content is not: block figures, repeated box houses with straight
edges, clean untextured-by-age surfaces, flat dark windows, card trees at mid distance, and a
washed-out aerial view.

**Known open items.** 44 sunk houses in London and 9 in Barnet on steep plots; the bridge's north
approach clips St Magnus in 1250–1350; no boats inside the docks or walkers on the bridge ramps;
City natural ground level unverified; 38 sourcing flags from the external reviews; Astra's
research database (research/astra/england.sqlite) is not yet wired into the app; dawn-preset
puddles are too white; trees are non-British stand-in species.

**Tests (2026-11-14, after all workstreams).** Unit 297/297; London browser suite 155/155;
Brentford and Barnet 290/290; national map 279/279; national data checks pass; database 124/124;
placement audit 0 hard defects on London, Brentford and Barnet. Stonehenge 276/277: the failure
is its own 33 ms frame budget in the landscape and barrow views (37–39 ms in that run, which
shared the machine with other suites).

**Frame times (`node tests/perf.mjs`).** Apple M3 Max, headless Chrome (ANGLE/Metal), 1500 × 900
at pixel ratio 1, ms per frame, best of three 30-frame runs. The machine was not idle (load
average about 4–5 from the desktop app), so treat as ±2 ms. "Ready" is page open to first
complete scene on the dev server.

| View | Low | Medium | High | Cinematic | Triangles (High) | Draw calls (High) | Ready (High) |
|---|---|---|---|---|---|---|---|
| london overview 1616 | 7.6 | 19.1 | 20.2 | 22.0 | 3.56 M | 1285 | 6.0 s |
| london city 1616 | 7.9 | 17.8 | 18.4 | 22.0 | 3.63 M | 1322 | 5.9 s |
| london bridge 1616 | 7.3 | 16.3 | 17.0 | 20.0 | 1.70 M | 498 | 6.0 s |
| london bridge-low 1616 | 7.7 | 15.7 | 18.2 | 20.4 | 4.35 M | 1533 | 6.0 s |
| london bridgehead 1616 | 7.5 | 16.3 | 17.5 | 24.0 | 2.04 M | 643 | 5.9 s |
| london overview 4000 BCE | 5.8 | 17.3 | 19.0 | 21.2 | 1.74 M | 47 | 5.9 s |
| london city 150 | 6.3 | 15.6 | 17.1 | 19.4 | 1.60 M | 389 | 5.9 s |
| brentford default 1016 | 4.5 | 9.7 | 11.3 | 13.1 | 0.68 M | 211 | 0.9 s |
| barnet default 1471 | 5.8 | 12.1 | 12.3 | 13.2 | 1.85 M | 256 | 1.1 s |
| stonehenge default 2400 BCE | 6.2 | 17.1 | 18.1 | 19.5 | 2.28 M | 107 | 26.8 s |

What stands out for the optimisation round: Stonehenge takes about 27 s to become ready; London
at High issues 1,300–1,500 draw calls in the wide and river views; Low still draws most of the
geometry.


## Optimisation round 1 (2026-11-14)

Profiled first (`tests/profile-load.mjs`, `tests/profile-frame.mjs`), then changed what the profiles pointed at.

**What the profiles showed.** Frames are bound by the GPU, not by script: at High, about 6 ms of script and
12–20 ms waiting on the GPU. On a 2x screen the ground shader alone was about 9 ms of a 26 ms frame, the water's
mirror pass redrew nearly the whole scene every other frame, and each landmark carried its own materials (292
in the 1616 overview). Draw-call count as such was not the bottleneck. Stonehenge's 26 s load was 20 s of
terrain height lookups for its earthworks.

**Changes.**

- Terrain height lookup (`src/lib/terrain.ts`): valley distance without allocation, segments and valleys
  skipped by bounding box, far hills skipped; the landmark sample cache keyed by number, not string. Results
  are unchanged to within 1e-13 of a feature's height. Stonehenge ready in about 6–7 s, from 26 s.
- Water mirror pass skipped above about 350 m camera height (`look/water.ts`): the river then reflects the
  sky only. At that angle water reflects a few per cent and the difference is not visible.
- Multisampling follows the pixel ratio when temporal anti-aliasing is on (`engine.ts`): none at 1.75 and
  above, two samples from 1.25. Compared side by side on rigging at 2x: no visible difference.
- Complete, sound landmarks share one set of materials (`landmarks.ts`); a phase under construction, in
  ruin, on fire or under the evidence overlay keeps its own. 292 materials become 44 in the 1616 overview.
- Automatic resolution (`engine.ts`, `&res=auto|fixed`): Medium and above lower the pixel ratio in steps
  while frames run late and raise it when they run on time, never below 0.75. Off in automated browsers.
  Cinematic on a 2200 × 1300 window at 2x settled from 30 ms to 21 ms a frame at ratio 1.44.
- Timber-frame textures are no longer painted twice at load (`street/frameTex.ts`). London ready in about
  4.4 s, from 6 s.
- The ground is drawn after the other solid things. No measurable effect on Apple GPUs; kept for others.

**Measured in one page, switching one thing at a time (London overview 1616, High; the reliable numbers).**
2x screen: 26.2 ms before; mirror skip −2.3; multisampling 4 → 0, −4.5; shared materials −1.0; about 18.7 ms
after. 1x: 17.2 → 13.9 ms.

**Full table after (`node tests/perf.mjs`, 1500 × 900 at ratio 1, ms per frame).** This run had a quieter
machine than the table above it, and sites that were not changed (Brentford, Barnet) also read about half
their earlier figure, so the difference between the two tables overstates the gain. The earlier results are
kept in `tests/perf-results.before-optimisation.json`.

| View | Low | Medium | High | Cinematic | Ready (High) |
|---|---|---|---|---|---|
| london overview 1616 | 6.1 | 13.1 | 14.1 | 15.8 | 4.4 s |
| london city 1616 | 6.4 | 12.2 | 13.0 | 16.2 | 4.4 s |
| london bridge 1616 | 5.8 | 11.6 | 12.0 | 18.5 | 4.6 s |
| london bridge-low 1616 | 6.9 | 15.2 | 13.3 | 16.9 | 4.6 s |
| london bridgehead 1616 | 5.6 | 10.9 | 13.3 | 14.4 | 4.7 s |
| london overview 4000 BCE | 2.8 | 6.5 | 7.7 | 9.2 | 4.1 s |
| london city 150 | 3.5 | 8.6 | 8.6 | 9.5 | 4.4 s |
| brentford 1016 | 2.1 | 4.8 | 5.0 | 6.1 | 0.8 s |
| barnet 1471 | 2.9 | 6.0 | 6.3 | 7.3 | 0.9 s |
| stonehenge default 2400 BCE | 3.2 | 8.5 | 9.4 | 10.9 | 6.4 s |
| stonehenge landscape 2400 BCE | 3.2 | 8.7 | 12.9 | 16.8 | 7.5 s |

**Tests after.** Unit 297/297; London 155/155; Brentford and Barnet 290/290 (two groups passed on retry; a
source file was edited while they ran); Stonehenge 277/277 (its frame budget now met); national 279/279;
placement audit 0 hard defects; `tests/res-auto.mjs` 5/5.

**Not done.** The ground shader is still the largest single cost and was not rewritten. The Low tier was left
alone (3–7 ms). Landmarks are not batched across landmarks. No production build yet; all figures are from the
dev server. The placement audit still does not cover Stonehenge.

## Realism round 1 (2026-11-14)

Three parallel passes (houses, trees, ground and air seen from above), then a fix pass on the houses and the ground after
review. None of it is photorealistic; each pass lists what still looks wrong.

**Houses** (`street/houseShader.ts` new, `street/kit.ts`, `houses.ts`, `fabric.ts`, `materials.ts`, `pop/smoke.ts`)
- Per-house shape in the vertex shader: height, roof pitch, ridge sag with age, wandering eaves, lean, set-back.
- Per-house wear in the fragment shader: limewash tone, damp and splash at the foot, run-off, grime with age, soot at
  stacks and smoke vents, patched and mossy roofs.
- Openings draw a room behind them (interior mapping); leaded glass is a dielectric over the same room.
- One alternate design per medieval and Tudor street variant on the same footprint (two were designed; two cost about
  +4.9 ms at the bridgehead, one about +1.2 ms). `?houses=alt2|noalt|plain|farbase` for comparison.
- Each alternate has its own distant model, so a house keeps its form past 300 m.
- Chimney smoke is smaller, grey-brown and fades with height. It still reads as faint dotted puffs over dark roofs.
- No new chimneys, glazing, brick or thatch before the periods the data already had them; medieval alternates get smoke
  louvres on tiled roofs only. Wear rates are plausible guesses, not documented.

**Trees** (`veg/impostor.ts` new, `veg/scanned.ts`, `vegetation.ts`, `scripts/bake-octa.mjs`; see `docs/VEGETATION.md`)
- Far and mid trees are hemi-octahedral impostors baked from the four scans, lit by the scene sun and shadows, casting
  crown-shaped shadows, cross-fading into the near meshes. `?treeimp=cards` gives the old crossed cards.
- Lean, crown proportion and stand-wide colour drift per tree; role mix by period.
- Woodland is now cleared by the end of a settlement zone's growth and within 20 m of it, on every site (this removed the
  trees standing in Durrington village).
- The species names in the code are roles only. Poly Haven has no British broadleaf; no tree in the scene is a true
  British species.

**Ground and air** (`ground/land.ts`, `ground/landPattern.ts` new; `terrainMesh.ts`, `ground/cover.ts`, `decal.ts`,
`wrapLayer.ts`, `look/atmosphere.ts`, `presets.ts`, `water.ts`)
- Ground colour is baked on the GPU into three top-down land-use textures (about 1.2 m, 6 m and 30 m per texel) and
  re-baked only when the year's ground changes. The ground shader does one fetch from height and samples the scanned
  layers only within about 260 m.
- Generic, unmapped structure by period: banked fields c. 1700 BCE to c. 1100 CE, open-field furlongs from c. 1000 to 1150
  CE, marsh creeks and drains, trodden verges. Roads and Brentford's field strips are drawn from the data. Arable share
  by year is an illustrative trend. Barnet gets no strips (the notes record pasture and closes).
- Land now runs about 27 km beyond the site with a low irregular skyline; woodland beyond the site comes from the year's
  woodland-cover figure.
- Rayleigh term in the aerial perspective, retuned presets, frayed cloud-shadow edges, patchy mist, river colour by depth.
- `engine.ts` `groundAlbedo()` is now the measured mean of the baked ground, (0.15, 0.17, 0.055) linear.

**Measured in one session, switching one thing at a time (the reliable numbers)**
- Ground shader, new against old, 1× (`tests/ground-ab.mjs`): Brentford 8.3 against 9.5 ms, Barnet 8.8 against 10.9,
  London bridge-low 20.6 against 21.7.
- Houses against `?houses=plain` (`tests/ab-url.mjs`), after the fix pass: about +0.5 ms at the bridgehead and 0 to +1.0
  at bridge-low, at 1× and 2×; run-to-run spread is 1 to 2 ms. Before the fix pass it was +2 to +3 ms.
- Trees, old cards against impostors (`tests/tree-ab.mjs`): level in the overviews; walking in the closed 4000 BCE wood
  costs about 1.2 to 1.6 ms more.
- Atmosphere, mist, cloud-shadow and water changes: each 0.3 ms or less at 2×.

**Full table after the round** (`node tests/perf.mjs`, ms per frame, load average about 5.5)

| view | low | medium | high | cinematic |
|---|---|---|---|---|
| london overview 1616 | 6.2 | 10.8 | 12.1 | 13.9 |
| london city 1616 | 6.3 | 10.4 | 13.0 | 14.7 |
| london bridge 1616 | 5.5 | 11.1 | 13.3 | 18.4 |
| london bridge-low 1616 | 7.1 | 13.1 | 16.4 | 22.9 |
| london bridgehead 1616 | 7.0 | 13.9 | 17.2 | 21.1 |
| london overview 4000 BCE | 4.2 | 8.4 | 8.3 | 11.3 |
| london city 150 | 4.2 | 8.3 | 8.4 | 12.3 |
| brentford 1016 | 3.5 | 8.3 | 8.3 | 9.5 |
| barnet 1471 | 4.1 | 8.3 | 8.3 | 11.6 |
| stonehenge default 2400 BCE | 4.1 | 8.6 | 10.6 | 11.5 |
| stonehenge landscape 2400 BCE | 3.9 | 8.3 | 10.5 | 11.6 |

Against the table from optimisation round 1: London overview and city are level or better; bridge-low at High is 16.4
against 13.3 and Cinematic 22.9 against 16.9; the simple sites read higher (Brentford High 8.3 against 5.0). Many cells
sit at exactly 8.3 ms, which is one 120 Hz display frame, so those readings look capped by the display this time and
are not comparable with the earlier table. The bridge-low rise is not explained by the house A/B (+0 to 1 ms) and is
unresolved.

**Tests on the final code:** unit 297/297; London e2e 155/155; sites 290/290 (Brentford and Barnet timeline-endpoint
groups passed on retry, as before); Stonehenge 277/277; national 279/279; placement audit 0 hard; res-auto 5/5.

**Still wrong**
- London 4000 BCE overview: the drawn woodland still ends in a visible rectangle (textured crowns against flat ground).
- Tidal marsh water reads as flat beige sheets; the river from above is dull once the mirror pass is off (above 350 m).
- Close walls are flat textured planes; glass reads as sky reflection at many angles; the room behind an opening
  brightens in sun.
- Near trees are the four scans (gnarled trunks, repeated crowns); a tree caught mid-fade shows holes on Medium.
- Barnet 1471 is mostly white fog; overcast and dawn are hazier than clear; Stonehenge 2400 BCE is plausible but bland.
- Figures are still blocks. Photo mode is unverified against the house deformation.
- `tests/street-shots.mjs` and `tests/look-shots.mjs` move the walk camera about 70 m on their second pass.

Screenshots: `docs/screenshots/realism/{houses,trees,aerial}/` (before, after, and paired sheets for houses).

## Realism round 2: crowd figures (2026-11-15)

The block people are replaced by instanced MakeHuman (MPFB, CC0) bodies in generic period dress with baked animation;
pipeline, budgets and every costume judgement call are in [docs/FIGURES.md](FIGURES.md). Placement, counts, routes,
lifecycles and the battle staging are untouched (world.ts only had its mesh type widened and an `invalidate()` added;
the troops builder now also records each figure's place). `?figures=blocks` keeps the old figures.

- 13 bodies, 7 garment sets (five periods, Brentford 1016 and Barnet 1471 soldiers), 4 levels of detail, 7 baked clips
  (stand, slow and brisk walk, idle, talk, seated, attention) in one float16 3D texture; `public/assets/figures/` about
  15 MB, one set (2.2-2.6 MB) loaded per period, after the scene is ready.
- Walk phase from distance walked plus v0 x time, stride `Sf * v / (v + v0)`, clip blend chosen to give that stride: no
  foot sliding by construction.
- Figures cast cascaded shadows (levels 0-1; new layer 4 is drawn by the main camera and the sun's shadow cameras but
  not by the water's mirror) and take aerial perspective, mist and cloud shadows like any MeshStandardMaterial.
- A figure fading in or out with its zone's activity is drawn at full size from the same presence threshold as before
  (0.02, so the same people are drawn) instead of being scaled down; the faintest (presence under 0.3) dissolve in.
- Skin values are weighted towards the lighter end (see FIGURES.md); the old even spread read wrongly on faces.
- The populace places no people at Stonehenge in any year (the Durrington village style has no street life in the
  populace code), so 2400 BCE shows no figures before or after; the prehistoric set appears only in London's Late
  Bronze Age farmsteads.

**Measured** (`node tests/ab-url.mjs <dpr> ...`, High, best of 3 rounds, ms per frame; load average 6-8 from other work
on the machine, run-to-run spread 1-2 ms):

| view | dpr | blocks | figures | run |
|---|---|---|---|---|
| London 1616 bridgehead | 1 | 18.2 / 17.06 | 18.42 / 18.31 | two runs |
| London 1616 bridgehead | 2 | 17.13 / 25.3 | 17.54 / 25.4 | two runs |
| Barnet 1471 default | 1 | 9.58 / 8.49 | 9.47 / 8.52 | two runs |
| Barnet 1471 default | 2 | 9.89 / 16.03 | 11.75 / 16.27 | two runs (first noisy: blocks 9.9-12.5) |

So +0.0 to +1.3 ms at the bridgehead and +0.0 to +0.3 ms at Barnet (one noisy outlier). Load (`node tests/figure-load.mjs`,
medians): first frame London 4645 ms blocks / 4664 ms figures, Barnet 1032 / 1017 ms; the figure files load after the
scene is ready and replace the blocks about 2.8 s later. Before the extra far level the Barnet battle cost +3.3 ms
(12,000 soldiers at about 280 triangles); level 3 and the still pose for distant formations brought it back.

Tests: unit 303/303 (6 new in `tests/unit/figures.test.ts`), `tsc` clean. Photo mode converges with figures captured
(7,896 instances kept at the Fish Street Hill eye view); a shader compile error about `worldPosition` in the tree impostor's
photo-capture variant appears with and without figures (pre-existing). Screenshots: `docs/screenshots/realism/figures/`.

**Still wrong:** see FIGURES.md. In short: mannequin faces and plastic shading close up, rigid garments without cloth
motion, LOD pops, jagged painted hems beyond 12 m, no figures at Stonehenge (none placed by the populace), animals and
boat crews unchanged.
