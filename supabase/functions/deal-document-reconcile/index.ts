import { inspectDocument, isInspectionCleared } from "../_shared/content-inspector.ts";
import { scanDocument } from "../_shared/malware-scanner.ts";
import { auditDocumentEvent } from "../_shared/document-audit.ts";
import { boundedReconcilerFetch } from "../_shared/reconciler-transport.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkDocument, MAX_DOCUMENT_BYTES } from "../_shared/file-validation.ts";

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
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: boundedReconcilerFetch } });
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
  // D04-C: bounded processing time. Documents stuck >24h (e.g. prolonged scanner outage)
  // become failed/processing_timeout so the broker can re-upload.
  const stuckCutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data: stuck } = await admin.from("deal_documents").select("id")
    .eq("upload_status", "processing").lt("created_at", stuckCutoff).lt("finalize_lease_until", new Date().toISOString()).limit(25);
  const timedOut = new Set<string>();
  for (const d of stuck ?? []) {
    const { data: failed, error } = await admin.rpc("tripp_fail_stuck_processing", { p_id: d.id });
    if (!error && failed) { timedOut.add(d.id); results.push({ id: d.id, outcome: "processing_timeout_failed" }); }
  }
  for (const d of processing ?? []) {
    if (timedOut.has(d.id)) continue;
    if(!withinBudget() || downloadBudget<d.file_size_bytes){results.push({id:d.id,outcome:"budget_deferred"});break;}
    downloadBudget-=d.file_size_bytes;
    const token = crypto.randomUUID();
    const { data: claimed, error: claimError } = await admin.rpc("tripp_claim_stale_document", { p_id: d.id, p_token: token });
    if (claimError || !claimed) { results.push({ id: d.id, outcome: "claim_skipped" }); continue; }
    const ext = d.mime_type === "application/pdf" ? "pdf" :
      d.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "docx" : null;
    const expectedPath = ext && `${d.organization_id}/${d.deal_id}/${d.id}/source.${ext}`;
    if (!UUID.test(d.id) || !ext || !expectedPath || d.storage_path !== expectedPath) {
      results.push({ id: d.id, outcome: "invalid_binding_manual_review" }); continue;
    }
    const quarantine = `${d.organization_id}/${d.deal_id}/${d.id}/quarantine.${ext}`;
    const reject = async (reason: string, outcome: string) => {
      const { data: rejected } = await admin.rpc("tripp_reject_document_finalize", { p_id: d.id, p_token: token, p_reason: reason });
      if (rejected) await admin.storage.from(BUCKET).remove([quarantine]);
      results.push({ id: d.id, outcome: rejected ? outcome : outcome + "_unrecorded" });
    };
    // Source exists when promotion happened before a crash; otherwise resume from quarantine
    // (e.g. finalize deferred because the scanner was unavailable).
    let fromQuarantine = false;
    let { data: blob, error: storageError } = await admin.storage.from(BUCKET).download(expectedPath);
    if (storageError || !blob) {
      ({ data: blob, error: storageError } = await admin.storage.from(BUCKET).download(quarantine));
      fromQuarantine = true;
    }
    if (storageError || !blob) {
      // Do not fail automatically: storage might be temporarily unavailable. The 24h timeout bounds this.
      results.push({ id: d.id, outcome: "source_unavailable_retry_later" }); continue;
    }
    if (blob.size > MAX_DOCUMENT_BYTES) { await reject("file_too_large", "oversize_rejected"); continue; }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length !== d.file_size_bytes) { await reject("size_mismatch", "size_mismatch_rejected"); continue; }
    const validation = checkDocument(ext, bytes);
    if (!validation.ok) { await reject(validation.reason, "validation_rejected"); continue; }
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
    if (!d.verified_sha256) {
      const { data: bound, error: bindError } = await admin.rpc("tripp_bind_document_digest", { p_id: d.id, p_token: token, p_digest: digest });
      if (bindError || !bound) { results.push({ id: d.id, outcome: "digest_binding_failed" }); continue; }
    } else if (d.verified_sha256 !== digest) { await reject("integrity_mismatch", "digest_mismatch_rejected"); continue; }
    // Recovery cannot mark READY without persisted clean scan evidence.
    const { data: scanRecord } = await admin.from("deal_documents").select("malware_scan_sha256").eq("id",d.id).single();
    if (scanRecord?.malware_scan_sha256 !== digest) {
      const endpoint = Deno.env.get("TRIPP_MALWARE_SCANNER_URL");
      const secret = Deno.env.get("TRIPP_MALWARE_SCANNER_SECRET");
      if (Deno.env.get("TRIPP_ENABLE_MALWARE_SCANNING") !== "verified" || !endpoint || !secret) {
        results.push({id:d.id,outcome:"scan_unavailable_retry_later"}); continue;
      }
      if (!withinBudget()) { results.push({id:d.id,outcome:"budget_deferred"}); break; }
      let verdict;
      try { verdict = await scanDocument(bytes,digest,d.mime_type,{endpoint,secret}); }
      catch { results.push({id:d.id,outcome:"scan_unavailable_retry_later"}); continue; }
      if (verdict.verdict === "malicious") { await reject("malware_detected", "malware_rejected"); continue; }
      if (verdict.verdict !== "clean") { await reject("scan_inconclusive", "scan_inconclusive_rejected"); continue; }
      const {data:bound,error:scanError}=await admin.rpc("tripp_bind_document_clean_scan",{
        p_id:d.id,p_token:token,p_digest:digest,p_engine:verdict.engine
      });
      if (scanError || !bound) { results.push({id:d.id,outcome:"scan_binding_failed"}); continue; }
    }
    if (Deno.env.get("TRIPP_REQUIRE_CONTENT_INSPECTION") === "verified") {
      const endpoint = Deno.env.get("TRIPP_CONTENT_INSPECTOR_URL");
      const secret = Deno.env.get("TRIPP_CONTENT_INSPECTOR_SECRET");
      if (!endpoint || !secret || !withinBudget()) {
        results.push({ id: d.id, outcome: "inspection_unavailable_retry_later" }); continue;
      }
      let inspection;
      try { inspection = await inspectDocument(bytes, digest, d.mime_type, { endpoint, secret }); }
      catch { results.push({ id: d.id, outcome: "inspection_unavailable_retry_later" }); continue; }
      if (!isInspectionCleared(inspection, digest)) { await reject("inspection_rejected", "inspection_rejected"); continue; }
      const { data: bound, error: bindingError } = await admin.rpc("tripp_bind_document_content_inspection", { p_id: d.id, p_token: token, p_digest: digest, p_engine: inspection.engine, p_policy: inspection.policyVersion });
      if (bindingError || !bound) { results.push({ id: d.id, outcome: "inspection_binding_failed" }); continue; }
    }
    if (fromQuarantine) {
      const { data: leaseValid } = await admin.rpc("tripp_document_finalize_lease_valid", { p_id: d.id, p_token: token });
      if (!leaseValid) { results.push({ id: d.id, outcome: "lease_expired_retry_later" }); continue; }
      const { error: promoteError } = await admin.storage.from(BUCKET).upload(expectedPath, bytes, { contentType: d.mime_type, upsert: false });
      if (promoteError) { results.push({ id: d.id, outcome: "promote_failed_retry_later" }); continue; }
    }
    const { data: finished, error: finishError } = await admin.rpc("tripp_finish_document_finalize", {
      p_id: d.id, p_token: token, p_success: true,
    });
    if (!finished || finishError) { results.push({ id: d.id, outcome: "finish_failed" }); continue; }
    await admin.storage.from(BUCKET).remove([quarantine]);
    results.push({ id: d.id, outcome: "recovered_ready" });
  }
  // Expired pending records are failed atomically. Quarantine removal is deferred
  // until signed-upload tokens have expired, to avoid racing an active upload.
  const { data: abandoned, error: pendingError } = await admin.from("deal_documents")
    .select("id").eq("upload_status", "pending").lt("created_at", pendingCutoff).limit(25);
  if (pendingError) { auditDocumentEvent("reconciler_run",{outcome:"error",status:503,reason:"pending_query_failed"}); return respond(503, { error: "Pending query failed", results }); }
  for (const d of abandoned ?? []) {
    if(!withinBudget()) break;
    const { data: failed, error } = await admin.rpc("tripp_fail_abandoned_pending", { p_id: d.id });
    results.push({ id: d.id, outcome: !error && failed ? "abandoned_failed" : "abandoned_skipped" });
  }
  const retentionCutoff = new Date(Date.now() - 4 * 60 * 60_000).toISOString();
  const { data: stale, error: staleError } = await admin.from("deal_documents")
    .select("id,organization_id,deal_id,mime_type,upload_status")
    .in("upload_status", ["ready", "failed"]).lt("created_at", retentionCutoff).limit(25);
  if (staleError) { auditDocumentEvent("reconciler_run",{outcome:"error",status:503,reason:"cleanup_query_failed"}); return respond(503, { error: "Cleanup query failed", results }); }
  for (const d of stale ?? []) {
    if(!withinBudget()) break;
    const ext = d.mime_type === "application/pdf" ? "pdf" :
      d.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "docx" : null;
    if (!ext || !UUID.test(d.id) || !UUID.test(d.organization_id) || !UUID.test(d.deal_id)) continue;
    const quarantine = `${d.organization_id}/${d.deal_id}/${d.id}/quarantine.${ext}`;
    const { error } = await admin.storage.from(BUCKET).remove([quarantine]);
    results.push({ id: d.id, outcome: error ? "quarantine_cleanup_failed" : "quarantine_cleanup_attempted" });
  }
  const {data:pruned,error:pruneError}=await admin.rpc("tripp_prune_document_admissions",{p_limit:1000});
  if(pruneError) auditDocumentEvent("admission_cleanup",{outcome:"error",status:503,reason:"prune_rpc_failed"});
  else auditDocumentEvent("admission_cleanup",{outcome:"completed",status:200,reason:"pruned="+pruned});
  auditDocumentEvent("reconciler_run",{outcome:"completed",status:200,reason:
    "scanned="+((processing?.length??0)+(abandoned?.length??0)+(stale?.length??0))+
    ";processed="+results.length+";deferred="+results.filter(r=>r.outcome==="budget_deferred").length});
  return respond(200, { scanned: (processing?.length ?? 0) + (abandoned?.length ?? 0) + (stale?.length ?? 0), results });
});
