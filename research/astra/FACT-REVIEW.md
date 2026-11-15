# Adversarial fact review — London Through Time

Checked 2026-11-14. Reviewer: **gpt-6-astra**. Scope: England and Wales, 4000 BCE–1625 CE; London, Brentford, Barnet, and a deliberately lighter final Stonehenge pass.

**142 current review targets: 50 verified, 34 disputed, 13 rejected and 45 unverifiable.** The reviews identify **12 S1, 35 S2 and 45 S3 problems**. 49 correction proposals and 8 sourced additional statements are stored in `data/db/curated.sqlite`. None has been applied to application JSON.

The most consequential errors are buildings appearing complete at the start of construction, early polities disappearing in AD 43, Cuthbert’s death being moved to his burial island, and intact post-Dissolution buildings being turned instantly into ruins. The imported research also contains false positives: several proposed “omissions” are already present or explicitly caveated.

## Counts and interpretation

| Verdict in report | SQLite verdict | Rows |
|---|---|---:|
| Verified | `confirmed` | 50 |
| Disputed | `disputed` | 34 |
| Rejected | `rejected` | 13 |
| Unverifiable | `unverifiable` | 45 |

| Severity | Meaning | Rows |
|---|---|---:|
| S1 | Wrong visible date, place, existence or stated fact | 12 |
| S2 | Misleading or overconfident interpretation | 35 |
| S3 | Citation or sourcing defect | 45 |
| S4 | Minor wording | 0 |

Counts are latest reviews per target, not distinct root causes. The append-only table contains 144 rows for this run: 2 earlier source-limitation reviews were superseded after additional evidence resolved the Edington and Ellendun years. Verified rows have no problem severity. S3 bibliography-only reviews do not assert that the underlying history is false. Additional omission statements are listed separately below and are not added again to these counts. The schema permits `confirmed`, not `verified`; the required reviewer name is unchanged, and each note records the display-verdict mapping. No schema was altered.

## Evidence and coverage

The preserved generated snapshot contains **3,434 fact rows**, 243 national places, 73 London landmarks, 28 national battles, 42 line features and 72 polities. It was captured at `2026-11-14T05:56:46.788599+00:00`; its build input fingerprint is `ef8a96b0829dacb217c386da8811e4cb603152821f90cb8488e97c999d9c7408`. The brief’s approximate 2,900 count is outdated. Stonehenge was populated in this snapshot; its old missing-source warning is also outdated (zero dangling citations).

All rows received calendar/range and citation-metadata screening. Priority review inspected London’s landmark sequences; all 43 places reaching size 4–5; all 28 battles; the Roman network and all polity dates; the 544 attested/high rows grouped by their 84 owning entities; and episode attested/tradition/unknown distinctions. **This is not a claim that every field was independently verified.** 43 of the 544 strongest rows have individual verdicts; the rest remain explicitly unadjudicated in [the coverage ledger](factkeeper-coverage.csv). Source reading and comparison were performed at entity/claim level, so one sound foundation date did not certify its location, size and later phases.

The secondary systematic sample takes every twelfth national place, sorted by namespaced id, after excluding battles, high-confidence places and any place reaching size 4: 12 entities from a pool of 137. The selection and inspected passages are in [the sampling record](factkeeper-systematic-sample.json). Its unsourced cases were left unverified.

All **77 non-agreement leads** from the 248-comparison research file were rechecked against their cited pages/texts and the current app snapshot. [The complete comparison ledger](factkeeper-comparison-review.json) records accepted findings, existing caveats, disagreements and optional enrichments. The 171 agreement-only links were not accepted as proof.

Availability checks attempted **554 distinct URLs**, including the registered app bibliography, lead citations and added sources. HTTP status counts: `{'200': 542, 'network error': 1, '400': 3, '403': 8}`. 3 HTTP-200 responses were browser-challenge pages, not readable sources. Selected blocked sources were recovered through web retrieval; the ODNB check used its public extract, not paywalled full text. [The fetch manifest](factkeeper-fetch-manifest.json) and [passage log](factkeeper-read-log.jsonl) distinguish retrieval from reading. No 403, timeout, API endpoint response or login challenge has been called a dead historical source merely for blocking automation.

Coordinates were tested against published *reference markers*, not treated as ground-truth battlefield centres. Sixteen Battlefields Trust grid references could be converted and compared: offsets range from about 5 to 353 m; Bosworth agrees to about 5 m. These differences do not establish battlefield extent. Torksey’s camp centre is about 1 km north of the app’s town marker. The [coordinate calculations](factkeeper-coordinate-check.json) retain the source and method.

## Full S1 and S2 findings

### London

#### L01 — Westminster nave complete 141 years too early (S1; rejected)

**App:** Westminster Abbey: Abbey with nave completed westwards [1376]. Context: Nave built slowly 1376–1517. No west towers before 1745.

**Finding:** The phase begins in 1376 with continues=true and no built year, although its own dateNote says 1376–1517. The Abbey’s nave history explicitly gives completion in 1517. Under the documented lifecycle this displays the finished westward nave at the start of the campaign.

