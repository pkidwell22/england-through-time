#!/usr/bin/env python3
"""Checked quantitative tables and two early-Neolithic anchors; offline packet."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sources=[];records=[]
def src(id,title,publisher,url,**kw):
    r=dict(id=id,title=title,publisher=publisher,url=url,access_status='fetched',checked_on='2026-11-14',source_type='scholarly');r.update(kw);sources.append(r);return id
def add(table,id,sid,**kw):
    r=dict(table=table,id=id,source_id=sid,checked_on='2026-11-14',confidence='medium',evidence_class='reconstructed');r.update(kw);records.append(r);return id
s=src('x-clark-2009','The Macroeconomic Aggregates for England, 1209–2008','University of California Davis; EconStor','https://www.econstor.eu/bitstream/10419/58383/1/612520374.pdf',author='Gregory Clark',bibliographic_ref='UC Davis Economics Working Paper 09-19, revised October 2009; Tables 1, 4, 27 (PDF pp.53–56,74–75).',notes='Original author working paper fetched and relevant tables extracted. Quantities retain this model vintage. Full publication not redistributed. 1200s excluded because the author says evidence represents 1209 alone; 1620s excluded because the decade extends beyond scope.')
add('timeline_series','x-clark-farm-wage',s,name='English nominal farm wages, Clark 2009',measure='farm day wage',unit='pence per day (nominal)',geographic_scope='England',methodology='Table 1 decadal model means, including estimated harvest premium; not real wages or individual observed earnings. Accounting-year allocation follows the author’s convention.')
add('timeline_series','x-clark-cost-living',s,name='English cost-of-living index, Clark 2009',measure='consumer price index',unit='index (1860–69 = 100)',geographic_scope='England',methodology='Table 27 cost-of-living column; weighted historical price reconstruction. The reference period is outside the dataset scope but no observations after 1625 are imported.')
# Year, nominal farm wage, cost-of-living index; exact transcription of table values.
data=[(1210,1.26,7.57),(1220,1.25,8.53),(1230,1.18,8.39),(1240,1.25,8.87),(1250,1.31,9.05),(1260,1.33,9.46),(1270,1.28,11.63),(1280,1.35,10.40),(1290,1.32,11.61),(1300,1.34,11.20),(1310,1.44,14.14),(1320,1.54,12.97),(1330,1.52,11.06),(1340,1.49,10.47),(1350,2.80,13.09),(1360,2.88,13.52),(1370,3.16,13.78),(1380,3.17,11.40),(1390,3.05,11.68),(1400,3.45,12.22),(1410,3.47,12.40),(1420,3.50,11.47),(1430,3.68,12.73),(1440,3.66,11.14),(1450,3.79,11.35),(1460,3.54,11.51),(1470,3.56,11.60),(1480,3.53,12.37),(1490,3.52,11.54),(1500,3.38,11.94),(1510,3.37,12.24),(1520,3.42,14.37),(1530,3.32,15.21),(1540,3.94,17.19),(1550,5.06,26.1),(1560,6.15,27.5),(1570,6.64,30.4),(1580,6.67,34.1),(1590,7.13,43.8),(1600,7.52,45.1),(1610,7.97,51.4)]
for year,wage,price in data:
    for slug,value,table in [('farm-wage',wage,'1'),('cost-living',price,'27')]:
        add('timeline_value',f'x-clark-{slug}-{year}',s,series_id='x-clark-'+slug,start=year,end=year+9,value_min=value,value_max=value,value_text=str(value),basis='Published decadal model point estimate; equal bounds reproduce the table, not zero uncertainty.',locator='Table '+table+', decade '+str(year))
for slug,label in [('2007','Clark 2007a population as tabulated by Clark 2009'),('broadberry2009','Broadberry et al. 2009 population as tabulated by Clark 2009')]:
    add('timeline_series','x-pop-'+slug,s,name=label,measure='population',unit='million persons',geographic_scope='England',methodology='Table 4 comparative model values. Keep distinct from Broadberry et al. 2010 and later revisions; no unlabelled blended curve.')
for year,broad,clark in [(1300,4.25,5.32),(1348,3.83,4.48),(1351,2.56,3.54),(1380,2.37,2.98),(1520,2.20,2.87),(1600,4.12,4.28)]:
    did=add('dispute','x-pop-dispute-'+str(year),s,topic='Population estimates for England in '+str(year),description='Different reconstruction methods and model vintages yield different absolute levels.',status='scholarly_disagreement')
    for slug,value in [('2007',clark),('broadberry2009',broad)]:
        add('timeline_value',f'x-pop-{slug}-{year}',s,series_id='x-pop-'+slug,start=year,value_min=value,value_max=value,value_text=str(value)+' million',basis='Comparative Table 4, PDF p.56; named model, not a census.',dispute_id=did,locator='Table 4')
        add('claim',f'x-pop-{slug}-{year}-claim',s,subject_id='x-pop-'+slug,predicate='population_at_'+str(year),value_text=str(value)+' million according to this model vintage.',dispute_id=did,locator='Table 4')
    if year in [1300,1348,1351,1600]:
        val={1300:4.73,1348:4.81,1351:2.60,1600:4.11}[year]
        add('claim',f'x-pop-broadberry2010-{year}-claim','x-broadberry-2010',subject_id='x-population-2010',predicate='population_at_'+str(year),value_text=str(val)+' million in the later 2010 working-paper model; distinct revision, not the 2009 value.',dispute_id=did,locator='Table 16A')

eh=src('x-neolithic-overview','Introduction to Prehistoric England','English Heritage','https://www.english-heritage.org.uk/learn/story-of-england/prehistory/introduction/',source_type='institutional')
add('event','x-farming-introduction',eh,name='Farming introduced to Britain',event_type='agricultural_change',start={'year':-4000,'circa':True},description='Conventional approximate date for the Neolithic transition; regional histories differ.',notes='This rounded scope-opening anchor does not imply simultaneous adoption everywhere.',evidence_class='attested-excavated')
st=src('x-sweet-track-source','The Sweet Track and Climate Change','Historic England','https://historicengland.org.uk/whats-new/research/back-issues/the-sweet-track-and-climate-change/',source_type='institutional',notes='Dendrochronological account citing Hillam et al. (1990). The measured felling window and later repairs are separate assertions.')
sp=add('place','x-sweet-track-place',st,name='Sweet Track, Somerset Levels',kind='trackway',country='england',lat=None,lon=None,uncertainty_m=None,position_method='unlocated',position_source_id=None,position_note='Named wetland locality; no site grid extracted from this article.',evidence_class='attested-excavated')
ss=add('structure','x-sweet-track',st,name='Sweet Track',place_id=sp,structure_type='timber_trackway',evidence_class='attested-excavated')
add('structure_phase','x-sweet-track-felling',st,structure_id=ss,phase_type='timber_felling',start={'year':-3807,'latest_year':-3806,'circa':False,'precision':'season'},description='Timbers felled in winter 3807/3806 BCE or early spring 3806 BCE.',material='oak and ash',evidence_class='attested-excavated',confidence='high',notes='Felling is the dendrochronologically measured event; construction closely associated but not an invented exact day.')
add('structure_phase','x-sweet-track-repairs',st,structure_id=ss,phase_type='repair_attestation',start=-3800,description='Repairs continued at least to 3800 BCE.',evidence_class='attested-excavated',confidence='high')
(ROOT/'packets/x-quantitative.json').write_text(json.dumps({'sources':sources,'records':records},ensure_ascii=False,indent=2)+'\n')
print(f'{len(sources)} sources; {len(records)} records')
