-- Monthly scan limits: receipt scans, photo scans and label scans (anything that
-- sends a picture to the AI). One row per user per calendar month (UTC).
-- Only the scan-receipt edge function (service role) can count a scan; users can
-- read how many they've used so the app can show what's left.

CREATE TABLE IF NOT EXISTS public.scan_usage (
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month    date NOT NULL,              -- first day of the month
  count    int  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);

ALTER TABLE public.scan_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read own scan usage" ON public.scan_usage;
CREATE POLICY "read own scan usage" ON public.scan_usage
  FOR SELECT USING (auth.uid() = user_id);

-- Counts one scan if the user is under their monthly limit. Locks the row so
-- rapid taps can't slip past.
CREATE OR REPLACE FUNCTION public.scan_use(p_user uuid, p_limit int)
RETURNS TABLE (allowed boolean, used int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  u public.scan_usage;
BEGIN
  INSERT INTO public.scan_usage (user_id, month) VALUES (p_user, m)
    ON CONFLICT (user_id, month) DO NOTHING;
  SELECT * INTO u FROM public.scan_usage WHERE user_id = p_user AND month = m FOR UPDATE;
  IF u.count >= p_limit THEN
    RETURN QUERY SELECT false, u.count; RETURN;
  END IF;
  UPDATE public.scan_usage SET count = u.count + 1 WHERE user_id = p_user AND month = m;
  RETURN QUERY SELECT true, u.count + 1;
END $$;

-- Gives a scan back when it failed (nothing found, image unreadable, server error)
CREATE OR REPLACE FUNCTION public.scan_refund(p_user uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.scan_usage SET count = greatest(count - 1, 0)
   WHERE user_id = p_user AND month = date_trunc('month', now() AT TIME ZONE 'UTC')::date;
$$;

-- How many scans the signed-in user has used this month
CREATE OR REPLACE FUNCTION public.scans_used_this_month()
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT count FROM public.scan_usage
                    WHERE user_id = auth.uid()
                      AND month = date_trunc('month', now() AT TIME ZONE 'UTC')::date), 0);
$$;

REVOKE ALL ON FUNCTION public.scan_use(uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scan_refund(uuid)   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scan_use(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.scan_refund(uuid)   TO service_role;
REVOKE ALL ON FUNCTION public.scans_used_this_month() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scans_used_this_month() TO authenticated;
