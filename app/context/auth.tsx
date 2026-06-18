import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User, AuthError } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { registerForPushNotificationsAsync } from '../lib/notifications';

const USER_STORAGE_KEYS = [
  'gogood_profile',
  'gogood_items',
  'gogood_stats',
  'gogood_gone_good',
  'gogood_gone_bad',
  'gogood_seed_v3',
  'gogood_opened_sections',
  'gogood_notifs',
  'gogood_goal_week',
  'gogood_goal_month',
  'gogood_household_nudge_dismissed',
  'gogood_paywall_demo',
  'gogood_household_id',
  'gogood_household_name',
  'gogood_household_joined_at',
  'gogood_household_role',
  'gogood_shopping_list',
  'gogood_collections',
  'gogood_saved_recipes',
  'gogood_collections_migrated',
  'gogood_item_history',
];

async function clearLocalUserData() {
  await AsyncStorage.multiRemove(USER_STORAGE_KEYS);
}

interface AuthCtx {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signUp: (email: string, password: string, name: string, username: string) => Promise<{ error: AuthError | null }>;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signInWithApple: (identityToken: string, name?: string | null) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
}

const AuthContext = createContext<AuthCtx>({
  session: null, user: null, loading: true,
  signUp: async () => ({ error: null }),
  signIn: async () => ({ error: null }),
  signInWithApple: async () => ({ error: null }),
  signOut: async () => {},
  resetPassword: async () => ({ error: null }),
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) storePushToken(session.user.id);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function storePushToken(userId: string) {
    const token = await registerForPushNotificationsAsync();
    if (!token) return;
    await supabase.from('profiles').upsert({ id: userId, expo_push_token: token }, { onConflict: 'id' });
  }

  const signUp = async (email: string, password: string, name: string, username: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name, username },
        emailRedirectTo: 'gogood://auth/confirm',
      },
    });
    return { error };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signInWithApple = async (identityToken: string, name?: string | null) => {
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: identityToken,
      nonce: undefined,
    });
    return { error };
  };

  const signOut = async () => {
    await clearLocalUserData();
    await supabase.auth.signOut();
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'gogood://auth/reset',
    });
    return { error };
  };

  return (
    <AuthContext.Provider value={{
      session, user: session?.user ?? null, loading,
      signUp, signIn, signInWithApple, signOut, resetPassword,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
