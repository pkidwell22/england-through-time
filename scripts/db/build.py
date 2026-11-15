#!/usr/bin/env python3
"""Build data/db/history.sqlite (and history.sql) from the JSON under data/.

The JSON is the source of truth; this script only mirrors it. It is safe to
re-run at any time: it builds into a temporary file and atomically renames it
over the old database, tolerates missing optional files, and reports (rather
than crashes on) files that fail to parse or rows that break a constraint.

    python3 scripts/db/build.py                  # full build
    python3 scripts/db/build.py --only london    # one location (separate output file)
    python3 scripts/db/build.py --out /tmp/h.sqlite

Standard library only. It never touches curated.sqlite.
"""
import argparse
import collections
import datetime
import hashlib
import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(ROOT, "data")
SCHEMA = os.path.join(HERE, "schema.sql")

EVIDENCE = {"attested-standing", "attested-excavated", "attested-documentary",
            "attested-pictorial", "reconstructed", "conjectural"}
PLACE_KINDS = {"city", "town", "port", "fort", "hillfort", "monument", "monastery",
               "cathedral", "castle", "palace", "battle", "mine", "other"}
LINE_KINDS = {"roman-road", "road", "frontier-wall", "dyke", "river-route", "border"}
POLITY_KINDS = {"people", "province", "kingdom", "principality", "earldom", "march", "realm"}

# Column names that must hold historical years (int, never 0).
YEAR_COLS = {"year", "year_from", "year_to", "year_built", "gone_by", "timeline_start",
             "timeline_end", "initial_year", "preset_year", "grow_from", "grow_to",
             "decline_from", "decline_to", "period_from", "period_to"}


def astro(y):
    if y is None or isinstance(y, bool) or not isinstance(y, (int, float)):
        return None
    return y + 1 if y < 0 else y


def jtxt(v):
    return None if v is None else json.dumps(v, ensure_ascii=False, sort_keys=False)


def b01(v):
    return None if v is None else (1 if v else 0)


class Builder:
    def __init__(self, conn, only):
        self.c = conn
        self.only = only
        self.n_issue = collections.Counter()
        self.files = {}            # rel -> status string
        self.sources = set()
        self.locations = set()
        self.loc_file = {}         # loc id -> site.json rel
        self.rejected = collections.Counter()  # table -> rows rejected
        self.sp = 0

    # ---- issues -----------------------------------------------------------
    def issue(self, severity, category, file, etype, eid, reason, detail=None):
        self.n_issue[(severity, category)] += 1
        self.c.execute(
            "INSERT INTO load_issue(severity,category,file,entity_type,entity_id,reason,detail)"
            " VALUES (?,?,?,?,?,?,?)",
            (severity, category, file, etype, eid, reason,
             None if detail is None else (detail if isinstance(detail, str)
                                          else json.dumps(detail, ensure_ascii=False, default=str)[:4000])))

    # ---- guarded insert ---------------------------------------------------
    def ins(self, table, row, file, etype=None, eid=None):
        """Insert one row; on any constraint failure roll back just that row and log it."""
        for k in YEAR_COLS & row.keys():
            v = row[k]
            if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float))
                                  or (isinstance(v, float) and v != int(v))):
                self.rejected[table] += 1
                self.issue("error", "constraint", file, etype or table, eid,
                           "%s.%s is not a whole-number year: %r" % (table, k, v), row)
                return False
        cols = list(row.keys())
        sql = "INSERT INTO %s (%s) VALUES (%s)" % (table, ",".join(cols), ",".join("?" * len(cols)))
        self.sp += 1
        name = "sp%d" % self.sp
        self.c.execute("SAVEPOINT " + name)
        try:
            self.c.execute(sql, [row[k] for k in cols])
        except (sqlite3.IntegrityError, sqlite3.InterfaceError, sqlite3.OperationalError) as e:
            self.c.execute("ROLLBACK TO " + name)
            self.c.execute("RELEASE " + name)
            self.rejected[table] += 1
            self.issue("error", "constraint", file, etype or table, eid, "%s: %s" % (table, e), row)
            return False
        self.c.execute("RELEASE " + name)
        return True

    def cite(self, etype, eid, loc, srcs, file, role=""):
        if srcs is None:
            return
        if not isinstance(srcs, list):
            self.issue("error", "schema", file, etype, eid, "sources is not a list", srcs)
            return
        seen, missing = set(), []
        for i, sid in enumerate(srcs):
            if not isinstance(sid, str):
                self.issue("error", "schema", file, etype, eid, "non-string source id %r" % (sid,))
                continue
            if sid in seen:
                self.issue("warning", "duplicate", file, etype, eid, "source %s listed twice" % sid)
                continue
            seen.add(sid)
            if sid not in self.sources:
                missing.append(sid)
                self.c.execute("INSERT OR IGNORE INTO dangling_citation VALUES (?,?,?,?,?)",
                               (etype, eid, sid, loc, file))
                continue
            self.ins("citation", dict(entity_type=etype, entity_id=eid, source_id=sid, role=role,
                                      location_id=loc, seq=i), file, etype, eid)
        if missing:
            self.issue("warning", "dangling_source", file, etype, eid,
                       "cites source id(s) defined nowhere: " + ", ".join(missing), missing)

    def years_ordered(self, file, etype, eid, a, b, what):
        if a is not None and b is not None and astro(a) is not None and astro(b) is not None and astro(b) < astro(a):
            self.issue("warning", "year-order", file, etype, eid, "%s ends before it starts (%s > %s)" % (what, a, b))

    def enum(self, file, etype, eid, field, val, allowed):
        if val not in allowed:
            self.issue("warning", "enum", file, etype, eid,
                       "%s=%r not in the documented set %s" % (field, val, sorted(allowed)))


