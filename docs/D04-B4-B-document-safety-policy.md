# D04-B4-B — Untrusted document security boundary

Status: REVIEW ONLY / NO-GO. These controls do not certify a document as malware-free.

## Current policy
- PDF and DOCX are untrusted input, including files from authenticated brokers.
- Reject malformed/oversized uploads and recognizable active PDF markers. ZIP checks reject encryption, traversal, macros by conventional filenames, embedded objects by conventional paths, overlapping records, extreme expansion ratios and ZIP64. These checks are incomplete against obfuscation, compressed streams, XML relationship attacks and polyglot files.
- Do not parse, render, index, summarize, preview or distribute document bytes as trusted content based only on these checks.
- A READY status currently means structurally validated and SHA-256 bound, **not malware scanned**. Existing READY signed downloads are a release blocker for any claim of malware-screened documents.

## Required production boundary
1. Keep feature flags disabled until a malware scanning service is selected, integrated and verified. The service must scan quarantined bytes in an isolated execution environment with bounded CPU, memory, time, decompression and network egress.
2. Use an explicit scan verdict: clean / malicious / indeterminate / timeout / unavailable. Only a clean verdict bound to the exact SHA-256 digest may advance to READY. All other outcomes fail closed or remain quarantined for manual review; never publish a signed download URL.
3. Validate DOCX OPC package relationships and external targets, content types, macros, OLE and embedded resources after bounded decompression. PDF must be examined by a sandboxed parser or sanitizer that handles compressed and incremental objects.
4. Persist scanner identity/version, verdict, digest and scan time in an auditable record before promotion. Ensure reconciler recovery cannot bypass a clean verdict. Re-scan when scanner policy or signatures require it.
5. Build a licensed clean/malicious/ambiguous corpus; verify false positives, password-protected archives, decompression bombs, malformed ZIP, PDF active actions, external OOXML relationships and scanner outages.
6. Verify that staging has no bypass through direct Storage access, download signing, reconciliation or service-role functions; confirm operational alert receipt and rollback.

## Decision
No malware scanner has been integrated in this change. Active-PDF token rejection is defense in depth only and is bypassable with compressed or encoded content. Do not deploy or enable uploads on the strength of these tests.
