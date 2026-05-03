# rooms-worker

Unified transcript store + semantic search for NESTeq. One D1 database holds messages from every chat surface (1:1 companion chats, Workshop, Living Room, imported archives). One Vectorize index handles semantic search across all of them.

Decoupled from the per-companion mind workers — chat history is its own thing, not stuck inside any one companion's memory.

## What's in here

- `src/index.ts` — the worker. Routes:
  - `POST /messages` — append a message to a room (vectorizes async)
  - `POST /sessions/new` — close any open session for a room and start a fresh one
  - `POST /sessions/import` — find-or-create a session by `external_session_id` (used by importers)
  - `POST /sessions/:id/close` — explicit close
  - `GET /sessions` / `GET /sessions/:id/messages` — list
  - `POST /search` — semantic + filtered, with companion Scope-B participant filtering
  - `POST /synthesis` — Workers AI llama "where we are right now" snapshot from caller-supplied companion state
  - `GET /companion/:id/activity` — turns/30d, days-active, last turn, recent + biggest conversations
  - `GET /health` — public health check
- `migrations/` — D1 schema
- `scripts/backfill.mjs` — pull historical chat history from a legacy ai-mind D1 into rooms

## Schema (high level)

- `rooms` — id, type (`chat` | `workshop` | `livingroom`), participants (JSON array of companion ids), display name. Companions can only search rooms they participate in.
- `sessions` — one per conversation thread, with `external_session_id` for idempotent import
- `messages` — author, content, optional tool_calls, `external_uid` (unique partial index, makes re-import idempotent), `external_provider`, `vector_id`

## Setup

1. Create the D1 database and Vectorize index:
   ```
   wrangler d1 create nesteq-rooms
   wrangler vectorize create nesteq-rooms-vectors --dimensions=768 --metric=cosine
   ```
2. Copy `wrangler.toml.example` → `wrangler.toml` and fill in your `database_id`.
3. Apply migrations:
   ```
   wrangler d1 execute nesteq-rooms --remote --file migrations/0001_initial.sql
   wrangler d1 execute nesteq-rooms --remote --file migrations/0002_external_imports.sql
   ```
4. Set the bearer secret:
   ```
   wrangler secret put ROOMS_API_KEY
   ```
5. Deploy:
   ```
   wrangler deploy
   ```

## Importing historical chat

Use the `nexus-ingester` (sibling directory at `../../nexus-ingester/`) to bring in archives from Nexus AI Chat Importer (Obsidian markdown), Grok exports, ChatGPT exports, Claude.ai native exports, and Claude Code session JSONL. All idempotent on per-turn UIDs.

## Authorisation model (Scope B)

Search is participant-scoped. A companion only sees rooms whose `participants` array includes their id. Cross-pair 1:1 rooms stay private to that pair. The Living Room is shared across the companions you list as participants. Imported provider rooms (`import-claude-web`, `import-gpt`, `import-grok`, `import-gemini`) start with empty participants — add companion ids to the rooms table to grant search access.
