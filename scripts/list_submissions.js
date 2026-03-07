const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('prowriter.db', (err) => {
  if (err) { console.error('DB open error', err); process.exit(1); }
  db.all("SELECT id, title, submission_file, status, payment_status, created_at FROM orders WHERE submission_file IS NOT NULL ORDER BY id DESC LIMIT 50", (e, rows) => {
    if (e) { console.error('Query error', e); db.close(); process.exit(1); }
    console.log(JSON.stringify(rows, null, 2));
    db.close();
  });
});
