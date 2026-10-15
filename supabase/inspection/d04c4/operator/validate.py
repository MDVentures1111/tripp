#!/usr/bin/env python3
"""TRIPP D04-C.4A.3 operator validator for Q-ID, Q0 and Q1 output.

Runs locally on the operator's machine. Prints only OK/STOP lines and counts; never prints
definitions, policy text, literals, bucket ids or table names from the database.

Usage:  python3 validate.py [OUTPUT_DIR] [--stage qid|q0|q1|all]
Exit status 0 only when every check for the requested stage passes.
"""
import json, os, sys

args = [a for a in sys.argv[1:] if not a.startswith("--")]
stage = "all"
for a in sys.argv[1:]:
    if a.startswith("--stage="):
        stage = a.split("=", 1)[1]
OUT = os.path.expanduser(args[0] if args else os.environ.get("TRIPP_OUT", "~/tripp-inspect/out"))
EXPECTED_SEARCH_PATH = "pg_catalog, pg_temp"
Q1_KEYS = ["capture", "missing_tables", "tables", "columns", "enum_types", "constraints", "inbound_foreign_keys",
           "indexes", "policies", "table_grants", "column_grants", "triggers", "functions",
           "effective_table_privileges", "schema_privileges", "role_attributes", "default_privileges",
           "storage_policies", "dependent_views", "sensitive_literal_flags"]
STATUSES = {"present", "absent_schema", "absent_table", "present_unexpected_columns", "present_not_readable"}
fails = []


def need(cond, msg):
    print(("OK    " if cond else "STOP  ") + msg)
    if not cond:
        fails.append(msg)
    return bool(cond)


def docs(path):
    text = open(path, encoding="utf-8").read().strip()
    dec, i, out = json.JSONDecoder(), 0, []
    while i < len(text):
        while i < len(text) and text[i].isspace():
            i += 1
        if i >= len(text):
            break
        obj, i = dec.raw_decode(text, i)
        out.append(obj)
    return out


def load(name):
    """Return parsed documents, or None after recording a STOP."""
    out_path, err_path = os.path.join(OUT, f"tripp_{name}.json"), os.path.join(OUT, f"tripp_{name}.stderr")
    if not need(os.path.isfile(out_path), f"{name}: output file exists"):
        return None
    need(os.path.isfile(err_path) and os.path.getsize(err_path) == 0, f"{name}: stderr file exists and is empty")
    need(os.path.getsize(out_path) > 0, f"{name}: output file is not empty")
    try:
        return docs(out_path)
    except Exception as e:  # truncated or non-JSON output
        need(False, f"{name}: output parses as complete JSON ({type(e).__name__})")
        return None


def session_checks(name, head):
    need(head.get("transaction_read_only") == "on", f"{name}: transaction_read_only = on")


def check_qid():
    d = load("qid")
    if d is None:
        return
    if not need(len(d) == 3, f"qid: 3 JSON documents (got {len(d)})"):
        return
    head, ledger, buckets = d
    need(head.get("tool") == "tripp-d04c4-qid" and head.get("version") == "2", "qid: tool tripp-d04c4-qid version 2")
    session_checks("qid", head)
    need(head.get("session_default_transaction_read_only") == "on",
         "qid: session default_transaction_read_only = on (psql -c SET persisted into the file)")
    need(head.get("session_search_path") == EXPECTED_SEARCH_PATH,
         f"qid: session search_path = '{EXPECTED_SEARCH_PATH}' (psql -c SET persisted into the file)")
    ls, bs = ledger.get("ledger_status"), buckets.get("buckets_status")
    need(ls in STATUSES, f"qid: ledger status is an explicit finding ({ls})")
    need((ls == "present") == isinstance(ledger.get("migration_count"), int),
         "qid: ledger fingerprint present exactly when the ledger is present")
    need(bs in STATUSES, f"qid: buckets status is an explicit finding ({bs})")
    need((bs == "present") == isinstance(buckets.get("storage_bucket_ids"), list),
         "qid: bucket fingerprint present exactly when storage.buckets is present")
    need(head.get("migration_ledger_present") is (ls not in ("absent_schema", "absent_table")), "qid: ledger presence flags agree")
    if ls != "present":
        print(f"INFO  qid: FINDING migration ledger status = {ls}; the Dashboard Migrations page should show no CLI migration history")
    print("INFO  identity fingerprint is in tripp_qid.json - compare it with the Dashboard by eye (runbook step B2); do not share it")


