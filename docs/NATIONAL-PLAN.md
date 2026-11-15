# National layer build: file ownership

Several agents work in this folder at once. Stay inside your own files.

| Workstream | Owns (may create/edit) |
|---|---|
| Terrain data | `public/assets/national/*`, `data/national/terrain.json`, `data/national/sources-terrain.json`, `scripts/national/*`, `research/national-terrain.md` |
| England history data | `data/national/site.json`, `eras.json`, `events.json`, `places.json`, `polities.json`, `sources-england.json`, `research/national-england.md` |
| Wales + linear features data | `data/national/places-wales.json`, `polities-wales.json`, `lines.json`, `sources-wales.json`, `research/national-wales.md` |
| National viewer | `src/national/*` (except `types.ts`, read-only), `src/components/NationalViewer.tsx`, `src/components/App.tsx`, `app/page.tsx`, `app/national.css` |
| Site engine generalisation | `src/lib/*`, `src/scene/*`, `src/components/Viewer.tsx`, `app/globals.css`, `tests/unit/*` |
| Brentford site | `data/locations/brentford/*`, `research/brentford.md` |
| Barnet site | `data/locations/barnet/*`, `research/barnet.md` |

Shared rules
- Contract for national data: `src/national/types.ts` (read-only for everyone).
- Sources: never edit `data/sources.json`. Write your own `{ "<id>": { "title", "publisher", "url" } }` file as listed above (sites: `data/locations/<id>/sources.json`); loaders merge them. Prefix ids (`nat-`, `wal-`, `ter-`, `bre-`, `bar-`) to avoid collisions.
- Years are signed non-zero integers (-55 = 55 BCE). Timeline is 4000 BCE to 1625 CE.
- Only cite URLs actually fetched. Mark evidence (`attested-standing | attested-excavated | attested-documentary | attested-pictorial | reconstructed | conjectural`) and confidence (`high | medium | low`) honestly; say what is not known.
- A dev server is running on http://127.0.0.1:4310. Do not start, stop or restart servers, and do not kill processes you did not start. Do not run `next build`.
- Do not touch `~/Rome` or anything outside this project folder (scratch files go under `research/` or your scratchpad).
