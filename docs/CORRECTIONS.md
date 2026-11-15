# Corrections, 14 November 2026

This records how the corrections workstream handled the adversarial fact review by GPT-6 Astra (`research/astra/FACT-REVIEW.md`, proposals in `data/db/curated.sqlite`), the research session's five corrections (`research/astra/SUMMARY.md`), two further reviews (DeepSeek, GLM), and the agreed London items. Every change was checked against the cited source by this workstream, or against a second reputable source where the cited page refused automated access. The checks were made by Claude Opus 5.5 with Sonnet sub-agents doing bounded page reads. Paths were located by entity id, not by the reviewer's snapshot array index.

**Outcome for Astra's 49 proposals:**

| Accepted as proposed | Accepted with changes | Rejected | Deferred |
|---:|---:|---:|---:|
| 23 | 24 | 0 | 2 |

All 47 applied proposals are marked `applied` in `curated.sqlite`. The two deferred ones stay `proposed`. "As proposed" allows rewording: the reviewer's notes were often written in reviewer language ("the app itself calls…"), which is unsuitable for display, so the substance was kept and the text rewritten. Parts of several "accepted with changes" proposals were rejected; the reasons are in the table.

## Systemic fixes

### a. Buildings shown complete at the start of a long campaign: lifecycle change

**Problem.** A phase with `continues: true` skipped construction and ignored `built`. Its predecessor ended by `handover` at the same year. So Westminster Abbey's 156 m nave appeared complete in 1376, although it was finished only in 1517.

**Why the reviewer's fix was rejected.** Astra proposed `continues: false` with `built`. That makes the old structure vanish at the start and the whole building rise from the ground. Westminster Hall's Norman walls, Henry III's abbey and the first Greyfriars church all stood throughout their campaigns, so this would be a new error.

**Fix: extension phases.** These are an additive part of the schema and lifecycle.

- `src/lib/lifecycle.ts`:
  - `isExtension(p)` is true when `continues` is set and `built` is later than `from`.
  - `phaseStatus` draws an extension as under construction from `from` to the end of `built`.
  - A `handover` predecessor carrying a runtime `heldUntil` stays intact until the extension is complete, then hands over with no gap.
  - `linkExtensions(phases)` sets `heldUntil` as a non-enumerable property, so nothing is written to the JSON. It works like `attachVesselTypes`.
- `src/lib/types.ts`:
  - The documentation for `continues` is extended.
  - The new field is `readonly heldUntil?: HistYear` (runtime only).
- `src/lib/data.ts`:
  - `buildDataset` calls `linkExtensions` for every landmark.
  - `validateDataset` reports an extension whose previous phase does not end by `handover`.
- Documented in `docs/MODEL-KINDS.md` under "Dating / Extension phases".
- Tests in `tests/unit/corrections.test.ts`. One old test in `tests/unit/lifecycle.test.ts` encoded "continues ignores built"; it now tests a plain continuing phase, with a comment citing this correction.

No existing phase anywhere had `continues` together with `built`, so no existing rendering changed until data used it.

**Sweep.** Every `continues` phase in London, Brentford and Barnet was examined: 25 London phases outside the river craft, 3 at Barnet and 0 relevant at Brentford. The 84 Stonehenge continuing phases are weathering conventions and carry no `built`, so they are unaffected.

Converted to extensions (5 landmarks):

| Landmark | Campaign | Source |
|---|---|---|
| Westminster Abbey nave | 1376–1517 | Westminster Abbey, "The Nave" |
| Westminster Hall roof and heightened walls | 1393–c.1399 (display anchor) | Hansard 1914 gives 1393–1402 |
| Greyfriars great church | 1306–27 | VCH London 1 |
| Old St Paul's New Work | 1251–1314 | VCH gives 1251 for the start. The 1314 completion is the existing spire-dedication date and is not confirmed by the VCH pages read |
| St Mary Overie tower heightening | 1520–28 | VCH Surrey 4; from the DeepSeek review |

