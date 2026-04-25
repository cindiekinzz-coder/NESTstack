export interface Env {
  MCP_OBJECT: DurableObjectNamespace
  DAEMON_OBJECT: DurableObjectNamespace
  DISCORD_MCP_SERVICE: Fetcher
  GALLERY: KVNamespace

  // Chat model (set in wrangler.toml [vars])
  CHAT_MODEL: string

  // Backend URLs (set in wrangler.toml [vars])
  AI_MIND_URL: string
  HEALTH_URL: string
  DISCORD_MCP_URL: string
  DISCORD_URL: string
  SPOTIFY_URL: string

  // Discord MCP secret (set with wrangler secret put)
  DISCORD_MCP_SECRET: string

  // Secrets (set with wrangler secret put)
  MCP_API_KEY: string
  OPENROUTER_API_KEY: string
  ELEVENLABS_API_KEY: string
  CLOUDFLARE_API_TOKEN: string

  // Web search (set with wrangler secret put)
  TAVILY_API_KEY: string

  // Cloudflare account (set in wrangler.toml [vars])
  CLOUDFLARE_ACCOUNT_ID: string

  // ElevenLabs voice (set in wrangler.toml [vars])
  ELEVENLABS_VOICE_ID: string

  // Carrier profile JSON (set with wrangler secret put CARRIER_PROFILE_JSON)
  // See carrier-profile.example.json for schema. Falls back to defaults if unset.
  CARRIER_PROFILE_JSON: string
}
