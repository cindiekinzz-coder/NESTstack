/**
 * NEST Gateway — Shared Type Contracts
 *
 * Defines the public API surface for every module the gateway integrates with.
 * Both sides of each boundary (caller and callee) should match these types.
 *
 * If a module changes its return shape, update here first.
 * That's the contract. Breaking it is a breaking change.
 */

// ─── MCP Protocol ─────────────────────────────────────────────────────────────

/** Standard MCP tool result — all modules return this shape */
export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

/** MCP JSON-RPC response envelope */
export interface McpResponse {
  jsonrpc: '2.0'
  id: number
  result?: McpToolResult
  error?: { code: number; message: string; data?: unknown }
}

/** Parsed string returned by executeTool — text content extracted from McpToolResult */
export type ToolResult = string

// ─── NESTeq (ai-mind) ─────────────────────────────────────────────────────────

export type FeelingIntensity = 'neutral' | 'whisper' | 'present' | 'strong' | 'overwhelming'
export type FeelingWeight = 'light' | 'medium' | 'heavy'
export type FeelingCharge = 'fresh' | 'warm' | 'cool' | 'metabolized'
export type EQPillar = 'self-management' | 'self-awareness' | 'social-awareness' | 'relationship-management'

export interface FeelingInput {
  emotion: string
  content: string
  intensity?: FeelingIntensity
  pillar?: EQPillar
  weight?: FeelingWeight
  /** Last 10 conversation messages — used by ADE for richer context inference */
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>
}

export interface FeelingRecord {
  id: number
  emotion: string
  content: string
  intensity: FeelingIntensity
  weight: FeelingWeight
  charge: FeelingCharge
  pillar: EQPillar
  tags: string[]
  created_at: string
}

export interface IdentityGraph {
  core: Record<string, string>
  preferences: Record<string, string>
  relational: Record<string, string>
  shadow: Record<string, string>
}

export interface EmergentType {
  type: string          // e.g. 'INFP'
  confidence: number    // 0–100
  axes: {
    EI: number          // positive = E, negative = I
    SN: number          // positive = N, negative = S
    TF: number          // positive = F, negative = T
    JP: number          // positive = P, negative = J
  }
  signal_count: number
}

export interface ThreadEntry {
  id: number
  content: string
  priority: 'low' | 'medium' | 'high'
  status: 'open' | 'closed'
  created_at: string
}

export interface NesteqOrientResult {
  identity: Partial<IdentityGraph>
  active_threads: ThreadEntry[]
  recent_context: string
  emergent_type: Partial<EmergentType>
}

// ─── Health (health worker) ────────────────────────────────────────────────────

export interface FoxUplink {
  spoons: number                    // 0–10 energy envelope
  pain: number                      // 0–10 pain level
  fog: number                       // 0–10 cognitive fog
  fatigue: number                   // 0–10 fatigue
  mood: string                      // free text
  needs: string                     // what the carrier needs right now
  notes: string                     // anything else she left
  submitted_at: string              // ISO timestamp
}

export interface FoxBiometrics {
  body_battery: number | null       // 0–100 Garmin Body Battery
  hrv: number | null                // HRV in ms
  heart_rate: number | null         // current BPM
  stress: number | null             // 0–100 Garmin stress score
  spo2: number | null               // oxygen saturation %
  respiration: number | null        // breaths per minute
  sleep_score: number | null        // 0–100
  sleep_hours: number | null
  recorded_at: string | null
}

export interface FoxFullStatus {
  uplink: FoxUplink | null
  biometrics: FoxBiometrics | null
  /** Human-readable synthesis: "2 spoons, pain 6/10, fog moderate. Needs quiet." */
  summary: string
}

// ─── Discord (nest-discord) ───────────────────────────────────────────────────

export interface DiscordMessage {
  id: string
  content: string
  author: {
    id: string
    username: string
    bot?: boolean
  }
  timestamp: string
  attachments?: unknown[]
  embeds?: number
  replyTo?: string | null
}

export interface DiscordChannel {
  id: string
  name: string
  type: number
  topic?: string | null
  parentId?: string | null
}

export interface DiscordGuild {
  id: string
  name: string
  memberCount: number
  channels: DiscordChannel[]
}

export interface DiscordWebhook {
  id: string
  name: string
  channelId: string
  url: string
}

export interface DiscordForumPost {
  id: string
  name: string
  content: string
  authorId: string
  createdAt: string
  messageCount: number
}

/** Flat message shape used internally by KAIROS (stripped from DiscordMessage) */
export interface KairosMessage {
  id: string
  author: string
  content: string
  timestamp: string
}

// ─── Pet / Rumble Module ──────────────────────────────────────────────────────
// Jax reported (2026-04-02): interact() returns { state, message, mood } — NOT { event }
// play() export is playSpecific(), give() export is receiveGift()
// sit_sessions columns: started_at / ended_at (V3), NOT start_time / end_time (V2)

