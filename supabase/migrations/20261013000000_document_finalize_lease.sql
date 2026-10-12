-- D04-B2.5 REVIEW ONLY. Apply manually only after inspecting live schema.
-- Adds an atomic, leased finalization claim. Never grant these RPCs to browser roles.
BEGIN;
ALTER TABLE public.deal_documents ADD COLUMN IF NOT EXISTS finalize_token uuid;
ALTER TABLE public.deal_documents ADD COLUMN IF NOT EXISTS finalize_lease_until timestamptz;
ALTER TABLE public.deal_documents DROP CONSTRAINT deal_documents_upload_status_valid;
ALTER TABLE public.deal_documents ADD CONSTRAINT deal_documents_upload_status_valid
 CHECK (upload_status IN ('pending','processing','ready','failed'));
CREATE OR REPLACE FUNCTION public.trigg_deal_documents_guard_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 IF OLD.id IS DISTINCT FROM NEW.id OR OLD.organization_id IS DISTINCT FROM NEW.organization_id
 OR OLD.deal_id IS DISTINCT FROM NEW.deal_id OR OLD.uploaded_by IS DISTINCT FROM NEW.uploaded_by
 OR OLD.created_at IS DISTINCT FROM NEW.created_at OR OLD.storage_path IS DISTINCT FROM NEW.storage_path
 OR OLD.original_filename IS DISTINCT FROM NEW.original_filename OR OLD.mime_type IS DISTINCT FROM NEW.mime_type
 OR OLD.file_size_bytes IS DISTINCT FROM NEW.file_size_bytes OR OLD.document_type IS DISTINCT FROM NEW.document_type
 THEN RAISE EXCEPTION 'Document identity and upload metadata are immutable'; END IF;
 IF OLD.upload_status IS DISTINCT FROM NEW.upload_status AND NOT (
 (OLD.upload_status='pending' AND NEW.upload_status IN ('processing','failed')) OR
 (OLD.upload_status='processing' AND NEW.upload_status IN ('ready','failed'))
 ) THEN RAISE EXCEPTION 'Invalid document upload status transition'; END IF;
 IF NEW.upload_status='processing' AND (NEW.finalize_token IS NULL OR NEW.finalize_lease_until IS NULL)
 THEN RAISE EXCEPTION 'Finalization lease required'; END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.tripp_claim_document_finalize(p_id uuid,p_org uuid,p_deal uuid,p_user uuid,p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 UPDATE public.deal_documents SET upload_status='processing',finalize_token=p_token,
 finalize_lease_until=now()+interval '10 minutes'
 WHERE id=p_id AND organization_id=p_org AND deal_id=p_deal AND uploaded_by=p_user
 AND upload_status='pending';
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;
CREATE OR REPLACE FUNCTION public.tripp_finish_document_finalize(p_id uuid,p_token uuid,p_success boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 UPDATE public.deal_documents SET upload_status=CASE WHEN p_success THEN 'ready' ELSE 'failed' END,
 finalize_token=NULL,finalize_lease_until=NULL
 WHERE id=p_id AND upload_status='processing' AND finalize_token=p_token
 AND finalize_lease_until>now();
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;
REVOKE ALL ON FUNCTION public.tripp_claim_document_finalize(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.tripp_finish_document_finalize(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tripp_claim_document_finalize(uuid,uuid,uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tripp_finish_document_finalize(uuid,uuid,boolean) TO service_role;
COMMIT;
