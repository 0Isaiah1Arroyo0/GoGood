create table if not exists public.food_items (
  id          bigint       not null,
  user_id     uuid         not null references auth.users(id) on delete cascade,
  icon        text         not null default '',
  name        text         not null,
  base_name   text         not null,
  batch       int          not null default 1,
  qty         text         not null default '',
  expiry_date text         not null default '',
  expires     text         not null default '',
  badge       text         not null default 'green',
  days        int          not null default 0,
  protein     numeric      not null default 0,
  carbs       numeric      not null default 0,
  fat         numeric      not null default 0,
  cal         numeric      not null default 0,
  qty_num     int          not null default 1,
  unit        text         not null default '',
  category    text         not null default 'fridge',
  added_at    bigint       not null default 0,
  food_category text,
  updated_at  timestamptz  not null default now(),
  primary key (id, user_id)
);

alter table public.food_items enable row level security;

create policy "Users can manage their own items"
  on public.food_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
