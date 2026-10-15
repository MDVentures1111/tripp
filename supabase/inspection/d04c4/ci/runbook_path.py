#!/usr/bin/env python3
"""D04-C.4A.3 CI-only test of the operator execution path.

Drives operator/run_step.sh (the exact psql invocation in the runbook) over TCP against the
disposable local Supabase stack, answering psql's -W password prompt through a real pseudo-terminal,
then runs operator/validate.py and operator/make_share.py on the exact captured files.

Local stack only: 127.0.0.1, the CLI's documented local password. No production ref, no secrets.
Raw outputs stay in a temp dir and are deleted; the log carries only PASS/FAIL lines and counts.
"""
import json, os, pty, select, shutil, signal, socket, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
OP = os.path.join(PKG, "operator")
CONTAINER = os.environ.get("TRIPP_DB_CONTAINER", "supabase_db_tripp")
LOCAL_PW = "postgres"  # Supabase CLI local-stack default; not a secret
DIRECT = "host=127.0.0.1 port=54322 dbname={db} user=postgres sslmode={ssl} connect_timeout=10 application_name=tripp-d04c4-inspection"
POOLER_PORT = int(os.environ.get("TRIPP_POOLER_PORT", "54329"))
POOLER_USERS = ["postgres.pooler-dev", "postgres.tripp"]
WORK = tempfile.mkdtemp(prefix="d04c4-rb-")
results = []


def check(cid, ok, detail=""):
    results.append((cid, bool(ok)))
    print(f"[{'PASS' if ok else 'FAIL'}] {cid}" + (f" :: {detail}" if detail else ""), flush=True)
    return bool(ok)


def run_tty(argv, env, password=LOCAL_PW, timeout=90):
    """Run argv under a real pty (so psql -W reads /dev/tty); answer the password prompt. Returns (rc, transcript)."""
    pid, fd = pty.fork()
    if pid == 0:
        os.execvpe(argv[0], argv, env)
    buf, sent, deadline = b"", False, time.monotonic() + timeout
    while time.monotonic() < deadline:
        r, _, _ = select.select([fd], [], [], 0.5)
        if fd in r:
            try:
                chunk = os.read(fd, 4096)
            except OSError:  # EIO: child closed the pty (it exited)
                chunk = b""
            if not chunk:
                break
            buf += chunk
            if not sent and b"Password" in buf:
                os.write(fd, (password + "\n").encode()); sent = True
    else:
        os.kill(pid, signal.SIGKILL); os.waitpid(pid, 0); os.close(fd)
        return 124, buf.decode(errors="replace")
    _, status = os.waitpid(pid, 0)
    os.close(fd)
    return os.waitstatus_to_exitcode(status), buf.decode(errors="replace")


def step(name, conn, out, password=LOCAL_PW, pkg=PKG, extra_env=None):
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env.update({"TRIPP_CONN": conn, "TRIPP_OUT": out, **(extra_env or {})})
    return run_tty(["bash", os.path.join(pkg, "operator", "run_step.sh"), name], env, password)


def validate(out, stage="all"):
    p = subprocess.run([sys.executable, os.path.join(OP, "validate.py"), out, f"--stage={stage}"], capture_output=True, text=True)
    return p.returncode, p.stdout


