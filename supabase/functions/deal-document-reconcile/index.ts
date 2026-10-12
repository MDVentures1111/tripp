import { auditDocumentEvent } from "../_shared/document-audit.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { validatePdf, validateDocx, MAX_DOCUMENT_BYTES } from "../_shared/file-validation.ts";

const BUCKET = "tripp-deal-documents";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const respond = (status: number, result: unknown) => Response.json(result, { status, headers: { "Cache-Control": "no-store" } });
Deno.serve(async (req) => {
  if (req.method !== "POST") return respond(405, { error: "Method not allowed" });
  // Separate automation secret; never use a browser session or expose service role key.
  const expected = Deno.env.get("TRIPP_RECONCILER_SECRET");
  if (!expected || expected.length < 32 || req.headers.get("authorization") !== `Bearer ${expected}`)
    return respond(401, { error: "Unauthorized" });
  if (Deno.env.get("TRIPP_ENABLE_RECONCILER") !== "verified")
    return respond(503, { error: "Reconciler disabled pending verification" });
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return respond(503, { error: "Missing configuration" });
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const deadline = Date.now()+45_000;
  let downloadBudget=100*1024*1024;
  const withinBudget=()=>Date.now()<deadline;
  const cutoff = new Date(Date.now() - 12 * 60_000).toISOString();
  const pendingCutoff = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
  const { data: processing, error: queryError } = await admin.from("deal_documents")
    .select("id,organization_id,deal_id,storage_path,mime_type,file_size_bytes,upload_status,finalize_lease_until,verified_sha256")
    .eq("upload_status", "processing").lt("finalize_lease_until", cutoff).order("updated_at").limit(25);
  if (queryError) { auditDocumentEvent("reconciler_run",{outcome:"error",status:503,reason:"processing_query_failed"}); return respond(503, { error: "Query failed" }); }
  const results: Array<{ id: string; outcome: string }> = [];
  for (const d of processing ?? []) {
    if(!withinBudget() || downloadBudget<d.file_size_bytes){results.push({id:d.id,outcome:"budget_deferred"});break;}
    downloadBudget-=d.file_size_bytes;
    const token = crypto.randomUUID();
    const { data: claimed, error: claimError } = await admin.rpc("tripp_claim_stale_document", { p_id: d.id, p_token: token });
    if (claimError || !claimed) { results.push({ id: d.id, outcome: "claim_skipped" }); continue; }
    const ext = d.mime_type === "application/pdf" ? "pdf" :
      d.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "docx" : null;
    const expectedPath = ext && `${d.organization_id}/${d.deal_id}/${d.id}/source.${ext}`;
    if (!UUID.test(d.id) || !expectedPath || d.storage_path !== expectedPath) {
      results.push({ id: d.id, outcome: "invalid_binding_manual_review" }); continue;
    }
    const { data: blob, error: storageError } = await admin.storage.from(BUCKET).download(expectedPath);
    if (storageError || !blob) {
      // Do not mark failed automatically: source might be temporarily unavailable.
      results.push({ id: d.id, outcome: "source_unavailable_retry_later" }); continue;
    }
    if (blob.size > MAX_DOCUMENT_BYTES) { results.push({ id: d.id, outcome: "oversize_manual_review" }); continue; }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const valid = bytes.length === d.file_size_bytes && (ext === "pdf" ? validatePdf(bytes) : validateDocx(bytes));
    if (!valid) { results.push({ id: d.id, outcome: "validation_failed_manual_review" }); continue; }
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
    if (!d.verified_sha256 || d.verified_sha256 !== digest) { results.push({id:d.id,outcome:'digest_mismatch_manual_review'}); continue; }
    const { data: finished, error: finishError } = await admin.rpc("tripp_finish_document_finalize", {
      p_id: d.id, p_token: token, p_success: true,
    });
    if (!finished || finishError) { results.push({ id: d.id, outcome: "finish_failed" }); continue; }
    const quarantine = `${d.organization_id}/${d.deal_id}/${d.id}/quarantine.${ext}`;
    await admin.storage.from(BUCKET).remove([quarantine]);
    results.push({ id: d.id, outcome: "recovered_ready" });
  }
  // Expired pending records are failed atomically. Quarantine removal is deferred
  // until signed-upload tokens have expired, to avoid racing an active upload.
  const { data: abandoned, error: pendingError } = await admin.from("deal_documents")
    .select("id").eq("upload_status", "pending").lt("created_at", pendingCutoff).limit(25);
  if (pendingError) return respond(503, { error: "Pending query failed", results });
  for (const d of abandoned ?? []) {
    if(!withinBudget()) break;
    const { data: failed, error } = await admin.rpc("tripp_fail_abandoned_pending", { p_id: d.id });
    results.push({ id: d.id, outcome: !error && failed ? "abandoned_failed" : "abandoned_skipped" });
  }
  const retentionCutoff = new Date(Date.now() - 4 * 60 * 60_000).toISOString();
  const { data: stale, error: staleError } = await admin.from("deal_documents")
    .select("id,organization_id,deal_id,mime_type,upload_status")
    .in("upload_status", ["ready", "failed"]).lt("created_at", retentionCutoff).limit(25);
  if (staleError) return respond(503, { error: "Cleanup query failed", results });
  for (const d of stale ?? []) {
    if(!withinBudget()) break;
    const ext = d.mime_type === "application/pdf" ? "pdf" :
      d.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "docx" : null;
    if (!ext || !UUID.test(d.id) || !UUID.test(d.organization_id) || !UUID.test(d.deal_id)) continue;
    const quarantine = `${d.organization_id}/${d.deal_id}/${d.id}/quarantine.${ext}`;
    const { error } = await admin.storage.from(BUCKET).remove([quarantine]);
    results.push({ id: d.id, outcome: error ? "quarantine_cleanup_failed" : "quarantine_cleanup_attempted" });
  }
  auditDocumentEvent("reconciler_run",{outcome:"completed",status:200,reason:
    "scanned="+((processing?.length??0)+(abandoned?.length??0)+(stale?.length??0))+
    ";processed="+results.length+";deferred="+results.filter(r=>r.outcome==="budget_deferred").length});
  return respond(200, { scanned: (processing?.length ?? 0) + (abandoned?.length ?? 0) + (stale?.length ?? 0), results });
});
