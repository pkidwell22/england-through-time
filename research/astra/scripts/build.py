#!/usr/bin/env python3
"""Offline, deterministic SQLite loader. Writes only inside research/astra/."""
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKED = '2026-11-14'
EVIDENCE = "'attested-standing','attested-excavated','attested-documentary','attested-pictorial','reconstructed','conjectural','tradition'"

# Every substantive table shares provenance and temporal bounds. The registry,
# citation, source and load ledger are bookkeeping tables, not historical claims.
TABLES = {
 'place': ('Named geographic entities; coordinates are anchors with an explicit error radius, never inferred boundaries.', '''name TEXT NOT NULL, kind TEXT NOT NULL, country TEXT NOT NULL CHECK(country IN ('england','wales','context')), lat REAL, lon REAL, uncertainty_m REAL, position_method TEXT NOT NULL CHECK(position_method IN ('surveyed','registered boundary centroid','gazetteer','inferred','unlocated')), position_source_id TEXT REFERENCES source(id), position_note TEXT, position_confidence TEXT CHECK(position_confidence IN ('high','medium','low')), CHECK((lat IS NULL AND lon IS NULL AND uncertainty_m IS NULL AND position_method='unlocated') OR (lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180 AND uncertainty_m>=0 AND position_method<>'unlocated' AND position_source_id IS NOT NULL))'''),
 'place_name': ('Dated name attestations and languages. Dates describe attestation, not proof of exclusive use.', 'place_id TEXT NOT NULL REFERENCES place(id), name TEXT NOT NULL, language TEXT NOT NULL, name_type TEXT'),
 'place_phase': ('Dated states of a place; population and rank are separate explicitly based estimates.', 'place_id TEXT NOT NULL REFERENCES place(id), phase_type TEXT NOT NULL, description TEXT NOT NULL, population_min REAL, population_max REAL, rank INTEGER, estimate_basis TEXT'),
 'person': ('Named people; start/end mean birth/death bounds, not reigns.', 'name TEXT NOT NULL, role TEXT, description TEXT'),
 'office': ('Institutional offices, including episcopal sees.', 'name TEXT NOT NULL, polity_id TEXT REFERENCES polity(id), place_id TEXT REFERENCES place(id), office_type TEXT'),
 'office_tenure': ('A person holding an office; start/end are tenure bounds.', 'person_id TEXT NOT NULL REFERENCES person(id), office_id TEXT NOT NULL REFERENCES office(id), tenure_note TEXT'),
 'polity': ('Peoples, political units and administrative jurisdictions; no territorial polygon is implied.', 'name TEXT NOT NULL, kind TEXT NOT NULL, description TEXT'),
 'polity_period': ('Dated phases of a polity, including creation and reorganisation.', 'polity_id TEXT NOT NULL REFERENCES polity(id), description TEXT NOT NULL'),
 'ruler_of': ('Sourced reign claims, including overlapping or rival reigns.', 'person_id TEXT NOT NULL REFERENCES person(id), polity_id TEXT NOT NULL REFERENCES polity(id), title TEXT NOT NULL, tenure_note TEXT'),
 'event': ('Dated events; start is the bounded occurrence, end is only supplied for an actual duration.', 'name TEXT NOT NULL, event_type TEXT NOT NULL, place_id TEXT REFERENCES place(id), description TEXT, outcome TEXT, consequences TEXT, campaign_id TEXT REFERENCES campaign(id)'),
 'battle': ('Battle detail linked to an event; site security is distinct from whether the battle happened.', "event_id TEXT NOT NULL REFERENCES event(id), site_security TEXT NOT NULL CHECK(site_security IN ('secure','approximate','disputed','unknown')), site_note TEXT, outcome TEXT, primary_sources TEXT"),
 'battle_party': ('One belligerent/commander assertion per row; sides are source-specific labels.', 'event_id TEXT NOT NULL REFERENCES event(id), side TEXT NOT NULL, polity_id TEXT REFERENCES polity(id), commander_id TEXT REFERENCES person(id), description TEXT'),
 'battle_number': ('Source-specific numerical claims, not consensus totals; null is not zero.', "event_id TEXT NOT NULL REFERENCES event(id), side TEXT NOT NULL, quantity_type TEXT NOT NULL CHECK(quantity_type IN ('strength','casualties','killed','captured')), min_value REAL, max_value REAL, unit TEXT NOT NULL, number_basis TEXT NOT NULL, reliability TEXT NOT NULL CHECK(reliability IN ('high','medium','low','unknown')), CHECK(min_value IS NULL OR min_value>=0), CHECK(max_value IS NULL OR max_value>=min_value)"),
 'campaign': ('Campaigns and movements, including epidemic spread; paths are not automatically known.', 'name TEXT NOT NULL, description TEXT, movement_type TEXT'),
 'waypoint': ('Ordered, dated stops. Connecting lines must not be treated as attested tracks.', "campaign_id TEXT NOT NULL REFERENCES campaign(id), sequence INTEGER NOT NULL, place_id TEXT REFERENCES place(id), event_id TEXT REFERENCES event(id), action TEXT NOT NULL, path_certainty TEXT NOT NULL CHECK(path_certainty IN ('attested_stop','inferred_link','unlocated')), interpolation_note TEXT, UNIQUE(campaign_id,sequence)"),
 'structure': ('Physical buildings or works linked to a place; construction details are separate phases.', 'name TEXT NOT NULL, place_id TEXT NOT NULL REFERENCES place(id), structure_type TEXT NOT NULL, description TEXT'),
 'structure_phase': ('Construction, alteration, use and destruction assertions; dimensions belong only to this phase.', 'structure_id TEXT NOT NULL REFERENCES structure(id), phase_type TEXT NOT NULL, description TEXT NOT NULL, material TEXT, length_m REAL, width_m REAL, height_m REAL, builder_id TEXT REFERENCES person(id), event_id TEXT REFERENCES event(id)'),
 'route': ('Historical route identity, with explicit geometry status; ordered nodes are not a surveyed polyline.', 'name TEXT NOT NULL, route_type TEXT NOT NULL, description TEXT, geometry_status TEXT NOT NULL'),
 'route_node': ('Ordered source-supported route nodes.', 'route_id TEXT NOT NULL REFERENCES route(id), sequence INTEGER NOT NULL, place_id TEXT NOT NULL REFERENCES place(id), node_note TEXT, UNIQUE(route_id,sequence)'),
 'timeline_series': ('Quantitative series definition and methodology; incompatible estimates stay separate.', 'name TEXT NOT NULL, measure TEXT NOT NULL, unit TEXT NOT NULL, geographic_scope TEXT NOT NULL, methodology TEXT NOT NULL'),
 'timeline_value': ('Dated quantitative observation/estimate; ranges are bounds, not statistical intervals unless stated.', 'series_id TEXT NOT NULL REFERENCES timeline_series(id), value_min REAL, value_max REAL, value_text TEXT, basis TEXT NOT NULL, place_id TEXT REFERENCES place(id), CHECK(value_min IS NULL OR value_max IS NULL OR value_max>=value_min)'),
 'dispute': ('Explicit disagreement or interpretive uncertainty. Competing claim rows share dispute_id.', "topic TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('unresolved','scholarly_disagreement','chronological_uncertainty','interpretive'))"),
 'claim': ('A source-specific assertion about any registered entity, including competing scholarly claims.', 'subject_id TEXT NOT NULL REFERENCES entity(id), predicate TEXT NOT NULL, value_text TEXT NOT NULL'),
 'relation': ('Typed directed link between any two entities; identity links do not erase conflicting claims.', 'subject_id TEXT NOT NULL REFERENCES entity(id), predicate TEXT NOT NULL, object_id TEXT NOT NULL REFERENCES entity(id), description TEXT'),
 'app_link': ('Comparison to a frozen JSON pointer; corrections, refinements and omissions are explicitly distinguished.', "entity_id TEXT NOT NULL REFERENCES entity(id), app_file TEXT NOT NULL, app_id TEXT NOT NULL, json_pointer TEXT, comparison_type TEXT NOT NULL CHECK(comparison_type IN ('correction','uncertainty','refinement','omission','agreement')), app_claim TEXT NOT NULL, research_claim TEXT NOT NULL, importance INTEGER NOT NULL CHECK(importance BETWEEN 1 AND 5)"),
 'todo': ('Research leads, outstanding verification and coverage gaps; these are not established historical facts.', "topic TEXT NOT NULL, task TEXT NOT NULL, priority INTEGER NOT NULL CHECK(priority BETWEEN 1 AND 5), status TEXT NOT NULL CHECK(status IN ('open','blocked','done')), reason TEXT, lead_url TEXT, entity_id TEXT REFERENCES entity(id)"),
}

