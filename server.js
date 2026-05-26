const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'warehouse_secret_key_2024';
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 นาที

// สร้าง DB
const db = new Database('./warehouse.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  emp_id TEXT,
  role TEXT NOT NULL DEFAULT 'staff',
  dept TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stock (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'อัน',
  category TEXT NOT NULL DEFAULT 'อื่นๆ',
  qty INTEGER NOT NULL DEFAULT 0,
  min_qty INTEGER NOT NULL DEFAULT 10,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  requester_name TEXT NOT NULL,
  emp_id TEXT,
  dept TEXT,
  req_type TEXT,
  urgency TEXT DEFAULT 'normal',
  needed_date TEXT,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  issued_by TEXT,
  issued_at TEXT,
  reject_reason TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS request_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(request_id) REFERENCES requests(id)
);

CREATE TABLE IF NOT EXISTS stock_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_id TEXT,
  action TEXT,
  qty_change INTEGER,
  qty_after INTEGER,
  note TEXT,
  done_by TEXT,
  done_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT,
  action TEXT,
  detail TEXT,
  ip TEXT,
  done_at TEXT DEFAULT (datetime('now','localtime'))
);
`);

// ── Seed ข้อมูลเริ่มต้น ────────────────────────────────────────────────────────
function seedData() {
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (userCount === 0) {
    const users = [
      { username: 'admin',     password: bcrypt.hashSync('1234', 10), name: 'ผู้ดูแลระบบ',      role: 'admin',     dept: 'Admin', emp_id: 'EMP-001' },
      { username: 'manager',   password: bcrypt.hashSync('1234', 10), name: 'ผู้จัดการ สมชาย',    role: 'manager',   dept: 'Admin', emp_id: 'EMP-002' },
      { username: 'warehouse', password: bcrypt.hashSync('1234', 10), name: 'เจ้าหน้าที่คลัง',   role: 'warehouse', dept: 'Store', emp_id: 'EMP-003' },
      { username: 'staff',     password: bcrypt.hashSync('1234', 10), name: 'พนักงาน ทดสอบ',      role: 'staff',     dept: 'IT',    emp_id: 'EMP-004' },
    ];
    const ins = db.prepare('INSERT INTO users (username,password,name,role,dept,emp_id) VALUES (?,?,?,?,?,?)');
    users.forEach(u => ins.run(u.username, u.password, u.name, u.role, u.dept, u.emp_id));
  }

  const deptCount = db.prepare('SELECT COUNT(*) as c FROM departments').get().c;
  if (deptCount === 0) {
    const depts = ['QC','MDB','TSR','HP','HR','Admin','Store','RD','Weight','Purchase','Shipping','Account','IT','Production','Maintenance','Logistics','Finance','Marketing','R&D','Quality'];
    const ins = db.prepare('INSERT INTO departments (name) VALUES (?)');
    depts.forEach(d => ins.run(d));
  }

  const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
  if (catCount === 0) {
    const cats = ['เครื่องเขียน','อุปกรณ์สำนักงาน','อุปกรณ์ IT','วัสดุสิ้นเปลือง','เครื่องมือช่าง','วัตถุดิบ','บรรจุภัณฑ์','อุปกรณ์ทำความสะอาด','อื่นๆ'];
    const ins = db.prepare('INSERT INTO categories (name) VALUES (?)');
    cats.forEach(c => ins.run(c));
  }

  const stockCount = db.prepare('SELECT COUNT(*) as c FROM stock').get().c;
  if (stockCount === 0) {
    const items = [
      { id:'ITM-001', name:'กระดาษ A4',           unit:'รีม',  category:'เครื่องเขียน',     qty:50,  min_qty:20 },
      { id:'ITM-002', name:'ปากกาลูกลื่น',         unit:'ด้าม', category:'เครื่องเขียน',     qty:8,   min_qty:20 },
      { id:'ITM-003', name:'แฟ้มเอกสาร',           unit:'อัน',  category:'อุปกรณ์สำนักงาน', qty:30,  min_qty:10 },
      { id:'ITM-004', name:'กล่องเก็บเอกสาร',      unit:'กล่อง',category:'อุปกรณ์สำนักงาน', qty:15,  min_qty:5  },
      { id:'ITM-005', name:'หมึกพิมพ์ HP',          unit:'ตลับ', category:'อุปกรณ์ IT',      qty:5,   min_qty:3  },
      { id:'ITM-006', name:'สายไฟ USB',            unit:'เส้น', category:'อุปกรณ์ IT',      qty:12,  min_qty:5  },
      { id:'ITM-007', name:'เทปใส',                unit:'ม้วน', category:'วัสดุสิ้นเปลือง', qty:3,   min_qty:10 },
      { id:'ITM-008', name:'น้ำยาลบคำผิด',         unit:'ขวด', category:'เครื่องเขียน',     qty:25,  min_qty:10 },
      { id:'ITM-009', name:'ลวดเย็บกระดาษ',        unit:'กล่อง',category:'วัสดุสิ้นเปลือง', qty:40,  min_qty:15 },
      { id:'ITM-010', name:'ไม้บรรทัด 30 ซม.',     unit:'อัน',  category:'เครื่องเขียน',     qty:20,  min_qty:5  },
    ];
    const ins = db.prepare('INSERT INTO stock (id,name,unit,category,qty,min_qty) VALUES (?,?,?,?,?,?)');
    items.forEach(i => ins.run(i.id,i.name,i.unit,i.category,i.qty,i.min_qty));
  }
}
seedData();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function auth(roles = []) {
  return (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      // check session timeout
      if (Date.now() - decoded.loginTime > SESSION_TIMEOUT) {
        return res.status(401).json({ error: 'Session expired', code: 'SESSION_EXPIRED' });
      }
      req.user = decoded;
      if (roles.length && !roles.includes(decoded.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    } catch { res.status(401).json({ error: 'Invalid token' }); }
  };
}

function logActivity(user, action, detail, ip) {
  db.prepare('INSERT INTO activity_logs (user,action,detail,ip) VALUES (?,?,?,?)').run(user, action, detail, ip);
}

// ── Auth API ──────────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    logActivity(username, 'LOGIN_FAIL', 'Invalid credentials', req.ip);
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }
  const token = jwt.sign({
    id: user.id, username: user.username, name: user.name,
    role: user.role, dept: user.dept, emp_id: user.emp_id,
    loginTime: Date.now()
  }, JWT_SECRET, { expiresIn: '8h' });
  logActivity(username, 'LOGIN', 'Success', req.ip);
  res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role, dept: user.dept, emp_id: user.emp_id } });
});

app.post('/api/change-password', auth(), (req, res) => {
  const { old_password, new_password } = req.body;
  if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(old_password, user.password)) return res.status(400).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, req.user.id);
  logActivity(req.user.username, 'CHANGE_PASSWORD', '', req.ip);
  res.json({ ok: true });
});

// ── Departments API ───────────────────────────────────────────────────────────
app.get('/api/departments', auth(), (req, res) => {
  res.json(db.prepare('SELECT * FROM departments WHERE active=1 ORDER BY name').all());
});
app.post('/api/departments', auth(['admin']), (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อแผนก' });
  try {
    const r = db.prepare('INSERT INTO departments (name) VALUES (?)').run(name.trim());
    res.json({ id: r.lastInsertRowid, name: name.trim() });
  } catch { res.status(400).json({ error: 'ชื่อแผนกซ้ำ' }); }
});
app.delete('/api/departments/:id', auth(['admin']), (req, res) => {
  db.prepare('UPDATE departments SET active=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Categories API ────────────────────────────────────────────────────────────
app.get('/api/categories', auth(), (req, res) => {
  res.json(db.prepare('SELECT * FROM categories WHERE active=1 ORDER BY name').all());
});
app.post('/api/categories', auth(['admin']), (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อหมวดหมู่' });
  try {
    const r = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name.trim());
    res.json({ id: r.lastInsertRowid, name: name.trim() });
  } catch { res.status(400).json({ error: 'ชื่อหมวดหมู่ซ้ำ' }); }
});
app.delete('/api/categories/:id', auth(['admin']), (req, res) => {
  db.prepare('UPDATE categories SET active=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Users API ─────────────────────────────────────────────────────────────────
app.get('/api/users', auth(['admin','manager']), (req, res) => {
  res.json(db.prepare('SELECT id,username,name,emp_id,role,dept,active,created_at FROM users ORDER BY id').all());
});
app.post('/api/users', auth(['admin']), (req, res) => {
  const { username, password, name, emp_id, role, dept } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
  if (password.length < 4) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 4 ตัว' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare('INSERT INTO users (username,password,name,emp_id,role,dept) VALUES (?,?,?,?,?,?)').run(username, hash, name, emp_id||'', role||'staff', dept||'');
    logActivity(req.user.username, 'ADD_USER', username, req.ip);
    res.json({ id: r.lastInsertRowid });
  } catch { res.status(400).json({ error: 'Username ซ้ำ' }); }
});
app.put('/api/users/:id', auth(['admin']), (req, res) => {
  const { name, emp_id, role, dept, active, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, req.params.id);
  }
  db.prepare('UPDATE users SET name=?,emp_id=?,role=?,dept=?,active=? WHERE id=?').run(name||u.name, emp_id||u.emp_id, role||u.role, dept||u.dept, active !== undefined ? active : u.active, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/users/:id', auth(['admin']), (req, res) => {
  if (req.params.id == req.user.id) return res.status(400).json({ error: 'ไม่สามารถลบตัวเองได้' });
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Stock API ─────────────────────────────────────────────────────────────────
app.get('/api/stock', auth(), (req, res) => {
  const { q, cat } = req.query;
  let sql = 'SELECT * FROM stock WHERE 1=1';
  const params = [];
  if (q) { sql += ' AND (id LIKE ? OR name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (cat) { sql += ' AND category=?'; params.push(cat); }
  sql += ' ORDER BY name';
  res.json(db.prepare(sql).all(...params));
});
app.post('/api/stock', auth(['admin','warehouse']), (req, res) => {
  const { id, name, unit, category, qty, min_qty } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
  try {
    db.prepare('INSERT INTO stock (id,name,unit,category,qty,min_qty) VALUES (?,?,?,?,?,?)').run(id, name, unit||'อัน', category||'อื่นๆ', qty||0, min_qty||10);
    logActivity(req.user.username, 'ADD_STOCK', id+' '+name, req.ip);
    res.json({ ok: true });
  } catch { res.status(400).json({ error: 'รหัสสินค้าซ้ำ' }); }
});
app.put('/api/stock/:id', auth(['admin','warehouse']), (req, res) => {
  const { name, unit, category, min_qty } = req.body;
  db.prepare('UPDATE stock SET name=?,unit=?,category=?,min_qty=? WHERE id=?').run(name, unit, category, min_qty, req.params.id);
  res.json({ ok: true });
});
app.post('/api/stock/:id/receive', auth(['admin','warehouse']), (req, res) => {
  const { qty, note } = req.body;
  if (!qty || qty <= 0) return res.status(400).json({ error: 'จำนวนต้องมากกว่า 0' });
  const item = db.prepare('SELECT * FROM stock WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'ไม่พบสินค้า' });
  const newQty = item.qty + parseInt(qty);
  db.prepare('UPDATE stock SET qty=? WHERE id=?').run(newQty, req.params.id);
  db.prepare('INSERT INTO stock_logs (stock_id,action,qty_change,qty_after,note,done_by) VALUES (?,?,?,?,?,?)').run(req.params.id, 'RECEIVE', qty, newQty, note||'', req.user.username);
  res.json({ ok: true, qty: newQty });
});

// ── Requests API ──────────────────────────────────────────────────────────────
function genReqId() {
  const d = new Date();
  const prefix = 'REQ-' + d.getFullYear().toString().slice(-2) + String(d.getMonth()+1).padStart(2,'0');
  const last = db.prepare("SELECT id FROM requests WHERE id LIKE ? ORDER BY id DESC LIMIT 1").get(prefix+'%');
  const seq = last ? parseInt(last.id.split('-').pop()) + 1 : 1;
  return prefix + '-' + String(seq).padStart(4, '0');
}

app.get('/api/requests', auth(), (req, res) => {
  const { status, dept, month, q } = req.query;
  let sql = 'SELECT r.*,(SELECT COUNT(*) FROM request_items WHERE request_id=r.id) as item_count FROM requests r WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND r.status=?'; params.push(status); }
  if (dept) { sql += ' AND r.dept=?'; params.push(dept); }
  if (month) { sql += ' AND strftime("%Y-%m",r.created_at)=?'; params.push(month); }
  if (q) { sql += ' AND (r.id LIKE ? OR r.requester_name LIKE ? OR r.dept LIKE ?)'; params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  if (req.user.role === 'staff') { sql += ' AND r.created_by=?'; params.push(req.user.username); }
  sql += ' ORDER BY r.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});
app.get('/api/requests/:id', auth(), (req, res) => {
  const r = db.prepare('SELECT * FROM requests WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'ไม่พบใบเบิก' });
  r.items = db.prepare('SELECT * FROM request_items WHERE request_id=?').all(req.params.id);
  res.json(r);
});
app.post('/api/requests', auth(), (req, res) => {
  const { requester_name, emp_id, dept, req_type, urgency, needed_date, remark, items } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: 'กรุณาเพิ่มรายการสินค้า' });
  const id = genReqId();
  db.prepare('INSERT INTO requests (id,requester_name,emp_id,dept,req_type,urgency,needed_date,remark,created_by) VALUES (?,?,?,?,?,?,?,?,?)').run(id, requester_name, emp_id||'', dept||'', req_type||'เบิกใช้งาน', urgency||'normal', needed_date||'', remark||'', req.user.username);
  const insItem = db.prepare('INSERT INTO request_items (request_id,item_name,qty) VALUES (?,?,?)');
  items.forEach(it => insItem.run(id, it.name, it.qty));
  logActivity(req.user.username, 'CREATE_REQUEST', id, req.ip);
  res.json({ ok: true, id });
});
app.put('/api/requests/:id/approve', auth(['admin','manager']), (req, res) => {
  db.prepare("UPDATE requests SET status='approved',approved_by=?,approved_at=datetime('now','localtime') WHERE id=?").run(req.user.username, req.params.id);
  logActivity(req.user.username, 'APPROVE', req.params.id, req.ip);
  res.json({ ok: true });
});
app.put('/api/requests/:id/reject', auth(['admin','manager']), (req, res) => {
  const { reason } = req.body;
  db.prepare("UPDATE requests SET status='rejected',reject_reason=?,approved_by=?,approved_at=datetime('now','localtime') WHERE id=?").run(reason||'', req.user.username, req.params.id);
  logActivity(req.user.username, 'REJECT', req.params.id, req.ip);
  res.json({ ok: true });
});
app.put('/api/requests/:id/issue', auth(['admin','warehouse']), (req, res) => {
  const req_data = db.prepare('SELECT * FROM requests WHERE id=?').get(req.params.id);
  if (!req_data || req_data.status !== 'approved') return res.status(400).json({ error: 'ใบเบิกต้องได้รับการอนุมัติก่อน' });
  const items = db.prepare('SELECT * FROM request_items WHERE request_id=?').all(req.params.id);
  // ตัด stock
  const updateStock = db.prepare('UPDATE stock SET qty=MAX(0,qty-?) WHERE id=?');
  const logStock = db.prepare('INSERT INTO stock_logs (stock_id,action,qty_change,qty_after,note,done_by) VALUES (?,?,?,?,?,?)');
  items.forEach(it => {
    const stockItem = db.prepare('SELECT * FROM stock WHERE name=?').get(it.item_name);
    if (stockItem) {
      const newQty = Math.max(0, stockItem.qty - it.qty);
      updateStock.run(it.qty, stockItem.id);
      logStock.run(stockItem.id, 'ISSUE', -it.qty, newQty, req.params.id, req.user.username);
    }
  });
  db.prepare("UPDATE requests SET status='issued',issued_by=?,issued_at=datetime('now','localtime') WHERE id=?").run(req.user.username, req.params.id);
  logActivity(req.user.username, 'ISSUE', req.params.id, req.ip);
  res.json({ ok: true });
});

// ── Reports API ───────────────────────────────────────────────────────────────
app.get('/api/reports/summary', auth(['admin','manager']), (req, res) => {
  const { month } = req.query;
  const filter = month ? ` AND strftime('%Y-%m',created_at)='${month}'` : '';
  const total   = db.prepare(`SELECT COUNT(*) as c FROM requests WHERE 1=1${filter}`).get().c;
  const pending = db.prepare(`SELECT COUNT(*) as c FROM requests WHERE status='pending'${filter}`).get().c;
  const approved= db.prepare(`SELECT COUNT(*) as c FROM requests WHERE status='approved'${filter}`).get().c;
  const issued  = db.prepare(`SELECT COUNT(*) as c FROM requests WHERE status='issued'${filter}`).get().c;
  const rejected= db.prepare(`SELECT COUNT(*) as c FROM requests WHERE status='rejected'${filter}`).get().c;
  const topItems= db.prepare(`SELECT ri.item_name, SUM(ri.qty) as total FROM request_items ri JOIN requests r ON r.id=ri.request_id WHERE r.status='issued'${filter} GROUP BY ri.item_name ORDER BY total DESC LIMIT 10`).all();
  const byDept  = db.prepare(`SELECT dept, COUNT(*) as count FROM requests WHERE 1=1${filter} GROUP BY dept ORDER BY count DESC`).all();
  const byMonth = db.prepare("SELECT strftime('%Y-%m',created_at) as month, COUNT(*) as count FROM requests GROUP BY month ORDER BY month DESC LIMIT 12").all();
  const lowStock= db.prepare('SELECT * FROM stock WHERE qty<=min_qty ORDER BY qty ASC').all();
  res.json({ total, pending, approved, issued, rejected, topItems, byDept, byMonth, lowStock });
});

app.get('/api/activity-logs', auth(['admin']), (req, res) => {
  res.json(db.prepare('SELECT * FROM activity_logs ORDER BY done_at DESC LIMIT 200').all());
});

// ── Serve frontend ────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 ระบบเบิกจ่ายสินค้าคลัง`);
  console.log(`   URL: http://localhost:${PORT}`);
  console.log(`   DB:  warehouse.db`);
  console.log(`   Session timeout: 30 นาที\n`);
});
