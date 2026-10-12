# D04-B4 — Production readiness and security certification assessment

Assessment date: 2026-10-12
Scope: review branch `d04-b2-backend-foundation`; no production deployment or migration.
Evidence: GitHub Actions run 38282259677, commit 41908aa31f372cda6e5f57c40f7f66de44530201, three successful jobs.
Decision: **NO-GO — NOT CERTIFIED FOR PRODUCTION**.

## Verified in isolated GitHub Actions

- Deno document validation/security unit tests passed.
- Local Supabase migration smoke and SQL authorization/lifecycle assertions passed.
- Isolated Storage and Edge Function HTTP end-to-end tests passed.
- Concurrent finalization, tenant isolation, invalid uploads, stale worker fencing, abandoned uploads, and recovery scenarios exercised.
- D04-B3.6 recovery compares SHA-256 of source bytes against a digest bound during finalization; a same-size modified source is rejected in CI.
- D04-B3.5 checks DOCX local ZIP header consistency and overlapping entries. This is structural validation only.

These results do not demonstrate production runtime compatibility, real-world DOCX handling, malware safety, or operational resilience.

## Release-blocking findings

| ID | Severity | Finding | Required evidence / remediation |
|---|---|---|---|
| B4-C1 | Critical | No malware screening, PDF sanitization, or complete OOXML/ZIP semantic verification. PDF validator only checks header/terminal EOF; DOCX validation remains structural. | Adopt a documented untrusted-file policy; sandbox or scan uploads before publication and any parsing, or restrict release to a separately approved risk posture. Exercise representative valid/malicious fixtures. |
| B4-C2 | Critical | Database lease and Storage promotion are not atomic. A stale worker may create a source after lease check, and `upsert:false` prevents overwrite but does not prove exactly-once attribution. | Failure-injection tests at lease expiry, upload, digest binding, READY transition, and worker contention; document safe recovery/manual review. |
| B4-C3 | High | Recovery checks digest, but ready-file signed download does not rehash Storage source. The stored digest is not a continuous integrity attestation. | Define immutable Storage object controls and monitoring, or verify integrity before each release of access; test changed ready-source behavior. |
| B4-H1 | High | Production migration history is unreconciled; A1/A2 manually applied. New B2.5/B2.6/B3.6 migrations remain review-only. | Inventory actual production schema, policies, grants, indexes, functions and migration history; write approved, reversible rollout plan. |
| B4-H2 | High | No proven endpoint rate limits, upload quotas, concurrency caps or storage cost ceilings. | Enforce and test per-user/org limits, pending record caps and request budgets. |
| B4-H3 | High | Reconciler has no verified production schedule, alerts, per-run resource budget or dead-letter escalation. | Instrument and exercise scheduled recovery, alerting, timeouts, failure counters, and manual intervention. |
| B4-H4 | High | Signed upload token replay is accepted in isolated tests for quarantine; source remains protected, but token expiry and provider-specific semantics have not been independently established in deployed staging. | Record token expiry, replay and path behavior in controlled deployment; maintain strict quarantine separation. |
| B4-H5 | High | No representative real-world DOCX fixture, ZIP bomb / OOXML relationship corpus, or downstream parser sandbox evidence. | Add realistic clean and adversarial corpus with bounded CPU/memory execution. |
| B4-H6 | High | No staging deployment with production-like gateway JWT, secret isolation, feature flags, or rollback drill. | Run staging-only test plan, capture timestamps, commit, project ref and evidence. |

## Release gates

G1. All critical findings resolved with reviewed changes and reproducible evidence.
G2. Every high finding either resolved or covered by documented, approved compensating controls with accountable owner.
G3. Full isolated CI green at a frozen commit, including negative security and fault-injection tests.
G4. Dedicated staging deployment: real Storage transport, token expiry, realistic documents, JWT gateway, scheduled reconciliation, monitoring, rollback.
G5. Production schema and migration history reconciled; no blind migration replay.
G6. Production change plan with rollout, observability, emergency disable switches, manual recovery and rollback rehearsal.
G7. Explicit user authorization before production migration, Edge Function deployment, scheduler enablement or feature flag change.

## Safe execution order

1. B4-A: Implement rate limits/quotas, structured audit events and reconciler execution budgets.
2. B4-B: Strengthen file safety policy and representative PDF/DOCX validation; determine malware scanning/sandbox boundary.
3. B4-C: Address lease/promotion failure windows and ready-file integrity guarantees.
4. B4-D: Run isolated fault injection, resource-limit and token-expiry suites.
5. B4-E: Reconcile production migration history without modifying production.
6. B4-F: Conduct staging-only deployment and rollback rehearsal.
7. B4-G: Reissue certification report and seek explicit production approval.

## Production guardrails

- Keep `TRIPP_ENABLE_DOCUMENT_UPLOADS` and `TRIPP_ENABLE_RECONCILER` unset in production.
- Do not deploy review branch, migrations, Edge Functions, scheduler or Storage policy changes to production.
- Do not delete final source objects to conceal inconsistent states; preserve audit evidence and reconcile manually.
- CI success does not constitute deployment approval.

## Evidence limitations

This is a code and isolated-CI readiness assessment, not an external penetration test, malware certification, formal compliance audit, or production operational attestation.
