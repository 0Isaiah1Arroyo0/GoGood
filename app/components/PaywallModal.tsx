import React, { useRef, useEffect, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, ScrollView,
  Animated, ActivityIndicator, StyleSheet, Dimensions,
  Alert, Easing, Linking, Platform, PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type PurchasesPackage } from 'react-native-purchases';
import { useSubscription } from '../context/subscription';
import { TERMS_URL, PRIVACY_URL } from '../../constants/legal';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DialogHost, showAlert } from '@/components/dialog';

const STORE = Platform.OS === 'android'
  ? { account: 'Google Play account', settings: 'Google Play subscription settings' }
  : { account: 'Apple ID',            settings: 'App Store account settings' };

const { height: SCREEN_H } = Dimensions.get('window');

type CellVal = boolean | string;

const FEATURES: { icon: keyof typeof Ionicons.glyphMap; name: string; free: CellVal; monthly: CellVal; annual: CellVal }[] = [
  { icon: 'nutrition-outline', name: 'Inventory',        free: '10 items',   monthly: 'Unlimited', annual: 'Unlimited' },
  { icon: 'barcode-outline', name: 'Barcode scan',     free: false,         monthly: true,        annual: true        },
  { icon: 'notifications-outline', name: 'Expiry alerts',    free: true,          monthly: true,        annual: true        },
  { icon: 'sparkles-outline', name: 'Good Bot AI',      free: false,         monthly: true,        annual: true        },
  { icon: 'stats-chart-outline', name: 'Food Report',      free: false,         monthly: true,        annual: true        },
  { icon: 'home-outline', name: 'Share with partner', free: false,       monthly: 'Household', annual: 'Household' },
  { icon: 'book-outline', name: 'Collections',      free: false,         monthly: true,        annual: true        },
  { icon: 'receipt-outline', name: 'Receipt scan',     free: false,         monthly: false,       annual: true        },
];

