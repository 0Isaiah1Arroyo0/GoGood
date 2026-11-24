import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/app/context/theme';
import { raised } from '@/components/raised';

// Turns a recipe written by Good Bot (or pasted from a link) into a clean,
// structured page: title, a short intro, time/servings chips, an ingredient
// checklist, numbered steps, then tips and storage. Anything that doesn't look
// like a recipe falls back to plain text, so older saved recipes still show.

type SectionKind = 'ingredients' | 'steps' | 'tips' | 'storage' | 'grab' | 'other';
export interface ParsedRecipe {
  title: string | null;
  intro: string[];
  meta: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }[];
  sections: { kind: SectionKind; title: string; items: string[]; numbered: boolean }[];
  footnotes: string[]; // e.g. "Macro sources: ..."
}

const strip = (s: string) => s.replace(/\*\*/g, '').replace(/__/g, '').trim();
// Items keep **bold** so it can be shown; just drop stray markers at the ends
const tidy = (s: string) => s.trim().replace(/^\*\*\s*\*\*/, '');

function kindFor(title: string): SectionKind {
  const t = title.toLowerCase();
  if (/ingredient/.test(t)) return 'ingredients';
  if (/step|instruction|direction|method|how to make/.test(t)) return 'steps';
  if (/tip|swap|substitut|variation/.test(t)) return 'tips';
  if (/storage|leftover|store|reheat|make ahead/.test(t)) return 'storage';
  if (/grab|pick up|missing|shopping/.test(t)) return 'grab';
  return 'other';
}

// "**Ingredients**", "**Ingredients:**", "## Steps", "Ingredients:"
function headerOf(line: string): { title: string; rest: string } | null {
  let m = line.match(/^#{2,4}\s+(.+?)\s*$/);
  if (m) return { title: strip(m[1]).replace(/:$/, ''), rest: '' };
  m = line.match(/^\*\*([^*]{2,60}?):?\*\*:?\s*(.*)$/);
  if (m) return { title: m[1].trim().replace(/:$/, ''), rest: m[2].trim() };
  m = line.match(/^(Ingredients|Steps|Instructions|Directions|Method|Tips(?: & Swaps)?|Storage|Notes)\s*:\s*$/i);
  if (m) return { title: m[1], rest: '' };
  return null;
}

const META: { re: RegExp; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { re: /prep(?:aration)?(?: time)?\s*[:\-–]?\s*([~\d][^|·,\n]*?(?:min(?:ute)?s?|hrs?|hours?))/i, icon: 'time-outline',       label: 'Prep' },
  { re: /cook(?:ing)?(?: time)?\s*[:\-–]?\s*([~\d][^|·,\n]*?(?:min(?:ute)?s?|hrs?|hours?))/i,     icon: 'flame-outline',      label: 'Cook' },
  { re: /total(?: time)?\s*[:\-–]?\s*([~\d][^|·,\n]*?(?:min(?:ute)?s?|hrs?|hours?))/i,            icon: 'hourglass-outline',  label: 'Total' },
  { re: /(?:serves|servings?|yield)\s*[:\-–]?\s*(\d+(?:\s*[-–]\s*\d+)?)/i,                       icon: 'people-outline',     label: 'Serves' },
  { re: /difficulty\s*[:\-–]?\s*(easy|medium|moderate|hard|beginner|intermediate)/i,              icon: 'speedometer-outline', label: 'Level' },
];

function isMetaLine(line: string) {
  const hits = META.filter(m => m.re.test(line)).length;
  return hits >= 2 || (hits === 1 && strip(line).length < 40);
}

export function parseRecipe(content: string): ParsedRecipe | null {
  const lines = content.replace(/\r/g, '').split('\n');
  const out: ParsedRecipe = { title: null, intro: [], meta: [], sections: [], footnotes: [] };

  // Times, servings and difficulty from anywhere near the top
  const head = lines.slice(0, 14).join('\n');
  for (const m of META) {
    const hit = head.match(m.re);
    if (hit) out.meta.push({ icon: m.icon, label: m.label, value: strip(hit[1]).replace(/minutes?/i, 'min') });
  }

  let current: ParsedRecipe['sections'][number] | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^[-—_*]{3,}$/.test(line)) continue;

    // Title: "# Dish name"
    if (!out.title && /^#\s+/.test(line)) { out.title = strip(line.replace(/^#\s+/, '')); continue; }

    const h = headerOf(line);
    if (h) {
      if (/macro source/i.test(h.title)) { out.footnotes.push(`${h.title}: ${strip(h.rest)}`); current = null; continue; }
      if (/^details?$|^at a glance$|^overview$/i.test(h.title)) { current = null; continue; }
      // A bold first line before any section is the title
      if (!out.title && out.sections.length === 0 && kindFor(h.title) === 'other' && !h.rest && !isMetaLine(h.title)) {
        out.title = h.title; continue;
      }
      if (isMetaLine(line)) continue;
      current = { kind: kindFor(h.title), title: h.title, items: [], numbered: false };
      out.sections.push(current);
      if (h.rest) current.items.push(tidy(h.rest));
      continue;
    }

    if (isMetaLine(line)) continue;

    if (!current) { out.intro.push(tidy(line)); continue; }

    const num = line.match(/^(\d+)[.)]\s+(.*)$/);
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (num) { current.numbered = true; current.items.push(tidy(num[2])); }
    else if (bullet) current.items.push(tidy(bullet[1]));
    else if (current.kind === 'steps' && current.items.length) current.items[current.items.length - 1] += ' ' + tidy(line);
    else current.items.push(tidy(line));
  }

  // Not a recipe: let the caller show plain text
  const hasIngredients = out.sections.some(s => s.kind === 'ingredients' && s.items.length);
  const hasSteps = out.sections.some(s => (s.kind === 'steps' || s.numbered) && s.items.length);
  if (!hasIngredients || !hasSteps) return null;
  out.sections = out.sections.filter(s => s.items.length);
  return out;
}

