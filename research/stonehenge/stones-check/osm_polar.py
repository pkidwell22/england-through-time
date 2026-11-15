import json,math
d=json.load(open('osm.json'))
LAT0,LON0=51.17888,-1.82619
KY=111195.0; KX=111195.0*math.cos(math.radians(LAT0))
def xz(lat,lon): return ((lon-LON0)*KX, -(lat-LAT0)*KY)  # x east, z south
items=[]
for e in d['elements']:
    t=e.get('tags',{})
    if e['type']!='way' or 'natural' not in t: continue
    g=e['geometry']; pts=[xz(p['lat'],p['lon']) for p in g]
    if pts[0]==pts[-1]: pts=pts[:-1]
    # area centroid
    A=0;cx=0;cz=0
    for i in range(len(pts)):
        x1,z1=pts[i];x2,z2=pts[(i+1)%len(pts)]
        c=x1*z2-x2*z1;A+=c;cx+=(x1+x2)*c;cz+=(z1+z2)*c
    A/=2
    if abs(A)<1e-9: continue
    cx/=6*A;cz/=6*A
    # min-area-ish oriented bbox via PCA
    mx=sum(p[0] for p in pts)/len(pts);mz=sum(p[1] for p in pts)/len(pts)
    best=None
    for deg in range(0,180,3):
        a=math.radians(deg);ca,sa=math.cos(a),math.sin(a)
        u=[(p[0]-mx)*ca+(p[1]-mz)*sa for p in pts];v=[-(p[0]-mx)*sa+(p[1]-mz)*ca for p in pts]
        w=max(u)-min(u);h=max(v)-min(v)
        if best is None or w*h<best[0]: best=(w*h,deg,w,h)
    items.append(dict(id=e['id'],ref=t.get('ref'),name=t.get('name'),x=cx,z=cz,area=abs(A),bw=best[2],bh=best[3],ang=best[1]))
json.dump(items,open('items.json','w'))
def pol(i):
    r=math.hypot(i['x'],i['z']);az=(math.degrees(math.atan2(i['x'],-i['z'])))%360
    return r,az
for i in sorted(items,key=lambda i:pol(i)[0]):
    r,az=pol(i);print(i['id'],i['ref'],i['name'],'r=%.1f az=%.0f  x=%.1f z=%.1f  bb=%.1fx%.1f area=%.2f'%(r,az,i['x'],i['z'],i['bw'],i['bh'],i['area']))
