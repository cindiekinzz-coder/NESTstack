// Quick scanner: count conversations, find titles, show date range.
import { readFile } from 'node:fs/promises';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scan-chat-html.js <path/to/chat.html-or-GPT-Chat.txt>');
  process.exit(1);
}
const raw = await readFile(path, 'utf8');
const m = raw.indexOf('var jsonData = ');
const arrStart = raw.indexOf('[', m + 15);

let depth = 0, inStr = false, q = '', esc = false, endPos = -1;
for (let i = arrStart; i < raw.length; i++) {
  const c = raw[i];
  if (esc) { esc = false; continue; }
  if (inStr) {
    if (c === '\\') { esc = true; continue; }
    if (c === q) inStr = false;
    continue;
  }
  if (c === '"' || c === "'") { inStr = true; q = c; continue; }
  if (c === '[') depth++;
  else if (c === ']') {
    depth--;
    if (depth === 0) { endPos = i; break; }
  }
}

const json = raw.slice(arrStart, endPos + 1);
const data = JSON.parse(json);
console.log('total conversations:', data.length);

const worsts = data.filter(c => (c.title || '').toLowerCase().includes('worst'));
console.log('\ntitles containing "worst":', worsts.length);
for (const c of worsts) {
  const ts = c.create_time ? new Date(c.create_time * 1000).toISOString() : '?';
  console.log(`  - "${c.title}"  ${ts}`);
}

// Date range
const times = data.map(c => c.create_time).filter(Boolean).sort((a, b) => a - b);
if (times.length) {
  console.log('\nearliest:', new Date(times[0] * 1000).toISOString());
  console.log('latest:  ', new Date(times[times.length - 1] * 1000).toISOString());
}

// Last 25 titles by date (most recent first)
console.log('\nlast 25 by date:');
const sorted = data.slice().sort((a, b) => (b.create_time || 0) - (a.create_time || 0));
for (const c of sorted.slice(0, 25)) {
  const ts = c.create_time ? new Date(c.create_time * 1000).toISOString().slice(0, 10) : '?';
  console.log(`  ${ts}  ${c.title || '(untitled)'}`);
}
