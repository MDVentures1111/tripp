-- D04-B3.6 REVIEW ONLY. Apply after B2.5 and B2.6; do not run in production.
BEGIN;
ALTER TABLE public.deal_documents ADD COLUMN IF NOT EXISTS verified_sha256 text;
ALTER TABLE public.deal_documents ADD CONSTRAINT deal_documents_verified_sha256_format
 CHECK (verified_sha256 IS NULL OR verified_sha256 ~ '^[0-9a-f]{64}$');
CREATE OR REPLACE FUNCTION public.tripp_bind_document_digest(p_id uuid,p_token uuid,p_digest text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
 UPDATE public.deal_documents SET verified_sha256=p_digest
 WHERE id=p_id AND upload_status='processing' AND finalize_token=p_token
 AND finalize_lease_until>now()+interval '30 seconds'
 AND (verified_sha256 IS NULL OR verified_sha256=p_digest);
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;
REVOKE ALL ON FUNCTION public.tripp_bind_document_digest(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tripp_bind_document_digest(uuid,uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.tripp_finish_document_finalize(p_id uuid,p_token uuid,p_success boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 UPDATE public.deal_documents SET upload_status=CASE WHEN p_success THEN 'ready' ELSE 'failed' END,
 finalize_token=NULL,finalize_lease_until=NULL
 WHERE id=p_id AND upload_status='processing' AND finalize_token=p_token
 AND finalize_lease_until>now()
 AND (NOT p_success OR verified_sha256 IS NOT NULL);
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;
REVOKE ALL ON FUNCTION public.tripp_finish_document_finalize(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tripp_finish_document_finalize(uuid,uuid,boolean) TO service_role;
COMMIT;
