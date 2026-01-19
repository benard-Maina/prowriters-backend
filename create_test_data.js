const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./prowriter.db');

function run() {
  db.serialize(() => {
    db.run("INSERT INTO users (name, email, password, role, country, approved) VALUES (?, ?, ?, ?, ?, 1)", ['Test Client','testclient@example.com','x','client','KE'], function(err){
      if(err){ console.error('user insert err', err); return; }
      const userId = this.lastID;
      console.log('Created user id', userId);
      db.run("INSERT INTO orders (title, description, client_id, amount, payment_status) VALUES (?, ?, ?, ?, 'unpaid')", ['Test Order','Test desc', userId, 5.00], function(err2){
        if(err2){ console.error('order insert err', err2); return; }
        console.log('Created order id', this.lastID);
        db.close();
      });
    });
  });
}
run();
