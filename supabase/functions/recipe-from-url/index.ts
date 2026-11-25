import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

function detectPlatform(url: string): string {
  if (/tiktok\.com/i.test(url)) return 'TikTok'
  if (/instagram\.com|instagr\.am/i.test(url)) return 'Instagram'
  if (/facebook\.com|fb\.com|fb\.watch/i.test(url)) return 'Facebook'
  if (/youtube\.com|youtu\.be/i.test(url)) return 'YouTube'
  if (/pinterest\.|pin\.it/i.test(url)) return 'Pinterest'
  return 'Web'
}

// ── Fetching ─────────────────────────────────────────────────────────────────

const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
// Social sites give link-preview crawlers the title and caption without a login
const PREVIEW_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'

async function fetchText(url: string, ua = BROWSER_UA): Promise<{ html: string; finalUrl: string }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
  })
  return { html: await res.text(), finalUrl: res.url || url }
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

// &amp; &quot; &#39; &#x1F60A; and friends → characters
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)) } catch { return '' } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)) } catch { return '' } })
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
}

// Visible text of an HTML fragment, keeping line breaks (captions use them for lists)
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// <meta property|name="key" content="..."> in any attribute order or quote style
function extractMeta(html: string, ...keys: string[]): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = tag.match(/\b(?:property|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
    if (!key || !keys.includes((key[1] ?? key[2] ?? '').toLowerCase())) continue
    const c = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
    const v = c ? decodeEntities(c[1] ?? c[2] ?? '').replace(/\\n/g, '\n').trim() : ''
    if (v.length >= 5) return v
  }
  return ''
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]{3,200})<\/title>/i)
  return m ? decodeEntities(m[1]).replace(/\s*[-|–]\s*\S.*$/, '').trim() : ''
}

// A login wall or cookie notice instead of the post
function looksLikeLoginWall(text: string): boolean {
  return text.length < 400 && /log ?in|sign ?up|create an account|see instagram photos and videos|welcome back/i.test(text)
}

// A JSON string literal's contents → text
function unescapeJson(raw: string): string {
  try { return JSON.parse(`"${raw}"`) } catch { return raw.replace(/\\n/g, '\n').replace(/\\"/g, '"') }
}

// ── Per-platform readers ─────────────────────────────────────────────────────

// Instagram's preview text is `123 likes, 4 comments - user on May 1, 2025: "caption".` — keep the caption
function cleanInstagramDescription(d: string): string {
  const m = d.match(/^[\d,.\sKkMm]*likes?,[^:]*?:\s*["“]?([\s\S]*?)["”]?\.?\s*$/)
  return (m ? m[1] : d).trim()
}

const IG_CODE = /instagram\.com\/(?:[^/?#]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i

async function instagramCaption(url: string): Promise<string> {
  // Share links (instagram.com/share/..., instagr.am) redirect to the post
  let code = url.match(IG_CODE)?.[1]
  if (!code) {
    try { code = (await fetchText(url)).finalUrl.match(IG_CODE)?.[1] } catch { /* keep going */ }
  }

  if (code) {
    // 1. The embed page (what websites show) includes the full caption, no login needed
    try {
      const { html } = await fetchText(`https://www.instagram.com/p/${code}/embed/captioned/`)
      const block = html.match(/<div class="Caption"[^>]*>([\s\S]*?)<div class="CaptionComments"/i)?.[1]
      if (block) {
        const text = htmlToText(block.replace(/<a[^>]*class="CaptionUsername"[^>]*>[\s\S]*?<\/a>/i, ''))
        if (text.length > 20) return text
      }
      // Newer embed pages carry the caption inside a JSON blob
      const raw = html.match(/\\"caption\\":\\"((?:[^"\\]|\\\\.)*?)\\"/)?.[1]
        ?? html.match(/"caption":\{[^{}]*?"text":"((?:[^"\\]|\\.)*)"/)?.[1]
        ?? html.match(/"edge_media_to_caption":\{"edges":\[\{"node":\{"text":"((?:[^"\\]|\\.)*)"/)?.[1]
      if (raw) {
        const text = unescapeJson(unescapeJson(raw))
        if (text.length > 20) return text
      }
    } catch { /* try the preview next */ }
  }

  // 2. The link preview Instagram gives to chat apps
  for (const target of code ? [`https://www.instagram.com/p/${code}/`, url] : [url]) {
    try {
      const { html } = await fetchText(target, PREVIEW_UA)
      const d = cleanInstagramDescription(extractMeta(html, 'og:description', 'description'))
      if (d && !looksLikeLoginWall(d)) return d
    } catch { /* try the next */ }
  }
  return ''
}

async function tiktokCaption(url: string): Promise<string> {
  // TikTok's public oEmbed returns the full caption as the title
  try {
    const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(10000) })
    if (r.ok) {
      const j = await r.json()
      if (j?.title && String(j.title).length > 20) return String(j.title)
    }
  } catch { /* fall back to the page */ }
  try {
    const { html } = await fetchText(url)
    const raw = html.match(/"desc":"((?:[^"\\]|\\.)*)"/)?.[1]
    if (raw) return unescapeJson(raw)
    return extractMeta(html, 'og:description', 'description')
  } catch { return '' }
}

