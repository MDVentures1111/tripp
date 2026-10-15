-- TRIPP D04-C.4A.3 Q-ID v1: database identity fingerprint and session-control proof.
-- READ-ONLY. Runs before Q0/Q1. Reads only server settings, catalog metadata, the migration ledger
-- (version column only) and storage bucket ids. No application rows, no function definitions,
-- no application-defined functions invoked.
--
-- Purpose:
--   1. Prove the session-level controls set with `psql -c` persisted into this file
--      (default_transaction_read_only and search_path are reported as SESSION values).
--   2. Give the operator a database-side fingerprint to compare against the Supabase Dashboard of
--      the intended project (Postgres version, migration count and latest version, storage bucket
--      ids, public table count, installed extensions). The project ref itself is not stored in the
--      database, so identity is established by matching two independent channels.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

SELECT pg_catalog.jsonb_pretty(pg_catalog.jsonb_build_object(
  'tool', 'tripp-d04c4-qid',
  'version', '1',
  'captured_at', pg_catalog.now(),
  'session_default_transaction_read_only', pg_catalog.current_setting('default_transaction_read_only'),
  'transaction_read_only', pg_catalog.current_setting('transaction_read_only'),
  'session_search_path', pg_catalog.current_setting('search_path'),
  'database', pg_catalog.current_database(),
  'current_user', CURRENT_USER::text,
  'server_version', pg_catalog.current_setting('server_version'),
  'server_version_num', pg_catalog.current_setting('server_version_num'),
  'system_identifier',
     CASE WHEN pg_catalog.has_function_privilege('pg_catalog.pg_control_system()', 'EXECUTE')
          THEN (SELECT s.system_identifier::text FROM pg_catalog.pg_control_system() s)
          ELSE 'not-permitted' END,
  'migration_ledger_present', pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
  'storage_buckets_present', pg_catalog.to_regclass('storage.buckets') IS NOT NULL,
  'public_base_tables',
     (SELECT COALESCE(pg_catalog.jsonb_agg(c.relname::text ORDER BY c.relname), '[]'::jsonb)
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')),
  'extensions',
     (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', e.extname::text, 'version', e.extversion) ORDER BY e.extname), '[]'::jsonb)
        FROM pg_catalog.pg_extension e)
));

-- Ledger fingerprint (version column only). Fails clearly if the ledger is absent.
SELECT pg_catalog.jsonb_pretty(pg_catalog.jsonb_build_object(
  'migration_count', pg_catalog.count(*),
  'latest_migration_version', pg_catalog.max(m.version)
)) FROM supabase_migrations.schema_migrations m;

-- Bucket ids only (no objects, no owners, no policies).
SELECT pg_catalog.jsonb_pretty(pg_catalog.jsonb_build_object(
  'storage_bucket_ids', COALESCE(pg_catalog.jsonb_agg(b.id ORDER BY b.id), '[]'::jsonb)
)) FROM storage.buckets b;

ROLLBACK;
