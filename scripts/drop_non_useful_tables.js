const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const projectRoot = path.resolve(__dirname, "..");
const dbPath = path.join(projectRoot, "prowriter.db");

const usefulTables = new Set([
  "users",
  "orders",
  "activity_logs",
  "notifications",
]);

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(projectRoot, `prowriter.backup.${stamp}.db`);
fs.copyFileSync(dbPath, backupPath);

console.log(`Backup created: ${backupPath}`);

const db = new sqlite3.Database(dbPath);

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      return resolve(rows || []);
    });
  });
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) return reject(err);
      return resolve();
    });
  });
}

async function main() {
  try {
    const rows = await allAsync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );

    const tableNames = rows.map((r) => r.name);
    const nonUseful = tableNames.filter((name) => !usefulTables.has(name));

    if (nonUseful.length === 0) {
      console.log("No non-useful tables found. Nothing to drop.");
      return;
    }

    for (const table of nonUseful) {
      // Quote identifiers safely for SQLite.
      const escaped = table.replace(/"/g, '""');
      await runAsync(`DROP TABLE IF EXISTS "${escaped}"`);
      console.log(`Dropped table: ${table}`);
    }

    console.log(`Dropped ${nonUseful.length} table(s).`);
  } catch (error) {
    console.error("Failed to remove non-useful tables:", error.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();
