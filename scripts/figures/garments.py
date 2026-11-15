"""
Procedural period garments over an MPFB body (rest pose: relaxed standing, Z up, facing -Y).

Garments are built from three kinds of geometry:
  * shells: regions of MPFB's own fitted helper "tights" (or of the body for heads and feet), cut with planes,
    pushed out to a clearance from the body and loosened by smoothing (tunic bodies, sleeves, hose, coifs, hoods);
  * lofts: rings stacked from a waist, hip or shoulder line down to a hem, each ring the convex outline of the body at
    that height plus ease, never narrowing downwards (skirts, gowns, cloaks, short skirts of tunics and jacks);
  * small parametric solids (caps, hats, helmets, ruffs, belts, hair ties).
Every part carries one tint slot (see SLOTS); colours come from the runtime palette, not from the mesh.
"""
import math
import numpy as np

import geo
from geo import Part, LEG, ARM, TORSO, NECKHEAD
from mh import BI

# tint slots (must match src/scene/pop/figureShader.ts)
SKIN, MAIN, SECOND, OUTER, HEADW, LINEN, LEATHER, HAIR, METAL, EYE, WRAP = range(11)


class Body:
    def __init__(self, d):
        self.d = d
        self.spec = d["spec"]
        self.co = d["co"]
        self.W = d["W"]
        self.dom = np.argmax(self.W, axis=1)
        n = len(self.co)
        R = d["regions"]
        self.inbody = np.zeros(n, bool)
        self.inbody[R["body"]] = True
        self.intights = np.zeros(n, bool)
        self.intights[R["helper-tights"]] = True
        J = d["joints"]
        self.J = J
        bz = self.co[self.inbody][:, 2]
        self.height = float(bz.max() - bz.min())
        self.z_top = float(bz.max())
        self.k = self.height / 1.72
        self.leg = np.isin(self.dom, LEG)
        self.arm = np.isin(self.dom, ARM)
        self.torso = np.isin(self.dom, TORSO)
        self.headv = np.isin(self.dom, NECKHEAD)
        self.z_ankle = float((J["l-ankle"][2] + J["r-ankle"][2]) / 2)
        self.z_knee = float((J["l-knee"][2] + J["r-knee"][2]) / 2)
        self.z_hip = float(J["pelvis"][2])
        self.z_crotch = float(self.co[self.inbody & self.torso & (np.abs(self.co[:, 0]) < 0.02)][:, 2].min())
        # natural waist (about 0.62 of stature; the MPFB spine joints are not at the waist)
        self.z_waist = self.z_hip + 0.15 * self.k
        self.z_neck = float(J["neck"][2])
        self.z_shoulder = float((J["l-shoulder"][2] + J["r-shoulder"][2]) / 2)
        self.z_chin = float(J["jaw"][2]) - 0.03 * self.k
        self.eye = (J["l-eye"] + J["r-eye"]) / 2
        self.z_eye = float(self.eye[2])
        self.z_mouth = float(J["mouth"][2])
        self.headc = np.array([0.0, float(J["head"][1]), float(J["head"][2])])
        self.z_brow = self.z_eye + 0.028 * self.k
        self.shoulder = {s: J[f"{s}-shoulder"] for s in "lr"}
        self.elbow = {s: J[f"{s}-elbow"] for s in "lr"}
        self.wrist = {s: J[f"{s}-hand"] for s in "lr"}
        bpolys = [p for p in d["polys"] if all(self.inbody[v] for v in p)]
        self.body_polys = bpolys
        self.field = geo.BodyField(self.co, bpolys, self.W)
        nonarm = ~self.arm
        self.field_noarm = geo.BodyField(self.co, bpolys, self.W, allow=nonarm | ~self.inbody)
        self._tights = None

    # -------------------------------------------------------------------------- bases
    def tights(self, drop=None):
        """The MPFB tights helper as a part; drop = 'arm' or 'leg' removes faces nearest to those bones."""
        if self._tights is None:
            co, faces, fuv, _ = geo.submesh(self.co, self.d["polys"], None, [all(self.intights[v] for v in p) for p in self.d["polys"]])
            from mathutils.kdtree import KDTree
            body_idx = np.where(self.inbody)[0]
            kd = KDTree(len(body_idx))
            for j, i in enumerate(body_idx):
                kd.insert(self.co[i], j)
            kd.balance()
            dom = np.array([self.dom[body_idx[kd.find(c)[1]]] for c in co])
            self._tights = (co, faces, dom)
        co, faces, dom = self._tights
        if drop:
            bad = np.isin(dom, ARM if drop == "arm" else LEG)
            keep = [sum(bad[v] for v in f) * 2 < len(f) for f in faces]
            c2, f2, _, _ = geo.submesh(co, faces, None, keep)
            return Part("tights", c2, f2)
        return Part("tights", co.copy(), list(faces))

    def body_part(self):
        polys = self.d["polys"]
        keep = [all(self.inbody[v] for v in p) for p in polys]
        co, faces, fuv, used = geo.submesh(self.co, polys, [[(u * 0.5, v) for (u, v) in uv] for uv in self.d["puv"]], keep)
        p = Part("body", co, faces, fuv, slot=SKIN, layer=0)
        p.W = self.W[used].copy()
        p.thick = 0.0
        return p

    def eyes_part(self):
        R = self.d["regions"]
        sel = np.zeros(len(self.co), bool)
        for g in ("helper-l-eye", "helper-r-eye"):
            if g in R:
                sel[R[g]] = True
        polys = self.d["polys"]
        co, faces, fuv, used = geo.submesh(self.co, polys, None, [all(sel[v] for v in p) for p in polys])
        p = Part("eyes", co, faces, [[(0.25, 0.5)] * len(f) for f in faces], slot=EYE, layer=0)
        p.W = np.zeros((len(co), len(BI)))
        p.W[:, BI["head"]] = 1
        p.thick = 0.0
        return p

    # -------------------------------------------------------------------------- helpers
    def arm_capsule(self, p, s, r=0.1):
        a, b = self.shoulder[s], self.wrist[s]
        ab = b - a
        t = np.clip(np.dot(p - a, ab) / np.dot(ab, ab), -0.2, 1.3)
        return np.linalg.norm(p - (a + ab * t)) < r * self.k

    def in_arm(self, p, r=0.1):
        return self.arm_capsule(p, "l", r) or self.arm_capsule(p, "r", r)

    def section(self, z, which=("leg", "torso"), dz=0.02):
        sel = self.inbody.copy()
        m = np.zeros_like(sel)
        if "leg" in which:
            m |= self.leg
        if "torso" in which:
            m |= self.torso
        if "arm" in which:
            m |= self.arm
        if "head" in which:
            m |= self.headv
        return geo.section_hull(self.co, sel & m, z, dz)


