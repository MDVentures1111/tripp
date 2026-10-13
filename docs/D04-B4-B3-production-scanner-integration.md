# D04-B4-B.3 — Production scanner integration decision (review only)

**Status: NOT PRODUCTION CERTIFIED.** No scanner service has been provisioned or connected to production.

## Recommended deployment architecture

Use a separately deployed, isolated scanning gateway backed by **ClamAV (clamd)** as the first malware detection engine. The gateway must implement the existing authenticated `POST /scan` contract: raw document bytes in the request body, `Authorization: Bearer <secret>`, `X-Content-SHA256`, and JSON `{ "verdict": "clean" | "malicious" | "indeterminate", "sha256": "<64 hex>", "engine": "<name/version/signature-set>" }`. The gateway must independently compute SHA-256 over the received bytes and refuse mismatches. It must return `indeterminate` for engine errors, signature unavailability, scan limits and incomplete scans, never `clean`.

Do not expose clamd directly to the internet or the browser. Run it in an isolated service with restrictive network egress, CPU/memory/file/time limits, signature update monitoring, non-root identity, no persistent document storage, and separate service credentials. Prefer a private network endpoint or authenticated TLS gateway reachable from Supabase Edge Functions. No CI fixture credentials or `TRIPP_CI_SCANNER_FIXTURE` setting may be used in production.

ClamAV scanning **alone is not sufficient** for the document safety policy: PDF active-content and DOCX OPC relationships still require robust bounded parsing/sanitization; encrypted and ambiguous files must be quarantined. An independently validated engine and licensed adversarial corpus are required before production certification.

## Application controls implemented on review branch

- Finalization requires enabled scanner configuration and a matching clean verdict before DB evidence binding and READY transition.
- Reconciler can obtain a fresh scanner verdict on verified source bytes if prior evidence is absent; scanner outage and non-clean verdict cannot advance READY.
- Signed download now refuses READY records without persisted matching digest and scan timestamp, including legacy READY rows.

## Outstanding gates

1. Provision and operate the **real** scanner gateway and ClamAV signature-update process in a non-production environment.
2. Verify scanner response authenticity, versioned signature freshness, bounded decompression, rate limits, audit telemetry and alerting. Ensure scanner gateway is not a public unauthenticated endpoint.
3. Add real malicious, encrypted, malformed, decompression-bomb, PDF and DOCX adversarial fixtures; exercise outage and stale recovery against the real engine.
4. Verify database migration history, SQL privileges, RLS and Storage access; do not apply review migrations automatically to production.
5. Complete atomicity/fencing, signed-upload replay containment and migration reconciliation before launch.
6. Record independent staging evidence and explicitly approve production deployment.

**Decision:** Continue review-branch engineering. Production uploads remain disabled and deployment remains NO-GO.
