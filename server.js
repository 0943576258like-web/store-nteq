/**
 * SRP Real-Time Sync Server — SECURED VERSION
 *
 * เปลี่ยนจากเดิมอย่างไร (สำคัญ):
 *   1. มี POST /api/login จริงบน server — server เป็นคนเทียบ password hash เอง
 *      (ไม่ใช่ client เทียบแล้วบอกผลมา)
 *   2. Login สำเร็จ → server ออก session token (random 32 bytes) เก็บใน memory
 *      ส่งกลับไปเป็น httpOnly cookie — client เอาไป "อ่าน" ไม่ได้ผ่าน JS
 *   3. ทุก request ที่แก้ข้อมูล (/api/push) และทุก WebSocket connection
 *      ต้องแนบ session cookie นี้ — และ "role" จะถูก lookup จาก session
 *      ฝั่ง server เท่านั้น ไม่เชื่อ clientRole ที่ client ส่งมาอีกต่อไป
 *   4. GET /api/store จะตัด field รหัสผ่าน (pass/hashed/mustChangePass) ออก
 *      ก่อนส่งให้ client เสมอ — client ไม่มีความจำเป็นต้องเห็น hash เลย
 *   5. มี rate-limit การ login ฝั่ง server (ใน memory ต่อ username+IP)
 *      เพื่อกัน brute-force ที่ยิงตรงมาที่ API โดยไม่ผ่านหน้าเว็บ
 *
 * ข้อจำกัดที่ควรรู้:
 *   - Session เก็บใน memory ของ process เดียว ถ้า restart server ทุกคน
 *     จะหลุด session ต้อง login ใหม่ (acceptable สำหรับระบบขนาดนี้)
 *     ถ้าต้องรันหลาย instance (load balancer) ต้องย้ายไป Redis/DB แทน
 *   - ตัวอย่างนี้ใช้ cookie แบบ Secure เมื่อรันบน HTTPS เท่านั้น
 *     รัน HTTP บน production จริงไม่ควรทำ (cookie จะถูกขโมยง่ายผ่าน network)
 */

'use strict';

const http        = require('http');
const fs          = require('fs');
const path        = require('path');
const crypto      = require('crypto');
const { WebSocketServer } = require('ws');

const PORT          = process.env.PORT || 3000;
const DATA_FILE     = path.join(__dirname, 'srp_data.json');
const DATA_FILE_TMP = DATA_FILE + '.tmp';
const INDEX_FILE    = path.join(__dirname, 'index.html');
const IS_HTTPS      = process.env.FORCE_HTTPS_COOKIE === '1';
const TRUST_PROXY   = process.env.TRUST_PROXY === '1';
// CORS: ระบุ origin จริง ไม่ใช้ * เพราะใช้ credentials (httpOnly cookie)
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;

const SESSION_TTL_MS      = 30 * 60 * 1000; // 30 นาที ตรงกับ session timeout ฝั่ง frontend
const LOGIN_MAX_ATTEMPTS  = 5;
const LOGIN_LOCKOUT_MS    = 10 * 60 * 1000; // 10 นาที

let store = {};

/* ════════════════════════════════════════════════════════════════════════
   Persistent store (เดิม)
   ════════════════════════════════════════════════════════════════════════ */
function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      console.log('[Store] Loaded from disk:', Object.keys(store).join(', ') || 'empty');
    }
  } catch (e) {
    console.warn('[Store] Failed to load from disk:', e.message);
    store = {};
  }
}

function saveStore() {
  try {
    // atomic write: เขียน tmp ก่อน แล้ว rename (rename เป็น atomic บน Linux/macOS)
    fs.writeFileSync(DATA_FILE_TMP, JSON.stringify(store), 'utf8');
    fs.renameSync(DATA_FILE_TMP, DATA_FILE);
  } catch (e) {
    console.warn('[Store] Failed to save to disk:', e.message);
    try { fs.unlinkSync(DATA_FILE_TMP); } catch {}
  }
}