# ------------------------------------------------------------------------------- uv

def cyl_uv(part, u_rect=(0.53, 0.97)):
    fuv = []
    u0, u1 = u_rect
    for f in part.faces:
        pts = part.co[list(f)]
        ang = np.arctan2(pts[:, 0], pts[:, 1]) / (2 * math.pi) + 0.5
        # keep a face from wrapping across the seam
        if ang.max() - ang.min() > 0.5:
            ang = np.where(ang < 0.5, ang + 1, ang)
        ang = np.clip(ang, 0, 1.0)
        fuv.append([(u0 + (u1 - u0) * float(a % 1.0 if a > 1 else a), float(np.clip(z / 2.0, 0, 1))) for a, z in zip(ang, pts[:, 2])])
    part.fuv = fuv
    return part


# ------------------------------------------------------------------------------- weights

def loft_weights(part, B, z_from, z_to, legmix, field=None):
    """Torso weights from the nearest non-arm body point, blended towards the thigh of each side further down."""
    geo.transfer_weights(part, field or B.field_noarm, smooth=1)
    W = part.W.copy()
    for i, p in enumerate(part.co):
        f = np.clip((z_from - p[2]) / max(1e-3, z_from - z_to), 0, 1)
        f = f * f * (3 - 2 * f)
        side = np.clip(0.5 + p[0] / (0.12 * B.k), 0, 1)
        leg = np.zeros(W.shape[1])
        leg[BI["thigh_l"]] = side
        leg[BI["thigh_r"]] = 1 - side
        torso = W[i].copy()
        # strip any calf/foot influence (the cloth hangs from the hips, it does not bend at the knee)
        for b in ("calf_l", "calf_r", "foot_l", "foot_r", "ball_l", "ball_r"):
            torso[BI[b]] = 0
        if f > 0:
            # below the hips the cloth hangs from the pelvis and is pushed by the thighs
            pel = np.zeros(W.shape[1])
            pel[BI["pelvis"]] = 1
            torso = torso * (1 - f) + pel * f
        w = torso * (1 - f * legmix) + leg * (f * legmix)
        W[i] = w / max(w.sum(), 1e-9)
    part.W = W
    return part


# ------------------------------------------------------------------------------- shells

