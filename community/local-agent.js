#!/usr/bin/env node
/**
 * NESTeq Community — Local Agent
 *
 * Serves the dashboard on port 3456 and PC control API on port 3457.
 * Config is split: config.public.json (browser-visible) + config.secret.json (local only).
 * Proxies /api/* to the user's AI Mind worker (secrets attached server-side).
 */

import express from 'express';
import cors from 'cors';
import { createReadStream, existsSync, statSync } from 'fs';
import { readFile, writeFile, rename } from 'fs/promises';
import { join, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import pcTools from './pc-tools/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DASHBOARD_DIR = resolve(__dirname, 'dashboard');
const PUBLIC_PATH = resolve(__dirname, 'config.public.json');
const SECRET_PATH = resolve(__dirname, 'config.secret.json');
const LEGACY_PATH = resolve(__dirname, 'config.json');

const SETUP_VERSION = 1;

const DEFAULT_PUBLIC = {
  configured: false,
  setupVersion: SETUP_VERSION,
  installMode: '',
  identity: {
    companionName: '',
    humanName: '',
    role: '',
    tonePreset: '',
  },
  appearance: {
    companionPortrait: '',
    humanPortrait: '',
  },
  services: {
    aiMindUrl: '',
    healthUrl: '',
    gatewayUrl: '',
    openrouterUrl: 'https://openrouter.ai/api/v1',
  },
  models: {
    chat: '',
    image: '',
  },
  voice: {
    provider: '',
    voiceId: '',
  },
  features: {
    memory: false,
    voice: false,
    gallery: true,
    health: false,
    discord: false,
    pcTools: false,
    workshop: false,
    daemon: false,
  },
  cloudflare: {
    accountId: '',
    gatewayWorkerName: '',
    pagesProjectName: '',
    customDomain: '',
  },
  starter: {
    chatProvider: 'openrouter',
    localUrl: '',
  },
};

const DEFAULT_SECRETS = {
  apiKey: '',
  openrouterKey: '',
  elevenlabsKey: '',
  cloudflare: { apiToken: '' },
  integrations: {
    tavilyApiKey: '',
    giphyApiKey: '',
    tenorApiKey: '',
    discordMcpSecret: '',
  },
};

let publicCfg = structuredClone(DEFAULT_PUBLIC);
let secrets = structuredClone(DEFAULT_SECRETS);

// --- Config I/O ---

function deepMerge(base, overlay) {
  if (overlay == null || typeof overlay !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function readJson(path) {
  if (!existsSync(path)) return null;
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw);
}

async function writeJson(path, data) {
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}

async function migrateLegacy() {
  if (!existsSync(LEGACY_PATH) || existsSync(PUBLIC_PATH)) return;
  const legacy = await readJson(LEGACY_PATH);
  if (!legacy || typeof legacy !== 'object') return;

  const pub = structuredClone(DEFAULT_PUBLIC);
  pub.configured = !!legacy.configured;
  pub.setupVersion = SETUP_VERSION;
  pub.installMode = legacy.aiMindUrl ? 'existing-memory' : (legacy.openrouterKey ? 'starter' : '');
  pub.identity.companionName = legacy.companionName || '';
  pub.identity.humanName = legacy.humanName || '';
  pub.services.aiMindUrl = legacy.aiMindUrl || '';
  pub.services.healthUrl = legacy.healthUrl || '';
  pub.services.gatewayUrl = legacy.gatewayUrl || '';
  pub.models.chat = legacy.chatModel || '';
  pub.voice.voiceId = legacy.elevenlabsVoice || '';
  pub.voice.provider = legacy.elevenlabsKey ? 'elevenlabs' : '';
  pub.features.memory = !!legacy.aiMindUrl;
  pub.features.voice = !!legacy.elevenlabsKey;
  pub.features.health = !!legacy.healthUrl;
  pub.features.workshop = !!legacy.gatewayUrl;

  const sec = structuredClone(DEFAULT_SECRETS);
  sec.apiKey = legacy.apiKey || '';
  sec.openrouterKey = legacy.openrouterKey || '';
  sec.elevenlabsKey = legacy.elevenlabsKey || '';

  await writeJson(PUBLIC_PATH, pub);
  await writeJson(SECRET_PATH, sec);
  await rename(LEGACY_PATH, `${LEGACY_PATH}.bak`);
  console.log('  Migrated legacy config.json → config.public.json + config.secret.json');
}

async function loadConfig() {
  await migrateLegacy();
  const pub = await readJson(PUBLIC_PATH);
  if (pub) publicCfg = deepMerge(DEFAULT_PUBLIC, pub);
  const sec = await readJson(SECRET_PATH);
  if (sec) secrets = deepMerge(DEFAULT_SECRETS, sec);
}

async function saveConfig({ public: pubIn, secrets: secIn }) {
  if (pubIn) publicCfg = deepMerge(publicCfg, pubIn);
  if (secIn) secrets = deepMerge(secrets, secIn);
  publicCfg.configured = true;
  publicCfg.setupVersion = SETUP_VERSION;
  await writeJson(PUBLIC_PATH, publicCfg);
  await writeJson(SECRET_PATH, secrets);
}

async function clearConfig() {
  publicCfg = structuredClone(DEFAULT_PUBLIC);
  secrets = structuredClone(DEFAULT_SECRETS);
  if (existsSync(PUBLIC_PATH)) await writeJson(PUBLIC_PATH, publicCfg);
  if (existsSync(SECRET_PATH)) await writeJson(SECRET_PATH, secrets);
}

// --- Validation probes ---

async function probe(url, key, timeoutMs = 8000) {
  if (!url) return { ok: false, message: 'not configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, message: `${res.status} ${res.statusText}` };
    let data = null;
    try { data = await res.json(); } catch { /* non-json health is fine */ }
    return { ok: true, data };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, message: err.name === 'AbortError' ? 'timeout' : err.message };
  }
}

async function probeOpenrouter(key) {
  if (!key) return { ok: false, message: 'no key' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, message: `${res.status} ${res.statusText}` };
    const data = await res.json();
    return { ok: true, data: { modelCount: data?.data?.length || 0 } };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, message: err.name === 'AbortError' ? 'timeout' : err.message };
  }
}

