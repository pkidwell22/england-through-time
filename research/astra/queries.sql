-- Enable references whenever opening the database for writes.
PRAGMA foreign_keys=ON;

-- Battle dates and site uncertainty. Null coordinates are intentional.
SELECT e.name,e.earliest_year,e.latest_year,e.month,e.day,e.calendar,e.qualifier,
       b.site_security,e.lat,e.lon,e.uncertainty_m,b.primary_sources
FROM event_timeline e JOIN battle b ON b.event_id=e.id
ORDER BY e.earliest_astronomical,e.month,e.day;

-- An army's attested stops. Never assume straight links are historical tracks.
SELECT c.name,w.sequence,w.place_name,w.earliest_year,w.latest_year,w.month,w.day,
       w.qualifier,w.action,w.path_certainty,w.lat,w.lon,w.uncertainty_m
FROM movement_timeline w JOIN campaign c ON c.id=w.campaign_id
WHERE c.name LIKE '%Great%' ORDER BY c.id,w.sequence;

-- Dated market/borough evidence by 1300, keeping qualified grants visible.
SELECT name,phase_type,earliest_year,latest_year,qualification_review_required,
       source_id,confidence,evidence_class
FROM market_borough_by_1300 ORDER BY name,earliest_year;

-- Sources for an assertion; replace the example ID with any fact ID.
SELECT c.citation_role,c.locator,s.title,s.publisher,s.url,s.access_status,c.checked_on
FROM citation c JOIN source s ON s.id=c.source_id
WHERE c.entity_id='x-flood-1607';

-- Competing interpretations: keep alternatives, their source and confidence.
SELECT d.topic,c.value_text,c.confidence,s.title,s.url,s.access_status
FROM dispute d JOIN claim c ON c.dispute_id=d.id JOIN source s ON s.id=c.source_id
ORDER BY d.id,c.id;

-- Do not compare or concatenate differently defined measures/model vintages.
SELECT s.name,s.unit,s.geographic_scope,d.earliest_year,d.latest_year,
       v.value_min,v.value_max,v.value_text,v.basis
FROM timeline_value v JOIN timeline_series s ON s.id=v.series_id
JOIN date_span d ON d.id=v.start_date_id
WHERE s.measure='population' ORDER BY s.id,d.earliest_year;

-- Source-qualified application comparisons against the frozen baseline.
SELECT app_file,app_id,json_pointer,comparison_type,app_claim,research_claim,
       confidence,source_title,url
FROM app_disagreements ORDER BY importance,id;

-- Unified factual provenance; workflow rows can be filtered out.
SELECT entity_type,confidence,evidence_class,COUNT(*) AS rows
FROM fact WHERE entity_type NOT IN ('date_span','todo')
GROUP BY entity_type,confidence,evidence_class;
