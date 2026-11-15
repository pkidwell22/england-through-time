"""
MakeHuman (MPFB) body creation for the crowd figures: a human from macro settings, the MPFB "game_engine"
skeleton, the shape baked into the mesh, a relaxed standing rest pose (arms down, fingers curled) applied as the
new rest, and the 53 deform groups folded into the 22 bones the crowd shader uses.

Everything returned is numpy (Blender Z-up, character facing -Y); conversion to three.js axes happens at export.
"""
import math
import bpy
import numpy as np
from mathutils import Matrix, Vector

bpy.ops.preferences.addon_enable(module="bl_ext.blender_org.mpfb")
from bl_ext.blender_org.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.blender_org.mpfb.services.targetservice import TargetService  # noqa: E402

# The crowd skeleton: game_engine bones kept as they are; fingers fold into the hand.
BONES = [
    "pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head",
    "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l",
    "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r",
    "thigh_l", "calf_l", "foot_l", "ball_l",
    "thigh_r", "calf_r", "foot_r", "ball_r",
]
BI = {b: i for i, b in enumerate(BONES)}


def fold(name):
    """The crowd bone a game_engine deform group belongs to."""
    if name in BI:
        return name
    for f in ("thumb", "index", "middle", "ring", "pinky"):
        if name.startswith(f):
            return "hand_" + name[-1]
    if name == "Root":
        return "pelvis"
    return None


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)
    for a in list(bpy.data.armatures):
        bpy.data.armatures.remove(a)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)


def _set_active(o):
    bpy.context.view_layer.objects.active = o
    for x in bpy.context.view_layer.objects:
        x.select_set(x == o)


def _rot_about(pb, rig, axis, angle):
    """Rotate a pose bone about a world axis through its head (armature space = world here)."""
    M = pb.matrix.copy()
    h = M.to_translation()
    R = Matrix.Translation(h) @ Matrix.Rotation(angle, 4, Vector(axis)) @ Matrix.Translation(-h)
    pb.matrix = R @ M
    bpy.context.view_layer.update()


def _align(pb, target_dir, amount=1.0):
    """Rotate a pose bone about its head so its +Y axis points along target_dir (minimal rotation)."""
    M = pb.matrix.copy()
    cur = (M.to_3x3() @ Vector((0, 1, 0))).normalized()
    tgt = Vector(target_dir).normalized()
    ax = cur.cross(tgt)
    if ax.length < 1e-6:
        return
    ang = cur.angle(tgt) * amount
    h = M.to_translation()
    R = Matrix.Translation(h) @ Matrix.Rotation(ang, 4, ax.normalized()) @ Matrix.Translation(-h)
    pb.matrix = R @ M
    bpy.context.view_layer.update()


def _local_rot(pb, axis, angle):
    """Rotate a pose bone about one of its own local axes (in addition to its current pose)."""
    pb.rotation_mode = "QUATERNION"
    q = pb.rotation_quaternion.copy()
    from mathutils import Quaternion
    pb.rotation_quaternion = q @ Quaternion(Vector(axis), angle)
    bpy.context.view_layer.update()


