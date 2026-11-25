import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Animated, Alert, ActivityIndicator, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import * as Clipboard from 'expo-clipboard';
import { useTheme, type ThemeColors } from './context/theme';
import { useAuth } from './context/auth';
import { supabase } from './lib/supabase';
import { parseIngredients, matchIngredients, type ParsedIngredient } from './lib/recipe-inventory';
import {
  type SavedRecipe, type Collection,
  loadSavedRecipes, persistSavedRecipes, loadCollections, persistCollections,
} from './lib/collections';
import { addToShoppingList, addToHouseholdShoppingList } from './lib/shopping-list';
import { HOUSEHOLD_KEY } from './lib/household';
import FoodIcon from '@/components/food-icon';
import BottomSheet from '@/components/bottom-sheet';
import ScanStatusStrip from '@/components/scan-status-strip';
import RecipeView, { parseRecipe } from '@/components/recipe-view';
import { raised, raisedGreen } from '@/components/raised';
import Ionicons from '@expo/vector-icons/Ionicons';
import { showAlert } from '@/components/dialog';

// ─── Types ────────────────────────────────────────────────────────────────────

type ImportState = 'idle' | 'loading' | 'success' | 'error';

interface ExtractedRecipe {
  recipe: string;
  name: string;
  platform: string;
  sourceUrl: string;
}

