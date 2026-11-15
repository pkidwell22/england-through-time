import math,numpy as np
from fitlib import *
exec(open('fit.py').read().split("nh=len(HILLS)")[0])
nh=len(HILLS); M=Model([v[1] for v in VALLEYS],nh); p=np.load('fit_p.npy')
Pa,ya=load_samples(); M._cache=(0,[])
r=M.eval(p,Pa)-ya
inb=(Pa[:,0]>=-2700)&(Pa[:,0]<=3500)&(Pa[:,1]>=-2800)&(Pa[:,1]<=2200)
idx=np.where(inb&(abs(r)>10))[0]
print(len(idx),'of',inb.sum())
for i in idx: print(tuple(Pa[i].astype(int)),'model-dem %.1f dem %.1f'%(r[i],ya[i]+60))
