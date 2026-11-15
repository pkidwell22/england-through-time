# National layer, England: verification and sourcing pass on places.json

Date of pass: 13 November 2026. Scope: `data/national/places.json` (173 places) and `data/national/sources-england.json`. Raw responses are cached under `research/raw-gazetteer/` (`wikidata/`, `pleiades/`, `historic-england/`, `battlefields-trust/`, `pages/`).

## Summary

- Coordinates: all 173 checked against at least one gazetteer. 15 moved, 158 left as they were. The earlier coordinates were better than the build log suggested: 145 of 173 were already within 0.3 km of the nearest gazetteer point.
- Sources: 95 places now cite at least one non-Wikipedia source (was 28); 36 cite Wikipedia only; 42 cite nothing. `sources-england.json` grew from 67 to 150 entries, every URL fetched in this pass or the previous one.
- Dates: 11 phase-date corrections, 4 anachronism or plausibility fixes, 15 confidence changes.
- Validation (see end): passes.

## Method

1. Each place was tied to a Wikidata item by English Wikipedia title (resolved through redirects with the MediaWiki API, then `wbgetentities`, property P625). Where a place has a Roman phase, the Roman-site item was also resolved and its Pleiades id (P1584) followed to `pleiades.stoa.org/places/<id>/json` (`reprPoint`).
2. Battles were checked against the Historic England NHLE open-data Registered Battlefields layer (polygon centroid and point-in-polygon test) and against the grid reference on the Battlefields Trust page, converted from OSGB36 to WGS84.
3. Thresholds: point sites moved when more than about 0.2 km from the gazetteer point(s); towns when more than 1 km from every candidate (modern town item, Roman-town item, historic-core landmark). Battles moved when more than 0.2 km from both the registered-battlefield centroid and the Battlefields Trust reference.
4. Where gazetteers disagree with each other, or the gazetteer point is plainly a different thing (island centroid, modern civic centre, sign error), nothing was changed and the case is listed under "Ambiguous".

## Coordinates moved

| id | old | new | moved | basis |
|---|---|---|---|---|
| battle-bosworth | 52.591, -1.410 | 52.5840, -1.4186 | 0.97 km | Battlefields Trust grid ref SP394986 (inside Historic England registered battlefield 1000004) |
| catterick | 54.378, -1.640 | 54.3842, -1.6497 | 0.93 km | Wikidata Q15949391; Pleiades 89143 within 0.46 km |
| battle-stamford-bridge | 53.993, -0.913 | 53.9869, -0.9034 | 0.92 km | Historic England registered battlefield 1000035 centroid; Battlefields Trust grid ref within 0.05 km |
| langdale-axe-factory | 54.455, -3.110 | 54.4559, -3.1229 | 0.84 km | Wikidata Q7193630 (Pike of Stickle) |
| water-newton | 52.565, -0.360 | 52.5599, -0.3512 | 0.82 km | Wikidata Q1267429; Pleiades 79432 within 0.26 km |
| battle-stoke-field | 53.037, -0.888 | 53.0336, -0.8946 | 0.58 km | Historic England registered battlefield 1000036 centroid; Battlefields Trust grid ref within 0.23 km |
| battle-flodden | 55.627, -2.176 | 55.6270, -2.1671 | 0.56 km | Historic England registered battlefield 1000011 centroid; Battlefields Trust grid ref within 0.06 km |
| battle-lewes | 50.878, -0.020 | 50.8818, -0.0148 | 0.56 km | Historic England registered battlefield 1000018 centroid; Battlefields Trust grid ref within 0.26 km |
| battle-shrewsbury | 52.749, -2.722 | 52.7502, -2.7294 | 0.52 km | Historic England registered battlefield 1000033 centroid; Battlefields Trust grid ref within 0.35 km |
| battle-tewkesbury | 51.986, -2.161 | 51.9819, -2.1635 | 0.49 km | Historic England registered battlefield 1000039 centroid; Battlefields Trust grid ref within 0.26 km |
| battle-standard | 54.373, -1.447 | 54.3766, -1.4441 | 0.44 km | Historic England registered battlefield 1000027 centroid; Battlefields Trust grid ref within 0.06 km |
| glastonbury-lake-village | 51.163, -2.722 | 51.1639, -2.7265 | 0.33 km | Wikidata Q5567227 |
| battle-otterburn | 55.238, -2.196 | 55.2397, -2.1919 | 0.32 km | Historic England registered battlefield 1000029 centroid; Battlefields Trust grid ref within 0.03 km |
| battle-maldon | 51.715, 0.701 | 51.7177, 0.7021 | 0.31 km | Historic England registered battlefield 1000019 centroid; Battlefields Trust grid ref within 0.09 km |
| brough-on-humber | 53.727, -0.573 | 53.7280, -0.5760 | 0.23 km | Wikidata Q7179412 |

## Ambiguous or deliberately unchanged

- `hengistbury-head`: Headland item (Q139672098) is a 1.5 km feature; marker is on the harbour side where the Iron Age port lay.
- `stanwick`: 300 ha earthwork; Wikidata and Pleiades (267388585) disagree by 0.6 km and the marker sits between them.
- `charterhouse`: Wikidata (0.26 km) and Pleiades (0.14 km) differ by 0.22 km; marker is within 150 m of Pleiades.
- `lindisfarne`: Wikidata Q213804 is the island centroid, 1.2 km from the priory; no separate priory item resolved. Marker is on the priory ruins.
- `ravenser-odd`: Lost to the sea; Wikidata puts it 3 km east of the marker, off Spurn. No surveyed position exists.
- `battle-edington`: Wikidata point is 21 km north (near Chippenham). Site is disputed; marker is at Bratton Camp above Edington.
- `battle-brunanburh`: Unlocated. Wikidata point (near Burnley) is one candidate, the marker (Bromborough) another.
- `battle-st-albans-1455`: Wikidata longitude has the wrong sign (+0.339). Battlefields Trust grid reference TL 14781 07254 is 40 m from the marker.
- `battle-assandun`: Unlocated (Ashingdon or Ashdon); Wikidata point is 0.4 km from the marker at Ashingdon.
- `battle-barnet`: 0.37 km north of the registered-battlefield centroid and Battlefields Trust reference; battlefield not located, marker left between the two candidate areas (site link kept).
- `battle-dyrham`: Not a registered battlefield; location follows the place-name. Wikidata point 0.25 km away.
- `battle-ellendun`: Not located; Wikidata point 0.22 km away.
- `battle-hastings`: Inside the registered battlefield, 0.16 km from its centroid; 0.28 km from the Wikidata point (the abbey).
- `battle-evesham`: Inside the registered battlefield, 0.14 km from its centroid.
- `battle-nevilles-cross`: Inside the registered battlefield, 0.10 km from its centroid.
- `battle-towton`: Inside the registered battlefield; 40 m from the Battlefields Trust reference, 0.31 km from the polygon centroid.
- `brough-on-humber`: Pleiades 79639 is 4.5 km south (in the Humber: low-precision atlas point); Wikidata used.
- `dover`: Pleiades 79646 (Portus Dubris) is a rough harbour point 1.3 km away; marker matches Wikidata Dubris and Dover Castle within 0.1 km.
- `chichester`: Pleiades 79622 is 0.7 km west of the walled city; Wikidata agrees with the marker.
- `london`: Marker is at London Bridge/the City, 0.5-0.6 km from the Londinium items; the Wikidata item for modern London (Charing Cross) is 2.8 km west and was not used.
- `st-albans`: Marker is on Verulamium (0.07 km); the medieval abbey and town lie 0.8-1.3 km east. One marker serves both.
- `southampton`: Marker is on Hamwic/medieval town; Roman Clausentum (Bitterne) is 1.7 km north-east.
- `jarrow`: Marker is St Paul's, Jarrow (Q17540662, 0.05 km); the joint abbey item Q2101170 is placed at Wearmouth, 9.7 km away.
- `langdale-axe-factory`: The 'Langdale axe industry' item (Q4271276) sits 3 km east in the valley; Pike of Stickle (Q7193630), named in the phase label, was used instead.

