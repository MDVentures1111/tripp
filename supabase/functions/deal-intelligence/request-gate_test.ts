import { requestGate } from "./request-gate.ts";
const allowed = "https://tripp-phi.vercel.app";
function check(method: string, origin: string | null, authorization: string | null, expected: number, length?: string) {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  if (authorization) headers.set("authorization", authorization);
  if (length) headers.set("content-length", length);
  const result = requestGate(new Request("https://example.test", { method, headers }), allowed);
  if (result !== expected) throw Error(method + " expected " + expected + " got " + result);
}
Deno.test("preflight rejects foreign origin", () => check("OPTIONS", "https://attacker.test", null, 403));
Deno.test("preflight allows trusted origin", () => check("OPTIONS", allowed, null, 204));
Deno.test("methods other than POST rejected", () => check("GET", allowed, null, 405));
Deno.test("missing token rejected", () => check("POST", allowed, null, 401));
Deno.test("malformed token rejected", () => check("POST", allowed, "Bearer ", 401));
Deno.test("oversize body rejected", () => check("POST", allowed, "Bearer abc", 413, "2049"));
Deno.test("valid request passes initial gate", () => check("POST", allowed, "Bearer abc", 200));
