"""
Mesh helpers for the figure pipeline: a small numpy mesh type (Part), cutting with planes (bmesh), offsetting
and loosening shells, lofting rings into tubes, nearest-point weight transfer and ray tests against the body.
"""
import math
import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

from mh import BONES, BI

LEG = [BI[b] for b in ("thigh_l", "calf_l", "foot_l", "ball_l", "thigh_r", "calf_r", "foot_r", "ball_r")]
ARM = [BI[b] for b in ("upperarm_l", "lowerarm_l", "hand_l", "upperarm_r", "lowerarm_r", "hand_r")]
TORSO = [BI[b] for b in ("pelvis", "spine_01", "spine_02", "spine_03", "clavicle_l", "clavicle_r")]
NECKHEAD = [BI["neck_01"], BI["head"]]


class Part:
    """A garment or body piece. faces: list of index tuples (tris/quads). fuv: per-face list of (u, v) per corner."""

    def __init__(self, name, co, faces, fuv=None, slot=1, layer=1, mask=0xFFFF, W=None):
        self.name = name
        self.co = np.asarray(co, dtype=np.float64)
        self.faces = [tuple(int(i) for i in f) for f in faces]
        self.fuv = fuv
        self.slot = slot
        self.layer = layer
        self.mask = mask
        self.W = W
        # per-face outfit masks (filled by coverage), per-vertex AO
        self.fmask = None
        self.ao = None
        self.thick = 0.01
        self.tags = {}

    def copy(self, name=None):
        p = Part(name or self.name, self.co.copy(), list(self.faces), None if self.fuv is None else [list(x) for x in self.fuv], self.slot, self.layer, self.mask,
                 None if self.W is None else self.W.copy())
        p.thick = self.thick
        p.tags = dict(self.tags)
        return p

    @property
    def ntris(self):
        return sum(len(f) - 2 for f in self.faces)


def submesh(co, faces, fuv, keep_face):
    """Extract the faces where keep_face[i] is True, with compacted vertices."""
    sel = [i for i, k in enumerate(keep_face) if k]
    used = sorted({v for i in sel for v in faces[i]})
    remap = {v: j for j, v in enumerate(used)}
    nf = [tuple(remap[v] for v in faces[i]) for i in sel]
    nuv = [fuv[i] for i in sel] if fuv is not None else None
    return np.asarray(co)[used], nf, nuv, np.array(used)


def to_bmesh(co, faces, fuv):
    bm = bmesh.new()
    vs = [bm.verts.new(tuple(c)) for c in co]
    uvl = bm.loops.layers.uv.new("uv")
    for i, f in enumerate(faces):
        try:
            ff = bm.faces.new([vs[j] for j in f])
        except ValueError:
            continue
        if fuv is not None:
            for k, lp in enumerate(ff.loops):
                lp[uvl].uv = fuv[i][k]
    bm.verts.ensure_lookup_table()
    return bm


def from_bmesh(bm):
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    uvl = bm.loops.layers.uv.get("uv")
    co = np.array([v.co[:] for v in bm.verts])
    faces, fuv = [], []
    for f in bm.faces:
        faces.append(tuple(v.index for v in f.verts))
        fuv.append([tuple(lp[uvl].uv) for lp in f.loops] if uvl else [(0, 0)] * len(f.verts))
    return co, faces, fuv


def cut(part, point, normal):
    """Keep the side of the plane the normal points to."""
    bm = to_bmesh(part.co, part.faces, part.fuv)
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=Vector(point), plane_no=Vector(normal), clear_inner=True)
    # drop loose verts
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    co, faces, fuv = from_bmesh(bm)
    bm.free()
    part.co, part.faces, part.fuv = co, faces, fuv
    return part


def keep_largest_islands(part, pred=None):
    """Keep connected islands (optionally those whose centroid satisfies pred)."""
    n = len(part.co)
    parent = list(range(n))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for f in part.faces:
        for k in range(1, len(f)):
            ra, rb = find(f[0]), find(f[k])
            if ra != rb:
                parent[ra] = rb
    comp = np.array([find(i) for i in range(n)])
    keep = []
    for i, f in enumerate(part.faces):
        keep.append(True)
    if pred is not None:
        ids = np.unique(comp)
        ok = {}
        for c in ids:
            idx = np.where(comp == c)[0]
            ok[c] = pred(part.co[idx].mean(0), len(idx))
        keep = [ok[comp[f[0]]] for f in part.faces]
    co, faces, fuv, _ = submesh(part.co, part.faces, part.fuv, keep)
    part.co, part.faces, part.fuv = co, faces, fuv
    return part


def adjacency(n, faces):
    nb = [set() for _ in range(n)]
    for f in faces:
        for k in range(len(f)):
            a, b = f[k], f[(k + 1) % len(f)]
            nb[a].add(b)
            nb[b].add(a)
    return [np.array(sorted(s), dtype=np.int64) for s in nb]


def boundary_verts(n, faces):
    from collections import Counter
    ec = Counter()
    for f in faces:
        for k in range(len(f)):
            a, b = f[k], f[(k + 1) % len(f)]
            ec[(min(a, b), max(a, b))] += 1
    out = np.zeros(n, dtype=bool)
    for (a, b), c in ec.items():
        if c == 1:
            out[a] = out[b] = True
    return out


def vertex_normals(co, faces):
    vn = np.zeros_like(co)
    for f in faces:
        p = co[list(f)]
        # Newell normal (area weighted)
        nrm = np.zeros(3)
        for k in range(len(f)):
            a, b = p[k], p[(k + 1) % len(f)]
            nrm += np.array([(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])])
        for v in f:
            vn[v] += nrm
    ln = np.linalg.norm(vn, axis=1, keepdims=True)
    return vn / np.maximum(ln, 1e-12)


