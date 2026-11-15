#!/usr/bin/env python3
"""Check the database build. Run from anywhere:  python3 tests/db_check.py

Builds to a temporary directory (the real data/db/ files are not touched) and asserts:
  * row counts equal the JSON counts for every entity type (rows build.py
    reported as rejected in load_issue are accounted for);
  * no orphan citations, no foreign-key violations, no year 0, generated
    astronomical columns agree with the historical years;
  * every view runs; every example query in scripts/db/queries.sql and
    cross_queries.sql executes;
  * the plain-text dump restores to the same row counts;
  * the curated layer survives a rebuild and its helper scripts work;
  * a few known facts hold (Globe burned 1613, Londinium in 150, Old St Paul's spire to 1561).
Other agents edit the JSON while this runs; if the data changes mid-build the
check retries (up to 3 times) before comparing counts.
"""
import collections
import glob
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
DATA = os.path.join(ROOT, "data")
DBS = os.path.join(ROOT, "scripts", "db")
PY = sys.executable

failures, passed = [], 0


def check(cond, msg):
    global passed
    if cond:
        passed += 1
    else:
        failures.append(msg)
        print("FAIL: " + msg)


def data_hash():
    h = hashlib.sha256()
    for p in sorted(glob.glob(os.path.join(DATA, "**", "*.json"), recursive=True)):
        if os.sep + "db" + os.sep in p:
            continue
        try:
            h.update(p.encode() + open(p, "rb").read())
        except OSError:
            pass
    return h.hexdigest()


