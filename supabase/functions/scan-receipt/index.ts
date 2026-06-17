import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ParsedItem {
  name: string
  qty: number
  unit: string
  estimatedCategory: 'fridge' | 'freezer' | 'pantry'
  icon: string
  estimatedExpiryDays: number | null
  sku: string | null  // 5-15 digit item number/UPC if visible on receipt
}

interface NutritionData {
  name?: string
  protein: number
  carbs: number
  fat: number
  cal: number
  source: 'upc' | 'off_search' | 'usda' | 'none'
}

// Look up a product by UPC/EAN via Open Food Facts (free, no API key)
async function lookupByUPC(upc: string): Promise<NutritionData | null> {
  try {
    const r = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${upc}?fields=product_name,brands,nutriments`,
      { signal: AbortSignal.timeout(5000) }
    )
    if (!r.ok) return null
    const d = await r.json()
    if (d.status !== 1 || !d.product) return null

    const p = d.product
    const n = p.nutriments ?? {}

    const productName = p.product_name?.trim()
    const brand       = p.brands?.split(',')[0]?.trim()
    const name = productName
      ? (brand && !productName.toLowerCase().includes(brand.toLowerCase())
          ? `${brand} ${productName}`
          : productName)
      : undefined

    return {
      name,
      protein: n.proteins_100g        != null ? Math.round(n.proteins_100g        * 10) / 10 : 0,
      carbs:   n.carbohydrates_100g   != null ? Math.round(n.carbohydrates_100g   * 10) / 10 : 0,
      fat:     n.fat_100g             != null ? Math.round(n.fat_100g             * 10) / 10 : 0,
      cal:     n['energy-kcal_100g']  != null ? Math.round(n['energy-kcal_100g'])           : 0,
      source: 'upc',
    }
  } catch {
    return null
  }
}

// Open Food Facts text search — better than USDA for branded packaged goods
async function lookupByNameOFF(name: string): Promise<NutritionData | null> {
  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(name)}&search_simple=1&action=process&json=1&page_size=1&fields=product_name,brands,nutriments&lc=en&cc=us`
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) return null
    const d = await r.json()
    const p = d?.products?.[0]
    if (!p) return null

    const n = p.nutriments ?? {}
    const productName = p.product_name?.trim()
    const brand       = p.brands?.split(',')[0]?.trim()
    const resolvedName = productName
      ? (brand && !productName.toLowerCase().includes(brand.toLowerCase())
          ? `${brand} ${productName}`
          : productName)
      : undefined

    return {
      name: resolvedName,
      protein: n.proteins_100g        != null ? Math.round(n.proteins_100g        * 10) / 10 : 0,
      carbs:   n.carbohydrates_100g   != null ? Math.round(n.carbohydrates_100g   * 10) / 10 : 0,
      fat:     n.fat_100g             != null ? Math.round(n.fat_100g             * 10) / 10 : 0,
      cal:     n['energy-kcal_100g']  != null ? Math.round(n['energy-kcal_100g'])           : 0,
      source: 'off_search',
    }
  } catch {
    return null
  }
}

