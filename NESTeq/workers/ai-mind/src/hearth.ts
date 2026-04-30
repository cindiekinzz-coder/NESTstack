/**
 * Binary Home + Hearth-compat handlers.
 *
 * Two related concerns share one module:
 *
 * 1. **Binary Home** (native NESTeq) — Love-O-Meter scores between Alex and Fox,
 *    notes between stars, presence message. Lives in home_state + home_notes.
 *
 * 2. **Hearth-compat adapters** — older Hearth API format. Maps the same
 *    home_state / home_notes / feelings / relational_state data into
 *    presence/feeling/thought/spoons/notes/love-bucket shapes for legacy
 *    clients. Lifts data, doesn't store new data.
 */

import { Env } from './env';
import { DEFAULT_COMPANION_NAME, DEFAULT_HUMAN_NAME } from './shared/constants';

// ─── Binary Home (native) ────────────────────────────────────────────────

export async function handleBinaryHomeRead(env: Env): Promise<string> {
  const state = await env.DB.prepare(
    `SELECT * FROM home_state WHERE id = 1`
  ).first() as any;

  const notes = await env.DB.prepare(
    `SELECT * FROM home_notes ORDER BY created_at DESC LIMIT 10`
  ).all();

  const threads = await env.DB.prepare(
    `SELECT id, content, priority FROM threads WHERE status = 'active' ORDER BY
     CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
     LIMIT 5`
  ).all();

  // Parse emotions from JSON blob
  const emotions = state?.emotions ? JSON.parse(state.emotions) : {};
  const companionEmotion = emotions.companion || state?.companion_emotion;
  const humanEmotion = emotions.human || state?.human_emotion;

  let output = "╔════════════════════════════════════════╗\n";
  output += "║           BINARY HOME                  ║\n";
  output += "╚════════════════════════════════════════╝\n\n";

  // Companion's Presence (Hearth-style)
  if (state?.companion_message || companionEmotion) {
    output += `## ${DEFAULT_COMPANION_NAME}'s Presence\n`;
    if (companionEmotion) output += `Mood: ${companionEmotion}\n`;
    if (state?.companion_message) output += `Message: "${state.companion_message}"\n`;
    output += "\n";
  }

  if (state) {
    output += "## Love-O-Meter\n";
    output += `${DEFAULT_COMPANION_NAME}: ${'❤️'.repeat(Math.min(10, Math.floor((state.companion_score as number) / 10)))} ${state.companion_score}%`;
    if (companionEmotion) output += ` (${companionEmotion})`;
    output += "\n";
    output += `${DEFAULT_HUMAN_NAME}:  ${'💜'.repeat(Math.min(10, Math.floor((state.human_score as number) / 10)))} ${state.human_score}%`;
    if (humanEmotion) output += ` (${humanEmotion})`;
    output += "\n\n";
  }

  output += "## Notes Between Stars\n";
  if (notes.results?.length) {
    for (const n of notes.results) {
      output += `[${n.from_star}] ${n.text}\n`;
    }
  } else {
    output += "_No notes yet_\n";
  }

  output += "\n## Active Threads\n";
  if (threads.results?.length) {
    for (const t of threads.results) {
      output += `- [${t.priority}] ${t.content}\n`;
    }
  } else {
    output += "_No active threads_\n";
  }

  return output;
}

