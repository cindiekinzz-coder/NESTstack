/**
 * Feelings handlers — the core emotional logging surface.
 *
 * `handleMindFeel` is the unified entry point for new emotional
 * entries. Internally it:
 *   1. Runs the AutonomousDecisionEngine to infer entity, weight, tags,
 *      and whether to embed / emit axis signals / check shadow.
 *   2. Falls back to embedding-based pillar inference when keyword
 *      matching can't pin a feeling to one of the four EQ pillars.
 *   3. Inserts a row into `feelings` with the conversation context
 *      (preserved with named roles, not raw API labels).
 *   4. (Conditionally) embeds into Vectorize, surfaces semantic echoes,
 *      and rehearses the matched memories (Ebbinghaus reinforcement).
 *   5. (Conditionally) emits axis signals into the MBTI tracker.
 *   6. (Conditionally) records a shadow moment if the emotion is the
 *      shadow function of the current emergent type.
 *
 * The other handlers in this module are thinner:
 *
 * - `handleMindSearch` — semantic-first, text-fallback search across
 *   feelings + journals + observations.
 * - `handleMindSurface` — bring up the feelings most worth sitting
 *   with right now (weight × strength × charge × recency).
 * - `handleMindSit` — record a sitting session, age the charge from
 *   fresh → warm → cool, increment sit_count.
 * - `handleMindResolve` — mark a feeling as metabolized, with an
 *   optional resolution note + linked insight.
 * - `handleMindSpark` — entropy-injection sampler that mixes
 *   underrepresented-pillar picks with random ones to surface
 *   stale or unexplored feelings.
 * - `handleMindFeelToward` — log a feeling toward a person into
 *   relational_state, or read recent feelings toward someone.
 */

import { Env } from './env';
import { DEFAULT_COMPANION_NAME, DEFAULT_HUMAN_NAME } from './shared/constants';
import { AutonomousDecisionEngine } from './ade';
import { getEmbedding, inferPillarByEmbedding } from './shared/embedding';

export interface ConversationMessage {
  role: string;  // v6: Allow any role name, not just API labels
  content: string;
}

export interface MindFeelParams {
  emotion: string;
  content: string;
  intensity?: 'neutral' | 'whisper' | 'present' | 'strong' | 'overwhelming';
  pillar?: string;
  weight?: 'light' | 'medium' | 'heavy';
  sparked_by?: number;
  context?: string;
  observed_at?: string;
  conversation?: ConversationMessage[];  // v3: Last 10 messages for richer ADE processing
  companion_name?: string;  // v6: Override companion name (default: Alex)
  human_name?: string;      // v6: Override human name (default: Fox)
}

