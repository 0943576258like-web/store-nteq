const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ──────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────
// Database Setup
// ──────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'data', 'nteq_it.db');
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent reads
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ──────────────────────────────────────────
// Create Tables
// ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT,
    emp_id TEXT,
    role TEXT DEFAULT 'staff',
    dept TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS stock (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    unit TEXT DEFAULT 'ตัว',
    cat TEXT DEFAULT 'อุปกรณ์ IT',
    qty INTEGER DEFAULT 0,
    min_qty INTEGER DEFAULT 10,
    img TEXT,
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    name TEXT,
    emp_id TEXT,
    dept TEXT,
    req_type TEXT,
    req_date TEXT,
    urgent TEXT DEFAULT 'normal',
    items TEXT,
    remark TEXT,
    status TEXT DEFAULT 'pending',
    approved_by TEXT,
    approved_at TEXT,
    issued_by TEXT,
    issued_at TEXT,
    reject_reason TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS repairs (
    id TEXT PRIMARY KEY,
    name TEXT,
    emp_id TEXT,
    dept TEXT,
    rep_type TEXT,
    problem TEXT,
    asset TEXT,
    urgent TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'open',
    tech TEXT,
    remark TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    brand TEXT,
    model TEXT,
    dev_type TEXT,
    subtype TEXT,
    serial_no TEXT,
    dept TEXT,
    user_name TEXT,
    company TEXT,
    warranty TEXT,
    price REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    icon TEXT DEFAULT '📦',
    color TEXT DEFAULT '#3b82f6'
  );

  CREATE TABLE IF NOT EXISTS approvers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT
  );

  CREATE TABLE IF NOT EXISTS stock_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id TEXT,
    action TEXT,
    qty INTEGER,
    ref_id TEXT,
    note TEXT,
    by_user TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// ── Seed default data if empty ──
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  const insert = db.prepare(
    'INSERT INTO users (username, password, name, role, dept, active) VALUES (?,?,?,?,?,1)'
  );
  insert.run('admin',   '1234', 'Administrator',   'admin',   'IT');
  insert.run('manager', '1234', 'Manager',         'manager', 'IT');
  insert.run('itstock', '1234', 'IT Staff',        'itstaff', 'IT');
  insert.run('staff',   '1234', 'Staff User',      'staff',   'HR');
}

const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
if (catCount === 0) {
  const cats = [
    ['อุปกรณ์ IT','💻','#3b82f6'],
    ['เครือข่าย','🌐','#06b6d4'],
    ['เครื่องพิมพ์','🖨️','#f59e0b'],
    ['อุปกรณ์สำนักงาน','📋','#10b981'],
    ['สายไฟ / อุปกรณ์เสริม','🔌','#6366f1'],
  ];
  const ins = db.prepare('INSERT INTO categories (name,icon,color) VALUES (?,?,?)');
  cats.forEach(c => ins.run(...c));
}

// ──────────────────────────────────────────
// Helper
// ──────────────────────────────────────────
function jsonParse(v) {
  try { return JSON.parse(v); } catch { return v; }
}

// ──────────────────────────────────────────
// AUTH
// ──────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare(
    'SELECT * FROM users WHERE username=? AND password=? AND active=1'
  ).get(username?.toLowerCase(), password);
  if (!user) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  const { password: _pw, ...safeUser } = user;
  res.json({ ok: true, user: safeUser });
});

// ──────────────────────────────────────────
// SETTINGS
// ──────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  rows.forEach(r => { obj[r.key] = jsonParse(r.value); });
  res.json(obj);
});

