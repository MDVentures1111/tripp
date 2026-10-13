# D04-B4-B.5 — Adversarial file testing and security certification

**Status: IN PROGRESS / NO-GO.** This document tracks tested controls and open release blockers. Passing automated tests is not independent security certification.

## Added verification
- Real ClamAV staging gateway: standard antivirus test signature and clean-file differentiation, bearer authentication, digest mismatch, scanner outage.
- Gateway stress boundary: oversized actual request body (>20 MiB), empty request, six concurrent scans, post-burst clean scan.
- PDF regression: known active-content markers, truncated file, trailing data, oversized PDF.
- Existing DOCX ZIP regressions: central directory corruption, local header mismatch, unsafe names, overlapping records, ZIP64/encryption and expansion limits implemented in validator.

## Additional review-branch verification (CI results pending)
- PDF hexadecimal-escaped active-content name regression cases.
- DOCX ZIP64, encryption, expanded-size, compression-ratio and out-of-bounds local-header regression cases.
- Dedicated isolated full application HTTP E2E using real ClamAV instead of simulated verdicts, including EICAR finalization denial and signed-download denial. This does not replace independent security review or sandboxed document parsing.

## Explicitly unverified
1. Compressed or obfuscated PDF JavaScript, incremental revisions, malformed cross-reference tables, polyglots, PDF parser differential attacks.
2. DOCX OPC relationships and external links, decompressed XML content types, entity expansion, malformed deflate streams, zip-bomb behavior with actual decompression, embedded OLE objects.
3. ClamAV signature freshness enforcement, versioned scan attestations, scanner restart under load, multiple workers, per-tenant fairness, slow-client upload deadlines and real resource ceilings.
4. Full application E2E staging with actual scanner gateway (prior application E2E used simulated scanner); scanner outage-to-reconciler rescan and signed-download denial.
5. Independent security review, operational alert routing, database migration reconciliation and production rollback.

## Certification decision
**NO-GO**. Do not claim all PDFs/DOCX are safe or enable production uploads. Before promoting B4-B, add a sandboxed PDF/OOXML parser/sanitizer, representative licensed adversarial corpus, production-grade scanner infrastructure and full integrated staging evidence.
