# England and Wales research summary

**Research checked 14 November 2026; historical scope 4000 BCE–1625 CE.**

Delivered a reproducible SQLite knowledge base with **274 sources** (269 fetched web sources; 0 explicitly not-fetched bibliographic source), **2806 place records**, **292 events**, **209 battle-detail records**, **19 campaigns/movements**, **133 ordered waypoints**, and **5039 quantitative observations**. Place records include overlapping research identities and catalogue entries; these are not counts of distinct historical towns or battles proven beyond dispute.

All 24,796 fact/date/workflow entities have citations and provenance. The final checks passed: 92 checks, no reported errors or warnings. SQLite foreign keys/integrity, every app pointer, date arithmetic and SQL-dump restoration were checked; restoring the dump matched every table value. This establishes structural consistency, not independent historical proof of every row.

The frozen application baseline was captured at `2026-11-14T05:20:03.468950+00:00`. Later app edits by parallel workers are outside this comparison. No app files, build process or servers were changed by this research task.

## Coverage against the brief

| Coverage area | Completed in this pass | Material limits |
|---|---|---|
| 1. Prehistory | Monuments, settlement/hillfort phases, Welsh megaliths, Stonehenge sequence, contested dates, farming around 4000 BCE and Sweet Track felling 3807/3806 BCE. | Regional archaeological census incomplete; no fabricated settlement end dates or measured woodland raster. |
| 2. Roman Britain | The combined prehistoric/Roman packet has 65 researched places, 84 place phases, 19 events, named garrisons, provinces, campaign stops, walls and 4 routes. | Route coverage is representative; complete road geometry and every small fort/town are not supplied. Roman end dates remain debated. |
| 3. 410–1066 | 132 battle records, 10 campaigns and 107 waypoints; English/Welsh rulers, church foundations/sees, 33 Burghal Hidage assessments, Great Army winters, Danish conquest and 1066. | Late-annal/traditional battles are distinguished from contemporary proof. Many sites and annal chronologies remain unresolved; king/bishop lists are not complete for every minor polity. |
| 4. 1066–1485 | Later-period packet covers 52/52 relevant actions in the consulted 1066–1625 English inventory: 33 with individual-source treatment, 19 cautious catalogue skeletons. Welsh battles, six Edward I castles, monastic houses, plague/famine, revolt and Conwy’s planned borough are represented. | Inventory coverage is not every conceivable skirmish or siege. The 19 skeletons retain detail-verification tasks. Cathedral campaigns, manorial castles and borough charters need deeper work. |
| 5. 1485–1625 | Tudor/Jacobean reigns, major-house dissolutions, Welsh statutory and shire changes, Tudor rebellions, four coastal artillery forts, Armada stops, Mary Rose, 23 theatre anchors, schools, Oxford, Bristol/Cabot, plagues and 1607 flood. | Regional fires/plagues, coastal forts, planned towns and educational foundations are selective. Overseas material is contextual to English/Welsh events. |
| 6. Cross-cutting | All 40 IHR county/Wales pages: 2,418 catalogue headers, 3,056 date-qualified phases, 1,559 places with a parsed market/borough attestation by 1300, 1,638 1334 subsidy values. Population alternatives, price/wage decades, woodland estimates and 3,250 annual values for two OWDA cells. | 333 market-related open tasks retain complex dates/qualifications. Gazetteer grants are not operational-town counts; 1086/1377/1520s complete urban rankings, comprehensive sees and English shire creation chronology remain gaps. |

All six coverage areas were worked through. The checked corpus and its explicit research queue are the completion of this research pass; the file does not claim exhaustive verification of every town, battle or monument across 5,600 years.

## Row counts

| Table | Rows |
|---|---:|
| `app_link` | 248 |
| `battle` | 209 |
| `battle_number` | 29 |
| `battle_party` | 130 |
| `campaign` | 19 |
| `citation` | 34,095 |
| `claim` | 115 |
| `date_span` | 9,120 |
| `dispute` | 39 |
| `entity` | 24,796 |
| `event` | 292 |
| `loaded_packet` | 9 |
| `office` | 8 |
| `office_tenure` | 13 |
| `person` | 183 |
| `place` | 2,806 |
| `place_name` | 2,439 |
| `place_phase` | 3,220 |
| `polity` | 47 |
| `polity_period` | 8 |
| `relation` | 80 |
| `route` | 4 |
| `route_node` | 8 |
| `ruler_of` | 83 |
| `source` | 274 |
| `structure` | 47 |
| `structure_phase` | 56 |
| `timeline_series` | 15 |
| `timeline_value` | 5,039 |
| `todo` | 406 |
| `waypoint` | 133 |

Counts distinguish bookkeeping (`entity`, `citation`, `loaded_packet`), date evidence and substantive tables. `todo` records are leads, not established historical facts. The `fact` view unifies provenance without duplicating stored assertions.

## The 50 priority disagreements and refinements

These are **not 50 demonstrated factual errors**. Some app prose already admits the uncertainty but its scalar dates or markers cannot represent it. “Correction” identifies a conflicting factual claim; “uncertainty” preserves limits/alternatives; “refinement” adds distinctions needed for faithful rendering. A source’s silence supports an “unverified exact date” finding, not proof that the date is false. Omissions and identity-only agreements remain in `app_link` and are excluded from this ranked set.