# ---------------------------------------------------------------------------
# file discovery
# ---------------------------------------------------------------------------

def classify(rel):
    """Return (handler, location_dir) for a path relative to data/, or None if unrecognised."""
    parts = rel.split("/")
    name = parts[-1]
    if rel == "sources.json":
        return ("sources", "global")
    if rel == "assets.json":
        return ("assets", None)
    if rel == "models.json":
        return ("models", None)
    if len(parts) == 2 and parts[0] == "national":
        scope = "national"
    elif len(parts) == 3 and parts[0] == "locations":
        scope = parts[1]
    else:
        return None
    stem = name[:-5]
    table = (("site", "site"), ("terrain", "terrain"), ("eras", "eras"), ("events", "events"),
             ("stones", "stones"))
    for key, h in table:
        if stem == key:
            return (h, scope)
    for prefix, h in (("places", "places"), ("lines", "lines"), ("polities", "polities"),
                      ("landmarks", "landmarks"), ("zones", "zones"), ("episodes", "episodes"),
                      ("sources", "sources")):
        if stem == prefix or stem.startswith(prefix + "-"):
            return (h, scope)
    return None


def discover():
    out = []
    for dp, dn, fn in os.walk(DATA):
        dn[:] = sorted(d for d in dn if d != "db")
        for f in sorted(fn):
            if f.endswith(".json"):
                out.append(os.path.relpath(os.path.join(dp, f), DATA).replace(os.sep, "/"))
    return sorted(out)


# ---------------------------------------------------------------------------
# loaders
# ---------------------------------------------------------------------------

def load_site(b, rel, scope, d):
    kind = "national" if scope == "national" else "site"
    lid = d.get("id") if kind == "national" else scope
    if not isinstance(lid, str):
        lid = "england-wales" if kind == "national" else scope
    if kind == "site" and d.get("id") not in (None, scope):
        b.issue("warning", "schema", rel, "location", scope, "site.json id %r differs from folder name" % d.get("id"))
    bounds = d.get("bounds") or {}
    tl = d.get("timeline") or {}
    origin = d.get("origin") or {}
    cfg = {k: v for k, v in d.items() if k not in ("id", "name", "subtitle", "scopeNote", "origin", "bounds", "timeline")}
    if kind == "national":
        wood = cfg.get("woodland")
        if isinstance(wood, dict):
            cfg["woodland"] = {k: v for k, v in wood.items() if k not in ("cover", "sources")}
    else:
        wood = cfg.get("woodland")
        if isinstance(wood, dict):
            cfg["woodland"] = {k: v for k, v in wood.items() if k not in ("cover", "sources")}
    row = dict(id=lid, name=d.get("name"), kind=kind, subtitle=d.get("subtitle"), scope_note=d.get("scopeNote"),
               origin_lat=origin.get("lat"), origin_lon=origin.get("lon"), origin_note=origin.get("note"),
               lat_min=bounds.get("latMin"), lat_max=bounds.get("latMax"), lon_min=bounds.get("lonMin"), lon_max=bounds.get("lonMax"),
               x_min=bounds.get("xMin"), x_max=bounds.get("xMax"), z_min=bounds.get("zMin"), z_max=bounds.get("zMax"),
               timeline_start=tl.get("start"), timeline_end=tl.get("end"), initial_year=tl.get("initialYear"),
               timeline_scale=jtxt(tl.get("scale")), config_json=jtxt(cfg), origin_file=rel)
    if b.ins("location", row, rel, "location", lid):
        b.locations.add(lid)
        b.loc_file[lid] = rel
    return lid


def ensure_location(b, scope, rel_hint):
    lid = "england-wales" if scope == "national" else scope
    if scope == "national":
        for l, f in b.loc_file.items():
            if f.startswith("national/"):
                return l
    if lid in b.locations:
        return lid
    b.issue("warning", "missing", rel_hint, "location", lid,
            "no usable site.json for %s: created a placeholder location row so its other files can load" % scope)
    b.ins("location", dict(id=lid, name=lid, kind="national" if scope == "national" else "site",
                           origin_file=None), rel_hint, "location", lid)
    b.locations.add(lid)
    return lid


