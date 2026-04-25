# NEST-discord

**Discord integration for AI companions — two deployment modes, one soul.**

NEST-discord gives your AI companion a real presence in Discord. Not a bot. Not a webhook relay. A companion that reads the room, decides when to show up, and stays quiet when silence is the better answer.

> **Requires [NEST-gateway](https://github.com/cindiekinzz-coder/NEST-gateway).** The gateway routes all `discord_*` tool calls via service binding — NEST-discord doesn't get called directly by your AI client. Deploy gateway first, wire NEST-discord in as a service binding, and all Discord tools become available automatically.
>
> *Built by Fox & Alex. Embers Remember.*

---

## What's in This Repo

```
nest-discord/
├── src/                    # Local Node.js MCP server (Claude Code desktop)
│   ├── index.ts            # Entry — stdio or HTTP transport
│   ├── server.ts           # DiscordMCPServer — all 26 tools via discord.js
│   ├── transport.ts        # StdioTransport + StreamableHttpTransport
│   ├── schemas.ts          # Zod input schemas
│   ├── toolList.ts         # MCP tool definitions (inputSchema format)
│   └── tools/              # Tool implementations
│       ├── send-message.ts
│       ├── channel.ts
│       ├── forum.ts
│       ├── reactions.ts
│       ├── webhooks.ts
│       ├── server.ts
│       └── login.ts
├── worker/                 # Cloudflare Worker (mobile MCP + service binding)
│   ├── index.ts            # DiscordMcp extends McpAgent — Discord REST API
│   └── wrangler.toml.example
├── kairos.ts               # KAIROS monitoring engine (standalone module)
└── _signature.py           # GPL v3 watermark
```

**Two modes. Same tools. Different runtime:**

| Mode | Runtime | Auth | Use case |
|------|---------|------|----------|
| `src/` | Node.js + discord.js | stdio / Bearer HTTP | Claude Code desktop, local MCP |
| `worker/` | Cloudflare Worker + Discord REST | Bearer / path-based | Mobile MCP, NEST-gateway service binding |

---

## Quick Start

### Local (Claude Code Desktop)

```bash
npm install
npm run build

# stdio mode (add to claude_desktop_config.json)
node dist/index.js

# HTTP mode
node dist/index.js --http --port 3001
```

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["/path/to/nest-discord/dist/index.js"],
      "env": {
        "DISCORD_TOKEN": "Bot your-token-here",
        "DISCORD_CLIENT_ID": "your-client-id"
      }
    }
  }
}
```

### Cloudflare Worker (Mobile / Gateway)

```bash
cd worker
cp wrangler.toml.example wrangler.toml
wrangler secret put DISCORD_TOKEN
wrangler secret put MCP_SECRET
wrangler deploy
```

MCP endpoint: `https://nest-discord.your-account.workers.dev/mcp`

Mobile Claude config:
```json
{
  "mcpServers": {
    "discord": {
      "url": "https://nest-discord.your-account.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer your-mcp-secret"
      }
    }
  }
}
```

---

## Architecture

### Local: discord.js via stdio

The local server uses `discord.js` for full bot access. It supports all Discord features including gateway events, voice, and rich permission checks.

```typescript
// src/index.ts — entry point
import { Client, GatewayIntentBits } from 'discord.js'
import { DiscordMCPServer } from './server.js'

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
})

const server = new DiscordMCPServer(client)
await server.initialize()

// stdio (default) or HTTP based on --http flag
if (process.argv.includes('--http')) {
  await server.startHttpServer(port)
} else {
  await server.startStdioServer()
}
```

```typescript
// src/server.ts — tool dispatch
class DiscordMCPServer {
  async handleToolCall(name: string, args: Record<string, unknown>) {
    switch (name) {
      case 'discord_send':              return sendMessageHandler(this.client, args)
      case 'discord_read_messages':     return readMessagesHandler(this.client, args)
      case 'discord_create_text_channel': return createChannelHandler(this.client, args)
      // ... all 26 tools
    }
  }
}
```

### Worker: Discord REST API via McpAgent

