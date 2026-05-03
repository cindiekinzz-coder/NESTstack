// rooms-worker HTTP client. Shared by every ingester.

const PROVIDER_TO_ROOM = {
  claude:   'import-claude-web',
  chatgpt:  'import-gpt',
  gpt:      'import-gpt',
  gemini:   'import-gemini',
  grok:     'import-grok',
};

const PROVIDER_TO_AUTHOR = {
  claude:   'claude-web',
  chatgpt:  'gpt',
  gpt:      'gpt',
  gemini:   'gemini',
  grok:     'grok',
};

export function roomFor(provider) {
  return PROVIDER_TO_ROOM[provider] || null;
}

export function authorFor(provider) {
  return PROVIDER_TO_AUTHOR[provider] || provider;
}

export async function importSession(args, parsed) {
  const room_id = parsed.room_id_override || roomFor(parsed.provider);
  if (!room_id) throw new Error(`no room mapping for provider: ${parsed.provider}`);
  const res = await fetch(`${args.apiUrl}/sessions/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${args.apiKey}` },
    body: JSON.stringify({
      room_id,
      external_session_id: parsed.conversation_id,
      started_at: parsed.create_time,
      last_message_at: parsed.update_time,
      title: parsed.title,
    }),
  });
  if (!res.ok) throw new Error(`/sessions/import ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return { session_id: body.session_id, room_id };
}

export async function postMessage(args, payload) {
  const res = await fetch(`${args.apiUrl}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${args.apiKey}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`/messages ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function ingestParsed(args, parsed) {
  if (!parsed.conversation_id) throw new Error('missing conversation_id');
  if (parsed.turns.length === 0) return { skipped: true, reason: 'no turns' };

  const { session_id, room_id } = await importSession(args, parsed);
  const author_assistant = parsed.author_assistant_override || authorFor(parsed.provider);

  let inserted = 0;
  let deduped = 0;
  for (const turn of parsed.turns) {
    if (!turn.uid) continue;
    const author = turn.role === 'fox' ? 'fox' : author_assistant;
    const result = await postMessage(args, {
      room_id,
      session_id,
      author,
      content: turn.content,
      tool_calls: turn.tool_calls || null,
      created_at: turn.ts_iso,
      external_uid: turn.uid,
      external_provider: parsed.provider,
    });
    if (result.dedup) deduped++;
    else inserted++;
  }
  return { session_id, inserted, deduped };
}
