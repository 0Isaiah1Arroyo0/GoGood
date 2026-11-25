import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, useSegments } from 'expo-router';
import { useFonts } from 'expo-font';
import {
  Fraunces_300Light,
  Fraunces_400Regular,
  Fraunces_600SemiBold,
  Fraunces_300Light_Italic,
  Fraunces_400Regular_Italic,
} from '@expo-google-fonts/fraunces';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ShareIntentProvider } from 'expo-share-intent';
import { ThemeProvider, useTheme } from './context/theme';
import { AuthProvider } from './context/auth';
import { SubscriptionProvider } from './context/subscription';
import PaywallModal from './components/PaywallModal';
import { useAuth } from './context/auth';
import { DialogHost } from '@/components/dialog';

// Keep the Go Good launch screen up until the app is ready (fonts loaded and the
// login checked), then fade it straight into the first screen. Hiding it any
// earlier showed a quick flash of the logo, then a placeholder, then a spinner.
SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: true, duration: 450 });
// Show the launch screen for at least this long, so it reads as a calm intro
// instead of a split-second blink when the app is ready quickly
const SPLASH_MIN_MS = 1200;
const splashStart = Date.now();
let splashHidden = false;
const hideSplash = () => {
  if (splashHidden) return;
  splashHidden = true;
  const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashStart));
  setTimeout(() => { SplashScreen.hideAsync().catch(() => {}); }, wait);
};

// Hides the launch screen once the login check is done and the app has moved on
// from the blank start route to its first real screen (inventory, welcome, Face ID)
function SplashGate() {
  const { loading } = useAuth();
  const segments = useSegments(); // [] on the start route; the inventory tab is ['(tabs)'] even though its path is also '/'
  const arrived = !loading && segments.length > 0;
  useEffect(() => {
    if (!arrived) return;
    // A moment for that screen to draw (and load its items) underneath, so the fade lands on it
    const t = setTimeout(hideSplash, 180);
    return () => clearTimeout(t);
  }, [arrived]);
  return null;
}

function InnerLayout() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack screenOptions={{ headerShown: false, animation: 'fade', animationDuration: 380 }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="auth/welcome" />
        <Stack.Screen name="auth/login" />
        <Stack.Screen name="auth/signup" />
        <Stack.Screen name="auth/biometric" />
        <Stack.Screen name="auth/confirm" />
        <Stack.Screen name="auth/reset" />
        <Stack.Screen name="(tabs)" options={{ gestureEnabled: false }} />
        <Stack.Screen name="receipt-review" />
        <Stack.Screen name="store-connections" />
        <Stack.Screen name="social-recipe-import" options={{ animation: 'none' }} />
      </Stack>
      <DialogHost />
      <PaywallModal />
      <SplashGate />
    </View>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Fraunces_300Light,
    Fraunces_400Regular,
    Fraunces_600SemiBold,
    Fraunces_300Light_Italic,
    Fraunces_400Regular_Italic,
  });

  // Never leave the launch screen up if something is slow (e.g. no connection)
  useEffect(() => {
    const t = setTimeout(hideSplash, 6000);
    return () => clearTimeout(t);
  }, []);

  // The launch screen stays up while the fonts load
  if (!loaded && !error) return null;

  return (
    <ShareIntentProvider>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <SubscriptionProvider>
              <InnerLayout />
            </SubscriptionProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ShareIntentProvider>
  );
}
