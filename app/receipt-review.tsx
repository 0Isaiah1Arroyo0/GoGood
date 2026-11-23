import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator, Platform, KeyboardAvoidingView,
  Animated, LayoutAnimation,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTheme } from './context/theme';
import { useAuth } from './context/auth';
import { loadDraftsBySession, updateDraft, deleteSessionDrafts, draftToSyncItem, type DraftItem } from './lib/draft-items';
import { pushItems } from './lib/sync';
import { HOUSEHOLD_KEY } from './lib/household';
import { rescheduleExpiryNotifications } from './lib/notifications';

const CATEGORIES = ['fridge', 'freezer', 'pantry'] as const;

const FOOD_CATEGORY_ORDER = [
  'Meat', 'Poultry', 'Fish & Seafood', 'Dairy', 'Eggs',
  'Vegetables', 'Fruit', 'Legumes & Beans', 'Nuts & Seeds',
  'Bread & Grains', 'Canned & Jarred', 'Baking',
  'Condiments & Sauces', 'Syrups & Sweeteners', 'Drinks', 'Coffee & Tea',
  'Snacks & Sweets', 'Frozen Foods', 'Prepared & Deli',
  'Supplements', 'Herbs & Spices', 'Leftovers', 'Other',
];



// Expiry badge — same colors and wording as the inventory screen's item cards
type Badge = 'red' | 'amber' | 'green' | 'blue' | 'black';
const BADGE_LIGHT: Record<Badge, { bg: string; text: string }> = {
  red: { bg: '#FEEBEB', text: '#A52020' }, amber: { bg: '#FFF8E6', text: '#7A4A00' },
  green: { bg: '#E1F5EE', text: '#0A5740' }, blue: { bg: '#EBF4FF', text: '#14428A' },
  black: { bg: '#2C2C2E', text: '#FFFFFF' },
};
const BADGE_DARK: Record<Badge, { bg: string; text: string }> = {
  red: { bg: 'rgba(245,90,90,0.2)', text: '#F5A0A0' }, amber: { bg: 'rgba(245,180,60,0.2)', text: '#F5D090' },
  green: { bg: 'rgba(93,202,165,0.2)', text: '#5DCAA5' }, blue: { bg: 'rgba(100,160,255,0.2)', text: '#90C0FF' },
  black: { bg: '#2C2C2E', text: '#FFFFFF' },
};
function daysUntil(date: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(date).getTime() - today.getTime()) / 86400000);
}
function expiryBadge(date: string | null, category: string): { badge: Badge; text: string } | null {
  if (!date) return null;
  const d = daysUntil(date);
  const badge: Badge = d < 0 ? 'black' : category === 'freezer' ? 'blue' : d === 0 ? 'red' : d <= 5 ? 'amber' : 'green';
  const text = d < 0 ? 'expired' : d === 0 ? 'today' : d === 1 ? 'tomorrow' : `${d} days`;
  return { badge, text };
}

