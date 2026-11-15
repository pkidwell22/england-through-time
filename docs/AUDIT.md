# Placement and consistency audit

Everything in the scene is placed once, from dated data, while the ground it stands on changes with the year: the
north bank advances about 110 m as the waterfront is reclaimed (and the ground behind it rises with it), the Southwark
marsh is embanked, the Walbrook silts up, and streets, roads, walls and landmarks come and go. The defects the owner
pointed at (houses standing half in the river in 1233) all had one cause: something placed for **one representative
year** (a zone's middle year, a phase's `built` year, the first year of the timeline) and then shown for decades or
centuries in which that year's ground, water and neighbours no longer held.

The rule now applied everywhere: **everything placed must suit the ground and the neighbours of every year it is
shown.** It is implemented once and reused (see "Root causes and fixes").

## Running it

```
node tests/placement-audit.mjs                       # all sites, ~2 min; writes tests/placement-audit-results.json
AUDIT_SITES=london node tests/placement-audit.mjs    # one site
AUDIT_QUERY=placement=legacy node tests/placement-audit.mjs   # the old placement rules, for comparison
AUDIT_STEP=50 AUDIT_POP=0 node tests/placement-audit.mjs      # faster: coarser sweep, no populace / moving craft
node tests/audit-shots.mjs pairs                      # before/after screenshots (before = ?placement=legacy)
node tests/audit-shots.mjs walk [years…]              # banks, wall, Tower, St Paul's, bridgeheads, suburbs
```

