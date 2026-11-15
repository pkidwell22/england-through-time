# England and Wales research database

Research snapshot: **14 November 2026**. Historical scope: **4000 BCE–1625 CE**. Read [SUMMARY.md](SUMMARY.md) for coverage, counts, the 50 priority app comparisons and remaining weaknesses. This is a sourced research corpus, not an assertion that every historical question has been settled.

## Deliverables

- `england.sqlite`: relational database, with foreign keys and provenance on every historical assertion.
- `schema.sql`: complete SQLite schema, including table comments, constraints, indexes and views.
- `england.sql`: UTF-8 SQL dump; restoring it reproduces every table value.
- `packets/*.json`: authoritative offline research inputs. Every assertion is independently addressable.
- `inputs/app/`: frozen app baseline and SHA-256 manifest. Comparisons concern this snapshot, not subsequent parallel edits.
- `inputs/market-extraction.json`: structured factual extraction of all 40 IHR county/Wales pages, with fetch dates and content hashes.
- `inputs/owda-two-cells.json`: selected annual climate values and source/grid hashes; the complete 87 MB source file is not retained.
- `LOG.md`: running decisions, checkpoints, corrections and unresolved questions.
- `SCHEMA.md`, `queries.sql`: schema semantics and examples for application integration.
- `validation.json`: actual validation results; internal consistency does not prove every historical assertion.
- `evidence/`: domain notes, source receipts, rebuild helpers, independent review findings and their limitations.

## Rebuild offline

Python 3.9+ with SQLite 3.31+ is sufficient for the database and validation. No app server or application build is involved.

```sh
python3 research/astra/scripts/build.py --fresh
PYTHONDONTWRITEBYTECODE=1 python3 research/astra/scripts/validate.py
PYTHONDONTWRITEBYTECODE=1 python3 research/astra/scripts/report.py
```

`--fresh` commits each packet into `england.next.sqlite`, validates SQLite integrity and references, then atomically replaces the output database. The previous complete database remains available until replacement. Without `--fresh`, the loader commits packet upserts incrementally; use a fresh build for final removal of superseded records. `--packet packets/pr.json` loads one checkpoint. Packet dependencies mean the complete default load is the supported clean rebuild.

The JSON packets are sufficient to reproduce the database. Authoring helpers in `evidence/` record how domain packets were assembled; they are not required for the clean rebuild. Root packets can be recreated with `core_research.py`, `quantitative_research.py`, `late_sites.py`, `import_markets.py`, `import_climate.py` and then `link_app.py`. The two importers use saved extracted inputs unless given `--refresh`; a refresh uses the current fetch date. **Do not overwrite a reviewed research release with refreshed sources without repeating validation and historical review.**

For a source refresh, the market importer uses Beautiful Soup and pyproj. Versions used here are pinned in `requirements-import.txt` and installed locally under `.deps/`. The climate importer uses only the Python standard library. To install dependencies entirely inside this directory:

```sh
python3 -m pip install --target research/astra/.deps --cache-dir research/astra/.cache --no-compile -r research/astra/requirements-import.txt
PYTHONDONTWRITEBYTECODE=1 python3 research/astra/scripts/import_markets.py --refresh
PYTHONDONTWRITEBYTECODE=1 python3 research/astra/scripts/import_climate.py --refresh
```

To restore the SQL dump independently:

```sh
sqlite3 research/astra/restored.sqlite < research/astra/england.sql
sqlite3 research/astra/restored.sqlite 'PRAGMA integrity_check; PRAGMA foreign_key_check;'
```

## Interpret the data correctly

- Historical years have no zero. Astronomical years are generated: historical `-1` becomes `0`, historical `1` remains `1`.
- A date row bounds **one uncertain date**. Duration uses separate start and end date references. `qualifier=by/before/after` is a bound, never an exact onset. Circa and uncertainty must remain visible in any animation.
- Day-level dates use the Julian calendar with January-based year numbering unless a record explicitly says otherwise. Source Lady Day year labels are retained in notes; no silent ten-day conversion is applied. BCE year labels are proleptic indexing, not a prehistoric calendar claim. OWDA uses annual CE summer labels without day conversion.
- Coordinates are WGS84 anchors. The error radius and location method are mandatory for located records. An institutional register point may locate a record or town rather than a battle. Unknown locations are null. App-derived coordinates are separately attributed and explicitly provisional.
- A market grant is not proof of operation. Borough-inferred markets are reconstructed. Fair-only catalogue places are not markets. `market_borough_by_1300` includes dated attestations only when the entire date range is at or before 1300 and exposes source-qualification flags. It is not a census of functioning towns.
- Equal minimum and maximum quantitative values preserve a published point estimate, not zero uncertainty. Population series retain model vintages; 1334 subsidy amounts and Burghal Hidage assessments are not headcounts. A price index is not a nominal commodity price.
- The climate series are **two local half-degree grid cells**, one in England and one in Wales, for 1–1625 CE. They are reconstructed summer moisture indices, not national averages or observed weather.
- Known stops are ordered waypoints; connecting lines are not evidenced routes. Army splits and competing transport interpretations remain separate.
- `app_link` agreements generated by `link_app.py` are identity-only matches of name and locality. They do not validate app history. `relation.corresponds_to_same_app_place` groups overlapping research records without destroying their separate evidence.
- `todo` rows are research workflow, not historical facts. `source.access_status=not_fetched` identifies a precise bibliography not inspected this session; local app sources document the snapshot, not historical truth.

## Reuse and review limits

The IHR Gazetteer is credited to Samantha Letters and the Centre for Metropolitan History. Its published terms permit private research but restrict republication and commercial use. Obtain permission before redistributing this extraction or incorporating it into a commercial application. This restriction is specific and material, not a claim that every source shares the same licence. See [IHR terms](https://archives.history.ac.uk/gazetteer/copyright.html).

NOAA climate data should retain Cook et al. (2015), DOI `10.1126/sciadv.1500561`, archive URL and access date attribution. Other source rights are not homogenized into a blanket licence for this corpus. Source prose has not been copied into the database as substitute articles; numerical and historical assertions are paraphrased or normalized.

The Conwy Township record is derived from information held by the Heneb HER Charitable Trust copyright. Its [research-use terms](https://archwilio.org.uk/her/chi3/report/page.php?watprn=GAT3189) also require written permission for publication or commercial resources. Four Wikipedia pages are used solely as explicitly marked provisional coordinate gazetteers for coastal forts; their history text is not the historical authority.

Independent reviewers checked selected source assertions and the bulk importer. Their reports record findings and limits. The final author resolved the documented residuals and ran the whole-database checks. This is not independent certification of every row, direct consultation of every medieval manuscript, or a production deployment.
