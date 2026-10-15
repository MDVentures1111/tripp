-- D04-C.4C rollback: returns a database from the D04-C lifecycle (20261012900000..20261023000000)
-- to the reviewed v1 baseline (deals v1, deal_documents v1, private bucket v1).
-- Preconditions (operator): TRIPP_ENABLE_DOCUMENT_UPLOADS=false on every function, and no
-- pending/processing documents (the script refuses otherwise). Evidence columns and their
-- values are kept, so a later re-apply sees the same documents with the same proof.
-- Afterwards, record the truth in the ledger:
--   supabase migration repair --db-url "$STAGING_DB_URL" --status reverted \
--     20261012900000 20261013000000 20261014000000 20261015000000 20261016000000 20261017000000 \
--     20261018000000 20261019000000 20261020000000 20261021000000 20261022000000 20261023000000
\set ON_ERROR_STOP on
BEGIN;

DO $guard$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.deal_documents WHERE upload_status IN ('pending', 'processing');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Rollback refused: % in-flight document(s); disable uploads and let them reach ready/failed first', v_n;
  END IF;
END
$guard$;

DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(jobname) FROM cron.job
    WHERE jobname IN ('tripp-document-expiry', 'tripp-document-reconciler');
  END IF;
END
$cron$;

DROP TRIGGER IF EXISTS trg_deal_documents_guard_insert ON public.deal_documents;
DROP FUNCTION IF EXISTS public.trigg_deal_documents_guard_insert();
DROP FUNCTION IF EXISTS public.tripp_invoke_document_reconciler();
DROP FUNCTION IF EXISTS public.tripp_expire_stale_documents(integer);
DROP FUNCTION IF EXISTS public.tripp_reject_document_finalize(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.tripp_fail_stuck_processing(uuid);
DROP FUNCTION IF EXISTS public.tripp_fail_abandoned_pending(uuid);
DROP FUNCTION IF EXISTS public.tripp_bind_document_content_inspection(uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.tripp_bind_document_clean_scan(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.tripp_prune_document_admissions(integer);
DROP FUNCTION IF EXISTS public.tripp_admit_document_upload(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.tripp_bind_document_digest(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.tripp_claim_stale_document(uuid, uuid);
DROP FUNCTION IF EXISTS public.tripp_document_finalize_lease_valid(uuid, uuid);
DROP FUNCTION IF EXISTS public.tripp_finish_document_finalize(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.tripp_claim_document_finalize(uuid, uuid, uuid, uuid, uuid);
DROP TABLE IF EXISTS public.document_upload_admissions;

ALTER TABLE public.deal_documents
  DROP CONSTRAINT IF EXISTS deal_documents_failure_reason_state,
  DROP CONSTRAINT IF EXISTS deal_documents_failure_reason_valid,
  DROP CONSTRAINT IF EXISTS tripp_scan_digest_format,
  DROP CONSTRAINT IF EXISTS deal_documents_verified_sha256_format,
  DROP CONSTRAINT deal_documents_upload_status_valid,
  ADD CONSTRAINT deal_documents_upload_status_valid
    CHECK (upload_status IN ('pending', 'ready', 'failed'));

-- v1 guard (20261011000000), verbatim.
CREATE OR REPLACE FUNCTION public.trigg_deal_documents_guard_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.organization_id IS DISTINCT FROM NEW.organization_id
     OR OLD.deal_id IS DISTINCT FROM NEW.deal_id
     OR OLD.uploaded_by IS DISTINCT FROM NEW.uploaded_by
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.storage_path IS DISTINCT FROM NEW.storage_path
     OR OLD.original_filename IS DISTINCT FROM NEW.original_filename
     OR OLD.mime_type IS DISTINCT FROM NEW.mime_type
     OR OLD.file_size_bytes IS DISTINCT FROM NEW.file_size_bytes
     OR OLD.document_type IS DISTINCT FROM NEW.document_type
  THEN
    RAISE EXCEPTION 'Document identity and upload metadata are immutable';
  END IF;

  IF OLD.upload_status = 'pending'
     AND NEW.upload_status IN ('ready', 'failed') THEN
    NULL;
  ELSIF OLD.upload_status IS DISTINCT FROM NEW.upload_status THEN
    RAISE EXCEPTION 'Invalid document upload status transition';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMIT;
\echo 'D04-C rollback applied: database is at the v1 document baseline'
