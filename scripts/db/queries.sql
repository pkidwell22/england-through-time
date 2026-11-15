-- =============================================================================
-- Worked example queries for history.sqlite.
-- Run one in the sqlite3 shell with parameters, e.g.
--   sqlite> .parameter set :year 1300
--   sqlite> .parameter set :loc "'london'"
--   sqlite> <paste query>
-- or edit the literal. tests/db_check.py executes every query below, binding the
-- defaults on each "-- @params" line. Years are HISTORICAL signed years (negative
-- = BCE, never 0); astro_* columns are the continuous astronomical equivalents.
-- Interval test pattern: a thing with astro range [a, b] (b NULL = still going at
-- the end of the timeline) existed in astro year y when a <= y AND (b IS NULL OR b >= y).
-- =============================================================================

-- Q1: v_existing_at -- WHAT EXISTED IN YEAR :year AT LOCATION :loc.
-- The reusable pattern: convert the historical year to astronomical once (CTE p),
-- then test every dated range in v_timeline. Ruins that linger until gone_by are
-- not included (see Q2 for the landmark-level variant that includes them).
-- @params year=1300 loc=london
WITH p(y) AS (SELECT CASE WHEN :year < 0 THEN :year + 1 ELSE :year END)
SELECT t.entity_type, t.name, t.year_from, t.year_to, t.evidence, t.confidence
  FROM v_timeline t, p
 WHERE t.location_id = :loc AND t.astro_from <= p.y AND (t.astro_to IS NULL OR t.astro_to >= p.y)
 ORDER BY t.entity_type, t.name;

-- Q2: Everything STANDING in London in 1300 (landmark phases only), including
-- ruins that have not yet gone, and flagging those still being built.
-- @params year=1300 loc=london
WITH p(y) AS (SELECT CASE WHEN :year < 0 THEN :year + 1 ELSE :year END)
SELECT l.name, ph.label, ph.year_from, ph.year_built, ph.year_to, ph.end_kind,
       CASE WHEN ph.astro_built IS NOT NULL AND ph.astro_built > p.y THEN 'under construction'
            WHEN ph.astro_to IS NOT NULL AND ph.astro_to < p.y THEN 'ruin (until ' || ph.gone_by || ')'
            ELSE 'standing' END AS state
  FROM landmark_phase ph JOIN landmark l ON l.id = ph.landmark_id, p
 WHERE l.location_id = :loc AND ph.astro_from <= p.y
   AND (ph.astro_to IS NULL OR ph.astro_to >= p.y OR (ph.astro_gone_by IS NOT NULL AND ph.astro_gone_by >= p.y))
 ORDER BY l.name;

-- Q3: All landmark phases that ended in fire (end kind 'burned').
-- @params
SELECT l.location_id, l.name, ph.label, ph.year_to AS burned_in, ph.date_note
  FROM landmark_phase ph JOIN landmark l ON l.id = ph.landmark_id
 WHERE ph.end_kind = 'burned' ORDER BY ph.astro_to;

-- Q4: Places that were among the largest in Britain (size >= 4) at the start of each
-- century: the century-start year is sampled, listing how many and which.
-- @params
WITH RECURSIVE c(y) AS (SELECT -3900 UNION ALL SELECT y + 100 FROM c WHERE y < 1600)
SELECT c.y + 0 AS astro_year_sampled, COUNT(DISTINCT pl.id) AS n_large_places,
       group_concat(DISTINCT pl.name) AS places
  FROM c JOIN place_phase ph ON ph.size >= 4 AND ph.astro_from <= c.y AND (ph.astro_to IS NULL OR ph.astro_to >= c.y)
         JOIN place pl ON pl.id = ph.place_id
 GROUP BY c.y HAVING n_large_places > 0 ORDER BY c.y;

-- Q5: Roman roads and the places on them: any place within about 2 km (0.02 degrees of
-- latitude, 0.03 of longitude) of a road vertex, grouped per road. Approximate by design.
-- @params
SELECT lf.name AS road, COUNT(DISTINCT pl.id) AS n_places, group_concat(DISTINCT pl.name) AS places
  FROM line_feature lf JOIN line_point lp ON lp.line_id = lf.id
  JOIN place pl ON ABS(pl.lat - lp.lat) < 0.02 AND ABS(pl.lon - lp.lon) < 0.03
 WHERE lf.kind = 'roman-road'
 GROUP BY lf.id ORDER BY n_places DESC, road;

-- Q6: What changed between 1530 and 1545 (the Dissolution): everything that starts or ends in the range.
-- @params from_year=1530 to_year=1545 loc=england-wales
WITH r(a, b) AS (SELECT CASE WHEN :from_year < 0 THEN :from_year + 1 ELSE :from_year END,
                        CASE WHEN :to_year   < 0 THEN :to_year   + 1 ELSE :to_year   END)