Two non-continuing phases with documented campaigns were widened rather than given new precision:

- Guildhall built 1430 → 1440, the end of the City's 1411–1440 range; confidence high → medium.
- Lambeth Palace built 1230 → 1250, because RCHME puts the chapel in the mid 13th century.

Left as they are, with the reason:

- city-wall, bridge-houses and bridge-chapel: no campaign.
- temple-church 1240: the date is the chancel's consecration, which marks completion.
- lambeth-palace[1]: Morton's Tower is dated 1490 by RCHME.
- winchester-palace: the early-14th-century hall is consistent with the 1300 phase.
- austin-friars 1354, baynards-castle-2 1501 and whitehall 1530: no source read gives a duration.
- Barnet churches: the completion years are recorded as unknown.

**Observed, not fixed (model owner).** The `church` model is centred on the landmark point. So when the abbey's length grows from 110 to 156 m, the extension rises at both ends, not only westward. The completed 1520 form is unchanged from before. This is a modelling issue for whoever owns the church builder and the landmark geometry.

### b. Peoples ending at AD 43 (16 polities)

Fifteen English peoples ran from −50 to 43. Wales's Silures and Demetae already ran to 410. All 15 now run to 410, the end of Roman rule:

> cantiaci, trinovantes, catuvellauni, iceni, atrebates, regni, belgae, durotriges, dumnonii, dobunni, corieltauvi, cornovii, brigantes, parisi, votadini

The evidence:

- **Ptolemy, Geography II.2 (c.150 CE)** names every one of them with its towns. This was read on LacusCurtius.
- **Roman Inscriptions of Britain** names civitates:
  - RIB 288 Cornovii (129–130)
  - RIB 1672 Durotriges
  - RIB 1843 Dumnonii
  - RIB 1962 Catuvellauni
  - RIB 2022 Brigantes (stone lost; the reading is unchecked)
  - RIB 2250 Dobunni (last letter disputed)
  - RIB 707 Petuaria (Parisi)
  - RIB 91 Togidubnus (Regni)
- **Tacitus, Annals XIV.29–31**: the Iceni client kingdom lasted to the revolt of 61.
- **Tacitus, Histories III.45 and Agricola 17**: Cartimandua and Venutius in 69, then Cerialis's attack on the Brigantes.

The peoples' notes were rewritten. The Wikipedia-only `nat-wp-roman-britain` citation was replaced on all of them.

Rejected parts of Astra's proposals:

- N24/N25 would have turned the Iceni and Brigantes into kingdoms ending in 61 and 70. That swaps one false end for another.
- N26 would have kept the Carvetii only in the unevidenced pre-Roman span. Instead the Carvetii now run from 222 to 410. They appear from the earliest dated evidence of the civitas (RIB 3526, 222/223), and the note says the civitas may be older.

Northumbria: a new record, `northumbria-early` (604–642, Bede), shows the earlier unions under Aethelfrith, Edwin and Oswald. It is explicitly not continuous. The 654 record is kept with a corrected note. This follows the research session's "successive phases" approach. Astra's proposal to move the start to 634 was rejected because it would lose Edwin.

### c. Dissolution: institutional closure is not physical ruin

In the national map, size 0 is drawn as an "abandoned" ring. Where the community ended, the size was kept at 0; the labels that claimed an instant "Ruin" now say what the sources say happened to the buildings. Sizes were raised only where the buildings stayed in use.

**National: 13 places.**

