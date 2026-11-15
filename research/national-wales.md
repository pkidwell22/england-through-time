# National layer: Wales and linear features — research notes

Files: `data/national/places-wales.json` (70 places), `polities-wales.json` (24), `lines.json` (42 lines, England and Wales), `sources-wales.json` (92 sources, all `wal-`). Compiled 13 November 2026.

## How it was checked

- Every URL in `sources-wales.json` was fetched during this work and returned content. Dates quoted in summaries were read from the fetched text unless the entry's `uncertainty` says "general knowledge".
- A Python check confirms: files parse; ids unique; years are non-zero integers in −4000..1625; phases ordered and non-overlapping (a phase may start in the year the previous one ends, which `validateNational` allows); every cited id exists; every coordinate is inside lat 49.7–56.0, lon −6.5–2.3; no entry without sources is marked `high`.
- Lines, places and polygons were plotted over county outlines and looked at by eye.

## What was verified from fetched sources

- **Cadw visitor pages** (30): foundation or building dates for Flint (1277–84), Rhuddlan (1277), Conwy (1283–87), Castell y Bere (1221–94), Chepstow (1067), Caerphilly (1268), Dolforwyn (1273/1277), Montgomery (c. 1223), Raglan (1435 tower), Tintern (1131, 1269, 1536), Valle Crucis (1201–1537), Neath (1130), Basingwerk (1131), Segontium (AD 77–c. 394), Caerwent (c. AD 75–80), Brecon Gaer (c. AD 75), Criccieth (burnt 1404), Kidwelly, Dolbadarn, Dolwyddelan, Denbigh, St Davids palace (1328–47).
- **Coflein (RCAHMW) records** (27): Tre'r Ceiri, Castell Henllys, Deganwy (812, 822, 1245–50, 1263), Dinefwr, Mathrafal, Aberffraw, Dinas Emrys, Pembroke (c. 1094), Cardiff (c. 1081), Caernarfon (1283–c. 1330), Harlech (1283–89, 1404–09, 1468), Beaumaris (1295), Strata Florida (1164, 1201, 1539), Margam (c. 1147–1536), Swansea (1106), Haverfordwest (c. 1110), Nidum (phases AD 75–320), Canovium, Tomen y Mur, Sycharth (burnt 1403), Wat's Dyke, and the Battlefields Inventory records for Mynydd Carn, Crug Mawr, Irfon/Orewin Bridge and Bryn Glas (grid references converted to latitude/longitude here).
- **Dictionary of Welsh Biography** (11 articles): Rhodri Mawr (844, 855, 872, d. 877), Hywel Dda (920, 942, d. 950), Gruffudd ap Llywelyn (1039, 1055; death 1064 in the revised article), Gruffudd ap Cynan (1081), Rhys ap Gruffydd (1155–97), Llywelyn ap Iorwerth, Llywelyn ap Gruffydd (1255, 1258, 1267), Owain Glyndŵr (1400, 1404, 1405, not heard of after 1412), Illtud, Deiniol.
- **Pleiades JSON records** (11) for the Roman sites. The HTML pages are behind a bot check, so the `/json` URL of each record is cited; that is what was read.
- Museum Wales (Llangorse crannog: felled AD 889–893, destroyed 916), University of Liverpool (Great Orme: c. 1700–900 BC, boom c. 1600–1400 BC), English Heritage (Hadrian's Wall; Offa's Dyke), Offa's Dyke Association (scientific dating summary), legislation.gov.uk (Laws in Wales Acts 1535 and 1542), Bodleian law guide (Statute of Rhuddlan 1284), National Trails (Ridgeway).

## What could not be verified

- **Historic England list entries** returned HTTP 403 to every fetch. Devil's Dyke (Cambridgeshire) and both parts of Wansdyke therefore have no sources, low confidence, and say so.
- **Zenodo landing pages** returned 403; the Zenodo API record URLs, which were fetched, are cited instead.
- No source was fetched for: Llyn Cerrig Bach, Llandaff, Dinas Powys, Castell Dinas Brân, Brecon, Wrexham, Monmouth, Machynlleth, the Deceangli, Ceredigion, Glywysing, the Great North Road. These have empty `sources`, confidence capped at medium, and the reliance on general knowledge is stated.
- The provisions of the Laws in Wales Acts (new shires, abolition of marcher powers) are summarised from general knowledge; the fetched pages confirm only the acts and their dates.
- Roman road construction dates: no road is dated directly. Each `from` year is an estimate from the foundation dates of the forts and towns on the road, and every road entry says so. `to` is 410 (end of Roman upkeep), with a note that the lines stayed in use.
- Many Cadw pages are short visitor texts; where they give no year (Bryn Celli Ddu, Barclodiad y Gawres, Caernarfon, Beaumaris, Caerleon) the date comes from Coflein, Pleiades or, failing that, general knowledge, as flagged per entry.
- Places asked for but left out or changed: Parys Mountain is included at low confidence (Bronze Age and Roman working are both weakly evidenced). Mathrafal is shown only from c. 1200, because the excavation summarised by Coflein found no early medieval royal site. Dinefwr is likewise shown only from the 12th century. Cardiff and Carmarthen are single entries whose phases run from Roman fort or town to medieval borough.

