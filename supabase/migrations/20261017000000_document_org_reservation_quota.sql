-- D04-B4-A.3 REVIEW ONLY: count in-flight admissions before metadata insertion.
-- Serialized per organization by the admission RPC's advisory lock.
BEGIN;
CREATE OR REPLACE FUNCTION public.tripp_admit_document_upload(p_id uuid,p_org uuid,p_user uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE user_count integer; org_count integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,1101));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text,1102));
 SELECT count(*) INTO user_count FROM public.document_upload_admissions
 WHERE user_id=p_user AND created_at>now()-interval '1 hour';
 -- Include active metadata plus admissions awaiting insertion. An admission
 -- without metadata reserves capacity for three hours, then expires.
 SELECT count(*) INTO org_count FROM (
   SELECT d.id FROM public.deal_documents d
   WHERE d.organization_id=p_org AND d.upload_status IN ('pending','processing')
   UNION
   SELECT a.id FROM public.document_upload_admissions a
   LEFT JOIN public.deal_documents d ON d.id=a.id
   WHERE a.organization_id=p_org
     AND a.created_at>now()-interval '3 hours'
     AND (d.id IS NULL OR d.upload_status IN ('pending','processing'))
 ) reserved;
 IF user_count>=20 OR org_count>=100 THEN RETURN false; END IF;
 INSERT INTO public.document_upload_admissions(id,organization_id,user_id)
 VALUES(p_id,p_org,p_user);
 RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.tripp_admit_document_upload(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tripp_admit_document_upload(uuid,uuid,uuid) TO service_role;
COMMIT;