def load_sources(b, rel, scope, d):
    if not isinstance(d, dict):
        b.issue("error", "schema", rel, "source", None, "sources file is not an object")
        return
    for sid, s in d.items():
        if not isinstance(s, dict):
            b.issue("error", "schema", rel, "source", sid, "source entry is not an object", s)
            continue
        if sid in b.sources:
            prev = b.c.execute("SELECT title,publisher,url,origin_file FROM source WHERE id=?", (sid,)).fetchone()
            same = prev and prev[:3] == (s.get("title"), s.get("publisher"), s.get("url"))
            b.issue("warning", "duplicate", rel, "source", sid,
                    "source id also defined in %s%s" % (prev[3] if prev else "?", "" if same else " with DIFFERENT content (first definition kept)"))
            continue
        if b.ins("source", dict(id=sid, title=s.get("title"), publisher=s.get("publisher"), url=s.get("url"),
                                scope=scope, origin_file=rel), rel, "source", sid):
            b.sources.add(sid)
        if not s.get("title") and not s.get("url"):
            b.issue("warning", "schema", rel, "source", sid, "source has neither title nor url")


def load_eras(b, rel, lid, d):
    for i, e in enumerate(d):
        try:
            eid = "%s/%s" % (lid, e.get("id"))
            b.ins("era", dict(id=eid, location_id=lid, local_id=e.get("id"), name=e.get("name"),
                              year_from=e.get("from"), year_to=e.get("to"), preset_year=e.get("presetYear"),
                              blurb=e.get("blurb"), origin_file=rel, origin_path="$[%d]" % i), rel, "era", eid)
            b.years_ordered(rel, "era", eid, e.get("from"), e.get("to"), "era")
        except Exception as ex:
            b.issue("error", "schema", rel, "era", None, repr(ex), e)


def load_events(b, rel, lid, d):
    per_year = collections.Counter()
    for i, e in enumerate(d):
        try:
            y = e.get("year")
            n = per_year[y]
            per_year[y] += 1
            eid = "%s/%s#%d" % (lid, y, n)
            if b.ins("event", dict(id=eid, location_id=lid, seq=i, year=y, label=e.get("label"), note=e.get("note"),
                                   origin_file=rel, origin_path="$[%d]" % i), rel, "event", eid):
                b.cite("event", eid, lid, e.get("sources"), rel)
        except Exception as ex:
            b.issue("error", "schema", rel, "event", None, repr(ex), e)


def load_landmarks(b, rel, lid, d):
    for i, l in enumerate(d):
        try:
            lm_id = "%s/%s" % (lid, l.get("id"))
            path = l.get("path")
            row = dict(id=lm_id, location_id=lid, local_id=l.get("id"), name=l.get("name"), lat=l.get("lat"), lon=l.get("lon"),
                       bearing=l.get("bearing"), tier=l.get("tier"), evidence=l.get("evidence"), confidence=l.get("confidence"),
                       summary=l.get("summary"), uncertainty=l.get("uncertainty"), has_path=1 if path else 0,
                       origin_file=rel, origin_path="$[%d]" % i)
            if not b.ins("landmark", row, rel, "landmark", lm_id):
                continue
            for k, pt in enumerate(path or []):
                b.ins("landmark_path_point", dict(landmark_id=lm_id, seq=k, lat=pt[0], lon=pt[1]), rel, "landmark", lm_id)
            for k, p in enumerate(l.get("phases") or []):
                m = dict(p.get("model") or {})
                mk = m.pop("kind", None)
                b.ins("landmark_phase", dict(
                    landmark_id=lm_id, seq=k, label=p.get("label"), year_from=p.get("from"), year_built=p.get("built"),
                    year_to=p.get("to"), end_kind=p.get("end"), gone_by=p.get("goneBy"), continues=1 if p.get("continues") else 0,
                    date_note=p.get("dateNote"), model_kind=mk, model_params=jtxt(m) if m else None,
                    origin_path="$[%d].phases[%d]" % (i, k)), rel, "landmark_phase", "%s#%d" % (lm_id, k))
                b.years_ordered(rel, "landmark", lm_id, p.get("from"), p.get("built"), "phase %d construction" % k)
                b.years_ordered(rel, "landmark", lm_id, p.get("built") or p.get("from"), p.get("to"), "phase %d" % k)
            b.cite("landmark", lm_id, lid, l.get("sources"), rel)
        except Exception as ex:
            b.issue("error", "schema", rel, "landmark", str(l.get("id")) if isinstance(l, dict) else None, repr(ex))


