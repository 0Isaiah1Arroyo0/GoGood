-- Shared shopping list for household members with real-time sync
create table if not exists public.household_shopping_list (
  id           uuid        primary key default gen_random_uuid(),
  household_id uuid        not null references public.households(id) on delete cascade,
  added_by     uuid        not null references auth.users(id) on delete cascade,
  name         text        not null,
  quantity     text,
  unit         text,
  icon         text,
  recipe_id    text,
  recipe_name  text,
  checked      boolean     not null default false,
  checked_by   uuid        references auth.users(id) on delete set null,
  added_at     timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists hsl_household_id_idx on public.household_shopping_list(household_id);

alter table public.household_shopping_list enable row level security;

-- All household members can read, insert, update, and delete items on the shared list
create policy "Household members can manage shopping list"
  on public.household_shopping_list for all
  using (is_household_member(household_id))
  with check (is_household_member(household_id));
