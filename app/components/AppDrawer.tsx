import {
  View, Text, TouchableOpacity, Animated, StyleSheet, Alert, Image,
  Modal, TextInput, ScrollView, Switch, Platform, KeyboardAvoidingView,
  LayoutAnimation, UIManager, Linking,
} from 'react-native';
import Constants from 'expo-constants';
import { useRef, useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../context/auth';
import { useTheme, type ThemeColors } from '../context/theme';
import { useSubscription } from '../context/subscription';
import { requestNotificationPermission, rescheduleExpiryNotifications } from '../lib/notifications';
import { supabase } from '../lib/supabase';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Profile {
  name: string; email: string; username: string; photo: string | null;
  dietary: string[]; household: number;
}
interface Stats  { goneGood: number; goneBad: number; totalAdded: number; }
interface Notifs { expiry: boolean; digest: boolean; weekly: boolean; }

const EMPTY_PROFILE: Profile = { name: '', email: '', username: '', photo: null, dietary: [], household: 1 };
const EMPTY_STATS:   Stats   = { goneGood: 0, goneBad: 0, totalAdded: 0 };
const EMPTY_NOTIFS:  Notifs  = { expiry: true, digest: false, weekly: false };

const DIETARY_OPTIONS = ['Vegan', 'Vegetarian', 'Gluten-Free', 'Dairy-Free', 'Keto', 'Nut-Free', 'Halal', 'Kosher'];

const FAQ = [
  { q: 'How do I add items?', a: 'Tap the + button in the top right. Fill in details manually or use 📷 scan label to auto-fill from a food package.' },
  { q: 'What do the badge colors mean?', a: 'Green = 6+ days left. Amber = 1–5 days. Red = expires today. Dark = already expired. Blue = frozen.' },
  { q: 'How does label scanning work?', a: 'When adding an item, tap 📷 scan label, take a photo of the packaging, and AI fills in the name, expiry, and macros automatically.' },
  { q: 'How do I mark something as used?', a: 'Tap any item to expand it, then tap ✓ gone good when used, or 🥀 gone bad if it went to waste.' },
  { q: 'Can I share with family?', a: 'Yes! Go to the Household tab (🏠) to create a shared list or join one with an invite code. Everyone in the household sees and edits the same inventory in real time.' },
  { q: 'How do I edit an item?', a: 'Expand the item by tapping it, then tap the ✏️ button to open the edit form.' },
];

const PRO_FEATURES = [
  { icon: '📷', title: 'Unlimited label scanning',  sub: 'Scan as many items as you want' },
  { icon: '🤖', title: 'AI recipe suggestions',      sub: "Recipes based on what's about to expire" },
  { icon: '👨‍👩‍👧', title: 'Household sharing',         sub: 'Share your inventory with family' },
  { icon: '📊', title: 'Waste analytics',            sub: 'Track food and money saved over time' },
  { icon: '⚡', title: 'Priority support',           sub: 'Get help fast when you need it' },
];

// ─── Inner Sheet (slide-up modal) ─────────────────────────────────────────────

function Sheet({ visible, onClose, children, colors }: {
  visible: boolean; onClose: () => void; children: React.ReactNode; colors: ThemeColors;
}) {
  const slideAnim = useRef(new Animated.Value(600)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      slideAnim.setValue(600); fadeAnim.setValue(0);
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: 280, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, damping: 22, stiffness: 180, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 600, duration: 220, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [visible]);

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={{ flex: 1 }}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)', opacity: fadeAnim }]} pointerEvents="none" />
          <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
          <Animated.View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%', transform: [{ translateY: slideAnim }] }}>
            <View style={{ width: 36, height: 4, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 999, alignSelf: 'center', marginBottom: 16 }} />
            {children}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Collapsible section header ───────────────────────────────────────────────

function SectionHeader({ label, open, onToggle, colors }: {
  label: string; open: boolean; onToggle: () => void; colors: ThemeColors;
}) {
  return (
    <TouchableOpacity style={sharedStyles.sectionHeader} onPress={onToggle} activeOpacity={0.7}>
      <Text style={[sharedStyles.sectionLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[sharedStyles.sectionArrow, { color: colors.textMuted, transform: [{ rotate: open ? '90deg' : '0deg' }] }]}>›</Text>
    </TouchableOpacity>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAppDrawer() {
  const router = useRouter();
  const { signOut, user } = useAuth();
  const { colors, isDark, toggleTheme } = useTheme();
  const { showPaywall, paywallDemoMode, setPaywallDemoMode } = useSubscription();

  // ── Drawer animation state ──────────────────────────────────────────────────
  const [visible, setVisible]   = useState(false);
  const drawerAnim  = useRef(new Animated.Value(-280)).current;
  const menuAnim    = useRef(new Animated.Value(0)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  // ── Section collapse state ──────────────────────────────────────────────────
  const [navOpen,     setNavOpen]     = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [appOpen,     setAppOpen]     = useState(false);

  // ── Modal visibility ────────────────────────────────────────────────────────
  const [showProfile,       setShowProfile]       = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showPro,           setShowPro]           = useState(false);
  const [showHelp,          setShowHelp]          = useState(false);
  const [showRate,          setShowRate]          = useState(false);

  // ── Data state ──────────────────────────────────────────────────────────────
  const [profile,       setProfile]       = useState<Profile>(EMPTY_PROFILE);
  const [editProfile,   setEditProfile]   = useState<Profile>(EMPTY_PROFILE);
  const [stats,         setStats]         = useState<Stats>(EMPTY_STATS);
  const [itemCount,     setItemCount]     = useState(0);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [notifs,        setNotifs]        = useState<Notifs>(EMPTY_NOTIFS);
  const [editNotifs,    setEditNotifs]    = useState<Notifs>(EMPTY_NOTIFS);
  const [rating,        setRating]        = useState(0);
  const [review,        setReview]        = useState('');
  const [openFaq,       setOpenFaq]       = useState<number | null>(null);

  // ── Load from AsyncStorage ──────────────────────────────────────────────────
  const loadData = async () => {
    const [profileVal, statsVal, notifsVal, bioVal, itemsVal] = await Promise.all([
      AsyncStorage.getItem('gogood_profile'),
      AsyncStorage.getItem('gogood_stats'),
      AsyncStorage.getItem('gogood_notifs'),
      SecureStore.getItemAsync('gogood_biometric'),
      AsyncStorage.getItem('gogood_items'),
    ]);
    const stored: Partial<Profile> = profileVal ? JSON.parse(profileVal) : {};
    const authEmail = user?.email ?? '';
    const authName  = (user?.user_metadata?.full_name as string) ?? '';
    const p: Profile = {
      ...EMPTY_PROFILE,
      ...stored,
      email: stored.email || authEmail,
      name:  stored.name  || authName,
    };
    setProfile(p); setEditProfile(p);
    if (statsVal)  setStats(JSON.parse(statsVal));
    if (notifsVal) { const n = { ...EMPTY_NOTIFS, ...JSON.parse(notifsVal) }; setNotifs(n); setEditNotifs(n); }
    setBiometricEnabled(bioVal === 'enabled');
    setItemCount(itemsVal ? JSON.parse(itemsVal).length : 0);
  };

  useEffect(() => { loadData(); }, []);

  // ── Drawer open/close ────────────────────────────────────────────────────────
  const open = () => {
    loadData();
    setVisible(true);
    Animated.parallel([
      Animated.spring(drawerAnim,  { toValue: 0, damping: 24, stiffness: 200, useNativeDriver: true }),
      Animated.timing(menuAnim,    { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.timing(overlayAnim, { toValue: 1, duration: 240, useNativeDriver: true }),
    ]).start();
  };

  const close = () => {
    Animated.parallel([
      Animated.timing(drawerAnim,  { toValue: -280, duration: 230, useNativeDriver: true }),
      Animated.timing(menuAnim,    { toValue: 0,    duration: 210, useNativeDriver: true }),
      Animated.timing(overlayAnim, { toValue: 0,    duration: 200, useNativeDriver: true }),
    ]).start(() => setVisible(false));
  };

  const openModal = (setter: (v: boolean) => void) => {
    close();
    setTimeout(() => setter(true), 260);
  };

  // ── Section toggle ───────────────────────────────────────────────────────────
  const toggleSection = (setter: (v: boolean) => void, current: boolean) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setter(!current);
  };

  // ── Biometric ────────────────────────────────────────────────────────────────
  const toggleBiometric = async () => {
    if (biometricEnabled) {
      await SecureStore.deleteItemAsync('gogood_biometric');
      setBiometricEnabled(false);
    } else {
      const hasHw    = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHw || !enrolled) { Alert.alert('Not available', 'Face ID / Touch ID is not set up on this device.'); return; }
      const types   = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      const result  = await LocalAuthentication.authenticateAsync({
        promptMessage: `Enable ${hasFace ? 'Face ID' : 'Touch ID'} for Go Good`,
        disableDeviceFallback: false,
      });
      if (result.success) { await SecureStore.setItemAsync('gogood_biometric', 'enabled'); setBiometricEnabled(true); }
    }
  };

  // ── Logout ───────────────────────────────────────────────────────────────────
  const handleLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out', style: 'destructive', onPress: async () => {
          close();
          const hasHw    = await LocalAuthentication.hasHardwareAsync();
          const enrolled = await LocalAuthentication.isEnrolledAsync();
          if (hasHw && enrolled) {
            await SecureStore.setItemAsync('gogood_biometric', 'enabled');
            router.replace('/auth/biometric' as any);
          } else {
            await signOut();
            router.replace('/auth/welcome' as any);
          }
        },
      },
    ]);
  };

  // ── Profile ──────────────────────────────────────────────────────────────────
  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });
    if (!result.canceled) setEditProfile(p => ({ ...p, photo: result.assets[0].uri }));
  };

  const saveProfile = async () => {
    if (!editProfile.name.trim()) {
      Alert.alert('Name required', 'Please enter your name before saving.');
      return;
    }
    await AsyncStorage.setItem('gogood_profile', JSON.stringify(editProfile));
    setProfile(editProfile);
    // Async sync to Supabase — fire and forget
    supabase.from('profiles').update({
      display_name:         editProfile.name.trim(),
      dietary_preferences:  editProfile.dietary,
      household_size:       editProfile.household,
      updated_at:           new Date().toISOString(),
    }).eq('id', (await supabase.auth.getUser()).data.user?.id ?? '').catch(() => {});
    setShowProfile(false);
  };

  // ── Notifications ─────────────────────────────────────────────────────────────
  const saveNotifications = async () => {
    const hasPermission = await requestNotificationPermission();
    const toSave = hasPermission ? editNotifs : { ...editNotifs, expiry: false };
    await AsyncStorage.setItem('gogood_notifs', JSON.stringify(toSave));
    setNotifs(toSave); setEditNotifs(toSave);
    const itemsVal = await AsyncStorage.getItem('gogood_items');
    const items = itemsVal ? JSON.parse(itemsVal) : [];
    await rescheduleExpiryNotifications(items, toSave.expiry);
    setShowNotifications(false);
  };

  // ─── menuBtn ─────────────────────────────────────────────────────────────────
  const menuBtn = (
    <TouchableOpacity style={sharedStyles.menuBtn} onPress={visible ? close : open} activeOpacity={0.7}>
      <Animated.View style={[sharedStyles.menuLine, { backgroundColor: colors.text, transform: [
        { translateY: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 6.5] }) },
        { rotate:    menuAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] }) },
      ]}]} />
      <Animated.View style={[sharedStyles.menuLine, { backgroundColor: colors.text, width: 14,
        opacity:   menuAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [{ scaleX: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) }],
      }]} />
      <Animated.View style={[sharedStyles.menuLine, { backgroundColor: colors.text, transform: [
        { translateY: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -6.5] }) },
        { rotate:    menuAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-45deg'] }) },
      ]}]} />
    </TouchableOpacity>
  );

  // ─── drawerEl ────────────────────────────────────────────────────────────────
  const drawerEl = (
    <>
      {/* ── Sliding panel + overlay ── */}
      {visible && (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close}>
            <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)', opacity: overlayAnim }]} />
          </TouchableOpacity>

          <Animated.View style={[sharedStyles.drawer, { backgroundColor: colors.drawerBg, transform: [{ translateX: drawerAnim }] }]}>
            <ScrollView showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ paddingBottom: 40 }}>

              {/* Header */}
              <View style={sharedStyles.drawerHeader}>
                <Text style={[sharedStyles.drawerLogo, { color: colors.text }]}>go<Text style={{ color: '#5DCAA5' }}>good</Text></Text>
                <TouchableOpacity onPress={close} style={[sharedStyles.closeBtn, { backgroundColor: colors.surfaceAlt }]}>
                  <Text style={[sharedStyles.closeText, { color: colors.textMuted }]}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Profile preview */}
              <TouchableOpacity style={[sharedStyles.profileRow, { borderBottomColor: colors.border }]} onPress={() => openModal(setShowProfile)} activeOpacity={0.75}>
                <View style={sharedStyles.avatar}>
                  {profile.photo
                    ? <Image source={{ uri: profile.photo }} style={{ width: 44, height: 44, borderRadius: 22 }} />
                    : <Text style={{ fontSize: 20 }}>{profile.name ? profile.name[0].toUpperCase() : '👤'}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[sharedStyles.profileName, { color: colors.text }]} numberOfLines={1}>
                    {profile.name || 'Set up your profile'}
                  </Text>
                  <Text style={{ fontSize: 11, color: '#5DCAA5' }}>edit profile →</Text>
                </View>
              </TouchableOpacity>

              {/* ── Navigate ── */}
              <SectionHeader label="navigate" open={navOpen} onToggle={() => toggleSection(setNavOpen, navOpen)} colors={colors} />
              {navOpen && (
                <View>
                  {[
                    { icon: '🥗', label: 'Inventory',        route: '/(tabs)' },
                    { icon: '🤖', label: 'Good Bot',          route: '/(tabs)/goodbot' },
                    { icon: '📊', label: 'Food Report',       route: '/(tabs)/foodreport' },
                    { icon: '🏠', label: 'Household',         route: '/(tabs)/household' },
                    { icon: '🛒', label: 'Grocery Stores',    route: '/store-connections' },
                  ].map(item => (
                    <TouchableOpacity key={item.label} style={[sharedStyles.item, { borderBottomColor: colors.border }]}
                      onPress={() => { close(); router.navigate(item.route as any); }}>
                      <Text style={sharedStyles.itemIcon}>{item.icon}</Text>
                      <Text style={[sharedStyles.itemText, { color: colors.text }]}>{item.label}</Text>
                      <Text style={{ color: colors.textMuted, fontSize: 16 }}>›</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* ── Account ── */}
              <SectionHeader label="account" open={accountOpen} onToggle={() => toggleSection(setAccountOpen, accountOpen)} colors={colors} />
              {accountOpen && (
                <View>
                  <TouchableOpacity style={[sharedStyles.item, { borderBottomColor: colors.border }]} onPress={() => openModal(setShowProfile)}>
                    <Text style={sharedStyles.itemIcon}>👤</Text>
                    <Text style={[sharedStyles.itemText, { color: colors.text }]}>Profile</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 16 }}>›</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[sharedStyles.item, { borderBottomColor: colors.border }]} onPress={toggleBiometric}>
                    <Text style={sharedStyles.itemIcon}>{biometricEnabled ? '🔐' : '🔓'}</Text>
                    <Text style={[sharedStyles.itemText, { color: colors.text }]}>Face ID</Text>
                    <Switch value={biometricEnabled} onValueChange={toggleBiometric}
                      trackColor={{ false: '#ddd', true: '#1D9E75' }} thumbColor="white" />
                  </TouchableOpacity>
                  <TouchableOpacity style={[sharedStyles.item, { borderBottomColor: colors.border }]} onPress={() => openModal(setShowNotifications)}>
                    <Text style={sharedStyles.itemIcon}>🔔</Text>
                    <Text style={[sharedStyles.itemText, { color: colors.text }]}>Notifications</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 16 }}>›</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[sharedStyles.item, { borderBottomColor: colors.border }]} onPress={() => { close(); setTimeout(showPaywall, 260); }}>
                    <Text style={sharedStyles.itemIcon}>🌱</Text>
                    <Text style={[sharedStyles.itemText, { color: colors.text }]}>Go Good Pro</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 16 }}>›</Text>
                  </TouchableOpacity>
                  <View style={[sharedStyles.item, { borderBottomColor: colors.border }]}>
                    <Text style={sharedStyles.itemIcon}>🎭</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[sharedStyles.itemText, { color: colors.text }]}>Paywall demo mode</Text>
                      <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 1 }}>Show paywall when tapping locked features</Text>
                    </View>
                    <Switch
                      value={paywallDemoMode}
                      onValueChange={setPaywallDemoMode}
                      trackColor={{ false: '#ddd', true: '#1D9E75' }}
                      thumbColor="white"
                    />
                  </View>
                </View>
              )}

              {/* ── App ── */}
              <SectionHeader label="app" open={appOpen} onToggle={() => toggleSection(setAppOpen, appOpen)} colors={colors} />
              {appOpen && (
                <View>
                  <TouchableOpacity style={[sharedStyles.item, { borderBottomColor: colors.border }]} onPress={toggleTheme}>
                    <Text style={sharedStyles.itemIcon}>{isDark ? '☀️' : '🌙'}</Text>
                    <Text style={[sharedStyles.itemText, { color: colors.text }]}>{isDark ? 'Light mode' : 'Dark mode'}</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 16 }}>›</Text>
                  </TouchableOpacity>
