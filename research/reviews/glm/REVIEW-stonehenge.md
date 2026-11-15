# Stonehenge fact review — GLM

Checked: 14 November 2026. Scope: only `data/locations/stonehenge/*.json` — site chronology, central stone settings, 127-entry stone catalogue, surrounding monuments, eras, events, episodes and zones. No data, source, database, application or build files were changed.

## Counts

| Measure | Count |
|---|---:|
| Findings | 8 |
| S1 — factually wrong and visible | 1 |
| S2 — misleading or over-confident | 6 |
| S3 — sourcing defect | 0 |
| S4 — minor | 1 |
| `verified-wrong` | 8 |
| `unverified suspicion` | 0 |
| `disagree-with-astra` | 0 |
| Not previously in Astra's review | 7 |
| Astra-adjacent, but at a different site-file path | 1 |

All eight findings are in `findings-stonehenge.jsonl`, one valid JSON object per line. Every finding cites a source read during this run.

## S1 and S2 findings

### 1. S2 — Altar Stone provenance is under-stated

**App claim:** “A slab of green-grey sandstone … from outside southern Britain.”  
**Problem:** This is technically compatible with the newer evidence but too vague and out of date. The strongest current geological work points to Old Red Sandstone from the Orcadian Basin in northeast Scotland, at least 750 km from Stonehenge; the exact outcrop remains unresolved.  
**Evidence:** [A Scottish provenance for the Altar Stone of Stonehenge](https://www.nature.com/articles/s41586-024-07652-1), Nature, accessed 14 November 2026. The study's age and chemistry evidence excludes southern Britain and points to the Orcadian Basin.

**Exact correction** for `locations/stonehenge/landmarks.json`:

- Add source `sto-nature-altar-stone-2024` to `locations/stonehenge/sources.json` and to `$[7].sources`.
- `$[7].summary`:
  > A slab of green-grey sandstone about 4.9 x 1.0 x 0.5 m at the foot of the Great Trilithon. Its chemistry most closely matches the Old Red Sandstone of the Orcadian Basin in northeast Scotland, at least 750 km away; the exact outcrop remains unresolved. Drawn lying flat at ground level.
- `$[7].uncertainty`: replace “its source is unsettled” with:
  > Current mineral evidence points to the Orcadian Basin in northeast Scotland, but the exact outcrop is unresolved.

### 2. S2 — Lesser Cursus is shown about half a millennium too late

**App claim:** Lesser Cursus: fresh chalk `[-3050 → -2750]`, `built=-3000`; its own note says that the c. 3000 BCE date conflicts with English Heritage.  
**Problem:** The model resolves a documented conflict in favour of a Wikipedia-only value. English Heritage dates the Stonehenge and Lesser Cursus to about 3500 BCE.  
**Evidence:** [Stonehenge Reconstructed](https://www.english-heritage.org.uk/visit/places/stonehenge/history-and-stories/stonehenge-reconstructed/), English Heritage, accessed 14 November 2026: the Stonehenge and Lesser Cursus were built about 3500 BC.

**Exact correction** for `$[16]` in `locations/stonehenge/landmarks.json`:

| Field | New value |
|---|---|
| `summary` | Add: “English Heritage dates it to about 3500 BCE; a c. 3000 BCE date has also been reported, so the construction date is uncertain.” |
| `uncertainty` | State that the date is uncertain; English Heritage says about 3500 BCE and c. 3000 BCE has also been reported; `-3500` is a display date. |
| `phases[0]` | `from=-3550`, `built=-3500`, `to=-3200`, `end="handover"`, label `Lesser Cursus: fresh chalk (display date; construction uncertain)` |
| `phases[1]` | `from=-3200`, `to=-2800`, `end="handover"` |
| `phases[2]` | `from=-2800`, `to=1`, `end="handover"` |

### 3. S2 — Amesbury's 1177 refoundation is drawn as a completed priory church

**App claim:** “Fontevraud priory church (form unknown)” from 1177, with `built=null`.  
**Problem:** 1177 was the refoundation, not the completion of the new priory buildings. Henry II then had a new house and church built; the nuns were installed in 1186. The current phase therefore makes the church appear complete at the institutional change.  
**Evidence:** [A History of the County of Wiltshire: Volume 18, Amesbury Hundred](https://www.british-history.ac.uk/vch/wilts/vol18/pp1-6), British History Online, accessed 14 November 2026.

**Exact correction** for `$[45]` in `locations/stonehenge/landmarks.json`:

| Field | New value |
|---|---|
| `phases[1].label` | `Fontevraud priory church built 1177-1186 (form unknown)` |
| `phases[1].built` | `1186` |
| `uncertainty` | Say that the 1177 refoundation was followed by construction completed by 1186; the form remains unknown. |
| `sources` | Add `sto-bho-vch-wilts18`; register it in `locations/stonehenge/sources.json`. |

### 4. S2 — Durrington's timber ring and henge overlap for three decades

**App claim:** Timber ring `[-2490 → -2450]`, `end="replaced"`; henge `[-2480 → -2430]`.  
**Problem:** The marked replacement phases overlap from 2480 to 2450 BCE. Current Archaeology reports that the posts were removed and their sockets filled before the henge covered them.  
**Evidence:** [Rethinking Durrington Walls: a long-lost monument revealed](https://archaeology.co.uk/articles/features/rethinking-durrington-walls-a-long-lost-monument-revealed.htm), Current Archaeology, accessed 14 November 2026.

**Exact correction** for `$[28].phases[0]`:

| Field | Old | New |
|---|---:|---:|
| `from` | `-2490` | `-2530` |
| `built` | `-2480` | `-2520` |
| `to` | `-2450` | `-2481` |

This keeps the timber ring inside the reported maximum 50-year window and hands over to the henge phase beginning at `-2480`.

### 5. S2 — The detailed Durrington village still spreads a 10–12-year occupation over 85 years

**App claim:** `durrington-houses` grows `[-2525 → -2505]` and declines `[-2480 → -2440]`, while its note says the village was occupied for about 10–12 years ending c. 2500–2460 BCE.  
**Problem:** Astra correctly fixed the national Durrington place, but the detailed-site zone still visually implies a multi-decade settlement.  
**Evidence:** [Rethinking Durrington Walls](https://archaeology.co.uk/articles/features/rethinking-durrington-walls-a-long-lost-monument-revealed.htm), Current Archaeology, accessed 14 November 2026: the village is modelled as roughly 10–12 years, ending c. 2500–2460 BCE.

**Exact correction** for `$[0]` in `locations/stonehenge/zones.json`:

| Field | New value |
|---|---|
| `grow` | `[-2506, -2500]` |
| `decline` | `[-2500, -2494]` |
| `note` | Retain the evidence, but state: “The model uses a 12-year display window (-2506 to -2494), a visual convention rather than a measured occupation span.” |

This finding is Astra-adjacent (`already_in_astra_review: true`) because Astra covered the same defect in the national place, but this is a separate detailed-site path.

### 6. S1 — Woodhenge's timber settings and henge are collapsed into one c. 2470 BCE construction

**App claim:** Woodhenge timber rings `[-2480 → -2350]`, `built=-2470`; Woodhenge ditch and bank `[-2480 → -2400]`, `built=-2470`.  
**Problem:** Historic England's 2024 chronological model dates the timber settings to 2635–2575 cal BC (95%), and the ditch and bank to 2495–2180 cal BC (93%), probably 2465–2345 cal BC. It also finds that rings A and B probably decayed before the henge was built. The current model is roughly a century too late for the timber settings and merges two construction episodes.  
**Evidence:** [Woodhenge, Durrington, Wiltshire: Radiocarbon Dating and Chronological Modelling](https://historicengland.org.uk/research/results/reports/9107/WoodhengeDurringtonWiltshire_RadiocarbonDatingandChronologicalModelling), Historic England, accessed 14 November 2026.

**Exact correction** for `locations/stonehenge/landmarks.json`:

- `$[31].phases[0]`: `from=-2635`, `built=-2600`, `to=-2350`, `end="decay"`.
- `$[31].phases[0].label`: `Woodhenge: six oval rings of timber posts (timber settings built 2635-2575 BCE; all rings drawn together as a simplification)`.
- `$[31].uncertainty`: cite the 2024 ranges and say that rings A and B probably decayed before the henge; ring C may have survived longer, but the current model cannot show the rings separately.
- `$[32].phases[0]`: `from=-2495`, `built=-2400`, `to=-2350`, `end="handover"`.
- `$[32].phases[1]`: `from=-2350`, `to=-2200`, `end="handover"`.
- `$[32].uncertainty`: cite the 2495–2180 (93%) and probable 2465–2345 ranges; `-2400` is a display year.
- Add source `sto-he-woodhenge-2024` to `locations/stonehenge/sources.json` and to both Woodhenge entities' `sources`.

### 7. S2 — The Woodhenge event uses an outdated ditch date

**App claim:** “Woodhenge ditch dug” at `-2470`; note says “Ditch dated 2470 to 2000 BCE”.  
**Problem:** This is the old broad date and does not distinguish the earlier timber settings from the later henge. Historic England's 2024 model gives 2635–2575 for the timber settings and 2495–2180 (93%), probably 2465–2345, for the ditch and bank.  
**Evidence:** [Historic England, Woodhenge radiocarbon dating and chronological modelling](https://historicengland.org.uk/research/results/reports/9107/WoodhengeDurringtonWiltshire_RadiocarbonDatingandChronologicalModelling), accessed 14 November 2026.

**Exact correction** for `$[10]` in `locations/stonehenge/events.json`:

| Field | New value |
|---|---|
| `year` | `-2400` |
| `label` | `Woodhenge ditch and bank built (display date c. 2400 BCE)` |
| `note` | Historic England's 2024 model dates the timber settings to 2635–2575 BCE and the ditch and bank to 2495–2180 BCE at 93% probability, probably 2465–2345 BCE; `-2400` is a display date. |
| `sources` | `["sto-wp-woodhenge", "sto-he-woodhenge-2024"]` |

## Minor finding

**S4 — Coneybury Anomaly is still labelled “date unverified.”** English Heritage dates the earliest cattle bone from the pit to 3950–3790 BCE. For `$[0]` in `events.json`, change the label to `Coneybury Anomaly feasting pit: earliest cattle bone 3950-3790 BCE`, revise the note to distinguish the dated bone from every use of the pit, and add existing source `sto-eh-reconstructed`. Evidence: [Stonehenge Reconstructed](https://www.english-heritage.org.uk/visit/places/stonehenge/history-and-stories/stonehenge-reconstructed/).

## Astra: agreement and gaps

- **H01 (AD 43 ruin):** agree. The detailed site's AD 1 boundary is clearly labelled a convention, and Astra was right that the national AD 43 phase must not imply a dated destruction.
- **H02 (Durrington duration):** agree, but Astra's accepted national correction did not cover the detailed `durrington-houses` zone; finding 5 above closes that gap.
- **H03/H04 (Aubrey Holes and ditch confidence):** agree. Both entities remain `attested-excavated` and `high`, while their own uncertainty text says that filled-dimple and erosion dates are modelling conventions. Astra's proposal to reduce entity confidence to `medium` is reasonable and should be applied by the Stonehenge data owner.

There is no direct disagreement with Astra. The new findings are mainly gaps in detailed-site paths or newer/better sources that Astra's light final pass did not reach.

## Claims I tried hardest to break and could not

- Darvill/EH Stage 1–5 chronology: 3000–2620, 2620–2480, 2480–2280, 2280–2020 and 2020–1520 BCE are consistent with the fetched chronology.
- Sarsen circle, trilithon, Q/R, central bluestone, oval, outer circle and horseshoe phase boundaries are broadly consistent with the modelled stage ranges.
- The Avenue's 2345–2200 BCE date and approximately 2.7 km course are supported.
- Central Stonehenge dimensions, the fitted centre, the Heel Stone distance and the main stone counts are consistent with the sources checked.
- Bush Barrow's c. 1950 BCE date, rich Early Bronze Age assemblage and Normanton Down location survived checks.
- The 1625 stone-state model is appropriately presented as reasoning backwards from later plans, not as direct observation.
- Solstice episodes clearly separate computed overlay geometry from real scene lighting and state their interpretive limits.

## What I could not check

- I did not run the app, build the database, or execute tests; the brief forbade builds and this run made no application changes.
- I did not independently re-survey the 127 stone coordinates, LIDAR/terrain surface, OpenStreetMap outlines, or individual barrow identifications.
- Generic barrow group counts, forms and pseudo-random build sequences are explicitly illustrative and mostly lack dated evidence; I did not treat those conventions as checkable historical facts.
- I did not review the national Stonehenge or Durrington records except to compare Astra's already-applied findings with this detailed-site slice.
- For Woodhenge I used Historic England's accessible 2024 report summary rather than re-modelling the radiocarbon data.
