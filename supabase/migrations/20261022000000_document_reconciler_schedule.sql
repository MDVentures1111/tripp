-- D04-C REVIEW / STAGING ONLY. Do not apply to production without explicit approval.
-- Automatic reconciliation. Two independent pg_cron jobs, every 5 minutes:
--   1. tripp-document-expiry      pure SQL, no secrets, no network. Enforces the
--      3h abandoned-pending and 24h processing timeouts even if Edge Functions,
--      pg_net, Vault or the scanner are unavailable.
--   2. tripp-document-reconciler  calls the deal-document-reconcile Edge Function
--      via pg_net to resume scans/promotions and clean quarantine. It reads its URL
--      and bearer secret from Supabase Vault and is a no-op until both are set:
--        select vault.create_secret('<https://REF.supabase.co/functions/v1/deal-document-reconcile>','tripp_reconciler_url');
--        select vault.create_secret('<TRIPP_RECONCILER_SECRET value>','tripp_reconciler_secret');
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.tripp_expire_stale_documents(p_limit integer DEFAULT 500)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE pending_n integer; processing_n integer;
BEGIN
 IF p_limit < 1 OR p_limit > 5000 THEN RAISE EXCEPTION 'Invalid expiry batch size'; END IF;
 WITH s AS (
  SELECT id FROM public.deal_documents
  WHERE upload_status='pending' AND created_at<now()-interval '3 hours'
  ORDER BY created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
 UPDATE public.deal_documents d SET upload_status='failed', failure_reason='upload_abandoned'
 FROM s WHERE d.id=s.id;
 GET DIAGNOSTICS pending_n=ROW_COUNT;
 -- Only rows whose lease has expired: an active worker is never overtaken.
 WITH s AS (
  SELECT id FROM public.deal_documents
  WHERE upload_status='processing' AND created_at<now()-interval '24 hours'
    AND (finalize_lease_until IS NULL OR finalize_lease_until<now())
  ORDER BY created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
 UPDATE public.deal_documents d SET upload_status='failed', failure_reason='processing_timeout',
  finalize_token=NULL, finalize_lease_until=NULL
 FROM s WHERE d.id=s.id;
 GET DIAGNOSTICS processing_n=ROW_COUNT;
 RETURN pending_n+processing_n;
END $$;

CREATE OR REPLACE FUNCTION public.tripp_invoke_document_reconciler()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target text; bearer text;
BEGIN
 SELECT decrypted_secret INTO target FROM vault.decrypted_secrets WHERE name='tripp_reconciler_url' LIMIT 1;
 SELECT decrypted_secret INTO bearer FROM vault.decrypted_secrets WHERE name='tripp_reconciler_secret' LIMIT 1;
 IF target IS NULL OR bearer IS NULL OR length(bearer)<32 OR target !~ '^https://' THEN RETURN NULL; END IF;
 RETURN net.http_post(url:=target,
  headers:=jsonb_build_object('Authorization','Bearer '||bearer,'Content-Type','application/json'),
  body:='{}'::jsonb, timeout_milliseconds:=55000);
END $$;

REVOKE ALL ON FUNCTION public.tripp_expire_stale_documents(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.tripp_invoke_document_reconciler() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tripp_expire_stale_documents(integer) TO service_role;

SELECT cron.schedule('tripp-document-expiry','*/5 * * * *','SELECT public.tripp_expire_stale_documents(500)');
SELECT cron.schedule('tripp-document-reconciler','*/5 * * * *','SELECT public.tripp_invoke_document_reconciler()');
COMMIT;
