# B4-B.7 production-grade inspection — release blockers

Status: **NO-GO**. Review branch only. Do not apply mandatory READY enforcement in the active migration sequence until every caller and integration fixture binds genuine inspection evidence.

## Enforcement candidate
The accompanying `docs/sql/B4-B7-ready-enforcement-candidate.sql` requires a SHA-256-matching malware and content-inspection attestation before any new READY row can be written, including via the finalization RPC. The CHECK constraint is NOT VALID for legacy data; those rows require a separate audited remediation and eventual VALIDATE CONSTRAINT. It is **not** active in production or the review migration chain.

## Why the current inspector is not production-grade
The only safe verdict is for one byte-exact, blank, generated PDF. The inspector cannot clear ordinary PDFs, compressed PDF streams, incremental updates, or normal deflated DOCX archives. A filename, MIME, header, antivirus clean verdict, or superficial regex must never be treated as proof of safe content.

## Required before activation
1. Introduce maintained PDF and OOXML parsing libraries in an independently isolated process. Bound decompression, object counts, recursion, CPU, memory, time, XML entities, and relationship targets. Reject or quarantine encrypted files, embedded objects, scripts, macros, external relationships, ambiguous repairs, unsupported parser features, and polyglots.
2. Test representative clean business PDFs and DOCX files, hostile PDF/ZIP/XML fixtures, decompression bombs, parser crashes, timeouts, and malformed input. Only well-understood fully parsed documents may receive a safe verdict.
3. Make inspection mandatory across finalize, reconciliation, download, and all READY transitions. Use lease-fenced, digest-bound evidence with engine/policy provenance. Reject stale and mismatched evidence. Ensure service-role access cannot bypass the attestation policy.
4. Update all SQL and HTTP E2E fixtures to run the real inspector and bind inspection evidence; test success, unsafe, unavailable, mismatched digest, lease expiry, replay, and direct SQL READY bypass.
5. Validate and remediate legacy READY rows, validate constraints, isolate container egress at network layer, verify image provenance and signature updates, and run independent security review.

Do not deploy any review migration or set production inspection flags based on the current CI alone.
