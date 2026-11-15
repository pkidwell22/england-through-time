-- Five example queries across history.sqlite (main) and curated.sqlite (cur).
-- First:  sqlite3 data/db/history.sqlite  then  .read scripts/db/attach_curated.sql
-- Parameters are written :name; the check script binds defaults from "@params".

-- X1: Facts nobody has looked at yet, most-evidenced first: the review backlog.
-- @params loc=london
SELECT fact_id, kind, value_text, evidence, confidence, n_sources
  FROM v_fact_reviewed
 WHERE location_id = :loc AND verdict IS NULL AND year_from IS NOT NULL
 ORDER BY n_sources DESC, astro_from
 LIMIT 20;

-- X2: Latest verdict per generated fact, counted by verdict (NULL = unreviewed), per location.
-- @params
SELECT location_id, COALESCE(verdict,'(unreviewed)') AS verdict, COUNT(*) AS n
  FROM v_fact_reviewed GROUP BY 1, 2 ORDER BY 1, 3 DESC;

-- X3: Disputed or corrected facts with the app's current value next to the proposed change.
-- @params
SELECT fact_id, kind, value_text, year_from, year_to, verdict, reviewer, review_note, proposed_correction
  FROM v_fact_reviewed WHERE verdict IN ('disputed','corrected') ORDER BY reviewed_at DESC;

-- X4: Curated (new) facts that overlap a year range at a location, alongside the generated facts for the same span.
-- @params loc=london from_year=1530 to_year=1545
SELECT 'curated' AS origin, c.id AS id, c.kind, c.statement AS text, c.year_from, c.year_to, c.status
  FROM cur.curated_fact c
 WHERE c.location_id = :loc AND c.astro_from <= CASE WHEN :to_year < 0 THEN :to_year + 1 ELSE :to_year END
   AND COALESCE(c.astro_to, c.astro_from) >= CASE WHEN :from_year < 0 THEN :from_year + 1 ELSE :from_year END
UNION ALL
SELECT 'generated', f.fact_id, f.kind, f.value_text, f.year_from, f.year_to, COALESCE(f.confidence,'')
  FROM main.fact f
 WHERE f.location_id = :loc AND f.astro_from <= CASE WHEN :to_year < 0 THEN :to_year + 1 ELSE :to_year END
   AND COALESCE(f.astro_to, f.astro_from) >= CASE WHEN :from_year < 0 THEN :from_year + 1 ELSE :from_year END
 ORDER BY 1, 5;

-- X5: Accepted corrections still waiting to be applied to the JSON, with where to apply them.
-- @params
SELECT r.id AS review_id, r.target_id, f.origin_file, f.origin_path, f.value_text AS current_value, r.proposed_correction, r.reviewer
  FROM cur.v_unapplied_corrections r
  LEFT JOIN main.fact f ON r.target_type = 'fact' AND f.fact_id = r.target_id;