async function lookupBarcode(upc: string): Promise<{
  name?: string; protein: number; carbs: number; fat: number; cal: number;
} | null> {
  try {
    const r = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${upc}?fields=product_name,brands,nutriments`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return null;
    const d = await r.json();
    if (d.status !== 1 || !d.product) return null;
    const p = d.product;
    const n = p.nutriments ?? {};
    const productName = p.product_name?.trim();
    const brand = p.brands?.split(',')[0]?.trim();
    const name = productName
      ? (brand && !productName.toLowerCase().includes(brand.toLowerCase())
          ? `${brand} ${productName}` : productName)
      : undefined;
    return {
      name,
      protein: n.proteins_100g       != null ? Math.round(n.proteins_100g       * 10) / 10 : 0,
      carbs:   n.carbohydrates_100g  != null ? Math.round(n.carbohydrates_100g  * 10) / 10 : 0,
      fat:     n.fat_100g            != null ? Math.round(n.fat_100g            * 10) / 10 : 0,
      cal:     n['energy-kcal_100g'] != null ? Math.round(n['energy-kcal_100g'])           : 0,
    };
  } catch {
    return null;
  }
}

export default function ReceiptReviewScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { sessionId, storeName } = useLocalSearchParams<{ sessionId: string; storeName?: string }>();

  const [drafts,      setDrafts]      = useState<DraftItem[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [removed,     setRemoved]     = useState<Set<string>>(new Set());
  const [savedItems,  setSavedItems]  = useState<ReturnType<typeof draftToSyncItem>[] | null>(null);

  const [scanningForId,  setScanningForId]  = useState<string | null>(null);
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const barcodeLockRef = useRef(false);
  const bannerAnim = useRef(new Animated.Value(0)).current;
  // Every item starts collapsed so the user can open and check them one at a time
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  useEffect(() => {
    if (!sessionId) { router.back(); return; }
    const start = Date.now();
    loadDraftsBySession(sessionId).then(items => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 1200 - elapsed);
      setTimeout(() => {
        setDrafts(items);
        setLoading(false);
        Animated.spring(bannerAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 220,
          friction: 18,
        }).start();
      }, remaining);
    });
  }, [sessionId]);

  const updateLocal = useCallback((id: string, changes: Partial<DraftItem>) => {
    setDrafts(prev => prev.map(d => d.id === id ? { ...d, ...changes } : d));
  }, []);

  const openBarcodeScanner = async (draftId: string) => {
    if (cameraPermission?.status === 'denied') {
      Alert.alert('Camera needed', 'Enable camera access in Settings to scan barcodes.');
      return;
    }
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) { Alert.alert('Camera needed', 'Please allow camera access to scan barcodes.'); return; }
    }
    barcodeLockRef.current = false;
    setScanningForId(draftId);
  };

  const handleBarcodeScan = async ({ data }: { data: string }) => {
    if (barcodeLockRef.current || !scanningForId) return;
    barcodeLockRef.current = true;
    setBarcodeLoading(true);

    const targetId = scanningForId;
    const result = await lookupBarcode(data);
    setBarcodeLoading(false);
    setScanningForId(null);

    if (!result) {
      Alert.alert('Not found', `Barcode ${data} wasn't in Open Food Facts. Edit nutrition manually.`);
      return;
    }

    const changes: Partial<DraftItem> = {
      protein: result.protein,
      carbs:   result.carbs,
      fat:     result.fat,
      cal:     result.cal,
      ...(result.name ? { name: result.name } : {}),
    };
    updateLocal(targetId, changes);
    updateDraft(targetId, changes).catch(() => {});
    Alert.alert(
      'Nutrition updated',
      result.name ? `Found: ${result.name}` : 'Nutrition data updated from barcode.',
    );
  };

  const visibleDrafts    = drafts.filter(d => !removed.has(d.id));
  const readyCount       = visibleDrafts.filter(d => d.expiryDate).length;
  const aiPrefilledCount = readyCount;

  const handleConfirm = async () => {
    if (visibleDrafts.length === 0) { router.back(); return; }
    setSaving(true);
    try {
      const householdId = await AsyncStorage.getItem(HOUSEHOLD_KEY);
      const existing: any[] = JSON.parse(await AsyncStorage.getItem('gogood_items') ?? '[]');
      const newItems = visibleDrafts.map(d => draftToSyncItem(d));
      const all = [...existing, ...newItems];

      await AsyncStorage.setItem('gogood_items', JSON.stringify(all));

      if (user?.id) {
        pushItems(newItems, user.id, householdId ?? undefined).catch(() => {});
      }

      const notifItems = all
        .filter(i => i.expiryDate)
        .map((i: any) => ({ id: Number(i.id), name: i.baseName || i.name, icon: i.icon, expiryDate: i.expiryDate }));
      rescheduleExpiryNotifications(notifItems, true).catch(() => {});

      if (sessionId) deleteSessionDrafts(sessionId).catch(() => {});

      setSavedItems(newItems);
    } catch {
      Alert.alert('Error', 'Could not add items. Please try again.');
    }
    setSaving(false);
  };

  // ── Post-save review ─────────────────────────────────────────────────────────
  if (savedItems) {
    return (
      <View style={[styles.safe, { backgroundColor: colors.bg }]}>
        <StatusBar style={colors.statusBar} backgroundColor={colors.bg} />
        <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomWidth: 0.5, borderBottomColor: colors.border }]}>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[styles.headerTitle, { color: colors.brand }]}>double-check</Text>
            <Text style={{ fontSize: 11, color: colors.textSub, marginTop: 2 }}>Does everything look right?</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
          {savedItems.map((item, i) => (
            <View key={i} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{item.baseName || item.name}</Text>
                <Text style={{ fontSize: 11, color: colors.textSub, marginTop: 3 }}>
                  {(item.category as string).charAt(0).toUpperCase() + (item.category as string).slice(1)}
                  {item.foodCategory ? `  ·  ${item.foodCategory}` : ''}
                </Text>
                <Text style={{ fontSize: 11, color: colors.textSub, marginTop: 2 }}>
                  {item.expiryDate ? `Expires ${item.expiryDate}` : 'No expiry set'}
                  {item.qty ? `  ·  ${item.qty}` : ''}
                </Text>
                {(item.cal > 0 || item.protein > 0) && (
                  <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
                    {[item.servingSize && `per ${item.servingSize}`, item.cal > 0 && `${item.cal} cal`, item.protein > 0 && `${item.protein}g protein`].filter(Boolean).join('  ·  ')}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </ScrollView>
        <View style={[styles.confirmBar, { paddingBottom: insets.bottom + 12, backgroundColor: colors.bg, borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.confirmBtn, { backgroundColor: colors.btnPrimary, marginBottom: 10 }]}
            onPress={() => router.replace('/(tabs)')}
          >
            <Text style={styles.confirmText}>Looks good — go to inventory</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.confirmBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}
            onPress={() => setSavedItems(null)}
          >
            <Text style={[styles.confirmText, { color: colors.textSub }]}>Go back to edit items</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Barcode scanner full-screen overlay ──────────────────────────────────────
  if (scanningForId) {
    const draftName = drafts.find(d => d.id === scanningForId)?.name ?? 'item';
    return (
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000' }]}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          onBarcodeScanned={barcodeLoading ? undefined : handleBarcodeScan}
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] }}
        />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View style={scanStyles.frame}>
            <View style={[scanStyles.corner, { top: -2, left: -2, borderTopWidth: 3, borderLeftWidth: 3 }]} />
            <View style={[scanStyles.corner, { top: -2, right: -2, borderTopWidth: 3, borderRightWidth: 3 }]} />
            <View style={[scanStyles.corner, { bottom: -2, left: -2, borderBottomWidth: 3, borderLeftWidth: 3 }]} />
            <View style={[scanStyles.corner, { bottom: -2, right: -2, borderBottomWidth: 3, borderRightWidth: 3 }]} />
          </View>
          <Text style={{ color: 'white', marginTop: 20, fontSize: 14, fontWeight: '600', textAlign: 'center', paddingHorizontal: 32 }}>
            Scan barcode on{'\n'}
            <Text style={{ color: '#1D9E75' }}>{draftName}</Text>
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.5)', marginTop: 6, fontSize: 11 }}>
            UPC · EAN · Code128 supported
          </Text>
          {barcodeLoading && (
            <View style={{ marginTop: 20, alignItems: 'center', gap: 8 }}>
              <ActivityIndicator color="#1D9E75" size="large" />
              <Text style={{ color: 'white', fontSize: 13 }}>Looking up product…</Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          style={{ position: 'absolute', top: insets.top + 12, right: 20, paddingHorizontal: 16, height: 36, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}
          onPress={() => { barcodeLockRef.current = false; setScanningForId(null); }}
        >
          <Text style={{ color: 'white', fontSize: 13, fontWeight: '600' }}>Close</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center', paddingBottom: insets.bottom + 20 }}>
          <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>powered by Open Food Facts</Text>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.brand} size="large" />
        <Text style={{ color: colors.textSub, marginTop: 16, fontSize: 15 }}>Parsing your receipt…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.safe, { backgroundColor: colors.bg }]}>
      <StatusBar style={colors.statusBar} backgroundColor={colors.bg} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={{ fontSize: 20, color: colors.brand }}>‹</Text>
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[styles.headerTitle, { color: colors.brand }]}>review receipt</Text>
            {storeName ? (
              <Text style={{ fontSize: 11, color: colors.textSub, marginTop: 2 }}>from {storeName}</Text>
            ) : null}
          </View>
          <View style={{ width: 40 }} />
        </View>

        {visibleDrafts.length === 0 ? (
          <View style={styles.center}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 8 }}>No items found</Text>
            <Text style={{ fontSize: 14, color: colors.textSub, textAlign: 'center', lineHeight: 20 }}>
              We couldn't parse any grocery items from that receipt. Try a clearer photo.
            </Text>
            <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: colors.btnPrimary, marginTop: 24, alignSelf: 'stretch' }]} onPress={() => router.back()}>
              <Text style={styles.confirmText}>Go back</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Info banner */}
            <Animated.View style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.border }, {
              opacity: bannerAnim,
              transform: [{ translateY: bannerAnim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
            }]}>
              <Text style={{ fontSize: 13, color: colors.textSub, lineHeight: 18 }}>
                <Text style={{ fontWeight: '700', color: colors.text }}>{visibleDrafts.length} item{visibleDrafts.length !== 1 ? 's' : ''} found</Text>
                {aiPrefilledCount > 0 && (
                  <Text style={{ color: '#1D9E75' }}> · {aiPrefilledCount} expiry dates AI-estimated</Text>
                )}
              </Text>
              <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
                Tap an item to check its details, fix anything that's off, or remove it.
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                {[
                  { label: 'Expand all',   onPress: () => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setExpandedIds(new Set(visibleDrafts.map(d => d.id))); } },
                  { label: 'Collapse all', onPress: () => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setExpandedIds(new Set()); } },
                ].map(b => (
                  <TouchableOpacity key={b.label} style={[styles.grayBtn, { borderColor: colors.border, backgroundColor: colors.bg }]} onPress={b.onPress}>
                    <Text style={[styles.grayBtnText, { color: colors.textSub }]}>{b.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Animated.View>

            <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
              {visibleDrafts.map((draft, index) => (
                <DraftCard
                  key={draft.id}
                  draft={draft}
                  colors={colors}
                  enterDelay={Math.min(index * 60, 360)}
                  isDark={isDark}
                  expanded={expandedIds.has(draft.id)}
                  onToggle={() => toggleExpanded(draft.id)}
                  onUpdate={(changes) => {
                    updateLocal(draft.id, changes);
                    updateDraft(draft.id, changes).catch(() => {});
                  }}
                  onRemove={() => setRemoved(prev => new Set(prev).add(draft.id))}
                  onScanBarcode={() => openBarcodeScanner(draft.id)}
                />
              ))}
            </ScrollView>

            {/* Confirm bar */}
            <View style={[styles.confirmBar, { paddingBottom: insets.bottom + 12, backgroundColor: colors.bg, borderTopColor: colors.border }]}>
              {readyCount < visibleDrafts.length && (
                <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', marginBottom: 8 }}>
                  {visibleDrafts.length - readyCount} item{visibleDrafts.length - readyCount !== 1 ? 's' : ''} without expiry — will be added with "set later" badge
                </Text>
              )}
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: colors.btnPrimary, opacity: saving ? 0.7 : 1 }]}
                onPress={handleConfirm}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="white" />
                  : <Text style={styles.confirmText}>
                      Add {visibleDrafts.length} item{visibleDrafts.length !== 1 ? 's' : ''} to Inventory
                    </Text>
                }
              </TouchableOpacity>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── DraftCard ────────────────────────────────────────────────────────────────