| Place | What changed |
|---|---|
| lindisfarne | Buildings kept for Crown defence; forts 1542–45 (EH) |
| jarrow | Size 0 → 1; the east part was kept as the parish church (EH) |
| fountains | Sold 1540 to Gresham and stripped (NT) |
| rievaulx | Dismantled for the Earl of Rutland; lead and bells reserved for the king (EH) |
| furness | Church pulled down by the commissioners (EH) |
| whitby | The church shell stood until the 18th century (EH) |
| canterbury | St Augustine's partly made a royal palace from 1539 (EH) |
| battle-abbey | Browne's house; church pulled down |
| tintern | Decayed slowly (Cadw) |
| strata-florida | Lead stripped, then left to fall into ruin (Cadw) |
| valle-crucis | Size 0 → 1; east range made a house (Coflein/Cadw) |
| neath-abbey | The mansion is later 16th century, not 1539 |
| basingwerk | Sold, partly demolished; lead taken for Holt and Dublin |

The England notes rest on English Heritage (EH) and National Trust (NT) pages. Several of the Welsh, Glastonbury and Battle aftermath details were seen only in search summaries of Cadw, Coflein and EH pages. They were used for labels, not for dates.

**London: 5 landmarks.**

| Landmark | What changed |
|---|---|
| st-bartholomew | Surrendered 1539; 1543 is a display boundary for the nave's demolition |
| blackfriars | 1538 is the institutional boundary, not the physical one |
| bermondsey-abbey | Demolition year not established |
| holy-trinity-aldgate | VCH: surrendered 1532, granted 1534; demolition year not established |
| charterhouse | Disbanded 15 November 1538; buildings stood derelict until sold on 14 April 1546. The handover moved 1545 → 1546 (VCH Middlesex) |

### d. Display boundaries labelled as dated events (17 places)

Labels such as "Abandoned" or "Disused" at nominal years were relabelled with a note citing the source's own limits. The affected places:

> chesters, housesteads, corbridge, birdoswald, brecon-gaer, segontium, whitby (9th century), bryn-celli-ddu, pentre-ifan, thornborough-henges, grimspound, silbury-hill, durrington-walls, stonehenge (national phase 3), pevensey, wroxeter, richborough

Confidence fell from high to medium for chesters, housesteads, corbridge, whitby, segontium, pevensey and battle-lewes.

## Agreed items

**Great Stone Gate.** The 1437 phase now ends by handover in 1577, and a new continuing phase from 1577 carries `heads`. `src/scene/district.ts` draws heads whenever the visible phase's model has a numeric `heads`; the number is only a random seed. So the heads now appear only from 1577.

Source: MoEML "Drawbridge Tower", citing Stow 1633: heads were shown on the drawbridge tower until it was rebuilt in 1577. Strype (1720) and Gatehouse, seen in search results, add that the heads moved to the Southwark gate.

**London terrain** (`data/locations/london/site.json`, from `research/lidar.md`):

- Tower Hill: 2 m → 1 m. The LIDAR shows no separate crest; it is the end of the Cornhill spur.
- Walbrook `fill` keyframes: 0.35/0.6/0.8/0.85 → 0.2/0.35/0.45/0.5 for 400/1300/1500/1600. With the 6 m analytic depth, the valley left open in 1600 goes from 0.9 m to 3.0 m. That is consistent with the 3.5 m still visible today.
- The terrain note records this.

**City absolute height: deferred, not changed.** The LIDAR note says the analytic Cornhill crest (about 17.4 m above modelled high water) matches the modern surface, not the natural one. A source check found only:

- a secondary text giving natural summits of about 12 m OD (Cornhill) and 13 m OD (Ludgate). It was read from an unofficial copy of a published book and is not cited;
- search-snippet site figures of natural brickearth or gravel at about 11–12 m OD around Cornhill.

No MOLA, BGS or Historic England figure was reached. What would verify it:

- a MOLA monograph or the BGS made-ground and natural-surface model for the City, giving the natural surface in m OD;
- a published Roman high-water level (for example the Britannia papers on Roman tidal levels).

The terrain base should then be lowered by the difference. That is a terrain-owner change and was not attempted here.

**Research session's five corrections.** All five held on checking:

