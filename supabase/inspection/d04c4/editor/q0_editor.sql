-- TRIPP D04-C.4A.5 SQL EDITOR STEP: Q0   (generated from q0_migration_history.sql, sha256 6c25bb3b28a13fc94e8a467ad7c13fd0537cd4892a6a33ddc883b1b387218d4c)
-- Paste this WHOLE file into a NEW Supabase SQL Editor tab and press Run ONCE. Do not edit it.
-- Read-only: nothing here can change data or schema. It returns rows named step/part/parts/sha256/chunk.
-- If the result panel shows any error, STOP and report the error text. Do not re-run.
SET LOCAL transaction_read_only = on;
SET LOCAL default_transaction_read_only = on;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';
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
     'mode', 'sql-editor', 'editor_version', '1', 'step', 'q0',
     'source_file', 'q0_migration_history.sql', 'source_sha256', '6c25bb3b28a13fc94e8a467ad7c13fd0537cd4892a6a33ddc883b1b387218d4c',
     'transaction_read_only', pg_catalog.current_setting('transaction_read_only'),
     'default_transaction_read_only', pg_catalog.current_setting('default_transaction_read_only'),
     'search_path', pg_catalog.current_setting('search_path'),
     'statement_timeout', pg_catalog.current_setting('statement_timeout'),
     'lock_timeout', pg_catalog.current_setting('lock_timeout'),
     'current_user', CURRENT_USER::text,
     'write_xid_assigned', pg_catalog.pg_current_xact_id_if_assigned()::text),
  'documents', pg_catalog.jsonb_build_array(
  (SELECT s1.x::jsonb FROM (
SELECT jsonb_pretty(jsonb_build_object(
  'tool', 'tripp-d04c4-q0',
  'version', '2',
  'ledger_present', to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
  'buckets_table_present', to_regclass('storage.buckets') IS NOT NULL,
  'executed_as', current_user,
  'transaction_read_only', current_setting('transaction_read_only'))) AS tripp_d04c4_q0
  ) AS s1(x)),
  (SELECT s2.x::jsonb FROM (
SELECT jsonb_pretty(COALESCE(jsonb_agg(jsonb_build_object('version', version, 'name', name) ORDER BY version), '[]'))
  AS tripp_d04c4_q0_versions
FROM supabase_migrations.schema_migrations
  ) AS s2(x)),
  (SELECT s3.x::jsonb FROM (
SELECT jsonb_pretty(COALESCE(jsonb_agg(jsonb_build_object('id', id, 'public', public,
         'file_size_limit', file_size_limit, 'allowed_mime_types', allowed_mime_types)), '[]'))
  AS tripp_d04c4_q0_bucket
FROM storage.buckets WHERE id = 'tripp-deal-documents'
  ) AS s3(x))
  ))::text AS t
  FROM tripp_guard WHERE tripp_guard.ok
)
SELECT 'q0'::text AS step, n AS part, p.parts,
       pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(tripp_payload.t, 'UTF8')), 'hex') AS sha256,
       pg_catalog.substr(tripp_payload.t, (n - 1) * 8000 + 1, 8000) AS chunk
FROM tripp_payload
CROSS JOIN LATERAL (SELECT pg_catalog.ceil(pg_catalog.length(tripp_payload.t) / 8000.0)::int AS parts) p
CROSS JOIN LATERAL pg_catalog.generate_series(1, p.parts) AS n
ORDER BY n
LIMIT 1000;
