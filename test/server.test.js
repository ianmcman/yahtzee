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
