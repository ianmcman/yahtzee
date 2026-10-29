const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomStore } = require('../server/rooms.js');
const { createServer } = require('../server/server.js');

async function boot() {
  const srv = createServer({ store: createRoomStore(), staticDir: require('node:path').join(__dirname, '../site') });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const j = (path, body, token) => fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-token': token } : {}) },
    body: JSON.stringify(body || {}) });
  return { srv, base, j, close: () => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }) };
}
async function nextEvent(reader, dec) {
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error('stream ended');
    buf += dec.decode(value);
    const m = buf.match(/data: (.*)\n\n/);
    if (m) return JSON.parse(m[1]);
  }
}

test('create, join, start, act over HTTP; SSE pushes views', async () => {
  const { base, j, close } = await boot();
  try {
    let r = await j('/api/rooms', { name: 'Ann' });
    assert.equal(r.status, 201);
    const { code, token: t1 } = await r.json();
    const ac = new AbortController();
    const es = await fetch(`${base}/api/rooms/${code}/events?token=${t1}`, { signal: ac.signal });
    assert.equal(es.status, 200);
    assert.match(es.headers.get('content-type'), /text\/event-stream/);
    const reader = es.body.getReader(); const dec = new TextDecoder();
    let ev = await nextEvent(reader, dec);
    assert.equal(ev.phase, 'lobby'); assert.equal(ev.players.length, 1);

    r = await j(`/api/rooms/${code}/join`, { name: 'Bob' });
    assert.equal(r.status, 200);
    const { token: t2 } = await r.json();
    ev = await nextEvent(reader, dec);
    assert.equal(ev.players.length, 2);

    r = await j(`/api/rooms/${code}/start`, {}, t2); assert.equal(r.status, 403);
    r = await j(`/api/rooms/${code}/start`, {}, t1); assert.equal(r.status, 200);
    ev = await nextEvent(reader, dec); assert.equal(ev.phase, 'playing');

    r = await j(`/api/rooms/${code}/act`, { type: 'roll' }, t2); assert.equal(r.status, 409);
    r = await j(`/api/rooms/${code}/act`, { type: 'roll' }, t1); assert.equal(r.status, 200);
    ev = await nextEvent(reader, dec); assert.equal(ev.game.rollsLeft, 2);
    ac.abort();
  } finally { await close(); }
});
test('status codes: unknown room 404, bad token 403, bad json 400, SSE without token 403', async () => {
  const { base, j, close } = await boot();
  try {
    assert.equal((await j('/api/rooms/ZZZZ/join', { name: 'x' })).status, 404);
    const { code } = await (await j('/api/rooms', { name: 'A' })).json();
    assert.equal((await j(`/api/rooms/${code}/act`, { type: 'roll' }, 'bad')).status, 403);
    assert.equal((await fetch(`${base}/api/rooms`, { method: 'POST', body: '{nope' })).status, 400);
    assert.equal((await fetch(`${base}/api/rooms/${code}/events`)).status, 403);
    assert.equal((await fetch(`${base}/api/nothing`)).status, 404);
  } finally { await close(); }
});
test('serves the static site, blocks path traversal, rejects oversized bodies', async () => {
  const { base, close } = await boot();
  try {
    const r = await fetch(base + '/');
    assert.equal(r.status, 200); assert.match(await r.text(), /Yahtzee/);
    assert.match((await fetch(base + '/app.js')).headers.get('content-type'), /javascript/);
    assert.equal((await fetch(base + '/..%2fpackage.json')).status, 404);
    assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
    const big = await fetch(base + '/api/rooms', { method: 'POST', body: 'x'.repeat(100000) });
    assert.equal(big.status, 413);
  } finally { await close(); }
});
test('/healthz answers ok', async () => {
  const { base, close } = await boot();
  try { assert.equal((await fetch(base + '/healthz')).status, 200); } finally { await close(); }
});
test('malformed percent-encoding returns 400 and does not crash the server', async () => {
  const { base, close } = await boot();
  try {
    assert.equal((await fetch(`${base}/api/rooms/%/events?token=x`)).status, 400);
    assert.equal((await fetch(`${base}/%E0%A4%A`)).status, 400);
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
  } finally { await close(); }
});
test('serves the bundled font as font/woff2', async () => {
  const { base, close } = await boot();
  try {
    const r = await fetch(base + '/fonts/JetBrainsMono-Regular.woff2');
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'font/woff2');
  } finally { await close(); }
});
test('serves the manifest as application/manifest+json and the service worker uncached', async () => {
  const { base, close } = await boot();
  try {
    const m = await fetch(base + '/manifest.webmanifest');
    assert.equal(m.status, 200); assert.match(m.headers.get('content-type'), /^application\/manifest\+json/);
    const s = await fetch(base + '/sw.js');
    assert.equal(s.status, 200); assert.match(s.headers.get('content-type'), /javascript/);
    assert.match(s.headers.get('cache-control'), /no-cache|no-store/);
    assert.equal(s.headers.get('service-worker-allowed'), '/');
    assert.equal((await fetch(base + '/icons/icon-192.png')).headers.get('content-type'), 'image/png');
  } finally { await close(); }
});

