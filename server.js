/**
 * SRP Real-Time Sync Server
 * ─────────────────────────
 * เชื่อมต่อทุกเครื่องแบบ Real-time ผ่าน WebSocket
 * ข้อมูลที่แก้ไข/เพิ่มใหม่จะ sync ไปทุก Browser ทันที
 *
 * วิธีรัน:
 *   node server.js
 *
 * แล้วเปิดเบราว์เซอร์ที่:
 *   http://localhost:3000
 */

const http        = require('http');
const fs          = require('fs');
const path        = require('path');
const { WebSocketServer } = require('ws');

// ── Config ────────────────────────────────────────────────────────────────
const PORT        = process.env.PORT || 3000;
const DATA_FILE   = path.join(__dirname, 'srp_data.json');
const INDEX_FILE  = path.join(__dirname, 'index.html');

// ── In-memory store (persist ลง disk ด้วย) ────────────────────────────────
let store = {};

// โหลดข้อมูลจาก disk ถ้ามี
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

// บันทึกข้อมูลลง disk
function saveStore() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store), 'utf8');
  } catch(e) {
    console.warn('[Store] Failed to save to disk:', e.message);
  }
}

// Merge partial update เข้า store
function mergeStore(partial) {
  if (!partial) return;
  const allowed = ['users','stock','requests','repairs','devices','settings','repairSettings','counters'];
  for (const key of allowed) {
    if (partial[key] !== undefined) {
      store[key] = partial[key];
    }
  }
  saveStore();
}

// ── HTTP Server ────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // ── API: ดึงข้อมูลทั้งหมด
  if (req.method === 'GET' && url === '/api/store') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(JSON.stringify(store));
  }

  // ── API: รับ push จาก client (REST fallback เมื่อ WS ไม่พร้อม)
  if (req.method === 'POST' && url === '/api/push') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { clientRole, payload } = JSON.parse(body);
        // อนุญาตเฉพาะ admin ส่ง push
        if (clientRole === 'admin' && payload) {
          mergeStore(payload);
          // broadcast ไปทุก WebSocket client
          broadcast({ type: 'update', payload }, null);
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

  // ── CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // ── Serve index.html
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

  // ── 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

// ── WebSocket Server ───────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });
const clients = new Set();

function broadcast(msg, skipWs) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws !== skipWs && ws.readyState === 1) { // OPEN = 1
      try { ws.send(data); } catch(e) {}
    }
  }
}

wss.on('connection', (ws, req) => {
  clients.add(ws);
  const ip = req.socket.remoteAddress || 'unknown';
  console.log(`[WS] Client connected (${ip}) — total: ${clients.size}`);

  // ส่ง snapshot ปัจจุบันให้ client ใหม่ทันที
  try {
    ws.send(JSON.stringify({ type: 'init', payload: store }));
  } catch(e) {}

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'push') {
      const { clientRole, payload } = msg;
      // อนุญาตเฉพาะ admin
      if (clientRole === 'admin' && payload) {
        mergeStore(payload);
        console.log('[WS] Push from admin → broadcast, keys:', Object.keys(payload).join(', '));
        // broadcast ไปทุกคนยกเว้นคนส่ง
        broadcast({ type: 'update', payload }, ws);
      }
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected — remaining: ${clients.size}`);
  });

  ws.on('error', () => clients.delete(ws));
});

// ── Start ──────────────────────────────────────────────────────────────────
loadStore();
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   SRP Real-Time Sync Server  ✓  RUNNING      ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║   เปิดเบราว์เซอร์ที่:                        ║`);
  console.log(`║   http://localhost:${PORT}                     ║`);
  console.log('║                                              ║');
  console.log('║   ข้อมูลจะ sync ทุกเครื่องแบบ Real-time     ║');
  console.log('║   และบันทึกลงไฟล์ srp_data.json             ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
});
