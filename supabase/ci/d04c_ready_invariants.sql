-- D04-C.4C regression tests: READY invariants, tenant isolation, malware gate, privileges, Storage.
-- Isolated CI / staging rehearsal only. NEVER execute on production. Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
CREATE POLICY ci_inv_membership_read ON public.organization_memberships FOR SELECT TO authenticated
 USING (user_id = (SELECT auth.uid()));
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at) VALUES
 ('71000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','inv-a-admin@example.test',now(),now()),
 ('71000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','inv-a-viewer@example.test',now(),now()),
 ('71000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','inv-b-admin@example.test',now(),now());
INSERT INTO public.organizations(id,name,slug) VALUES
 ('72000000-0000-4000-8000-000000000001','INV A','inv-a'),('72000000-0000-4000-8000-000000000002','INV B','inv-b');
INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES
 ('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','admin'),
 ('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','viewer'),
 ('72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003','admin');
INSERT INTO public.deals(id,organization_id,deal_name,created_by) VALUES
 ('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','INV A Deal','71000000-0000-4000-8000-000000000001'),
 ('73000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000002','INV B Deal','71000000-0000-4000-8000-000000000003');

SET LOCAL ROLE service_role;
-- I1: inserts must start pending with no evidence.
DO $i1$
BEGIN
 BEGIN
  INSERT INTO public.deal_documents(organization_id,deal_id,document_type,original_filename,storage_path,mime_type,file_size_bytes,uploaded_by,upload_status)
  VALUES ('72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','other','f.pdf','inv/f1.pdf','application/pdf',10,'71000000-0000-4000-8000-000000000001','ready');
  RAISE EXCEPTION 'I1a: READY row inserted directly';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.deal_documents(organization_id,deal_id,document_type,original_filename,storage_path,mime_type,file_size_bytes,uploaded_by,upload_status,finalize_token,finalize_lease_until)
  VALUES ('72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','other','f.pdf','inv/f2.pdf','application/pdf',10,'71000000-0000-4000-8000-000000000001','processing',gen_random_uuid(),now()+interval '5 minutes');
  RAISE EXCEPTION 'I1b: processing row inserted directly';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.deal_documents(organization_id,deal_id,document_type,original_filename,storage_path,mime_type,file_size_bytes,uploaded_by,verified_sha256,malware_scan_sha256,malware_scan_engine,malware_scanned_at)
  VALUES ('72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','other','f.pdf','inv/f3.pdf','application/pdf',10,'71000000-0000-4000-8000-000000000001',repeat('a',64),repeat('a',64),'forged',now());
  RAISE EXCEPTION 'I1c: pending row inserted with pre-filled scan evidence';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $i1$;

INSERT INTO public.deal_documents(id,organization_id,deal_id,document_type,original_filename,storage_path,mime_type,file_size_bytes,uploaded_by) VALUES
 ('74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','other','direct.pdf','inv/d1.pdf','application/pdf',10,'71000000-0000-4000-8000-000000000001'),
 ('74000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','other','rpc.pdf','inv/d2.pdf','application/pdf',10,'71000000-0000-4000-8000-000000000001'),
 ('74000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000002','other','b.pdf','inv/d3.pdf','application/pdf',10,'71000000-0000-4000-8000-000000000003');

-- I2: no write path reaches READY without a clean scan bound to the verified digest.
DO $i2$
DECLARE d uuid := '74000000-0000-4000-8000-000000000001';
BEGIN
 BEGIN UPDATE public.deal_documents SET upload_status='ready' WHERE id=d;
  RAISE EXCEPTION 'I2a: pending -> ready accepted'; EXCEPTION WHEN raise_exception OR check_violation THEN NULL; END;
 UPDATE public.deal_documents SET upload_status='processing',finalize_token=gen_random_uuid(),finalize_lease_until=now()+interval '5 minutes' WHERE id=d;
 BEGIN UPDATE public.deal_documents SET upload_status='ready' WHERE id=d;
  RAISE EXCEPTION 'I2b: unscanned processing -> ready accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE public.deal_documents SET verified_sha256=repeat('a',64) WHERE id=d;
 BEGIN UPDATE public.deal_documents SET upload_status='ready',malware_scan_sha256=repeat('b',64),malware_scan_engine='x',malware_scanned_at=now() WHERE id=d;
  RAISE EXCEPTION 'I2c: READY with scan of a different digest'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.deal_documents SET upload_status='ready',malware_scan_sha256=repeat('a',64),malware_scan_engine='x' WHERE id=d;
  RAISE EXCEPTION 'I2d: READY without scan timestamp'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.deal_documents SET verified_sha256=repeat('c',64) WHERE id=d;
  RAISE EXCEPTION 'I2e: verified digest rewritten'; EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE public.deal_documents SET malware_scan_sha256=repeat('a',64),malware_scan_engine='x',malware_scanned_at=now() WHERE id=d;
 BEGIN UPDATE public.deal_documents SET malware_scan_sha256=repeat('d',64) WHERE id=d;
  RAISE EXCEPTION 'I2f: scan evidence rewritten'; EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE public.deal_documents SET upload_status='failed',failure_reason='scan_inconclusive',finalize_token=NULL,finalize_lease_until=NULL WHERE id=d;
 -- I3: terminal rows are immutable.
 BEGIN UPDATE public.deal_documents SET failure_reason='malware_detected' WHERE id=d;
  RAISE EXCEPTION 'I3a: failed row reason rewritten'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.deal_documents SET upload_status='ready' WHERE id=d;
  RAISE EXCEPTION 'I3b: failed -> ready accepted'; EXCEPTION WHEN raise_exception OR check_violation THEN NULL; END;
