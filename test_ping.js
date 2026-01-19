const http = require('http');
const url = 'http://localhost:3000/api/ping';
http.get(url, (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('STATUS', res.statusCode);
    console.log('BODY', d);
    process.exit(0);
  });
}).on('error', e => { console.error('ERR', e.message); process.exit(2); });
