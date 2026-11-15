#!/usr/bin/env python3
"""Create data/db/curated.sqlite (the fact-keeper's writable layer) if it does not exist.

    python3 scripts/db/init_curated.py [--out PATH]

Safe to re-run: the schema uses CREATE ... IF NOT EXISTS, so an existing file
keeps all its rows (new tables/views from a newer schema_curated.sql are added).
build.py never opens or writes this file.
"""
import argparse
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "db", "curated.sqlite"))
    a = ap.parse_args(argv)
    existed = os.path.exists(a.out)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    conn = sqlite3.connect(a.out)
    with open(os.path.join(HERE, "schema_curated.sql"), encoding="utf-8") as f:
        conn.executescript(f.read())
    conn.commit()
    n = conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
    conn.close()
    print("%s %s (%d tables); existing rows were left untouched." % ("Updated schema of" if existed else "Created", a.out, n))
    return 0


if __name__ == "__main__":
    sys.exit(main())