SELECT t.entity_type, t.name,
       CASE WHEN t.astro_from BETWEEN r.a AND r.b THEN 'starts ' || t.year_from ELSE 'ends ' || t.year_to END AS change
  FROM v_timeline t, r
 WHERE t.location_id = :loc
   AND (t.astro_from BETWEEN r.a AND r.b OR t.astro_to BETWEEN r.a AND r.b)
 ORDER BY COALESCE(t.astro_from, t.astro_to), t.name;

-- Q7: All conjectural features and their uncertainty notes.
-- @params
SELECT entity_type, location_id, name, confidence, COALESCE(uncertainty, summary) AS note
  FROM v_conjectural ORDER BY location_id, entity_type, name;

-- Q8: Sources cited more than five times (the load-bearing sources).
-- @params
SELECT s.id, s.publisher, s.title, COUNT(*) AS times_cited
  FROM citation c JOIN source s ON s.id = c.source_id
 GROUP BY s.id HAVING COUNT(*) > 5 ORDER BY times_cited DESC;

-- Q9: Entities resting on a single source (fragile claims).
-- @params
SELECT e.entity_type, e.location_id, e.name, e.evidence, e.confidence, c.source_id
  FROM (SELECT entity_type, entity_id, MIN(source_id) AS source_id FROM citation
         WHERE entity_type <> 'location' GROUP BY entity_type, entity_id HAVING COUNT(*) = 1) c
  JOIN v_entity e ON e.entity_type = c.entity_type AND e.entity_id = c.entity_id
 ORDER BY e.location_id, e.entity_type, e.name;

