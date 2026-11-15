# England Through Time

An explorable 3D timelapse of the London/Thames area from 4000 BCE to 1625 CE: one place
within the land that became England, not a model of the whole country. Since the first
version it has grown a national map of England and Wales with drill-in sites.

- **National map:** `/` — terrain, Roman roads, places and polities by year; sites open from it.
- **London:** `/?site=london` — the original site and its benchmark district.
- **Brentford and Barnet:** `/?site=brentford`, `/?site=barnet` — the 1016 and 1471 battle sites.
- **Stonehenge:** `/?site=stonehenge` — the WHS landscape 4000 BCE–1625, stone-by-stone megaliths
  from `data/locations/stonehenge/stones.json`; see [docs/STONEHENGE.md](docs/STONEHENGE.md).

- **Run it:** see [RUN.md](RUN.md) (`npm install && npm run dev`, then http://127.0.0.1:4310).
- **Decisions, iterations, limitations:** [docs/RECORD.md](docs/RECORD.md).
- **Sources by landmark:** [docs/SOURCES.md](docs/SOURCES.md); registry in `data/sources.json`.
- **Topic notes:** [look and lighting](docs/LOOK.md), [photo mode](docs/PHOTO-MODE.md),
  [placement audit](docs/AUDIT.md), [streets](docs/STREETS.md), [vessels](docs/VESSELS.md),
  [vegetation](docs/VEGETATION.md), [database](docs/DATABASE.md), [assets](docs/ASSETS.md),
  [fact corrections](docs/CORRECTIONS.md), [national plan](docs/NATIONAL-PLAN.md).
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

Neither is photorealistic yet, in the live view or in path-traced photo mode. `docs/RECORD.md` says what still gives it away.

## Assets

Scanned materials, skies and models are CC0 from Poly Haven. `python3 scripts/fetch-assets.py`
(and `fetch-models.py`) re-download anything missing from `public/assets/`. Site terrain for
Stonehenge, Barnet and upland Brentford uses Environment Agency LIDAR (Open Government Licence
v3.0); masks use OpenStreetMap data (ODbL). Credit lines are in [docs/ASSETS.md](docs/ASSETS.md)
and `docs/RECORD.md`.

## Licence

The code is released under the MIT licence (see `LICENSE`). Third-party assets and data keep their own licences and
credits, listed in `docs/ASSETS.md` and `docs/SOURCES.md`: Poly Haven models and textures (CC0), Environment Agency
LIDAR (Open Government Licence), and OpenStreetMap data (ODbL).