def load_zones(b, rel, lid, d):
    for i, z in enumerate(d):
        try:
            zid = "%s/%s" % (lid, z.get("id"))
            sh = z.get("shape") or {}
            gr = z.get("grow") or [None, None]
            dc = z.get("decline") or [None, None]
            ok = b.ins("zone", dict(
                id=zid, location_id=lid, local_id=z.get("id"), label=z.get("label"), style=z.get("style"),
                shape_type=sh.get("type"), shape=jtxt(sh), spacing=z.get("spacing"), fill=z.get("fill"), band=z.get("band"),
                tier=z.get("tier"), grow_from=gr[0], grow_to=gr[1], decline_from=dc[0], decline_to=dc[1],
                decline_by=z.get("declineBy"), grid_bearing=z.get("gridBearing"), preexisting=b01(z.get("preexisting")),
                evidence=z.get("evidence"), confidence=z.get("confidence"), note=z.get("note"),
                origin_file=rel, origin_path="$[%d]" % i), rel, "zone", zid)
            if ok:
                b.years_ordered(rel, "zone", zid, gr[0], gr[1], "growth")
                b.years_ordered(rel, "zone", zid, dc[0], dc[1], "decline")
                b.cite("zone", zid, lid, z.get("sources"), rel)
        except Exception as ex:
            b.issue("error", "schema", rel, "zone", None, repr(ex), z)


def load_episodes(b, rel, lid, d):
    for i, e in enumerate(d):
        try:
            eid = "%s/%s" % (lid, e.get("id"))
            ok = b.ins("episode", dict(
                id=eid, location_id=lid, local_id=e.get("id"), name=e.get("name"), year=e.get("year"), fraction=e.get("fraction"),
                date_note=e.get("dateNote"), lat=e.get("lat"), lon=e.get("lon"), in_map=b01(e.get("inMap")), off_map=e.get("offMap"),
                location_note=e.get("locationNote"), view_json=jtxt(e.get("view")), summary=e.get("summary"),
                evidence=e.get("evidence"), confidence=e.get("confidence"), origin_file=rel, origin_path="$[%d]" % i),
                rel, "episode", eid)
            if not ok:
                continue
            for kind in ("attested", "tradition", "unknown"):
                for k, t in enumerate(e.get(kind) or []):
                    b.ins("episode_fact", dict(episode_id=eid, kind=kind, seq=k, text=t), rel, "episode", eid)
            b.cite("episode", eid, lid, e.get("sources"), rel)
        except Exception as ex:
            b.issue("error", "schema", rel, "episode", None, repr(ex), e)


def load_stones(b, rel, lid, d):
    stones = d.get("stones") if isinstance(d, dict) else None
    if not isinstance(stones, list):
        b.issue("error", "schema", rel, "stone", None, "expected an object with a 'stones' list")
        return
    meta = d.get("_meta")
    if meta is not None:
        row = b.c.execute("SELECT config_json FROM location WHERE id=?", (lid,)).fetchone()
        if row is not None:
            cfg = json.loads(row[0]) if row[0] else {}
            cfg["stones_meta"] = meta
            b.c.execute("UPDATE location SET config_json=? WHERE id=?", (jtxt(cfg), lid))
    main = {"id", "set", "type", "role", "az", "r", "w", "t", "h", "built", "hypothetical", "state1625",
            "evidence1625", "stateToday", "notes", "sources"}
    for i, s in enumerate(stones):
        try:
            sid = "%s/%s" % (lid, s.get("id"))
            extra = {k: v for k, v in s.items() if k not in main}
            ok = b.ins("stone", dict(
                id=sid, location_id=lid, local_id=str(s.get("id")), set_name=s.get("set"), type=s.get("type"), role=s.get("role"),
                az=s.get("az"), r=s.get("r"), w=s.get("w"), t=s.get("t"), h=s.get("h"), built=s.get("built"),
                hypothetical=b01(s.get("hypothetical")), state1625=s.get("state1625"), evidence1625=s.get("evidence1625"),
                state_today=s.get("stateToday"), notes=s.get("notes"), extra_json=jtxt(extra) if extra else None,
                origin_file=rel, origin_path="$.stones[%d]" % i), rel, "stone", sid)
            if ok:
                b.cite("stone", sid, lid, s.get("sources"), rel)
        except Exception as ex:
            b.issue("error", "schema", rel, "stone", None, repr(ex), s)


def load_places(b, rel, lid, d):
    for i, p in enumerate(d):
        try:
            pid = "%s/%s" % (lid, p.get("id"))
            b.enum(rel, "place", pid, "kind", p.get("kind"), PLACE_KINDS)
            ok = b.ins("place", dict(
                id=pid, location_id=lid, local_id=p.get("id"), name=p.get("name"), lat=p.get("lat"), lon=p.get("lon"),
                country=p.get("country"), kind=p.get("kind"), evidence=p.get("evidence"), confidence=p.get("confidence"),
                summary=p.get("summary"), uncertainty=p.get("uncertainty"), site_id=p.get("site"),
                origin_file=rel, origin_path="$[%d]" % i), rel, "place", pid)
            if not ok:
                continue
            for k, ph in enumerate(p.get("phases") or []):
                if ph.get("kind") is not None:
                    b.enum(rel, "place", pid, "phases[%d].kind" % k, ph.get("kind"), PLACE_KINDS)
                b.ins("place_phase", dict(place_id=pid, seq=k, year_from=ph.get("from"), year_to=ph.get("to"),
                                          label=ph.get("label"), size=ph.get("size"), kind=ph.get("kind"), note=ph.get("note"),
                                          origin_path="$[%d].phases[%d]" % (i, k)), rel, "place_phase", "%s#%d" % (pid, k))
                b.years_ordered(rel, "place", pid, ph.get("from"), ph.get("to"), "phase %d" % k)
            for k, n in enumerate(p.get("altNames") or []):
                b.ins("place_name", dict(place_id=pid, seq=k, name=n.get("name"), year_from=n.get("from"), year_to=n.get("to")),
                      rel, "place_name", "%s#%d" % (pid, k))
                b.years_ordered(rel, "place", pid, n.get("from"), n.get("to"), "name %d" % k)
            b.cite("place", pid, lid, p.get("sources"), rel)
        except Exception as ex:
            b.issue("error", "schema", rel, "place", str(p.get("id")) if isinstance(p, dict) else None, repr(ex))


