import { authorize, json, preflight, UUID } from "../_shared/documents.ts";

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);
  if (Number(req.headers.get("content-length") ?? "0") > 4096) return json(req, { error: "Request too large." }, 413);
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || !UUID.test(body.documentId ?? ""))
      return json(req, { error: "Invalid request." }, 400);
    const scope = await authorize(req, body.organizationId ?? "", body.dealId ?? "");
    if (scope instanceof Response) return scope;
    const { data: doc, error } = await scope.admin.from("deal_documents")
      .select("storage_path, upload_status").eq("id", body.documentId)
      .eq("organization_id", scope.orgId).eq("deal_id", scope.dealId).maybeSingle();
    if (error) return json(req, { error: "Service unavailable." }, 503);
    if (!doc || doc.upload_status !== "ready") return json(req, { error: "Not found." }, 404);
    const expectedPrefix = `${scope.orgId}/${scope.dealId}/${body.documentId}/`;
    if (!doc.storage_path.startsWith(expectedPrefix)) return json(req, { error: "Document unavailable." }, 503);
    const { data: signed, error: signedError } = await scope.admin.storage.from("tripp-deal-documents")
      .createSignedUrl(doc.storage_path, 60);
    if (signedError || !signed) return json(req, { error: "Document unavailable." }, 503);
    return json(req, { url: signed.signedUrl, expiresInSeconds: 60 });
  } catch {
    return json(req, { error: "Invalid request." }, 400);
  }
});
