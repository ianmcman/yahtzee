const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff'
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS
  });
  res.end(body);
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS
  });
  res.end(text);
}

function sendNotFound(res) {
  res.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...SECURITY_HEADERS
  });
  res.end('Not Found');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];

    req.on('data', chunk => {
      size += chunk.length;
      if (size > 4096) {
        tooLarge = true;
      } else {
        chunks.push(chunk);
      }
    });

    req.on('end', () => {
      if (tooLarge) {
        const err = new Error('Payload Too Large');
        err.status = 413;
        reject(err);
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        const json = JSON.parse(raw);
        resolve(json);
      } catch {
        const err = new Error('Invalid JSON');
        err.status = 400;
        reject(err);
      }
    });

    req.on('error', err => reject(err));
  });
}

function createServer({ store, staticDir }) {
  const normalizedStaticDir = path.resolve(staticDir);

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
      else res.end();
    });
  });

  async function handle(req, res) {
    let parsedUrl;
    try {
      parsedUrl = new URL(req.url, 'http://localhost');
      decodeURIComponent(parsedUrl.pathname);
    } catch {
      sendJson(res, 400, { error: 'Bad request' });
      return;
    }
    const pathname = parsedUrl.pathname;
    const method = req.method;

    // Health check
    if (method === 'GET' && pathname === '/healthz') {
      sendText(res, 200, 'ok');
      return;
    }

    // API Routes
    if (pathname.startsWith('/api/')) {
      // POST /api/rooms
      if (method === 'POST' && pathname === '/api/rooms') {
        try {
          const body = await readJsonBody(req);
          const result = store.create(body.name);
          sendJson(res, 201, result);
        } catch (err) {
          sendJson(res, err.status || 500, { error: err.message });
        }
        return;
      }

      // POST /api/rooms/:code/join
      const joinMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
      if (method === 'POST' && joinMatch) {
        try {
          const code = decodeURIComponent(joinMatch[1]);
          const body = await readJsonBody(req);
          const result = store.join(code, body.name);
          sendJson(res, 200, result);
        } catch (err) {
          sendJson(res, err.status || 500, { error: err.message });
        }
        return;
      }

      // POST /api/rooms/:code/start
      const startMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/start$/);
      if (method === 'POST' && startMatch) {
        try {
          const code = decodeURIComponent(startMatch[1]);
          await readJsonBody(req);
          const token = req.headers['x-token'];
          store.start(code, token);
          sendJson(res, 200, {});
        } catch (err) {
          sendJson(res, err.status || 500, { error: err.message });
        }
        return;
      }

      // POST /api/rooms/:code/act
      const actMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/act$/);
      if (method === 'POST' && actMatch) {
        try {
          const code = decodeURIComponent(actMatch[1]);
          const body = await readJsonBody(req);
          const token = req.headers['x-token'];
          store.act(code, token, body);
          sendJson(res, 200, {});
        } catch (err) {
          sendJson(res, err.status || 500, { error: err.message });
        }
        return;
      }

      // GET /api/rooms/:code/events?token=
      const eventsMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/events$/);
      if (method === 'GET' && eventsMatch) {
        const code = decodeURIComponent(eventsMatch[1]);
        const token = parsedUrl.searchParams.get('token');
        if (!token) {
          sendJson(res, 403, { error: 'Token is required' });
          return;
        }

        let initialView;
        try {
          initialView = store.view(code, token);
        } catch (err) {
          sendJson(res, err.status || 500, { error: err.message });
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          'Connection': 'keep-alive',
          ...SECURITY_HEADERS
        });

        res.write(`data: ${JSON.stringify(initialView)}\n\n`);

        const unsubscribe = store.subscribe(code, () => {
          try {
            const currentView = store.view(code, token);
            res.write(`data: ${JSON.stringify(currentView)}\n\n`);
          } catch {
            cleanup();
            res.end();
          }
        });

        const pingInterval = setInterval(() => {
          res.write(': ping\n\n');
        }, 20000);
        pingInterval.unref();

        let closed = false;
        function cleanup() {
          if (closed) return;
          closed = true;
          clearInterval(pingInterval);
          unsubscribe();
        }

        req.on('close', cleanup);
        req.on('error', cleanup);
        return;
      }

      // Unmatched API route
      sendJson(res, 404, { error: 'Not Found' });
      return;
    }

    // Static Files (GET only)
    if (method !== 'GET' && method !== 'HEAD') {
      sendNotFound(res);
      return;
    }

    let decodedPathname;
    try {
      decodedPathname = decodeURIComponent(pathname);
    } catch {
      sendNotFound(res);
      return;
    }

    if (decodedPathname === '/') {
      decodedPathname = '/index.html';
    }

    // Path traversal check
    const resolvedPath = path.resolve(normalizedStaticDir, '.' + path.sep + decodedPathname);
    if (!resolvedPath.startsWith(normalizedStaticDir + path.sep)) {
      sendNotFound(res);
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext];
    if (!contentType) {
      sendNotFound(res);
      return;
    }

    fs.stat(resolvedPath, (err, stats) => {
      if (err || !stats.isFile()) {
        sendNotFound(res);
        return;
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        ...SECURITY_HEADERS
      });

      if (method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(resolvedPath);
      stream.on('error', () => {
        if (!res.headersSent) {
          sendNotFound(res);
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    });
  }

  return server;
}

if (require.main === module) {
  const { createRoomStore } = require('./rooms.js');
  const store = createRoomStore();
  const staticDir = path.join(__dirname, '../site');
  const server = createServer({ store, staticDir });
  const PORT = parseInt(process.env.PORT, 10) || 8080;

  const sweepInterval = setInterval(() => {
    store.sweep();
  }, 10 * 60 * 1000);
  sweepInterval.unref();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

module.exports = {
  createServer
};
