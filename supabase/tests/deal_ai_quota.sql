\set ON_ERROR_STOP on
DO $ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
\i supabase/migrations/20261024000000_deal_ai_quota.sql
DO $$
BEGIN
 IF has_table_privilege('authenticated', 'public.deal_ai_usage', 'SELECT') THEN RAISE EXCEPTION 'quota table exposed'; END IF;
 IF has_function_privilege('anon', 'public.consume_deal_ai_quota()', 'EXECUTE') THEN RAISE EXCEPTION 'anonymous quota access'; END IF;
 IF NOT has_function_privilege('authenticated', 'public.consume_deal_ai_quota()', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated quota unavailable'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
DO $$
DECLARE i integer;
BEGIN
 FOR i IN 1..10 LOOP
   IF public.consume_deal_ai_quota() IS DISTINCT FROM true THEN RAISE EXCEPTION 'quota rejected valid request %', i; END IF;
 END LOOP;
 IF public.consume_deal_ai_quota() IS DISTINCT FROM false THEN RAISE EXCEPTION '11th request allowed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
DO $$ BEGIN
 IF public.consume_deal_ai_quota() IS DISTINCT FROM true THEN RAISE EXCEPTION 'users do not have separate quotas'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count FROM public.deal_ai_usage WHERE user_id='11111111-1111-4111-8111-111111111111') <> 10 THEN RAISE EXCEPTION 'incorrect first user count'; END IF;
 IF (SELECT count FROM public.deal_ai_usage WHERE user_id='22222222-2222-4222-8222-222222222222') <> 1 THEN RAISE EXCEPTION 'incorrect second user count'; END IF;
END $$;