/* ════════════════════════════════════════════════════════════════════════
   Session store — in-memory.  token -> { userId, role, username, expiresAt }
   ════════════════════════════════════════════════════════════════════════ */
const sessions   = new Map();
const auditLog   = [];          // server-side audit log (in-memory, flush ทุก save)
const LOG_FILE   = path.join(__dirname, 'srp_audit.log');
const MAX_AUDIT  = 2000;        // เก็บ max 2000 บรรทัดล่าสุด

function serverLog(action, username, detail) {
  const entry = `${new Date().toISOString()} | ${action.padEnd(25)} | ${(username||'').padEnd(20)} | ${detail||''}`;
  console.log('[AUDIT]', entry);
  auditLog.push(entry);
  if (auditLog.length > MAX_AUDIT) auditLog.shift();
  // flush to file (append)
  try { fs.appendFileSync(LOG_FILE, entry + '\n', 'utf8'); } catch {}
}

const SESSION_FILE = path.join(__dirname, 'srp_sessions.json');

function saveSessions() {
  try {
    const out = {};
    for (const [token, s] of sessions.entries()) {
      if (Date.now() < s.expiresAt) out[token] = s; // เก็บเฉพาะที่ยังไม่หมดอายุ
    }
    fs.writeFileSync(SESSION_FILE + '.tmp', JSON.stringify(out), 'utf8');
    fs.renameSync(SESSION_FILE + '.tmp', SESSION_FILE);
  } catch {}
}

function loadSessions() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    const now = Date.now();
    for (const [token, s] of Object.entries(raw)) {
      if (now < s.expiresAt) sessions.set(token, s);
    }
    console.log('[Sessions] Restored', sessions.size, 'active sessions from disk');
  } catch (e) {
    console.warn('[Sessions] Could not load sessions:', e.message);
  }
}

// save sessions ทุก 2 นาทีและตอน process ปิด
setInterval(saveSessions, 2 * 60 * 1000);
process.on('SIGTERM', () => { saveSessions(); process.exit(0); });
process.on('SIGINT',  () => { saveSessions(); process.exit(0); });

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    userId:    user.id,
    username:  user.username,
    role:      user.role,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(token);
    return null;
  }
  // sliding expiry: ต่ออายุทุกครั้งที่ใช้งานจริง (เหมือน activity-based timeout ฝั่ง frontend)
  s.expiresAt = Date.now() + SESSION_TTL_MS;
  return s;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

// เคลียร์ session ที่หมดอายุเป็นระยะ ไม่ให้ Map โตไม่จำกัด
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now > s.expiresAt) sessions.delete(token);
  }
}, 5 * 60 * 1000);

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function sessionFromRequest(req) {
  const cookies = parseCookies(req);
  return getSession(cookies.srp_session);
}

