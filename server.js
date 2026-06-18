/**
 * SRP Real-Time Sync Server
 */

const http        = require('http');
const fs          = require('fs');
const path        = require('path');
const { WebSocketServer } = require('ws');

const PORT        = process.env.PORT || 3000;
const DATA_FILE   = path.join(__dirname, 'srp_data.json');
const INDEX_FILE  = path.join(__dirname, 'index.html');

let store = {};

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      console.log('[Store] Loaded from disk:', Object.keys(store).join(', ') || 'empty');
    }
  } catch(e) {
    console.warn('[Store] Failed to load from disk:', e.message);
    store = {};
  }
}

function saveStore() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store), 'utf8');
  } catch(e) {
    console.warn('[Store] Failed to save to disk:', e.message);
  }
}

// ── กรอง payload สำหรับ user role: รับได้เฉพาะ repairs และ requests ──
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

// ── Merge เฉพาะ repairs: merge รายการใหม่เข้า array เดิม ไม่ทับทั้ง array ──
function mergeStore(partial) {
  if (!partial) return;
  const allowed = ['users','stock','requests','repairs','devices','settings','repairSettings','counters'];
  for (const key of allowed) {
    if (partial[key] === undefined) continue;

    // repairs: merge รายการใหม่เข้าของเดิม ป้องกัน user ทับข้อมูลคนอื่น
    if (key === 'repairs' && Array.isArray(partial.repairs) && Array.isArray(store.repairs)) {
      const existingMap = {};
      for (const r of store.repairs) existingMap[r.id] = r;
      for (const r of partial.repairs) existingMap[r.id] = r; // เพิ่ม/อัปเดต
      store.repairs = Object.values(existingMap);
    } else {
      store[key] = partial[key];
    }
  }
  saveStore();
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/api/store') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(JSON.stringify(store));
  }

  if (req.method === 'POST' && url === '/api/push') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { clientRole, payload } = JSON.parse(body);
        if (payload) {
          // admin ส่งได้ทุกอย่าง, user ส่งได้เฉพาะ repairs/requests
          const safePayload = clientRole === 'admin' ? payload : filterUserPayload(payload);
          if (safePayload) {
            mergeStore(safePayload);
            broadcast({ type: 'update', payload: safePayload }, null);
            console.log('[REST] Push from', clientRole, '→ keys:', Object.keys(safePayload).join(', '));
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    try {
      const html = fs.readFileSync(INDEX_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch(e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('index.html not found');
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const wss = new WebSocketServer({ server });
const clients = new Set();

function broadcast(msg, skipWs) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws !== skipWs && ws.readyState === 1) {
      try { ws.send(data); } catch(e) {}
    }
  }
}

wss.on('connection', (ws, req) => {
  clients.add(ws);
  const ip = req.socket.remoteAddress || 'unknown';
  console.log(`[WS] Client connected (${ip}) — total: ${clients.size}`);

  try {
    ws.send(JSON.stringify({ type: 'init', payload: store }));
  } catch(e) {}

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'push') {
      const { clientRole, payload } = msg;
      if (payload) {
        // admin ส่งได้ทุกอย่าง, user ส่งได้เฉพาะ repairs/requests
        const safePayload = clientRole === 'admin' ? payload : filterUserPayload(payload);
        if (safePayload) {
          mergeStore(safePayload);
          console.log('[WS] Push from', clientRole, '→ broadcast, keys:', Object.keys(safePayload).join(', '));
          broadcast({ type: 'update', payload: safePayload }, ws);
        }
      }
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected — remaining: ${clients.size}`);
  });

  ws.on('error', () => clients.delete(ws));
});

loadStore();
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   SRP Real-Time Sync Server  ✓  RUNNING      ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║   http://localhost:${PORT}                     ║`);
  console.log('║   User role: ส่ง repairs/requests ได้แล้ว   ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
});
