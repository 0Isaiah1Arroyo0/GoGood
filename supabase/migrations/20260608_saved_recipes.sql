-- saved_recipes: user-saved recipes with optional household sharing
create table if not exists public.saved_recipes (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users(id) on delete cascade,
  client_id             text        not null,
  collection_id         uuid        references public.recipe_collections(id) on delete set null,
  household_id          uuid        references public.households(id) on delete set null,
  name                  text        not null default '',
  content               text        not null default '',
  recipe_macros         jsonb,
  rating                smallint,
  notes                 text,
  cooked_count          integer     not null default 0,
  last_cooked           timestamptz,
  shared_with_household boolean     not null default false,
  saved_at              timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, client_id)
);

create index if not exists saved_recipes_user_id_idx      on public.saved_recipes(user_id);
create index if not exists saved_recipes_household_id_idx on public.saved_recipes(household_id)
  where household_id is not null;

alter table public.saved_recipes enable row level security;

create policy "Users can manage their own recipes"
  on public.saved_recipes for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Household members can view shared recipes"
  on public.saved_recipes for select
  using (
    shared_with_household = true
    and household_id is not null
    and household_id in (
      select household_id from public.household_members where user_id = auth.uid()
    )
  );