## Date corrections

- `castlerigg`: stone circle start -3000 -> -2500 (EH: probably built about 4,500 years ago)
- `west-kennet-long-barrow`: tomb closed -2500 -> -2000 (EH: built around 3650 BC, closed around 2000 BC)
- `windmill-hill`: end of use -3300 -> -2500 (EH: built around 3675 BC, in use until around 2500 BC)
- `grimspound`: range -1450..-701 -> -1500..-801 (EH: probably late Bronze Age, about 1500-800 BC)
- `aldborough`: start 100 -> 70, planned town from 120 (EH: trading settlement around AD 70, planned town around AD 120)
- `thetford`: priory phase now ends 1540 not 1539 (surrendered 16 Feb 1540); label gives the 1103-4 foundation
- `berwick`: rampart dates 1558-70 -> 1558-69 (EH)
- `chester`: Twentieth Legion arrival about 88 -> about 90 (VCH Cheshire)
- `colchester`: fortress start 43 -> 44 (VCH Essex: work began c. 44)
- `peterborough`: abbey ends 1539 not 1540 (VCH: surrendered 29 Nov 1539)
- `rochester`: Norman cathedral phase 1088 -> 1080 (VCH Kent: Gundulf rebuilt the church and introduced monks in 1080)

## Anachronism and plausibility sweep (all 173)

Checked by script: `to` before `from`; overlapping phases; any phase whose effective kind is `castle` before 1066 or `cathedral` before 597; alternative names dated outside the place's phases; battles with other than one single-year phase. Then read through by eye for cathedral, castle, borough and legion dates and for sizes out of line with the tax rankings the file itself cites. Changes:

- `coventry`: size after 1520 was 3 although the cited table ranks it 5th in the 1520s: now 4 for 1521-1600, 3 from 1601
- `wells`: not a bishop's seat 1088-c.1245: phase split at 1088 (VCH Somerset)
- `ely`: 870-969 abandoned phase inherited kind "cathedral" 240 years before the see: now "monastery"
- `scarborough`: 411-1129 phase inherited kind "castle" before any castle existed: now "other"
- `castlerigg`: summary no longer calls it "one of the earliest stone circles in Britain" (English Heritage does not support that).
- `battle-standard`: summary now gives the day (22 August 1138).

Looked at and left: `durham` is kind `cathedral` from 995 (correct: the see moved there with the shrine); `dunwich` 630-869 is kind `cathedral` only as the "possible site of Dommoc" and is flagged; `bamburgh`, `warwick`, `corfe`, `pevensey`, `portchester` and `tamworth` already override the kind before 1066; `plymouth` at size 4 for 1341-1450 follows an anomalous poll-tax figure and stays flagged "low". `reading` (11th by tax in the 1520s) and `colchester` (12th) are size 3 where the rubric would allow 4; left as judgement.

## Confidence changes

- `castlerigg`: medium -> low (never dated by excavation; the previous "one of the earliest circles" claim is not supported by English Heritage)
- `west-kennet-long-barrow`: medium -> high (both phase dates are English Heritage figures)
- `windmill-hill`: medium -> high (both phase dates are English Heritage figures)
- `thornborough-henges`: low -> medium (EH supports the 3000-2500 BCE construction bracket)
- `corbridge`: medium -> high (phase dates match the English Heritage history)
- `reculver`: medium -> high (phase dates match the English Heritage history)
- `ely`: medium -> high (all phase dates confirmed by VCH)
- `furness`: medium -> high (both phase dates match the English Heritage history)
- `battle-lewes`: medium -> high (Battlefields Trust: date confirmed; location "securely located on the north side of the town")
- `battle-nevilles-cross`: medium -> high (Battlefields Trust: date confirmed; location "accurately located north of Neville's Cross")
- `battle-shrewsbury`: medium -> high (Battlefields Trust: date confirmed; location "securely located west of St Mary Magdalene's church at Battlefield")
- `battle-towton`: medium -> high (Battlefields Trust: date confirmed; location "securely located between Saxton and Towton")
- `battle-tewkesbury`: medium -> high (Battlefields Trust: date confirmed; location "securely located south of Tewkesbury")
- `battle-st-albans-1455`: medium -> high (Battlefields Trust: date confirmed; location "securely located among the streets of the city centre")
- `battle-flodden`: medium -> high (Battlefields Trust: date confirmed; location "securely located in the fields south of Branxton")

## Sources added (all fetched in this pass)

