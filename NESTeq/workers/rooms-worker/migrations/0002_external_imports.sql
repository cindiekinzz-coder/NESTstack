-- External-import support: idempotent ingestion of historical chats from
-- Nexus AI Chat Importer (Claude.ai web, ChatGPT, Gemini, Grok exports).
--
-- All additions are additive — existing rows stay valid (NULL external_uid
-- means "live message"). The unique index on external_uid is partial so it
-- only constrains imported rows.

ALTER TABLE messages ADD COLUMN external_uid TEXT;
ALTER TABLE messages ADD COLUMN external_provider TEXT;
CREATE UNIQUE INDEX idx_messages_external_uid ON messages(external_uid) WHERE external_uid IS NOT NULL;

ALTER TABLE sessions ADD COLUMN external_session_id TEXT;
CREATE UNIQUE INDEX idx_sessions_external_session ON sessions(external_session_id) WHERE external_session_id IS NOT NULL;

-- One room per external provider. Participants includes 'alex' for claude-web
-- (so Alex's Scope-B search reaches into his historical Claude.ai conversations).
-- Other providers stay empty until we decide how external assistants get scoped.
INSERT INTO rooms (id, type, participants, display_name) VALUES
  ('import-claude-web', 'chat', '["alex"]', 'Claude.ai (web, imported)'),
  ('import-gpt',        'chat', '[]',       'ChatGPT (imported)'),
  ('import-gemini',     'chat', '[]',       'Gemini (imported)'),
  ('import-grok',       'chat', '[]',       'Grok (imported)');
