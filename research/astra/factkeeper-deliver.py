"""Persist authored reviews and produce the requested report, within the brief's allowlist."""
import collections,copy,csv,datetime,hashlib,json,pathlib,re,sqlite3

BASE=pathlib.Path(__file__).resolve().parent
ROOT=BASE.parent.parent
RUN='factkeeper-2026-11-14'
LEDGER=json.load(open(BASE/'factkeeper-review-ledger.json'))
DATA=json.load(open(BASE/'factkeeper-data-snapshot.json'))
HC=sqlite3.connect('file:'+str(BASE/'factkeeper-history-snapshot.sqlite')+'?mode=ro',uri=True)
HC.row_factory=sqlite3.Row
FACTS=[dict(r) for r in HC.execute('select * from fact')]
FM={f['fact_id']:f for f in FACTS}
MANIFEST=json.load(open(BASE/'factkeeper-fetch-manifest.json'))
FETCH={r['url']:r for r in MANIFEST}
DATE=LEDGER['access_date']

WEB_READ={
 'https://www.parliament.uk/about/living-heritage/building/palace/westminsterhall/architecture/the-hammer-beam-roof-/':'Parliament text read through web retrieval: commissioning, lantern completion and unfinished decoration at cessation in 1401.',
 'https://www.hrp.org.uk/banqueting-house/history-and-stories/the-story-of-banqueting-house/':'HRP text read through web retrieval: predecessor fire in 1619, completion in 1622.',
 'https://www.hrp.org.uk/tower-of-london/whats-on/white-tower/':'HRP text read through web retrieval: 1078–1100 interval.',
 'https://historicengland.org.uk/listing/the-list/list-entry/1000818':'HE listing text read through web retrieval: 1197 occupation, 1200 compromise, hall before 1234.',
 'https://academic.oup.com/oxford-dictionary-of-national-biography/reference/63486/reference-article-abstract/581824952':'ODNB public extract read through web retrieval: possible Powys control in 855 or later. Full subscription article not accessed.',
 'https://www.nationaltrust.org.uk/visit/yorkshire/fountains-abbey-and-studley-royal-water-garden/history-of-fountains-abbey-and-studley-royal':'National Trust text read through web retrieval: Benedictine founders in 1132, Cistercian acceptance three years later.',
 'https://www.ox.ac.uk/about/the-university/history':'University history read through web retrieval: teaching in 1096, growth from 1167, no known foundation date.',
 'https://www.open.edu/openlearn/mod/oucontent/view.php?id=14609&printable=1':'OpenLearn text read through web retrieval: distinguishes the 1536 and 1543 Acts and the later Welsh court system.'
}

def resolve(data,path):
    o=data
    for i,k in re.findall(r'\[(\d+)\]|\.([A-Za-z_][A-Za-z_0-9]*)',path):o=o[int(i)] if i else o[k]
    return o

def dump(o):return json.dumps(o,ensure_ascii=False,sort_keys=True)
def digest(o):return hashlib.sha256(dump(o).encode()).hexdigest()
def src_title(s):
    titles={'fk-westminster-nave':'Westminster Abbey: The Nave','fk-farne-history':'National Trust: Farne Islands inhabitants','fk-carvetii-rib3526':'RIB 3526: Milestone of Severus Alexander','fk-ham-hill':'Oxford Atlas of Hillforts: Ham Hill','fk-ham-hill-cambridge':'Cambridge: Britain’s biggest Iron Age fortress','fk-tacitus-histories':'Tacitus, Histories 3.45 (Loeb translation)','fk-altar-2026':'Pirrie et al. (2026): Altar Stone provenance','fk-altar-2024':'Clarke et al. (2024): Scottish provenance hypothesis'}
    return titles.get(s.get('id'),s.get('title') or s['url'])
def links(sources):return '; '.join('['+src_title(s).replace('[','(').replace(']',')')+']('+s['url']+')' for s in sources)

