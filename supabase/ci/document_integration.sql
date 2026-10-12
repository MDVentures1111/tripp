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


-- Verify browser roles cannot write document metadata, even as an org member.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
DO $$
BEGIN
 BEGIN
  INSERT INTO public.deal_documents(organization_id,deal_id,document_type,original_filename,storage_path,mime_type,file_size_bytes,uploaded_by)
  VALUES ('20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',
  'other','blocked.pdf','ci/blocked.pdf','application/pdf',10,'10000000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'Viewer inserted metadata';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  UPDATE public.deal_documents SET upload_status='failed' WHERE id='40000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'Viewer updated metadata';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
-- A composite FK must reject a document whose organization differs from its deal.
DO $$
BEGIN
 BEGIN
  INSERT INTO public.deal_documents(organization_id,deal_id,document_type,original_filename,storage_path,mime_type,file_size_bytes,uploaded_by)
  VALUES ('20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001',
  'other','mismatch.pdf','ci/mismatch.pdf','application/pdf',10,'10000000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'Cross-organization document foreign key accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
END $$;

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

-- Recovery fixtures: abandoned pending and expired processing lease.
INSERT INTO public.deal_documents(id,organization_id,deal_id,document_type,original_filename,storage_path,mime_type,file_size_bytes,uploaded_by,created_at)
VALUES ('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',
'30000000-0000-4000-8000-000000000001','other','abandoned.pdf','ci/abandoned.pdf',
'application/pdf',64,'10000000-0000-4000-8000-000000000001',now()-interval '4 hours');
INSERT INTO public.deal_documents(id,organization_id,deal_id,document_type,original_filename,storage_path,mime_type,file_size_bytes,uploaded_by)
VALUES ('40000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001',
'30000000-0000-4000-8000-000000000001','other','stale.pdf','ci/stale.pdf',
'application/pdf',64,'10000000-0000-4000-8000-000000000001');
DO $$
DECLARE old_token uuid:='50000000-0000-4000-8000-000000000003';
new_token uuid:='50000000-0000-4000-8000-000000000004';
BEGIN
 IF NOT public.tripp_fail_abandoned_pending('40000000-0000-4000-8000-000000000002')
 THEN RAISE EXCEPTION 'Abandoned pending not failed'; END IF;
 IF public.tripp_fail_abandoned_pending('40000000-0000-4000-8000-000000000002')
 THEN RAISE EXCEPTION 'Abandoned pending replay succeeded'; END IF;
 IF NOT public.tripp_claim_document_finalize('40000000-0000-4000-8000-000000000003',
 '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001',old_token)
 THEN RAISE EXCEPTION 'Recovery setup claim failed'; END IF;
 UPDATE public.deal_documents SET finalize_lease_until=now()-interval '3 minutes'
 WHERE id='40000000-0000-4000-8000-000000000003';
 IF public.tripp_document_finalize_lease_valid('40000000-0000-4000-8000-000000000003',old_token)
 THEN RAISE EXCEPTION 'Expired lease still valid'; END IF;
 IF NOT public.tripp_claim_stale_document('40000000-0000-4000-8000-000000000003',new_token)
 THEN RAISE EXCEPTION 'Expired processing lease not reclaimed'; END IF;
 IF public.tripp_finish_document_finalize('40000000-0000-4000-8000-000000000003',old_token,true)
 THEN RAISE EXCEPTION 'Old worker finalized reclaimed document'; END IF;
 IF NOT public.tripp_finish_document_finalize('40000000-0000-4000-8000-000000000003',new_token,false)
 THEN RAISE EXCEPTION 'Reconciler failed to mark document failed'; END IF;
 IF (SELECT upload_status FROM public.deal_documents
 WHERE id='40000000-0000-4000-8000-000000000003')<>'failed'
 THEN RAISE EXCEPTION 'Recovery status incorrect'; END IF;
END $$;

RESET ROLE;
ROLLBACK;
\echo 'CI integration assertions passed'
