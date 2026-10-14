import { authorize, json, preflight, UUID } from "../_shared/documents.ts";

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== "GET") return json(req, { error: "Method not allowed.", code: "method_not_allowed" }, 405);
  try {
    const url = new URL(req.url);
    const scope = await authorize(req, url.searchParams.get("organizationId") ?? "", url.searchParams.get("dealId") ?? "");
    if (scope instanceof Response) return scope;
    const documentId = url.searchParams.get("documentId");
    if (documentId !== null && !UUID.test(documentId)) return json(req, { error: "Invalid request.", code: "invalid_request" }, 400);
    let query = scope.admin.from("deal_documents")
      .select("id, document_type, original_filename, mime_type, file_size_bytes, upload_status, failure_reason, created_at, updated_at")
      .eq("organization_id", scope.orgId).eq("deal_id", scope.dealId);
    if (documentId) query = query.eq("id", documentId);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(100);
    if (error) return json(req, { error: "Unable to load documents.", code: "service_unavailable" }, 503);
    return json(req, { documents: (data ?? []).map((d) => ({
      id: d.id, documentType: d.document_type, originalFilename: d.original_filename,
      mimeType: d.mime_type, fileSizeBytes: d.file_size_bytes,
      uploadStatus: d.upload_status, failureReason: d.upload_status === "failed" ? (d.failure_reason ?? "unknown") : null,
      createdAt: d.created_at, updatedAt: d.updated_at,
    })) });
  } catch {
    return json(req, { error: "Unexpected server error.", code: "internal_error" }, 500);
  }
});
