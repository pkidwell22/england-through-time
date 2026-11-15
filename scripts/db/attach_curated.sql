-- Attach the writable curated layer to history.sqlite and create TEMP views that
-- join them. Run from the project root:
--
--   sqlite3 data/db/history.sqlite
--   sqlite> .read scripts/db/attach_curated.sql
--
-- (Python: conn.executescript(open('scripts/db/attach_curated.sql').read()).)
-- Temp views vanish when the session closes; nothing is written to either file.
-- Edit the path below if you run from another directory.

ATTACH DATABASE 'data/db/curated.sqlite' AS cur;

-- Every generated fact with the latest review verdict (if any).
CREATE TEMP VIEW v_fact_reviewed AS
  SELECT f.*, r.id AS review_id, r.verdict, r.reviewer, r.reviewed_at, r.note AS review_note,
         r.correction_status, r.proposed_correction
    FROM main.fact f
    LEFT JOIN cur.v_latest_review r ON r.target_type = 'fact' AND r.target_id = f.fact_id;

-- Curated facts joined to the generated entity they are about (if linked).
CREATE TEMP VIEW v_curated_with_entity AS
  SELECT c.*, e.name AS entity_name, e.evidence AS entity_evidence, e.confidence AS entity_confidence
    FROM cur.curated_fact c
    LEFT JOIN main.v_entity e ON e.entity_type = c.entity_type AND e.entity_id = c.entity_id;

-- Reviews whose target no longer exists in the rebuilt database (stale).
CREATE TEMP VIEW v_stale_reviews AS
  SELECT r.* FROM cur.v_latest_review r
   WHERE (r.target_type = 'fact' AND NOT EXISTS (SELECT 1 FROM main.fact f WHERE f.fact_id = r.target_id))
      OR (r.target_type = 'curated_fact' AND NOT EXISTS (SELECT 1 FROM cur.curated_fact c WHERE CAST(c.id AS TEXT) = r.target_id));