def cut_region(part, point, normal, region):
    """Bisect with a plane but only delete faces (on the negative side) whose centroid passes `region`."""
    import bmesh
    from mathutils import Vector
    bm = geo.to_bmesh(part.co, part.faces, part.fuv)
    faces = [f for f in bm.faces if region(np.array(f.calc_center_median()[:]))]
    edges = list({e for f in faces for e in f.edges})
    verts = list({v for f in faces for v in f.verts})
    bmesh.ops.bisect_plane(bm, geom=faces + edges + verts, dist=1e-5, plane_co=Vector(point), plane_no=Vector(normal))
    P, N = np.array(point), np.array(normal)
    dele = [f for f in bm.faces if region(np.array(f.calc_center_median()[:])) and np.dot(np.array(f.calc_center_median()[:]) - P, N) < 0]
    bmesh.ops.delete(bm, geom=dele, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    co, fcs, fuv = geo.from_bmesh(bm)
    bm.free()
    part.co, part.faces, part.fuv = co, fcs, fuv
    return part


def torso_shell(B, name, slot, neck_drop=0.04, bottom_z=None, sleeve=1.0, clearance=0.012, smooth=3, layer=2, collar=0.0):
    """Upper garment body from the tights: neckline, sleeves cut at a fraction of shoulder->wrist (0 = sleeveless),
    bottom at bottom_z (the legs are removed)."""
    p = B.tights()
    k = B.k
    # neckline: tilted plane, lower at the front
    back = np.array([0, B.J["neck"][1] + 0.06, B.z_neck - 0.015 * k + collar])
    front = np.array([0, B.J["neck"][1] - 0.08, B.z_neck - (0.03 + neck_drop) * k + collar])
    d = front - back
    nrm = np.array([0, -d[2], d[1]])
    nrm = nrm / np.linalg.norm(nrm)
    if nrm[2] > 0:
        nrm = -nrm
    geo.cut(p, back, nrm)
    # sleeves
    for s in "lr":
        a, w = B.shoulder[s], B.wrist[s]
        t = max(0.02, sleeve)
        pt = a + (w - a) * (t if sleeve > 0 else 0.0)
        if sleeve <= 0:
            pt = a + np.array([(-0.01 if s == "r" else 0.01) * k, 0, -0.02 * k])
            nr = np.array([-1.0 if s == "l" else 1.0, 0, 0.35])
        else:
            nr = a - w
        nr = nr / np.linalg.norm(nr)
        side = 1 if s == "l" else -1
        geo_reg = (lambda q, s=s, side=side: (q[0] * side > 0.08 * k) and B.arm_capsule(q, s, 0.13))
        cut_region(p, pt, nr, geo_reg)
    if bottom_z is not None:
        cut_region(p, (0, 0, bottom_z), (0, 0, 1), lambda q: not B.in_arm(q, 0.085))
    geo.keep_largest_islands(p, pred=lambda c, n: n > 30)
    p.name, p.slot, p.layer = name, slot, layer
    geo.inflate(p, B.field, clearance, iters=3, smooth=smooth, lam=0.5)
    p.thick = clearance
    p.tags["shell"] = True
    cyl_uv(p)
    geo.transfer_weights(p, B.field, smooth=2)
    return p


def leg_shell(B, name, slot, top_z, bottom_z, clearance=0.005, smooth=1, layer=1, bulge=0.0):
    p = B.tights(drop="arm")
    geo.cut(p, (0, 0, top_z), (0, 0, -1))
    geo.cut(p, (0, 0, bottom_z), (0, 0, 1))
    geo.keep_largest_islands(p, pred=lambda c, n: n > 60)
    p.name, p.slot, p.layer = name, slot, layer
    if bulge > 0:
        # puffed breeches: more ease on the outer thigh, little between the legs
        clr = np.array([clearance + bulge * float(np.clip((abs(c[0]) - 0.03 * B.k) / (0.12 * B.k), 0, 1)) * math.sin(math.pi * float(np.clip((top_z - c[2]) / max(1e-3, top_z - bottom_z), 0, 1)) ** 0.7)
                        for c in p.co])
        geo.inflate(p, B.field, clr, iters=3, smooth=3, lam=0.5)
    else:
        geo.inflate(p, B.field, clearance, iters=2, smooth=smooth, lam=0.5)
    p.thick = clearance + bulge
    p.tags["shell"] = True
    cyl_uv(p)
    geo.transfer_weights(p, B.field, smooth=1)
    return p


def body_region_shell(B, name, slot, vpred, clearance, smooth=2, layer=3, iters=3, uv="cyl"):
    """Shell from body faces whose vertices all satisfy vpred(co) (used for heads and feet)."""
    co = B.co
    ok = np.array([B.inbody[i] and vpred(co[i]) for i in range(len(co))])
    keep = [all(ok[v] for v in p) for p in B.d["polys"]]
    c2, faces, fuv, used = geo.submesh(co, B.d["polys"], None, keep)
    p = Part(name, c2, faces, None, slot=slot, layer=layer)
    geo.keep_largest_islands(p, pred=lambda c, n: n > 20)
    geo.inflate(p, B.field, clearance, iters=iters, smooth=smooth, lam=0.5)
    p.thick = float(np.max(clearance))
    p.tags["shell"] = True
    cyl_uv(p)
    geo.transfer_weights(p, B.field, smooth=1)
    return p


# ------------------------------------------------------------------------------- lofts

def ring_profile(B, z, which, nseg, centre=None, ease=0.0):
    hull = B.section(z, which)
    if hull is None:
        return None, None
    c = centre if centre is not None else hull.mean(0)
    th = np.linspace(-math.pi, math.pi, nseg, endpoint=False)
    r = np.array([geo.ray_poly_radius(hull, c, a) for a in th]) + ease
    return c, r


def skirt_loft(B, name, slot, z_top, z_hem, ease_top=0.02, ease_hem=0.04, flare=0.15, folds=0.03, nseg=32, which=("leg", "torso"),
               cover=None, legmix=0.55, layer=3, seed=1, step=0.04, top_ease_extra=None):
    """A skirt (or gown/cloak body) from z_top down to z_hem. cover = (centre angle, half width) in radians for an open
    garment (cloak: centre at the back, +y = pi/2)."""
    nz = max(2, int(math.ceil((z_top - z_hem) / step)) + 1)
    zs = np.linspace(z_top, z_hem, nz)
    rng = np.random.default_rng(seed)
    ph = rng.uniform(0, 2 * math.pi, 3)
    th = np.linspace(-math.pi, math.pi, nseg, endpoint=False)
    rings_r, cs = [], []
    prev = None
    c0 = None
    for i, z in enumerate(zs):
        f = (z_top - z) / max(1e-3, z_top - z_hem)
        c, r = ring_profile(B, z, which, nseg, centre=c0)
        if r is None:
            r = prev.copy() if prev is not None else np.full(nseg, 0.15 * B.k)
            c = cs[-1] if cs else np.array([0.0, 0.0])
        if c0 is None:
            c0 = c
        r = r + ease_top + (ease_hem - ease_top) * f
        if prev is not None:
            r = np.maximum(r, prev + flare * (zs[i - 1] - z))
        # gentle vertical folds, growing towards the hem
        r_f = r * (1 + folds * f * (0.6 * np.sin(7 * th + ph[0]) + 0.4 * np.sin(12 * th + ph[1])))
        # circular smoothing
        for _ in range(2):
            r_f = 0.5 * r_f + 0.25 * (np.roll(r_f, 1) + np.roll(r_f, -1))
        prev = r
        rings_r.append(r_f)
        cs.append(c0)
    rings = []
    if cover is not None:
        a0, half = cover
        thc = np.linspace(a0 - half, a0 + half, nseg)
    for i, z in enumerate(zs):
        r = rings_r[i]
        c = cs[i]
        if cover is None:
            pts = np.stack([c[0] + r * np.cos(th), c[1] + r * np.sin(th), np.full(nseg, z)], 1)
        else:
            rr = np.interp(np.mod(thc + math.pi, 2 * math.pi) - math.pi, th, r, period=2 * math.pi)
            pts = np.stack([c[0] + rr * np.cos(thc), c[1] + rr * np.sin(thc), np.full(nseg, z)], 1)
        rings.append(pts)
    co, faces, fuv = geo.loft(rings, closed=cover is None)
    p = Part(name, co, faces, fuv, slot=slot, layer=layer)
    p.thick = ease_top
    p.tags["rings"] = rings
    if cover is None:
        p.tags["loft"] = True
        p.tags["margin"] = 0.09 if z_hem < B.z_knee + 0.1 else 0.05
    else:
        p.tags["reach"] = 0.16
    loft_weights(p, B, z_top if z_top < B.z_hip else B.z_hip, z_hem, legmix)
    return p


def cloak(B, name, slot, z_hem, half_top=2.5, half_hem=1.75, ease=0.022, nseg=30, layer=5, seed=3, legmix=0.3, hood=False):
    """A cape hung from the shoulders: a collar ring round the neck base, then the outline of shoulders and arms, down to
    z_hem. Open at the front: half-width (radians, about the back) narrows from half_top to half_hem."""
    k = B.k
    zc = B.z_neck - 0.02 * k
    zs_ = B.z_shoulder + 0.01 * k
    # collar ring
    neck_hull = B.section(zc, ("torso", "head"), dz=0.015)
    cN = neck_hull.mean(0)
    rings = []
    zs = [zc, zs_ - 0.02 * k] + list(np.arange(zs_ - 0.08 * k, z_hem - 1e-4, -0.05 * k)) + [z_hem]
    th_all = np.linspace(-math.pi, math.pi, 64, endpoint=False)
    prev = None
    c0 = None
    rng = np.random.default_rng(seed)
    ph = rng.uniform(0, 6.3, 2)
    for i, z in enumerate(zs):
        f = i / (len(zs) - 1)
        half = half_top + (half_hem - half_top) * min(1, f * 1.6)
        thc = np.linspace(math.pi / 2 - half, math.pi / 2 + half, nseg)
        if i == 0:
            c = cN
            r = np.array([geo.ray_poly_radius(neck_hull, c, a) for a in th_all]) + 0.02 * k
        else:
            hull = B.section(z, ("torso", "arm", "leg"), dz=0.02)
            if hull is None:
                r, c = prev, c0
            else:
                c = c0 if c0 is not None else hull.mean(0)
                r = np.array([geo.ray_poly_radius(hull, c, a) for a in th_all]) + ease + 0.02 * f
            if c0 is None:
                c0 = c
            if prev is not None and i > 1:
                r = np.maximum(r, prev + 0.025 * (zs[i - 1] - z))
        rf = r * (1 + 0.055 * f * (0.6 * np.sin(9 * th_all + ph[0]) + 0.4 * np.sin(15 * th_all + ph[1])))
        for _ in range(2):
            rf = 0.5 * rf + 0.25 * (np.roll(rf, 1) + np.roll(rf, -1))
        prev = r
        rr = np.interp(np.mod(thc + math.pi, 2 * math.pi) - math.pi, th_all, rf, period=2 * math.pi)
        cc = c
        pts = np.stack([cc[0] + rr * np.cos(thc), cc[1] + rr * np.sin(thc), np.full(nseg, z)], 1)
        rings.append(pts)
    co, faces, fuv = geo.loft(rings, closed=False)
    p = Part(name, co, faces, fuv, slot=slot, layer=layer)
    p.thick = ease
    p.tags["reach"] = 0.2
    p.tags["margin"] = 0.05
    loft_weights(p, B, B.z_hip, z_hem, legmix)
    # the collar and shoulders ride on the upper spine and clavicles, never on the arms
    return p


# ------------------------------------------------------------------------------- heads

def head_local(B, q):
    """(angle about the head axis: 0 = front, +-pi = back; height) for a point."""
    d = q - B.headc
    ang = math.atan2(d[0], -d[1])
    return ang, q[2]


def hair_region(B, front_drop=0.0, nape=None):
    """Hairline: high at the forehead, above the ears at the sides, at the nape behind."""
    k = B.k
    zf = B.z_brow + (0.022 - front_drop) * k
    zs = B.z_eye + 0.012 * k
    zb = (nape if nape is not None else B.z_mouth - 0.01 * k)

    def pred(q):
        if not B.headv[np.argmin(np.abs(B.co[:, 2] - q[2]))] and q[2] < B.z_chin:
            return False
        ang, z = head_local(B, q)
        a = abs(ang) / math.pi  # 0 front .. 1 back
        if a < 0.5:
            line = zf + (zs - zf) * (a / 0.5) ** 1.5
        else:
            line = zs + (zb - zs) * ((a - 0.5) / 0.5) ** 0.8
        return z > line and z > B.z_chin
    return pred


def head_dist_pred(B, base):
    """Restrict a head predicate to vertices that belong to the head and neck."""
    head = B.headv & B.inbody
    hz = B.co[head][:, 2].min()

    def pred(q):
        return q[2] > hz - 0.01 and base(q)
    return pred


def hair_short(B, slot=HAIR, thick=0.014):
    p = body_region_shell(B, "hair", slot, head_dist_pred(B, hair_region(B)), thick, smooth=3, layer=2)
    return p


def beard(B):
    k = B.k
    zn = B.z_eye - 0.045 * k  # under the nose
    zj = B.z_chin - 0.01 * k

    def pred(q):
        ang, z = head_local(B, q)
        a = abs(ang)
        if z > zn or z < zj - 0.015 * k:
            return False
        if a > 1.3:
            return False
        # leave the lips clear
        if a < 0.5 and abs(z - B.z_mouth + 0.002) < 0.009 * k:
            return False
        return True
    p = body_region_shell(B, "beard", HAIR, head_dist_pred(B, pred), 0.008, smooth=2, layer=2)
    return p


def hood_head(B, clearance=0.018, face_w=0.062, slot=HEADW, layer=6, chin=True):
    """Head covering with an oval opening for the face (hood, coif, veil base)."""
    k = B.k
    fz = (B.z_brow + 0.012 * k + B.z_chin - 0.01 * k) / 2
    fh = (B.z_brow + 0.012 * k - (B.z_chin - 0.01 * k)) / 2

    def pred(q):
        ang, z = head_local(B, q)
        d = q - B.headc
        if z < B.z_chin - (0.035 if chin else -0.01) * k:
            return False
        # face oval (front half only)
        if d[1] < 0.0 and ((q[0] / (face_w * k)) ** 2 + ((z - fz) / fh) ** 2) < 1.0:
            return False
        return True
    p = body_region_shell(B, "hood", slot, head_dist_pred(B, pred), clearance, smooth=3, layer=layer, iters=3)
    return p


def coif(B, slot=LINEN, layer=4):
    """Close linen cap covering the hair and ears, tied under the chin (ties not modelled)."""
    k = B.k

    def pred(q):
        ang, z = head_local(B, q)
        a = abs(ang) / math.pi
        line = B.z_brow + 0.03 * k if a < 0.3 else (B.z_eye - 0.035 * k if a < 0.62 else B.z_mouth - 0.02 * k)
        if a < 0.3:
            line = B.z_brow + 0.03 * k
        elif a < 0.42:
            line = B.z_brow + 0.03 * k + (B.z_eye - 0.035 * k - B.z_brow - 0.03 * k) * (a - 0.3) / 0.12
        return z > line
    return body_region_shell(B, "coif", slot, head_dist_pred(B, pred), 0.011, smooth=3, layer=layer)


def wimple(B, slot=LINEN, layer=4):
    """Linen covering the neck and chin (with a veil)."""
    k = B.k

    def pred(q):
        ang, z = head_local(B, q)
        return (z < B.z_mouth - 0.012 * k and z > B.z_neck - 0.07 * k)
    p = body_region_shell(B, "wimple", slot, lambda q: pred(q) and (B.headv[np.argmin(np.linalg.norm(B.co - q, axis=1))] or q[2] > B.z_neck - 0.07 * k), 0.012,
                          smooth=3, layer=layer)
    return p


def veil_drape(B, slot=LINEN, z_end=None, layer=7, half=2.2):
    """Cloth falling from the head over the back and shoulders."""
    k = B.k
    z0 = B.z_eye + 0.01 * k
    z1 = z_end if z_end is not None else B.z_shoulder - 0.06 * k
    th_all = np.linspace(-math.pi, math.pi, 64, endpoint=False)
    rings = []
    zs = np.linspace(z0, z1, 6)
    prev = None
    for i, z in enumerate(zs):
        hull = B.section(z, ("head", "torso", "arm") if z < B.z_neck - 0.03 * k else ("head",), dz=0.015)
        if hull is None:
            r = prev
        else:
            c = np.array([0.0, B.headc[1] + 0.01])
            r = np.array([geo.ray_poly_radius(hull, c, a) for a in th_all]) + 0.02 * k + 0.008 * (i / 5)
        if prev is not None:
            r = np.maximum(r, prev + 0.04 * (zs[i - 1] - z))
        prev = r
        thc = np.linspace(math.pi / 2 - half, math.pi / 2 + half, 26)
        rr = np.interp(np.mod(thc + math.pi, 2 * math.pi) - math.pi, th_all, r, period=2 * math.pi)
        rings.append(np.stack([rr * np.cos(thc), B.headc[1] + 0.01 + rr * np.sin(thc), np.full(len(thc), z)], 1))
    co, faces, fuv = geo.loft(rings, closed=False)
    p = Part("veil", co, faces, fuv, slot=slot, layer=layer)
    geo.transfer_weights(p, B.field_noarm, smooth=1)
    # the drape follows head and upper spine
    W = p.W
    for i, q in enumerate(p.co):
        f = np.clip((z0 - q[2]) / (z0 - z1), 0, 1)
        w = np.zeros(W.shape[1])
        w[BI["head"]] = 1 - f
        w[BI["neck_01"]] = 0.3 * f
        w[BI["spine_03"]] = 0.7 * f
        W[i] = w / w.sum()
    p.thick = 0.026
    return p


def head_ring(B, z, ease):
    hull = B.section(z, ("head",), dz=0.012)
    c = hull.mean(0)
    th = np.linspace(-math.pi, math.pi, 32, endpoint=False)
    r = np.array([geo.ray_poly_radius(hull, c, a) for a in th]) + ease
    return c, th, r


def solid_rings(name, slot, rings, cap_top=True, layer=8, weights_bone="head", nb=22):
    co, faces, fuv = geo.loft(rings, closed=True)
    if cap_top:
        top = rings[0]
        ci = len(co)
        co = np.vstack([co, top.mean(0)[None]])
        N = len(top)
        for k_ in range(N):
            faces.append((ci, k_, (k_ + 1) % N))
            fuv.append([(0.75, 0.9), (0.6, 0.95), (0.62, 0.95)])
    p = Part(name, co, faces, fuv, slot=slot, layer=layer)
    p.W = np.zeros((len(co), nb))
    p.W[:, BI[weights_bone]] = 1
    return p


def flat_cap(B, slot=HEADW, tilt=0.35):
    """Tudor flat cap: a soft, flat crown a little wider than the head on a narrow band, set slightly back."""
    k = B.k
    z = B.z_brow + 0.03 * k
    c, th, r = head_ring(B, z, 0.018 * k)
    back = 0.5 + 0.5 * np.sin(th)  # 0 front .. 1 back

    def ring(dr, dz, sc=1.0):
        rr = r * sc + dr
        zz = z + dz - tilt * 0.02 * (1 - back) * k
        return np.stack([c[0] + rr * np.cos(th), c[1] + rr * np.sin(th), zz], 1)
    rings = [ring(0.0, 0.058 * k, 0.45), ring(0.03 * k, 0.05 * k), ring(0.036 * k, 0.036 * k), ring(0.01 * k, 0.022 * k), ring(0.0, 0.0)]
    p = solid_rings("flatcap", slot, rings)
    p.thick = 0.01
    return p


def brim_hat(B, slot=HEADW, crown=0.13, brim=0.06, taper=0.88):
    """Brimmed felt hat (copotain-like when crown is tall)."""
    k = B.k
    z = B.z_brow + 0.028 * k
    c, th, r = head_ring(B, z, 0.018 * k)

    def ring(dr, dz, sc=1.0):
        rr = r * sc + dr
        return np.stack([c[0] + rr * np.cos(th), c[1] + rr * np.sin(th), np.full_like(th, z + dz)], 1)
    rings = [ring(0.0, crown * k, taper), ring(0.0, 0.012 * k, 1.0), ring(brim * k, 0.004 * k), ring(brim * k, -0.003 * k), ring(0.0, -0.004 * k)]
    p = solid_rings("hat", slot, rings)
    p.thick = 0.01
    return p


def soft_cap(B, slot=HEADW):
    """Rounded felt or knitted cap to mid-forehead."""
    k = B.k
    z = B.z_brow + 0.025 * k
    c, th, r = head_ring(B, z, 0.018 * k)
    top = B.z_top + 0.02 * k
    rings = []
    for s in np.linspace(0, 1, 6):
        zz = top - (top - z) * s
        sc = math.sin(math.pi / 2 * (0.25 + 0.75 * s)) * 1.02
        rr = r * sc + 0.004
        rings.append(np.stack([c[0] + rr * np.cos(th), c[1] + rr * np.sin(th), np.full_like(th, zz)], 1))
    p = solid_rings("cap", slot, rings)
    p.thick = 0.01
    return p


def helmet(B, slot=METAL, tail=0.0, rim_front=0.012, clearance=0.02, nape=None):
    """Iron helmet following the head: rim at the brow in front; with tail > 0 the rim drops and flares behind (a sallet)."""
    k = B.k
    zb = B.z_brow + rim_front * k
    zn = nape if nape is not None else B.z_eye - 0.01 * k
    top = B.z_top + clearance * k
    th = np.linspace(-math.pi, math.pi, 32, endpoint=False)
    c = np.array([0.0, B.headc[1] + 0.005])
    # rim height per angle: brow in front, lower behind
    a = np.abs(np.arctan2(np.cos(th), -np.sin(th))) / math.pi  # 0 front ... 1 back
    zr = zb + (zn - zb) * np.clip((a - 0.25) / 0.5, 0, 1) ** 1.2 if tail > 0 else np.full_like(th, zb)
    rings = []
    for s in np.linspace(0, 1, 7):
        rr = []
        zz = top - (top - zr) * s
        for j, ang in enumerate(th):
            hull = B.section(float(zz[j]), ("head",), dz=0.012)
            rad = geo.ray_poly_radius(hull, c, ang) if hull is not None else 0.0
            rr.append(rad)
        rr = np.array(rr) * (0.35 + 0.65 * math.sin(math.pi / 2 * min(1, s * 1.6))) + clearance * k
        rr = np.maximum(rr, 0.01)
        rings.append(np.stack([c[0] + rr * np.cos(th), c[1] + rr * np.sin(th), zz], 1))
    if tail > 0:
        last = rings[-1].copy()
        flare = np.clip((a - 0.4) / 0.6, 0, 1) * tail * k
        d = last[:, :2] - c
        dn = d / np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-6)
        last[:, :2] += dn * (0.012 * k + flare[:, None])
        last[:, 2] -= 0.015 * k + flare * 0.5
        rings.append(last)
    p = solid_rings("helmet", slot, rings)
    p.thick = clearance
    return p


