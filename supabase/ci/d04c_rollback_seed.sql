-- D04-C.4C rollback drill seed (committed): one scanned READY document whose evidence must
-- survive rollback and re-apply unchanged. Rehearsal databases only.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at) VALUES
 ('81000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rb@example.test',now(),now());
INSERT INTO public.organizations(id,name,slug) VALUES ('82000000-0000-4000-8000-000000000001','RB','rb');
INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES
 ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','admin');
INSERT INTO public.deals(id,organization_id,deal_name,created_by) VALUES
 ('83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','RB Deal','81000000-0000-4000-8000-000000000001');
INSERT INTO public.deal_documents(id,organization_id,deal_id,document_type,original_filename,storage_path,mime_type,file_size_bytes,uploaded_by) VALUES
 ('84000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','other','rb.pdf','rb/source.pdf','application/pdf',10,'81000000-0000-4000-8000-000000000001');
SET LOCAL ROLE service_role;
DO $$
DECLARE d uuid := '84000000-0000-4000-8000-000000000001'; t uuid := gen_random_uuid();
BEGIN
 IF NOT (public.tripp_claim_document_finalize(d,'82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',t)
   AND public.tripp_bind_document_digest(d,t,repeat('f',64))
   AND public.tripp_bind_document_clean_scan(d,t,repeat('f',64),'clamav-rb')
   AND public.tripp_finish_document_finalize(d,t,true)) THEN RAISE EXCEPTION 'Rollback seed did not reach READY'; END IF;
END $$;
RESET ROLE;
COMMIT;
