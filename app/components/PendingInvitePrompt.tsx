import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/auth';
import { useSubscription } from '../context/subscription';
import { acceptPendingInvite, getMyHousehold, getPendingInvitesForEmail } from '../lib/household';
import { showAlert } from '@/components/dialog';

const SEEN_KEY = 'gogood_invites_answered'; // invite ids the user said "Not now" to

// When someone was invited to a household by email, ask them to join as soon as
// they're signed in (right after signing up, or the next time they open the app).
export default function PendingInvitePrompt() {
  const { user } = useAuth();
  const { refreshProStatus } = useSubscription();
  const router = useRouter();
  const askedFor = useRef<string | null>(null);

  useEffect(() => {
    const email = (user as any)?.email as string | undefined;
    if (!user?.id || !email || askedFor.current === user.id) return;
    askedFor.current = user.id;

    (async () => {
      try {
        if (await getMyHousehold(user.id)) return; // already in one
        const [invites, seenRaw] = await Promise.all([
          getPendingInvitesForEmail(email),
          AsyncStorage.getItem(SEEN_KEY),
        ]);
        const seen: string[] = seenRaw ? JSON.parse(seenRaw) : [];
        const invite = invites.find(i => !seen.includes(i.id));
        if (!invite) return;

        // Let the app settle on its first screen before asking
        setTimeout(() => {
          showAlert(
            `Join ${invite.householdName ?? 'a household'}?`,
            "You've been invited to share a kitchen on Go Good: the inventory, recipes and shopping list. If they have the Household plan, you get Pro too.",
            [
              {
                text: 'Join household', icon: 'home-outline',
                onPress: async () => {
                  const res = await acceptPendingInvite(invite, user.id, email);
                  if (!res.ok) { showAlert("Couldn't join", res.error ?? 'Please try again from the Household tab.'); return; }
                  refreshProStatus();
                  showAlert(`Welcome to ${invite.householdName ?? 'the household'}`, "You're all set. Everything you add is now shared.", [
                    { text: 'See household', onPress: () => router.navigate('/(tabs)/household' as any) },
                  ]);
                },
              },
              {
                text: 'Not now', style: 'cancel',
                onPress: () => { AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen, invite.id])).catch(() => {}); },
              },
            ],
          );
        }, 1200);
      } catch { /* never block the app over this */ }
    })();
  }, [user?.id]);

  return null;
}
