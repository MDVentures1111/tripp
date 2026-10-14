import { persistRejection } from "../_shared/document-lifecycle.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/documents.ts";
function check(c: boolean, m: string) { if (!c) throw new Error(m); }
const deps = (rpc: { data: unknown; error: unknown } | Error, status: string | null, reason: string | null = null) => {
  const calls = { removed: 0 };
  return { calls, d: {
    reject: () => rpc instanceof Error ? Promise.reject(rpc) : Promise.resolve(rpc),
    readStatus: () => Promise.resolve({ status, reason }),
    removeQuarantine: () => { calls.removed++; return Promise.resolve(); },
  } };
};

Deno.test("rejection persisted -> failed and quarantine removed", async () => {
  const { calls, d } = deps({ data: true, error: null }, "failed", "invalid_pdf");
  const r = await persistRejection("invalid_pdf", d);
  check(r.persisted && r.uploadStatus === "failed" && calls.removed === 1, JSON.stringify(r));
});
Deno.test("RPC error -> never reports failed, keeps quarantine", async () => {
  const { calls, d } = deps({ data: null, error: { message: "db down" } }, "processing");
  const r = await persistRejection("malware_detected", d);
  check(!r.persisted && r.uploadStatus === "processing" && calls.removed === 0, JSON.stringify(r));
});
Deno.test("RPC throws and status read fails -> processing", async () => {
  const { calls, d } = deps(new Error("network"), null);
  d.readStatus = () => Promise.reject(new Error("db down"));
  const r = await persistRejection("invalid_docx", d);
  check(!r.persisted && r.uploadStatus === "processing" && calls.removed === 0, JSON.stringify(r));
});
Deno.test("lost lease (RPC false) but another worker already failed it -> reports persisted DB reason", async () => {
  const { calls, d } = deps({ data: false, error: null }, "failed", "processing_timeout");
  const r = await persistRejection("invalid_pdf", d);
  check(r.persisted && r.uploadStatus === "failed" && r.failureReason === "processing_timeout" && calls.removed === 0, JSON.stringify(r));
});
Deno.test("lost lease and document became ready elsewhere -> reports ready, not failed", async () => {
  const { d } = deps({ data: false, error: null }, "ready");
  const r = await persistRejection("invalid_pdf", d);
  check(!r.persisted && r.uploadStatus === "ready", JSON.stringify(r));
});

Deno.test("CORS: wildcards ignored outside staging (production cannot inherit previews)", () => {
  const raw = "https://tripp-phi.vercel.app,https://tripp-*-mdventures.vercel.app";
  for (const env of [undefined, "production", "prod", "Staging", ""]) {
    const p = parseAllowedOrigins(raw, env);
    check(p.patterns.length === 0 && p.ignored.length === 1, "wildcard honored in env " + env);
    check(!isAllowedOrigin("https://tripp-git-x-mdventures.vercel.app", p), "preview allowed in env " + env);
    check(isAllowedOrigin("https://tripp-phi.vercel.app", p), "exact origin lost in env " + env);
  }
});
Deno.test("CORS: staging wildcard is narrow", () => {
  const p = parseAllowedOrigins("https://tripp-*-mdventures.vercel.app,https://*.evil.com,http://tripp-*.vercel.app,https://*", "staging");
  check(p.patterns.length === 1 && p.ignored.length === 3, JSON.stringify({ n: p.patterns.length, i: p.ignored }));
  check(isAllowedOrigin("https://tripp-git-d04-c-abc123-mdventures.vercel.app", p), "preview denied");
  for (const bad of ["https://tripp-x-mdventures.vercel.app.evil.com", "http://tripp-x-mdventures.vercel.app",
    "https://evil.com", "https://a.tripp-x-mdventures.vercel.app", "https://tripp--mdventures.vercel.app", "null"])
    check(!isAllowedOrigin(bad, p), "allowed " + bad);
});
Deno.test("CORS: default is production origin only", () => {
  const p = parseAllowedOrigins(undefined, undefined);
  check(p.exact.size === 1 && isAllowedOrigin("https://tripp-phi.vercel.app", p), "default changed");
});
