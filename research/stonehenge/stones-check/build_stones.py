#!/usr/bin/env python3
"""Generate data/locations/stonehenge/stones.json (stone catalogue) and the per-stone table for stones.md.
Run:  python3 -I build_stones.py   (from this folder)
Positions: az/r from the FITTED sarsen-circle centre (see CENTRE below), az clockwise from true north.
"""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(P, 'data', 'locations', 'stonehenge', 'stones.json')
TABLE = os.path.join(HERE, 'stones-table.md')

# ---------------------------------------------------------------- frame
LAT0, LON0 = 51.17888, -1.82619            # provisional site origin (site.json)
KY = 111195.0
KX = KY * math.cos(math.radians(LAT0))
CENTRE_XZ = (-0.43, 1.33)                  # fitted centre of the sarsen circle relative to provisional origin (x east, z south), metres
AXIS = 49.9                                # modelling axis azimuth (lead's value, matches the brief's sightline)

osm = json.load(open(os.path.join(HERE, 'osm-overpass-snapshot.json')))


def xz_of(lat, lon):
    return ((lon - LON0) * KX, -(lat - LAT0) * KY)


def polar_from_centre(x, z):
    dx, dz = x - CENTRE_XZ[0], z - CENTRE_XZ[1]
    return (math.degrees(math.atan2(dx, -dz)) % 360.0, math.hypot(dx, dz))


def way_centroid(e):
    pts = [xz_of(p['lat'], p['lon']) for p in e['geometry']]
    if pts[0] == pts[-1]:
        pts = pts[:-1]
    A = cx = cz = 0.0
    for i in range(len(pts)):
        x1, z1 = pts[i]
        x2, z2 = pts[(i + 1) % len(pts)]
        c = x1 * z2 - x2 * z1
        A += c
        cx += (x1 + x2) * c
        cz += (z1 + z2) * c
    A /= 2.0
    return (cx / (6 * A), cz / (6 * A))


osm_ref = {}
for e in osm['elements']:
    t = e.get('tags', {})
    if e['type'] == 'way' and t.get('natural') == 'stone' and t.get('ref') and 'Aubrey' not in t.get('name', ''):
        osm_ref[t['ref']] = polar_from_centre(*way_centroid(e))
    if e['type'] == 'node' and t.get('ref') in ('92', '94', '97'):
        osm_ref[t['ref']] = polar_from_centre(*xz_of(e['lat'], e['lon']))
# the OSM way ref=32 (bluestone) and the Aubrey Hole plaques share ref numbers; Aubrey Hole plaques are excluded above.


def norm(a):
    return a % 360.0


def r1(v, n=1):
    return round(v, n)


def to_xz(az, r):
    a = math.radians(az)
    return (r * math.sin(a), -r * math.cos(a))


def from_xz(x, z):
    return (norm(math.degrees(math.atan2(x, -z))), math.hypot(x, z))


stones = []


def add(**kw):
    s = {k: v for k, v in kw.items() if v is not None}
    stones.append(s)
    return s


S_SOS = 'sto-sos-stones'      # Stones of Stonehenge per-stone posts
S_SOSA = 'sto-sos-about'
S_SOSM = 'sto-sos-missing'
S_STUK = 'sto-stukeley-1740'
S_BARC = 'sto-barclay-1895'
S_LONG = 'sto-long-1876'
S_ANTQ = 'sto-antiquity-keeping-time'
S_OSM = 'sto-osm-overpass'
S_WIKI = 'sto-wiki-stonehenge'
S_EB = 'sto-eb1911-stonehenge'
S_EHB = 'sto-eh-100-years-care'
S_EHD = 'sto-eh-description'
S_EHS = 'sto-eh-sources'
S_WOOD = 'sto-wood-1747'
S_FIELD = 'sto-field-2015-blog'
S_STEV = 'sto-stevens-1916'

# ================================================================ 1. SARSEN CIRCLE UPRIGHTS 1-30
RING_R = 15.2
STEP = (360.0 - 1.1) / 30.0          # uniform step; the 30/1 gap is ~1.1 deg (~0.3 m) wider (entrance, Antiquity: 1.38 m gap)
AZ1 = AXIS + 6.5
up_az = {n: norm(AZ1 + STEP * (n - 1)) for n in range(1, 31)}

HEIGHT = {1: 3.96, 2: 4.27, 3: 4.16, 4: 4.27, 5: 4.27, 6: 4.19, 7: 3.96, 10: 3.96, 11: 2.74, 16: 4.27,
          21: 3.96, 22: 3.81, 23: 3.81, 27: 3.96, 28: 3.96, 29: 3.96, 30: 3.96}
STANDING_TODAY = set(HEIGHT)
FALLEN_TODAY = {12: 'fallen', 25: 'fallen', 14: 'fallen', 8: 'broken', 9: 'broken', 19: 'broken', 26: 'broken', 15: 'broken'}
MISSING_UP = [13, 17, 18, 20, 24]

