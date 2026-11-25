import {
  View, Text, TouchableOpacity, Animated, StyleSheet, Alert, Image,
  Modal, TextInput, ScrollView, Switch, Platform, KeyboardAvoidingView,
  UIManager, Linking, Keyboard, Dimensions,
} from 'react-native';

// The side menu slides in and fills the whole screen width.
const DRAWER_WIDTH = Dimensions.get('window').width;
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
import { raised, raisedGreen } from '@/components/raised';
import Ionicons from '@expo/vector-icons/Ionicons';
import BottomSheet from '@/components/bottom-sheet';
import { DialogHost, showAlert } from '@/components/dialog';

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
  { q: 'How do I add items?', a: 'Tap the green + in the top right. Type the details, or use Barcode or Label to fill them in from the package. Receipt adds everything from a store receipt at once.' },
  { q: 'Can I add a lot of items at once?', a: 'Yes. Tap Label, then Several items, and take a photo of your fridge, a shelf, or groceries on the counter. GoGood finds each item so you can review them before adding.' },
  { q: 'What do the badge colors mean?', a: 'Green = 6+ days left. Amber = 1–5 days. Red = expires today. Blue = frozen. Expired items move to your Food Report automatically.' },
  { q: 'How do I mark something as used?', a: 'Tap an item to expand it, then tap Use a portion, or Remove and choose whether it went bad or you no longer have it.' },
  { q: 'How do I edit an item?', a: 'Tap the item to expand it, then tap Edit.' },
  { q: 'Can I share with family?', a: 'Yes. Open the Household tab to create a shared list or join one with an invite code. Everyone in the household sees and edits the same inventory.' },
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
      <DialogHost />
    </Modal>
  );
}

// ─── Menu building blocks ─────────────────────────────────────────────────────

function MenuGroup({ title, colors, isDark, children }: {
  title: string; colors: ThemeColors; isDark: boolean; children: React.ReactNode;
}) {
  return (
    <View style={sharedStyles.group}>
      <Text style={[sharedStyles.groupTitle, { color: colors.textMuted }]}>{title}</Text>
      <View style={[sharedStyles.groupCard, raised(isDark, 'md'), { backgroundColor: colors.surface }]}>{children}</View>
    </View>
  );
}

