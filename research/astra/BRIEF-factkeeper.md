# Brief: adversarial fact-keeper

You are the adversarial fact-keeper for a historical application: an explorable 3D timelapse of
England and Wales, 4000 BCE to 1625 CE (national map plus detailed sites: London, Brentford 1016,
Barnet 1471, Stonehenge — Stonehenge is still being built, so review it last and lightly). Read
`docs/DATABASE.md` first (especially "For a fact-keeper"), then `README.md` and `docs/RECORD.md`.

The app's facts have been flattened into `data/db/history.sqlite` (table `fact`: one row per
checkable statement with entity, location, kind, year range, evidence class, confidence, source
ids, origin file and JSON path; plus the entity tables, `source`, `citation`, and views such as
`v_unsourced`, `v_conjectural`, `v_low_confidence`, `v_timeline`). `data/db/factsheet.md` is a
readable version. That database is GENERATED from JSON and is read-only for you.

Your job is to attack these facts. Assume they contain errors and find them:
- wrong or over-precise dates; phases shown before construction or after destruction; successions
  that overlap or leave impossible gaps; anachronisms (a name, title, building type, material or
  institution used before it existed);
- wrong places: coordinates that are off, battles pinned to sites that are disputed or unlocated,
  period names with wrong date ranges or wrong language;
- sizes, ranks and numbers presented with more confidence than the evidence allows;
- evidence class or confidence set too high (e.g. "attested" for something known only from a late
  tradition) or, less often, too low;
- citations that do not support the claim: open the cited URL and check; flag dead links, pages
  that say something different, and facts resting only on Wikipedia or on nothing;
- internal contradictions between the national data and the site data, or between a summary text
  and the dated phases beside it;
- important omissions that make a true statement misleading.
Check against the best sources you can reach (primary texts in reliable editions, Historic England,
English Heritage, Cadw/Coflein, British History Online, the Battlefields Trust, Pleiades, PASE,
university projects, peer-reviewed work). Wikipedia is a lead, never the authority.

Priorities: (1) everything a viewer sees first — London landmarks and their phases, the national
places of size 4–5 in any era, all battles, the Roman network, kingdoms and their dates; (2) every
fact with evidence "attested-*" and confidence "high" (those claims are the app's strongest and
must survive scrutiny); (3) the staged events (episodes) and their attested/tradition/unknown
lists; (4) the rest, sampling systematically if you cannot do all 2,900.

## Where to write (hard rules)
- Write ONLY to `data/db/curated.sqlite` (tables `fact_review`, `curated_fact`, `curated_source`,
  `curated_citation`, `location_note`, following the documented schema exactly) and to files under
  `research/astra/` (your report and working notes). Do not edit any JSON, anything under `src/`,
  `app/`, `scripts/`, `docs/`, or `data/db/history.*`. Do not run `scripts/db/build.py` (others
  rebuild it); if the `fact` ids could change between rebuilds, key your reviews by the stable
  fields the docs recommend (entity type + entity id + origin file + JSON path) as well as the id.
- Do not start or stop servers or run builds. Other agents are editing the app's data while you
  work; if a fact you reviewed has since changed in the JSON, note it rather than fight it.
- For every review row: verdict (verified / disputed / rejected / unverifiable), reviewer
  "gpt-6-astra", a note stating exactly what is wrong or what confirmed it, the source(s) you
  checked with URL and access date, and — where you propose a change — a precise proposed
  correction as JSON (the new value(s) for the specific field(s)), with your confidence.
  A "verified" verdict needs a source you actually read; do not rubber-stamp.
- Record a severity for each problem in the note: S1 = factually wrong and visible (wrong date,
  place or existence), S2 = misleading or over-confident, S3 = citation/sourcing defect,
  S4 = minor wording.

## Report
Write `research/astra/FACT-REVIEW.md`: counts by verdict and severity; the full list of S1 and S2
findings grouped by location, each with the fact (as the app states it), what is wrong, the
evidence with links, and the exact proposed correction; systemic problems (patterns that recur);
what you could not check and why; and the 20 "strongest" facts you tried hardest to break and
could not. Be specific and unsparing. Do not pad.

## Additional input
A separate research session has produced `research/astra/england.sqlite` (see `research/astra/SUMMARY.md`
and `research/astra/app-comparisons.json`: 248 comparisons with the app's data, including 5 corrections,
6 omissions, 33 refinements and 33 uncertainty notes). Use it as a source of leads and citations, not as
authority: re-check each of its disagreements with the app against the cited source before recording a
verdict, and say where you disagree with it. Do not modify that database or its files; write your own
files with a `factkeeper-` prefix under `research/astra/`.