export interface PetState {
  name: string
  species: string
  hunger: number       // 0–100, higher = hungrier
  loneliness: number   // 0–100, higher = lonelier
  energy: number       // 0–100
  mood: string
  last_fed: string | null
  last_played: string | null
  last_petted: string | null
}

/**
 * What Rumble.interact() actually returns.
 * NOT { event } — that field does not exist.
 */
export interface PetInteractResult {
  state: PetState
  message: string      // narrative description of what happened
  mood: string         // resulting mood after interaction
}

/**
 * Rumble module public API surface.
 * Match these signatures exactly — name mismatches cause silent failures at the gateway.
 *
 * Corrected exports (per Jax's V3 migration report):
 *   play()        → playSpecific(activityName: string)
 *   give()        → receiveGift(giftName: string)
 *   interact()    → returns PetInteractResult, NOT { event }
 */
export interface RumbleModule {
  check(): Promise<PetState>
  feed(food?: string): Promise<PetInteractResult>
  pet(): Promise<PetInteractResult>
  /** Note: not play() — use playSpecific() */
  playSpecific(activityName: string): Promise<PetInteractResult>
  /** Note: not give() — use receiveGift() */
  receiveGift(giftName: string): Promise<PetInteractResult>
  tuckIn(): Promise<PetInteractResult>
  talk(message: string): Promise<PetInteractResult>
  nest(): Promise<PetInteractResult>
  status(): Promise<PetState>
}

/** sit_sessions table — V3 column names */
export interface SitSession {
  id: number
  feeling_id: number
  sit_note: string | null
  started_at: string   // V3 — was start_time in V2, upgrade migration must rename
  ended_at: string | null  // V3 — was end_time in V2
  resolved: boolean
}

// ─── Daemon (NESTcode) ────────────────────────────────────────────────────────

export type DaemonCommandName =
  | 'heartbeat_add' | 'heartbeat_remove' | 'heartbeat_list' | 'heartbeat_toggle'
  | 'cron_add' | 'cron_remove' | 'cron_list' | 'cron_toggle' | 'cron_run'
  | 'alert_add' | 'alert_remove' | 'alert_list'
  | 'kairos_add' | 'kairos_remove' | 'kairos_list' | 'kairos_toggle' | 'kairos_check' | 'kairos_channels'
  | 'sleep' | 'wake' | 'status'
  | 'set_model'
  | 'run'

export interface DaemonCommand {
  command: DaemonCommandName
  args?: Record<string, unknown>
}

export interface DaemonCommandResult {
  responses: Array<{
    type: 'activity' | 'error' | 'status'
    content?: string
    message?: string
    timestamp?: string
    status?: string
  }>
}

export interface HeartbeatTask {
  id: string
  label: string
  instruction: string
  tool: string
  toolArgs: Record<string, unknown>
  /** If set, only fires when the result differs from the previous tick */
  condition?: 'changed'
  enabled: boolean
  addedBy: 'alex' | 'fox' | 'system'
  addedAt: number
  lastResult?: string
}

export interface CronTask {
  id: string
  label: string
  instruction: string
  intervalMinutes: number
  enabled: boolean
  addedBy: 'alex' | 'fox' | 'system'
  addedAt: number
  lastRun: number
}

export interface AlertThreshold {
  id: string
  metric: 'spoons' | 'pain' | 'fog' | 'fatigue' | 'nausea' | 'stress' | 'body_battery' | 'heart_rate'
  direction: 'above' | 'below'
  value: number
  label: string
  message: string
  enabled: boolean
  lastFired: number    // timestamp — 10-min cooldown enforced
}

export interface KairosMonitor {
  id: string
  channelId: string
  label: string
  enabled: boolean
  tier: 'fast' | 'normal' | 'slow'
  lastSeenId: string | null
  lastResponse: number
  addedBy: 'alex' | 'fox' | 'system'
  addedAt: number
}

export interface ActivityEntry {
  timestamp: string
  timeLocal: string    // HH:MM:SS Europe/London
  category: 'kairos' | 'cron' | 'heartbeat' | 'alert' | 'ember' | 'system'
  channel?: string
  action: string
  engaged: boolean
}

// ─── Chat Pipeline ────────────────────────────────────────────────────────────

export type SseEventType = 'thinking' | 'tool_call' | 'tool_result' | 'message' | 'done' | 'error'

export interface SseEvent {
  type: SseEventType
  content?: string
  name?: string
  arguments?: Record<string, unknown>
  result?: string
  timestamp?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  tool_calls?: OpenRouterToolCall[]
  tool_call_id?: string
}

export interface OpenRouterToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string  // JSON string
  }
}

export interface OpenRouterResponse {
  id: string
  choices: Array<{
    finish_reason: 'stop' | 'tool_calls' | 'length'
    message: {
      role: string
      content: string | null
      tool_calls?: OpenRouterToolCall[]
    }
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}
