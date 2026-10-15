import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Download, FileText, RefreshCw, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { canManageDeals } from '../lib/permissions';
import { documentPollDelay, downloadDealDocument, listDealDocuments, uploadDealDocument, validateDocumentFile, type DealDocument, type DocumentType } from '../lib/documents';

const LABELS: Record<DocumentType, string> = {
  landlord_proposal: 'Landlord proposal', letter_of_intent: 'Letter of intent', other: 'Other',
};
const REASONS: Record<string, string> = {
  upload_missing: 'Upload not found', upload_abandoned: 'Upload expired', size_mismatch: 'File size mismatch',
  file_too_large: 'File too large', invalid_pdf: 'Invalid PDF', invalid_docx: 'Invalid DOCX',
  pdf_encrypted: 'Encrypted PDFs are not supported', pdf_active_content: 'PDF contains active content',
  docx_macros: 'Document contains macros', malware_detected: 'Malware detected',
  scan_inconclusive: 'Security scan inconclusive', integrity_mismatch: 'File integrity mismatch',
  processing_timeout: 'Inspection timed out', inspection_rejected: 'Document rejected', unknown: 'Inspection failed',
};

export function DealDocuments({ organizationId, dealId }: { organizationId: string; dealId: string }) {
  const { resolvedOrgRole } = useAuth();
  const canUpload = canManageDeals(resolvedOrgRole);
  const [documents, setDocuments] = useState<DealDocument[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<DocumentType>('landlord_proposal');
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const activeRef = useRef(true);
  const generationRef = useRef(0);
  const pollingStartedRef = useRef<number | null>(null);
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    const generation = generationRef.current;
    if (!quiet) setLoading(true);
    try {
      const result = await listDealDocuments(organizationId, dealId);
      if (!activeRef.current || generation !== generationRef.current) return;
      setDocuments(result);
      pendingRef.current = result.some((doc) => doc.uploadStatus === 'pending' || doc.uploadStatus === 'processing');
      if (!pendingRef.current) pollingStartedRef.current = null;
      setError(null);
    } catch (caught) {
      if (activeRef.current && generation === generationRef.current) setError(caught instanceof Error ? caught.message : 'Unable to list documents.');
    } finally {
      if (activeRef.current && generation === generationRef.current) setLoading(false);
    }
  }, [organizationId, dealId]);

  useEffect(() => {
    activeRef.current = true;
    generationRef.current += 1;
    setDocuments([]);
    setLoading(true);
    setError(null);
    pollingStartedRef.current = null;
    pendingRef.current = false;
    void refresh();
    return () => {
      activeRef.current = false;
      generationRef.current += 1;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [refresh]);

  const hasPending = documents.some((doc) => doc.uploadStatus === 'pending' || doc.uploadStatus === 'processing');
  useEffect(() => {
    if (!hasPending) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      return;
    }
    if (pollingStartedRef.current === null) pollingStartedRef.current = Date.now();
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      const elapsed = Date.now() - (pollingStartedRef.current ?? Date.now());
      timerRef.current = setTimeout(async () => {
        await refresh(true);
        if (!cancelled && pendingRef.current) schedule();
      }, documentPollDelay(elapsed));
    };
    schedule();
    return () => { cancelled = true; if (timerRef.current) clearTimeout(timerRef.current); };
  }, [hasPending, refresh]);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    event.target.value = '';
    setNotice(null);
    if (!selected) { setFile(null); return; }
    try { validateDocumentFile(selected); setFile(selected); setError(null); }
    catch (caught) { setFile(null); setError(caught instanceof Error ? caught.message : 'Invalid file.'); }
  };

  const upload = async () => {
    if (!canUpload || !file || busy) return;
    const generation = generationRef.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await uploadDealDocument(organizationId, dealId, file, documentType);
      if (!activeRef.current || generation !== generationRef.current) return;
      setFile(null);
      setNotice(result.uploadStatus === 'ready' ? 'Document uploaded and approved.' : 'Upload received. Security inspection in progress.');
    } catch (caught) {
      if (activeRef.current && generation === generationRef.current) setError(caught instanceof Error ? caught.message : 'Upload failed.');
    } finally {
      if (activeRef.current && generation === generationRef.current) { setBusy(false); await refresh(true); }
    }
  };

  const download = async (documentId: string) => {
    setDownloadingId(documentId);
    setError(null);
    try { await downloadDealDocument(organizationId, dealId, documentId); }
    catch (caught) { if (activeRef.current) setError(caught instanceof Error ? caught.message : 'Download failed.'); }
    finally { if (activeRef.current) setDownloadingId(null); }
  };

  return (
    <section className="tripp-workspace-card tripp-documents" aria-labelledby="tripp-documents-title">
      <div className="tripp-workspace-card-head">
        <div><h2 id="tripp-documents-title">Deal documents</h2><p>Secure PDF and DOCX uploads, subject to security inspection.</p></div>
        <button type="button" className="tripp-deals-action" onClick={() => { void refresh(); }} disabled={loading || busy}><RefreshCw size={16} aria-hidden="true" /> Refresh</button>
      </div>
      {canUpload && <div className="tripp-documents-upload">
        <label>Document type <select value={documentType} disabled={busy} onChange={(event) => setDocumentType(event.target.value as DocumentType)}>
          {Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Choose a PDF or DOCX (up to 20 MB) <input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={busy} onChange={onFileChange} /></label>
        {file && <p>Selected: {file.name}</p>}
        <button className="tripp-deals-action" type="button" disabled={!file || busy} onClick={() => { void upload(); }}><Upload size={16} aria-hidden="true" /> {busy ? 'Uploading…' : 'Upload document'}</button>
      </div>}
      {!canUpload && <p className="tripp-workspace-readonly">Read-only access: you can view and download approved documents.</p>}
      {error && <p role="alert" className="tripp-create-submit-error">{error}</p>}
      {notice && <p role="status" className="tripp-workspace-success">{notice}</p>}
      {loading && <p role="status">Loading documents…</p>}
      {!loading && documents.length === 0 && <p>No documents uploaded to this deal yet.</p>}
      <ul className="tripp-documents-list">
        {documents.map((doc) => <li key={doc.id} className="tripp-documents-item">
          <FileText size={20} aria-hidden="true" />
          <div className="tripp-documents-info"><strong>{doc.originalFilename}</strong><span>{LABELS[doc.documentType] ?? 'Document'} · {new Intl.NumberFormat().format(doc.fileSizeBytes)} bytes</span>
            <span>Status: {doc.uploadStatus}{doc.uploadStatus === 'failed' ? ` — ${REASONS[doc.failureReason ?? ''] ?? 'Security inspection failed'}` : ''}</span>
          </div>
          {doc.uploadStatus === 'ready' && <button className="tripp-deals-action" type="button" disabled={downloadingId === doc.id} onClick={() => { void download(doc.id); }}><Download size={16} aria-hidden="true" /> {downloadingId === doc.id ? 'Opening…' : 'Download'}</button>}
        </li>)}
      </ul>
    </section>
  );
}
