#!/usr/bin/env bash
# Reproduce the production ledger anomaly against disposable LOCAL Supabase.
# Does not claim to replay the production AI quota DDL or certify db push.
set -euo pipefail
test "${TRIPP_LOCAL_REHEARSAL:-}" = 1 || { echo 'REFUSED: TRIPP_LOCAL_REHEARSAL=1 required'; exit 2; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export STAGING_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
export STAGING_PROJECT_REF=local
export TRIPP_LOCAL_REHEARSAL=1
# A new stack is required: staging bootstrap itself refuses a populated ledger.
test "$(psql "$STAGING_DB_URL" -XAtqc "SELECT (to_regclass('public.deals') IS NULL)::int")" = 1 || { echo 'REFUSED: not a fresh local stack'; exit 2; }
bash supabase/staging/bootstrap.sh baseline
# Stage a truthful local ledger record for baseline migrations, which were just applied.
bash supabase/staging/bootstrap.sh repair
# Production also has an independently deployed AI quota migration.
# Represent only its ledger version, not its DDL; no false claim of functional equivalence.
psql "$STAGING_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES ('20261016010702','deal_ai_quota',ARRAY[]::text[])
ON CONFLICT(version) DO NOTHING;
SQL
test "$(psql "$STAGING_DB_URL" -XAtqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20261010000000','20261011000000','20261012000000','20261016010702')")" = 4
echo 'REPRODUCED: production-shaped four-version ledger in disposable local stack'
echo 'Now testing CLI migration push behavior; this may fail and should block release.'
# A failure here is important evidence; do not suppress.
supabase db push --db-url "$STAGING_DB_URL" --yes
psql "$STAGING_DB_URL" -XAtqc "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version"
echo 'PARTIAL PASS: migration push accepted interleaved ledger; AI quota DDL equivalence still unverified.'
