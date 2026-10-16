-- D04 production migration reconciliation. Read-only; no repair, DDL, or customer data.
-- Run through an authorized Supabase SQL interface. Do not apply migrations from this file.
WITH baseline(version, purpose) AS (
 VALUES ('20261010000000','deals baseline'),
        ('20261011000000','documents baseline'),
        ('20261012000000','document security baseline')
)
SELECT b.version,b.purpose,
       EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version=b.version) AS recorded_applied
FROM baseline b ORDER BY b.version;

SELECT
 to_regclass('public.organizations') IS NOT NULL AS organizations_present,
 to_regclass('public.organization_memberships') IS NOT NULL AS memberships_present,
 to_regclass('public.deals') IS NOT NULL AS deals_present,
 to_regclass('public.deal_documents') IS NOT NULL AS documents_present,
 to_regclass('public.document_upload_admissions') IS NULL AS admissions_not_yet_installed,
 (SELECT count(*) FROM public.deal_documents) AS document_count,
 (SELECT count(*) FROM public.deal_documents WHERE upload_status='pending') AS pending_count;

SELECT
 EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.deal_documents'::regclass AND conname='deal_documents_upload_status_valid' AND contype='c') AS status_constraint_present,
 EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.deal_documents'::regclass AND tgname='trg_deal_documents_guard_update' AND NOT tgisinternal AND tgenabled <> 'D') AS guard_trigger_enabled,
 NOT has_table_privilege('authenticated','public.deal_documents','INSERT') AS auth_insert_denied,
 NOT has_table_privilege('authenticated','public.deal_documents','UPDATE') AS auth_update_denied,
 NOT has_table_privilege('authenticated','public.deal_documents','DELETE') AS auth_delete_denied,
 NOT has_table_privilege('anon','public.deal_documents','SELECT') AS anon_select_denied,
 EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='tripp_deal_documents_browser_deny' AND permissive='RESTRICTIVE') AS storage_deny_present,
 EXISTS(SELECT 1 FROM storage.buckets WHERE id='tripp-deal-documents' AND public=false AND file_size_limit=20971520 AND cardinality(allowed_mime_types)=2 AND allowed_mime_types @> ARRAY['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[]) AS bucket_matches;

-- IMPORTANT: This report cannot establish that unrecorded migrations' complete effects
-- match production. Never 'repair applied' merely because baseline objects exist.
