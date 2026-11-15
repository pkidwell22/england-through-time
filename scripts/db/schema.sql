-- =============================================================================
-- England Through Time: history.sqlite schema
--
-- GENERATED, READ-ONLY MIRROR of the JSON under data/. The JSON is the source
-- of truth. Rebuild with:  python3 scripts/db/build.py
-- Never edit rows in this database: fact-keeper notes live in curated.sqlite.
--
-- YEAR CONVENTION
--   Every year column named year_*, *_year or similar holds the HISTORICAL
--   signed year exactly as in the JSON: negative = BCE, positive = CE, and
--   there is no year 0 (1 BCE is -1, 1 CE is 1). CHECK (col <> 0) enforces it.
--   Next to each year column there is a GENERATED column astro_* holding the
--   ASTRONOMICAL year (1 BCE = 0, 2 BCE = -1, ...). Use astro_* for arithmetic,
--   durations, ordering across the BCE/CE boundary and range queries:
--       astro = CASE WHEN year < 0 THEN year + 1 ELSE year END
--   (The raw historical years already sort correctly; the difference matters
--   for subtraction: 1 CE - 1 BCE is 1 year, i.e. 1 - (-1) = 2 raw but
--   1 - 0 = 1 astronomical.)
--   Label expression ("55 BCE" / "1066 CE"):
--       CASE WHEN y < 0 THEN -y || ' BCE' ELSE y || ' CE' END
--   NULL in a *_to column means "still going in 1625" (end of the timeline).
--
-- IDS
--   Every entity id is namespaced "<location_id>/<local_id>", e.g.
--   'london/globe' or 'england-wales/london', so the same local id may be used
--   in different locations. local_id keeps the id as written in the JSON.
--   Rows also carry origin_file (path relative to data/) and origin_path
--   (JSONPath-like, e.g. $[12].phases[1]) so any row can be traced back.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- Build bookkeeping
-- -----------------------------------------------------------------------------

-- Key/value facts about this build (schema version, hash of the input JSON).
-- Deliberately contains no timestamp so history.sql stays diffable.
CREATE TABLE build_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Everything build.py noticed and could not or would not load silently:
-- parse failures, rejected rows (constraint violations), dangling source ids,
-- duplicate ids, unknown enumeration values, inverted year ranges.
CREATE TABLE load_issue (
  id          INTEGER PRIMARY KEY,
  severity    TEXT NOT NULL CHECK (severity IN ('error','warning','info')),
  -- parse | missing | unrecognised | schema | constraint | dangling_source |
  -- duplicate | enum | year-order
  category    TEXT NOT NULL,
  file        TEXT,                -- relative to data/
  entity_type TEXT,
  entity_id   TEXT,
  reason      TEXT NOT NULL,
  detail      TEXT                 -- JSON: the rejected row or extra context
);

-- -----------------------------------------------------------------------------
-- Locations, eras, events
-- -----------------------------------------------------------------------------

-- The national map (kind='national') and each detailed site (kind='site').
CREATE TABLE location (
  id             TEXT PRIMARY KEY,                       -- 'england-wales', 'london', ...
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('national','site')),
  subtitle       TEXT,
  scope_note     TEXT,                                   -- what this location does and does not cover
  origin_lat     REAL,                                   -- sites only: local-metre origin
  origin_lon     REAL,
  origin_note    TEXT,
  -- Bounds. National: geographic window in degrees. Sites: local metres east (x)
  -- and south (z) of the origin.
  lat_min REAL, lat_max REAL, lon_min REAL, lon_max REAL,
  x_min   REAL, x_max   REAL, z_min   REAL, z_max   REAL,
  timeline_start INTEGER CHECK (timeline_start IS NULL OR timeline_start <> 0),
  timeline_end   INTEGER CHECK (timeline_end   IS NULL OR timeline_end   <> 0),
  astro_timeline_start INTEGER GENERATED ALWAYS AS (CASE WHEN timeline_start < 0 THEN timeline_start + 1 ELSE timeline_start END) VIRTUAL,
  astro_timeline_end   INTEGER GENERATED ALWAYS AS (CASE WHEN timeline_end   < 0 THEN timeline_end   + 1 ELSE timeline_end   END) VIRTUAL,
  initial_year   INTEGER CHECK (initial_year IS NULL OR initial_year <> 0),  -- year shown on arrival, if set
  timeline_scale TEXT,                                   -- JSON [{year,u}]: slider mapping
  config_json    TEXT,                                   -- JSON: everything else in site.json (terrain, river, views, atmosphere, polygons, woodland notes, national terrain grid)
  origin_file    TEXT
);

-- Named periods within a location's timeline.
CREATE TABLE era (
  id          TEXT PRIMARY KEY,                          -- '<location>/<local_id>'
  location_id TEXT NOT NULL REFERENCES location(id),
  local_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  year_from   INTEGER NOT NULL CHECK (year_from <> 0),
  year_to     INTEGER NOT NULL CHECK (year_to   <> 0),
  astro_from  INTEGER GENERATED ALWAYS AS (CASE WHEN year_from < 0 THEN year_from + 1 ELSE year_from END) VIRTUAL,
  astro_to    INTEGER GENERATED ALWAYS AS (CASE WHEN year_to   < 0 THEN year_to   + 1 ELSE year_to   END) VIRTUAL,
  preset_year INTEGER CHECK (preset_year IS NULL OR preset_year <> 0),  -- year the UI jumps to for this era
  blurb       TEXT,
  origin_file TEXT, origin_path TEXT
);
CREATE INDEX idx_era_location ON era(location_id, astro_from);

