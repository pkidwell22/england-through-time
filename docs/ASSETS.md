# Scanned model library (Poly Haven, CC0)

Photoreal 3D models from [Poly Haven](https://polyhaven.com/models), all **CC0 1.0**
(<https://polyhaven.com/license>), reduced to browser LODs that other workstreams can instance without
knowing anything about glTF. Nothing in the app uses them yet: adopting them is up to each workstream
(vegetation, ground, populace, district). If the files are missing, every loader rejects cleanly and the
procedural versions stay.

Files
- `data/models.json` – manifest: id, category, variant count, period of plausibility, confidence, plausibility note, budgets; plus the list of **excluded** Poly Haven models and why.
- `scripts/fetch-models.py` – downloads each asset's glTF with 1k textures (and the separate opacity map Poly Haven leaves out of its glTF) from `api.polyhaven.com` / `dl.polyhaven.org` only, into `public/assets/models/_src/<id>/`; records every file's URL, licence, size and md5 in `public/assets/models/sources.json`; prints a size report.
- `scripts/optimize-models.mjs` – builds the LODs into `public/assets/models/<id>/` (`model.json`, `geo.bin`, `*.webp`) and `public/assets/models/index.json`.
- `scripts/bake-models.mjs` – renders the leaf-cluster atlases and impostor textures in headless Chrome via `public/assets/models/bake.html` (needs the dev server).
- `scripts/bake-octa.mjs` – renders the hemi-octahedral impostors of the four broadleaf tree scans (`octa_c.webp`, `octa_n.webp`, `octa.json` in each model folder) via `public/assets/models/bake-octa.html` (needs the dev server). Used by the vegetation (docs/VEGETATION.md); no new downloads.
- `src/scene/assets/models.ts` – runtime API.
- `public/assets/models/preview.html` + `viewer.js` + `vendor/three.*.min.js` (a vendored copy of three r180, MIT, for the static pages only) – contact sheets.
- `tests/assets-demo.mjs` – offline geometry/budget report + contact sheets into `docs/screenshots/assets/`.
- `tests/unit/models.test.ts` – manifest validity, file presence, budgets.

## What was downloaded

**50 assets, 112 variants**: 6 trees, 5 shrubs, 5 groundcover, 2 grasses, 6 deadwood, 8 rocks, 16 props,
2 vessels. Downloaded 743.6 MB of glTF + 1k textures; after optimisation and `--prune 40` (the five big
tree scans, 568 MB) `public/assets/models/` holds **259 MB**: optimised files the browser loads 36 MB,
remaining raw scans 169 MB, bake inputs (`_bake/`) 54 MB. Contact sheets: `docs/screenshots/assets/`
(`trees.png`, `plants.png`, `plant-variants.png`, `deadwood-rocks.png`, `props.png`, `vessels.png`).

| id | what it is | cat | var | source (CC0) | raw MB | opt. MB | LOD triangles | period | conf. | plausibility |
|---|---|---|---|---|---|---|---|---|---|---|
| `island_tree_01` | Gnarled broadleaf (coastal) | tree | 1 | [polyhaven.com/a/island_tree_01](https://polyhaven.com/a/island_tree_01) | 66.4 | 2.3 | 11999 / 2499 / 4 | 4000 BCE–1625 | low | Species not stated by Poly Haven: a wind-sculpted coastal broadleaf with a gnarled trunk and small leaves. Not an oak or beech; at mid/far range it reads as a generic hedgerow or wood-edge tree (hawthorn, field maple, crab apple). Use as a stand-in only; keep away from close-up camera positions. |
| `island_tree_02` | Small twisted broadleaf | tree | 1 | [polyhaven.com/a/island_tree_02](https://polyhaven.com/a/island_tree_02) | 46.2 | 2.2 | 12000 / 2499 / 4 | 4000 BCE–1625 | low | Species not stated; small twisted trunk with a spreading dense canopy. Reads as an old hawthorn or pollard at distance. Stand-in, not a named British species. |
| `island_tree_03` | Low windswept broadleaf | tree | 1 | [polyhaven.com/a/island_tree_03](https://polyhaven.com/a/island_tree_03) | 84.9 | 2.1 | 11997 / 2500 / 4 | 4000 BCE–1625 | low | Species not stated; low windswept multi-trunk tree on exposed roots. Reads as scrub (blackthorn/hawthorn thicket) or a coppice stool at distance. Stand-in only. |
| `tree_small_02` | Slender young broadleaf | tree | 1 | [polyhaven.com/a/tree_small_02](https://polyhaven.com/a/tree_small_02) | 101.2 | 2.2 | 11999 / 2500 / 4 | 4000 BCE–1625 | low | FLAGGED: Poly Haven tags it Burkea africana (an African savanna tree), not a British species. Kept as a slender-trunk, airy-canopy form that reads like a young birch or rowan at mid/far range. Do not use for close-ups; prefer the procedural trees where species matters. |
| `pine_sapling_small` | Pine sapling | tree | 3 | [polyhaven.com/a/pine_sapling_small](https://polyhaven.com/a/pine_sapling_small) | 22.1 | 2.3 | 6000 / 1500 / 4 | 4000 BCE–1625 | medium | Pine of unstated species; form fits Scots pine (Pinus sylvestris, native). Use SPARINGLY: Scots pine was largely gone from lowland southern England after the mid-Holocene and was replanted mostly after 1625; plausible on prehistoric heath and sandy commons only. |
| `pine_sapling_medium` | Young pine | tree | 3 | [polyhaven.com/a/pine_sapling_medium](https://polyhaven.com/a/pine_sapling_medium) | 268.2 | 3.7 | 12000 / 2500 / 4 | 4000 BCE–1625 | medium | As pine_sapling_small: reads as a young Scots pine. Sparingly, prehistoric heathland only; not a London street or Thames-side tree in the historic periods. |
| `shrub_02` | Leafy sapling shrub | shrub | 4 | [polyhaven.com/a/shrub_02](https://polyhaven.com/a/shrub_02) | 2.1 | 0.4 | 800 / 4 | 4000 BCE–1625 | low | Generic low shrub with narrow lanceolate leaves; reads like a willow or sallow sapling clump at range. Species not stated. |
| `shrub_03` | Meadow herb with seed spikes | shrub | 4 | [polyhaven.com/a/shrub_03](https://polyhaven.com/a/shrub_03) | 1.7 | 0.4 | 800 / 4 | 4000 BCE–1625 | low | Generic meadow herb (paired oval leaves, upright seed spikes) that reads like a plantain or dock in a field margin. Species not stated. |
| `shrub_04` | Glossy-leaved shrub sprigs | shrub | 1 | [polyhaven.com/a/shrub_04](https://polyhaven.com/a/shrub_04) | 2.0 | 0.2 | 701 / 4 | 4000 BCE–1625 | low | Glossy-leaved woody sprigs; reads as privet, box or young holly undergrowth. Species not stated. |
| `fern_02` | Fern clumps | shrub | 4 | [polyhaven.com/a/fern_02](https://polyhaven.com/a/fern_02) | 1.3 | 0.4 | 800 / 4 | 4000 BCE–1625 | medium | Four fern clumps with serrated fronds; reads as male fern / lady fern (native woodland ferns). Good for wood floors and shaded banks. |
| `nettle_plant` | Stinging nettle | shrub | 6 | [polyhaven.com/a/nettle_plant](https://polyhaven.com/a/nettle_plant) | 2.7 | 0.7 | 800 / 4 | 4000 BCE–1625 | high | Stinging nettle (Urtica dioica), native and abundant on nitrogen-rich ground: middens, settlement edges, ditches. Excellent around any settlement in every period. |
| `weed_plant_02` | Low weed clusters | groundcover | 5 | [polyhaven.com/a/weed_plant_02](https://polyhaven.com/a/weed_plant_02) | 2.2 | 0.3 | 800 / 4 | 4000 BCE–1625 | low | Small glossy weeds with reddish stems (reads as knotgrass/dock seedlings on disturbed ground). Species not stated; fine as trampled-verge filler. |
| `shrub_sorrel_01` | Sorrel clumps | groundcover | 6 | [polyhaven.com/a/shrub_sorrel_01](https://polyhaven.com/a/shrub_sorrel_01) | 1.3 | 0.3 | 799 / 4 | 4000 BCE–1625 | low | FLAGGED: Oxalis with pink flowers, probably not native wood sorrel (Oxalis acetosella has white, lilac-veined flowers). Use sparingly in shade; flowers are small enough to pass at range. |
| `dandelion_01` | Dandelion rosettes | groundcover | 5 | [polyhaven.com/a/dandelion_01](https://polyhaven.com/a/dandelion_01) | 3.2 | 0.3 | 800 / 4 | 4000 BCE–1625 | high | Dandelion (Taraxacum officinale agg.), native; grassland, verges, trampled ground. Spring flowering. |
| `celandine_01` | Lesser celandine | groundcover | 5 | [polyhaven.com/a/celandine_01](https://polyhaven.com/a/celandine_01) | 1.8 | 0.3 | 800 / 4 | 4000 BCE–1625 | high | Lesser celandine (Ficaria verna), native; damp woodland floors, hedge banks, stream sides. Flowers Feb–May. |
| `moss_01` | Moss clump | groundcover | 6 | [polyhaven.com/a/moss_01](https://polyhaven.com/a/moss_01) | 1.0 | 0.2 | 24 / 4 | 4000 BCE–1625 | high | Generic woodland moss clump; universal on damp stone, roots, thatch edges and north faces. |
| `grass_medium_01` | Grass tuft (green) | grass | 6 | [polyhaven.com/a/grass_medium_01](https://polyhaven.com/a/grass_medium_01) | 3.7 | 0.5 | 800 / 4 | 4000 BCE–1625 | high | Medium meadow grass tuft; generic temperate grassland, native-looking. |
| `grass_medium_02` | Grass tuft (green-brown) | grass | 5 | [polyhaven.com/a/grass_medium_02](https://polyhaven.com/a/grass_medium_02) | 0.9 | 0.3 | 800 / 4 | 4000 BCE–1625 | high | Medium grass tuft with brown strands; pasture, verge, grazed downland (Stonehenge, battlefields). |
| `dead_tree_trunk` | Fallen log | deadwood | 1 | [polyhaven.com/a/dead_tree_trunk](https://polyhaven.com/a/dead_tree_trunk) | 4.8 | 0.6 | 1499 / 397 / 40 | 4000 BCE–1625 | high | Long weathered log with moss; species-neutral deadwood. Woods, field edges, timber yards. |
| `dead_tree_trunk_02` | Dead trunk with stub | deadwood | 1 | [polyhaven.com/a/dead_tree_trunk_02](https://polyhaven.com/a/dead_tree_trunk_02) | 4.9 | 0.8 | 1498 / 398 / 40 | 4000 BCE–1625 | high | Decayed dry trunk with lichen and broken stub; species-neutral. |
| `tree_stump_01` | Tree stump with roots | deadwood | 1 | [polyhaven.com/a/tree_stump_01](https://polyhaven.com/a/tree_stump_01) | 3.9 | 0.8 | 1495 / 399 / 39 | 4000 BCE–1625 | high | Decayed stump with exposed roots; species-neutral. Ideal for cleared woodland (Neolithic clearance onward) and felled timber. |
| `tree_stump_02` | Mossy tree stump | deadwood | 1 | [polyhaven.com/a/tree_stump_02](https://polyhaven.com/a/tree_stump_02) | 4.5 | 0.9 | 1495 / 400 / 39 | 4000 BCE–1625 | high | Mossy stump with roots and leaf litter; species-neutral. |
| `dry_branches_medium_01` | Dry branches | deadwood | 3 | [polyhaven.com/a/dry_branches_medium_01](https://polyhaven.com/a/dry_branches_medium_01) | 3.3 | 0.9 | 1500 / 400 / 40 | 4000 BCE–1625 | high | Scanned dry branches; brushwood, kindling piles, hedge laying, wattle stock. |
| `root_cluster_01` | Root cluster | deadwood | 1 | [polyhaven.com/a/root_cluster_01](https://polyhaven.com/a/root_cluster_01) | 9.5 | 0.8 | 1498 / 397 / 40 | 4000 BCE–1625 | high | Tangled exposed roots with forest-floor litter; eroded banks, river edges, holloways. |
| `boulder_01` | Weathered boulder | rock | 1 | [polyhaven.com/a/boulder_01](https://polyhaven.com/a/boulder_01) | 5.8 | 0.8 | 1451 / 395 / 37 | 4000 BCE–1625 | medium | Jagged lichen-covered boulder with rusty streaks. Generic field boulder; too angular for a sarsen but usable as a glacial erratic or quarry stone. |
| `rock_07` | Rock (earth tones) | rock | 1 | [polyhaven.com/a/rock_07](https://polyhaven.com/a/rock_07) | 2.2 | 0.4 | 1500 / 399 / 39 | 4000 BCE–1625 | medium | Small erosion-worn rock; generic fieldstone. |
| `rock_09` | Small rock (rust-brown) | rock | 1 | [polyhaven.com/a/rock_09](https://polyhaven.com/a/rock_09) | 2.0 | 0.4 | 1500 / 400 / 40 | 4000 BCE–1625 | medium | Small rust-brown stone; ironstone-like, plausible in Weald / Thames gravels. |
| `stone_01` | Quartz pebble stone | rock | 1 | [polyhaven.com/a/stone_01](https://polyhaven.com/a/stone_01) | 3.7 | 0.6 | 1500 / 400 / 40 | 4000 BCE–1625 | medium | Reddish quartzy stone; reads as a Thames-gravel cobble or field clearance stone. |
| `rock_moss_set_01` | Mossy rocks set A | rock | 6 | [polyhaven.com/a/rock_moss_set_01](https://polyhaven.com/a/rock_moss_set_01) | 1.9 | 0.6 | 1500 / 400 / 40 | 4000 BCE–1625 | high | Six mossy woodland stones; generic, useful as rubble, field clearance cairns, stream stones. |
| `rock_moss_set_02` | Mossy rocks set B | rock | 7 | [polyhaven.com/a/rock_moss_set_02](https://polyhaven.com/a/rock_moss_set_02) | 1.9 | 0.7 | 1500 / 400 / 40 | 4000 BCE–1625 | high | Moss-covered stones set; generic. |
| `namaqualand_boulder_02` | Sandstone boulders | rock | 1 | [polyhaven.com/a/namaqualand_boulder_02](https://polyhaven.com/a/namaqualand_boulder_02) | 5.1 | 0.8 | 1500 / 396 / 39 | 4000 BCE–1625 | medium | Weathered Karoo sandstone (South Africa). Closest Poly Haven surface to a sarsen (a silcrete sandstone): rounded, layered, pitted. Tint towards grey (#b8b4a8) for Wiltshire sarsens / Marlborough Downs 'grey wethers'. |
| `namaqualand_boulder_05` | Sandstone boulder (rounded) | rock | 1 | [polyhaven.com/a/namaqualand_boulder_05](https://polyhaven.com/a/namaqualand_boulder_05) | 4.7 | 0.7 | 1500 / 400 / 40 | 4000 BCE–1625 | medium | As namaqualand_boulder_02; rounded sandstone boulder usable as an unworked sarsen on the downs. Tint grey. |
| `wine_barrel_01` | Oak cask (iron hoops) | prop | 1 | [polyhaven.com/a/wine_barrel_01](https://polyhaven.com/a/wine_barrel_01) | 0.9 | 0.1 | 1499 / 400 / 39 | 1–1625 | medium | Oak stave cask with iron hoops and bung. Coopered casks arrive with the Romans; before c.1600 most were bound with split hazel/willow hoops, so iron hoops are a late-period look. Fine for wharves and inns 1400–1625. |
| `wooden_barrels_01` | Barrels and loose staves | prop | 1 | [polyhaven.com/a/wooden_barrels_01](https://polyhaven.com/a/wooden_barrels_01) | 7.5 | 0.4 | 1494 / 389 / 38 | 1–1625 | medium | Group of weathered casks with loose staves; same hoop caveat as wine_barrel_01. Wharf and cooperage dressing. |
| `wooden_bucket_01` | Wooden bucket with bail | prop | 1 | [polyhaven.com/a/wooden_bucket_01](https://polyhaven.com/a/wooden_bucket_01) | 2.3 | 0.2 | 1499 / 400 / 38 | 1–1625 | medium | Stave bucket with metal bands and iron bail handle; medieval buckets are well attested (often withy-bound). |
| `wooden_bucket_02` | Wide wooden tub | prop | 1 | [polyhaven.com/a/wooden_bucket_02](https://polyhaven.com/a/wooden_bucket_02) | 2.5 | 0.2 | 1500 / 398 / 39 | 1–1625 | medium | Wide coopered tub with two handles; washing/brewing tub. Same hoop caveat. |
| `wooden_crate_01` | Sea chest with rope handles | prop | 1 | [polyhaven.com/a/wooden_crate_01](https://polyhaven.com/a/wooden_crate_01) | 2.3 | 0.2 | 1500 / 400 / 39 | 1500–1625 | low | FLAGGED late: plank chest with rope handles, rivets and latch, a 16th–17th c. seaman's chest look. Tudor/Jacobean wharves only. |
| `treasure_chest` | Iron-bound chest | prop | 1 | [polyhaven.com/a/treasure_chest](https://polyhaven.com/a/treasure_chest) | 5.5 | 0.2 | 1498 / 395 / 37 | 1100–1625 | medium | Wooden chest with iron straps and rivets; iron-bound coffers and parish chests are medieval. Avoid the open/gold staging, use closed. |
| `wooden_bowl_01` | Carved wooden bowl | prop | 1 | [polyhaven.com/a/wooden_bowl_01](https://polyhaven.com/a/wooden_bowl_01) | 1.8 | 0.1 | 1500 / 400 / 40 | 4000 BCE–1625 | high | Hand-carved bowl; wooden treen bowls are the commonest medieval tableware and known from prehistory. |
| `wooden_bowl_02` | Turned wooden bowl (burr) | prop | 1 | [polyhaven.com/a/wooden_bowl_02](https://polyhaven.com/a/wooden_bowl_02) | 2.5 | 0.2 | 1500 / 400 / 38 | 500 BCE–1625 | high | Small turned burr-wood bowl; lathe-turned treen from the Iron Age onward. |
| `ceramic_pot` | Lidded glazed jar | prop | 1 | [polyhaven.com/a/ceramic_pot](https://polyhaven.com/a/ceramic_pot) | 1.6 | 0.1 | 1500 / 400 / 39 | 1100–1625 | medium | Hand-thrown lidded jar with twin handles and aged beige glaze; reads as medieval/post-medieval glazed earthenware storage jar. |
| `wooden_stool_01` | Turned-leg stool | prop | 1 | [polyhaven.com/a/wooden_stool_01](https://polyhaven.com/a/wooden_stool_01) | 1.0 | 0.2 | 1499 / 399 / 40 | 1100–1625 | medium | Round-seated stool with turned legs; turned stools are attested in medieval and Tudor households. |
| `wooden_stool_02` | Rustic footstool | prop | 1 | [polyhaven.com/a/wooden_stool_02](https://polyhaven.com/a/wooden_stool_02) | 2.7 | 0.2 | 1499 / 400 / 40 | 4000 BCE–1625 | high | Crude handmade stool with tool marks; any period. |
| `wooden_table_02` | Plain plank table | prop | 1 | [polyhaven.com/a/wooden_table_02](https://polyhaven.com/a/wooden_table_02) | 0.5 | 0.1 | 196 / 196 / 40 | 1–1625 | medium | Simple four-legged plank table; varnish sheen is slightly modern, otherwise period-neutral. |
| `stone_fire_pit` | Stone hearth ring | prop | 1 | [polyhaven.com/a/stone_fire_pit](https://polyhaven.com/a/stone_fire_pit) | 2.5 | 0.2 | 1500 / 400 / 38 | 4000 BCE–1625 | high | Ring of soot-darkened boulders; an open hearth plausible in any period (camps, middens, outdoor cooking). |
| `kite_shield` | Kite shield | prop | 1 | [polyhaven.com/a/kite_shield](https://polyhaven.com/a/kite_shield) | 3.8 | 0.3 | 1498 / 398 / 39 | 1050–1250 | medium | Painted wooden kite shield with iron rim; Norman-era form (Bayeux Tapestry). 11th–13th c. only. |
| `wooden_axe` | Wood axe | prop | 1 | [polyhaven.com/a/wooden_axe](https://polyhaven.com/a/wooden_axe) | 2.0 | 0.1 | 1500 / 399 / 40 | 500 BCE–1625 | medium | Iron felling axe on a wooden haft; the metal butt cap is a modern touch invisible beyond a few metres. |
| `large_castle_door` | Arched iron-strapped door | prop | 1 | [polyhaven.com/a/large_castle_door](https://polyhaven.com/a/large_castle_door) | 3.3 | 0.3 | 1500 / 386 / 36 | 1100–1625 | medium | Arched double door with iron straps, ring handles and small grilles; medieval gatehouse / church / hall door. |
| `dutch_ship_medium` | Dutch merchant ship | vessel | 1 | [polyhaven.com/a/dutch_ship_medium](https://polyhaven.com/a/dutch_ship_medium) | 8.7 | 1.5 | 7969 / 1990 / 194 | 1590–1625 | low | FLAGGED late: a 17th-c. Dutch sailing ship. Plausible in the Pool of London only c.1590–1625; not a medieval cog or hulk. Too big for the props budget, hence its own category. |
| `ship_pinnace` | Pinnace | vessel | 1 | [polyhaven.com/a/ship_pinnace](https://polyhaven.com/a/ship_pinnace) | 21.1 | 2.7 | 7955 / 1975 / 193 | 1570–1625 | low | FLAGGED late: a small late-16th/17th-c. pinnace with rigging and sails. Thames estuary / Pool of London c.1570–1625 only. |

Triangles are per LOD (max over variants): trees `LOD0 / LOD1 / LOD2`, plants `LOD0 / impostor`,
others `LOD0 / LOD1 / LOD2`. "raw" is the downloaded glTF + textures (largest scans pruned after
optimisation, see below), "opt." the optimised files the browser loads. Every file's URL and size is in
`public/assets/models/sources.json`.

### Plausibility, in short

- **No oak, beech, lime, ash, birch, hawthorn, willow, alder or hazel exists on Poly Haven.** The only
  broadleaf trees are three unnamed coastal "island" trees and *Burkea africana* (`tree_small_02`). They
  are kept as low-confidence stand-ins that read as generic hedgerow/scrub broadleaves at mid and far
  range. Do not put them where species matters or close to the camera.
- Pines (`pine_sapling_*`) read as Scots pine; use sparingly, prehistoric heath only.
- Plants: nettle, dandelion, lesser celandine, ferns, moss and the two grasses are good native matches.
  The shrubs and the weed clusters are unnamed generic forms (low confidence); the sorrel is a
  pink-flowered *Oxalis*, flagged.
- Rocks and deadwood are species/geology-neutral. The two Namaqualand sandstone boulders are the closest
  surface to a sarsen (tint them grey); none is a true sarsen.
- Props: casks, buckets and tubs have iron hoops (rarer before c.1600; most medieval casks used withy
  hoops); `wooden_crate_01` is a 16th–17th c. sea chest; `kite_shield` is 1050–1250 only. The two ships
  are late-16th/17th c. and only fit the Pool of London c.1570–1625.

### Excluded as anachronistic or unsuitable

Firs (`fir_tree_01`, `fir_sapling*`: *Abies*, introduced c.1603), `jacaranda_tree`, all Namaqualand flora
(quiver trees, *Searsia*, *Othonna*, *Didelta*, `flower_*`, ice plants, rooibos), tropical
houseplants, `shrub_01` (Mexican *Ageratina*), `periwinkle_plant` (pink, Madagascar-periwinkle look),
`grass_bermuda_01`; metal/plastic drums (`Barrel_01/02`, `barrel_03`), printed sacks and crates
(`cement_bag`, `compost_bags`, `CheeseBox_01`), `wooden_crate_02` (brass corners), step-ladders
(`wooden_ladder*`), `hatchet` (rubber grip), `spinning_wheel_01` (Victorian), `wicker_basket_02`,
`planter_pot_clay`, `wooden_lantern_01` (glazed), painted farmhouse furniture, transfer-printed ceramics,
`brass_pot_01`, `wooden_cutting_board`. Too big: `pine_tree_01` (17.4M triangles, 958 MB at 1k), the
coast/cliff scans (1–3M triangles each). Tried and dropped: `wicker_basket_01` (weave does not survive 1.5k triangles). Deferred: `modular_wooden_pier`, `cannon_01`. Full reasons are in
`data/models.json` → `excluded`.

## How the LODs are made

| category | LOD0 | LOD1 | LOD2 |
|---|---|---|---|
| tree | bark/branches simplified (meshoptimizer) + leaf-cluster cards, ≤ 12k tris (pine sapling ≤ 6k) | same with fewer, larger cards, ≤ 2.5k | crossed-billboard impostor, 4 tris |
| shrub / groundcover / grass | leaf geometry simplified to ≤ 800 tris (alpha-tested cards where the scan uses cards) | impostor, 4 tris | – |
| deadwood / rock / prop | simplified mesh ≤ 1.5k | ≤ 400 | ≤ 40 |
| vessel | ≤ 8k | ≤ 2k | ≤ 200 |

- **Simplification**: meshoptimizer `simplifyWithAttributes` (normals + UV weighted). Where seams or
  split-vertex scans lock the topology, vertices are welded by position (texture may stretch along old
  seams), then vertex clustering rebuilds connectivity and meshoptimizer finishes. Parts (materials)
  share the budget by surface area; parts too small for the coarse LODs are dropped.
- **Tree foliage**: Poly Haven trees model every leaf/needle as geometry (0.3–2M triangles). The leaf
  triangles are binned into a grid whose cell size is searched so the number of occupied cells equals the
  card budget; each cell becomes one alpha-tested quad of the cell's size facing out of the crown, with
  soft "crown" normals. Card texture: four real clusters of leaves rendered orthographically from the
  scan into a 2×2 atlas (`leaf0_c.webp`, `leaf1_c.webp`), so leaves appear at their true size and shape.
- **Impostors**: LOD0 rendered unlit from the front and the side into `imp<variant>_c.webp` (albedo,
  alpha) and `imp<variant>_n.webp` (view-space normals). On the two crossed quads the normal image is a
  tangent-space normal map, so impostors respond to the sun like the mesh LODs. The four broadleaf trees also have a
  hemi-octahedral impostor (12 x 12 views over the upper hemisphere, colour 1536 px and normal + crown occlusion 768 px,
  about 0.7-0.9 MB per tree), which the vegetation uses instead of the crossed quads.
- **Textures**: 1k for trees/shrubs/rocks/deadwood/vessels, 512 for props, grass and groundcover; WebP.
  Poly Haven's glTF export omits the opacity maps of leaf/frond cards; fetch-models.py downloads the
  separate `Alpha` map and the optimiser merges it into the colour texture's alpha.
- **Variants**: scan sets (6 grass tufts, 4 ferns, 6 mossy rocks …) become separate variants of one id,
  each recentred on its own origin.

## Re-fetch and re-optimise

```bash
python3 scripts/fetch-models.py               # download missing files (skips existing), size report
node --max-old-space-size=14000 scripts/optimize-models.mjs   # all, ~5 min (pine_sapling_medium is 6M tris)
node scripts/bake-models.mjs                  # needs the dev server on :4310 (does not start it)
node tests/assets-demo.mjs                    # report + contact sheets
npx vitest run tests/unit/models.test.ts
python3 scripts/fetch-models.py --prune 20    # optional: delete raw scans > 20 MB once optimised
```
Single assets: pass ids, e.g. `node scripts/optimize-models.mjs fern_02 && node scripts/bake-models.mjs fern_02`.
Add an asset by adding an entry to `data/models.json` (id = Poly Haven slug, category, `variants` for scan
sets, period, confidence, plausibility) and running the four commands. After `--prune`, re-optimising a
pruned asset re-downloads it.

## Runtime API (`src/scene/assets/models.ts`)

```ts
listModels(category?)                 // ModelInfo[] from data/models.json (sync)
modelsForYear(year, category?, minConfidence?)  // filtered by period (historical years)
availableModels(): Promise<Set<string>>         // ids actually present (index.json); empty if not fetched
loadModel(id, variant = 0): Promise<ModelAsset> // rejects ModelUnavailableError if files are missing
tryLoadModel(id, variant?): Promise<ModelAsset | null>
loadModelVariants(id): Promise<ModelAsset[]>
lifeMaterials(asset): ModelAsset      // life-patched material clones + matching (alpha-tested) depth materials
lifeAlphaDepthMaterial(map, alphaTest)  // depth material with the life vertex patch, alpha-tested
class ModelInstances                  // instanced placement with CPU LOD selection + GPU life window
makeLodObject(asset): THREE.LOD       // one-off placements (a ship, a door)
```

`ModelAsset` = `{ id, name, category, variant, lods: { parts: { geometry, material, depthMaterial?, kind, triangles }[], triangles, maxDistance }[], height, width, depth, bounds, radius, plausibility, period, confidence }`.
Each part is one `THREE.InstancedMesh` (geometry + material); a tree LOD has 2–3 parts, an impostor 1.
Sizes are real metres at scale 1. `maxDistance` is the suggested switch distance for that LOD at scale 1
(the last one is a cull distance).

### (a) Instanced trees with a life window and LOD switching

```ts
import { tryLoadModel, ModelInstances } from "@/scene/assets/models";
import { histToT } from "@/lib/years";

const tree = await tryLoadModel("island_tree_02");
if (tree) {
  const trees = new ModelInstances(tree, 2000, { life: true, distanceScale: quality === "low" ? 0.6 : 1 });
  for (const t of placements) {
    // life = (appear start, appear end, vanish start, vanish end) in timeline values, like fabric.ts
    trees.place(t.x, t.y, t.z, t.rot, t.height / tree.height,
      [histToT(t.planted), histToT(t.planted) + 15, histToT(t.felled), histToT(t.felled) + 1]);
  }
  root.add(trees.object);
  onFrame(() => trees.update(camera));   // re-buckets LODs only when the camera moved > 2 m
} // else: keep the procedural trees
```
The materials are `patchLife` clones (from `src/scene/life.ts`) and every mesh gets the matching depth
material (alpha-tested for leaf cards), so instances grow, vanish and cast shadows with the year driven
by `lifeUniforms.uYear`, exactly like `fabric.ts`. `aFx` (burn, evidence tint) is the optional 7th
argument of `place`/`add`.

### (b) Scattering props or plants

```ts
const variants = await loadModelVariants("grass_medium_02").catch(() => []);
const sets = variants.map((v) => new ModelInstances(v, 4000, { life: false, castShadow: false }));
for (const p of scatterPoints) sets[p.k % sets.length].place(p.x, p.y, p.z, p.rot, 0.8 + 0.4 * p.r);
sets.forEach((s) => scene.add(s.object));
// per frame: sets.forEach((s) => s.update(camera));

const cask = await tryLoadModel("wine_barrel_01");
if (cask) { const casks = new ModelInstances(cask, 64); casks.place(x, y, z, rot); wharf.add(casks.object); }
```
For something placed once, `makeLodObject(asset)` returns a `THREE.LOD`. Use `modelsForYear(year, "prop")`
to choose only period-plausible props.

Performance notes: a LOD0 tree is ~12k triangles, so keep LOD0 to the nearest few dozen trees
(`distanceScale`); impostors are 4 triangles and alpha-tested (overdraw, not triangles, is their cost).
`ModelInstances.update` is O(instances) when the camera moves; split very large scatters into
spatial chunks.

## Not available on Poly Haven (the project would want these)

- **Native British broadleaf trees** of any named species: oak, beech, ash, lime, birch, hawthorn,
  willow, alder, hazel, elm, field maple, yew, holly (and no bare winter trees, pollards or coppice).
- **Hedges**, brambles, gorse, heather, reeds/rushes, bulrushes, bracken as such, crops (wheat, barley),
  wildflower meadow mixes specific to Britain.
- **People** of any period, **animals** (cattle, sheep, pigs, horses, dogs, deer), birds.
- **Boats** before c.1570: log boats, Roman/Saxon/medieval river craft, cogs, wherries, Thames barges.
- **Buildings and structures**: roundhouses, timber-framed houses, thatched roofs, wattle hurdles and
  fences, palisades, granaries, wells, carts and wagons, wagon wheels, ploughs, querns.
- **Period objects**: sacks, rope coils, pottery (Neolithic/Bronze/Iron Age/Roman/medieval forms),
  ladders without metal hardware, trestle tables, benches, looms, market stalls, weapons other than a
  kite shield and an axe.
- **Megaliths**: no sarsen or bluestone scans; only generic boulders.

## Open problems

- The broadleaf trees are stand-ins (unnamed coastal trees and an African species); their cards and
  impostors are honest renders of those scans, not of oaks. Treat as placeholders until a CC0 source of
  British species exists.
- LOD0 trees at 12k triangles are still heavy for forests: budget for LOD0 within ~40 m only.
- Normal maps of simplified rocks/props are the high-poly scan's maps applied to the low-poly mesh (no
  re-bake from high to low), so silhouettes are coarser than the shading suggests at LOD1/LOD2.
- The crossed-quad impostors (plants; trees only as a fallback) are two views; at 45° the crossing is visible, and
  they do not rotate with the sun (albedo is unlit, lighting comes from the baked normals only). The trees' octahedral
  impostors have no depth: no parallax inside the crown.
- Leaf cards use soft crown normals; backfaces are lit as flipped normals (three's DoubleSide), which
  darkens the far side of a crown slightly.
- Plants at 800 triangles: whole-plant scans whose leaves are fused to the stems (`shrub_04`) lose most
  leaves; nettle, fern, dandelion, celandine and the grasses survive well. Impostors of plants are a little
  darker than the meshes.
- Vessels: the rigging and upper masts break up at 8k/2k triangles; hulls and sails hold. LOD2 of props
  (≤ 40 triangles) is a rough block, only for > 150 m. Casks show small gaps between staves at LOD0/1.
- `wicker_basket_01` was dropped (weave collapses to a rim at 1.5k); props with fine strands need a
  higher budget or a baked normal map on a simple shell.
- `meshoptimizer` (via @types/three) and `sharp` (via next) are used as transitive dependencies; if
  either disappears from node_modules, add it as a devDependency.

## Credits that must be shown

- Terrain (Stonehenge, Barnet, upland Brentford): Contains Environment Agency information © Environment Agency and/or database right 2026. Licensed under the Open Government Licence v3.0.
- Mask outlines used to prepare that terrain: Feature outlines © OpenStreetMap contributors (ODbL 1.0). No OpenStreetMap data is drawn.
- Materials, skies and models: Poly Haven, CC0 (no credit required; listed in `data/assets.json` and `data/models.json`).
- National map sources (Copernicus GLO-90, GEBCO_2025, Itiner-e, ONS) are recorded in `data/national/sources-terrain.json` and `data/national/terrain.json`, and credited in the interface (`src/components/ui/Chrome.tsx`).
