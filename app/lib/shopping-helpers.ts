// Helpers for the shopping list: reading quick-typed entries like "2 lbs chicken",
// and sorting items into store sections so the list follows a walk through the store.

export const UNIT_CHOICES = ['count', 'lbs', 'oz', 'cans', 'bottles', 'bags', 'boxes', 'cartons', 'packs', 'jars', 'bunches', 'dozen', 'gal'];

const UNIT_WORDS: Record<string, string> = {
  lb: 'lbs', lbs: 'lbs', pound: 'lbs', pounds: 'lbs',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  g: 'g', gram: 'g', grams: 'g', kg: 'kg',
  ml: 'ml', l: 'L', liter: 'L', liters: 'L', litre: 'L', litres: 'L',
  gal: 'gal', gallon: 'gal', gallons: 'gal', qt: 'qt', quart: 'qt', quarts: 'qt', pt: 'pt', pint: 'pt', pints: 'pt',
  cup: 'cups', cups: 'cups',
  can: 'cans', cans: 'cans', bottle: 'bottles', bottles: 'bottles', bag: 'bags', bags: 'bags',
  box: 'boxes', boxes: 'boxes', carton: 'cartons', cartons: 'cartons', pack: 'packs', packs: 'packs',
  jar: 'jars', jars: 'jars', bunch: 'bunches', bunches: 'bunches', dozen: 'dozen',
  loaf: 'loaves', loaves: 'loaves', ct: 'count', count: 'count',
};

/** "2 lbs chicken" → { name: 'chicken', quantity: '2', unit: 'lbs' }; "eggs x2" → qty 2. */
export function parseQuickAdd(text: string): { name: string; quantity?: string; unit?: string } {
  const t = text.trim().replace(/\s+/g, ' ');
  // "2 lbs chicken", "1.5 lb ground beef", "3 apples", "1/2 gal milk"
  let m = t.match(/^(\d+(?:[.,]\d+)?|\d+\/\d+)\s*([a-zA-Z]+)?\s+(.+)$/);
  if (m) {
    const unitWord = m[2]?.toLowerCase();
    const unit = unitWord ? UNIT_WORDS[unitWord] : undefined;
    const name = unit ? m[3] : `${m[2] ? m[2] + ' ' : ''}${m[3]}`;
    return { name: tidy(name), quantity: m[1].replace(',', '.'), unit };
  }
  // "eggs x2", "eggs × 2"
  m = t.match(/^(.+?)\s*[x×]\s*(\d+(?:\.\d+)?)$/i);
  if (m) return { name: tidy(m[1]), quantity: m[2] };
  return { name: tidy(t) };
}

function tidy(name: string) {
  const n = name.trim().replace(/^of\s+/i, '');
  return n.charAt(0).toUpperCase() + n.slice(1);
}

// Store sections, in the order most stores are laid out.
export const AISLES = ['Produce', 'Bakery', 'Meat & seafood', 'Dairy & eggs', 'Frozen', 'Pantry', 'Snacks', 'Drinks', 'Household', 'Other'] as const;
export type Aisle = typeof AISLES[number];

const AISLE_WORDS: [Aisle, RegExp][] = [
  // Checked first: names that would otherwise match a word from another section
  ['Frozen',         /\b(frozen|ice cream|popsicle)/],
  ['Pantry',         /\b(peanut butter|almond butter|broth|stock|soup|canned|egg noodles)/],
  ['Drinks',         /\b(juice|soda|coffee|tea\b|lemonade|seltzer)/],
  ['Snacks',         /\b(chips|crackers|cookies|pretzels?)\b/],
  ['Produce',        /\b(apple|banana|berr(y|ies)|strawberr|blueberr|raspberr|grape|orange|lemon|lime|avocado|tomato|potato|onion|garlic|lettuce|spinach|kale|greens|salad|carrot|celery|cucumber|pepper|broccoli|cauliflower|zucchini|squash|mushroom|herb|cilantro|parsley|basil|ginger|peach|pear|plum|mango|pineapple|melon|watermelon|cherr|corn|cabbage|asparagus|green beans|mandarin|clementine|fruit|veg)/],
  ['Bakery',         /\b(bread|bagel|bun|roll|tortilla|pita|croissant|muffin|baguette|loaf|loaves|cake|donut)/],
  ['Meat & seafood', /\b(chicken|beef|steak|pork|bacon|sausage|turkey|ham|lamb|ground|salmon|tuna steak|shrimp|fish|cod|tilapia|crab|lobster|meat|deli|hot dog|jerky)/],
  ['Dairy & eggs',   /\b(milk|cheese|yogurt|yoghurt|butter|cream|egg|sour cream|cottage|creamer|kefir|half and half)/],
  ['Drinks',         /\b(water|juice|soda|coffee|tea|beer|wine|seltzer|sparkling|kombucha|lemonade|drink|cola|gatorade)/],
  ['Snacks',         /\b(chips|crackers|cookies|candy|chocolate|popcorn|pretzel|nuts|almonds|granola bar|snack|trail mix)/],
  ['Household',      /\b(paper towel|toilet paper|tissue|soap|detergent|dish|trash bag|foil|plastic wrap|sponge|cleaner|shampoo|toothpaste|napkin|battery|batteries)/],
  ['Pantry',         /\b(rice|pasta|noodle|flour|sugar|salt|oil|vinegar|sauce|ketchup|mustard|mayo|spice|cereal|oat|beans|soup|broth|stock|canned|peanut butter|jam|jelly|honey|syrup|baking|yeast|lentil|quinoa|tuna|seasoning)/],
];

