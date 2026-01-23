// Full corrected server.js — fixes syntax errors, adds password hashing, normalizes IDs, and hardens inputs.
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const { exec } = require('child_process');
const multer = require("multer");
const cors = require("cors");
const dns = require('dns').promises;
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
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
      submission_date TEXT,
      expected_ready TEXT,
      client_guide TEXT,
      submission_file TEXT,
      -- payment fields: status (unpaid/pending/paid), reference and amount
      payment_status TEXT DEFAULT 'unpaid',
      payment_ref TEXT,
      amount REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (writer_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // verification codes for email confirmation
  db.run(`
    CREATE TABLE IF NOT EXISTS email_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
});

// ===== HELPERS =====
async function domainHasMx(email) {
  const parts = String(email || '').split('@');
  if (parts.length !== 2) return false;
  const domain = parts[1].toLowerCase();
  try {
    const mx = await dns.resolveMx(domain);
    return Array.isArray(mx) && mx.length > 0;
  } catch (e) {
    return false;
  }
}

// Normalize numeric IDs from params/queries/bodies
const toInt = (v) => {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
};

// JWT helpers
function getUserFromRequest(req) {
  try {
    const auth = (req.headers && req.headers.authorization) || '';
    let token = null;
    if (auth && auth.startsWith('Bearer ')) token = auth.slice(7);
    else if (req.query && req.query.userToken) token = req.query.userToken;
    if (!token) return null;
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded || null;
  } catch (e) {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: 'Unauthorized' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ message: 'Admin privileges required' });
  next();
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
}

async function createTransporter() {
  // Prefer environment-provided SMTP credentials
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && port && user && pass) {
    return nodemailer.createTransport({
      host, port, secure: port === 465,
      auth: { user, pass }
    });
  }

  // fallback: create an Ethereal test account (so emails are actually sent to Ethereal and can be previewed)
  try {
    const testAccount = await nodemailer.createTestAccount();
    const transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass }
    });
    // attach a small marker so callers can detect this is a test transport and retrieve preview URL
    transporter.__isEthereal = true;
    transporter.__etherealAccount = { user: testAccount.user };
    return transporter;
  } catch (e) {
    console.error('Failed to create Ethereal test account, falling back to console log. Error:', e && e.message ? e.message : e);
    return {
      sendMail: async (opts) => {
        console.log('=== Verification email (console fallback) ===');
        console.log(opts);
        return Promise.resolve();
      }
    };
  }
}

async function sendVerificationEmail(email, code) {
  const transporter = await createTransporter();
  const origin = process.env.APP_ORIGIN || `http://localhost:${PORT}`;
  const text = `Your ProWriter verification code is: ${code}\n\nEnter this code in the app to verify your email.`;
  const html = `<p>Your ProWriter verification code is: <strong>${code}</strong></p><p>Or visit <code>${origin}/login.html</code> and enter the code to verify.</p>`;
  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'no-reply@prowriters.local',
      to: email,
      subject: 'ProWriter — Verify your email',
      text,
      html
    });

    // If using Ethereal, return the preview URL so callers (devs) can open the message in browser
    if (transporter.__isEthereal) {
      const preview = nodemailer.getTestMessageUrl(info);
      console.log('Ethereal preview URL:', preview);
      return { ok: true, preview };
    }

    return { ok: true };
  } catch (err) {
    console.error('❌ Failed to send verification email:', err && err.message ? err.message : err);
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// ===== ROOT & HEALTH =====
app.get("/", (_, res) => {
  res.send("✅ ProWriter Solutions backend running successfully!");
});
app.get('/api/ping', (_, res) => res.json({ message: 'pong' }));

// ==========================
// 👤 AUTH / VERIFICATION
// ==========================

// Register: validate email (MX) and create unapproved user + verification code
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password, role, country } = req.body;
    if (!name || !email || !password || !country)
      return res.status(400).json({ message: "Missing required fields" });

    const emailLower = String(email).trim().toLowerCase();
    // basic email regex
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(emailLower)) return res.status(400).json({ message: "Invalid email format" });

    // MX check
    if (!await domainHasMx(emailLower)) {
      return res.status(400).json({ message: "Email domain is invalid or has no MX records" });
    }

    // validate role
    const allowedRoles = ['admin', 'writer', 'client'];
    const userRole = allowedRoles.includes(role) ? role : 'client';

    // check existing
    db.get("SELECT id FROM users WHERE email = ?", [emailLower], (err, row) => {
      if (err) return res.status(500).json({ message: "Server error" });
      if (row) return res.status(409).json({ message: "Email already registered" });

      // hash password
      const hashed = bcrypt.hashSync(password, 10);

      // create user with approved = 0 (must verify)
      db.run(
        `INSERT INTO users (name, email, password, role, country, approved)
         VALUES (?, ?, ?, ?, ?, 0)`,
        [name, emailLower, hashed, userRole, country],
        function (insertErr) {
          if (insertErr) return res.status(500).json({ message: "Registration failed" });
          const userId = this.lastID;
          const code = generateCode();
          const expires = Date.now() + (15 * 60 * 1000); // 15 minutes

          db.run(
            `INSERT INTO email_verifications (user_id, email, code, expires_at) VALUES (?, ?, ?, ?)`,
            [userId, emailLower, code, expires],
            async (verErr) => {
              if (verErr) {
                console.error('❌ verification insert failed', verErr);
                return res.status(500).json({ message: "Registration failed (verification)" });
              }
              // send verification email (best effort). Return preview URL in dev when available
              const sendResult = await sendVerificationEmail(emailLower, code);
              const resp = { message: "Registered. Check your email for a verification code." };
              if (sendResult && sendResult.preview) {
                resp.preview = sendResult.preview;
                resp.note = 'preview_url_included_for_development_only';
              } else if (sendResult && sendResult.ok === false) {
                // include a gentle note that email sending failed (server-side)
                resp.note = 'email_send_failed';
              }
              return res.json(resp);
            }
          );
        }
      );
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Resend verification code
app.post('/api/resend-verification', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Missing email' });
  const emailLower = String(email).trim().toLowerCase();

  db.get("SELECT id, approved FROM users WHERE email = ?", [emailLower], async (err, user) => {
    if (err) return res.status(500).json({ message: 'Server error' });
    if (!user) return res.status(404).json({ message: 'Email not found' });
    if (user.approved) return res.status(400).json({ message: 'Email already verified' });

    const code = generateCode();
    const expires = Date.now() + (15 * 60 * 1000);
    db.run(
      `INSERT INTO email_verifications (user_id, email, code, expires_at) VALUES (?, ?, ?, ?)`,
      [user.id, emailLower, code, expires],
      async (verErr) => {
        if (verErr) return res.status(500).json({ message: 'Failed to create verification code' });
        const sendResult = await sendVerificationEmail(emailLower, code);
        const resp = { message: 'Verification code resent' };
        if (sendResult && sendResult.preview) {
          resp.preview = sendResult.preview;
          resp.note = 'preview_url_included_for_development_only';
        } else if (sendResult && sendResult.ok === false) {
          resp.note = 'email_send_failed';
        }
        return res.json(resp);
      }
    );
  });
});

// Verify code endpoint
app.post('/api/verify-email', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ message: 'Missing email or code' });
  const emailLower = String(email).trim().toLowerCase();

  db.get(
    `SELECT v.id as vid, v.user_id, v.code, v.expires_at, v.used, u.approved
     FROM email_verifications v
     JOIN users u ON u.id = v.user_id
     WHERE v.email = ? AND v.used = 0
     ORDER BY v.created_at DESC
     LIMIT 1`,
    [emailLower],
    (err, row) => {
      if (err) return res.status(500).json({ message: 'Server error' });
      if (!row) return res.status(400).json({ message: 'No active verification found' });
      if (Date.now() > row.expires_at) return res.status(400).json({ message: 'Code expired' });
      if (String(row.code) !== String(code).trim()) return res.status(400).json({ message: 'Invalid code' });

      // mark verification used and approve user
      db.run("UPDATE email_verifications SET used = 1 WHERE id = ?", [row.vid], (uErr) => {
        if (uErr) console.error('❌ failed to mark verification used', uErr);
        db.run("UPDATE users SET approved = 1 WHERE id = ?", [row.user_id], (upErr) => {
          if (upErr) return res.status(500).json({ message: 'Failed to verify account' });
          res.json({ message: 'Email verified. You may now log in.' });
        });
      });
    }
  );
});

