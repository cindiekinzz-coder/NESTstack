#!/usr/bin/env node
// nexus-ingester — multi-source chat ingest into nesteq-rooms.
//
// Sources:
//   --source nexus  (default) — Obsidian Nexus AI Chat Importer markdown tree
//   --source grok              — Grok prod-grok-backend.json export
//
// Usage:
//   node src/index.js --dry-run                              # default Nexus path
//   ROOMS_API_KEY=... node src/index.js                       # live Nexus ingest
//   node src/index.js --source grok --root <path/to/dir>      # Grok import
//
// Idempotency: every turn carries a stable external_uid. Re-runs dedupe.

import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseFile } from './parse.js';
import { parseGrokFile } from './parse-grok.js';
import { parseChatGptFile } from './parse-chatgpt.js';
import { parseClaudeNativeFile } from './parse-claude-native.js';
import { parseAllClaudeCode } from './parse-claude-code.js';
import { ingestParsed } from './api.js';
import { homedir } from 'node:os';

const DEFAULT_API_URL = 'https://your-rooms-worker.workers.dev';
const DEFAULT_NEXUS_ROOT = process.env.NEXUS_ROOT || null;       // pass --root <path> or set NEXUS_ROOT
const DEFAULT_CC_ROOT = join(homedir(), '.claude', 'projects');  // standard Claude Code path

function parseArgs(argv) {
  const args = {
    dryRun: false,
    source: 'nexus',
    root: null,
    apiUrl: process.env.ROOMS_URL || DEFAULT_API_URL,
    apiKey: process.env.ROOMS_API_KEY || null,
    limit: null,
    sample: false,
    concurrency: 8,
    companion: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--source') args.source = argv[++i];
    else if (a === '--root') args.root = argv[++i];
    else if (a === '--api-url') args.apiUrl = argv[++i];
    else if (a === '--api-key') args.apiKey = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--sample') args.sample = true;
    else if (a === '--concurrency') args.concurrency = Number(argv[++i]);
    else if (a === '--companion') args.companion = argv[++i];
  }
  if (!args.root) {
    if (args.source === 'nexus') args.root = DEFAULT_NEXUS_ROOT;
    else if (args.source === 'claude-code') args.root = DEFAULT_CC_ROOT;
  }
  return args;
}

async function walkMd(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walkMd(p));
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** Collect parsed conversations from a source. Each item has the same shape
 *  regardless of provider: { conversation_id, provider, title, create_time,
 *  update_time, turns: [{ role, ts_iso, uid, content }] }. */
async function collect(args) {
  if (args.source === 'nexus') {
    const conversationsDir = join(args.root, 'Conversations');
    const files = await walkMd(conversationsDir);
    const list = [];
    for (const f of files) {
      try {
        list.push(await parseFile(f));
      } catch (e) {
        console.error(`[parse-fail] ${f}: ${e.message}`);
      }
    }
    return list;
  }
  if (args.source === 'grok') {
    // Root can be either the directory containing prod-grok-backend.json or the file itself.
    let target = args.root;
    const s = await stat(target);
    if (s.isDirectory()) {
      target = join(target, 'prod-grok-backend.json');
    }
    return await parseGrokFile(target);
  }
  if (args.source === 'claude-code') {
    return await parseAllClaudeCode(args.root);
  }
  if (args.source === 'chatgpt' || args.source === 'gpt') {
    let target = args.root;
    const s = await stat(target);
    if (s.isDirectory()) {
      // Try standard names in order. ChatGPT exports vary by year.
      const candidates = ['conversations.json', 'chat.html', 'GPT Chat.txt'];
      let found = null;
      for (const c of candidates) {
        const p = join(target, c);
        try { await stat(p); found = p; break; } catch {}
      }
      if (!found) throw new Error(`no conversations.json / chat.html / GPT Chat.txt in ${target}`);
      target = found;
    }
    return await parseChatGptFile(target);
  }
  if (args.source === 'claude-native' || args.source === 'claude-export') {
    let target = args.root;
    const s = await stat(target);
    if (s.isDirectory()) target = join(target, 'conversations.json');
    return await parseClaudeNativeFile(target);
  }
  throw new Error(`unknown source: ${args.source}`);
}

