# Independent adversarial fact review — DeepSeek

Reviewed 2026-11-14 against the current JSON: 75 London landmarks and 131 phases, 30 zones, 29 events, four episodes and six eras; all 28 national battles; and the complete Brentford 1016 and Barnet 1471 sites (15 and 23 place records respectively). I also checked the 121 `attested-*` + `high` London rows that Astra's coverage ledger left unadjudicated, across 25 entities.

## Outcome

**Eight findings: 3 S1, 3 S2, 1 S3 and 1 S4. All eight are verified-wrong.** No S1/S2 battle error survived review. No unverified suspicion has been promoted into a proposed correction. No correction is proposed for Brentford or Barnet's detailed episode narratives: both already distinguish documentary fact, inference and conjecture unusually carefully.

| Severity | Count |
|---|---:|
| S1 — factually wrong and visible | 3 |
| S2 — misleading or over-confident | 3 |
| S3 — sourcing defect | 1 |
| S4 — minor | 1 |
| **Total** | **8** |

| Status | Count |
|---|---:|
| verified-wrong | 8 |
| unverified suspicion | 0 |
| disagree-with-astra | 0 |
| confirmed-correct | 0 |

All eight have `already_in_astra_review: false`. Several sit on entities Astra partly reviewed; none repeats an adjudicated Astra target.

## London — every S1 and S2

### DS-LON-001 — Winchester Palace: the early 13th-century hall is missing (S1)

**App claim:** A bishop's palace runs 1144–1300, then “Palace with great hall” begins at 1300 with `continues: true`; its note says the standing great hall is a 14th-century rebuild.

**What is wrong:** The model jumps from a palace without a marked great hall to a completed courtyard/great-hall model at 1300. Historic England's record places a great hall on the site in the early 13th century, documents a hall, chapel and the “great gutter” by 1253–54, and places reconstruction of the west gable and rose window in the early 14th century, with the hall and adjoining parts rebuilt around 1340. The standing fabric is mainly the later campaign, but the earlier hall must not disappear for 50–80 years.

