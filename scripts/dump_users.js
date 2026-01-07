const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, '..', 'prowriter.db'));

db.all('SELECT id, name, email, role, approved FROM users', (err, rows) => {
  if (err) {
    console.error('ERR', err);
    process.exit(1);
  }
  console.log(JSON.stringify(rows, null, 2));
  db.close();
});
