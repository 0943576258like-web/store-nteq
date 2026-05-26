'use strict';
const express = require('express');
const Database = require('better-sqlite3');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'warehouse.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  fullname TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  department TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'อื่นๆ',
  unit TEXT NOT NULL DEFAULT 'ชิ้น',
  quantity INTEGER NOT NULL DEFAULT 0,
  min_quantity INTEGER NOT NULL DEFAULT 5,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  req_no TEXT UNIQUE NOT NULL,
  requester_name TEXT NOT NULL,
  department TEXT NOT NULL,
  request_type TEXT NOT NULL DEFAULT 'เบิกใช้ประจำ',
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS request_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  FOREIGN KEY(request_id) REFERENCES requests(id),
  FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE TABLE IF NOT EXISTS stock_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  change_qty INTEGER NOT NULL,
  action TEXT NOT NULL,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

function seed() {
  if (!db.prepare('SELECT id FROM users WHERE username=?').get('admin')) {
    const h = bcrypt.hashSync('1234', 10);
    const ins = db.prepare('INSERT INTO users (username,password,fullname,role,department) VALUES (?,?,?,?,?)');
    ins.run('admin',h,'ผู้ดูแลระบบ','admin','IT');
    ins.run('manager',h,'ผู้จัดการคลัง','manager','Store');
    ins.run('warehouse',h,'เจ้าหน้าที่คลัง','warehouse','Store');
    ins.run('staff',h,'พนักงานทั่วไป','staff','Admin');
  }
  if (!db.prepare('SELECT id FROM products LIMIT 1').get()) {
    const ins = db.prepare('INSERT INTO products (code,name,category,unit,quantity,min_quantity) VALUES (?,?,?,?,?,?)');
    ins.run('ST001','กระดาษ A4 80g','เครื่องเขียน','รีม',50,10);
    ins.run('ST002','ปากกาลูกลื่นน้ำเงิน','เครื่องเขียน','ด้าม',200,20);
    ins.run('ST003','ดินสอ 2B','เครื่องเขียน','ด้าม',150,15);
    ins.run('ST004','แฟ้มเจาะรู A4','อุปกรณ์สำนักงาน','อัน',80,10);
    ins.run('ST005','กาวลาเท็กซ์','อุปกรณ์สำนักงาน','ขวด',30,5);
    ins.run('IT001','หมึกพิมพ์ดำ TK-1175','อุปกรณ์ IT','ตลับ',8,3);
    ins.run('IT002','เมาส์ไร้สาย','อุปกรณ์ IT','ชิ้น',5,2);
    ins.run('CL001','น้ำยาทำความสะอาด','อุปกรณ์ทำความสะอาด','ขวด',4,5);
    ins.run('CL002','กระดาษชำระ','วัสดุสิ้นเปลือง','แพ็ค',20,5);
    ins.run('CL003','ถุงขยะดำ','วัสดุสิ้นเปลือง','แพ็ค',15,3);
  }
}
seed();

function genReqNo() {
  const d = new Date();
  const yymm = String(d.getFullYear()).slice(2)+String(d.getMonth()+1).padStart(2,'0');
  const c = db.prepare("SELECT COUNT(*) as c FROM requests WHERE req_no LIKE ?").get('RQ-'+yymm+'-%').c;
  return 'RQ-'+yymm+'-'+String(c+1).padStart(4,'0');
}

app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use(session({
  secret: process.env.SESSION_SECRET || 'wh-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30*60*1000, httpOnly: true }
}));

function requireAuth(req,res,next) {
  if (!req.session.userId) return res.status(401).json({error:'กรุณาเข้าสู่ระบบ'});
  const u = db.prepare('SELECT * FROM users WHERE id=? AND is_active=1').get(req.session.userId);
  if (!u) return res.status(401).json({error:'Session หมดอายุ'});
  req.user = u; next();
}
function requireRole(...roles) {
  return (req,res,next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({error:'ไม่มีสิทธิ์'});
    next();
  };
}

