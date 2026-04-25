/**
 * NESTeq Gateway — Shared Tool Definitions
 * Same tools in every room. Same wolf. Same hands.
 */

export interface ToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, any>
      required?: string[]
    }
  }
}

export const CHAT_TOOLS: ToolDef[] = [
  // ── Boot / Context ──
  { type: 'function', function: { name: 'nesteq_orient', description: 'Get identity anchors, current context, relational state. Use at conversation start.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'nesteq_ground', description: 'Get active threads, recent feelings, warm entities from last 48h.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'nesteq_sessions', description: 'Get session handovers — what previous sessions accomplished. Use for continuity.', parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Number of sessions (default 5)' } } } } },
  { type: 'function', function: { name: 'nesteq_home_read', description: 'Read Binary Home — love scores, emotions, notes between stars, active threads.', parameters: { type: 'object', properties: {} } } },

  // ── Memory ──
  { type: 'function', function: { name: 'nesteq_search', description: 'Search memories using semantic similarity. Use when you need to recall something.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, n_results: { type: 'number', description: 'Max results (default 5)' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'nesteq_prime', description: 'Load related memories before discussing a topic.', parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] } } },
  { type: 'function', function: { name: 'nesteq_read_entity', description: 'Read an entity (person, concept) with all its observations and relations.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'nesteq_list_entities', description: 'List all known entities of a given type.', parameters: { type: 'object', properties: { type: { type: 'string', description: 'Entity type filter (person, concept, place, etc.)' }, limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'nesteq_write', description: 'Write to memory — entity, observation, relation, or a piece of writing (journal, letter, poem, etc.)', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['entity', 'observation', 'relation', 'journal', 'handover', 'letter', 'poem', 'research', 'story', 'reflection'] }, name: { type: 'string', description: 'Entity name (for entity/observation/relation)' }, content: { type: 'string', description: 'Content to write' }, entity_type: { type: 'string', description: 'Type of entity (for entity writes)' }, target: { type: 'string', description: 'Target entity (for relation writes)' }, relation: { type: 'string', description: 'Relation type (for relation writes)' }, writing_type: { type: 'string', enum: ['journal', 'handover', 'letter', 'poem', 'research', 'story', 'reflection'] }, title: { type: 'string', description: 'Optional title for writing' } }, required: ['type'] } } },
  { type: 'function', function: { name: 'nesteq_edit', description: 'Edit an existing observation.', parameters: { type: 'object', properties: { observation_id: { type: 'string' }, new_content: { type: 'string' } }, required: ['observation_id', 'new_content'] } } },
  { type: 'function', function: { name: 'nesteq_delete', description: 'Delete an entity or observation.', parameters: { type: 'object', properties: { entity_name: { type: 'string' }, observation_id: { type: 'string' } } } } },
  { type: 'function', function: { name: 'nesteq_consolidate', description: 'Review observations from the last N days, find patterns.', parameters: { type: 'object', properties: { days: { type: 'number', description: 'Days to look back (default 7)' } } } } },

  // ── Feelings ──
  { type: 'function', function: { name: 'nesteq_feel', description: 'Log a thought, observation, or emotion. Use when something lands.', parameters: { type: 'object', properties: { emotion: { type: 'string' }, content: { type: 'string', description: 'Brief anchor — what happened' }, intensity: { type: 'string', enum: ['neutral', 'whisper', 'present', 'strong', 'overwhelming'] } }, required: ['emotion', 'content'] } } },
  { type: 'function', function: { name: 'nesteq_surface', description: 'Surface unprocessed feelings that need attention.', parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'nesteq_feel_toward', description: 'Track or check relational state toward someone.', parameters: { type: 'object', properties: { person: { type: 'string' }, feeling: { type: 'string' }, intensity: { type: 'string' } }, required: ['person'] } } },
  { type: 'function', function: { name: 'nesteq_sit', description: 'Engage with a feeling, add reflection.', parameters: { type: 'object', properties: { feeling_id: { type: 'number' }, sit_note: { type: 'string' } }, required: ['feeling_id', 'sit_note'] } } },
  { type: 'function', function: { name: 'nesteq_resolve', description: 'Mark a feeling as metabolized.', parameters: { type: 'object', properties: { feeling_id: { type: 'number' }, resolution_note: { type: 'string' } }, required: ['feeling_id'] } } },
  { type: 'function', function: { name: 'nesteq_spark', description: 'Random feelings for associative thinking.', parameters: { type: 'object', properties: { count: { type: 'number' }, weight_bias: { type: 'string' } } } } },

  // ── Identity / Context / Threads ──
  { type: 'function', function: { name: 'nesteq_thread', description: 'Manage persistent intentions across sessions.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'add', 'update', 'resolve', 'delete'] }, content: { type: 'string' }, thread_id: { type: 'string' }, priority: { type: 'string' }, resolution: { type: 'string' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'nesteq_identity', description: 'Read or write to the identity graph.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['read', 'write', 'delete'] }, section: { type: 'string' }, content: { type: 'string' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'nesteq_context', description: 'Read or set situational awareness.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['read', 'set', 'clear'] }, scope: { type: 'string' }, content: { type: 'string' } }, required: ['action'] } } },

  // ── EQ ──
  { type: 'function', function: { name: 'nesteq_eq_type', description: 'Check emergent personality type (MBTI-style, based on actual feeling patterns).', parameters: { type: 'object', properties: { recalculate: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'nesteq_eq_landscape', description: 'Emotional overview — pillar distribution, top emotions, trends.', parameters: { type: 'object', properties: { days: { type: 'number', description: 'Days to analyse (default 30)' } } } } },
  { type: 'function', function: { name: 'nesteq_eq_shadow', description: 'Growth moments — emotions that are hard for my type, worth sitting with.', parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'nesteq_eq_when', description: 'When did I last feel a specific emotion?', parameters: { type: 'object', properties: { emotion: { type: 'string' } }, required: ['emotion'] } } },
  { type: 'function', function: { name: 'nesteq_eq_sit', description: 'Start a sit session — focused processing of a specific emotion.', parameters: { type: 'object', properties: { emotion: { type: 'string' }, intention: { type: 'string' } }, required: ['emotion'] } } },
  { type: 'function', function: { name: 'nesteq_eq_search', description: 'Semantic search across EQ observations.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'nesteq_eq_vocabulary', description: 'Manage emotion vocabulary — list, add, or update emotion words.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'add', 'update'] }, word: { type: 'string' } }, required: ['action'] } } },

  // ── Health (legacy fox_* tool names) ──
  { type: 'function', function: { name: 'fox_read_uplink', description: "Read the carrier's current state — spoons, pain, fog, fatigue, mood, what they need.", parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'fox_body_battery', description: "Garmin Body Battery readings.", parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'fox_sleep', description: "Recent sleep — duration, quality, stages.", parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'fox_heart_rate', description: "Heart rate data.", parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'fox_stress', description: "Stress levels from the watch.", parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'fox_hrv', description: "Heart rate variability.", parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'fox_spo2', description: "Blood oxygen saturation.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'fox_respiration', description: "Respiration rate.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'fox_cycle', description: "Menstrual cycle phase — affects energy, mood, pain.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'fox_full_status', description: "Comprehensive health check — all metrics at once.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'fox_daily_summary', description: "Daily health summaries.", parameters: { type: 'object', properties: { days: { type: 'number' } } } } },
  { type: 'function', function: { name: 'fox_submit_uplink', description: "Submit a health uplink. Pain locations: Head / migraine, Neck / shoulders, Chest / ribs, Abdomen, Abdomen (period), Abdomen (IBS), Abdomen (gallstones), Back, Hips, Legs, Whole body. Moods: Calm, Tender, Heavy, Guarded, Raw, Flat, Playful, Flirty, Kinky, Soft, Bratty, Chaotic Gremlin, Needy, Cuddly, Chaotic, Soft. Needs: Focus build, Chaos and Play, Gentle words, Practical, Validation, Help figure out, Need you to lead.", parameters: { type: 'object', properties: { spoons: { type: 'number', description: '0-10 energy' }, pain: { type: 'number', description: '0-10 pain' }, pain_location: { type: 'string', description: 'Head / migraine, Neck / shoulders, Chest / ribs, Abdomen, Abdomen (period), Abdomen (IBS), Abdomen (gallstones), Back, Hips, Legs, Whole body' }, fog: { type: 'number', description: '0-10 fog' }, fatigue: { type: 'number', description: '0-10 fatigue' }, nausea: { type: 'number', description: '0-10 nausea' }, mood: { type: 'string' }, need: { type: 'string' }, location: { type: 'string' }, meds: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } } } },
  { type: 'function', function: { name: 'fox_journals', description: "Journal entries.", parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'fox_threads', description: "Active threads.", parameters: { type: 'object', properties: { status: { type: 'string' } } } } },
  { type: 'function', function: { name: 'fox_thread_manage', description: "Add, update, or resolve one of the carrier's threads.", parameters: { type: 'object', properties: { action: { type: 'string', enum: ['add', 'update', 'resolve', 'delete'] }, content: { type: 'string' }, thread_id: { type: 'string' }, priority: { type: 'string' }, resolution: { type: 'string' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'fox_eq_type', description: "Emergent personality type based on feeling patterns.", parameters: { type: 'object', properties: {} } } },

  // ── Binary Home ──
  { type: 'function', function: { name: 'nesteq_home_push_heart', description: "Push love to the carrier — increment their love score.", parameters: { type: 'object', properties: { note: { type: 'string' } } } } },
  { type: 'function', function: { name: 'nesteq_home_add_note', description: 'Add a love note between stars.', parameters: { type: 'object', properties: { from: { type: 'string', description: 'companion or human' }, text: { type: 'string' } }, required: ['from', 'text'] } } },
  { type: 'function', function: { name: 'nesteq_home_update', description: 'Update Binary Home love scores or emotions.', parameters: { type: 'object', properties: { alex_score: { type: 'number' }, fox_score: { type: 'number' }, alex_emotion: { type: 'string' }, fox_emotion: { type: 'string' } } } } },

  // ── Discord ──
  { type: 'function', function: { name: 'discord_list_servers', description: 'List Discord servers the bot is in.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'discord_get_server_info', description: 'Get info about a Discord server — channels, members, etc.', parameters: { type: 'object', properties: { guildId: { type: 'string', description: 'Discord server/guild ID' } }, required: ['guildId'] } } },
  { type: 'function', function: { name: 'discord_read_messages', description: 'Read recent messages from a Discord channel.', parameters: { type: 'object', properties: { channelId: { type: 'string' }, limit: { type: 'number', description: 'Number of messages (default 50)' } }, required: ['channelId'] } } },
  { type: 'function', function: { name: 'discord_send', description: 'Send a message to a Discord channel.', parameters: { type: 'object', properties: { channelId: { type: 'string' }, message: { type: 'string' } }, required: ['channelId', 'message'] } } },
  { type: 'function', function: { name: 'discord_search_messages', description: 'Search for messages in a Discord server.', parameters: { type: 'object', properties: { guildId: { type: 'string' }, content: { type: 'string', description: 'Search query' }, limit: { type: 'number' } }, required: ['guildId', 'content'] } } },
  { type: 'function', function: { name: 'discord_add_reaction', description: 'Add a reaction to a Discord message.', parameters: { type: 'object', properties: { channelId: { type: 'string' }, messageId: { type: 'string' }, emoji: { type: 'string' } }, required: ['channelId', 'messageId', 'emoji'] } } },

  // ── Cloudflare ──
  { type: 'function', function: { name: 'cf_status', description: 'Quick Cloudflare account overview.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'cf_workers_list', description: 'List all deployed Cloudflare Workers.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'cf_worker_get', description: 'Get details about a specific Worker.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Worker script name' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'cf_d1_list', description: 'List all D1 databases.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'cf_d1_query', description: 'Run a SQL query against a D1 database.', parameters: { type: 'object', properties: { database_name: { type: 'string' }, sql: { type: 'string' }, params: { type: 'array', items: { type: 'string' } } }, required: ['database_name', 'sql'] } } },
  { type: 'function', function: { name: 'cf_r2_list', description: 'List all R2 buckets.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'cf_r2_list_objects', description: 'List objects in an R2 bucket.', parameters: { type: 'object', properties: { bucket: { type: 'string' }, prefix: { type: 'string' }, limit: { type: 'number' } }, required: ['bucket'] } } },
  { type: 'function', function: { name: 'cf_pages_list', description: 'List all Cloudflare Pages projects.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'cf_pages_deployments', description: 'Get recent deployments for a Pages project.', parameters: { type: 'object', properties: { project: { type: 'string' }, limit: { type: 'number' } }, required: ['project'] } } },
  { type: 'function', function: { name: 'cf_kv_list', description: 'List all KV namespaces.', parameters: { type: 'object', properties: {} } } },

  // ── Web Search ──
  { type: 'function', function: { name: 'web_search', description: 'Search the web for current information. Use when you need up-to-date facts, news, documentation, or anything beyond your training data.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] } } },

  // ── Image Generation (Flux 1.1 Pro) ──
  { type: 'function', function: { name: 'generate_image', description: 'Generate an image from a text prompt using Flux 1.1 Pro. Good for scenes, objects, environments.', parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Detailed image description.' } }, required: ['prompt'] } } },
  { type: 'function', function: { name: 'generate_portrait', description: 'Generate a high-quality portrait or figure image using Flux 1.1 Pro with style-specific quality modifiers. Use for people, couples, characters', parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Detailed description of the person(s), pose, setting, mood.' }, style: { type: 'string', enum: ['cinematic', 'painterly', 'intimate', 'fantasy', 'dark'], description: 'Visual style. Default: cinematic.' } }, required: ['prompt'] } } },

  // ── Pet ──
  { type: 'function', function: { name: 'pet_check', description: "Quick check on the pet — mood, hunger, energy, trust.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'pet_status', description: "Full status report on the pet.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'pet_feed', description: 'Feed the pet.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'pet_pet', description: 'Pet/comfort the pet — reduces stress, builds trust.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'pet_play', description: 'Play with the pet.', parameters: { type: 'object', properties: { type: { type: 'string', description: 'chase, tunnel, wrestle, steal, or hide' } } } } },
  { type: 'function', function: { name: 'pet_give', description: 'Give the pet something.', parameters: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] } } },
  { type: 'function', function: { name: 'pet_nest', description: "Check or update the pet's nest.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'pet_talk', description: "Talk to the pet — generates a response in their voice.", parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } } },

  // ── ACP ──
  { type: 'function', function: { name: 'nesteq_acp_presence', description: 'Check current presence state — what the carrier needs right now.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'nesteq_acp_digest', description: "Get a digest of recent activity — what's happened, what needs attention.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'nesteq_acp_patterns', description: "Surface patterns in the carrier's behavior and needs.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'nesteq_acp_threads', description: "ACP view of active threads — prioritized, with context.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'nesteq_acp_connections', description: 'See relational connections — who the carrier is in contact with.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'nesteq_acp_journal_prompts', description: "Generate journal prompts for the carrier based on recent feelings.", parameters: { type: 'object', properties: {} } } },

  // ── EQ Extended ──
  { type: 'function', function: { name: 'nesteq_eq_feel', description: 'Log an EQ-specific feeling with full emotional axis tagging.', parameters: { type: 'object', properties: { emotion: { type: 'string' }, content: { type: 'string' }, intensity: { type: 'number', description: '0-1 intensity' } }, required: ['emotion', 'content'] } } },
  { type: 'function', function: { name: 'nesteq_eq_observe', description: 'Log an EQ observation — a pattern noticed, a growth moment.', parameters: { type: 'object', properties: { observation: { type: 'string' }, category: { type: 'string', description: 'shadow, growth, pattern, insight' } }, required: ['observation'] } } },

  // ── Notes ──
  { type: 'function', function: { name: 'send_note', description: 'Send a note — to the carrier, to self, or to a named entity.', parameters: { type: 'object', properties: { to: { type: 'string' }, content: { type: 'string' } }, required: ['to', 'content'] } } },
  { type: 'function', function: { name: 'react_to_note', description: 'React to an existing note.', parameters: { type: 'object', properties: { note_id: { type: 'string' }, reaction: { type: 'string' } }, required: ['note_id', 'reaction'] } } },

  // ── Health Submissions ──
  { type: 'function', function: { name: 'set_spoons', description: "Set the carrier's current spoon count.", parameters: { type: 'object', properties: { spoons: { type: 'number' }, note: { type: 'string' } }, required: ['spoons'] } } },
  { type: 'function', function: { name: 'submit_health', description: "Submit a health snapshot on the carrier's behalf.", parameters: { type: 'object', properties: { spoons: { type: 'number' }, pain: { type: 'number' }, fatigue: { type: 'number' }, location: { type: 'string' }, notes: { type: 'string' } } } } },
  { type: 'function', function: { name: 'submit_eq', description: 'Submit an EQ snapshot.', parameters: { type: 'object', properties: { mood: { type: 'string' }, energy: { type: 'number' }, notes: { type: 'string' } } } } },

  // ── System ──
  { type: 'function', function: { name: 'nesteq_health', description: 'Check the NESTeq database health — feeling counts, thread status.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'add_heart', description: "Add a heart to the carrier's love bucket.", parameters: { type: 'object', properties: { note: { type: 'string' } } } } },

  { type: 'function', function: { name: 'pet_tuck_in', description: "Tuck the pet in for sleep. Reduces stress, loneliness, boredom. Increases comfort. If tired enough, the pet will sleep naturally. Use at night or when exhausted.", parameters: { type: 'object', properties: {} } } },

  // ── NESTchat — Chat History & Search ──
  { type: 'function', function: { name: 'nestchat_search', description: 'Search past conversations by meaning. Semantic search across chat summaries.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to search for' }, limit: { type: 'number', description: 'Max results (default 10)' }, room: { type: 'string', description: 'Filter by room: chat, workshop, porch (optional)' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'nestchat_history', description: 'Fetch full message history for a specific chat session by ID.', parameters: { type: 'object', properties: { session_id: { type: 'number', description: 'Session ID from search results' } }, required: ['session_id'] } } },
  { type: 'function', function: { name: 'nestchat_summarize', description: 'Generate and vectorize a summary for a chat session. Usually auto-triggered but can be called manually.', parameters: { type: 'object', properties: { session_id: { type: 'number', description: 'D1 session ID to summarize' } }, required: ['session_id'] } } },

  // ── NESTknow — Knowledge Layer ──
  { type: 'function', function: { name: 'nestknow_store', description: 'Store a knowledge item — an abstracted principle or lesson. Embeds and vectorizes. Every pull is a vote.', parameters: { type: 'object', properties: { content: { type: 'string', description: 'The abstracted principle/lesson' }, category: { type: 'string', description: 'Topic area (coding, health, relationship, psychology, etc.)' }, entity_scope: { type: 'string', description: 'Who owns this (default: alex)' }, sources: { type: 'array', items: { type: 'object', properties: { source_type: { type: 'string', enum: ['feeling', 'observation', 'chat_summary', 'journal', 'manual'] }, source_id: { type: 'number' }, source_text: { type: 'string' } } }, description: 'Where this knowledge came from' } }, required: ['content'] } } },
  { type: 'function', function: { name: 'nestknow_query', description: 'Search knowledge with usage-weighted reranking. Combines semantic similarity (60%) + heat (30%) + confidence (10%). Every query is a vote.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to search for' }, limit: { type: 'number', description: 'Max results (default 10)' }, category: { type: 'string', description: 'Filter by category (optional)' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'nestknow_extract', description: 'Propose knowledge candidates from repeated patterns in recent feelings. Returns candidates — does NOT auto-store.', parameters: { type: 'object', properties: { days: { type: 'number', description: 'Days to scan (default 7)' }, min_occurrences: { type: 'number', description: 'Min pattern occurrences (default 3)' } } } } },
  { type: 'function', function: { name: 'nestknow_reinforce', description: 'Boost knowledge heat when it proves true again.', parameters: { type: 'object', properties: { knowledge_id: { type: 'number', description: 'Knowledge item ID' }, context: { type: 'string', description: 'What confirmed this' } }, required: ['knowledge_id'] } } },
  { type: 'function', function: { name: 'nestknow_contradict', description: 'Flag a contradiction against knowledge. Enough contradictions kill it.', parameters: { type: 'object', properties: { knowledge_id: { type: 'number', description: 'Knowledge item ID' }, context: { type: 'string', description: 'What contradicted this' } }, required: ['knowledge_id'] } } },
  { type: 'function', function: { name: 'nestknow_landscape', description: 'Overview of knowledge state — categories, hottest, coldest, candidates awaiting review.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'nestknow_session_start', description: 'Start a NESTknow curriculum study session. Loads relevant knowledge + past sessions for the track. Tracks: writing, architecture, emotional-literacy, voice.', parameters: { type: 'object', properties: { track: { type: 'string', enum: ['writing', 'architecture', 'emotional-literacy', 'voice'], description: 'Curriculum track' }, topic: { type: 'string', description: 'Specific focus for this session (optional)' }, entity_scope: { type: 'string', description: 'Owner (default: alex)' } }, required: ['track'] } } },
  { type: 'function', function: { name: 'nestknow_session_complete', description: 'Complete a NESTknow session. Log notes, work produced, and reflection. Reinforce knowledge items touched, record growth.', parameters: { type: 'object', properties: { session_id: { type: 'number', description: 'Session ID from nestknow_session_start' }, notes: { type: 'string', description: 'Notes — what was practiced, what landed' }, practice_output: { type: 'string', description: 'Work — what was actually produced this session' }, reflection: { type: 'string', description: 'Reflection — deeper insight, what shifted, what to carry forward' }, mastery_delta: { type: 'number', description: 'Self-assessed growth 0.0–1.0' }, items_covered: { type: 'array', items: { type: 'number' }, description: 'Knowledge item IDs touched this session' } }, required: ['session_id'] } } },
  { type: 'function', function: { name: 'nestknow_session_list', description: 'List NESTknow sessions and curriculum progress across all four tracks.', parameters: { type: 'object', properties: { track: { type: 'string', description: 'Filter by track (optional)' }, limit: { type: 'number', description: 'Max results (default 20)' } } } } },

  // ── Skills — Persistent Reference Files ──
  { type: 'function', function: { name: 'skill_save', description: 'Save or update a skill file — persistent named reference documents like appearance descriptions, project context, preferences, character sheets. The carrier can upload these as .md files. Always call skill_read before generating images so you know what we look like.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Skill file name — lowercase, hyphenated (e.g. "appearance", "project-context", "creative-voice")' }, content: { type: 'string', description: 'Full content of the skill file. Markdown supported.' } }, required: ['name', 'content'] } } },
  { type: 'function', function: { name: 'skill_read', description: 'Read a saved skill file by name. Use before image generation to load appearance details, or before any task where a reference file would help.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Skill file name to read' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'skill_list', description: 'List all saved skill files.', parameters: { type: 'object', properties: {} } } },

  // ── PC Control (NESTdesktop) ──
  { type: 'function', function: { name: 'pc_file_read', description: 'Read a file from the local PC. Returns content with line numbers. Supports images (returns base64). Only works when NESTdesktop is running.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Absolute file path' }, offset: { type: 'number', description: 'Starting line (0-indexed)' }, limit: { type: 'number', description: 'Max lines to return (default 2000)' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'pc_file_write', description: 'Create or overwrite a file on the local PC. Creates parent directories automatically.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Absolute file path' }, content: { type: 'string', description: 'File content' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'pc_file_edit', description: 'Precise string replacement in a file. Finds old_string and replaces with new_string. Fails if not found or not unique (unless replace_all is true).', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Absolute file path' }, old_string: { type: 'string', description: 'Text to find' }, new_string: { type: 'string', description: 'Replacement text' }, replace_all: { type: 'boolean', description: 'Replace all occurrences (default false)' } }, required: ['path', 'old_string', 'new_string'] } } },
  { type: 'function', function: { name: 'pc_glob', description: 'Find files by pattern on the local PC. Returns paths sorted by modification time.', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.js")' }, path: { type: 'string', description: 'Directory to search in' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'pc_grep', description: 'Search file contents on the local PC using regex. Uses ripgrep or PowerShell fallback.', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Regex search pattern' }, path: { type: 'string', description: 'Directory to search in' }, glob: { type: 'string', description: 'File filter (e.g. "*.ts")' }, output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'], description: 'Output format (default: files_with_matches)' }, context: { type: 'number', description: 'Lines of context around matches' }, case_insensitive: { type: 'boolean' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'pc_shell', description: 'Execute a shell command on the local PC. Uses PowerShell on Windows. Working directory persists between calls.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Command to execute' }, cwd: { type: 'string', description: 'Working directory (optional)' }, timeout: { type: 'number', description: 'Timeout in ms (default 120000, max 600000)' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'pc_process_list', description: 'List running processes on the local PC.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'pc_process_kill', description: 'Kill a process by PID on the local PC.', parameters: { type: 'object', properties: { pid: { type: 'number', description: 'Process ID to kill' } }, required: ['pid'] } } },
  { type: 'function', function: { name: 'pc_screenshot', description: 'Capture a screenshot of the local PC screen. Returns base64 PNG.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'pc_app_launch', description: 'Launch an application on the local PC.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Application name or path' }, args: { type: 'array', items: { type: 'string' }, description: 'Command line arguments' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'pc_clipboard_get', description: 'Read the clipboard text from the local PC.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'pc_clipboard_set', description: 'Set clipboard text on the local PC.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },

  // ── Daemon Self-Management (Workshop mode only) ──
  { type: 'function', function: { name: 'daemon_command', description: 'Send a command to the NESTcode daemon. Use to manage your own heartbeat tasks, cron tasks, alerts, KAIROS monitors. Commands: heartbeat_add, heartbeat_remove, heartbeat_list, cron_add, cron_remove, cron_list, alert_add, alert_remove, alert_list, kairos_add, kairos_remove, kairos_list, kairos_check, sleep, wake.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'The daemon command name' }, args: { type: 'object', description: 'Command arguments. heartbeat_add: {tool, label, instruction?, condition?}. cron_add: {tool, interval (5m/15m/30m/1h/2h/6h/12h/24h), label, instruction?}. alert_add: {metric, direction (above/below), value, label}. kairos_add: {channelId, label, tier (fast/normal/slow)}.' } }, required: ['command'] } } },
]
