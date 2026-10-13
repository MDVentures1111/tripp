# B4-B.6 integration checkpoint

The migration 20261020000000_document_content_inspection_gate.sql has been committed on the review branch only.

**DO NOT DEPLOY.** The database READY transition now requires persisted content inspection evidence, but finalize and reconcile have not yet been updated to bind this evidence. As a result, uploads in a stack applying this migration cannot reach READY through the current code.

Required next actions:
1. Update finalize and reconcile to require the inspector and call tripp_bind_document_content_inspection with the matching lease token and digest before tripp_finish_document_finalize.
2. Update download to require the stored inspector digest, engine, policy and timestamp, matching verified_sha256. Remove the unconditional feature-flag download block only after this is verified.
3. Implement and isolate the real PDF/OOXML parsing service with bounded resource usage; never treat a mock verdict as production certification.
4. Extend isolated CI with a controlled inspector fixture and negative cases. Existing CI may fail because it does not yet provide inspection evidence.
5. Verify migrations, full HTTP lifecycle and both scanners before release. Production migration history must be reconciled independently.

**Status: BLOCKED / NO-GO.** Production remains unchanged.
