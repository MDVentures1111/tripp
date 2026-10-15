-- D04-C.4C: fail-closed preconditions for the D04-C document lifecycle (20261013 onward).
-- Read-only. Changes nothing; aborts the push with a named reason if the target database
-- is not the reviewed pre-ledger baseline (deals v1, deal_documents v1, private bucket v1)
-- or holds documents whose meaning would change under the new lifecycle.
DO $preflight$
DECLARE
  v_def text;
  v_n bigint;
BEGIN
  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.organization_memberships') IS NULL
     OR to_regclass('public.deals') IS NULL
     OR to_regclass('public.deal_documents') IS NULL THEN
    RAISE EXCEPTION 'D04-C preflight: baseline tables are missing';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.deal_documents'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.deals'::regclass) THEN
    RAISE EXCEPTION 'D04-C preflight: RLS is not enabled on deals/deal_documents';
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.deal_documents'::regclass
    AND c.conname = 'deal_documents_upload_status_valid' AND c.contype = 'c';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'D04-C preflight: constraint deal_documents_upload_status_valid is missing';
  END IF;
  IF v_def !~ '''pending''' OR v_def !~ '''ready''' OR v_def !~ '''failed''' OR v_def ~ '''processing''' THEN
    RAISE EXCEPTION 'D04-C preflight: unexpected upload status constraint: %', v_def;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.deal_documents'::regclass AND c.contype = 'f'
      AND c.confrelid = 'public.deals'::regclass AND cardinality(c.conkey) = 2) THEN
    RAISE EXCEPTION 'D04-C preflight: composite document/deal foreign key is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.deal_documents'::regclass
      AND tgname = 'trg_deal_documents_guard_update' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'D04-C preflight: document guard trigger is missing';
  END IF;

  IF has_table_privilege('authenticated', 'public.deal_documents', 'INSERT')
     OR has_table_privilege('authenticated', 'public.deal_documents', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.deal_documents', 'DELETE')
     OR has_table_privilege('anon', 'public.deal_documents', 'SELECT') THEN
    RAISE EXCEPTION 'D04-C preflight: browser roles hold write or anonymous access to deal_documents';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'tripp-deal-documents' AND public = false
      AND file_size_limit = 20971520
      AND allowed_mime_types IS NOT NULL
      AND allowed_mime_types::text[] @> ARRAY['application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[]
      AND cardinality(allowed_mime_types) = 2) THEN
    RAISE EXCEPTION 'D04-C preflight: private document bucket is missing or misconfigured';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'tripp_deal_documents_browser_deny' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'D04-C preflight: restrictive Storage deny policy is missing';
  END IF;

  IF to_regclass('public.document_upload_admissions') IS NOT NULL THEN
    RAISE EXCEPTION 'D04-C preflight: document_upload_admissions already exists; manual review required';
  END IF;

  -- Pre-existing documents. Pending rows would be failed by the expiry schedule; READY rows
  -- without a clean scan bound to their digest would be listed as ready but never downloadable.
  SELECT count(*) INTO v_n FROM public.deal_documents WHERE upload_status = 'pending';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'D04-C preflight: % pending document(s) exist; resolve them before applying the lifecycle', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.deal_documents d
  WHERE d.upload_status = 'ready'
    AND ((to_jsonb(d) ->> 'verified_sha256') IS NULL
      OR (to_jsonb(d) ->> 'malware_scan_sha256') IS DISTINCT FROM (to_jsonb(d) ->> 'verified_sha256')
      OR (to_jsonb(d) ->> 'malware_scanned_at') IS NULL);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'D04-C preflight: % ready document(s) lack a clean scan bound to their digest; disposition required', v_n;
  END IF;
END
$preflight$;
