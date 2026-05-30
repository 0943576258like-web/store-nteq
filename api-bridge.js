/* =====================================================
   NTEQ IT Stock System — API Bridge v2.0
   วางไฟล์นี้ใน public/ แล้วเพิ่มใน index.html ก่อน </body>:
   <script src="api-bridge.js"></script>
   ===================================================== */

(function(){
  'use strict';

  const API = '/api';
  let _serverOK = true;

  async function apiCall(method, endpoint, body) {
    try {
      const opts = { method, headers: {'Content-Type':'application/json'} };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(API + endpoint, opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      _serverOK = true;
      return data;
    } catch(e) {
      _serverOK = false;
      throw e;
    }
  }

  /* ---- override localStorage ---- */
  const _origGet  = Storage.prototype.getItem;
  const _origSet  = Storage.prototype.setItem;

  /* ---- Login Override ---- */
  window._origDoLogin = window.doLogin;
  window.doLogin = async function() {
    const u = document.getElementById('l-user').value.trim();
    const p = document.getElementById('l-pass').value.trim();
    if (!u || !p) return;
    try {
      const res = await apiCall('POST','/login',{username:u, password:p});
      if (res.success) {
        sessionStorage.setItem('nteq_session', JSON.stringify(res.user));
        /* map to old format */
        const roleMap = {admin:'admin', manager:'manager', warehouse:'warehouse', staff:'staff'};
        const legacy = {
          username: res.user.username,
          name: res.user.name,
          emp: res.user.emp_id,
          role: roleMap[res.user.role] || res.user.role,
          dept: res.user.dept
        };
        localStorage.setItem('nteq_session', JSON.stringify(legacy));
        document.getElementById('login-err').style.display = 'none';
        if (typeof initApp === 'function') initApp();
      }
    } catch(e) {
      /* fallback to localStorage login if server down */
      console.warn('Server down, using localStorage fallback');
      if (typeof window._origDoLogin === 'function') window._origDoLogin();
    }
  };

  /* ---- Sync helper: push localStorage data to server ---- */
  window.syncToServer = async function() {
    try {
      /* stock */
      const stock = JSON.parse(localStorage.getItem('nteq_stock')||'[]');
      for (const s of stock) { await apiCall('POST','/stock',s).catch(()=>{}); }
      /* requests */
      const reqs = JSON.parse(localStorage.getItem('nteq_requests')||'[]');
      for (const r of reqs) { await apiCall('POST','/requests',r).catch(()=>{}); }
      /* repairs */
      const repairs = JSON.parse(localStorage.getItem('nteq_repairs')||'[]');
      for (const r of repairs) { await apiCall('POST','/repairs',r).catch(()=>{}); }
      /* devices */
      const devs = JSON.parse(localStorage.getItem('nteq_devices')||'[]');
      for (const d of devs) { await apiCall('POST','/devices',d).catch(()=>{}); }
      /* categories */
      const cats = JSON.parse(localStorage.getItem('nteq_categories')||'[]');
      for (const c of cats) { await apiCall('POST','/categories',c).catch(()=>{}); }
      /* settings */
      const cfg = JSON.parse(localStorage.getItem('nteq_settings')||'{}');
      if (Object.keys(cfg).length > 0) { await apiCall('POST','/settings',cfg).catch(()=>{}); }
      console.log('✅ Sync to server complete');
      return true;
    } catch(e) { console.warn('Sync failed:', e); return false; }
  };

  /* ---- Pull from server and write back to localStorage ---- */
  window.syncFromServer = async function() {
    try {
      const [stock, requests, repairs, devices, categories, settings] = await Promise.all([
        apiCall('GET','/stock'),
        apiCall('GET','/requests'),
        apiCall('GET','/repairs'),
        apiCall('GET','/devices'),
        apiCall('GET','/categories'),
        apiCall('GET','/settings'),
      ]);
      localStorage.setItem('nteq_stock', JSON.stringify(stock));
      localStorage.setItem('nteq_requests', JSON.stringify(requests));
      localStorage.setItem('nteq_repairs', JSON.stringify(repairs));
      localStorage.setItem('nteq_devices', JSON.stringify(devices));
      localStorage.setItem('nteq_categories', JSON.stringify(categories));
      localStorage.setItem('nteq_settings', JSON.stringify(settings));
      console.log('✅ Sync from server complete');
      return true;
    } catch(e) { console.warn('Pull from server failed, using local data'); return false; }
  };

  /* ---- Auto-sync on page load ---- */
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await window.syncFromServer();
    } catch(e) {}
  });

  /* ---- Auto-refresh every 30s ---- */
  setInterval(async () => {
    try { await window.syncFromServer(); } catch(e) {}
  }, 30000);

  /* ---- Override save functions to also POST to API ---- */

  /* Stock save */
  const _origSaveStock = window.saveStock;
  window.saveStock = async function() {
    if (typeof _origSaveStock === 'function') _origSaveStock.apply(this, arguments);
    setTimeout(async () => {
      const stock = JSON.parse(localStorage.getItem('nteq_stock')||'[]');
      for (const s of stock) { await apiCall('POST','/stock',s).catch(()=>{}); }
    }, 200);
  };

  /* Request submit */
  const _origSubmit = window.submitRequest;
  window.submitRequest = async function() {
    if (typeof _origSubmit === 'function') _origSubmit.apply(this, arguments);
    setTimeout(async () => {
      const reqs = JSON.parse(localStorage.getItem('nteq_requests')||'[]');
      const latest = reqs[reqs.length - 1];
      if (latest) { await apiCall('POST','/requests', latest).catch(()=>{}); }
    }, 300);
  };

  /* Repair submit */
  const _origRepair = window.saveRepair;
  window.saveRepair = async function() {
    if (typeof _origRepair === 'function') _origRepair.apply(this, arguments);
    setTimeout(async () => {
      const repairs = JSON.parse(localStorage.getItem('nteq_repairs')||'[]');
      const latest = repairs[repairs.length-1];
      if (latest) { await apiCall('POST','/repairs', latest).catch(()=>{}); }
    }, 300);
  };

  /* Device save */
  const _origDev = window.saveDevice;
  window.saveDevice = async function() {
    if (typeof _origDev === 'function') _origDev.apply(this, arguments);
    setTimeout(async () => {
      const devs = JSON.parse(localStorage.getItem('nteq_devices')||'[]');
      for (const d of devs) { await apiCall('POST','/devices',d).catch(()=>{}); }
    }, 300);
  };

  /* Category save */
  const _origCat = window.saveCategory;
  window.saveCategory = async function() {
    if (typeof _origCat === 'function') _origCat.apply(this, arguments);
    setTimeout(async () => {
      const cats = JSON.parse(localStorage.getItem('nteq_categories')||'[]');
      for (const c of cats) { await apiCall('POST','/categories',c).catch(()=>{}); }
    }, 200);
  };

  /* Settings save */
  const _origSettings = window.saveSettingsForm;
  window.saveSettingsForm = async function() {
    if (typeof _origSettings === 'function') _origSettings.apply(this, arguments);
    setTimeout(async () => {
      const cfg = JSON.parse(localStorage.getItem('nteq_settings')||'{}');
      if (Object.keys(cfg).length > 0) { await apiCall('POST','/settings',cfg).catch(()=>{}); }
    }, 200);
  };

  /* ---- Approve/Reject override ---- */
  const _origApprove = window.doApprove;
  window.doApprove = async function(id, action, ...args) {
    if (typeof _origApprove === 'function') _origApprove.apply(this, [id, action, ...args]);
    setTimeout(async () => {
      const reqs = JSON.parse(localStorage.getItem('nteq_requests')||'[]');
      const r = reqs.find(x => x.id === id);
      if (r) { await apiCall('PUT','/requests/'+id,{status:r.status,approved_by:r.approved_by,approved_at:r.approved_at}).catch(()=>{}); }
    }, 300);
  };

  /* Receive stock */
  const _origRecv = window.confirmRecv;
  window.confirmRecv = async function() {
    if (typeof _origRecv === 'function') _origRecv.apply(this, arguments);
    setTimeout(async () => {
      const stock = JSON.parse(localStorage.getItem('nteq_stock')||'[]');
      for (const s of stock) { await apiCall('PUT','/stock/'+s.id,s).catch(()=>{}); }
    }, 300);
  };

  console.log('🔗 NTEQ API Bridge v2.0 loaded — server sync enabled');
})();
