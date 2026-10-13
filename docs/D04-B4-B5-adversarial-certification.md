# D04-B4-B.5 — Adversarial file testing and security certification

**Status: IN PROGRESS / NO-GO.** Passing automated tests is not independent security certification. This is review-branch evidence only; production uploads remain disabled.

## Verified evidence (13 October 2026)

| Control | Evidence | Finding |
|---|---|---|
| PDF/DOCX structural regression suite | [Document Security CI #38438335318](https://github.com/MDVentures1111/tripp/actions/runs/38438335318), commit `16ce0daa` | PASS |
| Real ClamAV full HTTP application integration | [Real ClamAV CI #38438356079](https://github.com/MDVentures1111/tripp/actions/runs/38438356079), commit `2493b6fa` | PASS |
| Real ClamAV malware identification | Full integration CI sends ZIP-embedded canonical EICAR to the scanner gateway and requires a `malicious` verdict | PASS (test signature only) |
| Application malicious DOCX quarantine-to-finalize path | Full integration CI requires finalization HTTP 422, non-`ready` database state, and download HTTP 404 | PASS |
| Clean-file application lifecycle | Full integration CI exercises clean upload, finalization and download against real scanner | PASS |
| Malformed PDF | Full integration CI requires rejection and download denial | PASS |
| Gateway fault boundaries | Real ClamAV staging tests cover oversized, empty, concurrency, post-burst recovery, unauthorized, digest mismatch and scanner outage | Prior staging PASS |

The malicious DOCX fixture is a **synthetic structurally consistent ZIP**, not a representative production DOCX or comprehensive adversarial corpus. ClamAV's EICAR detection is not evidence that all malicious files will be detected. Tests are isolated CI, not production-equivalent staging.

## Defense-in-depth currently implemented

- PDF: size/header/terminal EOF checks; known active feature names, including hexadecimal-escaped names, are denied; `/ObjStm` and `/Encrypt` are denied. These are **byte-pattern checks**, not a full parser.
- DOCX: ZIP central/local-header bounds, filename consistency, traversal/duplicate/overlap, ZIP64/encryption, selected ambiguous ZIP flags, expansion limits and compression ratio limits.
- Application: quarantine upload, digest binding, scanner clean verdict before READY, download gated on scan evidence and verified digest.

## Remaining certification blockers

1. **Sandboxed parser/sanitizer**: real PDF object/xref/stream/incremental-update inspection; DOCX decompression, XML and OPC relationships, external references, macros/OLE, malformed deflate and entity expansion. Bounded runtime, CPU, memory and expanded-byte limits; fail closed.
2. **Representative corpus**: benign real-world PDFs/DOCX, licensed adversarial samples, compressed-stream and ZIP/OOXML attacks; record false positives and parser differentials.
3. **Scanner operations**: signature freshness, versioned scan attestation, restart/load behavior, resource ceilings, per-tenant fairness, slow clients, independent private/TLS ingress.
4. **Lifecycle resilience**: scanner outage → reconciliation → clean rescan and final download denial; fault injection across Storage/DB partial failures and expired leases.
5. **Release governance**: independent security review, alerting/runbooks, production migration-history reconciliation, staging rollback and production gate sign-off.

## Certification decision

**NO-GO** for production document uploads. Continue with sandboxed document parser architecture and an isolated verification harness before any production promotion. No changes to the production branch or Supabase are authorized by this record.
