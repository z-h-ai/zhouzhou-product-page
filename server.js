const express = require('express');
const path = require('path');
const initSqlJs = require('sql.js');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'zhihui2026';

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.sqlite');

let db;

async function initDB() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS form_submissions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      wechat TEXT NOT NULL,
      services TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      ip TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS quiz_results (
      id TEXT PRIMARY KEY,
      answers TEXT DEFAULT '[]',
      score INTEGER DEFAULT 0,
      result_type TEXT,
      created_at TEXT NOT NULL,
      ip TEXT
    )
  `);

  saveDB();
}

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Helper: get client IP
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.connection?.remoteAddress
    || req.ip
    || '';
}

// Helper: verify admin password
function verifyAdmin(req) {
  const pwdQuery = req.query.password;
  const pwdHeader = req.headers['x-admin-password'];
  return pwdQuery === ADMIN_PASSWORD || pwdHeader === ADMIN_PASSWORD;
}

// ── API Routes ──

// POST /api/submit-form
app.post('/api/submit-form', (req, res) => {
  try {
    const { name, phone, wechat, services } = req.body;
    if (!name || !phone || !wechat) {
      return res.status(400).json({ error: '姓名、手机号、微信号为必填项' });
    }

    const id = uuidv4();
    const created_at = new Date().toISOString();
    const ip = getClientIP(req);

    db.run(
      'INSERT INTO form_submissions (id, name, phone, wechat, services, created_at, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, name, phone, wechat, JSON.stringify(services || []), created_at, ip]
    );
    saveDB();

    res.json({ success: true, id });
  } catch (err) {
    console.error('submit-form error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// POST /api/submit-quiz
app.post('/api/submit-quiz', (req, res) => {
  try {
    const { answers, score, result_type } = req.body;

    const id = uuidv4();
    const created_at = new Date().toISOString();
    const ip = getClientIP(req);

    db.run(
      'INSERT INTO quiz_results (id, answers, score, result_type, created_at, ip) VALUES (?, ?, ?, ?, ?, ?)',
      [id, JSON.stringify(answers || []), score || 0, result_type || '', created_at, ip]
    );
    saveDB();

    res.json({ success: true, id });
  } catch (err) {
    console.error('submit-quiz error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// GET /api/submissions
app.get('/api/submissions', (req, res) => {
  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: '密码错误' });
  }

  try {
    const stmt = db.prepare('SELECT * FROM form_submissions ORDER BY created_at DESC');
    const rows = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      row.services = JSON.parse(row.services || '[]');
      rows.push(row);
    }
    stmt.free();
    res.json({ success: true, data: rows, total: rows.length });
  } catch (err) {
    console.error('get submissions error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// GET /api/quiz-results
app.get('/api/quiz-results', (req, res) => {
  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: '密码错误' });
  }

  try {
    const stmt = db.prepare('SELECT * FROM quiz_results ORDER BY created_at DESC');
    const rows = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      row.answers = JSON.parse(row.answers || '[]');
      rows.push(row);
    }
    stmt.free();
    res.json({ success: true, data: rows, total: rows.length });
  } catch (err) {
    console.error('get quiz-results error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// GET /api/stats
app.get('/api/stats', (req, res) => {
  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: '密码错误' });
  }

  try {
    const formCount = db.exec('SELECT COUNT(*) as count FROM form_submissions')[0]?.values[0][0] || 0;
    const quizCount = db.exec('SELECT COUNT(*) as count FROM quiz_results')[0]?.values[0][0] || 0;
    res.json({ success: true, formCount, quizCount });
  } catch (err) {
    console.error('stats error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// Start server
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Admin page: http://localhost:${PORT}/admin.html`);
  });
}).catch(err => {
  console.error('Failed to init database:', err);
  process.exit(1);
});
