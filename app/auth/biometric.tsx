import { useEffect, useRef, useState } from 'react';
import { Animated, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/auth';

export default function BiometricScreen() {
  const router  = useRouter();
  const { signOut } = useAuth();
  const [label, setLabel]   = useState('Face ID');
  const [failed, setFailed] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    LocalAuthentication.supportedAuthenticationTypesAsync().then(types => {
      const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      setLabel(hasFace ? 'Face ID' : 'Fingerprint');
    });
    pulse();
    authenticate();
  }, []);

  const pulse = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.12, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  };

  const authenticate = async () => {
    setFailed(false);
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: `Sign in to Go Good`,
      fallbackLabel: 'Use password',
      disableDeviceFallback: false,
    });
    if (result.success) {
      router.replace('/(tabs)' as any);
    } else {
      setFailed(true);
    }
  };

  const signInDifferently = async () => {
    await SecureStore.deleteItemAsync('gogood_biometric');
    await signOut();
    router.replace('/auth/welcome' as any);
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <View style={styles.top}>
            <Text style={styles.logo}>go<Text style={styles.logoTeal}>good</Text></Text>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Verify your identity to continue</Text>
          </View>

          <View style={styles.middle}>
            <TouchableOpacity onPress={authenticate} activeOpacity={0.8}>
              <Animated.View style={[styles.iconWrap, { transform: [{ scale: pulseAnim }] }]}>
                <Text style={styles.icon}>{label === 'Face ID' ? '🔐' : '👆'}</Text>
              </Animated.View>
            </TouchableOpacity>
            <Text style={styles.prompt}>
              {failed ? `${label} failed — try again` : `Tap to unlock with ${label}`}
            </Text>
            {failed && (
              <TouchableOpacity style={styles.retryBtn} onPress={authenticate}>
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.bottom}>
            <TouchableOpacity onPress={signInDifferently}>
              <Text style={styles.switchText}>Sign in with a different account</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:      { flex: 1, backgroundColor: '#085041' },
  safe:      { flex: 1 },
  container: { flex: 1, paddingHorizontal: 32, paddingVertical: 24, justifyContent: 'space-between' },
  top:       { alignItems: 'center', gap: 8, paddingTop: 24 },
  logo:      { fontSize: 42, fontWeight: '700', color: 'white', fontFamily: 'Fraunces_600SemiBold' },
  logoTeal:  { color: '#5DCAA5' },
  title:     { fontSize: 22, fontWeight: '700', color: 'white', marginTop: 8 },
  subtitle:  { fontSize: 14, color: 'rgba(255,255,255,0.5)' },
  middle:    { alignItems: 'center', gap: 20 },
  iconWrap:  { width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(93,202,165,0.15)', borderWidth: 1.5, borderColor: 'rgba(93,202,165,0.35)', alignItems: 'center', justifyContent: 'center' },
  icon:      { fontSize: 52 },
  prompt:    { fontSize: 15, color: 'rgba(255,255,255,0.7)', textAlign: 'center' },
  retryBtn:  { backgroundColor: '#1D9E75', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 12 },
  retryText: { color: 'white', fontWeight: '600', fontSize: 14 },
  bottom:    { alignItems: 'center' },
  switchText:{ fontSize: 13, color: 'rgba(255,255,255,0.35)', textDecorationLine: 'underline' },
});
