#!/usr/bin/env python3
"""TRIPP D04-C.4A.5 importer for Supabase SQL Editor result exports.

Takes the files the founder downloaded from the SQL Editor result panel ("Export -> Download CSV",
or a saved "Copy as JSON"), reassembles each step's chunks, and refuses anything incomplete or
inconsistent. On success it writes OUT/tripp_<step>.json in exactly the format the psql path
produces, plus an empty tripp_<step>.stderr (the SQL Editor has no stderr; any error shows in the
browser and means STOP), so the pinned validate.py and make_share.py run unchanged.

Prints only OK/STOP lines and counts; never prints the payload.

Usage: python3 import_editor_results.py FILE [FILE ...]   (TRIPP_OUT overrides ~/tripp-inspect/out)
Exit 0 only when every file imports cleanly.
"""
import csv, hashlib, io, json, os, sys

csv.field_size_limit(1 << 30)
HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
OUT = os.path.expanduser(os.environ.get("TRIPP_OUT", "~/tripp-inspect/out"))
SOURCES = {"qid": ("qid_identity_session.sql", 3, "5s", "2s"),
           "q0": ("q0_migration_history.sql", 3, "5s", "2s"),
           "q1": ("q1_catalog_inspection.sql", 1, "15s", "2s")}
COLS = ["step", "part", "parts", "sha256", "chunk"]
fails = []


def need(cond, msg):
    print(("OK    " if cond else "STOP  ") + msg)
    if not cond:
        fails.append(msg)
    return bool(cond)


def pinned_sha(fname):
    for line in open(os.path.join(PKG, "SHA256SUMS"), encoding="utf-8"):
        h, _, f = line.strip().partition("  ")
        if f == fname:
            return h
    return None


def read_rows(path):
    text = open(path, encoding="utf-8-sig").read()
    s = text.lstrip()
    if s.startswith("["):
        rows = json.loads(s)
    else:
        rdr = csv.DictReader(io.StringIO(text))
        rows = list(rdr)
    return [{k: (str(r[k]) if r.get(k) is not None else None) for k in COLS} for r in rows]


def import_file(path):
    name = os.path.basename(path)
    try:
        rows = read_rows(path)
    except Exception as e:
        return need(False, f"{name}: readable as SQL Editor CSV/JSON export ({type(e).__name__})")
    if not need(rows and all(all(r.get(k) for k in COLS) for r in rows), f"{name}: rows carry step/part/parts/sha256/chunk"):
        return
    steps = {r["step"] for r in rows}
    if not need(len(steps) == 1 and next(iter(steps)) in SOURCES, f"{name}: exactly one known step ({sorted(steps)})"):
        return
    step = steps.pop()
    for ext in ("json", "stderr"):  # never leave an older file behind a failed import of the same step
        try: os.remove(os.path.join(OUT, f"tripp_{step}.{ext}"))
        except FileNotFoundError: pass
    fname, ndocs, st_to, lk_to = SOURCES[step]
    parts_decl = {r["parts"] for r in rows}; shas = {r["sha256"] for r in rows}
    if not need(len(parts_decl) == 1 and len(shas) == 1, f"{step}: all rows agree on parts and sha256"):
        return
    parts = int(parts_decl.pop()); sha = shas.pop()
    nums = sorted(int(r["part"]) for r in rows)
    if not need(nums == list(range(1, parts + 1)), f"{step}: every part 1..{parts} present exactly once (got {len(nums)} rows)"):
        return
    payload = "".join(r["chunk"] for r in sorted(rows, key=lambda r: int(r["part"])))
    if not need(hashlib.sha256(payload.encode("utf-8")).hexdigest() == sha, f"{step}: reassembled payload matches its SHA-256 (no truncation or edits)"):
        return
    try:
        doc = json.loads(payload)
    except Exception:
        return need(False, f"{step}: payload parses as JSON")
    env, docs = doc.get("editor_envelope", {}), doc.get("documents")
    need(env.get("mode") == "sql-editor" and env.get("editor_version") == "1" and env.get("step") == step, f"{step}: envelope mode/version/step")
    need(env.get("source_file") == fname and env.get("source_sha256") == pinned_sha(fname),
         f"{step}: generated from the pinned {fname} (hash matches SHA256SUMS)")
    need(env.get("transaction_read_only") == "on", f"{step}: transaction_read_only = on during the run")
    need(env.get("default_transaction_read_only") == "on", f"{step}: default_transaction_read_only = on during the run")
    need(env.get("search_path") == "pg_catalog, pg_temp", f"{step}: search_path = 'pg_catalog, pg_temp' during the run")
    need(env.get("statement_timeout") == st_to and env.get("lock_timeout") == lk_to, f"{step}: timeouts {st_to}/{lk_to} in effect")
    need(env.get("write_xid_assigned") is None, f"{step}: no write transaction id was assigned (nothing written)")
    expected_user = os.environ.get("TRIPP_CI_EXPECTED_USER", "postgres")
    if expected_user != "postgres":
        print(f"WARN  CI override: expecting role {expected_user!r} instead of 'postgres' (never set this for production)")
    need(env.get("current_user") == expected_user, f"{step}: executed as role {expected_user}")
    if not need(isinstance(docs, list) and len(docs) == ndocs, f"{step}: {ndocs} document(s) inside"):
        return
    os.makedirs(OUT, mode=0o700, exist_ok=True)
    with open(os.path.join(OUT, f"tripp_{step}.json"), "w", encoding="utf-8") as f:
        f.write("\n".join(json.dumps(d, indent=4) for d in docs) + "\n")
    open(os.path.join(OUT, f"tripp_{step}.stderr"), "w").close()
    print(f"INFO  {step}: imported {parts} part(s)")


if len(sys.argv) < 2:
    print("usage: python3 import_editor_results.py FILE [FILE ...]"); sys.exit(64)
for p in sys.argv[1:]:
    import_file(p)
print("\nRESULT: " + ("IMPORTED" if not fails else f"STOP - {len(fails)} check(s) failed; do not continue and do not share anything"))
sys.exit(1 if fails else 0)
