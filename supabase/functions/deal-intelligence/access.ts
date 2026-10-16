export function isAuthorizedForDeal(dealOrganizationId: string, memberships: readonly string[]): boolean {
  return memberships.includes(dealOrganizationId);
}
