// Permanently deletes the calling user's account (App Store Guideline 5.1.1(v)).
//
// Every user-owned table references auth.users with ON DELETE CASCADE, so
// deleting the auth user removes their personal data. The exception is shared
// households: households.owner_id also cascades, which would wipe the shared
// inventory for every other member. So before deleting we hand each owned
// household (and the user's contributions to it) to the longest-standing
// remaining member. Households with no other members are left to cascade.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    // Identify the caller from their own JWT — never trust a user id in the body.
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // ── Hand off households this user owns ──────────────────────────────────
    const { data: owned, error: ownedErr } = await admin
      .from('households').select('id').eq('owner_id', user.id)
    if (ownedErr) throw ownedErr

    for (const { id: householdId } of owned ?? []) {
      const { data: heir } = await admin
        .from('household_members')
        .select('user_id')
        .eq('household_id', householdId)
        .neq('user_id', user.id)
        .order('joined_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (!heir) continue // sole member — let the household cascade away

      const { data: ok, error: rpcErr } = await admin.rpc('transfer_household_ownership', {
        p_household_id: householdId,
        p_from_user_id: user.id,
        p_to_user_id:   heir.user_id,
      })
      if (rpcErr || !ok) throw rpcErr ?? new Error(`Ownership transfer failed for household ${householdId}`)
    }

    // ── Keep shared items/list entries the user added to any household ──────
    // (food_items.user_id and household_shopping_list.added_by cascade too.)
    const { data: memberships } = await admin
      .from('household_members').select('household_id').eq('user_id', user.id)

    for (const { household_id } of memberships ?? []) {
      const { data: hh } = await admin
        .from('households').select('owner_id').eq('id', household_id).maybeSingle()
      if (!hh || hh.owner_id === user.id) continue // household is going away with the user

      await admin.from('food_items')
        .update({ user_id: hh.owner_id })
        .eq('household_id', household_id).eq('user_id', user.id)
      await admin.from('household_shopping_list')
        .update({ added_by: hh.owner_id })
        .eq('household_id', household_id).eq('added_by', user.id)
    }

    // ── Delete the auth user; FK cascades remove everything else ────────────
    const { error: delErr } = await admin.auth.admin.deleteUser(user.id)
    if (delErr) throw delErr

    return json({ ok: true })
  } catch (e) {
    console.error('[delete-account]', e)
    return json({ error: 'Could not delete account. Please try again or contact support@gogood.app.' }, 500)
  }
})
