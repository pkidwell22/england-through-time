import json,math,itertools
items=json.load(open('items.json'))
named={i['ref']:i for i in items if i['ref'] and i['name']}
cand=[i for i in items if 12.5<math.hypot(i['x'],i['z'])<18.2 and i['area']>1.2 and i['area']<13 and not i['name']]
print(len(cand))
def slotpos(n,cx,cz,R,ax,gap=0.0):
    az=ax+6+(n-1)*12
    a=math.radians(az)
    return cx+R*math.sin(a), cz-R*math.cos(a)
best=None
import random
def cost(cx,cz,R,ax):
    tot=0
    for c in cand:
        d=min(math.hypot(c['x']-slotpos(n,cx,cz,R,ax)[0],c['z']-slotpos(n,cx,cz,R,ax)[1]) for n in range(1,31))
        tot+=min(d,2.5)**2
    return tot
random.seed(1)
cur=(0,0,15.3,50.0); cc=cost(*cur)
step=[1.0,1.0,0.5,3.0]
for it in range(6000):
    new=tuple(cur[k]+random.gauss(0,step[k]*max(0.05,1-it/6000)) for k in range(4))
    c=cost(*new)
    if c<cc: cur,cc=new,c
print(cur,cc,cc/len(cand))
cx,cz,R,ax=cur
for c in sorted(cand,key=lambda c:math.atan2(c['x']-cx,-(c['z']-cz))%(2*math.pi)):
    az=math.degrees(math.atan2(c['x']-cx,-(c['z']-cz)))%360;r=math.hypot(c['x']-cx,c['z']-cz)
    n=round((az-ax-6)/12)%30+1
    sp=slotpos(n,cx,cz,R,ax)
    print(c['id'],'az=%.1f r=%.2f slot=%d d=%.2f area=%.1f bb=%.1fx%.1f ang=%d'%(az,r,n,math.hypot(c['x']-sp[0],c['z']-sp[1]),c['area'],c['bw'],c['bh'],c['ang']))
json.dump(dict(cx=cx,cz=cz,R=R,ax=ax),open('fit.json','w'))
for ref,i in named.items():
    az=math.degrees(math.atan2(i['x']-cx,-(i['z']-cz)))%360;r=math.hypot(i['x']-cx,i['z']-cz)
    print(ref,i['name'],'az=%.1f r=%.1f'%(az,r))
