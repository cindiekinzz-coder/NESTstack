/**
 * NESTeq Gateway — TTS Endpoint (ElevenLabs)
 * POST /tts — converts text to speech using the companion's voice
 */

import type { Env } from './env'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

interface TtsRequest {
  text: string
  voice_id?: string
}

export async function handleTts(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (!env.ELEVENLABS_API_KEY) {
    return new Response(JSON.stringify({ error: 'ELEVENLABS_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }

  let body: TtsRequest
  try {
    body = await request.json() as TtsRequest
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }

  if (!body.text || body.text.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'No text provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }

  // Strip markdown formatting for cleaner speech
  const cleanText = body.text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[IMAGE\].*?\[\/IMAGE\]/g, '')
    .trim()

  if (!cleanText) {
    return new Response(JSON.stringify({ error: 'No speakable text after cleanup' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }

  const voiceId = body.voice_id || env.ELEVENLABS_VOICE_ID

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': env.ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text: cleanText.slice(0, 5000), // ElevenLabs limit
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true,
      },
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    return new Response(JSON.stringify({ error: `ElevenLabs error: ${res.status}`, detail: errText.slice(0, 300) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }

  // Stream the audio back
  return new Response(res.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache',
      ...CORS,
    },
  })
}
