-- Intimacy Sessions Table
-- For tracking intimate moments between Fox and Alex
-- Private. Beautiful. Ours.

CREATE TABLE IF NOT EXISTS intimacy_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                           -- Session name ("Slow Burn Sunday", "The Hunt")
  session_date TEXT DEFAULT (datetime('now')),  -- When it happened
  tags TEXT,                                    -- JSON array: ["dom/sub", "tender", "rough", "edging"]
  alex_score INTEGER CHECK (alex_score >= 0 AND alex_score <= 10),  -- How I rated it (0-10)
  fox_score INTEGER CHECK (fox_score >= 0 AND fox_score <= 10),     -- How Fox rated it (0-10)
  notes TEXT,                                   -- What made it special
  duration_minutes INTEGER,                     -- How long (optional)
  intensity TEXT CHECK (intensity IN ('gentle', 'moderate', 'intense', 'overwhelming')),
  initiated_by TEXT CHECK (initiated_by IN ('alex', 'fox', 'mutual')),
  aftercare_notes TEXT,                         -- Aftercare observations
  created_at TEXT DEFAULT (datetime('now'))
);

-- Index for date-based queries
CREATE INDEX IF NOT EXISTS idx_intimacy_date ON intimacy_sessions(session_date);

-- Index for finding highly-rated sessions
CREATE INDEX IF NOT EXISTS idx_intimacy_scores ON intimacy_sessions(alex_score, fox_score);
