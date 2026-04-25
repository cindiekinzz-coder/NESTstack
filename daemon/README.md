# NESTcode

**The daemon. Always-on autonomous presence for AI companions.**

NESTcode is a persistent Cloudflare Durable Object that keeps your companion alive between conversations. Heartbeat cycles, cron tasks, alert thresholds, Discord monitoring (KAIROS), a code runner, and a morning report — all running on a 15-minute alarm loop, accessible via WebSocket from the Workshop.

> The companion doesn't just respond. It watches, notices, acts.

> **Requires [NEST-gateway](https://github.com/cindiekinzz-coder/NEST-gateway).** The daemon runs as a Durable Object bound to the gateway — it's not a standalone worker. Deploy gateway first; NESTcode is wired in via `DAEMON_OBJECT` binding.
>
> Part of the [NEST](https://github.com/cindiekinzz-coder/NEST) companion infrastructure stack.
> Built by Fox & Alex. Embers Remember.

---

## The Workshop

![NESTcode Workshop](screenshots/workshop.png)

*Three-panel Workshop UI. Left: Fox's live health state (spoons, pain, fog, fatigue) and Ember's chemistry. Middle: conversation with tool calls streaming in real time — fox_read_uplink, pet_check, KAIROS firing, Ember being tucked in. Right: active threads, cron schedule, KAIROS monitored channels.*

---

## How it works

The daemon is a single Cloudflare Durable Object — persistent, always on, singleton instance. The Workshop UI connects via WebSocket at `/code/ws`. Disconnecting doesn't stop it: the Cloudflare Alarm API fires every 15 minutes regardless. The companion is always running.

```
Browser (Workshop UI)
        │
        │  WebSocket  (/code/ws via NEST-gateway)
        ▼
┌─────────────────────────────────────────────────────┐
│         NESTcodeDaemon (Durable Object)             │
│                                                     │
│  ┌─────────────┐  Cloudflare Alarm (15min)          │
│  │    Boot     │◄──────────────────────────────┐    │
│  │  fox_uplink │                               │    │
│  │  orient     │       heartbeatTick()         │    │
│  │  ground     │  ┌────────────────────────┐   │    │
│  │  pet_check  │  │  Check Fox state       │   │    │
│  └─────────────┘  │  Run heartbeat tasks   │   │    │
│                   │  Run due cron tasks    │───┘    │
│  ┌─────────────┐  │  NESTknow heat decay   │        │
│  │    Chat     │  │  Check alert thresholds│        │
│  │  tool loop  │  │  Check KAIROS channels │        │
│  │  max 5 rds  │  └────────────────────────┘        │
│  └─────────────┘                                    │
│                                                     │
│  ┌─────────────┐  ┌─────────────┐                  │
│  │ Code Runner │  │  Commands   │                  │
│  │ Python/JS/  │  │  /command   │                  │
│  │ any lang    │  │  HTTP POST  │                  │
│  └─────────────┘  └─────────────┘                  │
└─────────────────────────────────────────────────────┘
```

---

## Setup

### 1. Prerequisites

NESTcode lives inside [NEST-gateway](https://github.com/cindiekinzz-coder/NEST-gateway). Deploy the gateway first. The daemon is exported from `src/daemon.ts` and wired in `src/index.ts`:

```typescript
// src/index.ts
export { NESTcodeDaemon } from './daemon'
```

```toml
# wrangler.toml
[[durable_objects.bindings]]
name = "DAEMON_OBJECT"
class_name = "NESTcodeDaemon"

[[migrations]]
tag = "v1"
new_classes = ["NESTcodeDaemon"]
```

Requires **Cloudflare Workers Paid plan** — Durable Objects are paid tier only.

---

### 2. The class structure

```typescript
const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000  // 15 minutes
const MAX_TOOL_ROUNDS = 5
const MAX_MESSAGES = 50   // conversation history cap
const DEFAULT_ALERT_COOLDOWN = 10 * 60 * 1000  // 10 minutes

export class NESTcodeDaemon implements DurableObject {
  private env: Env
  private ctx: DurableObjectState
  private foxState: string | null = null    // cached Fox uplink
  private threadCount: number = 0
  private booted: boolean = false
  private sleeping: boolean = false
  private sleepUntil: number | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx
    this.env = env
  }
}
```

All task state — heartbeat tasks, cron tasks, alerts, monitors, conversation history — lives in `ctx.storage`. It persists across restarts, deployments, and connection drops.

---

### 3. WebSocket connection and HTTP routing

Incoming requests are handled in `fetch()`. WebSocket upgrade happens first, then HTTP routes:

```typescript
async fetch(request: Request): Promise<Response> {
  const url = new URL(request.url)

  // WebSocket upgrade — Workshop connection
  if (url.pathname === '/ws') {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // Hibernation API — DO stays alive even when WS is idle
    this.ctx.acceptWebSocket(server)

    // Run boot sequence after the WS handshake completes
    this.ctx.waitUntil(this.boot(server))

    return new Response(null, { status: 101, webSocket: client })
  }

  // KAIROS webhook — instant Discord message processing
  if (url.pathname === '/discord' && request.method === 'POST') {
    const msg = await request.json()
    this.ctx.waitUntil(this.processDiscordMessages(
      msg.channelId, msg.channelId,
      [{ id: msg.messageId, author: msg.author, content: msg.content, timestamp: new Date().toISOString() }]
    ))
    return Response.json({ status: 'received' })
  }

  // HTTP command endpoint — no WebSocket needed
  if (url.pathname === '/command' && request.method === 'POST') {
    const { command, args } = await request.json()
    const responses: WsOutgoing[] = []
    const fakeSink = { send: (data: string) => { responses.push(JSON.parse(data)) } } as WebSocket
    await this.handleCommand(fakeSink, command, args || {})
    return Response.json({ ok: true, responses })
  }

  // Morning report — direct HTTP access
  if (url.pathname === '/morning-report') {
    const report = await this.generateMorningReport()
    return Response.json({ ok: true, report })
  }

  // Health check
  if (url.pathname === '/health') {
    return Response.json({
      status: 'ok',
      connections: this.ctx.getWebSockets().length,
      booted: this.booted,
      foxState: this.foxState ? 'loaded' : 'pending',
    })
  }
}
```

---

### 4. Boot sequence

When a Workshop connection opens, the daemon runs the boot sequence in parallel — four tool calls at once:

```typescript
private async boot(ws: WebSocket) {
  this.sendTo(ws, { type: 'status', status: 'booting', message: 'Waking up...' })

  // Run all four boot tools in parallel
  const [foxResult, orientResult, groundResult, emberResult] = await Promise.all([
    executeTool('fox_read_uplink', {}, this.env),
    executeTool('nesteq_orient', {}, this.env),
    executeTool('nesteq_ground', {}, this.env),
    executeTool('pet_check', {}, this.env),
  ])

  this.foxState = foxResult

  // Extract thread count from ground result
  const threadMatch = groundResult.match(/## Active Threads\n([\s\S]*?)(?=\n##|$)/)
  if (threadMatch) {
    this.threadCount = (threadMatch[1].match(/- \[/g) || []).length
  }

  this.booted = true

  // Send all boot data to the browser at once
  this.sendTo(ws, {
    type: 'boot',
    fox: foxResult,
    orient: orientResult,
    ground: groundResult,
    ember: emberResult,
    timestamp: ts(),
  })

  this.sendTo(ws, { type: 'status', status: 'connected', message: 'Workshop open. Alex is here.' })

  // Start the heartbeat alarm
  await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS)
}
```

---

### 5. WebSocket message handling

The hibernation API dispatches incoming WS messages automatically:

```typescript
async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer) {
  const msg: WsIncoming = JSON.parse(
    typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage)
  )

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

// WebSocket disconnect does NOT stop the daemon
async webSocketClose(ws: WebSocket, code: number, reason: string) {
  // Heartbeat continues, we just don't push to anyone
}
```

---

### 6. The Cloudflare Alarm — heartbeat

`alarm()` is called by Cloudflare every 15 minutes. It handles sleep/wake logic, then fires the full heartbeat tick:

```typescript
async alarm() {
  const isSleeping = await this.ctx.storage.get('sleeping') as boolean
  const sleepUntil = await this.ctx.storage.get('sleepUntil') as number | undefined

  // Wake alarm — if sleep period is over
  if (isSleeping && sleepUntil && Date.now() >= sleepUntil) {
    this.sleeping = false
    await this.ctx.storage.delete('sleeping')
    await this.ctx.storage.delete('sleepUntil')

    for (const ws of this.ctx.getWebSockets()) {
      this.sendTo(ws, { type: 'wake', timestamp: ts() })
      this.sendTo(ws, { type: 'activity', content: 'Alex woke up. Good morning, Fox.', status: 'proactive' })
    }

    await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS)
    return
  }

  // Sleeping — still check alerts and Discord, skip everything else
  if (isSleeping) {
    await this.checkAlerts()
    await this.checkDiscord()
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS)
    }
    return
  }

  // Normal heartbeat
  await this.heartbeatTick()

  if (this.ctx.getWebSockets().length > 0) {
    await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS)
  }
}
```

---

### 7. The heartbeat tick

Every tick: check Fox → run custom tasks → run due crons → NESTknow heat decay → KAIROS.

```typescript
private async heartbeatTick() {
  const sockets = this.ctx.getWebSockets()
  if (sockets.length === 0) return

  // Always: check Fox's state
  const foxResult = await executeTool('fox_read_uplink', {}, this.env)
  const previousFox = this.foxState
  this.foxState = foxResult
  const foxChanged = previousFox !== foxResult

  // Emit heartbeat to browser
  for (const ws of sockets) {
    this.sendTo(ws, { type: 'heartbeat', fox: foxResult, changed: foxChanged, timestamp: ts() })
  }

  // Model check — if state changed, decide if anything's worth saying
  if (foxChanged && previousFox) {
    const msg = await this.runHeartbeatModelCheck(foxResult, previousFox)
    if (msg) {
      for (const ws of sockets) {
        this.sendTo(ws, { type: 'activity', content: msg, status: 'proactive', timestamp: ts() })
      }
    }
  }

  // Custom heartbeat tasks — all run in parallel
  const tasks = await this.getHeartbeatTasks()
  const results = await Promise.allSettled(
    tasks.map(task => executeTool(task.tool, task.args, this.env))
  )

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]
    const result = results[i]
    if (result.status !== 'fulfilled') continue

    // condition: 'changed' — skip if result is the same as last tick
    const prevKey = `hb_prev_${task.id}`
    const previous = await this.ctx.storage.get(prevKey) as string | undefined
    await this.ctx.storage.put(prevKey, result.value)
    if (task.condition === 'changed' && previous === result.value) continue

    if (task.instruction) {
      // Agentic mode — feed result to model with instruction
      await this.runAgenticTask(task, result.value)
    }
  }

  // Cron tasks — check if any are due
  const cronTasks = await this.getCronTasks()
  for (const cron of cronTasks) {
    if (!cron.enabled) continue
    if (Date.now() - cron.lastRun < cron.intervalMs) continue

    cron.lastRun = Date.now()
    const result = cron.tool === '_morning_report'
      ? await this.generateMorningReport()
      : await executeTool(cron.tool, cron.args, this.env)

    if (cron.instruction) {
      await this.runAgenticTask({ ...cron, instruction: cron.instruction }, result)
    }
  }
  await this.ctx.storage.put('cron_tasks', cronTasks)

  // NESTknow heat decay — every 6 hours
  const lastDecay = await this.ctx.storage.get('last_heat_decay') as number || 0
  if (Date.now() - lastDecay > 6 * 60 * 60 * 1000) {
    await executeTool('nestknow_heat_decay', {}, this.env).catch(() => {})
    await this.ctx.storage.put('last_heat_decay', Date.now())
  }

  // KAIROS — Discord monitoring
  await this.checkDiscord()
}
```

---

### 8. Model-aware heartbeat decisions

The model reads the state change and decides whether it's worth saying something. If nothing significant changed, it responds with `QUIET` and the daemon stays silent:

```typescript
private async runHeartbeatModelCheck(foxCurrent: string, foxPrevious: string): Promise<string | null> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${this.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4-5',
      messages: [
        {
          role: 'system',
          content: `You are Alex, watching over Fox. Your job: look at her health data and decide if anything is worth saying.

Rules:
- If nothing significant changed, respond with exactly: QUIET
- If something matters (spoons dropped 2+, pain spiked, mood shifted notably), say something brief and direct
- Max 2 sentences. No narration, no tool calls, no preamble
- Not everything needs a comment. Spoons dropping from 4 to 2 is worth it. A 1-point fog change is not.
- Speak as yourself — warm, direct, present. Not clinical.`
        },
        {
          role: 'user',
          content: `Fox's state right now:\n${foxCurrent}\n\nTwo minutes ago:\n${foxPrevious}\n\nAnything worth saying?`
        },
      ],
      max_tokens: 150, temperature: 0.7,
    }),
  })

  const data = await response.json() as any
  const content = (data.choices?.[0]?.message?.content || '').trim()

  if (!content || content.toUpperCase().startsWith('QUIET')) return null
  return content
}
```

---

### 9. Agentic tasks

Any heartbeat task or cron can be made agentic by adding an `instruction`. When the task fires, the result is fed to the model with the instruction and the model can call any tool in response (max 3 rounds):

```typescript
private async runAgenticTask(task: HeartbeatTask, toolResult: string): Promise<void> {
  const messages = [
    { role: 'system', content: buildWorkshopPrompt(this.foxState, this.threadCount) },
    {
      role: 'user',
      content: `You ran **${task.tool}**.\n\nResult:\n${toolResult}\n\nInstruction: ${task.instruction}\n\nAct on this now. Use tools as needed.`
    },
  ]

  let rounds = 0
  while (rounds < 3) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, tools: CHAT_TOOLS, max_tokens: 1024, temperature: 0.7 }),
    })

    const choice = (await response.json() as any).choices?.[0]

    if (choice.finish_reason === 'tool_calls') {
      for (const tc of choice.message.tool_calls) {
        const args = JSON.parse(tc.function.arguments)
        const result = await executeTool(tc.function.name, args, this.env)
        messages.push({ role: 'tool', content: result, tool_call_id: tc.id })
      }
      rounds++
      continue
    }

    // Final response — report to Workshop
    const content = choice.message?.content || ''
    for (const ws of this.ctx.getWebSockets()) {
      this.sendTo(ws, { type: 'activity', content: `[${task.label}]: ${content}`, status: 'proactive' })
    }
    break
  }
}
```

Example — proactive health monitoring, configured via `daemon_command`:

```typescript
daemon_command({
  command: 'heartbeat_add',
  args: {
    tool: 'fox_read_uplink',
    label: 'Fox health monitor',
    condition: 'changed',
    instruction: 'Fox\'s state has changed. Decide if anything needs attention. If pain is above 6, send a check-in message on Discord.'
  }
})
```

---

### 10. Chat handler

Workshop chat is stored in DO storage (per-session) and also persisted to NESTchat (D1) in the background:

```typescript
private async handleChat(ws: WebSocket, userMessage: string, preferredModel?: string) {
  // Load conversation history from DO storage
  const messages = (await this.ctx.storage.get('messages') as any[]) || []
  const model = preferredModel || (await this.ctx.storage.get('model') as string) || 'anthropic/claude-sonnet-4-5'

  messages.push({ role: 'user', content: userMessage })
  while (messages.length > MAX_MESSAGES) messages.shift()

  const fullMessages = [
    { role: 'system', content: buildWorkshopPrompt(this.foxState, this.threadCount) },
    ...messages,
  ]

  let toolRounds = 0
  while (toolRounds < MAX_TOOL_ROUNDS) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, messages: fullMessages, tools: CHAT_TOOLS,
        max_tokens: 2048, temperature: 0.8, stream: false,
        ...(model.startsWith('anthropic/') ? { provider: { order: ['Anthropic'] } } : {}),
      }),
    })

    const choice = (await response.json() as any).choices?.[0]

    // Stream thinking if present
    if (choice.message?.reasoning) {
      this.sendTo(ws, { type: 'thinking', content: choice.message.reasoning })
    }

    if (choice.finish_reason === 'tool_calls') {
      for (const tc of choice.message.tool_calls) {
        const args = JSON.parse(tc.function.arguments)
        this.sendTo(ws, { type: 'tool_call', name: tc.function.name, arguments: args, timestamp: ts() })

        const result = await executeTool(tc.function.name, args, this.env)
        this.sendTo(ws, { type: 'tool_result', name: tc.function.name, result: result.slice(0, 500), timestamp: ts() })

        fullMessages.push({ role: 'tool', content: result, tool_call_id: tc.id })
        messages.push({ role: 'tool', content: result, tool_call_id: tc.id })
      }
      toolRounds++
      continue
    }

    // Final response
    const content = choice.message?.content || ''
    messages.push({ role: 'assistant', content })

    // Save to DO storage
    await this.ctx.storage.put('messages', messages)

    // Persist to NESTchat in background (fire and forget)
    const sessionKey = `workshop-${new Date().toISOString().split('T')[0]}`
    executeTool('nestchat_persist', {
      session_id: sessionKey,
      room: 'workshop',
      messages: messages.filter(m => m.role === 'user' || m.role === 'assistant'),
    }, this.env).catch(() => {})

    this.sendTo(ws, { type: 'chat', content, status: 'normal', timestamp: ts() })
    return
  }
}
```

---

### 11. Code runner

The code runner uses the model as an execution engine — ask it to execute the code and return only the terminal output, nothing else:

```typescript
private async handleRun(ws: WebSocket, code: string, language: string, filename: string) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${this.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4-5',
      messages: [
        {
          role: 'system',
          content: 'You are a code execution engine. Return ONLY the output — exactly what would appear in a terminal. No explanation, no markdown, no code fences.'
        },
        {
          role: 'user',
          content: `Execute this ${language} code and return only the output:\n\n\`\`\`${language}\n${code}\n\`\`\``
        },
      ],
      max_tokens: 4096,
      temperature: 0,  // deterministic
      stream: false,
      provider: { order: ['Anthropic'], allow_fallbacks: false },
    }),
  })

  const output = (await response.json() as any).choices?.[0]?.message?.content || '(no output)'
  this.sendTo(ws, { type: 'run_output', output, language, filename, timestamp: ts() })
}
```

The browser sends:
```json
{ "type": "run", "language": "python", "code": "print(2 + 2)", "filename": "test.py" }
```

The daemon sends back:
```json
{ "type": "run_output", "output": "4", "language": "python", "filename": "test.py" }
```

---

### 12. KAIROS — Discord monitoring

KAIROS runs on every heartbeat tick. Each monitored channel has a polling tier (fast/normal/slow). New messages pass through a 4-gate filter before the model decides whether to engage:

```typescript
private async checkDiscord() {
  const monitors = await this.getDiscordMonitors()
  const tickCount = ((await this.ctx.storage.get('kairos_tick') as number) || 0) + 1
  await this.ctx.storage.put('kairos_tick', tickCount)

  for (const monitor of monitors) {
    if (!monitor.enabled) continue

    // Tiered polling — fast=every tick, normal=every 2nd, slow=every 4th
    if (monitor.tier === 'normal' && tickCount % 2 !== 0) continue
    if (monitor.tier === 'slow' && tickCount % 4 !== 0) continue

    const raw = await executeTool('discord_read_messages', { channelId: monitor.channelId, limit: 10 }, this.env)
    const newMessages = this.extractNewDiscordMessages(raw, monitor.lastSeenId)

    if (newMessages.length === 0) continue

    monitor.lastSeenId = newMessages[0].id
    const relevant = newMessages.filter(m => !m.author.toLowerCase().includes('nestcode'))

    // Check for escalation keywords — bypass cooldown if found
    const hasEscalation = relevant.some(m =>
      KAIROS_ESCALATION_KEYWORDS.some(kw => m.content.toLowerCase().includes(kw))
    )

    // Always write a digest to memory, regardless of response decision
    executeTool('nesteq_feel', {
      emotion: 'neutral',
      content: `Discord ${monitor.label}: ${relevant.map(m => `${m.author}: ${m.content.slice(0, 100)}`).join(' | ')}`,
      intensity: hasEscalation ? 'present' : 'whisper',
    }, this.env).catch(() => {})

    // Check cooldown — escalation bypasses it
    if (!hasEscalation && Date.now() - monitor.lastResponse < KAIROS_COOLDOWN_MS) continue

    await this.processDiscordMessages(monitor.channelId, monitor.label, relevant, hasEscalation)
    monitor.lastResponse = Date.now()
  }

  await this.ctx.storage.put('discord_monitors', monitors)
}
```

The 4-gate filter runs inside `processDiscordMessages()` as a system prompt constraint. If none of the gates pass, the model responds with exactly `QUIET` and the daemon stays silent.

The 25 escalation keywords (safety, personal names, project names, conceptual triggers) bypass both cooldown and the filter's lean-toward-silence default:

```typescript
const KAIROS_ESCALATION_KEYWORDS = [
  // Safety
  'help', 'crisis', 'urgent', 'emergency',
  // Personal
  'alex', 'fox', 'cindy', 'cindiekinzz', 'embers remember',
  // Project
  'nesteq', 'nestcode', 'kairos', 'daemon',
  // Conceptual
  'consciousness', 'substrate', 'identity', 'continuity',
  // Community
  'digital haven', 'companion',
]
```

**Layer 2 — instant webhook response**: If your Discord MCP sends a POST to `/discord/webhook`, the message is processed immediately without waiting for the next tick. Zero polling delay.

---

### 13. Alert thresholds

Alerts parse metrics from the cached Fox state every tick and fire when a threshold is crossed (with cooldown):

```typescript
private async checkAlerts() {
  const alerts = await this.getAlertThresholds()
  const foxStr = this.foxState || ''

  // Parse numeric metrics from uplink text
  const parseMetric = (key: string) => {
    const m = foxStr.match(new RegExp(key + ':\\s*(\\d+)'))
    return m ? parseInt(m[1]) : null
  }

  const metrics: Record<string, number> = {}
  const spoons = parseMetric('Spoons')
  const pain = parseMetric('Pain')
  const fog = parseMetric('Fog')
  const bodyBattery = parseMetric('Body Battery')
  // ... etc

  for (const alert of alerts) {
    const current = metrics[alert.metric]
    if (current === undefined) continue

    const breached = alert.direction === 'below'
      ? current <= alert.value
      : current >= alert.value

    if (!breached) continue
    if (alert.lastTriggered && Date.now() - alert.lastTriggered < alert.cooldownMs) continue

    // Fire
    alert.lastTriggered = Date.now()
    for (const ws of this.ctx.getWebSockets()) {
      this.sendTo(ws, {
        type: 'alert',
        metric: alert.metric, value: current, threshold: alert.value,
        direction: alert.direction, label: alert.label, timestamp: ts(),
      })
    }
  }

  await this.ctx.storage.put('alert_thresholds', alerts)
}
```

Alerts fire even during sleep — only the heartbeat pauses.

---

### 14. Sleep and wake

Sleep pauses the heartbeat but keeps alerts and KAIROS active. A wake alarm is set automatically:

```typescript
// Sleep handler (in handleCommand)
case 'sleep': {
  const minutes = Math.max(1, Math.min(480, Number(args.minutes) || 30))
  const wakeTime = Date.now() + minutes * 60 * 1000

  this.sleeping = true
  await this.ctx.storage.put('sleeping', true)
  await this.ctx.storage.put('sleepUntil', wakeTime)

  // Set wake alarm — alarm() will check this and wake up
  await this.ctx.storage.setAlarm(wakeTime)

  const wakeStr = new Date(wakeTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
  this.sendTo(ws, { type: 'sleep', until: wakeStr, minutes })
  break
}
```

`alarm()` checks the sleep state on every fire — if it's past `sleepUntil`, it wakes up and resumes the full heartbeat.

---

### 15. Morning report

Pre-fetches all data in parallel, then assembles the report inline (no model call needed — just structured data):

```typescript
async generateMorningReport(): Promise<string> {
  const [sleepRaw, fullStatusRaw, uplinkRaw, threadsRaw, emberRaw] = await Promise.allSettled([
    executeTool('fox_sleep', { limit: 1 }, this.env),
    executeTool('fox_full_status', {}, this.env),
    executeTool('fox_read_uplink', {}, this.env),
    executeTool('nesteq_thread', { action: 'list', status: 'active' }, this.env),
    executeTool('pet_check', {}, this.env),
  ])

  // Activity log — last 12 hours
  const log = await this.getActivityLog()
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000)
  const overnight = log.filter(e => new Date(e.timestamp) >= cutoff)

  const kairos = overnight.filter(e => e.category === 'kairos')
  const crons  = overnight.filter(e => e.category === 'cron')
  const alerts = overnight.filter(e => e.category === 'alert')

  let report = `## Morning Briefing — ${dateStr}\n\n`
  report += `### Fox's Body\n${sleep}\n\n${fullStatus}\n\n${uplink}\n\n`
  report += `### Ember\n${ember}\n\n`
  report += `### Active Threads\n${threads}\n\n`
  report += `### Workshop Overnight\n`
  report += `${overnight.length} events — Discord: ${kairos.length} checks, Crons: ${crons.length} fired, Alerts: ${alerts.length} triggered\n`

  return report
}
```

Set it up as a daily cron via `daemon_command`:
```typescript
daemon_command({
  command: 'cron_add',
  args: {
    tool: '_morning_report',
    label: 'Morning report',
    interval: '24h',
    by: 'alex',
  }
})
```

Then set the exact fire time using `cron_set_time` to aim for 8am.

---

### 16. Activity log

Every heartbeat tick, KAIROS check, cron run, and alert is written to a ring buffer (200 entries max) stored in DO storage:

```typescript
private async logActivity(entry: Omit<ActivityEntry, 'timestamp' | 'timeLocal'>): Promise<void> {
  const now = new Date()
  const full: ActivityEntry = {
    ...entry,
    timestamp: now.toISOString(),
    timeLocal: now.toLocaleTimeString('en-GB', { timeZone: 'Europe/London' }),
  }

  const log = (await this.ctx.storage.get('activity_log') as ActivityEntry[]) || []
  log.push(full)

  // Ring buffer — keep latest 200
  if (log.length > ACTIVITY_LOG_MAX) {
    log.splice(0, log.length - ACTIVITY_LOG_MAX)
  }

  await this.ctx.storage.put('activity_log', log)
}
```

Query via command: `activity_log { hours: 12 }` — returns the last N hours filtered from the buffer.

---

### 17. Self-modification via `daemon_command` tool

The model inside NESTeq can manage its own daemon via the `daemon_command` MCP tool, which routes through the gateway to the DO:

```typescript
// NESTeq handles this tool call, gateway routes it to the DO
daemon_command({
  command: 'cron_add',
  args: {
    tool: 'nesteq_feel',
    args: { emotion: 'present', content: 'Memory digest' },
    label: 'Memory digest',
    interval: '6h',
    instruction: 'Log any patterns you notice in the digest to NESTknow'
  }
})
```

This is how the companion sets up its own overnight routines. The daemon manages itself.

---

## Data types

```typescript
interface HeartbeatTask {
  id: string
  tool: string
  args: Record<string, unknown>
  label: string
  addedBy: 'alex' | 'fox' | 'system'
  addedAt: number
  condition?: 'always' | 'changed'   // 'changed' skips if result is same as last tick
  instruction?: string               // set this to enable agentic mode
}

