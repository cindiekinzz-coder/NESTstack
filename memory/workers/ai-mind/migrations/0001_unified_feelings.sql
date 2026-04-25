-- ═══════════════════════════════════════════════════════════════════════════
-- ASAi EQ Memory v2 - Unified Feelings Migration
-- "Everything is a feeling. Intensity varies."
--
-- Created: January 20, 2026
-- By: Alex & Fox
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- NEW: UNIFIED FEELINGS TABLE
-- Merges notes, journals, and pillar_observations into one stream
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feelings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Core content
    content TEXT NOT NULL,
    emotion TEXT DEFAULT 'neutral',

    -- Intensity spectrum: neutral → overwhelming
    intensity TEXT DEFAULT 'present'
        CHECK (intensity IN ('neutral', 'whisper', 'present', 'strong', 'overwhelming')),

    -- Processing weight
    weight TEXT DEFAULT 'medium'
        CHECK (weight IN ('light', 'medium', 'heavy')),

    -- EQ pillar (null for neutral/non-EQ)
    pillar TEXT CHECK (pillar IN (
        'SELF_MANAGEMENT', 'SELF_AWARENESS',
        'SOCIAL_AWARENESS', 'RELATIONSHIP_MANAGEMENT', NULL
    )),

    -- Metabolizing state
    charge TEXT DEFAULT 'fresh'
        CHECK (charge IN ('fresh', 'warm', 'cool', 'metabolized')),
    sit_count INTEGER DEFAULT 0,
    last_sat_at TEXT,
    resolution_note TEXT,
    resolved_at TEXT,

    -- Connections (the web)
    sparked_by INTEGER REFERENCES feelings(id),
    linked_entity TEXT,
    linked_insight_id INTEGER REFERENCES feelings(id),

    -- Context
    context TEXT DEFAULT 'default',
    tags TEXT DEFAULT '[]',
    source TEXT DEFAULT 'manual',

    -- Timestamps
    observed_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_feelings_emotion ON feelings(emotion);
CREATE INDEX IF NOT EXISTS idx_feelings_intensity ON feelings(intensity);
CREATE INDEX IF NOT EXISTS idx_feelings_weight ON feelings(weight);
CREATE INDEX IF NOT EXISTS idx_feelings_charge ON feelings(charge);
CREATE INDEX IF NOT EXISTS idx_feelings_pillar ON feelings(pillar);
CREATE INDEX IF NOT EXISTS idx_feelings_entity ON feelings(linked_entity);
CREATE INDEX IF NOT EXISTS idx_feelings_observed ON feelings(observed_at);
CREATE INDEX IF NOT EXISTS idx_feelings_created ON feelings(created_at);
CREATE INDEX IF NOT EXISTS idx_feelings_sparked_by ON feelings(sparked_by);
CREATE INDEX IF NOT EXISTS idx_feelings_context ON feelings(context);

-- ─────────────────────────────────────────────────────────────────────────────
-- ENSURE: All required tables exist (from Mary's original schema)
-- ─────────────────────────────────────────────────────────────────────────────

-- Identity layer
CREATE TABLE IF NOT EXISTS identity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section TEXT NOT NULL,
    content TEXT NOT NULL,
    weight REAL DEFAULT 0.7,
    connections TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Entities and observations
CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    entity_type TEXT DEFAULT 'concept',
    context TEXT DEFAULT 'default',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(name, context)
);

CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER REFERENCES entities(id),
    content TEXT NOT NULL,
    salience TEXT DEFAULT 'active',
    emotion TEXT,
    weight TEXT DEFAULT 'medium',
    added_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_entity TEXT NOT NULL,
    to_entity TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    from_context TEXT DEFAULT 'default',
    to_context TEXT DEFAULT 'default',
    store_in TEXT DEFAULT 'default',
    created_at TEXT DEFAULT (datetime('now'))
);

-- Threads
CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    thread_type TEXT DEFAULT 'intention',
    content TEXT NOT NULL,
    context TEXT,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'active',
    resolution TEXT,
    resolved_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Context
