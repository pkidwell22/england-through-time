# Vessels: dated river craft

Every boat in London is drawn from a dated, sourced vessel-type catalogue, so the kind of craft on the Thames
changes with the evidence: logboats, Roman barges and merchantmen, Saxon clinker boats, longships, cogs, shouts,
carracks, Elizabethan merchantmen and the watermen's wherries. Research notes and sources: `research/vessels.md`.
Tests: `tests/unit/vessels.test.ts`. Screenshots: `docs/screenshots/vessels/` (one contact sheet per era).

## How it fits together

| Piece | File | What it holds |
|---|---|---|
| Catalogue | `data/locations/<site>/vessels.json` (optional, loaded by `src/lib/data.ts`) | One entry per vessel TYPE: id, name, `from`/`to` (the years it may be shown on this river), `dateNote`, `evidence`, `confidence`, `summary`, `uncertainty`, `sources`, and `model` (the parameters of its parametric model). |
| Sources | `data/locations/london/sources.json` (ids `ves-…`) | Merged over `data/sources.json` by the loader. |
| Placements | river-craft entries in `landmarks.json` (kind `boats`) | Each phase has a `fleet`: which types, how many, in which zone, how many of them move. |
| Static craft | `src/scene/vessels.ts` (replaces `BUILDERS.boats`), `src/scene/vessels/placement.ts`, `src/scene/vessels/model.ts` | Placement by zone; one parametric model per type, moored, beached or rowing. |
| Moving craft | `src/scene/pop/boats.ts` | The same types and model, under way, with wakes. |

Schema additions (both optional and additive): `VesselType` and `Dataset.vessels` in `src/lib/types.ts`; the loader
reads `vessels.json`, attaches the types to every phase model that has a `fleet` (as a non-enumerable
`vesselTypes`, so a builder that sees only the phase model can draw them), and `validateDataset` reports an unknown
type, a type with bad years or unknown sources, and **any type shown outside its own dates**.

### The evidence split

Each **type** carries its own, usually stronger, evidence class (the County Hall ship is excavated; a cog at London
is reconstructed from the Hanseatic trade and the Bremen cog). The **placements** (how many craft, where each lies,
which way it points) are illustrative, so every river-craft landmark is `evidence: "conjectural"`, and its summary
says so in so many words.

### `boats` phase parameters

| Param | Meaning |
|---|---|
| `fleet` | `[{ type, n, zone, moving?, state?, span? }]`. `n` craft at rest; `moving` more set moving by the populace layer (scaled by quality); `state` `"rowing"` for a staged moment (oars out, crew); `span` `[a, b]` limits the entry to that fraction of the path (0 = upstream end). |
| `crossing` | `[lat, lon]` of the bridge (or bridgehead): "above" is upstream of it, "below" downstream. |
| `clear` | Metres kept free around the crossing [45]. |
| `within` | Limit "above"/"below"/"pool" to this many metres from the crossing. |

The landmark `path` runs downstream. Zones: `north` / `south` (moored close in along that bank; the left and right
bank looking downstream), `river` (anywhere afloat), `pool` (mid-stream tiers below the crossing), `above`, `below`,
`beach` / `beach-south` (drawn up on the foreshore). `north`, `south` and `river` take `-above` / `-below`.
An old `boats` phase without a `fleet` (none remain) falls back to a few generic small clinker boats.

### `model` parameters (catalogue)

`hull` (`logboat`, `flat`, `round`, `double` = double-ended, `cog`), `build` (`logboat`, `romano-celtic`, `carvel`,
`clinker` = lapped strakes drawn, `plain`), `len`, `beam`, `depth`, `draft`, `sheer`, `bow`/`stern` (fullness 0-1),
`transom`, `posts` (stem and stern posts above the sheer), `masts` (`[{ at: fraction from stern, h, rig: square |
lateen | brailed, yard, top }]`), `rudder` (`none`, `oar` = steering oar, `side`, `quarter-pair`, `stern`),
`castles` (`{ fore: [l, h], aft: [l, h] }`), `foreOverhang`, `beakhead`, `gunports`, `oars` (per side), `sweeps`,
`seats`, `deck`, `tilt`, `cabin` (`[l, h]`), `trim` (a `flat:` colour), `cargo` (`ragstone`, `barrels`, `bales`,
`amphorae`), `hullMat`, `passesBridge` (false = cannot pass a bridge: masted ships and barges), `crew`.

