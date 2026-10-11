import { supabase } from './supabase';

export const VALID_ROLES = ['admin', 'member', 'viewer'] as const;
export type MembershipRole = (typeof VALID_ROLES)[number];

export type OrganizationResolution =
  | { status: 'authorized'; orgId: string; orgName: string; orgRole: MembershipRole }
  | { status: 'restricted' }
  | { status: 'error'; message: string };

/**
 * Verifies that the given user has a membership AND a matching organization record.
 * The user id is passed explicitly so the result never depends on React state.
 */
export async function resolveOrganization(
  userId: string,
  signal: AbortSignal
): Promise<OrganizationResolution> {
  const { data: memberships, error: membershipError } = await supabase
    .from('organization_memberships')
    .select('organization_id, role')
    .eq('user_id', userId)
    .abortSignal(signal);

  if (membershipError) {
    return { status: 'error', message: membershipError.message };
  }

  const validMemberships = (memberships ?? []).filter(
    (m: { organization_id: string | null; role: unknown }) =>
      Boolean(m.organization_id) && VALID_ROLES.includes(m.role as MembershipRole)
  );
  const orgIds: string[] = validMemberships.map(
    (m: { organization_id: string | null }) => m.organization_id as string
  );

  if (orgIds.length === 0) {
    return { status: 'restricted' };
  }

  const { data: orgs, error: orgError } = await supabase
    .from('organizations')
    .select('id, name')
    .in('id', orgIds)
    .abortSignal(signal);

  if (orgError) {
    return { status: 'error', message: orgError.message };
  }

  const org = (orgs ?? []).find((o: { id: string }) => orgIds.includes(o.id));
  if (!org) {
    return { status: 'restricted' };
  }

  const membershipRecord = validMemberships.find(
    (m: { organization_id: string | null }) => m.organization_id === org.id
  );
  if (!membershipRecord) return { status: 'restricted' };

  return { status: 'authorized', orgId: org.id, orgName: org.name, orgRole: membershipRecord.role as MembershipRole };
}