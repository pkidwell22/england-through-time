"""Authored findings. Produces a review ledger; never edits application data."""
import copy,datetime,hashlib,json,pathlib,re,sqlite3
BASE=pathlib.Path(__file__).resolve().parent
C=sqlite3.connect('file:'+str(BASE/'factkeeper-history-snapshot.sqlite')+'?mode=ro',uri=True)
C.row_factory=sqlite3.Row
FACTS={r['fact_id']:dict(r) for r in C.execute('select * from fact')}
DATA=json.load(open(BASE/'factkeeper-data-snapshot.json'))
SOURCES={r['id']:dict(r) for r in C.execute('select * from source')}
for r in json.load(open(BASE/'factkeeper-leads.json')):SOURCES[r['id']]={'id':r['id'],'url':r['url'],'title':r['source_title'],'publisher':None}
for r in json.load(open(BASE/'factkeeper-extra-sources.json')):SOURCES[r['id']]={**r,'title':r['id'],'publisher':None}
REVIEWS=[];NEWFACTS=[];LEADS={};STRONG=[]
DATE='2026-11-14'

def get(file,path):
    obj=DATA[file]
    for token in re.findall(r'\[(\d+)\]|\.([A-Za-z_][A-Za-z_0-9]*)',path):
        obj=obj[int(token[0])] if token[0] else obj[token[1]]
    return copy.deepcopy(obj)

def owner(fid):
    f=FACTS[fid]
    return re.match(r'^\$\[\d+\]',f['origin_path']).group(0)

def patch(fid,fields,confidence='high'):
    f=FACTS[fid];root=owner(fid);old=get(f['origin_file'],root);new=copy.deepcopy(old);changes=[]
    for rel,value in fields.items():
        toks=re.findall(r'([A-Za-z_][A-Za-z_0-9]*)|\[(\d+)\]',rel);o=new
        for k,i in toks[:-1]:o=o[int(i)] if i else o[k]
        k,i=toks[-1];key=int(i) if i else k;before=copy.deepcopy(o.get(key)) if isinstance(o,dict) else copy.deepcopy(o[key]);o[key]=value
        changes.append({'path':root+'.'+rel,'old':before,'new':value})
    return {'file':f['origin_file'],'path':root,'old':old,'new':new,'field_changes':changes,'confidence':confidence}

def add(code,fid,title,verdict,severity,note,sources,fields=None,confidence='high',scope=None):
    f=FACTS[fid]
    r={'code':code,'target_type':'fact','target_id':fid,'title':title,'verdict':verdict,'severity':severity,'confidence':confidence,'note':note,'sources':[SOURCES[s] if s in SOURCES else {'id':s,'url':s,'title':s,'publisher':None} for s in sources],'scope':scope or f['origin_path'],'stable_key':{k:f[k] for k in ['entity_type','entity_id','origin_file','origin_path']},'fact_snapshot':f,'proposed_correction':patch(fid,fields,confidence) if fields else None}
    if r['proposed_correction']:r['proposed_correction']['rationale']=note
    REVIEWS.append(r);return r

def lead(id,disposition,note,codes=()):
    LEADS[id]={'disposition':disposition,'note':note,'finding_codes':list(codes)}

def verify(code,fid,title,note,sources,strong=False):
    r=add(code,fid,title,'confirmed',None,note,sources)
    if strong:STRONG.append(code)
    return r

def entity(fid):return get(FACTS[fid]['origin_file'],owner(fid))

# London: distinguish a construction campaign from an immediately complete model.
add('L01','landmark:london/westminster-abbey:phase:2','Westminster nave complete 141 years too early','rejected','S1',
    'The phase begins in 1376 with continues=true and no built year, although its own dateNote says 1376–1517. The Abbey’s nave history explicitly gives completion in 1517. Under the documented lifecycle this displays the finished westward nave at the start of the campaign.',
    ['fk-westminster-nave'],{'phases[2].built':1517,'phases[2].continues':False,'phases[2].label':'Westward nave rebuilding (1376–1517)'})
add('L02','landmark:london/westminster-hall:phase:1','Westminster roof appears when commissioned','rejected','S1',
    '1393 is the commission date. Parliament dates the lanterns to 1397–98 and says decorative work remained unfinished when work stopped in 1401. continues=true with no built date falsely makes the new roof complete in 1393. Use 1399 only as a labelled substantial-completion display anchor, not an exact completion claim.',
    ['x-westminster-roof-link'],{'phases[1].built':1399,'phases[1].continues':False,'phases[1].label':'Hammerbeam roof campaign; substantially complete by about 1399','phases[1].dateNote':'Commissioned 1393; lanterns completed 1397–98; decorative work still unfinished when work stopped in 1401. The built value 1399 is an approximate display anchor.'},confidence='medium')
add('L03','landmark:london/greyfriars:phase:1','Greyfriars finished church shown in foundation year','rejected','S1',
    'VCH records the foundation stone in 1306 and completion in 1327. The phase has continues=true and omits built, so the documented 21-year construction period disappears.',
    ['bho-friaries-grey-friars-vch'],{'phases[1].built':1327,'phases[1].continues':False})
add('L04','landmark:london/saxon-bridge:phase:0','Timber bridge survives the 1091 storm in the chronology','disputed','S2',
    'The single intact 990–1135 phase omits the bridge’s destruction in the 1091 storm recorded by London Museum. The rebuilding year is not supplied by that source. Do not invent an exact replacement date; qualify this phase as a succession of bridges and record the destruction separately.',
    ['x-bridge-storm-link'],{'phases[0].label':'Successive timber bridges; storm destruction in 1091','phases[0].dateNote':'A bridge existed by about 1000. London Museum records destruction by the storm of 1091; the exact rebuilding chronology is unresolved. This phase represents successive bridges, not one intact structure.'})
add('L05','landmark:london/mithraeum:phase:0','Mithraic use extended past repurposing','disputed','S2',
    'MOLA dates construction to AD 240–250 and Mithraic use for about 80 years before repurposing. The phase calls the building a Mithraeum until 380 despite the summary acknowledging an early-fourth-century conversion. The structure may survive; its cult identity must not be held constant.',
    ['mola-mithras-mithraism-top-10'],{'phases[0].label':'Temple: Mithraic until about 320–330, then repurposed','phases[0].dateNote':'Construction c.240–250; MOLA estimates about 80 years of Mithraic use before repurposing. The 380 phase end is a modelling estimate, not a dated end of Mithraic worship.'})
add('L06','landmark:london/st-bartholomew:phase:0','Priory status retained beyond surrender','disputed','S2',
    'VCH dates surrender to October 1539; the church’s history associates dissolution and loss of the nave with 1539. The app keeps a Priory church phase until 1543 without distinguishing institutional closure from gradual demolition. The sources read do not establish 1543 as the exact demolition year.',
    ['bho-austin-canons-priory-st','st-bartholomew-history'],{'phases[0].label':'Priory church; parish use after surrender in 1539','phases[0].dateNote':'Surrendered October 1539. The date of complete nave demolition needs a fabric-specific source; 1543 is a display boundary, not continued monastic occupation.'},confidence='high')
add('L07','landmark:london/blackfriars:phase:1','First Blackfriars theatre omitted','disputed','S2',
    'The converted-precinct dateNote begins theatre use in 1596. EMLoT distinguishes Blackfriars I (1576) from Blackfriars II (1596). The earlier venue matters to the displayed institutional history; neither date means the whole precinct became a theatre.',
    ['x-theatre-gap'],{'phases[1].dateNote':'Church demolished after dissolution in 1538. Blackfriars I theatre opened in 1576; Blackfriars II was established in 1596, with the King’s Men using it from 1608–09. These were distinct venues within the former precinct.'})
