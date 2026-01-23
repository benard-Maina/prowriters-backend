const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
function generateCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function randPassword() { return 'P@ss' + Math.random().toString(36).slice(2,10) + '!'; }

const email = process.argv[2] || 'bylinorganization@gmail.com';
const nameArg = process.argv[3] || null;
const countryArg = process.argv[4] || 'Unknown';

const dbPath = path.join(__dirname, '..', 'prowriter.db');
const db = new sqlite3.Database(dbPath, (e) => { if (e) { console.error('DB open error', e); process.exit(3); } });

(async () => {
  try {
    const emailLower = String(email).trim().toLowerCase();
    const name = nameArg || emailLower.split('@')[0].replace(/[._]/g,' ').replace(/\d+/g,' ').trim() || 'Client';
    // check existing user
    db.get('SELECT id FROM users WHERE email = ?', [emailLower], (err, row) => {
      if (err) { console.error('DB error', err); process.exit(4); }
      if (row) {
        console.log('User already exists with id:', row.id);
        // still generate code for existing user
        const code = generateCode();
        const expires = Date.now() + (15*60*1000);
        db.get('SELECT id FROM users WHERE email = ?', [emailLower], (e2, u) => {
          db.run('INSERT INTO email_verifications (user_id, email, code, expires_at) VALUES (?, ?, ?, ?)', [u.id, emailLower, code, expires], function(e3) {
            if (e3) { console.error('Insert verification error', e3); process.exit(6); }
            console.log('Inserted verification code for existing user:', code);
            process.exit(0);
          });
        });
        return;
      }

      // create new user
      const password = randPassword();
      const hashed = bcrypt.hashSync(password, 10);
      db.run('INSERT INTO users (name,email,password,role,country,approved) VALUES (?, ?, ?, ?, ?, 0)', [name, emailLower, hashed, 'client', countryArg], function(insErr) {
        if (insErr) { console.error('User insert failed', insErr); process.exit(5); }
        const userId = this.lastID;
        const code = generateCode();
        const expires = Date.now() + (15*60*1000);
        db.run('INSERT INTO email_verifications (user_id, email, code, expires_at) VALUES (?, ?, ?, ?)', [userId, emailLower, code, expires], function(verErr) {
          if (verErr) { console.error('Verification insert failed', verErr); process.exit(6); }
          console.log('Created user id:', userId);
          console.log('Temporary password (please change):', password);
          console.log('Verification code:', code);
          console.log('Expires (ms):', expires);
          process.exit(0);
        });
      });
    });
  } catch (e) {
    console.error('Error', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
