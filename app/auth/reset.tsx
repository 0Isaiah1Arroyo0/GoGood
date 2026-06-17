import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../lib/supabase';

type ResetState = 'loading' | 'form' | 'success' | 'error';

export default function ResetScreen() {
  const router = useRouter();
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
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.container}>

        {state === 'loading' && (
          <>
            <ActivityIndicator size="large" color="#5DCAA5" />
            <Text style={styles.loadingText}>Verifying reset link…</Text>
          </>
        )}

        {state === 'form' && (
          <>
            <Text style={styles.icon}>🔑</Text>
            <Text style={styles.title}>New password</Text>
            <Text style={styles.sub}>Choose a strong password for your Go Good account.</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder="New password"
                placeholderTextColor="rgba(255,255,255,0.35)"
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
                style={styles.input}
                placeholder="Confirm password"
                placeholderTextColor="rgba(255,255,255,0.35)"
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
              <Text style={styles.showHide}>{showPw ? 'hide passwords' : 'show passwords'}</Text>
            </TouchableOpacity>
            {message ? <Text style={styles.errorText}>{message}</Text> : null}
            <TouchableOpacity style={styles.btn} onPress={handleSave} disabled={saving}>
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.btnText}>save new password →</Text>}
            </TouchableOpacity>
          </>
        )}

        {state === 'success' && (
          <>
            <Text style={styles.icon}>🎉</Text>
            <Text style={styles.title}>Password updated!</Text>
            <Text style={styles.sub}>Your password has been changed. Sign in with your new password.</Text>
            <TouchableOpacity style={styles.btn} onPress={goToLogin}>
              <Text style={styles.btnText}>go to sign in →</Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'error' && (
          <>
            <Text style={styles.icon}>😕</Text>
            <Text style={styles.title}>Link expired</Text>
            <Text style={styles.sub}>{message || 'The reset link may have expired. Request a new one from the sign in screen.'}</Text>
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
  safe:        { flex: 1, backgroundColor: '#085041' },
  container:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  icon:        { fontSize: 64 },
  title:       { fontSize: 26, fontWeight: '700', color: '#fff', textAlign: 'center', fontFamily: 'Fraunces_600SemiBold' },
  sub:         { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 22, maxWidth: 300 },
  loadingText: { fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 16 },
  inputWrap:   { width: '100%' },
  input:       { backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 12, padding: 14, fontSize: 14, color: 'white', width: '100%' },
  showHide:    { fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: '600' },
  errorText:   { fontSize: 12, color: '#FF8A8A', textAlign: 'center' },
  btn:         { marginTop: 8, backgroundColor: '#1D9E75', borderRadius: 14, paddingVertical: 16, paddingHorizontal: 40, alignItems: 'center', width: '100%' },
  btnText:     { color: '#fff', fontSize: 15, fontWeight: '600' },
});
