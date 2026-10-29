const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SITE = path.join(__dirname, '../site');
const read = f => fs.readFileSync(path.join(SITE, f), 'utf8');
const pngSize = f => { const b = fs.readFileSync(path.join(SITE, f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('manifest has the installable basics', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'Yahtzee');
  assert.ok(m.short_name && m.short_name.length <= 12);
  assert.equal(m.start_url, '/');
  assert.equal(m.scope, '/');
  assert.equal(m.display, 'standalone');
  assert.equal(m.orientation, 'portrait');
  assert.equal(m.background_color, '#282923');
  assert.equal(m.theme_color, '#282923');
  assert.ok(m.description);
});
test('manifest icons exist with the declared sizes; there is a 192, a 512 and a maskable 512', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  for (const i of m.icons) {
    const [w, h] = i.sizes.split('x').map(Number);
    assert.equal(i.type, 'image/png');
    assert.deepEqual(pngSize(i.src.replace(/^\//, '')), [w, h], i.src);
  }
  const has = (s, p) => m.icons.some(i => i.sizes === s && (i.purpose || 'any').split(' ').includes(p));
  assert.ok(has('192x192', 'any')); assert.ok(has('512x512', 'any')); assert.ok(has('512x512', 'maskable'));
});
test('index.html links the manifest, theme colour and iOS tags, and registers the service worker', () => {
  const h = read('index.html');
  assert.match(h, /<link[^>]+rel="manifest"[^>]+href="\/manifest\.webmanifest"/);
  assert.match(h, /<meta[^>]+name="theme-color"[^>]+content="#282923"/);
  assert.match(h, /<meta[^>]+name="apple-mobile-web-app-capable"[^>]+content="yes"/);
  assert.match(h, /<meta[^>]+name="apple-mobile-web-app-status-bar-style"/);
  const m = h.match(/<link[^>]+rel="apple-touch-icon"[^>]+href="([^"]+)"/);
  assert.ok(m); assert.deepEqual(pngSize(m[1].replace(/^\//, '')), [180, 180]);
  const scripts = [...h.matchAll(/<script[^>]+src="([^"]+)"/g)].map(x => x[1].replace(/^\//, ''));
  assert.ok(scripts.some(s => /serviceWorker\s*\.\s*register\(\s*['"]\/sw\.js['"]/.test(read(s))), 'a loaded script registers /sw.js');
});
test('sw.js precache list: versioned cache name, every entry exists, covers the app shell', () => {
  const src = read('sw.js');
  assert.match(src, /const CACHE = 'yahtzee-v\d+'/);
  const list = src.match(/const PRECACHE = \[([\s\S]*?)\]/)[1].match(/'[^']+'/g).map(s => s.slice(1, -1));
  for (const f of list) if (f !== '/') assert.ok(fs.existsSync(path.join(SITE, f.replace(/^\//, ''))), f);
  for (const f of ['/', '/index.html', '/style.css', '/app.js', '/online.js', '/score.js', '/game.js', '/ui-model.js',
    '/manifest.webmanifest', '/fonts/JetBrainsMono-Regular.woff2', '/icons/icon-192.png']) assert.ok(list.includes(f), f);
  assert.ok(!list.some(f => f.startsWith('/api/')));
});

function loadSw(cacheHit) {
  const handlers = {}; const calls = { respondWith: 0, fetched: [] };
  const cache = { match: async () => cacheHit, put: async () => {}, addAll: async () => {} };
  const ctx = {
    self: { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: async () => cacheHit },
    fetch: async u => { calls.fetched.push(u.url || u); return { ok: true, clone() { return this; } }; },
    URL, Response, Request, console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8'), ctx);
  const fire = (url, extra = {}) => {
    const ev = { request: { url: 'https://x.test' + url, method: 'GET', mode: 'same-origin', ...extra }, respondWith: p => { calls.respondWith++; ev.p = p; }, waitUntil() {} };
    handlers.fetch(ev); return ev;
  };
  return { handlers, calls, fire };
}
test('sw.js registers install, activate and fetch handlers', () => {
  const { handlers } = loadSw('hit');
  for (const t of ['install', 'activate', 'fetch']) assert.equal(typeof handlers[t], 'function', t);
});
test('sw.js never intercepts the API or non-GET requests', () => {
  const { calls, fire } = loadSw('hit');
  fire('/api/rooms/ABCD/events?token=x');
  fire('/api/rooms', { method: 'POST' });
  fire('/app.js', { method: 'POST' });
  assert.equal(calls.respondWith, 0);
});
test('sw.js answers static GETs and navigations through respondWith', async () => {
  const { calls, fire } = loadSw('cached');
  fire('/style.css');
  const nav = fire('/', { mode: 'navigate' });
  assert.equal(calls.respondWith, 2);
  assert.ok(await nav.p);
});
test('sw.js navigation falls back to the cached shell when the network fails', async () => {
  const handlers = {};
  const shell = { shell: true };
  const cache = { match: async () => shell, put: async () => {}, addAll: async () => {} };
  const ctx = {
    self: { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: async () => shell },
    fetch: async () => { throw new TypeError('offline'); },
    URL, Response, Request, console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8'), ctx);
  let p;
  handlers.fetch({ request: { url: 'https://x.test/', method: 'GET', mode: 'navigate' }, respondWith: x => { p = x; }, waitUntil() {} });
  assert.equal(await p, shell);
});
test('sw.js activate deletes old yahtzee caches but keeps the current one', async () => {
  const handlers = {}; const deleted = [];
  const ctx = {
    self: { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => ({ addAll: async () => {} }), keys: async () => ['yahtzee-v0', 'yahtzee-v999999', 'other'], delete: async k => { deleted.push(k); return true; } },
    fetch: async () => ({}), URL, Response, Request, console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8'), ctx);
  let p; handlers.activate({ waitUntil: x => { p = x; } }); await p;
  assert.ok(deleted.includes('yahtzee-v0'));
  assert.ok(!deleted.includes('other'));
});