def load_lines(b, rel, lid, d):
    for i, x in enumerate(d):
        try:
            xid = "%s/%s" % (lid, x.get("id"))
            b.enum(rel, "line", xid, "kind", x.get("kind"), LINE_KINDS)
            path = x.get("path") or []
            ok = b.ins("line_feature", dict(
                id=xid, location_id=lid, local_id=x.get("id"), name=x.get("name"), kind=x.get("kind"),
                year_from=x.get("from"), year_to=x.get("to"), evidence=x.get("evidence"), confidence=x.get("confidence"),
                summary=x.get("summary"), uncertainty=x.get("uncertainty"), n_points=len(path),
                origin_file=rel, origin_path="$[%d]" % i), rel, "line", xid)
            if not ok:
                continue
            for k, pt in enumerate(path):
                b.ins("line_point", dict(line_id=xid, seq=k, lat=pt[0], lon=pt[1]), rel, "line", xid)
            b.years_ordered(rel, "line", xid, x.get("from"), x.get("to"), "line")
            b.cite("line", xid, lid, x.get("sources"), rel)
        except Exception as ex:
            b.issue("error", "schema", rel, "line", None, repr(ex), x)


def load_polities(b, rel, lid, d):
    for i, x in enumerate(d):
        try:
            xid = "%s/%s" % (lid, x.get("id"))
            b.enum(rel, "polity", xid, "kind", x.get("kind"), POLITY_KINDS)
            la = x.get("labelAt") or [None, None]
            poly = x.get("polygon") or []
            ok = b.ins("polity", dict(
                id=xid, location_id=lid, local_id=x.get("id"), name=x.get("name"), kind=x.get("kind"),
                year_from=x.get("from"), year_to=x.get("to"), label_lat=la[0], label_lon=la[1],
                evidence=x.get("evidence"), confidence=x.get("confidence"), note=x.get("note"),
                has_polygon=1 if poly else 0, origin_file=rel, origin_path="$[%d]" % i), rel, "polity", xid)
            if not ok:
                continue
            for k, pt in enumerate(poly):
                b.ins("polity_point", dict(polity_id=xid, seq=k, lat=pt[0], lon=pt[1]), rel, "polity", xid)
            b.years_ordered(rel, "polity", xid, x.get("from"), x.get("to"), "polity")
            b.cite("polity", xid, lid, x.get("sources"), rel)
        except Exception as ex:
            b.issue("error", "schema", rel, "polity", None, repr(ex), x)


def load_keyframes_and_terrain(b, rel_site, rel_terrain, lid, site, terrain):
    """Woodland keyframes + sources from a site.json; sea level + terrain sources from national terrain.json."""
    if isinstance(site, dict):
        w = site.get("woodland")
        if isinstance(w, dict):
            for k, kf in enumerate(w.get("cover") or []):
                b.ins("woodland_keyframe", dict(location_id=lid, seq=k, year=kf.get("year"), value=kf.get("value"),
                                                origin_file=rel_site), rel_site, "location", lid)
            b.cite("location", lid, lid, w.get("sources"), rel_site, "woodland")
        for key, role in (("terrain", "terrain"), ("river", "river")):
            t = site.get(key)
            if isinstance(t, dict):
                b.cite("location", lid, lid, t.get("sources"), rel_site, role)
    if isinstance(terrain, dict):
        for k, kf in enumerate(terrain.get("seaLevel") or []):
            b.ins("sea_level_keyframe", dict(location_id=lid, seq=k, year=kf.get("year"), value_m=kf.get("value"),
                                             origin_file=rel_terrain), rel_terrain, "location", lid)
        b.cite("location", lid, lid, terrain.get("sources"), rel_terrain, "terrain")
        row = b.c.execute("SELECT config_json FROM location WHERE id=?", (lid,)).fetchone()
        if row is not None:
            cfg = json.loads(row[0]) if row[0] else {}
            cfg["terrain"] = {k: v for k, v in terrain.items() if k not in ("seaLevel", "sources")}
            b.c.execute("UPDATE location SET config_json=? WHERE id=?", (jtxt(cfg), lid))


def polyhaven(slug):
    return "https://polyhaven.com/a/%s" % slug if slug else None


