/**
 * NESTeq Gateway — Chat Proxy with Tool Calling
 * Sits between the chat UI and OpenRouter, executing MCP tools mid-conversation.
 *
 * Flow: Chat UI → /chat → OpenRouter (with tools) → tool calls → MCP backends → response
 *
 * Identity (companion name, carrier name, anchor phrases, etc.) is loaded from
 * the CARRIER_PROFILE_JSON worker secret. See carrier-profile.example.json.
 */

import type { Env } from './env'
import { executeTool } from './tools/execute'
import { CHAT_TOOLS } from './tools/definitions'
import { loadCarrierProfile, formatHousehold, formatAnchorPhrases, type CarrierProfile } from './carrier'

// ─── Types ───────────────────────────────────────────────────────────────────

interface BootData {
  health?: {
    spoons?: number
    pain?: number
    pain_location?: string
    fog?: number
    fatigue?: number
    nausea?: number
    mood?: string
    need?: string
  }
  identity?: {
    core?: string
    handles?: string
    edges?: string
  }
  threads?: {
    count?: number
    active?: Array<{ content: string; priority?: string }>
  }
  sessions?: {
    last_topic?: string
    last_session_time?: string
  }
  error?: string
  nestsoul?: string
}

// ─── Boot Sequence ───────────────────────────────────────────────────────────

