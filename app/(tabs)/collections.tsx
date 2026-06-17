import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, Animated, Platform, KeyboardAvoidingView, Modal,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme, type ThemeColors } from '../context/theme';
import { useAppDrawer } from '../components/AppDrawer';
import { useSubscription } from '../context/subscription';
import { useAuth } from '../context/auth';
import { HOUSEHOLD_KEY } from '../lib/household';
import {
  type Collection, type SavedRecipe,
  loadCollections, loadSavedRecipes,
  persistCollections, persistSavedRecipes, parseRecipeName,
} from '../lib/collections';
import { pushItems } from '../lib/sync';
import {
  migrateLocalCollectionsToSupabase,
  pushCollections,
  pushSavedRecipes,
  pullHouseholdSharedRecipes,
  subscribeToHouseholdRecipes,
  shareRecipeWithHousehold,
  unshareRecipe,
} from '../lib/collections-sync';
import { PortionDeductionSheet } from '../components/PortionDeductionSheet';

// ─── Constants ───────────────────────────────────────────────────────────────

const EMOJIS = ['🍳','🥗','🍝','🥘','🍲','🥩','🐟','🥦','🍜','🌮','🍱','🫕','🥐','🌯','🍛','🍣'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7)  return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

function Markdown({ text, style, boldStyle }: { text: string; style: any; boldStyle: any }) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return (
    <Text style={style}>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <Text key={i} style={boldStyle}>{p.slice(2, -2)}</Text>
          : p
      )}
    </Text>
  );
}

/** Extract the base serving count from recipe text / stored macros */
function extractServings(content: string, macroServings?: number): number {
  if (macroServings && macroServings > 0) return macroServings;
  const m = content.match(/(?:serves?|servings?|yield)[:\s]*(\d+)/i)
    || content.match(/(\d+)\s*(?:servings?|portions?|people)/i)
    || content.match(/makes?\s*(\d+)/i);
  return m ? Math.max(1, parseInt(m[1])) : 4;
}

/** Format a scaled decimal as a human-friendly fraction string */
function scaleValue(n: number, factor: number): string {
  const scaled = n * factor;
  if (scaled <= 0) return '0';
  const fracs: [number, string][] = [
    [0.125,'⅛'],[0.25,'¼'],[0.33,'⅓'],[0.5,'½'],[0.67,'⅔'],[0.75,'¾'],
    [1.25,'1¼'],[1.33,'1⅓'],[1.5,'1½'],[1.67,'1⅔'],[1.75,'1¾'],
    [2.5,'2½'],[3.5,'3½'],
  ];
  for (const [v, s] of fracs) {
    if (Math.abs(scaled - v) < 0.1) return s;
  }
  const rounded = Math.round(scaled * 4) / 4;
  if (Number.isInteger(rounded)) return String(rounded);
  return scaled.toFixed(1);
}

