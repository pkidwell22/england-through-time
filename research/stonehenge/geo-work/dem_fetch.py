import json,time,urllib.request,sys,os
from common import *
pts=[]
# coarse 200 m over bounds (extend 100 m margin: x -2800..3600, z -2900..2300)
for z in range(-2900,2301,200):
    for x in range(-2800,3601,200): pts.append((x,z,'c'))
# fine 50 m over -500..500
for z in range(-500,501,50):
    for x in range(-500,501,50): pts.append((x,z,'f'))
# extra: 100 m grid -1500..1500 x  -1000..1200 would add many; skip
print(len(pts))
def get(url):
    for k in range(4):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'stonehenge-timelapse-research/1.0'}),timeout=60))
        except Exception as ex:
            print('retry',ex); time.sleep(40)
    raise
res={}
src=sys.argv[1]
for i in range(0,len(pts),100):
    ch=pts[i:i+100]
    if src=='eudem':
        loc_s='|'.join('%.6f,%.6f'%ll(x,z) for x,z,_ in ch)
        r=get('https://api.opentopodata.org/v1/eudem25m?locations='+loc_s)
        vals=[q['elevation'] for q in r['results']]
        time.sleep(1.1)
    else:
        la=','.join('%.6f'%ll(x,z)[0] for x,z,_ in ch); lo=','.join('%.6f'%ll(x,z)[1] for x,z,_ in ch)
        r=get('https://api.open-meteo.com/v1/elevation?latitude=%s&longitude=%s'%(la,lo)); vals=r['elevation']
        time.sleep(8)
    for (x,z,k),v in zip(ch,vals): res['%d,%d'%(x,z)]=v
    print(i,flush=True)
json.dump(res,open('dem_%s.json'%src,'w'))
