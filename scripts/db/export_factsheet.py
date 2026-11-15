#!/usr/bin/env python3
"""Write a plain, chronological fact sheet per location from history.sqlite.

    python3 scripts/db/export_factsheet.py [--db PATH] [--curated PATH] [--out-dir DIR] [--no-curated]

Outputs data/db/factsheet.md and data/db/factsheet.csv. Re-runnable; read-only
on the databases. If curated.sqlite exists, the latest review verdict and the
curated (fact-keeper) facts are included. Unsourced, conjectural and
low-confidence items are flagged.
"""
import argparse
import csv
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DBDIR = os.path.join(ROOT, "data", "db")


def yl(y):
    if y is None:
        return ""
    return "%d BCE" % -y if y < 0 else "%d CE" % y


def date_range(a, b, kind):
    if a is None:
        return "undated"
    if kind in ("phase", "size", "named", "existed", "grew", "declined", "era") or (b is not None and b != a):
        return "%s - %s" % (yl(a), yl(b) if b is not None else "1625 CE (end of timeline)")
    return yl(a)


def esc(s):
    return (s or "").replace("|", "\\|").replace("\n", " ")


def flags(r):
    f = []
    if r["n_sources"] == 0 and r["n_dangling"]:
        f.append("SOURCE-ID-UNDEFINED")
    elif r["n_sources"] == 0:
        f.append("UNSOURCED")
    if r["evidence"] == "conjectural":
        f.append("CONJECTURAL")
    if r["confidence"] == "low":
        f.append("LOW-CONF")
    if r["verdict"]:
        f.append("review:" + r["verdict"])
    return f


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.join(DBDIR, "history.sqlite"))
    ap.add_argument("--curated", default=os.path.join(DBDIR, "curated.sqlite"))
    ap.add_argument("--out-dir", default=DBDIR)
    ap.add_argument("--no-curated", action="store_true")
    a = ap.parse_args(argv)
    if not os.path.exists(a.db):
        print("history.sqlite not found: run python3 scripts/db/build.py first", file=sys.stderr)
        return 2
    conn = sqlite3.connect("file:%s?mode=ro" % a.db, uri=True)
    conn.row_factory = sqlite3.Row
    use_cur = (not a.no_curated) and os.path.exists(a.curated)
    if use_cur:
        conn.execute("ATTACH DATABASE ? AS cur", (a.curated,))
        verdict_sql = ("LEFT JOIN cur.v_latest_review r ON r.target_type='fact' AND r.target_id=f.fact_id")
        vcol = "r.verdict AS verdict"
    else:
        verdict_sql, vcol = "", "NULL AS verdict"
    rows = conn.execute("""
        SELECT f.*, %s, (SELECT COUNT(*) FROM dangling_citation d WHERE d.entity_type=f.entity_type AND d.entity_id=f.entity_id) AS n_dangling
          FROM fact f %s
         ORDER BY f.location_id, (f.astro_from IS NULL), f.astro_from, f.entity_type, f.entity_name, f.kind, f.fact_id
    """ % (vcol, verdict_sql)).fetchall()
    locs = conn.execute("SELECT id, name, kind, scope_note FROM location ORDER BY (kind='national') DESC, id").fetchall()
    sources = {r["id"]: r for r in conn.execute("SELECT * FROM source")}

    os.makedirs(a.out_dir, exist_ok=True)
    md_tmp = os.path.join(a.out_dir, "factsheet.md.tmp")
    csv_tmp = os.path.join(a.out_dir, "factsheet.csv.tmp")
    total = unsrc = conj = 0
    with open(md_tmp, "w", encoding="utf-8") as md, open(csv_tmp, "w", encoding="utf-8", newline="") as cf:
        w = csv.writer(cf)
        w.writerow(["location_id", "fact_id", "entity_type", "entity_id", "entity_name", "kind", "date_from", "date_to",
                    "year_from", "year_to", "statement", "evidence", "confidence", "source_ids", "n_sources", "flags",
                    "verdict", "origin_file", "origin_path"])
        md.write("# Fact sheet\n\nGenerated from `data/db/history.sqlite` by `scripts/db/export_factsheet.py`. "
                 "Do not edit: the JSON under `data/` is the source of truth. Dates are historical years (no year 0).\n\n"
                 "Flags: **UNSOURCED** = the entity cites no source; **SOURCE-ID-UNDEFINED** = it cites ids that no sources file defines; **CONJECTURAL** = evidence class conjectural; "
                 "**LOW-CONF** = confidence low; `review:` = latest verdict recorded in curated.sqlite.\n\n")
        for loc in locs:
            lr = [r for r in rows if r["location_id"] == loc["id"]]
            if not lr:
                continue
            md.write("## %s (`%s`)\n\n%s\n\n" % (loc["name"], loc["id"], loc["scope_note"] or ""))
            md.write("%d facts; %d unsourced; %d conjectural.\n\n" % (
                len(lr), sum(1 for r in lr if r["n_sources"] == 0 and not r["n_dangling"]), sum(1 for r in lr if r["evidence"] == "conjectural")))
            md.write("| Date | What | Entity | Evidence | Conf. | Sources | Flags |\n|---|---|---|---|---|---|---|\n")
            cited = set()
            for r in lr:
                if r["kind"] == "located_at":
                    what = "located at %.5f, %.5f" % (r["lat"], r["lon"])
                else:
                    what = "%s: %s" % (r["kind"].replace("_", " "), r["value_text"] or "")
                fl = flags(r)
                for s in (r["source_ids"] or "").split(","):
                    if s:
                        cited.add(s)
                md.write("| %s | %s | %s (%s) | %s | %s | %s | %s |\n" % (
                    date_range(r["year_from"], r["year_to"], r["kind"]), esc(what), esc(r["entity_name"]), r["entity_type"],
                    r["evidence"] or "", r["confidence"] or "", esc(r["source_ids"] or "none"),
                    "**" + "** **".join(fl) + "**" if fl else ""))
                w.writerow([r["location_id"], r["fact_id"], r["entity_type"], r["entity_id"], r["entity_name"], r["kind"],
                            yl(r["year_from"]), yl(r["year_to"]), r["year_from"], r["year_to"],
                            (what if r["kind"] == "located_at" else r["value_text"]), r["evidence"], r["confidence"],
                            r["source_ids"], r["n_sources"], " ".join(fl), r["verdict"], r["origin_file"], r["origin_path"]])
                total += 1
                unsrc += r["n_sources"] == 0 and not r["n_dangling"]
                conj += r["evidence"] == "conjectural"
            if cited:
                md.write("\n### Sources cited at %s\n\n" % loc["name"])
                for s in sorted(cited):
                    sr = sources.get(s)
                    md.write("- `%s`: %s%s%s\n" % (s, sr["title"] if sr else "(title unknown)",
                                                   " (%s)" % sr["publisher"] if sr and sr["publisher"] else "",
                                                   " <%s>" % sr["url"] if sr and sr["url"] else ""))
            md.write("\n")
        if use_cur:
            cf_rows = conn.execute("SELECT * FROM cur.curated_fact ORDER BY location_id, astro_from, id").fetchall()
            if cf_rows:
                md.write("## Curated facts (fact-keeper additions)\n\n| Location | Date | Statement | Status | Confidence | Entity |\n|---|---|---|---|---|---|\n")
                for c in cf_rows:
                    md.write("| %s | %s | %s | %s | %s | %s |\n" % (
                        c["location_id"] or "", date_range(c["year_from"], c["year_to"], "x") if c["year_from"] else "undated",
                        esc(c["statement"]), c["status"], c["confidence"] or "", esc("%s %s" % (c["entity_type"] or "", c["entity_id"] or ""))))
                md.write("\n")
    os.replace(md_tmp, os.path.join(a.out_dir, "factsheet.md"))
    os.replace(csv_tmp, os.path.join(a.out_dir, "factsheet.csv"))
    print("wrote %s and factsheet.csv: %d facts, %d unsourced, %d conjectural" % (os.path.join(a.out_dir, "factsheet.md"), total, unsrc, conj))
    return 0


if __name__ == "__main__":
    sys.exit(main())