def check_q0():
    d = load("q0")
    if d is None:
        return
    if not need(len(d) == 3, f"q0: 3 JSON documents (got {len(d)})"):
        return
    head, versions, bucket = d
    need(head.get("tool") == "tripp-d04c4-q0" and head.get("version") == "3", "q0: tool tripp-d04c4-q0 version 3")
    session_checks("q0", head)
    ls, bs = head.get("ledger_status"), head.get("buckets_status")
    need(ls in STATUSES and bs in STATUSES, f"q0: ledger/buckets status are explicit findings ({ls}/{bs})")
    need(ls == "present" or versions == [], "q0: no ledger rows unless the ledger is present")
    need(bs == "present" or bucket == [], "q0: no bucket rows unless storage.buckets is present")
    need(isinstance(head.get("ledger_candidates"), list), "q0: ledger candidate list present")
    if ls != "present":
        print(f"INFO  q0: FINDING migration ledger status = {ls}; other ledger-like tables found = {len(head.get('ledger_candidates') or [])}")
    need(isinstance(versions, list) and all(set(v) == {"version", "name"} for v in versions),
         f"q0: ledger rows carry only version+name ({len(versions) if isinstance(versions, list) else '?'} rows)")
    need(isinstance(bucket, list), "q0: bucket section is a list")
    if isinstance(bucket, list):
        print(f"INFO  q0: tripp-deal-documents bucket rows = {len(bucket)}")


def check_q1():
    d = load("q1")
    if d is None:
        return
    if not need(len(d) == 1, f"q1: exactly 1 JSON document (got {len(d)})"):
        return
    q1 = d[0]
    missing = [k for k in Q1_KEYS if k not in q1]
    need(not missing, f"q1: all 20 list sections present (missing: {missing or 'none'})")
    cap = q1.get("capture", {})
    need(cap.get("tool") == "tripp-d04c4-q1" and cap.get("version") == "2.2", "q1: tool tripp-d04c4-q1 version 2.2")
    po = q1.get("platform_objects")
    need(isinstance(po, dict) and all(isinstance(po.get(k), list) for k in ("schemas", "roles", "relations", "api_roles_checked")),
         "q1: platform_objects section present")
    roles_checked = (po or {}).get("api_roles_checked") or []
    absent = [x.get("role") for x in (po or {}).get("roles", []) if not x.get("present")] + \
             [x.get("relation") for x in (po or {}).get("relations", []) if not x.get("present")]
    if absent:
        print(f"INFO  q1: FINDING platform objects absent = {absent}")
    session_checks("q1", cap)
    need(all(isinstance(q1.get(k), list) for k in Q1_KEYS[1:]), "q1: every section is a list (no null sections)")
    tables = q1.get("tables") or []
    need(len(q1.get("effective_table_privileges") or []) == len(tables) * len(roles_checked) * 7,
         f"q1: effective privilege matrix complete ({len(tables) * len(roles_checked) * 7} rows expected)")
    print(f"INFO  q1: target tables present = {len(tables)}, missing = {len(q1.get('missing_tables') or [])}")
    for k in Q1_KEYS[1:]:
        print(f"INFO  q1: {k} = {len(q1.get(k) or [])}")


for name, fn in (("qid", check_qid), ("q0", check_q0), ("q1", check_q1)):
    if stage in (name, "all"):
        fn()
print("\nRESULT: " + ("COMPLETE" if not fails else f"STOP - {len(fails)} check(s) failed; do not continue and do not share output"))
sys.exit(1 if fails else 0)
