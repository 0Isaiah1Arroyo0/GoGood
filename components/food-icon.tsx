import { View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '@/app/context/theme';

// Food items and recipe collections store an emoji (from the scanner, Good Bot or
// the old icon picker). This draws a matching line icon instead, so the app
// shows one consistent icon style. Unknown emojis fall back to a plate.

type Glyph = keyof typeof MaterialCommunityIcons.glyphMap;

const GROUPS: [Glyph, string][] = [
  ['food-steak',              '🥩🥓🍖'],
  ['food-drumstick-outline',  '🍗🦃'],
  ['fish',                    '🐟🍣🐙🦑🦪🐚🦀🦞🍤🦐'],
  ['egg-outline',             '🥚🍳'],
  ['cheese',                  '🧀🧈'],
  ['cup-outline',             '🥛🧃🥤🧋'],
  ['coffee-outline',          '☕'],
  ['tea-outline',             '🍵'],
  ['glass-wine',              '🍷🥂🍸'],
  ['beer-outline',            '🍺🍻'],
  ['carrot',                  '🥕🍠🥔'],
  ['leaf',                    '🥬🥦🥒🌿🌱🫛🫑🥗🍃'],
  ['food-apple-outline',      '🍎🍏🍑🍅🍆'],
  ['fruit-pear',              '🍐'],
  ['fruit-cherries',          '🍒🍓🫐'],
  ['fruit-grapes-outline',    '🍇'],
  ['fruit-citrus',            '🍊🍋🥝🥭🍌'],
  ['fruit-pineapple',         '🍍'],
  ['fruit-watermelon',        '🍉🍈'],
  ['corn',                    '🌽'],
  ['chili-mild-outline',      '🌶️🌶'],
  ['mushroom-outline',        '🍄'],
  ['seed-outline',            '🧄🧅🫘🌰🥜'],
  ['bread-slice-outline',     '🍞🥪🥯🫓🥞🧇'],
  ['baguette',                '🥖🥨'],
  ['food-croissant',          '🥐'],
  ['muffin',                  '🧁🥧🍰🎂'],
  ['pizza',                   '🍕'],
  ['taco',                    '🌮🌯🥙'],
  ['food-hot-dog',            '🌭'],
  ['hamburger',               '🍔'],
  ['noodles',                 '🍜🍝'],
  ['rice',                    '🍚🍛🍘🍙🍱🥟'],
  ['pot-steam-outline',       '🥘🍲🫕🥫'],
  ['bowl-mix-outline',        '🥣'],
  ['ice-cream',               '🍦🍨🍧🧊'],
  ['cookie-outline',          '🍪🍫'],
  ['candy-outline',           '🍬🍭🍯'],
  ['shaker-outline',          '🧂'],
  ['bottle-tonic-outline',    '🫒🫙'],
  ['grain',                   '🌾'],
  ['popcorn',                 '🍿'],
  ['silverware-fork-knife',   '🍽️🍽'],
];

const MAP = new Map<string, Glyph>();
for (const [glyph, emojis] of GROUPS) {
  for (const e of Array.from(emojis)) if (e !== '️') MAP.set(e, glyph);
}

/** The line icon for a stored emoji (variation selectors ignored). */
export function glyphFor(emoji?: string | null): Glyph {
  if (!emoji) return 'silverware-fork-knife';
  const plain = emoji.replace(/️/g, '');
  return MAP.get(plain) ?? MAP.get(Array.from(plain)[0] ?? '') ?? 'silverware-fork-knife';
}

/** A food line icon in a soft green circle. Pass the item's stored emoji. */
export default function FoodIcon({ emoji, size = 36, bare = false, color }: {
  emoji?: string | null;
  size?: number;
  bare?: boolean;   // icon only, no circle
  color?: string;
}) {
  const { colors: c } = useTheme();
  const icon = <MaterialCommunityIcons name={glyphFor(emoji)} size={Math.round(size * (bare ? 1 : 0.5))} color={color ?? c.chipText} />;
  if (bare) return icon;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.chipBg, alignItems: 'center', justifyContent: 'center' }}>
      {icon}
    </View>
  );
}