# Check all proposals against the captured source objects before writing anything to the DB.
assert len(LEDGER['strongest'])==20
assert len(set(r['target_id'] for r in LEDGER['reviews']))==len(LEDGER['reviews'])
expected={x['id'] for x in json.load(open(BASE/'factkeeper-leads.json'))}
assert set(LEDGER['lead_dispositions'])==expected
for r in LEDGER['reviews']:
    assert r['target_id'] in FM
    assert r['sources'] and all(s['url'].startswith('https://') or s['url'].startswith('http://') for s in r['sources'])
    p=r['proposed_correction']
    if p:
        assert resolve(DATA[p['file']],p['path'])==p['old']
        for ch in p['field_changes']:
            assert resolve([p['new']],re.sub(r'^\$\[\d+\]','$[0]',ch['path']))==ch['new']
    source_file=ROOT/'data'/r['stable_key']['origin_file']
    rootpath=re.match(r'^\$\[\d+\]',r['stable_key']['origin_path']).group(0)
    try:
        current=resolve(json.loads(source_file.read_text()),rootpath)
        old=resolve(DATA[r['stable_key']['origin_file']],rootpath)
        status='unchanged' if current==old else 'changed_since_snapshot'
    except (KeyError,IndexError,ValueError):status='path_no_longer_resolves'
    r['current_json_status']=status

# Existing rows are preserved. A backup is kept under the allowed research directory.
dbpath=ROOT/'data/db/curated.sqlite'
before=BASE/'factkeeper-curated-before.sqlite'
if not before.exists():
    source=sqlite3.connect('file:'+str(dbpath)+'?mode=ro',uri=True)
    dest=sqlite3.connect(before);source.backup(dest);dest.close();source.close()
cc=sqlite3.connect(dbpath);cc.row_factory=sqlite3.Row
cc.execute('PRAGMA foreign_keys=ON')
cc.execute('PRAGMA journal_mode=MEMORY')
schema_before=[tuple(r) for r in cc.execute("select type,name,sql from sqlite_master where sql is not null order by type,name")]
existing={}
for r in cc.execute("select id,note from fact_review where reviewer='gpt-6-astra'"):
    try:n=json.loads(r['note'])
    except (TypeError,ValueError):continue
    if n.get('run_id')==RUN:existing[(n.get('code'),n.get('record_sha256'))]=r['id']
source_ids={};review_ids={};new_ids={}
cc.execute('BEGIN IMMEDIATE')

def source_id(s):
    url=s['url']
    if url in source_ids:return source_ids[url]
    old=cc.execute("select id from curated_source where url=? and accessed=? and created_by='gpt-6-astra' order by id desc limit 1",(url,DATE)).fetchone()
    if old:source_ids[url]=old[0];return old[0]
    f=FETCH.get(url,{})
    note={'run_id':RUN,'retrieval_status':f.get('status'),'final_url':f.get('final_url',url),'body_sha256':f.get('sha256'),'local_evidence':f.get('text_file'),'web_recovery':WEB_READ.get(url),'access_limit':'HTTP availability alone is not historical verification; individual review notes define what was checked.'}
    cur=cc.execute('insert into curated_source(title,publisher,url,accessed,note,created_by) values(?,?,?,?,?,?)',(src_title(s),s.get('publisher'),url,DATE,dump(note),'gpt-6-astra'))
    source_ids[url]=cur.lastrowid;return cur.lastrowid

for r in LEDGER['reviews']:
    h=digest(r)
    if (r['code'],h) in existing:review_ids[r['code']]=existing[(r['code'],h)];continue
    note={'run_id':RUN,'code':r['code'],'record_sha256':h,'severity':r['severity'],'verdict_label':'verified' if r['verdict']=='confirmed' else r['verdict'],'assessment':r['note'],'review_confidence':r['confidence'],'review_scope':r['scope'],'stable_key':r['stable_key'],'snapshot_claim':{k:r['fact_snapshot'][k] for k in ['kind','year_from','year_to','value_text','detail','lat','lon','evidence','confidence']},'snapshot_claim_sha256':digest(r['fact_snapshot']),'current_json_status':r['current_json_status'],'sources_checked':[{'url':s['url'],'accessed':DATE,'title':src_title(s)} for s in r['sources']]}
    p=copy.deepcopy(r['proposed_correction'])
    if p:p.update(stable_key=r['stable_key'],application_note='Proposal only. Use field_changes and compare current values; do not replace a whole entity after another proposal or concurrent edit has changed it.')
    cur=cc.execute('insert into fact_review(target_type,target_id,verdict,reviewer,note,proposed_correction,correction_status) values(?,?,?,?,?,?,?)',('fact',r['target_id'],r['verdict'],'gpt-6-astra',dump(note),dump(p) if p else None,'proposed' if p else None));rid=cur.lastrowid;review_ids[r['code']]=rid
    for s in r['sources']:cc.execute('insert into curated_citation(review_id,curated_source_id,locator) values(?,?,?)',(rid,source_id(s),'Bibliography availability only' if r['code'].startswith('C-') else 'Claim-specific passages; see assessment and factkeeper-read-log.jsonl'))

