#!/usr/bin/env python3
"""Extract two explicitly local OWDA cells; never present them as national means."""
import argparse,datetime,hashlib,json,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BASE='https://www.ncei.noaa.gov/pub/data/paleo/treering/reconstructions/europe/'
def read(name):
    with urllib.request.urlopen(BASE+name,timeout=45) as r:return r.read()
def main():
    p=argparse.ArgumentParser();p.add_argument('--refresh',action='store_true');args=p.parse_args()
    saved=ROOT/'inputs/owda-two-cells.json'
    if args.refresh or not saved.exists():
        xy=read('owda-xy.txt');readme=read('owda-readme.txt')
        coords=[tuple(map(float,line.split()[:2])) for line in xy.decode().splitlines() if line.strip()]
        wanted=[(-0.25,51.75),(-3.75,52.25)]
        indices=[coords.index(v) for v in wanted]
        h=hashlib.sha256();values=[];rows=0;missing=0
        with urllib.request.urlopen(BASE+'owda.txt',timeout=60) as response:
            for i,line in enumerate(response):
                h.update(line);cols=line.split()
                if i==0:
                    assert cols[0]==b'year__#' and len(cols)==len(coords)+1
                    continue
                if not cols:continue
                assert len(cols)==len(coords)+1,(i,len(cols))
                year=int(cols[0]);rows+=1
                # The archive has a year 0 labelled AD. Exclude it rather than
                # silently choosing a historical interpretation at this boundary.
                if not 1<=year<=1625:continue
                vs=[float(cols[k+1]) for k in indices]
                if any(abs(v)>50 for v in vs):missing+=1;continue
                values.append([year]+vs)
        data=dict(source=BASE+'owda.txt',checked_on=datetime.date.today().isoformat(),sha256=h.hexdigest(),xy_sha256=hashlib.sha256(xy).hexdigest(),readme_sha256=hashlib.sha256(readme).hexdigest(),total_rows=rows,grid_count=len(coords),selected=[{'column':k+1,'lon':v[0],'lat':v[1]} for k,v in zip(indices,wanted)],missing_years=missing,values=values)
        saved.write_text(json.dumps(data,indent=2)+'\n')
    else:data=json.loads(saved.read_text())
    sources=[];records=[];checked=data['checked_on']
    for key,tail,title in [('data','owda.txt','Old World Drought Atlas: annual gridded scPDSI'),('grid','owda-xy.txt','Old World Drought Atlas: grid coordinates'),('method','owda-readme.txt','Old World Drought Atlas: data documentation')]:
        sources.append(dict(id='x-owda-'+key,title=title,publisher='NOAA NCEI / World Data Service for Paleoclimatology',author='Edward R. Cook et al.',url=BASE+tail,access_status='fetched',checked_on=checked,source_type='scholarly',bibliographic_ref='Cook et al. (2015), Old World megadroughts and pluvials during the Common Era, Science Advances 1(10), e1500561, doi:10.1126/sciadv.1500561',notes='Public scientific archive; cite authors and archive. Data hash and selected column indices in inputs/owda-two-cells.json. Tree-ring reconstruction, not observed daily weather.'))
    def add(table,id,sid,**kw):
        r=dict(table=table,id=id,source_id=sid,checked_on=checked,confidence='medium',evidence_class='reconstructed');r.update(kw);records.append(r)
    for k,(slug,country,label) in enumerate([('england-cell','england','south-east England cell'),('wales-cell','wales','central Wales cell')]):
        cell=data['selected'][k];pid='x-owda-'+slug;sid=pid+'-series'
        add('place',pid,'x-owda-grid',name='OWDA '+label,kind='climate_grid_cell',country=country,lat=cell['lat'],lon=cell['lon'],uncertainty_m=40000,position_method='gazetteer',position_source_id='x-owda-grid',position_confidence='high',position_note='0.5-degree grid cell centre, 40 km conservative footprint radius; no settlement or national boundary implied.',locator='Coordinate row '+str(cell['column']))
        add('timeline_series',sid,'x-owda-method',name='OWDA summer moisture: '+label,measure='self-calibrating Palmer Drought Severity Index',unit='scPDSI (dimensionless)',geographic_scope=f'One 0.5-degree cell centred {cell["lat"]} N, {cell["lon"]} E',methodology='Annual summer tree-ring reconstructed wetness/dryness. Raw source columns matched to coordinate-file row order, validated header width. Local cell only; no national mean, rainfall millimetres, probability interval or day-specific weather. Year 0 omitted; 1–1625 CE retained.')
        for row in data['values']:
            year=row[0];v=row[k+1]
            add('timeline_value',f'{pid}-{year:04d}','x-owda-data',series_id=sid,place_id=pid,start={'year':year,'calendar':'CE annual summer; no day conversion','precision':'year','circa':False},value_min=v,value_max=v,value_text=str(v),basis='Published reconstructed point estimate; equal bounds do not mean zero uncertainty.',locator=f'Year {year}, column {cell["column"]}',additional_sources=['x-owda-grid','x-owda-method'])
    add('todo','x-owda-regional-coverage','x-owda-method',topic='Climate regional aggregation',task='Extract all England/Wales cells with a documented land mask, area weights and reconstruction skill metrics before presenting a national climate series.',priority=2,status='open',reason='Two local cells establish reproducible wiring and temporal coverage; they are not a complete national climate history.',lead_url='https://www.ncei.noaa.gov/access/paleo-search/study/19419')
    dest=ROOT/'packets/x-climate.json';dest.write_text(json.dumps({'sources':sources,'records':records},indent=2)+'\n')
    print(f'{len(data["values"])} years, {len(records)} records; source grid {data["grid_count"]} cells; omitted missing years {data["missing_years"]}')
if __name__=='__main__':main()