1. Lindisfarne: Bede IV.29 says Cuthbert "died in the isle of Farne" and was buried at Lindisfarne. The Inner Farne identification comes from Astra's National Trust reading; NT blocked automated access.
2. Hywel Dda: DWB says the earliest manuscript is from the last quarter of the 12th century.
3. Northumbria: successive phases, implemented as described above.
4. Mynydd Carn: renamed "Battle of Mynydd Carn (site unknown)", with a new uncertainty note. Coflein says the site "remains undetermined" and favours Cemais. The dot itself cannot be suppressed without a code change.
5. Grimspound: EH gives no climate cause or abandonment date.

## Astra's 49 proposals

Abbreviations:

- Decisions: **A** = accepted, **M** = accepted with changes, **D** = deferred.
- Sources: EH = English Heritage, VCH = Victoria County History, NT = National Trust, DWB = Dictionary of Welsh Biography, ODNB = Oxford Dictionary of National Biography.
- Files: `L` = `data/locations/london/landmarks.json`, `P` = `data/national/places.json`, `PW` = `places-wales.json`, `PO` = `polities.json`, `POW` = `polities-wales.json`.

| # | Code | Entity | Sev. | Astra's claim | Decision and reason | Sources checked | Changed |
|---|---|---|---|---|---|---|---|
| 1 | L01 | westminster-abbey nave | S1 | Nave complete in 1376; finished 1517 | **M**: keep `continues` and add `built: 1517` as an extension, so Henry III's church stands until then. Rejected `continues: false`, which would rebuild the abbey from the ground | Abbey "Nave" page (1376, 1517) | L phases[2] built, label, dateNote; source |
| 2 | L02 | westminster-hall roof | S1 | Roof complete at its 1393 commission | **M**: extension with `built: 1399`, labelled a display anchor. Norman walls kept. The parliament.uk page refused access; Hansard gives 1393–1402 | Hansard 1914; search results | L phases[1] |
| 3 | L03 | greyfriars | S1 | Great church shown complete in 1306 | **M**: extension with `built: 1327`. The first church stood, and Joyner's chapel became part of the choir. The 64 ft height is not in VCH, which the note now says | VCH London 1 | L phases[1] |
| 4 | L04 | saxon-bridge | S2 | Omits the storm of 1091 | **M**: relabelled successive bridges; 1091 storm event added to London events; no invented rebuild date | London Museum | L phases[0]; `events.json` |
| 5 | L05 | mithraeum | S2 | Mithraic use held to 380 | **M**: "about 80 years" is phrased as "early 4th century", not as Astra's derived 320–330 | MOLA | L phases[0] |
| 6 | L06 | st-bartholomew | S2 | Priory kept past the 1539 surrender | **M**: surrender 1539 per VCH; nave demolition year unknown; 1543 is a display boundary | VCH; Great St Barts | L phases[0] |
| 7 | L07 | blackfriars | S2 | Blackfriars I (1576) omitted | **M**: added, with the 1538 surrender date and a demolition caveat | EMLoT; VCH | L phases[1]; source |
| 8 | L08 | westminster-abbey | S2 | Monastery of c.960 omitted | **M**: summary rewritten; c.960 confirmed by the Abbey; no invented fabric | Abbey history | L summary |
| 9 | L09 | lambeth-palace | S3 | 1230 completion unsupported | **M**: Astra's Historic England claims (1197, 1200, hall before 1234) could not be read (403), and RCHME differs (acquired 1189–90, Langton 1207–29, chapel mid 13th century). Used RCHME; built 1230 → 1250 | RCHME London 2 | L phases[0] built, dateNote; phases[1] dateNote; source |
| 10 | L10 | bermondsey-abbey | S3 | 1140 and 1538 unsupported | **A**: 1082 confirmed; demolition flagged as unknown | Southwark Heritage | L phases[0]; source |
| 11 | L11 | guildhall | S2 | 1430 completion unsupported | **M**: built widened to 1440, the end of the City's 1411–1440 range; confidence medium | City of London; Gresham | L |
| 12 | N01 | lindisfarne | S1 | Cuthbert died on Farne | **M**: "died on his hermitage island of Farne … buried here" | Bede IV.29; EH | P summary; Bede source |
| 13 | N02 | hywel-dda | S1 | Manuscripts date from the 12th century, not the 13th | **A** | DWB | POW note |
| 14 | N03 | northumbria | S1 | Absent under Edwin and Oswald | **M**: separate record 604–642 instead of moving the start to 634 | Bede III.6 | PO new record; note |
| 15 | N04 | grimspound | S2 | Climate abandonment invented | **A** | EH | P phases[1] |
| 16 | N05 | battle-mynydd-carn | S2 | Catalogue point treated as a candidate | **M**: shorter display name; uncertainty rewritten | Coflein | PW |
| 17 | N06 | jarrow | S2 | Jarrow marker dated to 674 | **M**: from 681 (EH). The 685 dedication is not on the EH page and was omitted. Dissolution phase size 0 → 1 (parish church) | EH | P phases[0] and [4] |
| 18 | N07 | rhodri-mawr | S2 | Powys in 855 too definite | **M**: DWB (definite 855) and ODNB (possible, 855 or later) disagree, and both are now stated | DWB; ODNB abstract | POW; source |
| 19 | N08 | powys | S2 | Same point as N07 | **M**: as N07 | as N07 | POW |
| 20 | N09 | winchester | S2 | Exclusive "largest burh" | **A**: 2,400 hides, the same as Wallingford. The ADS PDF is image-only; the figure was confirmed through Roffe and Oxford pages in search results | ADS edition (cited) | P summary; source |
| 21 | N10 | battle-lewes | S2 | Exact ground uncertain | **A**: confidence medium | Battlefields Trust | P |
| 22 | N11 | st-davids | S1 | Not first episcopal in 1115 | **M**: cites Asser's Archbishop Nobis | Asser ch.79 | PW summary, phases[0]; source |
| 23 | N12 | fountains | S2 | Cistercian only from 1135 | **A**; also the dissolution sweep and a source | NT (via search summary) | P |
| 24 | N13 | burgh-castle | S2 | Gariannonum identification uncertain | **A** | EH | P |
| 25 | N14 | silbury-hill | S2 | Dating window treated as a duration | **M**: EH also says it was enlarged over generations | EH | P |
| 26 | N15 | birdoswald | S2 | 411 and 520 are display boundaries | **A** | EH | P |
| 27 | N16 | chesters | S2 | 411 abandonment | **A** | EH | P |
| 28 | N17 | housesteads | S2 | 411 abandonment | **A** | EH | P |
| 29 | N18 | corbridge | S2 | 411 desertion | **M**: EH says the town was abandoned rapidly, so Astra's "decline" framing was not used | EH | P |
| 30 | N19 | brecon-gaer | S2 | 300 abandonment | **A** | Cadw | PW |
| 31 | N20 | segontium | S2 | Exact 394 evacuation | **M**: accepted. Astra's "phases overlap" point is the Wales files' shared-boundary convention, not an error | Cadw | PW |
| 32 | N21 | whitby | S2 | 9th-century date unknown | **A**; dissolution phase also corrected | EH | P |
| 33 | N22 | pevensey | S1 | "Deserted" for 472–1065 | **M**: split into about a century deserted (EH), then reoccupied 572–1065. Astra's size 1 for the whole span would have contradicted EH | EH | P phases[2], new [3] |
| 34 | N23 | maiden-castle | S1 | Not the largest hillfort | **A**: Ham Hill is 84 ha | EH; Oxford hillfort atlas | P; source |
| 35 | N24 | iceni | S1 | Vanish at 43 | **M**: systemic fix b, to 410; the kingdom relabelling was rejected | Tacitus; Ptolemy | PO |
| 36 | N25 | brigantes | S1 | Vanish at 43 | **M**: as N24 | Tacitus Histories and Agricola; Ptolemy; RIB 2022; EH Stanwick | PO |
| 37 | N26 | carvetii | S2 | Shown only before their evidence begins | **M**: shown 222–410 from RIB 3526, rather than relabelled as conjectural | RIB 3526 | PO |
| 38 | N27 | military-way | S2 | Shifted line labelled "excavated" | **A**: evidence set to reconstructed | lines.json uncertainty; EH | `lines.json` |
| 39 | N28 | torksey | S2 | Town and camp conflated | **A**: the HER says the camp spans Brampton and Torksey parishes | Lincs HER | P; source |
| 40 | N29 | richborough | S2 | Small fort and stone fort conflated | **A** | EH | P |
| 41 | N30 | bryn-celli-ddu | S2 | End of use undated | **A** | Cadw | PW |
| 42 | N32 | pentre-ifan | S2 | End of use undated | **A** | Cadw | PW |
| 43 | N33 | thornborough-henges | S2 | Bronze Age burials continued | **A** | EH | P |
| 44 | N34 | lindisfarne 1538 | S1 | Instant ruin | **A** | EH | P phases[4] |
| 45 | N35 | wroxeter | S2 | "Never built over" overstated | **A** | EH | P |
| 46 | H01 | stonehenge (national) | S2 | AD 43 is not a ruin event | **A** | EH | P phases[3] |
| 47 | H02 | durrington-walls | S2 | Century-long settlement | **A** | EH | P phases[0]; source |
| 48 | H03 | stonehenge/aubrey-holes | S2 | Confidence should be medium | **D**: the file belongs to the Stonehenge team; the proposal looks reasonable | — | — |
| 49 | H04 | stonehenge/ditch-bank | S2 | Confidence should be medium | **D**: as H03 | — | — |

