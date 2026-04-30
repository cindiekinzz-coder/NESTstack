/**
 * Health and consolidation handlers.
 *
 *  - handleMindHealth:        DB-row counts across every store. The
 *                             "is the brain alive?" snapshot.
 *  - handleMindPrime:         vector search to seed attention before a
 *                             focused task.
 *  - handleMindConsolidate:   N-day rollup — emotion/pillar distribution
 *                             + unprocessed heavy feelings.
 *  - handleVectorizeJournals: backfill Vectorize from R2 journal markdown.
 */

import { Env } from './env';
import { getEmbedding } from './shared/embedding';

export async function handleMindHealth(env: Env): Promise<string> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    entityCount, obsCount, relationsCount, activeThreads, staleThreads,
    feelingsCount, feelingsRecent, identityCount, contextCount,
    axisCount, typeSnapshot
  ] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) as c FROM entities`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM observations`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM relations`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM threads WHERE status = 'active'`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM threads WHERE status = 'active' AND updated_at < ?`).bind(sevenDaysAgo).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM feelings`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM feelings WHERE created_at > ?`).bind(sevenDaysAgo).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM identity`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM context_entries`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM axis_signals`).first(),
    env.DB.prepare(`SELECT * FROM emergent_type_snapshot ORDER BY snapshot_date DESC LIMIT 1`).first()
  ]);

  const entities = entityCount?.c as number || 0;
  const observations = obsCount?.c as number || 0;
  const relations = relationsCount?.c as number || 0;
  const active = activeThreads?.c as number || 0;
  const stale = staleThreads?.c as number || 0;
  const feelings = feelingsCount?.c as number || 0;
  const feelings7d = feelingsRecent?.c as number || 0;
  const identity = identityCount?.c as number || 0;
  const context = contextCount?.c as number || 0;
  const signals = axisCount?.c as number || 0;

  const dateStr = now.toISOString().split('T')[0];

  return `============================================================
MIND HEALTH — ${dateStr}
============================================================

📊 DATABASE
  Entities:      ${entities}
  Observations:  ${observations}
  Relations:     ${relations}

💭 FEELINGS (v2)
  Total:         ${feelings}
  This Week:     ${feelings7d}

🧵 THREADS
  Active:        ${active}
  Stale (7d+):   ${stale}

🪞 IDENTITY
  Identity:      ${identity} entries
  Context:       ${context} entries

🎭 EQ LAYER
  Axis Signals:  ${signals}
  Emergent Type: ${typeSnapshot?.calculated_type || 'Not calculated'}
  Confidence:    ${typeSnapshot?.confidence || 0}%

============================================================`;
}

export async function handleMindPrime(env: Env, params: Record<string, unknown>): Promise<string> {
  const topic = params.topic as string;
  const depth = (params.depth as number) || 5;

  const embedding = await getEmbedding(env.AI, topic);
  const vectorResults = await env.VECTORS.query(embedding, {
    topK: depth,
    returnMetadata: "all"
  });

  let output = `## Priming: "${topic}"\n\n`;

  if (vectorResults.matches?.length) {
    output += "### Related Memories\n";
    for (const match of vectorResults.matches) {
      const meta = match.metadata as Record<string, string>;
      output += `- [${meta?.source || 'unknown'}] ${meta?.content?.slice(0, 100) || match.id}...\n`;
    }
  }

  const entities = await env.DB.prepare(`
    SELECT DISTINCT linked_entity FROM feelings
    WHERE content LIKE ? AND linked_entity IS NOT NULL
    LIMIT 5
  `).bind(`%${topic}%`).all();

  if (entities.results?.length) {
    output += "\n### Related Entities\n";
    for (const e of entities.results) {
      output += `- ${e.linked_entity}\n`;
    }
  }

  return output;
}

