const path = require('path');
const http = require('http');
const https = require('https');
// start server in-process
require(path.join(__dirname, '..', 'server.js'));
const base = 'http://127.0.0.1:3000';
function httpJson(url, method, body) {
  const u = new URL(url);
  const lib = u.protocol === 'https:' ? https : http;
  const opts = { method, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + (u.search || ''), headers: { 'Content-Type': 'application/json' } };
  if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
  return new Promise((resolve, reject) => {
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
  let parsed = null;
  try { parsed = JSON.parse(data || '{}'); } catch (e) { parsed = data || null; }
  resolve({ status: res.statusCode, body: parsed });
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
(async () => {
  try {
    console.log('Calling /api/resend-verification for brightpath190126@gmail.com');
    const resp = await httpJson(`${base}/api/resend-verification`, 'POST', { email: 'brightpath190126@gmail.com' });
    console.log('Response:', resp.status, resp.body);
    process.exit(0);
  } catch (e) {
    console.error('Test error', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
(async () => {
  const path = require('path');
  const http = require('http');
  const https = require('https');
  const { URL } = require('url');

  // start server in-process
  require(path.join(__dirname, '..', 'server.js'));
  const base = 'http://127.0.0.1:3000';

  function httpJson(url, method, body) {
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

  try {
    console.log('Calling /api/resend-verification for brightpath190126@gmail.com');
    const resp = await httpJson(`${base}/api/resend-verification`, 'POST', { email: 'brightpath190126@gmail.com' });
    console.log('Response:', resp.status, resp.body);
  } catch (e) {
    console.error('Test error', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
