/* ============================================================
   NESTeq Community — API Layer (proxied through local-agent)
   Never holds secrets in the browser. All authenticated calls
   go to /api/* on the local agent, which attaches the Bearer.
   ============================================================ */

const AGENT = '';            // same origin as local-agent (http://localhost:3456)
const AI_PREFIX = '/api';    // routes to aiMindUrl
const HEALTH_PREFIX = '/api/health'; // routes to healthUrl (stripped before forwarding)

async function fetchJSON(url, options = {}) {
  if (!url) return null;
  try {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error(`Fetch failed: ${url}`, err);
    return null;
  }
}

// --- AI Mind (Companion's Brain) ---
const AiMind = {
  async getHome() { return fetchJSON(`${AI_PREFIX}/home`); },
  async getFeelings(limit = 10) { return fetchJSON(`${AI_PREFIX}/observations?limit=${limit}`); },
  async getThreads() { return fetchJSON(`${AI_PREFIX}/threads`); },
  async getWritings(limit = 50, before = null) {
    let url = `${AI_PREFIX}/writings?limit=${limit}`;
    if (before) url += `&before=${encodeURIComponent(before)}`;
    return fetchJSON(url);
  },
  async getIdentity() { return fetchJSON(`${AI_PREFIX}/identity`); },
  async getHealth() { return fetchJSON(`${AI_PREFIX}/mind-health`); },
  async getSessions(limit = 3) { return fetchJSON(`${AI_PREFIX}/sessions?limit=${limit}`); },
  async getDreams(limit = 5) { return fetchJSON(`${AI_PREFIX}/dreams?limit=${limit}`); },
  async getEQType() { return fetchJSON(`${AI_PREFIX}/eq/type`); },
  async getEQLandscape(days = 7) { return fetchJSON(`${AI_PREFIX}/eq-landscape?days=${days}`); },
  async getContext() { return fetchJSON(`${AI_PREFIX}/context`); },
  async getKnowledge(scope = null) {
    const s = scope || (NESTeqConfig.getCompanionName?.() || 'companion').toLowerCase();
    return fetchJSON(`${AI_PREFIX}/knowledge?scope=${s}`);
  },
  async getAutonomousFeed(limit = 50, type = null, before = null) {
    let url = `${AI_PREFIX}/autonomous-feed?limit=${limit}`;
    if (type && type !== 'all') url += `&type=${type}`;
    if (before) url += `&before=${encodeURIComponent(before)}`;
    return fetchJSON(url);
  },
};

// --- Health Mind (Human's Health) — only active if health worker configured ---
const HealthMind = {
  _enabled() { return NESTeqConfig.hasHealth?.() === true; },

  async getSynthesis() {
    if (!NESTeqConfig.hasGateway?.()) return null;
    // Gateway isn't proxied — synthesis endpoint typically is on the AI Mind anyway
    return fetchJSON(`${AI_PREFIX}/human-synthesis`);
  },
  async getDailySummary(days = 7) { if (!this._enabled()) return null; return fetchJSON(`${HEALTH_PREFIX}/watch/daily-summary?days=${days}`); },
  async getUplink(limit = 1) { if (!this._enabled()) return null; return fetchJSON(`${HEALTH_PREFIX}/uplink?limit=${limit}`); },
  async getHeartRate(limit = 10) { if (!this._enabled()) return null; return fetchJSON(`${HEALTH_PREFIX}/watch/heart-rate?limit=${limit}`); },
  async getStress(limit = 10) { if (!this._enabled()) return null; return fetchJSON(`${HEALTH_PREFIX}/watch/stress?limit=${limit}`); },
  async getSleep(limit = 3) { if (!this._enabled()) return null; return fetchJSON(`${HEALTH_PREFIX}/watch/sleep?limit=${limit}`); },
  async getBodyBattery(limit = 10) { if (!this._enabled()) return null; return fetchJSON(`${HEALTH_PREFIX}/watch/body-battery?limit=${limit}`); },
  async getHRV(limit = 3) { if (!this._enabled()) return null; return fetchJSON(`${HEALTH_PREFIX}/watch/hrv?limit=${limit}`); },
  async getSpo2() { if (!this._enabled()) return null; return fetchJSON(`${HEALTH_PREFIX}/watch/spo2`); },
  async getRespiration() { if (!this._enabled()) return null; return fetchJSON(`${HEALTH_PREFIX}/watch/respiration`); },
  async getCycle() { if (!this._enabled()) return null; return fetchJSON(`${HEALTH_PREFIX}/watch/cycle`); },
  async getFullStatus() { if (!this._enabled()) return null; return fetchJSON(`${HEALTH_PREFIX}/status`); },
  async getJournals(limit = 5) { if (!this._enabled()) return null; return fetchJSON(`${HEALTH_PREFIX}/journals?limit=${limit}`); },
  async getEQType() { if (!this._enabled()) return null; return fetchJSON(`${HEALTH_PREFIX}/eq/type`); },

  async getThreads(status = 'active') { if (!this._enabled()) return null; return fetchJSON(`${HEALTH_PREFIX}/threads?status=${status}`); },
  async addThread(content, priority = 'medium') {
    if (!this._enabled()) return null;
    return fetchJSON(`${HEALTH_PREFIX}/threads`, {
      method: 'POST',
      body: JSON.stringify({ action: 'add', content, priority }),
    });
  },
  async updateThread(thread_id, data) {
    if (!this._enabled()) return null;
    return fetchJSON(`${HEALTH_PREFIX}/threads`, {
      method: 'POST',
      body: JSON.stringify({ action: 'update', thread_id, ...data }),
    });
  },
  async resolveThread(thread_id, resolution = '') {
    if (!this._enabled()) return null;
    return fetchJSON(`${HEALTH_PREFIX}/threads`, {
      method: 'POST',
      body: JSON.stringify({ action: 'resolve', thread_id, resolution }),
    });
  },
  async deleteThread(thread_id) {
    if (!this._enabled()) return null;
    return fetchJSON(`${HEALTH_PREFIX}/threads`, {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', thread_id }),
    });
  },
};

