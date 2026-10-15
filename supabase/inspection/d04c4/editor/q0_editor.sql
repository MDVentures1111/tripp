-- TRIPP D04-C.4A.5 SQL EDITOR STEP: Q0   (generated from q0_migration_history.sql, sha256 8fb59023320a95b8184cdccc10d69887ecf2676a0a4459ddbe1efcba9dcb23f6)
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
     'source_file', 'q0_migration_history.sql', 'source_sha256', '8fb59023320a95b8184cdccc10d69887ecf2676a0a4459ddbe1efcba9dcb23f6',
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
  'tool', 'tripp-d04c4-q0',
  'version', '3',
  'ledger_present', pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
  'buckets_table_present', pg_catalog.to_regclass('storage.buckets') IS NOT NULL,
  'ledger_status', (SELECT CASE
        WHEN pg_catalog.to_regnamespace('supabase_migrations') IS NULL THEN 'absent_schema'
        WHEN pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'absent_table'
        WHEN (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a
               WHERE a.attrelid = pg_catalog.to_regclass('supabase_migrations.schema_migrations')
                 AND a.attname IN ('version', 'name') AND NOT a.attisdropped) <> 2 THEN 'present_unexpected_columns'
        WHEN NOT pg_catalog.has_schema_privilege(pg_catalog.to_regnamespace('supabase_migrations')::oid, 'USAGE')
          OR NOT pg_catalog.has_table_privilege(pg_catalog.to_regclass('supabase_migrations.schema_migrations')::oid, 'SELECT')
          THEN 'present_not_readable'
        ELSE 'present' END),
  'buckets_status', (SELECT CASE
        WHEN pg_catalog.to_regnamespace('storage') IS NULL THEN 'absent_schema'
        WHEN pg_catalog.to_regclass('storage.buckets') IS NULL THEN 'absent_table'
        WHEN (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a
               WHERE a.attrelid = pg_catalog.to_regclass('storage.buckets')
                 AND a.attname IN ('id', 'public', 'file_size_limit', 'allowed_mime_types') AND NOT a.attisdropped) <> 4
          THEN 'present_unexpected_columns'
        WHEN NOT pg_catalog.has_schema_privilege(pg_catalog.to_regnamespace('storage')::oid, 'USAGE')
          OR NOT pg_catalog.has_table_privilege(pg_catalog.to_regclass('storage.buckets')::oid, 'SELECT')
          THEN 'present_not_readable'
        ELSE 'present' END),
  'ledger_candidates', (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                 'schema', n.nspname::text, 'table', c.relname::text) ORDER BY n.nspname, c.relname), '[]'::jsonb)
                          FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                         WHERE c.relkind IN ('r', 'p', 'v')
                           AND c.relname IN ('schema_migrations', '_prisma_migrations', 'knex_migrations', 'flyway_schema_history',
                                             '__drizzle_migrations', 'migrations', 'goose_db_version', 'schema_version')
                           AND n.nspname NOT IN ('auth', 'storage', 'realtime', '_realtime', 'supabase_functions', 'vault',
                                                 'pgsodium', 'graphql', 'net', 'cron', '_analytics', 'pg_catalog', 'information_schema')),
  'executed_as', current_user,
  'transaction_read_only', pg_catalog.current_setting('transaction_read_only'))) AS tripp_d04c4_q0
  ) AS s1(x)),
  (SELECT s2.x::jsonb FROM (
SELECT pg_catalog.jsonb_pretty(COALESCE(CASE
    WHEN pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = pg_catalog.to_regclass('supabase_migrations.schema_migrations')
             AND a.attname IN ('version', 'name') AND NOT a.attisdropped) = 2
     AND pg_catalog.has_schema_privilege(pg_catalog.to_regnamespace('supabase_migrations')::oid, 'USAGE')
     AND pg_catalog.has_table_privilege(pg_catalog.to_regclass('supabase_migrations.schema_migrations')::oid, 'SELECT')
    THEN (SELECT pg_catalog.jsonb_agg((t.j)::jsonb ORDER BY (t.j)::jsonb ->> 'version')
            FROM XMLTABLE('/table/row' PASSING pg_catalog.query_to_xml(
                 'SELECT pg_catalog.jsonb_build_object(''version'', m.version::text, ''name'', m.name::text)::text AS j '
                 || 'FROM supabase_migrations.schema_migrations m',
                 true, false, '') COLUMNS j text PATH 'j') t)
  END, '[]'::jsonb)) AS tripp_d04c4_q0_versions
  ) AS s2(x)),
  (SELECT s3.x::jsonb FROM (
SELECT pg_catalog.jsonb_pretty(COALESCE(CASE
    WHEN pg_catalog.to_regclass('storage.buckets') IS NOT NULL
     AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = pg_catalog.to_regclass('storage.buckets')
             AND a.attname IN ('id', 'public', 'file_size_limit', 'allowed_mime_types') AND NOT a.attisdropped) = 4
     AND pg_catalog.has_schema_privilege(pg_catalog.to_regnamespace('storage')::oid, 'USAGE')
     AND pg_catalog.has_table_privilege(pg_catalog.to_regclass('storage.buckets')::oid, 'SELECT')
    THEN (SELECT pg_catalog.jsonb_agg((t.j)::jsonb)
            FROM XMLTABLE('/table/row' PASSING pg_catalog.query_to_xml(
                 'SELECT pg_catalog.jsonb_build_object(''id'', b.id::text, ''public'', b.public, '
                 || '''file_size_limit'', b.file_size_limit, ''allowed_mime_types'', b.allowed_mime_types)::text AS j '
                 || 'FROM storage.buckets b WHERE b.id = ''tripp-deal-documents''',
                 true, false, '') COLUMNS j text PATH 'j') t)
  END, '[]'::jsonb)) AS tripp_d04c4_q0_bucket
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
