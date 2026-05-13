import { useEffect } from 'react';
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
import { ThemeProvider } from './context/theme';
import { AuthProvider } from './context/auth';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Fraunces_300Light,
    Fraunces_400Regular,
    Fraunces_600SemiBold,
    Fraunces_300Light_Italic,
    Fraunces_400Regular_Italic,
  });

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <ThemeProvider>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="auth/welcome" />
          <Stack.Screen name="auth/login" />
          <Stack.Screen name="auth/signup" />
          <Stack.Screen name="auth/biometric" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </AuthProvider>
    </ThemeProvider>
  );
}
