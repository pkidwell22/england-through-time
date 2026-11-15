# Running London Through Time

Requires Node 20+ (built and tested on Node 26). From this folder:

```bash
npm install
npm run dev        # development server on http://127.0.0.1:4310
```

Production build:

```bash
npm run build && npm start     # also http://127.0.0.1:4310
```

Port 4310 was chosen because 3000, 5000, 7000, 8000 and 8080 were already in use on this
machine when the project was created. Before starting, check the port is free:

```bash
lsof -iTCP:4310 -sTCP:LISTEN -P -n
```

If something else holds it, pick another port rather than stopping that process:

```bash
npx next dev --hostname 127.0.0.1 --port 4311
```

Restart: stop the server with Ctrl-C in its terminal and run `npm run dev` again.

## URL parameters (for repeatable views)

`?site=london|brentford|barnet|stonehenge` (no `site` = the national map)
· `?year=1616` or `?year=55%20BCE` · `&view=overview|city|westminster|bridge|bridge-low|bridgehead`
· `&quality=low|medium|high|cinematic` · `&look=clear|golden|overcast|dawn`
· `&photo=1` (open path-traced photo mode) · `&ui=0` (hide interface) · `&labels=0` · `&evidence=1`
· `&placement=legacy` (the pre-audit placement, for comparison)
· `&res=fixed` (always draw at the quality tier's full resolution) or `&res=auto` (see below)
· `&event=boudica-60|london-bridge-1014|brentford-1016|barnet-1471`

## Automatic resolution

On Medium and above the view lowers its drawing resolution in steps when frames run late (under about 42 a
second) and raises it again when they run on time, down to no less than three quarters of a CSS pixel. The quality
tier sets the ceiling. `&res=fixed` turns this off. Automated browsers (the test suites, screenshots) keep the
fixed resolution unless `&res=auto` is given, so that their pictures stay comparable.

## Controls

- Timeline: drag the slider, click an era band to jump to its preset year, or click the year
  readout and type a year (`55 BCE`, `1066`). Space = play/pause. `H` hides the interface.
- Orbit: drag to rotate, right-drag or two-finger drag to pan, wheel to zoom.
- Walk: drag to look, W A S D to move, Q / E to lower / raise, Shift to run.
- Click a building for its dates, evidence class, uncertainty and sources.

## Tests and screenshots

```bash
npm test                         # unit tests (year maths, lifecycles, dataset rules)
npm run test:e2e                 # browser tests against the running server (uses installed Chrome)
node tests/shots.mjs <label>     # fixed-viewpoint screenshots into docs/screenshots/<label>/
node tests/placement-audit.mjs   # placement audit: everything where it belongs for each year (~2 min, needs the dev server; exit 1 on hard defects)
node tests/sites-e2e.mjs         # Brentford and Barnet
node tests/stonehenge-e2e.mjs    # Stonehenge
node tests/national-check.mjs    # national data checks
node tests/national-e2e.mjs      # national map in the browser
python3 tests/db_check.py        # database integrity
python3 scripts/db/build.py      # rebuild data/db/history.sqlite from the JSON data
```

The browser suites need the dev server running and should be run one at a time.

```bash
node tests/look-shots.mjs        # live-view look comparisons
node tests/photo-shots.mjs       # live vs path-traced pairs
```

Performance (run on a quiet machine, dev server up):

```bash
node tests/perf.mjs                                    # frame-time table for every site, view and tier
node tests/profile-load.mjs stonehenge "2400 BCE" high # where a site's load time goes
node tests/profile-frame.mjs london 1616 high overview 2   # one frame split into script time and GPU wait (last number = device pixel ratio)
node tests/res-auto.mjs                                # automatic resolution settles, and stays off when it should
```
