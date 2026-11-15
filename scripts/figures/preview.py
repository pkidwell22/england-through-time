"""Workbench preview renders of numpy meshes (development aid; not part of the shipped output)."""
import math
import bpy
import numpy as np


def mesh_object(name, co, faces, cols=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, c)) for c in co], [], [tuple(int(i) for i in f) for f in faces])
    me.update()
    if cols is not None:
        ca = me.color_attributes.new("c", "FLOAT_COLOR", "POINT")
        for i, c in enumerate(cols):
            ca.data[i].color = (float(c[0]), float(c[1]), float(c[2]), 1.0)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def render(path, centre_x=0.0, width=2.2, views=(0, 90), res=(900, 900), z=0.9, centre_y=0.0):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.color_type = "VERTEX"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.show_cavity = False
    sc.render.resolution_x, sc.render.resolution_y = res
    cam = bpy.data.cameras.new("pc")
    cam.type = "ORTHO"
    cam.ortho_scale = width
    co = bpy.data.objects.new("pc", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    outs = []
    for ang in views:
        a = math.radians(ang)
        co.location = (centre_x + 8 * math.sin(a), centre_y - 8 * math.cos(a), z)
        co.rotation_euler = (math.radians(90), 0, a)
        sc.render.filepath = f"{path}_{ang}.png"
        bpy.ops.render.render(write_still=True)
        outs.append(sc.render.filepath)
    bpy.data.objects.remove(co)
    return outs