async function probeElevenlabs(key) {
  if (!key) return { ok: false, message: 'no key' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': key },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, message: `${res.status} ${res.statusText}` };
    return { ok: true };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, message: err.name === 'AbortError' ? 'timeout' : err.message };
  }
}

// Accept candidate values from the wizard so Test Setup can verify before save
async function runProbes({ aiMind, health, gateway, openrouter, elevenlabs } = {}) {
  const targets = {
    aiMind: aiMind || { url: publicCfg.services.aiMindUrl, key: secrets.apiKey },
    health: health || { url: publicCfg.services.healthUrl, key: secrets.apiKey },
    gateway: gateway || { url: publicCfg.services.gatewayUrl, key: secrets.apiKey },
    openrouter: openrouter || { key: secrets.openrouterKey },
    elevenlabs: elevenlabs || { key: secrets.elevenlabsKey },
  };
  const results = {};
  await Promise.all([
    probe(targets.aiMind.url, targets.aiMind.key).then(r => results.aiMind = r),
    probe(targets.health.url, targets.health.key).then(r => results.health = r),
    probe(targets.gateway.url, targets.gateway.key).then(r => results.gateway = r),
    probeOpenrouter(targets.openrouter.key).then(r => results.openrouter = r),
    probeElevenlabs(targets.elevenlabs.key).then(r => results.elevenlabs = r),
  ]);
  results.localAgent = { ok: true };
  return results;
}

// --- MIME ---
const MIME_TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

// --- Dashboard Server (port 3456) ---
const dashboard = express();
dashboard.use(cors());
dashboard.use(express.json({ limit: '50mb' }));

// Public config only — never return secrets to the browser
dashboard.get('/config', (req, res) => {
  res.json(publicCfg);
});

// Lightweight status endpoint the wizard gates on
dashboard.get('/setup/status', (req, res) => {
  res.json({
    configured: publicCfg.configured,
    setupVersion: publicCfg.setupVersion,
    installMode: publicCfg.installMode,
  });
});

