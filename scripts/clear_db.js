const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("prowriter.db");

db.serialize(() => {
  const tables = ["notifications", "activity_logs", "orders", "users"];

  for (const table of tables) {
    db.run(`DELETE FROM ${table}`, (error) => {
      if (error && !/no such table/i.test(String(error.message || ""))) {
        console.error(`Failed clearing ${table}:`, error.message);
      }
    });
  }

  db.run(
    "DELETE FROM sqlite_sequence WHERE name IN ('users','orders','activity_logs','notifications')",
    (error) => {
      if (error && !/no such table/i.test(String(error.message || ""))) {
        console.error("Failed resetting sequences:", error.message);
      }
      db.close(() => {
        console.log("DB_CLEARED");
      });
    }
  );
});
