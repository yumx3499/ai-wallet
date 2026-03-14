const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');
const fs = require('fs');

const PORT = 3001;
const OPENROUTER_BASE = 'https://openrouter.ai';

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API proxy routes
  if (pathname === '/api/activity') {
    proxyRequest(req, res, '/api/v1/activity');
    return;
  }

  if (pathname === '/api/key') {
    proxyRequest(req, res, '/api/v1/key');
    return;
  }

  // Serve static files
  serveStatic(req, res, pathname);
});

function proxyRequest(req, res, targetPath) {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '缺少 Authorization header' }));
    return;
  }

  const options = {
    hostname: 'openrouter.ai',
    port: 443,
    path: targetPath,
    method: 'GET',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    }
  };

  const proxyReq = https.request(options, (proxyRes) => {
    let body = '';

    proxyRes.on('data', chunk => {
      body += chunk;
    });

    proxyRes.on('end', () => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(body);
    });
  });

  proxyReq.on('error', (err) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '代理请求失败: ' + err.message }));
  });

  proxyReq.end();
}

function serveStatic(req, res, pathname) {
  // Default to index.html
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, filePath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

server.listen(PORT, () => {
  console.log(`AI Wallet server running at http://localhost:${PORT}`);
  console.log(`Proxy endpoints:`);
  console.log(`  GET /api/activity -> OpenRouter /api/v1/activity`);
  console.log(`  GET /api/key      -> OpenRouter /api/v1/key`);
});
