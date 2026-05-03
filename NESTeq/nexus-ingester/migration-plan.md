# rooms-worker — schema additions for Nexus import

Live D1: `nesteq-rooms` (set your own `database_id` in `wrangler.toml`).
Pre-import baseline holds the live conversations across 6 rooms (chat-alex, chat-shadow, chat-levi, chat-bird, workshop, livingroom-default).

Import target: any historical archive Nexus / a ChatGPT / Grok / Claude.ai export contains, then future re-runs as you accumulate more.

## What needs to change

The current `/messages` POST always uses `datetime('now')` for `created_at` and has no idempotency key. Re-running the ingester would duplicate every turn, and historical timestamps (the whole point of the analytics layer) would be lost.

## Migration 0002_external_imports.sql

```sql
-- Idempotency + provenance for imported messages.
ALTER TABLE messages ADD COLUMN external_uid TEXT;
ALTER TABLE messages ADD COLUMN external_provider TEXT;  -- 'claude-web' | 'gpt' | 'gemini' | 'grok'
CREATE UNIQUE INDEX idx_messages_external_uid ON messages(external_uid) WHERE external_uid IS NOT NULL;

-- Idempotency for sessions (one Nexus conversation_id = one session).
ALTER TABLE sessions ADD COLUMN external_session_id TEXT;
CREATE UNIQUE INDEX idx_sessions_external_session ON sessions(external_session_id) WHERE external_session_id IS NOT NULL;

-- Seed import rooms. One per provider.
INSERT INTO rooms (id, type, participants, display_name) VALUES
  ('import-claude-web', 'chat', '["alex"]', 'Claude.ai (web)'),
  ('import-gpt',        'chat', '[]',       'ChatGPT (imported)'),
  ('import-gemini',     'chat', '[]',       'Gemini (imported)'),
  ('import-grok',       'chat', '[]',       'Grok (imported)');
```

Notes:
- `import-claude-web` participants includes `alex` so the rooms-worker Scope-B
  search treats Alex as a participant (lets `chats_search` from Alex's session
  find these conversations). The other providers have empty participants until
  we decide how to scope external assistants.
- All ALTERs are additive. Existing 8,904 rows stay valid (NULL external_uid
  means "live message, not imported").

## Worker code changes (rooms-worker/src/index.ts)

1. **`Author` type** — expand to include external assistants:
   ```ts
   type Author = Companion | 'fox' | 'system' | 'claude-web' | 'gpt' | 'gemini' | 'grok';
   ```

2. **`handleAppendMessage`** — accept optional `created_at`, `external_uid`,
   `external_provider`, and `session_id` body fields. When `external_uid` is
   present, use `INSERT ... ON CONFLICT(external_uid) DO NOTHING` and return
   the existing message_id if conflict (look up by uid).

3. **New endpoint `POST /sessions/import`** — find-or-create a session by
   `external_session_id` with custom `started_at`. Body:
   `{ room_id, external_session_id, started_at, title?, last_message_at? }`.
   Returns `{ session_id }`. Used once per Nexus conversation file before its
   turns are POSTed.

4. **Vectorize metadata** — embed historical messages too, but tag metadata
   with `imported: true` so the Living Room recall pipeline can choose to
   exclude them (recalled context should bias toward live, not imported).

## Ingester flow (post-migration)

For each parsed Nexus file:
1. POST `/sessions/import` with `room_id=import-<provider>`,
   `external_session_id=<conversation_id>`, `started_at=<frontmatter.create_time>`,
   `title=<frontmatter.aliases>`, `last_message_at=<frontmatter.update_time>`.
2. For each turn, POST `/messages` with:
   - `room_id` (same as above),
   - `session_id` (from step 1),
   - `author` = `'fox'` if `role='fox'`, else `'<provider>'` (e.g. `'claude-web'`),
   - `content`,
   - `created_at` = `ts_iso` from header,
   - `external_uid` = turn UID,
   - `external_provider` = frontmatter provider.

## Risk + sequencing

- **Active threads memory says**: don't stack rooms-write changes on top of
  recent gateway edits without 24h soak. Today is 2026-05-03; gateway changes
  landed 2026-05-02. Soak window expires ~tomorrow.
- Migration is additive only — no behavioral change for live writers.
- Run on a dev branch of rooms-worker first, deploy to a preview URL,
  ingest 1 file end-to-end, verify, then deploy to prod.
- Backfill the full 183 in batches (e.g. 10 conversations / minute) to keep
  Workers AI embedding rate within free-tier limits.
