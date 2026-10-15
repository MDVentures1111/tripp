-- TRIPP D04-C.4A.5 SQL EDITOR STEP: QID   (generated from qid_identity_session.sql, sha256 ff97892e3eb560f15048dc2966c682389db46c4c21ecb343d8f4a86bee8de8fb)
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
     'source_file', 'qid_identity_session.sql', 'source_sha256', 'ff97892e3eb560f15048dc2966c682389db46c4c21ecb343d8f4a86bee8de8fb',
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
))
  ) AS s1(x)),
  (SELECT s2.x::jsonb FROM (
SELECT pg_catalog.jsonb_pretty(pg_catalog.jsonb_build_object(
  'migration_count', pg_catalog.count(*),
  'latest_migration_version', pg_catalog.max(m.version)
)) FROM supabase_migrations.schema_migrations m
  ) AS s2(x)),
  (SELECT s3.x::jsonb FROM (
SELECT pg_catalog.jsonb_pretty(pg_catalog.jsonb_build_object(
  'storage_bucket_ids', COALESCE(pg_catalog.jsonb_agg(b.id ORDER BY b.id), '[]'::jsonb)
)) FROM storage.buckets b
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
