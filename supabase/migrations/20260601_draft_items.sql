-- draft_items: staging table for receipt / store-sync parsed items before user confirms
create table if not exists public.draft_items (
  id               uuid         not null default gen_random_uuid() primary key,
  user_id          uuid         not null references auth.users(id) on delete cascade,
  source           text         not null default 'receipt', -- 'receipt' | 'kroger' | 'manual'
  name             text         not null,
  base_name        text         not null,
  icon             text         not null default '🥘',
  qty_num          numeric      not null default 1,
  unit             text         not null default 'count',
  category         text         not null default 'fridge',  -- 'fridge' | 'freezer' | 'pantry'
  food_category    text,
  expiry_date      text,        -- YYYY-MM-DD, AI-estimated at scan time
  protein          numeric      not null default 0,
  carbs            numeric      not null default 0,
  fat              numeric      not null default 0,
  cal              numeric      not null default 0,
  scan_session_id  uuid,        -- groups items from one receipt scan
  store_name       text,
  store_order_id   text,
  created_at       timestamptz  not null default now()
);

alter table public.draft_items enable row level security;

create policy "Users can manage their own draft_items"
  on public.draft_items for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists draft_items_session_idx on public.draft_items (scan_session_id);
create index if not exists draft_items_user_idx    on public.draft_items (user_id, created_at desc);

-- Ensure icon + expiry_date columns exist if table was created before this migration
alter table public.draft_items add column if not exists icon        text not null default '🥘';
alter table public.draft_items add column if not exists expiry_date text;
