# The history database

All the facts, dates and sources in London Through Time are available as a SQLite database:

- `data/db/history.sqlite` is **generated and read-only**. It mirrors the JSON under `data/`.
- `data/db/history.sql` is the same thing as a plain-text SQL dump (diffable, loadable without SQLite tooling).
- `data/db/curated.sqlite` is the **writable** layer for a fact-keeper (reviews, new facts, notes). `build.py` never touches it.
- `data/db/factsheet.md` / `factsheet.csv` are plain-text fact sheets generated from the database.

## What it is and is not

It is a queryable mirror: every landmark, phase, place, road, kingdom, episode, source and citation, plus one row per checkable statement (the `fact` table).

It is **not** the master copy. The app reads the JSON; the JSON is the source of truth. Editing `history.sqlite` changes nothing in the app and is lost at the next rebuild. A correction only becomes real when it is applied to the JSON and the database is rebuilt (see "For a fact-keeper").

Other people and agents edit the JSON continuously. A build is a snapshot; some files may have been half-written or missing (for example `data/locations/stonehenge/` was still being written when this was first built: its `landmarks.json` was empty and its stone sources file did not exist). Just re-run the build. Anything it could not load is in the `load_issue` table.

## Rebuild

```
python3 scripts/db/build.py                 # -> data/db/history.sqlite + history.sql + history-build-report.txt
python3 scripts/db/build.py --only london   # one location -> data/db/history-only-london.sqlite (never overwrites the full DB)
python3 scripts/db/build.py --out /tmp/h.sqlite
python3 scripts/db/build.py --strict        # exit 1 if any load_issue has severity 'error'
python3 tests/db_check.py                   # builds to a temp dir and checks counts, FKs, years, views, queries, known facts
python3 scripts/db/export_factsheet.py      # -> data/db/factsheet.md and factsheet.csv
```

Standard library Python 3 only. The build writes to a temporary file and renames it atomically, so an open copy is never half-replaced. It takes about a second.

The build prints: files found/skipped/failed to parse, row counts per table, issues by category, unsourced entities, dangling source ids, foreign-key and integrity checks. Rows that break a constraint are not silently dropped: they go into `load_issue` with the file, entity, reason and the rejected row as JSON. Unknown `kind` values (place, line, polity) and inverted year ranges load anyway and are flagged as warnings.

## Opening it

```
sqlite3 data/db/history.sqlite
sqlite> .headers on
sqlite> .mode column
sqlite> SELECT * FROM v_timeline WHERE location_id='london' ORDER BY astro_from LIMIT 10;
```

- DB Browser for SQLite: File > Open Database (open read-only).
- DuckDB: `duckdb` then `ATTACH 'data/db/history.sqlite' AS h (TYPE sqlite, READ_ONLY); SELECT * FROM h.landmark LIMIT 5;`
- Python: `sqlite3.connect("file:data/db/history.sqlite?mode=ro", uri=True)`
- No SQLite at all: read `data/db/history.sql`, or `factsheet.csv` in a spreadsheet.

SQLite 3.31 or newer is needed (generated columns).

## Year convention

JSON years are signed historical years: negative = BCE, positive = CE, **no year 0** (1 BCE = -1, 1 CE = 1). The database keeps them exactly (`year_from`, `year_to`, `year`, ...) with `CHECK (... <> 0)`.

Next to each there is a generated `astro_*` column holding the astronomical year (1 BCE = 0, 2 BCE = -1, ...): `astro = CASE WHEN year < 0 THEN year + 1 ELSE year END`. Use `astro_*` for subtraction and range tests (1 CE minus 1 BCE is 1 year, not 2). Sorting works on either.

Label: `CASE WHEN y < 0 THEN -y || ' BCE' ELSE y || ' CE' END` (also the `year_label` view, and `v_fact_readable`).

A `NULL` in a `*_to` column means "still going at the end of the timeline (1625)". A phase is intact from `year_built` (or `year_from`) to `year_to` inclusive and under construction from `year_from` to `year_built`.

