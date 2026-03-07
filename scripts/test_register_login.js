const http = require('http');

function postJson(path, body){
  return new Promise((resolve,reject)=>{
    const data = JSON.stringify(body);
    const opts = { hostname: 'localhost', port: 3000, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
    const req = http.request(opts, (res)=>{
      let out=''; res.on('data', d=> out+=d); res.on('end', ()=>{
        try{ resolve({status: res.statusCode, body: JSON.parse(out||'{}')}); }catch(e){ resolve({status: res.statusCode, body: out}); }
      });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

(async ()=>{
  try{
    const email = `temp_user_${Date.now()}@example.com`;
    const password = 'TestPass123!';
    console.log('Registering', email);
    const reg = await postJson('/api/register', { name: 'Temp User', email, password, role: 'client', country: 'Testland' });
    console.log('Register:', reg.status, reg.body);
    console.log('Logging in...');
    const login = await postJson('/api/login', { email, password });
    console.log('Login:', login.status, login.body);
  }catch(e){ console.error('Test failed', e); process.exit(1); }
})();
