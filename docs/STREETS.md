# Streets and facades at eye level (London Bridge district)

Workstream: close-range streets and facades. Files: `src/scene/houses.ts`, `src/scene/fabric.ts`,
`src/scene/materials.ts`, `data/assets.json`, `src/scene/street/*`, `data/locations/london/streets.json`,
`tests/street-shots.mjs`. Screenshots: `docs/screenshots/london-realism/streets/<iteration>/`.

**Not photorealistic.** The streets now have continuous frontages, modelled openings and believable wall
surfaces at a few metres; what still gives them away is listed at the end.

## 1. The street plan

`data/locations/london/streets.json` holds the district's street network: named streets as polylines in
lat/lon, with width, the years they exist, kind (principal / market / lane / alley), which sides carry
houses, dated surfaces, evidence class, confidence, positional uncertainty and source. It is loaded by
`src/scene/street/network.ts` for site `london` only; every other site (Brentford, Barnet, Stonehenge,
previews) and everything outside the district rectangle keep the generated lattice exactly as before.

| Era (years) | Documented (attested-*) | Reconstructed | Generated (conjectural) |
|---|---|---|---|
| Medieval and Tudor (1050–1625) | 22 | 0 | 18 |
| Late Saxon (890–1049) | 0 | 3 | 1 |
| Roman (50–410) | 2 | 0 | 7 |

What "documented" means here, honestly:

- **Principal streets** (Fish Street Hill / New Fish Street, Gracechurch Street's foot, Great Eastcheap,
  Candlewick Street, Thames Street both sides of the bridge, Borough High Street, St Olave's (Tooley)
  Street, Clink Street, Bankside): the street, its course and its relation to the landmarks are attested by
  Stow (1603) and the Copperplate / "Agas" maps (c. 1553–70) and the Southwark panoramas. Their *lines* in
  this model are drawn from the landmark positions already in the data (bridge foot at the origin,
  St Magnus, Fishmongers' Hall, Billingsgate, St Olave, St Mary Overie, Winchester Palace), not surveyed:
  positional uncertainty about ±20 m. Fish Street Hill north of Thames Street and Borough High Street are
  laid on the Roman road corridors already in the data (`road-ermine`, `road-watling-south`), which they are
  generally taken to follow; Upper Thames Street follows the late Roman riverside wall line.
- **Named lanes** (Pudding Lane, Botolph Lane, St Mary at Hill, Love Lane, Billingsgate, Crooked Lane,
  St Michael's (Miles) Lane, St Martin Orgar's Lane, Bush Lane, Old Swan Lane, Ebbgate Lane, St Thomas
  Street): documented by name in Stow's ward descriptions; their lines are estimates (±30 m), confidence low.
- **Alleys and courts** (12 north, 6 south of the river) are generated, marked `conjectural`. Courts and
  alleys of this kind appear in every period view, but none is placed from a source.
- **Late Saxon**: the way from the late Saxon bridge, the Southwark way and Eastcheap are *reconstructed*
  from the Saxon bridge position and the Roman lines; the riverside street on the old wall line is a guess.
  The late Saxon plan near the bridge is not well known.
- **Roman**: the roads north and south of the Roman bridge are the data's excavated road corridors; the
  street behind the quays, an east–west street and four lanes are generated at right angles to the river.

Each zone in the district uses the streets standing at the middle of its life, so Roman zones get the Roman
network, the Saxon zone the late Saxon one, medieval and Tudor zones the medieval plan.

**Dated ends (`reach`).** `points` is a street's line at its fullest (for the lanes to the river, the 1625
waterfront). A street that was carried out as the north bank was reclaimed, or onto the Southwark marsh as it was
embanked, also has `reach`: `anchor` (`"first"` / `"last"`: the end of `points` that stays put) and `stages`, each
`{ from, to, end }`, the street running from the anchored end to `end` (a point on its line) in those years and not
standing at all outside every stage. The loader (`src/scene/street/network.ts`) turns each stage into its own street
record, so houses, surfaces, walkers and the audit all see the street of the year. The stage ends were derived from
this model's own bank (ground at least 0.45 m above high water for every year of the stage, steps of about 8 m), so
`reach` carries its own `evidence: "conjectural"`, `confidence: "low"` and a note: the documented fact is only that
the lanes were extended as the waterfront advanced, not when each one reached where. Billingsgate lane ends at the
head of Billingsgate dock (an open inlet, `site.river.inlets`) in every year.

### How houses are placed (src/scene/street/plots.ts)

