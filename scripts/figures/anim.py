"""
Procedural animation on the MPFB game_engine rig, baked to skinning matrices for the crowd shader.

Layers (texture depth), each FRAMES frames:
  0 stand      the rest pose (walk blends towards it at low speed)
  1 walk slow  one gait cycle (left heel strike at phase 0), stride S1
  2 walk brisk one gait cycle, stride S2 (same stance timing, so the two blend without the feet slipping)
  3 idle       an 8 s loop: weight shift, breathing, looking about
  4 talk       an 8 s loop: as idle, with gestures and nods
  5 seated     a 10 s loop on a 0.43 m stool
  6 attention  a 6 s loop for formations: still, breathing, a little sway

Walk cycles are authored as foot trajectories (planted foot moving back at exactly one stride per cycle, heel and
ball rockers, a swing arc) solved with Blender's IK, plus pelvis bob, sway, yaw and list, spine counter-rotation and
arm swing. The runtime picks the phase from the distance walked so a planted foot does not slide.
"""
import math
import bpy
import numpy as np
from mathutils import Matrix, Vector, Quaternion

from mh import BONES

FRAMES = 24
LAYERS = ["stand", "walk_slow", "walk_brisk", "idle", "talk", "seated", "attention"]
BETA = 0.6


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


class Rigger:
    def __init__(self, rig, B):
        self.rig = rig
        self.B = B
        self.pb = rig.pose.bones
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode="POSE")
        self.rest = {b.name: b.matrix_local.copy() for b in rig.data.bones}
        self.tg, self.pole = {}, {}
        for s in "lr":
            calf = self.pb["calf_" + s]
            t = bpy.data.objects.new("ik_" + s, None)
            p = bpy.data.objects.new("pole_" + s, None)
            bpy.context.scene.collection.objects.link(t)
            bpy.context.scene.collection.objects.link(p)
            t.rotation_mode = "QUATERNION"
            self.tg[s], self.pole[s] = t, p
            c = calf.constraints.new("IK")
            c.target = t
            c.pole_target = p
            c.chain_count = 2
            c.use_tail = True
            c.use_stretch = False
            self.ikc = c
            fc = self.pb["foot_" + s].constraints.new("COPY_ROTATION")
            fc.target = t
            fc.target_space = "WORLD"
            fc.owner_space = "WORLD"
            self.footc = fc
        self.ankle0 = {s: Vector(self.rest["foot_" + s].to_translation()) for s in "lr"}
        self.ball0 = {s: Vector(self.rest["ball_" + s].to_translation()) for s in "lr"}
        self.footq0 = {s: self.rest["foot_" + s].to_quaternion() for s in "lr"}
        self.pelvis0 = self.rest["pelvis"].copy()
        # leg length (hip to ankle) in the rest pose
        self.legL = {s: (Vector(self.rest["thigh_" + s].to_translation()) - self.ankle0[s]).length for s in "lr"}
        self._pick_pole_angle()

    def _pick_pole_angle(self):
        best = None
        for ang in (-math.pi / 2, math.pi / 2, 0.0, math.pi):
            for s in "lr":
                self.pb["calf_" + s].constraints["IK"].pole_angle = ang
            self.reset()
            # bend: lower the pelvis and check the knee goes forward (-y)
            self.set_pelvis(Vector((0, 0, -0.12)), 0, 0, 0)
            self.place_foot("l", self.ankle0["l"], 0.0)
            self.place_foot("r", self.ankle0["r"], 0.0)
            bpy.context.view_layer.update()
            knee = self.pb["calf_l"].matrix.to_translation()
            hip = self.pb["thigh_l"].matrix.to_translation()
            ank = self.pb["foot_l"].matrix.to_translation()
            mid = (hip + ank) / 2
            fwd = mid.y - knee.y
            side = abs(knee.x - mid.x)
            score = fwd - 2 * side
            if best is None or score > best[0]:
                best = (score, ang)
        for s in "lr":
            self.pb["calf_" + s].constraints["IK"].pole_angle = best[1]

    def reset(self):
        for p in self.pb:
            p.location = (0, 0, 0)
            p.rotation_mode = "QUATERNION"
            p.rotation_quaternion = (1, 0, 0, 0)
            p.scale = (1, 1, 1)
        for s in "lr":
            self.pole[s].location = self.ankle0[s] + Vector((0, -0.6, 0.45))
            self.tg[s].location = self.ankle0[s]
            self.tg[s].rotation_quaternion = self.footq0[s]
        bpy.context.view_layer.update()

    def set_pelvis(self, off, yaw, roll, pitch):
        """Move/rotate the pelvis (and everything above) in armature space about the pelvis head."""
        pb = self.pb["pelvis"]
        M0 = self.pelvis0
        h = M0.to_translation()
        R = Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(roll, 4, "Y") @ Matrix.Rotation(pitch, 4, "X")
        pb.matrix = Matrix.Translation(h + off) @ R @ Matrix.Translation(-h) @ M0
        bpy.context.view_layer.update()
        for s in "lr":
            self.pole[s].location = Vector(self.pb["thigh_" + s].matrix.to_translation()) + Vector((0, -0.7, -0.35))

    def place_foot(self, s, ankle, pitch):
        """Ankle position (armature space) and pitch (+ toes up)."""
        self.tg[s].location = ankle
        self.tg[s].rotation_quaternion = Quaternion((1, 0, 0), -pitch) @ self.footq0[s]

    def rot(self, name, axis, ang):
        pb = self.pb[name]
        M = pb.matrix.copy()
        h = M.to_translation()
        pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(ang, 4, Vector(axis)) @ Matrix.Translation(-h) @ M
        bpy.context.view_layer.update()

    def skin(self):
        """22 skinning matrices (armature space posed @ rest inverse)."""
        bpy.context.view_layer.update()
        out = np.zeros((len(BONES), 4, 4))
        for i, b in enumerate(BONES):
            out[i] = np.array(self.pb[b].matrix @ self.rest[b].inverted())
        return out


