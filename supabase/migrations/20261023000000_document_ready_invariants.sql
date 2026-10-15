-- D04-C.4C: database-enforced document lifecycle invariants (defense in depth behind the RPCs).
--  * New rows start 'pending' with no lease, digest, scan, inspection or failure evidence.
--  * READY requires a clean malware scan bound to the verified digest, whatever path writes it.
--  * Digest and scan evidence are write-once; terminal rows (ready/failed) are immutable.
--  * service_role access to the admission ledger is explicit, not inherited from default privileges.
BEGIN;

CREATE OR REPLACE FUNCTION public.trigg_deal_documents_guard_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.upload_status IS DISTINCT FROM 'pending'
     OR NEW.finalize_token IS NOT NULL OR NEW.finalize_lease_until IS NOT NULL
     OR NEW.verified_sha256 IS NOT NULL
     OR NEW.malware_scan_sha256 IS NOT NULL OR NEW.malware_scan_engine IS NOT NULL
     OR NEW.malware_scanned_at IS NOT NULL
     OR NEW.content_inspection_sha256 IS NOT NULL OR NEW.content_inspection_engine IS NOT NULL
     OR NEW.content_inspection_policy IS NOT NULL OR NEW.content_inspected_at IS NOT NULL
     OR NEW.failure_reason IS NOT NULL THEN
    RAISE EXCEPTION 'New documents must start pending without lifecycle evidence'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trigg_deal_documents_guard_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.organization_id IS DISTINCT FROM NEW.organization_id
     OR OLD.deal_id IS DISTINCT FROM NEW.deal_id OR OLD.uploaded_by IS DISTINCT FROM NEW.uploaded_by
     OR OLD.created_at IS DISTINCT FROM NEW.created_at OR OLD.storage_path IS DISTINCT FROM NEW.storage_path
     OR OLD.original_filename IS DISTINCT FROM NEW.original_filename OR OLD.mime_type IS DISTINCT FROM NEW.mime_type
     OR OLD.file_size_bytes IS DISTINCT FROM NEW.file_size_bytes OR OLD.document_type IS DISTINCT FROM NEW.document_type
  THEN
    RAISE EXCEPTION 'Document identity and upload metadata are immutable';
  END IF;

  IF OLD.upload_status IN ('ready', 'failed')
     AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'Terminal documents are immutable' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.upload_status IS DISTINCT FROM NEW.upload_status AND NOT (
       (OLD.upload_status = 'pending' AND NEW.upload_status IN ('processing', 'failed')) OR
       (OLD.upload_status = 'processing' AND NEW.upload_status IN ('ready', 'failed'))) THEN
    RAISE EXCEPTION 'Invalid document upload status transition';
  END IF;

  IF NEW.upload_status = 'processing' AND (NEW.finalize_token IS NULL OR NEW.finalize_lease_until IS NULL) THEN
    RAISE EXCEPTION 'Finalization lease required';
  END IF;

  IF (OLD.verified_sha256 IS NOT NULL AND NEW.verified_sha256 IS DISTINCT FROM OLD.verified_sha256)
     OR (OLD.malware_scan_sha256 IS NOT NULL AND NEW.malware_scan_sha256 IS DISTINCT FROM OLD.malware_scan_sha256) THEN
    RAISE EXCEPTION 'Document digest and scan evidence are write-once' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.upload_status = 'ready' AND (
       NEW.verified_sha256 IS NULL
       OR NEW.malware_scan_sha256 IS DISTINCT FROM NEW.verified_sha256
       OR NEW.malware_scan_engine IS NULL
       OR NEW.malware_scanned_at IS NULL) THEN
    RAISE EXCEPTION 'READY requires a clean malware scan bound to the verified digest'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_deal_documents_guard_insert ON public.deal_documents;
CREATE TRIGGER trg_deal_documents_guard_insert
BEFORE INSERT ON public.deal_documents
FOR EACH ROW EXECUTE FUNCTION public.trigg_deal_documents_guard_insert();

REVOKE ALL ON FUNCTION public.trigg_deal_documents_guard_insert() FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, DELETE ON TABLE public.document_upload_admissions TO service_role;

COMMIT;