-- A dated headline on the timeline (not tied to one landmark).
CREATE TABLE event (
  id          TEXT PRIMARY KEY,                          -- '<location>/<year>#<n>': n-th event of that year in file order
  location_id TEXT NOT NULL REFERENCES location(id),
  seq         INTEGER NOT NULL,                          -- 0-based position in the JSON array
  year        INTEGER NOT NULL CHECK (year <> 0),
  astro_year  INTEGER GENERATED ALWAYS AS (CASE WHEN year < 0 THEN year + 1 ELSE year END) VIRTUAL,
  label       TEXT NOT NULL,
  note        TEXT,
  origin_file TEXT, origin_path TEXT
);
CREATE INDEX idx_event_location_year ON event(location_id, astro_year);

-- -----------------------------------------------------------------------------
-- Sources and citations
-- -----------------------------------------------------------------------------

-- A bibliographic source. Ids are global across all sources*.json files.
CREATE TABLE source (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  publisher   TEXT,
  url         TEXT,
  scope       TEXT,                                      -- 'global', 'national', or the location id whose sources file defines it
  origin_file TEXT
);
CREATE INDEX idx_source_publisher ON source(publisher);

-- Single link table: any entity cites any number of sources.
-- entity_id is polymorphic (no FK): it is the id column of the table named by
-- entity_type. For entity_type='location', role says what the source backs.
CREATE TABLE citation (
  entity_type TEXT NOT NULL CHECK (entity_type IN
     ('landmark','zone','episode','event','place','line','polity','stone','location')),
  entity_id   TEXT NOT NULL,
  source_id   TEXT NOT NULL REFERENCES source(id),
  role        TEXT NOT NULL DEFAULT '',                  -- location only: 'woodland' | 'terrain' | 'river'
  location_id TEXT REFERENCES location(id),
  seq         INTEGER,                                   -- order within the JSON "sources" array
  PRIMARY KEY (entity_type, entity_id, source_id, role)
);
CREATE INDEX idx_citation_source ON citation(source_id);
CREATE INDEX idx_citation_location ON citation(location_id);

-- Source ids that an entity cites but that no sources*.json file defines.
-- Kept (not dropped) so a fact-checker can see the claim and fix the data.
CREATE TABLE dangling_citation (
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  location_id TEXT,
  origin_file TEXT,
  PRIMARY KEY (entity_type, entity_id, source_id)
);

-- -----------------------------------------------------------------------------
-- Detailed-site data: landmarks, phases, zones, episodes, stones
-- -----------------------------------------------------------------------------

-- A built or natural feature at a detailed site. Points and polylines (walls,
-- roads, streams, bridges) both have lat/lon; polylines also have path points.
CREATE TABLE landmark (
  id          TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES location(id),
  local_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  lat         REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon         REAL NOT NULL CHECK (lon BETWEEN -180 AND 180),
  bearing     REAL,                                      -- degrees clockwise from north: long axis of the model
  tier        TEXT NOT NULL CHECK (tier IN ('overview','district')),  -- district = inside the detailed benchmark district
  evidence    TEXT NOT NULL CHECK (evidence IN ('attested-standing','attested-excavated','attested-documentary','attested-pictorial','reconstructed','conjectural')),
  confidence  TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  summary     TEXT,
  uncertainty TEXT,                                      -- what is NOT known; the fact-checker's first stop
  has_path    INTEGER NOT NULL DEFAULT 0 CHECK (has_path IN (0,1)),
  origin_file TEXT, origin_path TEXT,
  UNIQUE (location_id, local_id)
);
CREATE INDEX idx_landmark_location ON landmark(location_id);
CREATE INDEX idx_landmark_evidence ON landmark(evidence, confidence);

-- A life stage of a landmark: a build, rebuild or alteration. See docs/MODEL-KINDS.md.
-- A phase is INTACT from year_built (or year_from) to year_to inclusive;
-- it is UNDER CONSTRUCTION from year_from to year_built when year_built > year_from.
CREATE TABLE landmark_phase (
  landmark_id TEXT NOT NULL REFERENCES landmark(id),
  seq         INTEGER NOT NULL,                          -- 0-based position in the landmark's phases array
  label       TEXT NOT NULL,
  year_from   INTEGER NOT NULL CHECK (year_from <> 0),   -- construction starts
  year_built  INTEGER CHECK (year_built IS NULL OR year_built <> 0),  -- construction complete; NULL = same as year_from
  year_to     INTEGER CHECK (year_to IS NULL OR year_to <> 0),        -- end of the intact phase; NULL = still standing in 1625
  astro_from  INTEGER GENERATED ALWAYS AS (CASE WHEN year_from  < 0 THEN year_from  + 1 ELSE year_from  END) VIRTUAL,
  astro_built INTEGER GENERATED ALWAYS AS (CASE WHEN year_built < 0 THEN year_built + 1 ELSE year_built END) VIRTUAL,
  astro_to    INTEGER GENERATED ALWAYS AS (CASE WHEN year_to    < 0 THEN year_to    + 1 ELSE year_to    END) VIRTUAL,
  -- What happens at year_to: handover (swapped instantly for the next phase),
  -- replaced/demolished (taken down over a few years), burned (destroyed within
  -- about a year), ruin (stump lingers until gone_by), decay (slow decline to gone_by).
  -- NULL as written in the JSON; the app treats NULL as 'replaced'.
  end_kind    TEXT CHECK (end_kind IS NULL OR end_kind IN ('handover','replaced','demolished','burned','ruin','decay')),
  gone_by     INTEGER CHECK (gone_by IS NULL OR gone_by <> 0),  -- ruin/decay: year the remains have gone
  astro_gone_by INTEGER GENERATED ALWAYS AS (CASE WHEN gone_by < 0 THEN gone_by + 1 ELSE gone_by END) VIRTUAL,
  continues   INTEGER NOT NULL DEFAULT 0 CHECK (continues IN (0,1)),  -- 1 = takes over a standing structure (no build animation)
  date_note   TEXT,                                      -- how the dates were derived
  model_kind  TEXT,                                      -- renderer model kind (docs/MODEL-KINDS.md)
  model_params TEXT,                                     -- JSON: the model object minus 'kind'
  origin_path TEXT,
  PRIMARY KEY (landmark_id, seq)
);
CREATE INDEX idx_lphase_years ON landmark_phase(astro_from, astro_to);
CREATE INDEX idx_lphase_end ON landmark_phase(end_kind);

