const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createAccounts } = require('../server/accounts.js');
const { createStats } = require('../server/stats.js');

function setup(o = {}) {
  const db = new DatabaseSync(':memory:');
  const accounts = createAccounts({ db, ...o });
  const stats = createStats({ db, ...o });
  const u = n => accounts.register(n, 'password-' + n).user;
  return { db, accounts, stats, u };
}
const P = (user, total, yahtzees = 0) => ({ userId: user ? user.id : null, name: user ? user.username : 'Guest', total, yahtzees });

test('a game with fewer than 2 distinct accounts is not ranked and is not stored', () => {
  const { stats, u } = setup(); const a = u('Ann');
  assert.deepEqual(stats.record({ players: [P(a, 200), P(null, 100)] }), { ranked: false });
  assert.deepEqual(stats.record({ players: [P(a, 200), P(a, 100)] }), { ranked: false });
  assert.deepEqual(stats.leaderboard('wins', 'all'), []);
  assert.equal(stats.profile('Ann').games, 0);
});
test('a ranked game updates wins, best score and yahtzees; ties count as wins for both', () => {
  const { stats, u } = setup(); const a = u('Ann'), b = u('Bob');
  assert.deepEqual(stats.record({ players: [P(a, 250, 1), P(b, 180)] }), { ranked: true });
  stats.record({ players: [P(a, 200), P(b, 200, 2)] });
  const wins = stats.leaderboard('wins', 'all');
  assert.deepEqual(wins.map(r => [r.rank, r.username, r.value, r.games]), [[1, 'Ann', 2, 2], [2, 'Bob', 1, 2]]);
  assert.deepEqual(stats.leaderboard('best', 'all').map(r => [r.username, r.value]), [['Ann', 250], ['Bob', 200]]);
  assert.deepEqual(stats.leaderboard('yahtzees', 'all').map(r => [r.username, r.value]), [['Bob', 2], ['Ann', 1]]);
});
test('rank is shared on equal values and the next rank skips', () => {
  const { stats, u } = setup(); const a = u('Ann'), b = u('Bob'), c = u('Cyd');
  stats.record({ players: [P(a, 300), P(b, 200), P(c, 100)] });
  stats.record({ players: [P(b, 300), P(a, 200), P(c, 100)] });
  const w = stats.leaderboard('wins', 'all');
  assert.deepEqual(w.map(r => [r.rank, r.username]), [[1, 'Ann'], [1, 'Bob'], [3, 'Cyd']]);
});
test('win rate needs 5 games', () => {
  const { stats, u } = setup(); const a = u('Ann'), b = u('Bob');
  for (let i = 0; i < 4; i++) stats.record({ players: [P(a, 300), P(b, 100)] });
  assert.deepEqual(stats.leaderboard('winrate', 'all'), []);
  stats.record({ players: [P(a, 100), P(b, 300)] });
  const r = stats.leaderboard('winrate', 'all');
  assert.deepEqual(r.map(x => [x.username, x.value]), [['Ann', 80], ['Bob', 20]]);
});
test('the weekly board only counts games from the last 7 days', () => {
  let t = 1e12; const { stats, u } = setup({ now: () => t }); const a = u('Ann'), b = u('Bob');
  stats.record({ players: [P(a, 300), P(b, 100)] });
  t += 8 * 864e5;
  stats.record({ players: [P(b, 300), P(a, 100)] });
  assert.deepEqual(stats.leaderboard('wins', 'week').map(r => [r.username, r.value, r.games]), [['Bob', 1, 1], ['Ann', 0, 1]]);
  assert.equal(stats.leaderboard('wins', 'all').length, 2);
});
test('leaderboard rejects unknown boards and periods and caps at 20 rows', () => {
  const { stats, u } = setup();
  assert.throws(() => stats.leaderboard('nope', 'all'), { status: 400 });
  assert.throws(() => stats.leaderboard('wins', 'year'), { status: 400 });
  const main = u('Main');
  for (let i = 0; i < 25; i++) stats.record({ players: [P(main, 300), P(u('Player' + i), 100)] });
  assert.equal(stats.leaderboard('best', 'all').length, 20);
});
test('profile has totals, win rate, best, yahtzees and recent games; unknown user is null', () => {
  const { stats, u } = setup(); const a = u('Ann'), b = u('Bob');
  stats.record({ players: [P(a, 250, 1), P(b, 180)] });
  stats.record({ players: [P(a, 100), P(b, 190)] });
  const p = stats.profile('ann');
  assert.equal(p.username, 'Ann');
  assert.deepEqual([p.games, p.wins, p.winRate, p.best, p.yahtzees], [2, 1, 50, 250, 1]);
  assert.equal(p.recent.length, 2);
  assert.deepEqual(Object.keys(p.recent[0]).sort(), ['endedAt', 'opponents', 'total', 'won']);
  assert.deepEqual(p.recent[0].opponents, ['Bob']);
  assert.equal(stats.profile('ghost'), null);
});
