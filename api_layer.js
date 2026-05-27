<script>
// ═══════════════════════════════════════════════════════════════
//  API LAYER — แทนที่ localStorage ด้วย PostgreSQL via REST API
// ═══════════════════════════════════════════════════════════════
let _token = localStorage.getItem('nteq_token') || '';
let _apiBase = '';

async function apiFetch(path, opts = {}) {
  const res = await fetch(_apiBase + path, {
    headers: {
      'Content-Type': 'application/json',
      ...((_token) ? { 'Authorization': 'Bearer ' + _token } : {})
    },
    ...opts,
    body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined
  });
  if (res.status === 401) {
    _token = '';
    localStorage.removeItem('nteq_token');
    showLogin();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || 'API Error');
  }
  return res.json();
}

// ── State ──────────────────────────────────────────────────────
let currentUser = null;
let stockData   = [];
let requests    = [];
let repairs     = [];
let deviceData  = [];
let settings    = {};
let approvers   = [];
let categories  = [];
let users       = [];

// ── Show / Hide login ──────────────────────────────────────────
function showLogin() {
  document.getElementById('screen-login').classList.remove('hidden');
  document.getElementById('app-header').style.display = 'none';
  document.getElementById('app-layout').style.display = 'none';
}

// ── LOGIN ──────────────────────────────────────────────────────
async function doLogin() {
  const uname = document.getElementById('l-user').value.trim();
  const pass  = document.getElementById('l-pass').value;
  const err   = document.getElementById('login-err');
  try {
    const data = await apiFetch('/api/login', {
      method: 'POST',
      body: { username: uname, password: pass }
    });
    _token = data.token;
    localStorage.setItem('nteq_token', _token);
    currentUser = data.user;
    err.style.display = 'none';
    await loadAllData();
    showApp();
  } catch(e) {
    err.style.display = 'block';
    setTimeout(() => err.style.display = 'none', 3000);
  }
}

// ── LOGOUT ─────────────────────────────────────────────────────
function doLogout() {
  if (!confirm('ออกจากระบบ?')) return;
  _token = '';
  currentUser = null;
  localStorage.removeItem('nteq_token');
  showLogin();
}

// ── SHOW APP ───────────────────────────────────────────────────
function showApp() {
  document.getElementById('screen-login').classList.add('hidden');
  document.getElementById('app-header').style.display = 'flex';
  document.getElementById('app-layout').style.display = 'flex';
  updateNavUser();
  updateBadge();
  updateRepairBadge();
  goTo('dashboard', document.getElementById('nav-dashboard'));
}

// ── LOAD ALL DATA ──────────────────────────────────────────────
async function loadAllData() {
  try {
    const [st, req, rep, dev, sett, cats, appr] = await Promise.all([
      apiFetch('/api/stock'),
      apiFetch('/api/requests'),
      apiFetch('/api/repairs'),
      apiFetch('/api/devices'),
      apiFetch('/api/settings'),
      apiFetch('/api/categories'),
      apiFetch('/api/approvers')
    ]);
    stockData   = st;
    requests    = req.map(r => ({ ...r, items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items }));
    repairs     = rep;
    deviceData  = dev;
    settings    = sett;
    categories  = cats;
    approvers   = appr;
    if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'manager')) {
      users = await apiFetch('/api/users');
    }
  } catch(e) {
    console.error('loadAllData error:', e);
  }
}

// ── REFRESH HELPERS ────────────────────────────────────────────
async function refreshStock()     { stockData  = await apiFetch('/api/stock'); }
async function refreshRequests()  { 
  const r = await apiFetch('/api/requests');
  requests = r.map(x => ({ ...x, items: typeof x.items === 'string' ? JSON.parse(x.items) : x.items }));
}
async function refreshRepairs()   { repairs    = await apiFetch('/api/repairs'); }
async function refreshDevices()   { deviceData = await apiFetch('/api/devices'); }
async function refreshUsers()     { users      = await apiFetch('/api/users'); }
async function refreshSettings()  { settings   = await apiFetch('/api/settings'); }
async function refreshCategories(){ categories = await apiFetch('/api/categories'); }