async function youtubeText(url: string): Promise<string> {
  try {
    const { html } = await fetchText(url)
    const title = extractMeta(html, 'og:title')
    const raw = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/)?.[1]
    const desc = raw ? unescapeJson(raw) : extractMeta(html, 'og:description', 'description')
    return [title, desc].filter(Boolean).join('\n\n')
  } catch { return '' }
}

// Recipe blogs, Facebook, Pinterest and the rest: structured recipe data, then the
// link preview, then (for websites) the article text
async function genericText(url: string, platform: string): Promise<string> {
  const agents = platform === 'Web' ? [BROWSER_UA, PREVIEW_UA] : [PREVIEW_UA, BROWSER_UA]
  for (const ua of agents) {
    try {
      const { html } = await fetchText(url, ua)
      const jsonLd = extractJsonLdRecipe(html)
      if (jsonLd) return jsonLd
      const title = extractMeta(html, 'og:title', 'twitter:title') || extractTitle(html)
      const desc  = extractMeta(html, 'og:description', 'twitter:description', 'description')
      const main  = platform === 'Web'
        ? htmlToText(html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ?? html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<body\b[\s\S]*<\/body>/i)?.[0] ?? '')
        : ''
      const text = [title, desc, main].filter(Boolean).join('\n\n').trim()
      if (text && !looksLikeLoginWall(text)) return text
    } catch { /* try the next way */ }
  }
  return ''
}

function extractJsonLdRecipe(html: string): string {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const block of blocks) {
    try {
      const data = JSON.parse(block[1])
      const candidates = Array.isArray(data) ? data : (data['@graph'] ? data['@graph'] : [data])
      const recipe = candidates.find((d: any) => d['@type'] === 'Recipe' || (Array.isArray(d['@type']) && d['@type'].includes('Recipe')))
      if (!recipe) continue

      const parts: string[] = []
      if (recipe.name) parts.push(`# ${recipe.name}`)

      const meta: string[] = []
      if (recipe.prepTime) meta.push(`Prep: ${recipe.prepTime.replace('PT', '').toLowerCase()}`)
      if (recipe.cookTime) meta.push(`Cook: ${recipe.cookTime.replace('PT', '').toLowerCase()}`)
      const yield_ = recipe.recipeYield
      if (yield_) meta.push(`Servings: ${Array.isArray(yield_) ? yield_[0] : yield_}`)
      if (meta.length) parts.push(meta.join('  '))

      if (recipe.description) parts.push(recipe.description)

      if (recipe.recipeIngredient?.length) {
        parts.push('\n## Ingredients')
        for (const ing of recipe.recipeIngredient) parts.push(`- ${ing}`)
      }

      if (recipe.recipeInstructions?.length) {
        parts.push('\n## Instructions')
        // Steps can be strings, HowToStep objects, or HowToSection groups of steps
        const steps: string[] = []
        for (const s of recipe.recipeInstructions) {
          if (typeof s === 'string') steps.push(s)
          else if (s?.itemListElement) for (const x of s.itemListElement) steps.push(typeof x === 'string' ? x : x?.text ?? '')
          else steps.push(s?.text ?? '')
        }
        steps.filter(Boolean).forEach((t, i) => parts.push(`${i + 1}. ${htmlToText(t)}`))
      }

      const n = recipe.nutrition
      if (n) {
        const nutrition: string[] = []
        if (n.proteinContent) nutrition.push(`**Protein:** ${n.proteinContent}`)
        if (n.carbohydrateContent) nutrition.push(`**Carbs:** ${n.carbohydrateContent}`)
        if (n.fatContent) nutrition.push(`**Fat:** ${n.fatContent}`)
        if (n.calories) nutrition.push(`**Calories:** ${n.calories}`)
        if (nutrition.length) parts.push('\n## Nutrition (per serving)\n' + nutrition.join('  '))
      }

      return parts.join('\n')
    } catch { /* not valid JSON or not a Recipe */ }
  }
  return ''
}

