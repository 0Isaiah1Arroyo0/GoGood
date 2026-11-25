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
import { useAuthStyles, IconBadge, BackButton } from '@/components/auth-ui';
import { showAlert } from '@/components/dialog';

export default function LoginScreen() {
  const router = useRouter();
  const { styles, c, isDark, link } = useAuthStyles();
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
    // The menu restores the saved profile (name, photo, preferences) from the account.
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
      showAlert(
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
        <StatusBar style={c.statusBar} />
        <View style={styles.header}>
          <BackButton onPress={() => { setForgotMode(false); setResetSent(false); setError(''); }} />
          <Text style={styles.headerTitle}>Reset password</Text>
          <View style={{ width: 36 }} />
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.logo}>go<Text style={styles.logoGreen}>good</Text></Text>
          {resetSent ? (
            <View style={styles.messageBox}>
              <IconBadge name="mail-outline" size={64} />
              <Text style={styles.messageTitle}>Check your inbox</Text>
              <Text style={styles.messageText}>We sent a reset link to{'\n'}<Text style={{ color: link, fontWeight: '600' }}>{email}</Text></Text>
              <TouchableOpacity onPress={() => { setForgotMode(false); setResetSent(false); }} style={styles.btnPrimary}>
                <Text style={styles.btnPrimaryText}>Back to sign in</Text>
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
                  placeholderTextColor={c.placeholder}
                  keyboardAppearance={isDark ? 'dark' : 'light'}
                  value={email}
                  onChangeText={v => { setEmail(v); setError(''); }}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoFocus
                />
                {error ? <Text style={styles.errorText}>{error}</Text> : null}
              </View>
              <TouchableOpacity style={styles.btnPrimary} onPress={handleForgot} disabled={loading}>
                {loading ? <ActivityIndicator color="white" /> : <Text style={styles.btnPrimaryText}>Send reset link</Text>}
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
        <StatusBar style={c.statusBar} />
        <View style={styles.header}>
          <BackButton onPress={() => { setForgotUsernameMode(false); setUsernameSent(false); setError(''); }} />
          <Text style={styles.headerTitle}>Forgot username</Text>
          <View style={{ width: 36 }} />
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.logo}>go<Text style={styles.logoGreen}>good</Text></Text>
          {usernameSent ? (
            <View style={styles.messageBox}>
              <IconBadge name="mail-outline" size={64} />
              <Text style={styles.messageTitle}>Check your inbox</Text>
              <Text style={styles.messageText}>If a Go Good account exists for{'\n'}<Text style={{ color: link, fontWeight: '600' }}>{email}</Text>{'\n'}we've sent your username there.</Text>
              <TouchableOpacity onPress={() => { setForgotUsernameMode(false); setUsernameSent(false); }} style={styles.btnPrimary}>
                <Text style={styles.btnPrimaryText}>Back to sign in</Text>
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
                  placeholderTextColor={c.placeholder}
                  keyboardAppearance={isDark ? 'dark' : 'light'}
                  value={email}
                  onChangeText={v => { setEmail(v); setError(''); }}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoFocus
                />
                {error ? <Text style={styles.errorText}>{error}</Text> : null}
              </View>
              <TouchableOpacity style={styles.btnPrimary} onPress={handleForgotUsername} disabled={loading}>
                {loading ? <ActivityIndicator color="white" /> : <Text style={styles.btnPrimaryText}>Send my username</Text>}
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
      <StatusBar style={c.statusBar} />
      <Animated.View style={[{ flex: 1 }, {
        opacity: enterAnim,
        transform: [{ translateY: enterAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
      }]}>
      <View style={styles.header}>
        <BackButton onPress={() => router.back()} />
        <Text style={styles.headerTitle}>Welcome back</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>go<Text style={styles.logoGreen}>good</Text></Text>
        <Text style={styles.subtitle}>Good to see you again</Text>

        {/* Face ID fast login */}
        {biometricLabel && (
          <TouchableOpacity onPress={handleBiometricLogin} disabled={scanning} activeOpacity={0.85}>
            <Animated.View style={[styles.card, { transform: [{ scale: scanPulse }] }]}>
              <IconBadge name={biometricLabel === 'Face ID' ? 'scan-outline' : biometricLabel === 'Touch ID' ? 'finger-print-outline' : 'lock-closed-outline'} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>
                  {scanning ? 'Scanning...' : `Sign in with ${biometricLabel}`}
                </Text>
                <Text style={styles.cardSub}>
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
            placeholderTextColor={c.placeholder}
            keyboardAppearance={isDark ? 'dark' : 'light'}
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
              placeholderTextColor={c.placeholder}
              keyboardAppearance={isDark ? 'dark' : 'light'}
              value={password}
              onChangeText={v => { setPassword(v); setError(''); }}
              secureTextEntry={!showPassword}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
              textContentType="password"
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(p => !p)}>
              <Text style={styles.eyeText}>{showPassword ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 }}>
          <TouchableOpacity onPress={() => setForgotUsernameMode(true)}>
            <Text style={styles.forgotText}>Forgot username?</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setForgotMode(true)}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.btnPrimary} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="white" /> : <Text style={styles.btnPrimaryText}>Sign in</Text>}
        </TouchableOpacity>

        <View style={styles.switchRow}>
          <Text style={styles.switchText}>Don't have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/auth/signup' as any)}>
            <Text style={styles.switchLink}>Sign up</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}
