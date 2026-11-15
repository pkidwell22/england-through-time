# Stonehenge and its landscape: build record

Site id `stonehenge` (`/?site=stonehenge`, or "Explore this site" on the national map). Timeline 4000 BCE – 1625 CE,
opening at 2400 BCE. Data in `data/locations/stonehenge/`; models in `src/scene/prehistoric.ts`,
`src/scene/megaliths.ts`, `src/scene/earthworks.ts`. Research (with every fetched URL) in `research/stonehenge/`.

## How it was built

A lead (Opus) and Sonnet subagents, each briefed from `research/stonehenge/BRIEF.md`:

| Agent | Output |
|---|---|
| Monument researcher | `research/stonehenge/monument.{md,json}`: Stages 1–5 (Darvill et al. 2012, EH Research Report 1/2012), dimensions, alignment, later history |
| Landscape researcher | `landscape.{md,json}`: 31 features (cursuses, long barrows, Durrington Walls, Woodhenge, barrow cemeteries, Vespasian's Camp, Amesbury), vegetation trend, events |
| Stone catalogue | `data/locations/stonehenge/stones.json` (127 numbered stones), `stones.md` |
| Geography / terrain | `geo.{md,json}`: origin, feature coordinates (OSM, EU-DEM), analytic terrain fit |
| Megalith builder | `src/scene/megaliths.ts`, `scripts/stonehenge/sync-stones.mjs` |
| Earthwork builder | `src/scene/earthworks.ts` |
| Data authors (2) | `site/eras/events/episodes/sources.json`; `landmarks.json`, `zones.json` (generator `research/stonehenge/d2/gen.mjs`) |
| Tester | `tests/unit/stonehenge.test.ts`, `tests/stonehenge-e2e.mjs` |
| Realism pass, source checker | second megalith pass; verification of the external fact review |

LIDAR terrain (`terrain-lidar.json`, `research/lidar.md`) was supplied by a separate workstream: the engine uses the
Environment Agency 1 m DTM with 219 earthworks removed ("natural surface"), and the dated earthworks here are drawn as
models on that surface. The analytic fit in `site.json` is the fallback.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Origin = centre of the sarsen circle, 51.17888, −1.82619 (within 3 m of three independent determinations); megaliths anchored at the catalogue's fitted centre 51.178868, −1.8261962. | Every stone position is az/r from that centre. |
| 2 | Bounds x −2700…3700, z −2800…2200 (6.4 × 5 km); district (detailed) x −400…400, z −350…300. | Holds the stones, Avenue, Durrington Walls, Woodhenge, the Avon and Amesbury. Robin Hood's Ball is ~1 km outside: an off-map episode. |
| 3 | Non-linear timeline: 3700–1500 BCE takes ~79% of the slider. | The documented change happens there. |
| 4 | Stones are data: `stones.json` holds each stone (Petrie number, set, position, size, state when built, state in 1625, how that is known); `sync-stones.mjs` copies the selection each phase names into `landmarks.json`. | The arrangement can be corrected without code. A unit test fails if the two drift. |
| 5 | Two stone states only: "built" (as completed) and "1625". The hand-over between them is at year 1 CE **by convention**. | Which stones fell or were taken when is unknown between c. 1500 BCE and the first drawings (c. 1573). Year 1 sits inside that window; Roman-period disturbance is recorded. Every phase says so. |
| 6 | The 1625 state is reasoned backwards from Stukeley's 1720s counts (which equal today's) and from dated later events (1797 fall of 57/58/158; 1900 fall of 22/122; 1901 straightening of 56; re-erections 1958–64). | Nobody recorded the stones in 1625. Inigo Jones's 1620 plan is idealised. |
| 7 | Bluestone settings by stage are separate landmarks handing over at their stage dates; settings known only as patterns are parametric rings with documented counts. | Individual bluestone moves are not traceable. |
| 8 | Ditches are terrain valleys with dated `fill` (dug, then silting); banks, linings, mounds and posts are models. Fresh chalk → weathering → turf are separate phases. | The terrain mesh cannot have holes; the silting keyframes and surface phases are labelled modelled. |
| 9 | One fixed afternoon sun (the photographed HDR sky). The solstice episodes add computed `sightline` markers present only in 2500 BCE. | The engine has one sun per site; a low sun would drop the HDR sky. The markers are labelled computed overlays, not lighting. |
| 10 | `sightline` is a staged kind (added to `STAGED_KINDS`). | It must be present for exactly one year, with no construction animation. |
| 11 | A fill-0 zone (`open-downland-tree-mask`) keeps the illustrative generated trees off the monument from 3300 BCE. | Molluscan and soil evidence shows open grassland; the engine fells trees only where a zone grows. |

## Stage chronology used (Darvill, Marshall, Parker Pearson & Wainwright 2012, Table 3)

