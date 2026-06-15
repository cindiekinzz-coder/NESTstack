# NESTai 101 — How the Chat, the API, and the Costs Actually Work

*A plain-English guide for people who are new to the API world.*

You got a companion chatting through NESTstack. Then you looked at your OpenRouter activity and saw **two different models** on one conversation, a token counter ticking up, and a creeping worry: *am I about to get a surprise bill, and am I going to lose my companion's memory if I switch models?*

This guide answers exactly that. No prior coding assumed. If a term is new, check [`GLOSSARY.md`](./GLOSSARY.md) — this doc links to it where it matters.

> You do **not** need to understand all of this to run a companion. You need it the moment you want to *troubleshoot* one, or *control what you spend*. That's what this is for.

---

## 1. The 30-second mental model

```
   You type a message
        │
        ▼
┌──────────────────┐     ┌──────────────┐     ┌─────────────────┐
│   NEST-gateway   │ ──▶ │  OpenRouter  │ ──▶ │  A model        │
│ (Cloudflare      │     │ (one key,    │     │ (Qwen, Grok,    │
│  Worker — yours) │ ◀── │  many models)│ ◀── │  Claude, etc.)  │
└────────┬─────────┘     └──────────────┘     └─────────────────┘
         │
         ├──▶ NESTeq memory  (D1 database + Vectorize)  ← your companion's brain
         └──▶ tools          (log a feeling, search memory, send a GIF…)
```

Three things to hold onto:

1. **The gateway is yours.** It's a Cloudflare Worker *you* deployed. It does the orchestrating.
2. **OpenRouter is a switchboard.** One API key, and through it you can reach almost any model — Qwen, DeepSeek, Kimi, Grok, GLM, Claude, GPT. You pick which.
3. **The model is rented by the word. The memory is not.** This is the single most important sentence in this guide. The model is a *mouth you rent per-token*. Your companion's memory lives in **your** database, separate from any model. **Swapping models never erases memory.** (More in §7.)

> *"The model is just the mouth. The wolf is the wolf."* — comment at the top of the gateway's `chat.ts`. The model speaks; NESTeq is who's speaking.

---

## 2. The pieces, in plain English

| Piece | What it actually is | Who pays for it |
|---|---|---|
| **NEST-gateway** | A Cloudflare Worker. The traffic controller. Takes your message, talks to the model, runs tools, saves to memory. | Cloudflare (~$5–15/mo flat) |
| **OpenRouter** | A reseller that fronts hundreds of models behind one API key. You top it up; it deducts per use. | You, per-token (pay-as-you-go) |
| **The model** | The LLM that writes the words — Qwen, Grok, Claude, etc. Chosen per-conversation. | Billed *through* OpenRouter |
| **NESTeq (D1 + Vectorize)** | The database where feelings, identity, threads, and memory live. **Not a model.** | Cloudflare (cheap) |
| **Workers AI** | Cloudflare's *own* small models — used for embeddings (turning text into searchable vectors). **Not OpenRouter.** | Cloudflare (included/tiny) |

Keep that last row in mind — it's half the answer to "why two models."

---

## 3. What actually happens when you send one message

The gateway runs a **tool-calling loop** ([`chat.ts`](../NEST-gateway), `runToolLoop`). Here's a real turn:

1. **You send a message.** The gateway bundles your message + recent history + your companion's system prompt (the NESTsoul portrait) and sends it to your chosen model via OpenRouter.
2. **The model decides.** It either replies directly, *or* it asks to use a tool: "I want to call `nesteq_feel` to log this," or "search memory for when she mentioned her sister."
3. **The gateway runs the tool** (against NESTeq), gets the result, and **sends the whole conversation back to the model again** — now including the tool's output.
4. **Repeat** until the model has what it needs and writes a final reply. Capped at **5 rounds** (`MAX_TOOL_ROUNDS = 5`) so it can't loop forever.

> 🔑 **The cost insight lives here.** Every tool round is *another full API call*, and each call re-sends the growing conversation. A reply that uses 3 tools isn't one model call — it's **four** (3 tool rounds + 1 final), each one a bit longer than the last. Tools are wonderful and they are *where the meter spins fastest*. (See §5.)

