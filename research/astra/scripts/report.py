#!/usr/bin/env python3
"""Write counts, coverage, schema documentation and priority comparisons."""
import collections,hashlib,json,sqlite3,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from build import TABLES

def readable(value):
    try:
        parsed=json.loads(value)
    except (TypeError,json.JSONDecodeError):return value
    if isinstance(parsed,str):return parsed
    if isinstance(parsed,list):
        if all(isinstance(r,dict) and 'from' in r for r in parsed):
            return '; '.join(f"{r['from']} to {r.get('to') if r.get('to') is not None else 'open end'}: {r.get('label','phase')}" for r in parsed)+'.'
        return value
    if isinstance(parsed,dict) and 'label' in parsed:
        return str(parsed.get('year',''))+': '+parsed['label']+'. '+parsed.get('note','')
    return value

def main():
    c=sqlite3.connect(ROOT/'england.sqlite');c.row_factory=sqlite3.Row
    def one(sql,args=()):return c.execute(sql,args).fetchone()[0]
    counts={r[0]:one('SELECT COUNT(*) FROM "'+r[0]+'"') for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")}
    validation=json.loads((ROOT/'validation.json').read_text())
    if validation['errors']:raise RuntimeError('Do not issue a report with validation errors')
    packetcounts={}
    for path in sorted((ROOT/'packets').glob('*.json')):
        d=json.loads(path.read_text());packetcounts[path.stem]=collections.Counter(r['table'] for r in d['records'])
    by1300=one('SELECT COUNT(DISTINCT place_id) FROM market_borough_by_1300')
    market_total=one("SELECT COUNT(*) FROM place WHERE id LIKE 'x-market-%'")
    market_phase=one("SELECT COUNT(*) FROM place_phase WHERE id LIKE 'x-market-%'")
    market_todos=one("SELECT COUNT(*) FROM todo WHERE id LIKE 'x-market-%' AND status='open'")
    market_values=one("SELECT COUNT(*) FROM timeline_value WHERE series_id='x-ihr-subsidy-series'")
    comp={r[0]:r[1] for r in c.execute('SELECT comparison_type,COUNT(*) FROM app_link GROUP BY comparison_type')}
    unlocated_battles=one("SELECT COUNT(*) FROM battle b JOIN event e ON e.id=b.event_id LEFT JOIN place p ON p.id=e.place_id WHERE p.lat IS NULL")
    fetched=one("SELECT COUNT(*) FROM source WHERE access_status='fetched' AND url LIKE 'http%'")
    bibliography=one("SELECT COUNT(*) FROM source WHERE access_status='not_fetched'")
    snapshots=json.loads((ROOT/'inputs/app/manifest.json').read_text())
    lines=['# England and Wales research summary','',
       '**Research checked 14 November 2026; historical scope 4000 BCE–1625 CE.**',
       '',f"Delivered a reproducible SQLite knowledge base with **{counts['source']} sources** ({fetched} fetched web sources; {bibliography} explicitly not-fetched bibliographic source), **{counts['place']} place records**, **{counts['event']} events**, **{counts['battle']} battle-detail records**, **{counts['campaign']} campaigns/movements**, **{counts['waypoint']} ordered waypoints**, and **{counts['timeline_value']} quantitative observations**. Place records include overlapping research identities and catalogue entries; these are not counts of distinct historical towns or battles proven beyond dispute.",
       '',f"All {counts['entity']:,} fact/date/workflow entities have citations and provenance. The final checks passed: {validation['checks_passed']} checks, no reported errors or warnings. SQLite foreign keys/integrity, every app pointer, date arithmetic and SQL-dump restoration were checked; restoring the dump matched every table value. This establishes structural consistency, not independent historical proof of every row.",
       '',f"The frozen application baseline was captured at `{snapshots['captured_at']}`. Later app edits by parallel workers are outside this comparison. No app files, build process or servers were changed by this research task.",
       '', '## Coverage against the brief','',
       '| Coverage area | Completed in this pass | Material limits |',
       '|---|---|---|',
       f"| 1. Prehistory | Monuments, settlement/hillfort phases, Welsh megaliths, Stonehenge sequence, contested dates, farming around 4000 BCE and Sweet Track felling 3807/3806 BCE. | Regional archaeological census incomplete; no fabricated settlement end dates or measured woodland raster. |",
       f"| 2. Roman Britain | The combined prehistoric/Roman packet has {packetcounts['pr']['place']} researched places, {packetcounts['pr']['place_phase']} place phases, {packetcounts['pr']['event']} events, named garrisons, provinces, campaign stops, walls and {packetcounts['pr']['route']} routes. | Route coverage is representative; complete road geometry and every small fort/town are not supplied. Roman end dates remain debated. |",
       f"| 3. 410–1066 | {packetcounts['em']['battle']} battle records, {packetcounts['em']['campaign']} campaigns and {packetcounts['em']['waypoint']} waypoints; English/Welsh rulers, church foundations/sees, 33 Burghal Hidage assessments, Great Army winters, Danish conquest and 1066. | Late-annal/traditional battles are distinguished from contemporary proof. Many sites and annal chronologies remain unresolved; king/bishop lists are not complete for every minor polity. |",
       f"| 4. 1066–1485 | Later-period packet covers 52/52 relevant actions in the consulted 1066–1625 English inventory: 33 with individual-source treatment, 19 cautious catalogue skeletons. Welsh battles, six Edward I castles, monastic houses, plague/famine, revolt and Conwy’s planned borough are represented. | Inventory coverage is not every conceivable skirmish or siege. The 19 skeletons retain detail-verification tasks. Cathedral campaigns, manorial castles and borough charters need deeper work. |",
       f"| 5. 1485–1625 | Tudor/Jacobean reigns, major-house dissolutions, Welsh statutory and shire changes, Tudor rebellions, four coastal artillery forts, Armada stops, Mary Rose, 23 theatre anchors, schools, Oxford, Bristol/Cabot, plagues and 1607 flood. | Regional fires/plagues, coastal forts, planned towns and educational foundations are selective. Overseas material is contextual to English/Welsh events. |",
       f"| 6. Cross-cutting | All 40 IHR county/Wales pages: {market_total:,} catalogue headers, {market_phase:,} date-qualified phases, {by1300:,} places with a parsed market/borough attestation by 1300, {market_values:,} 1334 subsidy values. Population alternatives, price/wage decades, woodland estimates and 3,250 annual values for two OWDA cells. | {market_todos} market-related open tasks retain complex dates/qualifications. Gazetteer grants are not operational-town counts; 1086/1377/1520s complete urban rankings, comprehensive sees and English shire creation chronology remain gaps. |",
       '', 'All six coverage areas were worked through. The checked corpus and its explicit research queue are the completion of this research pass; the file does not claim exhaustive verification of every town, battle or monument across 5,600 years.',
       '', '## Row counts','', '| Table | Rows |', '|---|---:|']
    lines += [f'| `{t}` | {n:,} |' for t,n in counts.items()]
    lines += ['', 'Counts distinguish bookkeeping (`entity`, `citation`, `loaded_packet`), date evidence and substantive tables. `todo` records are leads, not established historical facts. The `fact` view unifies provenance without duplicating stored assertions.',
       '', '## The 50 priority disagreements and refinements','',
       'These are **not 50 demonstrated factual errors**. Some app prose already admits the uncertainty but its scalar dates or markers cannot represent it. “Correction” identifies a conflicting factual claim; “uncertainty” preserves limits/alternatives; “refinement” adds distinctions needed for faithful rendering. A source’s silence supports an “unverified exact date” finding, not proof that the date is false. Omissions and identity-only agreements remain in `app_link` and are excluded from this ranked set.',
       '', 'Comparison counts: '+', '.join(f'{k} {v}' for k,v in sorted(comp.items()))+'. Editorial priority is stored in `app_link.importance`.', '']
    rows=c.execute("SELECT a.*,s.title,s.publisher,s.url,s.bibliographic_ref,s.access_status FROM app_link a JOIN source s ON s.id=a.source_id WHERE comparison_type IN ('correction','uncertainty','refinement') ORDER BY importance,CASE comparison_type WHEN 'correction' THEN 0 WHEN 'uncertainty' THEN 1 ELSE 2 END,id LIMIT 50").fetchall()
    if len(rows)!=50:raise RuntimeError('Need 50 supported substantive comparisons, never fabricated padding')
    for index,r in enumerate(rows,1):
        source=f"[{r['title']}]({r['url']})" if r['url'] else r['bibliographic_ref']
        status='; **not fetched this session**' if r['access_status']=='not_fetched' else ''
        lines += [f"### {index}. {r['app_id']} — {r['comparison_type']}", '',
          f"App location: `{r['app_file']}#{r['json_pointer'] or ''}`. Database comparison: `{r['id']}`.", '',
          '**App:** '+readable(r['app_claim']), '', '**Research:** '+r['research_claim'], '',
          f"**Evidence:** {source}, {r['publisher']}; checked {r['checked_on']}{status}. **Confidence: {r['confidence']}.**",'']
    lines += ['## Weakest areas and open questions','',
       f"- **Battle locations and chronology:** {unlocated_battles} battle records have no usable coordinate. Other anchors can be approximate or disputed. Traditions, annal-year calibration, casualty rhetoric and late sources need continued critical work. Null is intentional; it is not an invitation to invent a dot.",
       '- **Bulk market assertions:** every page was fetched and structurally scanned, but detailed manual source checking sampled a limited set. Corrected encoding, merged cells, circa parsing, bibliographic false dates and schedule conflation are documented. Complex early-century and qualified dates remain tasks. The current 2,418 headers differ from the older introductory 2,393 total; they are observed catalogue headers, not a certified unique-town census.',
       '- **Quantitative comparability:** population figures from different methods/vintages remain separate and disputed. Subsidy assessments, fiscal hides and population are distinct. Two climate cells demonstrate an archive-backed temporal series; national aggregation and reconstruction-skill uncertainty are not supplied.',
       '- **Coverage depth:** complete episcopal successions, English shire formation, detailed cathedral construction, minor forts/castles, route geometry, royal itineraries, monthly nationwide plague spread, and urban rankings for all requested benchmarks remain incomplete. Follow the explicit `todo` queue rather than treating missing rows as absence.',
       '- **Positions:** many individually researched sites retain separately sourced provisional app coordinates. The IHR grids are independently transformed locality anchors with a 1 km radius. The database is not a surveyed national archaeological GIS.',
       '- **Chronology bounds:** `by` and `before` are now typed qualifiers. Lady Day years and Julian/Gregorian equivalents must not be collapsed. Numeric early-century brackets sometimes index qualitative source wording; the row notes distinguish these from measured intervals.',
       f'- **Source access:** {bibliography} source records remain marked not_fetched. Some institutional routes denied access; some records use a publisher’s accessible extract rather than a full subscription article, as their source notes state. Original manuscripts underlying institutional syntheses were generally not consulted. Search snippets were not promoted to fetched-page verification.',
       '', '## What the application should wire in first','',
       '1. **Evidence and uncertainty UI:** source links, checked dates, evidence class, date bounds/qualifiers, position method and radius, and dispute alternatives. This prevents a precise-looking animation from silently strengthening a weak claim.',
       '2. **Battles and campaign stops:** use `event_timeline` and `movement_timeline` for Brentford, Barnet, 1013–16, 1066 and Great Army winter camps. Render unknown/disputed sites as unresolved areas or text, and label interpolated travel. Do not render invented deployments from a locality anchor.',
       '3. **Existing site phases:** start with Stonehenge and London comparisons, separating construction, consecration, institutional closure and physical destruction. Use explicit app links against the frozen baseline, then reconcile any later app edits.',
       '4. **Quantitative layers with definitions:** show population models separately, fiscal assessments as fiscal measures, and the two local climate cells as local reconstructions. Preserve units and aggregation periods.',
       '5. **National place expansion:** resolve identity candidates and market qualifications before rendering towns. The IHR extraction requires permission before public/commercial reuse under its stated terms; do not assume an open-data licence. The Conwy HER record also requires permission for publication/commercial resources. [IHR terms](https://archives.history.ac.uk/gazetteer/copyright.html), [Heneb terms and attribution](https://archwilio.org.uk/her/chi3/report/page.php?watprn=GAT3189).',
       '', '## Validation and reproducibility','',
       'See [README.md](README.md), [SCHEMA.md](SCHEMA.md), [queries.sql](queries.sql) and [validation.json](validation.json). The SQLite and SQL dump rebuild offline from the packet JSON. Every table is documented; there is no renderer dependency. [LOG.md](LOG.md) records checkpoints and the corrections prompted by review.',
       '', 'Independent review reports: [market importer](evidence/pr-market-review.md), [London/cross-cutting packet](evidence/em-core-review.md). Final author resolutions and the Durham/Fountains source check are recorded in the log and [source check](evidence/lm-source-check.md). These are targeted reviews, not blanket independent certification.', '']
    (ROOT/'SUMMARY.md').write_text('\n'.join(lines))
    schema=['# Schema and conventions','','All substantive tables below carry `id`, `source_id`, `checked_on`, `confidence`, `evidence_class`, `notes`, `dispute_id`, `start_date_id`, and `end_date_id`. Source and date citations are generated by the loader. Constraints are authoritative in [schema.sql](schema.sql).','','## Supporting tables','','| Table | Purpose |','|---|---|',
       '| `source` | Title, publisher/author, fetched URL or precise not-fetched bibliography, access status, checked date, source type and lead-only flag. |',
       '| `entity` | Global ID/type/packet registry for referentially checked generic links; not itself a historical assertion. |',
       '| `date_span` | Historical earliest/latest years, generated astronomical years, optional month/day, circa, calendar, precision, qualifier and its own provenance. Bounds describe one uncertain instant; duration uses two date rows. |',
       '| `citation` | Every fact/date entity to one or more sources, with locator, citation role and checked date. |',
       '| `loaded_packet` | Exact input packet SHA-256 and record count; no historical claim. |',
       '', '## Substantive and workflow tables','','| Table | Meaning | Specific fields |','|---|---|---|']
    for table,(doc,cols) in TABLES.items():
        names=[r[1] for r in c.execute(f'PRAGMA table_info({table})') if r[1] not in ['id','source_id','checked_on','confidence','evidence_class','notes','dispute_id','start_date_id','end_date_id']]
        schema.append(f'| `{table}` | {doc} | '+', '.join('`'+x+'`' for x in names)+' |')
    schema += ['', '## Views','',
       '- `fact`: common provenance across all typed fact/date/workflow rows. Exclude `todo` for historical claims and `date_span` when counting independent assertions.',
       '- `event_timeline`: event dates, qualifiers and position anchors. A date field alone must not override its qualifier.',
       '- `movement_timeline`: ordered campaign stops with temporal uncertainty and spatial confidence.',
       '- `place_timeline`: place phases joined to name, coordinate and date context.',
       '- `market_borough_by_1300`: complete-date-band cutoff on parsed IHR market/borough attestations, with qualification flag. It includes grants; it is not an operational market census.',
       '- `app_disagreements`: corrections, uncertainty and refinements, joined to their principal source; omissions/agreements remain in `app_link`.',
       '', '## Key semantics','',
       '`circa` expresses approximation. `earliest_year` and `latest_year` are date bounds, not a probability distribution. `qualifier=at` is an occurrence/observation anchor; `by`, `before` and `after` are one-sided bounds. When a source says only “early century,” the indexing bracket and its conventional nature must be stated in notes. Unknown time remains null rather than year zero.',
       '', '`person.start/end` mean birth/death. `ruler_of` and `office_tenure` use tenure bounds. `polity_period`, phases and campaigns describe durations where both references are supplied. `timeline_value` may use start/end for a decadal aggregation; it must not be plotted as one annual measurement.',
       '', 'Coordinates use latitude/longitude degrees in WGS84. The uncertainty radius is a conservative locator envelope unless stated otherwise, not a calibrated 95% error interval. `unlocated` requires null coordinates/radius. Climate grid cells are explicitly `kind=climate_grid_cell`; they must not become settlement icons.',
       '', 'IDs prefixed `pr-`, `em-`, `lm-` and `x-` preserve provenance of research batches. Duplicate historical identities can be linked without overwriting different source assertions. Source conflicts use `dispute_id`; separate rows retain each claim and its source. No unlabelled consensus is inferred by the loader.',
       '', 'Foreign keys, typed relation endpoints, allowed evidence/confidence values and no-year-zero conversion are validated. Original source existence, interpretation and publication rights remain research questions beyond structural SQL validity.', '']
    (ROOT/'SCHEMA.md').write_text('\n'.join(schema))
    (ROOT/'app-comparisons.json').write_text(json.dumps([dict(r) for r in c.execute('SELECT a.*,s.title AS source_title,s.url,s.access_status FROM app_link a JOIN source s ON s.id=a.source_id ORDER BY a.importance,a.id')],ensure_ascii=False,indent=2)+'\n')
    manifest={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ['england.sqlite','england.sql','schema.sql','SUMMARY.md','SCHEMA.md','validation.json']}
    (ROOT/'checksums.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(f'Summary with {len(rows)} priority comparisons; {counts["source"]} sources, {counts["entity"]} fact/date/workflow entities; {by1300} market/borough places by 1300.')
if __name__=='__main__':main()
