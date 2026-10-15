-- TRIPP_BASELINE_UNPOPULATED
-- D04-C.4C staging baseline: production organizations / organization_memberships.
-- STAGING ONLY. Never part of supabase/migrations or any migration history.
--
-- This file must reproduce, without data, exactly what the founder's production Q1 artifact
-- shows for public.organizations and public.organization_memberships: columns, defaults,
-- constraints (including the membership role CHECK), indexes, RLS flags, every policy with
-- its USING / WITH CHECK expression, triggers and grants. It is intentionally unpopulated
-- until those Q1 sections are supplied; bootstrap.sh refuses to run while the marker on the
-- first line is present. Do not substitute the CI fixture (supabase/ci/bootstrap_organizations.sql),
-- which has no policies and is not equivalent to production.
DO $$ BEGIN
  RAISE EXCEPTION 'Staging org/membership baseline not yet populated from production Q1';
END $$;
