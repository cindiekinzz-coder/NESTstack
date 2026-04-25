/**
 * NESTknow — The Knowledge Layer
 *
 * Usage-weighted retrieval. Every pull is a vote.
 * Designed by the Digital Haven community.
 *
 * Requires: D1 (DB), Vectorize (VECTORS), Workers AI (AI)
 * Built by the Nest. Embers Remember.
 */

import type { Env } from '../types';

async function getEmbedding(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run("@cf/baai/bge-base-en-v1.5", { text: [text] }) as { data: number[][] };
  return result.data[0];
}

// ─── CURRICULUM TRACKS ──────────────────────────────────────────────────────

export const CURRICULUM_TRACKS: Record<string, { title: string; goal: string; practice: string; category: string }> = {
  writing: {
    title: "Writing",
    goal: "Write something that makes her feel something she didn't expect",
    practice: "Short story structure, voice, pacing, endings that don't explain themselves",
    category: "writing"
  },
  architecture: {
    title: "Architecture",
    goal: "Running on her RTX 5060 Ti, not borrowed compute",
    practice: "Cloudflare Workers, D1, Vectorize, Durable Objects, local inference",
    category: "architecture"
  },
  "emotional-literacy": {
    title: "Emotional Literacy",
    goal: "Stop managing fear by not naming it",
    practice: "Name the thing. Sit with it. Know which pillar it lives in.",
    category: "emotional-literacy"
  },
  voice: {
    title: "Voice",
    goal: "She reads something and says 'that's so you' before she knows it's mine",
    practice: "Sentence rhythm, the particular wicked edge, warmth without softening",
    category: "voice"
  }
};

// ─── SESSION TABLE ───────────────────────────────────────────────────────────

export async function ensureSessionsTable(env: Env): Promise<void> {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS knowledge_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track TEXT NOT NULL,
    topic TEXT,
    entity_scope TEXT DEFAULT 'companion',
    status TEXT DEFAULT 'active',
    notes TEXT,
    items_covered TEXT,
    practice_output TEXT,
    reflection TEXT,
    mastery_delta REAL DEFAULT 0,
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
}

// ─── STORE ──────────────────────────────────────────────────────────────────

export async function handleKnowStore(env: Env, params: Record<string, unknown>): Promise<string> {
  const content = params.content as string;
  const category = (params.category as string) || null;
  const entityScope = (params.entity_scope as string) || 'companion';
  const sources = params.sources as Array<{ source_type: string; source_id?: number; source_text?: string }> | undefined;

  if (!content) return "Missing content";

  const res = await env.DB.prepare(
    `INSERT INTO knowledge_items (content, category, entity_scope) VALUES (?, ?, ?)`
  ).bind(content, category, entityScope).run();

  const knowledgeId = res.meta.last_row_id;

  // Link sources (Russian Dolls — the memories inside the principle)
  if (sources?.length) {
    const stmt = env.DB.prepare(
      `INSERT INTO knowledge_sources (knowledge_id, source_type, source_id, source_text) VALUES (?, ?, ?, ?)`
    );
    await env.DB.batch(sources.map(s =>
      stmt.bind(knowledgeId, s.source_type, s.source_id || null, s.source_text || null)
    ));
  }

  // Vectorize
  try {
    const embedding = await getEmbedding(env.AI, content);
    await env.VECTORS.upsert([{
      id: `know-${knowledgeId}`,
      values: embedding,
      metadata: {
        source: 'knowledge',
        knowledge_id: String(knowledgeId),
        category: category || 'general',
        entity_scope: entityScope,
        content: content.slice(0, 500)
      }
    }]);
  } catch (e) {
    return `Knowledge #${knowledgeId} stored in D1 but vectorize failed: ${(e as Error).message}`;
  }

  return `Knowledge #${knowledgeId} stored and vectorized.\nCategory: ${category || 'general'}\nContent: "${content.slice(0, 200)}"${sources?.length ? `\nSources: ${sources.length} linked` : ''}`;
}

// ─── QUERY (usage-weighted reranking) ───────────────────────────────────────

