#!/usr/bin/env python3
"""Derived surface products for the national map's relief shading, built from the raw elevation already on disk.

Usage (from the project root):
  research/venv/bin/python -I scripts/national/build-surface.py research/raw-terrain [--out public/assets/national]

Stage 1 (cached in <raw>/derived/): the same Copernicus GLO-90 + GEBCO merge as build-height.py, at twice the
resolution (4096 x 2932, square in degrees, same bounds): about 150 m east-west by 240 m north-south per cell.

Stage 2 (written to --out):
  relief.jpg   4096 x 2932 RGB (JPEG q90, no chroma subsampling). R, G = east and south slope (rise over run, true
               scale) stored as 0.5 + 0.5 * sign(s) * sqrt(min(|s|, 1)); B = local relief (height minus a 1.2 km
               blur, +-40 m mapped to 0..255): ridges and gullies finer than the 2048 height grid.
  surface.png  2048 x 1466 RGBA, aligned with height.png:
               R = openness (sky-view factor within ~5 km; 1 = open plain), for ambient light in valleys;
               G = wetland: low (under 6 m), flat ground in patches over ~9 km2: the fens, levels, carrs and mosses
                   that the terrain notes say were wet for the whole period;
               B = sun visibility: soft cast shadow for the fixed map sun (SUN_AZIMUTH / SUN_ELEVATION), relief
                   exaggerated SHADOW_EXAGGERATION times;
               A = natural lakes (flat water in the elevation, grown from the lakes listed in LAKES only).
  water.png    4096 x 2932 RGB: R = distance to the nearest water course (0..RIVER_RANGE texels of this grid), G = its size
               (log of catchment, 0 = RIVER_MIN_KM2, 1 = 10,000 km2). Water courses are traced by D8 flow
               accumulation on a priority-flood filled copy of the 2048 grid, smoothed, and not drawn inside the
               wetland (where today's drains are artificial cuts, many of them later than 1625).

All of it is a reading of present-day elevation. Nothing here is historical data; see research/national-terrain.md.
Needs numpy, scipy, Pillow, netCDF4, rasterio (virtualenv: research/venv).
"""
import glob
import json
import math
import os
import sys
import time

import numpy as np

LAT_MIN, LAT_MAX = 49.7, 56.0
LON_MIN, LON_MAX = -6.5, 2.3
W2, H2 = 4096, 2932
W1, H1 = 2048, 1466
SEA_MAX = -0.5
MID_LAT = math.radians((LAT_MIN + LAT_MAX) / 2)

