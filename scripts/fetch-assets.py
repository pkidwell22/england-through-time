"""Download the CC0 Poly Haven assets listed in data/assets.json into public/assets/.
Run from the project root:  python3 scripts/fetch-assets.py
Only talks to api.polyhaven.com / dl.polyhaven.org. Existing files are skipped."""
import json, os, sys, urllib.request

UA = {"User-Agent": "texture-fetch/1.0"}
def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()

manifest = json.load(open("data/assets.json"))
ids = sorted({m["asset"] for m in manifest["materials"].values()} | set(manifest.get("extra", [])))
for aid in ids:
    d = f"public/assets/textures/{aid}"
    os.makedirs(d, exist_ok=True)
    want = {"diff": ["Diffuse", "diff"], "nor": ["nor_gl"], "rough": ["Rough", "rough"]}
    if all(os.path.exists(f"{d}/{k}.jpg") for k in want):
        continue
    files = json.loads(get(f"https://api.polyhaven.com/files/{aid}"))
    for out, keys in want.items():
        url = next((files[k]["1k"]["jpg"]["url"] for k in keys if k in files and "1k" in files[k] and "jpg" in files[k]["1k"]), None)
        if not url:
            print("  missing", aid, out); continue
        open(f"{d}/{out}.jpg", "wb").write(get(url))
    print("ok", aid)
skies = [manifest["sky"]["asset"]] + [v for k, v in manifest.get("skies", {}).items() if k != "note"]
os.makedirs("public/assets/sky", exist_ok=True)
for sky in skies:
    p = f"public/assets/sky/{sky}_2k.hdr"
    if not os.path.exists(p):
        files = json.loads(get(f"https://api.polyhaven.com/files/{sky}"))
        open(p, "wb").write(get(files["hdri"]["2k"]["hdr"]["url"]))
        print("ok sky", sky)
