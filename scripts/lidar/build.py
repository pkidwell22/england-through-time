"""Build site height grids from the EA LIDAR Composite DTM (see research/lidar.md).

  research/venv/bin/python scripts/lidar/build.py [site ...]        # all four by default
  research/venv/bin/python scripts/lidar/build.py --verify [site ...]

Inputs : research/raw-lidar/<site>/*.tif (1 m DTM tiles, EPSG:27700) and <site>/osm.json, from fetch.py.
Outputs: public/assets/terrain/<site>.png (+ -raw / -residual / -labels for Stonehenge),
         data/locations/<site>/terrain-lidar.json (sidecar), research/raw-lidar/previews/*.png.

Grid contract (shared with src/lib/heightmap.ts): node-registered; pixel (i, j) is at
x = xMin + i*cell, z = zMin + j*cell in the site's local frame (geo.ts: x east, z SOUTH); row 0 = north.
value = (R*256 + G) * scale + offset (metres above Ordnance Datum Newlyn); B = trust mask * 255.
"""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from PIL import Image
from rasterio.features import rasterize
from scipy import ndimage
from shapely.geometry import LineString, Point, Polygon, mapping
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lidarlib as L  # noqa: E402

OUT = L.ROOT / "public" / "assets" / "terrain"
PREV = L.RAW / "previews"
GRID_MARGIN = 300.0  # grid extends this far beyond site.bounds; the engine fades it out over EDGE_BLEND
EDGE_BLEND = 250.0
ELEV_SCALE = 0.02  # m per 16-bit step: 0.02 m precision, 1310 m range
RESID_SCALE = 0.01
RESID_OFFSET = -50.0


# ----------------------------------------------------------------------------------------------- raster utils

def mosaic(site_id: str):
    tiles = sorted((L.RAW / site_id).glob("*.tif"))
    if not tiles:
        raise SystemExit(f"no tiles in research/raw-lidar/{site_id}; run scripts/lidar/fetch.py")
    bounds = []
    for t in tiles:
        with rasterio.open(t) as r:
            bounds.append(r.bounds)
    e0 = min(b.left for b in bounds); e1 = max(b.right for b in bounds)
    n0 = min(b.bottom for b in bounds); n1 = max(b.top for b in bounds)
    W, H = int(round(e1 - e0)), int(round(n1 - n0))
    arr = np.full((H, W), np.nan, np.float32)
    for t in tiles:
        with rasterio.open(t) as r:
            a = r.read(1).astype(np.float32)
            nd = r.nodata
            if nd is not None:
                a[a <= nd + abs(nd) * 1e-6] = np.nan
            a[(a < -50) | (a > 2000)] = np.nan
            c0 = int(round(r.bounds.left - e0)); r0 = int(round(n1 - r.bounds.top))
            arr[r0:r0 + a.shape[0], c0:c0 + a.shape[1]] = a
    return arr, e0, n1


def fill_holes(z: np.ndarray, hole: np.ndarray, relax: int = 30) -> np.ndarray:
    """Smooth (membrane-like) interpolation of z over `hole` cells, coarse to fine. Values in holes are ignored."""
    z = np.asarray(z, np.float64)
    hole = np.asarray(hole, bool) | ~np.isfinite(z)
    if not hole.any():
        return z.copy()
    levels = []
    zz = np.where(hole, 0.0, z)
    ww = (~hole).astype(np.float64)
    levels.append((zz, ww))
    while (ww == 0).any() and min(zz.shape) > 2:
        h, w = zz.shape
        h2, w2 = (h + 1) // 2, (w + 1) // 2
        pz = np.pad(zz * ww, ((0, h2 * 2 - h), (0, w2 * 2 - w)))
        pw = np.pad(ww, ((0, h2 * 2 - h), (0, w2 * 2 - w)))
        s = pz.reshape(h2, 2, w2, 2).sum((1, 3))
        c = pw.reshape(h2, 2, w2, 2).sum((1, 3))
        zz = np.where(c > 0, s / np.maximum(c, 1e-12), 0.0)
        ww = (c > 0).astype(np.float64)
        levels.append((zz, ww))
    est, wc = levels[-1]
    if (wc == 0).any():
        est = np.where(wc > 0, est, est[wc > 0].mean() if (wc > 0).any() else 0.0)
    for zz, ww in reversed(levels[:-1]):
        h, w = zz.shape
        up = np.repeat(np.repeat(est, 2, 0), 2, 1)[:h, :w]
        up = ndimage.uniform_filter(up, 3, mode="nearest")
        cur = np.where(ww > 0, zz, up)
        holes = ww == 0
        if holes.any():
            # Jacobi relaxation of the Laplace equation inside the holes only
            ys, xs = np.nonzero(ndimage.binary_dilation(holes, iterations=1))
            y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
            sub = cur[y0:y1, x0:x1]
            hs = holes[y0:y1, x0:x1]
            for _ in range(relax):
                p = np.pad(sub, 1, mode="edge")
                avg = 0.25 * (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:])
                sub = np.where(hs, avg, sub)
            cur[y0:y1, x0:x1] = sub
        est = cur
    return est


def local_grid(win: dict, cell: float):
    W = int(round((win["xMax"] - win["xMin"]) / cell)) + 1
    H = int(round((win["zMax"] - win["zMin"]) / cell)) + 1
    xs = win["xMin"] + np.arange(W) * cell
    zs = win["zMin"] + np.arange(H) * cell
    return xs, zs


def sample_dtm(dtm, e0, n1, proj: L.LocalProjector, xs, zs, cell):
    """Box-prefilter the 1 m mosaic to ~cell, then bilinear-sample it at the local grid nodes."""
    k = max(1, int(round(cell)))
    src = ndimage.uniform_filter(dtm, k, mode="nearest") if k > 1 else dtm
    X, Z = np.meshgrid(xs, zs)
    lat, lon = proj.to_latlon(X.ravel(), Z.ravel())
    E, N = L.latlon_to_bng(lat, lon)
    E = np.asarray(E).reshape(X.shape); N = np.asarray(N).reshape(X.shape)
    rows = (n1 - N) - 0.5
    cols = (E - e0) - 0.5
    out = ndimage.map_coordinates(src, [rows, cols], order=1, mode="nearest").astype(np.float64)
    return out, E, N


