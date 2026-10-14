-- B4-B.7 REVIEW ONLY. Mandatory digest-bound inspection for every READY transition.
-- This migration intentionally has no production rollout authorization.
BEGIN;
ALTER TABLE public.deal_documents
 ADD CONSTRAINT tripp_content_inspection_digest_format
 CHECK (content_inspection_sha256 IS NULL OR content_inspection_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE public.deal_documents
 ADD CONSTRAINT tripp_ready_inspection_attestation
 CHECK (upload_status <> 'ready' OR (
   verified_sha256 IS NOT NULL
   AND malware_scan_sha256 = verified_sha256
   AND malware_scanned_at IS NOT NULL
   AND content_inspection_sha256 = verified_sha256
   AND content_inspection_engine IS NOT NULL
   AND length(btrim(content_inspection_engine)) BETWEEN 1 AND 100
   AND content_inspection_policy IS NOT NULL
   AND length(btrim(content_inspection_policy)) BETWEEN 1 AND 100
   AND content_inspected_at IS NOT NULL
 )) NOT VALID;
-- NOT VALID permits review databases containing legacy READY rows to migrate,
-- but PostgreSQL still enforces this constraint on new/updated rows.
CREATE OR REPLACE FUNCTION public.tripp_finish_document_finalize(p_id uuid,p_token uuid,p_success boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 UPDATE public.deal_documents SET upload_status=CASE WHEN p_success THEN 'ready' ELSE 'failed' END,
 finalize_token=NULL,finalize_lease_until=NULL
 WHERE id=p_id AND upload_status='processing' AND finalize_token=p_token
 AND finalize_lease_until>now()
 AND (NOT p_success OR (
   verified_sha256 IS NOT NULL
   AND malware_scan_sha256=verified_sha256 AND malware_scanned_at IS NOT NULL
   AND content_inspection_sha256=verified_sha256 AND content_inspected_at IS NOT NULL
   AND length(btrim(coalesce(content_inspection_engine,''))) BETWEEN 1 AND 100
   AND length(btrim(coalesce(content_inspection_policy,''))) BETWEEN 1 AND 100
 ));
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;
REVOKE ALL ON FUNCTION public.tripp_finish_document_finalize(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tripp_finish_document_finalize(uuid,uuid,boolean) TO service_role;
COMMIT;
