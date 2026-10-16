"use client";

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BrainCircuit } from 'lucide-react';

const demo = {
  name: 'Piedmont Growth — Charlotte Office Search',
  tenant: 'Piedmont Growth Partners (fictional)',
  market: 'Charlotte, NC',
  size: '12,000 SF',
  term: '60 months',
  baseRent: '$32 / SF / year (illustrative)',
  annualBase: '$384,000',
  totalBase: '$1,920,000',
};

export const IntelligenceView: React.FC = () => {
  const [showDemo, setShowDemo] = useState(false);
  return (
    <div className="view-container tripp-workspace">
      <header className="tripp-workspace-header">
        <div>
          <p className="tripp-workspace-eyebrow">TRIPP Commercial Intelligence</p>
          <h1 className="view-title">Deal Intelligence</h1>
          <p className="view-subtitle">Explore a sample advisory brief or analyze a deal from your workspace.</p>
        </div>
        <BrainCircuit size={30} aria-hidden="true" />
      </header>
      <section className="tripp-workspace-card">
        <h2>Explore a sample deal</h2>
        <p>No deals or documents required. This fictional example demonstrates the structure of a commercial leasing advisory brief.</p>
        <button className="tripp-deals-action" type="button" onClick={() => setShowDemo(value => !value)}>
          {showDemo ? 'Hide sample brief' : 'View sample intelligence brief'}
        </button>
        {showDemo && (
          <div aria-label="Fictional deal intelligence demonstration">
            <p><strong>DEMONSTRATION ONLY — fictional assumptions; not a live AI analysis or market quotation.</strong></p>
            <h3>{demo.name}</h3>
            <dl className="tripp-workspace-facts">
              <div><dt>Tenant</dt><dd>{demo.tenant}</dd></div>
              <div><dt>Market</dt><dd>{demo.market}</dd></div>
              <div><dt>Space requirement</dt><dd>{demo.size}</dd></div>
              <div><dt>Lease term</dt><dd>{demo.term}</dd></div>
              <div><dt>Assumed base rent</dt><dd>{demo.baseRent}</dd></div>
              <div><dt>Annual base rent</dt><dd>{demo.annualBase}</dd></div>
              <div><dt>Five-year base rent</dt><dd>{demo.totalBase}</dd></div>
            </dl>
            <h3>Advisory observations</h3>
            <p>The modeled base-rent obligation is $384,000 per year and $1.92 million over five years, before escalations, operating expenses, concessions, and transaction costs.</p>
            <h3>Questions to resolve</h3>
            <ul>
              <li>Is the tenant's required square footage supported by its headcount and growth assumptions?</li>
              <li>What is the full occupancy cost after operating expenses, annual increases, and tenant improvements?</li>
              <li>Which expansion, renewal, termination, and sublease rights should be negotiated?</li>
            </ul>
            <p><strong>Limitations:</strong> These figures are illustrative calculations, not verified market data, available listings, a recommendation, or an AI-generated result. No information is sent to a model or stored as a deal.</p>
          </div>
        )}
      </section>
      <section className="tripp-workspace-card">
        <h2>Analyze an actual deal</h2>
        <p>Open a saved deal to use the connected Deal Intelligence function. Create a deal first if your workspace is empty.</p>
        <Link className="tripp-deals-action" to="/workspace/deals">Go to deals</Link>
      </section>
    </div>
  );
};
