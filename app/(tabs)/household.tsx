import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Modal, Animated, Easing,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useState, useCallback, useRef, useEffect } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '../context/theme';
import { useAuth } from '../context/auth';
import { useAppDrawer } from '../components/AppDrawer';
import { useSubscription } from '../context/subscription';
import {
  getMyHousehold, createHousehold, renameHousehold,
  getHouseholdMembers, getHouseholdInvites, getPendingInvitesForEmail,
  inviteMember, acceptInviteByToken, acceptPendingInvite,
  removeMember, leaveHousehold, deleteHousehold, cancelInvite,
  transferOwnership, isValidEmail, MAX_HOUSEHOLD_MEMBERS,
  HOUSEHOLD_JOINED_AT_KEY,
  type Household, type HouseholdMember, type HouseholdInvite,
} from '../lib/household';

function timeAgo(iso: string): string {
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d}d ago`;
}

function initials(email: string): string {
  return email ? email[0].toUpperCase() : '?';
}

// ── Animated press button ──────────────────────────────────────────────────────

function ScaleBtn({ style, onPress, disabled, children }: {
  style?: any; onPress: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn  = () => Animated.spring(scale, { toValue: 0.95, damping: 18, stiffness: 400, useNativeDriver: true }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1,    damping: 14, stiffness: 250, useNativeDriver: true }).start();
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity style={style} onPress={onPress} onPressIn={pressIn} onPressOut={pressOut} disabled={disabled} activeOpacity={1}>
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Slide-up sheet ─────────────────────────────────────────────────────────────

function SlideSheet({ visible, onClose, children, colors }: {
  visible: boolean; onClose: () => void; children: React.ReactNode; colors: any;
}) {
  const slideAnim = useRef(new Animated.Value(600)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      slideAnim.setValue(600); fadeAnim.setValue(0);
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, damping: 36, stiffness: 130, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 0, duration: 240, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 600, duration: 260, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [visible]);

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)', opacity: fadeAnim }]} />
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />
          <Animated.View style={{
            backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            padding: 20, paddingBottom: 40, maxHeight: '90%',
            transform: [{ translateY: slideAnim }],
          }}>
            <View style={{ width: 36, height: 4, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 999, alignSelf: 'center', marginBottom: 16 }} />
            {children}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Lava lamp hero card ────────────────────────────────────────────────────────

function LavaLampHeroCard({ colors, isDark, children }: {
  colors: any; isDark: boolean; children: React.ReactNode;
}) {
  const b1x = useRef(new Animated.Value(0)).current;
  const b1y = useRef(new Animated.Value(0)).current;
  const b1s = useRef(new Animated.Value(1)).current;
  const b2x = useRef(new Animated.Value(0)).current;
  const b2y = useRef(new Animated.Value(0)).current;
  const b2s = useRef(new Animated.Value(1)).current;
  const b3x = useRef(new Animated.Value(0)).current;
  const b3y = useRef(new Animated.Value(0)).current;
  const b4x = useRef(new Animated.Value(0)).current;
  const b4y = useRef(new Animated.Value(0)).current;
  const b4s = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const ease = Easing.inOut(Easing.sin);
    const loop = (val: Animated.Value, steps: { to: number; dur: number }[]) =>
      Animated.loop(Animated.sequence(
        steps.map(s => Animated.timing(val, { toValue: s.to, duration: s.dur, easing: ease, useNativeDriver: true }))
      ));

    const loops = [
      loop(b1x, [{ to: -20, dur: 3200 }, { to: 12, dur: 2800 }, { to: -8, dur: 3600 }, { to: 0, dur: 2400 }]),
      loop(b1y, [{ to: 18, dur: 2600 },  { to: -14, dur: 3400 }, { to: 8, dur: 2800 },  { to: 0, dur: 3000 }]),
      loop(b1s, [{ to: 1.12, dur: 3800 }, { to: 0.92, dur: 3200 }, { to: 1.06, dur: 2800 }, { to: 1, dur: 3400 }]),
      loop(b2x, [{ to: 22, dur: 4000 },  { to: -15, dur: 3000 }, { to: 10, dur: 3600 },  { to: 0, dur: 2600 }]),
      loop(b2y, [{ to: -20, dur: 3200 }, { to: 16, dur: 4200 },  { to: -8, dur: 2600 },  { to: 0, dur: 3400 }]),
      loop(b2s, [{ to: 0.88, dur: 4200 }, { to: 1.14, dur: 3600 }, { to: 0.96, dur: 3000 }, { to: 1, dur: 2800 }]),
      loop(b3x, [{ to: 14, dur: 2800 },  { to: -18, dur: 3600 }, { to: 6, dur: 3200 },   { to: 0, dur: 3000 }]),
      loop(b3y, [{ to: 16, dur: 3600 },  { to: -10, dur: 2800 }, { to: 14, dur: 3400 },  { to: 0, dur: 2600 }]),
      loop(b4x, [{ to: -18, dur: 3600 }, { to: 14, dur: 2800 },  { to: -6, dur: 4000 },  { to: 0, dur: 3200 }]),
      loop(b4y, [{ to: 22, dur: 4200 },  { to: -16, dur: 3000 }, { to: 10, dur: 3800 },  { to: 0, dur: 2600 }]),
      loop(b4s, [{ to: 1.08, dur: 3000 }, { to: 0.9, dur: 3800 }, { to: 1.04, dur: 2600 }, { to: 1, dur: 4000 }]),
    ];
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, []);

  return (
    <View style={[styles.heroCard, { backgroundColor: colors.btnPrimary, shadowColor: isDark ? '#5DCAA5' : '#085041', shadowOpacity: isDark ? 0.28 : 0.55 }]}>
      <Animated.View style={[styles.blob1, { transform: [{ translateX: b1x }, { translateY: b1y }, { scale: b1s }] }]} />
      <Animated.View style={[styles.blob2, { transform: [{ translateX: b2x }, { translateY: b2y }, { scale: b2s }] }]} />
      <Animated.View style={[styles.blob3, { transform: [{ translateX: b3x }, { translateY: b3y }] }]} />
      <Animated.View style={[styles.blob4, { transform: [{ translateX: b4x }, { translateY: b4y }, { scale: b4s }] }]} />
      {children}
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function HouseholdScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { menuBtn, drawerEl } = useAppDrawer();
  const { isPremium, showPaywall } = useSubscription();
  const router = useRouter();

  const screenFade      = useRef(new Animated.Value(0)).current;
  const screenSlide     = useRef(new Animated.Value(24)).current;
  const heroScale       = useRef(new Animated.Value(0.94)).current;
  const cardsOpacity    = useRef(new Animated.Value(0)).current;
  const cardsTranslateY = useRef(new Animated.Value(20)).current;

  const [loading, setLoading]       = useState(true);
  const [household, setHousehold]   = useState<Household | null>(null);
  const [members, setMembers]       = useState<HouseholdMember[]>([]);
  const [invites, setInvites]       = useState<HouseholdInvite[]>([]);
  const [pendingForMe, setPendingForMe] = useState<HouseholdInvite[]>([]);

  // Create form
  const [createName, setCreateName] = useState('');
  const [creating, setCreating]     = useState(false);

  // Invite by email
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting]       = useState(false);
  const [sentToken, setSentToken]     = useState<string | null>(null);

  // Join by code
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining]   = useState(false);

  // Edit household sheet (rename + leave/delete)
  const [editVisible, setEditVisible] = useState(false);
  const [renameName, setRenameName]   = useState('');

  // Nudge state for free joiners
  const [joinedAt, setJoinedAt]           = useState<string | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  const userEmail = (user as any)?.email ?? '';
  const isOwner   = household?.ownerId === user?.id;

  const joinedDays = joinedAt ? Math.floor((Date.now() - new Date(joinedAt).getTime()) / 86400000) : 0;
  const showNudge  = household && !isOwner && !isPremium && joinedDays >= 3 && !nudgeDismissed;

  const load = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    setLoading(true);
    try {
      const [hh, jat, nd] = await Promise.all([
        getMyHousehold(user.id),
        AsyncStorage.getItem(HOUSEHOLD_JOINED_AT_KEY),
        AsyncStorage.getItem('gogood_household_nudge_dismissed'),
      ]);
      setJoinedAt(jat);
      setNudgeDismissed(!!nd);
      setHousehold(hh);
      if (hh) {
        const [mems, invs] = await Promise.all([
          getHouseholdMembers(hh.id),
          getHouseholdInvites(hh.id),
        ]);
        setMembers(mems);
        setInvites(invs);
      } else if (userEmail) {
        const pending = await getPendingInvitesForEmail(userEmail);
        setPendingForMe(pending);
      }
    } catch {}
    setLoading(false);
  }, [user?.id, userEmail]);

  // screenFade is NOT reset on refocus — it starts at 0 from useRef (first-open fade only).
  // Resetting it to 0 on every focus causes white screen if JS is briefly busy.
  useFocusEffect(useCallback(() => {
    screenSlide.setValue(24);
    heroScale.setValue(0.94); cardsOpacity.setValue(0); cardsTranslateY.setValue(20);
    Animated.parallel([
      Animated.timing(screenFade,  { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.spring(screenSlide, { toValue: 0, damping: 24, stiffness: 200, useNativeDriver: true }),
      Animated.spring(heroScale,   { toValue: 1, damping: 16, stiffness: 200, useNativeDriver: true }),
    ]).start();
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(cardsOpacity,    { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(cardsTranslateY, { toValue: 0, damping: 22, stiffness: 180, useNativeDriver: true }),
      ]).start();
    }, 100);
    load();
    return () => { clearTimeout(t); setSentToken(null); };
  }, [load]));

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!isPremium) { showPaywall(); return; }
    if (!user?.id) return;
    setCreating(true);
    const { household: hh, error: hhErr } = await createHousehold(user.id, userEmail, createName);
    setCreating(false);
    if (!hh) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); Alert.alert('Could not create household', hhErr ?? 'Please try again.'); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setHousehold(hh);
    setMembers([{ userId: user.id, email: userEmail, role: 'owner', joinedAt: new Date().toISOString() }]);
    setInvites([]);
    setCreateName('');
  };

  const handleInvite = async () => {
    if (!household || !user?.id || !inviteEmail.trim()) return;
    if (!isValidEmail(inviteEmail)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }
    setInviting(true);
    const { token, error: invErr } = await inviteMember(household.id, user.id, inviteEmail.trim());
    setInviting(false);
    if (!token) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); Alert.alert('Could not send invite', invErr ?? 'Please try again.'); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSentToken(token);
    setInviteEmail('');
    const invs = await getHouseholdInvites(household.id);
    setInvites(invs);
  };

  const handleCopyToken = (token: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Clipboard.setStringAsync(token);
    Alert.alert('Code copied!', 'Share this invite code with your household member. They enter it on their Household tab to join.');
  };

  const handleCancelInvite = (invite: HouseholdInvite) => {
    Alert.alert('Cancel invite', `Cancel invite to ${invite.invitedEmail}?`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Cancel invite', style: 'destructive', onPress: async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await cancelInvite(invite.id);
        setInvites(prev => prev.filter(i => i.id !== invite.id));
      }},
    ]);
  };

  const handleJoin = async () => {
    if (!user?.id || !joinCode.trim()) return;
    setJoining(true);
    const result = await acceptInviteByToken(joinCode.trim(), user.id, userEmail);
    setJoining(false);
    if (!result.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Invalid code', 'This invite code is not valid or has already been used.');
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setJoinCode('');
    await load();
  };

  const handleAcceptPending = async (invite: HouseholdInvite) => {
    if (!user?.id) return;
    const ok = await acceptPendingInvite(invite, user.id, userEmail);
    if (!ok) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); Alert.alert('Could not join', 'Please try again.'); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPendingForMe([]);
    await load();
  };

  const handleRemoveMember = (member: HouseholdMember) => {
    if (!household) return;
    Alert.alert('Remove member', `Remove ${member.email} from the household?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await removeMember(household.id, member.userId);
        setMembers(prev => prev.filter(m => m.userId !== member.userId));
      }},
    ]);
  };

  const handleLeave = () => {
    if (!household) return;
    Alert.alert('Leave household', "You'll no longer have access to the shared inventory, recipes, or shopping list. Your personal data is unaffected.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        await leaveHousehold(household.id, user!.id);
        setHousehold(null); setMembers([]); setInvites([]);
        await load();
      }},
    ]);
  };

  const handleDelete = () => {
    if (!household) return;
    Alert.alert('Delete household', 'This will remove all members and permanently delete the shared inventory, recipes, and shopping list. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete everything', style: 'destructive', onPress: async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        await deleteHousehold(household.id);
        setHousehold(null); setMembers([]); setInvites([]);
        await load();
      }},
    ]);
  };

  const dismissNudge = () => {
    AsyncStorage.setItem('gogood_household_nudge_dismissed', '1');
    setNudgeDismissed(true);
  };

  const handleRename = async () => {
    if (!household || !renameName.trim()) return;
    await renameHousehold(household.id, renameName.trim());
    setHousehold(prev => prev ? { ...prev, name: renameName.trim() } : prev);
    setEditVisible(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={colors.statusBar} backgroundColor={colors.bg} />
      <Animated.View style={{ flex: 1, opacity: screenFade, transform: [{ translateY: screenSlide }] }}>

      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.bg, borderBottomColor: colors.border, paddingTop: insets.top + 12 }]}>
        {menuBtn}
        <Text style={[styles.logo, { color: colors.brand }]}>
          house<Text style={{ color: colors.teal }}>hold</Text>
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.teal} />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
        >

          {household ? (
            /* ── Already in a household ── */
            <>
              {/* Household header card */}
              <Animated.View style={{ transform: [{ scale: heroScale }] }}>
              <LavaLampHeroCard colors={colors} isDark={isDark}>
                <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>YOUR HOUSEHOLD</Text>
                <Text style={{ fontSize: 28, fontWeight: '700', color: 'white', marginBottom: 4 }}>{household.name}</Text>
                <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
                  {members.length} member{members.length !== 1 ? 's' : ''} · inventory · recipes · shopping
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
                  <TouchableOpacity
                    style={{ backgroundColor: 'rgba(93,202,165,0.2)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
                    onPress={() => router.push('/(tabs)/' as any)}
                  >
                    <Text style={{ fontSize: 12, color: '#5DCAA5', fontWeight: '600' }}>🥗 inventory</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ backgroundColor: 'rgba(93,202,165,0.2)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
                    onPress={() => router.push('/(tabs)/collections' as any)}
                  >
                    <Text style={{ fontSize: 12, color: '#5DCAA5', fontWeight: '600' }}>📚 recipes</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ backgroundColor: 'rgba(93,202,165,0.2)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
                    onPress={() => router.push('/(tabs)/shopping' as any)}
                  >
                    <Text style={{ fontSize: 12, color: '#5DCAA5', fontWeight: '600' }}>🛒 shopping</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
                    onPress={() => { setRenameName(household.name); setEditVisible(true); }}
                  >
                    <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', fontWeight: '600' }}>⚙️ edit</Text>
                  </TouchableOpacity>
                </View>
              </LavaLampHeroCard>
              </Animated.View>

              <Animated.View style={{ gap: 12, opacity: cardsOpacity, transform: [{ translateY: cardsTranslateY }] }}>
              {/* Members */}
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 12 }]}>Members</Text>
                {members.map((m, i) => (
                  <View key={m.userId} style={{
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                    paddingVertical: 10,
                    borderBottomWidth: i < members.length - 1 ? 0.5 : 0, borderBottomColor: colors.border,
                  }}>
                    <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: m.role === 'owner' ? colors.btnPrimary : colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 16, fontWeight: '700', color: m.role === 'owner' ? 'white' : colors.textSub }}>
                        {initials(m.email)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: '500', color: colors.text }}>
                        {m.email}{m.userId === user?.id ? ' (you)' : ''}
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>
                        {m.role === 'owner' ? 'owner · ' : ''}{timeAgo(m.joinedAt)}
                      </Text>
                    </View>
                    {isOwner && m.userId !== user?.id && (
                      <TouchableOpacity onPress={() => handleRemoveMember(m)} style={{ padding: 4 }}>
                        <Text style={{ fontSize: 16 }}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>

              {/* Invite by email (any member can invite) */}
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 4 }]}>Invite someone</Text>
                <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: 12 }}>
                  Enter their email — they'll get an invite code to paste in their Household tab.
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    style={[styles.input, { flex: 1, color: colors.inputText, backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}
                    value={inviteEmail}
                    onChangeText={setInviteEmail}
                    placeholder="email@example.com"
                    placeholderTextColor={colors.placeholder}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    returnKeyType="send"
                    onSubmitEditing={handleInvite}
                  />
                  <ScaleBtn
                    style={[styles.btn, { backgroundColor: colors.btnPrimary, opacity: inviting || !inviteEmail.trim() ? 0.5 : 1 }]}
                    onPress={handleInvite}
                    disabled={inviting || !inviteEmail.trim()}
                  >
                    {inviting ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.btnText}>invite</Text>}
                  </ScaleBtn>
                </View>
                {sentToken && (
                  <TouchableOpacity
                    onPress={() => handleCopyToken(sentToken)}
                    style={{ marginTop: 12, backgroundColor: 'rgba(29,158,117,0.1)', borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                  >
                    <Text style={{ fontSize: 18 }}>📋</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, color: colors.teal, fontWeight: '700', marginBottom: 2 }}>INVITE CODE — TAP TO COPY</Text>
                      <Text style={{ fontSize: 12, color: colors.text, fontFamily: 'monospace' }} numberOfLines={1}>{sentToken}</Text>
                    </View>
                  </TouchableOpacity>
                )}
              </View>

              {/* Pending invites (show to all members) */}
              {invites.length > 0 && (
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 12 }]}>Pending invites</Text>
                  {invites.map((inv, i) => (
                    <View key={inv.id} style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      paddingVertical: 10,
                      borderBottomWidth: i < invites.length - 1 ? 0.5 : 0, borderBottomColor: colors.border,
                    }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, color: colors.text }}>{inv.invitedEmail}</Text>
                        <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>sent {timeAgo(inv.createdAt)}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleCopyToken(inv.token)}
                        style={{ backgroundColor: colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
                      >
                        <Text style={{ fontSize: 11, color: colors.textSub, fontWeight: '600' }}>copy code</Text>
                      </TouchableOpacity>
                      {isOwner && (
                        <TouchableOpacity onPress={() => handleCancelInvite(inv)} style={{ padding: 4 }}>
                          <Text style={{ fontSize: 15 }}>✕</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {/* Free joiner nudge — shown after 3 days */}
              {showNudge && (
                <View style={[styles.nudgeCard, { backgroundColor: isDark ? colors.surface : '#0A6650', shadowColor: isDark ? '#5DCAA5' : '#085041', shadowOpacity: isDark ? 0.22 : 0.45 }]}>
                  <View style={styles.nudgeCircle1} />
                  <View style={styles.nudgeCircle2} />
                  <Text style={{ fontSize: 22, marginBottom: 10 }}>✨</Text>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: 'white', marginBottom: 6 }}>
                    Loving the shared inventory?
                  </Text>
                  <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 19, marginBottom: 16 }}>
                    You've been sharing with your household for {joinedDays} day{joinedDays !== 1 ? 's' : ''}. Unlock Good Bot, Food Reports, unlimited items, and more.
                  </Text>
                  <TouchableOpacity
                    style={{ backgroundColor: '#5DCAA5', borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginBottom: 10 }}
                    onPress={showPaywall}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '700', color: colors.teal }}>Go Premium →</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 4 }} onPress={dismissNudge}>
                    <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>maybe later</Text>
                  </TouchableOpacity>
                </View>
              )}

              </Animated.View>
            </>
          ) : (
            /* ── Not in a household ── */
            <>
              {/* Illustration */}
              <Animated.View style={{ transform: [{ scale: heroScale }] }}>
              <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                <Text style={{ fontSize: 56 }}>🏠</Text>
                <Text style={{ fontSize: 20, fontWeight: '700', color: colors.teal, marginTop: 12 }}>Household sharing</Text>
                <Text style={{ fontSize: 13, color: colors.textSub, textAlign: 'center', marginTop: 6, lineHeight: 20, maxWidth: 280 }}>
                  Share your inventory with family or roommates. See and edit the same list in real time.
                </Text>
              </View>
              </Animated.View>

              <Animated.View style={{ gap: 12, opacity: cardsOpacity, transform: [{ translateY: cardsTranslateY }] }}>
              {/* Pending invites for this email */}
              {pendingForMe.length > 0 && (
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.teal, borderWidth: 1.5 }]}>
                  <Text style={[styles.cardHeading, { color: colors.teal, marginBottom: 12 }]}>🎉 You have an invite!</Text>
                  {pendingForMe.map(inv => (
                    <View key={inv.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <View>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>{inv.householdName}</Text>
                        <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>invited {timeAgo(inv.createdAt)}</Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.btn, { backgroundColor: colors.btnPrimary }]}
                        onPress={() => handleAcceptPending(inv)}
                      >
                        <Text style={styles.btnText}>join →</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {/* Create a household */}
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Text style={[styles.cardHeading, { color: colors.text }]}>Create a household</Text>
                  {!isPremium && (
                    <View style={{ backgroundColor: '#FFD166', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 9, fontWeight: '800', color: '#085041', letterSpacing: 0.4 }}>PREMIUM</Text>
                    </View>
                  )}
                </View>
                <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: 12 }}>
                  {isPremium ? 'Start a shared list and invite others to join.' : 'Start a shared list and invite your household. Free to join for members.'}
                </Text>
                <TextInput
                  style={[styles.input, { color: colors.inputText, backgroundColor: colors.inputBg, borderColor: colors.inputBorder, marginBottom: 10 }]}
                  value={createName}
                  onChangeText={setCreateName}
                  placeholder="Household name (e.g. The Johnsons)"
                  placeholderTextColor={colors.placeholder}
                  returnKeyType="done"
                  onSubmitEditing={handleCreate}
                />
                <ScaleBtn
                  style={[styles.btn, { backgroundColor: colors.btnPrimary, opacity: creating || !createName.trim() ? 0.5 : 1 }]}
                  onPress={handleCreate}
                  disabled={creating || !createName.trim()}
                >
                  {creating
                    ? <ActivityIndicator color="white" size="small" />
                    : <Text style={styles.btnText}>{isPremium ? 'create household →' : '🔒 create household'}</Text>}
                </ScaleBtn>
              </View>

              {/* Join with invite code */}
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 4 }]}>Join with an invite code</Text>
                <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: 12 }}>
                  Got a code from a household member? Paste it below.
                </Text>
                <TextInput
                  style={[styles.input, { color: colors.inputText, backgroundColor: colors.inputBg, borderColor: colors.inputBorder, marginBottom: 10, fontFamily: 'monospace' }]}
                  value={joinCode}
                  onChangeText={setJoinCode}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleJoin}
                />
                <ScaleBtn
                  style={[styles.btn, { backgroundColor: colors.btnPrimary, opacity: joining || !joinCode.trim() ? 0.5 : 1 }]}
                  onPress={handleJoin}
                  disabled={joining || !joinCode.trim()}
                >
                  {joining
                    ? <ActivityIndicator color="white" size="small" />
                    : <Text style={styles.btnText}>join household →</Text>}
                </ScaleBtn>
              </View>
              </Animated.View>
            </>
          )}
        </ScrollView>
      )}

      {/* Edit household sheet */}
      <SlideSheet visible={editVisible} onClose={() => setEditVisible(false)} colors={colors}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4 }}>
          Edit household
        </Text>
        {isOwner ? (
          <>
            <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>
              All members will see the new name.
            </Text>
            <TextInput
              style={[styles.input, { color: colors.inputText, backgroundColor: colors.inputBg, borderColor: colors.inputBorder, marginBottom: 16 }]}
              value={renameName}
              onChangeText={setRenameName}
              placeholder="Household name"
              placeholderTextColor={colors.placeholder}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleRename}
            />
            <ScaleBtn
              style={[styles.btn, { backgroundColor: colors.btnPrimary, opacity: !renameName.trim() ? 0.5 : 1, marginBottom: 24 }]}
              onPress={async () => { await handleRename(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }}
              disabled={!renameName.trim()}
            >
              <Text style={styles.btnText}>save name →</Text>
            </ScaleBtn>
            <View style={{ height: 0.5, backgroundColor: colors.border, marginBottom: 16 }} />
            <TouchableOpacity
              style={[styles.dangerBtn, { borderColor: '#E8756A' }]}
              onPress={() => { setEditVisible(false); setTimeout(handleDelete, 300); }}
            >
              <Text style={{ fontSize: 14 }}>🗑️</Text>
              <Text style={[styles.dangerText, { color: '#E8756A' }]}>Delete household</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: 24 }}>
              You're a member of this household. Leaving will remove your access to the shared inventory, recipes, and shopping list.
            </Text>
            <TouchableOpacity
              style={[styles.dangerBtn, { borderColor: '#E8756A' }]}
              onPress={() => { setEditVisible(false); setTimeout(handleLeave, 300); }}
            >
              <Text style={{ fontSize: 14 }}>🚪</Text>
              <Text style={[styles.dangerText, { color: '#E8756A' }]}>Leave household</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 12, marginTop: 8 }} onPress={() => setEditVisible(false)}>
          <Text style={{ fontSize: 13, color: colors.textMuted }}>cancel</Text>
        </TouchableOpacity>
      </SlideSheet>

      {drawerEl}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12,
    borderBottomWidth: 0.5, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 3,
  },
  logo: { fontSize: 28, fontWeight: '700', fontFamily: 'Fraunces_600SemiBold' },

  heroCard: {
    borderRadius: 20, padding: 20,
    shadowOffset: { width: 0, height: 10 }, shadowRadius: 24, elevation: 12,
    overflow: 'hidden',
  },
  blob1: { position: 'absolute', width: 160, height: 160, borderRadius: 80,  backgroundColor: 'rgba(93,202,165,0.15)', top: -50,  right: -40 },
  blob2: { position: 'absolute', width: 130, height: 130, borderRadius: 65,  backgroundColor: 'rgba(93,202,165,0.10)', bottom: -35, left: -35 },
  blob3: { position: 'absolute', width: 80,  height: 80,  borderRadius: 40,  backgroundColor: 'rgba(255,255,255,0.08)', top: 10,   left: -10 },
  blob4: { position: 'absolute', width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.04)', bottom: -80, right: -60 },

  card: { borderRadius: 16, borderWidth: 0.5, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 4 },
  cardHeading: { fontSize: 15, fontWeight: '600' },

  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  btn:   { borderRadius: 14, paddingVertical: 13, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', minHeight: 46 },
  btnText: { color: 'white', fontWeight: '700', fontSize: 14 },

  dangerBtn:  { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 14, padding: 14 },
  dangerText: { fontSize: 14, fontWeight: '600' },

  nudgeCard: {
    borderRadius: 20, padding: 20,
    shadowOffset: { width: 0, height: 10 }, shadowRadius: 20, elevation: 10,
    overflow: 'hidden',
  },
  nudgeCircle1: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(93,202,165,0.1)', top: -50, right: -50 },
  nudgeCircle2: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.04)', bottom: -30, left: -30 },
});
