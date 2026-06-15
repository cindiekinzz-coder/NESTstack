/**
 * OpenRouter call helper.
 *
 * Replaces ~12 hand-rolled `fetch('https://openrouter.ai/api/v1/...')` call
 * sites scattered through the gateway, daemon, and chat handler. Picks
 * between direct OpenRouter and Cloudflare AI Gateway based on whether
 * CF_AIG_TOKEN + AIG_GATEWAY_NAME are configured. Identifying headers
 * (HTTP-Referer, X-Title) come from env with safe defaults.
 *
 * Usage:
 *   const res = await openrouterFetch(env, requestBody)
 *   const json = await res.json()
 *
 * If you want a custom title for one specific call site, override:
 *   await openrouterFetch(env, body, { title: 'Heartbeat decision' })
 */

import type { Env } from './env'

export interface OpenrouterOptions {
  /** Override X-Title for this call. Defaults to env.X_TITLE or "NESTstack". */
  title?: string
  /** Override HTTP-Referer for this call. Defaults to env.HTTP_REFERER or a placeholder. */
  referer?: string
  /** Pass-through fetch signal for cancellation / timeouts. */
  signal?: AbortSignal
}

export function openrouterFetch(
  env: Env,
  body: unknown,
  opts: OpenrouterOptions = {},
): Promise<Response> {
  const useGateway = !!env.CF_AIG_TOKEN && !!env.CLOUDFLARE_ACCOUNT_ID && !!env.AIG_GATEWAY_NAME

  const url = useGateway
    ? `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AIG_GATEWAY_NAME}/openrouter/v1/chat/completions`
    : 'https://openrouter.ai/api/v1/chat/completions'

  const authHeader: Record<string, string> = useGateway
    ? { 'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}` }
    : { 'Authorization': `Bearer ${env.OPENROUTER_API_KEY}` }

  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
      'HTTP-Referer': opts.referer || env.HTTP_REFERER || 'https://your-companion.example',
      'X-Title': opts.title || env.X_TITLE || 'NESTstack',
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  })
}