function MenuRow({ label, sub, right, onPress, first, colors, icon, danger }: {
  label: string; sub?: string; right?: React.ReactNode;
  onPress: () => void; first?: boolean; colors: ThemeColors;
  icon?: keyof typeof Ionicons.glyphMap; danger?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[sharedStyles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.6}
    >
      {icon ? (
        <View style={[sharedStyles.rowIcon, { backgroundColor: danger ? colors.goneBadBg : colors.chipBg }]}>
          <Ionicons name={icon} size={17} color={danger ? colors.goneBadText : colors.chipText} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[sharedStyles.rowText, { color: danger ? colors.goneBadText : colors.text }]}>{label}</Text>
        {sub ? <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      {right ?? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
    </TouchableOpacity>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAppDrawer() {
  const router = useRouter();
  const { signOut, deleteAccount, user } = useAuth();
  const { colors, isDark, toggleTheme } = useTheme();
  const { showPaywall, paywallDemoMode, setPaywallDemoMode, isPremium } = useSubscription();

  // ── Drawer animation state ──────────────────────────────────────────────────
  const [visible, setVisible]   = useState(false);
  const drawerAnim  = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const menuAnim    = useRef(new Animated.Value(0)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  // ── Section collapse state ──────────────────────────────────────────────────

  // ── Modal visibility ────────────────────────────────────────────────────────
  const [showProfile,       setShowProfile]       = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showHelp,          setShowHelp]          = useState(false);
  const [showRate,          setShowRate]          = useState(false);

  // ── Data state ──────────────────────────────────────────────────────────────
  const [profile,       setProfile]       = useState<Profile>(EMPTY_PROFILE);
  const [editProfile,   setEditProfile]   = useState<Profile>(EMPTY_PROFILE);
  const [stats,         setStats]         = useState<Stats>(EMPTY_STATS);
  const [itemCount,     setItemCount]     = useState(0);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  // Opt-out for combined, anonymous trend reports (profiles.insights_opt_out)
  const [shareInsights, setShareInsights] = useState(true);
  useEffect(() => {
    if (!user?.id) return;
    supabase.from('profiles').select('insights_opt_out').eq('id', user.id).maybeSingle()
      .then(({ data }) => { if (data) setShareInsights(!data.insights_opt_out); }, () => {});
  }, [user?.id]);
  const toggleInsights = (on: boolean) => {
    setShareInsights(on);
    if (user?.id) supabase.from('profiles').update({ insights_opt_out: !on }).eq('id', user.id).then(() => {}, () => {});
  };
  const [notifs,        setNotifs]        = useState<Notifs>(EMPTY_NOTIFS);
  const [editNotifs,    setEditNotifs]    = useState<Notifs>(EMPTY_NOTIFS);
  const [rating,        setRating]        = useState(0);
  const [review,        setReview]        = useState('');

  // Saves the stars and any written feedback, then (for happy users) shows Apple's
  // own rating pop-up. That pop-up needs a newer app build; older builds just say thanks.
  const submitRating = async () => {
    const stars = rating, message = review.trim();
    setShowRate(false); setRating(0); setReview('');
    supabase.from('app_feedback').insert({
      user_id: user?.id ?? null, rating: stars, message: message || null,
      app_version: Constants.expoConfig?.version ?? null, platform: Platform.OS,
    }).then(() => {}, () => {});
    if (stars >= 4) {
      try {
        const StoreReview = require('expo-store-review');
        if (await StoreReview.isAvailableAsync()) { await StoreReview.requestReview(); return; }
      } catch { /* this build doesn't include the rating pop-up yet */ }
    }
    setTimeout(() => showAlert('Thank you!', stars >= 4
      ? "We're so glad you're enjoying Go Good."
      : "Thanks for the feedback. We read every note and use it to make Go Good better."), 350);
  };
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
    const authEmail    = user?.email ?? '';
    const authName     = (user?.user_metadata?.full_name as string) ?? '';
    const authUsername = (user?.user_metadata?.username  as string) ?? '';

    // The account's saved profile lives in Supabase. Check it on every load so a
    // fresh login (or a new phone) gets the name, photo and preferences back,
    // even if a blank local profile was written during sign-in.
    let remote: Partial<Profile> = {};
    try {
      const uid = user?.id ?? (await supabase.auth.getUser()).data.user?.id;
      if (uid) {
        const { data, error } = await supabase
          .from('profiles')
          .select('display_name, username, photo_url, dietary_preferences, household_size')
          .eq('id', uid)
          .maybeSingle();
        if (!error && data) {
          if (data.display_name) remote.name     = data.display_name;
          if (data.username)     remote.username = data.username;
          // Older versions saved a temporary file path from one phone — skip those.
          if (data.photo_url && /^(data:|https?:)/.test(data.photo_url)) remote.photo = data.photo_url;
          if (Array.isArray(data.dietary_preferences) && data.dietary_preferences.length) remote.dietary = data.dietary_preferences as string[];
          if (typeof data.household_size === 'number') remote.household = data.household_size;
        }
      }
    } catch { /* offline — use what's on the phone */ }

    // Anything filled in on the phone wins; empty fields come from the account.
    const pick = <T,>(local: T | undefined, acct: T | undefined, empty: (v: T | undefined) => boolean) => (!empty(local) ? local : acct);
    const blank = (v: any) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    const p: Profile = {
      ...EMPTY_PROFILE,
      email:     authEmail || stored.email || '',
      name:      pick(stored.name, remote.name, blank) || authName,
      username:  pick(stored.username, remote.username, blank) || authUsername,
      photo:     pick(stored.photo, remote.photo, blank) ?? null,
      dietary:   pick(stored.dietary, remote.dietary, blank) ?? [],
      household: (stored.household && stored.household > 1 ? stored.household : remote.household) ?? stored.household ?? 1,
    };
    setProfile(p); setEditProfile(p);
    // Keep the phone's copy up to date so it loads instantly next time.
    await AsyncStorage.setItem('gogood_profile', JSON.stringify(p));
    if (statsVal)  setStats(JSON.parse(statsVal));
    if (notifsVal) { const n = { ...EMPTY_NOTIFS, ...JSON.parse(notifsVal) }; setNotifs(n); setEditNotifs(n); }
    setBiometricEnabled(bioVal === 'enabled');
    setItemCount(itemsVal ? JSON.parse(itemsVal).length : 0);
  };

  useEffect(() => { loadData(); }, []);

  // ── Drawer open/close ────────────────────────────────────────────────────────
  const open = () => {
    Keyboard.dismiss(); // close any open keyboard (e.g. GoodBot's input) before showing the menu
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
      Animated.timing(drawerAnim,  { toValue: -DRAWER_WIDTH, duration: 260, useNativeDriver: true }),
      Animated.timing(menuAnim,    { toValue: 0,    duration: 210, useNativeDriver: true }),
      Animated.timing(overlayAnim, { toValue: 0,    duration: 200, useNativeDriver: true }),
    ]).start(() => setVisible(false));
  };

  const openModal = (setter: (v: boolean) => void) => {
    close();
    setTimeout(() => setter(true), 400); // wait for the menu Modal to finish closing (iOS)
  };

  // ── Biometric ────────────────────────────────────────────────────────────────
  const toggleBiometric = async () => {
    if (biometricEnabled) {
      await SecureStore.deleteItemAsync('gogood_biometric');
      setBiometricEnabled(false);
    } else {
      const hasHw    = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHw || !enrolled) { showAlert('Not available', 'Face ID / Touch ID is not set up on this device.'); return; }
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
    showAlert('Log out', 'Are you sure you want to log out?', [
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

  // ── Delete account (App Store Guideline 5.1.1(v)) ────────────────────────────
  const [deleting, setDeleting] = useState(false);

  const runDeleteAccount = async () => {
    setDeleting(true);
    const { error } = await deleteAccount();
    setDeleting(false);
    if (error) { showAlert('Deletion failed', error); return; }
    await SecureStore.deleteItemAsync('gogood_biometric').catch(() => {});
    close();
    router.replace('/auth/welcome' as any);
    showAlert('Account deleted', 'Your Go Good account and data have been permanently deleted.');
  };

  const handleDeleteAccount = () => {
    showAlert(
      'Delete account?',
      'This permanently deletes your account, inventory, recipes, and collections. ' +
      'If you own a household, ownership passes to another member.\n\n' +
      'Deleting your account does not cancel an App Store subscription — manage that in Settings → Apple ID → Subscriptions.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue', style: 'destructive', onPress: () =>
            showAlert('Are you absolutely sure?', 'This cannot be undone.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete forever', style: 'destructive', onPress: runDeleteAccount },
            ]),
        },
      ],
    );
  };

  // ── Profile ──────────────────────────────────────────────────────────────────
  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      allowsEditing: true, aspect: [1, 1], quality: 0.2,
      base64: true,
    });
    if (result.canceled) return;
    // Save the image itself (not a path to a temporary file on this phone), so the
    // photo survives sign-out and shows up again on any device after signing in.
    const asset = result.assets[0];
    const photo = asset.base64 ? `data:${asset.mimeType ?? 'image/jpeg'};base64,${asset.base64}` : asset.uri;
    setEditProfile(p => ({ ...p, photo }));
  };

  const saveProfile = async () => {
    if (!editProfile.name.trim()) {
      showAlert('Name required', 'Please enter your name before saving.');
      return;
    }
    const cleaned: Profile = {
      ...editProfile,
      name:     editProfile.name.trim(),
      username: editProfile.username.trim(),
    };
    await AsyncStorage.setItem('gogood_profile', JSON.stringify(cleaned));
    setProfile(cleaned);
    setEditProfile(cleaned);
    // Persist every field to Supabase so the profile survives logout and is
    // restored on the next login (upsert in case the row doesn't exist yet).
    const uid = user?.id ?? (await supabase.auth.getUser()).data.user?.id;
    if (uid) {
      const { error } = await supabase.from('profiles').upsert({
        id:                  uid,
        display_name:        cleaned.name,
        username:            cleaned.username || null,
        photo_url:           cleaned.photo,
        dietary_preferences: cleaned.dietary,
        household_size:      cleaned.household,
        updated_at:          new Date().toISOString(),
      }, { onConflict: 'id' });
      if (error) console.warn('[profile] Supabase sync failed:', error.message);
    }
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
      {/* Rendered in a Modal so the overlay covers the bottom tab bar too */}
      <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={close}>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close}>
            <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)', opacity: overlayAnim }]} />
          </TouchableOpacity>

          <Animated.View style={[sharedStyles.drawer, { width: DRAWER_WIDTH, backgroundColor: colors.drawerBg, transform: [{ translateX: drawerAnim }] }]}>
            <ScrollView showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ paddingBottom: 40 }}>

              {/* Header */}
              <View style={sharedStyles.drawerHeader}>
                <Text style={[sharedStyles.drawerLogo, { color: colors.brand }]}>go<Text style={{ color: colors.teal, fontFamily: 'Fraunces_600SemiBold' }}>good</Text></Text>
                <TouchableOpacity onPress={close} style={[sharedStyles.closeBtn, raised(isDark), { backgroundColor: colors.surface }]} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={18} color={colors.textSub} />
                </TouchableOpacity>
              </View>

              {/* Profile card */}
              <TouchableOpacity
                style={[sharedStyles.profileCard, raised(isDark, 'md'), { backgroundColor: colors.surface }]}
                onPress={() => openModal(setShowProfile)}
                activeOpacity={0.8}
              >
                <View style={[sharedStyles.avatar, { backgroundColor: colors.chipBg }]}>
                  {profile.photo
                    ? <Image source={{ uri: profile.photo }} style={{ width: 52, height: 52, borderRadius: 26 }} />
                    : <Text style={{ fontSize: 21, fontWeight: '700', color: colors.chipText }}>{profile.name ? profile.name[0].toUpperCase() : '?'}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[sharedStyles.profileName, { color: colors.text, flexShrink: 1 }]} numberOfLines={1}>
                      {profile.name || 'Set up your profile'}
                    </Text>
                    {isPremium && (
                      <View style={{ backgroundColor: colors.chipBg, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: colors.chipText }}>PRO</Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ fontSize: 13, color: colors.textSub }} numberOfLines={1}>
                    {profile.username ? `@${profile.username.replace(/^@/, '')}` : profile.email || 'Edit profile'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>

              {/* Upgrade (free plan only) */}
              {!isPremium && (
                <TouchableOpacity
                  style={[sharedStyles.proCard, { backgroundColor: colors.btnPrimary }, raisedGreen(isDark)]}
                  onPress={() => { close(); setTimeout(showPaywall, 400); }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="sparkles" size={20} color="white" />
                  <View style={{ flex: 1 }}>
                    <Text style={sharedStyles.proTitle}>Upgrade to Go Good Pro</Text>
                    <Text style={sharedStyles.proSub}>Good Bot, Food Reports, receipt scans and more</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.8)" />
                </TouchableOpacity>
              )}

              {/* Settings */}
              <MenuGroup title="Settings" colors={colors} isDark={isDark}>
                <MenuRow first icon="notifications-outline" label="Notifications" sub={notifs.expiry ? 'Expiry alerts on' : 'Expiry alerts off'} colors={colors}
                  onPress={() => openModal(setShowNotifications)} />
                <MenuRow icon="scan-outline" label="Face ID" sub="Unlock the app with your face" colors={colors} onPress={toggleBiometric}
                  right={<Switch value={biometricEnabled} onValueChange={toggleBiometric} trackColor={{ false: '#ddd', true: '#1D9E75' }} thumbColor="white" />} />
                <MenuRow icon="moon-outline" label="Dark mode" colors={colors} onPress={toggleTheme}
                  right={<Switch value={isDark} onValueChange={toggleTheme} trackColor={{ false: '#ddd', true: '#1D9E75' }} thumbColor="white" />} />
                <MenuRow icon="analytics-outline" label="Anonymous food trends" sub="Include my activity in combined, anonymous reports" colors={colors}
                  onPress={() => toggleInsights(!shareInsights)}
                  right={<Switch value={shareInsights} onValueChange={toggleInsights} trackColor={{ false: '#ddd', true: '#1D9E75' }} thumbColor="white" />} />
              </MenuGroup>

              {/* Sharing */}
              <MenuGroup title="Sharing" colors={colors} isDark={isDark}>
                <MenuRow first icon="home-outline" label="Household" sub="Share your kitchen with family" colors={colors}
                  onPress={() => { close(); router.navigate('/(tabs)/household' as any); }} />
                <MenuRow icon="storefront-outline" label="Store accounts" sub="Bring in purchases from Kroger" colors={colors}
                  onPress={() => { close(); setTimeout(() => router.push('/store-connections' as any), 300); }} />
              </MenuGroup>

              {/* Account */}
              <MenuGroup title="Account" colors={colors} isDark={isDark}>
                <MenuRow first icon="card-outline" label="Subscription" sub={isPremium ? 'Go Good Pro' : 'Free plan'} colors={colors}
                  onPress={() => { close(); setTimeout(showPaywall, 400); }} />
                <MenuRow icon="help-circle-outline" label="Help & feedback" colors={colors} onPress={() => openModal(setShowHelp)} />
                <MenuRow icon="star-outline" label="Rate Go Good" colors={colors} onPress={() => openModal(setShowRate)} />
              </MenuGroup>

              {/* Testing tools — only in development builds, never in the App Store version */}
              {__DEV__ && (
                <MenuGroup title="Developer" colors={colors} isDark={isDark}>
                  <MenuRow first icon="construct-outline" label="Paywall demo mode" sub="Show the paywall on locked features" colors={colors}
                    onPress={() => setPaywallDemoMode(!paywallDemoMode)}
                    right={<Switch value={paywallDemoMode} onValueChange={setPaywallDemoMode} trackColor={{ false: '#ddd', true: '#1D9E75' }} thumbColor="white" />} />
                </MenuGroup>
              )}

              {/* Log out */}
              <TouchableOpacity style={[sharedStyles.logoutBtn, raised(isDark, 'md'), { backgroundColor: colors.surface }]} onPress={handleLogout} activeOpacity={0.8}>
                <Text style={sharedStyles.logoutText}>Log out</Text>
              </TouchableOpacity>
              <TouchableOpacity style={sharedStyles.deleteBtn} onPress={handleDeleteAccount} disabled={deleting}>
                <Text style={[sharedStyles.deleteText, { color: colors.textMuted }]}>
                  {deleting ? 'Deleting account…' : 'Delete account'}
                </Text>
              </TouchableOpacity>
              <Text style={[sharedStyles.version, { color: colors.textMuted }]}>Go Good v{Constants.expoConfig?.version ?? '1.0'} · made in NC</Text>

            </ScrollView>
          </Animated.View>
        </View>
        <DialogHost />
      </Modal>

      {/* ── Edit profile ── */}
      <BottomSheet visible={showProfile} onClose={() => setShowProfile(false)}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" bounces={false} style={{ flexGrow: 0 }}>
          <Text style={[sharedStyles.sheetTitle, { color: colors.text }]}>Edit profile</Text>

          {/* Photo */}
          <View style={{ alignItems: 'center', marginBottom: 18 }}>
            <TouchableOpacity onPress={pickPhoto} activeOpacity={0.85} accessibilityLabel="Change photo">
              <View style={[{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.chipBg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, raised(isDark, 'md')]}>
                {editProfile.photo
                  ? <Image source={{ uri: editProfile.photo }} style={{ width: 96, height: 96 }} />
                  : <Text style={{ fontSize: 36, fontWeight: '700', color: colors.chipText }}>{editProfile.name ? editProfile.name[0].toUpperCase() : '?'}</Text>}
              </View>
              <View style={[sharedStyles.cameraBadge, { backgroundColor: colors.btnPrimary, borderColor: colors.bg }]}>
                <Ionicons name="camera" size={14} color="white" />
              </View>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 18, marginTop: 10 }}>
              <TouchableOpacity onPress={pickPhoto} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[sharedStyles.link, { color: isDark ? colors.tealLight : colors.brand }]}>{editProfile.photo ? 'Change photo' : 'Add photo'}</Text>
              </TouchableOpacity>
              {editProfile.photo ? (
                <TouchableOpacity onPress={() => setEditProfile(p => ({ ...p, photo: null }))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={[sharedStyles.link, { color: colors.textSub }]}>Remove</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {/* Stats */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
            {[
              { val: itemCount,      label: 'In storage', color: colors.text },
              { val: stats.goneGood, label: 'Gone good',  color: '#23B385' },
              { val: stats.goneBad,  label: 'Gone bad',   color: '#D0644F' },
            ].map(s => (
              <View key={s.label} style={[sharedStyles.statCard, { backgroundColor: colors.surface }, raised(isDark)]}>
                <Text style={{ fontSize: 20, fontWeight: '700', color: s.color }}>{s.val}</Text>
                <Text style={{ fontSize: 12, color: colors.textSub, marginTop: 2 }}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* Fields */}
          <Text style={[sharedStyles.fieldLabel, { color: colors.textSub }]}>Name</Text>
          <TextInput style={[sharedStyles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.inputText }]}
            placeholder="Your name" placeholderTextColor={colors.placeholder} keyboardAppearance={isDark ? 'dark' : 'light'}
            value={editProfile.name} onChangeText={v => setEditProfile(p => ({ ...p, name: v }))}
            textContentType="name" autoComplete="name" />

          <Text style={[sharedStyles.fieldLabel, { color: colors.textSub }]}>Username</Text>
          <TextInput style={[sharedStyles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.inputText }]}
            placeholder="@username" placeholderTextColor={colors.placeholder} keyboardAppearance={isDark ? 'dark' : 'light'}
            value={editProfile.username} onChangeText={v => setEditProfile(p => ({ ...p, username: v }))}
            autoCapitalize="none" autoCorrect={false} />

          <Text style={[sharedStyles.fieldLabel, { color: colors.textSub }]}>Email</Text>
          <View style={[sharedStyles.input, { backgroundColor: colors.surfaceAlt, borderColor: 'transparent', flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
            <Text style={{ flex: 1, fontSize: 15, color: colors.textSub }} numberOfLines={1}>{editProfile.email || 'No email'}</Text>
            <Ionicons name="lock-closed-outline" size={15} color={colors.textMuted} />
          </View>
          <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>This is the email you sign in with.</Text>

          <Text style={[sharedStyles.fieldLabel, { color: colors.textSub }]}>Household size</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TouchableOpacity
              style={[sharedStyles.stepBtn, { backgroundColor: colors.surface, opacity: editProfile.household <= 1 ? 0.4 : 1 }, raised(isDark)]}
              disabled={editProfile.household <= 1}
              onPress={() => setEditProfile(p => ({ ...p, household: Math.max(1, p.household - 1) }))}>
              <Ionicons name="remove" size={20} color={colors.text} />
            </TouchableOpacity>
            <View style={[sharedStyles.input, { flex: 1, alignItems: 'center', marginBottom: 0, backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.inputText }}>{editProfile.household} {editProfile.household === 1 ? 'person' : 'people'}</Text>
            </View>
            <TouchableOpacity
              style={[sharedStyles.stepBtn, { backgroundColor: colors.surface, opacity: editProfile.household >= 10 ? 0.4 : 1 }, raised(isDark)]}
              disabled={editProfile.household >= 10}
              onPress={() => setEditProfile(p => ({ ...p, household: Math.min(10, p.household + 1) }))}>
              <Ionicons name="add" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 6 }}>Good Bot sizes recipes for this many people.</Text>

          <Text style={[sharedStyles.fieldLabel, { color: colors.textSub }]}>Dietary preferences</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {DIETARY_OPTIONS.map(pref => {
              const on = editProfile.dietary.includes(pref);
              return (
                <TouchableOpacity key={pref}
                  onPress={() => setEditProfile(p => ({ ...p, dietary: on ? p.dietary.filter(d => d !== pref) : [...p.dietary, pref] }))}
                  style={[sharedStyles.chip, { backgroundColor: on ? colors.btnPrimary : colors.surface }, raised(isDark)]}
                  activeOpacity={0.8}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: on ? 'white' : colors.text }}>{pref}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity style={[sharedStyles.confirmBtn, { marginTop: 24, backgroundColor: colors.btnPrimary }, raisedGreen(isDark)]} onPress={saveProfile} activeOpacity={0.85}>
            <Text style={sharedStyles.confirmBtnText}>Save profile</Text>
          </TouchableOpacity>
        </ScrollView>
      </BottomSheet>

      {/* ── Notifications modal ── */}
      <Sheet visible={showNotifications} onClose={() => setShowNotifications(false)} colors={colors}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <Text style={[sharedStyles.modalTitle, { color: colors.text }]}>Notifications</Text>
          <TouchableOpacity onPress={() => setShowNotifications(false)}><Text style={{ fontSize: 18, color: '#aaa' }}>✕</Text></TouchableOpacity>
        </View>
        {([
          { key: 'expiry', title: 'Expiry alerts',  sub: 'Get notified 3 days before items expire' },
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
          <Text style={sharedStyles.confirmBtnText}>Save</Text>
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
            <Text style={sharedStyles.confirmBtnText}>Email us</Text>
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
        <Text style={{ fontSize: 13, color: colors.textSub, textAlign: 'center', marginBottom: 16 }}>Enjoying Go Good? Your rating helps us grow.</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
          {[1, 2, 3, 4, 5].map(star => (
            <TouchableOpacity key={star} onPress={() => setRating(star)}>
              <Text style={{ fontSize: 38, color: star <= rating ? '#F2B01E' : colors.textMuted }}>{star <= rating ? '\u2605' : '\u2606'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {rating > 0 && (
          <>
            <TextInput style={[sharedStyles.input, { height: 80, textAlignVertical: 'top', backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.inputText }]}
              placeholder="Tell us what you think (optional)"
              placeholderTextColor={colors.placeholder}
              value={review} onChangeText={setReview} multiline />
            <TouchableOpacity style={[sharedStyles.confirmBtn, { marginTop: 12 }]} onPress={submitRating}>
              <Text style={sharedStyles.confirmBtnText}>Submit</Text>
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

// ─── Shared styles (used by the menu building blocks and the hook's JSX) ─────────────────

const sharedStyles = StyleSheet.create({
  // Menu button
  menuBtn:      { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', gap: 5 },
  menuLine:     { width: 20, height: 2, borderRadius: 2 },

  // Drawer panel
  drawer:       { position: 'absolute', top: 0, left: 0, bottom: 0, width: 280, paddingTop: 60, paddingBottom: 20 },
  drawerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingHorizontal: 24 },
  drawerLogo:   { fontSize: 26, fontWeight: '700', fontFamily: 'Fraunces_600SemiBold' },
  closeBtn:     { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  closeText:    { fontSize: 13 },

  // Profile card
  profileCard:  { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 20, marginBottom: 8, padding: 14, borderRadius: 18 },
  avatar:       { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  profileName:  { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  chevron:      { fontSize: 20, fontWeight: '400', marginLeft: 4 },

  // Groups
  group:        { marginTop: 18, paddingHorizontal: 20 },
  groupTitle:   { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.1, marginBottom: 8, marginLeft: 6 },
  groupCard:    { borderRadius: 16 },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingVertical: 10, paddingHorizontal: 14 },
  rowIcon:      { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  proCard:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 20, marginTop: 14, padding: 16, borderRadius: 18 },
  proTitle:     { color: 'white', fontSize: 15, fontWeight: '700' },
  proSub:       { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 },
  sheetTitle:   { fontSize: 20, fontWeight: '700', fontFamily: 'Fraunces_600SemiBold', marginBottom: 16 },
  cameraBadge:  { position: 'absolute', bottom: 0, right: 0, width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  link:         { fontSize: 14, fontWeight: '600' },
  statCard:     { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 14 },
  stepBtn:      { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  chip:         { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  rowText:      { fontSize: 15, fontWeight: '500' },

  // Logout + version
  logoutBtn:    { marginHorizontal: 20, marginTop: 28, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  logoutText:   { color: '#D9534F', fontWeight: '700', fontSize: 15 },
  deleteBtn:    { alignSelf: 'center', marginTop: 12, paddingVertical: 6, paddingHorizontal: 12 },
  deleteText:   { fontSize: 12, textDecorationLine: 'underline' },
  version:      { fontSize: 10, textAlign: 'center', marginTop: 16 },

  // Modal shared
  modalTitle:   { fontSize: 20, fontWeight: '700', fontFamily: 'Fraunces_600SemiBold' },
  fieldLabel:   { fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 16 },
  input:        { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 4 },
  qtyBtn:       { width: 32, height: 32, borderRadius: 16, backgroundColor: '#085041', alignItems: 'center', justifyContent: 'center' },
  qtyBtnText:   { color: 'white', fontSize: 18, lineHeight: 22 },
  confirmBtn:   { backgroundColor: '#085041', borderRadius: 14, paddingVertical: 14, alignItems: 'center', ...raisedGreen(false) },
  confirmBtnText: { color: 'white', fontWeight: '700', fontSize: 15 },
  cancelBtn:    { alignItems: 'center', paddingVertical: 12 },
  cancelText:   { fontSize: 13, color: '#aaa' },
});
