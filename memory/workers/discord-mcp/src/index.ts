// Discord MCP Worker - Discord access from anywhere via Cloudflare Workers
// Lightweight REST-based MCP for mobile Claude and browser clients

import { DiscordClient } from './discord';

interface Env {
  DISCORD_TOKEN: string;
  MCP_SECRET: string;
}

interface MCPRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: {
    name?: string;
    arguments?: Record<string, any>;
  };
}

interface MCPResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: any;
  error?: { code: number; message: string };
}

// Tool definitions for MCP
const TOOLS = [
  {
    name: 'discord_read_messages',
    description: 'Read messages from a Discord channel',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID to read from' },
        limit: { type: 'number', description: 'Number of messages (max 100)', default: 50 },
      },
      required: ['channelId'],
    },
  },
  {
    name: 'discord_send',
    description: 'Send a message to a Discord channel',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID to send to' },
        message: { type: 'string', description: 'The message content' },
        replyToMessageId: { type: 'string', description: 'Optional message ID to reply to' },
      },
      required: ['channelId', 'message'],
    },
  },
  {
    name: 'discord_search_messages',
    description: 'Search for messages in a Discord server',
    inputSchema: {
      type: 'object',
      properties: {
        guildId: { type: 'string', description: 'The server (guild) ID to search' },
        content: { type: 'string', description: 'Text to search for' },
        authorId: { type: 'string', description: 'Filter by author ID' },
        channelId: { type: 'string', description: 'Filter by channel ID' },
        has: { type: 'string', description: 'Filter by content type (link, embed, file, image, video)' },
        limit: { type: 'number', description: 'Max results (default 25)' },
      },
      required: ['guildId'],
    },
  },
  {
    name: 'discord_add_reaction',
    description: 'Add a reaction to a message',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID' },
        messageId: { type: 'string', description: 'The message ID to react to' },
        emoji: { type: 'string', description: 'The emoji to react with' },
      },
      required: ['channelId', 'messageId', 'emoji'],
    },
  },
  {
    name: 'discord_list_servers',
    description: 'List all Discord servers the bot is in',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'discord_get_server_info',
    description: 'Get detailed info about a Discord server',
    inputSchema: {
      type: 'object',
      properties: {
        guildId: { type: 'string', description: 'The server (guild) ID' },
      },
      required: ['guildId'],
    },
  },
  {
    name: 'discord_fetch_image',
    description: 'Fetch an image from Discord CDN and return it as base64. Uses iterative scaling to fit within token limits.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The Discord CDN image URL (from message attachments)' },
        maxSizeKB: { type: 'number', description: 'Max size in KB (default 50)', default: 50 },
      },
      required: ['url'],
    },
  },
];

// Fetch image with iterative scaling using Discord CDN's width parameter
async function fetchImageWithScaling(
  url: string,
  maxSizeKB: number = 50
): Promise<{ base64: string; width: number; mimeType: string }> {
  const maxSizeBytes = maxSizeKB * 1024;
  const isDiscordCDN = url.includes('cdn.discordapp.com') || url.includes('media.discordapp.net');
  const widths = [1024, 768, 576, 432, 324, 243, 200];

  for (const width of widths) {
    let fetchUrl = url;
    if (isDiscordCDN) {
      const urlObj = new URL(url);
      urlObj.searchParams.set('width', String(width));
      fetchUrl = urlObj.toString();
    }

    const response = await fetch(fetchUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength <= maxSizeBytes) {
      const uint8Array = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i]);
      }
      return { base64: btoa(binary), width, mimeType: contentType };
    }

    // If not Discord CDN, we can't resize further
    if (!isDiscordCDN) {
      throw new Error(`Image too large (${Math.round(arrayBuffer.byteLength / 1024)}KB) and URL doesn't support resizing`);
    }
  }

  throw new Error(`Could not scale image small enough for ${maxSizeKB}KB limit`);
}