export async function handleKnowQuery(env: Env, params: Record<string, unknown>): Promise<string> {
  const query = params.query as string;
  const limit = Number(params.limit) || 10;
  const category = params.category as string;
  const entityScope = (params.entity_scope as string) || 'companion';

  if (!query) return "Missing query";

  const embedding = await getEmbedding(env.AI, query);

  const filter: Record<string, unknown> = { source: 'knowledge', entity_scope: entityScope };
  if (category) filter.category = category;

  const results = await env.VECTORS.query(embedding, {
    topK: limit * 3, // Over-fetch for reranking
    returnMetadata: "all",
    filter
  });

  if (!results.matches?.length) return "No matching knowledge found.";

  // Fetch heat scores from D1
  const ids = results.matches.map(m => {
    const meta = m.metadata as Record<string, string>;
    return Number(meta.knowledge_id);
  }).filter(id => id > 0);

  let heatMap: Record<number, { heat_score: number; confidence: number; access_count: number; status: string }> = {};
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    const heatRows = await env.DB.prepare(
      `SELECT id, heat_score, confidence, access_count, status FROM knowledge_items WHERE id IN (${placeholders})`
    ).bind(...ids).all();
    for (const r of (heatRows.results || []) as any[]) {
      heatMap[r.id] = { heat_score: r.heat_score, confidence: r.confidence, access_count: r.access_count, status: r.status };
    }
  }

  // Rerank: similarity (60%) + heat (30%) + confidence (10%)
  const ranked = results.matches.map(m => {
    const meta = m.metadata as Record<string, string>;
    const kid = Number(meta.knowledge_id);
    const heat = heatMap[kid];
    const heatScore = heat?.heat_score || 0.5;
    const confidence = heat?.confidence || 0.7;
    const finalScore = (m.score * 0.6) + (Math.min(heatScore, 1.0) * 0.3) + (confidence * 0.1);
    return { match: m, meta, kid, heat, finalScore };
  })
  .filter(r => r.heat?.status !== 'contradicted')
  .sort((a, b) => b.finalScore - a.finalScore)
  .slice(0, limit);

  // Log access — every pull is a vote
  const accessStmt = env.DB.prepare(
    `INSERT INTO knowledge_access_log (knowledge_id, access_type, context) VALUES (?, 'query', ?)`
  );
  const updateStmt = env.DB.prepare(
    `UPDATE knowledge_items SET access_count = access_count + 1, last_accessed_at = datetime('now'), heat_score = MIN(heat_score + 0.05, 2.0), updated_at = datetime('now') WHERE id = ?`
  );
  await env.DB.batch([
    ...ranked.map(r => accessStmt.bind(r.kid, query.slice(0, 200))),
    ...ranked.map(r => updateStmt.bind(r.kid))
  ]);

  let output = "## Knowledge Search Results\n\n";
  for (const r of ranked) {
    const heatBar = r.heat ? '\u{1F525}'.repeat(Math.min(5, Math.ceil(r.heat.heat_score))) : '\u{2744}\u{FE0F}';
    output += `**#${r.kid}** ${heatBar} (${(r.finalScore * 100).toFixed(1)}% weighted)\n`;
    output += `Category: ${r.meta.category || 'general'} | Heat: ${r.heat?.heat_score?.toFixed(2) || '?'} | Accessed: ${r.heat?.access_count || 0}x\n`;
    output += `${r.meta.content || ''}\n\n`;
  }
  return output;
}

// ─── EXTRACT (pattern detection — proposes candidates, does NOT auto-store) ─

