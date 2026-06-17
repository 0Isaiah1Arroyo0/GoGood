create table if not exists public.profiles (
  id                uuid        primary key references auth.users(id) on delete cascade,
  is_premium        boolean     not null default false,
  subscription_status text      not null default 'free' check (subscription_status in ('free','trialing','active','cancelled','expired')),
  rc_customer_id    text,
  subscription_expires_at timestamptz,
  updated_at        timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create profile on sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
