// Claude.ai native data export parser. Different from Nexus (Obsidian
// markdown) and from the Claude API export — this is what Settings → Export
// Data spits out as a single conversations.json.
//
// Schema:
//   conversations.json: [
//     {
//       uuid, name, summary, account, created_at, updated_at,
//       chat_messages: [
//         {
//           uuid, text, sender: 'human'|'assistant', created_at, updated_at,
//           content: [{ type, text, citations, ... }],
//           attachments, files
//         },
//         ...
//       ]
//     },
//     ...
//   ]
//
// Output matches the other parsers so the ingest loop is shared.

import { readFile } from 'node:fs/promises';

function extractText(msg) {
  // Prefer content[].text concatenation (richer, may include citations);
  // fall back to top-level .text.
  if (Array.isArray(msg.content)) {
    const parts = msg.content
      .filter(p => p?.type === 'text' && typeof p.text === 'string')
      .map(p => p.text);
    if (parts.length) return parts.join('\n\n').trim();
  }
  return (msg.text || '').trim();
}

export async function parseClaudeNativeFile(path) {
  const data = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(data)) {
    throw new Error('expected conversations.json to be an array at root');
  }
  const out = [];
  for (const conv of data) {
    const msgs = conv.chat_messages || [];
    if (msgs.length === 0) continue;

    const turns = [];
    for (const m of msgs) {
      const text = extractText(m);
      if (!text) continue;
      const role = m.sender === 'human' ? 'fox' : 'assistant';
      turns.push({
        role,
        ts_iso: m.created_at,
        uid: m.uuid,
        content: text,
      });
    }
    if (turns.length === 0) continue;

    out.push({
      path,
      conversation_id: conv.uuid,
      provider: 'claude',
      title: conv.name || '(untitled)',
      create_time: conv.created_at,
      update_time: conv.updated_at,
      turns,
    });
  }
  return out;
}
