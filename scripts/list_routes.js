const http = require('http');

function get(path){
  return new Promise((resolve,reject)=>{
    const opts = { hostname: 'localhost', port: 3000, path, method: 'GET' };
    const req = http.request(opts, (res)=>{
      let out=''; res.on('data', d=> out+=d); res.on('end', ()=> resolve({status: res.statusCode, body: out}));
    });
    req.on('error', reject); req.end();
  });
}

(async ()=>{
  try{
    const r = await get('/__routes');
    console.log('Status', r.status);
    console.log(r.body);
  }catch(e){ console.error('Failed', e); process.exit(1); }
})();
