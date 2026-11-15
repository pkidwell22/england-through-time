# Vegetation

Code: `src/scene/vegetation.ts` (placement, dating, roles, LOD buckets), `src/scene/veg/` (`procedural.ts`, `scanned.ts`,
`impostor.ts`, `understorey.ts`, `types.ts`, `leafAtlas.ts`). Contract with the engine: `buildTrees(ds, terrain, fabric, density)`
returns a group with `userData.count` and `userData.update(t)`; `userData.debug()` reports source, instances and triangles;
`userData.forceLevel(l | null)` draws every tree at one detail level (for comparing levels).

## Honesty

- **The tree models are generic stand-ins, not identified British species.** Poly Haven (the only approved source) has no
  oak, ash, lime, elm, alder, willow, hazel or birch; its catalogue was checked again on 2026-11-14 and nothing new fits. The
  species names in the code (oak, lime, elm, ash, hazel, alder, willow, scrub) are *roles*: which British tree a spot stands
  for in the period's mix, with that role's size range, crown tint, and wet or dry ground. Each role is drawn with one of
  four scans (table below), so an "oak" and an "ash" differ in size, tint and, where they map to different scans, crown
  shape, not in botanical form. No leaf, bark or silhouette is that of the named tree.
- Tree positions, per-tree dates, sizes, the filler trees, the role mix and the understorey are illustrative. Only the
  woodland-cover trend in `data/locations/*/site.json` is sourced, and it is itself marked illustrative there.
- Not photorealism: see "What still looks fake".

## Sources of tree meshes

1. **Procedural card trees** (`procedural.ts`): built first, so the scene never waits. Used for good on Low quality and when
   the model files are missing or fail to load.
2. **Scanned stand-ins** (`scanned.ts`), loaded asynchronously on Medium and High, then swapped in (CPU buckets rebuilt):

| model (CC0, Poly Haven) | what it really is | roles here | scale / resulting height |
|---|---|---|---|
| `island_tree_01` | unnamed gnarled coastal broadleaf, 5.0 m | oak; lime and elm (second shape) | max x4.9 (to ~24 m) |
| `island_tree_02` | unnamed small twisted broadleaf, 3.4 m | oak (twice the weight of 01), willow | max x5.0; willow 8-13 m |
| `tree_small_02` | *Burkea africana* (African savanna tree), 4.6 m | lime, elm, ash (slender, airy), alder (darker tint) | max x4.7 |
| `island_tree_03` | low windswept multi-trunk broadleaf, 2.6 m | hazel, thorn scrub, hedgerow shrubs 3-8 m | max x3.6 |

   Scans are stretched 22 % vertically (slimmer trunks). Levels: LOD0 (12k triangles) within ~44 m (High) / 21 m (Medium),
   LOD1 (2.5k) to ~150 / 84 m, then the octahedral impostor (below). Distances scale with tree size.

## Roles by period and ground (`speciesFor` in vegetation.ts)

Broad pollen picture for lowland southern England, applied per spot by the year the tree first stands; illustrative:

- before c. 1200 BCE (the wildwood and the first clearances): lime-rich mixed woodland, lime 34 %, oak 34 %, ash, hazel 10 %,
  elm 10 % before the elm decline (c. 3800 BCE) and 4 % after;
- later woods: oak 43 %, ash 23 %, elm 10 %, hazel 12 %, lime 12 %;
- sub-canopy fillers: hazel about a third, the rest lime/oak/ash (early) or oak/ash/lime (later);
- hedgerow trees: oak, ash and elm over hazel and thorn;
- wet ground by the river: alder and willow;
- pine and birch are not used: neither belongs on this ground in these periods (and no CC0 scan of either broadleaf exists).

Every tree also gets its own lean (about 2-6°, more on wet ground and in hedgerows), crown proportions (±10 % each way),
height, brightness and hue, and a slow drift of brightness and hue over a few hundred metres so that stands differ, not
just single trees. Tints are season-neutral summer greens: oak deep olive, lime fresher and yellower, ash lighter and
greyer, elm dark, alder dark and cool, willow grey-green.

