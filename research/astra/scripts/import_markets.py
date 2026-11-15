#!/usr/bin/env python3
"""Conservative factual extraction of the IHR market gazetteer, for private research.

The offline build does not require this network importer. It uses a saved factual
extraction when available; --refresh fetches all 40 county/Wales pages anew.
No source prose is republished. Dates are attestations, never settlement origins.
"""
import argparse, concurrent.futures, datetime, hashlib, json, re, sys, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.deps'))
from bs4 import BeautifulSoup
from pyproj import Transformer
BASE='https://archives.history.ac.uk/gazetteer/'
CHECKED=datetime.date.today().isoformat()
TRANSFORM=Transformer.from_crs('EPSG:27700','EPSG:4326',always_xy=True)
MONTHS={'Jan':1,'Feb':2,'Mar':3,'Apr':4,'May':5,'Jun':6,'Jul':7,'Aug':8,'Sept':9,'Sep':9,'Oct':10,'Nov':11,'Dec':12}
def clean(s): return ' '.join(s.split()).replace('\u2013','-').replace('\u2014','-')
def fetch(url):
    req=urllib.request.Request(url,headers={'User-Agent':'Historical research; scholarly factual extraction'})
    with urllib.request.urlopen(req,timeout=45) as r: return r.read()
def soup(raw):
    # Several legacy pages declare UTF-8 but contain Windows-1252 pound signs.
    # Statistical charset guessing misreads those as Polish L and loses values.
    try:text=raw.decode('utf-8')
    except UnicodeDecodeError:text=raw.decode('windows-1252')
    return BeautifulSoup(text,'html.parser')
def date_parse(text,header=False):
    # Only a date introduced by a documented status/action is eligible. Dates in
    # bibliographic volume ranges are not candidate attestations.
    text=re.sub(r'\bc\s*\.\s*(?=\d)', 'c.',text)
    expr=r'((?:c\.?\s*)?(?:(?:\d{1,2}\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?\s+)?\d{3,4}(?:\s*[x-]\s*\d{1,4})?)\b'
    if header:
        m=re.search(r'\bBorough\s+'+expr,text,re.I)
        kind='borough_attestation'
    else:
        m=re.search(r'\b(gr(?:anted)?|recorded)\s+'+expr,text,re.I)
        kind='grant' if m and m.group(1).lower().startswith('gr') else 'recorded'
    if not m: return None
    token=m.group(1 if header else 2)
    yr=re.search(r'(\d{3,4})(?:\s*([x-])\s*(\d{1,4}))?\s*$',token)
    if not yr:return None
    y=int(yr.group(1));latest=y
    if yr.group(3):
        t=yr.group(3); latest=int(t) if len(t)==len(yr.group(1)) else int(yr.group(1)[:-len(t)]+t)
        if latest<y: latest+=10**len(t)
    if not 600<=y<=1516 or not y<=latest<=1516:return None
    before=text[max(0,m.start()-30):m.start()].lower()
    # An exact capture inside a forged charter or negated clause is not accepted.
    if any(w in text[:m.end()].lower() for w in ['spurious','forged','forgery']):return None
    d={'year':y,'latest_year':latest,'circa':bool(re.match(r'c(?:\.|\s)',token,re.I)) or y!=latest,'calendar':'Julian','precision':'range' if y!=latest else 'year'}
    md=re.search(r'(?:(\d{1,2})\s+)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?\s+',token,re.I)
    if md and y==latest:
        mo=md.group(2)[0].upper()+md.group(2)[1:].lower();d['month']=MONTHS[mo];d['precision']='month'
        if md.group(1):d['day']=int(md.group(1));d['precision']='day'
    return {'date':d,'kind':kind}

