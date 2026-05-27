const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'nteq-secret-key-2024';
const PORT = process.env.PORT || 3000;

// ===== AUTH MIDDLEWARE =====
function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// ===== DB INIT =====
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      emp_id VARCHAR(100),
      role VARCHAR(50) DEFAULT 'staff',
      dept VARCHAR(100),
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS stock (
      id SERIAL PRIMARY KEY,
      code VARCHAR(100) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(100) DEFAULT 'อุปกรณ์ IT',
      unit VARCHAR(50) DEFAULT 'ตัว',
      qty INTEGER DEFAULT 0,
      min_qty INTEGER DEFAULT 10,
      img TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS requests (
      id SERIAL PRIMARY KEY,
      req_no VARCHAR(50) UNIQUE NOT NULL,
      requester_name VARCHAR(255),
      emp_id VARCHAR(100),
      dept VARCHAR(100),
      req_type VARCHAR(100),
      req_date DATE,
      urgency VARCHAR(50) DEFAULT 'normal',
      items JSONB DEFAULT '[]',
      remark TEXT,
      status VARCHAR(50) DEFAULT 'pending',
      approved_by VARCHAR(255),
      approved_at TIMESTAMP,
      issued_by VARCHAR(255),
      issued_at TIMESTAMP,
      rejected_reason TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS repairs (
      id SERIAL PRIMARY KEY,
      rep_no VARCHAR(50) UNIQUE NOT NULL,
      reporter_name VARCHAR(255),
      emp_id VARCHAR(100),
      dept VARCHAR(100),
      device_type VARCHAR(100),
      symptom TEXT,
      status VARCHAR(50) DEFAULT 'open',
      assigned_to VARCHAR(255),
      note TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS stock_logs (
      id SERIAL PRIMARY KEY,
      stock_id INTEGER REFERENCES stock(id),
      action VARCHAR(50),
      qty_change INTEGER,
      qty_after INTEGER,
      remark TEXT,
      req_no VARCHAR(50),
      done_by VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS approvers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      position VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) UNIQUE NOT NULL,
      icon VARCHAR(10) DEFAULT '📦',
      color VARCHAR(20) DEFAULT '#3b82f6',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS devices (
      id SERIAL PRIMARY KEY,
      code VARCHAR(100) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      brand VARCHAR(100),
      model VARCHAR(100),
      device_type VARCHAR(100),
      subtype VARCHAR(100),
      serial_no VARCHAR(100),
      dept VARCHAR(100),
      assigned_user VARCHAR(255),
      company VARCHAR(255),
      warranty VARCHAR(255),
      price NUMERIC(12,2) DEFAULT 0,
      status VARCHAR(50) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Default admin user
  const exists = await pool.query(`SELECT id FROM users WHERE username = 'admin'`);
  if (exists.rows.length === 0) {
    const hash = await bcrypt.hash('1234', 10);
    await pool.query(`
      INSERT INTO users (username, password, name, role, dept) VALUES
        ('admin',   $1, 'Administrator', 'admin',   'IT'),
        ('manager', $1, 'ผู้จัดการ',       'manager', 'Admin'),
        ('itstock', $1, 'เจ้าหน้าที่ IT',   'itstock', 'IT'),
        ('staff',   $1, 'พนักงาน',         'staff',   'General')
      ON CONFLICT (username) DO NOTHING
    `, [hash]);
  }

  // Default categories
  await pool.query(`
    INSERT INTO categories (name, icon, color) VALUES
      ('อุปกรณ์ IT',  '💻', '#3b82f6'),
      ('เครือข่าย',   '🌐', '#06b6d4'),
      ('อุปกรณ์สำนักงาน', '🖨️', '#10b981'),
      ('สายและอุปกรณ์', '🔌', '#f59e0b'),
      ('อื่นๆ', '📦', '#6b7280')
    ON CONFLICT (name) DO NOTHING
  `);

  // Default settings
  await pool.query(`
    INSERT INTO settings (key, value) VALUES
      ('company_name', 'NTEQ Polymer'),
      ('company_address', ''),
      ('low_stock_alert', 'true'),
      ('print_approver', 'true')
    ON CONFLICT (key) DO NOTHING
  `);

  console.log('✅ Database initialized');
}

// ===== AUTH ROUTES =====
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const r = await pool.query(`SELECT * FROM users WHERE username=$1 AND active=true`, [username]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user = r.rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role, dept: user.dept, emp_id: user.emp_id }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role, dept: user.dept, emp_id: user.emp_id } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/me', authMiddleware, (req, res) => res.json(req.user));

// ===== STOCK ROUTES =====
app.get('/api/stock', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM stock ORDER BY category, name`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/stock', authMiddleware, requireRole('admin', 'itstock', 'manager'), async (req, res) => {
  const { code, name, category, unit, qty, min_qty, img } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO stock (code, name, category, unit, qty, min_qty, img) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [code, name, category || 'อุปกรณ์ IT', unit || 'ตัว', qty || 0, min_qty || 10, img || '']
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/stock/:id', authMiddleware, requireRole('admin', 'itstock', 'manager'), async (req, res) => {
  const { code, name, category, unit, qty, min_qty, img } = req.body;
  try {
    const r = await pool.query(
      `UPDATE stock SET code=$1, name=$2, category=$3, unit=$4, qty=$5, min_qty=$6, img=$7 WHERE id=$8 RETURNING *`,
      [code, name, category, unit, qty, min_qty, img, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/stock/:id', authMiddleware, requireRole('admin', 'itstock'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM stock WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/stock/:id/receive', authMiddleware, requireRole('admin', 'itstock', 'manager'), async (req, res) => {
  const { qty, remark } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const st = await client.query(`SELECT * FROM stock WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (!st.rows.length) throw new Error('Stock not found');
    const newQty = st.rows[0].qty + parseInt(qty);
    await client.query(`UPDATE stock SET qty=$1 WHERE id=$2`, [newQty, req.params.id]);
    await client.query(
      `INSERT INTO stock_logs (stock_id, action, qty_change, qty_after, remark, done_by) VALUES ($1,'receive',$2,$3,$4,$5)`,
      [req.params.id, qty, newQty, remark || '', req.user.name]
    );
    await client.query('COMMIT');
    res.json({ qty: newQty });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ===== REQUEST ROUTES =====
app.get('/api/requests', authMiddleware, async (req, res) => {
  try {
    let q = `SELECT r.*, u.name as creator_name FROM requests r LEFT JOIN users u ON r.created_by=u.id`;
    const params = [];
    if (req.user.role === 'staff') {
      q += ` WHERE r.created_by=$1`;
      params.push(req.user.id);
    }
    q += ` ORDER BY r.created_at DESC`;
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/requests', authMiddleware, async (req, res) => {
  const { requester_name, emp_id, dept, req_type, req_date, urgency, items, remark } = req.body;
  try {
    const count = await pool.query(`SELECT COUNT(*) FROM requests`);
    const seq = parseInt(count.rows[0].count) + 1;
    const now = new Date();
    const req_no = `REQ-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}-${String(seq).padStart(4,'0')}`;
    const r = await pool.query(
      `INSERT INTO requests (req_no, requester_name, emp_id, dept, req_type, req_date, urgency, items, remark, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req_no, requester_name, emp_id, dept, req_type, req_date, urgency, JSON.stringify(items), remark, req.user.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/requests/:id/approve', authMiddleware, requireRole('admin', 'manager', 'itstock'), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE requests SET status='approved', approved_by=$1, approved_at=NOW() WHERE id=$2 RETURNING *`,
      [req.user.name, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/requests/:id/reject', authMiddleware, requireRole('admin', 'manager'), async (req, res) => {
  const { reason } = req.body;
  try {
    const r = await pool.query(
      `UPDATE requests SET status='rejected', rejected_reason=$1, approved_by=$2, approved_at=NOW() WHERE id=$3 RETURNING *`,
      [reason || '', req.user.name, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/requests/:id/issue', authMiddleware, requireRole('admin', 'itstock', 'manager'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reqData = await client.query(`SELECT * FROM requests WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (!reqData.rows.length) throw new Error('Request not found');
    const request = reqData.rows[0];
    const items = request.items;

    for (const item of items) {
      const st = await client.query(`SELECT * FROM stock WHERE LOWER(name) LIKE LOWER($1) LIMIT 1`, [`%${item.name}%`]);
      if (st.rows.length) {
        const s = st.rows[0];
        const newQty = Math.max(0, s.qty - (item.qty || 1));
        await client.query(`UPDATE stock SET qty=$1 WHERE id=$2`, [newQty, s.id]);
        await client.query(
          `INSERT INTO stock_logs (stock_id, action, qty_change, qty_after, remark, req_no, done_by) VALUES ($1,'issue',$2,$3,$4,$5,$6)`,
          [s.id, -(item.qty || 1), newQty, `ใบเบิก ${request.req_no}`, request.req_no, req.user.name]
        );
      }
    }

    await client.query(
      `UPDATE requests SET status='issued', issued_by=$1, issued_at=NOW() WHERE id=$2`,
      [req.user.name, req.params.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ===== REPAIR ROUTES =====
app.get('/api/repairs', authMiddleware, async (req, res) => {
  try {
    let q = `SELECT r.*, u.name as creator_name FROM repairs r LEFT JOIN users u ON r.created_by=u.id`;
    const params = [];
    if (req.user.role === 'staff') {
      q += ` WHERE r.created_by=$1`;
      params.push(req.user.id);
    }
    q += ` ORDER BY r.created_at DESC`;
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/repairs', authMiddleware, async (req, res) => {
  const { reporter_name, emp_id, dept, device_type, symptom } = req.body;
  try {
    const count = await pool.query(`SELECT COUNT(*) FROM repairs`);
    const seq = parseInt(count.rows[0].count) + 1;
    const now = new Date();
    const rep_no = `REP-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}-${String(seq).padStart(4,'0')}`;
    const r = await pool.query(
      `INSERT INTO repairs (rep_no, reporter_name, emp_id, dept, device_type, symptom, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [rep_no, reporter_name, emp_id, dept, device_type, symptom, req.user.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/repairs/:id', authMiddleware, requireRole('admin', 'itstock', 'manager'), async (req, res) => {
  const { status, assigned_to, note } = req.body;
  try {
    const r = await pool.query(
      `UPDATE repairs SET status=COALESCE($1,status), assigned_to=COALESCE($2,assigned_to), note=COALESCE($3,note), updated_at=NOW() WHERE id=$4 RETURNING *`,
      [status, assigned_to, note, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== USERS ROUTES =====
app.get('/api/users', authMiddleware, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, username, name, emp_id, role, dept, active, created_at FROM users ORDER BY name`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', authMiddleware, requireRole('admin'), async (req, res) => {
  const { username, password, name, emp_id, role, dept } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users (username, password, name, emp_id, role, dept) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, username, name, emp_id, role, dept, active`,
      [username, hash, name, emp_id, role, dept]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { name, emp_id, role, dept, active, password } = req.body;
  try {
    let q, params;
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      q = `UPDATE users SET name=$1, emp_id=$2, role=$3, dept=$4, active=$5, password=$6 WHERE id=$7 RETURNING id, username, name, emp_id, role, dept, active`;
      params = [name, emp_id, role, dept, active, hash, req.params.id];
    } else {
      q = `UPDATE users SET name=$1, emp_id=$2, role=$3, dept=$4, active=$5 WHERE id=$6 RETURNING id, username, name, emp_id, role, dept, active`;
      params = [name, emp_id, role, dept, active, req.params.id];
    }
    const r = await pool.query(q, params);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await pool.query(`UPDATE users SET active=false WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== DEVICES ROUTES =====
app.get('/api/devices', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM devices ORDER BY code`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/devices', authMiddleware, requireRole('admin', 'itstock', 'manager'), async (req, res) => {
  const { code, name, brand, model, device_type, subtype, serial_no, dept, assigned_user, company, warranty, price, status } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO devices (code, name, brand, model, device_type, subtype, serial_no, dept, assigned_user, company, warranty, price, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [code, name, brand, model, device_type, subtype, serial_no, dept, assigned_user, company, warranty, price || 0, status || 'active']
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/devices/:id', authMiddleware, requireRole('admin', 'itstock', 'manager'), async (req, res) => {
  const { code, name, brand, model, device_type, subtype, serial_no, dept, assigned_user, company, warranty, price, status } = req.body;
  try {
    const r = await pool.query(
      `UPDATE devices SET code=$1, name=$2, brand=$3, model=$4, device_type=$5, subtype=$6, serial_no=$7, dept=$8, assigned_user=$9, company=$10, warranty=$11, price=$12, status=$13 WHERE id=$14 RETURNING *`,
      [code, name, brand, model, device_type, subtype, serial_no, dept, assigned_user, company, warranty, price || 0, status, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/devices/:id', authMiddleware, requireRole('admin', 'itstock'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM devices WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== SETTINGS ROUTES =====
app.get('/api/settings', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`SELECT key, value FROM settings`);
    const obj = {};
    r.rows.forEach(row => obj[row.key] = row.value);
    res.json(obj);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/settings', authMiddleware, requireRole('admin', 'manager'), async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      await pool.query(`INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`, [key, String(value)]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== CATEGORIES ROUTES =====
app.get('/api/categories', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM categories ORDER BY name`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/categories', authMiddleware, requireRole('admin', 'manager'), async (req, res) => {
  const { name, icon, color } = req.body;
  try {
    const r = await pool.query(`INSERT INTO categories (name, icon, color) VALUES ($1,$2,$3) ON CONFLICT (name) DO NOTHING RETURNING *`, [name, icon || '📦', color || '#3b82f6']);
    res.json(r.rows[0] || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/categories/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM categories WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== APPROVERS ROUTES =====
app.get('/api/approvers', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM approvers ORDER BY id`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/approvers', authMiddleware, requireRole('admin', 'manager'), async (req, res) => {
  const { name, position } = req.body;
  try {
    const r = await pool.query(`INSERT INTO approvers (name, position) VALUES ($1,$2) RETURNING *`, [name, position || '']);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/approvers/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM approvers WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== STATS ROUTE =====
app.get('/api/stats', authMiddleware, async (req, res) => {
  try {
    const [stockCount, reqCount, pendingCount, repairCount, lowStock] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total, COALESCE(SUM(qty),0) as total_qty FROM stock`),
      pool.query(`SELECT COUNT(*) as total FROM requests`),
      pool.query(`SELECT COUNT(*) as total FROM requests WHERE status='pending'`),
      pool.query(`SELECT COUNT(*) as total FROM repairs WHERE status NOT IN ('done','complete')`),
      pool.query(`SELECT COUNT(*) as total FROM stock WHERE qty <= min_qty`)
    ]);
    res.json({
      stock: { total: parseInt(stockCount.rows[0].total), total_qty: parseInt(stockCount.rows[0].total_qty) },
      requests: { total: parseInt(reqCount.rows[0].total), pending: parseInt(pendingCount.rows[0].total) },
      repairs: { active: parseInt(repairCount.rows[0].total) },
      low_stock: parseInt(lowStock.rows[0].total)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== STOCK LOGS =====
app.get('/api/stock-logs', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`SELECT l.*, s.name as stock_name FROM stock_logs l LEFT JOIN stock s ON l.stock_id=s.id ORDER BY l.created_at DESC LIMIT 200`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== STATIC FALLBACK =====
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ===== START =====
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 NTEQ IT Stock System running on port ${PORT}`));
}).catch(e => {
  console.error('DB init failed:', e);
  process.exit(1);
});
