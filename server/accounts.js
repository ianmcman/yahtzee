const crypto = require('node:crypto');

const USER_RE = /^[A-Za-z0-9_-]{3,20}$/;
const SESSION_MS = 30 * 864e5;
const LOCK_FAILS = 5;
const LOCK_MS = 15 * 60e3;
const USER_LOCK_FAILS = 30;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function hashPassword(pw, salt = crypto.randomBytes(16)) {
  const hash = crypto.scryptSync(pw, salt, 32);
  return `s1$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const [, saltHex, hashHex] = stored.split('$');
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

function checkUsername(u) {
  if (typeof u !== 'string' || !USER_RE.test(u)) {
    throw httpError(400, 'Username must be 3 to 20 letters, digits, _ or -');
  }
}

function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 8 || p.length > 128) {
    throw httpError(400, 'Password must be 8 to 128 characters');
  }
}

function createAccounts({ db, now = () => Date.now() }) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      username_lc TEXT NOT NULL UNIQUE,
      pw TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
  `);

  const insertUser = db.prepare('INSERT INTO users (username, username_lc, pw, created_at) VALUES (?, ?, ?, ?)');
  const byName = db.prepare('SELECT id, username, pw FROM users WHERE username_lc = ?');
  const insertSession = db.prepare('INSERT INTO sessions (sid, user_id, expires_at) VALUES (?, ?, ?)');
  const getSession = db.prepare('SELECT s.sid, s.expires_at, u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.sid = ?');
  const delSession = db.prepare('DELETE FROM sessions WHERE sid = ?');
  const delUserSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?');
  const setPw = db.prepare('UPDATE users SET pw = ? WHERE id = ?');

  const failures = new Map();
  const knownIps = new Map(); // username_lc -> recent IPs with a successful login (memory only)
  const dummy = hashPassword('dummy-password');

  function newSession(userId) {
    const sid = crypto.randomBytes(32).toString('hex');
    insertSession.run(sid, userId, now() + SESSION_MS);
    return sid;
  }

  function recentFailures(key) {
    const cutoff = now() - LOCK_MS;
    if (failures.size > 5000) {
      for (const [k, v] of failures) if (!v.some(t => t > cutoff)) failures.delete(k);
    }
    const list = (failures.get(key) || []).filter(t => t > cutoff);
    failures.set(key, list);
    return list;
  }

  function register(username, password) {
    checkUsername(username);
    checkPassword(password);
    let id;
    try {
      id = Number(insertUser.run(username, username.toLowerCase(), hashPassword(password), now()).lastInsertRowid);
    } catch (err) {
      if (/UNIQUE/i.test(err.message)) throw httpError(409, 'Username is taken');
      throw err;
    }
    return { user: { id, username }, sid: newSession(id) };
  }

  function login(username, password, { ip = '' } = {}) {
    const lc = typeof username === 'string' ? username.toLowerCase() : '';
    const key = `${ip}|${lc}`;
    const userKey = `*|${lc}`;
    if (recentFailures(key).length >= LOCK_FAILS || (recentFailures(userKey).length >= USER_LOCK_FAILS && !(knownIps.get(lc) || new Set()).has(ip))) {
      throw httpError(429, 'Too many failed attempts. Try again later.');
    }
    const row = typeof username === 'string' && typeof password === 'string' ? byName.get(username.toLowerCase()) : null;
    const ok = row ? verifyPassword(password, row.pw) : (verifyPassword('x', dummy), false);
    if (!ok) {
      recentFailures(key).push(now());
      recentFailures(userKey).push(now());
      throw httpError(401, 'Wrong username or password');
    }
    failures.delete(key);
    const ips = knownIps.get(lc) || new Set();
    ips.delete(ip);
    ips.add(ip);
    if (ips.size > 10) ips.delete(ips.values().next().value);
    knownIps.set(lc, ips);
    return { user: { id: row.id, username: row.username }, sid: newSession(row.id) };
  }

  function userForSession(sid) {
    if (typeof sid !== 'string' || !/^[a-f0-9]{64}$/.test(sid)) return null;
    const row = getSession.get(sid);
    if (!row) return null;
    if (row.expires_at <= now()) {
      delSession.run(sid);
      return null;
    }
    return { id: row.id, username: row.username };
  }

  function logout(sid) {
    if (typeof sid === 'string') delSession.run(sid);
  }

  function setPassword(username, password) {
    checkPassword(password);
    const row = typeof username === 'string' ? byName.get(username.toLowerCase()) : null;
    if (!row) throw httpError(404, 'No such user');
    setPw.run(hashPassword(password), row.id);
    delUserSessions.run(row.id);
    for (const k of failures.keys()) if (k.endsWith('|' + username.toLowerCase())) failures.delete(k);
    knownIps.delete(username.toLowerCase());
  }

  function exists(name) {
    return typeof name === 'string' && Boolean(byName.get(name.trim().toLowerCase()));
  }

  return { register, login, userForSession, logout, setPassword, exists };
}

module.exports = { createAccounts };
