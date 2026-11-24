-- Ratings and written feedback from the "Rate Go Good" sheet. Users can only add
-- their own; read them in the Supabase dashboard (Table editor → app_feedback).
CREATE TABLE IF NOT EXISTS public.app_feedback (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rating      int CHECK (rating BETWEEN 1 AND 5),
  message     text CHECK (char_length(message) <= 4000),
  app_version text,
  platform    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insert own feedback" ON public.app_feedback;
CREATE POLICY "insert own feedback" ON public.app_feedback
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