// USDA fallback for unbranded/fresh items (produce, meat, eggs, etc.)
async function lookupByNameUSDA(name: string): Promise<NutritionData | null> {
  try {
    const apiKey = Deno.env.get('USDA_API_KEY') ?? 'DEMO_KEY'
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(name)}&api_key=${apiKey}&pageSize=1&dataType=SR%20Legacy,Foundation`
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (!r.ok) return null
    const d = await r.json()
    const food = d?.foods?.[0]
    if (!food) return null

    const get = (term: string) =>
      food.foodNutrients?.find((fn: any) => fn.nutrientName?.toLowerCase().includes(term))?.value ?? 0

    return {
      protein: Math.round(get('protein')       * 10) / 10,
      carbs:   Math.round(get('carbohydrate')  * 10) / 10,
      fat:     Math.round(get('total lipid')   * 10) / 10,
      cal:     Math.round(get('energy')),
      source: 'usda',
    }
  } catch {
    return null
  }
}

interface WalmartProduct {
  itemId: number
  name: string
  upc?: string
}

// Batch-lookup Walmart item IDs and return a map of itemId → product info
async function walmartBatchLookup(skus: string[]): Promise<{ results: Map<string, WalmartProduct>; debug: string[] }> {
  const results = new Map<string, WalmartProduct>()
  const debug: string[] = []

  const consumerId    = Deno.env.get('WALMART_CONSUMER_ID')
  const privateKeyRaw = Deno.env.get('WALMART_PRIVATE_KEY')

  if (!consumerId) { debug.push('WALMART_CONSUMER_ID not set'); return { results, debug } }
  if (!privateKeyRaw) { debug.push('WALMART_PRIVATE_KEY not set'); return { results, debug } }
  if (skus.length === 0) { debug.push('no short SKUs to look up'); return { results, debug } }

  debug.push(`walmart creds present, looking up ${skus.length} SKU(s): ${skus.join(', ')}`)

  // Decode PKCS8 PEM (handles stored-as-single-line with literal \n escapes)
  const pem = privateKeyRaw.replace(/\\n/g, '\n')
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '')

  let privateKey: CryptoKey
  try {
    const keyBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    privateKey = await crypto.subtle.importKey(
      'pkcs8', keyBytes,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['sign']
    )
    debug.push('private key imported OK')
  } catch (e) {
    debug.push(`private key import failed: ${(e as Error).message}`)
    return { results, debug }
  }

  const enc = new TextEncoder()
  const keyVersion = '1'

  for (let i = 0; i < skus.length; i += 20) {
    const batch = skus.slice(i, i + 20)
    const timestamp = String(Date.now())
    // Walmart auth: consumerId\ntimestamp\nkeyVersion\n
    const stringToSign = `${consumerId}\n${timestamp}\n${keyVersion}\n`
    const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(stringToSign))
    const signature = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))

    const url = `https://developer.api.walmart.com/api-proxy/service/affil/product/v2/items?ids=${batch.join(',')}`
    debug.push(`GET ${url}`)

    try {
      const r = await fetch(url, {
        headers: {
          'WM_CONSUMER.ID':          consumerId,
          'WM_SEC.AUTH_SIGNATURE':   signature,
          'WM_CONSUMER.INTIMESTAMP': timestamp,
          'WM_SEC.KEY_VERSION':      keyVersion,
          'Accept':                  'application/json',
        },
        signal: AbortSignal.timeout(8000),
      })

      const responseText = await r.text()
      debug.push(`walmart status ${r.status}: ${responseText.slice(0, 200)}`)

      if (!r.ok) continue
      const d = JSON.parse(responseText)
      for (const wi of (d?.items ?? []) as WalmartProduct[]) {
        results.set(String(wi.itemId), wi)
      }
      debug.push(`walmart returned ${d?.items?.length ?? 0} item(s)`)
    } catch (e) {
      debug.push(`walmart fetch error: ${(e as Error).message}`)
    }
  }

  return { results, debug }
}