-- Q10: Landmarks under construction in a given year (between a phase's start and its completion).
-- @params year=1250 loc=london
WITH p(y) AS (SELECT CASE WHEN :year < 0 THEN :year + 1 ELSE :year END)
SELECT l.name, ph.label, ph.year_from AS started, ph.year_built AS completed
  FROM landmark_phase ph JOIN landmark l ON l.id = ph.landmark_id, p
 WHERE l.location_id = :loc AND ph.continues = 0 AND ph.astro_built > ph.astro_from
   AND p.y >= ph.astro_from AND p.y < ph.astro_built
 ORDER BY l.name;

-- Q11: The longest-lived landmark phases (astronomical subtraction handles BCE/CE correctly).
-- @params
SELECT l.location_id, l.name, ph.label, ph.year_from, ph.year_to, ph.astro_to - ph.astro_from AS years
  FROM landmark_phase ph JOIN landmark l ON l.id = ph.landmark_id
 WHERE ph.year_to IS NOT NULL ORDER BY years DESC LIMIT 10;

-- Q12: Evidence class of landmark phases by era: which periods rest on attested vs conjectural data.
-- A phase belongs to the era in which it begins.
-- @params
SELECT e.location_id, e.name AS era, l.evidence, COUNT(*) AS n_phases
  FROM landmark_phase ph JOIN landmark l ON l.id = ph.landmark_id
  JOIN era e ON e.location_id = l.location_id AND ph.astro_from BETWEEN e.astro_from AND e.astro_to
 GROUP BY e.location_id, e.id, l.evidence ORDER BY e.location_id, e.astro_from, n_phases DESC;

-- Q13: Features whose dates overlap a given event (here: any event whose label matches).
-- Overlap of two ranges: a_from <= b_to AND b_from <= a_to, with open ends meaning "to the end".
-- @params label=%Dissolution% loc=london
SELECT ev.label AS event, ev.year, t.entity_type, t.name, t.year_from, t.year_to
  FROM event ev JOIN v_timeline t
    ON t.location_id = ev.location_id AND t.astro_from <= ev.astro_year AND (t.astro_to IS NULL OR t.astro_to >= ev.astro_year)
 WHERE ev.label LIKE :label AND ev.location_id = :loc AND t.entity_type = 'landmark_phase'
 ORDER BY t.name;

-- Q14: Period names of a place over time.
-- @params place=london
SELECT p.name AS modern_name, n.name AS period_name, n.year_from, n.year_to
  FROM place_name n JOIN place p ON p.id = n.place_id WHERE p.local_id = :place ORDER BY n.astro_from;

-- Q15: What was this place called in a given year? (Londinium in 150.)
-- @params place=london year=150
WITH p(y) AS (SELECT CASE WHEN :year < 0 THEN :year + 1 ELSE :year END)
SELECT pl.local_id, n.name AS name_in_year FROM place_name n JOIN place pl ON pl.id = n.place_id, p
 WHERE pl.local_id = :place AND n.astro_from <= p.y AND (n.astro_to IS NULL OR n.astro_to >= p.y);

-- Q16: Size history of a place (1 hamlet .. 5 one of the largest places in Britain).
-- @params place=london
SELECT ph.year_from, ph.year_to, ph.size, ph.label FROM place_phase ph JOIN place p ON p.id = ph.place_id
 WHERE p.local_id = :place ORDER BY ph.astro_from;

-- Q17: Every dated claim about one entity (fact-checker's view). Change :entity to any entity id.
-- @params entity=london/globe
SELECT fact_id, kind, value_text, year_from, year_to, source_ids, origin_file, origin_path
  FROM fact WHERE entity_id = :entity AND year_from IS NOT NULL ORDER BY astro_from, kind;

-- Q18: Every claim with no source, counted by location and kind (the fact-checking backlog).
-- @params
SELECT location_id, entity_type, kind, COUNT(*) AS n_unsourced FROM fact
 WHERE n_sources = 0 GROUP BY 1, 2, 3 ORDER BY n_unsourced DESC LIMIT 25;

-- Q19: Entities that cite sources that do not exist (dangling ids), worst first.
-- @params
SELECT source_id, COUNT(*) AS cited_by_entities, group_concat(DISTINCT location_id) AS locations
  FROM dangling_citation GROUP BY source_id ORDER BY cited_by_entities DESC;

-- Q20: Beginnings and endings of landmark phases by century (v_changes_by_century).
-- @params
SELECT century_start, direction, n FROM v_changes_by_century WHERE entity_type = 'landmark_phase'
 ORDER BY century_start_astro, direction;

-- Q21: Episodes: how much is attested vs tradition vs unknown.
-- @params
SELECT e.name, e.year, SUM(f.kind = 'attested') AS attested, SUM(f.kind = 'tradition') AS tradition, SUM(f.kind = 'unknown') AS unknown
  FROM episode e JOIN episode_fact f ON f.episode_id = e.id GROUP BY e.id ORDER BY e.astro_year;

-- Q22: Woodland cover at a year, linearly interpolated between the surrounding keyframes.
-- @params loc=england-wales year=1000
WITH p(y) AS (SELECT CASE WHEN :year < 0 THEN :year + 1 ELSE :year END),
a AS (SELECT k.astro_year ya, k.value va FROM woodland_keyframe k, p WHERE k.location_id = :loc AND k.astro_year <= p.y ORDER BY k.astro_year DESC LIMIT 1),
b AS (SELECT k.astro_year yb, k.value vb FROM woodland_keyframe k, p WHERE k.location_id = :loc AND k.astro_year >= p.y ORDER BY k.astro_year LIMIT 1)
SELECT :year AS year, ROUND(CASE WHEN yb = ya THEN va ELSE va + (vb - va) * (p.y - ya) * 1.0 / (yb - ya) END, 3) AS woodland_fraction
  FROM a, b, p;

-- Q23: Polities that existed in a year, with whether an extent polygon is drawn.
-- @params year=900
WITH p(y) AS (SELECT CASE WHEN :year < 0 THEN :year + 1 ELSE :year END)
SELECT pol.name, pol.kind, pol.year_from, pol.year_to, pol.has_polygon, pol.confidence
  FROM polity pol, p WHERE pol.astro_from <= p.y AND (pol.astro_to IS NULL OR pol.astro_to >= p.y) ORDER BY pol.kind, pol.name;

-- Q24: Landmarks near a point (bounding box about 500 m) that stood in a given year.
-- @params lat=51.5081 lon=-0.0877 year=1400 loc=london
WITH p(y) AS (SELECT CASE WHEN :year < 0 THEN :year + 1 ELSE :year END)
SELECT DISTINCT l.name, l.lat, l.lon, ph.label
  FROM landmark l JOIN landmark_phase ph ON ph.landmark_id = l.id, p
 WHERE l.location_id = :loc AND ABS(l.lat - :lat) < 0.0045 AND ABS(l.lon - :lon) < 0.007
   AND ph.astro_from <= p.y AND (ph.astro_to IS NULL OR ph.astro_to >= p.y) ORDER BY l.name;

-- Q25: Low-confidence entities per location and type.
-- @params
SELECT location_id, entity_type, COUNT(*) AS n_low FROM v_low_confidence GROUP BY 1, 2 ORDER BY 1, 3 DESC;

-- Q26: Sources by publisher (top publishers by citations).
-- @params
SELECT * FROM v_sources_by_publisher LIMIT 15;

-- Q27: Models and textures that are plausible stand-ins in a year (assets are dated by period).
-- @params year=1200
SELECT name, category, confidence, period_from, period_to FROM asset
 WHERE kind = 'model' AND (period_from IS NULL OR period_from <= :year) AND (period_to IS NULL OR period_to >= :year)
 ORDER BY category, name LIMIT 20;

-- Q28: Landmark model kinds in use (what the renderer is asked to draw).
-- @params
SELECT model_kind, COUNT(*) AS n_phases FROM landmark_phase GROUP BY 1 ORDER BY n_phases DESC;

-- Q29: Rebuild/replace lifecycle: landmarks with more than three phases, with all phase dates in order.
-- @params
SELECT l.name, COUNT(*) AS n_phases, group_concat(ph.year_from, ' > ') AS phase_starts
  FROM landmark l JOIN (SELECT * FROM landmark_phase ORDER BY landmark_id, seq) ph ON ph.landmark_id = l.id
 GROUP BY l.id HAVING COUNT(*) > 3 ORDER BY n_phases DESC;

-- Q30: Load problems recorded by the last build, grouped.
-- @params
SELECT severity, category, COUNT(*) AS n FROM load_issue GROUP BY 1, 2 ORDER BY 1, 3 DESC;