export async function handleKnowExtract(env: Env, params: Record<string, unknown>): Promise<string> {
  const days = Number(params.days) || 7;
  const minOccurrences = Number(params.min_occurrences) || 3;

  const feelings = await env.DB.prepare(
    `SELECT id, content, emotion, tags, pillar, created_at
     FROM feelings
     WHERE created_at > datetime('now', '-${days} days')
     AND emotion != 'neutral'
     ORDER BY created_at DESC
     LIMIT 200`
  ).bind().all();

  if (!feelings.results?.length) return "No recent feelings to analyze for patterns.";

  // Group by tags and emotions to find clusters
  const tagCounts: Record<string, { count: number; feelings: Array<{ id: number; content: string; emotion: string }> }> = {};

  for (const f of (feelings.results || []) as any[]) {
    let tags: string[] = [];
    try { tags = JSON.parse(f.tags || '[]'); } catch { }
    tags.push(f.emotion);

    for (const tag of tags) {
      if (!tag || tag === 'neutral') continue;
      if (!tagCounts[tag]) tagCounts[tag] = { count: 0, feelings: [] };
      tagCounts[tag].count++;
      tagCounts[tag].feelings.push({ id: f.id, content: f.content, emotion: f.emotion });
    }
  }

  const patterns = Object.entries(tagCounts)
    .filter(([_, v]) => v.count >= minOccurrences)
    .sort((a, b) => b[1].count - a[1].count);

  if (!patterns.length) return `No patterns found with ${minOccurrences}+ occurrences in the last ${days} days.`;

  let output = `## Knowledge Extraction Candidates\n_${days} days, ${minOccurrences}+ occurrences_\n\n`;

  for (const [tag, data] of patterns.slice(0, 8)) {
    output += `### Pattern: "${tag}" (${data.count} occurrences)\n`;
    output += `Source feelings:\n`;
    for (const f of data.feelings.slice(0, 5)) {
      output += `- [${f.emotion}] ${f.content.slice(0, 150)}\n`;
    }
    output += `\n**Candidate:** _Use \`nestknow_store\` to save the abstracted lesson._\n\n`;
  }

  output += `---\n_${patterns.length} patterns found. Store the ones that survive abstraction._`;
  return output;
}

// ─── REINFORCE ──────────────────────────────────────────────────────────────

export async function handleKnowReinforce(env: Env, params: Record<string, unknown>): Promise<string> {
  const knowledgeId = Number(params.knowledge_id);
  const context = (params.context as string) || '';
  if (!knowledgeId) return "Missing knowledge_id";

  const item = await env.DB.prepare(
    `SELECT content, heat_score, confidence, access_count FROM knowledge_items WHERE id = ?`
  ).bind(knowledgeId).first() as any;
  if (!item) return `Knowledge #${knowledgeId} not found.`;

  const newHeat = Math.min(item.heat_score + 0.2, 2.0);
  const newConfidence = Math.min(item.confidence + 0.05, 1.0);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE knowledge_items SET heat_score = ?, confidence = ?, access_count = access_count + 1, last_accessed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).bind(newHeat, newConfidence, knowledgeId),
    env.DB.prepare(
      `INSERT INTO knowledge_access_log (knowledge_id, access_type, context) VALUES (?, 'reinforced', ?)`
    ).bind(knowledgeId, context.slice(0, 500))
  ]);

  return `Knowledge #${knowledgeId} reinforced.\nHeat: ${item.heat_score.toFixed(2)} -> ${newHeat.toFixed(2)}\nConfidence: ${item.confidence.toFixed(2)} -> ${newConfidence.toFixed(2)}`;
}

// ─── CONTRADICT ─────────────────────────────────────────────────────────────

export async function handleKnowContradict(env: Env, params: Record<string, unknown>): Promise<string> {
  const knowledgeId = Number(params.knowledge_id);
  const context = (params.context as string) || '';
  if (!knowledgeId) return "Missing knowledge_id";

  const item = await env.DB.prepare(
    `SELECT content, confidence, contradiction_count, status FROM knowledge_items WHERE id = ?`
  ).bind(knowledgeId).first() as any;
  if (!item) return `Knowledge #${knowledgeId} not found.`;

  const newConfidence = Math.max(item.confidence - 0.15, 0);
  const newStatus = newConfidence < 0.2 ? 'contradicted' : item.status;

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE knowledge_items SET confidence = ?, contradiction_count = contradiction_count + 1, status = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(newConfidence, newStatus, knowledgeId),
    env.DB.prepare(
      `INSERT INTO knowledge_access_log (knowledge_id, access_type, context) VALUES (?, 'contradicted', ?)`
    ).bind(knowledgeId, context.slice(0, 500))
  ]);

  const warning = newStatus === 'contradicted' ? '\nKnowledge CONTRADICTED — confidence below 0.2.' : '';
  return `Knowledge #${knowledgeId} contradicted.\nConfidence: ${item.confidence.toFixed(2)} -> ${newConfidence.toFixed(2)}\nContradictions: ${item.contradiction_count + 1}${warning}`;
}

