import EdgeFade from '@/components/edge-fade';
import { useTabBarSpace } from '@/components/tab-bar-space';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Animated, Easing,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import BottomSheet from '@/components/bottom-sheet';
import { raised, raisedGreen } from '@/components/raised';
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
  const tint = isDark ? 'rgba(79,120,97,' : 'rgba(35,179,133,';

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
    // Soft green blobs drifting behind a raised card
    <View style={[styles.heroCard, { backgroundColor: colors.surface }, raised(isDark, 'md')]}>
      <Animated.View style={[styles.blob1, { backgroundColor: tint + '0.10)', transform: [{ translateX: b1x }, { translateY: b1y }, { scale: b1s }] }]} />
      <Animated.View style={[styles.blob2, { backgroundColor: tint + '0.08)', transform: [{ translateX: b2x }, { translateY: b2y }, { scale: b2s }] }]} />
      <Animated.View style={[styles.blob3, { backgroundColor: tint + '0.06)', transform: [{ translateX: b3x }, { translateY: b3y }] }]} />
      <Animated.View style={[styles.blob4, { backgroundColor: tint + '0.05)', transform: [{ translateX: b4x }, { translateY: b4y }, { scale: b4s }] }]} />
      {children}
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function HouseholdScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace(); // room for the floating bottom bar
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

  const card = [styles.card, { backgroundColor: colors.surface }, raised(isDark, 'md')];
  const input = [styles.input, { color: colors.inputText, backgroundColor: colors.inputBg, borderColor: colors.inputBorder }];
  const kb = isDark ? 'dark' as const : 'light' as const;
  const link = isDark ? colors.tealLight : colors.brand;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={colors.statusBar} backgroundColor={colors.bg} />
      <Animated.View style={{ flex: 1, opacity: screenFade, transform: [{ translateY: screenSlide }] }}>

      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.bg, paddingTop: insets.top + 12 }]}>
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
        <View style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 30, gap: 14, paddingBottom: tabSpace + 24 }}
        >

          {household ? (
            /* ── Already in a household ── */
            <>
              {/* Household header card */}
              <Animated.View style={{ transform: [{ scale: heroScale }] }}>
              <LavaLampHeroCard colors={colors} isDark={isDark}>
                <Text style={[styles.label, { color: colors.textSub }]}>Your household</Text>
                <Text style={[styles.heroName, { color: colors.text }]}>{household.name}</Text>
                <Text style={{ fontSize: 13, color: colors.textSub }}>
                  {members.length} member{members.length !== 1 ? 's' : ''} sharing inventory, recipes and shopping
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
                  {([
                    { icon: 'nutrition-outline', label: 'Inventory', onPress: () => router.push('/(tabs)/' as any) },
                    { icon: 'book-outline',      label: 'Recipes',   onPress: () => router.push('/(tabs)/collections' as any) },
                    { icon: 'cart-outline',      label: 'Shopping',  onPress: () => router.push('/(tabs)/shopping' as any) },
                    { icon: 'settings-outline',  label: 'Edit',      onPress: () => { setRenameName(household.name); setEditVisible(true); } },
                  ] as const).map(l => (
                    <TouchableOpacity
                      key={l.label}
                      style={[styles.chip, { backgroundColor: colors.surface }, raised(isDark)]}
                      onPress={l.onPress}
                      activeOpacity={0.8}
                    >
                      <Ionicons name={l.icon} size={14} color={colors.textSub} />
                      <Text style={[styles.chipText, { color: colors.text }]}>{l.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </LavaLampHeroCard>
              </Animated.View>

              <Animated.View style={{ gap: 14, opacity: cardsOpacity, transform: [{ translateY: cardsTranslateY }] }}>
              {/* Members */}
              <View style={card}>
                <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 6 }]}>Members</Text>
                {members.map((m, i) => (
                  <View key={m.userId} style={{
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                    paddingVertical: 11,
                    borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.border,
                  }}>
                    <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: m.role === 'owner' ? colors.chipBg : colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 16, fontWeight: '700', color: m.role === 'owner' ? colors.chipText : colors.textSub }}>
                        {initials(m.email)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }} numberOfLines={1}>
                        {m.email}{m.userId === user?.id ? ' (you)' : ''}
                      </Text>
                      <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                        {m.role === 'owner' ? 'Owner · ' : 'Joined '}{timeAgo(m.joinedAt)}
                      </Text>
                    </View>
                    {isOwner && m.userId !== user?.id && (
                      <TouchableOpacity onPress={() => handleRemoveMember(m)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Remove member">
                        <Ionicons name="close" size={18} color={colors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>

              {/* Invite by email (any member can invite) */}
              <View style={card}>
                <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 4 }]}>Invite someone</Text>
                <Text style={[styles.cardSub, { color: colors.textSub }]}>
                  Enter their email. They'll get a code to paste on their Household screen.
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    style={[input, { flex: 1 }]}
                    value={inviteEmail}
                    onChangeText={setInviteEmail}
                    placeholder="email@example.com"
                    placeholderTextColor={colors.placeholder}
                    keyboardAppearance={kb}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    returnKeyType="send"
                    onSubmitEditing={handleInvite}
                  />
                  <ScaleBtn
                    style={[styles.btn, { backgroundColor: colors.btnPrimary, opacity: inviting || !inviteEmail.trim() ? 0.5 : 1 }, raisedGreen(isDark, 'sm')]}
                    onPress={handleInvite}
                    disabled={inviting || !inviteEmail.trim()}
                  >
                    {inviting ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.btnText}>Invite</Text>}
                  </ScaleBtn>
                </View>
                {sentToken && (
                  <TouchableOpacity
                    onPress={() => handleCopyToken(sentToken)}
                    style={{ marginTop: 12, backgroundColor: colors.chipBg, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="copy-outline" size={18} color={colors.chipText} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, color: colors.chipText, fontWeight: '700', marginBottom: 2 }}>Invite code · tap to copy</Text>
                      <Text style={{ fontSize: 12, color: colors.text, fontFamily: 'monospace' }} numberOfLines={1}>{sentToken}</Text>
                    </View>
                  </TouchableOpacity>
                )}
              </View>

              {/* Pending invites (show to all members) */}
              {invites.length > 0 && (
                <View style={card}>
                  <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 6 }]}>Pending invites</Text>
                  {invites.map((inv, i) => (
                    <View key={inv.id} style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      paddingVertical: 11,
                      borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.border,
                    }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, color: colors.text }} numberOfLines={1}>{inv.invitedEmail}</Text>
                        <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>Sent {timeAgo(inv.createdAt)}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleCopyToken(inv.token)}
                        style={[styles.chip, { backgroundColor: colors.surface }, raised(isDark)]}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.chipText, { color: colors.text }]}>Copy code</Text>
                      </TouchableOpacity>
                      {isOwner && (
                        <TouchableOpacity onPress={() => handleCancelInvite(inv)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Cancel invite">
                          <Ionicons name="close" size={18} color={colors.textMuted} />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {/* Free joiner nudge — shown after 3 days */}
              {showNudge && (
                <View style={card}>
                  <View style={[styles.iconCircle, { backgroundColor: colors.chipBg, marginBottom: 12 }]}>
                    <Ionicons name="sparkles-outline" size={20} color={colors.chipText} />
                  </View>
                  <Text style={[styles.cardHeading, { color: colors.text, fontSize: 16, marginBottom: 6 }]}>
                    Loving the shared inventory?
                  </Text>
                  <Text style={[styles.cardSub, { color: colors.textSub, lineHeight: 19, marginBottom: 16 }]}>
                    You've been sharing with your household for {joinedDays} day{joinedDays !== 1 ? 's' : ''}. Unlock Good Bot, Food Reports, unlimited items and more.
                  </Text>
                  <ScaleBtn style={[styles.btn, { backgroundColor: colors.btnPrimary }, raisedGreen(isDark)]} onPress={showPaywall}>
                    <Text style={styles.btnText}>Go Premium</Text>
                  </ScaleBtn>
                  <TouchableOpacity style={{ alignItems: 'center', paddingTop: 12 }} onPress={dismissNudge}>
                    <Text style={{ fontSize: 13, color: colors.textSub, fontWeight: '600' }}>Maybe later</Text>
                  </TouchableOpacity>
                </View>
              )}

              </Animated.View>
            </>
          ) : (
            /* ── Not in a household ── */
            <>
              {/* Intro */}
              <Animated.View style={{ transform: [{ scale: heroScale }] }}>
              <View style={{ alignItems: 'center', paddingTop: 16, paddingBottom: 8 }}>
                <View style={[styles.iconCircle, { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.chipBg }]}>
                  <Ionicons name="home-outline" size={32} color={colors.chipText} />
                </View>
                <Text style={[styles.introTitle, { color: colors.text }]}>Household sharing</Text>
                <Text style={{ fontSize: 14, color: colors.textSub, textAlign: 'center', marginTop: 8, lineHeight: 21, maxWidth: 300 }}>
                  Share your inventory with family or roommates. Everyone sees and edits the same list in real time.
                </Text>
              </View>
              </Animated.View>

              <Animated.View style={{ gap: 14, opacity: cardsOpacity, transform: [{ translateY: cardsTranslateY }] }}>
              {/* Pending invites for this email */}
              {pendingForMe.length > 0 && (
                <View style={[card, { borderColor: colors.teal, borderWidth: 1.5 }]}>
                  <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 10 }]}>You have an invite</Text>
                  {pendingForMe.map(inv => (
                    <View key={inv.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>{inv.householdName}</Text>
                        <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>Invited {timeAgo(inv.createdAt)}</Text>
                      </View>
                      <ScaleBtn
                        style={[styles.btn, { backgroundColor: colors.btnPrimary }, raisedGreen(isDark, 'sm')]}
                        onPress={() => handleAcceptPending(inv)}
                      >
                        <Text style={styles.btnText}>Join</Text>
                      </ScaleBtn>
                    </View>
                  ))}
                </View>
              )}

              {/* Create a household */}
              <View style={card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Text style={[styles.cardHeading, { color: colors.text }]}>Create a household</Text>
                  {!isPremium && (
                    <View style={{ backgroundColor: colors.chipBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: colors.chipText }}>Premium</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.cardSub, { color: colors.textSub }]}>
                  {isPremium ? 'Start a shared list and invite others to join.' : 'Start a shared list and invite your household. Joining is free for members.'}
                </Text>
                <TextInput
                  style={[input, { marginBottom: 12 }]}
                  value={createName}
                  onChangeText={setCreateName}
                  placeholder="Household name, e.g. The Johnsons"
                  placeholderTextColor={colors.placeholder}
                  keyboardAppearance={kb}
                  returnKeyType="done"
                  onSubmitEditing={handleCreate}
                />
                <ScaleBtn
                  style={[styles.btn, { backgroundColor: colors.btnPrimary, opacity: creating || !createName.trim() ? 0.5 : 1 }, raisedGreen(isDark)]}
                  onPress={handleCreate}
                  disabled={creating || !createName.trim()}
                >
                  {creating
                    ? <ActivityIndicator color="white" size="small" />
                    : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {!isPremium && <Ionicons name="lock-closed" size={14} color="white" />}
                        <Text style={styles.btnText}>Create household</Text>
                      </View>
                    )}
                </ScaleBtn>
              </View>

              {/* Join with invite code */}
              <View style={card}>
                <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 4 }]}>Join with an invite code</Text>
                <Text style={[styles.cardSub, { color: colors.textSub }]}>
                  Got a code from a household member? Paste it below.
                </Text>
                <TextInput
                  style={[input, { marginBottom: 12, fontFamily: 'monospace' }]}
                  value={joinCode}
                  onChangeText={setJoinCode}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  placeholderTextColor={colors.placeholder}
                  keyboardAppearance={kb}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleJoin}
                />
                <ScaleBtn
                  style={[styles.btn, { backgroundColor: colors.btnPrimary, opacity: joining || !joinCode.trim() ? 0.5 : 1 }, raisedGreen(isDark)]}
                  onPress={handleJoin}
                  disabled={joining || !joinCode.trim()}
                >
                  {joining
                    ? <ActivityIndicator color="white" size="small" />
                    : <Text style={styles.btnText}>Join household</Text>}
                </ScaleBtn>
              </View>
              </Animated.View>
            </>
          )}
        </ScrollView>
        {/* Content fades out under the header, like the inventory list */}
        <EdgeFade color={colors.bg} edge="top" height={36} />
        </View>
      )}

      {/* Edit household (same sheet as the rest of the app) */}
      <BottomSheet visible={editVisible} onClose={() => setEditVisible(false)}>
        <Text style={[styles.sheetTitle, { color: colors.text }]}>Edit household</Text>
        {isOwner ? (
          <>
            <Text style={[styles.label, { color: colors.textSub }]}>Name</Text>
            <TextInput
              style={[input, { marginBottom: 6 }]}
              value={renameName}
              onChangeText={setRenameName}
              placeholder="Household name"
              placeholderTextColor={colors.placeholder}
              keyboardAppearance={kb}
              returnKeyType="done"
              onSubmitEditing={handleRename}
            />
            <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>All members will see the new name.</Text>
            <ScaleBtn
              style={[styles.btn, { backgroundColor: colors.btnPrimary, opacity: !renameName.trim() ? 0.5 : 1, marginBottom: 20 }, raisedGreen(isDark)]}
              onPress={async () => { await handleRename(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }}
              disabled={!renameName.trim()}
            >
              <Text style={styles.btnText}>Save name</Text>
            </ScaleBtn>
            <TouchableOpacity
              style={[styles.dangerBtn, { backgroundColor: colors.surface }, raised(isDark, 'md')]}
              onPress={() => { setEditVisible(false); setTimeout(handleDelete, 350); }}
              activeOpacity={0.8}
            >
              <Ionicons name="trash-outline" size={18} color={DANGER} />
              <Text style={[styles.dangerText, { color: DANGER }]}>Delete household</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={{ fontSize: 14, color: colors.textSub, lineHeight: 21, marginBottom: 20 }}>
              You're a member of this household. Leaving removes your access to the shared inventory, recipes and shopping list.
            </Text>
            <TouchableOpacity
              style={[styles.dangerBtn, { backgroundColor: colors.surface }, raised(isDark, 'md')]}
              onPress={() => { setEditVisible(false); setTimeout(handleLeave, 350); }}
              activeOpacity={0.8}
            >
              <Ionicons name="exit-outline" size={18} color={DANGER} />
              <Text style={[styles.dangerText, { color: DANGER }]}>Leave household</Text>
            </TouchableOpacity>
          </>
        )}
      </BottomSheet>

      {drawerEl}
      </Animated.View>
    </View>
  );
}

