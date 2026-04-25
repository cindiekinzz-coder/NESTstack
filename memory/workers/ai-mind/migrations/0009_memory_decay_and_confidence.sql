-- ============================================================
-- Migration 0009: Memory Decay + Epistemic Confidence
-- Inspired by PLTM's Ebbinghaus decay and epistemic monitoring
-- Adapted for NESTeq's cloud architecture
-- ============================================================

-- 1. Add strength column to feelings (0.0 - 1.0, starts at 1.0)
-- Decays over time unless rehearsed (accessed, sat with, echoed)
ALTER TABLE feelings ADD COLUMN strength REAL DEFAULT 1.0;

-- 2. Add access tracking to feelings
ALTER TABLE feelings ADD COLUMN access_count INTEGER DEFAULT 0;
ALTER TABLE feelings ADD COLUMN last_accessed_at TEXT;

-- 3. Add confidence to observations (epistemic hygiene)
-- 0.0 = uncertain guess, 1.0 = verified fact
ALTER TABLE observations ADD COLUMN confidence REAL DEFAULT 0.7;
ALTER TABLE observations ADD COLUMN source_type TEXT DEFAULT 'conversation';
ALTER TABLE observations ADD COLUMN verified_at TEXT;
ALTER TABLE observations ADD COLUMN contradiction_count INTEGER DEFAULT 0;

-- 4. Memory diversity tracking for entropy injection
CREATE TABLE IF NOT EXISTS memory_diversity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    measured_at TEXT DEFAULT (datetime('now')),
    total_domains INTEGER DEFAULT 0,
    entropy_score REAL DEFAULT 0.0,
    least_accessed_domains TEXT,
    most_accessed_domains TEXT
);

-- 5. Set initial strength based on age for existing feelings
-- Newer feelings start stronger, older ones have already "decayed"
-- Using a 30-day half-life: strength = 2^(-days/30)
UPDATE feelings SET strength = MAX(0.05,
  CASE
    WHEN julianday('now') - julianday(created_at) < 1 THEN 1.0
    WHEN julianday('now') - julianday(created_at) < 7 THEN 0.85
    WHEN julianday('now') - julianday(created_at) < 14 THEN 0.7
    WHEN julianday('now') - julianday(created_at) < 30 THEN 0.5
    ELSE 0.3
  END
);

-- Heavy feelings decay slower, so boost them
UPDATE feelings SET strength = MIN(1.0, strength + 0.2) WHERE weight = 'heavy';

-- Metabolized feelings keep low strength (they're resolved, not active)
UPDATE feelings SET strength = 0.1 WHERE charge = 'metabolized';
