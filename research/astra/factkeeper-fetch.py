"""Read-only source retrieval for the factkeeper; output confined to this directory."""
import concurrent.futures, datetime, hashlib, io, json, pathlib, re, sqlite3, sys, logging, warnings
warnings.filterwarnings('ignore', message='urllib3 v2 only supports OpenSSL')
logging.getLogger('pypdf').setLevel(logging.ERROR)
from html.parser import HTMLParser
import requests
from pypdf import PdfReader

BASE = pathlib.Path(__file__).resolve().parent
OUT = BASE / 'factkeeper-evidence'
OUT.mkdir(exist_ok=True)

class Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.ignore=0; self.parts=[]
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style','noscript','svg'): self.ignore+=1
        if not self.ignore and tag in ('p','div','h1','h2','h3','li','br','tr','section'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script','style','noscript','svg'): self.ignore=max(0,self.ignore-1)
        if not self.ignore and tag in ('p','div','h1','h2','h3','li','tr','section'): self.parts.append('\n')
    def handle_data(self, data):
        if not self.ignore: self.parts.append(data)
    def result(self):
        return '\n'.join(s for x in ''.join(self.parts).splitlines() if (s:=re.sub(r'\s+',' ',x).strip()))

def fetch(item):
    url, ids=item
    key=hashlib.sha256(url.encode()).hexdigest()[:18]
    meta=OUT/('factkeeper-'+key+'.json')
    if meta.exists(): return json.loads(meta.read_text())
    r={'url':url,'source_ids':ids,'accessed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'key':key}
    try:
        res=requests.get(url,headers={'User-Agent':'Mozilla/5.0 (compatible; historical source verification)'},timeout=(10,25))
        r.update(status=res.status_code,final_url=res.url,content_type=res.headers.get('content-type',''),bytes=len(res.content))
        res.raise_for_status()
        if res.content.startswith(b'%PDF'):
            (OUT/('factkeeper-'+key+'.pdf')).write_bytes(res.content)
            doc=PdfReader(io.BytesIO(res.content));r['pages']=len(doc.pages)
            body='\n\n'.join('PAGE '+str(i+1)+'\n'+(p.extract_text() or '') for i,p in enumerate(doc.pages))
        elif 'html' in r['content_type'] or '<html' in res.text[:300].lower():
            p=Text();p.feed(res.text);body=p.result()
        else: body=res.text
        path=OUT/('factkeeper-'+key+'.txt');path.write_text(body)
        r.update(text_file=str(path.relative_to(BASE)),text_length=len(body),sha256=hashlib.sha256(res.content).hexdigest())
    except Exception as e: r['error']=str(e)[:500]
    meta.write_text(json.dumps(r,ensure_ascii=False,indent=2));return r

def main():
    c=sqlite3.connect('file:'+str(BASE/'factkeeper-history-snapshot.sqlite')+'?mode=ro',uri=True)
    urls={}
    for sid,url,scope in c.execute('select id,url,scope from source'):
        if url and (scope!='stonehenge' or '--stonehenge' in sys.argv): urls.setdefault(url,[]).append(sid)
    for r in json.load(open(BASE/'factkeeper-leads.json')): urls.setdefault(r['url'],[]).append(r['id'])
    if '--extra' in sys.argv:
        for r in json.load(open(BASE/'factkeeper-extra-sources.json')):urls.setdefault(r['url'],[]).append(r['id'])
    results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        for i,r in enumerate(ex.map(fetch,urls.items()),1):
            results.append(r)
            if i%25==0: print(i,'/',len(urls),'retrieved',sum('text_file' in x for x in results),flush=True)
    (BASE/'factkeeper-fetch-manifest.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
    print('DONE',len(results),'readable',sum('text_file' in x for x in results),flush=True)

if __name__=='__main__': main()