def schema_text():
    sql = '''-- England and Wales historical knowledge base. Generated by scripts/build.py.
-- Signed historical years omit zero. Astronomical year = historical+1 for BCE.
-- SQLite 3.31+ is required for generated columns. Foreign keys must be enabled.
PRAGMA foreign_keys=ON;
-- Source catalogue: fetched URL or precise bibliography explicitly not fetched.
CREATE TABLE IF NOT EXISTS source (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, publisher TEXT NOT NULL, author TEXT,
 url TEXT, bibliographic_ref TEXT, access_status TEXT NOT NULL CHECK(access_status IN ('fetched','not_fetched')),
 checked_on TEXT NOT NULL, source_type TEXT NOT NULL, lead_only INTEGER NOT NULL DEFAULT 0 CHECK(lead_only IN (0,1)), notes TEXT,
 CHECK((access_status='fetched' AND url IS NOT NULL) OR (access_status='not_fetched' AND length(bibliographic_ref)>0))
);
-- Global entity registry allows referentially checked generic relations/citations.
CREATE TABLE IF NOT EXISTS entity (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, packet TEXT NOT NULL);
-- Date evidence: earliest/latest bound the same uncertain instant, not a duration.
CREATE TABLE IF NOT EXISTS date_span (
 id TEXT PRIMARY KEY REFERENCES entity(id), earliest_year INTEGER NOT NULL CHECK(earliest_year<>0 AND earliest_year BETWEEN -4000 AND 1625),
 latest_year INTEGER NOT NULL CHECK(latest_year<>0 AND latest_year BETWEEN -4000 AND 1625 AND latest_year>=earliest_year),
 earliest_astronomical INTEGER GENERATED ALWAYS AS (CASE WHEN earliest_year<0 THEN earliest_year+1 ELSE earliest_year END) STORED,
 latest_astronomical INTEGER GENERATED ALWAYS AS (CASE WHEN latest_year<0 THEN latest_year+1 ELSE latest_year END) STORED,
 month INTEGER CHECK(month BETWEEN 1 AND 12), day INTEGER CHECK(day BETWEEN 1 AND 31),
 circa INTEGER NOT NULL CHECK(circa IN (0,1)), calendar TEXT NOT NULL, precision TEXT NOT NULL,
 qualifier TEXT NOT NULL DEFAULT 'at' CHECK(qualifier IN ('at','circa','between','by','before','after')), notes TEXT,
 source_id TEXT NOT NULL REFERENCES source(id), checked_on TEXT NOT NULL,
 confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low')),
 evidence_class TEXT NOT NULL CHECK(evidence_class IN (EVIDENCE)),
 CHECK(day IS NULL OR month IS NOT NULL), CHECK(month IS NULL OR earliest_year=latest_year)
);
'''.replace('EVIDENCE',EVIDENCE)
    common = f'''id TEXT PRIMARY KEY REFERENCES entity(id),
 source_id TEXT NOT NULL REFERENCES source(id), checked_on TEXT NOT NULL,
 confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low')),
 evidence_class TEXT NOT NULL CHECK(evidence_class IN ({EVIDENCE})),
 notes TEXT, dispute_id TEXT REFERENCES dispute(id),
 start_date_id TEXT REFERENCES date_span(id), end_date_id TEXT REFERENCES date_span(id),'''
    for name, (doc, cols) in TABLES.items():
        sql += f'\n-- {doc}\nCREATE TABLE IF NOT EXISTS {name} (\n {common}\n {cols}\n);\n'
        sql += f'CREATE INDEX IF NOT EXISTS ix_{name}_source ON {name}(source_id);\n'
    sql += '''
-- Citation for any fact/date entity; locator and role identify the exact support.
CREATE TABLE IF NOT EXISTS citation (
 id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entity(id), source_id TEXT NOT NULL REFERENCES source(id),
 locator TEXT, citation_role TEXT NOT NULL, checked_on TEXT NOT NULL,
 UNIQUE(entity_id,source_id,citation_role)
);
CREATE INDEX IF NOT EXISTS ix_citation_entity ON citation(entity_id);
CREATE INDEX IF NOT EXISTS ix_event_type ON event(event_type);
CREATE INDEX IF NOT EXISTS ix_waypoint_campaign ON waypoint(campaign_id,sequence);
CREATE INDEX IF NOT EXISTS ix_place_location ON place(lat,lon);
CREATE INDEX IF NOT EXISTS ix_app_comparison ON app_link(comparison_type,importance);
-- Reproducibility ledger. Hashes are of the exact packet bytes loaded.
CREATE TABLE IF NOT EXISTS loaded_packet (path TEXT PRIMARY KEY, sha256 TEXT NOT NULL, record_count INTEGER NOT NULL);
-- App-friendly views keep date uncertainty and position quality visible.
CREATE VIEW IF NOT EXISTS event_timeline AS
 SELECT e.*,d.earliest_year,d.latest_year,d.earliest_astronomical,d.latest_astronomical,d.month,d.day,d.circa,d.calendar,d.qualifier,
 p.lat,p.lon,p.uncertainty_m,p.position_method FROM event e LEFT JOIN date_span d ON d.id=e.start_date_id LEFT JOIN place p ON p.id=e.place_id;
CREATE VIEW IF NOT EXISTS movement_timeline AS
 SELECT w.*,d.earliest_year,d.latest_year,d.month,d.day,d.circa,d.qualifier,p.name AS place_name,p.lat,p.lon,p.uncertainty_m,p.position_method
 FROM waypoint w LEFT JOIN date_span d ON d.id=w.start_date_id LEFT JOIN place p ON p.id=w.place_id;
CREATE VIEW IF NOT EXISTS app_disagreements AS
 SELECT a.*,s.title AS source_title,s.publisher,s.url,s.access_status FROM app_link a JOIN source s ON s.id=a.source_id
 WHERE a.comparison_type IN ('correction','uncertainty','refinement');
CREATE VIEW IF NOT EXISTS market_borough_by_1300 AS
 SELECT p.id AS place_id,p.name,p.country,p.lat,p.lon,p.uncertainty_m,ph.id AS assertion_id,ph.phase_type,
 d.earliest_year,d.latest_year,d.month,d.day,d.circa,d.qualifier,ph.source_id,ph.confidence,ph.evidence_class,
 CASE WHEN instr(COALESCE(ph.notes,''),'SOURCE QUALIFICATION PRESENT')>0 THEN 1 ELSE 0 END AS qualification_review_required
 FROM place p JOIN place_phase ph ON ph.place_id=p.id JOIN date_span d ON d.id=ph.start_date_id
 WHERE ph.source_id LIKE 'x-ihr-%' AND (ph.phase_type LIKE 'market_%' OR ph.phase_type='borough_attestation') AND d.latest_year<=1300;
CREATE VIEW IF NOT EXISTS place_timeline AS
 SELECT ph.*,p.name,p.lat,p.lon,p.uncertainty_m,p.position_method,d.earliest_year,d.latest_year,d.circa,d.qualifier
 FROM place_phase ph JOIN place p ON p.id=ph.place_id LEFT JOIN date_span d ON d.id=ph.start_date_id;
'''
    parts=[f"SELECT id,'{t}' AS entity_type,source_id,checked_on,confidence,evidence_class,start_date_id,end_date_id,dispute_id,notes FROM {t}" for t in TABLES]
    parts.append("SELECT id,'date_span',source_id,checked_on,confidence,evidence_class,id,NULL,NULL,notes FROM date_span")
    sql+='\n-- Unified provenance view across every typed fact and date row.\nCREATE VIEW IF NOT EXISTS fact AS\n'+'\nUNION ALL\n'.join(parts)+';\n'
    return sql

