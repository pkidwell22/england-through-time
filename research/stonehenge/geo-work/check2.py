import json,math,numpy as np
from fitlib import *
exec(open('fit.py').read().split("nh=len(HILLS)")[0].replace('P,y=load_samples()','P,y=load_samples()'))
nh=len(HILLS); M=Model([v[1] for v in VALLEYS],nh); p=np.load('fit_p.npy')
Pa,ya=load_samples(); Pm,ym=load_samples('dem_meteo.json')
ee=np.array([ya[i] for i in range(len(Pa))]); 
# match
dm={tuple(a):b for a,b in zip(Pm.astype(int).tolist(),ym)}
da=[(tuple(a),b) for a,b in zip(Pa.astype(int).tolist(),ya)]
diff=np.array([dm[k]-v for k,v in da]); 
inb=np.array([(-2700<=k[0]<=3500 and -2800<=k[1]<=2200) for k,v in da])
print('meteo-eudem: mean %.2f rms %.2f max %.1f (in bounds rms %.2f)'%(diff.mean(),math.sqrt((diff**2).mean()),abs(diff).max(),math.sqrt((diff[inb]**2).mean())))
mp=np.array([dm[k] for k,v in da]); model=M.eval(p,Pa)
r2=model-mp
print('model vs meteo in-bounds rms %.2f max %.1f'%(math.sqrt((r2[inb]**2).mean()),abs(r2[inb]).max()))
near=np.hypot(Pa[:,0],Pa[:,1])<=500
print('near: meteo diff rms %.2f; model vs meteo rms %.2f'%(math.sqrt((diff[near]**2).mean()),math.sqrt((r2[near]**2).mean())))
g=np.array([[x,z] for x in range(-2700,3501,100) for z in range(-2800,2201,100)],float); h=M.eval(p,g); print('model min',h.min(),'max',h.max(),'at',g[h.argmin()],g[h.argmax()])
# slope near stones
for q in [(0,0),(60,0),(-60,0),(0,60),(0,-60),(100,0),(-100,0),(0,100),(0,-100),(500,-390),(600,-500),(1100,-100),(1332,-150),(-600,930),(1981,815),(2760,-1540),(2821,-1171),(2926,775),(2380,464),(3102,730)]:
    print(q,'model %.1f DEM %.1f'%(M.eval(p,np.array([q],float))[0]+60, 0), end=' | ')

print()
raw=M.eval.__func__
# unclamped evaluation
import types
def raw_eval(p,P):
    base,grad,brg,hills,vdep,vsig=M.unpack(p)
    a=math.radians(brg); sx,sz=math.sin(a)*grad,-math.cos(a)*grad
    h=base+P[:,0]*sx+P[:,1]*sz
    for hx,hz,hh,hs in hills: h=h+hh*np.exp(-((P[:,0]-hx)**2+(P[:,1]-hz)**2)/(2*hs*hs))
    for d,dep,s in zip(M.vd(P),vdep,vsig): h=h-dep*np.exp(-(d*d)/(2*s*s))
    return h
M._cache=(0,[])
g2=np.array([[x,z] for x in range(-2700,3501,100) for z in range(-2800,2200+1,100)],float)
hh=raw_eval(p,g2)
print('unclamped min',hh.min(),'n<2',(hh<2).sum(),'n<4',(hh<4).sum(),'of',len(hh))
