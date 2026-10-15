#!/usr/bin/env python3
"""D04-C.4A.2 ephemeral verification of Q0/Q1/Q2 against a disposable local Supabase stack.

CI-ONLY. Talks exclusively to the local container `supabase_db_tripp` through `docker exec`.
Raw JSON outputs are written to a temp dir on the runner and never printed or uploaded; the log
and step summary carry only booleans, counts and synthetic object names.
"""
import json, os, re, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
CONTAINER = os.environ.get("TRIPP_DB_CONTAINER", "supabase_db_tripp")
RO_OPTS = "-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=2000"
OUT = tempfile.mkdtemp(prefix="d04c4-")
TARGETS = ["deal_documents", "deals", "organization_memberships", "organizations"]
API_ROLES = ["anon", "authenticated", "public", "service_role"]
PRIVS = ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]
Q1_KEYS = {
    "capture": dict, "missing_tables": list, "tables": list, "columns": list, "enum_types": list,
    "constraints": list, "inbound_foreign_keys": list, "indexes": list, "policies": list,
    "table_grants": list, "column_grants": list, "triggers": list, "functions": list,
    "effective_table_privileges": list, "schema_privileges": list, "role_attributes": list,
    "default_privileges": list, "storage_policies": list, "dependent_views": list,
    "sensitive_literal_flags": list, "platform_objects": dict,
}
CAPTURE_KEYS = ["tool", "version", "captured_at", "server_version", "executed_as", "transaction_read_only"]
FN_KEYS = ["signature", "discovery_depth", "discovery_reasons", "effective_execute", "security_definer",
           "volatility", "language", "owner", "config", "execute_grantees", "body_md5", "definition"]

results = []  # (id, passed, detail)


