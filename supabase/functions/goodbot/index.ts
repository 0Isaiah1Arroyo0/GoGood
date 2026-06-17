import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { messages, systemPrompt, householdId } = await req.json()

    let fullSystemPrompt = systemPrompt

    // Append shared household recipes so Good Bot can reference what the household already loves
    if (householdId) {
      try {
        const authHeader = req.headers.get('Authorization')
        if (authHeader) {
          const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
          )
          const { data: sharedRecipes } = await supabase
            .from('saved_recipes')
            .select('name')
            .eq('household_id', householdId)
            .eq('shared_with_household', true)
            .limit(20)

          if (sharedRecipes && sharedRecipes.length > 0) {
            const names = sharedRecipes.map((r: any) => `- ${r.name}`).join('\n')
            fullSystemPrompt += `\n\nHOUSEHOLD SAVED RECIPES (recipes this household already loves — you may suggest variations):\n${names}`
          }
        }
      } catch { /* non-fatal — household context is best-effort */ }
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: fullSystemPrompt,
        messages,
      }),
    })

    const data = await anthropicRes.json()
    return new Response(JSON.stringify(data), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
