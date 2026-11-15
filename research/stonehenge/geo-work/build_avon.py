import json,math
from common import *
water={e['id']:e for e in json.load(open('osm_water.json'))['elements']}
chain=[31246244,192898227,192898226,23072693,149496170,149496163,149496161]
P=[]
for i in chain:
    g=[loc(p['lat'],p['lon']) for p in water[i]['geometry']]
    if P and math.dist(P[-1],g[0])>5: print('gap',i,math.dist(P[-1],g[0]))
    P+=g if not P else g[1:]
P=[p for p in P]
# clip: stop when z>2500
Q=[]
for p in P:
    Q.append(p)
    if p[1]>2500: break
# Douglas-Peucker
def dp(pts,eps):
    if len(pts)<3: return pts
    a,b=pts[0],pts[-1]; dmax=0;idx=0
    for i in range(1,len(pts)-1):
        px,pz=pts[i]; ax,az=a;bx,bz=b
        dx,dz=bx-ax,bz-az; L=math.hypot(dx,dz) or 1
        d=abs(dz*(px-ax)-dx*(pz-az))/L
        if d>dmax: dmax,idx=d,i
    if dmax>eps: return dp(pts[:idx+1],eps)[:-1]+dp(pts[idx:],eps)
    return [a,b]
S=dp(Q,7)
print(len(Q),len(S),sum(math.dist(Q[i],Q[i+1]) for i in range(len(Q)-1)))
json.dump(dict(full=Q,simple=S),open('avon_chain.json','w'))
inb=[p for p in S if -2700<=p[0]<=3500 and -2800<=p[1]<=2200]; print('in bounds pts',len(inb))