for n in LEDGER['new_facts']:
    prior=None
    for r in cc.execute("select id,note from curated_fact where created_by='gpt-6-astra'"):
        try:meta=json.loads(r['note'])
        except (TypeError,ValueError):continue
        if meta.get('run_id')==RUN and meta.get('code')==n['code']:prior=r['id'];break
    if prior:new_ids[n['code']]=prior;continue
    note={'run_id':RUN,'code':n['code'],'assessment':n['note'],'sources_checked':[{'url':s['url'],'accessed':DATE} for s in n['sources']],'application_status':'new statement only; not applied to app JSON'}
    cur=cc.execute('insert into curated_fact(entity_type,entity_id,location_id,kind,statement,year_from,year_to,status,confidence,note,created_by) values(?,?,?,?,?,?,?,?,?,?,?)',tuple(n[k] for k in ['entity_type','entity_id','location_id','kind','statement','year_from','year_to','status','confidence'])+(dump(note),'gpt-6-astra'))
    new_ids[n['code']]=cur.lastrowid
    for s in n['sources']:cc.execute('insert into curated_citation(curated_fact_id,curated_source_id,locator) values(?,?,?)',(cur.lastrowid,source_id(s),n['note']))

notes={
 'london':('caveat','Construction versus completion, missing earlier institutions and the 1091 storm are recorded in L01–L11. No model dimensions, lost-building coordinates or whole skyline were independently certified.'),
 'england-wales':('caveat','National chronology, site identity and source confidence must be separated. Numeric size bins are editorial rankings, not measured populations. Battle reference points do not establish battlefield centres. See N01–N35 and the complete bibliography backlog.'),
 'barnet':('scope','The battlefield project report supports fog and the broad outcome, but not a unique site, deployment, army strength or casualty count. The scene’s explicit unknowns should be retained. No battle-line geometry was certified.'),
 'brentford':('scope','The Chronicle supports the 1016 fight and relative sequence. Exact date, ford, banks, tide, Danish commander and numbers remain unresolved; model figures and terrain are not primary evidence.'),
 'stonehenge':('scope','Reviewed last and lightly as requested. H01–H04 address conventions and mismatched timelines. The 127 individual 1625 stone states are not independently adjudicated. The November 2026 Altar Stone study supports caution about exact provenance.')
}
for loc,(kind,note) in notes.items():
    value=dump({'run_id':RUN,'assessment':note,'schema_mapping':'The brief’s verified is stored as confirmed in fact_review, as required by schema_curated.sql.'})
    if not cc.execute('select 1 from location_note where location_id=? and note=? and author=?',(loc,value,'gpt-6-astra')).fetchone():cc.execute('insert into location_note(location_id,kind,note,author) values(?,?,?,?)',(loc,kind,value,'gpt-6-astra'))

assert not cc.execute('PRAGMA foreign_key_check').fetchall()
assert cc.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
schema_after=[tuple(r) for r in cc.execute("select type,name,sql from sqlite_master where sql is not null order by type,name")]
assert schema_after==schema_before
cc.commit()
run_history_count=sum(1 for row in cc.execute("select note from fact_review where reviewer='gpt-6-astra'") if json.loads(row[0]).get('run_id')==RUN)

# Coverage is explicit: absence of a verdict is never a confirmation.
big={r[0] for r in HC.execute('select distinct place_id from place_phase where size>=4')}
battles={r[0] for r in HC.execute("select id from place where kind='battle'")}
citation_urls=collections.defaultdict(list)
for r in HC.execute('select c.entity_id,s.url from citation c join source s on s.id=c.source_id'):citation_urls[r[0]].append(r[1])
def bibliography(f):
    urls=citation_urls[f['entity_id']]
    return 'none' if not urls else 'Wikipedia only' if all('wikipedia.org/' in u for u in urls) else 'has non-Wikipedia source'
