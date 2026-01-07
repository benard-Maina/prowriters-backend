// ===== server.js =====
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const { exec } = require('child_process');
const multer = require("multer");
const cors = require("cors");

const app = express();
const PORT = 3000;

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
// Re-enable direct static serving of uploads for now (removing access restrictions)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// ===== MULTER CONFIG =====
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage });

// Ensure previews folder exists
const previewDir = path.join(uploadDir, 'previews');
if (!fs.existsSync(previewDir)) fs.mkdirSync(previewDir, { recursive: true });

// ===== DATABASE =====
const DB_PATH = path.join(__dirname, "prowriter.db");
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("❌ Database connection error:", err.message);
    process.exit(1);
  }
  console.log("✅ Connected to SQLite database.");
});

// Enable foreign keys
db.run("PRAGMA foreign_keys = ON");

// ===== CREATE TABLES =====
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'client',
      country TEXT,
      approved INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      client_id INTEGER,
      writer_id INTEGER,
      status TEXT DEFAULT 'Pending Assignment',
      submission_file TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (writer_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
});

// ===== ROOT ROUTE =====
app.get("/", (_, res) => {
  res.send("✅ ProWriter Solutions backend running successfully!");
});

// Simple health check for debugging
app.get('/api/ping', (_, res) => {
  res.json({ message: 'pong' });
});

// ==========================
// 👤 USER ROUTES
// ==========================

