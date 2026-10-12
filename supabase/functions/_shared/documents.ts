import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const allowedOrigins = (Deno.env.get("TRIPP_ALLOWED_ORIGINS") ?? "https://tripp-phi.vercel.app")
  .split(",").map((s) => s.trim()).filter(Boolean);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type Scope = { userId: string; orgId: string; dealId: string; role: "admin" | "member" | "viewer"; admin: ReturnType<typeof createClient<any, "public">> };

function cors(req: Request): Headers {
  const origin = req.headers.get("origin");
  const h = new Headers({ "Vary": "Origin", "Cache-Control": "no-store" });
  if (origin && allowedOrigins.includes(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info");
    h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  return h;
}
export function json(req: Request, data: unknown, status = 200): Response {
  const headers = cors(req);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(data), { status, headers });
}
export function preflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  const origin = req.headers.get("origin");
  return new Response(null, { status: origin && !allowedOrigins.includes(origin) ? 403 : 204, headers: cors(req) });
}
/** Reject overlong bodies even when Content-Length is absent or falsified. */
export async function readJsonBody(req: Request, maxBytes = 4096): Promise<unknown> {
  const length = req.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new Error("BODY_TOO_LARGE");
  if (!req.body) throw new Error("INVALID_BODY");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("BODY_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(merged)); }
  catch { throw new Error("INVALID_BODY"); }
}
export async function authorize(req: Request, orgId: string, dealId: string, write = false): Promise<Scope | Response> {
  if (!UUID.test(orgId) || !UUID.test(dealId)) return json(req, { error: "Invalid request." }, 400);
  if (!url || !publicKey || !secretKey) return json(req, { error: "Service unavailable." }, 503);
  const match = /^Bearer (\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!match) return json(req, { error: "Authentication required." }, 401);
  const identity = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await identity.auth.getUser(match[1]);
  if (authError || !auth.user) return json(req, { error: "Authentication required." }, 401);
  const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: membership, error: membershipError } = await admin.from("organization_memberships")
    .select("role").eq("organization_id", orgId).eq("user_id", auth.user.id).maybeSingle();
  if (membershipError) return json(req, { error: "Service unavailable." }, 503);
  const role = membership?.role;
  if (role !== "admin" && role !== "member" && role !== "viewer") return json(req, { error: "Not found." }, 404);
  if (write && role === "viewer") return json(req, { error: "Not found." }, 404);
  const { data: deal, error: dealError } = await admin.from("deals")
    .select("id").eq("id", dealId).eq("organization_id", orgId).maybeSingle();
  if (dealError) return json(req, { error: "Service unavailable." }, 503);
  if (!deal) return json(req, { error: "Not found." }, 404);
  return { userId: auth.user.id, orgId, dealId, role, admin };
}