def raster_transform(xs, zs, cell):
    return Affine(cell, 0, xs[0] - cell / 2, 0, cell, zs[0] - cell / 2)


def burn(geoms, shape, tf, value=1, dtype=np.uint8):
    geoms = [g for g in geoms if g is not None and not g.is_empty]
    if not geoms:
        return np.zeros(shape, dtype)
    return rasterize([(mapping(g), value) for g in geoms], out_shape=shape, transform=tf, fill=0, dtype=dtype, all_touched=True)


def encode_png(path: Path, values: np.ndarray, scale: float, offset: float, mask: np.ndarray | None = None):
    v = np.clip(np.round((values - offset) / scale), 0, 65535).astype(np.uint32)
    rgb = np.zeros(values.shape + (3,), np.uint8)
    rgb[..., 0] = (v >> 8).astype(np.uint8)
    rgb[..., 1] = (v & 255).astype(np.uint8)
    rgb[..., 2] = 255 if mask is None else np.clip(np.round(mask * 255), 0, 255).astype(np.uint8)
    clipped = int(((values - offset) / scale < -0.5).sum() + ((values - offset) / scale > 65535.5).sum())
    Image.fromarray(rgb, "RGB").save(path, optimize=True)
    return clipped


def decode_png(path: Path, scale: float, offset: float):
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.float64)
    return (a[..., 0] * 256 + a[..., 1]) * scale + offset, a[..., 2] / 255


def hillshade(z, cell, az=315, alt=40):
    gy, gx = np.gradient(z, cell)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    a, al = math.radians(az), math.radians(alt)
    return np.clip(np.sin(al) * np.cos(slope) + np.cos(al) * np.sin(slope) * np.cos(a - aspect), 0, 1)


def preview(path: Path, z, cell, overlay=None, max_side=1400):
    hs = hillshade(z, cell)
    zn = (z - np.nanpercentile(z, 1)) / max(1e-6, np.nanpercentile(z, 99) - np.nanpercentile(z, 1))
    zn = np.clip(zn, 0, 1)
    rgb = np.stack([0.35 + 0.5 * zn, 0.45 + 0.35 * zn, 0.3 + 0.2 * zn], -1) * (0.35 + 0.65 * hs[..., None])
    if overlay is not None:
        for m, col in overlay:
            rgb[m > 0] = rgb[m > 0] * 0.45 + np.array(col) * 0.55
    img = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))
    s = max_side / max(img.size)
    if s < 1:
        img = img.resize((int(img.size[0] * s), int(img.size[1] * s)), Image.LANCZOS)
    PREV.mkdir(parents=True, exist_ok=True)
    img.save(path)


# ----------------------------------------------------------------------------------------------- OSM features

def osm_elements(site_id: str, proj: L.LocalProjector):
    d = json.loads((L.RAW / site_id / "osm.json").read_text())
    out = []
    for el in d.get("elements", []):
        tags = el.get("tags", {})
        geoms = []
        if el["type"] == "node":
            geoms.append(Point(*proj.to_local(el["lat"], el["lon"])))
        elif el["type"] == "way" and el.get("geometry"):
            pts = [proj.to_local(p["lat"], p["lon"]) for p in el["geometry"]]
            if len(pts) >= 4 and pts[0] == pts[-1]:
                geoms.append(Polygon(pts).buffer(0))
            elif len(pts) >= 2:
                geoms.append(LineString(pts))
        elif el["type"] == "relation":
            rings = []
            for m in el.get("members", []):
                if m.get("type") == "way" and m.get("geometry") and m.get("role", "outer") in ("outer", ""):
                    pts = [proj.to_local(p["lat"], p["lon"]) for p in m["geometry"]]
                    if len(pts) >= 4 and pts[0] == pts[-1]:
                        rings.append(Polygon(pts).buffer(0))
                    elif len(pts) >= 2:
                        rings.append(LineString(pts))
            polys = [g for g in rings if g.geom_type == "Polygon"]
            lines = [g for g in rings if g.geom_type == "LineString"]
            if lines:
                # multipolygon outers split into several ways (the Thames, large woods): join them into rings
                from shapely.ops import polygonize
                polys += [p for p in polygonize(unary_union(lines)) if p.area > 1]
            if polys:
                geoms.append(unary_union(polys))
            else:
                geoms.extend(rings)
        for g in geoms:
            out.append({"id": f"{el['type'][0]}{el['id']}", "tags": tags, "geom": g})
    return out


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def simplify_poly(g, tol=2.0):
    """Exterior ring(s) as [[x, z], ...] lists rounded to 0.5 m."""
    g = g.simplify(tol, preserve_topology=True)
    polys = [g] if g.geom_type == "Polygon" else [p for p in getattr(g, "geoms", []) if p.geom_type == "Polygon"]
    rings = []
    for p in polys:
        if p.area < 4:
            continue
        rings.append([[round(x * 2) / 2, round(z * 2) / 2] for x, z in list(p.exterior.coords)[:-1]])
    return rings


