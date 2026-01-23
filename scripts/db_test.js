const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'prowriter.db');
const db = new sqlite3.Database(dbPath, (e) => { if (e) { console.error('DB open error', e); process.exit(2); } });

(async () => {
  try {
    // insert a test user
    const run = (sql, params) => new Promise((resolve, reject) => db.run(sql, params, function(err) { if (err) return reject(err); resolve(this); }));
    const get = (sql, params) => new Promise((resolve, reject) => db.get(sql, params, (err,row) => { if (err) return reject(err); resolve(row); }));

    const name = 'DB Test Client';
    const email = 'dbtest@example.com';
    const pwd = 'irrelevant';
    const country = 'Nowhere';

    await run('INSERT INTO users (name,email,password,role,country,approved) VALUES (?,?,?,?,?,1)', [name, email, pwd, 'client', country]);
    const user = await get('SELECT id FROM users WHERE email = ?', [email]);
    if (!user) throw new Error('Failed to create user');
    console.log('Created user id:', user.id);

    const submission_date = new Date().toISOString().slice(0,10);
    const expected_ready = new Date(Date.now() + 3600*1000*24).toISOString();

    await run('INSERT INTO orders (title,description,client_id,submission_date,expected_ready) VALUES (?,?,?,?,?)', ['DB Test Order','Inserted by script', user.id, submission_date, expected_ready]);
    const ord = await get('SELECT id, title, submission_date, expected_ready FROM orders WHERE client_id = ? ORDER BY id DESC LIMIT 1', [user.id]);
    console.log('Inserted order:', ord);

    console.log('DB test completed successfully');
    db.close();
  } catch (e) {
    console.error('DB test error', e && e.message ? e.message : e);
    db.close();
    process.exit(1);
  }
})();
