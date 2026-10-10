import { supabase } from './supabase';
import {
  hasFieldErrors,
  validateDealCreate,
  validateDealUpdate,
  type DealFieldErrors,
} from './dealValidation';
import {
  DEFAULT_DEAL_STATUS,
  DEFAULT_DEAL_TYPE,
  type DealCreateInput,
  type DealRow,
  type DealUpdateInput,
} from '../types/deals';

/** Explicit column projection so responses stay aligned with `DealRow`. */
const DEAL_COLUMNS =
  'id, organization_id, deal_name, tenant_name, deal_type, status, market, target_square_feet, notes, created_by, created_at, updated_at';

/** Base error for any Deals data-access failure. */
export class DealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DealError';
  }
}

/** Raised when a scoped deal cannot be found (including RLS-blocked access). */
export class DealNotFoundError extends DealError {
  constructor(message = 'This deal could not be found.') {
    super(message);
    this.name = 'DealNotFoundError';
  }
}

/** Raised before submission when input violates the domain contract. */
export class DealValidationError extends DealError {
  readonly fieldErrors: DealFieldErrors;

  constructor(fieldErrors: DealFieldErrors) {
    super('The deal details are invalid.');
    this.name = 'DealValidationError';
    this.fieldErrors = fieldErrors;
  }
}

/** Trims text and converts blank values to null for nullable columns. */
const normalizeOptionalText = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

/**
 * Builds an INSERT payload from trusted scope plus validated form values.
 * `organization_id` is injected by the service and `created_by` is omitted so
 * the database default (`auth.uid()`) applies.
 */
const buildInsertPayload = (organizationId: string, input: DealCreateInput) => ({
  organization_id: organizationId,
  deal_name: input.deal_name.trim(),
  tenant_name: normalizeOptionalText(input.tenant_name),
  deal_type: input.deal_type ?? DEFAULT_DEAL_TYPE,
  status: input.status ?? DEFAULT_DEAL_STATUS,
  market: normalizeOptionalText(input.market),
  target_square_feet: input.target_square_feet ?? null,
  notes: normalizeOptionalText(input.notes),
});

/**
 * Builds an UPDATE payload containing only supplied, mutable business fields.
 * Immutable columns are never read from the input, so they cannot be sent.
 */
const buildUpdatePayload = (input: DealUpdateInput): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};

  if ('deal_name' in input && input.deal_name !== undefined) {
    payload.deal_name = input.deal_name.trim();
  }
  if ('tenant_name' in input) {
    payload.tenant_name = normalizeOptionalText(input.tenant_name);
  }
  if ('deal_type' in input && input.deal_type !== undefined) {
    payload.deal_type = input.deal_type;
  }
  if ('status' in input && input.status !== undefined) {
    payload.status = input.status;
  }
  if ('market' in input) {
    payload.market = normalizeOptionalText(input.market);
  }
  if ('target_square_feet' in input) {
    payload.target_square_feet = input.target_square_feet ?? null;
  }
  if ('notes' in input) {
    payload.notes = normalizeOptionalText(input.notes);
  }

  return payload;
};

/**
 * Lists deals for a single organization, newest first.
 * The organization scope is always applied as an explicit filter.
 */
export async function listDeals(
  organizationId: string,
  signal?: AbortSignal,
): Promise<DealRow[]> {
  const request = supabase
    .from('deals')
    .select(DEAL_COLUMNS)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });

  const { data, error } = signal ? await request.abortSignal(signal) : await request;

  if (error) throw new DealError(error.message);

  return (data ?? []) as DealRow[];
}

/**
 * Fetches a single deal scoped to both its id and organization.
 * Returns null when no matching row is visible to the caller.
 */
export async function getDeal(
  organizationId: string,
  dealId: string,
  signal?: AbortSignal,
): Promise<DealRow | null> {
  const request = supabase
    .from('deals')
    .select(DEAL_COLUMNS)
    .eq('id', dealId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  const { data, error } = signal ? await request.abortSignal(signal) : await request;

  if (error) throw new DealError(error.message);

  return (data as DealRow | null) ?? null;
}

/**
 * Creates a deal inside the authorized organization.
 * `organization_id` comes from trusted scope; `created_by` uses the database default.
 */
export async function createDeal(
  organizationId: string,
  input: DealCreateInput,
): Promise<DealRow> {
  const fieldErrors = validateDealCreate(input);
  if (hasFieldErrors(fieldErrors)) {
    throw new DealValidationError(fieldErrors);
  }

  const { data, error } = await supabase
    .from('deals')
    .insert(buildInsertPayload(organizationId, input))
    .select(DEAL_COLUMNS)
    .single();

  if (error) throw new DealError(error.message);
  if (!data) throw new DealError('The deal could not be created.');

  return data as DealRow;
}

/**
 * Updates mutable fields on a deal scoped to both its id and organization.
 * Immutable columns are never included in the payload, and a no-op or
 * RLS-blocked update is surfaced as an error rather than silent success.
 */
export async function updateDeal(
  organizationId: string,
  dealId: string,
  input: DealUpdateInput,
): Promise<DealRow> {
  const fieldErrors = validateDealUpdate(input);
  if (hasFieldErrors(fieldErrors)) {
    throw new DealValidationError(fieldErrors);
  }

  const payload = buildUpdatePayload(input);
  if (Object.keys(payload).length === 0) {
    throw new DealError('No changes were provided to save.');
  }

  const { data, error } = await supabase
    .from('deals')
    .update(payload)
    .eq('id', dealId)
    .eq('organization_id', organizationId)
    .select(DEAL_COLUMNS)
    .maybeSingle();

  if (error) throw new DealError(error.message);
  if (!data) throw new DealNotFoundError();

  return data as DealRow;
}