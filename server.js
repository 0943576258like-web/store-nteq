const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'nteq_it.db');

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data dir
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

// DB Connection
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error('DB Error:', err.message); process.exit(1); }
  console.log('✅ Connected to SQLite:', DB_PATH);
});

// Init Tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT,
    emp_id TEXT,
    role TEXT DEFAULT 'staff',
    dept TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS stock (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    unit TEXT DEFAULT 'ตัว',
    category TEXT DEFAULT 'อุปกรณ์ IT',
    qty INTEGER DEFAULT 0,
    min_qty INTEGER DEFAULT 10,
    img TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    requester_name TEXT,
    emp_id TEXT,
    dept TEXT,
    req_type TEXT,
    urgent TEXT DEFAULT 'normal',
    req_date TEXT,
    items TEXT,
    remark TEXT,
    status TEXT DEFAULT 'pending',
    approved_by TEXT,
    approved_at TEXT,
    issued_by TEXT,
    issued_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS repairs (
    id TEXT PRIMARY KEY,
    reporter_name TEXT,
    emp_id TEXT,
    dept TEXT,
    device_type TEXT,
    symptom TEXT,
    urgency TEXT DEFAULT 'normal',
    assigned_to TEXT,
    status TEXT DEFAULT 'open',
    note TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    brand TEXT,
    model TEXT,
    device_type TEXT,
    subtype TEXT,
    serial_no TEXT,
    dept TEXT,
    user_name TEXT,
    company TEXT,
    warranty TEXT,
    price REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    icon TEXT DEFAULT '📦',
    color TEXT DEFAULT '#3b82f6'
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  // ── SRP SYNC: เก็บ snapshot ข้อมูล (users/stock/requests/repairs/devices/settings/counters)
  //    เป็น JSON blob เดียว เพื่อให้ index.html (SrpSync) ใช้งานผ่าน /api/store, /api/push, WebSocket
  db.run(`CREATE TABLE IF NOT EXISTS kv_store (
    k TEXT PRIMARY KEY,
    v TEXT
  )`);

  // Default users
  db.get("SELECT COUNT(*) as c FROM users", (err, row) => {
    if (row && row.c === 0) {
      const defaults = [
        ['admin','1234','ผู้ดูแลระบบ','EMP-0001','admin','IT'],
        ['manager','1234','ผู้จัดการ','EMP-0002','manager','Management'],
        ['itstock','1234','เจ้าหน้าที่ IT','EMP-0003','warehouse','IT'],
        ['staff','1234','พนักงาน','EMP-0004','staff','QC']
      ];
      defaults.forEach(([u,p,n,e,r,d]) => {
        db.run("INSERT OR IGNORE INTO users(username,password,name,emp_id,role,dept) VALUES(?,?,?,?,?,?)",[u,p,n,e,r,d]);
      });
      console.log('✅ Default users created');
    }
  });

  // Default categories
  db.get("SELECT COUNT(*) as c FROM categories", (err, row) => {
    if (row && row.c === 0) {
      const cats = [['อุปกรณ์ IT','💻','#3b82f6'],['เครือข่าย','🌐','#10b981'],['เครื่องพิมพ์','🖨️','#f59e0b'],['สายเคเบิล','🔌','#8b5cf6'],['อุปกรณ์สำรอง','📦','#ef4444']];
      cats.forEach(([n,i,c]) => db.run("INSERT OR IGNORE INTO categories(name,icon,color) VALUES(?,?,?)",[n,i,c]));
    }
  });

  // Default stock
  db.get("SELECT COUNT(*) as c FROM stock", (err, row) => {
    if (row && row.c === 0) {
      const items = [
        ['IT-001','สาย LAN Cat6','เส้น','เครือข่าย',50,10],
        ['IT-002','USB Flash Drive 32GB','ตัว','อุปกรณ์ IT',20,5],
        ['IT-003','เมาส์ Optical','ตัว','อุปกรณ์ IT',15,3],
        ['IT-004','คีย์บอร์ด USB','ตัว','อุปกรณ์ IT',10,2],
        ['IT-005','หมึกพิมพ์ HP LaserJet','ตลับ','เครื่องพิมพ์',8,2],
      ];
      items.forEach(([id,n,u,c,q,m]) => db.run("INSERT OR IGNORE INTO stock(id,name,unit,category,qty,min_qty) VALUES(?,?,?,?,?,?)",[id,n,u,c,q,m]));
      console.log('✅ Default stock created');
    }
  });

  console.log('✅ Database initialized');
});