## Where the line geometry came from

- **Roman roads (31 lines)**: derived from **Itiner-e** (de Soto, Pažout, Brughmans and others, *A high-resolution dataset of roads of the Roman Empire*, static version 2024, doi:10.5281/zenodo.17122148, **CC BY 4.0**), using the Britain subset republished in T. Hotham, *How Roman is your road? Data and code*, doi:10.5281/zenodo.23673516 (file `data_itinere_gb.geojson`, 1,398 segments, CC BY 4.0). Method: build a graph from the segments (ends snapped within 250 m), find the shortest network path between named waypoints (the towns and forts on each road, positions from general knowledge), then Douglas–Peucker simplify to 8–35 vertices (tolerance about 0.004–0.007°, i.e. roughly 300–700 m). Attribution to Itiner-e is required when the data are shown.
  - Caveats: Itiner-e classes nearly all British roads as "Conjectured" (lines joining known stretches); the republishing author reports the British coordinates sit about 100 m east of true (a datum issue), which is below the simplification tolerance and was not corrected.
  - Not from the dataset: Neath–Loughor–Carmarthen (no link in the network; drawn straight between the three forts) and the Slack–Tadcaster end of the Chester–York road (no agreed line; left undrawn).
  - The **Military Way** is not in the dataset: it is the Hadrian's Wall fort line shifted 0.003° south so that it displays separately.
- **Hadrian's Wall**: through the positions of its sixteen forts, from general knowledge; cuts corners by up to about 1 km. The Antonine Wall is outside the map (north of 56.0° N) and is noted, not drawn.
- **Offa's Dyke, Wat's Dyke, Wansdyke, Devil's Dyke, Ridgeway, Great North Road**: hand-built from the known course through named places, from general knowledge. Good to about 1 km (dykes) or a few km (Great North Road, straight between towns).
- **England–Wales border**: the modern boundary, taken as the edge shared by Welsh and English counties in ONS 2025 boundaries (Open Government Licence v3; via `data_counties.geojson` in the same Zenodo record), simplified to 64 vertices, with the two estuary ends added by hand. Shown from 1536.
- **Polity polygons**: hand-drawn, 6–31 vertices, each with its reference date in `note`. They are indications only and partly run over water (Anglesey, Cardigan Bay); the renderer should clip them to land or treat them as soft areas.

## Conventions used

- `size` is relative to the largest places in Britain at the time: only Caerleon's legionary fortress reaches 4; St Davids, Caerwent, Caernarfon, the Great Orme boom and the short-lived fortress at Usk are 3; almost everything else is 1–2. `0` marks a site known but out of use.
- Battles are single-year phases. Place markers for castles that had boroughs carry both in one phase label.
- "Placeholder" in an `uncertainty` field means the year stands for a phrase such as "late 12th century" in the source.

## Ten least certain entries

1. **Parys Mountain** (place): Bronze Age mining dates recalled, not fetched; Roman mining inferred only from ingots.
2. **Battle of Mynydd Carn 1081** (place): battlefield unlocated; marker uses one suggested grid reference.
3. **Mathrafal** (place): the "court of Powys" tradition is 13th-century; excavation found nothing early.
4. **Wat's Dyke** (line): date anywhere from the 5th to the 9th century; hand-drawn course.
5. **East and West Wansdyke** and **Devil's Dyke** (lines): no fetched source, nominal dates, hand-drawn.
6. **Sarn Helen** (lines): long inferred stretches; the network path between forts is the weakest road geometry in the file.
7. **Ridgeway** (line): a continuous prehistoric through-route is doubted; the −3000 start is nominal.
8. **Principality of Wales 1267** (polity polygon): southern and eastern edges contested; a rough outline.
9. **Seisyllwg and Ceredigion** (polities): traditional dates; the name Seisyllwg may be a later coinage.
10. **Offa's Dyke, lower Wye section** (line): whether it belongs to Offa's Dyke at all is disputed. Also uncertain: **Dolaucothi** (no dated start or end), **Aberffraw** and **Dinas Emrys** (placeholder dates), **Battle of Bryn Derwin** (site not located), and the Iron Age peoples' `from` date of −100, which is a projection back from 1st-century AD sources.