Ids are namespaced `<location>/<local id>` (`london/globe`, `england-wales/london`) so the same local id can appear in several locations. Every entity and phase row has `origin_file` (relative to `data/`) and a JSONPath-like `origin_path` (for example `$[66].phases[0].to`) pointing at the exact JSON it came from.

## Schema overview

Full comments are in `scripts/db/schema.sql`.

```
location ──< era
   │    ──< event
   │    ──< landmark ──< landmark_phase          (model_kind, model_params JSON)
   │             └────< landmark_path_point
   │    ──< zone
   │    ──< episode ──< episode_fact             (kind: attested | tradition | unknown)
   │    ──< stone                                (Stonehenge, Petrie numbering)
   │    ──< place ──< place_phase                (size 0..5)
   │             └──< place_name                 (period names)
   │    ──< line_feature ──< line_point
   │    ──< polity ──< polity_point              (indicative extent ring)
   │    ──< woodland_keyframe, sea_level_keyframe
   │
source <──── citation >──── (any entity: entity_type + entity_id)
dangling_citation   (cited source ids that no sources file defines)
asset               (textures, sky, models, with provenance)
fact                (one row per checkable statement, generated from all of the above)
load_issue, build_meta
```

Views: `v_timeline` (every dated thing, chronological), `year_label`, `v_entity`, `v_unsourced`, `v_dangling`, `v_low_confidence`, `v_conjectural`, `v_sources_by_publisher`, `v_changes_by_century`, `v_fact` (the definition of `fact`), `v_fact_readable`.

The enumerations are CHECK constrained: evidence (`attested-standing`, `attested-excavated`, `attested-documentary`, `attested-pictorial`, `reconstructed`, `conjectural`), confidence (`high`, `medium`, `low`), phase end kinds (`handover`, `replaced`, `demolished`, `burned`, `ruin`, `decay`), tier, country, zone decline kind, episode fact kind.

## The fact table

`fact` flattens the data into one row per checkable statement:

| column | meaning |
|---|---|
| `fact_id` | stable id such as `landmark:london/globe:ended:0` (entity type, entity id, kind, position) |
| `entity_type`, `entity_id`, `entity_name`, `location_id` | what it is about |
| `kind` | `located_at`, `phase`, `begun`, `completed`, `ended`, `gone_by`, `size`, `named`, `existed`, `event`, `occurred`, `episode_attested/tradition/unknown`, `grew`, `declined`, `era`, `state_1625`, `woodland_cover`, `sea_level` |
| `year_from`, `year_to` (+ `astro_*`) | the date or range; `NULL` year_from = undated (a position) |
| `value_text`, `detail` | the statement and its context |
| `lat`, `lon` | for position facts |
| `evidence`, `confidence`, `source_ids`, `n_sources` | of the owning entity (sources are attached to entities, not to individual dates) |
| `origin_file`, `origin_path` | where to edit it |

Caveats: `n_sources = 0` means no *resolvable* citation. Facts whose entity cites ids that exist in no sources file (all the Stonehenge stones at first build) are also listed in `dangling_citation` / `v_dangling`, so check both. Eras and events carry no evidence class (the data has none for them). The id is stable as long as the JSON id and array position do not change; if someone reorders an array, `fact_id` positions shift.

## Example queries

`scripts/db/queries.sql` has 30 worked queries, each with a comment; `tests/db_check.py` runs all of them. A few, with real output from the first build:

**What existed in year Y at location L** (Q1, the `v_existing_at` pattern: convert the year once, then test ranges):

```sql
WITH p(y) AS (SELECT CASE WHEN :year < 0 THEN :year + 1 ELSE :year END)
SELECT t.entity_type, t.name, t.year_from, t.year_to
  FROM v_timeline t, p
 WHERE t.location_id = :loc AND t.astro_from <= p.y AND (t.astro_to IS NULL OR t.astro_to >= p.y);
-- year=1300, loc=london -> 50 rows, e.g. landmark_phase | Austin Friars: Friary | 1253 | 1354
```

