Completed the Stonehenge-only adversarial review.

**Outputs written**

- Findings: [`research/reviews/glm/findings-stonehenge.jsonl`](research/reviews/glm/findings-stonehenge.jsonl)
- Review report: [`research/reviews/glm/REVIEW-stonehenge.md`](research/reviews/glm/REVIEW-stonehenge.md)

**Finding counts**

| Severity | Count |
|---|---:|
| S1 — factually wrong and visible | 1 |
| S2 — misleading or over-confident | 6 |
| S3 — sourcing defect | 0 |
| S4 — minor | 1 |
| **Total** | **8** |

All 8 findings are `verified-wrong`; 7 were not in Astra’s review, and 1 is an Astra-adjacent issue at a different detailed-site path.

**Most consequential findings**

1. **Woodhenge is dated about a century too late** and its timber settings and enclosing henge are collapsed into one construction episode. Historic England’s 2024 model dates the timber settings to 2635–2575 BCE and the ditch and bank to 2495–2180 BCE, probably 2465–2345 BCE. Evidence: [Historic England](https://historicengland.org.uk/research/results/reports/9107/WoodhengeDurringtonWiltshire_RadiocarbonDatingandChronologicalModelling).
2. **Durrington’s timber ring overlaps its replacement henge** for about three decades, although the posts were removed and their sockets filled before the henge covered them. Evidence: [Current Archaeology](https://archaeology.co.uk/articles/features/rethinking-durrington-walls-a-long-lost-monument-revealed.htm).
3. **The detailed Durrington house zone still spreads a 10–12-year occupation across an 85-year visual window**, even though Astra’s national-level duration correction was applied.
4. **The Altar Stone’s provenance is under-stated**: current evidence points to Old Red Sandstone from the Orcadian Basin in northeast Scotland, not merely “outside southern Britain.” Evidence: [Nature](https://www.nature.com/articles/s41586-024-07652-1).
5. **The Lesser Cursus is shown about 500 years too late**, resolving a documented date conflict in favour of a weaker c. 3000 BCE value instead of English Heritage’s c. 3500 BCE. Evidence: [English Heritage](https://www.english-heritage.org.uk/visit/places/stonehenge/history-and-stories/stonehenge-reconstructed/).
6. **Amesbury Abbey’s 1177 refoundation is treated as a completed priory church**, although Henry II’s new house and church were completed by 1186. Evidence: [British History Online](https://www.british-history.ac.uk/vch/wilts/vol18/pp1-6).

**Astra conclusions**

- I agree with Astra H01 and H02.
- I agree with deferred H03 and H04: Aubrey Holes and the Stonehenge ditch should not retain `high` entity confidence while their visible-state dates are admitted modelling conventions.
- Astra’s H02 was correct but incomplete: it fixed the national Durrington place, not the detailed-site house zone.

**Verification and limitations**

- The JSONL file contains 8 valid one-object-per-line records with unique IDs.
- Every finding has at least one source actually read during this run.
- I did not modify any `data/`, source, database, application, or build files.
- I did not run the app, rebuild the database, or execute tests, in accordance with the brief’s restrictions.
- I could not independently re-survey the 127 stone coordinates, terrain/LIDAR surface, OpenStreetMap outlines, or individual barrow identifications; those limitations are documented in the review.