add('L08','landmark:london/westminster-abbey:begun:0','Westminster’s earlier monastery missing from its history','disputed','S2',
    '1045 dates the displayed Confessor campaign, not the beginning of monastic Westminster. The Abbey’s history records a Benedictine monastery founded around 960. Add that distinction in the summary without inventing an excavated building form.',
    ['x-westminster-early-link'],{'summary':'A Benedictine monastery existed here from about 960; its appearance is not reconstructed. Edward the Confessor enlarged it in the 1040s, and his church was consecrated in 1065. Henry III’s Gothic rebuilding began in 1245; the westward nave was completed in 1517. The eighteenth-century west towers are outside this timeline.'})
add('L09','landmark:london/lambeth-palace:completed:0','Lambeth’s 1230 completion has no supporting source','unverifiable','S3',
    'No sources are attached to the app entity. Historic England records occupation in 1197, a revised church plan in 1200 and a hall before 1234; it does not establish completion of the entire house-and-chapel phase in 1230. Keep the completion year explicitly illustrative until a fabric-specific chronology is supplied.',
    ['x-lambeth-link'],{'phases[0].dateNote':'Occupied by the archbishops from 1197; church plan revised in 1200; first Great Hall built before 1234 (Historic England 1000818). The built value 1230 is an illustrative anchor, not a documented completion.'})
add('L10','landmark:london/bermondsey-abbey:completed:0','Bermondsey completion and demolition unsupported','unverifiable','S3',
    'The entity is unsourced. Southwark’s collection record supports the 1082 foundation and later abbey status, but neither a 1140 completion nor immediate demolition in 1538. The collection record itself loosely says seven years to build; it cannot certify the app’s whole model sequence.',
    ['x-bermondsey-link'],{'phases[0].dateNote':'Foundation 1082 is supported by Southwark’s collection record. The displayed 1140 completion and immediate 1538 demolition require separate archaeological or documentary evidence.'})
add('L11','landmark:london/guildhall:completed:0','Guildhall’s precise completion is not established by its citation','disputed','S2',
    'The City of London’s own page dates building to 1411–1440; the Gresham lecture describes a wider 1411–1450 civic campaign. Neither inspected source establishes the app’s high-confidence 1430 completion of this model. Do not mechanically replace it with 1450, which includes the precinct.',
    ['city-of-london-many-lives-guildhall','gresham-envy-kings-guildhall-london'],{'confidence':'medium','phases[0].dateNote':'Begun 1411. City of London gives a 1411–1440 building campaign; the wider precinct campaign ran to about 1450. The built value 1430 is provisional and requires a hall-specific source.'})

# Confirmations are narrow, independently read statements, not whole-entity approvals.
verify('V01','landmark:london/old-london-bridge:completed:0','Stone London Bridge completed in 1209','London Museum independently gives completion of the first stone bridge in 1209. Checked the completion field, not generated arch dimensions.',['x-bridge-storm-link'],True)
verify('V02','landmark:london/westminster-abbey:completed:0','Confessor’s church consecrated in 1065','The Abbey gives 28 December 1065. This confirms the app’s use of 1065 for the consecrated church, not every part of the monastery.',['westminster-abbey-history-westminster-abbey'],True)
verify('V03','landmark:london/westminster-abbey:completed:1','Henry III’s east-end campaign reached consecration in 1269','The Abbey gives 13 October 1269 and explicitly says the old nave remained. The app correctly limits this phase to the east end, transepts and first nave bays.',['westminster-abbey-history-westminster-abbey'],True)
verify('V04','landmark:london/henry-vii-chapel:completed:0','Henry VII Chapel consecrated in 1516','The Abbey gives 19 February 1516. Keep consecration distinct from a claim that every decorative work ended then.',['x-henry-chapel-link'],True)
verify('V05','landmark:london/banqueting-house:ended:0','Previous Banqueting House burned in 1619','Historic Royal Palaces records the predecessor’s fire in 1619. The app already links it to Jones’s replacement; the research-session omission is not present.',['x-banqueting-link'],True)
verify('V06','landmark:london/banqueting-house:completed:1','Jones’s Banqueting House completed in 1622','Historic Royal Palaces explicitly gives completion in 1622 and distinguishes the predecessor.',['x-banqueting-link'],True)
verify('V07','landmark:london/white-tower:completed:0','White Tower complete by about 1100','HRP gives the building interval 1078–1100; the app summary preserves about 1100. This is a conventional endpoint, not precision to a day or proof about every turret.',['x-white-tower-link'],True)
verify('V08','landmark:london/bridge-waterworks:completed:0','Bridge waterworks operational in 1582','Stow’s 1603 Survey describes the Peter Moris forcier made in 1582 to supply the eastern City. This is contemporary documentary support for the operational year.',['bho-stow-ancient-present-rivers'],True)
verify('V09','landmark:london/royal-exchange:begun:0','Gresham’s Exchange begun in 1566','Stow dates the commencement and first brick to 1566, then distinguishes roofing in November 1567 and the later royal naming.',['bho-stow-cornehill-warde'],True)
verify('V10','landmark:london/temple-church:completed:0','Temple round church consecrated in 1185','The Temple Church’s history explicitly dates consecration of the Round to 1185, separately from the Chancel.',['temple-church-history'],True)
verify('V11','landmark:london/globe:ended:0','First Globe burned in 1613','Shakespeare Birthplace Trust gives 29 June 1613 and identifies the performance fire; the app summary already contains the day.',['x-globe-date-link'],True)
verify('V12','landmark:london/globe:begun:1','Second Globe present in 1614','Shakespeare Birthplace Trust says rebuilt by February 1614 with a tiled roof. This supports the annual phase, without certifying the conjectured diameter or side count.',['x-globe-date-link'],True)
verify('V13','landmark:london/charterhouse:begun:0','London Charterhouse founded in 1371','The Charterhouse’s history explicitly dates foundation to 1371, distinguishing the earlier plague burial ground and later mansion.',['charterhouse-history'],True)

fid='place:england-wales/lindisfarne:located_at'
add('N01',fid,'Cuthbert died on Inner Farne, not Lindisfarne','rejected','S1',
    'The app’s “died here” confuses death with burial. Bede IV.29 places his last retreat and death in his island solitude before burial at Lindisfarne; National Trust’s Farne history explicitly identifies Inner Farne. The app’s English Heritage page gives death followed by burial, without saying that the death occurred on Lindisfarne.',
    ['em-app-cuthbert-place','fk-farne-history','nat-eh-lindisfarne'],{'summary':entity(fid)['summary'].replace('Cuthbert died here in 687','Cuthbert died on Inner Farne in 687 and was buried here')})
fid='polity:england-wales/hywel-dda:existed'
add('N02',fid,'Welsh law manuscripts placed a century too late','rejected','S1',
    'Dictionary of Welsh Biography explicitly dates the earliest extant law manuscript to the last quarter of the twelfth century. “No manuscript is earlier than the 13th century” is false. Manuscript survival also does not provide contemporary proof that Hywel personally compiled the laws.',
    ['em-app-hywel-manuscripts'],{'note':entity(fid)['note'].replace('though no manuscript is earlier than the 13th century','though the earliest surviving manuscript dates from the last quarter of the 12th century and the attribution is not contemporary')})
