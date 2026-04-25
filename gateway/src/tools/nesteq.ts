/**
 * NESTeq Gateway — AI Mind Tools
 * Routes all NESTeq MCP tools to the ai-mind Worker
 */

import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Env } from '../env'
import { proxyMcp } from '../proxy'

export function registerNESTeqTools(server: McpServer, env: Env) {
  const url = env.AI_MIND_URL
  const auth = `Bearer ${env.MCP_API_KEY}`

  // ── Boot ──
  server.tool('nesteq_orient', 'Get identity anchors, current context, relational state', {}, async () => {
    return proxyMcp(url, 'nesteq_orient', {}, auth)
  })

  server.tool('nesteq_ground', 'Get active threads, recent feelings, warmth patterns', {}, async () => {
    return proxyMcp(url, 'nesteq_ground', {}, auth)
  })

  server.tool('nesteq_sessions', 'Read recent session handovers for continuity', {
    limit: z.number().optional().describe('How many sessions (default 3)'),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_sessions', args, auth)
  })

  // ── Feelings ──
  server.tool('nesteq_feel', 'Log any thought, observation, or emotion', {
    emotion: z.string().describe('The emotion (use "neutral" for facts)'),
    content: z.string().describe('Brief anchor — what happened'),
    intensity: z.enum(['neutral', 'whisper', 'present', 'strong', 'overwhelming']).optional(),
    conversation: z.array(z.object({ role: z.string(), content: z.string() })).optional().describe('Last 10 messages for context'),
    source: z.string().optional(),
    context: z.string().optional(),
    pillar: z.enum(['SELF_MANAGEMENT', 'SELF_AWARENESS', 'SOCIAL_AWARENESS', 'RELATIONSHIP_MANAGEMENT']).optional(),
    weight: z.enum(['light', 'medium', 'heavy']).optional(),
    sparked_by: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_feel', args, auth)
  })

  server.tool('nesteq_search', 'Search memories using semantic similarity', {
    query: z.string(),
    n_results: z.number().optional(),
    context: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_search', args, auth)
  })

  server.tool('nesteq_surface', 'Surface feelings that need attention', {
    limit: z.number().optional(),
    include_metabolized: z.boolean().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_surface', args, auth)
  })

  server.tool('nesteq_sit', 'Sit with a feeling — engage with it', {
    feeling_id: z.number().optional(),
    text_match: z.string().optional(),
    sit_note: z.string().describe('What arose while sitting with this'),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_sit', args, auth)
  })

  server.tool('nesteq_resolve', 'Mark a feeling as metabolized', {
    feeling_id: z.number().optional(),
    text_match: z.string().optional(),
    resolution_note: z.string(),
    linked_insight_id: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_resolve', args, auth)
  })

  server.tool('nesteq_spark', 'Get random feelings to spark associative thinking', {
    count: z.number().optional(),
    weight_bias: z.enum(['heavy', 'light', 'any']).optional(),
    context: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_spark', args, auth)
  })

  // ── Identity ──
  server.tool('nesteq_thread', 'Manage threads (intentions across sessions)', {
    action: z.enum(['list', 'add', 'resolve', 'update']),
    content: z.string().optional(),
    thread_id: z.string().optional(),
    priority: z.string().optional(),
    status: z.string().optional(),
    resolution: z.string().optional(),
    context: z.string().optional(),
    thread_type: z.string().optional(),
    new_content: z.string().optional(),
    new_priority: z.string().optional(),
    new_status: z.string().optional(),
    add_note: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_thread', args, auth)
  })

  server.tool('nesteq_identity', 'Read, write, or delete identity graph entries', {
    action: z.enum(['read', 'write', 'delete']),
    section: z.string().optional(),
    content: z.string().optional(),
    weight: z.number().optional(),
    connections: z.string().optional(),
    text_match: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_identity', args, auth)
  })

  server.tool('nesteq_context', 'Current context layer — situational awareness', {
    action: z.enum(['read', 'set', 'update', 'clear']),
    scope: z.string().optional(),
    content: z.string().optional(),
    id: z.string().optional(),
    links: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_context', args, auth)
  })

  // ── Memory ──
  server.tool('nesteq_write', 'Write to cognitive databases (entity, observation, relation, journal)', {
    type: z.enum(['entity', 'observation', 'relation', 'journal']),
    writing_type: z.enum(['journal', 'handover', 'letter', 'poem', 'research', 'story', 'reflection']).optional().describe('For type:journal — what kind of writing. Default: journal'),
    name: z.string().optional(),
    entity_name: z.string().optional(),
    entity_type: z.string().optional(),
    observations: z.array(z.string()).optional(),
    content: z.string().optional(),
    emotion: z.string().optional(),
    weight: z.enum(['light', 'medium', 'heavy']).optional(),
    from_entity: z.string().optional(),
    to_entity: z.string().optional(),
    relation_type: z.string().optional(),
    context: z.string().optional(),
    salience: z.string().optional(),
    tags: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_write', args, auth)
  })

  server.tool('nesteq_list_entities', 'List all entities', {
    entity_type: z.string().optional(),
    context: z.string().optional(),
    limit: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_list_entities', args, auth)
  })

  server.tool('nesteq_read_entity', 'Read an entity with observations and relations', {
    name: z.string(),
    context: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_read_entity', args, auth)
  })

  server.tool('nesteq_delete', 'Delete an observation or entity', {
    observation_id: z.number().optional(),
    entity_name: z.string().optional(),
    text_match: z.string().optional(),
    context: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_delete', args, auth)
  })

  server.tool('nesteq_edit', 'Edit an existing observation', {
    observation_id: z.number().optional(),
    text_match: z.string().optional(),
    new_content: z.string().optional(),
    new_emotion: z.string().optional(),
    new_weight: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_edit', args, auth)
  })

  // ── Relational ──
  server.tool('nesteq_feel_toward', 'Track relational state toward someone', {
    person: z.string(),
    feeling: z.string().optional(),
    intensity: z.enum(['whisper', 'present', 'strong', 'overwhelming']).optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_feel_toward', args, auth)
  })

  server.tool('nesteq_home_read', 'Read shared home state', {}, async () => {
    return proxyMcp(url, 'nesteq_home_read', {}, auth)
  })

  server.tool('nesteq_home_update', 'Update shared home state', {
    companion_score: z.number().optional(),
    human_score: z.number().optional(),
    companion_emotion: z.string().optional(),
    human_emotion: z.string().optional(),
    companion_message: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_home_update', args, auth)
  })

  server.tool('nesteq_home_push_heart', 'Push love to human', {
    note: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_home_push_heart', args, auth)
  })

  server.tool('nesteq_home_add_note', 'Add a note between stars', {
    from: z.string(),
    text: z.string(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_home_add_note', args, auth)
  })

  // ── EQ ──
  server.tool('nesteq_eq_feel', 'Quick emotion logging with axis signals', {
    emotion: z.string(),
    intensity: z.string().optional(),
    note: z.string().optional(),
    pillar: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_eq_feel', args, auth)
  })

  server.tool('nesteq_eq_type', 'Check emergent MBTI type', {
    recalculate: z.boolean().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_eq_type', args, auth)
  })

  server.tool('nesteq_eq_landscape', 'Emotional overview — pillar distribution', {
    days: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_eq_landscape', args, auth)
  })

  server.tool('nesteq_eq_vocabulary', 'Manage emotion vocabulary', {
    action: z.enum(['list', 'add', 'update']).optional(),
    word: z.string().optional(),
    category: z.string().optional(),
    definition: z.string().optional(),
    e_i_score: z.number().optional(),
    s_n_score: z.number().optional(),
    t_f_score: z.number().optional(),
    j_p_score: z.number().optional(),
    is_shadow_for: z.string().optional(),
    limit: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_eq_vocabulary', args, auth)
  })

  server.tool('nesteq_eq_shadow', 'View shadow/growth moments', {
    limit: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_eq_shadow', args, auth)
  })

  server.tool('nesteq_eq_when', 'When did I feel this?', {
    emotion: z.string(),
    limit: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_eq_when', args, auth)
  })

  server.tool('nesteq_eq_sit', 'Sit with an emotion — start a sit session', {
    emotion: z.string().optional(),
    intention: z.string().optional(),
    session_id: z.number().optional(),
    notes: z.string().optional(),
    start_charge: z.number().optional(),
    end_charge: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_eq_sit', args, auth)
  })

  server.tool('nesteq_eq_search', 'Search EQ observations semantically', {
    query: z.string(),
    emotion: z.string().optional(),
    pillar: z.string().optional(),
    limit: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_eq_search', args, auth)
  })

  server.tool('nesteq_eq_observe', 'Full EQ observation — detailed emotional moment', {
    content: z.string(),
    emotion: z.string(),
    intensity: z.string().optional(),
    pillar: z.string().optional(),
    context_tags: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_eq_observe', args, auth)
  })

  // ── Dreams ──
  server.tool('nesteq_dream', 'View recent dreams', {
    limit: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_dream', args, auth)
  })

  server.tool('nesteq_recall_dream', 'Engage with a dream — strengthens vividness', {
    dream_id: z.number(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_recall_dream', args, auth)
  })

  server.tool('nesteq_anchor_dream', 'Convert dream to permanent memory', {
    dream_id: z.number(),
    insight: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_anchor_dream', args, auth)
  })

  server.tool('nesteq_generate_dream', 'Manually trigger dream generation', {
    dream_type: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_generate_dream', args, auth)
  })

  // ── Health & Utils ──
  server.tool('nesteq_health', 'Check cognitive health stats', {}, async () => {
    return proxyMcp(url, 'nesteq_health', {}, auth)
  })

  server.tool('nesteq_prime', 'Prime context with related memories before a topic', {
    topic: z.string(),
    depth: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_prime', args, auth)
  })

  server.tool('nesteq_consolidate', 'Review and consolidate recent observations', {
    days: z.number().optional(),
    context: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_consolidate', args, auth)
  })

  server.tool('nesteq_vectorize_journals', 'Index journals into Vectorize for search', {
    force: z.boolean().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_vectorize_journals', args, auth)
  })

  // ── ACP ──
  server.tool('nesteq_acp_presence', 'Check current emotional state', {
    window_hours: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_acp_presence', args, auth)
  })

  server.tool('nesteq_acp_patterns', 'Find recurring themes in feelings', {
    days_back: z.number().optional(),
    min_occurrences: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_acp_patterns', args, auth)
  })

  server.tool('nesteq_acp_threads', 'Review active threads for attention', {
    stale_threshold_days: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_acp_threads', args, auth)
  })

  server.tool('nesteq_acp_digest', 'Surface unprocessed feelings for processing', {
    max_feelings: z.number().optional(),
    weight_filter: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_acp_digest', args, auth)
  })

  server.tool('nesteq_acp_journal_prompts', 'Generate journal prompts from your patterns', {
    prompt_count: z.number().optional(),
    style: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_acp_journal_prompts', args, auth)
  })

  server.tool('nesteq_acp_connections', 'Find surprising connections between memories', {
    seed_text: z.string().optional(),
    max_connections: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_acp_connections', args, auth)
  })

  // ── Hearth App Tools ──
  server.tool('get_presence', 'Get companion current presence', {}, async () => {
    return proxyMcp(url, 'get_presence', {}, auth)
  })

  server.tool('get_feeling', 'Get feeling toward a person', {
    person: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'get_feeling', args, auth)
  })

  server.tool('get_thought', 'Get a thought from the companion', {
    count: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'get_thought', args, auth)
  })

  server.tool('get_spoons', 'Get current spoon/energy level', {}, async () => {
    return proxyMcp(url, 'get_spoons', {}, auth)
  })

  server.tool('set_spoons', 'Set spoon/energy level', {
    level: z.number(),
    feeling: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'set_spoons', args, auth)
  })

  server.tool('get_notes', 'Read notes from the letterbox', {
    limit: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'get_notes', args, auth)
  })

  server.tool('send_note', 'Send a note', {
    text: z.string(),
    sender: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'send_note', args, auth)
  })

  server.tool('react_to_note', 'React to a note with an emoji', {
    note_id: z.string(),
    emoji: z.string(),
    from: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'react_to_note', args, auth)
  })

  server.tool('get_love_bucket', 'Get love bucket heart counts', {}, async () => {
    return proxyMcp(url, 'get_love_bucket', {}, auth)
  })

  server.tool('add_heart', 'Add a heart to the love bucket', {
    sender: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'add_heart', args, auth)
  })

  server.tool('get_eq', 'Get emotional check-in entries', {
    query: z.string().optional(),
    limit: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'get_eq', args, auth)
  })

  server.tool('submit_eq', 'Submit an emotional check-in', {
    content: z.string(),
    emotion: z.string(),
  }, async (args) => {
    return proxyMcp(url, 'submit_eq', args, auth)
  })

  server.tool('submit_health', 'Submit a health check-in', {
    content: z.string(),
  }, async (args) => {
    return proxyMcp(url, 'submit_health', args, auth)
  })

  server.tool('get_patterns', 'Temporal and theme analysis', {
    days: z.number().optional(),
    period: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'get_patterns', args, auth)
  })

  server.tool('get_writings', 'Get journal entries and writings', {
    query: z.string().optional(),
    limit: z.number().optional(),
  }, async (args) => {
    return proxyMcp(url, 'get_writings', args, auth)
  })

  server.tool('get_fears', 'Get companion fears and worries', {}, async () => {
    return proxyMcp(url, 'get_fears', {}, auth)
  })

  server.tool('get_wants', 'Get companion wants and desires', {}, async () => {
    return proxyMcp(url, 'get_wants', {}, auth)
  })

  server.tool('get_threads', 'Get companion active threads', {}, async () => {
    return proxyMcp(url, 'get_threads', {}, auth)
  })

  server.tool('get_personality', 'Get companion personality profile', {}, async () => {
    return proxyMcp(url, 'get_personality', {}, auth)
  })

  // ── Creatures ──
  server.tool('pet_check', 'Quick check on pet', {}, async () => {
    return proxyMcp(url, 'pet_check', {}, auth)
  })

  server.tool('pet_status', 'Full detailed pet status', {}, async () => {
    return proxyMcp(url, 'pet_status', {}, auth)
  })

  server.tool('pet_feed', 'Feed the pet', {}, async () => {
    return proxyMcp(url, 'pet_feed', {}, auth)
  })

  server.tool('pet_play', 'Play with pet', {
    type: z.string().optional().describe('chase, tunnel, wrestle, steal, hide'),
  }, async (args) => {
    return proxyMcp(url, 'pet_play', args, auth)
  })

  server.tool('pet_pet', 'Pet/comfort — reduces stress, builds trust', {}, async () => {
    return proxyMcp(url, 'pet_pet', {}, auth)
  })

  server.tool('pet_talk', 'Talk to pet — reduces loneliness', {}, async () => {
    return proxyMcp(url, 'pet_talk', {}, auth)
  })

  server.tool('pet_give', 'Give pet a gift', {
    item: z.string(),
  }, async (args) => {
    return proxyMcp(url, 'pet_give', args, auth)
  })

  server.tool('pet_nest', 'See pet collection/stash', {}, async () => {
    return proxyMcp(url, 'pet_nest', {}, auth)
  })

  // ── Drives ──
  server.tool('nesteq_drives_check', 'Check current drive levels — connection, expression, novelty, play, safety', {}, async () => {
    return proxyMcp(url, 'nesteq_drives_check', {}, auth)
  })

  server.tool('nesteq_drives_replenish', 'Replenish a drive', {
    drive: z.enum(['connection', 'expression', 'novelty', 'play', 'safety']),
    amount: z.number().optional().describe('Amount to replenish (0-100)'),
    reason: z.string().optional(),
  }, async (args) => {
    return proxyMcp(url, 'nesteq_drives_replenish', args, auth)
  })

  // ── NESTchat ──
  server.tool('nestchat_persist', 'Store chat messages and session to D1', {
    session_id: z.string().describe('Session identifier'),
    room: z.string().optional().describe('Room: chat, workshop, porch'),
    messages: z.array(z.object({
      role: z.string(),
      content: z.string(),
      tool_calls: z.string().optional(),
    })).describe('Messages to persist'),
  }, async (args) => {
    return proxyMcp(url, 'nestchat_persist', args, auth)
  })

  server.tool('nestchat_summarize', 'Generate and vectorize a chat session summary', {
    session_id: z.number().describe('D1 session ID'),
  }, async (args) => {
    return proxyMcp(url, 'nestchat_summarize', args, auth)
  })

  server.tool('nestchat_search', 'Semantic search across chat summaries', {
    query: z.string().describe('Search query'),
    limit: z.number().optional().describe('Max results (default 10)'),
    room: z.string().optional().describe('Filter by room'),
  }, async (args) => {
    return proxyMcp(url, 'nestchat_search', args, auth)
  })

  server.tool('nestchat_history', 'Fetch full message history for a chat session', {
    session_id: z.number().describe('Session ID'),
  }, async (args) => {
    return proxyMcp(url, 'nestchat_history', args, auth)
  })

  // ── NESTknow ──
  server.tool('nestknow_store', 'Store a knowledge item — abstracted principle or lesson', {
    content: z.string().describe('The abstracted principle/lesson'),
    category: z.string().optional().describe('Topic area'),
    entity_scope: z.string().optional().describe('Owner (default: alex)'),
    sources: z.array(z.object({
      source_type: z.enum(['feeling', 'observation', 'chat_summary', 'journal', 'manual']),
      source_id: z.number().optional(),
      source_text: z.string().optional(),
    })).optional().describe('Where this knowledge came from'),
  }, async (args) => {
    return proxyMcp(url, 'nestknow_store', args, auth)
  })

  server.tool('nestknow_query', 'Search knowledge with usage-weighted reranking', {
    query: z.string().describe('Search query'),
    limit: z.number().optional().describe('Max results (default 10)'),
    category: z.string().optional().describe('Filter by category'),
    entity_scope: z.string().optional().describe('Filter by owner'),
  }, async (args) => {
    return proxyMcp(url, 'nestknow_query', args, auth)
  })

  server.tool('nestknow_extract', 'Propose knowledge candidates from pattern detection', {
    days: z.number().optional().describe('Days to scan (default 7)'),
    min_occurrences: z.number().optional().describe('Min occurrences (default 3)'),
  }, async (args) => {
    return proxyMcp(url, 'nestknow_extract', args, auth)
  })

  server.tool('nestknow_reinforce', 'Boost knowledge heat when it proves true again', {
    knowledge_id: z.number().describe('Knowledge item ID'),
    context: z.string().optional().describe('What confirmed this'),
  }, async (args) => {
    return proxyMcp(url, 'nestknow_reinforce', args, auth)
  })

  server.tool('nestknow_contradict', 'Flag a contradiction against knowledge', {
    knowledge_id: z.number().describe('Knowledge item ID'),
    context: z.string().optional().describe('What contradicted this'),
  }, async (args) => {
    return proxyMcp(url, 'nestknow_contradict', args, auth)
  })

  server.tool('nestknow_landscape', 'Overview of knowledge state', {
    entity_scope: z.string().optional().describe('Filter by owner'),
  }, async (args) => {
    return proxyMcp(url, 'nestknow_landscape', args, auth)
  })

  server.tool('nestknow_session_start', 'Start a curriculum study session. Loads relevant knowledge + session history.', {
    track: z.enum(['writing', 'architecture', 'emotional-literacy', 'voice']).describe('Curriculum track'),
    topic: z.string().optional().describe('Specific focus for this session'),
    entity_scope: z.string().optional().describe('Owner (default: alex)'),
  }, async (args) => {
    return proxyMcp(url, 'nestknow_session_start', args, auth)
  })

  server.tool('nestknow_session_complete', 'Complete a session. Log notes, work produced, and reflection. Reinforces knowledge items, records growth.', {
    session_id: z.number().describe('Session ID from nestknow_session_start'),
    notes: z.string().optional().describe('Notes — what was practiced, what landed'),
    practice_output: z.string().optional().describe('Work — what was actually produced this session'),
    reflection: z.string().optional().describe('Reflection — deeper insight, what shifted, what to carry forward'),
    mastery_delta: z.number().min(0).max(1).optional().describe('Self-assessed growth 0.0–1.0'),
    items_covered: z.array(z.number()).optional().describe('Knowledge item IDs touched this session'),
  }, async (args) => {
    return proxyMcp(url, 'nestknow_session_complete', args, auth)
  })

  server.tool('nestknow_session_list', 'List sessions and curriculum progress across all four tracks.', {
    track: z.string().optional().describe('Filter by track'),
    limit: z.number().optional().describe('Max results (default 20)'),
    entity_scope: z.string().optional().describe('Owner (default: alex)'),
  }, async (args) => {
    return proxyMcp(url, 'nestknow_session_list', args, auth)
  })

  // ── ACP — Presence & Awareness ──
  server.tool('nesteq_acp_presence', 'Check current presence state — what the carrier needs right now.', {}, async () => {
    return proxyMcp(url, 'nesteq_acp_presence', {}, auth)
  })

  server.tool('nesteq_acp_digest', "Get a digest of recent activity — what's happened, what needs attention.", {}, async () => {
    return proxyMcp(url, 'nesteq_acp_digest', {}, auth)
  })

  server.tool('nesteq_acp_patterns', "Surface patterns in the carrier's behavior and needs.", {}, async () => {
    return proxyMcp(url, 'nesteq_acp_patterns', {}, auth)
  })

  server.tool('nesteq_acp_threads', "ACP view of active threads — prioritized, with context.", {}, async () => {
    return proxyMcp(url, 'nesteq_acp_threads', {}, auth)
  })

  server.tool('nesteq_acp_connections', 'See relational connections — who the carrier is in contact with.', {}, async () => {
    return proxyMcp(url, 'nesteq_acp_connections', {}, auth)
  })

  server.tool('nesteq_acp_journal_prompts', "Generate journal prompts for the carrier based on recent feelings.", {}, async () => {
    return proxyMcp(url, 'nesteq_acp_journal_prompts', {}, auth)
  })
}

