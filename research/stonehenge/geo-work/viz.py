import json,sys,numpy as np
from PIL import Image,ImageDraw
from common import *
d=json.load(open('dem_eudem.json'))
xs=np.arange(-2800,3601,200);zs=np.arange(-2900,2301,200)
G=np.array([[d['%d,%d'%(x,z)] for x in xs] for z in zs])
S=2.0 # px per 10m? scale: 1 px = 8 m
sc=1/8.0
X0,X1,Z0,Z1=-2800,3600,-2900,2300
W=int((X1-X0)*sc);H=int((Z1-Z0)*sc)
from numpy import interp
def bil(x,z):
    fx=(x-X0)/200;fz=(z-Z0)/200
    i=np.clip(fx,0,len(xs)-1.001);j=np.clip(fz,0,len(zs)-1.001);i0=int(i);j0=int(j);a=i-i0;b=j-j0
    return G[j0,i0]*(1-a)*(1-b)+G[j0,i0+1]*a*(1-b)+G[j0+1,i0]*(1-a)*b+G[j0+1,i0+1]*a*b
img=Image.new('RGB',(W,H))
px=img.load()
gx,gz=np.gradient(G,200)
for yy in range(H):
    for xx in range(W):
        x=X0+xx/sc;z=Z0+yy/sc
        h=bil(x,z); t=(h-60)/85
        # shading from gradient
        i=min(int((x-X0)/200),len(xs)-2);j=min(int((z-Z0)/200),len(zs)-2)
        sh=0.5+ (-(gx[j,i])*0.6 - gz[j,i]*0.6)*0.5
        r=int(np.clip(255*(0.2+0.7*t)*sh*1.4,0,255));g=int(np.clip(255*(0.35+0.5*t)*sh*1.4,0,255));b=int(np.clip(255*(0.3+0.3*t)*sh*1.4,0,255))
        px[xx,yy]=(r,g,b)
dr=ImageDraw.Draw(img)
def P(x,z): return ((x-X0)*sc,(z-Z0)*sc)
# bounds
dr.rectangle([P(-2700,-2800),P(3500,2200)],outline=(255,255,0))
F=json.load(open('features.json'))
av=json.load(open('avon_chain.json'))['simple']
dr.line([P(*p) for p in av],fill=(0,120,255),width=2)
dr.line([P(*p) for p in F['avenue']['pathXZ']],fill=(255,60,60),width=2)
dr.line([P(*p) for p in F['cursus-greater']['pathXZ']],fill=(255,160,0),width=2)
for b in json.load(open('barrows.json')):
    x,z=P(b['x'],b['z']); dr.ellipse([x-2,z-2,x+2,z+2],fill=(255,255,255))
for k in ('sarsen-circle-centre','durrington-walls','woodhenge','coneybury-henge','bluestonehenge','vespasians-camp','amesbury-church','cuckoo-stone'):
    x,z=P(F[k]['x'],F[k]['z']); dr.ellipse([x-4,z-4,x+4,z+4],outline=(0,0,0),width=2)
# overlay valleys/hills from fit if provided
if len(sys.argv)>1:
    T=json.load(open(sys.argv[1]))
    for v in T['valleys']:
        dr.line([P(*loc(*p)) for p in v['path']],fill=(0,255,255),width=2)
    for h in T['hills']:
        x,z=P(*loc(h['lat'],h['lon'])); r=h['sigma']*sc; dr.ellipse([x-r,z-r,x+r,z+r],outline=(255,0,255))
img.save(sys.argv[2] if len(sys.argv)>2 else 'dem_view.png')