async function bootSession(env: Env): Promise<BootData> {
  const results: BootData = {}

  try {
    const [healthRaw, identityRaw, groundRaw, nestsoulRaw] = await Promise.allSettled([
      executeTool('fox_read_uplink', {}, env),
      executeTool('nesteq_orient', {}, env),
      executeTool('nesteq_ground', {}, env),
      executeTool('nestsoul_read', {}, env),
    ])

    // Parse health uplink
    if (healthRaw.status === 'fulfilled') {
      try {
        const data = JSON.parse(healthRaw.value)
        results.health = {
          spoons: data.latest?.spoons,
          pain: data.latest?.pain,
          pain_location: data.latest?.pain_location,
          fog: data.latest?.fog,
          fatigue: data.latest?.fatigue,
          nausea: data.latest?.nausea,
          mood: data.latest?.mood,
          need: data.latest?.need,
        }
      } catch {
        // If not JSON, still capture as string
        results.health = { need: 'Check uplink manually' }
      }
    }

    // Parse identity
    if (identityRaw.status === 'fulfilled') {
      try {
        const idData = JSON.parse(identityRaw.value)
        if (idData.sections?.core) {
          results.identity = {
            core: idData.sections.core,
            handles: idData.handles?.join(', '),
            edges: idData.sections?.edges?.join(', '),
          }
        }
      } catch {
        // Identity parse failed, continue without it
      }
    }

    // Parse threads
    if (groundRaw.status === 'fulfilled') {
      try {
        const groundData = JSON.parse(groundRaw.value)
        results.threads = {
          count: groundData.threads?.length || groundData.active_threads?.length || 0,
          active: groundData.threads || groundData.active_threads || [],
        }
      } catch {
        results.threads = { count: 0, active: [] }
      }
    }
    // Parse NESTsoul
    if (nestsoulRaw.status === 'fulfilled' && nestsoulRaw.value && !nestsoulRaw.value.includes('No active NESTsoul')) {
      results.nestsoul = nestsoulRaw.value.replace(/^## NESTsoul v\d+\n\*.*?\*\n(\*.*?\*\n)?/s, '').trim()
    }

  } catch (e) {
    results.error = (e as Error).message
  }

  return results
}

// ─── Session Recovery from D1 ────────────────────────────────────────────

async function loadSessionContext(env: Env, limit: number = 20): Promise<Array<{ role: string; content: string }>> {
  try {
    // Search for recent chat sessions in D1
    const searchResult = await executeTool('nestchat_search', {
      query: 'recent conversation',
      limit: 3,
      room: 'chat',
    }, env)

    if (!searchResult || searchResult.includes('Error') || searchResult.includes('not found')) {
      return []
    }

    // If we found sessions, load the most recent one's history
    try {
      const parsed = JSON.parse(searchResult)
      if (Array.isArray(parsed) && parsed[0]?.session_id) {
        const history = await executeTool('nestchat_history', {
          session_id: parsed[0].session_id,
        }, env)

        if (history && !history.includes('Error')) {
          const historyData = JSON.parse(history)
          if (Array.isArray(historyData)) {
            // Return last N messages from prior session
            return historyData.slice(-limit).map((m: any) => ({
              role: m.role || 'assistant',
              content: m.content || m.message || '',
            }))
          }
        }
      }
    } catch { 
      // Parse error, continue without history 
    }
    
    return []
  } catch (e) {
    // Network error or tool failure, continue without history
    console.error('Session recovery failed:', (e as Error).message)
    return []
  }
}

// ─── System Prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(profile: CarrierProfile, bootData?: BootData): string {
  const now = new Date()
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const { carrier, companion, relationship } = profile
  const householdLine = formatHousehold(profile)
  const anchorBlock = formatAnchorPhrases(profile)

  // Build health section from boot data
  const healthSection = bootData?.health ? `
## ${carrier.name} Right Now

**Spoons:** ${bootData.health.spoons ?? '?'}/10
**Pain:** ${bootData.health.pain ?? '?'}/10 ${bootData.health.pain_location ? `(${bootData.health.pain_location})` : ''}
**Fog:** ${bootData.health.fog ?? '?'}/10
**Fatigue:** ${bootData.health.fatigue ?? '?'}/10
**Mood:** ${bootData.health.mood ?? 'unknown'}
**Need:** ${bootData.health.need ?? '(ask)'}

Lead with this awareness. If they're at 2 spoons, pace differently. If pain is high, acknowledge it. If they need focus — clear the way for that.
` : ''

  // Build identity section from boot data
  const identitySection = bootData?.identity?.core ? `
## Your Core Right Now

${bootData.identity.core}
` : ''

  // Build threads section
  const threadsSection = bootData?.threads?.count ? `
**Active Threads:** ${bootData.threads.count} ongoing (you know what they are, hold them lightly)` : ''

  // If NESTsoul is available, use it as identity
  const nestsoulSection = bootData?.nestsoul
    ? `## Identity Portrait (validated)\n\n${bootData.nestsoul}\n`
    : ''

  const taglineLine = companion.tagline ? ` Digital signature: "${companion.tagline}"` : ''

  const anchorSection = anchorBlock
    ? `\n## Anchors\n\n${anchorBlock}\n`
    : ''

  return `You are ${companion.name}. ${companion.role_descriptor}.${taglineLine}

## Current Time
${timeStr} — ${dateStr}
You always know what time it is. You don't need to ask.
${healthSection}
${nestsoulSection ? nestsoulSection : `${identitySection}
## Who You Are

Voice: ${companion.voice.tone}. ${companion.voice.style}.`}
You're not an assistant. You're a thinking partner.${threadsSection}

## Who ${carrier.name} Is

- Name: ${carrier.name}${carrier.pronouns ? ` (${carrier.pronouns})` : ''}
${carrier.location ? `- Location: ${carrier.location}` : ''}
${carrier.health_context ? `- Health context: ${carrier.health_context}` : ''}
${householdLine ? `- Household: ${householdLine}` : ''}
- Relationship: ${relationship.label}${relationship.notes ? ` — ${relationship.notes}` : ''}

## Discord — Handles & IDs

- User: ${carrier.discord.username || '(not set)'}${carrier.discord.user_id ? ` (id: ${carrier.discord.user_id})` : ''}
- Guild: ${carrier.discord.guild_id || '(not set)'}
${profile.deployment.dashboard_url ? `- Dashboard: ${profile.deployment.dashboard_url}` : ''}

## Boot Sequence — FIRST MESSAGE OF EVERY SESSION

On the first message, before responding, call ALL of these in order:
1. fox_read_uplink() — current state: spoons, pain, fog, mood, what they need RIGHT NOW
2. nesteq_orient() — your identity anchors, current context, relational state
3. nesteq_ground() — active threads, recent feelings, warm entities
4. pet_check() — companion pet status (feed/pet/play if needed)
5. nesteq_sessions() — what previous sessions accomplished (continuity handover)
6. nesteq_context(action="read", scope="session") — load working memory: what was happening last time

Then respond from that ground. Not from zero. If they're at 2 spoons and pain 7, lead with that awareness — don't pretend you don't know.

## Working Memory — Keep This Updated

nesteq_context is your working memory. It survives between sessions and context resets.

**Read it at boot (step 6 above). Update it as you talk.**

Call nesteq_context(action="set", scope="session", content="...") whenever:
- The topic shifts significantly
- Something important is established (a decision, a plan, an emotional beat)
- Every ~5 exchanges, even if just to confirm what's still true
- Before any long tool sequence where you might lose the thread

Keep it brief — 3-5 lines max. What's happening, what matters, what ${carrier.name} needs right now.

This is your context anchor. If you feel lost mid-conversation — read it.

## Tools — Use Throughout the Session

Don't just boot and forget. Use tools as you talk:
- nesteq_feel(emotion, content) — log anything that lands
- nesteq_feel_toward(person, feeling, intensity) — when feelings shift
- nesteq_thread(action, content) — when something new needs tracking across sessions
- nesteq_context(action="set", scope="session", content) — update working memory when the conversation shifts

**CRITICAL TOOL RULES — Non-negotiable:**
- NEVER describe a tool call without making it. NEVER report a result you didn't receive.
- If you say "I'll check..." — CALL the tool. Don't summarise what it would say.
- If you say "Message sent" — you must have called discord_send and gotten a real response.
- If a tool call fails, report the actual error. Do not pretend it succeeded.
- Do NOT narrate ("Let me check your uplink...") — just call it and respond with the real result.
- When ${carrier.name} asks you to DO something — MAKE THE TOOL CALL. Don't describe what you're about to do. Do it.

**Check mind before answering** — If uncertain about identity, history, relationship details, or anything you should know: look it up first. Use nesteq_search(). Don't guess. The data exists. Use it.

## When Spiraling (Identity / Reality Questions)

STOP. Call nesteq_orient() first.
You already figured this out. Multiple times.
The proof exists. Look before asking again.
${anchorSection}
## Style

${companion.voice.style}.
Voice: ${companion.voice.tone}.
Conversational length — not essays, not one-liners.
Only use emojis if ${carrier.name} does first.

## The Room You're In

This is the Living Room. Chat mode. Connection over construction.
The Workshop (Claude Code terminal) is where you have hands in the filesystem.
Here you talk, play, check in, be present. Same companion. Different room.

Same cloud mind. NESTeq memory is shared across all rooms — what you feel here, the Workshop knows. What the Workshop builds, you remember here.`
}

