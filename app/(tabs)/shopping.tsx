import EdgeFade from '@/components/edge-fade';
import { useTabBarSpace } from '@/components/tab-bar-space';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Animated, Alert, Share, TextInput, LayoutAnimation,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, type ThemeColors } from '../context/theme';
import { useAppDrawer } from '../components/AppDrawer';
import HeaderAddButton from '@/components/header-add-button';
import { HOUSEHOLD_KEY } from '../lib/household';
import {
  type ShoppingItem,
  loadShoppingList, toggleShoppingItem,
  removeCheckedItems, persistShoppingList, addToShoppingList,
  loadHouseholdShoppingList, addToHouseholdShoppingList,
  toggleHouseholdShoppingItem, removeHouseholdCheckedItems,
  clearHouseholdShoppingList, subscribeToHouseholdShoppingList,
  updateShoppingItem, updateHouseholdShoppingItem,
  removeShoppingItem, removeHouseholdShoppingItem,
} from '../lib/shopping-list';
import { aisleFor, AISLES, UNIT_CHOICES, unitWarning } from '../lib/shopping-helpers';

type SortMode = 'aisle' | 'recipe' | 'alpha';
const SORT_KEY = 'gogood_shopping_sort';
import { raised, raisedGreen } from '@/components/raised';
import BottomSheet from '@/components/bottom-sheet';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Stores you can order from. Each opens the store's own search for an item,
// where it can go straight into that store's cart.
const STORES: { key: string; name: string; sub: string; search: (q: string) => string }[] = [
  { key: 'instacart', name: 'Instacart',    sub: 'Delivery from most local stores', search: q => `https://www.instacart.com/store/s?k=${q}` },
  { key: 'walmart',   name: 'Walmart',      sub: 'Pickup or delivery',              search: q => `https://www.walmart.com/search?q=${q}` },
  { key: 'kroger',    name: 'Kroger',       sub: 'Pickup or delivery',              search: q => `https://www.kroger.com/search?query=${q}` },
  { key: 'target',    name: 'Target',       sub: 'Drive up or same-day delivery',   search: q => `https://www.target.com/s?searchTerm=${q}` },
  { key: 'amazon',    name: 'Amazon Fresh', sub: 'Delivery',                        search: q => `https://www.amazon.com/s?k=${q}&i=amazonfresh` },
  { key: 'publix',    name: 'Publix',       sub: 'Delivery through Instacart',      search: q => `https://delivery.publix.com/store/publix/s?k=${q}` },
  { key: 'foodlion',  name: 'Food Lion',    sub: 'Food Lion To Go',                 search: q => `https://shop.foodlion.com/search?search_term=${q}` },
  { key: 'costco',    name: 'Costco',       sub: 'Same-day delivery',               search: q => `https://www.costco.com/CatalogSearch?keyword=${q}` },
];


function groupByRecipe(items: ShoppingItem[]): Map<string, ShoppingItem[]> {
  const map = new Map<string, ShoppingItem[]>();
  for (const item of items) {
    const key = item.recipeName || 'Other';
    const group = map.get(key) ?? [];
    group.push(item);
    map.set(key, group);
  }
  return map;
}

