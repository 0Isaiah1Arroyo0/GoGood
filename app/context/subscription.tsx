import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases, {
  type CustomerInfo,
  type PurchasesPackage,
} from 'react-native-purchases';
import { useAuth } from './auth';
import { HOUSEHOLD_ROLE_KEY } from '../lib/household';

const RC_IOS_KEY     = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
const RC_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';
const ENTITLEMENT    = 'premium';

interface SubscriptionCtx {
  isPremium: boolean;
  isAnnual: boolean;
  isHouseholdJoiner: boolean;
  isLoading: boolean;
  paywallVisible: boolean;
  paywallDemoMode: boolean;
  setPaywallDemoMode: (v: boolean) => void;
  packages: PurchasesPackage[];
  showPaywall: () => void;
  hidePaywall: () => void;
  purchase: (pkg: PurchasesPackage) => Promise<boolean>;
  restorePurchases: () => Promise<boolean>;
}

const SubscriptionContext = createContext<SubscriptionCtx>({
  isPremium: true,
  isAnnual: false,
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

function isEntitled(info: CustomerInfo): boolean {
  return !!info.entitlements.active[ENTITLEMENT];
}

function isAnnualPlan(info: CustomerInfo): boolean {
  const entitlement = info.entitlements.active[ENTITLEMENT];
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

  // When demo mode is off everyone is treated as premium/annual; only enable the
  // paywall gate when the user explicitly turns on demo mode.
  const isPremium = paywallDemoMode ? rcIsPremium : true;
  const isAnnual  = paywallDemoMode ? rcIsAnnual  : true;

  useEffect(() => {
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
    setPaywallDemoModeState(v);
    AsyncStorage.setItem('gogood_paywall_demo', v ? 'true' : 'false');
  }, []);

  useEffect(() => {
    const apiKey = Platform.OS === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY;
    if (!apiKey) {
      setIsLoading(false);
      return;
    }

    Purchases.configure({ apiKey });
    if (user?.id) Purchases.logIn(user.id).catch(() => {});

    Purchases.addCustomerInfoUpdateListener(info => {
      setRcIsPremium(isEntitled(info));
      setRcIsAnnual(isAnnualPlan(info));
    });

    Purchases.getCustomerInfo()
      .then(info => {
        setRcIsPremium(isEntitled(info));
        setRcIsAnnual(isAnnualPlan(info));
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));

    Purchases.getOfferings()
      .then(o => { if (o.current?.availablePackages.length) setPackages(o.current.availablePackages); })
      .catch(() => {});
  }, [user?.id]);

  const purchase = useCallback(async (pkg: PurchasesPackage): Promise<boolean> => {
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      const ok       = isEntitled(customerInfo);
      const annual   = isAnnualPlan(customerInfo);
      setRcIsPremium(ok);
      setRcIsAnnual(annual);
      if (ok) setPaywallVisible(false);
      return ok;
    } catch (e: any) {
      if (!e.userCancelled) console.warn('Purchase error', e);
      return false;
    }
  }, []);

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    try {
      const info = await Purchases.restorePurchases();
      const ok     = isEntitled(info);
      const annual = isAnnualPlan(info);
      setRcIsPremium(ok);
      setRcIsAnnual(annual);
      return ok;
    } catch {
      return false;
    }
  }, []);

  return (
    <SubscriptionContext.Provider value={{
      isPremium, isAnnual, isHouseholdJoiner, isLoading, paywallVisible, paywallDemoMode, setPaywallDemoMode, packages,
      showPaywall: () => setPaywallVisible(true),
      hidePaywall: () => setPaywallVisible(false),
      purchase, restorePurchases,
    }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export const useSubscription = () => useContext(SubscriptionContext);
