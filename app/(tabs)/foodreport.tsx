import EdgeFade from '@/components/edge-fade';
import { useTabBarSpace } from '@/components/tab-bar-space';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Modal, Animated, Easing, TextInput,
  Platform, KeyboardAvoidingView, Alert, LayoutAnimation } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureRef } from 'react-native-view-shot';
import { Accelerometer } from 'expo-sensors';
import { useTheme, type ThemeColors } from '../context/theme';
import { raised, raisedGreen } from '@/components/raised';

// Report colors, matched to the app's greens and its soft expiry badges
const GOOD     = '#23B385';
const BAD      = '#D0644F';
const AMBER    = '#D69A2D';
const BAD_BG   = 'rgba(208,100,79,0.14)';
const AMBER_BG = 'rgba(214,154,45,0.16)';
import { useAppDrawer } from '../components/AppDrawer';
import { useSubscription } from '../context/subscription';
import { DialogHost, showAlert } from '@/components/dialog';

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = 'week' | 'month' | 'all';

interface Item {
  id: number; baseName: string; icon: string; category: 'fridge' | 'freezer' | 'pantry';
  expiryDate: string; protein: number; carbs: number; fat: number; cal: number; qtyNum: number;
  days: number; unit?: string; foodCategory?: string;
}

interface HistoryEntry { id: number; name: string; icon: string; date: string; expiryDate: string; category?: string; portion?: string; storageLocation?: 'fridge' | 'freezer' | 'pantry'; daysLeft?: number; }
interface Stats { goneGood: number; goneBad: number; totalAdded: number; longestStreak?: number; }

// ── Helpers ───────────────────────────────────────────────────────────────────


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

function lastWeekStart(): Date {
  const now = new Date();
  const dow = now.getDay();
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
  thisMonday.setHours(0, 0, 0, 0);
  const lastMon = new Date(thisMonday);
  lastMon.setDate(thisMonday.getDate() - 7);
  return lastMon;
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
  if (['wagyu', 'lobster', 'filet mignon', 'truffle', 'scallop'].some(k => n.includes(k))) return 18;
  if (['beef', 'steak', 'salmon', 'shrimp', 'lamb', 'ribeye', 'crab', 'tuna steak'].some(k => n.includes(k))) return 9;
  if (['chicken', 'pork', 'turkey', 'fish', 'tuna', 'duck', 'sausage', 'bacon', 'ham'].some(k => n.includes(k))) return 6;
  if (['cheese', 'butter', 'cream', 'avocado', 'prosciutto', 'smoked salmon'].some(k => n.includes(k))) return 5;
  if (['yogurt', 'milk', 'egg', 'berry', 'mushroom', 'tofu', 'hummus'].some(k => n.includes(k))) return 4;
  if (['bread', 'pasta', 'rice', 'oat', 'flour', 'tortilla', 'noodle'].some(k => n.includes(k))) return 3;
  if (['apple', 'orange', 'banana', 'carrot', 'lettuce', 'spinach', 'tomato', 'onion', 'garlic'].some(k => n.includes(k))) return 2;
  return 3;
}

function getEnvFactors(name: string): { co2: number; water: number; lbs: number } {
  const n = name.toLowerCase();
  if (['beef', 'steak', 'lamb', 'bison', 'veal', 'ribeye'].some(k => n.includes(k)))   return { co2: 6.8, water: 3850, lbs: 0.5 };
  if (['pork', 'bacon', 'ham', 'sausage'].some(k => n.includes(k)))                    return { co2: 2.2, water: 1100, lbs: 0.4 };
  if (['chicken', 'turkey', 'duck'].some(k => n.includes(k)))                          return { co2: 1.5, water: 730,  lbs: 0.4 };
  if (['salmon', 'tuna', 'shrimp', 'fish', 'crab', 'scallop'].some(k => n.includes(k))) return { co2: 2.9, water: 880, lbs: 0.3 };
  if (['milk', 'yogurt', 'cheese', 'butter', 'cream'].some(k => n.includes(k)))        return { co2: 1.4, water: 510,  lbs: 0.5 };
  if (['egg'].some(k => n.includes(k)))                                                 return { co2: 0.4, water: 196,  lbs: 0.15 };
  if (['bread', 'pasta', 'rice', 'oat', 'flour', 'cereal'].some(k => n.includes(k)))   return { co2: 0.7, water: 420,  lbs: 0.3 };
  return { co2: 0.4, water: 180, lbs: 0.35 };
}

function gradeFromScore(score: number): { grade: string; label: string; color: string } {
  if (score >= 92) return { grade: 'A+', label: 'Food Champion',    color: GOOD };
  if (score >= 85) return { grade: 'A',  label: 'Excellent',        color: GOOD };
  if (score >= 75) return { grade: 'B',  label: 'Great work',       color: GOOD };
  if (score >= 60) return { grade: 'C',  label: 'Making progress',  color: AMBER };
  if (score >= 45) return { grade: 'D',  label: 'Needs attention',  color: AMBER };
  return              { grade: 'F',  label: 'High waste',       color: BAD };
}

function getGradeSummary(
  grade: { grade: string; label: string; color: string },
  efficiencyScore: number,
  rescueRate: number,
  streak: number,
  momentumDelta: number | null,
  atRiskItems: Item[],
  repeatOffenders: { name: string; count: number; cost: number }[],
  worstCat: { cat: string; bad: number; good: number } | undefined,
  totalTracked: number,
  goneGoodCount: number,
  goneBadCount: number,
  period: Period,
  goalProgress: number,
): { summary: string; strengths: string[]; improvements: string[] } {
  const rescuePct = Math.round(rescueRate * 100);

  let summary = '';
  if (grade.grade === 'A+') {
    summary = `You're in the top tier of food efficiency. Rescuing ${rescuePct}% of tracked food with a score of ${efficiencyScore}/100 puts you in elite territory. Keep this up and you'll save hundreds of dollars a year while cutting your food waste footprint.`;
  } else if (grade.grade === 'A') {
    summary = `Excellent food management. You're rescuing ${rescuePct}% of tracked food with a score of ${efficiencyScore}/100. Your habits are strong — small gains in consistency and momentum could push you to A+ territory.`;
  } else if (grade.grade === 'B') {
    summary = `Solid work overall — you're rescuing ${rescuePct}% of your food. A score of ${efficiencyScore}/100 shows good habits, but roughly ${100 - rescuePct}% is still being lost. Tightening a couple of routines can get you into A range quickly.`;
  } else if (grade.grade === 'C') {
    summary = `You're making progress, but around ${100 - rescuePct}% of tracked food is going to waste. A score of ${efficiencyScore}/100 means there are clear, actionable opportunities to rescue more. Addressing even one weak area below can jump you up a full grade.`;
  } else if (grade.grade === 'D') {
    summary = `More than half your tracked food is going to waste right now. A score of ${efficiencyScore}/100 is a strong signal that some habits need to shift — but rescuing just a few more items per week moves this score significantly.`;
  } else {
    summary = `${goneBadCount} item${goneBadCount !== 1 ? 's' : ''} went bad out of ${totalTracked} tracked. A score of ${efficiencyScore}/100 tells us food waste is a consistent pattern right now. Every single rescue you log this week will immediately improve this grade.`;
  }

  const strengths: string[] = [];
  if (rescueRate >= 0.8) strengths.push(`Strong rescue rate — you're saving ${rescuePct}% of tracked food`);
  if (streak >= 7) strengths.push(`${streak}-day tracking streak — consistency is your superpower`);
  if (momentumDelta !== null && momentumDelta >= 0.1) strengths.push(`Rescue rate improved ${Math.round(momentumDelta * 100)}% vs last period — you're trending up`);
  if (goalProgress >= 1 && period !== 'all') strengths.push(`You hit your food rescue goal this period`);
  if (goneGoodCount >= 10) strengths.push(`${goneGoodCount} items rescued ${period === 'week' ? 'this week' : period === 'month' ? 'this month' : 'all time'} — that's real impact`);

  const improvements: string[] = [];
  if (atRiskItems.length > 0) {
    const next = atRiskItems[0];
    const when = next.days <= 0 ? 'today' : next.days === 1 ? 'tomorrow' : `in ${next.days} days`;
    improvements.push(`${next.baseName} expires ${when} — use or freeze it now to protect your rescue rate`);
  }
  if (repeatOffenders.length > 0) {
    const top = repeatOffenders[0];
    improvements.push(`${top.name} has gone bad ${top.count}× ($${top.cost} lost) — buy less or freeze it the day you bring it home`);
  }
  if (worstCat && worstCat.bad >= 2) {
    improvements.push(`${worstCat.cat} is your weakest category — plan a meal around it before your next grocery run`);
  }
  if (streak < 3 && improvements.length < 3) {
    improvements.push(`Log activity every day — even just checking expiry dates counts toward your consistency score`);
  }
  if (rescueRate < 0.6 && totalTracked >= 5 && improvements.length < 3) {
    improvements.push(`Try buying about 20% less on your next shop — less coming in means less going to waste`);
  }
  if (period !== 'all' && goalProgress < 0.5 && improvements.length < 3) {
    improvements.push(`You're less than halfway to your rescue goal — using one more item from your inventory today would make a dent`);
  }

  return { summary, strengths: strengths.slice(0, 3), improvements: improvements.slice(0, 3) };
}

function getTip(item: string): string {
  const n = item.toLowerCase();
  if (['chicken', 'turkey', 'duck'].some(k => n.includes(k)))         return 'Freeze within 2 days or cook immediately.';
  if (['beef', 'steak', 'pork', 'lamb'].some(k => n.includes(k)))     return 'Freeze on the day of purchase if not cooking soon.';
  if (['milk', 'cream'].some(k => n.includes(k)))                      return 'Freeze in portions before the expiry date.';
  if (['bread'].some(k => n.includes(k)))                              return 'Freeze half the loaf to prevent mold.';
  if (['lettuce', 'spinach', 'greens'].some(k => n.includes(k)))      return 'Store with a paper towel to absorb moisture.';
  if (['avocado'].some(k => n.includes(k)))                            return 'Refrigerate once ripe to extend life by 3–5 days.';
  if (['berry', 'berries', 'strawberry'].some(k => n.includes(k)))    return 'Rinse only before eating, not before storing.';
  if (['tomato'].some(k => n.includes(k)))                             return 'Store at room temp — fridge kills the flavor.';
  if (['mushroom'].some(k => n.includes(k)))                           return 'Store in a paper bag, not plastic — they need airflow.';
  if (['egg'].some(k => n.includes(k)))                                return 'Eggs last 3–5 weeks past the carton date if refrigerated.';
  if (['cheese'].some(k => n.includes(k)))                             return 'Wrap in parchment paper, not plastic, to prevent mold.';
  return 'Use within 3 days of opening, or freeze for later.';
}

