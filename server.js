const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'nteq_it.json');

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data dir
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ═══════════════════════════════════════════════════════════════════════
//  ฐานข้อมูลแบบไฟล์ JSON (ไม่ต้อง compile native module เหมือน sqlite3)
//  เก็บทุกตารางไว้ใน object เดียว แล้วเขียนลงไฟล์ทุกครั้งที่มีการแก้ไข
// ═══════════════════════════════════════════════════════════════════════
let dbData = {
  users: [],
  stock: [],
  requests: [],
  repairs: [],
  devices: [],
  categories: [],
  settings: [],     // [{key, value}]
  kv_store: {},      // { srp_store: {...} }
  _seq: { users: 0, devices: 0 }
};

function loadDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      dbData = Object.assign({}, dbData, parsed);
      dbData._seq = Object.assign({ users: 0, devices: 0 }, parsed._seq || {});
    }
  } catch (e) {
    console.error('โหลดฐานข้อมูลผิดพลาด:', e.message);
  }
}

let _saveTimer = null;
function saveDb() {
  // debounce การเขียนไฟล์เล็กน้อยเพื่อลด I/O เวลามีการเขียนถี่ๆ
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(dbData), 'utf8');
    } catch (e) {
      console.error('บันทึกฐานข้อมูลผิดพลาด:', e.message);
    }
  }, 50);
}

