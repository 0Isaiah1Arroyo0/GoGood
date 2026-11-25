// Who has Pro, checked on the server with RevenueCat (never trusted from the app).
//
// A user has Pro when either
//   * they have any active entitlement themselves ("own"), or
//   * they're the partner in a household whose owner has the Household plan
//     (the "household" entitlement) — "household".
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RC_SECRET  = Deno.env.get('REVENUECAT_SECRET_KEY') ?? ''   // v2 secret key, read-only
const RC_PROJECT = Deno.env.get('REVENUECAT_PROJECT_ID') ?? ''
const HOUSEHOLD_KEY = 'household'
const RC = 'https://api.revenuecat.com/v2'

export type ProStatus = {
  pro: boolean
  via: 'own' | 'household' | null
  annual: boolean          // on a yearly plan
  householdPlan: boolean   // this user pays for the Household plan
}

const rc = (path: string) =>
  fetch(`${RC}/projects/${RC_PROJECT}${path}`, { headers: { Authorization: `Bearer ${RC_SECRET}` } })

// Entitlement and product ids → their readable keys (cached while the function is warm)
let lookups: Promise<{ ent: Map<string, string>; prod: Map<string, string> }> | null = null
function getLookups() {
  lookups ??= (async () => {
    const ent = new Map<string, string>(), prod = new Map<string, string>()
    try {
      const e = await (await rc('/entitlements?limit=50')).json()
      for (const x of e?.items ?? []) ent.set(x.id, String(x.lookup_key ?? '').toLowerCase())
      const p = await (await rc('/products?limit=100')).json()
      for (const x of p?.items ?? []) prod.set(x.id, String(x.store_identifier ?? '').toLowerCase())
    } catch { lookups = null }
    return { ent, prod }
  })()
  return lookups
}

type Own = { active: boolean; household: boolean; annual: boolean } | null   // null = couldn't check

async function ownAccess(userId: string): Promise<Own> {
  try {
    const r = await rc(`/customers/${encodeURIComponent(userId)}/active_entitlements`)
    if (r.status === 404) return { active: false, household: false, annual: false }
    if (!r.ok) return null
    const items: any[] = (await r.json())?.items ?? []
    if (!items.length) return { active: false, household: false, annual: false }
    const { ent, prod } = await getLookups()
    const household = items.some(i => ent.get(i.entitlement_id) === HOUSEHOLD_KEY)
    // Yearly if any active subscription's product looks like a yearly one
    let annual = false
    try {
      const subs = await (await rc(`/customers/${encodeURIComponent(userId)}/subscriptions?limit=20`)).json()
      annual = (subs?.items ?? []).some((s: any) => s.gives_access && /year|annual/.test(prod.get(s.product_id) ?? ''))
    } catch { /* treat as monthly */ }
    return { active: true, household, annual }
  } catch {
    return null
  }
}

export async function proStatus(userId: string): Promise<ProStatus> {
  // Without RevenueCat configured, don't lock anyone out
  if (!RC_SECRET || !RC_PROJECT) return { pro: true, via: 'own', annual: true, householdPlan: false }

  const own = await ownAccess(userId)
  if (own === null) return { pro: true, via: 'own', annual: false, householdPlan: false } // RevenueCat hiccup
  if (own.active) return { pro: true, via: 'own', annual: own.annual, householdPlan: own.household }

  // A partner in someone else's household: Pro if the owner has the Household plan
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const { data: m } = await admin
    .from('household_members')
    .select('household_id, households!inner(owner_id)')
    .eq('user_id', userId)
    .neq('role', 'owner')
    .limit(1)
    .maybeSingle()
  const ownerId = (m as any)?.households?.owner_id
  if (ownerId && ownerId !== userId) {
    const owner = await ownAccess(ownerId)
    if (owner?.household) return { pro: true, via: 'household', annual: owner.annual, householdPlan: false }
  }
  return { pro: false, via: null, annual: false, householdPlan: false }
}
