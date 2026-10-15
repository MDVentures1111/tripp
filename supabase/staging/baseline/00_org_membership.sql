-- D04-C.4D: staging-only baseline from verified production Q1, 2026-10-15.
-- Q1 SHA256: 890879ec678f655f5b7317b4d25becd132e1e93a3bde0d962cd185370d59c2b1
-- Never run against production. Do not include in versioned migrations.
BEGIN;
CREATE TABLE public.organizations (
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 name text NOT NULL,
 slug text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT organizations_pkey PRIMARY KEY (id),
 CONSTRAINT organizations_slug_key UNIQUE (slug),
 CONSTRAINT organizations_name_check CHECK (length(btrim(name)) > 0),
 CONSTRAINT organizations_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
CREATE TABLE public.organization_memberships (
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 user_id uuid NOT NULL,
 role text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT organization_memberships_pkey PRIMARY KEY (id),
 CONSTRAINT organization_memberships_organization_id_user_id_key UNIQUE (organization_id,user_id),
 CONSTRAINT organization_memberships_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
 CONSTRAINT organization_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
 CONSTRAINT organization_memberships_role_check CHECK (role IN ('admin','member','viewer'))
);
CREATE INDEX organization_memberships_user_idx ON public.organization_memberships USING btree (user_id,organization_id);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY organizations_select_member ON public.organizations AS PERMISSIVE FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=organizations.id AND m.user_id=(SELECT auth.uid())));
CREATE POLICY memberships_select_self ON public.organization_memberships AS PERMISSIVE FOR SELECT TO authenticated
 USING (user_id=(SELECT auth.uid()));
REVOKE ALL ON TABLE public.organizations FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.organization_memberships FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.organizations TO authenticated;
GRANT SELECT ON TABLE public.organization_memberships TO authenticated;
GRANT ALL ON TABLE public.organizations TO service_role;
GRANT ALL ON TABLE public.organization_memberships TO service_role;
COMMIT;