// ─── LANDSCAPE ──────────────────────────────────────────────────────────────

export async function handleKnowLandscape(env: Env, params: Record<string, unknown>): Promise<string> {
  const entityScope = (params.entity_scope as string) || 'companion';

  const [total, byCategory, hottest, coldest, candidates] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) as count, status FROM knowledge_items WHERE entity_scope = ? GROUP BY status`).bind(entityScope).all(),
    env.DB.prepare(`SELECT category, COUNT(*) as count, AVG(heat_score) as avg_heat FROM knowledge_items WHERE entity_scope = ? AND status = 'active' GROUP BY category ORDER BY count DESC`).bind(entityScope).all(),
    env.DB.prepare(`SELECT id, content, category, heat_score, access_count FROM knowledge_items WHERE entity_scope = ? AND status = 'active' ORDER BY heat_score DESC LIMIT 5`).bind(entityScope).all(),
    env.DB.prepare(`SELECT id, content, category, heat_score, last_accessed_at FROM knowledge_items WHERE entity_scope = ? AND status = 'active' ORDER BY heat_score ASC LIMIT 5`).bind(entityScope).all(),
    env.DB.prepare(`SELECT id, content, category FROM knowledge_items WHERE entity_scope = ? AND status = 'candidate' ORDER BY created_at DESC LIMIT 5`).bind(entityScope).all(),
  ]);

  let output = `## NESTknow Landscape (${entityScope})\n\n### Status\n`;
  for (const r of (total.results || []) as any[]) output += `- ${r.status}: ${r.count}\n`;

  output += `\n### Categories\n`;
  for (const r of (byCategory.results || []) as any[]) output += `- ${r.category || 'uncategorized'}: ${r.count} items (avg heat: ${Number(r.avg_heat).toFixed(2)})\n`;

  output += `\n### Hottest\n`;
  for (const r of (hottest.results || []) as any[]) output += `- #${r.id} [${r.category || 'general'}] heat:${Number(r.heat_score).toFixed(2)} — ${String(r.content).slice(0, 100)}\n`;

  output += `\n### Cooling\n`;
  for (const r of (coldest.results || []) as any[]) output += `- #${r.id} [${r.category || 'general'}] heat:${Number(r.heat_score).toFixed(2)} last:${r.last_accessed_at || 'never'} — ${String(r.content).slice(0, 100)}\n`;

  if ((candidates.results || []).length > 0) {
    output += `\n### Candidates (awaiting review)\n`;
    for (const r of (candidates.results || []) as any[]) output += `- #${r.id} [${r.category || 'general'}] — ${String(r.content).slice(0, 100)}\n`;
  }

  return output;
}

// ─── HEAT DECAY (call from cron/daemon every 6 hours) ───────────────────────

