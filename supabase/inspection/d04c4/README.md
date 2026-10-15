# D04-C.4 production schema inspection (NOT EXECUTED)

Planning artifacts only. Nothing in this directory is run by CI, and nothing here connects to production.
Executing any of these files against project `ufcgsdpqfqeifjzzcuei` requires explicit written
authorization from the technical coordinator.

| File | Reads | Application rows? |
|---|---|---|
| `q0_migration_history.sql` (v2) | migration ledger (version, name), `storage.buckets` config row for `tripp-deal-documents` | No (platform metadata) |
| `q1_catalog_inspection.sql` (v2) | `pg_catalog`, `pg_policies` only | No |
| `q2_membership_integrity_aggregates.sql` (v1) | membership/org rows, aggregate counts only | **Yes**, needs separate authorization |

Each file contains only `BEGIN ... READ ONLY`, `SET LOCAL`, `SELECT`, and `ROLLBACK`.
Verify integrity with `sha256sum -c SHA256SUMS` before running anything.

`sandbox_smoke.mjs` runs all three against an in-process PGlite database (stub auth/storage, CI bootstrap,
migrations 20261010-20261021, and hostile fixtures). Run it with `npm i && node sandbox_smoke.mjs`.
It is not the Supabase CI dry run.