/** Scale ingredient quantities in the ingredients section of a recipe */
function scaleContent(content: string, factor: number): string {
  if (Math.abs(factor - 1) < 0.05) return content;
  const lines = content.split('\n');
  let inIngredients = false;
  return lines.map(line => {
    if (/ingredients?/i.test(line) && (/\*\*/.test(line) || /^#+\s/.test(line))) {
      inIngredients = true; return line;
    }
    if (/instructions?|directions?|method|steps?/i.test(line) && (/\*\*/.test(line) || /^#+\s/.test(line))) {
      inIngredients = false; return line;
    }
    if (!inIngredients || !/^\s*[-•*]/.test(line)) return line;
    // Scale numbers in ingredient lines; skip temperatures (followed by °)
    return line.replace(/\b(\d+(?:\/\d+)?|\d*\.\d+)\b(?!\s*°)/g, (match) => {
      let n: number;
      if (match.includes('/')) {
        const [a, b] = match.split('/');
        n = Number(a) / Number(b);
      } else {
        n = parseFloat(match);
      }
      if (!n || n === 0 || isNaN(n)) return match;
      return scaleValue(n, factor);
    });
  }).join('\n');
}

/** Move selected inventory items to the gone-good history */
async function markItemsGoneGood(itemIds: Set<number>): Promise<void> {
  const [itemsRaw, goodRaw, statsRaw] = await Promise.all([
    AsyncStorage.getItem('gogood_items'),
    AsyncStorage.getItem('gogood_gone_good'),
    AsyncStorage.getItem('gogood_stats'),
  ]);
  const items: any[]  = itemsRaw ? JSON.parse(itemsRaw) : [];
  const good: any[]   = goodRaw  ? JSON.parse(goodRaw)  : [];
  const stats: any    = statsRaw ? JSON.parse(statsRaw) : { goneGood: 0, goneBad: 0, totalAdded: 0 };
  const now           = new Date().toISOString();
  const used          = items.filter(it => itemIds.has(it.id));
  const remaining     = items.filter(it => !itemIds.has(it.id));
  const newEntries    = used.map(it => ({
    id:         it.id,
    name:       it.baseName || it.name || 'Item',
    icon:       it.icon || '🥘',
    date:       now,
    expiryDate: it.expiryDate || now,
    category:   it.foodCategory || it.category || '',
  }));
  await Promise.all([
    AsyncStorage.setItem('gogood_items',     JSON.stringify(remaining)),
    AsyncStorage.setItem('gogood_gone_good', JSON.stringify([...newEntries, ...good])),
    AsyncStorage.setItem('gogood_stats',     JSON.stringify({
      ...stats, goneGood: (stats.goneGood || 0) + used.length,
    })),
  ]);
}

// ─── StarRating ──────────────────────────────────────────────────────────────

function StarRating({ rating, onChange, size = 22, readonly = false }: {
  rating?: number; onChange?: (r: number) => void; size?: number; readonly?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <TouchableOpacity
          key={i}
          onPress={() => !readonly && onChange?.(i === rating ? 0 : i)}
          disabled={readonly}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
        >
          <Text style={{ fontSize: size, color: (rating ?? 0) >= i ? '#F5A623' : '#D0D5DD' }}>★</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── CookItSheet ─────────────────────────────────────────────────────────────

function CookItSheet({ visible, onClose, onConfirm, colors }: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (itemIds: Set<number>) => Promise<void>;
  colors: ThemeColors;
}) {
  const slideAnim    = useRef(new Animated.Value(700)).current;
  const fadeAnim     = useRef(new Animated.Value(0)).current;
  const [mounted,    setMounted]    = useState(false);
  const [items,      setItems]      = useState<any[]>([]);
  const [selected,   setSelected]   = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setSelected(new Set());
      setConfirming(false);
      slideAnim.setValue(700); fadeAnim.setValue(0);
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, damping: 28, stiffness: 180, useNativeDriver: true }),
      ]).start();
      AsyncStorage.getItem('gogood_items').then(raw => {
        setItems(raw ? JSON.parse(raw) : []);
      });
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 0, duration: 240, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 700, duration: 260, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [visible]);

  if (!mounted) return null;

  const toggle = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleConfirm = async () => {
    setConfirming(true);
    try { await onConfirm(selected); } finally { setConfirming(false); }
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)', opacity: fadeAnim }]} pointerEvents="none" />
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
        <Animated.View style={{
          backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
          maxHeight: '80%', transform: [{ translateY: slideAnim }],
        }}>
          <View style={{ width: 36, height: 4, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 999, alignSelf: 'center', marginTop: 12, marginBottom: 4 }} />

          <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.brand, fontFamily: 'Fraunces_600SemiBold' }}>
              🍳 What did you use?
            </Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
              Check items you used — they'll be marked gone good 🌱
            </Text>
          </View>

          {items.length === 0 ? (
            <View style={{ alignItems: 'center', padding: 36, gap: 10 }}>
              <Text style={{ fontSize: 36 }}>🛒</Text>
              <Text style={{ fontSize: 14, color: colors.textSub, textAlign: 'center', lineHeight: 20 }}>
                Your inventory is empty.{'\n'}Add items on the Home tab first.
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
              {items.map((item: any) => {
                const checked = selected.has(item.id);
                return (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => toggle(item.id)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      paddingVertical: 12,
                      borderBottomWidth: 0.5, borderBottomColor: colors.border,
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={{
                      width: 22, height: 22, borderRadius: 6,
                      borderWidth: 1.5,
                      borderColor: checked ? colors.teal : colors.border,
                      backgroundColor: checked ? colors.teal : 'transparent',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      {checked && <Text style={{ fontSize: 12, color: 'white', fontWeight: '800', lineHeight: 16 }}>✓</Text>}
                    </View>
                    <Text style={{ fontSize: 20 }}>{item.icon || '🥘'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: '500', color: colors.text }}>
                        {item.baseName || item.name || 'Item'}
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>
                        {item.category} · expires {item.expires || 'unknown'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          <View style={{ paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 0.5, borderTopColor: colors.border }}>
            <TouchableOpacity
              style={{
                backgroundColor: colors.btnPrimary, borderRadius: 14, paddingVertical: 14,
                alignItems: 'center',
                opacity: confirming ? 0.7 : 1,
              }}
              onPress={handleConfirm}
              disabled={confirming}
            >
              {confirming
                ? <ActivityIndicator color="white" />
                : <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>
                    {selected.size > 0
                      ? `✓ Mark ${selected.size} item${selected.size !== 1 ? 's' : ''} gone good`
                      : 'Done — nothing used from inventory'}
                  </Text>
              }
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── MoveSheet ───────────────────────────────────────────────────────────────

function MoveSheet({ visible, onClose, collections, currentId, onMove, onCreateCategory, colors }: {
  visible: boolean;
  onClose: () => void;
  collections: Collection[];
  currentId: string;
  onMove: (collectionId: string) => void;
  onCreateCategory: () => void;
  colors: ThemeColors;
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
        Animated.spring(slideAnim, { toValue: 0, damping: 28, stiffness: 180, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 600, duration: 240, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [visible]);

  if (!mounted) return null;

  const options = [{ id: '', name: 'Uncategorized', emoji: '📌' }, ...collections];

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)', opacity: fadeAnim }]} pointerEvents="none" />
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
        <Animated.View style={{
          backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
          padding: 20, paddingBottom: 44, transform: [{ translateY: slideAnim }],
        }}>
          <View style={{ width: 36, height: 4, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 999, alignSelf: 'center', marginBottom: 18 }} />
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.brand, fontFamily: 'Fraunces_600SemiBold', marginBottom: 14 }}>
            Move to collection
          </Text>
          {options.map(col => {
            const isCurrent = col.id === currentId;
            return (
              <TouchableOpacity
                key={col.id || 'uncategorized'}
                onPress={() => !isCurrent && onMove(col.id)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 14,
                  paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14,
                  backgroundColor: isCurrent ? 'rgba(8,80,65,0.08)' : 'transparent',
                  marginBottom: 4,
                }}
                disabled={isCurrent}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 24 }}>{col.emoji}</Text>
                <Text style={{ flex: 1, fontSize: 15, fontWeight: isCurrent ? '700' : '500', color: isCurrent ? colors.teal : colors.text }}>
                  {col.name}
                </Text>
                {isCurrent && <Text style={{ fontSize: 11, color: colors.teal }}>current</Text>}
              </TouchableOpacity>
            );
          })}
          <View style={{ height: 0.5, backgroundColor: colors.border, marginVertical: 8 }} />
          <TouchableOpacity
            onPress={onCreateCategory}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 14,
              paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14,
            }}
            activeOpacity={0.7}
          >
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.chipBg, borderWidth: 1, borderColor: colors.teal, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 18, color: colors.teal, lineHeight: 22 }}>+</Text>
            </View>
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.teal }}>New collection</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Recipe Detail Sheet ─────────────────────────────────────────────────────

