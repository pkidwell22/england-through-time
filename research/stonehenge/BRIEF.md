# Stonehenge site: shared team brief

Every agent on the Stonehenge build reads this first. The lead integrates and reviews.

## The project

`P` = this folder (the path contains spaces: always quote it). A Next.js 15 + Three.js 0.180
data-driven 3D historical timelapse, 4000 BCE – 1625 CE. A national relief map lets the user descend
into detailed sites rendered by a generic engine (`src/scene`, `src/lib`) from JSON in
`data/locations/<id>/`. Existing sites: `london` (rich), `brentford`, `barnet` (small, no river:
the closest worked example). We are adding `stonehenge`: Stonehenge and its World Heritage landscape.

The owner wants it **historically honest** (every feature dated, with evidence class, confidence,
"not known" notes and source links; conjecture labelled) and **as close to photorealism as
possible**, without ever claiming photorealism it has not earned.

Read for orientation: `README.md`, `docs/MODEL-KINDS.md` (data schema reference),
`src/lib/types.ts` (types are the contract), `data/locations/barnet/*` (worked example).

## Hard rules (everyone)

- Other agents are working in this folder RIGHT NOW. A dev server runs at http://127.0.0.1:4310.
  **Do not start, stop or restart servers, do not run `next build`, do not kill processes you did not start.**
- **Only edit the files your brief assigns you.** Never edit `src/scene/builders.ts`, `engine.ts`,
  `landmarks.ts`, `materials.ts`, `houses.ts`, `fabric.ts`, `src/lib/*`, `data/sources.json`,
  `data/national/*`, `data/assets.json`, `README.md`, `docs/RECORD.md`, or other sites' data.
  Shared exported registries (`BUILDERS`, `WORLD_SPACE_KINDS`, `FLAT_KINDS`, `CORRIDOR_KINDS` in
  builders.ts; `STYLES` in houses.ts) may be *mutated at runtime* from your own file's register function.
- Never touch `~/Rome` or anything outside `P`. Scratch files: under your own subfolder of
  `research/stonehenge/` or the OS temp dir; never in `src/` or `data/` beyond your assignment.
- Researchers: **cite only URLs you actually fetched and read**. Separate attested from inferred.
  If a site refuses automated fetching, say so and use another source; do not cite from memory.
- Keep `npx tsc --noEmit` passing for any TypeScript you write. Do not run the full browser suites
  (`tests/e2e.mjs`, `tests/sites-e2e.mjs`); the lead runs those.
- No asset downloads (textures, models, images for use in the app). Reading open research pages,
  papers and open data APIs is fine.

## Conventions

- **Years**: signed integers, no year 0: −2500 = 2500 BCE, 1620 = 1620 CE.
- **Local coordinates**: metres; **x = east, z = SOUTH** of the site origin, y = up.
  Site origin = centre of the sarsen circle (lat 51.17888, lon −1.82619 provisional; the geography
  researcher will confirm/correct it with a source). 1° lat ≈ 111 195 m; 1° lon ≈ 69 750 m here.
- **Azimuth / bearing**: degrees clockwise from TRUE north (0 = N, 90 = E, 180 = S).
- **Heights**: local datum. `terrain.base` (≈ the ground height at the stones on that datum) is
  set in site.json; the datum is "metres above Ordnance Datum minus an offset" stated in site.json.
- **Evidence** enum: `attested-standing | attested-excavated | attested-documentary |
  attested-pictorial | reconstructed | conjectural`. **Confidence**: `high | medium | low`.
- Sources live in `data/locations/stonehenge/sources.json` as
  `{ "sto-<slug>": { "title", "publisher", "url" } }`. Ids always prefixed `sto-`.

## Site extent (provisional)

Bounds x −2700…3500, z −2800…2200 (≈ 6.2 × 5 km): the stones west-centre; Durrington Walls
(≈ x 2750, z −1500), Woodhenge, the River Avon and Amesbury (≈ x 3000–3300) to the east; the
Greater Cursus (z ≈ −900) to the north; Normanton Down (z ≈ +700) to the south. Benchmark
`district` (detailed) = x −400…400, z −350…300 around the stones.

## Terrain (no river)

No-river terrain = `terrain.base` + `terrain.slope` + gaussian `hills` − gaussian `valleys`
(each valley is a polyline with `depth` and `sigma`, optional `fill` keyframes 0..1 by year that
silt it up) + ±0.6 m micro-relief. The terrain mesh cannot have holes, so **ditches are carved
as narrow `valleys` in site.json** (e.g. the Stonehenge ditch as a closed 64-point polygon
valley, sigma ≈ 2 m, depth ≈ 1.5 m, `fill` rising as it silts). Models then drape linings and
build banks on top of the ground. The Avon is a valley plus a `stream` landmark ribbon.

## New model kinds (code in NEW files only)

`src/scene/prehistoric.ts` (lead) calls `registerMegalithBuilders()` from `src/scene/megaliths.ts`
and `registerEarthworkBuilders()` from `src/scene/earthworks.ts`. Both are wired into the
engine already. Builder API: `src/scene/geom.ts` (`Builder`: `box`, `cyl`, `cone`, `extrude`,
`add(mat, geometry, matrix)`; UVs are in texture repeats = metres / `tileOf(mat)` from
`materials.ts`). `BuildCtx` in `builders.ts` gives `ground(x, z)` (world), `x`, `z` (anchor),
`project(lat, lon)`, `polygon(name)`, `bearing`, `seed`, `path`.