**Evidence:** [Historic England Heritage Gateway 404707](https://historicengland.org.uk/listing/heritage-gateway/results/record/0d636742-8028-4a8c-8b7c-e1f9aaf2d338/cf3371fb-96b4-4a04-a0a6-32afda0124eb); [English Heritage, History of Winchester Palace](https://www.english-heritage.org.uk/visit/places/winchester-palace/history/).

**Exact correction:** end phase 0 in 1220; turn phase 1 into an early 13th-century great-hall phase from 1220, built 1250, ending by handover in 1340; append a continuing “Palace with rebuilt great hall and west gable” phase from 1340. The full field values and repeated courtyard model are in `findings.json`.

### DS-LON-002 — Custom House: the documented 1559 replacement is shown as one unbroken building (S1)

**App claim:** One “Custom house at Wool Quay” runs from 1377, built 1382, with no end. The uncertainty says an Elizabethan rebuilding “could not be confirmed” and that one building is shown throughout.

**What is wrong:** The Survey of London states that Churchman's Custom House lasted 180 years until 1559 and was then superseded by a new Custom House erected under William Paulet, Marquess of Winchester. The replacement is documented, not merely “often stated”. A single building from 1382 to 1625 is false.

**Evidence:** [Survey of London vol. 15, Custom House Quay and the Old Custom House](https://www.british-history.ac.uk/survey-london/vol15/pt2/pp31-43).

**Exact correction:** end the Churchman building in 1559 with `end: "replaced"`; append a 1559 Elizabethan Custom House with a generic placeholder hall model; replace the uncertainty with the documented replacement and an appearance caveat.

### DS-LON-003 — Charterhouse: the monastery remains visible after dissolution (S1)

**App claim:** The Carthusian monastery phase runs 1371–1545 although its own note says “Dissolved 1537–38”; the mansion begins in 1545.

**What is wrong:** The community was actually disbanded on 15 November 1538. The buildings were then divided and controlled by suppression commissioners, later used as a royal storehouse, and only acquired by Sir Edward North in 1545 or on 14 April 1546 depending on the source. Keeping a monastic phase alive until 1545 erases the documented seven-year reuse of the precinct and attaches the wrong institutional identity to the standing buildings.

**Evidence:** [VCH Middlesex vol. 1, House of Carthusian monks](https://www.british-history.ac.uk/vch/middx/vol1/pp159-169); [The Charterhouse, History](https://thecharterhouse.org/explore-the-charterhouse/history/).

**Exact correction:** end the monastic phase in 1538; insert a continuing “Dissolved Charterhouse precinct and royal store” phase from 1538 to 1545; move North's mansion to phase 2 from 1545 and note that the purchase date is 1545 in one source and 14 April 1546 in the other.

### DS-LON-004 — St Olave, Southwark: a probable pre-Conquest church becomes a 1070–96 building campaign (S2)

**App claim:** A single church phase starts in 1070 and is built in 1096.

**What is wrong:** That turns a probable Earl Godwin chapel from at least 1018, a probable Domesday church in 1086, and the first naming of St Olave in 1096 into a precise 26-year construction span. The 1096 reference is attestation, not completion; the model also makes a church absent for most of the late 11th century despite evidence to the contrary.

**Evidence:** [St Olave, Southwark](https://www.londonparishclerks.com/about-us/parish-clerks/st-olave-southwark/) — the page was retrieved through search because the site returns HTTP 403 to direct scripted access; its text records royal patronage before the Conquest, a probable origin from at least 1018, Domesday evidence in 1086 and the first named reference in 1096.

**Exact correction:** start at 1018 as a display anchor, set `continues: true`, remove the invented 1096 `built` endpoint, mark the form as unknown/placeholder, and explain the 1018/1086/1096 evidence in `dateNote`.

### DS-LON-005 — “Londinium founded” is dated to one unsupported year (S2)

**App claim:** The event is labelled “Londinium founded” at year 48 while its own note says the earliest dated feature is a road drain of 47 CE and that no foundation date is documented.

**What is wrong:** A broad emergence around 47–50 CE has been converted into an asserted foundation at 48. The label claims an event the note explicitly denies.

**Evidence:** [London Museum, Roman London timeline](https://www.londonmuseum.org.uk/collections/london-stories/timeline-roman-london-londinium/).

**Exact correction:** use year 47 as the display anchor; rename the event “Earliest dated feature at Londinium”; retain the drain date and the c. 47–50 emergence in the note.

### DS-LON-006 — St Mary Overie: the Domesday minster is missing (S2)

**App claim:** The summary starts with the Augustinian refoundation of 1106 and calls the first phase “Norman priory church”, so no church is shown at the cathedral site before 1106.

**What is wrong:** Southwark Cathedral says the first written reference is a “minster” in Domesday Book in 1086 and that the church was “re-founded” in 1106. The Victoria County History likewise describes the establishment of Augustinian canons as a refoundation. The model therefore removes an attested church from 1086 to 1106 and presents the Augustinian house as a new foundation.

**Evidence:** [Southwark Cathedral, Our history](https://cathedral.southwark.anglican.org/about-us/our-history/); [VCH London vol. 1, Austin canons: Priory of Southwark](https://www.british-history.ac.uk/vch/london/vol1/pp480-484).

**Exact correction:** prepend a continuing, form-unknown minster phase from 1086 to 1106; explain that the 7th-century nunnery is later verbal tradition while 1086 is the first written reference; shift the existing three phases unchanged. The exact four-phase array is in `findings.json`.

## Other verified defects

### DS-LON-007 — St Mary Overie's heightened tower appears instantly (S4)

The tower extension starts in 1520 with `continues: true` and no `built` year, so the new upper stages are complete immediately. The Victoria County History says the two upper stages were built between 1520 and 1528. Set `built: 1528`, keep `continues: true` so the existing church remains while the extension is built, and relabel the campaign. Evidence: [VCH Surrey vol. 4, St Mary Overie](https://www.british-history.ac.uk/vch/surrey/vol4/pp151-161).

### DS-NAT-001 — National Brentford battle relies only on Wikipedia (S3)

The national record is `attested-documentary`, admits that its dates currently rely only on Wikipedia, and lists only `nat-wp-brentford-1016`. The Anglo-Saxon Chronicle directly supplies the 1016 crossing and fight; the Victoria County History discusses the south-bank location and the uncertainty. Replace the national source list with the existing global source IDs `ev-the-anglo-saxon-chronicle-eleventh-century-entry` and `ev-ealing-and-brentford-growth-of-brentford-in-a-hi`, and rewrite the uncertainty to distinguish the documented crossing from the unlocated battlefield. Evidence: [Anglo-Saxon Chronicle, 1016](https://avalon.law.yale.edu/medieval/ang11.asp); [VCH Middlesex vol. 7, Growth of Brentford](https://www.british-history.ac.uk/vch/middx/vol7/pp113-120).

This is a provenance defect, not a challenge to the 1016 date. Astra already confirmed the dated phase.

## National battles

All 28 battle dates and summaries were checked against the available Battlefields Trust, Historic England, Coflein/Cadw and documentary evidence. The 19 English battle records with Battlefields Trust pages all returned HTTP 200 and carried the matching year. No new S1/S2 error was found.

| Battle | Year | Site status retained |
|---|---:|---|
| Dyrham | 577 | Place-name identification; narrative written centuries later |
| Ellendun | 825 | Probably Wroughton; exact field unknown |
| Edington | 878 | Probably Wiltshire; long-disputed site |
| Brunanburh | 937 | Unlocated; Bromborough is a candidate marker |
| Maldon | 991 | Probably mainland opposite Northey Island |
| **Brentford** | **1016** | **Crossing/battlefield unlocated; source defect DS-NAT-001** |
| Assandun | 1016 | Ashingdon or Ashdon; unlocated |
| Fulford | 1066 | Approximately Germany Beck / Fulford Ings |
| Stamford Bridge | 1066 | Competing interpretations; not a surveyed battle centre |
| Hastings | 1066 | Probably accurately located around Battle Abbey |
| The Standard | 1138 | Probably north of Northallerton |
| Lewes | 1264 | Securely placed north of the town |
| Evesham | 1265 | Approximately Greenhill |
| Neville's Cross | 1346 | Accurately located north of Neville's Cross |
| Otterburn | 1388 | Approximately north-west of the village; day disputed |
| Shrewsbury | 1403 | Securely located at Battlefield |
| First St Albans | 1455 | Securely placed in the town centre |
| Towton | 1461 | Securely placed between Saxton and Towton |
| Barnet | 1471 | Area certain; exact field unknown |
| Tewkesbury | 1471 | Securely south of the town |
| Bosworth | 1485 | Reassessed 3 km south-west of the traditional site |
| Stoke Field | 1487 | Approximately west of East Stoke |
| Flodden | 1513 | Securely placed south of Branxton |
| Mynydd Carn | 1081 | Unlocated; Coflein grid reference is one suggestion |
| Crug Mawr | 1136 | Probably Banc-y-Warren; chronicle places it nearer Cardigan |
| Orewin Bridge | 1282 | Location weakly documented; Llywelyn's death disputed |
| Bryn Glas | 1402 | Hill west of Pilleth church is traditional, not established by fieldwork |
| Bryn Derwin | 1255 | Unlocated; Bwlch Derwin is the usual identification |

**Brentford and Barnet sites:** the detailed site records are not overconfident. Brentford uses stand-ins for armies and shaded candidate crossing areas; the episode explicitly says the scene does not show the fight. Barnet separates the registered Hadley Green area from the Kitts End alternative, marks the deployment blocks as conjectural, and records the 2015–18 survey's failure to find a conclusive battle scatter. No site-level correction is proposed.

## Astra comparison

**No disagreement is recorded.** I did not repeat Astra's L01–L11 London findings, including the Westminster nave and roof, Greyfriars construction, Mithraeum cult identity, St Bartholomew surrender, Blackfriars theatres, the earlier Westminster monastery, and Guildhall completion.

My lifecycle findings use the semantics Astra itself documented: `continues: true` without `built` completes the new form immediately, while `continues: true` plus a later `built` is an extension whose predecessor is held until the added work finishes. The St Mary Overie tower and Charterhouse issues apply that rule to claims and objects Astra left individually unadjudicated. The national Brentford date is not challenged; its Wikipedia-only bibliography remains a separate S3 omission.

## Systemic patterns

1. **Construction campaigns disappear when a continuing phase has no `built` year.** St Mary Overie's 1520–28 tower work is the clean example. The same pattern is why Astra's Westminster, Westminster Hall and Greyfriars findings are technically credible.
2. **Institutional closure is still treated as physical continuity or instantaneous demolition.** Charterhouse keeps “Carthusian monastery” for seven years after the community was dispersed. A precinct can survive while its institution does not.
3. **Attestation dates become construction dates.** St Olave's 1096 naming becomes completion, while Londinium's 47–50 emergence becomes a foundation event at 48.
4. **Major replacements can hide inside a single unbroken record.** Custom House shows one building from 1382 to 1625 despite a documented 1559 replacement.
5. **An omission can be more misleading than a wrong number.** St Mary Overie's model contains plausible 1106, 1212 and 1520 boundaries but erases the documented Domesday minster, so the visible succession is wrong before the first phase begins.
6. **Entity confidence is not phase confidence.** A high-confidence surviving building or excavated site does not establish every institutional boundary, replacement and campaign encoded in its phases.
7. **Source registries are not composition-safe by default.** Brentford's excellent site bibliography was not propagated into the separate national dataset, leaving the same battle with a Wikipedia-only national citation.

## Claims tested hardest and not broken

- **Old London Bridge, begun 1176 and completed 1209.** Stow gives the 33-year campaign and 1209 completion; Current Archaeology independently uses 1209. No change proposed. [Stow, Bridges of this Citie](https://www.british-history.ac.uk/no-series/survey-of-london-stow/1603/pp21-27); [Current Archaeology](https://the-past.com/current-archaeology/391/feature/life-across-the-water-exploring-london-bridge-and-its-houses/).
- **Edward the Confessor's church consecrated in 1065.** Westminster Abbey gives 28 December 1065. This confirms the displayed church, not every part of the monastic site. [Westminster Abbey history](https://www.westminster-abbey.org/history/history-of-westminster-abbey).
- **Henry VII's Chapel, 1503–1516.** The Abbey gives the foundation stone on 24 January 1503 and consecration on 19 February 1516. [Westminster Abbey, Henry VII](https://www.westminster-abbey.org/abbey-commemorations/royals/henry-vii-and-elizabeth-of-york).
- **Temple Church round nave consecrated in 1185.** The Temple Church's own history says the Round was consecrated in 1185 and distinguishes it from the later chancel. [Temple Church history](https://www.templechurch.com/history).
- **Banqueting House:** the predecessor burned in 1619 and Inigo Jones's replacement is conventionally complete in 1622. The phase sequence is coherent; no correction was needed.
- **White Tower c. 1078–1100.** The app preserves “begun in the 1070s, complete by about 1100” and does not claim a day or year of completion.
- **Royal Exchange 1566–68.** The construction interval and 1571 naming are treated separately; no source read displaced either boundary.
- **Brentford and Barnet chronology.** The 1016 and 14 April 1471 dates are secure. The uncertainty lies in site, deployment, numbers and course, all of which the site models explicitly label as unknown or conjectural.
- **All 28 national battle years.** No date changed after comparison with Battlefields Trust, Historic England, Coflein/Cadw or the documentary record.
- **Fleet and Walbrook.** The app's broad open-river / gradual-concealment treatment survives the available evidence; no BCE typo or impossible terminal date was found.

## What remains unverified

- Historic England's Heritage Gateway record and the London Parish Clerks page returned HTTP 403 to direct scripted requests. Their relevant text was obtained through search retrieval, then checked against English Heritage, the Victoria County History and the app's own record. The two URLs are retained because they identify the exact pages, but they were not read as unrestricted raw HTML in this pass.
- No browser or build was run. This review verifies data and lifecycle semantics, not the rendered geometry, camera views, materials, colours or animation timing.
- Dimensions, exact building plans, roof forms and the appearance of generic models were not independently verified unless a finding explicitly discusses them. Many are already labelled estimates or placeholders.
- Exact battlefield positions remain unknown for Brentford, Barnet and several national battles. This review preserves those limits rather than replacing one guess with another.
- The app's 121 high-confidence London rows were inspected at entity/phase level. That does not independently establish every inherited coordinate, model dimension, material or size value.
- The Victoria County History, Surrey gives 1207 for a destructive St Mary Overie fire, while Stow and VCH London support the 1212 Southwark/bridge fire used by the app. I have not treated that conflict as a new finding because the 1212 event and bridge fire are independently supported.
- Dyrham, Ellendun and Edington still have thin non-Wikipedia provenance. Astra had already recorded those limitations; I did not duplicate them and found no new reason to change their years.
- The generated database and current JSON differ where corrections agents may have changed data. Every proposed correction above was checked against the current JSON, not assumed from the snapshot.
- No `docs/CORRECTIONS.md` was present in this workspace.

## Validation

`findings.json` parses as a JSON array; all eight objects contain the required schema keys, non-empty evidence arrays and permitted severity/status/confidence values. The current Brentford national source IDs proposed in the correction resolve through `data/sources.json`, which is merged by the national loader. Every write from this review is confined to `research/reviews/deepseek/`.