-- Vertices of polyline landmarks, in drawing order.
CREATE TABLE landmark_path_point (
  landmark_id TEXT NOT NULL REFERENCES landmark(id),
  seq         INTEGER NOT NULL,
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  PRIMARY KEY (landmark_id, seq)
);

-- A procedurally filled area (houses, trees...) with a date-driven life:
-- it grows in between grow_from..grow_to and declines between decline_from..decline_to.
CREATE TABLE zone (
  id          TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES location(id),
  local_id    TEXT NOT NULL,
  label       TEXT NOT NULL,
  style       TEXT,                                      -- visual style key (roundhouse, roman-timber, ...)
  shape_type  TEXT,                                      -- ellipse | polygon | ref
  shape       TEXT,                                      -- JSON of the shape exactly as in the JSON file
  spacing     REAL,                                      -- lattice spacing in metres (smaller = denser)
  fill        REAL CHECK (fill IS NULL OR fill BETWEEN 0 AND 1),  -- fraction of cells used at peak
  band        REAL,
  tier        TEXT CHECK (tier IS NULL OR tier IN ('overview','district')),
  grow_from   INTEGER CHECK (grow_from IS NULL OR grow_from <> 0),
  grow_to     INTEGER CHECK (grow_to   IS NULL OR grow_to   <> 0),
  decline_from INTEGER CHECK (decline_from IS NULL OR decline_from <> 0),  -- NULL pair = persists to the end
  decline_to  INTEGER CHECK (decline_to   IS NULL OR decline_to   <> 0),
  astro_grow_from    INTEGER GENERATED ALWAYS AS (CASE WHEN grow_from    < 0 THEN grow_from    + 1 ELSE grow_from    END) VIRTUAL,
  astro_grow_to      INTEGER GENERATED ALWAYS AS (CASE WHEN grow_to      < 0 THEN grow_to      + 1 ELSE grow_to      END) VIRTUAL,
  astro_decline_from INTEGER GENERATED ALWAYS AS (CASE WHEN decline_from < 0 THEN decline_from + 1 ELSE decline_from END) VIRTUAL,
  astro_decline_to   INTEGER GENERATED ALWAYS AS (CASE WHEN decline_to   < 0 THEN decline_to   + 1 ELSE decline_to   END) VIRTUAL,
  decline_by  TEXT CHECK (decline_by IS NULL OR decline_by IN ('fire','abandonment','clearance','rebuild')),
  grid_bearing REAL,
  preexisting INTEGER CHECK (preexisting IS NULL OR preexisting IN (0,1)),
  evidence    TEXT NOT NULL CHECK (evidence IN ('attested-standing','attested-excavated','attested-documentary','attested-pictorial','reconstructed','conjectural')),
  confidence  TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  note        TEXT,                                      -- the evidence note (zones have no separate summary/uncertainty)
  origin_file TEXT, origin_path TEXT,
  UNIQUE (location_id, local_id)
);
CREATE INDEX idx_zone_location ON zone(location_id);
CREATE INDEX idx_zone_years ON zone(astro_grow_from, astro_decline_to);

-- A staged historical event the viewer can jump to.
CREATE TABLE episode (
  id          TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES location(id),
  local_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  year        INTEGER NOT NULL CHECK (year <> 0),
  astro_year  INTEGER GENERATED ALWAYS AS (CASE WHEN year < 0 THEN year + 1 ELSE year END) VIRTUAL,
  fraction    REAL CHECK (fraction IS NULL OR fraction BETWEEN 0 AND 1),  -- position within the year
  date_note   TEXT,
  lat         REAL, lon REAL,
  in_map      INTEGER CHECK (in_map IS NULL OR in_map IN (0,1)),         -- 0 = happened off the modelled map
  off_map     TEXT,
  location_note TEXT,
  view_json   TEXT,                                      -- camera preset JSON
  summary     TEXT,
  evidence    TEXT NOT NULL CHECK (evidence IN ('attested-standing','attested-excavated','attested-documentary','attested-pictorial','reconstructed','conjectural')),
  confidence  TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  origin_file TEXT, origin_path TEXT,
  UNIQUE (location_id, local_id)
);
CREATE INDEX idx_episode_location_year ON episode(location_id, astro_year);

-- What is attested, traditional or unknown about an episode, one statement per row.
CREATE TABLE episode_fact (
  episode_id TEXT NOT NULL REFERENCES episode(id),
  kind       TEXT NOT NULL CHECK (kind IN ('attested','tradition','unknown')),
  seq        INTEGER NOT NULL,                           -- 0-based position within its kind's array
  text       TEXT NOT NULL,
  PRIMARY KEY (episode_id, kind, seq)
);