function DraftCard({ draft, colors, isDark, onUpdate, onRemove, onScanBarcode, enterDelay, expanded, onToggle }: {
  draft: DraftItem;
  colors: any;
  isDark: boolean;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (changes: Partial<DraftItem>) => void;
  onRemove: () => void;
  onScanBarcode: () => void;
  enterDelay: number;
}) {
  const cardAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(cardAnim, {
      toValue: 1,
      delay: enterDelay,
      useNativeDriver: true,
      tension: 260,
      friction: 20,
    }).start();
  }, []);

  const handleRemove = () => {
    Animated.timing(cardAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => onRemove());
  };

  const [editingName,   setEditingName]   = useState(false);
  const [nameText,      setNameText]      = useState(draft.name);
  const [editingQty,    setEditingQty]    = useState(false);
  const [qtyText,       setQtyText]       = useState(String(draft.qtyNum));
  const [editingDate,   setEditingDate]   = useState(false);
  const [dateText,      setDateText]      = useState(draft.expiryDate ?? '');

  const [proteinText,  setProteinText]  = useState(String(draft.protein || 0));
  const [carbsText,    setCarbsText]    = useState(String(draft.carbs   || 0));
  const [fatText,      setFatText]      = useState(String(draft.fat     || 0));
  const [calText,      setCalText]      = useState(String(draft.cal     || 0));
  const [servingText,  setServingText]  = useState(draft.servingSize ?? '');

  // Sync macro text when a barcode scan updates the draft from outside
  useEffect(() => {
    setProteinText(String(draft.protein || 0));
    setCarbsText(String(draft.carbs     || 0));
    setFatText(String(draft.fat         || 0));
    setCalText(String(draft.cal         || 0));
  }, [draft.protein, draft.carbs, draft.fat, draft.cal]);

  const commitMacro = (key: 'protein' | 'carbs' | 'fat' | 'cal', text: string) => {
    const n = parseFloat(text);
    onUpdate({ [key]: isNaN(n) ? 0 : Math.round(n * 10) / 10 });
  };

  const [aiEstimated, setAiEstimated] = useState(!!draft.expiryDate);

  const commitDate = (text: string) => {
    setEditingDate(false);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      setAiEstimated(false);
      onUpdate({ expiryDate: text });
    } else if (text === '') {
      setAiEstimated(false);
      onUpdate({ expiryDate: null });
    }
  };


  return (
    <Animated.View style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.border }, {
      opacity: cardAnim,
      transform: [{
        translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }),
      }],
    }]}>
      {/* Summary row — looks like an inventory item; tap to open or close */}
      <TouchableOpacity onPress={onToggle} activeOpacity={0.7} style={styles.itemMain}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>{draft.name}</Text>
          <Text style={[styles.itemQty, { color: colors.textSub }]} numberOfLines={1}>
            {draft.qtyNum}{draft.unit ? ` ${draft.unit}` : ''}  ·  {draft.category.charAt(0).toUpperCase() + draft.category.slice(1)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {(() => {
            const b = expiryBadge(draft.expiryDate, draft.category);
            const pal = isDark ? BADGE_DARK : BADGE_LIGHT;
            return b ? (
              <View style={[styles.badge, { backgroundColor: pal[b.badge].bg }]}>
                <Text style={[styles.badgeText, { color: pal[b.badge].text }]}>{b.text}</Text>
              </View>
            ) : (
              <View style={[styles.badge, { backgroundColor: 'rgba(232,117,106,0.12)' }]}>
                <Text style={[styles.badgeText, { color: '#E8756A' }]}>set expiry</Text>
              </View>
            );
          })()}
          {!expanded && <Text style={{ fontSize: 9, color: colors.textMuted }}>tap for details</Text>}
        </View>
      </TouchableOpacity>

      {expanded && (
      <View style={[styles.itemDetail, { borderTopColor: colors.border }]}>
      {/* Name */}
      <Text style={fieldLabelStyle(colors)}>NAME</Text>
      <View style={{ marginBottom: 10 }}>
        {editingName ? (
          <TextInput
            style={[styles.inputField, { color: colors.text, backgroundColor: colors.surfaceAlt, borderColor: colors.brand }]}
            value={nameText}
            onChangeText={setNameText}
            onBlur={() => { setEditingName(false); if (nameText.trim()) onUpdate({ name: nameText.trim() }); }}
            autoFocus
            returnKeyType="done"
          />
        ) : (
          <TouchableOpacity onPress={() => setEditingName(true)} style={[styles.inputField, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Text style={{ color: colors.text, fontSize: 14 }} numberOfLines={1}>{draft.name}</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={fieldLabelStyle(colors)}>LOCATION</Text>
      {/* Location selector */}
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
        {CATEGORIES.map(cat => (
          <TouchableOpacity
            key={cat}
            onPress={() => onUpdate({ category: cat })}
            style={[styles.grayBtn, {
              flex: 1,
              backgroundColor: draft.category === cat ? colors.btnPrimary : colors.surface,
              borderColor: draft.category === cat ? colors.btnPrimary : colors.border,
            }]}
          >
            <Text style={[styles.grayBtnText, { color: draft.category === cat ? 'white' : colors.textSub, textTransform: 'capitalize' }]}>
              {cat}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Food category selector */}
      <Text style={fieldLabelStyle(colors)}>FOOD CATEGORY</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
        <TouchableOpacity
          onPress={() => onUpdate({ foodCategory: null })}
          style={[styles.grayBtn, { backgroundColor: !draft.foodCategory ? colors.btnPrimary : colors.surface, borderColor: !draft.foodCategory ? colors.btnPrimary : colors.border }]}
        >
          <Text style={[styles.grayBtnText, { color: !draft.foodCategory ? 'white' : colors.textSub }]}>Auto</Text>
        </TouchableOpacity>
        {FOOD_CATEGORY_ORDER.map(cat => (
          <TouchableOpacity
            key={cat}
            onPress={() => onUpdate({ foodCategory: cat })}
            style={[styles.grayBtn, { backgroundColor: draft.foodCategory === cat ? colors.btnPrimary : colors.surface, borderColor: draft.foodCategory === cat ? colors.btnPrimary : colors.border }]}
          >
            <Text style={[styles.grayBtnText, { color: draft.foodCategory === cat ? 'white' : colors.textSub }]}>
              {cat}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Qty + Expiry row */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textSub, letterSpacing: 0.5, marginBottom: 4 }}>QTY</Text>
          {editingQty ? (
            <TextInput
              style={[styles.inputField, { color: colors.text, backgroundColor: colors.surfaceAlt, borderColor: colors.brand }]}
              value={qtyText}
              onChangeText={setQtyText}
              keyboardType="numeric"
              onBlur={() => {
                setEditingQty(false);
                const n = parseFloat(qtyText);
                if (!isNaN(n) && n > 0) onUpdate({ qtyNum: n });
              }}
              autoFocus
              returnKeyType="done"
            />
          ) : (
            <TouchableOpacity onPress={() => setEditingQty(true)} style={[styles.inputField, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <Text style={{ color: colors.text, fontSize: 14 }}>{draft.qtyNum}{draft.unit ? ' ' + draft.unit : ''}</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ flex: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 6 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textSub, letterSpacing: 0.5 }}>
              EXPIRY <Text style={{ color: '#E8756A' }}>(YYYY-MM-DD)</Text>
            </Text>
            {aiEstimated && draft.expiryDate && (
              <View style={{ backgroundColor: 'rgba(29,158,117,0.12)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 }}>
                <Text style={{ fontSize: 8, color: '#1D9E75', fontWeight: '700' }}>AI est.</Text>
              </View>
            )}
          </View>
          {editingDate ? (
            <TextInput
              style={[styles.inputField, { color: colors.text, backgroundColor: colors.surfaceAlt, borderColor: colors.brand }]}
              value={dateText}
              onChangeText={setDateText}
              placeholder="e.g. 2026-08-15"
              placeholderTextColor={colors.textMuted}
              onBlur={() => commitDate(dateText)}
              autoFocus
              returnKeyType="done"
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
            />
          ) : (
            <TouchableOpacity
              onPress={() => setEditingDate(true)}
              style={[styles.inputField, {
                backgroundColor: draft.expiryDate ? (aiEstimated ? 'rgba(29,158,117,0.06)' : colors.surfaceAlt) : 'rgba(232,117,106,0.08)',
                borderColor: draft.expiryDate ? (aiEstimated ? 'rgba(29,158,117,0.4)' : colors.border) : '#E8756A',
              }]}
            >
              <Text style={{ color: draft.expiryDate ? colors.text : '#E8756A', fontSize: 14 }}>
                {draft.expiryDate ?? 'Set expiry date'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {draft.expiryDate && (
        <TouchableOpacity
          onPress={() => { setDateText(''); setAiEstimated(false); onUpdate({ expiryDate: null }); }}
          style={[styles.grayBtn, { alignSelf: 'flex-start', marginTop: 8, borderColor: colors.border, backgroundColor: colors.surface }]}
        >
          <Text style={[styles.grayBtnText, { color: colors.textSub }]}>Clear expiry</Text>
        </TouchableOpacity>
      )}

      {/* Macros — always editable */}
      <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textSub, letterSpacing: 0.5 }}>MACROS</Text>
          <Text style={{ fontSize: 9, color: colors.textMuted }}>serving:</Text>
          <TextInput
            style={{ flex: 1, fontSize: 11, color: colors.text, borderBottomWidth: 0.5, borderBottomColor: colors.border, paddingVertical: 2, paddingHorizontal: 4 }}
            value={servingText}
            onChangeText={setServingText}
            onBlur={() => { const v = servingText.trim(); onUpdate({ servingSize: v }); updateDraft(draft.id, { servingSize: v }).catch(() => {}); }}
            placeholder="e.g. 1/4 cup"
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {([
            { key: 'protein' as const, label: 'Protein', unit: 'g', color: '#1D9E75', text: proteinText, setText: setProteinText },
            { key: 'carbs'   as const, label: 'Carbs',   unit: 'g', color: '#F5A623', text: carbsText,   setText: setCarbsText },
            { key: 'fat'     as const, label: 'Fat',     unit: 'g', color: '#E8756A', text: fatText,     setText: setFatText },
            { key: 'cal'     as const, label: 'Cal',     unit: '',  color: colors.textSub, text: calText, setText: setCalText },
          ] as const).map(({ key, label, unit, color, text, setText }) => (
            <View key={key} style={{ flex: 1 }}>
              <Text style={{ fontSize: 9, fontWeight: '700', color, letterSpacing: 0.3, marginBottom: 3 }}>{label}{unit ? ` (${unit})` : ''}</Text>
              <TextInput
                style={[styles.inputField, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, color: colors.text, paddingVertical: 6, paddingHorizontal: 6, fontSize: 13, textAlign: 'center' }]}
                value={text}
                onChangeText={setText}
                onBlur={() => commitMacro(key, text)}
                keyboardType="decimal-pad"
                returnKeyType="done"
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                selectTextOnFocus
              />
            </View>
          ))}
        </View>
      </View>

      {/* PSA notice */}
      <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colors.border, flexDirection: 'row', alignItems: 'flex-start', gap: 5 }}>
        <Text style={{ fontSize: 11, color: colors.textMuted, flex: 1, lineHeight: 15 }}>
          Nutrition is estimated. Check the product label for exact values and the real expiry date — tap the expiry field above to update it.
        </Text>
      </View>

      {/* Actions */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <TouchableOpacity onPress={onScanBarcode} style={[styles.grayBtn, { flex: 1, minHeight: 36, borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.grayBtnText, { color: colors.textSub }]}>Scan barcode</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleRemove} style={[styles.grayBtn, { flex: 1, minHeight: 36, borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.grayBtnText, { color: colors.textSub }]}>Remove</Text>
        </TouchableOpacity>
      </View>
      </View>
      )}
    </Animated.View>
  );
}

const fieldLabelStyle = (colors: any) => ({ fontSize: 10, fontWeight: '700' as const, color: colors.textSub, letterSpacing: 0.5, marginBottom: 6 });

const styles = StyleSheet.create({
  safe:   { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
  backBtn:{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 19, fontWeight: '700', fontFamily: 'Fraunces_600SemiBold' },
  banner: { marginHorizontal: 16, marginBottom: 4, padding: 12, borderRadius: 14, borderWidth: 0.5 },
  card:   { borderRadius: 16, padding: 14, borderWidth: 0.5 },
  // Matches the inventory screen's item cards
  itemCard:   { borderRadius: 16, borderWidth: 0.5, shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.16, shadowRadius: 14, elevation: 6 },
  itemMain:   { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  itemName:   { fontSize: 16, fontWeight: '600' },
  itemQty:    { fontSize: 11, marginTop: 3 },
  badge:      { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeText:  { fontSize: 12, fontWeight: '500' },
  itemDetail: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 12, borderTopWidth: 0.5 },
  inputField: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  confirmBar: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 0.5 },
  confirmBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  confirmText: { color: 'white', fontSize: 14, fontWeight: '600' },
  // Same look as the inventory screen's gray buttons (Edit / Remove / Sort & Filter options)
  grayBtn: { minHeight: 34, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  grayBtnText: { fontSize: 12, fontWeight: '600' },
});

const scanStyles = StyleSheet.create({
  frame: {
    width: 240, height: 160, borderRadius: 4,
    position: 'relative',
  },
  corner: {
    position: 'absolute', width: 20, height: 20,
    borderColor: '#1D9E75', borderRadius: 2,
  },
});
