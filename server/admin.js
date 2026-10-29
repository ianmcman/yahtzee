// Manual account admin. Usage:
//   node server/admin.js reset-password <username> [new-password]   (prints a random one if omitted)
//   node server/admin.js list-users
const crypto = require('node:crypto');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createAccounts } = require('./accounts.js');

const db = new DatabaseSync(path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'yahtzee.db'));
const accounts = createAccounts({ db });
const [cmd, user, pw] = process.argv.slice(2);

if (cmd === 'reset-password' && user) {
  const next = pw || crypto.randomBytes(9).toString('base64url');
  accounts.setPassword(user, next);
  console.log(`Password for ${user} set to: ${next}`);
} else if (cmd === 'list-users') {
  for (const u of db.prepare('SELECT username, created_at FROM users ORDER BY id').all()) {
    console.log(`${u.username}\t${new Date(u.created_at).toISOString()}`);
  }
} else {
  console.error('usage: admin.js reset-password <username> [new-password] | list-users');
  process.exit(1);
}
