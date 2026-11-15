#!/usr/bin/env python3
"""List corrections the fact-keeper proposed, so someone can apply them to the JSON.

    python3 scripts/db/list_proposed_corrections.py                 # accepted but not yet applied
    python3 scripts/db/list_proposed_corrections.py --all           # also 'proposed' (not yet accepted)
    python3 scripts/db/list_proposed_corrections.py --mark-applied 7 --note "edited london/landmarks.json, commit abc123"

The JSON files under data/ are what the app reads. This script never edits
them. Workflow: apply the change to the JSON by hand, run build.py, then
--mark-applied. A correction whose target fact_id no longer exists in
history.sqlite is flagged STALE (the JSON changed since the review).
"""
import argparse
import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DBDIR = os.path.join(ROOT, "data", "db")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.join(DBDIR, "history.sqlite"))
    ap.add_argument("--curated", default=os.path.join(DBDIR, "curated.sqlite"))
    ap.add_argument("--all", action="store_true", help="include corrections still in status 'proposed'")
    ap.add_argument("--mark-applied", type=int, metavar="REVIEW_ID")
    ap.add_argument("--note", default=None)
    a = ap.parse_args(argv)
    if not os.path.exists(a.curated):
        print("curated.sqlite not found: run python3 scripts/db/init_curated.py", file=sys.stderr)
        return 2
    cur = sqlite3.connect(a.curated)
    cur.row_factory = sqlite3.Row
    if a.mark_applied is not None:
        n = cur.execute("UPDATE fact_review SET correction_status='applied', applied_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'), "
                        "applied_note=? WHERE id=? AND proposed_correction IS NOT NULL", (a.note, a.mark_applied)).rowcount
        cur.commit()
        print("marked review %d applied" % a.mark_applied if n else "no review %d with a proposed correction" % a.mark_applied)
        return 0 if n else 1
    hist = sqlite3.connect("file:%s?mode=ro" % a.db, uri=True) if os.path.exists(a.db) else None
    hist and setattr(hist, "row_factory", sqlite3.Row)
    statuses = ("accepted", "proposed") if a.all else ("accepted",)
    q = ("SELECT * FROM v_latest_review WHERE proposed_correction IS NOT NULL AND applied_at IS NULL "
         "AND correction_status IN (%s) ORDER BY reviewed_at, id" % ",".join("?" * len(statuses)))
    rows = cur.execute(q, statuses).fetchall()
    if not rows:
        print("No %s corrections waiting to be applied." % ("accepted or proposed" if a.all else "accepted"))
        return 0
    print("%d correction(s) to apply to the JSON under data/ (then rebuild: python3 scripts/db/build.py):\n" % len(rows))
    for r in rows:
        print("review #%d  [%s]  by %s on %s" % (r["id"], r["correction_status"], r["reviewer"], r["reviewed_at"]))
        print("  target: %s %s" % (r["target_type"], r["target_id"]))
        f = None
        if r["target_type"] == "fact" and hist is not None:
            f = hist.execute("SELECT * FROM fact WHERE fact_id=?", (r["target_id"],)).fetchone()
            if f is None:
                print("  STALE: this fact_id no longer exists in history.sqlite (the JSON changed); re-check before applying.")
            else:
                print("  currently: [%s] %s  (%s - %s)  in %s at %s" % (f["kind"], f["value_text"], f["year_from"], f["year_to"],
                                                                      f["origin_file"], f["origin_path"]))
        try:
            pc = json.loads(r["proposed_correction"])
            print("  proposed: " + json.dumps(pc, ensure_ascii=False))
            if f is not None and not (pc.get("file") and pc.get("path")):
                print("  apply at: data/%s  %s" % (f["origin_file"], f["origin_path"]))
        except ValueError:
            print("  proposed (not valid JSON): %s" % r["proposed_correction"])
        if r["note"]:
            print("  note: %s" % r["note"])
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