## Impostors (`veg/impostor.ts`, baked by `scripts/bake-octa.mjs`)

The far level is a **hemi-octahedral impostor**: each scan's LOD0 is rendered orthographically from 12 x 12 directions over
the upper hemisphere (`public/assets/models/<id>/octa_c.webp`, colour and coverage, 1536 px; `octa_n.webp`, object-space
normal and a crown-occlusion term, 768 px; `octa.json`). At runtime each tree is one quad facing the camera; the three baked
views nearest the view direction, taken in the tree's own frame (so its rotation, lean and stretch hold), are blended.

- **Lit like everything else**: the quad is a MeshStandardMaterial, so it gets the scene's sun, sky light, cascaded and
  cloud shadows and aerial perspective. The baked normal shades the crown as a volume; the occlusion term (how deep in
  the crown and how low the visible leaf sits) darkens the sky light fully and the sunlight partly (soft self-shadowing);
  with the sun behind the tree some light comes through the leaves. The near leaf cards get the same light-through term.
- **Shadows**: in the shadow pass the same quad faces the sun, so far trees cast crown-shaped shadows. The quad's own
  shadow lookup is moved one crown radius towards the sun, so a crown does not shadow half of itself along a straight line.
- **Edges**: colour is blended by coverage (no dark or light fringe), and coverage is kept up through the mip chain so
  distant crowns do not thin out to specks; empty texels carry the mean leaf colour.
- **Seen from above** the impostor shows the crown from above (the old crossed cards were two slivers and needed a flat
  "crown plate"), so a closed wood reads as a continuous canopy from the overview.

## Cross-fade between levels

Neighbouring levels overlap over a band: 15 % of the switch distance between the mesh and the impostor, 5 % between the
two mesh levels (the same model, and the heaviest overlap). Inside a band each fragment is drawn by one level or the
other according to a noise fixed in world space, in cells about 0.2 % of the band's distance across (two or three pixels;
the same cells on both sides of the band), so a tree dissolves from one level into the other in small clumps that do not
crawl as the camera moves; temporal anti-aliasing (High) softens the cells further. A first version used screen-space
noise: in still frames it showed as a screen-door pattern on every tree in a band. The band is evaluated on the GPU from
the main camera (`vegUniforms.uLodCam`), with the same size factor as the CPU; outside its band a level's vertices
collapse. The CPU re-buckets every level after a camera move of 12 m (more when high up), and the mesh levels alone,
from a short list of nearby trees, after 3 m; each bucket is widened by more than the move, so the GPU band is always
covered while the heavy mesh levels overlap only a few metres. The fallback (old crossed-card impostor, if the
octahedral bake is missing) keeps the hard switch.

The impostor is taken 14 % darker than its baked colour: the mesh levels shadow the inside of their own crown in the
shadow map, which the impostor's baked occlusion only approximates; compared side by side at the switch distance
(`userData.forceLevel(1)` / `(2)`), from the ground and from above, the two then match in tone and silhouette.

## Cost

Measured in one browser on an Apple M3 Max at 1500 x 900, pixel ratio 2, High, with the old crossed-card impostors
(`?treeimp=cards`, same placement and level distances) against the octahedral ones, alternating, three rounds each,
on a quiet machine (`node tests/tree-ab.mjs 3 2`). "Trees alone" is the frame with the tree group drawn minus the frame
with it hidden, alternated within one page.

| view | frame, cards | frame, octahedral | trees alone, cards | trees alone, octahedral |
|---|---|---|---|---|
| London 4000 BCE overview | 9.40 ms | 8.90 ms | 1.45 ms | 1.10 ms |
| London 1616 overview | 12.41 ms | 12.54 ms | 0.28 ms | 0.22 ms |
| Stonehenge 2400 BCE | 8.72 ms | 8.78 ms | 0.27 ms | 0.28 ms |
| London 4000 BCE, walking in the wood | 14.84 ms | 16.47 ms | 8.00 ms | 9.24 ms |

