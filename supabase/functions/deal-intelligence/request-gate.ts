export function requestGate(req: Request, allowedOrigin: string): number {
  const origin = req.headers.get("origin");
  if (origin && origin !== allowedOrigin) return 403;
  if (req.method === "OPTIONS") return 204;
  if (req.method !== "POST") return 405;
  const length = req.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 2048)) return 413;
  if (!/^Bearer \S+$/i.test(req.headers.get("authorization") ?? "")) return 401;
  return 200;
}
