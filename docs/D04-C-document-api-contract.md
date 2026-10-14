# D04-C — Document API integration contract (for the vb.do frontend)

Status: staging-ready backend on branch `d04-c-document-backend-mvp`. Not deployed to production.
Contract version: `d04-c.2` (adds persisted-only FAILED semantics, scheduled expiry, staging-only preview CORS).

## 1. Base URL and authentication

```
{SUPABASE_URL}/functions/v1/{function-name}
```

Every request must send:

| Header | Value |
|---|---|
| `Authorization` | `Bearer <access_token>` from `supabase.auth.getSession()` (the signed-in user's JWT, never a service key) |
| `apikey` | the project's publishable/anon key |
| `Content-Type` | `application/json` (POST only) |

`supabase.functions.invoke(name, { body })` sets the first two automatically. For the GET list endpoint use
`fetch` (or `invoke` with `method: "GET"` and the query string in the name).

The calling origin must be in `TRIPP_ALLOWED_ORIGINS` (server config). Exact origins work in every
environment. Vercel preview wildcards (for example `https://tripp-*-mdventures.vercel.app`) are honored
**only** when the backend runs with `TRIPP_ENVIRONMENT=staging`; production ignores them. A preview
build must therefore talk to the **staging** Supabase project, never production.

**Authorization model.** The user must be a member of `organizationId`, and `dealId` must belong to that
organization. Roles: `admin` and `member` can upload; `viewer` can list and download only. Anything the user
is not allowed to see returns **404** (never 403), so the UI should treat 404 as "not found or no access".

## 2. Upload sequence

```
1. POST deal-document-upload-initiate      -> 201 { documentId, uploadPath, uploadToken, ... }
2. supabase.storage.from(bucket).uploadToSignedUrl(uploadPath, uploadToken, file, { contentType: mimeType })
3. POST deal-document-upload-finalize      -> 200 ready | 202 processing | 422 failed
4. If 202: poll GET deal-document-list?documentId=... every 3–5 s (max ~2 min, then every 30 s)
5. Download: POST deal-document-download -> { url } -> open url immediately (expires in 60 s)
```

Client-side checks before step 1 (the server re-checks): `.pdf` or `.docx` only, size 1 byte to 20 MB
(20,971,520 bytes), filename ≤ 255 chars, no `/ \` or control characters.

### 2.1 `POST deal-document-upload-initiate`

Request:
```json
{
  "organizationId": "uuid",
  "dealId": "uuid",
  "filename": "Landlord Proposal - 100 Main St.pdf",
  "fileKind": "pdf",                 // "pdf" | "docx"; must match the filename extension
  "fileSizeBytes": 482113,           // exact File.size
  "documentType": "landlord_proposal" // "landlord_proposal" | "letter_of_intent" | "other"
}
```
Response `201`:
```json
{
  "documentId": "uuid",
  "uploadStatus": "pending",
  "bucket": "tripp-deal-documents",
  "uploadPath": "<org>/<deal>/<documentId>/quarantine.pdf",
  "uploadToken": "…",
  "uploadUrl": "https://…",          // equivalent raw signed URL, if not using supabase-js
  "mimeType": "application/pdf",
  "expiresInSeconds": 7200
}
```

### 2.2 Storage upload (supabase-js)

```ts
const { error } = await supabase.storage
  .from(init.bucket)
  .uploadToSignedUrl(init.uploadPath, init.uploadToken, file, { contentType: init.mimeType });
```
Upload the exact file whose size was declared. If this step fails, show an error; the abandoned record is
failed automatically after 3 hours (`failureReason: "upload_abandoned"`). Start a new upload to retry.

### 2.3 `POST deal-document-upload-finalize`

Request: `{ "organizationId": "uuid", "dealId": "uuid", "documentId": "uuid" }`
Only the user who initiated the upload may finalize it.

| Status | Body | Meaning / UI |
|---|---|---|
| `200` | `{ documentId, uploadStatus: "ready" }` | Done. Show as available. |
| `202` | `{ documentId, uploadStatus: "processing", retryable: true, message }` | Received but not final yet: the scanner is busy, or a rejection hasn't been saved to the database yet. Show "Processing…" and poll. Do **not** call finalize again. |
| `422` | `{ error, code: "document_rejected", documentId, uploadStatus: "failed", failureReason }` | Terminal, and the failed state is confirmed saved. Show the reason message (§5). The user may upload a corrected file. |
| `409` | `{ error, code: "not_pending" \| "finalize_in_progress", documentId, uploadStatus? }` | Already finalized or in progress. Refresh status via list. |

## 3. `GET deal-document-list`

Query: `?organizationId=uuid&dealId=uuid[&documentId=uuid]`
Returns up to 100 documents, newest first. With `documentId` it returns 0 or 1 item (use for polling).

```json
{
  "documents": [
    {
      "id": "uuid",
      "documentType": "landlord_proposal",
      "originalFilename": "Landlord Proposal - 100 Main St.pdf",
      "mimeType": "application/pdf",
      "fileSizeBytes": 482113,
      "uploadStatus": "ready",
      "failureReason": null,
      "createdAt": "2026-10-14T18:02:11.123Z",
      "updatedAt": "2026-10-14T18:02:15.004Z"
    }
  ]
}
```

## 4. `POST deal-document-download`

Request: `{ "organizationId": "uuid", "dealId": "uuid", "documentId": "uuid" }`
Response `200`: `{ "url": "https://…", "expiresInSeconds": 60, "filename": "…", "mimeType": "…" }`
Open or fetch the URL immediately; it expires in 60 seconds and downloads with the original filename.
Request a fresh URL for every click. Never store or share it. Only `ready` documents are downloadable;
anything else returns 404.

## 5. Document statuses

| `uploadStatus` | Meaning | Suggested label |
|---|---|---|
| `pending` | Record created; waiting for the file and finalize | "Uploading…" |
| `processing` | File received; validation, integrity hashing and malware scan running or retrying | "Checking security…" |
| `ready` | Validated, scanned clean, stored immutably; downloadable | "Ready" |
| `failed` | Terminal; see `failureReason` | "Failed – <reason>" |

Transitions: `pending → processing → ready | failed`, or `pending → failed`. Terminal states never change.
The API reports `failed` only after that state is saved in the database.
A database scheduler runs every 5 minutes, with no manual step. It fails uploads still `pending` after
3 hours (`upload_abandoned`) and documents still `processing` after 24 hours (`processing_timeout`).
It also triggers the reconciler, which finishes deferred scans.

### Polling
After a 202, poll `GET deal-document-list?…&documentId=…`:
- every 3 seconds for the first minute,
- then every 15 seconds until 5 minutes,
- then every 60 seconds, or stop and let the next list refresh pick it up.

Stop polling when the status is `ready` or `failed`. A scanner outage usually clears within 5–25 minutes,
when the reconciler next runs.

### Document types
| `documentType` | Label |
|---|---|
| `landlord_proposal` | Landlord proposal |
| `letter_of_intent` | Letter of intent |
| `other` | Other |
The type is set at upload and can't be changed later.

### `failureReason` values and suggested user messages

| Code | Message |
|---|---|
| `upload_missing` | The file never finished uploading. Please try again. |
| `upload_abandoned` | The upload was not completed. Please try again. |
| `size_mismatch` | The file changed during upload. Please try again. |
| `file_too_large` | Files must be 20 MB or smaller. |
| `invalid_pdf` | This PDF appears damaged or is not a valid PDF. |
| `invalid_docx` | This Word file appears damaged or is not a valid .docx file. |
| `pdf_encrypted` | Password-protected PDFs can't be uploaded. Remove the password and try again. |
| `pdf_active_content` | This PDF contains scripts or embedded files and was blocked for safety. Re-save or "Print to PDF" and try again. |
| `docx_macros` | This Word file contains macros or embedded objects and was blocked. Save as a plain .docx and try again. |
| `malware_detected` | This file was blocked by our malware scanner. |
| `scan_inconclusive` | Our malware scanner couldn't verify this file. Try re-saving it. |
| `integrity_mismatch` | The file could not be verified. Please upload it again. |
| `processing_timeout` | Processing took too long. Please upload again. |
| `inspection_rejected` | This file did not pass content inspection. |
| `unknown` | Upload failed. Please try again. |

## 6. Errors (all endpoints)

Every error body is `{ "error": "<human message>", "code": "<stable code>" }` plus context where noted.
Display `error` only as a fallback; branch on `code`.

| HTTP | `code` | When | UI |
|---|---|---|---|
| 400 | `invalid_request` | Malformed body/ids | Bug; log it |
| 400 | `unsupported_file` | Wrong type, size, name, or extension mismatch | Show validation message |
| 401 | `unauthenticated` | Missing/expired session | Refresh session or sign in again |
| 404 | `not_found` | No access, wrong org/deal, viewer uploading, or not downloadable | "Not found or no access" |
| 405 | `method_not_allowed` | Wrong HTTP method | Bug |
| 409 | `not_pending`, `finalize_in_progress` | Duplicate finalize | Refresh via list |
| 413 | `request_too_large` | JSON body > 4 KB | Bug |
| 422 | `document_rejected` | File rejected (see `failureReason`) | Show reason |
| 429 | `quota_exceeded` | Upload rate limits (20/user/hour; org pending cap) | "Too many uploads, try again later" |
| 503 | `uploads_disabled` | Uploads not enabled in this environment | "Uploads are temporarily unavailable" |
| 503 | `service_unavailable` | Transient backend failure | Retry with backoff (max 3) |
| 500 | `internal_error` | Unexpected | Generic error; retry once |

## 7. Reference TypeScript client (for vb.do to adapt)

```ts
type UploadStatus = "pending" | "processing" | "ready" | "failed";
export async function uploadDealDocument(
  supabase: SupabaseClient, orgId: string, dealId: string, file: File,
  documentType: "landlord_proposal" | "letter_of_intent" | "other",
): Promise<{ documentId: string; uploadStatus: UploadStatus; failureReason?: string }> {
  const fileKind = file.name.toLowerCase().endsWith(".docx") ? "docx" : "pdf";
  const init = await supabase.functions.invoke("deal-document-upload-initiate", {
    body: { organizationId: orgId, dealId, filename: file.name, fileKind, fileSizeBytes: file.size, documentType },
  });
  if (init.error) throw init.error;
  const { documentId, bucket, uploadPath, uploadToken, mimeType } = init.data;
  const put = await supabase.storage.from(bucket).uploadToSignedUrl(uploadPath, uploadToken, file, { contentType: mimeType });
  if (put.error) throw put.error;
  const fin = await supabase.functions.invoke("deal-document-upload-finalize", {
    body: { organizationId: orgId, dealId, documentId },
  });
  // supabase-js puts non-2xx bodies on error.context; read JSON from it for 422/409.
  if (fin.error) {
    const body = await (fin.error as { context?: Response }).context?.json?.().catch(() => null);
    if (body?.uploadStatus) return { documentId, uploadStatus: body.uploadStatus, failureReason: body.failureReason };
    throw fin.error;
  }
  return { documentId, uploadStatus: fin.data.uploadStatus };
}
```

## 8. Not in scope for this contract
Delete/rename, versioning, AI extraction. Extraction will follow the rule **AI extracts, broker
verifies, calculations remain deterministic**, and will read only `ready` documents.