const DANGER = '#E0574A';

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
  },
  logo: { fontSize: 28, fontWeight: '700', fontFamily: 'Fraunces_600SemiBold' },

  heroCard: { borderRadius: 20, padding: 20, overflow: 'hidden' },
  heroName: { fontSize: 26, fontWeight: '700', fontFamily: 'Fraunces_600SemiBold', marginBottom: 4 },
  blob1: { position: 'absolute', width: 160, height: 160, borderRadius: 80,  top: -50,  right: -40 },
  blob2: { position: 'absolute', width: 130, height: 130, borderRadius: 65,  bottom: -35, left: -35 },
  blob3: { position: 'absolute', width: 80,  height: 80,  borderRadius: 40,  top: 10,   left: -10 },
  blob4: { position: 'absolute', width: 200, height: 200, borderRadius: 100, bottom: -80, right: -60 },

  label:       { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  card:        { borderRadius: 16, padding: 16 },
  cardHeading: { fontSize: 15, fontWeight: '700' },
  cardSub:     { fontSize: 13, marginBottom: 12 },
  introTitle:  { fontSize: 22, fontWeight: '700', fontFamily: 'Fraunces_600SemiBold', marginTop: 14 },
  sheetTitle:  { fontSize: 18, fontWeight: '700', fontFamily: 'Fraunces_600SemiBold', marginBottom: 14 },
  iconCircle:  { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  chip:     { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 13, fontWeight: '600' },

  input:   { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  btn:     { borderRadius: 14, paddingVertical: 13, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  btnText: { color: 'white', fontWeight: '700', fontSize: 15 },

  dangerBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, padding: 14 },
  dangerText: { fontSize: 15, fontWeight: '600' },
});