def laplacian(co, nb, iters, lam=0.5, fixed=None):
    co = co.copy()
    for _ in range(iters):
        avg = np.array([co[n].mean(0) if len(n) else co[i] for i, n in enumerate(nb)])
        d = avg - co
        if fixed is not None:
            d[fixed] = 0
        co += lam * d
    return co


class BodyField:
    """Nearest-point queries and rays against a body mesh (rest pose)."""

    def __init__(self, co, polys, W, allow=None):
        self.co = co
        self.polys = polys
        self.W = W
        if allow is not None:
            self.polys = [p for p in polys if all(allow[v] for v in p)]
        self.tree = BVHTree.FromPolygons([tuple(c) for c in co], self.polys, all_triangles=False)

    def nearest(self, p):
        loc, nrm, idx, dist = self.tree.find_nearest(Vector(p))
        return loc, nrm, idx, dist

    def weights_at(self, p):
        loc, nrm, idx, dist = self.tree.find_nearest(Vector(p))
        if idx is None:
            return None
        poly = self.polys[idx]
        pts = self.co[list(poly)]
        d = np.linalg.norm(pts - np.array(loc), axis=1)
        w = 1.0 / np.maximum(d, 1e-5) ** 2
        w /= w.sum()
        return (self.W[list(poly)] * w[:, None]).sum(0)


def transfer_weights(part, field, smooth=2):
    W = np.zeros((len(part.co), len(BONES)))
    for i, p in enumerate(part.co):
        w = field.weights_at(p)
        if w is not None:
            W[i] = w
    if smooth:
        nb = adjacency(len(part.co), part.faces)
        for _ in range(smooth):
            W = 0.5 * W + 0.5 * np.array([W[n].mean(0) if len(n) else W[i] for i, n in enumerate(nb)])
    s = W.sum(1, keepdims=True)
    part.W = np.where(s > 0, W / np.maximum(s, 1e-9), 0)
    return part


def inflate(part, field, clearance, iters=3, smooth=0, lam=0.5, fixed_boundary=False):
    """Move every vertex out to at least `clearance` from the body surface (along the outward direction), with optional
    Laplacian loosening between passes (removes anatomical detail, bridges hollows)."""
    nb = adjacency(len(part.co), part.faces)
    fixed = boundary_verts(len(part.co), part.faces) if fixed_boundary else None
    co = part.co.copy()
    clr = np.broadcast_to(np.asarray(clearance, dtype=np.float64), (len(co),))
    for it in range(iters):
        if smooth:
            co = laplacian(co, nb, smooth, lam, fixed)
        for i in range(len(co)):
            loc, nrm, idx, dist = field.nearest(co[i])
            if loc is None:
                continue
            d = co[i] - np.array(loc)
            dl = np.linalg.norm(d)
            n = np.array(nrm)
            if dl < 1e-6 or np.dot(d, n) < 0:
                # inside or on the surface: push along the surface normal
                co[i] = np.array(loc) + n * clr[i]
            elif dl < clr[i]:
                co[i] = np.array(loc) + d / dl * clr[i]
    part.co = co
    return part


def offset_normals(part, d):
    vn = vertex_normals(part.co, part.faces)
    part.co = part.co + vn * np.asarray(d)[..., None] if np.ndim(d) else part.co + vn * d
    return part


# ------------------------------------------------------------------------------------------- lofts

def loft(rings, closed=True, uv_rect=(0.52, 0.0, 0.98, 1.0), cap_bottom=False):
    """Rings: list of (N, 3) arrays (same N), top to bottom. Returns co, faces (quads), fuv (cylindrical)."""
    R = len(rings)
    N = len(rings[0])
    co = np.concatenate(rings)
    faces, fuv = [], []
    u0, v0, u1, v1 = uv_rect
    seg = N if closed else N - 1
    # cumulative height for v
    zs = [r[:, 2].mean() for r in rings]
    for r in range(R - 1):
        for k in range(seg):
            a = r * N + k
            b = r * N + (k + 1) % N
            c = (r + 1) * N + (k + 1) % N
            d = (r + 1) * N + k
            faces.append((a, d, c, b))
            ua = u0 + (u1 - u0) * k / seg
            ub = u0 + (u1 - u0) * (k + 1) / seg
            va = v0 + (v1 - v0) * min(1.0, max(0.0, zs[r] / 2.0))
            vb = v0 + (v1 - v0) * min(1.0, max(0.0, zs[r + 1] / 2.0))
            fuv.append([(ua, va), (ua, vb), (ub, vb), (ub, va)])
    return co, faces, fuv


def hull2d(pts):
    pts = sorted(set(map(tuple, np.round(pts, 5))))
    if len(pts) < 3:
        return np.array(pts)

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return np.array(lo[:-1] + up[:-1])


def ray_poly_radius(hull, c, ang):
    """Distance from c along angle ang to the boundary of convex polygon hull."""
    d = np.array([math.cos(ang), math.sin(ang)])
    best = 0.0
    n = len(hull)
    for i in range(n):
        a, b = hull[i] - c, hull[(i + 1) % n] - c
        e = b - a
        den = d[0] * (-e[1]) - d[1] * (-e[0])
        if abs(den) < 1e-12:
            continue
        t = (a[0] * (-e[1]) - a[1] * (-e[0])) / den
        s = (d[0] * a[1] - d[1] * a[0]) / den
        if t > 0 and -1e-6 <= s <= 1 + 1e-6:
            best = max(best, t)
    return best


def section_hull(co, sel, z, dz=0.02):
    """2D convex hull (x, y) of the selected vertices within z +- dz."""
    m = sel & (np.abs(co[:, 2] - z) < dz)
    if m.sum() < 3:
        return None
    return hull2d(co[m][:, :2])
