#!/usr/bin/env python3
"""Conservative identity-only links, without certifying any app historical claims."""
import collections,json,math,unicodedata,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def norm(s):
    return re.sub(r'[^a-z0-9]','',unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower())
def distance(a,b):
    lat1,lat2=map(math.radians,[a['lat'],b['lat']]);dlat=lat2-lat1;dlon=math.radians(b['lon']-a['lon'])
    return 6371000*2*math.asin(min(1,math.sqrt(math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2)))
def main():
    records=[];research=[];existing=set();sources={}
    for path in sorted((ROOT/'packets').glob('*.json')):
        if path.name=='x-z-links.json':continue
        data=json.loads(path.read_text());sources.update({s['id']:s for s in data['sources']})
        research += [r for r in data['records'] if r['table']=='place']
        existing.update((r['entity_id'],r['app_file'],r['app_id']) for r in data['records'] if r['table']=='app_link')
    clusters=collections.defaultdict(set)
    for file in ['data/national/places.json','data/national/places-wales.json']:
        app=json.loads((ROOT/'inputs/app'/file).read_text())
        for i,a in enumerate(app):
            if a['kind']=='battle':continue  # a town coordinate does not locate its battlefield
            matches=[r for r in research if norm(r['name'])==norm(a['name']) and r['country']==a['country'] and r.get('lat') is not None and distance(r,a)<=2500]
            for r in matches:
                clusters[(file,a['id'])].add(r['id'])
                if (r['id'],file,a['id']) in existing:continue
                records.append(dict(table='app_link',id='x-map-'+r['id']+'-'+a['id'],source_id=r['source_id'],checked_on=r.get('checked_on',sources[r['source_id']]['checked_on']),confidence='medium',evidence_class='reconstructed',entity_id=r['id'],app_file=file,app_id=a['id'],json_pointer='/'+str(i),comparison_type='agreement',app_claim='Named national place '+a['name']+' at the frozen app locality.',research_claim='Identity-only match: normalized name and same-country anchor within 2.5 km. This verifies no app dates, ranks, boundaries or building form.',importance=5,additional_sources=['x-app'],notes='Deterministic linking rule in scripts/link_app.py; inspect before destructive record merging.'))
    for (file,appid),ids in sorted(clusters.items()):
        ids=sorted(ids)
        if len(ids)<2:continue
        root=ids[0]
        for other in ids[1:]:
            records.append(dict(table='relation',id='x-map-relation-'+root+'-'+other,source_id='x-app',checked_on='2026-11-14',confidence='medium',evidence_class='reconstructed',subject_id=root,predicate='corresponds_to_same_app_place',object_id=other,description='Separate research records map to '+file+'#'+appid+'. Preserve claims and uncertainty separately; this is not automatic deduplication.'))
    (ROOT/'packets/x-z-links.json').write_text(json.dumps({'sources':[],'records':records},ensure_ascii=False,indent=2)+'\n')
    print(f'{len(records)} identity links/relations')
if __name__=='__main__':main()
