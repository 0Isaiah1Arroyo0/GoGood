import { supabase } from './supabase';

export interface SyncItem {
  id: number; icon: string; name: string; baseName: string; batch: number;
  qty: string; expiryDate: string; expires: string; badge: string; days: number;
  protein: number; carbs: number; fat: number; cal: number;
  qtyNum: number; unit: string; category: string; addedAt: number;
  foodCategory?: string; servingSize?: string;
  ownerId?: string;
}

function toRow(item: SyncItem, userId: string) {
  return {
    id:            item.id,
    user_id:       userId,
    icon:          item.icon,
    name:          item.name,
    base_name:     item.baseName,
    batch:         item.batch,
    qty:           item.qty,
    expiry_date:   item.expiryDate,
    expires:       item.expires,
    badge:         item.badge,
    days:          item.days,
    protein:       item.protein,
    carbs:         item.carbs,
    fat:           item.fat,
    cal:           item.cal,
    qty_num:       item.qtyNum,
    unit:          item.unit,
    category:      item.category,
    added_at:      item.addedAt,
    food_category: item.foodCategory ?? null,
    serving_size:  item.servingSize  ?? null,
    updated_at:    new Date().toISOString(),
  };
}

export function fromRow(row: any): SyncItem {
  return {
    id:           row.id,
    icon:         row.icon,
    name:         row.name,
    baseName:     row.base_name,
    batch:        row.batch,
    qty:          row.qty,
    expiryDate:   row.expiry_date,
    expires:      row.expires,
    badge:        row.badge as any,
    days:         row.days,
    protein:      Number(row.protein),
    carbs:        Number(row.carbs),
    fat:          Number(row.fat),
    cal:          Number(row.cal),
    qtyNum:       row.qty_num,
    unit:         row.unit,
    category:     row.category as any,
    addedAt:      row.added_at,
    foodCategory: row.food_category ?? undefined,
    servingSize:  row.serving_size  ?? undefined,
    ownerId:      row.user_id       ?? undefined,
  };
}

// Push full local list to Supabase (upsert all, delete removed ones).
export async function pushItems(items: SyncItem[], userId: string, householdId?: string): Promise<void> {
  if (!userId) return;
  try {
    // In household mode, only push items this user owns — never re-write a housemate's items.
    const mine = householdId ? items.filter(i => !i.ownerId || i.ownerId === userId) : items;
    if (mine.length > 0) {
      const rows = mine.map(i => ({ ...toRow(i, userId), household_id: householdId ?? null }));
      await supabase.from('food_items').upsert(rows, { onConflict: 'id,user_id' });
    }
    // Delete rows no longer in local list (only check against this user's items)
    const localIds = mine.map(i => i.id);
    // In household mode, only consider this user's own items for deletion — never touch
    // items owned by other household members, which aren't in this user's local list.
    const { data: remote } = householdId
      ? await supabase.from('food_items').select('id').eq('household_id', householdId).eq('user_id', userId)
      : await supabase.from('food_items').select('id').eq('user_id', userId).is('household_id', null);
    if (remote) {
      const toDelete = remote.filter(r => !localIds.includes(r.id)).map(r => r.id);
      if (toDelete.length > 0) {
        if (householdId) {
          await supabase.from('food_items').delete().eq('household_id', householdId).eq('user_id', userId).in('id', toDelete);
        } else {
          await supabase.from('food_items').delete().eq('user_id', userId).in('id', toDelete);
        }
      }
    }
  } catch (e) { console.error('[sync] pushItems failed', e); }
}

// Pull items from Supabase. Returns null if fetch fails (keep local data).
export async function pullItems(userId: string, householdId?: string): Promise<SyncItem[] | null> {
  if (!userId) return null;
  try {
    const { data, error } = householdId
      ? await supabase.from('food_items').select('*').eq('household_id', householdId)
      : await supabase.from('food_items').select('*').eq('user_id', userId).is('household_id', null);
    if (error || !data) return null;
    return data.map(fromRow);
  } catch { return null; }
}