Astra's A01 to A05 additional statements:

- A01 (bridge storm of 1091) was added as a London event.
- The 1563, 1603 and 1625 plague epidemics were added as London events. Boulton was read: plague killed 20–25% of Londoners in those years.
- A02 is covered by L08, A03 by L07 and A04 by N26.
- A05 (Altar Stone) concerns a Stonehenge file and is left to the Stonehenge team.

## S3 sourcing findings

Of Astra's 45 S3 rows, 7 were resolved with real sources:

- L09 and L10;
- C-atrebates, C-belgae, C-catuvellauni, C-dobunni and C-trinovantes, where Ptolemy and RIB replace Wikipedia-only citations.

Fountains now cites the National Trust, and Northumbria cites Bede. The national Brentford battle from the DeepSeek review now cites the Anglo-Saxon Chronicle (Avalon). The remaining 38 S3 rows stay flagged: the C-* kingdoms, earldoms, towns and provinces, and B-dyrham. No Wikipedia was added.

## Other reviewers

### DeepSeek (`research/reviews/deepseek`): 8 findings, 7 survived

| Id | Entity | Decision and reason |
|---|---|---|
| DS-LON-001 | winchester-palace | **Rejected.** The cited Heritage Gateway record refused access. The Historic England list entry dates the hall to the early 14th century, which matches the data. The "c.1340 rebuild" and the hall of the 1250s were not found |
| DS-LON-002 | custom-house | **M (uncertainty only).** The Survey of London vol. 15 does say the 1382 house was superseded in 1559 under Paulet. But the Gresham lecture cited by the app says Winchester's 1558 plan "was never realised". The sources conflict, so both are now stated and the single building is kept. Deferred until resolved |
| DS-LON-003 | charterhouse | **M.** Disbanded 15 November 1538, but VCH shows the buildings stood, used as a royal storehouse, until the sale of 14 April 1546. Handover moved to 1546 and the institutional end stated |
| DS-LON-004 | st-olave | **M.** The cited page returned 404. The invented 1070–96 campaign was removed (`built` dropped) and the 1086/1096 attestations put in the note. A start in 1018 was not adopted, because it is not established |
| DS-LON-005 | Londinium event | **M.** London Museum gives 47–50 CE: the year is now 47 and the label "Londinium founded (47–50 CE)" |
| DS-LON-006 | st-mary-overie | **A.** Southwark Cathedral records a Domesday minster in 1086. Added as a placeholder phase from 1086 to 1106 |
| DS-LON-007 | st-mary-overie | **A.** VCH Surrey dates the tower to 1520–28; the phase is now an extension |
| DS-NAT-001 | battle-brentford-1016 | **A.** Anglo-Saxon Chronicle source added (Avalon, read); uncertainty fixed |