def upsert(db, table, data):
    valid = {r[1] for r in db.execute(f'PRAGMA table_info({table})')}
    unknown = set(data)-valid
    if unknown:
        raise ValueError(f'{table}:{data.get("id")} unknown fields: {unknown}')
    cols=list(data)
    key='path' if table=='loaded_packet' else 'id'
    updates=','.join(f'{c}=excluded.{c}' for c in cols if c!=key)
    db.execute(f'INSERT INTO {table} ({",".join(cols)}) VALUES ({",".join("?" for _ in cols)}) ON CONFLICT({key}) DO UPDATE SET {updates}', [data[c] for c in cols])

def add_citation(db, rid, sid, locator, role, checked):
    cid='cite-'+hashlib.sha256(f'{rid}|{sid}|{role}'.encode()).hexdigest()[:24]
    upsert(db,'citation',dict(id=cid,entity_id=rid,source_id=sid,locator=locator,citation_role=role,checked_on=checked))

def parse_date(db, row, value, role, packet):
    d={'year':value} if isinstance(value,int) else dict(value)
    did=f'{row["id"]}-{role}-date'
    if set(d)-{'year','latest_year','month','day','circa','calendar','precision','qualifier','note'}:
        raise ValueError(f'Unknown date fields {did}: {d}')
    upsert(db,'entity',dict(id=did,entity_type='date_span',packet=packet))
    earliest=d['year'];latest=d.get('latest_year',earliest)
    precision=d.get('precision','day' if d.get('day') else 'month' if d.get('month') else 'range' if earliest!=latest else 'year')
    circa=int(d.get('circa',earliest!=latest))
    default_qualifier='by' if role=='start' and row.get('phase_type','').endswith('_by') else 'between' if earliest!=latest else 'circa' if circa else 'at'
    data=dict(id=did,earliest_year=earliest,latest_year=latest,month=d.get('month'),day=d.get('day'),circa=circa,calendar=d.get('calendar','Julian'),precision=precision,qualifier=d.get('qualifier',default_qualifier),notes=d.get('note'))
    data.update({k:row[k] for k in ['source_id','checked_on','confidence','evidence_class']})
    upsert(db,'date_span',data)
    add_citation(db,did,row['source_id'],row.get('locator'),role+' date',row['checked_on'])
    return did