// ── STOCK API ─────────────────────────────────────────────────
async function saveStock() {
  const isEdit = !!document.getElementById('ms-id').dataset.editId;
  const editId = document.getElementById('ms-id').dataset.editId;
  const body = {
    code: document.getElementById('ms-id').value.trim(),
    name: document.getElementById('ms-name').value.trim(),
    category: document.getElementById('ms-cat').value,
    unit: document.getElementById('ms-unit').value,
    qty: parseInt(document.getElementById('ms-qty').value) || 0,
    min_qty: parseInt(document.getElementById('ms-min').value) || 10,
    img: document.getElementById('ms-img').value || ''
  };
  if (!body.code || !body.name) { alert('กรุณากรอกรหัสและชื่อสินค้า'); return; }
  try {
    if (isEdit) {
      await apiFetch('/api/stock/' + editId, { method: 'PUT', body });
    } else {
      await apiFetch('/api/stock', { method: 'POST', body });
    }
    closeModal('modal-stock');
    await refreshStock();
    renderStock();
    renderDashboard();
    toast(isEdit ? 'อัปเดตสินค้าสำเร็จ' : 'เพิ่มสินค้าสำเร็จ', 'success');
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

async function deleteStock(id) {
  if (!confirm('ลบสินค้านี้?')) return;
  try {
    await apiFetch('/api/stock/' + id, { method: 'DELETE' });
    await refreshStock();
    renderStock();
    renderDashboard();
    toast('ลบสินค้าสำเร็จ', 'success');
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

async function confirmRecv() {
  const id     = document.getElementById('modal-recv').dataset.stockId;
  const qty    = parseInt(document.getElementById('recv-qty').value) || 0;
  const remark = document.getElementById('recv-remark').value;
  if (qty <= 0) { alert('กรุณากรอกจำนวนที่รับเข้า'); return; }
  try {
    await apiFetch('/api/stock/' + id + '/receive', { method: 'POST', body: { qty, remark } });
    closeModal('modal-recv');
    await refreshStock();
    renderStock();
    renderDashboard();
    toast('รับสินค้าเข้าคลังสำเร็จ', 'success');
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

function openRecv(id) {
  const s = stockData.find(x => x.id == id);
  if (!s) return;
  document.getElementById('recv-name').textContent = s.name;
  document.getElementById('recv-qty').value = 1;
  document.getElementById('recv-remark').value = '';
  document.getElementById('modal-recv').dataset.stockId = id;
  openModal('modal-recv');
}

function openEditStock(id) {
  const s = stockData.find(x => x.id == id);
  if (!s) return;
  document.getElementById('mstock-title').textContent = 'แก้ไขสินค้า';
  const msid = document.getElementById('ms-id');
  msid.value = s.code;
  msid.dataset.editId = id;
  document.getElementById('ms-name').value = s.name;
  document.getElementById('ms-cat').value  = s.category;
  document.getElementById('ms-unit').value = s.unit;
  document.getElementById('ms-qty').value  = s.qty;
  document.getElementById('ms-min').value  = s.min_qty;
  document.getElementById('ms-img').value  = s.img || '';
  updateStockImgPreview(s.img || '');
  openModal('modal-stock');
}

function openAddStock() {
  document.getElementById('mstock-title').textContent = 'เพิ่มอุปกรณ์ IT ใหม่';
  const msid = document.getElementById('ms-id');
  msid.value = '';
  delete msid.dataset.editId;
  document.getElementById('ms-name').value = '';
  document.getElementById('ms-qty').value  = 0;
  document.getElementById('ms-min').value  = 10;
  document.getElementById('ms-img').value  = '';
  document.getElementById('ms-img-preview').textContent = '📦';
  openModal('modal-stock');
}

// ── REQUEST API ───────────────────────────────────────────────
async function submitRequest() {
  const rows = document.querySelectorAll('#items-list .item-row');
  if (!rows.length) { alert('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ'); return; }
  const items = [];
  rows.forEach(r => {
    const n = r.querySelector('select') ? r.querySelector('select').value : r.querySelector('input').value;
    const q = parseInt(r.querySelectorAll('input')[r.querySelector('select') ? 0 : 1]?.value) || 1;
    items.push({ name: n, qty: q });
  });
  const body = {
    requester_name: document.getElementById('f-name').value || currentUser.name,
    emp_id: document.getElementById('f-emp').value || currentUser.emp_id || '',
    dept: document.getElementById('f-dept').value,
    req_type: document.getElementById('f-type').value,
    req_date: document.getElementById('f-date').value,
    urgency: document.getElementById('f-urgent').value,
    items,
    remark: document.getElementById('f-remark').value
  };
  try {
    const r = await apiFetch('/api/requests', { method: 'POST', body });
    await refreshRequests();
    updateBadge();
    document.getElementById('req-alert-id').textContent = r.req_no;
    document.getElementById('req-alert').style.display = 'block';
    setTimeout(() => document.getElementById('req-alert').style.display = 'none', 5000);
    clearReqForm();
    toast('ส่งใบเบิกสำเร็จ: ' + r.req_no, 'success');
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

async function setStatus(id, newStatus) {
  try {
    if (newStatus === 'approved') {
      await apiFetch('/api/requests/' + id + '/approve', { method: 'PUT' });
    } else if (newStatus === 'issued') {
      await apiFetch('/api/requests/' + id + '/issue', { method: 'PUT' });
    } else if (newStatus === 'rejected') {
      const reason = prompt('เหตุผลที่ปฏิเสธ:') || '';
      await apiFetch('/api/requests/' + id + '/reject', { method: 'PUT', body: { reason } });
    }
    await refreshRequests();
    await refreshStock();
    updateBadge();
    renderApprove();
    renderStock();
    renderDashboard();
    toast('อัปเดตสถานะสำเร็จ', 'success');
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

async function deleteReq(id) {
  if (!confirm('ลบใบเบิกนี้?')) return;
  try {
    await apiFetch('/api/requests/' + id, { method: 'DELETE' });
    await refreshRequests();
    updateBadge();
    renderApprove();
    renderHistory();
    toast('ลบใบเบิกสำเร็จ', 'success');
  } catch(e) { toast('ไม่สามารถลบได้: ' + e.message, 'error'); }
}

// ── REPAIR API ────────────────────────────────────────────────
async function saveRepair() {
  const isEdit = document.getElementById('modal-repair').dataset.editId;
  const body = {
    reporter_name: document.getElementById('rp-name').value,
    emp_id:        document.getElementById('rp-emp').value,
    dept:          document.getElementById('rp-dept').value,
    device_type:   document.getElementById('rp-type').value,
    symptom:       document.getElementById('rp-symptom').value
  };
  try {
    if (isEdit) {
      await apiFetch('/api/repairs/' + isEdit, { method: 'PUT', body });
    } else {
      await apiFetch('/api/repairs', { method: 'POST', body });
    }
    closeModal('modal-repair');
    await refreshRepairs();
    updateRepairBadge();
    renderRepair();
    renderDashboard();
    toast(isEdit ? 'อัปเดตการแจ้งซ่อมสำเร็จ' : 'แจ้งซ่อมสำเร็จ', 'success');
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

async function confirmRepairStatus(id) {
  const status      = document.getElementById('rps-status-' + id)?.value || document.getElementById('rps-status')?.value;
  const assigned_to = document.getElementById('rps-assign-' + id)?.value || document.getElementById('rps-assign')?.value || '';
  const note        = document.getElementById('rps-note-' + id)?.value   || document.getElementById('rps-note')?.value   || '';
  try {
    await apiFetch('/api/repairs/' + id, { method: 'PUT', body: { status, assigned_to, note } });
    closeModal('modal-repair-status');
    await refreshRepairs();
    updateRepairBadge();
    renderRepair();
    renderDashboard();
    toast('อัปเดตสถานะซ่อมสำเร็จ', 'success');
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

async function deleteRepair(id) {
  if (!confirm('ลบรายการซ่อมนี้?')) return;
  try {
    await apiFetch('/api/repairs/' + id, { method: 'DELETE' });
    await refreshRepairs();
    updateRepairBadge();
    renderRepair();
    toast('ลบสำเร็จ', 'success');
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

// ── USER API ──────────────────────────────────────────────────
async function saveUser() {
  const editId = document.getElementById('modal-user').dataset.editId;
  const body = {
    name:   document.getElementById('mu-name').value.trim(),
    emp_id: document.getElementById('mu-emp').value.trim(),
    username: document.getElementById('mu-user').value.trim().toLowerCase(),
    password: document.getElementById('mu-pass').value,
    role:   document.getElementById('mu-role').value,
    dept:   document.getElementById('mu-dept').value,
    active: true
  };
  if (!body.name || !body.username || (!editId && !body.password)) {
    document.getElementById('mu-err').textContent = 'กรุณากรอกข้อมูลให้ครบ';
    return;
  }
  try {
    if (editId) {
      await apiFetch('/api/users/' + editId, { method: 'PUT', body });
    } else {
      await apiFetch('/api/users', { method: 'POST', body });
    }
    closeModal('modal-user');
    await refreshUsers();
    renderUsers();
    toast(editId ? 'อัปเดตผู้ใช้สำเร็จ' : 'เพิ่มผู้ใช้สำเร็จ', 'success');
  } catch(e) {
    document.getElementById('mu-err').textContent = 'เกิดข้อผิดพลาด: ' + e.message;
  }
}

async function toggleUser(id) {
  const u = users.find(x => x.id == id);
  if (!u) return;
  try {
    await apiFetch('/api/users/' + id, { method: 'PUT', body: { ...u, active: !u.active } });
    await refreshUsers();
    renderUsers();
    toast('อัปเดตสำเร็จ', 'success');
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

async function deleteUser(id) {
  if (!confirm('ปิดการใช้งานผู้ใช้นี้?')) return;
  try {
    await apiFetch('/api/users/' + id, { method: 'DELETE' });
    await refreshUsers();
    renderUsers();
    toast('ปิดการใช้งานสำเร็จ', 'success');
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

// ── DEVICE API ────────────────────────────────────────────────
async function saveDevice() {
  const editId = document.getElementById('dev-modal').dataset.editId;
  const body = {
    code:        document.getElementById('dev-m-code').value.trim(),
    name:        document.getElementById('dev-m-name').value.trim(),
    brand:       document.getElementById('dev-m-brand').value.trim(),
    model:       document.getElementById('dev-m-model').value.trim(),
    device_type: document.getElementById('dev-m-type').value.trim(),
    subtype:     document.getElementById('dev-m-subtype').value.trim(),
    serial_no:   document.getElementById('dev-m-sn').value.trim(),
    dept:        document.getElementById('dev-m-dept').value.trim(),
    assigned_user: document.getElementById('dev-m-user').value.trim(),
    company:     document.getElementById('dev-m-company').value.trim(),
    warranty:    document.getElementById('dev-m-warranty').value.trim(),
    price:       parseFloat(document.getElementById('dev-m-price').value) || 0,
    status:      document.getElementById('dev-m-status').value
  };
  if (!body.code || !body.name) { alert('กรุณากรอกรหัสและชื่ออุปกรณ์'); return; }
  try {
    if (editId) {
      await apiFetch('/api/devices/' + editId, { method: 'PUT', body });
    } else {
      await apiFetch('/api/devices', { method: 'POST', body });
    }
    closeDeviceModal();
    await refreshDevices();
    renderDevices();
    toast(editId ? 'อัปเดตอุปกรณ์สำเร็จ' : 'เพิ่มอุปกรณ์สำเร็จ', 'success');
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

async function deleteSelectedDevices() {
  const checked = [...document.querySelectorAll('.dev-chk:checked')];
  if (!checked.length) { alert('กรุณาเลือกอุปกรณ์ที่ต้องการลบ'); return; }
  if (!confirm('ลบ ' + checked.length + ' อุปกรณ์?')) return;
  try {
    await Promise.all(checked.map(c => apiFetch('/api/devices/' + c.dataset.id, { method: 'DELETE' })));
    await refreshDevices();
    renderDevices();
    toast('ลบสำเร็จ', 'success');
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

// ── SETTINGS API ──────────────────────────────────────────────
async function saveSettingsForm() {
  const body = {
    company_name:    document.getElementById('set-co-name').value,
    company_address: document.getElementById('set-co-address').value,
    low_stock_alert: document.getElementById('set-low-alert').checked ? 'true' : 'false',
    print_approver:  document.getElementById('set-print-approver').checked ? 'true' : 'false'
  };
  try {
    await apiFetch('/api/settings', { method: 'PUT', body });
    await refreshSettings();
    toast('บันทึกการตั้งค่าสำเร็จ', 'success');
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

// ── CATEGORY API ──────────────────────────────────────────────
async function saveCategory() {
  const editId = document.getElementById('mc-edit-idx').value;
  const body = {
    name:  document.getElementById('mc-name').value.trim(),
    icon:  document.getElementById('mc-icon').value.trim() || '📦',
    color: document.getElementById('mc-color').value
  };
  if (!body.name) { document.getElementById('mc-err').textContent = 'กรุณาใส่ชื่อหมวดหมู่'; return; }
  try {
    if (editId) {
      await apiFetch('/api/categories/' + editId, { method: 'PUT', body });
    } else {
      await apiFetch('/api/categories', { method: 'POST', body });
    }
    closeModal('modal-cat');
    await refreshCategories();
    refreshCategoryDropdowns();
    renderCategoryList();
    toast('บันทึกหมวดหมู่สำเร็จ', 'success');
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

async function deleteCategory(id) {
  if (!confirm('ลบหมวดหมู่นี้?')) return;
  try {
    await apiFetch('/api/categories/' + id, { method: 'DELETE' });
    await refreshCategories();
    refreshCategoryDropdowns();
    renderCategoryList();
    toast('ลบสำเร็จ', 'success');
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

// ── APPROVER API ──────────────────────────────────────────────
async function saveApprover() {
  const editId = document.getElementById('modal-approver')?.dataset.editId;
  const body = {
    name:     document.getElementById('ap-name').value.trim(),
    position: document.getElementById('ap-pos').value.trim()
  };
  if (!body.name) { alert('กรุณากรอกชื่อ'); return; }
  try {
    if (editId) {
      await apiFetch('/api/approvers/' + editId, { method: 'PUT', body });
    } else {
      await apiFetch('/api/approvers', { method: 'POST', body });
    }
    closeModal('modal-approver');
    approvers = await apiFetch('/api/approvers');
    renderApproverList();
    toast('บันทึกสำเร็จ', 'success');
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

async function deleteApprover(id) {
  if (!confirm('ลบผู้อนุมัตินี้?')) return;
  try {
    await apiFetch('/api/approvers/' + id, { method: 'DELETE' });
    approvers = await apiFetch('/api/approvers');
    renderApproverList();
    toast('ลบสำเร็จ', 'success');
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

// ── LOAD SETTINGS ─────────────────────────────────────────────
function loadSettings() {
  if (document.getElementById('set-co-name')) {
    document.getElementById('set-co-name').value    = settings.company_name || 'NTEQ Polymer';
    document.getElementById('set-co-address').value = settings.company_address || '';
    document.getElementById('set-low-alert').checked = settings.low_stock_alert !== 'false';
    document.getElementById('set-print-approver').checked = settings.print_approver !== 'false';
  }
  const coName = settings.company_name || 'NTEQ Polymer';
  const coNameEl = document.getElementById('login-co-name');
  if (coNameEl) coNameEl.textContent = coName;
  const hdCoEl = document.getElementById('hd-co');
  if (hdCoEl) hdCoEl.textContent = coName;
  const navCoEl = document.getElementById('nav-co-name');
  if (navCoEl) navCoEl.textContent = coName;
}

// ── BACKUP / RESTORE (download JSON ยังคงทำงานได้) ─────────────
function getBackupData() {
  const what = { stock: true, requests: true, repairs: true, users: true, settings: true };
  const bk = {};
  if (document.getElementById('bk-stock')?.checked    ?? true) bk.stockData   = stockData;
  if (document.getElementById('bk-requests')?.checked ?? true) bk.requests    = requests;
  if (document.getElementById('bk-repairs')?.checked  ?? true) bk.repairs     = repairs;
  if (document.getElementById('bk-users')?.checked    ?? true) bk.users       = users;
  if (document.getElementById('bk-settings')?.checked ?? true) bk.settings    = settings;
  bk.devices    = deviceData;
  bk.categories = categories;
  bk.approvers  = approvers;
  bk.exported_at = new Date().toISOString();
  return bk;
}

// ── INIT ──────────────────────────────────────────────────────
async function initApp() {
  // Auto-login ถ้ามี token
  if (_token) {
    try {
      const me = await apiFetch('/api/me');
      currentUser = me;
      await loadAllData();
      showApp();
    } catch(e) {
      showLogin();
    }
  } else {
    showLogin();
  }

  // อัปเดตวันที่ใน header
  const dateEl = document.getElementById('hd-date');
  if (dateEl) {
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString('th-TH', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  }

  initDropdowns();
}

// ── OPEN DEVICE MODAL ─────────────────────────────────────────
function openAddDeviceModal() {
  document.getElementById('dev-modal-title').textContent = 'เพิ่มอุปกรณ์ใหม่';
  delete document.getElementById('dev-modal').dataset.editId;
  ['dev-m-code','dev-m-name','dev-m-brand','dev-m-model','dev-m-type','dev-m-subtype','dev-m-sn','dev-m-dept','dev-m-user','dev-m-company','dev-m-warranty'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('dev-m-price').value = 0;
  document.getElementById('dev-m-status').value = 'active';
  document.getElementById('dev-modal').style.display = 'flex';
}

function editDevice(id) {
  const d = deviceData.find(x => x.id == id);
  if (!d) return;
  document.getElementById('dev-modal-title').textContent = 'แก้ไขอุปกรณ์';
  document.getElementById('dev-modal').dataset.editId = id;
  document.getElementById('dev-m-code').value     = d.code || '';
  document.getElementById('dev-m-name').value     = d.name || '';
  document.getElementById('dev-m-brand').value    = d.brand || '';
  document.getElementById('dev-m-model').value    = d.model || '';
  document.getElementById('dev-m-type').value     = d.device_type || '';
  document.getElementById('dev-m-subtype').value  = d.subtype || '';
  document.getElementById('dev-m-sn').value       = d.serial_no || '';
  document.getElementById('dev-m-dept').value     = d.dept || '';
  document.getElementById('dev-m-user').value     = d.assigned_user || '';
  document.getElementById('dev-m-company').value  = d.company || '';
  document.getElementById('dev-m-warranty').value = d.warranty || '';
  document.getElementById('dev-m-price').value    = d.price || 0;
  document.getElementById('dev-m-status').value   = d.status || 'active';
  document.getElementById('dev-modal').style.display = 'flex';
}

function closeDeviceModal() {
  document.getElementById('dev-modal').style.display = 'none';
}

// ── MODAL HELPERS ─────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).style.display = 'flex'; }

// ── OPEN REPAIR MODAL ─────────────────────────────────────────
function openRepairModal(id) {
  document.getElementById('mrep-title').textContent = 'แจ้งซ่อม IT ใหม่';
  delete document.getElementById('modal-repair').dataset.editId;
  document.getElementById('rp-name').value    = currentUser?.name || '';
  document.getElementById('rp-emp').value     = currentUser?.emp_id || '';
  if (document.getElementById('rp-dept')) document.getElementById('rp-dept').value = currentUser?.dept || '';
  document.getElementById('modal-repair').style.display = 'flex';
}

// ── OPEN USER MODAL ───────────────────────────────────────────
function openAddUser() {
  document.getElementById('muser-title').textContent = 'เพิ่มผู้ใช้ใหม่';
  delete document.getElementById('modal-user').dataset.editId;
  ['mu-name','mu-emp','mu-user','mu-pass'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  document.getElementById('mu-err').textContent = '';
  openModal('modal-user');
}

function openEditUser(id) {
  const u = users.find(x => x.id == id);
  if (!u) return;
  document.getElementById('muser-title').textContent = 'แก้ไขผู้ใช้';
  document.getElementById('modal-user').dataset.editId = id;
  document.getElementById('mu-name').value = u.name;
  document.getElementById('mu-emp').value  = u.emp_id || '';
  document.getElementById('mu-user').value = u.username;
  document.getElementById('mu-pass').value = '';
  document.getElementById('mu-role').value = u.role;
  document.getElementById('mu-dept').value = u.dept || '';
  document.getElementById('mu-err').textContent = '';
  openModal('modal-user');
}

// ── OPEN APPROVER MODAL ───────────────────────────────────────
function openAddApprover() {
  delete document.getElementById('modal-approver')?.dataset.editId;
  if(document.getElementById('ap-name')) document.getElementById('ap-name').value = '';
  if(document.getElementById('ap-pos'))  document.getElementById('ap-pos').value  = '';
  openModal('modal-approver');
}

// ── STOCK FIELD MAPPING ───────────────────────────────────────
// map API field names to what the rest of JS expects
function mapStock(s) {
  return { ...s, min: s.min_qty, id: s.id };
}

// Override renderStock to use API data
const _origRenderStock = window.renderStock;
function renderStock() {
  // map min_qty -> min for legacy code compatibility
  stockData = stockData.map(s => ({ ...s, min: s.min_qty }));
  if (typeof _origRenderStock === 'function') {
    _origRenderStock();
  }
}

// Start
window.addEventListener('DOMContentLoaded', initApp);
</script>