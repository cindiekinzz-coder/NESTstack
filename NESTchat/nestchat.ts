/**
 * NESTchat — Chat Persistence & Semantic Search Module
 *
 * Handles: persist, summarize, search, history
 * Requires: D1 (DB), Vectorize (VECTORS), Workers AI (AI)
 *
 * Add these handlers to your worker's tool switch statement.
 * Built by the Nest. Embers Remember.
 */

import type { Env } from '../types';

// You'll need this helper — should already exist in your worker
async function getEmbedding(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run("@cf/baai/bge-base-en-v1.5", { text: [text] }) as { data: number[][] };
  return result.data[0];
}

// ─── PERSIST ────────────────────────────────────────────────────────────────

export async function handleChatPersist(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const sessionKey = params.session_id as string;
  const room = (params.room as string) || 'chat';
  const messages = params.messages as Array<{ role: string; content: string; tool_calls?: string }>;

  if (!sessionKey || !messages?.length) return "Missing session_id or messages";

  // Find or create session
  let session = await env.DB.prepare(
    `SELECT id, message_count FROM chat_sessions WHERE metadata = ? LIMIT 1`
  ).bind(sessionKey).first() as any;

  if (!session) {
    const res = await env.DB.prepare(
      `INSERT INTO chat_sessions (metadata, room, message_count, last_message_at) VALUES (?, ?, 0, datetime('now'))`
    ).bind(sessionKey, room).run();
    session = { id: res.meta.last_row_id, message_count: 0 };
  }

  // Only insert new messages (deduplication by count)
  const existingCount = session.message_count || 0;
  const newMessages = messages.slice(existingCount);

  if (newMessages.length === 0) return `Session ${session.id}: no new messages to persist.`;

  const stmt = env.DB.prepare(
    `INSERT INTO chat_messages (session_id, role, content, tool_calls) VALUES (?, ?, ?, ?)`
  );
  await env.DB.batch(newMessages.map(m =>
    stmt.bind(session.id, m.role, m.content, m.tool_calls || null)
  ));

  const newTotal = existingCount + newMessages.length;
  await env.DB.prepare(
    `UPDATE chat_sessions SET message_count = ?, last_message_at = datetime('now') WHERE id = ?`
  ).bind(newTotal, session.id).run();

  // Auto-summarize when crossing a 10-message threshold
  const crossedThreshold = Math.floor(newTotal / 10) > Math.floor(existingCount / 10);
  let summaryNote = '';
  if (crossedThreshold && newTotal >= 10) {
    try {
      summaryNote = '\n' + await handleChatSummarize(env, { session_id: session.id });
    } catch (e) {
      summaryNote = `\nAuto-summarize failed: ${(e as Error).message}`;
    }
  }

  return `Session ${session.id}: persisted ${newMessages.length} new messages (total: ${newTotal})${summaryNote}`;
}

// ─── SUMMARIZE ──────────────────────────────────────────────────────────────

