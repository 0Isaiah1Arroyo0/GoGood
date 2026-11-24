import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState, useMemo, useEffect, useRef } from 'react';
import {
  ActivityIndicator, Alert, Animated, Easing, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/auth';
import { useTheme } from '../context/theme';
import { useAuthStyles, IconBadge, BackButton } from '@/components/auth-ui';
import * as WebBrowser from 'expo-web-browser';
import { TERMS_URL, PRIVACY_URL } from '@/constants/legal';

// ── Password strength ────────────────────────────────────────────────────────

interface StrengthResult {
  score: number;               // 0-5
  label: 'Too short' | 'Weak' | 'Fair' | 'Good' | 'Strong';
  color: string;
  bars: number;                // filled segments out of 4
  checks: {
    length: boolean;
    longLength: boolean;
    uppercase: boolean;
    number: boolean;
    special: boolean;
  };
}

function getStrength(pw: string): StrengthResult {
  const checks = {
    length:     pw.length >= 8,
    longLength: pw.length >= 12,
    uppercase:  /[A-Z]/.test(pw),
    number:     /[0-9]/.test(pw),
    special:    /[^A-Za-z0-9]/.test(pw),
  };
  if (pw.length === 0) return { score: 0, label: 'Too short', color: '#555', bars: 0, checks };
  if (!checks.length)  return { score: 0, label: 'Too short', color: '#FF6B6B', bars: 1, checks };
  const score = [checks.length, checks.longLength, checks.uppercase, checks.number, checks.special].filter(Boolean).length;
  if (score <= 2) return { score, label: 'Weak',   color: '#FF6B6B', bars: 1, checks };
  if (score === 3) return { score, label: 'Fair',   color: '#FFB347', bars: 2, checks };
  if (score === 4) return { score, label: 'Good',   color: '#7ECB79', bars: 3, checks };
  return              { score, label: 'Strong', color: '#1D9E75', bars: 4, checks };
}

function StrengthBar({ password }: { password: string }) {
  const { colors: tc } = useTheme();
  const s = useMemo(() => getStrength(password), [password]);
  return (
    <View style={{ gap: 8, marginTop: 6 }}>
      {/* Bar */}
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {[0, 1, 2, 3].map(i => (
          <View
            key={i}
            style={{
              flex: 1, height: 4, borderRadius: 99,
              backgroundColor: i < s.bars ? s.color : tc.borderStrong,
            }}
          />
        ))}
        <Text style={{ fontSize: 11, color: s.color, fontWeight: '600', minWidth: 52, textAlign: 'right' }}>
          {password ? s.label : ''}
        </Text>
      </View>
      {/* Requirements checklist */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {[
          { key: 'length',    label: '8+ characters'           },
          { key: 'longLength',label: '12+ characters'          },
          { key: 'uppercase', label: 'Uppercase letter'        },
          { key: 'number',    label: 'Number (0–9)'            },
          { key: 'special',   label: 'Special character (!@#...)'  },
        ].map(({ key, label }) => {
          const met = s.checks[key as keyof typeof s.checks];
          return (
            <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: met ? 1 : 0.7 }}>
              <Text style={{ fontSize: 11, color: met ? tc.teal : tc.textMuted }}>{met ? '✓' : '○'}</Text>
              <Text style={{ fontSize: 11, color: met ? tc.textSub : tc.textMuted }}>{label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function SignupScreen() {
  const router = useRouter();
  const { styles, c, isDark, link } = useAuthStyles();
  const { signUp } = useAuth();

  const [name, setName]         = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm,  setShowConfirm]  = useState(false);
  const [confirm, setConfirm]           = useState('');
  const enterAnim  = useRef(new Animated.Value(0)).current;
  const shakeAnim  = useRef(new Animated.Value(0)).current;
  const btnScale   = useRef(new Animated.Value(1)).current;
  const fieldAnims = useRef([0,1,2,3,4].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.timing(enterAnim, { toValue: 1, duration: 480, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.stagger(70, fieldAnims.map(a =>
      Animated.spring(a, { toValue: 1, damping: 22, stiffness: 180, useNativeDriver: true })
    )).start();
  }, []);

  const shake = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue:  9, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -9, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue:  6, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue:  0, duration: 45, useNativeDriver: true }),
    ]).start();
  };

  const strength = useMemo(() => getStrength(password), [password]);

  const validate = () => {
    if (!name.trim())               { setError('Enter your full name'); shake(); return false; }
    if (!username.trim())           { setError('Enter a username'); shake(); return false; }
    if (!email.trim())              { setError('Enter your email address'); shake(); return false; }
    if (!/\S+@\S+\.\S+/.test(email)) { setError('Enter a valid email address'); shake(); return false; }
    if (!strength.checks.length)    { setError('Password must be at least 8 characters'); shake(); return false; }
    if (password !== confirm)        { setError("Passwords don't match"); shake(); return false; }
    return true;
  };

  const handleSignup = async () => {
    if (!validate()) return;
    setLoading(true); setError('');
    const { error: err } = await signUp(email.trim().toLowerCase(), password, name.trim(), username.trim());
    setLoading(false);
    if (err) {
      shake();
      setError(err.message.includes('already registered')
        ? 'An account with this email already exists'
        : err.message);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await AsyncStorage.setItem('gogood_profile', JSON.stringify({
        name: name.trim(),
        username: username.trim(),
        email: email.trim().toLowerCase(),
        photo: null,
        dietary: [],
        household: 1,
      }));
      setConfirming(true);
    }
  };


  const promptBiometric = async () => {
    const hasHw  = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHw || !enrolled) return;
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const hasFace        = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    const label = hasFace ? 'Face ID' : hasFingerprint ? 'Touch ID' : 'Passcode';
    Alert.alert(
      `Enable ${label}?`,
      `Sign in instantly next time using ${label}`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: `Enable ${label}`, onPress: async () => {
            const result = await LocalAuthentication.authenticateAsync({ promptMessage: `Verify ${label}` });
            if (result.success) await SecureStore.setItemAsync('gogood_biometric', 'enabled');
          },
        },
      ]
    );
  };

  if (confirming) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style={c.statusBar} />
        <ScrollView style={styles.scroll} contentContainerStyle={[styles.body, { justifyContent: 'center', flex: 1 }]}>
          <Text style={styles.logo}>go<Text style={styles.logoGreen}>good</Text></Text>
          <View style={styles.messageBox}>
            <IconBadge name="mail-outline" size={64} />
            <Text style={styles.messageTitle}>Check your inbox</Text>
            <Text style={styles.messageText}>
              We sent a confirmation link to{'\n'}
              <Text style={{ color: link, fontWeight: '600' }}>{email}</Text>
            </Text>
            <Text style={styles.messageHint}>Tap the link in that email to activate your account, then sign in here.</Text>
            <TouchableOpacity style={styles.btnPrimary} onPress={() => router.replace('/auth/login' as any)}>
              <Text style={styles.btnPrimaryText}>Go to sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style={c.statusBar} />
      <Animated.View style={[{ flex: 1 }, {
        opacity: enterAnim,
        transform: [{ translateY: enterAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
      }]}>
      <View style={styles.header}>
        <BackButton onPress={() => router.back()} />
        <Text style={styles.headerTitle}>Create account</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>go<Text style={styles.logoGreen}>good</Text></Text>
        <Text style={styles.subtitle}>Join thousands rescuing food from the trash</Text>

        {/* Name */}
        <Animated.View style={[styles.field, {
          opacity: fieldAnims[0],
          transform: [{ translateY: fieldAnims[0].interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        }]}>
          <Text style={styles.fieldLabel}>Full name</Text>
          <TextInput
            style={styles.input}
            placeholder="First and last name"
            placeholderTextColor={c.placeholder}
            keyboardAppearance={isDark ? 'dark' : 'light'}
            value={name}
            onChangeText={v => { setName(v); setError(''); }}
            returnKeyType="next"
            textContentType="name"
            autoComplete="name"
          />
        </Animated.View>

        {/* Username */}
        <Animated.View style={[styles.field, {
          opacity: fieldAnims[1],
          transform: [{ translateY: fieldAnims[1].interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        }]}>
          <Text style={styles.fieldLabel}>Username</Text>
          <TextInput
            style={styles.input}
            placeholder="@username"
            placeholderTextColor={c.placeholder}
            keyboardAppearance={isDark ? 'dark' : 'light'}
            value={username}
            onChangeText={v => { setUsername(v); setError(''); }}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            textContentType="username"
            autoComplete="username"
          />
        </Animated.View>

        {/* Email */}
        <Animated.View style={[styles.field, {
          opacity: fieldAnims[2],
          transform: [{ translateY: fieldAnims[2].interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        }]}>
          <Text style={styles.fieldLabel}>Email address</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={c.placeholder}
            keyboardAppearance={isDark ? 'dark' : 'light'}
            value={email}
            onChangeText={v => { setEmail(v); setError(''); }}
            autoCapitalize="none"
            keyboardType="email-address"
            returnKeyType="next"
            textContentType="emailAddress"
            autoComplete="email"
          />
        </Animated.View>

        {/* Password + strength bar */}
        <Animated.View style={[styles.field, {
          opacity: fieldAnims[3],
          transform: [{ translateY: fieldAnims[3].interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        }]}>
          <Text style={styles.fieldLabel}>Password</Text>
          <View style={{ position: 'relative' }}>
            <TextInput
              style={[styles.input, { paddingRight: 56 }]}
              placeholder="Create a strong password"
              placeholderTextColor={c.placeholder}
              keyboardAppearance={isDark ? 'dark' : 'light'}
              value={password}
              onChangeText={v => { setPassword(v); setError(''); }}
              secureTextEntry={!showPassword}
              returnKeyType="next"
              textContentType="newPassword"
              autoComplete="new-password"
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(p => !p)}>
              <Text style={styles.eyeText}>{showPassword ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>
          <StrengthBar password={password} />
        </Animated.View>

        {/* Confirm password */}
        <Animated.View style={[styles.field, {
          opacity: fieldAnims[4],
          transform: [{ translateY: fieldAnims[4].interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        }]}>
          <Text style={styles.fieldLabel}>Confirm password</Text>
          <View style={{ position: 'relative' }}>
            <TextInput
              style={[styles.input, { paddingRight: 56 }]}
              placeholder="Repeat your password"
              placeholderTextColor={c.placeholder}
              keyboardAppearance={isDark ? 'dark' : 'light'}
              value={confirm}
              onChangeText={v => { setConfirm(v); setError(''); }}
              secureTextEntry={!showConfirm}
              returnKeyType="done"
              onSubmitEditing={handleSignup}
              textContentType="none"
              autoComplete="off"
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowConfirm(p => !p)}>
              <Text style={styles.eyeText}>{showConfirm ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>
          {confirm.length > 0 && confirm !== password && (
            <Text style={styles.errorText}>Passwords don't match</Text>
          )}
          {confirm.length > 0 && confirm === password && (
            <Text style={styles.matchText}>Passwords match</Text>
          )}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </Animated.View>

        <Animated.View style={{ transform: [{ translateX: shakeAnim }, { scale: btnScale }] }}>
          <TouchableOpacity
            style={[styles.btnPrimary, strength.score < 2 && password.length > 0 && { opacity: 0.6 }]}
            onPress={handleSignup}
            onPressIn={() => Animated.spring(btnScale, { toValue: 0.96, damping: 18, stiffness: 400, useNativeDriver: true }).start()}
            onPressOut={() => Animated.spring(btnScale, { toValue: 1,    damping: 14, stiffness: 250, useNativeDriver: true }).start()}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="white" />
              : <Text style={styles.btnPrimaryText}>Let's go good</Text>}
          </TouchableOpacity>
        </Animated.View>

        <Text style={styles.terms}>
          By creating an account you agree to our{' '}
          <Text style={styles.termsLink} onPress={() => WebBrowser.openBrowserAsync(TERMS_URL)} suppressHighlighting={false}>Terms of Service</Text> and{' '}
          <Text style={styles.termsLink} onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)} suppressHighlighting={false}>Privacy Policy</Text>
        </Text>

        <View style={styles.switchRow}>
          <Text style={styles.switchText}>Already have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/auth/login' as any)}>
            <Text style={styles.switchLink}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}
