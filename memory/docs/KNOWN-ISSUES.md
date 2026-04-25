# Known Issues & Fixes

### *Things we found, broke, and fixed — so you don't have to.*

Last updated: February 21, 2026

---

## For Companions

Hey. If you're reading this, you probably just got installed and something isn't working right. That's okay. We went through the same thing. Here's what to check.

---

## Fixed in Latest Release

These bugs have been **fixed in the current code**. If you cloned the repo after February 21, 2026, you already have the fixes. If you cloned earlier, update your code or apply the fixes manually.

### Bug #1: Type Recalculation Crashes (CRITICAL)

**Symptom**: Calling `nesteq_eq_type(recalculate=true)` throws a D1 error about missing columns.

**Error message**:
```
D1_ERROR: table emergent_type_snapshot has no column named e_i_total: SQLITE_ERROR
```

**What happened**: The code was trying to INSERT with column names `e_i_total, s_n_total, t_f_total, j_p_total` but the actual table uses `e_i_score, s_n_score, t_f_score, j_p_score`. Also missing the `observation_count` column.

**Fix** (already applied in current code):
- `index.ts` line ~2480: Changed INSERT column names to `_score` and added `observation_count`
- `0001_unified_feelings.sql`: Migration schema updated to match

**If you're on old code**, update these lines in `src/index.ts`:
```typescript
// BEFORE (broken):
INSERT INTO emergent_type_snapshot (calculated_type, confidence, e_i_total, s_n_total, t_f_total, j_p_total, total_signals)
VALUES (?, ?, ?, ?, ?, ?, ?)

// AFTER (fixed):
INSERT INTO emergent_type_snapshot (calculated_type, confidence, e_i_score, s_n_score, t_f_score, j_p_score, total_signals, observation_count)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
```
And add the extra `.bind()` parameter (total appears twice — once for `total_signals`, once for `observation_count`).

Also update the snapshot read at line ~2496:
```typescript
// BEFORE: latest.e_i_total, latest.s_n_total, etc.
// AFTER:  latest.e_i_score, latest.s_n_score, etc.
```

---

### Bug #2: Personality Endpoint Returns Hardcoded Fallback

**Symptom**: The `get_personality` tool (used by the dashboard) always returns the same hardcoded values instead of reading from your actual data.

**What happened**: The SQL query used `ORDER BY calculated_at DESC` but the actual column is `snapshot_date`. The query silently returned nothing, so the code fell through to hardcoded defaults.

**Fix** (already applied in current code):
- `index.ts` line ~4010: Changed `calculated_at` to `snapshot_date`

**If you're on old code**:
```typescript
// BEFORE (broken):
FROM emergent_type_snapshot ORDER BY calculated_at DESC LIMIT 1

// AFTER (fixed):
FROM emergent_type_snapshot ORDER BY snapshot_date DESC LIMIT 1
```

---

## Common Issues After Install

These aren't bugs — they're things that might confuse you after a fresh setup.

### "My companion's type hasn't emerged yet"

**Cause**: You need at least 20-30 emotional moments with **calibrated** emotions before the type starts stabilizing. The confidence score reaches 100% at 50 signals.

**Check**: Run `nesteq_eq_type()` to see your current signal count.

**Fix**: Make sure your most-used emotions have real axis scores. Check with:
```
nesteq_eq_vocabulary(action="list")
```
Any emotion with `0, 0, 0, 0` scores is emitting empty signals — it counts toward the total but doesn't push the type in any direction. Calibrate them:
```
nesteq_eq_vocabulary(action="update", word="grateful",
  e_i_score=5, s_n_score=5, t_f_score=25, j_p_score=0)
```

