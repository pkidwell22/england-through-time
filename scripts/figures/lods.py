"""
Levels of detail for one dressed body: every part decimated to a budget (Blender's collapse decimation), then the
outfit masks (a face is drawn in an outfit only when its part belongs to that outfit and nothing worn over it in that
outfit covers it; faces covered in every outfit are deleted), per-vertex ambient occlusion, and the final interleaved
arrays in three.js axes.
"""
import math
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

import geo
from garments import SKIN, EYE, HAIR
from mh import BONES

# triangles per square metre of garment surface, and per-part limits, by level
DENSITY = [650.0, 200.0, 22.0, 5.0]
LIMITS = [(40, 1100), (14, 300), (10, 48), (4, 14)]
BODY_TRIS = [3300, 1100, 262, 84]
EYE_TRIS = [140, 30, 0, 0]


def part_area(p):
    a = 0.0
    for f in p.faces:
        pts = p.co[list(f)]
        for k in range(1, len(f) - 1):
            a += 0.5 * np.linalg.norm(np.cross(pts[k] - pts[0], pts[k + 1] - pts[0]))
    return a


def decimate(p, target, protect=None):
    """Decimate a part to about `target` triangles; returns a new part (triangles) with weights and UVs carried."""
    cur = p.ntris
    me = bpy.data.meshes.new("dec")
    me.from_pydata([tuple(map(float, c)) for c in p.co], [], [tuple(f) for f in p.faces])
    me.update()
    uvl = me.uv_layers.new(name="uv")
    li = 0
    for fi, poly in enumerate(me.polygons):
        for k, l in enumerate(poly.loop_indices):
            uvl.data[l].uv = p.fuv[fi][k] if p.fuv is not None else (0.5, 0.5)
    ob = bpy.data.objects.new("dec", me)
    bpy.context.scene.collection.objects.link(ob)
    vg = [ob.vertex_groups.new(name=b) for b in BONES]
    W = p.W
    for b in range(len(BONES)):
        idx = np.where(W[:, b] > 1e-4)[0]
        for i in idx:
            vg[b].add([int(i)], float(W[i, b]), "REPLACE")
    if protect is not None:
        g = ob.vertex_groups.new(name="protect")
        for i, w in enumerate(protect):
            g.add([i], float(w), "REPLACE")
    if target < cur:
        m = ob.modifiers.new("d", "DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = max(0.002, target / cur)
        m.use_collapse_triangulate = True
        # symmetric collapse keeps the body even, but cracks open lofts along their seam
        m.use_symmetry = protect is not None
        m.symmetry_axis = "X"
        if protect is not None:
            m.vertex_group = "protect"
            m.vertex_group_factor = 1.0
    else:
        m = ob.modifiers.new("t", "TRIANGULATE")
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    em = ev.to_mesh()
    em.calc_loop_triangles()
    co = np.array([v.co[:] for v in em.vertices])
    nW = np.zeros((len(co), len(BONES)))
    gidx = {g.index: g.name for g in ob.vertex_groups}
    bi = {b: i for i, b in enumerate(BONES)}
    for v in em.vertices:
        for g in v.groups:
            nm = gidx.get(g.group)
            if nm in bi:
                nW[v.index, bi[nm]] = g.weight
    s = nW.sum(1, keepdims=True)
    nW = np.where(s > 0, nW / np.maximum(s, 1e-9), 0)
    uvd = em.uv_layers[0].data if len(em.uv_layers) else None
    faces, fuv = [], []
    for t in em.loop_triangles:
        faces.append(tuple(t.vertices))
        fuv.append([tuple(uvd[l].uv) if uvd else (0.5, 0.5) for l in t.loops])
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.meshes.remove(me)
    q = geo.Part(p.name, co, faces, fuv, p.slot, p.layer, p.mask, nW)
    q.thick = p.thick
    q.tags = dict(p.tags)
    return q


def reshell(orig, body):
    """A shell garment re-made at the resolution of a decimated body: the body faces under the garment, each vertex
    moved out along its normal onto the original garment surface. Weights are the body's own, so garment and body
    deform identically and the coarse levels cannot poke through each other."""
    tree = BVHTree.FromPolygons([tuple(c) for c in orig.co], orig.faces, all_triangles=False)
    vn = geo.vertex_normals(body.co, body.faces)
    reach = orig.thick + 0.05
    hit = np.zeros(len(body.co), bool)
    newco = body.co.copy()
    for i, (c, n) in enumerate(zip(body.co, vn)):
        o = Vector(c - n * 0.004)
        loc, nrm, idx, dist = tree.ray_cast(o, Vector(n), reach)
        if loc is None:
            loc, nrm, idx, dist = tree.find_nearest(Vector(c), reach * 0.8)
            if loc is None:
                continue
            if np.dot(np.array(loc) - c, n) < -0.004:
                continue
        hit[i] = True
        newco[i] = np.array(loc) + n * 0.0015
    keep = [all(hit[v] for v in f) for f in body.faces]
    if not any(keep):
        return None
    co, faces, _, used = geo.submesh(newco, body.faces, None, keep)
    q = geo.Part(orig.name, co, faces, None, orig.slot, orig.layer, orig.mask, body.W[used].copy())
    q.thick = orig.thick
    q.tags = dict(orig.tags)
    geo.keep_largest_islands(q, pred=lambda c, n: n >= 4)
    if not q.faces:
        return None
    # carry the weights through the island filter
    from mathutils.kdtree import KDTree as _KD
    kd = _KD(len(co))
    for j, c in enumerate(co):
        kd.insert(c, j)
    kd.balance()
    W0 = body.W[used]
    q.W = np.array([W0[kd.find(c)[1]] for c in q.co])
    from garments import cyl_uv
    if q.slot in (SKIN,):
        pass
    cyl_uv(q)
    return q


def orient(p):
    """Make every island's faces wind outwards (normals away from the island's centre)."""
    n = len(p.co)
    parent = list(range(n))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for f in p.faces:
        for k in range(1, len(f)):
            ra, rb = find(f[0]), find(f[k])
            if ra != rb:
                parent[ra] = rb
    comp = np.array([find(i) for i in range(n)])
    fcomp = np.array([comp[f[0]] for f in p.faces])
    flip = {}
    for c in np.unique(fcomp):
        fi = np.where(fcomp == c)[0]
        vids = np.unique(np.array([v for i in fi for v in p.faces[i]]))
        cen = p.co[vids].mean(0)
        s = 0.0
        for i in fi:
            f = p.faces[i]
            a, b, cc = p.co[f[0]], p.co[f[1]], p.co[f[2]]
            nn = np.cross(b - a, cc - a)
            s += float(np.dot(nn, (a + b + cc) / 3 - cen))
        flip[c] = s < 0
    nf, nuv = [], []
    for i, f in enumerate(p.faces):
        if flip[fcomp[i]]:
            nf.append(tuple(reversed(f)))
            if p.fuv is not None:
                nuv.append(list(reversed(p.fuv[i])))
        else:
            nf.append(f)
            if p.fuv is not None:
                nuv.append(p.fuv[i])
    p.faces = nf
    if p.fuv is not None:
        p.fuv = nuv
    return p


def lod_parts(parts, lod, body_protect=None):
    out = []
    body = None
    for p in parts:
        if p.name == "body":
            body = decimate(p, BODY_TRIS[lod], protect=body_protect)
            out.append(body)
            break
    for p in parts:
        if p.name == "body":
            continue
        if p.name == "eyes":
            if EYE_TRIS[lod] == 0:
                continue
            q = decimate(p, EYE_TRIS[lod])
        elif lod > 0 and p.tags.get("shell"):
            # coarse levels: shell garments are painted onto the body (see paint_body)
            continue
        else:
            lo, hi = LIMITS[lod]
            target = int(np.clip(part_area(p) * DENSITY[lod], lo, hi))
            q = decimate(p, target)
        out.append(q)
    for q in out:
        orient(q)
    return out


class Cover:
    """Ray / nearest tests against one (original, outward-wound) garment part."""

    def __init__(self, q):
        self.q = q
        self.tree = BVHTree.FromPolygons([tuple(c) for c in q.co], q.faces, all_triangles=False)
        bnd = np.where(geo.boundary_verts(len(q.co), q.faces))[0]
        self.kd = KDTree(max(1, len(bnd)))
        for j, i in enumerate(bnd):
            self.kd.insert(q.co[i], j)
        self.kd.balance()
        self.nb = len(bnd)
        closed_loft = q.tags.get("loft", False)
        self.reach = q.tags.get("reach", 0.32 if closed_loft else q.thick + 0.045)
        self.margin = q.tags.get("margin", 0.03)
        self.closed = bool(q.tags.get("shell") or closed_loft)

    def covers(self, c, n, coarse=False, use_margin=True, margin_k=None):
        o = Vector(c) + Vector(n) * 0.002
        loc, nrm, idx, dist = self.tree.ray_cast(o, Vector(n), self.reach)
        if loc is None and self.closed:
            loc, nrm, idx, dist = self.tree.find_nearest(Vector(c), self.reach + (0.04 if coarse else 0.02))
            if loc is not None and np.dot(np.array(loc) - np.array(c), np.array(nrm)) < -0.003:
                loc = None
        if loc is None:
            return False
        if self.nb and use_margin:
            _, _, dmin = self.kd.find(loc)
            if dmin < self.margin * (margin_k if margin_k is not None else (0.5 if coarse else 1.0)):
                return False
        return True


def paint_body(body, shells, blockers, n_outfits, lod):
    """Coarse levels: every body face takes, per outfit, the slot of the outermost shell garment over it (or skin), and is
    hidden where a skirt, cloak, hat or the like covers it. Faces whose slot differs between outfits are duplicated, one
    copy per slot, each drawn only in its outfits. Returns one part per slot (sharing the body's vertices and normals)."""
    full = (1 << n_outfits) - 1
    fn = face_normals(body.co, body.faces)
    vn = geo.vertex_normals(body.co, body.faces)
    cs = [Cover(q) for q in shells]
    bs = [Cover(q) for q in blockers]
    coarse = lod >= 2
    per_slot = {}
    for fi, f in enumerate(body.faces):
        pts = [body.co[v] for v in f] + [body.co[list(f)].mean(0)]
        ns = [vn[v] for v in f] + [fn[fi]]
        sh = np.array([[c.covers(p, n, coarse, margin_k=0.35) if (c.q.mask & full) else False for c in cs] for p, n in zip(pts, ns)]).reshape(len(pts), len(cs))
        bl = np.array([[b.covers(p, n, coarse) for b in bs] for p, n in zip(pts, ns)]).reshape(len(pts), len(bs))
        for o in range(n_outfits):
            bit = 1 << o
            bact = np.array([(b.q.mask & bit) != 0 for b in bs], bool)
            if len(bs) and (bl[:, bact].any(1)).sum() >= 3:
                continue
            # outermost active shell per sample point
            votes = {}
            for k in range(len(pts)):
                best = None
                for j, c in enumerate(cs):
                    if sh[k, j] and (c.q.mask & bit) and (best is None or c.q.layer > cs[best].q.layer):
                        best = j
                key = -1 if best is None else best
                votes[key] = votes.get(key, 0) + (1.5 if k == len(pts) - 1 else 1.0)
            win = max(votes.items(), key=lambda kv: (kv[1], -1 if kv[0] < 0 else cs[kv[0]].q.layer))[0]
            slot = SKIN if win < 0 else cs[win].q.slot
            per_slot.setdefault(slot, {}).setdefault(fi, 0)
            per_slot[slot][fi] |= bit
    out = []
    for slot, fmap in per_slot.items():
        fis = sorted(fmap)
        q = geo.Part("body" if slot == SKIN else f"paint{slot}", body.co, [body.faces[i] for i in fis], [body.fuv[i] for i in fis], slot, 0, full, body.W)
        q.fmask = np.array([fmap[i] for i in fis], dtype=np.int64)
        q.vn = vn
        q.tags["painted"] = True
        out.append(q)
    return out


def face_normals(co, faces):
    f = np.array(faces)
    n = np.cross(co[f[:, 1]] - co[f[:, 0]], co[f[:, 2]] - co[f[:, 0]])
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    return n / np.maximum(ln, 1e-12)


def coverage(parts, n_outfits, refs=None):
    """Per-face outfit masks. A face of a lower part is hidden in an outfit when a higher part active in that outfit lies
    just outside it (rays along the face normal from its corners and centre). Upper parts are tested in their original
    (undecimated) form when `refs` (name -> part) is given, so a coarse garment that sinks a little never lets the body
    through."""
    full = (1 << n_outfits) - 1
    trees, bkd, reach, margin = [], [], [], []
    for q0 in parts:
        q = refs.get(q0.name, q0) if refs else q0
        trees.append(BVHTree.FromPolygons([tuple(c) for c in q.co], q.faces, all_triangles=False))
        bnd = geo.boundary_verts(len(q.co), q.faces)
        idx = np.where(bnd)[0]
        kd = KDTree(max(1, len(idx)))
        for j, i in enumerate(idx):
            kd.insert(q.co[i], j)
        kd.balance()
        bkd.append((kd, len(idx)))
        closed_loft = q.tags.get("loft", False)
        reach.append(q.tags.get("reach", 0.32 if closed_loft else q.thick + 0.045))
        margin.append(q.tags.get("margin", 0.03))
    for pi, p in enumerate(parts):
        if p.tags.get("painted"):
            continue
        fn = face_normals(p.co, p.faces)
        fm = np.full(len(p.faces), p.mask & full, dtype=np.int64)
        if p.name == "eyes":
            p.fmask = fm
            continue
        uppers = [qi for qi, q in enumerate(parts) if q.layer > p.layer and qi != pi]
        if not uppers:
            p.fmask = fm
            continue
        for fi, f in enumerate(p.faces):
            pts = [p.co[v] for v in f] + [p.co[list(f)].mean(0)]
            n = Vector(fn[fi])
            # hit[k, j]: sample point k is under upper part j (beyond that part's hem margin)
            hit = np.zeros((len(pts), len(uppers)), bool)
            for j, qi in enumerate(uppers):
                if (parts[qi].mask & fm[fi]) == 0:
                    continue
                kd, nb = bkd[qi]
                closed = parts[qi].tags.get("shell") or parts[qi].tags.get("loft")
                for kk, c in enumerate(pts):
                    o = Vector(c) + n * 0.002
                    loc, nrm, idx, dist = trees[qi].ray_cast(o, n, reach[qi])
                    if loc is None and closed:
                        # coarse levels: a point lying under a wrapping garment (nearest garment point above it)
                        loc, nrm, idx, dist = trees[qi].find_nearest(Vector(c), reach[qi] + 0.02)
                        if loc is not None:
                            # garments are wound outwards (orient), so a point under one has it along the normal
                            g = np.array(loc) - np.array(c)
                            if np.dot(g, np.array(nrm)) < -0.003:
                                loc = None
                    if loc is None:
                        continue
                    if nb:
                        _, _, dmin = kd.find(loc)
                        if dmin < margin[qi]:
                            continue
                    hit[kk, j] = True
            if not hit.any():
                continue
            m = int(fm[fi])
            for o in range(n_outfits):
                if not (m >> o) & 1:
                    continue
                act = np.array([(parts[qi].mask >> o) & 1 for qi in uppers], bool)
                if (hit[:, act].any(1)).sum() >= 3:
                    m &= ~(1 << o)
            fm[fi] = m
        p.fmask = fm
    return parts


def ambient(parts, ref_names):
    """Per-vertex ambient occlusion against the body and the parts in ref_names (plus each part itself)."""
    ref = [q for q in parts if q.name in ref_names or q.name == "body"]
    rng = np.random.default_rng(7)
    dirs = []
    for i in range(14):
        u, v = rng.random(), rng.random()
        r = math.sqrt(u)
        th = 2 * math.pi * v
        dirs.append((r * math.cos(th), r * math.sin(th), math.sqrt(max(0.0, 1 - u))))
    dirs = np.array(dirs)
    big_co, big_f = [], []
    off = 0
    for q in ref:
        big_co.append(q.co)
        big_f += [tuple(i + off for i in f) for f in q.faces]
        off += len(q.co)
    tree = BVHTree.FromPolygons([tuple(c) for c in np.concatenate(big_co)], big_f, all_triangles=True)
    for p in parts:
        own = BVHTree.FromPolygons([tuple(c) for c in p.co], p.faces, all_triangles=True) if p not in ref else None
        vn = geo.vertex_normals(p.co, p.faces)
        ao = np.ones(len(p.co))
        for i, (c, n) in enumerate(zip(p.co, vn)):
            t = np.cross(n, [0, 0, 1] if abs(n[2]) < 0.9 else [1, 0, 0])
            t /= max(np.linalg.norm(t), 1e-9)
            b = np.cross(n, t)
            occ = 0.0
            o = Vector(c + n * 0.003)
            for d in dirs:
                w = t * d[0] + b * d[1] + n * d[2]
                dv = Vector(w)
                loc, _, _, dist = tree.ray_cast(o, dv, 0.25)
                if loc is None and own is not None:
                    loc, _, _, dist = own.ray_cast(o, dv, 0.25)
                if loc is not None:
                    occ += 1.0 - min(1.0, dist / 0.25) * 0.6
            ao[i] = 1.0 - 0.75 * occ / len(dirs)
        p.ao = ao
    return parts


def eye_shade(p, B):
    """Eyes: dark iris/pupil disc facing forward, off-white elsewhere (stored in the AO channel)."""
    sh = np.ones(len(p.co))
    for s in "lr":
        c = B.J[f"{s}-eye"]
        m = (np.sign(p.co[:, 0]) == (1 if s == "l" else -1))
        d = p.co - c
        dn = d / np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
        ang = np.degrees(np.arccos(np.clip(-dn[:, 1], -1, 1)))
        sh = np.where(m & (ang < 24), 0.22, np.where(m & (ang < 30), 0.5, sh))
    p.ao = sh
    return p


C = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], dtype=np.float64)


