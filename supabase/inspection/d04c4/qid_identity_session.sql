-- TRIPP D04-C.4A.6 Q-ID v2: database identity fingerprint and session-control proof.
-- v2 (D04-C.4A.6): optional platform objects (migration ledger, storage.buckets) are never referenced
-- directly. Their presence is read from the catalog first; they are read only when present and
-- readable, through the built-in query_to_xml() with a constant, schema-qualified query. A missing
-- object is reported as an explicit status instead of failing the whole statement at parse time.
-- Optional relations are located through pg_class/pg_namespace (readable by every role), never
-- to_regclass(), which raises "permission denied for schema" when the role lacks USAGE.
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
  'version', '2',
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
  'migration_ledger_present', (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'supabase_migrations' AND c.relname = 'schema_migrations') IS NOT NULL,
  'storage_buckets_present', (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'storage' AND c.relname = 'buckets') IS NOT NULL,
  'platform_schemas_present',
     (SELECT COALESCE(pg_catalog.jsonb_agg(n.nspname::text ORDER BY n.nspname), '[]'::jsonb)
        FROM pg_catalog.pg_namespace n
       WHERE n.nspname IN ('auth', 'storage', 'supabase_migrations', 'extensions', 'graphql', 'realtime', 'vault')),
  'api_roles_present',
     (SELECT COALESCE(pg_catalog.jsonb_agg(r.rolname::text ORDER BY r.rolname), '[]'::jsonb)
        FROM pg_catalog.pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'authenticator')),
  'public_base_tables',
     (SELECT COALESCE(pg_catalog.jsonb_agg(c.relname::text ORDER BY c.relname), '[]'::jsonb)
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')),
  'extensions',
     (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', e.extname::text, 'version', e.extversion) ORDER BY e.extname), '[]'::jsonb)
        FROM pg_catalog.pg_extension e)
));

-- Ledger fingerprint (version column only), read only when present and readable.
-- CASE guarantees the query_to_xml subquery is evaluated only for status 'present'.
SELECT pg_catalog.jsonb_pretty(pg_catalog.jsonb_build_object('ledger_status', st.status)
  || COALESCE(CASE WHEN st.status = 'present' THEN
       (SELECT (t.j)::jsonb
          FROM XMLTABLE('/table/row' PASSING pg_catalog.query_to_xml(
               'SELECT pg_catalog.jsonb_build_object(''migration_count'', pg_catalog.count(*), '
               || '''latest_migration_version'', pg_catalog.max(m.version::text))::text AS j '
               || 'FROM supabase_migrations.schema_migrations m',
               true, false, '') COLUMNS j text PATH 'j') t)
     END, pg_catalog.jsonb_build_object('migration_count', NULL, 'latest_migration_version', NULL)))
FROM (SELECT CASE
        WHEN pg_catalog.to_regnamespace('supabase_migrations') IS NULL THEN 'absent_schema'
        WHEN (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'supabase_migrations' AND c.relname = 'schema_migrations') IS NULL THEN 'absent_table'
        WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                          WHERE a.attrelid = (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'supabase_migrations' AND c.relname = 'schema_migrations')
                            AND a.attname = 'version' AND NOT a.attisdropped) THEN 'present_unexpected_columns'
        WHEN NOT pg_catalog.has_schema_privilege(pg_catalog.to_regnamespace('supabase_migrations')::oid, 'USAGE')
          OR NOT pg_catalog.has_table_privilege((SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'supabase_migrations' AND c.relname = 'schema_migrations')::oid, 'SELECT')
          THEN 'present_not_readable'
        ELSE 'present' END AS status) st;

-- Bucket ids only (no objects, no owners, no policies), read only when present and readable.
SELECT pg_catalog.jsonb_pretty(pg_catalog.jsonb_build_object(
  'buckets_status', st.status,
  'storage_bucket_ids', CASE WHEN st.status = 'present'
                             THEN (SELECT COALESCE(pg_catalog.jsonb_agg(t.id ORDER BY t.id), '[]'::jsonb)
                                     FROM XMLTABLE('/table/row' PASSING pg_catalog.query_to_xml(
                                          'SELECT b.id::text AS id FROM storage.buckets b', true, false, '')
                                          COLUMNS id text PATH 'id') t) END
))
FROM (SELECT CASE
        WHEN pg_catalog.to_regnamespace('storage') IS NULL THEN 'absent_schema'
        WHEN (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'storage' AND c.relname = 'buckets') IS NULL THEN 'absent_table'
        WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                          WHERE a.attrelid = (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'storage' AND c.relname = 'buckets')
                            AND a.attname = 'id' AND NOT a.attisdropped) THEN 'present_unexpected_columns'
        WHEN NOT pg_catalog.has_schema_privilege(pg_catalog.to_regnamespace('storage')::oid, 'USAGE')
          OR NOT pg_catalog.has_table_privilege((SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'storage' AND c.relname = 'buckets')::oid, 'SELECT')
          THEN 'present_not_readable'
        ELSE 'present' END AS status) st;

ROLLBACK;
