import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// The dev server can load this file on the computer (no window/AsyncStorage there),
// which made the login auto-refresh log "window is not defined". Only run it in the app.
const inApp = typeof window !== 'undefined';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: inApp,
    persistSession: inApp,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});
