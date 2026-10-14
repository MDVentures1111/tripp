import { json, preflight, readJsonBody, UUID } from "../_shared/documents.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
Deno.test("UUID validation rejects malformed identifiers", () => {
  assert(UUID.test("550e8400-e29b-41d4-a716-446655440000"), "valid UUID rejected");
  assert(!UUID.test("../other-org"), "path injection accepted");
  assert(!UUID.test(""), "empty UUID accepted");
});
Deno.test("preflight rejects untrusted origin", () => {
  const res = preflight(new Request("https://example.test", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
  assert(res?.status === 403, "unexpected preflight result");
  assert(!res.headers.has("Access-Control-Allow-Origin"), "untrusted origin allowed");
});
Deno.test("JSON responses are no-store and do not reflect arbitrary origins", () => {
  const res = json(new Request("https://example.test", { headers: { origin: "https://evil.example" } }), { ok: true });
  assert(res.headers.get("Cache-Control") === "no-store", "response can be cached");
  assert(!res.headers.has("Access-Control-Allow-Origin"), "untrusted origin reflected");
});
Deno.test("bounded JSON rejects overlong payload with no Content-Length", async () => {
  const req = new Request("https://example.test", { method: "POST", body: JSON.stringify({ x: "a".repeat(5000) }) });
  let rejected = false;
  try { await readJsonBody(req, 4096); } catch (e) { rejected = e instanceof Error && e.message === "BODY_TOO_LARGE"; }
  assert(rejected, "overlong body accepted");
});
Deno.test("bounded JSON accepts valid small object", async () => {
  const req = new Request("https://example.test", { method: "POST", body: JSON.stringify({ documentId: "ok" }) });
  const parsed = await readJsonBody(req);
  assert(typeof parsed === "object" && parsed !== null && (parsed as { documentId?: string }).documentId === "ok", "body parsing failed");
});

Deno.test("D04-C: error responses always carry a machine-readable code", async () => {
 const { json } = await import("../_shared/documents.ts");
 const req = new Request("https://example.test", { headers: { origin: "https://evil.example" } });
 const body = await json(req, { error: "Not found." }, 404).json();
 if (body.code !== "not_found") throw new Error("missing default code");
 const explicit = await json(req, { error: "x", code: "uploads_disabled" }, 503).json();
 if (explicit.code !== "uploads_disabled") throw new Error("explicit code overwritten");
});