-- Individual Stonehenge stones (data/locations/stonehenge/stones.json, Petrie numbering).
CREATE TABLE stone (
  id          TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES location(id),
  local_id    TEXT NOT NULL,
  set_name    TEXT,                                      -- sarsen-circle, trilithons, bluestone-circle ...
  type        TEXT,                                      -- sarsen | bluestone | ...
  role        TEXT,                                      -- upright | lintel | ...
  az          REAL,                                      -- degrees clockwise from true north, from the fitted circle centre
  r           REAL,                                      -- metres from the fitted centre
  w REAL, t REAL, h REAL,                                -- tangential width, radial thickness, height (metres)
  built       TEXT,
  hypothetical INTEGER CHECK (hypothetical IS NULL OR hypothetical IN (0,1)),
  state1625   TEXT,                                      -- reasoned state in 1625 (standing, fallen, missing ...)
  evidence1625 TEXT,
  state_today TEXT,
  notes       TEXT,
  extra_json  TEXT,                                      -- remaining per-stone keys (dressed, tenons, on, curved, ...)
  origin_file TEXT, origin_path TEXT,
  UNIQUE (location_id, local_id)
);
CREATE INDEX idx_stone_set ON stone(location_id, set_name);

-- -----------------------------------------------------------------------------
-- National data: places, lines, polities, keyframes
-- -----------------------------------------------------------------------------

-- A named place on the national map.
CREATE TABLE place (
  id          TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES location(id),
  local_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  lat         REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon         REAL NOT NULL CHECK (lon BETWEEN -180 AND 180),
  country     TEXT NOT NULL CHECK (country IN ('england','wales')),  -- modern country the site lies in
  kind        TEXT NOT NULL,                             -- city|town|port|fort|hillfort|monument|monastery|cathedral|castle|palace|battle|mine|other (unknown values are loaded and flagged in load_issue)
  evidence    TEXT NOT NULL CHECK (evidence IN ('attested-standing','attested-excavated','attested-documentary','attested-pictorial','reconstructed','conjectural')),
  confidence  TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  summary     TEXT,
  uncertainty TEXT,
  site_id     TEXT,                                      -- detailed site the user can descend into (location.id; not an FK so a missing site file does not reject the place)
  origin_file TEXT, origin_path TEXT,
  UNIQUE (location_id, local_id)
);
CREATE INDEX idx_place_evidence ON place(evidence, confidence);
CREATE INDEX idx_place_country ON place(country, kind);

-- Dated phases of a place. size: 1 hamlet/minor site .. 5 one of the largest
-- places in Britain at the time; 0 = abandoned but site known.
CREATE TABLE place_phase (
  place_id   TEXT NOT NULL REFERENCES place(id),
  seq        INTEGER NOT NULL,
  year_from  INTEGER NOT NULL CHECK (year_from <> 0),
  year_to    INTEGER CHECK (year_to IS NULL OR year_to <> 0),   -- NULL = to the end of the timeline
  astro_from INTEGER GENERATED ALWAYS AS (CASE WHEN year_from < 0 THEN year_from + 1 ELSE year_from END) VIRTUAL,
  astro_to   INTEGER GENERATED ALWAYS AS (CASE WHEN year_to   < 0 THEN year_to   + 1 ELSE year_to   END) VIRTUAL,
  label      TEXT NOT NULL,
  size       INTEGER NOT NULL CHECK (size BETWEEN 0 AND 5),
  kind       TEXT,                                       -- override of place.kind for this phase
  note       TEXT,
  origin_path TEXT,
  PRIMARY KEY (place_id, seq)
);
CREATE INDEX idx_pphase_years ON place_phase(astro_from, astro_to);
CREATE INDEX idx_pphase_size ON place_phase(size);

-- Period names of a place (Londinium, Lundenwic...).
CREATE TABLE place_name (
  place_id   TEXT NOT NULL REFERENCES place(id),
  seq        INTEGER NOT NULL,
  name       TEXT NOT NULL,
  year_from  INTEGER NOT NULL CHECK (year_from <> 0),
  year_to    INTEGER CHECK (year_to IS NULL OR year_to <> 0),
  astro_from INTEGER GENERATED ALWAYS AS (CASE WHEN year_from < 0 THEN year_from + 1 ELSE year_from END) VIRTUAL,
  astro_to   INTEGER GENERATED ALWAYS AS (CASE WHEN year_to   < 0 THEN year_to   + 1 ELSE year_to   END) VIRTUAL,
  PRIMARY KEY (place_id, seq)
);
CREATE INDEX idx_pname_years ON place_name(astro_from, astro_to);

-- Roads, walls, dykes, river routes and borders.
CREATE TABLE line_feature (
  id          TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES location(id),
  local_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,                             -- roman-road|road|frontier-wall|dyke|river-route|border
  year_from   INTEGER NOT NULL CHECK (year_from <> 0),
  year_to     INTEGER CHECK (year_to IS NULL OR year_to <> 0),
  astro_from  INTEGER GENERATED ALWAYS AS (CASE WHEN year_from < 0 THEN year_from + 1 ELSE year_from END) VIRTUAL,
  astro_to    INTEGER GENERATED ALWAYS AS (CASE WHEN year_to   < 0 THEN year_to   + 1 ELSE year_to   END) VIRTUAL,
  evidence    TEXT NOT NULL CHECK (evidence IN ('attested-standing','attested-excavated','attested-documentary','attested-pictorial','reconstructed','conjectural')),
  confidence  TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  summary     TEXT,
  uncertainty TEXT,
  n_points    INTEGER,
  origin_file TEXT, origin_path TEXT,
  UNIQUE (location_id, local_id)
);
CREATE INDEX idx_line_years ON line_feature(astro_from, astro_to);
CREATE INDEX idx_line_kind ON line_feature(kind);

-- Vertices of a line_feature in drawing order.
CREATE TABLE line_point (
  line_id TEXT NOT NULL REFERENCES line_feature(id),
  seq     INTEGER NOT NULL,
  lat     REAL NOT NULL,
  lon     REAL NOT NULL,
  PRIMARY KEY (line_id, seq)
);
CREATE INDEX idx_line_point_pos ON line_point(lat, lon);

