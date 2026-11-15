#!/usr/bin/env python3
"""Recreate the manually checked London/cross-cutting research packet offline."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sources=[];records=[]
def src(id,title,publisher,url,**kw):
    s=dict(id=id,title=title,publisher=publisher,url=url,access_status='fetched',checked_on='2026-11-14',source_type='institutional');s.update(kw);sources.append(s);return id
def add(table,id,sid,**kw):
    r=dict(table=table,id=id,source_id=sid,checked_on='2026-11-14',confidence='high',evidence_class='attested-documentary');r.update(kw);records.append(r);return id
def approximate(y,latest=None):return dict(year=y,latest_year=y if latest is None else latest,circa=True,calendar='Julian')
def day(y,m,d):return dict(year=y,month=m,day=d,circa=False,calendar='Julian')
app=src('x-app','Frozen London Through Time application baseline','Local project','file:inputs/app/manifest.json',source_type='local_app',bibliographic_ref='inputs/app/manifest.json and its individually hashed JSON files; read 14 November 2026',notes='Only evidence of what the application says. Provisional app coordinates are not historical survey evidence.')
landmarks=json.loads((ROOT/'inputs/app/data/locations/london/landmarks.json').read_text())
national=json.loads((ROOT/'inputs/app/data/national/places.json').read_text())
def place(id,name,sid,app_id=None,kind='other',country='england',grid=None):
    match=next((r for r in landmarks+national if r['id']==app_id),None) if app_id else None
    coords=dict(lat=None,lon=None,uncertainty_m=None,position_method='unlocated',position_source_id=None,position_note='Position not independently georeferenced in this pass.')
    if match:
        coords=dict(lat=match['lat'],lon=match['lon'],uncertainty_m=1000,position_method='inferred',position_source_id=app,position_note='Provisional locality/building anchor copied from frozen app; not independently surveyed. Conservative 1 km radius.',position_confidence='low')
    if grid:
        # Values were transformed with the separately pinned pyproj importer.
        coords.update(grid)
    return add('place',id,sid,name=name,kind=kind,country=country,**coords)
def comparison(id,subject,sid,app_id,app_claim,research_claim,typ='refinement',file='data/locations/london/landmarks.json',pointer=None,importance=2):
    if pointer is None:
        items=json.loads((ROOT/'inputs/app'/file).read_text())
        index=next((i for i,r in enumerate(items) if r.get('id')==app_id),None) if isinstance(items,list) else None
        pointer='/'+str(index) if index is not None else ''
    return add('app_link',id,sid,entity_id=subject,app_file=file,app_id=app_id,json_pointer=pointer,comparison_type=typ,app_claim=app_claim,research_claim=research_claim,importance=importance)

bridge=src('x-london-bridge','London Bridge','London Museum','https://www.londonmuseum.org.uk/collections/london-stories/london-bridge/')
london=place('x-london','London',bridge,'london',kind='city')
lb=place('x-london-bridge-place','Historic London Bridge crossing',bridge,'old-london-bridge',kind='bridge')
ls=add('structure','x-london-bridge',bridge,name='London Bridge',place_id=lb,structure_type='bridge',description='Successive bridges; phase-specific evidence is required.')
add('structure_phase','x-bridge-saxon',bridge,structure_id=ls,phase_type='attested_by',start=1000,description='A new timber crossing existed by this year.',material='timber',confidence='medium',notes='By-date, not an exact construction year.')
add('event','x-bridge-storm',bridge,name='Storm destroys London Bridge',event_type='storm',place_id=lb,start=1091,description='Timber bridge destroyed by a storm.')
add('structure_phase','x-bridge-stone-complete',bridge,structure_id=ls,phase_type='completed',start=1209,description='Stone bridge completed with gates, towers and drawbridge.',material='stone')
add('claim','x-bridge-continuity',bridge,subject_id=ls,predicate='continuity',value_text='The crossing was rebuilt repeatedly; a continuous visible bridge from Roman to Saxon times is not established.',confidence='medium')
comparison('x-bridge-storm-link','x-bridge-storm',bridge,'saxon-bridge','Saxon/Norman timber crossing is represented as a broad phase; no 1091 storm tick appears in London events.','Museum records destruction in the storm of 1091; retain an explicit event and rebuild uncertainty.',typ='omission')

lambeth=src('x-lambeth-he','Lambeth Palace: registered park and garden 1000818','Historic England','https://historicengland.org.uk/listing/the-list/list-entry/1000818')
lp=place('x-lambeth-palace-place','Lambeth Palace',lambeth,'lambeth-palace',kind='palace')
add('place_phase','x-lambeth-occupation',lambeth,place_id=lp,phase_type='occupation',start=1197,description='Archiepiscopal occupation of the site.',locator='Historic development')
lps=add('structure','x-lambeth-palace',lambeth,name='Lambeth Palace',place_id=lp,structure_type='palace',description='Archiepiscopal residential complex.')
add('structure_phase','x-lambeth-compromise',lambeth,structure_id=lps,phase_type='design_change',start=1200,description='Large planned church replaced by a smaller church and accommodation.',locator='Historic development')
add('structure_phase','x-lambeth-hall',lambeth,structure_id=lps,phase_type='attested_by',start={'year':1234,'qualifier':'before'},description='First Great Hall existed before 1234.',notes='1234 is a terminus ante quem, not a build date.',locator='Historic development')
add('structure_phase','x-lambeth-morton',lambeth,structure_id=lps,phase_type='gatehouse_built',start=1490,description='Morton’s Tower gatehouse built.',material='brick',locator='Entrances and approaches')
comparison('x-lambeth-link',lp,lambeth,'lambeth-palace','Begins at 1200; source list empty and dates explicitly unchecked.','Historic England records occupation in 1197, a changed church plan in 1200, hall before 1234 and gatehouse in 1490. Replace the unsourced single build window with these separate states.',importance=1)

berm=src('x-bermondsey','Grange Walk, no 7: Southwark collection GA1262','Southwark Heritage','https://heritage.southwark.gov.uk/objects/3588/grange-walk--no-7-former--abbey-gatehouse')
bp=place('x-bermondsey','Bermondsey Abbey',berm,'bermondsey-abbey',kind='monastery')
add('place_phase','x-bermondsey-founded',berm,place_id=bp,phase_type='foundation',start=1082,description='Alwin Child founded a priory for Cluniac monks.',locator='Object description',confidence='medium')
add('place_phase','x-bermondsey-abbey-status',berm,place_id=bp,phase_type='abbey_status',start=approximate(1375,1400),description='Raised from priory to abbey in the late fourteenth century.',locator='Object description',confidence='medium',notes='Source gives no precise year here; late-century band is an indexing convention, not a measured confidence interval.')
comparison('x-bermondsey-link',bp,berm,'bermondsey-abbey','One priory phase 1082–1538; no fetched sources.','Southwark supplies an institutional source for 1082 and distinguishes later abbey status; it does not independently verify the app’s 1140 construction completion or 1538 demolition.',typ='uncertainty')

wh=src('x-westminster-roof','The hammer-beam roof','UK Parliament','https://www.parliament.uk/about/living-heritage/building/palace/westminsterhall/architecture/the-hammer-beam-roof-/')
wp=place('x-westminster-hall-place','Westminster Hall',wh,'westminster-hall',kind='palace')
ws=add('structure','x-westminster-hall',wh,name='Westminster Hall',place_id=wp,structure_type='hall',description='Royal hall with later medieval roof.',evidence_class='attested-standing')
hy=add('person','x-henry-yevele',wh,name='Henry Yevele',role='master mason')
hh=add('person','x-hugh-herland',wh,name='Hugh Herland',role='master carpenter')
add('structure_phase','x-westminster-roof-phase',wh,structure_id=ws,phase_type='roof_rebuilding',start=1393,end=1401,description='Commission in 1393; finishing stopped in 1401 before every detail was complete.',length_m=73.2,width_m=20.7,material='oak with lead covering',builder_id=hh,locator='Roof dimensions; Lanterns on the roof',notes='Dimensions are the roof dimensions reported by Parliament, not independently measured whole-building dimensions.')
add('relation','x-westminster-mason',wh,subject_id=hy,predicate='mason_for',object_id=ws,description='Masonry and buttress work for the roof project.')
add('structure_phase','x-westminster-lanterns',wh,structure_id=ws,phase_type='lanterns_completed',start={'year':1397,'latest_year':1398,'circa':False},description='Two roof lanterns completed within the source’s 1397–98 date band.')
comparison('x-westminster-roof-link',ws,wh,'westminster-hall','Hammerbeam phase begins in 1393 and immediately uses its finished form; 73 × 20.5 m dimensions were previously secondary-only.','Commissioning in 1393 precedes lantern completion in 1397–98 and unfinished stopping point in 1401. Parliament gives roof dimensions 73.2 × 20.7 m; animate construction rather than instant completion.',typ='refinement',importance=1)

wa=src('x-westminster-abbey-history','History of Westminster Abbey','Westminster Abbey','https://www.westminster-abbey.org/history/history-of-westminster-abbey')
wap=place('x-westminster-abbey-place','Westminster Abbey',wa,'westminster-abbey',kind='monastery')
add('place_phase','x-westminster-960',wa,place_id=wap,phase_type='monastery_foundation',start=approximate(960),description='Benedictine community under Edgar and Dunstan.',confidence='medium')
add('event','x-westminster-1065',wa,name='Consecration of Edward’s Westminster church',event_type='consecration',place_id=wap,start=day(1065,12,28))
add('event','x-westminster-1269',wa,name='Consecration of Henry III’s Westminster church',event_type='consecration',place_id=wap,start=day(1269,10,13),description='Older nave remained attached to the incomplete Gothic work.')
add('event','x-henry-vii-chapel-consecration',wa,name='Consecration of Henry VII’s Lady Chapel',event_type='consecration',place_id=wap,start=day(1516,2,19),notes='Historical day/month as published; January-based year numbering retained, no Gregorian conversion.')
comparison('x-westminster-early-link','x-westminster-960',wa,'westminster-abbey','Visible abbey phases start in 1045 with Edward’s church.','A Benedictine monastery is attested around 960 before Edward’s enlargement; its appearance remains unknown.',typ='omission')
comparison('x-henry-chapel-link','x-henry-vii-chapel-consecration',wa,'henry-vii-chapel','A broad construction phase controls the chapel.','Use the separate consecration on 19 February 1516; consecration and fabric completion need not be the same event.',typ='refinement')

wt=src('x-white-tower','White Tower','Historic Royal Palaces','https://www.hrp.org.uk/tower-of-london/whats-on/white-tower/')
wtp=place('x-white-tower-place','White Tower',wt,'white-tower',kind='castle')
wts=add('structure','x-white-tower',wt,name='White Tower',place_id=wtp,structure_type='keep',evidence_class='attested-standing')
add('structure_phase','x-white-tower-building',wt,structure_id=wts,phase_type='construction',start=approximate(1078),end=approximate(1100),description='Late-eleventh-century keep construction.',material='stone',confidence='medium')
comparison('x-white-tower-link',wts,wt,'white-tower','Single exact start keyframe 1078; explanatory note gives c.1075–81.','HRP dates the building 1078–1100. Treat 1078 as an approximate anchor for a construction interval, not proof of exact first work.',typ='uncertainty',importance=3)

emlot=src('x-emlot','Early Modern London Theatres: project scope and theatre dates','REED, University of Toronto; King’s College London; University of Southampton','https://emlot.org/',source_type='scholarly',notes='Index of later documentary transcriptions, not a complete edition of all original performance records. Dates below are catalogue period anchors, not necessarily exact opening days.')
theatres=[('red-lion','Red Lion',1567,None),('theatre','The Theatre',1576,None),('curtain','Curtain',1577,None),('fortune','Fortune',1600,None),('red-bull','Red Bull',1604,None),('boars-head','Boar’s Head',1602,None),('cockpit','Phoenix or Cockpit',1616,None),('newington-butts','Newington Butts',1570,1579),('rose','Rose',1587,None),('swan','Swan',1595,None),('globe','Globe I',1599,None),('globe-ii','Globe II',1614,None),('hope','Hope',1614,None),('st-pauls-i','St Paul’s theatre I',1575,None),('st-pauls-ii','St Paul’s theatre II',1599,None),('bel-savage','Bel Savage Inn',1575,None),('bell','Bell Inn',1576,None),('blackfriars-i','Blackfriars I',1576,None),('blackfriars-ii','Blackfriars II',1596,None),('bull','Bull Inn',1578,None),('cross-keys','Cross Keys Inn',1578,None),('whitefriars','Whitefriars',1609,None),('porters-hall','Porter’s Hall',1613,None)]
for slug,name,y,latest in theatres:
    aid='globe' if slug=='globe-ii' else 'bear-garden' if slug=='hope' else 'blackfriars' if slug.startswith('blackfriars') else slug
    p=place('x-theatre-'+slug,name,emlot,aid,kind='theatre')
    st=add('structure','x-playhouse-'+slug,emlot,name=name,place_id=p,structure_type='playhouse')
    add('structure_phase','x-playhouse-'+slug+'-attestation',emlot,structure_id=st,phase_type='catalogue_start',start=approximate(y,latest) if latest else y,description='Earliest theatre period indexed by EMLoT.',confidence='medium',notes='Not an exact opening date; inspect the individual documentary records before finer animation.')
globe=src('x-globe','Shakespeare’s Globe Theatre','Shakespeare Birthplace Trust','https://www.shakespeare.org.uk/explore-shakespeare/shakespedia/shakespeares-globe-theatre/')
add('event','x-globe-fire',globe,name='Fire at the first Globe',event_type='fire',place_id='x-theatre-globe',start=day(1613,6,29),description='Stage cannon ignited the thatch during Henry VIII.')
add('structure_phase','x-globe-ii-roof',globe,structure_id='x-playhouse-globe-ii',phase_type='rebuilding',start=1614,description='Rebuilt theatre used a tiled roof.',material='tile',notes='Only the year is normalized here; the page’s February completion claim needs comparison with dated opening records.',confidence='medium')
add('todo','x-globe-opening',globe,topic='Second Globe completion versus opening',task='Compare the Trust’s February 1614 rebuild date with dated performance/opening records and excavated foundations.',priority=2,status='open',reason='Completion, public reopening and first recorded performance are different events.',lead_url='https://emlot.org/',entity_id='x-playhouse-globe-ii')
comparison('x-theatre-gap','x-playhouse-blackfriars-i',emlot,'blackfriars','Converted friary phase highlights a playhouse from 1596.','EMLoT distinguishes a first Blackfriars theatre from 1576 and a second from 1596; one later theatre phase omits the earlier venue.',typ='omission')
comparison('x-globe-date-link','x-globe-fire',globe,'globe','The year-based lifecycle burns the first Globe at the 1613 boundary, despite the note giving 29 June.','Store 29 June 1613 as a Julian day-level event so a future date-aware renderer can keep the theatre before the fire.',typ='refinement')

bh=src('x-banqueting','The story of Banqueting House','Historic Royal Palaces','https://www.hrp.org.uk/banqueting-house/history-and-stories/the-story-of-banqueting-house/')
bhp=place('x-banqueting-place','Banqueting House, Whitehall',bh,'banqueting-house',kind='palace')
bhs=add('structure','x-banqueting',bh,name='Banqueting House',place_id=bhp,structure_type='hall',description='Successive royal entertainment halls.')
add('event','x-banqueting-fire',bh,name='Fire destroys the preceding Banqueting House',event_type='fire',place_id=bhp,start=1619,description='Robert Stickells’s hall burned after scenery caught fire.')
ij=add('person','x-inigo-jones',bh,name='Inigo Jones',role='architect')
add('structure_phase','x-banqueting-jones',bh,structure_id=bhs,phase_type='construction',start=1619,end=1622,description='Jones’s replacement hall completed in 1622.',builder_id=ij,evidence_class='attested-standing')
comparison('x-banqueting-link','x-banqueting-fire',bh,'banqueting-house','The focus is the surviving 1619–22 hall; no named fire event in the London event list.','Link the 1619 predecessor fire to construction of Jones’s replacement.',typ='omission')

ox=src('x-oxford','Our history','University of Oxford','https://www.ox.ac.uk/about/the-university/history')
op=place('x-oxford','Oxford',ox,'oxford',kind='town')
add('event','x-oxford-teaching',ox,name='Teaching attested at Oxford',event_type='education',place_id=op,start=1096,description='Teaching existed in some form; the university has no secure foundation date.')
add('event','x-oxford-paris',ox,name='Paris study ban accelerates Oxford growth',event_type='education',place_id=op,start=1167)
add('event','x-oxford-corporation',ox,name='Oxford masters recognized as a universitas',event_type='charter',place_id=op,start=1231)
add('event','x-oxford-colleges',ox,name='Period of Oxford’s first college foundations',event_type='foundation',place_id=op,start=1249,end=1264,description='Aggregate interval for University, Balliol and Merton; not one event with an uncertain date. Individual foundation chronologies need separate rows.')
comparison('x-oxford-date-link','x-oxford-teaching',ox,'oxford','National place phases use university growth as a status change.','1096 is an attestation of teaching, not a known university foundation; 1167 and 1231 describe distinct institutional changes.',file='data/national/places.json',typ='uncertainty',importance=3)
wc=src('x-winchester-school','Buildings, History and Architecture','Winchester College Heritage','https://www.winchestercollegeheritage.org/buildings-history-architecture/')
wcp=place('x-winchester-school','Winchester College',wc,kind='school')
add('event','x-winchester-school-foundation',wc,name='Foundation of Winchester College',event_type='foundation',place_id=wcp,start=1382,description='Founded by William of Wykeham.')
add('place_phase','x-winchester-school-occupied',wc,place_id=wcp,phase_type='buildings_occupied',start=1394,description='School occupied its surviving historic buildings from 1394.')
et=src('x-eton-school','Our outward facing work','Eton College','https://www.etoncollege.com/about-us/our-outward-facing-work-2/')
ep=place('x-eton-school','Eton College',et,kind='school')
add('event','x-eton-foundation',et,name='Foundation of Eton College',event_type='foundation',place_id=ep,start=1440,description='Founded as an educational charity.')

pop=src('x-broadberry-2010','English Economic Growth, 1270–1700, CAGE Working Paper 21 (2010)','University of Warwick, CAGE / WRAP','https://wrap.warwick.ac.uk/id/eprint/57339/1/WRAP_21.2010_broadberry_complete.pdf',author='Stephen Broadberry, Bruce Campbell, Alexander Klein, Mark Overton and Bas van Leeuwen',source_type='scholarly',bibliographic_ref='2010 working paper, Table 16, printed p.50 (PDF p.52)',notes='Published model vintage retained; do not silently substitute the later 2015 book or treat estimates as censuses.')
ps=add('timeline_series','x-population-2010',pop,name='English population: Broadberry et al. 2010 model',measure='population',unit='million persons',geographic_scope='England',methodology='Table 16 model combining manorial trends and later demographic reconstruction. Equal numeric bounds reproduce the point estimate, not measurement certainty; all observations medium confidence.',confidence='medium',evidence_class='reconstructed')
for y,v in [(1250,4.23),(1290,4.75),(1300,4.73),(1315,4.69),(1348,4.81),(1351,2.60),(1377,2.50),(1400,2.08),(1450,1.90),(1490,2.14),(1560,3.02),(1600,4.11)]:
    add('timeline_value',f'x-population-2010-{y}',pop,series_id=ps,start=y,value_min=v,value_max=v,value_text=f'{v:.2f} million (model estimate)',basis='Table 16A, printed p.50; England, not England and Wales.',confidence='medium',evidence_class='reconstructed',locator='Table 16A')
add('todo','x-population-model-update',pop,topic='Population model vintages and rival estimates',task='Add the final 2015 published series and independently fetched Clark/Hinde/Slavin alternatives, keeping model vintages separate.',priority=1,status='open',reason='Fetched 2010 model is reproducible but not a unique consensus; later revisions must not be mixed into its line.',lead_url='https://wrap.warwick.ac.uk/57339/')

wood=src('x-woodland','Identifying and protecting woodland archaeology','Forestry Commission / GOV.UK','https://www.gov.uk/government/publications/identifying-and-protecting-archaeological-features-in-woodland/identifying-and-protecting-woodland-archaeology',notes='2026 guidance, outline of woodland development; broad England estimates, not a spatial tree-cover dataset. OGL v3 except identified third-party material.')
wsr=add('timeline_series','x-woodland-series',wood,name='Indicative English woodland cover',measure='woodland or wood-pasture share',unit='percent land area',geographic_scope='England',methodology='Broad historical synthesis; archaeological/documentary estimates with changing definitions, not a complete annual series or Welsh estimate.',evidence_class='reconstructed',confidence='medium')
for slug,y,last,v1,v2,n in [('roman',43,410,20,30,'Broad Roman-period endpoint band; source does not date individual changes.'),('1086',1086,None,15,15,'Approximate late-eleventh-century woodland plus wood pasture, indexed at Domesday year.'),('14c',1300,1399,10,10,'About 10 percent by the fourteenth century; no exact year supplied.')]:
    add('timeline_value','x-woodland-'+slug,wood,series_id=wsr,start=approximate(y,last),value_min=v1,value_max=v2,value_text='approximate',basis=n,confidence='medium',evidence_class='reconstructed',locator='An outline of woodland development')
comparison('x-woodland-link',wsr,wood,'woodland','National rendering uses 20% at 400, 25% at 600, 15% at 1086 and 8% at 1350, with an explicit modelling note.','Current official synthesis gives little overall Roman-to-early-medieval change, about 15% late-eleventh-century woodland/wood pasture and about 10% by the fourteenth century. Keep the app curve explicitly illustrative; this is an alternative synthesis, not a measured replacement.',file='data/national/site.json',pointer='/woodland',typ='uncertainty',importance=1)

plague=src('x-london-black-death','The Great Pestilence in London','London Museum','https://www.londonmuseum.org.uk/collections/london-stories/great-pestilence-london/')
wpest=place('x-weymouth','Weymouth / Melcombe Regis',plague,'weymouth',kind='port')
camp=add('campaign','x-black-death-spread',plague,name='Documented anchors of the Black Death’s arrival in England',movement_type='epidemic',start=1348,end=1349,description='Only source-supported locality/month anchors; no person or vessel track is implied.')
for seq,pid,month,label in [(1,wpest,6,'Reported arrival at Weymouth'),(2,london,11,'Present in London by November')]:
    add('waypoint',f'x-plague-stop-{seq}',plague,campaign_id=camp,sequence=seq,place_id=pid,start={'year':1348,'month':month,'circa':False,'calendar':'Julian','qualifier':'by' if seq==2 else 'at'},action=label,path_certainty='attested_stop',interpolation_note='Month-level anchor; do not animate a direct travel route or claim first infection was observed.',confidence='medium')
add('event','x-black-death-london',plague,name='Black Death attested in London by November 1348',event_type='plague',place_id=london,start={'year':1348,'month':11,'circa':False,'qualifier':'by'},end=approximate(1349),description='Present by November; initial peak continued into spring 1349. Exact local onset is not asserted.',confidence='medium')
add('timeline_series','x-plague-mortality-series',plague,name='London Black Death mortality synthesis',measure='estimated deaths',unit='persons',geographic_scope='London including suburbs',methodology='Museum estimate from archaeology, wills and descriptions; no contemporary central death register.',evidence_class='reconstructed',confidence='medium')
add('timeline_value','x-plague-london-deaths',plague,series_id='x-plague-mortality-series',start=1352,value_min=35000,value_max=35000,value_text='approximately 35,000 by 1352',basis='Museum synthesis, not a counted death register.',place_id=london,evidence_class='reconstructed',confidence='low')
comparison('x-plague-end-link','x-black-death-london',plague,'1348','London event note gives November 1348 to 1349–50.','Museum distinguishes initial peak through spring 1349 from a cumulative mortality estimate by 1352; do not treat all dates as one uninterrupted local epidemic.',file='data/locations/london/events.json',pointer='/14',typ='refinement')

bm=src('x-boulton','London Bills of Mortality, 1660–1700: introduction','Newcastle University', 'https://www.staff.ncl.ac.uk/j.p.boulton/bills.htm',author='Jeremy Boulton',source_type='scholarly',notes='Only introduction’s pre-1626 evidence is used; its post-1660 table is out of scope.')
add('timeline_series','x-london-epidemic-mortality',bm,name='London major plague mortality fractions',measure='estimated share of population killed',unit='percent',geographic_scope='London; historical coverage changes',methodology='Introductory historical synthesis gives 20–25 percent for major outbreaks; this range is not an independently measured confidence interval.',confidence='medium',evidence_class='reconstructed')
for y in [1563,1603,1625]:
    add('event',f'x-london-plague-{y}',bm,name=f'London plague of {y}',event_type='plague',place_id=london,start=y)
    add('timeline_value',f'x-london-plague-mortality-{y}',bm,series_id='x-london-epidemic-mortality',start=y,value_min=20,value_max=25,basis='Boulton introduction; approximate mortality share.',place_id=london,confidence='medium',evidence_class='reconstructed')
comparison('x-plague-missing','x-london-plague-1625',bm,'1625','London timeline ends with James I’s death; it has no separate 1563, 1603 or 1625 plague events.','These three major plague outbreaks are identified by Boulton; they belong in the event layer, with the 1625 outbreak distinct from the king’s death.',file='data/locations/london/events.json',pointer='/24',typ='omission',importance=1)
add('claim','x-bills-coverage',bm,subject_id='x-london-epidemic-mortality',predicate='coverage_change',value_text='Bills covered the City and liberties through 1603; out-parishes entered in 1604. Raw totals across that boundary are not directly comparable.',start=1604,confidence='high')

fam=src('x-famine','Hansel and Gretel: famine and dearth','Cambridge Group for the History of Population and Social Structure','https://www.campop.geog.cam.ac.uk/blog/2024/08/29/hansel-and-gretel/',source_type='scholarly')
for slug,a,b,desc in [('great',1315,1322,'Crop failures 1315–17 followed by cattle plague 1319–21.'),('black-death',1349,1351,'Harvest failure and famine during plague years.'),('1437',1437,1438,'Later medieval famine.'),('1557',1557,None,'Famine identified in the historical synthesis.'),('1597',1597,None,'Wet growing seasons; strongest effects in remote and upland regions.'),('1620s',1620,1625,'Early-1620s famine in northern and upland communities; regional crisis, slight national effect.')]:
    add('event','x-famine-'+slug,fam,name='Regional famine in the early 1620s' if slug=='1620s' else 'English famine '+str(a)+('–'+str(b) if b else ''),event_type='famine',start=approximate(1620,1624) if slug=='1620s' else a,end=b if b and slug!='1620s' else None,description=desc,confidence='medium',notes='Early-decade date band is an indexing convention for the source phrase, not an asserted 1620–1624 duration.' if slug=='1620s' else None)
comparison('x-famine-link','x-famine-great',fam,'1315','National event note describes harvest failures 1315–17.','Distinguish the crop-failure phase from the wider 1315–22 crisis, including cattle plague 1319–21; the short description is not the whole period.',file='data/national/events.json',pointer='/56',typ='refinement')

flood=src('x-flood','The Great Flood, 1607','Living Levels Landscape Partnership','https://www.livinglevels.org.uk/stories/2018/12/10/the-great-flood-1607',notes='Uses documentary/landscape research and discusses competing causes. Its general statement about the 1752 calendar offset is imprecise; 1607 conversion uses ten days, whereas the actual 1752 British reform used eleven.')
flp=place('x-gwent-levels','Gwent Levels',flood,kind='landscape',country='wales')
fle=add('event','x-flood-1607',flood,name='Bristol Channel and Severn flood',event_type='flood',place_id=flp,start=day(1607,1,20),description='Severe flooding affected both shores of the estuary.',notes='20 January 1606 in English Lady Day year style = 20 January 1607 Julian with January-based year = 30 January 1607 Gregorian. Store Julian day here.')
fd=add('dispute','x-flood-cause',flood,topic='Cause of the 1607 Severn flood',description='Storm-surge explanation versus proposed tsunami; source discusses both and favours storm evidence.',status='scholarly_disagreement')
add('claim','x-flood-storm',flood,subject_id=fle,predicate='cause',value_text='Exceptional tide, low pressure and storm surge are the preferred explanation in the landscape project account.',dispute_id=fd,evidence_class='reconstructed',confidence='medium')
add('claim','x-flood-tsunami',flood,subject_id=fle,predicate='cause',value_text='A tsunami has been proposed by some researchers based on interpretations of the accounts; the linked original article was not consulted here.',dispute_id=fd,evidence_class='conjectural',confidence='low')

arm=src('x-armada','Armada Tapestries: timeline','UK Parliament','https://armada.parliament.uk/timeline.html',notes='Historical timeline uses English Old Style campaign dates; some captions reproduce later artworks rather than contemporary field evidence. Unrelated erroneous Mary/Philip marriage date is not imported.')
ac=add('campaign','x-armada-1588',arm,name='Armada in the English Channel',movement_type='naval',start={'year':1588,'month':7},description='Date/locality anchors, not a reconstructed sailing track.')
for seq,slug,name,dd,aid in [(1,'sighting','English south-west coast',19,None),(2,'plymouth','Off Plymouth',21,'plymouth'),(3,'portland','Off Portland',23,None),(4,'wight','Off the Isle of Wight',25,None)]:
    pid=place('x-armada-'+slug,name,arm,aid,kind='sea_area')
    if aid:
        r=next(r for r in records if r['id']==pid);r.update(uncertainty_m=30000,position_note='App’s coastal town anchor only. Naval engagement occurred offshore; 30 km locality envelope, not a battle coordinate.')
    add('waypoint',f'x-armada-waypoint-{seq}',arm,campaign_id=ac,sequence=seq,place_id=pid,start=day(1588,7,dd),action='Sighting' if seq==1 else 'Naval engagement',path_certainty='attested_stop',interpolation_note='Narrative locality only; source gives no plotted fleet position.',confidence='medium')
    if seq>1:
        eid=add('event',f'x-armada-engagement-{seq}',arm,name='Armada engagement '+name.lower(),event_type='battle',place_id=pid,campaign_id=ac,start=day(1588,7,dd),description='English and Spanish fleets engage in the Channel.',outcome='Campaign continues eastward.',confidence='medium')
        add('battle',eid+'-detail',arm,event_id=eid,site_security='approximate',site_note='Offshore locality; no exact battle point supported.',outcome='No separate decisive outcome asserted.',primary_sources='Later pictorial sequence and parliamentary chronology consulted; underlying 1588 dispatches not directly collated.',confidence='medium')

mary=src('x-mary-rose','Why did the Mary Rose sink?','Mary Rose Trust','https://maryrose.org/discover/history/why-did-the-mary-rose-sink/')
mrp=place('x-mary-rose-place','Solent: Mary Rose sinking area',mary,kind='shipwreck')
mre=add('event','x-mary-rose-sinking',mary,name='Mary Rose sinks during the Battle of the Solent',event_type='battle',place_id=mrp,start=day(1545,7,19),outcome='Mary Rose lost.',description='English and French fleets opposed one another in the Solent.')
add('battle','x-solent-detail',mary,event_id=mre,site_security='approximate',site_note='Solent identified; wreck coordinates not fetched in this pass.',outcome='Loss of the English warship; not by itself proof of a French tactical victory.',primary_sources='François van der Delft to Charles V, 24 July 1545, quoted in translation by the museum; original diplomatic manuscript not inspected.')
md=add('dispute','x-mary-rose-cause',mary,topic='Cause of Mary Rose sinking',description='Reported wind/gunport flooding versus French gunfire claims and other explanations.',status='scholarly_disagreement')
add('claim','x-mary-rose-gunports',mary,subject_id=mre,predicate='cause',value_text='Survivor account transmitted by van der Delft describes a turn, gust and water entering open gunports.',dispute_id=md,confidence='medium')
add('claim','x-mary-rose-gunfire',mary,subject_id=mre,predicate='cause',value_text='A French officer claimed a gunfire sinking; the museum questions whether this establishes the cause.',dispute_id=md,confidence='low')
add('battle_number','x-mary-rose-aboard',mary,event_id=mre,side='English: Mary Rose only',quantity_type='strength',min_value=500,max_value=500,unit='persons aboard',number_basis='Van der Delft’s 24 July report as translated by the museum; not a muster and not whole-fleet strength.',reliability='low',confidence='low')

cabot=src('x-cabot','Cabot and Bristol’s Age of Discovery: The Bristol Discovery Voyages 1480–1508 (sample)','University of Bristol, Cabot Project','https://www.bristol.ac.uk/media-library/sites/history/documents/Cabot%20sample.pdf',author='Evan T. Jones and Margaret M. Condon',source_type='scholarly',bibliographic_ref='Sample includes pp.1–3, 29–39 and following; patent reproduced TNA C76/178 m.8.')
br=place('x-bristol','Bristol',cabot,'bristol',kind='port')
jc=add('person','x-john-cabot',cabot,name='John Cabot (Zuan Chabotto)',role='navigator')
add('event','x-cabot-patent',cabot,name='Henry VII grants Cabot exploration patent',event_type='charter',start=day(1496,3,5),description='Royal patent made Bristol the required return port.',locator='Printed pp.29–31; TNA C76/178 m.8')
add('event','x-cabot-voyage',cabot,name='Cabot’s Matthew expedition from Bristol',event_type='expedition',place_id=br,start=1497,description='North Atlantic voyage linked Bristol to later English overseas expansion.',locator='Introduction and chapter 5',notes='No precise departure or American landfall is asserted from the inspected excerpt.')
add('relation','x-cabot-voyage-leader',cabot,subject_id=jc,predicate='led',object_id='x-cabot-voyage')
add('place_phase','x-bristol-population',cabot,place_id=br,phase_type='population_estimate',start=approximate(1400,1499),population_min=8000,population_max=8000,estimate_basis='Book’s rounded fifteenth-century urban estimate; not a census.',description='Major provincial port.',confidence='medium',evidence_class='reconstructed',locator='Printed p.3')

for slug,topic,task,url in [
 ('climate','Climate proxy coverage','Extract England/Wales grid cells from OWDA, preserve calibration, spatial averaging and annual uncertainty; do not use Europe-wide values as local weather.','https://www.drought.gov/data-maps-tools/old-world-drought-atlas'),
 ('prices','Prices','Add normalized price series from a checked original scholarly table with units, commodity, region and accounting-year conventions.','https://www.econstor.eu/handle/10419/58383'),
 ('town-rank','Urban rankings','Collate 1086, 1377 and 1520s rankings from original tables; distinguish burgesses, adult taxpayers and fiscal assessments from population.','https://archives.history.ac.uk/gazetteer/intro.html'),
 ('sees','Episcopal sees completeness','Complete diocesan transfer dates and bishop successions through 1625 using Fasti Ecclesiae Anglicanae and primary editions.','https://www.british-history.ac.uk/fasti-ecclesiae'),
 ('shires','English shire formation','Separate earliest documentary attestation from creation; do not date every shire to a single conventional century.','https://opendomesday.org/'),
 ('cambridge','Cambridge institutional dates','Re-fetch official early-records page and distinguish scholars arriving in 1209 from later legal recognition and college foundations.','https://www.cam.ac.uk/about-the-university/history/early-records'),
 ('fires','Fire inventory','Complete securely dated English/Welsh urban fires and distinguish chronicler casualty claims from estimates.','https://www.british-history.ac.uk/'),
 ('plantations','Planned towns','Add planted boroughs and market-town foundations, distinguishing legal grants from physical occupation and failed foundations.','https://archives.history.ac.uk/gazetteer/intro.html')]:
    add('todo','x-'+slug+'-coverage',app,topic=topic,task=task,priority=2,status='open',reason='Coverage gap after this research pass; source link is a lead, not fetched evidence for a fact.',lead_url=url,confidence='low',evidence_class='conjectural')

(ROOT/'packets/x-core.json').write_text(json.dumps({'sources':sources,'records':records},ensure_ascii=False,indent=2)+'\n')
print(f'{len(sources)} sources, {len(records)} records')
