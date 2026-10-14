/** B4-B.6: typed boundary for a separately sandboxed document-content inspector.
 * This module DOES NOT parse untrusted PDF/DOCX or confer clearance on its own.
 * Caller must fail closed if this inspection is mandatory but not configured.
 */
export type InspectionVerdict = "safe" | "unsafe" | "indeterminate";
export type InspectionResult = {
  verdict: InspectionVerdict;
  sha256: string;
  engine: string;
  policyVersion: string;
};
export class InspectionUnavailable extends Error {
  constructor(message = "Document inspection unavailable") { super(message); this.name = "InspectionUnavailable"; }
}
const DIGEST = /^[a-f0-9]{64}$/;
const MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
export function isInspectionCleared(result: InspectionResult, digest: string): boolean {
  return result.verdict === "safe" && result.sha256 === digest &&
    DIGEST.test(result.sha256) && /^[a-zA-Z0-9._:-]{1,100}$/.test(result.engine) &&
    /^[a-zA-Z0-9._:-]{1,100}$/.test(result.policyVersion);
}
export async function inspectDocument(
  bytes: Uint8Array,
  digest: string,
  mime: string,
  config: { endpoint: string; secret: string; timeoutMs?: number },
): Promise<InspectionResult> {
  if (!DIGEST.test(digest) || !MIME.has(mime) || bytes.length === 0 || bytes.length > 20_971_520)
    throw new InspectionUnavailable("Invalid inspection input");
  let url: URL;
  try { url = new URL(config.endpoint); } catch { throw new InspectionUnavailable("Invalid inspector URL"); }
  // Production requires HTTPS; loopback HTTP is permitted for isolated CI.
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (["127.0.0.1", "localhost"].includes(url.hostname) || (Deno.env.get("TRIPP_CI_INSPECTOR_FIXTURE") === "isolated" && /^172\\.(?:1[6-9]|2[0-9]|3[01])\\.\\d{1,3}\\.\\d{1,3}$/.test(url.hostname)))))
    throw new InspectionUnavailable("Inspector must use HTTPS");
  if (!config.secret || config.secret.length < 32) throw new InspectionUnavailable("Invalid inspector secret");
  const timeoutMs = Math.min(Math.max(config.timeoutMs ?? 15000, 1000), 30000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: "Bearer " + config.secret,
        "content-type": mime,
        "x-content-sha256": digest,
      },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch { throw new InspectionUnavailable(); }
  if (!response.ok) throw new InspectionUnavailable("Inspector did not return a successful response");
  let payload: unknown;
  try {
    if (Number(response.headers.get("content-length") ?? "0") > 4096)
      throw new Error("Inspector response too large");
    const text = await response.text();
    if (text.length > 4096) throw new Error("Inspector response too large");
    payload = JSON.parse(text);
  } catch { throw new InspectionUnavailable("Invalid inspector response"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new InspectionUnavailable("Invalid inspector response");
  const obj = payload as Record<string, unknown>;
  if (!["safe", "unsafe", "indeterminate"].includes(String(obj.verdict)) ||
      typeof obj.sha256 !== "string" || obj.sha256 !== digest ||
      typeof obj.engine !== "string" || typeof obj.policyVersion !== "string")
    throw new InspectionUnavailable("Unverifiable inspector response");
  const result: InspectionResult = {
    verdict: obj.verdict as InspectionVerdict,
    sha256: obj.sha256,
    engine: obj.engine,
    policyVersion: obj.policyVersion,
  };
  if (!DIGEST.test(result.sha256) ||
      !/^[a-zA-Z0-9._:-]{1,100}$/.test(result.engine) ||
      !/^[a-zA-Z0-9._:-]{1,100}$/.test(result.policyVersion))
    throw new InspectionUnavailable("Invalid inspection attestation");
  return result;
}
