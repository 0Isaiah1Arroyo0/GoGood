import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../lib/supabase';

type ConfirmState = 'loading' | 'success' | 'error';

export default function ConfirmScreen() {
  const router = useRouter();
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
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.container}>

        {state === 'loading' && (
          <>
            <ActivityIndicator size="large" color="#5DCAA5" />
            <Text style={styles.loadingText}>Confirming your email…</Text>
          </>
        )}

        {state === 'success' && (
          <>
            <Text style={styles.icon}>🎉</Text>
            <Text style={styles.title}>You're confirmed!</Text>
            <Text style={styles.sub}>
              Your email has been verified. Welcome to Go Good — let's start rescuing some food.
            </Text>
            <TouchableOpacity style={styles.btn} onPress={goToApp}>
              <Text style={styles.btnText}>let's go good →</Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'error' && (
          <>
            <Text style={styles.icon}>😕</Text>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.sub}>{message || 'The confirmation link may have expired. Try signing in or signing up again.'}</Text>
            <TouchableOpacity style={styles.btn} onPress={goToLogin}>
              <Text style={styles.btnText}>go to sign in →</Text>
            </TouchableOpacity>
          </>
        )}

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: '#085041' },
  container:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  icon:          { fontSize: 64 },
  title:         { fontSize: 26, fontWeight: '700', color: '#fff', textAlign: 'center', fontFamily: 'Fraunces_600SemiBold' },
  sub:           { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 22, maxWidth: 300 },
  loadingText:   { fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 16 },
  btn:           { marginTop: 8, backgroundColor: '#1D9E75', borderRadius: 14, paddingVertical: 16, paddingHorizontal: 40, alignItems: 'center' },
  btnText:       { color: '#fff', fontSize: 15, fontWeight: '600' },
});