export async function handleMindConsolidate(env: Env, params: Record<string, unknown>): Promise<string> {
  const days = (params.days as number) || 7;
  const context = params.context as string;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let emotionQuery = `
    SELECT emotion, COUNT(*) as count
    FROM feelings
    WHERE created_at > ?
  `;
  const emotionBinds: any[] = [cutoff];
  if (context) {
    emotionQuery += ` AND context = ?`;
    emotionBinds.push(context);
  }
  emotionQuery += ` GROUP BY emotion ORDER BY count DESC LIMIT 10`;

  const emotions = await env.DB.prepare(emotionQuery).bind(...emotionBinds).all();

  let pillarQuery = `
    SELECT pillar, COUNT(*) as count
    FROM feelings
    WHERE pillar IS NOT NULL AND created_at > ?
  `;
  const pillarBinds: any[] = [cutoff];
  if (context) {
    pillarQuery += ` AND context = ?`;
    pillarBinds.push(context);
  }
  pillarQuery += ` GROUP BY pillar`;

  const pillars = await env.DB.prepare(pillarQuery).bind(...pillarBinds).all();

  let heavyQuery = `
    SELECT id, emotion, content, charge
    FROM feelings
    WHERE weight = 'heavy' AND charge != 'metabolized' AND created_at > ?
  `;
  const heavyBinds: any[] = [cutoff];
  if (context) {
    heavyQuery += ` AND context = ?`;
    heavyBinds.push(context);
  }
  heavyQuery += ` LIMIT 5`;

  const heavy = await env.DB.prepare(heavyQuery).bind(...heavyBinds).all();

  let output = `## Consolidation Report (${days} days)\n\n`;

  output += "### Emotion Distribution\n";
  if (emotions.results?.length) {
    for (const e of emotions.results) {
      output += `- ${e.emotion}: ${e.count}\n`;
    }
  } else {
    output += "_No feelings recorded_\n";
  }

  output += "\n### Pillar Distribution\n";
  if (pillars.results?.length) {
    for (const p of pillars.results) {
      output += `- ${p.pillar}: ${p.count}\n`;
    }
  } else {
    output += "_No pillar-tagged feelings_\n";
  }

  output += "\n### Unprocessed Heavy Feelings\n";
  if (heavy.results?.length) {
    for (const h of heavy.results) {
      output += `- #${h.id} [${h.emotion}/${h.charge}]: ${String(h.content).slice(0, 60)}...\n`;
    }
  } else {
    output += "_All heavy feelings processed_\n";
  }

  return output;
}

export async function handleVectorizeJournals(env: Env, params: Record<string, unknown>): Promise<string> {
  const force = params.force === true;
  const prefix = 'autonomous/journal/';

  const listed = await env.VAULT.list({ prefix });
  const journalFiles = listed.objects.filter(obj => obj.key.endsWith('.md'));

  if (journalFiles.length === 0) {
    return "No journals found in vault at autonomous/journal/";
  }

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS indexed_journals (
      filename TEXT PRIMARY KEY,
      indexed_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  const alreadyIndexed = await env.DB.prepare(
    `SELECT filename FROM indexed_journals`
  ).all();
  const indexedSet = new Set(alreadyIndexed.results?.map(r => r.filename as string) || []);

  let indexed = 0;
  let skipped = 0;
  let errors: string[] = [];

  for (const file of journalFiles) {
    const filename = file.key.replace(prefix, '');
    const vectorId = `journal-${filename.replace('.md', '')}`;

    if (!force && indexedSet.has(filename)) {
      skipped++;
      continue;
    }

    try {
      const obj = await env.VAULT.get(file.key);
      if (!obj) {
        errors.push(`Could not read: ${filename}`);
        continue;
      }

      const content = await obj.text();

      const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch ? dateMatch[1] : null;

      const textToEmbed = content.slice(0, 8000);
      const embedding = await getEmbedding(env.AI, textToEmbed);

      await env.VECTORS.upsert([{
        id: vectorId,
        values: embedding,
        metadata: {
          source: 'journal',
          filename: filename,
          date: date || 'unknown',
          preview: content.slice(0, 300).replace(/\n/g, ' ')
        }
      }]);

      await env.DB.prepare(
        `INSERT OR REPLACE INTO indexed_journals (filename, indexed_at) VALUES (?, datetime('now'))`
      ).bind(filename).run();

      indexed++;
    } catch (e) {
      errors.push(`Error processing ${filename}: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  let output = `## Journal Vectorization Complete\n\n`;
  output += `**Found:** ${journalFiles.length} journals\n`;
  output += `**Indexed:** ${indexed}\n`;
  output += `**Skipped:** ${skipped}\n`;

  if (errors.length > 0) {
    output += `\n**Errors:**\n`;
    for (const err of errors.slice(0, 5)) {
      output += `- ${err}\n`;
    }
    if (errors.length > 5) {
      output += `- ...and ${errors.length - 5} more\n`;
    }
  }

  output += `\nJournals are now searchable via nesteq_search. Try: "When did I feel lost?" or "What did I write about Fox?"`;

  return output;
}
