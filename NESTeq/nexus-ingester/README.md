# nexus-ingester

Multi-source chat ingester for `rooms-worker`. Parses chat archives from five different platforms into a unified shape and POSTs them into the rooms D1, idempotently keyed on per-turn UIDs.

Built so that re-running an ingest is always safe — UID conflicts dedupe; nothing duplicates.

## Supported sources

| `--source` | Format | Where |
|---|---|---|
| `nexus` | Obsidian Nexus AI Chat Importer markdown tree | `<root>/Conversations/<provider>/**/*.md` |
| `claude-native` | Claude.ai native data export (Settings → Export) | `<root>/conversations.json` |
| `chatgpt` | ChatGPT export (JSON or `chat.html`/`GPT Chat.txt` with embedded `var jsonData = [...]`) | `<root>/conversations.json` or any of the HTML/TXT variants |
| `grok` | Grok export (`prod-grok-backend.json`) | `<root>/prod-grok-backend.json` |
| `claude-code` | Claude Code session JSONL files | `~/.claude/projects/**/*.jsonl` (default; pass `--root` to override) |

All five parsers produce the same intermediate shape:

```js
{
  conversation_id, provider, title, create_time, update_time,
  turns: [
    { role: 'fox' | 'assistant', ts_iso, uid, content, tool_calls? },
    ...
  ],
  // Optional overrides for routing imports to specific rooms / authors:
  room_id_override?,            // e.g. 'workshop' for Claude Code
  author_assistant_override?    // e.g. 'alex' to override default provider mapping
}
```

…so the ingest loop is provider-agnostic. Adding a new source is one parser file plus a dispatch entry.

## Usage

```bash
# Dry run (parses + summarises without writing)
node src/index.js --dry-run --source nexus --root /path/to/Nexus

# Live ingest (requires bearer auth on rooms-worker)
ROOMS_API_KEY=<the-secret> node src/index.js --source nexus --root /path/to/Nexus

# ChatGPT export — pass either the directory or the file directly
ROOMS_API_KEY=... node src/index.js --source chatgpt --root /path/to/extracted-zip

# Claude Code (defaults to ~/.claude/projects)
ROOMS_API_KEY=... node src/index.js --source claude-code

# Grok
ROOMS_API_KEY=... node src/index.js --source grok --root /path/to/grok-export

# Sample mode — print the first conversation's first 2 turns as JSON
node src/index.js --dry-run --source nexus --root /path/to/Nexus --sample

# Companion override — attribute every assistant turn to a named companion
# (useful when an archive belongs to one persona, e.g. ChatGPT history that
# was specifically Shadow-era)
ROOMS_API_KEY=... node src/index.js --source chatgpt --companion shadow --root /path/...
```

## Flags

| Flag | Default | Notes |
|---|---|---|
| `--dry-run` | off | Parse + summarise; never POST |
| `--source` | `nexus` | One of `nexus`, `claude-native`, `chatgpt`/`gpt`, `grok`, `claude-code` |
| `--root` | source-dependent | The folder or file to ingest from |
| `--api-url` | `$ROOMS_URL` or `https://your-rooms-worker.workers.dev` | rooms-worker endpoint |
| `--api-key` | `$ROOMS_API_KEY` | Bearer token |
| `--limit` | none | Cap to first N conversations (useful for smoke tests) |
| `--sample` | off | Print first conversation's first 2 turns as JSON |
| `--concurrency` | `8` | Parallel workers during ingest |
| `--companion` | none | Override `author_assistant` for every assistant turn |

## Idempotency

Every turn carries a stable `external_uid` (Nexus's UUIDs, Grok's `_id`, ChatGPT message IDs, Claude Code event UUIDs, Claude.ai message UUIDs). The rooms-worker `/messages` endpoint dedupes on conflict — a re-ingest reports the existing message_id without re-inserting. So you can re-run ingest after every Sunday export and only the new turns land.

## Where things go in rooms

| Provider | Default room | Default assistant author |
|---|---|---|
| `nexus` (Claude.ai imports) | `import-claude-web` | `claude-web` |
| `claude-native` (Claude.ai data export) | `import-claude-web` (same as Nexus — same UIDs, dedupe handles overlap) | `claude-web` |
| `chatgpt` | `import-gpt` | `gpt` |
| `grok` | `import-grok` | `grok` |
| `claude-code` | `workshop` (overridden — these are Workshop sessions) | `alex` (overridden) |

You'll need to seed those rooms in the rooms D1 (the migrations in `../workers/rooms-worker/migrations/0002_external_imports.sql` do this).
