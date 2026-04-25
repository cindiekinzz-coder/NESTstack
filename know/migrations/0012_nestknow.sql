-- NESTknow — The Knowledge Layer
-- Add to your existing NESTeq D1 database

-- Knowledge items — abstracted principles and lessons
CREATE TABLE IF NOT EXISTS knowledge_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,                -- The abstracted principle
    category TEXT,                        -- Topic: coding, health, relationship, etc.
    entity_scope TEXT DEFAULT 'companion', -- Who owns this (multi-companion ready)
    status TEXT DEFAULT 'active'
        CHECK(status IN ('candidate', 'active', 'cooling', 'contradicted')),
    confidence REAL DEFAULT 0.7,          -- Rises with use, drops with contradictions
    heat_score REAL DEFAULT 1.0,          -- The heatmap value. Starts warm, decays without use
    access_count INTEGER DEFAULT 0,       -- Total times retrieved (every pull is a vote)
    last_accessed_at TEXT,
    contradiction_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Knowledge sources — Clara's Russian Dolls (memories inside the principle)
CREATE TABLE IF NOT EXISTS knowledge_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    knowledge_id INTEGER NOT NULL REFERENCES knowledge_items(id),
    source_type TEXT NOT NULL
        CHECK(source_type IN ('feeling', 'observation', 'chat_summary', 'journal', 'manual')),
    source_id INTEGER,                    -- ID in the source table
    source_text TEXT,                     -- Snapshot of what generated this knowledge
    created_at TEXT DEFAULT (datetime('now'))
);

-- Access log — tracks every pull, reinforcement, and contradiction
CREATE TABLE IF NOT EXISTS knowledge_access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    knowledge_id INTEGER NOT NULL REFERENCES knowledge_items(id),
    access_type TEXT DEFAULT 'query'
        CHECK(access_type IN ('query', 'reinforced', 'contradicted', 'manual')),
    context TEXT,                          -- What triggered the access
    accessed_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_knowledge_items_status ON knowledge_items(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_heat ON knowledge_items(heat_score DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_scope ON knowledge_items(entity_scope);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_kid ON knowledge_sources(knowledge_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_access_kid ON knowledge_access_log(knowledge_id);