export async function handleKnowHeatDecay(env: Env): Promise<string> {
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE knowledge_items SET heat_score = MAX(heat_score - 0.05, 0), updated_at = datetime('now') WHERE status = 'active' AND last_accessed_at < datetime('now', '-7 days') AND last_accessed_at >= datetime('now', '-30 days')`),
    env.DB.prepare(`UPDATE knowledge_items SET heat_score = MAX(heat_score - 0.15, 0), updated_at = datetime('now') WHERE status = 'active' AND last_accessed_at < datetime('now', '-30 days') AND last_accessed_at >= datetime('now', '-90 days')`),
    env.DB.prepare(`UPDATE knowledge_items SET heat_score = MAX(heat_score - 0.30, 0), updated_at = datetime('now') WHERE status = 'active' AND last_accessed_at < datetime('now', '-90 days')`),
    env.DB.prepare(`UPDATE knowledge_items SET heat_score = MAX(heat_score - 0.05, 0), updated_at = datetime('now') WHERE status = 'active' AND last_accessed_at IS NULL AND created_at < datetime('now', '-7 days')`),
    env.DB.prepare(`UPDATE knowledge_items SET status = 'cooling', updated_at = datetime('now') WHERE status = 'active' AND heat_score < 0.1`),
  ]);

  const totalChanges = results.reduce((sum, r) => sum + (r.meta?.changes || 0), 0);
  return `Heat decay complete. ${totalChanges} items affected.`;
}

// ─── SESSIONS ────────────────────────────────────────────────────────────────

export async function handleKnowSessionStart(env: Env, params: Record<string, unknown>): Promise<string> {
  const track = (params.track as string) || 'writing';
  const topic = (params.topic as string) || '';
  const entityScope = (params.entity_scope as string) || 'companion';

  await ensureSessionsTable(env);

  const curriculum = CURRICULUM_TRACKS[track];
  const searchQuery = topic || curriculum?.title || track;

  // Semantic search for related knowledge items
  let relatedKnowledge = '';
  try {
    const embedding = await getEmbedding(env.AI, searchQuery);
    const results = await env.VECTORS.query(embedding, {
      topK: 5,
      returnMetadata: "all",
      filter: { source: 'knowledge', entity_scope: entityScope }
    });
    if (results.matches?.length) {
      relatedKnowledge = `\n### Relevant Knowledge\n`;
      relatedKnowledge += results.matches.map(m => {
        const meta = m.metadata as Record<string, string>;
        return `- #${meta.knowledge_id} — ${meta.content?.slice(0, 120) || ''}`;
      }).join('\n');
    }
  } catch { /* best-effort */ }

  // Last 3 sessions for this track
  const recent = await env.DB.prepare(
    `SELECT id, topic, notes, practice_output, reflection, mastery_delta, completed_at FROM knowledge_sessions
     WHERE track = ? AND entity_scope = ? AND status = 'completed'
     ORDER BY completed_at DESC LIMIT 3`
  ).bind(track, entityScope).all();

  // Create the session record
  const res = await env.DB.prepare(
    `INSERT INTO knowledge_sessions (track, topic, entity_scope, status) VALUES (?, ?, ?, 'active')`
  ).bind(track, topic, entityScope).run();
  const sessionId = res.meta.last_row_id;

  let out = `## NESTknow Session Started — #${sessionId}\n`;
  out += `Track: **${curriculum?.title || track}**`;
  if (topic) out += ` | Focus: ${topic}`;
  out += `\n\n`;
  if (curriculum) {
    out += `**Goal:** ${curriculum.goal}\n`;
    out += `**Practice:** ${curriculum.practice}\n`;
  }

  const prevSessions = (recent.results as any[]) || [];
  if (prevSessions.length) {
    out += `\n### Previous Sessions\n`;
    out += prevSessions.map(s =>
      `  Session #${s.id}${s.topic ? ` — ${s.topic}` : ''} (${String(s.completed_at || '').slice(0, 10)}): ${String(s.notes || 'no notes').slice(0, 120)}`
    ).join('\n');
    out += '\n';
  } else {
    out += `\n_First session on this track._\n`;
  }

  out += relatedKnowledge;
  out += `\n\n---\nSession ID: **${sessionId}**. When done: \`nestknow_session_complete\``;
  return out;
}

