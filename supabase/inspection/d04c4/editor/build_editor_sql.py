#!/usr/bin/env python3
"""TRIPP D04-C.4A.5 generator: derive Supabase SQL Editor variants from the pinned Q-ID/Q0/Q1 files.

The editor variants are produced MECHANICALLY so the inspection logic stays byte-for-byte the pinned
logic. For each pinned file:
  * the control statements (BEGIN ... READ ONLY, SET LOCAL ..., ROLLBACK) are removed;
  * every data statement (SELECT/WITH) is embedded unchanged as a subquery: (<statement>) AS s(x);
  * a single final SELECT returns the documents, wrapped in an envelope that self-reports the
    session controls, split into fixed-size chunks with a SHA-256 of the whole payload.

Why: the SQL Editor shows only the LAST statement's result, so a file ending in ROLLBACK would display
"Success. No rows returned" and hide the inspection. Each editor step therefore ends with the one
row-producing SELECT, never with ROLLBACK/COMMIT, and cannot report success without its rows.

Controls are applied with SET LOCAL at the top of the same submission. They last only for that one
execution's transaction (nothing is assumed to persist between runs). A guard inside the final SELECT
raises an error, before any catalog read is returned, unless read-only, search_path and the timeouts
are actually in effect, so an editor that does not keep SET LOCAL fails closed instead of reading.

Usage: python3 build_editor_sql.py           # writes the three *_editor.sql files next to this script
       python3 build_editor_sql.py --check   # exit 1 if the committed files differ from a fresh build
"""
import hashlib, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
CHUNK = 8000
STEPS = [("qid", "qid_identity_session.sql", 3), ("q0", "q0_migration_history.sql", 3), ("q1", "q1_catalog_inspection.sql", 1)]


