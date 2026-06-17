-- recipe_collections: user-organized folders for saved recipes
create table if not exists public.recipe_collections (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  client_id  text        not null,
  name       text        not null,
  emoji      text,
  created_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create index if not exists recipe_collections_user_id_idx on public.recipe_collections(user_id);

alter table public.recipe_collections enable row level security;

create policy "Users can manage their own collections"
  on public.recipe_collections for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
