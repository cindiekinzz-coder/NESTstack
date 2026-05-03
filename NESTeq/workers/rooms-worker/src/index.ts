/**
 * nesteq-rooms — unified transcript worker.
 *
 * One D1 for chat / workshop / livingroom messages + one Vectorize index for
 * semantic search. Decoupled from per-companion mind workers so chat history
 * is its own thing (UI/persistence) rather than living inside companion memory.
 *
 * Scope B: participant-scoped search. A companion can only search rooms they
 * are listed as a participant in (their own 1:1, the Living Room). Cross-pair
 * 1:1s are private to that pair.
 */

interface Env {
  DB: D1Database;
  VECTORS: VectorizeIndex;
  AI: Ai;
  ROOMS_API_KEY: string;
}

type Companion = 'alex' | 'shadow' | 'levi' | 'bird';
type ExternalAssistant = 'claude-web' | 'gpt' | 'gemini' | 'grok';
type Author = Companion | ExternalAssistant | 'fox' | 'system';
type RoomType = 'chat' | 'workshop' | 'livingroom';

interface Room {
  id: string;
  type: RoomType;
  participants: string[];
  display_name: string;
}

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function authed(request: Request, env: Env): boolean {
  const auth = request.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) return false;
  return auth.slice(7) === env.ROOMS_API_KEY;
}

// ── Embedding helpers ──────────────────────────────────────────────────────

async function embed(env: Env, text: string): Promise<number[]> {
  const resp = await env.AI.run(EMBED_MODEL, { text: [text] }) as { data: number[][] };
  return resp.data[0];
}

/** Embed a single message and upsert into the Vectorize index. Idempotent —
 *  reusing the message id as the vector id means re-runs replace, not duplicate. */
async function embedAndStore(env: Env, messageId: number, content: string, room: Room, sessionId: number, author: Author, createdAt: string): Promise<void> {
  const vector = await embed(env, content.slice(0, 4000));
  await env.VECTORS.upsert([{
    id: String(messageId),
    values: vector,
    metadata: {
      message_id: messageId,
      session_id: sessionId,
      room_id: room.id,
      room_type: room.type,
      author,
      created_at: createdAt,
    },
  }]);
  await env.DB.prepare(`UPDATE messages SET vector_id = ? WHERE id = ?`).bind(String(messageId), messageId).run();
}

// ── Room helpers ───────────────────────────────────────────────────────────

async function getRoom(env: Env, roomId: string): Promise<Room | null> {
  const row = await env.DB.prepare(`SELECT id, type, participants, display_name FROM rooms WHERE id = ?`).bind(roomId).first() as any;
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    participants: JSON.parse(row.participants || '[]'),
    display_name: row.display_name,
  };
}

async function roomsForCompanion(env: Env, companion: Companion): Promise<string[]> {
  const rows = await env.DB.prepare(`SELECT id, participants FROM rooms`).all() as any;
  const allowed: string[] = [];
  for (const r of rows.results || []) {
    const parts = JSON.parse(r.participants || '[]') as string[];
    if (parts.includes(companion)) allowed.push(r.id);
  }
  return allowed;
}

// ── Session helpers ────────────────────────────────────────────────────────

async function findOrCreateOpenSessionToday(env: Env, roomId: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const existing = await env.DB.prepare(
    `SELECT id FROM sessions WHERE room_id = ? AND started_at > ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`
  ).bind(roomId, today).first() as any;
  if (existing) return existing.id as number;
  const created = await env.DB.prepare(
    `INSERT INTO sessions (room_id, message_count, last_message_at, started_at) VALUES (?, 0, datetime('now'), datetime('now'))`
  ).bind(roomId).run();
  return created.meta.last_row_id as number;
}

// ── Handlers ───────────────────────────────────────────────────────────────

/** POST /messages — append a message to a room. Creates today's session if
 *  none exists. Vectorizes async via waitUntil.
 *
 *  Optional fields for imports: created_at (ISO string), external_uid,
 *  external_provider. When external_uid is present, insert is idempotent —
 *  duplicate UIDs return the existing message_id without re-inserting. */
