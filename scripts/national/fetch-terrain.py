#!/usr/bin/env python3
"""Download the raw open elevation data used by build-height.py.

Usage:  research/venv/bin/python scripts/national/fetch-terrain.py research/raw-terrain

Writes
  <raw>/gebco/gebco_2025_subset.nc      GEBCO_2025 Grid subset (15 arc-second, land + sea floor)
  <raw>/cop90/Copernicus_DSM_COG_30_*.tif  Copernicus DEM GLO-90 tiles (3 arc-second, land surface)
  <raw>/MANIFEST.tsv                    url, bytes, licence for every file

Needs numpy + netCDF4 (see research/national-terrain.md for the virtualenv).
No account or click-through is required for either source.
"""
import os
import sys
import urllib.request
import urllib.error

import numpy as np
import netCDF4

# Margin around the map window (49.7..56.0 N, -6.5..2.3 E) so resampling never runs off the edge.
LAT0, LAT1 = 49.5, 56.2
LON0, LON1 = -6.7, 2.5

GEBCO_DAP = ("https://dap.ceda.ac.uk/thredds/dodsC/bodc/gebco/global/gebco_2025/"
             "ice_surface_elevation/netcdf/GEBCO_2025.nc")
GEBCO_LICENCE = "GEBCO Grid terms of use: public domain, free to use/copy/adapt with acknowledgement"
COP_BASE = "https://copernicus-dem-90m.s3.amazonaws.com"
COP_LICENCE = ("Copernicus DEM GLO-90 licence: free of charge, any use incl. derived products, "
               "attribution required (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, "
               "provided under COPERNICUS by the European Union and ESA")


def fetch_gebco(out):
    if os.path.exists(out):
        return
    # GEBCO is a 86400 x 43200 pixel-centre grid: lat = -90 + (i + 0.5)/240, lon = -180 + (j + 0.5)/240
    i0, i1 = int((LAT0 + 90) * 240), int((LAT1 + 90) * 240)
    j0, j1 = int((LON0 + 180) * 240), int((LON1 + 180) * 240)
    src = netCDF4.Dataset(GEBCO_DAP)
    lat = np.asarray(src.variables["lat"][i0:i1])
    lon = np.asarray(src.variables["lon"][j0:j1])
    parts = []
    step = 400  # rows per request, keeps each OPeNDAP response small
    for a in range(i0, i1, step):
        b = min(a + step, i1)
        parts.append(np.asarray(src.variables["elevation"][a:b, j0:j1]))
        print("gebco rows", a, b, flush=True)
    elev = np.concatenate(parts, axis=0).astype("int16")
    src.close()
    dst = netCDF4.Dataset(out, "w", format="NETCDF4")
    dst.createDimension("lat", len(lat))
    dst.createDimension("lon", len(lon))
    dst.createVariable("lat", "f8", ("lat",))[:] = lat
    dst.createVariable("lon", "f8", ("lon",))[:] = lon
    v = dst.createVariable("elevation", "i2", ("lat", "lon"), zlib=True)
    v[:] = elev
    v.units = "m"
    dst.source = GEBCO_DAP + "?elevation[%d:%d][%d:%d]" % (i0, i1 - 1, j0, j1 - 1)
    dst.title = "GEBCO_2025 Grid subset (GEBCO Bathymetric Compilation Group 2025)"
    dst.close()


def cop_name(lat, lon):
    ns = "N%02d" % lat if lat >= 0 else "S%02d" % -lat
    ew = "E%03d" % lon if lon >= 0 else "W%03d" % -lon
    return "Copernicus_DSM_COG_30_%s_00_%s_00_DEM" % (ns, ew)


def fetch_cop(outdir):
    got = []
    for lat in range(int(np.floor(LAT0)), int(np.floor(LAT1)) + 1):
        for lon in range(int(np.floor(LON0)), int(np.floor(LON1)) + 1):
            name = cop_name(lat, lon)
            url = "%s/%s/%s.tif" % (COP_BASE, name, name)
            out = os.path.join(outdir, name + ".tif")
            if not os.path.exists(out):
                try:
                    urllib.request.urlretrieve(url, out + ".part")
                    os.rename(out + ".part", out)
                except urllib.error.HTTPError as e:
                    # 404 = tile is entirely ocean (no tile published)
                    print("no tile", name, e.code, flush=True)
                    continue
            print("ok", name, os.path.getsize(out), flush=True)
            got.append((url, out))
    return got


def main():
    raw = sys.argv[1]
    os.makedirs(os.path.join(raw, "gebco"), exist_ok=True)
    os.makedirs(os.path.join(raw, "cop90"), exist_ok=True)
    g = os.path.join(raw, "gebco", "gebco_2025_subset.nc")
    fetch_gebco(g)
    tiles = fetch_cop(os.path.join(raw, "cop90"))
    with open(os.path.join(raw, "MANIFEST.tsv"), "w") as f:
        f.write("file\tbytes\turl\tlicence\n")
        f.write("gebco/gebco_2025_subset.nc\t%d\t%s\t%s\n" % (os.path.getsize(g), GEBCO_DAP, GEBCO_LICENCE))
        for url, out in tiles:
            f.write("cop90/%s\t%d\t%s\t%s\n" % (os.path.basename(out), os.path.getsize(out), url, COP_LICENCE))
    total = os.path.getsize(g) + sum(os.path.getsize(o) for _, o in tiles)
    print("total bytes", total)


if __name__ == "__main__":
    main()
