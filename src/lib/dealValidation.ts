import {
  DEAL_STATUSES,
  DEAL_TYPES,
  isDealStatus,
  isDealType,
  type DealCreateInput,
  type DealMutableField,
  type DealUpdateInput,
} from '../types/deals';

/** UUID pattern (v1–v5, case-insensitive) used to validate identifiers. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the value is a syntactically valid UUID string. */
export const isValidUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

/** Field-keyed validation messages keyed by editable business field. */
export type DealFieldErrors = Partial<Record<DealMutableField, string>>;

/**
 * Returns an error message when a deal name is missing, blank, or not text.
 * Accepts `unknown` so null, undefined, and non-string runtime values are
 * rejected safely instead of throwing on `.trim()`.
 */
export const validateDealName = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'Deal name is required.';
  }
  return undefined;
};

/**
 * Returns an error message when square footage is present but not a finite,
 * positive number. Accepts `unknown` so non-numeric runtime values (strings,
 * booleans, NaN, Infinity) are rejected safely. Absent values pass.
 */
export const validateTargetSquareFeet = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Square footage must be a number.';
  }
  if (value <= 0) {
    return 'Square footage must be greater than zero.';
  }
  return undefined;
};

/** Returns an error message when a deal type is outside the allowed set. */
export const validateDealType = (value: unknown): string | undefined => {
  if (!isDealType(value)) {
    return `Deal type must be one of: ${DEAL_TYPES.join(', ')}.`;
  }
  return undefined;
};

/** Returns an error message when a status is outside the allowed set. */
export const validateDealStatus = (value: unknown): string | undefined => {
  if (!isDealStatus(value)) {
    return `Status must be one of: ${DEAL_STATUSES.join(', ')}.`;
  }
  return undefined;
};

/**
 * Returns an error message when a nullable text field is neither text, `null`,
 * nor `undefined`. Blank strings are permitted and normalized to `null` by the
 * data layer. Unexpected runtime types (numbers, booleans, objects, arrays) are
 * rejected rather than silently coerced to `null`.
 */
export const validateOptionalText = (value: unknown, label: string): string | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return `${label} must be text.`;
  return undefined;
};

/** Validates a creation payload. An empty result means the input is valid. */
export function validateDealCreate(input: DealCreateInput): DealFieldErrors {
  const errors: DealFieldErrors = {};

  const nameError = validateDealName(input.deal_name);
  if (nameError) errors.deal_name = nameError;

  if (input.deal_type !== undefined) {
    const typeError = validateDealType(input.deal_type);
    if (typeError) errors.deal_type = typeError;
  }

  if (input.status !== undefined) {
    const statusError = validateDealStatus(input.status);
    if (statusError) errors.status = statusError;
  }

  const squareFeetError = validateTargetSquareFeet(input.target_square_feet);
  if (squareFeetError) errors.target_square_feet = squareFeetError;

  const tenantNameError = validateOptionalText(input.tenant_name, 'Tenant name');
  if (tenantNameError) errors.tenant_name = tenantNameError;

  const marketError = validateOptionalText(input.market, 'Market');
  if (marketError) errors.market = marketError;

  const notesError = validateOptionalText(input.notes, 'Notes');
  if (notesError) errors.notes = notesError;

  return errors;
}

/** Validates an update payload, checking only the fields that were supplied. */
export function validateDealUpdate(input: DealUpdateInput): DealFieldErrors {
  const errors: DealFieldErrors = {};

  if (input.deal_name !== undefined) {
    const nameError = validateDealName(input.deal_name);
    if (nameError) errors.deal_name = nameError;
  }

  if (input.deal_type !== undefined) {
    const typeError = validateDealType(input.deal_type);
    if (typeError) errors.deal_type = typeError;
  }

  if (input.status !== undefined) {
    const statusError = validateDealStatus(input.status);
    if (statusError) errors.status = statusError;
  }

  if (input.target_square_feet !== undefined) {
    const squareFeetError = validateTargetSquareFeet(input.target_square_feet);
    if (squareFeetError) errors.target_square_feet = squareFeetError;
  }

  const tenantNameError = validateOptionalText(input.tenant_name, 'Tenant name');
  if (tenantNameError) errors.tenant_name = tenantNameError;

  const marketError = validateOptionalText(input.market, 'Market');
  if (marketError) errors.market = marketError;

  const notesError = validateOptionalText(input.notes, 'Notes');
  if (notesError) errors.notes = notesError;

  return errors;
}

/** True when at least one field-level validation message is present. */
export const hasFieldErrors = (errors: DealFieldErrors): boolean => Object.keys(errors).length > 0;