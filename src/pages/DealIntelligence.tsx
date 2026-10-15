import { useState } from 'react';
import { analyzeDeal } from '../lib/dealIntelligence';
export function DealIntelligence({ dealId }: { dealId: string }) {
  const [analysis, setAnalysis] = useState('');
  const [disclaimer, setDisclaimer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true); setError(''); setAnalysis('');
    try { const result = await analyzeDeal(dealId); setAnalysis(result.analysis); setDisclaimer(result.disclaimer); }
    catch (e) { setError(e instanceof Error ? e.message : 'Analysis failed'); }
    finally { setBusy(false); }
  };
  return <section className="tripp-workspace-card" aria-label="Deal Intelligence">
    <h2>Deal Intelligence</h2>
    <p>AI-assisted assessment of the current deal. No external market data is included.</p>
    <button type="button" className="tripp-deals-action" disabled={busy} onClick={() => void run()}>{busy ? 'Analyzing…' : 'Analyze deal'}</button>
    {error && <p role="alert">{error}</p>}
    {analysis && <><h3>Intelligence brief</h3><pre style={{whiteSpace:'pre-wrap',fontFamily:'inherit',overflowWrap:'anywhere'}}>{analysis}</pre><p>{disclaimer}</p></>}
  </section>;
}
