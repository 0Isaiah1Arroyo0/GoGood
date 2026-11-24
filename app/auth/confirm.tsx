import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../lib/supabase';
import { useAuthStyles, IconBadge } from '@/components/auth-ui';

type ConfirmState = 'loading' | 'success' | 'error';

export default function ConfirmScreen() {
  const router = useRouter();
  const { styles: auth, c, isDark } = useAuthStyles();
  const params = useLocalSearchParams<{ code?: string; token_hash?: string; type?: string; error?: string; error_description?: string }>();
  const [state, setState] = useState<ConfirmState>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function verify() {
      // PKCE flow — code is exchanged for a session
      if (params.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(params.code);
        if (error) { setState('error'); setMessage(error.message); return; }
        setState('success');
        return;
      }

      // Token hash flow (OTP / magic link)
      if (params.token_hash && params.type) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: params.token_hash,
          type: params.type as any,
        });
        if (error) { setState('error'); setMessage(error.message); return; }
        setState('success');
        return;
      }

      // Supabase error forwarded in URL
      if (params.error) {
        setState('error');
        setMessage(params.error_description ?? params.error);
        return;
      }

      // No recognisable params — probably opened confirm route without a link
      setState('error');
      setMessage('No confirmation code found. Please use the link from your email.');
    }

    verify();
  }, []);

  const goToApp = () => router.replace('/(tabs)' as any);
  const goToLogin = () => router.replace('/auth/login' as any);

  return (
    <SafeAreaView style={auth.safeArea}>
      <StatusBar style={c.statusBar} />
      <View style={styles.container}>

        {state === 'loading' && (
          <>
            <ActivityIndicator size="large" color={c.teal} />
            <Text style={[styles.loadingText, { color: c.textSub }]}>Confirming your email…</Text>
          </>
        )}

        {state === 'success' && (
          <>
            <IconBadge name="checkmark" size={72} />
            <Text style={auth.messageTitle}>You're confirmed</Text>
            <Text style={auth.messageText}>
              Your email has been verified. Welcome to GoGood. Let's start rescuing some food.
            </Text>
            <TouchableOpacity style={[auth.btnPrimary, styles.btn]} onPress={goToApp}>
              <Text style={auth.btnPrimaryText}>Let's go good</Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'error' && (
          <>
            <IconBadge name="alert-outline" size={72} tone="bad" />
            <Text style={auth.messageTitle}>Something went wrong</Text>
            <Text style={auth.messageText}>{message || 'The confirmation link may have expired. Try signing in or signing up again.'}</Text>
            <TouchableOpacity style={[auth.btnPrimary, styles.btn]} onPress={goToLogin}>
              <Text style={auth.btnPrimaryText}>Go to sign in</Text>
            </TouchableOpacity>
          </>
        )}

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  loadingText: { fontSize: 14, marginTop: 16 },
  inputWrap:   { width: '100%' },
  btn:         { marginTop: 8, paddingHorizontal: 40, alignSelf: 'stretch' },
});
