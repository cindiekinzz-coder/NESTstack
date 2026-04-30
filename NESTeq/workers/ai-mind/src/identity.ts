/**
 * Identity & context handlers.
 *
 * Two related concerns:
 *
 * 1. **Identity** — long-lived self-description rows in `identity` table,
 *    keyed by section (e.g. "core", "values", "relationship") with weight
 *    and connections. Read/write/delete by section or text match.
 *
 * 2. **Context entries** — shorter-lived contextual notes in `context_entries`
 *    table, keyed by scope (e.g. "session", "project"). Each row has an id
 *    so individual entries can be updated or cleared independently.
 */

import { Env } from './env';
import { generateId } from './shared/utils';

export async function handleMindIdentity(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = (params.action as string) || "read";

  if (action === "write") {
    const section = params.section as string;
    const content = params.content as string;
    const weight = (params.weight as number) || 0.7;
    const connections = params.connections as string || "";

    await env.DB.prepare(
      `INSERT INTO identity (section, content, weight, connections) VALUES (?, ?, ?, ?)`
    ).bind(section, content, weight, connections).run();

    return `Identity entry added to ${section}`;
  } else if (action === "delete") {
    const section = params.section as string;
    const textMatch = params.text_match as string;

    if (!section && !textMatch) {
      return "Error: Must provide either 'section' or 'text_match' for delete action";
    }

    let deleteResult;
    if (section && textMatch) {
      // Delete by section AND text match
      deleteResult = await env.DB.prepare(
        `DELETE FROM identity WHERE section = ? AND content LIKE ?`
      ).bind(section, `%${textMatch}%`).run();
    } else if (section) {
      // Delete all entries in section
      deleteResult = await env.DB.prepare(
        `DELETE FROM identity WHERE section = ?`
      ).bind(section).run();
    } else {
      // Delete by text match only
      deleteResult = await env.DB.prepare(
        `DELETE FROM identity WHERE content LIKE ?`
      ).bind(`%${textMatch}%`).run();
    }

    const deleted = deleteResult.meta?.changes || 0;
    return `Deleted ${deleted} identity entry(s)${section ? ` from section '${section}'` : ''}${textMatch ? ` matching '${textMatch}'` : ''}`;
  } else {
    const section = params.section as string;

    const query = section
      ? `SELECT section, content, weight, connections FROM identity WHERE section LIKE ? ORDER BY weight DESC`
      : `SELECT section, content, weight, connections FROM identity ORDER BY weight DESC LIMIT 50`;

    const results = section
      ? await env.DB.prepare(query).bind(`${section}%`).all()
      : await env.DB.prepare(query).all();

    if (!results.results?.length) {
      return "No identity entries found.";
    }

    let output = "## Identity Graph\n\n";
    for (const r of results.results) {
      output += `**${r.section}** [${r.weight}]\n${r.content}\n`;
      if (r.connections) output += `Connections: ${r.connections}\n`;
      output += "\n";
    }
    return output;
  }
}

export async function handleMindContext(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = (params.action as string) || "read";

  switch (action) {
    case "read": {
      const scope = params.scope as string;
      const query = scope
        ? `SELECT * FROM context_entries WHERE scope = ? ORDER BY updated_at DESC`
        : `SELECT * FROM context_entries ORDER BY updated_at DESC`;
      const results = scope
        ? await env.DB.prepare(query).bind(scope).all()
        : await env.DB.prepare(query).all();

      if (!results.results?.length) {
        return "No context entries found.";
      }

      let output = "## Context Layer\n\n";
      for (const r of results.results) {
        output += `**[${r.scope}]** ${r.content}\n`;
        if (r.links && r.links !== '[]') output += `Links: ${r.links}\n`;
        output += "\n";
      }
      return output;
    }

    case "set": {
      const id = generateId("ctx");
      const scope = params.scope as string;
      const content = params.content as string;
      const links = params.links || "[]";

      await env.DB.prepare(
        `INSERT INTO context_entries (id, scope, content, links) VALUES (?, ?, ?, ?)`
      ).bind(id, scope, content, links).run();

      return `Context entry created: ${id}`;
    }

    case "update": {
      const id = params.id as string;
      const content = params.content as string;

      await env.DB.prepare(
        `UPDATE context_entries SET content = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(content, id).run();

      return `Context entry updated: ${id}`;
    }

    case "clear": {
      const id = params.id as string;
      const scope = params.scope as string;

      if (id) {
        await env.DB.prepare(`DELETE FROM context_entries WHERE id = ?`).bind(id).run();
        return `Context entry deleted: ${id}`;
      } else if (scope) {
        await env.DB.prepare(`DELETE FROM context_entries WHERE scope = ?`).bind(scope).run();
        return `All context entries in scope '${scope}' deleted`;
      }
      return "Specify id or scope to clear";
    }

    default:
      return `Unknown action: ${action}`;
  }
}
