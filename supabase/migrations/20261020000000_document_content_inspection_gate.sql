BEGIN;
ALTER TABLE public.deal_documents ADD COLUMN IF NOT EXISTS content_inspection_sha256 text;
ALTER TABLE public.deal_documents ADD COLUMN IF NOT EXISTS content_inspection_engine text;
ALTER TABLE public.deal_documents ADD COLUMN IF NOT EXISTS content_inspection_policy text;
ALTER TABLE public.deal_documents ADD COLUMN IF NOT EXISTS content_inspected_at timestamptz;
CREATE OR REPLACE FUNCTION public.tripp_bind_document_content_inspection(
 p_id uuid,p_token uuid,p_digest text,p_engine text,p_policy text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$'
 OR p_engine IS NULL OR length(p_engine) NOT BETWEEN 1 AND 100
 OR p_policy IS NULL OR length(p_policy) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
 UPDATE public.deal_documents
 SET content_inspection_sha256=p_digest,content_inspection_engine=p_engine,
 content_inspection_policy=p_policy,content_inspected_at=now()
 WHERE id=p_id AND upload_status='processing' AND finalize_token=p_token
 AND finalize_lease_until>now()+interval '30 seconds' AND verified_sha256=p_digest;
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;
REVOKE ALL ON FUNCTION public.tripp_bind_document_content_inspection(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tripp_bind_document_content_inspection(uuid,uuid,text,text,text) TO service_role;
-- Inspection attestation is staged, but READY enforcement is deferred until
-- the real inspector and its full lifecycle integration are independently verified.
-- The preceding malware-scan migration retains its READY gate.
COMMIT;