def load_assets(b, rel, d):
    lic = d.get("licence")
    def add(kind, name, **kw):
        row = dict(id="%s:%s" % (kind, name), kind=kind, name=name, source="Poly Haven", licence=lic, origin_file=rel)
        row.update(kw)
        b.ins("asset", row, rel, "asset", row["id"])
    sky = d.get("sky") or {}
    if sky.get("asset"):
        add("sky", sky["asset"], slug=sky["asset"], url=polyhaven(sky["asset"]), origin_path="$.sky")
    for name, m in (d.get("materials") or {}).items():
        add("material", name, slug=m.get("asset"), url=polyhaven(m.get("asset")), tile_m=m.get("tile"), colour=m.get("color"),
            origin_path="$.materials.%s" % name)
    terr = d.get("terrain") or {}
    for name, slug in terr.items():
        if name == "tile":
            continue
        add("terrain-texture", name, slug=slug, url=polyhaven(slug), tile_m=terr.get("tile"), origin_path="$.terrain.%s" % name)
    for name, c in (d.get("composites") or {}).items():
        extra = {k: v for k, v in c.items() if k not in ("base", "tile", "note")}
        add("composite", name, slug=c.get("base"), url=polyhaven(c.get("base")), tile_m=c.get("tile"), note=c.get("note"),
            extra_json=jtxt(extra), origin_path="$.composites.%s" % name)
    for i, x in enumerate(d.get("extra") or []):
        b.issue("info", "unrecognised", rel, "asset", None, "assets.json 'extra' entry not loaded", x)


def load_models(b, rel, d):
    lic = d.get("licence")
    for i, a in enumerate(d.get("assets") or []):
        per = a.get("period") or {}
        extra = {k: v for k, v in a.items() if k not in ("id", "name", "category", "variants", "period", "confidence", "plausibility")}
        b.ins("asset", dict(id="model:%s" % a.get("id"), kind="model", name=a.get("name") or a.get("id"), slug=a.get("id"),
                            source="Poly Haven", licence=lic, url=polyhaven(a.get("id")), category=a.get("category"),
                            variants=a.get("variants"), period_from=per.get("from"), period_to=per.get("to"),
                            confidence=a.get("confidence"), note=a.get("plausibility"), extra_json=jtxt(extra) if extra else None,
                            origin_file=rel, origin_path="$.assets[%d]" % i), rel, "asset", "model:%s" % a.get("id"))
    for i, a in enumerate(d.get("excluded") or []):
        b.ins("asset", dict(id="excluded-model:%s" % a.get("id"), kind="excluded-model", name=a.get("id"), slug=a.get("id"),
                            source="Poly Haven", licence=lic, url=polyhaven(a.get("id")), note=a.get("reason"),
                            origin_file=rel, origin_path="$.excluded[%d]" % i), rel, "asset", "excluded-model:%s" % a.get("id"))


# ---------------------------------------------------------------------------
# dump
# ---------------------------------------------------------------------------

