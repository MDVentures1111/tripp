#!/usr/bin/env python3
"""D04-C.4A.5 CI-only test of the Supabase SQL Editor execution package.

Submits the exact generated *_editor.sql files to the disposable local Supabase stack through:
  * psql -c "<whole file>"  (one simple-protocol Query message, the same way the editor sends it)
  * the local postgres-meta /query endpoint behind Kong   (the service the SQL Editor uses)
  * the local Studio /api/platform/pg-meta/default/query route, when Studio answers
then imports the results with operator/import_editor_results.py, validates them with the pinned
validate.py, and builds the share file with make_share.py.

Local stack only. The local service-role key is the CLI's published demo key and is never printed.
Raw output stays in a temp dir and is deleted; logs carry PASS/FAIL lines and counts only.
"""
import csv, io, json, os, shutil, subprocess, sys, tempfile, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
OP, ED = os.path.join(PKG, "operator"), os.path.join(PKG, "editor")
sys.path.insert(0, ED)
import build_editor_sql as B  # noqa: E402

CONTAINER = os.environ.get("TRIPP_DB_CONTAINER", "supabase_db_tripp")
API_URL = os.environ.get("API_URL", "http://127.0.0.1:54321").rstrip("/")
STUDIO_URL = os.environ.get("STUDIO_URL", "http://127.0.0.1:54323").rstrip("/")
SRK = os.environ.get("SERVICE_ROLE_KEY", "")
WORK = tempfile.mkdtemp(prefix="d04c4-ed-")
STEPS = ["qid", "q0", "q1"]
results = []


def check(cid, ok, detail=""):
    results.append((cid, bool(ok)))
    print(f"[{'PASS' if ok else 'FAIL'}] {cid}" + (f" :: {detail}" if detail else ""), flush=True)
    return bool(ok)


def editor_sql(step):
    return open(os.path.join(ED, f"{step}_editor.sql"), encoding="utf-8").read()


def dpsql(args, sql=None):
    cmd = ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", *args]
    return subprocess.run(cmd, input=sql, capture_output=True, text=True, timeout=120)


