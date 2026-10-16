import { useState } from 'react';
export function PreviewDemo() {
  const [visible, setVisible] = useState(false);
  return <main style={{maxWidth:900,margin:'40px auto',padding:24,fontFamily:'system-ui',lineHeight:1.6}}>
    <p style={{letterSpacing:2,fontSize:12}}>TRIPP COMMERCIAL INTELLIGENCE · PREVIEW</p>
    <h1>Deal Intelligence</h1>
    <p>Explore a fictional Charlotte office leasing scenario. No account, real deals, uploads, or production data required.</p>
    <section style={{border:'1px solid #aaa',borderRadius:12,padding:24}}>
      <h2>Sample intelligence brief</h2>
      <p>Piedmont Growth Partners (fictional) · Charlotte, NC · 12,000 SF · 60 months</p>
      <button onClick={()=>setVisible(v=>!v)} style={{padding:'12px 20px',cursor:'pointer'}}>{visible?'Hide sample brief':'View sample intelligence brief'}</button>
      {visible&&<div>
        <h3>Illustrative lease economics</h3>
        <p>Assumed base rent: $32/SF/year. Annual base rent: $384,000. Five-year base rent: $1,920,000, excluding escalations, expenses and concessions.</p>
        <h3>Advisory considerations</h3>
        <ul><li>Validate space requirements against headcount and growth projections.</li><li>Model full occupancy cost, including operating expenses and improvements.</li><li>Negotiate expansion, renewal, termination and sublease flexibility.</li></ul>
        <p><strong>Fictional demonstration only.</strong> Not live AI output, verified market data, or investment advice.</p>
      </div>}
    </section>
    <p>This isolated preview deliberately does not connect to production Supabase. The full authenticated workspace remains on the live site.</p>
  </main>;
}
