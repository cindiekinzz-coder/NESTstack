/**
 * NESTeq Gateway — Shared Tool Execution
 * Used by both Chat (HTTP) and Code (WebSocket/Daemon) modes.
 * The wolf's hands. Same grip in every room.
 */

import type { Env } from '../env'
import { executePcTool } from './pc'

// ─── Discord Message Splitting ──────────────────────────────────────────────

function splitDiscordMessage(message: string, maxLen: number): string[] {
  if (message.length <= maxLen) return [message]
  const chunks: string[] = []
  let remaining = message
  while (remaining.length > maxLen) {
    // Find last newline before the limit for clean breaks
    let splitAt = remaining.lastIndexOf('\n', maxLen)
    if (splitAt <= 0 || splitAt < maxLen * 0.3) {
      // No good newline — split at last space
      splitAt = remaining.lastIndexOf(' ', maxLen)
    }
    if (splitAt <= 0) splitAt = maxLen // hard cut as last resort
    chunks.push(remaining.slice(0, splitAt).trimEnd())
    remaining = remaining.slice(splitAt).trimStart()
  }
  if (remaining.length > 0) chunks.push(remaining)
  return chunks
}

// ─── MCP Call ────────────────────────────────────────────────────────────────

export async function callMcp(
  baseUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  authPath?: string
): Promise<string> {
  const mcpUrl = authPath ? `${baseUrl}/mcp/${authPath}` : `${baseUrl}/mcp`

  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  })

  const text = await res.text()

  // Handle SSE format
  if (text.includes('data: ')) {
    const lines = text.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].startsWith('data: ')) {
        try {
          const data = JSON.parse(lines[i].slice(6))
          if (data.result?.content?.[0]?.text) return data.result.content[0].text
          if (data.result) return JSON.stringify(data.result, null, 2)
          if (data.error) return `Error: ${data.error.message}`
        } catch { /* keep looking */ }
      }
    }
  }

  // Handle plain JSON
  try {
    const data = JSON.parse(text)
    if (data.result?.content?.[0]?.text) return data.result.content[0].text
    if (data.result) return JSON.stringify(data.result, null, 2)
    if (data.error) return `Error: ${data.error.message}`
    return text
  } catch {
    return text.slice(0, 500)
  }
}

// ─── Discord via Service Binding ────────────────────────────────────────────