END $i2$;

-- I4: the RPC path still completes, and the READY row is then frozen.
DO $i4$
DECLARE d uuid := '74000000-0000-4000-8000-000000000002'; t uuid := gen_random_uuid();
BEGIN
 IF NOT public.tripp_admit_document_upload(gen_random_uuid(),'72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001')
 THEN RAISE EXCEPTION 'I4: admission rejected'; END IF;
 IF NOT public.tripp_claim_document_finalize(d,'72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',t)
 THEN RAISE EXCEPTION 'I4: claim failed'; END IF;
 IF NOT public.tripp_bind_document_digest(d,t,repeat('e',64)) THEN RAISE EXCEPTION 'I4: digest bind failed'; END IF;
 IF public.tripp_finish_document_finalize(d,t,true) THEN RAISE EXCEPTION 'I4: READY before scan'; END IF;
 IF NOT public.tripp_bind_document_clean_scan(d,t,repeat('e',64),'clamav-ci') THEN RAISE EXCEPTION 'I4: scan bind failed'; END IF;
 IF NOT public.tripp_finish_document_finalize(d,t,true) THEN RAISE EXCEPTION 'I4: finalize failed'; END IF;
 BEGIN UPDATE public.deal_documents SET malware_scan_engine='tampered' WHERE id=d;
  RAISE EXCEPTION 'I4: READY evidence edited'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.deal_documents SET upload_status='failed',failure_reason='malware_detected' WHERE id=d;
  RAISE EXCEPTION 'I4: READY -> failed accepted'; EXCEPTION WHEN raise_exception OR check_violation THEN NULL; END;
END $i4$;
RESET ROLE;

-- T1: tenant isolation for metadata (admin and viewer of A, admin of B).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
DO $t1$
BEGIN
 IF (SELECT count(*) FROM public.deal_documents)<>2 THEN RAISE EXCEPTION 'T1a: viewer of A does not see exactly A documents'; END IF;
 IF EXISTS (SELECT 1 FROM public.deal_documents WHERE organization_id='72000000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'T1b: org B document visible to A'; END IF;
 BEGIN UPDATE public.deal_documents SET original_filename='x' WHERE id='74000000-0000-4000-8000-000000000002';
  RAISE EXCEPTION 'T1c: viewer updated metadata'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.tripp_finish_document_finalize('74000000-0000-4000-8000-000000000002',gen_random_uuid(),true);
  RAISE EXCEPTION 'T1d: browser role executed lifecycle RPC'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $t1$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
DO $t2$
BEGIN
 IF (SELECT count(*) FROM public.deal_documents)<>1 THEN RAISE EXCEPTION 'T2: admin of B does not see exactly B documents'; END IF;
 IF (SELECT count(*) FROM public.deals)<>1 THEN RAISE EXCEPTION 'T2: cross-org deal visible'; END IF;
END $t2$;
RESET ROLE;

-- P1: no browser privilege on any tripp_* function or the admission ledger; service_role explicit.
DO $p1$
DECLARE r record;
BEGIN
 FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname LIKE 'tripp\_%' LOOP
  IF has_function_privilege('anon',r.f,'EXECUTE') OR has_function_privilege('authenticated',r.f,'EXECUTE')
  THEN RAISE EXCEPTION 'P1: browser role can execute %', r.f; END IF;
 END LOOP;
 IF has_table_privilege('anon','public.document_upload_admissions','SELECT')
    OR has_table_privilege('authenticated','public.document_upload_admissions','SELECT')
    OR has_table_privilege('authenticated','public.document_upload_admissions','INSERT')
 THEN RAISE EXCEPTION 'P1: browser role can access the admission ledger'; END IF;
 IF NOT (has_table_privilege('service_role','public.document_upload_admissions','SELECT')
     AND has_table_privilege('service_role','public.document_upload_admissions','INSERT')
     AND has_table_privilege('service_role','public.document_upload_admissions','DELETE'))
 THEN RAISE EXCEPTION 'P1: service_role lacks explicit admission-ledger privileges'; END IF;
END $p1$;

-- S1: browser roles cannot read or write objects in the private bucket, even as members and
-- even when another permissive policy would allow everything (the restrictive deny wins).
INSERT INTO storage.buckets(id,name,public) VALUES ('ci-inv-public-control','ci-inv-public-control',false);
CREATE POLICY ci_inv_permissive_all ON storage.objects FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
SET LOCAL ROLE service_role;
INSERT INTO storage.objects(bucket_id,name,owner) VALUES
 ('tripp-deal-documents','72000000-0000-4000-8000-000000000001/73000000-0000-4000-8000-000000000001/ci/source.pdf','71000000-0000-4000-8000-000000000001'),
 ('ci-inv-public-control','control.txt',NULL);
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
DO $s1$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='ci-inv-public-control') THEN RAISE EXCEPTION 'S1: control object not visible; permissive fixture ineffective'; END IF;
 IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='tripp-deal-documents') THEN RAISE EXCEPTION 'S1a: member can read private bucket objects'; END IF;
 BEGIN
  INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('tripp-deal-documents','72000000-0000-4000-8000-000000000001/x/evil.pdf','71000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'S1b: member wrote into private bucket';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $s1$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $s2$
BEGIN
 IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='tripp-deal-documents') THEN RAISE EXCEPTION 'S2: anon can read private bucket objects'; END IF;
END $s2$;
RESET ROLE;
ROLLBACK;
\echo 'D04-C.4C invariant assertions passed'
