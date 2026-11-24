import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/auth';
import { useAuthStyles } from '@/components/auth-ui';
import { raised } from '@/components/raised';
import type { ThemeColors } from '../context/theme';

type AuthState = 'idle' | 'success' | 'fail';

export default function BiometricScreen() {
  const router      = useRouter();
  const { styles: auth, c, isDark } = useAuthStyles();
  const styles = useMemo(() => createStyles(c, isDark), [c, isDark]);
  const { signOut } = useAuth();
  const [label, setLabel]         = useState('Face ID');
  const [authState, setAuthState] = useState<AuthState>('idle');

  const screenFade      = useRef(new Animated.Value(0)).current;
  const screenSlide     = useRef(new Animated.Value(24)).current;
  const heroScale       = useRef(new Animated.Value(0.94)).current;
  const cardsOpacity    = useRef(new Animated.Value(0)).current;
  const cardsTranslateY = useRef(new Animated.Value(20)).current;
  const shakeAnim       = useRef(new Animated.Value(0)).current;
  const successAnim     = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    LocalAuthentication.supportedAuthenticationTypesAsync().then(types => {
      const hasFace        = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
      setLabel(hasFace ? 'Face ID' : hasFingerprint ? 'Touch ID' : 'Passcode');
    });

    Animated.parallel([
      Animated.timing(screenFade,  { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.spring(screenSlide, { toValue: 0, damping: 24, stiffness: 200, useNativeDriver: true }),
      Animated.spring(heroScale,   { toValue: 1, damping: 16, stiffness: 200, useNativeDriver: true }),
    ]).start();

    const staggerTimer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(cardsOpacity,    { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(cardsTranslateY, { toValue: 0, damping: 22, stiffness: 180, useNativeDriver: true }),
      ]).start();
    }, 100);

    const authTimer = setTimeout(() => authenticate(), 700);

    return () => { clearTimeout(staggerTimer); clearTimeout(authTimer); };
  }, []);

  const authenticate = async () => {
    setAuthState('idle');
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Sign in to GoGood',
      disableDeviceFallback: false,
    });
    if (result.success) {
      playSuccess();
    } else {
      playFailure();
    }
  };

  const playSuccess = () => {
    setAuthState('success');
    Animated.timing(successAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start(() => {
      router.replace('/(tabs)' as any);
    });
  };

  const playFailure = () => {
    setAuthState('fail');
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue:  10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue:   8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue:  -8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue:   4, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue:   0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const signInDifferently = async () => {
    await SecureStore.deleteItemAsync('gogood_biometric');
    await signOut();
    router.replace('/auth/welcome' as any);
  };

  const isFail = authState === 'fail';
  const iconName = label === 'Face ID'    ? 'scan-outline'
                 : label === 'Touch ID'   ? 'finger-print-outline'
                 : 'lock-closed-outline';

  return (
    <View style={styles.root}>
      <StatusBar style={c.statusBar} />
      <SafeAreaView style={styles.safe}>
        <Animated.View style={[styles.screen, { opacity: screenFade, transform: [{ translateY: screenSlide }] }]}>

          <View style={styles.top}>
            <Text style={styles.logo}>go<Text style={styles.logoTeal}>good</Text></Text>
          </View>

          <View style={styles.middle}>
            <TouchableOpacity onPress={authenticate} activeOpacity={0.75} style={styles.heroPressable}>
              <Animated.View style={{ transform: [{ scale: heroScale }, { translateX: shakeAnim }] }}>
                <View style={[styles.heroCircle, isFail && styles.heroCircleFail]}>
                  <Ionicons
                    name={iconName as any}
                    size={40}
                    color={isFail ? c.goneBadText : (isDark ? c.tealLight : c.brand)}
                  />
                </View>
              </Animated.View>
            </TouchableOpacity>

            <Animated.View style={[styles.textBlock, { opacity: cardsOpacity, transform: [{ translateY: cardsTranslateY }] }]}>
              <Text style={styles.title}>Welcome back</Text>
              <Text style={[styles.subtitle, isFail && styles.subtitleFail]}>
                {isFail
                  ? `${label} didn't work. Tap to try again.`
                  : `Tap to unlock with ${label}`}
              </Text>
            </Animated.View>
          </View>

          <Animated.View style={[styles.bottom, { opacity: cardsOpacity, transform: [{ translateY: cardsTranslateY }] }]}>
            <TouchableOpacity onPress={authenticate} style={auth.btnPrimary} activeOpacity={0.85}>
              <Text style={auth.btnPrimaryText}>Unlock with {label}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={signInDifferently} activeOpacity={0.7} style={styles.switchPressable}>
              <Text style={styles.switchText}>Sign in with a different account</Text>
            </TouchableOpacity>
          </Animated.View>

        </Animated.View>
      </SafeAreaView>

      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, {
          backgroundColor: c.bg,
          opacity: successAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.12] }),
        }]}
      />
    </View>
  );
}

function createStyles(c: ThemeColors, isDark: boolean) {
  return StyleSheet.create({
    root:   { flex: 1, backgroundColor: c.bg },
    safe:   { flex: 1 },
    screen: { flex: 1, paddingHorizontal: 24, justifyContent: 'space-between' },

    top:      { paddingTop: 36, alignItems: 'center' },
    logo:     { fontSize: 48, fontWeight: '700', color: c.brand, fontFamily: 'Fraunces_600SemiBold' },
    logoTeal: { color: c.teal },

    middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 32 },

    heroPressable: {},
    heroCircle: {
      width: 96, height: 96, borderRadius: 48,
      backgroundColor: c.surface,
      alignItems: 'center', justifyContent: 'center',
      ...raised(isDark, 'md'),
    },
    heroCircleFail: { backgroundColor: c.goneBadBg },

    textBlock:    { alignItems: 'center', gap: 8 },
    title:        { fontSize: 26, fontWeight: '700', color: c.text, fontFamily: 'Fraunces_600SemiBold' },
    subtitle:     { fontSize: 14, color: c.textSub, textAlign: 'center' },
    subtitleFail: { color: c.goneBadText },

    bottom: { paddingBottom: 28, gap: 14 },

    switchPressable: { alignItems: 'center', paddingVertical: 6 },
    switchText:      { fontSize: 14, color: c.textSub, fontWeight: '600' },
  });
}