// ── Claude ───────────────────────────────────────────────────────────────────

const FORMAT_PROMPT = `You turn social media captions and web pages into clean recipes.

Output a recipe in this EXACT markdown format:

# [Recipe Name]

**Prep Time:** X min  **Cook Time:** X min  **Servings:** X

## Ingredients
- [qty] [unit] [ingredient name]
- ...

## Instructions
1. [step]
2. ...

## Nutrition (per serving)
**Protein:** Xg  **Carbs:** Xg  **Fat:** Xg  **Calories:** X

How captions are usually written:
- Ingredients and steps are often mixed with chatty intro text, emojis, hashtags, "follow for more", links and sponsor shout-outs. Ignore all of that.
- Lists may use emojis, dashes, dots or numbers as bullets, or sit on one line separated by commas. Turn them into clean bullets.
- Sections may be labelled loosely ("What you need", "You'll need", "Method", "How to", "Directions", "Sauce:", "For the marinade:"). Keep sub-groups by naming them in the ingredient text, e.g. "- 2 tbsp soy sauce (for the sauce)".
- If the caption gives ingredients but no steps, write short, sensible steps from what the caption says about the dish (the video usually shows them). If it gives steps but no ingredient list, build the list from the steps.
- Keep the creator's quantities exactly. Leave a quantity out rather than invent one.
- Leave out Prep/Cook/Servings values you can't find or reasonably infer, and leave out the Nutrition section unless the caption gives nutrition.
- Name the dish from the caption; if there's no name, give it a short descriptive one.

Only if there is truly no recipe (no ingredients and no cooking steps — e.g. "recipe in bio", "comment RECIPE and I'll DM you", or just a dish name), output exactly: NO_RECIPE_FOUND
No commentary before or after the recipe.`

async function formatRecipe(content: string, platform: string): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system: FORMAT_PROMPT,
      messages: [{ role: 'user', content: `Here is the ${platform} post/page text:\n\n<content>\n${content.slice(0, 12000)}\n</content>` }],
    }),
  })
  const data = await r.json()
  return (data?.content ?? []).find((b: any) => b?.type === 'text')?.text?.trim() ?? ''
}

// ── Import log (product analytics + anonymous trend reports) ────────────────