function setSessionCookie(res, token) {
  const parts = [
    `srp_session=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (IS_HTTPS) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'srp_session=; HttpOnly; Path=/; Max-Age=0');
}

/* ════════════════════════════════════════════════════════════════════════
   Password hashing — SHA-256 ให้ตรงกับ frontend (srpHash ใน index.html)
   หมายเหตุ: SHA-256 ธรรมดาไม่มี salt/work-factor เหมาะกับ demo เท่านั้น
   ระบบจริงควรย้ายไป bcrypt/argon2 ฝั่ง server (ดูคอมเมนต์ท้ายไฟล์)
   ════════════════════════════════════════════════════════════════════════ */
function sha256(plain) {
  return crypto.createHash('sha256').update(plain, 'utf8').digest('hex');
}

/* ════════════════════════════════════════════════════════════════════════
   Login rate limiting — ต่อ (username + IP) ใน memory
   ════════════════════════════════════════════════════════════════════════ */
const loginAttempts = new Map(); // key -> { count, lockedUntil }

function loginRateKey(username, ip) {
  return `${username.toLowerCase()}|${ip}`;
}

function checkRateLimit(username, ip) {
  const key = loginRateKey(username, ip);
  const rec = loginAttempts.get(key);
  if (!rec) return { blocked: false };
  if (rec.lockedUntil && Date.now() < rec.lockedUntil) {
    return { blocked: true, remainingMs: rec.lockedUntil - Date.now() };
  }
  return { blocked: false };
}

function recordLoginFailure(username, ip) {
  const key = loginRateKey(username, ip);
  const rec = loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= LOGIN_MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
  }
  loginAttempts.set(key, rec);
}

function clearLoginFailures(username, ip) {
  loginAttempts.delete(loginRateKey(username, ip));
}

function clientIp(req) {
  // ── อ่านจาก X-Forwarded-For เฉพาะเมื่อ TRUST_PROXY=1 เท่านั้น ──────────────
  // ค่า default คือ "ไม่เชื่อ" header นี้ เพราะถ้าเปิดทิ้งไว้โดยไม่มี reverse
  // proxy คอยเซ็ตค่าจริง ผู้โจมตีจะปลอม header นี้เพื่อหลบ rate-limit ได้ทันที
  // เปิดใช้เฉพาะตอน deploy หลัง nginx/Caddy/Cloudflare ที่ตั้งค่า X-Forwarded-For
  // เองและ "เขียนทับ" ค่าที่ client ส่งมา ไม่ใช่แค่ต่อท้ายเข้าไป
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      // ค่า header นี้อาจเป็น list "client, proxy1, proxy2" — เอาตัวซ้ายสุด
      const first = xff.split(',')[0].trim();
      if (first) return first;
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

/* ── Rate-limit แยกสำหรับ self-registration (กัน spam สร้าง user ปลอม) ── */
const REGISTER_MAX_PER_IP   = 10;
const REGISTER_WINDOW_MS    = 60 * 60 * 1000; // 1 ชั่วโมง
const registerAttempts = new Map(); // ip -> { count, since }

function checkRegisterRateLimit(ip) {
  const rec = registerAttempts.get(ip);
  if (!rec) return { blocked: false };
  if (Date.now() - rec.since > REGISTER_WINDOW_MS) {
    registerAttempts.delete(ip);
    return { blocked: false };
  }
  return { blocked: rec.count >= REGISTER_MAX_PER_IP };
}

function recordRegisterAttempt(ip) {
  const rec = registerAttempts.get(ip) || { count: 0, since: Date.now() };
  if (Date.now() - rec.since > REGISTER_WINDOW_MS) { rec.count = 0; rec.since = Date.now(); }
  rec.count += 1;
  registerAttempts.set(ip, rec);
}

/* ════════════════════════════════════════════════════════════════════════
   Users helpers
   ════════════════════════════════════════════════════════════════════════ */
function findUserByUsername(username) {
  const list = Array.isArray(store.users) ? store.users : [];
  return list.find(u => u.username && u.username.toLowerCase() === username.toLowerCase()) || null;
}

function findUserById(id) {
  const list = Array.isArray(store.users) ? store.users : [];
  return list.find(u => u.id === id) || null;
}

// ตัด field ที่เกี่ยวกับรหัสผ่านออกก่อนส่งให้ client เสมอ ไม่ว่า request จากใคร
function sanitizeUsersForClient(users) {
  if (!Array.isArray(users)) return users;
  return users.map(u => {
    const { pass, hashed, mustChangePass, ...rest } = u;
    return rest;
  });
}

function sanitizeStoreForClient(rawStore) {
  const out = { ...rawStore };
  if (Array.isArray(out.users)) out.users = sanitizeUsersForClient(out.users);
  return out;
}

/* ════════════════════════════════════════════════════════════════════════
   กรอง payload สำหรับ role 'user': รับได้เฉพาะ repairs และ requests
   (เหมือนเดิม แต่ตอนนี้ role มาจาก session ไม่ใช่จาก client)
   ════════════════════════════════════════════════════════════════════════ */
function filterUserPayload(payload) {
  if (!payload) return null;
  const safe = {};
  if (payload.repairs)  safe.repairs  = payload.repairs;
  if (payload.requests) safe.requests = payload.requests;
  if (payload.counters) {
    const c = {};
    if (payload.counters.repair !== undefined) c.repair = payload.counters.repair;
    if (payload.counters.req    !== undefined) c.req    = payload.counters.req;
    if (Object.keys(c).length) safe.counters = c;
  }
  return Object.keys(safe).length ? safe : null;
}

// manager อนุมัติได้ + แก้ stock + แก้ devices ได้ แต่ไม่แตะ users
function filterManagerPayload(payload) {
  if (!payload) return null;
  const safe = {};
  const managerKeys = ['repairs','requests','stock','devices','settings','repairSettings','counters'];
  for (const k of managerKeys) {
    if (payload[k] !== undefined) safe[k] = payload[k];
  }
  // ห้าม manager แก้ users array โดยตรง
  return Object.keys(safe).length ? safe : null;
}

// ── Merge เฉพาะ repairs: merge รายการใหม่เข้า array เดิม ไม่ทับทั้ง array ──
function mergeStore(partial) {
  if (!partial) return;
  const allowed = ['users', 'stock', 'requests', 'repairs', 'devices', 'settings', 'repairSettings', 'counters'];
  for (const key of allowed) {
    if (partial[key] === undefined) continue;

    if (key === 'repairs' && Array.isArray(partial.repairs) && Array.isArray(store.repairs)) {
      const existingMap = {};
      for (const r of store.repairs) existingMap[r.id] = r;
      for (const r of partial.repairs) existingMap[r.id] = r;
      store.repairs = Object.values(existingMap);
    } else {
      store[key] = partial[key];
    }
  }
  saveStore();
}

/* ════════════════════════════════════════════════════════════════════════
   Role lookup ที่เชื่อได้ — ใช้แทนการเชื่อ clientRole จาก client ทุกที่
   resolveRoleFromSession คืน null ถ้า session ไม่ valid → caller ต้อง reject
   ════════════════════════════════════════════════════════════════════════ */
function resolveSessionAndUser(req) {
  const session = sessionFromRequest(req);
  if (!session) return null;
  const user = findUserById(session.userId);
  if (!user || user.active === false) {
    destroySession(parseCookies(req).srp_session);
    return null;
  }
  // role ตรวจจาก "ข้อมูลปัจจุบันใน store" เสมอ ไม่ใช่จาก session ตอน login
  // เผื่อ admin เปลี่ยน role ของ user คนนี้ไปแล้วระหว่าง session ยังไม่หมดอายุ
  return { session, user, role: user.role };
}

function sendJSON(res, status, obj, extraHeaders) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Credentials': 'true',
    ...(extraHeaders || {}),
  });
  res.end(JSON.stringify(obj));
}

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) { // 5MB cap กัน DoS แบบ body ใหญ่เกิน
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/* ════════════════════════════════════════════════════════════════════════
   HTTP server
   ════════════════════════════════════════════════════════════════════════ */
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  /* ── CORS preflight ── */
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
    });
    return res.end();
  }

  /* ── POST /api/login — server ตรวจรหัสผ่านเอง ── */
  if (req.method === 'POST' && url === '/api/login') {
    let body;
    try { body = await readJSONBody(req); }
    catch (e) { return sendJSON(res, 400, { error: 'invalid body' }); }

    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const ip = clientIp(req);

    if (!username || !password) {
      return sendJSON(res, 400, { error: 'username and password required' });
    }

    const user = findUserByUsername(username);

    // ── admin ไม่มีการล็อคบัญชี ใส่รหัสผิดได้ไม่จำกัดครั้ง ──────────────
    const _isAdminRole = user && user.role === 'admin';
    if (!_isAdminRole) {
      const rl = checkRateLimit(username, ip);
      if (rl.blocked) {
        return sendJSON(res, 429, {
          error: 'locked',
          remainingMs: rl.remainingMs,
        });
      }
    }
    const candidateHash = sha256(password);

    // เทียบแบบ constant-time ไม่ได้สำคัญมากที่นี่เพราะ comparison เป็น hash
    // ที่ fix length อยู่แล้ว แต่ใส่ timingSafeEqual ไว้เผื่ออนาคต
    const matches = !!user && user.active !== false && (
      (user.hashed && safeCompare(user.pass, candidateHash)) ||
      (!user.hashed && safeCompare(user.pass, password)) // backward-compat กับ plaintext เดิม
    );

    if (!matches) {
      if (!_isAdminRole) recordLoginFailure(username, ip); // admin ไม่นับ fail
      return sendJSON(res, 401, { error: 'invalid credentials' });
    }

    clearLoginFailures(username, ip);

    // migrate plaintext -> hash ถ้ายังไม่ hash (ทำบน server แทน client)
    if (!user.hashed) {
      user.pass = sha256(password);
      user.hashed = true;
      saveStore();
    }

    const token = createSession(user);
    setSessionCookie(res, token);
    serverLog('LOGIN', user.username, `from ${ip}`);

    const { pass, hashed, ...safeUser } = user;
    return sendJSON(res, 200, { ok: true, user: safeUser });
  }

  /* ── POST /api/logout ── */
  if (req.method === 'POST' && url === '/api/logout') {
    const cookies = parseCookies(req);
    const sess = sessions.get(cookies.srp_session);
    if (sess) serverLog('LOGOUT', sess.username, '');
    destroySession(cookies.srp_session);
    clearSessionCookie(res);
    return sendJSON(res, 200, { ok: true });
  }

  /* ── POST /api/register — สมัครบัญชีใหม่ ไม่ต้อง login ──────────────────
     สำคัญ: route นี้ "เขียนได้แค่ผู้ใช้ใหม่ที่ active:false" เท่านั้น
     ไม่รับ payload ที่เป็น users[] ทั้งก้อนจาก client แบบเดิม (ของเก่าฝั่ง
     frontend ปลอม clientRole:'admin' เพื่อให้ทับ users ได้ทั้ง array —
     อันตรายมาก เพราะใครก็ยิง request ตรงมาที่ /api/push พร้อม users[]
     ของตัวเองที่แต่ง role เป็น admin ไปแล้วได้). Route นี้สร้าง user record
     ขึ้นบน server เอง รับแค่ field ข้อมูลพื้นฐาน ป้องกัน field อันตราย
     เช่น role/active/id ไม่ให้ client กำหนดเอง ── */
  if (req.method === 'POST' && url === '/api/register') {
    let body;
    try { body = await readJSONBody(req); }
    catch (e) { return sendJSON(res, 400, { error: 'invalid body' }); }

    const ip = clientIp(req);
    const rl = checkRegisterRateLimit(ip);
    if (rl.blocked) {
      return sendJSON(res, 429, { error: 'too many registration attempts, try later' });
    }

    const username = String(body.username || '').trim().toLowerCase();
    const name     = String(body.name     || '').trim();
    const dept     = String(body.dept     || '').trim();
    const position = String(body.position || '').trim();
    const emp      = String(body.emp      || '').trim();
    const password = String(body.password || '');

    if (!username || /\s/.test(username)) return sendJSON(res, 400, { error: 'invalid username' });
    if (!name) return sendJSON(res, 400, { error: 'name required' });
    if (!dept) return sendJSON(res, 400, { error: 'dept required' });
    if (password.length < 4) return sendJSON(res, 400, { error: 'password too short' });

    recordRegisterAttempt(ip);

    if (findUserByUsername(username)) {
      return sendJSON(res, 409, { error: 'username already exists' });
    }

    if (!Array.isArray(store.users)) store.users = [];

    const newUser = {
      id:       'u_reg_' + crypto.randomBytes(8).toString('hex'),
      username,
      pass:     sha256(password),
      hashed:   true,
      name,
      dept,
      position,
      emp:      emp || username,
      email:    '',
      role:     'user',      // ── บังคับเป็น 'user' เสมอ ห้าม client กำหนด role ตัวเองได้ ──
      active:   false,       // ── บังคับ false เสมอ ต้องรอ admin มา activate ──
      mustChangePass: false, // ตั้งรหัสเองตอนสมัครแล้ว ไม่ต้องบังคับเปลี่ยนซ้ำ
      pendingRegister: true,
      registeredAt: new Date().toISOString(),
    };

    store.users.push(newUser);
    saveStore();
    broadcast({ type: 'update', payload: { users: sanitizeUsersForClient(store.users) } }, null);
    console.log('[Register] New pending user:', username, 'from', ip);

    return sendJSON(res, 200, { ok: true });
  }

  /* ── POST /api/change-password — ผู้ใช้เปลี่ยนรหัสผ่านของ "ตัวเอง" เท่านั้น
     ไม่รับ userId จาก client เลย ใช้ resolved.user.id จาก session แทนเสมอ
     เพื่อกัน user คนหนึ่งส่ง id ของอีกคนมาเปลี่ยนรหัสแทนกัน ── */
  if (req.method === 'POST' && url === '/api/change-password') {
    const resolved = resolveSessionAndUser(req);
    if (!resolved) return sendJSON(res, 401, { error: 'not authenticated' });

    let body;
    try { body = await readJSONBody(req); }
    catch (e) { return sendJSON(res, 400, { error: 'invalid body' }); }

    const currentPassword = String(body.currentPassword || '');
    const newPassword     = String(body.newPassword     || '');

    if (newPassword.length < 8) return sendJSON(res, 400, { error: 'password must be at least 8 characters' });
    if (!/[0-9]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword)) {
      return sendJSON(res, 400, { error: 'password must include upper, lower case and a number' });
    }

    const user = findUserById(resolved.user.id);
    if (!user) return sendJSON(res, 404, { error: 'user not found' });

    // ตรวจรหัสผ่านปัจจุบัน (ยกเว้น mustChangePass เพราะยังไม่รู้รหัสเดิม)
    if (currentPassword && !user.mustChangePass) {
      const curHash = sha256(currentPassword);
      if (!safeCompare(user.pass, curHash)) {
        return sendJSON(res, 400, { error: 'current password incorrect' });
      }
    }

    user.pass = sha256(newPassword);
    user.hashed = true;
    user.mustChangePass = false;
    saveStore();
    serverLog('CHANGE_PASSWORD', resolved.user.username, 'changed own password');
    broadcast({ type: 'update', payload: { users: sanitizeUsersForClient(store.users) } }, null);

    return sendJSON(res, 200, { ok: true });
  }

  /* ── POST /api/admin/reset-password — admin รีเซ็ตรหัสผ่าน user คนอื่น ── */
  if (req.method === 'POST' && url === '/api/admin/reset-password') {
    const resolved = resolveSessionAndUser(req);
    if (!resolved) return sendJSON(res, 401, { error: 'not authenticated' });
    if (resolved.role !== 'admin') return sendJSON(res, 403, { error: 'admin only' });

    let body;
    try { body = await readJSONBody(req); }
    catch (e) { return sendJSON(res, 400, { error: 'invalid body' }); }

    const targetUsername = String(body.username || '').trim().toLowerCase();
    const newPassword    = String(body.newPassword || '');

    if (!targetUsername) return sendJSON(res, 400, { error: 'username required' });
    if (newPassword.length < 4) return sendJSON(res, 400, { error: 'password too short' });

    const target = findUserByUsername(targetUsername);
    if (!target) return sendJSON(res, 404, { error: 'user not found' });

    target.pass = sha256(newPassword);
    target.hashed = true;
    target.mustChangePass = (newPassword === '1234'); // ถ้า reset เป็น 1234 บังคับเปลี่ยนใหม่
    saveStore();
    serverLog('ADMIN_RESET_PASSWORD', resolved.user.username, `reset password for ${targetUsername}`);
    broadcast({ type: 'update', payload: { users: sanitizeUsersForClient(store.users) } }, null);

    return sendJSON(res, 200, { ok: true });
  }

  /* ── GET /api/store — ต้อง login แล้วเท่านั้น และตัด password ออกเสมอ ── */
  if (req.method === 'GET' && url === '/api/store') {
    const resolved = resolveSessionAndUser(req);
    if (!resolved) {
      return sendJSON(res, 401, { error: 'not authenticated' });
    }
    return sendJSON(res, 200, sanitizeStoreForClient(store));
  }

  /* ── POST /api/push — role มาจาก session เท่านั้น ไม่เชื่อ clientRole ── */
  if (req.method === 'POST' && url === '/api/push') {
    const resolved = resolveSessionAndUser(req);
    if (!resolved) {
      return sendJSON(res, 401, { error: 'not authenticated' });
    }

    let body;
    try { body = await readJSONBody(req); }
    catch (e) { return sendJSON(res, 400, { error: 'invalid body' }); }

    const { payload } = body;
    if (payload) {
      const safePayload = resolved.role === 'admin'   ? payload :
                          resolved.role === 'manager' ? filterManagerPayload(payload) :
                          filterUserPayload(payload);
      if (safePayload) {
        mergeStore(safePayload);
        broadcast({ type: 'update', payload: sanitizeBroadcastPayload(safePayload) }, null);
        console.log('[REST] Push from', resolved.user.username, `(${resolved.role})`, '→ keys:', Object.keys(safePayload).join(', '));
      }
    }
    return sendJSON(res, 200, { ok: true });
  }

  /* ── Static index.html ── */
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    try {
      const html = fs.readFileSync(INDEX_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('index.html not found');
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ตัด password ออกจาก users ก่อน broadcast ผ่าน WebSocket ด้วย (เผื่อ payload มี users)
function sanitizeBroadcastPayload(payload) {
  if (!payload || !Array.isArray(payload.users)) return payload;
  return { ...payload, users: sanitizeUsersForClient(payload.users) };
}

/* ════════════════════════════════════════════════════════════════════════
   WebSocket — ต้อง login แล้วเท่านั้นถึง connect ได้
   ════════════════════════════════════════════════════════════════════════ */
const wss = new WebSocketServer({ noServer: true });
const clients = new Map(); // ws -> { userId, role, username }

server.on('upgrade', (req, socket, head) => {
  const resolved = resolveSessionAndUser(req);
  if (!resolved) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.set(ws, { userId: resolved.user.id, role: resolved.role, username: resolved.user.username });
    wss.emit('connection', ws, req, resolved);
  });
});

function broadcast(msg, skipWs) {
  const data = JSON.stringify(msg);
  for (const ws of clients.keys()) {
    if (ws !== skipWs && ws.readyState === 1) {
      try { ws.send(data); } catch (e) {}
    }
  }
}

wss.on('connection', (ws, req, resolved) => {
  console.log(`[WS] ${resolved.user.username} (${resolved.role}) connected — total: ${clients.size}`);

  try {
    ws.send(JSON.stringify({ type: 'init', payload: sanitizeStoreForClient(store) }));
  } catch (e) {}

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'push') {
      // ── role มาจาก clients map ที่ตั้งไว้ตอน connect (จาก session จริง) ──
      // ไม่ใช่จาก msg.clientRole ที่ client ส่งมา (อันนั้นถูก ignore ไปเลย)
      const conn = clients.get(ws);
      if (!conn) return;
      const { payload } = msg;
      if (payload) {
        const safePayload = conn.role === 'admin'   ? payload :
                            conn.role === 'manager' ? filterManagerPayload(payload) :
                            filterUserPayload(payload);
        if (safePayload) {
          mergeStore(safePayload);
          console.log('[WS] Push from', conn.username, `(${conn.role})`, '→ broadcast, keys:', Object.keys(safePayload).join(', '));
          broadcast({ type: 'update', payload: sanitizeBroadcastPayload(safePayload) }, ws);
        }
      }
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] ${resolved.user.username} disconnected — remaining: ${clients.size}`);
  });

  ws.on('error', () => clients.delete(ws));
});