-- Kingdoms, provinces, peoples. Borders were rarely lines; polygons are indicative.
CREATE TABLE polity (
  id          TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES location(id),
  local_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,                             -- people|province|kingdom|principality|earldom|march|realm
  year_from   INTEGER NOT NULL CHECK (year_from <> 0),
  year_to     INTEGER CHECK (year_to IS NULL OR year_to <> 0),
  astro_from  INTEGER GENERATED ALWAYS AS (CASE WHEN year_from < 0 THEN year_from + 1 ELSE year_from END) VIRTUAL,
  astro_to    INTEGER GENERATED ALWAYS AS (CASE WHEN year_to   < 0 THEN year_to   + 1 ELSE year_to   END) VIRTUAL,
  label_lat   REAL, label_lon REAL,                      -- where the map puts the label
  evidence    TEXT NOT NULL CHECK (evidence IN ('attested-standing','attested-excavated','attested-documentary','attested-pictorial','reconstructed','conjectural')),
  confidence  TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  note        TEXT,
  has_polygon INTEGER NOT NULL DEFAULT 0 CHECK (has_polygon IN (0,1)),
  origin_file TEXT, origin_path TEXT,
  UNIQUE (location_id, local_id)
);
CREATE INDEX idx_polity_years ON polity(astro_from, astro_to);

-- Ring vertices of a polity's indicative extent, in drawing order.
CREATE TABLE polity_point (
  polity_id TEXT NOT NULL REFERENCES polity(id),
  seq       INTEGER NOT NULL,
  lat       REAL NOT NULL,
  lon       REAL NOT NULL,
  PRIMARY KEY (polity_id, seq)
);

-- Fraction of land under woodland over time (national trend, or a site's own
-- fraction of the ORIGINAL cover remaining). Linear interpolation between keyframes.
CREATE TABLE woodland_keyframe (
  location_id TEXT NOT NULL REFERENCES location(id),
  seq         INTEGER NOT NULL,
  year        INTEGER NOT NULL CHECK (year <> 0),
  astro_year  INTEGER GENERATED ALWAYS AS (CASE WHEN year < 0 THEN year + 1 ELSE year END) VIRTUAL,
  value       REAL NOT NULL CHECK (value BETWEEN 0 AND 1),
  origin_file TEXT,
  PRIMARY KEY (location_id, seq)
);

-- Relative sea level in metres (0 = present) by year, from national terrain.json.
CREATE TABLE sea_level_keyframe (
  location_id TEXT NOT NULL REFERENCES location(id),
  seq         INTEGER NOT NULL,
  year        INTEGER NOT NULL CHECK (year <> 0),
  astro_year  INTEGER GENERATED ALWAYS AS (CASE WHEN year < 0 THEN year + 1 ELSE year END) VIRTUAL,
  value_m     REAL NOT NULL,
  origin_file TEXT,
  PRIMARY KEY (location_id, seq)
);

-- -----------------------------------------------------------------------------
-- Assets (data/assets.json, data/models.json)
-- -----------------------------------------------------------------------------

