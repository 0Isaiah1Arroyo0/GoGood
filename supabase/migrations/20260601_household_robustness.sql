-- Household feature robustness improvements

-- 1. Add 7-day invite expiry window
alter table public.household_invites
  add column if not exists expires_at timestamptz not null default (now() + interval '7 days');

-- 2. Performance indexes for common lookups
create index if not exists household_invites_token_idx
  on public.household_invites(token);

create index if not exists household_invites_email_idx
  on public.household_invites(invited_email);

-- 3. Deduplicate existing pending invites before adding unique constraint
--    (keeps the most recent per household+email pair)
delete from public.household_invites a
using public.household_invites b
where a.accepted_at is null
  and b.accepted_at is null
  and a.household_id = b.household_id
  and a.invited_email = b.invited_email
  and a.created_at < b.created_at;

-- 4. One pending invite per email per household (prevents invite spam)
create unique index if not exists household_invites_pending_unique
  on public.household_invites(household_id, invited_email)
  where accepted_at is null;

-- 5. Atomic ownership transfer — prevents partial state from two separate updates
create or replace function public.transfer_household_ownership(
  p_household_id uuid,
  p_from_user_id uuid,
  p_to_user_id   uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.households
    where id = p_household_id and owner_id = p_from_user_id
  ) then
    return false;
  end if;

  if not exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = p_to_user_id
  ) then
    return false;
  end if;

  update public.households
    set owner_id = p_to_user_id
    where id = p_household_id;

  update public.household_members
    set role = 'owner'
    where household_id = p_household_id and user_id = p_to_user_id;

  update public.household_members
    set role = 'member'
    where household_id = p_household_id and user_id = p_from_user_id;

  return true;
end;
$$;
