import { inspectDocument, isInspectionCleared, InspectionUnavailable } from "../_shared/content-inspector.ts";
const digest = "a".repeat(64);
const bytes = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
const config = { endpoint: "http://127.0.0.1:9999/inspect", secret: "local-test-secret-32-characters-minimum" };
function check(ok: boolean, msg: string) { if (!ok) throw Error(msg); }
Deno.test("Inspector attestation is digest-bound, versioned and strictly safe", () => {
  const safe = { verdict: "safe" as const, sha256: digest, engine: "pdf-inspector:1", policyVersion: "policy:1" };
  check(isInspectionCleared(safe, digest), "valid safe attestation denied");
  check(!isInspectionCleared({ ...safe, verdict: "unsafe" }, digest), "unsafe verdict cleared");
  check(!isInspectionCleared({ ...safe, verdict: "indeterminate" }, digest), "indeterminate verdict cleared");
  check(!isInspectionCleared({ ...safe, sha256: "b".repeat(64) }, digest), "wrong digest cleared");
  check(!isInspectionCleared({ ...safe, policyVersion: "" }, digest), "missing policy cleared");
});
Deno.test("Inspector rejects insecure endpoints and invalid input without network", async () => {
  for (const endpoint of ["http://inspector.example/inspect", "file:///tmp/inspect", "http://169.254.169.254/inspect"]) {
    let rejected = false;
    try { await inspectDocument(bytes, digest, "application/pdf", { ...config, endpoint }); }
    catch (e) { rejected = e instanceof InspectionUnavailable; }
    check(rejected, "unsafe inspector endpoint accepted: " + endpoint);
  }
  let rejected = false;
  try { await inspectDocument(bytes, "wrong", "application/pdf", config); }
  catch (e) { rejected = e instanceof InspectionUnavailable; }
  check(rejected, "invalid digest accepted");
});
