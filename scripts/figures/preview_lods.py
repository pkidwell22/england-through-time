"""Preview: renders a cached body's outfits at every level of detail. blender -b --python preview_lods.py -- <out dir> <cache.pkl> <set> [outfits]"""
import sys, os, pickle
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, bpy
import preview, mh
OUT = sys.argv[sys.argv.index("--")+1]
pk = sys.argv[sys.argv.index("--")+2]; sname = sys.argv[sys.argv.index("--")+3]
d = pickle.load(open(pk, "rb"))
S = d["sets"][sname]
COL = {0:(0.8,0.62,0.5),1:(0.55,0.3,0.2),2:(0.25,0.3,0.4),3:(0.3,0.4,0.25),4:(0.15,0.15,0.17),5:(0.9,0.88,0.8),6:(0.35,0.22,0.12),7:(0.25,0.15,0.08),8:(0.6,0.6,0.62),9:(1,1,1),10:(0.7,0.65,0.55)}
mh.clear_scene()
x = 0
sel = [int(v) for v in sys.argv[sys.argv.index("--")+4].split(",")] if len(sys.argv) > sys.argv.index("--")+4 else range(len(S["outfits"]))
for oi in sel:
    for lod in range(3):
        a = S["lods"][lod]
        pos = a["pos"]; idx = a["idx"].reshape(-1, 3); fig = a["fig"]
        vis = ((fig[:, 1].astype(int) >> oi) & 1).astype(bool)
        tri = idx[vis[idx].all(1)]
        co = np.stack([pos[:, 0], -pos[:, 2], pos[:, 1]], 1) + np.array([x, 0, 0])
        cols = np.array([COL[int(s)] for s in fig[:, 0]]) * (fig[:, 2:3] / 255.0)
        preview.mesh_object(f"o{oi}l{lod}", co, tri, cols)
        x += 0.75
    x += 0.4
W = x
preview.render(OUT + f"/lod_{d['id']}_{sname}", centre_x=(W - 1.15) / 2, width=W, views=(0, 180), res=(2400, int(2400 * 2.1 / W)), z=0.95)
