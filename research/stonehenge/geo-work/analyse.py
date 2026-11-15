import json,math,numpy as np,sys
from fitlib import *
src=open('fit.py').read()
pre=src.split("nh=len(HILLS)")[0]
exec(pre.replace('P=P[inb];y=y[inb]',''))
nh=len(HILLS); M=Model([v[1] for v in VALLEYS],nh)
p=np.load('fit_p.npy')
base,grad,brg,hills,vdep,vsig=M.unpack(p)
print('base %.2f grad %.4f brg %.1f'%(base,grad,brg))
for h,hh in zip(HILLS,hills): print('%-45s x%7.0f z%7.0f h%5.1f s%5.0f'%(h[0],*hh))
for v,d,s in zip(VALLEYS,vdep,vsig): print('%-45s depth%5.1f sig%5.0f'%(v[0][:45],d,s))
P0,y0=load_samples(); P,y=P0,y0
r=M.eval(p,P)-y
inb=(P[:,0]>=-2700)&(P[:,0]<=3500)&(P[:,1]>=-2800)&(P[:,1]<=2200)
near=np.hypot(P[:,0],P[:,1])<=500
print('all',math.sqrt(np.mean(r**2)),abs(r).max(),'inb',math.sqrt(np.mean(r[inb]**2)),abs(r[inb]).max(),'near',math.sqrt(np.mean(r[near]**2)),abs(r[near]).max(),'n',len(y),inb.sum(),near.sum())
print('ground at stones',M.eval(p,np.array([[0.,0.]]))[0],'dem',y[(P[:,0]==0)&(P[:,1]==0)][0])
# smoothness around stones: height range over 100 m
g=np.array([[x,z] for x in range(-50,51,10) for z in range(-50,51,10)],float); hh=M.eval(p,g); print('range within 50 m radius',hh.max()-hh.min())
# residual map 200 m
xs=range(-2800,3601,400)
d={tuple(pt):v for pt,v in zip(P.astype(int).tolist(),r)}
print('resid (model-DEM), 400m grid')
for z in range(-2900,2301,200):
    print('%5d '%z+' '.join('%4d'%round(d[(x,z)]) for x in xs))
