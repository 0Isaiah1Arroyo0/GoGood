import AsyncStorage from '@react-native-async-storage/async-storage';

export const COLLECTIONS_KEY    = 'gogood_collections';
export const SAVED_RECIPES_KEY  = 'gogood_saved_recipes';

export interface Collection {
  id: string;
  name: string;
  emoji: string;
  createdAt: number;
}

export interface SavedRecipe {
  id: string;
  collectionId: string;   // '' = uncategorized
  name: string;
  content: string;
  recipeMacros?: { protein: number; carbs: number; fat: number; cal: number; servings?: number; servingSize?: string; fridgeDays?: number } | null;
  savedAt: number;
  rating?: number;
  notes?: string;
  cookedCount?: number;
  lastCooked?: number;
  sharedWithHousehold?: boolean;
  sharedBy?: string;      // userId of the member who shared (for household recipes)
}

// Headers and time/difficulty lines Claude puts in bold — never the dish name
const SKIP_PATTERN = /^(ingredients?|steps?|instructions?|directions?|method|prep\s*time|cook\s*time|total\s*time|active\s*time|servings?|serves?|yield|difficulty|overview|tips?(\s*[&+]?\s*swaps?)?|storage|notes?|nutrition|macros?|equipment|make\s*ahead|variations?|substitutions?|about|description|background|tools?|quick\s*tip)/i;
const TIME_PATTERN  = /^\d+\s*(min|minute|hour|hr|second)/i;

export function parseRecipeName(content: string): string {
  // 1. Markdown headings first — Claude uses # Dish Name as the recipe title
  for (const line of content.split('\n')) {
    if (/^#+\s/.test(line)) {
      const heading = line.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/:$/, '').trim();
      if (heading.length > 3 && !SKIP_PATTERN.test(heading) && !TIME_PATTERN.test(heading)) {
        return heading;
      }
    }
  }
  // 2. Bold matches — skip known section headers and time snippets
  for (const m of content.matchAll(/\*\*([^*\n]{3,80})\*\*/g)) {
    const candidate = m[1].trim().replace(/:$/, '');
    if (!SKIP_PATTERN.test(candidate) && !TIME_PATTERN.test(candidate)) {
      return candidate;
    }
  }
  // 3. Fallback: first non-empty plain line stripped of markdown formatting
  const firstLine = content
    .split('\n')
    .map(l => l.replace(/\*\*/g, '').replace(/^#+\s*/, '').trim())
    .find(l => l.length > 3 && !SKIP_PATTERN.test(l) && !TIME_PATTERN.test(l));
  return firstLine || 'Saved Recipe';
}

export async function loadCollections(): Promise<Collection[]> {
  const raw = await AsyncStorage.getItem(COLLECTIONS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function loadSavedRecipes(): Promise<SavedRecipe[]> {
  const raw = await AsyncStorage.getItem(SAVED_RECIPES_KEY);
  if (!raw) return [];
  const recipes: SavedRecipe[] = JSON.parse(raw);

  // Auto-migrate: fix any recipes that were saved with a wrong/missing name
  let dirty = false;
  const fixed = recipes.map(r => {
    if (!r.content) return r;
    const looksWrong =
      !r.name ||
      r.name === 'Saved Recipe' ||
      r.name.length < 4 ||
      SKIP_PATTERN.test(r.name) ||
      TIME_PATTERN.test(r.name);
    if (!looksWrong) return r;
    const better = parseRecipeName(r.content);
    if (better === r.name) return r;
    dirty = true;
    return { ...r, name: better };
  });

  if (dirty) persistSavedRecipes(fixed).catch(() => {});
  return fixed;
}

export async function persistCollections(cols: Collection[]): Promise<void> {
  await AsyncStorage.setItem(COLLECTIONS_KEY, JSON.stringify(cols));
}

export async function persistSavedRecipes(recipes: SavedRecipe[]): Promise<void> {
  await AsyncStorage.setItem(SAVED_RECIPES_KEY, JSON.stringify(recipes));
}
