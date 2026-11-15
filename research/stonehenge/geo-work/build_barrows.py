import json,math
from common import *
raw=json.load(open('barrows_raw.json'))
BX=(-2700,3500);BZ=(-2800,2200)
extra_long_nodes={'node/445416451':'long barrow (OSM node; Amesbury, east of Woodhenge)','node/445363162':'long barrow (OSM node; Winterbourne Stoke Down)','node/4237711958':'long barrow (OSM node; south-east, Normanton hamlet side)','node/429897673':'long barrow (OSM node; far north, outside bounds)'}
# centroids of named groups for nearest assignment
import collections
gc=collections.defaultdict(list)
for o in raw:
    if o['group']: gc[o['group']].append((o['x'],o['z']))
gcen={g:(sum(p[0] for p in v)/len(v),sum(p[1] for p in v)/len(v)) for g,v in gc.items()}
out=[];n=0
hist=json.load(open('osm_historic.json'))['elements']
for e in hist:
    t=e['tags']
    if e['type']=='node' and t.get('megalith_type')=='long_barrow':
        x,z=loc(e['lat'],e['lon'])
        raw.append(dict(osm='node/%d'%e['id'],name=None,x=x,z=z,L=0,W=0,brg=0,diam=None,group=None,tags=t))

cnt=collections.Counter()
for o in sorted(raw,key=lambda o:(o['x'],o['z'])):
    if not (-2800<=o['x']<=3600 and -2900<=o['z']<=2300): continue
    g=o['group']
    if not g:
        best=min(gcen.items(),key=lambda kv:math.hypot(kv[1][0]-o['x'],kv[1][1]-o['z']))
        g=(best[0]+' (nearby, unlisted in OSM relation)') if math.hypot(best[1][0]-o['x'],best[1][1]-o['z'])<700 else 'Other'
    tags=o['tags']; name=o['name']
    form='unknown'; longbarrow=tags.get('tumulus')=='long_barrow' or 'Long Barrow' in (name or '') or tags.get('megalith_type')=='long_barrow'
    if longbarrow: form='long'
    lat,lon=ll(o['x'],o['z'])
    cnt[g]+=1
    d=dict(id='b%03d'%(len(out)+1),name=name,group=g,lat=round(lat,6),lon=round(lon,6),x=round(o['x'],1),z=round(o['z'],1),form=form,
           inBounds=bool(BX[0]<=o['x']<=BX[1] and BZ[0]<=o['z']<=BZ[1]),osm=o['osm'])
    if form=='long':
        d['length']=round(o['L']);d['width']=round(o['W']);d['bearing']=round(o['brg'])
    elif o['diam']: d['diameter']=round(o['diam'])
    d['source']='sto-osm-overpass'
    if o['osm']=='way/152660486':
        d['name']='Bush Barrow';d['diameter']=49;d['height']=3.3;d['source']='sto-osm-overpass; sto-wikipedia-bush-barrow'
        d['note']='identified by position: Wikipedia 51.17051,-1.83482 (SU11644126) lies within 5 m of this OSM polygon; Wikipedia: 49 m overall, 3.3 m high'
    if o['osm']=='way/976096296': d['name']='Amesbury 42 long barrow';d['note']='just beyond the east end of the Greater Cursus; N-S; levelled, under a bridleway (Wikipedia Stonehenge Cursus). OSM polygon: length/bearing from the mapped outline'
    if o['osm']=='way/152660270': d['name']='Winterbourne Stoke 1 (Crossroads long barrow)';d['note']='OSM name: Winterbourne Stoke Crossroads Long Barrow; length/bearing from the mapped outline'
    if o['osm']=='way/976678628': d['note']='tagged tumulus=long_barrow in OSM (Lake Barrows area); outline 56 x 30 m'
    if o['osm']=='way/976089652': d['name']='Normanton Down long barrow';d['note']='OSM outline is small (19 x 9 m): probably the surviving mound only; identification as the Normanton Down long barrow inferred from position/type (Wikipedia: one Neolithic long barrow in the group)'
    if o['osm'] in extra_long_nodes: d['form']='long';d['note']=extra_long_nodes[o['osm']]
    if form!='long' and 'diameter' in d and 'note' not in d: d['note']='diameter = equivalent circle of the OSM polygon (a mapped/symbolic outline, not a survey); form not given in OSM'
    if d['form']=='long' and not d.get('name'): d['name']='long barrow (unnamed in OSM)'
    out.append(d)
json.dump(out,open('barrows.json','w'),indent=0)
print(len(out),sum(d['inBounds'] for d in out)); print(cnt)
print([ (d['name'],d['x'],d['z']) for d in out if d['form']=='long'])