for n in range(1, 31):
    az = up_az[n]
    base = dict(id=str(n), set='sarsen-circle', type='sarsen', role='upright', az=r1(az), r=RING_R,
                w=2.1, t=1.1, h=HEIGHT.get(n, 4.1), built='standing', dressed=True, tenons=True)
    src = [S_SOS, S_STUK, S_BARC, S_ANTQ]
    if n == 11:
        base.update(w=1.1, t=0.7)
    if n == 21:
        base.update(w=1.5, t=0.9)
    inward = norm(az + 180)
    if n in STANDING_TODAY and n not in (6, 7):
        extra = ''
        if n == 22:
            ev = ('Standing in 1625 (assumed, high-ish confidence): Stukeley (observations 1719-24, pub. 1740) counts 17 uprights of the outer circle standing, a '
                  'number equal to today, so the 1900 fall of stone 22 (31 Dec 1900, with lintel 122) was not a long-standing ruin; it was re-erected in the 1950s. '
                  'No earlier fall is recorded.')
        elif n == 23:
            ev = ('Standing in 1625 (assumed): in the 17 standing uprights of Stukeley 1720s; Wikipedia says stone 23 fell in 1963 and was re-erected, so it was upright '
                  'until the 20th century. No earlier fall is recorded.')
        elif n == 21:
            ev = ('Standing in 1625 (assumed): in Stukeley\'s 17 uprights standing (1720s); stone 21 was straightened in the 20th-century programme (a research-footnote snippet, date not read).')
        else:
            ev = ('Standing in 1625 (assumed, medium confidence): the 17 uprights standing today are the same count that Stukeley recorded standing in the 1720s '
                  '(11 continuous by the entrance with 5 lintels, 1 leaning, ...); no source records any fall or re-erection of this stone before the 20th century, '
                  'so it is assumed standing since the monument was built. Not attested individually in 1625.')
        s = add(**base, state1625='standing', evidence1625=ev, sources=src)
        if n == 11:
            s['notes'] = ('Short stone, unique (Barclay 1895); about 1.1 m wide, thinner and shorter than the rest; Antiquity (2022) says recent work suggests its top is broken off. '
                          'Height 2.74 m from Stones of Stonehenge. Width from Antiquity article.')
        elif n == 21:
            s['notes'] = 'About 1.5 m wide and thinner than average (Antiquity). Height 3.96 m (Stones of Stonehenge).'
        elif n == 16:
            s['notes'] = ('"Extra stout" pier dividing two gaps, tenons on its upper face (Barclay 1895); 23.5 t visible, heaviest visible outer-circle sarsen (Field et al. via blog). '
                          'Width kept at the typical 2.1 m; real width not found.')
        elif n == 22:
            s['notes'] = 'Height 3.81 m is an estimate (it was fallen when the Chief Architect inspected in 1919).'
        else:
            s['notes'] = 'Height from Stones of Stonehenge (laser-scan era figure); width/thickness typical, not measured per stone.'
    elif n in (6, 7):
        ev = ('Leaning in 1625 (assumed from 1901 state; direction not established): Encyclopaedia Britannica 1911 reports trilithon 6-7 had "slewed round" with its lintel turned in 1901, '
              'and English Heritage says the restoration began in 1919 with stones 6 and 7, one leaning inward and one outward. Stukeley\'s 1720s count of 17 standing includes both. '
              'Which of the two leaned in/out is not given in fetched sources; the assignment here (6 inward, 7 outward) is arbitrary.')
        s = add(**base, state1625='leaning', lean=5, leanToward=r1(inward if n == 6 else az), evidence1625=ev,
                sources=src + [S_EB, S_EHB])
        s['notes'] = 'Straightened 1919-20. Lean magnitude (5 deg) is a placeholder.'
    elif n in FALLEN_TODAY:
        st = FALLEN_TODAY[n]
        if n == 14:
            ev = ('Leaning in 1625 (assumed from the 1720s): Stukeley describes one upright "at the back of the temple or on the south-west" that leans upon a stone of the inner circle (1720s), '
                  'and Barclay 1895 says the later fall of pier 14 damaged bluestones 37-39; Burl (via Stones of Stonehenge) identifies 14 with Aubrey\'s fallen "Friar\'s Heel" stone, which would '
                  'mean it was already down c.1666-93 - a conflict that is unresolved. Date of fall unknown (between the 1720s and 1771 by Burl\'s reading).')
            s = add(**base, state1625='leaning', lean=20, leanToward=r1(inward), evidence1625=ev, sources=src + [S_STUK, S_BARC])
            s['notes'] = 'Fell inward onto the bluestone circle (stones 37-39). Currently prostrate; heavy complete pier (6.98 t above ground). Lean angle is a placeholder.'
            s['fallToward'] = r1(inward)
            s['stateToday'] = 'fallen'
            continue
        ev = ('%s in 1625 (assumed): lying/broken on Petrie\'s and Barclay\'s plan; Stukeley counted 6 uprights lying on the ground in the 1720s (24 of 30 positions with stones: 17 standing, 1 leaning, 6 lying) '
              'so the fallen set was already about this size by then; which six they were is not stated in the text and a fall date for each is unknown. Assumed down by 1625 - no evidence of a later fall.' % ('Broken portion' if st == 'broken' else 'Fallen'))
        s = add(**base, state1625=st, fallToward=r1(inward), pieces=(2 if n == 9 else 1), evidence1625=ev, sources=src)
        notes = {8: 'Portion of a pier (Barclay 1895; 1.56 t above ground).',
                 9: 'Two pieces, 9a + 9b (Barclay 1895); weight shown on Stones of Stonehenge (0.29 t) is flagged by that site as possibly an error.',
                 12: 'Complete pier lying on the ground, tenons for lintel 112 still visible (Barclay 1895); 15.2 t.',
                 15: 'Only a fragment (3.14 t) at the surface; Antiquity (2022) counts S15 as missing. Barclay 1895 lists five missing piers (13, 17, 18, 20, 24), so 15 is a fragment.',
                 19: 'Portion of a pier (3.96 t above ground).',
                 25: 'Complete pier, prostrate (Barclay 1895); 7.08 t above ground.',
                 26: 'Portion of a pier (0.96 t above ground).'}
        s['notes'] = notes[n] + ' Fall direction is assumed inward (not read from a plan).'
        s['stateToday'] = st
    else:  # missing
        ev = ('Missing in 1625 (assumed): no stone at this position on Stukeley\'s 1720s count (24 of 30 visible, 22 lintels and 6 piers gone) or Petrie 1880; Barclay 1895 lists five piers missing '
              '(13, 17, 18, 20, 24). Antiquity (2022) places the six missing uprights in the south-west and concludes they were robbed in antiquity; parchmarks of 2013 and excavated sockets '
              'mark some positions (Banton 2014; Cleal 1995). Which of these five positions has a proved stonehole is not established from fetched sources; the stone\'s existence is inferred.')
        s = add(**base, state1625='missing', evidence1625=ev, hypothetical=True, sources=src + [S_SOSM])
        s['notes'] = ('Hypothetical: position from the 30-fold geometry only; height/width typical. The "circle was never completed" view (Field et al. non-completion argument) is in the literature; '
                      'the Antiquity article treats the circle as intended complete.')
        s['stateToday'] = 'missing'

# ================================================================ 2. SARSEN LINTELS 101-130
LINTEL_NOTE = {
    101: 'In situ on 30 and 1, spans the main axis (Stones of Stonehenge); 4.51 t.',
    102: 'In situ on 1 and 2; 6.48 t.', 105: 'In situ on 4 and 5; 3.81 t.', 107: 'In situ on 6 and 7; 5.04 t.',
    122: 'Fell with stone 22 on 31 Dec 1900, broke on the fallen West Trilithon stones; repinned, re-erected with 21 and 22 in the 1950s; 6.48 t.',
    130: 'In situ on 29 and 30; 6.24 t.',
    120: 'Portion of a prostrate lintel (Barclay 1895), 1.17 t above ground; carried by uprights 19 and 20 when complete.',
    127: 'Portion of a prostrate lintel (Barclay 1895), 1.44 t above ground; carried by uprights 26 and 27 when complete.'}
