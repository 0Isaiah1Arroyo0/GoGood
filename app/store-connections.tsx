import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useTheme } from './context/theme';
import { useAuth } from './context/auth';
import { useSubscription } from './context/subscription';
import { supabase } from './lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const KROGER_CLIENT_ID  = process.env.EXPO_PUBLIC_KROGER_CLIENT_ID ?? '';
const REDIRECT_URI      = 'gogood://oauth/kroger';

interface StoreConnection {
  store: string;
  lastSyncAt: string | null;
  connected: boolean;
}

const STORE_INFO: Record<string, { name: string; emoji: string; apiNote: string; supported: boolean }> = {
  kroger:    { name: 'Kroger',     emoji: '🛒', apiNote: 'Connect account to auto-import purchases',          supported: true },
  walmart:   { name: 'Walmart',    emoji: '🏪', apiNote: 'Use receipt scanning — no official purchase API',   supported: false },
  publix:    { name: 'Publix',     emoji: '🛍️', apiNote: 'Use receipt scanning — no official purchase API',  supported: false },
  sams_club: { name: "Sam's Club", emoji: '📦', apiNote: 'Use receipt scanning — no official purchase API',   supported: false },
  costco:    { name: 'Costco',     emoji: '🏬', apiNote: 'Use receipt scanning — no official purchase API',   supported: false },
};