// Login: only allow approved users
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Missing credentials' });

  const emailLower = String(email).trim().toLowerCase();
  db.get(
    "SELECT * FROM users WHERE email = ?",
    [emailLower],
    (err, user) => {
      if (err) return res.status(500).json({ message: "Server error" });
      if (!user) return res.status(401).json({ message: "Invalid account" });
      if (!user.approved) return res.status(403).json({ message: "Email not verified" });

      // compare hashed password
      const match = bcrypt.compareSync(password, user.password);
      if (!match) return res.status(401).json({ message: "Invalid account" });

      // remove password before sending user object and issue JWT
      delete user.password;
      const payload = { id: user.id, role: user.role, email: user.email };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
      res.json({ user, token });
    }
  );
});

// ==========================
// 🧾 ORDER ROUTES
// ==========================

// Create new order (client) - supports file upload (client guide) via field name 'guide'
app.post("/api/orders", upload.single('guide'), (req, res) => {
  // multer will populate req.file (if any) and req.body for text fields
  try {
    const title = req.body && String(req.body.title || '').trim();
    const description = req.body && String(req.body.description || '').trim();
    const client_id = toInt(req.body && req.body.client_id);
    const submission_date = req.body && req.body.submission_date ? String(req.body.submission_date) : null;
    const expected_ready = req.body && req.body.expected_ready ? String(req.body.expected_ready) : null;

    if (!title || (!description && !req.file) || client_id === null) {
      return res.status(400).json({ message: 'Missing required fields: title, client_id and (description or guide file)' });
    }

    const clientGuidePath = req.file ? `/uploads/${path.basename(req.file.filename)}` : null;

    db.run(
      `INSERT INTO orders (title, description, client_id, submission_date, expected_ready, client_guide)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title, description || '', client_id, submission_date, expected_ready, clientGuidePath],
      function (err) {
        if (err) return res.status(500).json({ message: 'Failed to submit order' });
        res.json({ message: 'Order submitted successfully' });
      }
    );
  } catch (e) {
    console.error('Order create error', e && e.message ? e.message : e);
    return res.status(500).json({ message: 'Server error' });
  }
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
  const writerId = toInt(req.params.writer_id);
  if (writerId === null) return res.status(400).json({ message: 'Invalid writer id' });
  db.all(
    `SELECT * FROM orders WHERE writer_id = ? ORDER BY created_at DESC`,
    [writerId],
    (err, rows) => {
      if (err) return res.status(500).json({ message: "Failed to fetch assigned orders" });
      res.json(rows);
    }
  );
});

// Assign job to writer
// Assign job to writer (admin-only)
app.post("/api/assign", authMiddleware, requireAdmin, (req, res) => {
  const orderId = toInt(req.body && req.body.orderId);
  const writerId = toInt(req.body && req.body.writerId);
  if (orderId === null || writerId === null)
    return res.status(400).json({ message: "Missing or invalid order or writer ID" });
  // admin is provided by token (req.user)
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

  proceedAssign();
});

// Claim job as a writer (writers call this to take an unassigned order)
app.post('/api/claim', authMiddleware, (req, res) => {
  // only writers may claim
  if (!req.user || req.user.role !== 'writer') return res.status(403).json({ message: 'Writer privileges required' });
  const orderId = toInt(req.body && req.body.orderId);
  const writerId = toInt(req.user && req.user.id);
  if (orderId === null || writerId === null) return res.status(400).json({ message: 'Missing orderId or invalid writer' });

  // Check if writer already has an active order (In Progress)
  db.get(
    "SELECT id FROM orders WHERE writer_id = ? AND status = 'In Progress'",
    [writerId],
    (err, active) => {
      if (err) return res.status(500).json({ message: 'Server error' });
      if (active) return res.status(400).json({ message: 'You already have an active order' });

      // Ensure the order exists and is unassigned
      db.get('SELECT writer_id, status FROM orders WHERE id = ?', [orderId], (err2, order) => {
        if (err2) return res.status(500).json({ message: 'Server error' });
        if (!order) return res.status(404).json({ message: 'Order not found' });
        if (order.writer_id) return res.status(400).json({ message: 'Order already assigned' });
        if (order.status !== 'Pending Assignment') return res.status(400).json({ message: 'Order not available for assignment' });

        db.run(
          "UPDATE orders SET writer_id = ?, status = ? WHERE id = ?",
          [writerId, 'In Progress', orderId],
          (err3) => {
            if (err3) return res.status(500).json({ message: 'Failed to claim order' });
            res.json({ message: 'Order claimed successfully' });
          }
        );
      });
    }
  );
});

// Writer updates order status
app.post("/api/update-status", (req, res) => {
  const orderId = toInt(req.body && req.body.orderId);
  const status = req.body && req.body.status;
  if (orderId === null || !status) return res.status(400).json({ message: 'Missing orderId or status' });
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
  const orderId = toInt(req.params && req.params.orderId);
  if (orderId === null) return res.status(400).json({ message: 'Invalid order id' });
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const safeFilename = path.basename(req.file.filename);
  const filePath = `/uploads/${safeFilename}`;
  db.run(
    "UPDATE orders SET submission_file = ?, status = 'Submitted' WHERE id = ?",
    [filePath, orderId],
    function (err) {
      if (err) return res.status(500).json({ message: "Failed to submit work" });
      // Attempt to generate a PDF preview for non-PDF uploads (so client can read without .docx)
      (async () => {
        try {
          const localFile = path.join(uploadDir, safeFilename);
          const ext = path.extname(safeFilename).toLowerCase();
          const previewTarget = path.join(previewDir, `${orderId}.pdf`);

          // If upload already a PDF, copy to previews as orderId.pdf
          if (ext === '.pdf') {
            fs.copyFileSync(localFile, previewTarget);
            console.log('✅ PDF preview saved for order', orderId);
          } else if (['.doc', '.docx', '.odt', '.rtf', '.ppt', '.pptx'].includes(ext)) {
            // Convert using soffice (LibreOffice). If soffice not installed, log error.
            const cmd = `soffice --headless --convert-to pdf --outdir "${previewDir}" "${localFile}"`;
            exec(cmd, (convErr) => {
              if (convErr) {
                console.error('❌ PDF conversion failed:', convErr.message);
                return;
              }
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
app.post("/api/send-to-client/:orderId", authMiddleware, requireAdmin, (req, res) => {
  const orderId = toInt(req.params && req.params.orderId);
  if (orderId === null) return res.status(400).json({ message: 'Invalid order id' });

  db.run(
    "UPDATE orders SET status = 'Delivered to Client' WHERE id = ?",
    [orderId],
    (err2) => {
      if (err2) return res.status(500).json({ message: "Failed to deliver work" });
      res.json({ message: "Work delivered to client successfully" });
    }
  );
});

// List pending (unapproved) users - admin only
app.get('/api/pending-users', authMiddleware, requireAdmin, (_, res) => {
  db.all('SELECT id, name, email, role, country FROM users WHERE approved = 0 ORDER BY id DESC', (err, rows) => {
    if (err) return res.status(500).json({ message: 'Failed to fetch pending users' });
    res.json(rows || []);
  });
});

// Approve a user (admin only)
app.post('/api/approve-user/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = toInt(req.params && req.params.id);
  if (id === null) return res.status(400).json({ message: 'Invalid user id' });
  db.get('SELECT id, approved FROM users WHERE id = ?', [id], (err, user) => {
    if (err) return res.status(500).json({ message: 'Server error' });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.approved) return res.json({ message: 'User already approved' });
    db.run('UPDATE users SET approved = 1 WHERE id = ?', [id], function (uerr) {
      if (uerr) return res.status(500).json({ message: 'Failed to approve user' });
      // mark any outstanding verification codes as used
      db.run('UPDATE email_verifications SET used = 1 WHERE user_id = ?', [id], () => {});
      res.json({ message: 'User approved successfully' });
    });
  });
});

// Submission info endpoint
app.get('/api/submission/:orderId', (req, res) => {
  const orderId = toInt(req.params && req.params.orderId);
  const requesterId = toInt(req.query && req.query.userId);
  if (orderId === null) return res.status(400).json({ message: 'Invalid order id' });
  db.get('SELECT submission_file, client_id, writer_id, status FROM orders WHERE id = ?', [orderId], (err, order) => {
    if (err) return res.status(500).json({ message: 'Server error' });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (!order.submission_file) return res.status(404).json({ message: 'No submission available' });
    // Determine requester (may be provided via token in future)
    const authUser = getUserFromRequest(req);
    const reqId = authUser ? toInt(authUser.id) : requesterId;
    // Writers and admins get direct access
    if (authUser && (authUser.role === 'admin' || toInt(authUser.id) === order.writer_id)) {
      const filename = path.basename(order.submission_file);
      return res.json({ submission_file: order.submission_file, url: `/uploads/${filename}`, requesterId: reqId });
    }

    // Clients: only return direct download URL if the order has been paid for
    if (reqId && reqId === toInt(order.client_id)) {
      // fetch payment_status
      db.get('SELECT payment_status FROM orders WHERE id = ?', [orderId], (pErr, prow) => {
        if (pErr) return res.status(500).json({ message: 'Server error' });
        const paid = prow && String(prow.payment_status).toLowerCase() === 'paid';
        if (!paid) return res.status(403).json({ message: 'Download blocked until payment is completed' });
        const filename = path.basename(order.submission_file);
        return res.json({ submission_file: order.submission_file, url: `/uploads/${filename}`, requesterId: reqId });
      });
      return;
    }

    return res.status(403).json({ message: 'Access denied' });
  });
});

// Preview endpoint: streams file inline for client previews or returns full file for delivered orders/admins/writers
app.get('/api/preview/:orderId', (req, res) => {
  const orderId = toInt(req.params && req.params.orderId);
  const authUser = getUserFromRequest(req);
  const requesterId = authUser ? toInt(authUser.id) : toInt(req.query && req.query.userId);
  if (orderId === null) return res.status(400).json({ message: 'Invalid order id' });
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
            // Only allow full download if the order has been paid for
            if (order.payment_status && String(order.payment_status).toLowerCase() === 'paid') {
              return res.sendFile(filePath);
            }

            // Not paid: continue to show restricted preview

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
app.get('/api/preview-view/:orderId', (req, res) => {
  const orderId = toInt(req.params && req.params.orderId);
  const auth = (req.headers && req.headers.authorization) || '';
  let rawToken = null;
  if (auth && auth.startsWith('Bearer ')) rawToken = auth.slice(7);
  else if (req.query && req.query.userToken) rawToken = req.query.userToken;

  const authUser = getUserFromRequest(req);
  const requesterId = authUser ? toInt(authUser.id) : toInt(req.query && req.query.userId);
  if (orderId === null) return res.status(400).send('Invalid order id');
  if (!requesterId) return res.status(403).send('Access denied');

  db.get('SELECT submission_file, client_id, writer_id, status FROM orders WHERE id = ?', [orderId], (err, order) => {
    if (err) return res.status(500).send('Server error');
    if (!order || !order.submission_file) return res.status(404).send('Submission not found');

    db.get('SELECT id, name, email, role FROM users WHERE id = ?', [requesterId], (err2, user) => {
      if (err2) return res.status(500).send('Server error');
      if (!user) return res.status(403).send('Access denied');

      // Build the protected preview stream URL (prefer token)
      const previewStreamUrl = rawToken
        ? `/api/preview/${orderId}?userToken=${encodeURIComponent(rawToken)}`
        : `/api/preview/${orderId}?userId=${requesterId}`;

      // Return a simple HTML page that embeds the stream and overlays watermark text.
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
  const filename = path.basename(req.params.filename || '');
  if (!filename) return res.status(400).send('Invalid filename');
  db.get('SELECT status FROM orders WHERE submission_file LIKE ?', [`%${filename}`], (err, order) => {
    if (err) return res.status(500).send('Server error');
    if (!order) return res.status(404).send('Not found');
    // Only allow direct download when the order has payment_status === 'paid'
    db.get('SELECT payment_status FROM orders WHERE submission_file LIKE ?', [`%${filename}`], (pErr, prow) => {
      if (pErr) return res.status(500).send('Server error');
      if (prow && String(prow.payment_status).toLowerCase() === 'paid') {
        const filePath = path.join(uploadDir, filename);
        return res.sendFile(filePath);
      }
      return res.status(403).send('Direct download blocked. Payment required.');
    });
  });
});
// Delete order
app.delete("/api/orders/:id", authMiddleware, requireAdmin, (req, res) => {
  const id = toInt(req.params && req.params.id);
  if (id === null) return res.status(400).json({ message: 'Invalid id' });
  db.run("DELETE FROM orders WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ message: "Failed to delete order" });
    res.json({ message: "Order deleted successfully" });
  });
});

// Admin: update an order's editable fields
app.put('/api/orders/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = toInt(req.params && req.params.id);
  if (id === null) return res.status(400).json({ message: 'Invalid id' });
  const allowed = ['title', 'description', 'client_id', 'writer_id', 'status', 'amount', 'payment_status', 'payment_ref', 'submission_date', 'expected_ready'];
  const updates = [];
  const params = [];
  for (const key of allowed) {
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, key)) {
      updates.push(`${key} = ?`);
      params.push(req.body[key]);
    }
  }
  if (!updates.length) return res.status(400).json({ message: 'No valid fields to update' });
  params.push(id);
  const sql = `UPDATE orders SET ${updates.join(', ')} WHERE id = ?`;
  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ message: 'Failed to update order' });
    db.get('SELECT * FROM orders WHERE id = ?', [id], (e, row) => {
      if (e) return res.status(500).json({ message: 'Failed to fetch updated order' });
      res.json({ message: 'Order updated', order: row });
    });
  });
});

// Ensure payment-related columns exist on older DBs
db.serialize(() => {
  db.all("PRAGMA table_info(orders)", (err, rows) => {
    if (err || !Array.isArray(rows)) return;
    const cols = rows.map(r => r.name);
    const stmts = [];
    if (!cols.includes('payment_status')) stmts.push("ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'unpaid'");
    if (!cols.includes('payment_ref')) stmts.push("ALTER TABLE orders ADD COLUMN payment_ref TEXT");
    if (!cols.includes('amount')) stmts.push("ALTER TABLE orders ADD COLUMN amount REAL DEFAULT 0");
    if (!cols.includes('client_guide')) stmts.push("ALTER TABLE orders ADD COLUMN client_guide TEXT");
    if (!cols.includes('submission_date')) stmts.push("ALTER TABLE orders ADD COLUMN submission_date TEXT");
    if (!cols.includes('expected_ready')) stmts.push("ALTER TABLE orders ADD COLUMN expected_ready TEXT");
    stmts.forEach(s => {
      db.run(s, (e) => { if (e) console.error('Failed to add column', e); else console.log('DB migration run:', s); });
    });
  });
});

// Mark order paid helper (used by real/webhook or simulation)
function markOrderPaid(orderId, paymentRef, cb) {
  db.run("UPDATE orders SET payment_status = ?, payment_ref = ?, status = ? WHERE id = ?", ['paid', paymentRef, 'Delivered to Client', orderId], function (err) {
    if (err) {
      console.error('Failed to mark order paid', err);
      if (cb) return cb(err);
      return;
    }
    console.log('Order marked paid:', orderId, paymentRef);
    if (cb) cb && cb(null);
  });
}

// Initiate a payment for an order (supports simulation if MPESA credentials not set)
app.post('/api/payments/initiate', (req, res) => {
  const orderId = toInt(req.body && req.body.orderId);
  const phoneNumber = String((req.body && req.body.phoneNumber) || '').trim();
  const amount = Number(req.body && req.body.amount) || 0;
  if (orderId === null || !phoneNumber) return res.status(400).json({ message: 'Missing orderId or phoneNumber' });

  db.get('SELECT id, client_id, submission_file, status FROM orders WHERE id = ?', [orderId], (err, order) => {
    if (err) return res.status(500).json({ message: 'Server error' });
    if (!order) return res.status(404).json({ message: 'Order not found' });

    // If real MPESA integration env present, you would call Daraja STK push here.
    // For now: simulate if no MPESA env variables set.
    const mpesaConsumer = process.env.MPESA_CONSUMER_KEY;
    if (!mpesaConsumer) {
      const paymentRef = `SIM-${Date.now()}-${Math.round(Math.random()*1e6)}`;
      db.run('UPDATE orders SET payment_status = ?, payment_ref = ?, amount = ? WHERE id = ?', ['pending', paymentRef, amount, orderId], (uErr) => {
        if (uErr) return res.status(500).json({ message: 'Failed to create payment record' });
        // simulate callback after short delay
        setTimeout(() => {
          try { markOrderPaid(orderId, paymentRef); } catch (e) { console.error('Simulated payment callback failed', e); }
        }, 4000);
        return res.json({ message: 'Simulated payment initiated', payment_ref: paymentRef, simulate: true });
      });
      return;
    }
    // --- Real M-Pesa Daraja STK Push flow ---
    // Required env vars: MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_CALLBACK_URL
    const mpesaSecret = process.env.MPESA_CONSUMER_SECRET;
    const shortcode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    const callbackBase = process.env.MPESA_CALLBACK_URL;
    const mpesaEnv = (process.env.MPESA_ENV || 'sandbox').toLowerCase();
    if (!mpesaSecret || !shortcode || !passkey || !callbackBase) {
      return res.status(500).json({ message: 'MPesa credentials not fully configured on server' });
    }

    // helper: fetch OAuth token from Daraja
    const https = require('https');
    function getMpesaAccessToken() {
      return new Promise((resolve, reject) => {
        const host = mpesaEnv === 'production' ? 'api.safaricom.co.ke' : 'sandbox.safaricom.co.ke';
        const path = '/oauth/v1/generate?grant_type=client_credentials';
        const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${mpesaSecret}`).toString('base64');
        const opts = { hostname: host, path, method: 'GET', headers: { Authorization: `Basic ${auth}` } };
        const req = https.request(opts, (resp) => {
          let data = '';
          resp.on('data', c => data += c);
          resp.on('end', () => {
            try {
              const j = JSON.parse(data);
              if (j.access_token) return resolve(j.access_token);
              return reject(new Error('No access_token in response'));
            } catch (e) { return reject(e); }
          });
        });
        req.on('error', reject);
        req.end();
      });
    }

    // helper: create timestamp YYYYMMDDHHmmss
    function mpesaTimestamp() {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    }

    // helper: perform STK Push
    async function performStkPush(phone, amt, orderId) {
      const token = await getMpesaAccessToken();
      const host = mpesaEnv === 'production' ? 'api.safaricom.co.ke' : 'sandbox.safaricom.co.ke';
      const path = '/mpesa/stkpush/v1/processrequest';
      const timestamp = mpesaTimestamp();
      const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
      const callbackUrl = `${callbackBase.replace(/\/$/, '')}/api/payments/callback?orderId=${orderId}`;
      const payload = {
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.max(1, Math.round(amt)),
        PartyA: phone,
        PartyB: shortcode,
        PhoneNumber: phone,
        CallBackURL: callbackUrl,
        AccountReference: String(orderId),
        TransactionDesc: `Payment for order ${orderId}`
      };

      return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const opts = {
          hostname: host,
          path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            Authorization: `Bearer ${token}`
          }
        };
        const r = https.request(opts, (resp) => {
          let d = '';
          resp.on('data', c => d += c);
          resp.on('end', () => {
            try { return resolve(JSON.parse(d)); } catch (e) { return reject(e); }
          });
        });
        r.on('error', reject);
        r.write(data);
        r.end();
      });
    }

    // create payment record and call Daraja
    const paymentRef = `MPESA-${Date.now()}-${Math.round(Math.random()*1e6)}`;
    db.run('UPDATE orders SET payment_status = ?, payment_ref = ?, amount = ? WHERE id = ?', ['pending', paymentRef, amount, orderId], async (uErr) => {
      if (uErr) return res.status(500).json({ message: 'Failed to create payment record' });
      try {
        const stkResp = await performStkPush(phoneNumber, amount, orderId);
        // return daraja response to client (contains CheckoutRequestID when accepted)
        return res.json({ message: 'STK push initiated', daraja: stkResp, payment_ref: paymentRef });
      } catch (e) {
        console.error('STK push error', e && e.message ? e.message : e);
        return res.status(502).json({ message: 'Failed to initiate STK push', error: String(e && e.message ? e.message : e) });
      }
    });
    return;
  });
});