IN_SITU = {101, 102, 105, 107, 122, 130}
FALLEN_L = {120, 127}
for k in range(101, 131):
    hi = k - 100
    lo = 30 if hi == 1 else hi - 1
    az_hi, az_lo = up_az[hi], up_az[lo]
    d = (az_hi - az_lo + 540) % 360 - 180          # signed shortest difference
    az = norm(az_lo + d / 2.0)
    base = dict(id=str(k), set='sarsen-lintels', type='sarsen', role='lintel', az=r1(az), r=RING_R,
                w=3.2, t=1.05, h=0.8, on=[str(lo), str(hi)] if lo != 30 else ['30', '1'],
                curved=True, built='standing', dressed=True, tenons=True)
    if lo == 30 and hi == 1:
        base['on'] = ['30', '1']
    else:
        base['on'] = [str(lo), str(hi)]
    srcs = [S_SOS, S_STUK, S_BARC, S_ANTQ, S_SOSA]
    if k in IN_SITU:
        if k == 122:
            ev = ('Standing (in place) in 1625: it fell on 31 Dec 1900 with stone 22 (Stones of Stonehenge; Encyclopaedia Britannica 1911). Stukeley (1720s) counts exactly six lintels in place '
                  '(five on the 11 continuous uprights by the entrance and "one impost more in its proper place") - this is the sixth.')
        else:
            ev = ('Standing (in place) in 1625 (assumed): in situ today and one of the five lintels Stukeley (1720s) records on the 11 continuous uprights by the entrance; '
                  'no source records it falling or being replaced.')
        s = add(**base, state1625='standing', evidence1625=ev, sources=srcs + [S_EB])
        s['notes'] = LINTEL_NOTE[k] + ' Length/width/depth are the typical lintel size (3.2 x 1.05 x 0.8 m; Wikipedia), not measured per lintel.'
    elif k in FALLEN_L:
        ev = ('Fallen/broken in 1625 (assumed): Stukeley (1720s) records two lintels lying on the ground; Barclay 1895 identifies 120 and 127 as portions of prostrate lintels. Date of fall unknown.')
        s = add(**base, state1625='broken', pieces=1, fallToward=r1(norm(az + 180)), evidence1625=ev, sources=srcs)
        s['notes'] = LINTEL_NOTE[k] + ' Fall direction assumed.'
    else:
        ev = ('Missing in 1625 (assumed): Stukeley (1720s) counts 22 lintels "carried off"; Barclay 1895 says 20+ are missing. Whether any were removed between 1625 and the 1720s cannot be determined; '
              'no source records it. Existence inferred from the tenons on the uprights and the intended complete ring.')
        s = add(**base, state1625='missing', hypothetical=True, evidence1625=ev, sources=srcs)
        s['notes'] = 'Hypothetical lintel: the ring is assumed to have been complete when built (Antiquity 2022); the 22 missing lintels are the ones Stukeley found carried off. Typical size.'

# ================================================================ 3. TRILITHONS (horseshoe)
HA, HB, HUC = 8.0, 6.2, 0.5          # trilithon curve: quarter-ellipse (semi-axes along axis A, across B, centre offset uc, metres, axis frame: u along the axis to NE, v to the right/SE) then straight parallel arms
SEP = 3.25                            # centre-to-centre of the two uprights (mortise spacing on lintel 156 = 128 in = 3.25 m)
TRI_STEP = 6.2                        # centre-to-centre of adjacent trilithons along the curve (m), set so neighbouring uprights do not overlap
TRI_THETA = [2 * TRI_STEP, TRI_STEP, 0.0, -TRI_STEP, -2 * TRI_STEP]   # signed path length s from the SW vertex; s>0 on the +v (SE) side
AXV = math.radians(AXIS)


def axis_to_xz(u, v):
    # u along the axis (az AXIS), v to the right (az AXIS+90); x east, z south
    x = u * math.sin(AXV) + v * math.sin(AXV + math.pi / 2)
    z = -(u * math.cos(AXV) + v * math.cos(AXV + math.pi / 2))
    return x, z


def _quarter_len(A, B):
    n, L, prev = 4000, 0.0, None
    for i in range(n + 1):
        t = (math.pi / 2) * i / n
        p = (-A * math.cos(t), B * math.sin(t))
        if prev:
            L += math.hypot(p[0] - prev[0], p[1] - prev[1])
        prev = p
    return L


def _curve(A, B, uc, s):
    """point and unit tangent (direction of increasing s) at signed path length s; s>0 on the +v side."""
    sg = 1.0 if s >= 0 else -1.0
    a = abs(s)
    Lq = _quarter_len(A, B)
    if a <= Lq:
        lo, hi = 0.0, math.pi / 2
        for _ in range(60):          # invert arc length by bisection
            mid = (lo + hi) / 2
            m, prev, L = 400, None, 0.0
            for i in range(m + 1):
                t = mid * i / m
                p = (-A * math.cos(t), B * math.sin(t))
                if prev:
                    L += math.hypot(p[0] - prev[0], p[1] - prev[1])
                prev = p
            if L < a: lo = mid
            else: hi = mid
        t = (lo + hi) / 2
        u, v = uc - A * math.cos(t), B * math.sin(t)
        tu, tv = A * math.sin(t), B * math.cos(t)
    else:
        u, v = uc + (a - Lq), B
        tu, tv = 1.0, 0.0
    n = math.hypot(tu, tv)
    tu, tv = tu / n, tv / n
    return (u, sg * v), (tu * sg if False else (tu if sg > 0 else tu), tv)


def ell_point(A, B, uc, s):
    return _curve(A, B, uc, s)[0]


def ell_stone(A, B, uc, s, off):
    (pu, pv), (tu, tv) = _curve(A, B, uc, s)
    if s < 0:
        # on the -v side the direction of increasing s runs from the arm toward the vertex: tangent = (-tu, +tv) mirrored
        tu, tv = -tu, tv
    u, v = pu + off * tu, pv + off * tv
    x, z = axis_to_xz(u, v)
    az, r = from_xz(x, z)
    # inward normal: toward the axis side of the curve (perpendicular to the tangent, pointing to the curve's inside)
    ca, cb = (-tv, tu), (tv, -tu)
    cu, cv = (uc - pu, -pv)          # vector from the point toward (uc,0)-ish
    nu, nv = ca if (ca[0] * cu + ca[1] * cv) > 0 else cb
    nx, nz = axis_to_xz(nu, nv)
    face = norm(math.degrees(math.atan2(nx, -nz)))
    return az, r, face


TRI_H = {51: 4.98, 52: 5.08, 53: 5.18, 54: 5.18, 55: 6.55, 56: 6.55, 57: 5.18, 58: 5.18, 59: 5.03, 60: 5.03}
tri_pos = {}
for i, th in enumerate(TRI_THETA):
    a, b = 51 + 2 * i, 52 + 2 * i
    tri_pos[a] = ell_stone(HA, HB, HUC, th, +SEP / 2)
    tri_pos[b] = ell_stone(HA, HB, HUC, th, -SEP / 2)

TRI_NOTES = {
    51: 'Eastern end of the horseshoe, nearest the entrance on the east side; natural hollow in the SE face filled with concrete in the 1950s (Stones of Stonehenge). 23.7 t above ground.',
    52: '"I WREN" graffito on the south edge; 27.7 t above ground.',
    53: 'Bronze Age axe and dagger carvings on its north face (Stones of Stonehenge). 18.1 t.',
    54: '29.3 t above ground.',
    55: 'Fallen upright of the Great Trilithon, broken in two (55a, 55b) lying across the Altar Stone; 15.8 t above ground for both pieces. Height assumed equal to 56.',
    56: 'Tallest stone at Stonehenge: 6.55 m to the platform, 6.88 m to the top of the tenon (Stones of Stonehenge). Leaning until straightened and concreted on 19 Sep 1901 (set about 0.5 m from its old position by some accounts, not verified).',
    57: 'Fell with 58 and lintel 158 on 3 Jan 1797, re-erected 1958; height 5.18 m is an estimate (fallen when inspected in 1919).',
    58: 'Fell with 57 and lintel 158 on 3 Jan 1797 (outwards, westwards), re-erected 1958 after drilling and pinning along a bedding plane; 5.18 m estimated.',
    59: 'Fallen upright, broken in three pieces (59a, 59b, 59c), fell forwards into the horseshoe; 21.8 t above ground for all three. Height assumed equal to 60.',
    60: 'Only upright of the NW trilithon still standing; large natural cavity in its lower west face filled with concrete in 1959. 21.6 t.'}