# Modern-feature rules: (predicate on tags, kind, buffer metres, what it is)
def modern_rules(site_id: str):
    rail = lambda t: t.get("railway") in ("rail", "light_rail", "subway", "narrow_gauge", "disused", "abandoned") and t.get("tunnel") not in ("yes",)
    rules = [
        (rail, "railway", 28.0, "railway with its cuttings and embankments (19th-20th century)"),
        (lambda t: t.get("highway") in ("motorway", "motorway_link", "trunk", "trunk_link") and t.get("tunnel") != "yes", "major-road", 30.0, "trunk road or motorway with cuttings, embankments and junction works"),
        (lambda t: (t.get("cutting") or t.get("embankment") in ("yes",)) and t.get("highway"), "road-earthwork", 18.0, "road tagged as in a cutting or on an embankment"),
        (lambda t: t.get("landuse") in ("reservoir", "quarry", "landfill") or t.get("water") in ("reservoir", "basin") or t.get("man_made") in ("reservoir_covered", "wastewater_plant"), "pit-reservoir", 12.0, "reservoir, quarry, landfill or works (modern excavation or made ground)"),
        (lambda t: t.get("water") == "dock" or t.get("waterway") == "dock" or t.get("landuse") == "port", "dock", 20.0, "dock or port basin (dug 18th-20th century)"),
        (lambda t: t.get("waterway") == "canal", "canal", 20.0, "canal or canalised river"),
        (lambda t: t.get("landuse") == "railway", "rail-land", 6.0, "railway land (yards, sidings)"),
    ]
    if site_id == "stonehenge":
        rules += [
            (lambda t: t.get("highway") in ("primary", "secondary") and t.get("tunnel") != "yes", "road", 16.0, "A-road (A360 and others) with verges and cuttings"),
            (lambda t: t.get("amenity") == "parking", "car-park", 8.0, "car park (modern levelling)"),
        ]
    if site_id == "barnet":
        rules += [
            (lambda t: t.get("highway") in ("primary",) and t.get("ref", "").startswith("A1") and t.get("ref") not in ("A1000",), "road", 14.0, "modern A1 / bypass road works"),
            (lambda t: t.get("water") in ("lake", "pond") and t.get("name", "") != "", "pond", 6.0, "named pond (dug or dammed; most are post-medieval)"),
            (lambda t: t.get("leisure") in ("pitch", "stadium"), "sports-ground", 6.0, "levelled playing field or sports ground (20th century terracing)"),
        ]
    return rules


# Stonehenge: grassed-over or unmapped modern works, drawn by hand (lat/lon from the old OS mapping as summarised in
# research/lidar.md) -- buffered lines.
STONEHENGE_EXTRA = [
    # Zig-zag First World War practice trenches north-west of the Cursus, plain in the DTM hillshade (my identification
    # from their form; Larkhill training area). A box round them.
    ("ww1-trenches", "Practice trenches (First World War, identified from the DTM)", "military", 0.0,
     [(51.1997, -1.8510), (51.1997, -1.8435), (51.1960, -1.8435), (51.1960, -1.8510), (51.1997, -1.8510)]),
    # The A344 ran from the A303 at Stonehenge Bottom past the north side of the stones to Airman's Corner.
    # Closed 2013 and grassed over east of the stones; west of them the shuttle road keeps the line.
    # Line traced on the 2 m DTM hillshade in local metres (prefixed "xz"): the old road shows as a low bank/terrace.
    ("old-a344", "Old A344 line (closed and grassed over 2013)", "road", 14.0,
     [("xz", 400, 95), ("xz", 180, 15), ("xz", 0, -60), ("xz", -240, -170), ("xz", -900, -400), ("xz", -1600, -640), ("xz", -2300, -880)]),
]


def stonehenge_earthwork_class(t: dict):
    """Only features OpenStreetMap tags as archaeology count (not roads, car parks or woods that share a name)."""
    if not (t.get("historic") in ("archaeological_site", "tumulus", "tomb") or t.get("archaeological_site") or t.get("tumulus")):
        return None
    if t.get("natural") == "stone" or t.get("historic") == "stone":
        return None
    n = (t.get("name") or "").lower()
    st = (t.get("site_type") or t.get("archaeological_site") or "").lower()
    if t.get("historic") in ("tumulus", "tomb") or st in ("tumulus", "barrow") or t.get("tumulus") or "barrow" in n:
        return "barrow"
    if st in ("earthwork", "fortification", "megalith", "settlement", "") or any(k in n for k in ("cursus", "avenue", "henge", "camp", "enclosure", "ditch")):
        return "earthwork"
    return None


def _ring(lat, lon, rx, rz, proj, n=48):
    cx, cz = proj.to_local(lat, lon)
    return Polygon([(cx + rx * math.cos(2 * math.pi * k / n), cz + rz * math.sin(2 * math.pi * k / n)) for k in range(n)])


def stonehenge_extra_earthworks(proj):
    """Earthworks OpenStreetMap has only as a point. Durrington Walls: centre and axes (466 x 490 m) as compiled by the
    Stonehenge geography researcher (research/stonehenge/geo-work/features.json, from the Gazetteer grid ref SU 1500 4376);
    masked as an annulus round the bank and ditch so the dry valley inside keeps its natural form."""
    outer = _ring(51.192703, -1.78666, 233 + 45, 245 + 45, proj)
    inner = _ring(51.192703, -1.78666, 233 - 45, 245 - 45, proj)
    return [{"cls": "earthwork", "name": "Durrington Walls", "group": None, "geom": outer.difference(inner), "osm": "n527357301+features.json"}]


# ----------------------------------------------------------------------------------------------- masked natural surface

def anomaly_refine(raw, mask0, thr, grow=2):
    """Fill over mask0, then keep only the part of mask0 where raw departs from the fill by more than thr."""
    f0 = fill_holes(raw, mask0 > 0)
    anom = (np.abs(raw - f0) > thr) & (mask0 > 0)
    anom = ndimage.binary_closing(anom, iterations=2)
    anom = ndimage.binary_dilation(anom, iterations=grow) & ndimage.binary_dilation(mask0 > 0, iterations=grow)
    return anom


