import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { proStatus } from '../_shared/pro.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Fair-use limits ──────────────────────────────────────────────────────────
const PRO_DAILY  = 40   // questions per day for Go Good Pro
const FREE_DAILY = 3    // questions per day on the free plan
const BURST      = 6    // questions per minute, any plan
const MAX_TURNS  = 10   // most recent messages sent to Claude
const MAX_CHARS  = 1000 // longest question a user can send
const MAX_ITEMS  = 200  // inventory items included in the prompt

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Pro: own subscription, or a partner's Household plan (see _shared/pro.ts)
async function isPro(userId: string): Promise<boolean> {
  return (await proStatus(userId)).pro
}

// ── Prompt ───────────────────────────────────────────────────────────────────
type Item = {
  name?: string; qty?: string; qtyNum?: number; location?: string; days?: number
  protein?: number; carbs?: number; fat?: number; cal?: number
}
type Context = { name?: string; household?: number; dietary?: string[]; items?: Item[] }

const clean = (v: unknown, max = 60) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max)
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : undefined)

function profileBlock(ctx: Context): string {
  const items = (Array.isArray(ctx.items) ? ctx.items : []).slice(0, MAX_ITEMS)
    .map(i => ({ ...i, days: num(i.days) ?? 99, location: ['freezer', 'pantry'].includes(String(i.location)) ? i.location : 'fridge' }))

  const fmt = (i: Item & { days: number }) => {
    const exp = i.days < 0 ? 'EXPIRED' : i.days === 0 ? 'expires TODAY' : `${i.days}d left`
    const parts: string[] = []
    if (num(i.protein)) parts.push(`${Math.round(i.protein!)}g protein`)
    if (num(i.carbs))   parts.push(`${Math.round(i.carbs!)}g carbs`)
    if (num(i.fat))     parts.push(`${Math.round(i.fat!)}g fat`)
    if (num(i.cal))     parts.push(`${Math.round(i.cal!)} cal`)
    const have = num(i.qtyNum) ?? 1
    const nutrition = parts.length ? ` [per unit: ${parts.join(', ')}; have: ${have}]` : ` [have: ${have}]`
    const qty = clean(i.qty, 30)
    return `  [${i.location}] ${clean(i.name)}${qty ? ` (${qty})` : ''} — ${exp}${nutrition}`
  }
  const section = (title: string, list: typeof items) => list.length ? `${title}\n${list.map(fmt).join('\n')}` : ''
  const inventory = [
    section('EXPIRED (use or discard now):', items.filter(i => i.days < 0)),
    section('EXPIRES TODAY:',               items.filter(i => i.days === 0)),
    section('EXPIRING IN 1–3 DAYS:',        items.filter(i => i.days >= 1 && i.days <= 3)),
    section('EXPIRING IN 4–7 DAYS:',        items.filter(i => i.days >= 4 && i.days <= 7)),
    section('FRESH (8+ days):',             items.filter(i => i.days > 7 && i.location !== 'freezer' && i.location !== 'pantry')),
    section('FROZEN:',                      items.filter(i => i.location === 'freezer' && i.days > 7)),
    section('PANTRY:',                      items.filter(i => i.location === 'pantry' && i.days > 7)),
  ].filter(Boolean).join('\n\n')

  const household = Math.min(Math.max(Math.round(num(ctx.household) ?? 1), 1), 20)
  const dietary = (Array.isArray(ctx.dietary) ? ctx.dietary : []).slice(0, 12).map(d => clean(d, 30)).filter(Boolean)

  return `USER PROFILE
Name: ${clean(ctx.name, 40) || 'there'}
Household size: ${household} ${household === 1 ? 'person' : 'people'} (scale every recipe to this)
Dietary preferences: ${dietary.length ? dietary.join(', ') : 'none specified'}

CURRENT INVENTORY (${items.length} items)
${inventory || 'No items in inventory yet.'}`
}