const run = (sql, params=[]) => new Promise((res,rej) => db.run(sql,params,(err)=>err?rej(err):res()));
const all = (sql, params=[]) => new Promise((res,rej) => db.all(sql,params,(err,rows)=>err?rej(err):res(rows)));
const get = (sql, params=[]) => new Promise((res,rej) => db.get(sql,params,(err,row)=>err?rej(err):res(row)));

// ═══════════════════════════════════════════════════════════════════════
//  SRP SYNC STORE — JSON blob เก็บใน kv_store (key = 'srp_store')
//  รองรับ users, stock, requests, repairs, devices, settings,
//  repairSettings, counters ตามที่ index.html (SrpSync) คาดหวัง
// ═══════════════════════════════════════════════════════════════════════
const SRP_STORE_KEY = 'srp_store';

function srpLoadStore() {
  return new Promise((resolve) => {
    db.get("SELECT v FROM kv_store WHERE k=?", [SRP_STORE_KEY], (err, row) => {
      if (err || !row || !row.v) return resolve({});
      try { resolve(JSON.parse(row.v) || {}); } catch(e) { resolve({}); }
    });
  });
}

function srpSaveStore(store) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(store || {});
    db.run("INSERT INTO kv_store(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", [SRP_STORE_KEY, json], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// merge partial payload เข้ากับ store เดิม (deep-ish merge สำหรับ key ที่รู้จัก)
function srpMergeStore(store, partial) {
  store = store || {};
  if (!partial || typeof partial !== 'object') return store;

  if (Array.isArray(partial.users))    store.users    = partial.users;
  if (Array.isArray(partial.stock))    store.stock    = partial.stock;
  if (Array.isArray(partial.requests)) store.requests = partial.requests;
  if (Array.isArray(partial.repairs))  store.repairs  = partial.repairs;
  if (Array.isArray(partial.devices))  store.devices  = partial.devices;

  if (partial.settings && typeof partial.settings === 'object') {
    store.settings = Object.assign({}, store.settings || {}, partial.settings);
  }
  if (partial.repairSettings && typeof partial.repairSettings === 'object') {
    store.repairSettings = Object.assign({}, store.repairSettings || {}, partial.repairSettings);
  }
  if (partial.counters && typeof partial.counters === 'object') {
    store.counters = Object.assign({}, store.counters || {}, partial.counters);
  }
  return store;
}

// === AUTH ===
app.post('/api/login', async (req,res) => {
  try {
    const { username, password } = req.body;
    const user = await get("SELECT * FROM users WHERE username=? AND password=? AND active=1",[username,password]);
    if (!user) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    res.json({ success: true, user: { id: user.id, username: user.username, name: user.name, emp_id: user.emp_id, role: user.role, dept: user.dept } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// === STOCK ===
app.get('/api/stock', async (req,res) => { try { res.json(await all("SELECT * FROM stock ORDER BY category,name")); } catch(e){ res.status(500).json({error:e.message}); }});
app.post('/api/stock', async (req,res) => {
  try {
    const s = req.body;
    await run(`INSERT OR REPLACE INTO stock(id,name,unit,category,qty,min_qty,img,updated_at) VALUES(?,?,?,?,?,?,?,datetime('now','localtime'))`,[s.id,s.name,s.unit||'ตัว',s.category||'อุปกรณ์ IT',s.qty||0,s.min_qty||10,s.img||'']);
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.put('/api/stock/:id', async (req,res) => {
  try {
    const s = req.body;
    await run(`UPDATE stock SET name=?,unit=?,category=?,qty=?,min_qty=?,img=?,updated_at=datetime('now','localtime') WHERE id=?`,[s.name,s.unit,s.category,s.qty,s.min_qty,s.img||'',req.params.id]);
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/stock/:id', async (req,res) => { try { await run("DELETE FROM stock WHERE id=?",[req.params.id]); res.json({success:true}); } catch(e){res.status(500).json({error:e.message});} });
app.post('/api/stock/:id/receive', async (req,res) => {
  try {
    const { qty } = req.body;
    await run("UPDATE stock SET qty=qty+?,updated_at=datetime('now','localtime') WHERE id=?",[qty,req.params.id]);
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/stock/:id/deduct', async (req,res) => {
  try {
    const { qty } = req.body;
    await run("UPDATE stock SET qty=MAX(0,qty-?),updated_at=datetime('now','localtime') WHERE id=?",[qty,req.params.id]);
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// === REQUESTS ===
app.get('/api/requests', async (req,res) => { try { const rows = await all("SELECT * FROM requests ORDER BY created_at DESC"); res.json(rows.map(r=>({...r,items:JSON.parse(r.items||'[]')}))); } catch(e){res.status(500).json({error:e.message});} });
app.post('/api/requests', async (req,res) => {
  try {
    const r = req.body;
    await run(`INSERT INTO requests(id,requester_name,emp_id,dept,req_type,urgent,req_date,items,remark,status) VALUES(?,?,?,?,?,?,?,?,?,?)`,[r.id,r.requester_name,r.emp_id,r.dept,r.req_type,r.urgent||'normal',r.req_date,JSON.stringify(r.items||[]),r.remark||'','pending']);
    res.json({ success: true, id: r.id });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.put('/api/requests/:id', async (req,res) => {
  try {
    const r = req.body;
    const fields = [], vals = [];
    if (r.status !== undefined) { fields.push('status=?'); vals.push(r.status); }
    if (r.approved_by !== undefined) { fields.push('approved_by=?'); vals.push(r.approved_by); }
    if (r.approved_at !== undefined) { fields.push('approved_at=?'); vals.push(r.approved_at); }
    if (r.issued_by !== undefined) { fields.push('issued_by=?'); vals.push(r.issued_by); }
    if (r.issued_at !== undefined) { fields.push('issued_at=?'); vals.push(r.issued_at); }
    vals.push(req.params.id);
    await run(`UPDATE requests SET ${fields.join(',')} WHERE id=?`, vals);
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/requests/:id', async (req,res) => { try { await run("DELETE FROM requests WHERE id=?",[req.params.id]); res.json({success:true}); } catch(e){res.status(500).json({error:e.message});} });

// === REPAIRS ===
app.get('/api/repairs', async (req,res) => { try { res.json(await all("SELECT * FROM repairs ORDER BY created_at DESC")); } catch(e){res.status(500).json({error:e.message});} });
app.post('/api/repairs', async (req,res) => {
  try {
    const r = req.body;
    await run(`INSERT INTO repairs(id,reporter_name,emp_id,dept,device_type,symptom,urgency,status) VALUES(?,?,?,?,?,?,?,?)`,[r.id,r.reporter_name,r.emp_id,r.dept,r.device_type,r.symptom,r.urgency||'normal','open']);
    res.json({ success: true, id: r.id });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.put('/api/repairs/:id', async (req,res) => {
  try {
    const r = req.body;
    const fields = [], vals = [];
    ['status','assigned_to','note'].forEach(k => { if(r[k]!==undefined){fields.push(k+'=?');vals.push(r[k]);} });
    fields.push("updated_at=datetime('now','localtime')");
    vals.push(req.params.id);
    await run(`UPDATE repairs SET ${fields.join(',')} WHERE id=?`, vals);
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/repairs/:id', async (req,res) => { try { await run("DELETE FROM repairs WHERE id=?",[req.params.id]); res.json({success:true}); } catch(e){res.status(500).json({error:e.message});} });

// === DEVICES ===
app.get('/api/devices', async (req,res) => { try { res.json(await all("SELECT * FROM devices ORDER BY created_at DESC")); } catch(e){res.status(500).json({error:e.message});} });
app.post('/api/devices', async (req,res) => {
  try {
    const d = req.body;
    await run(`INSERT INTO devices(code,name,brand,model,device_type,subtype,serial_no,dept,user_name,company,warranty,price,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,[d.code,d.name,d.brand||'',d.model||'',d.device_type||'',d.subtype||'',d.serial_no||'',d.dept||'',d.user_name||'',d.company||'',d.warranty||'',d.price||0,d.status||'active']);
    const row = await get("SELECT last_insert_rowid() as id");
    res.json({ success: true, id: row.id });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.put('/api/devices/:id', async (req,res) => {
  try {
    const d = req.body;
    await run(`UPDATE devices SET code=?,name=?,brand=?,model=?,device_type=?,subtype=?,serial_no=?,dept=?,user_name=?,company=?,warranty=?,price=?,status=? WHERE id=?`,[d.code,d.name,d.brand,d.model,d.device_type,d.subtype,d.serial_no,d.dept,d.user_name,d.company,d.warranty,d.price,d.status,req.params.id]);
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/devices/:id', async (req,res) => { try { await run("DELETE FROM devices WHERE id=?",[req.params.id]); res.json({success:true}); } catch(e){res.status(500).json({error:e.message});} });

// === CATEGORIES ===
app.get('/api/categories', async (req,res) => { try { res.json(await all("SELECT * FROM categories ORDER BY name")); } catch(e){res.status(500).json({error:e.message});} });
app.post('/api/categories', async (req,res) => {
  try {
    const c = req.body;
    await run("INSERT OR IGNORE INTO categories(name,icon,color) VALUES(?,?,?)",[c.name,c.icon||'📦',c.color||'#3b82f6']);
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/categories/:name', async (req,res) => { try { await run("DELETE FROM categories WHERE name=?",[decodeURIComponent(req.params.name)]); res.json({success:true}); } catch(e){res.status(500).json({error:e.message});} });

// === USERS ===
app.get('/api/users', async (req,res) => { try { res.json(await all("SELECT id,username,name,emp_id,role,dept,active,created_at FROM users ORDER BY id")); } catch(e){res.status(500).json({error:e.message});} });
app.post('/api/users', async (req,res) => {
  try {
    const u = req.body;
    await run("INSERT INTO users(username,password,name,emp_id,role,dept,active) VALUES(?,?,?,?,?,?,1)",[u.username,u.password,u.name||'',u.emp_id||'',u.role||'staff',u.dept||'']);
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.put('/api/users/:id', async (req,res) => {
  try {
    const u = req.body;
    const fields = [], vals = [];
    ['name','emp_id','role','dept','active'].forEach(k => { if(u[k]!==undefined){fields.push(k+'=?');vals.push(u[k]);} });
    if (u.password) { fields.push('password=?'); vals.push(u.password); }
    vals.push(req.params.id);
    await run(`UPDATE users SET ${fields.join(',')} WHERE id=?`, vals);
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/users/:id', async (req,res) => { try { await run("DELETE FROM users WHERE id=?",[req.params.id]); res.json({success:true}); } catch(e){res.status(500).json({error:e.message});} });

// === SETTINGS ===
app.get('/api/settings', async (req,res) => {
  try {
    const rows = await all("SELECT key,value FROM settings");
    const obj = {};
    rows.forEach(r => { try { obj[r.key] = JSON.parse(r.value); } catch(e) { obj[r.key] = r.value; } });
    res.json(obj);
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/settings', async (req,res) => {
  try {
    const settings = req.body;
    for (const [k,v] of Object.entries(settings)) {
      await run("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",[k, JSON.stringify(v)]);
    }
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// === BACKUP / RESTORE ===
app.get('/api/backup', async (req,res) => {
  try {
    const data = {
      timestamp: new Date().toISOString(),
      version: '2.0',
      stock: await all("SELECT * FROM stock"),
      requests: (await all("SELECT * FROM requests")).map(r=>({...r,items:JSON.parse(r.items||'[]')})),
      repairs: await all("SELECT * FROM repairs"),
      devices: await all("SELECT * FROM devices"),
      categories: await all("SELECT * FROM categories"),
      users: await all("SELECT id,username,name,emp_id,role,dept,active FROM users"),
      settings: await all("SELECT * FROM settings")
    };
    res.setHeader('Content-Disposition','attachment; filename="nteq-backup-'+new Date().toISOString().slice(0,10)+'.json"');
    res.json(data);
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/restore', async (req,res) => {
  try {
    const data = req.body;
    if (data.stock) for (const s of data.stock) await run("INSERT OR REPLACE INTO stock(id,name,unit,category,qty,min_qty,img) VALUES(?,?,?,?,?,?,?)",[s.id,s.name,s.unit||'ตัว',s.category||'อุปกรณ์ IT',s.qty||0,s.min_qty||10,s.img||'']);
    if (data.requests) for (const r of data.requests) await run("INSERT OR IGNORE INTO requests(id,requester_name,emp_id,dept,req_type,urgent,req_date,items,remark,status,approved_by,approved_at,issued_by,issued_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[r.id,r.requester_name,r.emp_id,r.dept,r.req_type,r.urgent||'normal',r.req_date,JSON.stringify(r.items||[]),r.remark||'',r.status||'pending',r.approved_by||null,r.approved_at||null,r.issued_by||null,r.issued_at||null]);
    if (data.repairs) for (const r of data.repairs) await run("INSERT OR IGNORE INTO repairs(id,reporter_name,emp_id,dept,device_type,symptom,urgency,status,assigned_to,note) VALUES(?,?,?,?,?,?,?,?,?,?)",[r.id,r.reporter_name,r.emp_id,r.dept,r.device_type,r.symptom,r.urgency||'normal',r.status||'open',r.assigned_to||'',r.note||'']);
    if (data.categories) for (const c of data.categories) await run("INSERT OR IGNORE INTO categories(name,icon,color) VALUES(?,?,?)",[c.name,c.icon||'📦',c.color||'#3b82f6']);
    res.json({ success: true, message: 'กู้คืนข้อมูลสำเร็จ' });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ═══════════════════════════════════════════════════════════════════════
//  SRP SYNC API — ใช้โดย index.html (SrpSync layer)
// ═══════════════════════════════════════════════════════════════════════

// ดึง snapshot ข้อมูลทั้งหมด
app.get('/api/store', async (req,res) => {
  try {
    const store = await srpLoadStore();
    res.json(store);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// รับ partial update → merge เข้า store, บันทึก, broadcast ไปทุก client ที่เชื่อมต่อ (ยกเว้นคนที่ส่งมา ถ้าระบุ)
app.post('/api/push', async (req,res) => {
  try {
    const { payload } = req.body || {};
    let store = await srpLoadStore();
    store = srpMergeStore(store, payload);
    await srpSaveStore(store);
    broadcastUpdate({ type: 'update', payload }, null);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Fallback → index.html
app.get('*', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));

// ═══════════════════════════════════════════════════════════════════════
//  WEBSOCKET SERVER — SRP Real-time Sync
//  - Client เชื่อมต่อ → ส่ง { type:'init', payload: <full store> }
//  - Client ส่ง { type:'push', clientRole, payload } → merge + save + broadcast
// ═══════════════════════════════════════════════════════════════════════
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcastUpdate(msg, exceptWs) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client !== exceptWs && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

wss.on('connection', async (ws) => {
  try {
    const store = await srpLoadStore();
    ws.send(JSON.stringify({ type: 'init', payload: store }));
  } catch(e) {
    ws.send(JSON.stringify({ type: 'init', payload: {} }));
  }

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch(e) { return; }
    if (!msg || msg.type !== 'push') return;
    try {
      let store = await srpLoadStore();
      store = srpMergeStore(store, msg.payload);
      await srpSaveStore(store);
      // broadcast ไปยังทุกเครื่อง "อื่น" (เครื่องที่ push เองอัปเดต state ในตัวอยู่แล้ว)
      broadcastUpdate({ type: 'update', payload: msg.payload }, ws);
    } catch(e) { /* ignore */ }
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 NTEQ IT Stock Server running at http://localhost:${PORT}`);
  console.log(`🔄 WebSocket sync ready at ws://localhost:${PORT}/`);
  console.log(`📁 Database: ${DB_PATH}`);
  console.log(`📁 Static:   ${path.join(__dirname,'public')}\n`);
});
