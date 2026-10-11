import type { MembershipRole } from './organization';

/** True only for roles granted CREATE or UPDATE permissions on Deals. */
export const canManageDeals = (role: MembershipRole | null | undefined): boolean =>
  role === 'admin' || role === 'member';

/** Frontend presentation only; Supabase RLS enforces actual permissions. */
export const getDealPermission = (role: MembershipRole | null | undefined): 'read-only' | 'manageable' =>
  canManageDeals(role) ? 'manageable' : 'read-only';
