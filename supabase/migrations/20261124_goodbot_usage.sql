-- Good Bot fair-use limits: one row per user per day (in the user's time zone).
-- Only the goodbot edge function (service role) can count a question; users can
-- read how many they've used today so the app can show what's left.

CREATE TABLE IF NOT EXISTS public.goodbot_usage (
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day          date        NOT NULL,
  count        int         NOT NULL DEFAULT 0,
  burst_start  timestamptz NOT NULL DEFAULT now(),
  burst_count  int         NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

ALTER TABLE public.goodbot_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read own goodbot usage" ON public.goodbot_usage;
CREATE POLICY "read own goodbot usage" ON public.goodbot_usage
  FOR SELECT USING (auth.uid() = user_id);

-- Today's date in the given IANA zone, falling back to UTC for unknown zones
CREATE OR REPLACE FUNCTION public.goodbot_today(p_tz text)
RETURNS date LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN (now() AT TIME ZONE coalesce(nullif(p_tz, ''), 'UTC'))::date;
EXCEPTION WHEN others THEN
  RETURN (now() AT TIME ZONE 'UTC')::date;
END $$;

-- Counts one question if the user is under both limits. Locks the row so
-- rapid taps can't slip past. Returns allowed, used and the reason when blocked.
CREATE OR REPLACE FUNCTION public.goodbot_use(
  p_user uuid, p_tz text, p_daily int, p_burst int, p_burst_secs int DEFAULT 60
)
RETURNS TABLE (allowed boolean, used int, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d   date := public.goodbot_today(p_tz);
  u public.goodbot_usage;
BEGIN
  INSERT INTO public.goodbot_usage (user_id, day) VALUES (p_user, d)
    ON CONFLICT (user_id, day) DO NOTHING;
  SELECT * INTO u FROM public.goodbot_usage WHERE user_id = p_user AND day = d FOR UPDATE;

  IF u.count >= p_daily THEN
    RETURN QUERY SELECT false, u.count, 'daily'; RETURN;
  END IF;

  IF u.burst_start < now() - make_interval(secs => p_burst_secs) THEN
    u.burst_start := now(); u.burst_count := 0;
  END IF;
  IF u.burst_count >= p_burst THEN
    RETURN QUERY SELECT false, u.count, 'burst'; RETURN;
  END IF;

  UPDATE public.goodbot_usage
     SET count = u.count + 1, burst_start = u.burst_start, burst_count = u.burst_count + 1
   WHERE user_id = p_user AND day = d;
  RETURN QUERY SELECT true, u.count + 1, NULL::text;
END $$;

-- Gives a question back when Good Bot failed to answer it
CREATE OR REPLACE FUNCTION public.goodbot_refund(p_user uuid, p_tz text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.goodbot_usage SET count = greatest(count - 1, 0)
   WHERE user_id = p_user AND day = public.goodbot_today(p_tz);
$$;

-- How many questions the signed-in user has asked today
CREATE OR REPLACE FUNCTION public.goodbot_used_today(p_tz text)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT count FROM public.goodbot_usage
                    WHERE user_id = auth.uid() AND day = public.goodbot_today(p_tz)), 0);
$$;

REVOKE ALL ON FUNCTION public.goodbot_use(uuid, text, int, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.goodbot_refund(uuid, text)             FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.goodbot_use(uuid, text, int, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.goodbot_refund(uuid, text)             TO service_role;
REVOKE ALL ON FUNCTION public.goodbot_used_today(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.goodbot_used_today(text) TO authenticated;