Each street side is cut into 24 m lots (the same lots for every style, so zones that share a street by
`band`, e.g. Roman timber and masonry, claim whole lots and never overlap). A lot is divided into plots of
4.3–8.6 m (medieval, Tudor), 4.4–7.2 m (Roman strips), 6–17 m (Saxon halls) or whole lots (Roman masonry);
each plot gets one house whose ground storey stands on the street edge, its jetties overhanging the street,
scaled along its frontage (±15 %, at most 0.8–1.25) so party walls touch. Principal streets claim frontage
first; a plot is dropped if it would overlap an earlier one or stand in another street, so junctions clear
themselves and the corner house of the more important street shows its side wall to the lane (corner
houses do not yet have a designed second front). Plots run back from the street: the house, its rear
range or lean-to, a yard of 3–9 m and, behind about 60 % of street houses, a rear tenement (a plain house
without shop, sign or cellar) — the period views show block interiors full of roofs, and without them the
blocks read as empty squares from the air. Roman masonry lots get no rear tenement.

Unchanged: every house still appears and disappears by its zone's dated life window through the per-
instance `aLife` (zone extent, `fill`, ragged edge, `band`, growth order and decline all apply as before);
houses keep off landmark footprints with the old rule. **Changed:** road corridors (`landmarks.corridors`)
are kept clear of street houses by the road itself plus 0.5 m (the corridor's 5 m margin is not applied to
street plots, otherwise no house could front Fish Street Hill or Borough High Street, which lie on those
roads). Large lattice buildings in the district (parish churches) block street plots.

### Street surfaces (src/scene/street/surface.ts)

Each street's dated `surface` periods are draped on the terrain: trodden earth, gravel, or cobbles (on the
principal streets from 1400; gravel 1050–1400), with a central kennel (gutter) and a slight fall to it,
fading out at the edges (they run under the house plinths). One mesh per material and period. The dating
of paving is a reasonable general assumption for London's main streets, not a record for each street. Ruts,
puddles and refuse are the ground layer's (src/scene/ground), drawn over these.

## 2. Materials (data/assets.json, Poly Haven CC0)

Tiles were checked against each scan's physical size (Poly Haven API `dimensions`).

