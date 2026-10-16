#!/usr/bin/env bash
# Production-shaped D04 migration-history rehearsal. Disposable LOCAL Supabase only.
# Requires local Supabase stack started with CI baseline migration; never accepts remote URLs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_CONTAINER="supabase_db_tripp"
test "${TRIPP_LOCAL_REHEARSAL:-}" = "1" || { echo "REFUSED: local rehearsal flag required"; exit 2; }
docker inspect "$DB_CONTAINER" >/dev/null
sql() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -A -t -v ON_ERROR_STOP=1 -c "$1"; }
# The local stack already has the entire lifecycle schema. This is strictly a ledger
# ordering simulation, not an end-to-end migration application rehearsal.
before="$(sql "SELECT count(*) FROM supabase_migrations.schema_migrations")"
test "$before" -gt 0
sql "BEGIN; INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20261016010702','deal_ai_quota',ARRAY[]::text[]) ON CONFLICT(version) DO NOTHING; ROLLBACK;" >/dev/null
# Validate that the existing D04 branch's migration versions bracket the AI version.
python3 "$ROOT/supabase/ci/d04_ledger_order_check.py"
echo "PASS: disposable local database accepts isolated ledger interleaving simulation"
echo "NOT CERTIFIED: no production-shaped db push or truthful repair has been exercised"