Comparison counts: agreement 171, correction 5, omission 6, refinement 33, uncertainty 33. Editorial priority is stored in `app_link.importance`.

### 1. lindisfarne — correction

App location: `data/national/places.json#/74/summary`. Database comparison: `em-app-cuthbert-place`.

**App:** Founded in 635 from Iona. Cuthbert died here in 687 and the Lindisfarne Gospels were made about 710-725. Raided on 8 June 793, left for good in 875, and refounded as a cell of Durham by 1122 until its closure in 1537.

**Research:** Cuthbert died on Farne, not at Lindisfarne. His burial was at Lindisfarne. The app’s “died here” conflates death and burial.

**Evidence:** [Bede, Ecclesiastical History of England, translated A. M. Sellar (1907)](https://www.gutenberg.org/files/38326/38326-h/38326-h.html), George Bell and Sons / Project Gutenberg; checked 2026-11-14. **Confidence: medium.**

### 2. hywel-dda — correction

App location: `data/national/polities-wales.json#/16/note`. Database comparison: `em-app-hywel-manuscripts`.

**App:** Hywel held Seisyllwg from 920 and Dyfed by marriage, and on the death of Idwal Foel in 942 took Gwynedd (and with it Powys), ruling all Wales except Morgannwg and Gwent until his death in 950. The Welsh law-books are attributed to him, though no manuscript is earlier than the 13th century. His kingdom broke up at his death.

**Research:** The statement that no law manuscript predates the thirteenth century conflicts with DWB’s late-twelfth-century earliest manuscript; attribution of the law collection to Hywel is not contemporary documentation.

**Evidence:** [Hywel Dda (died 950), king and legislator](https://biography.wales/article/s-HYWE-DDA-0950.html), Dictionary of Welsh Biography; Stephen Joseph Williams, 1959; checked 2026-11-14. **Confidence: medium.**

### 3. northumbria — correction

App location: `data/national/polities.json#/33/from`. Database comparison: `em-app-northumbria-start`.

**App:** 654

**Research:** 654 cannot mean the first existence of Northumbria as a united kingship: Edwin and Oswald ruled both components before it, with intervening divisions. Use successive polity phases.

**Evidence:** [Bede, Ecclesiastical History of England, translated A. M. Sellar (1907)](https://www.gutenberg.org/files/38326/38326-h/38326-h.html), George Bell and Sons / Project Gutenberg; checked 2026-11-14. **Confidence: medium.**

### 4. battle-mynydd-carn — correction

App location: `data/national/places-wales.json#/65/uncertainty`. Database comparison: `lm-app-mynydd-site`.

**App:** The battlefield has not been found. Sources place it a day’s march from St Davids at a hill with a cairn; the marker uses the grid reference in the Coflein record, which is one suggestion among several in Pembrokeshire.

**Research:** The source’s narrative leaves the site undetermined and favours northern Pembrokeshire, while its record marker and the app lie near Templeton. Suppress an exact battle dot until reconciled.

**Evidence:** [Battle of Mynydd Carn (NPRN 300319), site record](https://coflein.gov.uk/en/site/300319/), Royal Commission on the Ancient and Historical Monuments of Wales (Coflein); checked 2026-11-14. **Confidence: high.**

### 5. grimspound — correction

App location: `data/national/places.json#/16/phases/1`. Database comparison: `pr-cmp-grimspound-abandon`.

**App:** Abandoned at 800 BCE as climate worsened.

**Research:** Use duration is unknown; source discusses changing settlement by 1000 BCE and erosion/soil exhaustion, not a securely dated climatic abandonment.

**Evidence:** [History of Grimspound](https://www.english-heritage.org.uk/visit/places/grimspound/history/), English Heritage; checked 2026-11-14. **Confidence: high.**

### 6. battle-assandun — uncertainty

App location: `data/national/places.json#/156/lat`. Database comparison: `em-app-assandun-point`.

**App:** 51.606

**Research:** Retain both Ashingdon/Canewdon and Ashdon/Hadstock hypotheses. The project still calls the location disputed; an Ashingdon marker must not become confirmed geometry.

**Evidence:** [The Battle of Assandun 1016: location investigation](https://assandun.uk/home), Assandun research project, sponsored by the Battlefields Trust; checked 2026-11-14. **Confidence: medium.**

### 7. brentford-1016 — uncertainty

App location: `data/locations/london/episodes.json#/2/fraction`. Database comparison: `em-app-brentford-time`.

**App:** 0.5

**Research:** Fraction 0.5 is staging. The attested timing is two nights after relief of London, after the Sherston encounter and before Assandun; no fixed day or month is recorded.

**Evidence:** [The Anglo-Saxon Chronicle, Ingram/Giles composite English translation](https://www.gutenberg.org/files/657/657.txt), Project Gutenberg; James Ingram (1823), J. A. Giles (1847); checked 2026-11-14. **Confidence: medium.**

### 8. london-bridge-1014 — uncertainty

App location: `data/locations/london/episodes.json#/1/year`. Database comparison: `em-app-bridge-1014`.

**App:** 1014

**Research:** 1014 is the saga framing, not a secure event date from the Chronicle. The Chronicle records repeated attacks in 1009–10 and Æthelred’s return in 1014, without bridge demolition.

**Evidence:** [The Anglo-Saxon Chronicle, Ingram/Giles composite English translation](https://www.gutenberg.org/files/657/657.txt), Project Gutenberg; James Ingram (1823), J. A. Giles (1847); checked 2026-11-14. **Confidence: medium.**

### 9. battle-brunanburh — uncertainty

App location: `data/national/places.json#/153/lat`. Database comparison: `em-app-brunanburh-point`.

**App:** 53.336

**Research:** The event is attested but this point is a candidate localization. The Chronicle does not identify a modern coordinate; render a disputed candidate, not a fixed battlefield.

**Evidence:** [The Anglo-Saxon Chronicle, Ingram/Giles composite English translation](https://www.gutenberg.org/files/657/657.txt), Project Gutenberg; James Ingram (1823), J. A. Giles (1847); checked 2026-11-14. **Confidence: medium.**

### 10. gruffudd-ap-llywelyn — uncertainty

App location: `data/national/polities-wales.json#/17/to`. Database comparison: `em-app-gruffudd`.

**App:** 1063

**Research:** The scalar end 1063 should support an alternative 1064 end as already acknowledged in the app note. Store Hudson and Jones as competing chronology claims.

**Evidence:** [Gruffudd ap Llywelyn (died 1064), revised biography](https://biography.wales/article/s12-GRUF-APL-1063.html), Dictionary of Welsh Biography; Benjamin Hudson, 2018; checked 2026-11-14. **Confidence: medium.**

### 11. rhodri-mawr — uncertainty

App location: `data/national/polities-wales.json#/15/note`. Database comparison: `em-app-rhodri-powys`.

**App:** Rhodri became king of Gwynedd in 844, took Powys in 855 and Seisyllwg in 872, so that for a few years one king ruled most of Wales outside the south-east and Dyfed. He was killed fighting the English; the Dictionary of Welsh Biography gives 877, other reckonings 878. His sons divided the lands. No boundary is drawn because none is known.

**Research:** Thornton qualifies Rhodri’s control of Powys as possible in 855 or later; the app’s “took Powys in 855” is too definite. Death chronology remains 877 versus 878.

**Evidence:** [Rhodri Mawr (b. before 844, d. 878), king of Gwynedd](https://academic.oup.com/oxford-dictionary-of-national-biography/reference/63486/reference-article-abstract/581824952), Oxford Dictionary of National Biography; David E. Thornton, 2004; checked 2026-11-14. **Confidence: medium.**

### 12. whitby — uncertainty

App location: `data/national/places.json#/76/phases/0/to`. Database comparison: `em-app-whitby-end`.

**App:** 867

**Research:** 867 is a display placeholder. English Heritage explicitly says abandonment occurred at an unknown point in the ninth century. Preserve a bounded uncertain end.

**Evidence:** [History of Whitby Abbey](https://www.english-heritage.org.uk/visit/places/whitby-abbey/history-and-stories/history/), English Heritage; checked 2026-11-14. **Confidence: medium.**

### 13. winchester — uncertainty

App location: `data/national/places.json#/35/summary`. Database comparison: `em-app-winchester-largest`.

**App:** Roman Venta, refounded by Alfred with a new street grid and the largest burh in the Burghal Hidage. It was second only to London at Domesday but thirtieth in the 1377 poll tax.

**Research:** The Hidage assessment is 2,400 hides for Winchester, also 2,400 for Wallingford and appended Warwick. These fiscal figures do not by themselves establish an exclusive largest-town ranking or population.

**Evidence:** [The Burghal Hidage: the establishment of a text](https://archaeologydataservice.ac.uk/catalogue/adsdata/arch-769-1/dissemination/pdf/vol13/13_084_092.pdf), David Hill; Medieval Archaeology 13 (1969), 84–92; Archaeology Data Service; checked 2026-11-14. **Confidence: medium.**

### 14. durham — uncertainty

App location: `data/national/places.json#/79/phases`. Database comparison: `lm-app-durham-1540`.

**App:** 995 to 1092: Shrine of St Cuthbert on the river peninsula; 1093 to 1539: Norman cathedral, castle and seat of the prince-bishops; 1540 to open end: Cathedral city of a county palatine.

**Research:** Archival catalogue: surrender on 31 December 1539. VCH: 1540. Keep these source-specific claims linked as a chronological dispute; the app’s 1539 phase end cannot be ruled wrong from VCH alone.

**Evidence:** [Durham Cathedral Archive: catalogue of deanery and prebendal rentals and accounts, GB-0033-DCD/H](https://reed.dur.ac.uk/xtf/view?docId=ark%2F32150_s1dz010q061.xml), Durham University Library, Archives and Special Collections; checked 2026-11-14. **Confidence: medium.**

### 15. battle-lewes — uncertainty

App location: `data/national/places.json#/161/uncertainty`. Database comparison: `lm-app-lewes-location`.

**App:** Date (14 May 1264) confirmed by the Battlefields Trust, which describes the site as securely located on the north side of the town. Historic England registers it as 'Battle of Lewes 1264' (list entry 1000018).

**Research:** The Trust’s narrative qualifies its table: exact ground between Offham Hill and the medieval town is uncertain. General locality is secure; detailed deployment is not.

**Evidence:** [Battle of Lewes - 1264](https://www.battlefieldstrust.com/resource-centre/medieval/battleview.asp?BattleFieldId=22), Battlefields Trust; checked 2026-11-14. **Confidence: high.**

### 16. birdoswald — uncertainty

App location: `data/national/places.json#/53/phases/1`. Database comparison: `pr-cmp-birdoswald-halls`.

**App:** Timber halls start in 411, abandonment in 520.

**Research:** Sequence bridges late Roman occupation and the fifth century; exact changeover and abandonment years are not established.

**Evidence:** [History of Birdoswald](https://www.english-heritage.org.uk/visit/places/birdoswald-roman-fort-hadrians-wall/history-and-stories/history/), English Heritage; checked 2026-11-14. **Confidence: high.**

### 17. brecon-gaer — uncertainty

App location: `data/national/places-wales.json#/18/phases/1`. Database comparison: `pr-cmp-brecon-end`.

**App:** Fort abandoned from 300.

**Research:** Cadw establishes founding around 75 and a named cavalry unit, but does not substantiate abandonment in 300.

**Evidence:** [Y Gaer Roman Fort](https://cadw.gov.wales/visit/places-to-visit/y-gaer-roman-fort), Cadw, Welsh Government; checked 2026-11-14. **Confidence: high.**

### 18. bryn-celli-ddu — uncertainty

App location: `data/national/places-wales.json#/0/phases/1`. Database comparison: `pr-cmp-bryn-closure`.

**App:** Tomb becomes disused at 2000 BCE.

**Research:** Fetched Cadw overview supplies no closure date; omit a definite 2000 BCE cessation.

**Evidence:** [Bryn Celli Ddu Chambered Tomb](https://cadw.gov.wales/visit/places-to-visit/bryn-celli-ddu-chambered-tomb), Cadw, Welsh Government; checked 2026-11-14. **Confidence: high.**

### 19. chesters — uncertainty

App location: `data/national/places.json#/52/phases/1`. Database comparison: `pr-cmp-chesters-411`.

**App:** Abandoned in 411.

**Research:** Institutional history gives occupation into the fifth century; a precise 411 departure is unsupported.

**Evidence:** [History of Chesters Roman Fort And Museum Hadrians Wall](https://www.english-heritage.org.uk/visit/places/chesters-roman-fort-and-museum-hadrians-wall/history/), English Heritage; checked 2026-11-14. **Confidence: high.**

### 20. britannia-superior — uncertainty

App location: `data/national/polities.json#/17/from`. Database comparison: `pr-cmp-provinces-date`.

**App:** Province starts exactly in 197.

**Research:** The source places division after the 196–197 revolt; it does not establish 197 as the creation year.

**Evidence:** [An introduction to Roman Britain](https://www.english-heritage.org.uk/learn/story-of-england/romans/introduction/), English Heritage; checked 2026-11-14. **Confidence: high.**

### 21. segontium — uncertainty

App location: `data/national/places-wales.json#/9/phases/0/to`. Database comparison: `pr-cmp-segontium-end`.

**App:** App chooses 394 over Pleiades 338.

**Research:** Keep both cited endpoints as linked claims; a last-coin date is not automatically an exact evacuation date.

**Evidence:** [Segontium Roman Fort](https://cadw.gov.wales/visit/places-to-visit/segontium-roman-fort), Cadw, Welsh Government; checked 2026-11-14. **Confidence: high.**

### 22. stonehenge — uncertainty

App location: `data/national/places.json#/0/phases/3`. Database comparison: `pr-cmp-stonehenge-roman`.

**App:** A new ruin phase begins exactly in AD 43.

**Research:** The prehistoric sequence supplies no AD 43 abandonment or destruction date. Preserve unknown later use.

**Evidence:** [History of Stonehenge](https://www.english-heritage.org.uk/visit/places/stonehenge/history-and-stories/history/), English Heritage; checked 2026-11-14. **Confidence: high.**

### 23. uffington — uncertainty

App location: `data/national/places.json#/17/phases/0`. Database comparison: `pr-cmp-uffington-date`.

**App:** Horse begins at 1000 BCE; later phase starts 700 BCE.

**Research:** The dated bracket is 1740–210 BCE. A chosen start of 1000 BCE is a display assumption, not an observation.

**Evidence:** [History of Uffington Castle, White Horse and Dragon Hill](https://www.english-heritage.org.uk/visit/places/uffington-castle-white-horse-and-dragon-hill/history/), English Heritage; checked 2026-11-14. **Confidence: high.**

### 24. woodland — uncertainty

App location: `data/national/site.json#/woodland`. Database comparison: `x-woodland-link`.

**App:** National rendering uses 20% at 400, 25% at 600, 15% at 1086 and 8% at 1350, with an explicit modelling note.

**Research:** Current official synthesis gives little overall Roman-to-early-medieval change, about 15% late-eleventh-century woodland/wood pasture and about 10% by the fourteenth century. Keep the app curve explicitly illustrative; this is an alternative synthesis, not a measured replacement.

**Evidence:** [Identifying and protecting woodland archaeology](https://www.gov.uk/government/publications/identifying-and-protecting-archaeological-features-in-woodland/identifying-and-protecting-woodland-archaeology), Forestry Commission / GOV.UK; checked 2026-11-14. **Confidence: high.**

### 25. Stamford Bridge and Hastings — refinement

App location: `data/national/events.json#/44`. Database comparison: `em-app-1066-travel`.

**App:** 1066: Stamford Bridge and Hastings. 25 September and 14 October 1066: the Norman Conquest.

**Research:** Add Fulford on 20 September and separate northern and southern campaigns. Harold’s return transport is uncertain; a continuous foot-march animation would exceed the evidence.

**Evidence:** [A Restless Reign: King Harold in 1066](https://www.english-heritage.org.uk/visit/places/1066-battle-of-hastings-abbey-and-battlefield/history-and-stories/king-harold/), English Heritage; Roy Porter; checked 2026-11-14. **Confidence: medium.**

### 26. The Great Army lands in East Anglia — refinement

App location: `data/national/events.json#/35`. Database comparison: `em-app-army-865`.

**App:** 865: The Great Army lands in East Anglia. York falls in 866/7, East Anglia in 869, eastern Mercia in 877.

**Research:** The first winter camp is only East Anglia, not securely Thetford. Named stations thereafter form an ordered track; after Repton the army splits.

**Evidence:** [The winter camp of the Viking Great Army, AD 872–3, Torksey, Lincolnshire](https://www.cambridge.org/core/journals/antiquaries-journal/article/winter-camp-of-the-viking-great-army-ad-8723-torksey-lincolnshire/C54BB610EA9E0E567DC2C0622BA753EB), Dawn M. Hadley and Julian D. Richards; Antiquaries Journal 96 (2016), 23–67; checked 2026-11-14. **Confidence: medium.**

### 27. jarrow — refinement

App location: `data/national/places.json#/75/phases/0/from`. Database comparison: `em-app-jarrow-start`.

**App:** 674

**Research:** 674 dates Wearmouth; Jarrow followed c.681–682 and was dedicated 23 April 685. Separate place/structure phases avoid making the Jarrow marker appear in 674.

**Evidence:** [Anglo-Saxon England: a bibliographical handbook for students of Anglo-Saxon history](https://www.asnc.cam.ac.uk/resources/ASHistBib06.pdf), Simon Keynes, University of Cambridge, 2006; checked 2026-11-14. **Confidence: medium.**

### 28. torksey — refinement

App location: `data/national/places.json#/83/lat`. Database comparison: `em-app-torksey-camp`.

**App:** 53.303

**Research:** The archaeological camp is on the high ground north of Torksey, mostly Brampton parish, centred on HER grid SK836802. A village marker is not the camp centroid.

**Evidence:** [MLI125067: Winter Camp of the Viking Great Army at Torksey](https://heritage-explorer.lincolnshire.gov.uk/Monument/MLI125067), Lincolnshire County Council Historic Environment Record; checked 2026-11-14. **Confidence: medium.**

### 29. burgh-castle — refinement

App location: `data/national/places.json#/58/phases/0/label`. Database comparison: `pr-cmp-burgh-name`.

**App:** Phase labels Burgh simply Gariannonum.

**Research:** The identification also involves Caister; retain an explicit uncertainty flag on the ancient name.

**Evidence:** [History of Burgh Castle](https://www.english-heritage.org.uk/visit/places/burgh-castle/history/), English Heritage; checked 2026-11-14. **Confidence: high.**

### 30. durrington-walls — refinement

App location: `data/national/places.json#/1/phases`. Database comparison: `pr-cmp-durrington-date`.

**App:** Settlement spans 2550–2451 BCE; henge follows in 2450.

**Research:** Fetched account gives occupation within 2580–2470 BCE and a later henge, without a precise transition year.

**Evidence:** [Stonehenge Reconstructed: Durrington Walls and Woodhenge](https://www.english-heritage.org.uk/visit/places/stonehenge/history-and-stories/stonehenge-reconstructed/), English Heritage; checked 2026-11-14. **Confidence: high.**

### 31. london — refinement

App location: `data/national/places.json#/24/phases/2/from`. Database comparison: `pr-cmp-london-shrink`.

**App:** Contraction phase begins 351 CE.

**Research:** Museum places gradual reduction of houses after about 150, while monumental decline is visible around 300.

**Evidence:** [A timeline of Roman London: Londinium from start to end](https://www.londonmuseum.org.uk/collections/london-stories/timeline-roman-london-londinium/), London Museum; checked 2026-11-14. **Confidence: high.**

### 32. richborough — refinement

App location: `data/national/places.json#/33/phases/2`. Database comparison: `pr-cmp-richborough-fort`.

**App:** Single Saxon Shore fort phase starts 251.

**Research:** Separate the small fort around 250 from the surviving stone fort built in 275–290.

**Evidence:** [History of Richborough](https://www.english-heritage.org.uk/visit/places/richborough-roman-fort-and-amphitheatre/history-and-stories/history/), English Heritage; checked 2026-11-14. **Confidence: high.**

### 33. lambeth-palace — refinement

App location: `data/locations/london/landmarks.json#/60`. Database comparison: `x-lambeth-link`.

**App:** Begins at 1200; source list empty and dates explicitly unchecked.

**Research:** Historic England records occupation in 1197, a changed church plan in 1200, hall before 1234 and gatehouse in 1490. Replace the unsourced single build window with these separate states.

**Evidence:** [Lambeth Palace: registered park and garden 1000818](https://historicengland.org.uk/listing/the-list/list-entry/1000818), Historic England; checked 2026-11-14. **Confidence: high.**

### 34. westminster-hall — refinement

App location: `data/locations/london/landmarks.json#/38`. Database comparison: `x-westminster-roof-link`.

**App:** Hammerbeam phase begins in 1393 and immediately uses its finished form; 73 × 20.5 m dimensions were previously secondary-only.

**Research:** Commissioning in 1393 precedes lantern completion in 1397–98 and unfinished stopping point in 1401. Parliament gives roof dimensions 73.2 × 20.7 m; animate construction rather than instant completion.

**Evidence:** [The hammer-beam roof](https://www.parliament.uk/about/living-heritage/building/palace/westminsterhall/architecture/the-hammer-beam-roof-/), UK Parliament; checked 2026-11-14. **Confidence: high.**

### 35. battle-abbey — uncertainty

App location: `data/national/places.json#/131/phases`. Database comparison: `lm-app-battle-abbey-approx`.

**App:** 1071 to 1538: Benedictine abbey on the battlefield of 1066; 1539 to open end: Country house in the abbey buildings.

**Research:** The institutional source presents the foundation as approximate. Keep a circa flag rather than treating the displayed year as exact.

**Evidence:** [Battle Abbey history](https://www.english-heritage.org.uk/visit/places/1066-battle-of-hastings-abbey-and-battlefield/history-and-stories/history/), English Heritage; checked 2026-11-14. **Confidence: high.**

### 36. margam — uncertainty

App location: `data/national/places-wales.json#/56/phases`. Database comparison: `lm-app-margam-approx`.

**App:** 1147 to 1536: Cistercian abbey; 1536 to open end: Nave kept as parish church.

**Research:** The institutional source presents the foundation as approximate. Keep a circa flag rather than treating the displayed year as exact.

**Evidence:** [Margam Abbey (NPRN 132), site record](https://coflein.gov.uk/en/site/132/), Royal Commission on the Ancient and Historical Monuments of Wales (Coflein); checked 2026-11-14. **Confidence: high.**

### 37. strata-florida — uncertainty

App location: `data/national/places-wales.json#/53/phases`. Database comparison: `lm-app-strata-closure`.

**App:** 1164 to 1539: Cistercian abbey; 1539 to open end: Ruin.

**Research:** Coflein says closed by 1539. This is an upper bound; do not convert it to a certain 1539 dissolution event.

**Evidence:** [Strata Florida Abbey (NPRN 95764), site record](https://coflein.gov.uk/en/site/95764/), Royal Commission on the Ancient and Historical Monuments of Wales (Coflein); checked 2026-11-14. **Confidence: high.**

### 38. battle-towton — uncertainty

App location: `data/national/places.json#/167/uncertainty`. Database comparison: `lm-app-towton-numbers`.

**App:** Army sizes (50,000-65,000 combined) and casualty figures are chroniclers' estimates. Date (29 March 1461) confirmed by the Battlefields Trust, which describes the site as securely located between Saxton and Towton. Historic England registers it as 'Battle of Towton, 1461' (list entry 1000040).

**Research:** Fetched Trust synthesis expressly calls 40,000 on each side and chroniclers’ deaths improbable; store disputed numerical claims separately from the battle fact.

**Evidence:** [Battle of Towton - 1461](https://www.battlefieldstrust.com/resource-centre/warsoftheroses/battleview.asp?BattleFieldId=46), Battlefields Trust; checked 2026-11-14. **Confidence: high.**

### 39. whitby — uncertainty

App location: `data/national/places.json#/76/phases`. Database comparison: `lm-app-whitby-approx`.

**App:** 657 to 867: Streaneshalch, double monastery founded by Hild; 868 to 1077: Abandoned; 1078 to 1539: Benedictine abbey; 1540 to open end: Fishing port below the ruined abbey.

**Research:** The institutional source presents the foundation as approximate. Keep a circa flag rather than treating the displayed year as exact.

**Evidence:** [History of Whitby Abbey](https://www.english-heritage.org.uk/visit/places/whitby-abbey/history/), English Heritage; checked 2026-11-14. **Confidence: high.**

### 40. castlerigg — uncertainty

App location: `data/national/places.json#/9/phases/0/to`. Database comparison: `pr-cmp-castlerigg-end`.

**App:** Stone-circle phase ends 2001 BCE.

**Research:** Neither construction nor an end of ceremonial use is securely dated; omit a definite cessation date.

**Evidence:** [History of Castlerigg Stone Circle](https://www.english-heritage.org.uk/visit/places/castlerigg-stone-circle/history/), English Heritage; checked 2026-11-14. **Confidence: high.**

### 41. pentre-ifan — uncertainty

App location: `data/national/places-wales.json#/2/phases/1`. Database comparison: `pr-cmp-pentre-end`.

**App:** Disused from 3000 BCE.

**Research:** The source establishes Neolithic origin but supplies no end-of-use date.

**Evidence:** [Pentre Ifan Chambered Tomb](https://cadw.gov.wales/visit/places-to-visit/pentre-ifan-chambered-tomb), Cadw, Welsh Government; checked 2026-11-14. **Confidence: high.**

### 42. seahenge — uncertainty

App location: `data/national/places.json#/13/phases/0/to`. Database comparison: `pr-cmp-seahenge-end`.

**App:** Circle stops being used at 2000 BCE.

**Research:** The precise felling year is supported; no ceremonial end-of-use date is established.

**Evidence:** [Dating the second timber circle on Holme-next-the-sea beach](https://www.heritage.norfolk.gov.uk/dating-the-second-timber-circle-on-holme-next-the-sea-beach-1), Norfolk County Council Historic Environment Service; checked 2026-11-14. **Confidence: high.**

### 43. silbury-hill — uncertainty

App location: `data/national/places.json#/3/phases/0`. Database comparison: `pr-cmp-silbury-duration`.

**App:** Continuous construction from 2470 to 2350 BCE.

**Research:** 2470–2350 BCE bounds the possible building interval; it does not demonstrate continuous work for 120 years.

**Evidence:** [History of Silbury Hill](https://www.english-heritage.org.uk/visit/places/silbury-hill/history/), English Heritage; checked 2026-11-14. **Confidence: high.**

### 44. silchester — uncertainty

App location: `data/national/places.json#/32/phases/0/from`. Database comparison: `pr-cmp-silchester-start`.

**App:** Iron Age town starts at 20 BCE.

**Research:** 20–10 BCE is a proposed establishment interval; record it as an uncertain date, not a decade-long build.

**Evidence:** [History of Silchester Roman City Walls And Amphitheatre](https://www.english-heritage.org.uk/visit/places/silchester-roman-city-walls-and-amphitheatre/history/), English Heritage; checked 2026-11-14. **Confidence: high.**

### 45. thornborough-henges — uncertainty

App location: `data/national/places.json#/10/phases/1`. Database comparison: `pr-cmp-thornborough-end`.

**App:** Henges become out of use at 2000 BCE.

**Research:** The complex remained significant for early Bronze Age burials; 2000 BCE is not a demonstrated abandonment.

**Evidence:** [History of Thornborough Henges](https://www.english-heritage.org.uk/visit/places/thornborough-henges/history/), English Heritage; checked 2026-11-14. **Confidence: high.**

### 46. bermondsey-abbey — uncertainty

App location: `data/locations/london/landmarks.json#/61`. Database comparison: `x-bermondsey-link`.

**App:** One priory phase 1082–1538; no fetched sources.

**Research:** Southwark supplies an institutional source for 1082 and distinguishes later abbey status; it does not independently verify the app’s 1140 construction completion or 1538 demolition.

**Evidence:** [Grange Walk, no 7: Southwark collection GA1262](https://heritage.southwark.gov.uk/objects/3588/grange-walk--no-7-former--abbey-gatehouse), Southwark Heritage; checked 2026-11-14. **Confidence: high.**

### 47. battle-dyrham — refinement

App location: `data/national/places.json#/150/evidence`. Database comparison: `em-app-dyrham-class`.

**App:** attested-documentary

**Research:** Documentary attestation is a much later origin annal. The packet marks the event tradition/low, preserving the stated 577 date without presenting contemporary proof.

**Evidence:** [The Anglo-Saxon Chronicle, Ingram/Giles composite English translation](https://www.gutenberg.org/files/657/657.txt), Project Gutenberg; James Ingram (1823), J. A. Giles (1847); checked 2026-11-14. **Confidence: medium.**

### 48. battle-ellendun — refinement

App location: `data/national/places.json#/151/summary`. Database comparison: `em-app-ellendun-transfer`.

**App:** Egbert of Wessex defeated Beornwulf of Mercia; Kent, Sussex, Surrey and Essex passed to Wessex and Mercian dominance ended.

**Research:** The Chronicle distinguishes Ecgberht’s victory, Æthelwulf’s subsequent expulsion of Baldred, and East Anglian resistance to Mercia. This is a campaign sequence, not a single instantaneous territorial switch.

**Evidence:** [The Anglo-Saxon Chronicle, Ingram/Giles composite English translation](https://www.gutenberg.org/files/657/657.txt), Project Gutenberg; James Ingram (1823), J. A. Giles (1847); checked 2026-11-14. **Confidence: medium.**

### 49. england — refinement

App location: `data/national/polities.json#/40/from`. Database comparison: `em-app-english-unification`.

**App:** 927

**Research:** 927 is a useful unification milestone but not uninterrupted possession of York: the Chronicle records competing northern kings and final expulsion of Eric in 954.

**Evidence:** [The Anglo-Saxon Chronicle, Ingram/Giles composite English translation](https://www.gutenberg.org/files/657/657.txt), Project Gutenberg; James Ingram (1823), J. A. Giles (1847); checked 2026-11-14. **Confidence: medium.**

### 50. st-davids — refinement

App location: `data/national/places-wales.json#/19/summary`. Database comparison: `em-app-st-davids-bishop`.

**App:** The monastery founded by St David in the 6th century became the leading church of Wales and, under Norman bishops from 1115, a cathedral. The present church was begun in 1181; a 12th-century pope ruled two pilgrimages here equal to one to Rome, and Bishop Henry de Gower built the great palace in 1328-47.

**Research:** St Davids had bishops before Norman appointments: Nobis appears in the annals under 840 and Asser describes its bishops. Separate early episcopal institution from the later cathedral building.

**Evidence:** [Asser’s Life of King Alfred, translated from Stevenson’s text](https://www.gutenberg.org/files/63384/63384-h/63384-h.htm), Albert S. Cook (Ginn & Company, 1906) / Project Gutenberg; checked 2026-11-14. **Confidence: medium.**

## Weakest areas and open questions

- **Battle locations and chronology:** 141 battle records have no usable coordinate. Other anchors can be approximate or disputed. Traditions, annal-year calibration, casualty rhetoric and late sources need continued critical work. Null is intentional; it is not an invitation to invent a dot.
- **Bulk market assertions:** every page was fetched and structurally scanned, but detailed manual source checking sampled a limited set. Corrected encoding, merged cells, circa parsing, bibliographic false dates and schedule conflation are documented. Complex early-century and qualified dates remain tasks. The current 2,418 headers differ from the older introductory 2,393 total; they are observed catalogue headers, not a certified unique-town census.
- **Quantitative comparability:** population figures from different methods/vintages remain separate and disputed. Subsidy assessments, fiscal hides and population are distinct. Two climate cells demonstrate an archive-backed temporal series; national aggregation and reconstruction-skill uncertainty are not supplied.
- **Coverage depth:** complete episcopal successions, English shire formation, detailed cathedral construction, minor forts/castles, route geometry, royal itineraries, monthly nationwide plague spread, and urban rankings for all requested benchmarks remain incomplete. Follow the explicit `todo` queue rather than treating missing rows as absence.
- **Positions:** many individually researched sites retain separately sourced provisional app coordinates. The IHR grids are independently transformed locality anchors with a 1 km radius. The database is not a surveyed national archaeological GIS.
- **Chronology bounds:** `by` and `before` are now typed qualifiers. Lady Day years and Julian/Gregorian equivalents must not be collapsed. Numeric early-century brackets sometimes index qualitative source wording; the row notes distinguish these from measured intervals.
- **Source access:** 0 source records remain marked not_fetched. Some institutional routes denied access; some records use a publisher’s accessible extract rather than a full subscription article, as their source notes state. Original manuscripts underlying institutional syntheses were generally not consulted. Search snippets were not promoted to fetched-page verification.

## What the application should wire in first

1. **Evidence and uncertainty UI:** source links, checked dates, evidence class, date bounds/qualifiers, position method and radius, and dispute alternatives. This prevents a precise-looking animation from silently strengthening a weak claim.
2. **Battles and campaign stops:** use `event_timeline` and `movement_timeline` for Brentford, Barnet, 1013–16, 1066 and Great Army winter camps. Render unknown/disputed sites as unresolved areas or text, and label interpolated travel. Do not render invented deployments from a locality anchor.
3. **Existing site phases:** start with Stonehenge and London comparisons, separating construction, consecration, institutional closure and physical destruction. Use explicit app links against the frozen baseline, then reconcile any later app edits.
4. **Quantitative layers with definitions:** show population models separately, fiscal assessments as fiscal measures, and the two local climate cells as local reconstructions. Preserve units and aggregation periods.
5. **National place expansion:** resolve identity candidates and market qualifications before rendering towns. The IHR extraction requires permission before public/commercial reuse under its stated terms; do not assume an open-data licence. The Conwy HER record also requires permission for publication/commercial resources. [IHR terms](https://archives.history.ac.uk/gazetteer/copyright.html), [Heneb terms and attribution](https://archwilio.org.uk/her/chi3/report/page.php?watprn=GAT3189).

## Validation and reproducibility

See [README.md](README.md), [SCHEMA.md](SCHEMA.md), [queries.sql](queries.sql) and [validation.json](validation.json). The SQLite and SQL dump rebuild offline from the packet JSON. Every table is documented; there is no renderer dependency. [LOG.md](LOG.md) records checkpoints and the corrections prompted by review.

Independent review reports: [market importer](evidence/pr-market-review.md), [London/cross-cutting packet](evidence/em-core-review.md). Final author resolutions and the Durham/Fountains source check are recorded in the log and [source check](evidence/lm-source-check.md). These are targeted reviews, not blanket independent certification.
