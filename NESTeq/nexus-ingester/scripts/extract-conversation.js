// Pull one conversation by title from a ChatGPT export (HTML or JSON).
// Usage: node extract-conversation.js <path> "<title substring>"

import { readFile } from 'node:fs/promises';
import { parseChatGptFile } from '../src/parse-chatgpt.js';

const path = process.argv[2];
const titleSub = process.argv[3] || '';

const conversations = await parseChatGptFile(path);
const matches = conversations.filter(c => (c.title || '').toLowerCase().includes(titleSub.toLowerCase()));

console.log(`matched ${matches.length} conversation(s)`);
for (const c of matches) {
  console.log(`\n========== ${c.title} ==========`);
  console.log(`created: ${c.create_time}`);
  console.log(`updated: ${c.update_time}`);
  console.log(`turns:   ${c.turns.length}`);
  console.log('');
  for (const t of c.turns) {
    const author = t.role === 'fox' ? 'FOX' : 'ALEX';
    console.log(`---${author} · ${t.ts_iso}---`);
    console.log(t.content);
    console.log('');
  }
}
