# D04-B2 — Backend foundation and runtime compatibility gate

Status: PREPARATION ONLY. No production deployment. No SQL changes.
Depends on D04-A1 and D04-A2 (manually applied; migration history absent).

## Repository audit (2026-10-12)
- React 19/Vite app, Supabase JS ^2.86.0.
- Existing `AuthContext` resolves one organization and role client-side; this is a UI convenience, not backend authorization.
- `DealWorkspace` includes Document Intelligence placeholder; do not modify its edit flow until API tests pass.
- `supabase/config.toml` and `supabase/functions/README.md` were not found in main.
- D04-A1: `deal_documents` table, RLS read policy, authenticated SELECT only, pending->ready/failed guard.
- D04-A2: private `tripp-deal-documents` bucket, 20 MiB, PDF/DOCX MIME restriction, RESTRICTIVE policy on `storage.objects` denies ordinary roles.

## Transport decision gate
Do not POST a 20 MiB file to an Edge Function until its actual body limit is confirmed.
Candidate A: trusted backend receives and validates file, writes Storage with service credentials; viable only if runtime size and memory allow it.
Candidate B: backend issues tightly scoped upload authorization, client transfers directly, backend validates bytes and finalizes. MUST first demonstrate signed-upload behavior with the restrictive Storage policy. No policy relaxation without separate security review.
If neither candidate passes, use a server-side upload proxy on a platform with verified limits; do not enable anonymous or general authenticated Storage writes.

## Server authorization contract (all endpoints)
- Require and verify caller JWT server-side; never trust browser-supplied userId or role.
- Verify live organization_memberships record for caller and requested organization.
- Verify requested deal belongs to that organization.
- Upload: admin/member only; list/download: admin/member/viewer.
- For download: document must match (organization_id, deal_id, id), status ready, and object path from DB only.
- Return generic 404 for inaccessible resources, 401 for absent/invalid JWT, 413 oversized, 415 unsupported type, 429 rate limit, 500 sanitized server errors.
- Never return service credentials or permanent public links.

## Upload integrity
- Server-generated id and immutable path: `orgId/dealId/documentId/source.pdf|docx`.
- Validate actual file bytes, not just extension or supplied MIME.
- PDF: structural parser validation. DOCX: bounded ZIP parse, required OOXML parts, reject traversal/zip bombs and unsafe embedded content.
- Enforce size at transfer layer and application layer, max 20,971,520 bytes.
- Use no-overwrite semantics. Pending metadata -> verified object -> ready; on error -> failed and clean up object.
- Account for partial failures and retries; avoid duplicate document records.
- Do not invoke AI extraction in B2.

## API proposal
- POST /functions/v1/deal-document-upload (transport conditional)
- GET /functions/v1/deal-document-list?organizationId=&dealId=
- POST /functions/v1/deal-document-download with organizationId, dealId, documentId
- Responses exclude storage_path; signed download URLs expire rapidly.

## Must verify before backend implementation/deployment
1. Supabase Edge Functions deployment access and project configuration.
2. Edge Function body limits and CPU/memory/time budget in this project.
3. Storage signed-upload behavior under the existing restrictive policy (isolated test only).
4. Secret management for privileged Storage client; service-role key must never be committed.
5. Actual `deal_documents` schema/trigger behavior against pending->ready/failed.
6. Admin/member/viewer/nonmember and cross-org tests, including role revocation.
7. Migration history strategy before automated deployment.

## Acceptance
Do not expose upload UI until upload + list + download and negative authorization tests pass. Existing Deals create/edit must remain unchanged.