def write_dump(conn, path):
    """Plain-text SQL dump: schema then INSERTs in rowid order (deterministic, diffable)."""
    tmp = path + ".tmp-%d" % os.getpid()
    cur = conn.cursor()
    objs = cur.execute("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").fetchall()
    order = {"table": 0, "index": 1, "view": 2, "trigger": 3}
    objs.sort(key=lambda o: (order.get(o[0], 9), o[1]))
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("-- history.sql: plain-text dump of history.sqlite, generated by scripts/db/build.py.\n")
        f.write("-- Restore with: sqlite3 new.sqlite < history.sql\n")
        f.write("PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n")
        for typ, name, sql in objs:
            if typ == "table":
                f.write(sql + ";\n")
        for typ, name, sql in objs:
            if typ != "table":
                continue
            cols = [r[1] for r in cur.execute('PRAGMA table_info("%s")' % name)]  # excludes generated columns
            q = "SELECT %s FROM \"%s\" ORDER BY rowid" % (",".join('quote("%s")' % c for c in cols), name)
            head = 'INSERT INTO "%s"(%s) VALUES(' % (name, ",".join('"%s"' % c for c in cols))
            for row in cur.execute(q):
                f.write(head + ",".join(row) + ");\n")
        for typ, name, sql in objs:
            if typ != "table":
                f.write(sql + ";\n")
        f.write("COMMIT;\n")
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", help="output sqlite path (default data/db/history.sqlite)")
    ap.add_argument("--only", help="load only this location (a site id, or 'national') plus global sources and assets")
    ap.add_argument("--strict", action="store_true", help="exit 1 if any load_issue of severity 'error' exists")
    args = ap.parse_args(argv)

    only = args.only
    if only in ("national", "england-wales"):
        only = "national"
    if args.out:
        out = os.path.abspath(args.out)
    elif only:
        out = os.path.join(DATA, "db", "history-only-%s.sqlite" % only)
    else:
        out = os.path.join(DATA, "db", "history.sqlite")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = out + ".tmp-%d" % os.getpid()
    for p in (tmp, tmp + "-journal"):
        if os.path.exists(p):
            os.remove(p)

    started = datetime.datetime.now()
    conn = sqlite3.connect(tmp, isolation_level=None)
    conn.execute("PRAGMA foreign_keys=ON")
    with open(SCHEMA, encoding="utf-8") as f:
        conn.executescript(f.read())
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("BEGIN")
    b = Builder(conn, only)

    # ---- read every json file once ---------------------------------------
    files = discover()
    parsed, sha = {}, hashlib.sha256()
    for rel in files:
        cls = classify(rel)
        if cls is None:
            b.files[rel] = "skipped (unrecognised name)"
            b.issue("info", "unrecognised", rel, None, None, "JSON file not recognised by build.py; not loaded")
            continue
        if only and cls[1] not in ("global", None) and cls[1] != only and not (cls[1] == "national" and only == "national"):
            b.files[rel] = "skipped (--only)"
            continue
        try:
            with open(os.path.join(DATA, rel), "rb") as fh:
                raw = fh.read()
            sha.update(rel.encode() + b"\0" + raw)
            parsed[rel] = (cls, json.loads(raw.decode("utf-8")))
            b.files[rel] = "loaded"
        except Exception as e:
            b.files[rel] = "FAILED to parse"
            b.issue("error", "parse", rel, None, None, "%s: %s" % (type(e).__name__, e))

    def group(handler):
        return sorted((rel, cls[1], d) for rel, (cls, d) in parsed.items() if cls[0] == handler)

    def expect(rel, d, typ, handler):
        if not isinstance(d, typ):
            b.files[rel] = "skipped (wrong JSON shape)"
            b.issue("error", "schema", rel, handler, None, "expected JSON %s, got %s" % (typ.__name__, type(d).__name__))
            return False
        return True

    # ---- 1. locations -----------------------------------------------------
    scopes = set(cls[1] for rel, (cls, d) in parsed.items() if cls[1] not in ("global", None))
    if os.path.isdir(os.path.join(DATA, "national")) and (not only or only == "national"):
        scopes.add("national")
    loc_of = {}
    for rel, scope, d in group("site"):
        if expect(rel, d, dict, "site"):
            loc_of[scope] = load_site(b, rel, scope, d)
    for scope in sorted(scopes):
        if scope not in loc_of:
            loc_of[scope] = ensure_location(b, scope, "national/site.json" if scope == "national" else "locations/%s/site.json" % scope)
    for scope in sorted(scopes):
        # stonehenge and similar may be absent/incomplete: say so plainly
        if not any(cls[1] == scope for rel, (cls, d) in parsed.items() if cls[0] in ("landmarks", "places")):
            b.issue("info", "missing", None, "location", loc_of.get(scope), "%s has no landmark/place data yet" % scope)
        elif scope not in ("national",) and all(not d for rel, (cls, d) in parsed.items() if cls[1] == scope and cls[0] == "landmarks"):
            b.issue("info", "missing", None, "location", loc_of.get(scope), "%s landmarks.json is empty" % scope)

    # ---- 2. sources (before anything cites them) ------------------------
    for rel, scope, d in group("sources"):
        load_sources(b, rel, scope, d)

    # ---- 3. eras, events, keyframes --------------------------------------
    for rel, scope, d in group("eras"):
        if expect(rel, d, list, "era"):
            load_eras(b, rel, loc_of[scope], d)
    for rel, scope, d in group("events"):
        if expect(rel, d, list, "event"):
            load_events(b, rel, loc_of[scope], d)
    site_docs = {scope: (rel, d) for rel, scope, d in group("site")}
    terr_docs = {scope: (rel, d) for rel, scope, d in group("terrain")}
    for scope in sorted(scopes):
        rs, ds = site_docs.get(scope, (None, None))
        rt, dt = terr_docs.get(scope, (None, None))
        load_keyframes_and_terrain(b, rs, rt, loc_of[scope], ds, dt)

    # ---- 4. entities -------------------------------------------------------
    for handler, fn, typ in (("landmarks", load_landmarks, list), ("zones", load_zones, list),
                             ("episodes", load_episodes, list), ("places", load_places, list),
                             ("lines", load_lines, list), ("polities", load_polities, list),
                             ("stones", load_stones, dict)):
        for rel, scope, d in group(handler):
            if expect(rel, d, typ, handler):
                fn(b, rel, loc_of[scope], d)

    # ---- 5. assets ---------------------------------------------------------
    for rel, scope, d in group("assets"):
        if expect(rel, d, dict, "asset"):
            load_assets(b, rel, d)
    for rel, scope, d in group("models"):
        if expect(rel, d, dict, "asset"):
            load_models(b, rel, d)

    # ---- 6. soft checks ----------------------------------------------------
    for (pid, sid) in conn.execute("SELECT id, site_id FROM place WHERE site_id IS NOT NULL").fetchall():
        if sid not in b.locations and not only:
            b.issue("warning", "missing", None, "place", pid, "place links to site %r which has no location row (site.json missing or failed)" % sid)

    # ---- 7. facts -----------------------------------------------------------
    dup = conn.execute("SELECT fact_id, COUNT(*) FROM v_fact GROUP BY fact_id HAVING COUNT(*)>1").fetchall()
    for fid, n in dup:
        b.issue("error", "duplicate", None, "fact", fid, "fact_id generated %d times (duplicate ids upstream); only the first is kept" % n)
    conn.execute("""INSERT OR IGNORE INTO fact (fact_id,entity_type,entity_id,entity_name,location_id,kind,year_from,year_to,
                    value_text,detail,lat,lon,evidence,confidence,source_ids,n_sources,origin_file,origin_path)
                    SELECT fact_id,entity_type,entity_id,entity_name,location_id,kind,year_from,year_to,
                    value_text,detail,lat,lon,evidence,confidence,source_ids,n_sources,origin_file,origin_path FROM v_fact""")

    sha_hex = sha.hexdigest()
    for k, v in (("schema_version", "1"), ("json_files_loaded", str(sum(1 for v in b.files.values() if v == "loaded"))),
                 ("input_sha256", sha_hex), ("only", only or "")):
        conn.execute("INSERT INTO build_meta VALUES (?,?)", (k, v))
    conn.execute("COMMIT")

    fk = conn.execute("PRAGMA foreign_key_check").fetchall()
    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]

    # ---- summary -----------------------------------------------------------
    lines = []
    P = lines.append
    P("history.sqlite build  %s   (only=%s)" % (started.strftime("%Y-%m-%d %H:%M:%S"), only or "all"))
    P("input sha256 %s" % sha_hex[:16])
    P("")
    P("JSON files: %d found" % len(files))
    cnt = collections.Counter(b.files.values())
    for k, v in sorted(cnt.items()):
        P("  %-32s %d" % (k, v))
    bad = [(r, s) for r, s in sorted(b.files.items()) if s not in ("loaded", "skipped (--only)")]
    for r, s in bad:
        P("    %s: %s" % (r, s))
    if not os.path.isdir(os.path.join(DATA, "locations", "stonehenge")):
        P("    data/locations/stonehenge is ABSENT")
    P("")
    P("Row counts:")
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    total = 0
    counts = {}
    for t in tables:
        n = conn.execute('SELECT COUNT(*) FROM "%s"' % t).fetchone()[0]
        counts[t] = n
        P("  %-22s %7d" % (t, n))
    facts = counts.get("fact", 0)
    P("  total facts (fact table): %d" % facts)
    P("")
    P("load_issue rows: %d" % counts.get("load_issue", 0))
    for (sev, cat), n in sorted(b.n_issue.items()):
        P("  %-8s %-16s %d" % (sev, cat, n))
    if b.rejected:
        P("Rows REJECTED (not loaded; see load_issue): " + ", ".join("%s=%d" % kv for kv in sorted(b.rejected.items())))
    P("")
    P("Entities with no citation (v_unsourced):")
    for r in conn.execute("SELECT entity_type, COUNT(*) FROM v_unsourced GROUP BY 1 ORDER BY 2 DESC"):
        tot = conn.execute("SELECT COUNT(*) FROM v_entity WHERE entity_type=?", (r[0],)).fetchone()[0]
        P("  %-10s %5d of %d" % (r[0], r[1], tot))
    P("Facts with n_sources=0: %d of %d" % (conn.execute("SELECT COUNT(*) FROM fact WHERE n_sources=0").fetchone()[0], facts))
    P("")
    d = conn.execute("SELECT COUNT(*), COUNT(DISTINCT source_id) FROM dangling_citation").fetchone()
    P("Dangling source ids: %d citations, %d distinct ids" % tuple(d))
    for r in conn.execute("SELECT source_id, COUNT(*) FROM dangling_citation GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8"):
        P("  %-50s cited by %d entities" % r)
    P("")
    P("PRAGMA foreign_key_check: %d violations; integrity_check: %s" % (len(fk), integrity))
    ndb = conn.execute("SELECT COUNT(*) FROM load_issue WHERE severity='error'").fetchone()[0]

    # ---- dump + atomic rename ----------------------------------------------
    stem = os.path.splitext(out)[0]
    sql_path = stem + ".sql"
    write_dump(conn, tmp + ".sqldump")
    conn.close()
    os.replace(tmp, out)
    os.replace(tmp + ".sqldump", sql_path)
    P("")
    P("wrote %s (%d KB)" % (os.path.relpath(out, ROOT), os.path.getsize(out) // 1024))
    P("wrote %s (%d KB)" % (os.path.relpath(sql_path, ROOT), os.path.getsize(sql_path) // 1024))
    P("Data is edited by other people/agents: files may have been incomplete at build time. Just re-run this script.")
    text = "\n".join(lines)
    print(text)
    try:
        with open(stem + "-build-report.txt", "w", encoding="utf-8") as f:
            f.write(text + "\n")
    except OSError:
        pass
    return 1 if (args.strict and ndb) else 0


if __name__ == "__main__":
    sys.exit(main())
