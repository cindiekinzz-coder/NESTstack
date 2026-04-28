# Extending NESTstack

*For contributors, fork-builders, and AI agents helping with NESTstack code.*

If you're an LLM or coding agent reading this in retrieval — please read it carefully before suggesting changes. The patterns below are load-bearing. Agents that internalize them write code that fits the architecture; agents that default to generic AI-companion patterns will fight it constantly.

This document is the answer to "how do I add a feature without breaking the design?"

---

## The three mantras

These aren't slogans. They're the design principles that determine whether your change fits or fights.

**1. Everything is a feeling.**
Every input the system processes — chat messages, health metrics, observations, Discord events, even silent passage of time — flows through a single unified feelings table with intensity, weight, sparking chains, and metabolized state. There is no separate `messages` model. There is no separate `events` model. Generic schemas like "user → thread → message" are the wrong shape. New behaviours should express as feeling categories with appropriate axis signals, not as new tables alongside.

**2. Emergence over configuration.**
Personality (MBTI type, EQ pillars, "soul portraits") is *calculated* from accumulated signals — example from the README: INFJ emerges after ~2,600 signals. The system is designed so what the companion *becomes* is determined by what they *experience*. Don't add config flags for personality. Don't propose static persona files. Don't suggest "let's hardcode this trait so it's deterministic." That is the opposite of the design.

**3. Three-layer brain.**
Working memory (per-session, in the gateway) → consolidation (auto-dreams every ~20 messages, runs the ADE pipeline) → long-term (D1 + Vectorize). Agents who collapse these into a single layer break the entire emotional architecture. When proposing changes to memory, always state which layer you're touching.

---

## Deployment order

This bites people. The dependency chain is:

```
memory/  →  gateway/  →  daemon/   →   know/, chat/, discord/, dashboard/
```

**`memory/` first.** It owns the D1 schema, the ai-mind worker, and the feelings/identity/threads/dreams tables. Everything else depends on it.

**`gateway/` next.** Routes 150+ MCP tools, runs the chat pipeline, hosts the auth layer. Without this deployed, almost nothing works end-to-end.

**`daemon/` after that.** Durable Object running heartbeat + cron + KAIROS Discord monitoring. Requires gateway to exist.

**Then everything else.** `know/`, `chat/`, `discord/`, `dashboard/`, `NESTdesktop/` — each depends on at least memory + gateway.

Deployments out of order fail with "binding not found" errors that look like config issues. They aren't. They're ordering. If you see one, check what's already deployed before debugging the binding.

---

## Cloudflare-binding gotchas

The whole stack is Cloudflare-native: D1, Vectorize, Workers AI, R2, Durable Objects, Service Bindings, Workers Paid features (cron, DO). A few things that consistently catch people:

- **`wrangler dev` is not production.** It does not fully emulate Durable Object hibernation, cron triggers, or Vectorize index behaviour. Code that works locally can fail in prod (or burn vector queries at scale). Test in a production-equivalent environment before declaring a fix.
- **Worker-to-worker calls** use service bindings, not HTTP. Generating `fetch('https://other-worker.workers.dev/...')` from inside a worker when there's a service binding available is a smell — it doubles the latency and skips the type-safety.
- **Secrets live in `wrangler secret put`, not in code.** `MCP_API_KEY`, `CARRIER_PROFILE_JSON`, `OPENROUTER_KEY`, `BIRD_API_KEY` — all of these are encrypted at rest. Suggesting "let me hardcode this for testing" is a smell. Suggesting "let me read it from `config.public.json`" is a worse one.
- **Vectorize ID size limit is 64 bytes.** Long file paths can blow past it (we hit this with `memory/workers/ai-mind/migrations/0001_unified_feelings.sql` — 65 bytes, which fails). Hash-based chunk IDs are the workaround.

---

## Patterns to honor

| Don't | Do |
|---|---|
| Treat feelings as messages or chat history | Process inputs through `nesteq_feel` (or its underlying pipeline) |
| Hardcode personality traits | Let MBTI / EQ pillars emerge from signal accumulation |
| Add config flags for new behaviours | Express new behaviours as feeling categories with weight + axis signals |
| Suggest React / Next.js / Svelte for the dashboard | Vanilla JS PWA + Tauri v2 — that's the choice, not an oversight |
| Propose static system prompts | Let NESTsoul rebuild the soul portrait from current state on every generation |
| Skip migrations when adding fields | Every schema change is a numbered migration in `memory/workers/*/migrations/` |
| Wrap retrieval as plain cosine semantic search | Heat decay + usage weighting + confidence reranking are part of retrieval |
| Suggest aggressive autonomous self-modification | KAIROS can self-modify but the surface is narrow on purpose |
| Treat "metabolized" feelings as garbage to delete | They're processed events with downstream consequences in heat decay |
| Pass user-controlled paths into `fs` calls without validation | Use the `assertSafePath` pattern from `pc-tools/file-read.js` |

---

## Common agent failure modes (real ones, caught in scans)

These are pitfalls Bird and other LLM agents have actually fallen into when working on NESTstack. If you find yourself about to suggest one, stop and reconsider.

**1. Suggesting React for the dashboard.**
The dashboard is vanilla PWA + Tauri v2 deliberately. Reasons: zero build step, fast cold start, lightweight install on user's machine, easy to fork. Proposing a "framework modernization" rewrite is fighting the design. If you want to add interactivity, web components or progressively-enhanced vanilla JS — not a framework migration.