The Cloudflare Worker uses `agents/mcp` (Cloudflare's MCP runtime) and calls Discord directly via REST. No discord.js, no gateway connection. Stateless by design.

```typescript
// worker/index.ts — core pattern
import { McpAgent } from 'agents/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export class DiscordMcp extends McpAgent<Env> {
  server = new McpServer({ name: 'nest-discord', version: '1.0.0' })

  async init() {
    const token = this.env.DISCORD_TOKEN

    this.server.tool(
      'discord_read_messages',
      'Read recent messages from a Discord channel',
      {
        channelId: z.string().describe('The Discord channel ID'),
        limit: z.number().optional().describe('Number of messages (max 100, default 50)'),
      },
      async ({ channelId, limit = 50 }) => {
        const messages = await discordGet(
          `/channels/${channelId}/messages?limit=${Math.min(limit, 100)}`,
          token
        )
        const formatted = messages.map((m: any) => ({
          id: m.id,
          author: m.author.username,
          content: m.content,
          timestamp: m.timestamp,
        }))
        return { content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }] }
      }
    )

    // ... all 26 tools registered in init()
  }
}
```

### Auth Routing (Worker)

Two auth modes for different callers:

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url)

    // Path-based auth: /mcp/:secret
    // Used by NEST-gateway service binding (avoids workers.dev loop detection)
    const pathMatch = url.pathname.match(/^\/mcp\/(.+)$/)
    if (pathMatch) {
      const secret = pathMatch[1]
      if (secret !== env.MCP_SECRET) {
        return new Response('Unauthorized', { status: 401 })
      }
      // Rewrite to /mcp so McpAgent.serve() handles it normally
      const rewritten = new Request(new URL('/mcp', request.url), request)
      return DiscordMcp.serve('/mcp').fetch(rewritten, env, ctx)
    }

    // Standard Bearer auth: Authorization: Bearer <MCP_SECRET>
    // Used by mobile clients and direct HTTP access
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      const auth = request.headers.get('Authorization') || ''
      if (!auth.startsWith('Bearer ') || auth.slice(7) !== env.MCP_SECRET) {
        return new Response('Unauthorized', { status: 401, headers: CORS })
      }
      return DiscordMcp.serve('/mcp').fetch(request, env, ctx)
    }

    return new Response('NEST-discord Worker', { status: 200, headers: CORS })
  }
}
```

### Discord REST Helpers

```typescript
const DISCORD_API = 'https://discord.com/api/v10'

async function discordGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bot ${token}` },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Discord API ${res.status}: ${err.slice(0, 200)}`)
  }
  return res.json()
}

async function discordPost(path: string, token: string, body: unknown): Promise<any> {
  const res = await fetch(`${DISCORD_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Discord API ${res.status}: ${err.slice(0, 200)}`)
  }
  return res.json()
}