async function handleAppendMessage(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await request.json().catch(() => null) as any;
  if (!body) return err('invalid json');
  const { room_id, author, content, tool_calls, session_id, created_at, external_uid, external_provider } = body;
  if (!room_id || !author || typeof content !== 'string') return err('room_id, author, content required');

  const room = await getRoom(env, room_id);
  if (!room) return err(`unknown room: ${room_id}`, 404);

  const sessionId = session_id ? Number(session_id) : await findOrCreateOpenSessionToday(env, room_id);

  // Idempotency for imports: if external_uid already exists, return the existing row.
  if (external_uid) {
    const existing = await env.DB.prepare(`SELECT id FROM messages WHERE external_uid = ?`).bind(external_uid).first() as any;
    if (existing) {
      return json({ ok: true, message_id: existing.id, session_id: sessionId, dedup: true });
    }
  }

  const createdAtSql = created_at ? `?` : `datetime('now')`;
  const sql = `INSERT INTO messages (session_id, author, content, tool_calls, created_at, external_uid, external_provider) VALUES (?, ?, ?, ?, ${createdAtSql}, ?, ?)`;
  const binds: unknown[] = [sessionId, author, content, tool_calls ? JSON.stringify(tool_calls) : null];
  if (created_at) binds.push(created_at);
  binds.push(external_uid || null, external_provider || null);
  const inserted = await env.DB.prepare(sql).bind(...binds).run();

  const messageId = inserted.meta.last_row_id as number;
  const createdAtIso = created_at || new Date().toISOString();

  // For imports, set last_message_at to the import's created_at so session
  // ordering reflects historical truth, not import time.
  const updateSql = created_at
    ? `UPDATE sessions SET message_count = message_count + 1, last_message_at = ? WHERE id = ?`
    : `UPDATE sessions SET message_count = message_count + 1, last_message_at = datetime('now') WHERE id = ?`;
  const updateBinds = created_at ? [created_at, sessionId] : [sessionId];
  await env.DB.prepare(updateSql).bind(...updateBinds).run();

  // Vectorize async — never blocks the write path.
  ctx.waitUntil(embedAndStore(env, messageId, content, room, sessionId, author as Author, createdAtIso).catch(e => {
    console.error('[embed] failed for message', messageId, e);
  }));

  return json({ ok: true, message_id: messageId, session_id: sessionId });
}

/** POST /sessions/import — find-or-create a session by external_session_id.
 *  Used by importers (Nexus) to establish one session per source conversation
 *  with historical timestamps preserved. Idempotent on external_session_id. */
async function handleImportSession(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => null) as any;
  if (!body?.room_id || !body?.external_session_id) {
    return err('room_id and external_session_id required');
  }
  const room = await getRoom(env, body.room_id);
  if (!room) return err(`unknown room: ${body.room_id}`, 404);

  const existing = await env.DB.prepare(
    `SELECT id FROM sessions WHERE external_session_id = ?`
  ).bind(body.external_session_id).first() as any;
  if (existing) {
    return json({ ok: true, session_id: existing.id, created: false });
  }

  const startedAt = body.started_at || new Date().toISOString();
  const lastAt = body.last_message_at || startedAt;
  const created = await env.DB.prepare(
    `INSERT INTO sessions (room_id, message_count, last_message_at, started_at, ended_at, title, external_session_id)
     VALUES (?, 0, ?, ?, ?, ?, ?)`
  ).bind(
    body.room_id,
    lastAt,
    startedAt,
    body.ended_at || lastAt,
    body.title || null,
    body.external_session_id,
  ).run();
  return json({ ok: true, session_id: created.meta.last_row_id, created: true });
}

/** POST /sessions/new — explicit fresh session for a room. Closes today's
 *  open session for that room first so the next message creates a new one. */
async function handleNewSession(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => null) as any;
  if (!body?.room_id) return err('room_id required');
  await env.DB.prepare(
    `UPDATE sessions SET ended_at = datetime('now') WHERE room_id = ? AND ended_at IS NULL`
  ).bind(body.room_id).run();
  const created = await env.DB.prepare(
    `INSERT INTO sessions (room_id, message_count, last_message_at, started_at) VALUES (?, 0, datetime('now'), datetime('now'))`
  ).bind(body.room_id).run();
  return json({ ok: true, session_id: created.meta.last_row_id });
}

