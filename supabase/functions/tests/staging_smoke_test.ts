/**
 * Read-only staging smoke tests. Does not create documents or change storage.
 * Run: TRIPP_TEST_SUPABASE_URL=https://<staging-ref>.supabase.co
 *      TRIPP_TEST_ANON_KEY=<staging-anon>
 *      TRIPP_TEST_ORG_ID=<staging-org-uuid>
 *      TRIPP_TEST_DEAL_ID=<staging-deal-uuid>
 *      TRIPP_TEST_ENVIRONMENT=isolated-staging
 *      deno test --allow-env --allow-net supabase/functions/tests/staging_smoke_test.ts
 *
 * NEVER use a production project. Requires Edge Functions deployed to staging.
 */
const env = Deno.env.get;
const staging = env("TRIPP_TEST_ENVIRONMENT") === "isolated-staging";
const url = env("TRIPP_TEST_SUPABASE_URL");
const key = env("TRIPP_TEST_ANON_KEY");
const org = env("TRIPP_TEST_ORG_ID");
const deal = env("TRIPP_TEST_DEAL_ID");
if (!staging || !url || !key || !org || !deal || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url))
  throw new Error("Explicit isolated staging URL, anon key, org, deal and environment marker required.");
const base = url.replace(/\/$/, "") + "/functions/v1";
const headers = { apikey: key, "Content-Type": "application/json" };
async function call(endpoint: string, method: string, body?: unknown, bearer?: string) {
  const r = await fetch(base + endpoint, {
    method, headers: { ...headers, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, text: await r.text() };
}
function assertStatus(actual: number, expected: number, context: string) {
  if (actual !== expected) throw new Error(`${context}: expected ${expected}, received ${actual}`);
}
Deno.test("document listing rejects unauthenticated caller", async () => {
  const q = `?organizationId=${encodeURIComponent(org!)}&dealId=${encodeURIComponent(deal!)}`;
  const r = await call("/deal-document-list" + q, "GET");
  assertStatus(r.status, 401, "list no bearer");
});
Deno.test("document download rejects unauthenticated caller", async () => {
  const r = await call("/deal-document-download", "POST", {
    organizationId: org, dealId: deal, documentId: crypto.randomUUID(),
  });
  assertStatus(r.status, 401, "download no bearer");
});
Deno.test("document finalize rejects unauthenticated caller", async () => {
  const r = await call("/deal-document-upload-finalize", "POST", {
    organizationId: org, dealId: deal, documentId: crypto.randomUUID(),
  });
  assertStatus(r.status, 401, "finalize no bearer");
});
Deno.test("reconciler denies requests without secret", async () => {
  const r = await call("/deal-document-reconcile", "POST");
  assertStatus(r.status, 401, "reconcile no secret");
});
Deno.test("upload issuance stays disabled by default", async () => {
  const r = await call("/deal-document-upload-initiate", "POST", {
    organizationId: org, dealId: deal, filename: "test.pdf", documentType: "other",
    fileSizeBytes: 128, fileKind: "pdf",
  });
  assertStatus(r.status, 503, "initiate disabled");
});
