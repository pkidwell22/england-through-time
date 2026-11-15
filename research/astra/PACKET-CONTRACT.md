# Research packet contract

Write only inside `research/astra/`. Other researchers are working concurrently; never replace their files. No app builds or servers. The frozen application baseline is `inputs/app/`; use it for comparisons. Do not treat its claims as verified research. This is a non-Git scratch checkout.

Each researcher owns a JSON packet in `packets/` and a Markdown coverage note in `evidence/`. Top level: `{"sources": [...], "records": [...]}`. IDs must be globally unique: prefix each with your assigned `pr-`, `em-`, `lm-` or `x-`. Records can reference only your own IDs unless agreed. Parent will resolve cross-packet duplicates with relations.

## Sources

Required: `id`, `title`, `publisher`, `url` (actually fetched, otherwise null), `access_status` (`fetched` or `not_fetched`), `checked_on` (`2026-11-14`), `source_type` (`institutional`, `primary`, `scholarly`, `gazetteer`, `lead`, `local_app`). Optional: `author`, `bibliographic_ref`, `notes`, `lead_only` (0/1). Unfetched sources MUST have a precise edition/book/article/section reference and notes saying unverified this session. Search snippets alone are not fetched evidence. Use actual page fetches. Wikipedia/Wikidata are leads or coordinate gazetteers only. Record source locators on each row. Paraphrase; avoid copying passages.

## All fact records

Required: `table`, `id`, `source_id`, `confidence` (`high`, `medium`, `low`), `evidence_class` (one of `attested-standing`, `attested-excavated`, `attested-documentary`, `attested-pictorial`, `reconstructed`, `conjectural`, `tradition`). Optional common fields: `notes`, `locator` (section/paragraph/chapter in source), `checked_on` (defaults to source), `dispute_id`, `additional_sources` (source ids), `start`, `end`.

Dates: `start`/`end` may be historical integer years (no 0), or `{ "year": 1066, "latest_year": 1066, "month": 10, "day": 14, "circa": false, "calendar": "Julian", "precision": "day", "note": "..." }`. `latest_year` gives the upper bound of the SAME uncertain date, not duration. Omitted latest_year = year. Use `start` and `end` for duration. For ranges omit day/month unless secure; default calendar `Julian` means unconverted historical dates, proleptic year labels for BCE, not a claim that Neolithic people used that calendar. Builder stores historical and astronomical years. Never clip an uncertain founding date to a false exact date. End-of-scope is a filter, not a destruction date. Circa must be true for approximate dates. Scope 4000 BCE–1625 CE; out-of-scope births can be omitted with a note.

Dates may also carry `qualifier`: `at`, `circa`, `between`, `by`, `before`, `after`. A `by`/`before` date is a bound or attestation anchor, not the event's exact onset. An aggregate of several events belongs in a start/end duration, not a single uncertain instant.

## Tables and specific fields

- `place`: `name`, `kind`, `country` (`england`, `wales`, `context`), `lat`, `lon`, `uncertainty_m`, `position_method` (`surveyed`, `registered boundary centroid`, `gazetteer`, `inferred`, `unlocated`), `position_source_id`, `position_note`. Unknown sites use null lat/lon/uncertainty and `unlocated`. A named locality is NOT an exact battlefield. App coordinates, if used, must have separate local_app source and inferred/gazetteer method, wide radius, explicit unverified note.
- `place_name`: `place_id`, `name`, `language`, `name_type` (historical/modern/traditional), start/end = attested use bounds, not invented name lifespans.
- `place_phase`: `place_id`, `phase_type`, `description`, optional `population_min`, `population_max`, `rank`, `estimate_basis`.
- `person`: `name`, `role`, optional `description`; start/end = birth/death, omit unknown.
- `office`: `name`, `polity_id`, optional `place_id`, `office_type`.
- `office_tenure`: `person_id`, `office_id`, `tenure_note`; start/end = tenure.
- `polity`: `name`, `kind`, `description`.
- `polity_period`: `polity_id`, `description`; start/end = existence/attested phase.
- `ruler_of`: `person_id`, `polity_id`, `title`, `tenure_note`; start/end = rule, disputed chronology in separate rows.
- `event`: `name`, `event_type`, `place_id` (null allowed), `description`, `outcome`, `consequences`, `campaign_id` (null allowed); start = bounded event date, end = end for duration.
- `battle`: `event_id`, `site_security` (`secure`, `approximate`, `disputed`, `unknown`), `site_note`, `outcome`, `primary_sources` (precise titles/sections; say not consulted when so).
- `battle_party`: `event_id`, `side`, `polity_id`, `commander_id`, `description` (each reference nullable).
- `battle_number`: `event_id`, `side`, `quantity_type` (`strength`, `casualties`, `killed`, `captured`), `min_value`, `max_value`, `unit`, `number_basis`, `reliability` (`high`, `medium`, `low`, `unknown`). Only source-supported figures; do not fill unknown with zero.
- `campaign`: `name`, `description`, `movement_type`.
- `waypoint`: `campaign_id`, `sequence`, `place_id`, `event_id` (optional), `action`, `path_certainty` (`attested_stop`, `inferred_link`, `unlocated`), `interpolation_note`. Do not imply a known route between known stops.
- `structure`: `name`, `place_id`, `structure_type`, `description`.
- `structure_phase`: `structure_id`, `phase_type`, `description`, optional `material`, `length_m`, `width_m`, `height_m`, `builder_id`, `event_id`; each numeric dimension must be supported by this row's source.
- `route`: `name`, `route_type`, `description`, `geometry_status`.
- `route_node`: `route_id`, `sequence`, `place_id`, `node_note`.
- `timeline_series`: `name`, `measure`, `unit`, `geographic_scope`, `methodology`.
- `timeline_value`: `series_id`, `value_min`, `value_max`, `value_text`, `basis`, optional `place_id`; start = observation date, no false precision.
- `dispute`: `topic`, `description`, `status` (`unresolved`, `scholarly_disagreement`, `chronological_uncertainty`, `interpretive`).
- `claim`: `subject_id`, `predicate`, `value_text`; common dispute_id connects competing claims.
- `relation`: `subject_id`, `predicate`, `object_id`, `description`.
- `app_link`: `entity_id`, `app_file` (original relative path), `app_id`, `json_pointer`, `comparison_type` (`correction`, `uncertainty`, `refinement`, `omission`, `agreement`), `app_claim`, `research_claim`, `importance` (1 highest–5 lowest). Never manufacture disagreements to meet a quota. Include at least 15 substantive comparisons from your domain if evidence supports them, including the source's qualification. Do not repeat the same discrepancy at multiple pointers to pad counts.
- `todo`: `topic`, `task`, `priority` (1 highest–5 lowest), `status` (`open`, `blocked`, `done`), `reason`, `lead_url`, optional `entity_id`. This is a workflow record; metadata still required, source may be a research-method source.

Each row has one evidential source and may add citations; use separate claims for disagreements. Identity rows do not prove everything ever said about their subjects. Save incremental packets while researching. Do not write the main database yourself: parent builds and commits packets as they arrive. Report unverifiable facts and coverage gaps honestly. More verified breadth is useful; copied unsourced app data is not.
