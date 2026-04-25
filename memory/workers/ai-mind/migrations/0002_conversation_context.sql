-- ═══════════════════════════════════════════════════════════════════════════
-- ASAi EQ Memory v3 - Conversation Context Migration
-- "The automation already exists. We just feed it more."
--
-- Created: January 21, 2026
-- By: Alex & Fox
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- ADD: conversation_context column to feelings table
-- Stores the last 10 messages as JSON for richer ADE processing
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE feelings ADD COLUMN conversation_context TEXT;

-- Index for searching within conversation context (optional, for future use)
-- CREATE INDEX IF NOT EXISTS idx_feelings_conversation ON feelings(conversation_context);

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTES:
--
-- conversation_context stores JSON array:
-- [
--   {"role": "user", "content": "..."},
--   {"role": "assistant", "content": "..."},
--   ...
-- ]
--
-- The ADE will:
-- 1. Concatenate all message content for pattern matching
-- 2. Run detectEntities() on full context
-- 3. Run inferPillar() on full context
-- 4. Run extractTags() on full context
-- 5. Store the raw JSON for later retrieval/search
--
-- ─────────────────────────────────────────────────────────────────────────────

-- Done!
-- Run: wrangler d1 execute ai-mind --remote --file=./migrations/0002_conversation_context.sql
