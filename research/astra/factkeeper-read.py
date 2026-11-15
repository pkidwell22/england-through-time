"""Print selected source passages, retaining a local record of passages inspected."""
import datetime,json,pathlib,re,sys
BASE=pathlib.Path(__file__).resolve().parent
records=[]
for p in (BASE/'factkeeper-evidence').glob('factkeeper-*.json'):
    try: records.append(json.loads(p.read_text()))
    except json.JSONDecodeError: pass
for item in json.load(sys.stdin):
    sid,patterns=item[:2]; limit=item[2] if len(item)>2 else 1500
    r=next((r for r in records if sid in r['source_ids'] or sid==r['url']),None)
    print('\nSOURCE',sid, r and r['url'])
    if not r or 'text_file' not in r:
        print('UNAVAILABLE',r);continue
    t=(BASE/r['text_file']).read_text();ranges=[]
    for pattern in patterns:
        found=list(re.finditer(pattern,t,re.I))
        if not found:print('NOT FOUND',pattern)
        for m in found[:2]:
            a=max(0,m.start()-130);b=min(len(t),m.end()+550)
            if any(a<y and b>x for x,y in ranges):continue
            ranges.append((a,b))
    excerpt='\n[...]\n'.join(t[a:b] for a,b in sorted(ranges))[:limit]
    print(excerpt)
    with open(BASE/'factkeeper-read-log.jsonl','a') as f:f.write(json.dumps({'source':sid,'url':r['url'],'accessed_at':r['accessed_at'],'read_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'patterns':patterns,'excerpt':excerpt},ensure_ascii=False)+'\n')