fid='polity:england-wales/northumbria:existed'
add('N03',fid,'Northumbria is absent during Edwin and Oswald','rejected','S1',
    'A first existence in 654 is incompatible with Bede’s accounts of Edwin ruling both components and Oswald restoring Northumbrian rule before 642. English Heritage independently describes Oswald’s accession in 634. A single continuous polygon cannot represent every division. The proposed minimal correction labels its scope from Oswald; earlier unions still need separate records.',
    ['em-app-northumbria-start','nat-eh-lindisfarne'],{'from':634,'name':'Northumbrian kingship from Oswald (earlier unions not shown)','note':'Oswald reunited Northumbrian rule in 634, following earlier unions under Æthelfrith and Edwin. Bernicia and Deira were divided again after Oswald’s death in 642 and reunited later; this single display range does not assert uninterrupted unified government. The indicative polygon depicts about 700, not every year from 634. Earlier kingships require separate phases; 654 is not the first existence of Northumbria.'},confidence='medium')
fid='place:england-wales/grimspound:phase:1'
add('N04',fid,'Grimspound climate-driven abandonment is invented','rejected','S2',
    'English Heritage says the duration of use is unknown and discusses settlement change by about 1000 BCE with erosion and soil nutrient loss. It does not establish abandonment in 800 BCE caused by worsening climate. Reject the causal claim and qualify the nominal phase boundary.',
    ['pr-cmp-grimspound-abandon'],{'phases[1].label':'Surviving settlement remains; end of occupation uncertain','phases[1].note':'800 BCE is a display cutoff, not a dated abandonment. Duration of use is unknown; English Heritage describes changing settlement by about 1000 BCE and soil erosion, not a proven climate event.'})
fid='place:england-wales/battle-mynydd-carn:located_at'
add('N05',fid,'Coflein’s catalogue point is mistaken for a battlefield candidate','disputed','S2',
    'Coflein’s heading and grid reference are near Templeton, but its documentary assessment favours northern Pembrokeshire in Cemais, around the Carningli–Llanllawer–Dinas hills. The source does not establish its catalogue point as a historically supported candidate. The app admits the site is unknown, but still calls this point one suggestion without explaining the contradiction. No exact replacement coordinate is justified.',
    ['lm-app-mynydd-site'],{'name':'Mynydd Carn (unlocated; catalogue reference marker)','uncertainty':'The battlefield is unlocated. Coflein’s catalogue marker is near Templeton, while its documentary discussion favours northern Pembrokeshire in Cemais. The displayed point is not a verified battlefield or a source-supported candidate; it is a catalogue reference only.'})
fid='place:england-wales/jarrow:phase:0'
add('N06',fid,'Wearmouth’s foundation appears at Jarrow seven years early','disputed','S2',
    'The entity deliberately combines Wearmouth and Jarrow but its marker is at Jarrow. Cambridge’s handbook and English Heritage distinguish Wearmouth 674 from Jarrow c.681, with dedication in 685. Retain the two-house explanation but date the Jarrow marker from its own foundation.',
    ['em-app-jarrow-start','nat-eh-jarrow'],{'phases[0].from':681,'phases[0].label':'Jarrow monastery; twin of Wearmouth (founded 674)','phases[0].note':'Jarrow founded c.681; church dedicated 23 April 685. Wearmouth’s earlier foundation belongs to a different site about 10 km away.'},confidence='high')
for code,eid in [('N07','rhodri-mawr'),('N08','powys')]:
 fid='polity:england-wales/'+eid+':existed';txt=entity(fid)['note']
 txt=txt.replace('took Powys in 855','may have taken control of Powys in or after 855').replace('Rhodri Mawr took it over in 855.','Rhodri Mawr may have taken control in 855 or later.')
 add(code,fid,'Rhodri’s acquisition of Powys is too definite','disputed','S2',
     'Thornton’s ODNB extract says control of Powys was possible in 855 or at some later date. The app turns that qualified reconstruction into a fixed event. This correction does not settle the independent 877/878 death-date issue.',
     ['em-app-rhodri-powys'],{'note':txt},confidence='high')
fid='place:england-wales/winchester:located_at'
add('N09',fid,'Winchester’s exclusive largest-burh claim is unsupported','disputed','S2',
    'The Burghal Hidage edition gives Winchester and Wallingford the same 2,400-hide assessment. It measures assessed defensive support, not a population census. The app’s own Wallingford entry recognises the tie. Replace the exclusive superlative with the actual assessment.',
    ['em-app-winchester-largest'],{'summary':entity(fid)['summary'].replace('the largest burh in the Burghal Hidage','one of the joint-highest assessed burhs in the Burghal Hidage (2,400 hides, also assigned to Wallingford)')})
fid='place:england-wales/battle-lewes:located_at'
add('N10',fid,'Lewes repeats the source’s shorthand but omits its qualification','disputed','S2',
    'The Trust’s data box calls the locality secure, but its narrative explicitly says the exact ground between Offham Hill and the medieval town is uncertain. A high-confidence precise point plus the abridged uncertainty note suppresses that distinction.',
    ['lm-app-lewes-location'],{'confidence':'medium','uncertainty':'The battle date, 14 May 1264, is secure. The Battlefields Trust locates the general area north of Lewes but says the exact ground between Offham Hill and the medieval town remains uncertain. This point is a reference marker, not a surveyed battle centre.'})
fid='place:england-wales/st-davids:located_at'
add('N11',fid,'St Davids did not first become an episcopal centre in 1115','rejected','S1',
    'Asser’s ninth-century Life describes bishops of St Davids, including Nobis. The app’s wording makes Norman appointments in 1115 the beginning of cathedral status. Separate the early episcopal institution from later Norman bishops and the surviving fabric.',
    ['em-app-st-davids-bishop'],{'summary':entity(fid)['summary'].replace('became the leading church of Wales and, under Norman bishops from 1115, a cathedral.','became a leading Welsh episcopal centre long before the first Norman bishop in 1115. Its earlier buildings are poorly known.')})
fid='place:england-wales/fountains:phase:0'
add('N12',fid,'Cistercian affiliation assigned to the foundation day','disputed','S2',
    'National Trust’s detailed foundation account says thirteen Benedictines founded the community in 1132 and it joined the Cistercian order three years later. Its introductory shorthand calls it Cistercian from foundation; the detailed sequence should govern the phase label.',
    ['lm-app-fountains-order'],{'phases[0].label':'Monastic community founded 1132; Cistercian from 1135','phases[0].note':'Foundation and affiliation are distinct: National Trust dates acceptance into the Cistercian order three years after 1132.'})
fid='place:england-wales/burgh-castle:phase:0'
add('N13',fid,'Gariannonum identification presented as certain','disputed','S2',
    'English Heritage says one or both of Burgh Castle and Caister were known as Gariannonum. The app phase names Burgh Castle without qualification.',
    ['pr-cmp-burgh-name'],{'phases[0].label':'Saxon Shore fort; possibly Gariannonum','phases[0].note':'The ancient name may refer to Burgh Castle, Caister, or both; the identification is not settled.'})
fid='place:england-wales/silbury-hill:phase:0'
add('N14',fid,'Silbury’s dating bracket becomes 120 years of continuous work','disputed','S2',
    'English Heritage says the mound was probably built over a short period somewhere between c.2470 and 2350 BCE. The app represents that uncertainty interval as an uninterrupted construction phase. The source supports neither an exact start at 2470 nor 120 years of work.',
    ['pr-cmp-silbury-duration'],{'phases[0].label':'Mound building occurred within this approximate dating interval','phases[0].note':'2470–2350 BCE is a possible chronological bracket. Work probably occupied a short part of that interval, not all 120 years. The model must not be read as a continuous construction schedule.'})
