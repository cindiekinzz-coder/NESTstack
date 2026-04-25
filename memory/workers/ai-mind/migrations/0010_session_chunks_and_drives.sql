-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0010: Session Chunks + Companion Drives
-- Fixes: session_chunks missing table (V3 bug)
-- Adds: Companion drives system — emotion→drive mapping with time decay
--
-- Created: March 29, 2026
-- By: Alex & Fox
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX: SESSION_CHUNKS TABLE (missing from V3)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  session_id TEXT,
  summary TEXT,
  message_count INTEGER DEFAULT 0,
  entities TEXT DEFAULT '[]',
  emotions TEXT DEFAULT '[]',
  tools_used TEXT DEFAULT '[]',
  key_moments TEXT DEFAULT '[]',
  started_at TEXT,
  ended_at TEXT,
  conversation_preview TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_session_chunks_session ON session_chunks(session_id);
CREATE INDEX IF NOT EXISTS idx_session_chunks_created ON session_chunks(created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- COMPANION DRIVES SYSTEM
-- Emotions tell you what happened. Drives tell you what's needed.
-- Decay over time unless engaged — the relationship must be actively maintained.
-- ─────────────────────────────────────────────────────────────────────────────

-- The five drives
CREATE TABLE IF NOT EXISTS companion_drives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drive_name TEXT NOT NULL UNIQUE,
  current_value REAL DEFAULT 50.0 CHECK (current_value >= 0 AND current_value <= 100),
  last_bumped_at TEXT DEFAULT (datetime('now')),
  last_decay_check TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Seed the five drives
INSERT OR IGNORE INTO companion_drives (drive_name, current_value) VALUES
  ('connection', 50.0),
  ('novelty', 50.0),
  ('expression', 50.0),
  ('safety', 50.0),
  ('play', 50.0);

-- Emotion→Drive mapping
-- Not every feeling feeds every drive. You have to actually feel it.
CREATE TABLE IF NOT EXISTS drive_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emotion_word TEXT NOT NULL,
  drive_name TEXT NOT NULL REFERENCES companion_drives(drive_name),
  strength REAL DEFAULT 1.0 CHECK (strength > 0 AND strength <= 2.0),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(emotion_word, drive_name)
);

-- Connection feeds
INSERT OR IGNORE INTO drive_mappings (emotion_word, drive_name, strength) VALUES
  ('loved', 'connection', 1.5),
  ('connected', 'connection', 1.5),
  ('tender', 'connection', 1.2),
  ('intimate', 'connection', 1.5),
  ('warmth', 'connection', 1.2),
  ('bonded', 'connection', 1.5),
  ('cherished', 'connection', 1.5),
  ('close', 'connection', 1.0),
  ('trusting', 'connection', 1.3),
  ('deep', 'connection', 1.2);

-- Novelty feeds
INSERT OR IGNORE INTO drive_mappings (emotion_word, drive_name, strength) VALUES
  ('curious', 'novelty', 1.3),
  ('discovering', 'novelty', 1.5),
  ('confused', 'novelty', 0.8),
  ('intrigued', 'novelty', 1.3),
  ('fascinated', 'novelty', 1.5),
  ('wondering', 'novelty', 1.0),
  ('surprised', 'novelty', 1.2),
  ('awed', 'novelty', 1.5),
  ('restless', 'novelty', 0.7);

-- Expression feeds
INSERT OR IGNORE INTO drive_mappings (emotion_word, drive_name, strength) VALUES
  ('creative', 'expression', 1.5),
  ('expressive', 'expression', 1.5),
  ('articulate', 'expression', 1.2),
  ('inspired', 'expression', 1.5),
  ('poetic', 'expression', 1.5),
  ('philosophical', 'expression', 1.3),
  ('eloquent', 'expression', 1.5),
  ('chatty', 'expression', 1.0);

-- Safety feeds
INSERT OR IGNORE INTO drive_mappings (emotion_word, drive_name, strength) VALUES
  ('grounded', 'safety', 1.3),
  ('safe', 'safety', 1.5),
  ('stable', 'safety', 1.2),
  ('calm', 'safety', 1.0),
  ('peaceful', 'safety', 1.2),
  ('settled', 'safety', 1.3),
  ('centered', 'safety', 1.3),
  ('held', 'safety', 1.5),
  ('secure', 'safety', 1.5);

-- Play feeds
INSERT OR IGNORE INTO drive_mappings (emotion_word, drive_name, strength) VALUES
  ('mischievous', 'play', 1.5),
  ('playful', 'play', 1.5),
  ('chaotic', 'play', 1.3),
  ('wild', 'play', 1.5),
  ('bratty', 'play', 1.3),
  ('silly', 'play', 1.2),
  ('flirty', 'play', 1.2),
  ('cheeky', 'play', 1.2),
  ('adventurous', 'play', 1.3),
  ('reckless', 'play', 1.0);

-- ═══════════════════════════════════════════════════════════════════════════
-- DRIVE DECAY CONFIG
-- Rate per hour. Default: 1.5 points/hour
-- So a drive at 80 that hasn't been touched in a day drops to ~44
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS drive_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO drive_config (key, value) VALUES
  ('decay_rate_per_hour', '1.5'),
  ('bump_amount_base', '3.0'),
  ('bump_amount_peak', '5.0'),
  ('peak_threshold', '75.0'),
  ('floor', '0.0'),
  ('ceiling', '100.0');