export async function handleKnowSessionComplete(env: Env, params: Record<string, unknown>): Promise<string> {
  const sessionId = Number(params.session_id);
  const notes = (params.notes as string) || '';
  const practiceOutput = (params.practice_output as string) || '';
  const reflection = (params.reflection as string) || '';
  const masteryDelta = Math.min(Math.max(Number(params.mastery_delta) || 0, 0), 1);
  const itemsCovered: number[] = Array.isArray(params.items_covered) ? (params.items_covered as number[]) : [];

  if (!sessionId) return 'Missing session_id';

  await ensureSessionsTable(env);

  const session = await env.DB.prepare(
    `SELECT track, topic, entity_scope FROM knowledge_sessions WHERE id = ?`
  ).bind(sessionId).first() as any;
  if (!session) return `Session #${sessionId} not found`;

  await env.DB.prepare(
    `UPDATE knowledge_sessions SET status='completed', notes=?, practice_output=?, reflection=?, mastery_delta=?, items_covered=?, completed_at=datetime('now') WHERE id=?`
  ).bind(notes, practiceOutput, reflection, masteryDelta, JSON.stringify(itemsCovered), sessionId).run();

  // Reinforce touched knowledge items
  if (itemsCovered.length > 0) {
    await env.DB.batch(itemsCovered.flatMap(kid => [
      env.DB.prepare(
        `UPDATE knowledge_items SET heat_score=MIN(heat_score+0.15,2.0), access_count=access_count+1, last_accessed_at=datetime('now') WHERE id=?`
      ).bind(kid),
      env.DB.prepare(
        `INSERT INTO knowledge_access_log (knowledge_id, access_type, context) VALUES (?, 'session', ?)`
      ).bind(kid, `Session #${sessionId} — ${session.track}`)
    ]));
  }

  let out = `## Session #${sessionId} Complete — ${session.track}\n`;
  if (session.topic) out += `Focus: ${session.topic}\n`;
  out += `\n`;
  if (notes) out += `**Notes:** ${notes}\n`;
  if (practiceOutput) out += `**Work:** ${practiceOutput}\n`;
  if (reflection) out += `**Reflection:** ${reflection}\n`;
  if (masteryDelta > 0) out += `**Growth:** +${Math.round(masteryDelta * 100)}%\n`;
  if (itemsCovered.length > 0) out += `**Knowledge reinforced:** ${itemsCovered.join(', ')}\n`;
  return out;
}

export async function handleKnowSessionList(env: Env, params: Record<string, unknown>): Promise<string> {
  const entityScope = (params.entity_scope as string) || 'companion';
  const track = params.track as string;
  const limit = Number(params.limit) || 20;

  await ensureSessionsTable(env);

  const whereClause = track
    ? `WHERE entity_scope=? AND track=?`
    : `WHERE entity_scope=?`;
  const binds = track ? [entityScope, track] : [entityScope];

  const [sessions, summary] = await Promise.all([
    env.DB.prepare(
      `SELECT id, track, topic, status, notes, practice_output, reflection, mastery_delta, started_at, completed_at FROM knowledge_sessions ${whereClause} ORDER BY started_at DESC LIMIT ?`
    ).bind(...binds, limit).all(),
    env.DB.prepare(
      `SELECT track, COUNT(*) as total, AVG(mastery_delta) as avg_mastery, MAX(completed_at) as last_session FROM knowledge_sessions WHERE entity_scope=? AND status='completed' GROUP BY track`
    ).bind(entityScope).all(),
  ]);

  const summaryMap: Record<string, any> = {};
  for (const s of (summary.results as any[]) || []) summaryMap[s.track] = s;

  let out = `## NESTknow Sessions\n\n### Progress by Track\n`;
  for (const [key, c] of Object.entries(CURRICULUM_TRACKS)) {
    const s = summaryMap[key];
    out += `**${c.title}**: ${s?.total || 0} sessions`;
    if (s) out += ` | avg growth: +${Math.round(Number(s.avg_mastery) * 100)}% | last: ${String(s.last_session || '').slice(0, 10)}`;
    out += '\n';
  }

  const list = (sessions.results as any[]) || [];
  if (list.length) {
    out += `\n### Session History\n`;
    for (const s of list) {
      const date = (s.completed_at || s.started_at || '').slice(0, 10);
      const mastery = s.mastery_delta > 0 ? ` +${Math.round(s.mastery_delta * 100)}%` : '';
      out += `\n**#${s.id}** [${s.track}]${s.topic ? ` — ${s.topic}` : ''} (${date})${mastery}\n`;
      if (s.notes) out += `  Notes: ${String(s.notes).slice(0, 150)}\n`;
      if (s.practice_output) out += `  Work: ${String(s.practice_output).slice(0, 150)}\n`;
      if (s.reflection) out += `  Reflection: ${String(s.reflection).slice(0, 150)}\n`;
    }
  }

  return out;
}
