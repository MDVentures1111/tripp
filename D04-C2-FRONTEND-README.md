# TRIPP D04-C.2 frontend — review candidate

Source: user-provided vb.do ZIP, with frontend-only changes. No backend or migration changes.

## Implemented
- Deal-scoped document list and refresh; secure signed download requested per click
- PDF/DOCX upload validation, initiate → signed storage upload → finalize → list refresh
- Inspection states and reason descriptions; elapsed-time polling 3s/15s/60s
- Viewer read-only presentation; documents navigation points to Deals
- Explicit Supabase configuration; fail closed if absent, block known production project outside production mode

## Important limitations / release gates
- Not connected to staging; no real integration testing.
- npm install could not complete in the execution environment (network timeout); full TypeScript/Vite build remains unverified. Existing npm scripts: `npm run typecheck`, `npm run build`.
- Document list endpoint top-level shape is assumed to be `[]` or `{ documents: [] }`; verify against Hark's actual staging response before approval.
- Requires VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_APP_ENV. Use a distinct staging project for previews. No fallback to production.
- Confirm storage signed upload behavior, 202 processing and 422 rejection against deployed staging.
- No production deployment, GitHub commit, or branch mutation has been performed.

## Next steps
1. Review diff and integrate to frontend branch after explicit approval.
2. Configure isolated staging environment and run npm ci/install, npm run typecheck, npm run build.
3. Mock and integration-test lifecycle and access roles before release.

## GitHub Actions verification
- `.github/workflows/frontend-verify.yml` runs on pushes to `frontend`, PRs targeting `main`, or manual dispatch.
- CI runs `npm install`, `npm run typecheck`, and `npm run build`.
- No production Supabase variables should be supplied to this job.
- CI success validates compilation only, not runtime integration or deployment.
