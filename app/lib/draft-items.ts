import { supabase } from './supabase';
import type { SyncItem } from './sync';

export interface DraftItem {
  id: string;
  source: 'receipt' | 'kroger' | 'manual';
  name: string;
  baseName: string;
  icon: string;
  qtyNum: number;
  unit: string;
  category: 'fridge' | 'freezer' | 'pantry';
  expiryDate: string | null;
  foodCategory: string | null;
  protein: number;
  carbs: number;
  fat: number;
  cal: number;
  servingSize: string;
  scanSessionId: string | null;
  storeName: string | null;
  storeOrderId: string | null;
  createdAt: string;
}

export async function loadDraftsBySession(sessionId: string): Promise<DraftItem[]> {
  try {
    const { data } = await supabase
      .from('draft_items')
      .select('*')
      .eq('scan_session_id', sessionId)
      .order('created_at');
    return (data ?? []).map(fromRow);
  } catch { return []; }
}

export async function loadAllDrafts(userId: string): Promise<DraftItem[]> {
  try {
    const { data } = await supabase
      .from('draft_items')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return (data ?? []).map(fromRow);
  } catch { return []; }
}

export async function updateDraft(id: string, changes: Partial<Pick<DraftItem, 'name' | 'qtyNum' | 'unit' | 'category' | 'expiryDate' | 'icon' | 'foodCategory' | 'protein' | 'carbs' | 'fat' | 'cal' | 'servingSize'>>): Promise<void> {
  try {
    await supabase.from('draft_items').update({
      ...(changes.name         !== undefined && { name: changes.name, base_name: changes.name }),
      ...(changes.qtyNum       !== undefined && { qty_num: changes.qtyNum }),
      ...(changes.unit         !== undefined && { unit: changes.unit }),
      ...(changes.category     !== undefined && { category: changes.category }),
      ...(changes.expiryDate   !== undefined && { expiry_date: changes.expiryDate }),
      ...(changes.icon         !== undefined && { icon: changes.icon }),
      ...(changes.foodCategory !== undefined && { food_category: changes.foodCategory }),
      ...(changes.protein      !== undefined && { protein: changes.protein }),
      ...(changes.carbs        !== undefined && { carbs: changes.carbs }),
      ...(changes.fat          !== undefined && { fat: changes.fat }),
      ...(changes.cal          !== undefined && { cal: changes.cal }),
      ...(changes.servingSize  !== undefined && { serving_size: changes.servingSize }),
    }).eq('id', id);
  } catch { /* local edits tracked in state, Supabase is best-effort */ }
}

export async function deleteDraft(id: string): Promise<void> {
  try {
    await supabase.from('draft_items').delete().eq('id', id);
  } catch {}
}

export async function deleteSessionDrafts(sessionId: string): Promise<void> {
  try {
    await supabase.from('draft_items').delete().eq('scan_session_id', sessionId);
  } catch {}
}

export function draftToSyncItem(draft: DraftItem, overrides?: Partial<SyncItem>): SyncItem {
  const now = Date.now();
  const expiryDate = draft.expiryDate ?? '';
  const days = expiryDate ? Math.ceil((new Date(expiryDate).getTime() - Date.now()) / 86400000) : 999;
  const badge =
    !expiryDate       ? 'blue' :
    days < 0          ? 'black' :
    days === 0        ? 'red' :
    days <= 5         ? 'amber' :
    draft.category === 'freezer' ? 'blue' :
    'green';

  return {
    id:           now + Math.floor(Math.random() * 1000),
    icon:         draft.icon,
    name:         draft.name,
    baseName:     draft.baseName || draft.name,
    batch:        1,
    qty:          draft.qtyNum > 1 ? `${draft.qtyNum}${draft.unit ? ' ' + draft.unit : ''}` : '',
    expiryDate,
    expires:      expiryDate ? new Date(expiryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
    badge:        badge as any,
    days,
    protein:      draft.protein,
    carbs:        draft.carbs,
    fat:          draft.fat,
    cal:          draft.cal,
    servingSize:  draft.servingSize || undefined,
    qtyNum:       draft.qtyNum,
    unit:         draft.unit,
    category:     draft.category,
    addedAt:      now,
    foodCategory: draft.foodCategory ?? undefined,
    ...overrides,
  };
}

function fromRow(row: any): DraftItem {
  return {
    id:             row.id,
    source:         row.source,
    name:           row.name,
    baseName:       row.base_name,
    icon:           row.icon ?? '🥘',
    qtyNum:         Number(row.qty_num ?? 1),
    unit:           row.unit ?? '',
    category:       row.category ?? 'fridge',
    expiryDate:     row.expiry_date ?? null,
    foodCategory:   row.food_category ?? null,
    protein:        Number(row.protein ?? 0),
    carbs:          Number(row.carbs ?? 0),
    fat:            Number(row.fat ?? 0),
    cal:            Number(row.cal ?? 0),
    servingSize:    row.serving_size ?? '',
    scanSessionId:  row.scan_session_id ?? null,
    storeName:      row.store_name ?? null,
    storeOrderId:   row.store_order_id ?? null,
    createdAt:      row.created_at,
  };
}
