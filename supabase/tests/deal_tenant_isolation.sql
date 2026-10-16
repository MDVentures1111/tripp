\set ON_ERROR_STOP on
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
\i supabase/tests/fixtures/production_membership_baseline.sql
\i supabase/migrations/20261010000000_create_deals_v1.sql
INSERT INTO public.organizations(id,name,slug) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Organization A','organization-a'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Organization B','organization-b');
INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','member'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','member');
INSERT INTO public.deals(id,organization_id,deal_name,created_by,notes) VALUES
('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A confidential deal','11111111-1111-4111-8111-111111111111','A secret'),
('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B confidential deal','22222222-2222-4222-8222-222222222222','B secret');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.deals) <> 1 THEN RAISE EXCEPTION 'A sees cross-tenant deal'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.deals WHERE id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa') THEN RAISE EXCEPTION 'A own deal hidden'; END IF;
 IF EXISTS (SELECT 1 FROM public.deals WHERE id='bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb') THEN RAISE EXCEPTION 'A can request B deal by ID'; END IF;
 IF EXISTS (SELECT 1 FROM public.organization_memberships WHERE organization_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') THEN RAISE EXCEPTION 'A sees B membership'; END IF;
 IF EXISTS (SELECT 1 FROM public.organizations WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') THEN RAISE EXCEPTION 'A sees B organization'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.deals) <> 1 THEN RAISE EXCEPTION 'B sees cross-tenant deal'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.deals WHERE id='bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb') THEN RAISE EXCEPTION 'B own deal hidden'; END IF;
 IF EXISTS (SELECT 1 FROM public.deals WHERE id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa') THEN RAISE EXCEPTION 'B can request A deal by ID'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','',false);
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.deals) THEN RAISE EXCEPTION 'missing identity sees deals'; END IF;
END $$;
RESET ROLE;
