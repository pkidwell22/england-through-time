# GLM review — non-battle places in `data/national/places.json`

## Scope and counts

The assigned slice was non-battle places in `data/national/places.json`, limited to dates, period names (`altNames`) and their ranges, size ranks, and coordinates.

- 150 non-battle place records screened at data level.
- 42 records ever assigned size 4 or 5.
- 28 records have a phase beginning before year 1.
- 55 records have a Roman-period phase beginning in years 1–471.
- 90 records are in the union of those high-size and prehistoric/Roman groups.
- The remaining 60 records were sampled; all 150 non-battle records were ultimately inspected at data level.
- 3 findings appended.
- Severity: S1 = 1; S2 = 2; S3 = 0; S4 = 0.
- Status: `verified-wrong` = 3; `unverified suspicion` = 0; `disagree-with-astra` = 0; `confirmed-correct` = 0.
- `already_in_astra_review`: false for all 3 findings.

The current JSON still contains all three reported claims; none had been fixed by the concurrent corrections agent when the final check was made.

## S1/S2 findings

### `glm-places-england-001` — Grime’s Graves (S1, verified-wrong)

**App claim:** phase 0 is “Deep flint mines being dug” from `-2600` to `-2101`, size 4, while the summary says the mines were “worked from about 2600 to about 2100 BCE.”

**Problem:** this treats a later, brief resumption of mining as roughly 500 years of continuous deep mining. The 2018 radiocarbon modelling places the deep galleried shafts probably from the third quarter of the 27th century cal BCE, ending in the decades around 2400 cal BCE. Mining then resumed briefly, only after about a half-millennium gap, in the middle 16th to middle 15th centuries cal BCE.

**Evidence:** [When and Why? The Chronology and Context of Flint Mining at Grime’s Graves, Norfolk, England](https://doi.org/10.1017/ppr.2018.14), Proceedings of the Prehistoric Society / Cambridge University Press, accessed 2026-11-14.

**Exact proposed correction** in `national/places.json`:

```json
{
  "$[12].phases[0].label": "Deep galleried flint mines being worked",
  "$[12].phases[0].from": -2675,
  "$[12].phases[0].to": -2400,
  "$[12].phases[1].from": -2399,
  "$[12].phases[1].label": "Mines disused; later Bronze Age pit digging, then middens and a settlement from about 1400 BCE",
  "$[12].summary": "A field of more than 400 late Neolithic flint mine shafts in the Norfolk Breckland. The deep galleried shafts were probably worked from the third quarter of the 27th century to around 2400 BCE; after a gap of about half a millennium, mining briefly resumed in the 16th to 15th centuries BCE."
}
```

### `glm-places-england-002` — Dover (S2, verified-wrong)

**App claim:** “Dubris, base of the Classis Britannica, with twin lighthouses” runs from `117` to `270`, followed immediately by a “Saxon Shore fort” from `271` to `410`.

**Problem:** English Heritage says the Classis Britannica fort was demolished around AD 215 and a new fort was constructed around AD 270. The current phase extends the Classis Britannica phase through the demolition and starts the Saxon Shore phase only one year after the new construction. The exact 117 start is also more precise than the source’s “seventy years after the Roman invasion in AD 43.”

**Evidence:** [History of Dover Castle](https://www.english-heritage.org.uk/visit/places/dover-castle/history-and-stories/history/), English Heritage, accessed 2026-11-14.

**Exact proposed correction** in `national/places.json`:

```json
{
  "$[55].phases": [
    {"label": "Dubris: Classis Britannica fort and twin lighthouses", "from": 113, "to": 215, "size": 3},
    {"label": "Harbour settlement after the earlier fort was demolished", "from": 216, "to": 269, "size": 1},
    {"label": "Saxon Shore fort", "from": 270, "to": 410, "size": 2},
    {"label": "Small harbour settlement", "from": 411, "to": 899, "size": 1},
    {"label": "Burh, port and minster of St Mary in Castro", "from": 900, "to": 1065, "size": 2},
    {"label": "Royal castle and head port of the Cinque Ports", "from": 1066, "to": null, "size": 3}
  ],
  "$[55].altNames[0].from": 113,
  "$[55].summary": "The shortest crossing to Gaul. A Roman fort and port at Dubris began seventy years after the invasion; the Classis Britannica fort was completed around AD 130, demolished around 215, and a new shore fort was built around 270. The Roman lighthouse still stands inside the castle, whose great tower Henry II built in 1179–89."
}
```

### `glm-places-england-003` — Scarborough (S2, verified-wrong)

**App claim:** phase 1 is “Deserted” from `411` to `1129`, size 0.

**Problem:** the blanket “Deserted” label contradicts the same record’s own uncertainty note and English Heritage, which records a chapel on the headland by about AD 1000. Claiming total desertion for more than seven centuries is misleading; the phase should preserve the sparse-recorded character and the chapel evidence.

**Evidence:** [History of Scarborough Castle](https://www.english-heritage.org.uk/visit/places/scarborough-castle/history-and-stories/history/), English Heritage, accessed 2026-11-14.

**Exact proposed correction** in `national/places.json`:

```json
{
  "$[124].phases[1].label": "Headland with little recorded occupation; a chapel by about AD 1000",
  "$[124].phases[1].note": "The word ‘deserted’ was too strong: English Heritage records a chapel on the headland by about AD 1000, before the castle of the 1130s.",
  "$[124].summary": "A late 4th-century Roman signal station on a headland that later held a chapel by about AD 1000 and a major royal castle from the 1130s."
}
```

## Disagreements with Astra

No evidence-based disagreement with Astra was established in this slice. Claims already covered by Astra were not repeated as new findings.

## Claims tried and not reported

- West Kennet Long Barrow’s `-3650` construction, “at least 1,000 years” of use, and about `2000 BCE` closure match the cited English Heritage page.
- Stonehenge’s about 3000 BCE earthwork, about 2500 BCE stone settings, and 1800–1500 BCE Y and Z holes match the English Heritage chronology.
- Windmill Hill’s 3675–2500 BCE range and “largest of all known causewayed enclosure sites in Britain” claim are supported by English Heritage.
- Coordinates were compared against readily available reference coordinates for all matching place names. The differences reviewed were either small, consistent with a different legitimate centre point, attributable to a matching error (for example, Boston, Lincolnshire versus Boston, Massachusetts), or already covered by Astra. No new coordinate finding was established.
- Thornborough’s “largest ritual complex between the Thames and Orkney” superlative, Uffington’s broad dates, and Cirencester’s persistence of `Corinium` after the Roman administrative phase were not sufficiently disproved by the sources read to justify new findings.

## What I could not check

- External verification was targeted, not exhaustive for all 150 records. Every record was screened at data level, but not every date, phase, size rank, alternative name, and coordinate was checked against an independent source.
- No systematic authoritative coordinate comparison against a full national gazetteer was completed. Wikipedia coordinate matching was used only as a screening lead, not as authority.
- No exhaustive comparison with Pleiades was completed; the JSON search endpoint used earlier returned no useful response.
- Size ranks are the application’s relative ordinal system, not directly documented population figures, so only clearly contradictory evidence was treated as an error.
- The generated SQLite database was not rebuilt or used as authority for corrections; current JSON was treated as the source of truth.
- Battles, Wales, site-specific files, polities, lines, events, and keyframes were outside this slice and were not reviewed here.
