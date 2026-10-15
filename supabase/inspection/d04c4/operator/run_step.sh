#!/usr/bin/env bash
# TRIPP D04-C.4A.3 operator step runner.
# Usage:  bash run_step.sh qid|q0|q1
# Runs ONE pinned inspection file with the exact psql invocation the runbook specifies, then exits
# with psql's own status (0 = success; anything else = STOP). Requires TRIPP_CONN (no password in it).
# psql prompts for the password on the terminal (-W); it is never stored, logged or passed in env.
set -u
step="${1:-}"
case "$step" in
  qid) file=qid_identity_session.sql ;;
  q0)  file=q0_migration_history.sql ;;
  q1)  file=q1_catalog_inspection.sql ;;
  *)   echo "usage: bash run_step.sh qid|q0|q1   (Q2 is not runnable here by design)" >&2; exit 64 ;;
esac
if [ -z "${TRIPP_CONN:-}" ]; then echo "STOP: TRIPP_CONN is not set" >&2; exit 65; fi
case "$TRIPP_CONN" in *password=*|*://*:*@*) echo "STOP: TRIPP_CONN must not contain a password" >&2; exit 65 ;; esac
if [ -n "${PGPASSWORD:-}" ] || [ -n "${PGPASSFILE:-}" ]; then echo "STOP: unset PGPASSWORD/PGPASSFILE" >&2; exit 65; fi

pkg="$(cd "$(dirname "$0")/.." && pwd)"
out="${TRIPP_OUT:-$HOME/tripp-inspect/out}"
umask 077
mkdir -p "$out"

if command -v sha256sum >/dev/null 2>&1; then sumcmd="sha256sum"; else sumcmd="shasum -a 256"; fi
if ! (cd "$pkg" && $sumcmd -c SHA256SUMS >/dev/null 2>&1); then
  echo "STOP: pinned file checksum mismatch - do not run" >&2; exit 66
fi

rm -f "$out/tripp_$step.json" "$out/tripp_$step.stderr"
unset PGOPTIONS
psql "$TRIPP_CONN" -W --no-psqlrc --quiet --tuples-only --no-align -v ON_ERROR_STOP=1 \
  -c "SET search_path = pg_catalog, pg_temp" \
  -c "SET default_transaction_read_only = on" \
  -f "$pkg/$file" \
  -o "$out/tripp_$step.json" 2> "$out/tripp_$step.stderr"
rc=$?
echo "exit=$rc"
exit "$rc"
