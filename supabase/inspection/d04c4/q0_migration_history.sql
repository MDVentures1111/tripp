-- TRIPP D04-C.4  Q0 v3  Platform metadata (READ ONLY). NOT pg_catalog, but NOT customer data:
--   (1) Supabase migration ledger supabase_migrations.schema_migrations: version and name only.
--       The "statements" column (full SQL text) is deliberately NOT selected.
--   (2) Configuration row of the private bucket storage.buckets id='tripp-deal-documents':
--       public flag, size limit, MIME allow-list. storage.objects (file rows) is NOT read.
-- v3 (D04-C.4A.6): neither optional object is referenced directly. Presence, expected columns and
-- privilege are read from the catalog first; the object is read only when its status is 'present',
-- through the built-in query_to_xml() with a constant, schema-qualified query, guarded by CASE.
-- A missing ledger or bucket table is an explicit finding (status), never an uncontrolled error.
-- Also lists, by catalog name only, any OTHER well-known migration-ledger tables (no rows read).
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';
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
  'transaction_read_only', pg_catalog.current_setting('transaction_read_only'))) AS tripp_d04c4_q0;
-- Ledger versions and names. Empty array unless the ledger status is 'present' (see header).
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
  END, '[]'::jsonb)) AS tripp_d04c4_q0_versions;
-- Bucket configuration (no object rows). Empty array means the bucket (or the buckets table) does not exist.
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
  END, '[]'::jsonb)) AS tripp_d04c4_q0_bucket;
ROLLBACK;
