import React, { useRef, useEffect, useState, useMemo } from 'react';
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
import { useTheme, type ThemeColors } from '../context/theme';
import { raised, raisedGreen } from '@/components/raised';

const STORE = Platform.OS === 'android'
  ? { account: 'Google Play account', settings: 'Google Play subscription settings' }
  : { account: 'Apple ID',            settings: 'App Store account settings' };

const { height: SCREEN_H } = Dimensions.get('window');

// What Pro includes. `free` is what the free plan gets (false = Pro only).
const FEATURES: { icon: keyof typeof Ionicons.glyphMap; name: string; desc: string; free: string | false; yearlyOnly?: boolean; householdOnly?: boolean }[] = [
  { icon: 'nutrition-outline',     name: 'Unlimited inventory', desc: 'Track everything in your fridge, freezer and pantry', free: '10 items' },
  { icon: 'sparkles-outline',      name: 'Good Bot',            desc: 'Recipes from what you have, and answers to food questions', free: false },
  { icon: 'barcode-outline',       name: 'Barcode and photo scans', desc: 'Unlimited barcodes, plus 60 receipt, label and photo scans a month', free: false },
  { icon: 'stats-chart-outline',   name: 'Food Report',         desc: 'See what you save and what goes to waste', free: false },
  { icon: 'book-outline',          name: 'Recipe collections',  desc: 'Save, sort and scale your recipes', free: false },
  { icon: 'notifications-outline', name: 'Expiry alerts',       desc: 'A heads-up before food goes bad', free: 'Included' },
  { icon: 'receipt-outline',       name: 'Receipt scan',        desc: 'Add a whole grocery trip at once', free: false },
  { icon: 'people-outline',        name: 'Share with your partner', desc: 'They get every Pro feature too', free: false, householdOnly: true },
];

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
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
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
  // Months free with the yearly plan vs paying monthly, from the real store prices
  // (rounded down, so it never overstates: $39.99 vs $4.99/mo pays for ~8 months = 4 free)
  const monthlyNum = monthlyPkg?.product.price ?? (household ? 6.99 : 4.99);
  const annualNum  = annualPkg?.product.price  ?? (household ? 59.99 : 39.99);
  const freeMonths = monthlyNum > 0 ? Math.floor(12 - annualNum / monthlyNum + 0.05) : 0;

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
          {/* Drag handle: the whole top strip is grabbable; swipe down to close */}
          <View {...panResponder.panHandlers} style={styles.handleZone}>
            <View style={styles.handle} />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 4 }}>
            {/* ── Heading ── */}
            <View style={styles.hero}>
              <View style={styles.heroIcon}>
                <Ionicons name={household ? 'people' : 'leaf'} size={24} color={colors.btnPrimaryText} />
              </View>
              <Text style={styles.logo}>
                go<Text style={styles.logoGreen}>good</Text> {household ? 'household' : 'pro'}
              </Text>
              <Text style={styles.heroSub}>
                {household ? 'Every Pro feature for you and your partner' : 'Waste less, cook more, with everything unlocked'}
              </Text>
            </View>

            {/* ── Just me / Household: the same switch as the inventory tabs ── */}
            <View style={styles.segment}>
              {([
                { key: 'solo',      label: 'Just me',   icon: 'person-outline' },
                { key: 'household', label: 'Household', icon: 'people-outline' },
              ] as const).map(k => {
                const on = kind === k.key;
                return (
                  <TouchableOpacity key={k.key} style={[styles.segmentBtn, on && styles.segmentBtnOn]} onPress={() => setKind(k.key)} activeOpacity={0.85}>
                    <Ionicons name={k.icon} size={15} color={on ? colors.text : colors.textSub} />
                    <Text style={[styles.segmentText, { color: on ? colors.text : colors.textSub }]}>{k.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {household && (
              <Text style={styles.kindNote}>You plus one partner. They join free from your invite.</Text>
            )}

            {/* ── Plans ── */}
            <View style={styles.planRow}>
              {([
                { key: 'monthly', name: 'Monthly', price: monthlyPrice, sub: 'per month' },
                { key: 'annual',  name: 'Yearly',  price: annualPrice,  sub: freeMonths > 0 ? `${freeMonths} month${freeMonths !== 1 ? 's' : ''} free` : 'Best value' },
              ] as const).map(pl => {
                const on = selected === pl.key;
                return (
                  <TouchableOpacity key={pl.key} style={[styles.planCard, on && styles.planCardOn]} onPress={() => setSelected(pl.key)} activeOpacity={0.85}>
                    {pl.key === 'annual' && (
                      <Animated.View style={[styles.bestBadge, { transform: [{ scale: badgeScale }] }]}>
                        <Text style={styles.bestBadgeTxt}>Best value</Text>
                      </Animated.View>
                    )}
                    <View style={styles.planTop}>
                      <Text style={[styles.planName, on && { color: colors.chipText }]}>{pl.name}</Text>
                      <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={on ? colors.btnPrimary : colors.textMuted} />
                    </View>
                    <Text style={styles.planPrice}>{pl.price}</Text>
                    <Text style={[styles.planSub, pl.key === 'annual' && { color: colors.teal, fontWeight: '700' }]}>{pl.sub}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* ── What you get ── */}
            <Text style={styles.sectionLabel}>What you get</Text>
            <View style={styles.featureCard}>
              {FEATURES.filter(f => !f.householdOnly || household).map((f, i) => {
                const locked = f.yearlyOnly && selected !== 'annual';
                return (
                  <View key={f.name} style={[styles.featureRow, i > 0 && styles.featureRowBorder]}>
                    <View style={[styles.featureIcon, locked && { opacity: 0.45 }]}>
                      <Ionicons name={f.icon} size={17} color={colors.chipText} />
                    </View>
                    <View style={{ flex: 1, opacity: locked ? 0.5 : 1 }}>
                      <Text style={styles.featureName}>{f.name}</Text>
                      <Text style={styles.featureDesc}>{f.desc}</Text>
                    </View>
                    {f.yearlyOnly
                      ? <View style={styles.tag}><Text style={styles.tagText}>Yearly</Text></View>
                      : f.free === false
                        ? <Ionicons name="checkmark-circle" size={20} color={colors.teal} />
                        : <Text style={styles.freeNote}>Free: {f.free}</Text>}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          {/* CTA */}
          <Animated.View style={{ transform: [{ scale: ctaScale }] }}>
            <TouchableOpacity
              style={[styles.cta, (purchasing || noPackages) && { opacity: 0.6 }]}
              onPress={handlePurchase}
              disabled={purchasing}
              activeOpacity={0.85}
            >
              {purchasing ? <ActivityIndicator color={colors.btnPrimaryText} /> : (
                <Text style={styles.ctaTxt}>
                  {`Subscribe · ${selected === 'annual' ? annualPrice + '/yr' : monthlyPrice + '/mo'}`}
                </Text>
              )}
            </TouchableOpacity>
          </Animated.View>
          <Text style={styles.cancelNote}>Cancel anytime in your {STORE.settings}.</Text>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity onPress={handleRestore} disabled={restoring}>
              {restoring
                ? <ActivityIndicator size="small" color={colors.teal} />
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

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: c.bg,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingHorizontal: 16,
    maxHeight: SCREEN_H * 0.92,
  },
  handleZone: { marginTop: -12, marginHorizontal: -16, paddingTop: 12, paddingBottom: 10, alignItems: 'center' },
  handle:     { width: 40, height: 5, borderRadius: 999, backgroundColor: c.borderStrong },

  // Heading
  hero:      { alignItems: 'center', paddingTop: 4, paddingBottom: 18 },
  heroIcon:  { width: 52, height: 52, borderRadius: 26, backgroundColor: c.btnPrimary, alignItems: 'center', justifyContent: 'center', marginBottom: 12, ...raisedGreen(isDark) },
  logo:      { fontSize: 28, color: c.brand, fontFamily: 'Fraunces_600SemiBold', textAlign: 'center' },
  logoGreen: { color: c.teal, fontFamily: 'Fraunces_600SemiBold' },
  heroSub:   { fontSize: 14, color: c.textSub, textAlign: 'center', marginTop: 6, lineHeight: 20, paddingHorizontal: 12 },

  // Just me / Household
  segment:      { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: c.surfaceAlt, marginBottom: 10 },
  segmentBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 11 },
  segmentBtnOn: { backgroundColor: c.surface, ...raised(isDark) },
  segmentText:  { fontSize: 13, fontWeight: '600' },
  kindNote:     { fontSize: 12, color: c.textSub, textAlign: 'center', marginBottom: 10, lineHeight: 17 },

  // Plans
  planRow:    { flexDirection: 'row', gap: 10, marginTop: 6, marginBottom: 20 },
  planCard:   { flex: 1, borderRadius: 16, padding: 14, backgroundColor: c.surface, borderWidth: 1.5, borderColor: 'transparent', ...raised(isDark, 'md') },
  // Green all the way round (the raised look otherwise tints the top and bottom edges)
  planCardOn: { backgroundColor: c.chipBg, borderColor: c.btnPrimary, borderTopColor: c.btnPrimary, borderBottomColor: c.btnPrimary, borderWidth: 1.5, borderBottomWidth: 1.5 },
  planTop:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  planName:   { fontSize: 13, fontWeight: '700', color: c.textSub },
  planPrice:  { fontSize: 22, fontWeight: '800', color: c.text },
  planSub:    { fontSize: 12, color: c.textSub, marginTop: 2 },
  bestBadge:  { position: 'absolute', top: -10, right: 12, backgroundColor: c.btnPrimary, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  bestBadgeTxt: { fontSize: 10, fontWeight: '800', color: c.btnPrimaryText, letterSpacing: 0.2 },

  // What you get
  sectionLabel:     { fontSize: 11, fontWeight: '700', color: c.textSub, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 },
  featureCard:      { backgroundColor: c.surface, borderRadius: 16, paddingHorizontal: 14, ...raised(isDark, 'md') },
  featureRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  featureRowBorder: { borderTopWidth: 0.5, borderTopColor: c.border },
  featureIcon:      { width: 34, height: 34, borderRadius: 17, backgroundColor: c.chipBg, alignItems: 'center', justifyContent: 'center' },
  featureName:      { fontSize: 14, fontWeight: '600', color: c.text },
  featureDesc:      { fontSize: 12, color: c.textSub, marginTop: 1, lineHeight: 16 },
  freeNote:         { fontSize: 11, color: c.textMuted, fontWeight: '500' },
  tag:              { backgroundColor: c.chipBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  tagText:          { fontSize: 10, fontWeight: '700', color: c.chipText },

  // Subscribe
  cta:        { backgroundColor: c.btnPrimary, borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 14, ...raisedGreen(isDark) },
  ctaTxt:     { fontSize: 16, fontWeight: '700', color: c.btnPrimaryText },
  cancelNote: { fontSize: 12, color: c.textSub, textAlign: 'center', marginTop: 8, marginBottom: 10 },

  footer:     { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 4 },
  footerLink: { fontSize: 12, color: c.textSub, fontWeight: '600' },
  footerDot:  { fontSize: 12, color: c.textMuted },
  legal:      { fontSize: 9, lineHeight: 13, color: c.textMuted, textAlign: 'center', marginTop: 6, marginBottom: 4, paddingHorizontal: 4 },
});
