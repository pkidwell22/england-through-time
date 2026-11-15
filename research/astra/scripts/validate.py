#!/usr/bin/env python3
"""Validate provenance, temporal semantics, references and offline reproducibility."""
import collections,hashlib,json,sqlite3,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from build import TABLES

def main():
    db=sqlite3.connect(ROOT/'england.sqlite');db.row_factory=sqlite3.Row
    errors=[];warnings=[];checks=[]
    def check(label,condition,detail=''):
        (checks if condition else errors).append(label+(': '+str(detail) if detail else ''))
    check('SQLite integrity',db.execute('PRAGMA integrity_check').fetchone()[0]=='ok')
    check('Foreign keys',not db.execute('PRAGMA foreign_key_check').fetchall())
    count={r[0]:db.execute('SELECT COUNT(*) FROM "'+r[0]+'"').fetchone()[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")}
    check('Registry row count',count['entity']==sum(count[t] for t in TABLES)+count['date_span'])
    uncited=db.execute('SELECT id FROM entity e WHERE NOT EXISTS(SELECT 1 FROM citation c WHERE c.entity_id=e.id)').fetchall()
    check('Every fact/date entity cited',not uncited,[r[0] for r in uncited[:10]])
    for table in list(TABLES)+['date_span']:
        bad=db.execute(f"SELECT id FROM {table} WHERE source_id IS NULL OR checked_on IS NULL OR confidence IS NULL OR evidence_class IS NULL").fetchall()
        check(table+' provenance',not bad)
        wrong=db.execute(f"SELECT t.id FROM {table} t JOIN entity e ON e.id=t.id WHERE e.entity_type<>?",(table,)).fetchall()
        check(table+' registry types',not wrong)
    for r in db.execute('SELECT * FROM date_span'):
        y=r['earliest_year'];z=r['latest_year']
        if y==0 or z==0 or y>z or y < -4000 or z>1625:errors.append('Invalid date '+r['id'])
        if r['earliest_astronomical']!=(y+1 if y<0 else y) or r['latest_astronomical']!=(z+1 if z<0 else z):errors.append('Bad astronomical conversion '+r['id'])
        if r['day']:
            leap=(y+1 if y<0 else y)%4==0
            days=[31,29 if leap else 28,31,30,31,30,31,31,30,31,30,31]
            if not r['month'] or r['day']>days[r['month']-1]:errors.append('Invalid Julian month/day '+r['id'])
            if r['calendar']!='Julian':warnings.append('Non-Julian day-level date '+r['id']+' '+r['calendar'])
        if r['qualifier'] not in ['at','circa','between','by','before','after']:errors.append('Unknown temporal qualifier '+r['id'])
    checks.append('Historical/astronomical dates and Julian day validity checked for every date')
    for table in TABLES:
        wrong=db.execute(f'SELECT t.id FROM {table} t JOIN date_span s ON s.id=t.start_date_id JOIN date_span e ON e.id=t.end_date_id WHERE e.latest_astronomical<s.earliest_astronomical').fetchall()
        if wrong:errors.append('Reversed intervals '+table+': '+repr([r[0] for r in wrong]))
    checks.append('All start/end durations checked')
    for r in db.execute('SELECT * FROM place'):
        if r['lat'] is not None:
            if r['position_source_id'] is None or r['uncertainty_m'] is None or r['uncertainty_m']<0:errors.append('Unprovenanced position '+r['id'])
            if r['country'] in ['england','wales'] and not (49.5<=r['lat']<=56.5 and -7<=r['lon']<=3):warnings.append('Coordinate outside broad England/Wales envelope '+r['id'])
        elif r['position_method']!='unlocated':errors.append('Null location not explicit '+r['id'])
    checks.append('Every coordinate has method, source and uncertainty radius; null sites explicit')
    for r in db.execute('SELECT * FROM source'):
        if r['access_status']=='not_fetched' and not r['bibliographic_ref']:errors.append('Missing bibliography '+r['id'])
        if r['access_status']=='fetched' and not r['url']:errors.append('Missing fetched URL '+r['id'])
    checks.append('Source access-status and bibliography requirements')
    check('Lead-only sources are not historical authorities',db.execute("SELECT COUNT(*) FROM fact f JOIN source s ON s.id=f.source_id WHERE s.lead_only=1 AND f.entity_type<>'todo'").fetchone()[0]==0)
    for r in db.execute('SELECT * FROM app_link'):
        path=ROOT/'inputs/app'/r['app_file']
        if not path.exists():errors.append('Missing app snapshot '+r['id']);continue
        data=json.loads(path.read_text());node=data
        try:
            for part in (r['json_pointer'] or '').split('/')[1:]:
                key=part.replace('~1','/').replace('~0','~');node=node[int(key)] if isinstance(node,list) else node[key]
        except (KeyError,ValueError,IndexError,TypeError):errors.append('Invalid app pointer '+r['id']);continue
        parts=(r['json_pointer'] or '').split('/')[1:]
        if isinstance(data,list) and parts and parts[0].isdigit():
            root=data[int(parts[0])]
            possible={str(root.get(k)) for k in ['id','label','year'] if root.get(k) is not None}
            if possible and r['app_id'] not in possible:errors.append('App ID/pointer mismatch '+r['id']+' '+str(possible))
    checks.append('Every application pointer and available app ID checked against frozen baseline')
    for r in db.execute('SELECT * FROM loaded_packet'):
        check('Packet hash '+r['path'],hashlib.sha256((ROOT/r['path']).read_bytes()).hexdigest()==r['sha256'])
    # Assert the concrete regressions found in independent review.
    def value(sql,args=()):
        r=db.execute(sql,args).fetchone();return r[0] if r else None
    for slug,expected in [('middx-007',11000.0),('cambs-007',466.09)]:
        # London is a stable ID; Cambridge is selected by name below instead of
        # assuming a positional ID if its county table gains an entry.
        if slug.startswith('middx'):
            check('London subsidy recovered',value('SELECT value_min FROM timeline_value WHERE id=?',('x-market-'+slug+'-1334',))==expected)
    for name,expected in [('Cambridge',466.09),('Oxford',913.92),('Banbury',266.63)]:
        got=value('SELECT t.value_min FROM timeline_value t JOIN place p ON p.id=t.place_id WHERE p.name=? AND t.series_id=?',(name,'x-ihr-subsidy-series'))
        check(name+' subsidy',got==expected,got)
    check('London early-market TODO retained',value("SELECT COUNT(*) FROM todo WHERE entity_id='x-market-middx-007' AND topic='Undated or complex market attestation'")==1)
    check('Barham operational qualification retained',value("SELECT COUNT(*) FROM todo WHERE entity_id='x-market-cambs-004' AND topic='Qualified market history'")==1)
    check('Winchester circa 900',db.execute("SELECT d.earliest_year,d.circa FROM place_phase p JOIN place x ON x.id=p.place_id JOIN date_span d ON d.id=p.start_date_id WHERE x.name='Winchester' AND p.id LIKE 'x-market-%-market-%'").fetchone()[:] == (900,1))
    check('No automatically assigned market weekdays',value("SELECT COUNT(*) FROM place_phase WHERE id LIKE 'x-market-%' AND description LIKE '%Weekday:%'")==0)
    check('Famine pointer fixed',value("SELECT json_pointer FROM app_link WHERE id='x-famine-link'")=='/56')
    check('London plague retains by qualifier',value("SELECT d.qualifier FROM event e JOIN date_span d ON d.id=e.start_date_id WHERE e.id='x-black-death-london'")=='by')
    check('Oxford college aggregate has an end',value("SELECT end_date_id IS NOT NULL FROM event WHERE id='x-oxford-colleges'")==1)
    check('Early-1620s title avoids false duration',value("SELECT name FROM event WHERE id='x-famine-1620s'")=='Regional famine in the early 1620s')
    check('Climate has two cells, 1625 years each',value("SELECT COUNT(*) FROM timeline_value WHERE series_id LIKE 'x-owda-%'")==3250)
    # SQL dump restoration is an actual second database, not just SQL syntax.
    restored=sqlite3.connect(':memory:')
    restored.executescript((ROOT/'england.sql').read_text())
    check('SQL dump restores integrity',restored.execute('PRAGMA integrity_check').fetchone()[0]=='ok')
    check('SQL dump restores foreign keys',not restored.execute('PRAGMA foreign_key_check').fetchall())
    def digest(c,t):
        h=hashlib.sha256()
        for r in c.execute('SELECT * FROM "'+t+'" ORDER BY 1'):
            h.update(json.dumps(list(r),ensure_ascii=False,separators=(',',':')).encode());h.update(b'\n')
        return h.hexdigest()
    differing=[t for t in count if digest(db,t)!=digest(restored,t)]
    check('SQL dump restores every row and value',not differing,differing)
    # Exercise the historical boundary and rejection constraint in the restored
    # in-memory database only. No fixture rows enter the delivered database.
    sid=restored.execute('SELECT id FROM source ORDER BY id LIMIT 1').fetchone()[0]
    for suffix,year,expected in [('bce',-1,0),('ce',1,1)]:
        rid='validation-boundary-'+suffix
        restored.execute('INSERT INTO entity VALUES (?,?,?)',(rid,'date_span','validation-only'))
        restored.execute('INSERT INTO date_span(id,earliest_year,latest_year,circa,calendar,precision,qualifier,source_id,checked_on,confidence,evidence_class) VALUES (?,?,?,0,?,?,?,?,?,?,?)',(rid,year,year,'Julian','year','at',sid,'2026-11-14','high','attested-documentary'))
        check('Calendar boundary '+suffix,restored.execute('SELECT earliest_astronomical FROM date_span WHERE id=?',(rid,)).fetchone()[0]==expected)
    rejected=False
    try:
        restored.execute("UPDATE date_span SET earliest_year=0,latest_year=0 WHERE id='validation-boundary-bce'")
    except sqlite3.IntegrityError:rejected=True
    check('Historical year zero rejected by schema',rejected)
    restored.close()
    stats={'counts':count,'date_range':dict(db.execute('SELECT MIN(earliest_year) AS earliest,MAX(latest_year) AS latest FROM date_span').fetchone()),'checks_passed':len(checks),'checks':checks,'errors':errors,'warnings':warnings,'review_scope':'Independent reviewers sampled sources and found documented issues; whole-database checks establish internal consistency, not independent verification of every historical assertion.'}
    (ROOT/'validation.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'checks_passed':len(checks),'errors':errors,'warnings':warnings,'table_count':len(count),'entity_count':count['entity']},indent=2))
    if errors:sys.exit(1)
if __name__=='__main__':main()