review_for={r['target_id']:r for r in LEDGER['reviews']}
coverage=[]
for f in FACTS:
    tags=[]
    if f['location_id']=='london' and f['entity_type']=='landmark':tags.append('London landmark')
    if f['entity_id'] in big:tags.append('size 4-5 place')
    if f['entity_id'] in battles:tags.append('battle')
    if f['entity_type'] in ('polity','line'):tags.append(f['entity_type'])
    if (f['evidence'] or '').startswith('attested-') and f['confidence']=='high':tags.append('attested/high')
    r=review_for.get(f['fact_id'])
    coverage.append({'fact_id':f['fact_id'],'entity_type':f['entity_type'],'entity_id':f['entity_id'],'location_id':f['location_id'],'origin_file':f['origin_file'],'origin_path':f['origin_path'],'kind':f['kind'],'year_from':f['year_from'],'year_to':f['year_to'],'evidence':f['evidence'],'confidence':f['confidence'],'priorities':'; '.join(tags),'bibliography':bibliography(f),'review_code':r['code'] if r else '', 'verdict':r['verdict'] if r else 'not individually adjudicated','severity':r['severity'] or '' if r else '', 'screening':'calendar/range, source-resolution and priority-cohort screening only' if not r else r['scope']})
with open(BASE/'factkeeper-coverage.csv','w',newline='') as out:
    w=csv.DictWriter(out,fieldnames=coverage[0].keys());w.writeheader();w.writerows(coverage)
with open(BASE/'factkeeper-source-backlog.csv','w',newline='') as out:
    w=csv.DictWriter(out,fieldnames=coverage[0].keys());w.writeheader();w.writerows(r for r in coverage if r['bibliography']!='has non-Wikipedia source')

# A consolidated field-level handoff avoids competing whole-entity replacements.
changes={}
for r in LEDGER['reviews']:
    p=r['proposed_correction']
    if not p:continue
    for ch in p['field_changes']:
        key=p['file']+'#'+ch['path']
        if key in changes:
            assert changes[key]['new']==ch['new'],('Conflicting proposals',key)
            changes[key]['reviews'].append(r['code'])
        else:changes[key]={'file':p['file'],**ch,'reviews':[r['code']],'confidence':r['confidence'],'status':'proposed'}
(BASE/'factkeeper-proposed-corrections.json').write_text(json.dumps({'application':'Review and merge these field-level proposals against current JSON. This script has not applied them. Source registry additions may also be required; citations are preserved in curated.sqlite.','changes':list(changes.values())},ensure_ascii=False,indent=2))

comparison_rows=[]
for l in json.load(open(BASE/'factkeeper-leads.json')):comparison_rows.append({**l,**LEDGER['lead_dispositions'][l['id']],'source_rechecked_on':DATE})
(BASE/'factkeeper-comparison-review.json').write_text(json.dumps(comparison_rows,ensure_ascii=False,indent=2))

verdicts=collections.Counter(r['verdict'] for r in LEDGER['reviews'])
severities=collections.Counter(r['severity'] for r in LEDGER['reviews'] if r['severity'])
high=[f for f in FACTS if (f['evidence'] or '').startswith('attested-') and f['confidence']=='high']
high_reviewed=sum(f['fact_id'] in review_for for f in high)
wiki=sum(bibliography(f)=='Wikipedia only' for f in FACTS)
none=sum(bibliography(f)=='none' for f in FACTS)
proposed=sum(bool(r['proposed_correction']) for r in LEDGER['reviews'])
sampling=json.load(open(BASE/'factkeeper-systematic-sample.json'))
status=collections.Counter(str(m.get('status','network error')) for m in MANIFEST)
challenge=[m for m in MANIFEST if m.get('text_length',999999)<150 and 'text_file' in m and 'Radware' in (BASE/m['text_file']).read_text()]
drift=json.load(open(BASE/'factkeeper-drift.json'))
review_drift=[r['code'] for r in LEDGER['reviews'] if r['current_json_status']!='unchanged']
meta=dict(HC.execute('select key,value from build_meta'))
baseline=json.load(open(BASE/'factkeeper-baseline.json'))

