-- TRIPP D04-C.4  Q2 v1  OPTIONAL, SEPARATE AUTHORIZATION REQUIRED.
-- This query READS APPLICATION ROWS (organization_memberships, organizations, auth.users ids) but
-- returns ONLY aggregate counts: no ids, emails, names, tokens or per-tenant breakdown.
-- Executed as the dashboard role it is not subject to RLS; that is why it returns counts only.
-- Purpose: prove the data satisfies the backend's assumptions (valid roles, one membership per
-- (org,user), no orphans), which a catalog check cannot prove if constraints are missing.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
SELECT jsonb_pretty(jsonb_build_object(
  'tool', 'tripp-d04c4-q2',
  'role_values', (SELECT jsonb_object_agg(COALESCE(role::text, '<null>'), n)
                  FROM (SELECT role, count(*) AS n FROM public.organization_memberships GROUP BY role) r),
  'duplicate_org_user_pairs', (SELECT count(*) FROM (SELECT organization_id, user_id FROM public.organization_memberships
                               GROUP BY organization_id, user_id HAVING count(*) > 1) d),
  'null_org_or_user', (SELECT count(*) FROM public.organization_memberships WHERE organization_id IS NULL OR user_id IS NULL),
  'memberships_without_org', (SELECT count(*) FROM public.organization_memberships m
                              WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = m.organization_id)),
  'memberships_without_auth_user', (SELECT count(*) FROM public.organization_memberships m
                                    WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.user_id))
)) AS tripp_d04c4_q2;
ROLLBACK;
