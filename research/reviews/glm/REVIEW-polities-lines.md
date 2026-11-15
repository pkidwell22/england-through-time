# Independent review — national polities, lines, eras, events, woodland and sea level

## Scope and counts

- **Data reviewed:** `data/national/polities.json` (49 polities), `data/national/lines.json` (42 line features), `data/national/eras.json` (10 eras), `data/national/events.json` (70 events), the woodland keyframes and note in `data/national/site.json`, and the sea-level keyframes and notes in `data/national/terrain.json`.
- **Findings written:** 6.
- **Severity:** 3 S1, 3 S2.
- **Status:** 6 verified-wrong, 0 unverified suspicion, 0 disagree-with-Astra, 0 confirmed-correct.
- **Astra overlap:** none of these six findings is already in Astra’s review.

## S1 findings

### 1. Great North Road is shown as a medieval road from 1200

- **App claim:** Great North Road (London–York–Berwick) from 1200 to present, described as “the main medieval road from London to the north” via Barnet, Hatfield, Baldock, Stamford, Grantham, Newark, Doncaster, Boroughbridge, Durham and Newcastle to Berwick.
- **Problem:** This is a post-medieval alignment and name. The dataset’s own note says the medieval route out of London by Ware, Royston and Huntingdon was more important, and the name “Great North Road” is post-medieval. Showing this exact later route from 1200 is anachronistic.
- **Evidence:** [Heritage Gateway record for the old course of the Great North Road, Hatfield Park](https://historicengland.org.uk/listing/heritage-gateway/results/record/8fb85ebe-9746-4b69-913b-01e07726c4d7/MHT30634), [Baldock Museum and Local History Society, *The Road to London*](http://baldockhistory.org.uk/wp-content/uploads/2019/12/History-Streets-Road-to-London.pdf), and [greatnorthroad.co.uk route summary](https://greatnorthroad.co.uk/route).
- **Exact correction:** rename the feature to **Great North Road (London–York–Berwick; later route)**, change `from` to **1600**, and rewrite the summary to describe it as a post-medieval road assembled in the 16th century from local roads and later a coaching route, not as the main medieval road.

### 2. Southern sea-level curve is applied to the whole national map

- **App claim:** The terrain sea-level keyframes are a single curve from **−6.0 m** in 4000 BCE to **−0.25 m** in 1625, but the note says they describe the Thames/Fenland/Hampshire-Sussex-Kent region and should not be used at full strength north of about 53.5°N. The engine passes one interpolated scalar to the national terrain shader.
- **Problem:** This drowns too little or shows the wrong sign on northern coasts. The same data note admits that Northumberland relative sea level was around **+1.5 m** and the Solway **+2 to +4 m** at 4000 BCE, while the model applies **−6 m**.
- **Evidence:** [Shennan, Bradley and Edwards 2018 on ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0277379118300040) and the underlying [Mendeley Data](https://data.mendeley.com/datasets/rfw98r8g83/1).
- **Exact correction:** replace the single scalar `seaLevel` array with a region-specific or latitude-dependent model. No exact JSON replacement is possible under the current single-value schema without a code/schema change, so this is recorded as a required model change rather than a one-line JSON edit.

### 3. Northumbria vanishes for nearly a century after 867

- **App claim:** Kingdom of the Northumbrians runs **654–867**, and the Earldom of Northumbria only starts in **954**. No Northumbrian polity is shown in between.
- **Problem:** York and southern Deira fell to Viking rulers, but northern Northumbria did not disappear. Bamburgh-based rulers continued to hold the north, later as high-reeves or earls under West Saxon suzerainty, until the area became an English earldom in 954. The current dates create a misleading gap of about 87 years.
- **Evidence:** [The Kingdom of Northumbria, Cambridge University Press](https://doi.org/10.1017/cbo9781139031370.006) and, as a corroborative lead only, [Earl of Northumbria](https://en.wikipedia.org/wiki/Earl_of_Northumbria).
- **Exact correction:** rename the entity to **Northumbria: kingdom, Bamburgh rulers and earldom**, change `to` to **954**, and update the summary to explain that after Viking York took Deira in 867 the northern rump continued under Bamburgh rulers/high-reeves before the earldom.

## S2 findings

### 4. Hadrian’s Wall is drawn continuously through its Antonine phase

- **App claim:** Hadrian’s Wall runs **122–410** and is described as “the north-west frontier of the Roman empire for nearly 300 years,” although its own note says it was abandoned about 142 when the frontier moved to the Antonine Wall and later reoccupied.
- **Problem:** A single continuous interval cannot represent both the physical monument and the change of active frontier. The wording also overstates a continuous 300-year active frontier when the Antonine Wall temporarily held that role and some Hadrianic forts were only partially garrisoned.
- **Evidence:** [English Heritage, History of Hadrian’s Wall](https://www.english-heritage.org.uk/visit/places/hadrians-wall/hadrians-wall-history-and-stories/history/) and [English Heritage, History of Housesteads Roman Fort](https://www.english-heritage.org.uk/visit/places/housesteads-roman-fort-hadrians-wall/history/).
- **Exact correction:** keep the line as the physical monument, but rewrite the summary and uncertainty to state that the **active frontier** moved to the Antonine Wall about 142, that some forts may have kept reduced garrisons, and that the single line intentionally does not model the 142–160 phase separately.

### 5. England-only woodland curve is applied to Wales

- **App claim:** The woodland trend is described as “for England,” with a note that “Wales was more wooded at most dates.” The engine uses one interpolated woodland scalar for the whole national map.
- **Problem:** Applying the England trend across England and Wales under-renders Welsh woodland at most dates. This is a visible regional mismatch, not just a data-formatting issue.
- **Evidence:** [Cambridge chapter on forests and uplands](https://doi.org/10.1017/cbo9780511976056.006) and [Forest Research, *British forest landscapes: the legacy of woodland fragmentation*](https://cdn.forestresearch.gov.uk/2022/02/qjf_legacy_of_fragmentation_may06.pdf).
- **Exact correction:** replace the single woodland curve with separate England and Wales curves, or with a regionally blended model. As with sea level, this is a model/schema change, not a single JSON field fix.

### 6. The Ridgeway is over-dated as a continuous Neolithic road

- **App claim:** The Ridgeway is drawn from **3000 BCE** onward as “the chalk ridge route from the Avebury area … to Ivinghoe Beacon,” despite being labelled conjectural and low confidence.
- **Problem:** The geometry is the modern National Trail, not a single proved prehistoric road. Archaeologists have long questioned the idea of a continuous Icknield Way/Ridgeway; the earliest firm evidence for a way in this area is much later.
- **Evidence:** [*The Icknield Way: Some Queries*, Archaeological Journal](https://doi.org/10.1080/00665983.2003.11078167), [*The Ridgeway between Avebury and Overton Downs*](https://doi.org/10.1111/j.1749-5991.1995.tb00014.x), and [Wantage.com historical summary](https://wantage.com/historic-places/the-ridgeway-and-icknield-way/).
- **Exact correction:** rename the feature to **Ridgeway / Icknield Way: possible later prehistoric corridor**, change `from` to **900**, and rewrite the summary to describe a possible later corridor rather than a proved Neolithic road.

## Disagreements with Astra

I have no material disagreement with Astra’s findings in this slice. The current JSON already reflects Astra’s accepted corrections for Iceni, Brigantes, Carvetii and Military Way, so I did not repeat them.

## Systemic patterns

- **One scalar for a two-country map:** sea level and woodland both admit regional variation but are rendered with a single national value.
- **Modern geometry back-projected:** the Great North Road and Ridgeway use modern route lines and then claim medieval or prehistoric dates.
- **Single intervals hide phases:** Northumbria and Hadrian’s Wall are represented as one continuous date range even though their political or military status changed materially.

## What I could not check

- Exact construction dates for most Roman roads. The data itself says the dates are estimates from associated forts and towns, not road excavations.
- Exact 1536 boundary geometry against the modern ONS-derived line. The data says it is a modern simplification, but I did not attempt a full historical boundary reconstruction.
- Runtime visual output. I reviewed the data and engine interpolation code, but I did not start the app or render screenshots.
- Some cited web pages were not directly fetchable in this session; where that happened, I relied on the most reliable available source text and did not report unsupported speculation as fact.

