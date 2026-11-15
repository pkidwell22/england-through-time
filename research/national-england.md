# National layer: England history data — research log

Files: `data/national/site.json`, `eras.json`, `events.json`, `places.json`, `polities.json`, `sources-england.json`.
Counts: 173 places (23 battles), 49 polities (9 with polygons), 10 eras, 70 events, 67 sources.

## What was verified, and how

Every URL in `sources-england.json` was fetched during this work. Three tiers:

1. **Institutional pages (28 places rest on at least one).** English Heritage history pages for Stonehenge, Avebury, Silbury Hill, Grime's Graves, Maiden Castle, Old Sarum, Wroxeter, Richborough, Silchester, Lindisfarne, Whitby, Jarrow, Housesteads, Chesters, Pevensey, Dover, Battle Abbey, Rievaulx and Kenilworth; National Trust (Sutton Hoo); Vindolanda Trust; The National Archives (Domesday); University of Cambridge (1209); the Roman Baths timeline; Herefordshire Council and the Open University for Rackham's woodland figures. Dates in these entries are the pages' own figures.
2. **Wikipedia only (72 places, most polities).** Used for the Roman coloniae and fortresses, the Anglo-Saxon kingdoms, Danelaw, Burghal Hidage, the battles, Dunwich, Ravenser Odd, Yeavering, Flag Fen, Danebury, Hengistbury Head, and the town rankings (1086 after Russell/Darby, 1377 poll tax after Russell, 1520s and 1662 after Hoskins). Every such entry carries the sentence "Dates are supported here only by Wikipedia…" in `uncertainty` (or `note` for polities) and is capped at confidence "medium".
3. **General knowledge (73 places).** `sources` is empty, confidence is "medium" or "low", and `uncertainty` says "Not checked against a fetched source…". This covers most medieval castles, abbeys, small towns, the minor prehistoric sites and eleven of the battles.

Could **not** fetch: Historic England (all battlefield and list pages returned 403), British Museum (403), University of Oxford (403), UK Parliament (403), several English Heritage pages whose URLs 404'd (Corbridge, Portchester, Tintagel, St Augustine's Abbey), and the Royal Forestry Society PDF (binary only). Not attempted: Pleiades, PASE, the Electronic Sawyer, British History Online, Open Domesday, Battlefields Trust (search did not return its pages). These would be the first places to go to upgrade tier 2 and 3 entries.

**Coordinates** were not looked up one by one. They are from memory to about 0.01° (roughly 1 km), except where a fetched page gave them (the Wikipedia battle pages, Dunwich, Ravenser Odd, Yeavering, Flag Fen, Danebury, Hengistbury Head, Verulamium, Camulodunum). Good enough for a national map; not for descending into a site.

**Individual dates recalled from memory inside otherwise sourced entries** are flagged in the entry ("from memory").

## Size rubric (`phases[].size`)

Size is rank relative to the largest places in Britain at that date, not population.

| size | meaning | examples |
|---|---|---|
| 5 | among the top three or four places of its day; before towns, a monument complex or settlement of the first rank | Stonehenge 2500 BCE; Maiden Castle 400–100 BCE; Camulodunon 20 BCE–43; Londinium; Jorvik; Winchester 880–1150; Norwich 1094–1349 and after 1500; Bristol after 1250; Coventry 1331–1520 |
| 4 | roughly top ten: regional capital, legionary fortress, major wic, leading port, greatest abbeys | Wroxeter 90–300; Chester fortress; Hamwic; Ipswich; Thetford 1086; Boston and Lynn in the wool boom; Glastonbury, Bury |
| 3 | roughly top thirty: civitas capital, substantial borough, major monastery or royal castle | Silchester; Leicester; Lindisfarne after 793; Shrewsbury; Fountains |
| 2 | small town, auxiliary fort, lesser monastery, significant standing monument | Housesteads; Lewes; Wells; Castlerigg |
| 1 | village, residual occupation, or a monument standing but disused | Roman towns 411–600; Liverpool 1207–1625 |
| 0 | abandoned, site known | Wroxeter after 450; Ravenser Odd after 1362 |

Battles have one single-year phase: 3 = decided who ruled, 2 = other.
Town sizes for 1086, 1377, the 1520s and 1662 follow the tax rankings (top 5 → 5, 6–12 → 4, 13–30 → 3) adjusted by judgement; tax lists measure taxpayers or wealth, not heads. Rankings before 1086 are judgement throughout.

Phases use `kind` overrides where a place changes character (fort → city, monastery → town). A final phase with `to: null` means "continues to 1625".

## Woodland keyframes

Anchored: "half of England cleared by 500 BCE" and "about 15% woodland and wood-pasture in Domesday" (both Rackham, via the Herefordshire page; the 15% also via the OU). 1350 = 8% is a midpoint of secondary reports of Rackham (6–10%), none of which I could fetch directly. All other keyframes are interpolation or convention, and the note in `site.json` says so.

## Polities

Iron Age peoples are labels only, dated −50 to 43 (the window in which Roman sources name them); they continued as civitates. Diocletianic provinces are "conjectural / low". Polygons exist only for Kent (c. 600), Sussex (c. 700), Essex (c. 650), East Anglia (c. 700), Wessex (c. 800), Mercia (c. 790), Northumbria (c. 700, clipped at 56°N), the Danelaw (c. 890) and England (c. 1000); each `note` gives its date. They are hand-drawn at 11–25 vertices from general knowledge of the shire geography and do not follow the coastline closely: the viewer should clip them to land.

## The 15 entries I am least sure of

1. `battle-brunanburh` — location unknown; marker at Bromborough is one candidate of forty.
2. `battle-assandun` — Ashingdon or Ashdon; unsourced.
3. `battle-dyrham` (577) — the Chronicle entry itself may be legend.
4. `plymouth` 1341–1450 at size 4 — follows Russell's anomalous 1377 poll-tax figure (4th in England), which probably counts a fleet.
5. `maxima-caesariensis`, `britannia-prima`, `flavia-caesariensis`, `britannia-secunda`, `valentia` — label positions are the conventional guess; Flavia and Secunda may be the other way round; start date 296 vs c. 312.
6. `wroxeter` end (450) and `silchester` end (600) — both abandonment dates are wide brackets.
7. `dunwich` 630–869 as Dommoc — disputed identification; and its Domesday size.
8. `thornborough-henges`, `castlerigg`, `arbor-low`, `grimspound` — none closely dated.
9. `uffington` — horse start date is the midpoint of a 1380–550 BCE bracket.
10. `cadbury-castle` — all six phase dates from memory.
11. `wirksworth` as Roman Lutudarum — unproven identification.
12. `lindsey`, `elmet`, `dumnonia`, `deira`, `bernicia` — start and end dates are nominal.
13. `winchester` 880–1150 at size 5 and `london` 600–885 at size 4 — relative ranking of London and Winchester before 1000 is judgement; Domesday omits both.
14. `st-albans` 793 abbey foundation (later tradition) and `tamworth` 690 start.
15. Mercia and England polygons — the western (Welsh) and northern edges are the least defensible lines in the dataset; and all Wessex/Mercia earldom end dates.

Also unresolved: English Heritage gives 471 for the Saxon storming of Pevensey where the Chronicle has 491; I kept EH's figure and flagged it.
