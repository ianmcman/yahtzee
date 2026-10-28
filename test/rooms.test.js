const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomStore } = require('../server/rooms.js');

const seq = (...v) => { let i = 0; return () => (v[i++ % v.length] - 1) / 6 + 0.01; };
const mk = (o = {}) => createRoomStore(o);
const lobby = (s, n = 2) => {
  const h = s.create('Host'); const toks = [h.token];
  for (let i = 1; i < n; i++) toks.push(s.join(h.code, 'P' + i).token);
  return { code: h.code, toks };
};

test('create returns a 4 char code and a token; host sees an empty-game lobby', () => {
  const s = mk(); const r = s.create('  Ann  ');
  assert.match(r.code, /^[A-HJ-NP-Z2-9]{4}$/);
  assert.ok(r.token && typeof r.token === 'string');
  const v = s.view(r.code, r.token);
  assert.equal(v.phase, 'lobby'); assert.equal(v.host, true); assert.equal(v.you, 0);
  assert.deepEqual(v.players.map(p => p.name), ['Ann']);
  assert.equal(v.game, null);
});
test('names are trimmed, capped at 20 chars, and must not be empty', () => {
  const s = mk();
  assert.throws(() => s.create('   '));
  const r = s.create('x'.repeat(40));
  assert.equal(s.view(r.code, r.token).players[0].name.length, 20);
});
test('join adds a player, codes are case-insensitive, views never leak other tokens', () => {
  const s = mk(); const h = s.create('A'); const j = s.join(h.code.toLowerCase(), 'B');
  assert.notEqual(j.token, h.token);
  const v = s.view(h.code, j.token);
  assert.equal(v.you, 1); assert.equal(v.host, false);
  assert.deepEqual(v.players.map(p => p.name), ['A', 'B']);
  assert.ok(!JSON.stringify(v).includes(h.token));
});
test('join errors carry an http status', () => {
  const s = mk();
  assert.throws(() => s.join('ZZZZ', 'B'), { status: 404 });
  const { code } = lobby(s, 4);
  assert.throws(() => s.join(code, 'E'), { status: 409 });
});
test('bad tokens are rejected with 403', () => {
  const s = mk(); const h = s.create('A');
  assert.throws(() => s.view(h.code, 'nope'), { status: 403 });
  assert.throws(() => s.act(h.code, 'nope', { type: 'roll' }), { status: 403 });
  assert.throws(() => s.start(h.code, 'nope'), { status: 403 });
  assert.throws(() => s.view('ZZZZ', 'nope'), { status: 404 });
});
test('only the host can start, needs 2 players, and nobody can join afterwards', () => {
  const s = mk(); const h = s.create('A');
  assert.throws(() => s.start(h.code, h.token), { status: 409 });
  const j = s.join(h.code, 'B');
  assert.throws(() => s.start(h.code, j.token), { status: 403 });
  s.start(h.code, h.token);
  const v = s.view(h.code, h.token);
  assert.equal(v.phase, 'playing');
  assert.deepEqual(v.game.players.map(p => p.name), ['A', 'B']);
  assert.throws(() => s.join(h.code, 'C'), { status: 409 });
  assert.throws(() => s.start(h.code, h.token), { status: 409 });
});
test('only the current player can act; roll, hold and score go through game.js', () => {
  const s = mk({ rng: seq(6, 6, 1, 2, 3, 1, 1, 1, 1, 1) });
  const { code, toks } = lobby(s);
  s.start(code, toks[0]);
  assert.throws(() => s.act(code, toks[1], { type: 'roll' }), { status: 409 });
  s.act(code, toks[0], { type: 'roll' });
  assert.deepEqual(s.view(code, toks[1]).game.dice, [6, 6, 1, 2, 3]);
  s.act(code, toks[0], { type: 'hold', index: 0 });
  assert.equal(s.view(code, toks[0]).game.held[0], true);
  s.act(code, toks[0], { type: 'score', category: 'sixes' });
  const v = s.view(code, toks[1]);
  assert.equal(v.game.players[0].card.sixes, 12);
  assert.equal(v.game.current, 1);
});
test('illegal actions are 400, unknown action types are 400', () => {
  const s = mk(); const { code, toks } = lobby(s); s.start(code, toks[0]);
  assert.throws(() => s.act(code, toks[0], { type: 'score', category: 'chance' }), { status: 400 });
  assert.throws(() => s.act(code, toks[0], { type: 'explode' }), { status: 400 });
  assert.throws(() => s.act(code, toks[0], null), { status: 400 });
  assert.throws(() => s.act(code, toks[0], { type: 'hold', index: 0 }), { status: 400 });
});
test('acting in a lobby is 409', () => {
  const s = mk(); const { code, toks } = lobby(s);
  assert.throws(() => s.act(code, toks[0], { type: 'roll' }), { status: 409 });
});
test('a full game ends in phase over', () => {
  const s = mk(); const { code, toks } = lobby(s); s.start(code, toks[0]);
  const cats = ['ones','twos','threes','fours','fives','sixes','threeKind','fourKind','fullHouse','smallStraight','largeStraight','yahtzee','chance'];
  for (const c of cats) for (const t of toks) { s.act(code, t, { type: 'roll' }); s.act(code, t, { type: 'score', category: c }); }
  assert.equal(s.view(code, toks[0]).phase, 'over');
  assert.throws(() => s.act(code, toks[0], { type: 'roll' }), { status: 409 });
});
test('subscribers hear about join, start and act; unsubscribe stops it', () => {
  const s = mk(); const h = s.create('A'); let n = 0;
  const off = s.subscribe(h.code, () => n++);
  const j = s.join(h.code, 'B'); assert.equal(n, 1);
  s.start(h.code, h.token); assert.equal(n, 2);
  s.act(h.code, h.token, { type: 'roll' }); assert.equal(n, 3);
  off(); s.act(h.code, h.token, { type: 'hold', index: 0 }); assert.equal(n, 3);
  assert.ok(j.token);
});
test('sweep drops rooms idle for over 2 hours and keeps active ones', () => {
  let t = 1000; const s = mk({ now: () => t });
  const a = s.create('A'); const b = s.create('B');
  t += 3 * 3600e3; s.join(b.code, 'C');
  s.sweep();
  assert.throws(() => s.view(a.code, a.token), { status: 404 });
  assert.equal(s.view(b.code, b.token).players.length, 2);
});
