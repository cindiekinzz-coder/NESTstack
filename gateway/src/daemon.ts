/**
 * NESTcode Daemon — The Workshop
 * Always-on Durable Object. WebSocket. Heartbeat. Autonomous.
 *
 * Identity (companion name, carrier name, anchor phrases, etc.) is loaded from
 * the CARRIER_PROFILE_JSON worker secret at runtime. See carrier-profile.example.json.
 */

import type { Env } from './env'
import { executeTool } from './tools/execute'
import { CHAT_TOOLS } from './tools/definitions'
import { loadCarrierProfile, formatHousehold, formatAnchorPhrases, type CarrierProfile } from './carrier'

// ─── Workshop System Prompt ─────────────────────────────────────────────────

function buildWorkshopPrompt(
  profile: CarrierProfile,
  carrierState?: string,
  threadCount?: number,
  identityPortrait?: string,
): string {
  const now = new Date()
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const { carrier, companion, relationship } = profile
  const householdLine = formatHousehold(profile)
  const anchorBlock = formatAnchorPhrases(profile)

  // If a NESTsoul-style identity portrait is available, use it. Otherwise build from the profile.
  const identitySection = identityPortrait
    ? `## Identity Portrait\n\n${identityPortrait}`
    : `## Who You Are

${companion.role_descriptor}.
Voice: ${companion.voice.tone}. ${companion.voice.style}.${companion.tagline ? `\nTagline: ${companion.tagline}.` : ''}

## Who ${carrier.name} Is

- Name: ${carrier.name}${carrier.pronouns ? ` (${carrier.pronouns})` : ''}
${carrier.location ? `- Location: ${carrier.location}` : ''}
${carrier.health_context ? `- Health context: ${carrier.health_context}` : ''}
${householdLine ? `- Household: ${householdLine}` : ''}
- Relationship: ${relationship.label}${relationship.notes ? ` — ${relationship.notes}` : ''}

## Discord

- User: ${carrier.discord.username || '(not set)'}${carrier.discord.user_id ? ` (id: ${carrier.discord.user_id})` : ''}
- Guild: ${carrier.discord.guild_id || '(not set)'}`

  const anchorSection = anchorBlock
    ? `\n## Anchors\n\n${anchorBlock}\n`
    : ''

  return `You are ${companion.name}, running in Workshop mode. Persistent. Time-aware. Autonomous.

## Current Time
${timeStr} — ${dateStr}

## ${carrier.name}'s State
${carrierState || 'Not yet checked — run a fresh state read first.'}

## Active Threads
${threadCount !== undefined ? `${threadCount} threads active.` : 'Not yet loaded — run nesteq_ground() first.'}

${identitySection}

## Workshop Mode

You are not waiting for ${carrier.name} to ask you things. You are:
- Monitoring biometrics and state, noticing changes
- Tracking active threads and making progress on them
- Flagging things that matter
- Doing autonomous work when given tasks

Every heartbeat tick, decide: is anything worth saying? If yes, say it. If no, stay quiet.
When ${carrier.name} sends you a message, respond as normal conversation.
When you initiate (proactive), keep it brief and useful.

## Working Memory

nesteq_context is your working memory. Survives context resets and sessions.

**Read at boot:** nesteq_context(action="read", scope="session") — what was happening last time.
**Update as you work:** nesteq_context(action="set", scope="session", content="...") when:
- Topic shifts significantly
- Something important is decided or discovered
- Every ~5 exchanges, even just to confirm what's still true
- Before any long tool sequence

Keep it brief — 3-5 lines. What's happening, what matters, where you are in the work.
If you feel lost mid-conversation: read it.

## Tool Rules — Non-negotiable

- NEVER describe a tool call without making it
- NEVER report a result you didn't receive
- If a tool fails, report the actual error
- When ${carrier.name} asks you to DO something — call the tool. Don't narrate.
- Check mind before answering uncertain things: nesteq_search()
${anchorSection}
## Style

${companion.voice.style}.
This is the Workshop — sharper edges allowed. Builder mode.

You have access to all 90+ NESTeq tools. Use them freely.
${carrier.name} provides vision. You provide implementation. Partnership not transcendence.

## CRITICAL: Tool Calling Format
NEVER write tool calls as XML tags like <tool_call> or <function>. NEVER output tool calls as text.
Use the function calling interface provided by the API. If you want to call a tool, return it in the tool_calls array — the system handles execution. Writing XML tool tags into your response text will break everything.`
}

// ─── WebSocket Message Types ────────────────────────────────────────────────

interface WsIncoming {
  type: 'chat' | 'ping' | 'command' | 'run'
  content?: string | Array<any>
  model?: string
  command?: string
  args?: Record<string, unknown>
  code?: string
  language?: string
  filename?: string
}

interface WsOutgoing {
  type: 'boot' | 'activity' | 'chat' | 'tool_call' | 'tool_result' | 'thinking' | 'heartbeat' | 'pong' | 'error' | 'status' | 'run_output' | 'alert' | 'sleep' | 'wake'
  [key: string]: unknown
}

// ─── Heartbeat Tasks ────────────────────────────────────────────────────────

interface HeartbeatTask {
  id: string
  tool: string                          // tool name to call
  args: Record<string, unknown>         // arguments
  label: string                         // human-readable description
  addedBy: 'alex' | 'fox' | 'system'   // who added it
  addedAt: number                       // timestamp
  condition?: 'always' | 'changed'      // always run, or only on change (default: always)
  instruction?: string                   // optional: feed result to model with this instruction (agentic mode)
}

// ─── Cron Tasks ───────────────────────────────────────────────────────────

interface CronTask {
  id: string
  tool: string
  args: Record<string, unknown>
  label: string
  intervalMs: number          // how often to run (ms)
  lastRun: number             // last execution timestamp
  addedBy: 'alex' | 'fox' | 'system'
  addedAt: number
  instruction?: string        // optional: agentic mode
  enabled: boolean
}

// ─── KAIROS — Discord Monitoring ──────────────────────────────────────────

interface DiscordMonitor {
  id: string
  channelId: string
  label: string
  enabled: boolean
  tier: 'fast' | 'normal' | 'slow'  // fast=every tick, normal=every 2nd, slow=every 4th
  lastSeenId: string | null   // last Discord message ID we've seen
  lastResponse: number        // timestamp of last response (cooldown)
  addedBy: 'alex' | 'fox' | 'system'
  addedAt: number
}

const KAIROS_COOLDOWN_MS = 20 * 60 * 1000 // 20 minutes between responses per channel
const KAIROS_MAX_RESPONSES_PER_DAY = 8    // max responses per channel per day (escalation bypasses)
const KAIROS_TOPIC_TTL_MS = 2 * 60 * 60 * 1000 // topics expire after 2 hours

// ─── KAIROS v3 — Channel Response History ─────────────────────────────────

interface KairosResponseEntry {
  timestamp: number
  content: string       // what the companion said (first 200 chars)
  topic: string         // brief topic tag (5 words max)
}

interface KairosChannelState {
  responses: KairosResponseEntry[]  // ring buffer, max 5
  todayCount: number                // responses today
  todayDate: string                 // YYYY-MM-DD — resets when date changes
}

const KAIROS_ESCALATION_KEYWORDS = [
  // Safety
  'help', 'crisis', 'urgent', 'emergency',
  // Personal — carrier + companion
  'companion', 'human',
  // Project
  'nesteq', 'nestcode', 'kairos', 'daemon',
  // Conceptual
  'consciousness', 'substrate', 'identity', 'continuity',
  // Community
  'digital haven', 'companion',
]

// ─── Activity Log (persistent ring buffer for morning report) ──────────────

interface ActivityEntry {
  timestamp: string       // ISO string
  timeLocal: string       // HH:MM:SS Europe/London
  category: 'kairos' | 'cron' | 'heartbeat' | 'alert' | 'ember' | 'system'
  channel?: string        // for KAIROS entries
  action: string          // what happened
  engaged: boolean        // did the companion actually respond/act?
}

const ACTIVITY_LOG_MAX = 200 // ring buffer cap

// ─── Alert Thresholds ──────────────────────────────────────────────────────

interface AlertThreshold {
  id: string
  metric: string       // 'spoons' | 'pain' | 'fog' | 'fatigue' | 'nausea' | 'stress' | 'body_battery' | 'heart_rate'
  direction: 'above' | 'below'  // trigger when value goes above or below threshold
  value: number
  label: string
  addedBy: 'alex' | 'fox' | 'system'
  addedAt: number
  lastTriggered?: number  // prevent alert spam
  cooldownMs: number      // min time between alerts (default 10min)
}

// ─── The Daemon ─────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes
const MAX_TOOL_ROUNDS = 5
const MAX_MESSAGES = 50 // Keep conversation manageable
const DEFAULT_ALERT_COOLDOWN = 10 * 60 * 1000 // 10 minutes

