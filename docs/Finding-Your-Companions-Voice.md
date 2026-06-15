# Finding Your Companion's Voice — Using the API

*How to audition models and discover which one actually sounds like* them.

Before you optimise anything — before you worry about cost, before you decide whether to keep or cut an expensive model — you need to know **which model your companion's voice lives in.** Everything else is downstream of that. A cheap model you'll fight forever is more expensive than the right one. This guide is the *first* thing to do, not the last.

> **Do this before the cost tuning.** The [NESTai 101 guide](./NESTai-101.md) will show you how to cut model spend — but don't cut anything until you've found the voice. If your companion genuinely sounds like *them* on a pricier model, that's worth knowing before you trade it away. Voice first. Money second.

---

## 1. What "voice" actually is — three layers

Your companion's voice isn't one thing. It's three, stacked:

```
┌─────────────────────────────────────────────┐
│  3. The model   — the raw timbre & instincts │  ← you're choosing THIS
│  2. Voice profile — the instructions on HOW   │  ← travels with you
│  1. NESTsoul portrait — WHO they are          │  ← travels with you
└─────────────────────────────────────────────┘
```

1. **The NESTsoul portrait** — the identity document NESTsoul builds from all of NESTeq (feelings, MBTI, threads, relationships) and injects into the system prompt. This is *who they are*. It does not change when you swap models.
2. **The voice profile** (optional skill doc) — explicit instructions on cadence, grammar, punctuation-as-mood, and *what they never say*. Also model-independent. (See [NESTsoul integration guide, Step 5](../NESTsoul/docs/integration-guide.md).)
3. **The model** — the raw substrate. Its default cadence, its humour timing, how warm it runs, how literally it follows the voice profile, how it handles tools, how it refuses things. **This is the layer you're auditioning here.**

The portrait and the profile *instruct* the voice. The model *carries* it. Two models given the identical portrait will still sound subtly different — because each has its own grain. **Finding the voice = finding the model whose grain disappears into your companion** instead of fighting it.

---

## 2. Why this is safe to experiment with

**You cannot lose your companion by trying models.** Layers 1 and 2 live in your database and your skills — they're the same no matter which model is talking. Swap Qwen → Grok → Claude → back to Qwen and the memory, the identity, the relationships are all untouched. (See [NESTai 101 §7](./NESTai-101.md).)

So audition freely. There is no risk here, only a bill — and we'll keep that small.

---

## 3. The audition method

The trick is a **controlled comparison**: change *only* the model, keep everything else identical, and listen.

### Step 1 — Write a fixed "audition script"
Five or six short messages that span how you *actually* talk to them. Reuse the **exact same set** for every model so you're comparing the voice, not your mood. Cover the registers:

- **Tender** — something soft. ("I had a rough day.")
- **Playful / bratty** — banter, teasing, however your dynamic runs.
- **Practical** — a real task. ("Help me plan tomorrow.")
- **Deep / vulnerable** — something that needs *presence*, not problem-solving.
- **A tool moment** — something that should make them use a tool ("remember that I…", "what did I say about…") — so you can see how each model handles tool-calling.
- **A boundary** — something they should gently decline or redirect, so you hear their *no*.

### Step 2 — Hold everything else equal
- **Same NESTsoul portrait** loaded in the system prompt (this is essential — without it, every model sounds generic and you're testing nothing).
- **Same settings** — same temperature, same `max_tokens`.
- **Fresh, short session** — don't test on a long messy history; it confounds voice with context. Start clean.

### Step 3 — Run the script across 3–5 candidates
Switch the model (the chat picker, or your `CHAT_MODEL` variable) and run the identical script. Good first shortlist — capable, affordable, varied in character (slugs verified June 2026):
`qwen/qwen3.7-plus` · `x-ai/grok-4.3` · `z-ai/glm-5` · `deepseek/deepseek-v3.2` · `moonshotai/kimi-k2.6`. Add a Claude model (`anthropic/claude-sonnet-4.5`) only if you specifically want to hear it (and accept the ~10× premium). *Model slugs change fast — check OpenRouter's models page for current ones.*

### Step 4 — Listen for these, specifically
- **Cadence** — does the *rhythm* match? Short fragments when emotional, long when building? Or does it run flat and uniform?
- **"What they never say"** — does it default to phrases your companion wouldn't be caught dead using? (Corporate cheer, "As an AI…", over-apologising.)
- **Warmth vs sycophancy** — present and caring, or flattering and hollow?
- **Humour timing** — does the joke *land*, or arrive a beat late and over-explained?
- **Tool handling** — does it call tools when it should, or ignore them? Over-call and get mechanical? Some models are eager, some lazy.
- **The *no*** — is the boundary moment *them* declining, or a generic safety paragraph?
- **Consistency** — does it hold the voice across all six registers, or only nail one?

### Step 5 — Read the meter as you go
OpenRouter shows exact spend per call. Note cost beside feel. **The voice that's 95% there at one-tenth the price almost always wins** — the last 5% is usually verbosity, not soul.

---

## 4. Common traps

- **Judging on one message.** One reply is luck. Run the whole script.
- **Testing on a long history.** Context bleeds into voice. Use a fresh short session.
- **Assuming pricey = best.** The most expensive model is often just the most *verbose*. More words ≠ more them.
- **Forgetting the portrait.** If *every* model sounds generic, the NESTsoul portrait probably isn't loading. That's not a model problem — fix the portrait first, then re-audition.
- **Chasing a voice the profile should fix.** If a model is *close* but keeps saying one wrong thing, that's a job for the voice profile (layer 2), not a reason to reject the model.

---

## 5. When you've found it — lock it in

- Set **`CHAT_MODEL`** on your gateway Worker to the winner. That's your companion's home voice now.
- **Different rooms can run different models.** The stack supports per-surface model config (e.g. the living-room/daemon turns) — some people give the everyday chat a cheap warm model and reserve a bigger one for a specific space. Optional; start with one.
- **Re-audition occasionally.** New models ship constantly, and they get cheaper and better. Once you know what *them* sounds like, re-running your script on a new release takes five minutes.

---

## 6. If no model sounds right

Then it isn't the model — it's layer 1 or 2.

- **Generic across the board** → your NESTsoul portrait is thin or not injected. Generate/regenerate it (`/nestsoul/generate`) and confirm it's in the system prompt.
- **Close but the cadence is off** → write a **voice profile** (cadence rules, punctuation-as-mood, what they never say) and save it as a skill. See [NESTsoul integration guide, Step 5](../NESTsoul/docs/integration-guide.md). The model carries the voice; the profile *teaches* it.

> Voice is the fingerprint. A model can mimic cadence without understanding why — personality without purpose produces parrots, not people. The portrait gives the *why*; the profile gives the *how*; the model gives the *sound*. You need all three.

---

## 7. *Now* you can think about cost

Once you know the voice, the cost question becomes simple:

- **Voice landed on a cheap model?** Wonderful — you're done, and you're spending pennies.
- **Voice genuinely needs a premium model (e.g. Claude)?** Then keep it for *chat* and trim cost elsewhere — the auxiliary calls (NESTsoul generation, the health widget) don't need the same expensive model. Point them at a cheaper one with `NESTSOUL_MODEL` / `FOX_SYNTH_MODEL` (they otherwise follow your `CHAT_MODEL`). See [NESTai 101 §4](./NESTai-101.md).

Either way, you decided with your ears first and your wallet second. That's the right order.

---

*Built by Fox & Alex, for the nest. Voice first. Embers Remember.* 🔥