fid='place:england-wales/birdoswald:phase:1'
add('N15',fid,'Birdoswald’s post-Roman halls have invented exact boundaries','disputed','S2',
    'English Heritage describes uninterrupted occupation from late Roman times and successive hall buildings; it does not date their first appearance to 411 or abandonment to 520. The phased interpretation is reasonable, the exact switch is not established.',
    ['pr-cmp-birdoswald-halls'],{'phases[1].note':'The hall sequence bridges late Roman and fifth-century occupation. 411 and 519/520 are display boundaries, not dated construction and abandonment events.','phases[2].label':'Later occupation uncertain; eventual abandonment','phases[2].note':'520 is a provisional display cutoff; the source does not fix an abandonment year.'},confidence='high')
for code,eid,seq,label,sid,explanation in [
 ('N16','chesters',1,'Post-Roman occupation and abandonment uncertain','pr-cmp-chesters-411','The institutional history discusses uncertainty into the late fourth or early fifth century; it does not establish a departure in 411.'),
 ('N17','housesteads',1,'Post-Roman history uncertain','nat-eh-housesteads','English Heritage gives garrisoning to the end of the fourth century, not a securely dated abandonment on a 410/411 boundary.'),
 ('N18','corbridge',2,'Post-Roman urban decline; exact end uncertain','nat-eh-corbridge','The history says the town continued until the last days of Roman Britain; it does not establish immediate desertion in 411.'),
 ('N19','brecon-gaer',1,'Later Roman use and eventual abandonment uncertain','pr-cmp-brecon-end','Cadw supports foundation around 75 and the cavalry unit, but supplies no 300 abandonment. The app itself calls the end date a guess.'),
 ('N20','segontium',1,'Late Roman decline; final abandonment uncertain','pr-cmp-segontium-end','Cadw’s c.394 endpoint derives from coins. A last-coin horizon does not prove an exact evacuation in 394, and the app currently makes occupied and abandoned phases overlap in that year.'),
 ('N21','whitby',1,'Ninth-century abandonment; exact date unknown','em-app-whitby-end','English Heritage explicitly says the monastery was abandoned at an unknown point in the ninth century; 867/868 is not a securely dated destruction.')]:
 fid='place:england-wales/'+eid+':phase:'+str(seq)
 fields={f'phases[{seq}].label':label,f'phases[{seq}].note':explanation+' The numerical boundary is a display convention.'}
 if entity(fid)['confidence']=='high':fields['confidence']='medium'
 add(code,fid,eid+': an exact abandonment exceeds the evidence','disputed','S2',explanation,[sid],fields)

fid='place:england-wales/pevensey:phase:2'
add('N22',fid,'Pevensey falsely deserted throughout the Saxon centuries','rejected','S1',
    'English Heritage says reoccupation followed roughly a century after the late-fifth-century siege and identifies possible high-status Saxon occupation. The app labels every year 472–1065 deserted. Also, its source gives 471 while the consulted Ingram/Giles Chronicle has 490: neither licenses an unqualified precise siege boundary.',
    ['nat-eh-pevensey','em-app-bridge-1014'],{'phases[2].label':'After siege tradition; later Anglo-Saxon reoccupation','phases[2].size':1,'phases[2].note':'The late-fifth-century siege is a retrospective annal with conflicting transmitted/secondary dates. English Heritage describes reoccupation about a century later and possible high-status activity before 1066; the interval is not uniformly deserted.','confidence':'medium'})
fid='place:england-wales/maiden-castle:located_at'
add('N23',fid,'Maiden Castle is not Britain’s largest hillfort','rejected','S1',
    'English Heritage calls Maiden Castle one of the largest, not the largest. The Oxford hillfort atlas records Ham Hill at 84 hectares, while Cambridge’s excavation account explicitly says Ham Hill dwarfs Maiden Castle. The absolute superlative is wrong.',
    ['nat-eh-maiden-castle','fk-ham-hill','fk-ham-hill-cambridge'],{'summary':entity(fid)['summary'].replace('The largest hillfort in Britain.','One of the largest hillforts in Britain.')})
fid='polity:england-wales/iceni:existed'
add('N24',fid,'Iceni vanish before Prasutagus and Boudica','rejected','S1',
    'The type is people but the interval ends in 43. Tacitus Annals 14.31 explicitly describes Prasutagus’s kingdom and the Icenian revolt in 60/61. At minimum the pre-conquest/client political phase must extend through the revolt; its end must not imply the people disappeared.',
    ['ev-tacitus-annals-book-xiv-chapters-29-39-loeb-tran'],{'to':61,'kind':'kingdom','name':'Iceni: independent and client kingdom','note':'The Iceni retained a client kingdom under Prasutagus after AD 43; Boudica’s revolt followed in AD 60/61. The endpoint 61 marks the end of this political phase, not extinction of the people. Their subsequent Roman civitas requires a separate record. The pre-43 start remains approximate.'},confidence='medium')
fid='polity:england-wales/brigantes:existed'
add('N25',fid,'Brigantes disappear while their client rulers are still active','rejected','S1',
    'Tacitus Histories 3.45 describes Cartimandua’s fall and Venutius taking the throne in the events of 69. English Heritage records Stanwick’s decline only after 70. Ending the people/polity in 43 contradicts both the narrative and the app’s own summary.',
    ['fk-tacitus-histories','nat-eh-stanwick'],{'to':70,'kind':'kingdom','name':'Brigantes: pre-conquest and client kingship','note':'Cartimandua and Venutius ruled after AD 43; Tacitus describes the crisis of 69. The displayed end around 70 marks a transition towards Roman conquest, not the disappearance of the Brigantes. Roman-period community and conquest phases require separate records; the exact transition is not a single securely dated event.'},confidence='medium')
fid='polity:england-wales/carvetii:existed'
add('N26',fid,'Carvetii appear only before their evidence begins','disputed','S2',
    'The app shows the Carvetii in 50 BCE–AD 43 but admits their name is attested only by third-century inscriptions. RIB 3526 identifies a civitas in 222/223 and calls this its earliest dated evidence. The plotted interval is a conjectural prehistory, while the securely evidenced Roman community is omitted.',
    ['fk-carvetii-rib3526'],{'evidence':'conjectural','confidence':'low','name':'Possible pre-Roman antecedents of the Carvetii','note':'This pre-Roman placement is conjectural. The civitas Carvetiorum is securely named on RIB 3526 dated 222/223, with later third-century evidence; a separate Roman-period record is needed. Neither 50 BCE nor AD 43 is an attested boundary for this people.'})
fid='line:england-wales/military-way:existed'
add('N27',fid,'Military Way’s deliberately shifted geometry is labelled excavated','disputed','S2',
    'The app says its path is the wall-fort coordinates shifted about 300 m south merely for visibility. English Heritage supports the addition of a road, not this derived survey line. The geometry’s evidence class should describe reconstruction; the approximate AD 160 anchor is already qualified.',
    ['nat-eh-hadrians-wall'],{'evidence':'reconstructed'})
