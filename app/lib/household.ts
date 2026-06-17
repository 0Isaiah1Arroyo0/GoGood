import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export const HOUSEHOLD_KEY            = 'gogood_household_id';
export const HOUSEHOLD_NAME_KEY       = 'gogood_household_name';
export const HOUSEHOLD_JOINED_AT_KEY  = 'gogood_household_joined_at';
export const HOUSEHOLD_ROLE_KEY       = 'gogood_household_role';
export const INVITE_EXPIRY_DAYS       = 7;
export const MAX_HOUSEHOLD_MEMBERS    = 10;

export interface Household {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
}

export interface HouseholdMember {
  userId: string;
  email: string;
  role: 'owner' | 'member';
  joinedAt: string;
}

export interface HouseholdInvite {
  id: string;
  householdId: string;
  invitedEmail: string;
  invitedBy: string;
  token: string;
  acceptedAt: string | null;
  expiresAt: string;
  createdAt: string;
  householdName?: string;
}

export interface InviteResult {
  token: string | null;
  error?: string;
}

export interface JoinResult {
  ok: boolean;
  error?: string;
  householdId?: string;
}

export interface MutationResult {
  ok: boolean;
  error?: string;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export async function getMyHousehold(userId: string): Promise<Household | null> {
  const { data } = await supabase
    .from('household_members')
    .select('household_id, households!inner(id, name, owner_id, created_at)')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  const h = (data as any).households;
  if (!h) return null;
  return { id: h.id, name: h.name, ownerId: h.owner_id, createdAt: h.created_at };
}

export async function createHousehold(userId: string, userEmail: string, name: string): Promise<{ household: Household | null; error?: string }> {
  const { data: hh, error } = await supabase
    .from('households')
    .insert({ name: name.trim() || 'My Household', owner_id: userId })
    .select()
    .single();
  if (error || !hh) return { household: null, error: error?.message ?? 'Insert failed' };

  const { error: memErr } = await supabase.from('household_members').insert({
    household_id: hh.id, user_id: userId, email: userEmail, role: 'owner',
  });
  if (memErr) return { household: null, error: memErr.message };

  const now = new Date().toISOString();
  await AsyncStorage.multiSet([
    [HOUSEHOLD_KEY, hh.id],
    [HOUSEHOLD_NAME_KEY, hh.name],
    [HOUSEHOLD_JOINED_AT_KEY, now],
    [HOUSEHOLD_ROLE_KEY, 'owner'],
  ]);
  return { household: { id: hh.id, name: hh.name, ownerId: hh.owner_id, createdAt: hh.created_at } };
}

export async function renameHousehold(householdId: string, name: string): Promise<void> {
  await supabase.from('households').update({ name: name.trim() }).eq('id', householdId);
  await AsyncStorage.setItem(HOUSEHOLD_NAME_KEY, name.trim());
}

export async function getHouseholdMembers(householdId: string): Promise<HouseholdMember[]> {
  const { data } = await supabase
    .from('household_members')
    .select('user_id, email, role, joined_at')
    .eq('household_id', householdId)
    .order('joined_at');
  if (!data) return [];
  return data.map(m => ({
    userId: m.user_id,
    email: m.email,
    role: m.role as 'owner' | 'member',
    joinedAt: m.joined_at,
  }));
}

export async function getHouseholdInvites(householdId: string): Promise<HouseholdInvite[]> {
  const { data } = await supabase
    .from('household_invites')
    .select('*')
    .eq('household_id', householdId)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (!data) return [];
  return data.map(rowToInvite);
}

export async function getPendingInvitesForEmail(email: string): Promise<HouseholdInvite[]> {
  const { data } = await supabase
    .from('household_invites')
    .select('*, households!inner(name)')
    .eq('invited_email', email.toLowerCase().trim())
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString());
  if (!data) return [];
  return data.map(i => ({
    ...rowToInvite(i),
    householdName: (i as any).households?.name ?? 'Unknown Household',
  }));
}

function rowToInvite(i: any): HouseholdInvite {
  const fallbackExpiry = new Date(Date.now() + INVITE_EXPIRY_DAYS * 86400000).toISOString();
  return {
    id: i.id,
    householdId: i.household_id,
    invitedEmail: i.invited_email,
    invitedBy: i.invited_by,
    token: i.token,
    acceptedAt: i.accepted_at,
    expiresAt: i.expires_at ?? fallbackExpiry,
    createdAt: i.created_at,
  };
}

export async function inviteMember(householdId: string, userId: string, email: string): Promise<InviteResult> {
  const normalizedEmail = email.toLowerCase().trim();

  if (!isValidEmail(normalizedEmail)) {
    return { token: null, error: 'Please enter a valid email address.' };
  }

  const { count } = await supabase
    .from('household_members')
    .select('*', { count: 'exact', head: true })
    .eq('household_id', householdId);
  if ((count ?? 0) >= MAX_HOUSEHOLD_MEMBERS) {
    return { token: null, error: `Households are limited to ${MAX_HOUSEHOLD_MEMBERS} members.` };
  }

  const { data: existingMember } = await supabase
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId)
    .eq('email', normalizedEmail)
    .maybeSingle();
  if (existingMember) {
    return { token: null, error: 'This person is already a member of your household.' };
  }

  // Delete any existing pending invite so the resend refreshes the token and expiry.
  await supabase
    .from('household_invites')
    .delete()
    .eq('household_id', householdId)
    .eq('invited_email', normalizedEmail)
    .is('accepted_at', null);

  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 86400000).toISOString();

  const { data, error } = await supabase
    .from('household_invites')
    .insert({
      household_id: householdId,
      invited_email: normalizedEmail,
      invited_by: userId,
      expires_at: expiresAt,
    })
    .select('token')
    .single();

  if (error || !data) return { token: null, error: error?.message ?? 'Could not create invite.' };
  return { token: data.token };
}

