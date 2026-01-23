(async () => {
  const http = require('http');
  const https = require('https');
  const { URL } = require('url');
  const sqlite3 = require('sqlite3').verbose();
  const util = require('util');
  const path = require('path');
  const dbPath = path.join(__dirname, '..', 'prowriter.db');
  // start the server in-process so we don't depend on external terminal state
  require(path.join(__dirname, '..', 'server.js'));
  const base = 'http://127.0.0.1:3000';
  const email = 'testclient@example.com';
  try {
    async function httpJson(url, method, body) {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const payload = body ? JSON.stringify(body) : null;
      const opts = { method, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + (u.search || ''), headers: { 'Content-Type': 'application/json' } };
      if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
      return new Promise((resolve, reject) => {
        const req = lib.request(opts, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            let parsed = null;
            try { parsed = JSON.parse(data || '{}'); } catch (e) { parsed = data || null; }
            resolve({ status: res.statusCode, body: parsed });
          });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
      });
    }

    console.log('Registering test user...');
    const reg = await httpJson(`${base}/api/register`, 'POST', { name: 'Test Client', email, password: 'Test1234!', country: 'Testland' });
    console.log('Register response:', reg.status, reg.body);

    // wait a moment for DB insert
    await new Promise(r => setTimeout(r, 800));

    const db = new sqlite3.Database(dbPath);
    const get = util.promisify(db.get.bind(db));
    const row = await get('SELECT id FROM users WHERE email = ?', [email]);
    if (!row || !row.id) {
      console.error('User not found in DB');
      db.close();
      process.exit(2);
    }
    const clientId = row.id;
    console.log('Found user id:', clientId);

    // submit an order
    const today = new Date();
    const submission_date = today.toISOString().slice(0,10);
    const expected = new Date(Date.now() + 2*24*3600*1000).toISOString();
    console.log('Creating order...');
    const orderResp = await fetch(`${base}/api/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test Order', description: 'Automated test order', client_id: clientId, submission_date, expected_ready: expected })
    });
    const orderJson = await orderResp.json().catch(() => null);
    console.log('Order response:', orderResp.status, orderJson);
    db.close();
  } catch (e) {
    console.error('Script error', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