export default function StoreConnectionsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { isAnnual, showPaywall } = useSubscription();

  const [connections,  setConnections]  = useState<StoreConnection[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [syncing,      setSyncing]      = useState(false);
  const [connecting,   setConnecting]   = useState(false);

  useEffect(() => {
    loadConnections();

    // Handle OAuth redirect
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (url.startsWith('gogood://oauth/kroger')) {
        const params = new URL(url.replace('gogood://', 'https://gogood.app/')).searchParams;
        const code = params.get('code');
        if (code) handleKrogerCallback(code);
      }
    });
    return () => sub.remove();
  }, []);

  const loadConnections = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from('store_connections').select('store, last_sync_at');
      const connectedStores = new Set((data ?? []).map((c: any) => c.store));
      const syncMap = new Map((data ?? []).map((c: any) => [c.store, c.last_sync_at]));
      setConnections(Object.keys(STORE_INFO).map(store => ({
        store,
        connected: connectedStores.has(store),
        lastSyncAt: syncMap.get(store) ?? null,
      })));
    } catch {}
    setLoading(false);
  };

  const connectKroger = async () => {
    if (!KROGER_CLIENT_ID) {
      Alert.alert('Not configured', 'Kroger API credentials not set. Add EXPO_PUBLIC_KROGER_CLIENT_ID to your .env file.');
      return;
    }
    setConnecting(true);
    const authUrl = `https://api.kroger.com/v1/connect/oauth2/authorize?` +
      `client_id=${encodeURIComponent(KROGER_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code` +
      `&scope=profile.compact+cart.write+product.compact`;
    await WebBrowser.openAuthSessionAsync(authUrl, REDIRECT_URI);
    setConnecting(false);
  };

  const handleKrogerCallback = async (code: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/kroger-oauth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: 'exchange', code, redirectUri: REDIRECT_URI }),
      });
      const data = await res.json();
      if (data.ok) {
        Alert.alert('Kroger connected! 🛒', 'Your Kroger account is linked. Tap "Sync Purchases" to import recent items.');
        loadConnections();
      } else {
        Alert.alert('Connection failed', data.error ?? 'Could not connect Kroger account.');
      }
    } catch {
      Alert.alert('Error', 'Could not complete Kroger connection.');
    }
  };

  const syncKroger = async () => {
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/kroger-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ daysBack: 7 }),
      });
      const data = await res.json();
      if (data.error) { Alert.alert('Sync failed', data.error); return; }
      if (!data.sessionId || (data.items?.length ?? 0) === 0) {
        Alert.alert('Up to date', 'No new Kroger purchases found in the last 7 days.');
        return;
      }
      loadConnections();
      router.push({ pathname: '/receipt-review', params: { sessionId: data.sessionId, storeName: 'Kroger' } } as any);
    } catch {
      Alert.alert('Error', 'Could not sync Kroger purchases.');
    }
    setSyncing(false);
  };

  const disconnectStore = (store: string) => {
    Alert.alert(`Disconnect ${STORE_INFO[store]?.name}?`, 'Your saved connection will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => {
        await supabase.from('store_connections').delete().eq('user_id', user?.id).eq('store', store);
        loadConnections();
      }},
    ]);
  };

  return (
    <View style={[styles.safe, { backgroundColor: colors.bg }]}>
      <StatusBar style={colors.statusBar} backgroundColor={colors.bg} />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={{ fontSize: 20, color: colors.brand }}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={[styles.headerTitle, { color: colors.brand }]}>grocery stores</Text>
          <Text style={{ fontSize: 11, color: colors.textSub, marginTop: 2 }}>Connect accounts to auto-import purchases</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>

          {/* Receipt scan tip */}
          <View style={[styles.tipCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={{ fontSize: 15 }}>🧾</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>Receipt scanning works for all stores</Text>
              <Text style={{ fontSize: 12, color: colors.textSub, marginTop: 2, lineHeight: 17 }}>
                Scan any paper or digital receipt from the inventory screen. Works for Walmart, Costco, Publix, Sam's Club — any store.
              </Text>
            </View>
          </View>

          {/* Store list */}
          {Object.entries(STORE_INFO).map(([key, info]) => {
            const conn = connections.find(c => c.store === key);
            const isConnected = conn?.connected ?? false;
            const lastSync = conn?.lastSyncAt;

            return (
              <View key={key} style={[styles.storeCard, { backgroundColor: colors.surface, borderColor: isConnected ? '#1D9E75' : colors.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Text style={{ fontSize: 28 }}>{info.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{info.name}</Text>
                      {isConnected && (
                        <View style={styles.connectedBadge}><Text style={styles.connectedBadgeTxt}>Connected</Text></View>
                      )}
                    </View>
                    <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{info.apiNote}</Text>
                    {isConnected && lastSync && (
                      <Text style={{ fontSize: 11, color: colors.teal, marginTop: 2 }}>
                        Last sync: {new Date(lastSync).toLocaleDateString()}
                      </Text>
                    )}
                  </View>
                </View>

                {info.supported && (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                    {!isAnnual ? (
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: '#FFD166', flex: 1 }]}
                        onPress={showPaywall}
                      >
                        <Text style={{ color: '#085041', fontWeight: '800', fontSize: 13 }}>⭐ Annual Plan Required</Text>
                      </TouchableOpacity>
                    ) : isConnected ? (
                      <>
                        <TouchableOpacity
                          style={[styles.actionBtn, { backgroundColor: '#085041', flex: 2 }]}
                          onPress={syncing ? undefined : syncKroger}
                          disabled={syncing}
                        >
                          {syncing
                            ? <ActivityIndicator color="white" size="small" />
                            : <Text style={{ color: 'white', fontWeight: '700', fontSize: 13 }}>🔄 Sync Purchases</Text>
                          }
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionBtn, { backgroundColor: colors.surfaceAlt, borderWidth: 0.5, borderColor: colors.border, flex: 1 }]}
                          onPress={() => disconnectStore(key)}
                        >
                          <Text style={{ color: colors.textSub, fontWeight: '600', fontSize: 13 }}>Disconnect</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: '#1D9E75', flex: 1, opacity: connecting ? 0.6 : 1 }]}
                        onPress={connectKroger}
                        disabled={connecting}
                      >
                        {connecting
                          ? <ActivityIndicator color="white" size="small" />
                          : <Text style={{ color: 'white', fontWeight: '700', fontSize: 13 }}>Connect Kroger Account</Text>
                        }
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1 },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
  backBtn:    { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle:{ fontSize: 19, fontWeight: '700', fontFamily: 'Fraunces_600SemiBold' },
  tipCard:    { flexDirection: 'row', gap: 12, padding: 14, borderRadius: 14, borderWidth: 0.5, alignItems: 'flex-start' },
  storeCard:  { padding: 16, borderRadius: 16, borderWidth: 1.5 },
  actionBtn:  { borderRadius: 12, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  connectedBadge:    { backgroundColor: 'rgba(29,158,117,0.15)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  connectedBadgeTxt: { fontSize: 10, fontWeight: '700', color: '#1D9E75' },
});
