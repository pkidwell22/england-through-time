"""Download the CC0 Poly Haven 3D models listed in data/models.json.

Run from the project root:
    python3 scripts/fetch-models.py              # fetch everything missing
    python3 scripts/fetch-models.py --only fern_02,nettle_plant
    python3 scripts/fetch-models.py --report     # size report only, no network
    python3 scripts/fetch-models.py --prune      # delete raw downloads whose optimised LODs exist
    python3 scripts/fetch-models.py --prune 20   # ... only those larger than 20 MB (the big trees)

Each asset's glTF (1k textures) plus its .bin and texture files go to
public/assets/models/_src/<id>/ (the raw scan; input to scripts/optimize-models.mjs).
Every file's URL, licence and size is recorded in public/assets/models/sources.json.
Only talks to api.polyhaven.com / dl.polyhaven.org. Existing files of the right size are skipped.
"""
import json, os, sys, shutil, hashlib, urllib.request
from urllib.parse import urlparse

UA = {"User-Agent": "model-fetch/1.0"}
ALLOWED = {"api.polyhaven.com", "dl.polyhaven.org"}
OUT = "public/assets/models"
SRC = f"{OUT}/_src"


def get(url):
    host = urlparse(url).hostname
    if host not in ALLOWED:
        raise SystemExit(f"refusing non-Poly-Haven host {host} ({url})")
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300).read()


def human(n):
    return f"{n / 1e6:7.1f} MB"


def dir_size(p):
    t = 0
    for root, _, files in os.walk(p):
        for f in files:
            t += os.path.getsize(os.path.join(root, f))
    return t


def main():
    args = sys.argv[1:]
    only = None
    if "--only" in args:
        only = set(args[args.index("--only") + 1].split(","))
    manifest = json.load(open("data/models.json"))
    res = manifest.get("resolution", "1k")
    os.makedirs(SRC, exist_ok=True)
    sources_path = f"{OUT}/sources.json"
    sources = json.load(open(sources_path)) if os.path.exists(sources_path) else {}

    if "--prune" in args:
        # optional size threshold: --prune 20 removes only raw scans larger than 20 MB
        i = args.index("--prune")
        min_mb = float(args[i + 1]) if i + 1 < len(args) and args[i + 1].replace(".", "").isdigit() else 0
        for a in manifest["assets"]:
            d = f"{SRC}/{a['id']}"
            if os.path.exists(f"{OUT}/{a['id']}/model.json") and os.path.isdir(d):
                n = dir_size(d)
                if n < min_mb * 1e6:
                    continue
                shutil.rmtree(d)
                print(f"pruned {a['id']:28s} {human(n)}")
        args.append("--report")

    if "--report" not in args:
        for a in manifest["assets"]:
            aid = a["id"]
            if only and aid not in only:
                continue
            files = json.loads(get(f"https://api.polyhaven.com/files/{aid}"))
            g = files.get("gltf", {}).get(res, {}).get("gltf")
            if not g:
                print(f"  {aid}: no {res} glTF on Poly Haven; skipped")
                continue
            d = f"{SRC}/{aid}"
            entries = [(os.path.basename(urlparse(g["url"]).path), g)] + list(g.get("include", {}).items())
            # Poly Haven's glTF export drops the opacity maps of leaf/frond cards (jpg colour, no alpha);
            # fetch them separately so cut-out foliage can be alpha-tested.
            for key, by_res in files.items():
                if key.lower() == "alpha" or key.lower().endswith("_alpha"):
                    m = by_res.get(res, {}).get("png")
                    if m:
                        entries.append((f"textures/{aid}_{key.lower()}_{res}.png", m))
            rec = []
            fetched = 0
            for rel, meta in entries:
                p = os.path.normpath(os.path.join(d, rel))
                if not p.startswith(os.path.normpath(d) + os.sep):
                    raise SystemExit(f"unsafe path {rel} in {aid}")
                os.makedirs(os.path.dirname(p), exist_ok=True)
                if not (os.path.exists(p) and os.path.getsize(p) == meta["size"]):
                    data = get(meta["url"])
                    if meta.get("md5") and hashlib.md5(data).hexdigest() != meta["md5"]:
                        raise SystemExit(f"md5 mismatch {meta['url']}")
                    open(p, "wb").write(data)
                    fetched += len(data)
                rec.append({"path": f"_src/{aid}/{rel}", "url": meta["url"], "size": meta["size"], "md5": meta.get("md5")})
            sources[aid] = {
                "page": f"https://polyhaven.com/a/{aid}",
                "api": f"https://api.polyhaven.com/files/{aid}",
                "licence": "CC0 1.0",
                "resolution": res,
                "gltf": rec[0]["path"],
                "files": rec,
                "bytes": sum(r["size"] for r in rec),
            }
            json.dump(sources, open(sources_path, "w"), indent=1)
            print(f"{'ok' if fetched == 0 else 'got':4s} {aid:28s} {human(sources[aid]['bytes'])}  ({len(rec)} files)")

    # size report
    print("\nsize report (on disk)")
    tot_src = tot_opt = 0
    by_cat = {}
    for a in manifest["assets"]:
        aid = a["id"]
        s = dir_size(f"{SRC}/{aid}") if os.path.isdir(f"{SRC}/{aid}") else 0
        o = dir_size(f"{OUT}/{aid}") if os.path.isdir(f"{OUT}/{aid}") else 0
        tot_src += s
        tot_opt += o
        c = by_cat.setdefault(a["category"], [0, 0, 0])
        c[0] += 1; c[1] += s; c[2] += o
        print(f"  {aid:28s} {a['category']:12s} raw {human(s)}   optimised {human(o)}")
    print("\n  by category")
    for k, (n, s, o) in by_cat.items():
        print(f"  {k:12s} {n:3d} assets  raw {human(s)}  optimised {human(o)}")
    total = dir_size(OUT)
    print(f"\n  raw total {human(tot_src)}   optimised total {human(tot_opt)}   public/assets/models total {human(total)}")


if __name__ == "__main__":
    main()
