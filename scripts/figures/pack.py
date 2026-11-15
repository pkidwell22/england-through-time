"""
Pack the per-body caches into the files the browser loads (public/assets/figures/):
  <set>.glb       one glTF 2.0 binary per garment set; mesh "<body>_<lod>" per body and level of detail. Attributes:
                  POSITION (int16 normalised, node translation/scale restore metres), NORMAL (int8) (both KHR_mesh_quantization), TEXCOORD_0 (uint16 normalised), and custom
                  _BONES (uint8 x4), _WEIGHTS (uint8 normalised x4), _FIG (uint8 x4: tint slot, AO, outfit mask low byte, high byte)
  anim.bin        float16 RGBA 3D texture: x = body * 66 + bone * 3 + matrix row, y = frame (32), z = layer (7)
  figure_c.webp   1024 x 512 detail atlas (left: skin in the MakeHuman UV layout, right: wool cloth), mean ~0.85
  figure_n.webp   matching normal map
  figures.json    manifest
Run: blender -b --factory-startup --python scripts/figures/pack.py -- <cache dir> <out dir>
"""
import json
import math
import os
import pickle
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402

import anim  # noqa: E402
import spec  # noqa: E402
from mh import BONES  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
cache, out = argv[0], argv[1]
os.makedirs(out, exist_ok=True)

bodies = []
for b in spec.BODIES:
    p = os.path.join(cache, b["id"] + ".pkl")
    if not os.path.exists(p):
        raise SystemExit(f"missing cache for {b['id']}: run build_body.py first")
    with open(p, "rb") as f:
        bodies.append(pickle.load(f))

C4 = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], dtype=np.float64)


# ------------------------------------------------------------------------------------------- animation texture
NB = len(BONES)
L, F = len(anim.LAYERS), anim.FRAMES
W = len(bodies) * NB * 3
tex = np.zeros((L, F, W, 4), dtype=np.float32)
for bi, d in enumerate(bodies):
    A = d["anim"]  # (L, F, NB, 4, 4)
    for li in range(L):
        for fi in range(F):
            for b in range(NB):
                M = C4 @ A[li, fi, b].astype(np.float64) @ C4.T
                for r in range(3):
                    tex[li, fi, bi * NB * 3 + b * 3 + r] = M[r]
with open(os.path.join(out, "anim.bin"), "wb") as f:
    f.write(tex.astype(np.float16).tobytes())


# ------------------------------------------------------------------------------------------- GLB writer
def fig8(fig):
    """(slot, mask, ao, 0) uint16 -> uint8 (slot, ao, mask low byte, mask high byte)."""
    f = np.zeros((len(fig), 4), dtype=np.uint8)
    f[:, 0] = fig[:, 0]
    f[:, 1] = np.clip(fig[:, 2], 0, 255)
    f[:, 2] = fig[:, 1] & 255
    f[:, 3] = fig[:, 1] >> 8
    return f


