-- Fix infinite recursion in household_members RLS.
-- The SELECT policy was querying household_members to check membership,
-- which re-triggered the same policy. The fix is a SECURITY DEFINER helper
-- that bypasses RLS when resolving membership, then all policies use it.

create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

-- ── household_members ────────────────────────────────────────────────────────
drop policy if exists "Members can view their household roster" on public.household_members;

create policy "Members can view their household roster"
  on public.household_members for select
  using (is_household_member(household_id));

drop policy if exists "Owner can remove any member" on public.household_members;

create policy "Owner can remove any member"
  on public.household_members for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.households
      where id = household_id and owner_id = auth.uid()
    )
  );

-- ── household_invites ────────────────────────────────────────────────────────
drop policy if exists "Users can read invites relevant to them" on public.household_invites;

create policy "Users can read invites relevant to them"
  on public.household_invites for select
  using (
    invited_email = auth.email()
    or invited_by = auth.uid()
    or is_household_member(household_id)
  );

drop policy if exists "Household members can send invites" on public.household_invites;

create policy "Household members can send invites"
  on public.household_invites for insert
  with check (
    invited_by = auth.uid()
    and is_household_member(household_id)
  );

-- ── food_items ───────────────────────────────────────────────────────────────
drop policy if exists "Users can manage their own or household items" on public.food_items;

create policy "Users can manage their own or household items"
  on public.food_items for all
  using (
    user_id = auth.uid()
    or (household_id is not null and is_household_member(household_id))
  )
  with check (
    user_id = auth.uid()
    or (household_id is not null and is_household_member(household_id))
  );