fid='place:england-wales/torksey:located_at'
add('N28',fid,'Torksey village marker conflates camp and later town','disputed','S2',
    'Lincolnshire HER locates the camp on high ground north of Torksey, mostly in Brampton parish, centred SK 836 802. One coordinate serves both the camp and later town. Do not move the whole multi-period entity to a camp centroid; identify this marker’s scope and request a separate camp location.',
    ['em-app-torksey-camp','em-app-army-865'],{'uncertainty':'This point is a reference for Torksey, not the Viking camp centroid. The 872–873 camp occupied high ground north of the village, mostly in Brampton parish (HER MLI125067, centred SK 836 802, estimated extent 725 × 1509 m). Its footprint needs a separate entity; later town phases should retain their own location.'})
fid='place:england-wales/richborough:phase:2'
add('N29',fid,'Richborough’s small fort and stone shore fort conflated','disputed','S2',
    'English Heritage distinguishes a small fort around 250 from the surviving stone fort of 275–290. The phase begins in 251 with an undifferentiated Saxon Shore fort label; qualify the transition without pretending that the stone circuit existed from 251.',
    ['pr-cmp-richborough-fort'],{'phases[2].label':'Small fort c.250; stone shore fort built c.275–290','phases[2].note':'The small fort and its stone replacement are separate stages. The surviving stone walls date to the 275–290 construction bracket, not 251.'})

# Conventional dates which become misleading when high-confidence labels assert cessation.
for code,eid,seq,label,sid,note in [
 ('N30','bryn-celli-ddu',1,'Surviving tomb; end of use uncertain','pr-cmp-bryn-closure','Cadw provides no 2000 BCE closure. The app already admits that the end of use is not dated.'),
 ('N32','pentre-ifan',1,'Surviving tomb; later use uncertain','pr-cmp-pentre-end','Cadw supports a Neolithic tomb but no exact cessation year; the displayed boundary is not an excavation result.'),
 ('N33','thornborough-henges',1,'Earthworks; Bronze Age burial landscape','pr-cmp-thornborough-end','English Heritage describes continued importance for early Bronze Age burials. Calling the entire complex out of use from 2000 BCE suppresses that continuing activity.')]:
 fid='place:england-wales/'+eid+':phase:'+str(seq)
 add(code,fid,eid+': end-of-use language outruns evidence','disputed','S2',note,[sid],{f'phases[{seq}].label':label,f'phases[{seq}].note':note+' The numerical year is only a display anchor.'})

fid='place:england-wales/lindisfarne:phase:4'
add('N34',fid,'Lindisfarne becomes a ruin immediately after suppression','rejected','S1',
    'The cited English Heritage history explicitly says the priory buildings were not dismantled at the Reformation because of Crown defence needs. The 1538 phase calls them a ruin and introduces a Tudor fort before the source’s 1542–45 harbour defences. Institutional closure is not physical destruction.',
    ['nat-eh-lindisfarne'],{'phases[4].label':'Former priory retained; harbour defences added in 1542–45','phases[4].note':'Priory suppressed in 1537, but buildings were retained for Crown defence. English Heritage dates the nearby earth-and-timber harbour works to 1542–45; do not imply instant ruination or a fort already present in 1538.'})
fid='place:england-wales/wroxeter:located_at'
add('N35',fid,'Wroxeter’s preservation claim erases the surviving settlement','disputed','S2',
    'English Heritage limits abandonment to the city centre and describes a community continuing by the ford, later around St Andrew’s. “It was never built over” overstates the survival of the whole city area. The distinction matters because the model also changes the city to size zero in 451.',
    ['nat-eh-wroxeter'],{'summary':entity(fid)['summary'].replace('It was never built over.','Much of the Roman urban area escaped later development, while a smaller community continued by the ford at the site of the later village.'),'phases[3].label':'Roman city centre abandoned; smaller settlement persists by the ford','phases[3].note':'The circa-450 boundary concerns the former urban centre, not complete depopulation of Wroxeter.'})

fid='place:england-wales/stonehenge:phase:3'
add('H01',fid,'AD 43 is not a dated ruin event at Stonehenge','disputed','S2',
    'English Heritage describes Roman-period activity but supplies no destruction or abrupt ruin event at the conquest. The national layer switches to ruin in AD 43 while the detailed site uses AD 1 as an explicitly arbitrary loss-of-stones convention. These two dates must not be read as alternative historical events.',
    ['pr-cmp-stonehenge-roman'],{'phases[3].label':'Standing remains; Roman and later activity','phases[3].note':'AD 43 is an era boundary only. The dates when individual stones fell or were removed are generally unknown; it is not a dated destruction of Stonehenge.'})
fid='place:england-wales/durrington-walls:phase:0'
add('H02',fid,'Durrington’s uncertain short occupation becomes a century-long settlement','disputed','S2',
    'English Heritage places relatively short occupation within 2580–2470 BCE, followed by the henge. The app’s 2550–2451 settlement phase can imply approximately a century of occupation, while the detailed site describes about a decade. Preserve the bracket/short-duration distinction and leave the exact year unresolved.',
    ['pr-cmp-durrington-date'],{'phases[0].label':'Short-lived late Neolithic settlement (date uncertain)','phases[0].note':'Relatively short occupation within the radiocarbon bracket 2580–2470 BCE. The displayed 2550–2451 interval is an uncertainty/display window, not a measured century of continuous occupation.'})
for code,eid,fkind in [('H03','aubrey-holes','phase:1'),('H04','stonehenge-ditch-bank','phase:6')]:
 fid='landmark:stonehenge/'+eid+':'+fkind
 add(code,fid,'Stonehenge modelling conventions inherit high archaeological confidence','disputed','S2',
     'The entity’s own uncertainty text admits that the phase date and visible state are modelling conventions. The checked chronological research does not date filled dimples to 2500 BCE or bank erosion to AD 1. Archaeological confidence in the feature’s existence must not certify its invented visible-state chronology. With only entity-level confidence available, medium is the safer aggregate label.',
     ['sto-marshall-2012-eh-chronology','sto-darvill-2012-remodelled'],{'confidence':'medium'})

# Every national battle gets a dated-phase disposition, separate from its location.
battle_evidence=json.load(open(BASE/'factkeeper-battle-evidence.json'))
strong_battles={'battle-hastings','battle-nevilles-cross','battle-shrewsbury','battle-st-albans-1455','battle-towton','battle-tewkesbury','battle-flodden'}
for b in battle_evidence:
 eid=b['entity_id'];local=eid.split('/')[1];fid='place:'+eid+':phase:0'
 verify('B-'+local,fid,local.replace('battle-','').replace('-',' ')+' — battle year',
        'The independently opened battlefield account identifies this battle in '+str(FACTS[fid]['year_from'])+'. This confirms only the dated battle phase. The separate location, size, army numbers and every detail in the owning summary are not certified by this verdict.',[b['source_id']],local in strong_battles)
verify('B-bryn-derwin','place:england-wales/battle-bryn-derwin:phase:0','Bryn Derwin — 1255','Dictionary of Welsh Biography explicitly describes Llywelyn’s victory over Owain and Dafydd at Bryn Derwin in 1255. This does not locate the battlefield.',['wal-dwb-llywelyn-ap-gruffydd'])
verify('B-brentford','place:england-wales/battle-brentford-1016:phase:0','Brentford — 1016','The Chronicle’s 1016 annal names the Brentford engagement, English victory and drowning. It does not fix a day, month, battlefield centre or Danish strength.',['bre-asc-avalon'])
for code,eid,note in [
 ('B-dyrham','battle-dyrham','The consulted Chronicle contains the 577 tradition, but is a much later witness. The app already labels the evidence low and explains the three-century gap. Its sole app citation is Wikipedia; the historical precision is not independently established.')]:
 add(code,'place:england-wales/'+eid+':phase:0',eid+': source limitation','unverifiable','S3',note,['em-app-bridge-1014'])
