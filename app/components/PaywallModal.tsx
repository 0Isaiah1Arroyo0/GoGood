import React, { useRef, useEffect, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, ScrollView,
  Animated, ActivityIndicator, StyleSheet, Dimensions,
  Alert, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type PurchasesPackage } from 'react-native-purchases';
import { useSubscription } from '../context/subscription';

const { height: SCREEN_H } = Dimensions.get('window');

type CellVal = boolean | string;

const FEATURES: { icon: string; name: string; free: CellVal; monthly: CellVal; annual: CellVal }[] = [
  { icon: '📦', name: 'Inventory',        free: '10 items',   monthly: 'Unlimited', annual: 'Unlimited' },
  { icon: '📷', name: 'Barcode scan',     free: false,         monthly: true,        annual: true        },
  { icon: '🔔', name: 'Expiry alerts',    free: true,          monthly: true,        annual: true        },
  { icon: '🤖', name: 'Good Bot AI',      free: false,         monthly: true,        annual: true        },
  { icon: '📊', name: 'Food Report',      free: false,         monthly: true,        annual: true        },
  { icon: '🏠', name: 'Household',        free: false,         monthly: true,        annual: true        },
  { icon: '📚', name: 'Collections',      free: false,         monthly: true,        annual: true        },
  { icon: '🧾', name: 'Receipt scan',     free: false,         monthly: false,       annual: true        },
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
    note:   id === 'ANNUAL' ? 'Save 2 months' : id === 'MONTHLY' ? 'monthly' : undefined,
  };
}

export default function PaywallModal() {
  const insets = useSafeAreaInsets();
  const { paywallVisible, hidePaywall, packages, purchase, restorePurchases } = useSubscription();

  const slideAnim  = useRef(new Animated.Value(SCREEN_H)).current;
  const fadeAnim   = useRef(new Animated.Value(0)).current;
  const sheetScale = useRef(new Animated.Value(0.96)).current;
  const ctaScale   = useRef(new Animated.Value(1)).current;
  const badgeScale = useRef(new Animated.Value(0)).current;

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

  const monthlyPrice = monthlyPkg ? packageLabel(monthlyPkg).price : '$4.99';
  const annualPrice  = annualPkg  ? packageLabel(annualPkg).price  : '$45.99';

  const dismiss = () => hidePaywall();

  const handlePurchase = async () => {
    if (!selectedPkg) return;
    Animated.sequence([
      Animated.spring(ctaScale, { toValue: 0.95, damping: 8, stiffness: 500, useNativeDriver: true }),
      Animated.spring(ctaScale, { toValue: 1,    damping: 10, stiffness: 300, useNativeDriver: true }),
    ]).start();
    setPurchasing(true);
    try { await purchase(selectedPkg); } catch { Alert.alert('Purchase failed', 'Please try again.'); }
    setPurchasing(false);
  };

  const handleRestore = async () => {
    setRestoring(true);
    const ok = await restorePurchases();
    setRestoring(false);
    if (ok) Alert.alert('Restored!', 'Your subscription has been restored.');
    else    Alert.alert('Nothing to restore', 'No active subscription found.');
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss}>
      <View style={{ flex: 1 }}>
        {/* Backdrop */}
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)', opacity: fadeAnim }]} pointerEvents="none" />
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={dismiss} />

        <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 16, transform: [{ translateY: slideAnim }, { scale: sheetScale }] }]}>
          <View style={styles.handle} />

          {/* ── Hero ── */}
          <View style={styles.heroBg}>
            <View style={styles.bubble1} />
            <View style={styles.bubble2} />
            <View style={styles.bubble3} />
            <View style={styles.hero}>
              <Text style={styles.logoLine}>
                <Text style={styles.logoGo}>go</Text><Text style={styles.logoPremium}>premium</Text>
              </Text>
              <Text style={styles.heroSub}>Unlock the full Go Good experience</Text>
            </View>
          </View>

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
              <Text style={[styles.planCardSub, selected === 'annual' && { color: 'rgba(255,209,102,0.65)' }]}>Save 2 months</Text>
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
                  <Text style={styles.rowIcon}>{f.icon}</Text>
                  <Text style={styles.rowName}>{f.name}</Text>
                </View>
                <View style={styles.planCol}><Cell val={f.free}    col="free"    /></View>
                <View style={[styles.planCol, selected === 'monthly' && styles.colSelectedBg]}>
                  <Cell val={f.monthly} col="monthly" />
                </View>
                <View style={[styles.planCol, selected === 'annual' && styles.colSelectedBgGold]}>
                  <Cell val={f.annual}  col="annual"  />
                </View>
              </View>
            ))}
          </ScrollView>

          {/* CTA */}
          <Animated.View style={{ transform: [{ scale: ctaScale }] }}>
            <TouchableOpacity
              style={[styles.cta, (purchasing || noPackages) && { opacity: 0.6 }, selected === 'annual' && styles.ctaGold]}
              onPress={handlePurchase}
              disabled={purchasing || noPackages}
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
            <Text style={styles.footerNote}>Auto-renews. Cancel anytime.</Text>
          </View>

          <TouchableOpacity style={styles.closeBtn} onPress={dismiss} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.closeTxt}>✕</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
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
  handle: {
    width: 36, height: 4, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center', marginBottom: 16,
  },
  closeBtn: {
    position: 'absolute', top: 20, right: 20,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeTxt: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '700' },

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

  footer:     { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 4 },
  footerLink: { fontSize: 12, color: '#1D9E75', fontWeight: '600' },
  footerDot:  { fontSize: 12, color: 'rgba(255,255,255,0.2)' },
  footerNote: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
});
