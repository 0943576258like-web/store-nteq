/**
 * SRP IT Stock – Real-time Sync Server
 * Express + WebSocket (ws) + JSON file persistence
 * Deploy on Render.com (Free tier works fine)
 */

const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const fs        = require('fs');
const path      = require('path');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

const PORT      = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'srp_data.json');

// ─── ensure data directory exists ────────────────────────────────────────────
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

// ─── in-memory store ─────────────────────────────────────────────────────────
let store = {
  users:          null,   // null = use client DEFAULT until first save
  stock:          null,
  requests:       null,
  repairs:        null,
  devices:        null,
  settings:       null,
  repairSettings: null,
  counters: { req: 6, repair: 4, device: 4 },
  _savedAt: null,
};

// ─── load persisted data ──────────────────────────────────────────────────────
function loadFromDisk() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      store = Object.assign(store, JSON.parse(raw));
      console.log('[SRP] Loaded data from disk, savedAt:', store._savedAt);
    }
  } catch (e) {
    console.error('[SRP] Failed to load data file:', e.message);
  }
}

// ─── save to disk (debounced 2 s) ────────────────────────────────────────────
let _saveTimer = null;
function saveToDisk() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      store._savedAt = new Date().toISOString();
      fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
    } catch (e) {
      console.error('[SRP] Failed to save data file:', e.message);
    }
  }, 2000);
}

// ─── broadcast to all connected clients (except sender) ──────────────────────
function broadcast(data, senderWs) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client !== senderWs) {
      client.send(msg);
    }
  });
}

// ─── WebSocket handler ────────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[WS] Client connected: ${ip}  total=${wss.clients.size}`);

  // Send current store snapshot to the newly connected client
  ws.send(JSON.stringify({
    type:    'init',
    payload: store,
  }));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const { type, payload, clientRole } = msg;

    // Only admin/manager/warehouse can push changes
    const allowedRoles = ['admin', 'manager', 'warehouse'];
    if (!allowedRoles.includes(clientRole)) return;

    if (type === 'push') {
      // Merge partial updates into store
      if (payload.users)          store.users          = payload.users;
      if (payload.stock)          store.stock          = payload.stock;
      if (payload.requests)       store.requests       = payload.requests;
      if (payload.repairs)        store.repairs        = payload.repairs;
      if (payload.devices)        store.devices        = payload.devices;
      if (payload.settings)       store.settings       = payload.settings;
      if (payload.repairSettings) store.repairSettings = payload.repairSettings;
      if (payload.counters)       store.counters       = Object.assign({}, store.counters, payload.counters);

      console.log(`[WS] push from ${clientRole}@${ip}  keys=[${Object.keys(payload).join(',')}]`);

      // Persist & broadcast
      saveToDisk();
      broadcast({ type: 'update', payload }, ws);
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Client disconnected: ${ip}  total=${wss.clients.size}`);
  });

  ws.on('error', err => {
    console.error('[WS] Error:', err.message);
  });
});

// ─── REST: serve index.html + health ─────────────────────────────────────────
app.use(express.static(__dirname));
app.use(express.json({ limit: '10mb' }));

// Health check (Render.com pings this)
app.get('/health', (_, res) => res.json({ ok: true, clients: wss.clients.size, savedAt: store._savedAt }));

// REST fallback – GET full store (for reconnect polling)
app.get('/api/store', (_, res) => res.json(store));

// REST fallback – POST partial update (if WS not available)
app.post('/api/push', (req, res) => {
  const { payload, clientRole } = req.body || {};
  const allowedRoles = ['admin', 'manager', 'warehouse'];
  if (!allowedRoles.includes(clientRole)) return res.status(403).json({ error: 'forbidden' });

  if (payload.users)          store.users          = payload.users;
  if (payload.stock)          store.stock          = payload.stock;
  if (payload.requests)       store.requests       = payload.requests;
  if (payload.repairs)        store.repairs        = payload.repairs;
  if (payload.devices)        store.devices        = payload.devices;
  if (payload.settings)       store.settings       = payload.settings;
  if (payload.repairSettings) store.repairSettings = payload.repairSettings;
  if (payload.counters)       store.counters       = Object.assign({}, store.counters, payload.counters);

  saveToDisk();
  broadcast({ type: 'update', payload }, null);
  res.json({ ok: true });
});

// ─── start ────────────────────────────────────────────────────────────────────
loadFromDisk();
server.listen(PORT, () => {
  console.log(`[SRP] Server listening on port ${PORT}`);
});