def foot_geom(R, s):
    a = R.ankle0[s]
    b = R.ball0[s]
    heel = Vector((a.x, a.y + 0.055 * R.B.k, 0.0))
    # late in stance the toes bend and the foot rolls over the toe joints: pivot a little ahead of the ball
    ball = Vector((b.x, b.y - 0.03 * R.B.k, 0.0))
    return a, heel, ball


def rot_yz(v, th):
    # toes-up rotation by th in the YZ plane (forward = -y)
    c, s_ = math.cos(th), math.sin(th)
    return Vector((v.x, v.y * c + v.z * s_, -v.y * s_ + v.z * c))


def stance_ankle(R, s, yc, th):
    """Ankle position for a foot whose flat-foot ground origin is at y = yc (moving back), pitched th."""
    a, heel, ball = foot_geom(R, s)
    shift = Vector((0, yc - a.y, 0))
    if th > 0:
        piv = heel + shift
        return piv + rot_yz(a - heel, th)
    if th < 0:
        piv = ball + shift
        return piv + rot_yz(a - ball, th)
    return a + shift


def walk_pose(R, p, S, clear, arm_amp, lean=0.0, elder=False):
    """Pose for gait phase p in [0, 1) with stride S."""
    B = R.B
    k = B.k
    th_hs, th_to = 0.22, (0.85 if not elder else 0.5) * min(1.0, S / (1.5 * k))
    c0 = 0.06 * S
    R.reset()
    ankles, pitches, stance = {}, {}, {}
    for s, ph in (("l", 0.0), ("r", 0.5)):
        q = (p - ph) % 1.0
        y_hs = -BETA * S / 2 + c0
        y_to = BETA * S / 2 + c0
        if q < BETA:
            st = q / BETA
            yc = y_hs + (y_to - y_hs) * st
            if st < 0.14:
                th = th_hs * (1 - smooth(st / 0.14))
            elif st < 0.55:
                th = 0.0
            else:
                th = -th_to * smooth((st - 0.55) / 0.45)
            ankles[s] = stance_ankle(R, s, yc, th)
            pitches[s] = th
            stance[s] = min(0.0, th)
        else:
            sw = (q - BETA) / (1 - BETA)
            A_to = stance_ankle(R, s, y_to, -th_to)
            A_hs = stance_ankle(R, s, y_hs, th_hs)
            e = 0.5 - 0.5 * math.cos(math.pi * sw)
            pos = A_to.lerp(A_hs, e)
            pos.z += clear * k * math.sin(math.pi * min(1, sw * 1.15)) ** 0.9
            # pitch: toe-off -> slightly toes-down early swing -> toes up for heel strike
            if sw < 0.35:
                th = -th_to + (th_to - 0.12) * smooth(sw / 0.35)
            else:
                th = -0.12 + (th_hs + 0.12) * smooth((sw - 0.35) / 0.65)
            ankles[s] = pos
            pitches[s] = th
            stance[s] = min(0.0, th) * (1 - smooth(sw / 0.3))
    # pelvis: bob, sway, yaw, list; lowered so both legs reach
    bob = 0.016 * (S / 1.4) * math.cos(4 * math.pi * (p - 0.31))
    sway = 0.014 * k * math.cos(2 * math.pi * (p - 0.31))
    yaw = -0.075 * (S / 1.4) * math.cos(2 * math.pi * p)
    roll = -0.035 * math.cos(2 * math.pi * (p - 0.31))
    hip0 = {s: Vector(R.rest["thigh_" + s].to_translation()) for s in "lr"}
    zmax = 1e9
    for s in "lr":
        a = ankles[s]
        h = hip0[s]
        L = R.legL[s] * 0.993
        dxy = math.hypot(a.x - (h.x + sway), a.y - h.y)
        if dxy < L:
            zmax = min(zmax, a.z + math.sqrt(L * L - dxy * dxy) - h.z)
    dz = min(bob - 0.006 * k, zmax)
    return ankles, pitches, dict(off=Vector((sway, 0, dz)), yaw=yaw, roll=roll), stance