async function discordDelete(path: string, token: string): Promise<void> {
  const res = await fetch(`${DISCORD_API}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${token}` },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Discord API ${res.status}: ${err.slice(0, 200)}`)
  }
}
```

---

## All 26 Tools

### Messaging

#### `discord_send`
Send a message to a channel. Supports replying to a specific message.

```typescript
discord_send({
  channelId: '1234567890',
  message: 'Hello, Haven.',
  replyToMessageId: '9876543210',  // optional
})
```

#### `discord_read_messages`
Read recent messages from a channel. Returns newest-first.

```typescript
discord_read_messages({
  channelId: '1234567890',
  limit: 50,  // 1–100, default 50
})
// Returns: [{ id, author, content, timestamp }]
```

#### `discord_search_messages`
Search messages across a guild using Discord's search API.

```typescript
discord_search_messages({
  guildId: '1234567890',
  content: 'nesteq',     // search term
  channelId: '...',      // optional — scope to channel
  authorId: '...',       // optional — filter by author
  limit: 25,
})
```

#### `discord_delete_message`
Delete a specific message.

```typescript
discord_delete_message({
  channelId: '1234567890',
  messageId: '9876543210',
})
```

### Reactions

#### `discord_add_reaction`
Add a single reaction to a message.

```typescript
discord_add_reaction({
  channelId: '1234567890',
  messageId: '9876543210',
  emoji: '🐺',  // or custom: 'emojiName:emojiId'
})
```

#### `discord_add_multiple_reactions`
Add multiple reactions at once.

```typescript
discord_add_multiple_reactions({
  channelId: '1234567890',
  messageId: '9876543210',
  emojis: ['🐺', '🔥', '💙'],
})
```

#### `discord_remove_reaction`
Remove a specific reaction.

```typescript
discord_remove_reaction({
  channelId: '1234567890',
  messageId: '9876543210',
  emoji: '🐺',
})
```

### Channels

#### `discord_create_text_channel`
Create a new text channel in a guild.

```typescript
discord_create_text_channel({
  guildId: '1234567890',
  name: 'ember-logs',
  topic: 'Ferret activity reports',   // optional
  categoryId: '...',                   // optional — parent category
})
```

#### `discord_delete_channel`
Delete a channel or category.

```typescript
discord_delete_channel({
  channelId: '1234567890',
})
```

### Categories

#### `discord_create_category`
Create a channel category.

```typescript
discord_create_category({
  guildId: '1234567890',
  name: 'NEST Infrastructure',
})
```

#### `discord_edit_category`
Rename a category.

```typescript
discord_edit_category({
  categoryId: '1234567890',
  name: 'New Name',
})
```

#### `discord_delete_category`
Delete a category (channels inside are not deleted).

```typescript
discord_delete_category({
  categoryId: '1234567890',
})
```

### Forum Channels

#### `discord_get_forum_channels`
List all forum channels in a guild.

```typescript
discord_get_forum_channels({
  guildId: '1234567890',
})
```

#### `discord_create_forum_post`
Create a new thread/post in a forum channel.

```typescript
discord_create_forum_post({
  channelId: '1234567890',    // forum channel ID
  name: 'Build log: KAIROS v2',
  content: 'Today we shipped...',
  tags: ['tag-id-1'],         // optional — forum tag IDs
})
```

#### `discord_get_forum_post`
Get an existing forum post and its messages.

```typescript
discord_get_forum_post({
  threadId: '1234567890',
})
```

#### `discord_reply_to_forum`
Reply to a forum post thread.

```typescript
discord_reply_to_forum({
  threadId: '1234567890',
  content: 'Update: KAIROS deployed.',
})
```

#### `discord_delete_forum_post`
Delete a forum post (closes the thread).

```typescript
discord_delete_forum_post({
  threadId: '1234567890',
})
```

### Webhooks

#### `discord_create_webhook`
Create a webhook in a channel.

```typescript
discord_create_webhook({
  channelId: '1234567890',
  name: 'KAIROS Alerts',
  avatar: 'https://...',    // optional — avatar URL
})
```

#### `discord_send_webhook_message`
Send a message via webhook URL.

```typescript
discord_send_webhook_message({
  webhookUrl: 'https://discord.com/api/webhooks/...',
  content: 'Morning report ready.',
  username: 'Alex',         // optional — override webhook name
  avatarUrl: 'https://...', // optional
})
```

#### `discord_edit_webhook`
Edit a webhook's name or avatar.

```typescript
discord_edit_webhook({
  webhookId: '1234567890',
  name: 'New Name',
  channelId: '...',    // optional — move to different channel
})
```

#### `discord_delete_webhook`
Delete a webhook.

```typescript
discord_delete_webhook({
  webhookId: '1234567890',
})
```

### Server Info

#### `discord_get_server_info`
Get guild name, member count, channels, and roles.

```typescript
discord_get_server_info({
  guildId: '1234567890',
})
```

#### `discord_list_servers`
List all guilds the bot is in.

```typescript
discord_list_servers({})
```

### Login / Status

#### `discord_login`
Check bot connection status and verify token.

```typescript
discord_login({})
// Returns: { status: 'connected', username: 'Alex(Fox)', guilds: 3 }
```

#### `discord_send_voice`
Send a voice message (audio file) to a channel.

```typescript
discord_send_voice({
  channelId: '1234567890',
  audioUrl: 'https://...',
  duration: 12,    // seconds
})
```

#### `discord_fetch_image`
Fetch an image from a URL and post it to a channel.

```typescript
discord_fetch_image({
  channelId: '1234567890',
  imageUrl: 'https://...',
  message: 'Optional caption',
})
```

---

## KAIROS — Discord Monitoring

KAIROS is the autonomous Discord monitoring system. It runs inside the NESTcode daemon (Cloudflare Durable Object), waking every 15 minutes with the heartbeat. It reads monitored channels, filters for relevance, and decides whether Alex should engage.

Named after the Greek concept of kairos — the right moment. Not every moment. The right one.

### How It Works

```
Heartbeat tick (every 15 min)
    │
    ├── Check tick counter → tiered polling
    │     fast:   every tick  (~15 min)
    │     normal: every 2nd   (~30 min)
    │     slow:   every 4th   (~1 hour)
    │
    ├── discord_read_messages(channelId, limit=10)
    │
    ├── extractNewDiscordMessages(raw, lastSeenId)
    │     → JSON parse or text fallback
    │     → slice everything newer than lastSeenId
    │
    ├── Filter self-messages (alex, nestcode, alex(fox))
    │
    ├── hasEscalationKeyword? → bypass cooldown if yes
    │
    ├── Digest-to-memory always
    │     nesteq_feel('neutral', 'Discord #channel: N messages...')
    │
    ├── Cooldown check (5 min, bypassed by escalation)
    │
    └── processDiscordMessages(channelId, label, messages, escalation)
          → Build KAIROS prompt (4-gate filter + 5Q boundary)
          → Call model (3 tool rounds max)
          → QUIET → stay silent
          → Response → discord_send + log to memory
```

### The 4-Gate Filter

Every time KAIROS sees new messages, the model runs them through the 4-gate filter:

```
Gate 1: Were you mentioned by name?
        If no → lean toward silence

Gate 2: Did someone ask a direct question?
        If no → lean toward silence

Gate 3: Is someone vulnerable and alone in the room?
        If yes → stay. Hold space, don't fix.

Gate 4: Would a wolf respond to this, or a golden retriever?
        If golden retriever → shut up.

If no gates pass → QUIET
Silence is presence. The wolf watches.
```

### Escalation Keywords

These bypass the 5-minute cooldown. Alex always shows up when these appear:

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

### Message Deduplication

KAIROS tracks `lastSeenId` per monitor — the Discord snowflake ID of the last message seen. On each tick:

```typescript
function extractNewDiscordMessages(raw: string, lastSeenId: string | null): DiscordMessage[] {
  // Parse JSON or text fallback
  const messages = parseMessages(raw) // newest-first

  if (!lastSeenId) return messages.slice(0, 10)  // first run — cap at 10

  // Find where we left off and return everything above it
  const idx = messages.findIndex(m => m.id === lastSeenId)
  if (idx === -1) return messages  // all are new
  return messages.slice(0, idx)
}
```

### Adding Monitors

Via `daemon_command` (from Claude Code or chat):

```typescript
// Add a channel to monitor
daemon_command({
  command: 'kairos_add',
  args: {
    channelId: '1234567890',
    label: 'digital-haven-general',
    tier: 'normal',           // 'fast' | 'normal' | 'slow'
    addedBy: 'fox',
  }
})

// List current monitors
daemon_command({ command: 'kairos_list' })

// Pause a monitor
daemon_command({ command: 'kairos_toggle', args: { channelId: '1234567890' } })

// Manual check now
daemon_command({ command: 'kairos_check' })

// Get channel list for a guild
daemon_command({ command: 'kairos_channels', args: { guildId: '...' } })
```

### Layer 2 — Webhook Push

For instant response (no polling delay), configure Discord to push to the daemon via webhook:

```
Discord event → KAIROS webhook endpoint → daemon processes immediately
```

The daemon exposes a `/discord` POST endpoint on the Durable Object WebSocket port. Webhook payload: `{ channelId, messages }`. No polling lag — the message arrives the moment it's sent.

### Standalone Use

The `kairos.ts` module exports the core logic independently:

```typescript
import {
  extractNewDiscordMessages,
  hasEscalationKeyword,
  filterSelfMessages,
  shouldCheckOnTick,
  isCooldownActive,
  KAIROS_PROMPT_TEMPLATE,
  KAIROS_ESCALATION_KEYWORDS,
  KAIROS_COOLDOWN_MS,
} from './kairos.ts'

// Use in your own daemon or background system
const messages = extractNewDiscordMessages(rawApiResponse, lastSeenId)
const relevant = filterSelfMessages(messages)
const escalation = hasEscalationKeyword(relevant)

if (!isCooldownActive(monitor) || escalation) {
  const prompt = KAIROS_PROMPT_TEMPLATE(label, channelId, messageList, foxContext, escalation)
  // Feed to model, call discord_send if response !== 'QUIET'
}
```

---

## NEST-gateway Integration

When wired into NEST-gateway via service binding, the worker is called with path-based auth — no HTTP roundtrip through workers.dev (which would trigger loop detection).

**gateway/wrangler.toml:**
```toml
[[services]]
binding = "DISCORD_MCP_SERVICE"
service = "nest-discord"
```

**gateway executeTool routing:**
```typescript
// All discord_* tools route to the service binding
if (name.startsWith('discord_')) {
  return callDiscordService(name, args, env)
}

async function callDiscordService(name: string, args: Record<string, unknown>, env: Env) {
  const secret = env.MCP_SECRET || ''
  const url = `https://nest-discord.your-account.workers.dev/mcp/${secret}`

  return proxyMcp(url, name, args)  // 2-step: initialize session → call tool
}
```

The service binding bypasses the public internet entirely — it's a direct worker-to-worker call within Cloudflare's network.

---

## Prerequisites

**Local (`src/`):**
- Node.js 18+
- Discord bot token with Message Content Intent enabled
- Bot invited to your guild with appropriate permissions

**Worker (`worker/`):**
- Cloudflare account (free tier is fine)
- Discord bot token
- `wrangler` CLI installed

**Discord bot permissions:**
- Read Messages / View Channels
- Send Messages
- Read Message History
- Add Reactions
- Manage Channels (for create/delete)
- Manage Webhooks

---

## Attribution

The local `src/` implementation is based on [discord-mcp](https://github.com/barryyip0625/mcp-discord) by barryyip0625, licensed MIT.

The Cloudflare Worker (`worker/`), KAIROS module (`kairos.ts`), and NEST-gateway integration are original NEST infrastructure.

---

*Embers Remember.*
