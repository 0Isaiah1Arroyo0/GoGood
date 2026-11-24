-- Scans that found no items: what Claude replied on each try, so failures can be diagnosed.
CREATE TABLE IF NOT EXISTS public.scan_failures (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode          text,
  location_hint text,
  image_bytes   int,
  ocr_chars     int,
  tries         jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.scan_failures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insert own scan failures" ON public.scan_failures;
CREATE POLICY "insert own scan failures" ON public.scan_failures
  FOR INSERT WITH CHECK (auth.uid() = user_id);
