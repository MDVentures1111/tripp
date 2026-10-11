"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createDeal, DealValidationError } from '../lib/deals';
import { hasFieldErrors, validateDealCreate, type DealFieldErrors } from '../lib/dealValidation';
import { DEAL_STATUSES, DEAL_TYPES, type DealCreateInput, type DealStatus, type DealType } from '../types/deals';

const TYPE_LABELS: Record<DealType, string> = {
  new_lease: 'New lease',
  renewal: 'Renewal',
  relocation: 'Relocation',
  expansion: 'Expansion',
};
const STATUS_LABELS: Record<DealStatus, string> = {
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

interface FormValues {
  deal_name: string;
  tenant_name: string;
  deal_type: DealType;
  status: DealStatus;
  market: string;
  target_square_feet: string;
  notes: string;
}

const INITIAL_VALUES: FormValues = {
  deal_name: '',
  tenant_name: '',
  deal_type: 'new_lease',
  status: 'active',
  market: '',
  target_square_feet: '',
  notes: '',
};

interface CreateDealFormProps {
  organizationId: string;
  onCancel: () => void;
}

export const CreateDealForm = ({ organizationId, onCancel }: CreateDealFormProps) => {
  const navigate = useNavigate();
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<DealFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const update = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setSubmitError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;

    const input: DealCreateInput = {
      deal_name: values.deal_name,
      tenant_name: values.tenant_name,
      deal_type: values.deal_type,
      status: values.status,
      market: values.market,
      target_square_feet: values.target_square_feet.trim() === '' ? null : Number(values.target_square_feet),
      notes: values.notes,
    };
    const fieldErrors = validateDealCreate(input);
    setErrors(fieldErrors);
    if (hasFieldErrors(fieldErrors)) return;

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const deal = await createDeal(organizationId, input);
      if (mountedRef.current) navigate(`/workspace/deals/${deal.id}`);
    } catch (error: unknown) {
      if (!mountedRef.current) return;
      if (error instanceof DealValidationError) setErrors(error.fieldErrors);
      setSubmitError(error instanceof Error ? error.message : 'The deal could not be saved. Please try again.');
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <section className="tripp-create-card" aria-labelledby="tripp-create-title">
      <header className="tripp-create-heading">
        <div>
          <h2 id="tripp-create-title">Create a tenant-representation deal</h2>
          <p>Start a deal record for document review and future lease intelligence.</p>
        </div>
      </header>
      <form onSubmit={(event) => { void handleSubmit(event); }} noValidate>
        <div className="tripp-create-grid">
          <div className="tripp-create-field">
            <label htmlFor="tripp-create-name">Deal name <span aria-hidden="true">*</span></label>
            <input id="tripp-create-name" autoFocus required maxLength={200} value={values.deal_name} onChange={(event) => update('deal_name', event.target.value)} aria-invalid={!!errors.deal_name} aria-describedby={errors.deal_name ? 'tripp-error-name' : undefined} disabled={submitting} placeholder="e.g., Charlotte headquarters relocation" />
            {errors.deal_name && <span id="tripp-error-name" className="tripp-create-error">{errors.deal_name}</span>}
          </div>
          <div className="tripp-create-field">
            <label htmlFor="tripp-create-tenant">Tenant name</label>
            <input id="tripp-create-tenant" value={values.tenant_name} onChange={(event) => update('tenant_name', event.target.value)} disabled={submitting} placeholder="Tenant or prospect" />
          </div>
          <div className="tripp-create-field">
            <label htmlFor="tripp-create-type">Deal type</label>
            <select id="tripp-create-type" value={values.deal_type} onChange={(event) => update('deal_type', event.target.value as DealType)} disabled={submitting}>
              {DEAL_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
            </select>
          </div>
          <div className="tripp-create-field">
            <label htmlFor="tripp-create-status">Status</label>
            <select id="tripp-create-status" value={values.status} onChange={(event) => update('status', event.target.value as DealStatus)} disabled={submitting}>
              {DEAL_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
            </select>
          </div>
          <div className="tripp-create-field">
            <label htmlFor="tripp-create-market">Market</label>
            <input id="tripp-create-market" value={values.market} onChange={(event) => update('market', event.target.value)} disabled={submitting} placeholder="e.g., Charlotte, NC" />
          </div>
          <div className="tripp-create-field">
            <label htmlFor="tripp-create-sf">Target square feet</label>
            <input id="tripp-create-sf" type="number" min="0.01" step="any" inputMode="decimal" value={values.target_square_feet} onChange={(event) => update('target_square_feet', event.target.value)} aria-invalid={!!errors.target_square_feet} aria-describedby={errors.target_square_feet ? 'tripp-error-sf' : undefined} disabled={submitting} placeholder="e.g., 25000" />
            {errors.target_square_feet && <span id="tripp-error-sf" className="tripp-create-error">{errors.target_square_feet}</span>}
          </div>
          <div className="tripp-create-field tripp-create-full">
            <label htmlFor="tripp-create-notes">Initial notes</label>
            <textarea id="tripp-create-notes" rows={4} value={values.notes} onChange={(event) => update('notes', event.target.value)} disabled={submitting} placeholder="Initial tenant requirements, opportunity context, or next steps" />
          </div>
        </div>
        {submitError && <div className="tripp-create-submit-error" role="alert">{submitError}</div>}
        <div className="tripp-create-actions">
          <button type="button" className="tripp-create-cancel" onClick={onCancel} disabled={submitting}>Cancel</button>
          <button type="submit" className="tripp-deals-action" disabled={submitting}>{submitting ? 'Creating deal…' : 'Create Deal'}</button>
        </div>
      </form>
    </section>
  );
};