export function aisleFor(name: string): Aisle {
  const n = name.toLowerCase();
  for (const [aisle, re] of AISLE_WORDS) if (re.test(n)) return aisle;
  return 'Other';
}

// ── Unit sense-check ──────────────────────────────────────────────────────────
// A gentle check for units that don't fit the item ("1 can of butter"). It only
// suggests; the user can always keep what they typed.

const WEIGHT = ['lbs', 'oz', 'g', 'kg'];
const UNIT_RULES: { match: RegExp; label: string; units: string[] }[] = [
  { match: /\b(peanut butter|almond butter)\b/, label: 'Nut butter', units: ['jars', 'oz', 'count'] },
  { match: /\bbutter\b/,                        label: 'Butter',     units: ['sticks', 'boxes', 'packs', 'tubs', 'count', ...WEIGHT] },
  { match: /\b(milk|creamer|half and half|heavy cream|whipping cream|kefir)\b/, label: 'Milk', units: ['gal', 'qt', 'pt', 'cartons', 'bottles', 'oz', 'L', 'ml', 'count'] },
  { match: /\b(juice|lemonade)\b/,              label: 'Juice',      units: ['bottles', 'cartons', 'gal', 'qt', 'oz', 'L', 'ml', 'cans', 'packs', 'count'] },
  { match: /\b(soda|cola|beer|seltzer|sparkling water|energy drink)\b/, label: 'Drinks like this', units: ['cans', 'bottles', 'packs', 'count', 'L', 'oz'] },
  { match: /\begg(s)?\b/,                       label: 'Eggs',       units: ['dozen', 'count', 'cartons'] },
  { match: /\b(bread|loaf|bagels?|buns?|rolls?|tortillas?)\b/, label: 'Bread', units: ['loaves', 'bags', 'packs', 'count'] },
  { match: /\b(chicken|beef|steak|pork|turkey|ground|lamb|salmon|fish|shrimp|bacon|sausage|ham)\b/, label: 'Meat and fish', units: ['packs', 'count', 'bags', ...WEIGHT] },
  { match: /\b(cheese)\b/,                      label: 'Cheese',     units: ['blocks', 'bags', 'packs', 'count', 'tubs', ...WEIGHT] },
  { match: /\b(yogurt|yoghurt|cottage cheese|sour cream|hummus|cream cheese)\b/, label: 'This', units: ['tubs', 'cups', 'packs', 'count', 'oz', 'lbs'] },
  { match: /\b(lettuce|spinach|kale|greens|cilantro|parsley|basil|herbs|celery)\b/, label: 'Greens', units: ['bunches', 'bags', 'heads', 'count', 'boxes', ...WEIGHT] },
  { match: /\b(apples?|bananas?|oranges?|lemons?|limes?|avocados?|tomato(es)?|potato(es)?|onions?|peppers?|carrots?|cucumbers?|peach(es)?|pears?|mangos?|zucchini|broccoli|cauliflower|grapes|berries|strawberries|blueberries)\b/, label: 'Produce', units: ['count', 'bags', 'bunches', 'boxes', 'packs', ...WEIGHT] },
  { match: /\b(rice|pasta|flour|sugar|oats|quinoa|lentils|cereal)\b/, label: 'This', units: ['bags', 'boxes', 'count', ...WEIGHT] },
  { match: /\b(ketchup|mustard|mayo|mayonnaise|dressing|hot sauce|soy sauce|syrup|oil|vinegar)\b/, label: 'This', units: ['bottles', 'jars', 'oz', 'count', 'L', 'ml'] },
];

// Turn whatever was typed ("can", "Lb", "stick") into the same form the rules use
const UNIT_ALIASES: Record<string, string> = {
  ...UNIT_WORDS, stick: 'sticks', sticks: 'sticks', tub: 'tubs', tubs: 'tubs', head: 'heads', heads: 'heads',
  block: 'blocks', blocks: 'blocks', cup: 'cups', cups: 'cups', each: 'count', ea: 'count', pc: 'count', pcs: 'count', piece: 'count', pieces: 'count',
};

/** A friendly note if the unit doesn't usually fit this item, else null. */
export function unitWarning(name: string, unit: string): { message: string; suggestions: string[] } | null {
  const u = unit.trim().toLowerCase();
  if (!u || !name.trim()) return null;
  const norm = UNIT_ALIASES[u] ?? u;
  const n = name.toLowerCase();
  const rule = UNIT_RULES.find(r => r.match.test(n));
  if (!rule) return null;
  if (rule.units.map(x => x.toLowerCase()).includes(norm.toLowerCase())) return null;
  const suggestions = rule.units.filter(x => !WEIGHT.includes(x) || x === 'lbs' || x === 'oz').slice(0, 3);
  return {
    message: `Usually bought in ${suggestions.join(', ').replace(/, ([^,]*)$/, ' or $1')}, not ${unit.trim()}. You can keep it if that's right.`,
    suggestions,
  };
}