### GLM (`research/reviews/glm`)

**places-england: 3 findings, 3 survived with changes.**

- glm-places-england-001, Grime's Graves. The Healy et al. 2018 abstract was read. Galleried shafts are now shown from −2650 to −2401, with shallow pits to about 2100 BCE and a brief resumption in the mid 2nd millennium. GLM's −2675 was wrong: the third quarter of the 27th century BCE is 2650–2626.
- glm-places-england-002, Dover. EH confirms the fort was begun about 113, completed after about 130, demolished about 215, and replaced by a new fort about 270. The interim is a new phase.
- glm-places-england-003, Scarborough. EH, via search, gives a chapel by about 1000. Relabelled.

**places-wales: 10 findings, 7 survived.**

| Decision | Findings |
|---|---|
| Accepted | 001 Tre'r Ceiri (Coflein); 003 Llyn Cerrig Bach (Museum Wales source); 006 Llandaff (cathedral source); 008 Conwy (abbey here from 1192, Monastic Wales); 009 Strata Florida (on the Teifi site from 1184, Cadw) |
| Accepted with changes | 005 Deceangli: RIB 2404.32 source added, but its commentary says the pigs *establish* the form Deceangli, contrary to GLM's "uncertain". 010 Basingwerk: Monastic Wales says the community only "likely" moved in 1157, so the 1131 start is kept and the move recorded in the uncertainty |
| Deferred | 002 Parys Mountain and 007 Dinas Powys: the cited DOIs return 404 and the modelled ranges could not be read. 004 Caerleon: the museum chronology page returns 404, and Pleiades alone does not justify restructuring the phases |

