"""Shared helpers for the LIDAR terrain workstream (scripts/lidar/*).

Projection contract: a site's local frame is src/lib/geo.ts `makeProjector` exactly:
  x = (lon - lon0) * 111320 * cos(lat0),   z = -(lat - lat0) * 111250   (metres, x east, z SOUTH)
The site origin is a WGS84 latitude/longitude (taken from OpenStreetMap / web maps). LIDAR is on the
British National Grid (EPSG:27700). WGS84 <-> BNG uses pyproj with the OSTN15 NTv2 grid
(research/raw-lidar/proj/uk_os_OSTN15_NTv2_OSGBtoETRS.tif, from cdn.proj.org), accurate to ~0.1 m
for ETRS89; ETRS89 and the WGS84 realisation used by web maps differ by under 1 m in 2026.
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "research" / "raw-lidar"
PROJ_DIR = RAW / "proj"
M_PER_DEG_LAT = 111_250.0

# Per-site processing choices. `cell` = output grid spacing (m); `margin` = metres added round site.bounds.
SITES = {
    "stonehenge": {"cell": 2.0, "margin": 400.0, "localDatumOffset": 62.0},
    "barnet": {"cell": 5.0, "margin": 400.0, "localDatumOffset": 64.0},
    "brentford": {"cell": 4.0, "margin": 400.0, "localDatumOffset": None},  # set in build.py (river datum)
    "london": {"cell": 5.0, "margin": 400.0, "localDatumOffset": None},
}

WCS = "https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs"
COVERAGE = "13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m"
LICENCE = "Open Government Licence v3.0"
ATTRIBUTION = "Contains Environment Agency information © Environment Agency and/or database right 2026. Licensed under the Open Government Licence v3.0."
OSM_ATTRIBUTION = "Feature outlines © OpenStreetMap contributors (ODbL 1.0)"


def load_site(site_id: str) -> dict:
    return json.loads((ROOT / "data" / "locations" / site_id / "site.json").read_text())


class LocalProjector:
    """Python twin of src/lib/geo.ts makeProjector."""

    def __init__(self, lat0: float, lon0: float):
        self.lat0, self.lon0 = lat0, lon0
        self.m_lon = 111_320.0 * math.cos(math.radians(lat0))

    def to_local(self, lat, lon):
        return (lon - self.lon0) * self.m_lon, -(lat - self.lat0) * M_PER_DEG_LAT

    def to_latlon(self, x, z):
        return self.lat0 - z / M_PER_DEG_LAT, self.lon0 + x / self.m_lon


_transformers: dict = {}


def _tf(direction: str):
    if direction not in _transformers:
        import pyproj
        from pyproj import Transformer

        grid = PROJ_DIR / "uk_os_OSTN15_NTv2_OSGBtoETRS.tif"
        if not grid.exists():
            raise SystemExit(f"OSTN15 grid missing: {grid} (run scripts/lidar/fetch.py first)")
        pyproj.datadir.append_data_dir(str(PROJ_DIR))
        src, dst = ("EPSG:4326", "EPSG:27700") if direction == "fwd" else ("EPSG:27700", "EPSG:4326")
        # Pin the OSTN15 operation rather than trusting the default choice.
        from pyproj.transformer import TransformerGroup

        tg = TransformerGroup(src, dst, always_xy=True)
        best = None
        for t in tg.transformers:
            if "OSTN15" in t.description or "(9)" in t.description:
                best = t
                break
        if best is None:
            raise SystemExit("pyproj could not use the OSTN15 grid; check research/raw-lidar/proj")
        _transformers[direction] = best
    return _transformers[direction]


def latlon_to_bng(lat, lon):
    """WGS84 (array-like ok) -> (E, N) on the British National Grid via OSTN15."""
    return _tf("fwd").transform(lon, lat)


def bng_to_latlon(e, n):
    lon, lat = _tf("inv").transform(e, n)
    return lat, lon


def site_window(site: dict, margin: float):
    b = site["bounds"]
    return {"xMin": b["xMin"] - margin, "xMax": b["xMax"] + margin, "zMin": b["zMin"] - margin, "zMax": b["zMax"] + margin}


def bng_bbox_for_window(proj: LocalProjector, win: dict, pad: float = 60.0):
    import numpy as np

    xs = np.linspace(win["xMin"], win["xMax"], 21)
    zs = np.linspace(win["zMin"], win["zMax"], 21)
    X, Z = np.meshgrid(xs, zs)
    edge = (X == xs[0]) | (X == xs[-1]) | (Z == zs[0]) | (Z == zs[-1])
    lat, lon = proj.to_latlon(X[edge], Z[edge])
    e, n = latlon_to_bng(lat, lon)
    return float(np.min(e) - pad), float(np.min(n) - pad), float(np.max(e) + pad), float(np.max(n) + pad)


def tile_name(e0: int, n0: int) -> str:
    """OS-style 1 km tile name, e.g. SU1242, for the km square with SW corner (e0, n0)."""
    letters = "ABCDEFGHJKLMNOPQRSTUVWXYZ"
    e100, n100 = e0 // 100000, n0 // 100000
    l1 = (19 - n100) - (19 - n100) % 5 + (e100 + 10) // 5
    l2 = ((19 - n100) * 5) % 25 + e100 % 5
    return f"{letters[l1]}{letters[l2]}{(e0 % 100000) // 1000:02d}{(n0 % 100000) // 1000:02d}"


def km_tiles(bbox):
    e0, n0, e1, n1 = bbox
    out = []
    for n in range(int(math.floor(n0 / 1000)) * 1000, int(math.ceil(n1 / 1000)) * 1000, 1000):
        for e in range(int(math.floor(e0 / 1000)) * 1000, int(math.ceil(e1 / 1000)) * 1000, 1000):
            out.append((e, n))
    return out


def env_check():
    os.environ.setdefault("PROJ_NETWORK", "OFF")
