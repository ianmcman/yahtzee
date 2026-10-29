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
  '.webmanifest': 'application/manifest+json; charset=utf-8',
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

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function isJson(req) {
  return /^application\/json\b/i.test(req.headers['content-type'] || '');
}

function isPrivate(addr) {
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.))/.test(addr || '');
}

// Behind SWAG the socket peer is the proxy, so trust X-Real-IP only from private peers.
function clientIp(req) {
  const peer = req.socket.remoteAddress || '';
  const fwd = req.headers['x-real-ip'];
  return isPrivate(peer) && typeof fwd === 'string' && fwd ? fwd.trim() : peer;
}

function createLimiter(max, windowMs) {
  const hits = new Map();
  return key => {
    const t = Date.now();
    const list = (hits.get(key) || []).filter(x => x > t - windowMs);
    if (list.length >= max) { hits.set(key, list); return false; }
    list.push(t);
    hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || v[v.length - 1] <= t - windowMs) hits.delete(k);
    return true;
  };
}

function createServer({ store, staticDir, accounts = null, stats = null }) {
  const registerLimit = createLimiter(5, 60 * 60e3);
  const loginLimit = createLimiter(20, 15 * 60e3);

  function sessionUser(req) {
    if (!accounts) return null;
    if (req.method === 'POST' && !isJson(req)) return null;
    return accounts.userForSession(parseCookies(req).sid);
  }

  function setSession(req, res, sid, maxAge) {
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
  }

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
      // Accounts
      if (pathname === '/api/me' && method === 'GET') {
        const user = sessionUser(req);
        sendJson(res, 200, { user: user ? { username: user.username } : null, enabled: Boolean(accounts) });
        return;
      }
      if (accounts && method === 'POST' && (pathname === '/api/register' || pathname === '/api/login' || pathname === '/api/logout')) {
        try {
          if (!isJson(req)) {
            const err = new Error('Content-Type must be application/json');
            err.status = 415;
            throw err;
          }
          const ip = clientIp(req);
          if (pathname === '/api/register' && !registerLimit(ip)) {
            const err = new Error('Too many sign-ups from this address. Try again later.');
            err.status = 429;
            throw err;
          }
          if (pathname === '/api/login' && !loginLimit(ip)) {
            const err = new Error('Too many attempts. Try again later.');
            err.status = 429;
            throw err;
          }
          const body = await readJsonBody(req);
          if (pathname === '/api/logout') {
            accounts.logout(parseCookies(req).sid);
            setSession(req, res, '', 0);
            sendJson(res, 200, {});
            return;
          }
          const r = pathname === '/api/register'
            ? accounts.register(body.username, body.password)
            : accounts.login(body.username, body.password);
          setSession(req, res, r.sid, 30 * 86400);
          sendJson(res, pathname === '/api/register' ? 201 : 200, { username: r.user.username });
        } catch (err) {
          sendJson(res, err.status || 500, { error: err.status ? err.message : 'Internal error' });
        }
        return;
      }
      if (stats && method === 'GET' && pathname === '/api/leaderboard') {
        try {
          const board = parsedUrl.searchParams.get('board') || 'wins';
          const period = parsedUrl.searchParams.get('period') || 'all';
          sendJson(res, 200, { rows: stats.leaderboard(board, period) });
        } catch (err) {
          sendJson(res, err.status || 500, { error: err.status ? err.message : 'Internal error' });
        }
        return;
      }
      const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
      if (stats && method === 'GET' && userMatch) {
        const prof = stats.profile(decodeURIComponent(userMatch[1]));
        if (prof) sendJson(res, 200, prof);
        else sendJson(res, 404, { error: 'No such user' });
        return;
      }

      // POST /api/rooms
      if (method === 'POST' && pathname === '/api/rooms') {
        try {
          const body = await readJsonBody(req);
          const user = sessionUser(req);
          const result = store.create(user ? user.username : body.name, user ? user.id : null);
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
          const user = sessionUser(req);
          const result = store.join(code, user ? user.username : body.name, user ? user.id : null);
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

      const extra = decodedPathname === '/sw.js'
        ? { 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' }
        : {};
      res.writeHead(200, {
        'Content-Type': contentType,
        ...extra,
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
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
  let accounts = null;
  let stats = null;
  let onFinish;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(dataDir, 'yahtzee.db'));
    accounts = require('./accounts.js').createAccounts({ db });
    stats = require('./stats.js').createStats({ db });
    onFinish = g => stats.record(g);
  } catch (err) {
    console.error('Accounts disabled:', err.message);
  }
  const store = createRoomStore({ onFinish });
  const staticDir = path.join(__dirname, '../site');
  const server = createServer({ store, staticDir, accounts, stats });
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
