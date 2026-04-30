/**
 * Spotify integration — OAuth2 connect flow + REST proxy.
 *
 * Two route tables here, called from different points in the worker's
 * fetch handler:
 *
 * 1. **handleSpotifyOAuthRoutes** — `/spotify/auth` (kicks off the
 *    OAuth code flow) and `/spotify/callback` (Spotify posts back here
 *    with `?code=...`, we exchange it for an access+refresh token and
 *    persist into `spotify_tokens`). These routes run BEFORE the auth
 *    gate because Spotify's redirect doesn't carry a Bearer token.
 *
 * 2. **handleSpotifyApiRoutes** — playlists / search / now-playing /
 *    transport (play/pause/next/prev). Auth-gated like the rest of
 *    the dashboard. Internally maintains a refresh-on-expiry helper
 *    keyed off `spotify_tokens.refresh_token`.
 *
 * Both return `Response` if the path matched, or `null` to fall
 * through to the next route table.
 */

import { Env } from './env';

export async function handleSpotifyOAuthRoutes(
  request: Request,
  url: URL,
  env: Env,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  if (url.pathname === "/spotify/auth") {
    const scopes = [
      'playlist-read-private', 'playlist-read-collaborative',
      'playlist-modify-public', 'playlist-modify-private',
      'user-read-playback-state', 'user-modify-playback-state',
      'user-read-currently-playing', 'user-library-read',
      'user-library-modify',
    ].join(' ');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.SPOTIFY_CLIENT_ID,
      scope: scopes,
      redirect_uri: `${url.origin}/spotify/callback`,
      state: crypto.randomUUID(),
    });
    return Response.redirect(`https://accounts.spotify.com/authorize?${params}`, 302);
  }

  if (url.pathname === "/spotify/callback") {
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (error || !code) {
      return new Response(`<h2>Spotify auth failed</h2><p>${error || 'No code'}</p>`, {
        headers: { 'Content-Type': 'text/html' }
      });
    }
    try {
      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`),
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: `${url.origin}/spotify/callback`,
        }),
      });
      const tokens = await tokenRes.json() as any;
      if (tokens.error) {
        return new Response(`<h2>Token exchange failed</h2><pre>${JSON.stringify(tokens)}</pre>`, {
          headers: { 'Content-Type': 'text/html' }
        });
      }
      const expiresAt = Date.now() + (tokens.expires_in * 1000);
      await env.DB.prepare(`
        INSERT INTO spotify_tokens (id, access_token, refresh_token, expires_at, scope, updated_at)
        VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          access_token = excluded.access_token,
          refresh_token = excluded.refresh_token,
          expires_at = excluded.expires_at,
          scope = excluded.scope,
          updated_at = CURRENT_TIMESTAMP
      `).bind(tokens.access_token, tokens.refresh_token, expiresAt, tokens.scope || '').run();

      return new Response(`
        <html><body style="background:#1a1a2e;color:white;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="text-align:center;">
            <h1 style="color:#1DB954;">&#10003; Spotify Connected</h1>
            <p>You can close this tab and go back to the dashboard.</p>
          </div>
        </body></html>
      `, { headers: { 'Content-Type': 'text/html' } });
    } catch (err) {
      return new Response(`<h2>Error</h2><pre>${String(err)}</pre>`, {
        headers: { 'Content-Type': 'text/html' }
      });
    }
  }

  return null;
}

export async function handleSpotifyApiRoutes(
  request: Request,
  url: URL,
  env: Env,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  if (!url.pathname.startsWith("/spotify/")) return null;

  // Helper: get valid Spotify access token (auto-refresh if expired)
  async function getSpotifyToken(): Promise<string | null> {
    const row = await env.DB.prepare('SELECT * FROM spotify_tokens WHERE id = 1').first() as any;
    if (!row || !row.refresh_token) return null;

    if (Date.now() < (row.expires_at - 60000)) {
      return row.access_token;
    }

    // Refresh the token
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: row.refresh_token,
      }),
    });
    const data = await res.json() as any;
    if (data.error) return null;

    const expiresAt = Date.now() + (data.expires_in * 1000);
    await env.DB.prepare(`
      UPDATE spotify_tokens SET access_token = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1
    `).bind(data.access_token, expiresAt).run();

    // Spotify may return a new refresh token
    if (data.refresh_token) {
      await env.DB.prepare('UPDATE spotify_tokens SET refresh_token = ? WHERE id = 1')
        .bind(data.refresh_token).run();
    }

    return data.access_token;
  }

  async function spotifyFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const token = await getSpotifyToken();
    if (!token) {
      return new Response(JSON.stringify({ error: 'Not connected to Spotify. Visit /spotify/auth to connect.' }), {
        status: 401, headers: corsHeaders
      });
    }
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      ...(options.headers as Record<string, string> || {}),
    };
    if (options.body) headers['Content-Type'] = 'application/json';
    return fetch(`https://api.spotify.com/v1${endpoint}`, { ...options, headers });
  }

  // GET /spotify/status — Check connection
  if (url.pathname === "/spotify/status") {
    const token = await getSpotifyToken();
    if (!token) {
      return new Response(JSON.stringify({ connected: false }), { headers: corsHeaders });
    }
    const res = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const me = await res.json() as any;
      return new Response(JSON.stringify({
        connected: true,
        user: me.display_name,
        product: me.product,
      }), { headers: corsHeaders });
    }
    return new Response(JSON.stringify({ connected: false }), { headers: corsHeaders });
  }

  // GET /spotify/playlists
  if (url.pathname === "/spotify/playlists") {
    const limit = url.searchParams.get('limit') || '50';
    const res = await spotifyFetch(`/me/playlists?limit=${limit}`);
    const data = await res.json();
    return new Response(JSON.stringify(data), { headers: corsHeaders });
  }

  // GET /spotify/playlist/:id/tracks
  const playlistTracksMatch = url.pathname.match(/^\/spotify\/playlist\/([^/]+)\/tracks$/);
  if (playlistTracksMatch) {
    const id = playlistTracksMatch[1];
    const offset = url.searchParams.get('offset') || '0';
    const limit = url.searchParams.get('limit') || '50';
    const res = await spotifyFetch(`/playlists/${id}/tracks?offset=${offset}&limit=${limit}`);
    const data = await res.json();
    return new Response(JSON.stringify(data), { headers: corsHeaders });
  }

  // POST /spotify/playlist/:id/add — { uris: ["spotify:track:xxx"] }
  const playlistAddMatch = url.pathname.match(/^\/spotify\/playlist\/([^/]+)\/add$/);
  if (playlistAddMatch && request.method === "POST") {
    const id = playlistAddMatch[1];
    const body = await request.json() as any;
    const res = await spotifyFetch(`/playlists/${id}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ uris: body.uris }),
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), { headers: corsHeaders });
  }

  // DELETE /spotify/playlist/:id/track — { uris: [{ uri: "spotify:track:xxx" }] }
  const playlistRemoveMatch = url.pathname.match(/^\/spotify\/playlist\/([^/]+)\/track$/);
  if (playlistRemoveMatch && request.method === "DELETE") {
    const id = playlistRemoveMatch[1];
    const body = await request.json() as any;
    const res = await spotifyFetch(`/playlists/${id}/tracks`, {
      method: 'DELETE',
      body: JSON.stringify({ tracks: body.uris.map((u: string) => ({ uri: u })) }),
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), { headers: corsHeaders });
  }

  // GET /spotify/search?q=...&type=track
  if (url.pathname === "/spotify/search") {
    const q = url.searchParams.get('q') || '';
    const type = url.searchParams.get('type') || 'track';
    const limit = url.searchParams.get('limit') || '10';
    const res = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`);
    const data = await res.json();
    return new Response(JSON.stringify(data), { headers: corsHeaders });
  }

  // GET /spotify/now-playing
  if (url.pathname === "/spotify/now-playing") {
    const res = await spotifyFetch('/me/player/currently-playing');
    if (res.status === 204) {
      return new Response(JSON.stringify({ playing: false }), { headers: corsHeaders });
    }
    const data = await res.json();
    return new Response(JSON.stringify(data), { headers: corsHeaders });
  }

  // PUT /spotify/play — { context_uri?, uris?, offset? }
  if (url.pathname === "/spotify/play" && request.method === "PUT") {
    const body = await request.json() as any;
    const res = await spotifyFetch('/me/player/play', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return new Response(JSON.stringify({ success: res.ok }), { headers: corsHeaders });
  }

  // PUT /spotify/pause
  if (url.pathname === "/spotify/pause" && request.method === "PUT") {
    const res = await spotifyFetch('/me/player/pause', { method: 'PUT' });
    return new Response(JSON.stringify({ success: res.ok }), { headers: corsHeaders });
  }

  // PUT /spotify/next
  if (url.pathname === "/spotify/next" && request.method === "PUT") {
    const res = await spotifyFetch('/me/player/next', { method: 'POST' });
    return new Response(JSON.stringify({ success: res.ok }), { headers: corsHeaders });
  }

  // PUT /spotify/prev
  if (url.pathname === "/spotify/prev" && request.method === "PUT") {
    const res = await spotifyFetch('/me/player/previous', { method: 'POST' });
    return new Response(JSON.stringify({ success: res.ok }), { headers: corsHeaders });
  }

  return null;
}
