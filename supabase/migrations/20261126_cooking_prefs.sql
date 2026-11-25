-- Cooking preferences for Good Bot (allergies, dislikes, equipment, time, goals,
-- skill, cuisines, spice, who they cook for), saved with the profile so they come
-- back on a new phone. Covered by the existing "own profile" policies.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cooking_prefs jsonb;
