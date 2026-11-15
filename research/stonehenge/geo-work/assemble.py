import json,math,numpy as np
from fitlib import *
exec(open('fit.py').read().split("nh=len(HILLS)")[0])
nh=len(HILLS); M=Model([v[1] for v in VALLEYS],nh); p=np.load('fit_p.npy')
base,grad,brg,hills,vdep,vsig=M.unpack(p)
def ground(x,z):
    M._cache=(0,[]); return float(M.eval(p,np.array([[x,z]],float))[0])
HNAMES={
 'King Barrow Ridge (north; Old King Barrows)':'King Barrow Ridge (central: New King Barrows; the Avenue climbs it)',
 'King Barrow Ridge (south; New King Barrows, Coneybury)':'King Barrow Ridge (south: Coneybury Hill)',
 'Normanton Down ridge (Bush Barrow)':'Normanton Down ridge (Bush Barrow and the Normanton Down barrows)',
 'Greater Cursus west ridge':'North-west upland (beyond the west end of the Greater Cursus / Lesser Cursus)',
 'Larkhill rise':'Larkhill rise (high ground north of Larkhill)',
 'Durrington Down (high ground north-west of Durrington Walls)':'High ground north-west of Durrington Walls',
 'Winterbourne Stoke Down':'West upland (Winterbourne Stoke Down)',
 'Wilsford Down upland (south-west)':'South-west upland (Wilsford Down side)',
 'South ridge (Lake Down - Normanton side)':'South ridge (Normanton / Lake Down side)',
 'Upland east of the Avon (Amesbury)':'Upland south-east of Amesbury',
 "Vespasian's Camp spur":"Vespasian's Camp spur (hill-fort promontory above the Avon)",
 'Stonehenge Down (knoll of the stones)':'Stonehenge Down knoll (flattens the ground under the stones)'}
VN={
 'River Avon valley (broad)':'River Avon valley (broad flood-plain and valley flanks)',
 'River Avon channel and scarps (narrow)':'River Avon channel and steep valley sides (Vespasian\'s Camp, Amesbury)',
 'Stonehenge Bottom (dry valley east of the stones; the Avenue crosses it)':'Stonehenge Bottom (dry valley east of the stones; the Avenue crosses it)',
 'North-west dry valley (Winterbourne Stoke Down)':'North-west dry valley (towards Winterbourne Stoke)',
 'Wilsford dry valley (south-west of Normanton Down)':'Wilsford dry valley (south-west of Normanton Down)',
 'Countess Down dry valley (Cursus to Durrington)':'Dry valley between King Barrow Ridge and Durrington',
}
def ll5(pts): return [[round(a,5),round(b,5)] for a,b in (ll(x,z) for x,z in pts)]
hl=[]
for h,(x,z,hh,s) in zip(HILLS,hills):
    la,lo=ll(x,z); hl.append(dict(name=HNAMES[h[0]],lat=round(la,5),lon=round(lo,5),height=round(float(hh),1),sigma=round(float(s)),x=round(float(x)),z=round(float(z))))
vl=[]
for v,d,s in zip(VALLEYS,vdep,vsig):
    path=[(float(a),float(b)) for a,b in v[1]]
    vl.append(dict(name=VN[v[0]],path=ll5(path),depth=round(float(d),1),sigma=round(float(s))))
terrain=dict(base=round(float(base),2),slope=dict(bearing=round(float(brg),1),gradient=round(float(grad),5)),hills=hl,valleys=vl,
 note="Least-squares fit (Levenberg-Marquardt, numpy) of the terrain.ts formula (base + slope + sum of gaussian hills - sum of gaussian valleys by distance to a polyline; the engine adds +/-0.6 m micro-relief and clamps at 2 m) to 1,302 EU-DEM 25 m samples: a 200 m grid over x -2800..3600, z -2900..2300 plus a 50 m grid over x,z -500..500. Local datum = metres above OD minus 60 (OD = Ordnance Datum Newlyn). Valley polylines were set by hand from the DEM (dry valleys) and the OSM River Avon centreline (simplified to 60 m); hill positions were left free but boxed around the named feature. The ground within 60 m of the stones was constrained (extra weighted pseudo-samples at 41.3) so the megalith ground varies by <1 m over 50 m radius; without it the DEM itself varies ~2 m there. Fit is a schematic reconstruction: RMS 4.5 m over the bounds (43 of 1,186 samples are >10 m off, mostly at the margins and along the steep Avon scarps at Vespasian's Camp), RMS 3.1 m (max 6.9) within 500 m of the stones. The DEM is a modern surface model (includes woods, roads, the A303 and A344 cuttings, buildings); prehistoric relief was essentially the same at this scale. Slope is negligible (0.002); relief comes from the hills/valleys.",
 sources=['sto-eudem-elevation','sto-open-meteo-elevation','sto-osm-overpass'])
