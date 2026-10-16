"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { DealDocuments } from './DealDocuments';
import { DealIntelligence } from './DealIntelligence';
import { useAuth } from '../context/AuthContext';
import { getDeal, updateDeal, DealValidationError } from '../lib/deals';
import { hasFieldErrors, isValidUuid, validateDealUpdate, type DealFieldErrors } from '../lib/dealValidation';
import { canManageDeals } from '../lib/permissions';
import { DEAL_STATUSES, DEAL_TYPES, type DealRow, type DealStatus, type DealType, type DealUpdateInput } from '../types/deals';

const TYPE_LABELS: Record<DealType, string> = {
  new_lease: 'New lease', renewal: 'Renewal', relocation: 'Relocation', expansion: 'Expansion',
};
const STATUS_LABELS: Record<DealStatus, string> = {
  active: 'Active', on_hold: 'On hold', completed: 'Completed', cancelled: 'Cancelled',
};

interface EditValues {
  deal_name: string;
  tenant_name: string;
  deal_type: DealType;
  status: DealStatus;
  market: string;
  target_square_feet: string;
  notes: string;
}
const fromDeal = (deal: DealRow): EditValues => ({
  deal_name: deal.deal_name,
  tenant_name: deal.tenant_name ?? '',
  deal_type: deal.deal_type,
  status: deal.status,
  market: deal.market ?? '',
  target_square_feet: deal.target_square_feet === null ? '' : String(deal.target_square_feet),
  notes: deal.notes ?? '',
});
const asUpdate = (values: EditValues): DealUpdateInput => ({
  deal_name: values.deal_name,
  tenant_name: values.tenant_name,
  deal_type: values.deal_type,
  status: values.status,
  market: values.market,
  target_square_feet: values.target_square_feet.trim() === '' ? null : Number(values.target_square_feet),
  notes: values.notes,
});
type LoadState =
  | { kind: 'loading'; scope: string }
  | { kind: 'error'; scope: string; message: string }
  | { kind: 'not-found'; scope: string }
  | { kind: 'ready'; scope: string; deal: DealRow };

const formatDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

