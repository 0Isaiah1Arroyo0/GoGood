import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export const SHOPPING_LIST_KEY = 'gogood_shopping_list';

export interface ShoppingItem {
  id: string;
  name: string;
  quantity?: string;
  unit?: string;
  icon?: string;
  recipeId?: string;
  recipeName?: string;
  checked: boolean;
  addedAt: number;
}

// ─── Local (AsyncStorage) ─────────────────────────────────────────────────────

export async function loadShoppingList(): Promise<ShoppingItem[]> {
  const raw = await AsyncStorage.getItem(SHOPPING_LIST_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function persistShoppingList(items: ShoppingItem[]): Promise<void> {
  await AsyncStorage.setItem(SHOPPING_LIST_KEY, JSON.stringify(items));
}

export async function addToShoppingList(
  newItems: Omit<ShoppingItem, 'id' | 'addedAt' | 'checked'>[],
): Promise<ShoppingItem[]> {
  const existing = await loadShoppingList();
  const now = Date.now();
  const merged = [...existing];
  for (let i = 0; i < newItems.length; i++) {
    const item = newItems[i];
    const alreadyExists = merged.some(
      e => e.name.toLowerCase() === item.name.toLowerCase() && !e.checked,
    );
    if (!alreadyExists) {
      merged.push({ ...item, id: `${now}-${i}`, addedAt: now, checked: false });
    }
  }
  await persistShoppingList(merged);
  return merged;
}

export async function toggleShoppingItem(id: string): Promise<ShoppingItem[]> {
  const items = await loadShoppingList();
  const updated = items.map(i => (i.id === id ? { ...i, checked: !i.checked } : i));
  await persistShoppingList(updated);
  return updated;
}

export async function updateShoppingItem(
  id: string,
  updates: { name?: string; quantity?: string; unit?: string },
): Promise<ShoppingItem[]> {
  const items = await loadShoppingList();
  const updated = items.map(i => (i.id === id ? { ...i, ...updates } : i));
  await persistShoppingList(updated);
  return updated;
}

export async function removeCheckedItems(): Promise<ShoppingItem[]> {
  const items = await loadShoppingList();
  const updated = items.filter(i => !i.checked);
  await persistShoppingList(updated);
  return updated;
}

// ─── Household (Supabase) ─────────────────────────────────────────────────────

function rowToItem(row: Record<string, any>): ShoppingItem {
  return {
    id: row.id,
    name: row.name,
    quantity: row.quantity ?? undefined,
    unit: row.unit ?? undefined,
    icon: row.icon ?? undefined,
    recipeId: row.recipe_id ?? undefined,
    recipeName: row.recipe_name ?? undefined,
    checked: row.checked,
    addedAt: new Date(row.added_at).getTime(),
  };
}

export async function loadHouseholdShoppingList(householdId: string): Promise<ShoppingItem[]> {
  const { data } = await supabase
    .from('household_shopping_list')
    .select('*')
    .eq('household_id', householdId)
    .order('added_at', { ascending: true });
  return (data ?? []).map(rowToItem);
}

export async function addToHouseholdShoppingList(
  householdId: string,
  newItems: Omit<ShoppingItem, 'id' | 'addedAt' | 'checked'>[],
): Promise<ShoppingItem[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return loadHouseholdShoppingList(householdId);
  const existing = await loadHouseholdShoppingList(householdId);
  const toInsert = newItems.filter(
    item => !existing.some(e => e.name.toLowerCase() === item.name.toLowerCase() && !e.checked),
  );
  if (toInsert.length) {
    const rows = toInsert.map(item => ({
      household_id: householdId,
      added_by: user.id,
      name: item.name,
      quantity: item.quantity ?? null,
      unit: item.unit ?? null,
      icon: item.icon ?? null,
      recipe_id: item.recipeId ?? null,
      recipe_name: item.recipeName ?? null,
    }));
    await supabase.from('household_shopping_list').insert(rows);
  }
  return loadHouseholdShoppingList(householdId);
}

export async function toggleHouseholdShoppingItem(
  householdId: string,
  itemId: string,
  checked: boolean,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  await supabase
    .from('household_shopping_list')
    .update({
      checked,
      checked_by: checked ? (user?.id ?? null) : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .eq('household_id', householdId);
}

export async function updateHouseholdShoppingItem(
  householdId: string,
  itemId: string,
  updates: { name?: string; quantity?: string; unit?: string },
): Promise<void> {
  const fields: Record<string, any> = { updated_at: new Date().toISOString() };
  if (updates.name !== undefined) fields.name = updates.name;
  if (updates.quantity !== undefined) fields.quantity = updates.quantity || null;
  if (updates.unit !== undefined) fields.unit = updates.unit || null;
  await supabase
    .from('household_shopping_list')
    .update(fields)
    .eq('id', itemId)
    .eq('household_id', householdId);
}

export async function removeHouseholdCheckedItems(householdId: string): Promise<void> {
  await supabase
    .from('household_shopping_list')
    .delete()
    .eq('household_id', householdId)
    .eq('checked', true);
}

export async function clearHouseholdShoppingList(householdId: string): Promise<void> {
  await supabase
    .from('household_shopping_list')
    .delete()
    .eq('household_id', householdId);
}

export function subscribeToHouseholdShoppingList(
  householdId: string,
  onInsert: (item: ShoppingItem) => void,
  onUpdate: (item: ShoppingItem) => void,
  onDelete: (id: string) => void,
): RealtimeChannel {
  return supabase
    .channel(`hh-shopping-${householdId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'household_shopping_list',
      filter: `household_id=eq.${householdId}`,
    }, p => onInsert(rowToItem(p.new as Record<string, any>)))
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'household_shopping_list',
      filter: `household_id=eq.${householdId}`,
    }, p => onUpdate(rowToItem(p.new as Record<string, any>)))
    .on('postgres_changes', {
      event: 'DELETE', schema: 'public', table: 'household_shopping_list',
      filter: `household_id=eq.${householdId}`,
    }, p => onDelete(p.old?.id))
    .subscribe();
}