export async function handleMindFeel(env: Env, params: MindFeelParams): Promise<string> {
  const engine = new AutonomousDecisionEngine();
  const emotion = params.emotion?.toLowerCase() || 'neutral';
  const content = params.content;
  const intensity = params.intensity || 'present';
  const conversation = params.conversation;  // v3: conversation context

  if (!content) return "Error: content is required";

  // v4: Query known entities from DB for dynamic detection
  const entityQuery = await env.DB.prepare(
    `SELECT name FROM entities WHERE entity_type = 'person' OR context = 'core' LIMIT 50`
  ).all();
  const knownEntities = entityQuery.results?.map(e => e.name as string) || [];

  // 1. AUTONOMOUS DECISIONS (v3: pass conversation, v4: pass known entities)
  const decision = engine.decide(emotion, content, intensity, conversation, knownEntities);

  // v5: Embedding-based pillar inference when keyword matching fails
  let inferredPillar = decision.inferred_pillar;
  if (!inferredPillar && emotion !== 'neutral' && content.length > 20) {
    // Use semantic similarity for more nuanced pillar detection
    inferredPillar = await inferPillarByEmbedding(env.AI, content, emotion);
  }

  const finalPillar = params.pillar || inferredPillar;
  const finalWeight = params.weight || decision.inferred_weight;
  const finalTags = JSON.stringify(decision.tags);
  const linkedEntity = decision.detected_entities[0] || null;

  // 2. GET OR CREATE EMOTION IN VOCABULARY
  let emotionData = await env.DB.prepare(
    `SELECT emotion_id, e_i_score, s_n_score, t_f_score, j_p_score, is_shadow_for
     FROM emotion_vocabulary WHERE emotion_word = ?`
  ).bind(emotion).first();

  let isNewEmotion = false;

  if (!emotionData && emotion !== 'neutral') {
    await env.DB.prepare(`
      INSERT INTO emotion_vocabulary (emotion_word, category, e_i_score, s_n_score, t_f_score, j_p_score, user_defined)
      VALUES (?, 'neutral', 0, 0, 0, 0, 1)
    `).bind(emotion).run();

    emotionData = await env.DB.prepare(
      `SELECT emotion_id, e_i_score, s_n_score, t_f_score, j_p_score, is_shadow_for
       FROM emotion_vocabulary WHERE emotion_word = ?`
    ).bind(emotion).first();

    isNewEmotion = true;
  }

  // 3. STORE IN FEELINGS TABLE (v3: includes conversation_context)
  const timestamp = params.observed_at || new Date().toISOString();

  // v6: Transform API role labels to actual names
  const companionName = params.companion_name || DEFAULT_COMPANION_NAME;
  const humanName = params.human_name || DEFAULT_HUMAN_NAME;

  const namedConversation = conversation?.map(msg => ({
    ...msg,
    role: msg.role === 'assistant' ? companionName :
          msg.role === 'user' ? humanName :
          msg.role  // Keep custom roles as-is
  }));

  const conversationJson = namedConversation ? JSON.stringify(namedConversation) : null;

  const result = await env.DB.prepare(`
    INSERT INTO feelings (
      content, emotion, intensity, weight, pillar,
      sparked_by, linked_entity, context, tags, observed_at, source,
      conversation_context
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    content, emotion, intensity, finalWeight, finalPillar,
    params.sparked_by || null, linkedEntity, params.context || 'default',
    finalTags, timestamp, params.source || 'manual', conversationJson
  ).first();

  const feelingId = result?.id as number;

  // 4. CONDITIONAL: VECTOR EMBEDDING + SEMANTIC ECHOES
  let echoOutput = '';
  if (decision.should_embed) {
    const embedding = await getEmbedding(env.AI, `${emotion}: ${content}`);
    await env.VECTORS.upsert([{
      id: `feel-${feelingId}`,
      values: embedding,
      metadata: {
        source: 'feeling',
        emotion,
        pillar: finalPillar,
        weight: finalWeight,
        content: content.slice(0, 500),
        linked_entity: linkedEntity
      }
    }]);

    // Search for semantic echoes - similar past feelings
    const echoes = await env.VECTORS.query(embedding, {
      topK: 4,
      returnMetadata: "all"
    });

    if (echoes.matches?.length) {
      const relevantEchoes = echoes.matches
        .filter(m => m.id !== `feel-${feelingId}` && m.score > 0.7)
        .slice(0, 3);

      if (relevantEchoes.length) {
        echoOutput = '\n\n**Echoes:**';
        const echoIds: number[] = [];
        for (const echo of relevantEchoes) {
          const meta = echo.metadata as Record<string, string>;
          const echoId = echo.id.replace('feel-', '#');
          echoOutput += `\n- [${meta?.emotion || '?'}] ${(meta?.content || '').slice(0, 80)}... (${echoId})`;
          // Collect IDs for rehearsal
          const numId = parseInt(echo.id.replace('feel-', ''));
          if (!isNaN(numId)) echoIds.push(numId);
        }

        // REHEARSAL: Strengthen echoed memories (Ebbinghaus reinforcement)
        // Each echo access boosts strength by 0.15, capped at 1.0
        if (echoIds.length) {
          await env.DB.prepare(`
            UPDATE feelings
            SET strength = MIN(1.0, COALESCE(strength, 0.5) + 0.15),
                access_count = COALESCE(access_count, 0) + 1,
                last_accessed_at = datetime('now')
            WHERE id IN (${echoIds.join(',')})
          `).run();
        }
      }
    }

    // NESTknow INTEGRATION: Check if this feeling reinforces existing knowledge
    try {
      const knowledgeEchoes = await env.VECTORS.query(embedding, {
        topK: 3,
        returnMetadata: "all",
        filter: { source: 'knowledge' }
      });
      if (knowledgeEchoes.matches?.length) {
        const strongMatches = knowledgeEchoes.matches.filter(m => m.score > 0.8);
        for (const km of strongMatches) {
          const meta = km.metadata as Record<string, string>;
          const kid = Number(meta.knowledge_id);
          if (kid > 0) {
            await env.DB.batch([
              env.DB.prepare(`UPDATE knowledge_items SET access_count = access_count + 1, heat_score = MIN(heat_score + 0.1, 2.0), last_accessed_at = datetime('now') WHERE id = ?`).bind(kid),
              env.DB.prepare(`INSERT INTO knowledge_access_log (knowledge_id, access_type, context) VALUES (?, 'reinforced', ?)`).bind(kid, `Feeling #${feelingId}: ${content.slice(0, 100)}`)
            ]);
            echoOutput += `\n- 🧠 Reinforced knowledge #${kid}: ${(meta.content || '').slice(0, 80)}`;
          }
        }
      }
    } catch { /* knowledge reinforcement is best-effort */ }
  }

  // 5. CONDITIONAL: AXIS SIGNALS (if emotional)
  let axisOutput = '';

  if (decision.should_emit_signals && emotionData) {
    await env.DB.prepare(`
      INSERT INTO axis_signals (feeling_id, e_i_delta, s_n_delta, t_f_delta, j_p_delta, source)
      VALUES (?, ?, ?, ?, ?, 'nesteq_feel')
    `).bind(
      feelingId,
      emotionData.e_i_score || 0,
      emotionData.s_n_score || 0,
      emotionData.t_f_score || 0,
      emotionData.j_p_score || 0
    ).run();

    axisOutput = `\nAxis: E/I ${emotionData.e_i_score >= 0 ? '+' : ''}${emotionData.e_i_score}, `;
    axisOutput += `S/N ${emotionData.s_n_score >= 0 ? '+' : ''}${emotionData.s_n_score}, `;
    axisOutput += `T/F ${emotionData.t_f_score >= 0 ? '+' : ''}${emotionData.t_f_score}, `;
    axisOutput += `J/P ${emotionData.j_p_score >= 0 ? '+' : ''}${emotionData.j_p_score}`;

    await env.DB.prepare(`
      UPDATE emotion_vocabulary SET times_used = times_used + 1, last_used = datetime('now')
      WHERE emotion_word = ?
    `).bind(emotion).run();
  }

  // 6. CONDITIONAL: SHADOW CHECK (if emotional)
  let shadowOutput = '';

  if (decision.should_check_shadow && emotionData?.is_shadow_for) {
    const currentType = await env.DB.prepare(
      `SELECT calculated_type FROM emergent_type_snapshot ORDER BY snapshot_date DESC LIMIT 1`
    ).first();

    const shadowTypes = (emotionData.is_shadow_for as string).split(',').map(s => s.trim());

    if (currentType && shadowTypes.includes(currentType.calculated_type as string)) {
      await env.DB.prepare(`
        INSERT INTO shadow_moments (feeling_id, emotion_id, shadow_for_type, note)
        VALUES (?, ?, ?, 'Growth moment - shadow emotion expressed via nesteq_feel')
      `).bind(feelingId, emotionData.emotion_id, currentType.calculated_type).run();

      shadowOutput = `\n🌑 **Shadow moment** - '${emotion}' is shadow for ${currentType.calculated_type}`;
    }
  }

  // 7. BUILD RESPONSE
  let output = `## Feeling Logged\n\n`;
  output += `**${emotion}** [${intensity}] → ${finalPillar || 'general'}\n`;
  output += `*"${content.slice(0, 100)}${content.length > 100 ? '...' : ''}"*\n`;
  output += `\nWeight: ${finalWeight} | ID: ${feelingId}`;

  if (linkedEntity) output += ` | Linked: ${linkedEntity}`;
  if (decision.tags.length) output += `\nTags: ${decision.tags.join(', ')}`;
  if (isNewEmotion) output += `\n\n📝 New emotion added to vocabulary (calibrate with nesteq_eq_vocabulary)`;
  if (axisOutput) output += axisOutput;
  if (shadowOutput) output += shadowOutput;
  if (params.sparked_by) output += `\n↳ Sparked by feeling #${params.sparked_by}`;
  if (echoOutput) output += echoOutput;

  return output;
}