def split_statements(sql):
    """Split on top-level semicolons, respecting quotes, dollar quotes and comments."""
    out, cur, i, n = [], [], 0, len(sql)
    while i < n:
        c = sql[i]
        if sql.startswith("--", i):
            j = sql.find("\n", i); j = n if j < 0 else j; cur.append(sql[i:j]); i = j
        elif sql.startswith("/*", i):
            d, j = 1, i + 2
            while j < n and d:
                if sql.startswith("/*", j): d += 1; j += 2
                elif sql.startswith("*/", j): d -= 1; j += 2
                else: j += 1
            cur.append(sql[i:j]); i = j
        elif c == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'" and j + 1 < n and sql[j + 1] == "'": j += 2; continue
                if sql[j] == "'": j += 1; break
                j += 1
            cur.append(sql[i:j]); i = j
        elif c == '"':
            j = sql.find('"', i + 1); j = n if j < 0 else j + 1; cur.append(sql[i:j]); i = j
        elif c == "$" and re.match(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$", sql[i:]) and not (i and (sql[i-1].isalnum() or sql[i-1] == "_")):
            tag = re.match(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$", sql[i:]).group(0)
            j = sql.find(tag, i + len(tag)); j = n if j < 0 else j + len(tag); cur.append(sql[i:j]); i = j
        elif c == ";":
            out.append("".join(cur)); cur = []; i += 1
        else:
            cur.append(c); i += 1
    if "".join(cur).strip():
        out.append("".join(cur))
    return out


def strip_leading_comments(s):
    lines = s.strip().splitlines()
    while lines and (not lines[0].strip() or lines[0].strip().startswith("--")):
        lines.pop(0)
    return "\n".join(lines).strip()


def build(step, fname, ndocs):
    raw = open(os.path.join(PKG, fname), "rb").read()
    src_sha = hashlib.sha256(raw).hexdigest()
    controls, data = {}, []
    for st in split_statements(raw.decode("utf-8")):
        body = strip_leading_comments(st)
        if not body:
            continue
        head = body.split(None, 1)[0].upper()
        if head in ("BEGIN", "ROLLBACK"):
            continue
        if head == "SET":
            m = re.fullmatch(r"SET\s+LOCAL\s+(\w+)\s*=\s*'([^']*)'", body, re.I)
            if not m:
                raise SystemExit(f"{fname}: unexpected SET form: {body!r}")
            controls[m.group(1).lower()] = m.group(2)
            continue
        if head not in ("SELECT", "WITH"):
            raise SystemExit(f"{fname}: unexpected statement kind {head}")
        data.append(body)
    if len(data) != ndocs:
        raise SystemExit(f"{fname}: expected {ndocs} data statements, found {len(data)}")
    st_to, lk_to = controls["statement_timeout"], controls["lock_timeout"]
    sets = ["SET LOCAL transaction_read_only = on;", "SET LOCAL default_transaction_read_only = on;"]
    sets += [f"SET LOCAL {k} = '{v}';" for k, v in controls.items()]
    sets += ["SET LOCAL search_path = pg_catalog, pg_temp;"]
    docs = ",\n".join(f"  (SELECT s{i}.x::jsonb FROM (\n{d}\n  ) AS s{i}(x))" for i, d in enumerate(data, 1))
    return f"""-- TRIPP D04-C.4A.5 SQL EDITOR STEP: {step.upper()}   (generated from {fname}, sha256 {src_sha})
-- Paste this WHOLE file into a NEW Supabase SQL Editor tab and press Run ONCE. Do not edit it.
-- Read-only: nothing here can change data or schema. It returns rows named step/part/parts/sha256/chunk.
-- If the result panel shows any error, STOP and report the error text. Do not re-run.
{chr(10).join(sets)}
WITH tripp_guard AS (
  SELECT CASE
    WHEN pg_catalog.current_setting('transaction_read_only') = 'on'
     AND pg_catalog.current_setting('default_transaction_read_only') = 'on'
     AND pg_catalog.current_setting('search_path') = 'pg_catalog, pg_temp'
     AND pg_catalog.current_setting('statement_timeout') = '{st_to}'
     AND pg_catalog.current_setting('lock_timeout') = '{lk_to}'
    THEN true
    ELSE (('TRIPP-STOP session controls not in effect read_only=' || pg_catalog.current_setting('transaction_read_only')
           || ' search_path=' || pg_catalog.current_setting('search_path'))::int > 0)
  END AS ok
),
tripp_payload AS (
  SELECT pg_catalog.jsonb_build_object(
  'editor_envelope', pg_catalog.jsonb_build_object(
     'mode', 'sql-editor', 'editor_version', '1', 'step', '{step}',
     'source_file', '{fname}', 'source_sha256', '{src_sha}',
     'transaction_read_only', pg_catalog.current_setting('transaction_read_only'),
     'default_transaction_read_only', pg_catalog.current_setting('default_transaction_read_only'),
     'search_path', pg_catalog.current_setting('search_path'),
     'statement_timeout', pg_catalog.current_setting('statement_timeout'),
     'lock_timeout', pg_catalog.current_setting('lock_timeout'),
     'current_user', CURRENT_USER::text,
     'write_xid_assigned', pg_catalog.pg_current_xact_id_if_assigned()::text),
  'documents', pg_catalog.jsonb_build_array(
{docs}
  ))::text AS t
  FROM tripp_guard WHERE tripp_guard.ok
)
SELECT '{step}'::text AS step, n AS part, p.parts,
       pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(tripp_payload.t, 'UTF8')), 'hex') AS sha256,
       pg_catalog.substr(tripp_payload.t, (n - 1) * {CHUNK} + 1, {CHUNK}) AS chunk
FROM tripp_payload
CROSS JOIN LATERAL (SELECT pg_catalog.ceil(pg_catalog.length(tripp_payload.t) / {CHUNK}.0)::int AS parts) p
CROSS JOIN LATERAL pg_catalog.generate_series(1, p.parts) AS n
ORDER BY n
LIMIT 1000;
"""


def main():
    check = "--check" in sys.argv
    bad = []
    for step, fname, nd in STEPS:
        sql = build(step, fname, nd)
        path = os.path.join(HERE, f"{step}_editor.sql")
        if check:
            if not os.path.exists(path) or open(path, encoding="utf-8").read() != sql:
                bad.append(path)
        else:
            open(path, "w", encoding="utf-8").write(sql)
            print(f"wrote {os.path.basename(path)} ({len(sql)} bytes)")
    if check:
        print("editor files match a fresh build" if not bad else f"MISMATCH: {bad}")
        sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
