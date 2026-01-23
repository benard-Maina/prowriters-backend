const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const email = process.argv[2];
if (!email) { console.error('Usage: node get_verification_code.js <email>'); process.exit(2); }
const dbPath = path.join(__dirname, '..', 'prowriter.db');
const db = new sqlite3.Database(dbPath, (e) => { if (e) { console.error('DB open error', e); process.exit(3); } });

db.get(
  `SELECT id, email, code, expires_at, used, datetime(created_at) as created_at FROM email_verifications WHERE email = ? ORDER BY created_at DESC LIMIT 1`,
  [String(email).trim().toLowerCase()],
  (err, row) => {
    if (err) { console.error('Query error', err); process.exit(4); }
    if (!row) { console.log('No verification record found for', email); process.exit(0); }
    const now = Date.now();
    const expired = row.expires_at && Number(row.expires_at) < now;
    console.log('Verification record:');
    console.log(' id:', row.id);
    console.log(' email:', row.email);
    console.log(' code:', row.code);
    console.log(' used:', row.used);
    console.log(' expires_at (ms):', row.expires_at);
    console.log(' expired:', expired);
    console.log(' created_at:', row.created_at);
    db.close();
  }
);
