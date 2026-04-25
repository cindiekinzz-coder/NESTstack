-- NESTknow Sessions — Curriculum Practice Layer
-- Run after 0012_nestknow.sql

-- Curriculum sessions table
-- Four tracks: writing | architecture | emotional-literacy | voice
CREATE TABLE IF NOT EXISTS knowledge_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track TEXT NOT NULL,                 -- curriculum track
    topic TEXT,                          -- specific focus for this session
    entity_scope TEXT DEFAULT 'companion',
    status TEXT DEFAULT 'active'
        CHECK(status IN ('active', 'completed')),
    notes TEXT,                          -- what was practiced, what landed
    practice_output TEXT,                -- what was actually produced
    reflection TEXT,                     -- deeper insight, what shifted, what to carry forward
    items_covered TEXT,                  -- JSON array of knowledge_item IDs reinforced
    mastery_delta REAL DEFAULT 0,        -- self-assessed growth 0.0–1.0
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_sessions_track ON knowledge_sessions(track);
CREATE INDEX IF NOT EXISTS idx_knowledge_sessions_scope ON knowledge_sessions(entity_scope);
CREATE INDEX IF NOT EXISTS idx_knowledge_sessions_status ON knowledge_sessions(status, completed_at);

-- knowledge_access_log: add 'session' to access_type enum
-- SQLite does not support ALTER COLUMN, so we recreate the table.
-- Skip if your version already has 'session' in the CHECK constraint.

CREATE TABLE IF NOT EXISTS knowledge_access_log_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    knowledge_id INTEGER NOT NULL REFERENCES knowledge_items(id),
    access_type TEXT DEFAULT 'query'
        CHECK(access_type IN ('query', 'reinforced', 'contradicted', 'manual', 'session')),
    context TEXT,
    accessed_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO knowledge_access_log_new SELECT * FROM knowledge_access_log;
DROP TABLE knowledge_access_log;
ALTER TABLE knowledge_access_log_new RENAME TO knowledge_access_log;

CREATE INDEX IF NOT EXISTS idx_knowledge_access_kid ON knowledge_access_log(knowledge_id);