<TouchableOpacity style={[sharedStyles.item, { borderBottomColor: colors.border }]} onPress={() => openModal(setShowHelp)}>
                    <Text style={sharedStyles.itemIcon}>❓</Text>
                    <Text style={[sharedStyles.itemText, { color: colors.text }]}>Help & Feedback</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 16 }}>›</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[sharedStyles.item, { borderBottomColor: colors.border }]} onPress={() => openModal(setShowRate)}>
                    <Text style={sharedStyles.itemIcon}>⭐</Text>
                    <Text style={[sharedStyles.itemText, { color: colors.text }]}>Rate Go Good</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 16 }}>›</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Logout */}
              <TouchableOpacity style={sharedStyles.logoutBtn} onPress={handleLogout}>
                <Text style={sharedStyles.logoutText}>Log out</Text>
              </TouchableOpacity>
              <Text style={[sharedStyles.version, { color: colors.textMuted }]}>Go Good v{Constants.expoConfig?.version ?? '1.0'} · made with 🌱 in NC</Text>

            </ScrollView>
          </Animated.View>
        </View>
      )}

      {/* ── Profile modal ── */}
      <Sheet visible={showProfile} onClose={() => setShowProfile(false)} colors={colors}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Text style={[sharedStyles.modalTitle, { color: colors.text }]}>Profile</Text>
            <TouchableOpacity onPress={() => setShowProfile(false)}><Text style={{ fontSize: 18, color: '#aaa' }}>✕</Text></TouchableOpacity>
          </View>

          {/* Photo */}
          <View style={{ alignItems: 'center', marginBottom: 20 }}>
            <TouchableOpacity onPress={pickPhoto}>
              <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: '#E1F5EE', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {editProfile.photo
                  ? <Image source={{ uri: editProfile.photo }} style={{ width: 84, height: 84 }} />
                  : <Text style={{ fontSize: 36 }}>{editProfile.name ? editProfile.name[0].toUpperCase() : '👤'}</Text>}
              </View>
              <View style={{ position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, borderRadius: 13, backgroundColor: '#085041', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 13 }}>📷</Text>
              </View>
            </TouchableOpacity>
            <Text style={{ fontSize: 10, color: '#aaa', marginTop: 6 }}>tap to change photo</Text>
          </View>

          {/* Stats */}
          <View style={{ flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 12, marginBottom: 20 }}>
            {[
              { val: itemCount,       label: 'in storage', color: '#085041' },
              { val: stats.goneGood,  label: 'gone good',  color: '#1D9E75' },
              { val: stats.goneBad,   label: 'gone bad',   color: '#E24B4A' },
            ].map((s, i) => (
              <View key={s.label} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i > 0 ? 0.5 : 0, borderLeftColor: colors.border }}>
                <Text style={{ fontSize: 22, fontWeight: '700', color: s.color }}>{s.val}</Text>
                <Text style={{ fontSize: 9, color: colors.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* Fields */}
          <Text style={[sharedStyles.fieldLabel, { color: colors.textSub }]}>Name</Text>
          <TextInput style={[sharedStyles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.inputText }]}
            placeholder="Your name" placeholderTextColor={colors.placeholder}
            value={editProfile.name} onChangeText={v => setEditProfile(p => ({ ...p, name: v }))} />

          <Text style={[sharedStyles.fieldLabel, { color: colors.textSub }]}>Username</Text>
          <TextInput style={[sharedStyles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.inputText }]}
            placeholder="@username" placeholderTextColor={colors.placeholder}
            value={editProfile.username} onChangeText={v => setEditProfile(p => ({ ...p, username: v }))}
            autoCapitalize="none" autoCorrect={false} />

          <Text style={[sharedStyles.fieldLabel, { color: colors.textSub }]}>Email</Text>
          <TextInput style={[sharedStyles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.inputText }]}
            placeholder="your@email.com" placeholderTextColor={colors.placeholder}
            value={editProfile.email} onChangeText={v => setEditProfile(p => ({ ...p, email: v }))}
            keyboardType="email-address" autoCapitalize="none" />

          <Text style={[sharedStyles.fieldLabel, { color: colors.textSub }]}>Household size</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 10, padding: 11 }}>
            <Text style={{ fontSize: 14, color: colors.inputText }}>{editProfile.household} {editProfile.household === 1 ? 'person' : 'people'}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={[sharedStyles.qtyBtn, editProfile.household <= 1 && { backgroundColor: '#ccc' }]}
                onPress={() => setEditProfile(p => ({ ...p, household: Math.max(1, p.household - 1) }))}>
                <Text style={sharedStyles.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[sharedStyles.qtyBtn, editProfile.household >= 10 && { backgroundColor: '#ccc' }]}
                onPress={() => setEditProfile(p => ({ ...p, household: Math.min(10, p.household + 1) }))}>
                <Text style={sharedStyles.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={[sharedStyles.fieldLabel, { color: colors.textSub }]}>Dietary preferences</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {DIETARY_OPTIONS.map(pref => {
              const on = editProfile.dietary.includes(pref);
              return (
                <TouchableOpacity key={pref}
                  onPress={() => setEditProfile(p => ({ ...p, dietary: on ? p.dietary.filter(d => d !== pref) : [...p.dietary, pref] }))}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: on ? '#085041' : colors.surface, borderWidth: 1, borderColor: on ? '#085041' : colors.border }}>
                  <Text style={{ fontSize: 11, fontWeight: '500', color: on ? 'white' : colors.textSub }}>{pref}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity style={[sharedStyles.confirmBtn, { marginTop: 20 }]} onPress={saveProfile}>
            <Text style={sharedStyles.confirmBtnText}>Save profile →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={sharedStyles.cancelBtn} onPress={() => setShowProfile(false)}>
            <Text style={sharedStyles.cancelText}>cancel</Text>
          </TouchableOpacity>
          <View style={{ height: 20 }} />
        </ScrollView>
      </Sheet>

      {/* ── Notifications modal ── */}
      <Sheet visible={showNotifications} onClose={() => setShowNotifications(false)} colors={colors}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <Text style={[sharedStyles.modalTitle, { color: colors.text }]}>Notifications</Text>
          <TouchableOpacity onPress={() => setShowNotifications(false)}><Text style={{ fontSize: 18, color: '#aaa' }}>✕</Text></TouchableOpacity>
        </View>
        {([
          { key: 'expiry', title: 'Expiry alerts',  sub: 'Get notified 3 days before items expire' },
          { key: 'digest', title: 'Daily digest',    sub: 'Morning summary of what to use today' },
          { key: 'weekly', title: 'Weekly report',   sub: 'See your food waste stats every Sunday' },
        ] as const).map(n => (
          <View key={n.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text }}>{n.title}</Text>
              <Text style={{ fontSize: 11, color: colors.textSub, marginTop: 2 }}>{n.sub}</Text>
            </View>
            <Switch value={editNotifs[n.key]} onValueChange={v => setEditNotifs(prev => ({ ...prev, [n.key]: v }))}
              trackColor={{ false: '#ddd', true: '#1D9E75' }} thumbColor="white" />
          </View>
        ))}
        <TouchableOpacity style={[sharedStyles.confirmBtn, { marginTop: 20 }]} onPress={saveNotifications}>
          <Text style={sharedStyles.confirmBtnText}>Save →</Text>
        </TouchableOpacity>
      </Sheet>

      {/* ── Go Good Pro modal ── */}
      <Sheet visible={showPro} onClose={() => setShowPro(false)} colors={colors}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text style={[sharedStyles.modalTitle, { color: colors.text }]}>Go Good Pro 🌱</Text>
          <TouchableOpacity onPress={() => setShowPro(false)}><Text style={{ fontSize: 18, color: '#aaa' }}>✕</Text></TouchableOpacity>
        </View>
        <View style={{ backgroundColor: '#E1F5EE', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', marginBottom: 16 }}>
          <Text style={{ fontSize: 10, fontWeight: '600', color: '#085041' }}>COMING SOON</Text>
        </View>
        {PRO_FEATURES.map(f => (
          <View key={f.icon} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 22 }}>{f.icon}</Text>
            <View>
              <Text style={{ fontSize: 13, fontWeight: '500', color: colors.text }}>{f.title}</Text>
              <Text style={{ fontSize: 11, color: colors.textSub }}>{f.sub}</Text>
            </View>
          </View>
        ))}
        <TouchableOpacity style={[sharedStyles.confirmBtn, { marginTop: 20 }]} onPress={() => setShowPro(false)}>
          <Text style={sharedStyles.confirmBtnText}>Join waitlist →</Text>
        </TouchableOpacity>
        <TouchableOpacity style={sharedStyles.cancelBtn} onPress={() => setShowPro(false)}>
          <Text style={sharedStyles.cancelText}>maybe later</Text>
        </TouchableOpacity>
      </Sheet>

      {/* ── Help & Feedback modal ── */}
      <Sheet visible={showHelp} onClose={() => setShowHelp(false)} colors={colors}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Text style={[sharedStyles.modalTitle, { color: colors.text }]}>Help & Feedback</Text>
          <TouchableOpacity onPress={() => setShowHelp(false)}><Text style={{ fontSize: 18, color: '#aaa' }}>✕</Text></TouchableOpacity>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={[sharedStyles.fieldLabel, { marginTop: 0, color: colors.textSub }]}>FAQ</Text>
          {FAQ.map((item, i) => (
            <TouchableOpacity key={i} onPress={() => setOpenFaq(openFaq === i ? null : i)}
              style={{ paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 13, fontWeight: '500', color: colors.text, flex: 1, paddingRight: 8 }}>{item.q}</Text>
                <Text style={{ fontSize: 12, color: colors.textMuted }}>{openFaq === i ? '▲' : '▾'}</Text>
              </View>
              {openFaq === i && <Text style={{ fontSize: 12, color: colors.textSub, marginTop: 8, lineHeight: 18 }}>{item.a}</Text>}
            </TouchableOpacity>
          ))}
          <Text style={[sharedStyles.fieldLabel, { marginTop: 16, color: colors.textSub }]}>Send Feedback</Text>
          <TouchableOpacity style={[sharedStyles.confirmBtn, { marginTop: 4 }]}
            onPress={() => Linking.openURL('mailto:support@gogood.app?subject=Go Good Feedback')}>
            <Text style={sharedStyles.confirmBtnText}>✉️ Email us →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={sharedStyles.cancelBtn} onPress={() => setShowHelp(false)}>
            <Text style={sharedStyles.cancelText}>close</Text>
          </TouchableOpacity>
          <View style={{ height: 20 }} />
        </ScrollView>
      </Sheet>

      {/* ── Rate Go Good modal ── */}
      <Sheet visible={showRate} onClose={() => setShowRate(false)} colors={colors}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <Text style={[sharedStyles.modalTitle, { color: colors.text }]}>Rate Go Good</Text>
          <TouchableOpacity onPress={() => setShowRate(false)}><Text style={{ fontSize: 18, color: '#aaa' }}>✕</Text></TouchableOpacity>
        </View>
        <Text style={{ fontSize: 13, color: colors.textSub, textAlign: 'center', marginBottom: 16 }}>Enjoying Go Good? Your rating helps us grow 🌱</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
          {[1, 2, 3, 4, 5].map(star => (
            <TouchableOpacity key={star} onPress={() => setRating(star)}>
              <Text style={{ fontSize: 36 }}>{star <= rating ? '⭐' : '☆'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {rating > 0 && (
          <>
            <TextInput style={[sharedStyles.input, { height: 80, textAlignVertical: 'top', backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.inputText }]}
              placeholder="Tell us what you think (optional)"
              placeholderTextColor={colors.placeholder}
              value={review} onChangeText={setReview} multiline />
            <TouchableOpacity style={[sharedStyles.confirmBtn, { marginTop: 12 }]} onPress={() => {
              if (rating === 5) Linking.openURL('https://apps.apple.com/app/id0000000000');
              setShowRate(false); setRating(0); setReview('');
            }}>
              <Text style={sharedStyles.confirmBtnText}>Submit →</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity style={sharedStyles.cancelBtn} onPress={() => setShowRate(false)}>
          <Text style={sharedStyles.cancelText}>maybe later</Text>
        </TouchableOpacity>
      </Sheet>
    </>
  );

  return { menuBtn, drawerEl, open, close };
}

// ─── Shared styles (used by SectionHeader and the hook's JSX) ─────────────────

const sharedStyles = StyleSheet.create({
  // Menu button
  menuBtn:      { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', gap: 5 },
  menuLine:     { width: 20, height: 2, borderRadius: 2 },

  // Drawer panel
  drawer:       { position: 'absolute', top: 0, left: 0, bottom: 0, width: 280, paddingTop: 60, paddingBottom: 20 },
  drawerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, paddingHorizontal: 24 },
  drawerLogo:   { fontSize: 26, fontWeight: '700', fontFamily: 'Fraunces_600SemiBold' },
  closeBtn:     { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  closeText:    { fontSize: 13 },

  // Profile preview
  profileRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 20, borderBottomWidth: 0.5, paddingHorizontal: 24 },
  avatar:       { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E1F5EE', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  profileName:  { fontSize: 15, fontWeight: '600', marginBottom: 2 },

  // Section header
  sectionHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 10, marginTop: 4 },
  sectionLabel:   { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2 },
  sectionArrow:   { fontSize: 18, fontWeight: '400' },

  // Items
  item:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 24, borderBottomWidth: 0.5, gap: 12 },
  itemIcon:     { fontSize: 18, width: 24, textAlign: 'center' },
  itemText:     { flex: 1, fontSize: 14, fontWeight: '500' },

  // Pro badge
  proBadge:     { backgroundColor: '#E1F5EE', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  proBadgeText: { fontSize: 9, color: '#085041', fontWeight: '600' },

  // Logout + version
  logoutBtn:    { marginHorizontal: 24, marginTop: 24, paddingVertical: 13, borderRadius: 12, backgroundColor: 'rgba(232,117,106,0.15)', alignItems: 'center' },
  logoutText:   { color: '#E8756A', fontWeight: '600', fontSize: 14 },
  version:      { fontSize: 10, textAlign: 'center', marginTop: 16 },

  // Modal shared
  modalTitle:   { fontSize: 20, fontWeight: '700', fontFamily: 'Fraunces_600SemiBold' },
  fieldLabel:   { fontSize: 11, fontWeight: '600', marginBottom: 6, marginTop: 14, textTransform: 'uppercase', letterSpacing: 0.5 },
  input:        { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, marginBottom: 4 },
  qtyBtn:       { width: 32, height: 32, borderRadius: 16, backgroundColor: '#085041', alignItems: 'center', justifyContent: 'center' },
  qtyBtnText:   { color: 'white', fontSize: 18, lineHeight: 22 },
  confirmBtn:   { backgroundColor: '#085041', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  confirmBtnText: { color: 'white', fontWeight: '700', fontSize: 15 },
  cancelBtn:    { alignItems: 'center', paddingVertical: 12 },
  cancelText:   { fontSize: 13, color: '#aaa' },
});
