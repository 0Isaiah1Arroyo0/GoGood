import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../lib/supabase';
import { useAuthStyles, IconBadge } from '@/components/auth-ui';

type ResetState = 'loading' | 'form' | 'success' | 'error';

export default function ResetScreen() {
  const router = useRouter();
  const { styles: auth, c, isDark } = useAuthStyles();
  const params = useLocalSearchParams<{
    code?: string;
    token_hash?: string;
    type?: string;
    error?: string;
    error_description?: string;
  }>();
  const [state, setState] = useState<ResetState>('loading');
  const [message, setMessage] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function init() {
      if (params.error) {
        setState('error');
        setMessage(params.error_description ?? params.error ?? 'Invalid reset link.');
        return;
      }
      if (params.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(params.code);
        if (error) { setState('error'); setMessage(error.message); return; }
        setState('form');
        return;
      }
      if (params.token_hash && params.type) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: params.token_hash,
          type: params.type as any,
        });
        if (error) { setState('error'); setMessage(error.message); return; }
        setState('form');
        return;
      }
      setState('error');
      setMessage('No reset code found. Please use the link from your email.');
    }
    init();
  }, []);

  const handleSave = async () => {
    if (password.length < 8) { setMessage('Password must be at least 8 characters'); return; }
    if (password !== confirm) { setMessage("Passwords don't match"); return; }
    setSaving(true);
    setMessage('');
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) { setMessage(error.message); return; }
    setState('success');
  };

  const goToLogin = () => router.replace('/auth/login' as any);

  return (
    <SafeAreaView style={auth.safeArea}>
      <StatusBar style={c.statusBar} />
      <View style={styles.container}>

        {state === 'loading' && (
          <>
            <ActivityIndicator size="large" color={c.teal} />
            <Text style={[styles.loadingText, { color: c.textSub }]}>Verifying reset link…</Text>
          </>
        )}

        {state === 'form' && (
          <>
            <IconBadge name="key-outline" size={72} />
            <Text style={auth.messageTitle}>New password</Text>
            <Text style={auth.messageText}>Choose a strong password for your Go Good account.</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={auth.input}
                placeholder="New password"
                placeholderTextColor={c.placeholder}
                keyboardAppearance={isDark ? 'dark' : 'light'}
                value={password}
                onChangeText={v => { setPassword(v); setMessage(''); }}
                secureTextEntry={!showPw}
                textContentType="newPassword"
                autoComplete="new-password"
                autoFocus
              />
            </View>
            <View style={styles.inputWrap}>
              <TextInput
                style={auth.input}
                placeholder="Confirm password"
                placeholderTextColor={c.placeholder}
                keyboardAppearance={isDark ? 'dark' : 'light'}
                value={confirm}
                onChangeText={v => { setConfirm(v); setMessage(''); }}
                secureTextEntry={!showPw}
                textContentType="none"
                autoComplete="off"
                returnKeyType="done"
                onSubmitEditing={handleSave}
              />
            </View>
            <TouchableOpacity onPress={() => setShowPw(p => !p)} style={{ alignSelf: 'flex-end' }}>
              <Text style={auth.eyeText}>{showPw ? 'Hide passwords' : 'Show passwords'}</Text>
            </TouchableOpacity>
            {message ? <Text style={auth.errorText}>{message}</Text> : null}
            <TouchableOpacity style={[auth.btnPrimary, styles.btn]} onPress={handleSave} disabled={saving}>
              {saving
                ? <ActivityIndicator color="white" />
                : <Text style={auth.btnPrimaryText}>Save new password</Text>}
            </TouchableOpacity>
          </>
        )}

        {state === 'success' && (
          <>
            <IconBadge name="checkmark" size={72} />
            <Text style={auth.messageTitle}>Password updated</Text>
            <Text style={auth.messageText}>Your password has been changed. Sign in with your new password.</Text>
            <TouchableOpacity style={[auth.btnPrimary, styles.btn]} onPress={goToLogin}>
              <Text style={auth.btnPrimaryText}>Go to sign in</Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'error' && (
          <>
            <IconBadge name="alert-outline" size={72} tone="bad" />
            <Text style={auth.messageTitle}>Link expired</Text>
            <Text style={auth.messageText}>{message || 'The reset link may have expired. Request a new one from the sign in screen.'}</Text>
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
