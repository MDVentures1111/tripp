import { auditDocumentEvent } from "../_shared/document-audit.ts";
import { authorize, json, preflight, readJsonBody } from "../_shared/documents.ts";

const MAX = 20_971_520;
const TYPES: Record<string, { mime: string; ext: string }> = {
  pdf: { mime: "application/pdf", ext: "pdf" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" },
};
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
      typeof b.filename !== "string" || typeof b.documentType !== "string" ||
      typeof b.fileSizeBytes !== "number" || typeof b.fileKind !== "string")
    return json(req, { error: "Invalid request." }, 400);
  const kind = TYPES[b.fileKind];
  if (!kind || !Number.isSafeInteger(b.fileSizeBytes) || b.fileSizeBytes < 1 || b.fileSizeBytes > MAX ||
      !["landlord_proposal", "letter_of_intent", "other"].includes(b.documentType) ||
      b.filename.length > 255 || !b.filename.trim() || /[\\/\x00-\x1f\x7f]/.test(b.filename) ||
      !b.filename.toLowerCase().endsWith("." + kind.ext))
    return json(req, { error: "Unsupported or invalid file.", code: "unsupported_file" }, 400);
  // Fail closed until signed-upload overwrite and restrictive-RLS behavior are tested.
  if (Deno.env.get("TRIPP_ENABLE_DOCUMENT_UPLOADS") !== "verified")
    return json(req, { error: "Document uploads are not yet enabled.", code: "uploads_disabled" }, 503);
  try {
    const scope = await authorize(req, b.organizationId, b.dealId, true);
    if (scope instanceof Response) return scope;
    const documentId = crypto.randomUUID();
    const path = `${scope.orgId}/${scope.dealId}/${documentId}/source.${kind.ext}`;
    const {data:admitted,error:admissionError}=await scope.admin.rpc("tripp_admit_document_upload",{
      p_id:documentId,p_org:scope.orgId,p_user:scope.userId,
    });
    if(admissionError) { auditDocumentEvent("upload_admission",{organizationId:scope.orgId,userId:scope.userId,outcome:"error",status:503,reason:"admission_rpc_failed"}); return json(req,{error:"Upload admission unavailable."},503); }
    if(!admitted) { auditDocumentEvent("upload_admission",{organizationId:scope.orgId,userId:scope.userId,outcome:"denied",status:429,reason:"quota_exceeded"}); return json(req,{error:"Upload quota exceeded. Try again later."},429); }

    const { error: insertError } = await scope.admin.from("deal_documents").insert({
      id: documentId, organization_id: scope.orgId, deal_id: scope.dealId,
      document_type: b.documentType, original_filename: b.filename.trim(),
      storage_path: path, mime_type: kind.mime, file_size_bytes: b.fileSizeBytes,
      uploaded_by: scope.userId, upload_status: "pending",
    });
    if (insertError) { auditDocumentEvent("upload_initiate",{organizationId:scope.orgId,userId:scope.userId,documentId,outcome:"error",status:503,reason:"metadata_insert_failed"}); return json(req, { error: "Unable to prepare upload." }, 503); }
    // Upload credentials target quarantine only; never the verified source path.
    const stagingPath = `${scope.orgId}/${scope.dealId}/${documentId}/quarantine.${kind.ext}`;
    const { data, error } = await scope.admin.storage.from("tripp-deal-documents").createSignedUploadUrl(stagingPath);
    if (error || !data) {
      await scope.admin.from("deal_documents").update({ upload_status: "failed" }).eq("id", documentId).eq("upload_status", "pending");
      auditDocumentEvent("upload_initiate",{organizationId:scope.orgId,userId:scope.userId,documentId,outcome:"error",status:503,reason:"signed_upload_unavailable"});
      return json(req, { error: "Upload transport unavailable." }, 503);
    }
    auditDocumentEvent("upload_initiate",{organizationId:scope.orgId,userId:scope.userId,documentId,outcome:"issued",status:201});
    return json(req, { documentId, uploadStatus: "pending", bucket: "tripp-deal-documents", uploadPath: stagingPath, uploadToken: data.token, uploadUrl: data.signedUrl, mimeType: kind.mime, expiresInSeconds: 7200 }, 201);
  } catch { return json(req, { error: "Unexpected server error." }, 500); }
});
