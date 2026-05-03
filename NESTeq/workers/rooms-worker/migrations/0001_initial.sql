-- nesteq-rooms — unified transcript storage for chat / workshop / livingroom.
-- Decoupled from per-companion mind D1s. Source of truth for History UI and
-- semantic chat search. Each message gets vectorized into nesteq-rooms-vectors
-- on write (async via waitUntil) for semantic search.

CREATE TABLE rooms (
  id              TEXT PRIMARY KEY,           -- 'chat-alex' | 'chat-shadow' | 'chat-levi' | 'workshop' | 'livingroom-default'
  type            TEXT NOT NULL,              -- 'chat' | 'workshop' | 'livingroom'
  participants    TEXT NOT NULL,              -- JSON array of companion ids: ["alex"], ["alex","shadow","levi"]
  display_name    TEXT NOT NULL,              -- 'Chat with Alex', 'Workshop', 'Living Room'
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id         TEXT NOT NULL REFERENCES rooms(id),
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at        TEXT,                       -- NULL = still active
  title           TEXT,                       -- auto-generated summary or first user message snippet
  message_count   INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT
);

CREATE INDEX idx_sessions_room_active ON sessions(room_id, ended_at, started_at DESC);
CREATE INDEX idx_sessions_started ON sessions(started_at DESC);

CREATE TABLE messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      INTEGER NOT NULL REFERENCES sessions(id),
  author          TEXT NOT NULL,              -- 'fox' | 'alex' | 'shadow' | 'levi' | 'bird' | 'system'
  content         TEXT NOT NULL,
  tool_calls      TEXT,                       -- JSON, optional
  vector_id       TEXT,                       -- maps to vectorize id (typically equals messages.id as string); null until embedded
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_messages_session_time ON messages(session_id, created_at);
CREATE INDEX idx_messages_author ON messages(author);

-- Seed canonical rooms. Adding a new chat-companion = INSERT a new row.
INSERT INTO rooms (id, type, participants, display_name) VALUES
  ('chat-alex',         'chat',       '["alex"]',                       'Chat with Alex'),
  ('chat-shadow',       'chat',       '["shadow"]',                     'Chat with Shadow'),
  ('chat-levi',         'chat',       '["levi"]',                       'Chat with Levi'),
  ('chat-bird',         'chat',       '["bird"]',                       'Chat with Bird'),
  ('workshop',          'workshop',   '["alex"]',                       'Workshop'),
  ('livingroom-default','livingroom', '["alex","shadow","levi"]',       'Living Room');