# stats on DEM samples
Pa,ya=load_samples(); M._cache=(0,[])
r=M.eval(p,Pa)-ya
inb=(Pa[:,0]>=-2700)&(Pa[:,0]<=3500)&(Pa[:,1]>=-2800)&(Pa[:,1]<=2200); near=np.hypot(Pa[:,0],Pa[:,1])<=500
rn=lambda a: round(float(math.sqrt(np.mean(a**2))),2)
fit=dict(rmsAll=rn(r[inb]),maxAll=round(float(abs(r[inb]).max()),1),rmsNearStones=rn(r[near]),maxNearStones=round(float(abs(r[near]).max()),1),samples=int(inb.sum()),samplesNearStones=int(near.sum()),
  rmsAllInclMargin=rn(r),maxAllInclMargin=round(float(abs(r).max()),1),samplesInclMargin=len(r),fractionOver10m=round(float((abs(r[inb])>10).mean()),3),
  rangeWithin50mOfStones=0.92,
  crossCheck="EU-DEM vs Open-Meteo (Copernicus 90 m) differ by RMS 2.6 m (max 16.9) over the 1,302 points, mean +1.0 m; the fitted model vs Open-Meteo has RMS 5.3 m in bounds, so the fit error is of the same order as the disagreement between the two DEMs plus smoothing.")
# features
F=json.load(open('features.json')); Bw=json.load(open('barrows.json')); av=json.load(open('avon_chain.json'))
BXN=(-2700,3500);BZN=(-2800,2200)
BR=dict(xMin=-2700,xMax=3700,zMin=-2800,zMax=2200)
def inside(x,z,b): return b['xMin']<=x<=b['xMax'] and b['zMin']<=z<=b['zMax']
# add feature heights
for k,v in F.items():
    v['ground']=round(ground(v['x'],v['z']),1)
    v['insideBriefBounds']=inside(v['x'],v['z'],dict(xMin=-2700,xMax=3500,zMin=-2800,zMax=2200))
# bearing at stones for avenue
pa=F['avenue']['pathXZ']; F['avenue']['bearingAtStones']=round(math.degrees(math.atan2(pa[2][0]-pa[0][0],-(pa[2][1]-pa[0][1])))%360,1)
F['avenue']['bearingStonesToElbow']=F['avenue-elbow']['bearingStonesToElbow']
F['stonehenge-bottom-axis']=dict(lat=vl[2]['path'][3][0],lon=vl[2]['path'][3][1],x=0,z=0,path=vl[2]['path'],type='dry-valley',source='sto-eudem-elevation',note='axis of the fitted Stonehenge Bottom valley (hand-drawn from the DEM minima, N-S at x ~ 430-750 m, deepening south); the Avenue crosses it near x 500-600, z -390; valley floor ~86-90 m OD there vs 108-111 m OD on King Barrow Ridge')
pp=vl[2]['path'][3]; F['stonehenge-bottom-axis']['x'],F['stonehenge-bottom-axis']['z']=[round(float(c),1) for c in loc(*pp)]
# long barrows as features
for b in Bw:
    if b['name']=='Amesbury 42 long barrow': F['amesbury-42']=dict(b,type='long-barrow',ground=round(ground(b['x'],b['z']),1))
    if b['name'] and b['name'].startswith('Winterbourne Stoke 1'): F['winterbourne-stoke-1']=dict(b,type='long-barrow',ground=round(ground(b['x'],b['z']),1))
    if b['name']=='Normanton Down long barrow': F['normanton-down-long-barrow']=dict(b,type='long-barrow',ground=round(ground(b['x'],b['z']),1))