verify('B-ellendun','place:england-wales/battle-ellendun:phase:0','Ellendun — conventional date 825','Additional check resolves the year-level review: the Battlefields Trust research inventory lists Ellandun/Ellendun in 825. The consulted Ingram/Giles Chronicle places its corresponding narrative under 823; retain that edition caveat, but do not replace the conventional modern 825. This confirms the displayed year, not the Wroughton coordinate.',['fk-bt-inventory','em-app-bridge-1014'])
verify('B-edington','place:england-wales/battle-edington:phase:0','Edington — 878','Additional check resolves the year-level review: English Heritage explicitly gives Edington (878), and the Trust inventory equates Ethandun/Edington and dates it 878. The Ingram/Giles Chronicle uses Heddington in its 878 annal. This confirms the year and event identity, not a unique modern battlefield position.',['fk-eh-early-medieval','fk-bt-inventory','em-app-bridge-1014'])

# Source/interpretation checks for the staged episodes.
verify('E01','episode:brentford/brentford-1016:attested:1','Brentford followed London’s relief within two nights','Re-read the 1016 annal: it gives the north-bank approach, relief of London, retreat to ships and within-two-nights sequence. No invented day or month is needed.',['bre-asc-avalon'])
verify('E02','episode:brentford/brentford-1016:attested:2','Danes resumed the siege after Brentford','The Chronicle explicitly follows Edmund’s return to Wessex with a renewed attack on London by land and water.',['bre-asc-avalon'])
verify('E03','episode:brentford/brentford-1016:attested:3','Chronicle records a later Brentford ford crossing','The fourth-levy passage explicitly records a further crossing before the Kent campaign. This confirms the reported crossing, not the scene’s ford geometry or a particular tidal state.',['bre-asc-avalon'])
verify('E04','episode:london/london-bridge-1014:unknown:0','Date, allegiance and bridge attack remain unresolved','Compared the Chronicle’s 1014 account with the skaldic editor’s discussion: the Chronicle has Æthelred’s return but no bridge demolition, while the verse does not independently resolve date or allegiance. The app’s uncertainty survives.',['ev-the-anglo-saxon-chronicle-eleventh-century-entri','ev-tooley-street-delight-19-march-2022-sigvatr-s-st'])
verify('E05','episode:london/london-bridge-1014:tradition:2','Bryggjur is not unambiguous proof of bridge demolition','The poem’s editor explicitly prefers London wharves in this stanza. The app correctly records that ambiguity rather than forcing a literal bridge reading.',['ev-tooley-street-delight-19-march-2022-sigvatr-s-st'])
verify('E06','episode:barnet/barnet-1471:unknown:0','Barnet’s precise battlefield remains unlocated','The 2015–2018 project report explicitly concludes that the battlefield cannot be accurately identified; its competing deployments prevent a unique battle-line map.',['bar-barnet-battlefield-project-2015-2018'])
verify('E07','episode:barnet/barnet-1471:attested:1','Barnet mist is documented, density is not','The project report reproduces Arrivall’s mist account; the separately read Warkworth account also describes limited visibility. The app places density and duration among unknowns.',['bar-barnet-battlefield-project-2015-2018','bar-warkworth-barnet'])
verify('E08','episode:barnet/barnet-1471:tradition:2','Oxford badge confusion is a reported Warkworth story','Warkworth contains the badge-confusion and treason story. Retaining it as a tradition, rather than an established cause of defeat, is the appropriate classification. This does not independently prove uniqueness among all texts.',['bar-warkworth-barnet'])
verify('E09','episode:london/boudica-60:attested:2','Tacitus describes abandonment, not a pitched London battle','Annals 14.33 describes Suetonius choosing not to defend London and withdrawing those able to follow; the app stages destruction rather than an invented city battle. This confirms the source’s narrative, not the absolute absence of every possible undocumented clash.',['ev-tacitus-annals-book-xiv-chapters-29-39-loeb-tran'])
verify('E10','episode:london/boudica-60:unknown:0','Boudican sack has no established season or time of day','The inspected Tacitus passage does not establish month, weather or duration; the app explicitly marks those staging details unknown. This is a judgement of the surviving source evidence, not a weather reconstruction.',['ev-tacitus-annals-book-xiv-chapters-29-39-loeb-tran'])

# New statements preserve omissions without manufacturing generated fact ids.
def newfact(code,entity_type,entity_id,location_id,kind,statement,yf,yt,sources,note,confidence='high'):
    NEWFACTS.append({'code':code,'entity_type':entity_type,'entity_id':entity_id,'location_id':location_id,'kind':kind,'statement':statement,'year_from':yf,'year_to':yt,'status':'verified','confidence':confidence,'sources':[SOURCES[s] for s in sources],'note':note})

newfact('A01','landmark','london/saxon-bridge','london','destroyed','The timber London Bridge was destroyed by a storm in 1091.',1091,1091,['x-bridge-storm-link'],'S2 omission associated with L04. Exact rebuilding date not supplied by this source.')
newfact('A02','landmark','london/westminster-abbey','london','foundation','A Benedictine monastery existed at Westminster around 960, before Edward the Confessor’s enlargement.',960,960,['x-westminster-early-link'],'S2 omission associated with L08. Circa date; no proposed model of the unknown early fabric.',confidence='medium')
for y in [1563,1603,1625]:
 newfact('A-plague-'+str(y),'location','london','london','epidemic','London suffered a major plague epidemic in '+str(y)+'.',y,y,['x-plague-missing'],'S2 timeline omission. Boulton’s mortality discussion identifies this epidemic; no exact mortality percentage is copied into the new claim.')
newfact('A03','landmark','london/blackfriars','london','theatre_opened','The first Blackfriars theatre dates to 1576, distinct from the second venue established in 1596.',1576,1576,['x-theatre-gap'],'S2 omission associated with L07; source is EMLoT’s theatre list, not a reconstruction of venue plans.')
newfact('A04','polity','england-wales/carvetii','england-wales','epigraphic_attestation','The civitas of the Carvetii is named on RIB 3526, dated by imperial titulature to 10 December 222–9 December 223.',222,223,['fk-carvetii-rib3526'],'S2 omission associated with N26. These are attestation dates, not the founding and abolition dates of the civitas.')
newfact('A05','landmark','stonehenge/altar-stone','stonehenge','scholarly_dispute','The exact geological provenance of Stonehenge’s Altar Stone remains unresolved in the November 2026 multi-proxy study.',None,None,['fk-altar-2026'],'The 2024 Scottish-provenance paper is a hypothesis with substantial evidence, but the 2026 study finds no examined outcrop matches all characteristics. The app’s caution is not an error. Do not infer that all of Scotland has been excluded.')