def build_natural(raw, masks_thr, cell):
    """masks_thr: list of (mask, thr). Returns natural surface and the union mask actually replaced."""
    union = np.zeros(raw.shape, bool)
    for m, thr in masks_thr:
        union |= anomaly_refine(raw, m, thr, grow=max(1, int(round(4 / cell))))
    nat = fill_holes(raw, union)
    # soften the seam: light smoothing in a 2-cell band round the filled areas only
    band = ndimage.binary_dilation(union, iterations=2)
    nat = np.where(band, ndimage.gaussian_filter(nat, 0.8), nat)
    return nat, union


# ----------------------------------------------------------------------------------------------- per site

def common_meta(site_id, cell, xs, zs, scale, offset, ldo, use, image, mask_mode):
    return {
        "use": use,
        "image": image,
        "width": int(len(xs)),
        "height": int(len(zs)),
        "bounds": {"xMin": float(xs[0]), "xMax": float(xs[-1]), "zMin": float(zs[0]), "zMax": float(zs[-1])},
        "cellSize": cell,
        "registration": "node: pixel (i, j) is at x = xMin + i*cellSize, z = zMin + j*cellSize; row 0 = north (zMin)",
        "encoding": "rg16: elevation_m = (R*256 + G) * scale + offset; B = trust mask (0..255)",
        "scale": scale,
        "offset": offset,
        "mask": mask_mode,
        "datum": "metres above Ordnance Datum Newlyn",
        "localDatumOffset": ldo,
        "edgeBlend": EDGE_BLEND,
        "source": "Environment Agency LIDAR Composite DTM, 1 m (bare-earth; coverage Lidar_Composite_Elevation_DTM_1m as served in November 2026), via the Defra Data Services Platform WCS (" + L.WCS + ")",
        "licence": L.LICENCE,
        "attribution": L.ATTRIBUTION,
        "osmAttribution": L.OSM_ATTRIBUTION,
        "builtBy": "scripts/lidar/build.py",
    }


def modern_features(site_id, els, extra=(), proj=None):
    rules = modern_rules(site_id)
    groups: dict = {}
    for e in els:
        t = e["tags"]
        for pred, kind, buf, what in rules:
            try:
                ok = pred(t)
            except Exception:  # noqa: BLE001
                ok = False
            if ok:
                name = t.get("name") or t.get("ref") or kind
                key = (kind, name)
                g = e["geom"].buffer(buf) if e["geom"].geom_type != "Point" else e["geom"].buffer(buf + 10)
                groups.setdefault(key, {"kind": kind, "name": name, "what": what, "geoms": [], "osm": []})
                groups[key]["geoms"].append(g)
                groups[key]["osm"].append(e["id"])
                break
    for fid, name, kind, buf, line in extra:
        pts = [(p[1], p[2]) if p[0] == "xz" else proj.to_local(p[0], p[1]) for p in line]
        geom = Polygon(pts) if buf == 0 else LineString(pts).buffer(buf)
        groups[(kind, name)] = {"kind": kind, "name": name, "what": "drawn by hand, see research/lidar.md", "geoms": [geom], "osm": [fid]}
    out = []
    for (kind, name), g in sorted(groups.items()):
        geom = unary_union(g["geoms"])
        out.append({"kind": kind, "name": name, "what": g["what"], "geom": geom, "osm": g["osm"][:20]})
    return out


def clip_to(geom, win):
    from shapely.geometry import box
    return geom.intersection(box(win["xMin"], win["zMin"], win["xMax"], win["zMax"]))


def build_site(site_id: str):
    cfg = L.SITES[site_id]
    site = L.load_site(site_id)
    proj = L.LocalProjector(site["origin"]["lat"], site["origin"]["lon"])
    win = L.site_window(site, GRID_MARGIN)
    print(f"== {site_id}: mosaicking")
    dtm, e0, n1 = mosaic(site_id)
    nodata = ~np.isfinite(dtm)
    print(f"   1 m mosaic {dtm.shape[1]} x {dtm.shape[0]}, no-data {nodata.mean() * 100:.2f}%")
    dtm = fill_holes(dtm, nodata).astype(np.float32)
    els = osm_elements(site_id, proj)
    fn = {"stonehenge": build_stonehenge, "barnet": build_barnet, "brentford": build_river_site, "london": build_river_site}[site_id]
    meta = fn(site_id, site, proj, win, cfg, dtm, nodata, e0, n1, els)
    path = L.ROOT / "data" / "locations" / site_id / "terrain-lidar.json"
    text = json.dumps(meta, indent=1, ensure_ascii=False)
    # keep it readable but compact: [x, z] pairs on one line, each ring on one line
    text = re.sub(r"\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]", r"[\1, \2]", text)
    text = re.sub(r"\[\s+(\[-?[\d.]+, -?[\d.]+\](?:,\s+\[-?[\d.]+, -?[\d.]+\])*)\s+\]", lambda m: "[" + re.sub(r",\s+", ", ", m.group(1)) + "]", text)
    path.write_text(text + "\n")
    print(f"   wrote {path.relative_to(L.ROOT)}")
    return meta


def features_to_meta(feats, win, treatment):
    out = []
    for f in feats:
        g = clip_to(f["geom"], win)
        if g.is_empty:
            continue
        out.append({"name": f["name"], "kind": f["kind"], "what": f["what"], "treatment": treatment, "polygon": simplify_poly(g, 4.0), "osm": f["osm"][:8]})
    return out


def nodata_fraction_on_grid(nodata, e0, n1, E, N):
    rows = np.clip(((n1 - N) - 0.5).round().astype(int), 0, nodata.shape[0] - 1)
    cols = np.clip(((E - e0) - 0.5).round().astype(int), 0, nodata.shape[1] - 1)
    return nodata[rows, cols]


