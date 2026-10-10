import {
  DEAL_STATUSES,
  DEAL_TYPES,
  isDealStatus,
  isDealType,
  type DealCreateInput,
  type DealMutableField,
  type DealUpdateInput,
} from '../types/deals';

/** Field-keyed validation messages keyed by editable business field. */
export type DealFieldErrors = Partial<Record<DealMutableField, string>>;

/** Returns an error message when a deal name is missing or blank. */
export const validateDealName = (value: string | null | undefined): string | undefined => {
  if (value === null || value === undefined || value.trim().length === 0) {
    return 'Deal name is required.';
  }
  return undefined;
};

/** Returns an error message when square footage is present but not positive. */
export const validateTargetSquareFeet = (value: number | null | undefined): string | undefined => {
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

  return errors;
}

/** Validates an update payload, checking only the fields that were supplied. */
export function validateDealUpdate(input: DealUpdateInput): DealFieldErrors {
  const errors: DealFieldErrors = {};

  if ('deal_name' in input) {
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

  if ('target_square_feet' in input) {
    const squareFeetError = validateTargetSquareFeet(input.target_square_feet);
    if (squareFeetError) errors.target_square_feet = squareFeetError;
  }

  return errors;
}

/** True when at least one field-level validation message is present. */
export const hasFieldErrors = (errors: DealFieldErrors): boolean => Object.keys(errors).length > 0;