The dev server must be running (`LTT_URL`, default http://127.0.0.1:4310). The script loads each site headless at
High quality, stops drawing (`setRenderOverride`), and sweeps the years in the page itself using `window.__ltt`
(terrain, fabric, landmarks, trees, the populace world and the moving-craft layer). It exits 1 when a **hard**
category is non-zero, or when a site fails to load.

### Years checked

London: every 25 years from 4000 BCE, each era preset, each event year and the years either side, the years either
side of every bank-setback, embankment and valley-fill keyframe, of every zone's growth and decline dates, and of every
landmark phase's `from`, `to` and `built`. Brentford and Barnet: every 5 years of their windows plus the same
keyframes. A year whose live set (houses, visible landmark copies and their states, terrain parameters, trees, streets)
is identical to the previous checked year is skipped. London: 595 years, ~29 skipped, ~70 s.

### What it checks

Counts are of **distinct objects** (a house, a landmark copy, a tree, a walking piece, a craft) and of
**object-years** (each checked year an object is defective). Each category lists its 40 worst cases with position,
first / last / worst year and a description in the JSON.

| Cat | Check | Hard? |
|---|---|---|
| a | `a.wet`: a standing house with its centre or any corner of its plan on ground below 0.3 m (water or foreshore) in that year | hard |
| b | `b.houseSunk` / `b.houseFloat`: ground at a corner more than 1 m above a house's base / a gap under the model's lowest point. `b.landmarkSunk` / `b.landmarkFloat`: the same for landmarks built in their own frame, over every year of every phase. `b.flatBuried` / `b.flatFloat`: road and stream ribbons under the ground or > 0.6 m above it. `b.wallGround`: wall bases more than 2.4 m off the ground of the year. `b.streetSurfaceBuried`: district street surfaces under the ground | soft |
| c | `c.landmark` (house plan overlapping a standing landmark's plan), `c.street` (house in a street of streets.json standing that year), `c.road` (house on a dated road), `c.precinct` (house inside a castle ward) | hard |
| c | `c.wall` (house across a wall), `c.bridge` (house on a bridge or its first 15 m), `c.house` (two houses overlapping by more than 0.6 m beyond party-wall tolerance) | soft |
| d | `d.stranded` / `d.inRiver` (revetment or quay front with dry ground 4 m riverward / water behind it), `d.facing` (a revetment facing away from the water), `d.abutmentInWater`, `d.openingDry` (bridge arch over dry ground), `d.roadInRiver`, `d.streetIntoRiver` (streets.json line on wet ground), `d.streetSurfaceWet` (drawn street surface over water or foreshore) | soft |
| e | `e.craftOnLand` (moored or rowing craft with ground above −0.15 m under the hull, or beached craft inland / afloat), `e.craftInStructure` (inside a pier, quay or wharf), `e.craftOutOfDate` (vessel type outside its dates), `e.movingOnLand`, `e.movingInPier` (moving craft, six instants per year) | hard |
| f | `f.walkerInBuilding`, `f.walkerInLandmark`, `f.walkerInWater` (every walking piece the populace would draw that year, sampled every 5 m and across its width), `f.smokeNoHouse` (a smoke column with no standing house under it), `f.propInBuilding` / `f.propInLandmark` / `f.propInWater` (street clutter sites near six centres) | soft |
| g | trees in water, in houses, in landmark plans, in walls, on roads and streets, floating or sunk more than 1 m | soft |
| h | `h.beforeDate` (a landmark copy visible before its phase's `from`), `h.phaseOverlap` (two phases of one landmark standing together, extensions excepted), `h.zoneLeftover` (a house standing outside its zone's growth-to-decline years) | hard |
| h | `h.landmarkOverlap` (two different landmarks on the same ground, or two bridges on one line) | soft |
| i | `i.labelUnderground`, `i.labelInvisible`, `i.labelOffObject` (a linear landmark's label more than 25 m from the line) | soft |

Not measured automatically (checked by eye in the walk screenshots): grass and reeds on street surfaces (the ground
cover is a camera-following texture), the understorey, and whether a structure "reads" right (a quay facing the water,
a road through a gate's arch).

## Defect counts, before and after

"Before" is the build as it stood at the start of this work (`docs/screenshots/audit/baseline-results.json`); the same
numbers are reproduced by `?placement=legacy`, except for the populace categories (the walkers now follow the fabric
in both modes). Distinct objects (object-years in brackets).

| Category | London before | London after | Brentford before → after | Barnet before → after |
|---|---|---|---|---|
| **a.wet** (hard) | 5 (291) | **0** | 0 → 0 | 0 → 0 |
| b.houseSunk | 1691 (143 764) | 44 (526) | 0 → 0 | 16 (128) → 9 (72) |
| b.houseFloat | 2 (38) | 0 | 1 (37) → 0 | 6 (48) → 0 |
| b.landmarkSunk / Float | 6 (621) / 2 (54) | 0 / 0 (docks are set level with the ground on purpose and not counted) | 0 | 0 |
| b.flatBuried / Float (roads, streams) | 8 (2 343) / 1 (258) | 0 / 0 | 0 | 4 / 4 (hedges: a measuring artefact, now excluded) → 0 |
| b.streetSurfaceBuried | 22 (1 252) | 0 | — | — |
| b.wallGround | 1 (66) | 0 | 0 | 0 |
| **c.street** (hard) | 56 (5 242) | **0** | — | — |
| **c.precinct** (hard) | 4 (262) | **0** | 0 | 0 |
| **c.landmark / c.road** (hard) | 0 / 0 | 0 / 0 | 0 | 0 |
| c.house (overlaps) | 2 351 (64 868) | 0 | 1 (37) → 0 | 2 (16) → 0 |
| c.wall / c.bridge | 6 (44) / 5 (87) | 0 / 0 | 0 | 0 |
| c.waterfront (houses on a wharf; check added during the work) | (34 at first measurement) | 0 | 0 | 0 |
| d.stranded (revetments, quays) | 3 phases (27 608 segment-years) | 0 | 0 | — |
| d.abutmentInWater | 1 (75) | 0 | 0 | — |
| d.streetSurfaceWet | 9 (639) | 0 | — | — |
| d.streetIntoRiver (streets.json lines) | 12 (1 129) | 12 (1 129) — explained | — | — |
| d.roadInRiver | 1 (36) | 1 (36) — explained | 0 | — |
| **e.craftOnLand** (hard) | 17 (147) | **0** | 0 | — |
| **e.movingInPier** (hard) | 3 (32) | **0** | 0 | — |
| **e.craftInStructure / OutOfDate** (hard) | 0 / 0 | 0 / 0 | 0 | — |
| f.smokeNoHouse | 400 (53 569) | 0 | 0 | 0 |
| f.walkerInBuilding / InLandmark | 456 (45 334) / 131 (12 304) | 0 / 0 | 0 | 0 |
| f.walkerInWater | 1 (13) | 17 (54) — explained | 0 | — |
| f.propInBuilding / InLandmark | 148 (16 289) / 3 (303) | 0 / 0 | 0 | 0 |
| g.treeSunk / Float | 243 (37 095) / 5 (580) | 0 / 0 | 0 | 0 |
| g.treeInBuilding / InLandmark / InWall | 23 (586) / 14 (772) / 1 (192) | 0 / 0 / 0 | 0 | 5 (40) → 0 |
| g.treeInStreet (roads and streets) | 31 (4 956) | 0 | 4 (148) → 0 | 17 (136) → 0 |
| **h.beforeDate / phaseOverlap / zoneLeftover** (hard) | 0 / 0 / 0 | 0 / 0 / 0 | 0 | 0 |
| h.landmarkOverlap | 3 (100) | 3 (112) — reported | 0 | 0 |
| i.labelOffObject / Underground | 11 (992) / 1 (1) | 0 / 0 | 3 (3) → 0 | 2 (2) → 0 |
| **hard total** | **85** | **0** | 0 → 0 | 0 → 0 |

London after the work: 12 649 house records (each building may be drawn as up to a few consecutive copies, one per
span of years on its own ground; 10 115 before), 132 landmark phases drawn as 452 copies (each phase keeps one scene
group; its copies are children of it, one shown at a time), 61 747 trees.

Cost: page ready at High 6.7 s (4.7–5.1 s with `?placement=legacy`) and a quality rebuild 3.8 s (2.0 s), measured on a
shared, busy machine. The life-span checks run at load; world-space copies are reported by a builder run that builds no
geometry and are built when first shown or a few milliseconds per idle frame (`LandmarkLayer.pump`, driven by a small
extra layer), so playback does not wait for them. Per-frame CPU while playing is unchanged (0.48 ms per year step against
0.44 ms legacy, all layers). Instances grow by about a quarter (span copies), but only copies standing in the year shown
are drawn at full size.

## Root causes and fixes

Each root cause below is one representative-year shortcut; each fix replaces it by the life span of the thing placed.

1. **Houses tested at one year, at their centre only** (`src/scene/fabric.ts`). Lattice houses were tested for dry
   ground at their zone's middle year and street houses at their birth year, centre and corners, but never again; a
   house was set on the ground of its birth year and stood unmoved for up to five centuries while reclamation raised
   the ground round it by up to 6 m (the terrain's land height is measured from the advancing bank). Fix: one settle
   pipeline for every house, using each model's real plan (built once per style / variant and cached):
   *dry* (centre ≥ 1.6 m, every corner ≥ 0.5 m when it appears, and for as long as it stands, `TerrainModel.firstBelow`);
   *clear* (blocked windows from landmark plans, castle wards, road / wall / stream / bridge corridors, the wharf strip
   of each waterfront copy and the dated streets of streets.json, over the house's whole life: it waits for them to go
   or is taken down before they come, `fitLife`); *alone* (earliest first, a house that would share ground with a
   standing one waits for it to go; this removes the medieval/Tudor double houses and the overview/district seam
   overlaps); *level* (`TerrainModel.groundSpans`: one copy per span of years over which the ground under its plan
   stays within the model's base depth; each copy set with no corner buried more than 0.8 m and no gap under the
   base). Houses in streets in the Saxon-to-medieval change of 1050, houses in the Tower's outer ward and houses on the
   Saxon bridge approach all went with *clear*.
2. **Landmark phases built once at `built + 3`** (`src/scene/landmarks.ts`). Quays, revetments, moored craft, roads,
   streams, walls and buildings were built on the ground of one year and shown for the whole phase: the waterfront of
   1063 stood 30 m inland by 1249, Roman barges lay on dry land by 249, the Walbrook and parts of Ermine Street were
   buried under the silted valley and raised bank. Fix: each phase is split by `groundSpans` (tolerance by kind:
   0.16 m streams, 0.2 m roads, 0.5 m quays and waterfronts, 1 m craft, 2 m walls, 1.2 m buildings) and built once per
   span on the ground of that span (craft on the driest ground of their span so they float all through it); copies
   share materials, and buildings share geometry. Buildings are levelled on their whole plan (never a gap under the
   base). Docks are set flush with the ground about them. Labels of linear landmarks (the city wall, quays) are anchored
   on the line, not the middle of the bounding box.
3. **Old London Bridge ending in the water** (`landmarks.ts`, `bridgeApproaches`). The bridge is on a fixed line but
   the bank it meets stood ~40 m further north in 1176–1350; a masonry approach (abutment carried on, with parapets)
   now joins each end to the bank of each span of years.
4. **The populace kept its own copy of the house lattice** (`src/scene/pop/world.ts`). Smoke, door figures, livestock
   and door props were generated from the zone lattice, so they stood where the fabric had no house (street-plot zones,
   houses dropped for wet ground or overlaps) and lattice "streets" ran through the district's street-plot houses.
   Fix: doors, smoke and figures come from `fabric.houses` (the single record of placed houses); district zones on the
   street network walk the dated streets of streets.json; landmark pieces (quays, wharves, bridges, the forum) are laid
   per span copy; every piece carries the years in which a house or landmark plan stands on it and is empty then; prop
   sites are kept off standing houses and landmark plans.
5. **Trees placed on the ground of 4000 BCE and only cleared by settlement zones** (`src/scene/vegetation.ts`,
   `veg/understorey.ts`). Fix: each tree is felled before a house, road, street, wall, wharf or landmark takes its spot
   (and not back while it stands), ends when the water reaches it, and is set on the ground of each span of its years;
   the understorey uses the ground of the year shown.
6. **Street surfaces draped at the middle year of each surface period** (`src/scene/street/surface.ts`). Fix: periods
   split into spans shared by all streets of a period (meshes still merge), draped per span, and only where the ground
   is dry for the whole span.
7. **Moving craft routed through bridge openings computed for one bridge** (`src/scene/pop/boats.ts`). While the Saxon
   bridge stood beside the rising stone bridge (1176–1209) a skiff's run through a timber gap crossed a stone pier.
   Fix: bridges standing close together are one crossing; a craft shoots an opening square to the bridge, chosen clear
   of every pier and starling (real starling extents, the chapel pier's fuller one) of every bridge standing that year.

Shared helpers (additive, `src/lib/terrain.ts`): `keyTimes`, `sampleTimes`, `groundRange`, `firstBelow`,
`groundSpans`. Instrumentation for the audit (no effect on drawing): `FabricLayer.houses` / `streetZones`,
`LandmarkLayer.solids` / `wharves` / `spans`, `BuildCtx.trace` (quay fronts, revetments, piers, openings, abutments,
craft), `trees.userData.items`, `river-craft.userData.layer`, street-surface `userData.t0/t1`. A comparison switch
`?placement=legacy` (`src/scene/placementMode.ts`) restores the old placement for before/after screenshots and audits.

## Data changes

None. Every defect found traced to placement code, not to a wrong date or position in the data. Two data/terrain
inconsistencies are reported under "Remaining known issues" instead of being patched.

## Remaining known issues

- **d.streetIntoRiver, 12 streets (soft).** The streets.json lines are drawn to the 1625 waterfront; in earlier years
  the bank stood further north (Fish Street Hill, Old Swan Lane, Ebbgate Lane, the Southwark alleys and St Olave's
  Street reach wet ground in 1050–1425). Nothing is drawn or walked there any more (surfaces, houses and walkers all
  test the ground of the year), so only the data line is inconsistent. For the data owner: the lanes to the river could
  be given dated southern ends (they were extended as the waterfront advanced).
- **d.roadInRiver, Roman Watling Street across a Southwark marsh channel in 53–559 (soft).** The ribbon is clamped
  0.4 m above the water and reads as a causeway, which is what the road was. Left as is.
- **b.houseSunk, 44 copies of three parish churches (London) and 9 houses on LIDAR slopes (Barnet) (soft).** Their
  plots are steeper than the model's base can hide; the rule chooses "cut into the slope" (uphill corner 1.3–1.8 m
  under ground in London, up to 2.25 m in Barnet) over a visible gap under the downhill side.
- **f.walkerInWater, 17 single sample points (soft).** The west end of the waterfront walk at the Fleet mouth runs one
  2.4 m lateral sample past the last revetment segment. Not visible at normal distances.
- **h.landmarkOverlap (soft, needs the landmark / data owners):**
  - *forum-first / forum, 100–121:* the second forum was built round the first; intended.
  - *westminster-abbey phase 3 (1376–, `l` 156 m, centred at lon −0.1273) and henry-vii-chapel (1503–, centred
    76 m east, `l` 32):* the abbey's model runs 78 m east of its anchor, 18 m into the chapel's 60–92 m. The abbey's
    156 m is the length *including* the Lady Chapel, so the two models double-count it. The church kind is symmetric
    about its anchor, so the fix needs either an east-end offset for the church builder (ecclesiastical workstream) or
    a phase-3 length of ~138 m with the west front kept (which needs a per-phase anchor). Not changed here.
  - *saxon-bridge phase 2 (1136–1209) and old-london-bridge (1176–):* their lines converge at the Southwark end, so the
    timber bridge kept in use during the 33-year build and the new stone bridge intersect there for 1177–1209. The
    data should put the old bridge's line a little upstream along its whole length (London Bridge owner / data), or
    end the old bridge's southern spans at the new bridge.
- **Docks (Queenhithe, Billingsgate) are fixed points while the bank advances past them.** The real inlets stayed
  open; the terrain model has no inlet, so from about 1150 the docks are hards inside the reclaimed frontage (now level
  with the ground rather than buried or standing on it). Carving the inlet belongs in the terrain model (owner of
  `terrain.ts` / `terrainMesh.ts`).
- **The stone bridge's deck (8 m above high water) meets the street at 2–3 m at both bridgeheads**, a step of about
  5 m, in every year including 1625 (pre-existing, not a moving-ground defect). A ramp on Fish Street Hill and Borough
  High Street, or a lower deck at the abutments, belongs in `district.ts` (London Bridge workstream).
- **Abandoned houses collapse in place over 25 years** (lattice zones with `declineBy: "abandonment"`): for decades a
  flattened roof lies on the ground (seen in 300 CE). A life-shader / zone-data matter, not placement.
- **The bridgehead is thinly built 1050–1130** (about 30 Saxon and 13–25 medieval houses in the district at 1100, the
  same with the old rules): lundenburh has few plots there and medieval-city fills from its centre outwards. Zone-data
  density, not placement.
- **Not measured:** grass and reeds on street surfaces and reeds on dry ground (camera-following texture; none seen in
  the walk), the understorey against houses and streets (it follows the settled trees), houses hugging the outside of
  the city wall (allowed: crossing it is measured and is zero), Stonehenge (its own team; see the final report).

## Tests

`npx tsc --noEmit` clean for these files; `npx vitest run` 289/289; `node tests/e2e.mjs` 154/155 (the one failure,
"picking did not move camera or year", passes in isolation twice: timing-sensitive on a loaded machine). An earlier full
run had flagged "scene-graph visibility matches lifecycle": the copies are now children of their phase's single group,
so the scene graph keeps one group per phase.

## Stonehenge (not edited; for its team)

`AUDIT_SITES=stonehenge node tests/placement-audit.mjs` (read-only): 3 labels under the surface (greater-cursus#0 1.6 m,
durrington-timber-ring#0 0.3 m, durrington-walls-henge#0 5.7 m). Its earthworks and megaliths are drawn in world space,
so they have no ground plan: houses (the Durrington houses) and trees are not kept out of rings, barrows, the cursus
or the avenue, and the audit cannot measure it (an axis-aligned approximation suggested about 116 houses and 630 trees
inside monument extents). Proposed: those builders report their plan through `BuildCtx.trace` (`{ kind: "plan", ... }`
polygon) and `LandmarkLayer` turns it into `solids`, which fabric, trees and walkers already respect.

## Screenshots

`docs/screenshots/audit/<case>-before.png` / `-after.png` (before = `?placement=legacy`), and the systematic walk in
`docs/screenshots/audit/walk/<year>-<view>.png` (60, 150, 300, 600, 900, 1100, 1233, 1400, 1550, 1616).

| Pair | Shows |
|---|---|
| `waterfront-1449-before/after` | the 1253 revetment stranded 30 m inland → revetment and wharf at the 1449 waterline |
| `roman-quay-barges-249-before/after` | Roman quay and warehouses inland, barges on grass → quay at the bank, barges afloat |
| `thames-street-1600-before/after` | parish church sunk to its roof in reclaimed ground → standing on the ground of its years |
| `walbrook-1239-before/after` | Walbrook buried under the silted valley (and a house through a church tower) → stream drawn, plots clear |
| `bridge-north-abutment-1215-before/after` | Old London Bridge ending 40 m out in the river → masonry approach to the 1215 bank |
| `tower-ward-1300-before/after` | a house and trees inside the Tower's wards → clear |
| `city-1533-before/after` | medieval and Tudor houses on the same plots at once → one at a time |
| `bridge-foot-1150-before/after` | houses on the Saxon bridge's Southwark approach → clear |
| `roman-roads-60-before/after` | a tree standing in Ermine Street → gone |
| `eastcheap-1300-before/after`, `londinium-smoke-56-before/after` | overview houses in Eastcheap; smoke and figures with no house |

Add to RUN.md's test list (owner): `node tests/placement-audit.mjs   # placement audit: everything where it belongs for each year (~2 min, needs the dev server; exit 1 on hard defects)`.

The walk (90 images) was inspected year by year; defects it showed that the audit did not then measure — the gap at
the bridge's north end, houses on wharves, the dock platform left standing on reclaimed ground — were added to the
audit or fixed, and the rest are listed above.

## Structural fixes (second pass, 2026-11-14)

The five defects left above for other owners ("Remaining known issues": the abbey and Henry VII's Chapel, the two
bridges, the docks, the bridge deck at the bridgeheads, the lanes to the river) are fixed at their causes. The audit
gained checks so they cannot come back unnoticed.

| # | Was | Cause | Now | Files |
|---|---|---|---|---|
| 1 | Westminster Abbey phase 3 (`l` 156 m) ran 18 m into Henry VII's Chapel; every longer phase of a church grew at both ends | the church body was always centred on the landmark point | `church` / `friary` models may pin one end: `eastEnd` / `westEnd` (m along the bearing from the point). The abbey's phases 2 and 3 share their east end (60 m east of the point, where the chapel begins), so the nave rebuilt from 1376 rises at the west; phase 3 is 124 m (the 156 m figure includes the 32 m chapel, which is its own landmark), crossing kept in place. Old St Paul's phases from 1087 share the west front, so the New Work extends east, and the crossing tower stays put (`crossingAt` 0.52 on the 179 m phases). Also pinned where the direction is documented: Temple Church (chancel added east of the round), Greyfriars (first church in the place of the great church's choir), Austin Friars 1600 (the nave kept is the west part), St Bartholomew 1543 (the choir kept). Landmark footprints follow the pinned plan. | `src/scene/detail/ecclesiastical.ts`, `src/scene/landmarks.ts`, `data/locations/london/landmarks.json`, `docs/MODEL-KINDS.md` |
| 2 | The timber bridge (1136–1209) and the rising stone bridge converged at Southwark and crossed 1177–1209 (and the timber line ran through the chapel pier and St Magnus) | the timber bridge's line was set almost on the stone bridge's | The timber bridge is drawn parallel to the stone bridge, about 33 m downstream (east) along its whole length, for both its phases; the reconstructed Saxon streets that meet its ends moved with it. Side: the timber bridge stayed in use just downstream while the stone bridge was built (Stow and Watson's LAMAS 50 paper, as summarised in `research/saxon-medieval.json`; a later tradition in Old and New London puts it further east still, from Botolph's wharf). Distance: not documented; 33 m is the least that clears the stone bridge's downstream starlings and chapel pier and lands east of St Magnus. Evidence class and confidence unchanged (attested-documentary / low); the uncertainty says all this. Watson, Brigham and Dyson 2001 (MoLAS Monograph 8) is not open access and was **not** checked: its line may differ. | `data/locations/london/landmarks.json`, `data/locations/london/streets.json` |
| 3 | Queenhithe and Billingsgate were level hards inside the reclaimed frontage (Billingsgate a platform in the river 990–1200) | the terrain model had no inlet | `site.river.inlets` (new, dated, additive): from the dock head water runs riverward through whatever bank each year has, down to a bed 1.2 m below high water, while the dock is open (Queenhithe 970–, Billingsgate 990–; head at the model's waterline of the opening year, width from the dock models, axis square to the modelled bank; evidence, confidence, uncertainty and sources on each). Heights everywhere come from the terrain, so houses, trees, street surfaces and walkers keep out of the water by the existing rules. The waterfront follows the bank either side and is cut at an open dock: one side is lined from the mouth to the head, the head (with water stairs), the other side back (`src/scene/waterline.ts`, shared by the builder and the wharf walkers). Moored craft find the river's edge on the ground with the inlets left out, so they lie off the frontage, not in a dock between its walls. The `dock` model (`inlet: true`) is the hard, sheds and hoist behind the head. Billingsgate's point moved 33 m north to its head; both docks' bearings follow the inlet. | `src/lib/terrain.ts`, `src/lib/types.ts`, `src/lib/data.ts` (validation), `src/scene/builders.ts` (`BuildCtx.land`, `inlets`), `src/scene/waterline.ts`, `src/scene/detail/secular.ts`, `src/scene/pop/world.ts`, `src/scene/vessels.ts`, `src/scene/landmarks.ts`, `src/scene/terrainMesh.ts` and `src/scene/ground/cover.ts` (cache keys), `data/locations/london/site.json`, `landmarks.json` |
| 4 | The stone bridge's deck (8 m) stood ~5 m above the street at both bridgeheads, in every year | no ramp | Each approach copy (one per span of years over which the bank moves less than 0.4 m) now carries the roadway on from the end of the abutment or approach down a ramp at 1 in 10, between ragstone retaining walls, cobbled, with parapets while it stands more than 1 m up, to where it meets the street. It turns along the street that meets that end (Fish Street Hill, Borough High Street; including a street whose dated end stops short of the bridge's line), and keeps houses off it for its years (a corridor). Ground along those streets is sampled for the spans. | `src/scene/district.ts` (`bridgeRamp`, `RAMP_GRADE`), `src/scene/landmarks.ts` (`bridgeApproaches`) |
| 5 | 12 streets.json lines ran onto ground that was river (or marsh) before c. 1425; only the draw time hid the wet part | each street had one line for all its years | `reach` in streets.json: dated stages, each with its own south (or east) end on the street's line, following the reclaimed waterfront / embanked marsh of the model (ground ≥ 0.45 m for every year of the stage, ~8 m steps). The loader makes one street record per stage, so plots, the house clearance, surfaces, walkers and the ramps see the street of the year. Evidence `conjectural` / confidence `low` and a note on each (the extension of the lanes is documented, the dates of each step are the model's). Billingsgate lane ends at the dock head in every year. | `data/locations/london/streets.json`, `src/scene/street/network.ts`, `docs/STREETS.md` |

### New audit checks (`tests/placement-audit.mjs`)

| Cat | Check | Hard? |
|---|---|---|
| h.buildingOverlap | two different landmark buildings on the same ground (> 4 m), unless one is built round the other (every corner of the smaller inside the larger: those stay soft in h.landmarkOverlap, e.g. the two forums) | hard |
| h.bridgeCrossing | two bridges standing in the same year on one line, or one passing through the other's piers / starlings / abutments | hard |
| d.deckStep | at each end of a standing stone bridge, the roadway (ramp end, or the deck at the abutment if there is no ramp) more than 0.6 m above or below the ground of the year | hard |
| h.extensionBothEnds | an extension phase of a church / friary that grows more than 2 m at both ends from the phase it extends (reported: the direction is undocumented for these) | soft |

`d.facing` no longer applies to a dock's lining (it faces the dock, across the slope to the river; `d.stranded` and
`d.inRiver` still test it). The year signature includes the inlets' open state.

### Results

`node tests/placement-audit.mjs` (all three sites, full output in `docs/screenshots/audit/structural-audit.txt`):
**hard defects 0** on London, Brentford and Barnet. London soft: b.houseSunk 44 (unchanged), d.roadInRiver 1
(unchanged), f.walkerInWater 17 (unchanged, Fleet mouth), h.landmarkOverlap 1 (the forums, intended),
h.extensionBothEnds 2 (Austin Friars 1354: 17 m each end; St Magnus 1250: 13 / 6 m; no source says which way they
grew). Gone: d.streetIntoRiver 12 → 0, the abbey / chapel and two-bridge overlaps 3 → 1 (forums only). Barnet soft:
b.houseSunk 9 (unchanged), h.extensionBothEnds 1 (Barnet church, 8 / 3 m, direction undocumented). Brentford: none.
London 12 593 house records (12 648 before: ramps, dated lanes and the docks take some plots), 440 landmark copies.

`npx vitest run`: 297 / 297 (8 new in `tests/unit/structural.test.ts`: inlet heights and dating, the dock lining's
water side, the London inlets tied to their docks, `reach` stages valid and on their lines, one street record per
stage, a church pinned by its east end growing west only, the abbey ending where the chapel begins).
`npx tsc --noEmit`: clean (an earlier run during the work showed two errors in `src/scene/photo/photoMode.ts`, another
workstream's file being edited at the time; gone on the final run).

### Screenshots (`docs/screenshots/audit/`, `node tests/audit-shots.mjs fixes before|after [ids]`)

"Before" is the build before this pass (no legacy switch reproduces these), "after" the build after it.

| Pair | Shows |
|---|---|
| `abbey-1520-before/after` | abbey nave running into Henry VII's Chapel → east end meeting the chapel's west end |
| `abbey-1450-before/after` | the new nave rising at both ends → rising at the west only |
| `st-pauls-1300-before/after` | the New Work rising at both ends → at the east end, crossing tower in place |
| `timber-bridge-1190-before/after`, `timber-bridge-1190-north-before/after` | the timber bridge on the stone bridge's line → 33 m downstream |
| `queenhithe-1300/1550-before/after`, `billingsgate-1350/1550-before/after` | level hards inland (Billingsgate's in the river early) → open, lined inlets with water in them |
| `bridge-ramp-north-1600`, `bridge-ramp-south-1600`, `bridge-ramp-north-1250` (before/after) | the deck ending in a wall above the street → ramps down to Fish Street Hill and Borough High Street |
| `bridge-ramp-north-1250-west-after`, `bridge-ramp-south-1400-west-after` | (after only) the ramps from the side |
| `lanes-1200-before/after` | lanes to the river: nothing was drawn on the wet part before either, so the pictures barely differ; the change is in the data and is measured by the audit |

### Still open after this pass

- **St Magnus and the stone bridge's north approach** (1250–1350): the approach (deck-level masonry, pre-existing)
  runs along the bridge's axis past the west end of St Magnus phase 2 (34 m) and touches it by a few metres; the new
  ramp turns away along Fish Street Hill but starts at that approach's end. The approach is world-space and not in
  the overlap check. Needs either St Magnus's plan or the approach turned to Fish Street Hill (London Bridge owner).
- **Ramp length.** At 1 in 10 the ramps are about 35–60 m long (the assumed 8 m deck, undocumented, is the cause);
  no walkers are generated on the approaches and ramps yet (`src/scene/pop/world.ts` walks the bridge only).
- **Dock plans are generic**: head line, width and axis are modelling choices (recorded in each inlet's
  uncertainty); no craft are moored inside the docks.
- **h.extensionBothEnds** (soft): Austin Friars 1354, St Magnus 1250, Barnet church: left centred because no source
  read says which way they were enlarged.
- The timber bridge's line rests on secondary statements; Watson, Brigham and Dyson 2001 should be checked.
