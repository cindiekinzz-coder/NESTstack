/**
 * NESTeq Dashboard — Local Dev Server
 * Serves static files + proxies /v1/* to OpenClaw gateway
 * 
 * Usage: node serve.js
 * Then open: http://localhost:3000/chat.html
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const GATEWAY = 'http://127.0.0.1:18789';
const BASE = __dirname;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  // Proxy /api/* to NESTeq Cloudflare Worker
  if (req.url.startsWith('/api/')) {
    const targetUrl = `https://YOUR-MIND-WORKER.workers.dev${req.url}`;
    
    // Collect request body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    try {
      const proxyRes = await fetch(targetUrl, {
        method: req.method,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          'Authorization': req.headers['authorization'] || '',
        },
        body: req.method !== 'GET' ? body : undefined,
      });

      // Check if streaming response
      const contentType = proxyRes.headers.get('content-type') || '';
      
      if (contentType.includes('text/event-stream')) {
        // Stream SSE through
        res.writeHead(proxyRes.status, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        
        const reader = proxyRes.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { res.end(); return; }
            res.write(value);
          }
        };
        pump().catch(() => res.end());
      } else {
        // Regular response
        const data = await proxyRes.text();
        res.writeHead(proxyRes.status, { 
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(data);
      }
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Worker unreachable', detail: err.message }));
    }
    return;
  }

  // Proxy /v1/* to OpenClaw gateway
  if (req.url.startsWith('/v1/')) {
    const targetUrl = `${GATEWAY}${req.url}`;
    
    // Collect request body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    try {
      const proxyRes = await fetch(targetUrl, {
        method: req.method,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          'Authorization': req.headers['authorization'] || '',
          'x-openclaw-agent-id': req.headers['x-openclaw-agent-id'] || '',
        },
        body: req.method !== 'GET' ? body : undefined,
      });

      // Check if streaming response
      const contentType = proxyRes.headers.get('content-type') || '';
      
      if (contentType.includes('text/event-stream')) {
        // Stream SSE through
        res.writeHead(proxyRes.status, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        
        const reader = proxyRes.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { res.end(); return; }
            res.write(value);
          }
        };
        pump().catch(() => res.end());
      } else {
        // Regular response
        const data = await proxyRes.text();
        res.writeHead(proxyRes.status, { 'Content-Type': contentType });
        res.end(data);
      }
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Gateway unreachable', detail: err.message }));
    }
    return;
  }

  // Static file serving
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  
  const filePath = path.join(BASE, urlPath);
  
  // Security: prevent directory traversal
  if (!filePath.startsWith(BASE)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n  🏠 NESTeq Dashboard`);
  console.log(`  ───────────────────`);
  console.log(`  Dashboard:  http://localhost:${PORT}`);
  console.log(`  Chat:       http://localhost:${PORT}/chat.html`);
  console.log(`  Gateway:    ${GATEWAY}`);
  console.log(`  \n  The Nest is open.\n`);
});
