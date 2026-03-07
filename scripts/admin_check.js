const http = require('http');

function postJson(path, body, headers = {}){
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = { hostname: 'localhost', port: 3000, path, method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, headers) };
    const req = http.request(opts, (res) => {
      let out = '';
      res.on('data', d=> out += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(out || '{}') }); }
        catch(e){ resolve({ status: res.statusCode, body: out }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(path, token){
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const opts = { hostname: 'localhost', port: 3000, path, method: 'GET', headers };
    const req = http.request(opts, (res) => {
      let out = '';
      res.on('data', d=> out += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(out || '{}') }); }
        catch(e){ resolve({ status: res.statusCode, body: out }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run(){
  try{
    console.log('Logging in as local_admin@example.com');
    const login = await postJson('/api/login', { email: 'local_admin@example.com', password: 'AdminPass123!' });
    console.log('Login status', login.status);
    console.log('Login response:', login.body);
    if (!login.body || !login.body.token) {
      console.error('No token returned; aborting.');
      process.exit(login.status || 1);
    }
    const token = login.body.token;
    console.log('\nFetching /api/admin/activity with token...');
    const act = await getJson(`/api/admin/activity?limit=50`, token);
    console.log('Activity status', act.status);
    console.log('Activity response:', JSON.stringify(act.body, null, 2));
  }catch(err){
    console.error('Error during check', err);
    process.exit(1);
  }
}

run();
