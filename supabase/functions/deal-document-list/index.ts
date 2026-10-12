import { authorize, json, preflight } from "../_shared/documents.ts";

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== "GET") return json(req, { error: "Method not allowed." }, 405);
  try {
    const url = new URL(req.url);
    const scope = await authorize(req, url.searchParams.get("organizationId") ?? "", url.searchParams.get("dealId") ?? "");
    if (scope instanceof Response) return scope;
    const { data, error } = await scope.admin.from("deal_documents")
      .select("id, document_type, original_filename, mime_type, file_size_bytes, upload_status, created_at")
      .eq("organization_id", scope.orgId).eq("deal_id", scope.dealId)
      .order("created_at", { ascending: false }).limit(100);
    if (error) return json(req, { error: "Unable to load documents." }, 503);
    return json(req, { documents: (data ?? []).map((d) => ({
      id: d.id, documentType: d.document_type, originalFilename: d.original_filename,
      mimeType: d.mime_type, fileSizeBytes: d.file_size_bytes,
      uploadStatus: d.upload_status, createdAt: d.created_at,
    })) });
  } catch {
    return json(req, { error: "Unexpected server error." }, 500);
  }
});