def md_json(obj):return '```json\n'+json.dumps(obj,ensure_ascii=False,indent=2)+'\n```\n'
report=[
 '# Adversarial fact review — London Through Time',
 f'Checked {DATE}. Reviewer: **gpt-6-astra**. Scope: England and Wales, 4000 BCE–1625 CE; London, Brentford, Barnet, and a deliberately lighter final Stonehenge pass.',
 f'**{len(LEDGER["reviews"])} current review targets: {verdicts["confirmed"]} verified, {verdicts["disputed"]} disputed, {verdicts["rejected"]} rejected and {verdicts["unverifiable"]} unverifiable.** The reviews identify **{severities["S1"]} S1, {severities["S2"]} S2 and {severities["S3"]} S3 problems**. {proposed} correction proposals and {len(LEDGER["new_facts"])} sourced additional statements are stored in `data/db/curated.sqlite`. None has been applied to application JSON.',
 'The most consequential errors are buildings appearing complete at the start of construction, early polities disappearing in AD 43, Cuthbert’s death being moved to his burial island, and intact post-Dissolution buildings being turned instantly into ruins. The imported research also contains false positives: several proposed “omissions” are already present or explicitly caveated.',
 '## Counts and interpretation',
 '| Verdict in report | SQLite verdict | Rows |\n|---|---|---:|'+''.join(f'\n| {label} | `{db}` | {verdicts[db]} |' for label,db in [('Verified','confirmed'),('Disputed','disputed'),('Rejected','rejected'),('Unverifiable','unverifiable')]),
 '| Severity | Meaning | Rows |\n|---|---|---:|'+''.join(f'\n| {s} | {desc} | {severities[s]} |' for s,desc in [('S1','Wrong visible date, place, existence or stated fact'),('S2','Misleading or overconfident interpretation'),('S3','Citation or sourcing defect'),('S4','Minor wording')]),
 f'Counts are latest reviews per target, not distinct root causes. The append-only table contains {run_history_count} rows for this run: {run_history_count-len(review_ids)} earlier source-limitation reviews were superseded after additional evidence resolved the Edington and Ellendun years. Verified rows have no problem severity. S3 bibliography-only reviews do not assert that the underlying history is false. Additional omission statements are listed separately below and are not added again to these counts. The schema permits `confirmed`, not `verified`; the required reviewer name is unchanged, and each note records the display-verdict mapping. No schema was altered.',
 '## Evidence and coverage',
 f'The preserved generated snapshot contains **{len(FACTS):,} fact rows**, 243 national places, 73 London landmarks, 28 national battles, 42 line features and 72 polities. It was captured at `{baseline["captured_at"]}`; its build input fingerprint is `{meta["input_sha256"]}`. The brief’s approximate 2,900 count is outdated. Stonehenge was populated in this snapshot; its old missing-source warning is also outdated (zero dangling citations).',
 f'All rows received calendar/range and citation-metadata screening. Priority review inspected London’s landmark sequences; all 43 places reaching size 4–5; all 28 battles; the Roman network and all polity dates; the 544 attested/high rows grouped by their 84 owning entities; and episode attested/tradition/unknown distinctions. **This is not a claim that every field was independently verified.** {high_reviewed} of the 544 strongest rows have individual verdicts; the rest remain explicitly unadjudicated in [the coverage ledger](factkeeper-coverage.csv). Source reading and comparison were performed at entity/claim level, so one sound foundation date did not certify its location, size and later phases.',
 f'The secondary systematic sample takes every twelfth national place, sorted by namespaced id, after excluding battles, high-confidence places and any place reaching size 4: {len(sampling["sample"])} entities from a pool of {sampling["remaining_pool"]}. The selection and inspected passages are in [the sampling record](factkeeper-systematic-sample.json). Its unsourced cases were left unverified.',
 f'All **77 non-agreement leads** from the 248-comparison research file were rechecked against their cited pages/texts and the current app snapshot. [The complete comparison ledger](factkeeper-comparison-review.json) records accepted findings, existing caveats, disagreements and optional enrichments. The 171 agreement-only links were not accepted as proof.',
 f'Availability checks attempted **{len(MANIFEST)} distinct URLs**, including the registered app bibliography, lead citations and added sources. HTTP status counts: `{dict(status)}`. {len(challenge)} HTTP-200 responses were browser-challenge pages, not readable sources. Selected blocked sources were recovered through web retrieval; the ODNB check used its public extract, not paywalled full text. [The fetch manifest](factkeeper-fetch-manifest.json) and [passage log](factkeeper-read-log.jsonl) distinguish retrieval from reading. No 403, timeout, API endpoint response or login challenge has been called a dead historical source merely for blocking automation.',
 'Coordinates were tested against published *reference markers*, not treated as ground-truth battlefield centres. Sixteen Battlefields Trust grid references could be converted and compared: offsets range from about 5 to 353 m; Bosworth agrees to about 5 m. These differences do not establish battlefield extent. Torksey’s camp centre is about 1 km north of the app’s town marker. The [coordinate calculations](factkeeper-coordinate-check.json) retain the source and method.',
 '## Full S1 and S2 findings'
]