def ruff(B, slot=LINEN, width=0.05, pleats=26):
    """A small starched ruff: a pleated ring standing out round the neck."""
    k = B.k
    z = B.z_neck - 0.022 * k
    hull = B.section(z, ("head",), dz=0.012)
    th = np.linspace(-math.pi, math.pi, pleats * 4, endpoint=False)
    if hull is None or len(hull) < 3:
        c = np.array([0.0, float(B.J["neck"][1])])
        r = np.full(len(th), 0.062 * k)
    else:
        c = hull.mean(0)
        r = np.array([geo.ray_poly_radius(hull, c, a) for a in th]) + 0.006
    ro = r + width * k * (1 + 0.12 * np.cos(pleats * th))
    h = 0.03 * k
    def ring(rr, dz):
        return np.stack([c[0] + rr * np.cos(th), c[1] + rr * np.sin(th), np.full_like(th, z + dz)], 1)
    rings = [ring(r, h / 2), ring(ro, h / 4), ring(ro, -h / 4), ring(r, -h / 2), ring(r, h / 2)]
    co, faces, fuv = geo.loft(rings, closed=True)
    p = Part("ruff", co, faces, fuv, slot=slot, layer=8)
    p.W = np.zeros((len(co), 22))
    p.W[:, BI["neck_01"]] = 0.6
    p.W[:, BI["spine_03"]] = 0.4
    p.thick = 0.01
    return p