interface IngredientStatus {
  have: ParsedIngredient[];
  need: ParsedIngredient[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectPlatformEmoji(platform: string): keyof typeof Ionicons.glyphMap {
  const map: Record<string, keyof typeof Ionicons.glyphMap> = {
    TikTok: 'logo-tiktok',
    Instagram: 'logo-instagram',
    Facebook: 'logo-facebook',
    YouTube: 'logo-youtube',
    Web: 'globe-outline',
  };
  return map[platform] ?? 'globe-outline';
}

function parseRecipeMacros(content: string): SavedRecipe['recipeMacros'] {
  const protein = content.match(/\*\*Protein:\*\*\s*(\d+)g?/i)?.[1]
    ?? content.match(/protein[:\s]+(\d+)g/i)?.[1];
  const carbs = content.match(/\*\*Carbs:\*\*\s*(\d+)g?/i)?.[1]
    ?? content.match(/carbs?[:\s]+(\d+)g/i)?.[1];
  const fat = content.match(/\*\*Fat:\*\*\s*(\d+)g?/i)?.[1]
    ?? content.match(/fat[:\s]+(\d+)g/i)?.[1];
  const cal = content.match(/\*\*Calories:\*\*\s*(\d+)/i)?.[1]
    ?? content.match(/calories?[:\s]+(\d+)/i)?.[1];
  const servings = content.match(/\*\*Servings:\*\*\s*(\d+)/i)?.[1]
    ?? content.match(/servings?[:\s]+(\d+)/i)?.[1];
  if (!protein && !cal) return null;
  return {
    protein: parseInt(protein ?? '0'),
    carbs:   parseInt(carbs   ?? '0'),
    fat:     parseInt(fat     ?? '0'),
    cal:     parseInt(cal     ?? '0'),
    servings: servings ? parseInt(servings) : undefined,
  };
}

async function matchAgainstInventory(recipeContent: string): Promise<IngredientStatus> {
  const raw = await AsyncStorage.getItem('gogood_items');
  const inventoryItems: any[] = raw ? JSON.parse(raw) : [];
  const parsed = parseIngredients(recipeContent);
  const inventory = inventoryItems.map(i => ({
    id: i.id, baseName: i.baseName ?? i.name ?? '', qtyNum: i.qtyNum ?? 1, unit: i.unit ?? '', icon: i.icon,
  }));
  const matched = matchIngredients(parsed, inventory);
  const matchedNames = new Set(matched.map(m => m.ingredient.name));
  const have = parsed.filter(p => matchedNames.has(p.name));
  const need = parsed.filter(p => !matchedNames.has(p.name));
  return { have, need };
}

// ─── CollectionPicker ────────────────────────────────────────────────────────

const PICKER_EMOJIS = ['🍳','🥗','🍝','🥘','🥩','🍗','🐟','🥕','🌮','🍚','🍕','🥐','🍎','🧁','🍦','☕']; // shown as line icons

function CollectionPicker({ visible, collections, onSelect, onCreateAndSelect, onClose, colors }: {
  visible: boolean;
  collections: Collection[];
  onSelect: (id: string) => void;
  onCreateAndSelect: (name: string, emoji: string) => void;
  onClose: () => void;
  colors: ThemeColors;
}) {
  const { isDark } = useTheme();
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState('');
  const [newEmoji, setNewEmoji] = useState(PICKER_EMOJIS[0]);

  useEffect(() => {
    if (visible) { setCreating(false); setNewName(''); setNewEmoji(PICKER_EMOJIS[0]); }
  }, [visible]);

  const options = [{ id: '', name: 'Uncategorized', emoji: '🍽️' }, ...collections];

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {creating ? (
        <>
          <TouchableOpacity onPress={() => setCreating(false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-back" size={16} color={colors.textSub} />
            <Text style={{ fontSize: 13, color: colors.textSub, fontWeight: '600' }}>Back</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 20, color: colors.text, fontFamily: 'Fraunces_600SemiBold', marginBottom: 14 }}>New collection</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {PICKER_EMOJIS.map(e => {
              const on = newEmoji === e;
              return (
                <TouchableOpacity
                  key={e} onPress={() => setNewEmoji(e)} activeOpacity={0.8}
                  style={[{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.chipBg : colors.surface }, raised(isDark)]}
                >
                  <FoodIcon emoji={e} size={22} bare color={on ? colors.chipText : colors.textSub} />
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            style={{ backgroundColor: colors.inputBg, borderRadius: 12, borderWidth: 1, borderColor: colors.inputBorder, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: colors.inputText, marginBottom: 14 }}
            placeholder="Collection name, e.g. Quick weeknights"
            placeholderTextColor={colors.placeholder}
            keyboardAppearance={isDark ? 'dark' : 'light'}
            value={newName}
            onChangeText={setNewName}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => newName.trim() && onCreateAndSelect(newName.trim(), newEmoji)}
          />
          <TouchableOpacity
            style={[{ backgroundColor: colors.btnPrimary, borderRadius: 14, paddingVertical: 15, alignItems: 'center', opacity: newName.trim() ? 1 : 0.45 }, raisedGreen(isDark)]}
            disabled={!newName.trim()}
            onPress={() => onCreateAndSelect(newName.trim(), newEmoji)}
            activeOpacity={0.85}
          >
            <Text style={{ color: colors.btnPrimaryText, fontWeight: '700', fontSize: 15 }}>Create and save</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={{ fontSize: 20, color: colors.text, fontFamily: 'Fraunces_600SemiBold', marginBottom: 14 }}>Save to collection</Text>
          <View style={[{ backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden' }, raised(isDark, 'md')]}>
            {options.map((col, i) => (
              <TouchableOpacity
                key={col.id || 'uncategorized'}
                onPress={() => onSelect(col.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, borderTopWidth: i ? 0.5 : 0, borderTopColor: colors.border }}
                activeOpacity={0.7}
              >
                <FoodIcon emoji={col.emoji} size={34} />
                <Text style={{ fontSize: 15, fontWeight: '500', color: colors.text, flex: 1 }}>{col.name}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            onPress={() => setCreating(true)}
            style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, paddingVertical: 13, borderRadius: 14, backgroundColor: colors.surfaceAlt }, raised(isDark)]}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={18} color={colors.text} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>New collection</Text>
          </TouchableOpacity>
        </>
      )}
    </BottomSheet>
  );
}

// ─── IngredientChip ───────────────────────────────────────────────────────────

function IngredientChip({ label, have, colors }: { label: string; have: boolean; colors: ThemeColors }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, marginRight: 6, marginBottom: 6,
      backgroundColor: have ? colors.chipBg : colors.surfaceAlt,
    }}>
      {have && <Ionicons name="checkmark" size={12} color={colors.chipText} />}
      <Text style={{ fontSize: 12, color: have ? colors.chipText : colors.textSub, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SocialRecipeImportScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const router = useRouter();
  const { user } = useAuth();

  const [url,             setUrl]             = useState('');
  const [pasteMode,       setPasteMode]       = useState(false);
  const [pasteText,       setPasteText]       = useState('');
  const [state,           setState]           = useState<ImportState>('idle');
  const [errorMsg,        setErrorMsg]        = useState('');
  const [extracted,       setExtracted]       = useState<ExtractedRecipe | null>(null);
  const [ingredients,     setIngredients]     = useState<IngredientStatus>({ have: [], need: [] });
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [pickerVisible,   setPickerVisible]   = useState(false);
  const [collections,     setCollections]     = useState<Collection[]>([]);
  const [addedToList,     setAddedToList]     = useState(false);
  const [saving,          setSaving]          = useState(false);

  const screenFade      = useRef(new Animated.Value(0)).current;
  const screenSlide     = useRef(new Animated.Value(24)).current;
  const heroScale       = useRef(new Animated.Value(0.94)).current;
  const cardsOpacity    = useRef(new Animated.Value(0)).current;
  const cardsTranslateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    loadCollections().then(setCollections);
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
  }, []);

  // Shared from another app (Share → Go Good): fill in the link or caption and import it
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  useEffect(() => {
    if (!hasShareIntent) return;
    const sharedUrl  = shareIntent.webUrl ?? shareIntent.text?.match(/https?:\/\/\S+/)?.[0] ?? null;
    const sharedText = (shareIntent.text ?? '').trim();
    resetShareIntent();
    if (sharedUrl) {
      setPasteMode(false); setUrl(sharedUrl);
      handleExtract({ url: sharedUrl, via: 'share' });
    } else if (sharedText) {
      setPasteMode(true); setPasteText(sharedText);
      handleExtract({ text: sharedText, via: 'share' });
    }
  }, [hasShareIntent]);

  // A recipe link the user just copied, offered as a one-tap fill
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  useEffect(() => {
    Clipboard.hasUrlAsync()
      .then(async has => {
        if (!has) return;
        const u = (await Clipboard.getUrlAsync()) ?? '';
        if (/instagram|tiktok|youtu|facebook|fb\.watch|pinterest|pin\.it/i.test(u)) setCopiedLink(u);
      })
      .catch(() => {});
  }, []);

  const handleExtract = async (override?: { url?: string; text?: string; via?: 'share' | 'link' | 'paste' }) => {
    const usePaste    = override ? !!override.text : pasteMode;
    const trimmedUrl  = (override?.url ?? url).trim();
    const trimmedText = (override?.text ?? pasteText).trim();

    if (usePaste) {
      if (!trimmedText) return;
    } else {
      if (!trimmedUrl) return;
      if (!/^https?:\/\//i.test(trimmedUrl)) {
        setErrorMsg('Please enter a full URL starting with https://');
        setState('error');
        return;
      }
    }

    setState('loading');
    const reqId = ++requestRef.current;
    setExtracted(null);
    setIngredients({ have: [], need: [] });
    setAddedToList(false);
    setPreviewExpanded(false);

    try {
      const via  = override?.via ?? (usePaste ? 'paste' : 'link');
      const body = usePaste
        ? { text: trimmedText, via }
        : { url: trimmedUrl, via };
      const { data, error } = await supabase.functions.invoke('recipe-from-url', { body });
      if (reqId !== requestRef.current) return; // cancelled

      if (error) {
        let msg = error.message ?? 'Something went wrong. Please try again.';
        try {
          const body = await error.context?.json?.();
          if (body?.error) msg = body.error;
        } catch {}
        setErrorMsg(msg);
        setState('error');
        return;
      }

      if (data?.error) {
        setErrorMsg(data.error);
        setState('error');
        return;
      }

      setExtracted(data);
      const matched = await matchAgainstInventory(data.recipe);
      setIngredients(matched);
      setState('success');
    } catch (e) {
      if (reqId !== requestRef.current) return;
      setErrorMsg((e as Error).message ?? 'Something went wrong. Please try again.');
      setState('error');
    }
  };

  // Stop waiting for the current import (the answer is ignored if it arrives later)
  const requestRef = useRef(0);
  const cancelImport = () => { requestRef.current++; setState('idle'); };

  const handleAddToShoppingList = async () => {
    if (!extracted || !ingredients.need.length) return;
    const newItems = ingredients.need.map(ing => ({
      name: ing.name,
      quantity: ing.qty > 0 ? String(ing.qty) : undefined,
      unit: ing.unit || undefined,
      recipeName: extracted.name,
    }));
    const householdId = await AsyncStorage.getItem(HOUSEHOLD_KEY);
    if (householdId) {
      await addToHouseholdShoppingList(householdId, newItems);
    } else {
      await addToShoppingList(newItems);
    }
    setAddedToList(true);
    showAlert(
      'Added to your shopping list',
      `${newItems.length} ingredient${newItems.length !== 1 ? 's' : ''} added to your shopping list.`,
    );
  };

  const handleSave = async (collectionId: string) => {
    if (!extracted) return;
    setSaving(true);
    setPickerVisible(false);
    try {
      const existing = await loadSavedRecipes();
      const macros = parseRecipeMacros(extracted.recipe);
      const newRecipe: SavedRecipe = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        collectionId,
        name: extracted.name,
        content: extracted.recipe,
        recipeMacros: macros,
        savedAt: Date.now(),
      };
      await persistSavedRecipes([newRecipe, ...existing]);
      showAlert(
        'Recipe saved',
        `"${extracted.name}" has been added to your${collectionId ? ' collection' : ' recipes'}.`,
        [{ text: 'View Recipes', onPress: () => router.back() }],
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAndSave = async (name: string, emoji: string) => {
    const newCol: Collection = { id: String(Date.now()), name, emoji, createdAt: Date.now() };
    const updatedCols = [...collections, newCol];
    await persistCollections(updatedCols);
    setCollections(updatedCols);
    await handleSave(newCol.id);
  };

  const platform = extracted?.platform ?? '';
  const platformEmoji = detectPlatformEmoji(platform);

  const recipeCard = useMemo(() => {
    if (!extracted) return null;
    // Nutrition shows as chips under the name, so keep it out of the recipe card
    return parseRecipe(extracted.recipe.split(/^##\s+Nutrition/im)[0]);
  }, [extracted]);
  const macros = extracted ? parseRecipeMacros(extracted.recipe) : null;
  const canSubmit = !!(pasteMode ? pasteText.trim() : url.trim()) && state !== 'loading';

  return (
    <View style={styles.safe}>
      <StatusBar style={colors.statusBar} backgroundColor={colors.bg} />
      <Animated.View style={{ flex: 1, opacity: screenFade, transform: [{ translateY: screenSlide }] }}>

        {/* Header */}
        <Animated.View style={{ transform: [{ scale: heroScale }] }}>
          <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} activeOpacity={0.8}>
              <Ionicons name="chevron-back" size={20} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Import recipe</Text>
            <View style={{ width: 38 }} />
          </View>
        </Animated.View>

        <Animated.View style={{ flex: 1, opacity: cardsOpacity, transform: [{ translateY: cardsTranslateY }] }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── Input ── */}
          <View style={styles.card}>
            {/* Link / caption: the same segmented control as the inventory tabs */}
            <View style={styles.segment}>
              {([
                { key: false, label: 'Link',    icon: 'link-outline' },
                { key: true,  label: 'Caption', icon: 'document-text-outline' },
              ] as const).map(o => {
                const on = pasteMode === o.key;
                return (
                  <TouchableOpacity
                    key={o.label}
                    style={[styles.segmentBtn, on && styles.segmentBtnOn]}
                    onPress={() => { setPasteMode(o.key); setState('idle'); setErrorMsg(''); }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name={o.icon} size={14} color={on ? colors.text : colors.textSub} />
                    <Text style={[styles.segmentText, { color: on ? colors.text : colors.textSub }]}>{o.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {!pasteMode ? (
              <>
                <Text style={styles.fieldLabel}>Post or recipe link</Text>
                <View style={styles.inputWrap}>
                  <Ionicons name="link-outline" size={17} color={colors.textMuted} />
                  <TextInput
                    style={styles.input}
                    value={url}
                    onChangeText={setUrl}
                    placeholder="Instagram, TikTok or website link"
                    placeholderTextColor={colors.placeholder}
                    keyboardAppearance={isDark ? 'dark' : 'light'}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="go"
                    onSubmitEditing={() => handleExtract()}
                    editable={state !== 'loading'}
                  />
                  {url ? (
                    <TouchableOpacity onPress={() => setUrl('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Ionicons name="close-circle" size={17} color={colors.textMuted} />
                    </TouchableOpacity>
                  ) : null}
                </View>
                {copiedLink && !url && state !== 'loading' ? (
                  <TouchableOpacity
                    onPress={() => { setUrl(copiedLink); setCopiedLink(null); handleExtract({ url: copiedLink }); }}
                    activeOpacity={0.8}
                    style={styles.copiedBtn}
                  >
                    <Ionicons name="clipboard-outline" size={16} color={colors.chipText} />
                    <Text style={styles.copiedText} numberOfLines={1}>Use copied link</Text>
                    <Ionicons name="arrow-forward" size={15} color={colors.chipText} />
                  </TouchableOpacity>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.fieldLabel}>Caption or recipe text</Text>
                <TextInput
                  style={[styles.inputWrap, styles.input, { minHeight: 130, textAlignVertical: 'top', paddingTop: 12 }]}
                  value={pasteText}
                  onChangeText={setPasteText}
                  placeholder="Paste the caption or recipe here"
                  placeholderTextColor={colors.placeholder}
                  keyboardAppearance={isDark ? 'dark' : 'light'}
                  autoCapitalize="sentences"
                  autoCorrect={false}
                  multiline
                  editable={state !== 'loading'}
                />
              </>
            )}

            <TouchableOpacity
              style={[styles.primaryBtn, { opacity: canSubmit ? 1 : 0.45 }]}
              onPress={() => handleExtract()}
              disabled={!canSubmit}
              activeOpacity={0.85}
            >
              {state === 'loading'
                ? <ActivityIndicator color={colors.btnPrimaryText} />
                : <>
                    <Ionicons name="sparkles-outline" size={17} color={colors.btnPrimaryText} />
                    <Text style={styles.primaryBtnText}>Get recipe</Text>
                  </>}
            </TouchableOpacity>
          </View>

          {/* ── Tips before the first import ── */}
          {state === 'idle' && (
            <View style={styles.tipCard}>
              <View style={styles.tipRow}>
                <View style={styles.tipIcon}><Ionicons name="share-outline" size={16} color={colors.chipText} /></View>
                <Text style={styles.tipText}>
                  <Text style={{ fontWeight: '700', color: colors.text }}>Fastest way: </Text>
                  in Instagram or TikTok, tap Share, then Go Good. The first time, tap More to turn it on.
                </Text>
              </View>
              <View style={styles.tipRow}>
                <View style={styles.tipIcon}><Ionicons name="globe-outline" size={16} color={colors.chipText} /></View>
                <Text style={styles.tipText}>Works with Instagram, TikTok, YouTube, Facebook, Pinterest and recipe websites.</Text>
              </View>
              <View style={styles.tipRow}>
                <View style={styles.tipIcon}><Ionicons name="document-text-outline" size={16} color={colors.chipText} /></View>
                <Text style={styles.tipText}>Private post? Copy the caption and use Caption instead.</Text>
              </View>
            </View>
          )}

          {/* ── Error ── */}
          {state === 'error' && (
            <View style={[styles.card, { alignItems: 'center', paddingVertical: 26 }]}>
              <View style={[styles.bigIcon, { backgroundColor: colors.goneBadBg }]}><Ionicons name="alert-outline" size={24} color={colors.goneBadText} /></View>
              <Text style={[styles.stateTitle, { marginTop: 12 }]}>Couldn't get that recipe</Text>
              <Text style={[styles.stateText, { marginTop: 6 }]}>{errorMsg}</Text>
              {!pasteMode && (
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => { setPasteMode(true); setState('idle'); setErrorMsg(''); }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="document-text-outline" size={16} color={colors.text} />
                  <Text style={styles.secondaryBtnText}>Paste the caption instead</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* ── Result ── */}
          {state === 'success' && extracted && (
            <>
              <View style={styles.card}>
                <View style={styles.sourceChip}>
                  <Ionicons name={platformEmoji} size={13} color={colors.textSub} />
                  <Text style={styles.sourceText}>From {platform === 'Web' ? 'the web' : platform}</Text>
                </View>
                <Text style={styles.recipeName}>{extracted.name}</Text>
                {macros && (
                  <View style={styles.macroRow}>
                    {[
                      { k: 'Cal',     v: macros.cal ? String(macros.cal) : '' },
                      { k: 'Protein', v: macros.protein ? `${macros.protein}g` : '' },
                      { k: 'Carbs',   v: macros.carbs ? `${macros.carbs}g` : '' },
                      { k: 'Fat',     v: macros.fat ? `${macros.fat}g` : '' },
                    ].filter(m => m.v).map(m => (
                      <View key={m.k} style={styles.macroChip}>
                        <Text style={styles.macroValue}>{m.v}</Text>
                        <Text style={styles.macroLabel}>{m.k}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* What they have and what they need */}
              {(ingredients.have.length > 0 || ingredients.need.length > 0) && (
                <View style={styles.card}>
                  {ingredients.have.length > 0 && (
                    <>
                      <Text style={styles.groupLabel}>In your kitchen · {ingredients.have.length}</Text>
                      <View style={styles.chipRow}>
                        {ingredients.have.map((ing, i) => <IngredientChip key={i} label={ing.name} have colors={colors} />)}
                      </View>
                    </>
                  )}
                  {ingredients.need.length > 0 && (
                    <>
                      <Text style={[styles.groupLabel, { marginTop: ingredients.have.length > 0 ? 12 : 0 }]}>You'll need · {ingredients.need.length}</Text>
                      <View style={styles.chipRow}>
                        {ingredients.need.map((ing, i) => <IngredientChip key={i} label={ing.name} have={false} colors={colors} />)}
                      </View>
                      <TouchableOpacity
                        style={styles.secondaryBtn}
                        onPress={handleAddToShoppingList}
                        disabled={addedToList}
                        activeOpacity={0.85}
                      >
                        <Ionicons name={addedToList ? 'checkmark' : 'cart-outline'} size={16} color={addedToList ? colors.chipText : colors.text} />
                        <Text style={[styles.secondaryBtnText, addedToList && { color: colors.chipText }]}>
                          {addedToList ? 'Added to shopping list' : 'Add missing to shopping list'}
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              )}

              {/* The recipe itself, in the same card style as Good Bot and Recipes */}
              <View style={styles.card}>
                {recipeCard
                  ? <RecipeView recipe={recipeCard} showTitle={false} />
                  : <Text style={styles.rawText}>{extracted.recipe}</Text>}
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, { marginTop: 4 }, saving && { opacity: 0.6 }]}
                onPress={() => setPickerVisible(true)}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving
                  ? <ActivityIndicator color={colors.btnPrimaryText} />
                  : <>
                      <Ionicons name="bookmark-outline" size={17} color={colors.btnPrimaryText} />
                      <Text style={styles.primaryBtnText}>Save to recipes</Text>
                    </>}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
        </KeyboardAvoidingView>
        </Animated.View>

      </Animated.View>
      <ScanStatusStrip
        visible={state === 'loading'}
        label="Reading the recipe"
        sublabel="Pulling the ingredients and steps from the post. This can take a few seconds."
        slowHint="Still working — long captions take a little longer."
        onCancel={cancelImport}
        bottom={insets.bottom + 16}
      />
      <CollectionPicker
        visible={pickerVisible}
        collections={collections}
        onSelect={handleSave}
        onCreateAndSelect={handleCreateAndSave}
        onClose={() => setPickerVisible(false)}
        colors={colors}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function createStyles(c: ThemeColors, isDark = false) {
  return StyleSheet.create({
    safe:         { flex: 1, backgroundColor: c.bg },
    header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: c.bg },
    headerTitle:  { fontSize: 20, color: c.brand, fontFamily: 'Fraunces_600SemiBold' },
    backBtn:      { width: 38, height: 38, borderRadius: 19, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', ...raised(isDark) },

    card:         { backgroundColor: c.surface, borderRadius: 18, padding: 16, marginBottom: 12, ...raised(isDark, 'md') },

    segment:      { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: c.surfaceAlt, marginBottom: 16 },
    segmentBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 11 },
    segmentBtnOn: { backgroundColor: c.surface, ...raised(isDark) },
    segmentText:  { fontSize: 13, fontWeight: '600' },

    fieldLabel:   { fontSize: 12, fontWeight: '600', color: c.textSub, marginBottom: 8 },
    inputWrap:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.inputBg, borderRadius: 12, borderWidth: 1, borderColor: c.inputBorder, paddingHorizontal: 12 },
    input:        { flex: 1, paddingVertical: 12, fontSize: 15, color: c.inputText },
    copiedBtn:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.chipBg },
    copiedText:   { flex: 1, fontSize: 13, fontWeight: '600', color: c.chipText },

    primaryBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.btnPrimary, borderRadius: 14, paddingVertical: 15, marginTop: 14, ...raisedGreen(isDark) },
    primaryBtnText:   { color: c.btnPrimaryText, fontWeight: '700', fontSize: 15 },
    secondaryBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.surfaceAlt, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginTop: 14, ...raised(isDark) },
    secondaryBtnText: { color: c.text, fontWeight: '600', fontSize: 14 },

    tipCard:      { backgroundColor: c.surface, borderRadius: 18, padding: 14, gap: 12, marginBottom: 12, ...raised(isDark, 'md') },
    tipRow:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
    tipIcon:      { width: 32, height: 32, borderRadius: 10, backgroundColor: c.chipBg, alignItems: 'center', justifyContent: 'center' },
    tipText:      { flex: 1, fontSize: 13, color: c.textSub, lineHeight: 19 },

    bigIcon:      { width: 52, height: 52, borderRadius: 26, backgroundColor: c.chipBg, alignItems: 'center', justifyContent: 'center' },
    stateTitle:   { fontSize: 17, color: c.text, fontFamily: 'Fraunces_600SemiBold', textAlign: 'center' },
    stateText:    { fontSize: 13, color: c.textSub, textAlign: 'center', lineHeight: 19, paddingHorizontal: 8 },

    sourceChip:   { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: c.surfaceAlt, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, marginBottom: 10 },
    sourceText:   { fontSize: 11, fontWeight: '600', color: c.textSub },
    recipeName:   { fontSize: 22, color: c.text, fontFamily: 'Fraunces_600SemiBold', lineHeight: 29 },
    macroRow:     { flexDirection: 'row', gap: 8, marginTop: 12 },
    macroChip:    { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 12, backgroundColor: c.surfaceAlt },
    macroValue:   { fontSize: 15, fontWeight: '700', color: c.text },
    macroLabel:   { fontSize: 10, color: c.textMuted, marginTop: 1 },

    groupLabel:   { fontSize: 12, fontWeight: '600', color: c.textSub, marginBottom: 8 },
    chipRow:      { flexDirection: 'row', flexWrap: 'wrap' },
    rawText:      { fontSize: 14, color: c.text, lineHeight: 21 },
  });
}
