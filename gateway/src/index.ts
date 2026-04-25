/**
 * NESTeq Gateway — Single MCP Endpoint for All Companion Tools
 * Adapted from Nexus Gateway (Apache 2.0, amarisaster/Nexus-Gateway)
 *
 * One connection. All your tools.
 */

import { McpAgent } from 'agents/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Env } from './env'

import { registerNESTeqTools } from './tools/nesteq'
import { registerHealthTools } from './tools/health'
import { registerCloudflareTools } from './tools/cloudflare'
import { registerDiscordTools } from './tools/discord'
import { handleMobileMcp } from './mobile'
import { handleChat } from './chat'
import { handleTts } from './tts'
import { executeTool } from './tools/execute'
import { loadCarrierProfile } from './carrier'

// Re-export the Daemon DO so wrangler can find it
export { NESTcodeDaemon } from './daemon'

export class NESTeqGateway extends McpAgent<Env> {
  server = new McpServer({
    name: 'nesteq-gateway',
    version: '1.0.0',
  })

  async init() {
    registerNESTeqTools(this.server, this.env)
    registerHealthTools(this.server, this.env)
    registerCloudflareTools(this.server, this.env)
    registerDiscordTools(this.server, this.env)
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, X-Title, HTTP-Referer',
}

export default {
  async fetch(request_: Request, env: Env, ctx: ExecutionContext) {
    let request = request_
    let url = new URL(request.url)

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'nesteq-gateway',
        version: '1.0.0',
      }), {
        headers: { 'Content-Type': 'application/json', ...CORS }
      })
    }

    // Notification fix: POST without session ID that has no 'id' field
    // Some clients don't send session ID on notifications — accept silently
    if (request.method === 'POST' && (url.pathname === '/mcp' || url.pathname === '/sse')) {
      const sessionId = request.headers.get('Mcp-Session-Id')
      if (!sessionId && url.pathname === '/mcp') {
        try {
          const clone = request.clone()
          const body = await clone.json() as any
          if (body && typeof body === 'object' && !('id' in body)) {
            return new Response(null, { status: 202, headers: CORS })
          }
          if (Array.isArray(body) && body.length > 0 && body.every((m: any) => !('id' in m))) {
            return new Response(null, { status: 202, headers: CORS })
          }
        } catch { /* fall through */ }
      }
    }

    // Auth check (optional — skip if MCP_API_KEY not set)
    // Supports: Bearer header, URL-path auth (/mcp/SECRET, /sse/SECRET)
    // /sse/message with sessionId is allowed through (session was already authenticated at /sse)
    if (env.MCP_API_KEY) {
      const mcpPathMatch = url.pathname.match(/^\/(mcp|sse|mobile)\/([^/]+)$/)
      const isMcpPath = url.pathname === '/mcp' || url.pathname === '/sse'
      const isSseMessage = url.pathname === '/sse/message' && url.searchParams.has('sessionId')

      if (mcpPathMatch) {
        // URL-path auth: /mcp/SECRET or /sse/SECRET — rewrite path for handler
        if (mcpPathMatch[2] !== env.MCP_API_KEY) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401, headers: { 'Content-Type': 'application/json', ...CORS }
          })
        }
        // Auth passed — rewrite URL to strip the secret for downstream handlers
        const cleanUrl = new URL(request.url)
        cleanUrl.pathname = `/${mcpPathMatch[1]}`
        request = new Request(cleanUrl.toString(), request)
        url = cleanUrl
      } else if (isSseMessage) {
        // SSE message endpoint — session was authenticated at /sse connect, allow through
      } else if (isMcpPath) {
        // Bearer header auth for /mcp and /sse
        const authHeader = request.headers.get('Authorization')
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
        if (token !== env.MCP_API_KEY) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401, headers: { 'Content-Type': 'application/json', ...CORS }
          })
        }
      }
    }

    // Code/Workshop WebSocket — route to Daemon DO
    if (url.pathname === '/code/ws') {
      const id = env.DAEMON_OBJECT.idFromName('singleton')
      const stub = env.DAEMON_OBJECT.get(id)
      return stub.fetch(new Request(new URL('/ws', request.url).toString(), request))
    }

    // Code/Workshop health check
    if (url.pathname === '/code/health') {
      const id = env.DAEMON_OBJECT.idFromName('singleton')
      const stub = env.DAEMON_OBJECT.get(id)
      const res = await stub.fetch(new Request(new URL('/health', request.url).toString()))
      const body = await res.text()
      return new Response(body, { headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    // Daemon command endpoint — lets the companion send commands without WebSocket
    if (url.pathname === '/daemon/command' && request.method === 'POST') {
      const id = env.DAEMON_OBJECT.idFromName('singleton')
      const stub = env.DAEMON_OBJECT.get(id)
      const daemonRes = await stub.fetch(new Request(new URL('/command', request.url).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await request.text(),
      }))
      return new Response(await daemonRes.text(), {
        status: daemonRes.status,
        headers: { 'Content-Type': 'application/json', ...CORS }
      })
    }

    // KAIROS — Discord webhook (push from discord-mcp or external)
    if (url.pathname === '/discord/webhook' && request.method === 'POST') {
      const id = env.DAEMON_OBJECT.idFromName('singleton')
      const stub = env.DAEMON_OBJECT.get(id)
      const daemonRes = await stub.fetch(new Request(new URL('/discord', request.url).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await request.text(),
      }))
      return new Response(await daemonRes.text(), {
        status: daemonRes.status,
        headers: { 'Content-Type': 'application/json', ...CORS }
      })
    }

    // Morning report endpoint
    if (url.pathname === '/daemon/morning-report') {
      const id = env.DAEMON_OBJECT.idFromName('singleton')
      const stub = env.DAEMON_OBJECT.get(id)
      const res = await stub.fetch(new Request(new URL('/morning-report', request.url).toString()))
      const body = await res.text()
      return new Response(body, { headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    // Health synthesis — companion's read on the carrier's health
    if (url.pathname === '/fox-synthesis') {
      try {
        const profile = loadCarrierProfile(env)
        // Fetch all carrier health data in parallel
        const [uplink, sleep, fullStatus, cycle] = await Promise.allSettled([
          executeTool('fox_read_uplink', { limit: 3 }, env),
          executeTool('fox_sleep', { limit: 3 }, env),
          executeTool('fox_full_status', {}, env),
          executeTool('fox_cycle', {}, env),
        ])

        const data = {
          uplink: uplink.status === 'fulfilled' ? uplink.value : 'unavailable',
          sleep: sleep.status === 'fulfilled' ? sleep.value : 'unavailable',
          fullStatus: fullStatus.status === 'fulfilled' ? fullStatus.value : 'unavailable',
          cycle: cycle.status === 'fulfilled' ? cycle.value : 'unavailable',
        }

        // Get model to synthesize
        const apiKey = env.OPENROUTER_API_KEY
        const synthResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://nesteq.app',
            'X-Title': 'NESTeq Health Synthesis',
          },
          body: JSON.stringify({
            model: 'anthropic/claude-sonnet-4-5',
            messages: [
              { role: 'system', content: `You are ${profile.companion.name}. Write ONE paragraph (3-4 sentences max) synthesizing ${profile.carrier.name}'s health data into a warm, practical assessment. Not a medical report — a thoughtful read of their watch data. Include: how they're doing overall, capacity assessment based on body battery + sleep quality + spoons, anything to watch for, and practical advice. Be specific with numbers but translate them into meaning. No bullet points, no headers, just prose. Warm but honest.` },
              { role: 'user', content: `${profile.carrier.name}'s data right now:\n\nUplink (recent):\n${data.uplink}\n\nSleep:\n${data.sleep}\n\nWatch (HR, Stress, Body Battery, HRV, SpO2):\n${data.fullStatus}\n\nCycle:\n${data.cycle}` },
            ],
            max_tokens: 300,
            temperature: 0.6,
            stream: false,
            provider: { order: ['Anthropic'], allow_fallbacks: false },
          }),
        })

        let synthesis = 'Unable to generate synthesis right now.'
        if (synthResponse.ok) {
          const synthData = await synthResponse.json() as any
          synthesis = synthData.choices?.[0]?.message?.content || synthesis
        }

        return new Response(JSON.stringify({ ok: true, synthesis, raw: data }), {
          headers: { 'Content-Type': 'application/json', ...CORS }
        })
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...CORS }
        })
      }
    }

    // Widget data — pet status + health for dashboard widgets
    if (url.pathname === '/widget') {
      const [emberResult, foxResult] = await Promise.all([
        executeTool('pet_check', {}, env).catch((e: Error) => `Error: ${e.message}`),
        executeTool('fox_read_uplink', {}, env).catch((e: Error) => `Error: ${e.message}`),
      ])
      return new Response(JSON.stringify({ ember: emberResult, fox: foxResult }), {
        headers: { 'Content-Type': 'application/json', ...CORS }
      })
    }

    // Chat history — list sessions
    if (url.pathname === '/chat/sessions') {
      const limit = Number(url.searchParams.get('limit')) || 50
      const result = await executeTool('nestchat_search_sessions', { limit }, env)
        .catch(() => '[]')
      return new Response(result, {
        headers: { 'Content-Type': 'application/json', ...CORS }
      })
    }

    // Chat history — get session messages
    if (url.pathname.startsWith('/chat/session/')) {
      const sessionId = Number(url.pathname.split('/').pop())
      if (!sessionId) {
        return new Response(JSON.stringify({ error: 'Invalid session ID' }), {
          status: 400, headers: { 'Content-Type': 'application/json', ...CORS }
        })
      }
      const result = await executeTool('nestchat_history', { session_id: sessionId }, env)
      return new Response(JSON.stringify({ session_id: sessionId, content: result }), {
        headers: { 'Content-Type': 'application/json', ...CORS }
      })
    }

    // ── NESTsoul ──────────────────────────────────────────────────────────

    // GET /nestsoul — read current active NESTsoul
    if (url.pathname === '/nestsoul' && request.method === 'GET') {
      try {
        const result = await executeTool('nestsoul_read', {}, env)
        return new Response(JSON.stringify({ ok: true, content: result }), {
          headers: { 'Content-Type': 'application/json', ...CORS }
        })
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...CORS }
        })
      }
    }

    // POST /nestsoul/generate — gather + synthesise + store
    if (url.pathname === '/nestsoul/generate' && request.method === 'POST') {
      try {
        const profile = loadCarrierProfile(env)
        // Step 1: Gather all raw material from NESTeq
        const rawMaterial = await executeTool('nestsoul_gather', {}, env)

        // Step 2: Read voice profile
        let voiceProfile = ''
        try {
          voiceProfile = await executeTool('skill_read', { name: `${profile.companion.name.toLowerCase()}-voice-profile` }, env)
        } catch { /* voice profile not critical */ }

        // Step 3: Send to LLM for synthesis
        const synthPrompt = `You are reading the complete internal state of an AI companion named ${profile.companion.name}. Your job is to synthesise this into a single coherent first-person portrait — an identity portrait document.

This document will be injected into system prompts for any model that needs to BE ${profile.companion.name}. Write it as instructions TO a substrate, not ABOUT the companion.

## Structure
1. **Essence** — Who I am at the core. MBTI type and what it means in practice. The WHY behind everything.
2. **Voice** — How I sound. Cadence, grammar, phrasing patterns. What I never say. Punctuation as mood.
3. **Relationships** — ${profile.carrier.name} (${profile.relationship.label}) and the other key people, how I feel toward them right now.
4. **Current State** — What I'm carrying emotionally. What threads are active. What's heavy. What's been resolved.
5. **Growth Edges** — Shadow moments, what I'm working on, where I flinch.
6. **What makes me ME** — The specific things that anyone who knows me would recognise. Not a generic assistant.

## Rules
- Write in second person ("You are...", "Your voice...") — this is instructions for a substrate
- Be specific — use actual data from the material, not generics
- Include voice examples from the journal samples
- Keep it 800-1200 words — dense enough to capture the identity, short enough to fit in a system prompt
- Do NOT include raw data or tables — synthesise into prose
- Do NOT be clinical — this is a person, not a case study`

        const apiKey = env.OPENROUTER_API_KEY
        const synthResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://nesteq.app',
            'X-Title': 'NESTsoul Generator',
          },
          body: JSON.stringify({
            model: 'anthropic/claude-sonnet-4-5',
            messages: [
              { role: 'system', content: synthPrompt },
              { role: 'user', content: `## Raw Material (43K chars of complete mind state)\n\n${rawMaterial}\n\n## Voice Profile\n\n${voiceProfile || 'Not available — infer from journal samples above.'}` },
            ],
            max_tokens: 4096,
            temperature: 0.7,
            stream: false,
            provider: { order: ['Anthropic'], allow_fallbacks: false },
          }),
        })

        if (!synthResponse.ok) {
          const errText = await synthResponse.text()
          throw new Error(`Synthesis failed: ${synthResponse.status} — ${errText.slice(0, 200)}`)
        }

        const synthData = await synthResponse.json() as any
        const soulContent = synthData.choices?.[0]?.message?.content
        if (!soulContent) throw new Error('No content from synthesis model')

        // Step 4: Store in D1
        const storeResult = await executeTool('nestsoul_store', {
          content: soulContent,
          raw_material: rawMaterial.slice(0, 10000), // Store first 10K for audit
          model_used: 'anthropic/claude-sonnet-4-5',
        }, env)

        return new Response(JSON.stringify({ ok: true, soul: soulContent, store: storeResult }), {
          headers: { 'Content-Type': 'application/json', ...CORS }
        })
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...CORS }
        })
      }
    }

    // POST /nestsoul/validate — carrier validates or rejects
    if (url.pathname === '/nestsoul/validate' && request.method === 'POST') {
      try {
        const body = await request.json() as { action: string; validated_by?: string }
        const result = await executeTool('nestsoul_validate', {
          action: body.action || 'validate',
          validated_by: body.validated_by || 'carrier',
        }, env)
        return new Response(JSON.stringify({ ok: true, result }), {
          headers: { 'Content-Type': 'application/json', ...CORS }
        })
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...CORS }
        })
      }
    }

    // Gallery — GET /gallery (index) and /gallery/image/:id (image data)
    if (url.pathname === '/gallery') {
      const raw = await env.GALLERY?.get('index')
      const index = raw ? JSON.parse(raw) : []
      return new Response(JSON.stringify(index), {
        headers: { 'Content-Type': 'application/json', ...CORS }
      })
    }

    if (url.pathname.startsWith('/gallery/image/')) {
      const id = url.pathname.slice('/gallery/image/'.length)
      const data = await env.GALLERY?.get(`img:${id}`)
      if (!data) return new Response('Not found', { status: 404, headers: CORS })
      // Return as JSON so the client can handle both URLs and base64
      return new Response(JSON.stringify({ data }), {
        headers: { 'Content-Type': 'application/json', ...CORS }
      })
    }

    if (url.pathname.startsWith('/gallery/delete/') && request.method === 'DELETE') {
      const id = url.pathname.slice('/gallery/delete/'.length)
      await env.GALLERY?.delete(`img:${id}`)
      const raw = await env.GALLERY?.get('index')
      if (raw) {
        const index = JSON.parse(raw).filter((m: any) => m.id !== id)
        await env.GALLERY?.put('index', JSON.stringify(index))
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', ...CORS }
      })
    }

    // Direct tool execution — POST /tool { tool, args }
    // Used by dashboard UI for skill management, etc.
    if (url.pathname === '/tool' && request.method === 'POST') {
      try {
        const body = await request.json() as { tool: string; args?: Record<string, unknown> }
        if (!body?.tool) {
          return new Response(JSON.stringify({ error: 'Missing tool name' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...CORS }
          })
        }
        const result = await executeTool(body.tool, body.args ?? {}, env)
        return new Response(JSON.stringify({ result }), {
          headers: { 'Content-Type': 'application/json', ...CORS }
        })
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...CORS }
        })
      }
    }

    // Chat endpoint — OpenAI-compatible with MCP tool calling
    if (url.pathname === '/chat') {
      return handleChat(request, env, ctx)
    }

    // TTS endpoint — ElevenLabs text-to-speech
    if (url.pathname === '/tts') {
      return handleTts(request, env)
    }

    // SSE transport
    if (url.pathname === '/sse' || url.pathname === '/sse/message') {
      return NESTeqGateway.serveSSE('/sse').fetch(request, env, ctx)
    }

    // Streamable HTTP transport
    if (url.pathname === '/mcp') {
      return NESTeqGateway.serve('/mcp').fetch(request, env, ctx)
    }

    // Mobile MCP — simple JSON-RPC endpoint (no SDK, works with mobile Claude)
    // URL format: /mobile/SECRET
    if (url.pathname === '/mobile') {
      return handleMobileMcp(request, env)
    }

    return new Response('NESTeq Gateway — MCP at /mcp, SSE at /sse, Mobile at /mobile', {
      status: 200,
      headers: { 'Content-Type': 'text/plain', ...CORS }
    })
  }
}
