-- Isolated TRIPP AI quota. This migration is not part of the D04 document deployment.
CREATE TABLE IF NOT EXISTS public.deal_ai_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_day date NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count BETWEEN 0 AND 10),
  PRIMARY KEY (user_id, usage_day)
);
ALTER TABLE public.deal_ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deal_ai_usage FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.consume_deal_ai_quota()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  new_count integer;
BEGIN
  IF actor IS NULL THEN RETURN false; END IF;
  INSERT INTO public.deal_ai_usage (user_id, usage_day, count)
  VALUES (actor, (now() AT TIME ZONE 'UTC')::date, 1)
  ON CONFLICT (user_id, usage_day) DO UPDATE
    SET count = public.deal_ai_usage.count + 1
    WHERE public.deal_ai_usage.count < 10
  RETURNING count INTO new_count;
  RETURN new_count IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.consume_deal_ai_quota() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_deal_ai_quota() TO authenticated;