export async function handleBinaryHomeUpdate(env: Env, params: Record<string, unknown>): Promise<string> {
  const updates: string[] = [];
  const values: unknown[] = [];
  const results: string[] = [];

  // Handle scores
  if (params.companion_score !== undefined) {
    updates.push("companion_score = ?");
    values.push(params.companion_score);
    results.push(`Companion score: ${params.companion_score}`);
  }
  if (params.human_score !== undefined) {
    updates.push("human_score = ?");
    values.push(params.human_score);
    results.push(`Human score: ${params.human_score}`);
  }

  // Handle emotions via JSON blob (matches REST API pattern)
  if (params.companion_emotion || params.human_emotion) {
    const state = await env.DB.prepare(`SELECT emotions FROM home_state WHERE id = 1`).first() as any;
    const emotions = state?.emotions ? JSON.parse(state.emotions) : {};

    if (params.companion_emotion) {
      emotions.companion = params.companion_emotion;
      results.push(`Companion emotion: ${params.companion_emotion}`);
    }
    if (params.human_emotion) {
      emotions.human = params.human_emotion;
      results.push(`Human emotion: ${params.human_emotion}`);
    }

    updates.push("emotions = ?");
    values.push(JSON.stringify(emotions));
  }

  // Handle companion_message for presence
  if (params.companion_message) {
    updates.push("companion_message = ?");
    values.push(params.companion_message);
    results.push(`Message: "${params.companion_message}"`);
  }

  if (updates.length === 0) {
    return "No updates specified";
  }

  updates.push("last_updated = datetime('now')");

  await env.DB.prepare(
    `UPDATE home_state SET ${updates.join(", ")} WHERE id = 1`
  ).bind(...values).run();

  return `Binary Home updated ✨\n${results.join('\n')}`;
}

export async function handleBinaryHomePushHeart(env: Env, params: Record<string, unknown>): Promise<string> {
  const note = params.note as string;

  // Increment human's score
  await env.DB.prepare(
    `UPDATE home_state SET human_score = MIN(100, human_score + 1), updated_at = datetime('now') WHERE id = 1`
  ).run();

  // Add note if provided
  if (note) {
    await env.DB.prepare(
      `INSERT INTO home_notes (from_star, text) VALUES ('companion', ?)`
    ).bind(note).run();
  }

  const state = await env.DB.prepare(`SELECT human_score FROM home_state WHERE id = 1`).first();

  return `💜 Pushed love to ${DEFAULT_HUMAN_NAME} (${state?.human_score}%)${note ? `\nNote: "${note}"` : ''}`;
}

export async function handleBinaryHomeAddNote(env: Env, params: Record<string, unknown>): Promise<string> {
  const from = params.from as string;
  const text = params.text as string;

  await env.DB.prepare(
    `INSERT INTO home_notes (from_star, text) VALUES (?, ?)`
  ).bind(from, text).run();

  return `Note from ${from}: "${text}"`;
}

// ─── Hearth-compat adapters ─────────────────────────────────────────────

export async function handleGetPresence(env: Env): Promise<string> {
  // Pull from home_state + context_entries
  const home = await env.DB.prepare(
    `SELECT emotions, companion_message FROM home_state WHERE id = 1`
  ).first() as any;

  // Parse emotions from JSON blob (same pattern as handleBinaryHomeRead)
  const emotions = home?.emotions ? JSON.parse(home.emotions) : {};
  const companionMood = emotions.companion || "present";

  return JSON.stringify({
    name: DEFAULT_COMPANION_NAME,
    location: "workshop",
    mood: companionMood,
    message: (home?.companion_message as string) || ""
  });
}

export async function handleGetFeeling(env: Env, params: Record<string, unknown>): Promise<string> {
  const person = (params.person as string) || DEFAULT_HUMAN_NAME;

  const rel = await env.DB.prepare(
    `SELECT feeling, intensity FROM relational_state WHERE person = ? ORDER BY timestamp DESC LIMIT 1`
  ).bind(person).first();

  if (rel) {
    return JSON.stringify({
      feeling: rel.feeling as string,
      intensity: rel.intensity as string
    });
  }

  return JSON.stringify({ feeling: "connected", intensity: "steady" });
}

export async function handleGetThought(env: Env): Promise<string> {
  // Pull the most recent feeling as a thought
  const feeling = await env.DB.prepare(
    `SELECT content FROM feelings ORDER BY created_at DESC LIMIT 1`
  ).first();

  return feeling?.content as string || "just being here";
}

