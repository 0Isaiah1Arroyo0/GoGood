import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { proStatus } from '../_shared/pro.ts'

// Picture scans per calendar month: receipts, photos, several labels, and a single
// label when the phone couldn't read the date itself. Barcodes don't count (they're
// a free database lookup, no AI).
const PRO_MONTHLY_SCANS  = 60
const FREE_MONTHLY_SCANS = 5

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
  nutrition?: { cal?: number; protein?: number; carbs?: number; fat?: number } | null // AI estimate per 100 g
}

interface NutritionData {
  name?: string
  protein: number
  carbs: number
  fat: number
  cal: number
  source: 'upc' | 'off_search' | 'usda' | 'ai_estimate' | 'none'
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

// The image's real format, read from its first bytes (the label sent by the app can
// be wrong — e.g. PNG screenshots labeled as JPEG — and the API rejects mismatches).
function detectImageType(b64: string, fallback: string): string {
  if (b64.startsWith('/9j/'))   return 'image/jpeg'
  if (b64.startsWith('iVBOR'))  return 'image/png'
  if (b64.startsWith('R0lGOD')) return 'image/gif'
  if (b64.startsWith('UklGR'))  return 'image/webp'
  return fallback
}

// Nutrition databases rarely match a full product name like "Too Good & Co. Blended
// Vanilla Yogurt 32 oz", so also try shorter, more generic versions of it.
const KNOWN_BRANDS = [
  'great value', 'freshness guaranteed', 'marketside', "sam's choice", 'equate', 'member\'s mark',
  'kirkland signature', 'good & gather', 'market pantry', 'kroger', 'simple truth', 'private selection',
  'o organics', 'signature select', '365', 'trader joe\'s',
]
function simplerNames(name: string): string[] {
  let n = name.toLowerCase()
    .replace(/\b\d+(\.\d+)?\s*(fl\.?\s*oz|oz|lbs?|ct|count|pk|pack|g|kg|ml|l|gal|qt|pt)\b/g, ' ') // sizes
    .replace(/\b\d+(\.\d+)?\s*%\s*\w*/g, ' ')                                                    // 2% milkfat
    .replace(/[^a-z' &-]/g, ' ').replace(/\s+/g, ' ').trim()
  const out: string[] = []
  if (n && n !== name.toLowerCase()) out.push(n)
  for (const b of KNOWN_BRANDS) {
    if (n.startsWith(b + ' ')) { n = n.slice(b.length).trim(); out.push(n); break }
  }
  // Drop a leading brand-like chunk ending in "&" or "co" (e.g. "too good & co")
  const noCo = n.replace(/^.*?\b(co|inc|company)\b\.?\s+/, '')
  if (noCo !== n && noCo.split(' ').length >= 1) out.push(noCo)
  const words = n.split(' ').filter(w => w.length > 1 && !['and', 'the', 'with', 'organic', 'natural', 'original', 'all'].includes(w))
  if (words.length > 3) out.push(words.slice(-3).join(' '))
  if (words.length > 2) out.push(words.slice(-2).join(' '))
  return [...new Set(out.filter(x => x.length >= 3))]
}

// Barcode databases sometimes prefix names with a missing brand ("None Broccoli").
function cleanProductName(name: string): string {
  return name.replace(/^(none|null|undefined|n\/a)\s+/i, '').replace(/\s{2,}/g, ' ').trim()
}

// True when two product names share a meaningful word (ignores tiny words and plurals).
function namesOverlap(a: string, b: string): boolean {
  const words = (s: string) => new Set(
    s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
      .filter(w => w.length >= 4).map(w => w.replace(/(es|s)$/, ''))
  )
  const wa = words(a), wb = words(b)
  for (const w of wa) if (wb.has(w)) return true
  return false
}

// The API accepts images up to about 5 MB each.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

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
    } catch { /* fall through */ }
  }

  // Cut-off response (e.g. a very long receipt hit the output limit): keep every
  // complete item object and drop the half-written one at the end.
  if (start !== -1) {
    let cut = text.lastIndexOf('}')
    while (cut > start) {
      try {
        const parsed = JSON.parse(text.slice(start, cut + 1) + ']')
        if (Array.isArray(parsed)) return parsed
      } catch { /* try the previous closing brace */ }
      cut = text.lastIndexOf('}', cut - 1)
    }
  }

  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  let counted = false
  let refundScan: () => Promise<void> = async () => {}

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

