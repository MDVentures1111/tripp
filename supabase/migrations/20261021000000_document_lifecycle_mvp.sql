-- D04-C REVIEW / STAGING ONLY. Do not apply to production without explicit approval.
-- Adds a broker-visible failure reason and terminal-state RPCs so uploads never
-- remain in 'processing' indefinitely after a definite rejection or timeout.
BEGIN;

ALTER TABLE public.deal_documents ADD COLUMN IF NOT EXISTS failure_reason text;
ALTER TABLE public.deal_documents DROP CONSTRAINT IF EXISTS deal_documents_failure_reason_valid;
ALTER TABLE public.deal_documents ADD CONSTRAINT deal_documents_failure_reason_valid
 CHECK (failure_reason IS NULL OR failure_reason IN (
  'upload_missing','size_mismatch','file_too_large','invalid_pdf','invalid_docx',
  'pdf_active_content','pdf_encrypted','docx_macros','malware_detected','scan_inconclusive',
  'inspection_rejected','upload_abandoned','processing_timeout','integrity_mismatch'
 ));
ALTER TABLE public.deal_documents DROP CONSTRAINT IF EXISTS deal_documents_failure_reason_state;
ALTER TABLE public.deal_documents ADD CONSTRAINT deal_documents_failure_reason_state
 CHECK (failure_reason IS NULL OR upload_status = 'failed');

-- Definite rejection by the lease holder (finalize or reconciler).
CREATE OR REPLACE FUNCTION public.tripp_reject_document_finalize(p_id uuid, p_token uuid, p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 UPDATE public.deal_documents
 SET upload_status='failed', failure_reason=p_reason, finalize_token=NULL, finalize_lease_until=NULL
 WHERE id=p_id AND upload_status='processing' AND finalize_token=p_token
 AND finalize_lease_until>now();
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;

-- Abandoned pending uploads now record why they failed.
CREATE OR REPLACE FUNCTION public.tripp_fail_abandoned_pending(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 UPDATE public.deal_documents SET upload_status='failed', failure_reason='upload_abandoned'
 WHERE id=p_id AND upload_status='pending' AND created_at<now()-interval '3 hours';
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;

-- Bounded processing time: a document still processing 24h after creation with an
-- expired lease (e.g. prolonged scanner outage) is failed so the broker can re-upload.
CREATE OR REPLACE FUNCTION public.tripp_fail_stuck_processing(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 UPDATE public.deal_documents
 SET upload_status='failed', failure_reason='processing_timeout', finalize_token=NULL, finalize_lease_until=NULL
 WHERE id=p_id AND upload_status='processing' AND created_at<now()-interval '24 hours'
 AND finalize_lease_until<now();
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;

REVOKE ALL ON FUNCTION public.tripp_reject_document_finalize(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.tripp_fail_abandoned_pending(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.tripp_fail_stuck_processing(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tripp_reject_document_finalize(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tripp_fail_abandoned_pending(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tripp_fail_stuck_processing(uuid) TO service_role;
COMMIT;