def make_body(spec):
    """Create one body. Returns a dict of numpy arrays and the armature object (kept in the scene for animation)."""
    macro = TargetService.get_default_macro_info_dict()
    for k in ("gender", "age", "muscle", "weight", "height", "proportions", "cupsize", "firmness"):
        if k in spec:
            macro[k] = spec[k]
    macro["race"] = dict(spec.get("race", {"caucasian": 0.9, "asian": 0.05, "african": 0.05}))
    hm = HumanService.create_human(mask_helpers=False, detailed_helpers=True, extra_vertex_groups=True, feet_on_ground=True, scale=0.1, macro_detail_dict=macro)
    rig = HumanService.add_builtin_rig(hm, "game_engine")
    hm.name = spec["id"]
    rig.name = spec["id"] + ".rig"
    arm_mod = [m for m in hm.modifiers if m.type == "ARMATURE"][0]
    for m in list(hm.modifiers):
        if m.type == "MASK":
            hm.modifiers.remove(m)
    # bake the shape keys into the mesh
    arm_mod.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    ev = hm.evaluated_get(dg)
    co = np.array([v.co[:] for v in ev.data.vertices], dtype=np.float64)
    hm.shape_key_clear()
    for i, v in enumerate(hm.data.vertices):
        v.co = co[i]
    arm_mod.show_viewport = True

    # ---- relaxed rest pose: arms hanging with a soft elbow, palms to the thighs, fingers curled
    _set_active(rig)
    bpy.ops.object.mode_set(mode="POSE")
    pbs = rig.pose.bones
    for side, s in (("l", 1), ("r", -1)):
        ua = pbs["upperarm_" + side]
        # hang the upper arm about 11 degrees out from vertical and a touch forward
        _align(ua, (s * 0.19, -0.04, -1.0))
        la = pbs["lowerarm_" + side]
        _align(la, (s * 0.10, -0.30, -1.0))
        hd = pbs["hand_" + side]
        _align(hd, (s * 0.06, -0.18, -1.0))
        # finger curl (flexion about each phalanx's local X)
        for f in ("index", "middle", "ring", "pinky"):
            for j, a in ((1, 0.28), (2, 0.42), (3, 0.30)):
                n = f"{f}_0{j}_{side}"
                if n in pbs:
                    _local_rot(pbs[n], (1, 0, 0), a + (0.08 if f == "pinky" else 0))
        for j, a in ((2, 0.15), (3, 0.2)):
            n = f"thumb_0{j}_{side}"
            if n in pbs:
                _local_rot(pbs[n], (1, 0, 0), a)
    # legs: MakeHuman stands with the feet wide apart; bring them under the hips with a little toe-out
    for side, s in (("l", 1), ("r", -1)):
        _align(pbs["thigh_" + side], (s * 0.035, 0.0, -1.0))
        _align(pbs["calf_" + side], (s * 0.01, 0.025, -1.0))
        ft = pbs["foot_" + side]
        _rot_about(ft, rig, (0, 0, 1), s * 0.12)
    bpy.context.view_layer.update()
    # twist the forearm so the palm faces the thigh: measure the palm normal and roll about the forearm axis
    for side, s in (("l", 1), ("r", -1)):
        hd = pbs["hand_" + side]
        # palm normal ~ local Z of the hand bone in MPFB's game rig; we want it pointing to -x*s (towards body)
        Mh = hd.matrix.to_3x3()
        pz = Mh @ Vector((0, 0, 1))
        want = Vector((-s, 0, 0))
        axis = (Mh @ Vector((0, 1, 0))).normalized()
        # project both onto the plane normal to the axis
        a = (pz - axis * pz.dot(axis)).normalized()
        b = (want - axis * want.dot(axis)).normalized()
        ang = math.atan2(axis.dot(a.cross(b)), a.dot(b))
        la = pbs["lowerarm_" + side]
        # spread the roll between forearm (70 %) and hand (30 %)
        _rot_about(la, rig, axis, ang * 0.7)
        _rot_about(hd, rig, (hd.matrix.to_3x3() @ Vector((0, 1, 0))).normalized(), ang * 0.3)
    bpy.ops.object.mode_set(mode="OBJECT")
    # apply: mesh takes the posed shape, the armature takes the pose as its rest
    dg = bpy.context.evaluated_depsgraph_get()
    ev = hm.evaluated_get(dg)
    co = np.array([v.co[:] for v in ev.data.vertices], dtype=np.float64)
    arm_mod.show_viewport = False
    for i, v in enumerate(hm.data.vertices):
        v.co = co[i]
    _set_active(rig)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    arm_mod.show_viewport = True

    # ---- numpy extraction
    me = hm.data
    nv = len(me.vertices)
    co = np.array([v.co[:] for v in me.vertices], dtype=np.float64)
    groups = {g.index: g.name for g in hm.vertex_groups}
    W = np.zeros((nv, len(BONES)), dtype=np.float64)
    regions = {}
    for v in me.vertices:
        for g in v.groups:
            nm = groups[g.group]
            b = fold(nm)
            if b is not None and g.weight > 0:
                W[v.index, BI[b]] += g.weight
            elif nm in REGION_GROUPS and g.weight > 0.5:
                regions.setdefault(nm, []).append(v.index)
    regions = {k: np.array(v, dtype=np.int64) for k, v in regions.items()}
    s = W.sum(1, keepdims=True)
    W = np.where(s > 0, W / np.maximum(s, 1e-9), 0)
    polys = [tuple(p.vertices) for p in me.polygons]
    uvl = me.uv_layers.active.data
    puv = [[tuple(uvl[li].uv) for li in p.loop_indices] for p in me.polygons]
    # joint centres from the 8-vertex joint cubes
    joints = {}
    for gname in list(groups.values()):
        if gname.startswith("joint-"):
            idx = regions_of(hm, gname)
            if len(idx):
                joints[gname[6:]] = co[idx].mean(0)
    bones = {}
    for b in rig.data.bones:
        if b.name in BI:
            bones[b.name] = dict(head=np.array(b.head_local), tail=np.array(b.tail_local), mat=np.array(b.matrix_local))
    return dict(spec=spec, obj=hm, rig=rig, co=co, W=W, polys=polys, puv=puv, regions=regions, joints=joints, bones=bones)


REGION_GROUPS = {"body", "helper-tights", "helper-skirt", "helper-hair", "helper-l-eye", "helper-r-eye", "scalp", "lips", "ears",
                 "fingernails", "toenails", "nipple", "genitals", "helper-genital", "HelperGeometry", "JointCubes", "helper-tongue",
                 "helper-upper-teeth", "helper-lower-teeth", "helper-l-eyelashes-1", "helper-l-eyelashes-2", "helper-r-eyelashes-1", "helper-r-eyelashes-2"}


def regions_of(obj, gname):
    g = obj.vertex_groups.get(gname)
    if g is None:
        return np.zeros(0, dtype=np.int64)
    gi = g.index
    return np.array([v.index for v in obj.data.vertices if any(x.group == gi and x.weight > 0.5 for x in v.groups)], dtype=np.int64)