    const {
      imageBase64: rawBase64, mimeType: claimedType = 'image/jpeg', storeName,
      mode = 'receipt',          // 'receipt' | 'photo' (items in a fridge/pantry/counter) | 'labels' (several product labels) | 'expiry' (one label's date)
      locationHint = null,       // 'fridge' | 'freezer' | 'pantry' when the user says where the photo was taken
      ocrText = null,            // text the phone already read from the photo (Apple Vision / ML Kit), if available
    } = await req.json()
    const isLabels = mode === 'labels'
    const isPhoto = mode === 'photo' || isLabels   // both are pictures of products, not receipts
    const todayStr = new Date().toISOString().slice(0, 10)
    if (!rawBase64) return new Response(JSON.stringify({ error: 'imageBase64 required' }), { status: 400, headers: cors })

    // Strip a data-URL prefix or line breaks if present, then check format and size
    const imageBase64 = String(rawBase64).replace(/^data:[^,]+,/, '').replace(/\s/g, '')
    const mimeType = detectImageType(imageBase64, claimedType)
    // HEIC/HEIF files start with an ISO-BMFF box whose type, at bytes 4-7, is "ftyp"
    const head = (() => { try { return atob(imageBase64.slice(0, 16)) } catch { return '' } })()
    if (head.slice(4, 8) === 'ftyp') {
      return json({
        sessionId: null, items: [], error: 'unsupported_format',
        message: "That photo is in Apple's HEIC format, which can't be read. Update the app and try again, or take a new photo from inside GoGood.",
      })
    }
    const approxBytes = Math.floor(imageBase64.length * 3 / 4)
    if (approxBytes > MAX_IMAGE_BYTES) {
      return json({
        sessionId: null, items: [], error: 'image_too_large',
        message: `That image is too large to read (${(approxBytes / 1048576).toFixed(1)} MB). Try a closer photo, or crop the screenshot to just the items.`,
      })
    }

    // ── Monthly scan limit (checked on the server, never trusted from the app) ──
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const isPro = (await proStatus(user.id)).pro
    const monthlyLimit = isPro ? PRO_MONTHLY_SCANS : FREE_MONTHLY_SCANS
    const { data: use, error: useErr } = await admin.rpc('scan_use', { p_user: user.id, p_limit: monthlyLimit })
    if (useErr) console.log('[scan-receipt] scan_use failed:', useErr.message) // don't block scans over a counter problem
    const useRow = Array.isArray(use) ? use[0] : use
    if (!useErr && useRow && !useRow.allowed) {
      return json({
        sessionId: null, items: [], error: 'scan_limit', limit: monthlyLimit, used: useRow.used, pro: isPro,
        message: isPro
          ? `You've used all ${monthlyLimit} scans for this month. They reset on the 1st. Barcode scanning still works.`
          : `Free accounts get ${monthlyLimit} scans a month. Go Good Pro gives you ${PRO_MONTHLY_SCANS}. Barcode scanning still works.`,
      })
    }
    counted = !useErr
    const refund = async () => {
      if (!counted) return
      counted = false
      try { await admin.rpc('scan_refund', { p_user: user.id }) } catch { /* best-effort */ }
    }
    refundScan = refund