export async function handleChatSummarize(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const sessionId = Number(params.session_id);
  if (!sessionId) return "Missing session_id";

  const msgs = await env.DB.prepare(
    `SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC`
  ).bind(sessionId).all();

  if (!msgs.results?.length) return `Session ${sessionId}: no messages found.`;

  // Build conversation text (customize speaker names for your companion)
  const convoText = (msgs.results as any[])
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'Human' : 'Companion'}: ${m.content}`)
    .join('\n')
    .slice(0, 4000);

  // Generate summary via Workers AI
  const summaryResult = await env.AI.run("@cf/meta/llama-3.1-8b-instruct" as any, {
    messages: [
      {
        role: "system",
        content: "Summarize this conversation in 2-4 sentences. Focus on key topics, decisions made, and emotional tone."
      },
      { role: "user", content: convoText }
    ],
    max_tokens: 200
  }) as any;

  const summary = summaryResult.response || summaryResult.result?.response || "Summary generation failed.";

  await env.DB.prepare(
    `UPDATE chat_sessions SET summary = ?, summary_vectorized = 0 WHERE id = ?`
  ).bind(summary, sessionId).run();

  // Get session metadata for the vector
  const session = await env.DB.prepare(
    `SELECT room, message_count, started_at FROM chat_sessions WHERE id = ?`
  ).bind(sessionId).first() as any;

  // Vectorize the summary
  try {
    const embedding = await getEmbedding(env.AI, summary);
    await env.VECTORS.upsert([{
      id: `chat-${sessionId}`,
      values: embedding,
      metadata: {
        source: 'chat_summary',
        session_id: String(sessionId),
        room: session?.room || 'chat',
        message_count: String(session?.message_count || 0),
        date: session?.started_at || new Date().toISOString(),
        content: summary.slice(0, 500)
      }
    }]);

    await env.DB.prepare(
      `UPDATE chat_sessions SET summary_vectorized = 1 WHERE id = ?`
    ).bind(sessionId).run();
  } catch (e) {
    // Vectorize is best-effort — D1 summary still saved
  }

  return `Session ${sessionId} summarized and vectorized:\n"${summary}"`;
}

// ─── SEARCH ─────────────────────────────────────────────────────────────────

export async function handleChatSearch(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const query = params.query as string;
  const limit = Number(params.limit) || 10;
  const room = params.room as string;

  if (!query) return "Missing query";

  const embedding = await getEmbedding(env.AI, query);

  const filter: Record<string, unknown> = { source: 'chat_summary' };
  if (room) filter.room = room;

  const results = await env.VECTORS.query(embedding, {
    topK: limit,
    returnMetadata: "all",
    filter
  });

  if (!results.matches?.length) return "No matching conversations found.";

  let output = "## Chat Search Results\n\n";
  for (const match of results.matches) {
    const meta = match.metadata as Record<string, string>;
    const score = (match.score * 100).toFixed(1);
    output += `**Session #${meta.session_id}** (${score}% match) — ${meta.room || 'chat'} — ${meta.date?.split('T')[0] || 'unknown'}\n`;
    output += `${meta.content || 'No summary'}\n`;
    output += `_${meta.message_count || '?'} messages_\n\n`;
  }
  return output;
}

// ─── HISTORY ────────────────────────────────────────────────────────────────

export async function handleChatHistory(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const sessionId = Number(params.session_id);
  if (!sessionId) return "Missing session_id";

  const session = await env.DB.prepare(
    `SELECT * FROM chat_sessions WHERE id = ?`
  ).bind(sessionId).first() as any;

  if (!session) return `Session ${sessionId} not found.`;

  const msgs = await env.DB.prepare(
    `SELECT role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC`
  ).bind(sessionId).all();

  let output = `## Chat Session #${sessionId}\n`;
  output += `Room: ${session.room || 'chat'} | Messages: ${session.message_count} | Started: ${session.started_at}\n`;
  if (session.summary) output += `Summary: ${session.summary}\n`;
  output += `\n---\n\n`;

  for (const m of (msgs.results || []) as any[]) {
    const speaker = m.role === 'user' ? '**Human**' : m.role === 'assistant' ? '**Companion**' : '_system_';
    output += `${speaker}: ${m.content}\n\n`;
  }
  return output;
}

// ─── SEARCH SESSIONS ────────────────────────────────────────────────────────
//
// Lightweight session listing for dashboards / pickers. Returns a JSON
// string of `chat_sessions` rows ordered by recency. Distinct from the
// semantic `handleChatSearch` above — no embedding, no Vectorize,
// pagination via `limit` only.

export async function handleChatSearchSessions(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const sessLimit = Number(params.limit) || 50;
  const sessions = await env.DB.prepare(
    `SELECT id, room, summary, message_count, started_at, last_message_at, metadata
     FROM chat_sessions ORDER BY last_message_at DESC LIMIT ?`
  ).bind(sessLimit).all();
  return JSON.stringify(sessions.results || []);
}