def parse_county(pair):
    county,tail=pair;url=BASE+tail;raw=fetch(url);s=soup(raw)
    updated=re.search(r'Last updated:\s*(\d{1,2}\s+[A-Za-z]+,?\s+\d{4})',s.get_text(' ',strip=True))
    items=[]
    for table in s.find_all('table'):
        rows=table.find_all('tr',recursive=False)
        if not rows:rows=table.find_all('tr')
        if not rows:continue
        head=rows[0].find('td',attrs={'colspan':'3'})
        if not head:continue
        bold=head.find('b')
        if not bold:continue
        name=clean(bold.get_text(' ',strip=True))
        if not name or name in ['M','F']:continue
        h=clean(head.get_text(' ',strip=True))
        grid=re.search(r'\b(\d{4})\s+(\d{4})\b',h)
        anchors=[a.get('name') for a in head.find_all('a') if a.get('name')]
        anchor=anchors[-1] if anchors else ''
        subsidy=re.search(r'1334\s+Subsidy\s*[£�]\s*([\d,]+(?:\.\d+)?)',h)
        entry={'name':name,'anchor':anchor,'grid':list(grid.groups()) if grid else None,'borough':date_parse(h,True),'subsidy':float(subsidy.group(1).replace(',','')) if subsidy else None,'markets':[],'fair_count':0,'has_borough':bool(re.search(r'\bBorough\b',h))}
        for row in rows[1:]:
            marker=row.find('b')
            if not marker:continue
            typ=clean(marker.get_text(' ',strip=True))
            if typ=='F':entry['fair_count']+=1
            if typ!='M':continue
            text=clean(row.get_text(' ',strip=True))
            if text.startswith('M '):text=text[2:]
            mt=re.search(r'^\(([^)]*)\)',text)
            market_type=mt.group(1) if mt else 'unspecified'
            parsed=date_parse(text)
            # A bibliography can mention Winton Domesday without referring to
            # the 1086 survey. Never infer 1086 from a bare DB/Domesday token.
            if parsed is None and 'borough' in market_type.lower() and entry['borough'] and not re.search(r'\b(recorded|gr|granted)\b',text,re.I):
                parsed={'date':entry['borough']['date'],'kind':'inferred_from_borough'}
            qualification=bool(re.search(r'\b(vacat\w*|revok\w*|spurio\w*|forg\w*|cancel\w*|ceased|supersed\w*|not.{0,60}establish\w*|never established|not held|never held)\b',text,re.I))
            entry['markets'].append({'type':market_type,'weekday':None,'attestation':parsed,'qualification_review':qualification})
        items.append(entry)
    print(f'{county}: {len(items)} entries',flush=True)
    return {'county':county,'url':url,'sha256':hashlib.sha256(raw).hexdigest(),'checked_on':CHECKED,'edition_date':updated.group(1) if updated else None,'entries':items}

