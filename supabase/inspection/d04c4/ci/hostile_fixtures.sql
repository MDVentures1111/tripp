-- D04-C.4A.2  CI-ONLY hostile fixtures. Applied ONLY to the disposable GitHub Actions Supabase stack.
-- Never applied to any hosted project. They deliberately create insecure objects that Q1 must surface,
-- plus TRIPWIRE functions that raise if anything executes them.
\set ON_ERROR_STOP on
BEGIN;

-- Tripwires: any execution of these aborts the statement with a recognisable message.
CREATE FUNCTION public.ci_tripwire_policy(p uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS
$$ BEGIN RAISE EXCEPTION 'TRIPWIRE_EXECUTED: ci_tripwire_policy'; END $$;
CREATE FUNCTION public.ci_tripwire_default() RETURNS text LANGUAGE plpgsql VOLATILE AS
$$ BEGIN RAISE EXCEPTION 'TRIPWIRE_EXECUTED: ci_tripwire_default'; END $$;
CREATE FUNCTION public.ci_tripwire_trigger() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'TRIPWIRE_EXECUTED: ci_tripwire_trigger'; END $$;
ALTER TABLE public.organizations ADD COLUMN ci_probe text DEFAULT public.ci_tripwire_default();
CREATE TRIGGER ci_tripwire_trg BEFORE DELETE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.ci_tripwire_trigger();
CREATE POLICY ci_tripwire_select ON public.organizations AS RESTRICTIVE FOR SELECT TO anon USING (public.ci_tripwire_policy(id));

-- Positive control for function-call statistics (plpgsql is never inlined).
CREATE FUNCTION public.ci_stats_probe() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END $$;

-- Self-escalation RPC (SECURITY DEFINER, writes memberships, executable by authenticated).
CREATE FUNCTION public.ci_join_org(p_org uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS
$$ INSERT INTO public.organization_memberships (organization_id, user_id, role) VALUES (p_org, auth.uid(), 'admin') $$;
GRANT EXECUTE ON FUNCTION public.ci_join_org(uuid) TO authenticated;

-- Policy helper chain: policy -> ci_is_member() -> ci_member_role() (depth 1, no table name in ci_is_member).
CREATE FUNCTION public.ci_member_role(p_org uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS
$$ SELECT role FROM public.organization_memberships WHERE organization_id = p_org AND user_id = auth.uid() $$;
CREATE FUNCTION public.ci_is_member(p_org uuid) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT public.ci_member_role(p_org) IS NOT NULL $$;
CREATE POLICY ci_om_select_helper ON public.organization_memberships FOR SELECT TO authenticated USING (public.ci_is_member(organization_id));
-- Pure transitive helper: reachable only through ci_policy_entry() (no table names in either body).
CREATE FUNCTION public.ci_leaf_helper() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.ci_policy_entry(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.ci_leaf_helper() $$;
CREATE POLICY ci_deals_entry ON public.deals AS RESTRICTIVE FOR SELECT TO anon USING (public.ci_policy_entry(id));

-- Permissive write policy on memberships.
CREATE POLICY ci_om_insert_any ON public.organization_memberships FOR INSERT TO authenticated WITH CHECK (true);
-- Privilege inherited through a granted role. deals has DELETE revoked from authenticated by migration
-- 20261010, so a direct-ACL reader sees no DELETE while the effective privilege is true.
CREATE ROLE ci_helper_role NOLOGIN;
GRANT DELETE ON public.deals TO ci_helper_role;
GRANT ci_helper_role TO authenticated;

-- Storage policy consulting memberships.
CREATE POLICY ci_storage_admin_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'tripp-deal-documents' AND EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.user_id = auth.uid() AND m.role = 'admin'));

-- Sensitive literal probes (synthetic values).
CREATE POLICY ci_literal_probe ON public.organizations AS RESTRICTIVE FOR UPDATE TO anon
  USING ('ops@example.com' <> '' AND 'https://example.invalid/hook' <> ''
         AND 'eyJhbGciOiJIUzI1NiJ9.ci-synthetic-token' <> '' AND 'api_key' <> ''
         AND id <> '00000000-0000-4000-8000-00000000c1c1');

-- Known limitation probe: dynamic SQL hides the table name from text discovery.
CREATE FUNCTION public.ci_dynamic_writer(p_org uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS
$$ BEGIN EXECUTE format('INSERT INTO public.%I (organization_id, user_id, role) VALUES ($1, auth.uid(), %L)', 'organization_' || 'memberships', 'admin') USING p_org; END $$;
GRANT EXECUTE ON FUNCTION public.ci_dynamic_writer(uuid) TO authenticated;

-- Known false-positive probe: table name only in a comment.
CREATE FUNCTION public.ci_comment_only() RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT 1 /* mentions deals */ $$;

-- Synthetic data for Q2 (explicit ci_probe so the tripwire default is not evaluated).
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
 ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ci-a1@example.test'),
 ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ci-a2@example.test'),
 ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ci-a3@example.test');
INSERT INTO public.organizations (id, name, ci_probe) VALUES
 ('00000000-0000-4000-8000-0000000000b1', 'CI Org One', 'x'),
 ('00000000-0000-4000-8000-0000000000b2', 'CI Org Two', 'x');
INSERT INTO public.organization_memberships (organization_id, user_id, role) VALUES
 ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'admin'),
 ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a2', 'member'),
 ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a3', 'viewer');
COMMIT;
