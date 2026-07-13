-- Profile fields for the in-app profile editor (name, username, photo, prefs).
-- Without these columns the app's profile sync silently failed, so profile
-- info only lived in local storage and was lost on logout / next login.

alter table public.profiles
  add column if not exists display_name        text,
  add column if not exists username            text,
  add column if not exists photo_url           text,
  add column if not exists dietary_preferences jsonb   not null default '[]'::jsonb,
  add column if not exists household_size       integer not null default 1,
  add column if not exists expo_push_token     text;

-- Allow upsert of one's own profile row (the signup trigger normally creates it,
-- but upsert needs an insert policy for pre-existing users / edge cases).
drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);