def dexec(sql, db="postgres", user="postgres"):
    return subprocess.run(["docker", "exec", "-i", CONTAINER, "psql", "-U", user, "-d", db, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"],
                          input=sql, capture_output=True, text=True, timeout=60)


def full_run(label, conn, out):
    ok = True
    for s in ("qid", "q0", "q1"):
        rc, tr = step(s, conn, out)
        ok &= check(f"{label}.{s}-exit-0", rc == 0 and f"exit=0" in tr, f"rc={rc}")
        ok &= check(f"{label}.{s}-stderr-empty", os.path.isfile(f"{out}/tripp_{s}.stderr") and os.path.getsize(f"{out}/tripp_{s}.stderr") == 0)
    rc, vout = validate(out)
    ok &= check(f"{label}.validator-complete-on-exact-capture", rc == 0 and "RESULT: COMPLETE" in vout,
                "; ".join(l for l in vout.splitlines() if l.startswith("STOP")))
    return ok


def main():
    v = subprocess.run(["psql", "--version"], capture_output=True, text=True)
    check("R0.host-psql-available", v.returncode == 0, v.stdout.strip())
    r = dexec(open(os.path.join(HERE, "hostile_fixtures.sql")).read())
    check("R0.hostile-fixtures-applied", r.returncode == 0, r.stderr.strip()[:200])

    # ---- R1/R2: exact runbook path, direct TCP, -W prompt via pty, -c SETs, -f, -o, 2> ----
    out = os.path.join(WORK, "direct", "out"); os.makedirs(out)
    full_run("R1.direct", DIRECT.format(db="postgres", ssl="disable"), out)
    rc, vout = validate(out, "qid")
    check("R2.session-read-only-persisted-into-file", "OK    qid: session default_transaction_read_only = on" in vout)
    check("R2.session-search-path-persisted-into-file", "OK    qid: session search_path = 'pg_catalog, pg_temp'" in vout)
    check("R2.tripwires-not-fired-on-exact-path", "TRIPWIRE" not in open(f"{out}/tripp_q1.stderr").read())

    # ---- R3: validator rejects a run without the session controls ----
    neg = os.path.join(WORK, "noset", "out"); os.makedirs(neg)
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    cmd = (f'psql "{DIRECT.format(db="postgres", ssl="disable")}" -W --no-psqlrc --quiet --tuples-only --no-align '
           f'-v ON_ERROR_STOP=1 -f {PKG}/qid_identity_session.sql -o {neg}/tripp_qid.json 2> {neg}/tripp_qid.stderr')
    rc, _ = run_tty(["bash", "-c", cmd], env)
    rc2, vout = validate(neg, "qid")
    check("R3.validator-stops-when-session-controls-missing", rc == 0 and rc2 != 0 and "STOP  qid: session default_transaction_read_only" in vout
          and "STOP  qid: session search_path" in vout)

    # ---- R4: failures propagate a non-zero status and never validate ----
    def fail_case(cid, name, conn, expect_rc=None, password=LOCAL_PW, pkg=PKG, extra_env=None, stage=None):
        o = os.path.join(WORK, cid, "out"); os.makedirs(o, exist_ok=True)
        rc, tr = step(name, conn, o, password, pkg, extra_env)
        rcv, vout = validate(o, stage or name)
        good = rc != 0 and f"exit=0" not in tr and (expect_rc is None or rc == expect_rc) and rcv != 0 and "RESULT: STOP" in vout
        return check(f"R4.{cid}", good, f"run_step rc={rc}, validator rc={rcv}")

    fail_case("wrong-password-exit-2", "qid", DIRECT.format(db="postgres", ssl="disable"), 2, password="definitely-wrong")
    fail_case("tls-verify-full-unavailable-exit-2", "qid", DIRECT.format(db="postgres", ssl="verify-full sslrootcert=/nonexistent.crt"), 2)
    dexec("DROP DATABASE IF EXISTS ci_rb_scratch;"); dexec("CREATE DATABASE ci_rb_scratch;")
    for s in ("qid", "q0", "q1"):
        fail_case(f"missing-objects-{s}-exit-3", s, DIRECT.format(db="ci_rb_scratch", ssl="disable"), 3)
    # Real lock contention on the pinned files: hold ACCESS EXCLUSIVE on the ledger, expect lock_timeout.
    holder = subprocess.Popen(["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-f", "-"],
                              stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True)
    holder.stdin.write("BEGIN; LOCK TABLE supabase_migrations.schema_migrations IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(25); ROLLBACK;\n"); holder.stdin.flush()
    time.sleep(3)
    fail_case("lock-timeout-qid-exit-3", "qid", DIRECT.format(db="postgres", ssl="disable"), 3)
    fail_case("lock-timeout-q0-exit-3", "q0", DIRECT.format(db="postgres", ssl="disable"), 3)
    lk = os.path.join(WORK, "lock-timeout-q0-exit-3", "out", "tripp_q0.stderr")
    check("R4.lock-timeout-reported-in-stderr", os.path.isfile(lk) and "lock timeout" in open(lk).read())
    holder.stdin.close(); holder.wait(timeout=40)
    # Tampered artifact: run_step refuses before connecting.
    tpkg = os.path.join(WORK, "tampered"); shutil.copytree(PKG, tpkg, ignore=shutil.ignore_patterns("node_modules", "__pycache__"))
    with open(os.path.join(tpkg, "q0_migration_history.sql"), "a") as f: f.write("\n-- tampered\n")
    fail_case("checksum-mismatch-exit-66", "q0", DIRECT.format(db="postgres", ssl="disable"), 66, pkg=tpkg)
    fail_case("pgpassword-refused-exit-65", "qid", DIRECT.format(db="postgres", ssl="disable"), 65, extra_env={"PGPASSWORD": "x"})
    fail_case("password-in-conn-refused-exit-65", "qid", DIRECT.format(db="postgres", ssl="disable") + " password=x", 65)
    # Damaged captures from a good run never validate.
    for cid, mutate in [("truncated-json", lambda p: open(p, "r+").truncate(os.path.getsize(p) // 2)),
                        ("empty-json", lambda p: open(p, "w").close())]:
        d = os.path.join(WORK, cid, "out"); shutil.copytree(out, d)
        mutate(os.path.join(d, "tripp_q1.json"))
        rcv, _ = validate(d, "q1"); check(f"R4.validator-stops-on-{cid}", rcv != 0)
    d = os.path.join(WORK, "stderr-noise", "out"); shutil.copytree(out, d)
    open(os.path.join(d, "tripp_q1.stderr"), "w").write("psql: WARNING: something\n")
    rcv, _ = validate(d, "q1"); check("R4.validator-stops-on-nonempty-stderr", rcv != 0)

    # ---- R5: session pooler (only when the local supavisor is running) ----
    reachable = False
    try:
        socket.create_connection(("127.0.0.1", POOLER_PORT), timeout=3).close(); reachable = True
    except OSError:
        pass
    if not reachable:
        print(f"[INFO] R5.session-pooler NOT REPRODUCED: nothing listening on {POOLER_PORT}")
        print(f"::notice title=R5 session pooler::NOT REPRODUCED (nothing listening on {POOLER_PORT})")
    else:
        used = None
        for u in POOLER_USERS:
            o = os.path.join(WORK, f"pooler-{u}", "out"); os.makedirs(o)
            rc, _ = step("qid", f"host=127.0.0.1 port={POOLER_PORT} dbname=postgres user={u} sslmode=disable connect_timeout=10", o)
            if rc == 0:
                used = u; break
        if used is None:
            print("[INFO] R5.session-pooler NOT REPRODUCED: local pooler rejected every tenant user tried")
            print("::notice title=R5 session pooler::NOT REPRODUCED (pooler rejected every tenant user tried)")
        else:
            po = os.path.join(WORK, "pooler", "out"); os.makedirs(po)
            full_run("R5.pooler", f"host=127.0.0.1 port={POOLER_PORT} dbname=postgres user={used} sslmode=disable connect_timeout=10", po)
            _, vout = validate(po, "qid")
            print(f"::notice title=R5 session pooler::REPRODUCED via local supavisor, tenant user {used}")
            check("R5.pooler-session-controls-persisted", "OK    qid: session default_transaction_read_only = on" in vout
                  and "OK    qid: session search_path" in vout, f"tenant user {used}")

    # ---- R6: deny-by-default share file on the exact capture (hostile fixtures present) ----
    base = os.path.dirname(out)
    p = subprocess.run([sys.executable, os.path.join(OP, "make_share.py"), base], capture_output=True, text=True)
    check("R6.share-builder-exit-0", p.returncode == 0, p.stdout.strip().splitlines()[-1] if p.stdout.strip() else p.stderr[-200:])
    share = open(os.path.join(base, "share", "tripp_d04c4_share.json")).read()
    planted = ["ops@example.com", "https://example.invalid/hook", "eyJhbGciOiJIUzI1NiJ9", "00000000-0000-4000-8000-00000000c1c1",
               "TRIPWIRE_EXECUTED", "mentions deals", "$function$", "CREATE OR REPLACE FUNCTION", "BEGIN RAISE"]
    leaked = [x for x in planted if x in share]
    check("R6.share-withholds-planted-sensitive-material", not leaked, f"leaked={len(leaked)}")
    sj = json.loads(share)
    check("R6.share-has-no-function-bodies", all("definition" not in f for f in sj["q1"]["functions"]) and len(sj["q1"]["functions"]) > 0)
    check("R6.share-keeps-structure", len(sj["q1"]["effective_table_privileges"]) == len(sj["q1"]["tables"]) * 28
          and any(f["security_definer"] and "INSERT organization_memberships" in f["facts"]["writes_targets"] for f in sj["q1"]["functions"]))
    check("R6.share-flags-dynamic-sql", any(f["facts"]["uses_dynamic_sql"] for f in sj["q1"]["functions"] if f["signature"].startswith("ci_dynamic_writer"))
          or not any(f["signature"].startswith("ci_dynamic_writer") for f in sj["q1"]["functions"]))
    lm = json.load(open(os.path.join(base, "private", "literal_map.json")))
    check("R6.private-map-holds-withheld-literals", "ops@example.com" in lm.values())
    nr = open(os.path.join(base, "private", "names_review.txt")).read()
    check("R6.names-review-lists-unknown-objects", "ci_join_org" in nr)
    # Backstop: a sensitive-looking object NAME (not a literal) must stop the share.
    d = os.path.join(WORK, "backstop"); shutil.copytree(base, d, ignore=shutil.ignore_patterns("share", "private"))
    q1p = os.path.join(d, "out", "tripp_q1.json"); q1 = json.load(open(q1p))
    q1["columns"].append({"table": "organizations", "column": "alerts_to_ops@corp.example", "type": "text", "not_null": False, "default": None})
    json.dump(q1, open(q1p, "w"))
    p = subprocess.run([sys.executable, os.path.join(OP, "make_share.py"), d], capture_output=True, text=True)
    check("R6.backstop-stops-on-sensitive-name", p.returncode == 2 and "STOP" in p.stdout)

    failed = [c for c, ok in results if not ok]
    print(f"\nRUNBOOK PATH SUMMARY: {len(results) - len(failed)}/{len(results)} passed")
    print(f"::notice title=Runbook path checks::{len(results) - len(failed)}/{len(results)} passed" + (f"; FAILED: {', '.join(failed)}" if failed else ""))
    with open(os.environ.get("GITHUB_STEP_SUMMARY", os.devnull), "a") as f:
        f.write(f"### D04-C.4A.3 runbook execution path\n{len(results) - len(failed)}/{len(results)} checks passed\n")
        for c, ok in results: f.write(f"- {'PASS' if ok else 'FAIL'} {c}\n")
    shutil.rmtree(WORK, ignore_errors=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
