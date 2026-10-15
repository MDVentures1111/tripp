import { supabase, supabaseUrl, supabasePublishableKey } from './supabase';
import { isValidUuid } from './dealValidation';

export type DocumentType = 'landlord_proposal' | 'letter_of_intent' | 'other';
export type UploadStatus = 'pending' | 'processing' | 'ready' | 'failed';
export interface DealDocument {
  id: string;
  documentType: DocumentType;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadStatus: UploadStatus;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}
interface UploadInitiateResponse {
  documentId: string;
  uploadStatus: 'pending';
  bucket: string;
  uploadPath: string;
  uploadToken: string;
  uploadUrl: string;
  mimeType: string;
  expiresInSeconds: number;
}
export type FinalizeResponse =
  | { documentId: string; uploadStatus: 'ready' }
  | { documentId: string; uploadStatus: 'processing'; retryable: true; message?: string };

const MAX_BYTES = 20_971_520;
const MIME: Record<'pdf' | 'docx', string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function validateDocumentFile(file: File): 'pdf' | 'docx' {
  if (!file.name || file.name.length > 255 || /[\\/\x00-\x1f\x7f]/.test(file.name)) {
    throw new Error('Filename must be 1–255 characters and cannot contain paths or control characters.');
  }
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension !== 'pdf' && extension !== 'docx') throw new Error('Only PDF and DOCX files are supported.');
  if (file.size < 1 || file.size > MAX_BYTES) throw new Error('File size must be between 1 byte and 20 MB.');
  if (file.type && file.type !== MIME[extension] && file.type !== 'application/octet-stream') {
    throw new Error('The file MIME type does not match its extension.');
  }
  return extension;
}

function assertScope(organizationId: string, dealId: string): void {
  if (!isValidUuid(organizationId) || !isValidUuid(dealId)) {
    throw new Error('Valid organization and deal IDs are required.');
  }
}

async function callFunction<T>(name: string, organizationId: string, dealId: string, body?: object, method: 'GET' | 'POST' = 'POST'): Promise<T> {
  assertScope(organizationId, dealId);
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) throw new Error('Your session has expired. Please sign in again.');
  const baseUrl = supabaseUrl;
  const query = new URLSearchParams({ organizationId, dealId });
  const endpoint = `${baseUrl}/functions/v1/${name}${method === 'GET' ? `?${query}` : ''}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: supabasePublishableKey,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify({ organizationId, dealId, ...body }) } : {}),
    });
  } catch {
    throw new Error('Network error. Please check your connection and retry.');
  }
  let result: unknown;
  try { result = await response.json(); } catch { result = null; }
  if (!response.ok) {
    const payload = result as { message?: string; error?: string; failureReason?: string } | null;
    const fallback: Record<number, string> = {
      400: 'Invalid document request.', 401: 'Session expired. Please sign in again.',
      403: 'You do not have permission.', 404: 'Document or deal not found.',
      409: 'Document state changed. Refresh the list.', 413: 'File is too large.',
      422: 'Document rejected by security inspection.', 429: 'Too many requests. Please try again shortly.',
      503: 'Document service temporarily unavailable.',
    };
    throw new Error(payload?.message || payload?.failureReason || (typeof payload?.error === 'string' ? payload.error : '') || fallback[response.status] || 'Document request failed.');
  }
  return result as T;
}

export async function listDealDocuments(organizationId: string, dealId: string): Promise<DealDocument[]> {
  const result = await callFunction<DealDocument[] | { documents: DealDocument[] }>('deal-document-list', organizationId, dealId, undefined, 'GET');
  const documents = Array.isArray(result) ? result : result?.documents;
  if (!Array.isArray(documents)) throw new Error('Unexpected document-list response.');
  return documents;
}

export async function uploadDealDocument(organizationId: string, dealId: string, file: File, documentType: DocumentType): Promise<FinalizeResponse> {
  const fileKind = validateDocumentFile(file);
  const initiated = await callFunction<UploadInitiateResponse>('deal-document-upload-initiate', organizationId, dealId, {
    filename: file.name, fileKind, fileSizeBytes: file.size, documentType,
  });
  if (!initiated.documentId || !initiated.uploadPath || !initiated.uploadToken || !initiated.bucket) {
    throw new Error('Upload initialization returned an incomplete response.');
  }
  const { error } = await supabase.storage.from(initiated.bucket).uploadToSignedUrl(initiated.uploadPath, initiated.uploadToken, file, {
    contentType: initiated.mimeType,
  });
  if (error) throw new Error('Storage upload failed. Please retry with a new upload.');
  return callFunction<FinalizeResponse>('deal-document-upload-finalize', organizationId, dealId, { documentId: initiated.documentId });
}

export async function downloadDealDocument(organizationId: string, dealId: string, documentId: string): Promise<void> {
  if (!isValidUuid(documentId)) throw new Error('Invalid document ID.');
  const result = await callFunction<{ url: string; expiresInSeconds: number; filename: string; mimeType: string }>(
    'deal-document-download', organizationId, dealId, { documentId }, 'POST',
  );
  const parsed = new URL(result.url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== new URL(supabaseUrl).hostname) {
    throw new Error('Unexpected document download URL.');
  }
  // Request a new signed URL on every click. Never persist or cache it.
  const link = document.createElement('a');
  link.href = parsed.toString();
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Poll at 3 seconds for the first minute, 15 seconds until five minutes, then 60 seconds. */
export function documentPollDelay(elapsedMs: number): number {
  return elapsedMs < 60_000 ? 3_000 : elapsedMs < 300_000 ? 15_000 : 60_000;
}
