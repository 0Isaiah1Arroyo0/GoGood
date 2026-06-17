import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const KROGER_API = 'https://api.kroger.com/v1'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors })

    const { daysBack = 7 } = await req.json().catch(() => ({}))

    // Load Kroger connection
    const { data: conn } = await supabase.from('store_connections')
      .select('oauth_access_token, oauth_refresh_token, oauth_expires_at')
      .eq('user_id', user.id).eq('store', 'kroger').single()

    if (!conn) return new Response(JSON.stringify({ error: 'No Kroger account connected' }), { status: 404, headers: cors })

    // Refresh token if expired
    let accessToken = conn.oauth_access_token
    if (conn.oauth_expires_at && new Date(conn.oauth_expires_at) < new Date()) {
      const refreshRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/kroger-oauth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ action: 'refresh' })
      })
      if (refreshRes.ok) {
        const { data: updated } = await supabase.from('store_connections')
          .select('oauth_access_token').eq('user_id', user.id).eq('store', 'kroger').single()
        accessToken = updated?.oauth_access_token ?? accessToken
      }
    }

    // Fetch recent Kroger orders
    const since = new Date(Date.now() - daysBack * 86400000).toISOString()
    const ordersRes = await fetch(`${KROGER_API}/orders?filter.status=COMPLETED&filter.start=${since}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
    })

    if (!ordersRes.ok) {
      return new Response(JSON.stringify({ error: 'Kroger API error', status: ordersRes.status }), { status: 502, headers: cors })
    }

    const ordersData = await ordersRes.json()
    const orders = ordersData?.data ?? []

    if (orders.length === 0) {
      return new Response(JSON.stringify({ sessionId: null, items: [], message: 'No recent orders found' }), {
        headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    // Get existing draft store_order_ids to deduplicate
    const { data: existingDrafts } = await supabase.from('draft_items')
      .select('store_order_id').eq('user_id', user.id).eq('source', 'kroger').not('store_order_id', 'is', null)
    const existingOrderIds = new Set((existingDrafts ?? []).map((d: any) => d.store_order_id))

    const sessionId = crypto.randomUUID()
    const rows: any[] = []

    for (const order of orders) {
      for (const line of order.orderLines ?? []) {
        const orderId = `${order.id}-${line.upc ?? line.productId}`
        if (existingOrderIds.has(orderId)) continue

        const name = line.description ?? line.productDescription ?? 'Unknown Item'
        const qty = line.quantity ?? 1
        const category = guessCategory(name)

        // Best-effort USDA nutrition
        let protein = 0, carbs = 0, fat = 0, cal = 0
        try {
          const apiKey = Deno.env.get('USDA_API_KEY') ?? 'DEMO_KEY'
          const r = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(name)}&api_key=${apiKey}&pageSize=1&dataType=SR%20Legacy,Foundation`)
          const d = await r.json()
          const food = d?.foods?.[0]
          if (food) {
            const get = (n: string) => food.foodNutrients?.find((fn: any) => fn.nutrientName?.toLowerCase().includes(n))?.value ?? 0
            protein = Math.round(get('protein') * 10) / 10
            carbs   = Math.round(get('carbohydrate') * 10) / 10
            fat     = Math.round(get('total lipid') * 10) / 10
            cal     = Math.round(get('energy'))
          }
        } catch { /* non-fatal */ }

        rows.push({
          user_id:         user.id,
          source:          'kroger',
          name,
          base_name:       name,
          qty_num:         qty,
          unit:            'count',
          category,
          protein,
          carbs,
          fat,
          cal,
          scan_session_id: sessionId,
          store_name:      'Kroger',
          store_order_id:  orderId,
        })
      }
    }

    if (rows.length > 0) {
      await supabase.from('draft_items').insert(rows)
      await supabase.from('store_connections').update({ last_sync_at: new Date().toISOString() }).eq('user_id', user.id).eq('store', 'kroger')
    }

    return new Response(JSON.stringify({ sessionId, items: rows }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})

function guessCategory(name: string): 'fridge' | 'freezer' | 'pantry' {
  const n = name.toLowerCase()
  if (/frozen|ice cream|popsicle|freezer/.test(n)) return 'freezer'
  if (/milk|cheese|yogurt|butter|egg|meat|chicken|beef|pork|fish|salmon|shrimp|deli|produce|lettuce|spinach|broccoli|carrot|berry|berries/.test(n)) return 'fridge'
  return 'pantry'
}