TRI_WT = {51: 23.66, 52: 27.69, 53: 18.14, 54: 29.32, 55: 23.06, 56: 23.06, 57: 27.93, 58: 24.04, 59: 21.84, 60: 21.62}


def tri_size(n):
    area = TRI_WT[n] / (2.65 * TRI_H[n] * 0.9)      # mean cross-section from above-ground weight, density 2.65 t/m3, taper factor 0.9
    w = math.sqrt(1.8 * area)
    return round(w, 2), round(area / w, 2)


def tri_upright(n):
    az, r, face = tri_pos[n]
    h = TRI_H[n]
    tw, tt = tri_size(n)
    base = dict(id=str(n), set='trilithons', type='sarsen', role='upright', az=r1(az), r=r1(r, 2), face=r1(face),
                w=tw, t=tt, h=h, built='standing', dressed=True, tenons=True)
    srcs = [S_SOS, S_STUK, S_BARC, S_OSM] if False else [S_SOS, S_STUK, S_BARC]
    if n in (51, 52, 53, 54):
        ev = ('Standing in 1625: Stukeley (1720s) describes the first two trilithons on the left of the entrance (51-52 and 53-54) as entire and in situ, and they have stood ever since (Stones of Stonehenge: '
              '"remained standing for 4,500 years"). No fall recorded; assumed standing in 1625.')
        s = add(**base, state1625='standing', evidence1625=ev, sources=srcs)
    elif n in (57, 58):
        ev = ('Standing in 1625: the trilithon 57-58 with lintel 158 fell on 3 January 1797 (Maton, Archaeologia 13; Barclay 1895; Stones of Stonehenge), and Stukeley (1720s) records it entire except for part of the end of the impost. '
              'It was therefore upright in 1625 unless it fell and was re-erected, for which there is no evidence.')
        s = add(**base, state1625='standing', evidence1625=ev, sources=srcs + [S_EB])
    elif n == 60:
        ev = ('Standing in 1625: Stukeley (1720s) says the outer upright of the last trilithon, the jamb of the entrance to the adytum, is still standing; Barclay 1895: "Stone 60 is in situ".')
        s = add(**base, state1625='standing', evidence1625=ev, sources=srcs)
    elif n == 59:
        ev = ('Fallen and broken in 1625: Stukeley (1720s) records the other upright and the impost of this trilithon fallen forwards into the adytum and each broken in three; Barclay 1895 says the date is unknown but '
              'that a British Museum drawing (de Heere, c.1573-75) shows it was before 1574 (secondary report; the drawing was not seen). Assumed fallen in 1625.')
        s = add(**base, state1625='broken', pieces=3, fallToward=r1(face), evidence1625=ev, sources=srcs)
    elif n == 55:
        ev = ('Fallen (broken in two) in 1625, LOW confidence: Stukeley (1720s) has the south upright broken in two lying on the altar and the impost fallen on the altar "through the digging of somebody"; '
              'Aubrey (c.1666-93, quoted in Long 1876) blames the under-digging for the Duke of Buckingham in 1620 for the fall of the great stone; Barclay 1895 and Long give 1620. '
              'Aubrey wrote decades after and the exact date is not recorded, so the fall may have been after 1625; no fetched source says it was still standing in 1625.')
        s = add(**base, state1625='broken', pieces=2, fallToward=r1(face), evidence1625=ev, sources=srcs + [S_LONG])
        s['alt1625'] = 'standing but undermined (if the fall followed the 1620 digging by years)'
    else:  # 56
        ev = ('Leaning in 1625, LOW confidence (conditional on 55 having fallen): stone 56 leant over the altar against bluestone 68 in Stukeley\'s time (1720s) and until it was straightened on 19 Sep 1901 '
              '(Encyclopaedia Britannica 1911: "leaning at a dangerous angle"; Barclay 1895: fall arrested by bluestone 68). It can only have leant after its partner fell, which Aubrey ties to 1620.')
        s = add(**base, state1625='leaning', lean=20, leanToward=r1(norm(AXIS + 10)), evidence1625=ev, sources=srcs + [S_EB, S_LONG])
        s['alt1625'] = 'standing upright (if 55 was still standing in 1625)'
        s['hTenonTop'] = 6.88
    s['notes'] = TRI_NOTES[n] + ' Width/thickness derived from the above-ground weight (aspect 1.8:1, taper factor 0.9), not measured; position from the horseshoe curve model (+/-1 m).'
    if n == 56:
        s['notes'] += ' Lean magnitude (20 deg) is a placeholder; direction is toward the altar/centre (NE).'
    s['stateToday'] = {55: 'fallen', 59: 'fallen', 56: 'standing (straightened 1901)', 57: 'standing (re-erected 1958)', 58: 'standing (re-erected 1958)'}.get(n, 'standing')


for n in range(51, 61):
    tri_upright(n)

TRI_L = {152: (51, 52, 11.73, 0.7), 154: (53, 54, 17.49, 1.0), 156: (55, 56, 8.88, 0.9), 158: (57, 58, 16.56, 0.9), 160: (59, 60, 5.01, 0.8)}
for k, (a, b, wt, depth) in TRI_L.items():
    i = (k - 152) // 2
    th = TRI_THETA[i]
    az, r, face = ell_stone(HA, HB, HUC, th, 0.0)
    base = dict(id=str(k), set='trilithons', type='sarsen', role='lintel', az=r1(az), r=r1(r, 2), face=r1(face),
                w=4.9, t=1.4, h=depth, on=[str(a), str(b)], curved=False, built='standing', dressed=True, tenons=True)
    srcs = [S_SOS, S_STUK, S_BARC]
    if k in (152, 154):
        ev = 'Standing (in place) in 1625: Stukeley (1720s) records trilithons 51-52 and 53-54 with their impost entire; they have stood continuously (Stones of Stonehenge).'
        s = add(**base, state1625='standing', evidence1625=ev, sources=srcs)
        s['stateToday'] = 'standing'
    elif k == 158:
        ev = 'Standing (in place) in 1625: fell westwards with 57 and 58 on 3 Jan 1797, re-erected 1958 (Stones of Stonehenge, Barclay 1895); Stukeley (1720s) records it in place apart from chipping of its end.'
        s = add(**base, state1625='standing', evidence1625=ev, sources=srcs + [S_EB])
        s['stateToday'] = 'standing (re-erected 1958)'
    elif k == 156:
        ev = ('Fallen in 1625, LOW confidence: lies on its edge across the west end of the Altar Stone (Stones of Stonehenge); Stukeley (1720s) describes it dislodged and fallen on the altar; Aubrey attributes the fall of the great '
              'stone to the 1620 digging (Long 1876; Barclay 1895). Alternative: still on top of 55-56 in 1625.')
        s = add(**base, state1625='fallen', pieces=1, fallToward=r1(face), evidence1625=ev, sources=srcs + [S_LONG])
        s['alt1625'] = 'standing on 55 and 56 (if the Great Trilithon fell after 1625)'
        s['stateToday'] = 'fallen'
    else:
        ev = ('Fallen and broken in 1625: Stukeley (1720s) records the impost of the last trilithon fallen forwards and broken in three; Barclay 1895: before 1574 on a British Museum drawing (secondary report). '
              'Three fragments 160a-c today.')
        s = add(**base, state1625='broken', pieces=3, fallToward=r1(face), evidence1625=ev, sources=srcs)
        s['stateToday'] = 'fallen'
    s['notes'] = ('Weight above ground %.2f t (Stones of Stonehenge); length/width from lintel 156 mortise spacing (3.25 m) and Long 1876 (16-17 ft lintels); thickness/depth estimated from weight, depth not measured. '
                  'Centre of the lintel placed at the middle of the pair.' % wt)