const { DatabaseSync } = require('node:sqlite');
const { createAccounts } = require('../server/accounts.js');
const { createStats } = require('../server/stats.js');
async function bootAcc() {
  const db = new DatabaseSync(':memory:');
  const accounts = createAccounts({ db }); const stats = createStats({ db });
  const store = createRoomStore({ onFinish: g => stats.record(g) });
  const srv = createServer({ store, accounts, stats, staticDir: require('node:path').join(__dirname, '../site') });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (path, body, cookie, token) => fetch(base + path, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(token ? { 'x-token': token } : {}) }, body: JSON.stringify(body || {}) });
  const sid = r => (r.headers.get('set-cookie') || '').match(/sid=([a-f0-9]+)/)?.[1];
  return { base, post, sid, accounts, stats, close: () => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }) };
}
test('register sets an HttpOnly SameSite cookie and /api/me knows the user; logout clears it', async () => {
  const { base, post, sid, close } = await bootAcc();
  try {
    const r = await post('/api/register', { username: 'Ian', password: 'password1' });
    assert.equal(r.status, 201); assert.deepEqual(await r.json(), { username: 'Ian' });
    const sc = r.headers.get('set-cookie'); assert.match(sc, /HttpOnly/i); assert.match(sc, /SameSite=Lax/i); assert.match(sc, /Path=\//);
    const cookie = 'sid=' + sid(r);
    assert.deepEqual(await (await fetch(base + '/api/me', { headers: { cookie } })).json(), { user: { username: 'Ian' }, enabled: true });
    assert.deepEqual(await (await fetch(base + '/api/me')).json(), { user: null, enabled: true });
    assert.equal((await post('/api/logout', {}, cookie)).status, 200);
    assert.equal((await (await fetch(base + '/api/me', { headers: { cookie } })).json()).user, null);
    const l = await post('/api/login', { username: 'ian', password: 'password1' });
    assert.equal(l.status, 200); assert.ok(sid(l));
  } finally { await close(); }
});
test('auth errors: 400 weak input, 409 taken, 401 bad login, 415 without a JSON content type', async () => {
  const { base, post, close } = await bootAcc();
  try {
    assert.equal((await post('/api/register', { username: 'ab', password: 'password1' })).status, 400);
    await post('/api/register', { username: 'Ian', password: 'password1' });
    assert.equal((await post('/api/register', { username: 'ian', password: 'password1' })).status, 409);
    assert.equal((await post('/api/login', { username: 'Ian', password: 'nope-nope-1' })).status, 401);
    const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    assert.equal(r.status, 415);
  } finally { await close(); }
});
test('registration is rate limited per client: the 6th signup in an hour is 429', async () => {
  const { post, close } = await bootAcc();
  try {
    for (let i = 0; i < 5; i++) assert.equal((await post('/api/register', { username: 'user' + i, password: 'password1' })).status, 201);
    assert.equal((await post('/api/register', { username: 'user9', password: 'password1' })).status, 429);
  } finally { await close(); }
});
test('rooms use the account name, ignore the body name, and become ranked with 2 accounts', async () => {
  const { base, post, sid, close } = await bootAcc();
  try {
    const c1 = 'sid=' + sid(await post('/api/register', { username: 'Ann', password: 'password1' }));
    const c2 = 'sid=' + sid(await post('/api/register', { username: 'Bob', password: 'password1' }));
    const { code, token } = await (await post('/api/rooms', { name: 'Spoofed' }, c1)).json();
    await post(`/api/rooms/${code}/join`, { name: 'Guest' });
    const ac = new AbortController();
    const es = await fetch(`${base}/api/rooms/${code}/events?token=${token}`, { signal: ac.signal });
    const reader = es.body.getReader(); const dec = new TextDecoder();
    let ev = await nextEvent(reader, dec);
    assert.deepEqual(ev.players.map(p => p.name), ['Ann', 'Guest']); assert.equal(ev.ranked, false);
    assert.equal((await post(`/api/rooms/${code}/join`, { name: 'x' }, c1)).status, 409);
    await post(`/api/rooms/${code}/join`, { name: 'x' }, c2);
    ev = await nextEvent(reader, dec); assert.equal(ev.players[2].name, 'Bob');
    assert.equal(ev.ranked, true);
    ac.abort();
  } finally { await close(); }
});
test('a session cookie is ignored on requests without a JSON content type', async () => {
  const { base, post, sid, close } = await bootAcc();
  try {
    const c = 'sid=' + sid(await post('/api/register', { username: 'Ann', password: 'password1' }));
    const r = await fetch(base + '/api/rooms', { method: 'POST', headers: { cookie: c, 'content-type': 'text/plain' }, body: JSON.stringify({ name: 'Eve' }) });
    const { code, token } = await r.json();
    const ac = new AbortController();
    const es = await fetch(`${base}/api/rooms/${code}/events?token=${token}`, { signal: ac.signal });
    const ev = await nextEvent(es.body.getReader(), new TextDecoder());
    assert.equal(ev.players[0].name, 'Eve');
    ac.abort();
  } finally { await close(); }
});
test('leaderboard and profile endpoints', async () => {
  const { base, post, stats, accounts, close } = await bootAcc();
  try {
    const a = accounts.register('Ann', 'password1').user, b = accounts.register('Bob', 'password1').user;
    stats.record({ players: [{ userId: a.id, name: 'Ann', total: 300, yahtzees: 1 }, { userId: b.id, name: 'Bob', total: 100, yahtzees: 0 }] });
    const lb = await (await fetch(base + '/api/leaderboard?board=wins&period=all')).json();
    assert.deepEqual(lb.rows.map(r => [r.rank, r.username, r.value]), [[1, 'Ann', 1], [2, 'Bob', 0]]);
    assert.equal((await fetch(base + '/api/leaderboard?board=bogus&period=all')).status, 400);
    assert.equal((await fetch(base + '/api/leaderboard')).status, 200);
    const p = await (await fetch(base + '/api/users/ann')).json(); assert.equal(p.best, 300);
    assert.equal((await fetch(base + '/api/users/ghost')).status, 404);
    assert.equal((await fetch(base + '/api/users/%')).status, 400);
  } finally { await close(); }
});
test('without accounts configured: /api/me says disabled and auth routes are 404', async () => {
  const { base, j, close } = await boot();
  try {
    assert.deepEqual(await (await fetch(base + '/api/me')).json(), { user: null, enabled: false });
    assert.equal((await j('/api/login', { username: 'a', password: 'b' })).status, 404);
    assert.equal((await fetch(base + '/api/leaderboard')).status, 404);
  } finally { await close(); }
});
