-- households
create table if not exists public.households (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null default 'My Household',
  owner_id    uuid        not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- members (stores email for display without needing admin API)
create table if not exists public.household_members (
  household_id uuid        not null references public.households(id) on delete cascade,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  email        text        not null default '',
  role         text        not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- pending invites indexed by token
create table if not exists public.household_invites (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references public.households(id) on delete cascade,
  invited_email text        not null,
  invited_by    uuid        not null references auth.users(id) on delete cascade,
  token         uuid        not null default gen_random_uuid() unique,
  accepted_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- household_id on food_items (null = personal item, set = household-shared)
alter table public.food_items
  add column if not exists household_id uuid references public.households(id) on delete cascade;

create index if not exists food_items_household_id_idx on public.food_items(household_id);

-- ── RLS: households ───────────────────────────────────────────────────────────
alter table public.households enable row level security;

create policy "Members can view their household"
  on public.households for select
  using (
    id in (select household_id from public.household_members where user_id = auth.uid())
  );

create policy "Owner can manage household"
  on public.households for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ── RLS: household_members ────────────────────────────────────────────────────
alter table public.household_members enable row level security;

create policy "Members can view their household roster"
  on public.household_members for select
  using (
    household_id in (
      select household_id from public.household_members hm2 where hm2.user_id = auth.uid()
    )
  );

create policy "Owner can remove any member"
  on public.household_members for delete
  using (
    user_id = auth.uid()
    or household_id in (select id from public.households where owner_id = auth.uid())
  );

create policy "User can join a household (accept invite)"
  on public.household_members for insert
  with check (user_id = auth.uid());

-- ── RLS: household_invites ────────────────────────────────────────────────────
alter table public.household_invites enable row level security;

create policy "Users can read invites relevant to them"
  on public.household_invites for select
  using (
    invited_email = auth.email()
    or invited_by = auth.uid()
    or household_id in (
      select household_id from public.household_members where user_id = auth.uid()
    )
  );

create policy "Household members can send invites"
  on public.household_invites for insert
  with check (
    invited_by = auth.uid()
    and household_id in (
      select household_id from public.household_members where user_id = auth.uid()
    )
  );

create policy "Inviter can cancel their invite"
  on public.household_invites for delete
  using (invited_by = auth.uid());

create policy "Invitee can accept their invite"
  on public.household_invites for update
  using (invited_email = auth.email())
  with check (invited_email = auth.email());

-- ── Update food_items RLS to allow household sharing ──────────────────────────
drop policy if exists "Users can manage their own items" on public.food_items;

create policy "Users can manage their own or household items"
  on public.food_items for all
  using (
    user_id = auth.uid()
    or (
      household_id is not null
      and household_id in (
        select household_id from public.household_members where user_id = auth.uid()
      )
    )
  )
  with check (
    user_id = auth.uid()
    or (
      household_id is not null
      and household_id in (
        select household_id from public.household_members where user_id = auth.uid()
      )
    )
  );
