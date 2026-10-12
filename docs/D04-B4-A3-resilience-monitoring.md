# D04-B4-A.3 — Failure resilience and operational monitoring

Status: review-only; production deployment prohibited. Evidence must reference a frozen commit and CI run.

## Runtime signals and proposed alert thresholds

The JSON event schema is `tripp.document.audit.v1`. Ingestion must exclude bearer credentials, upload tokens, signed URLs, document filenames and bytes. Store logs with restricted access and a documented retention period. Log emission alone does not establish monitoring or alert delivery.

| Signal | Alert condition | Action |
|---|---|---|
| upload_admission outcome=error | Any sustained error for 5 minutes | Check PostgREST/RPC availability; leave uploads disabled if uncertain |
| upload_admission outcome=denied | Unexpected spike, e.g. 20 denials per org in 15 minutes | Inspect abusive traffic and user experience |
| reconciler_run outcome=error | Any scheduled invocation fails | Investigate database/Storage health and retry safely |
| reconciler_run reason contains manual_review | Any occurrence | Page operator; preserve Storage source and metadata |
| reconciler_run reason contains deferred | Two consecutive runs | Reduce batch size or adjust schedule; inspect backlog |
| reconciler_run missing | No successful run within 2 scheduling intervals | Check scheduler and secret rotation |
| deal_documents processing overdue | Any document exceeds recovery SLA | Inspect lease and source digest, never manually mark ready without validation |

## Required failure injection before production

1. Disable/rename the admission RPC in an isolated test environment. Initiate must return 503, not issue a signed upload URL; verify structured error event.
2. Force metadata insertion failure after successful admission. Verify no signed URL, no ready document, and conservative reservation accounting. Establish safe reservation expiry/cleanup.
3. Force Storage signed-token issuance failure. Verify metadata becomes failed and no signed token leaks.
4. Force reconciler processing query failure. Verify 503 and structured error event.
5. Force Storage download timeout/partial outage during reconciliation. Ensure lease fencing prevents false ready status; record manual review and retry behavior.
6. Inject a >45-second Storage call: the current wall-clock check is cooperative, not a hard timeout. Add AbortSignal or equivalent bounded transport before production.
7. Inject a batch exceeding 100 MiB; verify no further downloads and alertable backlog. The budget currently covers expected document sizes, not arbitrary network payloads.
8. Verify scheduler retry/idempotency, secret rotation, duplicate invocations, monitoring ingestion and alert receipt in staging.
9. Validate org-wide concurrent admissions across distinct users. Current organization quota reads active documents but does not count uncommitted admission reservations; this is a known concurrency gap and must be fixed.
10. Verify admission ledger retention and operational cleanup; current records are never pruned.

## Release blockers carried forward

- No malware scanning/sandbox boundary or complete PDF/DOCX semantic safety.
- Non-atomic Storage promotion and DB lease transitions.
- No ready-file continuous integrity check.
- Unreconciled production migration history.
- No deployed scheduler, alert routing or rollback rehearsal.
- Signed-upload expiry and real-world DOCX corpus not certified.

Do not promote this review branch, run production migrations, or enable feature flags without explicit authorization.
