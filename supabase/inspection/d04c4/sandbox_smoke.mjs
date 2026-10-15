import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path'; const here = path.dirname(new URL(import.meta.url).pathname); const R = path.resolve(here, '../../'), Q = here;
const db = new PGlite();
const run = async (label, sql) => { try { const r = await db.exec(sql); return r; } catch (e) { console.log('FAIL', label, e.message); throw e; } };
await run('stubs', `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT; GRANT anon, authenticated, service_role TO authenticator;
CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA supabase_migrations; CREATE SCHEMA extensions;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261010000000','create_deals_v1', ARRAY['SELECT ''secret-sql-should-not-appear''']);
`);
await run('bootstrap', fs.readFileSync(`${R}/ci/bootstrap_organizations.sql`,'utf8'));
for (const f of fs.readdirSync(`${R}/migrations`).sort()) {
  if (f.startsWith('20261022')) { console.log('skip (pg_cron/vault)', f); continue; }
  await run(f, fs.readFileSync(`${R}/migrations/${f}`,'utf8'));
}
// Hostile fixtures that Q1 must surface
await run('fixtures', `
CREATE FUNCTION public.org_role_of(p_org uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT role FROM public.organization_memberships WHERE organization_id = p_org AND user_id = auth.uid() $$;
CREATE FUNCTION public.is_org_member(p_org uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.org_role_of(p_org) IS NOT NULL $$;
CREATE POLICY om_select_own ON public.organization_memberships FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE FUNCTION public.join_org(p_org uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS
  $$ INSERT INTO public.organization_memberships VALUES (p_org, auth.uid(), 'admin') $$;
GRANT EXECUTE ON FUNCTION public.join_org(uuid) TO authenticated;
CREATE ROLE helper NOLOGIN; GRANT INSERT ON public.organization_memberships TO helper; GRANT helper TO authenticated;
CREATE POLICY om_insert_any ON public.organization_memberships FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY obj_admin ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'tripp-deal-documents' AND EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.user_id = auth.uid() AND m.role = 'admin'));
CREATE POLICY org_literal_probe ON public.organizations FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND 'ops@example.com' <> '');
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001','a@example.com');
INSERT INTO public.organizations VALUES ('10000000-0000-0000-0000-000000000001','Acme');
INSERT INTO public.organization_memberships VALUES ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','member');
`);
const out = {};
for (const q of ['q0_migration_history','q1_catalog_inspection','q2_membership_integrity_aggregates']) {
  const res = await run(q, fs.readFileSync(`${Q}/${q}.sql`,'utf8'));
  out[q] = res.filter(r => r.rows.length).map(r => Object.values(r.rows[0])[0]);
  fs.writeFileSync(`${process.env.OUT_DIR ?? '/tmp'}/${q}.out.txt`, out[q].join('\n'));
}
// Read-only proof: a write inside the same transaction pattern must fail
try { await db.exec(`BEGIN TRANSACTION READ ONLY; INSERT INTO public.organizations(name) VALUES ('x'); ROLLBACK;`); console.log('READONLY_GUARD: write SUCCEEDED (bad)'); }
catch (e) { console.log('READONLY_GUARD: write rejected ->', e.message); await db.exec('ROLLBACK'); }
const n = (await db.query(`SELECT count(*)::int c FROM public.organizations`)).rows[0].c;
console.log('org rows after all scripts:', n);
console.log(JSON.stringify(out, null, 0).length, 'bytes of output');
