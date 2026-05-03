// Grok export parser — produces the same intermediate shape as parse.js
// (Nexus) so the ingester loop is provider-agnostic.
//
// Grok export format: a single prod-grok-backend.json containing:
//   { conversations: [{ conversation: {...}, responses: [{response: {...}}] }] }
//
// Per-conversation fields we use:
//   conversation.id, .title, .create_time, .modify_time
// Per-response fields we use:
//   response._id, response.sender ('human'|'ASSISTANT'|'assistant'),
//   response.message, response.create_time (BSON $date), response.model

import { readFile } from 'node:fs/promises';

function bsonToIso(d) {
  if (!d) return null;
  if (typeof d === 'string') return d;
  if (d.$date?.$numberLong) return new Date(Number(d.$date.$numberLong)).toISOString();
  if (d.$date) return new Date(d.$date).toISOString();
  return null;
}

/** Parse a Grok export JSON. Returns an ARRAY of parsed conversations
 *  (Nexus parser returns one per file; Grok contains many in one file). */
export async function parseGrokFile(path) {
  const data = JSON.parse(await readFile(path, 'utf8'));
  const out = [];
  for (const item of data.conversations || []) {
    const conv = item.conversation;
    if (!conv) continue;
    const responses = item.responses || [];
    const turns = responses.map(r => {
      const resp = r.response;
      const sender = (resp.sender || '').toLowerCase();
      return {
        role: sender === 'human' ? 'fox' : 'assistant',
        ts_iso: bsonToIso(resp.create_time),
        uid: resp._id,
        content: resp.message || '',
      };
    }).filter(t => t.uid && t.content);

    out.push({
      path,
      conversation_id: conv.id,
      provider: 'grok',
      title: conv.title || '',
      create_time: bsonToIso(conv.create_time) || conv.create_time || null,
      update_time: bsonToIso(conv.modify_time) || conv.modify_time || null,
      turns,
    });
  }
  return out;
}
