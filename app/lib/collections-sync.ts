import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  type Collection, type SavedRecipe,
  COLLECTIONS_KEY, SAVED_RECIPES_KEY,
  loadCollections, loadSavedRecipes,
  persistCollections, persistSavedRecipes,
} from './collections';

const MIGRATION_FLAG = 'gogood_collections_migrated';

// ── One-time migration: copy AsyncStorage collections/recipes → Supabase ─────

export async function migrateLocalCollectionsToSupabase(userId: string): Promise<void> {
  const done = await AsyncStorage.getItem(MIGRATION_FLAG);
  if (done === 'true') return;

  try {
    const [cols, recipes] = await Promise.all([loadCollections(), loadSavedRecipes()]);

    if (cols.length > 0) {
      const colRows = cols.map(c => ({
        user_id:   userId,
        client_id: c.id,
        name:      c.name,
        emoji:     c.emoji,
        created_at: new Date(c.createdAt).toISOString(),
      }));
      await supabase.from('recipe_collections').upsert(colRows, { onConflict: 'user_id,client_id' });
    }

    if (recipes.length > 0) {
      // We need Supabase UUIDs for collections to set collection_id FK
      const { data: dbCols } = await supabase
        .from('recipe_collections')
        .select('id, client_id')
        .eq('user_id', userId);
      const colMap = new Map((dbCols ?? []).map((c: any) => [c.client_id, c.id]));

      const recipeRows = recipes.map(r => ({
        user_id:       userId,
        client_id:     r.id,
        collection_id: r.collectionId ? (colMap.get(r.collectionId) ?? null) : null,
        name:          r.name,
        content:       r.content,
        recipe_macros: r.recipeMacros ?? null,
        rating:        r.rating ?? null,
        notes:         r.notes ?? null,
        cooked_count:  r.cookedCount ?? 0,
        last_cooked:   r.lastCooked ? new Date(r.lastCooked).toISOString() : null,
        saved_at:      new Date(r.savedAt).toISOString(),
      }));
      await supabase.from('saved_recipes').upsert(recipeRows, { onConflict: 'user_id,client_id' });
    }

    await AsyncStorage.setItem(MIGRATION_FLAG, 'true');
  } catch {
    // Don't set the flag — retry on next app open
  }
}

// ── Push collections to Supabase ──────────────────────────────────────────────

export async function pushCollections(cols: Collection[], userId: string): Promise<void> {
  if (!userId) return;
  try {
    const rows = cols.map(c => ({
      user_id:    userId,
      client_id:  c.id,
      name:       c.name,
      emoji:      c.emoji,
      created_at: new Date(c.createdAt).toISOString(),
    }));
    await supabase.from('recipe_collections').upsert(rows, { onConflict: 'user_id,client_id' });

    // Delete removed collections
    const { data: remote } = await supabase.from('recipe_collections').select('client_id').eq('user_id', userId);
    if (remote) {
      const localIds = new Set(cols.map(c => c.id));
      const toDelete = remote.filter((r: any) => r.client_id && !localIds.has(r.client_id)).map((r: any) => r.client_id);
      if (toDelete.length > 0) {
        await supabase.from('recipe_collections').delete().eq('user_id', userId).in('client_id', toDelete);
      }
    }
  } catch { /* network error — local state is source of truth */ }
}

// ── Push saved recipes to Supabase ────────────────────────────────────────────

