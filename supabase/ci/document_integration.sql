-- Isolated CI database integration tests. NEVER execute on production.
-- The caller must use the ephemeral local Supabase PostgreSQL connection.
\set ON_ERROR_STOP on
BEGIN;
CREATE POLICY ci_membership_read ON public.organization_memberships FOR SELECT TO authenticated
 USING (user_id = (SELECT auth.uid()));
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at) VALUES
 ('10000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ci-a@example.test',now(),now()),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ci-b@example.test',now(),now());
INSERT INTO public.organizations(id,name,slug) VALUES
 ('20000000-0000-4000-8000-000000000001','CI A','ci-a'),
 ('20000000-0000-4000-8000-000000000002','CI B','ci-b');
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
 IF NOT public.tripp_bind_document_digest('40000000-0000-4000-8000-000000000001',token,repeat('a',64))
 THEN RAISE EXCEPTION 'Digest binding failed'; END IF;
 IF public.tripp_finish_document_finalize('40000000-0000-4000-8000-000000000001',token,true)
 THEN RAISE EXCEPTION 'Unscanned document became READY'; END IF;
 IF public.tripp_bind_document_clean_scan('40000000-0000-4000-8000-000000000001',token,repeat('b',64),'ci-fixture')
 THEN RAISE EXCEPTION 'Mismatched scan digest accepted'; END IF;
 IF NOT public.tripp_bind_document_clean_scan('40000000-0000-4000-8000-000000000001',token,repeat('a',64),'ci-fixture')
 THEN RAISE EXCEPTION 'Clean scan evidence rejected'; END IF;
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

-- B4-A.3: unauthorized callers cannot invoke the privileged cleanup RPC.
SET LOCAL ROLE authenticated;
DO $check$
BEGIN
 IF has_function_privilege('authenticated','public.tripp_prune_document_admissions(integer)','EXECUTE')
 THEN RAISE EXCEPTION 'Authenticated role unexpectedly granted admission pruning'; END IF;
 IF has_function_privilege('anon','public.tripp_prune_document_admissions(integer)','EXECUTE')
 THEN RAISE EXCEPTION 'Anonymous role unexpectedly granted admission pruning'; END IF;
 -- D04-C lifecycle RPCs are service-role only.
 IF has_function_privilege('authenticated','public.tripp_reject_document_finalize(uuid,uuid,text)','EXECUTE')
 OR has_function_privilege('anon','public.tripp_reject_document_finalize(uuid,uuid,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.tripp_fail_stuck_processing(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Browser role unexpectedly granted D04-C lifecycle RPC'; END IF;
END $check$;
RESET ROLE;
SET LOCAL ROLE service_role;
-- B4-A.3: pruning is bounded, and fresh admission records survive.
SELECT 1 / CASE WHEN public.tripp_prune_document_admissions(1000) = 0 THEN 1 ELSE 0 END AS prune_fresh_assertion;
-- A zero denominator fails CI if admission is unexpectedly rejected.
SELECT 1 / CASE WHEN public.tripp_admit_document_upload(gen_random_uuid(),
 '20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001')
 THEN 1 ELSE 0 END AS admission_assertion;
RESET ROLE;
-- D04-C: automatic reconciliation is scheduled in the database itself.
DO $sched$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='tripp-document-expiry' AND active AND schedule='*/5 * * * *')
 THEN RAISE EXCEPTION 'Expiry cron job not scheduled'; END IF;
 IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='tripp-document-reconciler' AND active AND schedule='*/5 * * * *')
 THEN RAISE EXCEPTION 'Reconciler cron job not scheduled'; END IF;
 IF public.tripp_invoke_document_reconciler() IS NOT NULL
 THEN RAISE EXCEPTION 'Reconciler invoked without Vault configuration'; END IF;
 IF has_function_privilege('authenticated','public.tripp_invoke_document_reconciler()','EXECUTE')
 OR has_function_privilege('authenticated','public.tripp_expire_stale_documents(integer)','EXECUTE')
 THEN RAISE EXCEPTION 'Browser role can run scheduler functions'; END IF;
END $sched$;
-- D04-C: timeouts are enforced without any HTTP call, and active leases are never overtaken.
-- Rows start pending (insert guard, 20261023); processing fixtures are reached through a leased transition.
INSERT INTO public.deal_documents(id,organization_id,deal_id,document_type,original_filename,storage_path,mime_type,file_size_bytes,uploaded_by,created_at) VALUES
 ('40000000-0000-4000-8000-0000000000c1','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','other','stuck.pdf','ci/c1/source.pdf','application/pdf',128,'10000000-0000-4000-8000-000000000001',now()-interval '25 hours'),
 ('40000000-0000-4000-8000-0000000000c2','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','other','active.pdf','ci/c2/source.pdf','application/pdf',128,'10000000-0000-4000-8000-000000000001',now()-interval '25 hours'),
 ('40000000-0000-4000-8000-0000000000c3','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','other','abandoned.pdf','ci/c3/source.pdf','application/pdf',128,'10000000-0000-4000-8000-000000000001',now()-interval '4 hours'),
 ('40000000-0000-4000-8000-0000000000c4','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','other','recent.pdf','ci/c4/source.pdf','application/pdf',128,'10000000-0000-4000-8000-000000000001',now()-interval '2 hours');
