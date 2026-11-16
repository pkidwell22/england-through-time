# Handoff: England Through Time

You are taking over an existing project from another agent. The owner, Patrick, is busy with other work this
week, so plan to work independently and report at the end of each piece of work rather than asking as you go.
You will work on the same Mac the project was built on, in the existing checkout (the owner will tell you
where it is). Nothing has been run on Windows.

## What it is

An interactive, explorable 3D timelapse of the place that became England, from prehistory to 1625.
Next.js 15, React 19, Three.js 0.180, TypeScript. There is a national map (the landing view) and four
detailed sites: London, Brentford, Barnet and Stonehenge.

- Repository: `https://github.com/pkidwell22/england-through-time` (public, MIT), branch `main`.
- Last commit from the previous agent: `a89a6be`. The working tree was clean and pushed.
- Start with `README.md`, `RUN.md` and `docs/RECORD.md` (the running record of decisions, measurements and
  known faults). Subject notes are in `docs/`: `FIGURES.md`, `VEGETATION.md`, `STREETS.md`, `LOOK.md`,
  `SOURCES.md`, `AUDIT.md`, `STONEHENGE.md`, `NATIONAL-PLAN.md` and others.

## Rules the owner set

These came from the original brief and still apply.

1. Historical data stays separate from rendering code.
2. The year control is continuous, shows BCE/CE, and has no year zero.
3. The camera stays put when the year changes.
4. Every feature is marked as evidence-backed or reconstructed, with sources and a confidence level.
5. No anachronisms. Where evidence is thin, say so in the data and interface; do not invent precision.
6. Do not describe the result as photorealistic unless it really is. It is not yet.
7. Test and measure changes; record numbers in `docs/RECORD.md`. Keep that record going, including what is
   still wrong.
8. Before starting a server, check what is using the port. Do not stop or interfere with unrelated
   processes; pick a free port instead.
9. Third-party assets so far come only from Poly Haven (CC0), Environment Agency LIDAR (OGL), and
   MakeHuman/MPFB (CC0, or CC-BY with credit). Ask before adding any other source, and record licences in
   `docs/ASSETS.md`.
10. The repository is public. Before every push, check the diff for personal details: usernames, home
    directory paths, email addresses, names of unrelated projects, secrets, and copied third-party pages
    or PDFs. Commits must use the GitHub no-reply address already on the existing commits, not a real one.

## First job: finish verifying the last two commits

1. In the existing checkout, confirm `git status` is clean and `main` matches `origin/main`. Dependencies
   are already installed. No server is running: check port 4310 is free
   (`lsof -iTCP:4310 -sTCP:LISTEN -P -n`), then `npm run dev`.
2. The browser test scripts launch system Chrome through `playwright-core` with `--use-angle=metal`. That
   works on this Mac; it is Mac-only, so leave a note rather than a fix unless asked to port it.
3. Run everything and record the results in `docs/RECORD.md`:
   - `npx tsc --noEmit`
   - `npm test` (unit; 303 passed at the last run)
   - `node tests/e2e.mjs` (London; 155/155)
   - `node tests/national-e2e.mjs` (279/279)
   - `node tests/sites-e2e.mjs` (Brentford and Barnet; 290/290 before the figures change)
   - `node tests/stonehenge-e2e.mjs` (277/277 before the figures change)
   - `node tests/placement-audit.mjs` (0 hard defects before the figures change)
   - `node tests/res-auto.mjs`
   - `node tests/perf.mjs`
4. Compare frame times with `tests/perf-results.json` and the tables in `docs/RECORD.md`. Many readings
   sit at exactly 8.3 ms, which is the 120 Hz display cap, not the true cost; do not read those as
   improvements. Check the machine's load before trusting a timing run.

### What was not tested

The last two feature commits (national map redesign `0833603`, period figures `7f98658`) were only partly
tested: type check, unit tests, the London suite and the national suite passed. The sites suite, the
Stonehenge suite, the placement audit, the resolution test and a figures-versus-blocks timing comparison
(`?figures=blocks`, with `tests/ab-url.mjs`) were not run on those commits. Do that before building on
them.

Known flake: in the sites suite, the "timeline endpoints" group for Brentford and for Barnet fails on the
first attempt and passes on the built-in retry. That predates the recent work and has not been diagnosed.

### What is not in the repository

Derived assets under `public/assets/` are committed, so the app runs from a clone. These exist only in
the existing checkout and are ignored by git: raw LIDAR and terrain downloads, the gazetteer download,
the Python venv under `research/`, screenshots, and fetched research evidence. Do not delete them or run
`git clean -x`; a fresh clone would not have them. Blender 5.3 with the MPFB extension is already
installed for rebuilding the figures (`scripts/build-figures.mjs`).

## Known faults, roughly worst first

None of these has been prioritised by the owner. If you get no other direction, work down this list.

- Figures look like mannequins close up. The 1300 woman's wimple reads as a beard. The mix of skin tones
  was the previous agent's judgement and has no cited source; say so in the data or find one.
- No figures at Stonehenge (no staging written for that site).
- London, 4000 BCE overview: the woodland has a visible rectangular edge.
- Marsh water renders beige.
- House walls are flat at close range; chimney smoke is a faint row of dots.
- National map: the edge frame, and kingdom labels running across place labels.
- Photo mode logs a `worldPosition` shader error. It predates the recent work.
- London `bridge-low` view on High went from 13.3 ms to 16.4 ms during the realism round and nobody found
  out why.
- `docs/RECORD.md` has no section yet for the national map redesign or the figures. Write them from the
  commits and `docs/FIGURES.md`.
- Not started: a production build, and wiring the research database (`docs/DATABASE.md`) into the app.

## Useful switches

`RUN.md` lists the URL parameters. The comparison ones matter for A/B work: `figures=blocks`,
`houses=plain|noalt|alt2|farbase`, `treeimp=cards`, `placement=legacy`, `res=fixed|auto`.

## Reporting

When you finish a piece of work, leave: what changed, test results with numbers (including failures),
what you could not verify, and what is still wrong. Put the same in `docs/RECORD.md`. Commit in small,
described steps. Do not force-push or rewrite history on `main`.