| Stage | Years BCE | Drawn |
|---|---|---|
| 1 | 3000–2620 | Ditch and bank (dug 3000–2950, modelled 2900), 56 Aubrey Holes, bluestones in the Aubrey Holes (Parker Pearson's reading; low confidence) |
| 2 | 2620–2480 | Trilithons (raised 2580–2520), sarsen circle (2560–2470), Q/R bluestone double arc, Altar Stone, Station Stones, Heel Stone; Slaughter Stone 2475 |
| 3 | 2480–2280 | Avenue (2400–2300), ditch re-cut with counterscarp (2350, bracketed only), central bluestone circle |
| 4 | 2280–2020 | Outer bluestone circle (from 2220) and bluestone oval (2120–2020) |
| 5 | 2020–1520 | Bluestone horseshoe (from 2020); Y/Z holes are not drawn |

Sources: `sto-darvill-2012-remodelled`, `sto-marshall-2012-eh-chronology` (see `data/locations/stonehenge/sources.json`).
Elsewhere: cursuses c. 3500 BCE (English Heritage), Durrington village c. 2506–2494 (display window for 10–12 years),
timber ring 2530–2481, henge from 2480; Woodhenge timber rings 2635–2610 and ditch and bank 2420–2400 (Historic England
2024); barrow cemeteries in four steps 2200–1550; Bush Barrow 1950; Vespasian's Camp from 700 (placeholder); Amesbury
nunnery 979, priory rebuilt 1177–1186, dissolved 1540 (1539 in some sources).

## Evidence, reconstruction, conjecture

- **Evidence:** dates of the stages, stone counts, the monument's dimensions (ring 29.6 m outer diameter, earthwork
  c. 110 m), stone positions (OSM outlines and the 30-fold ring; ±0.5–1 m), the existence and location of every
  earthwork (LIDAR, OSM), the Stukeley-era state of the stones.
- **Reconstruction:** each stone's shape (seeded procedural blocks to the recorded size), bank and ditch profiles,
  barrow sizes and forms (OSM gives no form: generic bowls), ring spacing and post sizes of the timber circles, the
  Avenue's first 35 m and last 190 m (axis extrapolation), the completeness of the sarsen circle (missing uprights 13, 17,
  18, 20, 24 drawn in the built phase; the 2013 parchmarks support it but do not prove it).
- **Conjecture (marked `conjectural`):** timber post heights, the Durrington houses' number (about 60) and roofs, the
  Northern Circle, the Southern Circle's ring sizes, the Roman building, the Bronze Age field banks, the Amesbury priory
  and house forms, all chalk-to-turf weathering dates, the year-1 ruin convention, the fresh-to-weathered sarsen
  handover at 2400 BCE.
- **Astronomy:** midsummer sunrise 49.2° / midwinter sunset 230.0° for 2500 BCE (φ 51.179°, obliquity 23.97° from the
  Laskar series, refraction, upper limb, horizon assumed 0.6°: the horizon altitude was not measured). The Avenue's
  first stretch runs at 49.9° (OSM). Computed by the lead; no survey azimuth was found in a fetched source.

## Fact review (14 November 2026): verdicts

Each finding was checked against the source by a separate checker before the data changed.

| Finding | Verdict | Source checked | Change |
|---|---|---|---|
| glm-001 Altar Stone provenance | **Modify** | Clarke et al. 2024 (Europe PMC full text): "cannot have been sourced from southern Britain", closest to the Orcadian Basin. Sci.News report of Pirrie et al. 2026 questions the match (paper not read). | Summary names the 2024 Orcadian Basin result, says a 2026 study questions it and that the source is unresolved. |
| glm-002 Lesser Cursus date | **Accept** | English Heritage, *Stonehenge Reconstructed*: both cursuses "built in about 3500 BC". | 3550–3500 BCE (display), c. 3000 BCE noted as an alternative. |
| glm-003 Coneybury Anomaly | **Accept** | Same EH page: earliest cattle bone 3950–3790 BC. | Event relabelled, placed at 3870 BCE, "unverified" removed. |
| glm-004 Amesbury priory 1177 | **Modify** | VCH Wilts vol 3 pp 242–259 (not vol 18, which 404s): Henry II built a new house and church; nuns moved in 30 Nov 1186. | Priory church built 1177–1186; citation is VCH vol 3. |
| glm-005 Durrington timber ring overlap | **Accept** (display years) | Current Archaeology: posts removed before the henge covered them; ring stood at most ~50 years. | 2530–2481 BCE, gone before the henge (2480). |
| glm-006 Durrington houses span | **Accept** | Current Archaeology: inhabited 10–12 years, out of use c. 2500–2460 BC. | Zone 2506–2494 BCE, labelled a display window. |
| glm-007 Woodhenge (S1) | **Accept**, without the unverified ring A/B wording | Summary of Historic England Research Report 94/2024 (the HE page refused fetching): timber 2635–2575 cal BC; ditch and bank 2495–2180, most likely 2465–2345. | Timber rings 2635–2610 (decay 2500–2350, placeholder); ditch and bank 2420–2400. |
| glm-008 Woodhenge event | **Accept** | As 007. | Event at 2400 BCE plus a new timber-rings tick at 2620 BCE. |
| Astra H03 Aubrey Holes confidence | **Accept** | Darvill 2012 / EH chronology (second-hand: the PDF could not be extracted). No source dates the filled dimples; the phase is a convention. | confidence high → medium. |
| Astra H04 ditch and bank confidence | **Accept** | As H03: the year-1 lowering is a convention. | confidence high → medium. |
| Duplicate sources, stone 14 | **Accept** | — | Duplicates removed in `stones.json`. |

