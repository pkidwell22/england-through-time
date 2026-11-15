import json,math,numpy as np
from common import *
ways=json.load(open('osm_barrow_ways.json'))['elements']
rel=json.load(open('osm_rel.json'))['elements']
grp={}
for r in rel:
    for m in r['members']:
        if m['type']=='way': grp[m['ref']]=r['tags']['name']
def mbr(pts):
    P=np.array(pts); best=None
    for ang in np.arange(0,180,1.0):
        a=math.radians(ang); R=np.array([[math.cos(a),math.sin(a)],[-math.sin(a),math.cos(a)]])
        Q=P@R.T; w=np.ptp(Q[:,0]); h=np.ptp(Q[:,1]); 
        if best is None or w*h<best[0]: best=(w*h,ang,w,h)
    area,ang,w,h=best
    # long side direction: axis angle 'ang' is the direction of the x-axis of rotated frame
    if h>w: ang=(ang+90)%180; w,h=h,w
    # direction vector in (x east, z south): (cos ang, sin ang); bearing cw from north: east=+x, north=-z
    brg=(math.degrees(math.atan2(math.cos(math.radians(ang)), -math.sin(math.radians(ang)))))%180
    return w,h,brg
out=[]
skip_names={'Bluestonehenge','Coneybury Henge','Lesser Cursus','North Kite Enclosure','Ditch','Stonehenge','The Avenue','The Cursus',"Vespasian's Camp",'Woodhenge'}
for e in ways:
    t=e.get('tags',{})
    if e['type']=='way':
        if t.get('name') in skip_names: continue
        if t.get('archaeological_site') not in ('tumulus','megalith') and t.get('name') not in ('Tumulus','Long Barrow'): continue
        g=e['geometry']; pts=[loc(p['lat'],p['lon']) for p in g]
        if pts[0]==pts[-1]: pts=pts[:-1]
        c=np.mean(pts,axis=0); 
        # area centroid via polygon formula
        A=0;cx=0;cz=0
        for i in range(len(pts)):
            x0,z0=pts[i];x1,z1=pts[(i+1)%len(pts)];cr=x0*z1-x1*z0;A+=cr;cx+=(x0+x1)*cr;cz+=(z0+z1)*cr
        if abs(A)>1e-6: c=np.array([cx/(3*A),cz/(3*A)])
        area=abs(A)/2
        L,W,brg=mbr(pts)
        out.append(dict(osm='way/%d'%e['id'],name=t.get('name'),x=float(c[0]),z=float(c[1]),L=L,W=W,brg=brg,diam=2*math.sqrt(area/math.pi),group=grp.get(e['id']),tags={k:v for k,v in t.items() if k in('archaeological_site','tumulus','megalith_type','name')}))
    else:
        x,z=loc(e['lat'],e['lon']);t=e['tags']
        out.append(dict(osm='node/%d'%e['id'],name=t.get('name'),x=x,z=z,L=0,W=0,brg=0,diam=None,group=None,tags=t))
json.dump(out,open('barrows_raw.json','w'))
if __name__=="__main__":
    print(len(out))
    for o in sorted(out,key=lambda o:(str(o['group']),o['x'])):
        if -2800<o['x']<3600 and -2900<o['z']<2300:
            print(o['osm'],o['group'],o['name'],int(o['x']),int(o['z']),'L%.0f W%.0f brg%.0f d%.0f'%(o['L'],o['W'],o['brg'],o['diam'] or 0))
