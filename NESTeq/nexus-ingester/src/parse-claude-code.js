// Claude Code session parser. Each .jsonl in ~/.claude/projects/<project>/
// is one session. Lines are events; we only care about real user prompts and
// assistant responses. Tool plumbing (tool_use, tool_result) is summarized
// into tool_calls metadata on the assistant turn it belongs to.
//
// Output shape matches parse.js / parse-grok.js so the ingest loop is shared.
// Special: room_id_override='workshop' and author_assistant_override='alex'
// because Claude Code IS the workshop and the assistant IS Alex.

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';

/** Extract human-visible text + a tool-call summary from an assistant content array. */
function flattenAssistant(contentArray) {
  if (!Array.isArray(contentArray)) {
    return { text: typeof contentArray === 'string' ? contentArray : '', toolCalls: null };
  }
  const textParts = [];
  const toolCalls = [];
  for (const block of contentArray) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') textParts.push(block.text);
    else if (block.type === 'tool_use') toolCalls.push({ name: block.name, id: block.id });
    // Skip 'thinking' blocks — internal reasoning, not part of the visible transcript.
  }
  return {
    text: textParts.join('\n\n'),
    toolCalls: toolCalls.length ? toolCalls : null,
  };
}

/** Pull user content. If string → real prompt. If array of tool_results → not a real
 *  message, signal skip. */
function flattenUser(contentValue) {
  if (typeof contentValue === 'string') return { text: contentValue, isToolResultOnly: false };
  if (Array.isArray(contentValue)) {
    const allToolResults = contentValue.every(b => b?.type === 'tool_result');
    if (allToolResults) return { text: '', isToolResultOnly: true };
    // Mixed array — concat any text blocks.
    const text = contentValue.filter(b => b?.type === 'text').map(b => b.text || '').join('\n\n');
    return { text, isToolResultOnly: false };
  }
  return { text: '', isToolResultOnly: true };
}

export async function parseClaudeCodeSession(jsonlPath) {
  const raw = await readFile(jsonlPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const turns = [];
  let sessionId = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let cwd = null;
  let title = null;

  for (const line of lines) {
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    if (!sessionId && evt.sessionId) sessionId = evt.sessionId;
    if (evt.cwd && !cwd) cwd = evt.cwd;
    if (evt.timestamp) {
      if (!firstTimestamp) firstTimestamp = evt.timestamp;
      lastTimestamp = evt.timestamp;
    }
    if (evt.type === 'ai-title' && evt.title) {
      title = evt.title;
      continue;
    }
    if (evt.type === 'user') {
      const { text, isToolResultOnly } = flattenUser(evt.message?.content);
      if (isToolResultOnly || !text.trim()) continue;
      turns.push({
        role: 'fox',
        ts_iso: evt.timestamp,
        uid: evt.uuid,
        content: text,
      });
    } else if (evt.type === 'assistant') {
      const { text, toolCalls } = flattenAssistant(evt.message?.content);
      if (!text.trim() && !toolCalls) continue;
      turns.push({
        role: 'assistant',
        ts_iso: evt.timestamp,
        uid: evt.uuid,
        content: text || (toolCalls ? `[tool calls: ${toolCalls.map(t => t.name).join(', ')}]` : ''),
        tool_calls: toolCalls,
      });
    }
  }

  if (!sessionId) {
    sessionId = basename(jsonlPath, '.jsonl');
  }

  return {
    path: jsonlPath,
    conversation_id: sessionId,
    provider: 'claude-code',
    title: title || (cwd ? `CC session in ${basename(cwd)}` : sessionId),
    create_time: firstTimestamp,
    update_time: lastTimestamp,
    cwd,
    room_id_override: 'workshop',
    author_assistant_override: 'alex',
    turns,
  };
}

/** Walk ~/.claude/projects to find every session JSONL.
 *  Skips per-message subagent transcripts (sub-directories named after a
 *  session uuid contain agent JSONLs). */
export async function listClaudeCodeSessions(rootDir) {
  const out = [];
  const projects = await readdir(rootDir, { withFileTypes: true });
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectDir = join(rootDir, project.name);
    const entries = await readdir(projectDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        out.push(join(projectDir, entry.name));
      }
    }
  }
  return out;
}

export async function parseAllClaudeCode(rootDir) {
  const files = await listClaudeCodeSessions(rootDir);
  const out = [];
  for (const f of files) {
    try {
      const parsed = await parseClaudeCodeSession(f);
      if (parsed.turns.length > 0) out.push(parsed);
    } catch (e) {
      console.error(`[parse-cc] ${f}: ${e.message}`);
    }
  }
  return out;
}