# ================================================================ 4. BLUESTONE CIRCLE 31-49
BC_R = 11.0
# (az, r) anchors: OSM outlines (fit frame) for 31, 32, 46-49, 150; relationships/interpolation for the rest.
BC = {31: (59, 11.0, 'osm'), 32: None, 33: (112, 11.0, 'interp'), 34: (138, 11.0, 'interp'), 35: (160, 11.0, 'interp'), 36: (182, 11.0, 'interp'),
      37: (199, 10.4, 'rel'), 38: (209, 11.0, 'rel'), 39: (219, 10.4, 'rel'), 40: (228, 11.0, 'rel'), 41: (238, 11.0, 'rel'),
      42: (256, 11.0, 'interp'), 43: (272, 11.0, 'interp'), 44: (300, 11.0, 'interp'), 45: (340, 11.6, 'osm'), 46: (20, 11.1, 'osm'),
      47: (28, 11.2, 'osm'), 48: (37, 10.3, 'osm'), 49: (45, 10.9, 'osm')}
BC_H = {31: 1.88, 33: 1.68, 34: 0.97, 37: 1.27, 46: 0.96, 47: 1.45, 49: 1.9}
BC_W = {31: 2.04, 32: 1.14, 33: 0.51, 34: 0.33, 35: 0.012, 36: 0.27, 37: 0.81, 39: 0.48, 41: 0.72, 42: 0.30, 45: 0.42, 46: 0.34, 47: 1.26, 48: 0.16, 49: 1.11}


def blue_size(n, wt, h):
    if wt is None or h is None:
        return 0.8, 0.5
    area = wt / (3.0 * 0.55 * h)
    w = min(max(math.sqrt(area * 1.6), 0.5), 1.3)
    t = min(max(area / w, 0.3), 0.8)
    return round(w, 2), round(t, 2)


def bc_state(n):
    if n in BC_H:
        return 'standing'
    if n in (36,):
        return 'buried'
    if n == 35:
        return 'broken'
    wt = BC_W.get(n)
    if wt is not None and wt >= 0.7:
        return 'fallen'
    return 'stump'


BC_NOTE = {
    31: '2.04 t, 45% below ground (Field et al.).', 32: 'Underside "dished" into a sub-rectangular rebate; 1.14 t above ground; position from an OpenStreetMap outline tagged ref=32.',
    33: '0.51 t above ground, about 1.03 m below ground (Field et al. via blog); stumps 32c-e lie north of it and 33e-f about 6 m SW.',
    35: 'In two widely separated pieces 35a and 35b (0.002 t and 0.01 t above ground).',
    36: 'Lies partly buried; excavated in the 1950s it showed two mortise holes, i.e. once a lintel on two bluestone uprights, later set as a single standing stone (Stones of Stonehenge; Field et al.). Finely dressed.',
    37: 'Horn-stone: with 39 placed slightly nearer the centre than 38 (Barclay 1895).', 38: 'Flanked by horn-stones 37 and 39; no weight or height given.',
    39: 'Horn-stone, nearer the centre than 38. 0.48 t.', 40: 'Dacitic tuff; no weight or height given.', 41: '0.72 t above ground.',
    45: 'Finely dressed (Field et al.); lies at the NNW; 0.42 t.', 46: 'Horn-stone, 0.96 m high.', 47: '1.45 m high.',
    48: 'Horn-stone out of line with its neighbours and nearer the centre (Barclay 1895); 0.16 t above ground.', 49: '1.9 m high; 1.11 t above ground, 39% below ground.',
    34: '0.97 m high.', 42: '0.30 t above ground.', 43: 'No weight or height given.', 44: 'No weight or height given.'}
for n in range(31, 50):
    if n == 32:
        az, r = osm_ref['32']
        q = 'osm'
    else:
        az, r, q = BC[n]
    # OSM-anchored positions are those listed; replace by the fresh OSM ref where available
    st = bc_state(n)
    h = BC_H.get(n, 1.5 if st in ('fallen',) else (0.3 if st in ('stump', 'broken') else 0.0))
    w, t = blue_size(n, BC_W.get(n), BC_H.get(n))
    qual = {'osm': 'OSM outline, +/-0.7 m', 'rel': 'from Petrie/Barclay relationships (near sarsen 14/15), +/-10 deg', 'interp': 'interpolated between anchors, schematic, +/-20 deg'}[q]
    ev = ('%s in 1625 (assumed): this is the stone\'s present condition; Stukeley (1720s) and Wood (1740) give only group counts for the inner circle (Wood numbers 41 erect or leaning stones in all, '
          'of which about 15 would be bluestones; today about 13 bluestones stand), so the bluestone circle was already ruinous by the 1720s; no stone-by-stone 1625 record exists.' %
          {'standing': 'Standing', 'fallen': 'Fallen', 'stump': 'Stump', 'broken': 'Broken', 'buried': 'Buried'}[st])
    s = add(id=str(n), set='bluestone-circle', type='bluestone', role='upright', az=r1(az), r=r1(r), w=w, t=t, h=h, built='standing',
            state1625=st, evidence1625=ev, sources=[S_SOS, S_BARC, S_STUK, S_FIELD] + ([S_OSM] if q == 'osm' else []))
    if st in ('fallen', 'broken'):
        s['fallToward'] = r1(norm(az + 180))
    if st == 'broken':
        s['pieces'] = 2
    s['posQuality'] = qual
    s['notes'] = (BC_NOTE.get(n, '') + ' Size from weight/height where given (w x t derived assuming density 3 t/m3 and a taper factor 0.55), else typical; state classification from presence of a height (standing) or weight only (fallen/stump) on Stones of Stonehenge.').strip()
    s['stateToday'] = st

# Stumps and buried bluestones (numbered with a letter suffix), offsets from the described parent stone
parent = {n: from_xz(*to_xz(*(BC[n][:2] if n != 32 else osm_ref['32']))) for n in range(31, 50)}


def offset_from(n, dx, dz):
    pa, pr = (osm_ref['32'] if n == 32 else BC[n][:2]) if n in (32,) else BC[n][:2]
    x, z = to_xz(pa, pr)
    return from_xz(x + dx, z + dz)