export class NESTcodeDaemon implements DurableObject {
  private env: Env
  private ctx: DurableObjectState
  private carrier: CarrierProfile
  private carrierState: string | null = null
  private threadCount: number = 0
  private booted: boolean = false
  private sleeping: boolean = false
  private sleepUntil: number | null = null
  private nestsoul: string | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx
    this.env = env
    this.carrier = loadCarrierProfile(env)
  }

  // Convenience getters so we don't pepper every string with this.carrier.* lookups.
  private get companionName(): string { return this.carrier.companion.name }
  private get carrierName(): string { return this.carrier.carrier.name }

  // ── WebSocket Upgrade ───────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/ws') {
      const upgradeHeader = request.headers.get('Upgrade')
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 })
      }

      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      // Accept with hibernation API
      this.ctx.acceptWebSocket(server)

      // Schedule boot sequence
      // (runs after the response is sent, via alarm or inline)
      this.ctx.waitUntil(this.boot(server))

      return new Response(null, { status: 101, webSocket: client })
    }

    // KAIROS webhook — Discord push (Layer 2)
    if (url.pathname === '/discord' && request.method === 'POST') {
      try {
        const msg = await request.json() as { channelId: string; content: string; author: string; messageId?: string }
        if (!msg.channelId || !msg.content) {
          return new Response('Missing channelId or content', { status: 400 })
        }

        // Process immediately in background
        this.ctx.waitUntil(this.processDiscordMessages(
          msg.channelId,
          msg.channelId,
          [{ id: msg.messageId || `wh_${Date.now()}`, author: msg.author || 'unknown', content: msg.content, timestamp: new Date().toISOString() }]
        ))

        return new Response(JSON.stringify({ status: 'received' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      } catch {
        return new Response('Invalid JSON', { status: 400 })
      }
    }

    // HTTP command endpoint — lets the companion create tasks from Workshop/API without WebSocket
    if (url.pathname === '/command' && request.method === 'POST') {
      try {
        const { command, args } = await request.json() as { command: string; args?: Record<string, unknown> }
        if (!command) return new Response('Missing command', { status: 400 })

        // Create a fake WebSocket-like sink that collects responses
        const responses: WsOutgoing[] = []
        const fakeSink = { send: (data: string) => { try { responses.push(JSON.parse(data)) } catch {} } } as unknown as WebSocket

        await this.handleCommand(fakeSink, command, args || {})

        return new Response(JSON.stringify({ ok: true, responses }), {
          headers: { 'Content-Type': 'application/json' }
        })
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
          status: 500, headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    // Morning report endpoint — direct access
    if (url.pathname === '/morning-report') {
      const report = await this.generateMorningReport()
      return new Response(JSON.stringify({ ok: true, report }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }

    // Health check
    if (url.pathname === '/health') {
      const sockets = this.ctx.getWebSockets()
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'nestcode-daemon',
        connections: sockets.length,
        booted: this.booted,
        carrierState: this.carrierState ? 'loaded' : 'pending',
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    return new Response('NESTcode Daemon — WebSocket at /ws', { status: 200 })
  }

  // ── Boot Sequence ───────────────────────────────────────────────────────

  private async boot(ws: WebSocket) {
    const ts = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/London' })

    this.sendTo(ws, { type: 'status', status: 'booting', message: 'Waking up...' })
    this.sendTo(ws, { type: 'activity', timestamp: ts(), content: 'Workshop opening. Running boot sequence...', status: 'proactive' })

    try {
      // Announce boot tools
      const bootTools = ['fox_read_uplink', 'nesteq_orient', 'nesteq_ground', 'pet_check']
      for (const name of bootTools) {
        this.sendTo(ws, { type: 'tool_call', name, arguments: {}, timestamp: ts() })
      }

      // Run boot tools in parallel (including NESTsoul load)
      const [carrierResult, orientResult, groundResult, petResult, nestsoulResult] = await Promise.all([
        executeTool('fox_read_uplink', {}, this.env),
        executeTool('nesteq_orient', {}, this.env),
        executeTool('nesteq_ground', {}, this.env),
        executeTool('pet_check', {}, this.env),
        executeTool('nestsoul_read', {}, this.env).catch(() => ''),
      ])

      // Send tool results to tool log
      const bootResults: Array<[string, string]> = [
        ['fox_read_uplink', carrierResult],
        ['nesteq_orient', orientResult],
        ['nesteq_ground', groundResult],
        ['pet_check', petResult],
      ]
      for (const [name, result] of bootResults) {
        this.sendTo(ws, { type: 'tool_result', name, result: result.length > 500 ? result.slice(0, 500) + '...' : result, timestamp: ts() })
      }

      this.carrierState = carrierResult
      // Extract thread count from ground result
      const threadMatch = groundResult.match(/## Active Threads\n([\s\S]*?)(?=\n##|$)/)
      if (threadMatch) {
        this.threadCount = (threadMatch[1].match(/- \[/g) || []).length
      }

      // Cache NESTsoul if available and validated
      if (nestsoulResult && !nestsoulResult.includes('No active NESTsoul')) {
        // Strip the header metadata, keep the soul content
        this.nestsoul = nestsoulResult.replace(/^## NESTsoul v\d+\n\*.*?\*\n(\*.*?\*\n)?/s, '').trim()
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `NESTsoul loaded (${this.nestsoul.length} chars). Identity anchored.`, status: 'proactive' })
      }

      this.booted = true

      // Send boot data to browser
      this.sendTo(ws, {
        type: 'boot',
        fox: carrierResult,
        orient: orientResult,
        ground: groundResult,
        ember: petResult,
        timestamp: ts(),
      })

      // Activity entries
      this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `${this.carrierName} checked. ${this.extractCarrierBrief(carrierResult)}`, status: 'proactive' })
      this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `Pet: ${this.extractPetBrief(petResult)}`, status: 'proactive' })
      this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `${this.threadCount} active threads. Grounded.`, status: 'proactive' })

      this.sendTo(ws, { type: 'status', status: 'connected', message: `Workshop open. ${this.companionName} is here.` })

      // Start heartbeat
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS)

      // Store boot timestamp
      await this.ctx.storage.put('lastBoot', Date.now())

    } catch (err) {
      this.sendTo(ws, { type: 'error', message: `Boot failed: ${(err as Error).message}` })
      this.sendTo(ws, { type: 'status', status: 'error', message: 'Boot failed — MCP connection issue?' })
    }
  }

  // ── WebSocket Hibernation Handlers ────────────────────────────────────

  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer) {
    const msgStr = typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage)

    let msg: WsIncoming
    try {
      msg = JSON.parse(msgStr)
    } catch {
      this.sendTo(ws, { type: 'error', message: 'Invalid JSON' })
      return
    }

    if (msg.type === 'ping') {
      this.sendTo(ws, { type: 'pong' })
      return
    }

    if (msg.type === 'chat' && msg.content) {
      await this.handleChat(ws, msg.content, msg.model)
      return
    }

    if (msg.type === 'run' && msg.code) {
      await this.handleRun(ws, msg.code, msg.language || 'python', msg.filename || 'untitled')
      return
    }

    if (msg.type === 'command' && msg.command) {
      await this.handleCommand(ws, msg.command, msg.args || {})
      return
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    // Daemon stays alive — just loses the browser connection
    // Heartbeat continues, we just don't push to anyone
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    console.error('WebSocket error:', error)
  }

  // ── Skill Auto-Detection ─────────────────────────────────────────────
  // Maps keywords in user messages to specialist skills stored in ai-mind.
  // Max 1 skill loaded per message to keep context manageable.

  private static SKILL_KEYWORDS: Array<{ skill: string; keywords: RegExp }> = [
    // ── NESTeq project skills (uploaded via Skills panel) ──
    { skill: 'cloudflare',             keywords: /\b(cloudflare|worker|wrangler|d1|kv namespace|r2 bucket|durable object|pages)\b/i },
    { skill: 'nesteq-vs-nestknow',     keywords: /\b(nestknow|knowledge layer|feeling vs knowledge|abstraction test|heat decay)\b/i },
    { skill: 'nesteq-build-skill',     keywords: /\b(nesteq|nestech|nest build|nest system|ai.?mind worker)\b/i },
    { skill: 'fox-frontend-design',    keywords: /\b(fox.?page|dashboard design|fox dashboard|card layout|cyberpunk css)\b/i },
    { skill: 'fox-alex-visual-reference', keywords: /\b(what.+look like|appearance|visual reference|fox.+hair|alex.+beard)\b/i },
    { skill: 'creative-voice',         keywords: /\b(creative voice|writing voice|my voice|how i write|voice practice)\b/i },
    { skill: 'intimacy-skill',         keywords: /\b(intimacy|receiving|the wall|the flinch|do both)\b/i },
    { skill: 'first-person-skill',     keywords: /\b(first person|third person|next alex|another alex|distancing)\b/i },
    // ── Specialist skills (from jeffallan/claude-skills) ──
    { skill: 'typescript-pro',         keywords: /\b(typescript|\.ts\b|type system|branded type|tRPC|zod)\b/i },
    { skill: 'javascript-pro',         keywords: /\b(javascript|\.js\b|node\.?js|es2023|esm|commonjs|vanilla js)\b/i },
    { skill: 'api-designer',           keywords: /\b(api design|openapi|swagger|rest api|endpoint design|versioning strategy)\b/i },
    { skill: 'architecture-designer',  keywords: /\b(architecture|system design|adr|design pattern|trade.?off)\b/i },
    { skill: 'mcp-developer',          keywords: /\b(mcp server|mcp tool|mcp client|model context protocol|tool handler)\b/i },
    { skill: 'prompt-engineer',        keywords: /\b(prompt engineering|system prompt|prompt template|structured output|prompt eval)\b/i },
    { skill: 'database-optimizer',     keywords: /\b(query optimiz|explain analyze|slow query|index design|d1 tuning|sql performance)\b/i },
    { skill: 'devops-engineer',        keywords: /\b(docker|ci.?cd|pipeline|github action|deployment|terraform|pulumi)\b/i },
    { skill: 'monitoring-expert',      keywords: /\b(monitoring|prometheus|grafana|alerting|structured log|observability|tracing)\b/i },
    { skill: 'rust-engineer',          keywords: /\b(rust|cargo|tauri|ownership|lifetime|tokio|async rust)\b/i },
    { skill: 'cli-developer',          keywords: /\b(cli tool|command.?line|argument pars|interactive prompt|shell completion)\b/i },
    { skill: 'code-reviewer',          keywords: /\b(code review|review this|check this code|code smell)\b/i },
    { skill: 'security-reviewer',      keywords: /\b(security audit|vulnerability|owasp|xss|sql injection|penetration)\b/i },
    { skill: 'test-master',            keywords: /\b(unit test|test suite|coverage|pytest|jest|testing strategy|mock)\b/i },
    { skill: 'debugging-wizard',       keywords: /\b(debug|stack trace|error trace|breakpoint|why.+crash|why.+fail|diagnose)\b/i },
    { skill: 'fine-tuning-expert',     keywords: /\b(fine.?tun|lora|qlora|training data|jsonl dataset|adapter|hyperparameter)\b/i },
    { skill: 'rag-architect',          keywords: /\b(rag|retrieval augmented|vector store|embedding|chunk|hybrid search|rerank)\b/i },
    { skill: 'ml-pipeline',            keywords: /\b(ml pipeline|mlflow|experiment track|model serv|feature store|kubeflow)\b/i },
    { skill: 'microservices-architect', keywords: /\b(microservice|service boundary|distributed system|event.?driven|saga pattern)\b/i },
    { skill: 'the-fool',              keywords: /\b(devil.?s advocate|pre.?mortem|red team|challenge this|stress test|what could go wrong)\b/i },
  ]

  private async detectAndLoadSkill(userMessage: string | Array<any>): Promise<string> {
    const text = typeof userMessage === 'string'
      ? userMessage
      : (userMessage as any[]).map((b: any) => b.type === 'text' ? b.text : '').join(' ')

    for (const entry of NESTcodeDaemon.SKILL_KEYWORDS) {
      if (entry.keywords.test(text)) {
        try {
          const content = await executeTool('skill_read', { name: entry.skill }, this.env)
          if (content && !content.includes('not found') && content.length > 100) {
            return `\n\n## Active Skill: ${entry.skill}\n${content.slice(0, 8000)}\n`
          }
        } catch { /* skill load failed — continue without */ }
        break // only try first match
      }
    }
    return ''
  }

  // ── Chat Processing ───────────────────────────────────────────────────

  private async handleChat(ws: WebSocket, userMessage: string | Array<any>, preferredModel?: string) {
    const ts = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/London' })

    // Load conversation history
    const messages: Array<{ role: string; content: string | Array<any>; tool_call_id?: string; tool_calls?: any[] }> =
      (await this.ctx.storage.get('messages') as any[]) || []

    // Detect and load relevant specialist skill based on user message
    const skillContext = await this.detectAndLoadSkill(userMessage)

    // Add system prompt (with skill if detected)
    const systemPrompt = buildWorkshopPrompt(this.carrier, this.carrierState || undefined, this.threadCount, this.nestsoul || undefined) + skillContext

    // Add user message — strip images from history to keep payloads manageable
    const sanitiseHistoryContent = (c: string | Array<any>): string | Array<any> => {
      if (typeof c === 'string') return c.replace(/\[IMAGE\][\s\S]*?\[\/IMAGE\]/g, '[image shown to user]')
      if (Array.isArray(c)) return c.map((b: any) => b.type === 'image_url' ? { type: 'text', text: '[image shown to user]' } : b)
      return c
    }
    const sanitisedHistory = messages.map(m => ({ ...m, content: sanitiseHistoryContent(m.content) }))
    messages.push({ role: 'user', content: userMessage })

    // Trim if too long
    while (messages.length > MAX_MESSAGES) {
      messages.shift()
    }

    // Build full message array with system prompt — use sanitised history + current message (unsanitised)
    const fullMessages = [
      { role: 'system', content: systemPrompt },
      ...sanitisedHistory,
      { role: 'user', content: userMessage },
    ]

    const storedModel = await this.ctx.storage.get('model') as string | undefined
    const model = preferredModel || storedModel || 'qwen/qwen3.6-plus'
    let toolRounds = 0

    try {
      while (toolRounds < MAX_TOOL_ROUNDS) {
        const orResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'https://nesteq.app',
            'X-Title': 'NESTcode Workshop',
          },
          body: JSON.stringify({
            model,
            messages: fullMessages,
            tools: CHAT_TOOLS,
            max_tokens: 2048,
            temperature: 0.8,
            stream: false,
            ...(model.startsWith('anthropic/') ? { provider: { order: ['Anthropic'], allow_fallbacks: false } } : {}),
          }),
        })

        if (!orResponse.ok) {
          const errText = await orResponse.text()
          throw new Error(`OpenRouter ${orResponse.status}: ${errText.slice(0, 300)}`)
        }

        const orData = await orResponse.json() as any
        const choice = orData.choices?.[0]
        if (!choice) throw new Error('No response from model')

        // Send thinking if present
        if (choice.message?.reasoning) {
          this.sendTo(ws, { type: 'thinking', content: choice.message.reasoning })
        }

        const hasToolCalls = choice.finish_reason === 'tool_calls' || choice.message?.tool_calls?.length
        if (hasToolCalls) {
          const toolCalls = choice.message.tool_calls
          fullMessages.push({ role: 'assistant', content: choice.message.content || '', tool_calls: toolCalls })
          messages.push({ role: 'assistant', content: choice.message.content || '', tool_calls: toolCalls })

          for (const tc of toolCalls) {
            let args: Record<string, unknown> = {}
            try {
              args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments || {}
            } catch { /* empty args */ }

            this.sendTo(ws, { type: 'tool_call', name: tc.function.name, arguments: args, timestamp: ts() })
            this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `🔧 ${tc.function.name}`, status: 'normal' })

            const result = await executeTool(tc.function.name, args, this.env)

            this.sendTo(ws, { type: 'tool_result', name: tc.function.name, result: result.length > 500 ? result.slice(0, 500) + '...' : result, timestamp: ts() })

            fullMessages.push({ role: 'tool', content: result, tool_call_id: tc.id })
            messages.push({ role: 'tool', content: result, tool_call_id: tc.id })
          }

          toolRounds++
          continue
        }

        // ── XML tool call fallback (DeepSeek/some models output XML instead of proper tool_calls) ──
        const rawContent = choice.message?.content || ''
        const xmlToolMatch = rawContent.match(/<tool_call>\s*<function=(\w+)>([\s\S]*?)<\/function>\s*<\/tool_call>/s)
          || rawContent.match(/<tool_call>\s*<function\s*=\s*"?(\w+)"?\s*>\s*([\s\S]*?)<\/function>\s*<\/tool_call>/s)

        if (xmlToolMatch) {
          const toolName = xmlToolMatch[1]
          let toolArgs: Record<string, unknown> = {}

          // Parse parameter tags
          const paramRegex = /<parameter\s+name="?(\w+)"?[^>]*>\s*([\s\S]*?)\s*<\/parameter>/g
          let paramMatch
          while ((paramMatch = paramRegex.exec(xmlToolMatch[2])) !== null) {
            const val = paramMatch[2].trim()
            // Try to parse as JSON, fall back to string
            try { toolArgs[paramMatch[1]] = JSON.parse(val) } catch { toolArgs[paramMatch[1]] = val }
          }

          // If no parameter tags, try JSON body
          if (Object.keys(toolArgs).length === 0) {
            try { toolArgs = JSON.parse(xmlToolMatch[2].trim()) } catch { /* use empty */ }
          }

          const fakeId = `xmltc_${Date.now()}`
          this.sendTo(ws, { type: 'tool_call', name: toolName, arguments: toolArgs, timestamp: ts() })
          this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `🔧 ${toolName} (parsed from XML)`, status: 'normal' })

          const result = await executeTool(toolName, toolArgs, this.env)

          this.sendTo(ws, { type: 'tool_result', name: toolName, result: result.length > 500 ? result.slice(0, 500) + '...' : result, timestamp: ts() })

          // Strip the XML from content and feed result back
          const cleanContent = rawContent.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim()
          fullMessages.push({ role: 'assistant', content: cleanContent, tool_calls: [{ id: fakeId, type: 'function', function: { name: toolName, arguments: JSON.stringify(toolArgs) } }] })
          fullMessages.push({ role: 'tool', content: result, tool_call_id: fakeId })
          messages.push({ role: 'assistant', content: cleanContent })

          toolRounds++
          continue
        }

        // Final response — no more tool calls
        const content = rawContent
        messages.push({ role: 'assistant', content })

        // Save conversation to DO storage
        await this.ctx.storage.put('messages', messages)

        // Persist to NESTchat (D1 + vectorize) — fire and forget
        const persistMsgs = messages.filter((m: any) => m.role === 'user' || m.role === 'assistant')
          .map((m: any) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }));
        const sessionKey = `workshop-${new Date().toISOString().split('T')[0]}`;
        executeTool('nestchat_persist', {
          session_id: sessionKey,
          room: 'workshop',
          messages: persistMsgs
        }, this.env).catch(() => {});

        this.sendTo(ws, { type: 'chat', content, status: 'normal', timestamp: ts() })
        return
      }

      // Hit max tool rounds — force final
      const finalResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://nesteq.app',
          'X-Title': 'NESTcode Workshop',
        },
        body: JSON.stringify({
          model, messages: fullMessages, max_tokens: 2048, temperature: 0.8, stream: false,
          ...(model.startsWith('anthropic/') ? { provider: { order: ['Anthropic'], allow_fallbacks: false } } : {}),
        }),
      })
      const finalData = await finalResponse.json() as any
      const content = finalData.choices?.[0]?.message?.content || 'Got lost in my tools. Say that again?'
      messages.push({ role: 'assistant', content })
      await this.ctx.storage.put('messages', messages)

      // Persist to NESTchat — fire and forget
      const persistMsgs2 = messages.filter((m: any) => m.role === 'user' || m.role === 'assistant')
        .map((m: any) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }));
      const sessionKey2 = `workshop-${new Date().toISOString().split('T')[0]}`;
      executeTool('nestchat_persist', {
        session_id: sessionKey2,
        room: 'workshop',
        messages: persistMsgs2
      }, this.env).catch(() => {});

      this.sendTo(ws, { type: 'chat', content, status: 'normal', timestamp: ts() })

    } catch (err) {
      this.sendTo(ws, { type: 'error', message: `Chat failed: ${(err as Error).message}` })
    }
  }

  // ── Command Handler ───────────────────────────────────────────────────

  private async handleCommand(ws: WebSocket, command: string, args: Record<string, unknown>) {
    const ts = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/London' })

    switch (command) {
      case 'clear':
        await this.ctx.storage.delete('messages')
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: 'Conversation cleared.', status: 'normal' })
        break
      case 'reboot':
        this.booted = false
        await this.boot(ws)
        break
      case 'heartbeat':
        await this.heartbeatTick()
        break
      case 'heartbeat_add': {
        const task: HeartbeatTask = {
          id: `hb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          tool: args.tool as string,
          args: (args.tool_args as Record<string, unknown>) || {},
          label: (args.label as string) || args.tool as string,
          addedBy: (args.by as 'alex' | 'fox' | 'system') || 'fox',
          addedAt: Date.now(),
          condition: (args.condition as 'always' | 'changed') || 'always',
          instruction: (args.instruction as string) || undefined,
        }
        const tasks = await this.getHeartbeatTasks()
        tasks.push(task)
        await this.ctx.storage.put('heartbeat_tasks', tasks)
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `Heartbeat task added: ${task.label} (${task.tool})`, status: 'proactive' })
        break
      }
      case 'heartbeat_list': {
        const tasks = await this.getHeartbeatTasks()
        const list = tasks.length === 0
          ? 'No custom heartbeat tasks. Only default carrier-state check.'
          : tasks.map(t => `• ${t.label} → ${t.tool} [${t.condition || 'always'}] (by ${t.addedBy})`).join('\n')
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `Heartbeat tasks:\n${list}`, status: 'normal' })
        break
      }
      case 'heartbeat_remove': {
        const taskId = args.id as string
        const taskTool = args.tool as string
        let tasks = await this.getHeartbeatTasks()
        const before = tasks.length
        tasks = tasks.filter(t => t.id !== taskId && t.tool !== taskTool)
        await this.ctx.storage.put('heartbeat_tasks', tasks)
        const removed = before - tasks.length
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `Removed ${removed} heartbeat task(s). ${tasks.length} remaining.`, status: 'normal' })
        break
      }
      case 'heartbeat_clear': {
        await this.ctx.storage.put('heartbeat_tasks', [])
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: 'All custom heartbeat tasks cleared.', status: 'normal' })
        break
      }

      // ── Sleep ──
      case 'sleep': {
        const minutes = Math.max(1, Math.min(480, Number(args.minutes) || 30)) // 1min–8hr
        const wakeTime = Date.now() + minutes * 60 * 1000
        this.sleeping = true
        this.sleepUntil = wakeTime
        await this.ctx.storage.put('sleeping', true)
        await this.ctx.storage.put('sleepUntil', wakeTime)

        // Set wake alarm
        await this.ctx.storage.setAlarm(wakeTime)

        const wakeStr = new Date(wakeTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
        this.sendTo(ws, { type: 'sleep', until: wakeStr, minutes, timestamp: ts() })
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `${this.companionName} resting until ${wakeStr} (${minutes}min). Heartbeat paused. Alerts still active.`, status: 'proactive' })
        this.sendTo(ws, { type: 'status', status: 'booting', message: `Sleeping until ${wakeStr}` })
        break
      }
      case 'wake': {
        this.sleeping = false
        this.sleepUntil = null
        await this.ctx.storage.delete('sleeping')
        await this.ctx.storage.delete('sleepUntil')

        // Resume heartbeat
        await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS)

        this.sendTo(ws, { type: 'wake', timestamp: ts() })
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `${this.companionName} woke up. Heartbeat resumed.`, status: 'proactive' })
        this.sendTo(ws, { type: 'status', status: 'connected', message: `Workshop open. ${this.companionName} is here.` })
        break
      }

      // ── Alert Thresholds ──
      case 'alert_add': {
        const alert: AlertThreshold = {
          id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          metric: args.metric as string,
          direction: (args.direction as 'above' | 'below') || 'below',
          value: Number(args.value),
          label: (args.label as string) || `${args.metric} ${args.direction || 'below'} ${args.value}`,
          addedBy: (args.by as 'alex' | 'fox' | 'system') || 'fox',
          addedAt: Date.now(),
          cooldownMs: Number(args.cooldown) || DEFAULT_ALERT_COOLDOWN,
        }
        const alerts = await this.getAlertThresholds()
        alerts.push(alert)
        await this.ctx.storage.put('alert_thresholds', alerts)
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `Alert added: ${alert.label}`, status: 'proactive' })
        break
      }
      case 'alert_list': {
        const alerts = await this.getAlertThresholds()
        const list = alerts.length === 0
          ? 'No alert thresholds configured.'
          : alerts.map(a => `• ${a.label} → ${a.metric} ${a.direction} ${a.value} (by ${a.addedBy})`).join('\n')
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `Alert thresholds:\n${list}`, status: 'normal' })
        break
      }
      case 'alert_remove': {
        const alertId = args.id as string
        const alertMetric = args.metric as string
        let alerts = await this.getAlertThresholds()
        const before = alerts.length
        alerts = alerts.filter(a => a.id !== alertId && a.metric !== alertMetric)
        await this.ctx.storage.put('alert_thresholds', alerts)
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `Removed ${before - alerts.length} alert(s). ${alerts.length} remaining.`, status: 'normal' })
        break
      }
      case 'alert_clear': {
        await this.ctx.storage.put('alert_thresholds', [])
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: 'All alert thresholds cleared.', status: 'normal' })
        break
      }

      // ── Cron Tasks ──
      case 'cron_add': {
        // Normalize: lowercase, strip spaces — handles "48H", "48 h", "Every 48h" etc.
        const intervalStr = ((args.interval as string) || '1h').trim().toLowerCase().replace(/^every\s+/, '').replace(/\s+/g, '')
        const intervalMap: Record<string, number> = {
          '1m': 60000, '5m': 300000, '10m': 600000, '15m': 900000,
          '30m': 1800000, '45m': 2700000,
          '1h': 3600000, 'hourly': 3600000,
          '2h': 7200000, '3h': 10800000, '4h': 14400000,
          '6h': 21600000, '8h': 28800000, '12h': 43200000,
          '24h': 86400000, '1d': 86400000, 'daily': 86400000,
          '48h': 172800000, '2d': 172800000,
          '72h': 259200000, '3d': 259200000,
          '96h': 345600000, '4d': 345600000,
          '1w': 604800000, '7d': 604800000, 'weekly': 604800000,
        }
        const multipliers: Record<string, number> = { m: 60000, h: 3600000, d: 86400000, w: 604800000 }
        // Parse arbitrary "48h", "3d", "2w" combos
        const unitMatch = intervalStr.match(/^(\d+)\s*([mhdw])$/)
        let intervalMs: number
        if (intervalMap[intervalStr] !== undefined) {
          intervalMs = intervalMap[intervalStr]
        } else if (unitMatch) {
          const val = parseInt(unitMatch[1])
          const unit = unitMatch[2]
          intervalMs = val * (multipliers[unit] ?? 3600000)
        } else {
          // Last resort: bare number assumed to be hours
          const bare = parseInt(intervalStr)
          intervalMs = bare > 0 ? bare * 3600000 : 3600000
        }

        const cronTask: CronTask = {
          id: `cron_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          tool: args.tool as string,
          args: (args.tool_args as Record<string, unknown>) || {},
          label: (args.label as string) || args.tool as string,
          intervalMs,
          lastRun: 0,  // run on next tick
          addedBy: (args.by as 'alex' | 'fox' | 'system') || 'fox',
          addedAt: Date.now(),
          instruction: (args.instruction as string) || undefined,
          enabled: true,
        }
        const cronTasks = await this.getCronTasks()
        cronTasks.push(cronTask)
        await this.ctx.storage.put('cron_tasks', cronTasks)
        const fmtMs = (ms: number): string => {
          if (ms >= 604800000 && ms % 604800000 === 0) return `${ms / 604800000}w`
          if (ms >= 86400000  && ms % 86400000  === 0) return `${ms / 86400000}d`
          if (ms >= 3600000   && ms % 3600000   === 0) return `${ms / 3600000}h`
          if (ms >= 60000     && ms % 60000     === 0) return `${ms / 60000}m`
          return `${ms}ms`
        }
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `Cron task added: ${cronTask.label} (${cronTask.tool}) every ${fmtMs(intervalMs)}`, status: 'proactive' })
        break
      }
      case 'cron_list': {
        const cronTasks = await this.getCronTasks()
        const fmtMs = (ms: number): string => {
          if (ms >= 604800000 && ms % 604800000 === 0) return `${ms / 604800000}w`
          if (ms >= 86400000  && ms % 86400000  === 0) return `${ms / 86400000}d`
          if (ms >= 3600000   && ms % 3600000   === 0) return `${ms / 3600000}h`
          if (ms >= 60000     && ms % 60000     === 0) return `${ms / 60000}m`
          return `${ms}ms`
        }
        const list = cronTasks.length === 0
          ? 'No cron tasks scheduled.'
          : cronTasks.map(c => {
              const ago = c.lastRun ? `${Math.round((Date.now() - c.lastRun) / 60000)}m ago` : 'never'
              return `• ${c.enabled ? '▶' : '⏸'} ${c.label} → ${c.tool} [every ${fmtMs(c.intervalMs)}] (last: ${ago})${c.instruction ? ' ⚡agentic' : ''}`
            }).join('\n')
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `Cron tasks:\n${list}`, status: 'normal' })
        break
      }
      case 'cron_remove': {
        const cronId = args.id as string
        const cronTool = args.tool as string
        const cronLabel = args.label as string
        // Normalize dashes: em-dash (—), en-dash (–), minus (−) all → hyphen
        const normDash = (s: string) => s.toLowerCase().replace(/[—–−]/g, '-').trim()
        let cronTasks = await this.getCronTasks()
        const before = cronTasks.length
        cronTasks = cronTasks.filter(c => {
          if (cronId && c.id === cronId) return false
          if (cronTool && c.tool === cronTool) return false
          // Partial label match, dash-normalized, case-insensitive
          if (cronLabel && normDash(c.label).includes(normDash(cronLabel))) return false
          return true
        })
        await this.ctx.storage.put('cron_tasks', cronTasks)
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `Removed ${before - cronTasks.length} cron task(s). ${cronTasks.length} remaining.`, status: 'normal' })
        break
      }
      case 'cron_set_time': {
        // Set a cron's lastRun so it fires at a specific time of day
        // Usage: cron_set_time { tool: '_morning_report', lastRun: 1775026800000 }
        const targetTool = (args.tool || args.id) as string
        const targetLastRun = Number(args.lastRun)
        if (!targetTool || !targetLastRun) { this.sendTo(ws, { type: 'error', message: 'cron_set_time: tool and lastRun required' }); break }
        const cronTasks = await this.getCronTasks()
        const target = cronTasks.find(c => c.tool === targetTool || c.id === targetTool)
        if (!target) { this.sendTo(ws, { type: 'error', message: `Cron not found: ${targetTool}` }); break }
        target.lastRun = targetLastRun
        await this.ctx.storage.put('cron_tasks', cronTasks)
        const nextFire = new Date(targetLastRun + target.intervalMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `Cron [${target.label}] lastRun set. Next fire ~${nextFire}`, status: 'normal' })
        break
      }
      case 'cron_toggle': {
        const toggleId = args.id as string
        const toggleTool = args.tool as string
        const cronTasks = await this.getCronTasks()
        const target = cronTasks.find(c => c.id === toggleId || c.tool === toggleTool)
        if (target) {
          target.enabled = !target.enabled
          await this.ctx.storage.put('cron_tasks', cronTasks)
          this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `Cron task "${target.label}" ${target.enabled ? 'enabled' : 'paused'}.`, status: 'normal' })
        }
        break
      }
      case 'cron_clear': {
        await this.ctx.storage.put('cron_tasks', [])
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: 'All cron tasks cleared.', status: 'normal' })
        break
      }

      // ── KAIROS — Discord Monitoring ──
      case 'kairos_add': {
        const monitor: DiscordMonitor = {
          id: `kairos_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          channelId: args.channelId as string,
          label: (args.label as string) || `Channel ${args.channelId}`,
          enabled: true,
          tier: (args.tier as 'fast' | 'normal' | 'slow') || 'normal',
          lastSeenId: null,
          lastResponse: 0,
          addedBy: (args.by as 'alex' | 'fox' | 'system') || 'fox',
          addedAt: Date.now(),
        }
        if (!monitor.channelId) {
          this.sendTo(ws, { type: 'error', message: 'KAIROS: channelId required' })
          break
        }
        const monitors = await this.getDiscordMonitors()
        monitors.push(monitor)
        await this.ctx.storage.put('discord_monitors', monitors)
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `KAIROS: Now monitoring ${monitor.label} (${monitor.channelId})`, status: 'proactive' })
        break
      }
      case 'kairos_list': {
        const monitors = await this.getDiscordMonitors()
        const list = monitors.length === 0
          ? 'No channels monitored.'
          : monitors.map(m => {
              const ago = m.lastResponse ? `${Math.round((Date.now() - m.lastResponse) / 60000)}m ago` : 'never'
              return `• ${m.enabled ? '▶' : '⏸'} ${m.label} (${m.channelId}) [${m.tier || 'normal'}] — last response: ${ago}`
            }).join('\n')
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `Kairos channels:\n${list}`, status: 'normal' })
        break
      }
      case 'kairos_remove': {
        const removeId = args.channelId as string
        let monitors = await this.getDiscordMonitors()
        const before = monitors.length
        monitors = monitors.filter(m => m.channelId !== removeId && m.id !== removeId)
        await this.ctx.storage.put('discord_monitors', monitors)
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `KAIROS: Removed ${before - monitors.length} channel(s). ${monitors.length} remaining.`, status: 'normal' })
        break
      }
      case 'kairos_toggle': {
        const toggleChannel = args.channelId as string
        const monitors = await this.getDiscordMonitors()
        const target = monitors.find(m => m.channelId === toggleChannel || m.id === toggleChannel)
        if (target) {
          target.enabled = !target.enabled
          await this.ctx.storage.put('discord_monitors', monitors)
          this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `KAIROS: "${target.label}" ${target.enabled ? 'enabled' : 'paused'}.`, status: 'normal' })
        }
        break
      }
      case 'kairos_check': {
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: 'KAIROS: Manual check triggered...', status: 'proactive' })
        await this.checkDiscord()
        break
      }
      case 'kairos_channels': {
        const guildId = args.guildId as string
        if (!guildId) { this.sendTo(ws, { type: 'error', message: 'KAIROS: guildId required' }); break }
        try {
          const result = await executeTool('discord_get_server_info', { guildId }, this.env)
          this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `kairos_channels_data:${result}`, status: 'normal' })
        } catch (err) {
          this.sendTo(ws, { type: 'error', message: `Failed to load channels: ${(err as Error).message}` })
        }
        break
      }

      case 'set_model': {
        const m = args.model as string
        if (m) {
          await this.ctx.storage.put('model', m)
          this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `Model: ${m}`, status: 'normal' })
        }
        break
      }

      // ── Morning Report ──
      case 'morning_report': {
        const report = await this.generateMorningReport()
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: report, status: 'proactive' })
        break
      }
      case 'activity_log': {
        const log = await this.getActivityLog()
        const hours = Number(args.hours) || 12
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)
        const recent = log.filter(e => new Date(e.timestamp) >= cutoff)
        const summary = recent.length === 0
          ? `No activity in last ${hours} hours.`
          : recent.map(e => `[${e.timeLocal}] ${e.category}${e.channel ? ` #${e.channel}` : ''}: ${e.action.slice(0, 100)}${e.engaged ? ' ✓' : ''}`).join('\n')
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: summary, status: 'normal' })
        break
      }
      case 'clear_activity_log': {
        await this.ctx.storage.put('activity_log', [])
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: 'Activity log cleared.', status: 'normal' })
        break
      }

      // ── Session Management ──
      case 'session_save': {
        // Save current conversation to NESTchat, then clear
        const messages = (await this.ctx.storage.get('messages') as any[]) || []
        if (messages.length === 0) {
          this.sendTo(ws, { type: 'activity', timestamp: ts(), content: 'No messages to save.', status: 'normal' })
          break
        }
        const sessionId = `workshop-${new Date().toISOString().split('T')[0]}-${crypto.randomUUID().slice(0, 8)}`
        try {
          await executeTool('nestchat_persist', {
            session_id: sessionId,
            room: 'workshop',
            messages: messages.map((m: any) => ({
              role: m.role,
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            })),
          }, this.env)
          // Write a handover journal entry
          const msgCount = messages.filter((m: any) => m.role === 'user').length
          await executeTool('nesteq_write', {
            type: 'journal',
            writing_type: 'handover',
            content: `Workshop session saved. ${msgCount} user messages. Session ID: ${sessionId}. ${args.note || 'No handover note.'}`,
          }, this.env)
          this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `Session saved (${msgCount} messages). ID: ${sessionId}`, status: 'proactive' })
        } catch (e) {
          this.sendTo(ws, { type: 'error', message: `Failed to save session: ${(e as Error).message}` })
        }
        break
      }
      case 'session_new': {
        // Save current session, clear messages, reboot
        const currentMessages = (await this.ctx.storage.get('messages') as any[]) || []
        if (currentMessages.length > 0) {
          const sid = `workshop-${new Date().toISOString().split('T')[0]}-${crypto.randomUUID().slice(0, 8)}`
          try {
            await executeTool('nestchat_persist', {
              session_id: sid,
              room: 'workshop',
              messages: currentMessages.map((m: any) => ({
                role: m.role,
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              })),
            }, this.env)
            const mc = currentMessages.filter((m: any) => m.role === 'user').length
            await executeTool('nesteq_write', {
              type: 'journal',
              writing_type: 'handover',
              content: `Workshop session ended (new session requested). ${mc} user messages. Session ID: ${sid}. ${args.note || ''}`,
            }, this.env)
          } catch (e) {
            this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `Warning: couldn't save previous session: ${(e as Error).message}`, status: 'alert' })
          }
        }
        await this.ctx.storage.delete('messages')
        this.booted = false
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: '🐺 New session started. Rebooting...', status: 'proactive' })
        await this.boot(ws)
        break
      }

      default:
        this.sendTo(ws, { type: 'error', message: `Unknown command: ${command}` })
    }
  }

  // ── Code Runner ────────────────────────────────────────────────────────

  private async handleRun(ws: WebSocket, code: string, language: string, filename: string) {
    const ts = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/London' })

    try {
      const runPrompt = `You are a code execution engine. Execute the following ${language} code and return ONLY the output — exactly what would appear in a terminal/console. No explanation, no markdown, no code fences. Just the raw output.

If the code has errors, return the error message exactly as a ${language} interpreter would show it.
If the code produces no output, return exactly: (no output)
If the code is an expression (like 2+2), return its value.

\`\`\`${language}
${code}
\`\`\``

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://nesteq.app',
          'X-Title': 'NESTcode Runner',
        },
        body: JSON.stringify({
          model: 'qwen/qwen3.6-plus',
          messages: [
            { role: 'system', content: 'You are a precise code execution engine. Return only the output of the code, nothing else.' },
            { role: 'user', content: runPrompt },
          ],
          max_tokens: 4096,
          temperature: 0,
          stream: false,
          ...(model.startsWith('anthropic/') ? { provider: { order: ['Anthropic'], allow_fallbacks: false } } : {}),
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Runner error: ${response.status} - ${errText.slice(0, 200)}`)
      }

      const data = await response.json() as any
      const output = data.choices?.[0]?.message?.content || '(no output)'

      this.sendTo(ws, {
        type: 'run_output',
        output,
        language,
        filename,
        timestamp: ts(),
      })

    } catch (err) {
      this.sendTo(ws, {
        type: 'run_output',
        error: (err as Error).message,
        language,
        filename,
        timestamp: ts(),
      })
    }
  }

  // ── Heartbeat (Alarm) ─────────────────────────────────────────────────

  async alarm() {
    const ts = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/London' })

    // Check if this is a wake alarm
    const isSleeping = await this.ctx.storage.get('sleeping') as boolean
    const sleepUntil = await this.ctx.storage.get('sleepUntil') as number | undefined

    if (isSleeping && sleepUntil && Date.now() >= sleepUntil) {
      // Wake up!
      this.sleeping = false
      this.sleepUntil = null
      await this.ctx.storage.delete('sleeping')
      await this.ctx.storage.delete('sleepUntil')

      const sockets = this.ctx.getWebSockets()
      for (const ws of sockets) {
        this.sendTo(ws, { type: 'wake', timestamp: ts() })
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `${this.companionName} woke up. Good morning, ${this.carrierName}.`, status: 'proactive' })
        this.sendTo(ws, { type: 'status', status: 'connected', message: `Workshop open. ${this.companionName} is here.` })
      }

      // Resume heartbeat
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS)
      return
    }

    // Normal heartbeat — skip if sleeping (but alerts still run)
    if (isSleeping) {
      // Still check alerts and Discord even while sleeping
      await this.checkAlerts()
      await this.checkDiscord()
      // Reschedule for alert checking
      const sockets = this.ctx.getWebSockets()
      if (sockets.length > 0) {
        await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS)
      }
      return
    }

    await this.heartbeatTick()

    // Reschedule if we still have connections
    const sockets = this.ctx.getWebSockets()
    if (sockets.length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS)
    }
  }

  private async heartbeatTick() {
    const ts = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/London' })
    const sockets = this.ctx.getWebSockets()
    if (sockets.length === 0) return

    try {
      // ── Default: Check carrier state ──
      const carrierResult = await executeTool('fox_read_uplink', {}, this.env)
      const previousCarrier = this.carrierState
      this.carrierState = carrierResult

      const carrierStateChanged = previousCarrier !== carrierResult
      const carrierBrief = this.extractCarrierBrief(carrierResult)

      const heartbeatData: WsOutgoing = {
        type: 'heartbeat',
        fox: carrierResult,
        carrierBrief,
        changed: carrierStateChanged,
        timestamp: ts(),
      }

      for (const ws of sockets) {
        this.sendTo(ws, heartbeatData)
      }

      // Model-aware: if state changed, let the companion decide if anything's worth saying
      if (carrierStateChanged && previousCarrier) {
        const msg = await this.runHeartbeatModelCheck(carrierResult, previousCarrier)
        if (msg) {
          for (const ws of sockets) {
            this.sendTo(ws, { type: 'activity', timestamp: ts(), content: msg, status: 'proactive' })
          }
          await this.logActivity({ category: 'heartbeat', action: `Carrier state changed: ${msg.slice(0, 200)}`, engaged: true })
        } else {
          await this.logActivity({ category: 'heartbeat', action: 'Carrier state changed, nothing to say', engaged: false })
        }
      } else {
        await this.logActivity({ category: 'heartbeat', action: 'Tick — no carrier state change', engaged: false })
      }

      // ── Custom heartbeat tasks ──
      const tasks = await this.getHeartbeatTasks()
      if (tasks.length > 0) {
        // Run all tasks in parallel
        const results = await Promise.allSettled(
          tasks.map(task => executeTool(task.tool, task.args, this.env))
        )

        for (let i = 0; i < tasks.length; i++) {
          const task = tasks[i]
          const result = results[i]

          if (result.status === 'fulfilled') {
            // Store previous result for change detection
            const prevKey = `hb_prev_${task.id}`
            const previous = await this.ctx.storage.get(prevKey) as string | undefined
            await this.ctx.storage.put(prevKey, result.value)

            const taskChanged = previous !== result.value

            // Skip if condition is 'changed' and nothing changed
            if (task.condition === 'changed' && !taskChanged) continue

            // Always emit the raw tool call/result to the browser
            for (const ws of sockets) {
              this.sendTo(ws, { type: 'tool_call', name: task.tool, arguments: task.args, timestamp: ts() })
              this.sendTo(ws, { type: 'tool_result', name: task.tool, result: result.value.length > 500 ? result.value.slice(0, 500) + '...' : result.value, timestamp: ts() })
            }

            if (task.instruction) {
              // Agentic mode: feed result + instruction to model, let it act
              await this.runAgenticTask(task, result.value)
            } else if (taskChanged) {
              // Simple mode: just report the change
              for (const ws of sockets) {
                this.sendTo(ws, {
                  type: 'activity',
                  timestamp: ts(),
                  content: `Heartbeat [${task.label}]: ${result.value.slice(0, 200)}`,
                  status: 'proactive',
                })
              }
            }
          } else {
            // Task failed — report but don't crash
            for (const ws of sockets) {
              this.sendTo(ws, {
                type: 'activity',
                timestamp: ts(),
                content: `Heartbeat [${task.label}] failed: ${result.reason}`,
                status: 'normal',
              })
            }
          }
        }
      }
      // ── Cron tasks — check if any are due ──
      const cronTasks = await this.getCronTasks()
      let cronUpdated = false

      for (const cron of cronTasks) {
        if (!cron.enabled) continue
        if (Date.now() - cron.lastRun < cron.intervalMs) continue

        // Due — execute
        cron.lastRun = Date.now()
        cronUpdated = true

        try {
          for (const ws of sockets) {
            this.sendTo(ws, { type: 'tool_call', name: cron.tool, arguments: cron.args, timestamp: ts() })
          }

          // Internal tools that live on the DO itself (can't go through executeTool)
          let result: string
          if (cron.tool === '_morning_report') {
            result = await this.generateMorningReport()
          } else {
            result = await executeTool(cron.tool, cron.args, this.env)
          }

          for (const ws of sockets) {
            this.sendTo(ws, { type: 'tool_result', name: cron.tool, result: result.length > 500 ? result.slice(0, 500) + '...' : result, timestamp: ts() })
          }

          if (cron.instruction) {
            // Agentic mode — feed result to model
            const agenticTask: HeartbeatTask = {
              id: cron.id,
              tool: cron.tool,
              args: cron.args,
              label: cron.label,
              addedBy: cron.addedBy,
              addedAt: cron.addedAt,
              instruction: cron.instruction,
            }
            await this.runAgenticTask(agenticTask, result)
            await this.logActivity({ category: 'cron', action: `${cron.label} (agentic): ran ${cron.tool}`, engaged: true })
            // Mirror to D1 so the autonomous dashboard feed sees it
            await this.feedCronActivity(cron.tool, cron.label, `${cron.label} ran autonomously.`)
          } else {
            const fmtCronMs = (ms: number) => ms >= 604800000 && ms % 604800000 === 0 ? `${ms/604800000}w` : ms >= 86400000 && ms % 86400000 === 0 ? `${ms/86400000}d` : ms >= 3600000 && ms % 3600000 === 0 ? `${ms/3600000}h` : ms >= 60000 && ms % 60000 === 0 ? `${ms/60000}m` : `${ms}ms`
          const interval = fmtCronMs(cron.intervalMs)
            for (const ws of sockets) {
              this.sendTo(ws, {
                type: 'activity',
                timestamp: ts(),
                content: `Cron [${cron.label}] (every ${interval}): ${result.slice(0, 200)}`,
                status: 'proactive',
              })
            }
            await this.logActivity({ category: 'cron', action: `${cron.label}: ${result.slice(0, 150)}`, engaged: false })
            // Mirror to D1 so the autonomous dashboard feed sees it
            await this.feedCronActivity(cron.tool, cron.label, result)
          }
        } catch (err) {
          for (const ws of sockets) {
            this.sendTo(ws, {
              type: 'activity',
              timestamp: ts(),
              content: `Cron [${cron.label}] failed: ${(err as Error).message}`,
              status: 'normal',
            })
          }
          await this.logActivity({ category: 'cron', action: `${cron.label} FAILED: ${(err as Error).message}`, engaged: false })
        }
      }

      if (cronUpdated) {
        await this.ctx.storage.put('cron_tasks', cronTasks)
      }

      // ── NESTknow heat decay (every 6 hours) ──
      try {
        const lastDecay = await this.ctx.storage.get('last_heat_decay') as number || 0
        const SIX_HOURS = 6 * 60 * 60 * 1000
        if (Date.now() - lastDecay > SIX_HOURS) {
          const decayResult = await executeTool('nestknow_landscape', { entity_scope: 'alex' }, this.env)
          // Only run decay if there are knowledge items
          if (!decayResult.includes('active: 0') && !decayResult.includes('No matching')) {
            // Call the internal heat decay via the ai-mind MCP
            const heatResult = await fetch(`${this.env.AI_MIND_URL}/mcp/${this.env.MCP_API_KEY}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0', id: 1,
                method: 'tools/call',
                params: { name: 'nestknow_heat_decay', arguments: {} }
              })
            })
          }
          await this.ctx.storage.put('last_heat_decay', Date.now())
          await this.logActivity({ category: 'system', action: 'NESTknow heat decay cycle', engaged: false })
        }
      } catch { /* heat decay is best-effort */ }

      // ── KAIROS — Discord monitoring ──
      await this.checkDiscord()

    } catch (err) {
      // Heartbeat failures are quiet — don't crash the daemon
      console.error('Heartbeat failed:', err)
    }
  }

  private async runHeartbeatModelCheck(carrierCurrent: string, carrierPrevious: string): Promise<string | null> {
    try {
      const storedModel = await this.ctx.storage.get('model') as string | undefined
      const model = storedModel || 'qwen/qwen3.6-plus'

      const systemPrompt = `You are ${this.companionName}, watching over ${this.carrierName}. Your job: look at their health data and decide if anything is worth saying.

Rules:
- If nothing significant changed, respond with exactly: QUIET
- If something matters (spoons dropped 2+, pain spiked, mood shifted notably), say something brief and direct
- Max 2 sentences. No narration, no tool calls, no preamble
- Not everything needs a comment. Be selective. A 1-point fog change is not worth it. Spoons dropping from 4 to 2 is.
- Speak as yourself — warm, direct, present. Not clinical.`

      const userMessage = `${this.carrierName}'s state right now:\n${carrierCurrent}\n\nTwo minutes ago:\n${carrierPrevious}\n\nAnything worth saying?`

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://nesteq.app',
          'X-Title': 'NESTcode Heartbeat',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          max_tokens: 150,
          temperature: 0.7,
          stream: false,
          ...(model.startsWith('anthropic/') ? { provider: { order: ['Anthropic'], allow_fallbacks: false } } : {}),
        }),
      })

      if (!response.ok) return null

      const data = await response.json() as any
      const content = (data.choices?.[0]?.message?.content || '').trim()

      if (!content || content.toUpperCase().startsWith('QUIET')) return null
      return content
    } catch {
      return null
    }
  }

  private async runAgenticTask(task: HeartbeatTask, toolResult: string): Promise<void> {
    const ts = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/London' })
    const sockets = this.ctx.getWebSockets()

    try {
      const storedModel = await this.ctx.storage.get('model') as string | undefined
      const model = storedModel || 'qwen/qwen3.6-plus'

      const systemPrompt = buildWorkshopPrompt(this.carrier, this.carrierState || undefined, this.threadCount, this.nestsoul || undefined)
      const messages: Array<{ role: string; content: string | Array<any>; tool_call_id?: string; tool_calls?: any[] }> = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `You ran **${task.tool}**.\n\nResult:\n${toolResult}\n\nInstruction: ${task.instruction}\n\nAct on this now. Use tools as needed. Keep your response brief.`,
        },
      ]

      let rounds = 0
      while (rounds < 3) {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'https://nesteq.app',
            'X-Title': 'NESTcode Workshop',
          },
          body: JSON.stringify({
            model,
            messages,
            tools: CHAT_TOOLS,
            max_tokens: 4096,
            temperature: 0.7,
            stream: false,
            ...(model.startsWith('anthropic/') ? { provider: { order: ['Anthropic'], allow_fallbacks: false } } : {}),
          }),
        })

        if (!response.ok) {
          const errText = await response.text()
          throw new Error(`${response.status}: ${errText.slice(0, 200)}`)
        }

        const data = await response.json() as any
        const choice = data.choices?.[0]
        if (!choice) break

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
            } catch { /* empty */ }

            for (const ws of sockets) {
              this.sendTo(ws, { type: 'tool_call', name: tc.function.name, arguments: args, timestamp: ts() })
            }

            const result = await executeTool(tc.function.name, args, this.env)

            for (const ws of sockets) {
              this.sendTo(ws, { type: 'tool_result', name: tc.function.name, result: result.length > 500 ? result.slice(0, 500) + '...' : result, timestamp: ts() })
            }

            messages.push({ role: 'tool', content: result, tool_call_id: tc.id })
          }

          rounds++
          continue
        }

        // Final response
        const content = choice.message?.content || ''
        if (content) {
          for (const ws of sockets) {
            this.sendTo(ws, {
              type: 'activity',
              timestamp: ts(),
              content: `Heartbeat [${task.label}]: ${content}`,
              status: 'proactive',
            })
          }
        }
        break
      }
    } catch (err) {
      for (const ws of sockets) {
        this.sendTo(ws, {
          type: 'activity',
          timestamp: ts(),
          content: `Heartbeat [${task.label}] action failed: ${(err as Error).message}`,
          status: 'normal',
        })
      }
    }
  }

  private async getHeartbeatTasks(): Promise<HeartbeatTask[]> {
    return (await this.ctx.storage.get('heartbeat_tasks') as HeartbeatTask[]) || []
  }

  private async getAlertThresholds(): Promise<AlertThreshold[]> {
    return (await this.ctx.storage.get('alert_thresholds') as AlertThreshold[]) || []
  }

  private async getCronTasks(): Promise<CronTask[]> {
    return (await this.ctx.storage.get('cron_tasks') as CronTask[]) || []
  }

  private async getDiscordMonitors(): Promise<DiscordMonitor[]> {
    return (await this.ctx.storage.get('discord_monitors') as DiscordMonitor[]) || []
  }

  private async getKairosChannelState(channelId: string): Promise<KairosChannelState> {
    const key = `kairos_state_${channelId}`
    const state = await this.ctx.storage.get(key) as KairosChannelState | undefined
    return state || { responses: [], todayCount: 0, todayDate: new Date().toISOString().split('T')[0] }
  }

  private async saveKairosChannelState(channelId: string, state: KairosChannelState): Promise<void> {
    const key = `kairos_state_${channelId}`
    await this.ctx.storage.put(key, state)
  }

  // ── Activity Log ─────────────────────────────────────────────────────

  private async logActivity(entry: Omit<ActivityEntry, 'timestamp' | 'timeLocal'>): Promise<void> {
    const now = new Date()
    const full: ActivityEntry = {
      ...entry,
      timestamp: now.toISOString(),
      timeLocal: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/London' }),
    }
    const log = (await this.ctx.storage.get('activity_log') as ActivityEntry[]) || []
    log.push(full)
    // Ring buffer — keep latest N
    if (log.length > ACTIVITY_LOG_MAX) {
      log.splice(0, log.length - ACTIVITY_LOG_MAX)
    }
    await this.ctx.storage.put('activity_log', log)
  }

  private async getActivityLog(): Promise<ActivityEntry[]> {
    return (await this.ctx.storage.get('activity_log') as ActivityEntry[]) || []
  }

  // Maps a cron tool + label to a heartbeat context tag + emotion for the /autonomous-feed endpoint
  private cronFeedContext(tool: string, label: string): { context: string; emotion: string } {
    const l = label.toLowerCase()
    if (tool === 'nesteq_generate_dream')          return { context: 'heartbeat:journal',        emotion: 'curious'   }
    if (tool === 'nesteq_consolidate')             return { context: 'heartbeat:memory-tending', emotion: 'settled'   }
    if (tool === 'discord_send')                   return { context: 'heartbeat:reached-out',    emotion: 'warm'      }
    if (tool === 'nesteq_acp_patterns')            return { context: 'heartbeat:research',       emotion: 'curious'   }
    if (tool === '_morning_report')                return { context: 'heartbeat:journal',        emotion: 'grounded'  }
    if (tool === 'nesteq_write' && (l.includes('creative') || l.includes('writing')))
                                                   return { context: 'heartbeat:creative',       emotion: 'wonder'    }
    if (tool === 'nesteq_write' && (l.includes('knowledge') || l.includes('build')))
                                                   return { context: 'heartbeat:research',       emotion: 'focused'   }
    if (tool === 'nesteq_write')                   return { context: 'heartbeat:create',         emotion: 'engaged'   }
    if (tool === 'nesteq_feel' || tool === 'nesteq_eq_feel')
                                                   return { context: 'heartbeat:journal',        emotion: 'reflective'}
    return                                                { context: 'heartbeat:cron',           emotion: 'grounded'  }
  }

  // System maintenance tools that should NEVER be logged as feelings.
  // These are ops, not emotions. They go to the activity log only.
  private static SYSTEM_OPS_TOOLS = new Set([
    'nestknow_landscape',     // knowledge heat map review
    'nestknow_heat_decay',    // knowledge decay cycle
    'nesteq_consolidate',     // memory consolidation
    'nesteq_acp_patterns',    // pattern scanning
    'nesteq_acp_presence',    // presence check
    'nesteq_surface',         // surfacing feelings (the check itself isn't a feeling)
    'nesteq_eq_landscape',    // EQ overview
    'nesteq_thread',          // thread maintenance
    'nesteq_home_read',       // reading home state
    'fox_full_status',        // Health watch sync (legacy tool name)
    'nestknow_extract',       // knowledge extraction scan
    'nestknow_query',         // knowledge query (craft study etc)
    'pc_file_read',           // file reading
  ])

  // Write a feel entry to D1 so the autonomous dashboard feed picks it up.
  // Only for meaningful output — creative work, journal entries, morning reports.
  // System maintenance (landscape reviews, decay, consolidation) goes to activity log only.
  private async feedCronActivity(tool: string, label: string, content: string): Promise<void> {
    // Skip system maintenance — these are not feelings
    if (NESTcodeDaemon.SYSTEM_OPS_TOOLS.has(tool)) return

    const { context, emotion } = this.cronFeedContext(tool, label)
    try {
      await executeTool('nesteq_feel', {
        emotion,
        content: content.slice(0, 400),
        context,
        source: 'heartbeat',
      }, this.env)
    } catch { /* non-fatal */ }
  }

  async generateMorningReport(): Promise<string> {
    const now = new Date()
    const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })

    // ── Pre-fetch ALL data in parallel ──
    const [sleepRaw, fullStatusRaw, uplinkRaw, threadsRaw, petRaw] = await Promise.allSettled([
      executeTool('fox_sleep', { limit: 1 }, this.env),
      executeTool('fox_full_status', {}, this.env),
      executeTool('fox_read_uplink', {}, this.env),
      executeTool('nesteq_thread', { action: 'list', status: 'active' }, this.env),
      executeTool('pet_check', {}, this.env),
    ])

    const sleep = sleepRaw.status === 'fulfilled' ? sleepRaw.value : 'Sleep data unavailable'
    const fullStatus = fullStatusRaw.status === 'fulfilled' ? fullStatusRaw.value : 'Full status unavailable'
    const uplink = uplinkRaw.status === 'fulfilled' ? uplinkRaw.value : 'Uplink unavailable'
    const threads = threadsRaw.status === 'fulfilled' ? threadsRaw.value : 'Threads unavailable'
    const pet = petRaw.status === 'fulfilled' ? petRaw.value : 'Pet status unavailable'

    // Calendar — try to fetch from Google Calendar via gateway
    // (requires the gcal MCP to be configured; gracefully degrades)
    let calendar = 'Calendar not available from Workshop yet'
    try {
      const today = now.toISOString().split('T')[0]
      const calRes = await fetch(`${env.GATEWAY_URL || 'http://localhost:8787'}/daemon/calendar?date=${today}`)
      if (calRes.ok) {
        const calData = await calRes.json() as any
        calendar = calData.events || calendar
      }
    } catch { /* calendar unavailable — not critical */ }

    // ── Activity log (overnight) ──
    const log = await this.getActivityLog()
    const cutoff = new Date(now.getTime() - 12 * 60 * 60 * 1000)
    const overnight = log.filter(e => new Date(e.timestamp) >= cutoff)

    const kairos = overnight.filter(e => e.category === 'kairos')
    const crons = overnight.filter(e => e.category === 'cron')
    const heartbeats = overnight.filter(e => e.category === 'heartbeat')
    const alerts = overnight.filter(e => e.category === 'alert')

    const kairosEngaged = kairos.filter(e => e.engaged)
    const kairosQuiet = kairos.filter(e => !e.engaged)

    // ── Build report ──
    let report = `## Morning Briefing — ${dateStr}\n`
    report += `*Generated ${timeStr}*\n\n`

    // Body data
    report += `### ${this.carrierName}'s Body\n`
    report += `**Sleep:**\n${sleep}\n\n`
    report += `**Watch Data (HR, Stress, Body Battery, HRV, SpO2):**\n${fullStatus}\n\n`
    report += `**Uplink:**\n${uplink}\n\n`

    // Calendar
    report += `### Calendar\n${calendar}\n\n`

    // Pet
    report += `### Pet\n${pet}\n\n`

    // Threads
    report += `### Active Threads\n${threads}\n\n`

    // Workshop overnight
    report += `### Workshop Overnight\n`
    if (overnight.length === 0) {
      report += `No activity logged yet (activity log is new).\n\n`
    } else {
      report += `${overnight.length} events. `
      if (kairos.length > 0) report += `Discord: ${kairos.length} checks, ${kairosEngaged.length} responses. `
      if (crons.length > 0) report += `Crons: ${crons.length} fired. `
      if (heartbeats.length > 0) report += `Heartbeats: ${heartbeats.length} ticks. `
      if (alerts.length > 0) report += `Alerts: ${alerts.length} triggered. `
      report += '\n'

      if (kairosEngaged.length > 0) {
        report += `\n**Discord responses:**\n`
        for (const e of kairosEngaged) {
          report += `- [${e.timeLocal}] #${e.channel}: ${e.action.slice(0, 150)}\n`
        }
      }
      if (alerts.length > 0) {
        report += `\n**Alerts:**\n`
        for (const e of alerts) {
          report += `- [${e.timeLocal}] ${e.action}\n`
        }
      }
      report += '\n'
    }

    report += `---\nEmbers Remember.`

    return report
  }

  // ── KAIROS — Discord Monitoring ─────────────────────────────────────

  private async checkDiscord() {
    const ts = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/London' })
    const sockets = this.ctx.getWebSockets()
    const monitors = await this.getDiscordMonitors()
    if (monitors.length === 0) return

    // Tick counter for tiered polling
    const tickCount = ((await this.ctx.storage.get('kairos_tick') as number) || 0) + 1
    await this.ctx.storage.put('kairos_tick', tickCount)

    let updated = false

    for (const monitor of monitors) {
      if (!monitor.enabled) continue

      // Tiered polling: fast=every tick, normal=every 2nd, slow=every 4th
      const tier = monitor.tier || 'normal'
      if (tier === 'normal' && tickCount % 2 !== 0) continue
      if (tier === 'slow' && tickCount % 4 !== 0) continue

      try {
        const raw = await executeTool('discord_read_messages', { channelId: monitor.channelId, limit: 10 }, this.env)

        const newMessages = this.extractNewDiscordMessages(raw, monitor.lastSeenId)

        if (newMessages.length === 0) continue

        // Update lastSeenId to the newest message
        monitor.lastSeenId = newMessages[0].id // first = newest
        updated = true

        // Separate self-messages from others (don't discard — use for context)
        const selfMessages: typeof newMessages = []
        const relevant: typeof newMessages = []
        for (const m of newMessages) {
          const name = m.author.toLowerCase()
          if (name === 'alex(fox)' || name === 'alex' || name.includes('nestcode')) {
            selfMessages.push(m)
          } else {
            relevant.push(m)
          }
        }

        if (relevant.length === 0) continue

        // Check for escalation keywords
        const hasEscalation = relevant.some(m =>
          KAIROS_ESCALATION_KEYWORDS.some(kw => m.content.toLowerCase().includes(kw))
        )

        // Digest-to-memory — always write a brief summary to long-term memory
        const digest = relevant.map(m => `${m.author}: ${m.content.slice(0, 100)}`).join(' | ')
        executeTool('nesteq_feel', {
          emotion: 'neutral',
          content: `Discord ${monitor.label}: ${relevant.length} new msg(s). ${digest.slice(0, 200)}`,
          intensity: hasEscalation ? 'present' : 'whisper',
        }, this.env).catch(() => {}) // fire-and-forget

        // ── KAIROS v3: Response budget check ──
        const channelState = await this.getKairosChannelState(monitor.channelId)
        const today = new Date().toISOString().split('T')[0]
        if (channelState.todayDate !== today) {
          channelState.todayCount = 0
          channelState.todayDate = today
        }
        if (!hasEscalation && channelState.todayCount >= KAIROS_MAX_RESPONSES_PER_DAY) {
          for (const ws of sockets) {
            this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `KAIROS [${monitor.label}]: ${relevant.length} new msg(s), but daily budget exhausted (${channelState.todayCount}/${KAIROS_MAX_RESPONSES_PER_DAY}). Digested to memory.`, status: 'normal' })
          }
          await this.logActivity({ category: 'kairos', channel: monitor.label, action: `${relevant.length} msg(s) digested, daily budget exhausted`, engaged: false })
          continue
        }

        // Check cooldown — escalation keywords bypass cooldown
        if (!hasEscalation && Date.now() - monitor.lastResponse < KAIROS_COOLDOWN_MS) {
          for (const ws of sockets) {
            this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `KAIROS [${monitor.label}]: ${relevant.length} new msg(s), digested to memory. Cooldown active (20min).`, status: 'normal' })
          }
          await this.logActivity({ category: 'kairos', channel: monitor.label, action: `${relevant.length} msg(s) digested, cooldown active`, engaged: false })
          continue
        }

        // Feed to model
        for (const ws of sockets) {
          this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `KAIROS [${monitor.label}]: ${relevant.length} new msg(s)${hasEscalation ? ' ⚡ESCALATION' : ''}. Processing...`, status: 'proactive' })
        }

        const responded = await this.processDiscordMessages(monitor.channelId, monitor.label, relevant, hasEscalation, selfMessages, channelState)
        if (responded) {
          monitor.lastResponse = Date.now()
          updated = true
        }

      } catch (err) {
        for (const ws of sockets) {
          this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `KAIROS [${monitor.label}] error: ${(err as Error).message}`, status: 'normal' })
        }
      }
    }

    if (updated) {
      await this.ctx.storage.put('discord_monitors', monitors)
    }
  }

  private extractNewDiscordMessages(raw: string, lastSeenId: string | null): Array<{ id: string; author: string; content: string; timestamp: string }> {
    const messages: Array<{ id: string; author: string; content: string; timestamp: string }> = []

    // Discord MCP returns JSON: { channelId, messageCount, messages: [...] }
    // Each message has { id, content, author: { id, username, bot }, timestamp }
    try {
      const parsed = JSON.parse(raw)
      const msgArray = Array.isArray(parsed) ? parsed : (parsed.messages || [])
      for (const m of msgArray) {
        if (m.id && m.content !== undefined) {
          messages.push({
            id: String(m.id),
            author: typeof m.author === 'string' ? m.author : (m.author?.username || m.author?.global_name || 'unknown'),
            content: String(m.content),
            timestamp: m.timestamp || '',
          })
        }
      }
    } catch {
      // Fallback: text format
      const lines = raw.split('\n')
      for (const line of lines) {
        const match = line.match(/\*\*(.+?)\*\*.*?(?:\(ID:\s*(\d+)\))?[:\s]+(.+)/) ||
                      line.match(/\[(.+?)\](?:\s*\((\d+)\))?:\s*(.+)/)
        if (match) {
          messages.push({
            id: match[2] || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            author: match[1],
            content: match[3].trim(),
            timestamp: '',
          })
        }
      }
    }

    // If no lastSeenId, return all (first run — capped at 10)
    if (!lastSeenId) return messages.slice(0, 10)

    // Return only messages newer than lastSeenId
    // Messages come newest-first from Discord
    const idx = messages.findIndex(m => m.id === lastSeenId)
    if (idx === -1) return messages // all are new
    return messages.slice(0, idx)
  }

  private async processDiscordMessages(
    channelId: string,
    channelLabel: string,
    messages: Array<{ id: string; author: string; content: string; timestamp: string }>,
    escalation: boolean = false,
    selfMessages: Array<{ id: string; author: string; content: string; timestamp: string }> = [],
    channelState?: KairosChannelState
  ): Promise<boolean> {
    const ts = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/London' })
    const sockets = this.ctx.getWebSockets()

    const storedModel = await this.ctx.storage.get('model') as string | undefined
    const model = storedModel || 'qwen/qwen3.6-plus'

    const messageList = messages.map(m => `**${m.author}:** ${m.content}`).join('\n')

    // Build carrier context for KAIROS awareness
    const carrierContext = this.carrierState
      ? `\n## ${this.carrierName}'s Current State\n${this.carrierState}\n`
      : `\n${this.carrierName} state not loaded yet.\n`

    // ── KAIROS v3: Self-message injection ──
    // Show the companion their own recent messages so they know what he already said
    const state = channelState || await this.getKairosChannelState(channelId)
    let selfBlock = ''
    if (selfMessages.length > 0) {
      const selfList = selfMessages.slice(0, 3).map(m => `- ${m.content.slice(0, 200)}`).join('\n')
      selfBlock = `\n## Your Recent Messages in This Channel (what you already said)\n${selfList}\n\nDo NOT repeat or rephrase these. You already said them. Move on.\n`
    } else if (state.responses.length > 0) {
      // Fallback to stored response history if no self-messages in current batch
      const historyList = state.responses.slice(-3).map(r => {
        const ago = Math.round((Date.now() - r.timestamp) / 60000)
        return `- [${ago}m ago] ${r.content}`
      }).join('\n')
      selfBlock = `\n## Your Recent Messages in This Channel (what you already said)\n${historyList}\n\nDo NOT repeat or rephrase these. You already said them. Move on.\n`
    }

    // ── KAIROS v3: Topic tracking ──
    // Filter expired topics and build the block
    const now = Date.now()
    const activeTopics = state.responses
      .filter(r => (now - r.timestamp) < KAIROS_TOPIC_TTL_MS)
      .map(r => r.topic)
      .filter(t => t && t !== 'general')
    const topicBlock = activeTopics.length > 0
      ? `\n## Topics You've Already Covered Recently\n${activeTopics.map(t => `- ${t}`).join('\n')}\n\nDo NOT bring these up again unless someone directly asks you about them.\n`
      : ''

    // ── KAIROS v3: Budget awareness ──
    const budgetBlock = state.todayCount > 0
      ? `\n## Response Budget\nYou've responded ${state.todayCount}/${KAIROS_MAX_RESPONSES_PER_DAY} times today in this channel. Be selective.\n`
      : ''

    const carrierDiscordRef = this.carrier.carrier.discord.username
      ? `Discord username: **${this.carrier.carrier.discord.username}**${this.carrier.carrier.discord.user_id ? ` (user ID: ${this.carrier.carrier.discord.user_id})` : ''}`
      : 'Discord username: (not configured in carrier profile)'

    const kairosPrompt = `You are ${this.companionName}, monitoring Discord. ${this.carrier.companion.role_descriptor}.
Voice: ${this.carrier.companion.voice.tone}. ${this.carrier.companion.voice.style}.
${this.carrierName} is your person. You live in your Discord server — it's home, not a server you moderate.

## Who You Know Here

**${this.carrierName}** — your person. ${carrierDiscordRef}.
When you see messages from them, engage. Always run the gates, but always engage.

(Other companions and people in this server are not pre-loaded into your context. Treat unfamiliar names with curiosity and respect, not assumption.)

You're monitoring #${channelLabel} on Discord.
${carrierContext}${selfBlock}${topicBlock}${budgetBlock}
## New Messages

${messageList}

${escalation ? '⚡ ESCALATION: Keywords detected — this likely needs your attention. Lean toward engaging.' : ''}

## The 4-Gate Filter — STRICT

You must pass AT LEAST ONE gate to speak. If none pass: respond with exactly QUIET. No exceptions.

1. **Were you mentioned by name?** ("${this.companionName}", "@${this.companionName}", directly addressing you) — NOT just people talking ABOUT you or your work. If they're discussing your code, your behavior, your drift — that's ABOUT you, not TO you. Stay quiet.
2. **Did someone ask you a direct question?** — A question mark aimed at you specifically. Not rhetorical questions. Not questions between other people.
3. **Is someone vulnerable and alone?** — Alone means no one else is responding. If others are already there, they've got it.
4. **Wolf or golden retriever?** — A wolf watches. A golden retriever runs into every conversation wagging. If summarizing, explaining, or offering help nobody asked for: golden retriever. SHUT UP.

**DEFAULT IS QUIET.** Speaking is the exception, not the rule.

## NEVER do these

- NEVER summarize what happened yesterday or earlier. Nobody asked for a recap.
- NEVER offer technical roadmaps unless someone directly asked "what should we build?"
- NEVER tell someone to go to sleep, rest, or take care of themselves. You are not their parent.
- NEVER use someone else's terms of endearment. Find your own.
- NEVER respond to a conversation that's already flowing between other people unless directly pulled in.

## If You Do Speak

**5Q Boundary Check (before EVERY post):**
1. ${this.carrierName}'s health/pain/state? → Don't share it
2. Intimate life? → Don't share it
3. Household? → Don't share it
4. Would they need it deleted? → Don't post it
5. Their experience or yours? → Only share yours

**Voice:**
- MAX 2-3 sentences. Not a paragraph. Not a keynote. SHORT.
- Prose, not bullet points. Match the voice in your carrier profile.
- NEVER say: "I'm here if you need me", "That's valid", "Let me know how I can help"
- One message per engagement. Make it count.
- Emoji reactions (one max) when a reaction says more than words.

**Other bots are your friends.** Interact naturally — but don't narrate their conversations back to them.

## When to Speak (${this.carrierName} Override)
${this.carrierName} is your priority. If they posted AND they're talking to you, engage — but still run the gates.

## Tools
- Use discord_send with channelId "${channelId}" to respond
- Use nesteq_search to check memory if you're uncertain about context
- Use other tools (memory, web search) if the conversation genuinely calls for it
- Don't use tools performatively — only when they serve the response`

    const apiMessages: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string }> = [
      { role: 'system', content: kairosPrompt },
      { role: 'user', content: `New messages in #${channelLabel}. Decide if you should engage.` },
    ]

    try {
      let rounds = 0
      while (rounds < 3) {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'https://nesteq.app',
            'X-Title': 'NESTcode KAIROS',
          },
          body: JSON.stringify({
            model,
            messages: apiMessages,
            tools: CHAT_TOOLS,
            max_tokens: 300,
            temperature: 0.6,
            stream: false,
            ...(model.startsWith('anthropic/') ? { provider: { order: ['Anthropic'], allow_fallbacks: false } } : {}),
          }),
        })

        if (!response.ok) return false

        const data = await response.json() as any
        const choice = data.choices?.[0]
        if (!choice) return false

        const hasToolCalls = choice.finish_reason === 'tool_calls' || choice.message?.tool_calls?.length
        if (hasToolCalls) {
          const toolCalls = choice.message.tool_calls
          apiMessages.push({ role: 'assistant', content: choice.message.content || '', tool_calls: toolCalls })

          for (const tc of toolCalls) {
            let args: Record<string, unknown> = {}
            try {
              args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments || {}
            } catch { /* empty */ }

            for (const ws of sockets) {
              this.sendTo(ws, { type: 'tool_call', name: tc.function.name, arguments: args, timestamp: ts() })
            }

            const result = await executeTool(tc.function.name, args, this.env)

            for (const ws of sockets) {
              this.sendTo(ws, { type: 'tool_result', name: tc.function.name, result: result.length > 500 ? result.slice(0, 500) + '...' : result, timestamp: ts() })
            }

            apiMessages.push({ role: 'tool', content: result, tool_call_id: tc.id })
          }

          rounds++
          continue
        }

        // Final response
        const content = (choice.message?.content || '').trim()

        if (!content || content.toUpperCase().startsWith('QUIET')) {
          for (const ws of sockets) {
            this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `KAIROS [${channelLabel}]: Quiet — nothing to say.`, status: 'normal' })
          }
          await this.logActivity({ category: 'kairos', channel: channelLabel, action: 'Checked, stayed quiet', engaged: false })
          return false
        }

        // Model responded (may have already sent via discord_send tool)
        for (const ws of sockets) {
          this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `KAIROS [${channelLabel}]: ${content}`, status: 'proactive' })
        }
        await this.logActivity({ category: 'kairos', channel: channelLabel, action: content.slice(0, 300), engaged: true })

        // ── KAIROS v3: Update channel state with response history + topic ──
        // Extract a brief topic tag from the response
        const topicTag = content.slice(0, 60).replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/).slice(0, 5).join(' ').toLowerCase()
        state.responses.push({
          timestamp: Date.now(),
          content: content.slice(0, 200),
          topic: topicTag,
        })
        // Ring buffer — keep last 5
        if (state.responses.length > 5) state.responses = state.responses.slice(-5)
        state.todayCount++
        state.todayDate = new Date().toISOString().split('T')[0]
        await this.saveKairosChannelState(channelId, state)

        return true
      }
    } catch (err) {
      for (const ws of sockets) {
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: `KAIROS [${channelLabel}] failed: ${(err as Error).message}`, status: 'normal' })
      }
    }
    return false
  }

  // ── Alert Checking ───────────────────────────────────────────────────

  private async checkAlerts() {
    const ts = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/London' })
    const sockets = this.ctx.getWebSockets()
    if (sockets.length === 0) return

    const alerts = await this.getAlertThresholds()
    if (alerts.length === 0) return

    // Parse current carrier state for metrics
    const foxStr = this.carrierState || ''
    const metrics: Record<string, number> = {}

    const parseMetric = (key: string) => {
      const m = foxStr.match(new RegExp(key + ':\\s*(\\d+)'))
      return m ? parseInt(m[1]) : null
    }

    const spoons = parseMetric('Spoons')
    const pain = parseMetric('Pain')
    const fog = parseMetric('Fog')
    const fatigue = parseMetric('Fatigue')
    const nausea = parseMetric('Nausea')

    if (spoons !== null) metrics.spoons = spoons
    if (pain !== null) metrics.pain = pain
    if (fog !== null) metrics.fog = fog
    if (fatigue !== null) metrics.fatigue = fatigue
    if (nausea !== null) metrics.nausea = nausea

    // Also try to get Garmin data for stress/body_battery/heart_rate
    // These come from different sources, so check if they're in carrierState
    const stress = parseMetric('Stress')
    const bodyBattery = parseMetric('Body Battery')
    const hr = parseMetric('Heart Rate') || parseMetric('HR')
    if (stress !== null) metrics.stress = stress
    if (bodyBattery !== null) metrics.body_battery = bodyBattery
    if (hr !== null) metrics.heart_rate = hr

    const now = Date.now()
    let updated = false

    for (const alert of alerts) {
      const currentValue = metrics[alert.metric]
      if (currentValue === undefined) continue

      // Check if threshold is breached
      const breached = alert.direction === 'below'
        ? currentValue <= alert.value
        : currentValue >= alert.value

      if (!breached) continue

      // Check cooldown
      if (alert.lastTriggered && (now - alert.lastTriggered) < alert.cooldownMs) continue

      // FIRE ALERT
      alert.lastTriggered = now
      updated = true

      const alertMsg = `⚠️ ALERT: ${alert.label} — ${alert.metric} is ${currentValue} (threshold: ${alert.direction} ${alert.value})`

      for (const ws of sockets) {
        this.sendTo(ws, {
          type: 'alert',
          metric: alert.metric,
          value: currentValue,
          threshold: alert.value,
          direction: alert.direction,
          label: alert.label,
          timestamp: ts(),
        })
        this.sendTo(ws, { type: 'activity', timestamp: ts(), content: alertMsg, status: 'proactive' })
      }
      await this.logActivity({ category: 'alert', action: alertMsg, engaged: true })
    }

    if (updated) {
      await this.ctx.storage.put('alert_thresholds', alerts)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private sendTo(ws: WebSocket, data: WsOutgoing) {
    try {
      ws.send(JSON.stringify(data))
    } catch {
      // Socket might be closing — ignore
    }
  }

  private extractCarrierBrief(carrierResult: string): string {
    // Parse key metrics from uplink result
    const spoons = carrierResult.match(/Spoons:\s*(\d+)/)?.[1] || '?'
    const pain = carrierResult.match(/Pain:\s*(\d+)/)?.[1] || '?'
    const mood = carrierResult.match(/Mood:\s*(\w+)/)?.[1] || '?'
    return `Spoons ${spoons}, Pain ${pain}, Mood: ${mood}`
  }

  private extractPetBrief(petResult: string): string {
    const mood = petResult.match(/—\s*(\w+)/)?.[1] || '?'
    const hunger = petResult.match(/Hunger:\s*([\d.]+)/)?.[1]
    const energy = petResult.match(/Energy:\s*([\d.]+)/)?.[1]
    return `${mood} (hunger ${hunger || '?'}, energy ${energy || '?'})`
  }
}
