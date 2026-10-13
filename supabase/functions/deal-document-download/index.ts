import { authorize, json, preflight, readJsonBody, UUID } from "../_shared/documents.ts";

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);
  let body: unknown;
  try { body = await readJsonBody(req); }
  catch (error) { return json(req, { error: error instanceof Error && error.message === "BODY_TOO_LARGE" ? "Request too large." : "Invalid request." }, error instanceof Error && error.message === "BODY_TOO_LARGE" ? 413 : 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json(req, { error: "Invalid request." }, 400);
  const input = body as Record<string, unknown>;
  if (typeof input.organizationId !== "string" || typeof input.dealId !== "string" ||
      typeof input.documentId !== "string" || !UUID.test(input.documentId))
    return json(req, { error: "Invalid request." }, 400);
  try {
    const scope = await authorize(req, input.organizationId, input.dealId);
    if (scope instanceof Response) return scope;
    const { data: doc, error } = await scope.admin.from("deal_documents")
      .select("storage_path, upload_status, mime_type, verified_sha256, malware_scan_sha256, malware_scanned_at").eq("id", input.documentId)
      .eq("organization_id", scope.orgId).eq("deal_id", scope.dealId).maybeSingle();
    if (error) return json(req, { error: "Service unavailable." }, 503);
    if (!doc || doc.upload_status !== "ready" || !doc.verified_sha256 || doc.malware_scan_sha256 !== doc.verified_sha256 || !doc.malware_scanned_at) return json(req, { error: "Not found." }, 404);
    const ext = doc.mime_type === "application/pdf" ? "pdf" :
      doc.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "docx" : null;
    if (!ext || doc.storage_path !== `${scope.orgId}/${scope.dealId}/${input.documentId}/source.${ext}`)
      return json(req, { error: "Document unavailable." }, 503);
    const { data: signed, error: signedError } = await scope.admin.storage.from("tripp-deal-documents")
      .createSignedUrl(doc.storage_path, 60);
    if (signedError || !signed) return json(req, { error: "Document unavailable." }, 503);
    return json(req, { url: signed.signedUrl, expiresInSeconds: 60 });
  } catch {
    return json(req, { error: "Unexpected server error." }, 500);
  }
});