function buildShareText(items: ShoppingItem[]): string {
  const unchecked = items.filter(i => !i.checked);
  const done      = items.filter(i => i.checked);
  const lines: string[] = ['Shopping list\n'];
  for (const item of unchecked) {
    const qty = item.quantity ? ` — ${item.quantity}${item.unit ? ' ' + item.unit : ''}` : '';
    lines.push(`☐ ${item.name}${qty}`);
  }
  if (done.length) {
    lines.push('\nIn the cart:');
    for (const item of done) lines.push(`✓ ${item.name}`);
  }
  return lines.join('\n');
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ShoppingScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace(); // room for the floating bottom bar
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const { menuBtn, drawerEl } = useAppDrawer();

  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [addVisible, setAddVisible]   = useState(false);
  const [newName, setNewName]         = useState('');
  const [newQty, setNewQty]           = useState('');
  const [newUnit, setNewUnit]         = useState('');
  const [nameError, setNameError]     = useState(false);
  // First tap on Add with no quantity/unit shows a gentle reminder; the second adds anyway
  const [nudge, setNudge]             = useState(false);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [sortMode, setSortMode]       = useState<SortMode>('aisle');
  const [recentNames, setRecentNames] = useState<string[]>([]); // recently used-up items, as suggestions

  // Share — a single full-screen, opaque flow. `null` closed; otherwise which
  // page is showing. No bottom sheet / pass-through backdrop over the list.
  const [shareView, setShareView] = useState<null | 'menu' | 'image' | 'text' | 'order' | 'store'>(null);
  const [orderStore, setOrderStore] = useState<string | null>(null);
  const [orderedIds, setOrderedIds] = useState<Set<string>>(new Set()); // items already looked up at the chosen store
  const router = useRouter();
  const [capturing, setCapturing] = useState(false);
  const previewRef       = useRef<View>(null);

  const screenFade      = useRef(new Animated.Value(0)).current;
  const screenSlide     = useRef(new Animated.Value(24)).current;
  const heroScale       = useRef(new Animated.Value(0.94)).current;
  const cardsOpacity    = useRef(new Animated.Value(0)).current;
  const cardsTranslateY = useRef(new Animated.Value(20)).current;

  useFocusEffect(useCallback(() => {
    screenFade.setValue(0); screenSlide.setValue(24);
    heroScale.setValue(0.94); cardsOpacity.setValue(0); cardsTranslateY.setValue(20);
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
    AsyncStorage.getItem(SORT_KEY).then(v => { if (v === 'aisle' || v === 'recipe' || v === 'alpha') setSortMode(v); }).catch(() => {});
    AsyncStorage.getItem('gogood_gone_good').then(raw => {
      const seen = new Set<string>();
      const names: string[] = [];
      for (const e of (raw ? JSON.parse(raw) : []) as { name?: string }[]) {
        const n = (e.name ?? '').trim();
        if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); names.push(n); }
        if (names.length >= 12) break;
      }
      setRecentNames(names);
    }).catch(() => {});
    AsyncStorage.getItem(HOUSEHOLD_KEY).then(async hhId => {
      setHouseholdId(hhId);
      const loaded = hhId
        ? await loadHouseholdShoppingList(hhId)
        : await loadShoppingList();
      setItems(loaded);
    });
  }, []));

  // ── Household realtime subscription ──────────────────────────────────────

  useEffect(() => {
    if (!householdId) return;
    const ch = subscribeToHouseholdShoppingList(
      householdId,
      item => setItems(prev => prev.some(i => i.id === item.id) ? prev : [...prev, item]),
      item => setItems(prev => prev.map(i => i.id === item.id ? item : i)),
      id   => setItems(prev => prev.filter(i => i.id !== id)),
    );
    return () => { ch.unsubscribe(); };
  }, [householdId]);

  // ── Add ───────────────────────────────────────────────────────────────────

  const openAdd = (name = '') => {
    setEditingId(null);
    setNewName(name); setNewQty(''); setNewUnit(''); setNameError(false); setNudge(false);
    setAddVisible(true);
  };

  const openEdit = (item: ShoppingItem) => {
    setEditingId(item.id);
    setNewName(item.name); setNewQty(item.quantity ?? ''); setNewUnit(item.unit ?? '');
    setNameError(false); setNudge(false);
    setAddVisible(true);
  };

  const addItems = async (newItems: { name: string; quantity?: string; unit?: string }[]) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setItems(householdId
      ? await addToHouseholdShoppingList(householdId, newItems)
      : await addToShoppingList(newItems));
  };

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) { setNameError(true); return; }
    const quantity = newQty.trim();
    const unit = newUnit.trim();
    if (editingId) {
      const updates = { name, quantity, unit };
      setItems(prev => prev.map(i => i.id === editingId ? { ...i, name, quantity: quantity || undefined, unit: unit || undefined } : i));
      if (householdId) await updateHouseholdShoppingItem(householdId, editingId, updates);
      else setItems(await updateShoppingItem(editingId, updates));
      setAddVisible(false);
      return;
    }
    if (((!quantity || !unit) || unitWarning(name, unit)) && !nudge) { setNudge(true); return; }
    await addItems([{ name, quantity: quantity || undefined, unit: unit || undefined }]);
    setAddVisible(false);
  };

  const handleDelete = async () => {
    if (!editingId) return;
    const id = editingId;
    setAddVisible(false);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setItems(prev => prev.filter(i => i.id !== id));
    if (householdId) await removeHouseholdShoppingItem(householdId, id);
    else setItems(await removeShoppingItem(id));
  };

  // Order: open the item in the chosen store's search, in a browser over the app,
  // so it can be added to that store's cart. Marked as done here once opened.
  const orderItem = async (item: ShoppingItem) => {
    const store = STORES.find(st => st.key === orderStore);
    if (!store) return;
    setOrderedIds(prev => new Set(prev).add(item.id));
    try {
      await WebBrowser.openBrowserAsync(store.search(encodeURIComponent(item.name)), {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        controlsColor: colors.btnPrimary,
      });
    } catch {}
  };

  const changeSort = (mode: SortMode) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSortMode(mode);
    AsyncStorage.setItem(SORT_KEY, mode).catch(() => {});
  };

  const qtyStep = (delta: number) => {
    const n = parseFloat(newQty) || 0;
    const next = Math.max(0, Math.round((n + delta) * 100) / 100);
    setNewQty(next ? String(next) : '');
  };

  // ── Share ─────────────────────────────────────────────────────────────────

  const captureAndShare = async () => {
    if (!previewRef.current || capturing) return;
    setCapturing(true);
    try {
      const uri = await captureRef(previewRef, { format: 'png', quality: 1, result: 'tmpfile' });
      // Share BEFORE closing the modal — the native share sheet appears on top regardless,
      // and closing the modal first can prevent the share sheet from appearing on some devices.
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle: 'Share shopping list',
        UTI: 'public.png',
      });
      setShareView(null);
    } catch {
      // user cancelled or share unavailable — leave the preview open so they can retry
    } finally {
      setCapturing(false);
    }
  };

  const shareAsChecklist = async () => {
    try {
      await Share.share({ message: buildShareText(items) });
      setShareView(null);
    } catch { /* user cancelled — leave the preview open */ }
  };

  // ── List actions ─────────────────────────────────────────────────────────

  const handleToggle = async (id: string) => {
    if (householdId) {
      const item = items.find(i => i.id === id);
      if (!item) return;
      // Optimistic update; realtime subscription will confirm
      setItems(prev => prev.map(i => i.id === id ? { ...i, checked: !i.checked } : i));
      await toggleHouseholdShoppingItem(householdId, id, !item.checked);
    } else {
      setItems(await toggleShoppingItem(id));
    }
  };

  const handleClearChecked = async () => {
    const count = items.filter(i => i.checked).length;
    if (!count) return;
    Alert.alert(
      `Remove ${count} checked item${count !== 1 ? 's' : ''}?`,
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive', onPress: async () => {
            if (householdId) {
              await removeHouseholdCheckedItems(householdId);
              setItems(await loadHouseholdShoppingList(householdId));
            } else {
              setItems(await removeCheckedItems());
            }
          },
        },
      ],
    );
  };

  const handleClearAll = () => {
    if (!items.length) return;
    Alert.alert('Clear entire shopping list?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear all', style: 'destructive', onPress: async () => {
          if (householdId) {
            await clearHouseholdShoppingList(householdId);
          } else {
            await persistShoppingList([]);
          }
          setItems([]);
        },
      },
    ]);
  };

  // ── Derived ──────────────────────────────────────────────────────────────

  const unchecked    = items.filter(i => !i.checked);
  const checked      = items.filter(i => i.checked);
  const byName = (a: ShoppingItem, b: ShoppingItem) => a.name.localeCompare(b.name);
  const sections: [string, ShoppingItem[]][] = sortMode === 'alpha'
    ? [['All items', [...unchecked].sort(byName)]]
    : sortMode === 'recipe'
      ? [...groupByRecipe(unchecked).entries()].sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : 0))
      : AISLES
          .map(aisle => [aisle, unchecked.filter(i => aisleFor(i.name) === aisle).sort(byName)] as [string, ShoppingItem[]])
          .filter(([, list]) => list.length > 0);
  const onList = new Set(unchecked.map(i => i.name.toLowerCase()));
  const suggestions = recentNames.filter(n => !onList.has(n.toLowerCase())).slice(0, 8);
  const checkedCount = checked.length;

  // Card preview — cap at 12 items to fit the card
  const CARD_MAX    = 12;
  const cardItems   = unchecked.slice(0, CARD_MAX);
  const cardOverflow = Math.max(0, unchecked.length - CARD_MAX);
  const dateStr     = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // Shared card contents — rendered inside the off-screen capture target and the
  // image preview in the share sheet.
  const renderShareCard = () => (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <Text style={styles.cardBrand}>go<Text style={{ color: '#6DD4B0' }}>good</Text></Text>
        <Text style={styles.cardDate}>{dateStr}</Text>
      </View>
      <Text style={styles.cardTitle}>Shopping list</Text>
      <Text style={styles.cardSub}>{unchecked.length} item{unchecked.length !== 1 ? 's' : ''} to get</Text>
      <View style={styles.cardItemsContainer}>
        {cardItems.map((item, i) => (
          <View key={item.id} style={[styles.cardItemRow, i > 0 && styles.cardItemRowBorder]}>
            <View style={styles.cardCheckbox} />
            <Text style={styles.cardItemName} numberOfLines={1}>
              {item.name}
              {item.quantity ? <Text style={styles.cardItemQty}>  {item.quantity}{item.unit ? ` ${item.unit}` : ''}</Text> : null}
            </Text>
          </View>
        ))}
        {cardOverflow > 0 && (
          <View style={[styles.cardItemRow, styles.cardItemRowBorder]}>
            <Text style={styles.cardOverflow}>and {cardOverflow} more</Text>
          </View>
        )}
      </View>
    </>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const renderRow = (item: ShoppingItem, done: boolean, first: boolean) => (
    <TouchableOpacity
      key={item.id}
      style={[styles.itemRow, !first && styles.itemRowBorder]}
      onPress={() => handleToggle(item.id)}
      onLongPress={() => openEdit(item)}
      delayLongPress={350}
      activeOpacity={0.7}
    >
      <View style={[styles.checkbox, done && styles.checkboxChecked]}>
        {done ? <Text style={styles.checkMark}>✓</Text> : null}
      </View>
      <Text style={[styles.itemName, done && styles.itemNameDone]} numberOfLines={2}>{item.name}</Text>
      {item.quantity && !done ? (
        <Text style={styles.itemMeta}>{item.quantity}{item.unit ? ` ${item.unit}` : ''}</Text>
      ) : null}
    </TouchableOpacity>
  );

  return (
    <View style={styles.safe}>
      <StatusBar style={colors.statusBar} backgroundColor={colors.bg} />
      <Animated.View style={[styles.container, { opacity: screenFade, transform: [{ translateY: screenSlide }] }]}>

        {/* Header */}
        <Animated.View style={{ transform: [{ scale: heroScale }] }}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          {menuBtn}
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.headerLogo}>
              shopping<Text style={styles.headerLogoGreen}>list</Text>
            </Text>
            {householdId && <Text style={styles.householdBadge}>Shared with your household</Text>}
          </View>
          <HeaderAddButton onPress={() => openAdd()} accessibilityLabel="Add to shopping list" />
        </View>
        </Animated.View>

        <Animated.View style={{ flex: 1, opacity: cardsOpacity, transform: [{ translateY: cardsTranslateY }] }}>
        <View style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 30, gap: 16, paddingBottom: tabSpace + 24 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {items.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>Your list is empty</Text>
                <Text style={styles.emptySub}>Tap + to add something, or add ingredients from a recipe.</Text>
                {suggestions.length > 0 && (
                  <>
                    <Text style={[styles.groupLabel, { marginTop: 24, marginLeft: 0 }]}>Recently used up</Text>
                    <View style={styles.chipWrap}>
                      {suggestions.map(n => (
                        <TouchableOpacity key={n} style={[styles.chip, raised(isDark), { backgroundColor: colors.surface }]} onPress={() => addItems([{ name: n }])} activeOpacity={0.8}>
                          <Text style={styles.chipText}>+ {n}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}
              </View>
            ) : (
            <>
            {/* Sort */}
            {unchecked.length > 1 && (
              <View style={[styles.sortRow, { backgroundColor: colors.surfaceAlt }]}>
                {([['aisle', 'By aisle'], ['recipe', 'By recipe'], ['alpha', 'A–Z']] as [SortMode, string][]).map(([key, label]) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.sortBtn, sortMode === key && [{ backgroundColor: colors.surface }, raised(isDark)]]}
                    onPress={() => changeSort(key)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.sortText, { color: sortMode === key ? colors.text : colors.textSub }]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* To get, grouped by the chosen sort */}
            {sections.map(([title, group]) => (
              <View key={title}>
                <Text style={styles.groupLabel}>{title}</Text>
                <View style={styles.group}>
                  {group.map((item, i) => renderRow(item, false, i === 0))}
                </View>
              </View>
            ))}

            {/* Already picked up */}
            {checked.length > 0 && (
              <View>
                <View style={styles.groupHeaderRow}>
                  <Text style={[styles.groupLabel, { marginBottom: 0 }]}>In your cart · {checked.length}</Text>
                  <TouchableOpacity onPress={handleClearChecked} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.groupAction}>Clear</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.group}>
                  {checked.map((item, i) => renderRow(item, true, i === 0))}
                </View>
              </View>
            )}

            {/* Footer */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <TouchableOpacity
                style={[styles.footerBtn, raisedGreen(isDark, 'sm'), { backgroundColor: colors.btnPrimary, flex: 1 }]}
                onPress={() => setShareView('menu')}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 14, color: 'white', fontWeight: '700' }}>Share list</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.footerBtn, raised(isDark), { backgroundColor: colors.surface, flex: 1 }]}
                onPress={handleClearAll}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 14, color: colors.textSub, fontWeight: '600' }}>Clear all</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>Tap an item to check it off. Hold it to edit.</Text>
            </>
            )}
          </ScrollView>
          {/* Content fades out under the header, like the inventory list */}
          <EdgeFade color={colors.bg} edge="top" height={36} />
        </View>
        </Animated.View>

        {drawerEl}
      </Animated.View>

      {/* ── Add item ── */}
      <BottomSheet visible={addVisible} onClose={() => setAddVisible(false)}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" bounces={false} style={{ flexGrow: 0 }}>
        <Text style={styles.modalTitle}>{editingId ? 'Edit item' : 'Add item'}</Text>
        {!editingId && suggestions.length > 0 && !newName.trim() && (
          <View style={{ marginBottom: 12 }}>
            <Text style={styles.inputLabel}>Recently used up</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }} keyboardShouldPersistTaps="handled">
              {suggestions.map(n => (
                <TouchableOpacity key={n} style={[styles.chip, raised(isDark), { backgroundColor: colors.surface }]} onPress={() => setNewName(n)} activeOpacity={0.8}>
                  <Text style={styles.chipText}>{n}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
        <Text style={styles.inputLabel}>Item name</Text>
        <TextInput
          style={[styles.input, nameError && styles.inputError]}
          placeholder="e.g. Almond milk"
          placeholderTextColor={colors.placeholder}
          keyboardAppearance={isDark ? 'dark' : 'light'}
          value={newName}
          onChangeText={v => { setNewName(v); if (v.trim()) setNameError(false); }}
          autoFocus={!editingId}
          returnKeyType="next"
        />
        {nameError ? <Text style={styles.fieldError}>Enter an item name</Text> : null}
        {/* Quantity: type it or use − / + */}
        <Text style={[styles.inputLabel, { marginTop: 14 }]}>Quantity</Text>
        <View style={styles.stepRow}>
          <TouchableOpacity style={[styles.stepBtn, raised(isDark), { backgroundColor: colors.surface }]} onPress={() => qtyStep(-1)} activeOpacity={0.8}>
            <Text style={styles.stepText}>−</Text>
          </TouchableOpacity>
          <TextInput
            style={[styles.input, styles.stepInput, nudge && !newQty.trim() && styles.inputNudge]}
            placeholder="–"
            placeholderTextColor={colors.placeholder}
          keyboardAppearance={isDark ? 'dark' : 'light'}
            value={newQty}
            onChangeText={v => setNewQty(v.replace(/[^0-9.\/]/g, ''))}
            keyboardType="decimal-pad"
          />
          <TouchableOpacity style={[styles.stepBtn, raised(isDark), { backgroundColor: colors.surface }]} onPress={() => qtyStep(1)} activeOpacity={0.8}>
            <Text style={styles.stepText}>+</Text>
          </TouchableOpacity>
        </View>
        {nudge && !newQty.trim() ? <Text style={styles.fieldNudge}>How many? (optional)</Text> : null}

        {/* Unit: pick one */}
        <Text style={[styles.inputLabel, { marginTop: 14 }]}>Unit</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 6 }} keyboardShouldPersistTaps="handled">
          {(newUnit && !UNIT_CHOICES.includes(newUnit) ? [newUnit, ...UNIT_CHOICES] : UNIT_CHOICES).map(u => {
            const on = newUnit === u;
            return (
              <TouchableOpacity
                key={u}
                style={[styles.chip, raised(isDark), { backgroundColor: on ? colors.btnPrimary : colors.surface }, nudge && !newUnit && styles.chipNudge]}
                onPress={() => setNewUnit(on ? '' : u)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, on && { color: 'white' }]}>{u}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {nudge && !newUnit.trim() ? <Text style={styles.fieldNudge}>Pick a unit (optional)</Text> : null}
        {/* Soft check: a unit that doesn't usually fit this item ("1 can of butter") */}
        {(() => {
          const warn = nudge ? unitWarning(newName, newUnit) : null;
          if (!warn) return null;
          return (
            <View style={styles.unitWarn}>
              <Text style={styles.fieldNudge}>{warn.message}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                {warn.suggestions.map(u => (
                  <TouchableOpacity key={u} style={[styles.chip, raised(isDark), { backgroundColor: colors.surface }]} onPress={() => setNewUnit(u)} activeOpacity={0.8}>
                    <Text style={styles.chipText}>Use {u}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        })()}
        <TouchableOpacity
          style={[styles.addConfirmBtn, raisedGreen(isDark), { backgroundColor: colors.btnPrimary }]}
          onPress={handleAdd}
          activeOpacity={0.8}
        >
          <Text style={styles.addConfirmText}>
            {editingId ? 'Save' : nudge && (!newQty.trim() || !newUnit.trim() || unitWarning(newName, newUnit)) ? 'Add anyway' : 'Add to list'}
          </Text>
        </TouchableOpacity>
        {editingId && (
          <TouchableOpacity style={[styles.footerBtn, raised(isDark), { backgroundColor: colors.surface, marginTop: 10 }]} onPress={handleDelete} activeOpacity={0.8}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.goneBadText }}>Remove from list</Text>
          </TouchableOpacity>
        )}
        </ScrollView>
      </BottomSheet>

      {/* ── Off-screen capture target — always mounted, never interactive ── */}
      <View
        ref={previewRef}
        collapsable={false}
        pointerEvents="none"
        style={{ position: 'absolute', left: -4000, top: 0, width: 340 }}
      >
        <View style={styles.shareCard}>
          {renderShareCard()}
        </View>
      </View>

      {/* ── Share (same sheet as the rest of the app; pages switch inside it) ── */}
      <BottomSheet visible={shareView !== null} onClose={() => setShareView(null)}>
        <View style={styles.sheetHeader}>
          {shareView && shareView !== 'menu' ? (
            <TouchableOpacity onPress={() => setShareView(shareView === 'store' ? 'order' : 'menu')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.sheetBack}>‹ Back</Text>
            </TouchableOpacity>
          ) : <View />}
        </View>
        <Text style={[styles.modalTitle, { textAlign: 'center', marginBottom: 14 }]}>
          {shareView === 'image' ? 'Share as image'
            : shareView === 'text' ? 'Share as text'
            : shareView === 'order' ? 'Order items'
            : shareView === 'store' ? (STORES.find(st => st.key === orderStore)?.name ?? 'Order items')
            : 'Share your list'}
        </Text>
        {shareView === 'order' && (
          <Text style={styles.sheetSub}>Pick a store. Each item opens in its search so you can add it to your cart.</Text>
        )}
        {shareView === 'store' && (
          <Text style={styles.sheetSub}>Tap an item to find it and add it to your cart.</Text>
        )}

        <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
          {shareView === 'text' ? (
            <View style={[styles.textPreview, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.textPreviewText, { color: colors.text }]}>{buildShareText(items)}</Text>
            </View>
          ) : shareView === 'image' ? (
            <View style={styles.shareCard}>{renderShareCard()}</View>
          ) : shareView === 'order' ? (
            <View style={{ gap: 10 }}>
              {STORES.map(st => (
                <TouchableOpacity
                  key={st.key}
                  style={[styles.shareOption, raised(isDark, 'md'), { backgroundColor: colors.surface, paddingVertical: 14 }]}
                  onPress={() => { setOrderStore(st.key); setOrderedIds(new Set()); setShareView('store'); }}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>{st.name}</Text>
                    <Text style={{ fontSize: 12, color: colors.textSub, marginTop: 2 }}>{st.sub}</Text>
                  </View>
                  <Text style={{ fontSize: 20, color: colors.textMuted }}>›</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                onPress={() => { setShareView(null); setTimeout(() => router.push('/store-connections'), 350); }}
                style={{ alignItems: 'center', paddingVertical: 12 }}
                activeOpacity={0.7}
              >
                <Text style={styles.groupAction}>Connect a store account</Text>
              </TouchableOpacity>
            </View>
          ) : shareView === 'store' ? (
            (() => {
              const toOrder = items.filter(i => !i.checked);
              if (toOrder.length === 0) {
                return <Text style={[styles.emptySub, { paddingVertical: 24 }]}>Nothing left to order. Everything on your list is in the cart.</Text>;
              }
              return (
                <View style={styles.group}>
                  {toOrder.map((item, idx) => {
                    const done = orderedIds.has(item.id);
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.itemRow, idx > 0 && styles.itemRowBorder]}
                        onPress={() => orderItem(item)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.checkbox, done && styles.checkboxChecked]}>
                          {done && <Text style={{ color: 'white', fontSize: 13, fontWeight: '800' }}>✓</Text>}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 15, fontWeight: '600', color: done ? colors.textMuted : colors.text }} numberOfLines={1}>{item.name}</Text>
                          {item.quantity ? (
                            <Text style={{ fontSize: 12, color: colors.textSub, marginTop: 2 }}>{item.quantity}{item.unit ? ` ${item.unit}` : ''}</Text>
                          ) : null}
                        </View>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: done ? colors.textMuted : colors.teal }}>{done ? 'Again' : 'Find'}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })()
          ) : (
            <View style={{ gap: 10 }}>
              {[
                { key: 'image' as const, title: 'Share as image', sub: 'A card for Messages, Instagram, Mail and more' },
                { key: 'text' as const,  title: 'Share as text',  sub: 'A checklist for Messages, Notes or Reminders' },
                { key: 'order' as const, title: 'Order items',    sub: 'Add your list to a grocery store cart' },
              ].map(o => (
                <TouchableOpacity
                  key={o.key}
                  style={[styles.shareOption, raised(isDark, 'md'), { backgroundColor: colors.surface }]}
                  onPress={() => setShareView(o.key)}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>{o.title}</Text>
                    <Text style={{ fontSize: 12, color: colors.textSub, marginTop: 2 }}>{o.sub}</Text>
                  </View>
                  <Text style={{ fontSize: 20, color: colors.textMuted }}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>

        {(shareView === 'image' || shareView === 'text') && (
          <TouchableOpacity
            style={[styles.addConfirmBtn, raisedGreen(isDark), { backgroundColor: colors.btnPrimary, marginTop: 16, opacity: capturing ? 0.6 : 1 }]}
            onPress={shareView === 'image' ? captureAndShare : shareAsChecklist}
            disabled={capturing}
            activeOpacity={0.85}
          >
            <Text style={styles.addConfirmText}>{capturing ? 'Preparing…' : 'Share'}</Text>
          </TouchableOpacity>
        )}
      </BottomSheet>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function createStyles(c: ThemeColors, isDark = false) {
  return StyleSheet.create({
    safe:      { flex: 1, backgroundColor: c.bg },
    container: { flex: 1, backgroundColor: c.bg },

    header:           { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, backgroundColor: c.bg },
    headerLogo:       { fontSize: 24, fontWeight: '700', color: c.brand, fontFamily: 'Fraunces_600SemiBold' },
    headerLogoGreen:  { color: c.teal, fontFamily: 'Fraunces_600SemiBold' },
    householdBadge:   { fontSize: 11, color: c.textSub, marginTop: 1 },

    emptyState:  { alignItems: 'center', paddingHorizontal: 24, paddingTop: 48 },
    emptyTitle:  { fontSize: 20, fontWeight: '700', color: c.text, marginBottom: 8, fontFamily: 'Fraunces_600SemiBold' },
    emptySub:    { fontSize: 14, color: c.textSub, textAlign: 'center', lineHeight: 21 },

    groupLabel:     { fontSize: 11, fontWeight: '700', color: c.textMuted, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: 8, marginLeft: 6 },
    groupHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginHorizontal: 6 },
    groupAction:    { fontSize: 13, fontWeight: '600', color: c.textSub },
    group:          { backgroundColor: c.surface, borderRadius: 16, paddingHorizontal: 14, ...raised(isDark, 'md') },

    itemRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
    itemRowBorder:  { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    checkbox:       { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: c.textMuted, alignItems: 'center', justifyContent: 'center' },
    checkboxChecked:{ backgroundColor: c.btnPrimary, borderColor: c.btnPrimary },
    checkMark:      { fontSize: 12, color: 'white', fontWeight: '800', lineHeight: 15 },
    itemName:       { fontSize: 15, fontWeight: '500', color: c.text, flex: 1 },
    itemNameDone:   { textDecorationLine: 'line-through', color: c.textMuted },
    itemMeta:       { fontSize: 13, color: c.textSub },

    sortRow:    { flexDirection: 'row', borderRadius: 14, padding: 4, marginTop: -4 },
    sortBtn:    { flex: 1, paddingVertical: 8, borderRadius: 11, alignItems: 'center' },
    sortText:   { fontSize: 13, fontWeight: '600' },
    chipWrap:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
    chip:       { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
    chipText:   { fontSize: 13, fontWeight: '600', color: c.textSub },
    chipNudge:  { borderColor: '#D69A2D' },
    stepRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
    stepBtn:    { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    stepText:   { fontSize: 22, fontWeight: '500', color: c.text, lineHeight: 26 },
    stepInput:  { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
    unitWarn:   { marginTop: 6 },
    hint:       { fontSize: 12, color: c.textMuted, textAlign: 'center', marginTop: -4 },
    footerBtn:  { paddingHorizontal: 16, paddingVertical: 13, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },

    modalTitle:     { fontSize: 18, fontWeight: '700', color: c.text, fontFamily: 'Fraunces_600SemiBold', marginBottom: 14 },
    inputLabel:     { fontSize: 12, fontWeight: '600', color: c.textSub, marginBottom: 6 },
    input:          { backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.inputText },
    inputError:     { borderColor: '#E0574A' },
    fieldError:     { fontSize: 11, color: '#E0574A', marginTop: 4 },
    inputNudge:     { borderColor: '#D69A2D' },
    fieldNudge:     { fontSize: 11, color: '#B7801F', marginTop: 4 },
    addConfirmBtn:  { borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
    addConfirmText: { color: '#fff', fontWeight: '700', fontSize: 15 },

    sheetHeader:  { minHeight: 20, marginTop: -6, marginBottom: 2 },
    sheetBack:    { fontSize: 15, fontWeight: '600', color: c.textSub },
    sheetSub:     { fontSize: 13, color: c.textSub, textAlign: 'center', lineHeight: 19, marginTop: -6, marginBottom: 14, paddingHorizontal: 12 },
    shareOption:  { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, padding: 16 },
    textPreview:     { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 18 },
    textPreviewText: { fontSize: 15, lineHeight: 26, fontWeight: '500' },

    // Share card (always dark green so it looks the same wherever it's sent)
    shareCard:          { backgroundColor: '#0F7855', borderRadius: 22, padding: 22, overflow: 'hidden' },
    cardBrand:          { fontSize: 20, fontWeight: '800', color: 'white', fontFamily: 'Fraunces_600SemiBold' },
    cardDate:           { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
    cardTitle:          { fontSize: 22, fontWeight: '800', color: 'white', fontFamily: 'Fraunces_600SemiBold' },
    cardSub:            { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2, marginBottom: 14 },
    cardItemsContainer: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 14, overflow: 'hidden' },
    cardItemRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
    cardItemRowBorder:  { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.15)' },
    cardCheckbox:       { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)' },
    cardItemName:       { fontSize: 14, color: 'white', fontWeight: '500', flex: 1 },
    cardItemQty:        { fontSize: 12, color: 'rgba(255,255,255,0.6)', fontWeight: '400' },
    cardOverflow:       { fontSize: 12, color: 'rgba(255,255,255,0.6)', paddingLeft: 28 },
  });
}
