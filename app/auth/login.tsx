import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '../context/auth';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, signInWithApple, resetPassword } = useAuth();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [forgotMode, setForgotMode]   = useState(false);
  const [resetSent, setResetSent]     = useState(false);
  const [biometricLabel, setBiometricLabel] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const enabled = await SecureStore.getItemAsync('gogood_biometric');
      if (enabled !== 'enabled') return;
      const hasHw   = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHw || !enrolled) return;
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      setBiometricLabel(hasFace ? 'Face ID' : 'Fingerprint');
    })();
  }, []);

  // ── Biometric fast login ────────────────────────────────────────────────────
  const handleBiometricLogin = async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Sign in to Go Good',
      fallbackLabel: 'Use password',
      disableDeviceFallback: false,
    });
    if (result.success) {
      router.replace('/(tabs)' as any);
    } else {
      setError('Biometric authentication failed');
    }
  };

  // ── Email/password login ────────────────────────────────────────────────────
  const handleLogin = async () => {
    if (!email.trim() || !password) { setError('Enter your email and password'); return; }
    setLoading(true); setError('');
    const { error: err } = await signIn(email.trim().toLowerCase(), password);
    setLoading(false);
    if (err) {
      setError(err.message === 'Invalid login credentials'
        ? 'Incorrect email or password'
        : err.message);
      return;
    }
    await promptBiometric();
    router.replace('/(tabs)' as any);
  };

  // After successful login, offer to enable biometric if available and not yet set
  const promptBiometric = async () => {
    const already = await SecureStore.getItemAsync('gogood_biometric');
    if (already === 'enabled') return;
    const hasHw   = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHw || !enrolled) return;
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const label = hasFace ? 'Face ID' : 'Fingerprint';
    await new Promise<void>(resolve => {
      Alert.alert(
        `Enable ${label}?`,
        `Sign in instantly next time using ${label} — no password needed.`,
        [
          { text: 'Not now', style: 'cancel', onPress: () => resolve() },
          {
            text: `Enable ${label}`, onPress: async () => {
              const result = await LocalAuthentication.authenticateAsync({ promptMessage: `Verify ${label}` });
              if (result.success) await SecureStore.setItemAsync('gogood_biometric', 'enabled');
              resolve();
            },
          },
        ]
      );
    });
  };

  // ── Forgot password ─────────────────────────────────────────────────────────
  const handleForgot = async () => {
    if (!email.trim()) { setError('Enter your email address above first'); return; }
    setLoading(true); setError('');
    const { error: err } = await resetPassword(email.trim().toLowerCase());
    setLoading(false);
    if (err) setError(err.message);
    else setResetSent(true);
  };

  // ── Apple ───────────────────────────────────────────────────────────────────
  const handleApple = async () => {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      setLoading(true); setError('');
      const name = [credential.fullName?.givenName, credential.fullName?.familyName]
        .filter(Boolean).join(' ') || null;
      const { error: err } = await signInWithApple(credential.identityToken!, name);
      setLoading(false);
      if (err) { setError(err.message); return; }
      await promptBiometric();
      router.replace('/(tabs)' as any);
    } catch (e: any) {
      if (e.code !== 'ERR_REQUEST_CANCELED') setError('Apple sign in failed');
    }
  };

  // ── Forgot password screen ──────────────────────────────────────────────────
  if (forgotMode) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { setForgotMode(false); setResetSent(false); setError(''); }} style={styles.backBtn}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Reset password</Text>
          <View style={{ width: 36 }} />
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.logo}>go<Text style={styles.logoGreen}>good</Text></Text>
          {resetSent ? (
            <View style={styles.successBox}>
              <Text style={[styles.confirmIcon]}>📬</Text>
              <Text style={styles.successTitle}>Check your inbox</Text>
              <Text style={styles.successText}>We sent a reset link to{'\n'}<Text style={{ color: '#5DCAA5', fontWeight: '600' }}>{email}</Text></Text>
              <TouchableOpacity onPress={() => { setForgotMode(false); setResetSent(false); }} style={styles.btnPrimary}>
                <Text style={styles.btnPrimaryText}>back to sign in →</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.subtitle}>Enter your email and we'll send a reset link</Text>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Email address</Text>
                <TextInput
                  style={[styles.input, error ? styles.inputError : null]}
                  placeholder="you@example.com"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={email}
                  onChangeText={v => { setEmail(v); setError(''); }}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoFocus
                />
                {error ? <Text style={styles.errorText}>{error}</Text> : null}
              </View>
              <TouchableOpacity style={styles.btnPrimary} onPress={handleForgot} disabled={loading}>
                {loading ? <ActivityIndicator color="white" /> : <Text style={styles.btnPrimaryText}>send reset link →</Text>}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Main login screen ───────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Welcome back</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>go<Text style={styles.logoGreen}>good</Text></Text>
        <Text style={styles.subtitle}>Good to see you again 🌱</Text>

        {/* Face ID fast login */}
        {biometricLabel && (
          <TouchableOpacity style={styles.biometricBtn} onPress={handleBiometricLogin}>
            <Text style={styles.biometricIcon}>{biometricLabel === 'Face ID' ? '🔐' : '👆'}</Text>
            <View>
              <Text style={styles.biometricTitle}>Sign in with {biometricLabel}</Text>
              <Text style={styles.biometricSub}>Tap to unlock instantly</Text>
            </View>
          </TouchableOpacity>
        )}

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Email address</Text>
          <TextInput
            style={[styles.input, error ? styles.inputError : null]}
            placeholder="you@example.com"
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={email}
            onChangeText={v => { setEmail(v); setError(''); }}
            autoCapitalize="none"
            keyboardType="email-address"
            returnKeyType="next"
            textContentType="emailAddress"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Password</Text>
          <TextInput
            style={[styles.input, error ? styles.inputError : null]}
            placeholder="Your password"
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={password}
            onChangeText={v => { setPassword(v); setError(''); }}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={handleLogin}
            textContentType="password"
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        <TouchableOpacity onPress={() => setForgotMode(true)} style={{ alignSelf: 'flex-end', marginTop: -6 }}>
          <Text style={styles.forgotText}>forgot password?</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.btnPrimary} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="white" /> : <Text style={styles.btnPrimaryText}>sign in →</Text>}
        </TouchableOpacity>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or sign in with</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={styles.socialRow}>
          {Platform.OS === 'ios' && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={12}
              style={styles.appleBtn}
              onPress={handleApple}
            />
          )}
          <TouchableOpacity style={styles.socialBtn} onPress={() => Alert.alert('Coming soon', 'Google sign in is coming in the next update.')}>
            <Text style={styles.socialText}>G  Google</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchText}>don't have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/auth/signup' as any)}>
            <Text style={styles.switchLink}>sign up</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea:       { flex: 1, backgroundColor: '#085041' },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.1)' },
  backBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  backText:       { fontSize: 18, color: 'white' },
  headerTitle:    { fontSize: 16, fontWeight: '600', color: 'white' },
  scroll:         { flex: 1, backgroundColor: '#085041' },
  body:           { padding: 28, gap: 16, paddingBottom: 48 },
  logo:           { fontSize: 36, fontWeight: '700', color: 'white', textAlign: 'center', fontFamily: 'Fraunces_600SemiBold' },
  logoGreen:      { color: '#5DCAA5', fontFamily: 'Fraunces_600SemiBold' },
  subtitle:       { fontSize: 13, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: -8 },
  biometricBtn:   { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(93,202,165,0.12)', borderWidth: 1, borderColor: 'rgba(93,202,165,0.3)', borderRadius: 14, padding: 16 },
  biometricIcon:  { fontSize: 30 },
  biometricTitle: { fontSize: 15, fontWeight: '600', color: 'white' },
  biometricSub:   { fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  field:          { gap: 6 },
  fieldLabel:     { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1 },
  input:          { backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 12, padding: 14, fontSize: 14, color: 'white' },
  inputError:     { borderColor: '#FF6B6B' },
  errorText:      { fontSize: 11, color: '#FF8A8A', marginTop: 2 },
  forgotText:     { fontSize: 12, color: '#5DCAA5', fontWeight: '500' },
  btnPrimary:     { backgroundColor: '#1D9E75', padding: 16, borderRadius: 14, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  btnPrimaryText: { color: 'white', fontSize: 15, fontWeight: '600' },
  dividerRow:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine:    { flex: 1, height: 0.5, backgroundColor: 'rgba(255,255,255,0.15)' },
  dividerText:    { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  socialRow:      { flexDirection: 'row', gap: 10 },
  appleBtn:       { flex: 1, height: 48 },
  socialBtn:      { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 12, padding: 14, alignItems: 'center', justifyContent: 'center' },
  socialText:     { fontSize: 13, fontWeight: '500', color: 'white' },
  switchRow:      { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  switchText:     { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  switchLink:     { fontSize: 13, color: '#5DCAA5', fontWeight: '600' },
  successBox:     { gap: 16, alignItems: 'center' },
  confirmIcon:    { fontSize: 52, textAlign: 'center' },
  successTitle:   { fontSize: 20, fontWeight: '700', color: 'white', fontFamily: 'Fraunces_600SemiBold' },
  successText:    { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 22 },
});
