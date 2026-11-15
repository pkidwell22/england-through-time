# Brentford site (950–1100): research notes

Data: `data/locations/brentford/` (site, eras, events, landmarks, zones, episodes, sources).
Starting point: the `brentford-1016` entry in `research/events.json`.
Every URL in `sources.json` was fetched for this work. Wikipedia pages are leads only and are labelled so.

## What was established

**The battle (1016).** The only narrative is the Anglo-Saxon Chronicle (Ingram's translation, Avalon Project):

- Edmund gathered his force a third time, went to London "all by north of the Thames, and so out through Clayhanger", relieved the citizens and drove the enemy to their ships.
- "It was within two nights after that the king went over at Brentford; where he fought with the enemy, and put them to flight: but there many of the English were drowned, from their own carelessness; who went before the main army with a design to plunder."
- Edmund then went to Wessex; the Danes returned to London.
- Later the same year, with a fourth levy, he "forded over the Thames at Brentford; whence he proceeded into Kent".
- 1013, for comparison: many of Swein's army "sunk in the Thames, because they kept not to any bridge" (place not given).

**The place before 1016** (VCH Middlesex vol. 7, "Growth of Brentford" and "Economic history"):

- Name recorded from 705; "generally assumed to refer to the ford over the Brent", though it "may have referred to the crossing of the Thames".
- 705 meeting of the kings of Wessex and Essex; 780 council under Offa; 781 synod.
- 996: King Æthelred granted half of a Thames fishery at Brentford to the church of St Peter and St Paul, Winchester.
- Saxon occupation has been found at one site only, at Old Brentford. **"No trace of late Saxon occupation has been found."**
- The VCH (citing Stenton) says the 1016 battle was fought "on the south bank".

**Fords and road** (VCH vol. 7 "Communications"; VCH vol. 3 Heston and Isleworth; Brentford & Chiswick LHS):

- The "lowest permanent ford over the Thames" until Roman times was probably at Old England, later covered by Brentford Dock.
- Roman road London–Silchester/Staines through Brentford from the late 1st century; Roman buildings mainly north of the modern High Street; the road's line "did not survive"; the modern alignment existed by the late 14th century.
- Brent bridge: first recorded 1224 (pontage); stone bridge 1446. No bridge is evidenced in the window, so a ford is shown.
- A writer of 1695 is quoted as saying the Thames at Old England was "not above 3ft deep at low water" (the only depth figure found, 700 years late).
- Kew ferry recorded by the 16th century, probably from Ferry Lane.

**Old England and the stakes.** Stakes on the foreshore at Old England and Brentford End were "perhaps used to defend the ford" (VCH) and are "the only material evidence" for Caesar's crossing here. This is Montagu Sharpe's antiquarian case; Wheeler (Antiquity, 1929; extract only read) doubted it. Wheeler dug near the Brent mouth in 1928 and found a hut floor of the 2nd–3rd century CE; Iron Age and Romano-British hut floors on the Brentford foreshore lie below high-tide level (VCH vol. 1), so the river has risen since.

**Landscape** (VCH vol. 7 Introduction; VCH vol. 3):

- Alluvium along the Brent, the Thames and at the Brent mouth, bordered by flood-plain gravel (Old Brentford is on flood-plain gravel); brickearth and Taplow gravel further north; land "rising gently from the Thames" to about 23 m at the centre of Ealing parish.
- Isleworth: flood-plain gravel with a narrow strip of alluvium by the river.
- The Brent below Brentford Bridge was straightened between 1699 and 1760; the later dock stood on an island between the Thames and two mouths of the Brent (Wikipedia lead).
- Lot's Ait lay in Ealing parish, Brentford Ait in Surrey. Osiers were grown on aits by 1397. Nothing earlier on the aits was found.
- Kew: first recorded in the 14th century; part of the royal manor of Richmond (VCH Surrey vol. 3).

**Domesday (1086).** Brentford is not named. Isleworth: 118 households, 55 ploughlands, 2 mills, woodland for 500 pigs, £80 in 1066 and £72 in 1086, Earl Ælfgar then Walter of St Valery (Open Domesday). Hanwell: Westminster Abbey, 8 hides, a mill, woodland for 50 pigs, 17 households (Aubrey Research, a secondary page whose own totals disagree: 17 and 13). Old Brentford was "probably included" with Ealing in the bishop of London's Fulham (VCH); the Fulham entry itself was not read.

## What could not be established

- Where the army crossed, which bank the fighting was on, the date, numbers, commanders on the day, where the drowning happened. None is recorded.
- Stenton's and Poole's arguments (that the English fell in battle and did not drown) and the Knútsdrápa reading (fighting on both banks): reported by Wikipedia only; not read.
- Whether the reach was tidal about 1000, and the tidal range. No source found. The model has one water level.
- Width, depth and exact course of the 11th-century Thames here, and the form of any islands.
- The medieval course of the lower Brent and its second mouth.
- The line of the road in 1016.
- Any late Saxon building at Brentford.
- Not obtained: the Historic England Hounslow Archaeological Priority Areas appraisal (HTTP 403); the LAMAS vol. 58 report on the Roman road at Brentford (file too large); a London Archaeologist paper (PDF could not be read here); Canham's *2000 Years of Brentford* (the VCH's main source; not online). MOLA, London Museum and Layers of London pages on Brentford were not found in the searches made.

