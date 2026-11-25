import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, TextInput, KeyboardAvoidingView,
  Platform, ActivityIndicator, Animated, Modal, Alert, LayoutAnimation,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useState, useRef, useCallback, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, type ThemeColors } from '../context/theme';
import { useAppDrawer } from '../components/AppDrawer';
import EdgeFade from '@/components/edge-fade';
import { useTabBarSpace } from '@/components/tab-bar-space';
import { useSubscription } from '../context/subscription';
import { useAuth } from '../context/auth';
import { HOUSEHOLD_KEY } from '../lib/household';
import { supabase } from '../lib/supabase';
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
import { raised, raisedGreen } from '@/components/raised';
import RecipeView, { parseRecipe } from '@/components/recipe-view';
import ServingsScaler, { extractServings, scaleContent } from '@/components/servings-scaler';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DialogHost, showAlert } from '@/components/dialog';

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

type Suggestion = { key: string; label: string; prompt: string };
type SuggestionGroup = { key: string; title: string; items: Suggestion[] };

const RECIPE_DETAIL = 'full ingredient list with exact quantities, numbered steps, prep & cook time, and per-serving nutritional info.';

// What GoodBot offers under "what sounds good?" — shown as a tappable list.
function getSuggestionGroups(hasExpiring: boolean): SuggestionGroup[] {
  return [
    {
      key: 'cook',
      title: 'Cook with what I have',
      items: [
        { key: 'rescue', label: hasExpiring ? 'Use my expiring items' : 'Best recipe right now',
          prompt: `Give me a complete recipe using my most urgent items — ${RECIPE_DETAIL}` },
        { key: 'quick',     label: 'Something quick (15 minutes)', prompt: `Give me a recipe I can make in 15 minutes or less from my inventory — ${RECIPE_DETAIL}` },
        { key: 'dinner',    label: 'Dinner tonight',               prompt: `What should I make for dinner tonight with what I have? Give me a complete recipe — ${RECIPE_DETAIL}` },
        { key: 'mealprep',  label: 'Meal prep for the week',       prompt: `Suggest a meal-prep friendly recipe I can batch cook from my inventory — ${RECIPE_DETAIL} Include portion and storage tips.` },
        { key: 'protein',   label: 'High-protein meal',            prompt: `Give me a high-protein recipe from my inventory — ${RECIPE_DETAIL}` },
        { key: 'light',     label: 'Something healthy and light',  prompt: `Give me a healthy, lighter recipe from my inventory — ${RECIPE_DETAIL}` },
        { key: 'breakfast', label: 'Breakfast idea',               prompt: `Give me a breakfast recipe from my inventory — ${RECIPE_DETAIL}` },
        { key: 'lunch',     label: 'Easy lunch',                   prompt: `Give me an easy lunch recipe from my inventory — ${RECIPE_DETAIL}` },
        { key: 'onepan',    label: 'One-pan or one-pot meal',      prompt: `Give me a one-pan or one-pot recipe from my inventory — ${RECIPE_DETAIL}` },
        { key: 'snack',     label: 'Snack',                        prompt: `Give me a simple snack I can make from my inventory — ${RECIPE_DETAIL}` },
        { key: 'dessert',   label: 'Dessert',                      prompt: `Give me a dessert I can make from my inventory — ${RECIPE_DETAIL}` },
        { key: 'kids',      label: 'Kid-friendly meal',            prompt: `Give me a kid-friendly recipe from my inventory — ${RECIPE_DETAIL}` },
      ],
    },
    {
      key: 'cuisine',
      title: 'Pick a cuisine',
      items: [
        { key: 'italian',       label: 'Italian',        prompt: `Give me a complete Italian recipe using my inventory — ${RECIPE_DETAIL}` },
        { key: 'mexican',       label: 'Mexican',        prompt: `Give me a complete Mexican recipe using my inventory — ${RECIPE_DETAIL}` },
        { key: 'asian',         label: 'Asian',          prompt: `Give me a complete Asian-inspired recipe using my inventory — ${RECIPE_DETAIL}` },
        { key: 'mediterranean', label: 'Mediterranean',  prompt: `Give me a complete Mediterranean recipe using my inventory — ${RECIPE_DETAIL}` },
        { key: 'indian',        label: 'Indian',         prompt: `Give me a complete Indian-inspired recipe using my inventory — ${RECIPE_DETAIL}` },
        { key: 'thai',          label: 'Thai',           prompt: `Give me a complete Thai-inspired recipe using my inventory — ${RECIPE_DETAIL}` },
        { key: 'american',      label: 'American classic', prompt: `Give me a classic American recipe using my inventory — ${RECIPE_DETAIL}` },
        { key: 'comfort',       label: 'Comfort food',   prompt: `Give me a hearty, satisfying comfort food recipe using my inventory — ${RECIPE_DETAIL}` },
      ],
    },
    {
      key: 'ask',
      title: 'Questions to ask',
      items: [
        { key: 'q-first',    label: 'What should I use up first?',              prompt: 'What should I use up first, and why?' },
        { key: 'q-freeze',   label: 'What can I freeze before it goes bad?',    prompt: 'Which of my items can I freeze before they go bad, and how should I freeze each one?' },
        { key: 'q-plan',     label: 'Plan my meals for the next 3 days',        prompt: 'Plan my meals for the next 3 days using what I have, prioritizing items that expire soonest.' },
        { key: 'q-last',     label: 'How do I make my produce last longer?',    prompt: 'How can I store the produce I have so it lasts as long as possible?' },
        { key: 'q-list',     label: 'Build a shopping list for this week',      prompt: "Build me a shopping list for this week's meals that works with what I already have." },
        { key: 'q-bad',      label: 'How do I tell if food has gone bad?',      prompt: 'How can I tell if the items I have have gone bad? Give quick signs for each type.' },
        { key: 'q-balanced', label: 'Is my kitchen stocked for balanced meals?', prompt: "Look at my inventory — am I stocked for balanced meals? What's missing?" },
        { key: 'q-leftover', label: 'How long do leftovers last?',              prompt: 'How long do cooked leftovers last in the fridge and freezer, and how should I store them?' },
      ],
    },
  ];
}

