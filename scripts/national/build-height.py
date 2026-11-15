#!/usr/bin/env python3
"""Build public/assets/national/height.png (+ height-preview.png) from raw open elevation data.

Usage (from the project root):
  research/venv/bin/python -I scripts/national/build-height.py research/raw-terrain
  research/venv/bin/python -I scripts/national/build-height.py research/raw-terrain --out public/assets/national
  research/venv/bin/python -I scripts/national/build-height.py --verify public/assets/national/height.png

Inputs (fetched by scripts/national/fetch-terrain.py):
  <raw>/gebco/gebco_2025_subset.nc          GEBCO_2025 Grid, 15 arc-second, land + sea floor (public domain)
  <raw>/cop90/Copernicus_DSM_COG_30_*.tif   Copernicus DEM GLO-90, 3 arc-second land surface (free licence)

Method
  1. Target grid: equirectangular, 2048 px wide, square in degrees; row 0 = latMax, column 0 = lonMin;
     sample points are pixel centres.
  2. GEBCO is bilinearly interpolated onto the target grid (sea floor everywhere, coarse land).
  3. Each Copernicus tile is area-averaged onto the target grid, together with the fraction of each
     target cell that Copernicus flags as sea (flattened to exactly 0.0 m).
  4. Merge: cells that are mostly Copernicus land take the Copernicus mean of their land part; all other
     cells take GEBCO, forced to at most SEA_MAX where Copernicus says "sea" so the present coastline
     follows the finer dataset.
  5. Encode v = round((elevation - OFFSET) / SCALE) clamped to 0..65535; R = v >> 8, G = v & 255, B = 0.
     8-bit RGB PNG, no alpha, no colour profile.

Needs numpy, Pillow, netCDF4, rasterio (virtualenv: research/venv).
"""
import glob
import math
import os
import sys

LAT_MIN, LAT_MAX = 49.7, 56.0
LON_MIN, LON_MAX = -6.5, 2.3
WIDTH = 2048
HEIGHT = int(round(WIDTH * (LAT_MAX - LAT_MIN) / (LON_MAX - LON_MIN)))  # 1466
SCALE = 0.1
OFFSET = -300.0
SEA_MAX = -0.5  # metres: cells Copernicus calls sea are never left above this

# (name, lat, lon, expectation) used by --verify and printed after every build
SAMPLES = [
    ("Snowdon / Yr Wyddfa summit", 53.0685, -4.0763, "1085 m peak; a ~300 x 480 m cell mean reads lower"),
    ("Scafell Pike summit", 54.4542, -3.2115, "978 m peak; cell mean reads lower"),
    ("Cross Fell (Pennines)", 54.7028, -2.4872, "893 m, broad summit"),
    ("Central London (Charing Cross)", 51.5074, -0.1278, "10-20 m (DSM: includes buildings)"),
    ("Fens: open peat fen east of Holme Fen", 52.5000, -0.1000, "about -2 to +1 m (shrunken peat)"),
    ("Somerset Levels (Westonzoyland moor)", 51.1100, -2.9000, "3-6 m"),
    ("Romney Marsh", 51.0000, 0.9000, "0-4 m"),
    ("Dogger Bank (SW part, in grid)", 54.6000, 1.8000, "-15 to -30 m"),
    ("Southern North Sea off Norfolk", 53.0000, 2.0000, "-20 to -40 m"),
    ("The Wash (centre)", 52.9500, 0.3000, "-5 to -25 m"),
    ("Dover Strait mid-channel", 51.0000, 1.4500, "-25 to -55 m"),
    ("Celtic Sea (W edge, off N Cornwall)", 50.8000, -6.3000, "-70 to -100 m (deepest Celtic Sea in window)"),
    ("St George's Channel", 52.0000, -5.8000, "-80 to -120 m"),
    ("Beaufort's Dyke (North Channel)", 54.7500, -5.2500, "-200 to -300 m (clamped at -300)"),
    ("Thanet (Ramsgate plateau)", 51.3500, 1.3800, "30-55 m"),
    ("Wantsum Channel floor (Sarre)", 51.3350, 1.2550, "1-4 m: floods when sea level is raised, not at present"),
]


def pixel_of(lat, lon, w=WIDTH, h=HEIGHT):
    x = int((lon - LON_MIN) / (LON_MAX - LON_MIN) * w)
    y = int((LAT_MAX - lat) / (LAT_MAX - LAT_MIN) * h)
    return min(max(x, 0), w - 1), min(max(y, 0), h - 1)