**Landmark phases that ended in fire** (Q3, since 1000):

```
name                                 label                                burned_in
St Paul's Cathedral                  Late Saxon cathedral (form unknown)  1087
Late Saxon and Norman timber bridge  Timber bridge                        1135
Houses on London Bridge              First houses                         1212
St Mary Overie (St Saviour's)        Norman priory church                 1212
The Globe                            First Globe                          1613
Banqueting House, Whitehall          Jacobean banqueting house            1619
```

**Period names of a place** (Q14):

```
modern  period_name  year_from  year_to
London  Londinium    47         410
London  Lundenwic    600        885
London  Lundenburh   886        1065
```

**Every dated claim about one entity** (Q17, `entity=london/globe`):

```
fact_id                        kind   value_text            year_from  year_to  origin_path
landmark:london/globe:phase:0  phase  First Globe           1599       1613     $[66].phases[0]
landmark:london/globe:begun:0  begun  First Globe           1599                $[66].phases[0].from
landmark:london/globe:ended:0  ended  First Globe (burned)  1613                $[66].phases[0].to
landmark:london/globe:phase:1  phase  Second Globe          1614                $[66].phases[1]
landmark:london/globe:begun:1  begun  Second Globe          1614                $[66].phases[1].from
```

**Claims with no source** (Q18, first build): 127 Stonehenge stone states (their source ids are undefined), then 113 national place phases, 113 place sizes, 50 place positions, 15 events.

Others: places among the largest in Britain by century (Q4), Roman roads and places on them (Q5), what changed 1530-1545 (Q6), conjectural features with uncertainty notes (Q7), sources cited more than five times (Q8), entities resting on one source (Q9), landmarks under construction in a year (Q10), longest-lived phases (Q11), evidence class by era (Q12), features overlapping an event (Q13), interpolated woodland cover (Q22).

## For a fact-keeper

A separate person or agent can use the database as a fact sheet and record findings without ever touching the JSON or the generated database.

### Reading facts

