import json,math,numpy as np
from common import *
named={e['id']:e for e in json.load(open('osm_named_geom.json'))['elements']}
water={e['id']:e for e in json.load(open('osm_water.json'))['elements']}
hist=json.load(open('osm_historic.json'))['elements']
def way_pts(i,src=named): return [loc(p['lat'],p['lon']) for p in src[i]['geometry']]
def R(v,n=1): return round(float(v),n)
def feat(x,z,source,**kw):
    lat,lon=ll(x,z); d=dict(lat=round(lat,6),lon=round(lon,6),x=R(x),z=R(z)); d.update(kw); d['source']=source; return d
def ring_ll(pts): return [[round(ll(x,z)[0],6),round(ll(x,z)[1],6)] for x,z in pts]
def arclen(P): return [0]+list(np.cumsum([math.dist(P[i],P[i+1]) for i in range(len(P)-1)]))
def resample(P,n):
    P=[tuple(p) for p in P]; s=arclen(P); L=s[-1]; out=[]
    j=0
    for k in range(n):
        t=L*k/(n-1)
        while j<len(P)-2 and s[j+1]<t: j+=1
        f=(t-s[j])/((s[j+1]-s[j]) or 1); out.append((P[j][0]+f*(P[j+1][0]-P[j][0]),P[j][1]+f*(P[j+1][1]-P[j][1])))
    return out
def mid(side1,side2,n=40):
    a=resample(side1,n);b=resample(side2,n); return [((p[0]+q[0])/2,(p[1]+q[1])/2) for p,q in zip(a,b)]
def bearing(a,b): return (math.degrees(math.atan2(b[0]-a[0],-(b[1]-a[1]))))%360
F={}
OSM='OpenStreetMap contributors (ODbL) via Overpass API'
# --- circle
F['sarsen-circle-centre']=feat(0,0,'sto-osm-overpass; sto-ea-survey-2010',note='origin; centre of circle fitted to 15 OSM-mapped sarsen uprights (radius 15.6 m, scatter 0.5 m); agrees with NGR SU 12244219 (EH 2010)')
# --- heel stone etc from OSM stones
stones={e['id']:e for e in hist if e['tags'].get('natural')=='stone'}
def st(i): return loc(*pos(stones[i]))
x,z=st(133262440); F['heel-stone']=feat(x,z,'sto-osm-overpass; sto-wikipedia-heel-stone',note='OSM stone way centroid (ref 96); Wikipedia 51.179305,-1.825302 and 77.4 m from centre',distance=R(math.hypot(x,z)),bearing=R(bearing((0,0),(x,z))))
x,z=st(133262443); F['slaughter-stone']=feat(x,z,'sto-osm-overpass',note='Stone 95 (OSM)')
x,z=st(377365047); F['station-stone-91']=feat(x,z,'sto-osm-overpass')
x,z=st(377367000); F['station-stone-93']=feat(x,z,'sto-osm-overpass')
# --- Avenue
A1=way_pts(1190054181); B=way_pts(152660264); C=way_pts(131359467)
sideA1=[A1[5],A1[4],A1[3],A1[2],A1[1]]; sideA2=[A1[6],A1[7],A1[0]]
midA=mid(sideA1,sideA2,30)
sideB1=B[0:9]; sideB2=list(reversed(B[9:16]))
midB=mid(sideB1,sideB2,60)
cap=((B[8][0]+B[9][0])/2,(B[8][1]+B[9][1])/2)
# footway after the bend
Cpts=[p for p in C if p[0]>1655]
end_ext=(1985,800)  # Bluestonehenge north edge (straight extrapolation of the last footway segments)
ave=[midA[0]]+midA[1:]+midB[1:]
ave.append(cap)
# drop B-mid points past x 1640 duplicates then add footway
ave=[p for p in ave if True]
ave+= [p for p in Cpts[1:]] + [end_ext]
# thin to ~16 points
ave_s=resample(ave,18)
L=sum(math.dist(ave[i],ave[i+1]) for i in range(len(ave)-1))
F['avenue']=feat(*ave_s[0],'sto-osm-overpass; sto-ea-survey-2010; sto-wikipedia-avenue',path=ring_ll(ave_s),pathXZ=[[R(a),R(b)] for a,b in ave_s],length=R(L),width=23,note='centre line of the ditch-bounded Avenue polygons mapped in OSM (stones to the elbow near x 455 z -390, then east over King Barrow Ridge to x 1650 z -60) joined to the OSM footway "The Avenue" SE to the Avon; last leg (to Bluestonehenge) is a straight extrapolation of ~190 m. Ditches ~20 m apart (EH 2010 survey).')
elbow=midA[-1]
F['avenue-elbow']=feat(*elbow,'sto-osm-overpass; sto-ea-survey-2010',note='where the NE-trending straight stretch ends and the Avenue turns east (EH 2010: ditches turn sharply east after >550 m, in Stonehenge Bottom)',bearingStonesToElbow=R(bearing((0,0),elbow)))
# --- Cursus
Cu=way_pts(38528246)
north=[Cu[i] for i in (0,1,2)]; # west half north side from east? examine order
cu_n=sorted([Cu[i] for i in (14,0,1,2)]+[Cu[i] for i in (9,10,11,12,13)]+[Cu[8]],key=lambda p:p[0])  # z more negative = north
cu_s=sorted([Cu[i] for i in (3,4,5,6,7)],key=lambda p:p[0])
# north side: points with larger -z at given x; define north polyline from indices 9..13,14,0,1,2 plus ends
north_side=sorted([Cu[i] for i in (2,1,0,14,13,12,11,10,9,8)],key=lambda p:p[0])
south_side=sorted([Cu[i] for i in (3,4,5,6,7)],key=lambda p:p[0])
# end caps: west end between Cu[2] (north) and Cu[3] (south); east end between Cu[7] (south) and Cu[8] (north)
xs_st=np.linspace(-1287,1452,12)
def interp(side,x):
    S=sorted(side); return float(np.interp(x,[p[0] for p in S],[p[1] for p in S]))
