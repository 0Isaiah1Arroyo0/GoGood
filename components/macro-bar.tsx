import { Text, View } from 'react-native';
import { useTheme } from '@/app/context/theme';
import { raised } from '@/components/raised';

export interface Macros { protein: number; carbs: number; fat: number; cal: number; }

// The one macro card used everywhere a recipe shows its macros (Good Bot, Recipes,
// recipe import), so they all look the same. All values are in the app's green.
export default function MacroBar({ macros, title, note }: {
  macros: Macros;
  title?: string; // e.g. "Per serving"
  note?: string;  // shown on the right of the title, e.g. "4 servings · 1 cup"
}) {
  const { colors, isDark } = useTheme();
  const items = [
    { label: 'Protein', val: `${macros.protein || 0}g` },
    { label: 'Carbs',   val: `${macros.carbs || 0}g` },
    { label: 'Fat',     val: `${macros.fat || 0}g` },
    { label: 'Cal',     val: String(macros.cal || 0) },
  ];
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 12, ...raised(isDark, 'md') }}>
      {(title || note) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          {title ? <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textSub, letterSpacing: 1, textTransform: 'uppercase' }}>{title}</Text> : <View />}
          {note ? <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '500' }}>{note}</Text> : null}
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {items.map((m, i) => (
          <View key={m.label} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
            {i > 0 && <View style={{ width: 0.5, height: 30, backgroundColor: colors.border }} />}
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.teal }}>{m.val}</Text>
              <Text style={{ fontSize: 9, color: colors.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{m.label}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
