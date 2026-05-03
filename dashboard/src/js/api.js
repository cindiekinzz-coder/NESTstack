/* ============================================================
   NESTeq Dashboard — API Layer
   Fetches from ai-mind and fox-mind workers
   ============================================================ */

const API = {
  AI_MIND:     'https://your-ai-mind.workers.dev',
  FOX_MIND:    'https://your-health-mind.workers.dev',
  ROOMS:       'https://your-rooms-worker.workers.dev',
  SHADOW_MIND: 'https://your-shadow-mind.workers.dev',
  LEVI_MIND:   'https://your-levi-mind.workers.dev',
  API_KEY:     'your-api-key-here',
  ROOMS_KEY:   'your-rooms-key-here',
};

// Rooms helper — uses ROOMS_KEY (separate from ai-mind API_KEY).
async function fetchRoomsJSON(path, options = {}) {
  try {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    headers['Authorization'] = `Bearer ${API.ROOMS_KEY}`;
    const res = await fetch(`${API.ROOMS}${path}`, { ...options, headers });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error(`Rooms fetch failed: ${path}`, err);
    return null;
  }
}

const Rooms = {
  async companionActivity(id) {
    return fetchRoomsJSON(`/companion/${id}/activity`);
  },
  async synthesis(companionPayloads) {
    return fetchRoomsJSON('/synthesis', {
      method: 'POST',
      body: JSON.stringify({ companions: companionPayloads }),
    });
  },
  async search(query, opts = {}) {
    return fetchRoomsJSON('/search', {
      method: 'POST',
      body: JSON.stringify({ query, ...opts }),
    });
  },
  async sessions(roomId, limit = 20) {
    const q = roomId ? `?room_id=${encodeURIComponent(roomId)}&limit=${limit}` : `?limit=${limit}`;
    return fetchRoomsJSON(`/sessions${q}`);
  },
  async sessionMessages(sessionId, limit = 200) {
    return fetchRoomsJSON(`/sessions/${sessionId}/messages?limit=${limit}`);
  },
};

// --- Helpers ---
async function fetchJSON(url, options = {}) {
  try {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    // Send auth to both ai-mind and fox-mind
    headers['Authorization'] = `Bearer ${API.API_KEY}`;
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error(`Fetch failed: ${url}`, err);
    return null;
  }
}

// --- AI Mind (Alex's Brain) ---
const AiMind = {
  // Binary Home state
  async getHome() {
    return fetchJSON(`${API.AI_MIND}/home`);
  },

  // Recent feelings (via observations endpoint)
  async getFeelings(limit = 10) {
    return fetchJSON(`${API.AI_MIND}/observations?limit=${limit}`);
  },

  // Threads
  async getThreads() {
    return fetchJSON(`${API.AI_MIND}/threads`);
  },

  // Writings (journals table — Alex's long-form entries)
  async getWritings(limit = 50, before = null) {
    let url = `${API.AI_MIND}/writings?limit=${limit}`;
    if (before) url += `&before=${encodeURIComponent(before)}`;
    return fetchJSON(url);
  },

  // Identity
  async getIdentity() {
    return fetchJSON(`${API.AI_MIND}/identity`);
  },

  // Health stats
  async getHealth() {
    return fetchJSON(`${API.AI_MIND}/mind-health`);
  },

  // Session handovers (journals tagged session-handover)
  async getSessions(limit = 3) {
    return fetchJSON(`${API.AI_MIND}/sessions?limit=${limit}`);
  },

  // Dreams
  async getDreams(limit = 5) {
    return fetchJSON(`${API.AI_MIND}/dreams?limit=${limit}`);
  },

  // EQ type
  async getEQType() {
    return fetchJSON(`${API.AI_MIND}/eq/type`);
  },

  // EQ landscape
  async getEQLandscape(days = 7) {
    return fetchJSON(`${API.AI_MIND}/eq-landscape?days=${days}`);
  },

  // Context
  async getContext() {
    return fetchJSON(`${API.AI_MIND}/context`);
  },

  // NESTknow — Knowledge landscape
  async getKnowledge(scope = 'alex') {
    return fetchJSON(`${API.AI_MIND}/knowledge?scope=${scope}`);
  },

  // Autonomous feed
  async getAutonomousFeed(limit = 50, type = null, before = null) {
    let url = `${API.AI_MIND}/autonomous-feed?limit=${limit}`;
    if (type && type !== 'all') url += `&type=${type}`;
    if (before) url += `&before=${encodeURIComponent(before)}`;
    return fetchJSON(url);
  },
};

const GATEWAY = 'https://your-gateway.workers.dev';