def build_barnet(site_id, site, proj, win, cfg, dtm, nodata, e0, n1, els):
    cell = cfg["cell"]
    xs, zs = local_grid(win, cell)
    raw, E, N = sample_dtm(dtm, e0, n1, proj, xs, zs, cell)
    tf = raster_transform(xs, zs, cell)
    feats = modern_features(site_id, els)
    m = burn([f["geom"] for f in feats], raw.shape, tf)
    nat, union = build_natural(raw, [(m, 0.6)], cell)
    nat = ndimage.gaussian_filter(nat, 0.6)  # suppress 1-2 cell DTM artefacts (hedge banks, building pads)
    offset = math.floor(nat.min() - 5)
    OUT.mkdir(parents=True, exist_ok=True)
    clipped = encode_png(OUT / f"{site_id}.png", nat, ELEV_SCALE, offset)
    encode_png(OUT / f"{site_id}-raw.png", raw, ELEV_SCALE, offset)
    preview(PREV / f"{site_id}-raw.png", raw, cell, [(m, (1, 0.2, 0.2))])
    preview(PREV / f"{site_id}-natural.png", nat, cell, [(union, (0.2, 0.4, 1))])
    meta = common_meta(site_id, cell, xs, zs, ELEV_SCALE, offset, cfg["localDatumOffset"], "replace-analytic", f"/assets/terrain/{site_id}.png", None)
    meta["raw"] = {"image": f"/assets/terrain/{site_id}-raw.png", "note": "unedited DTM on the same grid and encoding, for comparison"}
    meta["stats"] = stats(raw, nat, union, nodata_fraction_on_grid(nodata, e0, n1, E, N), clipped)
    meta["modernFeatures"] = features_to_meta(feats, win, "masked; replaced by smooth interpolation from the surrounding ground where the DTM departs from it by more than 0.6 m")
    meta["notes"] = (
        "Natural surface: modern railway cuttings and embankments, trunk roads, reservoirs and named ponds are smoothed out by masked "
        "interpolation; everything else is the bare-earth DTM, lightly smoothed (sigma 3 m). Local datum = OD - 64 m as in research/barnet.md. "
        "The DTM still carries post-medieval landscaping that is not mapped (golf-course shaping at Old Fold, garden terraces, field drains, "
        "road camber on the A1000) and the built-up ground of Chipping Barnet; these are mostly under 1 m."
    )
    return meta


def stats(raw, nat, union, nod, clipped):
    d = raw - nat
    return {
        "rawMin": round(float(raw.min()), 2), "rawMax": round(float(raw.max()), 2),
        "naturalMin": round(float(nat.min()), 2), "naturalMax": round(float(nat.max()), 2),
        "maskedFraction": round(float(union.mean()), 4),
        "noDataFraction": round(float(np.mean(nod)), 4),
        "maxRemovedUp": round(float(d.max()), 2), "maxRemovedDown": round(float(d.min()), 2),
        "clippedPixels": clipped,
    }


