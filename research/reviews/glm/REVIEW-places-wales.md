# Independent fact review — Wales places and polities

Reviewed: 2026-11-14  
Slice: all 65 non-battle places in `data/national/places-wales.json` (156 phases) and all 24 polities in `data/national/polities-wales.json`, covering dates, sizes, extents, notes, and any period/Welsh-name fields present. I did not review the five battle entities, because they were outside this slice.

## Counts

- **10 findings total**
  - **S1: 3**
  - **S2: 4**
  - **S3: 3**
  - S4: 0
- **Status**
  - `verified-wrong`: 10
  - `unverified suspicion`: 0
  - `disagree-with-astra`: 0
  - `confirmed-correct`: 0
- **Astra overlap**
  - `already_in_astra_review`: false for all 10
- Findings are in `research/reviews/glm/findings-places-wales.jsonl`.

## S1 and S2 findings

### 1. Tre’r Ceiri is labelled “abandoned” too soon — S2

**App claim:** phase 2 says `"Abandoned hillfort"` from 400 onward.

**Problem:** Coflein says the hillfort was used into the 4th century, but also that “sporadic occupation likely to have extended into the early medieval period.” The app’s uncertainty text only mentions the 4th-century end and omits that likely continuation.

**Evidence:** [Coflein, Tre’r Ceiri hillfort](https://coflein.gov.uk/en/site/95292/).

**Exact proposed correction:**
- `$[3].phases[2].label` → `"No certain hillfort occupation; sporadic use may have continued into the early medieval period"`
- `$[3].phases[2].from` → `400`
- `$[3].phases[2].to` → `null`
- `$[3].phases[2].size` → `0`
- `$[3].phases[2].note` → `"Coflein says sporadic occupation likely extended into the early medieval period; AD 400 is only the end of the well-attested Roman-period use."`
- `$[3].uncertainty` → `"Coflein gives only ‘later Iron Age’ for the foundation and says occupation was sporadic and likely extended into the early medieval period; the years 200 BC and AD 400 are placeholders for those phrases. A Bronze Age cairn on the summit is older than the fort."`

### 2. Parys Mountain’s Bronze Age dates and Roman phase are over-definite — S2

**App claim:** `"Bronze Age copper workings"` from -1900 to -1500; `"Possible Roman copper working"` from 78 to 400, size 1.

**Problem:** The 2021 Bayesian model places first mining in 2245–1785 cal BC (95%; probably 2085–1890) and the end in 1815–1300 cal BC (95%; probably 1735–1485). It also says no Roman underground workings have yet been identified and the current chronology does not extend beyond the Early Bronze Age. A visible Roman phase is therefore more definite than the evidence, despite the low confidence and uncertainty note.

**Evidence:** [The Bronze Age Copper Mines of Parys Mountain, north Wales](https://doi.org/10.1017/ppr.2021.122); [Pleiades, Parys Mountain](https://pleiades.stoa.org/places/82297/json).

**Exact proposed correction:**
- `$[5].phases[0]` → `{"from": -2085, "to": -1485, "label": "Early Bronze Age copper workings", "size": 1, "note": "Bayesian model: start 2245–1785 cal BC (95%), probably 2085–1890; end 1815–1300 cal BC (95%), probably 1735–1485."}`
- `$[5].phases[1].to` → `77`
- `$[5].phases[2]` → `{"from": 78, "to": 400, "label": "No dated Roman workings", "size": 0, "note": "Pleiades calls Parys Mountain a Roman mine, but the 2021 study found no dated Roman underground workings and says the chronology does not extend beyond the Early Bronze Age."}`
- `$[5].summary` → `"A copper-bearing hill in north Anglesey. Bayesian modelling of radiocarbon dates places dated Early Bronze Age mining probably from 2085 to 1485 BC. A Roman attribution is known from gazetteer tradition and stamped Anglesey ingots, but no dated Roman underground workings have been identified."`
- `$[5].uncertainty` → `"The Early Bronze Age dates are modelled ranges (95%: 2245–1300 BC; 68% start/end: 2085–1890 and 1735–1485), not observed years. No dated Roman workings survive; the Roman mining attribution is circumstantial and must not be shown as definite. Later opencast mining destroyed much of the evidence."`

### 3. Caerleon extends reduced fortress occupation to AD 400 — S2

**App claim:** phase 1 says `"Reduced occupation of the fortress"` from 300 to 400, on a high-confidence entity.

**Problem:** Pleiades ends the legionary base at ca. AD 300. The Roman Legion Museum chronology says some buildings were used into the mid-4th century and streets were resurfaced after AD 346/348, but little happened after about 350. The visible phase therefore implies another half-century of occupation.

**Evidence:** [Pleiades, Isca Silurum](https://pleiades.stoa.org/places/79532/json); [Roman Legion Museum chronology](https://museum.wales/roman-legionary-museum/visiting/caerleon-roman-fortress-baths/chronology/).

**Exact proposed correction:**
- `$[8].phases[1]` → `{"from": 300, "to": 350, "label": "Reduced occupation; streets resurfaced after about AD 346/8", "size": 1}`
- `$[8].phases[2].from` → `351`
- `$[8].phases[2].label` → `"Ruined fortress; settlement poorly known"`
- `$[8].uncertainty` → `"Pleiades gives c. AD 75-300 for the legion’s base. The Roman Legion Museum notes some mid-4th-century building use and street resurfacing after AD 346/348, but little after about 350. What happened between the mid-4th century and the Norman castle recorded in Domesday Book is poorly known; 1086 is that record date."`
- `$[8].sources` → add `wal-rlm-caerleon-chronology`
- Add source `wal-rlm-caerleon-chronology` to `national/sources-wales.json`.

### 4. Dinas Powys is shown fifty years too early — S2

**App claim:** `"Post-Roman chieftain’s stronghold"` from 450 to 700.

**Problem:** The app uses a broad traditional span and has no source. The 2023 Antiquity chronology models dated activity as beginning cal AD 510–600 (95%) and ending cal AD 590–680 (95%), with abandonment in the later seventh or eighth century.

**Evidence:** [A new chronology for the Welsh hillfort of Dinas Powys](https://doi.org/10.1017/S0003598X23000443).

**Exact proposed correction:**
- `$[29].phases[0]` → `{"from": 510, "to": 680, "label": "Post-Roman chieftain’s stronghold", "size": 1, "note": "Bayesian model: activity began cal AD 510–600 (95%) and ended cal AD 590–680 (95%); the representative 510–680 span should not be read as observed years."}`
- `$[29].phases[1].from` → `681`
- `$[29].summary` → `"A small defended hilltop near Cardiff, excavated by Leslie Alcock in the 1950s and re-analysed in 2023. Imported Mediterranean and Gaulish pottery, glass and fine metalworking show a wealthy household. Bayesian modelling places the dated activity mainly in the sixth to seventh centuries, with abandonment in the later seventh or eighth century."`
- `$[29].uncertainty` → `"The rampart chronology has been revised repeatedly. The 2023 model gives activity beginning cal AD 510–600 (95%) and ending cal AD 590–680 (95%), but these are probability ranges, not observed years. Some material is earlier or residual, and the exact abandonment date is not fixed."`
- `$[29].sources` → `["wal-antiquity-dinas-powys-chronology"]`
- Add source `wal-antiquity-dinas-powys-chronology` to `national/sources-wales.json`.

### 5. Conwy shows Aberconwy Abbey at its later site six years too early — S1

**App claim:** phase 0 says `"Aberconwy Abbey"` from 1186 to 1283 at the Conwy marker, even though the uncertainty note admits the abbey was only “on this site from the 1190s.”

**Problem:** Aberconwy was founded in 1186 at Rhedynog Felen south of Caernarfon. By 1192 the monks had moved to the mouth of the River Conwy. The current feature therefore appears before it existed at that coordinate.

**Evidence:** [Monastic Wales, foundation event](https://monasticwales.org/event/99); [Monastic Wales, relocation event](https://monasticwales.org/event/236).

**Exact proposed correction:**
- `$[41].phases[0].from` → `1192`
- `$[41].phases[0].label` → `"Aberconwy Abbey at the mouth of the Conwy"`
- `$[41].summary` → `"Edward I and Master James of St George built the castle and a 1.3 km circuit of town walls here between 1283 and 1287. The site had held the Cistercian abbey of Aberconwy from 1192, burial place of Llywelyn ap Iorwerth, after its move from Rhedynog Felen; the king moved the community up the valley to Maenan in 1283."`
- `$[41].uncertainty` → `"Aberconwy was founded in 1186 at Rhedynog Felen south of Caernarfon and moved to the mouth of the Conwy by 1192, so this marker begins only with the Conwy-site phase. The later move to Maenan and the castle-building dates are well documented."`
- Add source `wal-monastic-wales-aberconwy-site` to `national/sources-wales.json` and `$[41].sources`.

### 6. Strata Florida is placed at its present site twenty years too early — S1

**App claim:** phase 0 says `"Cistercian abbey"` from 1164 to 1539 at the present abbey marker, while the uncertainty note says the first community may have been on a different site and moved here in the 1180s.

**Problem:** Cadw says Strata Florida has stood beside the Teifi since 1184. The 1164 foundation belongs to the community’s earlier site, not the feature at the present coordinate.

**Evidence:** [Cadw, Strata Florida Abbey](https://cadw.gov.wales/visit/places-to-visit/strata-florida-abbey).

**Exact proposed correction:**
- `$[53].phases[0].from` → `1184`
- `$[53].phases[0].label` → `"Strata Florida Abbey at its Teifi site"`
- `$[53].summary` → `"A Cistercian abbey in the Ceredigion uplands. The community was founded in 1164 on an earlier site and moved to the present Teifi site in 1184 under the patronage of the Lord Rhys. The monks entered their new church in 1201. Welsh princes were buried here and it supported the Welsh cause; it closed by 1539."`
- `$[53].uncertainty` → `"The first community was founded in 1164 but may have begun on a different site nearby; Cadw dates the present site to 1184. This marker therefore starts only with the abbey’s Teifi-site phase. The closure date is 1539."`

### 7. Basingwerk is placed at its present site too early — S1

**App claim:** phase 0 says `"Abbey (Savigniac, then Cistercian)"` from 1131 to 1536 at the present ruins, while the uncertainty note says the first community may have been at a different site.

**Problem:** Monastic Wales says the c.1131 first site may have been Coleshill, about 5 km south-east, and records that the community likely moved in 1157 when Basingwerk became a dependency of Buildwas. The marker therefore starts up to about 26 years before the present site is documented.

**Evidence:** [Monastic Wales, foundation event](https://monasticwales.org/event/107); [Monastic Wales, Basingwerk site](https://monasticwales.org/site/24).

**Exact proposed correction:**
- `$[57].phases[0].from` → `1157`
- `$[57].phases[0].label` → `"Basingwerk Abbey on its present site (Savigniac, then Cistercian)"`
- `$[57].phases[1].from` → `1537`
- `$[57].summary` → `"An abbey near Holywell on the Dee estuary, founded as a Savigniac house in c.1131 and probably moved to the present site in 1157 when it became a dependency of Buildwas; it entered the Cistercian Order in 1147 and was much rebuilt in the 13th century. Wat’s Dyke reaches the estuary close by."`
- `$[57].uncertainty` → `"The community was founded c.1131, but Monastic Wales says its first site may have been Coleshill or another nearby location and that it likely moved to the present site in 1157. The marker therefore begins only with the present-site phase. Cadw dates dissolution to 1536, while Monastic Wales gives late 1536 to spring 1537."`

## S3 findings

1. **Llyn Cerrig Bach** has no source, even though [Amgueddfa Cymru](https://museum.wales/articles/2007-05-03/ancient-druids-of-wales/) directly supports the 300 BC–AD 100 deposition range and the object classes. Proposed: add `wal-museum-llyn-cerrig-bach` to `national/sources-wales.json` and set `$[6].sources` to that ID.
2. **Deceangli** has no source and omits name uncertainty. [RIB 2404.32](https://romaninscriptionsofbritain.org/inscriptions/2404.32) supports the AD 74 lead mark but warns that the tribe name may be Ceangi, Deceangi, Decangi or Deceangli. Proposed: add `wal-rib-2404-32` and revise `$[3].note` to include that uncertainty.
3. **Llandaff** has no source. [Llandaff Cathedral’s history](https://www.llandaffcathedral.org.uk/discover-the-cathedral/history-of-the-cathedral/) supports a Christian presence from at least the 6th century and the present building around 1120 under Bishop Urban. Proposed: add the cathedral history and a Book of Llandaff source, and revise the uncertainty note to distinguish the cathedral’s account from the 12th-century charters.

## Disagreements with Astra

I found no disagreement with Astra’s Wales-related conclusions in this slice. I agree with Astra that Hywel Dda’s earliest surviving law manuscript belongs to the last quarter of the 12th century; the current JSON has already adopted that correction. I also agree that Rhodri’s control of Powys in 855 is stated too definitely, but Astra already reported that issue, so I did not duplicate it. Astra’s St Davids correction is also already reflected in the current JSON.

## Systemic patterns

- **Site-relocation chronology:** Conwy, Strata Florida, and Basingwerk all begin their visible phases with the community’s foundation year even though the current JSON acknowledges that the first site was different or may have been different. The phase at each coordinate should begin only when the community can be placed there.
- **Exact numbers standing in for probability ranges:** Parys Mountain and Dinas Powys both display conventional year spans instead of the Bayesian model ranges that now exist for those sites.
- **Missing sources:** several checkable entities have empty source arrays or no direct source for their dates, particularly Llyn Cerrig Bach, Deceangli, and Llandaff. Some uncertainty notes are candid about general knowledge, but a visible fact should still point to at least one readable source.

## Claims I tried hardest to break and could not

- Cadw’s dates for Chepstow Castle, Castell y Bere, and Dolforwyn Castle match the app.
- Coflein’s Nidum dates match the app’s 75–125, 140–170, and 275–320 brackets.
- The 2023 Dinas Powys article confirms Alcock’s excavation and the imported Mediterranean/Gaulish material, even though it revises the site’s phase chronology.
- Monastic Wales confirms the 889–893 timber-felling date and the 916 attack on Brecenanmere.
- Cadw confirms Caerwent’s AD 75–80 foundation, Segontium’s AD 394 horizon, and Y Gaer’s AD 75 foundation.
- The main polity chronologies from Gwynedd, Powys, Deheubarth, Hywel Dda, Gruffudd ap Llywelyn, and the 1535–6 Acts align with their cited sources and existing uncertainty notes.

## What I could not check

- I did not render the app, because this run was a data fact review and the task prohibited starting servers or builds.
- I did not verify every polygon as a surveyed boundary; those polygons are explicitly indicative. I checked their coordinate ranges against the stated regions and found no obvious wrong-region polygon.
- The Wales places file contains no `altNames` or period-name arrays, and the Wales polities file has no Welsh-name field. I could therefore review only the `name` strings as they exist; I could not adjudicate absent period-specific Welsh names.
- I could not fetch the National Library of Wales page directly because it returned 403, but the web tool returned its readable page content and the Llandaff Cathedral page was fetched successfully.
- Some Roman tribal boundaries and early medieval polity extents are not known as surveyed lines. The app already labels several of those as “no extent drawn,” and I did not invent polygons for them.