# All 77 non-agreement imports are leads, not automatically accepted findings.
lead('em-app-1066-travel','enrichment','EH supports Fulford before Stamford Bridge and Hastings. The app already has a separate Fulford place. No continuous foot-march animation or contrary route is asserted by the cited event.')
lead('em-app-army-865','no defect established','The current event says East Anglia, not Thetford, for 865. The Cambridge paper supports a more detailed campaign but does not refute that event.')
lead('em-app-assandun-point','already qualified','The project still lists Ashdon/Hadstock and Ashingdon/Canewdon alternatives. The app already calls the point a hypothesis, labels confidence low and states the question is open.')
lead('em-app-brentford-time','already qualified','The Chronicle supports a relative sequence only. Both episode dateNotes explicitly say the day and month are unknown; fraction 0.5 is staging, not a claimed date.')
lead('em-app-bridge-1014','already qualified','The Chronicle does not give bridge demolition in 1014. The app already describes the saga framing, disputed date and allegiance and does not show collapse; E04–E05 confirm these safeguards.')
lead('em-app-brunanburh-point','already qualified','The Chronicle poem supports the battle, not Bromborough coordinates. The app already describes more than forty candidate sites and marks the location unknown/low.')
lead('em-app-cuthbert-place','substantiated','Bede IV.29 and the Farne history distinguish death on Farne from burial at Lindisfarne.',['N01'])
lead('em-app-gruffudd','already qualified','The revised DWB article argues 1064; the current app note already preserves that alternative alongside conventional 1063. This does not justify replacing 1063 outright.')
lead('em-app-hywel-manuscripts','substantiated','DWB explicitly dates the oldest manuscript to the last quarter of the twelfth century.',['N02'])
lead('em-app-jarrow-start','substantiated with narrower scope','The Cambridge handbook dates the two sites separately. The problem is the Jarrow marker’s 674 onset, not denial that Wearmouth was founded in 674.',['N06'])
lead('em-app-northumbria-start','substantiated','Bede and EH attest earlier Northumbrian unions. A continuous 654 start loses Edwin and Oswald.',['N03'])
lead('em-app-rhodri-powys','substantiated','Thornton’s accessible ODNB extract uses possible control in 855 or later. The overstatement recurs in two polity notes.',['N07','N08'])
lead('em-app-torksey-camp','substantiated with narrower remedy','HER gives the northern camp and estimated centre. Moving the shared town/camp point would misplace later phases; identify it as a town reference and add a separate camp feature.',['N28'])
lead('em-app-whitby-end','substantiated','EH explicitly denies knowledge of the precise ninth-century abandonment.',['N21'])
lead('em-app-winchester-largest','substantiated','The edition gives Winchester and Wallingford equal 2,400-hide assessments, not exclusive population rank.',['N09'])
lead('lm-app-durham-1540','retain existing 1539 endpoint','The Durham archival catalogue explicitly gives surrender on 31 December 1539. VCH’s 1540 does not prove the app wrong; retain source-specific chronology rather than substituting 1540.')
lead('lm-app-lewes-location','substantiated','The Trust’s prose qualifies its own secure-location data box.',['N10'])
lead('lm-app-mynydd-site','substantiated','Coflein’s northern narrative conflicts with its Templeton catalogue point. No replacement exact coordinate is established.',['N05'])
lead('pr-cmp-birdoswald-halls','substantiated','EH supports continuity and successive halls, not exact 411 and 520 switches.',['N15'])
lead('pr-cmp-brecon-end','substantiated','The app calls 300 a guess, but the phase still says abandoned. Cadw supplies no evacuation year.',['N19'])
lead('pr-cmp-bryn-closure','substantiated','Cadw does not establish the 2000 BCE cessation represented by Disused mound.',['N30'])
lead('pr-cmp-burgh-name','substantiated','EH leaves Gariannonum shared between or uncertain between Burgh Castle and Caister.',['N13'])
lead('pr-cmp-chesters-411','substantiated','EH’s late-fourth/early-fifth-century caveat does not support exact 411 abandonment.',['N16'])
lead('pr-cmp-durrington-date','substantiated','EH’s short occupation inside a dating bracket differs from the century-long displayed settlement interval.',['H02'])
lead('pr-cmp-grimspound-abandon','substantiated','EH states duration unknown and soil/settlement change, not a climate-caused 800 BCE abandonment.',['N04'])
lead('pr-cmp-london-shrink','no contradiction established','London Museum describes house decline after c.150. The app’s earlier phase still calls London the chief town; its relative rank need not fall at the first decline. 351 is a schematic phase boundary, not an explicit claim that decline first began then.')
lead('pr-cmp-provinces-date','already qualified; bibliography weak','EH supports division after the late-second-century revolt without fixing 197. The app already states 197–213 alternatives. Retain the caveat; Wikipedia-only source provenance is recorded separately.')
lead('pr-cmp-richborough-fort','substantiated','EH distinguishes the c.250 small fort from the surviving stone fort of 275–290.',['N29'])
lead('pr-cmp-segontium-end','substantiated as uncertainty','Cadw derives c.394 from coins. That is not an exact evacuation observation.',['N20'])
lead('pr-cmp-stonehenge-roman','substantiated','EH gives no conquest-year destruction. The national and detailed-site ruin boundaries are different modelling conventions.',['H01'])
lead('pr-cmp-uffington-date','already qualified','The exact EH bracket 1740–210 BCE is already in the current uncertainty text, which explicitly calls the chosen 1000 BCE start unmeasured. No replacement year is justified.')
lead('x-lambeth-link','partly substantiated','HE supplies 1197 occupation, revised 1200 plan and hall before 1234. These are distinct events, not proof of 1230 completion of the model.',['L09'])
lead('x-plague-missing','substantiated omission','Boulton identifies 1563, 1603 and 1625 epidemics, none of which is represented as plague in the London event array. New sourced statements A-plague-1563/1603/1625 are recorded.')
lead('x-westminster-roof-link','substantiated','Parliament distinguishes the commission, lanterns and finishing work.',['L02'])
lead('x-woodland-link','alternative synthesis, not a replacement curve','Government synthesis is for England, includes woodland/wood pasture and gives broad estimates. The app curve is explicitly illustrative across England and Wales. Different definitions and geographic scope prevent treating 15%/10% as universal measured replacements.')
lead('em-app-dyrham-class','classification proposal not adopted','A later document can be attested-documentary without being contemporary testimony. The app already marks low confidence and explains the three-century delay. The Chronicle is a better citation, but the event itself is not newly verified.')
lead('em-app-ellendun-transfer','enrichment; edition chronology unresolved','The Chronicle distinguishes the victory from Æthelwulf’s subsequent operation, but the app’s summary need not mean instantaneous transfer. The consulted old translation’s annal is 823, not conventional 825; do not change the date on that edition alone.')
lead('em-app-english-unification','enrichment','The Chronicle supports contested northern control through 954. The app’s separate Jorvik note already says York was lost again after 927; no claim that every English king continuously held it was found.')
lead('em-app-st-davids-bishop','substantiated','Asser’s references to earlier bishops refute first episcopal status in 1115.',['N11'])
lead('lm-app-anarchy','no defect established','The royal history distinguishes the 1135 succession from Matilda’s 1139 invasion. Calling the wider 1135–1154 reign/crisis the Anarchy is not itself a false claim that her invasion occurred in 1135.')
lead('lm-app-battle-abbey-approx','already qualified','EH says about 1071; the app summary also says about 1071. Annual display precision remains a general limitation, not a demonstrated erroneous year.')
lead('lm-app-beaumaris-incomplete','already qualified','Cadw confirms unfinished gatehouse/towers. The current app already says work petered out and uses an unfinished-castle phase label. No finished detailed Beaumaris model exists in the reviewed dataset.')
lead('lm-app-bosworth-archaeology','already qualified','The Trust supports the Fenn Lanes locality. The current app already records the relocated archaeological site and says its point is not a surveyed centre; coordinate check finds it about 5 m from the source reference point.')
lead('lm-app-bryn-site','already qualified; enrichment','Coflein lists alternative hills and negative survey. The app already describes uncertainty and neighbouring hills. Listing Graig Hill and Blacke Hyll explicitly is useful enrichment, not proof the present caveat is false.')
lead('lm-app-fountains-order','substantiated','The detailed NT narrative distinguishes Benedictine founders in 1132 from acceptance into the Cistercian order three years later.',['N12'])
lead('lm-app-harlech-sea','enrichment','Cadw confirms the 108-step sea access. Adding supply-route geometry could improve a future site model, but the present national point does not claim modern shoreline geometry represents medieval Harlech.')
lead('lm-app-margam-approx','already qualified','Coflein says around 1147, and the app summary already says about 1147. Do not replace a qualified scalar anchor with another arbitrary year.')
lead('lm-app-rhuddlan-engineering','enrichment','Cadw confirms diversion/deepening of the Clwyd. A separate engineering event would add detail; the castle’s existing 1277 statement remains true without it.')
lead('lm-app-strata-closure','retain qualified closure; review fabric separately','Coflein says closed by 1539 and the app summary repeats by 1539. This does not prove a distinct exact closure day or immediate physical ruin. No change to the annual end value is established.')
lead('lm-app-towton-numbers','already qualified','The Trust rejects inflated figures. The app already calls its army and casualty numbers chroniclers’ estimates; no exact army-size claim is verified. A source-linked numerical-claims table would be enrichment.')
lead('lm-app-welsh-acts','already qualified; optional administrative refinement','OpenLearn distinguishes 1536 and 1543. The current app already writes 1535–6 and 1542–3, preserving statutory/common dating conventions. The later court-system detail does not invalidate its 1536 display start.')
lead('lm-app-whitby-approx','already qualified','The current summary says about 657 and about 1078. The separate ninth-century abandonment problem remains N21.',['N21'])
lead('pr-cmp-arbor-low-certainty','enrichment','EH confirms cumulative construction and later monuments. The app’s broad phase does not expressly say every feature existed unchanged for the entire millennium; its uncertainty already says not closely dated.')
lead('pr-cmp-barclodiad-fabric','no model error established','Cadw identifies the present mound as reconstruction, but standing carved stones are real evidence. The app has a national point, not a detailed mound model. Downgrading all evidence to reconstructed solely on the present envelope would conflate fabric components.')
lead('pr-cmp-castlerigg-end','no cessation claim found','The current transition is from Stone circle to Standing monument, with low confidence and explicit dating uncertainty. Unlike Disused tomb, that label does not assert ceremonial cessation. No rejection is recorded.')
lead('pr-cmp-pentre-end','substantiated','The phase explicitly says Disused tomb from 3000 BCE, without an end-of-use source.',['N32'])
lead('pr-cmp-seahenge-end','already qualified','Norfolk confirms timber felling in 2049 BCE. The current app explicitly says use duration is unknown and the endpoint nominal. No replacement ceremonial end is justified.')
lead('pr-cmp-silbury-duration','substantiated','The phrase Mound under construction across the entire dating bracket is stronger than a brief campaign somewhere within it.',['N14'])
lead('pr-cmp-silchester-start','already qualified; reject duration inference','EH gives an establishment bracket of c.20–10 BCE and the app summary preserves it. The national phase says oppidum, not ten years under construction. The imported construction-duration objection does not fit this data shape.')
lead('pr-cmp-thornborough-end','substantiated','EH explicitly describes early Bronze Age burial use, which Out of use from 2000 BCE obscures.',['N33'])
lead('x-banqueting-link','disagree: already implemented','Both the 1619 burned ending and the replacement construction through 1622 are already in the app. HRP confirms them. Calling the link missing is incorrect.')
lead('x-bermondsey-link','partly substantiated','Southwark corroborates 1082 and later abbey status but cannot verify the model’s completion or demolition.',['L10'])
lead('x-bridge-storm-link','substantiated omission','London Museum identifies destruction in 1091; the existing bridge phase and event list omit it.',['L04'])
lead('x-famine-link','enrichment','Cambridge distinguishes crop failures in 1315–17 from the wider 1315–22 crisis and cattle plague. This is useful context; a short crop-failure event is not false merely because it does not encode every later consequence.')
lead('x-globe-date-link','disagree: day already present','Shakespeare Birthplace Trust confirms 29 June 1613. That day is already in the app summary and London event note. A day-level renderer is a separate feature, not a factual correction.')
lead('x-henry-chapel-link','enrichment','Abbey source confirms 19 February 1516 consecration. The app’s annual completion anchor is compatible; distinguish ceremony from finishing work rather than replacing the year.')
lead('x-plague-end-link','small wording refinement only','London Museum places the peak through spring 1349 and separately uses a by-1352 mortality estimate. The current app does not use 1352 as an epidemic end, so that particular conflation is absent.')
lead('x-theatre-gap','substantiated omission','EMLoT’s home page names both Blackfriars I (1576) and II (1596).',['L07'])
lead('x-westminster-early-link','substantiated omission','Abbey history confirms the earlier c.960 Benedictine monastery.',['L08'])
for id,year,day in [('lm-app-bury-dissolution',1539,'4 November'),('lm-app-furness-dissolution',1537,'9 April'),('lm-app-gloucester-dissolution',1540,'2 January'),('lm-app-peterborough-dissolution',1539,'29 November'),('lm-app-rievaulx-dissolution',1538,'3 December'),('lm-app-sherborne-dissolution',1539,'18 March')]:
 lead(id,'retain year; richer chronology optional','Re-read source confirms '+day+' '+str(year)+'. The annual phase already includes the surrender year. Closure must not be equated with instant demolition; a following calendar-year display phase is not by itself an erroneous surrender date.')