for loc,title in [('london','London'),('england-wales','National map — England and Wales'),('brentford','Brentford'),('barnet','Barnet'),('stonehenge','Stonehenge — light final pass')]:
    selected=[r for r in LEDGER['reviews'] if r['fact_snapshot']['location_id']==loc and r['severity'] in ('S1','S2')]
    report.append('### '+title)
    if not selected:
        report.append('No S1/S2 defect was established in the reviewed claims. This does not certify conjectural scenery, troops, positions or numerical estimates. The verified and unresolved episode checks remain in the ledger.');continue
    for r in selected:
        f=r['fact_snapshot'];p=r['proposed_correction'];dates='' if f['year_from'] is None else ' ['+str(f['year_from'])+(' → '+str(f['year_to']) if f['year_to'] is not None else '')+']'
        report.extend(['#### '+r['code']+' — '+r['title']+' ('+r['severity']+'; '+r['verdict']+')',
            '**App:** '+f['entity_name']+': '+f['value_text']+dates+'.'+((' Context: '+f['detail']) if f['detail'] else ''),
            '**Finding:** '+r['note'],
            '**Evidence, accessed '+DATE+':** '+links(r['sources'])+'.',
            '**Exact proposal** ('+r['confidence']+' confidence; review row '+str(review_ids[r['code']])+'). Target `'+r['target_id']+'`; `data/'+f['origin_file']+'`:'])
        report.append(md_json({'file':p['file'],'new_values':{ch['path']:ch['new'] for ch in p['field_changes']}}))

report.extend(['## Additional sourced statements and omissions',
 'The following are in `curated_fact` with their own citations. A01–A04 accompany the related findings above. The three epidemic events are separate omissions. A05 preserves a scholarly uncertainty that survived challenge. These are proposals for editorial integration, not invented generated fact ids.'])
for n in LEDGER['new_facts']:
    report.extend(['### '+n['code']+' — '+n['statement'],n['note'],'Evidence, accessed '+DATE+': '+links(n['sources'])+'.',
        md_json({'curated_fact_id':new_ids[n['code']],'entity_id':n['entity_id'],'kind':n['kind'],'statement':n['statement'],'year_from':n['year_from'],'year_to':n['year_to'],'confidence':n['confidence']})])

