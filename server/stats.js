const BOARDS = {
  wins: { value: 'SUM(gp.won)', filter: '' },
  winrate: { value: 'ROUND(100.0 * SUM(gp.won) / COUNT(*), 1)', filter: 'HAVING COUNT(*) >= 5' },
  best: { value: 'MAX(gp.total)', filter: '' },
  yahtzees: { value: 'SUM(gp.yahtzees)', filter: '' },
};
const WEEK_MS = 7 * 864e5;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function createStats({ db, now = () => Date.now() }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY,
      ended_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS game_players (
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      total INTEGER NOT NULL,
      yahtzees INTEGER NOT NULL,
      won INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS game_players_user ON game_players (user_id);
  `);

  const insertGame = db.prepare('INSERT INTO games (ended_at) VALUES (?)');
  const insertPlayer = db.prepare('INSERT INTO game_players (game_id, user_id, name, total, yahtzees, won) VALUES (?, ?, ?, ?, ?, ?)');

  function record({ players, endedAt = now() }) {
    const accounts = new Set(players.filter(p => p.userId != null).map(p => p.userId));
    if (accounts.size < 2) return { ranked: false };
    const top = Math.max(...players.map(p => p.total));
    db.exec('BEGIN');
    try {
      const gameId = Number(insertGame.run(endedAt).lastInsertRowid);
      for (const p of players) {
        insertPlayer.run(gameId, p.userId ?? null, p.name, p.total, p.yahtzees, p.total === top ? 1 : 0);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return { ranked: true };
  }

  function leaderboard(board, period) {
    const def = Object.prototype.hasOwnProperty.call(BOARDS, board) ? BOARDS[board] : null;
    if (!def) throw httpError(400, 'Unknown board');
    if (period !== 'all' && period !== 'week') throw httpError(400, 'Unknown period');
    const since = period === 'week' ? now() - WEEK_MS : 0;
    const rows = db.prepare(`
      SELECT u.username AS username, COUNT(*) AS games, ${def.value} AS value
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      JOIN users u ON u.id = gp.user_id
      WHERE g.ended_at >= ?
      GROUP BY gp.user_id
      ${def.filter}
      ORDER BY value DESC, u.username COLLATE NOCASE ASC
      LIMIT 20
    `).all(since);
    return rows.map((r, i) => {
      const better = rows.filter(o => o.value > r.value).length;
      return { rank: better + 1, username: r.username, value: r.value, games: r.games };
    });
  }

  function profile(username) {
    if (typeof username !== 'string') return null;
    const u = db.prepare('SELECT id, username, created_at FROM users WHERE username_lc = ?').get(username.toLowerCase());
    if (!u) return null;
    const t = db.prepare(`
      SELECT COUNT(*) AS games, COALESCE(SUM(won), 0) AS wins, COALESCE(MAX(total), 0) AS best, COALESCE(SUM(yahtzees), 0) AS yz
      FROM game_players WHERE user_id = ?
    `).get(u.id);
    const recent = db.prepare(`
      SELECT g.id AS id, g.ended_at AS endedAt, gp.total AS total, gp.won AS won
      FROM game_players gp JOIN games g ON g.id = gp.game_id
      WHERE gp.user_id = ? ORDER BY g.ended_at DESC, g.id DESC LIMIT 10
    `).all(u.id).map(r => ({
      endedAt: r.endedAt,
      total: r.total,
      won: r.won === 1,
      opponents: db.prepare('SELECT name FROM game_players WHERE game_id = ? AND (user_id IS NULL OR user_id != ?)').all(r.id, u.id).map(o => o.name),
    }));
    return {
      username: u.username,
      since: u.created_at,
      games: t.games,
      wins: t.wins,
      winRate: t.games ? Math.round((1000 * t.wins) / t.games) / 10 : 0,
      best: t.best,
      yahtzees: t.yz,
      recent,
    };
  }

  return { record, leaderboard, profile };
}

module.exports = { createStats };
