import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  TouchableOpacity, TextInput, KeyboardAvoidingView,
  Platform, ActivityIndicator, Animated,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useState, useRef, useCallback, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, type ThemeColors } from '../context/theme';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  time: string;
  showFormatPicker?: boolean;
}

interface StoredItem {
  id: number;
  baseName: string;
  expiryDate: string;
  category: string;
  icon?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDays(d: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(d).getTime() - today.getTime()) / 86400000);
}

function ftime(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

const FORMATS = [
  { key: 'structured', icon: '📋', label: 'Structured',    sub: '— ingredients & steps' },
  { key: 'creator',    icon: '🎬', label: 'Creator style', sub: '— like a TikTok recipe' },
  { key: 'quick',      icon: '💬', label: 'Quick tip',     sub: '— just tell me what to do' },
];

const FORMAT_PROMPTS: Record<string, string> = {
  structured: 'Give me a structured recipe using my expiring items — include an ingredients list and numbered steps.',
  creator:    'Give me a fun TikTok-style recipe using my expiring items — energetic, emoji-filled, short punchy steps.',
  quick:      'Give me a super quick 2–3 sentence tip on what to make with my expiring items. Keep it simple.',
};

const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL      ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function GoodBotScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [messages, setMessages]         = useState<ChatMessage[]>([]);
  const [input, setInput]               = useState('');
  const [loading, setLoading]           = useState(false);
  const [expiring, setExpiring]         = useState<(StoredItem & { days: number })[]>([]);
  const [formatChosen, setFormatChosen] = useState(false);

  const scrollRef   = useRef<ScrollView>(null);
  const convoRef    = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const expiringRef = useRef<(StoredItem & { days: number })[]>([]);
  const nameRef     = useRef('');
  const initialized = useRef(false);

  // Animations
  const screenFade  = useRef(new Animated.Value(0)).current;
  const screenSlide = useRef(new Animated.Value(24)).current;
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
    Animated.parallel([
      Animated.timing(screenFade,  { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.spring(screenSlide, { toValue: 0, damping: 24, stiffness: 200, useNativeDriver: true }),
    ]).start();

    (async () => {
      const [itemsVal, profileVal] = await Promise.all([
        AsyncStorage.getItem('gogood_items'),
        AsyncStorage.getItem('gogood_profile'),
      ]);

      const allItems: StoredItem[] = itemsVal ? JSON.parse(itemsVal) : [];
      const soon = allItems
        .map(i => ({ ...i, days: getDays(i.expiryDate) }))
        .filter(i => i.days <= 3)
        .sort((a, b) => a.days - b.days);

      const name = profileVal ? (JSON.parse(profileVal).name || '') : '';

      setExpiring(soon);
      expiringRef.current = soon;
      nameRef.current = name;

      if (!initialized.current) {
        initialized.current = true;
        initChat(soon, name);
      }
    })();
  }, []));

  // ── Chat init ────────────────────────────────────────────────────────────────

  const initChat = (soon: (StoredItem & { days: number })[], name: string) => {
    const first = name ? name.split(' ')[0] : '';
    const hi    = first ? `Hey ${first}! 👋` : 'Hey! 👋';

    let content: string;
    let showFormatPicker = false;

    if (soon.length === 0) {
      content = `${hi} Everything looks fresh — nothing urgent right now. Want me to suggest something to make with what you have?`;
    } else {
      const names = soon.slice(0, 3).map(i => i.baseName).join(', ');
      const extra  = soon.length > 3 ? ` and ${soon.length - 3} more` : '';
      content = `${hi} I can see you've got **${names}**${extra} expiring soon. Let's rescue them before they go bad. How do you want your recipe?`;
      showFormatPicker = true;
    }

    const msg: ChatMessage = { id: '0', role: 'assistant', content, time: ftime(new Date()), showFormatPicker };
    setMessages([msg]);
    convoRef.current = [{ role: 'assistant', content }];
  };

  // ── Claude API ───────────────────────────────────────────────────────────────

  const systemPrompt = () => {
    const list = expiringRef.current
      .map(i => `${i.baseName} (${i.days < 0 ? 'expired' : i.days === 0 ? 'expires today' : `${i.days}d left`})`)
      .join(', ');
    return `You are Good Bot, a warm and practical kitchen AI inside the Go Good food-waste app. Help users cook with their expiring food creatively. Be friendly, concise, and encouraging. Keep responses under 220 words unless asked for more.

User's name: ${nameRef.current || 'there'}
Expiring items: ${list || 'none urgent'}`;
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
      }),
    });
    const data = await res.json();
    if (!data.content?.[0]?.text) throw new Error('empty');
    return data.content[0].text;
  };

  // ── Send message ─────────────────────────────────────────────────────────────

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || loading) return;
    setInput('');
    setLoading(true);

    const userMsg: ChatMessage = { id: String(Date.now()), role: 'user', content: t, time: ftime(new Date()) };
    setMessages(prev => [...prev, userMsg]);
    convoRef.current.push({ role: 'user', content: t });
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);

    try {
      const reply = await callClaude(t);
      const botMsg: ChatMessage = { id: String(Date.now() + 1), role: 'assistant', content: reply, time: ftime(new Date()) };
      setMessages(prev => [...prev, botMsg]);
      convoRef.current.push({ role: 'assistant', content: reply });
    } catch {
      const errMsg: ChatMessage = { id: String(Date.now() + 1), role: 'assistant', content: 'Something went wrong — check your connection and try again.', time: ftime(new Date()) };
      setMessages(prev => [...prev, errMsg]);
    }

    setLoading(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  };

  const chooseFormat = (key: string) => {
    setFormatChosen(true);
    send(FORMAT_PROMPTS[key]);
  };

  // ── Derived ──────────────────────────────────────────────────────────────────

  const urgentNames = expiring.slice(0, 3).map(i => i.baseName).join(' · ');
  const todayCount  = expiring.filter(i => i.days <= 0).length;

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={colors.statusBar} backgroundColor={colors.bg} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Animated.View style={[styles.container, { opacity: screenFade, transform: [{ translateY: screenSlide }] }]}>

          {/* ── Header ── */}
          <View style={styles.header}>
            <View style={{ width: 46 }} />
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
                  <Animated.View key={msg.id} style={{ opacity: op, transform: [{ translateY: y }] }}>
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

                        {msg.showFormatPicker && !formatChosen && (
                          <View style={styles.formatCard}>
                            <Text style={styles.formatLabel}>choose a format</Text>
                            {FORMATS.map(f => (
                              <TouchableOpacity key={f.key} style={styles.formatRow} onPress={() => chooseFormat(f.key)}>
                                <Text style={styles.formatIcon}>{f.icon}</Text>
                                <Text style={styles.formatName}>{f.label}</Text>
                                <Text style={styles.formatDesc}>{f.sub}</Text>
                              </TouchableOpacity>
                            ))}
                            <View style={styles.formatFooter}>
                              <View style={styles.formatAvatarCircle}>
                                <Text style={{ fontSize: 12 }}>🤖</Text>
                              </View>
                            </View>
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
                      <ActivityIndicator size="small" color="#1D9E75" />
                    </View>
                  </View>
                )}
              </ScrollView>

              {/* ── Input ── */}
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.chatInput}
                  placeholder="ask Good Bot anything..."
                  placeholderTextColor={colors.textMuted}
                  value={input}
                  onChangeText={setInput}
                  multiline
                  blurOnSubmit
                  returnKeyType="send"
                  onSubmitEditing={() => send(input)}
                />
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function createStyles(c: ThemeColors) { return StyleSheet.create({
  safe:               { flex: 1, backgroundColor: c.bg },
  container:          { flex: 1, backgroundColor: c.bg },

  // Header
  header:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14, backgroundColor: c.bg, borderBottomWidth: 0.5, borderBottomColor: c.border },
  avatarWrap:         { position: 'relative', width: 46, height: 46 },
  avatarCircle:       { width: 46, height: 46, borderRadius: 23, backgroundColor: '#085041', alignItems: 'center', justifyContent: 'center' },
  onlineDot:          { position: 'absolute', bottom: 1, right: 1, width: 11, height: 11, borderRadius: 6, backgroundColor: '#1D9E75', borderWidth: 2, borderColor: c.onlineDotBorder },
  headerTitle:        { fontSize: 28, fontWeight: '700', color: c.brand, fontFamily: 'Fraunces_600SemiBold' },
  headerTitleGreen:   { color: c.teal, fontFamily: 'Fraunces_600SemiBold' },
  headerSub:          { fontSize: 12, color: c.teal, marginTop: 2 },
  // Alert
  alertCard:          { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF8E6', borderBottomWidth: 0.5, borderBottomColor: '#F5C842', paddingHorizontal: 16, paddingVertical: 10, gap: 10, marginTop: 8 },
  alertLeft:          { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  alertTitle:         { fontSize: 12, fontWeight: '600', color: '#8A5C00' },
  alertSub:           { fontSize: 11, color: '#6B6860', marginTop: 2 },
  rescueBtn:          { backgroundColor: 'rgba(245,200,66,0.25)', borderWidth: 1, borderColor: '#F5C842', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
  rescueBtnText:      { fontSize: 11, fontWeight: '600', color: '#8A5C00' },

  // Chat
  chat:               { flex: 1 },
  botMsgWrap:         { gap: 6 },
  botBubble:          { backgroundColor: c.surface, borderRadius: 16, borderTopLeftRadius: 4, padding: 14, borderWidth: 0.5, borderColor: c.border, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  botText:            { fontSize: 14, color: c.text, lineHeight: 21, fontFamily: 'Fraunces_400Regular' },
  botTextBold:        { fontWeight: '700', color: c.text, fontFamily: 'Fraunces_600SemiBold' },
  msgTime:            { fontSize: 10, color: c.textMuted, paddingHorizontal: 4 },
  userMsgWrap:        { alignItems: 'flex-end', gap: 4 },
  userBubble:         { backgroundColor: '#085041', borderRadius: 16, borderBottomRightRadius: 4, padding: 12, maxWidth: '80%' },
  userText:           { fontSize: 14, color: 'white', lineHeight: 20 },

  // Format picker
  formatCard:         { backgroundColor: c.surface, borderRadius: 16, borderTopLeftRadius: 4, borderWidth: 0.5, borderColor: c.border, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  formatLabel:        { fontSize: 10, fontWeight: '600', color: c.textSub, textTransform: 'uppercase', letterSpacing: 1, padding: 14, paddingBottom: 8 },
  formatRow:          { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#E8F5F0', marginHorizontal: 10, marginBottom: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  formatIcon:         { fontSize: 20, width: 26 },
  formatName:         { fontSize: 13, fontWeight: '700', color: '#085041', flex: 1, fontFamily: 'Fraunces_600SemiBold' },
  formatDesc:         { fontSize: 12, color: '#6B6860' },
  formatFooter:       { padding: 10, paddingTop: 4 },
  formatAvatarCircle: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#085041', alignItems: 'center', justifyContent: 'center' },

  // Input
  inputRow:           { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: c.bg, borderTopWidth: 0.5, borderTopColor: c.border, gap: 10 },
  chatInput:          { flex: 1, backgroundColor: c.chatInputBg, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, color: c.text, maxHeight: 100, fontFamily: 'Fraunces_400Regular' },
  sendBtn:            { width: 40, height: 40, borderRadius: 20, backgroundColor: '#085041', alignItems: 'center', justifyContent: 'center' },
  sendBtnText:        { color: 'white', fontSize: 18, lineHeight: 22 },
}); }