def build_stonehenge(site_id, site, proj, win, cfg, dtm, nodata, e0, n1, els):
    cell = cfg["cell"]  # 2 m raw and residual
    xs, zs = local_grid(win, cell)
    raw, E, N = sample_dtm(dtm, e0, n1, proj, xs, zs, cell)
    tf = raster_transform(xs, zs, cell)
    feats = modern_features(site_id, els, STONEHENGE_EXTRA, proj)
    mod = burn([f["geom"] for f in feats], raw.shape, tf)
    # earthworks from OSM: barrows (polygons, or 14 m circles round nodes) and the named monuments
    groups = [e for e in els if e["geom"].geom_type in ("Polygon", "MultiPolygon") and "barrows" in (e["tags"].get("name") or "").lower()]
    works = []
    seen = set()
    for e in els:
        cls = stonehenge_earthwork_class(e["tags"])
        if not cls:
            continue
        g = e["geom"]
        name = e["tags"].get("name") or ("Barrow" if cls == "barrow" else "Earthwork")
        if g.geom_type == "Point":
            g = g.buffer(14)
        elif g.geom_type in ("LineString",):
            g = g.buffer(10)
        if "barrows" in name.lower() and (g.area > 20000 or e["id"].startswith("r")):
            continue  # a cemetery outline: used only to group its barrows
        if g.area > 4e6 or (name == "Durrington Walls" and g.area < 5000):
            continue
        key = (round(g.centroid.x), round(g.centroid.y))
        if key in seen:
            continue
        seen.add(key)
        grp = next((gg["tags"].get("name") for gg in groups if gg["geom"].buffer(30).contains(g.centroid)), None)
        if g.geom_type in ("Polygon", "MultiPolygon") and g.area > 6000 and 2 * g.area / max(1.0, g.length) > 25 and name != "Stonehenge":
            # a large enclosure (cursus, hillfort, enclosure): mask only its banks and ditches along the outline, so
            # the natural ground inside (a dry valley under the Cursus, the hilltop of Vespasian's Camp) is kept
            g = g.boundary.buffer(16)
        else:
            g = g.buffer(8 if cls == "barrow" else 12)
        works.append({"cls": cls, "name": name, "group": grp, "geom": g, "osm": e["id"]})
    works += stonehenge_extra_earthworks(proj)
    # the stones themselves: the henge ring, from the site origin (centre of the sarsen circle)
    if not any("stonehenge" == w["name"].lower() for w in works):
        works.append({"cls": "earthwork", "name": "Stonehenge", "group": None, "geom": Point(0, 0).buffer(70), "osm": "origin"})
    wins = [w for w in works if not clip_to(w["geom"], win).is_empty]
    # ids: landmark ids are matched by slug of the name when data/locations/stonehenge/landmarks.json has them
    lm_path = L.ROOT / "data" / "locations" / "stonehenge" / "landmarks.json"
    landmark_ids = {}
    try:
        for lm in json.loads(lm_path.read_text()):
            landmark_ids[slug(lm.get("name", ""))] = lm["id"]
    except Exception:  # noqa: BLE001
        pass
    # OSM names -> Stonehenge landmark ids (used only when that id exists in landmarks.json)
    alias = {
        "stonehenge": "stonehenge-ditch-bank", "the-cursus": "greater-cursus", "lesser-cursus": "lesser-cursus",
        "the-avenue": "avenue", "durrington-walls": "durrington-walls-henge", "woodhenge": "woodhenge-henge",
        "coneybury-henge": "coneybury-henge", "vespasian-s-camp": "vespasians-camp", "bluestonehenge": "west-amesbury-henge",
        "normanton-down-barrows": "normanton-down-barrows", "new-king-barrows": "king-barrows", "old-king-barrows": "king-barrows",
        "cursus-barrows": "cursus-barrows", "winterbourne-stoke-crossroads-barrows": "winterbourne-stoke-barrows",
        "stonehenge-down-barrows": "stonehenge-down-barrows", "lake-barrows": "lake-barrows", "bush-barrow": "bush-barrow",
        "coneybury-barrow": "scattered-barrows", "winterbourne-stoke-crossroads-long-barrow": "winterbourne-stoke-1",
    }
    known = set(landmark_ids.values())
    def match(name):
        if not name:
            return None
        sl = slug(name)
        if sl in landmark_ids:
            return landmark_ids[sl]
        lid = alias.get(sl)
        return lid if lid in known else None
    counts: dict = {}
    for w in wins:
        base = slug(w["name"]) or "earthwork"
        counts[base] = counts.get(base, 0) + 1
    used: dict = {}
    for w in wins:
        base = slug(w["name"]) or "earthwork"
        if counts[base] > 1:
            used[base] = used.get(base, 0) + 1
            w["id"] = f"{base}-{used[base]}"
        else:
            w["id"] = base
        w["landmark"] = match(w["name"]) or match(w["group"])
    labels = np.zeros(raw.shape, np.uint16)
    for i, w in enumerate(wins, start=1):
        lab = burn([w["geom"]], raw.shape, tf)
        labels[(lab > 0) & (labels == 0)] = i
    ew_mask = (labels > 0).astype(np.uint8)
    nat, union = build_natural(raw, [(ew_mask, 0.25), (mod, 0.4)], cell)
    resid = raw - nat
    # residual only inside the earthwork masks; modern works are removed outright
    ew_union = union & (labels > 0) & ~(mod > 0)
    lab_out = np.where(ew_union, labels, 0).astype(np.uint16)
    resid_out = np.where(ew_union, resid, 0.0)
    # outputs
    OUT.mkdir(parents=True, exist_ok=True)
    offset = math.floor(min(raw.min(), nat.min()) - 5)
    nat4 = ndimage.gaussian_filter(nat, 0.8)[::2, ::2]  # 4 m natural surface for the engine
    xs4, zs4 = xs[::2], zs[::2]
    clipped = encode_png(OUT / f"{site_id}.png", nat4, ELEV_SCALE, offset)
    encode_png(OUT / f"{site_id}-raw.png", raw, ELEV_SCALE, offset)
    rc = encode_png(OUT / f"{site_id}-residual.png", resid_out, RESID_SCALE, RESID_OFFSET)
    lab_rgb = np.zeros(raw.shape + (3,), np.uint8)
    lab_rgb[..., 0] = (lab_out >> 8).astype(np.uint8)
    lab_rgb[..., 1] = (lab_out & 255).astype(np.uint8)
    Image.fromarray(lab_rgb, "RGB").save(OUT / f"{site_id}-labels.png", optimize=True)
    preview(PREV / f"{site_id}-raw.png", raw, cell, [(mod, (1, 0.2, 0.2)), (ew_mask, (1, 0.9, 0.2))])
    preview(PREV / f"{site_id}-natural.png", nat, cell)
    preview(PREV / f"{site_id}-residual.png", np.clip(resid_out, -2, 2), cell)
    preview(PREV / f"{site_id}-raw-centre.png", raw[int((-700 - zs[0]) / cell):int((700 - zs[0]) / cell), int((-900 - xs[0]) / cell):int((900 - xs[0]) / cell)], cell, max_side=1800)
    ew_meta = []
    for i, w in enumerate(wins, start=1):
        sel = lab_out == i
        if not sel.any():
            continue
        r = resid_out[sel]
        g = clip_to(w["geom"], win)
        ew_meta.append({
            "label": i, "id": w["id"], "name": w["name"], "kind": w["cls"], "group": w["group"], "landmark": w["landmark"],
            "centre": [round(g.centroid.x, 1), round(g.centroid.y, 1)],
            "polygon": simplify_poly(g, 1.5),
            "maxUp": round(float(r.max()), 2), "maxDown": round(float(r.min()), 2),
            "volumeUp": round(float(r[r > 0].sum() * cell * cell)), "volumeDown": round(float(-r[r < 0].sum() * cell * cell)),
            "osm": w["osm"],
        })
    meta = common_meta(site_id, 4.0, xs4, zs4, ELEV_SCALE, offset, cfg["localDatumOffset"], "replace-analytic", f"/assets/terrain/{site_id}.png", None)
    # carry the grid's edge outwards and fade to the analytic fallback over 1.5 km in the haze, rather than a 250 m ramp
    # at the grid edge (the fallback is a coarse fit and can differ by several metres there)
    meta["extend"] = 1500.0
    meta["raw"] = {"image": f"/assets/terrain/{site_id}-raw.png", "width": int(len(xs)), "height": int(len(zs)), "cellSize": cell,
                   "bounds": {"xMin": float(xs[0]), "xMax": float(xs[-1]), "zMin": float(zs[0]), "zMax": float(zs[-1])},
                   "scale": ELEV_SCALE, "offset": offset, "note": "unedited DTM (2 m), same encoding; shows every earthwork and modern work as surveyed (composite of EA surveys)"}
    meta["residual"] = {"image": f"/assets/terrain/{site_id}-residual.png", "labels": f"/assets/terrain/{site_id}-labels.png",
                        "width": int(len(xs)), "height": int(len(zs)), "cellSize": cell, "bounds": meta["raw"]["bounds"],
                        "scale": RESID_SCALE, "offset": RESID_OFFSET,
                        "note": "raw - natural (m), only inside mapped earthworks (0 elsewhere). labels PNG: (R*256+G) = `label` of the earthwork in `earthworks` (0 = none). Add a feature back at its date as natural + residual*mask(label).",
                        "clippedPixels": rc}
    meta["earthworks"] = ew_meta
    meta["stats"] = stats(raw, nat, union, nodata_fraction_on_grid(nodata, e0, n1, E, N), clipped)
    meta["modernFeatures"] = features_to_meta(feats, win, "masked; replaced by smooth interpolation where the DTM departs from the surrounding ground by more than 0.4 m; not in the residual")
    sb = site["bounds"]
    meta["boundsNote"] = (f"Built for site.json origin {site['origin']['lat']}, {site['origin']['lon']} and bounds x {sb['xMin']}..{sb['xMax']}, "
                          f"z {sb['zMin']}..{sb['zMax']} plus a {GRID_MARGIN:.0f} m margin. If the origin or bounds change, re-run "
                          "scripts/lidar/fetch.py stonehenge and scripts/lidar/build.py stonehenge.")
    meta["notes"] = (
        "Engine grid = the NATURAL surface at 4 m: every mapped earthwork (barrows, the henge, Avenue, Cursus, Lesser Cursus, Durrington Walls, "
        "Woodhenge, Coneybury, Vespasian's Camp ...) and modern intrusion (A303 and A360 with cuttings and embankments, the old A344 line, car parks) "
        "smoothed out by masked interpolation, so no dated earthwork appears before its date. Earthworks come back through the Stonehenge "
        "landmarks (their own builders) or by adding `residual` per label. Not removed: unmapped earthworks (field systems / lynchets, "
        "small ploughed-out barrows absent from OpenStreetMap), plough-levelling itself, plantation drainage and military tracks narrower than the "
        "DTM can resolve; see research/lidar.md. Local datum = OD - 62 m, as site.json states (stones at about 39.9 m local)."
    )
    return meta


