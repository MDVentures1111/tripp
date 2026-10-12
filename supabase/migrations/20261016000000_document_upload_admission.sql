-- D04-B4-A REVIEW ONLY. Atomic upload admission with per-user hourly and org active quotas.
BEGIN;
CREATE TABLE public.document_upload_admissions (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 user_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_upload_admissions_window_idx ON public.document_upload_admissions(user_id,created_at DESC);
REVOKE ALL ON public.document_upload_admissions FROM PUBLIC,anon,authenticated;
ALTER TABLE public.document_upload_admissions ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.tripp_admit_document_upload(p_id uuid,p_org uuid,p_user uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE user_count integer; org_count integer;
BEGIN
 -- Transaction-scoped advisory locks serialize admission across concurrent requests.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,1101));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text,1102));
 SELECT count(*) INTO user_count FROM public.document_upload_admissions
 WHERE user_id=p_user AND created_at>now()-interval '1 hour';
 SELECT count(*) INTO org_count FROM public.deal_documents
 WHERE organization_id=p_org AND upload_status IN ('pending','processing');
 IF user_count>=20 OR org_count>=100 THEN RETURN false; END IF;
 INSERT INTO public.document_upload_admissions(id,organization_id,user_id)
 VALUES(p_id,p_org,p_user);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.tripp_admit_document_upload(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tripp_admit_document_upload(uuid,uuid,uuid) TO service_role;
COMMIT;
