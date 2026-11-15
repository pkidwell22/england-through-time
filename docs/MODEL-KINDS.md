# Model kinds, fabric styles and site options

Reference for anyone writing `data/locations/<id>/*.json`. The code is the authority:
`src/scene/builders.ts`, `src/scene/district.ts`, `src/scene/houses.ts`, `src/lib/types.ts`.

Every landmark phase has a `model: { "kind": "...", ...params }`. All dimensions are metres. All
params are optional unless marked **required**; the default is given in brackets. Unknown params
are ignored (so notes such as `"placeholder": true` or `"represents": 40` are harmless). An unknown
`kind` is skipped with a console warning.

These are parametric stand-ins. They respect the footprint and height you give; the architectural
detail is generic. Say so in the landmark's `evidence`, `confidence` and `uncertainty`.

## How a landmark is placed

| Placement | Meaning |
|---|---|
| **Anchored** | Built at the landmark's `lat`/`lon`, on the ground there, turned so its long axis (`l`) points along `bearing` (degrees clockwise from north, default 90 = east–west). Generic houses keep clear of it. |
| **Path** | Drawn along the landmark's `path` (`[[lat, lon], ...]`, at least two points). `bearing` is ignored. The new kinds below also accept a `path` inside the model, which wins over the landmark's. |
| **Ring** | Drawn inside a closed outline: the landmark's `path`, or `path` in the model, or `"polygon": "<name>"` naming an entry in `site.polygons`. At least three points; do not repeat the first point. |

Path and ring kinds, and `troops`, `camp`/`tents`, are authored in world space: every piece sits on
the modelled ground wherever it falls.

## Dating

Ordinary kinds follow the phase rules in `src/lib/types.ts`: `from` (building starts), `built`
(complete; default `from`, so construction takes that one year), `to` (the year it is taken down;
`null` = still standing at the end), `end`, `goneBy`, `continues`.

**Extension phases** (added 2026-11-14, docs/CORRECTIONS.md). `continues: true` on its own means the
phase takes over the standing structure at once, with no construction. `continues: true` together
with a `built` year later than `from` means an *extension*: an existing structure altered or extended
over a campaign (Westminster Abbey's nave 1376–1517, Westminster Hall's roof 1393–c.1399, Greyfriars
1306–27, Old St Paul's New Work 1251–1314, St Mary Overie's tower 1520–28). The extension is drawn
under construction from `from` to the end of `built`, and the previous phase, which must end by
`"handover"` in the year the extension starts, stays standing until the same moment, then hands over
with no gap. The validator rejects an extension whose previous phase does not end by handover. The
loader links the pair (`linkExtensions` in `src/lib/lifecycle.ts`); nothing extra is written in the JSON.
Because the new model grows inside the old one, an extension model should share the old model's
footprint wherever the fabric was kept.

**Staged kinds** (`troops`, `zone-marker`, `tents`, `camp`) are different. They are not built or
taken down: they are simply present, complete, from the start of `from` until the start of `to`.
A single year can be written either way: `"from": 1471, "to": 1472` or `"from": 1471, "to": 1471`
both show them throughout 1471 and at no other time. `built`, `end` and `continues` are ignored.

## Existing kinds

### Buildings (anchored)

| Kind | Params |
|---|---|
| `church` | `l` [30], `w` [12], `h` [9] wall height; `wall` [ragstone], `roof` [tile] (`"lead"` gives a low pitch); `aisles` (bool: nave + lean-to aisles, buttresses); `tower` `{ w, h, at?: "crossing", pinnacles? }` (default position: west end); `spire` (height of a lead spire on the tower); `transept` `{ l, w }`; `crossingAt` [0.62] position of crossing along the length, 0..1; `round` (diameter of a round nave at the west end); `pinnacles` (bool, along the eaves). `eastEnd` / `westEnd` (m along the bearing from the landmark point, + towards the bearing, to the east / west end of the body; default: centred): phases of one church that pin the same end grow the way the church did (a nave rebuilt westwards, a choir extended east). |
| `friary` | A `church` with aisles, plus a cloister on the south side. Church params as above (`l` [60], `w` [20], `h` [14]); `cloister` [30] side of the cloister square; `fleche` (height of a small lead spirelet). |
| `courtyard` | Four ranges round a court. `l` [50], `w` [40], `h` [9], `range` [8] depth of each range; `wall` [ragstone], `roof` [tile]; `double` (bool: a cross range making two courts); `towers` (0–4 corner towers); `tower` `{ w, h }` (gate tower on one long side); `greatHall` (bool); `arcade` (bool). |
| `keep` | `w` [30], `d` [30], `h` [25]; `wall` [ragstone]; `turrets` (bool: four corner turrets, one round). |
| `hall` | `l` [30], `w` [10], `h` [8]; `wall` [ragstone], `roof` [tile], `pitch` [0.85]; `classical` (bool: flat-roofed, pilastered); `endTowers` (bool); `apse` (bool). Use for barns, manor houses, halls. |
| `playhouse` | Polygonal timber playhouse. `d` [28] diameter, `h` [10], `sides` [20], `roof` [thatch]. |
| `forum` | Roman forum with basilica. `l` [100], `w` [100], `h` [8], `range` [12], `basilica` `{ w, h }` [30, 18]. |
| `amphitheatre` | `l` [100], `w` [85], `h` [8], `wall` [timber]. |
| `dock` | Timber-revetted hard with a shed and crane. `l` [40], `w` [30]. With `inlet: true` the dock is an open inlet (site.river.inlets, carved in the terrain) and the landmark point is the centre of its head: the model is then the hard, sheds and hoist behind the head (local -x; +x runs to the river), and the waterfront lines the inlet's sides and head as the frontage either side is reclaimed. |