def river_distance(site, proj, xs, zs):
    c = [proj.to_local(p[0], p[1]) for p in site["river"]["centreline"]]
    line = LineString(c)
    halfs = [max(p[2], p[3]) * site["river"].get("widthScale", 1) for p in site["river"]["centreline"]]
    X, Z = np.meshgrid(xs, zs)
    # distance via rasterised line + EDT (fast)
    cell = xs[1] - xs[0]
    tf = raster_transform(xs, zs, cell)
    lr = burn([line], X.shape, tf)
    d = ndimage.distance_transform_edt(lr == 0) * cell
    return d, float(np.mean(halfs))


def build_river_site(site_id, site, proj, win, cfg, dtm, nodata, e0, n1, els):
    cell = cfg["cell"]
    xs, zs = local_grid(win, cell)
    raw, E, N = sample_dtm(dtm, e0, n1, proj, xs, zs, cell)
    nod = nodata_fraction_on_grid(nodata, e0, n1, E, N)
    tf = raster_transform(xs, zs, cell)
    feats = modern_features(site_id, els)
    # water bodies and river corridor
    water = [e["geom"] for e in els if (e["tags"].get("natural") == "water" or e["tags"].get("waterway") in ("river", "canal", "dock")) and e["geom"].geom_type in ("Polygon", "MultiPolygon")]
    mod = burn([f["geom"] for f in feats], raw.shape, tf)
    wat = burn([g.buffer(25) for g in water], raw.shape, tf)
    drv, half = river_distance(site, proj, xs, zs)
    # upland relief: remove modern works (masked fill), then smooth away street-scale relief (sigma 25 m)
    hole = (mod > 0) | (wat > 0) | (nod > 0)
    up = fill_holes(raw, hole)
    up = ndimage.gaussian_filter(up, 25.0 / cell)
    # trust: away from the river corridor (> half-width + 250 m, full by + 450 m), away from modern works and open water
    ldo = 2.0
    def ss(a, b, v):
        t = np.clip((v - a) / (b - a), 0, 1)
        return t * t * (3 - 2 * t)
    away_mod = ndimage.distance_transform_edt(~hole) * cell
    trust = ss(half + 250, half + 450, drv) * ss(10, 60, away_mod)
    # floodplain/made-ground test: low ground (< 5 m OD) is alluvium, reclaimed marsh or dock: not trusted
    trust *= ss(4.0, 6.5, up)
    trust = ndimage.gaussian_filter(trust, 2.0)
    offset = math.floor(min(up.min(), raw.min()) - 5)
    OUT.mkdir(parents=True, exist_ok=True)
    clipped = encode_png(OUT / f"{site_id}.png", up, ELEV_SCALE, offset, trust)
    encode_png(OUT / f"{site_id}-raw.png", raw, ELEV_SCALE, offset)
    preview(PREV / f"{site_id}-raw.png", raw, cell, [(mod, (1, 0.2, 0.2)), (wat, (0.2, 0.4, 1))])
    preview(PREV / f"{site_id}-upland.png", up, cell, [((trust < 0.5).astype(np.uint8), (0.6, 0.6, 0.6))])
    use = "none" if site_id == "london" else "upland-only"
    meta = common_meta(site_id, cell, xs, zs, ELEV_SCALE, offset, ldo, use, f"/assets/terrain/{site_id}.png", "blue")
    meta["raw"] = {"image": f"/assets/terrain/{site_id}-raw.png", "note": "unedited DTM on the same grid and encoding (B = 255)"}
    meta["riverClearance"] = [150, 400]
    meta["stats"] = stats(raw, up, hole, nod, clipped)
    meta["stats"]["trustedFraction"] = round(float((trust > 0.5).mean()), 4)
    meta["modernFeatures"] = features_to_meta(feats, win, "masked out of the upland grid (filled by interpolation, then trust = 0 within 10-60 m)")
    meta["localDatumNote"] = ("River sites model heights above a single 'modelled high water' (y = 0). localDatumOffset 2.0 m OD is a compromise "
                              "high-water level across the timeline: Roman high water at the City is published as no more than about +1.5 m OD "
                              "(Taylor, London Archaeologist 16(1)), and present Mean High Water Springs is about +3.5 to +4.5 m OD.")
    meta["notes"] = (
        "UPLAND RELIEF ONLY. The river corridor is utterly changed since 1625 (embankments, reclaimed foreshore, docks, made ground several "
        "metres thick, canalised Brent, railways), so this grid must not replace the river and bank model. It is the DTM with modern works "
        "masked and filled, then smoothed with a 25 m Gaussian, and B = trust (0 near the river and works, on ground below about 5-6.5 m OD, "
        "1 on the terraces). Even on the trusted ground the modern surface includes made ground (several metres in the City), so treat absolute "
        "levels as an upper bound on the natural surface and use the shape (relative relief) first."
    )
    return meta