- `nat-eh-thornborough`: History of Thornborough Henges. English Heritage. https://www.english-heritage.org.uk/visit/places/thornborough-henges/history/
- `nat-eh-stanwick`: History of Stanwick Iron Age Fortifications. English Heritage. https://www.english-heritage.org.uk/visit/places/stanwick-iron-age-fortifications/history/
- `nat-eh-aldborough`: History of Aldborough Roman Site. English Heritage. https://www.english-heritage.org.uk/visit/places/aldborough-roman-site/history/
- `nat-eh-corbridge`: History of Corbridge Roman Town. English Heritage. https://www.english-heritage.org.uk/visit/places/corbridge-roman-town-hadrians-wall/history-and-stories/history/
- `nat-eh-portchester`: History of Portchester Castle. English Heritage. https://www.english-heritage.org.uk/visit/places/portchester-castle/history-and-stories/history/
- `nat-eh-castlerigg`: History of Castlerigg Stone Circle. English Heritage. https://www.english-heritage.org.uk/visit/places/castlerigg-stone-circle/history/
- `nat-eh-west-kennet`: History of West Kennet Long Barrow. English Heritage. https://www.english-heritage.org.uk/visit/places/west-kennet-long-barrow/history/
- `nat-eh-windmill-hill`: History of Windmill Hill. English Heritage. https://www.english-heritage.org.uk/visit/places/windmill-hill/history/
- `nat-eh-grimspound`: History of Grimspound. English Heritage. https://www.english-heritage.org.uk/visit/places/grimspound/history/
- `nat-eh-uffington`: History of Uffington Castle, White Horse and Dragon Hill. English Heritage. https://www.english-heritage.org.uk/visit/places/uffington-castle-white-horse-and-dragon-hill/history/
- `nat-eh-furness`: History of Furness Abbey. English Heritage. https://www.english-heritage.org.uk/visit/places/furness-abbey/history/
- `nat-eh-carlisle-castle`: History of Carlisle Castle. English Heritage. https://www.english-heritage.org.uk/visit/places/carlisle-castle/history/
- `nat-eh-scarborough`: History of Scarborough Castle. English Heritage. https://www.english-heritage.org.uk/visit/places/scarborough-castle/history/
- `nat-eh-reculver`: History of Reculver Towers and Roman Fort. English Heritage. https://www.english-heritage.org.uk/visit/places/reculver-towers-and-roman-fort/history/
- `nat-eh-st-augustines`: History of St Augustine’s Abbey. English Heritage. https://www.english-heritage.org.uk/visit/places/st-augustines-abbey/history-and-stories/history/
- `nat-eh-hadrians-wall`: History of Hadrian’s Wall. English Heritage. https://www.english-heritage.org.uk/visit/places/hadrians-wall/hadrians-wall-history-and-stories/history/
- `nat-eh-thetford-priory`: History of Thetford Priory. English Heritage. https://www.english-heritage.org.uk/visit/places/thetford-priory/history/
- `nat-eh-berwick`: History of Berwick-Upon-Tweed Castle, Main Guard and Ramparts. English Heritage. https://www.english-heritage.org.uk/visit/places/berwick-upon-tweed-castle-and-ramparts/history/
- `nat-eh-cirencester-amphitheatre`: History of Cirencester Amphitheatre. English Heritage. https://www.english-heritage.org.uk/visit/places/cirencester-amphitheatre/history/
- `nat-eh-lincoln-bishops-palace`: History of Lincoln Medieval Bishops’ Palace. English Heritage. https://www.english-heritage.org.uk/visit/places/lincoln-medieval-bishops-palace/history/
- `nat-eh-chester-amphitheatre`: History of Chester Roman Amphitheatre. English Heritage. https://www.english-heritage.org.uk/visit/places/chester-roman-amphitheatre/history/
- `nat-eh-framlingham`: Framlingham Castle: History and Stories. English Heritage. https://www.english-heritage.org.uk/visit/places/framlingham-castle/history/
- `nat-eh-tintagel`: History of Tintagel Castle. English Heritage. https://www.english-heritage.org.uk/visit/places/tintagel-castle/history-and-legend/history/
- `nat-eh-birdoswald`: History of Birdoswald Roman Fort. English Heritage. https://www.english-heritage.org.uk/visit/places/birdoswald-roman-fort-hadrians-wall/history-and-stories/history/
- `nat-eh-richmond`: History of Richmond Castle. English Heritage. https://www.english-heritage.org.uk/visit/places/richmond-castle/history-and-stories/history/
- `nat-eh-jewry-wall`: History of Jewry Wall, Leicester. English Heritage. https://www.english-heritage.org.uk/visit/places/jewry-wall/history/
- `nat-eh-yarmouth-rows`: History of Great Yarmouth Row Houses. English Heritage. https://www.english-heritage.org.uk/visit/places/great-yarmouth-row-houses-and-greyfriars-cloisters/history/
- `nat-eh-burgh-castle`: History of Burgh Castle Roman Fort. English Heritage. https://www.english-heritage.org.uk/visit/places/burgh-castle/history/
- `nat-eh-st-albans-wall`: History of Roman Wall, St Albans. English Heritage. https://www.english-heritage.org.uk/visit/places/roman-wall-of-st-albans/history/
- `nat-eh-london-wall`: History of London Wall. English Heritage. https://www.english-heritage.org.uk/visit/places/london-wall/history/
- `nat-londonmuseum-roman-timeline`: A timeline of Roman London: Londinium from start to end. London Museum. https://www.londonmuseum.org.uk/collections/london-stories/timeline-roman-london-londinium/
- `nat-vch-colchester-roman`: Iron-Age and Roman Colchester (Victoria County History, essex vol9 pp2-18). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/essex/vol9/pp2-18
- `nat-vch-colchester-medieval`: Medieval Colchester: Introduction (Victoria County History, essex vol9 pp19-26). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/essex/vol9/pp19-26
- `nat-vch-chester-roman`: Roman Chester (Victoria County History, ches vol5 pt1 pp9-15). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/ches/vol5/pt1/pp9-15
- `nat-vch-chester-early-medieval`: Early medieval Chester 400-1230 (Victoria County History, ches vol5 pt1 pp16-33). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/ches/vol5/pt1/pp16-33
- `nat-vch-york-pre-conquest`: Before the Norman Conquest (Victoria County History, yorks city-of-york pp2-24). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/yorks/city-of-york/pp2-24
- `nat-vch-gloucester-intro`: The city of Gloucester: Introduction (Victoria County History, glos vol4 pp1-4). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/glos/vol4/pp1-4
- `nat-vch-gloucester-saxon`: Anglo-Saxon Gloucester: c.680 - 1066 (Victoria County History, glos vol4 pp5-12). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/glos/vol4/pp5-12
- `nat-vch-coventry`: The City of Coventry: Introduction (Victoria County History, warks vol8 pp1-23). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/warks/vol8/pp1-23
- `nat-vch-coventry-priory`: Houses of Benedictine monks: Priory of Coventry (Victoria County History, warks vol2 pp52-59). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/warks/vol2/pp52-59
- `nat-vch-oxford-medieval`: Medieval Oxford (Victoria County History, oxon vol4 pp3-73). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/oxon/vol4/pp3-73
- `nat-vch-hull-medieval`: Medieval Hull (Victoria County History, yorks east vol1 pp11-85). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/yorks/east/vol1/pp11-85
- `nat-vch-cambridge-medieval`: The city of Cambridge: Medieval history (Victoria County History, cambs vol3 pp2-15). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/cambs/vol3/pp2-15
- `nat-vch-lichfield`: Lichfield: History to c.1500 (Victoria County History, staffs vol14 pp4-14). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/staffs/vol14/pp4-14
- `nat-vch-wells-cathedral`: Colleges: The cathedral of Wells (Victoria County History, som vol2 pp162-169). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/som/vol2/pp162-169
- `nat-vch-bath-priory`: Houses of Benedictine monks: The cathedral priory of Bath (Victoria County History, som vol2 pp69-81). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/som/vol2/pp69-81
- `nat-vch-glastonbury-abbey`: Houses of Benedictine monks: The abbey of Glastonbury (Victoria County History, som vol2 pp82-99). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/som/vol2/pp82-99
- `nat-vch-ely-priory`: Houses of Benedictine monks: Abbey and cathedral priory of Ely (Victoria County History, cambs vol2 pp199-210). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/cambs/vol2/pp199-210
- `nat-vch-peterborough-abbey`: Houses of Benedictine monks: The abbey of Peterborough (Victoria County History, northants vol2 pp83-95). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/northants/vol2/pp83-95
- `nat-vch-worcester`: The city of Worcester: Introduction and borough (Victoria County History, worcs vol4 pp376-390). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/worcs/vol4/pp376-390
- `nat-vch-rochester-priory`: Houses of Benedictine monks: The cathedral priory of St Andrew, Rochester (Victoria County History, kent vol2 pp121-126). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/kent/vol2/pp121-126
- `nat-vch-sherborne-abbey`: Houses of Benedictine monks: The abbey of Sherborne (Victoria County History, dorset vol2 pp62-70). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/dorset/vol2/pp62-70
- `nat-vch-bury-abbey`: Houses of Benedictine monks: Abbey of Bury St Edmunds (Victoria County History, suff vol2 pp56-72). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/suff/vol2/pp56-72
- `nat-vch-wallingford`: The borough of Wallingford: Introduction and castle (Victoria County History, berks vol3 pp517-531). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/berks/vol3/pp517-531
- `nat-vch-chichester`: The City of Chichester: Historical introduction (Victoria County History, sussex vol3 pp82-90). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/sussex/vol3/pp82-90
- `nat-vch-durham-priory`: Houses of Benedictine monks: Priory of St Cuthbert, Durham (later Durham cathedral) (Victoria County History, durham vol2 pp86-103). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/durham/vol2/pp86-103
- `nat-vch-norwich-priory`: Houses of Benedictine monks: The cathedral priory of the Holy Trinity, Norwich (Victoria County History, norf vol2 pp317-328). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/norf/vol2/pp317-328
- `nat-vch-beverley`: Medieval Beverley: Beverley and St John (Victoria County History, yorks east vol6 pp2-11). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/yorks/east/vol6/pp2-11
- `nat-vch-salisbury-cathedral`: The cathedral of Salisbury: From the foundation to the fifteenth century (Victoria County History, wilts vol3 pp156-183). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/wilts/vol3/pp156-183
- `nat-vch-winchester-st-swithun`: Houses of Benedictine monks: Priory of St Swithun, Winchester (Victoria County History, hants vol2 pp108-115). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/hants/vol2/pp108-115
- `nat-vch-canterbury-christ-church`: Houses of Benedictine monks: The cathedral priory of the Holy Trinity or Christ Church, Canterbury (Victoria County History, kent vol2 pp113-121). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/kent/vol2/pp113-121
- `nat-vch-thetford-priory`: Houses of Cluniac monks: The priory of St Mary, Thetford (Victoria County History, norf vol2 pp363-369). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/norf/vol2/pp363-369
- `nat-vch-gloucester-abbey`: Houses of Benedictine monks: The abbey of St Peter at Gloucester (Victoria County History, glos vol2 pp53-61). British History Online (Victoria County History). https://www.british-history.ac.uk/vch/glos/vol2/pp53-61
- `nat-bt-standard`: Battlefields Hub: Battle of the Standard. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=32
- `nat-bt-lewes`: Battlefields Hub: Battle of Lewes. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=22
- `nat-bt-evesham`: Battlefields Hub: Battle of Evesham. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=14
- `nat-bt-nevilles-cross`: Battlefields Hub: Battle of Neville's Cross. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=28
- `nat-bt-otterburn`: Battlefields Hub: Battle of Otterburn. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=34
- `nat-bt-shrewsbury`: Battlefields Hub: Battle of Shrewsbury. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=39
- `nat-bt-brunanburh`: Battlefields Hub: Battle of Brunanburh. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=59
- `nat-bt-maldon`: Battlefields Hub: Battle of Maldon. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=23
- `nat-bt-assandun`: Battlefields Hub: Battle of Assandun. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=113
- `nat-bt-fulford`: Battlefields Hub: Battle of Fulford. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=52
- `nat-bt-stamford-bridge`: Battlefields Hub: Battle of Stamford Bridge. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=41
- `nat-bt-hastings`: Battlefields Hub: Battle of Hastings. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=17
- `nat-bt-st-albans-1455`: Battlefields Hub: First Battle of St Albans. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=111
- `nat-bt-towton`: Battlefields Hub: Battle of Towton. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=46
- `nat-bt-barnet`: Battlefields Hub: Battle of Barnet. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=5
- `nat-bt-tewkesbury`: Battlefields Hub: Battle of Tewkesbury. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=45
- `nat-bt-bosworth`: Battlefields Hub: Battle of Bosworth. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=8
- `nat-bt-stoke-field`: Battlefields Hub: Battle of Stoke Field. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=42
- `nat-bt-flodden`: Battlefields Hub: Battle of Flodden. The Battlefields Trust. https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=15
- `nat-he-nhle-battlefields`: National Heritage List for England open data: Registered Battlefields layer (names, list entry numbers and boundaries). Historic England. https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/8/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&geometryPrecision=6&maxAllowableOffset=0.0001&f=json