app.post('/api/auth/login',(req,res)=>{
  const {username,password} = req.body;
  if (!username||!password) return res.status(400).json({error:'กรุณากรอกข้อมูลให้ครบ'});
  const u = db.prepare('SELECT * FROM users WHERE username=? AND is_active=1').get(username.trim());
  if (!u||!bcrypt.compareSync(password,u.password)) return res.status(401).json({error:'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'});
  req.session.userId = u.id;
  res.json({user:{id:u.id,username:u.username,fullname:u.fullname,role:u.role,department:u.department}});
});
app.post('/api/auth/logout',(req,res)=>{req.session.destroy();res.json({ok:true});});
app.get('/api/auth/me',requireAuth,(req,res)=>{
  const u=req.user;
  res.json({user:{id:u.id,username:u.username,fullname:u.fullname,role:u.role,department:u.department}});
});

app.get('/api/dashboard',requireAuth,(req,res)=>{
  res.json({
    totalRequests: db.prepare('SELECT COUNT(*) as c FROM requests').get().c,
    pending: db.prepare("SELECT COUNT(*) as c FROM requests WHERE status='pending'").get().c,
    approved: db.prepare("SELECT COUNT(*) as c FROM requests WHERE status='approved'").get().c,
    lowStock: db.prepare('SELECT COUNT(*) as c FROM products WHERE quantity<=min_quantity').get().c,
    recentRequests: db.prepare('SELECT * FROM requests ORDER BY created_at DESC LIMIT 10').all(),
    lowStockItems: db.prepare('SELECT * FROM products WHERE quantity<=min_quantity ORDER BY quantity ASC LIMIT 10').all()
  });
});

app.get('/api/products',requireAuth,(req,res)=>{
  res.json(db.prepare('SELECT * FROM products ORDER BY code').all());
});
app.post('/api/products',requireAuth,requireRole('admin','warehouse'),(req,res)=>{
  const {code,name,category,unit,quantity,min_quantity}=req.body;
  if (!code||!name||!unit) return res.status(400).json({error:'กรุณากรอกข้อมูลให้ครบ'});
  try {
    const r=db.prepare('INSERT INTO products (code,name,category,unit,quantity,min_quantity) VALUES (?,?,?,?,?,?)')
      .run(code.trim(),name.trim(),category||'อื่นๆ',unit.trim(),quantity||0,min_quantity||5);
    res.status(201).json(db.prepare('SELECT * FROM products WHERE id=?').get(r.lastInsertRowid));
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({error:'รหัสสินค้านี้มีอยู่แล้ว'});
    res.status(500).json({error:e.message});
  }
});
app.post('/api/products/:id/receive',requireAuth,requireRole('admin','warehouse'),(req,res)=>{
  const {quantity,note}=req.body;
  if (!quantity||quantity<1) return res.status(400).json({error:'จำนวนไม่ถูกต้อง'});
  const p=db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({error:'ไม่พบสินค้า'});
  db.prepare('UPDATE products SET quantity=quantity+? WHERE id=?').run(quantity,p.id);
  db.prepare("INSERT INTO stock_logs (product_id,change_qty,action,note) VALUES (?,?,'receive',?)").run(p.id,quantity,note||null);
  res.json({ok:true});
});

