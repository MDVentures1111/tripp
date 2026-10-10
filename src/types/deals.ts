/**
 * Deal domain contracts for TRIPP Intelligence V1.
 *
 * These types mirror the verified `public.deals` schema. Database-managed
 * columns are documented separately from client-editable business fields so
 * callers cannot accidentally transmit immutable values.
 */

/** Enumerated deal types permitted by the database contract. */
export const DEAL_TYPES = ['new_lease', 'renewal', 'relocation', 'expansion'] as const;
export type DealType = (typeof DEAL_TYPES)[number];

/** Enumerated deal statuses permitted by the database contract. */
export const DEAL_STATUSES = ['active', 'on_hold', 'completed', 'cancelled'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

/** Database defaults applied when the client omits a value. */
export const DEFAULT_DEAL_TYPE: DealType = 'new_lease';
export const DEFAULT_DEAL_STATUS: DealStatus = 'active';

/**
 * Columns owned by the database. Clients must never send these values;
 * `created_by` in particular falls back to `auth.uid()` at insert time.
 */
export type DealImmutableField =
  | 'id'
  | 'organization_id'
  | 'created_by'
  | 'created_at'
  | 'updated_at';

/** Business fields a client is allowed to write. */
export type DealMutableField =
  | 'deal_name'
  | 'tenant_name'
  | 'deal_type'
  | 'status'
  | 'market'
  | 'target_square_feet'
  | 'notes';

/** A complete deal row exactly as returned by Supabase. */
export interface DealRow {
  id: string;
  organization_id: string;
  deal_name: string;
  tenant_name: string | null;
  deal_type: DealType;
  status: DealStatus;
  market: string | null;
  target_square_feet: number | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * Input accepted by `createDeal`. The organization scope and `created_by`
 * are supplied by the data-access layer, never by the caller's form.
 */
export interface DealCreateInput {
  deal_name: string;
  tenant_name?: string | null;
  deal_type?: DealType;
  status?: DealStatus;
  market?: string | null;
  target_square_feet?: number | null;
  notes?: string | null;
}

/**
 * Partial update restricted to mutable business fields. Immutable columns
 * (`id`, `organization_id`, `created_by`, `created_at`) are intentionally
 * excluded so they can never be part of an UPDATE payload.
 */
export type DealUpdateInput = Partial<Pick<DealRow, DealMutableField>>;

export const isDealType = (value: unknown): value is DealType =>
  typeof value === 'string' && (DEAL_TYPES as readonly string[]).includes(value);

export const isDealStatus = (value: unknown): value is DealStatus =>
  typeof value === 'string' && (DEAL_STATUSES as readonly string[]).includes(value);