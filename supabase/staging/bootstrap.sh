#!/usr/bin/env bash
# D04-C.4C isolated staging bootstrap. NEVER run against production.
#
# Reproduces the production pre-ledger baseline in a fresh, separate Supabase project, then
# adopts the CLI migration ledger truthfully (repair records only migrations this script
# itself just applied), then pushes the D04-C lifecycle exactly as production would receive it.
#
#   bootstrap.sh baseline   apply org/membership baseline + 20261010..12 to a FRESH project
#   bootstrap.sh repair     record 20261010..12 as applied (only after `baseline` succeeded)
#   bootstrap.sh push       supabase db push (preflight 20261012900000 runs first, fail-closed)
#
# Required env: STAGING_DB_URL (staging Postgres URL), STAGING_PROJECT_REF (staging ref).
# Rehearsal only (CI): TRIPP_LOCAL_REHEARSAL=1 with STAGING_PROJECT_REF=local and a localhost
# URL; TRIPP_ORG_BASELINE may then point at a fixture.
set -euo pipefail
PROD_REF="ufcgsdpqfqeifjzzcuei"
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/../migrations"
BASELINE_VERSIONS=(20261010000000 20261011000000 20261012000000)

die() { echo "REFUSED: $*" >&2; exit 2; }
: "${STAGING_DB_URL:?STAGING_DB_URL is required}"
: "${STAGING_PROJECT_REF:?STAGING_PROJECT_REF is required}"

case "$STAGING_DB_URL $STAGING_PROJECT_REF" in *"$PROD_REF"*) die "production project ref detected";; esac
if [ "${TRIPP_LOCAL_REHEARSAL:-0}" = "1" ]; then
  [ "$STAGING_PROJECT_REF" = "local" ] || die "rehearsal requires STAGING_PROJECT_REF=local"
  [[ "$STAGING_DB_URL" =~ @(127\.0\.0\.1|localhost): ]] || die "rehearsal requires a localhost database"
  ORG_BASELINE="${TRIPP_ORG_BASELINE:-$HERE/baseline/00_org_membership.sql}"
else
  [[ "$STAGING_PROJECT_REF" =~ ^[a-z0-9]{20}$ ]] || die "STAGING_PROJECT_REF is not a project ref"
  [[ "$STAGING_DB_URL" == *"$STAGING_PROJECT_REF"* ]] || die "STAGING_DB_URL does not name STAGING_PROJECT_REF"
  ORG_BASELINE="$HERE/baseline/00_org_membership.sql"
fi

q() { psql "$STAGING_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
ledger_rows() {
  local exists
  exists=$(q -tAc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'")
  if [ "$exists" = "0" ]; then echo 0; else q -tAc "SELECT count(*) FROM supabase_migrations.schema_migrations"; fi
}

case "${1:-}" in
  baseline)
    head -1 "$ORG_BASELINE" | grep -q TRIPP_BASELINE_UNPOPULATED && die "org/membership baseline not populated from production Q1"
    [ "$(q -tAc "SELECT (to_regclass('public.organizations') IS NULL AND to_regclass('public.deals') IS NULL AND to_regclass('public.deal_documents') IS NULL)::int")" = "1" ] \
      || die "target is not a fresh project (baseline tables already exist)"
    [ "$(ledger_rows)" = "0" ] || die "target already has migration history"
    q -f "$ORG_BASELINE"
    for v in "${BASELINE_VERSIONS[@]}"; do q -f "$(ls "$MIG"/"${v}"_*.sql)"; done
    echo "BASELINE APPLIED: org/membership + ${BASELINE_VERSIONS[*]}"
    ;;
  repair)
    [ "$(ledger_rows)" = "0" ] || die "ledger is not empty; repair only once, right after baseline"
    [ "$(q -tAc "SELECT (to_regclass('public.deal_documents') IS NOT NULL AND EXISTS (SELECT 1 FROM storage.buckets WHERE id='tripp-deal-documents'))::int")" = "1" ] \
      || die "baseline objects not present; run baseline first"
    (cd "$HERE/../.." && supabase migration repair --db-url "$STAGING_DB_URL" --status applied "${BASELINE_VERSIONS[@]}")
    ;;
  push)
    [ "$(ledger_rows)" -ge 3 ] || die "baseline not recorded; run repair first"
    (cd "$HERE/../.." && supabase db push --db-url "$STAGING_DB_URL" --yes)
    ;;
  *) echo "usage: $0 baseline|repair|push" >&2; exit 64 ;;
esac
