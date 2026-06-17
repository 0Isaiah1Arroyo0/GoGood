import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
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
import { ThemeProvider, useTheme } from './context/theme';
import { AuthProvider } from './context/auth';
import { SubscriptionProvider } from './context/subscription';
import PaywallModal from './components/PaywallModal';
import AppSplash from './components/AppSplash';

SplashScreen.preventAutoHideAsync();

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
      <PaywallModal />
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

  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) {
    return (
      <SafeAreaProvider>
        <AppSplash />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <SubscriptionProvider>
            <InnerLayout />
          </SubscriptionProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
