const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("prowriter.db");
const tables = ["users", "orders", "activity_logs", "notifications"];

let index = 0;
function next() {
  if (index >= tables.length) {
    db.close();
    return;
  }
  const table = tables[index++];
  db.get(`SELECT COUNT(*) AS count FROM ${table}`, (error, row) => {
    if (error) {
      console.log(`${table}: unavailable (${error.message})`);
    } else {
      console.log(`${table}: ${row.count}`);
    }
    next();
  });
}

next();