    // ── One label: just find its expiry date ──
    if (mode === 'expiry') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 200,
          system: 'You are an expiry date extractor. Respond ONLY with raw JSON, no markdown, no explanation.',
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
              { type: 'text', text: `Today is ${todayStr}. Find any best-by, use-by, sell-by, or expiry date printed on this label. Convert it to YYYY-MM-DD format. If only month and year are visible (e.g. "MAY 2026" or "05/26"), use the last day of that month. If only month/day with no year, assume the nearest future year. Return ONLY: {"expiryDate":"YYYY-MM-DD"}. If no date is found return {"expiryDate":""}.` },
            ],
          }],
        }),
      })
      if (!res.ok) { await refund(); return json({ expiryDate: '', error: 'image_rejected' }) }
      const data = await res.json()
      const text = String(data?.content?.find((b: any) => b.type === 'text')?.text ?? '')
      let expiryDate = ''
      try { expiryDate = String(JSON.parse(text.replace(/```json|```/g, '').trim()).expiryDate ?? '') } catch { /* no date */ }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) { expiryDate = ''; await refund() }
      return json({ expiryDate })
    }

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
- nutrition: { "cal": number, "protein": number, "carbs": number, "fat": number } (typical values per 100 g for this kind of food — your best estimate, grams for protein/carbs/fat; use 0s for water or zero-calorie drinks)

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

    const photoPrompt = `You identify food and drink items in a photo of someone's fridge, freezer, pantry shelf, or groceries laid out on a counter.
Return ONLY a valid JSON array — no markdown, no explanation, nothing else.

Each object must have exactly these fields:
- name: string (clear product name; include the brand only if the label is clearly readable, e.g. "Chobani Greek Yogurt", otherwise generic, e.g. "Greek Yogurt")
- qty: number (how many of that item you can see — count separate containers; default 1)
- unit: string (count, bottle, can, jar, carton, bag, box, pack, lbs — default "count")
- estimatedCategory: "fridge" | "freezer" | "pantry"
- icon: string (single emoji for the item)
- estimatedExpiryDays: number | null (typical days of shelf life left for a recently bought item of this kind; null for indefinitely shelf-stable items like salt or honey)
- sku: null
- nutrition: { "cal": number, "protein": number, "carbs": number, "fat": number } (typical values per 100 g for this kind of food — your best estimate, grams for protein/carbs/fat; use 0s for water or zero-calorie drinks)

RULES:
- One entry per distinct product. If you see three identical cans, return one entry with qty 3.
- Only list items you can actually see and reasonably identify. Do not guess at items hidden behind others.
- If you can't tell what something is, skip it rather than inventing a name.
- SKIP non-food items (cleaning supplies, medicine, containers with no visible contents, appliances, shelves).
- Use the same shelf-life guide as a grocery list: raw meat 2-3 days, milk 10, eggs 35, yogurt 21, berries 5, leafy greens 5, bread 5, condiments 180-365, canned goods 730, frozen items 90-180.
${locationHint ? `- The user says this photo is of their ${locationHint}. Set estimatedCategory to "${locationHint}" for everything unless an item clearly belongs elsewhere.` : '- estimatedCategory: frozen items → "freezer"; dairy/produce/meat/deli → "fridge"; everything else → "pantry".'}
- If you cannot identify any food items, return []`

    const labelsPrompt = `You find every food and drink item in a photo — a fridge or freezer shelf, a pantry, groceries on a counter, or several product labels — and read their labels the way a phone's text recognition (like iPhone Live Text) would.
Return ONLY a valid JSON array — no markdown, no explanation, nothing else.

Today's date is ${todayStr}.

HOW TO WORK:
1. Before answering, go over the whole photo carefully, shelf by shelf, and read every word printed on every package: brand, product name, flavor, size, and any dates. Zoom in mentally on small text.
2. Then list each distinct item. Use what the label says. For unlabeled items (produce, eggs in a carton, leftovers in clear containers), name them by what they clearly are.

Each object must have exactly these fields:
- name: string (as printed on the label, with the brand when readable, e.g. "Chobani Plain Greek Yogurt"; for unlabeled items a plain name, e.g. "Red Bell Peppers")
- qty: number (how many of that exact item you can see; default 1)
- unit: string (count, bottle, can, jar, carton, bag, box, pack, lbs, oz — default "count")
- estimatedCategory: "fridge" | "freezer" | "pantry"
- icon: string (single emoji for the item)
- estimatedExpiryDays: number | null
- sku: string | null (the UPC barcode digits only if they're printed and fully readable, otherwise null)
- nutrition: { "cal": number, "protein": number, "carbs": number, "fat": number } (typical values per 100 g for this kind of food — your best estimate, grams for protein/carbs/fat; use 0s for water or zero-calorie drinks)

EXPIRY:
- If a date is printed ("best by", "best if used by", "use by", "sell by", "exp", or a bare date stamp), set estimatedExpiryDays to the days from today (${todayStr}) to that date — negative if it has passed. Month/year only → last day of that month.
- Otherwise use typical shelf life for a recently bought item of that kind (raw meat 2-3, milk 10, yogurt 21, eggs 35, berries 5, leafy greens 5, bread 5, condiments 180-365, canned goods 730, frozen items 90-180), or null for indefinitely shelf-stable items.

RULES:
- One entry per distinct item; identical items are one entry with a higher qty.
- Include partly hidden items if you can still tell what they are. Skip only things you truly can't identify.
- SKIP non-food items (cleaning supplies, medicine, empty containers, the fridge itself).
${locationHint ? `- The user says this photo is of their ${locationHint}. Set estimatedCategory to "${locationHint}" unless an item clearly belongs elsewhere.` : '- estimatedCategory: frozen → "freezer"; dairy/produce/meat/deli → "fridge"; everything else → "pantry".'}
- If you truly cannot identify any food, return []`

    let items: ParsedItem[] = []
    let rawClaudeText = ''
    const tries: { prompt: string; status: number; stop: string | null; text: string }[] = []
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
          // Photos of items/labels need the strongest image reading; receipts are plain text and do well on Sonnet
          model: isPhoto ? 'claude-opus-5-5' : 'claude-sonnet-4-6',
          // Opus 5.5 thinks before answering, and that counts toward max_tokens, so give photo scans more room
          max_tokens: isPhoto ? 32000 : 16000,
          // If reading every label found nothing, the second try just names what's visible
          system: isLabels && attempts === 1 ? labelsPrompt : isPhoto ? photoPrompt : systemPrompt,
          messages: [{
            role: 'user',
            content: [{
              type: 'image',
              source: { type: 'base64', media_type: mimeType, data: imageBase64 }
            }, {
              type: 'text',
              text: isPhoto
                ? (attempts === 1
                    ? (isLabels
                        ? ('Find every food and drink item in this photo and read their labels, including any printed expiry dates. Return only the JSON array.'
                          + (ocrText
                              ? `\n\nThe phone's text recognition already read this text from the photo (one line per text block, in no particular order). Use it to get exact product names, brands and dates, and match each piece of text to the item it belongs to. It may contain errors or text that isn't from food:\n${String(ocrText).slice(0, 8000)}`
                              : ''))
                        : 'List every food and drink item you can see in this photo. Return only the JSON array.')
                    : 'Return ONLY the JSON array starting with [ and ending with ]. Each item: name, qty, unit, estimatedCategory, icon, estimatedExpiryDays, sku (null).')
                : attempts === 1
                  ? `Parse all grocery food items from this receipt${storeName ? ` from ${storeName}` : ''}. For each item, look for any number sequence (5-15 digits) near that item line and record it as the sku field — this helps us look up exact nutrition data. Return only the JSON array.`
                  : 'Parse this receipt. Return ONLY the JSON array starting with [ and ending with ]. Each item: name, qty, unit, estimatedCategory, icon, estimatedExpiryDays, sku.',
            }]
          }]
        })
      })

      if (!anthropicRes.ok) {
        const errText = await anthropicRes.text()
        rawClaudeText = `API error ${anthropicRes.status}: ${errText}`
        tries.push({ prompt: isLabels && attempts === 1 ? 'labels' : isPhoto ? 'photo' : 'receipt', status: anthropicRes.status, stop: null, text: errText.slice(0, 2000) })
        continue
      }

      const anthropicData = await anthropicRes.json()
      rawClaudeText = (anthropicData?.content ?? []).find((b: any) => b?.type === 'text')?.text ?? ''
      tries.push({ prompt: isLabels && attempts === 1 ? 'labels' : isPhoto ? 'photo' : 'receipt', status: 200, stop: anthropicData?.stop_reason ?? null, text: rawClaudeText.slice(0, 4000) })
      if (anthropicData?.stop_reason === 'max_tokens') {
        console.log('[scan-receipt] response hit max_tokens — item list was cut off')
      }

      const parsed = extractJsonArray(rawClaudeText)
      if (parsed && parsed.length > 0) {
        items = parsed.filter((i: any) => i.name && typeof i.name === 'string')
        if (items.length > 0) break
      }
    }

    if (items.length === 0) {
      await refundScan()
      const apiRejected = rawClaudeText.startsWith('API error')
      console.log('[scan-receipt] no items:', rawClaudeText.slice(0, 500))
      // Keep what Claude said so failed scans can be diagnosed later
      try {
        await supabase.from('scan_failures').insert({
          user_id: user.id, mode, location_hint: locationHint,
          image_bytes: approxBytes, ocr_chars: ocrText ? String(ocrText).length : 0, tries,
        })
      } catch { /* diagnostics are best-effort */ }
      return json({
        sessionId: null,
        items: [],
        error: apiRejected ? 'image_rejected' : 'no_items_found',
        message: apiRejected
          ? "We couldn't read that image. Try taking a new photo, or a screenshot saved as a regular image."
          : isPhoto
            ? "We couldn't spot any food items in that photo. Try a closer, well-lit shot where labels face the camera."
            : "We couldn't find any food items on that receipt. Make sure the item lines are fully visible and in focus.",
        debug: rawClaudeText.slice(0, 500),
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
      // Loose produce has a 4-5 digit PLU (4011 = bananas) that Walmart pads with zeros.
      // It isn't a barcode, so a barcode lookup returns unrelated products — skip it.
      const isProducePlu = !!rawSku && /^0{7,9}\d{4,5}$/.test(rawSku)
      const validUpc = rawSku && !isProducePlu && /^\d{12,13}$/.test(rawSku) ? rawSku : null

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
      const empty = (n: NutritionData | null) => !n || (n.cal === 0 && n.protein === 0)
      if (empty(nutrition)) {
        const usda = await lookupByNameUSDA(searchName)
        if (usda && (usda.cal > 0 || usda.protein > 0)) {
          nutrition = usda
        }
      }

      // Still nothing: try shorter, generic versions of the name ("vanilla yogurt")
      if (empty(nutrition)) {
        for (const alt of simplerNames(searchName)) {
          const [off, usda] = await Promise.all([lookupByNameOFF(alt), lookupByNameUSDA(alt)])
          const hit = [usda, off].find(n => n && (n.cal > 0 || n.protein > 0)) ?? null
          if (hit) { nutrition = { ...hit, name: undefined }; break }
        }
      }

      // Last resort: the AI's own typical values, so an item is never left blank
      if (empty(nutrition) && item.nutrition && (Number(item.nutrition.cal) > 0 || Number(item.nutrition.protein) > 0)) {
        const r = (v: unknown) => Math.max(0, Math.round((Number(v) || 0) * 10) / 10)
        nutrition = {
          protein: r(item.nutrition.protein), carbs: r(item.nutrition.carbs),
          fat: r(item.nutrition.fat), cal: Math.round(Number(item.nutrition.cal) || 0),
          source: 'ai_estimate',
        }
      }

      // Name priority: Walmart product name > UPC-resolved name > original Claude name
      // Only trust a barcode-database name when it clearly matches what's on the receipt
      // (the database can return foreign-language or junk names like "None Broccoli").
      const upcName = nutrition?.source === 'upc' && nutrition.name ? cleanProductName(nutrition.name) : null
      const bestName = walmartItem?.name
        ?? (upcName && namesOverlap(upcName, item.name) ? upcName : item.name)

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
      if (days === null || days === undefined) return null
      if (!isLabels && days <= 0) return null   // label scans can read a date that has already passed
      const d = new Date(today)
      d.setDate(d.getDate() + days)
      return d.toISOString().slice(0, 10)
    }

    const sessionId = crypto.randomUUID()
    const rows = enriched.map(item => ({
      user_id:         user.id,
      source:          isPhoto ? 'photo' : 'receipt',
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
      store_name:      isPhoto ? null : (storeName ?? null),
    }))

    const { error: saveErr } = await supabase.from('draft_items').insert(rows)
    if (saveErr) {
      await refundScan()
      console.log('[scan-receipt] saving items failed:', saveErr.message)
      return json({
        sessionId: null, items: [], error: 'save_failed',
        message: `We found ${rows.length} item${rows.length === 1 ? '' : 's'} but couldn't save them for review. Please try again.`,
        debug: saveErr.message,
      })
    }

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
    await refundScan()
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})