Scanned material names available (CC0 Poly Haven, in `data/assets.json`): `sarsen` (grey
weathered), `sarsen-lichen` (grey-green with yellow lichen), `sarsen-fresh` (freshly dressed,
pale), `bluestone` (blue-grey spotted), `altar` (greenish-grey sandstone), `chalk` (white chalk
rubble), `turf` (short downland grass), `turf-sparse`, plus existing `timber`, `timber-weathered`,
`daub`, `thatch`, `thatch-old`, `earth`, `gravel`, and untextured `flat:#rrggbb[:opacity]`.

### megaliths.ts (kind `megaliths`, world-space; kind `sightline`)

`megaliths` model params:
- `stones`: array of StoneSpec (below). Positions are relative to the landmark anchor
  (lat/lon of the landmark = centre of the sarsen circle for the main settings).
- `rings`: array of parametric rings for settings known only as a pattern (e.g. bluestones in
  the Aubrey Holes, the Q/R double arc): `{ "type": "bluestone", "r": 11.6, "count": 60,
  "from": 0, "to": 360, "w": [0.6, 1.1], "t": [0.4, 0.7], "h": [1.4, 2.3], "jitter": 0.3,
  "skip": [], "state": "standing", "seed": 7 }` (ranges are min/max; deterministic).
- `surface`: `"weathered"` (default) or `"fresh"` (newly dressed sarsen, paler).
- `levelTop` (optional): height of the lintel-ring underside above the anchor ground.

StoneSpec:
```
{ "id": "56", "type": "sarsen" | "bluestone" | "altar",
  "role": "upright" | "lintel" | "outlier" | "slab",
  "az": 220.1, "r": 4.2,            // polar from the anchor (az clockwise from north)  OR  "x", "z" metres (z south)
  "w": 2.4, "t": 1.2, "h": 7.3,     // width (tangential), thickness (radial), height above ground (lintels: vertical depth)
  "face": 40,                       // optional: azimuth the broad face looks toward (default: toward the anchor)
  "state": "standing" | "leaning" | "fallen" | "broken" | "stump" | "buried",
  "lean": 12, "leanToward": 40,     // leaning
  "fallToward": 220, "pieces": 2,   // fallen / broken: lies with its base at its socket, toward fallToward
  "on": ["29", "30"],               // lintel: ids of the uprights (in this same model) it rests on
  "curved": true,                   // lintel follows the circle's curvature
  "dressed": true, "tenons": true, "note": "free text, ignored" }
```

`sightline` model: `{ "kind": "sightline", "az": 49.9, "length": 1800, "el": 0.5, "sun": true }`:
a thin line on the ground from the anchor along azimuth `az`, and a sun disc on the horizon at
elevation `el` degrees. An analytical overlay for the solstice episodes, not a structure.

### stones.json (data catalogue, single source of truth)

`data/locations/stonehenge/stones.json` lists every numbered stone (Petrie numbering) with set,
type, role, position, size and its state in 1625. Landmark phases that draw megaliths name a
catalogue selection: `"model": { "kind": "megaliths", "catalogue": { "sets": ["sarsen-circle",
"sarsen-lintels"], "state": "built" | "1625" } }`. `scripts/stonehenge/sync-stones.mjs`
(written by the megalith builder) copies the matching StoneSpecs into the phase's `stones` array
so the browser needs only landmarks.json; a unit test checks they are in sync. To correct the
arrangement: edit stones.json, run `node scripts/stonehenge/sync-stones.mjs`.

stones.json entry:
```
{ "id": "56", "set": "great-trilithon" , "type": "sarsen", "role": "upright",
  "az": .., "r": .., "w": .., "t": .., "h": .., "face": .., "on": [..], "curved": ..,
  "built": "standing",                         // state when the setting was complete (usually standing; "absent" if the stone never existed / is hypothetical-only)
  "hypothetical": false,                       // true if its existence is inferred (e.g. a stonehole only)
  "state1625": "standing" | "leaning" | "fallen" | "broken" | "stump" | "buried" | "missing",
  "fallToward": .., "pieces": .., "lean": .., "leanToward": ..,
  "evidence1625": "how we know its 1625 state (e.g. fell 1797, so standing in 1625; shown fallen on Stukeley's plan 1724, date of fall unknown)",
  "notes": "...", "sources": ["sto-..."] }
```
Sets: `sarsen-circle`, `sarsen-lintels`, `trilithons` (uprights 51–60 and lintels 152, 154,
156, 158, 160), `bluestone-circle` (31–49), `bluestone-horseshoe` (61–72), `altar` (80),
`station` (91–94), `slaughter` (95), `heel` (96), plus `heel-companion` (stonehole 97) if used.

### earthworks.ts

Kinds (all world-space; see the earthwork builder's brief for params): `henge` (ring ditch +
bank + counterscarp, entrances, chalk/turf surface), `pit-ring` (Aubrey Holes etc.),
`timber-circle` (concentric post rings), `palisade`, `banked-avenue` (Avenue, cursus: parallel
banks with external ditches along a path, optional closed terminals), `barrow` (bowl, bell,
disc, saucer, pond), `barrow-group` (a cemetery as one landmark), `long-barrow`, `rampart`
(hillfort bank and ditch round a ring), `turf` (drape a ring with a material). Fabric style
`neolithic-house` (Durrington Walls houses: small, square, chalk-plaster floor, wattle walls).

## Dating guidance

Lifecycle per phase: `from` (start), `built` (complete), `to` (end; null = still there in 1625),
`end` (`handover` = instant swap to next phase, `replaced`, `demolished`, `ruin`, `decay` with
`goneBy`), `continues` (takes over the previous phase's structure without a construction
animation). Phases of one landmark must not overlap. Construction animates as the model rising
from the ground between `from` and `built`. Use `dateNote` for stage ranges and modelled dates.
