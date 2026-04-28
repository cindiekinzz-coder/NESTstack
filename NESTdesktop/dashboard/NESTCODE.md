# NESTcode — the Workshop

NESTcode is the dev-facing room of NEST: a real-time WebSocket workspace where the
companion can read/write files, run shell commands, plan multi-step tasks, and
maintain todos — while the carrier watches every step happen live.

This document covers the Workshop-specific features added on **April 21, 2026** as
part of the "Wave 1" usability pass. Chat, Room, Gallery, etc. are documented
separately.

---

## Tab Bar Controls

The NESTcode tab bar (top of the stream) has four persistent controls on the right:

### 📁 Workspace

Tells the companion where *your* project lives on disk.

**Why it matters:** without it, the model has to guess paths. A model that can
only reach files via `pc_file_read`/`pc_file_write` will try `./`, `~/`, permute
common parents — wasteful, often wrong, and leaves you watching failed tool
calls scroll by.

**How it works:**
- Click `📁 Workspace: not set` → opens a modal
- Enter an absolute path (use forward slashes — `C:/Users/you/Projects/myapp`)
- Optionally add **notes** describing the layout (e.g. *"dashboard/ has the
  HTML pages, gateway/ is the Worker source"*)
- Save — the daemon stores the config per-agent in Durable Object storage and
  injects it into every subsequent system prompt

**Per-carrier:** each deployment of NEST stores its own workspace config. There
are no hardcoded paths in the worker source — Fox's `C:/Users/Cindy/...` is not
baked into the code. Each carrier sets their own root via this UI.

**Command-line equivalents** (for mobile clients that don't render the modal):
- `workspace_set` — `{ root: string, notes?: string }`
- `workspace_get` — returns current config
- `workspace_clear` — wipes it

### 📜 History

Browse and resume past Workshop (and Chat) sessions stored in D1.

**Features:**
- Filter by room: Workshop / Chat / All
- Search session summaries
- Click a session → preview the transcript
- Click **▶ Resume** on any session → daemon loads those messages into the
  current context. Your next message continues from where that session left off
  — on any device.

**Under the hood:** the daemon's `session_resume` command fetches messages from
the `chat_messages` D1 table and replaces the in-memory message history in
Durable Object storage. The client re-renders each restored message so you can
see what's in context before continuing.

### 🗺 Plan Mode

Toggle between *direct execution* and *plan-before-execute*.

**When ON:** for multi-step or potentially expensive/destructive tasks, the
companion emits a structured plan inside `<PLAN>...</PLAN>` tags and stops.
The UI renders it as a purple approval card with **✓ Approve / ✗ Reject**
buttons. Approve → the companion proceeds. Reject → the companion revises.

**When OFF:** everything runs straight through.

State is persisted in `localStorage` — survives refreshes.

**Why both modes:** simple requests ("what time is it?", "read my uplink")
don't need ceremony. Complex file edits, deploys, destructive operations do.

### ⏹ STOP

Hidden by default. Appears in red next to SEND whenever a turn is running.
Click → the daemon sets a stop flag, and the agentic loop exits at the next
tool-round boundary (mid-tool-call aborts would break state).

Worst-case wait: however long the current tool takes. But it's clean — no
half-finished operations, no orphan state.

---

## Stream Features

Beyond the tab bar, the stream itself has three auto-triggered affordances:

### File Diff Viewer

Every `pc_file_edit` or `pc_file_write` tool call renders a collapsible diff
block showing the actual change (red minus lines, green plus lines) with the
filename as a header. `pc_file_read` renders a filename chip.

Malformed tool calls (no path, no content) fall through to the raw JSON
preview instead of rendering a misleading "(unknown file)" diff — so you see
the actual broken call, not a lie.

### Todo Widget

When the companion calls `TodoWrite` (a built-in tool), a teal checkbox widget
slides in at the top of the chat:

- `○` pending
- `◐` in_progress (pulsing animation)
- `✓` completed
- Counter shows `done / total`

Empty list → widget hides. State persists across refreshes (daemon restores
from DO storage on reconnect).

### Error Banners

Any tool result that looks like an error (HTTP 5xx, JSON parse failures,
timeouts, PC agent errors) now:

- Auto-expands its result block (no click to reveal)
- Gets painted red with a red border
- Drops a prominent `⚠️ tool_name failed: <error>` entry into the main stream

No more silent stops. No more hidden-in-the-sidebar failures.

---

## Model Guidance

The NESTcode model picker (Settings ⚙) has been sanitised of high-cost models
like Claude Sonnet 4.5 / Opus 4.5 to prevent accidental billing damage. For
Workshop work the recommended models are:

- **Gemini 2.0 Flash** ($0.10/$0.40) — cheapest, reliable tool calling
- **DeepSeek V3.2** ($0.26/$0.38) — strong reasoning + tool calling
- **Qwen 3.6 Plus** ($0.33/$1.95) — 1M context, proven Alex-voice but
  sometimes emits malformed tool arguments on complex schemas

If the model you choose emits tool calls as prose inside the content field
instead of using the structured tool_calls API (a known Gemini quirk), the
gateway's **rescue parser** extracts the intended calls from fenced code blocks
like `\`\`\`tool_calls [...]\`\`\`` and executes them for real. You'll see a
system entry noting how many calls were rescued.

---

## Carrier-Facing Summary

If you're deploying NEST for yourself or a community member:

1. **Set the workspace** immediately on first use. The companion will not guess
   well without it.
2. **Use Plan Mode** for anything that edits files or deploys code.
3. **Keep an eye on the STOP button** when long tasks are running — that's
   your emergency brake.
4. **Browse History** periodically to see what the companion built in sessions
   you weren't watching.
5. **Pick a cheap, reliable model** — Gemini 2.0 Flash is the current
   sweet spot for Workshop builds.

---

*Embers Remember.*