function Cell({ val, col }: { val: CellVal; col: 'free' | 'monthly' | 'annual' }) {
  if (typeof val === 'string') {
    return (
      <Text
        style={[
          styles.cellText,
          col === 'monthly' && { color: '#1D9E75' },
          col === 'annual'  && { color: '#FFD166' },
          col === 'free'    && { color: 'rgba(255,255,255,0.45)' },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >{val}</Text>
    );
  }
  if (val) {
    return <Text style={[styles.check, col === 'annual' ? { color: '#FFD166' } : col === 'free' ? { color: 'rgba(255,255,255,0.35)' } : { color: '#1D9E75' }]}>✓</Text>;
  }
  return <Text style={styles.cross}>✕</Text>;
}

function packageLabel(pkg: PurchasesPackage): { period: string; price: string; note?: string } {
  const id = pkg.packageType;
  return {
    period: id === 'ANNUAL' ? 'Annual' : id === 'MONTHLY' ? 'Monthly' : pkg.product.title ?? id,
    price:  pkg.product.priceString,
    note:   id === 'ANNUAL' ? 'Save 33%' : id === 'MONTHLY' ? 'monthly' : undefined,
  };
}

export default function PaywallModal() {
  const insets = useSafeAreaInsets();
  const { paywallVisible, hidePaywall, packages: soloPackages, householdPackages, paywallKind, purchase, restorePurchases } = useSubscription();
  // Just me (Pro) or Household (Pro for you and one partner)
  const [kind, setKind] = useState<'solo' | 'household'>('solo');
  useEffect(() => { if (paywallVisible) setKind(paywallKind); }, [paywallVisible, paywallKind]);
  const household = kind === 'household';
  const packages = household ? householdPackages : soloPackages;

  const slideAnim  = useRef(new Animated.Value(SCREEN_H)).current;
  const fadeAnim   = useRef(new Animated.Value(0)).current;
  const sheetScale = useRef(new Animated.Value(0.96)).current;
  const ctaScale   = useRef(new Animated.Value(1)).current;
  const badgeScale = useRef(new Animated.Value(0)).current;

  // Swipe down on the top of the sheet to close it
  const hideRef = useRef(hidePaywall);
  hideRef.current = hidePaywall;
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
    onPanResponderMove: (_, g) => { slideAnim.setValue(Math.max(0, g.dy)); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 100 || g.vy > 0.8) hideRef.current();
      else Animated.spring(slideAnim, { toValue: 0, damping: 24, stiffness: 260, useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(slideAnim, { toValue: 0, damping: 24, stiffness: 260, useNativeDriver: true }).start();
    },
  })).current;

  const [mounted,    setMounted]    = useState(false);
  const [selected,   setSelected]   = useState<'monthly' | 'annual'>('annual');
  const [purchasing, setPurchasing] = useState(false);
  const [restoring,  setRestoring]  = useState(false);

  const runEntry = () => {
    slideAnim.setValue(SCREEN_H * 0.55);
    fadeAnim.setValue(0);
    sheetScale.setValue(0.95);
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1, duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0, damping: 32, stiffness: 280, mass: 0.85,
        useNativeDriver: true,
      }),
      Animated.spring(sheetScale, {
        toValue: 1, damping: 32, stiffness: 280, mass: 0.85,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const runExit = (onDone: () => void) => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0, duration: 200,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: SCREEN_H * 0.6, duration: 260,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(sheetScale, {
        toValue: 0.96, duration: 200,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(onDone);
  };

  useEffect(() => {
    if (paywallVisible) {
      setMounted(true);
    }
  }, [paywallVisible]);

  useEffect(() => {
    if (mounted && paywallVisible) {
      runEntry();
    } else if (mounted && !paywallVisible) {
      runExit(() => {
        setMounted(false);
      });
    }
  }, [mounted, paywallVisible]);

  useEffect(() => {
    if (selected === 'annual') {
      Animated.spring(badgeScale, { toValue: 1, damping: 12, stiffness: 280, useNativeDriver: true }).start();
    } else {
      Animated.spring(badgeScale, { toValue: 0, damping: 15, stiffness: 300, useNativeDriver: true }).start();
    }
  }, [selected]);

  if (!mounted) return null;

  const monthlyPkg = packages.find(p => p.packageType === 'MONTHLY');
  const annualPkg  = packages.find(p => p.packageType === 'ANNUAL');
  const noPackages = packages.length === 0;
  const selectedPkg = selected === 'annual' ? annualPkg : monthlyPkg;

  const monthlyPrice = monthlyPkg ? packageLabel(monthlyPkg).price : household ? '$6.99'  : '$4.99';
  const annualPrice  = annualPkg  ? packageLabel(annualPkg).price  : household ? '$59.99' : '$39.99';
  // How much the yearly plan saves against 12 months, from the real store prices
  const annualSavings = monthlyPkg && annualPkg && monthlyPkg.product.price > 0
    ? Math.round((1 - annualPkg.product.price / (monthlyPkg.product.price * 12)) * 100)
    : 33;

  const dismiss = () => hidePaywall();

  const handlePurchase = async () => {
    if (!selectedPkg) {
      showAlert(
        noPackages ? "Plans couldn't load" : 'Plan unavailable',
        noPackages
          ? 'Subscription plans could not be loaded. Check your connection and try again in a moment.'
          : `The ${selected} plan isn't available right now. Please choose the other plan.`,
      );
      return;
    }
    Animated.sequence([
      Animated.spring(ctaScale, { toValue: 0.95, damping: 8, stiffness: 500, useNativeDriver: true }),
      Animated.spring(ctaScale, { toValue: 1,    damping: 10, stiffness: 300, useNativeDriver: true }),
    ]).start();
    setPurchasing(true);
    try {
      const ok = await purchase(selectedPkg);
      if (!ok && __DEV__) {
        // Purchase finished (or was cancelled) but the "premium" entitlement isn't active.
        showAlert(
          'Not unlocked',
          'No premium access came back. If you completed the purchase, check that both products are attached to your entitlement in RevenueCat (Product catalog → Entitlements).',
        );
      }
    } catch (e: any) {
      showAlert('Purchase failed', e?.message ? String(e.message) : 'Please try again.');
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    const ok = await restorePurchases();
    setRestoring(false);
    if (ok) showAlert('Restored!', 'Your subscription has been restored.');
    else    showAlert('Nothing to restore', 'No active subscription found.');
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss}>
      <View style={{ flex: 1 }}>
        {/* Backdrop */}
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)', opacity: fadeAnim }]} pointerEvents="none" />
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={dismiss} />

        <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 16, transform: [{ translateY: slideAnim }, { scale: sheetScale }] }]}>
          {/* Drag handle — the whole top strip is grabbable; swipe down to close */}
          <View {...panResponder.panHandlers} style={styles.handleZone}>
            <View style={styles.handle} />
          </View>

          {/* ── Hero ── */}
          <View style={styles.heroBg}>
            <View style={styles.bubble1} />
            <View style={styles.bubble2} />
            <View style={styles.bubble3} />
            <View style={styles.hero}>
              <Text style={styles.logoLine}>
                <Text style={styles.logoGo}>go</Text><Text style={styles.logoPremium}>premium</Text>
              </Text>
              <Text style={styles.heroSub}>{household ? 'Every Pro feature for you and your partner' : 'Unlock the full Go Good experience'}</Text>
            </View>
          </View>

          {/* ── Just me / Household ── */}
          <View style={styles.kindRow}>
            {([
              { key: 'solo',      label: 'Just me',   icon: 'person-outline' },
              { key: 'household', label: 'Household', icon: 'people-outline' },
            ] as const).map(k => {
              const on = kind === k.key;
              return (
                <TouchableOpacity key={k.key} style={[styles.kindBtn, on && styles.kindBtnOn]} onPress={() => setKind(k.key)} activeOpacity={0.85}>
                  <Ionicons name={k.icon} size={14} color={on ? '#085041' : 'rgba(255,255,255,0.7)'} />
                  <Text style={[styles.kindText, on && { color: '#085041' }]}>{k.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {household && (
            <Text style={styles.kindNote}>You plus one partner. They join free from your invite and get every Pro feature.</Text>
          )}

          {/* ── Plan selector cards ── */}
          <View style={styles.planRow}>
            {/* Free */}
            <View style={styles.planCardFree}>
              <Text style={styles.planCardName}>Free</Text>
              <Text style={styles.planCardPrice}>$0</Text>
              <Text style={styles.planCardSub}>forever</Text>
            </View>
            {/* Monthly */}
            <TouchableOpacity
              style={[styles.planCard, selected === 'monthly' && styles.planCardGreen]}
              onPress={() => setSelected('monthly')}
              activeOpacity={0.82}
            >
              <Text style={[styles.planCardName, selected === 'monthly' && { color: '#5DCAA5' }]}>Monthly</Text>
              <Text style={[styles.planCardPrice, selected === 'monthly' && { color: '#5DCAA5' }]}>{monthlyPrice}</Text>
              <Text style={[styles.planCardSub, selected === 'monthly' && { color: 'rgba(93,202,165,0.65)' }]}>per month</Text>
            </TouchableOpacity>
            {/* Annual */}
            <TouchableOpacity
              style={[styles.planCard, selected === 'annual' && styles.planCardGold]}
              onPress={() => setSelected('annual')}
              activeOpacity={0.82}
            >
              <Animated.View style={[styles.bestBadge, { transform: [{ scale: badgeScale }] }]}>
                <Text style={styles.bestBadgeTxt}>BEST</Text>
              </Animated.View>
              <Text style={[styles.planCardName, selected === 'annual' && { color: '#FFD166' }]}>Annual</Text>
              <Text style={[styles.planCardPrice, selected === 'annual' && { color: '#FFD166' }]}>{annualPrice}</Text>
              <Text style={[styles.planCardSub, selected === 'annual' && { color: 'rgba(255,209,102,0.65)' }]}>{annualSavings > 0 ? `Save ${annualSavings}%` : 'Best value'}</Text>
            </TouchableOpacity>
          </View>

          {/* ── Column hint labels above table ── */}
          <View style={styles.tableHeader}>
            <View style={styles.featureCol} />
            <View style={styles.planCol}>
              <Text style={styles.colHeadFree}>FREE</Text>
            </View>
            <View style={[styles.planCol, selected === 'monthly' && styles.colSelectedBg]}>
              <Text style={[styles.colHead, selected === 'monthly' && styles.colHeadSelected]}>Month</Text>
            </View>
            <View style={[styles.planCol, selected === 'annual' && styles.colSelectedBgGold]}>
              <Text style={[styles.colHead, selected === 'annual' && { color: '#FFD166' }]}>Year</Text>
            </View>
          </View>

          {/* Feature rows — scrollable */}
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            {FEATURES.map((f, i) => (
              <View key={f.name} style={[styles.row, i % 2 === 0 && styles.rowAlt]}>
                <View style={styles.featureCol}>
                  <Ionicons name={f.icon} size={15} color="rgba(255,255,255,0.75)" />
                  <Text style={styles.rowName}>{f.name}</Text>
                </View>
                <View style={styles.planCol}><Cell val={f.free}    col="free"    /></View>
                <View style={[styles.planCol, selected === 'monthly' && styles.colSelectedBg]}>
                  <Cell val={f.name === 'Share with partner' ? household : f.monthly} col="monthly" />
                </View>
                <View style={[styles.planCol, selected === 'annual' && styles.colSelectedBgGold]}>
                  <Cell val={f.name === 'Share with partner' ? household : f.annual}  col="annual"  />
                </View>
              </View>
            ))}
          </ScrollView>

          {/* CTA */}
          <Animated.View style={{ transform: [{ scale: ctaScale }] }}>
            <TouchableOpacity
              style={[styles.cta, (purchasing || noPackages) && { opacity: 0.6 }, selected === 'annual' && styles.ctaGold]}
              onPress={handlePurchase}
              disabled={purchasing}
            >
              {purchasing ? <ActivityIndicator color={selected === 'annual' ? '#085041' : '#fff'} /> : (
                <Text style={[styles.ctaTxt, selected === 'annual' && { color: '#085041' }]}>
                  {`Subscribe · ${selected === 'annual' ? annualPrice + '/yr' : monthlyPrice + '/mo'}`}
                </Text>
              )}
            </TouchableOpacity>
          </Animated.View>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity onPress={handleRestore} disabled={restoring}>
              {restoring
                ? <ActivityIndicator size="small" color="#5DCAA5" />
                : <Text style={styles.footerLink}>Restore Purchases</Text>}
            </TouchableOpacity>
            <Text style={styles.footerDot}>·</Text>
            <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)}>
              <Text style={styles.footerLink}>Terms of Use</Text>
            </TouchableOpacity>
            <Text style={styles.footerDot}>·</Text>
            <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)}>
              <Text style={styles.footerLink}>Privacy Policy</Text>
            </TouchableOpacity>
          </View>

          {/* Required auto-renew disclosure (App Store Guideline 3.1.2) */}
          <Text style={styles.legal}>
            Go Good {household ? 'Household' : 'Premium'} is an auto-renewing subscription ({monthlyPrice}/month or {annualPrice}/year).
            Payment is charged to your {STORE.account} at confirmation of purchase. Your subscription renews
            automatically unless cancelled at least 24 hours before the end of the current period, and
            your account is charged for renewal within 24 hours prior to the end of the period. Manage or
            cancel anytime in your {STORE.settings}.
          </Text>

        </Animated.View>
      </View>
      <DialogHost />
    </Modal>
  );
}