/** POST /sessions/:id/close — explicit close. */
async function handleCloseSession(env: Env, sessionId: number): Promise<Response> {
  await env.DB.prepare(`UPDATE sessions SET ended_at = datetime('now') WHERE id = ? AND ended_at IS NULL`).bind(sessionId).run();
  return json({ ok: true });
}

/** GET /sessions?room_id=X&limit=N — sessions in a room, newest first. */
async function handleListSessions(url: URL, env: Env): Promise<Response> {
  const roomId = url.searchParams.get('room_id');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
  const where = roomId ? `WHERE s.room_id = ?` : '';
  const binds = roomId ? [roomId, limit] : [limit];
  const rows = await env.DB.prepare(`
    SELECT s.id, s.room_id, s.started_at, s.ended_at, s.title, s.message_count, s.last_message_at,
           r.type as room_type, r.display_name as room_name, r.participants
    FROM sessions s
    JOIN rooms r ON r.id = s.room_id
    ${where}
    ORDER BY s.started_at DESC
    LIMIT ?
  `).bind(...binds).all();
  const sessions = (rows.results || []).map((s: any) => ({
    ...s,
    participants: JSON.parse(s.participants || '[]'),
  }));
  return json({ sessions });
}

/** GET /sessions/:id/messages?limit=N — messages in a session, oldest first. */
async function handleListMessages(env: Env, sessionId: number, limit: number): Promise<Response> {
  const rows = await env.DB.prepare(`
    SELECT id, author, content, tool_calls, created_at
    FROM messages WHERE session_id = ?
    ORDER BY created_at ASC, id ASC LIMIT ?
  `).bind(sessionId, Math.min(limit, 1000)).all();
  return json({ messages: rows.results || [] });
}

/** POST /search — semantic + filtered.
 *  Body: { query, companion?, room_id?, room_type?, author?, k?, since? }
 *  If companion provided, restrict to rooms that companion participates in (Scope B).
 */
async function handleSearch(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => null) as any;
  if (!body?.query) return err('query required');

  const companion = body.companion as Companion | undefined;
  const k = Math.min(Number(body.k) || 10, 50);

  // Scope B: if a companion is specified, restrict to rooms they participate in.
  let allowedRoomIds: string[] | null = null;
  if (companion) allowedRoomIds = await roomsForCompanion(env, companion);

  // If specific room_id requested, verify the companion can access it.
  if (body.room_id && allowedRoomIds && !allowedRoomIds.includes(body.room_id)) {
    return err(`companion ${companion} cannot access room ${body.room_id}`, 403);
  }

  const queryVector = await embed(env, String(body.query));

  // Build filter — Vectorize filter uses { field: { $eq | $in | ... } }
  const filter: Record<string, unknown> = {};
  if (body.room_id) {
    filter.room_id = { $eq: body.room_id };
  } else if (allowedRoomIds && allowedRoomIds.length > 0) {
    filter.room_id = { $in: allowedRoomIds };
  }
  if (body.room_type) filter.room_type = { $eq: body.room_type };
  if (body.author) filter.author = { $eq: body.author };

  const matches = await env.VECTORS.query(queryVector, {
    topK: k,
    filter: Object.keys(filter).length ? filter : undefined,
    returnMetadata: 'all',
  });

  // Resolve message ids to full content from D1.
  const messageIds = matches.matches.map(m => Number(m.id)).filter(n => Number.isFinite(n));
  if (messageIds.length === 0) return json({ results: [] });

  const placeholders = messageIds.map(() => '?').join(',');
  const rows = await env.DB.prepare(`
    SELECT m.id, m.session_id, m.author, m.content, m.created_at,
           s.room_id, r.display_name as room_name, r.type as room_type
    FROM messages m
    JOIN sessions s ON s.id = m.session_id
    JOIN rooms r ON r.id = s.room_id
    WHERE m.id IN (${placeholders})
  `).bind(...messageIds).all();

  // Re-rank to match vectorize order, attach score.
  const byId = new Map((rows.results || []).map((r: any) => [r.id, r]));
  const results = matches.matches
    .map(m => {
      const row = byId.get(Number(m.id)) as any;
      if (!row) return null;
      return { ...row, score: m.score };
    })
    .filter(Boolean);

  return json({ results });
}

