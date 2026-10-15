-- TRIPP D04-C.4  Q0 v2  Platform metadata (READ ONLY). NOT pg_catalog, but NOT customer data:
--   (1) Supabase migration ledger supabase_migrations.schema_migrations: version and name only.
--       The "statements" column (full SQL text) is deliberately NOT selected.
--   (2) Configuration row of the private bucket storage.buckets id='tripp-deal-documents':
--       public flag, size limit, MIME allow-list. storage.objects (file rows) is NOT read.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';
SELECT jsonb_pretty(jsonb_build_object(
  'tool', 'tripp-d04c4-q0',
  'version', '2',
  'ledger_present', to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
  'buckets_table_present', to_regclass('storage.buckets') IS NOT NULL,
  'executed_as', current_user,
  'transaction_read_only', current_setting('transaction_read_only'))) AS tripp_d04c4_q0;
-- If ledger_present is false the next statement errors and, with ON_ERROR_STOP, the run ends (no state change).
SELECT jsonb_pretty(COALESCE(jsonb_agg(jsonb_build_object('version', version, 'name', name) ORDER BY version), '[]'))
  AS tripp_d04c4_q0_versions
FROM supabase_migrations.schema_migrations;
-- Bucket configuration (no object rows). Empty array means the bucket does not exist yet.
SELECT jsonb_pretty(COALESCE(jsonb_agg(jsonb_build_object('id', id, 'public', public,
         'file_size_limit', file_size_limit, 'allowed_mime_types', allowed_mime_types)), '[]'))
  AS tripp_d04c4_q0_bucket
FROM storage.buckets WHERE id = 'tripp-deal-documents';
ROLLBACK;
