# London Through Time

An explorable 3D timelapse of the London/Thames area from 4000 BCE to 1625 CE: one place
within the land that became England, not a model of the whole country.

- **Run it:** see [RUN.md](RUN.md) (`npm install && npm run dev`, then http://127.0.0.1:4310).
- **Decisions, iterations, limitations:** [docs/RECORD.md](docs/RECORD.md).
- **Sources by landmark:** [docs/SOURCES.md](docs/SOURCES.md); registry in `data/sources.json`.
- **Progress screenshots:** `docs/screenshots/v1` … `v6` (same fixed viewpoints each pass).

## Layout

```
data/                     history only: no rendering code reads anything else
  sources.json            source registry (title, publisher, URL)
  locations/london/
    site.json             origin, bounds, river, relief, woodland trend, camera views, district
    eras.json             six eras with preset years
    events.json           timeline ticks
    landmarks.json        named features: dated phases, evidence class, confidence, sources
    zones.json            generic fabric: dated settlement zones
src/lib/                  pure logic (tested): years, lifecycle, terrain model, dataset validation
src/scene/                Three.js: engine, terrain, landmark builders, fabric, district, materials
src/components/Viewer.tsx interface
tests/                    unit tests, browser tests, screenshot script
research/                 raw research output the dataset was built from
```

To add a location, create `data/locations/<id>/` with the same five files and register it in
`src/lib/data.ts`. To replace a provisional model, add a builder for a new `kind` in
`src/scene/builders.ts` (or load an authored asset there) and change the `kind` in the data.

## Two levels of finish

- **Schematic overview:** the whole 4.8 × 3 km area. Parametric landmarks, lattice streets,
  one house model per several real buildings.
- **Benchmark district:** the London Bridge bridgehead, outlined in the scene and flagged in
  the interface. Individually generated houses, the detailed bridge, wharves.

Neither is photorealistic yet. `docs/RECORD.md` says what still gives it away.

## Assets

Scanned materials and the sky are CC0 from Poly Haven. `python3 scripts/fetch-assets.py`
re-downloads anything missing from `public/assets/` using `data/assets.json`.