app.get('/api/requests',requireAuth,(req,res)=>{
  let sql=`SELECT r.*,(SELECT COUNT(*) FROM request_items ri WHERE ri.request_id=r.id) as item_count FROM requests r WHERE 1=1`;
  const params=[];
  if (req.query.status){sql+=' AND r.status=?';params.push(req.query.status);}
  if (req.query.q){
    sql+=' AND (r.req_no LIKE ? OR r.requester_name LIKE ? OR r.department LIKE ?)';
    const q='%'+req.query.q+'%';params.push(q,q,q);
  }
  sql+=' ORDER BY r.created_at DESC LIMIT 200';
  res.json(db.prepare(sql).all(...params));
});
app.get('/api/requests/:id',requireAuth,(req,res)=>{
  const r=db.prepare('SELECT * FROM requests WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({error:'ไม่พบใบเบิก'});
  r.items=db.prepare('SELECT ri.*,p.name as product_name,p.unit FROM request_items ri JOIN products p ON p.id=ri.product_id WHERE ri.request_id=?').all(r.id);
  res.json(r);
});
app.post('/api/requests',requireAuth,(req,res)=>{
  const {requester_name,department,request_type,note,items}=req.body;
  if (!requester_name||!department) return res.status(400).json({error:'กรุณากรอกข้อมูลให้ครบ'});
  if (!items||!items.length) return res.status(400).json({error:'กรุณาเพิ่มรายการสินค้า'});
  const req_no=genReqNo();
  const tx=db.transaction(()=>{
    const r=db.prepare('INSERT INTO requests (req_no,requester_name,department,request_type,note) VALUES (?,?,?,?,?)')
      .run(req_no,requester_name,department,request_type||'เบิกใช้ประจำ',note||null);
    const ins=db.prepare('INSERT INTO request_items (request_id,product_id,quantity) VALUES (?,?,?)');
    items.forEach(i=>ins.run(r.lastInsertRowid,i.product_id,i.quantity));
    return r.lastInsertRowid;
  });
  const id=tx();
  res.status(201).json({id,req_no});
});
app.patch('/api/requests/:id/status',requireAuth,requireRole('admin','manager','warehouse'),(req,res)=>{
  const {status}=req.body;
  if (!['approved','rejected','issued','pending'].includes(status)) return res.status(400).json({error:'สถานะไม่ถูกต้อง'});
  const r=db.prepare('SELECT * FROM requests WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({error:'ไม่พบใบเบิก'});
  if (status==='issued'&&r.status==='approved') {
    db.transaction(()=>{
      db.prepare("UPDATE requests SET status='issued',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(r.id);
      db.prepare('SELECT * FROM request_items WHERE request_id=?').all(r.id).forEach(item=>{
        db.prepare('UPDATE products SET quantity=MAX(0,quantity-?) WHERE id=?').run(item.quantity,item.product_id);
        db.prepare("INSERT INTO stock_logs (product_id,change_qty,action,note) VALUES (?,?,'issue',?)").run(item.product_id,-item.quantity,'ใบเบิก '+r.req_no);
      });
    })();
  } else {
    db.prepare('UPDATE requests SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,r.id);
  }
  res.json({ok:true});
});

app.get('/api/report',requireAuth,(req,res)=>{
  const {month}=req.query;
  if (!month) return res.status(400).json({error:'กรุณาระบุเดือน'});
  const like=month+'%';
  const requests=db.prepare("SELECT * FROM requests WHERE created_at LIKE ? ORDER BY created_at DESC").all(like);
  res.json({
    total:requests.length,
    approved:requests.filter(r=>r.status==='approved'||r.status==='issued').length,
    rejected:requests.filter(r=>r.status==='rejected').length,
    pending:requests.filter(r=>r.status==='pending').length,
    requests,
    topProducts:db.prepare(`SELECT p.name as product_name,COUNT(*) as times,SUM(ri.quantity) as total_qty
      FROM request_items ri JOIN products p ON p.id=ri.product_id JOIN requests r ON r.id=ri.request_id
      WHERE r.created_at LIKE ? GROUP BY p.id ORDER BY total_qty DESC LIMIT 10`).all(like)
  });
});

app.get('/api/users',requireAuth,requireRole('admin','manager'),(req,res)=>{
  res.json(db.prepare('SELECT id,username,fullname,role,department,is_active,created_at FROM users ORDER BY created_at').all());
});
app.post('/api/users',requireAuth,requireRole('admin'),(req,res)=>{
  const {username,password,fullname,role,department}=req.body;
  if (!username||!password||!fullname) return res.status(400).json({error:'กรุณากรอกข้อมูลให้ครบ'});
  try {
    const r=db.prepare('INSERT INTO users (username,password,fullname,role,department) VALUES (?,?,?,?,?)')
      .run(username.trim(),bcrypt.hashSync(password,10),fullname.trim(),role||'staff',department||null);
    res.status(201).json({id:r.lastInsertRowid});
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({error:'Username นี้มีอยู่แล้ว'});
    res.status(500).json({error:e.message});
  }
});
app.patch('/api/users/:id',requireAuth,requireRole('admin'),(req,res)=>{
  const u=db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({error:'ไม่พบผู้ใช้'});
  const {is_active,role,password}=req.body;
  if (is_active!==undefined) db.prepare('UPDATE users SET is_active=? WHERE id=?').run(is_active?1:0,u.id);
  if (role) db.prepare('UPDATE users SET role=? WHERE id=?').run(role,u.id);
  if (password) db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(password,10),u.id);
  res.json({ok:true});
});

app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT,()=>{
  console.log('===========================================');
  console.log('  ระบบเบิกจ่ายสินค้าคลัง พร้อมใช้งาน');
  console.log('  http://localhost:'+PORT);
  console.log('===========================================');
});
