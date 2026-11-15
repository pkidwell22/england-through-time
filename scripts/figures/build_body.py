"""
Worker: build one body (MPFB), its animation and every garment set it wears, at three levels of detail.
Run: blender -b --factory-startup --python scripts/figures/build_body.py -- <body id> <cache dir> [set,set,...]
Writes <cache dir>/<body id>.pkl (numpy arrays; packed into GLB by pack.py).
"""
import os
import pickle
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402

import anim  # noqa: E402
import garments as G  # noqa: E402
import lods  # noqa: E402
import mh  # noqa: E402
import spec  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
bid, cache = argv[0], argv[1]
only = argv[2].split(",") if len(argv) > 2 and argv[2] else None
t0 = time.time()
sp = [b for b in spec.BODIES if b["id"] == bid][0]
mh.clear_scene()
d = mh.make_body(sp)
B = G.Body(d)
A, stride = anim.bake_all(B, d["rig"])
print(f"[{bid}] body + animation {time.time() - t0:.1f}s height {B.height:.3f}", flush=True)
out = dict(id=bid, spec=sp, height=B.height, k=B.k, anim=A.astype(np.float32), stride=stride, sets={})

body = B.body_part()
eyes = B.eyes_part()
# decimation: protect the face and hands a little
prot = np.ones(len(body.co))
hz = B.z_chin - 0.05 * B.k
prot[body.co[:, 2] > hz] = 0.15
for s in "lr":
    w = B.wrist[s]
    prot[np.linalg.norm(body.co - w, axis=1) < 0.12 * B.k] = 0.5

sets = [s for s in spec.SETS if (s in [p[0] for p in spec.PERIODS]) or bid in spec.SOLDIER_BODIES]
if only:
    sets = [s for s in sets if s in only]
for sname in sets:
    t1 = time.time()
    P, outfits = spec.SETS[sname](B)
    outfits = outfits[:16]
    names = []
    for o in outfits:
        o["parts"] = [n for n in o["parts"] if n in P]
        for n in o["parts"]:
            if n not in names:
                names.append(n)
    base = ["shoes"]
    parts = [body.copy(), eyes.copy()]
    full = (1 << len(outfits)) - 1
    for n in base + [n for n in names if n not in base]:
        p = P[n]
        p.name = n
        p.mask = full if n in base else sum(1 << i for i, o in enumerate(outfits) if n in o["parts"])
        parts.append(p)
    parts[0].mask = parts[1].mask = full
    for p in parts[2:]:
        lods.orient(p)
    ref = set(base + [n for n in names if all(n in o["parts"] for o in outfits)])
    lod_out = []
    for lod in range(4):
        lp = lods.lod_parts(parts, lod, body_protect=prot if lod < 2 else np.maximum(prot, 0.6))
        refs = {p.name: p for p in parts if p.name not in ("body", "eyes")}
        if lod > 0:
            body_l = lp[0]
            shells = [p for p in parts if p.tags.get("shell")]
            blockers = [refs[q.name] for q in lp[1:] if q.name != "eyes"]
            painted = lods.paint_body(body_l, shells, blockers, len(outfits), lod)
            rest = lp[1:]
            lods.coverage(rest, len(outfits), refs=refs)
            lp = painted + rest
        else:
            lods.coverage(lp, len(outfits), refs=refs)
        if lod < 2:
            lods.ambient(lp, ref | {q.name for q in lp if q.tags.get("painted")})
        for q in lp:
            if q.name == "eyes":
                lods.eye_shade(q, B)
        arr = lods.to_arrays(lp)
        per = [int(sum(1 for q in lp for m in q.fmask if (int(m) >> i) & 1)) for i in range(len(outfits))]
        arr["per_outfit"] = per
        lod_out.append(arr)
    out["sets"][sname] = dict(outfits=[dict(name=o["name"], w=o["w"], parts=o["parts"]) for o in outfits], lods=lod_out)
    print(f"[{bid}] {sname}: " + " / ".join(f"{a['tris']} tris (outfit max {max(a['per_outfit'])})" for a in lod_out) + f"  {time.time() - t1:.1f}s", flush=True)

os.makedirs(cache, exist_ok=True)
with open(os.path.join(cache, bid + ".pkl"), "wb") as f:
    pickle.dump(out, f)
print(f"[{bid}] done {time.time() - t0:.1f}s", flush=True)
