"""Compare the LIDAR grids with each site's analytic relief (src/lib/terrain.ts, sampled by analytic.ts).

  npx vite-node --config vitest.config.ts scripts/lidar/analytic.ts <site> 10 <year> research/raw-lidar/analytic/<site>-<year>.json
  research/venv/bin/python -I scripts/lidar/compare.py <site> <year> [<year2>]

Prints overall statistics (over trusted cells inside site.bounds), and for London the hill and valley checks
written up in research/lidar.md. Writes research/raw-lidar/analytic/<site>-compare.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lidarlib as L  # noqa: E402
from build import decode_png  # noqa: E402

AN = L.RAW / "analytic"


def load_grid(site_id):
    meta = json.loads((L.ROOT / "data" / "locations" / site_id / "terrain-lidar.json").read_text())
    z, mask = decode_png(L.ROOT / "public" / meta["image"].lstrip("/"), meta["scale"], meta["offset"])
    raw, _ = decode_png(L.ROOT / "public" / meta["raw"]["image"].lstrip("/"), meta["scale"], meta["offset"])
    return meta, z, mask, raw


def sampler(meta, arr):
    b, c = meta["bounds"], meta["cellSize"]

    def f(x, z):
        fx = (np.atleast_1d(np.asarray(x, float)) - b["xMin"]) / c
        fz = (np.atleast_1d(np.asarray(z, float)) - b["zMin"]) / c
        return ndimage.map_coordinates(arr, [fz, fx], order=1, mode="nearest")

    return f


def main(site_id, years):
    meta, up, trust, raw = load_grid(site_id)
    ldo = meta["localDatumOffset"]
    S = sampler(meta, up)
    T = sampler(meta, trust)
    R = sampler(meta, raw)
    out = {"site": site_id, "localDatumOffset": ldo, "years": {}}
    for y in years:
        a = json.loads((AN / f"{site_id}-{y}.json").read_text())
        W, H, c = a["width"], a["height"], a["cell"]
        X, Z = np.meshgrid(a["xMin"] + np.arange(W) * c, a["zMin"] + np.arange(H) * c)
        A = np.asarray(a["heights"]).reshape(H, W)
        G = S(X, Z) - ldo
        t = T(X, Z)
        sel = t > 0.5
        d = G - A
        r = {
            "trustedCells": int(sel.sum()), "trustedFraction": round(float(sel.mean()), 3),
            "meanLidarMinusAnalytic": round(float(d[sel].mean()), 2),
            "rms": round(float(np.sqrt((d[sel] ** 2).mean())), 2),
            "p05": round(float(np.percentile(d[sel], 5)), 2), "p95": round(float(np.percentile(d[sel], 95)), 2),
        }
        out["years"][y] = r
        print(f"{site_id} {y}: trusted {r['trustedFraction'] * 100:.0f}% of site; LIDAR-upland minus analytic: mean {r['meanLidarMinusAnalytic']} m, RMS {r['rms']} m, 5-95% {r['p05']}..{r['p95']} m")
        if site_id == "london":
            out["hills"] = hills(a, S, T, R, ldo, X, Z, A, t)
            out["valleys"] = valleys(a, S, R, ldo)
    (AN / f"{site_id}-compare.json").write_text(json.dumps(out, indent=1))
    return out


def hills(a, S, T, R, ldo, X, Z, A, t):
    res = []
    G = S(X, Z) - ldo
    for h in a["hills"]:
        hx, hz = h["xz"]
        dist = np.hypot(X - hx, Z - hz)
        near = (dist < 500) & (t > 0.3)
        ring = (dist > 700) & (dist < 1100) & (t > 0.3)
        if not near.any():
            res.append({"name": h["name"], "note": "no trusted LIDAR ground within 500 m"})
            continue
        k = np.argmax(np.where(near, G, -1e9))
        ka = np.argmax(np.where(dist < 500, A, -1e9))
        base_g = float(np.percentile(G[ring], 25)) if ring.any() else float("nan")
        base_a = float(np.percentile(A[ring], 25)) if ring.any() else float("nan")
        e = {
            "name": h["name"], "analyticCentre": [round(hx), round(hz)], "analyticAmplitude": h["height"], "sigma": h["sigma"],
            "lidarCrest": [round(float(X.flat[k])), round(float(Z.flat[k]))], "lidarCrestOD": round(float(G.flat[k] + ldo), 2),
            "lidarCrestLocal": round(float(G.flat[k]), 2), "analyticCrestLocal": round(float(A.flat[ka]), 2),
            "analyticCrestAt": [round(float(X.flat[ka])), round(float(Z.flat[ka]))],
            "crestOffset_m": round(float(np.hypot(X.flat[k] - hx, Z.flat[k] - hz))),
            "lidarReliefAboveRing": round(float(G.flat[k]) - base_g, 2), "analyticReliefAboveRing": round(float(A.flat[ka]) - base_a, 2),
            "rawAtAnalyticCentreOD": round(float(R(hx, hz)[0]), 2),
        }
        res.append(e)
        print(f"  hill {e['name']}: LIDAR crest {e['lidarCrestOD']} m OD ({e['lidarCrestLocal']} local) at {e['lidarCrest']} ({e['crestOffset_m']} m from the analytic centre); "
              f"analytic crest {e['analyticCrestLocal']} local; relief above 0.7-1.1 km ring: LIDAR {e['lidarReliefAboveRing']} m vs analytic {e['analyticReliefAboveRing']} m")
    return res


def valleys(a, S, R, ldo):
    res = []
    for v in a["valleys"]:
        pts = np.asarray(v["path"], float)
        stations = []
        for i in range(len(pts) - 1):
            p0, p1 = pts[i], pts[i + 1]
            for f in (0.25, 0.75):
                p = p0 + (p1 - p0) * f
                d = p1 - p0
                n = np.array([-d[1], d[0]]) / (np.hypot(*d) or 1)
                s = np.arange(-400, 401, 5.0)
                xs, zs = p[0] + n[0] * s, p[1] + n[1] * s
                # the masked + smoothed upland grid: the raw City DTM has basement and station-box excavations
                # (up to 30 m deep) that would read as valley floors; sigma 25 m blurs a 100 m wide valley only a little
                prof = S(xs, zs) - ldo
                mid = np.abs(s) <= 150
                kmin = np.argmin(np.where(mid, prof, 1e9))
                sh = 0.5 * (prof[np.abs(s + 300) < 30].mean() + prof[np.abs(s - 300) < 30].mean())
                stations.append({"at": [round(float(p[0])), round(float(p[1]))], "floorLocal": round(float(prof[kmin]), 2),
                                 "floorOffset_m": round(float(s[kmin])), "depthBelowShoulders": round(float(sh - prof[kmin]), 2)})
        dep = [st["depthBelowShoulders"] for st in stations]
        off = [abs(st["floorOffset_m"]) for st in stations]
        print("   stations:", [(st["at"], st["floorLocal"], st["floorOffset_m"], st["depthBelowShoulders"]) for st in stations])
        res.append({"name": v["name"], "analyticDepth": v["depth"], "sigma": v["sigma"], "stations": stations,
                    "meanModernDepth": round(float(np.mean(dep)), 2), "meanFloorOffset_m": round(float(np.mean(off)))})
        print(f"  valley {v['name']}: analytic depth {v['depth']} m (sigma {v['sigma']}); modern DTM depth below shoulders at +-300 m: mean {np.mean(dep):.1f} m "
              f"(range {min(dep):.1f}..{max(dep):.1f}); floor {np.mean(off):.0f} m from the analytic line on average")
    return res


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