for b in Bw: b['ground']=round(ground(b['x'],b['z']),1)
F['bush-barrow']=[dict(b,type='barrow') for b in Bw if b['name']=='Bush Barrow'][0]
# avon
AV=[[round(a,6),round(b,6)] for a,b in (ll(*q) for q in av['simple'])]
avon=dict(path=AV,pathXZ=[[round(x,1),round(z,1)] for x,z in av['simple']],width=10,widthNote='ESTIMATE ONLY (not tagged in OSM): the Hampshire Avon here is roughly 8-12 m wide in its main channel, with side channels and water-meadow drains; verify before using for the ribbon width',
  note='centreline = OSM waterway=river ways named "River Avon" joined in flow order from Bulford (x 4160, z -1530) past Durrington, Amesbury (east and south of Vespasian\'s Camp), West Amesbury (Bluestonehenge) and on south beyond z 2500; simplified (Douglas-Peucker 7 m). The OSM chain includes strong meanders; side channels (31270121 and the Amesbury drains) omitted. It leaves the 3500 m east bound twice (x up to 3620 near z -400..-70 and x 3490 near z 1400).',
  length=round(sum(math.dist(av['simple'][i],av['simple'][i+1]) for i in range(len(av['simple'])-1))),source='sto-osm-overpass')
for k,v in F.items():
    if 'x' in v and 'source' in v: pass
geo=dict(
 origin=dict(lat=51.17886,lon=-1.82621,note="Centre of the sarsen circle. Method: circle fitted to 15 OpenStreetMap-mapped sarsen upright positions (radius 15.6 m, scatter 0.54 m) gives 51.178859, -1.826208; independently, NGR SU 12244219 (English Heritage 2010 survey report header, 10 m resolution; +5 m/+5 m cell centre converted OSGB36->WGS84 by a 7-parameter Helmert, ~3-5 m) gives 51.17886, -1.82621; Gazetteer of Great Britain lists SU 1224 4219 = 51.178887, -1.8262196; Wikipedia 51.17889, -1.82611. Heel Stone check: OSM centroid 78.8 m from this origin at azimuth 51.0 (Wikipedia: 77.4 m). Uncertainty: about +/-2 m relative to the mapped stones, +/-5-10 m absolute (OSM/Bing imagery registration, Helmert, 10 m NGR resolution). The brief's provisional 51.17888, -1.82619 is 3 m away: consistent.",
   sources=['sto-osm-overpass','sto-ea-survey-2010','sto-gazetteer-stonehenge','sto-wikipedia-stonehenge','sto-wikipedia-heel-stone']),
 datum=dict(offsetOD=60,note="Local height = metres above Ordnance Datum minus 60. EU-DEM 25 m gives 101.4 m OD at the centre (EH survey control points around the monument read 99.8-104.8 m OD), so the ground at the stones is ~41.4 m local (fit: 41.6). The lowest DEM ground (the Avon, ~62 m OD) is ~2 m local, right at the engine's MIN_LAND clamp of 2 m: if river banks flatten, use offsetOD 55 (stones ~46.5)."),
 bounds=BR,
 boundsBrief=dict(xMin=-2700,xMax=3500,zMin=-2800,zMax=2200),
 boundsNote="Recommend x -2700..3700, z -2800..2200 (6.4 x 5.0 km): the extra 200 m east keeps the Avon's eastern meander (x to 3620) and the Amesbury loop in the scene; otherwise the Avon valley is cut by the bound at z -500..+200 and the fit is ~12 m off there. Outside even this: Robin Hood's Ball (x -2004, z -3766, 1 km beyond the north edge), the Larkhill rise summit, long barrow at x 543, z -3143, the Wilsford barrow group (z > 2200), Durrington village (x 3591, z -2284 is just outside the brief bounds; inside the recommended x range only if z allows), Bulford. Inside: Lesser Cursus, Winterbourne Stoke crossroads group (x -1900..-2280), Lake barrows (z to 2125), Woodhenge, Durrington Walls, Vespasian's Camp, Amesbury, Bluestonehenge, Coneybury, Cuckoo Stone.",
 features=F,barrows=Bw,avon=avon,terrain=terrain,fit=fit,groundAtStones=round(ground(0,0),1))
json.dump(geo,open('../geo.json','w'),indent=1)
print(json.dumps(fit,indent=1)); print(geo['groundAtStones'],len(json.dumps(geo)))
print({k:(v['ground'],v['insideBriefBounds']) for k,v in F.items() if 'ground' in v})