-- Textures, sky, terrain textures, composites and 3D models, with provenance.
-- All come from Poly Haven (CC0). url is DERIVED from the Poly Haven slug
-- (https://polyhaven.com/a/<slug>); the JSON files record slugs, not urls.
CREATE TABLE asset (
  id          TEXT PRIMARY KEY,                          -- '<kind>:<name>'
  kind        TEXT NOT NULL CHECK (kind IN ('material','sky','terrain-texture','composite','model','excluded-model')),
  name        TEXT NOT NULL,                             -- builder-facing material name, or the model's display name
  slug        TEXT,                                      -- Poly Haven asset id
  source      TEXT,
  licence     TEXT,
  url         TEXT,
  tile_m      REAL,                                      -- real-world metres per texture repeat
  colour      TEXT,                                      -- tint
  category    TEXT,                                      -- models: tree, shrub, rock, prop...
  variants    INTEGER,
  period_from INTEGER CHECK (period_from IS NULL OR period_from <> 0),  -- models: first plausible year
  period_to   INTEGER CHECK (period_to   IS NULL OR period_to   <> 0),
  confidence  TEXT CHECK (confidence IS NULL OR confidence IN ('high','medium','low')),  -- models: how good a stand-in
  note        TEXT,                                      -- plausibility text, exclusion reason, or file note
  extra_json  TEXT,
  origin_file TEXT, origin_path TEXT
);
CREATE INDEX idx_asset_kind ON asset(kind, category);

-- -----------------------------------------------------------------------------
-- Materialised atomic facts (filled by build.py from v_fact)
-- -----------------------------------------------------------------------------

-- One row per checkable statement. See v_fact for how each kind is derived.
-- fact_id is stable across rebuilds as long as the JSON id and array position
-- do not change: '<entity_type>:<entity_id>:<kind>[:<n>]'.
-- Kinds: located_at, phase, begun, completed, ended, gone_by, size, named,
--   existed, event, occurred, episode_attested, episode_tradition,
--   episode_unknown, grew, declined, era, state_1625, woodland_cover, sea_level.
CREATE TABLE fact (
  fact_id     TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  entity_name TEXT,
  location_id TEXT,
  kind        TEXT NOT NULL,
  year_from   INTEGER CHECK (year_from IS NULL OR year_from <> 0),  -- NULL = undated (e.g. a position)
  year_to     INTEGER CHECK (year_to   IS NULL OR year_to   <> 0),  -- NULL on a ranged kind = to the end of the timeline
  astro_from  INTEGER GENERATED ALWAYS AS (CASE WHEN year_from < 0 THEN year_from + 1 ELSE year_from END) VIRTUAL,
  astro_to    INTEGER GENERATED ALWAYS AS (CASE WHEN year_to   < 0 THEN year_to   + 1 ELSE year_to   END) VIRTUAL,
  value_text  TEXT,                                      -- the statement: label, name, size, end kind...
  detail      TEXT,                                      -- context (note, summary)
  lat         REAL, lon REAL,
  evidence    TEXT,                                      -- of the owning entity; NULL where the entity has none (events, stones)
  confidence  TEXT,
  source_ids  TEXT,                                      -- comma-separated sources cited by the owning entity
  n_sources   INTEGER NOT NULL DEFAULT 0,
  origin_file TEXT,
  origin_path TEXT
);
CREATE INDEX idx_fact_entity ON fact(entity_type, entity_id);
CREATE INDEX idx_fact_location ON fact(location_id, astro_from);
CREATE INDEX idx_fact_kind ON fact(kind);
CREATE INDEX idx_fact_unsourced ON fact(n_sources);

-- =============================================================================
-- VIEWS
-- =============================================================================

-- Every evidenced thing in one list: the common columns of all entity tables.
CREATE VIEW v_entity AS
  SELECT 'landmark' AS entity_type, id AS entity_id, location_id, name, evidence, confidence, summary, uncertainty, origin_file FROM landmark
  UNION ALL SELECT 'zone',    id, location_id, label, evidence, confidence, note, NULL, origin_file FROM zone
  UNION ALL SELECT 'episode', id, location_id, name,  evidence, confidence, summary, NULL, origin_file FROM episode
  UNION ALL SELECT 'place',   id, location_id, name,  evidence, confidence, summary, uncertainty, origin_file FROM place
  UNION ALL SELECT 'line',    id, location_id, name,  evidence, confidence, summary, uncertainty, origin_file FROM line_feature
  UNION ALL SELECT 'polity',  id, location_id, name,  evidence, confidence, note, NULL, origin_file FROM polity
  UNION ALL SELECT 'event',   id, location_id, label, NULL, NULL, note, NULL, origin_file FROM event
  UNION ALL SELECT 'stone',   id, location_id, local_id, NULL, NULL, notes, NULL, origin_file FROM stone;

-- Every dated thing as one chronological list. Sort by astro_from.
-- year_to NULL = still going at the end of the timeline. Undated items are excluded.
CREATE VIEW v_timeline AS
  SELECT l.location_id, 'landmark_phase' AS entity_type, l.id AS entity_id, l.name || ': ' || p.label AS name,
         p.year_from, p.year_to, p.astro_from, p.astro_to, l.evidence, l.confidence,
         COALESCE(p.end_kind,'') AS detail
    FROM landmark_phase p JOIN landmark l ON l.id = p.landmark_id
  UNION ALL
  SELECT pl.location_id, 'place_phase', pl.id, pl.name || ': ' || p.label,
         p.year_from, p.year_to, p.astro_from, p.astro_to, pl.evidence, pl.confidence, 'size ' || p.size
    FROM place_phase p JOIN place pl ON pl.id = p.place_id
  UNION ALL
  SELECT location_id, 'event', id, label, year, year, astro_year, astro_year, NULL, NULL, COALESCE(note,'') FROM event
  UNION ALL
  SELECT location_id, 'episode', id, name, year, year, astro_year, astro_year, evidence, confidence, '' FROM episode
  UNION ALL
  SELECT location_id, 'line', id, name, year_from, year_to, astro_from, astro_to, evidence, confidence, kind FROM line_feature
  UNION ALL
  SELECT location_id, 'polity', id, name, year_from, year_to, astro_from, astro_to, evidence, confidence, kind FROM polity
  UNION ALL
  SELECT location_id, 'zone', id, label, grow_from, decline_to, astro_grow_from, astro_decline_to, evidence, confidence, style FROM zone WHERE grow_from IS NOT NULL;

-- Year labels for every year that appears in the timeline ("55 BCE", "1066 CE").
CREATE VIEW year_label AS
  SELECT y AS year,
         CASE WHEN y < 0 THEN y + 1 ELSE y END AS astro_year,
         CASE WHEN y < 0 THEN -y || ' BCE' ELSE y || ' CE' END AS label
  FROM (SELECT year_from AS y FROM v_timeline WHERE year_from IS NOT NULL
        UNION SELECT year_to FROM v_timeline WHERE year_to IS NOT NULL);

-- Entities that cite no source at all. Entities whose cited ids are all
-- undefined are NOT listed here: they appear in v_dangling instead.
CREATE VIEW v_unsourced AS
  SELECT e.* FROM v_entity e
   WHERE NOT EXISTS (SELECT 1 FROM citation c WHERE c.entity_type = e.entity_type AND c.entity_id = e.entity_id)
     AND NOT EXISTS (SELECT 1 FROM dangling_citation d WHERE d.entity_type = e.entity_type AND d.entity_id = e.entity_id);

-- Entities that cite sources, but none of them are defined anywhere.
CREATE VIEW v_dangling AS
  SELECT d.entity_type, d.entity_id, d.location_id, group_concat(d.source_id, ', ') AS missing_source_ids, d.origin_file
    FROM dangling_citation d GROUP BY d.entity_type, d.entity_id;

CREATE VIEW v_low_confidence AS
  SELECT * FROM v_entity WHERE confidence = 'low';

CREATE VIEW v_conjectural AS
  SELECT * FROM v_entity WHERE evidence = 'conjectural';

-- Sources grouped by publisher with how often they are cited.
CREATE VIEW v_sources_by_publisher AS
  SELECT COALESCE(NULLIF(s.publisher,''), '(none)') AS publisher,
         COUNT(DISTINCT s.id) AS n_sources,
         COUNT(c.source_id)   AS n_citations
    FROM source s LEFT JOIN citation c ON c.source_id = s.id
   GROUP BY 1 ORDER BY n_citations DESC, publisher;

-- Beginnings and endings of dated things by century (bucketed on the
-- astronomical year: century_start_astro is a multiple of 100; the label shows
-- the historical year it starts at). direction = 'start' or 'end'.
CREATE VIEW v_changes_by_century AS
  SELECT century_start_astro,
         CASE WHEN century_start_astro <= 0 THEN -(century_start_astro - 1) || ' BCE' ELSE century_start_astro || ' CE' END AS century_start,
         direction, entity_type, COUNT(*) AS n
  FROM (
    SELECT entity_type, 'start' AS direction, astro_from - (((astro_from % 100) + 100) % 100) AS century_start_astro
      FROM v_timeline WHERE astro_from IS NOT NULL
    UNION ALL
    SELECT entity_type, 'end', astro_to - (((astro_to % 100) + 100) % 100)
      FROM v_timeline WHERE astro_to IS NOT NULL
  )
  GROUP BY century_start_astro, direction, entity_type
  ORDER BY century_start_astro, direction, entity_type;

-- Atomic, checkable statements flattened from every entity. build.py copies
-- this view into the fact table (faster, and addressable by fact_id).
CREATE VIEW v_fact AS
WITH f (fact_id, entity_type, entity_id, entity_name, location_id, kind,
        year_from, year_to, value_text, detail, lat, lon, evidence, confidence,
        origin_file, origin_path, cite_role) AS (
  -- landmarks: position
  SELECT 'landmark:'||l.id||':located_at','landmark',l.id,l.name,l.location_id,'located_at',
         NULL,NULL,l.name,l.summary,l.lat,l.lon,l.evidence,l.confidence,l.origin_file,l.origin_path,''
    FROM landmark l
  -- landmarks: each phase as a range, plus its begin / completion / end / gone-by dates
  UNION ALL SELECT 'landmark:'||l.id||':phase:'||p.seq,'landmark',l.id,l.name,l.location_id,'phase',
         p.year_from,p.year_to,p.label,p.date_note,NULL,NULL,l.evidence,l.confidence,l.origin_file,l.origin_path||'.phases['||p.seq||']',''
    FROM landmark_phase p JOIN landmark l ON l.id=p.landmark_id
  UNION ALL SELECT 'landmark:'||l.id||':begun:'||p.seq,'landmark',l.id,l.name,l.location_id,'begun',
         p.year_from,NULL,p.label,p.date_note,NULL,NULL,l.evidence,l.confidence,l.origin_file,l.origin_path||'.phases['||p.seq||'].from',''
    FROM landmark_phase p JOIN landmark l ON l.id=p.landmark_id WHERE p.continues=0
  UNION ALL SELECT 'landmark:'||l.id||':completed:'||p.seq,'landmark',l.id,l.name,l.location_id,'completed',
         p.year_built,NULL,p.label,p.date_note,NULL,NULL,l.evidence,l.confidence,l.origin_file,l.origin_path||'.phases['||p.seq||'].built',''
    FROM landmark_phase p JOIN landmark l ON l.id=p.landmark_id WHERE p.year_built IS NOT NULL AND p.year_built<>p.year_from
  UNION ALL SELECT 'landmark:'||l.id||':ended:'||p.seq,'landmark',l.id,l.name,l.location_id,'ended',
         p.year_to,NULL,p.label||' ('||COALESCE(p.end_kind,'replaced')||')',p.date_note,NULL,NULL,l.evidence,l.confidence,l.origin_file,l.origin_path||'.phases['||p.seq||'].to',''
    FROM landmark_phase p JOIN landmark l ON l.id=p.landmark_id WHERE p.year_to IS NOT NULL
  UNION ALL SELECT 'landmark:'||l.id||':gone_by:'||p.seq,'landmark',l.id,l.name,l.location_id,'gone_by',
         p.gone_by,NULL,p.label,p.date_note,NULL,NULL,l.evidence,l.confidence,l.origin_file,l.origin_path||'.phases['||p.seq||'].goneBy',''
    FROM landmark_phase p JOIN landmark l ON l.id=p.landmark_id WHERE p.gone_by IS NOT NULL
  -- places
  UNION ALL SELECT 'place:'||p.id||':located_at','place',p.id,p.name,p.location_id,'located_at',
         NULL,NULL,p.name,p.summary,p.lat,p.lon,p.evidence,p.confidence,p.origin_file,p.origin_path,''
    FROM place p
  UNION ALL SELECT 'place:'||p.id||':phase:'||ph.seq,'place',p.id,p.name,p.location_id,'phase',
         ph.year_from,ph.year_to,ph.label,ph.note,NULL,NULL,p.evidence,p.confidence,p.origin_file,p.origin_path||'.phases['||ph.seq||']',''
    FROM place_phase ph JOIN place p ON p.id=ph.place_id
  UNION ALL SELECT 'place:'||p.id||':size:'||ph.seq,'place',p.id,p.name,p.location_id,'size',
         ph.year_from,ph.year_to,'size '||ph.size,ph.label,NULL,NULL,p.evidence,p.confidence,p.origin_file,p.origin_path||'.phases['||ph.seq||'].size',''
    FROM place_phase ph JOIN place p ON p.id=ph.place_id
  UNION ALL SELECT 'place:'||p.id||':named:'||n.seq,'place',p.id,p.name,p.location_id,'named',
         n.year_from,n.year_to,n.name,NULL,NULL,NULL,p.evidence,p.confidence,p.origin_file,p.origin_path||'.altNames['||n.seq||']',''
    FROM place_name n JOIN place p ON p.id=n.place_id
  -- lines and polities
  UNION ALL SELECT 'line:'||x.id||':existed','line',x.id,x.name,x.location_id,'existed',
         x.year_from,x.year_to,x.kind||': '||x.name,x.summary,NULL,NULL,x.evidence,x.confidence,x.origin_file,x.origin_path,''
    FROM line_feature x
  UNION ALL SELECT 'polity:'||x.id||':existed','polity',x.id,x.name,x.location_id,'existed',
         x.year_from,x.year_to,x.kind||': '||x.name,x.note,NULL,NULL,x.evidence,x.confidence,x.origin_file,x.origin_path,''
    FROM polity x
  UNION ALL SELECT 'polity:'||x.id||':located_at','polity',x.id,x.name,x.location_id,'located_at',
         NULL,NULL,x.name,'label position',x.label_lat,x.label_lon,x.evidence,x.confidence,x.origin_file,x.origin_path,''
    FROM polity x WHERE x.label_lat IS NOT NULL
  -- events, episodes
  UNION ALL SELECT 'event:'||e.id||':event','event',e.id,e.label,e.location_id,'event',
         e.year,e.year,e.label,e.note,NULL,NULL,NULL,NULL,e.origin_file,e.origin_path,''
    FROM event e
  UNION ALL SELECT 'episode:'||e.id||':occurred','episode',e.id,e.name,e.location_id,'occurred',
         e.year,e.year,e.name,e.date_note,NULL,NULL,e.evidence,e.confidence,e.origin_file,e.origin_path,''
    FROM episode e
  UNION ALL SELECT 'episode:'||e.id||':located_at','episode',e.id,e.name,e.location_id,'located_at',
         NULL,NULL,e.name,e.location_note,e.lat,e.lon,e.evidence,e.confidence,e.origin_file,e.origin_path,''
    FROM episode e WHERE e.lat IS NOT NULL
  UNION ALL SELECT 'episode:'||e.id||':'||f.kind||':'||f.seq,'episode',e.id,e.name,e.location_id,'episode_'||f.kind,
         e.year,e.year,f.text,NULL,NULL,NULL,NULL,NULL,e.origin_file,e.origin_path||'.'||f.kind||'['||f.seq||']',''
    FROM episode_fact f JOIN episode e ON e.id=f.episode_id
  -- zones
  UNION ALL SELECT 'zone:'||z.id||':grew','zone',z.id,z.label,z.location_id,'grew',
         z.grow_from,z.grow_to,z.style,z.note,NULL,NULL,z.evidence,z.confidence,z.origin_file,z.origin_path||'.grow',''
    FROM zone z WHERE z.grow_from IS NOT NULL
  UNION ALL SELECT 'zone:'||z.id||':declined','zone',z.id,z.label,z.location_id,'declined',
         z.decline_from,z.decline_to,COALESCE(z.decline_by,''),z.note,NULL,NULL,z.evidence,z.confidence,z.origin_file,z.origin_path||'.decline',''
    FROM zone z WHERE z.decline_from IS NOT NULL
  -- eras, stones, keyframes
  UNION ALL SELECT 'era:'||e.id||':era','era',e.id,e.name,e.location_id,'era',
         e.year_from,e.year_to,e.name,e.blurb,NULL,NULL,NULL,NULL,e.origin_file,e.origin_path,''
    FROM era e
  UNION ALL SELECT 'stone:'||s.id||':state_1625','stone',s.id,s.local_id,s.location_id,'state_1625',
         1625,1625,s.state1625,s.evidence1625,NULL,NULL,NULL,NULL,s.origin_file,s.origin_path,''
    FROM stone s WHERE s.state1625 IS NOT NULL
  UNION ALL SELECT 'location:'||k.location_id||':woodland_cover:'||k.seq,'location',k.location_id,l.name,k.location_id,'woodland_cover',
         k.year,k.year,CAST(k.value AS TEXT),NULL,NULL,NULL,NULL,NULL,k.origin_file,'$.woodland.cover['||k.seq||']','woodland'
    FROM woodland_keyframe k JOIN location l ON l.id=k.location_id
  UNION ALL SELECT 'location:'||k.location_id||':sea_level:'||k.seq,'location',k.location_id,l.name,k.location_id,'sea_level',
         k.year,k.year,CAST(k.value_m AS TEXT)||' m',NULL,NULL,NULL,NULL,NULL,k.origin_file,'$.seaLevel['||k.seq||']','terrain'
    FROM sea_level_keyframe k JOIN location l ON l.id=k.location_id
)
SELECT f.fact_id, f.entity_type, f.entity_id, f.entity_name, f.location_id, f.kind,
       f.year_from, f.year_to,
       CASE WHEN f.year_from < 0 THEN f.year_from + 1 ELSE f.year_from END AS astro_from,
       CASE WHEN f.year_to   < 0 THEN f.year_to   + 1 ELSE f.year_to   END AS astro_to,
       f.value_text, f.detail, f.lat, f.lon, f.evidence, f.confidence,
       (SELECT group_concat(source_id, ',') FROM
          (SELECT c.source_id FROM citation c WHERE c.entity_type=f.entity_type AND c.entity_id=f.entity_id AND c.role=f.cite_role ORDER BY c.seq, c.source_id)) AS source_ids,
       (SELECT COUNT(*) FROM citation c WHERE c.entity_type=f.entity_type AND c.entity_id=f.entity_id AND c.role=f.cite_role) AS n_sources,
       f.origin_file, f.origin_path
  FROM f;

-- Convenience: facts with a human-readable date range, for reading and exports.
CREATE VIEW v_fact_readable AS
  SELECT fact_id, location_id, entity_type, entity_id, entity_name, kind,
         CASE WHEN year_from IS NULL THEN '' WHEN year_from < 0 THEN -year_from || ' BCE' ELSE year_from || ' CE' END AS date_from,
         CASE WHEN year_to   IS NULL THEN '' WHEN year_to   < 0 THEN -year_to   || ' BCE' ELSE year_to   || ' CE' END AS date_to,
         value_text, evidence, confidence, source_ids, n_sources, origin_file, origin_path
    FROM fact;
