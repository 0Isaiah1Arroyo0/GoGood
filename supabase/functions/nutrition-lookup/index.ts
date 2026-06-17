import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { query } = await req.json()
    if (!query) return new Response(JSON.stringify({ error: 'query required' }), { status: 400, headers: cors })

    const apiKey = Deno.env.get('USDA_API_KEY') ?? 'DEMO_KEY'
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&api_key=${apiKey}&pageSize=1&dataType=SR%20Legacy,Foundation`
    const res = await fetch(url)
    const data = await res.json()
    const food = data?.foods?.[0]

    if (!food) return new Response(JSON.stringify(null), { headers: { ...cors, 'Content-Type': 'application/json' } })

    const get = (n: string) => food.foodNutrients?.find((fn: any) => fn.nutrientName?.toLowerCase().includes(n))?.value ?? 0

    return new Response(JSON.stringify({
      name:        food.description,
      protein:     Math.round(get('protein') * 10) / 10,
      carbs:       Math.round(get('carbohydrate') * 10) / 10,
      fat:         Math.round(get('total lipid') * 10) / 10,
      cal:         Math.round(get('energy')),
      servingSize: food.servingSize ? `${food.servingSize}${food.servingSizeUnit ?? 'g'}` : '100g',
    }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})