async function handleToolCall(
  client: DiscordClient,
  name: string,
  args: Record<string, any>
): Promise<{ content: { type: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean }> {
  try {
    switch (name) {
      case 'discord_read_messages': {
        const messages = await client.readMessages(args.channelId, args.limit || 50);
        const formatted = messages.map((m) => ({
          id: m.id,
          content: m.content,
          author: {
            id: m.author.id,
            username: m.author.username,
            bot: m.author.bot,
          },
          timestamp: m.timestamp,
          attachments: m.attachments.map((a: any) => ({
            id: a.id,
            filename: a.filename,
            url: a.url,
            proxy_url: a.proxy_url,
            content_type: a.content_type,
            size: a.size,
            width: a.width,
            height: a.height,
          })),
          embeds: m.embeds.length,
          replyTo: m.message_reference?.message_id || null,
        }));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { channelId: args.channelId, messageCount: formatted.length, messages: formatted },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'discord_send': {
        await client.sendMessage(args.channelId, args.message, args.replyToMessageId);
        const response = args.replyToMessageId
          ? `Message sent to ${args.channelId} as reply to ${args.replyToMessageId}`
          : `Message sent to ${args.channelId}`;
        return { content: [{ type: 'text', text: response }] };
      }

      case 'discord_search_messages': {
        const results = await client.searchMessages(args.guildId, {
          content: args.content,
          author_id: args.authorId,
          channel_id: args.channelId,
          has: args.has,
          limit: args.limit,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { totalResults: results.total_results, messages: results.messages },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'discord_add_reaction': {
        await client.addReaction(args.channelId, args.messageId, args.emoji);
        return {
          content: [{ type: 'text', text: `Added reaction ${args.emoji} to message ${args.messageId}` }],
        };
      }

      case 'discord_list_servers': {
        const guilds = await client.listGuilds();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                guilds.map((g) => ({ id: g.id, name: g.name })),
                null,
                2
              ),
            },
          ],
        };
      }

      case 'discord_get_server_info': {
        const [guild, channels] = await Promise.all([
          client.getGuild(args.guildId),
          client.getGuildChannels(args.guildId),
        ]);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  id: guild.id,
                  name: guild.name,
                  memberCount: guild.member_count,
                  channels: channels.map((c) => ({
                    id: c.id,
                    name: c.name,
                    type: c.type,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'discord_fetch_image': {
        const maxSizeKB = args.maxSizeKB || 50;
        const result = await fetchImageWithScaling(args.url, maxSizeKB);
        return {
          content: [
            {
              type: 'image',
              data: result.base64,
              mimeType: result.mimeType,
            },
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                finalWidth: result.width,
                mimeType: result.mimeType,
                sizeKB: Math.round((result.base64.length * 0.75) / 1024),
              }),
            },
          ],
        };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight FIRST (before any auth)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    const url = new URL(request.url);

    // Health check (public)
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'discord-mcp' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const pathParts = url.pathname.split('/').filter(Boolean);

    // Expect URL format: /mcp/SECRET_KEY
    if (pathParts.length < 2 || pathParts[0] !== 'mcp') {
      return new Response(JSON.stringify({ error: 'Invalid path. Use /mcp/YOUR_SECRET' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const providedSecret = pathParts[1];
    if (providedSecret !== env.MCP_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Handle GET requests (some MCP clients probe with GET first)
    if (request.method === 'GET') {
      return new Response(JSON.stringify({
        name: 'discord-mcp',
        version: '1.0.0',
        status: 'ok'
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Only accept POST for actual MCP calls
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const client = new DiscordClient(env.DISCORD_TOKEN);

    try {
      const body: MCPRequest = await request.json();
      const requestId = body.id ?? 1;
      let response: MCPResponse;

      switch (body.method) {
        case 'initialize':
          response = {
            jsonrpc: '2.0',
            id: requestId,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'discord-mcp', version: '1.0.0' },
            },
          };
          break;

        case 'tools/list':
          response = { jsonrpc: '2.0', id: requestId, result: { tools: TOOLS } };
          break;

        case 'tools/call':
          if (!body.params?.name) {
            response = { jsonrpc: '2.0', id: requestId, error: { code: -32602, message: 'Missing tool name' } };
          } else {
            const result = await handleToolCall(client, body.params.name, body.params.arguments || {});
            response = { jsonrpc: '2.0', id: requestId, result };
          }
          break;

        default:
          response = { jsonrpc: '2.0', id: requestId, error: { code: -32601, message: `Unknown method: ${body.method}` } };
      }

      return new Response(JSON.stringify(response), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  },
};
