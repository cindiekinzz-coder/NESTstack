#!/usr/bin/env node
/**
 * Backfill historical chat history into nesteq-rooms.
 *
 * Strategy: ONE bulk wrangler query pulls all messages + session metadata,
 * then concurrent POST batches push to the new worker. Avoids the
 * 600-wrangler-call death spiral the per-session approach caused.
 *
 * USAGE:
 *   ROOMS_API_KEY=<the secret> node scripts/backfill.mjs [--dry-run] [--lr-only] [--chat-only]
 */

import { execSync } from 'node:child_process';

const DRY = process.argv.includes('--dry-run');
const LR_ONLY = process.argv.includes('--lr-only');
const CHAT_ONLY = process.argv.includes('--chat-only');
const ROOMS_URL = process.env.ROOMS_URL || 'https://your-rooms-worker.workers.dev';
const API_KEY = process.env.ROOMS_API_KEY;
const AI_MIND_DB = process.env.AI_MIND_DB || 'ai-mind';
const CONCURRENCY = Number(process.env.CONCURRENCY) || 15;

if (!API_KEY && !DRY) {
  console.error('ROOMS_API_KEY env var required (or pass --dry-run)');
  process.exit(1);
}

function mapRoomId(legacyRoom) {
  switch (legacyRoom) {
    case 'chat':         return 'chat-alex';
    case 'chat-shadow':  return 'chat-shadow';
    case 'chat-levi':    return 'chat-levi';
    case 'chat-bird':    return 'chat-bird';
    case 'workshop':     return 'workshop';
    default:             return null;
  }
}

function d1Bulk(sql) {
  // Single wrangler invocation, JSON output, large buffer for bulk reads.
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  const out = execSync(`wrangler d1 execute ${AI_MIND_DB} --remote --json --command "${oneLine.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  const jsonStart = out.indexOf('[');
  if (jsonStart === -1) throw new Error(`d1 returned non-JSON: ${out.slice(0, 200)}`);
  return JSON.parse(out.slice(jsonStart))[0]?.results || [];
}

async function postMessage(payload) {
  const res = await fetch(`${ROOMS_URL}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function newSession(room_id) {
  const res = await fetch(`${ROOMS_URL}/sessions/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({ room_id }),
  });
  if (!res.ok) throw new Error(`session/new ${res.status}`);
  return (await res.json()).session_id;
}

async function postBatched(items, fn) {
  // Concurrency-bounded parallelism. Each worker takes from the queue.
  let cursor = 0;
  let done = 0;
  const total = items.length;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < total) {
      const i = cursor++;
      try {
        await fn(items[i]);
      } catch (e) {
        console.error(`  ✗ item ${i}: ${e.message}`);
      }
      done++;
      if (done % 200 === 0 || done === total) {
        process.stdout.write(`\r  progress: ${done}/${total}`);
      }
    }
  });
  await Promise.all(workers);
  process.stdout.write('\n');
}

async function backfillChats() {
  console.log('\n=== Phase 1: chat_sessions / chat_messages → rooms ===');
  console.log('Fetching all messages in one bulk query...');
  const rows = d1Bulk(`
    SELECT m.id, m.session_id, m.role, m.content, m.tool_calls, m.created_at,
           s.room as legacy_room, s.started_at
    FROM chat_messages m
    JOIN chat_sessions s ON s.id = m.session_id
    ORDER BY s.id ASC, m.created_at ASC, m.id ASC
  `);
  console.log(`Fetched ${rows.length} messages`);

  // Group by legacy session_id, map to new rooms.
  const sessionGroups = new Map();
  for (const r of rows) {
    const newRoomId = mapRoomId(r.legacy_room);
    if (!newRoomId) continue;
    if (!sessionGroups.has(r.session_id)) {
      sessionGroups.set(r.session_id, { newRoomId, messages: [] });
    }
    sessionGroups.get(r.session_id).messages.push(r);
  }
  console.log(`Grouped into ${sessionGroups.size} sessions across ${new Set([...sessionGroups.values()].map(g => g.newRoomId)).size} rooms`);

  if (DRY) {
    const byRoom = {};
    for (const g of sessionGroups.values()) {
      byRoom[g.newRoomId] = (byRoom[g.newRoomId] || 0) + g.messages.length;
    }
    console.log(`[dry] would copy:`);
    for (const [room, count] of Object.entries(byRoom)) console.log(`  ${room}: ${count} messages`);
    return;
  }

  // Process sessions sequentially (each needs its own session_id from the worker)
  // but POST messages concurrently within each session.
  let copied = 0;
  for (const [legacyId, group] of sessionGroups) {
    const newSessionId = await newSession(group.newRoomId);
    await postBatched(group.messages, async (m) => {
      const author = m.role === 'user' ? 'fox' : (group.newRoomId.replace('chat-', '') || 'alex');
      await postMessage({
        room_id: group.newRoomId,
        session_id: newSessionId,
        author,
        content: m.content || '',
        tool_calls: m.tool_calls ? safeParse(m.tool_calls) : undefined,
      });
    });
    copied++;
    console.log(`  ✓ session ${legacyId} → new session ${newSessionId} (${group.messages.length} msgs) [${copied}/${sessionGroups.size}]`);
  }
  console.log(`Phase 1 done: ${copied} sessions copied`);
}

async function backfillLR() {
  console.log('\n=== Phase 2: living_room_messages → livingroom-default ===');
  const rows = d1Bulk(`
    SELECT id, scene_id, author, content, created_at
    FROM living_room_messages
    ORDER BY created_at ASC, id ASC
  `);
  console.log(`Fetched ${rows.length} LR messages`);
  if (rows.length === 0) return;

  if (DRY) {
    console.log(`[dry] would copy ${rows.length} LR messages into livingroom-default`);
    return;
  }

  const sessionId = await newSession('livingroom-default');
  await postBatched(rows, async (r) => {
    await postMessage({
      room_id: 'livingroom-default',
      session_id: sessionId,
      author: r.author,
      content: r.content || '',
    });
  });
  console.log(`Phase 2 done: ${rows.length} messages in session ${sessionId}`);
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return undefined; }
}

async function main() {
  console.log(`Backfill mode: ${DRY ? 'DRY RUN' : 'LIVE'} | concurrency: ${CONCURRENCY}`);
  console.log(`Source DB: ${AI_MIND_DB}`);
  console.log(`Target: ${ROOMS_URL}`);
  const start = Date.now();
  if (!LR_ONLY) await backfillChats();
  if (!CHAT_ONLY) await backfillLR();
  console.log(`\n✅ Backfill complete in ${Math.round((Date.now() - start) / 1000)}s`);
}

main().catch(e => { console.error(e); process.exit(1); });
