# D04-C — Document upload backend MVP

Branch: `d04-c-document-backend-mvp`, cut from `d04-b2-backend-foundation`. All earlier work is kept.
Scope: backend only. The vb.do team owns the frontend and integrates through `docs/D04-C-document-api-contract.md`.

## What changed
1. **Practical file policy** (`_shared/file-validation.ts`, `checkPdf` / `checkDocx` return reason codes).
   - PDFs: accept object streams, AcroForms, OpenAction and /AA, which Word, Acrobat, Preview and scanners all emit. Still reject JavaScript, Launch, embedded files, RichMedia, XFA and encryption. Markers inside stream payloads are ignored to avoid false positives on images and fonts. Trailing whitespace and NUL padding after `%%EOF` are accepted.
   - DOCX: accept ZIP data descriptors (flag bit 3) and differing local extra fields. Still reject ZIP64, encryption, traversal, duplicates and bombs. Macros (`vbaProject.bin`), ActiveX and executable or OLE embeddings return `docx_macros`.
   - The experimental inspector keeps the frozen strict policy (`file-validation-strict.ts`).
2. **Lifecycle** (migration `20261021000000_document_lifecycle_mvp.sql`):
   - Adds a `failure_reason` column (constrained values, set only when failed).
   - `tripp_reject_document_finalize`: terminal rejection by the lease holder.
   - `tripp_fail_stuck_processing`: 24h bound on processing time.
   - Abandoned pending uploads now record `upload_abandoned`.
3. **Finalize** returns one of three outcomes: 200 ready, 422 failed with a reason (terminal), or 202 processing (transient: scanner down, lease, bind). It never leaves a definite rejection stuck in `processing`.
4. **Reconciler** resumes from `quarantine.*` when finalize deferred before promotion. Definite failures (bad file, malware, inconclusive scan, digest mismatch) become `failed` with a reason instead of manual review. It also applies the 24h timeout.
5. **APIs**:
   - Every error carries a stable `code`.
   - Initiate returns `bucket`, `uploadPath` and `uploadStatus`.
   - List returns `failureReason` and `updatedAt`, and accepts `documentId` for polling.
   - Download returns `filename` and `mimeType`, and the signed URL downloads with the original filename.
   - CORS accepts wildcard origins for Vercel previews (staging).
6. **Config**: `supabase/config.toml` sets per-function `verify_jwt` (user endpoints on, reconciler off).
7. **Tests**:
   - Synthetic realistic corpus in `supabase/functions/tests/fixtures/` covering 8 accepted and 4 rejected files.
   - Corpus unit test.
   - Updated unit tests.
   - E2E checks for the rejection contract, single-document status polling, a realistic PDF and DOCX through to byte-exact download, and tamper leading to failed.
   - SQL privilege checks for the new RPCs.
   - CI workflows now trigger on this branch.

## Unchanged by design
- Malware scanning stays mandatory for READY, enforced in the DB.
- The content-inspection system is not expanded and stays off (`TRIPP_REQUIRE_CONTENT_INSPECTION` unset).
- Private bucket, quarantine-only signed uploads, immutable `source.*`, SHA-256 binding, org-scoped authorization, quotas and audit events are all kept.

## Staging deployment (owner-provisioned project; never `ufcgsdpqfqeifjzzcuei`)
1. Create Supabase project `tripp-staging`. Apply prerequisites (organizations, memberships, deals; see `supabase/ci/bootstrap_organizations.sql` and `20261010000000_create_deals_v1.sql`), then migrations `20261011…` through `20261021…` in order.
2. Function secrets:
   - `TRIPP_ALLOWED_ORIGINS`: the staging and preview origins.
   - `TRIPP_ENABLE_DOCUMENT_UPLOADS=verified`
   - `TRIPP_ENABLE_MALWARE_SCANNING=verified`
   - `TRIPP_MALWARE_SCANNER_URL` and `TRIPP_MALWARE_SCANNER_SECRET`: the ClamAV gateway from `scanner/`.
   - `TRIPP_RECONCILER_SECRET`, at least 32 characters.
   - `TRIPP_ENABLE_RECONCILER=verified`
3. Run `supabase functions deploy --project-ref <staging-ref>` for the five `deal-document-*` functions.
4. Schedule the reconciler every 5 minutes (pg_cron + pg_net, or GitHub Actions cron) with the secret header.
5. Create synthetic admin, member, viewer and outsider users and two orgs. Run `staging_smoke_test.ts`, then upload the fixture corpus by hand.
6. The frontend preview must point at the staging project URL and publishable key. This is a vb.do change: `src/lib/supabase.ts` currently hardcodes production.

Production remains NO-GO until explicit approval.
