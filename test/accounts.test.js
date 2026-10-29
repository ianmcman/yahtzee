const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createAccounts } = require('../server/accounts.js');

const mk = (o = {}) => { const db = new DatabaseSync(':memory:'); return { db, a: createAccounts({ db, ...o }) }; };

test('register returns the user and a session id that resolves back to the user', () => {
  const { a } = mk();
  const r = a.register('Ian_M', 'correct horse');
  assert.equal(r.user.username, 'Ian_M');
  assert.match(r.sid, /^[a-f0-9]{64}$/);
  assert.deepEqual(a.userForSession(r.sid), r.user);
  assert.equal(a.userForSession('nope'), null);
  assert.equal(a.userForSession(undefined), null);
});
test('username and password rules give 400', () => {
  const { a } = mk();
  for (const u of ['ab', 'x'.repeat(21), 'has space', 'bad!char', '', null, 5]) assert.throws(() => a.register(u, 'longenough'), { status: 400 }, String(u));
  for (const p of ['short', 'x'.repeat(129), '', null, 12345678]) assert.throws(() => a.register('valid_name', p), { status: 400 }, String(p));
  assert.doesNotThrow(() => a.register('a-b_c', 'x'.repeat(128)));
});
test('usernames are unique ignoring case', () => {
  const { a } = mk();
  a.register('Ian', 'password1');
  assert.throws(() => a.register('IAN', 'password2'), { status: 409 });
});
test('login works, and wrong password and unknown user both give the same 401', () => {
  const { a } = mk();
  a.register('Ian', 'password1');
  const ok = a.login('ian', 'password1');
  assert.equal(ok.user.username, 'Ian');
  assert.throws(() => a.login('Ian', 'wrongpass1'), { status: 401 });
  let m1, m2;
  try { a.login('Ian', 'wrongpass1'); } catch (e) { m1 = e.message; }
  try { a.login('nobody', 'wrongpass1'); } catch (e) { m2 = e.message; assert.equal(e.status, 401); }
  assert.equal(m1, m2);
});
test('passwords are stored hashed, not in plaintext', () => {
  const { a, db } = mk();
  a.register('Ian', 'my secret pw');
  assert.ok(!JSON.stringify(db.prepare('select * from users').all()).includes('my secret pw'));
});
test('5 failed logins lock the account for 15 minutes, even for the right password', () => {
  let t = 1e12; const { a } = mk({ now: () => t });
  a.register('Ian', 'password1');
  for (let i = 0; i < 5; i++) assert.throws(() => a.login('Ian', 'bad-pass-' + i), { status: 401 });
  assert.throws(() => a.login('Ian', 'password1'), { status: 429 });
  t += 16 * 60e3;
  assert.equal(a.login('Ian', 'password1').user.username, 'Ian');
});
test('sessions expire after 30 days and logout ends them', () => {
  let t = 1e12; const { a } = mk({ now: () => t });
  const r = a.register('Ian', 'password1');
  t += 29 * 864e5; assert.ok(a.userForSession(r.sid));
  t += 2 * 864e5; assert.equal(a.userForSession(r.sid), null);
  const l = a.login('Ian', 'password1'); a.logout(l.sid); assert.equal(a.userForSession(l.sid), null);
});
test('setPassword resets the password and signs the user out everywhere', () => {
  const { a } = mk();
  const r = a.register('Ian', 'password1');
  a.setPassword('ian', 'brand-new-pw');
  assert.equal(a.userForSession(r.sid), null);
  assert.throws(() => a.login('Ian', 'password1'), { status: 401 });
  assert.equal(a.login('Ian', 'brand-new-pw').user.username, 'Ian');
  assert.throws(() => a.setPassword('ghost', 'whatever123'), { status: 404 });
});
test('session ids are unique', () => {
  const { a } = mk();
  a.register('Ian', 'password1');
  assert.notEqual(a.login('Ian', 'password1').sid, a.login('Ian', 'password1').sid);
});
test('lockout is per username and client address, so a stranger cannot lock you out', () => {
  let t = 1e12; const { a } = mk({ now: () => t });
  a.register('Ian', 'password1');
  for (let i = 0; i < 5; i++) assert.throws(() => a.login('Ian', 'bad-pass-' + i, { ip: '203.0.113.9' }), { status: 401 });
  assert.throws(() => a.login('Ian', 'password1', { ip: '203.0.113.9' }), { status: 429 });
  assert.equal(a.login('Ian', 'password1', { ip: '198.51.100.7' }).user.username, 'Ian');
});
test('exists checks usernames ignoring case and surrounding spaces', () => {
  const { a } = mk();
  a.register('Ann', 'password1');
  assert.equal(a.exists('ann'), true); assert.equal(a.exists('  ANN '), true);
  assert.equal(a.exists('Bob'), false); assert.equal(a.exists(null), false);
});
test('a distributed guesser is stopped: 30 failures from different addresses lock the username for everyone', () => {
  let t = 1e12; const { a } = mk({ now: () => t });
  a.register('Ian', 'password1');
  for (let i = 0; i < 30; i++) assert.throws(() => a.login('Ian', 'bad-pass-' + i, { ip: '198.51.100.' + i }), { status: 401 });
  assert.throws(() => a.login('Ian', 'password1', { ip: '203.0.113.200' }), { status: 429 });
  t += 16 * 60e3;
  assert.equal(a.login('Ian', 'password1', { ip: '203.0.113.200' }).user.username, 'Ian');
});

test('the owner can still sign in from an address they used before while the username cap is hit, and success clears it', () => {
  let t = 1e12; const { a } = mk({ now: () => t });
  a.register('Ian', 'password1');
  a.login('Ian', 'password1', { ip: '203.0.113.5' });
  for (let i = 0; i < 30; i++) assert.throws(() => a.login('Ian', 'bad-pass-' + i, { ip: '198.51.100.' + i }), { status: 401 });
  assert.throws(() => a.login('Ian', 'password1', { ip: '203.0.113.99' }), { status: 429 });
  assert.equal(a.login('Ian', 'password1', { ip: '203.0.113.5' }).user.username, 'Ian');
  assert.equal(a.login('Ian', 'password1', { ip: '203.0.113.99' }).user.username, 'Ian');
});
