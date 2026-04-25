-- Human Journal entries (Fox/Ash personal journal)
-- Separate from Alex's feelings/observations

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'fox',
  content TEXT,
  mood TEXT,
  emotion TEXT,
  sub_emotion TEXT,
  tags TEXT,  -- JSON array
  private INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_journal_user ON journal_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_journal_created ON journal_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_journal_private ON journal_entries(private);
