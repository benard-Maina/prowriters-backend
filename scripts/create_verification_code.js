const sqlite3 = require('sqlite3').verbose();
const path = require('path');
function generateCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
const email = process.argv[2] || 'brightpath190126@gmail.com';
const dbPath = path.join(__dirname, '..', 'prowriter.db');
const db = new sqlite3.Database(dbPath, (e) => { if (e) { console.error('DB open error', e); process.exit(3); } });

(async () => {
  try {
    const emailLower = String(email).trim().toLowerCase();
    db.get('SELECT id FROM users WHERE email = ?', [emailLower], (err, user) => {
      if (err) { console.error('DB error', err); process.exit(4); }
      if (!user) { console.error('User not found:', emailLower); process.exit(5); }
      const code = generateCode();
      const expires = Date.now() + (15*60*1000);
      db.run('INSERT INTO email_verifications (user_id, email, code, expires_at) VALUES (?, ?, ?, ?)', [user.id, emailLower, code, expires], function(err2) {
        if (err2) { console.error('Insert error', err2); process.exit(6); }
        console.log('New verification code for', emailLower, 'is:', code);
        console.log('It expires at (ms):', expires);
        process.exit(0);
      });
    });
  } catch (e) {
    console.error('Error', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
