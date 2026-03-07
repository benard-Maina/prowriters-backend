const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const DB = path.join(__dirname, '..', 'prowriter.db');
const db = new sqlite3.Database(DB);

const name = 'Local Admin';
const email = 'local_admin@example.com';
const password = 'AdminPass123!';
const role = 'admin';
const country = 'Local';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';

function run() {
  const hashed = bcrypt.hashSync(password, 10);
  db.run("INSERT INTO users (name, email, password, role, country, approved) VALUES (?, ?, ?, ?, ?, 1)", [name, email, hashed, role, country], function(err){
    if (err) { console.error('Failed to create admin user', err); process.exit(1); }
    const id = this.lastID;
    const token = jwt.sign({ id, role, email }, JWT_SECRET, { expiresIn: '30d' });
    console.log(JSON.stringify({ id, email, password, token }));
    db.close();
  });
}

run();
