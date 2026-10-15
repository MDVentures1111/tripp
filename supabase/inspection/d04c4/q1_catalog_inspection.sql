-- TRIPP D04-C.4  Q1 v2.2  Production catalog inspection (READ ONLY, catalog metadata only)
-- v2.2 (D04-C.4A.6): no unconditional reference to optional platform objects. auth.users is resolved
-- with to_regclass (NULL when absent), privilege checks run only for API roles that exist, and a
-- 'platform_objects' section reports which Supabase schemas, roles, tables and auth.uid() exist.
-- Reads pg_catalog / pg_policies only. Touches NO application table rows.
-- Run once, as-is, in the Supabase Dashboard SQL Editor of project ufcgsdpqfqeifjzzcuei,
-- ONLY after explicit authorization. Output: one JSON document (single row, single column).
-- Safety: READ ONLY transaction (PostgreSQL rejects every INSERT/UPDATE/DELETE/DDL/GRANT inside it),
-- short timeouts, no user-defined functions are invoked, ends in ROLLBACK.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

WITH
expected(relname) AS (
  VALUES ('organizations'), ('organization_memberships'), ('deals'), ('deal_documents')
),
target AS (
  SELECT c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN (SELECT relname FROM expected)
),
cols AS (
  SELECT t.relname, a.attnum, a.attname,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
         a.atttypid, a.attnotnull, a.attidentity, a.attgenerated, a.attacl,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expr
  FROM target t
  JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
),
cons AS (
  SELECT t.relname, con.conname, con.contype, con.convalidated,
         pg_catalog.pg_get_constraintdef(con.oid) AS definition
  FROM target t JOIN pg_catalog.pg_constraint con ON con.conrelid = t.oid
),
inbound_fk AS (
  SELECT con.conrelid::regclass::text AS from_table, t.relname AS to_table, con.conname,
         pg_catalog.pg_get_constraintdef(con.oid) AS definition
  FROM pg_catalog.pg_constraint con JOIN target t ON con.confrelid = t.oid
  WHERE con.contype = 'f'
),
idx AS (
  SELECT t.relname, i.indexrelid::regclass::text AS index_name, i.indisunique, i.indisprimary,
         i.indisvalid, pg_catalog.pg_get_indexdef(i.indexrelid) AS definition
  FROM target t JOIN pg_catalog.pg_index i ON i.indrelid = t.oid
),
pols AS (
  SELECT p.tablename, p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check
  FROM pg_catalog.pg_policies p
  WHERE p.schemaname = 'public' AND p.tablename IN (SELECT relname FROM target)
),
tgrants AS (
  SELECT t.relname, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS grantee,
         a.privilege_type
  FROM target t,
       LATERAL pg_catalog.aclexplode(COALESCE(t.relacl, pg_catalog.acldefault('r', t.relowner))) a
  WHERE a.grantee = 0 OR pg_catalog.pg_get_userbyid(a.grantee) IN ('anon', 'authenticated', 'service_role')
),
cgrants AS (
  SELECT c.relname, c.attname, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS grantee,
         a.privilege_type
  FROM cols c, LATERAL pg_catalog.aclexplode(c.attacl) a
  WHERE c.attacl IS NOT NULL
    AND (a.grantee = 0 OR pg_catalog.pg_get_userbyid(a.grantee) IN ('anon', 'authenticated', 'service_role'))
),
trg AS (
  SELECT tg.tgrelid::regclass::text AS on_table, tg.tgname, tg.tgenabled, tg.tgfoid,
         pg_catalog.pg_get_triggerdef(tg.oid) AS definition
  FROM pg_catalog.pg_trigger tg
  WHERE NOT tg.tgisinternal
    AND (tg.tgrelid IN (SELECT oid FROM target) OR tg.tgrelid = pg_catalog.to_regclass('auth.users'))
),
enums AS (
  SELECT ty.typname,
         (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_catalog.pg_enum e WHERE e.enumtypid = ty.oid) AS labels
  FROM pg_catalog.pg_type ty
  WHERE ty.typtype = 'e' AND ty.oid IN (SELECT atttypid FROM cols)
),
user_procs AS (
  -- Candidate functions: every non-platform schema. Platform-owned schemas are excluded explicitly.
  SELECT p.oid, p.proname, p.prosrc, n.nspname
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname NOT IN (
    'information_schema', 'auth', 'extensions', 'storage', 'graphql', 'graphql_public', 'realtime',
    '_realtime', 'vault', 'pgsodium', 'pgsodium_masks', 'net', 'cron', 'pgbouncer',
    'supabase_functions', 'supabase_migrations', '_analytics')
),
storage_pols AS (
  -- Storage RLS that governs the private document bucket or consults memberships.
  SELECT p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check
  FROM pg_catalog.pg_policies p
  WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
    AND (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) ~ '(tripp-deal-documents|organization_memberships|organizations|deal_documents)'
),
seed_funcs AS (
  -- (a) trigger functions on the target tables and on auth.users
  SELECT tgfoid AS oid, 'trigger' AS reason FROM trg
  UNION
  -- (b) functions named in any target-table or storage policy predicate
  SELECT up.oid, 'policy' FROM user_procs up
  WHERE EXISTS (SELECT 1 FROM (SELECT qual, with_check FROM pols UNION ALL SELECT qual, with_check FROM storage_pols) pp
                WHERE (COALESCE(pp.qual, '') || ' ' || COALESCE(pp.with_check, '')) ~ ('\m' || up.proname || '\s*\('))
  UNION
  -- (c) functions named in target-table defaults or CHECK constraints
  SELECT up.oid, 'default_or_check' FROM user_procs up
  WHERE EXISTS (SELECT 1 FROM (SELECT default_expr AS e FROM cols UNION ALL SELECT definition FROM cons) x
                WHERE COALESCE(x.e, '') ~ ('\m' || up.proname || '\s*\('))
  UNION
  -- (d) any function whose body references a target table (catches RPCs that read or write memberships)
  SELECT up.oid, 'references_target_table' FROM user_procs up
  WHERE up.prosrc ~ '\m(organizations|organization_memberships|deals|deal_documents)\M'
),
funcs AS (
  -- (e) transitive closure: functions called by discovered functions, up to depth 4 (text-based).
  WITH RECURSIVE walk(oid, depth) AS (
    SELECT oid, 0 FROM seed_funcs
    UNION
    SELECT callee.oid, w.depth + 1
    FROM walk w
    JOIN pg_catalog.pg_proc caller ON caller.oid = w.oid
    JOIN user_procs callee ON callee.oid <> w.oid
      AND caller.prosrc ~ ('\m' || callee.proname || '\s*\(')
    WHERE w.depth < 4
  )
  SELECT oid, min(depth) AS depth FROM walk GROUP BY oid
),
fmeta AS (
  SELECT p.oid::regprocedure::text AS signature, f.depth AS discovery_depth,
         (SELECT jsonb_agg(DISTINCT sf.reason) FROM seed_funcs sf WHERE sf.oid = p.oid) AS discovery_reasons,
         p.prosecdef AS security_definer, p.provolatile,
         l.lanname AS language, pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.proconfig AS config,
         (SELECT jsonb_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END)
            FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
           WHERE a.privilege_type = 'EXECUTE') AS execute_grantees,
         jsonb_build_object(
           'anon',          CASE WHEN pg_catalog.to_regrole('anon') IS NOT NULL
                                 THEN pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') END,
           'authenticated', CASE WHEN pg_catalog.to_regrole('authenticated') IS NOT NULL
                                 THEN pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') END,
           'public',        pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE')) AS effective_execute,
         pg_catalog.md5(p.prosrc) AS body_md5,
         pg_catalog.pg_get_functiondef(p.oid) AS definition
  FROM funcs f
  JOIN pg_catalog.pg_proc p ON p.oid = f.oid
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
),
api_roles_wanted(role) AS (VALUES ('anon'), ('authenticated'), ('service_role'), ('public')),
api_roles AS (
  -- Only roles that exist ('public' is the PUBLIC pseudo-role); absent roles are reported in platform_objects.
  SELECT role FROM api_roles_wanted WHERE role = 'public' OR pg_catalog.to_regrole(role) IS NOT NULL
),
privs(priv) AS (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')),
effective_table_privs AS (
  -- Effective privileges (direct grants + PUBLIC + inherited role membership), via has_*_privilege.
  SELECT t.relname, r.role, pr.priv,
         pg_catalog.has_table_privilege(r.role, t.oid, pr.priv) AS on_table,
         CASE WHEN pr.priv IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
              THEN pg_catalog.has_any_column_privilege(r.role, t.oid, pr.priv) END AS on_any_column
  FROM target t CROSS JOIN api_roles r CROSS JOIN privs pr
),
schema_privs AS (
  SELECT r.role,
         pg_catalog.has_schema_privilege(r.role, 'public', 'USAGE')  AS public_usage,
         pg_catalog.has_schema_privilege(r.role, 'public', 'CREATE') AS public_create
  FROM api_roles r
),
role_attrs AS (
  -- Attributes of API roles and of every owner of a target table or discovered function.
  SELECT ro.rolname, ro.rolsuper, ro.rolbypassrls, ro.rolinherit, ro.rolcanlogin,
         (SELECT jsonb_agg(g.rolname) FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles g ON g.oid = m.roleid
           WHERE m.member = ro.oid) AS member_of
  FROM pg_catalog.pg_roles ro
  WHERE ro.rolname IN ('anon', 'authenticated', 'service_role', 'authenticator')
     OR ro.oid IN (SELECT relowner FROM target)
     OR ro.oid IN (SELECT p.proowner FROM funcs f JOIN pg_catalog.pg_proc p ON p.oid = f.oid)
),
default_privs AS (
  -- Default privileges that would apply to FUTURE objects in public (e.g. a later membership table).
  SELECT pg_catalog.pg_get_userbyid(d.defaclrole) AS for_objects_created_by, d.defaclobjtype AS object_type,
         CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS grantee,
         a.privilege_type
  FROM pg_catalog.pg_default_acl d
  LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace,
       LATERAL pg_catalog.aclexplode(d.defaclacl) a
  WHERE (n.nspname = 'public' OR d.defaclnamespace = 0)
    AND (a.grantee = 0 OR pg_catalog.pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))
),
dep_views AS (
  SELECT DISTINCT v.oid::regclass::text AS view_name, v.reloptions
  FROM pg_catalog.pg_depend d
  JOIN pg_catalog.pg_rewrite r ON r.oid = d.objid
  JOIN pg_catalog.pg_class v ON v.oid = r.ev_class AND v.relkind IN ('v', 'm')
  WHERE d.refobjid IN (SELECT oid FROM target) AND v.oid NOT IN (SELECT oid FROM target)
),
texts(source, text) AS (
  SELECT 'policy ' || tablename || '.' || policyname || ' USING', qual FROM pols
  UNION ALL SELECT 'policy ' || tablename || '.' || policyname || ' WITH CHECK', with_check FROM pols
  UNION ALL SELECT 'default ' || relname || '.' || attname, default_expr FROM cols
  UNION ALL SELECT 'constraint ' || relname || '.' || conname, definition FROM cons
  UNION ALL SELECT 'function ' || signature, definition FROM fmeta
  UNION ALL SELECT 'storage policy ' || policyname || ' USING', qual FROM storage_pols
  UNION ALL SELECT 'storage policy ' || policyname || ' WITH CHECK', with_check FROM storage_pols
),
literal_flags AS (
  -- Pre-share review aid: locations whose text contains literals that could be sensitive.
  SELECT source,
         jsonb_build_object(
           'email',       text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}',
           'jwt',         text ~  'eyJ[A-Za-z0-9_-]{10,}',
           'long_token',  text ~  '[A-Za-z0-9+/_=-]{40,}',
           'url',         text ~* 'https?://',
           'uuid_literal',text ~* '''[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}''',
           'secret_word', text ~* '(password|passwd|secret|api[_-]?key|service_role_key|bearer )'
         ) AS flags
  FROM texts WHERE text IS NOT NULL
)
SELECT jsonb_pretty(jsonb_build_object(
  'capture', jsonb_build_object(
     'tool', 'tripp-d04c4-q1', 'version', '2.2', 'captured_at', now(),
     'server_version', current_setting('server_version'),
     'executed_as', current_user,
     'transaction_read_only', current_setting('transaction_read_only')),
  'platform_objects', jsonb_build_object(
     'schemas', (SELECT COALESCE(jsonb_agg(jsonb_build_object('schema', w.s, 'present', pg_catalog.to_regnamespace(w.s) IS NOT NULL) ORDER BY w.s), '[]')
                   FROM (VALUES ('auth'), ('storage'), ('supabase_migrations'), ('extensions')) w(s)),
     'roles',   (SELECT COALESCE(jsonb_agg(jsonb_build_object('role', w.r, 'present', pg_catalog.to_regrole(w.r) IS NOT NULL) ORDER BY w.r), '[]')
                   FROM (VALUES ('anon'), ('authenticated'), ('service_role'), ('authenticator')) w(r)),
     'relations', (SELECT COALESCE(jsonb_agg(jsonb_build_object('relation', w.r, 'present', pg_catalog.to_regclass(w.r) IS NOT NULL) ORDER BY w.r), '[]')
                   FROM (VALUES ('auth.users'), ('storage.buckets'), ('storage.objects'), ('supabase_migrations.schema_migrations')) w(r)),
     'auth_uid_function_present', pg_catalog.to_regprocedure('auth.uid()') IS NOT NULL,
     'api_roles_checked', (SELECT COALESCE(jsonb_agg(role ORDER BY role), '[]') FROM api_roles)),
  'missing_tables',  (SELECT COALESCE(jsonb_agg(relname), '[]') FROM expected WHERE relname NOT IN (SELECT relname FROM target)),
  'tables',          (SELECT COALESCE(jsonb_agg(jsonb_build_object('table', relname, 'kind', relkind, 'owner', pg_catalog.pg_get_userbyid(relowner),
                                                           'rls_enabled', relrowsecurity, 'rls_forced', relforcerowsecurity) ORDER BY relname), '[]') FROM target),
  'columns',         (SELECT COALESCE(jsonb_agg(jsonb_build_object('table', relname, 'column', attname, 'type', type, 'not_null', attnotnull,
                                                           'default', default_expr, 'identity', attidentity, 'generated', attgenerated) ORDER BY relname, attnum), '[]') FROM cols),
  'enum_types',      (SELECT COALESCE(jsonb_agg(jsonb_build_object('type', typname, 'labels', labels)), '[]') FROM enums),
  'constraints',     (SELECT COALESCE(jsonb_agg(jsonb_build_object('table', relname, 'name', conname, 'type', contype, 'validated', convalidated, 'definition', definition) ORDER BY relname, conname), '[]') FROM cons),
  'inbound_foreign_keys', (SELECT COALESCE(jsonb_agg(jsonb_build_object('from', from_table, 'to', to_table, 'name', conname, 'definition', definition) ORDER BY from_table, conname), '[]') FROM inbound_fk),
  'indexes',         (SELECT COALESCE(jsonb_agg(jsonb_build_object('table', relname, 'index', index_name, 'unique', indisunique, 'primary', indisprimary, 'valid', indisvalid, 'definition', definition) ORDER BY relname, index_name), '[]') FROM idx),
  'policies',        (SELECT COALESCE(jsonb_agg(jsonb_build_object('table', tablename, 'policy', policyname, 'permissive', permissive, 'roles', roles, 'command', cmd, 'using', qual, 'with_check', with_check) ORDER BY tablename, policyname), '[]') FROM pols),
  'table_grants',    (SELECT COALESCE(jsonb_agg(jsonb_build_object('table', relname, 'grantee', grantee, 'privilege', privilege_type) ORDER BY relname, grantee, privilege_type), '[]') FROM tgrants),
  'column_grants',   (SELECT COALESCE(jsonb_agg(jsonb_build_object('table', relname, 'column', attname, 'grantee', grantee, 'privilege', privilege_type)), '[]') FROM cgrants),
  'triggers',        (SELECT COALESCE(jsonb_agg(jsonb_build_object('table', on_table, 'trigger', tgname, 'enabled', tgenabled, 'function', tgfoid::regprocedure::text, 'definition', definition) ORDER BY on_table, tgname), '[]') FROM trg),
  'functions',       (SELECT COALESCE(jsonb_agg(jsonb_build_object('signature', signature, 'discovery_depth', discovery_depth, 'discovery_reasons', discovery_reasons,
                                                           'effective_execute', effective_execute, 'security_definer', security_definer, 'volatility', provolatile, 'language', language,
                                                           'owner', owner, 'config', config, 'execute_grantees', execute_grantees, 'body_md5', body_md5, 'definition', definition) ORDER BY signature), '[]') FROM fmeta),
  'effective_table_privileges', (SELECT COALESCE(jsonb_agg(jsonb_build_object('table', relname, 'role', role, 'privilege', priv, 'on_table', on_table, 'on_any_column', on_any_column)
                                                 ORDER BY relname, role, priv), '[]') FROM effective_table_privs),
  'schema_privileges', (SELECT COALESCE(jsonb_agg(jsonb_build_object('role', role, 'public_usage', public_usage, 'public_create', public_create)), '[]') FROM schema_privs),
  'role_attributes',   (SELECT COALESCE(jsonb_agg(jsonb_build_object('role', rolname, 'superuser', rolsuper, 'bypassrls', rolbypassrls, 'inherit', rolinherit,
                                                           'can_login', rolcanlogin, 'member_of', member_of) ORDER BY rolname), '[]') FROM role_attrs),
  'default_privileges', (SELECT COALESCE(jsonb_agg(jsonb_build_object('for_objects_created_by', for_objects_created_by, 'object_type', object_type,
                                                           'grantee', grantee, 'privilege', privilege_type)), '[]') FROM default_privs),
  'storage_policies',  (SELECT COALESCE(jsonb_agg(jsonb_build_object('policy', policyname, 'permissive', permissive, 'roles', roles, 'command', cmd,
                                                           'using', qual, 'with_check', with_check) ORDER BY policyname), '[]') FROM storage_pols),
  'dependent_views', (SELECT COALESCE(jsonb_agg(jsonb_build_object('view', view_name, 'options', reloptions)), '[]') FROM dep_views),
  'sensitive_literal_flags', (SELECT COALESCE(jsonb_agg(jsonb_build_object('source', source, 'flags', flags)), '[]')
                              FROM literal_flags WHERE flags @> '{"email":true}' OR flags @> '{"jwt":true}' OR flags @> '{"long_token":true}'
                                 OR flags @> '{"url":true}' OR flags @> '{"uuid_literal":true}' OR flags @> '{"secret_word":true}')
)) AS tripp_d04c4_q1;

ROLLBACK;
