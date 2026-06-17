import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ParsedIngredient {
  qty: number;
  unit: string;
  name: string;
  raw: string;
}

export interface InventoryItemRef {
  id: number;
  baseName: string;
  qtyNum: number;
  unit: string;
  icon?: string;
}

export interface IngredientMatch {
  ingredient: ParsedIngredient;
  item: InventoryItemRef;
  deductAmount: number;
}

/** Extract ingredient lines from the Ingredients section of recipe markdown.
 *  Handles both ## Ingredients (heading) and **Ingredients** (bold) formats. */
export function parseIngredients(content: string): ParsedIngredient[] {
  const lines = content.split('\n');
  const results: ParsedIngredient[] = [];
  let inSection = false;

  for (const raw of lines) {
    const trimmed = raw.trim();

    // Detect start of ingredients section — markdown heading OR bold label
    if (/^#+\s*ingredients?/i.test(trimmed) ||
        /\*\*\s*ingredients?\s*:?\s*\*\*/i.test(trimmed) ||
        /^ingredients?\s*:/i.test(trimmed)) {
      inSection = true;
      continue;
    }

    // Detect end of ingredients section (next section header)
    if (inSection) {
      const isNextHeader =
        /^#+\s/.test(trimmed) ||
        /\*\*\s*(instructions?|directions?|method|steps?|notes?|tips?|nutrition|preparation|storage)\s*:?\s*\*\*/i.test(trimmed) ||
        /^(instructions?|directions?|method|steps?)\s*:/i.test(trimmed);
      if (isNextHeader) break;
    }

    if (!inSection) continue;

    // Only match real bullet points (- or * with space, or •) — not **bold** markers
    if (!/^-\s/.test(trimmed) && !/^\*\s/.test(trimmed) && !trimmed.startsWith('• ')) continue;

    const item = trimmed.replace(/^[-*•]\s*/, '').trim();

    // "1/2 cup milk", "2 tbsp olive oil", "3 eggs", "salt to taste"
    const m = item.match(
      /^(\d+(?:\s*\/\s*\d+)?(?:\.\d+)?)?\s*([a-zA-Z]+\.?)?\s+(.+)$/
    );
    if (!m) {
      results.push({ qty: 1, unit: '', name: item.toLowerCase(), raw: item });
      continue;
    }

    let [, qtyStr, unit = '', name] = m;
    let qty = 1;
    if (qtyStr) {
      const q = qtyStr.trim();
      if (q.includes('/')) {
        const [a, b] = q.split('/');
        qty = Number(a.trim()) / Number(b.trim());
      } else {
        qty = parseFloat(q);
      }
    }
    if (isNaN(qty) || qty <= 0) qty = 1;

    unit = unit.toLowerCase().replace(/\.$/, '');
    name = name.replace(/^of\s+/i, '').split('(')[0].trim().toLowerCase();

    results.push({ qty, unit, name, raw: item });
  }
  return results;
}

function scoreMatch(ingName: string, baseName: string): number {
  const ingWords  = ingName.split(/\s+/).filter(w => w.length >= 3);
  const itemWords = baseName.toLowerCase().split(/\s+/);
  let score = 0;
  for (const iw of ingWords) {
    for (const dw of itemWords) {
      if (dw === iw)                            score += iw.length * 2;
      else if (dw.includes(iw) || iw.includes(dw)) score += iw.length;
    }
  }
  return score;
}

/** Match parsed ingredients against inventory items using keyword-overlap scoring. */
export function matchIngredients(
  ingredients: ParsedIngredient[],
  items: InventoryItemRef[],
): IngredientMatch[] {
  const matched: IngredientMatch[] = [];

  for (const ing of ingredients) {
    let bestScore = 0;
    let bestItem: InventoryItemRef | null = null;

    for (const item of items) {
      const s = scoreMatch(ing.name, item.baseName);
      if (s > bestScore) { bestScore = s; bestItem = item; }
    }

    if (bestScore >= 3 && bestItem) {
      matched.push({ ingredient: ing, item: { ...bestItem }, deductAmount: ing.qty });
    }
  }

  // Collapse duplicate item matches by summing deductions
  const byId = new Map<number, IngredientMatch>();
  for (const m of matched) {
    const existing = byId.get(m.item.id);
    if (existing) existing.deductAmount += m.deductAmount;
    else byId.set(m.item.id, { ...m });
  }
  return [...byId.values()];
}

/**
 * Apply portion deductions to the local inventory (AsyncStorage) and push to Supabase.
 * Items that reach 0 are moved to gone-good history.
 */
export async function applyPortionDeductions(
  deductions: { itemId: number; amount: number }[],
  userId?: string,
  householdId?: string,
): Promise<void> {
  const [itemsRaw, goodRaw, statsRaw] = await Promise.all([
    AsyncStorage.getItem('gogood_items'),
    AsyncStorage.getItem('gogood_gone_good'),
    AsyncStorage.getItem('gogood_stats'),
  ]);
  const items: any[]  = itemsRaw  ? JSON.parse(itemsRaw)  : [];
  const good: any[]   = goodRaw   ? JSON.parse(goodRaw)   : [];
  const stats: any    = statsRaw  ? JSON.parse(statsRaw)  : { goneGood: 0, goneBad: 0, totalAdded: 0 };
  const now           = new Date().toISOString();

  const fmtd = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(1));

  const goneIds   = new Set<number>();
  const portionLog: Array<{ itemId: number; amount: number }> = [];

  for (const { itemId, amount } of deductions) {
    const idx = items.findIndex(i => i.id === itemId);
    if (idx === -1) continue;
    const item      = items[idx];
    const remaining = (item.qtyNum ?? 1) - amount;
    if (remaining <= 0) {
      goneIds.add(itemId);
    } else {
      const newQtyNum = Math.round(remaining * 10) / 10;
      items[idx] = {
        ...item,
        qtyNum: newQtyNum,
        qty:    item.unit ? `${fmtd(newQtyNum)} ${item.unit}` : fmtd(newQtyNum),
      };
      portionLog.push({ itemId, amount });
    }
  }

  // Full items fully consumed → gone-good (no portion label)
  const goneEntries = items.filter(i => goneIds.has(i.id)).map(i => ({
    id: i.id, name: i.baseName || i.name || 'Item',
    icon: i.icon || '🥘', date: now,
    expiryDate: i.expiryDate || now, category: i.foodCategory || i.category || '',
  }));

  // Partial deductions → gone-good history with portion label so report tracks them
  const portionEntries = portionLog.map(({ itemId, amount }) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return null;
    const portionStr = item.unit ? `${fmtd(amount)} ${item.unit}` : fmtd(amount);
    return {
      id: item.id, name: item.baseName || item.name || 'Item',
      icon: item.icon || '🥘', date: now,
      expiryDate: item.expiryDate || now, category: item.foodCategory || item.category || '',
      portion: portionStr,
    };
  }).filter((e): e is NonNullable<typeof e> => e !== null);

  const remainingItems  = items.filter(i => !goneIds.has(i.id));
  const allNewEntries   = [...goneEntries, ...portionEntries];

  await Promise.all([
    AsyncStorage.setItem('gogood_items',     JSON.stringify(remainingItems)),
    AsyncStorage.setItem('gogood_gone_good', JSON.stringify([...allNewEntries, ...good])),
    AsyncStorage.setItem('gogood_stats',     JSON.stringify({
      ...stats, goneGood: (stats.goneGood || 0) + allNewEntries.length,
    })),
  ]);

  if (userId) {
    import('./sync').then(({ pushItems }) => {
      pushItems(remainingItems as any, userId, householdId).catch(() => {});
    });
  }
}
