const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("prowriter.db");

db.serialize(() => {
  db.run("DELETE FROM users WHERE role = 'admin' AND approved = 0", (error) => {
    if (error) console.error("Failed clearing pending admins:", error.message);
  });

  db.run("DELETE FROM activity_logs WHERE type = 'user.register_admin_pending'", (error) => {
    if (error) console.error("Failed clearing admin pending activity logs:", error.message);
  });

  db.run("DELETE FROM notifications WHERE type = 'user.register_admin_pending'", (error) => {
    if (error) console.error("Failed clearing admin pending notifications:", error.message);
  });

  db.close(() => {
    console.log("PENDING_ADMIN_VERIFICATION_CLEARED");
  });
});
