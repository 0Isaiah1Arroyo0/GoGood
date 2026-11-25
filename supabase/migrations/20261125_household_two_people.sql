-- Households are for two people: the owner (who pays for the Household plan) and
-- one partner. Enforced here so no app version can go past it.

CREATE OR REPLACE FUNCTION public.household_enforce_two_people()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  members int;
  pending int;
BEGIN
  SELECT count(*) INTO members FROM public.household_members
   WHERE household_id = NEW.household_id
     AND (TG_TABLE_NAME <> 'household_members' OR user_id <> NEW.user_id);

  IF TG_TABLE_NAME = 'household_members' THEN
    IF members >= 2 THEN
      RAISE EXCEPTION 'household_full' USING HINT = 'This household already has two people.';
    END IF;
  ELSE
    -- A new invite: room for one more person, and no other open invite for someone else
    SELECT count(*) INTO pending FROM public.household_invites
     WHERE household_id = NEW.household_id
       AND accepted_at IS NULL
       AND lower(invited_email) <> lower(NEW.invited_email);
    IF members + pending >= 2 THEN
      RAISE EXCEPTION 'household_full' USING HINT = 'Households are for two people.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS household_members_two_people ON public.household_members;
CREATE TRIGGER household_members_two_people
  BEFORE INSERT ON public.household_members
  FOR EACH ROW EXECUTE FUNCTION public.household_enforce_two_people();

DROP TRIGGER IF EXISTS household_invites_two_people ON public.household_invites;
CREATE TRIGGER household_invites_two_people
  BEFORE INSERT ON public.household_invites
  FOR EACH ROW EXECUTE FUNCTION public.household_enforce_two_people();

-- The invited person can see the household they're invited to (its name), so the
-- invite can show up for them. Without this the invite lookup found nothing.
DROP POLICY IF EXISTS "Invitees can view the household they're invited to" ON public.households;
CREATE POLICY "Invitees can view the household they're invited to"
  ON public.households FOR SELECT
  USING (id IN (
    SELECT household_id FROM public.household_invites
     WHERE lower(invited_email) = lower(auth.email()) AND accepted_at IS NULL
  ));