function ingredientLines(recipe: string): string[] {
  const section = recipe.split(/^##\s+Ingredients\s*$/im)[1]?.split(/^##\s+/m)[0] ?? ''
  return section.split('\n').map(l => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean).slice(0, 60)
}

function creatorFrom(url: string): string | null {
  return url.match(/tiktok\.com\/(@[A-Za-z0-9._-]+)/i)?.[1]
    ?? url.match(/youtube\.com\/(@[A-Za-z0-9._-]+)/i)?.[1]
    ?? (url.match(/instagram\.com\/([A-Za-z0-9._]+)\/(?:p|reel|reels|tv)\//i)?.[1] ? '@' + url.match(/instagram\.com\/([A-Za-z0-9._]+)\//i)![1] : null)
}

// Best-effort: never blocks or fails the import
async function logImport(
  client: ReturnType<typeof createClient>, userId: string,
  row: { via: string; url?: string; platform: string; success: boolean; error_kind?: string; recipe?: string },
) {
  try {
    let domain: string | null = null
    try { domain = row.url ? new URL(row.url).hostname.replace(/^www\./, '') : null } catch { /* not a URL */ }
    await client.from('recipe_imports').insert({
      user_id: userId, via: row.via, platform: row.platform, source_domain: domain,
      creator: row.url ? creatorFrom(row.url) : null, success: row.success, error_kind: row.error_kind ?? null,
      recipe_name: row.recipe?.match(/^#\s+(.+)$/m)?.[1]?.trim().slice(0, 200) ?? null,
      ingredients: row.recipe ? ingredientLines(row.recipe) : null,
    })
  } catch { /* analytics only */ }
}

// ── Handler ──────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    // Signed-in users only (the app sends the user's session automatically)
    const authHeader = req.headers.get('Authorization') ?? ''
    const auth = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await auth.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
    if (!user) return json({ error: 'Please sign in to import recipes.' }, 401)

    const { url: rawUrl, text, via: rawVia } = await req.json()
    const via = ['share', 'link', 'paste'].includes(rawVia) ? rawVia : (text ? 'paste' : 'link')
    if (!rawUrl && !text) return json({ error: 'URL or text is required' }, 400)

    // Pasted caption: nothing to fetch
    if (text && typeof text === 'string') {
      const platform = rawUrl ? detectPlatform(rawUrl) : 'Web'
      const recipeText = await formatRecipe(text, platform)
      if (!recipeText || recipeText.startsWith('NO_RECIPE_FOUND')) {
        await logImport(auth, user.id, { via, url: rawUrl, platform, success: false, error_kind: 'no_recipe' })
        return json({ error: 'No recipe found in the pasted text. Make sure the caption includes the ingredients or the steps.' }, 422)
      }
      await logImport(auth, user.id, { via, url: rawUrl, platform, success: true, recipe: recipeText })
      return json({ recipe: recipeText, name: recipeText.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'Imported Recipe', platform, sourceUrl: rawUrl ?? '' })
    }

    // Links copied from apps often have extra text or tracking around them
    const url = String(rawUrl).trim().match(/https?:\/\/\S+/)?.[0]?.replace(/[)\].,!?'"]+$/, '') ?? String(rawUrl).trim()
    const platform = detectPlatform(url)

    const content =
      platform === 'Instagram' ? await instagramCaption(url)
      : platform === 'TikTok'  ? await tiktokCaption(url)
      : platform === 'YouTube' ? await youtubeText(url)
      : await genericText(url, platform)

    if (!content) {
      await logImport(auth, user.id, { via, url, platform, success: false, error_kind: 'unreadable' })
      return json({
        error: platform === 'Web'
          ? "We couldn't open that page. Make sure the link works and try again, or copy the recipe text and paste it instead."
          : `We couldn't read that ${platform} post. It may be private or need a login. Open the post, copy the caption, and use "Paste caption" instead.`,
      }, 422)
    }

    const recipeText = await formatRecipe(content, platform)
    if (!recipeText || recipeText.startsWith('NO_RECIPE_FOUND')) {
      await logImport(auth, user.id, { via, url, platform, success: false, error_kind: 'no_recipe' })
      return json({
        error: platform === 'Web'
          ? "We couldn't find a recipe on that page."
          : `We read the ${platform} caption, but it doesn't include the ingredients or steps. Some creators put the recipe in a comment, their bio link or the video itself. If you find the text, use "Paste caption".`,
      }, 422)
    }

    await logImport(auth, user.id, { via, url, platform, success: true, recipe: recipeText })
    return json({ recipe: recipeText, name: recipeText.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'Imported Recipe', platform, sourceUrl: url })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
