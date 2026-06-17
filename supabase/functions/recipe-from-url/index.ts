import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function detectPlatform(url: string): string {
  if (/tiktok\.com/i.test(url)) return 'TikTok'
  if (/instagram\.com/i.test(url)) return 'Instagram'
  if (/facebook\.com|fb\.com|fb\.watch/i.test(url)) return 'Facebook'
  if (/youtube\.com|youtu\.be/i.test(url)) return 'YouTube'
  return 'Web'
}

async function fetchPageContent(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
    },
    redirect: 'follow',
  })
  return res.text()
}

function extractMeta(html: string, ...selectors: string[]): string {
  for (const sel of selectors) {
    const re = new RegExp(
      `<meta[^>]+(?:${sel})[^>]+content=["']([^"']{5,2000})["']`,
      'i',
    )
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']{5,2000})["'][^>]+(?:${sel})`,
      'i',
    )
    const m = html.match(re) || html.match(re2)
    if (m) {
      return m[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\\n/g, '\n')
        .trim()
    }
  }
  return ''
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]{3,200})<\/title>/i)
  return m ? m[1].replace(/\s*[-|–]\s*\S.*$/, '').trim() : ''
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
        const steps = recipe.recipeInstructions
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i]
          parts.push(`${i + 1}. ${typeof s === 'string' ? s : s.text ?? ''}`)
        }
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { url, text } = await req.json()
    if (!url && !text) {
      return new Response(
        JSON.stringify({ error: 'URL or text is required' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
      )
    }

    // Text paste mode — skip fetching entirely
    if (text && typeof text === 'string') {
      const platform = url ? detectPlatform(url) : 'Web'
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1800,
          system: `You extract and format recipes from social media captions and post text.

Given raw caption text, output a clean recipe in this EXACT markdown format:

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

Rules:
- Extract every ingredient and instruction present in the caption text
- Always include quantities when given
- If nutrition is not mentioned, omit that section
- If no recipe is present at all, output exactly: NO_RECIPE_FOUND
- Do not add any commentary before or after the recipe`,
          messages: [{
            role: 'user',
            content: `Extract the recipe from this ${platform} caption:\n\n${text.slice(0, 6000)}`,
          }],
        }),
      })

      const aiData = await anthropicRes.json()
      const recipeText: string = aiData.content?.[0]?.text?.trim() ?? ''

      if (!recipeText || recipeText.startsWith('NO_RECIPE_FOUND')) {
        return new Response(
          JSON.stringify({ error: 'No recipe found in the pasted text. Make sure the caption includes ingredients and/or instructions.' }),
          { status: 422, headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      const nameMatch  = recipeText.match(/^#\s+(.+)$/m)
      const recipeName = nameMatch ? nameMatch[1].trim() : 'Imported Recipe'

      return new Response(
        JSON.stringify({ recipe: recipeText, name: recipeName, platform, sourceUrl: url ?? '' }),
        { headers: { ...cors, 'Content-Type': 'application/json' } },
      )
    }

    const platform = detectPlatform(url)

    let pageContent = ''
    let fetchError = ''
    try {
      const html = await fetchPageContent(url)

      const jsonLd = extractJsonLdRecipe(html)
      if (jsonLd) {
        pageContent = jsonLd
      } else {
        const ogTitle = extractMeta(html, 'property="og:title"', 'name="twitter:title"')
        const ogDesc  = extractMeta(html, 'property="og:description"', 'name="twitter:description"', 'name="description"')
        const title   = ogTitle || extractTitle(html)
        pageContent   = [title, ogDesc].filter(Boolean).join('\n\n')
      }
    } catch (e) {
      fetchError = (e as Error).message
    }

    if (!pageContent) {
      const platformMsg: Record<string, string> = {
        Instagram: 'Instagram requires login to view most posts. Try copying the recipe caption and pasting it below instead.',
        Facebook: 'This Facebook post may be private or require login. Try copying the recipe text and pasting it below instead.',
        TikTok: 'Could not read the full caption from TikTok. Try copying the recipe caption and pasting it below instead.',
      }
      return new Response(
        JSON.stringify({ error: fetchError || platformMsg[platform] || 'Could not extract content from this page. Make sure the post is public and try again.' }),
        { status: 422, headers: { ...cors, 'Content-Type': 'application/json' } },
      )
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1800,
        system: `You extract and format recipes from social media posts and web pages.

Given raw page content, output a clean recipe in this EXACT markdown format:

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

Rules:
- If the page content already has structured recipe data (JSON-LD format), use it directly and just reformat
- If the content is a social media caption, extract the recipe from it
- Always include quantities in ingredients when they can be inferred
- If no recipe is present, output exactly: NO_RECIPE_FOUND
- Do not add any commentary before or after the recipe`,
        messages: [{
          role: 'user',
          content: `Extract the recipe from this ${platform} page content:\n\n${pageContent.slice(0, 4000)}`,
        }],
      }),
    })

    const aiData = await anthropicRes.json()
    const recipeText: string = aiData.content?.[0]?.text?.trim() ?? ''

    if (!recipeText || recipeText.startsWith('NO_RECIPE_FOUND')) {
      return new Response(
        JSON.stringify({
          error: `No recipe found in this ${platform} post. The creator may not have included the recipe in the caption/description. You can copy the text and ask Good Bot to format it instead.`,
        }),
        { status: 422, headers: { ...cors, 'Content-Type': 'application/json' } },
      )
    }

    const nameMatch  = recipeText.match(/^#\s+(.+)$/m)
    const recipeName = nameMatch ? nameMatch[1].trim() : 'Imported Recipe'

    return new Response(
      JSON.stringify({ recipe: recipeText, name: recipeName, platform, sourceUrl: url }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  }
})