def glb(meshes, path):
    """meshes: list of (name, arrays). Writes a minimal glTF 2.0 binary."""
    bin_ = bytearray()
    views, accs, gl_meshes, nodes = [], [], [], []

    def add_view(data, stride=None, target=None):
        while len(bin_) % 4:
            bin_.append(0)
        off = len(bin_)
        bin_.extend(data)
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if stride:
            v["byteStride"] = stride
        if target:
            v["target"] = target
        views.append(v)
        return len(views) - 1

    def add_acc(view, ctype, count, typ, normalized=False, mn=None, mx=None):
        a = {"bufferView": view, "componentType": ctype, "count": count, "type": typ}
        if normalized:
            a["normalized"] = True
        if mn is not None:
            a["min"], a["max"] = mn, mx
        accs.append(a)
        return len(accs) - 1

    for name, a in meshes:
        n = len(a["pos"])
        pos = a["pos"].astype(np.float64)
        # positions quantised to int16 (KHR_mesh_quantization); the node's translation/scale restore metres
        lo, hi = pos.min(0), pos.max(0)
        ctr = (lo + hi) / 2
        half = max(float((hi - lo).max()) / 2, 1e-6) * 1.0001
        q = np.clip(np.round((pos - ctr) / half * 32767), -32767, 32767).astype(np.int16)
        pos16 = np.zeros((n, 4), dtype=np.int16)
        pos16[:, :3] = q
        nrm = np.zeros((n, 4), dtype=np.int8)
        nn = a["nrm"] / np.maximum(np.linalg.norm(a["nrm"], axis=1, keepdims=True), 1e-9)
        nrm[:, :3] = np.clip(np.round(nn * 127), -127, 127).astype(np.int8)
        uv = np.clip(np.round(a["uv"] * 65535), 0, 65535).astype(np.uint16)
        # glTF texcoords run top-down (v = 0 at the top of the image)
        uv[:, 1] = 65535 - uv[:, 1]
        attrs = {
            "POSITION": add_acc(add_view(pos16.tobytes(), 8, 34962), 5122, n, "VEC3", normalized=True, mn=(q.min(0) / 32767).tolist(), mx=(q.max(0) / 32767).tolist()),
            "NORMAL": add_acc(add_view(nrm.tobytes(), 4, 34962), 5120, n, "VEC3", normalized=True),
            "TEXCOORD_0": add_acc(add_view(uv.tobytes(), 4, 34962), 5123, n, "VEC2", normalized=True),
            "_BONES": add_acc(add_view(a["bones"].astype(np.uint8).tobytes(), 4, 34962), 5121, n, "VEC4"),
            "_WEIGHTS": add_acc(add_view(a["weights"].astype(np.uint8).tobytes(), 4, 34962), 5121, n, "VEC4", normalized=True),
            "_FIG": add_acc(add_view(fig8(a["fig"]).tobytes(), 4, 34962), 5121, n, "VEC4"),
        }
        idx = a["idx"].astype(np.uint16 if n < 65536 else np.uint32)
        ia = add_acc(add_view(idx.tobytes(), None, 34963), 5123 if n < 65536 else 5125, len(idx), "SCALAR")
        gl_meshes.append({"name": name, "primitives": [{"attributes": attrs, "indices": ia, "mode": 4}]})
        nodes.append({"name": name, "mesh": len(gl_meshes) - 1, "translation": ctr.tolist(), "scale": [half, half, half]})
    while len(bin_) % 4:
        bin_.append(0)
    doc = {
        "asset": {"version": "2.0", "generator": "london-through-time scripts/figures/pack.py", "copyright": "CC0 (MakeHuman/MPFB bodies; garments and animation generated by the project)"},
        "extensionsUsed": ["KHR_mesh_quantization"], "extensionsRequired": ["KHR_mesh_quantization"],
        "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}], "nodes": nodes, "meshes": gl_meshes,
        "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": len(bin_)}],
    }
    js = json.dumps(doc, separators=(",", ":")).encode()
    while len(js) % 4:
        js += b" "
    total = 12 + 8 + len(js) + 8 + len(bin_)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack("<II", len(bin_), 0x004E4942))
        f.write(bin_)


manifest = {
    "version": 1,
    "frames": F, "layers": anim.LAYERS, "bones": NB,
    "anim": {"file": "anim.bin", "width": W, "height": F, "depth": L},
    "textures": {"map": "figure_c.webp", "normal": "figure_n.webp"},
    "bodies": [], "sets": {}, "periods": [{"set": p[0], "from": p[1], "to": p[2]} for p in spec.PERIODS],
}
for bi, d in enumerate(bodies):
    sp = d["spec"]
    manifest["bodies"].append({
        "id": d["id"], "type": sp["type"], "sex": sp["sex"], "child": bool(sp.get("child")), "elder": bool(sp.get("elder")),
        "height": round(d["height"], 4), "k": round(d["k"], 4), **{k: round(v, 4) for k, v in d["stride"].items()},
    })
sizes = {}
for sname in spec.SETS:
    meshes = []
    entry = {"file": sname + ".glb", "bodies": {}}
    for d in bodies:
        s = d["sets"].get(sname)
        if not s:
            continue
        lods = []
        for li, a in enumerate(s["lods"]):
            nm = f"{d['id']}_{li}"
            meshes.append((nm, a))
            lods.append({"mesh": nm, "tris": int(a["tris"]), "verts": int(len(a["pos"])), "perOutfit": a["per_outfit"]})
        entry["bodies"][d["id"]] = {"outfits": [{"name": o["name"], "w": o["w"]} for o in s["outfits"]], "lods": lods}
    if not meshes:
        continue
    path = os.path.join(out, sname + ".glb")
    glb(meshes, path)
    sizes[sname] = os.path.getsize(path)
    manifest["sets"][sname] = entry


