import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  TouchableOpacity, Modal, Share, Animated, Easing,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureRef } from 'react-native-view-shot';
import { Accelerometer } from 'expo-sensors';
import { useTheme, type ThemeColors } from '../context/theme';

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = 'week' | 'month' | 'all';

interface Item {
  id: number; baseName: string; icon: string; category: 'fridge' | 'freezer' | 'pantry';
  expiryDate: string; protein: number; carbs: number; fat: number; cal: number; qtyNum: number;
}

interface GoneBadEntry { id: number; name: string; icon: string; date: string; expiryDate: string; }
interface Stats { goneGood: number; goneBad: number; totalAdded: number; }

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function periodStart(p: Period): Date {
  const now = new Date();
  if (p === 'week') {
    const d = new Date(now);
    const dow = d.getDay();
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (p === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(0);
}

function getWeekDays(): Date[] {
  const today = new Date();
  const dow = today.getDay();
  const mon = new Date(today);
  mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  mon.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d;
  });
}

function estimatePrice(name: string): number {
  const n = name.toLowerCase();
  if (['beef', 'steak', 'salmon', 'lobster', 'shrimp', 'lamb', 'ribeye'].some(k => n.includes(k))) return 8;
  if (['chicken', 'pork', 'turkey', 'fish', 'tuna', 'duck'].some(k => n.includes(k))) return 5;
  if (['cheese', 'butter', 'cream', 'avocado'].some(k => n.includes(k))) return 4;
  if (['yogurt', 'milk', 'egg', 'berry', 'mushroom'].some(k => n.includes(k))) return 3;
  if (['bread', 'pasta', 'rice', 'oat', 'flour'].some(k => n.includes(k))) return 2;
  return 3;
}