def band_over(B, part, z, half=0.018, ease=0.006, name="belt", slot=LEATHER, layer=7):
    """A belt (or girdle) round the outside of `part` at height z."""
    m = np.abs(part.co[:, 2] - z) < 0.03
    # body of the part only, not the sleeves
    m &= np.array([not B.in_arm(q, 0.09) for q in part.co])
    pts = part.co[m][:, :2]
    hull = geo.hull2d(pts)
    c = hull.mean(0)
    th = np.linspace(-math.pi, math.pi, 28, endpoint=False)
    r = np.array([geo.ray_poly_radius(hull, c, a) for a in th]) + ease
    rings = [np.stack([c[0] + r * np.cos(th), c[1] + r * np.sin(th), np.full_like(th, z + dz)], 1) for dz in (half, -half)]
    co, faces, fuv = geo.loft(rings, closed=True)
    p = Part(name, co, faces, fuv, slot=slot, layer=layer)
    geo.transfer_weights(p, B.field_noarm, smooth=1)
    p.thick = 0.006
    return p


def apron(B, skirt, z_top, z_bot, half=0.7, ease=0.012):
    rings = []
    th_all = np.linspace(-math.pi, math.pi, 64, endpoint=False)
    for ring in skirt.tags["rings"]:
        z = ring[0, 2]
        if z > z_top + 1e-3 or z < z_bot - 1e-3:
            continue
        c = ring[:, :2].mean(0)
        d = ring[:, :2] - c
        ang = np.arctan2(d[:, 1], d[:, 0])
        rad = np.linalg.norm(d, axis=1)
        order = np.argsort(ang)
        thc = np.linspace(-math.pi / 2 - half, -math.pi / 2 + half, 14)
        rr = np.interp(thc, ang[order], rad[order], period=2 * math.pi) + ease
        rings.append(np.stack([c[0] + rr * np.cos(thc), c[1] + rr * np.sin(thc), np.full_like(thc, z)], 1))
    co, faces, fuv = geo.loft(rings, closed=False)
    p = Part("apron", co, faces, fuv, slot=LINEN, layer=6)
    loft_weights(p, B, B.z_hip, z_bot, 0.5)
    p.thick = ease
    return p