def verify(png_path):
    """Decode the PNG with Pillow only (the same arithmetic the renderer must use) and print samples."""
    from PIL import Image
    im = Image.open(png_path)
    print("file %s  mode=%s size=%s icc=%s" % (png_path, im.mode, im.size, "yes" if im.info.get("icc_profile") else "no"))
    assert im.mode == "RGB", "expected 8-bit RGB without alpha"
    w, h = im.size
    px = im.load()
    for name, lat, lon, expect in SAMPLES:
        x, y = pixel_of(lat, lon, w, h)
        best = -1e9
        for dy in (-1, 0, 1):          # 3 x 3 neighbourhood: peaks rarely sit on a cell centre
            for dx in (-1, 0, 1):
                r, g, b = px[min(max(x + dx, 0), w - 1), min(max(y + dy, 0), h - 1)]
                best = max(best, (r * 256 + g) * SCALE + OFFSET)
        r, g, b = px[x, y]
        e = (r * 256 + g) * SCALE + OFFSET
        print("  %-38s (%.4f, %.4f) px(%4d,%4d) rgb(%3d,%3d,%d) -> %8.1f m  [3x3 max %8.1f]  expect %s"
              % (name, lat, lon, x, y, r, g, b, e, best, expect))
    blue = im.getchannel("B").getextrema()
    print("  B channel extrema", blue)