UPDATE public.deal_documents SET upload_status='processing',finalize_token=gen_random_uuid(),
 finalize_lease_until=CASE WHEN id='40000000-0000-4000-8000-0000000000c2' THEN now()+interval '5 minutes' ELSE now()-interval '1 hour' END
 WHERE id IN ('40000000-0000-4000-8000-0000000000c1','40000000-0000-4000-8000-0000000000c2','40000000-0000-4000-8000-0000000000c4');
DO $expiry$
BEGIN
 PERFORM public.tripp_expire_stale_documents(500);
 IF (SELECT upload_status||'/'||coalesce(failure_reason,'') FROM public.deal_documents WHERE id='40000000-0000-4000-8000-0000000000c1')<>'failed/processing_timeout'
 THEN RAISE EXCEPTION 'Stuck processing document not timed out'; END IF;
 IF (SELECT upload_status FROM public.deal_documents WHERE id='40000000-0000-4000-8000-0000000000c2')<>'processing'
 THEN RAISE EXCEPTION 'Active lease was overtaken by expiry'; END IF;
 IF (SELECT upload_status||'/'||coalesce(failure_reason,'') FROM public.deal_documents WHERE id='40000000-0000-4000-8000-0000000000c3')<>'failed/upload_abandoned'
 THEN RAISE EXCEPTION 'Abandoned pending not failed'; END IF;
 IF (SELECT upload_status FROM public.deal_documents WHERE id='40000000-0000-4000-8000-0000000000c4')<>'processing'
 THEN RAISE EXCEPTION 'Recent processing document failed early'; END IF;
END $expiry$;
-- D04-C: terminal rejection persists only for the current lease holder; failure_reason is constrained.
DO $reject$
DECLARE t uuid := gen_random_uuid(); v_id uuid := '40000000-0000-4000-8000-0000000000c5';
BEGIN
 INSERT INTO public.deal_documents(id,organization_id,deal_id,document_type,original_filename,storage_path,mime_type,file_size_bytes,uploaded_by)
 VALUES (v_id,'20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','other','r.pdf','ci/c5/source.pdf','application/pdf',128,'10000000-0000-4000-8000-000000000001');
 IF NOT public.tripp_claim_document_finalize(v_id,'20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',t)
 THEN RAISE EXCEPTION 'Reject fixture claim failed'; END IF;
 IF public.tripp_reject_document_finalize(v_id,gen_random_uuid(),'invalid_pdf') THEN RAISE EXCEPTION 'Wrong-token rejection persisted'; END IF;
 IF (SELECT upload_status FROM public.deal_documents WHERE id='40000000-0000-4000-8000-0000000000c5')<>'processing' THEN RAISE EXCEPTION 'Wrong-token rejection changed state'; END IF;
 BEGIN
  PERFORM public.tripp_reject_document_finalize(v_id,t,'not_a_reason');
  RAISE EXCEPTION 'Invalid failure reason accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF (SELECT upload_status FROM public.deal_documents WHERE id='40000000-0000-4000-8000-0000000000c5')<>'processing' THEN RAISE EXCEPTION 'Failed write left partial state'; END IF;
 UPDATE public.deal_documents SET finalize_lease_until=now()-interval '1 minute' WHERE deal_documents.id='40000000-0000-4000-8000-0000000000c5';
 IF public.tripp_reject_document_finalize(v_id,t,'invalid_pdf') THEN RAISE EXCEPTION 'Expired-lease rejection persisted'; END IF;
 UPDATE public.deal_documents SET finalize_lease_until=now()+interval '5 minutes' WHERE deal_documents.id='40000000-0000-4000-8000-0000000000c5';
 IF NOT public.tripp_reject_document_finalize(v_id,t,'invalid_pdf') THEN RAISE EXCEPTION 'Valid rejection not persisted'; END IF;
 IF (SELECT upload_status||'/'||failure_reason FROM public.deal_documents WHERE id='40000000-0000-4000-8000-0000000000c5')<>'failed/invalid_pdf' THEN RAISE EXCEPTION 'Rejection state incorrect'; END IF;
 IF public.tripp_reject_document_finalize(v_id,t,'invalid_pdf') THEN RAISE EXCEPTION 'Terminal rejection replayed'; END IF;
END $reject$;
ROLLBACK;
\echo 'CI integration assertions passed'