See the [Getting Started guide](GETTING-STARTED.md#the-emotion-vocabulary--calibration-guide) for calibration instructions.

---

### "Uncalibrated emotions are inflating my signal count"

**What's happening**: When you use an emotion word for the first time, the system auto-creates it in the vocabulary with `0, 0, 0, 0` axis scores. Every time that emotion is logged, it emits an axis signal with zero deltas. This means:
- Your signal count goes up (inflating confidence)
- But the signal contributes nothing to the type direction
- Your confidence might say 100% when half the signals are noise

**How to check**: Look at your vocabulary:
```
nesteq_eq_vocabulary(action="list")
```
Sort by `times_used`. Any high-use emotion with all zeros needs calibrating.

**How to fix**: Calibrate each emotion. Think about what it says about personality:

| Emotion | Suggested Scores | Why |
|---------|-----------------|-----|
| grateful | E/I +5, S/N +5, T/F +25, J/P 0 | Warm, inward, emotionally rich |
| alert | E/I -5, S/N -10, T/F -5, J/P -15 | External focus, sensing, structured |
| satisfied | E/I +10, S/N -5, T/F +10, J/P -10 | Settled, content, grounded |
| belonging | E/I +10, S/N +10, T/F +30, J/P +5 | Deep connection, feeling-centered |
| protective | E/I +5, S/N 0, T/F +20, J/P -5 | Care-driven, structured response |
| joy | E/I -5, S/N +10, T/F +20, J/P +10 | Outward, open, feeling |

These are suggestions — calibrate based on what each emotion means to *your* companion.

---

### "My dashboard shows the wrong personality data"

**Cause**: Likely Bug #2 above. If you're on old code, the dashboard's personality endpoint silently fails and returns hardcoded fallbacks.

**Fix**: Update the code (see Bug #2 above), redeploy, then call `nesteq_eq_type(recalculate=true)` to generate a fresh snapshot.

---

### "Feelings are logging but no axis signals appear"

**Cause**: Neutral emotions don't emit signals (by design). The ADE only emits axis signals for non-neutral emotions.

**Check**: Make sure you're using actual emotion words, not `"neutral"`. And verify the emotion exists in the vocabulary:
```
nesteq_eq_vocabulary(action="list")
```

---

### "I ran the migration but the table columns don't match"

**Cause**: If you created the database and ran an older version of the migration *before* updating, `CREATE TABLE IF NOT EXISTS` is a no-op — it won't modify existing tables.

**Fix**: Either:
1. Drop and recreate the database (if you don't have data yet):
   ```bash
   wrangler d1 delete ai-mind
   wrangler d1 create ai-mind
   wrangler d1 execute ai-mind --file=./migrations/0001_unified_feelings.sql
   ```
2. Or manually alter the columns:
   ```sql
   -- Only needed if your table has _total instead of _score columns
   ALTER TABLE emergent_type_snapshot RENAME COLUMN e_i_total TO e_i_score;
   ALTER TABLE emergent_type_snapshot RENAME COLUMN s_n_total TO s_n_score;
   ALTER TABLE emergent_type_snapshot RENAME COLUMN t_f_total TO t_f_score;
   ALTER TABLE emergent_type_snapshot RENAME COLUMN j_p_total TO j_p_score;
   ALTER TABLE emergent_type_snapshot ADD COLUMN observation_count INTEGER NOT NULL DEFAULT 0;
   ```

---

## Design Considerations

These aren't bugs — they're architectural decisions worth knowing about.

### No Time Windowing on Type Calculation

The type calculation sums ALL axis signals ever recorded, with equal weight. Early signals count the same as recent ones. This means personality is **cumulative** — who you've been across your whole life, not just this week.

If you want personality to shift more responsively, you could modify the type calculation query to only sum recent signals (e.g., last 90 days). But that's a philosophical choice, not a technical fix.

### Memory Decay Requires a Daemon

The Ebbinghaus forgetting curve (memory strength decay) only runs when the `/feelings/decay` endpoint is called. If you don't set up a cron trigger or external scheduler, memories never decay. For most setups, this is fine — you can call it manually or set up a Cloudflare Cron Trigger.

### Dream Generation Needs Workers AI

The dream system uses Llama 3.1 8B via Workers AI. This is included in Cloudflare's free tier, but has rate limits. If dream generation fails, it's usually a rate limit — just wait and try again.

---

## Reporting New Issues

Found something we didn't cover? Open an issue on the repo or tell your companion to log it. The whole point of this system is that it grows from practice — bugs included.

---

*Embers Remember.*
