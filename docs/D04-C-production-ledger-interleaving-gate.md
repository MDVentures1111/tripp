# D04 migration sequencing blocker — 2026-10-15

**Status: NO-GO for production writes.** Read-only Supabase connector metadata confirms:

- Production migration ledger records `20261016010702_deal_ai_quota` only.
- The three manually installed baseline versions `20261010000000`, `20261011000000`, `20261012000000` are not recorded.
- D04 document lifecycle migration versions begin at `20261012900000` and continue through at least `20261023000000`.
- **Critical ordering detail:** the existing production `20261016010702` AI migration sorts *between* D04 document versions `20261016000000` and `20261017000000`. Any CLI push/repair plan must preserve this applied migration and explicitly handle this interleaving; never replace the ledger or replay the AI quota migration.
- Live document baseline passed checks for RLS, pending/ready/failed status constraint, composite deal FK, enabled guard trigger, denied browser writes and anonymous SELECT, restrictive Storage deny policy, private 20 MiB PDF/DOCX bucket, and zero documents.
- `document_upload_admissions` is absent as expected.

## Required next engineering work

1. Inventory **all** migration files on `main` and `d04-c-document-backend-mvp`, including the exact filenames and SQL for baseline versions 20261010/11/12. A branch comparison only lists changed files, not unchanged files.
2. Compare complete baseline DDL and privileges to production catalogs. The D04 preflight alone is not a full equivalence proof.
3. Rehearse the **production-shaped ledger** in disposable local CI: baseline already present but unrecorded, AI quota version 20261016010702 recorded, D04 lifecycle pending. Demonstrate a safe and truthful migration repair plan without touching the live ledger.
4. Validate `supabase db push` behavior when applied migrations are interleaved with pending earlier migrations; pin CLI version and preserve the AI migration. Stop on any history mismatch.
5. Rehearse document scanner, Edge Functions, rollback, tenant isolation and authorization with uploads disabled by default. Record immutable CI evidence.
6. Only after a documented GO decision and explicit approval may production migration history be repaired or document backend deployed.

Do not alter production, production Edge Functions, existing Deal Intelligence, or frontend.