// Register (needs admin approval)
app.post("/api/register", (req, res) => {
  const { name, email, password, role, country } = req.body;
  console.log('Register attempt:', { name, email, role, country });
  if (!name || !email || !password || !country)
    return res.status(400).json({ message: "Missing required fields" });

  // Auto-approve registrations (no admin approval step)
  db.run(
    `INSERT INTO users (name, email, password, role, country, approved)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [name, email, password, role || "client", country],
    function (err) {
      if (err) return res.status(500).json({ message: "Registration failed" });
      res.json({ message: "Registration successful" });
    }
  );
});

// Login (only approved users)
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  console.log('Login attempt:', { email });
  // Allow login without requiring admin approval
  db.get(
    "SELECT * FROM users WHERE email = ? AND password = ?",
    [email, password],
    (err, user) => {
      if (err) return res.status(500).json({ message: "Server error" });
      if (!user) return res.status(401).json({ message: "Invalid account" });
      res.json(user);
    }
  );
});

// Get unapproved users (for admin)
app.get("/api/pending-users", (_, res) => {
  db.all("SELECT * FROM users WHERE approved = 0", (err, rows) => {
    if (err) return res.status(500).json({ message: "Failed to fetch" });
    res.json(rows);
  });
});

// Approve user
app.post("/api/approve-user/:id", (req, res) => {
  db.run("UPDATE users SET approved = 1 WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ message: "Approval failed" });
    res.json({ message: "User approved successfully" });
  });
});

// ==========================
// 🧾 ORDER ROUTES
// ==========================

// Create new order (client)
app.post("/api/orders", (req, res) => {
  const { title, description, client_id } = req.body;
  if (!title || !description || !client_id)
    return res.status(400).json({ message: "Missing required fields" });

  db.run(
    `INSERT INTO orders (title, description, client_id)
     VALUES (?, ?, ?)`,
    [title, description, client_id],
    function (err) {
      if (err) return res.status(500).json({ message: "Failed to submit order" });
      res.json({ message: "Order submitted successfully" });
    }
  );
});

// Fetch all orders (admin)
app.get("/api/orders", (_, res) => {
  db.all(
    `
    SELECT o.*, 
           c.name AS client_name,
           w.name AS writer_name
    FROM orders o
    LEFT JOIN users c ON o.client_id = c.id
    LEFT JOIN users w ON o.writer_id = w.id
    ORDER BY o.created_at DESC
    `,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ message: "Failed to fetch orders" });
      res.json(rows);
    }
  );
});

// Fetch unassigned jobs (for writers)
app.get("/api/unassigned-orders", (_, res) => {
  db.all(
    "SELECT * FROM orders WHERE writer_id IS NULL AND status = 'Pending Assignment'",
    (err, rows) => {
      if (err) return res.status(500).json({ message: "Failed to fetch unassigned orders" });
      res.json(rows);
    }
  );
});

// Fetch assigned jobs for a specific writer
app.get("/api/assigned-orders/:writer_id", (req, res) => {
  db.all(
    `SELECT * FROM orders WHERE writer_id = ? ORDER BY created_at DESC`,
    [req.params.writer_id],
    (err, rows) => {
      if (err) return res.status(500).json({ message: "Failed to fetch assigned orders" });
      res.json(rows);
    }
  );
});

// Assign job to writer
app.post("/api/assign", (req, res) => {
  const { orderId, writerId } = req.body;
  if (!orderId || !writerId)
    return res.status(400).json({ message: "Missing order or writer ID" });

  // Optional admin verification
  const { adminId } = req.body;
  function proceedAssign() {
    // Check if writer already has an active order (In Progress)
    db.get(
      "SELECT id FROM orders WHERE writer_id = ? AND status = 'In Progress'",
      [writerId],
      (err, active) => {
        if (err) return res.status(500).json({ message: "Server error" });
        if (active)
          return res.status(400).json({ message: "Writer already has an active order" });

        // Ensure the order exists and is unassigned
        db.get("SELECT writer_id, status FROM orders WHERE id = ?", [orderId], (err2, order) => {
          if (err2) return res.status(500).json({ message: "Server error" });
          if (!order) return res.status(404).json({ message: "Order not found" });
          if (order.writer_id)
            return res.status(400).json({ message: "Order already assigned" });
          if (order.status !== 'Pending Assignment')
            return res.status(400).json({ message: "Order not available for assignment" });

          db.run(
            "UPDATE orders SET writer_id = ?, status = ? WHERE id = ?",
            [writerId, "In Progress", orderId],
            (err3) => {
              if (err3) return res.status(500).json({ message: "Failed to assign order" });
              res.json({ message: "Order assigned successfully" });
            }
          );
        });
      }
    );
  }

  if (adminId) {
    db.get('SELECT id, role FROM users WHERE id = ?', [adminId], (err, admin) => {
      if (err) return res.status(500).json({ message: 'Server error' });
      if (!admin || admin.role !== 'admin') return res.status(403).json({ message: 'Admin privileges required' });
      proceedAssign();
    });
  } else {
    proceedAssign();
  }
});

// Writer updates order status
app.post("/api/update-status", (req, res) => {
  const { orderId, status } = req.body;
  db.run(
    "UPDATE orders SET status = ? WHERE id = ?",
    [status, orderId],
    (err) => {
      if (err) return res.status(500).json({ message: "Failed to update status" });
      res.json({ message: "Status updated successfully" });
    }
  );
});

// Writer uploads completed work
app.post("/api/submit-work/:orderId", upload.single("file"), (req, res) => {
  const { orderId } = req.params;
  const filePath = `/uploads/${req.file.filename}`;
  db.run(
    "UPDATE orders SET submission_file = ?, status = 'Submitted' WHERE id = ?",
    [filePath, orderId],
    (err) => {
      if (err) return res.status(500).json({ message: "Failed to submit work" });
      // Attempt to generate a PDF preview for non-PDF uploads (so client can read without .docx)
      (async () => {
        try {
          const localFile = path.join(uploadDir, req.file.filename);
          const ext = path.extname(req.file.filename).toLowerCase();
          const previewTarget = path.join(previewDir, `${orderId}.pdf`);

          // If upload already a PDF, copy to previews as orderId.pdf
          if (ext === '.pdf') {
            fs.copyFileSync(localFile, previewTarget);
            console.log('✅ PDF preview saved for order', orderId);
          } else if (['.doc', '.docx', '.odt', '.rtf', '.ppt', '.pptx'].includes(ext)) {
            // Convert using soffice (LibreOffice). If soffice not installed, log error.
            const cmd = `soffice --headless --convert-to pdf --outdir "${previewDir}" "${localFile}"`;
            exec(cmd, (convErr, stdout, stderr) => {
              if (convErr) {
                console.error('❌ PDF conversion failed:', convErr.message);
                return;
              }
              // soffice names output same as input basename with .pdf
              const base = path.basename(req.file.filename, ext);
              const produced = path.join(previewDir, `${base}.pdf`);
              if (fs.existsSync(produced)) {
                try {
                  fs.renameSync(produced, previewTarget);
                  console.log('✅ Converted and saved preview for order', orderId);
                } catch (renameErr) {
                  console.error('❌ Failed to rename produced pdf:', renameErr.message);
                }
              } else {
                console.error('❌ Expected produced PDF not found:', produced);
              }
            });
          } else {
            // Other file types: not converting to PDF. Could add handling for images if needed.
            console.log('ℹ️ Uploaded file type not converted to PDF:', ext);
          }
        } catch (e) {
          console.error('❌ Error while generating preview:', e.message || e);
        }
      })();

      res.json({ message: "Work submitted successfully", filePath });
    }
  );
});

// Admin sends submitted work to client
app.post("/api/send-to-client/:orderId", (req, res) => {
  const { orderId } = req.params;
  const { adminId } = req.body || {};
  if (!adminId) return res.status(403).json({ message: 'Admin privileges required' });

  db.get('SELECT id, role FROM users WHERE id = ?', [adminId], (err, admin) => {
    if (err) return res.status(500).json({ message: 'Server error' });
    if (!admin || admin.role !== 'admin') return res.status(403).json({ message: 'Admin privileges required' });

    db.run(
      "UPDATE orders SET status = 'Delivered to Client' WHERE id = ?",
      [orderId],
      (err2) => {
        if (err2) return res.status(500).json({ message: "Failed to deliver work" });
        res.json({ message: "Work delivered to client successfully" });
      }
    );
  });
});

// Submission info endpoint
app.get('/api/submission/:orderId', (req, res) => {
  const { orderId } = req.params;
  const requesterId = req.query.userId;
  db.get('SELECT submission_file, client_id, writer_id, status FROM orders WHERE id = ?', [orderId], (err, order) => {
    if (err) return res.status(500).json({ message: 'Server error' });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (!order.submission_file) return res.status(404).json({ message: 'No submission available' });

    // Return direct uploads URL for the submission (no restriction)
    const filename = path.basename(order.submission_file);
    return res.json({ submission_file: order.submission_file, url: `/uploads/${filename}` });
  });
});

// Preview endpoint: streams file inline for client previews or returns full file for delivered orders/admins/writers
app.get('/api/preview/:orderId', (req, res) => {
  const { orderId } = req.params;
  const requesterId = req.query.userId;
  if (!requesterId) return res.status(403).json({ message: 'Access denied' });

  db.get('SELECT submission_file, client_id, writer_id, status FROM orders WHERE id = ?', [orderId], (err, order) => {
    if (err) return res.status(500).json({ message: 'Server error' });
    if (!order || !order.submission_file) return res.status(404).json({ message: 'Submission not found' });

    db.get('SELECT id, role FROM users WHERE id = ?', [requesterId], (err2, user) => {
      if (err2) return res.status(500).json({ message: 'Server error' });
      if (!user) return res.status(403).json({ message: 'Access denied' });

      const filename = path.basename(order.submission_file);
      const filePath = path.join(uploadDir, filename);

      // Writers and admins get direct access
      if (user.role === 'admin' || user.id === order.writer_id) {
        return res.sendFile(filePath);
      }

      // Client access: allow full file if delivered, otherwise stream as inline preview with restrictive headers
      if (user.id === order.client_id) {
            if (order.status && order.status.toLowerCase().includes('delivered')) {
              return res.sendFile(filePath);
            }

            // Prefer serving a generated PDF preview if it exists
            const previewFile = path.join(previewDir, `${orderId}.pdf`);
            if (fs.existsSync(previewFile)) {
              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Disposition', 'inline');
              res.setHeader('X-Content-Type-Options', 'nosniff');
              res.setHeader('Cache-Control', 'no-store');
              return res.sendFile(previewFile);
            }

            if (fs.existsSync(filePath)) {
              res.setHeader('Content-Type', 'application/octet-stream');
              res.setHeader('Content-Disposition', 'inline');
              res.setHeader('X-Content-Type-Options', 'nosniff');
              res.setHeader('Cache-Control', 'no-store');
              res.setHeader('Accept-Ranges', 'none');

              const stream = fs.createReadStream(filePath);
              stream.pipe(res);
              return;
            }
        return res.status(404).json({ message: 'File not found' });
      }

      return res.status(403).json({ message: 'Access denied' });
    });
  });
});

// Preview view: returns an HTML wrapper that embeds the protected preview stream
// and overlays a watermark with user info and timestamp. This avoids exposing
// the direct uploads URL in the client UI.
app.get('/api/preview-view/:orderId', (req, res) => {
  const { orderId } = req.params;
  const requesterId = req.query.userId;
  if (!requesterId) return res.status(403).send('Access denied');

  db.get('SELECT submission_file, client_id, writer_id, status FROM orders WHERE id = ?', [orderId], (err, order) => {
    if (err) return res.status(500).send('Server error');
    if (!order || !order.submission_file) return res.status(404).send('Submission not found');

    db.get('SELECT id, name, email, role FROM users WHERE id = ?', [requesterId], (err2, user) => {
      if (err2) return res.status(500).send('Server error');
      if (!user) return res.status(403).send('Access denied');

      // Build the protected preview stream URL
      const previewStreamUrl = `/api/preview/${orderId}?userId=${requesterId}`;

      // Return a simple HTML page that embeds the stream and overlays watermark text.
      // The watermark shows user email, order id and timestamp.
      const watermarkText = `${user.email || user.name || 'user'} — Order ${orderId} — ${new Date().toLocaleString()}`;

      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Preview — Order ${orderId}</title>
  <style>
    html,body{height:100%;margin:0;background:#222}
    .holder{position:relative;height:100%;}
    iframe{width:100%;height:100%;border:0;display:block}
    .watermark{
      position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;
      display:flex;align-items:center;justify-content:center;opacity:0.15;
      font-size:32px;color:#fff;transform:rotate(-25deg);white-space:nowrap;
    }
    .notice{position:absolute;left:12px;top:12px;color:#fff;background:rgba(0,0,0,0.4);padding:6px 10px;border-radius:6px;font-size:13px}
  </style>
</head>
<body>
  <div class="holder">
    <div class="notice">Preview only — downloading disabled until delivery</div>
    <iframe src="${previewStreamUrl}" sandbox="allow-same-origin allow-scripts"></iframe>
    <div class="watermark">${watermarkText}</div>
  </div>
  <script>
    // Disable common shortcuts inside this preview window
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && ['s','p','u','S','P','U'].includes(e.key)) e.preventDefault();
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  </script>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    });
  });
});

// Protected uploads route: only serves file if order is delivered. Direct access otherwise blocked.
app.get('/uploads/:filename', (req, res) => {
  const filename = req.params.filename;
  db.get('SELECT status FROM orders WHERE submission_file LIKE ?', [`%${filename}`], (err, order) => {
    if (err) return res.status(500).send('Server error');
    if (!order) return res.status(404).send('Not found');

    if (order.status && order.status.toLowerCase().includes('delivered')) {
      const filePath = path.join(uploadDir, filename);
      return res.sendFile(filePath);
    }

    return res.status(403).send('Direct download blocked. Use preview endpoint.');
  });
});
// Delete order
app.delete("/api/orders/:id", (req, res) => {
  db.run("DELETE FROM orders WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ message: "Failed to delete order" });
    res.json({ message: "Order deleted successfully" });
  });
});

// Get approved users (for admin view)
app.get('/api/users', (_, res) => {
  db.all(
    'SELECT id, name, email, role, country, approved FROM users WHERE approved = 1',
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Failed to fetch users' });
      res.json(rows);
    }
  );
});

// Delete user
app.delete('/api/users/:id', (req, res) => {
  db.run('DELETE FROM users WHERE id = ?', [req.params.id], function (err) {
    if (err) return res.status(500).json({ message: 'Failed to delete user' });
    res.json({ message: 'User deleted successfully' });
  });
});

// ==========================
// 🚀 START SERVER
// ==========================
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
