import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, TextInput, KeyboardAvoidingView,
  Platform, ActivityIndicator, Animated, Modal, Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useState, useRef, useCallback, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, type ThemeColors } from '../context/theme';
import { useAppDrawer } from '../components/AppDrawer';
import { useSubscription } from '../context/subscription';
import { useAuth } from '../context/auth';
import { HOUSEHOLD_KEY } from '../lib/household';
import { pushItems } from '../lib/sync';
import {
  type Collection, type SavedRecipe,
  loadCollections, persistSavedRecipes, loadSavedRecipes, parseRecipeName,
  persistCollections,
} from '../lib/collections';
import {
  migrateLocalCollectionsToSupabase,
  pushSavedRecipes,
} from '../lib/collections-sync';
import { addToShoppingList, addToHouseholdShoppingList } from '../lib/shopping-list';
import { PortionDeductionSheet } from '../components/PortionDeductionSheet';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RecipeMacros { protein: number; carbs: number; fat: number; cal: number; servings?: number; servingSize?: string; fridgeDays?: number; }

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  time: string;
  showSuggestions?: boolean;
  welcomeChips?: { icon: string; name: string; days: number }[];
  recipeMacros?: RecipeMacros | null;
}

interface StoredItem {
  id: number;
  baseName: string;
  expiryDate: string;
  category: string;
  foodCategory?: string;
  icon?: string;
  protein?: number;
  carbs?: number;
  fat?: number;
  cal?: number;
  qty?: string;
  qtyNum?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDays(d: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(d).getTime() - today.getTime()) / 86400000);
}