// Webhook/Callback endpoint for payment provider to confirm payment
app.post('/api/payments/callback', (req, res) => {
  // Accept both generic provider callbacks and M-Pesa Daraja STK callbacks.
  try {
    // If M-Pesa Daraja will POST a JSON body with Body.stkCallback
    const body = req.body || {};
    // Try to get orderId from query first
    const qOrder = toInt(req.query && req.query.orderId);
    if (body && body.Body && body.Body.stkCallback) {
      const cb = body.Body.stkCallback;
      const resultCode = Number(cb.ResultCode || -1);
      const checkoutId = String(cb.CheckoutRequestID || '');
      // Attempt to find orderId: either from query or AccountReference in ResultParameters
      let foundOrder = qOrder;
      if (!foundOrder && Array.isArray(cb.ResultParameters && cb.ResultParameters.ResultParameter)) {
        cb.ResultParameters.ResultParameter.forEach(p => {
          if (p.Key === 'AccountReference') foundOrder = toInt(p.Value);
        });
      }
      // If successful (0) -> mark paid
      if (resultCode === 0 && foundOrder) {
        markOrderPaid(foundOrder, checkoutId || `MPESA-CB-${Date.now()}`, (err) => {
          if (err) return res.status(500).json({ message: 'Failed to mark payment' });
          return res.json({ message: 'Payment confirmed' });
        });
        return;
      }
      // non-zero result or missing order -> respond and log
      console.log('MPESA callback received', { resultCode, checkoutId, foundOrder });
      return res.json({ message: 'Callback processed' });
    }

    // Fallback generic provider callback: expect { orderId, payment_ref }
    const { orderId, payment_ref } = body || {};
    const oId = toInt(orderId);
    if (oId === null || !payment_ref) return res.status(400).json({ message: 'Missing orderId or payment_ref' });
    markOrderPaid(oId, String(payment_ref), (err) => {
      if (err) return res.status(500).json({ message: 'Failed to mark payment' });
      return res.json({ message: 'Payment confirmed' });
    });
  } catch (e) {
    console.error('Payment callback error', e && e.message ? e.message : e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Check payment status for an order
app.get('/api/orders/:id/payment-status', (req, res) => {
  const id = toInt(req.params && req.params.id);
  if (id === null) return res.status(400).json({ message: 'Invalid id' });
  db.get('SELECT id, payment_status, payment_ref, amount, status FROM orders WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ message: 'Server error' });
    if (!row) return res.status(404).json({ message: 'Order not found' });
    res.json(row);
  });
});

// Get approved users (for admin view)
app.get('/api/users', authMiddleware, requireAdmin, (_, res) => {
  db.all(
    'SELECT id, name, email, role, country, approved FROM users WHERE approved = 1',
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Failed to fetch users' });
      res.json(rows);
    }
  );
});

// Delete user
app.delete('/api/users/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = toInt(req.params && req.params.id);
  if (id === null) return res.status(400).json({ message: 'Invalid id' });
  db.run('DELETE FROM users WHERE id = ?', [id], function (err) {
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