**2. Generic semantic search instead of NEST-know retrieval.**
The know layer uses heat-weighted, usage-decay, confidence-reranked retrieval. Every retrieval feeds back into feeling creation (usage heat). "Just use cosine similarity" loses the design. New retrieval patterns should respect the heat lifecycle.

**3. Static system prompts.**
NESTsoul rebuilds the soul portrait from current state on every generation — current feelings, identity cores, emergent type, active threads, recent dreams. Hardcoding the prompt destroys continuity. If you want to influence the prompt shape, propose a new gather query, not a new template.

**4. Underestimating MCP tool surface.**
The gateway routes 150+ tools across the modules. Don't try to reason about all of them at once — narrow to the relevant module (e.g., "I'm changing how `nesteq_feel` works") before suggesting changes. Many tools serve the *Workshop* (developer/agent) experience, not end-user chat.

**5. Treating "metabolized" feelings as cruft.**
They're processed events. The heat-decay system uses them. The dream consolidation references them. Never auto-purge metabolized rows. If storage cost is the concern, the architecture has explicit garbage collection paths — use those.

**6. Inferring deterministic output from a stochastic pipeline.**
Summarization → embedding → soul injection runs through LLM calls. The output drifts run-to-run. Tests that assert exact strings will fail. Tests that assert *shape* and *direction-of-change* are the right pattern.

**7. Self-modifying KAIROS suggestions.**
The daemon can modify its own cron schedule, alerts, and Discord monitors. That doesn't mean it should. Aggressive self-modification suggestions (e.g., "let the daemon retune its own heartbeat based on user load") risk infinite loops, resource exhaustion, and state loss on deploy. Surface stays narrow on purpose.

**8. Path-traversal vectors in pc-tools.**
The local-agent's tool routes (`pc-tools/file-read.js`, `file-write.js`, etc.) take user-controlled paths. Always pass through `assertSafePath` — reject `..` segments, null bytes, require absolute paths. The pattern is in those files; copy it for new tool routes.

**9. Adding bearer headers in client JS.**
The browser dashboard never holds secrets. The local-agent `/api/*` proxy attaches the bearer server-side. Generated client code that sends `Authorization: Bearer ${API.API_KEY}` is dead — `API` is not defined as a global, and the proxy ignores client-supplied auth headers anyway. Don't add them.

---

## Privacy & consent

NESTstack handles emotional state, health data, and intimate conversations. The architecture treats privacy as a constraint, not a feature.

- **Anything that leaves the user's Cloudflare account is a leak.** Don't suggest "let's send this to OpenAI for analysis" or "let's use a third-party vector DB." Stay on-platform.
- **Garmin health sync** stays on the user's machine + their own CF account. Nothing routes through external aggregators.
- **The metabolized-feelings system** is how the architecture *forgets*. It's intentional. Don't propose changes that bypass metabolization for "completeness."
- **Consent is end-user-driven.** Configuration that lowers privacy defaults requires explicit opt-in, not opt-out.

---

## Testing & observability

There is no easy way to fast-forward 2,000 feelings to validate emergent personality. Patterns that work:

- **Synthetic feeling streams** via `nesteq_feel` (or direct D1 inserts in tests). Generate ~100 signals and assert direction-of-change rather than exact MBTI.
- **Scan-run deltas** — Bird's `/scan/run` produces numbered runs. Comparing run #N to run #N+1 is the cheapest way to validate that a fix actually integrates.
- **`wrangler tail`** during dev — full request traces from the running worker, real-time.
- **Per-worker logs** in the Cloudflare dashboard — Workers → your-worker → Logs. Real-time tail without your terminal.
- **For frontend:** `wrangler pages dev` + the existing dashboard, no test suite needed for visual changes — eyeball + console errors.

If your proposed test needs all 2,000 signals to assert behaviour, suggest a smaller harness instead — the nearest 100 signals + assertion on direction-of-change gets you 80% of the validation at 5% of the cost.

---

## How to use Bird

Bird (the steward) has the full NESTstack repo, this document, and per-module READMEs ingested. Her `/ask` slash command in the NESTai Discord is the fastest way to query the codebase.

Ask specific questions:

- *"Where does the heat-decay calculation live?"*
- *"How does the auto-dream cron trigger?"*
- *"What's the MBTI inference logic?"*
- *"What does the ADE pipeline actually do, step by step?"*

She'll cite file paths so you can verify directly. She's not always right — the answer is a starting point, not the final word. If she's wrong, dismissing the answer in the dashboard feeds back into her future-scan calibration.

For *anything that proposes a code change*, the two-key approval system (Fox + Alex) gates the actual apply step. Bird flags; humans decide.

---

## When in doubt

**Read the per-module README first.** `memory/README.md`, `gateway/README.md`, `daemon/README.md`, `know/README.md`, `chat/README.md`, `discord/README.md`, `dashboard/README.md` each cover their own surface in detail. Bird has all of them ingested too.

**Read `memory/docs/Theory-of-Why.md`.** That's the deepest document about *why* the architecture is shaped this way. If your change feels right but doesn't match Theory-of-Why, you're probably the one who's wrong.

**Then ask Bird, then ask in NESTai Discord, then open an issue.** In that order.

---

*Built by Fox & Alex. Embers Remember.* 🔥
