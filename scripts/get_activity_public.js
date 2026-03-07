const http = require('http');

function get(path, headers={}){
  return new Promise((resolve,reject)=>{
    const opts = { hostname: 'localhost', port: 3000, path, method: 'GET', headers };
    const req = http.request(opts, (res)=>{
      let out=''; res.on('data', d=> out+=d); res.on('end', ()=> resolve({status: res.statusCode, body: out}));
    });
    req.on('error', reject); req.end();
  });
}

(async ()=>{
  try{
    const r = await get('/api/admin/activity?limit=5');
    console.log('Status', r.status);
    console.log(r.body);
  }catch(e){ console.error('Failed', e); process.exit(1); }
})();
