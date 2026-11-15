-- =============================================================================
-- curated.sqlite: the fact-keeper's WRITABLE layer.
--
-- Created once by scripts/db/init_curated.py and NEVER overwritten by build.py.
-- history.sqlite is regenerated from the JSON at any time; everything a person
-- or agent records about the facts lives here, so it survives rebuilds.
--
-- Links to history.sqlite are by TEXT id (no cross-database foreign keys are
-- possible): fact_id / entity_id values come from history.sqlite's fact and
-- entity tables. If an id disappears after a rebuild (the JSON changed), the
-- review becomes "stale"; list_proposed_corrections.py flags those.
--
-- YEARS: historical signed years exactly as in the JSON (negative = BCE, never
-- 0), the same convention as history.sqlite. Convert with
--   astro = CASE WHEN y < 0 THEN y + 1 ELSE y END   for arithmetic.
-- All statements are idempotent (CREATE ... IF NOT EXISTS) so re-running
-- init_curated.py upgrades an existing file without touching its rows.
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS curated_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- A statement the fact-keeper wants to record that is not (yet) in the app data:
-- a new fact, a candidate landmark, a missing date. May be linked to an entity.
CREATE TABLE IF NOT EXISTS curated_fact (
  id          INTEGER PRIMARY KEY,
  entity_type TEXT,                      -- optional: landmark|zone|episode|event|place|line|polity|stone|location (as in history.sqlite)
  entity_id   TEXT,                      -- optional: history.sqlite entity id, e.g. 'london/globe'
  location_id TEXT,                      -- optional: location the statement is about
  kind        TEXT,                      -- free text: built, destroyed, founded, renamed, located_at, size, ...
  statement   TEXT NOT NULL,
  year_from   INTEGER CHECK (year_from IS NULL OR year_from <> 0),
  year_to     INTEGER CHECK (year_to   IS NULL OR year_to   <> 0),
  astro_from  INTEGER GENERATED ALWAYS AS (CASE WHEN year_from < 0 THEN year_from + 1 ELSE year_from END) VIRTUAL,
  astro_to    INTEGER GENERATED ALWAYS AS (CASE WHEN year_to   < 0 THEN year_to   + 1 ELSE year_to   END) VIRTUAL,
  lat         REAL CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lon         REAL CHECK (lon IS NULL OR lon BETWEEN -180 AND 180),
  status      TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified','verified','disputed','rejected')),
  confidence  TEXT CHECK (confidence IS NULL OR confidence IN ('high','medium','low')),
  note        TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_cfact_entity ON curated_fact(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_cfact_location ON curated_fact(location_id, astro_from);
CREATE INDEX IF NOT EXISTS idx_cfact_status ON curated_fact(status);

-- A source the fact-keeper found that is not in the app's sources*.json files.
CREATE TABLE IF NOT EXISTS curated_source (
  id         INTEGER PRIMARY KEY,
  title      TEXT NOT NULL,
  publisher  TEXT,
  url        TEXT,
  accessed   TEXT,                       -- ISO date the source was last checked
  note       TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Links a curated fact OR a review to a source: either a curated_source row or
-- an existing history.sqlite source id. Exactly one of each pair must be set.
CREATE TABLE IF NOT EXISTS curated_citation (
  id                INTEGER PRIMARY KEY,
  curated_fact_id   INTEGER REFERENCES curated_fact(id) ON DELETE CASCADE,
  review_id         INTEGER REFERENCES fact_review(id) ON DELETE CASCADE,
  curated_source_id INTEGER REFERENCES curated_source(id),
  source_id         TEXT,                -- history.sqlite source.id
  locator           TEXT,                -- page, section, tablet number, URL fragment
  quote             TEXT,                -- short supporting wording (respect copyright: keep it brief)
  CHECK ((curated_fact_id IS NULL) <> (review_id IS NULL)),
  CHECK ((curated_source_id IS NULL) <> (source_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_ccite_fact ON curated_citation(curated_fact_id);
CREATE INDEX IF NOT EXISTS idx_ccite_review ON curated_citation(review_id);

-- A verdict on one generated fact (history.sqlite fact.fact_id) or one curated fact.
-- Append-only by convention: a new review supersedes an older one (latest wins).
CREATE TABLE IF NOT EXISTS fact_review (
  id          INTEGER PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('fact','curated_fact')),
  target_id   TEXT NOT NULL,             -- fact.fact_id, or curated_fact.id as text
  verdict     TEXT NOT NULL CHECK (verdict IN ('confirmed','corrected','disputed','unverifiable','rejected')),
  reviewer    TEXT NOT NULL,             -- person or agent name
  reviewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  note        TEXT,
  -- Proposed change to the app data, as JSON. Suggested shape:
  --   {"file":"locations/london/landmarks.json","path":"$[12].phases[1].to","field":"year_to",
  --    "old":1561,"new":1562,"rationale":"..."}
  proposed_correction TEXT CHECK (proposed_correction IS NULL OR json_valid(proposed_correction)),
  -- Lifecycle of the proposal. The JSON files are what the app reads, so an
  -- 'accepted' correction is only real once someone applies it there.
  correction_status TEXT CHECK (correction_status IS NULL OR correction_status IN ('proposed','accepted','declined','applied')),
  applied_at  TEXT,
  applied_note TEXT                      -- e.g. commit or who edited which file
);
CREATE INDEX IF NOT EXISTS idx_review_target ON fact_review(target_type, target_id, reviewed_at);
CREATE INDEX IF NOT EXISTS idx_review_correction ON fact_review(correction_status);

-- Free-form notes about a location: caveats, open questions, to-dos.
CREATE TABLE IF NOT EXISTS location_note (
  id          INTEGER PRIMARY KEY,
  location_id TEXT NOT NULL,             -- history.sqlite location.id
  kind        TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note','caveat','question','todo','scope')),
  note        TEXT NOT NULL,
  author      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  resolved    INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_lnote_location ON location_note(location_id);

-- Latest review per target (usable inside curated.sqlite on its own).
CREATE VIEW IF NOT EXISTS v_latest_review AS
  SELECT r.* FROM fact_review r
   WHERE r.id = (SELECT r2.id FROM fact_review r2
                  WHERE r2.target_type = r.target_type AND r2.target_id = r.target_id
                  ORDER BY r2.reviewed_at DESC, r2.id DESC LIMIT 1);

-- Corrections someone accepted that nobody has applied to the JSON yet.
CREATE VIEW IF NOT EXISTS v_unapplied_corrections AS
  SELECT * FROM v_latest_review
   WHERE correction_status = 'accepted' AND applied_at IS NULL AND proposed_correction IS NOT NULL;

INSERT OR IGNORE INTO curated_meta VALUES ('schema_version', '1');
