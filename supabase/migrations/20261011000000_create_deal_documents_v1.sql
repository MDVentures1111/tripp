-- D04-A1 REVIEW ONLY — DO NOT EXECUTE BEFORE LIVE-SCHEMA REVIEW
-- TRIPP Intelligence: deal-scoped document metadata.
-- Private Storage bucket/policies and trusted upload API are D04-A2/D04-B.
-- This migration creates NO bucket and NO browser write permissions.
--
-- Prerequisites to verify in live Supabase before execution:
--   public.deals(id, organization_id), public.organizations(id),
--   public.organization_memberships(organization_id, user_id, role),
--   auth.users(id), and existing RLS policy behavior.
--   The D03 Deals migration was manually executed; reconcile migration history
--   before any automated migration deployment.

BEGIN;

-- Enables a database-level composite FK that guarantees a document cannot
-- point to a deal belonging to a different organization.
ALTER TABLE public.deals
  ADD CONSTRAINT deals_organization_id_id_unique
  UNIQUE (organization_id, id);

CREATE TABLE public.deal_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  deal_id UUID NOT NULL,
  document_type TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  upload_status TEXT NOT NULL DEFAULT 'pending',
  uploaded_by UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT deal_documents_parent_deal_fk
    FOREIGN KEY (organization_id, deal_id)
    REFERENCES public.deals(organization_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT deal_documents_document_type_valid
    CHECK (document_type IN ('landlord_proposal', 'letter_of_intent', 'other')),
  CONSTRAINT deal_documents_filename_valid
    CHECK (length(btrim(original_filename)) BETWEEN 1 AND 255),
  CONSTRAINT deal_documents_storage_path_valid
    CHECK (length(btrim(storage_path)) > 0 AND length(storage_path) <= 1024),
  CONSTRAINT deal_documents_storage_path_unique UNIQUE (storage_path),
  CONSTRAINT deal_documents_mime_type_valid
    CHECK (mime_type IN (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )),
  CONSTRAINT deal_documents_file_size_valid
    CHECK (file_size_bytes > 0 AND file_size_bytes <= 20971520),
  CONSTRAINT deal_documents_upload_status_valid
    CHECK (upload_status IN ('pending', 'ready', 'failed'))
);

ALTER TABLE public.deal_documents ENABLE ROW LEVEL SECURITY;

-- Readable by all authenticated members of the owning organization,
-- including viewers. The composite FK protects the deal/org relationship.
CREATE POLICY deal_documents_select_policy
ON public.deal_documents
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_memberships AS om
    WHERE om.organization_id = deal_documents.organization_id
      AND om.user_id = (SELECT auth.uid())
      AND om.role IN ('admin', 'member', 'viewer')
  )
);

-- Writes are intentionally reserved for a trusted server-side upload flow.
-- A browser must not be able to assert that a private object is 'ready',
-- impersonate uploaded_by, or choose an arbitrary storage_path.
-- D04-B must validate caller membership/role and deal ownership, generate
-- server-controlled paths, create pending metadata, verify upload completion,
-- then transition to ready (or failed). Service-role credentials must never
-- appear in client code. Storage RLS is designed separately in D04-A2.
REVOKE ALL PRIVILEGES ON TABLE public.deal_documents
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.deal_documents TO authenticated;

-- Keep ownership and upload attribution immutable. Lifecycle updates must
-- be performed only by trusted backend code using a privileged role.
CREATE FUNCTION public.trigg_deal_documents_guard_update()
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

CREATE TRIGGER trg_deal_documents_guard_update
BEFORE UPDATE ON public.deal_documents
FOR EACH ROW
EXECUTE FUNCTION public.trigg_deal_documents_guard_update();

CREATE INDEX idx_deal_documents_org_deal_created
  ON public.deal_documents (organization_id, deal_id, created_at DESC);

CREATE INDEX idx_deal_documents_org_status
  ON public.deal_documents (organization_id, upload_status);

COMMIT;