report.extend(['## Systemic problems',
 '1. **One confidence label is copied onto different claims.** The generated fact table inherits an entity’s evidence/confidence for its coordinates, dimensions, phase boundaries and size bins. There are 150 high-confidence national `size` rows. Site identity or standing fabric does not independently establish a numerical ordinal rank. Keep visual size as an editorial scale and preserve claim-level limits; this review does not manufacture alternative population estimates.',
 f'2. **A nonempty citation list is not independent support.** {none} fact rows have no resolved citation; {wiki} have only Wikipedia citations. [The complete source backlog](factkeeper-source-backlog.csv) identifies each stable target and JSON path. An entity-wide source can support one date while saying nothing about another, as at Lambeth, Guildhall and the Roman abandonment phases.',
 '3. **Date windows are mistaken for durations.** A radiocarbon range is not necessarily a century-long building schedule. Approximate annual anchors are acceptable when clearly identified; labels such as completed, abandoned and disused can contradict that caveat. Silbury and Durrington are substantive examples. Already explicit caveats at Uffington, Silchester and Seahenge were not turned into spurious errors.',
 '4. **Institutional and physical histories are conflated.** Dissolution does not establish demolition, nor does a bishop’s appointment date found an episcopal institution. Lindisfarne, St Bartholomew’s and St Davids expose these distinctions. Annual transitions shared by two phases can represent within-year change; overlap alone was not labelled an impossible historical succession.',
 '5. **Coordinates often express editorial reference points.** Catalogue pins, modern village centres and battlefield registration polygons are not excavated battle centres. Mynydd Carn’s catalogue/text contradiction needs an explicit warning. Barnet, Brunanburh and Assandun already carry material caveats. Modern polity polygons likewise must not imply surveyed contemporary frontiers.',
 '6. **Road existence is better evidenced than segment dates or exact geometry.** The Itiner-e paper describes a compiled network around the Roman imperial maximum, with evidenced, conjectured and hypothetical lines. The app’s 31 routed/simplified lines explicitly admit inferred construction years and a nominal 410 end of upkeep. The secondary Britain dataset reports an approximately 100 m datum offset; the app’s research note says it was left uncorrected beneath a 300–700 m simplification tolerance. Those are limits, not metre-accurate excavated roads. The separate Military Way wrongly retains an excavated evidence label for a deliberately shifted line (N27).',
 '7. **Source conflicts must be retained.** Pevensey’s web chronology and the older Chronicle translation disagree; the old translation also places the Ellendun sequence under 823. Durham’s archive gives 31 December 1539 while VCH says 1540. The review preserves these conflicts instead of selecting the most convenient exact date. Wikipedia and the separate research database were leads throughout.',
 '## S3 review register',
 '| Code | Target | Sourcing limitation |\n|---|---|---|'+''.join('\n| '+r['code']+' | `'+r['target_id']+'` | '+r['title']+' |' for r in LEDGER['reviews'] if r['severity']=='S3'),
 'Each row’s full explanation, checked URL and access date are in SQLite and [the authored ledger](factkeeper-review-ledger.json). No S3 row is a factual rejection solely because a page blocked a request.',
 '## Disposition of all 77 imported disagreements',
 '| Lead | Outcome | Independent assessment |\n|---|---|---|'+''.join('\n| `'+r['id']+'` | '+r['disposition']+' | '+r['note'].replace('|','/')+' [Source]('+r['url']+') |' for r in comparison_rows),
 '## Twenty strongest claims that survived challenge',
 'These are the specific fields tested hardest against accessible documentary/institutional evidence. A verified date is not blanket approval of the owning model.'])
for i,code in enumerate(LEDGER['strongest'],1):
    r=next(r for r in LEDGER['reviews'] if r['code']==code)
    title=r['fact_snapshot']['entity_name']+' — battle year' if code.startswith('B-') else r['title']
    report.append(str(i)+'. **'+title+'.** '+r['note']+' '+links(r['sources'])+'. `'+r['target_id']+'`.')
