import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Animated, Alert, ActivityIndicator, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'expo-router';
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

function detectPlatformEmoji(platform: string): string {
  const map: Record<string, string> = {
    TikTok: '🎵',
    Instagram: '📸',
    Facebook: '📘',
    YouTube: '▶️',
    Web: '🌐',
  };
  return map[platform] ?? '🌐';
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

const PICKER_EMOJIS = ['🍳','🥗','🍝','🥘','🍲','🥩','🐟','🥦','🍜','🌮','🍱','🫕','🥐','🌯','🍛','🍣'];

function CollectionPicker({ visible, collections, onSelect, onCreateAndSelect, onClose, colors }: {
  visible: boolean;
  collections: Collection[];
  onSelect: (id: string) => void;
  onCreateAndSelect: (name: string, emoji: string) => void;
  onClose: () => void;
  colors: ThemeColors;
}) {
  const slideAnim = useRef(new Animated.Value(500)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const [mounted,   setMounted]   = useState(false);
  const [creating,  setCreating]  = useState(false);
  const [newName,   setNewName]   = useState('');
  const [newEmoji,  setNewEmoji]  = useState(PICKER_EMOJIS[0]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setCreating(false); setNewName(''); setNewEmoji(PICKER_EMOJIS[0]);
      slideAnim.setValue(500); fadeAnim.setValue(0);
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, damping: 28, stiffness: 180, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 500, duration: 240, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [visible]);

  if (!mounted) return null;

  const options = [{ id: '', name: 'Uncategorized', emoji: '📌' }, ...collections];

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={{ flex: 1 }}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)', opacity: fadeAnim }]} pointerEvents="none" />
          <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
          <Animated.View style={{
            backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            padding: 20, paddingBottom: 44, transform: [{ translateY: slideAnim }],
          }}>
            <View style={{ width: 36, height: 4, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 999, alignSelf: 'center', marginBottom: 18 }} />

            {creating ? (
              /* ── Inline create form ── */
              <>
                <TouchableOpacity onPress={() => setCreating(false)} style={{ marginBottom: 12 }}>
                  <Text style={{ fontSize: 13, color: colors.teal, fontWeight: '600' }}>‹ Back</Text>
                </TouchableOpacity>
                <Text style={{ fontSize: 17, fontWeight: '700', color: colors.brand, fontFamily: 'Fraunces_600SemiBold', marginBottom: 14 }}>
                  New collection
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                  {PICKER_EMOJIS.map(e => (
                    <TouchableOpacity
                      key={e} onPress={() => setNewEmoji(e)}
                      style={{
                        width: 42, height: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
                        backgroundColor: newEmoji === e ? colors.chipBg : colors.surface,
                        borderWidth: newEmoji === e ? 1.5 : 0.5,
                        borderColor: newEmoji === e ? colors.teal : colors.border,
                      }}
                    >
                      <Text style={{ fontSize: 20 }}>{e}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={{
                    backgroundColor: colors.surface, borderRadius: 12, borderWidth: 0.5,
                    borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12,
                    fontSize: 15, color: colors.text, marginBottom: 14,
                  }}
                  placeholder="Collection name (e.g. Quick Weeknights)"
                  placeholderTextColor={colors.textMuted}
                  value={newName}
                  onChangeText={setNewName}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => newName.trim() && onCreateAndSelect(newName.trim(), newEmoji)}
                />
                <TouchableOpacity
                  style={{
                    backgroundColor: colors.btnPrimary, borderRadius: 13, paddingVertical: 14,
                    alignItems: 'center', opacity: newName.trim() ? 1 : 0.4,
                  }}
                  disabled={!newName.trim()}
                  onPress={() => onCreateAndSelect(newName.trim(), newEmoji)}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Create & Save Recipe</Text>
                </TouchableOpacity>
              </>
            ) : (
              /* ── Collection list ── */
              <>
                <Text style={{ fontSize: 17, fontWeight: '700', color: colors.brand, fontFamily: 'Fraunces_600SemiBold', marginBottom: 16 }}>
                  Save to collection
                </Text>
                {options.map(col => (
                  <TouchableOpacity
                    key={col.id || 'uncategorized'}
                    onPress={() => onSelect(col.id)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 14,
                      paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14, marginBottom: 4,
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 24 }}>{col.emoji}</Text>
                    <Text style={{ fontSize: 15, fontWeight: '500', color: colors.text, flex: 1 }}>{col.name}</Text>
                  </TouchableOpacity>
                ))}
                <View style={{ height: 0.5, backgroundColor: colors.border, marginVertical: 8 }} />
                <TouchableOpacity
                  onPress={() => setCreating(true)}
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
              </>
            )}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── IngredientChip ───────────────────────────────────────────────────────────

function IngredientChip({ label, have, colors }: { label: string; have: boolean; colors: ThemeColors }) {
  return (
    <View style={{
      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, marginRight: 6, marginBottom: 6,
      backgroundColor: have ? 'rgba(29,158,117,0.12)' : 'rgba(232,117,106,0.12)',
      borderWidth: 1,
      borderColor: have ? 'rgba(29,158,117,0.4)' : 'rgba(232,117,106,0.4)',
    }}>
      <Text style={{ fontSize: 12, color: have ? colors.teal : '#E8756A', fontWeight: '600' }}>
        {have ? '✓ ' : ''}{label}
      </Text>
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

  const handleExtract = async () => {
    const trimmedUrl  = url.trim();
    const trimmedText = pasteText.trim();

    if (pasteMode) {
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
    setExtracted(null);
    setIngredients({ have: [], need: [] });
    setAddedToList(false);
    setPreviewExpanded(false);

    try {
      const body = pasteMode
        ? { text: trimmedText }
        : { url: trimmedUrl };
      const { data, error } = await supabase.functions.invoke('recipe-from-url', { body });

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
      setErrorMsg((e as Error).message ?? 'Something went wrong. Please try again.');
      setState('error');
    }
  };

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
    Alert.alert(
      `Added to Shopping List 🛒`,
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
      Alert.alert(
        'Recipe Saved! 📚',
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

  return (
    <View style={styles.safe}>
      <StatusBar style={colors.statusBar} backgroundColor={colors.bg} />
      <Animated.View style={{ flex: 1, opacity: screenFade, transform: [{ translateY: screenSlide }] }}>

        {/* Header */}
        <Animated.View style={{ transform: [{ scale: heroScale }] }}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={{ fontSize: 20, color: colors.brand, lineHeight: 24 }}>‹</Text>
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.headerTitle}>Import Recipe</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
        </Animated.View>

        <Animated.View style={{ flex: 1, opacity: cardsOpacity, transform: [{ translateY: cardsTranslateY }] }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 50 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── Input section ── */}
          <View style={styles.inputCard}>
            {/* Mode toggle */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              <TouchableOpacity
                onPress={() => { setPasteMode(false); setState('idle'); setErrorMsg(''); }}
                style={{
                  flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                  backgroundColor: !pasteMode ? colors.btnPrimary : colors.surface,
                  borderWidth: 0.5, borderColor: !pasteMode ? colors.btnPrimary : colors.border,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: !pasteMode ? 'white' : colors.textSub }}>🔗 Paste Link</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setPasteMode(true); setState('idle'); setErrorMsg(''); }}
                style={{
                  flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                  backgroundColor: pasteMode ? colors.btnPrimary : colors.surface,
                  borderWidth: 0.5, borderColor: pasteMode ? colors.btnPrimary : colors.border,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: pasteMode ? 'white' : colors.textSub }}>📋 Paste Caption</Text>
              </TouchableOpacity>
            </View>

            {!pasteMode ? (
              <>
                <Text style={styles.sectionLabel}>📲 POST URL</Text>
                <TextInput
                  style={styles.urlInput}
                  value={url}
                  onChangeText={setUrl}
                  placeholder="https://www.tiktok.com/@..."
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="go"
                  onSubmitEditing={handleExtract}
                  editable={state !== 'loading'}
                />
                <Text style={styles.hintText}>
                  Works best with recipe websites and YouTube. TikTok/Instagram captions may be truncated — use Paste Caption if the link doesn't work.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.sectionLabel}>📋 RECIPE CAPTION</Text>
                <TextInput
                  style={[styles.urlInput, { minHeight: 120, textAlignVertical: 'top', paddingTop: 12 }]}
                  value={pasteText}
                  onChangeText={setPasteText}
                  placeholder="Paste the caption or recipe text here…"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="sentences"
                  autoCorrect={false}
                  multiline
                  editable={state !== 'loading'}
                />
                <Text style={styles.hintText}>
                  Copy the caption from TikTok, Instagram, or any post and paste it here.
                </Text>
              </>
            )}

            <TouchableOpacity
              style={[styles.extractBtn, {
                opacity: (pasteMode ? pasteText.trim() : url.trim()) && state !== 'loading' ? 1 : 0.45,
                marginTop: 12,
              }]}
              onPress={handleExtract}
              disabled={!(pasteMode ? pasteText.trim() : url.trim()) || state === 'loading'}
              activeOpacity={0.85}
            >
              {state === 'loading' ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.extractBtnText}>Extract Recipe</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* ── Loading state ── */}
          {state === 'loading' && (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" color={colors.teal} />
              <Text style={styles.loadingText}>Extracting recipe with AI…</Text>
            </View>
          )}

          {/* ── Error state ── */}
          {state === 'error' && (
            <View style={styles.errorCard}>
              <Text style={{ fontSize: 32, marginBottom: 10 }}>😕</Text>
              <Text style={styles.errorTitle}>Couldn't extract recipe</Text>
              <Text style={styles.errorMsg}>{errorMsg}</Text>
              <Text style={styles.errorTip}>
                Tip: Copy the post caption and ask Good Bot to format it as a recipe instead.
              </Text>
            </View>
          )}

          {/* ── Success: extracted recipe ── */}
          {state === 'success' && extracted && (
            <>
              {/* Recipe name + source */}
              <View style={styles.recipeHeader}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <View style={styles.platformBadge}>
                      <Text style={{ fontSize: 12 }}>{platformEmoji}</Text>
                      <Text style={styles.platformBadgeText}>{platform}</Text>
                    </View>
                  </View>
                  <Text style={styles.recipeName}>{extracted.name}</Text>
                </View>
              </View>

              {/* Ingredient matching */}
              {(ingredients.have.length > 0 || ingredients.need.length > 0) && (
                <View style={styles.ingredientsCard}>
                  {ingredients.have.length > 0 && (
                    <>
                      <Text style={[styles.ingredientSectionLabel, { color: colors.teal }]}>
                        ✅ IN YOUR PANTRY · {ingredients.have.length}
                      </Text>
                      <View style={styles.chipRow}>
                        {ingredients.have.map((ing, i) => (
                          <IngredientChip key={i} label={ing.name} have colors={colors} />
                        ))}
                      </View>
                    </>
                  )}

                  {ingredients.need.length > 0 && (
                    <>
                      <Text style={[styles.ingredientSectionLabel, { color: '#E8756A', marginTop: ingredients.have.length > 0 ? 14 : 0 }]}>
                        🛒 YOU'LL NEED · {ingredients.need.length}
                      </Text>
                      <View style={styles.chipRow}>
                        {ingredients.need.map((ing, i) => (
                          <IngredientChip key={i} label={ing.name} have={false} colors={colors} />
                        ))}
                      </View>
                      <TouchableOpacity
                        style={[styles.addToListBtn, addedToList && styles.addToListBtnDone]}
                        onPress={handleAddToShoppingList}
                        disabled={addedToList}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.addToListBtnText, addedToList && { color: colors.teal }]}>
                          {addedToList ? '✓ Added to Shopping List' : '+ Add all to Shopping List'}
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {ingredients.have.length === 0 && ingredients.need.length === 0 && (
                    <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: 8 }}>
                      No ingredients matched against your inventory.
                    </Text>
                  )}
                </View>
              )}

              {/* Recipe preview (collapsible) */}
              <View style={styles.previewCard}>
                <TouchableOpacity
                  style={styles.previewToggle}
                  onPress={() => setPreviewExpanded(v => !v)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.previewToggleLabel}>📄 RECIPE PREVIEW</Text>
                  <Text style={{ fontSize: 18, color: colors.textMuted }}>{previewExpanded ? '▲' : '▼'}</Text>
                </TouchableOpacity>
                {previewExpanded && (
                  <Text style={styles.previewText}>{extracted.recipe}</Text>
                )}
              </View>

              {/* Save button */}
              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={() => setPickerVisible(true)}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.saveBtnText}>📚 Save Recipe to Collection</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
        </KeyboardAvoidingView>
        </Animated.View>

      </Animated.View>
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
    header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: c.bg, borderBottomWidth: 0.5, borderBottomColor: c.border },
    headerTitle:  { fontSize: 16, fontWeight: '700', color: c.brand, fontFamily: 'Fraunces_600SemiBold' },
    backBtn:      { width: 40, height: 40, borderRadius: 20, backgroundColor: c.surface, borderWidth: 0.5, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },

    inputCard:    { backgroundColor: c.surface, borderRadius: 18, padding: 16, borderWidth: 0.5, borderColor: c.border, marginBottom: 16 },
    sectionLabel: { fontSize: 10, fontWeight: '700', color: c.textSub, letterSpacing: 1, marginBottom: 10 },
    urlInput:     { backgroundColor: c.bg, borderRadius: 12, borderWidth: 0.5, borderColor: c.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: c.text, marginBottom: 12, fontFamily: 'Fraunces_400Regular' },
    extractBtn:   { backgroundColor: c.btnPrimary, borderRadius: 13, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
    extractBtnText: { color: 'white', fontWeight: '700', fontSize: 15 },
    hintText:     { fontSize: 11, color: c.textMuted, lineHeight: 17 },

    loadingCard:  { backgroundColor: c.surface, borderRadius: 18, padding: 36, borderWidth: 0.5, borderColor: c.border, alignItems: 'center', gap: 14, marginBottom: 16 },
    loadingText:  { fontSize: 14, color: c.textSub, fontFamily: 'Fraunces_400Regular' },

    errorCard:    { backgroundColor: isDark ? 'rgba(232,117,106,0.08)' : 'rgba(232,117,106,0.06)', borderRadius: 18, padding: 20, borderWidth: 0.5, borderColor: 'rgba(232,117,106,0.3)', alignItems: 'center', marginBottom: 16 },
    errorTitle:   { fontSize: 16, fontWeight: '700', color: '#E8756A', marginBottom: 8, fontFamily: 'Fraunces_600SemiBold' },
    errorMsg:     { fontSize: 13, color: c.text, textAlign: 'center', lineHeight: 20, marginBottom: 12 },
    errorTip:     { fontSize: 12, color: c.textMuted, textAlign: 'center', lineHeight: 18, fontStyle: 'italic' },

    recipeHeader: { backgroundColor: c.surface, borderRadius: 18, padding: 16, borderWidth: 0.5, borderColor: c.border, marginBottom: 12 },
    platformBadge:    { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.chipBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: c.border },
    platformBadgeText:{ fontSize: 11, fontWeight: '600', color: c.textSub },
    recipeName:   { fontSize: 20, fontWeight: '700', color: c.brand, fontFamily: 'Fraunces_600SemiBold', lineHeight: 28 },

    ingredientsCard:          { backgroundColor: c.surface, borderRadius: 18, padding: 16, borderWidth: 0.5, borderColor: c.border, marginBottom: 12 },
    ingredientSectionLabel:   { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 10 },
    chipRow:                  { flexDirection: 'row', flexWrap: 'wrap' },
    addToListBtn:             { marginTop: 12, backgroundColor: 'rgba(232,117,106,0.1)', borderRadius: 12, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(232,117,106,0.3)' },
    addToListBtnDone:         { backgroundColor: 'rgba(29,158,117,0.1)', borderColor: 'rgba(29,158,117,0.3)' },
    addToListBtnText:         { fontSize: 14, fontWeight: '700', color: '#E8756A' },

    previewCard:    { backgroundColor: c.surface, borderRadius: 18, padding: 16, borderWidth: 0.5, borderColor: c.border, marginBottom: 16 },
    previewToggle:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    previewToggleLabel: { fontSize: 10, fontWeight: '700', color: c.textSub, letterSpacing: 1 },
    previewText:    { fontSize: 13, color: c.text, lineHeight: 21, marginTop: 14, fontFamily: 'Fraunces_400Regular' },

    saveBtn:      { backgroundColor: c.btnPrimary, borderRadius: 16, paddingVertical: 16, alignItems: 'center', shadowColor: isDark ? '#5DCAA5' : '#085041', shadowOffset: { width: 0, height: 6 }, shadowOpacity: isDark ? 0.18 : 0.3, shadowRadius: 14, elevation: 6 },
    saveBtnText:  { color: 'white', fontWeight: '700', fontSize: 16 },
  });
}
