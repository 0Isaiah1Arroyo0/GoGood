import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from './context/auth';

export default function Index() {
  const { session, loading } = useAuth();
  const [biometricEnabled, setBiometricEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync('gogood_biometric').then(val => {
      setBiometricEnabled(val === 'enabled');
    });
  }, []);

  // Still loading Supabase session or SecureStore check
  if (loading || biometricEnabled === null) {
    return (
      <View style={{ flex: 1, backgroundColor: '#085041', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#5DCAA5" size="large" />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/auth/welcome" />;
  }

  // Session is valid — require Face ID gate if the user opted in
  if (biometricEnabled) {
    return <Redirect href="/auth/biometric" />;
  }

  return <Redirect href="/(tabs)" />;
}