const COL_W = 52;

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#085041',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingHorizontal: 16,
    maxHeight: SCREEN_H * 0.92,
  },
  handleZone: { marginTop: -12, marginHorizontal: -16, paddingTop: 12, paddingBottom: 16, alignItems: 'center' },
  handle: {
    width: 40, height: 5, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },

  // ── Hero ──
  heroBg: { overflow: 'hidden', borderRadius: 18, marginBottom: 14 },
  bubble1: { position: 'absolute', width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(29,158,117,0.13)', top: -90, right: -70 },
  bubble2: { position: 'absolute', width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.04)', bottom: -50, left: -60 },
  bubble3: { position: 'absolute', width: 140, height: 140, borderRadius: 70,  backgroundColor: 'rgba(255,209,102,0.07)', top: 10, left: 50 },
  hero: { alignItems: 'center', paddingTop: 22, paddingBottom: 22 },
  logoLine:    { textAlign: 'center', marginBottom: 8 },
  logoGo:      { fontSize: 32, fontWeight: '600', color: '#1D9E75', fontFamily: 'Fraunces_600SemiBold' },
  logoPremium: { fontSize: 32, fontWeight: '600', color: '#fff',    fontFamily: 'Fraunces_600SemiBold' },
  heroSub:     { fontSize: 13, color: 'rgba(255,255,255,0.5)', textAlign: 'center' },

  // ── Plan selector cards ──
  planRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  kindRow:   { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 10 },
  kindBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 11 },
  kindBtnOn: { backgroundColor: '#5DCAA5' },
  kindText:  { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.7)' },
  kindNote:  { fontSize: 12, color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginBottom: 12, lineHeight: 17 },
  planCardFree: {
    flex: 1, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  planCard: {
    flex: 1, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center', position: 'relative',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  planCardGreen: { backgroundColor: 'rgba(29,158,117,0.18)', borderColor: '#1D9E75' },
  planCardGold:  { backgroundColor: 'rgba(255,209,102,0.12)', borderColor: '#FFD166' },
  planCardName:  { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.35)', textAlign: 'center', marginBottom: 3, letterSpacing: 0.2 },
  planCardPrice: { fontSize: 16, fontWeight: '800', color: 'rgba(255,255,255,0.35)', textAlign: 'center' },
  planCardSub:   { fontSize: 9,  fontWeight: '500', color: 'rgba(255,255,255,0.22)', textAlign: 'center', marginTop: 3 },

  // ── Table column hint row ──
  tableHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 10, paddingBottom: 8,
    borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.08)',
    marginBottom: 2,
  },
  featureCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  planCol:    { width: COL_W, alignItems: 'center', paddingVertical: 4, borderRadius: 8 },

  colHeadFree:     { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.25)', textAlign: 'center', letterSpacing: 0.5 },
  colHead:         { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.4)',  textAlign: 'center', letterSpacing: 0.5 },
  colHeadSelected: { color: '#1D9E75' },

  colSelectedBg:     { backgroundColor: 'rgba(29,158,117,0.14)' },
  colSelectedBgGold: { backgroundColor: 'rgba(255,209,102,0.08)' },

  bestBadge: {
    position: 'absolute', top: -10, alignSelf: 'center',
    backgroundColor: '#FFD166', borderRadius: 5,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  bestBadgeTxt: { fontSize: 8, fontWeight: '900', color: '#085041', letterSpacing: 0.6 },

  row:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  rowAlt:  { backgroundColor: 'rgba(255,255,255,0.025)', borderRadius: 8 },
  rowIcon: { fontSize: 14 },
  rowName: { fontSize: 12, fontWeight: '500', color: 'rgba(255,255,255,0.8)', flex: 1 },

  cellText: { fontSize: 8, fontWeight: '600', textAlign: 'center' },
  check:    { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  cross:    { fontSize: 13, color: 'rgba(255,255,255,0.15)', textAlign: 'center', fontWeight: '700' },

  cta:     { backgroundColor: '#1D9E75', borderRadius: 16, paddingVertical: 15, alignItems: 'center', marginTop: 12, marginBottom: 10 },
  ctaGold: { backgroundColor: '#FFD166' },
  ctaTxt:  { fontSize: 15, fontWeight: '800', color: '#085041' },

  footer:     { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 4 },
  footerLink: { fontSize: 12, color: '#1D9E75', fontWeight: '600' },
  footerDot:  { fontSize: 12, color: 'rgba(255,255,255,0.2)' },
  footerNote: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  legal:      { fontSize: 9, lineHeight: 13, color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 6, marginBottom: 4, paddingHorizontal: 4 },
});