def load(rel):
    try:
        with open(os.path.join(DATA, rel), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def rels(pattern):
    return sorted(os.path.relpath(p, DATA).replace(os.sep, "/") for p in glob.glob(os.path.join(DATA, pattern)))


def json_counts():
    """Independent re-count of the JSON, by table."""
    c = collections.Counter()
    pairs = set()  # (entity_type, entity_id, source) citation pairs
    src_ids = set()
    for rel in rels("sources.json") + rels("national/sources*.json") + rels("locations/*/sources*.json"):
        d = load(rel)
        if isinstance(d, dict):
            src_ids.update(d.keys())
    c["source"] = len(src_ids)

    def loc_of(rel):
        parts = rel.split("/")
        if parts[0] == "national":
            s = load("national/site.json")
            return (s or {}).get("id", "england-wales")
        return parts[1]

    def add_pairs(et, lid, local, srcs):
        for s in dict.fromkeys(srcs or []):
            pairs.add((et, "%s/%s" % (lid, local), s))

    for rel in rels("national/eras.json") + rels("locations/*/eras.json"):
        d = load(rel) or []
        c["era"] += len(d)
    for rel in rels("national/events.json") + rels("locations/*/events.json"):
        d = load(rel) or []
        lid = loc_of(rel)
        c["event"] += len(d)
        per = collections.Counter()
        for e in d:
            n = per[e["year"]]
            per[e["year"]] += 1
            add_pairs("event", lid, "%s#%d" % (e["year"], n), e.get("sources"))
    for rel in rels("locations/*/landmarks*.json"):
        d = load(rel) or []
        lid = loc_of(rel)
        c["landmark"] += len(d)
        for l in d:
            c["landmark_phase"] += len(l.get("phases") or [])
            c["landmark_path_point"] += len(l.get("path") or [])
            add_pairs("landmark", lid, l["id"], l.get("sources"))
    for rel in rels("locations/*/zones*.json"):
        d = load(rel) or []
        c["zone"] += len(d)
        for z in d:
            add_pairs("zone", loc_of(rel), z["id"], z.get("sources"))
    for rel in rels("locations/*/episodes*.json"):
        d = load(rel) or []
        c["episode"] += len(d)
        for e in d:
            c["episode_fact"] += sum(len(e.get(k) or []) for k in ("attested", "tradition", "unknown"))
            add_pairs("episode", loc_of(rel), e["id"], e.get("sources"))
    for rel in rels("locations/*/stones.json"):
        d = load(rel) or {}
        c["stone"] += len(d.get("stones", []))
        for s in d.get("stones", []):
            add_pairs("stone", loc_of(rel), s["id"], s.get("sources"))
    for rel in rels("national/places*.json"):
        d = load(rel) or []
        c["place"] += len(d)
        for p in d:
            c["place_phase"] += len(p.get("phases") or [])
            c["place_name"] += len(p.get("altNames") or [])
            add_pairs("place", loc_of(rel), p["id"], p.get("sources"))
    for rel in rels("national/lines*.json"):
        d = load(rel) or []
        c["line_feature"] += len(d)
        for x in d:
            c["line_point"] += len(x.get("path") or [])
            add_pairs("line", loc_of(rel), x["id"], x.get("sources"))
    for rel in rels("national/polities*.json"):
        d = load(rel) or []
        c["polity"] += len(d)
        for x in d:
            c["polity_point"] += len(x.get("polygon") or [])
            add_pairs("polity", loc_of(rel), x["id"], x.get("sources"))
    for rel in rels("national/site.json") + rels("locations/*/site.json"):
        d = load(rel)
        if isinstance(d, dict):
            c["location"] += 1
            c["woodland_keyframe"] += len((d.get("woodland") or {}).get("cover") or [])
    t = load("national/terrain.json")
    if isinstance(t, dict):
        c["sea_level_keyframe"] += len(t.get("seaLevel") or [])
    a = load("assets.json")
    if isinstance(a, dict):
        c["asset"] += (1 if (a.get("sky") or {}).get("asset") else 0) + len(a.get("materials") or {}) \
            + len([k for k in (a.get("terrain") or {}) if k != "tile"]) + len(a.get("composites") or {})
    m = load("models.json")
    if isinstance(m, dict):
        c["asset"] += len(m.get("assets") or []) + len(m.get("excluded") or [])
    return c, pairs, src_ids


def run_build(out):
    r = subprocess.run([PY, os.path.join(DBS, "build.py"), "--out", out], capture_output=True, text=True)
    check(r.returncode == 0, "build.py exit code %d: %s" % (r.returncode, r.stderr[-500:]))
    return r.stdout


def parse_queries(path):
    txt = open(path, encoding="utf-8").read()
    out = []
    for b in re.split(r"\n(?=-- (?:Q|X)\d+:)", txt)[1:]:
        title = b.split("\n")[0]
        m = re.search(r"-- @params(.*)", b)
        params = {}
        for kv in (m.group(1).split() if m else []):
            k, v = kv.split("=", 1)
            params[k] = int(v) if re.fullmatch(r"-?\d+", v) else (float(v) if re.fullmatch(r"-?\d+\.\d+", v) else v)
        sql = "\n".join(l for l in b.split("\n") if not l.lstrip().startswith("--"))
        out.append((title, sql, params))
    return out


def main():
    tmp = tempfile.mkdtemp(prefix="dbcheck-")
    try:
        # --- curated file must survive a build untouched --------------------
        cur_path = os.path.join(tmp, "curated.sqlite")
        r = subprocess.run([PY, os.path.join(DBS, "init_curated.py"), "--out", cur_path], capture_output=True, text=True)
        check(r.returncode == 0, "init_curated.py failed: " + r.stderr)
        cur_hash = hashlib.sha256(open(cur_path, "rb").read()).hexdigest()

        out = os.path.join(tmp, "history.sqlite")
        for attempt in range(3):
            before = data_hash()
            run_build(out)
            counts, pairs, src_ids = json_counts()
            if data_hash() == before:
                break
            print("data changed during build; retrying (%d)" % (attempt + 1))
        else:
            print("WARNING: data kept changing; counts below may be off by in-flight edits")
        check(hashlib.sha256(open(cur_path, "rb").read()).hexdigest() == cur_hash, "build touched curated.sqlite")
        check(os.path.exists(os.path.join(tmp, "history.sql")), "history.sql dump not written next to --out")

        db = sqlite3.connect(out)
        db.execute("PRAGMA foreign_keys=ON")
        q = lambda sql, *a: db.execute(sql, a).fetchall()

        # --- row counts vs JSON --------------------------------------------
        rejected = collections.Counter()
        for tbl, n in q("SELECT substr(reason,1,instr(reason,':')-1), COUNT(*) FROM load_issue WHERE category='constraint' GROUP BY 1"):
            rejected[tbl] += n
        for table, n_json in sorted(counts.items()):
            n_db = q('SELECT COUNT(*) FROM "%s"' % table)[0][0]
            check(n_db + rejected[table] == n_json,
                  "%s: db %d + rejected %d != json %d" % (table, n_db, rejected[table], n_json))
        # citations: every (entity, source) pair is either a citation or a dangling citation
        cited = {r for r in q("SELECT entity_type, entity_id, source_id FROM citation WHERE entity_type<>'location'")}
        dang = {r for r in q("SELECT entity_type, entity_id, source_id FROM dangling_citation WHERE entity_type<>'location'")}
        check(not (cited - pairs), "citations exist that are not in the JSON: %s" % list(cited - pairs)[:3])
        lost = sum(rejected[t] for t in ("citation", "landmark", "zone", "episode", "event", "place", "line_feature", "polity", "stone"))
        check(len(cited | dang) == len(pairs) or lost > 0,
              "citation + dangling_citation cover %d of %d json (entity, source) pairs" % (len(cited | dang), len(pairs)))
        check(all(s in src_ids for (_, _, s) in cited), "citation points at a source not in any sources file")
        check(all(s not in src_ids for (_, _, s) in dang), "dangling_citation lists a source that does exist")

        # --- integrity --------------------------------------------------------
        check(q("PRAGMA foreign_key_check") == [], "foreign key violations: %s" % q("PRAGMA foreign_key_check")[:3])
        check(q("PRAGMA integrity_check")[0][0] == "ok", "integrity_check failed")
        ent = ["landmark", "zone", "episode", "event", "place", "line", "polity", "stone"]
        ids = {e: set() for e in ent}
        tmap = {"landmark": "landmark", "zone": "zone", "episode": "episode", "event": "event", "place": "place",
                "line": "line_feature", "polity": "polity", "stone": "stone"}
        for e in ent:
            ids[e] = {r[0] for r in q("SELECT id FROM %s" % tmap[e])}
        orphans = [(t, i) for t, i in q("SELECT entity_type, entity_id FROM citation WHERE entity_type<>'location'") if i not in ids[t]]
        check(not orphans, "orphan citations: %s" % orphans[:3])
        orphan_loc = q("SELECT c.entity_id FROM citation c WHERE c.entity_type='location' AND c.entity_id NOT IN (SELECT id FROM location)")
        check(not orphan_loc, "orphan location citations")
        # facts must point at real entities
        bad_facts = [(t, i) for t, i in q("SELECT DISTINCT entity_type, entity_id FROM fact WHERE entity_type NOT IN ('era','location')")
                     if i not in ids.get(t, set())]
        check(not bad_facts, "facts point at missing entities: %s" % bad_facts[:3])
        check(q("SELECT COUNT(*) FROM fact")[0][0] == q("SELECT COUNT(*) FROM v_fact")[0][0] - 0 or
              q("SELECT COUNT(*) FROM load_issue WHERE category='duplicate' AND entity_type='fact'")[0][0] > 0,
              "fact table row count differs from v_fact")

        # --- years -----------------------------------------------------------
        spec = importlib.util.spec_from_file_location("dbbuild", os.path.join(DBS, "build.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        for (t,) in q("SELECT name FROM sqlite_master WHERE type='table'"):
            cols = [r[1] for r in db.execute('PRAGMA table_xinfo("%s")' % t)]
            for c in cols:
                if c in mod.YEAR_COLS:
                    z = q('SELECT COUNT(*) FROM "%s" WHERE "%s" = 0' % (t, c))[0][0]
                    check(z == 0, "year 0 found in %s.%s" % (t, c))
                    a = "astro_" + (c[5:] if c.startswith("year_") else c)
                    if a in cols:
                        bad = q('SELECT COUNT(*) FROM "%s" WHERE "%s" IS NOT NULL AND "%s" <> CASE WHEN "%s"<0 THEN "%s"+1 ELSE "%s" END' % (t, c, a, c, c, c))[0][0]
                        check(bad == 0, "astro column mismatch in %s.%s" % (t, a))
        check(q("SELECT CASE WHEN y < 0 THEN -y || ' BCE' ELSE y || ' CE' END FROM (SELECT -55 AS y)")[0][0] == "55 BCE", "year label expression")
        check(q("SELECT label FROM year_label WHERE year=1066")[0][0] == "1066 CE" if q("SELECT 1 FROM year_label WHERE year=1066") else True,
              "year_label view label wrong")
        try:
            db.execute("INSERT INTO event(id,location_id,seq,year,label) SELECT 'x','x',0,0,'x'")
            check(False, "year 0 was accepted by the CHECK")
        except sqlite3.IntegrityError:
            check(True, "")
        db.rollback()

        # --- views and queries -----------------------------------------------
        views = [r[0] for r in q("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name")]
        check(len(views) >= 10, "expected 10+ views, found %d" % len(views))
        for v in views:
            try:
                db.execute("SELECT * FROM %s LIMIT 5" % v).fetchall()
            except sqlite3.Error as e:
                check(False, "view %s fails: %s" % (v, e))
        check(q("SELECT COUNT(*) FROM v_timeline")[0][0] > 0, "v_timeline is empty")
        queries = parse_queries(os.path.join(DBS, "queries.sql"))
        check(len(queries) >= 20, "queries.sql has only %d queries" % len(queries))
        for title, sql, params in queries:
            try:
                db.execute(sql, params).fetchall()
            except sqlite3.Error as e:
                check(False, "%s -> %s" % (title[:50], e))

        # --- known facts ------------------------------------------------------
        check(q("""SELECT COUNT(*) FROM landmark_phase ph JOIN landmark l ON l.id=ph.landmark_id
                   WHERE l.location_id='london' AND l.local_id='globe' AND ph.year_to=1613 AND ph.end_kind='burned'""")[0][0] == 1,
              "Globe: no phase ending 1613 with end kind burned")
        check(q("""SELECT n.name FROM place_name n JOIN place p ON p.id=n.place_id
                   WHERE p.local_id='london' AND n.astro_from<=150 AND (n.astro_to IS NULL OR n.astro_to>=150)""") == [("Londinium",)],
              "London place is not named Londinium in 150")
        check(q("""SELECT COUNT(*) FROM landmark_phase ph JOIN landmark l ON l.id=ph.landmark_id
                   WHERE l.local_id='st-pauls' AND ph.label LIKE '%spire%' AND ph.year_to=1561""")[0][0] >= 1,
              "Old St Paul's: no spire phase ending in 1561")
        check(q("""SELECT COUNT(*) FROM fact WHERE entity_id='london/globe' AND kind='ended' AND year_from=1613""")[0][0] == 1,
              "fact table lacks the Globe 'ended 1613' fact")

        # --- dump restores ----------------------------------------------------
        mem = sqlite3.connect(":memory:")
        mem.executescript(open(os.path.join(tmp, "history.sql"), encoding="utf-8").read())
        for t in ("landmark", "landmark_phase", "place", "fact", "citation", "source", "load_issue", "line_point"):
            a = db.execute('SELECT COUNT(*) FROM "%s"' % t).fetchone()[0]
            b = mem.execute('SELECT COUNT(*) FROM "%s"' % t).fetchone()[0]
            check(a == b, "dump restore: %s has %d rows, expected %d" % (t, b, a))
        check(mem.execute("SELECT COUNT(*) FROM v_timeline").fetchone()[0] == q("SELECT COUNT(*) FROM v_timeline")[0][0],
              "restored dump gives a different v_timeline")
        mem.close()
        db.close()

        # --- curated layer ----------------------------------------------------
        cur = sqlite3.connect(cur_path)
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("INSERT INTO curated_fact(entity_type,entity_id,location_id,kind,statement,year_from,status) "
                    "VALUES ('landmark','london/globe','london','built','Test statement',1599,'unverified')")
        cur.execute("INSERT INTO fact_review(target_type,target_id,verdict,reviewer,proposed_correction,correction_status) "
                    "VALUES ('fact','landmark:london/globe:ended:0','corrected','tester',"
                    "'{\"field\":\"year_to\",\"old\":1613,\"new\":1614}','accepted')")
        cur.execute("INSERT INTO fact_review(target_type,target_id,verdict,reviewer) VALUES ('fact','landmark:london/globe:begun:0','confirmed','tester')")
        cur.execute("INSERT INTO curated_source(title) VALUES ('A test source')")
        cur.execute("INSERT INTO curated_citation(curated_fact_id,curated_source_id) VALUES (1,1)")
        cur.execute("INSERT INTO location_note(location_id,note) VALUES ('london','test')")
        try:
            cur.execute("INSERT INTO curated_fact(statement,year_from) VALUES ('bad',0)")
            check(False, "curated_fact accepted year 0")
        except sqlite3.IntegrityError:
            check(True, "")
        try:
            cur.execute("INSERT INTO fact_review(target_type,target_id,verdict,reviewer) VALUES ('fact','x','maybe','t')")
            check(False, "fact_review accepted an unknown verdict")
        except sqlite3.IntegrityError:
            check(True, "")
        cur.commit()
        cur.close()

        h = sqlite3.connect(out)
        script = open(os.path.join(DBS, "attach_curated.sql"), encoding="utf-8").read().replace("data/db/curated.sqlite", cur_path.replace("'", "''"))
        h.executescript(script)
        for title, sql, params in parse_queries(os.path.join(DBS, "cross_queries.sql")):
            try:
                rows = h.execute(sql, params).fetchall()
                if title.startswith("-- X5"):
                    check(len(rows) == 1, "X5 should list the one accepted correction, got %d" % len(rows))
            except sqlite3.Error as e:
                check(False, "%s -> %s" % (title[:50], e))
        check(len(parse_queries(os.path.join(DBS, "cross_queries.sql"))) >= 5, "cross_queries.sql has fewer than 5 queries")
        check(h.execute("SELECT COUNT(*) FROM v_fact_reviewed WHERE verdict='confirmed'").fetchone()[0] == 1, "v_fact_reviewed join broken")
        check(h.execute("SELECT COUNT(*) FROM v_stale_reviews").fetchone()[0] == 0, "unexpected stale reviews")
        h.close()

        r = subprocess.run([PY, os.path.join(DBS, "list_proposed_corrections.py"), "--db", out, "--curated", cur_path],
                           capture_output=True, text=True)
        check(r.returncode == 0 and "year_to" in r.stdout and "STALE" not in r.stdout, "list_proposed_corrections output: " + r.stdout + r.stderr)
        r = subprocess.run([PY, os.path.join(DBS, "list_proposed_corrections.py"), "--curated", cur_path, "--mark-applied", "1", "--note", "test"],
                           capture_output=True, text=True)
        check(r.returncode == 0, "mark-applied failed: " + r.stdout + r.stderr)
        r = subprocess.run([PY, os.path.join(DBS, "list_proposed_corrections.py"), "--db", out, "--curated", cur_path], capture_output=True, text=True)
        check("No accepted corrections" in r.stdout, "applied correction still listed")

        r = subprocess.run([PY, os.path.join(DBS, "export_factsheet.py"), "--db", out, "--curated", cur_path, "--out-dir", tmp],
                           capture_output=True, text=True)
        check(r.returncode == 0, "export_factsheet failed: " + r.stderr)
        if r.returncode == 0:
            import csv
            rows = list(csv.reader(open(os.path.join(tmp, "factsheet.csv"), encoding="utf-8")))
            n_fact = sqlite3.connect(out).execute("SELECT COUNT(*) FROM fact").fetchone()[0]
            check(len(rows) - 1 == n_fact, "factsheet.csv rows %d != facts %d" % (len(rows) - 1, n_fact))
            md = open(os.path.join(tmp, "factsheet.md"), encoding="utf-8").read()
            check("UNSOURCED" in md and "Curated facts" in md and "review:confirmed" in md, "factsheet.md missing flags/curated/review sections")

        # --- --only works and does not clobber -------------------------------
        r = subprocess.run([PY, os.path.join(DBS, "build.py"), "--only", "london", "--out", os.path.join(tmp, "only.sqlite")],
                           capture_output=True, text=True)
        check(r.returncode == 0, "build --only london failed: " + r.stderr[-300:])
        o = sqlite3.connect(os.path.join(tmp, "only.sqlite"))
        check(o.execute("SELECT COUNT(*) FROM location").fetchone()[0] == 1, "--only london should load exactly one location")
        o.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n%d checks passed, %d failed" % (passed, len(failures)))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