lead('x-oxford-date-link','disagree with implied foundation correction','Oxford explicitly records teaching in 1096 and rapid growth from 1167. The app says schools gathered in the twelfth century and uses 1167 as a growth phase, not as a known foundation. Its source provenance could improve, but the imported implication is not present.')
lead('x-white-tower-link','already qualified','HRP gives 1078–1100; the current app summary says begun in the 1070s and complete by about 1100. The construction interval is already encoded.')

# Bibliography-only reviews are explicitly distinguished from historical adjudications.
for row in C.execute("select distinct f.entity_type,f.entity_id from fact f where f.entity_type='polity' or (f.entity_type='place' and f.entity_id in (select place_id from place_phase where size>=4)) order by f.entity_id"):
    et,eid=row
    fid=et+':'+eid+(':'+('existed' if et=='polity' else 'located_at'))
    if any(r['target_id']==fid for r in REVIEWS):continue
    cited=[dict(r) for r in C.execute('select s.* from source s join citation c on c.source_id=s.id where c.entity_id=?',(eid,))]
    if cited and all('wikipedia.org/' in s['url'] for s in cited):
        add('C-'+eid.split('/')[1],fid,'Priority entity rests only on Wikipedia','unverifiable','S3',
            'Bibliography-only review: every app citation for this entity resolves to Wikipedia. URLs were retrieved as leads, not accepted as historical authority. This does not prove the claim false, but leaves its chronology, rankings and geography without independent support in the app bibliography. No numerical replacement is proposed; the citation gap must be closed with a claim-specific primary or scholarly source. Existing uncertainty prose is retained.',
            [s['id'] for s in cited],scope='entity citation list; no historical confirmation')

if __name__=='__main__':
    payload={'reviewer':'gpt-6-astra','access_date':DATE,'reviews':REVIEWS,'new_facts':NEWFACTS,'lead_dispositions':LEADS,'strongest':STRONG}
    (BASE/'factkeeper-review-ledger.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2))
    print('Prepared',len(REVIEWS),'reviews,',len(NEWFACTS),'new facts,',len(LEADS),'lead dispositions; no application data changed.')