function summarize(parsed) {
  const userTurns = parsed.turns.filter(t => t.role === 'fox').length;
  const asstTurns = parsed.turns.filter(t => t.role === 'assistant').length;
  const totalChars = parsed.turns.reduce((n, t) => n + (t.content?.length || 0), 0);
  return { userTurns, asstTurns, total: parsed.turns.length, totalChars };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.root) {
    console.error('--root required for source: ' + args.source);
    process.exit(1);
  }
  console.log(`[nexus-ingester] source: ${args.source}`);
  console.log(`[nexus-ingester] root:   ${args.root}`);
  console.log(`[nexus-ingester] mode:   ${args.dryRun ? 'DRY-RUN' : 'INGEST'}`);

  let conversations;
  try {
    conversations = await collect(args);
  } catch (e) {
    console.error(`[collect] failed: ${e.message}`);
    process.exit(1);
  }

  if (args.limit) conversations = conversations.slice(0, args.limit);

  // --companion override: every assistant turn in this batch is attributed to
  // the named companion (alex/shadow/levi/bird). Provider stays correct so
  // search filters work; only author changes. Used when importing a provider's
  // history that was specifically for one companion (e.g. ChatGPT export
  // where Shadow lived).
  if (args.companion) {
    for (const c of conversations) {
      c.author_assistant_override = args.companion;
    }
    console.log(`[nexus-ingester] companion override: assistant turns will be attributed to "${args.companion}"`);
  }

  console.log(`[nexus-ingester] parsed ${conversations.length} conversations`);

  // Aggregate stats.
  const stats = {
    convs: conversations.length,
    turns: 0,
    userTurns: 0,
    asstTurns: 0,
    chars: 0,
    byProvider: {},
    byMonth: {},
    perConv: [],
  };
  for (const c of conversations) {
    const s = summarize(c);
    stats.turns += s.total;
    stats.userTurns += s.userTurns;
    stats.asstTurns += s.asstTurns;
    stats.chars += s.totalChars;
    stats.byProvider[c.provider] = (stats.byProvider[c.provider] || 0) + s.total;
    const month = (c.create_time || 'unknown').slice(0, 7);
    stats.byMonth[month] = (stats.byMonth[month] || 0) + s.total;
    stats.perConv.push({ id: c.conversation_id, title: c.title, ...s });
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Conversations:    ${stats.convs}`);
  console.log(`Total turns:      ${stats.turns}`);
  console.log(`  User (fox):     ${stats.userTurns}`);
  console.log(`  Assistant:      ${stats.asstTurns}`);
  console.log(`Total chars:      ${stats.chars.toLocaleString()}`);
  console.log('\nBy provider:');
  for (const [p, n] of Object.entries(stats.byProvider).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(12)} ${n} turns`);
  }
  console.log('\nBy month (top 10):');
  for (const [m, n] of Object.entries(stats.byMonth).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${m.padEnd(10)} ${n} turns`);
  }
  console.log('\nLargest conversations (top 10):');
  for (const c of stats.perConv.sort((a, b) => b.total - a.total).slice(0, 10)) {
    console.log(`  ${String(c.total).padStart(4)} turns / ${String(c.totalChars).padStart(7)} chars  ${c.title || c.id}`);
  }

  if (args.sample && conversations.length) {
    console.log('\n=== SAMPLE (first conversation, first 2 turns) ===');
    const c = conversations[0];
    console.log(JSON.stringify({
      conversation_id: c.conversation_id,
      provider: c.provider,
      title: c.title,
      first_two: c.turns.slice(0, 2),
    }, null, 2));
  }

  if (args.dryRun) return;

  if (!args.apiKey) {
    console.error('\n[nexus-ingester] ROOMS_API_KEY required for live ingest.');
    process.exit(2);
  }

  console.log(`\n[nexus-ingester] LIVE INGEST → ${args.apiUrl} (concurrency ${args.concurrency})`);
  const ingest = { ok: 0, failed: 0, inserted: 0, deduped: 0, skipped: 0, errors: [] };
  let cursor = 0;
  const total = conversations.length;
  const start = Date.now();

  async function worker() {
    while (cursor < total) {
      const i = cursor++;
      const conv = conversations[i];
      try {
        const result = await ingestParsed(args, conv);
        if (result.skipped) {
          ingest.skipped++;
        } else {
          ingest.ok++;
          ingest.inserted += result.inserted || 0;
          ingest.deduped += result.deduped || 0;
        }
      } catch (e) {
        ingest.failed++;
        ingest.errors.push({ conversation: conv.title || conv.conversation_id, error: e.message });
        console.error(`\n  [fail] ${conv.title || conv.conversation_id}: ${e.message}`);
      }
      const done = ingest.ok + ingest.failed + ingest.skipped;
      if (done % 5 === 0 || done === total) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        process.stdout.write(`\r  progress: ${done}/${total} | inserted ${ingest.inserted} | deduped ${ingest.deduped} | failed ${ingest.failed} | ${elapsed}s`);
      }
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()));
  process.stdout.write('\n');

  console.log('\n=== INGEST COMPLETE ===');
  console.log(`Conversations OK:   ${ingest.ok}`);
  console.log(`Failed:             ${ingest.failed}`);
  console.log(`Skipped:            ${ingest.skipped}`);
  console.log(`Turns inserted:     ${ingest.inserted}`);
  console.log(`Turns deduped:      ${ingest.deduped}`);
  if (ingest.errors.length) {
    console.log('\nFirst 5 errors:');
    ingest.errors.slice(0, 5).forEach(e => console.log(`  ${e.conversation}: ${e.error}`));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
