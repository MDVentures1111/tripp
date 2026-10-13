# D04-B4-B.3 — Real ClamAV gateway staging handoff

Status: **implementation committed to review branch; live staging validation NOT performed**.

Files:
- `scanner/gateway.ts`: isolated authenticated HTTP gateway, SHA-256 verification, bounded 20 MiB request, ClamAV `zINSTREAM` TCP protocol, fail-closed verdict.
- `scanner/staging_test.ts`: real-engine clean, standard antivirus test signature, authorization, and digest mismatch probes.

Required staging infrastructure:
1. Deploy `clamav/clamav:stable` with a current signature database. Keep TCP port 3310 private.
2. Run gateway in a separate isolated container with `SCANNER_BEARER_SECRET` (>=32 characters), `CLAMD_HOST`, `CLAMD_PORT=3310`, and `PORT=8080`.
3. Expose gateway to Edge Functions only over authenticated HTTPS or private trusted networking. Do not expose raw clamd TCP or use CI fixture secrets.
4. Run `deno run --allow-env --allow-net scanner/staging_test.ts` with `SCANNER_TEST_URL` and `SCANNER_BEARER_SECRET` pointed at staging. Capture results.
5. Confirm actual signature freshness, scanner failure behavior, timeouts, maximum file sizes, encrypted archives, PDF and DOCX adversarial corpus, telemetry, and rollback.

Known blockers:
- No connected staging scanner infrastructure or validated live test results.
- Gateway prototype requires hardened request streaming and cancellation under slow clients / clamd timeouts before production.
- ClamAV alone does not replace bounded PDF/DOCX structural inspection.
- Do not enable production uploads or deploy review migrations.

Release decision: **NO-GO** until real staging evidence is recorded and independently reviewed.