### Linear features (path)

| Kind | Params |
|---|---|
| `wall` | `h` [6], `thick` [2.4], `wall` [ragstone] material; `crenel` (bool); `towers` (spacing in metres between round towers; 0 = none); `weathered` (bool: ragged top); `gates` `[[lat, lon, "name"], ...]` (a gatehouse at the nearest point of the wall). `closed` is not read: repeat the first point to close a circuit. |
| `bridge` | Timber trestle bridge between the first and last path points. `width` [6], `deck` [5] height of the deck, `span` [12] trestle spacing. `deck` is measured from the water (y = 0); on a site with no river, or with `"datum": "ground"`, it is measured from the higher bank (use this for a small bridge over a stream on high ground). |
| `road` | Gravel ribbon laid on the ground. `width` [8]. Each road lies a few centimetres higher or lower than the next so that roads meeting at a fork do not flicker. |
| `stream` | Water ribbon laid on the ground (it does not cut a channel; give the valley in `site.terrain.valleys`). `width` [6]. The ribbon stops where it meets open river water. |
| `quay` | Roman timber quay; each stretch is walked south from the path to the water's edge. `width` [10], `warehouses` (bool). River sites only. |
| `waterfront` | Revetted river frontage that finds the waterline from the path. `wall` [timber-weathered], `side` [1] (+1 = the river lies south of the path, −1 = north), `top` [1.9] height of the wharf, `cranes` (bool). River sites only. |
| `boats` | Craft scattered on the water between the path's end points; none are placed on land. `count` [20], `spread` [90] metres either side of the line, `ships` [0.2] fraction of larger vessels, `style` (`"longship"`). Positions are illustrative. River sites only. |

### London Bridge district kinds

These stand on a stone bridge and take their line from it: by default the first landmark with a
`stone-bridge` phase, or name one with `"on": "<landmark id>"`.

| Kind | Params |
|---|---|
| `stone-bridge` (path) | `width` [6.1], `deck` [8], `arches` [19]. The pier layout is the London one (chapel pier, drawbridge opening). |
| `bridge-houses` | `deck` [8], `storeys` [3], `style` (`"tudor"`). |
| `bridge-chapel` | `h` [14], `style` (`"early"`, `"house"`). |
| `bridge-gate` | `h` [16], `w` [11], `pier` (pier index from the north). `heads` is not read. |
| `nonsuch` | `h` [17], `w` [15], `d` [9]. |
| `waterwheel` | `d` [6]. |

## New kinds for staging battles honestly

### `troops` (anchored at `lat`/`lon`, world space, staged)

A formation block of abstract figures centred on the anchor.

