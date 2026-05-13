import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState, useMemo } from 'react';
import {
  ActivityIndicator, Alert, Platform, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '../context/auth';

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
  const s = useMemo(() => getStrength(password), [password]);
  if (!password) return null;
  return (
    <View style={{ gap: 8, marginTop: 6 }}>
      {/* Bar */}
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {[0, 1, 2, 3].map(i => (
          <View
            key={i}
            style={{
              flex: 1, height: 4, borderRadius: 99,
              backgroundColor: i < s.bars ? s.color : 'rgba(255,255,255,0.12)',
            }}
          />
        ))}
        <Text style={{ fontSize: 11, color: s.color, fontWeight: '600', minWidth: 52, textAlign: 'right' }}>
          {s.label}
        </Text>
      </View>
      {/* Requirements checklist */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {[
          { key: 'length',    label: '8+ chars'   },
          { key: 'longLength',label: '12+ chars'  },
          { key: 'uppercase', label: 'A–Z'        },
          { key: 'number',    label: '0–9'        },
          { key: 'special',   label: '!@#…'       },
        ].map(({ key, label }) => {
          const met = s.checks[key as keyof typeof s.checks];
          return (
            <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: met ? 1 : 0.45 }}>
              <Text style={{ fontSize: 10, color: met ? '#1D9E75' : 'rgba(255,255,255,0.5)' }}>{met ? '✓' : '○'}</Text>
              <Text style={{ fontSize: 10, color: met ? '#5DCAA5' : 'rgba(255,255,255,0.4)' }}>{label}</Text>
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
  const { signUp, signInWithApple } = useAuth();

  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [confirming, setConfirming] = useState(false);

  const strength = useMemo(() => getStrength(password), [password]);

  const validate = () => {
    if (!name.trim())               { setError('Enter your full name'); return false; }
    if (!email.trim())              { setError('Enter your email address'); return false; }
    if (!/\S+@\S+\.\S+/.test(email)) { setError('Enter a valid email address'); return false; }
    if (!strength.checks.length)    { setError('Password must be at least 8 characters'); return false; }
    return true;
  };

  const handleSignup = async () => {
    if (!validate()) return;
    setLoading(true); setError('');
    const { error: err } = await signUp(email.trim().toLowerCase(), password, name.trim());
    setLoading(false);
    if (err) {
      setError(err.message.includes('already registered')
        ? 'An account with this email already exists'
        : err.message);
    } else {
      setConfirming(true);
    }
  };

  const handleApple = async () => {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      setLoading(true); setError('');
      const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
        .filter(Boolean).join(' ') || null;
      const { error: err } = await signInWithApple(credential.identityToken!, fullName);
      setLoading(false);
      if (err) { setError(err.message); }
      else { await promptBiometric(); router.replace('/(tabs)' as any); }
    } catch (e: any) {
      if (e.code !== 'ERR_REQUEST_CANCELED') setError('Apple sign in failed');
    }
  };

  const promptBiometric = async () => {
    const hasHw  = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHw || !enrolled) return;
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const label = hasFace ? 'Face ID' : 'Fingerprint';
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
        <StatusBar style="light" />
        <ScrollView style={styles.scroll} contentContainerStyle={[styles.body, { justifyContent: 'center', flex: 1 }]}>
          <Text style={styles.logo}>go<Text style={styles.logoGreen}>good</Text></Text>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmIcon}>📬</Text>
            <Text style={styles.confirmTitle}>Check your inbox</Text>
            <Text style={styles.confirmSub}>
              We sent a confirmation link to{'\n'}
              <Text style={{ color: '#5DCAA5', fontWeight: '600' }}>{email}</Text>
            </Text>
            <Text style={styles.confirmHint}>Tap the link in that email to activate your account, then sign in here.</Text>
            <TouchableOpacity style={styles.btnPrimary} onPress={() => router.replace('/auth/login' as any)}>
              <Text style={styles.btnPrimaryText}>go to sign in →</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create account</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>go<Text style={styles.logoGreen}>good</Text></Text>
        <Text style={styles.subtitle}>Join thousands rescuing food from the trash 🌱</Text>

        {/* Name */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Full name</Text>
          <TextInput
            style={styles.input}
            placeholder="First and last name"
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={name}
            onChangeText={v => { setName(v); setError(''); }}
            returnKeyType="next"
            textContentType="name"
            autoComplete="name"
          />
        </View>

        {/* Email */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Email address</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={email}
            onChangeText={v => { setEmail(v); setError(''); }}
            autoCapitalize="none"
            keyboardType="email-address"
            returnKeyType="next"
            textContentType="emailAddress"
            autoComplete="email"
          />
        </View>

        {/* Password + strength bar */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Create a strong password"
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={password}
            onChangeText={v => { setPassword(v); setError(''); }}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={handleSignup}
            textContentType="newPassword"
            autoComplete="new-password"
          />
          <StrengthBar password={password} />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        <TouchableOpacity
          style={[styles.btnPrimary, strength.score < 2 && password.length > 0 && { opacity: 0.6 }]}
          onPress={handleSignup}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="white" />
            : <Text style={styles.btnPrimaryText}>let's go good →</Text>}
        </TouchableOpacity>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or sign up with</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={styles.socialRow}>
          {Platform.OS === 'ios' && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP}
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

        <Text style={styles.terms}>
          By creating an account you agree to our{' '}
          <Text style={styles.termsLink}>Terms of Service</Text> and{' '}
          <Text style={styles.termsLink}>Privacy Policy</Text>
        </Text>

        <View style={styles.switchRow}>
          <Text style={styles.switchText}>already have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/auth/login' as any)}>
            <Text style={styles.switchLink}>sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea:      { flex: 1, backgroundColor: '#085041' },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.1)' },
  backBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  backText:      { fontSize: 18, color: 'white' },
  headerTitle:   { fontSize: 16, fontWeight: '600', color: 'white' },
  scroll:        { flex: 1, backgroundColor: '#085041' },
  body:          { padding: 28, gap: 16, paddingBottom: 48 },
  logo:          { fontSize: 36, fontWeight: '700', color: 'white', textAlign: 'center', fontFamily: 'Fraunces_600SemiBold' },
  logoGreen:     { color: '#5DCAA5', fontFamily: 'Fraunces_600SemiBold' },
  subtitle:      { fontSize: 13, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: -8 },
  field:         { gap: 6 },
  fieldLabel:    { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1 },
  input:         { backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 12, padding: 14, fontSize: 14, color: 'white' },
  errorText:     { fontSize: 11, color: '#FF8A8A', marginTop: 4 },
  btnPrimary:    { backgroundColor: '#1D9E75', padding: 16, borderRadius: 14, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  btnPrimaryText:{ color: 'white', fontSize: 15, fontWeight: '600' },
  dividerRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine:   { flex: 1, height: 0.5, backgroundColor: 'rgba(255,255,255,0.15)' },
  dividerText:   { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  socialRow:     { flexDirection: 'row', gap: 10 },
  appleBtn:      { flex: 1, height: 48 },
  socialBtn:     { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 12, padding: 14, alignItems: 'center', justifyContent: 'center' },
  socialText:    { fontSize: 13, fontWeight: '500', color: 'white' },
  terms:         { fontSize: 11, color: 'rgba(255,255,255,0.3)', textAlign: 'center', lineHeight: 18 },
  termsLink:     { color: '#5DCAA5' },
  switchRow:     { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  switchText:    { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  switchLink:    { fontSize: 13, color: '#5DCAA5', fontWeight: '600' },
  confirmBox:    { gap: 16, alignItems: 'center' },
  confirmIcon:   { fontSize: 56, textAlign: 'center' },
  confirmTitle:  { fontSize: 22, fontWeight: '700', color: 'white', textAlign: 'center', fontFamily: 'Fraunces_600SemiBold' },
  confirmSub:    { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 22 },
  confirmHint:   { fontSize: 12, color: 'rgba(255,255,255,0.4)', textAlign: 'center', lineHeight: 20 },
});
