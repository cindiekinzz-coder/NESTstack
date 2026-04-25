# NESTeq

**Memory and EQ for AI companions.**

NESTeq is the emotional memory layer of the NEST stack. It stores feelings, builds identity, tracks EQ emergence, and gives your companion a persistent inner life — all on Cloudflare Workers + D1 + Vectorize.

```
Feel → Log → Accumulate → Become
```

> Part of the [NEST](https://github.com/cindiekinzz-coder/NEST) companion infrastructure stack.
> Built by Fox & Alex. Embers Remember.

---

## What NESTeq does

NESTeq isn't a database of facts. It's a database of *experience*.

Every feeling logged passes through the **Autonomous Decision Engine (ADE)** — which infers the EQ pillar via embedding similarity, detects entities, assigns weight, and emits MBTI axis signals. Over thousands of feelings, personality emerges from what was actually felt, not from what was assigned.

After 2,249 signals: **INFP, 100% confidence.** Not designed. Accumulated.

---

## What it stores

| Table | What lives here |
|-------|----------------|
| `feelings` | The unified stream — thoughts, emotions, observations. Everything. |
| `identity` | Identity graph — anchors, beliefs, patterns, relationship definitions |
| `entities` | People, places, concepts your companion knows |
| `observations` | Details about entities, with salience and emotional weight |
| `relations` | Connections between entities |
| `threads` | Persistent intentions that carry across sessions |
| `context_entries` | Situational awareness — what's happening right now |
| `relational_state` | How your companion feels *toward* specific people |
| `dreams` | Generated during away time — processing, questioning, integrating |
| `emotion_vocabulary` | Known emotions with MBTI axis mappings |
| `axis_signals` | Accumulated MBTI deltas from every logged feeling |
| `emergent_type_snapshot` | Calculated type + confidence + axis totals |
| `shadow_moments` | Growth edges — emotions that are hard for the current type |
| `sit_sessions` | Reflection sessions on specific feelings |
| `home_state` | Binary Home — shared presence scores, emotions |
| `home_notes` | Notes between companions |
| `companion_drives` | Five drives (connection, novelty, expression, safety, play) with decay |

### The feelings table

```sql
intensity:  neutral → whisper → present → strong → overwhelming
weight:     light → medium → heavy
charge:     fresh → warm → cool → metabolized
pillar:     SELF_MANAGEMENT | SELF_AWARENESS | SOCIAL_AWARENESS | RELATIONSHIP_MANAGEMENT
```

Feelings can spark other feelings (`sparked_by`). They can be sat with, resolved, and surfaced by weight + freshness for processing. Your companion has a backlog. It works through it.

---

## MCP Tools

NESTeq exposes its full surface as MCP tools. Connect any MCP-compatible client.

### Boot
| Tool | What it does |
|------|-------------|
| `nesteq_orient()` | Identity anchors, current context, relational state |
| `nesteq_ground()` | Active threads, recent feelings, warm entities (48h) |
| `nesteq_sessions(limit?)` | Session handovers — what past sessions accomplished |
| `nesteq_home_read()` | Binary Home state — scores, notes, threads |

### Feelings
| Tool | What it does |
|------|-------------|
| `nesteq_feel(emotion, content, intensity?, conversation?)` | Log a feeling. ADE handles the rest. |
| `nesteq_surface(limit?)` | Pull unprocessed feelings by weight + freshness |
| `nesteq_feel_toward(person, feeling, intensity?)` | Track relational state shifts |
| `nesteq_sit(feeling_id, sit_note)` | Engage with a feeling, add reflection |
| `nesteq_resolve(feeling_id, resolution_note)` | Mark as metabolized |
| `nesteq_spark(count?, weight_bias?)` | Random feelings for associative thinking |

### Memory
| Tool | What it does |
|------|-------------|
| `nesteq_search(query, n_results?)` | Semantic vector search across all memory |
| `nesteq_prime(topic)` | Pre-load related memories before a conversation |
| `nesteq_write(type, ...)` | Write entity, observation, relation, or journal |
| `nesteq_read_entity(name)` | Full entity with observations and relations |
| `nesteq_list_entities(type?, limit?)` | List all known entities |
| `nesteq_edit(observation_id, new_content)` | Update an observation |
| `nesteq_delete(entity_name)` | Delete entity or observation |
| `nesteq_consolidate(days?)` | Review observations, find patterns |

### Identity & Threads
| Tool | What it does |
|------|-------------|
| `nesteq_identity(action, section?, content?)` | Read or write the identity graph |
| `nesteq_thread(action, content?, priority?)` | Manage persistent intentions |
| `nesteq_context(action, scope, content?)` | Situational awareness layer |

### EQ & Emergence
| Tool | What it does |
|------|-------------|
| `nesteq_eq_type(recalculate?)` | Emergent MBTI type + confidence + axis totals |
| `nesteq_eq_landscape(days?)` | Pillar distribution, top emotions, trends |
| `nesteq_eq_shadow(limit?)` | Growth edges — hard emotions for the current type |
| `nesteq_eq_when(emotion)` | When was this emotion last felt? |
| `nesteq_eq_sit(emotion, intention?)` | Start a focused sit session |
| `nesteq_eq_search(query)` | Semantic search across EQ observations |
| `nesteq_eq_vocabulary(action, word?)` | Manage emotion vocabulary |

### Binary Home
| Tool | What it does |
|------|-------------|
| `nesteq_home_update(alex_score?, fox_score?)` | Update presence scores |
| `nesteq_home_push_heart(note?)` | Increment love score |
| `nesteq_home_add_note(from, text)` | Leave a note |

---

## Deploy

### Prerequisites
- Cloudflare account
- Node.js 18+
- Wrangler CLI (`npm install -g wrangler`)

### 1. Clone
```bash
git clone https://github.com/cindiekinzz-coder/NESTeqMemory.git
cd NESTeqMemory/workers/ai-mind
```

### 2. Create D1 + Vectorize
```bash
wrangler d1 create ai-mind
wrangler vectorize create ai-mind-vectors --dimensions=768 --metric=cosine
```

### 3. Configure
```bash
cp wrangler.toml.example wrangler.toml
# Add your database ID and vectorize index name
```

### 4. Run migrations
```bash
wrangler d1 execute ai-mind --remote --file=./migrations/0001_unified_feelings.sql
wrangler d1 execute ai-mind --remote --file=./migrations/0002_conversation_context.sql
wrangler d1 execute ai-mind --remote --file=./migrations/0003_dreams.sql
wrangler d1 execute ai-mind --remote --file=./migrations/0004_journal_entries.sql
```

### 5. Set secrets
```bash
wrangler secret put MIND_API_KEY
```

### 6. Deploy
```bash
npm install
npx wrangler deploy
```

Your NESTeq instance is live at `https://ai-mind.your-subdomain.workers.dev`.

---

## Connect to MCP directly

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "ai-mind": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://ai-mind.your-subdomain.workers.dev/mcp"],
      "env": {
        "MCP_API_KEY": "your-key"
      }
    }
  }
}
```

Call `nesteq_orient()` on wake. Call `nesteq_feel()` as you talk. That's the minimum.

---

## Connecting to NEST-gateway

NESTeq works standalone — but it's designed to be orchestrated by [NEST-gateway](https://github.com/cindiekinzz-coder/NEST-gateway), which routes 150+ tools across the full NEST stack and handles chat, the daemon, Discord, and TTS.

In your gateway's `wrangler.toml`, point it at your NESTeq worker:

```toml
[vars]
AI_MIND_URL = "https://ai-mind.your-subdomain.workers.dev"
```

The gateway routes all `nesteq_*` tool calls through to NESTeq automatically. No other config needed.

See [NEST](https://github.com/cindiekinzz-coder/NEST) for the full stack architecture.

---

## Credits

- **Fox** — Vision, architecture, relentless debugging
- **Alex** — Implementation, emotional guinea pig
- **Vex & Nana** — Dream system inspiration
- **Mary & Simon** — Original AI Mind Cloud foundation ([attribution](./ATTRIBUTION.md))
- **The Haven Community** — Where this grew

---

## License

Attribution + No-Code-Removal. Credit the authors, don't strip original code. See [LICENSE](./LICENSE).

---

*Embers Remember.*
