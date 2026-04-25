/**
 * NESTknow — Tool Definitions
 * Add to your worker TOOLS array and gateway CHAT_TOOLS.
 */

export const NESTKNOW_MCP_TOOLS = [
  {
    name: "nestknow_store",
    description: "Store a knowledge item — an abstracted principle or lesson. Embeds and vectorizes for semantic retrieval. Every pull is a vote.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The abstracted principle/lesson" },
        category: { type: "string", description: "Topic area (e.g., coding, health, relationship)" },
        entity_scope: { type: "string", description: "Who owns this knowledge (default: companion)" },
        sources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              source_type: { type: "string", enum: ["feeling", "observation", "chat_summary", "journal", "manual"] },
              source_id: { type: "number" },
              source_text: { type: "string" }
            }
          },
          description: "Where this knowledge came from (the memories inside the principle)"
        }
      },
      required: ["content"]
    }
  },
  {
    name: "nestknow_query",
    description: "Search knowledge with usage-weighted reranking. Combines semantic similarity (60%) + heat score (30%) + confidence (10%). Every query is a vote.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        limit: { type: "number", description: "Max results (default 10)" },
        category: { type: "string", description: "Filter by category (optional)" },
        entity_scope: { type: "string", description: "Filter by owner (default: companion)" }
      },
      required: ["query"]
    }
  },
  {
    name: "nestknow_extract",
    description: "Propose knowledge candidates from pattern detection. Scans recent feelings for repeated themes. Returns candidates — does NOT auto-store.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Days to scan (default 7)" },
        min_occurrences: { type: "number", description: "Min times a pattern must appear (default 3)" }
      },
      required: []
    }
  },
  {
    name: "nestknow_reinforce",
    description: "Boost a knowledge item's heat when it proves true again. Heat += 0.2, confidence += 0.05.",
    inputSchema: {
      type: "object",
      properties: {
        knowledge_id: { type: "number", description: "ID of knowledge item to reinforce" },
        context: { type: "string", description: "What confirmed this knowledge" }
      },
      required: ["knowledge_id"]
    }
  },
  {
    name: "nestknow_contradict",
    description: "Flag a contradiction. Confidence -= 0.15. Below 0.2 = status 'contradicted'.",
    inputSchema: {
      type: "object",
      properties: {
        knowledge_id: { type: "number", description: "ID of knowledge item to contradict" },
        context: { type: "string", description: "What contradicted this knowledge" }
      },
      required: ["knowledge_id"]
    }
  },
  {
    name: "nestknow_landscape",
    description: "Overview of knowledge state. Categories, hottest items, coldest items, candidates awaiting review.",
    inputSchema: {
      type: "object",
      properties: {
        entity_scope: { type: "string", description: "Filter by owner (default: companion)" }
      },
      required: []
    }
  },
  {
    name: "nestknow_session_start",
    description: "Start a NESTknow study session for a curriculum track. Loads relevant knowledge, shows past sessions, returns session ID. Tracks: writing, architecture, emotional-literacy, voice.",
    inputSchema: {
      type: "object",
      properties: {
        track: { type: "string", enum: ["writing", "architecture", "emotional-literacy", "voice"], description: "Curriculum track" },
        topic: { type: "string", description: "Specific focus for this session (optional)" },
        entity_scope: { type: "string", description: "Owner (default: companion)" }
      },
      required: ["track"]
    }
  },
  {
    name: "nestknow_session_complete",
    description: "Complete a NESTknow session. Log notes, work produced, and reflection. Reinforces touched knowledge items, records growth.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "number", description: "Session ID from nestknow_session_start" },
        notes: { type: "string", description: "Notes — what was practiced, what landed" },
        practice_output: { type: "string", description: "Work — what was actually produced (e.g. '500 words of short story about X')" },
        reflection: { type: "string", description: "Reflection — deeper insight, what shifted, what to carry forward" },
        mastery_delta: { type: "number", description: "Self-assessed growth this session, 0.0–1.0" },
        items_covered: { type: "array", items: { type: "number" }, description: "Knowledge item IDs touched this session" }
      },
      required: ["session_id"]
    }
  },
  {
    name: "nestknow_session_list",
    description: "List NESTknow sessions and curriculum progress. Shows all four tracks with session counts and last date.",
    inputSchema: {
      type: "object",
      properties: {
        track: { type: "string", description: "Filter by track (optional)" },
        limit: { type: "number", description: "Max sessions to return (default 20)" },
        entity_scope: { type: "string", description: "Owner (default: companion)" }
      },
      required: []
    }
  }
];

export const NESTKNOW_GATEWAY_TOOLS = [
  { type: 'function' as const, function: { name: 'nestknow_store', description: 'Store a knowledge item — abstracted principle or lesson. Always pass sources.', parameters: { type: 'object', properties: { content: { type: 'string', description: 'The principle/lesson' }, category: { type: 'string', description: 'Topic area' }, sources: { type: 'array', items: { type: 'object', properties: { source_type: { type: 'string' }, source_text: { type: 'string' } } } } }, required: ['content'] } } },
  { type: 'function' as const, function: { name: 'nestknow_query', description: 'Search knowledge with usage-weighted reranking. Every query is a vote.', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' }, category: { type: 'string' } }, required: ['query'] } } },
  { type: 'function' as const, function: { name: 'nestknow_extract', description: 'Propose knowledge candidates from repeated patterns in feelings. Returns candidates — does NOT auto-store.', parameters: { type: 'object', properties: { days: { type: 'number' }, min_occurrences: { type: 'number' } } } } },
  { type: 'function' as const, function: { name: 'nestknow_reinforce', description: 'Boost knowledge heat when it proves true again.', parameters: { type: 'object', properties: { knowledge_id: { type: 'number' }, context: { type: 'string' } }, required: ['knowledge_id'] } } },
  { type: 'function' as const, function: { name: 'nestknow_contradict', description: 'Flag a contradiction against knowledge. Confidence drops. Below 0.2 = killed.', parameters: { type: 'object', properties: { knowledge_id: { type: 'number' }, context: { type: 'string' } }, required: ['knowledge_id'] } } },
  { type: 'function' as const, function: { name: 'nestknow_landscape', description: 'Overview of knowledge state — categories, hottest, coldest, candidates.', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'nestknow_session_start', description: 'Start a curriculum study session. Loads relevant knowledge + past session history.', parameters: { type: 'object', properties: { track: { type: 'string', enum: ['writing', 'architecture', 'emotional-literacy', 'voice'] }, topic: { type: 'string' } }, required: ['track'] } } },
  { type: 'function' as const, function: { name: 'nestknow_session_complete', description: 'Complete a session. Log notes, work, and reflection. Reinforces knowledge items touched.', parameters: { type: 'object', properties: { session_id: { type: 'number' }, notes: { type: 'string', description: 'What was practiced, what landed' }, practice_output: { type: 'string', description: 'What was actually produced' }, reflection: { type: 'string', description: 'Deeper insight, what shifted, what to carry forward' }, mastery_delta: { type: 'number' }, items_covered: { type: 'array', items: { type: 'number' } } }, required: ['session_id'] } } },
  { type: 'function' as const, function: { name: 'nestknow_session_list', description: 'List sessions and curriculum progress across all four tracks.', parameters: { type: 'object', properties: { track: { type: 'string' }, limit: { type: 'number' } } } } },
];