## What could not be fetched

- Historic England list-entry web pages: not retried (403 for the previous agent). The NHLE open-data ArcGIS service did respond and was used for battlefield names, list entry numbers and boundaries.
- British History Online: about 45 VCH pages were fetched successfully, after which the site began returning 403 to every request (including the Gazetteer of Markets and Fairs to 1516, which would have checked borough and market dates for the medieval ports). Its search page sits behind a browser challenge.
- 403 or bot challenge: British Museum, Portable Antiquities Scheme (finds.org.uk), Open Domesday, History of Parliament (401), Heritage Gateway, National Trust (Radware challenge), Historic Royal Palaces, RAMM Time Trail (Exeter), Corinium Museum, The Novium, York Archaeology, Britannica. Certificate errors: Norfolk Heritage Explorer, Heritage Connect Lincoln.
- English Heritage has no history page at the guessed address for Arbor Low, Durrington Walls, Fountains or Hexham.

## Still unverified

Places with Wikipedia as their only source (36): `flag-fen`, `danebury`, `hengistbury-head`, `exeter`, `ipswich`, `southampton`, `yeavering`, `bamburgh`, `tamworth`, `repton`, `hereford`, `shrewsbury`, `malmesbury`, `athelney`, `wareham`, `shaftesbury`, `lewes`, `hastings`, `derby`, `nottingham`, `stamford`, `northampton`, `warwick`, `bristol`, `plymouth`, `kings-lynn`, `boston`, `dunwich`, `ravenser-odd`, `reading`, `lavenham`, `ludlow`, `battle-dyrham`, `battle-ellendun`, `battle-edington`, `battle-brentford-1016`.

Places with no source (42): `durrington-walls`, `hambledon-hill`, `cissbury`, `langdale-axe-factory`, `arbor-low`, `seahenge`, `must-farm`, `cadbury-castle`, `glastonbury-lake-village`, `fishbourne`, `caistor-st-edmund`, `brough-on-humber`, `water-newton`, `catterick`, `south-shields`, `manchester`, `lancaster`, `charterhouse`, `wirksworth`, `west-stow`, `rendlesham`, `sandwich`, `hexham`, `ripon`, `torksey`, `winchelsea`, `portsmouth`, `dartmouth`, `bodmin`, `walsingham`, `fountains`, `windsor`, `corfe`, `pontefract`, `alnwick`, `clarendon`, `hampton-court`, `nonsuch`, `liverpool`, `leeds`, `birmingham`, `kendal`.

Among the roughly 75 priority places, these still have no non-Wikipedia check of their dates: `durrington-walls`, `danebury`, `hengistbury-head`, `exeter`, `caistor-st-edmund`, `dorchester`, `brough-on-humber`, `ipswich`, `southampton` (Hamwic), `glastonbury` beyond the foundation tradition, `hereford`, `bristol`, `kings-lynn`, `boston`, `dunwich`, `plymouth`, and four battles (`battle-dyrham`, `battle-ellendun`, `battle-edington`, `battle-brentford-1016`). The Roman phases of `lincoln`, `gloucester`, `winchester`, `canterbury`, `chichester` and `cirencester` also rest on Wikipedia; only their later dates were checked. Town sizes throughout remain judgement applied to tax rankings reported on Wikipedia (Russell, Darby, Hoskins), which were not seen in the original.

