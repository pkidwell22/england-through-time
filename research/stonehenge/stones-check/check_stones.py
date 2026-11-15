#!/usr/bin/env python3
"""Validate data/locations/stonehenge/stones.json. Run: python3 -I check_stones.py"""
import json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
doc = json.load(open(os.path.join(P, 'data', 'locations', 'stonehenge', 'stones.json')))
S = doc['stones']
by = {s['id']: s for s in S}
errs = []
REQ = ['id', 'set', 'type', 'role', 'az', 'r', 'w', 't', 'h', 'built', 'hypothetical', 'state1625', 'evidence1625', 'notes', 'sources']
SETS = {'sarsen-circle', 'sarsen-lintels', 'trilithons', 'bluestone-circle', 'bluestone-horseshoe', 'altar', 'station', 'slaughter', 'heel', 'heel-companion'}
STATES = {'standing', 'leaning', 'fallen', 'broken', 'stump', 'buried', 'missing'}
if len(by) != len(S):
    errs.append('duplicate ids')
for s in S:
    for k in REQ:
        if k not in s:
            errs.append('%s: missing field %s' % (s['id'], k))
    if s['set'] not in SETS: errs.append('%s: bad set' % s['id'])
    if s['state1625'] not in STATES: errs.append('%s: bad state1625 %s' % (s['id'], s['state1625']))
    if s['role'] not in ('upright', 'lintel', 'outlier', 'slab'): errs.append('%s: bad role' % s['id'])
    if s['type'] not in ('sarsen', 'bluestone', 'altar'): errs.append('%s: bad type' % s['id'])
    if s['state1625'] == 'leaning' and ('lean' not in s or 'leanToward' not in s): errs.append('%s: leaning without lean/leanToward' % s['id'])
    if s['state1625'] in ('fallen', 'broken') and 'fallToward' not in s and s['type'] != 'altar': errs.append('%s: fallen without fallToward' % s['id'])
    if s['role'] == 'lintel':
        if not s.get('on'): errs.append('%s: lintel without on' % s['id'])
        for u in s.get('on', []):
            if u not in by: errs.append('%s: lintel rests on missing id %s' % (s['id'], u))
            elif by[u]['role'] != 'upright': errs.append('%s: on non-upright %s' % (s['id'], u))
srcs = json.load(open(os.path.join(P, 'research', 'stonehenge', 'sources-stones.json')))
for s in S:
    for src in s['sources']:
        if src not in srcs: errs.append('%s: unknown source %s' % (s['id'], src))
for s in S:
    if s['set'] == 'sarsen-circle' and not (14.5 <= s['r'] <= 17): errs.append('%s: r=%s outside 14.5-17' % (s['id'], s['r']))
for n in range(1, 31):
    if str(n) not in by: errs.append('missing upright %d' % n)
    if str(100 + n) not in by: errs.append('missing lintel %d' % (100 + n))
for n in list(range(51, 61)) + [152, 154, 156, 158, 160] + list(range(31, 50)) + list(range(61, 73)) + [80, 91, 92, 93, 94, 95, 96, 97, 150]:
    if str(n) not in by: errs.append('missing id %d' % n)
for k in range(101, 131):
    hi = k - 100
    lo = 30 if hi == 1 else hi - 1
    if by[str(k)]['on'] != [str(lo), str(hi)]: errs.append('lintel %d on %s expected %s' % (k, by[str(k)]['on'], [lo, hi]))


def xz(s):
    a = math.radians(s['az'])
    return (s['r'] * math.sin(a), -s['r'] * math.cos(a))


tri = [by[str(n)] for n in range(51, 61)]
cx = sum(xz(s)[0] for s in tri) / 10
cz = sum(xz(s)[1] for s in tri) / 10
opening = (math.degrees(math.atan2(cx, -cz)) + 180) % 360
if not (35 <= opening <= 65): errs.append('horseshoe opening az %.1f not NE' % opening)
# bluestone horseshoe opening too
bh = [by[str(n)] for n in range(61, 73)]
bx = sum(xz(s)[0] for s in bh) / 12
bz = sum(xz(s)[1] for s in bh) / 12
bopen = (math.degrees(math.atan2(bx, -bz)) + 180) % 360
if not (35 <= bopen <= 65): errs.append('bluestone horseshoe opening az %.1f not NE' % bopen)
# overlap check among all non-lintel entries (centre distance > 0.8 x mean width); lying stones use width only, as specified
pts = [s for s in S if s['role'] != 'lintel']
viol = []
for i in range(len(pts)):
    for j in range(i + 1, len(pts)):
        a, b = pts[i], pts[j]
        (x1, z1), (x2, z2) = xz(a), xz(b)
        d = math.hypot(x1 - x2, z1 - z2)
        mw = (a['w'] + b['w']) / 2
        if d <= 0.8 * mw:
            viol.append((a['id'], b['id'], round(d, 2), round(0.8 * mw, 2)))
if viol: errs.append('overlaps: %s' % viol)
cnt = {}
for s in S:
    cnt.setdefault(s['set'], {}).setdefault(s['state1625'], 0)
    cnt[s['set']][s['state1625']] += 1
tot = {}
for s in S: tot[s['state1625']] = tot.get(s['state1625'], 0) + 1
print('entries:', len(S))
for k, v in cnt.items(): print(' %-20s %s' % (k, v))
print('by 1625 state:', tot)
print('hypothetical:', sum(1 for s in S if s['hypothetical']))
print('trilithon horseshoe opening az %.1f ; bluestone horseshoe opening az %.1f' % (opening, bopen))
print('sarsen circle r range: %.1f-%.1f' % (min(s['r'] for s in S if s['set'] == 'sarsen-circle'), max(s['r'] for s in S if s['set'] == 'sarsen-circle')))
print('overlap violations:', len(viol))
if errs:
    print('FAIL')
    for e in errs: print(' -', e)
    sys.exit(1)
print('OK')