| Name | Before | Now |
|---|---|---|
| plaster | medieval_wall_01 (rough rocky render, stretched) | plastered_wall, 2 m, warm limewash tint |
| daub | clay_plaster | patterned_clay_plaster, 2 m |
| oak (new; house framing) | (weathered_planks) | rough_wood, 0.8 m, grain along each member |
| planks (new; doors, shutters, boards) | (weathered_planks) | brown_planks_03, 1 m |
| rubble (new; house plinths, steps) | (castle_wall_slates) | old_stone_wall, 2 m |
| brick-tudor (new; stacks, brick houses) | (medieval_red_brick) | castle_brick_02_red, 1.5 m |
| thatch | thatch_roof_angled (0.54 m scan shown at 3 m) | reed_roof_04, 2.5 m |
| thatch-old | reed_roof_03 at 3.5 m | same scan at its 2.5 m |
| street-cobble / street-gravel / street-earth / kennel (new) | — | cobblestone_floor_08 / rocky_trail / park_dirt / brown_mud_02 |
| cobble | cobblestone_floor_04 | cobblestone_floor_08, 2 m |
| scale fixes | caen 4.5, ashlar 4, roman-rubble 3.2, whitewash 4, timber-weathered 2.4, tile-old 2.6, slate/shingle 2.4, earth 5 | 2.6, 2.6, 2.4, 2.2, 1.4, 3.4, 3.0, 2.0 (closer to the scans' real sizes) |

Timber-frame walls of modelled houses use new **bay composites** `fwall-<design>` (src/scene/street/frameTex.ts):
one texture repeat is exactly one bay wide and one storey high, and the walls (and gable triangles, dormers
and rear ranges) get UVs in bays and storeys, so framing always sits at storey scale. Five designs —
square panels with a short brace, close studding, close studding with a middle rail, small square panels,
square panels with long tension braces — assigned by wall name so neighbours differ. Each is composited at
1024 px from the plaster and oak scans: limewashed panels with low-frequency unevenness, oak members with
grain along the member and per-member tone, pegs at the joints, grime lines where daub meets timber,
run-off streaks under the rails and splash at the base; a height canvas gives a normal map (Sobel) and a
roughness map. The old `frame-*` composite (with a painted window) stays for overview houses.

New procedural fittings (src/scene/street/specialTex.ts): `glass-leaded` (diamond quarries of greenish
crown glass in lead cames, each quarry tilted a little in the normal map so the sky reflection breaks up),
`sign` (an atlas of eight painted boards with generic emblems: bush, bell, sun, star, key, moon, cup,
crown — no lettering), `iron` (straps, hinges, brackets), `interior` (a dim boarded room seen through
shop openings and open doors, instead of flat black).

## 3. Facades (src/scene/houses.ts, src/scene/street/kit.ts)

`house(b, opts)` keeps its name, options and behaviour for the bridge (district.ts); new optional options:
`rich`, `sideJetty`, `endOver`, `sign`, `cellar`, `pentice`, `design`. Three levels:

- **Near (rich)**: windows in frames standing 16 cm proud so the lights sit in reveals, moulded mullions at
  about 0.4 m, transoms on tall lights, projecting sills; unglazed openings with diamond-set mullions and
  plank shutters (one leaf often open); plank doors in proud frames with strap hinges, ring, stone
  threshold, sometimes ajar; moulded bressummers with joist ends under jetties and curved brackets;
  rafter feet and fascia under eaves; half-round ridge tiles; bargeboards with finials; shop fronts with the
  lower shutter let down on legs as a stall board and the upper propped as a hood on iron stays; pentices;
  cellar flaps; hanging signs on iron brackets. About 0.8–1.5 k triangles per house.
- **District**: the same walls and roofs with simple frames, lights and doors (about 230–530 triangles).
- **Overview**: the old box-and-roof model (about 30–70 triangles).

Period rules: medieval houses unglazed (shuttered); Tudor houses glazed only when they have a stack and at
least three storeys (some variants explicitly unglazed; shop storeys never glazed); Roman and Saxon models
unchanged (no glass, no chimneys).

## 4. Level of detail (src/scene/street/lod.ts, FabricLayer.setLod)

An Extra registered from `fabric.ts` (engine.ts unchanged) calls `FabricLayer.setLod(camera.position)` when
the camera has moved more than 3 m. Every district instance is copied into the instance buffers of its
current level: near model within 70 m, district model to 300 m, overview beyond (8 % hysteresis). Each
level's instances stay sorted by end date, so the existing year culling still works per level.

## 5. Measurements

`node tests/street-shots.mjs <label> [filter] [runs]` takes seven eye-level views (walk mode, 1.7 m:
Fish Street Hill at 1616, 1300, 1050 and 150 — a spot on both the medieval street and the Roman road —,
Thames Street, Pudding Lane, Borough High Street, all 1616) and the standard views, with
`benchmark(20).msPerFrame` (minimum of the runs) at High, 1600 × 900.

Iterations: `v0-before` (old fabric; its eye-level cameras were placed before the street plan existed and
were lifted by the orbit controls to 6–10 m, so only the wide views compare directly), `v1` (street plan,
materials, facades, LOD), `v2` (rear tenements, finer window frames and joists), `v3` (far LOD at 300 m,
camera fix), `v4` (shop and door interiors, closed shutters on side walls; landmark checks).

| View | v0 before | v3 | v4 |
|---|---|---|---|
| bridgehead 1616 | 22.3 | 20.2 | 25.9* |
| bridge 1616 | 34.0 | 21.2 | 25.5* |
| city 1616 | 28.5 | 22.2 | 23.8 |
| overview 1616 | 25.7 | 24.9 | 25.7* |
| city 150 | 20.9 | 16.5 | 15.8 |
| Fish Street Hill 1616 / 1300 / 1050 / 150 | — | 23.7 / 18.8 / 16.9 / 13.1 | 23.2 / 19.6 / 15.3 / 12.8 |
| Thames Street / Pudding Lane / Borough High St 1616 | — | 22.7 / 17.2 / 21.8 | 21.6–37* / 19.2 / 31.0* |

\* The machine is shared and was heavily loaded during the v4 run: v3 and v4 render the same triangle
counts for these views (e.g. bridgehead 3.50 M, Borough High Street 3.79 M), so the v4 rise is load, not
the scene. In one session at the bridgehead view, the fabric with the LOD scheme cost about the same as the
fabric with every district house on the district model (near/far off), and the far level at 300 m instead
of 430 m cut 0.4 M triangles. Triangles: near model 0.8–1.5 k, district model 0.23–0.53 k, overview
0.03–0.07 k per Tudor house.

## 6. What still looks fake at eye level

- Houses are still a small set of designs (10 Tudor, 9 medieval) repeated; heights and roof lines are too
  regular and rows too straight; no sagging, leaning or settlement.
- Party walls are perfectly flush; jetty lines of neighbours line up too neatly; corner houses have no
  second designed front.
- Openings are applied to the wall surface (no holes): there is no interior beyond the glass or shutter.
- The framing is a texture: from a raking angle the studs do not stand proud; only corner posts,
  bressummers, sills and window frames are geometry.
- Street surfaces are clean scans with a painted-on kennel; no mud splash on walls beyond the texture,
  no doorstep wear, no drains, posts, bollards, stalls in the street, or wells and conduits.
- Signs, shop goods and shutters repeat per house design (instanced).
- Glass reflections are of the sky only (no reflections of the opposite houses).
- Street lines are estimated from landmark positions, not from a georeferenced map; the Steelyard
  landmark's estimated position lies across Thames Street (a data inconsistency: the Steelyard stood
  south of the street), so Thames Street's surface is cut where it crosses that footprint.
- Clink Street ends at the Winchester Palace footprint; Bankside resumes west of it.
