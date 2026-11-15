"""Download the Environment Agency LIDAR Composite DTM (1 m, bare earth) for each site, plus the
OpenStreetMap outlines used for the modern-feature and earthwork masks.

  research/venv/bin/python scripts/lidar/fetch.py [site ...]

Route: the Defra Data Services Platform WCS 2.0.1 endpoint (no account, no click-through)
  https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs
  coverage 13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m (EPSG:27700, 1 m)
One GetCoverage per 1 km National Grid square (Deflate GeoTIFF, float32). Files land in
research/raw-lidar/<site>/<TILE>.tif; research/raw-lidar/MANIFEST.tsv lists URL, tile, size, licence.
Already-downloaded tiles are kept. OSTN15 (cdn.proj.org) is fetched once into research/raw-lidar/proj/.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lidarlib as L  # noqa: E402

UA = "lidar-terrain-fetch/1.0 (research script)"
OSTN = "https://cdn.proj.org/uk_os_OSTN15_NTv2_OSGBtoETRS.tif"
OVERPASS = "https://overpass-api.de/api/interpreter"


def get(url: str, dest: Path, tries: int = 9, data: bytes | None = None) -> int:
    """Download with curl (the system Python's TLS cannot reach overpass-api.de). `data`: urlencoded POST body."""
    import subprocess

    tmp = dest.with_suffix(dest.suffix + ".part")
    for k in range(tries):
        try:
            cmd = ["curl", "-sS", "-m", "300", "-A", UA, "-o", str(tmp), "-w", "%{http_code} %{content_type}"]
            if data is not None:
                body_file = dest.with_suffix(".query")
                body_file.write_bytes(data)
                cmd += ["--data-binary", f"@{body_file}", "-H", "Content-Type: application/x-www-form-urlencoded"]
            r = subprocess.run(cmd + [url], capture_output=True, text=True)
            code, _, ctype = r.stdout.strip().partition(" ")
            if r.returncode != 0 or code != "200":
                raise RuntimeError(f"HTTP {code or '?'} {r.stderr.strip()[:200]}")
            if data is None and url.startswith(L.WCS) and not ctype.startswith("image/"):
                raise RuntimeError(f"not an image ({ctype}): {tmp.read_bytes()[:200]!r}")
            tmp.replace(dest)
            if data is not None:
                dest.with_suffix(".query").unlink(missing_ok=True)
            return dest.stat().st_size
        except Exception as e:  # noqa: BLE001
            if k == tries - 1:
                raise
            # the WCS answers 429 when hit too fast: back off hard
            wait = min(240, 20 * 2 ** k) if "429" in str(e) else 5 * (k + 1)
            print(f"  retry {k + 1} {dest.name} in {wait}s: {e}", flush=True)
            time.sleep(wait)
    return 0


def wcs_url(e: int, n: int) -> str:
    q = [
        ("service", "WCS"), ("version", "2.0.1"), ("request", "GetCoverage"), ("CoverageId", L.COVERAGE),
        ("subset", f"E({e},{e + 1000})"), ("subset", f"N({n},{n + 1000})"),
        ("format", "image/tiff"), ("geotiff:compression", "Deflate"),
    ]
    return L.WCS + "?" + urllib.parse.urlencode(q)


OSM_QUERY = """[out:json][timeout:180];
(
  way["railway"~"^(rail|light_rail|subway|disused|abandoned|narrow_gauge)$"]({bb});
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary)$"]({bb});
  way["cutting"]({bb}); way["embankment"]({bb});
  way["landuse"~"^(reservoir|quarry|landfill|brownfield|construction|railway|military|industrial|port)$"]({bb});
  way["water"~"^(reservoir|basin|dock|lake|pond)$"]({bb});
  way["natural"="water"]({bb}); relation["natural"="water"]({bb}); relation["water"]({bb});
  way["waterway"~"^(river|canal|dock|stream|drain|ditch)$"]({bb});
  way["amenity"="parking"]({bb});
  way["man_made"~"^(dyke|embankment|reservoir_covered|wastewater_plant)$"]({bb});
  way["leisure"~"^(golf_course|pitch|stadium)$"]({bb});
  way["historic"]({bb}); node["historic"]({bb}); relation["historic"]({bb});
  way["archaeological_site"]({bb}); node["archaeological_site"]({bb});
  way["landuse"="forest"]({bb}); way["natural"="wood"]({bb});
);
out body geom;"""


def fetch_osm(site_id: str, proj: L.LocalProjector, win: dict, out: Path) -> int:
    lat_n, lon_w = proj.to_latlon(win["xMin"], win["zMin"])
    lat_s, lon_e = proj.to_latlon(win["xMax"], win["zMax"])
    bb = f"{lat_s:.5f},{lon_w:.5f},{lat_n:.5f},{lon_e:.5f}"
    q = OSM_QUERY.replace("{bb}", bb)
    return get(OVERPASS, out, data=urllib.parse.urlencode({"data": q}).encode())


def main(argv):
    sites = argv or list(L.SITES)
    L.RAW.mkdir(parents=True, exist_ok=True)
    L.PROJ_DIR.mkdir(parents=True, exist_ok=True)
    manifest = L.RAW / "MANIFEST.tsv"
    rows = {}
    if manifest.exists():
        for line in manifest.read_text().splitlines()[1:]:
            p = line.split("\t")
            if len(p) >= 6:
                rows[p[1]] = p
    grid = L.PROJ_DIR / "uk_os_OSTN15_NTv2_OSGBtoETRS.tif"
    if not grid.exists():
        get(OSTN, grid)
    rows["proj/" + grid.name] = [OSTN, "proj/" + grid.name, str(grid.stat().st_size), "OSTN15 NTv2 grid (Ordnance Survey), PROJ-data", "OS open licence (BSD-style, via PROJ-data)", "-"]
    for sid in sites:
        site = L.load_site(sid)
        proj = L.LocalProjector(site["origin"]["lat"], site["origin"]["lon"])
        win = L.site_window(site, L.SITES[sid]["margin"])
        bbox = L.bng_bbox_for_window(proj, win)
        tiles = L.km_tiles(bbox)
        d = L.RAW / sid
        d.mkdir(exist_ok=True)
        print(f"{sid}: {len(tiles)} tiles, BNG {[round(v) for v in bbox]}")

        def one(t):
            e, n = t
            name = L.tile_name(e, n)
            dest = d / f"{name}.tif"
            url = wcs_url(e, n)
            if not dest.exists():
                get(url, dest)
                time.sleep(1.5)  # be polite: one request at a time, paced
            return url, f"{sid}/{name}.tif", dest.stat().st_size

        with cf.ThreadPoolExecutor(1) as ex:
            for url, rel, size in ex.map(one, tiles):
                rows[rel] = [url, rel, str(size), "EA LIDAR Composite DTM, 1 m", L.LICENCE, L.ATTRIBUTION]
        osm = d / "osm.json"
        if not osm.exists():
            size = fetch_osm(sid, proj, win, osm)
            time.sleep(5)
        rows[f"{sid}/osm.json"] = [OVERPASS + " (POST, query in scripts/lidar/fetch.py)", f"{sid}/osm.json", str(osm.stat().st_size), "OpenStreetMap features via Overpass", "ODbL 1.0", L.OSM_ATTRIBUTION]
    with manifest.open("w") as f:
        f.write("url\tfile\tbytes\tdataset\tlicence\tattribution\n")
        for k in sorted(rows):
            f.write("\t".join(rows[k]) + "\n")
    total = sum(int(r[2]) for r in rows.values())
    print(f"manifest: {len(rows)} files, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main(sys.argv[1:])