- Read: `data/db/factsheet.md` (per location, chronological, with UNSOURCED / SOURCE-ID-UNDEFINED / CONJECTURAL / LOW-CONF flags) or `factsheet.csv`. Regenerate with `python3 scripts/db/export_factsheet.py`.
- Query: `SELECT * FROM fact WHERE entity_id = 'london/globe' AND year_from IS NOT NULL ORDER BY astro_from;`
- Backlog: every claim with no source: `SELECT * FROM fact WHERE n_sources = 0;` and `SELECT * FROM v_dangling;`
- Doubtful ground: `v_conjectural`, `v_low_confidence` (each entity's `uncertainty` text says what is not known).
- Years: historical signed, no year 0; use `astro_*` for arithmetic (see "Year convention"). Record new facts in the same convention.

### Recording work: curated.sqlite

Create it once (safe to re-run; it never deletes rows):

```
python3 scripts/db/init_curated.py
```

Tables (see `scripts/db/schema_curated.sql`): `curated_fact` (new statements, with status `unverified|verified|disputed|rejected`, optional link to an entity/location, years, lat/lon, confidence, note), `curated_source`, `curated_citation` (link a curated fact or a review to a `curated_source` or to an existing generated `source.id`), `fact_review` (verdict on a generated or curated fact), `location_note`. Views: `v_latest_review`, `v_unapplied_corrections`.

```sql
-- record a review of a generated fact (target_id is fact.fact_id)
INSERT INTO fact_review(target_type, target_id, verdict, reviewer, note, proposed_correction, correction_status)
VALUES ('fact', 'landmark:london/globe:ended:0', 'corrected', 'alice', 'Chronicle gives 29 June 1613',
        '{"file":"locations/london/landmarks.json","path":"$[66].phases[0].to","old":1613,"new":"<corrected year>","rationale":"..."}',
        'proposed');

-- add a new fact
INSERT INTO curated_fact(entity_type, entity_id, location_id, kind, statement, year_from, confidence, status, created_by)
VALUES ('landmark', 'london/globe', 'london', 'built', 'Second Globe opened on the old foundations', 1614, 'medium', 'unverified', 'alice');
```

Verdicts: `confirmed`, `corrected`, `disputed`, `unverifiable`, `rejected`. Reviews are append-only by convention: the latest review per target wins (`v_latest_review`). Correction status moves `proposed` -> `accepted` (someone with authority agrees) -> `applied` (written into the JSON); `declined` closes it.

### Querying both databases together

```
sqlite3 data/db/history.sqlite
sqlite> .read scripts/db/attach_curated.sql
```

This attaches `curated.sqlite` as `cur` and creates temp views: `v_fact_reviewed` (every generated fact with its latest verdict), `v_curated_with_entity`, `v_stale_reviews` (reviews whose fact_id vanished after a rebuild). `scripts/db/cross_queries.sql` has five examples: the unreviewed backlog for a location, verdict counts per location, disputed/corrected facts with proposals, curated and generated facts overlapping a year range side by side, and accepted corrections waiting to be applied (with the file and path to edit).

Cross-database links are plain text ids (SQLite cannot enforce foreign keys across files). If the JSON changes so that a `fact_id` disappears, the review shows up in `v_stale_reviews` and `list_proposed_corrections.py` marks it STALE.

### How corrections get back into the app

They are proposals. The app reads the JSON, so:

1. The fact-keeper records a review with a `proposed_correction` (JSON: `file`, `path` or `field`, `old`, `new`, `rationale`).
2. Someone accepts it (`UPDATE fact_review SET correction_status='accepted' WHERE id=7;`).
3. `python3 scripts/db/list_proposed_corrections.py` prints accepted-but-unapplied corrections with the current value and the `origin_file` / `origin_path` to edit (`--all` also shows merely proposed ones).
4. A person or agent edits the JSON file, then runs `python3 scripts/db/build.py` (and `tests/db_check.py`).
5. `python3 scripts/db/list_proposed_corrections.py --mark-applied 7 --note "edited landmarks.json"` closes it.

No script edits the JSON automatically.

## Could the database become the master copy?

Options for the owner, not a recommendation. Today the flow is JSON -> app and JSON -> database.

**A. Keep JSON as master (current).** Diffable in git, reviewable in pull requests, schema in TypeScript, nothing to run in production. Costs: SQL users get a mirror, edits by non-developers mean editing JSON, and cross-file consistency (sources, ids) is only checked by builds and tests.

**B. Database as master, JSON exported from it.** An export script would write the exact JSON shapes the app expects (the schema already holds nearly everything; layout-only fields such as `config_json` and `model_params` round-trip as JSON text). Gains: constraints enforced at write time, easy bulk edits and reviews, one place for sources and reviews. Costs: the export must be exactly faithful (field order, optional fields, the national/site file splits), JSON stops being reviewable by diff unless exports are committed, the app build gains a step, and every agent now needs write access to the database and a merge process (SQLite is a single-writer file; concurrent editors need a server or a queue). The curated tables would merge into the main schema.

**C. Database as master, app loads from an API.** A small service reads the database and serves the same shapes the loaders in `src/` consume. Gains: live edits, per-viewer queries (what existed in year Y). Costs: hosting, caching and a runtime dependency for a currently static app, authentication for writers, and rework of the data loaders and tests.

**D. Hybrid (closest to today).** Keep JSON for geometry-heavy, renderer-facing data (paths, polygons, model parameters) and make the database master only for facts, dates and sources, exporting just those fields back into the JSON. Gains: the fact-keeper's edits flow to the app. Costs: a merge/export that must respect fields it does not own, and two sources of truth that can drift.

Whichever is chosen, the id scheme (`location/local_id`), the `origin_file`/`origin_path` columns and the stable `fact_id`s are what a round trip would hang on, and `tests/db_check.py` is the natural place to add an export-then-reload equality test.
