# D04-C.4 production schema inspection (NOT EXECUTED)

Planning artifacts only. Nothing in this directory is run by CI, and nothing here connects to production.
Executing any of these files against project `ufcgsdpqfqeifjzzcuei` requires explicit written
authorization from the technical coordinator.

| File | Reads | Application rows? |
|---|---|---|
| `q0_migration_history.sql` (v2) | migration ledger (version, name), `storage.buckets` config row for `tripp-deal-documents` | No (platform metadata) |
| `q1_catalog_inspection.sql` (v2.1) | `pg_catalog`, `pg_policies` only | No |
| `qid_identity_session.sql` (v1) | server settings, extension list, public table names, ledger count/latest version, bucket ids | No (identity fingerprint; operator-only, never shared) |
| `q2_membership_integrity_aggregates.sql` (v1) | membership/org rows, aggregate counts only | **Yes**, needs separate authorization |

Each file contains only `BEGIN ... READ ONLY`, `SET LOCAL`, `SELECT`, and `ROLLBACK`.
Verify integrity with `sha256sum -c SHA256SUMS` before running anything.

`sandbox_smoke.mjs` runs all three against an in-process PGlite database (stub auth/storage, CI bootstrap,
migrations 20261010-20261021, and hostile fixtures). Run it with `npm i && node sandbox_smoke.mjs`.
It is not the Supabase CI dry run.

`ci/verify.py` + `ci/hostile_fixtures.sql` are run by `.github/workflows/d04-inspection-verify.yml` against a disposable
local Supabase stack only (no secrets, no project link). Raw outputs are deleted on the runner; logs carry PASS/FAIL only.

`operator/` holds the founder-run tools for the D04-C.4A.3 runbook (pinned in `SHA256SUMS`):
`run_step.sh qid|q0|q1` (the exact psql invocation; Q2 is not runnable), `validate.py` (OK/STOP and counts only),
and `make_share.py` (deny-by-default share file: function bodies withheld, non-repository literals replaced).
`ci/runbook_path.py` exercises these exact tools over TCP with a pty-answered password prompt, failure cases,
and the local session pooler where the CLI can start it.
