"use client";

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BriefcaseBusiness, Search, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { listDeals } from '../lib/deals';
import { canManageDeals } from '../lib/permissions';
import { DEAL_STATUSES, DEAL_TYPES, type DealRow, type DealStatus, type DealType } from '../types/deals';

const STATUS_LABELS: Record<DealStatus, string> = {
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const TYPE_LABELS: Record<DealType, string> = {
  new_lease: 'New lease',
  renewal: 'Renewal',
  relocation: 'Relocation',
  expansion: 'Expansion',
};

type LoadState =
  | { kind: 'loading'; orgId: string }
  | { kind: 'success'; orgId: string; deals: DealRow[] }
  | { kind: 'error'; orgId: string; message: string };

const formatSquareFeet = (value: number | null): string =>
  value === null ? '—' : new Intl.NumberFormat().format(value);

const formatUpdated = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};

export const DealsView = () => {
  const { resolvedOrgId, resolvedOrgRole } = useAuth();
  const [loadState, setLoadState] = useState<LoadState | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState<DealStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<DealType | 'all'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!resolvedOrgId) return;
    const orgId = resolvedOrgId;
    const controller = new AbortController();
    setLoadState({ kind: 'loading', orgId });

    void listDeals(orgId, controller.signal)
      .then((deals) => {
        if (!controller.signal.aborted) {
          setLoadState({ kind: 'success', orgId, deals });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadState({
            kind: 'error',
            orgId,
            message: error instanceof Error ? error.message : 'Unable to load deals. Please try again.',
          });
        }
      });

    return () => controller.abort();
  }, [resolvedOrgId, reloadKey]);

  // Never render data from a different organization, even for one render
  // while the effect for a changed organization has not yet executed.
  const current = resolvedOrgId && loadState?.orgId === resolvedOrgId ? loadState : null;
  const deals = current?.kind === 'success' ? current.deals : [];
  const normalizedSearch = search.trim().toLocaleLowerCase();

  const filteredDeals = useMemo(
    () => deals.filter((deal) =>
      (statusFilter === 'all' || deal.status === statusFilter) &&
      (typeFilter === 'all' || deal.deal_type === typeFilter) &&
      (!normalizedSearch ||
        [deal.deal_name, deal.tenant_name, deal.market]
          .some((value) => value?.toLocaleLowerCase().includes(normalizedSearch))),
    ),
    [deals, statusFilter, typeFilter, normalizedSearch],
  );

  const filtersActive = statusFilter !== 'all' || typeFilter !== 'all' || normalizedSearch.length > 0;
  const canManage = canManageDeals(resolvedOrgRole);

  const clearFilters = () => {
    setStatusFilter('all');
    setTypeFilter('all');
    setSearch('');
  };

  return (
    <div className="view-container tripp-deals">
      <header className="tripp-deals-header">
        <div>
          <h1 className="view-title">Deals</h1>
          <p className="view-subtitle">Tenant-representation opportunities for your organization.</p>
        </div>
        {canManage && (
          <span className="tripp-deals-upcoming" aria-label="Deal creation is planned for the next milestone">
            Create Deal — coming next
          </span>
        )}
      </header>

      {resolvedOrgId && (
        <div className="tripp-deals-filters" role="search" aria-label="Filter deals">
          <div className="tripp-deals-search">
            <Search size={17} aria-hidden="true" />
            <label className="tripp-deals-sr-only" htmlFor="tripp-deals-search">Search deals</label>
            <input
              id="tripp-deals-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search deal, tenant, or market"
            />
          </div>
          <div>
            <label className="tripp-deals-sr-only" htmlFor="tripp-deals-status">Deal status</label>
            <select id="tripp-deals-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as DealStatus | 'all')}>
              <option value="all">All statuses</option>
              {DEAL_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
            </select>
          </div>
          <div>
            <label className="tripp-deals-sr-only" htmlFor="tripp-deals-type">Deal type</label>
            <select id="tripp-deals-type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as DealType | 'all')}>
              <option value="all">All deal types</option>
              {DEAL_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
            </select>
          </div>
        </div>
      )}

      {!resolvedOrgId ? (
        <section className="tripp-deals-state" role="status">
          <h2>Organization unavailable</h2>
          <p>Deal information is available only after your organization has been authorized.</p>
        </section>
      ) : !current || current.kind === 'loading' ? (
        <section className="tripp-deals-state" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <p>Loading organization deals…</p>
        </section>
      ) : current.kind === 'error' ? (
        <section className="tripp-deals-state" role="alert">
          <h2>Deals could not be loaded</h2>
          <p>{current.message}</p>
          <button type="button" className="tripp-deals-action" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCw size={16} aria-hidden="true" /> Retry loading
          </button>
        </section>
      ) : (
        <>
          <div className="tripp-deals-results" role="status">
            <span>{filteredDeals.length} of {deals.length} deals</span>
            {filtersActive && (
              <button type="button" className="tripp-deals-clear" onClick={clearFilters}>Clear filters</button>
            )}
          </div>

          {deals.length === 0 ? (
            <section className="tripp-deals-state">
              <BriefcaseBusiness size={38} aria-hidden="true" />
              <h2>No deals yet</h2>
              <p>Deals created for this organization will appear here.</p>
            </section>
          ) : filteredDeals.length === 0 ? (
            <section className="tripp-deals-state">
              <Search size={34} aria-hidden="true" />
              <h2>No matching deals</h2>
              <p>Adjust your search or filters to find another opportunity.</p>
              <button type="button" className="tripp-deals-action" onClick={clearFilters}>Clear filters</button>
            </section>
          ) : (
            <div className="tripp-deals-list" aria-label="Organization deals">
              <div className="tripp-deals-columns" aria-hidden="true">
                <span>Deal</span><span>Tenant</span><span>Type</span><span>Status</span><span>Market</span><span>Target SF</span><span>Updated</span>
              </div>
              <ul>
                {filteredDeals.map((deal) => (
                  <li key={deal.id}>
                    <Link className="tripp-deals-item" to={`/workspace/deals/${deal.id}`}>
                      <span className="tripp-deals-name" data-label="Deal">{deal.deal_name}</span>
                      <span data-label="Tenant">{deal.tenant_name || '—'}</span>
                      <span data-label="Type">{TYPE_LABELS[deal.deal_type]}</span>
                      <span data-label="Status"><span className={`tripp-deals-status tripp-deals-status--${deal.status}`}>{STATUS_LABELS[deal.status]}</span></span>
                      <span data-label="Market">{deal.market || '—'}</span>
                      <span data-label="Target SF">{formatSquareFeet(deal.target_square_feet)}</span>
                      <span data-label="Updated"><time dateTime={deal.updated_at}>{formatUpdated(deal.updated_at)}</time></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
};