def build(raw, out_dir):
    import numpy as np
    import netCDF4
    import rasterio
    from rasterio.transform import from_bounds
    from rasterio.warp import reproject, Resampling
    from PIL import Image

    lon_c = LON_MIN + (np.arange(WIDTH) + 0.5) * (LON_MAX - LON_MIN) / WIDTH
    lat_c = LAT_MAX - (np.arange(HEIGHT) + 0.5) * (LAT_MAX - LAT_MIN) / HEIGHT

    # --- GEBCO: bilinear onto the target grid -------------------------------------------------
    ds = netCDF4.Dataset(os.path.join(raw, "gebco", "gebco_2025_subset.nc"))
    glat = np.asarray(ds.variables["lat"][:])
    glon = np.asarray(ds.variables["lon"][:])
    gel = np.asarray(ds.variables["elevation"][:]).astype("float32")
    ds.close()
    fy = (lat_c - glat[0]) / (glat[1] - glat[0])
    fx = (lon_c - glon[0]) / (glon[1] - glon[0])
    assert fy.min() >= 0 and fy.max() <= len(glat) - 1 and fx.min() >= 0 and fx.max() <= len(glon) - 1
    y0 = np.clip(np.floor(fy).astype(int), 0, len(glat) - 2)
    x0 = np.clip(np.floor(fx).astype(int), 0, len(glon) - 2)
    wy = (fy - y0)[:, None].astype("float32")
    wx = (fx - x0)[None, :].astype("float32")
    a = gel[np.ix_(y0, x0)]
    b = gel[np.ix_(y0, x0 + 1)]
    c = gel[np.ix_(y0 + 1, x0)]
    d = gel[np.ix_(y0 + 1, x0 + 1)]
    gebco = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy

    # --- Copernicus GLO-90: area-average each tile onto the target grid ----------------------------
    dst_transform = from_bounds(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX, WIDTH, HEIGHT)
    s_el = np.zeros((HEIGHT, WIDTH), "float64")   # sum of cell-mean elevation
    s_sea = np.zeros((HEIGHT, WIDTH), "float64")  # sum of sea fraction
    s_n = np.zeros((HEIGHT, WIDTH), "float64")    # number of tiles contributing
    tiles = sorted(glob.glob(os.path.join(raw, "cop90", "Copernicus_DSM_COG_30_*_DEM.tif")))
    for t in tiles:
        with rasterio.open(t) as src:
            dem = src.read(1).astype("float32")
            sea = (dem == 0.0).astype("float32")
            outs = []
            for arr in (dem, sea):
                dst = np.full((HEIGHT, WIDTH), np.nan, "float32")
                reproject(arr, dst, src_transform=src.transform, src_crs=src.crs,
                          dst_transform=dst_transform, dst_crs="EPSG:4326",
                          src_nodata=None, dst_nodata=np.nan, resampling=Resampling.average)
                outs.append(dst)
        ok = np.isfinite(outs[0]) & np.isfinite(outs[1])
        s_el[ok] += outs[0][ok]
        s_sea[ok] += outs[1][ok]
        s_n[ok] += 1
    print("copernicus tiles used:", len(tiles))
    have = s_n > 0
    cop = np.where(have, s_el / np.maximum(s_n, 1), np.nan)
    seaf = np.where(have, s_sea / np.maximum(s_n, 1), 1.0)

    # --- merge -------------------------------------------------------------------------------------
    land = have & (seaf < 0.5)
    cop_land = cop / np.maximum(1.0 - seaf, 0.5)          # mean of the land part of the cell
    elev = np.where(land, cop_land, gebco)
    cop_sea = have & ~land                                # Copernicus present and says mostly sea
    elev = np.where(cop_sea, np.minimum(elev, SEA_MAX), elev)
    elev = elev.astype("float32")
    print("grid %d x %d  min %.1f  max %.1f  land(cop) %.1f%%  below 0: %.1f%%"
          % (WIDTH, HEIGHT, float(elev.min()), float(elev.max()), 100 * land.mean(), 100 * (elev < 0).mean()))
    print("cells clamped at offset (deeper than %.0f m): %d" % (OFFSET, int((elev < OFFSET).sum())))

    # --- encode ------------------------------------------------------------------------------------
    v = np.clip(np.rint((elev - OFFSET) / SCALE), 0, 65535).astype("uint16")
    rgb = np.zeros((HEIGHT, WIDTH, 3), "uint8")
    rgb[..., 0] = v >> 8
    rgb[..., 1] = v & 255
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "height.png")
    Image.fromarray(rgb).save(out, optimize=True)   # no alpha, no iCCP/gAMA chunks
    print("wrote", out, os.path.getsize(out), "bytes")

    # --- preview: hypsometric tint x hillshade ---------------------------------------------------
    pw = 800
    step_x = WIDTH / pw
    ph = int(round(HEIGHT / step_x))
    yi = np.clip(((np.arange(ph) + 0.5) * step_x).astype(int), 0, HEIGHT - 1)
    xi = np.clip(((np.arange(pw) + 0.5) * step_x).astype(int), 0, WIDTH - 1)
    e = (v.astype("float32") * SCALE + OFFSET)             # decode what we encoded
    mid_lat = math.radians((LAT_MIN + LAT_MAX) / 2)
    dy_m = (LAT_MAX - LAT_MIN) / HEIGHT * 111320.0
    dx_m = (LON_MAX - LON_MIN) / WIDTH * 111320.0 * math.cos(mid_lat)
    zex = 6.0                                               # vertical exaggeration for shading only
    gy, gx = np.gradient(e)
    nx, ny, nz = -gx / dx_m * zex, gy / dy_m * zex, 1.0     # ny: rows run north to south
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    az, alt = math.radians(315), math.radians(45)           # light from the north-west
    lx, ly, lz = math.sin(az) * math.cos(alt), math.cos(az) * math.cos(alt), math.sin(alt)
    shade = np.clip((nx * lx + ny * ly + nz * lz) / norm, 0, 1)
    shade = 0.35 + 0.65 * shade / math.sin(alt)
    stops = [(-300, (8, 30, 80)), (-100, (20, 60, 130)), (-40, (50, 110, 180)), (-10, (120, 175, 215)),
             (-0.01, (175, 212, 232)), (0, (110, 150, 95)), (15, (150, 180, 110)), (100, (200, 200, 130)),
             (300, (190, 160, 110)), (600, (150, 120, 95)), (1000, (235, 235, 235)), (1400, (255, 255, 255))]
    xs = np.array([s[0] for s in stops], "float32")
    col = np.stack([np.interp(e, xs, np.array([s[1][k] for s in stops], "float32")) for k in range(3)], -1)
    prev = np.clip(col * np.clip(shade, 0, 1.25)[..., None], 0, 255).astype("uint8")
    prev = prev[np.ix_(yi, xi)]
    pout = os.path.join(out_dir, "height-preview.png")
    Image.fromarray(prev).save(pout, optimize=True)
    print("wrote", pout, os.path.getsize(pout), "bytes")
    verify(out)


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(2)
    if args[0] == "--verify":
        verify(args[1])
        return
    out_dir = "public/assets/national"
    if "--out" in args:
        out_dir = args[args.index("--out") + 1]
    build(args[0], out_dir)


if __name__ == "__main__":
    main()