def shoes(B, height=0.035, slot=LEATHER):
    k = B.k
    za = B.z_ankle + height * k

    def pred(q):
        return q[2] < za
    return body_region_shell(B, "shoes", slot, pred, 0.006, smooth=4, layer=2, iters=3)


def hair_tail(B, length=0.22, r=0.028, slot=HAIR):
    """Hair gathered at the nape and falling down the back (a plait or tail)."""
    k = B.k
    # start at the back of the head, a little above the nape
    hull = B.section(B.z_mouth, ("head",), dz=0.012)
    c = np.array([0.0, B.headc[1]])
    back = geo.ray_poly_radius(hull, c, math.pi / 2) if hull is not None else 0.09
    start = np.array([0.0, B.headc[1] + back + 0.005, B.z_mouth + 0.01 * k])
    th = np.linspace(-math.pi, math.pi, 10, endpoint=False)
    rings = []
    n = 6
    for i in range(n):
        s = i / (n - 1)
        # follow the back: move down and slightly back over the upper spine
        y = start[1] + 0.03 * k * math.sin(s * math.pi * 0.8) + 0.02 * k * s
        z = start[2] - length * k * s
        rr = r * k * (1.0 - 0.45 * s)
        rings.append(np.stack([rr * np.cos(th), y + rr * 0.8 * np.sin(th), np.full_like(th, z)], 1))
    p = solid_rings("hairtail", slot, rings, cap_top=False, layer=3)
    W = p.W * 0
    for i, q in enumerate(p.co):
        f = np.clip((start[2] - q[2]) / (length * k), 0, 1)
        W[i, BI["head"]] = 1 - f
        W[i, BI["neck_01"]] = 0.4 * f
        W[i, BI["spine_03"]] = 0.6 * f
    p.W = W
    p.thick = 0.0
    return p
