#!/usr/bin/env bash
# D04-C.4C: rehearse the isolated-staging procedure end to end on an EMPTY local Supabase stack
# (started with no migrations): baseline outside the ledger -> truthful repair -> push (preflight)
# -> invariant and lifecycle tests -> preflight failure fixtures -> rollback drill -> re-apply.
set -uo pipefail
export STAGING_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
export STAGING_PROJECT_REF=local TRIPP_LOCAL_REHEARSAL=1
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; S="$ROOT/supabase/staging/bootstrap.sh"; CI="$ROOT/supabase/ci"
pass=0; fail=0
ok()  { echo "PASS $1"; pass=$((pass+1)); }
bad() { echo "FAIL $1"; fail=$((fail+1)); }
expect_ok()   { local n=$1; shift; if out=$("$@" 2>&1); then ok "$n"; else echo "$out" | tail -20; bad "$n"; fi; }
expect_fail() { local n=$1 pat=$2; shift 2; if out=$("$@" 2>&1); then echo "$out" | tail -5; bad "$n (unexpected success)";
                elif echo "$out" | grep -q -- "$pat"; then ok "$n"; else echo "$out" | tail -10; bad "$n (wrong error)"; fi; }
q() { psql "$STAGING_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

# Guards
expect_fail G1.production-ref "production project ref" env STAGING_PROJECT_REF=ufcgsdpqfqeifjzzcuei bash "$S" baseline
expect_fail G2.prod-url "production project ref" env STAGING_DB_URL="postgresql://postgres.ufcgsdpqfqeifjzzcuei:x@aws-0-us-east-1.pooler.supabase.com:5432/postgres" bash "$S" baseline
expect_fail G3.remote-ref-mismatch "does not name" env TRIPP_LOCAL_REHEARSAL=0 STAGING_PROJECT_REF=abcdefghijklmnopqrst bash "$S" baseline
expect_fail G4.unpopulated-baseline "not populated" bash "$S" baseline
expect_fail G5.push-before-repair "run repair first" bash "$S" push
expect_fail G6.repair-before-baseline "run baseline first" bash "$S" repair

# Bootstrap exactly as staging will
export TRIPP_ORG_BASELINE="$CI/bootstrap_organizations.sql"
expect_ok   B1.baseline bash "$S" baseline
expect_fail B2.baseline-not-fresh "not a fresh project" bash "$S" baseline
expect_ok   B3.repair bash "$S" repair
expect_fail B4.repair-once "ledger is not empty" bash "$S" repair
expect_ok   B5.push bash "$S" push
v=$(q -tAc "SELECT string_agg(version,',' ORDER BY version) FROM supabase_migrations.schema_migrations")
[ "$v" = "20261010000000,20261011000000,20261012000000,20261012900000,20261013000000,20261014000000,20261015000000,20261016000000,20261017000000,20261018000000,20261019000000,20261020000000,20261021000000,20261022000000,20261023000000" ] \
  && ok B6.ledger-exact || { echo "$v"; bad B6.ledger-exact; }

# Behaviour on the staged schema
expect_ok T1.document-integration q -f "$CI/document_integration.sql"
expect_ok T2.ready-invariants q -f "$CI/d04c_ready_invariants.sql"

# Rollback drill
expect_ok R1.seed-ready q -f "$CI/d04c_rollback_seed.sql"
q -c "INSERT INTO public.deal_documents(id,organization_id,deal_id,document_type,original_filename,storage_path,mime_type,file_size_bytes,uploaded_by) VALUES ('84000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','other','p.pdf','rb/p.pdf','application/pdf',10,'81000000-0000-4000-8000-000000000001')" >/dev/null
expect_fail R2.refuse-in-flight "in-flight document" q -f "$ROOT/supabase/staging/rollback_d04c.sql"
q -c "DELETE FROM public.deal_documents WHERE id='84000000-0000-4000-8000-000000000002'" >/dev/null
expect_ok R3.rollback q -f "$ROOT/supabase/staging/rollback_d04c.sql"
expect_ok R4.v1-verified q -f "$CI/d04c_rollback_verify.sql"

# Preflight failure fixtures, on the real v1 baseline (each mutation is rolled back)
PF="$ROOT/supabase/migrations/20261012900000_d04c_production_preflight.sql"
pf() { local n=$1 pat=$2 sql=$3 f; f=$(mktemp); printf 'BEGIN;\n%s\n\\i %s\nROLLBACK;\n' "$sql" "$PF" > "$f"; expect_fail "$n" "$pat" q -f "$f"; }
expect_ok F0.preflight-clean-v1 q -c "BEGIN;" -f "$PF" -c "ROLLBACK;"
pf F1.legacy-pending "pending document" "INSERT INTO public.deal_documents(organization_id,deal_id,document_type,original_filename,storage_path,mime_type,file_size_bytes,uploaded_by) VALUES ('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','other','l.pdf','rb/l.pdf','application/pdf',10,'81000000-0000-4000-8000-000000000001');"
pf F2.legacy-unscanned-ready "lack a clean scan" "INSERT INTO public.deal_documents(organization_id,deal_id,document_type,original_filename,storage_path,mime_type,file_size_bytes,uploaded_by,upload_status) VALUES ('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','other','l.pdf','rb/l2.pdf','application/pdf',10,'81000000-0000-4000-8000-000000000001','ready');"
pf F3.storage-deny-missing "Storage deny policy" "DROP POLICY tripp_deal_documents_browser_deny ON storage.objects;"
pf F4.bucket-misconfigured "bucket is missing or misconfigured" "UPDATE storage.buckets SET file_size_limit=52428800 WHERE id='tripp-deal-documents';"
pf F5.bucket-public "bucket is missing or misconfigured" "UPDATE storage.buckets SET public=true WHERE id='tripp-deal-documents';"
pf F6.status-constraint-drift "unexpected upload status constraint" "ALTER TABLE public.deal_documents DROP CONSTRAINT deal_documents_upload_status_valid, ADD CONSTRAINT deal_documents_upload_status_valid CHECK (upload_status IN ('pending','processing','ready','failed'));"
pf F7.status-constraint-renamed "is missing" "ALTER TABLE public.deal_documents RENAME CONSTRAINT deal_documents_upload_status_valid TO legacy_status_check;"
pf F8.browser-write-grant "browser roles hold" "GRANT INSERT ON public.deal_documents TO authenticated;"
pf F9.admission-table-exists "already exists" "CREATE TABLE public.document_upload_admissions(id uuid);"
pf F10.composite-fk-missing "composite document/deal foreign key" "ALTER TABLE public.deal_documents DROP CONSTRAINT deal_documents_parent_deal_fk;"
pf F11.guard-trigger-missing "guard trigger is missing" "DROP TRIGGER trg_deal_documents_guard_update ON public.deal_documents;"
pf F12.rls-disabled "RLS is not enabled" "ALTER TABLE public.deal_documents DISABLE ROW LEVEL SECURITY;"

# Truthful ledger after rollback, then re-apply
expect_ok R5.repair-reverted bash -c "cd '$ROOT' && supabase migration repair --db-url '$STAGING_DB_URL' --status reverted 20261012900000 20261013000000 20261014000000 20261015000000 20261016000000 20261017000000 20261018000000 20261019000000 20261020000000 20261021000000 20261022000000 20261023000000"
expect_ok R6.re-push bash "$S" push
[ "$(q -tAc "SELECT upload_status||'/'||verified_sha256 FROM public.deal_documents WHERE id='84000000-0000-4000-8000-000000000001'")" = "ready/$(printf 'f%.0s' {1..64})" ] \
  && ok R7.evidence-survives-reapply || bad R7.evidence-survives-reapply
expect_ok R8.document-integration-after-reapply q -f "$CI/document_integration.sql"
expect_ok R9.invariants-after-reapply q -f "$CI/d04c_ready_invariants.sql"

echo "STAGING REHEARSAL: $pass passed, $fail failed"
[ "$fail" = 0 ]
