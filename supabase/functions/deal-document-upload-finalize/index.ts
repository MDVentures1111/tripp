import { authorize, json, preflight, readJsonBody, UUID } from "../_shared/documents.ts";
import { validatePdf, validateDocx, MAX_DOCUMENT_BYTES } from "../_shared/file-validation.ts";

const BUCKET = "tripp-deal-documents";
Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);
  let raw: unknown;
  try { raw = await readJsonBody(req); }
  catch (e) { return json(req, { error: e instanceof Error && e.message === "BODY_TOO_LARGE" ? "Request too large." : "Invalid request." }, e instanceof Error && e.message === "BODY_TOO_LARGE" ? 413 : 400); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json(req, { error: "Invalid request." }, 400);
  const b = raw as Record<string, unknown>;
  if (typeof b.organizationId !== "string" || typeof b.dealId !== "string" ||
      typeof b.documentId !== "string" || !UUID.test(b.documentId))
    return json(req, { error: "Invalid request." }, 400);
  try {
    const scope = await authorize(req, b.organizationId, b.dealId, true);
    if (scope instanceof Response) return scope;
    const { data: doc, error } = await scope.admin.from("deal_documents")
      .select("id, storage_path, mime_type, file_size_bytes, upload_status, uploaded_by")
      .eq("id", b.documentId).eq("organization_id", scope.orgId).eq("deal_id", scope.dealId).maybeSingle();
    if (error) return json(req, { error: "Service unavailable." }, 503);
    if (!doc || doc.uploaded_by !== scope.userId || doc.upload_status !== "pending")
      return json(req, { error: "Not found." }, 404);
    const ext = doc.mime_type === "application/pdf" ? "pdf" :
      doc.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "docx" : null;
    if (!ext || doc.storage_path !== `${scope.orgId}/${scope.dealId}/${doc.id}/source.${ext}`)
      return json(req, { error: "Document unavailable." }, 503);
    const claimToken = crypto.randomUUID();
    const { data: claimed, error: claimError } = await scope.admin.rpc("tripp_claim_document_finalize", {
      p_id: doc.id, p_org: scope.orgId, p_deal: scope.dealId, p_user: scope.userId, p_token: claimToken,
    });
    if (claimError) return json(req, { error: "Finalization unavailable." }, 503);
    if (!claimed) return json(req, { error: "Document finalization already in progress." }, 409);
    const finish = async (success: boolean) => scope.admin.rpc("tripp_finish_document_finalize", {
      p_id: doc.id, p_token: claimToken, p_success: success,
    });
    // The signed upload token only grants access to quarantine, never to the immutable final object.
    const quarantinePath = `${scope.orgId}/${scope.dealId}/${doc.id}/quarantine.${ext}`;
    const { data: object, error: objectError } = await scope.admin.storage.from(BUCKET).download(quarantinePath);
    if (objectError || !object) {
      await finish(false);
      return json(req, { error: "Upload not complete; start a new upload." }, 409);
    }
    if (object.size > MAX_DOCUMENT_BYTES) {
      await finish(false);
      return json(req, { error: "Document exceeds size limit." }, 422);
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    const valid = bytes.length === doc.file_size_bytes && bytes.length <= MAX_DOCUMENT_BYTES &&
      (ext === "pdf" ? validatePdf(bytes) : validateDocx(bytes));
    if (!valid) {
      await scope.admin.storage.from(BUCKET).remove([quarantinePath]);
      await finish(false);
      return json(req, { error: "Document content failed validation." }, 422);
    }
    // Recheck ownership immediately before promotion. This is a fencing check, not a cross-service transaction.
    const { data: leaseValid, error: leaseError } = await scope.admin.rpc("tripp_document_finalize_lease_valid", {
      p_id: doc.id, p_token: claimToken,
    });
    if (leaseError || !leaseValid) return json(req, { error: "Finalization lease expired; reconciliation required." }, 409);
    // Copy only validated bytes to the final path; never overwrite an existing source.
    const { error: promoteError } = await scope.admin.storage.from(BUCKET).upload(doc.storage_path, bytes, {
      contentType: doc.mime_type, upsert: false,
    });
    if (promoteError) {
      // Preserve processing state for reconciliation; final source may already exist.
      return json(req, { error: "Unable to promote verified document; reconciliation required." }, 503);
    }
    const { data: finished, error: finishError } = await finish(true);
    if (finishError || !finished) return json(req, { error: "Unable to finalize upload; reconciliation required." }, 503);
    await scope.admin.storage.from(BUCKET).remove([quarantinePath]);
    return json(req, { documentId: doc.id, uploadStatus: "ready" });
  } catch { return json(req, { error: "Unexpected server error." }, 500); }
});
