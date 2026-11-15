# Brief: England and Wales knowledge base (research session)

You are the research lead for a historical knowledge base behind an application: an explorable 3D
timelapse of England and Wales from 4000 BCE to 1625 CE (a national relief map plus detailed sites
such as London, Stonehenge, Brentford 1016 and Barnet 1471). The app's own data lives in JSON under
`data/` in this folder; read `README.md`, `docs/RECORD.md`, `src/national/types.ts`,
`data/national/*.json` and one site folder (`data/locations/london/`) first so you know what
already exists and the standards it follows.

Your job is to build, by research, a much broader and deeper relational database of facts about
England and Wales in that period, so the application can later be wired to it. Be exhaustive within
reason and ruthless about accuracy. You are known for being pedantic about facts: use that.

## Hard rules
- Write ONLY under `research/astra/`. Do not modify anything else in this folder (other agents are
  editing the app right now). Do not start or stop servers. Do not run builds.
- Output a SQLite database `research/astra/england.sqlite` (plus `schema.sql`, and the script(s)
  that build or load it, so it is reproducible), a plain-text dump `england.sql`, and a running log
  `research/astra/LOG.md` of what you covered, what you could not verify, and open questions.
  Commit work to the database as you go so partial progress survives interruption.
- Every fact row must carry: a source (title, publisher/author, URL actually fetched or a precise
  bibliographic reference marked `not_fetched`), the date you checked it, a confidence
  (high/medium/low) and an evidence class (attested-standing, attested-excavated,
  attested-documentary, attested-pictorial, reconstructed, conjectural, tradition). Where scholars
  disagree, record the competing claims as separate rows linked by a `dispute` id; do not pick a
  winner silently. Never invent precision: use date ranges and `circa` flags.
- Prefer primary and institutional sources (chronicles in reliable editions, Historic England,
  English Heritage, Cadw, Coflein, British History Online, the Battlefields Trust, Pleiades, PASE,
  the Electronic Sawyer, Open Domesday, university projects, museum catalogues, peer-reviewed
  papers). Wikipedia and Wikidata may be used for leads and coordinates and must be marked as such.
- Years: store the historical signed year (negative = BCE, there is no year 0) AND a continuous
  astronomical value (1 BCE = 0) for arithmetic. Store day and month where known, with the calendar
  (Julian for this period) stated.
- Coordinates: WGS84 lat/lon with an uncertainty radius in metres and how the position is known
  (surveyed, registered boundary centroid, gazetteer, inferred, unlocated).
- Scope limits: end at 1625 CE. England and Wales (include Scottish, Irish and Continental context
  only where needed to explain events here).

## Schema (minimum; extend it sensibly and document every table)
- `source`, `citation` (any row to its sources).
- `place` (settlements, forts, monuments, religious houses, castles, palaces, ports, mines, battle
  sites, routes' nodes), `place_name` (names by period and language: Brittonic, Latin, Old English,
  Old Norse, Welsh, Norman French, modern), `place_phase` (dated states: founded, walled, burned,
  refounded, dissolved, abandoned; population or rank estimates with their basis).
- `person` (rulers, commanders, bishops, builders, chroniclers) with reign/office tables.
- `polity` and `polity_period` (peoples, kingdoms, provinces, lordships, shires and their creation),
  `ruler_of`.
- `event` with typed subtables or a type column: battles, sieges, raids, treaties, councils,
  foundations, dissolutions, fires, plagues, famines, floods, rebellions, coronations, charters,
  laws. For BATTLES capture: date (day where known), site and how securely it is located,
  belligerents, commanders, estimated strengths and casualties with the source of each number and
  its reliability, outcome, consequences, the campaign it belongs to, and the primary sources.
- `campaign`/`movement`: itineraries and tracks where sources allow (e.g. the Great Heathen Army's
  winter camps year by year, Harold's and William's movements in 1066, Edward I's Welsh campaigns,
  royal itineraries, the progress of the Black Death by month), as ordered waypoints with dates and
  confidence, so the app could animate them.
- `structure` (buildings and engineering works with construction phases, dimensions, materials,
  builders, destruction), linked to `place`.
- `route` (Roman roads, medieval roads, navigable rivers, pilgrim routes) with ordered nodes.
- `timeline_series` for quantitative trends with sources: population estimates, town rankings
  (Domesday, 1334 lay subsidy, 1377 poll tax, 1520s subsidies), woodland cover, climate proxies,
  prices where easily sourced.
- `relation` (generic typed link between any two entities) and `dispute`.
- `app_link` (maps your entity ids to ids already in the app's JSON where they correspond, with a
  note on any disagreement between your research and the app's data — these disagreements are
  valuable; record them carefully with sources).

## Coverage plan (work through it and tick off in LOG.md)
1. Prehistory: monuments and their dated phases, major excavated settlements, hillforts.
2. Roman Britain: conquest campaigns, forts and fortresses with garrisons, towns, roads, the walls,
   provinces, the end of Roman rule.
3. 410–1066: kingdoms and their rulers, conversion and church foundations, every reasonably
   attested battle, Viking raids and armies year by year, the burhs, the unification of England,
   Welsh kingdoms and rulers, the 1013–1016 Danish conquest, 1066 in detail.
4. 1066–1485: castles (royal and baronial, with building dates), monasteries by order with
   foundation and dissolution dates, cathedral building campaigns, boroughs and charters, the
   Anarchy, Magna Carta and the Barons' Wars, the conquest of Wales and Edward I's castles, the
   Scottish wars as they touch England, famine and Black Death, the Peasants' Revolt, Glyndŵr, the
   Wars of the Roses battle by battle.
5. 1485–1625: Tudor and Jacobean reigns, rebellions, the Dissolution house by house for the major
   houses, coastal forts, the Acts of Union with Wales, the Armada year, plantations of towns,
   theatres, universities and schools, the major fires and plagues, exploration ports.
6. Cross-cutting: every battle fought in England and Wales in the period with coordinates; a
   gazetteer of every town with a market or borough status by 1300 if a reliable list is
   obtainable; rulers' lists; bishops' sees; shire formation.
Prioritise breadth first (a correct skeleton of everything), then depth on battles and campaigns,
then depth on places that the app already shows.

## Working method
Use parallel sub-agents or sessions if you have them. Verify before you record. Keep a `todo`
table of leads not yet followed. At the end write `research/astra/SUMMARY.md`: row counts per
table, coverage achieved against the plan, the 50 most important disagreements with the app's
existing data (each with what the app says, what you found, sources, and your confidence), the
weakest areas, and recommendations for what the application should wire in first.