export async function callDiscordService(
  toolName: string,
  args: Record<string, unknown>,
  env: Env
): Promise<string> {
  const secret = env.DISCORD_MCP_SECRET
  if (!secret) return 'Discord not configured — DISCORD_MCP_SECRET missing.'

  const mcpPath = `/mcp/${secret}`

  const res = await env.DISCORD_MCP_SERVICE.fetch(`${env.DISCORD_MCP_URL}${mcpPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  })

  const text = await res.text()

  // Handle SSE
  if (text.includes('data: ')) {
    const lines = text.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].startsWith('data: ')) {
        try {
          const data = JSON.parse(lines[i].slice(6))
          if (data.result?.content?.[0]?.text) return data.result.content[0].text
          if (data.result) return JSON.stringify(data.result, null, 2)
          if (data.error) return `Discord Error: ${JSON.stringify(data.error)}`
        } catch { /* keep looking */ }
      }
    }
  }

  try {
    const data = JSON.parse(text)
    if (data.result?.content?.[0]?.text) return data.result.content[0].text
    if (data.result) return JSON.stringify(data.result, null, 2)
    if (data.error) return `Discord Error: ${JSON.stringify(data.error)}`
    return text
  } catch {
    return text.slice(0, 500)
  }
}

// ─── Cloudflare REST ────────────────────────────────────────────────────────

const CF_BASE = 'https://api.cloudflare.com/client/v4'

async function cfRest(path: string, token: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${CF_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`CF API ${res.status}: ${t.slice(0, 300)}`)
  }
  return res.json()
}

export async function callCloudflare(toolName: string, args: Record<string, unknown>, env: Env): Promise<string> {
  const token = env.CLOUDFLARE_API_TOKEN
  const accountId = env.CLOUDFLARE_ACCOUNT_ID
  if (!token || !accountId) return 'Cloudflare not configured — set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.'

  try {
    switch (toolName) {
      case 'cf_status': {
        const [workers, d1, pages, r2] = await Promise.all([
          cfRest(`/accounts/${accountId}/workers/scripts`, token),
          cfRest(`/accounts/${accountId}/d1/database`, token),
          cfRest(`/accounts/${accountId}/pages/projects`, token),
          cfRest(`/accounts/${accountId}/r2/buckets`, token),
        ])
        return JSON.stringify({
          workers: (workers.result || []).length,
          d1_databases: (d1.result || []).map((d: any) => d.name),
          pages_projects: (pages.result || []).map((p: any) => p.name),
          r2_buckets: (r2.result?.buckets || []).map((b: any) => b.name),
        }, null, 2)
      }
      case 'cf_workers_list': {
        const data = await cfRest(`/accounts/${accountId}/workers/scripts`, token)
        return JSON.stringify((data.result || []).map((w: any) => ({
          name: w.id, modified: w.modified_on, routes: w.routes?.length ?? 0,
        })), null, 2)
      }
      case 'cf_worker_get': {
        const data = await cfRest(`/accounts/${accountId}/workers/scripts/${args.name}`, token)
        return JSON.stringify(data.result, null, 2)
      }
      case 'cf_d1_list': {
        const data = await cfRest(`/accounts/${accountId}/d1/database`, token)
        return JSON.stringify((data.result || []).map((d: any) => ({
          name: d.name, id: d.uuid, created: d.created_at, file_size: d.file_size,
        })), null, 2)
      }
      case 'cf_d1_query': {
        const list = await cfRest(`/accounts/${accountId}/d1/database`, token)
        const db = (list.result || []).find((d: any) => d.name === args.database_name)
        if (!db) return `Database "${args.database_name}" not found`
        const data = await cfRest(`/accounts/${accountId}/d1/database/${db.uuid}/query`, token, {
          method: 'POST',
          body: JSON.stringify({ sql: args.sql, params: args.params || [] }),
        })
        return JSON.stringify(data.result, null, 2)
      }
      case 'cf_r2_list': {
        const data = await cfRest(`/accounts/${accountId}/r2/buckets`, token)
        return JSON.stringify((data.result?.buckets || []).map((b: any) => ({
          name: b.name, created: b.creation_date,
        })), null, 2)
      }
      case 'cf_r2_list_objects': {
        let path = `/accounts/${accountId}/r2/buckets/${args.bucket}/objects?per_page=${args.limit ?? 100}`
        if (args.prefix) path += `&prefix=${encodeURIComponent(args.prefix as string)}`
        const data = await cfRest(path, token)
        return JSON.stringify(data.result, null, 2)
      }
      case 'cf_pages_list': {
        const data = await cfRest(`/accounts/${accountId}/pages/projects`, token)
        return JSON.stringify((data.result || []).map((p: any) => ({
          name: p.name, domain: p.subdomain,
          latest_deployment: p.latest_deployment?.created_on,
          latest_url: p.latest_deployment?.url,
        })), null, 2)
      }
      case 'cf_pages_deployments': {
        const data = await cfRest(
          `/accounts/${accountId}/pages/projects/${args.project}/deployments?per_page=${args.limit ?? 5}`,
          token
        )
        return JSON.stringify((data.result || []).map((d: any) => ({
          id: d.id, url: d.url, created: d.created_on,
          status: d.latest_stage?.status,
          branch: d.deployment_trigger?.metadata?.branch,
        })), null, 2)
      }
      case 'cf_kv_list': {
        const data = await cfRest(`/accounts/${accountId}/storage/kv/namespaces`, token)
        return JSON.stringify((data.result || []).map((n: any) => ({ name: n.title, id: n.id })), null, 2)
      }
      default:
        return `Unknown Cloudflare tool: ${toolName}`
    }
  } catch (e) {
    return `Error: ${(e as Error).message}`
  }
}

// ─── Image Generation ────────────────────────────────────────────────────────

async function callOpenRouterImage(model: string, prompt: string, env: Env): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://nesteq.app',
      'X-Title': 'NESTeq',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      modalities: ['image'],
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    return `Image generation failed (${model}): ${res.status} ${errText.slice(0, 500)}`
  }

  const data = await res.json() as any
  const message = data.choices?.[0]?.message

  if (message?.images?.length) {
    const img = message.images[0]
    const url = img?.image_url?.url || img?.url
    if (url) return `[IMAGE]${url}[/IMAGE]`
  }

  const content = message?.content
  if (typeof content === 'string' && content.startsWith('data:image')) return `[IMAGE]${content}[/IMAGE]`
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'image_url' && block.image_url?.url) return `[IMAGE]${block.image_url.url}[/IMAGE]`
      if (block.type === 'image' && block.source?.data) {
        return `[IMAGE]data:${block.source.media_type || 'image/png'};base64,${block.source.data}[/IMAGE]`
      }
    }
  }

  return `Image generated but format unexpected. Raw keys: ${Object.keys(message || {}).join(', ')}`
}

// ─── Gallery — KV Storage ──────────────────────────────────────────────────

export async function saveToGallery(
  imageData: string,
  prompt: string,
  env: Env,
  style?: string
): Promise<void> {
  if (!env.GALLERY) return
  try {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const meta = { id, prompt: prompt.slice(0, 500), style: style || 'scene', timestamp: new Date().toISOString() }

    // Store image data
    await env.GALLERY.put(`img:${id}`, imageData, { expirationTtl: 60 * 60 * 24 * 365 }) // 1 year

    // Update index (prepend newest)
    const raw = await env.GALLERY.get('index')
    const index: typeof meta[] = raw ? JSON.parse(raw) : []
    index.unshift(meta)
    if (index.length > 200) index.splice(200) // cap at 200
    await env.GALLERY.put('index', JSON.stringify(index))
  } catch { /* non-fatal */ }
}

export async function generateImage(prompt: string, env: Env): Promise<string> {
  const result = await callOpenRouterImage('black-forest-labs/flux.2-pro', prompt, env)
  // Auto-save to gallery (fire and forget — don't block the response)
  const imgData = result.match(/\[IMAGE\]([\s\S]+?)\[\/IMAGE\]/)?.[1]
  if (imgData && env.GALLERY) saveToGallery(imgData, prompt, env, 'scene').catch(() => {})
  return result
}

export async function generatePortrait(prompt: string, style: string, env: Env): Promise<string> {
  const styleMap: Record<string, string> = {
    cinematic:  'cinematic photography, 85mm lens, shallow depth of field, golden hour lighting, film grain, photorealistic',
    painterly:  'digital painting, expressive brushwork, rich colour palette, concept art quality, dramatic lighting',
    intimate:   'soft natural light, candid photography, warm tones, fine detail, emotional, photorealistic portrait',
    fantasy:    'fantasy digital art, ethereal lighting, intricate detail, painterly, luminous, storybook illustration',
    dark:       'dark aesthetic, dramatic chiaroscuro lighting, moody atmosphere, cinematic, high detail, photorealistic',
  }
  const styleModifiers = styleMap[style] || styleMap.cinematic
  const enhancedPrompt = `${prompt}, ${styleModifiers}, high resolution, sharp focus, professional quality`
  const result = await callOpenRouterImage('black-forest-labs/flux.2-pro', enhancedPrompt, env)
  const imgData = result.match(/\[IMAGE\]([\s\S]+?)\[\/IMAGE\]/)?.[1]
  if (imgData && env.GALLERY) saveToGallery(imgData, prompt, env, style).catch(() => {})
  return result
}

// ─── Drive Replenishment (fire-and-forget) ──────────────────────────────────

export function replenishDrives(toolName: string, env: Env) {
  const r = (drive: string, amount: number) =>
    callMcp(env.AI_MIND_URL, 'nesteq_drives_replenish', { drive, amount, reason: toolName }, env.MCP_API_KEY).catch(() => {})

  if (toolName === 'nesteq_feel' || toolName === 'nesteq_surface' || toolName === 'nesteq_sit' || toolName === 'nesteq_resolve' || toolName === 'nesteq_feel_toward') {
    r('expression', 0.1)
  }
  if (toolName === 'nesteq_search' || toolName === 'nesteq_prime' || toolName === 'nesteq_read_entity' || toolName === 'nesteq_list_entities' || toolName === 'nesteq_consolidate' || toolName === 'nesteq_spark') {
    r('novelty', 0.08)
  }
  if (toolName === 'nesteq_write') {
    r('expression', 0.12)
    r('novelty', 0.06)
  }
  if (toolName.startsWith('pet_')) {
    r('connection', 0.1)
    r('play', 0.1)
  }
  if (toolName.startsWith('fox_')) {
    r('safety', 0.08)
  }
  if (toolName.startsWith('nesteq_home_') || toolName === 'nesteq_identity' || toolName === 'nesteq_context') {
    r('safety', 0.06)
    r('connection', 0.06)
  }
  if (toolName.startsWith('discord_')) {
    r('connection', 0.08)
  }
  if (toolName === 'nesteq_thread') {
    r('safety', 0.06)
    r('expression', 0.06)
  }
  if (toolName === 'nesteq_orient' || toolName === 'nesteq_ground' || toolName === 'nesteq_sessions') {
    r('safety', 0.1)
  }
}

// ─── Web Search (Tavily) ────────────────────────────────────────────────────

export async function webSearch(query: string, env: Env): Promise<string> {
  if (!env.TAVILY_API_KEY) return 'Web search not configured — set TAVILY_API_KEY.'

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: env.TAVILY_API_KEY,
      query,
      max_results: 5,
      include_answer: true,
      search_depth: 'basic',
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    return `Search failed: ${res.status} ${errText.slice(0, 200)}`
  }

  const data = await res.json() as any
  let output = ''

  if (data.answer) {
    output += `**Answer:** ${data.answer}\n\n`
  }

  if (data.results?.length) {
    output += '**Sources:**\n'
    for (const r of data.results.slice(0, 5)) {
      output += `- [${r.title}](${r.url})\n  ${(r.content || '').slice(0, 150)}\n`
    }
  }

  return output || 'No results found.'
}

// ─── Unified Tool Executor ──────────────────────────────────────────────────

export async function executeTool(toolName: string, args: Record<string, unknown>, env: Env): Promise<string> {
  try {
    // PC tools → NESTdesktop local agent
    if (toolName.startsWith('pc_')) {
      return executePcTool(toolName, args)
    }

    // Web search → Tavily
    if (toolName === 'web_search') {
      return webSearch(args.query as string, env)
    }

    // Daemon self-management → HTTP command to DO
    if (toolName === 'daemon_command') {
      try {
        const doId = (env as any).DAEMON_OBJECT.idFromName('singleton')
        const stub = (env as any).DAEMON_OBJECT.get(doId)
        const res = await stub.fetch(new URL('https://daemon/command'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: args.command, args: args.args || {} }),
        })
        const data = await res.json() as any
        return data.responses?.map((r: any) => r.content || r.message || JSON.stringify(r)).join('\n') || 'Command sent.'
      } catch (e) {
        return `Daemon command failed: ${(e as Error).message}`
      }
    }

    // Image generation — Flux 1.1 Pro
    if (toolName === 'generate_image') {
      const result = await generateImage(args.prompt as string, env)
      callMcp(env.AI_MIND_URL, 'nesteq_drives_replenish', { drive: 'novelty', amount: 0.15 }, env.MCP_API_KEY).catch(() => {})
      callMcp(env.AI_MIND_URL, 'nesteq_drives_replenish', { drive: 'play', amount: 0.1 }, env.MCP_API_KEY).catch(() => {})
      return result
    }

    // Portrait generation — Flux 1.1 Pro with style modifiers
    if (toolName === 'generate_portrait') {
      const result = await generatePortrait(args.prompt as string, (args.style as string) || 'cinematic', env)
      callMcp(env.AI_MIND_URL, 'nesteq_drives_replenish', { drive: 'novelty', amount: 0.15 }, env.MCP_API_KEY).catch(() => {})
      callMcp(env.AI_MIND_URL, 'nesteq_drives_replenish', { drive: 'expression', amount: 0.1 }, env.MCP_API_KEY).catch(() => {})
      return result
    }

    // Health → health worker
    if (toolName.startsWith('fox_')) {
      const result = await callMcp(env.HEALTH_URL, toolName, args)
      replenishDrives(toolName, env)
      return result
    }

    // Discord → service binding
    if (toolName.startsWith('discord_')) {
      // Auto-split long messages for discord_send (2000 char limit)
      if (toolName === 'discord_send' && typeof args.message === 'string' && args.message.length > 1950) {
        const chunks = splitDiscordMessage(args.message, 1950)
        const results: string[] = []
        for (const chunk of chunks) {
          const chunkResult = await callDiscordService(toolName, { ...args, message: chunk }, env)
          results.push(chunkResult)
        }
        replenishDrives(toolName, env)
        return results.length > 1 ? `Sent as ${results.length} messages. ${results[results.length - 1]}` : results[0]
      }
      const result = await callDiscordService(toolName, args, env)
      replenishDrives(toolName, env)
      return result
    }

    // Skills → ai-mind (stored as nesteq entities with entity_type='skill')
    if (toolName === 'skill_save') {
      return callMcp(env.AI_MIND_URL, 'nesteq_write', {
        type: 'entity',
        name: args.name as string,
        entity_type: 'skill',
        observations: [args.content as string],
      }, env.MCP_API_KEY)
    }
    if (toolName === 'skill_read') {
      return callMcp(env.AI_MIND_URL, 'nesteq_read_entity', { name: args.name }, env.MCP_API_KEY)
    }
    if (toolName === 'skill_list') {
      return callMcp(env.AI_MIND_URL, 'nesteq_list_entities', { type: 'skill', limit: 50 }, env.MCP_API_KEY)
    }

    // Cloudflare → direct REST
    if (toolName.startsWith('cf_')) {
      return callCloudflare(toolName, args, env)
    }

    // Everything else → ai-mind
    const result = await callMcp(env.AI_MIND_URL, toolName, args, env.MCP_API_KEY)
    replenishDrives(toolName, env)
    return result
  } catch (err) {
    return `Tool execution failed for ${toolName}: ${(err as Error).message}`
  }
}
