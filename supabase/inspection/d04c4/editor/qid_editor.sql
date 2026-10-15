-- TRIPP D04-C.4A.5 SQL EDITOR STEP: QID   (generated from qid_identity_session.sql, sha256 d3258869a2b79fc698b726716715be98640aa2a1dc203dc4de24c22926bdce95)
-- Paste this WHOLE file into a NEW Supabase SQL Editor tab and press Run ONCE. Do not edit it.
-- Read-only: nothing here can change data or schema. It returns rows named step/part/parts/sha256/chunk.
-- If the result panel shows any error, STOP and report the error text. Do not re-run.
SET LOCAL transaction_read_only = on;
SET LOCAL default_transaction_read_only = on;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '30s';
SET LOCAL search_path = pg_catalog, pg_temp;
WITH tripp_guard AS (
  SELECT CASE
    WHEN pg_catalog.current_setting('transaction_read_only') = 'on'
     AND pg_catalog.current_setting('default_transaction_read_only') = 'on'
     AND pg_catalog.current_setting('search_path') = 'pg_catalog, pg_temp'
     AND pg_catalog.current_setting('statement_timeout') = '5s'
     AND pg_catalog.current_setting('lock_timeout') = '2s'
    THEN true
    ELSE (('TRIPP-STOP session controls not in effect read_only=' || pg_catalog.current_setting('transaction_read_only')
           || ' search_path=' || pg_catalog.current_setting('search_path'))::int > 0)
  END AS ok
),
tripp_payload AS (
  SELECT pg_catalog.jsonb_build_object(
  'editor_envelope', pg_catalog.jsonb_build_object(
     'mode', 'sql-editor', 'editor_version', '1', 'step', 'qid',
     'source_file', 'qid_identity_session.sql', 'source_sha256', 'd3258869a2b79fc698b726716715be98640aa2a1dc203dc4de24c22926bdce95',
     'transaction_read_only', pg_catalog.current_setting('transaction_read_only'),
     'default_transaction_read_only', pg_catalog.current_setting('default_transaction_read_only'),
     'search_path', pg_catalog.current_setting('search_path'),
     'statement_timeout', pg_catalog.current_setting('statement_timeout'),
     'lock_timeout', pg_catalog.current_setting('lock_timeout'),
     'current_user', CURRENT_USER::text,
     'write_xid_assigned', pg_catalog.pg_current_xact_id_if_assigned()::text),
  'documents', pg_catalog.jsonb_build_array(
  (SELECT s1.x::jsonb FROM (
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
  'migration_ledger_present', pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
  'storage_buckets_present', pg_catalog.to_regclass('storage.buckets') IS NOT NULL,
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
))
  ) AS s1(x)),
  (SELECT s2.x::jsonb FROM (
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
        WHEN pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'absent_table'
        WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                          WHERE a.attrelid = pg_catalog.to_regclass('supabase_migrations.schema_migrations')
                            AND a.attname = 'version' AND NOT a.attisdropped) THEN 'present_unexpected_columns'
        WHEN NOT pg_catalog.has_schema_privilege(pg_catalog.to_regnamespace('supabase_migrations')::oid, 'USAGE')
          OR NOT pg_catalog.has_table_privilege(pg_catalog.to_regclass('supabase_migrations.schema_migrations')::oid, 'SELECT')
          THEN 'present_not_readable'
        ELSE 'present' END AS status) st
  ) AS s2(x)),
  (SELECT s3.x::jsonb FROM (
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
        WHEN pg_catalog.to_regclass('storage.buckets') IS NULL THEN 'absent_table'
        WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                          WHERE a.attrelid = pg_catalog.to_regclass('storage.buckets')
                            AND a.attname = 'id' AND NOT a.attisdropped) THEN 'present_unexpected_columns'
        WHEN NOT pg_catalog.has_schema_privilege(pg_catalog.to_regnamespace('storage')::oid, 'USAGE')
          OR NOT pg_catalog.has_table_privilege(pg_catalog.to_regclass('storage.buckets')::oid, 'SELECT')
          THEN 'present_not_readable'
        ELSE 'present' END AS status) st
  ) AS s3(x))
  ))::text AS t
  FROM tripp_guard WHERE tripp_guard.ok
)
SELECT 'qid'::text AS step, n AS part, p.parts,
       pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(tripp_payload.t, 'UTF8')), 'hex') AS sha256,
       pg_catalog.substr(tripp_payload.t, (n - 1) * 8000 + 1, 8000) AS chunk
FROM tripp_payload
CROSS JOIN LATERAL (SELECT pg_catalog.ceil(pg_catalog.length(tripp_payload.t) / 8000.0)::int AS parts) p
CROSS JOIN LATERAL pg_catalog.generate_series(1, p.parts) AS n
ORDER BY n
LIMIT 1000;