def http_query(url, sql, headers):
    req = urllib.request.Request(url, data=json.dumps({"query": sql}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")
    except Exception as e:  # unreachable endpoint
        return 0, f"{type(e).__name__}"


def pgmeta(sql):
    return http_query(f"{API_URL}/pg/query", sql, {"apikey": SRK, "Authorization": f"Bearer {SRK}"})


def studio(sql):
    return http_query(f"{STUDIO_URL}/api/platform/pg-meta/default/query", sql, {})


def importer(files, out, env_extra=None):
    env = {**os.environ, "TRIPP_OUT": out, **(env_extra or {})}
    p = subprocess.run([sys.executable, os.path.join(OP, "import_editor_results.py"), *files], capture_output=True, text=True, env=env)
    return p.returncode, p.stdout


def validate(out):
    p = subprocess.run([sys.executable, os.path.join(OP, "validate.py"), out], capture_output=True, text=True)
    return p.returncode, p.stdout


def rows_from_http(body):
    data = json.loads(body)
    if isinstance(data, dict):  # some versions wrap results
        data = data.get("result", data.get("rows", data))
    return data if isinstance(data, list) else []


def envelope_user(rows):
    payload = "".join(r["chunk"] for r in sorted(rows, key=lambda r: int(r["part"])))
    return json.loads(payload)["editor_envelope"]["current_user"]


def pinned_docs(fname):
    r = dpsql(["-t", "-A", "-c", "SET search_path = pg_catalog, pg_temp", "-c", "SET default_transaction_read_only = on", "-f", "-"],
              open(os.path.join(PKG, fname), encoding="utf-8").read())
    if r.returncode != 0:
        return None
    text, dec, i, out = r.stdout.strip(), json.JSONDecoder(), 0, []
    while i < len(text):
        while i < len(text) and text[i].isspace(): i += 1
        if i >= len(text): break
        o, i = dec.raw_decode(text, i); out.append(o)
    return out


def strip_volatile(o):
    if isinstance(o, dict):
        return {k: strip_volatile(v) for k, v in o.items() if k != "captured_at"}
    if isinstance(o, list):
        return [strip_volatile(v) for v in o]
    return o


def main():
    # ---- E0: package integrity ----
    p = subprocess.run([sys.executable, os.path.join(ED, "build_editor_sql.py"), "--check"], capture_output=True, text=True)
    check("E0.editor-files-are-a-fresh-mechanical-build-of-pinned-sources", p.returncode == 0, p.stdout.strip())
    p = subprocess.run(["sha256sum", "-c", "SHA256SUMS"], cwd=PKG, capture_output=True, text=True)
    check("E0.sha256sums-verify", p.returncode == 0)
    for s in STEPS:
        sql = editor_sql(s)
        kinds = [B.strip_leading_comments(x).split(None, 1)[0].upper() for x in B.split_statements(sql) if B.strip_leading_comments(x)]
        check(f"E0.{s}-only-SET-LOCAL-then-one-final-SELECT", kinds[:-1] == ["SET"] * (len(kinds) - 1) and kinds[-1] == "WITH"
              and not any(k in ("BEGIN", "COMMIT", "ROLLBACK", "END") for k in kinds), ",".join(kinds))
    r = dpsql(["-f", "-"], open(os.path.join(HERE, "hostile_fixtures.sql")).read())
    check("E0.hostile-fixtures-applied", r.returncode == 0, r.stderr.strip()[:200])

    # ---- E1: one simple-protocol Query message per step (psql -c "<whole file>") ----
    d1 = os.path.join(WORK, "psqlc"); os.makedirs(d1)
    files = []
    for s in STEPS:
        r = dpsql(["--csv", "-c", editor_sql(s)])
        f = os.path.join(d1, f"{s}.csv"); open(f, "w").write(r.stdout); files.append(f)
        check(f"E1.{s}-single-submission-succeeds", r.returncode == 0 and not r.stderr.strip(), r.stderr.strip()[:200])
    out1 = os.path.join(d1, "base", "out")
    rc, txt = importer(files, out1)
    check("E1.importer-accepts-exact-export", rc == 0 and "RESULT: IMPORTED" in txt, "; ".join(l for l in txt.splitlines() if l.startswith("STOP")))
    q1parts = sum(1 for _ in csv.DictReader(open(files[2])))
    check("E1.q1-payload-is-chunked", q1parts >= 2, f"{q1parts} parts")
    rc, txt = validate(out1)
    check("E1.pinned-validator-complete-on-imported-output", rc == 0 and "RESULT: COMPLETE" in txt,
          "; ".join(l for l in txt.splitlines() if l.startswith("STOP")))

    # ---- E2: same logic as the pinned psql path ----
    for s, fname, _, _ in [(k, *v) for k, v in {"qid": ("qid_identity_session.sql", 0, 0), "q0": ("q0_migration_history.sql", 0, 0),
                                                  "q1": ("q1_catalog_inspection.sql", 0, 0)}.items()]:
        ref = pinned_docs(fname)
        txt = open(os.path.join(out1, f"tripp_{s}.json")).read().strip()
        dec, i, got = json.JSONDecoder(), 0, []
        while i < len(txt):
            while i < len(txt) and txt[i].isspace(): i += 1
            if i >= len(txt): break
            o, i = dec.raw_decode(txt, i); got.append(o)
        check(f"E2.{s}-documents-identical-to-pinned-psql-path", ref is not None and strip_volatile(ref) == strip_volatile(got),
              f"pinned={len(ref or [])} editor={len(got)}")

    # ---- E3: through postgres-meta (the SQL Editor's execution service) ----
    d3 = os.path.join(WORK, "pgmeta"); os.makedirs(d3)
    status, body = pgmeta("select 1 as ok")
    if not check("E3.pgmeta-reachable", status == 200, f"HTTP {status}"):
        print("::notice title=E3 postgres-meta::NOT REACHABLE")
    else:
        files, users = [], set()
        for s in STEPS:
            status, body = pgmeta(editor_sql(s))
            rows = rows_from_http(body) if status == 200 else []
            check(f"E3.{s}-pgmeta-returns-chunk-rows", status == 200 and rows and "chunk" in rows[0], f"HTTP {status}, {len(rows)} rows")
            if rows:
                users.add(envelope_user(rows))
            f = os.path.join(d3, f"{s}.json"); open(f, "w").write(json.dumps(rows)); files.append(f)
        user = users.pop() if len(users) == 1 else "?"
        print(f"::notice title=E3 postgres-meta role::local postgres-meta executes as {user}")
        out3 = os.path.join(d3, "out")
        rc, txt = importer(files, out3, {"TRIPP_CI_EXPECTED_USER": user} if user != "postgres" else None)
        check("E3.read-only-and-controls-in-effect-via-pgmeta", rc == 0 and "RESULT: IMPORTED" in txt,
              "; ".join(l for l in txt.splitlines() if l.startswith("STOP")))
        rc, txt = validate(out3)
        check("E3.pinned-validator-complete-via-pgmeta", rc == 0, "; ".join(l for l in txt.splitlines() if l.startswith("STOP")))
        # Observation only: how the editor service presents a file that ends in ROLLBACK.
        status, body = pgmeta(open(os.path.join(PKG, "q1_catalog_inspection.sql")).read())
        shown = rows_from_http(body) if status == 200 else []
        visible = any("tripp_d04c4_q1" in r for r in shown if isinstance(r, dict))
        print(f"::notice title=E3 ROLLBACK-ending original via postgres-meta::HTTP {status}; inspection row "
              f"{'VISIBLE (service returns the last non-empty result)' if visible else 'HIDDEN'}")
        # Read-only enforcement inside the same submission pattern.
        before = dpsql(["-t", "-A", "-c", "select count(*) from public.organizations"]).stdout.strip()
        status, body = pgmeta("SET LOCAL transaction_read_only = on; INSERT INTO public.organizations (name) VALUES ('ed-probe');")
        check("E3.mutation-rejected-under-editor-controls", status != 200 and "read-only transaction" in body, f"HTTP {status}")
        status, body = pgmeta("SET LOCAL transaction_read_only = on; SELECT 1; SET LOCAL transaction_read_only = off; "
                              "INSERT INTO public.organizations (name) VALUES ('ed-probe');")
        check("E3.read-only-cannot-be-switched-off-mid-submission", status != 200 and "must be set before any query" in body, f"HTTP {status}")
        after = dpsql(["-t", "-A", "-c", "select count(*) from public.organizations"]).stdout.strip()
        check("E3.no-rows-written", before == after, f"{before} -> {after}")
        # Lock contention: real lock_timeout on the ledger fails with no rows.
        holder = subprocess.Popen(["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-f", "-"],
                                  stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True)
        holder.stdin.write("BEGIN; LOCK TABLE supabase_migrations.schema_migrations IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(20); ROLLBACK;\n")
        holder.stdin.flush(); time.sleep(3)
        status, body = pgmeta(editor_sql("q0"))
        check("E3.lock-timeout-fails-closed-no-rows", status != 200 and "lock timeout" in body, f"HTTP {status}")
        holder.stdin.close(); holder.wait(timeout=40)

    # ---- E3b: Studio's own SQL Editor API route (when Studio is up) ----
    status, body = studio("select 1 as ok")
    if status != 200:
        print(f"::notice title=E3b Studio route::NOT REPRODUCED (HTTP {status})")
    else:
        d = os.path.join(WORK, "studio"); os.makedirs(d); files = []
        for s in STEPS:
            status, body = studio(editor_sql(s))
            rows = rows_from_http(body) if status == 200 else []
            f = os.path.join(d, f"{s}.json"); open(f, "w").write(json.dumps(rows)); files.append(f)
            check(f"E3b.{s}-studio-route-returns-chunk-rows", status == 200 and rows, f"HTTP {status}, {len(rows)} rows")
        user = envelope_user(json.load(open(files[0]))) if json.load(open(files[0])) else "?"
        rc, txt = importer(files, os.path.join(d, "out"), {"TRIPP_CI_EXPECTED_USER": user} if user != "postgres" else None)
        check("E3b.controls-in-effect-via-studio-route", rc == 0, "; ".join(l for l in txt.splitlines() if l.startswith("STOP")))
        print(f"::notice title=E3b Studio route::REPRODUCED (executes as {user})")

    # ---- E4: fail closed if the editor does not keep SET LOCAL (statements run separately) ----
    stmts = [x for x in B.split_statements(editor_sql("q0")) if B.strip_leading_comments(x)]
    args = []
    for x in stmts:
        args += ["-c", x]
    r = dpsql(["--csv", *args])
    check("E4.separate-statements-fail-closed-before-any-result", r.returncode != 0 and "TRIPP-STOP" in r.stderr and "chunk" not in r.stdout)

    # ---- E5: importer refuses damaged or inconsistent exports ----
    good = list(csv.DictReader(open(os.path.join(d1, "q1.csv"))))
    def write(name, rows):
        f = os.path.join(WORK, name + ".csv")
        with open(f, "w", newline="") as h:
            w = csv.DictWriter(h, fieldnames=["step", "part", "parts", "sha256", "chunk"]); w.writeheader(); w.writerows(rows)
        return f
    cases = {
        "missing-last-part": good[:-1],
        "duplicate-part": good + [good[0]],
        "truncated-chunk": [dict(good[0], chunk=good[0]["chunk"][:-50])] + good[1:],
        "edited-chunk": [dict(good[0], chunk=good[0]["chunk"].replace('"on"', '"of"', 1))] + good[1:],
        "empty": [],
    }
    for name, rows in cases.items():
        rc, _ = importer([write(name, rows)], os.path.join(WORK, f"neg-{name}"))
        check(f"E5.importer-stops-on-{name}", rc != 0)
    # Re-hashed forgery with read-only off is still refused on the envelope.
    payload = json.loads("".join(r["chunk"] for r in good)); payload["editor_envelope"]["transaction_read_only"] = "off"
    t = json.dumps(payload); import hashlib
    forged = [{"step": "q1", "part": "1", "parts": "1", "sha256": hashlib.sha256(t.encode()).hexdigest(), "chunk": t}]
    rc, txt = importer([write("forged", forged)], os.path.join(WORK, "neg-forged"))
    check("E5.importer-stops-on-read-only-off-envelope", rc != 0 and "STOP  q1: transaction_read_only" in txt)
    rc, _ = importer([os.path.join(d1, "q1.csv")], os.path.join(WORK, "neg-role"), {"TRIPP_CI_EXPECTED_USER": "someone_else"})
    check("E5.importer-stops-on-unexpected-role", rc != 0)
    # A failed re-import never leaves an older good file behind.
    stale = os.path.join(WORK, "stale"); shutil.copytree(out1, stale)
    importer([write("stale-trunc", cases["truncated-chunk"])], stale)
    check("E5.failed-import-removes-older-step-file", not os.path.exists(os.path.join(stale, "tripp_q1.json")))

    # ---- E6: sanitized share from editor-imported output ----
    base = os.path.dirname(out1)
    p = subprocess.run([sys.executable, os.path.join(OP, "make_share.py"), base], capture_output=True, text=True)
    check("E6.share-builder-exit-0", p.returncode == 0, p.stdout.strip().splitlines()[-1] if p.stdout.strip() else p.stderr[-200:])
    share = open(os.path.join(base, "share", "tripp_d04c4_share.json")).read()
    planted = ["ops@example.com", "https://example.invalid/hook", "eyJhbGciOiJIUzI1NiJ9", "00000000-0000-4000-8000-00000000c1c1",
               "TRIPWIRE_EXECUTED", "mentions deals", "$function$", "CREATE OR REPLACE FUNCTION"]
    check("E6.share-withholds-planted-sensitive-material", not [x for x in planted if x in share])
    check("E6.share-never-contains-identity-fingerprint", "system_identifier" not in share and "storage_bucket_ids" not in share)

    failed = [c for c, ok in results if not ok]
    print(f"\nSQL EDITOR PATH SUMMARY: {len(results) - len(failed)}/{len(results)} passed")
    print(f"::notice title=SQL Editor path checks::{len(results) - len(failed)}/{len(results)} passed" + (f"; FAILED: {', '.join(failed)}" if failed else ""))
    with open(os.environ.get("GITHUB_STEP_SUMMARY", os.devnull), "a") as f:
        f.write(f"### D04-C.4A.5 SQL Editor path\n{len(results) - len(failed)}/{len(results)} checks passed\n")
        for c, ok in results: f.write(f"- {'PASS' if ok else 'FAIL'} {c}\n")
    shutil.rmtree(WORK, ignore_errors=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
