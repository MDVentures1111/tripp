# Authenticated tenant isolation smoke test

This is a read-only test of the real Supabase PostgREST API. It does not invoke OpenRouter or the undeployed Deal Intelligence Edge Function.

Prepare two existing non-privileged test accounts, each a member of a different organization, with one deal per organization. Provide their short-lived user access tokens, the Supabase public anon key, URL, and respective deal IDs as environment variables:

- TRIPP_TEST_SUPABASE_URL
- TRIPP_TEST_ANON_KEY
- TRIPP_TEST_USER_A_JWT
- TRIPP_TEST_USER_B_JWT
- TRIPP_TEST_DEAL_A_ID
- TRIPP_TEST_DEAL_B_ID

Run locally: `deno run --allow-env --allow-net supabase/tests/live_tenant_api_test.ts`.

Expected: both accounts read their own deal and get an empty result for the other account's deal. Never commit access tokens or service-role credentials. The test deliberately does not create, update, or delete data.

**Scope:** This verifies PostgREST/RLS only. The Edge Function's complete authorization, quota consumption, and OpenRouter non-invocation on denial require a separate end-to-end test after the function is available in an isolated environment. No production deployment is authorized by this test.