def bake_walk(R, S, clear, arm_amp, elder=False, lean=0.0):
    B = R.B
    frames = []
    # first pass: pelvis heights (smoothed over the cycle so the knee solution has no kinks)
    poses = [walk_pose(R, i / FRAMES, S, clear, arm_amp, lean, elder) for i in range(FRAMES)]
    dz = np.array([p[2]["off"].z for p in poses])
    dzs = dz.copy()
    for _ in range(2):
        dzs = np.minimum(dz, 0.5 * dzs + 0.25 * (np.roll(dzs, 1) + np.roll(dzs, -1)))
    for i in range(FRAMES):
        p = i / FRAMES
        ankles, pitches, pel, stance = poses[i]
        R.reset()
        off = pel["off"].copy()
        off.z = float(dzs[i])
        R.set_pelvis(off, pel["yaw"], pel["roll"], lean * 0.3)
        for s in "lr":
            R.place_foot(s, ankles[s], pitches[s])
        bpy.context.view_layer.update()
        # toes stay on the ground while the heel rises
        for s in "lr":
            if stance[s] < 0:
                R.rot("ball_" + s, (1, 0, 0), stance[s])
        # spine: lean and counter-rotation; head kept level and facing ahead
        R.rot("spine_01", (1, 0, 0), lean * 0.3)
        R.rot("spine_02", (0, 0, 1), -pel["yaw"] * 0.5)
        R.rot("spine_02", (1, 0, 0), lean * 0.4 + 0.02)
        R.rot("spine_03", (0, 0, 1), -pel["yaw"] * 0.6)
        R.rot("neck_01", (1, 0, 0), -lean * 0.55)
        R.rot("head", (0, 0, 1), pel["yaw"] * 0.15)
        R.rot("head", (1, 0, 0), -lean * 0.3)
        # arms: opposite to the legs, a little more elbow bend going forward
        for s, ph in (("l", 0.5), ("r", 0.0)):
            a = arm_amp * math.cos(2 * math.pi * (p - ph - 0.04))
            R.rot("upperarm_" + s, (1, 0, 0), -a)
            R.rot("lowerarm_" + s, (1, 0, 0), -(0.12 + 0.35 * max(0.0, a) + 0.08 * (1 if elder else 0)))
        frames.append(R.skin())
    return frames


