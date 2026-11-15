import json,math,numpy as np,sys
from fitlib import *
P,y=load_samples()
av=json.load(open('avon_chain.json'))['full']
def dp(pts,eps):
    if len(pts)<3: return pts
    a,b=pts[0],pts[-1]; dmax=0;idx=0
    for i in range(1,len(pts)-1):
        px,pz=pts[i]; ax,az=a;bx,bz=b; dx,dz=bx-ax,bz-az; L=math.hypot(dx,dz) or 1
        d=abs(dz*(px-ax)-dx*(pz-az))/L
        if d>dmax: dmax,idx=d,i
    if dmax>eps: return dp(pts[:idx+1],eps)[:-1]+dp(pts[idx:],eps)
    return [a,b]
avs=dp([tuple(p) for p in av if p[0]<4100],60)
VALLEYS=[
 ('River Avon valley (broad)',avs,18,500),
 ('River Avon channel and scarps (narrow)',avs,20,170),
 ('Stonehenge Bottom (dry valley east of the stones; the Avenue crosses it)',[(750,-1300),(650,-900),(600,-500),(560,-200),(460,300),(430,900),(420,1400),(350,1700),(200,1900),(0,2100),(-200,2300)],14,260),
 ('North-west dry valley (Winterbourne Stoke Down)',[(-1950,-2800),(-1850,-2200),(-1900,-1900),(-2100,-1700),(-2400,-1500),(-2800,-1300)],10,300),
 ('Wilsford dry valley (south-west of Normanton Down)',[(-1500,500),(-1400,700),(-1200,900),(-1100,1200),(-900,1500),(-600,1700),(-400,1850),(-200,2050),(-100,2250)],12,300),
 ('Countess Down dry valley (Cursus to Durrington)',[(1700,-1400),(1900,-1100),(2300,-800),(2700,-600)],6,250),
]
HILLS=[
 ('King Barrow Ridge (north; Old King Barrows)',1200,-600,15,350),
 ('King Barrow Ridge (south; New King Barrows, Coneybury)',1100,500,20,350),
 ('Normanton Down ridge (Bush Barrow)',-800,900,10,250),
 ('Greater Cursus west ridge',-1150,-1100,15,450),
 ('Larkhill rise',900,-2600,35,700),
 ('Durrington Down (high ground north-west of Durrington Walls)',2300,-1600,35,450),
 ('Winterbourne Stoke Down',-1500,200,18,450),
 ('Wilsford Down upland (south-west)',-2600,1500,22,450),
 ('South ridge (Lake Down - Normanton side)',850,1800,30,330),
 ('Upland east of the Avon (Amesbury)',3300,1900,30,350),
 ("Vespasian's Camp spur",2380,450,25,170),
 ('Stonehenge Down (knoll of the stones)',-200,100,4,200),
]
nh=len(HILLS)
M=Model([v[1] for v in VALLEYS],nh)
HB={'King Barrow Ridge (north; Old King Barrows)':(1200,-600,450,500),'King Barrow Ridge (south; New King Barrows, Coneybury)':(1100,500,450,500),
 'Normanton Down ridge (Bush Barrow)':(-600,900,250,400),'Greater Cursus west ridge':(-1150,-1100,600,700),'Winterbourne Stoke Down':(-1500,200,500,700),
 "Vespasian's Camp spur":(2380,450,150,250),'Stonehenge Down (knoll of the stones)':(-60,0,120,300),'Durrington Down (high ground north-west of Durrington Walls)':(2300,-1600,500,700)}
M.hb=[HB.get(h[0]) for h in HILLS]
inb=(P[:,0]>=-2700)&(P[:,0]<=3500)&(P[:,1]>=-2800)&(P[:,1]<=2200)
P=P[inb];y=y[inb]
gx=[(a,b) for a in range(-60,61,10) for b in range(-60,61,10) if a*a+b*b<=3600]
P=np.vstack([P,np.array(gx,float)]);y=np.concatenate([y,np.full(len(gx),41.3)])
rr=np.hypot(P[:,0],P[:,1]); w=np.ones(len(y)); near=rr<=500; w[near]=2.0; w[rr<=150]=6.0; w[len(y)-len(gx):]=25.0
p0=M.pack(46,0.002,90,[h[1:] for h in HILLS],[v[2] for v in VALLEYS],[v[3] for v in VALLEYS])
p=p0
for rnd in range(4):
    p,c=lm(M,p,P,y,w,iters=40)
    r=M.eval(p,P)-y
    print(rnd,'rms',math.sqrt(np.mean(r**2)),'near',math.sqrt(np.mean(r[near]**2)),flush=True)
np.save('fit_p.npy',p)
json.dump(dict(valleys=[dict(name=v[0],path=v[1]) for v in VALLEYS],hills=[h[0] for h in HILLS]),open('fit_struct.json','w'))