# ------------------------------------------------------------------------------------------- textures
def periodic_noise(h, w, cells_y, cells_x, rng):
    g = rng.random((cells_y, cells_x))
    ys = np.linspace(0, cells_y, h, endpoint=False)
    xs = np.linspace(0, cells_x, w, endpoint=False)
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    fy, fx = ys - y0, xs - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = g[y0 % cells_y][:, x0 % cells_x]
    b = g[y0 % cells_y][:, (x0 + 1) % cells_x]
    c = g[(y0 + 1) % cells_y][:, x0 % cells_x]
    dd = g[(y0 + 1) % cells_y][:, (x0 + 1) % cells_x]
    top = a * (1 - fx) + b * fx
    bot = c * (1 - fx) + dd * fx
    return top * (1 - fy[:, None]) + bot * fy[:, None]


def raster(img, tris_uv, value, blend=1.0):
    """Fill UV triangles (in 0..1, v up) of a single-channel or RGB image with value."""
    H, Wd = img.shape[:2]
    for t in tris_uv:
        P = np.array([(u * Wd, (1 - v) * H) for u, v in t])
        x0, y0 = np.floor(P.min(0)).astype(int)
        x1, y1 = np.ceil(P.max(0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, Wd - 1), min(y1, H - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        a, b, c = P
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-9:
            continue
        l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
        l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
        l3 = 1 - l1 - l2
        m = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
        sub = img[y0:y1 + 1, x0:x1 + 1]
        if img.ndim == 3:
            sub[m] = sub[m] * (1 - blend) + np.array(value) * blend
        else:
            sub[m] = sub[m] * (1 - blend) + value * blend


def blur(img, r):
    k = np.exp(-np.linspace(-2, 2, 2 * r + 1) ** 2)
    k /= k.sum()
    out = img.copy()
    for ax in (0, 1):
        out = np.apply_along_axis(lambda m: np.convolve(np.pad(m, r, mode="edge"), k, mode="valid"), ax, out)
    return out


def textures():
    import mh
    import garments as G
    mh.clear_scene()
    d = mh.make_body([b for b in spec.BODIES if b["id"] == "woman_a"][0])
    B = G.Body(d)
    H, Wd = 512, 512
    rng = np.random.default_rng(3)
    # ---- skin (multiplier image, mean ~0.85 before features)
    skin = np.ones((H, Wd, 3)) * 0.86
    mott = periodic_noise(H, Wd, 24, 24, rng) * 0.6 + periodic_noise(H, Wd, 64, 64, rng) * 0.4
    skin *= (0.95 + 0.1 * mott)[..., None]
    polys, puv, co = d["polys"], d["puv"], d["co"]
    R = d["regions"]

    def tris_of(sel):
        out_ = []
        for p, uv in zip(polys, puv):
            if all(sel[v] for v in p):
                for k in range(1, len(p) - 1):
                    out_.append([uv[0], uv[k], uv[k + 1]])
        return out_
    n = len(co)

    def mask_of(idx):
        m = np.zeros(n, bool)
        m[idx] = True
        return m
    feat = np.zeros((H, Wd, 3))
    wsum = np.zeros((H, Wd, 1))
    lips = tris_of(mask_of(R["lips"])) if "lips" in R else []
    lip_img = np.zeros((H, Wd))
    raster(lip_img, lips, 1.0)
    lip_img = blur(lip_img, 2)
    skin = skin * (1 - lip_img[..., None]) + skin * np.array([0.92, 0.7, 0.7]) * lip_img[..., None]
    # eyebrows: skin above each eye, a band following the brow ridge
    brow = np.zeros(n, bool)
    for s in "lr":
        e = B.J[f"{s}-eye"]
        dx = co[:, 0] - e[0]
        dz = co[:, 2] - (e[2] + 0.021 * B.k - 0.012 * (dx / 0.035) ** 2 * B.k)
        brow |= B.inbody & (np.abs(dx) < 0.034 * B.k) & (np.abs(dz) < 0.0055 * B.k) & (co[:, 1] < e[1] + 0.02)
    brow_img = np.zeros((H, Wd))
    raster(brow_img, tris_of(brow), 1.0)
    brow_img = blur(brow_img, 1)
    skin = skin * (1 - 0.55 * brow_img[..., None])
    # eyelids / sockets a little darker, nails a little lighter
    sock = np.zeros(n, bool)
    for s in "lr":
        e = B.J[f"{s}-eye"]
        sock |= B.inbody & (np.linalg.norm(co - e, axis=1) < 0.026 * B.k) & (co[:, 1] < e[1] + 0.01)
    sock_img = np.zeros((H, Wd))
    raster(sock_img, tris_of(sock), 1.0)
    sock_img = blur(sock_img, 2)
    skin = skin * (1 - 0.12 * sock_img[..., None])
    for g in ("fingernails", "toenails"):
        if g in R:
            nimg = np.zeros((H, Wd))
            raster(nimg, tris_of(mask_of(R[g])), 1.0)
            skin = skin * (1 + 0.12 * nimg[..., None])
    skin = np.clip(skin, 0, 1)
    # ---- cloth: periodic in x (the cylindrical seam), fulled wool: threads, slubs and blotches
    cl = 0.86 * np.ones((H, Wd))
    thr_x = np.sin(np.arange(Wd) * 2 * math.pi / 3.0)[None, :] * 0.025
    thr_y = np.sin(np.arange(H) * 2 * math.pi / 3.0)[:, None] * 0.025
    slub = periodic_noise(H, Wd, 160, 8, rng) - 0.5
    blot = periodic_noise(H, Wd, 10, 10, rng) - 0.5
    fine = periodic_noise(H, Wd, 128, 128, rng) - 0.5
    cl = cl * (1 + thr_x + thr_y + 0.06 * slub + 0.07 * blot + 0.05 * fine)
    cl = np.clip(cl, 0, 1)
    img = np.zeros((H, 2 * Wd, 3))
    img[:, :Wd] = skin
    img[:, Wd:] = cl[..., None]
    # normals: flat skin; cloth from the thread/slub height
    hgt = thr_x + thr_y + 0.04 * slub + 0.03 * fine
    gy, gx = np.gradient(hgt)
    nz = np.ones_like(gx)
    nx, ny = -gx * 6.0, gy * 6.0
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nmap = np.zeros((H, 2 * Wd, 3))
    nmap[:, :Wd] = [0.5, 0.5, 1.0]
    nmap[:, Wd:, 0] = 0.5 + 0.5 * nx / ln
    nmap[:, Wd:, 1] = 0.5 + 0.5 * ny / ln
    nmap[:, Wd:, 2] = 0.5 + 0.5 * nz / ln
    return img, nmap


def save_png(path, arr, srgb=True):
    import bpy
    H, Wd = arr.shape[:2]
    im = bpy.data.images.new("t", Wd, H, alpha=False, float_buffer=False)
    if not srgb:
        im.colorspace_settings.name = "Non-Color"
    px = np.ones((H, Wd, 4), dtype=np.float32)
    px[..., :3] = arr[::-1]
    im.pixels.foreach_set(px.ravel())
    im.filepath_raw = path
    im.file_format = "WEBP" if path.endswith(".webp") else "PNG"
    im.save()
    bpy.data.images.remove(im)


img, nmap = textures()
# store the multiplier as sRGB so a linear value v reads back as v in the shader (three decodes sRGB maps)
srgb = np.where(img <= 0.0031308, img * 12.92, 1.055 * np.power(np.clip(img, 0, 1), 1 / 2.4) - 0.055)
save_png(os.path.join(out, "figure_c.webp"), srgb, srgb=False)
save_png(os.path.join(out, "figure_n.webp"), nmap, srgb=False)

with open(os.path.join(out, "figures.json"), "w") as f:
    json.dump(manifest, f, indent=1)
tot = sum(os.path.getsize(os.path.join(out, x)) for x in os.listdir(out))
print("sets", {k: round(v / 1e6, 2) for k, v in sizes.items()}, "anim", round(os.path.getsize(os.path.join(out, "anim.bin")) / 1e6, 2), "total MB", round(tot / 1e6, 2))