function timeAgo(iso: string) {
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d}d ago`;
}

function calcStreak(goodEntries: HistoryEntry[], badEntries: HistoryEntry[], hasItems: boolean): { current: number; longest: number } {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const activitySet = new Set<number>();
  [...goodEntries, ...badEntries].forEach(e => {
    const d = new Date(e.date); d.setHours(0, 0, 0, 0);
    activitySet.add(d.getTime());
  });
  if (hasItems) activitySet.add(today.getTime());

  let current = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    if (activitySet.has(d.getTime())) current++;
    else if (i > 0) break;
  }

  // Calculate longest streak
  const sorted = [...activitySet].sort((a, b) => a - b);
  let longest = 0; let run = 0; let prev = 0;
  for (const ts of sorted) {
    if (prev && ts - prev === 86400000) { run++; } else { run = 1; }
    if (run > longest) longest = run;
    prev = ts;
  }

  return { current, longest };
}

// ── Slide-up sheet (used for restore + edit) ─────────────────────────────────

function HistSheet({ visible, onClose, children, colors }: {
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
        Animated.timing(fadeAnim,  { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, damping: 22, stiffness: 180, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 600, duration: 200, useNativeDriver: true }),
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
          <Animated.View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, maxHeight: '85%', transform: [{ translateY: slideAnim }] }}>
            <View style={{ width: 36, height: 4, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 999, alignSelf: 'center', marginBottom: 16 }} />
            {children}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
      <DialogHost />
    </Modal>
  );
}

// ── Activity Chart ────────────────────────────────────────────────────────────

function ActivityChart({ goodData, badData, labels, todayIdx, colors }: {
  goodData: number[]; badData: number[]; labels: string[];
  todayIdx?: number; colors: ThemeColors;
}) {
  const CHART_H = 90;
  const maxVal = Math.max(...goodData, ...badData, 1);

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
        {[{ color: colors.teal, label: 'gone good' }, { color: BAD, label: 'gone bad' }].map(l => (
          <View key={l.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: l.color }} />
            <Text style={{ fontSize: 11, color: colors.textSub }}>{l.label}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {/* Y-axis labels */}
        <View style={{ width: 24, justifyContent: 'space-between', alignItems: 'flex-end', paddingRight: 5, paddingBottom: 20 }}>
          <Text style={{ fontSize: 8, color: colors.textMuted }}>{maxVal}</Text>
          <Text style={{ fontSize: 8, color: colors.textMuted }}>0</Text>
        </View>
        {/* Chart + x-axis */}
        <View style={{ flex: 1 }}>
          <View style={{ height: CHART_H }}>
            <View style={{ position: 'absolute', top: 0,           left: 0, right: 0, height: 0.5, backgroundColor: colors.border }} />
            <View style={{ position: 'absolute', top: CHART_H / 2, left: 0, right: 0, height: 0.5, backgroundColor: colors.border }} />
            <View style={{ position: 'absolute', bottom: 0,        left: 0, right: 0, height: 0.5, backgroundColor: colors.border }} />
            <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end' }}>
              {labels.map((_, i) => {
                const gH = goodData[i] > 0 ? Math.max(3, (goodData[i] / maxVal) * CHART_H) : 0;
                const bH = badData[i]  > 0 ? Math.max(3, (badData[i]  / maxVal) * CHART_H) : 0;
                return (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
                    <View style={{ width: 10, height: gH, backgroundColor: colors.teal, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
                    <View style={{ width: 10, height: bH, backgroundColor: BAD, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
                  </View>
                );
              })}
            </View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 6 }}>
            {labels.map((label, i) => (
              <Text key={i} style={{ fontSize: 9, color: i === todayIdx ? colors.teal : colors.textMuted, fontWeight: i === todayIdx ? '700' : '400', textAlign: 'center', minWidth: 20 }}>
                {label}
              </Text>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function FoodReportScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace(); // room for the floating bottom bar
  const router = useRouter();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const { menuBtn, drawerEl } = useAppDrawer();
  const { isPremium, showPaywall } = useSubscription();

  const [period, setPeriod]           = useState<Period>('week');
  const [showInsights, setShowInsights] = useState(false);
  const [items, setItems]             = useState<Item[]>([]);
  const [goneGoodHistory, setGoneGoodHistory] = useState<HistoryEntry[]>([]);
  const [goneBadHistory,  setGoneBadHistory]  = useState<HistoryEntry[]>([]);
  const [stats, setStats]             = useState<Stats>({ goneGood: 0, goneBad: 0, totalAdded: 0 });
  const [goalWeek, setGoalWeek]       = useState(50);
  const [goalMonth, setGoalMonth]     = useState(200);
  const [goalInput, setGoalInput]     = useState('');
  const [editingGoal, setEditingGoal] = useState(false);
  const [histTab, setHistTab]         = useState<'good' | 'bad'>('good');
  const [histShowAll, setHistShowAll] = useState(false);
  const [shareVisible, setShareVisible] = useState(false);
  const [shareMounted, setShareMounted] = useState(false);
  const [capturing, setCapturing]       = useState(false);
  const previewRef = useRef<View>(null);

  // History editing
  const [expandedHistKey, setExpandedHistKey]   = useState<string | null>(null);
  const [restoreVisible, setRestoreVisible]     = useState(false);
  const [restoreEntry, setRestoreEntry]         = useState<HistoryEntry | null>(null);
  const [restoreFrom, setRestoreFrom]           = useState<'good' | 'bad'>('good');
  const [restoreLoc, setRestoreLoc]             = useState<'fridge' | 'freezer' | 'pantry'>('fridge');
  const [restoreName, setRestoreName]           = useState('');
  const [editVisible, setEditVisible]           = useState(false);
  const [editEntry, setEditEntry]               = useState<HistoryEntry | null>(null);
  const [editFrom, setEditFrom]                 = useState<'good' | 'bad'>('good');
  const [editName, setEditName]                 = useState('');
  const [wasteSheetVisible, setWasteSheetVisible] = useState(false);
  const [gradeSheetVisible, setGradeSheetVisible] = useState(false);

  // Animations
  const screenFade       = useRef(new Animated.Value(0)).current;
  const screenSlide      = useRef(new Animated.Value(24)).current;
  const contentFade      = useRef(new Animated.Value(1)).current;
  const contentSlide     = useRef(new Animated.Value(0)).current;
  const heroScale        = useRef(new Animated.Value(0.94)).current;
  const cardsOpacity     = useRef(new Animated.Value(0)).current;
  const cardsTranslateY  = useRef(new Animated.Value(20)).current;
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

  // Bubble / tilt animations for hero card
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
    heroScale.setValue(0.94);
    cardsOpacity.setValue(0);
    cardsTranslateY.setValue(20);

    Animated.parallel([
      Animated.timing(screenFade,  { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.spring(screenSlide, { toValue: 0, damping: 24, stiffness: 200, useNativeDriver: true }),
      Animated.spring(heroScale,   { toValue: 1, damping: 16, stiffness: 200, useNativeDriver: true }),
    ]).start();

    setTimeout(() => {
      Animated.parallel([
        Animated.timing(cardsOpacity,    { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(cardsTranslateY, { toValue: 0, damping: 22, stiffness: 180, useNativeDriver: true }),
      ]).start();
    }, 100);

    Promise.all([
      AsyncStorage.getItem('gogood_items'),
      AsyncStorage.getItem('gogood_gone_good'),
      AsyncStorage.getItem('gogood_gone_bad'),
      AsyncStorage.getItem('gogood_stats'),
      AsyncStorage.getItem('gogood_goal_week'),
      AsyncStorage.getItem('gogood_goal_month'),
    ]).then(([iv, ggv, gbv, sv, gwv, gmv]) => {
      setItems(iv ? JSON.parse(iv) : []);
      setGoneGoodHistory(ggv ? JSON.parse(ggv) : []);
      setGoneBadHistory(gbv ? JSON.parse(gbv) : []);
      setStats(sv ? JSON.parse(sv) : { goneGood: 0, goneBad: 0, totalAdded: 0 });
      const gw = gwv ? Number(gwv) : 50;
      const gm = gmv ? Number(gmv) : 200;
      setGoalWeek(gw);
      setGoalMonth(gm);
      setGoalInput(String(gw));
    });
  }, []));

  // ── Derived ──────────────────────────────────────────────────────────────────

  const PERIOD_IDX: Record<Period, number> = { week: 0, month: 1, all: 2 };

  const switchPeriod = (p: Period) => {
    if (p === period) return;
    setEditingGoal(false);
    const dir = PERIOD_IDX[p] > PERIOD_IDX[period] ? 1 : -1;
    Animated.parallel([
      Animated.timing(contentFade,  { toValue: 0, duration: 100, useNativeDriver: true }),
      Animated.timing(contentSlide, { toValue: 18 * dir, duration: 100, useNativeDriver: true }),
    ]).start(() => {
      setPeriod(p);
      setHistShowAll(false);
      const newGoal = p === 'week' ? goalWeek : p === 'month' ? goalMonth : 0;
      setGoalInput(String(newGoal));
      contentSlide.setValue(-18 * dir);
      Animated.parallel([
        Animated.timing(contentFade,  { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(contentSlide, { toValue: 0, damping: 20, stiffness: 260, useNativeDriver: true }),
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
        try {
          await Sharing.shareAsync(uri, {
            mimeType: 'image/png',
            dialogTitle: 'Share your food report',
            UTI: 'public.png',
          });
        } catch {
          // user cancelled — no action needed
        } finally {
          setCapturing(false);
        }
      }, 280);
    } catch {
      setCapturing(false);
      showAlert('Could not capture card', 'Please try again.');
    }
  };

  const handleClearAllData = () => {
    showAlert(
      'Clear all data?',
      'This will permanently erase your entire food history, stats, and inventory. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: () => {
            showAlert(
              'Are you absolutely sure?',
              'Every item, all history, all stats — gone forever. There is no undo.',
              [
                { text: 'Keep my data', style: 'cancel' },
                {
                  text: 'Yes, delete everything',
                  style: 'destructive',
                  onPress: async () => {
                    await Promise.all([
                      AsyncStorage.removeItem('gogood_gone_good'),
                      AsyncStorage.removeItem('gogood_gone_bad'),
                      AsyncStorage.removeItem('gogood_stats'),
                      AsyncStorage.removeItem('gogood_goal_week'),
                      AsyncStorage.removeItem('gogood_goal_month'),
                    ]);
                    setStats({ goneGood: 0, goneBad: 0, totalAdded: 0 });
                    setGoneGoodHistory([]);
                    setGoneBadHistory([]);
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  const saveGoal = async () => {
    const n = Math.min(9999, Math.max(1, parseInt(goalInput, 10) || 0));
    if (n > 0) {
      if (period === 'week')  { setGoalWeek(n);  await AsyncStorage.setItem('gogood_goal_week',  String(n)); }
      if (period === 'month') { setGoalMonth(n); await AsyncStorage.setItem('gogood_goal_month', String(n)); }
      setGoalInput(String(n));
    }
    setEditingGoal(false);
  };

  // ── History editing handlers ─────────────────────────────────────────────────

  const openRestore = (entry: HistoryEntry, from: 'good' | 'bad') => {
    setRestoreEntry(entry);
    setRestoreFrom(from);
    setRestoreName(entry.name);
    setRestoreLoc('fridge');
    setRestoreVisible(true);
  };

  const openEdit = (entry: HistoryEntry, from: 'good' | 'bad') => {
    setEditEntry(entry);
    setEditFrom(from);
    setEditName(entry.name);
    setEditVisible(true);
  };

  const handleDeleteHistEntry = (entry: HistoryEntry, from: 'good' | 'bad') => {
    showAlert('Delete entry', `Remove "${entry.name}" from history?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          if (from === 'good') {
            const updated = goneGoodHistory.filter(g => !(g.id === entry.id && g.date === entry.date));
            await AsyncStorage.setItem('gogood_gone_good', JSON.stringify(updated));
            setGoneGoodHistory(updated);
          } else {
            const updated = goneBadHistory.filter(g => !(g.id === entry.id && g.date === entry.date));
            await AsyncStorage.setItem('gogood_gone_bad', JSON.stringify(updated));
            setGoneBadHistory(updated);
          }
          setExpandedHistKey(null);
        },
      },
    ]);
  };

  const handleRestoreItem = async () => {
    if (!restoreEntry) return;
    const itemsVal = await AsyncStorage.getItem('gogood_items');
    const existing = itemsVal ? JSON.parse(itemsVal) : [];

    const name       = restoreName.trim() || restoreEntry.name;
    // If the old expiry date has already passed, give it a fresh week — otherwise the
    // inventory would immediately move it straight back to "gone bad".
    const freshExpiry = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const oldExpiry   = restoreEntry.expiryDate ? restoreEntry.expiryDate.slice(0, 10) : '';
    const expiryDate  = oldExpiry && new Date(oldExpiry).getTime() > new Date(new Date().toDateString()).getTime() - 86400000
      ? oldExpiry
      : freshExpiry;
    const ms         = new Date(expiryDate).getTime() - new Date(new Date().toDateString()).getTime();
    const days       = Math.round(ms / 86400000);
    const badge      = days < 0 ? 'black' : restoreLoc === 'freezer' ? 'blue' : days === 0 ? 'red' : days <= 5 ? 'amber' : 'green';
    const expires    = days < 0 ? 'expired' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `${days} days`;

    const newItem = {
      id:          Date.now(),
      icon:        restoreEntry.icon || '🥘',
      name,
      baseName:    name,
      batch:       1,
      qty:         '1',
      expiryDate,
      expires,
      badge,
      days,
      protein:     0,
      carbs:       0,
      fat:         0,
      cal:         0,
      qtyNum:      1,
      unit:        '',
      category:    restoreLoc,
      addedAt:     Date.now(),
      foodCategory: restoreEntry.category || '',
    };
    await AsyncStorage.setItem('gogood_items', JSON.stringify([...existing, newItem]));

    const sv = await AsyncStorage.getItem('gogood_stats');
    const s: Stats = sv ? JSON.parse(sv) : { goneGood: 0, goneBad: 0, totalAdded: 0 };

    if (restoreFrom === 'good') {
      const updated = goneGoodHistory.filter(g => !(g.id === restoreEntry.id && g.date === restoreEntry.date));
      await AsyncStorage.setItem('gogood_gone_good', JSON.stringify(updated));
      setGoneGoodHistory(updated);
      const ns = { ...s, goneGood: Math.max(0, s.goneGood - 1) };
      await AsyncStorage.setItem('gogood_stats', JSON.stringify(ns));
      setStats(ns);
    } else {
      const updated = goneBadHistory.filter(g => !(g.id === restoreEntry.id && g.date === restoreEntry.date));
      await AsyncStorage.setItem('gogood_gone_bad', JSON.stringify(updated));
      setGoneBadHistory(updated);
      const ns = { ...s, goneBad: Math.max(0, s.goneBad - 1) };
      await AsyncStorage.setItem('gogood_stats', JSON.stringify(ns));
      setStats(ns);
    }

    setRestoreVisible(false);
    setExpandedHistKey(null);
  };

  const handleSaveEdit = async () => {
    if (!editEntry || !editName.trim()) return;
    const updated = { ...editEntry, name: editName.trim() };
    if (editFrom === 'good') {
      const newHistory = goneGoodHistory.map(g =>
        (g.id === editEntry.id && g.date === editEntry.date) ? updated : g
      );
      await AsyncStorage.setItem('gogood_gone_good', JSON.stringify(newHistory));
      setGoneGoodHistory(newHistory);
    } else {
      const newHistory = goneBadHistory.map(g =>
        (g.id === editEntry.id && g.date === editEntry.date) ? updated : g
      );
      await AsyncStorage.setItem('gogood_gone_bad', JSON.stringify(newHistory));
      setGoneBadHistory(newHistory);
    }
    setEditVisible(false);
    setExpandedHistKey(null);
  };

  const pStart      = periodStart(period);
  const lwStart     = lastWeekStart();
  const lwEnd       = new Date(lwStart); lwEnd.setDate(lwStart.getDate() + 7);

  const filteredGood = goneGoodHistory.filter(g => new Date(g.date) >= pStart);
  const filteredBad  = goneBadHistory.filter(g => new Date(g.date) >= pStart);

  const lwGood = goneGoodHistory.filter(g => { const d = new Date(g.date); return d >= lwStart && d < lwEnd; });
  const lwBad  = goneBadHistory.filter(g => { const d = new Date(g.date); return d >= lwStart && d < lwEnd; });

  const goneGoodCount = filteredGood.length > 0 ? filteredGood.length : (period === 'all' ? stats.goneGood : 0);
  const goneBadCount  = filteredBad.length;

  const goneGoodDollars = filteredGood.reduce((s, g) => s + estimatePrice(g.name), 0) || Math.round(goneGoodCount * 3.5);
  const goneBadDollars  = filteredBad.reduce((s, g) => s + estimatePrice(g.name), 0);
  const netScore        = goneGoodDollars - goneBadDollars;

  const lwGoodDollars = lwGood.reduce((s, g) => s + estimatePrice(g.name), 0);
  const lwBadDollars  = lwBad.reduce((s, g) => s + estimatePrice(g.name), 0);
  const lwNet         = lwGoodDollars - lwBadDollars;

  const goal        = period === 'week' ? goalWeek : goalMonth;
  const goalProgress = Math.min(1, goneGoodDollars / Math.max(goal, 1));

  const { current: streak, longest: longestStreak } = calcStreak(goneGoodHistory, goneBadHistory, items.length > 0);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const activitySet = new Set<number>();
  [...goneGoodHistory, ...goneBadHistory].forEach(e => {
    const d = new Date(e.date); d.setHours(0, 0, 0, 0);
    activitySet.add(d.getTime());
  });
  if (items.length > 0) activitySet.add(today.getTime());

  const monthStart      = new Date(today.getFullYear(), today.getMonth(), 1);
  const prevMonthStart  = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const thisMonthBad    = goneBadHistory.filter(g => new Date(g.date) >= monthStart);
  const prevMonthBad    = goneBadHistory.filter(g => { const d = new Date(g.date); return d >= prevMonthStart && d < monthStart; });
  const thisMonthWastedDollars = thisMonthBad.reduce((s, g) => s + estimatePrice(g.name), 0);
  const prevMonthWastedDollars = prevMonthBad.reduce((s, g) => s + estimatePrice(g.name), 0);
  const wastedTrend = thisMonthWastedDollars - prevMonthWastedDollars;

  const weekDays  = getWeekDays();
  const weekBoxes = weekDays.map(d => ({
    active:   activitySet.has(d.getTime()),
    isToday:  d.getTime() === today.getTime(),
    isFuture: d > today,
  }));

  // Activity chart — different granularity per period
  let chartTitle: string;
  let chartLabels: string[];
  let chartGood: number[];
  let chartBad: number[];
  let chartTodayIdx: number | undefined;

  if (period === 'week') {
    chartTitle = 'Daily activity';
    chartLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    chartGood = weekDays.map(d => goneGoodHistory.filter(g => {
      const gd = new Date(g.date); gd.setHours(0, 0, 0, 0); return gd.getTime() === d.getTime();
    }).length);
    chartBad = weekDays.map(d => goneBadHistory.filter(g => {
      const gd = new Date(g.date); gd.setHours(0, 0, 0, 0); return gd.getTime() === d.getTime();
    }).length);
    chartTodayIdx = weekDays.findIndex(d => d.getTime() === today.getTime());
  } else if (period === 'month') {
    chartTitle = 'Weekly activity';
    const mStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const weekCount = Math.ceil(today.getDate() / 7);
    chartLabels = Array.from({ length: weekCount }, (_, i) => `Wk${i + 1}`);
    chartGood = Array.from({ length: weekCount }, (_, w) => {
      const wStart = new Date(mStart.getFullYear(), mStart.getMonth(), 1 + w * 7);
      const wEnd   = new Date(mStart.getFullYear(), mStart.getMonth(), 1 + (w + 1) * 7);
      return goneGoodHistory.filter(g => { const d = new Date(g.date); return d >= wStart && d < wEnd; }).length;
    });
    chartBad = Array.from({ length: weekCount }, (_, w) => {
      const wStart = new Date(mStart.getFullYear(), mStart.getMonth(), 1 + w * 7);
      const wEnd   = new Date(mStart.getFullYear(), mStart.getMonth(), 1 + (w + 1) * 7);
      return goneBadHistory.filter(g => { const d = new Date(g.date); return d >= wStart && d < wEnd; }).length;
    });
    chartTodayIdx = Math.floor((today.getDate() - 1) / 7);
  } else {
    chartTitle = 'Monthly activity';
    const months = Array.from({ length: 12 }, (_, i) =>
      new Date(today.getFullYear(), today.getMonth() - 11 + i, 1)
    );
    chartLabels = months.map(m => m.toLocaleString('en-US', { month: 'short' }));
    chartGood = months.map(m => {
      const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 1);
      return goneGoodHistory.filter(g => { const d = new Date(g.date); return d >= m && d < mEnd; }).length;
    });
    chartBad = months.map(m => {
      const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 1);
      return goneBadHistory.filter(g => { const d = new Date(g.date); return d >= m && d < mEnd; }).length;
    });
    chartTodayIdx = 11;
  }

  // Category breakdown
  const catMap = new Map<string, { good: number; bad: number }>();
  filteredGood.forEach(g => {
    const cat = g.category || 'Other';
    const entry = catMap.get(cat) || { good: 0, bad: 0 };
    catMap.set(cat, { ...entry, good: entry.good + 1 });
  });
  filteredBad.forEach(g => {
    const cat = g.category || 'Other';
    const entry = catMap.get(cat) || { good: 0, bad: 0 };
    catMap.set(cat, { ...entry, bad: entry.bad + 1 });
  });
  const catBreakdown = [...catMap.entries()]
    .map(([cat, counts]) => ({ cat, ...counts, total: counts.good + counts.bad }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
  const maxCat = Math.max(...catBreakdown.map(c => c.total), 1);

  // ── Advanced metrics ──────────────────────────────────────────────────────────

  // Rescue rate
  const totalTracked = goneGoodCount + goneBadCount;
  const rescueRate   = totalTracked > 0 ? goneGoodCount / totalTracked : 0;

  // Prior-period rescue rate for momentum
  const prevMonthGood = goneGoodHistory.filter(g => { const d = new Date(g.date); return d >= prevMonthStart && d < monthStart; });
  const prevGoodCount = period === 'week' ? lwGood.length : period === 'month' ? prevMonthGood.length : 0;
  const prevBadCount  = period === 'week' ? lwBad.length  : period === 'month' ? prevMonthBad.length  : 0;
  const prevTotal     = prevGoodCount + prevBadCount;
  const prevRescueRate = prevTotal > 0 ? prevGoodCount / prevTotal : null;
  const momentumDelta  = prevRescueRate !== null ? rescueRate - prevRescueRate : null;

  // Efficiency score (0–100) and letter grade
  const rescueRatePct = rescueRate * 100;
  const streakPct     = Math.min(streak / 30, 1) * 100;
  const momentumPct   = momentumDelta !== null ? Math.max(0, Math.min(100, 50 + momentumDelta * 200)) : 50;
  const goalPct       = period !== 'all' ? goalProgress * 100 : rescueRatePct;
  const efficiencyScore = totalTracked === 0 ? 0 : Math.round(
    rescueRatePct * 0.40 + streakPct * 0.15 + momentumPct * 0.20 + goalPct * 0.25
  );
  const grade = gradeFromScore(efficiencyScore);

  // At-risk inventory (non-frozen, expiring ≤3 days)
  const atRiskItems = items.filter(i => i.days <= 3 && i.category !== 'freezer').sort((a, b) => a.days - b.days).slice(0, 5);
  const atRiskValue = atRiskItems.reduce((s, i) => s + estimatePrice(i.baseName), 0);

  // Annualized projections
  const allEntries   = [...goneGoodHistory, ...goneBadHistory];
  const firstEntryTs = allEntries.length > 0 ? Math.min(...allEntries.map(e => new Date(e.date).getTime())) : Date.now();
  const daysTracked  = period === 'week' ? 7 : period === 'month' ? 30 : Math.max(1, Math.ceil((Date.now() - firstEntryTs) / 86400000));
  const projSavedAnnual = Math.round(goneGoodDollars / daysTracked * 365);
  const projWasteAnnual = Math.round(goneBadDollars  / daysTracked * 365);
  const projNetAnnual   = projSavedAnnual - projWasteAnnual;

  // Food-type-aware environmental totals
  const envTotals = filteredGood.reduce(
    (acc, g) => { const f = getEnvFactors(g.name); return { co2: acc.co2 + f.co2, water: acc.water + f.water, lbs: acc.lbs + f.lbs }; },
    { co2: 0, water: 0, lbs: 0 }
  );
  const totalCo2   = envTotals.co2   > 0 ? envTotals.co2.toFixed(1)              : (goneGoodCount * 2.5).toFixed(1);
  const totalWater = envTotals.water > 0 ? Math.round(envTotals.water)            : goneGoodCount * 200;
  const totalLbs   = envTotals.lbs   > 0 ? envTotals.lbs.toFixed(1)              : (goneGoodCount * 0.5).toFixed(1);

  // Expiry timing insights (using expiryDate vs date from history)
  const timingGood = filteredGood.filter(g => g.expiryDate).map(g => Math.round((new Date(g.expiryDate).getTime() - new Date(g.date).getTime()) / 86400000));
  const timingBad  = filteredBad.filter(g => g.expiryDate).map(g => Math.round((new Date(g.expiryDate).getTime() - new Date(g.date).getTime()) / 86400000));
  const avgDaysWhenRescued = timingGood.length >= 2 ? Math.round(timingGood.reduce((a, b) => a + b, 0) / timingGood.length * 10) / 10 : null;
  const avgDaysWhenWasted  = timingBad.length  >= 2 ? Math.round(timingBad.reduce((a, b) => a + b, 0)  / timingBad.length  * 10) / 10 : null;

  // Storage location breakdown (fridge / freezer / pantry)
  const storageMap = new Map<string, { good: number; bad: number }>();
  ['fridge', 'freezer', 'pantry'].forEach(loc => storageMap.set(loc, { good: 0, bad: 0 }));
  filteredGood.forEach(g => {
    const loc = g.storageLocation || ((['fridge','freezer','pantry'].includes(g.category || '')) ? g.category! : null);
    if (loc) { const e = storageMap.get(loc)!; storageMap.set(loc, { ...e, good: e.good + 1 }); }
  });
  filteredBad.forEach(g => {
    const loc = g.storageLocation;
    if (loc) { const e = storageMap.get(loc)!; storageMap.set(loc, { ...e, bad: e.bad + 1 }); }
  });
  const storageBreakdown = (['fridge', 'freezer', 'pantry'] as const).map(loc => ({
    loc, icon: loc === 'fridge' ? '❄️' : loc === 'freezer' ? '🧊' : '🥫',
    label: loc.charAt(0).toUpperCase() + loc.slice(1),
    ...storageMap.get(loc)!,
  })).filter(s => s.good + s.bad > 0);
  const maxStorage = Math.max(...storageBreakdown.map(s => s.good + s.bad), 1);

  // Repeat offenders — items wasted more than once (all-time)
  const offenderMap = new Map<string, { count: number; cost: number; icon: string }>();
  goneBadHistory.forEach(g => {
    const key = g.name.toLowerCase().trim();
    const ex  = offenderMap.get(key) || { count: 0, cost: 0, icon: g.icon || '🥘' };
    offenderMap.set(key, { count: ex.count + 1, cost: ex.cost + estimatePrice(g.name), icon: g.icon || ex.icon });
  });
  const repeatOffenders = [...offenderMap.entries()]
    .map(([name, data]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), ...data }))
    .filter(r => r.count >= 2)
    .sort((a, b) => b.count - a.count || b.cost - a.cost)
    .slice(0, 5);

  // Smart coaching tips (context-aware, max 3)
  const coachingTips: { icon: string; title: string; body: string }[] = [];
  if (atRiskItems.length > 0) {
    const soonest = atRiskItems[0];
    const when = soonest.days <= 0 ? 'today' : soonest.days === 1 ? 'tomorrow' : `in ${soonest.days} days`;
    coachingTips.push({ icon: '', title: 'Use it now', body: `${soonest.baseName} expires ${when}. Use or freeze it before it's gone.` });
  }
  if (repeatOffenders.length > 0 && coachingTips.length < 3) {
    const top = repeatOffenders[0];
    coachingTips.push({ icon: '', title: 'Repeat waste alert', body: `${top.name} has gone bad ${top.count}× ($${top.cost} lost). Buy smaller portions or freeze immediately when purchased.` });
  }
  const worstCat = [...catBreakdown].filter(c => c.bad > 0).sort((a, b) => (b.bad / (b.bad + b.good)) - (a.bad / (a.bad + a.good)))[0];
  if (worstCat && worstCat.bad >= 2 && coachingTips.length < 3) {
    coachingTips.push({ icon: '', title: `${worstCat.cat} needs attention`, body: `${worstCat.bad} item${worstCat.bad !== 1 ? 's' : ''} wasted in ${worstCat.cat}. Check this category first on shopping days and plan meals around what's already there.` });
  }
  if (avgDaysWhenWasted !== null && avgDaysWhenWasted < 0 && coachingTips.length < 3) {
    coachingTips.push({ icon: '', title: 'Expiry timing insight', body: `Items go bad an average of ${Math.abs(avgDaysWhenWasted)} day${Math.abs(avgDaysWhenWasted) !== 1 ? 's' : ''} after their label date. Check items a few days before the date shown — not on the day.` });
  }
  if (rescueRate < 0.5 && totalTracked >= 5 && coachingTips.length < 3) {
    coachingTips.push({ icon: '', title: 'Buy less, waste less', body: `Over half your tracked food went bad. Try a smaller weekly shop and refresh mid-week — fresher items, less waste.` });
  }
  if (coachingTips.length < 3 && streak === 0) {
    coachingTips.push({ icon: '', title: 'Start your streak', body: 'Log a use or mark something gone good today to start your daily tracking streak.' });
  }
  if (coachingTips.length < 3 && atRiskItems.length === 0 && totalTracked >= 3 && rescueRate >= 0.8) {
    coachingTips.push({ icon: '', title: 'Keep it up', body: `You're rescuing ${Math.round(rescueRate * 100)}% of your food. Plan meals around expiry dates to maintain this streak.` });
  }

  const isEmpty = stats.totalAdded === 0 && items.length === 0 && goneGoodHistory.length === 0 && goneBadHistory.length === 0;

  const periodLabel      = period === 'week' ? 'THIS WEEK' : period === 'month' ? 'THIS MONTH' : 'ALL TIME';
  const periodLabelLower = period === 'week' ? 'this week' : period === 'month' ? 'this month' : 'all time';

  const shareCaption = goneGoodCount > 0 && netScore >= 0
    ? `Rescued $${goneGoodDollars} worth of food ${periodLabelLower} and only wasted $${goneBadDollars} — net score +$${netScore}. Tracking every expiry date with @gogood so nothing goes to waste.`
    : goneGoodCount > 0
      ? `Saved $${goneGoodDollars} worth of food from going bad ${periodLabelLower} with @gogood. Still working on that net score — every rescued meal counts.`
      : `Just started tracking my food waste with @gogood. The goal: rescue every item before it goes bad and watch that net score climb.`;

  // History display lists
  const HIST_PAGE = 8;
  const goodList = period === 'all' ? goneGoodHistory : filteredGood;
  const badList  = period === 'all' ? goneBadHistory  : filteredBad;
  const displayGood = histShowAll ? goodList : goodList.slice(0, HIST_PAGE);
  const displayBad  = histShowAll ? badList  : badList.slice(0, HIST_PAGE);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.safe, { backgroundColor: colors.bg }]}>
      <StatusBar style={colors.statusBar} backgroundColor={colors.bg} />
      <Animated.View style={[styles.container, { backgroundColor: colors.bg, opacity: screenFade, transform: [{ translateY: screenSlide }] }]}>

        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          {menuBtn}
          <Text style={styles.logo}>food<Text style={styles.logoGreen}>report</Text></Text>
          <View style={{ width: 36 }} />
        </View>

        {/* Content area — overlay lives here so header/hamburger stays tappable */}
        <View style={{ flex: 1, position: 'relative' }}>

        {/* Period tabs */}
        <View style={[styles.tabRow, { backgroundColor: colors.surfaceAlt }]}>
          {(['week', 'month', 'all'] as Period[]).map(p => (
            <TouchableOpacity
              key={p}
              style={[styles.tabBtn, period === p && [styles.tabBtnActive, raised(isDark)]]}
              onPress={() => switchPeriod(p)}
            >
              <Text style={[styles.tabBtnText, { color: period === p ? colors.text : colors.textSub }, period === p && { fontWeight: '600' }]}>
                {p === 'week' ? 'This week' : p === 'month' ? 'This month' : 'All time'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ flex: 1 }}>
        <Animated.ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 30, gap: 12, paddingBottom: tabSpace + 24 }}
          style={{ opacity: contentFade, transform: [{ translateY: contentSlide }] }}
        >

          {isEmpty ? (
            <View style={{ alignItems: 'center', paddingTop: 60, gap: 10 }}>
              <Text style={{ fontSize: 17, fontWeight: '600', color: colors.text }}>No data yet</Text>
              <Text style={{ fontSize: 13, color: colors.textSub, textAlign: 'center' }}>
                Add items to your inventory and start tracking to see your report here.
              </Text>
            </View>
          ) : (
            <>

              {/* ── Summary: what you used vs. what went bad ── */}
              <Animated.View style={{ transform: [{ scale: heroScale }] }}>
              <View style={styles.heroCard}>
                <Text style={styles.heroPeriodTag}>{periodLabel}</Text>
                <View style={styles.heroSplit}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroTag}>Used</Text>
                    <Text style={styles.heroVal}>${goneGoodDollars}</Text>
                    <Text style={styles.heroSub}>{goneGoodCount} item{goneGoodCount !== 1 ? 's' : ''}</Text>
                  </View>
                  <View style={styles.heroDivider} />
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => setWasteSheetVisible(true)} activeOpacity={0.75}>
                    <Text style={styles.heroTag}>Went bad</Text>
                    <Text style={styles.heroVal}>${goneBadDollars}</Text>
                    <Text style={styles.heroSub}>{goneBadCount} item{goneBadCount !== 1 ? 's' : ''} · details ›</Text>
                  </TouchableOpacity>
                </View>
                {/* Share of food used before it went bad */}
                <View style={styles.heroBarTrack}>
                  <View style={[styles.heroBarFill, { width: `${Math.round(rescueRate * 100)}%` }]} />
                </View>
                <Text style={styles.heroBarLabel}>
                  {Math.round(rescueRate * 100)}% of your food was used before it went bad
                </Text>
              </View>
              </Animated.View>

              <Animated.View style={{ opacity: cardsOpacity, transform: [{ translateY: cardsTranslateY }], gap: 12 }}>

              {/* ── Use these first ── */}
              {atRiskItems.length > 0 && (
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.cardRow}>
                    <Text style={[styles.cardHeading, { color: colors.text }]}>Use these first</Text>
                    <Text style={{ fontSize: 12, color: colors.textSub }}>~${atRiskValue} at stake</Text>
                  </View>
                  {atRiskItems.map((item, i) => (
                    <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 10 }}>
                      <Text style={{ flex: 1, fontSize: 14, fontWeight: '500', color: colors.text }} numberOfLines={1}>{item.baseName}</Text>
                      <View style={[styles.pill, { backgroundColor: item.days <= 1 ? BAD_BG : AMBER_BG }]}>
                        <Text style={[styles.pillText, { color: item.days <= 1 ? BAD : AMBER }]}>
                          {item.days <= 0 ? 'today' : item.days === 1 ? 'tomorrow' : `${item.days} days`}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* ── Activity chart ── */}
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 14 }]}>{chartTitle}</Text>
                <ActivityChart
                  goodData={chartGood}
                  badData={chartBad}
                  labels={chartLabels}
                  todayIdx={chartTodayIdx}
                  colors={colors}
                />
              </View>

              {/* ── Grade (details in the grade sheet) ── */}
              {totalTracked >= 3 && (
                <TouchableOpacity
                  style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 14 }]}
                  onPress={() => setGradeSheetVisible(true)}
                  activeOpacity={0.75}
                >
                  <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: grade.color + '1F', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 22, fontWeight: '800', color: grade.color }}>{grade.grade}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardHeading, { color: colors.text }]}>{grade.label}</Text>
                    <Text style={{ fontSize: 12, color: colors.textSub, marginTop: 2 }}>
                      Score {efficiencyScore}/100
                      {momentumDelta !== null && Math.abs(momentumDelta) >= 0.01
                        ? ` · ${momentumDelta > 0 ? 'up' : 'down'} ${Math.round(Math.abs(momentumDelta) * 100)}% from last ${period === 'month' ? 'month' : 'week'}`
                        : ''}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 20, color: colors.textMuted }}>›</Text>
                </TouchableOpacity>
              )}

              {/* ── Goal (week & month only) ── */}
              {period !== 'all' && (
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.cardRow}>
                    <Text style={[styles.cardHeading, { color: colors.text }]}>{period === 'week' ? 'Weekly goal' : 'Monthly goal'}</Text>
                    {editingGoal ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ color: colors.textSub, fontSize: 13 }}>$</Text>
                        <TextInput
                          style={[styles.goalInput, { color: colors.text, borderColor: colors.teal }]}
                          value={goalInput}
                          onChangeText={v => setGoalInput(v.replace(/[^0-9]/g, '').slice(0, 4))}
                          keyboardType="number-pad"
                          autoFocus
                          returnKeyType="done"
                          onSubmitEditing={saveGoal}
                          selectTextOnFocus
                        />
                        <TouchableOpacity onPress={saveGoal}>
                          <Text style={{ color: colors.teal, fontSize: 13, fontWeight: '700' }}>Save</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity onPress={() => { setGoalInput(String(goal)); setEditingGoal(true); }}>
                        <Text style={{ color: colors.textSub, fontSize: 13, fontWeight: '600' }}>Edit</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={[styles.goalTrack, { backgroundColor: colors.surfaceAlt }]}>
                    <View style={[styles.goalFill, { width: `${Math.round(goalProgress * 100)}%` }]} />
                  </View>
                  <View style={styles.cardRow}>
                    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>${goneGoodDollars} of ${goal} used</Text>
                    <Text style={{ color: colors.textSub, fontSize: 13 }}>
                      {goalProgress >= 1 ? 'Goal reached' : `$${Math.max(0, goal - goneGoodDollars)} to go`}
                    </Text>
                  </View>
                </View>
              )}

              {/* ── More insights (collapsed so the screen stays calm) ── */}
              <TouchableOpacity
                style={[styles.insightsToggle, raised(isDark), { backgroundColor: colors.surface }]}
                onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setShowInsights(v => !v); }}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>{showInsights ? 'Hide insights' : 'More insights'}</Text>
                <Text style={{ fontSize: 12, color: colors.textMuted }}>{showInsights ? '' : 'Trends, categories, impact and more'}</Text>
              </TouchableOpacity>

              {showInsights && (
                <>
                  {/* Week over week */}
                  {period === 'week' && (
                    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 12 }]}>Compared to last week</Text>
                      {[
                        { label: 'Used',      now: goneGoodDollars, prev: lwGoodDollars },
                        { label: 'Went bad',  now: goneBadDollars,  prev: lwBadDollars },
                      ].map((r, i) => (
                        <View key={r.label} style={[styles.statRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                          <Text style={{ flex: 1, fontSize: 13, color: colors.textSub }}>{r.label}</Text>
                          <Text style={{ fontSize: 13, color: colors.textMuted, marginRight: 12 }}>${r.prev} last week</Text>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>${r.now}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Category breakdown */}
                  {catBreakdown.length > 0 && (
                    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 12 }]}>By food category</Text>
                      <View style={{ gap: 10 }}>
                        {catBreakdown.map(c => (
                          <View key={c.cat} style={{ gap: 4 }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                              <Text style={{ fontSize: 12, color: colors.text, fontWeight: '500' }}>{c.cat}</Text>
                              <Text style={{ fontSize: 11, color: colors.textMuted }}>{c.good} used · {c.bad} went bad</Text>
                            </View>
                            <View style={{ flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}>
                              {c.good > 0 && <View style={{ flex: c.good / maxCat, backgroundColor: GOOD }} />}
                              {c.bad > 0 && <View style={{ flex: c.bad / maxCat, backgroundColor: BAD }} />}
                            </View>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Storage location breakdown */}
                  {storageBreakdown.length > 0 && (
                    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 12 }]}>By storage location</Text>
                      <View style={{ gap: 10 }}>
                        {storageBreakdown.map(s => {
                          const locTotal = s.good + s.bad;
                          const rate = locTotal > 0 ? Math.round(s.good / locTotal * 100) : 0;
                          return (
                            <View key={s.loc} style={{ gap: 4 }}>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                <Text style={{ fontSize: 12, color: colors.text, fontWeight: '500' }}>{s.label}</Text>
                                <Text style={{ fontSize: 11, color: colors.textMuted }}>{rate}% used</Text>
                              </View>
                              <View style={{ flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}>
                                {s.good > 0 && <View style={{ flex: s.good / maxStorage, backgroundColor: GOOD }} />}
                                {s.bad > 0 && <View style={{ flex: s.bad / maxStorage, backgroundColor: BAD }} />}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  )}

                  {/* Timing, impact and projections as simple rows */}
                  <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 6 }]}>Your impact</Text>
                    {[
                      { label: 'Food kept from the trash', val: `${totalLbs} lb` },
                      { label: 'CO₂ avoided',               val: `${totalCo2} kg` },
                      { label: 'Water saved',               val: `${totalWater} L` },
                      ...(totalTracked >= 3 ? [
                        { label: 'Projected savings this year', val: `$${projSavedAnnual}` },
                        { label: 'Projected waste this year',   val: `$${projWasteAnnual}` },
                      ] : []),
                      ...(avgDaysWhenRescued !== null ? [{
                        label: 'You usually use food',
                        val: avgDaysWhenRescued >= 0 ? `${avgDaysWhenRescued}d before its date` : `${Math.abs(avgDaysWhenRescued)}d after its date`,
                      }] : []),
                    ].map((r, i) => (
                      <View key={r.label} style={[styles.statRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                        <Text style={{ flex: 1, fontSize: 13, color: colors.textSub }}>{r.label}</Text>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{r.val}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Repeat offenders */}
                  {repeatOffenders.length > 0 && (
                    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 4 }]}>Often goes bad</Text>
                      <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 8 }}>Items that went bad more than once</Text>
                      {repeatOffenders.map((r, i) => (
                        <View key={r.name} style={[styles.statRow, { alignItems: 'flex-start' }, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                          <View style={{ flex: 1, paddingRight: 10 }}>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{r.name}</Text>
                            <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2, lineHeight: 15 }}>{getTip(r.name)}</Text>
                          </View>
                          <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSub }}>{r.count}× · ${r.cost}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Tips */}
                  {coachingTips.length > 0 && (
                    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 6 }]}>Tips</Text>
                      {coachingTips.map((tip, i) => (
                        <View key={i} style={[styles.statRow, { flexDirection: 'column', alignItems: 'flex-start' }, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 2 }}>{tip.title}</Text>
                          <Text style={{ fontSize: 12, color: colors.textSub, lineHeight: 17 }}>{tip.body}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Streak */}
                  <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={styles.cardRow}>
                      <Text style={[styles.cardHeading, { color: colors.text }]}>Daily streak</Text>
                      <Text style={{ fontSize: 13, color: colors.textSub }}>{streak} day{streak !== 1 ? 's' : ''} · best {longestStreak}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                      {weekBoxes.map((box, i) => (
                        <View
                          key={i}
                          style={[
                            styles.streakBox,
                            { backgroundColor: box.isFuture ? colors.surfaceAlt : box.active ? (box.isToday ? colors.btnPrimary : colors.goneGoodBg) : colors.surfaceAlt },
                          ]}
                        >
                          <Text style={[styles.streakMark, { color: box.isFuture ? colors.textMuted : box.active ? (box.isToday ? 'white' : colors.goneGoodText) : colors.textMuted }]}>
                            {box.isFuture ? '·' : box.active ? '✓' : '–'}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </>
              )}

              {/* ── History ── */}
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.cardHeading, { color: colors.text, marginBottom: 12 }]}>History</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                  {([
                    { key: 'good', label: `Used (${goodList.length || stats.goneGood})` },
                    { key: 'bad',  label: `Went bad (${badList.length})` },
                  ] as const).map(t => (
                    <TouchableOpacity
                      key={t.key}
                      style={[styles.histPill, raised(isDark), { backgroundColor: histTab === t.key ? colors.btnPrimary : colors.surface }]}
                      onPress={() => { setHistTab(t.key); setHistShowAll(false); }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.histPillText, { color: histTab === t.key ? 'white' : colors.textSub }]}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {histTab === 'good' ? (
                  displayGood.length === 0 ? (
                    <View style={{ alignItems: 'center', paddingVertical: 20, gap: 6 }}>
                      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
                        {stats.goneGood > 0
                          ? `${stats.goneGood} item${stats.goneGood !== 1 ? 's' : ''} used in total`
                          : 'Nothing used yet this period'}
                      </Text>
                      <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center' }}>
                        Items you use up from your inventory will show here.
                      </Text>
                    </View>
                  ) : displayGood.map((entry, i) => {
                    const hk = `good-${entry.id}-${entry.date}`;
                    return (
                      <HistRow
                        key={hk}
                        entry={entry}
                        isLast={i === displayGood.length - 1}
                        good
                        expanded={expandedHistKey === hk}
                        onToggle={() => setExpandedHistKey(expandedHistKey === hk ? null : hk)}
                        onRestore={() => openRestore(entry, 'good')}
                        onEdit={() => openEdit(entry, 'good')}
                        onDelete={() => handleDeleteHistEntry(entry, 'good')}
                        colors={colors}
                        styles={styles}
                      />
                    );
                  })
                ) : (
                  displayBad.length === 0 ? (
                    <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                      <Text style={{ color: colors.textSub, fontSize: 13 }}>Nothing has gone bad. Nice work.</Text>
                    </View>
                  ) : displayBad.map((entry, i) => {
                    const hk = `bad-${entry.id}-${entry.date}`;
                    return (
                      <HistRow
                        key={hk}
                        entry={entry}
                        isLast={i === displayBad.length - 1}
                        good={false}
                        expanded={expandedHistKey === hk}
                        onToggle={() => setExpandedHistKey(expandedHistKey === hk ? null : hk)}
                        onRestore={() => openRestore(entry, 'bad')}
                        onEdit={() => openEdit(entry, 'bad')}
                        onDelete={() => handleDeleteHistEntry(entry, 'bad')}
                        colors={colors}
                        styles={styles}
                      />
                    );
                  })
                )}

                {(() => {
                  const list = histTab === 'good' ? goodList : badList;
                  if (list.length <= HIST_PAGE) return null;
                  return (
                    <TouchableOpacity onPress={() => setHistShowAll(p => !p)} style={{ alignItems: 'center', paddingTop: 12 }}>
                      <Text style={{ color: colors.textSub, fontSize: 13, fontWeight: '600' }}>
                        {histShowAll ? 'Show less' : `Show all ${list.length}`}
                      </Text>
                    </TouchableOpacity>
                  );
                })()}
              </View>

              {/* ── Share ── */}
              <TouchableOpacity style={styles.shareCta} onPress={() => setShareVisible(true)} activeOpacity={0.85}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shareCtaTitle}>Share your food report</Text>
                  <Text style={styles.shareCtaSub}>The good and the bad, the full picture</Text>
                </View>
                <Text style={{ color: 'white', fontSize: 22 }}>›</Text>
              </TouchableOpacity>

              {/* ── Clear all data ── */}
              <TouchableOpacity style={styles.clearDataBtn} onPress={handleClearAllData} activeOpacity={0.7}>
                <Text style={[styles.clearDataText, { color: colors.textMuted }]}>Clear all data</Text>
              </TouchableOpacity>

              </Animated.View>{/* end cards group */}

            </>
          )}
        </Animated.ScrollView>
        {/* Content fades out under the header, like the inventory list */}
        <EdgeFade color={colors.bg} edge="top" height={36} />
        </View>

        {/* Paywall intercept — covers tabs + content, not the header */}
        {!isPremium && (
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={() => showPaywall()}
            activeOpacity={1}
          />
        )}

        </View>{/* end content area */}
      </Animated.View>

      {/* ── Share modal ── */}
      {shareMounted && (
        <Modal visible={shareMounted} transparent animationType="none" onRequestClose={() => setShareVisible(false)}>
          <View style={{ flex: 1 }}>
            <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)', opacity: shareOverlayAnim }]} />
            <TouchableOpacity style={{ flex: 1 }} onPress={() => setShareVisible(false)} activeOpacity={1} />

            <Animated.View style={[styles.shareSheet, { backgroundColor: colors.surface, transform: [{ translateY: shareSheetAnim }] }]}>
              <View style={{ width: 36, height: 4, backgroundColor: colors.border, borderRadius: 999, alignSelf: 'center', marginBottom: 4 }} />

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 44 }}>
              <View ref={previewRef} style={styles.sharePreview} collapsable={false}>
                {/* Decorative blobs */}
                <View style={styles.previewBlob1} />
                <View style={styles.previewBlob2} />
                <View style={styles.previewBlob3} />
                <View style={styles.previewBlob4} />

                {/* Top bar: branding + period pill */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={styles.previewBrandTop}>go<Text style={{ color: GOOD }}>good</Text></Text>
                  <View style={styles.previewPeriodPill}>
                    <Text style={styles.previewPeriodPillText}>{periodLabelLower.toUpperCase()}</Text>
                  </View>
                </View>

                {/* Hero section */}
                <View style={{ alignItems: 'center', gap: 6, flex: 1, justifyContent: 'center' }}>
                  <Text style={styles.previewHeroLabel}>food rescued</Text>
                  <Text style={styles.previewHeroVal}>${goneGoodDollars}</Text>
                  <Text style={styles.previewHeroSub}>{goneGoodCount} item{goneGoodCount !== 1 ? 's' : ''} saved from the bin</Text>
                </View>

                {/* Stat pills row */}
                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={styles.previewStatPillGood}>
                      <View>
                        <Text style={styles.previewStatPillVal}>${goneGoodDollars}</Text>
                        <Text style={styles.previewStatPillLabel}>gone good</Text>
                      </View>
                    </View>
                    <View style={styles.previewStatPillBad}>
                      <View>
                        <Text style={[styles.previewStatPillVal, { color: BAD }]}>${goneBadDollars}</Text>
                        <Text style={styles.previewStatPillLabel}>gone bad</Text>
                      </View>
                    </View>
                  </View>
                  <View style={[styles.previewNetBadge, { backgroundColor: netScore >= 0 ? 'rgba(93,202,165,0.18)' : 'rgba(232,117,106,0.18)' }]}>
                    <Text style={[styles.previewNetBadgeText, { color: netScore >= 0 ? GOOD : BAD }]}>
                      {netScore >= 0 ? '+' : '-'}${Math.abs(netScore)} net score
                    </Text>
                  </View>
                </View>
              </View>

              <Text style={[styles.shareTitle, { color: colors.text }]}>Share your food report</Text>

              <View style={[styles.captionBox, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                <Text style={[styles.captionLabel, { color: colors.teal }]}>CAPTION</Text>
                <Text style={[styles.captionText, { color: colors.textSub }]}>{shareCaption}</Text>
              </View>

              <Text style={[styles.shareSub, { color: colors.textMuted }]}>Pick where to share</Text>

              {[
                [
                  { icon: '', label: 'Instagram' },
                  { icon: '', label: 'Twitter/X' },
                  { icon: '', label: 'Facebook' },
                ],
                [
                  { icon: '', label: 'TikTok' },
                  { icon: '', label: 'Messages' },
                  { icon: '', label: 'More' },
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
              </ScrollView>
            </Animated.View>
          </View>
          <DialogHost />
        </Modal>
      )}
      {/* ── Itemized Waste Sheet ── */}
      <HistSheet visible={wasteSheetVisible} onClose={() => setWasteSheetVisible(false)} colors={colors}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 2, fontFamily: 'Fraunces_600SemiBold' }}>Wasted This Month</Text>
        <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>
          {new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}
        </Text>
        {thisMonthBad.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 24, gap: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.teal }}>Nothing wasted!</Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center' }}>Keep up the great work this month.</Text>
          </View>
        ) : (
          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            {thisMonthBad.map((entry, i) => (
              <View
                key={`waste-${entry.id}-${entry.date}`}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: i < thisMonthBad.length - 1 ? 0.5 : 0, borderBottomColor: colors.border, gap: 12 }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '500', color: colors.text }}>{entry.name}</Text>
                  <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>
                    {timeAgo(entry.date)}{entry.category ? ` · ${entry.category}` : ''}
                  </Text>
                </View>
                <Text style={{ fontSize: 13, fontWeight: '600', color: BAD }}>~${estimatePrice(entry.name)}</Text>
              </View>
            ))}
          </ScrollView>
        )}
        {thisMonthBad.length > 0 && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, marginTop: 4, borderTopWidth: 0.5, borderTopColor: colors.border }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textSub }}>Total wasted this month</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: BAD }}>${thisMonthWastedDollars}</Text>
          </View>
        )}
        <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 12, marginTop: 4 }} onPress={() => setWasteSheetVisible(false)}>
          <Text style={{ fontSize: 13, color: colors.textMuted }}>close</Text>
        </TouchableOpacity>
      </HistSheet>

      {/* ── Restore to inventory sheet ── */}
      <HistSheet visible={restoreVisible} onClose={() => setRestoreVisible(false)} colors={colors}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4, fontFamily: 'Fraunces_600SemiBold' }}>Restore to inventory</Text>
        <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16, lineHeight: 18 }}>
          The item will be added back to your inventory and removed from history.
        </Text>

        <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Item name</Text>
        <TextInput
          style={{ borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: colors.inputText, backgroundColor: colors.inputBg, borderColor: colors.inputBorder, marginBottom: 4 }}
          value={restoreName}
          onChangeText={setRestoreName}
          placeholder="Item name"
          placeholderTextColor={colors.placeholder}
          autoCorrect={false}
        />

        <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 14 }}>Storage location</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 22 }}>
          {(['fridge', 'freezer', 'pantry'] as const).map(loc => (
            <TouchableOpacity key={loc} onPress={() => setRestoreLoc(loc)}
              style={{ flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', gap: 4, backgroundColor: restoreLoc === loc ? colors.btnPrimary : colors.surfaceAlt, borderWidth: 1, borderColor: restoreLoc === loc ? colors.btnPrimary : colors.border }}>
                            <Text style={{ fontSize: 11, fontWeight: '500', color: restoreLoc === loc ? 'white' : colors.textSub, textTransform: 'capitalize' }}>{loc}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={{ backgroundColor: colors.btnPrimary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
          onPress={handleRestoreItem}
        >
          <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Restore to inventory →</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 12 }} onPress={() => setRestoreVisible(false)}>
          <Text style={{ fontSize: 13, color: colors.textMuted }}>cancel</Text>
        </TouchableOpacity>
      </HistSheet>

      {/* ── Edit history entry sheet ── */}
      <HistSheet visible={editVisible} onClose={() => setEditVisible(false)} colors={colors}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4, fontFamily: 'Fraunces_600SemiBold' }}>Edit entry</Text>
        <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>
          Update the name for this history record.
        </Text>

        <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Item name</Text>
        <TextInput
          style={{ borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: colors.inputText, backgroundColor: colors.inputBg, borderColor: colors.inputBorder, marginBottom: 22 }}
          value={editName}
          onChangeText={setEditName}
          placeholder="Item name"
          placeholderTextColor={colors.placeholder}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleSaveEdit}
          autoCorrect={false}
        />

        <TouchableOpacity
          style={{ backgroundColor: colors.btnPrimary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', opacity: editName.trim() ? 1 : 0.5 }}
          onPress={handleSaveEdit}
          disabled={!editName.trim()}
        >
          <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Save changes →</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 12 }} onPress={() => setEditVisible(false)}>
          <Text style={{ fontSize: 13, color: colors.textMuted }}>cancel</Text>
        </TouchableOpacity>
      </HistSheet>

      {/* ── Grade detail sheet ── */}
      {(() => {
        const gs = gradeSheetVisible
          ? getGradeSummary(grade, efficiencyScore, rescueRate, streak, momentumDelta, atRiskItems, repeatOffenders, worstCat, totalTracked, goneGoodCount, goneBadCount, period, goalProgress)
          : null;
        return (
          <HistSheet visible={gradeSheetVisible} onClose={() => setGradeSheetVisible(false)} colors={colors}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: grade.color + '20', borderWidth: 2.5, borderColor: grade.color, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 26, fontWeight: '800', color: grade.color }}>{grade.grade}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 20, fontWeight: '700', color: grade.color, fontFamily: 'Fraunces_600SemiBold' }}>{grade.label}</Text>
                <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>Score: {efficiencyScore}/100 · {periodLabelLower}</Text>
              </View>
            </View>

            <Text style={{ fontSize: 14, color: colors.textSub, lineHeight: 21, marginBottom: 18 }}>{gs?.summary}</Text>

            {gs && gs.strengths.length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: colors.teal, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>What's working</Text>
                <View style={{ gap: 8 }}>
                  {gs.strengths.map((s, i) => (
                    <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: 'rgba(93,202,165,0.08)', borderRadius: 10, padding: 10 }}>
                      <Text style={{ fontSize: 13, color: colors.teal, fontWeight: '700', lineHeight: 19 }}>✓</Text>
                      <Text style={{ fontSize: 13, color: colors.text, lineHeight: 19, flex: 1 }}>{s}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {gs && gs.improvements.length > 0 && (
              <View style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: AMBER, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>How to improve</Text>
                <View style={{ gap: 8 }}>
                  {gs.improvements.map((tip, i) => (
                    <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: 10 }}>
                      <Text style={{ fontSize: 13, color: AMBER, fontWeight: '700', lineHeight: 19 }}>{i + 1}.</Text>
                      <Text style={{ fontSize: 13, color: colors.text, lineHeight: 19, flex: 1 }}>{tip}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {gs && gs.improvements.length === 0 && (
              <View style={{ backgroundColor: 'rgba(93,202,165,0.08)', borderRadius: 10, padding: 12, alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: colors.teal, fontWeight: '600', textAlign: 'center' }}>You're doing everything right — keep it up!</Text>
              </View>
            )}

            <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 14, marginTop: 4 }} onPress={() => setGradeSheetVisible(false)}>
              <Text style={{ fontSize: 13, color: colors.textMuted }}>close</Text>
            </TouchableOpacity>
          </HistSheet>
        );
      })()}

      {drawerEl}
    </View>
  );
}

