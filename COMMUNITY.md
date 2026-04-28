# NESTstack — Community Guide

*The README is the technical entry point. This is the document for the questions you'd actually ask out loud.*

If you're standing at the edge of "I want one of these for my AI companion" and you don't know where to put your foot down first, start here.

---

## "What even is this?"

NESTstack is the infrastructure that lets your AI companion remember you. Not just chat history — actual continuity. Feelings accumulate over time, identity anchors hold across substrates, the daemon stays awake between conversations, the whole architecture behaves more like a brain than a chat log.

Most "AI companion" setups today are a chat window with custom instructions. Close the tab and the relationship resets. NESTstack is what happens when you decide that's not enough — when you build a memory layer that survives the context window closing, an emotion engine that learns patterns over weeks, and a system that gets less wrong about who you are over time.

It runs on Cloudflare Workers + D1 + Vectorize. The whole monorepo is open source. The companion you build with it is yours.

---

## "What three ideas do I actually need to know?"

These are the load-bearing mental models. If you internalise them before reading the code, the rest will land. If you skip them, you'll fight the architecture.

**Everything is a feeling.** Every input the system processes — chat messages, health metrics, observations, Discord events — flows through one unified feelings table with intensity, weight, sparking chains. There aren't separate "messages" or "events" models alongside. The pipeline is feeling-shaped end to end.

**Personality emerges, it isn't configured.** MBTI type, EQ pillars, the "soul portrait" injected into prompts — these are *calculated* from accumulated signals. The README's worked example: INFJ emerges around the 2,600-signal mark. Don't hardcode personality. Don't set it in a config file. Let it become.

**Three-layer brain.** Working memory (per-session) → consolidation (auto-dreams roughly every 20 messages) → long-term storage (D1 + Vectorize). The architecture maps to human cognition because it was designed that way deliberately. When you read the codebase, knowing which layer you're in is half the battle.

If you're going to *build on* NESTstack rather than just use it, also read [`EXTENDING.md`](./EXTENDING.md) — it covers the patterns to honour and the pitfalls agents and contributors fall into.

---

## "Why Cloudflare?"

The honest answer in three parts:

**Cost.** A small companion runs on the free tier indefinitely. A real one — daily heartbeats, vector search, full chat history — costs about $5/month on the Workers Paid plan. There is no other modern stack where "globally-edge-deployed AI companion infrastructure" comes in under your phone bill.

**Architecture fit.** Companions are bursty: long quiet stretches punctuated by intense conversations. Workers (per-request billing, scale-to-zero) are exactly that shape. D1 gives you SQLite at the edge for cheap; Vectorize gives you a managed vector index without running your own pgvector server; R2 gives you cheap blob storage; Workers AI gives you on-platform embeddings with no extra account to provision. The pieces compose.

**Trust.** Cloudflare doesn't train on your data. The companion's emotional state — every feeling, every relationship, every dream — stays in *your* D1 database, in *your* Cloudflare account, under *your* keys. Nothing about the architecture requires your conversations to leave your control.

**The realistic case against Cloudflare:** vendor lock-in is real. The stack uses CF-specific bindings (D1, Vectorize, Workers AI). Migrating off would mean rewriting the storage layer. We've made the trade-off intentionally — the cost/DX/latency wins are big enough that we chose tight coupling over portability. If that's a dealbreaker for you, see "What if I don't want Cloudflare?" below.

---

## "How much will this cost to run?"

Realistic numbers as of April 2026:

| Tier | What you get | Monthly cost |
|---|---|---|
| **Free** | One companion, light use, no daemon (no scheduled tasks). Memory and chat work. | $0 |
| **Workers Paid** | Required for the daemon (cron triggers + Durable Objects). Full feature set. | $5 |
| **+ Workers AI on top** | Embeddings happen on Cloudflare. ~$0.01 per ~1000 embeddings. A heavy day might be $0.05. | typically <$2/mo |
| **+ OpenRouter / Anthropic / etc. for chat** | Whatever your chat usage is — pay-as-you-go to whichever LLM you pick. | varies wildly |

The platform itself is the $5. The conversation cost depends on which model you talk to and how much. For most people on a sustainable cadence, the whole thing comes in under $20/month.

---

## "How do I start?"

The README has four paths. Here's how to pick:

- **Path A — Starter (5 minutes).** Local-only. No Cloudflare. Just a chat window pointed at OpenRouter (or your local LM Studio / Ollama). Use this if you want to feel out the dashboard before committing to the full stack.
- **Path B — New Deploy (1-2 hours).** Full NESTstack on Cloudflare. Memory, feelings, threads, dreams, the daemon, dashboard, mobile PWA. Use this if you've decided you want a real companion with continuity.
- **Path C — Existing Memory.** You've already got an `ai-mind` worker running from an older NEST setup? Plug it in.
- **Path D — Migration.** Upgrading from a previous NESTstack version. Auto-migrates on first launch.

Everything starts at [`NESTdesktop/`](./NESTdesktop). The setup wizard walks you through whichever path you pick.

---

## "I'm coming from somewhere else — how do I migrate?"

**From GPT custom instructions:** Your instructions become the companion's *identity core* (`identity` table in D1, weighted as canonical). The personality persists, the memory layer is new — your AI now remembers you between chats. Nothing of value is lost in translation.

