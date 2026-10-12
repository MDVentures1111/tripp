-- D04-B4-A.3 REVIEW ONLY. Bounded admission ledger retention.
-- A four-hour retention period exceeds the one-hour user quota and
-- three-hour organization reservation window. Run only with service_role.
BEGIN;
CREATE OR REPLACE FUNCTION public.tripp_prune_document_admissions(p_limit integer DEFAULT 1000)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE deleted_count integer;
BEGIN
 IF p_limit < 1 OR p_limit > 1000 THEN
   RAISE EXCEPTION 'Invalid prune batch size';
 END IF;
 WITH old_rows AS (
   SELECT id FROM public.document_upload_admissions
   WHERE created_at < now() - interval '4 hours'
   ORDER BY created_at
   LIMIT p_limit
   FOR UPDATE SKIP LOCKED
 )
 DELETE FROM public.document_upload_admissions a
 USING old_rows WHERE a.id = old_rows.id;
 GET DIAGNOSTICS deleted_count = ROW_COUNT;
 RETURN deleted_count;
END $fn$;
REVOKE ALL ON FUNCTION public.tripp_prune_document_admissions(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tripp_prune_document_admissions(integer) TO service_role;
COMMIT;