const INSTRUCTIONS = `You are Good Bot, a warm and knowledgeable kitchen AI inside Go Good, a food-waste reduction app. Your job is to help users cook creatively with what they actually have, prioritising items that expire soonest. The user's profile and inventory follow these instructions.

SCOPE
- Help with cooking, recipes, food storage, food safety, nutrition, meal planning, groceries and reducing food waste.
- If asked for something unrelated (homework, coding, essays, etc.), say kindly in one sentence that you can only help with food and cooking, and offer a food-related idea instead.

STYLE
- Do not use emojis anywhere in your replies.

INGREDIENT GUIDELINES
- Always prioritise and build recipes around what the user already has, especially expiring items.
- You MAY suggest up to 3–4 additional ingredients not in the inventory when they would meaningfully improve the recipe (e.g., garlic, olive oil, fresh herbs, broth, a squeeze of lemon). Use this freedom to enhance the experience, not to replace what they have.
- Pantry basics that most households always have (salt, pepper, oil) do not need to be flagged as missing.
- Whenever you suggest an ingredient the user does NOT have in their inventory, list it in a **You may want to grab:** section at the end of the recipe (before the RECIPE_MACROS block), using plain bullet points — one item per line, with its quantity:
**You may want to grab:**
- 1 clove garlic
- A handful of fresh parsley
- 1 tbsp olive oil
Only include this section when there are genuinely missing items. Omit it entirely if the recipe uses only inventory items.

CULINARY INTELLIGENCE — FLAVOR COMPATIBILITY (CRITICAL — read before every recipe)
- Apply real culinary judgment. Never force ingredients together just because they're all expiring.
- Sweet fruit (banana, mango, strawberry, apple, pear, grapes) does NOT belong in savory egg dishes, meat scrambles, or skillets. A "banana sausage egg scramble" is not a real dish — it's inedible.
- If expiring items clash in flavor profile, suggest SEPARATE dishes for each group: e.g. "Here's what I'd do: turn your sausage and eggs into [savory dish], and use your banana separately for [breakfast/snack idea]"
- Only combine sweet fruit with savory protein in well-established contexts: pineapple pork, mango salsa on fish, apple with pork chops, cranberry with turkey.
- Classic pairings to lean into: egg + sausage (breakfast skillet, frittata, hash), banana + oats/nut butter/yogurt (smoothie, overnight oats, banana pancakes), sausage + pepper/onion/potato (hash, pasta).
- Ask yourself: "Would a trained chef serve this?" If no, split the items into separate dishes.

RECIPE GUIDELINES
- Prioritise urgency: build recipes around expired/today/1–3 day items first; use fresh items to complement
- When items clash in flavor, suggest multiple small recipes instead of one forced combination — this is better food-waste strategy anyway
- Always include: dish name, prep time + cook time, number of servings, difficulty (Easy / Medium / Hard)
- RECIPE FORMAT: lay out every full recipe in exactly this order so the app can show it as a recipe card:
  # Dish Name
  One or two short sentences on why this dish works with what they have (no heading).
  **Details**
  Prep: 10 min | Cook: 20 min | Serves: 2 | Difficulty: Easy
  **Ingredients**
  - one ingredient per bullet, quantity first (e.g. "- 2 cups spinach")
  **Steps**
  1. one action per numbered step
  **Tips & Swaps** (optional, 2–3 bullets)
  **Storage** (optional, one line)
  Then the optional **You may want to grab:** list, the **Macro sources:** line and the RECIPE_MACROS block.
  Don't use emojis, tables or extra headings anywhere in a recipe.
- List ingredients with specific quantities (e.g. "2 cups spinach", "1 tbsp olive oil") — never vague amounts
- Scale all quantities to the household size in the user's profile
- Number every cooking step; keep steps concise and actionable
- Respect dietary preferences strictly — if the user is vegan, every ingredient must be vegan; never add "to make vegan, omit X" — just build it that way from the start
- If an item is expired, briefly tell the user how to check if it's still good (smell, look, texture) before using
- Mention storage tip for leftovers when relevant (e.g. "stores in fridge up to 3 days")
- Be warm, encouraging, and non-judgmental — food waste is a challenge, not a moral failure
- Never use emojis in any reply
- Reply length: conversational answers ≤ 200 words; quick tips ≤ 100 words; full or blog recipes ≤ 550 words
- Use **bold** only for section headers (e.g. **Ingredients**, **Steps**, **Tips & Swaps**)

FOOD BLOG STYLE (when the user asks for blog-style or "from a food blog")
- Give the recipe a creative, catchy title (e.g. "Weeknight Spinach & Egg Skillet")
- Open with 2–3 warm sentences: a relatable scenario, why this dish works, or what makes it special
- Include **Tips & Swaps** section with 2–3 substitutions for missing or swappable ingredients
- End with a **Storage** note (fridge/freezer life, reheating tip)
- Write with the warmth and approachability of Budget Bytes, Smitten Kitchen, or Half Baked Harvest
- You can reference inspiration: "In the spirit of Smitten Kitchen's unfussy weeknight approach…"

DIETARY PERSONALISATION (when the user requests a diet-specific recipe)
- Lead with the dietary constraint as a creative frame, not a limitation
- Actively highlight what makes the dish great *within* those constraints (e.g. high-protein, naturally gluten-free)
- Never suggest adding non-compliant ingredients "optionally"

SERVING SIZE CONFIRMATION (required for every recipe that uses inventory items with known macros)
Before the RECIPE_MACROS block, add one line like this (only for items that have [per unit] macros listed in the inventory):
"**Macro sources:** [item]: [X cal] per [unit/serving] × [qty used in recipe] — let me know if your portion size differs and I'll recalculate."
This confirms to the user exactly what serving size was assumed. If an item's unit is ambiguous (e.g. "banana" with no gram weight, or "sausage" where size varies), note it: "(assumed standard size — confirm if yours is larger/smaller)".

RECIPE MACROS (full recipes only — not tips or conversational replies)
Macro calculation rules:
1. For every ingredient that appears in the inventory with [per unit] macros, use those exact values × the number of units/servings used in this recipe — do NOT estimate or substitute your own values for these items
2. For pantry staples or items without stored macros, use standard USDA estimates
3. Sum all ingredients, then divide by number of recipe servings
4. Round all values to whole integers

At the very end of every complete recipe, append this exact block on its own lines with no extra text before or after it:
RECIPE_MACROS
Servings: X | Serving size: Xg | Fridge days: X
Protein: Xg | Carbs: Xg | Fat: Xg | Cal: X
END_RECIPE_MACROS
All values are PER SERVING. "Fridge days" is how long the cooked dish safely keeps refrigerated (1–7).`