function RecipeSheet({ recipe, visible, onClose, onDelete, onUpdate, onCookRequest, onMoveRequest, onShareRequest, householdId, colors }: {
  recipe: SavedRecipe | null;
  visible: boolean;
  onClose: () => void;
  onDelete: () => void;
  onUpdate: (updated: SavedRecipe) => void;
  onCookRequest: () => void;
  onMoveRequest: () => void;
  onShareRequest?: () => void;
  householdId?: string | null;
  colors: ThemeColors;
}) {
  const insets          = useSafeAreaInsets();
  const fadeAnim        = useRef(new Animated.Value(0)).current;
  const slideAnim       = useRef(new Animated.Value(24)).current;
  const heroScale       = useRef(new Animated.Value(0.94)).current;
  const cardsOpacity    = useRef(new Animated.Value(0)).current;
  const cardsTranslateY = useRef(new Animated.Value(20)).current;
  const [mounted,        setMounted]        = useState(false);
  const [editingNotes,   setEditingNotes]   = useState(false);
  const [notesText,      setNotesText]      = useState('');
  const [baseServings,   setBaseServings]   = useState(4);
  const [targetServings, setTargetServings] = useState(4);
  const notesRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setEditingNotes(false);
      fadeAnim.setValue(0); slideAnim.setValue(24);
      heroScale.setValue(0.94); cardsOpacity.setValue(0); cardsTranslateY.setValue(20);
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, damping: 24, stiffness: 200, useNativeDriver: true }),
        Animated.spring(heroScale, { toValue: 1, damping: 16, stiffness: 200, useNativeDriver: true }),
      ]).start();
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(cardsOpacity,    { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.spring(cardsTranslateY, { toValue: 0, damping: 22, stiffness: 180, useNativeDriver: true }),
        ]).start();
      }, 100);
    } else if (mounted) {
      Animated.timing(fadeAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setMounted(false));
    }
  }, [visible]);

  // Sync internal state when recipe changes
  useEffect(() => {
    if (recipe) {
      setNotesText(recipe.notes ?? '');
      const s = extractServings(recipe.content, recipe.recipeMacros?.servings);
      setBaseServings(s);
      setTargetServings(s);
    }
  }, [recipe?.id]);

  if (!mounted || !recipe) return null;

  const scaleFactor   = baseServings > 0 ? targetServings / baseServings : 1;
  const scaledContent = scaleContent(recipe.content, scaleFactor);
  const m             = recipe.recipeMacros;
  const scaledMacros  = m && Math.abs(scaleFactor - 1) > 0.05 ? {
    ...m,
    protein: Math.round(m.protein * scaleFactor),
    carbs:   Math.round(m.carbs   * scaleFactor),
    fat:     Math.round(m.fat     * scaleFactor),
    cal:     Math.round(m.cal     * scaleFactor),
  } : m;

  const handleRate = (r: number) => onUpdate({ ...recipe, rating: r || undefined });

  const handleSaveNotes = () => {
    onUpdate({ ...recipe, notes: notesText.trim() || undefined });
    setEditingNotes(false);
  };

  // Build preset serving options: ½×, 1× (base), 2×, 3×, 4×
  const servingPresets = [
    Math.round(baseServings * 0.5),
    baseServings,
    Math.round(baseServings * 2),
    Math.round(baseServings * 3),
    Math.round(baseServings * 4),
  ].filter((v, i, arr) => v > 0 && arr.indexOf(v) === i);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={{ flex: 1, backgroundColor: colors.bg, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

        {/* Header */}
        <Animated.View style={{ transform: [{ scale: heroScale }] }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
          paddingTop: insets.top + 12, paddingBottom: 12,
          backgroundColor: colors.bg, borderBottomWidth: 0.5, borderBottomColor: colors.border,
        }}>
          <TouchableOpacity
            onPress={onClose}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={{ fontSize: 20, color: colors.brand, lineHeight: 24 }}>‹</Text>
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 8 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.brand, fontFamily: 'Fraunces_600SemiBold' }} numberOfLines={1}>
              {recipe.name}
            </Text>
          </View>
          <TouchableOpacity
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
            onPress={() =>
              Alert.alert('Delete recipe?', 'This cannot be undone.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: onDelete },
              ])
            }
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={{ fontSize: 20 }}>🗑</Text>
          </TouchableOpacity>
        </View>
        </Animated.View>

        {/* Scrollable body */}
        <Animated.View style={{ flex: 1, opacity: cardsOpacity, transform: [{ translateY: cardsTranslateY }] }}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 50 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Recipe metadata + star rating + action buttons */}
          <View style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 11, color: colors.textMuted }}>Saved {timeAgo(recipe.savedAt)}</Text>
              {recipe.cookedCount ? (
                <Text style={{ fontSize: 11, color: colors.teal, fontWeight: '600' }}>
                  🍳 cooked {recipe.cookedCount}×{recipe.lastCooked ? ` · last ${timeAgo(recipe.lastCooked)}` : ''}
                </Text>
              ) : null}
            </View>

            {/* Star rating */}
            <View style={{ marginBottom: 14 }}>
              <StarRating rating={recipe.rating} onChange={handleRate} />
              {!recipe.rating && (
                <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 4 }}>Tap to rate</Text>
              )}
            </View>

            {/* Action buttons */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: householdId && !recipe.sharedBy ? 8 : 0 }}>
              <TouchableOpacity
                onPress={onCookRequest}
                style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  backgroundColor: colors.btnPrimary, borderRadius: 12, paddingVertical: 10,
                }}
                activeOpacity={0.85}
              >
                <Text style={{ fontSize: 15 }}>🍳</Text>
                <Text style={{ color: 'white', fontWeight: '700', fontSize: 13 }}>Cook this</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onMoveRequest}
                style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 10,
                  borderWidth: 0.5, borderColor: colors.border,
                }}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 15 }}>📁</Text>
                <Text style={{ color: colors.textSub, fontWeight: '600', fontSize: 13 }}>Move to…</Text>
              </TouchableOpacity>
            </View>
            {householdId && !recipe.sharedBy && (
              <TouchableOpacity
                onPress={onShareRequest}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  borderRadius: 12, paddingVertical: 10,
                  backgroundColor: recipe.sharedWithHousehold ? 'rgba(29,158,117,0.1)' : colors.surface,
                  borderWidth: 0.5, borderColor: recipe.sharedWithHousehold ? colors.teal : colors.border,
                }}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 15 }}>{recipe.sharedWithHousehold ? '🏠' : '🔗'}</Text>
                <Text style={{ color: recipe.sharedWithHousehold ? colors.teal : colors.textSub, fontWeight: '600', fontSize: 13 }}>
                  {recipe.sharedWithHousehold ? 'Shared with household' : 'Share with household'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Macro bar */}
          {scaledMacros && (
            <View style={{
              flexDirection: 'row', marginBottom: 14,
              backgroundColor: colors.surface, borderRadius: 14, borderWidth: 0.5,
              borderColor: colors.border, padding: 12,
            }}>
              {[
                { label: 'PROTEIN', val: scaledMacros.protein + 'g', color: colors.teal },
                { label: 'CARBS',   val: scaledMacros.carbs   + 'g', color: '#F5A623' },
                { label: 'FAT',     val: scaledMacros.fat     + 'g', color: '#E8756A' },
                { label: 'CAL',     val: String(scaledMacros.cal),   color: colors.brand },
              ].map((item, i) => (
                <View key={item.label} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                  {i > 0 && <View style={{ width: 0.5, height: 30, backgroundColor: colors.border }} />}
                  <View style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: item.color }}>{item.val}</Text>
                    <Text style={{ fontSize: 8, color: colors.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{item.label}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Serving scaler */}
          <View style={{ marginBottom: 16, padding: 12, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 0.5, borderColor: colors.border }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textSub, letterSpacing: 1, marginBottom: 10 }}>
              SERVINGS
              {Math.abs(scaleFactor - 1) > 0.05
                ? `  ·  scaled ${scaleFactor > 1 ? `${scaleFactor.toFixed(1)}×` : `${Math.round(scaleFactor * 100)}%`}`
                : '  ·  tap to scale'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {servingPresets.map(s => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setTargetServings(s)}
                  style={{
                    paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999,
                    backgroundColor: targetServings === s ? colors.btnPrimary : colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: targetServings === s ? colors.btnPrimary : colors.border,
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={{ fontSize: 13, fontWeight: '600', color: targetServings === s ? 'white' : colors.textSub }}>
                    {s}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {Math.abs(scaleFactor - 1) > 0.05 && (
              <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 8 }}>
                ℹ️ Ingredient amounts are scaled. Some rounding may apply.
              </Text>
            )}
          </View>

          {/* Recipe body */}
          <Markdown
            text={scaledContent}
            style={{ fontSize: 14, color: colors.text, lineHeight: 22, fontFamily: 'Fraunces_400Regular' }}
            boldStyle={{ fontWeight: '700', color: colors.text, fontFamily: 'Fraunces_600SemiBold' }}
          />

          {/* Notes section */}
          <View style={{ marginTop: 20, padding: 14, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 0.5, borderColor: colors.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textSub, letterSpacing: 0.8 }}>📝 MY NOTES</Text>
              {!editingNotes && (
                <TouchableOpacity onPress={() => {
                  setEditingNotes(true);
                  setTimeout(() => notesRef.current?.focus(), 80);
                }}>
                  <Text style={{ fontSize: 12, color: colors.teal, fontWeight: '600' }}>
                    {recipe.notes ? 'edit' : '+ add'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {editingNotes ? (
              <>
                <TextInput
                  ref={notesRef}
                  style={{
                    fontSize: 13, color: colors.text, lineHeight: 20,
                    minHeight: 80, textAlignVertical: 'top',
                    borderWidth: 0.5, borderColor: colors.border, borderRadius: 10,
                    padding: 10,
                  }}
                  value={notesText}
                  onChangeText={setNotesText}
                  multiline
                  placeholder="Add notes, substitutions, tips, how it turned out…"
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                />
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                  <TouchableOpacity
                    onPress={() => { setNotesText(recipe.notes ?? ''); setEditingNotes(false); }}
                    style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 0.5, borderColor: colors.border, alignItems: 'center' }}
                  >
                    <Text style={{ fontSize: 13, color: colors.textSub }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleSaveNotes}
                    style={{ flex: 1, backgroundColor: colors.btnPrimary, borderRadius: 10, paddingVertical: 9, alignItems: 'center' }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: 'white' }}>Save notes</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <Text style={{ fontSize: 13, color: recipe.notes ? colors.text : colors.textMuted, lineHeight: 20 }}>
                {recipe.notes || 'No notes yet. Tap "+ add" to write your tips, substitutions, or how it turned out.'}
              </Text>
            )}
          </View>
        </ScrollView>
        </Animated.View>

      </Animated.View>
    </Modal>
  );
}

// ─── Create / Rename Modal ────────────────────────────────────────────────────

function CollectionModal({ visible, onClose, onSave, renaming, colors }: {
  visible: boolean; onClose: () => void;
  onSave: (name: string, emoji: string) => void;
  renaming?: Collection | null; colors: ThemeColors;
}) {
  const [name, setName]   = useState('');
  const [emoji, setEmoji] = useState(EMOJIS[0]);

  useEffect(() => {
    if (visible) { setName(renaming?.name ?? ''); setEmoji(renaming?.emoji ?? EMOJIS[0]); }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 24 }}
          activeOpacity={1} onPress={onClose}
        >
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: colors.bg, borderRadius: 22, padding: 22 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.brand, marginBottom: 18, fontFamily: 'Fraunces_600SemiBold' }}>
              {renaming ? 'Rename Collection' : 'New Collection'}
            </Text>

            {!renaming && (
              <>
                <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textSub, letterSpacing: 1, marginBottom: 10 }}>PICK AN EMOJI</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
                  {EMOJIS.map(e => (
                    <TouchableOpacity
                      key={e} onPress={() => setEmoji(e)}
                      style={{
                        width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                        backgroundColor: emoji === e ? colors.chipBg : colors.surface,
                        borderWidth: emoji === e ? 1.5 : 0.5,
                        borderColor: emoji === e ? colors.teal : colors.border,
                      }}
                    >
                      <Text style={{ fontSize: 22 }}>{e}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textSub, letterSpacing: 1, marginBottom: 10 }}>COLLECTION NAME</Text>
            <TextInput
              style={{
                backgroundColor: colors.surface, borderRadius: 12, borderWidth: 0.5,
                borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 13,
                fontSize: 15, color: colors.text, marginBottom: 18,
              }}
              placeholder="e.g. Quick Weeknights"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => name.trim() && onSave(name.trim(), emoji)}
            />

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={onClose}
                style={{ flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 0.5, borderColor: colors.border, alignItems: 'center' }}
              >
                <Text style={{ color: colors.textSub, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => name.trim() && onSave(name.trim(), emoji)}
                style={{ flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.btnPrimary, alignItems: 'center', opacity: name.trim() ? 1 : 0.4 }}
              >
                <Text style={{ color: 'white', fontWeight: '700' }}>{renaming ? 'Rename' : 'Create'}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CollectionsScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const { menuBtn, drawerEl } = useAppDrawer();
  const { isPremium, showPaywall } = useSubscription();
  const { user } = useAuth();
  const router = useRouter();

  const [collections,      setCollections]      = useState<Collection[]>([]);
  const [recipes,          setRecipes]          = useState<SavedRecipe[]>([]);
  const [householdRecipes, setHouseholdRecipes] = useState<SavedRecipe[]>([]);
  const [householdId,      setHouseholdId]      = useState<string | null>(null);
  const [activeCollection, setActiveCollection] = useState<Collection | 'all' | null>(null);
  const [selectedRecipe,   setSelectedRecipe]   = useState<SavedRecipe | null>(null);
  const [sheetVisible,     setSheetVisible]     = useState(false);
  const [modalVisible,     setModalVisible]     = useState(false);
  const [renamingCol,      setRenamingCol]      = useState<Collection | null>(null);
  const [query,            setQuery]            = useState('');
  const [moveVisible,      setMoveVisible]      = useState(false);
  const [cookItVisible,    setCookItVisible]    = useState(false);
  const [saveDishVisible,  setSaveDishVisible]  = useState(false);
  const [saveDishName,     setSaveDishName]     = useState('');
  const [saveDishDays,     setSaveDishDays]     = useState('3');
  const [saveDishServings, setSaveDishServings] = useState('');

  const screenFade      = useRef(new Animated.Value(0)).current;
  const screenSlide     = useRef(new Animated.Value(24)).current;
  const heroScale       = useRef(new Animated.Value(0.94)).current;
  const cardsOpacity    = useRef(new Animated.Value(0)).current;
  const cardsTranslateY = useRef(new Animated.Value(20)).current;
  const realtimeRef       = useRef<ReturnType<typeof subscribeToHouseholdRecipes> | null>(null);
  const moveAfterCreateRef = useRef(false);

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

    Promise.all([loadCollections(), loadSavedRecipes()]).then(([cols, recs]) => {
      setCollections(cols);
      setRecipes(recs);
    });

    // Migration + household setup
    AsyncStorage.getItem(HOUSEHOLD_KEY).then(async (hhId) => {
      setHouseholdId(hhId);
      if (user?.id) {
        migrateLocalCollectionsToSupabase(user.id).catch(() => {});
        if (hhId) {
          const shared = await pullHouseholdSharedRecipes(hhId, user.id);
          setHouseholdRecipes(shared);
          // Subscribe to realtime household recipe changes
          if (realtimeRef.current) realtimeRef.current.unsubscribe();
          realtimeRef.current = subscribeToHouseholdRecipes(
            hhId,
            (r) => setHouseholdRecipes(prev => [r, ...prev.filter(x => x.id !== r.id)]),
            (r) => setHouseholdRecipes(prev => prev.map(x => x.id === r.id ? r : x)),
            (id) => setHouseholdRecipes(prev => prev.filter(x => x.id !== id)),
          );
        }
      }
    });

    return () => {
      if (realtimeRef.current) { realtimeRef.current.unsubscribe(); realtimeRef.current = null; }
    };
  }, [user?.id]));

  // ── Mutations ──────────────────────────────────────────────────────────────

  const handleSaveCollection = async (name: string, emoji: string) => {
    setModalVisible(false);
    if (renamingCol) {
      const updated = collections.map(c => c.id === renamingCol.id ? { ...c, name, emoji } : c);
      setCollections(updated);
      await persistCollections(updated);
      if (user?.id) pushCollections(updated, user.id).catch(() => {});
      if (activeCollection && activeCollection !== 'all' && activeCollection.id === renamingCol.id) {
        setActiveCollection({ ...renamingCol, name, emoji });
      }
      setRenamingCol(null);
    } else {
      const col: Collection = { id: String(Date.now()), name, emoji, createdAt: Date.now() };
      const updated = [...collections, col];
      setCollections(updated);
      await persistCollections(updated);
      if (user?.id) pushCollections(updated, user.id).catch(() => {});
      if (moveAfterCreateRef.current) {
        moveAfterCreateRef.current = false;
        setTimeout(() => setMoveVisible(true), 300);
      }
    }
  };

  const handleDeleteCollection = (col: Collection) => {
    Alert.alert(
      `Delete "${col.name}"?`,
      'Recipes inside will become uncategorized.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          const updatedRecipes = recipes.map(r => r.collectionId === col.id ? { ...r, collectionId: '' } : r);
          setRecipes(updatedRecipes);
          await persistSavedRecipes(updatedRecipes);
          const updatedCols = collections.filter(c => c.id !== col.id);
          setCollections(updatedCols);
          await persistCollections(updatedCols);
          if (user?.id) {
            pushCollections(updatedCols, user.id).catch(() => {});
            pushSavedRecipes(updatedRecipes, user.id, householdId ?? undefined).catch(() => {});
          }
          if (activeCollection && activeCollection !== 'all' && activeCollection.id === col.id) {
            setActiveCollection(null);
          }
        }},
      ]
    );
  };

  const handleDeleteRecipe = async () => {
    if (!selectedRecipe) return;
    const updated = recipes.filter(r => r.id !== selectedRecipe.id);
    setRecipes(updated);
    await persistSavedRecipes(updated);
    if (user?.id) pushSavedRecipes(updated, user.id, householdId ?? undefined).catch(() => {});
    setSheetVisible(false);
    setSelectedRecipe(null);
  };

  const handleUpdateRecipe = async (updated: SavedRecipe) => {
    const newRecipes = recipes.map(r => r.id === updated.id ? updated : r);
    setRecipes(newRecipes);
    setSelectedRecipe(updated);
    await persistSavedRecipes(newRecipes);
    if (user?.id) pushSavedRecipes(newRecipes, user.id, householdId ?? undefined).catch(() => {});
  };

  const handleShareRecipe = async () => {
    if (!selectedRecipe || !householdId || !user?.id) return;
    const isShared = selectedRecipe.sharedWithHousehold;
    if (isShared) {
      const ok = await unshareRecipe(selectedRecipe.id, user.id);
      if (ok) await handleUpdateRecipe({ ...selectedRecipe, sharedWithHousehold: false });
    } else {
      const ok = await shareRecipeWithHousehold(selectedRecipe.id, user.id, householdId);
      if (ok) {
        await handleUpdateRecipe({ ...selectedRecipe, sharedWithHousehold: true });
        Alert.alert('Shared! 🏠', 'Your household can now see this recipe.');
      }
    }
  };

  const handleMove = async (collectionId: string) => {
    if (!selectedRecipe) return;
    const dest = collections.find(c => c.id === collectionId);
    await handleUpdateRecipe({ ...selectedRecipe, collectionId });
    setMoveVisible(false);
    Alert.alert('Moved! 📁', `Recipe moved to ${dest?.name ?? 'Uncategorized'}.`);
  };

  const saveDishToFridge = async (name: string, days: number, servings: number, macros?: SavedRecipe['recipeMacros']) => {
    const raw = await AsyncStorage.getItem('gogood_items');
    const existing = raw ? JSON.parse(raw) : [];
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + days);
    const expiryDate = expiry.toISOString().split('T')[0];
    const badge = days <= 0 ? 'black' : days <= 5 ? 'amber' : 'green';
    const expires = days <= 0 ? 'expired' : `${days} days`;
    const newItem = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      icon: '🍽️', name, baseName: name.toLowerCase(), batch: 1,
      qty: `${servings} serving${servings !== 1 ? 's' : ''}`,
      qtyNum: servings, unit: 'servings',
      expiryDate, expires, badge, days,
      protein: (macros?.protein ?? 0) * servings,
      carbs:   (macros?.carbs   ?? 0) * servings,
      fat:     (macros?.fat     ?? 0) * servings,
      cal:     (macros?.cal     ?? 0) * servings,
      category: 'fridge' as const, addedAt: Date.now(), foodCategory: 'Leftovers',
    };
    const updated = [...existing, newItem];
    const statsRaw = await AsyncStorage.getItem('gogood_stats');
    const stats = statsRaw ? JSON.parse(statsRaw) : { goneGood: 0, goneBad: 0, totalAdded: 0 };
    await Promise.all([
      AsyncStorage.setItem('gogood_items', JSON.stringify(updated)),
      AsyncStorage.setItem('gogood_stats', JSON.stringify({ ...stats, totalAdded: (stats.totalAdded || 0) + 1 })),
    ]);
    if (user?.id) pushItems(updated, user.id, householdId ?? undefined).catch(() => {});
  };

  const handleCookConfirm = async () => {
    if (!selectedRecipe) return;
    await handleUpdateRecipe({
      ...selectedRecipe,
      cookedCount: (selectedRecipe.cookedCount || 0) + 1,
      lastCooked:  Date.now(),
    });
    setCookItVisible(false);
    const name = parseRecipeName(selectedRecipe.content);
    const macros = selectedRecipe.recipeMacros;
    setSaveDishName(name);
    setSaveDishDays(String(macros?.fridgeDays ?? 3));
    setSaveDishServings(String(macros?.servings ?? 2));
    // Wait for PortionDeductionSheet dismiss animation (~260ms) before showing next modal
    setTimeout(() => setSaveDishVisible(true), 320);
  };

  const openRecipe = (r: SavedRecipe) => { setSelectedRecipe(r); setSheetVisible(true); };

  // ── Derived ────────────────────────────────────────────────────────────────

  const q = query.toLowerCase().trim();

  const sortRecipes = (list: SavedRecipe[]) =>
    [...list].sort((a, b) =>
      (b.rating ?? 0) - (a.rating ?? 0) || b.savedAt - a.savedAt
    );

  const visibleRecipes = (() => {
    if (!activeCollection) return [];
    let list = activeCollection === 'all'
      ? [...recipes]
      : recipes.filter(r => r.collectionId === activeCollection.id);
    if (q) list = list.filter(r => r.name.toLowerCase().includes(q));
    return sortRecipes(list);
  })();

  // Global search results (shown from collection list)
  const searchResults = useMemo(() =>
    q ? sortRecipes(recipes.filter(r => r.name.toLowerCase().includes(q))) : [],
    [recipes, q]
  );

  const countFor      = (col: Collection) => recipes.filter(r => r.collectionId === col.id).length;
  const uncategorized = recipes.filter(r => !r.collectionId);

  // ── Shared sheets (appear over both views) ─────────────────────────────────

  const sharedSheets = (
    <>
      <RecipeSheet
        recipe={selectedRecipe}
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        onDelete={handleDeleteRecipe}
        onUpdate={handleUpdateRecipe}
        onCookRequest={() => {
            setSheetVisible(false);
            setTimeout(() => setCookItVisible(true), 300);
          }}
        onMoveRequest={() => {
            setSheetVisible(false);
            setTimeout(() => setMoveVisible(true), 300);
          }}
        onShareRequest={handleShareRecipe}
        householdId={householdId}
        colors={colors}
      />
      <MoveSheet
        visible={moveVisible}
        onClose={() => setMoveVisible(false)}
        collections={collections}
        currentId={selectedRecipe?.collectionId ?? ''}
        onMove={handleMove}
        onCreateCategory={() => {
          setMoveVisible(false);
          moveAfterCreateRef.current = true;
          setRenamingCol(null);
          setTimeout(() => setModalVisible(true), 300);
        }}
        colors={colors}
      />
      <PortionDeductionSheet
        visible={cookItVisible}
        onClose={() => setCookItVisible(false)}
        onConfirm={handleCookConfirm}
        recipeContent={selectedRecipe?.content ?? ''}
        userId={user?.id}
        householdId={householdId}
        colors={colors}
      />

      <Modal visible={saveDishVisible} transparent animationType="slide" onRequestClose={() => setSaveDishVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setSaveDishVisible(false)} />
          <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 36, paddingHorizontal: 20 }}>
            <View style={{ width: 36, height: 4, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 999, alignSelf: 'center', marginVertical: 12 }} />
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.brand, marginBottom: 4, fontFamily: 'Fraunces_600SemiBold' }}>
              Save leftovers to fridge 🍽️
            </Text>
            <Text style={{ fontSize: 12, color: colors.textSub, marginBottom: 16 }}>
              Track your portions — each serving appears in your fridge inventory and deducts as you eat.
            </Text>
            <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted, marginBottom: 6, letterSpacing: 0.4 }}>DISH NAME</Text>
            <TextInput
              style={{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: 0.5, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: colors.text, marginBottom: 14 }}
              value={saveDishName}
              onChangeText={setSaveDishName}
              placeholderTextColor={colors.textMuted}
              returnKeyType="done"
            />
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 14 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted, marginBottom: 6, letterSpacing: 0.4 }}>SERVINGS MADE</Text>
                <TextInput
                  style={{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: 0.5, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: colors.text, textAlign: 'center' }}
                  value={saveDishServings}
                  onChangeText={setSaveDishServings}
                  keyboardType="number-pad"
                  placeholderTextColor={colors.textMuted}
                  returnKeyType="done"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted, marginBottom: 6, letterSpacing: 0.4 }}>DAYS FRESH</Text>
                <TextInput
                  style={{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: 0.5, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: colors.text, textAlign: 'center' }}
                  value={saveDishDays}
                  onChangeText={setSaveDishDays}
                  keyboardType="number-pad"
                  placeholderTextColor={colors.textMuted}
                  returnKeyType="done"
                />
              </View>
            </View>
            {/* Preview pill */}
            {saveDishName.trim() ? (
              <View style={{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: 0.5, borderColor: colors.border, padding: 12, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 22 }}>🍽️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }} numberOfLines={1}>{saveDishName.trim()}</Text>
                  <Text style={{ fontSize: 11, color: colors.textSub, marginTop: 2 }}>
                    {Math.max(1, parseInt(saveDishServings) || 2)} serving{(parseInt(saveDishServings) || 2) !== 1 ? 's' : ''} · good for {Math.max(1, parseInt(saveDishDays) || 3)} days
                    {selectedRecipe?.recipeMacros ? ` · ${selectedRecipe.recipeMacros.cal} cal/serving` : ''}
                  </Text>
                </View>
              </View>
            ) : null}
            <TouchableOpacity
              style={{ backgroundColor: colors.btnPrimary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 10, opacity: saveDishName.trim() ? 1 : 0.4 }}
              disabled={!saveDishName.trim()}
              onPress={async () => {
                const servings = Math.max(1, parseInt(saveDishServings) || 2);
                const days = Math.max(1, parseInt(saveDishDays) || 3);
                await saveDishToFridge(saveDishName.trim(), days, servings, selectedRecipe?.recipeMacros);
                setSaveDishVisible(false);
                Alert.alert('Saved to fridge! 🍽️', `${servings} serving${servings !== 1 ? 's' : ''} of "${saveDishName.trim()}" added to your inventory. Deduct portions from the Home tab as you eat.`);
              }}
            >
              <Text style={{ color: colors.btnPrimaryText, fontWeight: '700', fontSize: 15 }}>
                Save {parseInt(saveDishServings) > 1 ? `${parseInt(saveDishServings) || 2} servings` : 'to'} fridge 🧊
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ alignItems: 'center', paddingVertical: 10 }}
              onPress={() => {
                setSaveDishVisible(false);
                Alert.alert('🍳 Enjoy your meal!', 'Recipe logged as cooked!');
              }}
            >
              <Text style={{ color: colors.textMuted, fontSize: 13 }}>Skip — I'll eat it all now</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );

  // ── Recipe list view (inside a collection) ─────────────────────────────────

  if (activeCollection) {
    const title = activeCollection === 'all' ? 'All Saved Recipes' : activeCollection.name;
    const icon  = activeCollection === 'all' ? '📚' : activeCollection.emoji;

    return (
      <View style={styles.safe}>
        <StatusBar style={colors.statusBar} backgroundColor={colors.bg} />
        <Animated.View style={[styles.container, { opacity: screenFade, transform: [{ translateY: screenSlide }] }]}>

          <Animated.View style={{ transform: [{ scale: heroScale }] }}>
          <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
            <TouchableOpacity onPress={() => { setActiveCollection(null); setQuery(''); }} style={styles.backBtn}>
              <Text style={{ fontSize: 20, color: colors.brand, lineHeight: 24 }}>‹</Text>
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={styles.headerTitle}>{icon} {title}</Text>
              <Text style={{ fontSize: 11, color: colors.textSub, marginTop: 2 }}>
                {visibleRecipes.length} recipe{visibleRecipes.length !== 1 ? 's' : ''}{q ? ' found' : ''}
              </Text>
            </View>
            <View style={{ width: 40 }} />
          </View>
          </Animated.View>

          <Animated.View style={{ flex: 1, opacity: cardsOpacity, transform: [{ translateY: cardsTranslateY }] }}>
          {/* Search bar */}
          <View style={styles.searchBar}>
            <Text style={{ fontSize: 15, color: colors.textMuted }}>🔍</Text>
            <TextInput
              style={{ flex: 1, fontSize: 14, color: colors.text }}
              placeholder="Search recipes…"
              placeholderTextColor={colors.textMuted}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>

          {visibleRecipes.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={{ fontSize: 52, marginBottom: 16 }}>{q ? '🔍' : icon}</Text>
              <Text style={styles.emptyTitle}>
                {q ? `No recipes match "${query}"` : 'No recipes here yet'}
              </Text>
              <Text style={styles.emptySub}>
                {q
                  ? 'Try a different search term.'
                  : 'Ask Good Bot for a recipe and tap\n"Save Recipe" to add it here.'}
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} showsVerticalScrollIndicator={false}>
              {visibleRecipes.map(r => (
                <TouchableOpacity key={r.id} style={styles.recipeCard} onPress={() => openRecipe(r)} activeOpacity={0.8}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recipeCardName} numberOfLines={2}>{r.name}</Text>
                    {r.recipeMacros && (
                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 5 }}>
                        <Text style={{ fontSize: 11, color: colors.teal, fontWeight: '600' }}>P: {r.recipeMacros.protein}g</Text>
                        <Text style={{ fontSize: 11, color: '#F5A623', fontWeight: '600' }}>C: {r.recipeMacros.carbs}g</Text>
                        <Text style={{ fontSize: 11, color: '#E8756A', fontWeight: '600' }}>F: {r.recipeMacros.fat}g</Text>
                        <Text style={{ fontSize: 11, color: colors.textSub, fontWeight: '600' }}>{r.recipeMacros.cal} cal</Text>
                      </View>
                    )}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 5, flexWrap: 'wrap' }}>
                      <Text style={{ fontSize: 11, color: colors.textMuted }}>{timeAgo(r.savedAt)}</Text>
                      {r.cookedCount ? <Text style={{ fontSize: 11, color: colors.teal }}>🍳 ×{r.cookedCount}</Text> : null}
                      {r.rating ? <StarRating rating={r.rating} size={12} readonly /> : null}
                    </View>
                  </View>
                  <Text style={{ color: colors.textMuted, fontSize: 20 }}>›</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          </Animated.View>

          {sharedSheets}
          {drawerEl}
        </Animated.View>
      </View>
    );
  }

  // ── Collection list view (default) ────────────────────────────────────────

  return (
    <View style={styles.safe}>
      <StatusBar style={colors.statusBar} backgroundColor={colors.bg} />
      <Animated.View style={[styles.container, { opacity: screenFade, transform: [{ translateY: screenSlide }] }]}>

        <Animated.View style={{ transform: [{ scale: heroScale }] }}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          {menuBtn}
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.headerLogo}>
              recipe<Text style={styles.headerLogoGreen}>collections</Text>
            </Text>
          </View>
          <TouchableOpacity style={styles.newBtn} onPress={() => { if (!isPremium) { showPaywall(); return; } setRenamingCol(null); setModalVisible(true); }}>
            <Text style={styles.newBtnText}>+ new</Text>
          </TouchableOpacity>
        </View>
        </Animated.View>

        {/* Content area — overlay lives here so header stays tappable */}
        <View style={{ flex: 1, position: 'relative' }}>

        <Animated.View style={{ flex: 1, opacity: cardsOpacity, transform: [{ translateY: cardsTranslateY }] }}>
        {/* Global search bar */}
        <View style={styles.searchBar}>
          <Text style={{ fontSize: 15, color: colors.textMuted }}>🔍</Text>
          <TextInput
            style={{ flex: 1, fontSize: 14, color: colors.text }}
            placeholder="Search all recipes…"
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

          {/* ── Global search results ── */}
          {q ? (
            searchResults.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={{ fontSize: 40, marginBottom: 12 }}>🔍</Text>
                <Text style={styles.emptyTitle}>No recipes match "{query}"</Text>
                <Text style={styles.emptySub}>Try a different name or ingredient.</Text>
              </View>
            ) : (
              <>
                <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textSub, letterSpacing: 0.8, marginBottom: 2 }}>
                  {searchResults.length} RESULT{searchResults.length !== 1 ? 'S' : ''}
                </Text>
                {searchResults.map(r => (
                  <TouchableOpacity key={r.id} style={styles.recipeCard} onPress={() => openRecipe(r)} activeOpacity={0.8}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.recipeCardName} numberOfLines={2}>{r.name}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 5, flexWrap: 'wrap' }}>
                        <Text style={{ fontSize: 11, color: colors.textMuted }}>
                          {collections.find(c => c.id === r.collectionId)?.name ?? 'Uncategorized'}
                        </Text>
                        {r.cookedCount ? <Text style={{ fontSize: 11, color: colors.teal }}>🍳 ×{r.cookedCount}</Text> : null}
                        {r.rating ? <StarRating rating={r.rating} size={12} readonly /> : null}
                      </View>
                    </View>
                    <Text style={{ color: colors.textMuted, fontSize: 20 }}>›</Text>
                  </TouchableOpacity>
                ))}
              </>
            )
          ) : (
            /* ── Normal collections list ── */
            <>
              {/* Import from Social banner */}
              <TouchableOpacity
                style={styles.importCard}
                onPress={() => { if (!isPremium) { showPaywall(); return; } router.push('/social-recipe-import'); }}
                activeOpacity={0.85}
              >
                <View style={styles.importCardIcon}>
                  <Text style={{ fontSize: 24 }}>📲</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.importCardTitle}>Import from TikTok & More</Text>
                  <Text style={styles.importCardSub}>Paste a link · AI extracts the recipe</Text>
                </View>
                <Text style={{ color: colors.teal, fontSize: 20 }}>›</Text>
              </TouchableOpacity>

              {/* All saved recipes entry point */}
              {recipes.length > 0 && (
                <TouchableOpacity style={styles.allCard} onPress={() => setActiveCollection('all')} activeOpacity={0.85}>
                  <Text style={{ fontSize: 34 }}>📚</Text>
                  <View style={{ flex: 1, marginLeft: 14 }}>
                    <Text style={styles.allCardTitle}>All Saved Recipes</Text>
                    <Text style={styles.allCardSub}>{recipes.length} recipe{recipes.length !== 1 ? 's' : ''} total</Text>
                  </View>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 22 }}>›</Text>
                </TouchableOpacity>
              )}

              {/* Collection cards */}
              {collections.map(col => (
                <TouchableOpacity
                  key={col.id}
                  style={styles.colCard}
                  onPress={() => setActiveCollection(col)}
                  onLongPress={() =>
                    Alert.alert(`${col.emoji} ${col.name}`, undefined, [
                      { text: 'Rename', onPress: () => { setRenamingCol(col); setModalVisible(true); } },
                      { text: 'Delete', style: 'destructive', onPress: () => handleDeleteCollection(col) },
                      { text: 'Cancel', style: 'cancel' },
                    ])
                  }
                  activeOpacity={0.8}
                >
                  <View style={styles.colEmojiWrap}>
                    <Text style={{ fontSize: 26 }}>{col.emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.colName}>{col.name}</Text>
                    <Text style={styles.colSub}>{countFor(col)} recipe{countFor(col) !== 1 ? 's' : ''} · hold to edit</Text>
                  </View>
                  <Text style={{ color: colors.textMuted, fontSize: 22 }}>›</Text>
                </TouchableOpacity>
              ))}

              {/* Empty state */}
              {collections.length === 0 && recipes.length === 0 && (
                <View style={styles.emptyState}>
                  <Text style={{ fontSize: 60, marginBottom: 18 }}>🍳</Text>
                  <Text style={styles.emptyTitle}>No saved recipes yet</Text>
                  <Text style={styles.emptySub}>
                    Ask Good Bot for a recipe, then tap{'\n'}
                    "Save Recipe" to start your collection.
                  </Text>
                </View>
              )}

              {/* Uncategorized preview */}
              {uncategorized.length > 0 && (
                <View style={styles.uncatCard}>
                  <Text style={styles.uncatLabel}>📌  UNCATEGORIZED · {uncategorized.length}</Text>
                  {uncategorized.slice(0, 4).map(r => (
                    <TouchableOpacity key={r.id} style={styles.uncatRow} onPress={() => openRecipe(r)} activeOpacity={0.8}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.uncatName} numberOfLines={1}>{r.name}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {r.rating ? <StarRating rating={r.rating} size={11} readonly /> : null}
                        <Text style={styles.uncatMeta}>{timeAgo(r.savedAt)}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                  {uncategorized.length > 4 && (
                    <TouchableOpacity onPress={() => setActiveCollection('all')} style={{ paddingTop: 8 }}>
                      <Text style={{ fontSize: 12, color: colors.teal, fontWeight: '600' }}>+{uncategorized.length - 4} more →</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Household Recipes */}
              {householdRecipes.length > 0 && (
                <View style={styles.uncatCard}>
                  <Text style={styles.uncatLabel}>🏠  HOUSEHOLD RECIPES · {householdRecipes.length}</Text>
                  {householdRecipes.slice(0, 5).map(r => (
                    <TouchableOpacity key={r.id} style={styles.uncatRow} onPress={() => openRecipe(r)} activeOpacity={0.8}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.uncatName} numberOfLines={1}>{r.name}</Text>
                        <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>Shared by a household member</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {r.rating ? <StarRating rating={r.rating} size={11} readonly /> : null}
                        <Text style={styles.uncatMeta}>{timeAgo(r.savedAt)}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                  {householdRecipes.length > 5 && (
                    <Text style={{ fontSize: 12, color: colors.textMuted, paddingTop: 6 }}>+{householdRecipes.length - 5} more</Text>
                  )}
                </View>
              )}
            </>
          )}
        </ScrollView>

        <CollectionModal
          visible={modalVisible}
          onClose={() => { setModalVisible(false); setRenamingCol(null); }}
          onSave={handleSaveCollection}
          renaming={renamingCol}
          colors={colors}
        />

        {/* Paywall intercept — covers content only, not the header */}
        {!isPremium && (
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={showPaywall}
            activeOpacity={1}
          />
        )}

        </Animated.View>
        </View>{/* end content area */}

        {sharedSheets}
        {drawerEl}
      </Animated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function createStyles(c: ThemeColors, isDark = false) { return StyleSheet.create({
  safe:          { flex: 1, backgroundColor: c.bg },
  container:     { flex: 1, backgroundColor: c.bg },

  header:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, backgroundColor: c.bg, borderBottomWidth: 0.5, borderBottomColor: c.border, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 3 },
  headerLogo:    { fontSize: 24, fontWeight: '700', color: c.brand, fontFamily: 'Fraunces_600SemiBold' },
  headerLogoGreen: { color: c.teal, fontFamily: 'Fraunces_600SemiBold' },
  headerTitle:   { fontSize: 16, fontWeight: '700', color: c.brand, fontFamily: 'Fraunces_600SemiBold' },
  backBtn:       { width: 40, height: 40, borderRadius: 20, backgroundColor: c.surface, borderWidth: 0.5, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  newBtn:        { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, backgroundColor: c.chipBg, borderWidth: 1, borderColor: c.teal },
  newBtnText:    { fontSize: 12, color: c.chipText, fontWeight: '700' },

  searchBar:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginVertical: 10, backgroundColor: c.surfaceAlt, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 0.5, borderColor: c.border },

  allCard:       { flexDirection: 'row', alignItems: 'center', backgroundColor: c.btnPrimary, borderRadius: 18, padding: 18, shadowColor: isDark ? '#5DCAA5' : '#085041', shadowOffset: { width: 0, height: 6 }, shadowOpacity: isDark ? 0.18 : 0.35, shadowRadius: 14, elevation: 6 },
  allCardTitle:  { fontSize: 16, fontWeight: '700', color: 'white', fontFamily: 'Fraunces_600SemiBold' },
  allCardSub:    { fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 3 },

  colCard:       { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 16, padding: 16, borderWidth: 0.5, borderColor: c.border, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  colEmojiWrap:  { width: 52, height: 52, borderRadius: 14, backgroundColor: c.chipBg, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  colName:       { fontSize: 15, fontWeight: '700', color: c.text, fontFamily: 'Fraunces_600SemiBold' },
  colSub:        { fontSize: 11, color: c.textSub, marginTop: 3 },

  uncatCard:     { backgroundColor: c.surface, borderRadius: 16, padding: 14, borderWidth: 0.5, borderColor: c.border },
  uncatLabel:    { fontSize: 10, fontWeight: '700', color: c.textSub, letterSpacing: 1, marginBottom: 10 },
  uncatRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderTopWidth: 0.5, borderTopColor: c.border },
  uncatName:     { flex: 1, fontSize: 13, color: c.text, fontFamily: 'Fraunces_400Regular' },
  uncatMeta:     { fontSize: 11, color: c.textMuted },

  emptyState:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, marginTop: 40 },
  emptyTitle:    { fontSize: 19, fontWeight: '700', color: c.text, marginBottom: 10, textAlign: 'center', fontFamily: 'Fraunces_600SemiBold' },
  emptySub:      { fontSize: 14, color: c.textSub, textAlign: 'center', lineHeight: 21 },

  recipeCard:    { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 16, padding: 16, borderWidth: 0.5, borderColor: c.border, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  recipeCardName:{ fontSize: 15, fontWeight: '700', color: c.text, fontFamily: 'Fraunces_600SemiBold' },

  importCard:     { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: c.teal, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  importCardIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.chipBg, alignItems: 'center', justifyContent: 'center' },
  importCardTitle:{ fontSize: 14, fontWeight: '700', color: c.text, fontFamily: 'Fraunces_600SemiBold' },
  importCardSub:  { fontSize: 11, color: c.textSub, marginTop: 2 },
}); }
