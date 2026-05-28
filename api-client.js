/**
 * NTEQ IT Stock System — API Client
 * แทนที่ localStorage ด้วย REST API calls ไปหา server.js
 * 
 * วิธีใช้: วาง <script src="api-client.js"></script> ก่อน </body>
 * แล้วเปลี่ยน window.onload ให้เรียก initFromServer() แทน initApp()
 */

const API_BASE = window.location.origin; // ชี้ไปที่ server เดียวกัน

// ──────────────────────────────────────────
// Low-level fetch wrapper
// ──────────────────────────────────────────
async function apiCall(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(API_BASE + '/api' + path, opts);
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'API Error');
  return data;
}

// ──────────────────────────────────────────
// Auth
// ──────────────────────────────────────────
async function apiLogin(username, password) {
  return apiCall('POST', '/login', { username, password });
}

// ──────────────────────────────────────────
// Stock
// ──────────────────────────────────────────
async function apiGetStock()             { return apiCall('GET',    '/stock'); }
async function apiAddStock(item)         { return apiCall('POST',   '/stock', item); }
async function apiUpdateStock(id, item)  { return apiCall('PUT',    `/stock/${id}`, item); }
async function apiReceiveStock(id, qty, remark, by_user) {
  return apiCall('POST', `/stock/${id}/receive`, { qty, remark, by_user });
}
async function apiDeleteStock(id)        { return apiCall('DELETE', `/stock/${id}`); }

// ──────────────────────────────────────────
// Requests (ใบเบิก)
// ──────────────────────────────────────────
async function apiGetRequests(status='') {
  return apiCall('GET', '/requests' + (status ? `?status=${status}` : ''));
}
async function apiCreateRequest(req)     { return apiCall('POST', '/requests', req); }
async function apiApproveRequest(id, body) { return apiCall('PUT', `/requests/${id}/approve`, body); }
async function apiIssueRequest(id, issued_by) {
  return apiCall('PUT', `/requests/${id}/issue`, { issued_by });
}

// ──────────────────────────────────────────
// Repairs (แจ้งซ่อม)
// ──────────────────────────────────────────
async function apiGetRepairs(status='') {
  return apiCall('GET', '/repairs' + (status ? `?status=${status}` : ''));
}
async function apiCreateRepair(rep)      { return apiCall('POST', '/repairs', rep); }
async function apiUpdateRepair(id, body) { return apiCall('PUT',  `/repairs/${id}`, body); }

// ──────────────────────────────────────────
// Devices (อุปกรณ์)
// ──────────────────────────────────────────
async function apiGetDevices(status='') {
  return apiCall('GET', '/devices' + (status ? `?status=${status}` : ''));
}
async function apiAddDevice(dev)         { return apiCall('POST',   '/devices', dev); }
async function apiUpdateDevice(id, dev)  { return apiCall('PUT',    `/devices/${id}`, dev); }
async function apiDeleteDevice(id)       { return apiCall('DELETE', `/devices/${id}`); }

// ──────────────────────────────────────────
// Categories
// ──────────────────────────────────────────
async function apiGetCategories()        { return apiCall('GET',    '/categories'); }
async function apiAddCategory(cat)       { return apiCall('POST',   '/categories', cat); }
async function apiUpdateCategory(id, cat){ return apiCall('PUT',    `/categories/${id}`, cat); }
async function apiDeleteCategory(id)     { return apiCall('DELETE', `/categories/${id}`); }

// ──────────────────────────────────────────
// Approvers
// ──────────────────────────────────────────
async function apiGetApprovers()         { return apiCall('GET',    '/approvers'); }
async function apiAddApprover(ap)        { return apiCall('POST',   '/approvers', ap); }
async function apiUpdateApprover(id, ap) { return apiCall('PUT',    `/approvers/${id}`, ap); }
async function apiDeleteApprover(id)     { return apiCall('DELETE', `/approvers/${id}`); }

// ──────────────────────────────────────────
// Settings
// ──────────────────────────────────────────
async function apiGetSettings()          { return apiCall('GET',  '/settings'); }
async function apiSaveSettings(obj)      { return apiCall('POST', '/settings', obj); }

// ──────────────────────────────────────────
// Users
// ──────────────────────────────────────────
async function apiGetUsers()             { return apiCall('GET',    '/users'); }
async function apiAddUser(u)             { return apiCall('POST',   '/users', u); }
async function apiUpdateUser(id, u)      { return apiCall('PUT',    `/users/${id}`, u); }
async function apiDeleteUser(id)         { return apiCall('DELETE', `/users/${id}`); }

// ──────────────────────────────────────────
// Backup / Restore
// ──────────────────────────────────────────
async function apiBackup() {
  const resp = await fetch(API_BASE + '/api/backup');
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `nteq_backup_${Date.now()}.json`; a.click();
}
async function apiRestore(data)          { return apiCall('POST', '/restore', data); }

// ──────────────────────────────────────────
// Session helpers (เก็บ user ใน sessionStorage)
// ──────────────────────────────────────────
function sessionSaveUser(user) {
  sessionStorage.setItem('nteq_user', JSON.stringify(user));
}
function sessionGetUser() {
  try { return JSON.parse(sessionStorage.getItem('nteq_user')); }
  catch { return null; }
}
function sessionClear() {
  sessionStorage.removeItem('nteq_user');
}

console.log('✅ NTEQ API Client loaded — localStorage mode disabled');
