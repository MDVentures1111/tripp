"use client";
import { useEffect, useState } from 'react';
import { FileText, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { listDeals } from '../lib/deals';
import type { DealRow } from '../types/deals';

/** MVP document hub: documents belong to deals, never to an unscoped global folder. */
export const DocumentsView = () => {
  const { resolvedOrgId } = useAuth();
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setDeals([]);
    setError(null);
    setLoading(true);
    if (!resolvedOrgId) {
      setLoading(false);
      return () => controller.abort();
    }
    void listDeals(resolvedOrgId, controller.signal)
      .then((rows) => { if (!controller.signal.aborted) setDeals(rows); })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load deals.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [resolvedOrgId]);

  return (
    <div className="view-container tripp-workspace">
      <header className="tripp-workspace-header">
        <div>
          <p className="tripp-workspace-eyebrow">Document management</p>
          <h1 className="view-title">Deal documents</h1>
          <p className="view-subtitle">Select a deal to manage its proposals, letters of intent, and supporting files.</p>
        </div>
      </header>
      {!resolvedOrgId && <p role="alert">An organization is required to access documents.</p>}
      {loading && <p role="status">Loading deals…</p>}
      {error && <p role="alert" className="tripp-create-submit-error">{error}</p>}
      {!loading && !error && resolvedOrgId && deals.length === 0 && (
        <section className="tripp-workspace-card">
          <p>No deals yet. Create a deal first, then add documents to its workspace.</p>
          <Link to="/workspace/deals" className="tripp-deals-action">Go to deals <ArrowRight size={16} aria-hidden="true" /></Link>
        </section>
      )}
      {!loading && !error && deals.length > 0 && (
        <section className="tripp-workspace-card">
          <div className="tripp-workspace-card-head"><h2>Choose a deal</h2></div>
          <ul className="tripp-documents-list">
            {deals.map((deal) => (
              <li key={deal.id} className="tripp-documents-item">
                <FileText size={20} aria-hidden="true" />
                <div className="tripp-documents-info">
                  <strong>{deal.deal_name}</strong>
                  <span>{deal.tenant_name || 'Tenant not specified'} · {deal.status.replace(/_/g, ' ')}</span>
                </div>
                <Link className="tripp-deals-action" to={`/workspace/deals/${deal.id}`}>Open documents <ArrowRight size={16} aria-hidden="true" /></Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
