-- CI-only minimal org prerequisites; NOT a production migration.
-- Applied before versioned migrations in isolated GitHub runner via supabase/seed.sql? No.
CREATE TABLE IF NOT EXISTS public.organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.organization_memberships (
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 role text NOT NULL CHECK (role IN ('admin','member','viewer')),
 PRIMARY KEY (organization_id,user_id)
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
-- This fixture deliberately avoids claims about equivalence to live production policies.
