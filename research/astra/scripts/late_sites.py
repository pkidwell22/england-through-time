#!/usr/bin/env python3
"""Checked coastal artillery forts and a documented planned borough."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sources=[];records=[]
def src(id,title,publisher,url,**kw):
    r=dict(id=id,title=title,publisher=publisher,url=url,access_status='fetched',checked_on='2026-11-14',source_type='institutional');r.update(kw);sources.append(r);return id
def add(table,id,sid,**kw):
    r=dict(table=table,id=id,source_id=sid,checked_on='2026-11-14',confidence='high',evidence_class='attested-documentary');r.update(kw);records.append(r);return id
forts=[('deal','Deal Castle','deal-castle/history-stories/history/',51.21943,1.40356,'Deal_Castle',1539,1540),('walmer','Walmer Castle','walmer-castle-and-gardens/history-and-stories/',51.200992,1.402308,'Walmer_Castle',1539,1540),('pendennis','Pendennis Castle','pendennis-castle/history-and-stories/history/',50.14722,-5.04777,'Pendennis_Castle',1539,1545),('st-mawes','St Mawes Castle','st-mawes-castle/history/',50.15486,-5.02377,'St_Mawes_Castle',None,None)]
for slug,name,path,lat,lon,wiki,start,end in forts:
    sid=src('x-fort-source-'+slug,'History of '+name,'English Heritage','https://www.english-heritage.org.uk/visit/places/'+path)
    coords=src('x-fort-coordinates-'+slug,name+': coordinate gazetteer only','Wikipedia contributors','https://en.wikipedia.org/wiki/'+wiki,source_type='gazetteer',lead_only=1,notes='Fetched solely for a provisional coordinate. No historical dates, construction claims or citations are adopted from Wikipedia. Replace with surveyed institutional GIS when available.')
    pid=add('place','x-fort-place-'+slug,sid,name=name,kind='artillery_fort',country='england',lat=lat,lon=lon,uncertainty_m=500,position_method='gazetteer',position_source_id=coords,position_confidence='low',position_note='Wikipedia coordinate only, separately attributed; conservative 500 m site radius, not a surveyed outline.',evidence_class='attested-standing')
    st=add('structure','x-fort-'+slug,sid,name=name,place_id=pid,structure_type='coastal_artillery_fort',description='Henrician coastal defence work.',evidence_class='attested-standing')
    if start:
        add('structure_phase','x-fort-build-'+slug,sid,structure_id=st,phase_type='construction',start=start,end=end,description='Construction interval reported by the institutional history.',confidence='medium',notes='Pendennis interval covers the programme; the same page captions the circular tower as begun about 1540.' if slug=='pendennis' else None)
    else:
        add('structure_phase','x-fort-build-'+slug,sid,structure_id=st,phase_type='construction_attestation',start={'year':1540,'latest_year':1549,'circa':True,'precision':'decade'},description='Built in the 1540s; the source also places the programme after 1539.',confidence='medium',notes='Source gives a decade here, not a precise construction start/end pair.')
add('structure_phase','x-pendennis-bastions','x-fort-source-pendennis',structure_id='x-fort-pendennis',phase_type='enlargement',start=1597,end={'year':1600,'qualifier':'by'},description='Surveyed in 1597; Paul Ive’s enlarged bastioned enclosure existed by 1600.',confidence='high')
add('person','x-paul-ive','x-fort-source-pendennis',name='Paul Ive',role='military engineer')
add('relation','x-paul-ive-pendennis','x-fort-source-pendennis',subject_id='x-paul-ive',predicate='engineered',object_id='x-fort-pendennis',description='Engineer of the enlarged fortress by 1600.')
add('event','x-cornwall-spanish-raid','x-fort-source-st-mawes',name='Spanish raid on west Cornwall',event_type='raid',start=1595,description='Source identifies Penzance, Newlyn, Mousehole and Paul as attacked localities.',confidence='medium',notes='No precise landing point, day or casualty count supplied by the consulted source.')

cw=src('x-conwy-her','Conwy Township, Conwy: Heneb HER GAT3189','Heneb HER Charitable Trust','https://archwilio.org.uk/her/chi3/report/page.php?watprn=GAT3189',notes='Derived from information held by the Heneb HER Charitable Trust copyright. Source permits information/research; written permission required for publication or commercial resources.')
cadw=src('x-conwy-walls','Conwy Town Walls','Cadw','https://cadw.gov.wales/visit/places-to-visit/conwy-town-walls')
# NGR SH782775 is the source's gazetteer anchor. Retain a conservative radius;
# the app anchor below is separately attributed, not represented as a conversion.
app=json.loads((ROOT/'inputs/app/data/national/places-wales.json').read_text());a=next(p for p in app if p['id']=='conwy')
cp=add('place','x-conwy-town',cw,name='Conwy',kind='planned_borough',country='wales',lat=a['lat'],lon=a['lon'],uncertainty_m=1000,position_method='inferred',position_source_id='x-app',position_confidence='low',position_note='Provisional frozen-app town anchor; institutional source independently identifies NGR SH782775 but no transform is claimed here.')
add('event','x-conwy-foundation',cw,name='Edwardian borough laid out at Conwy',event_type='foundation',place_id=cp,start=1283,description='Planned borough reused the former abbey site; the church served the burgesses. Earlier occupation is not denied.')
add('event','x-conwy-charter',cw,name='Conwy borough charter',event_type='charter',place_id=cp,start=1284)
wall=add('structure','x-conwy-walls-structure',cadw,name='Conwy town walls',place_id=cp,structure_type='town_wall',description='Surviving circuit with 21 towers and three original gateways.',evidence_class='attested-standing')
add('structure_phase','x-conwy-walls-construction',cw,structure_id=wall,phase_type='construction',start=1283,end={'year':1287,'qualifier':'by'},description='Town and castle works virtually complete by 1287.',length_m=1280,confidence='medium',notes='Circuit length is the HER’s value. Cadw’s three-quarter-mile description is approximate; neither gives an exact surveyed historical boundary.')
for slug,measure,unit in [('burgages','occupied or recorded burgage plots','plots'),('burgesses','recorded burgesses','persons (legal status)')]:
    add('timeline_series','x-conwy-'+slug,cw,name='Conwy '+slug,measure=measure,unit=unit,geographic_scope='Conwy borough',methodology='HER documentary summary. Burgages and legally recognized burgesses are not total population.')
for year,plots in [(1295,112),(1312,124)]:
    add('timeline_value','x-conwy-burgages-'+str(year),cw,series_id='x-conwy-burgages',start=year,place_id=cp,value_min=plots,value_max=plots,basis='Documentary count summarized in HER GAT3189; no population multiplier.')
add('timeline_value','x-conwy-burgesses-1295',cw,series_id='x-conwy-burgesses',start=1295,place_id=cp,value_min=99,value_max=99,basis='99 burgesses held 112 burgages; not 99 total inhabitants.')
(ROOT/'packets/x-late-sites.json').write_text(json.dumps({'sources':sources,'records':records},ensure_ascii=False,indent=2)+'\n')
print(f'{len(sources)} sources, {len(records)} records')