axis=[]; widths=[]
for x in xs_st:
    zn=interp(north_side,x); zs=interp(south_side,x); axis.append((x,(zn+zs)/2)); widths.append(abs(zs-zn))
west_end=((Cu[2][0]+Cu[3][0])/2,(Cu[2][1]+Cu[3][1])/2); east_end=((Cu[7][0]+Cu[8][0])/2,(Cu[7][1]+Cu[8][1])/2)
axis=[west_end]+axis[1:-1]+[east_end]
Lc=math.dist(west_end,east_end)
F['cursus-greater']=feat(*[(west_end[0]+east_end[0])/2,(west_end[1]+east_end[1])/2],'sto-osm-overpass; sto-wikipedia-cursus',path=ring_ll(axis),pathXZ=[[R(a),R(b)] for a,b in axis],polygon=ring_ll(Cu[:-1]),length=R(Lc),width=R(np.median(widths)),widthRange=[R(min(widths)),R(max(widths))],bearing=R(bearing(west_end,east_end)),type='cursus',endWest=feat(*west_end,'osm'),endEast=feat(*east_end,'osm'),note='outline from OSM (NPE-traced earthwork); Wikipedia: ~2.76 km long, ~100 m wide, up to ~150 m at the west end. Width here = distance between mapped long sides.')
Ls=way_pts(377378043)
pts=np.array(Ls[:-1]); 
# long axis: from PCA
c=pts.mean(0); u,s,vt=np.linalg.svd(pts-c); d=vt[0]; proj=(pts-c)@d; perp=(pts-c)@vt[1]
e1=c+d*proj.max(); e2=c+d*proj.min()
if e1[0]<e2[0]: e1,e2=e2,e1
F['cursus-lesser']=feat(c[0],c[1],'sto-osm-overpass; sto-wikipedia-cursus',polygon=ring_ll(Ls[:-1]),path=ring_ll([tuple(e2),tuple(e1)]),length=R(proj.max()-proj.min()),width=R(perp.max()-perp.min()),bearing=R(bearing(tuple(e2),tuple(e1))),type='cursus',note='OSM outline (Bing); Wikipedia: ~400 m x 60 m, WSW-ENE; cropmark only')
# --- Durrington
DWc=(2760,-1540); a_ew,a_ns=233,245
dw=[(DWc[0]+a_ew*math.sin(t),DWc[1]-a_ns*math.cos(t)) for t in [2*math.pi*k/16 for k in range(16)]]
F['durrington-walls']=feat(*DWc,'sto-gazetteer-durrington; sto-wikipedia-durrington; sto-osm-overpass',polygon=ring_ll(dw),diameter=R((a_ew+a_ns)),axes=[2*a_ew,2*a_ns],type='henge',note='centre from SU 1500 4376 (Gazetteer of Great Britain: 51.192885,-1.786628), Wikipedia 51.1925,-1.7875; OSM node is ~190 m off. Ring = ellipse 466 m E-W x 490 m N-S (Gazetteer: 510 x 535 yd) drawn as 16 points: APPROXIMATE, not a survey outline; centre uncertainty +/-60 m, outline +/-40 m.')
F['durrington-southern-circle']=feat(2880,-1330,'sto-wikipedia-durrington',type='timber-circle',confidence='low',note='position estimated (south-east part of the enclosure, near the SE entrance); +/-60 m. Wikipedia text says the circle is 70 m north of Woodhenge, which does not fit the enclosure ellipse above; unresolved. Do not rely on better than ~100 m.')
W=way_pts(36970076); wc=np.mean(W[:-1],axis=0)
F['woodhenge']=feat(*wc,'sto-osm-overpass; sto-wikipedia-woodhenge',polygon=ring_ll(W[:-1]),diameter=110,type='henge',note='OSM polygon (54 m wide) marks the post-ring area; Wikipedia: whole monument 110 m across incl. ditch (up to 12 m wide) and outer bank; six oval post rings; entrance NE; Wikipedia 51.1894,-1.78576')
Cn=way_pts(377459876); cc=np.mean(Cn[:-1],axis=0)
F['coneybury-henge']=feat(*cc,'sto-osm-overpass',polygon=ring_ll(Cn[:-1]),diameter=R(2*np.mean([math.dist(p,cc) for p in Cn[:-1]])),type='henge',note='OSM outline; Neolithic henge excavated 1980s; (Coneybury Anomaly pit site is nearby, not mapped)')
Bs=way_pts(1190057263); bc=np.mean(Bs[:-1],axis=0)
F['bluestonehenge']=feat(*bc,'sto-osm-overpass; sto-wikipedia-bluestonehenge',polygon=ring_ll(Bs[:-1]),diameter=R(2*np.mean([math.dist(p,bc) for p in Bs[:-1]])),type='henge',note='West Amesbury henge on the Avon bank; OSM marks it "approximate location from photos"; Wikipedia 51.1714,-1.7980; ditch ~25 m wide, stone circle ~10 m across (possibly 27 stones)')
x,z=loc(51.18914,-1.79163); 
cs=[e for e in hist if e['id']==2798262550][0]; x,z=loc(*pos(cs))
F['cuckoo-stone']=feat(x,z,'sto-osm-overpass; sto-wikipedia-cuckoo-stone',note='Wikipedia 51.18923,-1.79168 (SU14654335)')
rh=way_pts(36970535); rc=np.mean(rh[:-1],axis=0)
F['robin-hoods-ball']=feat(*rc,'sto-osm-overpass; sto-wikipedia-robin-hoods-ball',polygon=ring_ll(rh[:-1]),type='causewayed-enclosure',insideBounds=bool(-2700<=rc[0]<=3500 and -2800<=rc[1]<=2200),note='about 4 km NNW of the stones; Wikipedia 51.2128,-1.8550')
V=way_pts(152664904)[:-1]
Vc=np.mean(V,axis=0)
Vs=resample(V+[V[0]],25)[:-1]
F['vespasians-camp']=feat(*Vc,'sto-osm-overpass; sto-wikipedia-vespasians-camp',polygon=ring_ll(Vs),type='hillfort',length=730,note='OSM outline (rampart line, 14 vertices) re-sampled to 24 points at equal arc length (corners slightly rounded). Wikipedia: 14 ha, 730 m N-S, 374 m wide at the south, 100 m at the north; bank up to 40 m wide, ditch up to 10 m, counterscarp 18 m; Avon runs along the south side (sic: OSM puts the loop west and south)')
hx=dict(a={'x':2926,'z':775})
ch=[e for e in json.load(open('osm_amesbury.json'))['elements'] if e['id'] in (237984795,152664898)]
chp={e['id']:np.mean([loc(p['lat'],p['lon']) for p in e['geometry'][:-1]],axis=0) for e in ch}
F['amesbury-church']=feat(*chp[237984795],'sto-osm-overpass',note='St Mary and St Melor (building polygon centroid); Grade I; may be the surviving priory church (Wikipedia Amesbury Abbey)')
F['amesbury-abbey-house']=feat(*chp[152664898],'sto-osm-overpass',note='OSM building "Amesbury Abbey": the 19th-century country house (Wikipedia: priory was destroyed at the Dissolution); not the medieval priory church')
pc=(chp[237984795][0]-45,chp[237984795][1]+0)
prec=[(pc[0]-110,pc[1]-65),(pc[0]+110,pc[1]-65),(pc[0]+110,pc[1]+65),(pc[0]-110,pc[1]+65)]
F['amesbury-abbey-precinct']=feat(*pc,'conjecture',polygon=ring_ll(prec),type='conjectural',confidence='low',note='NO source gives the precinct boundary. 220 x 130 m rectangle centred ~45 m west of the church (Fontevraud priory lay by the church). Placeholder only: lead should label as conjectural.')
tc=[e for e in hist if e['id']==21496954 or (e['type']=='node' and e['id']==21496954)]
F['amesbury-town-centre']=feat(*loc(51.17230,-1.78175),'sto-osm-overpass',note='OSM place=town node')
sb=[e for e in hist if e['id']==7970050053][0]
F['stonehenge-bottom-label']=feat(*loc(*pos(sb)),'sto-osm-overpass',note='OSM place=locality node "Stonehenge Bottom" (label position only; the valley is fitted from the DEM)')
json.dump(F,open('features.json','w'),indent=1)
json.dump(dict(ave=ave,midA=midA,midB=midB),open('avenue_work.json','w'))
print('avenue length',L,len(ave_s)); print('cursus',Lc,np.median(widths),min(widths),max(widths),bearing(west_end,east_end))
print({k:(v['x'],v['z']) for k,v in F.items()})