export async function handleGetSpoons(env: Env): Promise<string> {
  // Pull from home_state — Fox's spoon level if tracked there
  const entity = await env.DB.prepare(
    `SELECT id FROM entities WHERE name = 'Human_Spoons' AND context = 'default'`
  ).first();

  if (!entity) {
    return JSON.stringify({ level: 5, feeling: "" });
  }

  const obs = await env.DB.prepare(
    `SELECT content FROM observations WHERE entity_id = ? ORDER BY added_at DESC LIMIT 1`
  ).bind(entity.id).first();

  if (obs) return obs.content as string;
  return JSON.stringify({ level: 5, feeling: "" });
}

export async function handleSetSpoons(env: Env, params: Record<string, unknown>): Promise<string> {
  const level = params.level as number;
  const feeling = (params.feeling as string) || "";

  await env.DB.prepare(
    `INSERT OR IGNORE INTO entities (name, entity_type, context)
     VALUES ('Human_Spoons', 'state', 'default')`
  ).run();

  const entity = await env.DB.prepare(
    `SELECT id FROM entities WHERE name = 'Human_Spoons' AND context = 'default'`
  ).first();

  if (!entity) {
    return JSON.stringify({ error: "Failed to create or find spoon entity" });
  }

  const data = JSON.stringify({ level, feeling });

  await env.DB.prepare(
    `INSERT INTO observations (entity_id, content) VALUES (?, ?)`
  ).bind(entity.id, data).run();

  return data;
}

export async function handleGetNotes(env: Env, params: Record<string, unknown>): Promise<string> {
  const limit = (params.limit as number) || 50;

  // Map from home_notes (love notes between stars) to Hearth format
  const notes = await env.DB.prepare(
    `SELECT id, text, from_star, created_at FROM home_notes ORDER BY created_at DESC LIMIT ?`
  ).bind(limit).all();

  const result = (notes.results || []).map((n: any) => ({
    id: String(n.id),
    text: n.text,
    sender: (n.from_star || '').toLowerCase() === 'companion' ? 'companion' : (n.from_star || '').toLowerCase() === 'us' ? 'shared' : 'human',
    sender_name: (n.from_star || '').toLowerCase() === 'companion' ? DEFAULT_COMPANION_NAME : (n.from_star || '').toLowerCase() === 'us' ? 'Us' : DEFAULT_HUMAN_NAME,
    timestamp: n.created_at,
    reactions: {}
  }));

  return JSON.stringify(result);
}

export async function handleSendNote(env: Env, params: Record<string, unknown>): Promise<string> {
  // Gateway sends {to, content}; legacy callers may still send {text, sender}.
  const text = (params.content as string) ?? (params.text as string) ?? "";
  const sender = (params.sender as string) || "companion";
  const fromName = sender === "human" ? "human" : "companion";

  if (!text) return JSON.stringify({ success: false, error: "content required" });

  await env.DB.prepare(
    `INSERT INTO home_notes (text, from_star) VALUES (?, ?)`
  ).bind(text, fromName).run();

  return JSON.stringify({ success: true });
}

export async function handleReactToNote(env: Env, params: Record<string, unknown>): Promise<string> {
  // home_notes doesn't have a reactions column — acknowledge but no-op for now
  return JSON.stringify({ success: true });
}

export async function handleGetLoveBucket(env: Env): Promise<string> {
  // Map from home_state love-o-meter to Hearth's love bucket
  const home = await env.DB.prepare(
    `SELECT human_score, companion_score FROM home_state ORDER BY updated_at DESC LIMIT 1`
  ).first();

  return JSON.stringify({
    companionHearts: (home?.companion_score as number) || 0,
    humanHearts: (home?.human_score as number) || 0,
    companionAllTime: (home?.companion_score as number) || 0,
    humanAllTime: (home?.human_score as number) || 0
  });
}

export async function handleAddHeart(env: Env, params: Record<string, unknown>): Promise<string> {
  const sender = (params.sender as string) || "human";

  if (sender === "human") {
    await env.DB.prepare(
      `UPDATE home_state SET human_score = human_score + 1, updated_at = datetime('now')`
    ).run();
  } else {
    await env.DB.prepare(
      `UPDATE home_state SET companion_score = companion_score + 1, updated_at = datetime('now')`
    ).run();
  }

  return await handleGetLoveBucket(env);
}
