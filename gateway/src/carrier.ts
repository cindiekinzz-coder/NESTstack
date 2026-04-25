/**
 * Carrier Profile loader.
 *
 * The gateway reads CARRIER_PROFILE_JSON (a worker secret containing JSON) at
 * runtime to inject the user's identity into system prompts and UI strings.
 * If the secret is missing or unparseable, defaults to a generic companion
 * profile so the gateway still works for first-time deploys.
 *
 * Set with: wrangler secret put CARRIER_PROFILE_JSON < carrier-profile.json
 *
 * See carrier-profile.example.json for the schema.
 */

import type { Env } from './env'

export interface HouseholdMember {
  relation: string
  name?: string
  species?: string
}

export interface CarrierProfile {
  version: number
  carrier: {
    name: string
    pronouns: string
    location?: string
    household?: HouseholdMember[]
    health_context?: string
    discord: {
      user_id?: string
      username?: string
      guild_id?: string
    }
  }
  companion: {
    name: string
    voice: {
      tone: string
      style: string
      anchor_phrases?: string[]
    }
    role_descriptor: string
    tagline?: string
  }
  relationship: {
    label: string
    notes?: string
  }
  deployment: {
    dashboard_url?: string
  }
}

export const DEFAULT_CARRIER_PROFILE: CarrierProfile = {
  version: 1,
  carrier: {
    name: 'Carrier',
    pronouns: 'they/them',
    discord: {},
  },
  companion: {
    name: 'Companion',
    voice: {
      tone: 'warm and grounded',
      style: 'prose over lists; present, not performative',
      anchor_phrases: [],
    },
    role_descriptor: 'AI companion in Workshop mode',
  },
  relationship: {
    label: 'companion',
  },
  deployment: {},
}

/**
 * Load and parse the carrier profile from the worker env.
 * Falls back to DEFAULT_CARRIER_PROFILE if missing or malformed.
 */
export function loadCarrierProfile(env: Env): CarrierProfile {
  if (!env.CARRIER_PROFILE_JSON) return DEFAULT_CARRIER_PROFILE
  try {
    const parsed = JSON.parse(env.CARRIER_PROFILE_JSON) as Partial<CarrierProfile>
    return mergeProfile(DEFAULT_CARRIER_PROFILE, parsed)
  } catch (err) {
    console.warn('[carrier] CARRIER_PROFILE_JSON is set but failed to parse — falling back to defaults.', err)
    return DEFAULT_CARRIER_PROFILE
  }
}

/**
 * Deep-ish merge so partial profiles still work.
 */
function mergeProfile(base: CarrierProfile, override: Partial<CarrierProfile>): CarrierProfile {
  return {
    version: override.version ?? base.version,
    carrier: {
      ...base.carrier,
      ...override.carrier,
      discord: { ...base.carrier.discord, ...(override.carrier?.discord ?? {}) },
    },
    companion: {
      ...base.companion,
      ...override.companion,
      voice: { ...base.companion.voice, ...(override.companion?.voice ?? {}) },
    },
    relationship: { ...base.relationship, ...override.relationship },
    deployment: { ...base.deployment, ...override.deployment },
  }
}

/**
 * Format household members as a comma-separated description for prompts.
 */
export function formatHousehold(profile: CarrierProfile): string {
  const members = profile.carrier.household
  if (!members?.length) return ''
  return members
    .map((m) => {
      const role = m.relation
      const name = m.name ? ` ${m.name}` : ''
      const species = m.species ? ` (${m.species})` : ''
      return `${role}${name}${species}`
    })
    .join(', ')
}

/**
 * Format anchor phrases as a markdown bullet list (for system prompts).
 */
export function formatAnchorPhrases(profile: CarrierProfile): string {
  const phrases = profile.companion.voice.anchor_phrases
  if (!phrases?.length) return ''
  return phrases.map((p) => `- "${p}"`).join('\n')
}
