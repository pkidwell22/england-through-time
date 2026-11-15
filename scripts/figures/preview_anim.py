"""Preview: renders one walk or idle clip of a body (side view). blender -b --python preview_anim.py -- <out dir> <body id> <layer>"""
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, bpy
import mh, preview, garments as G, anim
OUT = sys.argv[sys.argv.index("--")+1]
bid = sys.argv[sys.argv.index("--")+2]
layer = int(sys.argv[sys.argv.index("--")+3])
import spec
mh.clear_scene()
sp=[b for b in spec.BODIES if b["id"]==bid][0]
d=mh.make_body(sp); B=G.Body(d)
t=time.time()
A, info = anim.bake_all(B, d["rig"])
print("baked", time.time()-t, A.shape, info)
d["obj"].hide_render=True
bp=B.body_part()
co=bp.co; W=bp.W
# top-4 weights
def skin(co, W, M):
    p=np.c_[co, np.ones(len(co))]
    out=np.zeros_like(co)
    for b in range(W.shape[1]):
        w=W[:,b]
        m=w>0
        if not m.any(): continue
        out[m]+= w[m,None]*(p[m]@M[b].T)[:,:3]
    return out
x=0
for f in range(0,32,4):
    P=skin(co,W,A[layer,f])
    preview.mesh_object("f%d"%f, P+np.array([0,-x,0]), bp.faces, np.tile([0.8,0.7,0.62],(len(co),1)))
    x+=0.9
# ground line markers: small boxes at ankle positions
for o in list(bpy.data.objects):
    if o.type=='ARMATURE' or o.type=='EMPTY': o.hide_render=True
import math
sc=bpy.context.scene
preview.render(OUT+"/anim%d"%layer, centre_x=0, centre_y=-(x-0.9)/2, width=x+0.4, views=(90,), res=(2400,int(2400*2.0/(x+0.4))), z=0.95)
