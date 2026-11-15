# Brief: independent adversarial fact review (glm)

You are an independent adversarial reviewer of the historical facts behind an application: an explorable
3D timelapse of England and Wales, 4000 BCE to 1625 CE (a national map plus detailed sites: London,
Brentford 1016, Barnet 1471, Stonehenge). Read `docs/DATABASE.md` ("For a fact-keeper"), `README.md` and
`docs/RECORD.md` first.

All facts are flattened into `data/db/history.sqlite` (table `fact`: one row per checkable statement with
entity, location, kind, year range, evidence class, confidence, source ids, origin file and JSON path;
plus entity tables, `source`, `citation`, and views `v_unsourced`, `v_conjectural`, `v_low_confidence`,
`v_timeline`). `data/db/factsheet.md` is a readable version. Query it with the sqlite3 CLI or Python.
The database is generated and READ-ONLY for you.

A previous reviewer (GPT-6 Astra) has already reviewed part of it: `research/astra/FACT-REVIEW.md` and
`research/astra/factkeeper-coverage.csv` (which facts it did and did not adjudicate — it gave individual
verdicts to only 43 of the 544 strongest "attested / high confidence" claims). A corrections agent is
applying Astra's accepted findings right now (see `docs/CORRECTIONS.md` if present), so the JSON under
`data/` may be newer than the database snapshot: when you find a problem, check the current JSON file at
the fact's origin path before reporting it, and skip anything already fixed.

Your job: find what Astra missed or got wrong. Do not repeat its findings; challenge them where you
disagree. Assume errors exist and hunt for them:
- wrong or over-precise dates; a feature shown before it existed or after it was destroyed or changed;
  successions that overlap or leave impossible gaps; anachronisms of name, title, institution, building
  type or material;
- wrong places: coordinates off, battles pinned to disputed or unlocated sites, period names with wrong
  date ranges or language;
- sizes, ranks and numbers stated with more confidence than the evidence allows; evidence class or
  confidence set too high (or too low);
- citations that do not support the claim (open the URL and read it), dead links, facts resting only on
  Wikipedia or on nothing;
- contradictions between the national data and the site data, or between a summary and its dated phases;
- omissions that make a true statement misleading.
Verify against the best sources you can reach with shell tools (curl) or any web tool you have: primary
texts in reliable editions, Historic England, English Heritage, Cadw/Coflein, British History Online,
the Battlefields Trust, Pleiades, PASE, university projects, museum pages, peer-reviewed work. Wikipedia
is a lead, never the authority. If you cannot reach a source, say so; never invent a citation, a quotation
or a URL. A finding without a source you actually read must be marked "unverified suspicion".

YOUR ASSIGNED GROUND (work through it systematically, then sample beyond it if time allows):
- The NATIONAL data in full, except battles: every place in data/national/places.json and places-wales.json (foundation and abandonment dates, period names and their date ranges, size ranks by era, coordinates), every polity in polities.json and polities-wales.json (dates, extents, labels), every line feature in lines.json (Roman roads, walls, dykes, the 1536 border), the national eras and events, the woodland and sea-level keyframes with their notes.
- The STONEHENGE site (data/locations/stonehenge/*): the stage chronology, stone settings, the surrounding monuments and their dates, episodes.
- Every "attested-*" + "high" confidence claim in those files that Astra's coverage ledger marks as not adjudicated.

## Where to write (hard rules)
Write ONLY under `research/reviews/glm/`. Do not edit anything else: no JSON under data/, no src/, app/,
scripts/, docs/, no database files. Do not start or stop servers or run builds.
Produce:
1. `findings.json` — an array of objects: { "id", "severity" ("S1" factually wrong and visible | "S2"
   misleading or over-confident | "S3" sourcing defect | "S4" minor), "entity_type", "entity_id",
   "location", "origin_file", "json_path", "app_claim" (what the app says, verbatim where possible),
   "problem", "evidence" [ { "title", "publisher", "url", "accessed", "what_it_says" } ],
   "proposed_correction" (exact new values for exact fields, or null), "confidence" (high|medium|low),
   "status" ("verified-wrong" | "unverified suspicion" | "disagree-with-astra" | "confirmed-correct"),
   "already_in_astra_review" (true|false) }. Valid JSON, written incrementally so partial work survives.
2. `REVIEW.md` — counts by severity and status; every S1 and S2 finding grouped by location with the
   app's claim, what is wrong, the evidence with links and the exact proposed correction; where you
   disagree with Astra and why; systemic patterns; the claims you tried hardest to break and could not;
   what you could not check and why. Be specific and unsparing. Do not pad, and do not report style
   preferences as errors.