STUMPS = [
    ('32c', 33, 0.0, -1.0, 'arc immediately north of 33 (~1.0 m)', 'Andesite Group A'), ('32d', 33, 0.3, -1.9, 'arc immediately north of 33 (~1.9 m)', 'Rhyolite Group C'),
    ('32e', 33, 0.7, -2.8, 'arc immediately north of 33 (~2.8 m)', 'dolerite (tentative)'),
    ('33e', 33, -4.2, 4.2, 'about 6 m SW of 33', 'Andesite Group A'), ('33f', 33, -3.5, 4.9, 'about 6 m SW of 33, beside 33e', 'Andesite Group A'),
    ('40c', 40, -2.8, -2.8, 'about 4 m NW of 40', 'Andesite Group A'), ('40g', 41, 1.1, 1.1, 'about 1.5 m SE of 41; marked at ground level by a lead cover', 'Lower Palaeozoic sandstone'),
    ('41d', 41, 2.3, -5.5, 'about 6 m NNE of 41', 'Andesite Group A'),
]
for sid, par, dx, dz, desc, lith in STUMPS:
    az, r = offset_from(par, dx, dz)
    ev = ('Buried in 1625 (completely buried stump found by excavation in the 1950s; Stones of Stonehenge, Missing Stones/Stumps pages). Whether it was a standing stone or already a stump in 1625 is unknown; '
          'its top has not been visible in the historic period.')
    add(id=sid, set='bluestone-circle', type='bluestone', role='upright', az=r1(az), r=r1(r), w=0.5, t=0.4, h=0.0, built='standing',
        state1625='buried', evidence1625=ev, sources=[S_SOS, S_SOSM], posQuality='from a written offset (%s), +/-2 m' % desc,
        notes='Buried stump, %s (%s). Position only approximate; sizes placeholders.' % (desc, lith), stateToday='buried')
az, r = offset_from(42, 0, 0)
x42, z42 = to_xz(*BC[42][:2]); x43, z43 = to_xz(*BC[43][:2])
az, r = from_xz((x42 + x43) / 2, (z42 + z43) / 2)
add(id='42c', set='bluestone-circle', type='bluestone', role='upright', az=r1(az), r=r1(r), w=0.5, t=0.4, h=0.0, built='standing', state1625='buried',
    evidence1625='Buried in 1625 (completely buried stump, excavated 1950s; Stones of Stonehenge). Date of burial unknown.', sources=[S_SOS, S_SOSM],
    posQuality='midway between 42 and 43 (both interpolated), +/-3 m', notes='Buried stump roughly midway between 42 and 43 (Lower Palaeozoic sandstone).', stateToday='buried')

# 36 and 150 are bluestone lintels (two mortises each) found lying; carry them as slabs
for s in stones:
    if s['id'] == '36':
        s['role'] = 'slab'
        s['note'] = 'bluestone lintel re-used as single stone'
az, r = osm_ref['150']
add(id='150', set='bluestone-circle', type='bluestone', role='slab', az=r1(az), r=r1(r), w=1.0, t=0.6, h=0.5, built='standing',
    state1625='fallen', fallToward=r1(norm(az + 180)), pieces=1,
    evidence1625=('Fallen, partly buried, in 1625 (assumed, low confidence): Barclay 1895 calls it the unique bluestone impost with two mortises, lying in the NE arc of the bluestone circle, fallen from a single standing position; '
                  'no earlier record of when it fell.'),
    sources=[S_SOS, S_BARC, S_FIELD, S_OSM], posQuality='OSM outline tagged ref=150, +/-0.7 m (size of the outline is only the visible part)',
    notes='Bluestone lintel (two mortise holes on one face) later reused as a single standing stone, now lying partly buried; finely dressed (Field et al.). Size is a placeholder.', stateToday='fallen')

# ================================================================ 5. BLUESTONE HORSESHOE 61-72
BHA, BHB, BHUC = 6.5, 4.7, 0.5        # bluestone horseshoe: same construction, about 1.5 m inside the trilithons (Stukeley: lesser oval 2 cubits inside the greater)
BH_STEP = 2.1
BH_TH = {n: (66.5 - n) * BH_STEP for n in range(61, 73)}
BH_H = {61: 1.75, 62: 2.03, 63: 2.11, 68: 2.49, 69: 2.59, 70: 2.34}
BH_W = {61: 0.96, 62: 1.23, 63: 1.20, 67: 1.59, 68: 2.13, 69: 2.16, 70: 1.23, 72: 1.53}
BH_STATE = {61: 'standing', 62: 'standing', 63: 'standing', 64: 'stump', 65: 'fallen', 66: 'stump', 67: 'fallen', 68: 'standing', 69: 'standing', 70: 'standing', 71: 'stump', 72: 'fallen'}
BH_NOTE = {
    61: 'Northeasternmost upstanding bluestone of the inner horseshoe; stump 61a about 2 m to one side. 0.96 t.',
    62: 'Unspotted dolerite; souvenir-hammer damage, "FB" graffito; stonehole 91 at Waun Mawn shows an imprint matching its pentagonal base (Parker Pearson, per Stones of Stonehenge). 1.23 t.',
    63: '1.20 t.', 64: 'A stump just visible in the grass.', 65: 'Core-drilled 1987 (Thorpe); standing/fallen state not stated on the source (it is not among the 6 uprights Stukeley counts).',
    66: 'Ground-level stump under the southern corner of fallen 55b; a tongue worked on one face.', 67: 'Prostrate, near the Altar Stone, larger than the others (Barclay 1895), tenon scars (reuse); 1.59 t.',
    68: 'Long worked groove down its northern face; the leaning stone 56 rests against it (Barclay 1895); 2.13 t, 33-40% below ground.',
    69: 'Tenon scars (reuse); close to stone 57; 2.16 t, heaviest of the horseshoe.', 70: '1.23 t; stumps 70a, 70b lie NNE of it.',
    71: 'Stump buried in the turf at the edge of 59a.', 72: 'Prostrate (assumed); tenon scars (reuse); 1.53 t.'}
for n in range(61, 73):
    az, r, face = ell_stone(BHA, BHB, BHUC, BH_TH[n], 0.0)
    st = BH_STATE[n]
    h = BH_H.get(n, 1.8 if st == 'fallen' else 0.2)
    w, t = blue_size(n, BH_W.get(n), BH_H.get(n))
    ev = ('%s in 1625 (assumed as in the 1720s): Stukeley (1720s) counts only 6 stones of the inner oval "remaining upright", stumps of two on the south side by the altar, one lying behind the altar, '
          'one or two thrown down by the fall of the upright of the trilithon on the right of the entrance, and a stump of another by the upright still standing there. The stones standing today (61, 62, 63, 68, 69, 70) '
          'are exactly six. The individual identification of the fallen/stump stones (64-67, 71, 72) is my reading of Stukeley\'s positions and the Stones of Stonehenge notes, not a stated mapping.' %
          {'standing': 'Standing', 'fallen': 'Fallen', 'stump': 'Stump'}[st])
    s = add(id=str(n), set='bluestone-horseshoe', type='bluestone', role='upright', az=r1(az), r=r1(r, 2), face=r1(face), w=w, t=t, h=h, built='standing',
            state1625=st, evidence1625=ev, sources=[S_SOS, S_STUK, S_BARC, S_FIELD],
            posQuality='curve model, 12 stones evenly spaced 2.1 m apart along an oval 1.5 m inside the trilithons; checked against the relationships in the sources (66 under 55b, 68 against 56, 69 by 57, 71 by 59a), +/-1 m',
            notes=BH_NOTE[n] + ' Size from weight/height where given, else typical.', stateToday=st)
    if st == 'fallen':
        s['fallToward'] = r1(norm(az + 180 if n != 72 else face))
        s['fallToward'] = r1(norm(face + 180))
    if n == 64 or n == 66 or n == 71:
        s['h'] = 0.2