# Natural lakes that the elevation shows as flat water (name, lat, lon). Reservoirs (Kielder, Rutland Water,
# Vyrnwy, Elan, Celyn, Brianne, Grafham) and lakes much enlarged by dams (Haweswater, Thirlmere) are left out on
# purpose: the elevation cannot tell them apart and they did not exist in this form before 1625.
LAKES = [
    ("Windermere", 54.36, -2.94), ("Ullswater", 54.58, -2.88), ("Coniston Water", 54.33, -3.07),
    ("Derwentwater", 54.58, -3.15), ("Bassenthwaite Lake", 54.65, -3.22), ("Wast Water", 54.44, -3.29),
    ("Crummock Water", 54.55, -3.30), ("Buttermere", 54.54, -3.27), ("Ennerdale Water", 54.52, -3.38),
    ("Llyn Tegid (Bala Lake)", 52.88, -3.62), ("Llyn Padarn", 53.13, -4.13), ("Llangorse Lake", 51.93, -3.26),
    ("Hornsea Mere", 53.905, -0.19), ("Malham Tarn", 54.10, -2.17), ("Loe Pool", 50.07, -5.29),
    ("Slapton Ley", 50.28, -3.65),
]


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def mosaic(raw, w, h):
    """Copernicus area-averaged land over GEBCO sea floor, as build-height.py does, at w x h."""
    import netCDF4
    import rasterio
    from rasterio.transform import from_bounds
    from rasterio.warp import reproject, Resampling

    lon_c = LON_MIN + (np.arange(w) + 0.5) * (LON_MAX - LON_MIN) / w
    lat_c = LAT_MAX - (np.arange(h) + 0.5) * (LAT_MAX - LAT_MIN) / h
    ds = netCDF4.Dataset(os.path.join(raw, "gebco", "gebco_2025_subset.nc"))
    glat = np.asarray(ds.variables["lat"][:])
    glon = np.asarray(ds.variables["lon"][:])
    gel = np.asarray(ds.variables["elevation"][:]).astype("float32")
    ds.close()
    fy = (lat_c - glat[0]) / (glat[1] - glat[0])
    fx = (lon_c - glon[0]) / (glon[1] - glon[0])
    y0 = np.clip(np.floor(fy).astype(int), 0, len(glat) - 2)
    x0 = np.clip(np.floor(fx).astype(int), 0, len(glon) - 2)
    wy = (fy - y0)[:, None].astype("float32")
    wx = (fx - x0)[None, :].astype("float32")
    gebco = (gel[np.ix_(y0, x0)] * (1 - wx) + gel[np.ix_(y0, x0 + 1)] * wx) * (1 - wy) + \
            (gel[np.ix_(y0 + 1, x0)] * (1 - wx) + gel[np.ix_(y0 + 1, x0 + 1)] * wx) * wy

    dst_transform = from_bounds(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX, w, h)
    s_el = np.zeros((h, w), "float64")
    s_sea = np.zeros((h, w), "float64")
    s_n = np.zeros((h, w), "float64")
    for t in sorted(glob.glob(os.path.join(raw, "cop90", "Copernicus_DSM_COG_30_*_DEM.tif"))):
        with rasterio.open(t) as src:
            dem = src.read(1).astype("float32")
            sea = (dem == 0.0).astype("float32")
            outs = []
            for arr in (dem, sea):
                dst = np.full((h, w), np.nan, "float32")
                reproject(arr, dst, src_transform=src.transform, src_crs=src.crs, dst_transform=dst_transform,
                          dst_crs="EPSG:4326", src_nodata=None, dst_nodata=np.nan, resampling=Resampling.average)
                outs.append(dst)
        ok = np.isfinite(outs[0]) & np.isfinite(outs[1])
        s_el[ok] += outs[0][ok]
        s_sea[ok] += outs[1][ok]
        s_n[ok] += 1
    have = s_n > 0
    cop = np.where(have, s_el / np.maximum(s_n, 1), np.nan)
    seaf = np.where(have, s_sea / np.maximum(s_n, 1), 1.0)
    land = have & (seaf < 0.5)
    elev = np.where(land, cop / np.maximum(1.0 - seaf, 0.5), gebco)
    elev = np.where(have & ~land, np.minimum(elev, SEA_MAX), elev)
    return elev.astype("float32"), land


def cell_m(w, h):
    dx = (LON_MAX - LON_MIN) / w * 111320.0 * math.cos(MID_LAT)
    dy = (LAT_MAX - LAT_MIN) / h * 111320.0
    return dx, dy


def blur(a, sx, sy):
    from scipy.ndimage import gaussian_filter
    return gaussian_filter(a, (sy, sx), mode="nearest")


def enc_slope(s):
    return np.clip(np.rint((0.5 + 0.5 * np.sign(s) * np.sqrt(np.minimum(np.abs(s), 1.0))) * 255), 0, 255).astype("uint8")