app.post('/api/settings', (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  const insertMany = db.transaction((data) => {
    for (const [k, v] of Object.entries(data)) {
      upsert.run(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  });
  insertMany(req.body);
  res.json({ ok: true });
});

// ──────────────────────────────────────────
// USERS
// ──────────────────────────────────────────
app.get('/api/users', (req, res) => {
  const rows = db.prepare(
    'SELECT id,username,name,emp_id,role,dept,active,created_at FROM users ORDER BY id'
  ).all();
  res.json(rows);
});

app.post('/api/users', (req, res) => {
  const { username, password, name, emp_id, role, dept } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
  try {
    const r = db.prepare(
      'INSERT INTO users (username,password,name,emp_id,role,dept) VALUES (?,?,?,?,?,?)'
    ).run(username.toLowerCase(), password, name, emp_id||'', role||'staff', dept||'');
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username นี้มีอยู่แล้ว' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/users/:id', (req, res) => {
  const { name, emp_id, role, dept, active, password } = req.body;
  let sql, params;
  if (password) {
    sql = 'UPDATE users SET name=?,emp_id=?,role=?,dept=?,active=?,password=? WHERE id=?';
    params = [name, emp_id||'', role, dept||'', active??1, password, req.params.id];
  } else {
    sql = 'UPDATE users SET name=?,emp_id=?,role=?,dept=?,active=? WHERE id=?';
    params = [name, emp_id||'', role, dept||'', active??1, req.params.id];
  }
  db.prepare(sql).run(...params);
  res.json({ ok: true });
});

app.delete('/api/users/:id', (req, res) => {
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ──────────────────────────────────────────
// STOCK
// ──────────────────────────────────────────
app.get('/api/stock', (req, res) => {
  res.json(db.prepare('SELECT * FROM stock ORDER BY name').all());
});

app.post('/api/stock', (req, res) => {
  const { id, name, unit, cat, qty, min_qty, img } = req.body;
  try {
    db.prepare(
      'INSERT INTO stock (id,name,unit,cat,qty,min_qty,img) VALUES (?,?,?,?,?,?,?)'
    ).run(id, name, unit||'ตัว', cat||'อุปกรณ์ IT', qty||0, min_qty||10, img||'');
    res.json({ ok: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'รหัสซ้ำ' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/stock/:id', (req, res) => {
  const { name, unit, cat, qty, min_qty, img } = req.body;
  db.prepare(
    `UPDATE stock SET name=?,unit=?,cat=?,qty=?,min_qty=?,img=?,
     updated_at=datetime('now','localtime') WHERE id=?`
  ).run(name, unit, cat, qty, min_qty, img||'', req.params.id);
  res.json({ ok: true });
});

app.post('/api/stock/:id/receive', (req, res) => {
  const { qty, remark, by_user } = req.body;
  const n = parseInt(qty);
  if (!n || n < 1) return res.status(400).json({ error: 'จำนวนไม่ถูกต้อง' });
  db.prepare(
    `UPDATE stock SET qty=qty+?, updated_at=datetime('now','localtime') WHERE id=?`
  ).run(n, req.params.id);
  db.prepare(
    'INSERT INTO stock_log (stock_id,action,qty,note,by_user) VALUES (?,?,?,?,?)'
  ).run(req.params.id, 'receive', n, remark||'', by_user||'system');
  res.json({ ok: true });
});

app.delete('/api/stock/:id', (req, res) => {
  db.prepare('DELETE FROM stock WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ──────────────────────────────────────────
// REQUESTS
// ──────────────────────────────────────────
app.get('/api/requests', (req, res) => {
  let sql = 'SELECT * FROM requests';
  const params = [];
  if (req.query.status) { sql += ' WHERE status=?'; params.push(req.query.status); }
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);
  rows.forEach(r => { r.items = jsonParse(r.items); });
  res.json(rows);
});

app.post('/api/requests', (req, res) => {
  const { id, name, emp_id, dept, req_type, req_date, urgent, items, remark } = req.body;
  db.prepare(`
    INSERT INTO requests (id,name,emp_id,dept,req_type,req_date,urgent,items,remark)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(id, name, emp_id||'', dept||'', req_type||'เบิกอุปกรณ์ IT',
         req_date||'', urgent||'normal', JSON.stringify(items||[]), remark||'');
  res.json({ ok: true });
});

app.put('/api/requests/:id/approve', (req, res) => {
  const { status, approved_by, reject_reason } = req.body;
  db.prepare(`
    UPDATE requests SET status=?,approved_by=?,approved_at=datetime('now','localtime'),
    reject_reason=? WHERE id=?
  `).run(status, approved_by||'', reject_reason||'', req.params.id);

  // Deduct stock if issued
  if (status === 'issued') {
    const req_row = db.prepare('SELECT items FROM requests WHERE id=?').get(req.params.id);
    if (req_row) {
      const items = jsonParse(req_row.items) || [];
      const deduct = db.prepare(
        `UPDATE stock SET qty=MAX(0,qty-?), updated_at=datetime('now','localtime') WHERE name=?`
      );
      items.forEach(itm => {
        if (itm.name) deduct.run(parseInt(itm.qty)||1, itm.name);
      });
    }
  }
  res.json({ ok: true });
});

app.put('/api/requests/:id/issue', (req, res) => {
  const { issued_by } = req.body;
  db.prepare(`
    UPDATE requests SET status='issued',issued_by=?,issued_at=datetime('now','localtime')
    WHERE id=?
  `).run(issued_by||'', req.params.id);
  res.json({ ok: true });
});

// ──────────────────────────────────────────
// REPAIRS
// ──────────────────────────────────────────
app.get('/api/repairs', (req, res) => {
  let sql = 'SELECT * FROM repairs';
  const params = [];
  if (req.query.status) { sql += ' WHERE status=?'; params.push(req.query.status); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/repairs', (req, res) => {
  const { id, name, emp_id, dept, rep_type, problem, asset, urgent } = req.body;
  db.prepare(`
    INSERT INTO repairs (id,name,emp_id,dept,rep_type,problem,asset,urgent)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(id, name, emp_id||'', dept||'', rep_type||'อื่นๆ',
         problem||'', asset||'', urgent||'normal');
  res.json({ ok: true });
});

app.put('/api/repairs/:id', (req, res) => {
  const { status, tech, remark } = req.body;
  db.prepare(`
    UPDATE repairs SET status=?,tech=?,remark=?,updated_at=datetime('now','localtime')
    WHERE id=?
  `).run(status, tech||'', remark||'', req.params.id);
  res.json({ ok: true });
});

// ──────────────────────────────────────────
// DEVICES
// ──────────────────────────────────────────
app.get('/api/devices', (req, res) => {
  let sql = 'SELECT * FROM devices';
  const params = [];
  if (req.query.status) { sql += ' WHERE status=?'; params.push(req.query.status); }
  sql += ' ORDER BY name';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/devices', (req, res) => {
  const { code, name, brand, model, dev_type, subtype, serial_no, dept,
          user_name, company, warranty, price, status } = req.body;
  try {
    const r = db.prepare(`
      INSERT INTO devices (code,name,brand,model,dev_type,subtype,serial_no,dept,
        user_name,company,warranty,price,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(code||'', name, brand||'', model||'', dev_type||'', subtype||'',
           serial_no||'', dept||'', user_name||'', company||'',
           warranty||'', price||0, status||'active');
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/devices/:id', (req, res) => {
  const { code, name, brand, model, dev_type, subtype, serial_no, dept,
          user_name, company, warranty, price, status } = req.body;
  db.prepare(`
    UPDATE devices SET code=?,name=?,brand=?,model=?,dev_type=?,subtype=?,
      serial_no=?,dept=?,user_name=?,company=?,warranty=?,price=?,status=?,
      updated_at=datetime('now','localtime')
    WHERE id=?
  `).run(code||'', name, brand||'', model||'', dev_type||'', subtype||'',
         serial_no||'', dept||'', user_name||'', company||'',
         warranty||'', price||0, status||'active', req.params.id);
  res.json({ ok: true });
});

app.delete('/api/devices/:id', (req, res) => {
  db.prepare('DELETE FROM devices WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ──────────────────────────────────────────
// CATEGORIES
// ──────────────────────────────────────────
app.get('/api/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY name').all());
});

app.post('/api/categories', (req, res) => {
  const { name, icon, color } = req.body;
  try {
    const r = db.prepare('INSERT INTO categories (name,icon,color) VALUES (?,?,?)').run(
      name, icon||'📦', color||'#3b82f6'
    );
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch {
    res.status(400).json({ error: 'ชื่อซ้ำ' });
  }
});

app.put('/api/categories/:id', (req, res) => {
  const { name, icon, color } = req.body;
  db.prepare('UPDATE categories SET name=?,icon=?,color=? WHERE id=?').run(
    name, icon||'📦', color||'#3b82f6', req.params.id
  );
  res.json({ ok: true });
});

app.delete('/api/categories/:id', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ──────────────────────────────────────────
// APPROVERS
// ──────────────────────────────────────────
app.get('/api/approvers', (req, res) => {
  res.json(db.prepare('SELECT * FROM approvers ORDER BY id').all());
});

app.post('/api/approvers', (req, res) => {
  const { name, role } = req.body;
  const r = db.prepare('INSERT INTO approvers (name,role) VALUES (?,?)').run(name, role||'');
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.put('/api/approvers/:id', (req, res) => {
  const { name, role } = req.body;
  db.prepare('UPDATE approvers SET name=?,role=? WHERE id=?').run(name, role||'', req.params.id);
  res.json({ ok: true });
});

app.delete('/api/approvers/:id', (req, res) => {
  db.prepare('DELETE FROM approvers WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ──────────────────────────────────────────
// STOCK LOG
// ──────────────────────────────────────────
app.get('/api/stock-log', (req, res) => {
  res.json(db.prepare(
    'SELECT * FROM stock_log ORDER BY created_at DESC LIMIT 500'
  ).all());
});

// ──────────────────────────────────────────
// BACKUP — export all data as JSON
// ──────────────────────────────────────────
app.get('/api/backup', (req, res) => {
  const data = {
    exported_at: new Date().toISOString(),
    settings: db.prepare('SELECT * FROM settings').all(),
    users: db.prepare(
      'SELECT id,username,name,emp_id,role,dept,active FROM users'
    ).all(),
    stock: db.prepare('SELECT * FROM stock').all(),
    requests: db.prepare('SELECT * FROM requests').all().map(r => ({
      ...r, items: jsonParse(r.items)
    })),
    repairs: db.prepare('SELECT * FROM repairs').all(),
    devices: db.prepare('SELECT * FROM devices').all(),
    categories: db.prepare('SELECT * FROM categories').all(),
    approvers: db.prepare('SELECT * FROM approvers').all(),
  };
  res.setHeader('Content-Disposition',
    `attachment; filename="nteq_backup_${Date.now()}.json"`);
  res.json(data);
});

// ──────────────────────────────────────────
// RESTORE — import JSON backup
// ──────────────────────────────────────────
app.post('/api/restore', (req, res) => {
  const data = req.body;
  const restore = db.transaction(() => {
    if (data.settings) {
      const ups = db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)');
      data.settings.forEach(r => ups.run(r.key, r.value));
    }
    if (data.stock) {
      const ups = db.prepare(
        'INSERT OR REPLACE INTO stock(id,name,unit,cat,qty,min_qty,img) VALUES(?,?,?,?,?,?,?)'
      );
      data.stock.forEach(r =>
        ups.run(r.id,r.name,r.unit||'ตัว',r.cat||'อุปกรณ์ IT',r.qty||0,r.min_qty||10,r.img||'')
      );
    }
    if (data.requests) {
      const ups = db.prepare(`
        INSERT OR REPLACE INTO requests
        (id,name,emp_id,dept,req_type,req_date,urgent,items,remark,status,
         approved_by,approved_at,issued_by,issued_at,reject_reason,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      data.requests.forEach(r => ups.run(
        r.id,r.name,r.emp_id||'',r.dept||'',r.req_type||'',r.req_date||'',
        r.urgent||'normal',JSON.stringify(r.items||[]),r.remark||'',
        r.status||'pending',r.approved_by||'',r.approved_at||'',
        r.issued_by||'',r.issued_at||'',r.reject_reason||'',
        r.created_at||new Date().toISOString()
      ));
    }
    if (data.repairs) {
      const ups = db.prepare(`
        INSERT OR REPLACE INTO repairs
        (id,name,emp_id,dept,rep_type,problem,asset,urgent,status,tech,remark,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      data.repairs.forEach(r => ups.run(
        r.id,r.name,r.emp_id||'',r.dept||'',r.rep_type||'',r.problem||'',
        r.asset||'',r.urgent||'normal',r.status||'open',r.tech||'',
        r.remark||'',r.created_at||new Date().toISOString()
      ));
    }
    if (data.categories) {
      const ups = db.prepare('INSERT OR REPLACE INTO categories(id,name,icon,color) VALUES(?,?,?,?)');
      data.categories.forEach(r => ups.run(r.id,r.name,r.icon||'📦',r.color||'#3b82f6'));
    }
    if (data.approvers) {
      const ups = db.prepare('INSERT OR REPLACE INTO approvers(id,name,role) VALUES(?,?,?)');
      data.approvers.forEach(r => ups.run(r.id,r.name,r.role||''));
    }
  });
  try {
    restore();
    res.json({ ok: true, message: 'กู้คืนข้อมูลสำเร็จ' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ──────────────────────────────────────────
// SPA fallback
// ──────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ──────────────────────────────────────────
// Start
// ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ NTEQ IT Stock Server running at http://localhost:${PORT}`);
  console.log(`📦 Database: ${DB_PATH}`);
});