export async function acceptInviteByToken(token: string, userId: string, userEmail: string): Promise<JoinResult> {
  const existing = await getMyHousehold(userId);
  if (existing) {
    return { ok: false, error: 'You are already in a household. Leave it first before joining another.' };
  }

  const { data: invite } = await supabase
    .from('household_invites')
    .select('id, household_id, expires_at')
    .eq('token', token.trim().toLowerCase())
    .is('accepted_at', null)
    .maybeSingle();

  if (!invite) return { ok: false, error: 'This invite code is not valid or has already been used.' };

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return { ok: false, error: `This invite code has expired. Ask your household to send a new one.` };
  }

  const { error } = await supabase.from('household_members').insert({
    household_id: invite.household_id, user_id: userId, email: userEmail, role: 'member',
  });

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'You are already a member of this household.' };
    }
    return { ok: false, error: error.message };
  }

  await supabase.from('household_invites').update({ accepted_at: new Date().toISOString() }).eq('id', invite.id);
  const { data: hhRow } = await supabase.from('households').select('name').eq('id', invite.household_id).single();

  await AsyncStorage.multiSet([
    [HOUSEHOLD_KEY, invite.household_id],
    [HOUSEHOLD_NAME_KEY, hhRow?.name ?? ''],
    [HOUSEHOLD_JOINED_AT_KEY, new Date().toISOString()],
    [HOUSEHOLD_ROLE_KEY, 'member'],
  ]);

  return { ok: true, householdId: invite.household_id };
}

export async function acceptPendingInvite(invite: HouseholdInvite, userId: string, userEmail: string): Promise<MutationResult> {
  const existing = await getMyHousehold(userId);
  if (existing) {
    return { ok: false, error: 'You are already in a household. Leave it first before joining another.' };
  }

  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return { ok: false, error: 'This invite has expired. Ask your household to send a new one.' };
  }

  const { error } = await supabase.from('household_members').insert({
    household_id: invite.householdId, user_id: userId, email: userEmail, role: 'member',
  });

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'You are already a member of this household.' };
    }
    return { ok: false, error: error.message };
  }

  await supabase.from('household_invites').update({ accepted_at: new Date().toISOString() }).eq('id', invite.id);

  await AsyncStorage.multiSet([
    [HOUSEHOLD_KEY, invite.householdId],
    [HOUSEHOLD_NAME_KEY, invite.householdName ?? ''],
    [HOUSEHOLD_JOINED_AT_KEY, new Date().toISOString()],
    [HOUSEHOLD_ROLE_KEY, 'member'],
  ]);

  return { ok: true };
}

export async function removeMember(householdId: string, targetUserId: string): Promise<MutationResult> {
  const { error } = await supabase.from('household_members').delete()
    .eq('household_id', householdId).eq('user_id', targetUserId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function leaveHousehold(householdId: string, userId: string): Promise<MutationResult> {
  const { error } = await supabase.from('household_members').delete()
    .eq('household_id', householdId).eq('user_id', userId);
  if (error) return { ok: false, error: error.message };
  await AsyncStorage.multiRemove([HOUSEHOLD_KEY, HOUSEHOLD_NAME_KEY, HOUSEHOLD_JOINED_AT_KEY, HOUSEHOLD_ROLE_KEY]);
  return { ok: true };
}

export async function deleteHousehold(householdId: string): Promise<MutationResult> {
  const { error } = await supabase.from('households').delete().eq('id', householdId);
  if (error) return { ok: false, error: error.message };
  await AsyncStorage.multiRemove([HOUSEHOLD_KEY, HOUSEHOLD_NAME_KEY, HOUSEHOLD_JOINED_AT_KEY, HOUSEHOLD_ROLE_KEY]);
  return { ok: true };
}

export async function cancelInvite(inviteId: string): Promise<void> {
  await supabase.from('household_invites').delete().eq('id', inviteId);
}

export async function transferOwnership(
  householdId: string,
  fromUserId: string,
  toUserId: string,
): Promise<MutationResult> {
  const { data, error } = await supabase.rpc('transfer_household_ownership', {
    p_household_id: householdId,
    p_from_user_id: fromUserId,
    p_to_user_id:   toUserId,
  });
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Transfer failed. Ensure the member is still in your household.' };
  return { ok: true };
}

export function subscribeToHouseholdItems(
  householdId: string,
  onInsert: (row: any) => void,
  onUpdate: (row: any) => void,
  onDelete: (id: number) => void,
): RealtimeChannel {
  return supabase
    .channel(`hh-items-${householdId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'food_items',
      filter: `household_id=eq.${householdId}`,
    }, p => onInsert(p.new))
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'food_items',
      filter: `household_id=eq.${householdId}`,
    }, p => onUpdate(p.new))
    .on('postgres_changes', {
      event: 'DELETE', schema: 'public', table: 'food_items',
      filter: `household_id=eq.${householdId}`,
    }, p => onDelete(p.old?.id))
    .subscribe();
}