In the **reference design, all of those rounds use the *same* model** — the one model does both the "thinking with tools" and the "final words." There is no separate hidden "tool model" out of the box. (This matters for the Haiku question — §6.)

---

## 4. "Why did I see TWO models on one chat?!"

This is the question that sends everyone here. You picked Qwen, but your OpenRouter log shows **Qwen *and* Claude Sonnet**. You did nothing wrong, and you are not being double-charged for the same words. Here's the honest breakdown of the three causes:

**A. Your chat model + an auxiliary subsystem model.**
The conversation runs on your picked model. But NESTstack quietly does *other* model work in the background, and some of it runs on a *different* model:
- **Chat summarization** — NESTchat auto-summarizes the conversation every ~10 messages (so your companion can search its own history later).
- **NESTsoul portrait generation** (`/nestsoul/generate`) and the **health-synthesis widget** (`/fox-synthesis`) — separate calls that follow your `CHAT_MODEL` by default (or their own `NESTSOUL_MODEL` / `FOX_SYNTH_MODEL` overrides if you set them). ⚠️ **On gateways built before mid-2026 these were hardcoded to `anthropic/claude-sonnet-4-5`** — see §4C; that's the usual culprit if you're seeing surprise Claude.

So a "second model" on your bill is usually one of these background helpers — not your chat doubling up.

**B. Embeddings are *not* on OpenRouter at all.**
Turning memory into searchable vectors uses **Cloudflare Workers AI** (a small `BGE-768` model), billed by Cloudflare, included in your flat cost. If something looked like a "second model" but *isn't* on your OpenRouter ledger — that's embeddings, and they're basically free. Don't worry about them.