Tests that encoded the old dates now carry a comment citing the correction.

## Limitations

- Stone shapes are procedural; outlines of individual stones are not surveyed. Bluestone circle positions 33–36 and
  42–44 are interpolated (±20°). Sizes of trilithon uprights are weight-derived.
- 1625 states are inferred (see decision 6); fall directions are assumed inward; the Great Trilithon may have fallen
  only in 1620 (Aubrey's tradition) and is drawn fallen from year 1.
- Barrow forms are generic; barrow build order is illustrative; cemetery steps are 2200/1950/1750/1550.
- Earthwork profiles (bank widths and heights) are modelled; the Stonehenge bank profile is not recorded in a source read.
- The Heel Stone's lean is not modelled. Mortise holes on fallen lintels and tooling on dressed faces are not modelled.
- The Southern Circle's position is ±60–100 m; the Durrington Walls ring is an ellipse from gazetteer dimensions.
- Amesbury town, abbey, parish church and house are generic stand-ins on approximate sites.
- Vegetation, ground grass and people come from shared engine layers, not from this site's data.

## Placement audit

`AUDIT_SITES=stonehenge node tests/placement-audit.mjs`: before (docs/AUDIT.md) 3 labels under the surface and no
ground plans for world-space earthworks; after (`research/stonehenge/audit-after.json`, 218 years checked) 0 hard
defects, still 3 soft `i.labelUnderground` (greater-cursus#0 1.6 m during construction, durrington-timber-ring#0,
durrington-walls-henge#0). Both remaining items need `src/scene/landmarks.ts` (owned by another workstream):

- Every Stonehenge builder now reports its ground plan through `BuildCtx.trace` as `{ kind: "plan", shape: "circle"
  (x, z, r) | "ring" (x, z, r0, r1) | "strip" (x, z, len, width, rot) }`: each megalith (lying stones centred along
  their length), henges (bank + ditch annulus), pit rings, timber circles, every barrow, long barrows. Banked avenues,
  ramparts and palisades are already `CORRIDOR_KINDS`. **Proposed change in landmarks.ts:** for world-space kinds, turn
  `plan` trace items into `solids` (circle → 16-gon; strip → rectangle; ring → its outer circle as a solid only for
  barrows and timber circles, and the annulus for henges) so fabric, trees and walkers keep out.
- Labels of very large world-space features are anchored at the bounding-box centre at `lowY + (topY − lowY) · height
  + 4`; on a 2.7 km cursus or a 450 m henge on sloping ground the box centre can be below the ground there.
  **Proposed:** anchor at `ground(centre) + 4` (or at the highest traced plan point) for world-space kinds.

## Testing

- Unit: `tests/unit/stonehenge.test.ts` 33/33 (validation with zero problems, every source id resolves, the
  anachronism table, stones.json ↔ landmarks.json sync, terrain and camera checks); whole suite 297/297.
- Browser: `tests/stonehenge-e2e.mjs` 275/277 on the final full run. The two failures: the landscape camera target
  sat 12 m above the LIDAR ground (fixed; the views group re-run passes, 52 checks) and the strict 33 ms budget in
  the landscape and barrow views (see below). London `tests/e2e.mjs` 155/155 after the Stonehenge changes.
- Defects the tester found and that were fixed: solstice markers visible (rising) in 2501 BCE (now a staged kind);
  two wrong test expectations (Durrington circles in 2420 BCE; the priory church in 1620).

## Performance

Apple M3 Max, headless Chrome (ANGLE/Metal), 1600 × 900, dpr 1, other agents' browsers running. `benchmark(20)`
ms per frame (unthrottled render incl. shadows and occlusion; relative only), High quality, v2:

| View | 2400 BCE | 1620 | Triangles | Draw calls |
|---|---|---|---|---|
| landscape | 27.6 ms | 25.8 ms | 2.9–4.0 M | 152–303 |
| avenue | 12.1 | 10.3 | 2.3–3.1 M | 78–220 |
| inside | 12.2 | 11.7 | 2.5–3.0 M | 83–205 |
| low (stone height) | 12.4 | 12.0 | 2.3–2.9 M | 103–146 |
| durrington (2480 BCE) | 11.3 | | 1.7 M | 86 |
| barrows (1800 BCE) | 17.1 | | 2.2 M | 103 |

Browser-suite matrix (`tests/stonehenge-results.json`, 1500 × 900, `benchmark(30)`, years 2400 BCE / 1620):

| Quality | landscape | avenue | inside | low | durrington | barrows |
|---|---|---|---|---|---|---|
| Low | 10.0 / 20.2 ms | 8.2 / 7.9 | 7.7 / 8.3 | 8.5 / 7.7 | 8.7 / 8.3 | 9.4 / 9.7 |
| Medium | 36.8 / 38.1 | 26.1 / 26.7 | 24.6 / 24.4 | 28.6 / 26.3 | 20.7 / 27.0 | 33.1 / 32.3 |
| High | 39.1 / 39.5 | 32.4 / 29.5 | 28.0 / 29.2 | 27.8 / 29.4 | 26.9 / 28.3 | 36.9 / 36.6 |

The landscape and barrow views miss a strict 33 ms (30 fps) budget at Medium and High on this loaded machine. An
earlier run on a busier machine was 18–51 ms throughout. Low still draws about 0.4–1.1 M triangles, mostly the
shared ground grass, trees and terrain. The monument itself is about 0.3–0.4 M triangles when visible (megaliths) plus
25–55 k per earthwork.

## Realism iterations (`docs/screenshots/stonehenge/v1`, `v2`; same fixed views)

| Pass | Change | Result |
|---|---|---|
| v1 | First full render on the LIDAR surface: procedural stones, chalk/turf earthworks, scanned rock materials. | Monument reads correctly in plan and section; stones look like beige cut ashlar with whole faces of vivid lichen; the henge bank is a narrow steep tube; white tenon spheres on ruined trilithons; the Avenue's grassed ditches showed as translucent bands; landscape view lost in haze. |
| v2 | Stones rebuilt (rounded and chipped arrises, 5–11 cm face relief, flatter dressed inner faces, uneven tops and lintels, jagged breaks, low stone-material tenons, patchy contour-clipped lichen, cooler grey tint); bank widened and lowered (6 × 1.5 m, 7 × 0.9 m from year 1); no ditch linings on grassed earthworks; thinner fog and a lower landscape camera; Durrington view at 2500 BCE added. | Close views now read as weathered grey sarsen; the 1620 ruin looks like the monument in early drawings. |

**Verdict: not photorealistic.** At stone height in good light (`v2/low-2400bce.png`, `v2/inside-2400bce.png`) the
sarsens hold up at a glance for a second or two; the sky, the light and the stone colour are believable. What gives it
away: the ground (a flat, saturated green terrain colour with sprite-like grass tufts that grow in rows on the
1620 farmland, from the shared ground layer); bluestones with uniform pocked texture; lichen as a hard texture switch;
no tooling marks, mortise holes or weathering streaks; banks and barrows are smooth lofts with no turf texture
breakup; timber posts are identical tidy logs; trees are generic scans dropped on open downland; no people, animals or
smoke at the monument; the overview is a uniform green plain in haze.

## Next steps toward photorealism (in priority order)

1. Ground: a downland turf shader for this site (short grass, flowers, sheep-cropped patches, worn paths round the
   stones) instead of the shared tufts; mask ground detail out of ditches and pits.
2. Stones: per-stone normal and roughness detail (tooling grooves on dressed faces, pitting, rain streaks), lichen as a
   blended layer, not a material switch; sculpted mortise holes on fallen lintels; consider photogrammetry-derived
   detail maps (the EH laser scan exists; licensing to be checked).
3. Earthworks: re-cut the LIDAR residuals for each dated earthwork (the LIDAR workstream recorded real heights), so
   banks have their true surveyed profiles instead of modelled ones.
4. Light: a per-episode sun (needs an engine change) so the solstice events are lit, not marked.
5. Life: people, cattle and pigs at Durrington, smoke from hearths, construction crews and sledges during the sarsen
   raising (all conjectural, labelled).
6. Performance: let Low quality drop the ground detail and far trees.

## Files

Data: `data/locations/stonehenge/{site,eras,events,episodes,landmarks,zones,sources,stones}.json` (`terrain-lidar.json`
belongs to the LIDAR workstream). Regenerate landmarks and zones: `node research/stonehenge/d2/gen.mjs && node
scripts/stonehenge/sync-stones.mjs`. Tests: `npx vitest run tests/unit/stonehenge.test.ts`, `node
tests/stonehenge-e2e.mjs`. Screenshots: `node tests/stonehenge-shots.mjs <label> [quality] [filter]`.