def load_packet(db,path):
    payload=json.loads(path.read_text())
    packet=str(path.relative_to(ROOT))
    ids=[r['id'] for r in payload.get('records',[])]
    if len(ids)!=len(set(ids)):raise ValueError(f'Duplicate entity IDs inside {packet}')
    db.execute('BEGIN')
    db.execute('PRAGMA defer_foreign_keys=ON')
    try:
        for s in payload.get('sources',[]):
            s=dict(s);s.setdefault('checked_on',CHECKED);s.setdefault('lead_only',0)
            upsert(db,'source',s)
        for r in payload.get('records',[]):
            if r['table'] not in TABLES: raise ValueError(f'Unknown table {r["table"]}')
            exists=db.execute('SELECT packet FROM entity WHERE id=?',(r['id'],)).fetchone()
            if exists and exists[0]!=packet: raise ValueError(f'ID collision: {r["id"]}')
            upsert(db,'entity',dict(id=r['id'],entity_type=r['table'],packet=packet))
        for r in payload.get('records',[]):
            row=dict(r);table=row.pop('table')
            sid=row['source_id']
            s=db.execute('SELECT checked_on FROM source WHERE id=?',(sid,)).fetchone()
            if not s: raise ValueError(f'Missing source {sid} for {r["id"]}')
            row.setdefault('checked_on',s[0])
            for field in ['start','end']:
                value=row.pop(field,None)
                row[field+'_date_id']=parse_date(db,row,value,field,packet) if value is not None else None
            locator=row.pop('locator',None)
            additional=row.pop('additional_sources',[])
            if table=='place':
                row.setdefault('position_confidence','low' if row['position_method'] in ('inferred','unlocated') else 'medium')
            upsert(db,table,row)
            add_citation(db,row['id'],sid,locator,'principal',row['checked_on'])
            for other in additional:
                add_citation(db,row['id'],other,locator,'additional',row['checked_on'])
            if table=='place' and row.get('position_source_id'):
                add_citation(db,row['id'],row['position_source_id'],row.get('position_note'),'position',row['checked_on'])
        upsert(db,'loaded_packet',dict(path=packet,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),record_count=len(payload.get('records',[]))))
        db.commit()
    except Exception:
        db.rollback();raise
    print(f'Committed {packet}: {len(payload.get("sources",[]))} sources, {len(payload.get("records",[]))} records')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--fresh',action='store_true',help='Build a replacement offline, then atomically replace england.sqlite after successful validation')
    p.add_argument('--packet',action='append',help='Relative packet path(s); default all packets/*.json')
    args=p.parse_args()
    schema=schema_text();(ROOT/'schema.sql').write_text(schema)
    target=ROOT/('england.next.sqlite' if args.fresh else 'england.sqlite')
    if args.fresh and target.exists(): target.unlink()
    db=sqlite3.connect(target)
    db.executescript(schema)
    if 'qualifier' not in {r[1] for r in db.execute('PRAGMA table_info(date_span)')}:
        db.execute("ALTER TABLE date_span ADD COLUMN qualifier TEXT NOT NULL DEFAULT 'at' CHECK(qualifier IN ('at','circa','between','by','before','after'))")
        db.commit()
    paths=[ROOT/s for s in args.packet] if args.packet else sorted((ROOT/'packets').glob('*.json'))
    for path in paths: load_packet(db,path)
    issues=db.execute('PRAGMA foreign_key_check').fetchall()
    if issues: raise RuntimeError(issues)
    if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise RuntimeError('SQLite integrity check failed')
    with (ROOT/'england.sql').open('w') as out:
        out.write('-- Reproducible England and Wales knowledge base; UTF-8.\nPRAGMA foreign_keys=OFF;\n')
        for line in db.iterdump(): out.write(line+'\n')
        out.write('PRAGMA foreign_keys=ON;\n')
    count=db.execute('SELECT COUNT(*) FROM entity').fetchone()[0]
    db.close()
    if args.fresh: target.replace(ROOT/'england.sqlite')
    print(f'{count} registered fact/date entities; SQLite integrity and foreign keys OK.')

if __name__=='__main__': main()