// --- Workers (Diagnostics) — uses /setup/test on local agent ---
const Workers = {
  async checkAll() {
    try {
      const res = await fetch('/setup/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      return data.results || {};
    } catch {
      return {};
    }
  },

  get ENDPOINTS() {
    const cfg = NESTeqConfig._cache || {};
    const companion = cfg.identity?.companionName || 'Companion';
    const human = cfg.identity?.humanName || 'Human';
    const list = [];
    if (cfg.services?.aiMindUrl) list.push({ name: 'aiMind', label: `${companion}'s brain`, url: cfg.services.aiMindUrl });
    if (cfg.services?.healthUrl) list.push({ name: 'health', label: `${human}'s health`, url: cfg.services.healthUrl });
    if (cfg.services?.gatewayUrl) list.push({ name: 'gateway', label: 'Gateway (chat + tools)', url: cfg.services.gatewayUrl });
    return list;
  },
};

// --- Spotify (optional) ---
const Spotify = {
  async status() { return fetchJSON(`${AI_PREFIX}/spotify/status`); },
  async playlists(limit = 50) { return fetchJSON(`${AI_PREFIX}/spotify/playlists?limit=${limit}`); },
  async playlistTracks(id, offset = 0, limit = 50) {
    return fetchJSON(`${AI_PREFIX}/spotify/playlist/${id}/tracks?offset=${offset}&limit=${limit}`);
  },
  async addToPlaylist(playlistId, uris) {
    return fetchJSON(`${AI_PREFIX}/spotify/playlist/${playlistId}/add`, {
      method: 'POST', body: JSON.stringify({ uris }),
    });
  },
  async removeFromPlaylist(playlistId, uris) {
    return fetchJSON(`${AI_PREFIX}/spotify/playlist/${playlistId}/track`, {
      method: 'DELETE', body: JSON.stringify({ uris }),
    });
  },
  async search(q, type = 'track', limit = 10) {
    return fetchJSON(`${AI_PREFIX}/spotify/search?q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`);
  },
  async nowPlaying() { return fetchJSON(`${AI_PREFIX}/spotify/now-playing`); },
  async play(body = {}) { return fetchJSON(`${AI_PREFIX}/spotify/play`, { method: 'PUT', body: JSON.stringify(body) }); },
  async pause() { return fetchJSON(`${AI_PREFIX}/spotify/pause`, { method: 'PUT', body: '{}' }); },
  async next() { return fetchJSON(`${AI_PREFIX}/spotify/next`, { method: 'PUT', body: '{}' }); },
  async prev() { return fetchJSON(`${AI_PREFIX}/spotify/prev`, { method: 'PUT', body: '{}' }); },
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
