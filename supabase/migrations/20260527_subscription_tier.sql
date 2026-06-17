-- Add subscription_tier to distinguish monthly vs annual plans
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_tier text NOT NULL DEFAULT 'free'
    CHECK (subscription_tier IN ('free', 'monthly', 'annual'));

-- Drop the old scan-limit columns if they exist (no longer used)
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS receipt_scans_this_month,
  DROP COLUMN IF EXISTS scans_reset_at;
