-- store_connections: OAuth tokens for third-party grocery store integrations
create table if not exists public.store_connections (
  user_id             uuid        not null references auth.users(id) on delete cascade,
  store               text        not null,
  oauth_access_token  text        not null,
  oauth_refresh_token text,
  oauth_expires_at    timestamptz,
  last_sync_at        timestamptz,
  created_at          timestamptz not null default now(),
  primary key (user_id, store)
);

alter table public.store_connections enable row level security;

create policy "Users can manage their own store connections"
  on public.store_connections for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
