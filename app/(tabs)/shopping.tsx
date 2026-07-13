import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Animated, Alert, Share, Modal, TextInput, KeyboardAvoidingView,
  Platform, TouchableWithoutFeedback, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, type ThemeColors } from '../context/theme';
import { useAppDrawer } from '../components/AppDrawer';
import { HOUSEHOLD_KEY } from '../lib/household';
import {
  type ShoppingItem,
  loadShoppingList, toggleShoppingItem,
  removeCheckedItems, persistShoppingList, addToShoppingList,
  loadHouseholdShoppingList, addToHouseholdShoppingList,
  toggleHouseholdShoppingItem, removeHouseholdCheckedItems,
  clearHouseholdShoppingList, subscribeToHouseholdShoppingList,
} from '../lib/shopping-list';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupByRecipe(items: ShoppingItem[]): Map<string, ShoppingItem[]> {
  const map = new Map<string, ShoppingItem[]>();
  for (const item of items) {
    const key = item.recipeName || '📝 Other';
    const group = map.get(key) ?? [];
    group.push(item);
    map.set(key, group);
  }
  return map;
}

function buildShareText(items: ShoppingItem[]): string {
  const unchecked = items.filter(i => !i.checked);
  const done      = items.filter(i => i.checked);
  const lines: string[] = ['🛒 Shopping List\n'];
  for (const item of unchecked) {
    const qty = item.quantity ? ` — ${item.quantity}${item.unit ? ' ' + item.unit : ''}` : '';
    lines.push(`☐ ${item.name}${qty}`);
  }
  if (done.length) {
    lines.push('\n✓ Picked up:');
    for (const item of done) lines.push(`✓ ${item.name}`);
  }
  return lines.join('\n');
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ShoppingScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const { menuBtn, drawerEl } = useAppDrawer();

  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [addVisible, setAddVisible]   = useState(false);
  const [newName, setNewName]         = useState('');
  const [newQty, setNewQty]           = useState('');
  const [newUnit, setNewUnit]         = useState('');

  // Share card
  const [shareVisible, setShareVisible] = useState(false);
  const [shareMounted, setShareMounted] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [imageFull, setImageFull] = useState(false);   // full-screen image-card preview
  const [textFull, setTextFull]   = useState(false);   // full-screen checklist-text preview
  const previewRef       = useRef<View>(null);
  const shareOverlayAnim = useRef(new Animated.Value(0)).current;
  const shareSheetAnim   = useRef(new Animated.Value(700)).current;

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
    AsyncStorage.getItem(HOUSEHOLD_KEY).then(async hhId => {
      setHouseholdId(hhId);
      const loaded = hhId
        ? await loadHouseholdShoppingList(hhId)
        : await loadShoppingList();
      setItems(loaded);
    });
  }, []));

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

  const openAdd = () => { setNewName(''); setNewQty(''); setNewUnit(''); setAddVisible(true); };

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    const newItem = { name, quantity: newQty.trim() || undefined, unit: newUnit.trim() || undefined };
    if (householdId) {
      const updated = await addToHouseholdShoppingList(householdId, [newItem]);
      setItems(updated);
    } else {
      const updated = await addToShoppingList([newItem]);
      setItems(updated);
    }
    setAddVisible(false);
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
        dialogTitle: 'Share shopping list 🛒',
        UTI: 'public.png',
      });
      setImageFull(false);
      setShareVisible(false);
    } catch {
      // user cancelled or share unavailable — leave the preview open so they can retry
    } finally {
      setCapturing(false);
    }
  };

  const shareAsChecklist = async () => {
    try {
      await Share.share({ message: buildShareText(items) });
      setTextFull(false);
      setShareVisible(false);
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
  const grouped      = groupByRecipe(unchecked);
  const checkedCount = checked.length;

  // Card preview — cap at 12 items to fit the card
  const CARD_MAX    = 12;
  const cardItems   = unchecked.slice(0, CARD_MAX);
  const cardOverflow = Math.max(0, unchecked.length - CARD_MAX);
  const dateStr     = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // Shared card contents — rendered inside the off-screen capture target, the
  // chooser sheet preview, and the full-screen image preview.
  const renderShareCard = () => (
    <>
      <View style={styles.cardBlob1} />
      <View style={styles.cardBlob2} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <Text style={styles.cardBrand}>go<Text style={{ color: '#5DCAA5' }}>good</Text></Text>
        <View style={styles.cardDatePill}>
          <Text style={styles.cardDatePillText}>{dateStr.toUpperCase()}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Text style={{ fontSize: 22 }}>🛒</Text>
        <View>
          <Text style={styles.cardTitle}>Shopping List</Text>
          <Text style={styles.cardSub}>{unchecked.length} item{unchecked.length !== 1 ? 's' : ''} to grab</Text>
        </View>
      </View>
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
            <Text style={styles.cardOverflow}>+ {cardOverflow} more item{cardOverflow !== 1 ? 's' : ''}</Text>
          </View>
        )}
      </View>
      <Text style={styles.cardFooter}>shared from GoGood · reduce food waste 🌱</Text>
    </>
  );

  // ── Render ────────────────────────────────────────────────────────────────

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
            {householdId && (
              <Text style={styles.householdBadge}>🏠 household</Text>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {checkedCount > 0 && (
              <TouchableOpacity onPress={handleClearChecked} style={styles.clearBtn}>
                <Text style={styles.clearBtnText}>✓ clear</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={openAdd} style={styles.addBtn}>
              <Text style={styles.addBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
        </Animated.View>

        <Animated.View style={{ flex: 1, opacity: cardsOpacity, transform: [{ translateY: cardsTranslateY }] }}>
        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={{ fontSize: 64, marginBottom: 20 }}>🛒</Text>
            <Text style={styles.emptyTitle}>Your list is empty</Text>
            <Text style={styles.emptySub}>
              Add items using the + button, from Good Bot recipes, or via the recipe screen.
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Unchecked items grouped by recipe */}
            {[...grouped.entries()].map(([recipeName, group]) => (
              <View key={recipeName} style={styles.group}>
                <Text style={styles.groupLabel}>{recipeName}</Text>
                {group.map(item => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.itemRow}
                    onPress={() => handleToggle(item.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, { borderColor: colors.teal }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemName}>{item.icon ? `${item.icon} ` : ''}{item.name}</Text>
                      {item.quantity ? (
                        <Text style={styles.itemMeta}>
                          {item.quantity}{item.unit ? ` ${item.unit}` : ''}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ))}

            {/* Checked / done items */}
            {checked.length > 0 && (
              <View style={styles.group}>
                <Text style={[styles.groupLabel, { color: colors.textMuted }]}>
                  ✓ PICKED UP · {checked.length}
                </Text>
                {checked.map(item => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.itemRow}
                    onPress={() => handleToggle(item.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, styles.checkboxChecked, { borderColor: colors.teal, backgroundColor: colors.teal }]}>
                      <Text style={{ fontSize: 11, color: 'white', fontWeight: '800', lineHeight: 16 }}>✓</Text>
                    </View>
                    <Text style={[styles.itemName, styles.itemNameDone]}>{item.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Footer */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <TouchableOpacity
                style={[styles.footerBtn, { backgroundColor: colors.btnPrimary, borderColor: colors.btnPrimary, flex: 1 }]}
                onPress={() => setShareVisible(true)}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 13, color: 'white', fontWeight: '700' }}>🛒  Share list</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.footerBtn, { borderColor: colors.border, flex: 1 }]}
                onPress={handleClearAll}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 13, color: colors.textMuted }}>Clear all</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
        </Animated.View>

        {/* Add Item Modal */}
        <Modal visible={addVisible} transparent animationType="slide" onRequestClose={() => setAddVisible(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); setAddVisible(false); }}>
              <View style={styles.modalOverlay}>
                <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                  <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
                    <View style={styles.modalHandle} />
                    <Text style={styles.modalTitle}>Add item</Text>
                    <Text style={styles.inputLabel}>Item name</Text>
                    <TextInput
                      style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                      placeholder="e.g. Almond milk"
                      placeholderTextColor={colors.textMuted}
                      value={newName}
                      onChangeText={setNewName}
                      autoFocus
                      returnKeyType="next"
                    />
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.inputLabel}>Quantity</Text>
                        <TextInput
                          style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                          placeholder="e.g. 2"
                          placeholderTextColor={colors.textMuted}
                          value={newQty}
                          onChangeText={setNewQty}
                          keyboardType="decimal-pad"
                          returnKeyType="next"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.inputLabel}>Unit</Text>
                        <TextInput
                          style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                          placeholder="e.g. cups"
                          placeholderTextColor={colors.textMuted}
                          value={newUnit}
                          onChangeText={setNewUnit}
                          returnKeyType="done"
                          onSubmitEditing={handleAdd}
                        />
                      </View>
                    </View>
                    <TouchableOpacity
                      style={[styles.addConfirmBtn, { backgroundColor: colors.teal, opacity: newName.trim() ? 1 : 0.4 }]}
                      onPress={handleAdd}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.addConfirmText}>Add to list</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableWithoutFeedback>
              </View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </Modal>

        {drawerEl}
      </Animated.View>

      {/* ── Off-screen capture target — always mounted, never interactive ── */}
      <View
        ref={previewRef}
        collapsable={false}
        pointerEvents="none"
        style={{ position: 'absolute', left: -4000, top: 0, width: 340 }}
      >
        <View style={[styles.shareCard, { minHeight: undefined }]}>
          {renderShareCard()}
        </View>
      </View>

      {/* ── Share Card Sheet ── */}
      {shareMounted && (
        <Modal visible={shareMounted} transparent animationType="none" onRequestClose={() => setShareVisible(false)}>
          <View style={{ flex: 1 }}>
            <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)', opacity: shareOverlayAnim }]} />
            <TouchableOpacity style={{ flex: 1 }} onPress={() => setShareVisible(false)} activeOpacity={1} />

            <Animated.View style={[styles.shareSheet, { backgroundColor: colors.surface, transform: [{ translateY: shareSheetAnim }] }]}>
              <View style={{ width: 36, height: 4, backgroundColor: colors.border, borderRadius: 999, alignSelf: 'center', marginBottom: 12 }} />

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 44 }}>

                {/* ── Card preview ── */}
                <View style={styles.shareCard}>
                  {renderShareCard()}
                </View>

                {/* ── Actions ── */}
                <Text style={[styles.shareTitle, { color: colors.text }]}>Share your list 🛒</Text>
                <Text style={[styles.shareSub, { color: colors.textMuted }]}>
                  Preview full-screen, then send to Messages, Notes, or any app.
                </Text>

                {/* Share as image → full-screen preview */}
                <TouchableOpacity
                  style={[styles.shareActionBtn, { backgroundColor: colors.btnPrimary }]}
                  onPress={() => { setShareVisible(false); setTimeout(() => setImageFull(true), 260); }}
                  activeOpacity={0.85}
                >
                  <Text style={{ fontSize: 20 }}>📸</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.shareActionTitle}>Share as image card</Text>
                    <Text style={styles.shareActionSub}>Messages, Instagram, Notes, Mail + more</Text>
                  </View>
                </TouchableOpacity>

                {/* Share as checklist text → full-screen preview */}
                <TouchableOpacity
                  style={[styles.shareActionBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.teal }]}
                  onPress={() => { setShareVisible(false); setTimeout(() => setTextFull(true), 260); }}
                  activeOpacity={0.85}
                >
                  <Text style={{ fontSize: 20 }}>📋</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.shareActionTitle, { color: colors.text }]}>Share as checklist text</Text>
                    <Text style={[styles.shareActionSub, { color: colors.textMuted }]}>
                      ☐ checkbox format → Messages, Notes, Reminders
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setShareVisible(false)} style={{ alignItems: 'center', paddingVertical: 4 }}>
                  <Text style={{ color: colors.textMuted, fontSize: 13 }}>cancel</Text>
                </TouchableOpacity>
              </ScrollView>
            </Animated.View>
          </View>
        </Modal>
      )}

      {/* ── Full-screen: Share as image card ── */}
      <Modal visible={imageFull} animationType="slide" onRequestClose={() => setImageFull(false)}>
        <View style={[styles.fullScreen, { backgroundColor: colors.bg }]}>
          <View style={[styles.fullHeader, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
            <Text style={[styles.fullTitle, { color: colors.text }]}>Share as image</Text>
            <TouchableOpacity
              onPress={() => setImageFull(false)}
              style={[styles.fullClose, { backgroundColor: colors.chipBg }]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={[styles.fullCloseText, { color: colors.text }]}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.fullBody} showsVerticalScrollIndicator={false}>
            <View style={styles.shareCard}>
              {renderShareCard()}
            </View>
          </ScrollView>

          <View style={[styles.fullFooter, { paddingBottom: insets.bottom + 16, borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.fullShareBtn, { backgroundColor: colors.btnPrimary, opacity: capturing ? 0.6 : 1 }]}
              onPress={captureAndShare}
              disabled={capturing}
              activeOpacity={0.85}
            >
              <Text style={styles.fullShareBtnText}>{capturing ? 'Preparing…' : '📸  Share image'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Full-screen: Share as checklist text ── */}
      <Modal visible={textFull} animationType="slide" onRequestClose={() => setTextFull(false)}>
        <View style={[styles.fullScreen, { backgroundColor: colors.bg }]}>
          <View style={[styles.fullHeader, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
            <Text style={[styles.fullTitle, { color: colors.text }]}>Share as text</Text>
            <TouchableOpacity
              onPress={() => setTextFull(false)}
              style={[styles.fullClose, { backgroundColor: colors.chipBg }]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={[styles.fullCloseText, { color: colors.text }]}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.fullBody} showsVerticalScrollIndicator={false}>
            <View style={[styles.textPreview, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.textPreviewText, { color: colors.text }]}>{buildShareText(items)}</Text>
            </View>
          </ScrollView>

          <View style={[styles.fullFooter, { paddingBottom: insets.bottom + 16, borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.fullShareBtn, { backgroundColor: colors.btnPrimary }]}
              onPress={shareAsChecklist}
              activeOpacity={0.85}
            >
              <Text style={styles.fullShareBtnText}>📋  Share text</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function createStyles(c: ThemeColors, isDark = false) {
  return StyleSheet.create({
    safe:      { flex: 1, backgroundColor: c.bg },
    container: { flex: 1, backgroundColor: c.bg },

    header:           { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, backgroundColor: c.bg, borderBottomWidth: 0.5, borderBottomColor: c.border, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 3 },
    headerLogo:       { fontSize: 24, fontWeight: '700', color: c.brand, fontFamily: 'Fraunces_600SemiBold' },
    headerLogoGreen:  { color: c.teal, fontFamily: 'Fraunces_600SemiBold' },
    householdBadge:   { fontSize: 10, fontWeight: '600', color: c.teal, letterSpacing: 0.4, marginTop: 1 },
    clearBtn:         { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, backgroundColor: c.chipBg, borderWidth: 1, borderColor: c.teal },
    clearBtnText:     { fontSize: 12, color: c.teal, fontWeight: '700' },

    emptyState:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
    emptyTitle:  { fontSize: 20, fontWeight: '700', color: c.text, marginBottom: 12, fontFamily: 'Fraunces_600SemiBold' },
    emptySub:    { fontSize: 14, color: c.textSub, textAlign: 'center', lineHeight: 22, marginBottom: 28 },

    group:      { backgroundColor: c.surface, borderRadius: 16, padding: 14, borderWidth: 0.5, borderColor: c.border, gap: 0 },
    groupLabel: { fontSize: 10, fontWeight: '700', color: c.textSub, letterSpacing: 1, marginBottom: 10 },

    itemRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 0.5, borderTopColor: c.border },
    checkbox:       { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
    checkboxChecked:{ },
    itemName:       { fontSize: 14, fontWeight: '500', color: c.text, flex: 1 },
    itemNameDone:   { textDecorationLine: 'line-through', color: c.textMuted },
    itemMeta:       { fontSize: 11, color: c.textMuted, marginTop: 1 },

    footerBtn:  { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 0.5, alignItems: 'center', justifyContent: 'center' },

    addBtn:     { width: 34, height: 34, borderRadius: 17, backgroundColor: c.teal, alignItems: 'center', justifyContent: 'center' },
    addBtnText: { fontSize: 22, color: '#fff', fontWeight: '300', lineHeight: 26, marginTop: -1 },

    modalOverlay:   { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
    modalSheet:     { backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingTop: 12, gap: 12 },
    modalHandle:    { width: 40, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: 12 },
    modalTitle:     { fontSize: 18, fontWeight: '700', color: c.text, fontFamily: 'Fraunces_600SemiBold', marginBottom: 4 },
    inputLabel:     { fontSize: 12, fontWeight: '600', color: c.textSub, marginBottom: 4, letterSpacing: 0.4 },
    input:          { backgroundColor: c.bg, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
    addConfirmBtn:  { borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
    addConfirmText: { color: '#fff', fontWeight: '700', fontSize: 15 },

    // Share sheet
    shareSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 14, maxHeight: '90%' },
    shareTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center', fontFamily: 'Fraunces_600SemiBold' },
    shareSub:   { fontSize: 13, textAlign: 'center', marginTop: -8, lineHeight: 19 },

    shareActionBtn:  { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, padding: 16 },
    shareActionTitle:{ fontSize: 14, fontWeight: '700', color: 'white' },
    shareActionSub:  { fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 1 },

    // Full-screen share previews
    fullScreen:    { flex: 1 },
    fullHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 0.5 },
    fullTitle:     { fontSize: 18, fontWeight: '700', fontFamily: 'Fraunces_600SemiBold' },
    fullClose:     { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    fullCloseText: { fontSize: 15, fontWeight: '700' },
    fullBody:      { flexGrow: 1, justifyContent: 'center', padding: 20, paddingBottom: 32 },
    fullFooter:    { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 0.5 },
    fullShareBtn:  { borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
    fullShareBtnText: { fontSize: 15, fontWeight: '700', color: 'white' },
    textPreview:     { borderRadius: 16, borderWidth: 1, padding: 18 },
    textPreviewText: { fontSize: 15, lineHeight: 26, fontWeight: '500' },

    // Share card (always dark green for branding)
    shareCard: {
      backgroundColor: '#085041',
      borderRadius: 24,
      padding: 22,
      overflow: 'hidden',
      minHeight: 320,
    },
    cardBlob1: { position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(93,202,165,0.14)' },
    cardBlob2: { position: 'absolute', bottom: -30, left: -30, width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.05)' },

    cardBrand:       { fontSize: 20, fontWeight: '800', color: 'white', fontFamily: 'Fraunces_600SemiBold' },
    cardDatePill:    { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    cardDatePillText:{ fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.7)', letterSpacing: 0.8 },

    cardTitle: { fontSize: 20, fontWeight: '800', color: 'white', fontFamily: 'Fraunces_600SemiBold' },
    cardSub:   { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 },

    cardItemsContainer: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, marginBottom: 16, overflow: 'hidden' },
    cardItemRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
    cardItemRowBorder:  { borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.1)' },
    cardCheckbox:       { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: 'rgba(93,202,165,0.8)' },
    cardItemName:       { fontSize: 13, color: 'white', fontWeight: '500', flex: 1 },
    cardItemQty:        { fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: '400' },
    cardOverflow:       { fontSize: 12, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic', paddingLeft: 28 },

    cardFooter: { fontSize: 10, color: 'rgba(255,255,255,0.35)', textAlign: 'center', marginTop: 4 },
  });
}
