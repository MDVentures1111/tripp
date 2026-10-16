# TRIPP MVP malware scanner deployment

This folder contains a ClamAV-backed scanner gateway. It is not a serverless Vercel function: ClamAV needs a persistent daemon, signatures and memory.

## Deployment
1. Provision a container host with enough memory for ClamAV (plan for 2+ GiB and allow signature updates). Deploy `scanner/docker-compose.yml` from repository root with a unique `SCANNER_BEARER_SECRET` of at least 32 random characters.
2. The compose gateway binds to localhost only. Put an HTTPS reverse proxy in front of localhost:8080, exposing only `POST /scan` to the Supabase Edge Functions. Do not expose port 3310. Add ingress rate limits and avoid logging request bodies.
3. Set Supabase Edge Function secrets `TRIPP_MALWARE_SCANNER_URL=https://<gateway-host>/scan`, `TRIPP_MALWARE_SCANNER_SECRET=<same-secret>`, and `TRIPP_ENABLE_MALWARE_SCANNING=verified`. Never put these in Vite frontend environment variables or GitHub source.
4. Ensure the ClamAV signatures update on schedule and monitor daemon health. The gateway returns a clean verdict only from clamd, with the SHA-256 of the exact submitted bytes.
5. Uploaded files remain quarantined until scanning completes. If the scanner is down, finalize fails closed.

**Not provisioned by committing these files:** a container host, TLS domain, gateway secret, and Supabase secret configuration. Do not claim the scanner is live until these exist.