**Evidence, accessed 2026-11-14:** [Westminster Abbey: The Nave](https://www.westminster-abbey.org/history/explore-our-history/nave).

**Exact proposal** (high confidence; review row 1). Target `landmark:london/westminster-abbey:phase:2`; `data/locations/london/landmarks.json`:

```json
{
  "file": "locations/london/landmarks.json",
  "new_values": {
    "$[36].phases[2].built": 1517,
    "$[36].phases[2].continues": false,
    "$[36].phases[2].label": "Westward nave rebuilding (1376–1517)"
  }
}
```


#### L02 — Westminster roof appears when commissioned (S1; rejected)

**App:** Westminster Hall and Palace: Hall with hammerbeam roof [1393]. Context: Roof commissioned 1393, substantially built 1397–99, work ceased 1401.

**Finding:** 1393 is the commission date. Parliament dates the lanterns to 1397–98 and says decorative work remained unfinished when work stopped in 1401. continues=true with no built date falsely makes the new roof complete in 1393. Use 1399 only as a labelled substantial-completion display anchor, not an exact completion claim.

**Evidence, accessed 2026-11-14:** [The hammer-beam roof](https://www.parliament.uk/about/living-heritage/building/palace/westminsterhall/architecture/the-hammer-beam-roof-/).

**Exact proposal** (medium confidence; review row 2). Target `landmark:london/westminster-hall:phase:1`; `data/locations/london/landmarks.json`:

```json
{
  "file": "locations/london/landmarks.json",
  "new_values": {
    "$[38].phases[1].built": 1399,
    "$[38].phases[1].continues": false,
    "$[38].phases[1].label": "Hammerbeam roof campaign; substantially complete by about 1399",
    "$[38].phases[1].dateNote": "Commissioned 1393; lanterns completed 1397–98; decorative work still unfinished when work stopped in 1401. The built value 1399 is an approximate display anchor."
  }
}
```


#### L03 — Greyfriars finished church shown in foundation year (S1; rejected)

**App:** Greyfriars (Christ Church): Great church [1306]. Context: Great church built 1306–27 (300 × 89 × 64 ft); kept as Christ Church parish church from 1547.

**Finding:** VCH records the foundation stone in 1306 and completion in 1327. The phase has continues=true and omits built, so the documented 21-year construction period disappears.

**Evidence, accessed 2026-11-14:** [Friaries: The grey friars (VCH London vol. 1)](https://www.british-history.ac.uk/vch/london/vol1/pp502-507).

**Exact proposal** (high confidence; review row 3). Target `landmark:london/greyfriars:phase:1`; `data/locations/london/landmarks.json`:

```json
{
  "file": "locations/london/landmarks.json",
  "new_values": {
    "$[46].phases[1].built": 1327,
    "$[46].phases[1].continues": false
  }
}
```


#### L04 — Timber bridge survives the 1091 storm in the chronology (S2; disputed)

**App:** Late Saxon and Norman timber bridge: Timber bridge [990 → 1135]. Context: In existence by c. 1000. The 1014 'pulling down' is saga tradition only; burned in 1135 or 1136 depending on the source.

**Finding:** The single intact 990–1135 phase omits the bridge’s destruction in the 1091 storm recorded by London Museum. The rebuilding year is not supplied by that source. Do not invent an exact replacement date; qualify this phase as a succession of bridges and record the destruction separately.

**Evidence, accessed 2026-11-14:** [London Bridge](https://www.londonmuseum.org.uk/collections/london-stories/london-bridge/).

**Exact proposal** (high confidence; review row 4). Target `landmark:london/saxon-bridge:phase:0`; `data/locations/london/landmarks.json`:

```json
{
  "file": "locations/london/landmarks.json",
  "new_values": {
    "$[21].phases[0].label": "Successive timber bridges; storm destruction in 1091",
    "$[21].phases[0].dateNote": "A bridge existed by about 1000. London Museum records destruction by the storm of 1091; the exact rebuilding chronology is unresolved. This phase represents successive bridges, not one intact structure."
  }
}
```


#### L05 — Mithraic use extended past repurposing (S2; disputed)

**App:** Temple of Mithras: Mithraeum [240 → 380]. Context: Built c. 240–250; out of use in the late 4th century.

**Finding:** MOLA dates construction to AD 240–250 and Mithraic use for about 80 years before repurposing. The phase calls the building a Mithraeum until 380 despite the summary acknowledging an early-fourth-century conversion. The structure may survive; its cult identity must not be held constant.

**Evidence, accessed 2026-11-14:** [Mithras and Mithraism: top 10 things you need to know](https://www.mola.org.uk/node/29561).

**Exact proposal** (high confidence; review row 5). Target `landmark:london/mithraeum:phase:0`; `data/locations/london/landmarks.json`:

```json
{
  "file": "locations/london/landmarks.json",
  "new_values": {
    "$[10].phases[0].label": "Temple: Mithraic until about 320–330, then repurposed",
    "$[10].phases[0].dateNote": "Construction c.240–250; MOLA estimates about 80 years of Mithraic use before repurposing. The 380 phase end is a modelling estimate, not a dated end of Mithraic worship."
  }
}
```


#### L06 — Priory status retained beyond surrender (S2; disputed)

**App:** St Bartholomew's Priory and Hospital: Priory church [1123 → 1543].

**Finding:** VCH dates surrender to October 1539; the church’s history associates dissolution and loss of the nave with 1539. The app keeps a Priory church phase until 1543 without distinguishing institutional closure from gradual demolition. The sources read do not establish 1543 as the exact demolition year.

**Evidence, accessed 2026-11-14:** [Austin canons: Priory of St Bartholomew, Smithfield (VCH London vol. 1)](https://www.british-history.ac.uk/vch/london/vol1/pp475-480); [History](https://www.greatstbarts.com/history/).

**Exact proposal** (high confidence; review row 6). Target `landmark:london/st-bartholomew:phase:0`; `data/locations/london/landmarks.json`:

```json
{
  "file": "locations/london/landmarks.json",
  "new_values": {
    "$[49].phases[0].label": "Priory church; parish use after surrender in 1539",
    "$[49].phases[0].dateNote": "Surrendered October 1539. The date of complete nave demolition needs a fabric-specific source; 1543 is a display boundary, not continued monastic occupation."
  }
}
```


#### L07 — First Blackfriars theatre omitted (S2; disputed)

**App:** Blackfriars: Converted precinct (church demolished) [1538]. Context: Church demolished after 1538; an indoor playhouse occupied the upper frater from 1596 (King's Men from 1608–09).

**Finding:** The converted-precinct dateNote begins theatre use in 1596. EMLoT distinguishes Blackfriars I (1576) from Blackfriars II (1596). The earlier venue matters to the displayed institutional history; neither date means the whole precinct became a theatre.

**Evidence, accessed 2026-11-14:** [Early Modern London Theatres: project scope and theatre dates](https://emlot.org/).

**Exact proposal** (high confidence; review row 7). Target `landmark:london/blackfriars:phase:1`; `data/locations/london/landmarks.json`:

```json
{
  "file": "locations/london/landmarks.json",
  "new_values": {
    "$[45].phases[1].dateNote": "Church demolished after dissolution in 1538. Blackfriars I theatre opened in 1576; Blackfriars II was established in 1596, with the King’s Men using it from 1608–09. These were distinct venues within the former precinct."
  }
}
```


#### L08 — Westminster’s earlier monastery missing from its history (S2; disputed)

**App:** Westminster Abbey: Edward the Confessor's abbey [1045].

**Finding:** 1045 dates the displayed Confessor campaign, not the beginning of monastic Westminster. The Abbey’s history records a Benedictine monastery founded around 960. Add that distinction in the summary without inventing an excavated building form.

**Evidence, accessed 2026-11-14:** [History of Westminster Abbey](https://www.westminster-abbey.org/history/history-of-westminster-abbey).

**Exact proposal** (high confidence; review row 8). Target `landmark:london/westminster-abbey:begun:0`; `data/locations/london/landmarks.json`:

```json
{
  "file": "locations/london/landmarks.json",
  "new_values": {
    "$[36].summary": "A Benedictine monastery existed here from about 960; its appearance is not reconstructed. Edward the Confessor enlarged it in the 1040s, and his church was consecrated in 1065. Henry III’s Gothic rebuilding began in 1245; the westward nave was completed in 1517. The eighteenth-century west towers are outside this timeline."
  }
}
```


#### L11 — Guildhall’s precise completion is not established by its citation (S2; disputed)

**App:** Guildhall: Great Hall [1430]. Context: Hall c. 1411–30; precinct complete c. 1450.

**Finding:** The City of London’s own page dates building to 1411–1440; the Gresham lecture describes a wider 1411–1450 civic campaign. Neither inspected source establishes the app’s high-confidence 1430 completion of this model. Do not mechanically replace it with 1450, which includes the precinct.

**Evidence, accessed 2026-11-14:** [The many lives of Guildhall](https://www.guildhall.cityoflondon.gov.uk/visual-guides/the-many-lives-of-guildhall); [Envy of Kings: The Guildhall of London and the Power of the Medieval Corporation](https://www.gresham.ac.uk/node/13035).

**Exact proposal** (high confidence; review row 11). Target `landmark:london/guildhall:completed:0`; `data/locations/london/landmarks.json`:

```json
{
  "file": "locations/london/landmarks.json",
  "new_values": {
    "$[52].confidence": "medium",
    "$[52].phases[0].dateNote": "Begun 1411. City of London gives a 1411–1440 building campaign; the wider precinct campaign ran to about 1450. The built value 1430 is provisional and requires a hall-specific source."
  }
}
```


### National map — England and Wales

#### N01 — Cuthbert died on Inner Farne, not Lindisfarne (S1; rejected)

**App:** Lindisfarne: Lindisfarne. Context: Founded in 635 from Iona. Cuthbert died here in 687 and the Lindisfarne Gospels were made about 710-725. Raided on 8 June 793, left for good in 875, and refounded as a cell of Durham by 1122 until its closure in 1537.

**Finding:** The app’s “died here” confuses death with burial. Bede IV.29 places his last retreat and death in his island solitude before burial at Lindisfarne; National Trust’s Farne history explicitly identifies Inner Farne. The app’s English Heritage page gives death followed by burial, without saying that the death occurred on Lindisfarne.

**Evidence, accessed 2026-11-14:** [Bede, Ecclesiastical History of England, translated A. M. Sellar (1907)](https://www.gutenberg.org/files/38326/38326-h/38326-h.html); [National Trust: Farne Islands inhabitants](https://www.nationaltrust.org.uk/visit/north-east/farne-islands/history-of-the-farne-islands-inhabitants); [History of Lindisfarne Priory](https://www.english-heritage.org.uk/visit/places/lindisfarne-priory/history/).

**Exact proposal** (high confidence; review row 25). Target `place:england-wales/lindisfarne:located_at`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[74].summary": "Founded in 635 from Iona. Cuthbert died on Inner Farne in 687 and was buried here and the Lindisfarne Gospels were made about 710-725. Raided on 8 June 793, left for good in 875, and refounded as a cell of Durham by 1122 until its closure in 1537."
  }
}
```


#### N02 — Welsh law manuscripts placed a century too late (S1; rejected)

**App:** Lands of Hywel Dda: realm: Lands of Hywel Dda [942 → 950]. Context: Hywel held Seisyllwg from 920 and Dyfed by marriage, and on the death of Idwal Foel in 942 took Gwynedd (and with it Powys), ruling all Wales except Morgannwg and Gwent until his death in 950. The Welsh law-books are attributed to him, though no manuscript is earlier than the 13th century. His kingdom broke up at his death.

**Finding:** Dictionary of Welsh Biography explicitly dates the earliest extant law manuscript to the last quarter of the twelfth century. “No manuscript is earlier than the 13th century” is false. Manuscript survival also does not provide contemporary proof that Hywel personally compiled the laws.

**Evidence, accessed 2026-11-14:** [Hywel Dda (died 950), king and legislator](https://biography.wales/article/s-HYWE-DDA-0950.html).

**Exact proposal** (high confidence; review row 26). Target `polity:england-wales/hywel-dda:existed`; `data/national/polities-wales.json`:

```json
{
  "file": "national/polities-wales.json",
  "new_values": {
    "$[16].note": "Hywel held Seisyllwg from 920 and Dyfed by marriage, and on the death of Idwal Foel in 942 took Gwynedd (and with it Powys), ruling all Wales except Morgannwg and Gwent until his death in 950. The Welsh law-books are attributed to him, though the earliest surviving manuscript dates from the last quarter of the 12th century and the attribution is not contemporary. His kingdom broke up at his death."
  }
}
```


#### N03 — Northumbria is absent during Edwin and Oswald (S1; rejected)

**App:** Kingdom of the Northumbrians: kingdom: Kingdom of the Northumbrians [654 → 867]. Context: Bernicia and Deira united. At its height it ran from the Humber and Mersey to the Firth of Forth; the polygon shows about 700 and is cut off at the northern edge of this map. York fell to the Great Army in 867. Frontiers were zones of shifting lordship, not lines. Dates are supported here only by Wikipedia, which is a lead rather than verification.

**Finding:** A first existence in 654 is incompatible with Bede’s accounts of Edwin ruling both components and Oswald restoring Northumbrian rule before 642. English Heritage independently describes Oswald’s accession in 634. A single continuous polygon cannot represent every division. The proposed minimal correction labels its scope from Oswald; earlier unions still need separate records.

**Evidence, accessed 2026-11-14:** [Bede, Ecclesiastical History of England, translated A. M. Sellar (1907)](https://www.gutenberg.org/files/38326/38326-h/38326-h.html); [History of Lindisfarne Priory](https://www.english-heritage.org.uk/visit/places/lindisfarne-priory/history/).

**Exact proposal** (medium confidence; review row 27). Target `polity:england-wales/northumbria:existed`; `data/national/polities.json`:

```json
{
  "file": "national/polities.json",
  "new_values": {
    "$[33].from": 634,
    "$[33].name": "Northumbrian kingship from Oswald (earlier unions not shown)",
    "$[33].note": "Oswald reunited Northumbrian rule in 634, following earlier unions under Æthelfrith and Edwin. Bernicia and Deira were divided again after Oswald’s death in 642 and reunited later; this single display range does not assert uninterrupted unified government. The indicative polygon depicts about 700, not every year from 634. Earlier kingships require separate phases; 654 is not the first existence of Northumbria."
  }
}
```


#### N04 — Grimspound climate-driven abandonment is invented (S2; rejected)

**App:** Grimspound: Abandoned as the upland climate worsened [-800].

**Finding:** English Heritage says the duration of use is unknown and discusses settlement change by about 1000 BCE with erosion and soil nutrient loss. It does not establish abandonment in 800 BCE caused by worsening climate. Reject the causal claim and qualify the nominal phase boundary.

**Evidence, accessed 2026-11-14:** [History of Grimspound](https://www.english-heritage.org.uk/visit/places/grimspound/history/).

**Exact proposal** (high confidence; review row 28). Target `place:england-wales/grimspound:phase:1`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[16].phases[1].label": "Surviving settlement remains; end of occupation uncertain",
    "$[16].phases[1].note": "800 BCE is a display cutoff, not a dated abandonment. Duration of use is unknown; English Heritage describes changing settlement by about 1000 BCE and soil erosion, not a proven climate event."
  }
}
```


#### N05 — Coflein’s catalogue point is mistaken for a battlefield candidate (S2; disputed)

**App:** Battle of Mynydd Carn: Battle of Mynydd Carn. Context: In 1081 Gruffudd ap Cynan, returning from exile in Ireland, and Rhys ap Tewdwr defeated and killed Trahaearn ap Caradog, Caradog ap Gruffudd and Meilyr ap Rhiwallon. The victory secured Gwynedd for Gruffudd’s line and Deheubarth for Rhys’s.

**Finding:** Coflein’s heading and grid reference are near Templeton, but its documentary assessment favours northern Pembrokeshire in Cemais, around the Carningli–Llanllawer–Dinas hills. The source does not establish its catalogue point as a historically supported candidate. The app admits the site is unknown, but still calls this point one suggestion without explaining the contradiction. No exact replacement coordinate is justified.

**Evidence, accessed 2026-11-14:** [Battle of Mynydd Carn (NPRN 300319), site record](https://coflein.gov.uk/en/site/300319/).

**Exact proposal** (high confidence; review row 29). Target `place:england-wales/battle-mynydd-carn:located_at`; `data/national/places-wales.json`:

```json
{
  "file": "national/places-wales.json",
  "new_values": {
    "$[65].name": "Mynydd Carn (unlocated; catalogue reference marker)",
    "$[65].uncertainty": "The battlefield is unlocated. Coflein’s catalogue marker is near Templeton, while its documentary discussion favours northern Pembrokeshire in Cemais. The displayed point is not a verified battlefield or a source-supported candidate; it is a catalogue reference only."
  }
}
```


#### N06 — Wearmouth’s foundation appears at Jarrow seven years early (S2; disputed)

**App:** Jarrow and Wearmouth: Wearmouth founded; Jarrow follows in 681 [674 → 800].

**Finding:** The entity deliberately combines Wearmouth and Jarrow but its marker is at Jarrow. Cambridge’s handbook and English Heritage distinguish Wearmouth 674 from Jarrow c.681, with dedication in 685. Retain the two-house explanation but date the Jarrow marker from its own foundation.

**Evidence, accessed 2026-11-14:** [Anglo-Saxon England: a bibliographical handbook for students of Anglo-Saxon history](https://www.asnc.cam.ac.uk/resources/ASHistBib06.pdf); [History of St Paul's Monastery, Jarrow](https://www.english-heritage.org.uk/visit/places/st-pauls-monastery-jarrow/history/).

**Exact proposal** (high confidence; review row 30). Target `place:england-wales/jarrow:phase:0`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[75].phases[0].from": 681,
    "$[75].phases[0].label": "Jarrow monastery; twin of Wearmouth (founded 674)",
    "$[75].phases[0].note": "Jarrow founded c.681; church dedicated 23 April 685. Wearmouth’s earlier foundation belongs to a different site about 10 km away."
  }
}
```


#### N07 — Rhodri’s acquisition of Powys is too definite (S2; disputed)

**App:** Lands of Rhodri Mawr: realm: Lands of Rhodri Mawr [872 → 878]. Context: Rhodri became king of Gwynedd in 844, took Powys in 855 and Seisyllwg in 872, so that for a few years one king ruled most of Wales outside the south-east and Dyfed. He was killed fighting the English; the Dictionary of Welsh Biography gives 877, other reckonings 878. His sons divided the lands. No boundary is drawn because none is known.

**Finding:** Thornton’s ODNB extract says control of Powys was possible in 855 or at some later date. The app turns that qualified reconstruction into a fixed event. This correction does not settle the independent 877/878 death-date issue.

**Evidence, accessed 2026-11-14:** [Rhodri Mawr (b. before 844, d. 878), king of Gwynedd](https://academic.oup.com/oxford-dictionary-of-national-biography/reference/63486/reference-article-abstract/581824952).

**Exact proposal** (high confidence; review row 31). Target `polity:england-wales/rhodri-mawr:existed`; `data/national/polities-wales.json`:

```json
{
  "file": "national/polities-wales.json",
  "new_values": {
    "$[15].note": "Rhodri became king of Gwynedd in 844, may have taken control of Powys in or after 855 and Seisyllwg in 872, so that for a few years one king ruled most of Wales outside the south-east and Dyfed. He was killed fighting the English; the Dictionary of Welsh Biography gives 877, other reckonings 878. His sons divided the lands. No boundary is drawn because none is known."
  }
}
```


#### N08 — Rhodri’s acquisition of Powys is too definite (S2; disputed)

**App:** Powys: kingdom: Powys [500 → 1160]. Context: The kingdom of the central borderland. Its early extent reached further east, into what became Shropshire, before Mercian expansion and the building of Offa’s Dyke. Rhodri Mawr took it over in 855. It was divided for good after the death of Madog ap Maredudd in 1160. The polygon is indicative for about 1100-1160; it is not a surveyed boundary. The start date is conventional.

**Finding:** Thornton’s ODNB extract says control of Powys was possible in 855 or at some later date. The app turns that qualified reconstruction into a fixed event. This correction does not settle the independent 877/878 death-date issue.

**Evidence, accessed 2026-11-14:** [Rhodri Mawr (b. before 844, d. 878), king of Gwynedd](https://academic.oup.com/oxford-dictionary-of-national-biography/reference/63486/reference-article-abstract/581824952).

**Exact proposal** (high confidence; review row 32). Target `polity:england-wales/powys:existed`; `data/national/polities-wales.json`:

```json
{
  "file": "national/polities-wales.json",
  "new_values": {
    "$[5].note": "The kingdom of the central borderland. Its early extent reached further east, into what became Shropshire, before Mercian expansion and the building of Offa’s Dyke. Rhodri Mawr may have taken control in 855 or later. It was divided for good after the death of Madog ap Maredudd in 1160. The polygon is indicative for about 1100-1160; it is not a surveyed boundary. The start date is conventional."
  }
}
```


#### N09 — Winchester’s exclusive largest-burh claim is unsupported (S2; disputed)

**App:** Winchester: Winchester. Context: Roman Venta, refounded by Alfred with a new street grid and the largest burh in the Burghal Hidage. It was second only to London at Domesday but thirtieth in the 1377 poll tax.

**Finding:** The Burghal Hidage edition gives Winchester and Wallingford the same 2,400-hide assessment. It measures assessed defensive support, not a population census. The app’s own Wallingford entry recognises the tie. Replace the exclusive superlative with the actual assessment.

**Evidence, accessed 2026-11-14:** [The Burghal Hidage: the establishment of a text](https://archaeologydataservice.ac.uk/catalogue/adsdata/arch-769-1/dissemination/pdf/vol13/13_084_092.pdf).

**Exact proposal** (high confidence; review row 33). Target `place:england-wales/winchester:located_at`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[35].summary": "Roman Venta, refounded by Alfred with a new street grid and one of the joint-highest assessed burhs in the Burghal Hidage (2,400 hides, also assigned to Wallingford). It was second only to London at Domesday but thirtieth in the 1377 poll tax."
  }
}
```


#### N10 — Lewes repeats the source’s shorthand but omits its qualification (S2; disputed)

**App:** Battle of Lewes: Battle of Lewes. Context: Simon de Montfort captured Henry III and the Lord Edward on 14 May 1264 and ruled in the king's name for a year.

**Finding:** The Trust’s data box calls the locality secure, but its narrative explicitly says the exact ground between Offham Hill and the medieval town is uncertain. A high-confidence precise point plus the abridged uncertainty note suppresses that distinction.

**Evidence, accessed 2026-11-14:** [Battle of Lewes - 1264](https://www.battlefieldstrust.com/resource-centre/medieval/battleview.asp?BattleFieldId=22).

**Exact proposal** (high confidence; review row 34). Target `place:england-wales/battle-lewes:located_at`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[161].confidence": "medium",
    "$[161].uncertainty": "The battle date, 14 May 1264, is secure. The Battlefields Trust locates the general area north of Lewes but says the exact ground between Offham Hill and the medieval town remains uncertain. This point is a reference marker, not a surveyed battle centre."
  }
}
```


#### N11 — St Davids did not first become an episcopal centre in 1115 (S1; rejected)

**App:** St Davids: St Davids. Context: The monastery founded by St David in the 6th century became the leading church of Wales and, under Norman bishops from 1115, a cathedral. The present church was begun in 1181; a 12th-century pope ruled two pilgrimages here equal to one to Rome, and Bishop Henry de Gower built the great palace in 1328-47.

**Finding:** Asser’s ninth-century Life describes bishops of St Davids, including Nobis. The app’s wording makes Norman appointments in 1115 the beginning of cathedral status. Separate the early episcopal institution from later Norman bishops and the surviving fabric.

**Evidence, accessed 2026-11-14:** [Asser’s Life of King Alfred, translated from Stevenson’s text](https://www.gutenberg.org/files/63384/63384-h/63384-h.htm).

**Exact proposal** (high confidence; review row 35). Target `place:england-wales/st-davids:located_at`; `data/national/places-wales.json`:

```json
{
  "file": "national/places-wales.json",
  "new_values": {
    "$[19].summary": "The monastery founded by St David in the 6th century became a leading Welsh episcopal centre long before the first Norman bishop in 1115. Its earlier buildings are poorly known. The present church was begun in 1181; a 12th-century pope ruled two pilgrimages here equal to one to Rome, and Bishop Henry de Gower built the great palace in 1328-47."
  }
}
```


#### N12 — Cistercian affiliation assigned to the foundation day (S2; disputed)

**App:** Fountains Abbey: Cistercian abbey, a great wool producer [1132 → 1539].

**Finding:** National Trust’s detailed foundation account says thirteen Benedictines founded the community in 1132 and it joined the Cistercian order three years later. Its introductory shorthand calls it Cistercian from foundation; the detailed sequence should govern the phase label.

**Evidence, accessed 2026-11-14:** [History of Fountains Abbey and Studley Royal](https://www.nationaltrust.org.uk/visit/yorkshire/fountains-abbey-and-studley-royal-water-garden/history-of-fountains-abbey-and-studley-royal).

**Exact proposal** (high confidence; review row 36). Target `place:england-wales/fountains:phase:0`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[132].phases[0].label": "Monastic community founded 1132; Cistercian from 1135",
    "$[132].phases[0].note": "Foundation and affiliation are distinct: National Trust dates acceptance into the Cistercian order three years after 1132."
  }
}
```


#### N13 — Gariannonum identification presented as certain (S2; disputed)

**App:** Burgh Castle: Gariannonum, Saxon Shore fort on the Great Estuary [280 → 410].

**Finding:** English Heritage says one or both of Burgh Castle and Caister were known as Gariannonum. The app phase names Burgh Castle without qualification.

**Evidence, accessed 2026-11-14:** [History of Burgh Castle](https://www.english-heritage.org.uk/visit/places/burgh-castle/history/).

**Exact proposal** (high confidence; review row 37). Target `place:england-wales/burgh-castle:phase:0`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[58].phases[0].label": "Saxon Shore fort; possibly Gariannonum",
    "$[58].phases[0].note": "The ancient name may refer to Burgh Castle, Caister, or both; the identification is not settled."
  }
}
```


#### N14 — Silbury’s dating bracket becomes 120 years of continuous work (S2; disputed)

**App:** Silbury Hill: Mound under construction [-2470 → -2350].

**Finding:** English Heritage says the mound was probably built over a short period somewhere between c.2470 and 2350 BCE. The app represents that uncertainty interval as an uninterrupted construction phase. The source supports neither an exact start at 2470 nor 120 years of work.

**Evidence, accessed 2026-11-14:** [History of Silbury Hill](https://www.english-heritage.org.uk/visit/places/silbury-hill/history/).

**Exact proposal** (high confidence; review row 38). Target `place:england-wales/silbury-hill:phase:0`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[3].phases[0].label": "Mound building occurred within this approximate dating interval",
    "$[3].phases[0].note": "2470–2350 BCE is a possible chronological bracket. Work probably occupied a short part of that interval, not all 120 years. The model must not be read as a continuous construction schedule."
  }
}
```


#### N15 — Birdoswald’s post-Roman halls have invented exact boundaries (S2; disputed)

**App:** Birdoswald: Timber halls built over the granaries [411 → 519].

**Finding:** English Heritage describes uninterrupted occupation from late Roman times and successive hall buildings; it does not date their first appearance to 411 or abandonment to 520. The phased interpretation is reasonable, the exact switch is not established.

**Evidence, accessed 2026-11-14:** [History of Birdoswald](https://www.english-heritage.org.uk/visit/places/birdoswald-roman-fort-hadrians-wall/history-and-stories/history/).

**Exact proposal** (high confidence; review row 39). Target `place:england-wales/birdoswald:phase:1`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[53].phases[1].note": "The hall sequence bridges late Roman and fifth-century occupation. 411 and 519/520 are display boundaries, not dated construction and abandonment events.",
    "$[53].phases[2].label": "Later occupation uncertain; eventual abandonment",
    "$[53].phases[2].note": "520 is a provisional display cutoff; the source does not fix an abandonment year."
  }
}
```


#### N16 — chesters: an exact abandonment exceeds the evidence (S2; disputed)

**App:** Chesters: Abandoned [411].

**Finding:** The institutional history discusses uncertainty into the late fourth or early fifth century; it does not establish a departure in 411.

**Evidence, accessed 2026-11-14:** [History of Chesters Roman Fort And Museum Hadrians Wall](https://www.english-heritage.org.uk/visit/places/chesters-roman-fort-and-museum-hadrians-wall/history/).

**Exact proposal** (high confidence; review row 40). Target `place:england-wales/chesters:phase:1`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[52].phases[1].label": "Post-Roman occupation and abandonment uncertain",
    "$[52].phases[1].note": "The institutional history discusses uncertainty into the late fourth or early fifth century; it does not establish a departure in 411. The numerical boundary is a display convention.",
    "$[52].confidence": "medium"
  }
}
```


#### N17 — housesteads: an exact abandonment exceeds the evidence (S2; disputed)

**App:** Housesteads: Abandoned [411].

**Finding:** English Heritage gives garrisoning to the end of the fourth century, not a securely dated abandonment on a 410/411 boundary.

**Evidence, accessed 2026-11-14:** [History of Housesteads Roman Fort](https://www.english-heritage.org.uk/visit/places/housesteads-roman-fort-hadrians-wall/history/).

**Exact proposal** (high confidence; review row 41). Target `place:england-wales/housesteads:phase:1`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[51].phases[1].label": "Post-Roman history uncertain",
    "$[51].phases[1].note": "English Heritage gives garrisoning to the end of the fourth century, not a securely dated abandonment on a 410/411 boundary. The numerical boundary is a display convention.",
    "$[51].confidence": "medium"
  }
}
```


#### N18 — corbridge: an exact abandonment exceeds the evidence (S2; disputed)

**App:** Corbridge: Deserted [411].

**Finding:** The history says the town continued until the last days of Roman Britain; it does not establish immediate desertion in 411.

**Evidence, accessed 2026-11-14:** [History of Corbridge Roman Town](https://www.english-heritage.org.uk/visit/places/corbridge-roman-town-hadrians-wall/history-and-stories/history/).

**Exact proposal** (high confidence; review row 42). Target `place:england-wales/corbridge:phase:2`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[49].phases[2].label": "Post-Roman urban decline; exact end uncertain",
    "$[49].phases[2].note": "The history says the town continued until the last days of Roman Britain; it does not establish immediate desertion in 411. The numerical boundary is a display convention.",
    "$[49].confidence": "medium"
  }
}
```


#### N19 — brecon-gaer: an exact abandonment exceeds the evidence (S2; disputed)

**App:** Y Gaer, Brecon: Abandoned fort [300].

**Finding:** Cadw supports foundation around 75 and the cavalry unit, but supplies no 300 abandonment. The app itself calls the end date a guess.

**Evidence, accessed 2026-11-14:** [Y Gaer Roman Fort](https://cadw.gov.wales/visit/places-to-visit/y-gaer-roman-fort).

**Exact proposal** (high confidence; review row 43). Target `place:england-wales/brecon-gaer:phase:1`; `data/national/places-wales.json`:

```json
{
  "file": "national/places-wales.json",
  "new_values": {
    "$[18].phases[1].label": "Later Roman use and eventual abandonment uncertain",
    "$[18].phases[1].note": "Cadw supports foundation around 75 and the cavalry unit, but supplies no 300 abandonment. The app itself calls the end date a guess. The numerical boundary is a display convention."
  }
}
```


#### N20 — segontium: an exact abandonment exceeds the evidence (S2; disputed)

**App:** Segontium: Abandoned fort [394].

**Finding:** Cadw’s c.394 endpoint derives from coins. A last-coin horizon does not prove an exact evacuation in 394, and the app currently makes occupied and abandoned phases overlap in that year.

**Evidence, accessed 2026-11-14:** [Segontium Roman Fort](https://cadw.gov.wales/visit/places-to-visit/segontium-roman-fort).

**Exact proposal** (high confidence; review row 44). Target `place:england-wales/segontium:phase:1`; `data/national/places-wales.json`:

```json
{
  "file": "national/places-wales.json",
  "new_values": {
    "$[9].phases[1].label": "Late Roman decline; final abandonment uncertain",
    "$[9].phases[1].note": "Cadw’s c.394 endpoint derives from coins. A last-coin horizon does not prove an exact evacuation in 394, and the app currently makes occupied and abandoned phases overlap in that year. The numerical boundary is a display convention.",
    "$[9].confidence": "medium"
  }
}
```


#### N21 — whitby: an exact abandonment exceeds the evidence (S2; disputed)

**App:** Whitby: Abandoned [868 → 1077].

**Finding:** English Heritage explicitly says the monastery was abandoned at an unknown point in the ninth century; 867/868 is not a securely dated destruction.

**Evidence, accessed 2026-11-14:** [History of Whitby Abbey](https://www.english-heritage.org.uk/visit/places/whitby-abbey/history-and-stories/history/).

**Exact proposal** (high confidence; review row 45). Target `place:england-wales/whitby:phase:1`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[76].phases[1].label": "Ninth-century abandonment; exact date unknown",
    "$[76].phases[1].note": "English Heritage explicitly says the monastery was abandoned at an unknown point in the ninth century; 867/868 is not a securely dated destruction. The numerical boundary is a display convention.",
    "$[76].confidence": "medium"
  }
}
```


#### N22 — Pevensey falsely deserted throughout the Saxon centuries (S1; rejected)

**App:** Pevensey: Deserted walls [472 → 1065].

**Finding:** English Heritage says reoccupation followed roughly a century after the late-fifth-century siege and identifies possible high-status Saxon occupation. The app labels every year 472–1065 deserted. Also, its source gives 471 while the consulted Ingram/Giles Chronicle has 490: neither licenses an unqualified precise siege boundary.

**Evidence, accessed 2026-11-14:** [History of Pevensey Castle](https://www.english-heritage.org.uk/visit/places/pevensey-castle/history/); [The Anglo-Saxon Chronicle, Ingram/Giles composite English translation](https://www.gutenberg.org/files/657/657.txt).

**Exact proposal** (high confidence; review row 46). Target `place:england-wales/pevensey:phase:2`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[57].phases[2].label": "After siege tradition; later Anglo-Saxon reoccupation",
    "$[57].phases[2].size": 1,
    "$[57].phases[2].note": "The late-fifth-century siege is a retrospective annal with conflicting transmitted/secondary dates. English Heritage describes reoccupation about a century later and possible high-status activity before 1066; the interval is not uniformly deserted.",
    "$[57].confidence": "medium"
  }
}
```


#### N23 — Maiden Castle is not Britain’s largest hillfort (S1; rejected)

**App:** Maiden Castle: Maiden Castle. Context: The largest hillfort in Britain. In the middle Iron Age (about 400-120 BCE) it was the main settlement of southern Dorset; by the Roman invasion it was almost empty.

**Finding:** English Heritage calls Maiden Castle one of the largest, not the largest. The Oxford hillfort atlas records Ham Hill at 84 hectares, while Cambridge’s excavation account explicitly says Ham Hill dwarfs Maiden Castle. The absolute superlative is wrong.

**Evidence, accessed 2026-11-14:** [History of Maiden Castle](https://www.english-heritage.org.uk/visit/places/maiden-castle/history/); [Oxford Atlas of Hillforts: Ham Hill](https://hillforts.arch.ox.ac.uk/records/EN0448.html); [Cambridge: Britain’s biggest Iron Age fortress](https://www.cam.ac.uk/research/news/inside-britains-biggest-iron-age-fortress).

**Exact proposal** (high confidence; review row 47). Target `place:england-wales/maiden-castle:located_at`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[18].summary": "One of the largest hillforts in Britain. In the middle Iron Age (about 400-120 BCE) it was the main settlement of southern Dorset; by the Roman invasion it was almost empty."
  }
}
```


#### N24 — Iceni vanish before Prasutagus and Boudica (S1; rejected)

**App:** Iceni: people: Iceni [-50 → 43]. Context: People of Norfolk and north Suffolk, a client kingdom until Boudica's revolt of 60/61. Named in Roman sources (Caesar, Tacitus, Ptolemy) and on coins or inscriptions; the label marks the heartland only, no boundary is known, and the name outlived the conquest as a Roman civitas. Dates are supported here only by Wikipedia, which is a lead rather than verification.

**Finding:** The type is people but the interval ends in 43. Tacitus Annals 14.31 explicitly describes Prasutagus’s kingdom and the Icenian revolt in 60/61. At minimum the pre-conquest/client political phase must extend through the revolt; its end must not imply the people disappeared.

**Evidence, accessed 2026-11-14:** [Tacitus, Annals, Book XIV chapters 29-39 (Loeb translation)](https://penelope.uchicago.edu/Thayer/E/Roman/Texts/Tacitus/Annals/14B*.html).

**Exact proposal** (medium confidence; review row 48). Target `polity:england-wales/iceni:existed`; `data/national/polities.json`:

```json
{
  "file": "national/polities.json",
  "new_values": {
    "$[3].to": 61,
    "$[3].kind": "kingdom",
    "$[3].name": "Iceni: independent and client kingdom",
    "$[3].note": "The Iceni retained a client kingdom under Prasutagus after AD 43; Boudica’s revolt followed in AD 60/61. The endpoint 61 marks the end of this political phase, not extinction of the people. Their subsequent Roman civitas requires a separate record. The pre-43 start remains approximate."
  }
}
```


#### N25 — Brigantes disappear while their client rulers are still active (S1; rejected)

**App:** Brigantes: people: Brigantes [-50 → 43]. Context: A large confederation across the Pennines, ruled by Cartimandua as a client of Rome until about 69. Named in Roman sources (Caesar, Tacitus, Ptolemy) and on coins or inscriptions; the label marks the heartland only, no boundary is known, and the name outlived the conquest as a Roman civitas. Dates are supported here only by Wikipedia, which is a lead rather than verification.

**Finding:** Tacitus Histories 3.45 describes Cartimandua’s fall and Venutius taking the throne in the events of 69. English Heritage records Stanwick’s decline only after 70. Ending the people/polity in 43 contradicts both the narrative and the app’s own summary.

**Evidence, accessed 2026-11-14:** [Tacitus, Histories 3.45 (Loeb translation)](https://penelope.uchicago.edu/Thayer/E/Roman/Texts/Tacitus/Histories/3B*.html); [History of Stanwick Iron Age Fortifications](https://www.english-heritage.org.uk/visit/places/stanwick-iron-age-fortifications/history/).

**Exact proposal** (medium confidence; review row 49). Target `polity:england-wales/brigantes:existed`; `data/national/polities.json`:

```json
{
  "file": "national/polities.json",
  "new_values": {
    "$[12].to": 70,
    "$[12].kind": "kingdom",
    "$[12].name": "Brigantes: pre-conquest and client kingship",
    "$[12].note": "Cartimandua and Venutius ruled after AD 43; Tacitus describes the crisis of 69. The displayed end around 70 marks a transition towards Roman conquest, not the disappearance of the Brigantes. Roman-period community and conquest phases require separate records; the exact transition is not a single securely dated event."
  }
}
```


#### N26 — Carvetii appear only before their evidence begins (S2; disputed)

**App:** Carvetii: people: Carvetii [-50 → 43]. Context: People of the Eden valley and Solway plain, attested only by 3rd-century inscriptions; probably a sub-group of the Brigantes before then. Named in Roman sources (Caesar, Tacitus, Ptolemy) and on coins or inscriptions; the label marks the heartland only, no boundary is known, and the name outlived the conquest as a Roman civitas. Not checked against a fetched source: dates and size come from general reference knowledge.

**Finding:** The app shows the Carvetii in 50 BCE–AD 43 but admits their name is attested only by third-century inscriptions. RIB 3526 identifies a civitas in 222/223 and calls this its earliest dated evidence. The plotted interval is a conjectural prehistory, while the securely evidenced Roman community is omitted.

**Evidence, accessed 2026-11-14:** [RIB 3526: Milestone of Severus Alexander](https://romaninscriptionsofbritain.org/inscriptions/3526).

**Exact proposal** (high confidence; review row 50). Target `polity:england-wales/carvetii:existed`; `data/national/polities.json`:

```json
{
  "file": "national/polities.json",
  "new_values": {
    "$[14].evidence": "conjectural",
    "$[14].confidence": "low",
    "$[14].name": "Possible pre-Roman antecedents of the Carvetii",
    "$[14].note": "This pre-Roman placement is conjectural. The civitas Carvetiorum is securely named on RIB 3526 dated 222/223, with later third-century evidence; a separate Roman-period record is needed. Neither 50 BCE nor AD 43 is an attested boundary for this people."
  }
}
```


#### N27 — Military Way’s deliberately shifted geometry is labelled excavated (S2; disputed)

**App:** Military Way (Hadrian’s Wall): roman-road: Military Way (Hadrian’s Wall) [160 → 410]. Context: The road added behind Hadrian’s Wall when it was recommissioned about AD 160, linking the forts and milecastles.

**Finding:** The app says its path is the wall-fort coordinates shifted about 300 m south merely for visibility. English Heritage supports the addition of a road, not this derived survey line. The geometry’s evidence class should describe reconstruction; the approximate AD 160 anchor is already qualified.

**Evidence, accessed 2026-11-14:** [History of Hadrian’s Wall](https://www.english-heritage.org.uk/visit/places/hadrians-wall/hadrians-wall-history-and-stories/history/).

**Exact proposal** (high confidence; review row 51). Target `line:england-wales/military-way:existed`; `data/national/lines.json`:

```json
{
  "file": "national/lines.json",
  "new_values": {
    "$[32].evidence": "reconstructed"
  }
}
```


#### N28 — Torksey village marker conflates camp and later town (S2; disputed)

**App:** Torksey: Torksey. Context: The Great Army's camp of 872-3 covered some 55 hectares, larger than most towns of the day.

**Finding:** Lincolnshire HER locates the camp on high ground north of Torksey, mostly in Brampton parish, centred SK 836 802. One coordinate serves both the camp and later town. Do not move the whole multi-period entity to a camp centroid; identify this marker’s scope and request a separate camp location.

**Evidence, accessed 2026-11-14:** [MLI125067: Winter Camp of the Viking Great Army at Torksey](https://heritage-explorer.lincolnshire.gov.uk/Monument/MLI125067); [The winter camp of the Viking Great Army, AD 872–3, Torksey, Lincolnshire](https://www.cambridge.org/core/journals/antiquaries-journal/article/winter-camp-of-the-viking-great-army-ad-8723-torksey-lincolnshire/C54BB610EA9E0E567DC2C0622BA753EB).

**Exact proposal** (high confidence; review row 52). Target `place:england-wales/torksey:located_at`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[83].uncertainty": "This point is a reference for Torksey, not the Viking camp centroid. The 872–873 camp occupied high ground north of the village, mostly in Brampton parish (HER MLI125067, centred SK 836 802, estimated extent 725 × 1509 m). Its footprint needs a separate entity; later town phases should retain their own location."
  }
}
```


#### N29 — Richborough’s small fort and stone shore fort conflated (S2; disputed)

**App:** Richborough: Saxon Shore fort [251 → 410].

**Finding:** English Heritage distinguishes a small fort around 250 from the surviving stone fort of 275–290. The phase begins in 251 with an undifferentiated Saxon Shore fort label; qualify the transition without pretending that the stone circuit existed from 251.

**Evidence, accessed 2026-11-14:** [History of Richborough](https://www.english-heritage.org.uk/visit/places/richborough-roman-fort-and-amphitheatre/history-and-stories/history/).

**Exact proposal** (high confidence; review row 53). Target `place:england-wales/richborough:phase:2`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[33].phases[2].label": "Small fort c.250; stone shore fort built c.275–290",
    "$[33].phases[2].note": "The small fort and its stone replacement are separate stages. The surviving stone walls date to the 275–290 construction bracket, not 251."
  }
}
```


#### N30 — bryn-celli-ddu: end-of-use language outruns evidence (S2; disputed)

**App:** Bryn Celli Ddu: Disused mound [-2000].

**Finding:** Cadw provides no 2000 BCE closure. The app already admits that the end of use is not dated.

**Evidence, accessed 2026-11-14:** [Bryn Celli Ddu Chambered Tomb](https://cadw.gov.wales/visit/places-to-visit/bryn-celli-ddu-chambered-tomb).

**Exact proposal** (high confidence; review row 54). Target `place:england-wales/bryn-celli-ddu:phase:1`; `data/national/places-wales.json`:

```json
{
  "file": "national/places-wales.json",
  "new_values": {
    "$[0].phases[1].label": "Surviving tomb; end of use uncertain",
    "$[0].phases[1].note": "Cadw provides no 2000 BCE closure. The app already admits that the end of use is not dated. The numerical year is only a display anchor."
  }
}
```


#### N32 — pentre-ifan: end-of-use language outruns evidence (S2; disputed)

**App:** Pentre Ifan: Disused tomb [-3000].

**Finding:** Cadw supports a Neolithic tomb but no exact cessation year; the displayed boundary is not an excavation result.

**Evidence, accessed 2026-11-14:** [Pentre Ifan Chambered Tomb](https://cadw.gov.wales/visit/places-to-visit/pentre-ifan-chambered-tomb).

**Exact proposal** (high confidence; review row 55). Target `place:england-wales/pentre-ifan:phase:1`; `data/national/places-wales.json`:

```json
{
  "file": "national/places-wales.json",
  "new_values": {
    "$[2].phases[1].label": "Surviving tomb; later use uncertain",
    "$[2].phases[1].note": "Cadw supports a Neolithic tomb but no exact cessation year; the displayed boundary is not an excavation result. The numerical year is only a display anchor."
  }
}
```


#### N33 — thornborough-henges: end-of-use language outruns evidence (S2; disputed)

**App:** Thornborough Henges: Earthworks, out of use [-2000].

**Finding:** English Heritage describes continued importance for early Bronze Age burials. Calling the entire complex out of use from 2000 BCE suppresses that continuing activity.

**Evidence, accessed 2026-11-14:** [History of Thornborough Henges](https://www.english-heritage.org.uk/visit/places/thornborough-henges/history/).

**Exact proposal** (high confidence; review row 56). Target `place:england-wales/thornborough-henges:phase:1`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[10].phases[1].label": "Earthworks; Bronze Age burial landscape",
    "$[10].phases[1].note": "English Heritage describes continued importance for early Bronze Age burials. Calling the entire complex out of use from 2000 BCE suppresses that continuing activity. The numerical year is only a display anchor."
  }
}
```


#### N34 — Lindisfarne becomes a ruin immediately after suppression (S1; rejected)

**App:** Lindisfarne: Ruin; a Tudor fort is built nearby [1538].

**Finding:** The cited English Heritage history explicitly says the priory buildings were not dismantled at the Reformation because of Crown defence needs. The 1538 phase calls them a ruin and introduces a Tudor fort before the source’s 1542–45 harbour defences. Institutional closure is not physical destruction.

**Evidence, accessed 2026-11-14:** [History of Lindisfarne Priory](https://www.english-heritage.org.uk/visit/places/lindisfarne-priory/history/).

**Exact proposal** (high confidence; review row 57). Target `place:england-wales/lindisfarne:phase:4`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[74].phases[4].label": "Former priory retained; harbour defences added in 1542–45",
    "$[74].phases[4].note": "Priory suppressed in 1537, but buildings were retained for Crown defence. English Heritage dates the nearby earth-and-timber harbour works to 1542–45; do not imply instant ruination or a fort already present in 1538."
  }
}
```


#### N35 — Wroxeter’s preservation claim erases the surviving settlement (S2; disputed)

**App:** Wroxeter: Wroxeter. Context: Founded as a military base about 47 and refounded as a city in the 90s. At 78 hectares it was one of the largest cities of Roman Britain. It was never built over.

**Finding:** English Heritage limits abandonment to the city centre and describes a community continuing by the ford, later around St Andrew’s. “It was never built over” overstates the survival of the whole city area. The distinction matters because the model also changes the city to size zero in 451.

**Evidence, accessed 2026-11-14:** [History of Wroxeter Roman City](https://www.english-heritage.org.uk/visit/places/wroxeter-roman-city/history/).

**Exact proposal** (high confidence; review row 58). Target `place:england-wales/wroxeter:located_at`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[31].summary": "Founded as a military base about 47 and refounded as a city in the 90s. At 78 hectares it was one of the largest cities of Roman Britain. Much of the Roman urban area escaped later development, while a smaller community continued by the ford at the site of the later village.",
    "$[31].phases[3].label": "Roman city centre abandoned; smaller settlement persists by the ford",
    "$[31].phases[3].note": "The circa-450 boundary concerns the former urban centre, not complete depopulation of Wroxeter."
  }
}
```


#### H01 — AD 43 is not a dated ruin event at Stonehenge (S2; disputed)

**App:** Stonehenge: Ruin on open downland [43].

**Finding:** English Heritage describes Roman-period activity but supplies no destruction or abrupt ruin event at the conquest. The national layer switches to ruin in AD 43 while the detailed site uses AD 1 as an explicitly arbitrary loss-of-stones convention. These two dates must not be read as alternative historical events.

**Evidence, accessed 2026-11-14:** [History of Stonehenge](https://www.english-heritage.org.uk/visit/places/stonehenge/history-and-stories/history/).

**Exact proposal** (high confidence; review row 59). Target `place:england-wales/stonehenge:phase:3`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[0].phases[3].label": "Standing remains; Roman and later activity",
    "$[0].phases[3].note": "AD 43 is an era boundary only. The dates when individual stones fell or were removed are generally unknown; it is not a dated destruction of Stonehenge."
  }
}
```


#### H02 — Durrington’s uncertain short occupation becomes a century-long settlement (S2; disputed)

**App:** Durrington Walls: Large seasonal settlement of the Stonehenge builders [-2550 → -2451].

**Finding:** English Heritage places relatively short occupation within 2580–2470 BCE, followed by the henge. The app’s 2550–2451 settlement phase can imply approximately a century of occupation, while the detailed site describes about a decade. Preserve the bracket/short-duration distinction and leave the exact year unresolved.

**Evidence, accessed 2026-11-14:** [Stonehenge Reconstructed: Durrington Walls and Woodhenge](https://www.english-heritage.org.uk/visit/places/stonehenge/history-and-stories/stonehenge-reconstructed/).

**Exact proposal** (high confidence; review row 60). Target `place:england-wales/durrington-walls:phase:0`; `data/national/places.json`:

```json
{
  "file": "national/places.json",
  "new_values": {
    "$[1].phases[0].label": "Short-lived late Neolithic settlement (date uncertain)",
    "$[1].phases[0].note": "Relatively short occupation within the radiocarbon bracket 2580–2470 BCE. The displayed 2550–2451 interval is an uncertainty/display window, not a measured century of continuous occupation."
  }
}
```


### Brentford

No S1/S2 defect was established in the reviewed claims. This does not certify conjectural scenery, troops, positions or numerical estimates. The verified and unresolved episode checks remain in the ledger.

### Barnet

No S1/S2 defect was established in the reviewed claims. This does not certify conjectural scenery, troops, positions or numerical estimates. The verified and unresolved episode checks remain in the ledger.

### Stonehenge — light final pass

#### H03 — Stonehenge modelling conventions inherit high archaeological confidence (S2; disputed)

**App:** Aubrey Holes: Aubrey Holes: filled, visible as dimples [-2500]. Context: The date of filling is not known; 2500 BCE is a convention. They were refilled and later rediscovered by Aubrey (1666) as hollows; still visible as dimples in 1625 is a modelling choice.

**Finding:** The entity’s own uncertainty text admits that the phase date and visible state are modelling conventions. The checked chronological research does not date filled dimples to 2500 BCE or bank erosion to AD 1. Archaeological confidence in the feature’s existence must not certify its invented visible-state chronology. With only entity-level confidence available, medium is the safer aggregate label.

**Evidence, accessed 2026-11-14:** [Marshall, Darvill, Parker Pearson & Wainwright 2012. Stonehenge, Amesbury, Wiltshire: chronological modelling. English Heritage Research Report 1-2012 (PDF, text extracted locally)](https://archaeologydataservice.ac.uk/catalogue/adsdata/arch-1893-1/dissemination/pdf/englishh2-135552.pdf); [Darvill, Marshall, Parker Pearson & Wainwright 2012. Stonehenge remodelled. Antiquity 86(334): 1021-1040 (PDF, text extracted locally from the fetched file)](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/A118920A90FB7CCB2838CEEB10BE477D/S0003598X00048225a.pdf/stonehenge_remodelled.pdf).

**Exact proposal** (high confidence; review row 61). Target `landmark:stonehenge/aubrey-holes:phase:1`; `data/locations/stonehenge/landmarks.json`:

```json
{
  "file": "locations/stonehenge/landmarks.json",
  "new_values": {
    "$[11].confidence": "medium"
  }
}
```


#### H04 — Stonehenge modelling conventions inherit high archaeological confidence (S2; disputed)

**App:** Stonehenge ditch and bank: Silted and slumped earthwork, as seen by the first drawings [1]. Context: Erosion and silting are undated; the lowered bank (1.1 m) from year 1 CE is a convention. The ditch was largely silted long before 1625 (EH). The outer bank was ploughed away later.

**Finding:** The entity’s own uncertainty text admits that the phase date and visible state are modelling conventions. The checked chronological research does not date filled dimples to 2500 BCE or bank erosion to AD 1. Archaeological confidence in the feature’s existence must not certify its invented visible-state chronology. With only entity-level confidence available, medium is the safer aggregate label.

**Evidence, accessed 2026-11-14:** [Marshall, Darvill, Parker Pearson & Wainwright 2012. Stonehenge, Amesbury, Wiltshire: chronological modelling. English Heritage Research Report 1-2012 (PDF, text extracted locally)](https://archaeologydataservice.ac.uk/catalogue/adsdata/arch-1893-1/dissemination/pdf/englishh2-135552.pdf); [Darvill, Marshall, Parker Pearson & Wainwright 2012. Stonehenge remodelled. Antiquity 86(334): 1021-1040 (PDF, text extracted locally from the fetched file)](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/A118920A90FB7CCB2838CEEB10BE477D/S0003598X00048225a.pdf/stonehenge_remodelled.pdf).

**Exact proposal** (high confidence; review row 62). Target `landmark:stonehenge/stonehenge-ditch-bank:phase:6`; `data/locations/stonehenge/landmarks.json`:

```json
{
  "file": "locations/stonehenge/landmarks.json",
  "new_values": {
    "$[12].confidence": "medium"
  }
}
```


## Additional sourced statements and omissions

The following are in `curated_fact` with their own citations. A01–A04 accompany the related findings above. The three epidemic events are separate omissions. A05 preserves a scholarly uncertainty that survived challenge. These are proposals for editorial integration, not invented generated fact ids.

### A01 — The timber London Bridge was destroyed by a storm in 1091.

S2 omission associated with L04. Exact rebuilding date not supplied by this source.

Evidence, accessed 2026-11-14: [London Bridge](https://www.londonmuseum.org.uk/collections/london-stories/london-bridge/).

```json
{
  "curated_fact_id": 1,
  "entity_id": "london/saxon-bridge",
  "kind": "destroyed",
  "statement": "The timber London Bridge was destroyed by a storm in 1091.",
  "year_from": 1091,
  "year_to": 1091,
  "confidence": "high"
}
```


### A02 — A Benedictine monastery existed at Westminster around 960, before Edward the Confessor’s enlargement.

S2 omission associated with L08. Circa date; no proposed model of the unknown early fabric.

Evidence, accessed 2026-11-14: [History of Westminster Abbey](https://www.westminster-abbey.org/history/history-of-westminster-abbey).

```json
{
  "curated_fact_id": 2,
  "entity_id": "london/westminster-abbey",
  "kind": "foundation",
  "statement": "A Benedictine monastery existed at Westminster around 960, before Edward the Confessor’s enlargement.",
  "year_from": 960,
  "year_to": 960,
  "confidence": "medium"
}
```


### A-plague-1563 — London suffered a major plague epidemic in 1563.

S2 timeline omission. Boulton’s mortality discussion identifies this epidemic; no exact mortality percentage is copied into the new claim.

Evidence, accessed 2026-11-14: [London Bills of Mortality, 1660–1700: introduction](https://www.staff.ncl.ac.uk/j.p.boulton/bills.htm).

```json
{
  "curated_fact_id": 3,
  "entity_id": "london",
  "kind": "epidemic",
  "statement": "London suffered a major plague epidemic in 1563.",
  "year_from": 1563,
  "year_to": 1563,
  "confidence": "high"
}
```


### A-plague-1603 — London suffered a major plague epidemic in 1603.

S2 timeline omission. Boulton’s mortality discussion identifies this epidemic; no exact mortality percentage is copied into the new claim.

Evidence, accessed 2026-11-14: [London Bills of Mortality, 1660–1700: introduction](https://www.staff.ncl.ac.uk/j.p.boulton/bills.htm).

```json
{
  "curated_fact_id": 4,
  "entity_id": "london",
  "kind": "epidemic",
  "statement": "London suffered a major plague epidemic in 1603.",
  "year_from": 1603,
  "year_to": 1603,
  "confidence": "high"
}
```


### A-plague-1625 — London suffered a major plague epidemic in 1625.

S2 timeline omission. Boulton’s mortality discussion identifies this epidemic; no exact mortality percentage is copied into the new claim.

Evidence, accessed 2026-11-14: [London Bills of Mortality, 1660–1700: introduction](https://www.staff.ncl.ac.uk/j.p.boulton/bills.htm).

```json
{
  "curated_fact_id": 5,
  "entity_id": "london",
  "kind": "epidemic",
  "statement": "London suffered a major plague epidemic in 1625.",
  "year_from": 1625,
  "year_to": 1625,
  "confidence": "high"
}
```


### A03 — The first Blackfriars theatre dates to 1576, distinct from the second venue established in 1596.

S2 omission associated with L07; source is EMLoT’s theatre list, not a reconstruction of venue plans.

Evidence, accessed 2026-11-14: [Early Modern London Theatres: project scope and theatre dates](https://emlot.org/).

```json
{
  "curated_fact_id": 6,
  "entity_id": "london/blackfriars",
  "kind": "theatre_opened",
  "statement": "The first Blackfriars theatre dates to 1576, distinct from the second venue established in 1596.",
  "year_from": 1576,
  "year_to": 1576,
  "confidence": "high"
}
```


### A04 — The civitas of the Carvetii is named on RIB 3526, dated by imperial titulature to 10 December 222–9 December 223.

S2 omission associated with N26. These are attestation dates, not the founding and abolition dates of the civitas.

Evidence, accessed 2026-11-14: [RIB 3526: Milestone of Severus Alexander](https://romaninscriptionsofbritain.org/inscriptions/3526).

```json
{
  "curated_fact_id": 7,
  "entity_id": "england-wales/carvetii",
  "kind": "epigraphic_attestation",
  "statement": "The civitas of the Carvetii is named on RIB 3526, dated by imperial titulature to 10 December 222–9 December 223.",
  "year_from": 222,
  "year_to": 223,
  "confidence": "high"
}
```


### A05 — The exact geological provenance of Stonehenge’s Altar Stone remains unresolved in the November 2026 multi-proxy study.

The 2024 Scottish-provenance paper is a hypothesis with substantial evidence, but the 2026 study finds no examined outcrop matches all characteristics. The app’s caution is not an error. Do not infer that all of Scotland has been excluded.

Evidence, accessed 2026-11-14: [Pirrie et al. (2026): Altar Stone provenance](https://research.aber.ac.uk/en/publications/searching-for-the-origin-of-the-stonehenge-altar-stone-new-sedime/).

```json
{
  "curated_fact_id": 8,
  "entity_id": "stonehenge/altar-stone",
  "kind": "scholarly_dispute",
  "statement": "The exact geological provenance of Stonehenge’s Altar Stone remains unresolved in the November 2026 multi-proxy study.",
  "year_from": null,
  "year_to": null,
  "confidence": "high"
}
```


## Systemic problems

1. **One confidence label is copied onto different claims.** The generated fact table inherits an entity’s evidence/confidence for its coordinates, dimensions, phase boundaries and size bins. There are 150 high-confidence national `size` rows. Site identity or standing fabric does not independently establish a numerical ordinal rank. Keep visual size as an editorial scale and preserve claim-level limits; this review does not manufacture alternative population estimates.

2. **A nonempty citation list is not independent support.** 397 fact rows have no resolved citation; 400 have only Wikipedia citations. [The complete source backlog](factkeeper-source-backlog.csv) identifies each stable target and JSON path. An entity-wide source can support one date while saying nothing about another, as at Lambeth, Guildhall and the Roman abandonment phases.

3. **Date windows are mistaken for durations.** A radiocarbon range is not necessarily a century-long building schedule. Approximate annual anchors are acceptable when clearly identified; labels such as completed, abandoned and disused can contradict that caveat. Silbury and Durrington are substantive examples. Already explicit caveats at Uffington, Silchester and Seahenge were not turned into spurious errors.

4. **Institutional and physical histories are conflated.** Dissolution does not establish demolition, nor does a bishop’s appointment date found an episcopal institution. Lindisfarne, St Bartholomew’s and St Davids expose these distinctions. Annual transitions shared by two phases can represent within-year change; overlap alone was not labelled an impossible historical succession.

5. **Coordinates often express editorial reference points.** Catalogue pins, modern village centres and battlefield registration polygons are not excavated battle centres. Mynydd Carn’s catalogue/text contradiction needs an explicit warning. Barnet, Brunanburh and Assandun already carry material caveats. Modern polity polygons likewise must not imply surveyed contemporary frontiers.

6. **Road existence is better evidenced than segment dates or exact geometry.** The Itiner-e paper describes a compiled network around the Roman imperial maximum, with evidenced, conjectured and hypothetical lines. The app’s 31 routed/simplified lines explicitly admit inferred construction years and a nominal 410 end of upkeep. The secondary Britain dataset reports an approximately 100 m datum offset; the app’s research note says it was left uncorrected beneath a 300–700 m simplification tolerance. Those are limits, not metre-accurate excavated roads. The separate Military Way wrongly retains an excavated evidence label for a deliberately shifted line (N27).

7. **Source conflicts must be retained.** Pevensey’s web chronology and the older Chronicle translation disagree; the old translation also places the Ellendun sequence under 823. Durham’s archive gives 31 December 1539 while VCH says 1540. The review preserves these conflicts instead of selecting the most convenient exact date. Wikipedia and the separate research database were leads throughout.

## S3 review register

| Code | Target | Sourcing limitation |
|---|---|---|
| L09 | `landmark:london/lambeth-palace:completed:0` | Lambeth’s 1230 completion has no supporting source |
| L10 | `landmark:london/bermondsey-abbey:completed:0` | Bermondsey completion and demolition unsupported |
| B-dyrham | `place:england-wales/battle-dyrham:phase:0` | battle-dyrham: source limitation |
| C-atrebates | `polity:england-wales/atrebates:existed` | Priority entity rests only on Wikipedia |
| C-belgae | `polity:england-wales/belgae:existed` | Priority entity rests only on Wikipedia |
| C-bernicia | `polity:england-wales/bernicia:existed` | Priority entity rests only on Wikipedia |
| C-boston | `place:england-wales/boston:located_at` | Priority entity rests only on Wikipedia |
| C-bristol | `place:england-wales/bristol:located_at` | Priority entity rests only on Wikipedia |
| C-britannia | `polity:england-wales/britannia:existed` | Priority entity rests only on Wikipedia |
| C-britannia-inferior | `polity:england-wales/britannia-inferior:existed` | Priority entity rests only on Wikipedia |
| C-britannia-prima | `polity:england-wales/britannia-prima:existed` | Priority entity rests only on Wikipedia |
| C-britannia-secunda | `polity:england-wales/britannia-secunda:existed` | Priority entity rests only on Wikipedia |
| C-britannia-superior | `polity:england-wales/britannia-superior:existed` | Priority entity rests only on Wikipedia |
| C-catuvellauni | `polity:england-wales/catuvellauni:existed` | Priority entity rests only on Wikipedia |
| C-danebury | `place:england-wales/danebury:located_at` | Priority entity rests only on Wikipedia |
| C-danelaw | `polity:england-wales/danelaw:existed` | Priority entity rests only on Wikipedia |
| C-deira | `polity:england-wales/deira:existed` | Priority entity rests only on Wikipedia |
| C-dobunni | `polity:england-wales/dobunni:existed` | Priority entity rests only on Wikipedia |
| C-dunwich | `place:england-wales/dunwich:located_at` | Priority entity rests only on Wikipedia |
| C-earldom-chester | `polity:england-wales/earldom-chester:existed` | Priority entity rests only on Wikipedia |
| C-earldom-hereford | `polity:england-wales/earldom-hereford:existed` | Priority entity rests only on Wikipedia |
| C-earldom-northumbria | `polity:england-wales/earldom-northumbria:existed` | Priority entity rests only on Wikipedia |
| C-earldom-shrewsbury | `polity:england-wales/earldom-shrewsbury:existed` | Priority entity rests only on Wikipedia |
| C-earldom-wessex | `polity:england-wales/earldom-wessex:existed` | Priority entity rests only on Wikipedia |
| C-east-anglia | `polity:england-wales/east-anglia:existed` | Priority entity rests only on Wikipedia |
| C-east-anglia-danish | `polity:england-wales/east-anglia-danish:existed` | Priority entity rests only on Wikipedia |
| C-england | `polity:england-wales/england:existed` | Priority entity rests only on Wikipedia |
| C-essex | `polity:england-wales/essex:existed` | Priority entity rests only on Wikipedia |
| C-exeter | `place:england-wales/exeter:located_at` | Priority entity rests only on Wikipedia |
| C-flavia-caesariensis | `polity:england-wales/flavia-caesariensis:existed` | Priority entity rests only on Wikipedia |
| C-hengistbury-head | `place:england-wales/hengistbury-head:located_at` | Priority entity rests only on Wikipedia |
| C-hwicce | `polity:england-wales/hwicce:existed` | Priority entity rests only on Wikipedia |
| C-ipswich | `place:england-wales/ipswich:located_at` | Priority entity rests only on Wikipedia |
| C-jorvik | `polity:england-wales/jorvik:existed` | Priority entity rests only on Wikipedia |
| C-kent | `polity:england-wales/kent:existed` | Priority entity rests only on Wikipedia |
| C-kings-lynn | `place:england-wales/kings-lynn:located_at` | Priority entity rests only on Wikipedia |
| C-lindsey | `polity:england-wales/lindsey:existed` | Priority entity rests only on Wikipedia |
| C-maxima-caesariensis | `polity:england-wales/maxima-caesariensis:existed` | Priority entity rests only on Wikipedia |
| C-mercia | `polity:england-wales/mercia:existed` | Priority entity rests only on Wikipedia |
| C-plymouth | `place:england-wales/plymouth:located_at` | Priority entity rests only on Wikipedia |
| C-southampton | `place:england-wales/southampton:located_at` | Priority entity rests only on Wikipedia |
| C-sussex | `polity:england-wales/sussex:existed` | Priority entity rests only on Wikipedia |
| C-trinovantes | `polity:england-wales/trinovantes:existed` | Priority entity rests only on Wikipedia |
| C-valentia | `polity:england-wales/valentia:existed` | Priority entity rests only on Wikipedia |
| C-wessex | `polity:england-wales/wessex:existed` | Priority entity rests only on Wikipedia |

Each row’s full explanation, checked URL and access date are in SQLite and [the authored ledger](factkeeper-review-ledger.json). No S3 row is a factual rejection solely because a page blocked a request.

## Disposition of all 77 imported disagreements

| Lead | Outcome | Independent assessment |
|---|---|---|
| `em-app-1066-travel` | enrichment | EH supports Fulford before Stamford Bridge and Hastings. The app already has a separate Fulford place. No continuous foot-march animation or contrary route is asserted by the cited event. [Source](https://www.english-heritage.org.uk/visit/places/1066-battle-of-hastings-abbey-and-battlefield/history-and-stories/king-harold/) |
| `em-app-army-865` | no defect established | The current event says East Anglia, not Thetford, for 865. The Cambridge paper supports a more detailed campaign but does not refute that event. [Source](https://www.cambridge.org/core/journals/antiquaries-journal/article/winter-camp-of-the-viking-great-army-ad-8723-torksey-lincolnshire/C54BB610EA9E0E567DC2C0622BA753EB) |
| `em-app-assandun-point` | already qualified | The project still lists Ashdon/Hadstock and Ashingdon/Canewdon alternatives. The app already calls the point a hypothesis, labels confidence low and states the question is open. [Source](https://assandun.uk/home) |
| `em-app-brentford-time` | already qualified | The Chronicle supports a relative sequence only. Both episode dateNotes explicitly say the day and month are unknown; fraction 0.5 is staging, not a claimed date. [Source](https://www.gutenberg.org/files/657/657.txt) |
| `em-app-bridge-1014` | already qualified | The Chronicle does not give bridge demolition in 1014. The app already describes the saga framing, disputed date and allegiance and does not show collapse; E04–E05 confirm these safeguards. [Source](https://www.gutenberg.org/files/657/657.txt) |
| `em-app-brunanburh-point` | already qualified | The Chronicle poem supports the battle, not Bromborough coordinates. The app already describes more than forty candidate sites and marks the location unknown/low. [Source](https://www.gutenberg.org/files/657/657.txt) |
| `em-app-cuthbert-place` | substantiated | Bede IV.29 and the Farne history distinguish death on Farne from burial at Lindisfarne. [Source](https://www.gutenberg.org/files/38326/38326-h/38326-h.html) |
| `em-app-gruffudd` | already qualified | The revised DWB article argues 1064; the current app note already preserves that alternative alongside conventional 1063. This does not justify replacing 1063 outright. [Source](https://biography.wales/article/s12-GRUF-APL-1063.html) |
| `em-app-hywel-manuscripts` | substantiated | DWB explicitly dates the oldest manuscript to the last quarter of the twelfth century. [Source](https://biography.wales/article/s-HYWE-DDA-0950.html) |
| `em-app-jarrow-start` | substantiated with narrower scope | The Cambridge handbook dates the two sites separately. The problem is the Jarrow marker’s 674 onset, not denial that Wearmouth was founded in 674. [Source](https://www.asnc.cam.ac.uk/resources/ASHistBib06.pdf) |
| `em-app-northumbria-start` | substantiated | Bede and EH attest earlier Northumbrian unions. A continuous 654 start loses Edwin and Oswald. [Source](https://www.gutenberg.org/files/38326/38326-h/38326-h.html) |
| `em-app-rhodri-powys` | substantiated | Thornton’s accessible ODNB extract uses possible control in 855 or later. The overstatement recurs in two polity notes. [Source](https://academic.oup.com/oxford-dictionary-of-national-biography/reference/63486/reference-article-abstract/581824952) |
| `em-app-torksey-camp` | substantiated with narrower remedy | HER gives the northern camp and estimated centre. Moving the shared town/camp point would misplace later phases; identify it as a town reference and add a separate camp feature. [Source](https://heritage-explorer.lincolnshire.gov.uk/Monument/MLI125067) |
| `em-app-whitby-end` | substantiated | EH explicitly denies knowledge of the precise ninth-century abandonment. [Source](https://www.english-heritage.org.uk/visit/places/whitby-abbey/history-and-stories/history/) |
| `em-app-winchester-largest` | substantiated | The edition gives Winchester and Wallingford equal 2,400-hide assessments, not exclusive population rank. [Source](https://archaeologydataservice.ac.uk/catalogue/adsdata/arch-769-1/dissemination/pdf/vol13/13_084_092.pdf) |
| `lm-app-durham-1540` | retain existing 1539 endpoint | The Durham archival catalogue explicitly gives surrender on 31 December 1539. VCH’s 1540 does not prove the app wrong; retain source-specific chronology rather than substituting 1540. [Source](https://reed.dur.ac.uk/xtf/view?docId=ark%2F32150_s1dz010q061.xml) |
| `lm-app-lewes-location` | substantiated | The Trust’s prose qualifies its own secure-location data box. [Source](https://www.battlefieldstrust.com/resource-centre/medieval/battleview.asp?BattleFieldId=22) |
| `lm-app-mynydd-site` | substantiated | Coflein’s northern narrative conflicts with its Templeton catalogue point. No replacement exact coordinate is established. [Source](https://coflein.gov.uk/en/site/300319/) |
| `pr-cmp-birdoswald-halls` | substantiated | EH supports continuity and successive halls, not exact 411 and 520 switches. [Source](https://www.english-heritage.org.uk/visit/places/birdoswald-roman-fort-hadrians-wall/history-and-stories/history/) |
| `pr-cmp-brecon-end` | substantiated | The app calls 300 a guess, but the phase still says abandoned. Cadw supplies no evacuation year. [Source](https://cadw.gov.wales/visit/places-to-visit/y-gaer-roman-fort) |
| `pr-cmp-bryn-closure` | substantiated | Cadw does not establish the 2000 BCE cessation represented by Disused mound. [Source](https://cadw.gov.wales/visit/places-to-visit/bryn-celli-ddu-chambered-tomb) |
| `pr-cmp-burgh-name` | substantiated | EH leaves Gariannonum shared between or uncertain between Burgh Castle and Caister. [Source](https://www.english-heritage.org.uk/visit/places/burgh-castle/history/) |
| `pr-cmp-chesters-411` | substantiated | EH’s late-fourth/early-fifth-century caveat does not support exact 411 abandonment. [Source](https://www.english-heritage.org.uk/visit/places/chesters-roman-fort-and-museum-hadrians-wall/history/) |
| `pr-cmp-durrington-date` | substantiated | EH’s short occupation inside a dating bracket differs from the century-long displayed settlement interval. [Source](https://www.english-heritage.org.uk/visit/places/stonehenge/history-and-stories/stonehenge-reconstructed/) |
| `pr-cmp-grimspound-abandon` | substantiated | EH states duration unknown and soil/settlement change, not a climate-caused 800 BCE abandonment. [Source](https://www.english-heritage.org.uk/visit/places/grimspound/history/) |
| `pr-cmp-london-shrink` | no contradiction established | London Museum describes house decline after c.150. The app’s earlier phase still calls London the chief town; its relative rank need not fall at the first decline. 351 is a schematic phase boundary, not an explicit claim that decline first began then. [Source](https://www.londonmuseum.org.uk/collections/london-stories/timeline-roman-london-londinium/) |
| `pr-cmp-provinces-date` | already qualified; bibliography weak | EH supports division after the late-second-century revolt without fixing 197. The app already states 197–213 alternatives. Retain the caveat; Wikipedia-only source provenance is recorded separately. [Source](https://www.english-heritage.org.uk/learn/story-of-england/romans/introduction/) |
| `pr-cmp-richborough-fort` | substantiated | EH distinguishes the c.250 small fort from the surviving stone fort of 275–290. [Source](https://www.english-heritage.org.uk/visit/places/richborough-roman-fort-and-amphitheatre/history-and-stories/history/) |
| `pr-cmp-segontium-end` | substantiated as uncertainty | Cadw derives c.394 from coins. That is not an exact evacuation observation. [Source](https://cadw.gov.wales/visit/places-to-visit/segontium-roman-fort) |
| `pr-cmp-stonehenge-roman` | substantiated | EH gives no conquest-year destruction. The national and detailed-site ruin boundaries are different modelling conventions. [Source](https://www.english-heritage.org.uk/visit/places/stonehenge/history-and-stories/history/) |
| `pr-cmp-uffington-date` | already qualified | The exact EH bracket 1740–210 BCE is already in the current uncertainty text, which explicitly calls the chosen 1000 BCE start unmeasured. No replacement year is justified. [Source](https://www.english-heritage.org.uk/visit/places/uffington-castle-white-horse-and-dragon-hill/history/) |
| `x-lambeth-link` | partly substantiated | HE supplies 1197 occupation, revised 1200 plan and hall before 1234. These are distinct events, not proof of 1230 completion of the model. [Source](https://historicengland.org.uk/listing/the-list/list-entry/1000818) |
| `x-plague-missing` | substantiated omission | Boulton identifies 1563, 1603 and 1625 epidemics, none of which is represented as plague in the London event array. New sourced statements A-plague-1563/1603/1625 are recorded. [Source](https://www.staff.ncl.ac.uk/j.p.boulton/bills.htm) |
| `x-westminster-roof-link` | substantiated | Parliament distinguishes the commission, lanterns and finishing work. [Source](https://www.parliament.uk/about/living-heritage/building/palace/westminsterhall/architecture/the-hammer-beam-roof-/) |
| `x-woodland-link` | alternative synthesis, not a replacement curve | Government synthesis is for England, includes woodland/wood pasture and gives broad estimates. The app curve is explicitly illustrative across England and Wales. Different definitions and geographic scope prevent treating 15%/10% as universal measured replacements. [Source](https://www.gov.uk/government/publications/identifying-and-protecting-archaeological-features-in-woodland/identifying-and-protecting-woodland-archaeology) |
| `em-app-dyrham-class` | classification proposal not adopted | A later document can be attested-documentary without being contemporary testimony. The app already marks low confidence and explains the three-century delay. The Chronicle is a better citation, but the event itself is not newly verified. [Source](https://www.gutenberg.org/files/657/657.txt) |
| `em-app-ellendun-transfer` | enrichment; edition chronology unresolved | The Chronicle distinguishes the victory from Æthelwulf’s subsequent operation, but the app’s summary need not mean instantaneous transfer. The consulted old translation’s annal is 823, not conventional 825; do not change the date on that edition alone. [Source](https://www.gutenberg.org/files/657/657.txt) |
| `em-app-english-unification` | enrichment | The Chronicle supports contested northern control through 954. The app’s separate Jorvik note already says York was lost again after 927; no claim that every English king continuously held it was found. [Source](https://www.gutenberg.org/files/657/657.txt) |
| `em-app-st-davids-bishop` | substantiated | Asser’s references to earlier bishops refute first episcopal status in 1115. [Source](https://www.gutenberg.org/files/63384/63384-h/63384-h.htm) |
| `lm-app-anarchy` | no defect established | The royal history distinguishes the 1135 succession from Matilda’s 1139 invasion. Calling the wider 1135–1154 reign/crisis the Anarchy is not itself a false claim that her invasion occurred in 1135. [Source](https://www.royal.uk/stephen-and-matilda) |
| `lm-app-battle-abbey-approx` | already qualified | EH says about 1071; the app summary also says about 1071. Annual display precision remains a general limitation, not a demonstrated erroneous year. [Source](https://www.english-heritage.org.uk/visit/places/1066-battle-of-hastings-abbey-and-battlefield/history-and-stories/history/) |
| `lm-app-beaumaris-incomplete` | already qualified | Cadw confirms unfinished gatehouse/towers. The current app already says work petered out and uses an unfinished-castle phase label. No finished detailed Beaumaris model exists in the reviewed dataset. [Source](https://cadw.gov.wales/visit/places-to-visit/beaumaris-castle) |
| `lm-app-bosworth-archaeology` | already qualified | The Trust supports the Fenn Lanes locality. The current app already records the relocated archaeological site and says its point is not a surveyed centre; coordinate check finds it about 5 m from the source reference point. [Source](https://www.battlefieldstrust.com/resource-centre/warsoftheroses/battleview.asp?BattleFieldId=8) |
| `lm-app-bryn-site` | already qualified; enrichment | Coflein lists alternative hills and negative survey. The app already describes uncertainty and neighbouring hills. Listing Graig Hill and Blacke Hyll explicitly is useful enrichment, not proof the present caveat is false. [Source](https://coflein.gov.uk/en/site/306352/) |
| `lm-app-fountains-order` | substantiated | The detailed NT narrative distinguishes Benedictine founders in 1132 from acceptance into the Cistercian order three years later. [Source](https://www.nationaltrust.org.uk/visit/yorkshire/fountains-abbey-and-studley-royal-water-garden/history-of-fountains-abbey-and-studley-royal) |
| `lm-app-harlech-sea` | enrichment | Cadw confirms the 108-step sea access. Adding supply-route geometry could improve a future site model, but the present national point does not claim modern shoreline geometry represents medieval Harlech. [Source](https://cadw.gov.wales/visit/places-to-visit/harlech-castle) |
| `lm-app-margam-approx` | already qualified | Coflein says around 1147, and the app summary already says about 1147. Do not replace a qualified scalar anchor with another arbitrary year. [Source](https://coflein.gov.uk/en/site/132/) |
| `lm-app-rhuddlan-engineering` | enrichment | Cadw confirms diversion/deepening of the Clwyd. A separate engineering event would add detail; the castle’s existing 1277 statement remains true without it. [Source](https://cadw.gov.wales/visit/places-to-visit/rhuddlan-castle) |
| `lm-app-strata-closure` | retain qualified closure; review fabric separately | Coflein says closed by 1539 and the app summary repeats by 1539. This does not prove a distinct exact closure day or immediate physical ruin. No change to the annual end value is established. [Source](https://coflein.gov.uk/en/site/95764/) |
| `lm-app-towton-numbers` | already qualified | The Trust rejects inflated figures. The app already calls its army and casualty numbers chroniclers’ estimates; no exact army-size claim is verified. A source-linked numerical-claims table would be enrichment. [Source](https://www.battlefieldstrust.com/resource-centre/warsoftheroses/battleview.asp?BattleFieldId=46) |
| `lm-app-welsh-acts` | already qualified; optional administrative refinement | OpenLearn distinguishes 1536 and 1543. The current app already writes 1535–6 and 1542–3, preserving statutory/common dating conventions. The later court-system detail does not invalidate its 1536 display start. [Source](https://www.open.edu/openlearn/mod/oucontent/view.php?id=14609&printable=1) |
| `lm-app-whitby-approx` | already qualified | The current summary says about 657 and about 1078. The separate ninth-century abandonment problem remains N21. [Source](https://www.english-heritage.org.uk/visit/places/whitby-abbey/history/) |
| `pr-cmp-arbor-low-certainty` | enrichment | EH confirms cumulative construction and later monuments. The app’s broad phase does not expressly say every feature existed unchanged for the entire millennium; its uncertainty already says not closely dated. [Source](https://www.english-heritage.org.uk/visit/places/arbor-low-stone-circle-and-gib-hill-barrow/history/) |
| `pr-cmp-barclodiad-fabric` | no model error established | Cadw identifies the present mound as reconstruction, but standing carved stones are real evidence. The app has a national point, not a detailed mound model. Downgrading all evidence to reconstructed solely on the present envelope would conflate fabric components. [Source](https://cadw.gov.wales/visit/places-to-visit/barclodiad-y-gawres-chambered-tomb) |
| `pr-cmp-castlerigg-end` | no cessation claim found | The current transition is from Stone circle to Standing monument, with low confidence and explicit dating uncertainty. Unlike Disused tomb, that label does not assert ceremonial cessation. No rejection is recorded. [Source](https://www.english-heritage.org.uk/visit/places/castlerigg-stone-circle/history/) |
| `pr-cmp-pentre-end` | substantiated | The phase explicitly says Disused tomb from 3000 BCE, without an end-of-use source. [Source](https://cadw.gov.wales/visit/places-to-visit/pentre-ifan-chambered-tomb) |
| `pr-cmp-seahenge-end` | already qualified | Norfolk confirms timber felling in 2049 BCE. The current app explicitly says use duration is unknown and the endpoint nominal. No replacement ceremonial end is justified. [Source](https://www.heritage.norfolk.gov.uk/dating-the-second-timber-circle-on-holme-next-the-sea-beach-1) |
| `pr-cmp-silbury-duration` | substantiated | The phrase Mound under construction across the entire dating bracket is stronger than a brief campaign somewhere within it. [Source](https://www.english-heritage.org.uk/visit/places/silbury-hill/history/) |
| `pr-cmp-silchester-start` | already qualified; reject duration inference | EH gives an establishment bracket of c.20–10 BCE and the app summary preserves it. The national phase says oppidum, not ten years under construction. The imported construction-duration objection does not fit this data shape. [Source](https://www.english-heritage.org.uk/visit/places/silchester-roman-city-walls-and-amphitheatre/history/) |
| `pr-cmp-thornborough-end` | substantiated | EH explicitly describes early Bronze Age burial use, which Out of use from 2000 BCE obscures. [Source](https://www.english-heritage.org.uk/visit/places/thornborough-henges/history/) |
| `x-banqueting-link` | disagree: already implemented | Both the 1619 burned ending and the replacement construction through 1622 are already in the app. HRP confirms them. Calling the link missing is incorrect. [Source](https://www.hrp.org.uk/banqueting-house/history-and-stories/the-story-of-banqueting-house/) |
| `x-bermondsey-link` | partly substantiated | Southwark corroborates 1082 and later abbey status but cannot verify the model’s completion or demolition. [Source](https://heritage.southwark.gov.uk/objects/3588/grange-walk--no-7-former--abbey-gatehouse) |
| `x-bridge-storm-link` | substantiated omission | London Museum identifies destruction in 1091; the existing bridge phase and event list omit it. [Source](https://www.londonmuseum.org.uk/collections/london-stories/london-bridge/) |
| `x-famine-link` | enrichment | Cambridge distinguishes crop failures in 1315–17 from the wider 1315–22 crisis and cattle plague. This is useful context; a short crop-failure event is not false merely because it does not encode every later consequence. [Source](https://www.campop.geog.cam.ac.uk/blog/2024/08/29/hansel-and-gretel/) |
| `x-globe-date-link` | disagree: day already present | Shakespeare Birthplace Trust confirms 29 June 1613. That day is already in the app summary and London event note. A day-level renderer is a separate feature, not a factual correction. [Source](https://www.shakespeare.org.uk/explore-shakespeare/shakespedia/shakespeares-globe-theatre/) |
| `x-henry-chapel-link` | enrichment | Abbey source confirms 19 February 1516 consecration. The app’s annual completion anchor is compatible; distinguish ceremony from finishing work rather than replacing the year. [Source](https://www.westminster-abbey.org/history/history-of-westminster-abbey) |
| `x-plague-end-link` | small wording refinement only | London Museum places the peak through spring 1349 and separately uses a by-1352 mortality estimate. The current app does not use 1352 as an epidemic end, so that particular conflation is absent. [Source](https://www.londonmuseum.org.uk/collections/london-stories/great-pestilence-london/) |
| `x-theatre-gap` | substantiated omission | EMLoT’s home page names both Blackfriars I (1576) and II (1596). [Source](https://emlot.org/) |
| `x-westminster-early-link` | substantiated omission | Abbey history confirms the earlier c.960 Benedictine monastery. [Source](https://www.westminster-abbey.org/history/history-of-westminster-abbey) |
| `lm-app-bury-dissolution` | retain year; richer chronology optional | Re-read source confirms 4 November 1539. The annual phase already includes the surrender year. Closure must not be equated with instant demolition; a following calendar-year display phase is not by itself an erroneous surrender date. [Source](https://www.british-history.ac.uk/vch/suff/vol2/pp56-72) |
| `lm-app-furness-dissolution` | retain year; richer chronology optional | Re-read source confirms 9 April 1537. The annual phase already includes the surrender year. Closure must not be equated with instant demolition; a following calendar-year display phase is not by itself an erroneous surrender date. [Source](https://www.english-heritage.org.uk/visit/places/furness-abbey/history/) |
| `lm-app-gloucester-dissolution` | retain year; richer chronology optional | Re-read source confirms 2 January 1540. The annual phase already includes the surrender year. Closure must not be equated with instant demolition; a following calendar-year display phase is not by itself an erroneous surrender date. [Source](https://www.british-history.ac.uk/vch/glos/vol2/pp53-61) |
| `lm-app-peterborough-dissolution` | retain year; richer chronology optional | Re-read source confirms 29 November 1539. The annual phase already includes the surrender year. Closure must not be equated with instant demolition; a following calendar-year display phase is not by itself an erroneous surrender date. [Source](https://www.british-history.ac.uk/vch/northants/vol2/pp83-95) |
| `lm-app-rievaulx-dissolution` | retain year; richer chronology optional | Re-read source confirms 3 December 1538. The annual phase already includes the surrender year. Closure must not be equated with instant demolition; a following calendar-year display phase is not by itself an erroneous surrender date. [Source](https://www.english-heritage.org.uk/visit/places/rievaulx-abbey/history-and-stories/history/) |
| `lm-app-sherborne-dissolution` | retain year; richer chronology optional | Re-read source confirms 18 March 1539. The annual phase already includes the surrender year. Closure must not be equated with instant demolition; a following calendar-year display phase is not by itself an erroneous surrender date. [Source](https://www.british-history.ac.uk/vch/dorset/vol2/pp62-70) |
| `x-oxford-date-link` | disagree with implied foundation correction | Oxford explicitly records teaching in 1096 and rapid growth from 1167. The app says schools gathered in the twelfth century and uses 1167 as a growth phase, not as a known foundation. Its source provenance could improve, but the imported implication is not present. [Source](https://www.ox.ac.uk/about/the-university/history) |
| `x-white-tower-link` | already qualified | HRP gives 1078–1100; the current app summary says begun in the 1070s and complete by about 1100. The construction interval is already encoded. [Source](https://www.hrp.org.uk/tower-of-london/whats-on/white-tower/) |

## Twenty strongest claims that survived challenge

These are the specific fields tested hardest against accessible documentary/institutional evidence. A verified date is not blanket approval of the owning model.

1. **Stone London Bridge completed in 1209.** London Museum independently gives completion of the first stone bridge in 1209. Checked the completion field, not generated arch dimensions. [London Bridge](https://www.londonmuseum.org.uk/collections/london-stories/london-bridge/). `landmark:london/old-london-bridge:completed:0`.

2. **Confessor’s church consecrated in 1065.** The Abbey gives 28 December 1065. This confirms the app’s use of 1065 for the consecrated church, not every part of the monastery. [History of Westminster Abbey](https://www.westminster-abbey.org/history/history-of-westminster-abbey). `landmark:london/westminster-abbey:completed:0`.

3. **Henry III’s east-end campaign reached consecration in 1269.** The Abbey gives 13 October 1269 and explicitly says the old nave remained. The app correctly limits this phase to the east end, transepts and first nave bays. [History of Westminster Abbey](https://www.westminster-abbey.org/history/history-of-westminster-abbey). `landmark:london/westminster-abbey:completed:1`.

4. **Henry VII Chapel consecrated in 1516.** The Abbey gives 19 February 1516. Keep consecration distinct from a claim that every decorative work ended then. [History of Westminster Abbey](https://www.westminster-abbey.org/history/history-of-westminster-abbey). `landmark:london/henry-vii-chapel:completed:0`.

5. **Previous Banqueting House burned in 1619.** Historic Royal Palaces records the predecessor’s fire in 1619. The app already links it to Jones’s replacement; the research-session omission is not present. [The story of Banqueting House](https://www.hrp.org.uk/banqueting-house/history-and-stories/the-story-of-banqueting-house/). `landmark:london/banqueting-house:ended:0`.

6. **Jones’s Banqueting House completed in 1622.** Historic Royal Palaces explicitly gives completion in 1622 and distinguishes the predecessor. [The story of Banqueting House](https://www.hrp.org.uk/banqueting-house/history-and-stories/the-story-of-banqueting-house/). `landmark:london/banqueting-house:completed:1`.

7. **White Tower complete by about 1100.** HRP gives the building interval 1078–1100; the app summary preserves about 1100. This is a conventional endpoint, not precision to a day or proof about every turret. [White Tower](https://www.hrp.org.uk/tower-of-london/whats-on/white-tower/). `landmark:london/white-tower:completed:0`.

8. **Bridge waterworks operational in 1582.** Stow’s 1603 Survey describes the Peter Moris forcier made in 1582 to supply the eastern City. This is contemporary documentary support for the operational year. [Stow, Survey of London: Of the ancient and present rivers](https://www.british-history.ac.uk/no-series/survey-of-london-stow/1603/pp11-19). `landmark:london/bridge-waterworks:completed:0`.

9. **Gresham’s Exchange begun in 1566.** Stow dates the commencement and first brick to 1566, then distinguishes roofing in November 1567 and the later royal naming. [Stow, A Survey of London (1603), 'Cornehill warde'](https://www.british-history.ac.uk/no-series/survey-of-london-stow/1603/pp187-200). `landmark:london/royal-exchange:begun:0`.

10. **Temple round church consecrated in 1185.** The Temple Church’s history explicitly dates consecration of the Round to 1185, separately from the Chancel. [History](https://www.templechurch.com/history). `landmark:london/temple-church:completed:0`.

11. **First Globe burned in 1613.** Shakespeare Birthplace Trust gives 29 June 1613 and identifies the performance fire; the app summary already contains the day. [Shakespeare’s Globe Theatre](https://www.shakespeare.org.uk/explore-shakespeare/shakespedia/shakespeares-globe-theatre/). `landmark:london/globe:ended:0`.

12. **Second Globe present in 1614.** Shakespeare Birthplace Trust says rebuilt by February 1614 with a tiled roof. This supports the annual phase, without certifying the conjectured diameter or side count. [Shakespeare’s Globe Theatre](https://www.shakespeare.org.uk/explore-shakespeare/shakespedia/shakespeares-globe-theatre/). `landmark:london/globe:begun:1`.

13. **London Charterhouse founded in 1371.** The Charterhouse’s history explicitly dates foundation to 1371, distinguishing the earlier plague burial ground and later mansion. [History](https://thecharterhouse.org/explore-the-charterhouse/history/). `landmark:london/charterhouse:begun:0`.

14. **Battle of Hastings — battle year.** The independently opened battlefield account identifies this battle in 1066. This confirms only the dated battle phase. The separate location, size, army numbers and every detail in the owning summary are not certified by this verdict. [Battlefields Hub: Battle of Hastings](https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=17). `place:england-wales/battle-hastings:phase:0`.

15. **Battle of Neville's Cross — battle year.** The independently opened battlefield account identifies this battle in 1346. This confirms only the dated battle phase. The separate location, size, army numbers and every detail in the owning summary are not certified by this verdict. [Battlefields Hub: Battle of Neville's Cross](https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=28). `place:england-wales/battle-nevilles-cross:phase:0`.

16. **Battle of Shrewsbury — battle year.** The independently opened battlefield account identifies this battle in 1403. This confirms only the dated battle phase. The separate location, size, army numbers and every detail in the owning summary are not certified by this verdict. [Battlefields Hub: Battle of Shrewsbury](https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=39). `place:england-wales/battle-shrewsbury:phase:0`.

17. **First Battle of St Albans — battle year.** The independently opened battlefield account identifies this battle in 1455. This confirms only the dated battle phase. The separate location, size, army numbers and every detail in the owning summary are not certified by this verdict. [Battlefields Hub: First Battle of St Albans](https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=111). `place:england-wales/battle-st-albans-1455:phase:0`.

18. **Battle of Towton — battle year.** The independently opened battlefield account identifies this battle in 1461. This confirms only the dated battle phase. The separate location, size, army numbers and every detail in the owning summary are not certified by this verdict. [Battlefields Hub: Battle of Towton](https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=46). `place:england-wales/battle-towton:phase:0`.

19. **Battle of Tewkesbury — battle year.** The independently opened battlefield account identifies this battle in 1471. This confirms only the dated battle phase. The separate location, size, army numbers and every detail in the owning summary are not certified by this verdict. [Battlefields Hub: Battle of Tewkesbury](https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=45). `place:england-wales/battle-tewkesbury:phase:0`.

20. **Battle of Flodden — battle year.** The independently opened battlefield account identifies this battle in 1513. This confirms only the dated battle phase. The separate location, size, army numbers and every detail in the owning summary are not certified by this verdict. [Battlefields Hub: Battle of Flodden](https://www.battlefieldstrust.com/resource-centre/battleview.asp?BattleFieldId=15). `place:england-wales/battle-flodden:phase:0`.

## What remains unverified, and why

- The coverage ledger deliberately leaves facts without individual adjudication visible. In particular, most size bins, exact numeric coordinates, landmark heights, detailed building forms and every century of a long institutional phase lack claim-level independent evidence in this pass. A source proving a place existed was not used to approve those other fields.

- Stonehenge was treated last and lightly. Its 127 per-stone states in 1625, the fall dates inferred from later antiquarian drawings, complete-circle reconstructions, weathering schedules and the exact form of prehistoric pits were not independently established. Their explicit conjectural labels should remain.

- Exact battle deployments, army totals, casualty counts, tide/weather and the locations of unlocated battles remain unresolved. Sixteen coordinate comparisons test only agreement with modern reference markers. No browser/rendering review or reconstruction of all source GIS geometries was performed.

- An ordinal place-size calibration against primary town-population/tax tables was not reconstructed. Taxpayer, fiscal assessment, wealth, enclosed area, institutional significance and population are not interchangeable. The imported research likewise identifies gaps in complete urban rankings.

- Many early kingdom beginnings are traditional or nominal, and the 72 polity labels cannot encode every union, division, overlordship and frontier shift. The review identifies demonstrable contradictions and citation gaps, not a newly researched complete constitutional atlas.

- No builds or server operations were run. The main data and rendering code were not edited. Lifecycle findings use the documented data semantics and actual phase fields; their proposed display changes still need implementation and visual verification by the app owner.

## Preservation, handoff and validation

All writes by this review are confined to the five permitted curated tables and `research/astra/` (working files use the `factkeeper-` prefix; this report uses the expressly required filename). The generated history database and the separate England research database remain read-only. A pre-write backup is [factkeeper-curated-before.sqlite](factkeeper-curated-before.sqlite). This folder has no Git metadata, so no branch or commit is claimed.

Concurrent changes were observed outside this review: 177 initially inventoried files changed or disappeared, mainly interface screenshots and rendering files; the data changes were assets, Barnet site configuration and Stonehenge terrain. [The drift log](factkeeper-drift.json) records hashes without overwriting anything. Reviewed owner objects with changed JSON at final insertion: none. Source snapshots, stable entity/origin keys and original values are retained in every review note.

The existing curated schema was preserved. SQLite integrity and foreign-key checks pass; all 142 targets exist in the preserved generated snapshot; all proposals are valid JSON with exact field values and confidence; all reviews carry checked URLs and access dates. The 77 lead dispositions and 20 strongest claims are complete. [Validation details](factkeeper-validation.json) include counts and untouched research/database hashes.

The Markdown parses into four tables and 55 JSON code blocks, and its section/link structure was checked. An HTML preview was prepared, but visual inspection was unavailable: isolated Chrome exited under the environment restrictions, and the browser-access host was unavailable. No screenshot or successful visual-layout check is claimed. See [the preview limitation record](factkeeper-report-visual-check.json).

Use [the consolidated field-level proposals](factkeeper-proposed-corrections.json) when preparing app edits. Several reviews concern different fields of the same entity: merge those deltas, compare the recorded old value, and retain concurrent changes. Whole-entity old/new objects in SQLite are provenance, not permission to overwrite a later entity. Corrections remain **proposed**, not accepted or applied.
