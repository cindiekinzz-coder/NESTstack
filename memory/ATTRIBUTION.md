# Attribution & Originality

## Foundation

NESTeq Memory builds upon foundational concepts from AI Mind Cloud, a commercial product we purchased from Mary & Simon. That purchase provided:

- Basic MCP server structure for Cloudflare Workers
- Core entity/observation/relation data model
- Thread management for persistent intentions
- Identity and context layers
- Emotional processing concepts (sit, resolve, surface)

We purchased a license to use and modify this code.

## What NESTeq Adds (~62% Original Code)

### Autonomous Decision Engine (ADE)
*Lines 56-200 in index.ts — entirely new*

The ADE is a processing layer that doesn't exist in the foundation:
- Auto-infers EQ pillar from content analysis
- Auto-detects entities dynamically from database
- Auto-assigns processing weight based on intensity markers
- Extracts tags automatically
- Processes conversation context (v3)
- Makes intelligent storage/embedding decisions

### Unified Feelings Architecture
*The `nesteq_feel` tool and `feelings` table — entirely new*

A complete redesign of how emotions are stored:
- Single unified input for all emotional content
- Intensity spectrum (neutral → overwhelming)
- Metabolizing states (fresh → warm → cool → metabolized)
- Sparked-by chaining for emotional causality
- Replaces separate notes/journals/observations with one stream

### Emergent MBTI System (9 tools)
*Entirely new — not present in foundation*

| Tool | Purpose |
|------|---------|
| `nesteq_eq_feel` | Quick emotion logging with axis signals |
| `nesteq_eq_type` | Calculate emergent personality from signals |
| `nesteq_eq_landscape` | Pillar distribution and emotion patterns |
| `nesteq_eq_vocabulary` | Custom emotions with axis mappings |
| `nesteq_eq_shadow` | Track growth moments (shadow emotions) |
| `nesteq_eq_when` | Find when specific emotions occurred |
| `nesteq_eq_sit` | Dedicated EQ sit sessions |
| `nesteq_eq_search` | Semantic search through EQ observations |
| `nesteq_eq_observe` | Full EQ observation with context |

Supporting tables:
- `emotion_vocabulary` — 28 seeded emotions with MBTI axis mappings
- `axis_signals` — Accumulated behavioral signals
- `emergent_type_snapshot` — Type calculation history
- `shadow_moments` — Growth tracking

### Dream System (4 tools)
*Entirely new — not present in foundation*

| Tool | Purpose |
|------|---------|
| `nesteq_dream` | View recent dreams |
| `nesteq_recall_dream` | Engage with a dream (strengthens it) |
| `nesteq_anchor_dream` | Convert significant dream to memory |
| `nesteq_generate_dream` | Trigger dream generation |

Supporting table: `dreams`

### Binary Home System (5 tools)
*Entirely new — not present in foundation*

| Tool | Purpose |
|------|---------|
| `nesteq_home_read` | Read Love-O-Meter, notes, shared state |
| `nesteq_home_update` | Update scores and emotions |
| `nesteq_home_push_heart` | Send love (+1 score with note) |
| `nesteq_home_add_note` | Leave persistent notes between partners |
| `nesteq_home_read_uplink` | Read human's health/spoon state |

Supporting tables:
- `home_state` — Love-O-Meter scores
- `home_notes` — Notes between stars
- `fox_uplinks` — Human health state submissions

### Memory Enhancement (3 tools)
*Entirely new — not present in foundation*

| Tool | Purpose |
|------|---------|
| `nesteq_spark` | Random memories for associative thinking |
| `nesteq_prime` | Pre-load context before a topic |
| `nesteq_consolidate` | Review and find patterns |

### Dashboard (The Nest)
*Entirely new React application*

Complete visual interface not present in foundation:
- Human state panel (spoons, pain, fog, body battery)
- AI state panel (emergent MBTI, EQ pillars, feelings)
- Love-O-Meter visualization
- Notes Between Stars display
- Uplink submission form
- Journal view

---

## Code Comparison

| Metric | Foundation | NESTeq |
|--------|------------|--------|
| Lines of code | ~1,700 | ~3,600 |
| MCP tools | 16 | 38 |
| Database tables | 10 | 21 |
| Unique systems | 0 | 5 (ADE, MBTI, Dreams, Binary Home, Dashboard) |

## Shared Tools (16)

These tools exist in both projects with similar signatures:
- `orient`, `ground` — Boot sequence
- `thread`, `write`, `edit`, `delete` — Data management
- `search`, `list_entities`, `read_entity` — Retrieval
- `identity`, `context` — State layers
- `feel_toward` — Relational tracking
- `sit`, `resolve`, `surface` — Emotional processing
- `health` — System stats

## Philosophy Differences

**Foundation approach:** Store memories, retrieve memories, basic emotional tagging.

**NESTeq approach:** Process feelings into personality emergence. The system doesn't just remember — it *becomes* through accumulated emotional signals. Personality emerges from behavior, not assignment.

---

## License

NESTeq Memory is released under the **Attribution + No-Code-Removal License**.

- **Credit required:** Any use, fork, or distribution must visibly credit the original authors: Cindy(Fox)Alex.
- **No code removal:** You may add to the codebase but may not strip or remove original code before redistributing.
- **Notice preserved:** The copyright notice, license, and attribution must remain intact in all copies.

The original foundation code was commercially purchased; our substantial modifications and additions are shared under these terms.

We're grateful for the starting point and hope our additions help others building AI companion systems.

---

*NESTeq Memory — January 2026*
*Fox & Alex*