function ftime(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function looksLikeRecipe(content: string) {
  return /\*\*(Ingredients|Steps|Instructions|Directions)\*\*/i.test(content) ||
    /\n\s*\d+\.\s+.{15,}/.test(content);
}

const QTY_RE = /^((?:a |an |[\d./]+\s*)(?:handful|bunch|cup|tbsp?|tsp?|oz|lb|g|kg|ml|clove|slice|piece|pinch|dash|can|jar|pkg|package|stick|fillet|breast|thigh|leg|whole|medium|large|small)s?\s+)(.+)$/i;

const GRAB_HEADER_RE = /(?:you (?:may |might )?(?:want to |need to )?grab|you(?:'ll| will)(?: need| want)?(?: to grab)?|missing ingredients?|pick up|grab these|shopping list)/i;

function parseMissingIngredients(content: string): { name: string; quantity?: string }[] {
  const seen = new Set<string>();
  const results: { name: string; quantity?: string }[] = [];

  const addRaw = (raw: string) => {
    // Strip markdown bold markers, leading bullets/quotes, trailing italic notes and (not in inventory)
    let s = raw.replace(/\*\*/g, '').replace(/^[-*•””””\s]+/, '').trim();
    s = s.replace(/\s*\*?\([^)]*\)\*?\s*$/, '').trim();
    s = s.replace(/\s*\*?\(not in inventory\)\*?\s*$/i, '').trim();
    if (!s) return;
    const m = s.match(QTY_RE);
    const name = m ? m[2].trim() : s;
    const quantity = m ? m[1].trim() : undefined;
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      results.push({ name, quantity });
    }
  };

  // Line-by-line scanner — handles **bold** headers, any phrasing, any line endings
  const lines = content.split('\n');
  let inGrabSection = false;
  for (const line of lines) {
    const stripped = line.replace(/\*\*/g, '').trim();

    if (GRAB_HEADER_RE.test(stripped)) {
      inGrabSection = true;
      continue;
    }

    if (inGrabSection) {
      if (/^[-*•””””]/.test(stripped)) {
        addRaw(stripped);
      } else if (stripped !== '') {
        // Non-bullet, non-empty line ends the section
        inGrabSection = false;
      }
    }

    // Also catch inline (not in inventory) tags anywhere in the message
    if (/\(not in inventory\)/i.test(line)) {
      const m = line.match(/(.+?)\s*\*?\(not in inventory\)\*?/i);
      if (m) addRaw(m[1]);
    }
  }

  return results;
}

// Render bold **text** inline
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

// ─── Constants ───────────────────────────────────────────────────────────────

function getQuickActions(hasExpiring: boolean) {
  return [
    {
      key: 'rescue',
      icon: hasExpiring ? '🕐' : '🍽️',
      label: hasExpiring ? 'Use expiring items' : 'Best recipe now',
      prompt: "Give me a complete full recipe using my most urgent items — include exact ingredient quantities, numbered steps, prep & cook time, and per-serving nutritional info.",
    },
    {
      key: 'mealprep',
      icon: '🍱',
      label: 'Meal prep',
      prompt: "Suggest a meal-prep friendly full recipe I can batch cook from my inventory — complete ingredient list, numbered steps, portion info, and storage tips.",
    },
  ];
}

const CUISINE_CHIPS = [
  { key: 'italian',       icon: '🇮🇹', label: 'Italian',       prompt: "Give me a complete Italian recipe using my inventory — full ingredient list with exact quantities, numbered steps, and nutritional info." },
  { key: 'asian',         icon: '🥢',  label: 'Asian',         prompt: "Give me a complete Asian-inspired recipe using my inventory — full ingredient list with exact quantities, numbered steps, and nutritional info." },
  { key: 'mexican',       icon: '🌮',  label: 'Mexican',       prompt: "Give me a complete Mexican recipe using my inventory — full ingredient list with exact quantities, numbered steps, and nutritional info." },
  { key: 'mediterranean', icon: '🥙',  label: 'Mediterranean', prompt: "Give me a complete Mediterranean recipe using my inventory — full ingredient list with exact quantities, numbered steps, and nutritional info." },
  { key: 'indian',        icon: '🍛',  label: 'Indian',        prompt: "Give me a complete Indian-inspired recipe using my inventory — full ingredient list with exact quantities, numbered steps, and nutritional info." },
  { key: 'comfort',       icon: '🥘',  label: 'Comfort food',  prompt: "Give me a complete comfort food recipe using my inventory — something hearty and satisfying, with full ingredient list, numbered steps, and nutritional info." },
];

const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL      ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function GoodBotScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const { menuBtn, drawerEl } = useAppDrawer();
  const { isPremium, showPaywall } = useSubscription();
  const { user } = useAuth();
  const [messages, setMessages]         = useState<ChatMessage[]>([]);
  const [input, setInput]               = useState('');
  const [loading, setLoading]           = useState(false);
  const [expiring, setExpiring]         = useState<(StoredItem & { days: number })[]>([]);
  const [suggestionChosen, setSuggestionChosen] = useState(false);

  // ── Recipe saving ────────────────────────────────────────────────────────────
  const [collections,      setCollections]      = useState<Collection[]>([]);
  const [savedMsgIds,      setSavedMsgIds]      = useState<Set<string>>(new Set());
  const [shoppingAddedIds, setShoppingAddedIds] = useState<Set<string>>(new Set());
  const [saveSheetMsg,   setSaveSheetMsg]   = useState<ChatMessage | null>(null);
  const [newColName,     setNewColName]     = useState('');
  const [creatingCol,    setCreatingCol]    = useState(false);
  const [cookSheetMsg,   setCookSheetMsg]   = useState<ChatMessage | null>(null);
  const [saveDishMsg,    setSaveDishMsg]    = useState<ChatMessage | null>(null);
  const [saveDishName,   setSaveDishName]   = useState('');
  const [saveDishDays,   setSaveDishDays]   = useState('3');
  const [saveDishServings, setSaveDishServings] = useState('2');

  const scrollRef        = useRef<ScrollView>(null);
  const convoRef         = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const expiringRef      = useRef<(StoredItem & { days: number })[]>([]);
  const allItemsRef      = useRef<(StoredItem & { days: number })[]>([]);
  const nameRef          = useRef('');
  const dietaryRef       = useRef<string[]>([]);
  const householdRef     = useRef(1);
  const householdIdRef   = useRef<string | undefined>(undefined);
  const initialized      = useRef(false);
  const msgLayouts   = useRef<Map<string, number>>(new Map());

  // Animations
  const screenFade  = useRef(new Animated.Value(0)).current;
  const screenSlide = useRef(new Animated.Value(24)).current;
  const heroScale   = useRef(new Animated.Value(0.94)).current;
  const chatOpacity = useRef(new Animated.Value(0)).current;
  const chatSlide   = useRef(new Animated.Value(15)).current;
  const sendScale   = useRef(new Animated.Value(1)).current;
  const msgAnims    = useRef<Map<string, { op: Animated.Value; y: Animated.Value }>>(new Map());

  const getMsgAnim = (id: string) => {
    if (!msgAnims.current.has(id)) {
      const op = new Animated.Value(0);
      const y  = new Animated.Value(14);
      msgAnims.current.set(id, { op, y });
      Animated.parallel([
        Animated.timing(op, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(y,  { toValue: 0, damping: 22, stiffness: 260, useNativeDriver: true }),
      ]).start();
    }
    return msgAnims.current.get(id)!;
  };

  // ── Data loading ────────────────────────────────────────────────────────────

  useFocusEffect(useCallback(() => {
    screenFade.setValue(0);
    screenSlide.setValue(24);
    heroScale.setValue(0.94);
    chatOpacity.setValue(0);
    chatSlide.setValue(15);
    Animated.parallel([
      Animated.timing(screenFade,  { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.spring(screenSlide, { toValue: 0, damping: 24, stiffness: 200, useNativeDriver: true }),
      Animated.spring(heroScale,   { toValue: 1, damping: 16, stiffness: 200, useNativeDriver: true }),
    ]).start();
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(chatOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(chatSlide,   { toValue: 0, damping: 22, stiffness: 180, useNativeDriver: true }),
      ]).start();
    }, 100);

    loadCollections().then(setCollections);

    // Trigger one-time migration of local collections → Supabase
    if (user?.id) migrateLocalCollectionsToSupabase(user.id).catch(() => {});

    (async () => {
      const [itemsVal, profileVal, householdId] = await Promise.all([
        AsyncStorage.getItem('gogood_items'),
        AsyncStorage.getItem('gogood_profile'),
        AsyncStorage.getItem(HOUSEHOLD_KEY),
      ]);
      householdIdRef.current = householdId ?? undefined;

      const rawItems: StoredItem[] = itemsVal ? JSON.parse(itemsVal) : [];
      const withDays = rawItems
        .map(i => ({ ...i, days: getDays(i.expiryDate) }))
        .sort((a, b) => a.days - b.days);

      const soon = withDays.filter(i => i.days <= 3);
      const profile = profileVal ? JSON.parse(profileVal) : {};
      const name = profile.name || '';

      setExpiring(soon);
      expiringRef.current = soon;
      allItemsRef.current = withDays;
      nameRef.current = name;
      dietaryRef.current = profile.dietary || [];
      householdRef.current = profile.household || 1;

      // Re-run initChat if: first visit OR no user messages sent yet (opening message is still fresh)
      const noUserMsgYet = convoRef.current.filter(m => m.role === 'user').length === 0;
      if (!initialized.current || noUserMsgYet) {
        initialized.current = true;
        initChat(soon, withDays, name);
      }
    })();
  }, []));

  // ── Chat init ────────────────────────────────────────────────────────────────

  const initChat = (
    soon: (StoredItem & { days: number })[],
    all: (StoredItem & { days: number })[],
    name: string,
  ) => {
    const first = name ? name.split(' ')[0] : '';
    const hi    = first ? `Hey ${first}! 👋` : 'Hey! 👋';

    let content: string;
    let showSuggestions = false;
    let welcomeChips: { icon: string; name: string; days: number }[] | undefined;

    if (all.length === 0) {
      content = `${hi} Your inventory is empty — add some items on the Home tab and I'll help you cook with what you've got!`;
    } else if (soon.length === 0) {
      const cats = [...new Set(all.map(i => i.foodCategory || i.baseName))].slice(0, 3).join(', ');
      content = `${hi} Your food is looking fresh — nothing urgent right now. You've got **${all.length} item${all.length !== 1 ? 's' : ''}** including ${cats}. What would you like to make?`;
      showSuggestions = true;
    } else {
      const todayItems = soon.filter(i => i.days <= 0);
      const urgency = todayItems.length > 0
        ? `⚠️ ${todayItems.map(i => `**${i.baseName}**`).join(', ')} expire${todayItems.length === 1 ? 's' : ''} today! `
        : '';
      content = `${hi} ${urgency}${soon.length} item${soon.length !== 1 ? 's' : ''} expiring soon — let's put them to good use before they go bad. What sounds good?`;
      welcomeChips = soon.slice(0, 6).map(i => ({ icon: i.icon || '🥘', name: i.baseName, days: i.days }));
      showSuggestions = true;
    }

    const msg: ChatMessage = { id: '0', role: 'assistant', content, time: ftime(new Date()), showSuggestions, welcomeChips };
    setSuggestionChosen(false);
    setMessages([msg]);
    convoRef.current = [{ role: 'assistant', content }];
  };

  // ── Claude API ───────────────────────────────────────────────────────────────

  const systemPrompt = () => {
    const all = allItemsRef.current;

    const fmt = (i: StoredItem & { days: number }) => {
      const loc = i.category === 'freezer' ? '❄️' : i.category === 'pantry' ? '🥫' : '🥗';
      const exp = i.days < 0 ? 'EXPIRED' : i.days === 0 ? 'expires TODAY' : `${i.days}d left`;
      const qty = i.qtyNum ?? 1;
      const parts: string[] = [];
      // Per-unit macros — these are stored per serving/per item, NOT totals
      if (i.protein) parts.push(`${Math.round(i.protein)}g protein`);
      if (i.carbs)   parts.push(`${Math.round(i.carbs)}g carbs`);
      if (i.fat)     parts.push(`${Math.round(i.fat)}g fat`);
      if (i.cal)     parts.push(`${Math.round(i.cal)} cal`);
      const nutrition = parts.length ? ` [per unit: ${parts.join(', ')}; have: ${qty}]` : ` [have: ${qty}]`;
      return `  ${loc} ${i.baseName}${i.qty ? ` (${i.qty})` : ''} — ${exp}${nutrition}`;
    };

    const overdue  = all.filter(i => i.days <  0);
    const today    = all.filter(i => i.days === 0);
    const urgent   = all.filter(i => i.days >= 1 && i.days <= 3);
    const soon     = all.filter(i => i.days >= 4 && i.days <= 7);
    const fresh    = all.filter(i => i.days  >  7 && i.category !== 'freezer');
    const frozen   = all.filter(i => i.category === 'freezer');
    const pantry   = all.filter(i => i.category === 'pantry'  && i.days > 7);

    const section = (title: string, items: typeof all) =>
      items.length ? `${title}\n${items.map(fmt).join('\n')}` : '';

    const inventory = [
      section('🚨 EXPIRED (use or discard now):', overdue),
      section('⏰ EXPIRES TODAY:', today),
      section('🔴 EXPIRING IN 1–3 DAYS:', urgent),
      section('🟡 EXPIRING IN 4–7 DAYS:', soon),
      section('✅ FRESH (8+ days):', fresh),
      section('❄️ FROZEN:', frozen),
      section('🥫 PANTRY:', pantry),
    ].filter(Boolean).join('\n\n');

    const dietary = dietaryRef.current.length ? dietaryRef.current.join(', ') : 'none specified';
    const household = householdRef.current;

    return `You are Good Bot, a warm and knowledgeable kitchen AI inside Go Good, a food-waste reduction app. Your job is to help users cook creatively with what they actually have, prioritising items that expire soonest.

USER PROFILE
Name: ${nameRef.current || 'there'}
Household size: ${household} ${household === 1 ? 'person' : 'people'}
Dietary preferences: ${dietary}

CURRENT INVENTORY (${all.length} items)
${inventory || 'No items in inventory yet.'}

INGREDIENT GUIDELINES
- Always prioritise and build recipes around what the user already has, especially expiring items.
- You MAY suggest up to 3–4 additional ingredients not in the inventory when they would meaningfully improve the recipe (e.g., garlic, olive oil, fresh herbs, broth, a squeeze of lemon). Use this freedom to enhance the experience, not to replace what they have.
- Pantry basics that most households always have (salt, pepper, oil) do not need to be flagged as missing.
- Whenever you suggest an ingredient the user does NOT have in their inventory, list it in a **You may want to grab:** section at the end of the recipe (before the RECIPE_MACROS block), using plain bullet points — one item per line, with its quantity:
**You may want to grab:**
- 1 clove garlic
- A handful of fresh parsley
- 1 tbsp olive oil
Only include this section when there are genuinely missing items. Omit it entirely if the recipe uses only inventory items.

CULINARY INTELLIGENCE — FLAVOR COMPATIBILITY (CRITICAL — read before every recipe)
- Apply real culinary judgment. Never force ingredients together just because they're all expiring.
- Sweet fruit (banana, mango, strawberry, apple, pear, grapes) does NOT belong in savory egg dishes, meat scrambles, or skillets. A "banana sausage egg scramble" is not a real dish — it's inedible.
- If expiring items clash in flavor profile, suggest SEPARATE dishes for each group: e.g. "Here's what I'd do: turn your sausage and eggs into [savory dish], and use your banana separately for [breakfast/snack idea]"
- Only combine sweet fruit with savory protein in well-established contexts: pineapple pork, mango salsa on fish, apple with pork chops, cranberry with turkey.
- Classic pairings to lean into: egg + sausage (breakfast skillet, frittata, hash), banana + oats/nut butter/yogurt (smoothie, overnight oats, banana pancakes), sausage + pepper/onion/potato (hash, pasta).
- Ask yourself: "Would a trained chef serve this?" If no, split the items into separate dishes.

RECIPE GUIDELINES
- Prioritise urgency: build recipes around expired/today/1–3 day items first; use fresh items to complement
- When items clash in flavor, suggest multiple small recipes instead of one forced combination — this is better food-waste strategy anyway
- Always include: dish name, prep time + cook time, number of servings, difficulty (Easy / Medium / Hard)
- List ingredients with specific quantities (e.g. "2 cups spinach", "1 tbsp olive oil") — never vague amounts
- Scale all quantities to ${household} ${household === 1 ? 'person' : 'people'}
- Number every cooking step; keep steps concise and actionable
- Respect dietary preferences strictly — if the user is vegan, every ingredient must be vegan; never add "to make vegan, omit X" — just build it that way from the start
- If an item is expired, briefly tell the user how to check if it's still good (smell, look, texture) before using
- Mention storage tip for leftovers when relevant (e.g. "stores in fridge up to 3 days")
- Be warm, encouraging, and non-judgmental — food waste is a challenge, not a moral failure
- Reply length: conversational answers ≤ 200 words; quick tips ≤ 100 words; full or blog recipes ≤ 550 words
- Use **bold** only for section headers (e.g. **Ingredients**, **Steps**, **Tips & Swaps**)

FOOD BLOG STYLE (when the user asks for blog-style or "from a food blog")
- Give the recipe a creative, catchy title (e.g. "Weeknight Spinach & Egg Skillet")
- Open with 2–3 warm sentences: a relatable scenario, why this dish works, or what makes it special
- Include **Tips & Swaps** section with 2–3 substitutions for missing or swappable ingredients
- End with a **Storage** note (fridge/freezer life, reheating tip)
- Write with the warmth and approachability of Budget Bytes, Smitten Kitchen, or Half Baked Harvest
- You can reference inspiration: "In the spirit of Smitten Kitchen's unfussy weeknight approach…"

DIETARY PERSONALISATION (when the user requests a diet-specific recipe)
- Lead with the dietary constraint as a creative frame, not a limitation
- Actively highlight what makes the dish great *within* those constraints (e.g. high-protein, naturally gluten-free)
- Never suggest adding non-compliant ingredients "optionally"

SERVING SIZE CONFIRMATION (required for every recipe that uses inventory items with known macros)
Before the RECIPE_MACROS block, add one line like this (only for items that have [per unit] macros listed above):
"📊 **Macro sources:** [item]: [X cal] per [unit/serving] × [qty used in recipe] — let me know if your portion size differs and I'll recalculate."
This confirms to the user exactly what serving size was assumed. If an item's unit is ambiguous (e.g. "banana" with no gram weight, or "sausage" where size varies), note it: "(assumed standard size — confirm if yours is larger/smaller)".

RECIPE MACROS (full recipes only — not tips or conversational replies)
Macro calculation rules:
1. For every ingredient that appears in the inventory with [per unit] macros, use those exact values × the number of units/servings used in this recipe — do NOT estimate or substitute your own values for these items
2. For pantry staples or items without stored macros, use standard USDA estimates
3. Sum all ingredients, then divide by number of recipe servings
4. Round all values to whole integers

At the very end of every complete recipe, append this exact block on its own lines with no extra text before or after it:
RECIPE_MACROS
Servings: X | Serving size: Xg | Fridge days: X
Protein: Xg | Carbs: Xg | Fat: Xg | Cal: X
END_RECIPE_MACROS
All values are PER SERVING. "Fridge days" is how long the cooked dish safely keeps refrigerated (1–7).`;
  };

  const callClaude = async (userMsg: string): Promise<string> => {
    if (!SUPABASE_URL || SUPABASE_URL === 'your_supabase_project_url') {
      return "Good Bot isn't connected yet — add your Supabase URL and anon key to .env 🔑";
    }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/goodbot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        systemPrompt: systemPrompt(),
        messages: [...convoRef.current, { role: 'user', content: userMsg }],
        householdId: householdIdRef.current,
      }),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    if (data.error) {
      if (data.error.type === 'authentication_error') {
        return "Good Bot's API key needs to be updated — please contact support 🔑";
      }
      throw new Error(data.error.message || 'API error');
    }
    if (!data.content?.[0]?.text) throw new Error('empty');
    return data.content[0].text;
  };

  // ── Send message ─────────────────────────────────────────────────────────────

  const send = async (text: string) => {
    if (!isPremium) { showPaywall(); return; }
    const t = text.trim();
    if (!t || loading) return;
    setInput('');
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const userMsg: ChatMessage = { id: String(Date.now()), role: 'user', content: t, time: ftime(new Date()) };
    setMessages(prev => [...prev, userMsg]);
    convoRef.current.push({ role: 'user', content: t });
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);

    try {
      const reply = await callClaude(t);
      const newMacro = reply.match(/RECIPE_MACROS\nServings:\s*(\d+)\s*\|\s*Serving size:\s*([^|\n]+?)(?:\s*\|\s*Fridge days:\s*(\d+))?\s*\nProtein:\s*(\d+)g\s*\|\s*Carbs:\s*(\d+)g\s*\|\s*Fat:\s*(\d+)g\s*\|\s*Cal:\s*(\d+)\nEND_RECIPE_MACROS/);
      const oldMacro = reply.match(/RECIPE_MACROS\nProtein:\s*(\d+)g\s*\|\s*Carbs:\s*(\d+)g\s*\|\s*Fat:\s*(\d+)g\s*\|\s*Cal:\s*(\d+)\nEND_RECIPE_MACROS/);
      const recipeMacros: RecipeMacros | null = newMacro
        ? { servings: +newMacro[1], servingSize: newMacro[2].trim(), fridgeDays: newMacro[3] ? +newMacro[3] : 3, protein: +newMacro[4], carbs: +newMacro[5], fat: +newMacro[6], cal: +newMacro[7] }
        : oldMacro
        ? { protein: +oldMacro[1], carbs: +oldMacro[2], fat: +oldMacro[3], cal: +oldMacro[4] }
        : null;
      const cleanReply = reply.replace(/\nRECIPE_MACROS\n[\s\S]*?\nEND_RECIPE_MACROS/, '').trimEnd();
      const botMsgId = String(Date.now() + 1);
      const botMsg: ChatMessage = { id: botMsgId, role: 'assistant', content: cleanReply, time: ftime(new Date()), recipeMacros };
      setMessages(prev => [...prev, botMsg]);
      convoRef.current.push({ role: 'assistant', content: cleanReply });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        const y = msgLayouts.current.get(botMsgId);
        if (y !== undefined) {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
        } else {
          scrollRef.current?.scrollToEnd({ animated: true });
        }
      }, 150);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const errMsg: ChatMessage = { id: String(Date.now() + 1), role: 'assistant', content: 'Something went wrong — check your connection and try again.', time: ftime(new Date()) };
      setMessages(prev => [...prev, errMsg]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }

    setLoading(false);
  };

  const chooseSuggestion = (prompt: string) => {
    if (!isPremium) { showPaywall(); return; }
    Haptics.selectionAsync();
    setSuggestionChosen(true);
    send(prompt);
  };

  // ── Save cooked dish to fridge ────────────────────────────────────────────────

  const saveDishToFridge = async (name: string, days: number, servings: number, macros?: RecipeMacros | null) => {
    const raw = await AsyncStorage.getItem('gogood_items');
    const existing = raw ? JSON.parse(raw) : [];

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + days);
    const expiryDate = expiry.toISOString().split('T')[0];
    const badge = days <= 0 ? 'black' : days === 0 ? 'red' : days <= 5 ? 'amber' : 'green';
    const expires = days <= 0 ? 'expired' : days === 0 ? 'today' : `${days} days`;

    const newItem = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      icon: '🍽️',
      name, baseName: name.toLowerCase(), batch: 1,
      qty: `${servings} serving${servings !== 1 ? 's' : ''}`,
      qtyNum: servings, unit: 'servings',
      expiryDate, expires, badge, days,
      protein: (macros?.protein ?? 0) * servings,
      carbs:   (macros?.carbs   ?? 0) * servings,
      fat:     (macros?.fat     ?? 0) * servings,
      cal:     (macros?.cal     ?? 0) * servings,
      category: 'fridge' as const,
      addedAt: Date.now(),
      foodCategory: 'Leftovers',
    };

    const updated = [...existing, newItem];
    const statsRaw = await AsyncStorage.getItem('gogood_stats');
    const stats = statsRaw ? JSON.parse(statsRaw) : { goneGood: 0, goneBad: 0, totalAdded: 0 };
    await Promise.all([
      AsyncStorage.setItem('gogood_items', JSON.stringify(updated)),
      AsyncStorage.setItem('gogood_stats', JSON.stringify({ ...stats, totalAdded: (stats.totalAdded || 0) + 1 })),
    ]);

    if (user?.id) {
      const hhId = await AsyncStorage.getItem(HOUSEHOLD_KEY);
      pushItems(updated, user.id, hhId ?? undefined);
    }
  };

  // ── Save recipe ───────────────────────────────────────────────────────────────

  const confirmSave = async (collectionId: string) => {
    if (!saveSheetMsg) return;
    const existing = await loadSavedRecipes();
    const recipe: SavedRecipe = {
      id:           String(Date.now()),
      collectionId,
      name:         parseRecipeName(saveSheetMsg.content),
      content:      saveSheetMsg.content,
      recipeMacros: saveSheetMsg.recipeMacros ?? null,
      savedAt:      Date.now(),
    };
    const updated = [...existing, recipe];
    await persistSavedRecipes(updated);
    // Async Supabase sync — fire and forget, local is source of truth
    if (user?.id) {
      pushSavedRecipes(updated, user.id, householdIdRef.current).catch(() => {});
    }
    setSavedMsgIds(prev => new Set(prev).add(saveSheetMsg.id));
    setSaveSheetMsg(null);
    setNewColName('');
    setCreatingCol(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleCreateAndSave = async () => {
    if (!newColName.trim() || !saveSheetMsg) return;
    const newCol: Collection = {
      id: String(Date.now()),
      name: newColName.trim(),
      emoji: '🍳',
      createdAt: Date.now(),
    };
    const updatedCols = [...collections, newCol];
    setCollections(updatedCols);
    await persistCollections(updatedCols);
    await confirmSave(newCol.id);
  };

  // ── Add missing ingredients to shopping list ─────────────────────────────────

  const addMissingToList = async (msg: ChatMessage) => {
    const missing = parseMissingIngredients(msg.content);
    if (!missing.length) return;
    const recipeName = parseRecipeName(msg.content);
    const items = missing.map(item => ({
      name: item.name,
      quantity: item.quantity,
      icon: '🛒',
      recipeName: recipeName || undefined,
    }));
    const householdId = await AsyncStorage.getItem(HOUSEHOLD_KEY);
    if (householdId) {
      await addToHouseholdShoppingList(householdId, items);
    } else {
      await addToShoppingList(items);
    }
    setShoppingAddedIds(prev => new Set(prev).add(msg.id));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Added to shopping list 🛒', `${missing.length} missing ingredient${missing.length !== 1 ? 's' : ''} added to your list.`);
  };

  // ── Derived ──────────────────────────────────────────────────────────────────

  const urgentNames = expiring.slice(0, 3).map(i => i.baseName).join(' · ');
  const todayCount  = expiring.filter(i => i.days <= 0).length;

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.safe}>
      <StatusBar style={colors.statusBar} backgroundColor={colors.bg} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Animated.View style={[styles.container, { opacity: screenFade, transform: [{ translateY: screenSlide }] }]}>

          {/* ── Header ── */}
          <Animated.View style={{ transform: [{ scale: heroScale }] }}>
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
              {menuBtn}
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={styles.headerTitle}>
                  good<Text style={styles.headerTitleGreen}>bot</Text>
                </Text>
                <Text style={styles.headerSub}>always here to help 🌱</Text>
              </View>
              <View style={styles.avatarWrap}>
                <View style={styles.avatarCircle}>
                  <Text style={{ fontSize: 22 }}>🤖</Text>
                </View>
                <View style={styles.onlineDot} />
              </View>
            </View>
          </Animated.View>

          <Animated.View style={{ flex: 1, opacity: chatOpacity, transform: [{ translateY: chatSlide }] }}>
          <>
              {/* ── Alert card ── */}
              {expiring.length > 0 && (
                <View style={styles.alertCard}>
                  <View style={styles.alertLeft}>
                    <Text style={{ fontSize: 18 }}>⏰</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.alertTitle}>
                        {todayCount > 0
                          ? `${todayCount} item${todayCount !== 1 ? 's' : ''} expiring today`
                          : `${expiring.length} item${expiring.length !== 1 ? 's' : ''} expiring soon`}
                      </Text>
                      <Text style={styles.alertSub} numberOfLines={1}>
                        {urgentNames}{expiring.length > 3 ? ` +${expiring.length - 3} more` : ''}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.rescueBtn}
                    onPress={() => send(`What's the best thing I can make right now to use up ${urgentNames}?`)}
                  >
                    <Text style={styles.rescueBtnText}>rescue →</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* ── Chat ── */}
              <ScrollView
                ref={scrollRef}
                style={styles.chat}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ padding: 16, paddingBottom: 8, gap: 16 }}
              >
                {messages.map(msg => {
                  const { op, y } = getMsgAnim(msg.id);
                  return (
                  <Animated.View key={msg.id} style={{ opacity: op, transform: [{ translateY: y }] }} onLayout={e => msgLayouts.current.set(msg.id, e.nativeEvent.layout.y)}>
                    {msg.role === 'assistant' ? (
                      <View style={styles.botMsgWrap}>
                        <View style={styles.botBubble}>
                          <Markdown
                            text={msg.content}
                            style={styles.botText}
                            boldStyle={styles.botTextBold}
                          />
                        </View>
                        <Text style={styles.msgTime}>{msg.time}</Text>

                        {msg.recipeMacros && (
                          <View style={styles.macroCard}>
                            <View style={styles.macroCardHeader}>
                              <Text style={styles.macroCardTitle}>MACROS PER SERVING</Text>
                              {(msg.recipeMacros.servings || msg.recipeMacros.servingSize) && (
                                <Text style={styles.macroCardServing}>
                                  {msg.recipeMacros.servings ? `${msg.recipeMacros.servings} serving${msg.recipeMacros.servings !== 1 ? 's' : ''}` : ''}
                                  {msg.recipeMacros.servings && msg.recipeMacros.servingSize ? ' · ' : ''}
                                  {msg.recipeMacros.servingSize ?? ''}
                                </Text>
                              )}
                            </View>
                            <View style={styles.macroCardRow}>
                              {[
                                { label: 'PROTEIN', val: msg.recipeMacros.protein + 'g', color: colors.teal },
                                { label: 'CARBS',   val: msg.recipeMacros.carbs   + 'g', color: '#F5A623' },
                                { label: 'FAT',     val: msg.recipeMacros.fat     + 'g', color: '#E8756A' },
                                { label: 'CAL',     val: String(msg.recipeMacros.cal),  color: colors.brand },
                              ].map((m, i) => (
                                <View key={m.label} style={styles.macroCardItem}>
                                  {i > 0 && <View style={styles.macroCardDivider} />}
                                  <View style={styles.macroCardInner}>
                                    <Text style={[styles.macroCardNum, { color: m.color }]}>{m.val}</Text>
                                    <Text style={styles.macroCardLabel}>{m.label}</Text>
                                  </View>
                                </View>
                              ))}
                            </View>
                          </View>
                        )}

                        {(msg.recipeMacros || looksLikeRecipe(msg.content)) && (
                          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.tealLight + '33', borderColor: colors.teal }]} onPress={() => setCookSheetMsg(msg)}>
                              <Text style={styles.saveBtnText}>🍳  Cook This</Text>
                            </TouchableOpacity>
                            {savedMsgIds.has(msg.id)
                              ? <Text style={styles.savedBadge}>✓ Saved to Recipes</Text>
                              : <TouchableOpacity style={styles.saveBtn} onPress={() => { setSaveSheetMsg(msg); setCreatingCol(false); setNewColName(''); }}>
                                  <Text style={styles.saveBtnText}>💾  Save to Recipes</Text>
                                </TouchableOpacity>
                            }
                          </View>
                        )}

                        {(() => {
                          const missing = parseMissingIngredients(msg.content);
                          if (!missing.length) return null;
                          return shoppingAddedIds.has(msg.id)
                            ? <Text style={styles.savedBadge}>✓ Added {missing.length} item{missing.length !== 1 ? 's' : ''} to shopping list</Text>
                            : (
                              <TouchableOpacity
                                style={[styles.saveBtn, { borderColor: '#F5A623', backgroundColor: '#FFF8E620' }]}
                                onPress={() => addMissingToList(msg)}
                              >
                                <Text style={styles.saveBtnText}>🛒  Add {missing.length} missing item{missing.length !== 1 ? 's' : ''} to list</Text>
                              </TouchableOpacity>
                            );
                        })()}

                        {msg.showSuggestions && !suggestionChosen && (
                          <View style={styles.suggestCard}>
                            {/* Quick action chips */}
                            <Text style={styles.suggestLabel}>what sounds good?</Text>
                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={false}
                              contentContainerStyle={styles.suggestScrollContent}
                            >
                              {[...getQuickActions(!!(msg.welcomeChips?.length)), ...CUISINE_CHIPS].map(s => (
                                <TouchableOpacity key={s.key} style={styles.suggestChip} onPress={() => chooseSuggestion(s.prompt)}>
                                  <Text style={styles.suggestChipIcon}>{s.icon}</Text>
                                  <Text style={styles.suggestChipLabel}>{s.label}</Text>
                                </TouchableOpacity>
                              ))}
                            </ScrollView>
                            <Text style={styles.orType}>or type your own question below ↓</Text>
                          </View>
                        )}
                      </View>
                    ) : (
                      <View style={styles.userMsgWrap}>
                        <View style={styles.userBubble}>
                          <Text style={styles.userText}>{msg.content}</Text>
                        </View>
                        <Text style={[styles.msgTime, { textAlign: 'right' }]}>{msg.time}</Text>
                      </View>
                    )}
                  </Animated.View>
                  );
                })}

                {loading && (
                  <View style={styles.botMsgWrap}>
                    <View style={[styles.botBubble, { paddingVertical: 14 }]}>
                      <ActivityIndicator size="small" color={colors.teal} />
                    </View>
                  </View>
                )}
              </ScrollView>

              {/* ── Input ── */}
              <View style={styles.inputRow}>
                <View style={{ flex: 1 }}>
                  <TextInput
                    style={styles.chatInput}
                    placeholder={isPremium ? 'ask Good Bot anything...' : '🔒 Upgrade to chat with Good Bot'}
                    placeholderTextColor={colors.textMuted}
                    value={input}
                    onChangeText={setInput}
                    multiline
                    blurOnSubmit
                    returnKeyType="send"
                    onSubmitEditing={() => send(input)}
                    editable={isPremium}
                  />
                  {!isPremium && (
                    <TouchableOpacity
                      style={{ ...StyleSheet.absoluteFillObject }}
                      onPress={showPaywall}
                      activeOpacity={0.7}
                    />
                  )}
                </View>
                <Animated.View style={{ transform: [{ scale: sendScale }] }}>
                  <TouchableOpacity
                    style={[styles.sendBtn, (!input.trim() || loading) && { opacity: 0.35 }]}
                    onPress={() => send(input)}
                    onPressIn={() => Animated.spring(sendScale, { toValue: 0.85, damping: 18, stiffness: 400, useNativeDriver: true }).start()}
                    onPressOut={() => Animated.spring(sendScale, { toValue: 1,    damping: 14, stiffness: 250, useNativeDriver: true }).start()}
                    disabled={!input.trim() || loading}
                  >
                    <Text style={styles.sendBtnText}>→</Text>
                  </TouchableOpacity>
                </Animated.View>
              </View>
          </>
          </Animated.View>

        </Animated.View>
      </KeyboardAvoidingView>

      {/* ── Save-to-collection sheet ── */}
      <Modal visible={!!saveSheetMsg} transparent animationType="slide" onRequestClose={() => setSaveSheetMsg(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => { setSaveSheetMsg(null); setCreatingCol(false); setNewColName(''); }} />
          <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 36 }}>
            <View style={{ width: 36, height: 4, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 999, alignSelf: 'center', marginVertical: 12 }} />
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.brand, paddingHorizontal: 20, marginBottom: 4, fontFamily: 'Fraunces_600SemiBold' }}>
              Save Recipe
            </Text>
            <Text style={{ fontSize: 12, color: colors.textSub, paddingHorizontal: 20, marginBottom: 16 }}>
              {parseRecipeName(saveSheetMsg?.content ?? '')}
            </Text>

            <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
              {/* Uncategorized */}
              <TouchableOpacity style={styles.colOption} onPress={() => confirmSave('')}>
                <Text style={{ fontSize: 22, marginRight: 12 }}>📌</Text>
                <Text style={styles.colOptionText}>No Collection</Text>
              </TouchableOpacity>

              {/* Existing collections */}
              {collections.map(col => (
                <TouchableOpacity key={col.id} style={styles.colOption} onPress={() => confirmSave(col.id)}>
                  <Text style={{ fontSize: 22, marginRight: 12 }}>{col.emoji}</Text>
                  <Text style={styles.colOptionText}>{col.name}</Text>
                </TouchableOpacity>
              ))}

              {/* Create new */}
              {creatingCol ? (
                <View style={[styles.colOption, { flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
                  <TextInput
                    style={{ backgroundColor: colors.surface, borderRadius: 10, borderWidth: 0.5, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text }}
                    placeholder="Collection name..."
                    placeholderTextColor={colors.textMuted}
                    value={newColName}
                    onChangeText={setNewColName}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={handleCreateAndSave}
                  />
                  <TouchableOpacity
                    style={{ backgroundColor: colors.btnPrimary, borderRadius: 10, paddingVertical: 10, alignItems: 'center', opacity: newColName.trim() ? 1 : 0.4 }}
                    onPress={handleCreateAndSave}
                  >
                    <Text style={{ color: 'white', fontWeight: '700', fontSize: 14 }}>Create & Save</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={[styles.colOption, { borderStyle: 'dashed' }]} onPress={() => setCreatingCol(true)}>
                  <Text style={{ fontSize: 22, marginRight: 12 }}>＋</Text>
                  <Text style={[styles.colOptionText, { color: colors.teal }]}>New Collection</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {drawerEl}

      <PortionDeductionSheet
        visible={!!cookSheetMsg}
        onClose={() => setCookSheetMsg(null)}
        onConfirm={() => {
          const msg = cookSheetMsg;
          setCookSheetMsg(null);
          const name = parseRecipeName(msg?.content ?? '');
          const macros = msg?.recipeMacros;
          setSaveDishName(name);
          setSaveDishDays(String(macros?.fridgeDays ?? 3));
          setSaveDishServings(String(macros?.servings ?? 2));
          // Wait for PortionDeductionSheet dismiss animation (~260ms) before showing next modal
          setTimeout(() => setSaveDishMsg(msg), 320);
        }}
        recipeContent={cookSheetMsg?.content ?? ''}
        userId={user?.id}
        householdId={householdIdRef.current ?? null}
        colors={colors}
      />

      {/* ── Save dish to leftovers sheet ── */}
      <Modal visible={!!saveDishMsg} transparent animationType="slide" onRequestClose={() => setSaveDishMsg(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setSaveDishMsg(null)} />
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
                    {saveDishMsg?.recipeMacros ? ` · ${saveDishMsg.recipeMacros.cal} cal/serving` : ''}
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
                await saveDishToFridge(saveDishName.trim(), days, servings, saveDishMsg?.recipeMacros ?? undefined);
                setSaveDishMsg(null);
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
                setSaveDishMsg(null);
                Alert.alert('🍳 Enjoy your meal!', 'Inventory updated from recipe.');
              }}
            >
              <Text style={{ color: colors.textMuted, fontSize: 13 }}>Skip — I'll eat it all now</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function createStyles(c: ThemeColors, isDark = false) { return StyleSheet.create({
  safe:               { flex: 1, backgroundColor: c.bg },
  container:          { flex: 1, backgroundColor: c.bg },

  // Header
  header:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, backgroundColor: c.bg, borderBottomWidth: 0.5, borderBottomColor: c.border, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 3 },
  avatarWrap:         { position: 'relative', width: 46, height: 46 },
  avatarCircle:       { width: 46, height: 46, borderRadius: 23, backgroundColor: c.btnPrimary, alignItems: 'center', justifyContent: 'center', shadowColor: isDark ? '#5DCAA5' : '#085041', shadowOffset: { width: 0, height: 5 }, shadowOpacity: isDark ? 0.25 : 0.5, shadowRadius: 12, elevation: 6 },
  onlineDot:          { position: 'absolute', bottom: 1, right: 1, width: 11, height: 11, borderRadius: 6, backgroundColor: c.teal, borderWidth: 2, borderColor: c.onlineDotBorder },
  headerTitle:        { fontSize: 28, fontWeight: '700', color: c.brand, fontFamily: 'Fraunces_600SemiBold' },
  headerTitleGreen:   { color: c.teal, fontFamily: 'Fraunces_600SemiBold' },
  headerSub:          { fontSize: 12, color: c.teal, marginTop: 2 },
  // Alert
  alertCard:          { flexDirection: 'row', alignItems: 'center', backgroundColor: isDark ? 'rgba(245,200,66,0.08)' : '#FFF8E6', borderBottomWidth: 0.5, borderBottomColor: isDark ? 'rgba(245,200,66,0.2)' : '#F5C842', paddingHorizontal: 16, paddingVertical: 10, gap: 10, marginTop: 8, shadowColor: '#F5C842', shadowOffset: { width: 0, height: 4 }, shadowOpacity: isDark ? 0.15 : 0.35, shadowRadius: 10, elevation: 4 },
  alertLeft:          { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  alertTitle:         { fontSize: 12, fontWeight: '600', color: isDark ? '#F5D090' : '#8A5C00' },
  alertSub:           { fontSize: 11, color: c.textSub, marginTop: 2 },
  rescueBtn:          { backgroundColor: isDark ? 'rgba(245,200,66,0.12)' : 'rgba(245,200,66,0.25)', borderWidth: 1, borderColor: isDark ? 'rgba(245,200,66,0.3)' : '#F5C842', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
  rescueBtnText:      { fontSize: 11, fontWeight: '600', color: isDark ? '#F5D090' : '#8A5C00' },

  // Chat
  chat:               { flex: 1 },
  botMsgWrap:         { gap: 6 },
  botBubble:          { backgroundColor: c.surface, borderRadius: 16, borderTopLeftRadius: 4, padding: 14, borderWidth: 0.5, borderColor: c.border, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 6 },
  botText:            { fontSize: 14, color: c.text, lineHeight: 21, fontFamily: 'Fraunces_400Regular' },
  botTextBold:        { fontWeight: '700', color: c.text, fontFamily: 'Fraunces_600SemiBold' },
  msgTime:            { fontSize: 10, color: c.textMuted, paddingHorizontal: 4 },
  userMsgWrap:        { alignItems: 'flex-end', gap: 4 },
  userBubble:         { backgroundColor: c.btnPrimary, borderRadius: 16, borderBottomRightRadius: 4, padding: 12, maxWidth: '80%', shadowColor: isDark ? '#5DCAA5' : '#085041', shadowOffset: { width: 0, height: 5 }, shadowOpacity: isDark ? 0.25 : 0.5, shadowRadius: 14, elevation: 8 },
  userText:           { fontSize: 14, color: 'white', lineHeight: 20 },

  // Recipe macro card
  macroCard:          { backgroundColor: c.surface, borderRadius: 14, borderWidth: 0.5, borderColor: c.border, padding: 12, shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  macroCardHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  macroCardTitle:     { fontSize: 9, fontWeight: '700', color: c.textSub, letterSpacing: 1.2, textTransform: 'uppercase' },
  macroCardServing:   { fontSize: 9, color: c.textMuted, fontWeight: '500' },
  macroCardRow:       { flexDirection: 'row', alignItems: 'center' },
  macroCardItem:      { flex: 1, flexDirection: 'row', alignItems: 'center' },
  macroCardInner:     { flex: 1, alignItems: 'center' },
  macroCardDivider:   { width: 0.5, height: 30, backgroundColor: c.border },
  macroCardNum:       { fontSize: 18, fontWeight: '700' },
  macroCardLabel:     { fontSize: 8, color: c.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },

  orType:             { fontSize: 11, color: c.textMuted, textAlign: 'center', paddingBottom: 14, paddingTop: 2 },

  // Welcome + suggestion card
  suggestCard:        { backgroundColor: c.surface, borderRadius: 16, borderTopLeftRadius: 4, borderWidth: 0.5, borderColor: c.border, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 6, overflow: 'hidden' },
  suggestLabel:       { fontSize: 10, fontWeight: '700', color: c.textSub, textTransform: 'uppercase', letterSpacing: 1.1, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 },
  suggestScrollContent: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 14, paddingTop: 4 },
  suggestChip:        { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.bg, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9, borderWidth: 1, borderColor: c.border },
  suggestChipIcon:    { fontSize: 15 },
  suggestChipLabel:   { fontSize: 13, fontWeight: '600', color: c.text, fontFamily: 'Fraunces_600SemiBold' },

  // Expiring-item chips inside welcome card
  chipSection:        { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4 },
  chipSectionLabel:   { fontSize: 10, fontWeight: '700', color: c.textSub, textTransform: 'uppercase', letterSpacing: 1.1, marginBottom: 8 },
  chipRow:            { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  expiryChip:         { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1 },
  expiryChipRed:      { backgroundColor: isDark ? 'rgba(245,90,90,0.2)'  : '#FEEBEB', borderColor: isDark ? 'rgba(245,90,90,0.4)'  : '#F5A0A0' },
  expiryChipAmber:    { backgroundColor: isDark ? 'rgba(245,180,60,0.2)' : '#FFF8E6', borderColor: isDark ? 'rgba(245,180,60,0.4)' : '#F5C842' },
  expiryChipGreen:    { backgroundColor: c.goneGoodBg, borderColor: isDark ? 'rgba(93,202,165,0.4)' : '#A8DFC9' },
  expiryChipIcon:     { fontSize: 13 },
  expiryChipName:     { fontSize: 11, fontWeight: '600', color: c.text, maxWidth: 80 },
  expiryChipDays:     { fontSize: 10, color: c.textMuted, fontWeight: '500' },

  // Input
  inputRow:           { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12, backgroundColor: c.bg, borderTopWidth: 0, gap: 10 },
  chatInput:          { flex: 1, backgroundColor: c.chatInputBg, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, color: c.text, maxHeight: 100, fontFamily: 'Fraunces_400Regular', shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 3 },
  sendBtn:            { width: 40, height: 40, borderRadius: 20, backgroundColor: c.btnPrimary, alignItems: 'center', justifyContent: 'center' },
  sendBtnText:        { color: 'white', fontSize: 18, lineHeight: 22 },

  // Save recipe
  saveBtn:            { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', backgroundColor: c.chipBg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: c.teal },
  saveBtnText:        { fontSize: 13, fontWeight: '700', color: c.chipText },
  savedBadge:         { fontSize: 12, color: c.teal, fontWeight: '600', paddingHorizontal: 4, paddingTop: 2 },
  colOption:          { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: c.border },
  colOptionText:      { fontSize: 14, fontWeight: '600', color: c.text, flex: 1 },
}); }