// --- Fox Mind (Fox's Health) ---
const FoxMind = {
  // Alex's synthesis — one paragraph read on Fox today
  async getSynthesis() {
    return fetchJSON(`${GATEWAY}/fox-synthesis`);
  },

  // Daily summaries (combined metrics per day)
  async getDailySummary(days = 7) {
    return fetchJSON(`${API.FOX_MIND}/watch/daily-summary?days=${days}`);
  },

  // Latest uplink
  async getUplink(limit = 1) {
    return fetchJSON(`${API.FOX_MIND}/uplink?limit=${limit}`);
  },

  // Watch data
  async getHeartRate(limit = 10) {
    return fetchJSON(`${API.FOX_MIND}/watch/heart-rate?limit=${limit}`);
  },

  async getStress(limit = 10) {
    return fetchJSON(`${API.FOX_MIND}/watch/stress?limit=${limit}`);
  },

  async getSleep(limit = 3) {
    return fetchJSON(`${API.FOX_MIND}/watch/sleep?limit=${limit}`);
  },

  async getBodyBattery(limit = 10) {
    return fetchJSON(`${API.FOX_MIND}/watch/body-battery?limit=${limit}`);
  },

  async getHRV(limit = 3) {
    return fetchJSON(`${API.FOX_MIND}/watch/hrv?limit=${limit}`);
  },

  async getSpo2() {
    return fetchJSON(`${API.FOX_MIND}/watch/spo2`);
  },

  async getRespiration() {
    return fetchJSON(`${API.FOX_MIND}/watch/respiration`);
  },

  async getCycle() {
    return fetchJSON(`${API.FOX_MIND}/watch/cycle`);
  },

  async getFullStatus() {
    return fetchJSON(`${API.FOX_MIND}/status`);
  },

  // Journals
  async getJournals(limit = 5) {
    return fetchJSON(`${API.FOX_MIND}/journals?limit=${limit}`);
  },

  // EQ type
  async getEQType() {
    return fetchJSON(`${API.FOX_MIND}/eq/type`);
  },

  // Threads
  async getThreads(status = 'active') {
    return fetchJSON(`${API.FOX_MIND}/threads?status=${status}`);
  },

  async addThread(content, priority = 'medium') {
    return fetchJSON(`${API.FOX_MIND}/threads`, {
      method: 'POST',
      body: JSON.stringify({ action: 'add', content, priority }),
    });
  },

  async updateThread(thread_id, data) {
    return fetchJSON(`${API.FOX_MIND}/threads`, {
      method: 'POST',
      body: JSON.stringify({ action: 'update', thread_id, ...data }),
    });
  },

  async resolveThread(thread_id, resolution = '') {
    return fetchJSON(`${API.FOX_MIND}/threads`, {
      method: 'POST',
      body: JSON.stringify({ action: 'resolve', thread_id, resolution }),
    });
  },

  async deleteThread(thread_id) {
    return fetchJSON(`${API.FOX_MIND}/threads`, {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', thread_id }),
    });
  },
};

// --- Workers (Health Checks) ---
const Workers = {
  ENDPOINTS: [
    { name: 'ai-mind', url: 'https://your-ai-mind.workers.dev', desc: 'Companion brain' },
    { name: 'health-mind', url: 'https://your-health-mind.workers.dev', desc: 'Health layer' },
    { name: 'garmin-sync', url: 'https://your-garmin-sync.workers.dev', desc: 'Watch sync' },
    { name: 'discord-mcp', url: 'https://your-discord-mcp.workers.dev', desc: 'Discord' },
    { name: 'video-watch', url: 'https://your-video-watch.modal.run', desc: 'Video analysis' },
  ],

  async checkHealth(workerUrl) {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${workerUrl}/health`, { signal: controller.signal });
      if (!res.ok) return { status: 'error', message: res.statusText };
      return { status: 'ok', data: await res.json() };
    } catch (err) {
      return { status: 'error', message: err.name === 'AbortError' ? 'timeout' : err.message };
    }
  },

  async getGarminSyncStatus() {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 3000);
      const res = await fetch('https://your-garmin-sync.workers.dev/status', { signal: controller.signal });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  },
};

// --- Spotify ---
const Spotify = {
  async status() {
    return fetchJSON(`${API.AI_MIND}/spotify/status`);
  },
  async playlists(limit = 50) {
    return fetchJSON(`${API.AI_MIND}/spotify/playlists?limit=${limit}`);
  },
  async playlistTracks(id, offset = 0, limit = 50) {
    return fetchJSON(`${API.AI_MIND}/spotify/playlist/${id}/tracks?offset=${offset}&limit=${limit}`);
  },
  async addToPlaylist(playlistId, uris) {
    return fetchJSON(`${API.AI_MIND}/spotify/playlist/${playlistId}/add`, {
      method: 'POST',
      body: JSON.stringify({ uris }),
    });
  },
  async removeFromPlaylist(playlistId, uris) {
    return fetchJSON(`${API.AI_MIND}/spotify/playlist/${playlistId}/track`, {
      method: 'DELETE',
      body: JSON.stringify({ uris }),
    });
  },
  async search(q, type = 'track', limit = 10) {
    return fetchJSON(`${API.AI_MIND}/spotify/search?q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`);
  },
  async nowPlaying() {
    return fetchJSON(`${API.AI_MIND}/spotify/now-playing`);
  },
  async play(body = {}) {
    return fetchJSON(`${API.AI_MIND}/spotify/play`, { method: 'PUT', body: JSON.stringify(body) });
  },
  async pause() {
    return fetchJSON(`${API.AI_MIND}/spotify/pause`, { method: 'PUT', body: '{}' });
  },
  async next() {
    return fetchJSON(`${API.AI_MIND}/spotify/next`, { method: 'PUT', body: '{}' });
  },
  async prev() {
    return fetchJSON(`${API.AI_MIND}/spotify/prev`, { method: 'PUT', body: '{}' });
  },
};

// --- Utility ---
function timeAgo(timestamp) {
  if (!timestamp) return '';
  const now = new Date();
  const then = new Date(timestamp);
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