## Coordinates

- Projection as in `src/lib/geo.ts`. Origin **51.4815, −0.3020**: on the Old England ground between the lower Brent and the Thames (inside the modern Brentford Dock estate). Chosen as a centre for the model because the VCH puts the probable ford here. It is not a battlefield location.
- Bounds x −1500…1500, z −1200…1200 (3.0 × 2.4 km): Brentford Bridge and Syon to the west, Kew Bridge's site to the east, Boston Manor's latitude to the north, the Syon/Kew reach to the south.
- Thames centreline: 24 points taken from the OpenStreetMap river line (Richmond to Mortlake), 13 inside the bounds, both ends outside. Left = Middlesex bank, right = Surrey bank.
- Half-widths (65–110 m a side) are an assumption: roughly the modern channel plus a margin for an unembanked river, widest across the aits. `northBankSetback` is 0 throughout. `southEmbankment` is a constant 0.45, purely to make the Kew side render as low damp ground instead of open creeks; it does not mean a flood bank existed.
- Brent, High Street/London Road, the aits, St Lawrence's and Thames Lock positions are from OpenStreetMap (modern). The Brent path is the modern river/canal line, generalised.

## Every conjectural element in the data

Site
- River half-widths, single water level, right-bank "0.45" setting.
- The three eyots (gravel shoals at the positions of the later Lot's Ait and Brentford Ait).
- Brent valley depth and width; woodland cover figures.
- Engine relief in general (the Syon bank is drawn higher than it is).

Landmarks
- `thames-ford`: existence attested (Chronicle); the line, width and form are conjectural. No stakes shown.
- `brent-ford`: placed at the modern bridge; form conjectural.
- `west-road-east`, `west-road-west`: modern High Street/London Road line used for a road whose 11th-century line is unknown.
- `ford-track`: invented link from the road to the ford.
- `fields-old-brentford`, `fields-isleworth`: invented outlines and strip directions (open fields first described 1383; Domesday ploughlands not located).
- `fishing-boats`: illustrative (fishery attested 996; boats, number and place are not).
- 1016 only: `marker-crossing`, `marker-crossing-alt`, `marker-danish-position` (shaded areas); `troops-english-main` (180 figures), `troops-english-advance` (40), `troops-danish` (160). All invented for the staging; 380 figures in total; real numbers unknown. No banners, ships, camp or drowning are shown.

Zones
- `old-brentford-hamlet`: position, size and building count (no late Saxon occupation excavated).
- `brent-crossing-farm`: existence before c. 1170 and the growth years 1040–1090.
- `syon-foreshore-scrub`, `kew-bank-scrub`: vegetation guesses.

Deliberately not used: `atmosphere` (weather and season of the battle are unknown, so no mist or special light), `tents`, `hedge`, `bridge`, `church`, `hall`.

## Notes for the engine and the integrator

- Eyots only raise the right-bank marsh in `terrain.ts`. The three eyots here lie in or beside the channel, so they will show little or nothing unless mid-channel eyots are supported.
- `field-strips` reads `pitch` and `bearing`; the brief listed `spacing`. Both `pitch` and `spacing` are written.
- `zone-marker` has a `label` in the data; the builder does not appear to read it (the landmark name carries the label).
- Zones present from the start use `grow: [950, 950]` to stay inside the window, so buildings and scrub rise during the first few years. A pre-window grow year would remove that artefact if the loader allows it.
- `site.timeline.initialYear` is 1016. No `district` is defined; all landmarks and views are tier/scope "overview".
- A fish weir and timber stakes cannot be drawn with the kinds available; neither is evidenced closely enough to need them.
- `docs/RECORD.md` still lists Brentford as off-map for the London site; the London episode of the same id is untouched.
- Validation: a Python check (parse, years 950–1100, phase order, `continues` rules, source ids, projection inside bounds, troop blocks and houses on dry ground) passes with 0 problems; `tests/unit/sites.test.ts` and `data.test.ts` pass; the site loads at `/?site=brentford`.