def build_packet(data):
    sources=[];records=[]
    def add(table,id,source_id,**fields):
        row={'table':table,'id':id,'source_id':source_id,'confidence':'medium','evidence_class':'attested-documentary','checked_on':CHECKED}
        row.update(fields);records.append(row)
    sources.append({'id':'x-ihr-method','title':'Gazetteer of Markets and Fairs to 1516: Basic Introduction','author':'Samantha Letters','publisher':'Centre for Metropolitan History, Institute of Historical Research','url':BASE+'intro.html','access_status':'fetched','source_type':'scholarly','checked_on':CHECKED,'notes':'Markets can be inferred from borough or mint evidence; grants do not prove operation. Medieval counties are not the index geography. Private research; source terms restrict republication and commercial reuse.'})
    add('timeline_series','x-ihr-subsidy-series','x-ihr-method',name='Place assessments in the 1334 lay subsidy',measure='fiscal assessment',unit='pounds sterling (decimal transcription)',geographic_scope='Places in England covered by the IHR gazetteer',methodology='Gazetteer header values; fiscal wealth assessments, not population. Missing counties/places are not zero. Administrative units vary; no population ranking is inferred.')
    for county in data:
        slug=Path(county['url']).stem;sid='x-ihr-'+slug
        sources.append({'id':sid,'title':'Online Gazetteer of Markets and Fairs in England and Wales to 1516: '+county['county'],'author':'Samantha Letters','publisher':'Centre for Metropolitan History, Institute of Historical Research','url':county['url'],'access_status':'fetched','source_type':'scholarly','checked_on':CHECKED,'bibliographic_ref':'Samantha Letters, Online Gazetteer of Markets and Fairs in England and Wales to 1516, '+county['county']+', source metadata date '+str(county['edition_date']),'notes':'County/page grouping follows the published gazetteer, not medieval shire boundaries. SHA-256 of fetched HTML: '+county['sha256']+'. Structured facts extracted; full prose not copied. Terms: https://archives.history.ac.uk/gazetteer/copyright.html (private research; commercial reuse forbidden without permission).'})
        for i,e in enumerate(county['entries']):
            pid=f'x-market-{slug}-{i+1:03d}';locator=e['name']+' #'+e['anchor']
            position=dict(lat=None,lon=None,uncertainty_m=None,position_method='unlocated',position_source_id=None,position_note='No usable grid reference in parsed header.')
            if e['grid']:
                east,north=[int(v)*100 for v in e['grid']]
                lon,lat=TRANSFORM.transform(east,north)
                if 49.7<lat<56.2 and -6.6<lon<2.3:
                    position=dict(lat=round(lat,6),lon=round(lon,6),uncertainty_m=1000,position_method='gazetteer',position_source_id=sid,position_note=f'IHR numeric OS national grid {e["grid"][0]} {e["grid"][1]} interpreted as 100 m easting/northing, EPSG:27700 transformed to WGS84 via PROJ. 1 km conservative town anchor radius, not market-stall site.',position_confidence='medium')
            add('place',pid,sid,name=e['name'].title(),kind='settlement',country='wales' if county['county']=='WALES' else 'england',locator=locator,notes='Included in the scholarly market/fair catalogue, not necessarily a town, borough or functioning market. Gazetteer county: '+county['county']+'. Date-qualified market and borough assertions are separate.',**position)
            add('place_name',pid+'-name',sid,place_id=pid,name=e['name'].title(),language='modern gazetteer label',name_type='modern',locator=locator)
            if e['borough']:
                add('place_phase',pid+'-borough',sid,place_id=pid,phase_type='borough_attestation',description='Borough status attested at the date reported by the gazetteer; not a founding date.',start=e['borough']['date'],locator=locator+' header')
            elif e['has_borough']:
                add('todo',pid+'-borough-review',sid,topic='Complex borough date',task='Read and normalize the borough chronology manually.',priority=2,status='open',reason='Header mentions borough status but conservative date grammar did not accept it.',entity_id=pid,lead_url=county['url']+'#'+e['anchor'],locator=locator)
            for j,m in enumerate(e['markets']):
                if m.get('qualification_review'):
                    add('todo',pid+f'-market-{j+1}-qualification',sid,topic='Qualified market history',task='Inspect cancellation, revocation, suspected forgery or cessation language before treating the grant as a functioning market.',priority=1,status='open',reason='Source paragraph contains a qualification; a parsed grant alone establishes no operating history.',entity_id=pid,lead_url=county['url']+'#'+e['anchor'],locator=locator+f' market {j+1}')
                if not m['attestation']:
                    add('todo',pid+f'-market-{j+1}-review',sid,topic='Undated or complex market attestation',task='Inspect the exact source entry and normalize the market date, including prescriptive and mint-derived evidence.',priority=2,status='open',reason='Conservative parser could not establish a dated market claim; not included in the by-1300 view.',entity_id=pid,lead_url=county['url']+'#'+e['anchor'],locator=locator+f' market {j+1}')
                    continue
                a=m['attestation'];inferred=a['kind']=='inferred_from_borough'
                add('place_phase',pid+f'-market-{j+1}',sid,place_id=pid,phase_type='market_'+a['kind'],description='Market '+a['kind'].replace('_',' ')+'; instrument/category: '+m['type']+'.',start=a['date'],evidence_class='reconstructed' if inferred else 'attested-documentary',locator=locator+f' market {j+1}',notes='Automatically normalized from an explicit gazetteer date clause; not direct inspection of the medieval instrument. A grant or first mention does not prove continuous operation, successful establishment, or a settlement foundation. Later regrants/cessations require source review. Weekday intentionally omitted because later schedules can occur in the same paragraph.'+(' SOURCE QUALIFICATION PRESENT: inspect linked TODO before use.' if m.get('qualification_review') else ''))
            if e['subsidy'] is not None:
                add('timeline_value',pid+'-1334',sid,series_id='x-ihr-subsidy-series',start=1334,value_min=e['subsidy'],value_max=e['subsidy'],value_text=str(e['subsidy']),basis='1334 Subsidy header in the IHR catalogue; decimal pound amount as printed, not a population estimate.',place_id=pid,locator=locator+' header')
    add('todo','x-market-manual-review','x-ihr-method',topic='Gazetteer validation and reuse',task='Resolve all complex/undated entries against the Gazetteer and medieval records; obtain permission before incorporating the catalogue extraction into a public or commercial application.',priority=1,status='open',reason='Private research extraction covers the national published index, but does not establish an exhaustive list of functioning markets by 1300 or permission to redistribute the source database.',lead_url=BASE+'copyright.html')
    return {'sources':sources,'records':records}

def main():
    global CHECKED
    p=argparse.ArgumentParser();p.add_argument('--refresh',action='store_true');args=p.parse_args()
    output=ROOT/'inputs/market-extraction.json'
    if args.refresh or not output.exists():
        raw=fetch(BASE+'counties.html');s=soup(raw)
        pairs=[(a.get_text(' ',strip=True),a['href']) for a in s.find_all('a',href=True)][:40]
        fetch(BASE+'intro.html');fetch(BASE+'copyright.html')
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:data=list(pool.map(parse_county,pairs))
        output.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    else:data=json.loads(output.read_text())
    dates={c['checked_on'] for c in data}
    if len(dates)!=1:raise ValueError('Mixed fetch dates require per-county provenance handling')
    CHECKED=dates.pop()
    packet=build_packet(data);dest=ROOT/'packets/x-markets.json'
    dest.write_text(json.dumps(packet,ensure_ascii=False,indent=2)+'\n')
    print(f'{sum(len(c["entries"]) for c in data)} catalogue places, {len(packet["records"])} records; written {dest.relative_to(ROOT)}')
if __name__=='__main__':main()
