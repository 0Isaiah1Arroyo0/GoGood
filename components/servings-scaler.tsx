import { Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '@/app/context/theme';
import { raised } from '@/components/raised';

// "Servings · tap to scale": pick a serving count and the recipe's ingredient
// amounts are rescaled. Shared by saved recipes and Good Bot's recipes.

/** How many servings a recipe makes (from its macros block, or the text). */
export function extractServings(content: string, macroServings?: number): number {
  if (macroServings && macroServings > 0) return macroServings;
  const m = content.match(/(?:serves?|servings?|yield)[:\s*]*(\d+)/i)
    || content.match(/(\d+)\s*(?:servings?|portions?|people)/i)
    || content.match(/makes?\s*(\d+)/i);
  return m ? Math.max(1, parseInt(m[1])) : 4;
}

/** A scaled amount as a friendly fraction ("1½", "¾", "3"). */
export function scaleValue(n: number, factor: number): string {
  const scaled = n * factor;
  if (scaled <= 0) return '0';
  const fracs: [number, string][] = [
    [0.125, '⅛'], [0.25, '¼'], [0.33, '⅓'], [0.5, '½'], [0.67, '⅔'], [0.75, '¾'],
    [1.25, '1¼'], [1.33, '1⅓'], [1.5, '1½'], [1.67, '1⅔'], [1.75, '1¾'],
    [2.5, '2½'], [3.5, '3½'],
  ];
  // The closest friendly fraction, if one is close enough
  const best = fracs.reduce((x, y) => (Math.abs(scaled - y[0]) < Math.abs(scaled - x[0]) ? y : x));
  if (Math.abs(scaled - best[0]) < 0.1) return best[1];
  const rounded = Math.round(scaled * 4) / 4;
  if (Number.isInteger(rounded)) return String(rounded);
  return scaled.toFixed(1);
}

/** Scale the amounts in a recipe's ingredient list (other sections stay as written). */
export function scaleContent(content: string, factor: number): string {
  if (Math.abs(factor - 1) < 0.05) return content;
  let inIngredients = false;
  return content.split('\n').map(line => {
    if (/ingredients?/i.test(line) && (/\*\*/.test(line) || /^#+\s/.test(line))) {
      inIngredients = true; return line;
    }
    if (/instructions?|directions?|method|steps?|tips|storage|grab|nutrition/i.test(line) && (/\*\*/.test(line) || /^#+\s/.test(line))) {
      inIngredients = false; return line;
    }
    // The "Serves: 2" detail follows the new serving count
    if (!inIngredients) {
      return line.replace(/\b(serves?|servings?)(\*\*)?(\s*[:\-–]?\s*(?:\*\*)?\s*)(\d+)\b/i,
        (_, word, bold = '', sep, n) => `${word}${bold}${sep}${Math.max(1, Math.round(Number(n) * factor))}`);
    }
    if (!/^\s*[-•*]/.test(line)) return line;
    // Scale numbers in ingredient lines; skip temperatures (followed by °)
    // Mixed numbers ("1 1/2"), decimals ("1.5"), fractions ("1/2") and whole numbers
    // Package sizes in brackets ("1 (15oz) can") stay as they are
    return line.split(/(\([^)]*\))/).map((seg, i) => i % 2 ? seg : seg.replace(
      /(?<![\d.\/])(\d+\s+\d+\/\d+|\d*\.\d+|\d+\/\d+|\d+)(?![\d.\/])(?!\s*°)/g,
      (match) => {
        const frac = (f: string) => Number(f.split('/')[0]) / Number(f.split('/')[1]);
        const parts = match.trim().split(/\s+/);
        const n = parts.length === 2 ? Number(parts[0]) + frac(parts[1])
          : match.includes('/') ? frac(match)
          : parseFloat(match);
        if (!n || isNaN(n)) return match;
        return scaleValue(n, factor);
      },
    )).join('');
  }).join('\n');
}

/** ½×, 1×, 2×, 3×, 4× of the original serving count. */
export function servingPresets(base: number): number[] {
  return [Math.round(base * 0.5), base, base * 2, base * 3, base * 4]
    .filter((v, i, arr) => v > 0 && arr.indexOf(v) === i);
}

export default function ServingsScaler({ base, target, onChange, flat = false }: {
  base: number;
  target: number;
  onChange: (servings: number) => void;
  flat?: boolean;   // no card of its own (when it sits inside another card)
}) {
  const { colors, isDark } = useTheme();
  const factor = base > 0 ? target / base : 1;
  const scaled = Math.abs(factor - 1) > 0.05;

  return (
    <View style={flat
      ? { marginBottom: 14 }
      : { marginBottom: 20, padding: 12, backgroundColor: colors.surface, borderRadius: 14, ...raised(isDark, 'md') }}>
      <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textSub, letterSpacing: 1, marginBottom: 10 }}>
        SERVINGS
        {scaled
          ? `  ·  scaled ${factor > 1 ? `${factor.toFixed(1)}×` : `${Math.round(factor * 100)}%`}`
          : '  ·  tap to scale'}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {servingPresets(base).map(s => {
          const on = target === s;
          return (
            <TouchableOpacity
              key={s}
              onPress={() => onChange(s)}
              style={{
                paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999,
                backgroundColor: on ? colors.btnPrimary : colors.surfaceAlt,
                borderWidth: 1,
                borderColor: on ? colors.btnPrimary : colors.border,
              }}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 13, fontWeight: '600', color: on ? colors.btnPrimaryText : colors.textSub }}>{s}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {scaled && (
        <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 8 }}>
          Ingredient amounts are scaled. Some rounding may apply.
        </Text>
      )}
    </View>
  );
}
