#!/usr/bin/env python3
"""TRIPP D04-C.4A.3 share-file builder (deny-by-default sanitization).

Turns raw Q0/Q1 output into a file that is safe to hand to reviewers, WITHOUT relying on
pattern detection to find secrets:

  * Function definitions are never copied. Each function is reduced to structural facts
    (security definer, search_path, grants, which target tables it reads/writes, whether it uses
    dynamic SQL, which other discovered functions it calls).
  * In every other SQL text (policies, defaults, CHECK/FK definitions, index and trigger
    definitions, storage policies) comments are removed and EVERY string literal is replaced by a
    placeholder unless that exact literal already appears in this repository's own migrations
    (public, known-safe vocabulary) or in a short generic role/status vocabulary used to detect drift.
  * Migration names not present in this repository are replaced by placeholders.
  * Object names listed by the operator in private/redact_names.txt are replaced everywhere.
  * Q-ID output, stderr files and connection details are never read.

A pattern backstop runs last; any hit makes the tool exit non-zero. It is a safety net, not the
primary control.

Writes:   SHARE/tripp_d04c4_share.json      (the only file to share, after the names review)
          PRIVATE/literal_map.json          (operator only: placeholder -> original; never share)
          PRIVATE/names_review.txt          (operator only: names to eyeball before sharing)
Usage:    python3 make_share.py [BASE_DIR]   (default ~/tripp-inspect; reads BASE_DIR/out)
"""
import glob, json, os, re, sys

BASE = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "~/tripp-inspect")
OUT, SHARE, PRIVATE = (os.path.join(BASE, d) for d in ("out", "share", "private"))
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_MIGRATIONS = os.path.normpath(os.path.join(HERE, "..", "..", "..", "migrations"))
TARGETS = ["organizations", "organization_memberships", "deals", "deal_documents"]
DRIFT_VOCAB = {"owner", "admin", "member", "viewer", "editor", "guest", "manager", "broker", "agent", "client",
               "billing", "readonly", "read_only", "active", "inactive", "pending", "invited", "suspended",
               "disabled", "deleted", "removed", "archived", "anon", "authenticated", "service_role", "public",
               "true", "false", "t", "f", "utc", ""}

os.makedirs(SHARE, mode=0o700, exist_ok=True)
os.makedirs(PRIVATE, mode=0o700, exist_ok=True)