export async function pushSavedRecipes(recipes: SavedRecipe[], userId: string, householdId?: string): Promise<void> {
  if (!userId) return;
  try {
    // Fetch collection UUID map for FK
    const { data: dbCols } = await supabase.from('recipe_collections').select('id, client_id').eq('user_id', userId);
    const colMap = new Map((dbCols ?? []).map((c: any) => [c.client_id, c.id]));

    const rows = recipes.map(r => ({
      user_id:       userId,
      client_id:     r.id,
      collection_id: r.collectionId ? (colMap.get(r.collectionId) ?? null) : null,
      household_id:  r.sharedWithHousehold ? (householdId ?? null) : null,
      name:          r.name,
      content:       r.content,
      recipe_macros: r.recipeMacros ?? null,
      rating:        r.rating ?? null,
      notes:         r.notes ?? null,
      cooked_count:  r.cookedCount ?? 0,
      last_cooked:   r.lastCooked ? new Date(r.lastCooked).toISOString() : null,
      shared_with_household: r.sharedWithHousehold ?? false,
      saved_at:      new Date(r.savedAt).toISOString(),
      updated_at:    new Date().toISOString(),
    }));
    await supabase.from('saved_recipes').upsert(rows, { onConflict: 'user_id,client_id' });

    // Delete removed recipes
    const { data: remote } = await supabase.from('saved_recipes').select('client_id').eq('user_id', userId);
    if (remote) {
      const localIds = new Set(recipes.map(r => r.id));
      const toDelete = remote.filter((r: any) => r.client_id && !localIds.has(r.client_id)).map((r: any) => r.client_id);
      if (toDelete.length > 0) {
        await supabase.from('saved_recipes').delete().eq('user_id', userId).in('client_id', toDelete);
      }
    }
  } catch { /* network error — local state is source of truth */ }
}

// ── Share a recipe with the household ────────────────────────────────────────

export async function shareRecipeWithHousehold(recipeClientId: string, userId: string, householdId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('saved_recipes')
      .update({ shared_with_household: true, household_id: householdId, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('client_id', recipeClientId);
    return !error;
  } catch { return false; }
}

export async function unshareRecipe(recipeClientId: string, userId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('saved_recipes')
      .update({ shared_with_household: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('client_id', recipeClientId);
    return !error;
  } catch { return false; }
}

// ── Pull household-shared recipes (other members' recipes) ───────────────────

export async function pullHouseholdSharedRecipes(householdId: string, userId: string): Promise<SavedRecipe[]> {
  try {
    const { data } = await supabase
      .from('saved_recipes')
      .select('*')
      .eq('household_id', householdId)
      .eq('shared_with_household', true)
      .neq('user_id', userId)
      .order('saved_at', { ascending: false })
      .limit(50);
    if (!data) return [];
    return data.map(fromSupabaseRecipe);
  } catch { return []; }
}

// ── Realtime subscription for household recipes ──────────────────────────────

export function subscribeToHouseholdRecipes(
  householdId: string,
  onInsert: (recipe: SavedRecipe) => void,
  onUpdate: (recipe: SavedRecipe) => void,
  onDelete: (clientId: string) => void,
): RealtimeChannel {
  return supabase
    .channel(`hh-recipes-${householdId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'saved_recipes',
      filter: `household_id=eq.${householdId}`,
    }, p => { if (p.new?.shared_with_household) onInsert(fromSupabaseRecipe(p.new)) })
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'saved_recipes',
      filter: `household_id=eq.${householdId}`,
    }, p => { if (p.new?.shared_with_household) onUpdate(fromSupabaseRecipe(p.new)); else if (p.old?.client_id) onDelete(p.old.client_id) })
    .on('postgres_changes', {
      event: 'DELETE', schema: 'public', table: 'saved_recipes',
      filter: `household_id=eq.${householdId}`,
    }, p => { if (p.old?.client_id) onDelete(p.old.client_id) })
    .subscribe();
}

// ── Helper: map Supabase row → SavedRecipe ────────────────────────────────────

function fromSupabaseRecipe(row: any): SavedRecipe {
  return {
    id:                  row.client_id ?? row.id,
    collectionId:        '',
    name:                row.name,
    content:             row.content,
    recipeMacros:        row.recipe_macros ?? null,
    savedAt:             row.saved_at ? new Date(row.saved_at).getTime() : Date.now(),
    rating:              row.rating ?? undefined,
    notes:               row.notes ?? undefined,
    cookedCount:         row.cooked_count ?? 0,
    lastCooked:          row.last_cooked ? new Date(row.last_cooked).getTime() : undefined,
    sharedWithHousehold: row.shared_with_household ?? false,
    sharedBy:            row.user_id,
  };
}