function nowLocal() {
  // คล้าย sqlite datetime('now','localtime')
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function nextId(table) {
  dbData._seq[table] = (dbData._seq[table] || 0) + 1;
  return dbData._seq[table];
}

loadDb();

// ── Default users ──
if (!dbData.users || dbData.users.length === 0) {
  dbData.users = [
    { id: nextId('users'), username:'admin',   password:'1234', name:'ผู้ดูแลระบบ',     emp_id:'EMP-0001', role:'admin',     dept:'IT',         active:1, created_at: nowLocal() },
    { id: nextId('users'), username:'manager', password:'1234', name:'ผู้จัดการ',       emp_id:'EMP-0002', role:'manager',   dept:'Management', active:1, created_at: nowLocal() },
    { id: nextId('users'), username:'itstock', password:'1234', name:'เจ้าหน้าที่ IT',  emp_id:'EMP-0003', role:'warehouse', dept:'IT',         active:1, created_at: nowLocal() },
    { id: nextId('users'), username:'staff',   password:'1234', name:'พนักงาน',         emp_id:'EMP-0004', role:'staff',     dept:'QC',         active:1, created_at: nowLocal() },
  ];
  console.log('✅ Default users created');
  saveDb();
}

// ── Default categories ──
if (!dbData.categories || dbData.categories.length === 0) {
  dbData.categories = [
    { name:'อุปกรณ์ IT',    icon:'💻', color:'#3b82f6' },
    { name:'เครือข่าย',     icon:'🌐', color:'#10b981' },
    { name:'เครื่องพิมพ์',  icon:'🖨️', color:'#f59e0b' },
    { name:'สายเคเบิล',     icon:'🔌', color:'#8b5cf6' },
    { name:'อุปกรณ์สำรอง',  icon:'📦', color:'#ef4444' },
  ];
  saveDb();
}

// ── Default stock ──
if (!dbData.stock || dbData.stock.length === 0) {
  dbData.stock = [
    { id:'IT-001', name:'สาย LAN Cat6',          unit:'เส้น', category:'เครือข่าย',    qty:50, min_qty:10, img:'', updated_at: nowLocal() },
    { id:'IT-002', name:'USB Flash Drive 32GB',   unit:'ตัว',  category:'อุปกรณ์ IT',  qty:20, min_qty:5,  img:'', updated_at: nowLocal() },
    { id:'IT-003', name:'เมาส์ Optical',          unit:'ตัว',  category:'อุปกรณ์ IT',  qty:15, min_qty:3,  img:'', updated_at: nowLocal() },
    { id:'IT-004', name:'คีย์บอร์ด USB',          unit:'ตัว',  category:'อุปกรณ์ IT',  qty:10, min_qty:2,  img:'', updated_at: nowLocal() },
    { id:'IT-005', name:'หมึกพิมพ์ HP LaserJet',  unit:'ตลับ', category:'เครื่องพิมพ์',qty:8,  min_qty:2,  img:'', updated_at: nowLocal() },
  ];
  console.log('✅ Default stock created');
  saveDb();
}

console.log('✅ Database initialized (JSON file store):', DB_PATH);

// ═══════════════════════════════════════════════════════════════════════
//  SRP SYNC STORE — JSON blob ใน dbData.kv_store.srp_store
//  รองรับ users, stock, requests, repairs, devices, settings,
//  repairSettings, counters ตามที่ index.html (SrpSync) คาดหวัง
// ═══════════════════════════════════════════════════════════════════════
const SRP_STORE_KEY = 'srp_store';

function srpLoadStore() {
  return Promise.resolve(JSON.parse(JSON.stringify(dbData.kv_store[SRP_STORE_KEY] || {})));
}

function srpSaveStore(store) {
  dbData.kv_store[SRP_STORE_KEY] = store || {};
  saveDb();
  return Promise.resolve();
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
    const user = dbData.users.find(u => u.username === username && u.password === password && u.active === 1);
    if (!user) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    res.json({ success: true, user: { id: user.id, username: user.username, name: user.name, emp_id: user.emp_id, role: user.role, dept: user.dept } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// === STOCK ===
app.get('/api/stock', async (req,res) => {
  try {
    const rows = [...dbData.stock].sort((a,b) => (a.category+a.name).localeCompare(b.category+b.name));
    res.json(rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/stock', async (req,res) => {
  try {
    const s = req.body;
    const item = {
      id: s.id, name: s.name, unit: s.unit||'ตัว', category: s.category||'อุปกรณ์ IT',
      qty: s.qty||0, min_qty: s.min_qty||10, img: s.img||'', updated_at: nowLocal()
    };
    const idx = dbData.stock.findIndex(x => x.id === s.id);
    if (idx >= 0) dbData.stock[idx] = item; else dbData.stock.push(item);
    saveDb();
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.put('/api/stock/:id', async (req,res) => {
  try {
    const s = req.body;
    const idx = dbData.stock.findIndex(x => x.id === req.params.id);
    if (idx >= 0) {
      dbData.stock[idx] = Object.assign({}, dbData.stock[idx], {
        name: s.name, unit: s.unit, category: s.category, qty: s.qty, min_qty: s.min_qty,
        img: s.img||'', updated_at: nowLocal()
      });
      saveDb();
    }
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/stock/:id', async (req,res) => {
  try {
    dbData.stock = dbData.stock.filter(x => x.id !== req.params.id);
    saveDb();
    res.json({success:true});
  } catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/stock/:id/receive', async (req,res) => {
  try {
    const { qty } = req.body;
    const item = dbData.stock.find(x => x.id === req.params.id);
    if (item) { item.qty = (item.qty||0) + (qty||0); item.updated_at = nowLocal(); saveDb(); }
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/stock/:id/deduct', async (req,res) => {
  try {
    const { qty } = req.body;
    const item = dbData.stock.find(x => x.id === req.params.id);
    if (item) { item.qty = Math.max(0, (item.qty||0) - (qty||0)); item.updated_at = nowLocal(); saveDb(); }
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// === REQUESTS ===
app.get('/api/requests', async (req,res) => {
  try {
    const rows = [...dbData.requests]
      .sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''))
      .map(r => ({ ...r, items: typeof r.items === 'string' ? JSON.parse(r.items||'[]') : (r.items||[]) }));
    res.json(rows);
  } catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/requests', async (req,res) => {
  try {
    const r = req.body;
    dbData.requests.push({
      id: r.id, requester_name: r.requester_name, emp_id: r.emp_id, dept: r.dept,
      req_type: r.req_type, urgent: r.urgent||'normal', req_date: r.req_date,
      items: JSON.stringify(r.items||[]), remark: r.remark||'', status: 'pending',
      approved_by: null, approved_at: null, issued_by: null, issued_at: null,
      created_at: nowLocal()
    });
    saveDb();
    res.json({ success: true, id: r.id });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.put('/api/requests/:id', async (req,res) => {
  try {
    const r = req.body;
    const item = dbData.requests.find(x => x.id === req.params.id);
    if (item) {
      if (r.status !== undefined)      item.status = r.status;
      if (r.approved_by !== undefined) item.approved_by = r.approved_by;
      if (r.approved_at !== undefined) item.approved_at = r.approved_at;
      if (r.issued_by !== undefined)   item.issued_by = r.issued_by;
      if (r.issued_at !== undefined)   item.issued_at = r.issued_at;
      saveDb();
    }
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/requests/:id', async (req,res) => {
  try {
    dbData.requests = dbData.requests.filter(x => x.id !== req.params.id);
    saveDb();
    res.json({success:true});
  } catch(e){res.status(500).json({error:e.message});}
});

// === REPAIRS ===
app.get('/api/repairs', async (req,res) => {
  try {
    const rows = [...dbData.repairs].sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));
    res.json(rows);
  } catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/repairs', async (req,res) => {
  try {
    const r = req.body;
    dbData.repairs.push({
      id: r.id, reporter_name: r.reporter_name, emp_id: r.emp_id, dept: r.dept,
      device_type: r.device_type, symptom: r.symptom, urgency: r.urgency||'normal',
      assigned_to: '', status: 'open', note: '',
      created_at: nowLocal(), updated_at: nowLocal()
    });
    saveDb();
    res.json({ success: true, id: r.id });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.put('/api/repairs/:id', async (req,res) => {
  try {
    const r = req.body;
    const item = dbData.repairs.find(x => x.id === req.params.id);
    if (item) {
      ['status','assigned_to','note'].forEach(k => { if(r[k]!==undefined) item[k] = r[k]; });
      item.updated_at = nowLocal();
      saveDb();
    }
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/repairs/:id', async (req,res) => {
  try {
    dbData.repairs = dbData.repairs.filter(x => x.id !== req.params.id);
    saveDb();
    res.json({success:true});
  } catch(e){res.status(500).json({error:e.message});}
});

// === DEVICES ===
app.get('/api/devices', async (req,res) => {
  try {
    const rows = [...dbData.devices].sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));
    res.json(rows);
  } catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/devices', async (req,res) => {
  try {
    const d = req.body;
    const id = nextId('devices');
    dbData.devices.push({
      id, code: d.code, name: d.name, brand: d.brand||'', model: d.model||'',
      device_type: d.device_type||'', subtype: d.subtype||'', serial_no: d.serial_no||'',
      dept: d.dept||'', user_name: d.user_name||'', company: d.company||'',
      warranty: d.warranty||'', price: d.price||0, status: d.status||'active',
      created_at: nowLocal()
    });
    saveDb();
    res.json({ success: true, id });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.put('/api/devices/:id', async (req,res) => {
  try {
    const d = req.body;
    const idNum = Number(req.params.id);
    const item = dbData.devices.find(x => x.id === idNum);
    if (item) {
      Object.assign(item, {
        code:d.code, name:d.name, brand:d.brand, model:d.model, device_type:d.device_type,
        subtype:d.subtype, serial_no:d.serial_no, dept:d.dept, user_name:d.user_name,
        company:d.company, warranty:d.warranty, price:d.price, status:d.status
      });
      saveDb();
    }
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/devices/:id', async (req,res) => {
  try {
    const idNum = Number(req.params.id);
    dbData.devices = dbData.devices.filter(x => x.id !== idNum);
    saveDb();
    res.json({success:true});
  } catch(e){res.status(500).json({error:e.message});}
});

// === CATEGORIES ===
app.get('/api/categories', async (req,res) => {
  try {
    const rows = [...dbData.categories].sort((a,b) => a.name.localeCompare(b.name));
    res.json(rows);
  } catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/categories', async (req,res) => {
  try {
    const c = req.body;
    if (!dbData.categories.find(x => x.name === c.name)) {
      dbData.categories.push({ name: c.name, icon: c.icon||'📦', color: c.color||'#3b82f6' });
      saveDb();
    }
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/categories/:name', async (req,res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    dbData.categories = dbData.categories.filter(x => x.name !== name);
    saveDb();
    res.json({success:true});
  } catch(e){res.status(500).json({error:e.message});}
});

// === USERS ===
app.get('/api/users', async (req,res) => {
  try {
    const rows = [...dbData.users]
      .sort((a,b) => a.id - b.id)
      .map(u => ({ id:u.id, username:u.username, name:u.name, emp_id:u.emp_id, role:u.role, dept:u.dept, active:u.active, created_at:u.created_at }));
    res.json(rows);
  } catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/users', async (req,res) => {
  try {
    const u = req.body;
    const id = nextId('users');
    dbData.users.push({
      id, username: u.username, password: u.password, name: u.name||'',
      emp_id: u.emp_id||'', role: u.role||'staff', dept: u.dept||'', active: 1,
      created_at: nowLocal()
    });
    saveDb();
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.put('/api/users/:id', async (req,res) => {
  try {
    const u = req.body;
    const idNum = Number(req.params.id);
    const item = dbData.users.find(x => x.id === idNum);
    if (item) {
      ['name','emp_id','role','dept','active'].forEach(k => { if(u[k]!==undefined) item[k] = u[k]; });
      if (u.password) item.password = u.password;
      saveDb();
    }
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/users/:id', async (req,res) => {
  try {
    const idNum = Number(req.params.id);
    dbData.users = dbData.users.filter(x => x.id !== idNum);
    saveDb();
    res.json({success:true});
  } catch(e){res.status(500).json({error:e.message});}
});

// === SETTINGS ===
app.get('/api/settings', async (req,res) => {
  try {
    const obj = {};
    dbData.settings.forEach(r => { try { obj[r.key] = JSON.parse(r.value); } catch(e) { obj[r.key] = r.value; } });
    res.json(obj);
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/settings', async (req,res) => {
  try {
    const settings = req.body;
    for (const [k,v] of Object.entries(settings)) {
      const json = JSON.stringify(v);
      const existing = dbData.settings.find(r => r.key === k);
      if (existing) existing.value = json;
      else dbData.settings.push({ key: k, value: json });
    }
    saveDb();
    res.json({ success: true });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// === BACKUP / RESTORE ===
app.get('/api/backup', async (req,res) => {
  try {
    const data = {
      timestamp: new Date().toISOString(),
      version: '2.0',
      stock: dbData.stock,
      requests: dbData.requests.map(r=>({...r, items: typeof r.items==='string' ? JSON.parse(r.items||'[]') : (r.items||[])})),
      repairs: dbData.repairs,
      devices: dbData.devices,
      categories: dbData.categories,
      users: dbData.users.map(u => ({ id:u.id, username:u.username, name:u.name, emp_id:u.emp_id, role:u.role, dept:u.dept, active:u.active })),
      settings: dbData.settings
    };
    res.setHeader('Content-Disposition','attachment; filename="nteq-backup-'+new Date().toISOString().slice(0,10)+'.json"');
    res.json(data);
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/restore', async (req,res) => {
  try {
    const data = req.body;
    if (data.stock) for (const s of data.stock) {
      const item = { id:s.id, name:s.name, unit:s.unit||'ตัว', category:s.category||'อุปกรณ์ IT', qty:s.qty||0, min_qty:s.min_qty||10, img:s.img||'', updated_at: nowLocal() };
      const idx = dbData.stock.findIndex(x => x.id === s.id);
      if (idx >= 0) dbData.stock[idx] = item; else dbData.stock.push(item);
    }
    if (data.requests) for (const r of data.requests) {
      if (!dbData.requests.find(x => x.id === r.id)) {
        dbData.requests.push({
          id:r.id, requester_name:r.requester_name, emp_id:r.emp_id, dept:r.dept, req_type:r.req_type,
          urgent:r.urgent||'normal', req_date:r.req_date, items: JSON.stringify(r.items||[]), remark:r.remark||'',
          status:r.status||'pending', approved_by:r.approved_by||null, approved_at:r.approved_at||null,
          issued_by:r.issued_by||null, issued_at:r.issued_at||null, created_at: nowLocal()
        });
      }
    }
    if (data.repairs) for (const r of data.repairs) {
      if (!dbData.repairs.find(x => x.id === r.id)) {
        dbData.repairs.push({
          id:r.id, reporter_name:r.reporter_name, emp_id:r.emp_id, dept:r.dept, device_type:r.device_type,
          symptom:r.symptom, urgency:r.urgency||'normal', status:r.status||'open', assigned_to:r.assigned_to||'',
          note:r.note||'', created_at: nowLocal(), updated_at: nowLocal()
        });
      }
    }
    if (data.categories) for (const c of data.categories) {
      if (!dbData.categories.find(x => x.name === c.name)) {
        dbData.categories.push({ name:c.name, icon:c.icon||'📦', color:c.color||'#3b82f6' });
      }
    }
    saveDb();
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

// รับ partial update → merge เข้า store, บันทึก, broadcast ไปทุก client ที่เชื่อมต่อ
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

// Fallback → index.html (ใช้ middleware แทน wildcard route เพื่อรองรับทั้ง Express 4 และ 5)
app.use((req,res) => res.sendFile(path.join(__dirname,'public','index.html')));

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
