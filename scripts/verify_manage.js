// Usage:
// node scripts/verify_manage.js list
// node scripts/verify_manage.js approve user@example.com

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB = path.join(__dirname, '..', 'prowriter.db');
const db = new sqlite3.Database(DB);

const cmd = process.argv[2];
const arg = process.argv[3];

if (!cmd) {
  console.log('Provide a command: list | approve <email>');
  process.exit(1);
}

if (cmd === 'list') {
  db.all("SELECT id, name, email, role, approved FROM users WHERE approved = 0 ORDER BY id DESC", (err, rows) => {
    if (err) {
      console.error('DB error', err.message || err);
      process.exit(2);
    }
    if (!rows || rows.length === 0) {
      console.log('No unverified users found.');
      process.exit(0);
    }
    console.log('Unverified users:');
    rows.forEach(r => console.log(`${r.id}\t${r.email}\t${r.name}\trole=${r.role}`));
    process.exit(0);
  });
} else if (cmd === 'approve') {
  if (!arg) {
    console.error('Please supply an email to approve: approve user@example.com');
    process.exit(1);
  }
  const email = String(arg).trim().toLowerCase();
  db.get('SELECT id, name, email, approved FROM users WHERE email = ?', [email], (err, user) => {
    if (err) { console.error('DB error', err.message || err); process.exit(2); }
    if (!user) { console.error('User not found:', email); process.exit(3); }
    if (user.approved) { console.log('User already approved:', email); process.exit(0); }
    db.run('UPDATE users SET approved = 1 WHERE id = ?', [user.id], function (uerr) {
      if (uerr) { console.error('Failed to approve user', uerr.message || uerr); process.exit(4); }
      console.log('Approved user:', email);
      process.exit(0);
    });
  });
} else {
  console.log('Unknown command:', cmd);
  process.exit(1);
}