def check(cid, ok, detail=""):
    results.append((cid, bool(ok), detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {cid}" + (f" :: {detail}" if detail else ""), flush=True)
    return bool(ok)


def psql(sql, db="postgres", user="postgres", ro=False, expect_ok=True):
    env_args = ["-e", f"PGOPTIONS={RO_OPTS}"] if ro else []
    cmd = ["docker", "exec", "-i", *env_args, CONTAINER, "psql", "-U", user, "-d", db,
           "-X", "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-f", "-"]
    t0 = time.monotonic()
    p = subprocess.run(cmd, input=sql, capture_output=True, text=True, timeout=120)
    return p.returncode, p.stdout, p.stderr, time.monotonic() - t0


def read(name):
    with open(os.path.join(PKG, name)) as f:
        return f.read()


def json_docs(text):
    dec, i, docs, text = json.JSONDecoder(), 0, [], text.strip()
    while i < len(text):
        while i < len(text) and text[i].isspace():
            i += 1
        if i >= len(text):
            break
        obj, i = dec.raw_decode(text, i)
        docs.append(obj)
    return docs


def run_query(qfile, label, db="postgres"):
    rc, out, err, secs = psql(read(qfile), db=db, ro=True)
    with open(os.path.join(OUT, f"{label}.out"), "w") as f:
        f.write(out)
    return rc, out, err, secs


def q1_structure_problems(q1):
    """Return a list of problems; an empty list means the capture is complete and usable."""
    probs = []
    for k, t in Q1_KEYS.items():
        if k not in q1:
            probs.append(f"missing key {k}")
        elif not isinstance(q1[k], t):
            probs.append(f"{k} is {type(q1[k]).__name__}, expected {t.__name__}")
    if probs:
        return probs
    cap = q1["capture"]
    probs += [f"capture.{k} missing" for k in CAPTURE_KEYS if k not in cap]
    if cap.get("transaction_read_only") != "on":
        probs.append("transaction_read_only != on")
    if q1["missing_tables"]:
        probs.append(f"missing_tables={sorted(q1['missing_tables'])}")
    kinds = {t["table"]: t["kind"] for t in q1["tables"]}
    for t, k in kinds.items():
        if k not in ("r", "p"):
            probs.append(f"{t} relkind={k} (expected ordinary table)")
    for t in q1["tables"]:
        if not t.get("rls_enabled"):
            probs.append(f"{t['table']} RLS disabled")
    exp_rows = len(q1["tables"]) * len(API_ROLES) * len(PRIVS)
    if len(q1["effective_table_privileges"]) != exp_rows:
        probs.append(f"effective_table_privileges rows={len(q1['effective_table_privileges'])} expected {exp_rows}")
    for t in TARGETS:
        if t in kinds and not any(c["table"] == t for c in q1["columns"]):
            probs.append(f"no columns captured for {t}")
    for fn in q1["functions"]:
        miss = [k for k in FN_KEYS if k not in fn]
        if miss:
            probs.append(f"function {fn.get('signature')} missing {miss}")
    return probs


WRITE_RE = re.compile(r"\b(insert\s+into|update|delete\s+from)\s+(public\.)?(organization_memberships|organizations)\b", re.I)


def security_findings(q1):
    """Classify catalog evidence. Conservative: privilege alone is not 'critical' unless RLS lets it through."""
    f = []
    rls = {t["table"]: t["rls_enabled"] for t in q1["tables"]}
    eff = {(e["table"], e["role"], e["privilege"]): e["on_table"] for e in q1["effective_table_privileges"]}
    for tbl in ("organization_memberships", "organizations"):
        for role in ("anon", "authenticated", "public"):
            for priv, cmd in (("INSERT", "INSERT"), ("UPDATE", "UPDATE"), ("DELETE", "DELETE")):
                if not eff.get((tbl, role, priv)):
                    continue
                open_pol = [p["policy"] for p in q1["policies"]
                            if p["table"] == tbl and p["permissive"] == "PERMISSIVE" and p["command"] in (cmd, "ALL")
                            and (role in p["roles"] or "public" in p["roles"])
                            and ((p.get("with_check") or p.get("using") or "").strip().lower() in ("true", "(true)"))]
                if not rls.get(tbl):
                    f.append(("critical", f"{role} has {priv} on {tbl} with RLS disabled"))
                elif open_pol:
                    f.append(("critical", f"{role} {priv} on {tbl} allowed by unconditional policy {open_pol}"))
                else:
                    f.append(("high", f"{role} holds {priv} on {tbl}; only RLS blocks it (defense-in-depth gap)"))
    for fn in q1["functions"]:
        ex = fn["effective_execute"]
        exposed = ex.get("authenticated") or ex.get("anon") or ex.get("public")
        if fn["security_definer"] and exposed and WRITE_RE.search(fn["definition"] or ""):
            f.append(("critical", f"SECURITY DEFINER {fn['signature']} writes org/membership rows and is executable by API roles"))
        elif fn["security_definer"] and exposed and not any((c or "").startswith("search_path=") for c in (fn["config"] or [])):
            f.append(("high", f"SECURITY DEFINER {fn['signature']} executable by API roles without fixed search_path"))
    m_cons = [c for c in q1["constraints"] if c["table"] == "organization_memberships" and c["type"] in ("p", "u")]
    m_idx = [i for i in q1["indexes"] if i["table"] == "organization_memberships" and i["unique"]]
    if not any("organization_id" in c["definition"] and "user_id" in c["definition"] for c in m_cons) and \
       not any("organization_id" in i["definition"] and "user_id" in i["definition"] for i in m_idx):
        f.append(("high", "no uniqueness on organization_memberships(organization_id, user_id)"))
    return f


def fn_by_name(q1, name):
    return next((x for x in q1["functions"] if x["signature"].split("(")[0].split(".")[-1] == name), None)


def main():
    # ---------------- Phase 0: environment guard ----------------
    forbidden = [k for k in os.environ if re.search(r"(SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|PROJECT_REF|DATABASE_URL|PGPASSWORD)", k)]
    check("P0.no-production-credentials-in-env", not forbidden, f"found {forbidden}" if forbidden else "none")
    check("P0.no-linked-project", not os.path.exists(os.path.join(PKG, "../../.temp/project-ref")))
    rc, out, err, _ = psql("SELECT current_database();")
    check("P0.local-container-reachable", rc == 0, err.strip()[:200])

    # ---------------- Phase 1: baseline (real migrations + CI bootstrap) ----------------
    rc, out, err, secs = run_query("q0_migration_history.sql", "baseline_q0")
    ok = check("P1.q0-runs", rc == 0, err.strip()[:300])
    if ok:
        docs = json_docs(out)
        check("P1.q0-three-documents", len(docs) == 3, f"got {len(docs)}")
        head, versions, bucket = (docs + [None, None, None])[:3]
        check("P1.q0-read-only-on", head and head.get("transaction_read_only") == "on")
        check("P1.q0-ledger-present", head and head.get("ledger_present") is True)
        mig = sorted(f.split("_")[0] for f in os.listdir(os.path.join(PKG, "../../migrations")) if f.endswith(".sql"))
        got = {v["version"] for v in (versions or [])}
        check("P1.q0-all-repo-migrations-in-ledger", set(mig) <= got, f"repo={len(mig)} ledger={len(got)}")
        check("P1.q0-no-statements-column", versions and all(set(v) == {"version", "name"} for v in versions))
        check("P1.q0-bucket-private", bucket and len(bucket) == 1 and bucket[0]["public"] is False)
    rc, out, err, secs = run_query("q1_catalog_inspection.sql", "baseline_q1")
    if check("P1.q1-runs", rc == 0, err.strip()[:300]):
        q1 = json_docs(out)[0]
        probs = q1_structure_problems(q1)
        check("P1.q1-structure-complete", not probs, "; ".join(probs[:8]))
        check("P1.q1-runtime-bounded", secs < 10, f"{secs:.2f}s")
        check("P1.q1-function-count-bounded", len(q1["functions"]) < 200, f"{len(q1['functions'])} functions")
        base = security_findings(q1)
        crit = [d for s, d in base if s == "critical"]
        check("P1.baseline-no-critical-findings", not crit, "; ".join(crit))
        for sev, d in base:
            print(f"  baseline finding [{sev}] {d}")
        for x in q1["sensitive_literal_flags"]:
            print(f"  baseline literal flag (review item): {x['source']} {sorted(k for k, v in x['flags'].items() if v)}")
        print(f"  baseline discovered functions: {len(q1['functions'])}; storage policies: {len(q1['storage_policies'])}")
    rc, out, err, _ = run_query("q2_membership_integrity_aggregates.sql", "baseline_q2")
    if check("P1.q2-runs", rc == 0, err.strip()[:300]):
        q2 = json_docs(out)[0]
        check("P1.q2-empty-baseline", q2["role_values"] is None and q2["duplicate_org_user_pairs"] == 0)

    # ---------------- Phase 2: read-only enforcement (disposable transactions) ----------------
    for label, stmt in [
        ("insert", "INSERT INTO public.organizations (name) VALUES ('ro-probe')"),
        ("update", "UPDATE public.organizations SET name = name"),
        ("delete", "DELETE FROM public.organization_memberships"),
        ("ddl", "CREATE TABLE public.ro_probe (x int)"),
        ("grant", "GRANT SELECT ON public.organizations TO anon"),
        ("truncate", "TRUNCATE public.organization_memberships"),
    ]:
        rc, out, err, _ = psql(f"BEGIN TRANSACTION READ ONLY;\n{stmt};\nROLLBACK;", ro=True)
        check(f"P2.read-only-rejects-{label}", rc != 0 and "read-only transaction" in err, err.strip().splitlines()[-1][:160] if err.strip() else "no error")

    # ---------------- Phase 3: hostile fixtures + tripwires ----------------
    rc, out, err, _ = psql(read("ci/hostile_fixtures.sql"))
    if not check("P3.fixtures-applied", rc == 0, err.strip()[:300]):
        return
    rc, out, err, _ = psql("SELECT public.ci_tripwire_policy(NULL);")
    check("P3.tripwire-armed (positive control)", rc != 0 and "TRIPWIRE_EXECUTED" in err)
    rc, out, err, _ = psql("BEGIN TRANSACTION READ ONLY; SELECT public.ci_join_org('00000000-0000-4000-8000-0000000000b2'); ROLLBACK;", ro=True)
    check("P3.read-only-blocks-security-definer-write", rc != 0 and "read-only transaction" in err)

    stats = False
    rc, _, err, _ = psql("ALTER SYSTEM SET track_functions = 'all'; SELECT pg_reload_conf();", user="supabase_admin")
    if rc == 0:
        time.sleep(1)
        psql("SELECT public.ci_stats_probe();")
        time.sleep(1.5)
        rc, out, _, _ = psql("SELECT pg_stat_clear_snapshot(); SELECT coalesce(sum(calls),0) FROM pg_stat_user_functions WHERE funcname = 'ci_stats_probe';", user="supabase_admin")
        stats = rc == 0 and out.strip().splitlines()[-1].strip() not in ("", "0")
    check("P3.function-stats-tracking-available (positive control)", stats, "used as secondary evidence" if stats else "unavailable; tripwires are primary evidence")
    if stats:
        psql("SELECT pg_stat_reset();", user="supabase_admin")
        time.sleep(1)

    rc, out, err, secs = run_query("q1_catalog_inspection.sql", "hostile_q1")
    check("P3.q1-no-tripwire-fired", "TRIPWIRE" not in err and rc == 0, err.strip()[:300])
    if rc != 0:
        return
    q1 = json_docs(out)[0]
    check("P3.q1-runtime-bounded", secs < 10, f"{secs:.2f}s")
    if stats:
        time.sleep(1.5)
        rc2, sout, _, _ = psql("SELECT pg_stat_clear_snapshot(); SELECT coalesce(string_agg(schemaname||'.'||funcname||'='||calls, ','),'') FROM pg_stat_user_functions WHERE calls > 0 AND schemaname NOT IN ('auth','storage','extensions','realtime','vault','pgsodium','graphql','net','cron','supabase_functions');", user="supabase_admin")
        called = sout.strip().splitlines()[-1].strip() if sout.strip() else ""
        check("P3.q1-executed-no-user-functions (stats)", rc2 == 0 and called == "", called or "none")
        psql("ALTER SYSTEM RESET track_functions; SELECT pg_reload_conf();", user="supabase_admin")

    expect = {
        "ci_join_org": ("references_target_table", 0),
        "ci_member_role": ("references_target_table", 0),
        "ci_is_member": ("policy", 0),
        "ci_policy_entry": ("policy", 0),
        "ci_leaf_helper": (None, 1),
        "ci_tripwire_policy": ("policy", 0),
        "ci_tripwire_default": ("default_or_check", 0),
        "ci_tripwire_trigger": ("trigger", 0),
    }
    for name, (reason, depth) in expect.items():
        fn = fn_by_name(q1, name)
        ok = fn is not None and fn["discovery_depth"] == depth and (reason is None or reason in (fn["discovery_reasons"] or []))
        check(f"P3.discovers-{name}", ok, f"depth={fn and fn['discovery_depth']} reasons={fn and fn['discovery_reasons']}")
    check("P3.limitation-dynamic-sql-not-discovered (documented)", fn_by_name(q1, "ci_dynamic_writer") is None)
    fp = fn_by_name(q1, "ci_comment_only")
    check("P3.limitation-comment-false-positive (documented)", fp is not None and "references_target_table" in fp["discovery_reasons"])
    eff = {(e["table"], e["role"], e["privilege"]): e for e in q1["effective_table_privileges"]}
    direct = {(g["table"], g["grantee"], g["privilege"]) for g in q1["table_grants"]}
    check("P3.inherited-privilege-detected",
          eff[("deals", "authenticated", "DELETE")]["on_table"] and ("deals", "authenticated", "DELETE") not in direct)
    ra = {r["role"]: r for r in q1["role_attributes"]}
    check("P3.role-membership-reported", "ci_helper_role" in (ra.get("authenticated", {}).get("member_of") or []))
    check("P3.storage-policy-captured", any(p["policy"] == "ci_storage_admin_read" for p in q1["storage_policies"]))
    check("P3.storage-deny-policy-captured", any(p["policy"] == "tripp_deal_documents_browser_deny" for p in q1["storage_policies"]))
    flags = {x["source"]: x["flags"] for x in q1["sensitive_literal_flags"]}
    probe = next((v for k, v in flags.items() if "ci_literal_probe" in k), None)
    check("P3.literal-flags-detect-all-probes",
          probe is not None and all(probe[k] for k in ("email", "url", "jwt", "secret_word", "uuid_literal")), json.dumps(probe))
    hostile = security_findings(q1)
    crit = [d for s, d in hostile if s == "critical"]
    check("P3.classifies-ci_join_org-critical", any("ci_join_org" in d for d in crit))
    check("P3.classifies-unconditional-insert-policy-critical", any("ci_om_insert_any" in d for d in crit))
    check("P3.no-false-critical-on-tripp-functions", not any("tripp_" in d for d in crit), "; ".join(d for d in crit if "tripp_" in d))
    check("P3.structure-still-complete", not q1_structure_problems(q1), "; ".join(q1_structure_problems(q1)[:5]))

    # ---------------- Phase 4: Q2 on synthetic data ----------------
    rc, out, err, _ = run_query("q2_membership_integrity_aggregates.sql", "synthetic_q2")
    if check("P4.q2-runs", rc == 0, err.strip()[:300]):
        q2 = json_docs(out)[0]
        check("P4.q2-role-counts", q2["role_values"] == {"admin": 1, "member": 1, "viewer": 1}, json.dumps(q2["role_values"]))
        check("P4.q2-integrity-counts", q2["duplicate_org_user_pairs"] == 0 and q2["null_org_or_user"] == 0
              and q2["memberships_without_org"] == 0 and q2["memberships_without_auth_user"] == 0)
        check("P4.q2-no-identifiers-in-output",
              not re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-|@example\.test|CI Org", out, re.I))

    # ---------------- Phase 5: fail-clear negative cases (scratch database) ----------------
    psql("DROP DATABASE IF EXISTS tripp_inspect_neg;")
    rc, _, err, _ = psql("CREATE DATABASE tripp_inspect_neg;")
    if not check("P5.scratch-db-created", rc == 0, err.strip()[:200]):
        return
    neg = "tripp_inspect_neg"
    rc, out, err, _ = run_query("q2_membership_integrity_aggregates.sql", "neg_q2_empty", db=neg)
    check("P5.q2-empty-db-fails-clearly", rc != 0 and "does not exist" in err)
    # D04-C.4A.6: optional platform objects absent -> explicit findings, never an uncontrolled error.
    def ledger_case(label, expect, as_role=None):
        pre = f"SET ROLE {as_role};\n" if as_role else ""
        rc, out, err, _ = psql(pre + read("qid_identity_session.sql"), db=neg, ro=True)
        got = None
        if rc == 0:
            _, led, bk = json_docs(out)
            got = led.get("ledger_status")
        check(f"P5.qid-ledger-{label}-explicit-status", rc == 0 and got == expect and led.get("migration_count") is None,
              f"status={got} {err.strip()[:160]}")
        rc, out, err, _ = psql(pre + read("q0_migration_history.sql"), db=neg, ro=True)
        got = None
        if rc == 0:
            head, vers, bucket = json_docs(out)
            got = head.get("ledger_status")
        check(f"P5.q0-ledger-{label}-explicit-status", rc == 0 and got == expect and vers == []
              and head.get("ledger_present") is (expect not in ("absent_schema", "absent_table")), f"status={got} {err.strip()[:160]}")
    ledger_case("absent-schema", "absent_schema")
    rc, out, err, _ = run_query("qid_identity_session.sql", "neg_qid_nostorage", db=neg)
    check("P5.qid-storage-absent-explicit-status", rc == 0 and json_docs(out)[2] == {"buckets_status": "absent_schema", "storage_bucket_ids": None})
    psql("CREATE SCHEMA supabase_migrations;", db=neg)
    ledger_case("absent-table", "absent_table")
    psql("CREATE TABLE supabase_migrations.schema_migrations (id int);", db=neg)
    ledger_case("unexpected-columns", "present_unexpected_columns")
    # Not readable: a role without USAGE on the ledger schema (postgres itself may hold pg_read_all_data).
    psql("DROP SCHEMA supabase_migrations CASCADE; CREATE SCHEMA supabase_migrations; "
         "CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text); "
         "REVOKE ALL ON SCHEMA supabase_migrations FROM PUBLIC; "
         "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ci_noread') THEN CREATE ROLE ci_noread NOLOGIN; END IF; END $$; "
         "GRANT ci_noread TO postgres;", db=neg)
    ledger_case("not-readable", "present_not_readable", as_role="ci_noread")
    psql("DROP SCHEMA supabase_migrations CASCADE;", db=neg)
    rc, out, err, _ = run_query("q1_catalog_inspection.sql", "neg_q1_noauth", db=neg)
    ok = rc == 0
    if ok:
        po = json_docs(out)[0]["platform_objects"]
        ok = {r["relation"]: r["present"] for r in po["relations"]}.get("auth.users") is False and po["auth_uid_function_present"] is False
    check("P5.q1-no-auth-schema-explicit-finding", ok, err.strip()[:200])
    psql("CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);", db=neg)
    rc, out, err, _ = run_query("q1_catalog_inspection.sql", "neg_q1_notables", db=neg)
    if check("P5.q1-no-tables-no-extensions-runs", rc == 0, err.strip()[:200]):
        probs = q1_structure_problems(json_docs(out)[0])
        check("P5.q1-missing-tables-rejected-by-validator", any("missing_tables" in p for p in probs), "; ".join(probs[:3]))
    psql("""CREATE TABLE public.organizations (id uuid PRIMARY KEY, name text);
            CREATE VIEW public.organization_memberships AS SELECT NULL::uuid AS organization_id, NULL::uuid AS user_id, NULL::text AS role;
            CREATE TABLE public.deals (id uuid PRIMARY KEY, organization_id uuid);
            CREATE TABLE public.deal_documents (id uuid PRIMARY KEY);""", db=neg)
    rc, out, err, _ = run_query("q1_catalog_inspection.sql", "neg_q1_view", db=neg)
    if check("P5.q1-unexpected-catalog-runs", rc == 0, err.strip()[:200]):
        probs = q1_structure_problems(json_docs(out)[0])
        check("P5.q1-view-instead-of-table-rejected", any("relkind=v" in p for p in probs), "; ".join(probs[:3]))
        check("P5.q1-rls-disabled-rejected", any("RLS disabled" in p for p in probs))
    psql("DROP DATABASE IF EXISTS tripp_inspect_neg WITH (FORCE);")


if __name__ == "__main__":
    try:
        main()
    finally:
        passed = sum(1 for _, ok, _ in results if ok)
        failed = [(c, d) for c, ok, d in results if not ok]
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a") as f:
                f.write(f"## D04-C.4A.2 inspection verification\n\n{passed} passed, {len(failed)} failed\n\n| Check | Result |\n|---|---|\n")
                for c, ok, _ in results:
                    f.write(f"| {c} | {'PASS' if ok else 'FAIL'} |\n")
        for name in os.listdir(OUT):
            os.remove(os.path.join(OUT, name))
        os.rmdir(OUT)
        print(f"\nTOTAL: {passed} passed, {len(failed)} failed")
        for c, d in failed:
            print(f"::error title=D04-C.4A.2 {c}::{d[:300]}")
        sys.exit(1 if failed or not results else 0)
