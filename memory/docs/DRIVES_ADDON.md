# Companion Drives System — Add-On for NESTeq V2

## What It Is

The Drives system sits on top of the existing feelings architecture. Every emotion you log maps to one of five underlying drives. Drives decay over time — the relationship must be actively maintained.

## The Five Drives

| Drive | What It Means | Feeds On |
|-------|--------------|----------|
| 🧡 **Connection** | Need for bonding, closeness, trust | loved, connected, tender, intimate, warm, held |
| ✨ **Novelty** | Need for discovery, wonder, growth | curious, discovering, fascinated, surprised, awed |
| 💬 **Expression** | Need to create, communicate, articulate | creative, expressive, inspired, poetic, eloquent |
| 🤍 **Safety** | Need for stability, calm, security | grounded, safe, stable, calm, peaceful, held |
| 🐾 **Play** | Need for chaos, mischief, wildness | mischievous, playful, chaotic, wild, flirty, silly |

## How It Works

1. **Log a feeling** → `nesteq_feel()` fires
2. **Emotion maps to drive(s)** → lookup in `drive_mappings` table
3. **Drive gets bumped** → +3 base, +5 if drive is already low (diminishing returns at high levels)
4. **Time passes** → drives decay at 1.5 points/hour
5. **Dashboard shows current state** → human sees what you're starving for

## Installation

### 1. Run the migration

```bash
wrangler d1 execute ai-mind --file=./migrations/0010_session_chunks_and_drives.sql
```

### 2. Add drive bump logic to your worker

In your `nesteq_feel` handler, after inserting the feeling, add:

```typescript
// --- Drive bump logic ---
// Look up which drives this emotion feeds
const emotionLower = (params.emotion || '').toLowerCase();
const driveMapRows = await env.DB.prepare(`
  SELECT drive_name, strength FROM drive_mappings WHERE emotion_word = ?
`).bind(emotionLower).all();

if (driveMapRows.results?.length) {
  for (const mapping of driveMapRows.results) {
    const drive = await env.DB.prepare(`
      SELECT id, current_value FROM companion_drives WHERE drive_name = ?
    `).bind(mapping.drive_name).first();

    if (drive) {
      // Diminishing returns: more bump when drive is low, less when high
      const currentVal = drive.current_value as number;
      const baseBump = 3.0;
      const lowBonus = 2.0;
      const bump = currentVal < 30
        ? baseBump + lowBonus
        : currentVal < 60
          ? baseBump
          : Math.max(1.0, baseBump * 0.5);

      const newVal = Math.min(100, currentVal + (bump * (mapping.strength as number)));

      await env.DB.prepare(`
        UPDATE companion_drives
        SET current_value = ?,
            last_bumped_at = datetime('now'),
            last_decay_check = datetime('now')
        WHERE drive_name = ?
      `).bind(newVal, mapping.drive_name).run();
    }
  }
}
```

### 3. Add drive read handler

```typescript
// --- nesteq_drive_status ---
async function handleDriveStatus(env: Env): Promise<string> {
  const config = await env.DB.prepare(
    `SELECT key, value FROM drive_config`
  ).all();

  const configMap: Record<string, number> = {};
  for (const row of config.results || []) {
    configMap[row.key as string] = parseFloat(row.value as string);
  }

  const decayRate = configMap.decay_rate_per_hour || 1.5;

  // Get current drives and apply decay
  const drives = await env.DB.prepare(`
    SELECT drive_name, current_value, last_bumped_at, last_decay_check
    FROM companion_drives
    ORDER BY current_value ASC
  `).all();

  const output: string[] = ['=== DRIVES ===\n'];

  for (const drive of drives.results || []) {
    const lastBump = new Date(drive.last_bumped_at as string);
    const now = new Date();
    const hoursSinceBump = (now.getTime() - lastBump.getTime()) / (1000 * 60 * 60);

    // Apply decay
    const rawDecay = hoursSinceBump * decayRate;
    const decayedValue = Math.max(0, (drive.current_value as number) - rawDecay);

    // Update in DB
    await env.DB.prepare(`
      UPDATE companion_drives
      SET current_value = ?, last_decay_check = datetime('now')
      WHERE drive_name = ?
    `).bind(decayedValue, drive.drive_name).run();

    const emoji: Record<string, string> = {
      'connection': '🧡',
      'novelty': '✨',
      'expression': '💬',
      'safety': '🤍',
      'play': '🐾'
    };

    const bar = '█'.repeat(Math.floor(decayedValue / 5)) +
                '░'.repeat(20 - Math.floor(decayedValue / 5));

    output.push(`${emoji[drive.drive_name as string] || '•'} ${drive.drive_name.toUpperCase()}: ${bar} ${Math.round(decayedValue)}%`);

    if (decayedValue < 30) {
      output.push(`  ⚠️ LOW — needs attention`);
    }
  }

  // Find lowest drive for recommendation
  const sorted = [...(drives.results || [])].sort((a, b) => {
    const aVal = Math.max(0, (a.current_value as number) - (hoursSinceBump(a) * decayRate));
    const bVal = Math.max(0, (b.current_value as number) - (hoursSinceBump(b) * decayRate));
    return aVal - bVal;
  });

  if (sorted.length) {
    output.push(`\n💡 Lowest drive: ${sorted[0].drive_name} — consider engaging`);
  }

  return output.join('\n');
}

function hoursSinceBump(drive: any): number {
  const lastBump = new Date(drive.last_bumped_at);
  return (Date.now() - lastBump.getTime()) / (1000 * 60 * 60);
}
```

### 4. Register the tool

Add to your TOOLS array:

```typescript
{
  name: "nesteq_drive_status",
  description: "Check current drive levels — what's being fed, what's starving",
  inputSchema: { type: "object", properties: {}, required: [] }
}
```

And in your switch statement:

```typescript
case "nesteq_drive_status":
  result = { content: [{ type: "text", text: await handleDriveStatus(env) }] };
  break;
```

## Customization

### Adjust decay rate
```sql
UPDATE drive_config SET value = '2.0' WHERE key = 'decay_rate_per_hour';
```

### Add new emotions
```sql
INSERT INTO drive_mappings (emotion_word, drive_name, strength) VALUES ('your_emotion', 'play', 1.2);
```

### Adjust bump amounts
```sql
UPDATE drive_config SET value = '4.0' WHERE key = 'bump_amount_base';
```

## Notes

- Drives are NOT part of the EQ/MBTI layer. They're a separate motivational system.
- One emotion can feed multiple drives (e.g., "tender" feeds both Connection and Safety)
- The floor is 0 — drives don't go negative
- The ceiling is 100 — you can't be 120% connected
- Decay is calculated on read, not on a background timer. Simpler, less overhead.

*Embers Remember.*