// Inline **bold** inside an item
function Rich({ text, style, boldColor }: { text: string; style: any; boldColor: string }) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return (
    <Text style={style}>
      {parts.map((p, i) => p.startsWith('**') && p.endsWith('**')
        ? <Text key={i} style={{ fontWeight: '700', color: boldColor }}>{p.slice(2, -2)}</Text>
        : p)}
    </Text>
  );
}

/** The structured recipe. `showTitle` is off where the screen already shows the name. */
export default function RecipeView({ recipe, showTitle = true, interactive = true }: {
  recipe: ParsedRecipe;
  showTitle?: boolean;
  interactive?: boolean;
}) {
  const { colors: c, isDark } = useTheme();
  const [got, setGot]   = useState<Set<string>>(new Set()); // ingredients ticked off
  const [done, setDone] = useState<Set<number>>(new Set());  // steps finished
  const toggle = <T,>(set: Set<T>, key: T, update: (s: Set<T>) => void) => {
    if (!interactive) return;
    Haptics.selectionAsync();
    const n = new Set(set); n.has(key) ? n.delete(key) : n.add(key); update(n);
  };
  const accent = isDark ? c.tealLight : c.brand;

  return (
    <View style={{ gap: 18 }}>
      {(showTitle && recipe.title) || recipe.intro.length > 0 ? (
        <View style={{ gap: 6 }}>
          {showTitle && recipe.title ? <Text style={[s.title, { color: c.text }]}>{recipe.title}</Text> : null}
          {recipe.intro.map((p, i) => <Rich key={i} text={p} style={[s.intro, { color: c.textSub }]} boldColor={c.text} />)}
        </View>
      ) : null}

      {recipe.meta.length > 0 && (
        <View style={s.metaRow}>
          {recipe.meta.map(m => (
            <View key={m.label} style={[s.metaChip, { backgroundColor: c.surfaceAlt }]}>
              <Ionicons name={m.icon} size={14} color={accent} />
              <Text style={[s.metaLabel, { color: c.textSub }]}>{m.label}</Text>
              <Text style={[s.metaValue, { color: c.text }]}>{m.value}</Text>
            </View>
          ))}
        </View>
      )}

      {recipe.sections.map((sec, si) => {
        const isSteps = sec.kind === 'steps' || (sec.numbered && sec.kind !== 'ingredients');
        return (
          <View key={si} style={{ gap: 10 }}>
            <View style={s.secHeader}>
              <Text style={[s.secTitle, { color: c.text }]}>{sec.title}</Text>
              {sec.kind === 'ingredients' && <Text style={[s.secCount, { color: c.textMuted }]}>{sec.items.length}</Text>}
            </View>

            {sec.kind === 'ingredients' ? (
              <View style={[s.card, { backgroundColor: c.surface }, raised(isDark, 'md')]}>
                {sec.items.map((it, i) => {
                  const on = got.has(it);
                  return (
                    <TouchableOpacity
                      key={i}
                      activeOpacity={interactive ? 0.7 : 1}
                      onPress={() => toggle(got, it, setGot)}
                      style={[s.ingRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }]}
                    >
                      <View style={[s.check, { borderColor: on ? c.btnPrimary : c.borderStrong, backgroundColor: on ? c.btnPrimary : 'transparent' }]}>
                        {on && <Ionicons name="checkmark" size={13} color="white" />}
                      </View>
                      <Rich text={it} style={[s.ingText, { color: on ? c.textMuted : c.text }, on && s.struck]} boldColor={c.text} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : isSteps ? (
              <View style={{ gap: 12 }}>
                {sec.items.map((it, i) => {
                  const on = done.has(i);
                  return (
                    <TouchableOpacity key={i} activeOpacity={interactive ? 0.7 : 1} onPress={() => toggle(done, i, setDone)} style={s.stepRow}>
                      <View style={[s.stepNum, { backgroundColor: on ? c.btnPrimary : c.chipBg }]}>
                        {on
                          ? <Ionicons name="checkmark" size={14} color="white" />
                          : <Text style={[s.stepNumText, { color: c.chipText }]}>{i + 1}</Text>}
                      </View>
                      <Rich text={it} style={[s.stepText, { color: on ? c.textMuted : c.text }]} boldColor={c.text} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <View style={[s.note, { backgroundColor: sec.kind === 'grab' ? c.chipBg : c.surfaceAlt }]}>
                {sec.items.map((it, i) => (
                  <View key={i} style={s.noteRow}>
                    {sec.items.length > 1 && <View style={[s.dot, { backgroundColor: sec.kind === 'grab' ? c.chipText : c.textMuted }]} />}
                    <Rich text={it} style={[s.noteText, { color: c.textSub }]} boldColor={c.text} />
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}

      {recipe.footnotes.map((f, i) => (
        <Text key={i} style={[s.footnote, { color: c.textMuted }]}>{f}</Text>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  title:      { fontSize: 22, fontWeight: '700', fontFamily: 'Fraunces_600SemiBold', lineHeight: 28 },
  intro:      { fontSize: 14, lineHeight: 21 },
  metaRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metaChip:   { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  metaLabel:  { fontSize: 12, fontWeight: '500' },
  metaValue:  { fontSize: 12, fontWeight: '700' },
  secHeader:  { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  secTitle:   { fontSize: 17, fontWeight: '700', fontFamily: 'Fraunces_600SemiBold' },
  secCount:   { fontSize: 13, fontWeight: '600' },
  card:       { borderRadius: 16, paddingHorizontal: 14 },
  ingRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  check:      { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  ingText:    { flex: 1, fontSize: 15, lineHeight: 20 },
  struck:     { textDecorationLine: 'line-through' },
  stepRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepNum:    { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: -2 },
  stepNumText:{ fontSize: 13, fontWeight: '700' },
  stepText:   { flex: 1, fontSize: 15, lineHeight: 22 },
  note:       { borderRadius: 14, padding: 14, gap: 8 },
  noteRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dot:        { width: 5, height: 5, borderRadius: 3, marginTop: 8 },
  noteText:   { flex: 1, fontSize: 14, lineHeight: 20 },
  footnote:   { fontSize: 12, lineHeight: 17 },
});