loadStore();
loadSessions();
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   SRP Real-Time Sync Server  ✓  SECURED      ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║   http://localhost:${PORT}                     ║`);
  console.log('║   Login: POST /api/login (server เป็นคนตรวจ) ║');
  console.log('║   Role อ่านจาก session เท่านั้น ไม่เชื่อ client ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
});

/* ════════════════════════════════════════════════════════════════════════
   เพิ่มจาก server.js เวอร์ชันก่อนหน้า:
   ════════════════════════════════════════════════════════════════════════
   - POST /api/register — สมัครบัญชีใหม่แบบไม่ต้อง login (เดิม frontend
     ทำเองฝั่ง client แล้วปลอม clientRole:'admin' เพื่อ push users[] ทั้งก้อน
     ขึ้น server — อันตรายเพราะใครก็ทำแบบนั้นกับ users[] ของตัวเองได้ ไม่ใช่
     แค่ user ใหม่ที่ active:false). ตอนนี้ server เป็นคนสร้าง record เอง
     บังคับ role:'user' และ active:false เสมอ ไม่รับจาก client
   - POST /api/change-password — ผู้ใช้เปลี่ยนรหัสผ่าน "ของตัวเอง" เท่านั้น
     โดยอ้าง user จาก session ไม่ใช่จาก id ที่ client ส่งมา (เดิม frontend
     เขียนทับ users[] ทั้ง array ผ่าน SrpSync.push ซึ่งใช้ได้แค่กับ admin
     หลังจากปิดรู privilege escalation ไปแล้ว — route นี้มาแทนตรงนั้น)

   สิ่งที่ยังควรทำต่อ (เรียงตามความสำคัญ) — ไม่ได้รวมอยู่ในไฟล์นี้:
   ════════════════════════════════════════════════════════════════════════
   1. ย้าย password hashing จาก SHA-256 เปล่าๆ ไปเป็น bcrypt/argon2/scrypt
      (มี salt + work factor ในตัว) — SHA-256 เปล่าๆ ถูก brute-force ด้วย
      rainbow table ได้เร็วถ้า hash รั่วออกไป (ซึ่งเดิมก็รั่วอยู่แล้วผ่าน
      /api/store — ไฟล์นี้ปิดรูนั้นแล้ว แต่การมี salt ก็ยังเป็น defense
      อีกชั้นที่ควรทำ)

   2. ถ้า deploy จริงควรตั้ง FORCE_HTTPS_COOKIE=1 และรันหลัง reverse proxy
      ที่ทำ TLS termination (nginx/Caddy/Cloudflare) — และตั้ง TRUST_PROXY=1
      ด้วย (ตอนนี้เพิ่มเป็น env var แล้ว, default = ไม่เชื่อ X-Forwarded-For)
      เพื่อให้ rate-limit อ่าน IP ผู้ใช้จริงจาก header ที่ proxy เซ็ตให้
      ⚠️ เปิด TRUST_PROXY=1 ได้เฉพาะตอนมี proxy ที่เชื่อถือได้คอยเซ็ต header
      นี้เองเท่านั้น — ถ้าเปิดโดยไม่มี proxy คอยกรอง ผู้โจมตีปลอม
      X-Forwarded-For เพื่อหลบ rate-limit ได้ทันที

   3. CORS ตอนนี้ยังเปิด '*' ไว้สำหรับ GET/POST เดิม ถ้า frontend serve มา
      จาก origin เดียวกับ server (ตามที่ index.html เขียนไว้คือ ws(s)://
      location.host) ควรเปลี่ยนเป็น origin ที่ระบุชื่อจริงแทน '*' เพื่อกัน
      เว็บอื่นยิง request ข้าม origin มาที่ API นี้

   4. ย้าย session store จาก in-memory Map ไป Redis หรือ DB ถ้าต้อง scale
      เป็นหลาย process/instance (in-memory ใช้ได้กับ single-instance เท่านั้น)
      เพราะตอนนี้ session หายหมดทุกครั้งที่ restart/deploy server ใหม่
   ════════════════════════════════════════════════════════════════════════ */