**polities-lines: 6 findings, none applied.**

| Decision | Finding and reason |
|---|---|
| Rejected | 001 Hadrian's Wall: the line's own summary and uncertainty already say it was given up about 142 and reoccupied about 160, and that the break is not drawn; lines cannot carry a gap in the schema |
| Deferred | 002 Great North Road: the Hertfordshire HER and Baldock sources were not read, though the app's own note concedes the medieval route went via Ware. Moving the start from 1200 to 1600 is a visible change that needs that check |
| Deferred | 004 Northumbria 867–954: the northern rump under Bamburgh rulers is plausible, but the cited Cambridge chapter is paywalled and the other citation is Wikipedia; one Northumbria polygon cannot honestly cover it while Jorvik is shown |
| Deferred | 006 Ridgeway: the cited articles are paywalled. A 900 CE start would be a large visible change on unread evidence |
| Deferred (engine) | 003 regional sea level and 005 a separate woodland curve for Wales: both need engine or schema support for regional curves, not data edits |

**Not yet arrived** when this workstream finished: GLM `stonehenge` (`chunks-status.txt` listed places-england, places-wales and polities-lines). Its findings go to the Stonehenge team. So far 10 of GLM's 19 findings have survived.

## Late items

- **Steelyard (from the streets agent).** The compound's centre (51.5103, −0.0907) lay on the Thames Street line (about 51.5102 at that longitude). It was moved to 51.5099 and turned to bearing 100 to run parallel to the street, so it now sits between the street and the waterfront. Stow (Downegate ward, read) places it "next to" Cosin Lane on the east, and MoEML (read) puts it south of Thames Street on the later Cannon Street station site. That supports the existing longitude east of the modelled Walbrook mouth, rather than the "west of Dowgate" in the request. Screenshot: `steelyard-1600-after`; no before shot was taken.
- **Vessels agent's entries.** The vessels agent finished and added `river-craft-prehistoric` and `lundenwic-beach-craft`, so `landmarks.json` now has 75 entries. This workstream did not touch any river-craft entry.

