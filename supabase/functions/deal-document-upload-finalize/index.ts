import { authorize, json, preflight, readJsonBody, UUID } from "../_shared/documents.ts";
import { unzipSync } from "npm:fflate@0.8.2";

const BUCKET = "tripp-deal-documents";
const MAX = 20_971_520;
function validPdf(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") return false;
  const tail = new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.length - 2048)));
  return tail.includes("%%EOF");
}
function validDocx(bytes: Uint8Array): boolean {
  if (bytes.length < 100 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  // ZIP metadata limits must be enforced before decompression; this preliminary
  // implementation intentionally fails closed until a streaming bounded validator is installed.
  return false;
}
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
    const { data: object, error: objectError } = await scope.admin.storage.from(BUCKET).download(doc.storage_path);
    if (objectError || !object) return json(req, { error: "Upload not complete." }, 409);
    const bytes = new Uint8Array(await object.arrayBuffer());
    const valid = bytes.length === doc.file_size_bytes && bytes.length <= MAX &&
      (ext === "pdf" ? validPdf(bytes) : validDocx(bytes));
    if (!valid) {
      await scope.admin.storage.from(BUCKET).remove([doc.storage_path]);
      await scope.admin.from("deal_documents").update({ upload_status: "failed" })
        .eq("id", doc.id).eq("upload_status", "pending");
      return json(req, { error: "Document content failed validation." }, 422);
    }
    const { data: updated, error: updateError } = await scope.admin.from("deal_documents")
      .update({ upload_status: "ready" }).eq("id", doc.id).eq("upload_status", "pending")
      .select("id, upload_status").maybeSingle();
    if (updateError || !updated) return json(req, { error: "Unable to finalize upload." }, 503);
    return json(req, { documentId: doc.id, uploadStatus: "ready" });
  } catch { return json(req, { error: "Unexpected server error." }, 500); }
});
