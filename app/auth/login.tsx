import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Easing, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/auth';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, resetPassword } = useAuth();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [forgotMode, setForgotMode]         = useState(false);
  const [resetSent, setResetSent]           = useState(false);
  const [forgotUsernameMode, setForgotUsernameMode] = useState(false);
  const [usernameSent, setUsernameSent]             = useState(false);
  const [biometricLabel, setBiometricLabel] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [scanning, setScanning]         = useState(false);
  const enterAnim = useRef(new Animated.Value(0)).current;
  const scanPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(enterAnim, { toValue: 1, duration: 480, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);

  useEffect(() => {
    (async () => {
      const hasHw   = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHw || !enrolled) return;
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const hasFace        = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
      setBiometricLabel(hasFace ? 'Face ID' : hasFingerprint ? 'Touch ID' : 'Passcode');
    })();
  }, []);

  // ── Biometric fast login ────────────────────────────────────────────────────
  const handleBiometricLogin = async () => {
    const enabled = await SecureStore.getItemAsync('gogood_biometric');
    if (enabled !== 'enabled') {
      setError('Sign in with your email first to activate Face ID');
      return;
    }
    setScanning(true);
    Animated.sequence([
      Animated.spring(scanPulse, { toValue: 0.96, speed: 60, bounciness: 0, useNativeDriver: true }),
      Animated.spring(scanPulse, { toValue: 1,    speed: 30, bounciness: 5, useNativeDriver: true }),
    ]).start();
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Sign in to Go Good',
      disableDeviceFallback: true,
    });
    setScanning(false);
    if (result.success) {
      router.replace('/(tabs)' as any);
    } else {
      setError('Face ID failed — try again or use password');
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
    await AsyncStorage.setItem('gogood_profile', JSON.stringify({
      photo: null, dietary: [], household: 1, username: '', name: '',
      email: email.trim().toLowerCase(),
    }));
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
    const hasFace        = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    const label = hasFace ? 'Face ID' : hasFingerprint ? 'Touch ID' : 'Passcode';
    await new Promise<void>(resolve => {
      Alert.alert(
        `Enable ${label}?`,
        `Sign in instantly next time using ${label}. iOS will ask for your passcode once to authorize this — that's normal and only happens on first setup.`,
        [
          { text: 'Not now', style: 'cancel', onPress: () => resolve() },
          {
            text: `Enable ${label}`, onPress: async () => {
              const result = await LocalAuthentication.authenticateAsync({
                promptMessage: `Verify ${label}`,
                disableDeviceFallback: false,
              });
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


  // ── Forgot username ─────────────────────────────────────────────────────────
  const handleForgotUsername = async () => {
    if (!email.trim()) { setError('Enter your email address above first'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/forgot-username`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY! },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!res.ok) throw new Error('request failed');
    } catch {
      // Silently succeed to avoid email enumeration
    }
    setLoading(false);
    setUsernameSent(true);
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

  // ── Forgot username screen ──────────────────────────────────────────────────
  if (forgotUsernameMode) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { setForgotUsernameMode(false); setUsernameSent(false); setError(''); }} style={styles.backBtn}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Forgot username</Text>
          <View style={{ width: 36 }} />
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.logo}>go<Text style={styles.logoGreen}>good</Text></Text>
          {usernameSent ? (
            <View style={styles.successBox}>
              <Text style={styles.confirmIcon}>📬</Text>
              <Text style={styles.successTitle}>Check your inbox</Text>
              <Text style={styles.successText}>If a Go Good account exists for{'\n'}<Text style={{ color: '#5DCAA5', fontWeight: '600' }}>{email}</Text>{'\n'}we've sent your username there.</Text>
              <TouchableOpacity onPress={() => { setForgotUsernameMode(false); setUsernameSent(false); }} style={styles.btnPrimary}>
                <Text style={styles.btnPrimaryText}>back to sign in →</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.subtitle}>Enter your email and we'll send your username</Text>
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
              <TouchableOpacity style={styles.btnPrimary} onPress={handleForgotUsername} disabled={loading}>
                {loading ? <ActivityIndicator color="white" /> : <Text style={styles.btnPrimaryText}>send my username →</Text>}
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
      <Animated.View style={[{ flex: 1 }, {
        opacity: enterAnim,
        transform: [{ translateY: enterAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
      }]}>
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
          <TouchableOpacity onPress={handleBiometricLogin} disabled={scanning} activeOpacity={0.85}>
            <Animated.View style={[styles.biometricBtn, { transform: [{ scale: scanPulse }] }]}>
              <Text style={styles.biometricIcon}>{biometricLabel === 'Face ID' ? '🔐' : biometricLabel === 'Touch ID' ? '👆' : '🔑'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.biometricTitle}>
                  {scanning ? 'Scanning...' : `Sign in with ${biometricLabel}`}
                </Text>
                <Text style={styles.biometricSub}>
                  {scanning ? `Verifying your ${biometricLabel}` : 'Tap to unlock instantly'}
                </Text>
              </View>
            </Animated.View>
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
          <View style={{ position: 'relative' }}>
            <TextInput
              style={[styles.input, error ? styles.inputError : null, { paddingRight: 56 }]}
              placeholder="Your password"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={password}
              onChangeText={v => { setPassword(v); setError(''); }}
              secureTextEntry={!showPassword}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
              textContentType="password"
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(p => !p)}>
              <Text style={styles.eyeText}>{showPassword ? 'hide' : 'show'}</Text>
            </TouchableOpacity>
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: -6 }}>
          <TouchableOpacity onPress={() => setForgotUsernameMode(true)}>
            <Text style={styles.forgotText}>forgot username?</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setForgotMode(true)}>
            <Text style={styles.forgotText}>forgot password?</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.btnPrimary} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="white" /> : <Text style={styles.btnPrimaryText}>sign in →</Text>}
        </TouchableOpacity>

        <View style={styles.switchRow}>
          <Text style={styles.switchText}>don't have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/auth/signup' as any)}>
            <Text style={styles.switchLink}>sign up</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      </Animated.View>
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
  eyeBtn:         { position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' },
  eyeText:        { fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: '600' },
  btnPrimary:     { backgroundColor: '#1D9E75', padding: 16, borderRadius: 14, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  btnPrimaryText: { color: 'white', fontSize: 15, fontWeight: '600' },
  switchRow:      { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  switchText:     { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  switchLink:     { fontSize: 13, color: '#5DCAA5', fontWeight: '600' },
  successBox:     { gap: 16, alignItems: 'center' },
  confirmIcon:    { fontSize: 52, textAlign: 'center' },
  successTitle:   { fontSize: 20, fontWeight: '700', color: 'white', fontFamily: 'Fraunces_600SemiBold' },
  successText:    { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 22 },
});
