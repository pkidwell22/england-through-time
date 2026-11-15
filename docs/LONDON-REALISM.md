# London realism pass: workstreams and file ownership

Goal: get the London site, and above all the benchmark district (London Bridge bridgehead),
as close to photorealism as procedural models and CC0 scanned materials allow. Never claim
photorealism that has not been earned; say what still gives it away.

Several agents work at once. Edit ONLY the files you own.

| Workstream | Owns |
|---|---|
| Houses | `src/scene/houses.ts` |
| London Bridge | `src/scene/district.ts` |
| Churches and religious houses | `src/scene/landmarkDetail.ts` section "ecclesiastical" → use `src/scene/detail/ecclesiastical.ts` |
| Secular landmarks | `src/scene/detail/secular.ts` |
| Vegetation | `src/scene/vegetation.ts` (+ new files under `src/scene/veg/`) |
| People, animals, smoke, boats | `src/scene/populace.ts` (+ new files under `src/scene/pop/`) |
| Ground and foreshore | `src/scene/groundDetail.ts` (+ new files under `src/scene/ground/`) |

`src/scene/landmarkDetail.ts` only imports and calls the two detail modules; whoever arrives
first creates it in that form (`registerEcclesiastical()` and `registerSecular()`), the other
adds their line. Everything else in `src/` is read-only for these workstreams, including
`builders.ts`, `engine.ts`, `geom.ts`, `materials.ts`, `fabric.ts`, `landmarks.ts`,
`terrainMesh.ts`. Data files are read-only too.

Rules
- Dev server already runs at http://127.0.0.1:4310. Never start/stop/restart servers, never run
  `next build`, never kill processes you did not start.
- Other agents share this folder. A broken file breaks the page for everyone: keep each save
  type-correct (`npx tsc --noEmit` after every edit; fix your errors at once). If the page fails
  because of someone else's file, wait a minute and retry; do not edit their file.
- No new assets except CC0 textures from Poly Haven added through `data/assets.json` +
  `python3 scripts/fetch-assets.py` (materials are looked up by name; see `materials.ts`).
- Models take all history from the data. Do not hard-code dates. Do not add features the data
  does not describe (no clocks, no glass before it is plausible, no brick chimneys on Roman or
  Saxon houses, no anachronistic window types). Period-correct detail only; when unsure, leave it out.
- Performance budget on the reference machine at High quality, 1600x900: the views `bridge`,
  `bridge-low`, `bridgehead`, `city`, `overview` at 1616 must stay under 25 ms per frame
  (`window.__ltt.benchmark(20).msPerFrame`). Instanced fabric is drawn thousands of times: keep a
  district-detail house under about 900 triangles and an overview house under about 150.
- Check your own work with screenshots: `node tests/dbg.mjs "<query>" <out.png> "<js>"`, e.g.
  `node tests/dbg.mjs "site=london&year=1616&view=bridgehead&quality=high&ui=0&labels=0" out.png "(async()=>{await new Promise(r=>setTimeout(r,3500)); return window.__ltt.benchmark(20)})()"`.
  You can move the camera in the script with `window.__ltt.setCamera([x,y,z],[tx,ty,tz])`.
  Save before/after pairs under `docs/screenshots/london-realism/<workstream>/`.
- Look at each era your models appear in (e.g. 150, 780, 1050, 1300, 1616), not just 1616.