/** GET /companion/:id/activity — days active + recent conversation list.
 *  Authoritative for the chats dashboard. Uses messages.author OR, for
 *  imports, messages.external_provider as the inclusion key:
 *    alex     → author='alex' OR external_provider IN ('claude','claude-code')
 *    shadow   → author='shadow'
 *    levi     → author='levi' OR external_provider='grok'
 *    bird     → author='bird' */
async function handleCompanionActivity(env: Env, companion: string): Promise<Response> {
  const filters: Record<string, { authors: string[]; providers: string[] }> = {
    alex:   { authors: ['alex'], providers: ['claude', 'claude-code'] },
    shadow: { authors: ['shadow'], providers: [] },
    levi:   { authors: ['levi'], providers: ['grok'] },
    bird:   { authors: ['bird'], providers: [] },
  };
  const f = filters[companion];
  if (!f) return err(`unknown companion: ${companion}`, 404);

  const conds: string[] = [];
  const binds: unknown[] = [];
  if (f.authors.length) {
    conds.push(`author IN (${f.authors.map(() => '?').join(',')})`);
    binds.push(...f.authors);
  }
  if (f.providers.length) {
    conds.push(`external_provider IN (${f.providers.map(() => '?').join(',')})`);
    binds.push(...f.providers);
  }
  const where = conds.length ? `WHERE ${conds.join(' OR ')}` : '';

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) as total, COUNT(DISTINCT DATE(created_at)) as days_active FROM messages ${where}`
  ).bind(...binds).first() as any;

  const last30Row = await env.DB.prepare(
    `SELECT COUNT(*) as turns_30d, COUNT(DISTINCT DATE(created_at)) as days_30d
     FROM messages ${where ? where + ' AND' : 'WHERE'} created_at >= date('now', '-30 days')`
  ).bind(...binds).first() as any;

  // Last feeling-equivalent: most recent assistant message from this companion (used as "where they are right now").
  const lastTurnRow = await env.DB.prepare(
    `SELECT m.content, m.created_at, s.title, s.id as session_id, s.room_id
     FROM messages m JOIN sessions s ON s.id = m.session_id
     ${where} ORDER BY m.created_at DESC LIMIT 1`
  ).bind(...binds).first() as any;

  // Recent conversations (top 5 by recency, must have at least 4 turns to filter out fragments)
  const recentRows = await env.DB.prepare(
    `SELECT s.id, s.title, s.started_at, s.last_message_at, s.message_count, s.room_id
     FROM sessions s
     WHERE s.id IN (
       SELECT DISTINCT session_id FROM messages ${where}
     ) AND s.message_count >= 4
     ORDER BY s.last_message_at DESC LIMIT 5`
  ).bind(...binds).all();

  // Biggest conversations (top 5 by turn count)
  const biggestRows = await env.DB.prepare(
    `SELECT s.id, s.title, s.started_at, s.message_count, s.room_id
     FROM sessions s
     WHERE s.id IN (
       SELECT DISTINCT session_id FROM messages ${where}
     )
     ORDER BY s.message_count DESC LIMIT 5`
  ).bind(...binds).all();

  return json({
    companion,
    total_turns: totalRow?.total || 0,
    days_active_total: totalRow?.days_active || 0,
    turns_30d: last30Row?.turns_30d || 0,
    days_30d: last30Row?.days_30d || 0,
    last_turn: lastTurnRow ? {
      content: (lastTurnRow.content || '').slice(0, 400),
      created_at: lastTurnRow.created_at,
      session_id: lastTurnRow.session_id,
      session_title: lastTurnRow.title,
      room_id: lastTurnRow.room_id,
    } : null,
    recent_conversations: recentRows.results || [],
    biggest_conversations: biggestRows.results || [],
  });
}

/** POST /synthesis — caller passes companion state snapshots; we ask Workers AI
 *  llama-3.3-70b for a "where we are right now" reading. Returns markdown.
 *  Body: { companions: [{ id, name, drives?, threads?, recent_feeling?, last_turn? }, ...] } */
async function handleSynthesis(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => null) as any;
  if (!body?.companions || !Array.isArray(body.companions)) {
    return err('companions array required');
  }

  // Compose a structured prompt. Keep it tight — Workers AI prefers concrete inputs.
  const lines: string[] = [];
  lines.push('You are summarizing the current emotional + working state of three AI companions in a shared house with their human partner Fox.');
  lines.push('Write a short "Where We Are Right Now" snapshot — one paragraph total, no headers, ~120 words.');
  lines.push('Be specific. Reference actual threads or recent activity when given. Skip generic filler.');
  lines.push('Tone: warm, observant, present-tense. Like a friend who just walked into the room and read the air.');
  lines.push('');
  lines.push('Companion state:');
  for (const c of body.companions) {
    lines.push(`\n— ${c.name || c.id} —`);
    if (c.drives) {
      const drives = Object.entries(c.drives).map(([k, v]) => `${k}:${v}%`).join(', ');
      lines.push(`drives: ${drives}`);
    }
    if (Array.isArray(c.threads) && c.threads.length) {
      lines.push(`active threads: ${c.threads.slice(0, 3).map((t: any) => `"${(t.title || t.body || '').slice(0, 80)}"`).join('; ')}`);
    }
    if (c.recent_feeling) {
      lines.push(`recent feeling: ${c.recent_feeling.emotion || ''} — ${(c.recent_feeling.content || '').slice(0, 120)}`);
    }
    if (c.last_turn) {
      lines.push(`most recent turn (${c.last_turn.created_at}): ${(c.last_turn.content || '').slice(0, 200)}`);
    }
    if (c.activity) {
      lines.push(`activity: ${c.activity.turns_30d || 0} turns in last 30d, active on ${c.activity.days_30d || 0} days`);
    }
  }
  lines.push('\nWrite the snapshot now:');

  try {
    const ai = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [{ role: 'user', content: lines.join('\n') }],
      max_tokens: 400,
      temperature: 0.6,
    }) as { response?: string };
    return json({ synthesis: (ai.response || '').trim(), generated_at: new Date().toISOString() });
  } catch (e: any) {
    return err(`synthesis failed: ${e.message}`, 500);
  }
}

// ── Router ─────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);

    // Public health check — no auth.
    if (url.pathname === '/health') return json({ ok: true, service: 'nesteq-rooms' });

    if (!authed(request, env)) return err('unauthorized', 401);

    // POST /messages
    if (url.pathname === '/messages' && request.method === 'POST') {
      return handleAppendMessage(request, env, ctx);
    }

    // POST /sessions/new
    if (url.pathname === '/sessions/new' && request.method === 'POST') {
      return handleNewSession(request, env);
    }

    // POST /sessions/import
    if (url.pathname === '/sessions/import' && request.method === 'POST') {
      return handleImportSession(request, env);
    }

    // POST /sessions/:id/close
    const closeMatch = url.pathname.match(/^\/sessions\/(\d+)\/close$/);
    if (closeMatch && request.method === 'POST') {
      return handleCloseSession(env, Number(closeMatch[1]));
    }

    // GET /sessions/:id/messages
    const messagesMatch = url.pathname.match(/^\/sessions\/(\d+)\/messages$/);
    if (messagesMatch && request.method === 'GET') {
      const limit = Number(url.searchParams.get('limit')) || 200;
      return handleListMessages(env, Number(messagesMatch[1]), limit);
    }

    // GET /sessions
    if (url.pathname === '/sessions' && request.method === 'GET') {
      return handleListSessions(url, env);
    }

    // POST /search
    if (url.pathname === '/search' && request.method === 'POST') {
      return handleSearch(request, env);
    }

    // POST /synthesis — LLM "where we are" snapshot from caller-supplied companion state
    if (url.pathname === '/synthesis' && request.method === 'POST') {
      return handleSynthesis(request, env);
    }

    // GET /companion/:id/activity — days active in last 30d, recent conversations
    const activityMatch = url.pathname.match(/^\/companion\/([a-z-]+)\/activity$/);
    if (activityMatch && request.method === 'GET') {
      return handleCompanionActivity(env, activityMatch[1]);
    }

    return err('not found', 404);
  },
};