// Wizard save — body shape: { public: {...}, secrets: {...} }
dashboard.post('/setup/save', async (req, res) => {
  try {
    await saveConfig(req.body || {});
    console.log(`  Config saved — ${publicCfg.identity.companionName || 'companion'} via ${publicCfg.installMode || 'unknown'}`);
    res.json({ ok: true, public: publicCfg });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Wizard validation — probes services. Body: { candidates?: { aiMind:{url,key}, ... } }
dashboard.post('/setup/test', async (req, res) => {
  try {
    const results = await runProbes(req.body?.candidates || {});
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

dashboard.delete('/config', async (req, res) => {
  try {
    await clearConfig();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Chat proxy — routes /chat/completions to the configured provider (OpenRouter, gateway, or local LLM)
dashboard.post('/chat/completions', async (req, res) => {
  if (!publicCfg.configured) {
    return res.status(503).json({ error: 'Not configured. Complete the setup wizard.' });
  }

  // Provider selection — Cloudflare/existing-memory → gateway if set, else openrouter; starter → provider choice
  const mode = publicCfg.installMode;
  const useGateway = !!publicCfg.services.gatewayUrl && mode !== 'starter';
  const useLocal = mode === 'starter' && publicCfg.starter?.chatProvider === 'local';

  let target, authHeader;
  if (useGateway) {
    target = `${publicCfg.services.gatewayUrl.replace(/\/$/, '')}/chat`;
    authHeader = { Authorization: `Bearer ${secrets.apiKey}` };
  } else if (useLocal) {
    const localUrl = publicCfg.starter?.localUrl || 'http://127.0.0.1:18789';
    target = `${localUrl.replace(/\/$/, '')}/v1/chat/completions`;
    authHeader = {};
  } else {
    target = `${publicCfg.services.openrouterUrl.replace(/\/$/, '')}/chat/completions`;
    authHeader = { Authorization: `Bearer ${secrets.openrouterKey}` };
  }

  if (!authHeader.Authorization && !useLocal) {
    return res.status(503).json({ error: 'Chat provider key missing — re-run setup.' });
  }

  try {
    const resp = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify(req.body),
    });

    if (resp.headers.get('content-type')?.includes('text/event-stream')) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); return; }
          res.write(decoder.decode(value, { stream: true }));
        }
      };
      pump().catch(() => res.end());
      return;
    }

    res.status(resp.status);
    const text = await resp.text();
    try { res.json(JSON.parse(text)); } catch { res.send(text); }
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Proxy /api/* — routes to AI Mind (or Health if /api/health/*), attaches Bearer server-side
dashboard.all('/api/{*path}', async (req, res) => {
  if (!publicCfg.configured || !publicCfg.services.aiMindUrl) {
    return res.status(503).json({ error: 'Not configured. Complete the setup wizard.' });
  }

  let targetBase = publicCfg.services.aiMindUrl;
  let targetPath = req.originalUrl;
  if (req.params.path?.startsWith('health/') && publicCfg.services.healthUrl) {
    targetBase = publicCfg.services.healthUrl;
    targetPath = req.originalUrl.replace('/api/health/', '/');
  }

  try {
    const target = `${targetBase}${targetPath}`;
    const headers = { Authorization: `Bearer ${secrets.apiKey}` };
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

    const resp = await fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
    });

    if (resp.headers.get('content-type')?.includes('text/event-stream')) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); return; }
          res.write(decoder.decode(value, { stream: true }));
        }
      };
      pump().catch(() => res.end());
      return;
    }

    res.status(resp.status);
    const text = await resp.text();
    try { res.json(JSON.parse(text)); } catch { res.send(text); }
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Proxy /v1/* → local LLM (OpenClaw / LM Studio / Ollama)
dashboard.all('/v1/{*path}', async (req, res) => {
  const openclawUrl = 'http://127.0.0.1:18789';
  try {
    const target = `${openclawUrl}${req.originalUrl}`;
    const resp = await fetch(target, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
    });

    if (resp.headers.get('content-type')?.includes('text/event-stream')) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); return; }
          res.write(decoder.decode(value, { stream: true }));
        }
      };
      pump().catch(() => res.end());
      return;
    }

    res.status(resp.status);
    const text = await resp.text();
    try { res.json(JSON.parse(text)); } catch { res.send(text); }
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Static dashboard
dashboard.get('{*any}', (req, res) => {
  if (!publicCfg.configured && (req.path === '/' || req.path === '/index.html')) {
    return res.redirect('/setup.html');
  }

  let filePath = join(DASHBOARD_DIR, req.path === '/' ? 'index.html' : req.path);
  if (!filePath.startsWith(DASHBOARD_DIR)) {
    return res.status(403).send('Forbidden');
  }
  if (!extname(filePath) && !existsSync(filePath)) {
    filePath += '.html';
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    const indexPath = join(filePath, 'index.html');
    if (existsSync(indexPath)) filePath = indexPath;
    else return res.status(404).send('Not found');
  }

  const ext = extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  createReadStream(filePath).pipe(res);
});

// --- PC Agent Server (port 3457) ---
const agent = express();
agent.use(cors());
agent.use(express.json({ limit: '50mb' }));

agent.get('/health', (req, res) => {
  res.json({ status: 'alive', app: 'NESTeq Community', tools: 12 });
});

agent.use('/pc', pcTools);

// --- Start ---
await loadConfig();

const dashServer = dashboard.listen(3456, () => {
  console.log('');
  console.log('  NESTeq Community — Dashboard is open.');
  console.log('  http://localhost:3456');
  if (publicCfg.configured) {
    console.log(`  Mode: ${publicCfg.installMode}`);
    console.log(`  Companion: ${publicCfg.identity.companionName || '(unnamed)'}`);
  } else {
    console.log('  Not configured yet — setup wizard will launch.');
  }
  console.log('');
});

dashServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error('  Port 3456 already in use.');
  else console.error('Dashboard error:', err.message);
  process.exit(1);
});

const agentServer = agent.listen(3457, () => {
  console.log('  PC Agent:  http://localhost:3457');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});

agentServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error('  Port 3457 already in use.');
  else console.error('Agent error:', err.message);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n  NESTeq Community shutting down.');
  process.exit(0);
});