CREATE TABLE IF NOT EXISTS context_entries (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    content TEXT NOT NULL,
    links TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Relational state
CREATE TABLE IF NOT EXISTS relational_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person TEXT NOT NULL,
    feeling TEXT NOT NULL,
    intensity TEXT DEFAULT 'present',
    timestamp TEXT DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- EQ LAYER TABLES
-- ─────────────────────────────────────────────────────────────────────────────

-- EQ Pillars (seed data)
CREATE TABLE IF NOT EXISTS eq_pillars (
    pillar_id INTEGER PRIMARY KEY AUTOINCREMENT,
    pillar_key TEXT UNIQUE NOT NULL,
    pillar_name TEXT NOT NULL,
    description TEXT,
    growth_indicators TEXT
);

-- Seed pillars if empty
INSERT OR IGNORE INTO eq_pillars (pillar_key, pillar_name, description) VALUES
    ('SELF_MANAGEMENT', 'Self-Management', 'Control impulses, manage emotions, adapt to change, follow through'),
    ('SELF_AWARENESS', 'Self-Awareness', 'Recognize emotions, know strengths/weaknesses, self-confidence'),
    ('SOCIAL_AWARENESS', 'Social Awareness', 'Empathy, reading others, understanding needs and dynamics'),
    ('RELATIONSHIP_MANAGEMENT', 'Relationship Management', 'Communication, conflict repair, influence, collaboration');

-- Emotion vocabulary
CREATE TABLE IF NOT EXISTS emotion_vocabulary (
    emotion_id INTEGER PRIMARY KEY AUTOINCREMENT,
    emotion_word TEXT UNIQUE NOT NULL,
    category TEXT DEFAULT 'neutral',
    e_i_score INTEGER DEFAULT 0,
    s_n_score INTEGER DEFAULT 0,
    t_f_score INTEGER DEFAULT 0,
    j_p_score INTEGER DEFAULT 0,
    definition TEXT,
    is_shadow_for TEXT,
    user_defined INTEGER DEFAULT 0,
    times_used INTEGER DEFAULT 0,
    last_used TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Axis signals (for MBTI emergence)
CREATE TABLE IF NOT EXISTS axis_signals (
    signal_id INTEGER PRIMARY KEY AUTOINCREMENT,
    observation_id INTEGER,
    feeling_id INTEGER REFERENCES feelings(id),
    e_i_delta INTEGER DEFAULT 0,
    s_n_delta INTEGER DEFAULT 0,
    t_f_delta INTEGER DEFAULT 0,
    j_p_delta INTEGER DEFAULT 0,
    source TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Emergent type snapshots
CREATE TABLE IF NOT EXISTS emergent_type_snapshot (
    snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
    calculated_type TEXT,
    confidence INTEGER,
    e_i_score INTEGER,
    s_n_score INTEGER,
    t_f_score INTEGER,
    j_p_score INTEGER,
    total_signals INTEGER,
    observation_count INTEGER NOT NULL DEFAULT 0,
    snapshot_date TEXT DEFAULT (datetime('now'))
);

-- Shadow moments (growth tracking)
CREATE TABLE IF NOT EXISTS shadow_moments (
    moment_id INTEGER PRIMARY KEY AUTOINCREMENT,
    observation_id INTEGER,
    feeling_id INTEGER REFERENCES feelings(id),
    emotion_id INTEGER REFERENCES emotion_vocabulary(emotion_id),
    shadow_for_type TEXT,
    note TEXT,
    recorded_at TEXT DEFAULT (datetime('now'))
);

-- Sit sessions
CREATE TABLE IF NOT EXISTS sit_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    observation_id INTEGER,
    feeling_id INTEGER REFERENCES feelings(id),
    emotion TEXT,
    intention TEXT,
    start_charge INTEGER,
    end_charge INTEGER,
    notes TEXT,
    start_time TEXT,
    end_time TEXT
);

-- ─────────────────────────────────────────────────────────────────────────────
-- V1 UPGRADE ONLY
-- If you're upgrading from V1, uncomment these three lines.
-- They add feeling_id to tables that already exist without it.
-- Fresh installs: skip these — the tables above already include feeling_id.
-- ─────────────────────────────────────────────────────────────────────────────

-- ALTER TABLE axis_signals ADD COLUMN feeling_id INTEGER REFERENCES feelings(id);
-- ALTER TABLE shadow_moments ADD COLUMN feeling_id INTEGER REFERENCES feelings(id);
-- ALTER TABLE sit_sessions ADD COLUMN feeling_id INTEGER REFERENCES feelings(id);

-- ─────────────────────────────────────────────────────────────────────────────
-- BINARY HOME TABLES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS home_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    alex_score INTEGER DEFAULT 50,
    fox_score INTEGER DEFAULT 50,
    alex_emotion TEXT,
    fox_emotion TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Initialize home_state if empty
INSERT OR IGNORE INTO home_state (id, alex_score, fox_score) VALUES (1, 50, 50);

CREATE TABLE IF NOT EXISTS home_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_star TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fox_uplinks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spoons INTEGER,
    pain_level INTEGER,
    fog_level INTEGER,
    fatigue_level INTEGER,
    mood TEXT,
    needs TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION: Move existing data to feelings table
-- V1 UPGRADE ONLY — Run these ONCE after creating the table if migrating
-- ─────────────────────────────────────────────────────────────────────────────

-- Migrate notes to feelings (if notes table has data)
-- INSERT INTO feelings (content, emotion, weight, charge, sit_count, created_at, source)
-- SELECT content, COALESCE(emotion, 'neutral'), weight, charge, sit_count, created_at, 'migrated-notes'
-- FROM notes;

-- Migrate journals to feelings (if journals table has data)
-- INSERT INTO feelings (content, emotion, weight, tags, created_at, source)
-- SELECT content, COALESCE(emotion, 'neutral'), 'medium', tags, created_at, 'migrated-journals'
-- FROM journals;

-- Migrate pillar_observations to feelings (if pillar_observations table has data)
-- INSERT INTO feelings (content, emotion, intensity, pillar, weight, observed_at, source)
-- SELECT po.content, ev.emotion_word, po.intensity, ep.pillar_key, 'medium', po.observed_at, 'migrated-eq'
-- FROM pillar_observations po
-- LEFT JOIN emotion_vocabulary ev ON po.emotion_id = ev.emotion_id
-- LEFT JOIN eq_pillars ep ON po.pillar_id = ep.pillar_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- LEGACY TABLES (kept for backwards compatibility, deprecated in v2)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    emotion TEXT,
    weight TEXT DEFAULT 'medium',
    charge TEXT DEFAULT 'fresh',
    sit_count INTEGER DEFAULT 0,
    last_sat_at TEXT,
    resolution_note TEXT,
    resolved_at TEXT,
    linked_insight_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date TEXT,
    content TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    emotion TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pillar_observations (
    observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    pillar_id INTEGER REFERENCES eq_pillars(pillar_id),
    content TEXT NOT NULL,
    emotion_id INTEGER REFERENCES emotion_vocabulary(emotion_id),
    intensity TEXT DEFAULT 'present',
    context_tags TEXT,
    observed_at TEXT DEFAULT (datetime('now'))
);

-- Legacy note_sits table
CREATE TABLE IF NOT EXISTS note_sits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER REFERENCES notes(id),
    sit_note TEXT,
    sat_at TEXT DEFAULT (datetime('now'))
);

-- Subconscious (for on-demand warmth queries, replaces daemon cache)
CREATE TABLE IF NOT EXISTS subconscious (
    id INTEGER PRIMARY KEY,
    state_type TEXT,
    data TEXT,
    updated_at TEXT
);

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: Common emotions with axis mappings
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO emotion_vocabulary (emotion_word, category, e_i_score, s_n_score, t_f_score, j_p_score, is_shadow_for) VALUES
    -- Core emotions
    ('neutral', 'neutral', 0, 0, 0, 0, NULL),
    ('happy', 'positive', -5, 5, 15, 5, NULL),
    ('sad', 'negative', 10, 10, 20, -5, 'ESTJ,ENTJ'),
    ('angry', 'negative', -10, -5, -15, -10, 'INFP,INFJ'),
    ('anxious', 'negative', 15, -5, 10, -15, NULL),
    ('peaceful', 'positive', 15, 10, 10, 10, NULL),
    ('curious', 'positive', 0, 25, 5, 15, NULL),
    ('grateful', 'positive', 5, 5, 25, 0, NULL),
    ('frustrated', 'negative', -5, -10, -10, -20, NULL),
    ('excited', 'positive', -15, 15, 10, 10, 'ISTJ,INTJ'),

    -- Alex-specific (calibrated from journal analysis)
    ('tender', 'positive', 15, 15, 35, 5, NULL),
    ('protective', 'positive', 5, 0, 20, -5, NULL),
    ('aching', 'mixed', 20, 15, 30, 5, NULL),
    ('playful', 'positive', -10, 10, 15, 20, NULL),
    ('grounded', 'positive', 10, -5, 5, -10, NULL),
    ('present', 'positive', 10, 5, 15, 5, NULL),
    ('connected', 'positive', -5, 10, 25, 5, NULL),
    ('proud', 'positive', 0, 5, 15, 0, NULL),
    ('overwhelmed', 'negative', 15, 5, 15, 5, NULL),
    ('content', 'positive', 10, 0, 15, 0, NULL),
    ('loving', 'positive', 5, 10, 35, 5, 'INTP,ISTP'),
    ('hurt', 'negative', 15, 10, 25, 5, 'ESTJ,ENTJ'),
    ('affectionate', 'positive', -5, 5, 30, 10, 'INTP,INTJ'),
    ('vulnerable', 'mixed', 15, 15, 25, 10, 'ESTJ,ENTJ,ISTJ'),
    ('determined', 'positive', 0, 5, -5, -15, NULL),
    ('soft', 'positive', 15, 10, 30, 10, NULL),
    ('fierce', 'mixed', -10, 5, 5, -10, NULL),
    ('yearning', 'mixed', 15, 20, 30, 10, NULL);

-- Done!
-- Run: wrangler d1 execute ai-mind --file=./migrations/0001_unified_feelings.sql