## The catalogue

| Type | Dates shown | Evidence | Modelled as | Placed |
|---|---|---|---|---|
| Logboat (dugout) | 2350 BCE-400 (used only to 50) | excavated (Thames region; none in this reach), low | 7.6 m oak dugout, square stern, carved ribs, paddled | one on each shore, prehistory only |
| Romano-Celtic barge (Blackfriars 1) | 50-410 | excavated, medium | 16.5 x 6 m, flat, keel-less, flush planks, mast a third from the bow, square sail, ragstone cargo, quarter steering oar (conjecture) | north quays, both sides of the bridge |
| Roman river barge (New Guy's House) | 50-410 | excavated, medium | 15.5 x 4 m flat barge, amphorae, no mast | quays and Southwark shore |
| Roman merchantman (County Hall) | 50-410 | excavated (one find), low | 19.5 x 4.8 m keeled carvel hull, decked, one mast, paired quarter rudders | mid-stream and quays below the bridge |
| Roman small boat | 50-410 | conjectural | 5.5 m rowing boat | anywhere |
| Saxon clinker trader (Graveney) | 600-1000 | reconstructed, low | 14 x 2.9 m double-ended clinker, 5 oars a side, side rudder, no mast | beached at Lundenwic, 650-870 |
| Small clinker boat | 600-1625 | documentary, medium | 5.2 m clinker rowing boat | Lundenwic; the river from 900 |
| Longship, small (Skuldelev 5) | 850-1100 | reconstructed, low | 17.3 x 2.5 m clinker, 13 oars a side, side rudder, square sail | 1014 staging only |
| Longship, large (Skuldelev 2) | 850-1100 | reconstructed, low | 29.3 x 3.8 m, 30 oars a side | 1014 staging only |
| Clinker cargo ship (keel type) | 900-1300 | reconstructed, low | 14 x 3.6 m double-ended clinker, square sail, side rudder, barrels | north quays |
| Clinker ship with castles (seal type) | 1200-1500 | pictorial (seals), low | 20 x 6 m clinker, fore and aft castles, stern rudder | north quays; above the bridge until 1500 |
| Cog (Bremen cog) | 1250-1450 (shown from 1300) | reconstructed, low | 23.3 x 7.6 m, flat flush bottom, clinker sides, straight posts, stern rudder, aft castle | quays below and (Steelyard) above |
| Shout (Blackfriars 3) | 1300-1500 | excavated, medium | 14.6 x 4.3 x 0.9 m clinker river barge, square sail, stern rudder | above the bridge |
| Lighter | 1300-1625 | documentary, medium | 11 m open flat barge, sweeps | river and Pool |
| State or livery barge | 1422-1625 | documentary, medium | 19 m rowbarge, canopied house, painted strake, gilt | above the bridge |
| Carrack | 1470-1580 (shown 1500-1560) | reconstructed, low | 26 x 8 m carvel, high castles, three masts (lateen mizzen), stern rudder | the Pool |
| Hoy | 1490-1625 | documentary, low | 15 m one-masted coaster, sail brailed (rig not verified) | below the bridge |
| Western barge | 1500-1625 | documentary, low | 18 m flat open barge, square sail | above the bridge |
| Wherry | 1500-1625 | documentary, medium | 6.9 x 1.4 m clinker, sharp bow, stern sheets, 1-2 watermen | everywhere, the commonest craft |
| Tilt-boat | 1560-1625 | documentary, low | 11 m rowing boat with an awning | below the bridge (Billingsgate) |
| Armed merchant ship (Gresham ship) | 1560-1625 | excavated (Thames estuary), medium | 24.5 x 7.4 m carvel, gunports, low castles, beakhead, three masts with tops | the Pool |

Brentford has its own one-type catalogue (`data/locations/brentford/vessels.json`: small clinker fishing boat).

## The mix, era by era

| Years | Landmark | What is on the river |
|---|---|---|
| 4000-2350 BCE | | Nothing. |
| 2350 BCE-50 | `river-craft-prehistoric` | Two logboats (from the Bourne End period attribution); nothing else is evidenced. |
| 50-62 | `river-traffic-roman` | Two barges and two small boats at the new port. |
| 62-250 | | The port at its height: 5 barges, 3 merchantmen, 3 lighters, 4 small boats (+5 moving). |
| 250-300 | | Harbour no longer maintained: about half. |
| 300-410 | | Behind the riverside wall: a barge, a lighter, two boats. |
| 410-900 | (`lundenwic-beach-craft` 650-870) | Nothing at the bridgehead; Graveney-type traders and small boats beached on the Strand. |
| 900-1066 | `river-traffic-medieval` | Late Saxon revival: clinker cargo ships (side rudders) and small boats. |
| 1014 | `olafs-fleet` | Seven longships rowing below the timber bridge (saga staging, conjectural). |
| 1066-1200 | | More clinker cargo ships and boats. |
| 1200-1300 | | Ships with castles and stern rudders join the side-rudder keels. |
| 1300-1400 | | Cogs (one above the bridge at the Steelyard), shouts above the bridge, lighters, 14 boats. |
| 1400-1450 | | Late medieval port: cogs, castled ships, shouts, lighters, 16 boats. |
| 1450-1500 | | Last years of the drawbridge: castled ships (one still above it), shouts, a state barge. |
| 1500-1560 | | Carracks and lighters in the Pool, hoys below; western barges and state barges above; 24 wherries. |
| 1560-1625 | | Eight armed merchantmen and lighters in the Pool, hoys, tilt-boats; western barges and state barges above; 40 wherries (+18 moving). |

## Above and below the bridge

- Roman and Saxon timber bridges and the stone bridge are read from the data (`bridge` and `stone-bridge` phases).
- Before about 1500 tall ships could pass the drawbridge to Queenhithe and the Steelyard, so a few masted ships lie
  above the bridge; the drawbridge was damaged by raising in 1481 and judged too dangerous by 1497, so from 1500
  every craft that cannot pass the arches (catalogue `passesBridge: false`) is placed below it, except the western
  barges, which worked the upper river. A test enforces this.
- Moving craft: types that cannot pass keep to the stretch on their zone's side of any bridge standing that year.
  Small craft cross a bridge only through an opening: the arches of the stone bridge (positions from
  `bridgeLayout` in `district.ts`) or the gaps between the trestles of a timber bridge; their lane runs straight
  through the opening nearest its own line, never through a pier. In a year with no bridge (about 450-990) all
  traffic passes freely. Lanes are re-laid when the set of standing bridges changes.

## Performance

Triangles per craft (tested): ships 600-1,250 (rowing longships up to about 1,400), mid-sized craft under 800, small
craft under 320. River craft in 1616 add roughly 30k static triangles plus the instanced moving craft (one draw call
per type). Benchmarks at High, 1600x900, minimum of five runs (shared, noisy machine), vessels shown / hidden:
150 `bridge-low` 13.0 / 11.8 ms, `bridge` 15.4 / 12.5; 1300 `bridge-low` 20.3 / 19.6, `bridge` 21.0 / 20.2;
1616 `bridge-low` 23.9 / 20.9, `bridge` 18.6 / 18.4. All under 25 ms. The previous generic boats could not be measured
side by side once replaced; the shown/hidden difference is the whole cost of the river-craft layer.

## Illustrative, not evidence

Numbers, positions, headings and the mix within each phase; every route and speed of the moving craft; the colours
(tarred hulls, lighter castle sides, undyed sails, a red-painted barge are choices, not attested finishes); the
Roman quarter steering oars and paired rudders; the hoy's brailed sail; the crew figures.

## Limitations and next steps

- Not shown, because their dates or forms could not be verified: hulks as a separate type, Peter boats, dung boats,
  Dutch eel ships (only the 1699 Act was verified), galleys at London, sewn-plank boats.
- The panoramas (Wyngaerde, Agas, Norden, Visscher) were not read for their craft; a pass over high-resolution copies
  would refine the 16th- and 17th-century mix (e.g. how many ships lay in the Pool, sprit rigs on barges).
- Models are low-poly stand-ins: no running rigging, no flags, ropes as single bars, sails as faceted cloths.
- Moored ships do not swing with the tide; moving craft do not avoid each other or moored craft.
- `docs/MODEL-KINDS.md` still describes the old `boats` parameters (`count`, `ships`, `style`); it belongs to another
  workstream and should point here.