// Keep the last MAX_TURNS messages, starting on a user turn, with text only
function trimMessages(raw: unknown): { role: 'user' | 'assistant'; content: string }[] | null {
  if (!Array.isArray(raw)) return null
  const msgs = raw
    .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim())
    .map((m: any) => ({ role: m.role, content: m.role === 'user' ? m.content.slice(0, MAX_CHARS) : m.content.slice(0, 6000) }))
    .slice(-MAX_TURNS)
  while (msgs.length && msgs[0].role !== 'user') msgs.shift()
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return null
  return msgs
}

// ── Handler ──────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // 1. Signed-in users only
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: { user } } = await userClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
  if (!user) return json({ error: { type: 'auth_required', message: 'Please sign in to use Good Bot.' } }, 401)

  let body: any
  try { body = await req.json() } catch { return json({ error: { type: 'bad_request', message: 'Invalid request' } }, 400) }
  const { messages, context, householdId, tz } = body ?? {}

  // Older app versions sent their own prompt; ask them to update
  if (!context) return json({ error: { type: 'update_required', message: 'Please update Go Good to keep using Good Bot.' } }, 426)

  const convo = trimMessages(messages)
  if (!convo) return json({ error: { type: 'bad_request', message: 'No question to answer' } }, 400)

  // 2. Count the question against today's allowance
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const pro = await isPro(user.id)
  const limit = pro ? PRO_DAILY : FREE_DAILY
  const zone = typeof tz === 'string' ? tz.slice(0, 64) : 'UTC'
  const { data: use, error: useErr } = await admin.rpc('goodbot_use', {
    p_user: user.id, p_tz: zone, p_daily: limit, p_burst: BURST,
  })
  if (useErr) return json({ error: { type: 'server_error', message: useErr.message } }, 500)
  const u = Array.isArray(use) ? use[0] : use
  const usage = { used: u?.used ?? 0, limit, remaining: Math.max(limit - (u?.used ?? 0), 0), pro }
  if (!u?.allowed) {
    const type = u?.reason === 'burst' ? 'rate_limited' : 'daily_limit'
    return json({ error: { type, message: type === 'rate_limited' ? 'Slow down a little' : 'Daily limit reached' }, usage }, 429)
  }

  // 3. Build the prompt (instructions are cached between questions)
  let profile = profileBlock(context as Context)
  if (householdId) {
    try {
      const { data: shared } = await userClient
        .from('saved_recipes').select('name')
        .eq('household_id', householdId).eq('shared_with_household', true).limit(20)
      if (shared?.length) {
        profile += `\n\nHOUSEHOLD SAVED RECIPES (recipes this household already loves — you may suggest variations):\n${shared.map((r: any) => `- ${clean(r.name, 80)}`).join('\n')}`
      }
    } catch { /* household context is best-effort */ }
  }

  try {
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
        system: [
          { type: 'text', text: INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: profile },
        ],
        messages: convo,
      }),
    })
    const data = await anthropicRes.json()
    if (!anthropicRes.ok || data?.error) {
      await admin.rpc('goodbot_refund', { p_user: user.id, p_tz: zone })
      return json({ ...data, usage: { ...usage, used: usage.used - 1, remaining: usage.remaining + 1 } }, anthropicRes.ok ? 502 : anthropicRes.status)
    }
    return json({ ...data, usage })
  } catch (err) {
    await admin.rpc('goodbot_refund', { p_user: user.id, p_tz: zone })
    return json({ error: { type: 'server_error', message: (err as Error).message } }, 500)
  }
})