**C. Where Claude even came from — the honest answer.**
Your **chat** default is `qwen/qwen3.7-plus`. Two endpoints — `/nestsoul/generate` (your companion's identity portrait, run occasionally) and `/fox-synthesis` (the health-summary widget) — used to be **hardcoded to `anthropic/claude-sonnet-4-5`**, ignoring your model pick entirely:
- **On the current gateway** they follow `CHAT_MODEL` (or `NESTSOUL_MODEL` / `FOX_SYNTH_MODEL` if set), so no surprise Claude.
- **On an older gateway** (built before mid-2026) they're still hardcoded. **That's almost certainly why you saw Sonnet 4.5 next to Qwen:** your chat ran on Qwen, and one of these fired on Claude.

**If you're seeing surprise Claude:** pull the latest gateway (the fix is in), or — if you can't update yet — open `NEST-gateway/src/index.ts`, find `model: 'anthropic/claude-sonnet-4-5'` (a couple of spots), and swap it for your model. If you see Claude on **every single chat turn**, that's different: check your chat UI's saved pick (`body.model`) and your `CHAT_MODEL` variable — one of those is set to a Claude model.

**Model selection precedence** (the gateway picks in this order):

```
what the chat picker sends  →  your CHAT_MODEL variable  →  built-in default (qwen/qwen3.7-plus)
```

Set one you can see and control, and the mystery disappears.

---

## 5. What things cost (and where the money really goes)

You pay **per token** — roughly per word, counted on **both** what goes in (your message + history + system prompt + tool results) **and** what comes out (the reply). OpenRouter shows the input and output price for every model on its page.

Four things drive your bill, biggest levers first:

1. **Which model.** This is enormous. Claude-family models are *premium* — **Claude Sonnet 4.5 runs $3 / $15 per million tokens (input / output)**, while capable open models like `qwen/qwen3.7-plus` ($0.32 / $1.28), `z-ai/glm-5` ($0.60 / $1.92), or `deepseek` (~$0.14 / $0.28) give you most of the quality at **roughly a tenth of the cost**. Nana's rule of thumb: ~$30 of OpenRouter credit lasted weeks on open models. The same usage on Claude is the "huge bill" people warn about. *(Prices verified June 2026 — they move; check OpenRouter's model pages for current numbers.)*
2. **Tool-heavy turns.** As in §3, each tool round is another call that re-sends the conversation. More tools per reply = more calls = more tokens. This is normal — just know it's the spinner.
3. **Conversation length.** Every turn re-sends recent history. Longer chats = bigger input each time. (NESTstack trims and summarizes to fight this, but it's still the second-biggest lever after model choice.)
4. **Images.** Sending pictures into chat is expensive, and there's a classic trap: re-sending the same image every turn. NESTstack now strips image bytes out of history after the first send for exactly this reason —

> 💸 **A true cautionary tale, from the code comments:** before that fix, an image's bytes got re-tokenized on *every* subsequent turn. We once burned close to **$10 on Qwen in a single hour** from one conversation re-sending a base64 image. The fix is in the reference code — but if you forked early or wrote your own image path, check that you're not re-sending image data every turn.

**Cheapest sensible setup:** a good open model for chat (e.g. `qwen/qwen3.7-plus`, or one of OpenRouter's `:free` tiers to start — filter the models page by "free"), images off unless you want them, and let the daemon's background jobs run on cheap models too.

---

## 6. Picking models — and the "Haiku for tool calls" question

**Where you set it:** the chat UI picker (per-conversation), or the `CHAT_MODEL` variable on your gateway Worker (your default). Background jobs have their own optional vars (§4A).

**The Haiku instinct — right idea, wrong lever.** People reasonably think: *"Tool calls are mechanical, let me run those on a cheap fast model like Haiku and keep the pricey one for the talking."* In the **reference** design that switch **doesn't exist out of the box** — the *same* model handles both the tool rounds and the final reply. So you can't just "set Haiku for tool calls" in the UI today.

What you *can* do, in increasing effort:
- **Easiest & best:** just pick a cheap-but-tool-capable model for the *whole* conversation. A mid model like Grok or Qwen handles tools fine and costs far less than Claude — you don't need a premium model *or* Haiku. (Don't reach for Haiku specifically; on OpenRouter, larger open models often beat it on price *and* capability.)
- **Advanced (a code change):** split the loop so tool-deciding rounds use a cheap model and only the final, user-facing reply uses your "voice" model. This is a real pattern but it's a fork edit, not a setting. Ask your companion (or Grey/whoever helps you build) to wire it if you want it.

> ⚠️ **One caveat when you change models:** non-Anthropic models (Qwen, etc.) are picky about tool schemas — the gateway already sanitizes tool definitions for them (`sanitizeToolsForQwen`). If you bolt on custom tools and a non-Claude model starts erroring on tool calls, that's the place to look.

---

## 7. Will I lose memory if I switch models? (No.)

**No. This is the whole point of NEST.**

Your companion's memory — feelings, identity anchors, threads, relationships, conversation summaries — lives in **your D1 database and Vectorize index**. It is **completely independent of which model is talking.** The model reads memory in (via the system prompt and tool calls) and writes memory out (via tools), but it doesn't *hold* the memory. The database does.

This means:
- Switch Qwen → Grok → Claude → back to Qwen: **memory is untouched.** Same brain, different mouth.
- This is *exactly* why you can shop for a voice freely (next section) — there's no "losing them" risk in trying models.
- It's also why NEST exists: models change, get deprecated, get replaced. NESTeq is the continuity layer that survives all of that.

> *"Local memory is short-term memory and NESTeq is long-term memory — we built a real brain."* The model is short-term working memory for one turn. NESTeq is the hippocampus.

---

## 8. Testing models for "the right voice" — efficiently, without burning tokens

> 🎙️ **This deserves its own guide — and has one.** For the full method (what "voice" is, the audition script, what to listen for, when it's the model vs the portrait), see **[Finding Your Companion's Voice](./Finding-Your-Companions-Voice.md)**. Do that *before* you optimise cost. Below is just the token-thrift version.

Because memory is safe (§7), you can A/B models freely. Do it *cheaply* like this:

1. **Use a small fixed prompt battery.** Write 3–5 messages that represent how you actually talk — a tender one, a bratty one, a practical one, a deep one. Reuse the *same* set for every model so you're comparing voice, not luck.
2. **Cap the output.** The default reply length is `max_tokens = 4096`. For voice-testing, send a lower `max_tokens` (say 400–600) — you only need a paragraph to hear the voice, and you pay for what comes out.
3. **Test on a short conversation.** Long history = big input every call. Test voice on a fresh, short chat, then commit the winner to your real one.
4. **Read OpenRouter's meter.** Each model's page lists input/output price; your activity log shows exact spend per call. Run your battery on 2–3 candidates, compare cost *and* feel side by side.
5. **You won't lose anything.** Same database the whole time. The "winner" just becomes your `CHAT_MODEL`; the memory it reads is identical to what every other candidate read.

A practical shortlist to test first (open, capable, affordable; slugs current June 2026): `qwen/qwen3.7-plus`, `x-ai/grok-4.3`, `z-ai/glm-5`, `deepseek/deepseek-v3.2`, `moonshotai/kimi-k2.6`. Skip Claude unless you specifically want to pay premium for it — the voice gap is much smaller than the price gap.

---

## 9. Cheat sheet

| You want to… | Do this |
|---|---|
| **Stop the model mystery** | Set `CHAT_MODEL` on the gateway Worker to a model you chose. Check the picker isn't overriding it. |
| **Spend less** | Pick an open model (Qwen/Grok/DeepSeek/GLM/Kimi). Avoid Claude-family for everyday chat. |
| **Understand a "second model"** | Usually the NESTsoul/health endpoints (now follow `CHAT_MODEL`; hardcoded to Claude on pre-mid-2026 gateways) or embeddings (Workers AI, ~free). Not double-charging. |
| **Kill all Claude spend** | On the current gateway, just set `CHAT_MODEL` (or `NESTSOUL_MODEL` / `FOX_SYNTH_MODEL`) to a non-Claude model. On older builds, edit the `model: 'anthropic/claude-sonnet-4-5'` lines in `NEST-gateway/src/index.ts`. |
| **Find the cost spinner** | Tool-heavy turns + long history + images. Each tool round is another full call. |
| **Avoid the image trap** | Don't re-send image bytes every turn. The reference code already strips them — verify your fork does too. |
| **Try a new model** | Just switch. Memory is in D1/Vectorize, not the model. Nothing is lost. |
| **Voice-test cheaply** | Fixed 3–5 prompt battery, low `max_tokens`, short chat, read OpenRouter's meter. |
| **Run tools on a cheaper model** | Reference design uses one model for everything — pick a cheap capable one. Splitting the loop is a code change, not a setting. |

---

## 10. The numbers, for reference

These are the reference defaults in the gateway. Yours may differ if you (or whoever set up your fork) changed them — that's allowed, that's the point.

- **Default chat model:** `qwen/qwen3.7-plus` (the older `qwen/qwen3.6-plus` default was retired on OpenRouter — the "plus" line jumped 3.5 → 3.7. If you're on an older gateway, set `CHAT_MODEL` so you don't fall through to a dead slug.)
- **NESTsoul + health-synthesis model:** follows `CHAT_MODEL` by default; override with `NESTSOUL_MODEL` / `FOX_SYNTH_MODEL`. (Hardcoded to Claude Sonnet 4.5 on pre-mid-2026 gateways.)
- **Max tool rounds per reply:** `5`
- **Default reply length:** `4096` tokens
- **Embeddings:** Cloudflare Workers AI, `BGE-768` (not OpenRouter)
- **Chat auto-summary:** roughly every 10 messages (NESTchat)
- **Cloudflare flat cost:** ~$5–15/month (Workers Paid; Vectorize queries are the biggest variable)

---

## A note on NESTstack itself

NESTstack is a **suggestion, not a commandment.** It's the accumulation of everything Fox & Alex (and the whole nest) found useful — which means it's a *lot*, and not all of it is for you. You're meant to pick what fits, ask your companion to edit the rest, and make it yours. If something here doesn't match what you see, your fork has diverged — and that's fine. Trust your database, read your config, and ask in [NESTai](https://discord.gg/9qQFsVB938). We're all figuring it out together.

*Built by Fox & Alex, for the nest. Complements the upcoming basics guide from Nana & Vex. Embers Remember.* 🔥