# ----------------------------------------------------------------------------------------------- verification

SPOTS = {
    "stonehenge": [("Stonehenge, centre of the sarsen circle", 51.17888, -1.82619, "101-102 m OD (task brief)"),
                   ("Heel Stone", 51.17903, -1.82541, "a little below the circle (ground falls NE along the Avenue)"),
                   ("King Barrow Ridge, crest between the New King Barrows", 51.1790, -1.8065, "ridge about 105-110 m OD (no published figure read)"),
                   ("Stonehenge Bottom, lowest point by the A303", 51.17694, -1.8188, "about 80 m aOD (A303 GI report, via search snippet; unverified)"),
                   ("Durrington Walls, centre", 51.1927, -1.7867, "dry valley inside the henge falling SE to the Avon (no figure read)"),
                   ("Coneybury Hill, summit", 51.17144, -1.80765, "about 110 m aOD (A303 GI report, via search snippet; unverified)"),
                   ("River Avon below West Amesbury (lowest DTM cell in window)", 51.16204, -1.79747, "river level; the lowest ground in the site")],
    "barnet": [("Hadley Green (site origin)", 51.661, -0.199, "128-130 m OD (task brief)"),
               ("Chipping Barnet church (St John the Baptist)", 51.65317, -0.20092, "town centre about 130 m OD (Wikipedia, 427 ft)"),
               ("Monken Hadley church", 51.6616, -0.1939, "on the plateau edge (no figure read)"),
               ("Road fork (Hadley Highstone)", 51.6665, -0.1990, "ridge crest (no figure read)"),
               ("Monken Mead brook, valley floor east of the site", 51.6600, -0.1760, "research/barnet.md: east valleys 'down to about 70 m'")],
    "london": [("Cornhill (St Michael Cornhill)", 51.5132, -0.0855, "modern high point 17.7 m OD (Wikipedia, citing OS)"),
               ("Ludgate Hill (St Paul's)", 51.5138, -0.0984, "modern street level (no figure read); natural brickearth c. 11.1-11.7 m OD (LAMAS 22, search snippet)"),
               ("Walbrook valley (Bank / Mansion House)", 51.5125, -0.0905, "valley floor under several metres of made ground (no figure read)"),
               ("Fleet valley (Farringdon Street / Ludgate Circus)", 51.5140, -0.1045, "valley floor (no figure read)"),
               ("Tower Hill", 51.5098, -0.0768, "no figure read"),
               ("Southwark (Borough High Street)", 51.5040, -0.0905, "low floodplain and made ground (no figure read)")],
    "brentford": [("Old England (site origin)", 51.4815, -0.302, "low ground, made ground of the 19th-century dock (no figure read)"),
                  ("Brentford High Street (Market Place)", 51.4860, -0.3060, "flood-plain gravel (no figure read)"),
                  ("Boston Manor / terrace north", 51.4930, -0.3150, "land 'rising gently from the Thames' to about 23 m (research/brentford.md, VCH)")],
}


def verify(site_id: str):
    meta = json.loads((L.ROOT / "data" / "locations" / site_id / "terrain-lidar.json").read_text())
    site = L.load_site(site_id)
    proj = L.LocalProjector(site["origin"]["lat"], site["origin"]["lon"])
    rows = []
    for key, sub in [("grid", meta), ("raw", meta.get("raw", {}))]:
        img = sub.get("image")
        if not img:
            continue
        m = {**meta, **sub} if key == "raw" else meta
        z, _ = decode_png(L.ROOT / "public" / img.lstrip("/"), m["scale"], m["offset"])
        b = m["bounds"]; cell = m["cellSize"]
        for name, lat, lon, exp in SPOTS.get(site_id, []):
            x, zz = proj.to_local(lat, lon)
            fx, fz = (x - b["xMin"]) / cell, (zz - b["zMin"]) / cell
            i0, j0 = int(fx), int(fz)
            u, v = fx - i0, fz - j0
            h = (z[j0, i0] * (1 - u) + z[j0, i0 + 1] * u) * (1 - v) + (z[j0 + 1, i0] * (1 - u) + z[j0 + 1, i0 + 1] * u) * v
            rows.append((key, name, round(x), round(zz), round(float(h), 2), round(float(h) - meta["localDatumOffset"], 2), exp))
    for r in rows:
        print("   %-5s %-50s x=%6d z=%6d  %7.2f m OD  (%6.2f local)  expected %s" % r)
    return rows


def main(argv):
    if argv and argv[0] == "--verify":
        for s in argv[1:] or list(L.SITES):
            print(f"== verify {s}")
            verify(s)
        return
    for s in argv or list(L.SITES):
        build_site(s)
        verify(s)


if __name__ == "__main__":
    main(sys.argv[1:])
