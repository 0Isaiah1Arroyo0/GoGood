import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases, {
  type CustomerInfo,
  type PurchasesPackage,
} from 'react-native-purchases';
import { useAuth } from './auth';
import { HOUSEHOLD_ROLE_KEY } from '../lib/household';
import { supabase } from '../lib/supabase';

const RC_IOS_KEY     = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
const RC_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';
const ENTITLEMENT    = 'premium';
// The Household plan unlocks its own entitlement (on top of Pro) so the owner can
// share Pro with one partner. Offering "household" holds its monthly/yearly packages.
const HOUSEHOLD_ENTITLEMENT = 'household';
const HOUSEHOLD_OFFERING    = 'household';

export type PaywallKind = 'solo' | 'household';

interface SubscriptionCtx {
  isPremium: boolean;
  isAnnual: boolean;
  /** Pays for the Household plan (can invite a partner who gets Pro) */
  hasHouseholdPlan: boolean;
  /** Has Pro through a partner's Household plan */
  proFromHousehold: boolean;
  refreshProStatus: () => void;
  paywallKind: PaywallKind;
  householdPackages: PurchasesPackage[];
  isHouseholdJoiner: boolean;
  isLoading: boolean;
  paywallVisible: boolean;
  paywallDemoMode: boolean;
  setPaywallDemoMode: (v: boolean) => void;
  packages: PurchasesPackage[];
  showPaywall: (kind?: PaywallKind) => void;
  hidePaywall: () => void;
  purchase: (pkg: PurchasesPackage) => Promise<boolean>;
  restorePurchases: () => Promise<boolean>;
}

const SubscriptionContext = createContext<SubscriptionCtx>({
  isPremium: false,
  isAnnual: false,
  hasHouseholdPlan: false,
  proFromHousehold: false,
  refreshProStatus: () => {},
  paywallKind: 'solo',
  householdPackages: [],
  isHouseholdJoiner: false,
  isLoading: true,
  paywallVisible: false,
  paywallDemoMode: false,
  setPaywallDemoMode: () => {},
  packages: [],
  showPaywall: () => {},
  hidePaywall: () => {},
  purchase: async () => false,
  restorePurchases: async () => false,
});

// GoGood has a single paid tier, so any active entitlement counts as premium.
// Prefer the one named ENTITLEMENT if it exists; otherwise use whichever is active
// (e.g. one named "Go Good Pro" in the RevenueCat dashboard).
function activeEntitlement(info: CustomerInfo) {
  const active = info.entitlements.active;
  return active[ENTITLEMENT] ?? Object.values(active)[0];
}

function isEntitled(info: CustomerInfo): boolean {
  return !!activeEntitlement(info);
}