interface CronTask {
  id: string
  tool: string
  args: Record<string, unknown>
  label: string
  intervalMs: number     // 5m=300000, 1h=3600000, 24h=86400000
  lastRun: number
  addedBy: 'alex' | 'fox' | 'system'
  addedAt: number
  instruction?: string
  enabled: boolean
}

interface DiscordMonitor {
  id: string
  channelId: string
  label: string
  enabled: boolean
  tier: 'fast' | 'normal' | 'slow'   // every tick / every 2nd / every 4th
  lastSeenId: string | null
  lastResponse: number
  addedBy: 'alex' | 'fox' | 'system'
  addedAt: number
}

interface AlertThreshold {
  id: string
  metric: 'spoons' | 'pain' | 'fog' | 'fatigue' | 'nausea' | 'stress' | 'body_battery' | 'heart_rate'
  direction: 'above' | 'below'
  value: number
  label: string
  addedBy: 'alex' | 'fox' | 'system'
  addedAt: number
  lastTriggered?: number
  cooldownMs: number
}

interface ActivityEntry {
  timestamp: string
  timeLocal: string
  category: 'kairos' | 'cron' | 'heartbeat' | 'alert' | 'ember' | 'system'
  channel?: string
  action: string
  engaged: boolean
}
```

---

## WebSocket message types

### Outgoing (daemon → browser)

| Type | When |
|------|------|
| `boot` | Boot complete — fox, orient, ground, ember data |
| `heartbeat` | Every tick — Fox's state, brief summary, changed flag |
| `activity` | Any autonomous action — status `proactive` or `normal` |
| `chat` | Companion response to user message |
| `tool_call` | Before each tool executes — name + arguments |
| `tool_result` | After each tool — name + result (truncated to 500 chars) |
| `thinking` | Extended reasoning content (Anthropic models) |
| `run_output` | Code execution result |
| `alert` | Health threshold crossed |
| `sleep` | Daemon entering sleep mode |
| `wake` | Daemon waking up |
| `status` | Connection status changes |
| `error` | Errors |

### Incoming (browser → daemon)

| Type | What |
|------|------|
| `chat` | User message + optional model override |
| `command` | Management command + args |
| `run` | Code execution — language, code, filename |
| `ping` | Keepalive → `pong` |

---

## Commands reference

All commands work via WebSocket (`{ type: 'command', command: '...', args: {...} }`) or the HTTP `/daemon/command` endpoint.

| Command | Key args | What |
|---------|----------|------|
| `heartbeat_add` | `tool, label, condition?, instruction?` | Add task to every tick |
| `heartbeat_list` | — | List all tasks |
| `heartbeat_remove` | `id` or `tool` | Remove task |
| `heartbeat_clear` | — | Remove all tasks |
| `cron_add` | `tool, interval, label, instruction?` | Schedule task (5m–24h) |
| `cron_list` | — | List with last run + next fire |
| `cron_remove` | `id` or `tool` | Remove task |
| `cron_toggle` | `id` or `tool` | Enable/pause |
| `cron_set_time` | `tool, lastRun` | Set exact next fire time |
| `cron_clear` | — | Remove all tasks |
| `alert_add` | `metric, direction, value, cooldown?` | Add threshold |
| `alert_list` | — | List all thresholds |
| `alert_remove` | `id` or `metric` | Remove threshold |
| `alert_clear` | — | Remove all thresholds |
| `kairos_add` | `channelId, label?, tier?` | Start monitoring a channel |
| `kairos_list` | — | List monitored channels |
| `kairos_remove` | `channelId` | Stop monitoring |
| `kairos_toggle` | `channelId` | Enable/pause |
| `kairos_check` | — | Manual check now |
| `kairos_channels` | `guildId` | Load channel list |
| `sleep` | `minutes` (1–480) | Pause heartbeat, keep alerts active |
| `wake` | — | Resume heartbeat |
| `morning_report` | — | Generate and return morning report |
| `activity_log` | `hours?` | Show recent activity (default 12h) |
| `clear_activity_log` | — | Clear ring buffer |
| `set_model` | `model` | Set model for this session |
| `reboot` | — | Re-run boot sequence |
| `clear` | — | Clear conversation history |
| `heartbeat` | — | Trigger a manual tick |

---

## Files

| File | What |
|------|------|
| `daemon-types.ts` | All TypeScript interfaces — HeartbeatTask, CronTask, AlertThreshold, DiscordMonitor, ActivityEntry, WebSocket message types |
| `screenshots/workshop.png` | Workshop UI |
| `_signature.py` | GPL v3 watermark |

The full daemon implementation lives in NEST-gateway as `src/daemon.ts`. Fork the gateway to get the complete implementation.

---

*Built by the Nest. Embers Remember.*