// Try to extract a clean JSON array from Claude's response text
function extractJsonArray(text: string): any[] | null {
  // Direct match
  const direct = text.match(/\[[\s\S]*\]/)
  if (direct) {
    try {
      const parsed = JSON.parse(direct[0])
      if (Array.isArray(parsed)) return parsed
    } catch { /* fall through */ }
  }

  // Strip any markdown fences and retry
  const stripped = text.replace(/```(?:json)?/gi, '').trim()
  const stripped2 = stripped.match(/\[[\s\S]*\]/)
  if (stripped2) {
    try {
      const parsed = JSON.parse(stripped2[0])
      if (Array.isArray(parsed)) return parsed
    } catch { /* fall through */ }
  }

  // Last resort: find first [ ... ] block even if text around it
  const start = text.indexOf('[')
  const end   = text.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      if (Array.isArray(parsed)) return parsed
    } catch { /* give up */ }
  }

  return null
}

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

    const { imageBase64, mimeType = 'image/jpeg', storeName } = await req.json()
    if (!imageBase64) return new Response(JSON.stringify({ error: 'imageBase64 required' }), { status: 400, headers: cors })

    const systemPrompt = `You are a grocery receipt parser for US retail stores (Walmart, Kroger, Target, Publix, Costco, Sam's Club, etc.).
Extract ONLY the food and beverage line items from the receipt image.
Return ONLY a valid JSON array — no markdown, no explanation, nothing else.

Each object must have exactly these fields:
- name: string (full clean product name — expand ALL abbreviations)
- qty: number (quantity purchased, default 1)
- unit: string (lbs, oz, kg, count, pack, bag, box, bottle, can, jar — default "count")
- estimatedCategory: "fridge" | "freezer" | "pantry"
- icon: string (single emoji best representing the item)
- estimatedExpiryDays: number | null (typical shelf-life days from purchase; null for indefinitely shelf-stable items)
- sku: string | null (the item number/barcode printed on the receipt — see SKU DETECTION below)

SKU DETECTION — CRITICAL FOR ITEM LOOKUP:
Walmart, Target, Kroger, and most US retail receipts print item identifier numbers that help with product lookup.
- These appear as standalone number sequences printed on the receipt near or below the item description
- Walmart: prints a 12-digit UPC-A (e.g. "004900001234") below each item or in a code column
- Kroger: prints item codes that are often 12-digit UPCs
- Target: sometimes prints a DPCI (XXX-XX-XXXX format) — record it without dashes
- Capture ANY number sequence of 5-15 consecutive digits that appears to be an item identifier
- If the number has spaces or dashes, remove them and record the digits only
- Do NOT capture: prices, tax codes, dates, phone numbers, register numbers
- If multiple numbers appear near an item, pick the longest one (most likely to be UPC)
- Even if you're unsure whether it's a UPC vs store SKU, record it — we'll look it up
- Set sku to null only if no item number appears near that line

WALMART RECEIPT SPECIFICS:
- Tax codes after price: F = food (capture), T = taxable non-food (skip unless beverage), X = taxable food (capture)
- Great Value = GV or GRT VALUE or GRT VLU; Marketside = MM or MKTSIDE; Sam's Choice = SH or SAMS CH
- Weight items: "BANA .76 LB @.57/LB" → name="Bananas", qty=0.76, unit="lbs"
- Multi-packs: "2/ $5.00 YOGURT" → qty=2, unit="count"
- Item numbers on Walmart receipts are 12 digits and appear below the item description

ICON GUIDE (pick the most specific emoji):
🥩 beef/steak/brisket/lamb/veal/meatball  🥓 pork/bacon/ham/salami/chorizo  🌭 sausage/hot dog
🍗 chicken/turkey/duck  🐟 fish/salmon/tuna/tilapia/cod  🦐 shrimp/prawns
🥚 eggs  🥛 milk/cream/oat milk/kefir  🧀 cheese  🧈 butter/ghee
🥦 broccoli/cauliflower  🥬 spinach/kale/lettuce/greens  🥕 carrot  🍅 tomato
🧅 onion/shallot  🧄 garlic  🥔 potato  🍠 sweet potato  🫑 bell pepper
🌽 corn  🥒 cucumber/zucchini  🍆 eggplant  🥑 avocado  🍄 mushroom
🍎 apple  🍌 banana  🍊 orange  🍋 lemon/lime  🍓 strawberry  🫐 blueberry
🍇 grapes  🍉 watermelon  🥭 mango  🍍 pineapple  🥝 kiwi  🍑 peach/plum
🍞 bread  🥖 baguette  🥯 bagel  🫓 tortilla/pita/flatbread
🍝 pasta/spaghetti/penne  🍜 noodles/ramen  🍚 rice/quinoa/grains
🥣 oats/cereal/granola  🫘 beans/lentils/chickpeas  🥜 nuts/seeds/nut butters
🫙 condiment/sauce/spread/jar  🫒 olive oil/olives  🍯 honey/syrup/jam
🧃 juice/smoothie  ☕ coffee  🍵 tea  🥤 sports drink/protein shake
🥫 canned goods  🌿 fresh herbs  🧂 salt  🧊 frozen items  🍫 chocolate
🍪 cookies/crackers  🍦 ice cream  🥘 anything else

EXPIRY GUIDE (estimatedExpiryDays from day of purchase):
Raw chicken/turkey/ground meat: 2  Raw fish/seafood: 2  Raw beef/pork/lamb: 3
Deli meat/hot dogs: 7  Bacon: 7  Rotisserie chicken: 4
Fresh milk: 10  Eggs: 35  Butter: 30  Sour cream/cream cheese: 21
Greek yogurt: 21  Cottage cheese: 14  Ricotta: 7  Brie/soft cheese: 14
Hard cheese opened: 30  Parmesan: 45  Heavy cream: 14
Broccoli/cauliflower/asparagus: 5  Spinach/kale/baby greens: 5
Mushrooms: 7  Bell peppers: 10  Carrots: 21  Celery: 14
Tomatoes: 7  Cucumbers: 10  Avocado ripe: 3  Avocado firm: 7
Strawberries/blueberries/raspberries: 5  Grapes: 10  Citrus: 21
Bananas: 5  Peaches/plums: 5  Apples/pears: 30
Potatoes whole: 60  Onions whole: 30  Garlic whole: 90
Bread/sourdough: 5  Tortillas flour: 14  Bagels: 5
OJ/fresh juice: 10  Hummus: 10  Guacamole: 3
Frozen meat/fish: 120  Frozen vegetables: 180  Frozen meals: 90  Frozen fruit: 90  Ice cream: 60
Canned goods: 730  Dried pasta/rice/grains: 730
Peanut butter/nut butters: 90  Jam/jelly: 180  Ketchup/mustard: 365
Soy sauce/vinegar/hot sauce: 365  Olive oil: 365
Coffee beans/grounds: 45  Tea: 180
null → honey, salt, sugar, dried spices, pure vinegar, shelf-stable spirits

ABBREVIATION EXPANSION:
GV / GRT VLU / GRT VALUE → Great Value  EQ / EQUATE → Equate — SKIP (health/beauty)
MM / MKTSIDE → Marketside  SH / SAMS CH → Sam's Choice  ORG → Organic
FC / FRSH → Fresh  WHL → Whole  CHKN → Chicken  BRST → Breast
GRND → Ground  BNLS → Boneless  SKNLS → Skinless  MLK → Milk
CHZ / CHS → Cheese  SLCD → Sliced  SHRDD → Shredded  YGT / YGRT → Yogurt
BANA → Bananas  STRWB → Strawberries  BLUB → Blueberries  SPIN → Spinach
TOMTO → Tomatoes  BRKL → Broccoli  OJ → Orange Juice  APPL → Apple
BRTR / BTTR → Butter  ITAL → Italian  LG → Large  SM → Small
MSHRM → Mushroom  AVCD → Avocado  RSTD → Roasted  FF → Fat Free

PARSING RULES:
- SKIP: cleaning products, paper goods, personal care, health & beauty, pharmacy, electronics, clothing, gift cards
- SKIP: subtotals, taxes, discounts, coupons, savings, bag fees, loyalty card lines, cashier lines, header/footer
- estimatedCategory: frozen → "freezer"; dairy/produce/meat/deli → "fridge"; everything else → "pantry"
- If you cannot identify any food items clearly, return []`

    let items: ParsedItem[] = []
    let rawClaudeText = ''
    let attempts = 0

    while (attempts < 2) {
      attempts++
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{
            role: 'user',
            content: [{
              type: 'image',
              source: { type: 'base64', media_type: mimeType, data: imageBase64 }
            }, {
              type: 'text',
              text: attempts === 1
                ? `Parse all grocery food items from this receipt${storeName ? ` from ${storeName}` : ''}. For each item, look for any number sequence (5-15 digits) near that item line and record it as the sku field — this helps us look up exact nutrition data. Return only the JSON array.`
                : 'Parse this receipt. Return ONLY the JSON array starting with [ and ending with ]. Each item: name, qty, unit, estimatedCategory, icon, estimatedExpiryDays, sku.',
            }]
          }]
        })
      })

      if (!anthropicRes.ok) {
        const errText = await anthropicRes.text()
        rawClaudeText = `API error ${anthropicRes.status}: ${errText}`
        continue
      }

      const anthropicData = await anthropicRes.json()
      rawClaudeText = anthropicData?.content?.[0]?.text ?? ''

      const parsed = extractJsonArray(rawClaudeText)
      if (parsed && parsed.length > 0) {
        items = parsed.filter((i: any) => i.name && typeof i.name === 'string')
        if (items.length > 0) break
      }
    }

    if (items.length === 0) {
      return new Response(JSON.stringify({
        sessionId: null,
        items: [],
        error: 'Could not parse receipt',
        debug: rawClaudeText.slice(0, 500),
      }), {
        headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    // Log every extracted SKU so we can see what Claude pulled from the receipt
    const skuSummary = items.map(i => `${i.name}: sku=${i.sku ?? 'null'}`).join(' | ')
    console.log('[scan-receipt] extracted SKUs:', skuSummary)

    // Collect short SKUs (Walmart item IDs, not full 12/13-digit UPCs)
    const shortSkus = [...new Set(
      items
        .map(i => i.sku?.replace(/\D/g, '') ?? null)
        .filter((s): s is string => s !== null && /^\d{5,11}$/.test(s))
    )]
    console.log('[scan-receipt] short SKUs for Walmart:', shortSkus)

    const { results: walmartResults, debug: walmartDebug } = await walmartBatchLookup(shortSkus)
    console.log('[scan-receipt] walmart debug:', walmartDebug.join(' | '))

    // Enrich each item: Walmart SKU → UPC lookup → OFF text search → USDA fallback
    const enriched = await Promise.all(items.map(async (item) => {
      const rawSku = item.sku?.replace(/\D/g, '') ?? null

      // Try as UPC-A (12 digits) or EAN-13 (13 digits) first
      const validUpc = rawSku && /^\d{12,13}$/.test(rawSku) ? rawSku : null

      // For short SKUs, check if Walmart resolved it to a product with a UPC
      const walmartItem = rawSku && !validUpc ? walmartResults.get(rawSku) : null
      const walmartUpc  = walmartItem?.upc?.replace(/\D/g, '') ?? null
      const effectiveUpc = validUpc ?? (walmartUpc && /^\d{12,13}$/.test(walmartUpc) ? walmartUpc : null)

      // Use Walmart product name when available (more accurate than receipt abbreviations)
      const searchName = walmartItem?.name ?? item.name

      let nutrition: NutritionData | null = null

      if (effectiveUpc) {
        nutrition = await lookupByUPC(effectiveUpc)
      }

      // OFF text search using the best available name
      if (!nutrition) {
        nutrition = await lookupByNameOFF(searchName)
      }

      // USDA as last resort (good for fresh/unbranded: produce, meat, eggs)
      if (!nutrition || (nutrition.cal === 0 && nutrition.protein === 0)) {
        const usda = await lookupByNameUSDA(searchName)
        if (usda && (usda.cal > 0 || usda.protein > 0)) {
          nutrition = usda
        }
      }

      // Name priority: Walmart product name > UPC-resolved name > original Claude name
      const bestName = walmartItem?.name
        ?? ((nutrition?.source === 'upc' && nutrition.name) ? nutrition.name : item.name)

      return {
        ...item,
        name:    bestName,
        protein: nutrition?.protein ?? 0,
        carbs:   nutrition?.carbs   ?? 0,
        fat:     nutrition?.fat     ?? 0,
        cal:     nutrition?.cal     ?? 0,
        resolvedSku:     effectiveUpc ?? rawSku,
        nutritionSource: nutrition?.source ?? 'none',
      }
    }))

    const today = new Date()
    const toExpiryDate = (days: number | null): string | null => {
      if (!days || days <= 0) return null
      const d = new Date(today)
      d.setDate(d.getDate() + days)
      return d.toISOString().slice(0, 10)
    }

    const sessionId = crypto.randomUUID()
    const rows = enriched.map(item => ({
      user_id:         user.id,
      source:          'receipt' as const,
      name:            item.name,
      base_name:       item.name,
      icon:            item.icon ?? '🥘',
      qty_num:         item.qty ?? 1,
      unit:            item.unit ?? 'count',
      category:        item.estimatedCategory ?? 'fridge',
      food_category:   null,
      expiry_date:     toExpiryDate((item as any).estimatedExpiryDays ?? null),
      protein:         item.protein ?? 0,
      carbs:           item.carbs   ?? 0,
      fat:             item.fat     ?? 0,
      cal:             item.cal     ?? 0,
      scan_session_id: sessionId,
      store_name:      storeName ?? null,
    }))

    await supabase.from('draft_items').insert(rows)

    const debugSummary = {
      skusExtracted: items.map(i => ({ name: i.name, sku: i.sku })),
      shortSkus,
      walmart: walmartDebug,
      enriched: enriched.map(i => ({ name: i.name, source: i.nutritionSource, sku: i.resolvedSku })),
    }
    console.log('[scan-receipt] done:', JSON.stringify(debugSummary))

    return new Response(JSON.stringify({ sessionId, items: rows, _debug: debugSummary }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})