# ---------------------------------------------------------------- SQL tokenizer
def tokenize(sql):
    """Yield (kind, text): kind in code|literal|comment. Handles '', E'', $tag$ and nested /* */."""
    i, n, buf = 0, len(sql), []
    def flush():
        if buf:
            yield_list.append(("code", "".join(buf))); buf.clear()
    yield_list = []
    while i < n:
        c = sql[i]
        if c == "-" and sql.startswith("--", i):
            j = sql.find("\n", i); j = n if j < 0 else j
            flush(); yield_list.append(("comment", sql[i:j])); i = j
        elif c == "/" and sql.startswith("/*", i):
            depth, j = 1, i + 2
            while j < n and depth:
                if sql.startswith("/*", j): depth += 1; j += 2
                elif sql.startswith("*/", j): depth -= 1; j += 2
                else: j += 1
            flush(); yield_list.append(("comment", sql[i:j])); i = j
        elif c == "'" or (c in "eE" and i + 1 < n and sql[i + 1] == "'" and (i == 0 or not (sql[i - 1].isalnum() or sql[i - 1] == "_"))):
            esc = c in "eE"; j = i + (2 if esc else 1); val = []
            while j < n:
                if esc and sql[j] == "\\" and j + 1 < n: val.append(sql[j:j + 2]); j += 2; continue
                if sql[j] == "'":
                    if j + 1 < n and sql[j + 1] == "'": val.append("'"); j += 2; continue
                    j += 1; break
                val.append(sql[j]); j += 1
            flush(); yield_list.append(("literal", "".join(val))); i = j
        elif c == "$":
            m = re.match(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$", sql[i:])
            if m and not (i > 0 and (sql[i - 1].isalnum() or sql[i - 1] == "_")):
                tag = m.group(0); j = sql.find(tag, i + len(tag)); j = n if j < 0 else j
                flush(); yield_list.append(("literal", sql[i + len(tag):j])); i = j + len(tag)
            else:
                buf.append(c); i += 1
        elif c == '"':
            j = i + 1
            while j < n:
                if sql[j] == '"':
                    if j + 1 < n and sql[j + 1] == '"': j += 2; continue
                    j += 1; break
                j += 1
            buf.append(sql[i:j]); i = j
        else:
            buf.append(c); i += 1
    flush()
    return yield_list


def repo_vocabulary():
    lits, idents, mig = set(), set(), {}
    for path in sorted(glob.glob(os.path.join(REPO_MIGRATIONS, "*.sql"))):
        base = os.path.basename(path)[:-4]
        ver, _, name = base.partition("_")
        mig[ver] = name
        for kind, text in tokenize(open(path, encoding="utf-8").read()):
            if kind == "literal" and len(text) <= 200 and "\n" not in text:
                lits.add(text)
            elif kind == "code":
                idents.update(w.lower() for w in re.findall(r"[A-Za-z][A-Za-z0-9]*", text))
    return lits, idents, mig


REPO_LITS, REPO_IDENTS, REPO_MIGS = repo_vocabulary()
if not REPO_MIGS:
    sys.exit("STOP: repository migrations not found next to this tool; run it from the pinned checkout")
lit_map, lit_rev = {}, {}


def placeholder(value, kind="LIT"):
    if value not in lit_rev:
        key = f"<{kind}-{len(lit_rev) + 1}>"
        lit_rev[value] = key; lit_map[key] = value
    return lit_rev[value]


def literal_safe(v):
    return v in REPO_LITS or v.lower() in DRIFT_VOCAB or re.fullmatch(r"-?\d+(\.\d+)?|\{\}|\[\]", v) is not None


def sanitize_sql(text):
    if text is None:
        return None
    out = []
    for kind, t in tokenize(text):
        if kind == "code":
            out.append(t)
        elif kind == "literal":
            out.append("'" + (t.replace("'", "''") if literal_safe(t) else placeholder(t)) + "'")
        # comments dropped
    return re.sub(r"[ \t]+", " ", "".join(out)).strip()


def code_only(text):
    return " ".join(t for k, t in tokenize(text or "") if k == "code")


def function_body(defn):
    m = re.search(r"\bAS\s+(\$[A-Za-z_0-9]*\$)", defn or "")
    if m:
        start = m.end(); end = defn.find(m.group(1), start)
        return defn[start:end if end >= 0 else len(defn)]
    return defn or ""


def function_facts(fn, discovered_names):
    body = function_body(fn.get("definition"))
    code = code_only(body).lower()
    tq = lambda t: rf"(?:public\.)?\"?{t}\"?\b"
    reads = sorted(t for t in TARGETS if re.search(rf"\b(from|join)\s+{tq(t)}", code))
    writes = sorted({f"{op.upper()} {t}" for t in TARGETS for op, pat in
                     (("insert", rf"\binsert\s+into\s+{tq(t)}"), ("update", rf"\bupdate\s+{tq(t)}"),
                      ("delete", rf"\bdelete\s+from\s+{tq(t)}")) if re.search(pat, code)})
    calls = sorted(n for n in discovered_names if n != fn["signature"].split("(")[0] and re.search(rf"\b{re.escape(n.split('.')[-1])}\s*\(", code))
    keep = {k: fn.get(k) for k in ("signature", "discovery_depth", "discovery_reasons", "effective_execute",
                                    "security_definer", "volatility", "language", "owner", "config",
                                    "execute_grantees", "body_md5")}
    keep["facts"] = {
        "reads_targets": reads, "writes_targets": writes, "calls_discovered_functions": calls,
        "uses_dynamic_sql": bool(re.search(r"\bexecute\b", code)) and fn.get("language") == "plpgsql",
        "references_auth_uid": "auth.uid" in code, "references_auth_users": bool(re.search(r"\bauth\.users\b", code)),
        "string_literals_withheld": sum(1 for k, _ in tokenize(body) if k == "literal"),
        "definition": "WITHHELD (deny-by-default; body_md5 kept for comparison)",
    }
    return keep


def docs(path):
    text = open(path, encoding="utf-8").read().strip(); dec, i, out = json.JSONDecoder(), 0, []
    while i < len(text):
        while i < len(text) and text[i].isspace(): i += 1
        if i >= len(text): break
        obj, i = dec.raw_decode(text, i); out.append(obj)
    return out


q0 = docs(os.path.join(OUT, "tripp_q0.json"))
q1 = docs(os.path.join(OUT, "tripp_q1.json"))[0]

share = {"tool": "tripp-d04c4-share", "version": "2",
         "note": "Deny-by-default share of Q0/Q1. Function bodies withheld; non-repository string literals replaced by placeholders."}
head, versions, bucket = q0
LEDGER_SAFE_NAMES = {"schema_migrations", "_prisma_migrations", "knex_migrations", "flyway_schema_history",
                     "__drizzle_migrations", "migrations", "goose_db_version", "schema_version"}
ledger_ok = head.get("ledger_status") == "present"
share["q0"] = {"header": {k: head.get(k) for k in ("tool", "version", "transaction_read_only", "ledger_present",
                                                    "ledger_status", "buckets_status")},
               "ledger_candidates": [{"schema": c["schema"] if c.get("schema") in ("public", "supabase_migrations") else placeholder(c.get("schema"), "SCHEMA"),
                                      "table": c["table"] if c.get("table") in LEDGER_SAFE_NAMES else placeholder(c.get("table"), "NAME")}
                                     for c in head.get("ledger_candidates") or []],
               "ledger": [{"version": v["version"],
                           "name": v["name"] if REPO_MIGS.get(v["version"]) == v["name"] else placeholder(v["name"], "MIGRATION-NAME"),
                           "in_repository": v["version"] in REPO_MIGS} for v in versions],
               "repository_versions_missing_from_ledger": sorted(set(REPO_MIGS) - {v["version"] for v in versions}) if ledger_ok else None,
               "tripp_bucket": bucket}

s = {"capture": {k: q1["capture"].get(k) for k in ("tool", "version", "captured_at", "server_version", "executed_as", "transaction_read_only")}}
s["platform_objects"] = q1["platform_objects"]
for key in ("missing_tables", "tables", "table_grants", "column_grants", "effective_table_privileges", "schema_privileges",
            "role_attributes", "default_privileges", "dependent_views", "sensitive_literal_flags"):
    s[key] = q1[key]
s["columns"] = [dict(c, default=sanitize_sql(c.get("default"))) for c in q1["columns"]]
s["enum_types"] = [dict(e, labels=[l if literal_safe(l) else placeholder(l) for l in (e.get("labels") or [])]) for e in q1["enum_types"]]
for key in ("constraints", "inbound_foreign_keys", "indexes", "triggers"):
    s[key] = [dict(r, definition=sanitize_sql(r.get("definition"))) for r in q1[key]]
for key in ("policies", "storage_policies"):
    s[key] = [dict(p, using=sanitize_sql(p.get("using")), with_check=sanitize_sql(p.get("with_check"))) for p in q1[key]]
names = [f["signature"].split("(")[0] for f in q1["functions"]]
s["functions"] = [function_facts(f, names) for f in q1["functions"]]
share["q1"] = s

# ------------------------------------------------ operator-chosen name redaction
redact_file = os.path.join(PRIVATE, "redact_names.txt")
if not os.path.exists(redact_file):
    open(redact_file, "w").write("# One object name per line to replace with a placeholder in the share file.\n")
blob = json.dumps(share, indent=1, sort_keys=True)
for line in open(redact_file, encoding="utf-8"):
    nm = line.strip()
    if nm and not nm.startswith("#"):
        blob = re.sub(rf"(?<![A-Za-z0-9_]){re.escape(nm)}(?![A-Za-z0-9_])", placeholder(nm, "NAME"), blob)

# ------------------------------------------------ names the operator must eyeball
cands = set()
for f in q1["functions"]: cands.add(f["signature"])
for p in q1["policies"] + q1["storage_policies"]: cands.add(p["policy"])
for t in q1["triggers"]: cands.add(t["trigger"])
for i in q1["indexes"]: cands.add(i["index"])
for c in q1["constraints"]: cands.add(c["name"])
for c in q1["columns"]: cands.add(f"{c['table']}.{c['column']}")
for v in q1["dependent_views"]: cands.add(str(v.get("view")))
for r in q1["role_attributes"]: cands.add(r["role"])
for d in q1["default_privileges"]: cands.update(str(d.get(k)) for k in ("for_objects_created_by", "grantee") if d.get(k))
review = sorted(n for n in cands if not set(w.lower() for w in re.findall(r"[A-Za-z][A-Za-z0-9]*", n)) <= REPO_IDENTS | DRIFT_VOCAB | {"public", "auth", "storage", "objects", "uuid", "text", "void", "trigger", "boolean", "integer", "jsonb", "bigint", "timestamp", "with", "time", "zone", "postgres", "authenticator", "supabase_admin", "pkey", "fkey", "key", "check"})

with open(os.path.join(SHARE, "tripp_d04c4_share.json"), "w") as f: f.write(blob)
with open(os.path.join(PRIVATE, "literal_map.json"), "w") as f: json.dump(lit_map, f, indent=1)
with open(os.path.join(PRIVATE, "names_review.txt"), "w") as f: f.write("\n".join(review) + ("\n" if review else ""))

# ------------------------------------------------ backstop (secondary control only)
BACKSTOP = {"email": r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "url": r"[a-z][a-z0-9+.-]*://",
            "jwt": r"eyJ[A-Za-z0-9_-]{5,}", "uuid": r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
            "key_prefix": r"\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{6,}", "ipv4": r"\b\d{1,3}(\.\d{1,3}){3}\b",
            "pooler_host": r"pooler\.supabase\.com|\.supabase\.co\b"}
hits = sorted(k for k, p in BACKSTOP.items() if re.search(p, blob))
raw_defs = ("CREATE OR REPLACE FUNCTION" in blob.upper() or "$FUNCTION$" in blob.upper()
            or any("definition" in f for f in share["q1"]["functions"]))
print(f"share file written: {len(blob)} bytes; literals withheld: {len(lit_map)}; names to review: {len(review)}")
if hits or raw_defs:
    print(f"STOP  backstop matched {hits + (['raw_function_definition'] if raw_defs else [])} - do not share; review private/literal_map.json")
    sys.exit(2)
print("OK    backstop clean. Before sharing: read private/names_review.txt and add any revealing name to private/redact_names.txt, then rerun.")