Dates this pass confirmed without change include: Stonehenge 3000/2500 BCE; London 47-50, 60-61, c. 200, 410; Colchester colony c. 49 and 917; York 71, 627, 735, 866, 954; Chester 74 and 907; Gloucester c. 679 and 1541; Lichfield 669; Ely 673, 870, 970, 1109; Peterborough 655, 870, c. 966; Sherborne 705 and 1075; Bury 903 and 1020; Durham 995 and 1093; Lindisfarne 635, 793, 875, 1537; Reculver 669; Carlisle 72 and 1092; Corbridge c. 86 and the 160s; Portchester 285-290 and 904; Pevensey c. 290; Tintagel 5th-7th century and 1233; Furness 1127 and 1537; Berwick 1296 and 1482; Hull 1293; Cambridge 875 and 1209; Oxford 911; Coventry 1043; Salisbury 1220; and the day and year of 19 of the 23 battles.

## Gazetteer record for every place

Distances are from the original coordinate. WD = Wikidata, HE = Historic England registered battlefield, BT = Battlefields Trust.

| id | class | gazetteer ids and distance | old lat, lon | new lat, lon | moved |
|---|---|---|---|---|---|
| stonehenge | point | WD Q39671 (Stonehenge) 0.01 km; Pleiades 509089189 0.22 km | 51.1790, -1.8260 | unchanged | 0 |
| durrington-walls | point | WD Q471738 (Durrington Walls) 0.07 km; Pleiades 99800872 0.17 km | 51.1920, -1.7870 | unchanged | 0 |
| avebury | point | WD Q661855 (Avebury) 0.04 km; Pleiades 834766850 0.04 km | 51.4290, -1.8540 | unchanged | 0 |
| silbury-hill | point | WD Q225896 (Silbury Hill) 0.06 km; Pleiades 943692804 0.04 km | 51.4160, -1.8570 | unchanged | 0 |
| west-kennet-long-barrow | point | WD Q541312 (West Kennet Long Barrow) 0.04 km; Pleiades 882076328 0.06 km | 51.4090, -1.8510 | unchanged | 0 |
| windmill-hill | point | WD Q4348373 (Windmill Hill, Avebury) 0.06 km | 51.4410, -1.8760 | unchanged | 0 |
| hambledon-hill | point | WD Q5644220 (Hambledon Hill) 0.19 km; Pleiades 28868344 0.17 km | 50.9120, -2.2220 | unchanged | 0 |
| cissbury | point | WD Q1093239 (Cissbury Ring) 0.06 km; Pleiades 370546554 0.05 km | 50.8600, -0.3830 | unchanged | 0 |
| langdale-axe-factory | point | WD Q7193630 (Pike of Stickle) 0.84 km | 54.4550, -3.1100 | 54.4559, -3.1229 | 0.84 km |
| castlerigg | point | WD Q1850757 (Castlerigg stone circle) 0.04 km | 54.6030, -3.0980 | unchanged | 0 |
| thornborough-henges | point | WD Q2428964 (Thornborough Henges) 0.11 km | 54.2100, -1.5630 | unchanged | 0 |
| arbor-low | point | WD Q630312 (Arbor Low) 0.11 km; Pleiades 549355650 0.03 km | 53.1690, -1.7620 | unchanged | 0 |
| grimes-graves | point | WD Q638485 (Grime's Graves) 0.14 km | 52.4760, 0.6750 | unchanged | 0 |
| seahenge | point | WD Q606492 (Seahenge) 0.03 km | 52.9680, 0.5210 | unchanged | 0 |
| flag-fen | point | WD Q1356788 (Flag Fen) 0.00 km; Pleiades 535275912 0.09 km | 52.5740, -0.1900 | unchanged | 0 |
| must-farm | point | WD Q22047654 (Must Farm Bronze Age settlement) 0.05 km; Pleiades 492012434 0.10 km | 52.5550, -0.1780 | unchanged | 0 |
| grimspound | point | WD Q928594 (Grimspound) 0.05 km; Pleiades 248025633 0.07 km | 50.6130, -3.8370 | unchanged | 0 |
| uffington | point | WD Q1056493 (Uffington White Horse) 0.04 km; Pleiades 858265770 0.04 km | 51.5780, -1.5670 | unchanged | 0 |
| maiden-castle | point | WD Q1232816 (Maiden Castle, Dorset) 0.00 km; Pleiades 232755444 0.04 km | 50.6950, -2.4700 | unchanged | 0 |
| danebury | point | WD Q677333 (Danebury) 0.12 km; Pleiades 834603595 0.07 km | 51.1370, -1.5380 | unchanged | 0 |
| cadbury-castle | point | WD Q1025082 (Cadbury Castle, Somerset) 0.05 km; Pleiades 859366031 0.02 km | 51.0240, -2.5310 | unchanged | 0 |
| glastonbury-lake-village | point | WD Q5567227 (Glastonbury Lake Village) 0.33 km | 51.1630, -2.7220 | 51.1639, -2.7265 | 0.33 km |
| hengistbury-head | point | WD Q139672098 (Hengistbury Head) 0.44 km | 50.7160, -1.7540 | unchanged | 0 |
| stanwick | point | WD Q15242545 (Stanwick Iron Age Fortifications) 0.34 km; Pleiades 267388585 0.40 km | 54.5020, -1.7220 | unchanged | 0 |
| london | town | WD Q927198 (Londinium) 0.59 km; Pleiades 79574 0.50 km | 51.5090, -0.0870 | unchanged | 0 |
| colchester | town | WD Q630604 (Camulodunum) 0.33 km; Pleiades 79393 0.24 km | 51.8890, 0.8980 | unchanged | 0 |
| st-albans | town | WD Q19861 (Verulamium) 0.07 km; Pleiades 79739 0.38 km | 51.7500, -0.3540 | unchanged | 0 |
| york | town | WD Q958954 (Eboracum) 0.21 km; Pleiades 89175 0.26 km | 53.9600, -1.0820 | unchanged | 0 |
| lincoln | town | WD Q1786557 (Lindum Colonia) 0.01 km; Pleiades 79395 0.10 km | 53.2340, -0.5380 | unchanged | 0 |
| gloucester | town | WD Q170497 (Gloucester) 0.03 km; Pleiades 79394 0.02 km | 51.8650, -2.2460 | unchanged | 0 |
| chester | town | WD Q2450247 (Deva Victrix) 0.20 km; Pleiades 79420 0.26 km | 53.1900, -2.8910 | unchanged | 0 |
| wroxeter | point | WD Q1361580 (Viroconium Cornoviorum) 0.02 km; Pleiades 79741 0.06 km | 52.6740, -2.6440 | unchanged | 0 |
| silchester | point | WD Q1027253 (Calleva Atrebatum) 0.07 km; Pleiades 79368 0.04 km | 51.3570, -1.0820 | unchanged | 0 |
| richborough | point | WD Q1309736 (Richborough Castle) 0.11 km | 51.2930, 1.3320 | unchanged | 0 |
| canterbury | town | WD Q1267451 (Durovernum Cantiacorum) 0.21 km; Pleiades 79439 0.27 km | 51.2800, 1.0800 | unchanged | 0 |
| winchester | town | WD Q538969 (Venta Belgarum) 0.00 km; Pleiades 79734 0.00 km | 51.0630, -1.3170 | unchanged | 0 |
| cirencester | town | WD Q852772 (Cirencester) 0.00 km; Pleiades 79549 0.89 km | 51.7190, -1.9680 | unchanged | 0 |
| bath | town | WD Q2540426 (Roman Baths (Bath)) 0.04 km; Pleiades 79299 0.05 km | 51.3810, -2.3590 | unchanged | 0 |
| exeter | town | WD Q1131208 (Exeter Cathedral) 0.06 km; Pleiades 79531 0.45 km | 50.7220, -3.5300 | unchanged | 0 |
| leicester | town | WD Q6190177 (Jewry Wall) 0.14 km; Pleiades 79651 0.25 km; Pleiades 484576343 0.14 km | 52.6350, -1.1390 | unchanged | 0 |
| chichester | town | WD Q1736182 (Chichester Cathedral) 0.07 km; Pleiades 79622 0.71 km | 50.8360, -0.7800 | unchanged | 0 |
| fishbourne | point | WD Q1247128 (Fishbourne Roman Palace) 0.05 km; Pleiades 79466 0.03 km | 50.8370, -0.8100 | unchanged | 0 |
| dorchester | town | WD Q683162 (Durnovaria) 0.35 km; Pleiades 79431 0.64 km | 50.7150, -2.4370 | unchanged | 0 |
| caistor-st-edmund | point | WD Q1407535 (Venta Icenorum) 0.09 km; Pleiades 79735 0.09 km | 52.5830, 1.2920 | unchanged | 0 |
| aldborough | point | WD Q3362320 (Aldborough, North Yorkshire) 0.13 km; Pleiades 89209 0.18 km | 54.0920, -1.3820 | unchanged | 0 |
| carlisle | town | WD Q1876046 (Luguvalium) 0.00 km; Pleiades 89234 0.12 km | 54.8950, -2.9370 | unchanged | 0 |
| brough-on-humber | point | WD Q990921 (Brough, East Riding of Yorkshire) 0.12 km; Pleiades 79639 4.52 km | 53.7270, -0.5730 | 53.7280, -0.5760 | 0.23 km |
| water-newton | point | WD Q1267429 (Durobrivae (Water Newton)) 0.83 km; Pleiades 79432 1.08 km | 52.5650, -0.3600 | 52.5599, -0.3512 | 0.82 km |
| catterick | point | WD Q15949391 (Cataractonium) 0.93 km; Pleiades 89143 1.40 km | 54.3780, -1.6400 | 54.3842, -1.6497 | 0.93 km |
| corbridge | point | WD Q3819299 (Coria (Corbridge)) 0.03 km; Pleiades 89152 0.05 km | 54.9780, -2.0300 | unchanged | 0 |
| vindolanda | point | WD Q1233131 (Vindolanda) 0.12 km; Pleiades 89313 0.06 km | 54.9910, -2.3610 | unchanged | 0 |
| housesteads | point | WD Q1812832 (Housesteads Roman Fort) 0.00 km; Pleiades 89311 0.06 km | 55.0130, -2.3310 | unchanged | 0 |
| chesters | point | WD Q3818331 (Cilurnum) 0.00 km; Pleiades 89144 0.05 km | 55.0260, -2.1390 | unchanged | 0 |
| birdoswald | point | WD Q2061016 (Banna (Birdoswald)) 0.08 km; Pleiades 89109 0.07 km | 54.9900, -2.6020 | unchanged | 0 |
| south-shields | point | WD Q1131391 (Arbeia) 0.05 km; Pleiades 89104 0.05 km | 55.0040, -1.4310 | unchanged | 0 |
| dover | town | WD Q2105460 (Dubris) 0.06 km; Pleiades 79646 1.27 km; Pleiades 973289406 0.04 km | 51.1290, 1.3230 | unchanged | 0 |
| portchester | point | WD Q732249 (Portchester Castle) 0.09 km; Pleiades 607646886 0.03 km; Pleiades 79645 0.07 km | 50.8370, -1.1140 | unchanged | 0 |
| pevensey | point | WD Q2970215 (Pevensey Castle) 0.07 km; Pleiades 79293 0.01 km | 50.8190, 0.3340 | unchanged | 0 |
| burgh-castle | point | WD Q1309569 (Gariannonum) 0.11 km; Pleiades 79475 0.07 km | 52.5830, 1.6520 | unchanged | 0 |
| reculver | point | WD Q1735409 (Regulbium) 0.00 km; Pleiades 79654 0.02 km | 51.3790, 1.2000 | unchanged | 0 |
| rochester | town | WD Q2635720 (Rochester Cathedral) 0.04 km; Pleiades 79433 0.08 km | 51.3890, 0.5030 | unchanged | 0 |
| manchester | town | WD Q3285089 (Mamucium) 0.13 km; Pleiades 79590 0.28 km | 53.4750, -2.2500 | unchanged | 0 |
| lancaster | town | WD Q205905 (Lancaster, Lancashire) 0.16 km; Pleiades 902277617 0.15 km | 54.0500, -2.8030 | unchanged | 0 |
| charterhouse | point | WD Q1067843 (Charterhouse Roman Town) 0.26 km; Pleiades 79534 0.14 km | 51.3000, -2.7160 | unchanged | 0 |
| wirksworth | town | WD Q1612220 (Wirksworth) 0.35 km | 53.0820, -1.5740 | unchanged | 0 |
| tintagel | point | WD Q934922 (Tintagel Castle) 0.13 km | 50.6680, -4.7590 | unchanged | 0 |
| west-stow | point | WD Q7986591 (West Stow Anglo-Saxon Village) 0.13 km | 52.3110, 0.6370 | unchanged | 0 |
| sutton-hoo | point | WD Q503256 (Sutton Hoo) 0.10 km | 52.0890, 1.3380 | unchanged | 0 |
| rendlesham | town | WD Q2402451 (Rendlesham) 0.35 km | 52.1270, 1.4150 | unchanged | 0 |
| ipswich | town | WD Q184775 (Ipswich) 0.27 km | 52.0570, 1.1550 | unchanged | 0 |
| southampton | town | WD Q79848 (Southampton) 0.55 km | 50.9050, -1.3970 | unchanged | 0 |
| sandwich | town | WD Q26163 (Sandwich, Kent) 0.08 km | 51.2750, 1.3400 | unchanged | 0 |
| yeavering | point | WD Q3039629 (Yeavering) 0.06 km | 55.5670, -2.1020 | unchanged | 0 |
| bamburgh | point | WD Q2026185 (Bamburgh Castle) 0.07 km | 55.6090, -1.7100 | unchanged | 0 |
| lindisfarne | point | WD Q213804 (Lindisfarne Priory) 1.23 km | 55.6690, -1.8010 | unchanged | 0 |
| jarrow | point | WD Q17540662 (St Paul's Church, Jarrow) 0.05 km | 54.9800, -1.4720 | unchanged | 0 |
| whitby | point | WD Q1469493 (Whitby Abbey) 0.03 km | 54.4880, -0.6080 | unchanged | 0 |
| hexham | point | WD Q950037 (Hexham Abbey) 0.08 km | 54.9720, -2.1020 | unchanged | 0 |
| ripon | point | WD Q638466 (Ripon Cathedral) 0.07 km | 54.1350, -1.5210 | unchanged | 0 |
| durham | point | WD Q746207 (Durham Cathedral) 0.05 km | 54.7730, -1.5760 | unchanged | 0 |
| beverley | town | WD Q851660 (Beverley Minster) 0.09 km | 53.8400, -0.4250 | unchanged | 0 |
| tamworth | town | WD Q704864 (Tamworth, Staffordshire) 0.01 km | 52.6340, -1.6950 | unchanged | 0 |
| repton | town | WD Q7592163 (St Wystan's Church, Repton) 0.05 km | 52.8410, -1.5510 | unchanged | 0 |
| torksey | town | WD Q574397 (Torksey) 0.50 km | 53.3030, -0.7440 | unchanged | 0 |
| lichfield | point | WD Q510389 (Lichfield Cathedral) 0.07 km | 52.6860, -1.8310 | unchanged | 0 |
| worcester | town | WD Q1630367 (Worcester Cathedral) 0.04 km | 52.1890, -2.2210 | unchanged | 0 |
| hereford | town | WD Q204720 (Hereford) 0.04 km | 52.0560, -2.7160 | unchanged | 0 |
| shrewsbury | town | WD Q201970 (Shrewsbury) 0.03 km | 52.7080, -2.7540 | unchanged | 0 |
| glastonbury | point | WD Q544113 (Glastonbury Abbey) 0.05 km | 51.1460, -2.7160 | unchanged | 0 |
| malmesbury | point | WD Q550064 (Malmesbury Abbey) 0.04 km | 51.5850, -2.0980 | unchanged | 0 |
| sherborne | point | WD Q1262119 (Sherborne Abbey) 0.02 km | 50.9470, -2.5170 | unchanged | 0 |
| wells | point | WD Q519614 (Wells Cathedral) 0.10 km | 51.2100, -2.6450 | unchanged | 0 |
| athelney | point | WD Q4813330 (Athelney Abbey) 0.04 km | 51.0590, -2.9350 | unchanged | 0 |
| wallingford | town | WD Q988100 (Wallingford, Oxfordshire) 0.11 km | 51.6000, -1.1250 | unchanged | 0 |
| wareham | town | WD Q387419 (Wareham, Dorset) 0.18 km | 50.6860, -2.1100 | unchanged | 0 |
| shaftesbury | town | WD Q1128802 (Shaftesbury Abbey) 0.05 km | 51.0050, -2.1980 | unchanged | 0 |
| lewes | town | WD Q386703 (Lewes Castle) 0.19 km | 50.8730, 0.0100 | unchanged | 0 |
| hastings | town | WD Q29245 (Hastings) 0.73 km | 50.8560, 0.5730 | unchanged | 0 |
| oxford | town | WD Q1035968 (Carfax, Oxford) 0.00 km | 51.7520, -1.2580 | unchanged | 0 |
| cambridge | town | WD Q350 (Cambridge) 0.42 km; Pleiades 79436 0.90 km | 52.2050, 0.1190 | unchanged | 0 |
| norwich | town | WD Q1672292 (Norwich Castle) 0.02 km | 52.6280, 1.2970 | unchanged | 0 |
| thetford | town | WD Q237250 (Thetford) 0.41 km | 52.4120, 0.7450 | unchanged | 0 |
| bury-st-edmunds | point | WD Q334286 (Bury St Edmunds Abbey) 0.15 km | 52.2440, 0.7170 | unchanged | 0 |
| ely | point | WD Q579004 (Ely Cathedral) 0.14 km | 52.3990, 0.2620 | unchanged | 0 |
| peterborough | point | WD Q1259104 (Peterborough Cathedral) 0.07 km | 52.5730, -0.2400 | unchanged | 0 |
| derby | town | WD Q43475 (Derby) 0.04 km | 52.9220, -1.4770 | unchanged | 0 |
| nottingham | town | WD Q41262 (Nottingham) 0.23 km | 52.9530, -1.1500 | unchanged | 0 |
| stamford | town | WD Q1000662 (Stamford, Lincolnshire) 0.47 km | 52.6520, -0.4800 | unchanged | 0 |
| northampton | town | WD Q192240 (Northampton) 0.46 km | 52.2370, -0.8970 | unchanged | 0 |
| warwick | point | WD Q941276 (Warwick Castle) 0.06 km | 52.2800, -1.5850 | unchanged | 0 |
| old-sarum | point | WD Q782719 (Old Sarum) 0.04 km | 51.0930, -1.8050 | unchanged | 0 |
| salisbury | town | WD Q390150 (Salisbury Cathedral) 0.05 km | 51.0650, -1.7970 | unchanged | 0 |
| bristol | town | WD Q4968819 (Bristol Bridge) 0.13 km | 51.4540, -2.5930 | unchanged | 0 |
| coventry | town | WD Q7590394 (St Mary's Priory and Cathedral) 0.11 km | 52.4080, -1.5100 | unchanged | 0 |
| plymouth | town | WD Q43382 (Plymouth) 0.05 km | 50.3710, -4.1420 | unchanged | 0 |
| kings-lynn | town | WD Q157341 (King's Lynn) 0.11 km | 52.7540, 0.3960 | unchanged | 0 |
| boston | town | WD Q7592685 (St Botolph's Church, Boston) 0.09 km | 52.9780, -0.0260 | unchanged | 0 |
| great-yarmouth | town | WD Q237253 (Great Yarmouth) 0.29 km | 52.6070, 1.7290 | unchanged | 0 |
| dunwich | town | WD Q188020 (Dunwich) 0.06 km | 52.2770, 1.6310 | unchanged | 0 |
| ravenser-odd | town | WD Q7296525 (Ravenser Odd) 2.96 km | 53.5860, 0.1140 | unchanged | 0 |
| winchelsea | town | WD Q1026871 (Winchelsea) 0.05 km | 50.9250, 0.7090 | unchanged | 0 |
| hull | town | WD Q128147 (Kingston upon Hull) 0.06 km | 53.7440, -0.3330 | unchanged | 0 |
| newcastle | town | WD Q7721569 (The Castle, Newcastle) 0.03 km; Pleiades 89275 0.02 km | 54.9690, -1.6100 | unchanged | 0 |
| berwick | town | WD Q504678 (Berwick-upon-Tweed) 0.18 km | 55.7700, -2.0050 | unchanged | 0 |
| scarborough | point | WD Q1963850 (Scarborough Castle) 0.06 km; Pleiades 272290638 0.07 km | 54.2870, -0.3890 | unchanged | 0 |
| portsmouth | town | WD Q7084758 (Old Portsmouth) 0.14 km | 50.7900, -1.1070 | unchanged | 0 |
| dartmouth | town | WD Q1007083 (Dartmouth, Devon) 0.08 km | 50.3510, -3.5790 | unchanged | 0 |
| bodmin | town | WD Q889888 (Bodmin) 0.56 km | 50.4710, -4.7190 | unchanged | 0 |
| reading | town | WD Q2482838 (Reading Abbey) 0.04 km | 51.4560, -0.9650 | unchanged | 0 |
| lavenham | town | WD Q1808895 (Lavenham) 0.06 km | 52.1080, 0.7960 | unchanged | 0 |
| walsingham | point | WD Q739666 (Walsingham) 0.03 km | 52.8940, 0.8740 | unchanged | 0 |
| battle-abbey | point | WD Q810981 (Battle Abbey) 0.14 km | 50.9140, 0.4870 | unchanged | 0 |
| fountains | point | WD Q540237 (Fountains Abbey) 0.05 km | 54.1100, -1.5820 | unchanged | 0 |
| rievaulx | point | WD Q1247496 (Rievaulx Abbey) 0.06 km | 54.2570, -1.1170 | unchanged | 0 |
| furness | point | WD Q1475061 (Furness Abbey) 0.06 km | 54.1360, -3.1980 | unchanged | 0 |
| windsor | point | WD Q42646 (Windsor Castle) 0.03 km | 51.4840, -0.6040 | unchanged | 0 |
| kenilworth | point | WD Q1738764 (Kenilworth Castle) 0.13 km | 52.3480, -1.5920 | unchanged | 0 |
| corfe | point | WD Q1236511 (Corfe Castle) 0.01 km | 50.6400, -2.0590 | unchanged | 0 |
| ludlow | point | WD Q576369 (Ludlow Castle) 0.02 km | 52.3670, -2.7230 | unchanged | 0 |
| pontefract | point | WD Q1949590 (Pontefract Castle) 0.06 km | 53.6950, -1.3040 | unchanged | 0 |
| richmond | point | WD Q6645746 (Richmond Castle) 0.10 km | 54.4020, -1.7390 | unchanged | 0 |
| alnwick | point | WD Q1320427 (Alnwick Castle) 0.02 km | 55.4160, -1.7060 | unchanged | 0 |
| framlingham | point | WD Q2524183 (Framlingham Castle) 0.07 km | 52.2240, 1.3470 | unchanged | 0 |
| clarendon | point | WD Q404530 (Clarendon Palace) 0.10 km | 51.0700, -1.7410 | unchanged | 0 |
| hampton-court | point | WD Q205666 (Hampton Court Palace) 0.06 km | 51.4030, -0.3380 | unchanged | 0 |
| nonsuch | point | WD Q769182 (Nonsuch Palace) 0.05 km | 51.3540, -0.2380 | unchanged | 0 |
| liverpool | town | WD Q24826 (Liverpool) 0.03 km | 53.4070, -2.9920 | unchanged | 0 |
| leeds | town | WD Q39121 (Leeds) 0.07 km | 53.7970, -1.5430 | unchanged | 0 |
| birmingham | town | WD Q7594217 (St Martin in the Bull Ring) 0.12 km | 52.4780, -1.8940 | unchanged | 0 |
| kendal | town | WD Q994575 (Kendal) 0.13 km | 54.3270, -2.7460 | unchanged | 0 |
| battle-dyrham | point | WD Q1429157 (Battle of Deorham) 0.25 km | 51.4890, -2.3720 | unchanged | 0 |
| battle-ellendun | point | WD Q1939977 (Battle of Ellendun) 0.22 km | 51.5230, -1.7920 | unchanged | 0 |
| battle-edington | point | WD Q2305651 (Battle of Edington) 20.78 km | 51.2640, -2.1430 | unchanged | 0 |
| battle-brunanburh | point | WD Q2246615 (Battle of Brunanburh) 69.99 km | 53.3360, -2.9800 | unchanged | 0 |
| battle-maldon | point | WD Q1442050 (Battle of Maldon) 0.03 km; HE battlefield 1000019 0.31 km (inside); BT grid ref 0.23 km | 51.7150, 0.7010 | 51.7177, 0.7021 | 0.31 km |
| battle-brentford-1016 | point | WD Q3636352 (Battle of Brentford (1016)) 0.04 km | 51.4790, -0.3070 | unchanged | 0 |
| battle-assandun | point | WD Q1704268 (Battle of Assandun) 0.40 km | 51.6060, 0.6920 | unchanged | 0 |
| battle-fulford | point | WD Q1113659 (Battle of Fulford) 0.17 km; BT grid ref 0.18 km | 53.9310, -1.0710 | unchanged | 0 |
| battle-stamford-bridge | point | WD Q203225 (Battle of Stamford Bridge) 0.06 km; HE battlefield 1000035 0.93 km (outside); BT grid ref 0.91 km | 53.9930, -0.9130 | 53.9869, -0.9034 | 0.92 km |
| battle-hastings | point | WD Q83224 (Battle of Hastings) 0.28 km; HE battlefield 1000013 0.16 km (inside); BT grid ref 0.26 km | 50.9120, 0.4870 | unchanged | 0 |
| battle-standard | point | WD Q1852373 (Battle of the Standard) 0.73 km; HE battlefield 1000027 0.44 km (inside); BT grid ref 0.39 km | 54.3730, -1.4470 | 54.3766, -1.4441 | 0.44 km |
| battle-lewes | point | WD Q2164009 (Battle of Lewes) 0.43 km; HE battlefield 1000018 0.56 km (outside); BT grid ref 0.80 km | 50.8780, -0.0200 | 50.8818, -0.0148 | 0.56 km |
| battle-evesham | point | WD Q1339928 (Battle of Evesham) 0.23 km; HE battlefield 1000010 0.14 km (inside); BT grid ref 0.28 km | 52.1060, -1.9460 | unchanged | 0 |
| battle-nevilles-cross | point | WD Q2204399 (Battle of Neville's Cross) 0.66 km; HE battlefield 1000024 0.10 km (inside); BT grid ref 0.22 km | 54.7770, -1.6000 | unchanged | 0 |
| battle-otterburn | point | WD Q1648673 (Battle of Otterburn) 0.14 km; HE battlefield 1000029 0.32 km (inside); BT grid ref 0.33 km | 55.2380, -2.1960 | 55.2397, -2.1919 | 0.32 km |
| battle-shrewsbury | point | WD Q166961 (Battle of Shrewsbury) 0.29 km; HE battlefield 1000033 0.51 km (inside); BT grid ref 0.86 km | 52.7490, -2.7220 | 52.7502, -2.7294 | 0.52 km |
| battle-st-albans-1455 | point | WD Q842796 (First Battle of St Albans) 46.67 km; BT grid ref 0.04 km | 51.7520, -0.3390 | unchanged | 0 |
| battle-towton | point | WD Q634629 (Battle of Towton) 0.04 km; HE battlefield 1000040 0.31 km (inside); BT grid ref 0.03 km | 53.8400, -1.2680 | unchanged | 0 |
| battle-barnet | point | WD Q1428169 (Battle of Barnet) 0.02 km; HE battlefield 1000001 0.37 km (inside); BT grid ref 0.34 km | 51.6660, -0.1990 | unchanged | 0 |
| battle-tewkesbury | point | WD Q1337059 (Battle of Tewkesbury) 0.05 km; HE battlefield 1000039 0.49 km (outside); BT grid ref 0.31 km | 51.9860, -2.1610 | 51.9819, -2.1635 | 0.49 km |
| battle-bosworth | point | WD Q222013 (Battle of Bosworth Field) 0.02 km; HE battlefield 1000004 1.15 km (inside); BT grid ref 0.97 km | 52.5910, -1.4100 | 52.5840, -1.4186 | 0.97 km |
| battle-stoke-field | point | WD Q1495481 (Battle of Stoke Field) 0.22 km; HE battlefield 1000036 0.58 km (inside); BT grid ref 0.79 km | 53.0370, -0.8880 | 53.0336, -0.8946 | 0.58 km |
| battle-flodden | point | WD Q1300742 (Battle of Flodden) 0.04 km; HE battlefield 1000011 0.56 km (inside); BT grid ref 0.58 km | 55.6270, -2.1760 | 55.6270, -2.1671 | 0.56 km |

## Validation

Run at the end of the pass on the written files: file parses; 173 ids, unique and unchanged; all years non-zero integers within -4000..1625; phases ordered and non-overlapping; every cited source id exists in `sources-england.json`; coordinates inside lat 49.7-56.0, lon -6.5-2.3; the three `site` links unchanged (`london`, `battle-brentford-1016` -> `brentford`, `battle-barnet` -> `barnet`). Result: no errors.