From the overviews the octahedral impostors cost nothing extra (one quad per tree instead of two, and a cheap path
for far trees: a single view below about 2 % of the screen height, early rejection of empty texels). Walking inside the
closed wood they cost about 1.2-1.6 ms more, most of it the overlap of the mesh levels in the fade bands. The four
impostor atlases add about 3 MB of downloads (local) and about 60 MB of GPU memory.

## Canopy fullness

Each woodland tree gets 2 (High) / 1 (Medium) "filler" trees one size class smaller, 0.4-0.7 spacing away. They share the
parent's life window (they appear and vanish with it), and are skipped over water. Where cover is high the crowns overlap
into a closed canopy; as the cover keyframes fall the parents disappear and the canopy thins with them. Low quality has no
fillers and broader crowns instead.

## Settlement clearance

A woodland spot counts as a settlement zone's if it lies inside the zone or within 20 m of its outline (the trodden
ground the terrain paints round a zone reaches up to a grid cell, 12 m, beyond the outline, and a crown standing just
beyond that still overhangs it). Its tree is felled within 25 years of the zone's start, and in any case by the end of
the zone's growth, so a short-lived settlement has no trees standing in it. Before this, trees stood at the edge of
Durrington Walls' village (c. 2500 BCE; it grew over six years and stood about a dozen) and among the posts of the
Southern Circle beside it, because their felling could lag 25 years, longer than the village's whole life. The same
rule applies on every site, so a few trees on the edges of London's settlement zones now go when those zones begin.
Placement relative to houses, roads, walls and water is otherwise unchanged (it is the same per-item keep-out pass).

## Understorey and deadwood (Medium, High)

Camera-following window (radius 70 m High / 48 m Medium, hidden when the camera is high above the ground), under dated trees only:
ferns (`fern_02`), nettles (`nettle_plant`), lesser celandine (`celandine_01`), and sparsely, more in old woodland, logs
(`dead_tree_trunk`, `dead_tree_trunk_02`), stumps (`tree_stump_01`), root plates (`root_cluster_01`) and brushwood.
Each takes its nearest tree's life window. Open ground is left to the grass layer in `groundDetail.ts`. `shrub_02` was tried and
dropped: it is a dry twiggy plant, not a woodland shrub.

## Re-baking and checking

```bash
node scripts/bake-octa.mjs             # the four broadleaf scans, ~5 s each; needs the dev server on :4310
node tests/tree-shots.mjs <label>      # fixed tree views, clear and golden, into docs/screenshots/realism/trees/<label>/
node tests/tree-ab.mjs 3 2             # frame time, octahedral impostors vs the old crossed cards (?treeimp=cards)
node tests/tree-load.mjs london 1616   # page open -> scene ready -> scanned trees in
```

`?treeimp=cards` keeps the old crossed-card impostors (for comparison only).

## What still looks fake

- All broadleaf crowns are four scan shapes: gnarled, olive-like trunks at walking distance; no true oak, ash or lime
  silhouettes; repetition can be seen from the air.
- Trunks are too thick and short for 20 m woodland trees; leaves at x4-5 are larger than real oak leaves.
- Impostors have no parallax inside the crown and are a little flatter than the mesh levels (no shadow-mapped
  self-shadowing, only the baked occlusion); thin sunlit outer branches can read paler than on the mesh, most in haze.
- A tree caught inside a fade band shows small holes in a still frame (the dissolve cells); on Medium, without temporal
  anti-aliasing, they stay visible while the band passes.
- From the overview a closed wood reads as a continuous canopy of rounded crowns, but crowns are similar in size and
  shape across a wood (four models), and the canopy has no larger structure (gaps, glades, emergent trees) beyond what
  the woodland-cover thresholds produce.
- The yellow-brown woodland floor comes from the terrain, not from this module; understorey is sparse compared with a real wood floor.
