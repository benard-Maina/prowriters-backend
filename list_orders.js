const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./prowriter.db');

db.all("SELECT id, title, client_id, status, payment_status, amount FROM orders ORDER BY id DESC LIMIT 10", (e, rows) => {
  if (e) { console.error('err', e); process.exit(2); }
  console.log(JSON.stringify(rows, null, 2));
  db.close();
});