const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL      ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Fair-use allowance per day (the server enforces these; keep them in sync with
// supabase/functions/goodbot). Resets at midnight in the user's time zone.
const FREE_DAILY = 3;
const PRO_DAILY  = 40;
const TIME_ZONE = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
})();

class BotError extends Error {
  constructor(public type: string) { super(type); }
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function GoodBotScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace(); // room for the floating bottom bar
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const { menuBtn, drawerEl } = useAppDrawer();
  const { isPremium, showPaywall } = useSubscription();
  const { user } = useAuth();
  const [messages, setMessages]         = useState<ChatMessage[]>([]);
  const [input, setInput]               = useState('');
  const [loading, setLoading]           = useState(false);
  const [expiring, setExpiring]         = useState<(StoredItem & { days: number })[]>([]);
  const [suggestionChosen, setSuggestionChosen] = useState(false);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);
  const usedToday  = usage?.used ?? 0;
  const leftToday  = Math.max((isPremium ? (usage?.limit || PRO_DAILY) : FREE_DAILY) - usedToday, 0);
  const canAsk     = leftToday > 0;

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

  // Serving count picked on each recipe message (message id → servings)
  const [servingsFor, setServingsFor] = useState<Record<string, number>>({});
  const baseServingsOf = (msg: ChatMessage) => extractServings(msg.content, msg.recipeMacros?.servings);
  const servingsOf     = (msg: ChatMessage) => servingsFor[msg.id] ?? baseServingsOf(msg);
  const scaledContentOf = (msg: ChatMessage) => scaleContent(msg.content, servingsOf(msg) / baseServingsOf(msg));

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

    // How many questions are left today
    supabase.rpc('goodbot_used_today', { p_tz: TIME_ZONE })
      .then(({ data, error }) => { if (!error && typeof data === 'number') setUsage(u => ({ used: data, limit: u?.limit ?? 0 })); });

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
    const hi    = first ? `Hey ${first}!` : 'Hey!';

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
        ? `${todayItems.map(i => `**${i.baseName}**`).join(', ')} expire${todayItems.length === 1 ? 's' : ''} today! `
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

  // What Good Bot knows about the user. The server turns this into the prompt.
  const buildContext = () => ({
    name: nameRef.current,
    household: householdRef.current,
    dietary: dietaryRef.current,
    items: allItemsRef.current.map(i => ({
      name: i.baseName, qty: i.qty, qtyNum: i.qtyNum, days: i.days,
      location: i.category === 'freezer' ? 'freezer' : i.category === 'pantry' ? 'pantry' : 'fridge',
      protein: i.protein, carbs: i.carbs, fat: i.fat, cal: i.cal,
    })),
  });

  const callClaude = async (userMsg: string): Promise<string> => {
    if (!SUPABASE_URL || SUPABASE_URL === 'your_supabase_project_url') {
      return "Good Bot isn't connected yet — add your Supabase URL and anon key to .env";
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new BotError('auth_required');
    const res = await fetch(`${SUPABASE_URL}/functions/v1/goodbot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        context: buildContext(),
        messages: [...convoRef.current, { role: 'user', content: userMsg }],
        householdId: householdIdRef.current,
        tz: TIME_ZONE,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.usage) setUsage({ used: data.usage.used, limit: data.usage.limit });
    if (data.error) {
      if (data.error.type === 'authentication_error') {
        return "Good Bot's API key needs to be updated — please contact support";
      }
      throw new BotError(data.error.type || 'server_error');
    }
    if (!res.ok) throw new BotError('server_error');
    if (!data.content?.[0]?.text) throw new BotError('empty');
    return data.content[0].text;
  };

  // ── Send message ─────────────────────────────────────────────────────────────

  // Out of questions for today: free users see the paywall, Pro users a note
  const explainLimit = () => {
    if (!isPremium) showPaywall();
    else showAlert("Good Bot's resting", `You've asked ${PRO_DAILY} questions today. Good Bot will be back at midnight.`);
  };

  const send = async (text: string) => {
    if (!canAsk) { explainLimit(); return; }
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
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // The question didn't get an answer, so drop it from the conversation
      convoRef.current.pop();
      const type = e instanceof BotError ? e.type : 'network';
      const content =
        type === 'daily_limit' && !isPremium ? `That's your ${FREE_DAILY} free questions for today. Upgrade to Go Good Pro to keep cooking with Good Bot.`
        : type === 'daily_limit'     ? "That's all for today. Good Bot is resting and will be back at midnight with fresh ideas."
        : type === 'rate_limited'    ? "That's a lot of questions at once. Give me a minute to catch up, then ask again."
        : type === 'auth_required'   ? 'Please sign in again to keep chatting with Good Bot.'
        : type === 'update_required' ? 'Please update Go Good to keep chatting with Good Bot.'
        : 'Something went wrong. Check your connection and try again.';
      if (type === 'daily_limit' && !isPremium) showPaywall();
      const errMsg: ChatMessage = { id: String(Date.now() + 1), role: 'assistant', content, time: ftime(new Date()) };
      setMessages(prev => [...prev, errMsg]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }

    setLoading(false);
  };

  // Which suggestion group is open (null = showing the three choices)
  const [suggestGroup, setSuggestGroup] = useState<string | null>(null);

  const chooseSuggestion = (prompt: string) => {
    if (!canAsk) { explainLimit(); return; }
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
    showAlert('Added to shopping list', `${missing.length} missing ingredient${missing.length !== 1 ? 's' : ''} added to your list.`);
  };

  // ── Derived ──────────────────────────────────────────────────────────────────


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
                <Text style={styles.headerSub}>always here to help</Text>
              </View>
              <View style={{ width: 36 }} />
            </View>
          </Animated.View>

          <Animated.View style={{ flex: 1, opacity: chatOpacity, transform: [{ translateY: chatSlide }] }}>
          <>
              {/* ── Chat ── */}
              <View style={styles.chat}>
              <ScrollView
                ref={scrollRef}
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 30, paddingBottom: 30, gap: 16 }}
              >
                {messages.map(msg => {
                  const { op, y } = getMsgAnim(msg.id);
                  return (
                  <Animated.View key={msg.id} style={{ opacity: op, transform: [{ translateY: y }] }} onLayout={e => msgLayouts.current.set(msg.id, e.nativeEvent.layout.y)}>
                    {msg.role === 'assistant' ? (
                      <View style={styles.botRow}>
                        <View style={styles.botAvatar}>
                          <Ionicons name="sparkles" size={13} color="white" />
                          <View style={styles.botAvatarDot} />
                        </View>
                      <View style={[styles.botMsgWrap, { flex: 1 }]}>
                        {(() => {
                          const recipe = parseRecipe(scaledContentOf(msg));
                          return recipe ? (
                            <View style={[styles.botBubble, { padding: 16 }]}>
                              <ServingsScaler
                                flat
                                base={baseServingsOf(msg)}
                                target={servingsOf(msg)}
                                onChange={n => { Haptics.selectionAsync(); setServingsFor(prev => ({ ...prev, [msg.id]: n })); }}
                              />
                              <RecipeView key={servingsOf(msg)} recipe={recipe} />
                            </View>
                          ) : (
                            <View style={styles.botBubble}>
                              <Markdown
                                text={msg.content}
                                style={styles.botText}
                                boldStyle={styles.botTextBold}
                              />
                            </View>
                          );
                        })()}
                        <Text style={styles.msgTime}>{msg.time}</Text>

                        {msg.recipeMacros && (
                          <View style={styles.macroCard}>
                            <View style={styles.macroCardHeader}>
                              <Text style={styles.macroCardTitle}>MACROS PER SERVING</Text>
                              {(msg.recipeMacros.servings || msg.recipeMacros.servingSize) && (
                                <Text style={styles.macroCardServing}>
                                  {msg.recipeMacros.servings ? `${servingsOf(msg)} serving${servingsOf(msg) !== 1 ? 's' : ''}` : ''}
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
                              <Text style={styles.saveBtnText}>Cook This</Text>
                            </TouchableOpacity>
                            {savedMsgIds.has(msg.id)
                              ? <Text style={styles.savedBadge}>Saved to Recipes</Text>
                              : <TouchableOpacity style={styles.saveBtn} onPress={() => { setSaveSheetMsg(msg); setCreatingCol(false); setNewColName(''); }}>
                                  <Text style={styles.saveBtnText}>Save to Recipes</Text>
                                </TouchableOpacity>
                            }
                          </View>
                        )}

                        {(() => {
                          const missing = parseMissingIngredients(msg.content);
                          if (!missing.length) return null;
                          return shoppingAddedIds.has(msg.id)
                            ? <Text style={styles.savedBadge}>Added {missing.length} item{missing.length !== 1 ? 's' : ''} to shopping list</Text>
                            : (
                              <TouchableOpacity
                                style={[styles.saveBtn, { borderColor: '#F5A623', backgroundColor: '#FFF8E620' }]}
                                onPress={() => addMissingToList(msg)}
                              >
                                <Text style={styles.saveBtnText}>Add {missing.length} missing item{missing.length !== 1 ? 's' : ''} to list</Text>
                              </TouchableOpacity>
                            );
                        })()}

                        {msg.showSuggestions && !suggestionChosen && (
                          <View style={styles.suggestCard}>
                            <Text style={styles.suggestLabel}>what sounds good?</Text>
                            {(() => {
                              const groups = getSuggestionGroups(!!(msg.welcomeChips?.length));
                              const picked = groups.find(g => g.key === suggestGroup);
                              const switchGroup = (key: string | null) => {
                                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                                setSuggestGroup(key);
                              };

                              // Step 1: three choices
                              if (!picked) {
                                return (
                                  <View style={styles.suggestGroup}>
                                    {groups.map(g => (
                                      <TouchableOpacity
                                        key={g.key}
                                        style={styles.suggestChoice}
                                        onPress={() => { Haptics.selectionAsync(); switchGroup(g.key); }}
                                        activeOpacity={0.75}
                                      >
                                        <Text style={styles.suggestChoiceText}>{g.title}</Text>
                                        <Text style={styles.suggestChoiceCount}>{g.items.length}</Text>
                                      </TouchableOpacity>
                                    ))}
                                  </View>
                                );
                              }

                              // Step 2: that group's full list
                              return (
                                <View style={styles.suggestGroup}>
                                  <Text style={styles.suggestGroupTitle}>{picked.title}</Text>
                                  {picked.items.map(sug => (
                                    <TouchableOpacity
                                      key={sug.key}
                                      style={styles.suggestRow}
                                      onPress={() => chooseSuggestion(sug.prompt)}
                                      activeOpacity={0.6}
                                    >
                                      <Text style={styles.suggestRowText}>{sug.label}</Text>
                                    </TouchableOpacity>
                                  ))}
                                  <TouchableOpacity style={styles.suggestMore} onPress={() => switchGroup(null)}>
                                    <Text style={styles.suggestMoreText}>Back to choices</Text>
                                  </TouchableOpacity>
                                </View>
                              );
                            })()}
                            <Text style={styles.orType}>or type your own question below</Text>
                          </View>
                        )}
                      </View>
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
                  <View style={styles.botRow}>
                    <View style={styles.botAvatar}>
                          <Ionicons name="sparkles" size={13} color="white" />
                          <View style={styles.botAvatarDot} />
                        </View>
                    <View style={[styles.botMsgWrap, { flex: 1 }]}>
                      <View style={[styles.botBubble, { paddingVertical: 14, alignSelf: 'flex-start' }]}>
                        <ActivityIndicator size="small" color={colors.teal} />
                      </View>
                    </View>
                  </View>
                )}
              </ScrollView>
              {/* Messages dissolve under the header and above the message box */}
              <EdgeFade color={colors.bg} edge="top" height={36} />
              <EdgeFade color={colors.bg} edge="bottom" height={36} />
              </View>

              {/* ── Input ── */}
              {usage && (leftToday <= 5 || !isPremium) && (
                <Text style={styles.usageNote}>
                  {leftToday === 0
                    ? (isPremium ? 'Good Bot is resting until midnight' : 'No free questions left today')
                    : `${leftToday} ${isPremium ? 'question' : 'free question'}${leftToday === 1 ? '' : 's'} left today`}
                </Text>
              )}
              <View style={[styles.inputRow, { paddingBottom: tabSpace + 22 }]}>
                <View style={{ flex: 1 }}>
                  <TextInput
                    style={styles.chatInput}
                    placeholder={canAsk ? 'ask Good Bot anything...' : isPremium ? 'Good Bot is back at midnight' : 'Upgrade to keep chatting'}
                    placeholderTextColor={colors.textMuted}
                    value={input}
                    onChangeText={setInput}
                    multiline
                    blurOnSubmit
                    returnKeyType="send"
                    onSubmitEditing={() => send(input)}
                    editable={canAsk}
                    maxLength={1000}
                  />
                  {!canAsk && (
                    <TouchableOpacity
                      style={{ ...StyleSheet.absoluteFillObject }}
                      onPress={explainLimit}
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
                <Text style={styles.colOptionText}>No Collection</Text>
              </TouchableOpacity>

              {/* Existing collections */}
              {collections.map(col => (
                <TouchableOpacity key={col.id} style={styles.colOption} onPress={() => confirmSave(col.id)}>
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
                  <Text style={[styles.colOptionText, { color: colors.teal }]}>+ New Collection</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
        <DialogHost />
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
          setSaveDishServings(String(msg ? servingsOf(msg) : (macros?.servings ?? 2)));
          // Wait for PortionDeductionSheet dismiss animation (~260ms) before showing next modal
          setTimeout(() => setSaveDishMsg(msg), 320);
        }}
        recipeContent={cookSheetMsg ? scaledContentOf(cookSheetMsg) : ''}
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
              Save leftovers to fridge
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
                showAlert('Saved to fridge', `${servings} serving${servings !== 1 ? 's' : ''} of "${saveDishName.trim()}" added to your inventory. Deduct portions from the Home tab as you eat.`);
              }}
            >
              <Text style={{ color: colors.btnPrimaryText, fontWeight: '700', fontSize: 15 }}>
                Save {parseInt(saveDishServings) > 1 ? `${parseInt(saveDishServings) || 2} servings` : 'to'} fridge
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ alignItems: 'center', paddingVertical: 10 }}
              onPress={() => {
                setSaveDishMsg(null);
                showAlert('Enjoy your meal!', 'Inventory updated from recipe.');
              }}
            >
              <Text style={{ color: colors.textMuted, fontSize: 13 }}>Skip — I'll eat it all now</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
        <DialogHost />
      </Modal>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function createStyles(c: ThemeColors, isDark = false) { return StyleSheet.create({
  safe:               { flex: 1, backgroundColor: c.bg },
  container:          { flex: 1, backgroundColor: c.bg },

  // Header
  header:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, backgroundColor: c.bg },
  headerTitle:        { fontSize: 28, fontWeight: '700', color: c.brand, fontFamily: 'Fraunces_600SemiBold' },
  headerTitleGreen:   { color: c.teal, fontFamily: 'Fraunces_600SemiBold' },
  headerSub:          { fontSize: 12, color: c.teal, marginTop: 2 },
  // Alert

  // Chat
  chat:               { flex: 1 },
  botMsgWrap:         { gap: 6 },
  botRow:             { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  botAvatar:          { width: 26, height: 26, borderRadius: 13, marginTop: 2, backgroundColor: c.btnPrimary, alignItems: 'center', justifyContent: 'center' },
  botAvatarDot:       { position: 'absolute', bottom: -1, right: -1, width: 9, height: 9, borderRadius: 5, backgroundColor: c.teal, borderWidth: 2, borderColor: c.onlineDotBorder },
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

  orType:             { fontSize: 12, color: c.textMuted, textAlign: 'center', paddingBottom: 16, paddingTop: 8 },

  // Welcome + suggestion card
  suggestCard:        { marginLeft: -32, backgroundColor: c.surface, borderRadius: 16, borderTopLeftRadius: 4, borderWidth: 0.5, borderColor: c.border, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 6, overflow: 'hidden' },
  suggestLabel:       { fontSize: 10, fontWeight: '700', color: c.textSub, textTransform: 'uppercase', letterSpacing: 1.1, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 },
  suggestGroup:       { paddingHorizontal: 14, paddingBottom: 6 },
  suggestGroupTitle:  { fontSize: 16, fontWeight: '700', color: c.brand, fontFamily: 'Fraunces_600SemiBold', marginTop: 14, marginBottom: 4 },
  suggestRow:         { paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: c.border },
  suggestRowText:     { fontSize: 14, color: c.text, fontFamily: 'Fraunces_600SemiBold' },
  suggestChoice:      { flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg, ...raised(isDark) },
  suggestChoiceText:  { flex: 1, fontSize: 15, fontWeight: '700', color: c.brand, fontFamily: 'Fraunces_600SemiBold' },
  suggestChoiceCount: { fontSize: 12, fontWeight: '600', color: c.textMuted },
  suggestMore:        { alignSelf: 'flex-start', marginTop: 10, marginBottom: 4, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg, ...raised(isDark) },
  suggestMoreText:    { fontSize: 12, fontWeight: '600', color: c.textSub },

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
  usageNote:          { fontSize: 12, fontWeight: '500', color: c.textMuted, textAlign: 'center', marginBottom: 2 },
  inputRow:           { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, paddingTop: 6, paddingBottom: 36, backgroundColor: c.bg, borderTopWidth: 0, gap: 10 },
  chatInput:          { flex: 1, backgroundColor: c.chatInputBg, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, color: c.text, maxHeight: 100, fontFamily: 'Fraunces_400Regular', shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 3 },
  sendBtn:            { width: 40, height: 40, borderRadius: 20, backgroundColor: c.btnPrimary, alignItems: 'center', justifyContent: 'center', ...raisedGreen(isDark, 'sm') },
  sendBtnText:        { color: 'white', fontSize: 18, lineHeight: 22 },

  // Save recipe
  saveBtn:            { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', backgroundColor: c.chipBg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: c.teal },
  saveBtnText:        { fontSize: 13, fontWeight: '700', color: c.chipText },
  savedBadge:         { fontSize: 12, color: c.teal, fontWeight: '600', paddingHorizontal: 4, paddingTop: 2 },
  colOption:          { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: c.border },
  colOptionText:      { fontSize: 14, fontWeight: '600', color: c.text, flex: 1 },
}); }