| Param | Meaning |
|---|---|
| `count` [100] | Number of figures **drawn** (not the number of men). Capped at 2,500 per block. |
| `cols` [about √(3·count)] | Files across the front. Ranks = count ÷ cols, the last rank centred. |
| `spacing` [1.3, mounted 2.6] | Metres between files. A 15th-century line was dense: about 1–1.5 m per file. |
| `rankSpacing` [= `spacing`, 1.5× for riders] | Metres between ranks. |
| `faction` ["a"] | `"a"` (muted rust) or `"b"` (muted slate teal): two arbitrary tints chosen to be told apart at a distance and to match no side's livery. Any other name gets its own stable colour; `"#rrggbb"` is used as given. A tint only. |
| `facing` [the landmark's `bearing`] | Compass bearing the block faces. |
| `banner` [false] | Plain cloths in a lighter shade of the tint on 5.6 m poles along the second rank (about one per 200 figures, at most 10). No devices. |
| `mounted` [false] | Riders (2.4 m) instead of foot figures (1.7 m). |

Figures are a tapered body with square shoulders and a block head in a darker shade of the tint
(nothing specific: hood, helmet or hair), a little bolder than life so a close-packed block reads as
a mass: no faces, weapons, armour or heraldry. Opaque `flat:` tints carry a little self-light so the
colour survives shade, dawn light and distance (a legibility device, not a dye). A faint trampled,
shadowed strip of ground is laid under each block. Positions have a small fixed jitter, the same on
every load. Thousands of figures are cheap (they are stamped into one mesh per material), but keep
to the 2,500 cap and check the frame time. **These are always conjectural stand-ins**: the
validator reports any `troops` landmark whose `evidence` is not `"conjectural"`, and the info
panel adds a "Stand-in, not a record" badge. Put what the block is based on in `summary` and what
is unknown (numbers, exact ground, frontage) in `uncertainty`.

### `zone-marker` (ring, staged)

A flat translucent polygon laid over the ground with a firmer outline, for "possibly somewhere in
this area". It is an overlay, not a surveyed boundary.

| Param | Meaning |
|---|---|
| `path` or `polygon` | The ring (see Placement). Falls back to the landmark's `path`. |
| `color` ["#e0b040"] | `#rgb`, `#rrggbb` or a CSS colour name. |
| `opacity` [0.3] | 0.05–0.9. |
| `label` | Text for the floating label, instead of the landmark's name. (Any kind may use `label`.) |
| `outline` [1.6] | Width of the outline in metres. |

### `tents` and `camp` (anchored, world space, staged)

Two names for the same thing: ridge tents and fires scattered round the anchor.

| Param | Meaning |
|---|---|
| `count` [8] | Tents (max 200). |
| `fires` [2] | Camp fires (max 40): a ring of ash, logs and a small flame; no light or smoke. |
| `radius` [12 + 7·√count] | Radius of the scatter. |
| `color` ["#cdc2a6"] | Cloth colour. |

Numbers and layout are illustrative.

### `hedge` (path)

A hedge following the path over the ground. Generic houses keep clear of it.

| Param | Meaning |
|---|---|
| `h` [2] | Height of the hedge. |
| `width` [1.8] | Thickness. |
| `bank` [none] | `true` for a 0.8 m earth bank under the hedge, or a height in metres. With `"h": 0` you get a bare bank. |
| `gaps` [0.03] | Fraction of 3 m lengths left open (0–0.9). |

### `field-strips` (ring)

Ridge-and-furrow striping: thin darker lines for the furrows, laid on the ground inside the ring.
The spacing is generic, not surveyed.

| Param | Meaning |
|---|---|
| `path` or `polygon` | The ring. Falls back to the landmark's `path`. |
| `bearing` [the landmark's `bearing`] | Compass bearing the strips run along. |
| `pitch` [9] | Metres from furrow to furrow (minimum 3). |
| `color` ["#5a5230"], `opacity` [0.5] | The furrow lines. |

### `ford` (path)

A shallow crossing along the path (draw it from bank to bank). Over open water it is not a causeway:
a broad band of paler, shallower water, broken gravel bars just breaking the surface along the wading
line (gaps between them) and white riffles either side where the stream runs over the bar. On the
banks, and across a `stream` ribbon, it is a plain trodden gravel track on top of the ground.

| Param | Meaning |
|---|---|
| `width` [8] | Width of the crossing. |
| `stakes` [false] | Timber stakes in the water along one side. |

## Materials

Names accepted by `wall` / `roof` params: `ragstone`, `roman-rubble`, `caen`, `ashlar`, `brick`,
`timber`, `timber-weathered`, `frame` (also `frame-ochre`, `frame-grey`, `frame-rose`,
`frame-dark`), `daub`, `plaster`, `whitewash`, `thatch`, `thatch-old`, `tile`, `tile-old`,
`tile-bright`, `tegula`, `lead`, `shingle`, `slate`, `earth`, `gravel`, `cobble`. An unknown name
renders as plaster.

## Fabric styles for zones (`zones.json`, `style`)

Generic instanced buildings; no single one is a real building. `footprint` is the clear space each
needs, so `spacing` should not be much smaller.

| Style | What is drawn | Footprint |
|---|---|---|
| `roundhouse` | Thatched round house | 10 |
| `roman-timber` | Timber strip building, narrow end to the street | 15 |
| `roman-masonry` | Tiled masonry house with wings | 20 |
| `saxon` | Thatched timber hall | 12 |
| `medieval` | Pair of timber-framed houses, tile or thatch | 13 |
| `tudor` | Pair of taller framed houses with chimneys | 13 |
| `parish-church` | Small church with a west tower | 26 |
| `mansion` | Large house with wings | 55 |
| `scrub` | Bushes (and sometimes a stump of wall): rough ground, heath, abandonment | 10 |

`grow` may lie before the timeline's start; it is honoured as written. A zone that simply exists
when the window opens, with no known beginning, should say `"preexisting": true` (keep `grow` at the
start year): its growth is then moved well before the window, so nothing rises and no tree is
cleared in the first years, and no founding date has to be invented.

Zones never place anything on water or foreshore. `scrub` and `roundhouse` zones do not tint the
ground as built-up or clear trees.

## Site options (`site.json`)

Typed and commented in `src/lib/types.ts` (`Site`, `SiteRiver`, `SiteTerrain`, `SiteAtmosphere`).

Required: `id`, `name`, `subtitle`, `scopeNote`, `origin { lat, lon }`, `bounds { xMin, xMax, zMin,
zMax }` (local metres: x east, z **south** of the origin), `timeline { start, end }`, `terrain`.

| Field | Meaning |
|---|---|
| `timeline.scale` | `[{ year, u }, ...]`, u from 0 to 1, first year = `start`, last = `end`. Omitted = linear. |
| `timeline.initialYear` | Year shown on arrival. Default: the last era's `presetYear`. |
| `river` | Omit for a site with no river. `centreline` rows are `[lat, lon, leftHalfWidth, rightHalfWidth, reclaimWeight]` in flow order; `widthScale` multiplies every half-width; `northBankSetback` and `southEmbankment` keyframes are optional (default: no setback; right bank left as open marsh, so give `[{ "year": <start>, "value": 1 }]` for firm ground on both banks). |
| `terrain.hills`, `terrain.valleys` | As London. On a river site hills only raise the left bank. Both optional. |
| `terrain.eyots` | `{ name, lat, lon, height, sigma }`. By default (London) an eyot is an island in the right-bank marsh and has no effect in the river or on the left bank. Add `"shoal": true` for a gravel shoal that applies anywhere: mid-channel, on the foreshore or on either bank. It raises whatever is there towards a crest `height` metres above the water (keep it under about 0.75 m for a bare shoal that trees will not grow on); it never lowers the ground. `stretch` [1] draws it long along `bearing` [90] (`sigma` is then the half-width scale across it). |
| `terrain.base` | No-river sites: height of the plain ground above the scene datum [20]. A local datum, not Ordnance Datum. |
| `terrain.slope` | No-river sites: `{ bearing, gradient }`. The ground **rises** towards `bearing`; `gradient` is metres per metre (0.02 = 1 in 50). |
| `polygons`, `woodland`, `district`, `views` | All optional. No `district` = the badge reads "Schematic site". No `views` = one view of the whole site. `woodland.hedgerowTrees: false` removes the sparse illustrative field-edge trees. |
| `atmosphere.fog` | FogExp2 density [0.00014]. |
| `atmosphere.fogColor` | CSS colour [sampled from the sky's horizon]. |
| `atmosphere.sunElevation`, `sunAzimuth` | Degrees above the horizon [the sky photograph's own, about 31]; degrees clockwise from north [232]. Below 12° the site is at dawn or dusk: the photographed sky (a midday sky with its own high sun) is not used; the analytic sky follows the low sun, the sunlight is warmed and the sky fill is raised so shadow sides do not go black. Long shadows follow from the low sun. |
| `atmosphere.exposure` | Tone-mapping exposure [0.72]. |
| `atmosphere.mist` | `{ from, to, density, height?, base?, color? }`: ground mist for the years `from`..`to` inclusive, drawn as a height fog. Below `base` (a height in the scene datum; default the median ground height of the site) it has its full `density` per metre (0.004 ≈ 250 m to fade to a third); above `base` it thins with a scale height of `height`/3 [40/3], so it is mostly gone `height` metres up. From inside, shapes fade within a few hundred metres; from high above, the ground under the camera stays readable while the distance and low ground fill in (from far overhead the layer is also let thin a little, so overview labels stay usable). Set `base` to the ground the event happened on. How thick the real mist was is not known: the mist shown is a rendering choice. |
| `water.color` | CSS colour of the river [#55665a]. |

On a site without a river the ground never drops below 2 m, no water is drawn, and camera `views`
should give positions and targets in the same datum as `terrain.base` (a target at y = 0 is under
the ground and will be lifted onto it).

Optional files: `eras.json` (default: one era spanning the timeline), `events.json`,
`episodes.json`, `landmarks.json`, `zones.json` (default: empty), `sources.json` (merged over
`data/sources.json`). Only `site.json` is required.

## Checking a dataset

- `validateDataset` (run on load; problems are printed to the browser console) checks years,
  phase order, source ids, polygon names, the timeline scale, paths for path and ring kinds, and
  that `troops` are marked conjectural.
- In the browser console, `await window.__lttOpen({ site, landmarks, zones, ... })` previews parsed
  files without registering a location and resolves to the validator's list of problems.
