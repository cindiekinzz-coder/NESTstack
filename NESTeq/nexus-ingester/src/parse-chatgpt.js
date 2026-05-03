// ChatGPT export parser. The export ships as a zip; once unzipped, the file
// we want is conversations.json — an array where each entry has a `mapping`
// tree of messages keyed by message id.
//
// Structure (relevant fields only):
//   conversations.json: [
//     {
//       id, title, create_time, update_time,
//       mapping: {
//         "<msgid>": {
//           id, parent, children: [<msgid>...],
//           message: {
//             id,
//             author: { role: "user" | "assistant" | "system" | "tool" },
//             create_time,
//             content: { content_type, parts: [<string|{...}>...] },
//             metadata: { ... },
//           } | null
//         },
//         ...
//       },
//       current_node: "<leaf-msgid>"   // the most-recent leaf — walk up from here
//     }, ...
//   ]
//
// Output matches parse.js / parse-grok.js / parse-claude-code.js so the
// ingest loop is shared.

import { readFile } from 'node:fs/promises';

function epochToIso(t) {
  if (t == null) return null;
  if (typeof t === 'number') return new Date(t * 1000).toISOString();
  if (typeof t === 'string') return t;
  return null;
}

/** Walk from current_node up the parent chain to the root, reverse for chrono order. */
function linearizeFromLeaf(mapping, leafId) {
  const out = [];
  const seen = new Set();
  let cur = leafId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const node = mapping[cur];
    if (!node) break;
    out.push(node);
    cur = node.parent;
  }
  return out.reverse();
}

/** Fallback: if current_node is missing, sort all mapping nodes by create_time. */
function linearizeByTime(mapping) {
  const nodes = Object.values(mapping).filter(n => n?.message?.create_time != null);
  nodes.sort((a, b) => a.message.create_time - b.message.create_time);
  return nodes;
}

/** Pull text from a ChatGPT message.content.parts. Parts can be strings or
 *  objects (image refs, code execution outputs). We concat strings; skip
 *  non-string parts (Phase 2 attachments). */
function extractText(content) {
  if (!content) return '';
  const parts = content.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map(p => (typeof p === 'string' ? p : (p?.text || '')))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

/** ChatGPT also ships chats embedded in chat.html / "GPT Chat.txt" files as
 *  `var jsonData = [ ... ];` followed by other JS that uses it. We need the
 *  matching `]` of the top-level array. The naive "last `];`" approach fails
 *  because the trailing JS contains array literals too. Bracket-balance the
 *  characters, skipping string contents (with escape handling). */
function extractJsonDataFromHtml(raw) {
  const marker = 'var jsonData = ';
  const start = raw.indexOf(marker);
  if (start === -1) return null;
  const arrStart = raw.indexOf('[', start + marker.length);
  if (arrStart === -1) return null;

  let depth = 0;
  let inString = false;
  let stringQuote = '';
  let escape = false;
  for (let i = arrStart; i < raw.length; i++) {
    const c = raw[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === '\\') { escape = true; continue; }
      if (c === stringQuote) { inString = false; }
      continue;
    }
    if (c === '"' || c === "'") { inString = true; stringQuote = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return raw.slice(arrStart, i + 1);
    }
  }
  return null;
}

export async function parseChatGptFile(path) {
  const raw = await readFile(path, 'utf8');
  let jsonStr = raw;
  // If it's HTML, extract the embedded jsonData array.
  if (raw.trimStart().startsWith('<')) {
    const extracted = extractJsonDataFromHtml(raw);
    if (!extracted) {
      throw new Error('could not extract jsonData from HTML — is this a ChatGPT chat.html / GPT Chat.txt export?');
    }
    jsonStr = extracted;
  }
  const data = JSON.parse(jsonStr);
  if (!Array.isArray(data)) {
    throw new Error('expected conversations array at root');
  }
  const out = [];
  for (const conv of data) {
    const mapping = conv.mapping || {};
    const leaf = conv.current_node;
    const nodes = leaf && mapping[leaf]
      ? linearizeFromLeaf(mapping, leaf)
      : linearizeByTime(mapping);

    const turns = [];
    for (const node of nodes) {
      const m = node.message;
      if (!m) continue;
      const role = m.author?.role;
      // Only keep human + model exchanges. Skip system + tool plumbing.
      if (role !== 'user' && role !== 'assistant') continue;
      const text = extractText(m.content);
      if (!text) continue;
      turns.push({
        role: role === 'user' ? 'fox' : 'assistant',
        ts_iso: epochToIso(m.create_time),
        uid: m.id || node.id,
        content: text,
      });
    }

    out.push({
      path,
      conversation_id: conv.id,
      provider: 'chatgpt',
      title: conv.title || '',
      create_time: epochToIso(conv.create_time),
      update_time: epochToIso(conv.update_time),
      turns,
    });
  }
  return out;
}