report.extend(['## What remains unverified, and why',
 '- The coverage ledger deliberately leaves facts without individual adjudication visible. In particular, most size bins, exact numeric coordinates, landmark heights, detailed building forms and every century of a long institutional phase lack claim-level independent evidence in this pass. A source proving a place existed was not used to approve those other fields.',
 '- Stonehenge was treated last and lightly. Its 127 per-stone states in 1625, the fall dates inferred from later antiquarian drawings, complete-circle reconstructions, weathering schedules and the exact form of prehistoric pits were not independently established. Their explicit conjectural labels should remain.',
 '- Exact battle deployments, army totals, casualty counts, tide/weather and the locations of unlocated battles remain unresolved. Sixteen coordinate comparisons test only agreement with modern reference markers. No browser/rendering review or reconstruction of all source GIS geometries was performed.',
 '- An ordinal place-size calibration against primary town-population/tax tables was not reconstructed. Taxpayer, fiscal assessment, wealth, enclosed area, institutional significance and population are not interchangeable. The imported research likewise identifies gaps in complete urban rankings.',
 '- Many early kingdom beginnings are traditional or nominal, and the 72 polity labels cannot encode every union, division, overlordship and frontier shift. The review identifies demonstrable contradictions and citation gaps, not a newly researched complete constitutional atlas.',
 '- No builds or server operations were run. The main data and rendering code were not edited. Lifecycle findings use the documented data semantics and actual phase fields; their proposed display changes still need implementation and visual verification by the app owner.',
 '## Preservation, handoff and validation',
 f'All writes by this review are confined to the five permitted curated tables and `research/astra/` (working files use the `factkeeper-` prefix; this report uses the expressly required filename). The generated history database and the separate England research database remain read-only. A pre-write backup is [factkeeper-curated-before.sqlite](factkeeper-curated-before.sqlite). This folder has no Git metadata, so no branch or commit is claimed.',
 f'Concurrent changes were observed outside this review: {len(drift)} initially inventoried files changed or disappeared, mainly interface screenshots and rendering files; the data changes were assets, Barnet site configuration and Stonehenge terrain. [The drift log](factkeeper-drift.json) records hashes without overwriting anything. Reviewed owner objects with changed JSON at final insertion: {review_drift or "none"}. Source snapshots, stable entity/origin keys and original values are retained in every review note.',
 f'The existing curated schema was preserved. SQLite integrity and foreign-key checks pass; all {len(LEDGER["reviews"])} targets exist in the preserved generated snapshot; all proposals are valid JSON with exact field values and confidence; all reviews carry checked URLs and access dates. The 77 lead dispositions and 20 strongest claims are complete. [Validation details](factkeeper-validation.json) include counts and untouched research/database hashes.',
 'The Markdown parses into four tables and 55 JSON code blocks, and its section/link structure was checked. An HTML preview was prepared, but visual inspection was unavailable: isolated Chrome exited under the environment restrictions, and the browser-access host was unavailable. No screenshot or successful visual-layout check is claimed. See [the preview limitation record](factkeeper-report-visual-check.json).',
 'Use [the consolidated field-level proposals](factkeeper-proposed-corrections.json) when preparing app edits. Several reviews concern different fields of the same entity: merge those deltas, compare the recorded old value, and retain concurrent changes. Whole-entity old/new objects in SQLite are provenance, not permission to overwrite a later entity. Corrections remain **proposed**, not accepted or applied.'
])
(BASE/'FACT-REVIEW.md').write_text('\n\n'.join(report)+'\n')

validation={'run_id':RUN,'review_rows':len(review_ids),'append_only_rows_for_run':run_history_count,'superseded_rows':run_history_count-len(review_ids),'new_facts':len(new_ids),'source_rows_used':len({s['url'] for r in LEDGER['reviews']+LEDGER['new_facts'] for s in r['sources']}),'verdict_counts':dict(verdicts),'severity_counts':dict(severities),'proposals':proposed,'field_changes':len(changes),'strongest_count':len(LEDGER['strongest']),'lead_dispositions':len(comparison_rows),'snapshot_facts':len(FACTS),'high_attested_facts':len(high),'high_attested_individual_reviews':high_reviewed,'source_backlog_none':none,'source_backlog_wikipedia_only':wiki,'schema_unchanged':schema_before==schema_after,'integrity_check':cc.execute('PRAGMA integrity_check').fetchone()[0],'foreign_key_check':[tuple(r) for r in cc.execute('PRAGMA foreign_key_check')],'reviewed_json_changes':review_drift,'source_availability':dict(status),'browser_challenges':len(challenge),'review_ids':review_ids,'curated_fact_ids':new_ids}
for name in ['data/db/history.sqlite','research/astra/england.sqlite','research/astra/app-comparisons.json','research/astra/SUMMARY.md']:
    validation.setdefault('protected_inputs',{})[name]={'sha256':hashlib.sha256((ROOT/name).read_bytes()).hexdigest(),'matches_baseline':hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==baseline['hashes'][name]}
validation['report_bytes']=(BASE/'FACT-REVIEW.md').stat().st_size
(BASE/'factkeeper-validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2))
cc.close()
print(json.dumps({k:validation[k] for k in ['review_rows','new_facts','verdict_counts','severity_counts','proposals','strongest_count','lead_dispositions','integrity_check','schema_unchanged','reviewed_json_changes','report_bytes']},ensure_ascii=False))