def openness(e, land, dx, dy):
    """Sky-view factor: mean over 16 directions of the cosine-weighted horizon, from several radii (true scale)."""
    h, w = e.shape
    acc = np.zeros_like(e)
    dirs = 16
    steps = [1, 2, 3, 5, 8, 12, 18]           # cells (2048 grid: ~300 m .. ~5 km)
    for k in range(dirs):
        a = 2 * math.pi * k / dirs
        ux, uy = math.cos(a), math.sin(a)
        best = np.full_like(e, -10.0)
        for s in steps:
            ox, oy = int(round(ux * s)), int(round(uy * s))
            if ox == 0 and oy == 0:
                continue
            sh = np.roll(np.roll(e, -oy, 0), -ox, 1)
            dist = math.hypot(ox * dx, oy * dy)
            best = np.maximum(best, (sh - e) / dist)
        acc += np.cos(np.arctan(np.maximum(best, 0.0))) ** 2   # 1 when the horizon is flat
    svf = acc / dirs
    return np.where(land, svf, 1.0)


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(2)
    raw = args[0]
    out = args[args.index("--out") + 1] if "--out" in args else "public/assets/national"
    from PIL import Image
    from scipy import ndimage

    cache = os.path.join(raw, "derived")
    os.makedirs(cache, exist_ok=True)
    f_e, f_l = os.path.join(cache, "elev4096.npy"), os.path.join(cache, "land4096.npy")
    if os.path.exists(f_e):
        e2, land2 = np.load(f_e), np.load(f_l)
        log("stage 1 from cache", e2.shape)
    else:
        log("stage 1: mosaic", W2, H2)
        e2, land2 = mosaic(raw, W2, H2)
        np.save(f_e, e2)
        np.save(f_l, land2)
        log("stage 1 done", float(e2.min()), float(e2.max()))

    # ---- relief.png (4096): true-scale slopes and fine relief ----
    dx2, dy2 = cell_m(W2, H2)
    es = blur(e2, 0.6, 0.6)                       # take the edge off the 90 m speckle (buildings, woods in the DSM)
    gy, gx = np.gradient(es)
    sx, sz = gx / dx2, gy / dy2                   # +x east, +z south (rows run north to south)
    detail = es - blur(es, 1200 / dx2, 1200 / dy2)
    rel = np.zeros((H2, W2, 3), "uint8")
    rel[..., 0] = enc_slope(sx)
    rel[..., 1] = enc_slope(sz)
    rel[..., 2] = np.clip(np.rint(128 + detail * (127 / 40.0)), 0, 255).astype("uint8")
    sea2 = e2 < 0.5
    rel[sea2, 2] = 128
    os.makedirs(out, exist_ok=True)
    p = os.path.join(out, "relief.jpg")
    Image.fromarray(rel).save(p, quality=90, subsampling=0, optimize=True)
    log("wrote", p, os.path.getsize(p))

    # ---- 2048 products ----
    e1 = e2.reshape(H1, 2, W1, 2).mean(axis=(1, 3))
    land1 = land2.reshape(H1, 2, W1, 2).mean(axis=(1, 3)) > 0.5
    dx1, dy1 = cell_m(W1, H1)
    log("openness")
    svf = openness(blur(e1, 0.7, 0.7), land1, dx1, dy1)
    svf = np.clip((svf - 0.80) / 0.20, 0, 1)

    # wetland: low, flat, and joined (through low ground) to the sea or a broad floodplain
    log("wetland")
    g1y, g1x = np.gradient(blur(e1, 1.5, 1.5))
    slope1 = np.hypot(g1x / dx1, g1y / dy1)
    low = (e1 > -4) & (e1 < 6.0) & (slope1 < 0.004) & land1
    lab, n = ndimage.label(low)
    sizes = ndimage.sum(np.ones_like(e1), lab, index=np.arange(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes >= 60                        # > ~9 km2: the fens and levels, not every flat field
    wet = keep[lab]
    wet = ndimage.binary_closing(wet, iterations=2) & land1
    wetf = blur(wet.astype("float32"), 1.2, 1.2)

    # rivers by flow accumulation on the 2048 grid (D8 on a priority-flood filled surface)
    log("rivers")
    # rivers are left out only across the large wetlands (fens, levels), where today's drains are artificial cuts
    labw, nw = ndimage.label(wet)
    wsz = ndimage.sum(np.ones_like(e1), labw, index=np.arange(1, nw + 1))
    bigw = np.zeros(nw + 1, bool)
    bigw[1:] = wsz >= 1500                     # over ~200 km2
    rivers = trace_rivers(e1, land1, bigw[labw], dx1, dy1)

    # lakes: the elevation model flattens water to its surface level; grow each listed lake from its lowest
    # nearby cell on the 4096 grid over ground within 0.8 m of that level, then average down to 2048
    log("lakes")
    from collections import deque
    lakes2 = np.zeros((H2, W2), bool)
    found = []
    for name, la, lo in LAKES:
        x = int((lo - LON_MIN) / (LON_MAX - LON_MIN) * W2)
        y = int((LAT_MAX - la) / (LAT_MAX - LAT_MIN) * H2)
        win = e2[y - 7:y + 8, x - 7:x + 8]
        iy, ix = np.unravel_index(np.argmin(win), win.shape)
        sy, sx0 = y - 7 + iy, x - 7 + ix
        lv = float(e2[sy, sx0])
        if lv < 1.5:
            continue                                  # at sea level: cannot be told from the sea
        q = deque([(sy, sx0)])
        cells = {(sy, sx0)}
        while q and len(cells) < 4000:
            cy, cx = q.popleft()
            for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                if (ny, nx) not in cells and 0 <= ny < H2 and 0 <= nx < W2 and abs(float(e2[ny, nx]) - lv) < 0.8:
                    cells.add((ny, nx))
                    q.append((ny, nx))
        if 3 <= len(cells) < 4000:
            for cy, cx in cells:
                lakes2[cy, cx] = True
            found.append((name, round(lv, 1), len(cells)))
    log("lakes found", found)
    lakes = lakes2.reshape(H1, 2, W1, 2).mean(axis=(1, 3))
    lakef = blur(lakes.astype("float32"), 0.5, 0.5)

    log("sun")
    sunv = sun_visibility(blur(e1, 0.8, 0.8), land1, dx1, dy1)

    log("river distance field")
    dist, size = river_field(rivers, W2, H2)

    surf = np.zeros((H1, W1, 4), "uint8")
    surf[..., 0] = np.rint(svf * 255).astype("uint8")
    surf[..., 1] = np.rint(np.clip(wetf, 0, 1) * 255).astype("uint8")
    surf[..., 2] = np.rint(np.clip(sunv, 0, 1) * 255).astype("uint8")
    surf[..., 3] = np.rint(np.clip(lakef, 0, 1) * 255).astype("uint8")
    p = os.path.join(out, "surface.png")
    Image.fromarray(surf).save(p, optimize=True)
    log("wrote", p, os.path.getsize(p))
    wat = np.zeros((H2, W2, 3), "uint8")
    wat[..., 0] = np.rint(np.clip(dist / RIVER_RANGE, 0, 1) * 255).astype("uint8")
    wat[..., 1] = np.rint(np.clip(size, 0, 1) * 255).astype("uint8")
    p = os.path.join(out, "water.png")
    Image.fromarray(wat).save(p, optimize=True)
    log("wrote", p, os.path.getsize(p), "rivers:", len(rivers), "lakes:", [f[0] for f in found])


# Sun used for the baked cast shadows; the terrain shader uses the same direction (src/national/shaders.ts).
SUN_AZIMUTH = 315.0      # degrees clockwise from north: light from the north-west, as on a printed relief map
SUN_ELEVATION = 24.0     # degrees: a low, raking sun
SHADOW_EXAGGERATION = 6.0
RIVER_RANGE = 8.0        # texels (4096 grid) of distance stored in water.png R
RIVER_MIN_KM2 = 120.0


def sun_visibility(e, land, dx, dy):
    """Soft cast shadow: march towards the sun over the (exaggerated) relief, up to ~45 km."""
    from scipy.ndimage import shift
    az = math.radians(SUN_AZIMUTH)
    ux, uy = math.sin(az) / dx, -math.cos(az) / dy        # cells per metre towards the sun (+x east, +y south)
    tan_el = math.tan(math.radians(SUN_ELEVATION))
    worst = np.full_like(e, -1.0)
    d = 300.0
    while d < 45000:
        sh = shift(e, (-uy * d, -ux * d), order=1, mode="nearest")
        worst = np.maximum(worst, (sh - e) * SHADOW_EXAGGERATION / d)
        d *= 1.12
    vis = 1.0 - np.clip((worst - tan_el * 0.75) / (tan_el * 0.5), 0, 1)
    return np.where(land, blur(vis.astype("float32"), 1.0, 1.0), 1.0)


def chaikin(pts, n=2):
    for _ in range(n):
        if len(pts) < 3:
            return pts
        out = [pts[0]]
        for a, b in zip(pts[:-1], pts[1:]):
            out.append(a * 0.75 + b * 0.25)
            out.append(a * 0.25 + b * 0.75)
        out.append(pts[-1])
        pts = np.array(out)
    return pts


def river_field(rivers, w, h):
    """Exact distance (texels) to the smoothed river polylines, and the size (0..1) of the nearest river."""
    dist = np.full((h, w), RIVER_RANGE, "float32")
    size = np.zeros((h, w), "float32")
    R = int(math.ceil(RIVER_RANGE)) + 1
    for line in rivers:
        P = np.array([[(p[1] - LON_MIN) / (LON_MAX - LON_MIN) * w, (LAT_MAX - p[0]) / (LAT_MAX - LAT_MIN) * h, p[2]] for p in line])
        P = chaikin(P, 3)
        for a, b in zip(P[:-1], P[1:]):
            x0, x1 = int(min(a[0], b[0])) - R, int(max(a[0], b[0])) + R + 1
            y0, y1 = int(min(a[1], b[1])) - R, int(max(a[1], b[1])) + R + 1
            x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w), min(y1, h)
            if x1 <= x0 or y1 <= y0:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
            ex, ey = b[0] - a[0], b[1] - a[1]
            L2 = ex * ex + ey * ey or 1e-9
            t = np.clip(((gx - a[0]) * ex + (gy - a[1]) * ey) / L2, 0, 1)
            dd = np.hypot(gx - (a[0] + t * ex), gy - (a[1] + t * ey)).astype("float32")
            km2 = a[2] + (b[2] - a[2]) * t
            sz = np.clip(np.log(km2 / RIVER_MIN_KM2) / math.log(10000.0 / RIVER_MIN_KM2), 0, 1).astype("float32")
            sub = dist[y0:y1, x0:x1]
            closer = dd < sub
            sub[closer] = dd[closer]
            size[y0:y1, x0:x1][closer] = sz[closer]
    return dist, size


def trace_rivers(e, land, wet, dx, dy):
    """D8 flow on a priority-flood filled surface; returns polylines (lat/lon, width class) and a raster."""
    import heapq
    from scipy import ndimage
    h, w = e.shape
    n = h * w
    z = e.astype("float64").ravel()
    filled = np.full(n, np.inf)
    done = np.zeros(n, bool)
    down = np.full(n, -1, np.int64)
    heap = []
    # Seeds: open water (deeper than 3 m) next to shallower ground, and the map edge. Shallow sea (tidal rivers such
    # as the Thames tideway, encoded at about -0.5 m, and the flats) is routed like land, so a river carries on down
    # its tidal reach to open water instead of stopping where today's tide begins.
    deep = (~land) & (e < -3.0)
    border = deep & ndimage.binary_dilation(~deep, iterations=1)
    border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
    for i in np.flatnonzero(border.ravel()):
        filled[i] = z[i]
        heapq.heappush(heap, (z[i], i))
        done[i] = True
    seadone = deep.ravel()
    order = []
    eps = 1e-4
    nb = (-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1)
    while heap:
        zz, i = heapq.heappop(heap)
        order.append(i)
        y, x = divmod(i, w)
        for d in nb:
            j = i + d
            jy, jx = divmod(j, w) if 0 <= j < n else (-1, -1)
            if jy < 0 or abs(jx - x) > 1 or abs(jy - y) > 1 or done[j]:
                continue
            done[j] = True
            if seadone[j]:
                continue
            filled[j] = max(z[j], zz + eps)
            down[j] = i
            heapq.heappush(heap, (filled[j], j))
    # accumulate catchment (km2) from the top of the order down
    cell_km2 = dx * dy / 1e6
    acc = np.full(n, cell_km2)
    for i in reversed(order):
        d = down[i]
        if d >= 0:
            acc[d] += acc[i]
    A = acc.reshape(h, w)
    THRESH = RIVER_MIN_KM2
    # on land outside the wetland, and through shallow water only where it is narrow (a tidal channel, not a bay)
    shallow = (~land) & (e >= -3.0)
    narrow = shallow & (ndimage.distance_transform_edt(~land) <= 2.5)
    riv = (A >= THRESH) & ((land & ~wet) | narrow)
    # polylines: walk downstream from each source (a river cell with no river cell flowing into it)
    rivf = riv.ravel()
    has_up = np.zeros(n, bool)
    for i in np.flatnonzero(rivf):
        d = down[i]
        if d >= 0 and rivf[d]:
            has_up[d] = True
    visited = np.zeros(n, bool)
    lines = []

    def ll(i):
        y, x = divmod(i, w)
        return [round(LAT_MAX - (y + 0.5) / h * (LAT_MAX - LAT_MIN), 5), round(LON_MIN + (x + 0.5) / w * (LON_MAX - LON_MIN), 5)]

    for s in np.flatnonzero(rivf & ~has_up):
        path = [s]
        i = s
        while True:
            d = down[i]
            if d < 0:
                break
            path.append(d)
            if visited[d] or not rivf[d]:
                break
            visited[d] = True
            i = d
        pts = [ll(i) + [round(float(A.ravel()[i]), 1)] for i in path]
        if len(pts) >= 3:
            lines.append(pts)
    return lines


if __name__ == "__main__":
    main()
