/**
 * NESTdesktop PC Control Client Library
 *
 * Provides Claude Code-style file, shell, search, and system tools.
 * Calls the local agent at localhost:3457/pc/*.
 *
 * Usage:
 *   await PC.file.read('C:/Users/YourName/Desktop/test.txt')
 *   await PC.shell.exec('git status')
 *   await PC.glob('**/*.ts', 'C:/project')
 *   await PC.grep('TODO', { path: 'C:/project', output_mode: 'content' })
 *
 * NESTeq Community.
 */

const PC_AGENT_URL = 'http://localhost:3457';

async function pcFetch(endpoint, options = {}) {
  const { method = 'POST', body } = options;
  try {
    const resp = await fetch(`${PC_AGENT_URL}/pc${endpoint}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  } catch (err) {
    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      throw new Error('NESTdesktop agent not running. Start it with: node local-agent.js');
    }
    throw err;
  }
}

const PC = {
  // Check if agent is alive
  async isAlive() {
    try {
      const resp = await fetch(`${PC_AGENT_URL}/health`, { signal: AbortSignal.timeout(2000) });
      return resp.ok;
    } catch {
      return false;
    }
  },

  // File operations
  file: {
    async read(path, { offset, limit } = {}) {
      return pcFetch('/file/read', { body: { path, offset, limit } });
    },
    async write(path, content) {
      return pcFetch('/file/write', { body: { path, content } });
    },
    async edit(path, old_string, new_string, replace_all = false) {
      return pcFetch('/file/edit', { body: { path, old_string, new_string, replace_all } });
    },
  },

  // File pattern search
  async glob(pattern, path) {
    return pcFetch('/glob', { body: { pattern, path } });
  },

  // Content search (ripgrep or PowerShell fallback)
  async grep(pattern, opts = {}) {
    return pcFetch('/grep', { body: { pattern, ...opts } });
  },

  // Shell command execution
  shell: {
    async exec(command, cwd) {
      return pcFetch('/shell', { body: { command, cwd } });
    },
  },

  // Process management
  process: {
    async list(opts = {}) {
      const params = new URLSearchParams(opts).toString();
      return pcFetch(`/process/list${params ? '?' + params : ''}`, { method: 'GET' });
    },
    async kill(pid) {
      return pcFetch('/process/kill', { body: { pid } });
    },
  },

  // Screenshot capture
  async screenshot() {
    return pcFetch('/screenshot', { method: 'GET' });
  },

  // Clipboard
  clipboard: {
    async get() {
      return pcFetch('/clipboard', { method: 'GET' });
    },
    async set(text) {
      return pcFetch('/clipboard', { body: { text } });
    },
  },

  // App control
  app: {
    async launch(name, args) {
      return pcFetch('/app/launch', { body: { name, args } });
    },
    async list() {
      return pcFetch('/app/list', { method: 'GET' });
    },
  },

  // Web
  web: {
    async fetch(url) {
      return pcFetch('/web/fetch', { body: { url } });
    },
    async search(query, max_results) {
      return pcFetch('/web/search', { body: { query, max_results } });
    },
  },
};

// Make available globally
window.PC = PC;