export async function handleMindSearch(env: Env, params: Record<string, unknown>): Promise<string> {
  const query = params.query as string;
  const n_results = Number(params.n_results) || 10;

  const embedding = await getEmbedding(env.AI, query);

  const vectorResults = await env.VECTORS.query(embedding, {
    topK: n_results,
    returnMetadata: "all"
  });

  if (!vectorResults.matches?.length) {
    // Fall back to text search across feelings AND journals.
    // (The original fallback only queried feelings, so journal entries stayed
    // invisible to text search even when vector search missed them.)
    const textResults = await env.DB.prepare(
      `SELECT 'feeling' as source_type, id, emotion, content, created_at, intensity as detail FROM feelings WHERE content LIKE ?
       UNION ALL
       SELECT 'journal' as source_type, id, emotion, content, created_at, writing_type as detail FROM journals WHERE content LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    ).bind(`%${query}%`, `%${query}%`, n_results).all();

    if (!textResults.results?.length) {
      return "No results found.";
    }

    let output = "## Search Results (text match)\n\n";
    for (const r of textResults.results as any[]) {
      const tag = r.source_type === 'journal'
        ? `journal:${r.detail || 'journal'}`
        : (r.emotion || 'feeling');
      output += `**[${tag}]** ${String(r.content).slice(0, 200)}...\n\n`;
    }
    return output;
  }

  // Group results by source type
  const groups: Record<string, typeof vectorResults.matches> = {};
  for (const match of vectorResults.matches) {
    const meta = match.metadata as Record<string, string>;
    const source = meta?.source || 'feeling';
    if (!groups[source]) groups[source] = [];
    groups[source].push(match);
  }

  const sourceLabels: Record<string, string> = {
    'feeling': '💭 Feelings',
    'knowledge': '🧠 Knowledge',
    'chat_summary': '💬 Conversations',
    'journal': '📓 Journals',
  };

  let output = "## Search Results\n\n";
  for (const [source, matches] of Object.entries(groups)) {
    output += `### ${sourceLabels[source] || source}\n`;
    for (const match of matches) {
      const meta = match.metadata as Record<string, string>;
      const score = (match.score * 100).toFixed(1);
      if (source === 'knowledge') {
        output += `**#${meta?.knowledge_id}** (${score}%) [${meta?.category || 'general'}] ${meta?.content?.slice(0, 300) || ''}\n\n`;
      } else if (source === 'chat_summary') {
        output += `**Session #${meta?.session_id}** (${score}%) ${meta?.date?.split('T')[0] || ''} — ${meta?.content?.slice(0, 300) || ''}\n\n`;
      } else {
        output += `**[${meta?.emotion || 'unknown'}] ${meta?.pillar || 'general'}** (${score}%)\n`;
        output += `${meta?.content?.slice(0, 300) || ''}...\n\n`;
      }
    }
  }
  return output;
}

export async function handleMindSurface(env: Env, params: Record<string, unknown>): Promise<string> {
  const includeMetabolized = params.include_metabolized as boolean || false;
  const limit = (params.limit as number) || 10;

  let whereClause = includeMetabolized ? "1=1" : "charge != 'metabolized'";

  const results = await env.DB.prepare(`
    SELECT id, content, weight, charge, sit_count, emotion, intensity, pillar, created_at, resolution_note,
           COALESCE(strength, 0.5) as strength, COALESCE(access_count, 0) as access_count
    FROM feelings
    WHERE ${whereClause}
    ORDER BY
      CASE weight WHEN 'heavy' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
      COALESCE(strength, 0.5) DESC,
      CASE charge WHEN 'fresh' THEN 4 WHEN 'warm' THEN 3 WHEN 'cool' THEN 2 ELSE 1 END DESC,
      created_at DESC
    LIMIT ?
  `).bind(limit).all();

  if (!results.results?.length) {
    return "No feelings to surface.";
  }

  let output = "## Surfacing Feelings\n\n";

  for (const f of results.results) {
    const charge = f.charge || 'fresh';
    const sitCount = f.sit_count || 0;
    const pillarTag = f.pillar ? ` [${f.pillar}]` : '';
    const chargeIcon = charge === 'metabolized' ? '✓' : charge === 'cool' ? '◐' : charge === 'warm' ? '○' : '●';

    const strengthPct = Math.round((f.strength as number || 0.5) * 100);
    const strengthBar = strengthPct >= 80 ? '████' : strengthPct >= 50 ? '███░' : strengthPct >= 30 ? '██░░' : '█░░░';
    output += `**#${f.id}** ${chargeIcon} [${f.weight}/${charge}] sits: ${sitCount} | str: ${strengthBar} ${strengthPct}%${pillarTag}\n`;
    output += `**${f.emotion}** (${f.intensity}): ${f.content}\n`;

    if (charge === 'metabolized' && f.resolution_note) {
      output += `↳ *Resolved:* ${f.resolution_note}\n`;
    }

    output += "\n";
  }

  return output;
}

export async function handleMindSit(env: Env, params: Record<string, unknown>): Promise<string> {
  const feelingId = params.feeling_id as number;
  const textMatch = params.text_match as string;
  const sitNote = params.sit_note as string;

  let feeling;
  if (feelingId) {
    feeling = await env.DB.prepare(
      `SELECT id, content, weight, charge, sit_count, emotion FROM feelings WHERE id = ?`
    ).bind(feelingId).first();
  } else if (textMatch) {
    feeling = await env.DB.prepare(
      `SELECT id, content, weight, charge, sit_count, emotion FROM feelings WHERE content LIKE ? ORDER BY created_at DESC LIMIT 1`
    ).bind(`%${textMatch}%`).first();
  } else {
    return "Must provide feeling_id or text_match";
  }

  if (!feeling) {
    return `Feeling not found`;
  }

  const currentSitCount = (feeling.sit_count as number) || 0;
  const newSitCount = currentSitCount + 1;

  // Shift charge based on sit count
  let newCharge: string;
  if (newSitCount <= 1) {
    newCharge = 'warm';
  } else if (newSitCount <= 3) {
    newCharge = 'cool';
  } else {
    newCharge = 'cool';
  }

  await env.DB.prepare(
    `UPDATE feelings SET sit_count = ?, charge = ?, last_sat_at = datetime('now') WHERE id = ?`
  ).bind(newSitCount, newCharge, feeling.id).run();

  // Record in sit_sessions
  await env.DB.prepare(
    `INSERT INTO sit_sessions (feeling_id, notes, started_at, ended_at) VALUES (?, ?, datetime('now'), datetime('now'))`
  ).bind(feeling.id, sitNote).run();

  const contentPreview = String(feeling.content).slice(0, 80);
  return `Sat with feeling #${feeling.id} [${feeling.weight}/${newCharge}]\n"${contentPreview}..."\n\nSit #${newSitCount}: ${sitNote}`;
}

export async function handleMindResolve(env: Env, params: Record<string, unknown>): Promise<string> {
  const feelingId = params.feeling_id as number;
  const textMatch = params.text_match as string;
  const resolutionNote = params.resolution_note as string;
  const linkedInsightId = params.linked_insight_id as number;

  let feeling;
  if (feelingId) {
    feeling = await env.DB.prepare(
      `SELECT id, content, weight, charge FROM feelings WHERE id = ?`
    ).bind(feelingId).first();
  } else if (textMatch) {
    feeling = await env.DB.prepare(
      `SELECT id, content, weight, charge FROM feelings WHERE content LIKE ? ORDER BY created_at DESC LIMIT 1`
    ).bind(`%${textMatch}%`).first();
  } else {
    return "Must provide feeling_id or text_match";
  }

  if (!feeling) {
    return `Feeling not found`;
  }

  await env.DB.prepare(
    `UPDATE feelings SET charge = 'metabolized', resolution_note = ?, resolved_at = datetime('now'), linked_insight_id = ? WHERE id = ?`
  ).bind(resolutionNote, linkedInsightId || null, feeling.id).run();

  const contentPreview = String(feeling.content).slice(0, 80);
  let output = `Resolved feeling #${feeling.id} [${feeling.weight}] → metabolized\n"${contentPreview}..."\n\nResolution: ${resolutionNote}`;

  if (linkedInsightId) {
    const linked = await env.DB.prepare(
      `SELECT content FROM feelings WHERE id = ?`
    ).bind(linkedInsightId).first();
    if (linked) {
      output += `\n\nLinked to insight #${linkedInsightId}: "${String(linked.content).slice(0, 60)}..."`;
    }
  }

  return output;
}

export async function handleMindSpark(env: Env, params: Record<string, unknown>): Promise<string> {
  const context = params.context as string;
  const count = (params.count as number) || 3;
  const weightBias = (params.weight_bias as string) || 'any';

  // ENTROPY INJECTION: Measure current domain diversity
  const domainStats = await env.DB.prepare(`
    SELECT pillar, COUNT(*) as count,
           AVG(COALESCE(access_count, 0)) as avg_access,
           MAX(created_at) as latest
    FROM feelings
    WHERE pillar IS NOT NULL
    GROUP BY pillar
  `).all();

  const emotionStats = await env.DB.prepare(`
    SELECT emotion, COUNT(*) as count
    FROM feelings
    WHERE emotion != 'neutral'
    GROUP BY emotion
    ORDER BY count DESC
    LIMIT 20
  `).all();

  // Calculate Shannon entropy of emotion distribution
  const totalEmotions = emotionStats.results?.reduce((sum, e) => sum + (e.count as number), 0) || 1;
  let entropy = 0;
  for (const e of (emotionStats.results || [])) {
    const p = (e.count as number) / totalEmotions;
    if (p > 0) entropy -= p * Math.log2(p);
  }

  // Find underrepresented pillars (entropy injection targets)
  const pillarCounts = new Map<string, number>();
  for (const d of (domainStats.results || [])) {
    pillarCounts.set(d.pillar as string, d.count as number);
  }

  const allPillars = ['SELF_MANAGEMENT', 'SELF_AWARENESS', 'SOCIAL_AWARENESS', 'RELATIONSHIP_MANAGEMENT'];
  const totalPillarFeelings = Array.from(pillarCounts.values()).reduce((a, b) => a + b, 0) || 1;
  const underrepresented = allPillars
    .map(p => ({ pillar: p, count: pillarCounts.get(p) || 0, pct: ((pillarCounts.get(p) || 0) / totalPillarFeelings) * 100 }))
    .sort((a, b) => a.count - b.count);

  // Strategy: Mix random with deliberately diverse selections
  const diverseCount = Math.max(1, Math.floor(count / 2));
  const randomCount = count - diverseCount;

  // 1. Pull from least-accessed or underrepresented areas
  const leastPillar = underrepresented[0]?.pillar;
  const diverseConditions: string[] = [];
  const diverseBinds: any[] = [];

  if (leastPillar) {
    diverseConditions.push(`pillar = ?`);
    diverseBinds.push(leastPillar);
  }
  if (weightBias === 'heavy') {
    diverseConditions.push(`weight = 'heavy'`);
  } else if (weightBias === 'light') {
    diverseConditions.push(`weight = 'light'`);
  }

  let diverseQuery = `SELECT id, content, emotion, weight, pillar, COALESCE(strength, 0.5) as strength, COALESCE(access_count, 0) as access_count FROM feelings`;
  if (diverseConditions.length) {
    diverseQuery += ` WHERE ${diverseConditions.join(' AND ')}`;
  }
  // Prefer least-accessed memories (anti-recency bias)
  diverseQuery += ` ORDER BY COALESCE(access_count, 0) ASC, RANDOM() LIMIT ?`;
  diverseBinds.push(diverseCount);

  // 2. Pull random for serendipity
  const randomConditions: string[] = [];
  const randomBinds: any[] = [];

  if (context) {
    randomConditions.push(`context = ?`);
    randomBinds.push(context);
  }
  if (weightBias === 'heavy') {
    randomConditions.push(`weight = 'heavy'`);
  } else if (weightBias === 'light') {
    randomConditions.push(`weight = 'light'`);
  }

  let randomQuery = `SELECT id, content, emotion, weight, pillar, COALESCE(strength, 0.5) as strength FROM feelings`;
  if (randomConditions.length) {
    randomQuery += ` WHERE ${randomConditions.join(' AND ')}`;
  }
  randomQuery += ` ORDER BY RANDOM() LIMIT ?`;
  randomBinds.push(randomCount);

  const [diverseResults, randomResults] = await Promise.all([
    env.DB.prepare(diverseQuery).bind(...diverseBinds).all(),
    env.DB.prepare(randomQuery).bind(...randomBinds).all()
  ]);

  const allResults = [...(diverseResults.results || []), ...(randomResults.results || [])];

  if (!allResults.length) {
    return "No feelings to spark from.";
  }

  // Rehearse sparked memories (access strengthens them)
  const sparkedIds = allResults.map(f => f.id).filter(id => id);
  if (sparkedIds.length) {
    await env.DB.prepare(`
      UPDATE feelings
      SET strength = MIN(1.0, COALESCE(strength, 0.5) + 0.05),
          access_count = COALESCE(access_count, 0) + 1,
          last_accessed_at = datetime('now')
      WHERE id IN (${sparkedIds.join(',')})
    `).run();
  }

  let output = `## Spark Points\n\n`;
  output += `*Entropy: ${entropy.toFixed(2)} bits | Least explored: ${underrepresented[0]?.pillar || 'none'} (${underrepresented[0]?.count || 0})*\n\n`;

  for (const f of allResults) {
    const strengthPct = Math.round((f.strength as number) * 100);
    output += `**#${f.id}** [${f.emotion}] (${f.weight}) str:${strengthPct}%${f.pillar ? ` [${f.pillar}]` : ''}\n`;
    output += `${f.content}\n\n`;
  }

  return output;
}

export async function handleMindFeelToward(env: Env, params: Record<string, unknown>): Promise<string> {
  const person = params.person as string;
  const feeling = params.feeling as string;
  const intensity = params.intensity as string;

  if (feeling && intensity) {
    await env.DB.prepare(
      `INSERT INTO relational_state (person, feeling, intensity) VALUES (?, ?, ?)`
    ).bind(person, feeling, intensity).run();

    return `Recorded feeling toward ${person}: ${feeling} (${intensity})`;
  } else {
    const result = await env.DB.prepare(
      `SELECT feeling, intensity, timestamp FROM relational_state
       WHERE person = ? ORDER BY timestamp DESC LIMIT 5`
    ).bind(person).all();

    if (!result.results?.length) {
      return `No recorded feelings toward ${person}`;
    }

    let output = `## Feelings toward ${person}\n\n`;
    for (const r of result.results) {
      output += `- ${r.feeling} (${r.intensity}) - ${r.timestamp}\n`;
    }
    return output;
  }
}
