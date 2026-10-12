-- Isolated CI database integration tests. NEVER execute on production.
-- The caller must use the ephemeral local Supabase PostgreSQL connection.
\set ON_ERROR_STOP on
BEGIN;
CREATE POLICY ci_membership_read ON public.organization_memberships FOR SELECT TO authenticated
 USING (user_id = (SELECT auth.uid()));
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at) VALUES
 ('10000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ci-a@example.test',now(),now()),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ci-b@example.test',now(),now());
INSERT INTO public.organizations(id,name) VALUES
 ('20000000-0000-4000-8000-000000000001','CI A'),
 ('20000000-0000-4000-8000-000000000002','CI B');
INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','admin'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','viewer');
INSERT INTO public.deals(id,organization_id,deal_name,created_by) VALUES
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','CI A Deal','10000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','CI B Deal','10000000-0000-4000-8000-000000000002');
INSERT INTO public.deal_documents(id,organization_id,deal_id,document_type,original_filename,storage_path,mime_type,file_size_bytes,uploaded_by) VALUES
 ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','other','ci.pdf','ci/a/source.pdf','application/pdf',128,'10000000-0000-4000-8000-000000000001');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.deal_documents)<>1 THEN RAISE EXCEPTION 'Owner cannot read document'; END IF;
 IF (SELECT count(*) FROM public.deals)<>1 THEN RAISE EXCEPTION 'Cross-org deal visible'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.deal_documents)<>0 THEN RAISE EXCEPTION 'Cross-org document visible'; END IF;
 IF (SELECT count(*) FROM public.deals)<>1 THEN RAISE EXCEPTION 'Cross-org deal visible to viewer'; END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
DECLARE token uuid:='50000000-0000-4000-8000-000000000001';
BEGIN
 IF NOT public.tripp_claim_document_finalize('40000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001',token) THEN RAISE EXCEPTION 'Claim failed'; END IF;
 IF public.tripp_claim_document_finalize('40000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002')
 THEN RAISE EXCEPTION 'Duplicate claim accepted'; END IF;
 IF public.tripp_finish_document_finalize('40000000-0000-4000-8000-000000000001',
 '50000000-0000-4000-8000-000000000002',true) THEN RAISE EXCEPTION 'Wrong token accepted'; END IF;
 IF NOT public.tripp_document_finalize_lease_valid('40000000-0000-4000-8000-000000000001',token)
 THEN RAISE EXCEPTION 'Lease invalid'; END IF;
 IF NOT public.tripp_finish_document_finalize('40000000-0000-4000-8000-000000000001',token,true)
 THEN RAISE EXCEPTION 'Finalize failed'; END IF;
 IF public.tripp_finish_document_finalize('40000000-0000-4000-8000-000000000001',token,false)
 THEN RAISE EXCEPTION 'Replay accepted'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'CI integration assertions passed'