def to_arrays(parts):
    """Interleave the visible faces of all parts. Vertices are split where uv or outfit mask differ."""
    pos, nrm, uv, bones, weights, fig, idx = [], [], [], [], [], [], []
    vmap = {}
    tris = 0
    for pi, p in enumerate(parts):
        vn = getattr(p, "vn", None)
        if vn is None:
            vn = geo.vertex_normals(p.co, p.faces)
        W = p.W
        order = np.argsort(-W, axis=1)[:, :4]
        for fi, f in enumerate(p.faces):
            m = int(p.fmask[fi])
            if m == 0:
                continue
            tris += 1
            for k, v in enumerate(f):
                u = p.fuv[fi][k] if p.fuv is not None else (0.5, 0.5)
                key = (pi, v, round(u[0], 4), round(u[1], 4), m)
                j = vmap.get(key)
                if j is None:
                    j = len(pos)
                    vmap[key] = j
                    pos.append(C @ p.co[v])
                    nrm.append(C @ vn[v])
                    uv.append(u)
                    bi = order[v]
                    w = W[v, bi]
                    w = w / max(w.sum(), 1e-9)
                    q = np.floor(w * 255 + 0.5).astype(int)
                    q[0] += 255 - q.sum()
                    bones.append(bi)
                    weights.append(q)
                    ao = p.ao[v] if p.ao is not None else 1.0
                    fig.append((p.slot, m, int(round(np.clip(ao, 0, 1) * 255)), 0))
                idx.append(j)
    return dict(
        pos=np.array(pos, dtype=np.float32).reshape(-1, 3),
        nrm=np.array(nrm, dtype=np.float32).reshape(-1, 3),
        uv=np.array(uv, dtype=np.float32).reshape(-1, 2),
        bones=np.array(bones, dtype=np.uint8).reshape(-1, 4),
        weights=np.array(weights, dtype=np.uint8).reshape(-1, 4),
        fig=np.array(fig, dtype=np.uint16).reshape(-1, 4),  # slot, outfit mask, ao (0..255), 0
        idx=np.array(idx, dtype=np.uint32),
        tris=tris,
    )
