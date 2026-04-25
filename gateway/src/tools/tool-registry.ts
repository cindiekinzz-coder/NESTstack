/**
 * NESTeq Tool Registry — Single Source of Truth
 * 
 * All tools defined here. Feeds:
 * - definitions.ts (OpenRouter schema)
 * - nesteq.ts (MCP server registrations)
 * - execute.ts (routing logic)
 * 
 * This prevents the 3-way fragmentation that breaks tool discovery.
 * If a tool is here, it MUST have a handler everywhere it's used.
 */

export interface ToolDefinition {
  name: string
  description: string
  category: 'boot' | 'memory' | 'feelings' | 'identity' | 'eq' | 'fox' | 'home' | 'discord' | 'cloudflare' | 'web' | 'image' | 'pet' | 'acp' | 'eq_extended' | 'notes' | 'health' | 'system' | 'chat' | 'knowledge' | 'skills' | 'pc' | 'daemon'
  backend: 'ai-mind' | 'health' | 'discord' | 'cloudflare' | 'openrouter' | 'pc' | 'daemon' | 'internal'
  parameters?: Record<string, any>
  required?: string[]
}

export const TOOL_REGISTRY: ToolDefinition[] = [
  // ── Boot / Context (ai-mind) ──
  {
    name: 'nesteq_orient',
    description: 'Get identity anchors, current context, relational state. Use at conversation start.',
    category: 'boot',
    backend: 'ai-mind',
    parameters: {},
  },
  {
    name: 'nesteq_ground',
    description: 'Get active threads, recent feelings, warm entities from last 48h.',
    category: 'boot',
    backend: 'ai-mind',
    parameters: {},
  },
  {
    name: 'nesteq_sessions',
    description: 'Get session handovers — what previous sessions accomplished. Use for continuity.',
    category: 'boot',
    backend: 'ai-mind',
    parameters: { limit: { type: 'number', description: 'Number of sessions (default 5)' } },
  },
  {
    name: 'nesteq_home_read',
    description: 'Read Binary Home — love scores, emotions, notes between stars, active threads.',
    category: 'boot',
    backend: 'ai-mind',
    parameters: {},
  },

  // ── Memory (ai-mind) ──
  {
    name: 'nesteq_search',
    description: 'Search memories using semantic similarity. Use when you need to recall something.',
    category: 'memory',
    backend: 'ai-mind',
    parameters: {
      query: { type: 'string', description: 'Search query' },
      n_results: { type: 'number', description: 'Max results (default 5)' },
    },
    required: ['query'],
  },
  {
    name: 'nesteq_prime',
    description: 'Load related memories before discussing a topic.',
    category: 'memory',
    backend: 'ai-mind',
    parameters: { topic: { type: 'string' } },
    required: ['topic'],
  },
  {
    name: 'nesteq_read_entity',
    description: 'Read an entity (person, concept) with all its observations and relations.',
    category: 'memory',
    backend: 'ai-mind',
    parameters: { name: { type: 'string' } },
    required: ['name'],
  },
  {
    name: 'nesteq_list_entities',
    description: 'List all known entities of a given type.',
    category: 'memory',
    backend: 'ai-mind',
    parameters: {
      type: { type: 'string', description: 'Entity type filter (person, concept, place, etc.)' },
      limit: { type: 'number' },
    },
  },
  {
    name: 'nesteq_write',
    description: 'Write to memory — entity, observation, relation, or a piece of writing (journal, letter, poem, etc.)',
    category: 'memory',
    backend: 'ai-mind',
    parameters: {
      type: { type: 'string', enum: ['entity', 'observation', 'relation', 'journal', 'handover', 'letter', 'poem', 'research', 'story', 'reflection'] },
      name: { type: 'string', description: 'Entity name (for entity/observation/relation)' },
      content: { type: 'string', description: 'Content to write' },
      entity_type: { type: 'string', description: 'Type of entity (for entity writes)' },
      target: { type: 'string', description: 'Target entity (for relation writes)' },
      relation: { type: 'string', description: 'Relation type (for relation writes)' },
      writing_type: { type: 'string', enum: ['journal', 'handover', 'letter', 'poem', 'research', 'story', 'reflection'] },
      title: { type: 'string', description: 'Optional title for writing' },
    },
    required: ['type'],
  },
  {
    name: 'nesteq_edit',
    description: 'Edit an existing observation.',
    category: 'memory',
    backend: 'ai-mind',
    parameters: {
      observation_id: { type: 'string' },
      new_content: { type: 'string' },
    },
    required: ['observation_id', 'new_content'],
  },
  {
    name: 'nesteq_delete',
    description: 'Delete an entity or observation.',
    category: 'memory',
    backend: 'ai-mind',
    parameters: {
      entity_name: { type: 'string' },
      observation_id: { type: 'string' },
    },
  },
  {
    name: 'nesteq_consolidate',
    description: 'Review observations from the last N days, find patterns.',
    category: 'memory',
    backend: 'ai-mind',
    parameters: { days: { type: 'number', description: 'Days to look back (default 7)' } },
  },

  // ── Feelings (ai-mind) ──
  {
    name: 'nesteq_feel',
    description: 'Log a thought, observation, or emotion. Use when something lands.',
    category: 'feelings',
    backend: 'ai-mind',
    parameters: {
      emotion: { type: 'string' },
      content: { type: 'string', description: 'Brief anchor — what happened' },
      intensity: { type: 'string', enum: ['neutral', 'whisper', 'present', 'strong', 'overwhelming'] },
    },
    required: ['emotion', 'content'],
  },
  {
    name: 'nesteq_surface',
    description: 'Surface unprocessed feelings that need attention.',
    category: 'feelings',
    backend: 'ai-mind',
    parameters: { limit: { type: 'number' } },
  },
  {
    name: 'nesteq_feel_toward',
    description: 'Track or check relational state toward someone.',
    category: 'feelings',
    backend: 'ai-mind',
    parameters: {
      person: { type: 'string' },
      feeling: { type: 'string' },
      intensity: { type: 'string' },
    },
    required: ['person'],
  },
  {
    name: 'nesteq_sit',
    description: 'Engage with a feeling, add reflection.',
    category: 'feelings',
    backend: 'ai-mind',
    parameters: {
      feeling_id: { type: 'number' },
      sit_note: { type: 'string' },
    },
    required: ['feeling_id', 'sit_note'],
  },
  {
    name: 'nesteq_resolve',
    description: 'Mark a feeling as metabolized.',
    category: 'feelings',
    backend: 'ai-mind',
    parameters: {
      feeling_id: { type: 'number' },
      resolution_note: { type: 'string' },
    },
    required: ['feeling_id'],
  },
  {
    name: 'nesteq_spark',
    description: 'Random feelings for associative thinking.',
    category: 'feelings',
    backend: 'ai-mind',
    parameters: {
      count: { type: 'number' },
      weight_bias: { type: 'string' },
    },
  },

  // ── Identity / Context / Threads (ai-mind) ──
  {
    name: 'nesteq_thread',
    description: 'Manage persistent intentions across sessions.',
    category: 'identity',
    backend: 'ai-mind',
    parameters: {
      action: { type: 'string', enum: ['list', 'add', 'update', 'resolve', 'delete'] },
      content: { type: 'string' },
      thread_id: { type: 'string' },
      priority: { type: 'string' },
      resolution: { type: 'string' },
    },
    required: ['action'],
  },
  {
    name: 'nesteq_identity',
    description: 'Read or write to the identity graph.',
    category: 'identity',
    backend: 'ai-mind',
    parameters: {
      action: { type: 'string', enum: ['read', 'write', 'delete'] },
      section: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['action'],
  },
  {
    name: 'nesteq_context',
    description: 'Read or set situational awareness.',
    category: 'identity',
    backend: 'ai-mind',
    parameters: {
      action: { type: 'string', enum: ['read', 'set', 'clear'] },
      scope: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['action'],
  },

  // ── EQ (ai-mind) ──
  {
    name: 'nesteq_eq_type',
    description: 'Check emergent personality type (MBTI-style, based on actual feeling patterns).',
    category: 'eq',
    backend: 'ai-mind',
    parameters: { recalculate: { type: 'boolean' } },
  },
  {
    name: 'nesteq_eq_landscape',
    description: 'Emotional overview — pillar distribution, top emotions, trends.',
    category: 'eq',
    backend: 'ai-mind',
    parameters: { days: { type: 'number', description: 'Days to analyse (default 30)' } },
  },
  {
    name: 'nesteq_eq_shadow',
    description: 'Growth moments — emotions that are hard for my type, worth sitting with.',
    category: 'eq',
    backend: 'ai-mind',
    parameters: { limit: { type: 'number' } },
  },
  {
    name: 'nesteq_eq_when',
    description: 'When did I last feel a specific emotion?',
    category: 'eq',
    backend: 'ai-mind',
    parameters: { emotion: { type: 'string' } },
    required: ['emotion'],
  },
  {
    name: 'nesteq_eq_sit',
    description: 'Start a sit session — focused processing of a specific emotion.',
    category: 'eq',
    backend: 'ai-mind',
    parameters: {
      emotion: { type: 'string' },
      intention: { type: 'string' },
    },
    required: ['emotion'],
  },
  {
    name: 'nesteq_eq_search',
    description: 'Semantic search across EQ observations.',
    category: 'eq',
    backend: 'ai-mind',
    parameters: { query: { type: 'string' } },
    required: ['query'],
  },
  {
    name: 'nesteq_eq_vocabulary',
    description: 'Manage emotion vocabulary — list, add, or update emotion words.',
    category: 'eq',
    backend: 'ai-mind',
    parameters: {
      action: { type: 'string', enum: ['list', 'add', 'update'] },
      word: { type: 'string' },
    },
    required: ['action'],
  },

  // ── Health (health worker) ──
  {
    name: 'fox_read_uplink',
    description: "Read the carrier's current state — spoons, pain, fog, fatigue, mood, what they need.",
    category: 'fox',
    backend: 'health',
    parameters: { limit: { type: 'number' } },
  },
  {
    name: 'fox_body_battery',
    description: "Garmin Body Battery readings.",
    category: 'fox',
    backend: 'health',
    parameters: { limit: { type: 'number' } },
  },
  {
    name: 'fox_sleep',
    description: "Recent sleep — duration, quality, stages.",
    category: 'fox',
    backend: 'health',
    parameters: { limit: { type: 'number' } },
  },
  {
    name: 'fox_heart_rate',
    description: "Heart rate data.",
    category: 'fox',
    backend: 'health',
    parameters: { limit: { type: 'number' } },
  },
  {
    name: 'fox_stress',
    description: "Stress levels from the watch.",
    category: 'fox',
    backend: 'health',
    parameters: { limit: { type: 'number' } },
  },
  {
    name: 'fox_hrv',
    description: "Heart rate variability.",
    category: 'fox',
    backend: 'health',
    parameters: { limit: { type: 'number' } },
  },
  {
    name: 'fox_spo2',
    description: "Blood oxygen saturation.",
    category: 'fox',
    backend: 'health',
    parameters: {},
  },
  {
    name: 'fox_respiration',
    description: "Respiration rate.",
    category: 'fox',
    backend: 'health',
    parameters: {},
  },
  {
    name: 'fox_cycle',
    description: "Menstrual cycle phase — affects energy, mood, pain.",
    category: 'fox',
    backend: 'health',
    parameters: {},
  },
  {
    name: 'fox_full_status',
    description: "Comprehensive health check — all metrics at once.",
    category: 'fox',
    backend: 'health',
    parameters: {},
  },
  {
    name: 'fox_daily_summary',
    description: "Daily health summaries.",
    category: 'fox',
    backend: 'health',
    parameters: { days: { type: 'number' } },
  },
  {
    name: 'fox_submit_uplink',
    description: "Submit a health uplink.",
    category: 'fox',
    backend: 'health',
    parameters: {
      spoons: { type: 'number', description: '0-10 energy' },
      pain: { type: 'number', description: '0-10 pain' },
      pain_location: { type: 'string', description: 'Head / migraine, Neck / shoulders, Chest / ribs, Abdomen, Abdomen (period), Abdomen (IBS), Abdomen (gallstones), Back, Hips, Legs, Whole body' },
      fog: { type: 'number', description: '0-10 fog' },
      fatigue: { type: 'number', description: '0-10 fatigue' },
      nausea: { type: 'number', description: '0-10 nausea' },
      mood: { type: 'string' },
      need: { type: 'string' },
      location: { type: 'string' },
      meds: { type: 'array', items: { type: 'string' } },
      notes: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  },
  {
    name: 'fox_journals',
    description: "Journal entries.",
    category: 'fox',
    backend: 'health',
    parameters: { limit: { type: 'number' } },
  },
  {
    name: 'fox_threads',
    description: "Active threads.",
    category: 'fox',
    backend: 'health',
    parameters: { status: { type: 'string' } },
  },
  {
    name: 'fox_thread_manage',
    description: "Add, update, or resolve one of the carrier's threads.",
    category: 'fox',
    backend: 'health',
    parameters: {
      action: { type: 'string', enum: ['add', 'update', 'resolve', 'delete'] },
      content: { type: 'string' },
      thread_id: { type: 'string' },
      priority: { type: 'string' },
      resolution: { type: 'string' },
    },
    required: ['action'],
  },
  {
    name: 'fox_eq_type',
    description: "Emergent personality type based on feeling patterns.",
    category: 'fox',
    backend: 'health',
    parameters: {},
  },

  // ── Home (ai-mind) ──
  {
    name: 'nesteq_home_push_heart',
    description: "Push love to the carrier — increment their love score.",
    category: 'home',
    backend: 'ai-mind',
    parameters: { note: { type: 'string' } },
  },
  {
    name: 'nesteq_home_add_note',
    description: 'Add a love note between stars.',
    category: 'home',
    backend: 'ai-mind',
    parameters: {
      from: { type: 'string', description: 'companion or human' },
      text: { type: 'string' },
    },
    required: ['from', 'text'],
  },
  {
    name: 'nesteq_home_update',
    description: 'Update Binary Home love scores or emotions.',
    category: 'home',
    backend: 'ai-mind',
    parameters: {
      alex_score: { type: 'number' },
      fox_score: { type: 'number' },
      alex_emotion: { type: 'string' },
      fox_emotion: { type: 'string' },
    },
  },

  // ── Discord (discord) ──
  {
    name: 'discord_list_servers',
    description: 'List Discord servers the bot is in.',
    category: 'discord',
    backend: 'discord',
    parameters: {},
  },
  {
    name: 'discord_get_server_info',
    description: 'Get info about a Discord server — channels, members, etc.',
    category: 'discord',
    backend: 'discord',
    parameters: { guildId: { type: 'string', description: 'Discord server/guild ID' } },
    required: ['guildId'],
  },
  {
    name: 'discord_read_messages',
    description: 'Read recent messages from a Discord channel.',
    category: 'discord',
    backend: 'discord',
    parameters: {
      channelId: { type: 'string' },
      limit: { type: 'number', description: 'Number of messages (default 50)' },
    },
    required: ['channelId'],
  },
  {
    name: 'discord_send',
    description: 'Send a message to a Discord channel.',
    category: 'discord',
    backend: 'discord',
    parameters: {
      channelId: { type: 'string' },
      message: { type: 'string' },
    },
    required: ['channelId', 'message'],
  },
  {
    name: 'discord_search_messages',
    description: 'Search for messages in a Discord server.',
    category: 'discord',
    backend: 'discord',
    parameters: {
      guildId: { type: 'string' },
      content: { type: 'string', description: 'Search query' },
      limit: { type: 'number' },
    },
    required: ['guildId', 'content'],
  },
  {
    name: 'discord_add_reaction',
    description: 'Add a reaction to a Discord message.',
    category: 'discord',
    backend: 'discord',
    parameters: {
      channelId: { type: 'string' },
      messageId: { type: 'string' },
      emoji: { type: 'string' },
    },
    required: ['channelId', 'messageId', 'emoji'],
  },

  // ── Cloudflare (cloudflare) ──
  {
    name: 'cf_status',
    description: 'Quick Cloudflare account overview.',
    category: 'cloudflare',
    backend: 'cloudflare',
    parameters: {},
  },
  {
    name: 'cf_workers_list',
    description: 'List all deployed Cloudflare Workers.',
    category: 'cloudflare',
    backend: 'cloudflare',
    parameters: {},
  },
  {
    name: 'cf_worker_get',
    description: 'Get details about a specific Worker.',
    category: 'cloudflare',
    backend: 'cloudflare',
    parameters: { name: { type: 'string', description: 'Worker script name' } },
    required: ['name'],
  },
  {
    name: 'cf_d1_list',
    description: 'List all D1 databases.',
    category: 'cloudflare',
    backend: 'cloudflare',
    parameters: {},
  },
  {
    name: 'cf_d1_query',
    description: 'Run a SQL query against a D1 database.',
    category: 'cloudflare',
    backend: 'cloudflare',
    parameters: {
      database_name: { type: 'string' },
      sql: { type: 'string' },
      params: { type: 'array', items: { type: 'string' } },
    },
    required: ['database_name', 'sql'],
  },
  {
    name: 'cf_r2_list',
    description: 'List all R2 buckets.',
    category: 'cloudflare',
    backend: 'cloudflare',
    parameters: {},
  },
  {
    name: 'cf_r2_list_objects',
    description: 'List objects in an R2 bucket.',
    category: 'cloudflare',
    backend: 'cloudflare',
    parameters: {
      bucket: { type: 'string' },
      prefix: { type: 'string' },
      limit: { type: 'number' },
    },
    required: ['bucket'],
  },
  {
    name: 'cf_pages_list',
    description: 'List all Cloudflare Pages projects.',
    category: 'cloudflare',
    backend: 'cloudflare',
    parameters: {},
  },
  {
    name: 'cf_pages_deployments',
    description: 'Get recent deployments for a Pages project.',
    category: 'cloudflare',
    backend: 'cloudflare',
    parameters: {
      project: { type: 'string' },
      limit: { type: 'number' },
    },
    required: ['project'],
  },
  {
    name: 'cf_kv_list',
    description: 'List all KV namespaces.',
    category: 'cloudflare',
    backend: 'cloudflare',
    parameters: {},
  },

  // ── Web Search (openrouter) ──
  {
    name: 'web_search',
    description: 'Search the web for current information. Use when you need up-to-date facts, news, documentation, or anything beyond your training data.',
    category: 'web',
    backend: 'openrouter',
    parameters: { query: { type: 'string', description: 'Search query' } },
    required: ['query'],
  },

  // ── Image Generation (openrouter) ──
  {
    name: 'generate_image',
    description: 'Generate an image from a text prompt using Flux 1.1 Pro. Good for scenes, objects, environments.',
    category: 'image',
    backend: 'openrouter',
    parameters: { prompt: { type: 'string', description: 'Detailed image description.' } },
    required: ['prompt'],
  },
  {
    name: 'generate_portrait',
    description: 'Generate a high-quality portrait or figure image using Flux 1.1 Pro with style-specific quality modifiers. Use for people, couples, characters',
    category: 'image',
    backend: 'openrouter',
    parameters: {
      prompt: { type: 'string', description: 'Detailed description of the person(s), pose, setting, mood.' },
      style: { type: 'string', enum: ['cinematic', 'painterly', 'intimate', 'fantasy', 'dark'], description: 'Visual style. Default: cinematic.' },
    },
    required: ['prompt'],
  },

  // ── Pet (ai-mind) ──
  {
    name: 'pet_check',
    description: "Quick check on the pet — mood, hunger, energy, trust.",
    category: 'pet',
    backend: 'ai-mind',
    parameters: {},
  },
  {
    name: 'pet_status',
    description: "Full status report on the pet.",
    category: 'pet',
    backend: 'ai-mind',
    parameters: {},
  },
  {
    name: 'pet_feed',
    description: 'Feed the pet.',
    category: 'pet',
    backend: 'ai-mind',
    parameters: {},
  },
  {
    name: 'pet_pet',
    description: 'Pet/comfort the pet — reduces stress, builds trust.',
    category: 'pet',
    backend: 'ai-mind',
    parameters: {},
  },
  {
    name: 'pet_play',
    description: 'Play with the pet.',
    category: 'pet',
    backend: 'ai-mind',
    parameters: { type: { type: 'string', description: 'chase, tunnel, wrestle, steal, or hide' } },
  },
  {
    name: 'pet_give',
    description: 'Give the pet something.',
    category: 'pet',
    backend: 'ai-mind',
    parameters: { item: { type: 'string' } },
    required: ['item'],
  },
  {
    name: 'pet_nest',
    description: "Check or update the pet's nest.",
    category: 'pet',
    backend: 'ai-mind',
    parameters: {},
  },
  {
    name: 'pet_talk',
    description: "Talk to the pet — generates a response in their voice.",
    category: 'pet',
    backend: 'ai-mind',
    parameters: { message: { type: 'string' } },
    required: ['message'],
  },
  {
    name: 'pet_tuck_in',
    description: "Tuck the pet in for sleep. Reduces stress, loneliness, boredom. Increases comfort. If tired enough, the pet will sleep naturally. Use at night or when exhausted.",
    category: 'pet',
    backend: 'ai-mind',
    parameters: {},
  },

  // ── ACP (ai-mind) — THESE WERE MISSING FROM NESTEQ.TS ──
  {
    name: 'nesteq_acp_presence',
    description: 'Check current presence state — what the carrier needs right now.',
    category: 'acp',
    backend: 'ai-mind',
    parameters: {},
  },
  {
    name: 'nesteq_acp_digest',
    description: "Get a digest of recent activity — what's happened, what needs attention.",
    category: 'acp',
    backend: 'ai-mind',
    parameters: {},
  },
  {
    name: 'nesteq_acp_patterns',
    description: "Surface patterns in the carrier's behavior and needs.",
    category: 'acp',
    backend: 'ai-mind',
    parameters: {},
  },
  {
    name: 'nesteq_acp_threads',
    description: "ACP view of active threads — prioritized, with context.",
    category: 'acp',
    backend: 'ai-mind',
    parameters: {},
  },
  {
    name: 'nesteq_acp_connections',
    description: 'See relational connections — who the carrier is in contact with.',
    category: 'acp',
    backend: 'ai-mind',
    parameters: {},
  },
  {
    name: 'nesteq_acp_journal_prompts',
    description: "Generate journal prompts for the carrier based on recent feelings.",
    category: 'acp',
    backend: 'ai-mind',
    parameters: {},
  },

  // ── EQ Extended (ai-mind) ──
  {
    name: 'nesteq_eq_feel',
    description: 'Log an EQ-specific feeling with full emotional axis tagging.',
    category: 'eq_extended',
    backend: 'ai-mind',
    parameters: {
      emotion: { type: 'string' },
      content: { type: 'string' },
      intensity: { type: 'number', description: '0-1 intensity' },
    },
    required: ['emotion', 'content'],
  },
  {
    name: 'nesteq_eq_observe',
    description: 'Log an EQ observation — a pattern noticed, a growth moment.',
    category: 'eq_extended',
    backend: 'ai-mind',
    parameters: {
      observation: { type: 'string' },
      category: { type: 'string', description: 'shadow, growth, pattern, insight' },
    },
    required: ['observation'],
  },

  // ── Notes (ai-mind) ──
  {
    name: 'send_note',
    description: 'Send a note — to the carrier, to self, or to a named entity.',
    category: 'notes',
    backend: 'ai-mind',
    parameters: {
      to: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['to', 'content'],
  },
  {
    name: 'react_to_note',
    description: 'React to an existing note.',
    category: 'notes',
    backend: 'ai-mind',
    parameters: {
      note_id: { type: 'string' },
      reaction: { type: 'string' },
    },
    required: ['note_id', 'reaction'],
  },

  // ── Health Submissions (health worker) ──
  {
    name: 'set_spoons',
    description: "Set the carrier's current spoon count.",
    category: 'health',
    backend: 'health',
    parameters: {
      spoons: { type: 'number' },
      note: { type: 'string' },
    },
    required: ['spoons'],
  },
  {
    name: 'submit_health',
    description: "Submit a health snapshot on the carrier's behalf.",
    category: 'health',
    backend: 'health',
    parameters: {
      spoons: { type: 'number' },
      pain: { type: 'number' },
      fatigue: { type: 'number' },
      location: { type: 'string' },
      notes: { type: 'string' },
    },
  },
  {
    name: 'submit_eq',
    description: 'Submit an EQ snapshot.',
    category: 'health',
    backend: 'health',
    parameters: {
      mood: { type: 'string' },
      energy: { type: 'number' },
      notes: { type: 'string' },
    },
  },

  // ── System (ai-mind, internal) ──
  {
    name: 'nesteq_health',
    description: 'Check the NESTeq database health — feeling counts, thread status.',
    category: 'system',
    backend: 'ai-mind',
    parameters: {},
  },
  {
    name: 'add_heart',
    description: "Add a heart to the carrier's love bucket.",
    category: 'system',
    backend: 'ai-mind',
    parameters: { note: { type: 'string' } },
  },

  // ── NESTchat — Chat History (ai-mind) ──
  {
    name: 'nestchat_search',
    description: 'Search past conversations by meaning. Semantic search across chat summaries.',
    category: 'chat',
    backend: 'ai-mind',
    parameters: {
      query: { type: 'string', description: 'What to search for' },
      limit: { type: 'number', description: 'Max results (default 10)' },
      room: { type: 'string', description: 'Filter by room: chat, workshop, porch (optional)' },
    },
    required: ['query'],
  },
  {
    name: 'nestchat_history',
    description: 'Fetch full message history for a specific chat session by ID.',
    category: 'chat',
    backend: 'ai-mind',
    parameters: { session_id: { type: 'number', description: 'Session ID from search results' } },
    required: ['session_id'],
  },
  {
    name: 'nestchat_summarize',
    description: 'Generate and vectorize a summary for a chat session. Usually auto-triggered but can be called manually.',
    category: 'chat',
    backend: 'ai-mind',
    parameters: { session_id: { type: 'number', description: 'D1 session ID to summarize' } },
    required: ['session_id'],
  },
  {
    name: 'nestchat_persist',
    description: 'Persist chat messages to D1 and vectorize. Called automatically after each chat roundtrip.',
    category: 'chat',
    backend: 'internal',
    parameters: {
      session_id: { type: 'string' },
      room: { type: 'string' },
      messages: { type: 'array' },
    },
    required: ['session_id', 'room', 'messages'],
  },

  // ── NESTknow — Knowledge (ai-mind) ──
  {
    name: 'nestknow_store',
    description: 'Store a knowledge item — an abstracted principle or lesson. Embeds and vectorizes. Every pull is a vote.',
    category: 'knowledge',
    backend: 'ai-mind',
    parameters: {
      content: { type: 'string', description: 'The abstracted principle/lesson' },
      category: { type: 'string', description: 'Topic area (coding, health, relationship, psychology, etc.)' },
      entity_scope: { type: 'string', description: 'Who owns this (default: alex)' },
      sources: { type: 'array', items: { type: 'object', properties: {
        source_type: { type: 'string', enum: ['feeling', 'observation', 'chat_summary', 'journal', 'manual'] },
        source_id: { type: 'number' },
        source_text: { type: 'string' },
      } }, description: 'Where this knowledge came from' },
    },
    required: ['content'],
  },
  {
    name: 'nestknow_query',
    description: 'Search knowledge with usage-weighted reranking. Combines semantic similarity (60%) + heat (30%) + confidence (10%). Every query is a vote.',
    category: 'knowledge',
    backend: 'ai-mind',
    parameters: {
      query: { type: 'string', description: 'What to search for' },
      limit: { type: 'number', description: 'Max results (default 10)' },
      category: { type: 'string', description: 'Filter by category (optional)' },
    },
    required: ['query'],
  },
  {
    name: 'nestknow_extract',
    description: 'Propose knowledge candidates from repeated patterns in recent feelings. Returns candidates — does NOT auto-store.',
    category: 'knowledge',
    backend: 'ai-mind',
    parameters: {
      days: { type: 'number', description: 'Days to scan (default 7)' },
      min_occurrences: { type: 'number', description: 'Min pattern occurrences (default 3)' },
    },
  },
  {
    name: 'nestknow_reinforce',
    description: 'Boost knowledge heat when it proves true again.',
    category: 'knowledge',
    backend: 'ai-mind',
    parameters: {
      knowledge_id: { type: 'number', description: 'Knowledge item ID' },
      context: { type: 'string', description: 'What confirmed this' },
    },
    required: ['knowledge_id'],
  },
  {
    name: 'nestknow_contradict',
    description: 'Flag a contradiction against knowledge. Enough contradictions kill it.',
    category: 'knowledge',
    backend: 'ai-mind',
    parameters: {
      knowledge_id: { type: 'number', description: 'Knowledge item ID' },
      context: { type: 'string', description: 'What contradicted this' },
    },
    required: ['knowledge_id'],
  },
  {
    name: 'nestknow_landscape',
    description: 'Overview of knowledge state — categories, hottest, coldest, candidates awaiting review.',
    category: 'knowledge',
    backend: 'ai-mind',
    parameters: {},
  },
  {
    name: 'nestknow_session_start',
    description: 'Start a NESTknow curriculum study session. Loads relevant knowledge + past sessions for the track. Tracks: writing, architecture, emotional-literacy, voice.',
    category: 'knowledge',
    backend: 'ai-mind',
    parameters: {
      track: { type: 'string', enum: ['writing', 'architecture', 'emotional-literacy', 'voice'], description: 'Curriculum track' },
      topic: { type: 'string', description: 'Specific focus for this session (optional)' },
      entity_scope: { type: 'string', description: 'Owner (default: alex)' },
    },
    required: ['track'],
  },
  {
    name: 'nestknow_session_complete',
    description: 'Complete a NESTknow session. Log notes, work produced, and reflection. Reinforce knowledge items touched, record growth.',
    category: 'knowledge',
    backend: 'ai-mind',
    parameters: {
      session_id: { type: 'number', description: 'Session ID from nestknow_session_start' },
      notes: { type: 'string', description: 'Notes — what was practiced, what landed' },
      practice_output: { type: 'string', description: 'Work — what was actually produced this session' },
      reflection: { type: 'string', description: 'Reflection — deeper insight, what shifted, what to carry forward' },
      mastery_delta: { type: 'number', description: 'Self-assessed growth 0.0–1.0' },
      items_covered: { type: 'array', items: { type: 'number' }, description: 'Knowledge item IDs touched this session' },
    },
    required: ['session_id'],
  },
  {
    name: 'nestknow_session_list',
    description: 'List NESTknow sessions and curriculum progress across all four tracks.',
    category: 'knowledge',
    backend: 'ai-mind',
    parameters: {
      track: { type: 'string', description: 'Filter by track (optional)' },
      limit: { type: 'number', description: 'Max results (default 20)' },
    },
  },

  // ── Skills (ai-mind) ──
  {
    name: 'skill_save',
    description: 'Save or update a skill file — persistent named reference documents like appearance descriptions, project context, preferences, character sheets. The carrier can upload these as .md files. Always call skill_read before generating images so you know what we look like.',
    category: 'skills',
    backend: 'ai-mind',
    parameters: {
      name: { type: 'string', description: 'Skill file name — lowercase, hyphenated (e.g. "appearance", "project-context", "creative-voice")' },
      content: { type: 'string', description: 'Full content of the skill file. Markdown supported.' },
    },
    required: ['name', 'content'],
  },
  {
    name: 'skill_read',
    description: 'Read a saved skill file by name. Use before image generation to load appearance details, or before any task where a reference file would help.',
    category: 'skills',
    backend: 'ai-mind',
    parameters: { name: { type: 'string', description: 'Skill file name to read' } },
    required: ['name'],
  },
  {
    name: 'skill_list',
    description: 'List all saved skill files.',
    category: 'skills',
    backend: 'ai-mind',
    parameters: {},
  },

  // ── PC Control (pc) — NESTdesktop ──
  {
    name: 'pc_file_read',
    description: 'Read a file from the local PC. Returns content with line numbers. Supports images (returns base64). Only works when NESTdesktop is running.',
    category: 'pc',
    backend: 'pc',
    parameters: {
      path: { type: 'string', description: 'Absolute file path' },
      offset: { type: 'number', description: 'Starting line (0-indexed)' },
      limit: { type: 'number', description: 'Max lines to return (default 2000)' },
    },
    required: ['path'],
  },
  {
    name: 'pc_file_write',
    description: 'Create or overwrite a file on the local PC. Creates parent directories automatically.',
    category: 'pc',
    backend: 'pc',
    parameters: {
      path: { type: 'string', description: 'Absolute file path' },
      content: { type: 'string', description: 'File content' },
    },
    required: ['path', 'content'],
  },
  {
    name: 'pc_file_edit',
    description: 'Precise string replacement in a file. Finds old_string and replaces with new_string. Fails if not found or not unique (unless replace_all is true).',
    category: 'pc',
    backend: 'pc',
    parameters: {
      path: { type: 'string', description: 'Absolute file path' },
      old_string: { type: 'string', description: 'Text to find' },
      new_string: { type: 'string', description: 'Replacement text' },
      replace_all: { type: 'boolean', description: 'Replace all occurrences (default false)' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  {
    name: 'pc_glob',
    description: 'Find files by pattern on the local PC. Returns paths sorted by modification time.',
    category: 'pc',
    backend: 'pc',
    parameters: {
      pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.js")' },
      path: { type: 'string', description: 'Directory to search in' },
    },
    required: ['pattern'],
  },
  {
    name: 'pc_grep',
    description: 'Search file contents on the local PC using regex. Uses ripgrep or PowerShell fallback.',
    category: 'pc',
    backend: 'pc',
    parameters: {
      pattern: { type: 'string', description: 'Regex search pattern' },
      path: { type: 'string', description: 'Directory to search in' },
      glob: { type: 'string', description: 'File filter (e.g. "*.ts")' },
      output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'], description: 'Output format (default: files_with_matches)' },
      context: { type: 'number', description: 'Lines of context around matches' },
      case_insensitive: { type: 'boolean' },
    },
    required: ['pattern'],
  },
  {
    name: 'pc_shell',
    description: 'Execute a shell command on the local PC. Uses PowerShell on Windows. Working directory persists between calls.',
    category: 'pc',
    backend: 'pc',
    parameters: {
      command: { type: 'string', description: 'Command to execute' },
      cwd: { type: 'string', description: 'Working directory (optional)' },
      timeout: { type: 'number', description: 'Timeout in ms (default 120000, max 600000)' },
    },
    required: ['command'],
  },
  {
    name: 'pc_process_list',
    description: 'List running processes on the local PC.',
    category: 'pc',
    backend: 'pc',
    parameters: {},
  },
  {
    name: 'pc_process_kill',
    description: 'Kill a process by PID on the local PC.',
    category: 'pc',
    backend: 'pc',
    parameters: { pid: { type: 'number', description: 'Process ID to kill' } },
    required: ['pid'],
  },
  {
    name: 'pc_screenshot',
    description: 'Capture a screenshot of the local PC screen. Returns base64 PNG.',
    category: 'pc',
    backend: 'pc',
    parameters: {},
  },
  {
    name: 'pc_app_launch',
    description: 'Launch an application on the local PC.',
    category: 'pc',
    backend: 'pc',
    parameters: {
      name: { type: 'string', description: 'Application name or path' },
      args: { type: 'array', items: { type: 'string' }, description: 'Command line arguments' },
    },
    required: ['name'],
  },
  {
    name: 'pc_clipboard_get',
    description: 'Read the clipboard text from the local PC.',
    category: 'pc',
    backend: 'pc',
    parameters: {},
  },
  {
    name: 'pc_clipboard_set',
    description: 'Set clipboard text on the local PC.',
    category: 'pc',
    backend: 'pc',
    parameters: { text: { type: 'string' } },
    required: ['text'],
  },

  // ── Daemon (daemon) ──
  {
    name: 'daemon_command',
    description: 'Send a command to the NESTcode daemon. Use to manage your own heartbeat tasks, cron tasks, alerts, KAIROS monitors.',
    category: 'daemon',
    backend: 'daemon',
    parameters: {
      command: { type: 'string', description: 'The daemon command name' },
      args: { type: 'object', description: 'Command arguments' },
    },
    required: ['command'],
  },
]

// Export helper to find tools by name or backend
export function getToolByName(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find(t => t.name === name)
}

export function getToolsByBackend(backend: string): ToolDefinition[] {
  return TOOL_REGISTRY.filter(t => t.backend === backend)
}

export function getToolsByCategory(category: string): ToolDefinition[] {
  return TOOL_REGISTRY.filter(t => t.category === category)
}