# 61a, 70a, 70b
az61, r61, f61 = ell_stone(BHA, BHB, BHUC, BH_TH[61], 0.0)
x, z = to_xz(az61, r61)
a, r = from_xz(x + 2.0 * math.sin(math.radians(320)), z - 2.0 * math.cos(math.radians(320)))
add(id='61a', set='bluestone-horseshoe', type='bluestone', role='upright', az=r1(a), r=r1(r), w=0.5, t=0.4, h=0.1, built='standing', state1625='stump',
    evidence1625='Stump barely emerging from ground level (Stones of Stonehenge); a stump in 1625 is assumed.', sources=[S_SOS], posQuality='about 2 m to the "right" of 61 (direction ambiguous), +/-2 m',
    notes='Spotted dolerite (ungrouped) stump beside 61.', stateToday='stump')
az70, r70, f70 = ell_stone(BHA, BHB, BHUC, BH_TH[70], 0.0)
x, z = to_xz(az70, r70)
for sid, d in (('70a', 1.5), ('70b', 3.0)):
    a, r = from_xz(x + d * math.sin(math.radians(22.5)), z - d * math.cos(math.radians(22.5)))
    add(id=sid, set='bluestone-horseshoe', type='bluestone', role='upright', az=r1(a), r=r1(r), w=0.5, t=0.4, h=0.0, built='standing', state1625='buried',
        evidence1625='Buried in 1625 (completely buried stump found by excavation, Stones of Stonehenge Missing Stones/Stumps page).', sources=[S_SOS, S_SOSM],
        posQuality='%.1f m NNE of 70, +/-1.5 m' % d, notes='Buried stump (spotted dolerite, ungrouped).', stateToday='buried')

# ================================================================ 6. ALTAR, STATIONS, SLAUGHTER, HEEL, 97
az, r = osm_ref['80']
add(id='80', set='altar', type='altar', role='slab', az=r1(az), r=r1(r), w=4.9, t=1.0, h=0.5, face=40, built='lying',
    state1625='broken', pieces=3,
    evidence1625=('Broken (2-3 pieces) under the fallen Great Trilithon in 1625, LOW confidence (tied to the date of the 55/156 fall): Stukeley (5 July 1723) found it a cubit thick, "broken in two or three pieces by the ponderous mass of the impost and '
                  'one upright" (quoted in Long 1876); the Altar Stone is in two pieces under 55b and 156 today (Stones of Stonehenge). If the Great Trilithon was still standing in 1625 it lay whole.'),
    alt1625='lying whole and uncovered (if 55 and 156 had not yet fallen)', sources=[S_SOS, S_STUK, S_LONG, S_BARC, S_OSM],
    posQuality='OSM outline of the visible part (centroid), +/-0.7 m; length axis set to bearing 130 (80 deg to the axis) from Stones of Stonehenge',
    notes=('Lies nearly flush with the ground, long axis at 80 deg to the solstitial axis, pointing to winter-solstice sunrise (about 130/310 deg). About 4.9 m x 1.0 m x 0.5 m (monument researcher; Barclay 15-17 ft long, Stukeley a cubit thick). '
           'Original posture (flat or upright) is not established. The west end is buried beneath 156 so the centroid of the visible part is biased east.'), stateToday='broken')
for n, key in ((91, '91'), (93, '93'), (92, '92'), (94, '94')):
    az, r = osm_ref[key]
    if n == 91:
        add(id='91', set='station', type='sarsen', role='outlier', az=r1(az), r=r1(r), w=1.3, t=0.9, h=1.3, built='standing', state1625='leaning', lean=15,
            leanToward=r1(az), fallToward=None,
            evidence1625=('Leaning/standing in 1625 (assumed as in 1771): Stukeley (1720s) describes the two stones within the vallum - one stands, the other leans a little; Dr John Smith (1771) says the eastern one "leans very much towards the ditch"; '
                          'it has since fallen eastwards (Barclay 1895). No 1625 record.'),
            sources=[S_SOS, S_STUK, S_BARC, S_OSM], posQuality='OSM outline, +/-0.7 m',
            notes='Eastern Station Stone, 2.78 t above ground, now fallen. Lean magnitude is a placeholder; dimensions typical (the source gives no height).', stateToday='fallen')
    elif n == 93:
        add(id='93', set='station', type='sarsen', role='outlier', az=r1(az), r=r1(r), w=1.1, t=0.8, h=1.22, built='standing', state1625='standing',
            evidence1625='Standing in 1625 (assumed): in situ in the 1720s (Stukeley: one of the two stones stands) and today (Barclay 1895: "in situ").', sources=[S_SOS, S_STUK, S_BARC, S_OSM],
            posQuality='OSM outline, +/-0.7 m', notes='Western Station Stone, 1.22 m high, 1.34 t above ground.', stateToday='standing')
    else:
        add(id=str(n), set='station', type='sarsen', role='outlier', az=r1(az), r=r1(r), w=1.2, t=0.8, h=1.3, built='standing', state1625='missing', hypothetical=True,
            evidence1625=('Missing in 1625 (assumed): only a mound with a cup-like depression remains (Barclay 1895: mounds and stones alternate); Stukeley (1720s) records just two stones within the vallum. '
                          'Whether a stone stood on this mound in 1625 is unknown. The position is the modern marker (OSM %s).' % ('location approximated' if n == 92 else 'plaque')),
            sources=[S_SOS, S_SOSM, S_STUK, S_BARC, S_OSM], posQuality='modern marker/OSM plaque, %s' % ('flagged "location approximated", +/-3 m' if n == 92 else '+/-1.5 m'),
            notes='Station Stone %d: missing; positions on the North and South barrows are marked by modern stone and steel markers. Size is a placeholder.' % n, stateToday='missing')
az, r = osm_ref['95']
add(id='95', set='slaughter', type='sarsen', role='outlier', az=r1(az), r=r1(r), w=2.1, t=1.1, h=6.1, face=r1(norm(AXIS + 90)), built='standing',
    state1625='fallen', fallToward=r1(norm(AXIS + 180)), pieces=1,
    evidence1625=('Lying flat in 1625 (assumed, LOW confidence): Stukeley (1720s) describes a very large stone "at present flat on the ground" just inside the ditch at the entrance, over 20 ft long and near 7 ft broad, thrown down '
                  'perhaps by digging; Stones of Stonehenge and EH say it once stood upright with its NE end planted. No earlier record of when it fell.'),
    sources=[S_SOS, S_STUK, S_EHD, S_BARC, S_OSM], posQuality='OSM outline centroid, +/-0.7 m; orientation along the axis',
    notes=('Lies prone on the axis (long axis bearing about 50 deg), about 6.1 m long (outline; Stukeley "above 20 foot", Wikipedia 4.9 m), 2.1 m wide. When standing, the NE end was in the ground, so the stone fell toward the SW. '
           'h is the length of the stone (standing height above ground not known).'), stateToday='fallen')
