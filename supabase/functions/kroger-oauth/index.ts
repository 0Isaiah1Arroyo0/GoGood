import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const KROGER_TOKEN_URL = 'https://api.kroger.com/v1/connect/oauth2/token'

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

    const clientId     = Deno.env.get('KROGER_CLIENT_ID') ?? ''
    const clientSecret = Deno.env.get('KROGER_CLIENT_SECRET') ?? ''
    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: 'Kroger API not configured. Add KROGER_CLIENT_ID and KROGER_CLIENT_SECRET to Supabase secrets.' }), { status: 503, headers: cors })
    }

    const { action, code, redirectUri } = await req.json()
    const basicAuth = btoa(`${clientId}:${clientSecret}`)

    if (action === 'exchange') {
      const params = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
      const tokenRes = await fetch(KROGER_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basicAuth}` },
        body: params.toString(),
      })
      const tokens = await tokenRes.json()
      if (!tokens.access_token) return new Response(JSON.stringify({ error: 'Token exchange failed', detail: tokens }), { status: 400, headers: cors })

      const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 1800) * 1000).toISOString()
      await supabase.from('store_connections').upsert({
        user_id:              user.id,
        store:                'kroger',
        oauth_access_token:   tokens.access_token,
        oauth_refresh_token:  tokens.refresh_token,
        oauth_expires_at:     expiresAt,
      }, { onConflict: 'user_id,store' })

      return new Response(JSON.stringify({ ok: true, expiresAt }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    if (action === 'refresh') {
      const { data: conn } = await supabase.from('store_connections').select('oauth_refresh_token').eq('user_id', user.id).eq('store', 'kroger').single()
      if (!conn?.oauth_refresh_token) return new Response(JSON.stringify({ error: 'No Kroger connection found' }), { status: 404, headers: cors })

      const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.oauth_refresh_token })
      const tokenRes = await fetch(KROGER_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basicAuth}` },
        body: params.toString(),
      })
      const tokens = await tokenRes.json()
      if (!tokens.access_token) return new Response(JSON.stringify({ error: 'Refresh failed' }), { status: 400, headers: cors })

      const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 1800) * 1000).toISOString()
      await supabase.from('store_connections').update({
        oauth_access_token:  tokens.access_token,
        oauth_refresh_token: tokens.refresh_token ?? conn.oauth_refresh_token,
        oauth_expires_at:    expiresAt,
      }).eq('user_id', user.id).eq('store', 'kroger')

      return new Response(JSON.stringify({ ok: true, expiresAt }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: cors })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})
