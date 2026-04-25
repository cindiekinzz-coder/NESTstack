/**
 * Pages Function — Proxy /api/chat/completions to OpenClaw Gateway tunnel
 */

const GATEWAY_TUNNEL = 'https://algorithms-charge-vision-convention.trycloudflare.com';

export async function onRequest(context) {
  const { request } = context;

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-openclaw-agent-id',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const targetUrl = `${GATEWAY_TUNNEL}/v1/chat/completions`;

  try {
    const proxyRes = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': request.headers.get('Authorization') || '',
        'x-openclaw-agent-id': request.headers.get('x-openclaw-agent-id') || '',
      },
      body: request.body,
    });

    return new Response(proxyRes.body, {
      status: proxyRes.status,
      headers: proxyRes.headers,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Gateway unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
