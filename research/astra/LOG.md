# Research log

## 2026-11-14 — initialization

- Read the research brief, project README, running record, national type contract and national dataset structure; froze the national and London JSON plus relevant documentation under `inputs/app/` with SHA-256 manifest. Detailed domain inspection is continuing against this stable snapshot.
- This directory is not a Git checkout. No server or build is needed or authorized. All research output stays here; other agents may be changing the app independently.
- The app has 243 national places, 73 polity entries, 42 line features, 70 national events, 73 London landmarks and four London episodes. These are baseline claims, not research authority.
- Created a shared packet contract separating identity, dated assertions, sources, positions, uncertainty, disputes and application comparisons.

## Coverage checklist — research passes completed; scope limits below

- [x] Prehistory: monuments, settlements, hillforts and phases.
- [x] Roman: campaigns, garrisons, towns, roads, walls, provinces and end of rule.
- [x] 410–1066: kingdoms, rulers, conversion, battles, Viking armies, burhs, Welsh kingdoms, Danish conquest and 1066.
- [x] 1066–1485: castles, religious houses, boroughs, civil wars, Welsh conquest, famine, plague, revolt and Wars of the Roses.
- [x] 1485–1625: reigns, rebellions, Dissolution, forts, Welsh legislation, Armada, education, theatres, disasters and ports.
- [x] Cross-cutting: battle inventory, market/borough gazetteer, rulers, sees, shires and quantitative series.
- [x] Validate database constraints, citations, dates, coordinates and reproducible SQL dump; report limits and the most important application comparisons.

## Method and scope limits

An exhaustive census of every medieval event or market cannot be assumed from a finite web-research pass. Coverage counts and explicit leads will distinguish completed research from the remaining corpus. Approximate dates and locations will remain approximate. Scholarly alternatives will be retained rather than silently reconciled.

## Checkpoint — parallel historical packets and national gazetteer

- Committed first prehistoric/Roman, early medieval and later medieval packets separately; SQLite integrity and foreign-key checks passed after each successful load. One early local-source URI omission was corrected before loading.
- Fetched all 39 English county pages and the Wales page of Samantha Letters's IHR Gazetteer. Extracted 2,418 catalogue place headers, dated borough/market assertions and 917 available 1334 subsidy assessments. The count differs from the older introductory total; page-level hashes and extracted records are retained. Fair-only entries are not silently promoted to markets.
- Initial conservative extraction identified 1,541 places with a parsed market or borough attestation by 1300; 308 complex or undated entries remain explicit leads. These figures will be revalidated after parser review. Grants are not evidence of continuous operation; borough-inferred markets are reconstructed.
- IHR permits private research and explicitly restricts commercial reuse/republication. The research extraction is retained here, with author attribution and source links; application integration requires resolving those source rights. No public publication is being performed.
- Historical coordinates remain a separate assertion: gazetteer OS grids are transformed to WGS84 with conservative locality radii, and unlocated battle sites remain null.
- London detail checking has verified institutional evidence for Lambeth Palace, Westminster Hall, Globe chronology and further theatre coverage. British History Online, some university pages and some PDF routes return access errors; search snippets are not being counted as page verification.


## Final author review and validation

- Independent domain workers completed packets for prehistory/Roman Britain, 410–1066 and 1066–1625. Each packet was committed as it arrived; final build uses the complete set of authoritative packet JSON.
- Independent review of the national Gazetteer found legacy encoding errors, a merged London table cell, weekday/date conflation and a false Winchester date caused by a bibliography title. Fixed all four; removed all automatically assigned weekdays, retained explicit early-date TODOs, preserved visible source revision dates and made future refresh dates truthful.
- The repaired extraction has 2,418 catalogue headers, 1,638 subsidy observations and 1,559 places with a parsed market/borough attestation by 1300. The 333 market-related open tasks include undated/complex clauses and invalidated or unsuccessful grants. London retains an early-market review task; Barham retains its negative establishment qualification. These last two residual fixes were verified by the author after the independent review.
- Added typed date qualifiers (`at`, `circa`, `between`, `by`, `before`, `after`). Corrected London's by-November plague attestation, the Oxford aggregate founding interval, the early-1620s famine title and the Great Famine JSON pointer. Independent review verified the underlying high-risk sources and the population table; final author checks verify the resolutions.
- Added two NOAA OWDA cells, 1–1625 CE, with column/coordinate alignment checks, source hashes and 3,250 observations. These are local reconstructed summer moisture indices, not national averages. Year zero in the archive was deliberately excluded.
- Added competing population model vintages, 41 decades each of nominal farm wages and cost-of-living index values, and 4000 BCE farming / 3807–3806 BCE Sweet Track anchors. Omitted 1620s economic means because their full decade extends beyond 1625.
- Final source spot-check found Durham's archival catalogue gives 31 December 1539 against VCH's 1540. Both are now source-linked dispute claims; the claim that the app's 1539 date was wrong was withdrawn. Fountains' detailed institutional text supports affiliation three years after its 1132 foundation; this is a refinement, not a different founding date.
- Reclassified Repton's burial count and St Albans' documentary location as agreements: the cautious app wording was not contradicted. The ranked 50 therefore excludes these, as well as omissions and generated identity-only matches.
- Added conservative name/locality app mappings and links between research records corresponding to the same app place, without destructive deduplication or certification of app chronology.
- All 31 tables are documented. The final validation checks all provenance, references, no-zero date arithmetic, day validity, spatial metadata, app pointers, packet hashes, known importer regressions and SQL dump restoration. The restored database matches every table value. This is structural and targeted factual validation, not independent proof of every assertion.

## Remaining limits and safe next use

The checklist means every research area received a completed pass; it does not mean every medieval town, ruler, bishop, battle site or archaeological phase has been independently resolved. See SUMMARY.md and the 406-row todo queue for explicit limits. The complete 52-entry post-1066 English battlefield catalogue is represented, but 19 entries remain deliberately thin source-attributed skeletons. Many battle sites are correctly unlocated. Regional roads, sees, shires, town rankings and construction histories remain selective.

The source-rights restriction on the IHR gazetteer must be resolved before public/commercial application integration. Use source and uncertainty display, battle/campaign dates and existing-site phase corrections first. Reconcile the frozen baseline with later app edits before applying changes. No app source, generated app database, shared runtime, build or server was changed by this research.

## Last breadth additions

- Fetched institutional histories for Deal, Walmer, Pendennis and St Mawes; added coastal artillery-fort construction phases and Pendennis's 1597–1600 enlargement. Wikipedia is used only for four explicitly marked provisional coordinate anchors, never their historical dates. The failed direct-HTTP copies were not used as historical evidence; the readable web pages were fetched.
- Fetched Heneb's Conwy Township record and Cadw's walls page. Added the planned borough (1283), charter (1284), virtually complete works by1287, and separate counts of burgage plots versus burgesses. Heneb's publication/commercial permission condition is recorded beside IHR's actual reuse restriction.
- Final deliverables include schema documentation, example queries, all app comparisons, checksums and validation results. The offline clean rebuild needs only the packets and Python/SQLite; network and app services are not involved.
