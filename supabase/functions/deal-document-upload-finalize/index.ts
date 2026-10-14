import { inspectDocument, isInspectionCleared } from "../_shared/content-inspector.ts";
import { scanDocument } from "../_shared/malware-scanner.ts";
import { auditDocumentEvent } from "../_shared/document-audit.ts";
import { authorize, json, preflight, readJsonBody, UUID } from "../_shared/documents.ts";
import { checkDocument, MAX_DOCUMENT_BYTES } from "../_shared/file-validation.ts";
import { persistRejection } from "../_shared/document-lifecycle.ts";

const BUCKET = "tripp-deal-documents";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * D04-C lifecycle contract:
 *  - 200 { uploadStatus: "ready" }                     document is downloadable
 *  - 422 { uploadStatus: "failed", failureReason }      definite rejection, terminal
 *  - 202 { uploadStatus: "processing", retryable }      transient dependency failure;
 *                                                       the reconciler completes or fails it
 */
Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== "POST") return json(req, { error: "Method not allowed.", code: "method_not_allowed" }, 405);
  let raw: unknown;
  try { raw = await readJsonBody(req); }
  catch (e) {
    const tooLarge = e instanceof Error && e.message === "BODY_TOO_LARGE";
    return json(req, { error: tooLarge ? "Request too large." : "Invalid request.", code: tooLarge ? "request_too_large" : "invalid_request" }, tooLarge ? 413 : 400);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json(req, { error: "Invalid request.", code: "invalid_request" }, 400);
  const b = raw as Record<string, unknown>;
  if (typeof b.organizationId !== "string" || typeof b.dealId !== "string" ||
      typeof b.documentId !== "string" || !UUID.test(b.documentId))
    return json(req, { error: "Invalid request.", code: "invalid_request" }, 400);
  try {
    const scope = await authorize(req, b.organizationId, b.dealId, true);
    if (scope instanceof Response) return scope;
    const { data: doc, error } = await scope.admin.from("deal_documents")
      .select("id, storage_path, mime_type, file_size_bytes, upload_status, uploaded_by")
      .eq("id", b.documentId).eq("organization_id", scope.orgId).eq("deal_id", scope.dealId).maybeSingle();
    if (error) return json(req, { error: "Service unavailable.", code: "service_unavailable" }, 503);
    if (!doc || doc.uploaded_by !== scope.userId) return json(req, { error: "Not found.", code: "not_found" }, 404);
    if (doc.upload_status !== "pending")
      return json(req, { error: "Document is not awaiting finalization.", code: "not_pending", documentId: doc.id, uploadStatus: doc.upload_status }, 409);
    const ext = doc.mime_type === "application/pdf" ? "pdf" : doc.mime_type === DOCX ? "docx" : null;
    if (!ext || doc.storage_path !== `${scope.orgId}/${scope.dealId}/${doc.id}/source.${ext}`)
      return json(req, { error: "Document unavailable.", code: "service_unavailable" }, 503);
    const claimToken = crypto.randomUUID();
    const { data: claimed, error: claimError } = await scope.admin.rpc("tripp_claim_document_finalize", {
      p_id: doc.id, p_org: scope.orgId, p_deal: scope.dealId, p_user: scope.userId, p_token: claimToken,
    });
    if (claimError) return json(req, { error: "Finalization unavailable.", code: "service_unavailable" }, 503);
    if (!claimed) return json(req, { error: "Document finalization already in progress.", code: "finalize_in_progress", documentId: doc.id }, 409);

    const quarantinePath = `${scope.orgId}/${scope.dealId}/${doc.id}/quarantine.${ext}`;
    const audit = (outcome: string, status: number, reason?: string) =>
      auditDocumentEvent("upload_finalize", { organizationId: scope.orgId, userId: scope.userId, documentId: doc.id, outcome, status, reason });
    const reject = async (reason: string, message: string) => {
      const outcome = await persistRejection(reason, {
        reject: () => scope.admin.rpc("tripp_reject_document_finalize", { p_id: doc.id, p_token: claimToken, p_reason: reason }),
        readStatus: async () => {
          const { data } = await scope.admin.from("deal_documents").select("upload_status, failure_reason").eq("id", doc.id).single();
          return { status: data?.upload_status ?? null, reason: data?.failure_reason ?? null };
        },
        removeQuarantine: () => scope.admin.storage.from(BUCKET).remove([quarantinePath]),
      });
      if (outcome.persisted) {
        audit("rejected", 422, reason);
        return json(req, { error: message, code: "document_rejected", documentId: doc.id, uploadStatus: "failed", failureReason: outcome.failureReason }, 422);
      }
      // Never claim FAILED without a persisted state. The reconciler re-evaluates and finishes it.
      audit("reject_unpersisted", 202, reason);
      return json(req, { documentId: doc.id, uploadStatus: outcome.uploadStatus === "ready" ? "ready" : "processing", retryable: true,
        message: "Document received; checks are still being finalized." }, outcome.uploadStatus === "ready" ? 200 : 202);
    };
    const deferred = (reason: string) => {
      audit("deferred", 202, reason);
      return json(req, { documentId: doc.id, uploadStatus: "processing", retryable: true,
        message: "Document received; security checks are still running." }, 202);
    };

    const { data: object, error: objectError } = await scope.admin.storage.from(BUCKET).download(quarantinePath);
    if (objectError || !object) return await reject("upload_missing", "Upload not received; start a new upload.");
    if (object.size > MAX_DOCUMENT_BYTES) return await reject("file_too_large", "Document exceeds the 20 MB limit.");
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.length !== doc.file_size_bytes) return await reject("size_mismatch", "Uploaded file size does not match the declared size.");
    const validation = checkDocument(ext, bytes);
    if (!validation.ok) return await reject(validation.reason, "Document failed file validation.");

    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((v) => v.toString(16).padStart(2, "0")).join("");
    const { data: bound, error: bindError } = await scope.admin.rpc("tripp_bind_document_digest", { p_id: doc.id, p_token: claimToken, p_digest: digest });
    if (bindError || !bound) return deferred("digest_bind_failed");

    const endpoint = Deno.env.get("TRIPP_MALWARE_SCANNER_URL");
    const secret = Deno.env.get("TRIPP_MALWARE_SCANNER_SECRET");
    if (!endpoint || !secret || Deno.env.get("TRIPP_ENABLE_MALWARE_SCANNING") !== "verified") return deferred("scanner_not_configured");
    let scan;
    try { scan = await scanDocument(bytes, digest, doc.mime_type, { endpoint, secret }); }
    catch { return deferred("scanner_unavailable"); }
    if (scan.verdict === "malicious") return await reject("malware_detected", "Document was blocked by the malware scanner.");
    if (scan.verdict !== "clean") return await reject("scan_inconclusive", "The malware scanner could not clear this document.");
    const { data: recorded, error: scanError } = await scope.admin.rpc("tripp_bind_document_clean_scan",
      { p_id: doc.id, p_token: claimToken, p_digest: digest, p_engine: scan.engine });
    if (scanError || !recorded) return deferred("scan_bind_failed");

    // Optional, experimental inspection gate (off by default for the MVP).
    if (Deno.env.get("TRIPP_REQUIRE_CONTENT_INSPECTION") === "verified") {
      const inspectorEndpoint = Deno.env.get("TRIPP_CONTENT_INSPECTOR_URL");
      const inspectorSecret = Deno.env.get("TRIPP_CONTENT_INSPECTOR_SECRET");
      if (!inspectorEndpoint || !inspectorSecret) return deferred("inspector_not_configured");
      let inspection;
      try { inspection = await inspectDocument(bytes, digest, doc.mime_type, { endpoint: inspectorEndpoint, secret: inspectorSecret }); }
      catch { return deferred("inspector_unavailable"); }
      if (!isInspectionCleared(inspection, digest)) return await reject("inspection_rejected", "Document not cleared by content inspector.");
      const { data: inspectionBound, error: inspectionError } = await scope.admin.rpc("tripp_bind_document_content_inspection",
        { p_id: doc.id, p_token: claimToken, p_digest: digest, p_engine: inspection.engine, p_policy: inspection.policyVersion });
      if (inspectionError || !inspectionBound) return deferred("inspection_bind_failed");
    }

    // Fencing check immediately before promotion (not a cross-service transaction).
    const { data: leaseValid, error: leaseError } = await scope.admin.rpc("tripp_document_finalize_lease_valid", { p_id: doc.id, p_token: claimToken });
    if (leaseError || !leaseValid) return deferred("lease_expired");
    // Copy only validated bytes to the immutable final path; never overwrite.
    const { error: promoteError } = await scope.admin.storage.from(BUCKET).upload(doc.storage_path, bytes, { contentType: doc.mime_type, upsert: false });
    if (promoteError) return deferred("promote_failed");
    const { data: finished, error: finishError } = await scope.admin.rpc("tripp_finish_document_finalize", { p_id: doc.id, p_token: claimToken, p_success: true });
    if (finishError || !finished) return deferred("finish_failed");
    await scope.admin.storage.from(BUCKET).remove([quarantinePath]);
    audit("ready", 200);
    return json(req, { documentId: doc.id, uploadStatus: "ready" });
  } catch { return json(req, { error: "Unexpected server error.", code: "internal_error" }, 500); }
});