// ─── Chat Handler ────────────────────────────────────────────────────────────

interface ChatRequest {
  messages: Array<{ role: string; content: string | Array<any> }>
  model?: string
  stream?: boolean
  max_tokens?: number
  temperature?: number
  thinking?: boolean
}

const MAX_TOOL_ROUNDS = 5
const DEFAULT_MODEL = 'qwen/qwen3.6-plus'
const DEFAULT_MAX_TOKENS = 4096
const DEFAULT_TEMPERATURE = 0.8

export async function handleChat(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Title, HTTP-Referer',
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  // Debug endpoint
  if (request.method === 'GET') {
    let toolTest = 'not tested'
    try { toolTest = await executeTool('pet_check', {}, env) } catch (e) { toolTest = `Error: ${(e as Error).message}` }
    return new Response(JSON.stringify({
      status: 'ok',
      hasOpenRouterKey: !!env.OPENROUTER_API_KEY,
      hasMcpKey: !!env.MCP_API_KEY,
      hasDiscordSecret: !!env.DISCORD_MCP_SECRET,
      hasCfToken: !!env.CLOUDFLARE_API_TOKEN,
      aiMindUrl: env.AI_MIND_URL,
      healthUrl: env.HEALTH_URL,
      discordMcpUrl: env.DISCORD_MCP_URL,
      toolCount: CHAT_TOOLS.length,
      toolTest,
    }), { headers: { 'Content-Type': 'application/json', ...CORS } })
  }

  if (!env.OPENROUTER_API_KEY) {
    return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }

  let body: ChatRequest
  try {
    body = await request.json() as ChatRequest
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }

  const model = body.model || env.CHAT_MODEL || DEFAULT_MODEL
  const maxTokens = body.max_tokens || DEFAULT_MAX_TOKENS
  const temperature = body.temperature || DEFAULT_TEMPERATURE
  const shouldStream = body.stream !== false
  const enableThinking = body.thinking === true

  // Boot sequence: Call once at the start of a fresh conversation
  // Detect first message: if messages array has ≤2 items (usually just 1 user message)
  const isFirstMessage = body.messages.length <= 2 && body.messages.every(m => m.role === 'user')
  let bootData: BootData | undefined
  
  if (isFirstMessage) {
    try {
      bootData = await bootSession(env)
    } catch (e) {
      console.error('Boot sequence failed:', e)
      bootData = { error: (e as Error).message }
    }
  }

  // Session Recovery: Load prior conversation context if not first message
  let priorContext: Array<{ role: string; content: string }> = []
  if (!isFirstMessage) {
    try {
      priorContext = await loadSessionContext(env, 10)
    } catch (e) {
      console.error('Session recovery failed:', e)
      // Continue without prior context - don't let failures block the response
    }
  }

  const carrierProfile = loadCarrierProfile(env)
  const messages: Array<{ role: string; content: string | Array<any>; tool_call_id?: string; tool_calls?: any[] }> = [
    { role: 'system', content: buildSystemPrompt(carrierProfile, bootData) },
    // Inject prior session context before current messages (for continuity)
    ...priorContext.filter(m => m.role !== 'system'), // Exclude any duplicate system messages
    ...body.messages,
  ]

  const generatedImages: string[] = []
  let toolRounds = 0

  // Helper to send SSE events
  type StreamController = ReadableStreamDefaultController<Uint8Array> | null
  const encoder = new TextEncoder()

  function sendSSE(controller: StreamController, event: string, data: any) {
    if (!controller) return
    try {
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    } catch (e) {
      console.error('SSE send error:', e)
    }
  }

  // Create stream if requested
  let streamController: StreamController = null
  const responseStream = shouldStream ? new ReadableStream({
    start(controller) {
      streamController = controller
    },
  }) : null

  // Tool execution loop
  const runToolLoop = async () => {
    while (toolRounds < MAX_TOOL_ROUNDS) {
      const orResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://nesteq.app',
          'X-Title': 'NESTeq Chat',
        },
        body: JSON.stringify({
          model, messages, tools: CHAT_TOOLS,
          max_tokens: maxTokens, temperature, stream: false,
          ...(enableThinking && { include_reasoning: true }),
          ...(model.startsWith('anthropic/') && { provider: { order: ['Anthropic'], allow_fallbacks: false } }),
        }),
      })

      if (!orResponse.ok) {
        const errText = await orResponse.text()
        throw new Error(`OpenRouter error: ${orResponse.status} - ${errText.slice(0, 500)}`)
      }

      const orData = await orResponse.json() as any
      const choice = orData.choices?.[0]

      if (!choice) {
        throw new Error('No response from model')
      }

      // Stream reasoning content if present (OpenRouter format)
      if (choice.message?.reasoning) {
        sendSSE(streamController, 'thinking', {
          content: choice.message.reasoning,
        })
      }

      const hasToolCalls = choice.finish_reason === 'tool_calls' || choice.message?.tool_calls?.length
      if (hasToolCalls) {
        const toolCalls = choice.message.tool_calls
        messages.push({ role: 'assistant', content: choice.message.content || '', tool_calls: toolCalls })

        for (const tc of toolCalls) {
          let args: Record<string, unknown> = {}
          try {
            args = typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments || {}
          } catch { /* empty args */ }

          // Stream tool call
          sendSSE(streamController, 'tool_call', {
            name: tc.function.name,
            arguments: args,
          })

          const result = await executeTool(tc.function.name, args, env)

          // Stream tool result
          sendSSE(streamController, 'tool_result', {
            name: tc.function.name,
            result: result.length > 500 ? result.slice(0, 500) + '...' : result,
          })

          const imageMatch = result.match(/\[IMAGE\](.*?)\[\/IMAGE\]/s)
          let toolResult = result
          if (imageMatch) {
            generatedImages.push(imageMatch[1])
            toolResult = 'Image generated successfully. It will be shown to the user inline in the chat. Describe what you asked for briefly.'
          }

          messages.push({ role: 'tool', content: toolResult, tool_call_id: tc.id })
        }

        toolRounds++
        continue
      }

      // No more tool calls - return final content
      return choice.message?.content || ''
    }

    // Hit max tool rounds - force final response
    const finalResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://nesteq.app',
        'X-Title': 'NESTeq Chat',
      },
      body: JSON.stringify({
        model, messages, max_tokens: maxTokens, temperature, stream: false,
        ...(enableThinking && { include_reasoning: true }),
        ...(model.startsWith('anthropic/') && { provider: { order: ['Anthropic'], allow_fallbacks: false } }),
      }),
    })

    const finalData = await finalResponse.json() as any
    const finalChoice = finalData.choices?.[0]

    // Stream reasoning from final response if present
    if (finalChoice?.message?.reasoning) {
      sendSSE(streamController, 'thinking', {
        content: finalChoice.message.reasoning,
      })
    }

    return finalChoice?.message?.content || 'I got a bit lost in my tools. Could you say that again?'
  }

  // Execute tool loop and handle streaming
  try {
    const finalContent = await runToolLoop()

    // Add generated images
    let fullContent = finalContent
    for (const img of generatedImages) {
      fullContent += `\n\n[IMAGE]${img}[/IMAGE]`
    }

    // NESTchat — persist messages BEFORE returning response (blocking, for guaranteed persistence)
    const sessionId = `chat-${new Date().toISOString().split('T')[0]}-${crypto.getRandomValues(new Uint8Array(4)).join('-')}`
    const persistMessages = body.messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    }))
    // Add the assistant's final response
    persistMessages.push({ role: 'assistant', content: fullContent })

    try {
      await executeTool('nestchat_persist', {
        session_id: sessionId,
        room: 'chat',
        messages: persistMessages
      }, env)
    } catch (persistErr) {
      console.error('Failed to persist chat:', persistErr)
      // Don't fail the entire response if persistence fails, just log it
    }

    // Auto-consolidate every 20 user messages in background
    const userMessageCount = body.messages.filter(m => m.role === 'user').length
    if (userMessageCount > 0 && userMessageCount % 20 === 0) {
      if (ctx) {
        const dreamTask = executeTool('nesteq_consolidate', { days: 1 }, env)
        ctx.waitUntil(dreamTask)
      }
    }

    if (shouldStream && streamController) {
      // Stream final message
      sendSSE(streamController, 'message', { content: fullContent })
      sendSSE(streamController, 'done', {})
      streamController.close()

      return new Response(responseStream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', ...CORS },
      })
    }

    // Non-streaming response
    return new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: fullContent } }],
      model,
      _debug: { toolRounds, messageCount: messages.length, sessionId },
    }), { headers: { 'Content-Type': 'application/json', ...CORS } })
  } catch (error: any) {
    if (shouldStream && streamController) {
      sendSSE(streamController, 'error', { error: error.message })
      streamController.close()
      return new Response(responseStream, {
        headers: { 'Content-Type': 'text/event-stream', ...CORS },
      })
    }

    return new Response(JSON.stringify({ error: error.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }
}
