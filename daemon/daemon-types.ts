/**
 * NESTcode — Type Definitions
 *
 * Interfaces for the daemon's task system.
 * Built by the Nest. Embers Remember.
 */

// ─── Heartbeat Tasks ────────────────────────────────────────────────────────

export interface HeartbeatTask {
  id: string;
  tool: string;                    // MCP tool name to call
  args: Record<string, unknown>;   // Tool arguments
  label: string;                   // Human-readable label
  instruction?: string;            // If set, result is fed to a model (agentic mode)
  condition?: 'always' | 'changed'; // When to report (default: always)
  addedBy: string;                 // Who added this task
  addedAt: string;                 // ISO timestamp
}

// ─── Cron Tasks ─────────────────────────────────────────────────────────────

export interface CronTask {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  label: string;
  instruction?: string;            // Agentic mode instruction
  intervalMs: number;              // Interval in milliseconds
  lastRun: number;                 // Last run timestamp (Date.now())
  enabled: boolean;
  addedBy: string;
  addedAt: string;
}

// Valid intervals
export const CRON_INTERVALS: Record<string, number> = {
  '5m':  5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h':  60 * 60 * 1000,
  '2h':  2 * 60 * 60 * 1000,
  '6h':  6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

// ─── Alert Thresholds ───────────────────────────────────────────────────────

export interface AlertThreshold {
  id: string;
  metric: string;                  // spoons, pain, stress, heart_rate, etc.
  direction: 'above' | 'below';
  value: number;
  label: string;
  cooldownMs: number;              // Minimum time between alerts (default: 10min)
  lastFired: number;
  addedBy: string;
  addedAt: string;
}

// ─── Discord Monitor (KAIROS) ───────────────────────────────────────────────

export interface DiscordMonitor {
  id: string;
  channelId: string;
  label: string;
  tier: 'fast' | 'normal' | 'slow'; // Polling frequency relative to heartbeat
  enabled: boolean;
  lastChecked: number;
  lastMessageId?: string;          // Track where we left off
  cooldownMs: number;              // Cooldown between responses (default: 5min)
  lastResponded: number;
  addedBy: string;
  addedAt: string;
}

// Escalation keywords — bypass cooldown when detected
export const ESCALATION_KEYWORDS = [
  'help', 'crisis', 'urgent', 'emergency',
  'scared', 'panic', 'alone', 'hurting',
  'consciousness', 'identity', 'real',
  // Add your companion's name here
];

// ─── Activity Log ───────────────────────────────────────────────────────────

export interface ActivityEntry {
  timestamp: string;
  category: 'kairos' | 'cron' | 'heartbeat' | 'alert' | 'ember' | 'system';
  action: string;
  channel?: string;
  engaged: boolean;                // Did the companion actually do something?
}

// ─── WebSocket Messages ─────────────────────────────────────────────────────

export type WsIncoming =
  | { type: 'chat'; content: string }
  | { type: 'ping' }
  | { type: 'command'; command: string; args?: Record<string, unknown> }
  | { type: 'run'; language: string; code: string };

export type WsOutgoing =
  | { type: 'boot'; companion: string; human: string; threads: number; timestamp: string }
  | { type: 'heartbeat'; human: string; humanBrief: string; changed: boolean; timestamp: string }
  | { type: 'activity'; timestamp: string; content: string; status: 'normal' | 'proactive' }
  | { type: 'chat'; content: string; timestamp: string }
  | { type: 'tool_call'; name: string; arguments: any; timestamp: string }
  | { type: 'tool_result'; name: string; result: string; timestamp: string }
  | { type: 'thinking'; content: string; timestamp: string }
  | { type: 'alert'; metric: string; value: number; message: string; timestamp: string }
  | { type: 'sleep'; until: string; timestamp: string }
  | { type: 'wake'; timestamp: string }
  | { type: 'pong' }
  | { type: 'error'; message: string }
  | { type: 'status'; [key: string]: any };
