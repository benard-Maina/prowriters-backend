const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./prowriter.db');
const email = 'local_admin@example.com';
db.get('SELECT id, email, role, approved FROM users WHERE email = ?', [email], (err, row) => {
  if (err) { console.error('err', err); process.exit(1); }
  console.log(JSON.stringify(row || null));
  db.close();
});
