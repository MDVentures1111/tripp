-- D04-A2 REVIEW ONLY — DO NOT EXECUTE UNTIL LIVE STORAGE POLICY PREFLIGHT
-- TRIPP Intelligence: private, server-mediated document storage.
-- Requires D04-A1 public.deal_documents.
-- D04-B will implement authenticated authorization, server-side upload,
-- short-lived download links, object verification, and metadata transitions.
-- No browser Storage API grants are introduced by this migration.
--
-- IMPORTANT: inspect existing storage.objects RLS policies before deployment.
-- This migration adds a RESTRICTIVE deny for the target bucket, even if other
-- permissive storage.objects policies already exist.
-- Storage service_role operations bypass RLS; never expose its key to browsers.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.deal_documents') IS NULL THEN
    RAISE EXCEPTION 'D04-A1 public.deal_documents must exist first';
  END IF;

  IF EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'tripp-deal-documents'
  ) THEN
    RAISE EXCEPTION 'Storage bucket tripp-deal-documents already exists: manual review required';
  END IF;
END;
$$;

INSERT INTO storage.buckets
  (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('tripp-deal-documents',
   'tripp-deal-documents',
   false,
   20971520,
   ARRAY[
     'application/pdf',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
   ]::text[]);

-- RLS restrictive policy: denies browser/API access to objects in this bucket
-- for all ordinary roles, even if another permissive policy would allow it.
-- For other buckets, this expression is true and does not remove access.
-- No INSERT/SELECT/UPDATE/DELETE permissive policy is added for this bucket.
-- The D04-B trusted backend will use server-side credentials after independently
-- checking JWT, membership, role, deal ownership, and object-to-metadata binding.
CREATE POLICY tripp_deal_documents_browser_deny
ON storage.objects
AS RESTRICTIVE
FOR ALL
TO PUBLIC
USING (bucket_id <> 'tripp-deal-documents')
WITH CHECK (bucket_id <> 'tripp-deal-documents');

COMMIT;
