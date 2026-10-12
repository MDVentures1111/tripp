-- D04-B2.6 REVIEW ONLY; requires D04-B2.5 migration. Do not run in production without verification.
BEGIN;
CREATE OR REPLACE FUNCTION public.tripp_document_finalize_lease_valid(p_id uuid,p_token uuid)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.deal_documents
 WHERE id=p_id AND upload_status='processing' AND finalize_token=p_token
 AND finalize_lease_until>now()+interval '30 seconds');
$$;
CREATE OR REPLACE FUNCTION public.tripp_claim_stale_document(p_id uuid,p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 UPDATE public.deal_documents SET finalize_token=p_token,finalize_lease_until=now()+interval '10 minutes'
 WHERE id=p_id AND upload_status='processing' AND finalize_lease_until<now()-interval '2 minutes';
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;
CREATE OR REPLACE FUNCTION public.tripp_fail_abandoned_pending(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 UPDATE public.deal_documents SET upload_status='failed'
 WHERE id=p_id AND upload_status='pending' AND created_at<now()-interval '3 hours';
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;
REVOKE ALL ON FUNCTION public.tripp_document_finalize_lease_valid(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.tripp_claim_stale_document(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.tripp_fail_abandoned_pending(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tripp_document_finalize_lease_valid(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tripp_claim_stale_document(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tripp_fail_abandoned_pending(uuid) TO service_role;
COMMIT;
