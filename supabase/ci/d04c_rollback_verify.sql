-- D04-C.4C: assert the database is at the v1 document baseline after rollback, with evidence kept.
\set ON_ERROR_STOP on
DO $$
BEGIN
 IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='deal_documents_upload_status_valid' AND conrelid='public.deal_documents'::regclass)) ~ 'processing'
 THEN RAISE EXCEPTION 'RB: status constraint not restored to v1'; END IF;
 IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'tripp\_%')
 THEN RAISE EXCEPTION 'RB: lifecycle functions remain'; END IF;
 IF to_regclass('public.document_upload_admissions') IS NOT NULL THEN RAISE EXCEPTION 'RB: admission ledger remains'; END IF;
 IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_deal_documents_guard_insert') THEN RAISE EXCEPTION 'RB: insert guard remains'; END IF;
 IF EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('tripp-document-expiry','tripp-document-reconciler')) THEN RAISE EXCEPTION 'RB: cron jobs remain'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='tripp_deal_documents_browser_deny')
 THEN RAISE EXCEPTION 'RB: storage deny policy lost'; END IF;
 IF (SELECT upload_status||'/'||verified_sha256||'/'||malware_scan_sha256 FROM public.deal_documents WHERE id='84000000-0000-4000-8000-000000000001')
    <> 'ready/'||repeat('f',64)||'/'||repeat('f',64) THEN RAISE EXCEPTION 'RB: READY evidence not preserved'; END IF;
END $$;
\echo 'Rollback verified: v1 baseline, evidence preserved'