function isAnnualPlan(info: CustomerInfo): boolean {
  const entitlement = activeEntitlement(info);
  if (!entitlement) return false;
  const productId = entitlement.productIdentifier?.toLowerCase() ?? '';
  return productId.includes('annual') || productId.includes('yearly') || productId.includes('year');
}

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [rcIsPremium,       setRcIsPremium]       = useState(false);
  const [rcIsAnnual,        setRcIsAnnual]        = useState(false);
  const [isHouseholdJoiner, setIsHouseholdJoiner] = useState(false);
  const [isLoading,         setIsLoading]         = useState(true);
  const [paywallVisible,    setPaywallVisible]     = useState(false);
  const [paywallDemoMode,   setPaywallDemoModeState] = useState(false);
  const [packages,          setPackages]           = useState<PurchasesPackage[]>([]);
  const [householdPackages, setHouseholdPackages]  = useState<PurchasesPackage[]>([]);
  const [rcHousehold,       setRcHousehold]        = useState(false);
  const [paywallKind,       setPaywallKind]        = useState<PaywallKind>('solo');
  // Pro shared by a partner's Household plan (checked on the server)
  const [shared,            setShared]             = useState<{ pro: boolean; annual: boolean }>({ pro: false, annual: false });

  const refreshProStatus = useCallback(() => {
    if (!user?.id) { setShared({ pro: false, annual: false }); return; }
    supabase.functions.invoke('pro-status', { body: {} })
      .then(({ data }) => {
        if (data && data.via === 'household') setShared({ pro: !!data.pro, annual: !!data.annual });
        else setShared({ pro: false, annual: false });
      })
      .catch(() => {});
  }, [user?.id]);

  // Check when the user changes and whenever the app comes back to the front
  useEffect(() => {
    refreshProStatus();
    const sub = AppState.addEventListener('change', st => { if (st === 'active') refreshProStatus(); });
    return () => sub.remove();
  }, [refreshProStatus]);

  // In __DEV__, demo mode forces free-tier so you can test the paywall UI.
  // In production, always use the actual RevenueCat subscription status.
  const isPremium = __DEV__ && paywallDemoMode ? false : (rcIsPremium || shared.pro);
  const isAnnual  = __DEV__ && paywallDemoMode ? false : (rcIsAnnual || shared.annual);
  const hasHouseholdPlan = !(__DEV__ && paywallDemoMode) && rcHousehold;

  // Only restore demo mode flag in development builds — never in production.
  useEffect(() => {
    if (!__DEV__) return;
    AsyncStorage.getItem('gogood_paywall_demo').then(v => {
      if (v === 'true') setPaywallDemoModeState(true);
    });
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(HOUSEHOLD_ROLE_KEY).then(role => {
      setIsHouseholdJoiner(role === 'member');
    });
  }, [user?.id]);

  const setPaywallDemoMode = useCallback((v: boolean) => {
    if (!__DEV__) return; // no-op in production
    setPaywallDemoModeState(v);
    AsyncStorage.setItem('gogood_paywall_demo', v ? 'true' : 'false');
  }, []);

  useEffect(() => {
    const apiKey = Platform.OS === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY;
    if (!apiKey) {
      if (__DEV__) console.warn('[RevenueCat] Missing API key — subscriptions disabled');
      setIsLoading(false);
      return;
    }

    Purchases.configure({ apiKey });
    if (user?.id) Purchases.logIn(user.id).catch(e => console.error('[RC] logIn failed', e));

    Purchases.addCustomerInfoUpdateListener(info => {
      setRcIsPremium(isEntitled(info));
      setRcIsAnnual(isAnnualPlan(info));
      setRcHousehold(!!info.entitlements.active[HOUSEHOLD_ENTITLEMENT]);
    });

    // 6-second timeout so isLoading never hangs indefinitely on slow networks.
    const timeout = setTimeout(() => setIsLoading(false), 6000);

    Purchases.getCustomerInfo()
      .then(info => {
        setRcIsPremium(isEntitled(info));
        setRcIsAnnual(isAnnualPlan(info));
        setRcHousehold(!!info.entitlements.active[HOUSEHOLD_ENTITLEMENT]);
      })
      .catch(e => console.error('[RC] getCustomerInfo failed', e))
      .finally(() => { clearTimeout(timeout); setIsLoading(false); });

    Purchases.getOfferings()
      .then(o => {
        if (o.current?.availablePackages.length) setPackages(o.current.availablePackages);
        const h = o.all[HOUSEHOLD_OFFERING]?.availablePackages;
        if (h?.length) setHouseholdPackages(h);
      })
      .catch(e => console.error('[RC] getOfferings failed', e));
  }, [user?.id]);

  const purchase = useCallback(async (pkg: PurchasesPackage): Promise<boolean> => {
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      const ok       = isEntitled(customerInfo);
      const annual   = isAnnualPlan(customerInfo);
      setRcIsPremium(ok);
      setRcIsAnnual(annual);
      setRcHousehold(!!customerInfo.entitlements.active[HOUSEHOLD_ENTITLEMENT]);
      if (ok) setPaywallVisible(false);
      return ok;
    } catch (e: any) {
      if (e?.userCancelled) return false;
      console.warn('Purchase error', e);
      throw e; // let the paywall show the reason
    }
  }, []);

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    try {
      const info = await Purchases.restorePurchases();
      const ok     = isEntitled(info);
      const annual = isAnnualPlan(info);
      setRcIsPremium(ok);
      setRcIsAnnual(annual);
      setRcHousehold(!!info.entitlements.active[HOUSEHOLD_ENTITLEMENT]);
      return ok;
    } catch (e) {
      console.error('[RC] restorePurchases failed', e);
      return false;
    }
  }, []);

  return (
    <SubscriptionContext.Provider value={{
      isPremium, isAnnual, isHouseholdJoiner, isLoading, paywallVisible, paywallDemoMode, setPaywallDemoMode, packages,
      hasHouseholdPlan, proFromHousehold: shared.pro && !rcIsPremium, refreshProStatus, paywallKind, householdPackages,
      showPaywall: (kind?: PaywallKind) => { setPaywallKind(kind === 'household' ? 'household' : 'solo'); setPaywallVisible(true); },
      hidePaywall: () => setPaywallVisible(false),
      purchase, restorePurchases,
    }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export const useSubscription = () => useContext(SubscriptionContext);