function timeAgo(iso: string) {
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d}d ago`;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function FoodReportScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [period, setPeriod]           = useState<Period>('week');
  const [items, setItems]             = useState<Item[]>([]);
  const [goneBad, setGoneBad]         = useState<GoneBadEntry[]>([]);
  const [stats, setStats]             = useState<Stats>({ goneGood: 0, goneBad: 0, totalAdded: 0 });
  const [goal, setGoal]               = useState(50);
  const [histTab, setHistTab]         = useState<'good' | 'bad'>('good');
  const [shareVisible, setShareVisible] = useState(false);
  const [shareMounted, setShareMounted] = useState(false);
  const [capturing, setCapturing]       = useState(false);
  const previewRef = useRef<View>(null);

  // Screen & content animations
  const screenFade      = useRef(new Animated.Value(0)).current;
  const screenSlide     = useRef(new Animated.Value(24)).current;
  const contentFade     = useRef(new Animated.Value(1)).current;
  const contentSlide    = useRef(new Animated.Value(0)).current;
  const shareOverlayAnim = useRef(new Animated.Value(0)).current;
  const shareSheetAnim   = useRef(new Animated.Value(700)).current;

  useEffect(() => {
    if (shareVisible) {
      setShareMounted(true);
      shareOverlayAnim.setValue(0);
      shareSheetAnim.setValue(700);
      Animated.parallel([
        Animated.timing(shareOverlayAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
        Animated.spring(shareSheetAnim,   { toValue: 0, damping: 22, stiffness: 180, useNativeDriver: true }),
      ]).start();
    } else if (shareMounted) {
      Animated.parallel([
        Animated.timing(shareOverlayAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(shareSheetAnim,   { toValue: 700, duration: 220, useNativeDriver: true }),
      ]).start(() => setShareMounted(false));
    }
  }, [shareVisible]);

  // Bubble animations (same as welcome screen, scaled for card)
  const b1Y = useRef(new Animated.Value(0)).current;
  const b1X = useRef(new Animated.Value(0)).current;
  const b2Y = useRef(new Animated.Value(0)).current;
  const b2X = useRef(new Animated.Value(0)).current;
  const b3Y = useRef(new Animated.Value(0)).current;
  const b3X = useRef(new Animated.Value(0)).current;
  const tiltX = useRef(new Animated.Value(0)).current;
  const tiltY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const float = (aY: Animated.Value, aX: Animated.Value, dur: number, rY: number, rX: number) =>
      Animated.loop(Animated.sequence([
        Animated.parallel([
          Animated.timing(aY, { toValue: -rY, duration: dur, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(aX, { toValue:  rX, duration: dur * 0.9, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
        ]),
        Animated.parallel([
          Animated.timing(aY, { toValue:  rY, duration: dur, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(aX, { toValue: -rX, duration: dur * 0.9, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
        ]),
        Animated.parallel([
          Animated.timing(aY, { toValue: 0, duration: dur, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(aX, { toValue: 0, duration: dur * 0.9, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
        ]),
      ])).start();

    float(b1Y, b1X, 4000, 18, 12);
    float(b2Y, b2X, 5500, 24, 14);
    float(b3Y, b3X, 3500, 14, 10);

    Accelerometer.setUpdateInterval(40);
    const sub = Accelerometer.addListener(({ x, y }) => {
      Animated.spring(tiltX, { toValue: x,     damping: 18, stiffness: 65, useNativeDriver: true }).start();
      Animated.spring(tiltY, { toValue: y + 1, damping: 18, stiffness: 65, useNativeDriver: true }).start();
    });
    return () => sub.remove();
  }, []);

  useFocusEffect(useCallback(() => {
    screenFade.setValue(0);
    screenSlide.setValue(24);
    Animated.parallel([
      Animated.timing(screenFade,  { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.spring(screenSlide, { toValue: 0, damping: 24, stiffness: 200, useNativeDriver: true }),
    ]).start();

    Promise.all([
      AsyncStorage.getItem('gogood_items'),
      AsyncStorage.getItem('gogood_gone_bad'),
      AsyncStorage.getItem('gogood_stats'),
      AsyncStorage.getItem('gogood_goal'),
    ]).then(([iv, gbv, sv, gv]) => {
      setItems(iv ? JSON.parse(iv) : []);
      setGoneBad(gbv ? JSON.parse(gbv) : []);
      setStats(sv ? JSON.parse(sv) : { goneGood: 0, goneBad: 0, totalAdded: 0 });
      setGoal(gv ? Number(gv) : 50);
    });
  }, []));

  // ── Derived ──────────────────────────────────────────────────────────────────

  const switchPeriod = (p: Period) => {
    if (p === period) return;
    Animated.parallel([
      Animated.timing(contentFade,  { toValue: 0, duration: 110, useNativeDriver: true }),
      Animated.timing(contentSlide, { toValue: 10, duration: 110, useNativeDriver: true }),
    ]).start(() => {
      setPeriod(p);
      contentSlide.setValue(-10);
      Animated.parallel([
        Animated.timing(contentFade,  { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(contentSlide, { toValue: 0, damping: 22, stiffness: 280, useNativeDriver: true }),
      ]).start();
    });
  };

  const captureAndShare = async () => {
    if (!previewRef.current || capturing) return;
    setCapturing(true);
    try {
      const uri = await captureRef(previewRef, { format: 'png', quality: 1, result: 'tmpfile' });
      setShareVisible(false);
      setTimeout(async () => {
        setCapturing(false);
        // Pass both the image (url) and caption (message) — iOS shares both together
        await Share.share({ message: shareCaption, url: uri });
      }, 280);
    } catch {
      setCapturing(false);
    }
  };

  const pStart       = periodStart(period);
  const filteredBad  = goneBad.filter(g => new Date(g.date) >= pStart);

  // Good count — we only have total; estimate period slice from density of bad entries
  const totalDays    = stats.totalAdded > 0
    ? Math.max(1, Math.round((Date.now() - (goneBad[goneBad.length - 1] ? new Date(goneBad[goneBad.length - 1].date).getTime() : Date.now() - 86400000 * 30)) / 86400000))
    : 30;
  const periodDays   = period === 'week' ? 7 : period === 'month' ? 30 : totalDays;
  const ratio        = Math.min(1, periodDays / Math.max(totalDays, 1));
  const goneGoodCount = period === 'all' ? stats.goneGood : Math.round(stats.goneGood * ratio);
  const goneBadCount  = filteredBad.length;

  const goneGoodDollars = Math.round(goneGoodCount * 3.5);
  const goneBadDollars  = filteredBad.reduce((s, g) => s + estimatePrice(g.name), 0);
  const netScore        = goneGoodDollars - goneBadDollars;

  const rescuedLbs  = (goneGoodCount * 0.5).toFixed(1);
  const mealsMade   = Math.floor(goneGoodCount / 2);
  const goalProgress = Math.min(1, goneGoodDollars / Math.max(goal, 1));

  // Streak
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const activitySet = new Set(
    goneBad.map(g => { const d = new Date(g.date); d.setHours(0, 0, 0, 0); return d.getTime(); })
  );
  if (items.length > 0) activitySet.add(today.getTime());

  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    if (activitySet.has(d.getTime())) streak++;
    else if (i > 0) break;
  }

  const weekDays = getWeekDays();
  const weekBoxes = weekDays.map(d => ({
    active:   activitySet.has(d.getTime()),
    isToday:  d.getTime() === today.getTime(),
    isFuture: d > today,
  }));

  // Daily chart (gone bad per day this week)
  const dailyBad = weekDays.map(d =>
    goneBad.filter(g => {
      const gd = new Date(g.date); gd.setHours(0, 0, 0, 0);
      return gd.getTime() === d.getTime();
    }).length
  );
  const maxDaily = Math.max(...dailyBad, 1);

  const isEmpty = stats.totalAdded === 0 && items.length === 0;

  const periodLabel = period === 'week' ? 'THIS WEEK' : period === 'month' ? 'THIS MONTH' : 'ALL TIME';
  const periodLabelLower = period === 'week' ? 'this week' : period === 'month' ? 'this month' : 'all time';

  const shareCaption = goneGoodCount > 0 && netScore >= 0
    ? `Rescued $${goneGoodDollars} worth of food ${periodLabelLower} and only wasted $${goneBadDollars} — net score +$${netScore} 🌱 Tracking every expiry date with @gogood so nothing goes to waste.`
    : goneGoodCount > 0
      ? `Saved $${goneGoodDollars} worth of food from going bad ${periodLabelLower} with @gogood 🌱 Still working on that net score — every rescued meal counts.`
      : `Just started tracking my food waste with @gogood 🌱 The goal: rescue every item before it goes bad and watch that net score climb.`;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <StatusBar style={colors.statusBar} backgroundColor={colors.bg} />
      <Animated.View style={[styles.container, { backgroundColor: colors.bg, opacity: screenFade, transform: [{ translateY: screenSlide }] }]}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>food<Text style={styles.logoGreen}>report</Text></Text>
        </View>

        {/* Period tabs */}
        <View style={[styles.tabRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
          {(['week', 'month', 'all'] as Period[]).map(p => (
            <TouchableOpacity
              key={p}
              style={[styles.tabBtn, period === p && styles.tabBtnActive]}
              onPress={() => switchPeriod(p)}
            >
              <Text style={[styles.tabBtnText, { color: period === p ? 'white' : colors.textSub }, period === p && { fontWeight: '600' }]}>
                {p === 'week' ? 'This week' : p === 'month' ? 'This month' : 'All time'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Animated.ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} style={{ opacity: contentFade, transform: [{ translateY: contentSlide }] }}>

          {isEmpty ? (
            <View style={{ alignItems: 'center', paddingTop: 60, gap: 10 }}>
              <Text style={{ fontSize: 48 }}>📊</Text>
              <Text style={{ fontSize: 17, fontWeight: '600', color: colors.teal }}>No data yet</Text>
              <Text style={{ fontSize: 13, color: colors.textSub, textAlign: 'center' }}>
                Add items to your inventory and start tracking to see your report here.
              </Text>
            </View>
          ) : (
            <>

              {/* ── Hero card ── */}
              <View style={styles.heroCard}>
                {/* Lava-lamp bubbles clipped to card */}
                <Animated.View style={[styles.heroCircle1, { transform: [
                  { translateY: b1Y }, { translateX: b1X },
                  { translateX: tiltX.interpolate({ inputRange: [-1, 1], outputRange: [-20, 20] }) },
                  { translateY: tiltY.interpolate({ inputRange: [-1, 1], outputRange: [-15, 15] }) },
                ]}]} />
                <Animated.View style={[styles.heroCircle2, { transform: [
                  { translateY: b2Y }, { translateX: b2X },
                  { translateX: tiltX.interpolate({ inputRange: [-1, 1], outputRange: [-10, 10] }) },
                  { translateY: tiltY.interpolate({ inputRange: [-1, 1], outputRange: [-8,   8] }) },
                ]}]} />
                <Animated.View style={[styles.heroCircle3, { transform: [
                  { translateY: b3Y }, { translateX: b3X },
                  { translateX: tiltX.interpolate({ inputRange: [-1, 1], outputRange: [-14, 14] }) },
                  { translateY: tiltY.interpolate({ inputRange: [-1, 1], outputRange: [-10, 10] }) },
                ]}]} />

                <Text style={styles.heroPeriodTag}>YOUR FOOD REPORT · {periodLabel}</Text>

                <View style={styles.heroSplit}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroGoodTag}>GONE GOOD 🌱</Text>
                    <Text style={styles.heroGoodVal}>${goneGoodDollars}</Text>
                    <Text style={styles.heroSub}>{goneGoodCount} item{goneGoodCount !== 1 ? 's' : ''} rescued</Text>
                  </View>
                  <View style={styles.heroDivider} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroBadTag}>GONE BAD 🥀</Text>
                    <Text style={styles.heroBadVal}>${goneBadDollars}</Text>
                    <Text style={styles.heroSub}>{goneBadCount} item{goneBadCount !== 1 ? 's' : ''} lost</Text>
                  </View>
                </View>

                <View style={styles.netRow}>
                  <Text style={styles.netLabel}>net food score {periodLabelLower}</Text>
                  <Text style={[styles.netVal, { color: netScore >= 0 ? '#5DCAA5' : '#E8756A' }]}>
                    {netScore >= 0 ? '+' : ''}${Math.abs(netScore)} {netScore >= 0 ? 'ahead' : 'behind'}
                  </Text>
                </View>

                <View style={styles.heroStatRow}>
                  {[
                    { val: String(mealsMade), label: 'MEALS MADE' },
                    { val: `${streak}🔥`,     label: 'DAY STREAK' },
                    { val: `${rescuedLbs}lb`, label: 'RESCUED'    },
                  ].map(s => (
                    <View key={s.label} style={styles.heroStatCell}>
                      <Text style={styles.heroStatVal}>{s.val}</Text>
                      <Text style={styles.heroStatLabel}>{s.label}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* ── Good Bot tip ── */}
              <TouchableOpacity
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => router.push('/(tabs)/goodbot')}
                activeOpacity={0.75}
              >
                <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
                  <View style={styles.botAvatar}>
                    <Text style={{ fontSize: 20 }}>🤖</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.botLabel, { color: colors.teal }]}>GOOD BOT TIP</Text>
                    <Text style={[styles.botText, { color: colors.text }]}>
                      {goneBadCount > 0
                        ? `${goneBadCount} thing${goneBadCount !== 1 ? 's' : ''} went bad ${periodLabelLower}. Let me check what's about to expire so we can rescue it before it's too late. 🌱`
                        : `Nothing went bad ${periodLabelLower} — great work! Want tips on what to cook next? 🌱`}
                    </Text>
                    <Text style={[styles.botLink, { color: colors.teal }]}>ask Good Bot →</Text>
                  </View>
                </View>
              </TouchableOpacity>

              {/* ── Gone good goal ── */}
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.cardRow}>
                  <Text style={[styles.cardHeading, { color: colors.text }]}>Gone good goal</Text>
                  <TouchableOpacity onPress={async () => {
                    const next = goal === 50 ? 100 : goal === 100 ? 25 : 50;
                    setGoal(next);
                    await AsyncStorage.setItem('gogood_goal', String(next));
                  }}>
                    <Text style={{ color: colors.teal, fontSize: 13, fontWeight: '600' }}>edit</Text>
                  </TouchableOpacity>
                </View>
                <View style={[styles.goalTrack, { backgroundColor: colors.border }]}>
                  <View style={[styles.goalFill, { width: `${Math.round(goalProgress * 100)}%` }]} />
                </View>
                <View style={styles.cardRow}>
                  <Text style={{ color: colors.teal, fontSize: 13, fontWeight: '600' }}>${goneGoodDollars} of ${goal} goal</Text>
                  <Text style={{ color: colors.textSub, fontSize: 13 }}>${Math.max(0, goal - goneGoodDollars)} to go</Text>
                </View>
              </View>

              {/* ── Daily chart ── */}
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 6 }]}>
                  Daily · {periodLabelLower}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#1D9E75' }} />
                    <Text style={{ fontSize: 11, color: colors.textSub }}>gone good</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#E8756A' }} />
                    <Text style={{ fontSize: 11, color: colors.textSub }}>gone bad</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', height: 80 }}>
                  {weekDays.map((d, i) => {
                    const badH = dailyBad[i] > 0 ? Math.max(12, (dailyBad[i] / maxDaily) * 64) : 0;
                    const isTd = d.getTime() === today.getTime();
                    return (
                      <View key={i} style={{ alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 22, height: 64, justifyContent: 'flex-end' }}>
                          {badH > 0
                            ? <View style={{ height: badH, borderRadius: 4, backgroundColor: '#E8756A' }} />
                            : <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.border }} />}
                        </View>
                        <Text style={{ fontSize: 10, color: isTd ? colors.teal : colors.textMuted, fontWeight: isTd ? '700' : '400' }}>
                          {DAY_LABELS[i]}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* ── Daily streak ── */}
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.cardRow}>
                  <View>
                    <Text style={[styles.cardHeading, { color: colors.text }]}>Daily streak</Text>
                    <Text style={{ fontSize: 11, color: colors.textSub, marginTop: 2 }}>go good every day to keep it alive</Text>
                  </View>
                  <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text }}>{streak}🔥</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 14 }}>
                  {weekBoxes.map((box, i) => (
                    <View
                      key={i}
                      style={[
                        styles.streakBox,
                        box.isFuture
                          ? { backgroundColor: colors.surfaceAlt }
                          : box.isToday && box.active
                            ? { backgroundColor: '#085041' }
                            : box.active
                              ? { backgroundColor: '#E1F5EE' }
                              : { backgroundColor: '#FEEBEB' },
                      ]}
                    >
                      <Text style={[
                        styles.streakMark,
                        box.isFuture
                          ? { color: colors.border }
                          : box.isToday && box.active
                            ? { color: 'white' }
                            : box.active
                              ? { color: '#085041' }
                              : { color: '#E24B4A' },
                      ]}>
                        {box.isFuture ? '·' : box.active ? '✓' : '✗'}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* ── History ── */}
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 12 }]}>History</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                  <TouchableOpacity
                    style={[styles.histPill, { backgroundColor: histTab === 'good' ? '#E1F5EE' : colors.surfaceAlt }]}
                    onPress={() => setHistTab('good')}
                  >
                    <Text style={[styles.histPillText, { color: histTab === 'good' ? '#085041' : colors.textSub }]}>
                      🌱 Gone good ({stats.goneGood})
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.histPill, { backgroundColor: histTab === 'bad' ? '#FEEBEB' : colors.surfaceAlt }]}
                    onPress={() => setHistTab('bad')}
                  >
                    <Text style={[styles.histPillText, { color: histTab === 'bad' ? '#A52020' : colors.textSub }]}>
                      🥀 Gone bad ({goneBad.length})
                    </Text>
                  </TouchableOpacity>
                </View>

                {histTab === 'bad' ? (
                  goneBad.length === 0 ? (
                    <View style={{ alignItems: 'center', paddingVertical: 20, gap: 6 }}>
                      <Text style={{ fontSize: 24 }}>🌱</Text>
                      <Text style={{ color: colors.textSub, fontSize: 13 }}>Nothing gone bad yet!</Text>
                    </View>
                  ) : goneBad.slice(0, 8).map((entry, i) => (
                    <View
                      key={entry.id}
                      style={[styles.histRow, {
                        borderBottomColor: colors.border,
                        borderBottomWidth: i < Math.min(goneBad.length, 8) - 1 ? 0.5 : 0,
                      }]}
                    >
                      <View style={styles.histIconWrap}>
                        <Text style={{ fontSize: 18 }}>{entry.icon || '🥗'}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.histName, { color: colors.text }]}>{entry.name}</Text>
                        <Text style={[styles.histSub, { color: colors.textMuted }]}>
                          gone bad · {timeAgo(entry.date)} · auto detected
                        </Text>
                      </View>
                      <View style={styles.histBadge}>
                        <Text style={styles.histBadgeText}>gone bad · ${estimatePrice(entry.name)}</Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <View style={{ alignItems: 'center', paddingVertical: 20, gap: 6 }}>
                    <Text style={{ fontSize: 24 }}>🌱</Text>
                    <Text style={{ color: colors.teal, fontSize: 14, fontWeight: '600' }}>
                      {stats.goneGood} item{stats.goneGood !== 1 ? 's' : ''} rescued
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: 'center' }}>
                      Individual gone good history coming soon
                    </Text>
                  </View>
                )}

                {histTab === 'bad' && goneBad.length > 8 && (
                  <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 10 }}>
                    + {goneBad.length - 8} more items in history
                  </Text>
                )}
              </View>

              {/* ── Share CTA ── */}
              <TouchableOpacity style={styles.shareCta} onPress={() => setShareVisible(true)} activeOpacity={0.85}>
                <Text style={{ fontSize: 28 }}>🌱</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shareCtaTitle}>Share your food report</Text>
                  <Text style={styles.shareCtaSub}>The good and the bad — full picture</Text>
                </View>
                <Text style={{ color: 'white', fontSize: 20 }}>→</Text>
              </TouchableOpacity>

            </>
          )}
        </Animated.ScrollView>
      </Animated.View>

      {/* ── Share modal ── */}
      {shareMounted && (
        <Modal visible={shareMounted} transparent animationType="none" onRequestClose={() => setShareVisible(false)}>
          <View style={{ flex: 1 }}>
            <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)', opacity: shareOverlayAnim }]} />
            <TouchableOpacity style={{ flex: 1 }} onPress={() => setShareVisible(false)} activeOpacity={1} />

            <Animated.View style={[styles.shareSheet, { backgroundColor: colors.surface, transform: [{ translateY: shareSheetAnim }] }]}>
              {/* Drag handle */}
              <View style={{ width: 36, height: 4, backgroundColor: colors.border, borderRadius: 999, alignSelf: 'center', marginBottom: 4 }} />

              {/* Social media preview card — 1:1 square */}
              <View ref={previewRef} style={styles.sharePreview} collapsable={false}>
                <View style={styles.previewCircle1} />
                <View style={styles.previewCircle2} />
                <View style={styles.previewCircle3} />

                <Text style={styles.previewBrandTop}>gogood 🌱</Text>

                <View style={{ flex: 1, justifyContent: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1, alignItems: 'center' }}>
                      <Text style={styles.previewTag}>GONE GOOD</Text>
                      <Text style={styles.previewGoodVal}>${goneGoodDollars}</Text>
                      <Text style={styles.previewSmall}>{goneGoodCount} rescued</Text>
                    </View>
                    <View style={{ width: 0.5, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'stretch', marginHorizontal: 12 }} />
                    <View style={{ flex: 1, alignItems: 'center' }}>
                      <Text style={styles.previewTag}>GONE BAD</Text>
                      <Text style={styles.previewBadVal}>${goneBadDollars}</Text>
                      <Text style={styles.previewSmall}>{goneBadCount} lost</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.previewNetRow}>
                  <Text style={[styles.previewNetText, { color: netScore >= 0 ? '#5DCAA5' : '#E8756A' }]}>
                    {netScore >= 0 ? '+' : ''}${Math.abs(netScore)} net
                  </Text>
                  <Text style={styles.previewPeriodText}> · {periodLabelLower}</Text>
                </View>
              </View>

              <Text style={[styles.shareTitle, { color: colors.text }]}>Share your food report 🌱</Text>

              {/* Caption preview */}
              <View style={[styles.captionBox, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                <Text style={[styles.captionLabel, { color: colors.teal }]}>CAPTION</Text>
                <Text style={[styles.captionText, { color: colors.textSub }]}>{shareCaption}</Text>
              </View>

              <Text style={[styles.shareSub, { color: colors.textMuted }]}>Pick where to share</Text>

              {/* Platform grid — 3 per row */}
              {[
                [
                  { icon: '📸', label: 'Instagram' },
                  { icon: '𝕏',  label: 'Twitter/X'  },
                  { icon: '📘', label: 'Facebook'  },
                ],
                [
                  { icon: '🎵', label: 'TikTok'   },
                  { icon: '💬', label: 'Messages'  },
                  { icon: '⋯',  label: 'More'      },
                ],
              ].map((row, ri) => (
                <View key={ri} style={{ flexDirection: 'row', gap: 8 }}>
                  {row.map(p => (
                    <TouchableOpacity
                      key={p.label}
                      style={[styles.platformBtn, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, opacity: capturing ? 0.5 : 1 }]}
                      onPress={captureAndShare}
                      disabled={capturing}
                    >
                      <Text style={{ fontSize: 22 }}>{p.icon}</Text>
                      <Text style={[styles.platformLabel, { color: colors.textSub }]}>{p.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}

              {capturing && (
                <View style={{ alignItems: 'center', paddingVertical: 4 }}>
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>capturing card…</Text>
                </View>
              )}

              <TouchableOpacity onPress={() => setShareVisible(false)} style={{ alignItems: 'center', paddingVertical: 4 }}>
                <Text style={{ color: colors.textMuted, fontSize: 13 }}>cancel</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

function createStyles(c: ThemeColors) { return StyleSheet.create({
  safe:          { flex: 1 },
  container:     { flex: 1 },

  header:        { backgroundColor: c.bg, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14, borderBottomWidth: 0.5, borderBottomColor: c.border, alignItems: 'center' },
  logo:          { fontSize: 28, fontWeight: '700', color: c.brand, fontFamily: 'Fraunces_600SemiBold' },
  logoGreen:     { color: c.teal, fontFamily: 'Fraunces_600SemiBold' },

  tabRow:        { flexDirection: 'row', marginHorizontal: 16, marginVertical: 12, borderRadius: 12, padding: 4, borderWidth: 0.5 },
  tabBtn:        { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  tabBtnActive:  { backgroundColor: '#085041' },
  tabBtnText:    { fontSize: 13 },

  // Hero
  heroCard:      { backgroundColor: '#085041', borderRadius: 20, padding: 20, overflow: 'hidden' },
  heroCircle1:   { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(255,255,255,0.05)', top: -60, right: -60 },
  heroCircle2:   { position: 'absolute', width: 160, height: 160, borderRadius: 80,  backgroundColor: 'rgba(93,202,165,0.08)', bottom: -40, left: -40 },
  heroCircle3:   { position: 'absolute', width: 110, height: 110, borderRadius: 55,  backgroundColor: 'rgba(255,255,255,0.04)', top: 80, right: -20 },
  heroPeriodTag: { fontSize: 9, color: 'rgba(255,255,255,0.45)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 18 },
  heroSplit:     { flexDirection: 'row', marginBottom: 16 },
  heroDivider:   { width: 0.5, backgroundColor: 'rgba(255,255,255,0.15)', marginHorizontal: 18, alignSelf: 'stretch' },
  heroGoodTag:   { fontSize: 9, color: '#5DCAA5', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  heroBadTag:    { fontSize: 9, color: '#E8756A', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  heroGoodVal:   { fontSize: 42, fontWeight: '700', color: 'white', lineHeight: 48 },
  heroBadVal:    { fontSize: 42, fontWeight: '700', color: '#E8756A', lineHeight: 48 },
  heroSub:       { fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 4 },
  netRow:        { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  netLabel:      { fontSize: 12, color: 'rgba(255,255,255,0.5)' },
  netVal:        { fontSize: 16, fontWeight: '700' },
  heroStatRow:   { flexDirection: 'row', gap: 8 },
  heroStatCell:  { flex: 1, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10, paddingVertical: 10, alignItems: 'center', gap: 4 },
  heroStatVal:   { fontSize: 16, fontWeight: '700', color: 'white' },
  heroStatLabel: { fontSize: 8, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5 },

  card:          { borderRadius: 16, borderWidth: 0.5, padding: 16 },
  cardRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardHeading:   { fontSize: 15, fontWeight: '600' },

  botAvatar:     { width: 46, height: 46, borderRadius: 23, backgroundColor: '#085041', alignItems: 'center', justifyContent: 'center' },
  botLabel:      { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  botText:       { fontSize: 14, lineHeight: 20, fontFamily: 'Fraunces_400Regular' },
  botLink:       { fontSize: 13, fontWeight: '600', marginTop: 10 },

  goalTrack:     { height: 8, borderRadius: 999, overflow: 'hidden' },
  goalFill:      { height: '100%', backgroundColor: '#1D9E75', borderRadius: 999 },

  streakBox:     { flex: 1, aspectRatio: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  streakMark:    { fontSize: 14, fontWeight: '700' },

  histPill:      { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  histPillText:  { fontSize: 12, fontWeight: '600' },
  histRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  histIconWrap:  { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FEEBEB', alignItems: 'center', justifyContent: 'center' },
  histName:      { fontSize: 13, fontWeight: '500' },
  histSub:       { fontSize: 11, marginTop: 2 },
  histBadge:     { backgroundColor: '#FEEBEB', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  histBadgeText: { fontSize: 10, fontWeight: '600', color: '#A52020' },

  shareCta:      { backgroundColor: '#085041', borderRadius: 16, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14 },
  shareCtaTitle: { fontSize: 15, fontWeight: '700', color: 'white' },
  shareCtaSub:   { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 },

  // Share modal
  shareSheet:      { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 44, gap: 12 },
  sharePreview:    { backgroundColor: '#085041', borderRadius: 20, aspectRatio: 1, width: '100%', overflow: 'hidden', padding: 22, justifyContent: 'space-between' },
  previewCircle1:  { position: 'absolute', width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(255,255,255,0.05)', top: -80, right: -80 },
  previewCircle2:  { position: 'absolute', width: 180, height: 180, borderRadius: 90,  backgroundColor: 'rgba(93,202,165,0.08)', bottom: -50, left: -50 },
  previewCircle3:  { position: 'absolute', width: 120, height: 120, borderRadius: 60,  backgroundColor: 'rgba(255,255,255,0.03)', top: 100, right: -30 },
  previewBrandTop: { fontSize: 13, color: 'rgba(255,255,255,0.55)', fontFamily: 'Fraunces_400Regular_Italic' },
  previewTag:      { fontSize: 8, color: 'rgba(255,255,255,0.45)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 5 },
  previewGoodVal:  { fontSize: 44, fontWeight: '700', color: '#5DCAA5', lineHeight: 50 },
  previewBadVal:   { fontSize: 44, fontWeight: '700', color: '#E8756A', lineHeight: 50 },
  previewSmall:    { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 3 },
  previewNetRow:   { flexDirection: 'row', alignItems: 'center' },
  previewNetText:  { fontSize: 14, fontWeight: '700' },
  previewPeriodText: { fontSize: 12, color: 'rgba(255,255,255,0.4)' },
  shareTitle:      { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  shareSub:        { fontSize: 13, textAlign: 'center', marginTop: -4 },
  captionBox:      { borderRadius: 12, borderWidth: 0.5, padding: 12, gap: 4 },
  captionLabel:    { fontSize: 8, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  captionText:     { fontSize: 12, lineHeight: 17, fontFamily: 'Fraunces_400Regular' },
  platformBtn:     { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 14, gap: 5, borderWidth: 0.5 },
  platformLabel:   { fontSize: 10, fontWeight: '600' },
}); }
