import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { proStatus } from '../_shared/pro.ts'

// Tells the app whether the signed-in user has Pro, including Pro shared by a
// partner's Household plan (the app can't see someone else's subscription).

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const authHeader = req.headers.get('Authorization') ?? ''
  const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '')
  const { data: { user } } = await client.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
  if (!user) return json({ error: 'Please sign in.' }, 401)
  try {
    return json(await proStatus(user.id))
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