def bake_loop(R, kind, n=FRAMES):
    B = R.B
    k = B.k
    frames = []
    for i in range(n):
        t = i / n
        R.reset()
        w2 = 2 * math.pi * t
        if kind == "stand":
            frames.append(R.skin())
            continue
        if kind == "seated":
            seat = 0.43
            # pelvis head about 0.105 m above the seat when sitting
            off = Vector((0, 0.03 * k, seat + 0.105 * k - R.pelvis0.to_translation().z))
            R.set_pelvis(off, 0.0, 0.0, 0.0)
            # thighs forward, shins down, feet flat on the ground (IK)
            for s in "lr":
                hip = Vector(R.pb["thigh_" + s].matrix.to_translation())
                thigh = (Vector(R.rest["calf_" + s].to_translation()) - Vector(R.rest["thigh_" + s].to_translation())).length
                a0 = R.ankle0[s]
                sx = (1 if s == "l" else -1) * 0.015
                R.place_foot(s, Vector((a0.x + sx, hip.y - thigh * 0.98 + 0.04 * math.sin(w2 + (0 if s == "l" else 2)), a0.z)), 0.0)
                R.pole[s].location = hip + Vector((0, -0.9, 0.5))
            bpy.context.view_layer.update()
            R.rot("spine_01", (1, 0, 0), 0.1)
            R.rot("spine_02", (1, 0, 0), 0.1 + 0.01 * math.sin(3 * w2))
            R.rot("spine_03", (1, 0, 0), -0.04)
            R.rot("neck_01", (1, 0, 0), -0.1)
            R.rot("head", (0, 0, 1), 0.35 * math.sin(w2 + 0.4))
            R.rot("head", (1, 0, 0), 0.06 * math.sin(2 * w2))
            for s in "lr":
                R.rot("upperarm_" + s, (1, 0, 0), -0.42)
                R.rot("upperarm_" + s, (0, 1, 0), (0.12 if s == "l" else -0.12))
                R.rot("lowerarm_" + s, (1, 0, 0), -0.95)
            frames.append(R.skin())
            continue
        amp = {"idle": 1.0, "talk": 0.8, "attention": 0.25}[kind]
        sway = 0.018 * k * amp * math.sin(w2)
        drop = -0.004 - 0.006 * amp * (0.5 - 0.5 * math.cos(2 * w2))
        R.set_pelvis(Vector((sway, 0, drop)), 0.03 * amp * math.sin(w2 + 1.0), -0.03 * amp * math.sin(w2), 0.0)
        for s in "lr":
            R.place_foot(s, R.ankle0[s], 0.0)
        bpy.context.view_layer.update()
        br = math.sin(4 * w2)
        R.rot("spine_02", (1, 0, 0), 0.012 * br)
        R.rot("spine_03", (1, 0, 0), -0.01 * br + 0.015 * amp)
        R.rot("spine_03", (0, 1, 0), 0.03 * amp * math.sin(w2))
        if kind == "talk":
            g = max(0.0, math.sin(2 * w2 + 0.3)) ** 2
            R.rot("head", (1, 0, 0), 0.07 * math.sin(6 * w2))
            R.rot("head", (0, 0, 1), 0.18 * math.sin(w2 + 0.7))
            R.rot("upperarm_r", (1, 0, 0), -0.3 * g)
            R.rot("lowerarm_r", (1, 0, 0), -1.1 * g - 0.1)
            R.rot("upperarm_l", (1, 0, 0), -0.08)
            R.rot("lowerarm_l", (1, 0, 0), -0.25 - 0.3 * max(0.0, math.sin(2 * w2 + 2.4)) ** 2)
        elif kind == "idle":
            R.rot("head", (0, 0, 1), 0.4 * math.sin(w2 + 0.3) * abs(math.sin(w2 + 0.3)))
            R.rot("head", (1, 0, 0), 0.05 * math.sin(2 * w2 + 1))
            for s in "lr":
                R.rot("lowerarm_" + s, (1, 0, 0), -0.1 - 0.03 * br)
        else:
            R.rot("head", (0, 0, 1), 0.04 * math.sin(w2))
            for s in "lr":
                R.rot("lowerarm_" + s, (1, 0, 0), -0.06)
        frames.append(R.skin())
    return frames


def bake_all(B, rig):
    """Returns (layers, frames, 22, 4, 4) skinning matrices and the stride parameters for the runtime."""
    R = Rigger(rig, B)
    k = B.k
    sp = B.spec
    elder = bool(sp.get("elder"))
    child = bool(sp.get("child"))
    female = sp.get("sex") == "f"
    sm = 0.86 if elder else 1.0
    S1, S2 = 0.95 * k * sm, 1.5 * k * sm
    arm = (0.6 if elder else 1.0) * (0.85 if female else 1.0)
    lean = 0.16 if elder else 0.0
    layers = []
    layers.append(bake_loop(R, "stand"))
    layers.append(bake_walk(R, S1, 0.05, 0.16 * arm, elder, lean))
    layers.append(bake_walk(R, S2, 0.085, 0.34 * arm, elder, lean))
    layers.append(bake_loop(R, "idle"))
    layers.append(bake_loop(R, "talk"))
    layers.append(bake_loop(R, "seated"))
    layers.append(bake_loop(R, "attention"))
    bpy.ops.object.mode_set(mode="OBJECT")
    A = np.array(layers)  # (L, F, 22, 4, 4)
    # runtime stride model: stride(v) = Sf * v / (v + v0)  (see figureShader.ts)
    v0 = 0.55 * math.sqrt(k)
    Sf = 1.9 * k * sm
    return A, dict(S1=S1, S2=S2, Sf=Sf, v0=v0)