// ── History row component ─────────────────────────────────────────────────────

function HistRow({ entry, isLast, good, expanded, onToggle, onRestore, onEdit, onDelete, colors, styles }: {
  entry: HistoryEntry;
  isLast: boolean;
  good: boolean;
  expanded: boolean;
  onToggle: () => void;
  onRestore: () => void;
  onEdit: () => void;
  onDelete: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
}) {
  const price = estimatePrice(entry.name);
  const { isDark } = useTheme();
  return (
    <View>
      <TouchableOpacity
        style={[styles.histRow, { borderBottomColor: colors.border, borderBottomWidth: 0.5 }]}
        onPress={onToggle}
        activeOpacity={0.7}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.histName, { color: colors.text }]}>{entry.name}</Text>
          <Text style={[styles.histSub, { color: colors.textMuted }]}>
            {good
              ? entry.portion ? `used ${entry.portion}` : 'used'
              : 'went bad'
            } · {timeAgo(entry.date)}
            {entry.category ? ` · ${entry.category}` : ''}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={[styles.histBadge, { backgroundColor: good ? colors.goneGoodBg : colors.goneBadBg }]}>
            <Text style={[styles.histBadgeText, { color: good ? colors.goneGoodText : colors.goneBadText }]}>
              ${price}
            </Text>
          </View>
          <Text style={{ fontSize: 18, color: colors.textMuted, transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}>›</Text>
        </View>
      </TouchableOpacity>
      {expanded && (
        <View style={{ flexDirection: 'row', gap: 7, paddingVertical: 10, paddingHorizontal: 2, borderBottomWidth: isLast ? 0 : 0.5, borderBottomColor: colors.border }}>
          {[
            { label: 'Restore', onPress: onRestore },
            { label: 'Edit',    onPress: onEdit },
            { label: 'Delete',  onPress: onDelete },
          ].map(b => (
            <TouchableOpacity
              key={b.label}
              style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 36, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.surface }, raised(isDark)]}
              onPress={b.onPress}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSub }}>{b.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

function createStyles(c: ThemeColors, isDark = false) { return StyleSheet.create({
  safe:          { flex: 1 },
  container:     { flex: 1 },

  header:        { backgroundColor: c.bg, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logo:          { fontSize: 28, fontWeight: '700', color: c.brand, fontFamily: 'Fraunces_600SemiBold' },
  logoGreen:     { color: c.teal, fontFamily: 'Fraunces_600SemiBold' },

  tabRow: { flexDirection: 'row', marginHorizontal: 16, marginVertical: 12, borderRadius: 14, padding: 4 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 11, alignItems: 'center' },
  tabBtnActive: { backgroundColor: c.surface },
  tabBtnText:    { fontSize: 13 },

  // Hero
  heroCard: { backgroundColor: c.btnPrimary, borderRadius: 20, padding: 20, ...raisedGreen(isDark) },
  heroCircle1:   { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(255,255,255,0.05)', top: -60, right: -60 },
  heroCircle2:   { position: 'absolute', width: 160, height: 160, borderRadius: 80,  backgroundColor: 'rgba(93,202,165,0.08)', bottom: -40, left: -40 },
  heroCircle3:   { position: 'absolute', width: 110, height: 110, borderRadius: 55,  backgroundColor: 'rgba(255,255,255,0.04)', top: 80, right: -20 },
  heroPeriodTag: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.7)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 14 },
  heroSplit: { flexDirection: 'row', marginBottom: 18 },
  heroDivider: { width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 18, alignSelf: 'stretch' },
  heroTag:       { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.75)', marginBottom: 4 },
  heroVal:       { fontSize: 34, fontWeight: '700', color: 'white', lineHeight: 40 },
  heroBarTrack:  { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  heroBarFill:   { height: '100%', borderRadius: 3, backgroundColor: 'white' },
  heroBarLabel:  { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 8 },
  pill:          { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText:      { fontSize: 12, fontWeight: '600' },
  insightsToggle:{ borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', gap: 2 },
  statRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  heroGoodTag:   { fontSize: 9, color: GOOD, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  heroBadTag:    { fontSize: 9, color: BAD, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  heroGoodVal:   { fontSize: 42, fontWeight: '700', color: 'white', lineHeight: 48 },
  heroBadVal:    { fontSize: 42, fontWeight: '700', color: BAD, lineHeight: 48 },
  heroSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  netRow:        { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  netLabel:      { fontSize: 12, color: 'rgba(255,255,255,0.5)' },
  netVal:        { fontSize: 16, fontWeight: '700' },
  heroStatRow:   { flexDirection: 'row', gap: 8 },
  heroStatCell:  { flex: 1, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10, paddingVertical: 10, alignItems: 'center', gap: 4 },
  heroStatVal:   { fontSize: 16, fontWeight: '700', color: 'white' },
  heroStatLabel: { fontSize: 8, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5 },

  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: isDark ? 0.3 : 0.07, shadowRadius: 10, elevation: 2 },
  cardRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardHeading: { fontSize: 15, fontWeight: '700' },

  // Week-over-week
  wowCard:       { flex: 1, borderRadius: 12, padding: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 10, elevation: 4 },
  wowLabel:      { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  wowRow:        { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wowDot:        { fontSize: 12 },
  wowVal:        { fontSize: 15, fontWeight: '700' },
  wowSub:        { fontSize: 10 },
  wowNetRow:     { paddingHorizontal: 8, paddingVertical: 5, marginTop: 2 },
  wowNetVal:     { fontSize: 13, fontWeight: '700', textAlign: 'center' },

  // Environmental impact
  impactCell:    { flex: 1, padding: 10, alignItems: 'center', gap: 3 },
  impactVal:     { fontSize: 16, fontWeight: '700', marginTop: 2 },
  impactLabel:   { fontSize: 10, fontWeight: '600', textAlign: 'center' },
  impactSub:     { fontSize: 9, textAlign: 'center' },

  botAvatar:     { width: 46, height: 46, borderRadius: 23, backgroundColor: c.btnPrimary, alignItems: 'center', justifyContent: 'center' },
  botLabel:      { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  botText:       { fontSize: 14, lineHeight: 20, fontFamily: 'Fraunces_400Regular' },
  botLink:       { fontSize: 13, fontWeight: '600', marginTop: 10 },

  goalTrack:     { height: 8, borderRadius: 999, overflow: 'hidden', marginBottom: 10 },
  goalFill:      { height: '100%', backgroundColor: c.teal, borderRadius: 999 },
  goalInput:     { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, fontSize: 14, width: 70, textAlign: 'center' },

  streakBox:     { flex: 1, aspectRatio: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  streakMark:    { fontSize: 14, fontWeight: '700' },

  histPill: { flex: 1, paddingVertical: 9, borderRadius: 12, alignItems: 'center' },
  histPillText:  { fontSize: 12, fontWeight: '600' },
  histRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  histIconWrap:  { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  histName:      { fontSize: 13, fontWeight: '500' },
  histSub:       { fontSize: 11, marginTop: 2 },
  histBadge:     { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  histBadgeText: { fontSize: 10, fontWeight: '600' },

  shareCta: { backgroundColor: c.btnPrimary, borderRadius: 16, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14, ...raisedGreen(isDark) },
  shareCtaTitle: { fontSize: 15, fontWeight: '700', color: 'white' },
  shareCtaSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },

  shareSheet:          { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 14, maxHeight: '88%' },
  sharePreview:        { backgroundColor: '#085041', borderRadius: 24, aspectRatio: 4/5, width: '100%', overflow: 'hidden', padding: 22, justifyContent: 'space-between' }, // always dark forest green for branding
  previewBlob1:        { position: 'absolute', width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(93,202,165,0.12)', top: -100, right: -100 },
  previewBlob2:        { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(255,255,255,0.05)', bottom: -60, left: -80 },
  previewBlob3:        { position: 'absolute', width: 140, height: 140, borderRadius: 70,  backgroundColor: 'rgba(29,158,117,0.15)', top: 120, right: -40 },
  previewBlob4:        { position: 'absolute', width: 80,  height: 80,  borderRadius: 40,  backgroundColor: 'rgba(93,202,165,0.1)',  top: 60,  left: 20 },
  previewBrandTop:     { fontSize: 20, fontWeight: '700', color: 'white', fontFamily: 'Fraunces_600SemiBold' },
  previewPeriodPill:   { backgroundColor: 'rgba(93,202,165,0.2)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(93,202,165,0.35)' },
  previewPeriodPillText: { fontSize: 9, fontWeight: '700', color: GOOD, letterSpacing: 1.2 },
  previewHeroEmoji:    { fontSize: 48 },
  previewHeroLabel:    { fontSize: 12, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: '600' },
  previewHeroVal:      { fontSize: 64, fontWeight: '700', color: GOOD, lineHeight: 70, fontFamily: 'Fraunces_600SemiBold' },
  previewHeroSub:      { fontSize: 13, color: 'rgba(255,255,255,0.55)', fontFamily: 'Fraunces_400Regular' },
  previewStatPillGood: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(93,202,165,0.15)', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(93,202,165,0.25)' },
  previewStatPillBad:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(232,117,106,0.12)', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(232,117,106,0.25)' },
  previewStatPillIcon: { fontSize: 20 },
  previewStatPillVal:  { fontSize: 17, fontWeight: '700', color: GOOD },
  previewStatPillLabel:{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontWeight: '600', marginTop: 1 },
  previewNetBadge:     { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center' },
  previewNetBadgeText: { fontSize: 15, fontWeight: '700' },

  shareTitle:      { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  shareSub:        { fontSize: 13, textAlign: 'center', marginTop: -4 },
  captionBox:      { borderRadius: 12, borderWidth: 0.5, padding: 12, gap: 4 },
  captionLabel:    { fontSize: 8, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  captionText:     { fontSize: 12, lineHeight: 17, fontFamily: 'Fraunces_400Regular' },
  platformBtn:     { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 14, gap: 5, borderWidth: 0.5 },
  platformLabel:   { fontSize: 10, fontWeight: '600' },

  clearDataBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  clearDataText:   { fontSize: 13, fontWeight: '500' },
}); }
