export interface DealGateDeps {
  authenticate(): Promise<string | null>;
  findDeal(): Promise<{ organization_id: string } | null>;
  isMember(organizationId: string, userId: string): Promise<boolean>;
  quota(): Promise<boolean>;
  provider(): Promise<string>;
}
export async function executeDealGate(deps: DealGateDeps): Promise<{status: number; analysis?: string}> {
  const user = await deps.authenticate();
  if (!user) return {status:401};
  const deal = await deps.findDeal();
  if (!deal) return {status:404};
  if (!await deps.isMember(deal.organization_id, user)) return {status:403};
  if (!await deps.quota()) return {status:429};
  return {status:200, analysis:await deps.provider()};
}