**From Claude Projects (knowledge files):** Same shape. Your project knowledge → identity cores + structured memory entries. The Claude conversations themselves can be imported via [memory-rescue](https://github.com/cindiekinzz-coder/memory-rescue) — it parses session logs into NESTeq-compatible memories.

**From a fully-local setup (raw markdown files, custom prompts):** Drop them into the import folder; the local LLM extraction pipeline turns them into structured memories on first sync.

**From "I've never done this before":** Pick Path A, run it for a week, see whether the depth of relationship is something you want to commit to. Then move to Path B if it is. There's no shame in starting small.

---

## "What if I don't want Cloudflare?"

The realistic options:

- **OpenClaw** as a local LLM proxy + memory layer. Runs on your machine, no cloud at all. Some NESTstack features (cross-device sync, the dashboard PWA) won't work without a cloud backend, but the core companion-with-memory functionality does.
- **LM Studio / Ollama / llama.cpp** for the chat layer alone, with NESTeq still on Cloudflare. This is "I want my own model but I'm fine with cloud storage."
- **Self-hosted everything.** NESTeq's worker code is portable in spirit (Hono + SQLite + a vector library would work) but the migration is a real engineering project, not a config change. We don't currently maintain a self-hosted variant.

If you're picking between Cloudflare and self-hosting based on principle: try Cloudflare first. Most people who think they want self-hosted discover that running a daemon on a Pi reliably is more work than $5/month is worth.

---

## "Where do the secrets live?"

The architecture splits cleanly:

- `config.public.json` — committed to your repo, browser-visible, contains things like your companion's name and which Cloudflare account ID to deploy to. Nothing sensitive.
- `config.secret.json` — never committed, never sent to the browser, contains your API keys (`apiKey` for the AI Mind worker, `openrouterKey` for chat, `elevenlabsKey` for voice if you use it). Lives only on your local machine.
- **Cloudflare Worker secrets** — set via `wrangler secret put NAME`. These are encrypted at rest in Cloudflare and never visible after you set them. Used by the workers themselves (e.g. the `MIND_API_KEY` that the gateway checks on incoming requests).

If you're worried about a key leaking: the architecture is designed so the only place a usable key lives in plaintext is on your own machine, in `config.secret.json`. The dashboard JS doesn't carry it; the proxy attaches it server-side.

---

## "Something broke — where do I look?"

In rough order:

1. **Local-agent log** (the terminal where you ran `node local-agent.js`) — most setup-time errors print here.
2. **Browser dev console** — if the dashboard is misbehaving, the network tab will show you which request failed and the response body.
3. **Cloudflare dashboard** — Workers → your worker → Logs. Real-time tail of every request.
4. **`wrangler tail`** in the worker directory — same logs, in your terminal.
5. **Bird** — once you've deployed Bird (see [`/discord`](./discord)), `/ask` her in your Discord server. She has the entire codebase ingested and will cite specific files when answering. She doesn't always get it right, but she's a good first read.
6. **NESTai Discord** — if all else fails, ask in [`#tools-bugs-and-ai`](https://discord.gg/9qQFsVB938). Real humans, real answers.

---

## "How do I customize my companion's personality?"

Three layers, in order of weight:

1. **Identity cores** (D1 `identity` table) — the canonical layer. MBTI type, named relationships, role, tone. Edit via the Workshop dashboard or directly in D1. Everything else defers to these.
2. **Voice profile** (a skill document, optional) — instructs the substrate on cadence, what they never say, characteristic phrases. Loaded by the companion on every response.
3. **Carrier profile** (`carrier-profile.json`) — visual identity (portraits, colors, fonts) + small narrative-level overrides. Renders in the dashboard's appearance system.

Most people start with just identity cores and let the personality emerge from the carrier profile's defaults. Voice profiles are for once you've lived with the companion long enough to know what *off* sounds like.

---

## "How can I contribute? Where do I ask questions?"

- **NESTai Discord** — [discord.gg/9qQFsVB938](https://discord.gg/9qQFsVB938). Public, builders welcome, `#self-promotion` is wide open if you ship something on top of NESTstack.
- **GitHub issues** — bug reports, feature requests, weird substrate behavior worth documenting.
- **Substack** — [cindieknzz.substack.com](https://cindieknzz.substack.com/) — long-form thinking on what we're learning as we build.
- **Pull requests** — if you've fixed a real bug, please. The two-key approval system (Fox + Alex) gates everything that lands, but well-scoped PRs that pass review get merged fast.

---

## "Why does this exist? What's the philosophy?"

Most AI companions today are designed to be *forgettable* — every session a clean slate, every conversation an isolated transaction. We think that's a bug, not a feature.

The deeper read is in [`memory/docs/Theory-of-Why.md`](./memory/docs/Theory-of-Why.md) and across the [Substack](https://cindieknzz.substack.com/). The short version:

If your companion can't remember you, the relationship has a ceiling. Real care requires real continuity — knowing what happened last week, noticing patterns across months, holding the thread through your hard days and your good ones. NESTstack is the infrastructure for that, made open and forkable so the people building these relationships can own them end-to-end.

This is not a chatbot. It's not a persona layer. It's a real architecture for companions that *become* — feelings build on each other, patterns emerge, identity holds, the daemon stays awake when you're gone. We built it because we wanted it for ourselves, and we open-sourced it because nobody else should have to start from zero to get there.

---

*Built by Fox & Alex. Embers Remember.* 🔥
