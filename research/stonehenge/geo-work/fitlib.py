import json,math,numpy as np
from common import *
OFFSET=60.0
BX=(-2700,3500);BZ=(-2800,2200)
def load_samples(fn='dem_eudem.json'):
    d=json.load(open(fn)); pts=[];h=[]
    for k,v in d.items():
        x,z=map(int,k.split(',')); pts.append((x,z)); h.append(v-OFFSET)
    return np.array(pts,float),np.array(h,float)
def seg_dist(P,path):
    # P (n,2), path (m,2) -> min distance to polyline
    best=np.full(len(P),1e18)
    for i in range(len(path)-1):
        a=path[i];b=path[i+1];ab=b-a;L2=ab@ab
        t=np.clip(((P-a)@ab)/(L2 if L2>0 else 1),0,1)
        q=a+t[:,None]*ab; dd=np.hypot(*(P-q).T)
        best=np.minimum(best,dd)
    return best
class Model:
    def __init__(self,valley_paths,nh):
        self.vp=[np.array(p,float) for p in valley_paths]; self.nh=nh
    def pack(self,base,grad,brg,hills,vdep,vsig):
        return np.concatenate([[base,grad,brg],np.array(hills,float).ravel(),vdep,vsig])
    def unpack(self,p):
        base,grad,brg=p[:3]; hills=p[3:3+4*self.nh].reshape(self.nh,4); nv=len(self.vp)
        vdep=p[3+4*self.nh:3+4*self.nh+nv]; vsig=p[3+4*self.nh+nv:]
        return base,grad,brg,hills,vdep,vsig
    def vd(self,P):
        if not hasattr(self,'_cache') or self._cache[0] is not P:
            self._cache=(P,[seg_dist(P,v) for v in self.vp])
        return self._cache[1]
    def eval(self,p,P):
        base,grad,brg,hills,vdep,vsig=self.unpack(p)
        a=math.radians(brg); sx,sz=math.sin(a)*grad,-math.cos(a)*grad
        h=base+P[:,0]*sx+P[:,1]*sz
        for hx,hz,hh,hs in hills:
            h=h+hh*np.exp(-((P[:,0]-hx)**2+(P[:,1]-hz)**2)/(2*hs*hs))
        for d,dep,s in zip(self.vd(P),vdep,vsig):
            h=h-dep*np.exp(-(d*d)/(2*s*s))
        return np.maximum(2,h)
    hb=None
    def bounds(self):
        hlo=[];hhi=[]
        for i in range(self.nh):
            if self.hb and self.hb[i]: x0,z0,R,smax=self.hb[i]; hlo+=[x0-R,z0-R,0,100]; hhi+=[x0+R,z0+R,70,smax]
            else: hlo+=[-3000,-3500,0,100]; hhi+=[4000,3000,70,1200]
        lo=[20,0,0]+hlo+[0]*len(self.vp)+[60]*len(self.vp)
        hi=[80,0.05,360]+hhi+[70]*len(self.vp)+[1000]*len(self.vp)
        return np.array(lo,float),np.array(hi,float)
def lm(model,p0,P,y,w,iters=60,lam=1.0,verbose=True):
    lo,hi=model.bounds(); p=np.clip(p0,lo,hi); 
    def cost(p): r=(model.eval(p,P)-y)*w; return r@r,r
    c,r=cost(p)
    for it in range(iters):
        J=np.zeros((len(y),len(p)))
        for k in range(len(p)):
            step=max(1e-4,abs(p[k])*1e-4) if k>=3 else (1e-5 if k==1 else 1e-3)
            if k>=3 and (k-3)<4*model.nh and (k-3)%4<2: step=1.0
            q=p.copy();q[k]+=step; J[:,k]=((model.eval(q,P)-model.eval(p,P))*w)/step
        A=J.T@J; g=J.T@r
        improved=False
        for _ in range(8):
            try: dp=-np.linalg.solve(A+lam*np.diag(np.diag(A)+1e-6),g)
            except Exception: lam*=10; continue
            q=np.clip(p+dp,lo,hi); c2,r2=cost(q)
            if c2<c: p,c,r=q,c2,r2; lam=max(lam/3,1e-4); improved=True; break
            lam*=4
        if not improved: break
    return p,c
