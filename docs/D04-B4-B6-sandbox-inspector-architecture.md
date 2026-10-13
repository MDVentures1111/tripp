# D04-B4-B.6 — Sandboxed document inspector architecture

**Status: CONTRACT IMPLEMENTED / INSPECTOR NOT IMPLEMENTED / NO-GO.**

## Trust boundary

TRIPP Edge Functions and the ClamAV gateway must not parse or execute untrusted PDF/DOCX content. A dedicated isolated inspector worker must receive the exact quarantine bytes, parse in a resource-constrained process, and return a digest-bound verdict. The `_shared/content-inspector.ts` client validates transport, digest, verdict, engine identity and policy version. It is currently **not wired to finalization** and must not be represented as an active safety control.

## Mandatory worker behavior before enabling uploads

- Accept only PDF or DOCX, at most 20 MiB input, digest SHA-256 exact match; reject redirects and malformed requests.
- Use independent containers or sandbox processes with no outbound network, read-only filesystem, no credentials, unprivileged UID, restricted syscalls, CPU/memory/pid limits, strict wall-time and decompressed-byte ceilings.
- For PDF: use a maintained parser to validate cross-reference/object graph and revisions; decode streams within limits; reject encryption, JavaScript, actions, embedded files, suspicious annotations and unsupported active features. Unknown or ambiguous parser outcomes are `indeterminate`, never `safe`.
- For DOCX: use bounded ZIP decompression and verify CRC/entry integrity; inspect OPC content types and relationships, forbid external relationships, embedded OLE and macros, reject DTD/entities, validate required WordprocessingML parts; prevent zip bombs and duplicate/overlapping entries.
- Never mutate the source bytes without recording a new SHA-256 and re-running ClamAV; sanitization outputs are distinct immutable derivatives.
- Return JSON `{verdict:"safe"|"unsafe"|"indeterminate",sha256,engine,policyVersion}`; every field is mandatory. Gateway authentication and TLS/private ingress required. Errors/timeouts must fail closed.
- Ensure policy version and parser engine version are pinned, auditable, and allow revocation/re-inspection.

## Required integration work

1. Build the actual worker with parser libraries, sandbox controls, fixtures and resource-limited CI.
2. Integrate `inspectDocument` in finalize and reconciler **before promotion**; require both independent ClamAV `clean` and inspector `safe` for the identical digest.
3. Persist inspector evidence in a service-role-only, lease-fenced DB transition; require both attestations in the READY transition and download authorization. Do not trust client-supplied attestations.
4. Add real E2E with safe/malicious/indeterminate/timeouts, worker crash, corrupt compressed streams, DOCX external relationships, resource exhaustion and reconciler recovery.
5. Complete independent security review and production migration reconciliation before enabling.

## Current evidence

- Typed client: `supabase/functions/_shared/content-inspector.ts`.
- Unit tests: `supabase/functions/tests/content_inspector_test.ts`.
- These tests check **contract validation**, not parser safety or sandbox isolation.

**Release gate: NO-GO.** Production untouched.