az, r = osm_ref['96']
add(id='96', set='heel', type='sarsen', role='outlier', az=r1(az), r=r1(r), w=2.7, t=2.1, h=4.6, built='standing', state1625='standing',
    evidence1625=('Standing in 1625 (assumed): Stukeley (1720s) says it is still standing in its original posture in the avenue; Barclay 1895: no reason to believe it has shifted, apparently inclined with its apex above the side nearest the temple; '
                  'Aubrey (c.1666-93) and the name "Friar\'s Heel" later transferred to it (Burl). No fall recorded.'),
    sources=[S_SOS, S_STUK, S_BARC, S_WIKI, S_OSM], posQuality='OSM outline centroid, +/-0.7 m (distance 77.5 m agrees with 77.4 m in the monument notes)',
    notes='Unworked sarsen, 4.57 m above ground (Stones of Stonehenge; Wikipedia 4.9 m), about 30 t above ground; leans slightly toward the circle (not modelled). Fractionally east of the axis.', stateToday='standing')
az, r = osm_ref['97']
add(id='97', set='heel-companion', type='sarsen', role='outlier', az=r1(az), r=r1(r), w=1.8, t=1.2, h=3.0, built='standing', state1625='missing', hypothetical=True,
    evidence1625=('Missing in 1625: only stonehole 97 (found beside the Heel Stone in 1979) is known; no stone is recorded there by Stukeley (1720s) or later; whether a stone stood here is a hypothesis of the monument researcher (Darvill). '
                  'Position is the OpenStreetMap plaque flagged "location approximated".'),
    sources=[S_WIKI, S_OSM, S_EHS], posQuality='OSM plaque "Stone Hole 97", flagged approximated, +/-3 m',
    notes='Hypothetical companion stone to the Heel Stone; size entirely a placeholder (similar to the Heel Stone class). See monument.md for two scenarios (96 added 2 m SE of 97, or 97 moved to 96).', stateToday='missing')


# ---------------------------------------------------------------- finalise
def sortkey(s):
    i = s['id']
    num = int(''.join(ch for ch in i if ch.isdigit()))
    return (num, i)


def _xz(s):
    a = math.radians(s['az'])
    return (s['r'] * math.sin(a), -s['r'] * math.cos(a))


for s in stones:
    if s['id'][-1].isalpha():
        for _ in range(40):
            moved = False
            for o in stones:
                if o is s or o['role'] == 'lintel' or o['state1625'] == 'missing':
                    continue
                (x1, z1), (x2, z2) = _xz(s), _xz(o)
                d = math.hypot(x1 - x2, z1 - z2)
                need = 0.8 * (s['w'] + o['w']) / 2 + 0.05
                if d <= need:
                    dx, dz = (x1 - x2, z1 - z2) if d > 1e-6 else (1.0, 0.0)
                    k = (need + 0.1) / max(d, 1e-6)
                    nx, nz = x2 + dx * k, z2 + dz * k
                    s['az'], s['r'] = r1(from_xz(nx, nz)[0]), r1(from_xz(nx, nz)[1])
                    s['posQuality'] = s.get('posQuality', '') + '; nudged <=1.5 m to keep clear of neighbour %s' % o['id']
                    moved = True
            if not moved:
                break
for s in stones:
    if 'stateToday' not in s:
        if s['set'] == 'sarsen-circle':
            s['stateToday'] = {22: 'standing (re-erected 1950s)', 23: 'standing (re-erected after the 1963 fall)', 6: 'standing (straightened 1919-20)', 7: 'standing (straightened 1919-20)'}.get(int(s['id']), 'standing')
        elif s['set'] == 'sarsen-lintels':
            k = int(s['id'])
            s['stateToday'] = 'standing (re-erected 1950s)' if k == 122 else ('standing' if k in IN_SITU else ('broken' if k in FALLEN_L else 'missing'))
        else:
            s['stateToday'] = s['state1625']
stones.sort(key=sortkey)
out_order = ['id', 'set', 'type', 'role', 'az', 'r', 'w', 't', 'h', 'face', 'on', 'curved', 'built', 'hypothetical', 'state1625', 'fallToward', 'pieces', 'lean', 'leanToward',
             'alt1625', 'evidence1625', 'dressed', 'tenons', 'hTenonTop', 'posQuality', 'stateToday', 'notes', 'sources']
final = []
for s in stones:
    s.setdefault('hypothetical', False)
    o = {k: s[k] for k in out_order if k in s}
    for k in s:
        if k not in o and k not in ('note',):
            o[k] = s[k]
    final.append(o)

lat_c = LAT0 - CENTRE_XZ[1] / KY
lon_c = LON0 + CENTRE_XZ[0] / KX
doc = {
    '_meta': {
        'description': 'Stone-by-stone catalogue of Stonehenge (Petrie numbering). Positions: az = degrees clockwise from TRUE north, r = metres, both measured from the FITTED centre of the sarsen circle (not the provisional site origin). '
                       'Sizes: w tangential width, t radial thickness, h height above ground (lintels: vertical depth; fallen stones: height when standing). state1625 reasoned backwards from Stukeley (1720s), Wood (1740), Barclay 1895 and dated 19th-20th century events.',
        'centre': {'lat': round(lat_c, 7), 'lon': round(lon_c, 7), 'offsetFromProvisionalOriginM': {'x_east': CENTRE_XZ[0], 'z_south': CENTRE_XZ[1]}, 'errorM': 0.7,
                   'note': 'Fitted from OpenStreetMap stone outlines (sarsen ring, bluestone ring, Station Stones, Heel Stone); move the landmark anchor here or add this offset.'},
        'axisAzimuthDeg': AXIS,
        'numbering': 'Petrie 1880: sarsen uprights 1-30 clockwise from the axis (stone 1 just east of it); lintel k = 100 + number of the higher (western, clockwise) of the two uprights it spans, so 102 is on 1-2 and 101 on 30-1; trilithons 51-60 clockwise from the NE-east end; bluestone circle 31-49; horseshoe 61-72.',
        'generated': 'research/stonehenge/stones-check/build_stones.py',
        'counts': {},
    },
    'stones': final,
}
cnt = {}
for s in final:
    cnt.setdefault(s['set'], {}).setdefault(s['state1625'], 0)
    cnt[s['set']][s['state1625']] += 1
doc['_meta']['counts'] = cnt
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(doc, open(OUT, 'w'), indent=1, ensure_ascii=False)
print('wrote', OUT, len(final), 'entries')

# per-stone table
with open(TABLE, 'w') as f:
    f.write('| id | set | role | az | r | w x t x h | built | 1625 state | today | hypothetical | position quality |\n|---|---|---|---|---|---|---|---|---|---|---|\n')
    for s in final:
        extra = ''
        if 'lean' in s:
            extra = ' (lean %s toward %s)' % (s['lean'], s.get('leanToward'))
        if 'fallToward' in s:
            extra += ' (toward %s%s)' % (s['fallToward'], ', %s pcs' % s['pieces'] if 'pieces' in s else '')
        f.write('| %s | %s | %s | %s | %s | %s x %s x %s | %s | %s%s | %s | %s | %s |\n' % (
            s['id'], s['set'], s['role'], s['az'], s['r'], s['w'], s['t'], s['h'], s['built'], s['state1625'], extra, s.get('stateToday', ''), 'yes' if s['hypothetical'] else '', s.get('posQuality', 'ideal ring geometry (Petrie 30-fold), +/-0.5 m' if s['set'] in ('sarsen-circle', 'sarsen-lintels') else 'horseshoe curve model, +/-1 m' if s['set'] == 'trilithons' else '')))
print(json.dumps(cnt))
