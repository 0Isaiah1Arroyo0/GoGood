-- Recipe imports (from a shared post, a pasted link, or a pasted caption), kept for
-- product analytics and for combined, anonymous food-trend reports.
--
-- Rules for anything that leaves the company (see the data plan):
--   * only combined numbers, never rows about one person
--   * every number covers at least 50 households
--   * users with profiles.insights_opt_out = true are left out entirely
-- Rows are deleted with the account (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS public.recipe_imports (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  via           text CHECK (via IN ('share', 'link', 'paste')),
  platform      text,            -- Instagram, TikTok, YouTube, Facebook, Pinterest, Web
  source_domain text,            -- e.g. instagram.com, budgetbytes.com
  creator       text,            -- public handle from the link when present, e.g. @chef.jo
  success       boolean NOT NULL,
  error_kind    text,            -- unreadable | no_recipe | error
  recipe_name   text,
  ingredients   text[],          -- ingredient lines as written in the recipe
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recipe_imports_created_idx ON public.recipe_imports (created_at DESC);

ALTER TABLE public.recipe_imports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insert own recipe imports" ON public.recipe_imports;
CREATE POLICY "insert own recipe imports" ON public.recipe_imports
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Opt-out of anonymous trend reports (Menu → Settings → Privacy)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS insights_opt_out boolean NOT NULL DEFAULT false;