## How reliable Astra's review proved

Every one of Astra's substantive historical findings that could be checked held up:

- Cuthbert's death on Farne, the Hywel manuscripts, Northumbria, the Iceni and Brigantes, Maiden Castle, Lindisfarne after 1537, and the Westminster, Greyfriars and Guildhall campaigns;
- the 411/394/300 abandonment class and the Dissolution class.

Of 49 proposals, 47 were applied (23 as proposed and 24 with changes), none was rejected outright, and 2 were deferred only because of file ownership.

Its errors were in the remedies, not the diagnoses:

- `continues: false` for buildings that stood throughout their rebuilding (L01–L03);
- moving Northumbria's start to 634, which loses Edwin;
- making Pevensey occupied throughout the century EH calls deserted;
- turning peoples into kingdoms ending in 61 and 70, which replaces one false end with another;
- keeping the Carvetii only in their unevidenced span;
- Lambeth claims drawn from a Historic England garden listing that RCHME contradicts;
- a 685 dedication date absent from the cited EH page;
- a Segontium "overlap" that is a file convention;
- display notes written in reviewer meta-language.

DeepSeek: 7 of 8 findings survived (3 as proposed). Its custom-house finding ignored a contrary source already cited by the app.

GLM: 10 of 19 findings survived across three of its four parts; most of the rest are deferred for unread or paywalled sources. It gave two wrong DOIs and miscalculated one century bracket.

## Screenshots

All are in `docs/screenshots/corrections/`, captured headless from the running dev server.

| Shot | Before / after |
|---|---|
| `westminster-abbey-1400-*`, `-1450-*`, `-1520-*` | Before: the full nave in 1400. After: Henry III's church standing with the new nave rising, 20% in 1400 and 54% in 1450, complete in 1520 |
| `westminster-hall-1395-*` | Norman hall with the new roof and walls rising |
| `greyfriars-1315-*` | First friary with the great church rising |
| `st-pauls-1280-*` | Romanesque church with the New Work rising |
| `stone-gate-1570-*`, `stone-gate-1580-*` | Heads present in 1570 before the fix; none in 1570 after; present in 1580 in both |
| `walbrook-1600-*` | Valley left 3 m deep instead of 0.9 m. Barely visible at overview distance |
| `tower-hill-1600-*` | Tower Hill bump reduced from 2 m to 1 m |
| `st-mary-overie-1524-after` | Tower heightening under way |
| `national-peoples-100-after` | British peoples labelled through the Roman period |

National "before" shots were not captured, because the national data had already been edited.

## Verification

- Every JSON file parses.
- Each write re-read the file immediately before writing, checked that the file's own formatting round-trips, and renamed atomically.
- `npx tsc --noEmit` is clean.
- `npx vitest run`: 10 files, 285 tests pass, including the 14 new tests in `tests/unit/corrections.test.ts`.
- `python3 scripts/db/build.py`:
  - 0 dangling sources;
  - 0 foreign-key violations;
  - the only warnings are 2 duplicate-source warnings in the Stonehenge team's `stones.json`.
- `python3 tests/db_check.py`: 124/124 pass, with no spot-checks changed.
- `python3 scripts/db/export_factsheet.py` regenerated the fact sheet.
- Validators report zero problems:
  - a headless load of every site (`tests/dbg.mjs`) logs no dataset-problem warnings;
  - `/?map=1` loads ready;
  - `validateNational(loadNational())` and `validateDataset` for every site return `[]` in vitest.