export const DealWorkspace = () => {
  const { id } = useParams<{ id: string }>();
  const { resolvedOrgId, resolvedOrgRole } = useAuth();
  const scope = resolvedOrgId && id ? `${resolvedOrgId}:${id}` : null;
  const [reloadKey, setReloadKey] = useState(0);
  const [loadState, setLoadState] = useState<LoadState | null>(null);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<EditValues | null>(null);
  const [errors, setErrors] = useState<DealFieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const saveGeneration = useRef(0);

  useEffect(() => {
    saveGeneration.current += 1;
    savingRef.current = false;
    if (!resolvedOrgId || !id || !scope || !isValidUuid(id)) return;
    const controller = new AbortController();
    setLoadState({ kind: 'loading', scope });
    setEditing(false);
    setValues(null);
    setErrors({});
    setSaveError(null);
    setSaveSuccess(false);
    setSaving(false);
    void getDeal(resolvedOrgId, id, controller.signal)
      .then((deal) => {
        if (controller.signal.aborted) return;
        setLoadState(deal ? { kind: 'ready', scope, deal } : { kind: 'not-found', scope });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadState({
            kind: 'error',
            scope,
            message: error instanceof Error ? error.message : 'Unable to load the deal.',
          });
        }
      });
    return () => { controller.abort(); saveGeneration.current += 1; };
  }, [resolvedOrgId, id, scope, reloadKey]);

  const current = scope && loadState?.scope === scope ? loadState : null;
  const canManage = canManageDeals(resolvedOrgRole);
  const deal = current?.kind === 'ready' ? current.deal : null;

  const beginEdit = () => {
    if (!deal || !canManage) return;
    setValues(fromDeal(deal));
    setErrors({});
    setSaveError(null);
    setSaveSuccess(false);
    setEditing(true);
  };
  const cancelEdit = () => {
    if (savingRef.current) return;
    setEditing(false);
    setValues(null);
    setErrors({});
    setSaveError(null);
  };
  const change = <K extends keyof EditValues>(field: K, value: EditValues[K]) => {
    setValues((previous) => previous ? { ...previous, [field]: value } : previous);
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setSaveError(null);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current || !canManage || !resolvedOrgId || !id || !deal || !values) return;
    const input = asUpdate(values);
    const fieldErrors = validateDealUpdate(input);
    setErrors(fieldErrors);
    if (hasFieldErrors(fieldErrors)) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const generation = saveGeneration.current;
    try {
      const updated = await updateDeal(resolvedOrgId, id, input);
      if (generation !== saveGeneration.current) return;
      setLoadState({ kind: 'ready', scope: `${resolvedOrgId}:${id}`, deal: updated });
      setEditing(false);
      setValues(null);
      setSaveSuccess(true);
    } catch (error: unknown) {
      if (generation !== saveGeneration.current) return;
      if (error instanceof DealValidationError) setErrors(error.fieldErrors);
      setSaveError(error instanceof Error ? error.message : 'Unable to save the deal.');
    } finally {
      if (generation === saveGeneration.current) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };

  return (
    <div className="view-container tripp-workspace">
      <Link className="tripp-workspace-back" to="/workspace/deals"><ArrowLeft size={16} aria-hidden="true" /> All deals</Link>
      {!resolvedOrgId ? (
        <section className="tripp-deals-state" role="status"><h2>Organization unavailable</h2><p>Authorization is required to view this deal.</p></section>
      ) : !id || !isValidUuid(id) ? (
        <section className="tripp-deals-state" role="alert"><h2>Invalid deal link</h2><p>Return to Deals and choose a valid record.</p></section>
      ) : !current || current.kind === 'loading' ? (
        <section className="tripp-deals-state" role="status"><span className="spinner" aria-hidden="true" /><p>Loading deal…</p></section>
      ) : current.kind === 'error' ? (
        <section className="tripp-deals-state" role="alert"><h2>Unable to load deal</h2><p>{current.message}</p><button className="tripp-deals-action" type="button" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={16} aria-hidden="true" /> Retry</button></section>
      ) : current.kind === 'not-found' ? (
        <section className="tripp-deals-state"><h2>Deal not found</h2><p>This record does not exist or is not accessible to your organization.</p></section>
      ) : deal ? (
        <>
          <header className="tripp-workspace-header">
            <div>
              <p className="tripp-workspace-eyebrow">Tenant representation / Deal workspace</p>
              <h1 className="view-title">{deal.deal_name}</h1>
              <p className="view-subtitle">{deal.tenant_name || 'Tenant not specified'} · {TYPE_LABELS[deal.deal_type]}</p>
            </div>
            {canManage && !editing && <button className="tripp-deals-action" type="button" onClick={beginEdit}>Edit deal</button>}
          </header>
          {saveSuccess && !editing && <p className="tripp-workspace-success" role="status">Deal changes saved successfully.</p>}
          {editing && values && canManage ? (
            <section className="tripp-create-card" aria-labelledby="tripp-workspace-edit-title">
              <h2 id="tripp-workspace-edit-title">Edit deal details</h2>
              <form onSubmit={(event) => { void save(event); }} noValidate>
                <div className="tripp-create-grid">
                  <div className="tripp-create-field">
                    <label htmlFor="tripp-edit-name">Deal name *</label>
                    <input id="tripp-edit-name" required value={values.deal_name} onChange={(event) => change('deal_name', event.target.value)} aria-invalid={!!errors.deal_name} disabled={saving} />
                    {errors.deal_name && <span className="tripp-create-error">{errors.deal_name}</span>}
                  </div>
                  <div className="tripp-create-field">
                    <label htmlFor="tripp-edit-tenant">Tenant name</label>
                    <input id="tripp-edit-tenant" value={values.tenant_name} onChange={(event) => change('tenant_name', event.target.value)} disabled={saving} />
                  </div>
                  <div className="tripp-create-field">
                    <label htmlFor="tripp-edit-type">Deal type</label>
                    <select id="tripp-edit-type" value={values.deal_type} onChange={(event) => change('deal_type', event.target.value as DealType)} disabled={saving}>
                      {DEAL_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
                    </select>
                  </div>
                  <div className="tripp-create-field">
                    <label htmlFor="tripp-edit-status">Status</label>
                    <select id="tripp-edit-status" value={values.status} onChange={(event) => change('status', event.target.value as DealStatus)} disabled={saving}>
                      {DEAL_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                    </select>
                  </div>
                  <div className="tripp-create-field">
                    <label htmlFor="tripp-edit-market">Market</label>
                    <input id="tripp-edit-market" value={values.market} onChange={(event) => change('market', event.target.value)} disabled={saving} />
                  </div>
                  <div className="tripp-create-field">
                    <label htmlFor="tripp-edit-sf">Target square feet</label>
                    <input id="tripp-edit-sf" type="number" min="0.01" step="any" value={values.target_square_feet} onChange={(event) => change('target_square_feet', event.target.value)} aria-invalid={!!errors.target_square_feet} disabled={saving} />
                    {errors.target_square_feet && <span className="tripp-create-error">{errors.target_square_feet}</span>}
                  </div>
                  <div className="tripp-create-field tripp-create-full">
                    <label htmlFor="tripp-edit-notes">Notes</label>
                    <textarea id="tripp-edit-notes" rows={5} value={values.notes} onChange={(event) => change('notes', event.target.value)} disabled={saving} />
                  </div>
                </div>
                {saveError && <div className="tripp-create-submit-error" role="alert">{saveError}</div>}
                <div className="tripp-create-actions">
                  <button className="tripp-create-cancel" type="button" onClick={cancelEdit} disabled={saving}>Cancel</button>
                  <button className="tripp-deals-action" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
                </div>
              </form>
            </section>
          ) : (
            <section className="tripp-workspace-card" aria-labelledby="tripp-workspace-details">
              <div className="tripp-workspace-card-head"><h2 id="tripp-workspace-details">Deal details</h2>{!canManage && <span className="tripp-workspace-readonly">Read-only access</span>}</div>
              <dl className="tripp-workspace-facts">
                <div><dt>Tenant</dt><dd>{deal.tenant_name || '—'}</dd></div>
                <div><dt>Deal type</dt><dd>{TYPE_LABELS[deal.deal_type]}</dd></div>
                <div><dt>Status</dt><dd><span className={`tripp-deals-status tripp-deals-status--${deal.status}`}>{STATUS_LABELS[deal.status]}</span></dd></div>
                <div><dt>Market</dt><dd>{deal.market || '—'}</dd></div>
                <div><dt>Target square feet</dt><dd>{deal.target_square_feet === null ? '—' : new Intl.NumberFormat().format(deal.target_square_feet)}</dd></div>
                <div><dt>Last updated</dt><dd>{formatDate(deal.updated_at)}</dd></div>
                <div className="tripp-workspace-wide"><dt>Notes</dt><dd className="tripp-workspace-notes">{deal.notes || 'No notes recorded.'}</dd></div>
              </dl>
            </section>
          )}
          <DealIntelligence key={id} dealId={id} />
          <DealDocuments organizationId={resolvedOrgId} dealId={id} />
        </>
      ) : null}
    </div>
  );
};
