/**
 * Mobile MCP — Simple JSON-RPC endpoint for mobile Claude
 * No SDK, no Durable Objects, no SSE — just POST/response.
 * Mirrors the Discord MCP pattern that mobile Claude can actually connect to.
 *
DESANITIZE
DESANITIZE
 */

import type { Env } from './env'
import { executeTool } from './tools/execute'
import { CHAT_TOOLS } from './tools/definitions'

interface MCPRequest {
  jsonrpc: string
  id: number | string
  method: string
  params?: {
    name?: string
    arguments?: Record<string, any>
    protocolVersion?: string
    capabilities?: any
    clientInfo?: any
  }
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
}

// Convert gateway tool format to MCP tool format
function toMcpTools() {
  return CHAT_TOOLS.map(t => ({
    name: t.function.name,
    description: t.function.description,
    inputSchema: {
      type: 'object',
      properties: t.function.parameters.properties,
      required: t.function.parameters.required || [],
    },
  }))
}

export async function handleMobileMcp(request: Request, env: Env): Promise<Response> {
  // GET = health check (some MCP clients probe with GET first)
  if (request.method === 'GET') {
    return new Response(JSON.stringify({
      name: 'nesteq-gateway-mobile',
      version: '1.0.0',
      status: 'ok',
      tools: CHAT_TOOLS.length,
    }), { headers: CORS_HEADERS })
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: CORS_HEADERS,
    })
  }

  try {
    const body: MCPRequest = await request.json()
    const requestId = body.id ?? 1

    switch (body.method) {
      case 'initialize':
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'nesteq-gateway', version: '1.0.0' },
          },
        }), { headers: CORS_HEADERS })

      case 'notifications/initialized':
        // Client confirming initialization — acknowledge silently
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          result: {},
        }), { headers: CORS_HEADERS })

      case 'tools/list':
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          result: { tools: toMcpTools() },
        }), { headers: CORS_HEADERS })

      case 'tools/call': {
        if (!body.params?.name) {
          return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: requestId,
            error: { code: -32602, message: 'Missing tool name' },
          }), { headers: CORS_HEADERS })
        }

        try {
          const result = await executeTool(body.params.name, body.params.arguments || {}, env)
          return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: requestId,
            result: {
              content: [{ type: 'text', text: result }],
            },
          }), { headers: CORS_HEADERS })
        } catch (e) {
          return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: requestId,
            result: {
              content: [{ type: 'text', text: `Error: ${(e as Error).message}` }],
              isError: true,
            },
          }), { headers: CORS_HEADERS })
        }
      }

      default:
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          error: { code: -32601, message: `Unknown method: ${body.method}` },
        }), { headers: CORS_HEADERS })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message },
    }), { status: 500, headers: CORS_HEADERS })
  }
}
