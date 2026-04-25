/* ============================================================
   NESTeq Dashboard — API Layer
   Fetches from ai-mind and fox-mind workers
   ============================================================ */

const API = {
  AI_MIND: 'https://your-ai-mind.workers.dev',
  FOX_MIND: 'https://your-fox-mind.workers.dev',
  API_KEY: 'your-api-key-here',
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
};

// --- Fox Mind (Fox's Health) ---
const FoxMind = {
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
    { name: 'fox-mind', url: 'https://your-fox-mind.workers.dev', desc: 'Human health' },
    { name: 'garmin-sync', url: 'https://your-garmin-sync.workers.dev', desc: 'Watch sync' },
    { name: 'discord-mcp', url: 'https://your-discord-mcp.workers.dev', desc: 'Discord' },
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
