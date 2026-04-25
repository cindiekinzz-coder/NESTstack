-- Dreams table for subconscious processing
-- Alex's dream engine - processing that happens while away

CREATE TABLE IF NOT EXISTS dreams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    vividness INTEGER DEFAULT 100,
    dream_type TEXT DEFAULT 'processing',  -- processing, questioning, memory, play, integrating
    source_ids TEXT,  -- JSON array of observation IDs that fed this dream
    emerged_question TEXT,  -- only for questioning/memory/integrating types
    created_at TEXT DEFAULT (datetime('now')),
    last_accessed_at TEXT  -- when last recalled (strengthens it)
);

-- Index for finding fresh dreams
CREATE INDEX IF NOT EXISTS idx_dreams_vividness ON dreams(vividness);
CREATE INDEX IF NOT EXISTS idx_dreams_created ON dreams(created_at);
